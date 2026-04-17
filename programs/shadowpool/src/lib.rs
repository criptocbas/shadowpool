#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as SplMint,
};
use anchor_spl::token_interface::{self, Burn, Mint, MintTo, TransferChecked};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;
use pyth_solana_receiver_sdk::price_update::{Price, PriceUpdateV2};

pub mod dlmm_cpi;

pub mod constants;
pub mod contexts;
pub mod errors;
pub mod events;
pub mod state;

use constants::*;
use contexts::*;
use errors::ErrorCode;
use events::*;

/// Token-2022 mint extensions that are incompatible with vault custody or
/// share-token correctness. Enforced at `initialize_vault` against every
/// user-supplied mint (`token_a_mint`, `token_b_mint`, `share_mint`).
///
/// Rationale per extension:
/// - **PermanentDelegate**: perpetual authority can move vault-held tokens
///   out-of-band; breaks the creator-time-trust story.
/// - **TransferFeeConfig**: transfers arrive with less than `amount`;
///   breaks the share-pricing bookkeeping.
/// - **ConfidentialTransferMint**: balances live in ciphertext on the
///   token account; `vault_token_b.amount` reads become unreliable.
/// - **DefaultAccountState**: newly created token accounts for this mint
///   may be frozen, bricking deposits.
/// - **NonTransferable**: withdrawal transfers would fail.
/// - **TransferHook**: an untrusted third-party program runs on every
///   transfer; can fail, re-enter, or censor.
const DISALLOWED_MINT_EXTENSIONS: &[ExtensionType] = &[
    ExtensionType::PermanentDelegate,
    ExtensionType::TransferFeeConfig,
    ExtensionType::ConfidentialTransferMint,
    ExtensionType::DefaultAccountState,
    ExtensionType::NonTransferable,
    ExtensionType::TransferHook,
];

/// Read and validate a Pyth Pull Oracle price update, returning
/// `(price_micro_usd, conf_micro_usd)` normalized to the program's
/// `TARGET_PRICE_EXPO` scale.
///
/// Steps 1–3 (owner, feed-id, staleness) are delegated to the Pyth
/// SDK; steps 4–7 (exponent, positive price, confidence, normalization)
/// are delegated to `shadowpool_math::validate_and_normalize_price`,
/// the pure-math core that is exhaustively unit-tested, fuzz-tested,
/// and shareable with third-party integrators.
///
/// This thin wrapper translates the `shadowpool_math::MathError` into
/// the Anchor `ErrorCode` enum consumed by the rest of the program.
fn read_pyth_price(
    price_update: &PriceUpdateV2,
    feed_id: &[u8; 32],
    max_age_seconds: u64,
) -> Result<(u64, u64)> {
    let price: Price = price_update
        .get_price_no_older_than(&Clock::get()?, max_age_seconds, feed_id)
        .map_err(|_| error!(ErrorCode::PriceFeedMismatch))?;
    shadowpool_math::validate_and_normalize_price(price.price, price.conf, price.exponent)
        .map_err(math_err_to_anchor)
}

/// Thin Anchor wrappers over the `shadowpool_math` helpers. Exposed
/// `pub` so program-level Rust tests can call them directly.
pub fn validate_and_normalize_price(price: i64, conf: u64, exponent: i32) -> Result<(u64, u64)> {
    shadowpool_math::validate_and_normalize_price(price, conf, exponent)
        .map_err(math_err_to_anchor)
}

pub fn compute_expected_amount_out(
    swap_direction: u8,
    amount_in: u64,
    mpc_bid_price: u64,
    mpc_ask_price: u64,
    mpc_bid_size: u64,
    mpc_ask_size: u64,
    base_decimals: u8,
) -> Result<u64> {
    shadowpool_math::compute_expected_amount_out(
        swap_direction,
        amount_in,
        mpc_bid_price,
        mpc_ask_price,
        mpc_bid_size,
        mpc_ask_size,
        base_decimals,
    )
    .map_err(math_err_to_anchor)
}

pub fn compute_safety_floor(expected_out: u64, max_slippage_bps_ceiling: u16) -> Result<u64> {
    shadowpool_math::compute_safety_floor(expected_out, max_slippage_bps_ceiling)
        .map_err(math_err_to_anchor)
}

/// Translate `shadowpool_math::MathError` to the program's `ErrorCode`.
///
/// Every `MathError` has a one-to-one Anchor mapping — we are explicit
/// about the correspondence so there's no `catch-all` variant that
/// hides an unanticipated math error behind a generic `MathOverflow`.
fn math_err_to_anchor(e: shadowpool_math::MathError) -> anchor_lang::error::Error {
    use shadowpool_math::MathError;
    match e {
        MathError::PriceTooUncertain => error!(ErrorCode::PriceTooUncertain),
        MathError::NegativePrice => error!(ErrorCode::NegativePrice),
        MathError::InvalidPriceExponent => error!(ErrorCode::InvalidPriceExponent),
        MathError::InvalidSwapDirection => error!(ErrorCode::InvalidSwapDirection),
        MathError::ZeroBidPrice => error!(ErrorCode::ZeroNavBasis),
        MathError::SwapAmountExceedsMpcSize => error!(ErrorCode::SwapAmountExceedsMpcSize),
        MathError::MathOverflow => error!(ErrorCode::MathOverflow),
    }
}

/// Rejects any mint that carries a disallowed Token-2022 extension. Legacy
/// SPL Token mints (owner = `spl_token::ID`) have no extensions and pass
/// trivially.
fn enforce_mint_extension_allowlist(mint: &InterfaceAccount<Mint>) -> Result<()> {
    let account_info = mint.to_account_info();
    // Legacy SPL Token mints cannot carry extensions — skip the parse.
    if *account_info.owner == anchor_spl::token::ID {
        return Ok(());
    }
    let data = account_info.try_borrow_data()?;
    let parsed = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(ErrorCode::InvalidMint))?;
    let extensions = parsed
        .get_extension_types()
        .map_err(|_| error!(ErrorCode::InvalidMint))?;
    for ext in extensions {
        if DISALLOWED_MINT_EXTENSIONS.contains(&ext) {
            return Err(error!(ErrorCode::DisallowedMintExtension));
        }
    }
    Ok(())
}

declare_id!("BEu9VWMdba4NumzJ3NqYtHysPtCWe1gB33SbDwZ64g4g");

#[arcium_program]
pub mod shadowpool {
    use super::*;

    // ==========================================================
    // COMP DEF INITIALIZERS (one-time setup per circuit)
    // ==========================================================
    //
    // Each Arcis circuit needs its computation-definition account
    // registered on-chain before the circuit can be invoked. These
    // instructions are called exactly once per circuit per cluster
    // (devnet / mainnet); the ComputationDefinitionAccount is a PDA
    // so subsequent calls fail with "already in use" and the test
    // harness pre-checks via `getAccountInfo` to stay idempotent.

    /// Register the `init_vault_state` Arcis circuit with the MXE.
    pub fn init_vault_state_comp_def(ctx: Context<InitVaultStateCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Register the `compute_quotes` Arcis circuit with the MXE.
    pub fn init_compute_quotes_comp_def(ctx: Context<InitComputeQuotesCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Register the `update_balances` Arcis circuit with the MXE.
    pub fn init_update_balances_comp_def(
        ctx: Context<InitUpdateBalancesCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Register the `update_strategy` Arcis circuit with the MXE.
    pub fn init_update_strategy_comp_def(
        ctx: Context<InitUpdateStrategyCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Register the `reveal_performance` Arcis circuit with the MXE.
    pub fn init_reveal_performance_comp_def(
        ctx: Context<InitRevealPerformanceCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // ==========================================================
    // INITIALIZE VAULT — create vault PDA with empty state
    // ==========================================================

    /// Creates the vault PDA + bookkeeping fields.
    ///
    /// Runs the creator-time safety checks via account constraints + an
    /// explicit Token-2022 extension allow-list inside the handler:
    /// (1) distinct token A/B mints, (2) vault token accounts with no
    /// delegate and no close authority, (3) share mint with the vault
    /// PDA as mint authority, zero supply, and no freeze authority,
    /// (4) every mint (token_a, token_b, share) free of Token-2022
    /// extensions that would compromise custody or accounting
    /// (PermanentDelegate, TransferFeeConfig, ConfidentialTransferMint,
    /// DefaultAccountState, NonTransferable, TransferHook). After
    /// creation the encrypted state is still all zeros — the owner
    /// must call `create_vault_state` (MPC) to install the initial
    /// strategy parameters.
    ///
    /// Oracle parameters:
    /// - `price_feed_id` — 32-byte chain-agnostic Pyth feed ID
    ///   (e.g. SOL/USD = `0xef0d…b56d`). Gates which Pyth account is
    ///   accepted by `compute_quotes`. Auditors prefer this in per-
    ///   vault config over hard-coded program constants because it
    ///   lets governance rotate a compromised feed without redeploy.
    /// - `max_price_age_seconds` — maximum staleness of a Pyth update
    ///   passed to `compute_quotes`. Industry default is 30s; tighter
    ///   values (10–15s) require the cranker to post the VAA in the
    ///   same transaction. Must be > 0.
    ///
    /// Emits `VaultCreatedEvent` with slot.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        price_feed_id: [u8; 32],
        max_price_age_seconds: u64,
    ) -> Result<()> {
        require!(max_price_age_seconds > 0, ErrorCode::InvalidAmount);

        // Reject mints carrying Token-2022 extensions that break custody
        // or accounting. Done in the handler (not a constraint) because
        // extension parsing requires borrowing the raw account data.
        enforce_mint_extension_allowlist(&ctx.accounts.token_a_mint)?;
        enforce_mint_extension_allowlist(&ctx.accounts.token_b_mint)?;
        enforce_mint_extension_allowlist(&ctx.accounts.share_mint)?;

        let vault = &mut ctx.accounts.vault;
        vault.bump = ctx.bumps.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.token_a_mint = ctx.accounts.token_a_mint.key();
        vault.token_b_mint = ctx.accounts.token_b_mint.key();
        vault.token_a_vault = ctx.accounts.token_a_vault.key();
        vault.token_b_vault = ctx.accounts.token_b_vault.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.total_shares = 0;
        vault.total_deposits_a = 0;
        vault.total_deposits_b = 0;
        vault.last_rebalance_slot = 0;
        vault.state_nonce = 0;
        vault.encrypted_state = [[0u8; 32]; 5];
        vault.last_bid_price = 0;
        vault.last_bid_size = 0;
        vault.last_ask_price = 0;
        vault.last_ask_size = 0;
        vault.last_should_rebalance = 0;
        vault.quotes_slot = 0;
        vault.quotes_consumed = true;
        vault.last_revealed_nav = 0;
        vault.last_revealed_nav_slot = 0;
        vault.nav_stale = false;
        // Default cranker = authority. A future `set_cranker` instruction
        // can delegate this role to a third party without transferring
        // vault ownership, unlocking the trustless-cranker roadmap.
        vault.cranker = ctx.accounts.authority.key();
        vault.price_feed_id = price_feed_id;
        vault.max_price_age_seconds = max_price_age_seconds;
        vault.pending_state_computation = None;

        emit!(VaultCreatedEvent {
            vault: vault.key(),
            authority: vault.authority,
            token_a_mint: vault.token_a_mint,
            token_b_mint: vault.token_b_mint,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    // ==========================================================
    // INIT VAULT STATE — create encrypted strategy via MPC
    // ==========================================================

    /// Queue the MPC computation that creates the vault's initial
    /// encrypted strategy (installs `Enc<Mxe, VaultState>`).
    ///
    /// Called by the vault authority after `initialize_vault`. Takes
    /// client-side-encrypted `spread_bps` and `rebalance_threshold`
    /// (along with the x25519 public key + nonce that encrypted them)
    /// and queues the `init_vault_state` Arcis circuit. The callback
    /// writes the resulting `Enc<Mxe, VaultState>` into the vault's
    /// `encrypted_state` field at `ENCRYPTED_STATE_OFFSET`.
    pub fn create_vault_state(
        ctx: Context<CreateVaultState>,
        computation_offset: u64,
        encrypted_spread_bps: [u8; 32],
        encrypted_rebalance_threshold: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        // Single-flight guard (M-1) — one in-flight state-mutating MPC
        // computation per vault. Cleared in the callback.
        require!(
            ctx.accounts.vault.pending_state_computation.is_none(),
            ErrorCode::StateComputationPending
        );
        ctx.accounts.vault.pending_state_computation = Some(computation_offset);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u16(encrypted_spread_bps)
            .encrypted_u16(encrypted_rebalance_threshold)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![InitVaultStateCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.vault.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_vault_state")]
    pub fn init_vault_state_callback(
        ctx: Context<InitVaultStateCallback>,
        output: SignedComputationOutputs<InitVaultStateOutput>,
    ) -> Result<()> {
        let verify_result = output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        );
        // Clear the single-flight pending flag regardless of outcome —
        // this callback firing means Arcium has resolved the computation,
        // so the vault is free to accept new state-mutating queues. If
        // we only cleared on success, an aborted computation would
        // wedge the vault indefinitely (M-1 liveness).
        ctx.accounts.vault.pending_state_computation = None;

        let o = verify_result
            .map_err(|_| ErrorCode::AbortedComputation)?
            .field_0;

        let vault = &mut ctx.accounts.vault;
        vault.encrypted_state = o.ciphertexts;
        vault.state_nonce = o.nonce;

        emit!(VaultStateInitializedEvent {
            vault: vault.key(),
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    // ==========================================================
    // COMPUTE QUOTES — encrypted strategy + public oracle → plaintext quotes
    // ==========================================================

    /// Queue the MPC computation that produces a bid/ask quote from
    /// encrypted strategy plus a Pyth-verified public price.
    ///
    /// **The core value proposition**: the strategy (spread, thresholds,
    /// inventory) never leaves the MPC cluster. Only the resulting
    /// `QuoteOutput` (bid/ask price + size + rebalance flag) is revealed
    /// by the callback.
    ///
    /// Oracle price is read from a Pyth Pull Oracle `PriceUpdateV2`
    /// account supplied by the cranker. The account is owner-checked by
    /// Anchor (`Account<PriceUpdateV2>`), feed-id-checked by the context
    /// constraint against `vault.price_feed_id`, then the handler calls
    /// `get_price_no_older_than` (which re-checks feed id internally) to
    /// enforce `vault.max_price_age_seconds`. The price/confidence are
    /// then sanity-checked (positive, bounded exponent, ≤1% conf ratio)
    /// and normalised to the program's micro-USD scale before being
    /// passed to the MPC circuit as plaintext `u64`s.
    ///
    /// Caller is the cranker (gated by `cranker == vault.cranker`). The
    /// callback persists the revealed quotes to `vault.last_*` fields so
    /// `execute_rebalance` can consume them within `QUOTE_STALENESS_SLOTS`.
    pub fn compute_quotes(
        ctx: Context<ComputeQuotes>,
        computation_offset: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(vault.state_nonce > 0, ErrorCode::VaultNotInitialized);

        // Read + validate + normalise the Pyth price before queueing the MPC
        // computation. Any reject path here keeps the MPC queue and fee
        // pool untouched (fails the tx before `queue_computation`).
        let (oracle_price, oracle_confidence) = read_pyth_price(
            &ctx.accounts.price_update,
            &vault.price_feed_id,
            vault.max_price_age_seconds,
        )?;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // ArgBuilder order MUST match circuit parameter order:
        // 1. state: Enc<Mxe, VaultState> → nonce + account
        // 2. oracle_price: u64 → plaintext
        // 3. oracle_confidence: u64 → plaintext
        let args = ArgBuilder::new()
            .plaintext_u128(vault.state_nonce)
            .account(
                ctx.accounts.vault.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .plaintext_u64(oracle_price)
            .plaintext_u64(oracle_confidence)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![ComputeQuotesCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.vault.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "compute_quotes")]
    pub fn compute_quotes_callback(
        ctx: Context<ComputeQuotesCallback>,
        output: SignedComputationOutputs<ComputeQuotesOutput>,
    ) -> Result<()> {
        // compute_quotes returns revealed QuoteOutput (plaintext)
        // The output fields are the revealed struct fields: bid_price, bid_size, ask_price, ask_size, should_rebalance
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(ComputeQuotesOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let vault = &mut ctx.accounts.vault;
        let slot = Clock::get()?.slot;

        // If a previous quote was still unconsumed when this callback fires,
        // we're silently overwriting it. Surface that as an event so an
        // indexer can detect lost cranker work or competing crankers.
        if !vault.quotes_consumed && vault.quotes_slot > 0 {
            emit!(QuotesOverwrittenEvent {
                vault: vault.key(),
                previous_slot: vault.quotes_slot,
                previous_bid_price: vault.last_bid_price,
                previous_ask_price: vault.last_ask_price,
                slot,
            });
        }

        // Persist revealed quotes on-chain so execute_rebalance can read them
        vault.last_bid_price = o.field_0;
        vault.last_bid_size = o.field_1;
        vault.last_ask_price = o.field_2;
        vault.last_ask_size = o.field_3;
        vault.last_should_rebalance = o.field_4 as u8;
        vault.quotes_slot = slot;
        vault.quotes_consumed = false;

        // Emit PLAINTEXT quotes for the cranker / frontend.
        // The strategy that PRODUCED these quotes remains encrypted on-chain.
        emit!(QuotesComputedEvent {
            vault: vault.key(),
            bid_price: o.field_0,
            bid_size: o.field_1,
            ask_price: o.field_2,
            ask_size: o.field_3,
            should_rebalance: o.field_4 as u8,
            slot,
        });
        Ok(())
    }

    // ==========================================================
    // UPDATE BALANCES — after DEX trade, update encrypted balances
    // ==========================================================

    /// Queue the MPC computation that applies post-trade deltas to the
    /// encrypted vault state.
    ///
    /// Called after `execute_rebalance` finishes a DEX CPI, with the
    /// actual base/quote tokens received and sent. The circuit uses
    /// u128 saturating arithmetic so a malformed cranker can't
    /// underflow the encrypted balance. Also records `new_mid_price`
    /// so subsequent `compute_quotes` calls can check price drift.
    pub fn update_balances(
        ctx: Context<UpdateBalances>,
        computation_offset: u64,
        base_received: u64,
        base_sent: u64,
        quote_received: u64,
        quote_sent: u64,
        new_mid_price: u64,
    ) -> Result<()> {
        // Preconditions — take the checks off `ctx.accounts.vault` directly
        // so we can then mutate the pending flag without a borrow conflict.
        require!(
            ctx.accounts.vault.state_nonce > 0,
            ErrorCode::VaultNotInitialized
        );
        require!(
            ctx.accounts.vault.pending_state_computation.is_none(),
            ErrorCode::StateComputationPending
        );
        ctx.accounts.vault.pending_state_computation = Some(computation_offset);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let state_nonce = ctx.accounts.vault.state_nonce;
        let vault_key = ctx.accounts.vault.key();

        // ArgBuilder order matches circuit: state (Enc<Mxe>) first, then plaintexts
        let args = ArgBuilder::new()
            .plaintext_u128(state_nonce)
            .account(vault_key, ENCRYPTED_STATE_OFFSET, ENCRYPTED_STATE_SIZE)
            .plaintext_u64(base_received)
            .plaintext_u64(base_sent)
            .plaintext_u64(quote_received)
            .plaintext_u64(quote_sent)
            .plaintext_u64(new_mid_price)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![UpdateBalancesCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.vault.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "update_balances")]
    pub fn update_balances_callback(
        ctx: Context<UpdateBalancesCallback>,
        output: SignedComputationOutputs<UpdateBalancesOutput>,
    ) -> Result<()> {
        let verify_result = output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        );
        ctx.accounts.vault.pending_state_computation = None;

        let o = verify_result
            .map_err(|_| ErrorCode::AbortedComputation)?
            .field_0;

        let vault = &mut ctx.accounts.vault;
        vault.encrypted_state = o.ciphertexts;
        vault.state_nonce = o.nonce;

        emit!(BalancesUpdatedEvent {
            vault: vault.key(),
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    // ==========================================================
    // UPDATE STRATEGY — owner changes encrypted params
    // ==========================================================

    /// Queue the MPC computation that replaces the vault's encrypted
    /// `spread_bps` and `rebalance_threshold` with new client-encrypted
    /// values.
    ///
    /// Authority-only (enforced by `has_one = authority` on the context).
    /// Leaves balances and `last_mid_price` untouched; only the strategy
    /// parameters change. An observer sees the vault's quotes shift
    /// after the next `compute_quotes`, but cannot see why.
    pub fn update_strategy(
        ctx: Context<UpdateStrategy>,
        computation_offset: u64,
        encrypted_spread_bps: [u8; 32],
        encrypted_rebalance_threshold: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        require!(
            ctx.accounts.vault.authority == ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );
        require!(
            ctx.accounts.vault.state_nonce > 0,
            ErrorCode::VaultNotInitialized
        );
        require!(
            ctx.accounts.vault.pending_state_computation.is_none(),
            ErrorCode::StateComputationPending
        );
        ctx.accounts.vault.pending_state_computation = Some(computation_offset);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let state_nonce = ctx.accounts.vault.state_nonce;
        let vault_key = ctx.accounts.vault.key();

        // ArgBuilder order matches circuit: state (Enc<Mxe>) first, then new_params (Enc<Shared>)
        let args = ArgBuilder::new()
            .plaintext_u128(state_nonce)
            .account(vault_key, ENCRYPTED_STATE_OFFSET, ENCRYPTED_STATE_SIZE)
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u16(encrypted_spread_bps)
            .encrypted_u16(encrypted_rebalance_threshold)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![UpdateStrategyCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.vault.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "update_strategy")]
    pub fn update_strategy_callback(
        ctx: Context<UpdateStrategyCallback>,
        output: SignedComputationOutputs<UpdateStrategyOutput>,
    ) -> Result<()> {
        let verify_result = output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        );
        ctx.accounts.vault.pending_state_computation = None;

        let o = verify_result
            .map_err(|_| ErrorCode::AbortedComputation)?
            .field_0;

        let vault = &mut ctx.accounts.vault;
        vault.encrypted_state = o.ciphertexts;
        vault.state_nonce = o.nonce;

        emit!(StrategyUpdatedEvent {
            vault: vault.key(),
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    // ==========================================================
    // REVEAL PERFORMANCE — selective disclosure of vault value
    // ==========================================================

    /// Queue the MPC computation that reveals the vault's total value
    /// (in quote units), without disclosing the underlying balances or
    /// strategy.
    ///
    /// The callback writes the result to `vault.last_revealed_nav` and
    /// clears `vault.nav_stale`, which unblocks subsequent deposits
    /// and withdrawals. The caller is unrestricted so any observer
    /// can request a fresh NAV reveal; the *content* revealed is only
    /// the aggregate total.
    ///
    /// This is the "selective disclosure" primitive that lets auditors
    /// attest to solvency or performance without touching the strategy.
    pub fn reveal_performance(
        ctx: Context<RevealPerformance>,
        computation_offset: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(vault.state_nonce > 0, ErrorCode::VaultNotInitialized);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .plaintext_u128(vault.state_nonce)
            .account(
                ctx.accounts.vault.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![RevealPerformanceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.vault.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "reveal_performance")]
    pub fn reveal_performance_callback(
        ctx: Context<RevealPerformanceCallback>,
        output: SignedComputationOutputs<RevealPerformanceOutput>,
    ) -> Result<()> {
        let total_value = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(RevealPerformanceOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Persist the MPC-attested NAV so deposit/withdraw can price shares
        // off it, and clear the stale flag so user flows unblock.
        let current_slot = Clock::get()?.slot;
        let vault_key = ctx.accounts.vault.key();
        let vault = &mut ctx.accounts.vault;
        vault.last_revealed_nav = total_value;
        vault.last_revealed_nav_slot = current_slot;
        vault.nav_stale = false;

        emit!(PerformanceRevealedEvent {
            vault: vault_key,
            total_value_in_quote: total_value,
            slot: current_slot,
        });
        Ok(())
    }

    // ==========================================================
    // DEPOSIT — user deposits quote token (USDC) into vault
    // ==========================================================

    /// Deposit quote tokens into the vault and receive spTokens pro-rata.
    ///
    /// Pricing: if a revealed NAV exists (`last_revealed_nav > 0`),
    /// prices shares against it; otherwise uses `total_deposits_b`
    /// (equivalent to NAV pre-trade). Blocks with `NavStale` if a
    /// rebalance has occurred since the last `reveal_performance`.
    ///
    /// **Pre/post reload accounting (H-3).** Bookkeeping credits the
    /// *actually-received* amount (`balance_after - balance_before`),
    /// not the caller-supplied `amount`. The Token-2022 extension
    /// allow-list in `initialize_vault` already rejects mints with a
    /// `TransferFeeConfig` today, so `actual_received == amount` holds
    /// in practice — but this pattern is belt-and-braces for forward
    /// compatibility and audit-defensibility. The share mint is
    /// calculated from `actual_received`, so a deposit that somehow
    /// lands short (fee, rounding, hook re-entrancy) mints shares
    /// pro-rata to what the vault actually received.
    ///
    /// Post-transfer, `last_revealed_nav` is incremented by
    /// `actual_received` since the deposit is a deterministic, non-MPC
    /// delta. Rejects a zero-shares mint via `ZeroShares` (protects
    /// against dust that rounds down).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Staleness guard — block deposits against a post-rebalance NAV
        // that hasn't been refreshed by reveal_performance.
        require!(!ctx.accounts.vault.nav_stale, ErrorCode::NavStale);

        // Extract signer seeds (not yet needed, but cleaner above the
        // mutable borrow sequence that follows).
        let authority_key = ctx.accounts.vault.authority;
        let bump = ctx.accounts.vault.bump;
        let vault_key = ctx.accounts.vault.key();

        // --- Transfer quote tokens: user → vault ---
        //
        // Pre/post snapshot the vault's quote ATA so bookkeeping can
        // credit the exact amount the vault received (H-3). The
        // `reload()` before the snapshot is belt-and-braces: Anchor
        // auto-refreshes on account deserialization, but explicit
        // reload documents the intent.
        ctx.accounts.vault_token_b.reload()?;
        let balance_before = ctx.accounts.vault_token_b.amount;

        let quote_decimals = ctx.accounts.token_b_mint.decimals;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    mint: ctx.accounts.token_b_mint.to_account_info(),
                    to: ctx.accounts.vault_token_b.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            quote_decimals,
        )?;

        ctx.accounts.vault_token_b.reload()?;
        let actual_received = ctx
            .accounts
            .vault_token_b
            .amount
            .checked_sub(balance_before)
            .ok_or(ErrorCode::MathOverflow)?;
        // Hard floor: the vault must have received something. Catches
        // transfer-fee misconfigurations or hook-side reverts where the
        // outer tx "succeeded" but the vault's balance did not move.
        require!(actual_received > 0, ErrorCode::InvalidAmount);

        // --- NAV-aware share pricing ---
        //
        // Pricing basis:
        //   - If the vault has a revealed NAV (last_revealed_nav > 0),
        //     use it; authoritative post-trade.
        //   - Otherwise pre-first-reveal: total_deposits_b == NAV.
        let uses_revealed_nav = ctx.accounts.vault.last_revealed_nav > 0;
        let nav_basis = if uses_revealed_nav {
            ctx.accounts.vault.last_revealed_nav
        } else {
            ctx.accounts.vault.total_deposits_b
        };

        // Calculate shares from the actually-received amount.
        let shares_to_mint = if ctx.accounts.vault.total_shares == 0 {
            actual_received
        } else {
            require!(nav_basis > 0, ErrorCode::ZeroNavBasis);
            // u128 intermediate prevents overflow on
            // actual_received * total_shares for large vaults.
            let scaled = (actual_received as u128)
                .checked_mul(ctx.accounts.vault.total_shares as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(nav_basis as u128)
                .ok_or(ErrorCode::MathOverflow)?;
            u64::try_from(scaled).map_err(|_| ErrorCode::MathOverflow)?
        };
        require!(shares_to_mint > 0, ErrorCode::ZeroShares);

        // --- Mint spTokens to user ---
        //
        // Vault PDA signs. mint_to (rather than mint_to_checked) is fine
        // here: the share mint is our own program-owned mint, decimals
        // are fixed at vault creation, and Token-2022 compatibility for
        // share tokens is not on the roadmap.
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", authority_key.as_ref(), &[bump]]];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_share_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            shares_to_mint,
        )?;

        // --- Update vault state with the actually-credited amount ---
        let vault = &mut ctx.accounts.vault;
        vault.total_shares = vault
            .total_shares
            .checked_add(shares_to_mint)
            .ok_or(ErrorCode::MathOverflow)?;
        vault.total_deposits_b = vault
            .total_deposits_b
            .checked_add(actual_received)
            .ok_or(ErrorCode::MathOverflow)?;
        if uses_revealed_nav {
            vault.last_revealed_nav = vault
                .last_revealed_nav
                .checked_add(actual_received)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        // Emit the actually-received amount (not the caller's claim).
        // An indexer comparing user-side debit vs vault-side credit will
        // see any fee delta as (amount - actual_received).
        emit!(DepositEvent {
            vault: vault_key,
            user: ctx.accounts.user.key(),
            amount: actual_received,
            shares_minted: shares_to_mint,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    // ==========================================================
    // WITHDRAW — user burns share tokens and receives quote token
    // ==========================================================

    /// Burn spTokens and receive a pro-rata share of the vault's quote
    /// tokens.
    ///
    /// Pricing mirrors deposit (NAV-aware; blocks when `nav_stale`).
    /// Also enforces a real-balance solvency check: `vault_token_b.amount
    /// >= amount_out` — catches cases where the on-chain SPL balance
    /// has diverged from the bookkeeping counter (only possible post-
    /// DEX-CPI, but the check is cheap defence-in-depth).
    ///
    /// Post-transfer, `last_revealed_nav` decrements by `amount_out`
    /// (saturating to avoid sub-satoshi residuals from rounding).
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.vault.total_shares > 0, ErrorCode::InsufficientBalance);

        // Mirror the NAV staleness check from deposit — withdrawing against
        // a stale NAV would let an LP extract more than their share.
        require!(!ctx.accounts.vault.nav_stale, ErrorCode::NavStale);

        // Extract values before mutable borrow
        let authority_key = ctx.accounts.vault.authority;
        let bump = ctx.accounts.vault.bump;
        let vault_key = ctx.accounts.vault.key();

        // NAV-aware exit pricing: shares_share_of_nav = shares / total_shares.
        // amount_out = shares_share_of_nav * nav_basis.
        let uses_revealed_nav = ctx.accounts.vault.last_revealed_nav > 0;
        let nav_basis = if uses_revealed_nav {
            ctx.accounts.vault.last_revealed_nav
        } else {
            ctx.accounts.vault.total_deposits_b
        };
        require!(nav_basis > 0, ErrorCode::ZeroNavBasis);

        let amount_out = u64::try_from(
            (shares as u128)
                .checked_mul(nav_basis as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(ctx.accounts.vault.total_shares as u128)
                .ok_or(ErrorCode::MathOverflow)?,
        )
        .map_err(|_| ErrorCode::MathOverflow)?;

        require!(amount_out > 0, ErrorCode::InvalidAmount);
        // Solvency check: total_deposits_b is a bookkeeping counter that can
        // drift from the on-chain SPL balance once DEX CPIs land. Check the
        // REAL vault_token_b.amount as the authoritative gate so we never
        // attempt an SPL transfer larger than the vault actually holds.
        // Also keep the bookkeeping check as defence-in-depth — they should
        // agree pre-CPI; a divergence is a bug worth surfacing.
        require!(
            ctx.accounts.vault_token_b.amount >= amount_out,
            ErrorCode::InsufficientBalance
        );
        require!(
            amount_out <= ctx.accounts.vault.total_deposits_b,
            ErrorCode::InsufficientBalance
        );

        // Burn user's share tokens
        token_interface::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    from: ctx.accounts.user_share_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            shares,
        )?;

        // Transfer quote tokens from vault to user — vault PDA signs.
        // transfer_checked validates mint + decimals; required for Token-2022.
        let quote_decimals = ctx.accounts.token_b_mint.decimals;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", authority_key.as_ref(), &[bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_token_b.to_account_info(),
                    mint: ctx.accounts.token_b_mint.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount_out,
            quote_decimals,
        )?;

        // Reload after CPI so the post-transfer balance is visible to any
        // downstream logic (relevant once DEX CPI integration adds reads).
        ctx.accounts.vault_token_b.reload()?;

        // Update vault state
        let vault = &mut ctx.accounts.vault;
        vault.total_shares = vault.total_shares.checked_sub(shares).ok_or(ErrorCode::MathOverflow)?;
        vault.total_deposits_b = vault.total_deposits_b.checked_sub(amount_out).ok_or(ErrorCode::MathOverflow)?;

        // Mirror the deposit's NAV tracking: the withdrawal removes exactly
        // `amount_out` quote tokens, so the revealed NAV decrements by the
        // same amount. Saturating because rounding could otherwise leave a
        // sub-satoshi residual.
        if uses_revealed_nav {
            vault.last_revealed_nav = vault.last_revealed_nav.saturating_sub(amount_out);
        }

        emit!(WithdrawEvent {
            vault: vault_key,
            user: ctx.accounts.user.key(),
            shares_burned: shares,
            amount_out,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    // ==========================================================
    // SET CRANKER — authority delegates the MPC cranking role
    // ==========================================================

    /// Authority-only: re-assign `vault.cranker`. Every MPC rebalance
    /// instruction (`compute_quotes`, `update_balances`,
    /// `execute_rebalance`) is gated on `cranker == vault.cranker`, so
    /// this is how a vault owner promotes a delegated cranker (e.g. a
    /// hot wallet on a cranking bot) without handing over ownership.
    /// Passing `new_cranker = vault.authority` reverts to the default
    /// self-cranking model.
    ///
    /// Emits `CrankerSetEvent` with the old and new cranker.
    pub fn set_cranker(ctx: Context<SetCranker>, new_cranker: Pubkey) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let previous = vault.cranker;
        vault.cranker = new_cranker;
        emit!(CrankerSetEvent {
            vault: vault.key(),
            previous_cranker: previous,
            new_cranker,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    // ==========================================================
    // EMERGENCY OVERRIDE — authority unsticks liveness flags
    // ==========================================================

    /// Authority-only escape hatch for stuck internal flags.
    ///
    /// Two flags can hang in exceptional operational conditions:
    /// - `nav_stale`: set by `execute_rebalance`, cleared only by a
    ///   successful `reveal_performance_callback`. If the reveal
    ///   computation is aborted, the MPC cluster goes offline, or the
    ///   comp-def is uninitialized on the cluster, deposit/withdraw
    ///   stay blocked indefinitely. Retrying `reveal_performance` is
    ///   the preferred recovery; this override is the last resort.
    /// - `pending_state_computation`: set by a queue of the three
    ///   state-mutating MPC instructions and cleared by the paired
    ///   callback (success OR abort). A callback that never arrives
    ///   (cluster failure) would wedge the single-flight guard.
    ///
    /// Authority-only (enforced by `has_one = authority`). Emits
    /// `EmergencyOverrideEvent` with booleans + the previous pending
    /// offset so any override is auditable. Safe to call with both
    /// booleans `false` (no-op + event emission — useful for testing).
    pub fn emergency_override(
        ctx: Context<EmergencyOverride>,
        clear_nav_stale: bool,
        clear_pending_state: bool,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let previous_pending_state = vault.pending_state_computation;
        if clear_nav_stale {
            vault.nav_stale = false;
        }
        if clear_pending_state {
            vault.pending_state_computation = None;
        }

        emit!(EmergencyOverrideEvent {
            vault: vault.key(),
            cleared_nav_stale: clear_nav_stale,
            cleared_pending_state: clear_pending_state,
            previous_pending_state,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    // ==========================================================
    // CLOSE VAULT — authority reclaims rent from an empty vault
    // ==========================================================

    /// Authority-only: close the vault PDA and return its rent
    /// balance to the authority's wallet.
    ///
    /// Two paths:
    ///
    /// 1. **Empty-vault path (normal).** If the vault account
    ///    deserializes under the current `Vault` schema, enforce
    ///    `total_shares == 0` AND `total_deposits_b == 0` before
    ///    closure — LP safety. Any outstanding position blocks close.
    ///
    /// 2. **Legacy-layout path (rescue).** If deserialization fails
    ///    (account pre-dates the current layout), skip the
    ///    invariant check. Authority is the sole trust anchor; this
    ///    path lets operators wind down stale test or pre-upgrade
    ///    vaults without a program re-deployment cycle.
    ///
    /// The vault's token accounts and share mint stay intact and can
    /// be independently closed via standard `spl-token` tooling. A
    /// drained vault will have zero-balance token accounts that
    /// close trivially to any owner-specified recipient.
    ///
    /// Emits `VaultClosedEvent` with the reclaimed lamports and a
    /// `was_legacy_layout` flag so indexers can audit the two paths.
    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        let vault_info = ctx.accounts.vault.to_account_info();
        let authority_info = ctx.accounts.authority.to_account_info();

        // Program ownership check — never close an account we don't
        // own. This is defence-in-depth; the seeds constraint on the
        // context already proves it's our PDA, but we verify raw
        // ownership at the AccountInfo level.
        require!(
            vault_info.owner == &crate::ID,
            ErrorCode::Unauthorized
        );

        // Invariant enforcement when possible.
        let was_legacy_layout: bool;
        {
            let data = vault_info.try_borrow_data()?;
            match state::Vault::try_deserialize(&mut &data[..]) {
                Ok(vault) => {
                    require!(
                        vault.authority == ctx.accounts.authority.key(),
                        ErrorCode::Unauthorized
                    );
                    require!(vault.total_shares == 0, ErrorCode::VaultNotEmpty);
                    require!(vault.total_deposits_b == 0, ErrorCode::VaultNotEmpty);
                    was_legacy_layout = false;
                }
                Err(_) => {
                    // Legacy layout — no invariant check is possible.
                    // Authority + seed binding are the only gate.
                    was_legacy_layout = true;
                    msg!(
                        "close_vault: legacy layout ({} bytes); authority-only path",
                        data.len()
                    );
                }
            }
        }

        // Transfer lamports + zero-size the account. This is the
        // standard Anchor-style "close" without using the `close = …`
        // attribute (which requires a typed `Account`).
        let lamports = vault_info.lamports();
        **authority_info.try_borrow_mut_lamports()? = authority_info
            .lamports()
            .checked_add(lamports)
            .ok_or(ErrorCode::MathOverflow)?;
        **vault_info.try_borrow_mut_lamports()? = 0;

        // Reassign ownership back to system and realloc to 0.
        vault_info.assign(&anchor_lang::solana_program::system_program::ID);
        vault_info.resize(0)?;

        emit!(VaultClosedEvent {
            vault: vault_info.key(),
            authority: ctx.accounts.authority.key(),
            lamports_returned: lamports,
            was_legacy_layout,
            slot: Clock::get()?.slot,
        });

        Ok(())
    }

    // ==========================================================
    // EXECUTE REBALANCE — read persisted quotes, CPI into DEX
    // ==========================================================
    // Called by the authority after compute_quotes writes fresh quotes.

    /// Read freshly-computed MPC quotes, CPI into Meteora DLMM to
    /// execute the trade, and mark NAV stale until the next reveal.
    ///
    /// **Authority-gated** (cranker == vault.cranker, enforced by the
    /// context constraint). Validates:
    /// - quotes exist (`quotes_slot > 0`),
    /// - they haven't been used (`!quotes_consumed`),
    /// - they aren't stale (`slot - quotes_slot <= QUOTE_STALENESS_SLOTS`),
    /// - the MPC said a rebalance was needed (`should_rebalance == 1`),
    /// - `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS` (5% ceiling),
    /// - `swap_direction` is 0 (base→quote) or 1 (quote→base),
    /// - `amount_in` is within the size the MPC revealed on the chosen side,
    /// - `min_amount_out` is at least the MPC-derived safety floor
    ///   (`expected_out * (1 - MAX_ALLOWED_SLIPPAGE_BPS)`) — the cranker
    ///   can *tighten* slippage but never loosen it beyond the cap.
    ///
    /// Executes a DLMM `swap` with the vault PDA as the signer. Bin
    /// arrays traversed by the swap must be pre-computed client-side
    /// and passed via `ctx.remaining_accounts` (see Meteora's TS SDK
    /// `getBinArrayForSwap`). Post-CPI the handler reloads the vault's
    /// out-side ATA, computes the real `amount_out`, and emits the
    /// event with ground-truth values.
    ///
    /// **NAV staleness**: sets `nav_stale = true` so deposit/withdraw
    /// block until the next `reveal_performance` attestation. The
    /// cranker is expected to call `update_balances` with the real
    /// deltas next to re-sync the encrypted vault state.
    pub fn execute_rebalance<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteRebalance<'info>>,
        swap_direction: u8,
        amount_in: u64,
        min_amount_out: u64,
        max_slippage_bps: u16,
    ) -> Result<()> {
        // --- 1. Static arg validation ---
        require!(
            swap_direction == 0 || swap_direction == 1,
            ErrorCode::InvalidSwapDirection
        );
        require!(amount_in > 0, ErrorCode::InvalidAmount);
        require!(
            max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS,
            ErrorCode::SlippageTooHigh
        );
        require!(
            !ctx.remaining_accounts.is_empty(),
            ErrorCode::MissingBinArrays
        );

        // --- 2. Quote lifecycle checks (existing) ---
        let vault = &ctx.accounts.vault;
        require!(!vault.quotes_consumed, ErrorCode::QuotesAlreadyConsumed);
        require!(vault.quotes_slot > 0, ErrorCode::NoQuotesAvailable);

        let current_slot = Clock::get()?.slot;
        let age = current_slot.saturating_sub(vault.quotes_slot);
        require!(age <= QUOTE_STALENESS_SLOTS, ErrorCode::QuotesStale);

        let bid_price = vault.last_bid_price;
        let bid_size = vault.last_bid_size;
        let ask_price = vault.last_ask_price;
        let ask_size = vault.last_ask_size;
        let should_rebalance = vault.last_should_rebalance;
        require!(should_rebalance == 1, ErrorCode::RebalanceNotNeeded);

        // --- 3. Resolve base side + decimals from the DLMM pool ---
        //
        // DLMM pools declare their own token_x/token_y ordering, which
        // may or may not match the vault's token_a/token_b. Pick the
        // Mint account that corresponds to the vault's BASE token.
        let vault_a_is_x = ctx.accounts.token_x_mint.key() == vault.token_a_mint;
        let base_mint_info = if vault_a_is_x {
            &ctx.accounts.token_x_mint
        } else {
            &ctx.accounts.token_y_mint
        };
        let base_decimals = base_mint_info.decimals;

        // --- 4. Compute expected_out + enforce size cap (pure helper) ---
        let expected_out = compute_expected_amount_out(
            swap_direction,
            amount_in,
            bid_price,
            ask_price,
            bid_size,
            ask_size,
            base_decimals,
        )?;

        // --- 5. MPC-anchored slippage floor ---
        //
        // Cranker-supplied `min_amount_out` must be ≥ the program-
        // derived floor. The cranker can tighten slippage (pass a
        // higher min_out) but cannot loosen it beyond the hard
        // MAX_ALLOWED_SLIPPAGE_BPS cap — we deliberately compare
        // against the program cap, not the cranker's
        // `max_slippage_bps` arg, so a malicious cranker cannot pass
        // `max_slippage_bps=5%` + `min_out=0` and bypass the floor.
        let safety_floor_u64 = compute_safety_floor(expected_out, MAX_ALLOWED_SLIPPAGE_BPS)?;
        require!(
            min_amount_out >= safety_floor_u64,
            ErrorCode::SlippageFloorViolated
        );

        // --- 6. Pick user_token_in / user_token_out per direction ---
        let (user_token_in_info, user_token_out_info) = match swap_direction {
            0 => (
                ctx.accounts.vault_token_a.to_account_info(),
                ctx.accounts.vault_token_b.to_account_info(),
            ),
            _ => (
                ctx.accounts.vault_token_b.to_account_info(),
                ctx.accounts.vault_token_a.to_account_info(),
            ),
        };

        // --- 7. Snapshot out-side balance for post-swap delta ---
        let balance_before: u64 = match swap_direction {
            0 => ctx.accounts.vault_token_b.amount,
            _ => ctx.accounts.vault_token_a.amount,
        };

        // --- 8. PDA signer seeds for the vault ---
        let authority_key = vault.authority;
        let bump = vault.bump;
        let signer_seeds: &[&[&[u8]]] =
            &[&[b"vault", authority_key.as_ref(), &[bump]]];

        // --- 9. DLMM swap CPI ---
        dlmm_cpi::swap(
            dlmm_cpi::SwapCpiAccounts {
                lb_pair: &ctx.accounts.lb_pair.to_account_info(),
                bin_array_bitmap_extension: None,
                reserve_x: &ctx.accounts.dlmm_reserve_x.to_account_info(),
                reserve_y: &ctx.accounts.dlmm_reserve_y.to_account_info(),
                user_token_in: &user_token_in_info,
                user_token_out: &user_token_out_info,
                token_x_mint: &ctx.accounts.token_x_mint.to_account_info(),
                token_y_mint: &ctx.accounts.token_y_mint.to_account_info(),
                oracle: &ctx.accounts.dlmm_oracle.to_account_info(),
                host_fee_in: None,
                user: &ctx.accounts.vault.to_account_info(),
                token_x_program: &ctx.accounts.token_x_program.to_account_info(),
                token_y_program: &ctx.accounts.token_y_program.to_account_info(),
                event_authority: &ctx.accounts.dlmm_event_authority.to_account_info(),
                dlmm_program: &ctx.accounts.dlmm_program.to_account_info(),
                bin_arrays: ctx.remaining_accounts,
            },
            signer_seeds,
            amount_in,
            min_amount_out,
        )?;

        // --- 10. Reload + compute real amount_out ---
        match swap_direction {
            0 => ctx.accounts.vault_token_b.reload()?,
            _ => ctx.accounts.vault_token_a.reload()?,
        }
        let balance_after: u64 = match swap_direction {
            0 => ctx.accounts.vault_token_b.amount,
            _ => ctx.accounts.vault_token_a.amount,
        };
        let actual_amount_out = balance_after
            .checked_sub(balance_before)
            .ok_or(ErrorCode::MathOverflow)?;
        // Belt-and-braces: DLMM should have enforced this, but verify.
        require!(
            actual_amount_out >= min_amount_out,
            ErrorCode::SlippageFloorViolated
        );

        // --- 11. Mark quotes consumed + NAV stale + emit event ---
        let vault = &mut ctx.accounts.vault;
        vault.quotes_consumed = true;
        vault.nav_stale = true;
        vault.last_rebalance_slot = current_slot;

        emit!(RebalanceExecutedEvent {
            vault: vault.key(),
            bid_price,
            bid_size,
            ask_price,
            ask_size,
            slot: current_slot,
        });

        msg!(
            "execute_rebalance OK: direction={} amount_in={} amount_out={} (floor={})",
            swap_direction,
            amount_in,
            actual_amount_out,
            min_amount_out
        );
        Ok(())
    }
}

// Account contexts live in accounts.rs — see `pub mod accounts;` above.
//
// Legacy inline definitions removed: CreateVaultState / ComputeQuotes /
// UpdateBalances / UpdateStrategy / RevealPerformance and their callbacks,
// the 5 init-comp-def contexts, and InitializeVault / Deposit / Withdraw /
// ExecuteRebalance have all been moved.
// ==============================================================
// INVARIANT TESTS
// ==============================================================

#[cfg(test)]
mod pyth_normalization_tests {
    //! Unit tests for `validate_and_normalize_price` — the pure arithmetic
    //! core of the Pyth integration. Covers each reject path and the
    //! three scaling branches (coarser, equal, finer than program scale).
    //!
    //! These tests don't exercise staleness, feed-id, or account-ownership
    //! checks; those live one layer up in `read_pyth_price` and are
    //! enforced by the Pyth SDK + Anchor. The integration test on devnet
    //! covers the full on-chain stack with a real `PriceUpdateV2`.
    use super::{validate_and_normalize_price, ErrorCode};
    use anchor_lang::prelude::*;
    type TestResult = std::result::Result<(u64, u64), anchor_lang::error::Error>;

    fn assert_err(res: TestResult, expected: ErrorCode) {
        let e = res.expect_err("expected error");
        let code: u32 = expected.into();
        assert!(
            format!("{e:?}").contains(&code.to_string()) || format!("{e:?}").contains(&format!("{expected:?}")),
            "expected {expected:?}, got {e:?}"
        );
    }

    #[test]
    fn normalizes_sol_usd_at_expo_minus_8_to_micro_usd() {
        // Pyth publishes SOL/USD at expo=-8. For a $150.00000000 price:
        //   raw price = 15_000_000_000, conf = 5_000_000 (0.05 micro-scale)
        // Normalized to TARGET_PRICE_EXPO=-6 (micro-USD):
        //   price = 150_000_000, conf = 50_000
        let (p, c) = validate_and_normalize_price(15_000_000_000, 5_000_000, -8).unwrap();
        assert_eq!(p, 150_000_000);
        assert_eq!(c, 50_000);
    }

    #[test]
    fn normalizes_coarser_scale_by_multiplying() {
        // Fictional feed at expo=-4: raw price 1_500_000 = $150.0000
        // Normalize to -6: multiply by 10^2 → 150_000_000.
        let (p, _) = validate_and_normalize_price(1_500_000, 0, -4).unwrap();
        assert_eq!(p, 150_000_000);
    }

    #[test]
    fn normalizes_equal_scale_identity() {
        // Feed already at expo=-6 → passthrough.
        let (p, c) = validate_and_normalize_price(150_000_000, 500_000, -6).unwrap();
        assert_eq!(p, 150_000_000);
        assert_eq!(c, 500_000);
    }

    #[test]
    fn rejects_zero_price_as_negative() {
        assert_err(
            validate_and_normalize_price(0, 0, -8),
            ErrorCode::NegativePrice,
        );
    }

    #[test]
    fn rejects_negative_price_on_spot_feed() {
        // Negative prices are legal for some derivatives but not for our
        // spot-only vault. The `i64` type carries them through; we reject.
        assert_err(
            validate_and_normalize_price(-1, 0, -8),
            ErrorCode::NegativePrice,
        );
    }

    #[test]
    fn rejects_exponent_below_minus_eighteen() {
        assert_err(
            validate_and_normalize_price(100, 0, -19),
            ErrorCode::InvalidPriceExponent,
        );
    }

    #[test]
    fn rejects_positive_exponent() {
        // exponent=1 would blow the u128 scaling in pathological cases
        // and never corresponds to a legitimate Pyth spot feed.
        assert_err(
            validate_and_normalize_price(100, 0, 1),
            ErrorCode::InvalidPriceExponent,
        );
    }

    #[test]
    fn rejects_confidence_above_one_percent() {
        // price = $150 at expo=-8 → conf just over 1% (1_500_000_001).
        // MAX_CONF_BPS = 100 (1%) — this must reject.
        assert_err(
            validate_and_normalize_price(15_000_000_000, 1_500_000_001, -8),
            ErrorCode::PriceTooUncertain,
        );
    }

    #[test]
    fn accepts_confidence_exactly_at_one_percent_boundary() {
        // conf/price == 1/100 exactly → boundary case, accepted.
        let (p, c) = validate_and_normalize_price(15_000_000_000, 150_000_000, -8).unwrap();
        assert_eq!(p, 150_000_000);
        assert_eq!(c, 1_500_000); // 1% of the normalized price
    }

    #[test]
    fn zero_confidence_is_always_acceptable() {
        let (_, c) = validate_and_normalize_price(15_000_000_000, 0, -8).unwrap();
        assert_eq!(c, 0);
    }

    #[test]
    fn handles_large_price_without_overflow() {
        // BTC at $100k: price = 10_000_000_000_000 at expo=-8. After /100
        // → 100_000_000_000. Well within u64.
        let (p, _) = validate_and_normalize_price(10_000_000_000_000, 0, -8).unwrap();
        assert_eq!(p, 100_000_000_000);
    }

    #[test]
    fn normalizes_at_zero_exponent() {
        // Some feeds publish at exponent 0 (integer whole units).
        // price = 150 at expo=0 → "150 whole units" = 150_000_000 micro.
        let (p, c) = validate_and_normalize_price(150, 1, 0).unwrap();
        assert_eq!(p, 150_000_000);
        assert_eq!(c, 1_000_000);
    }

    #[test]
    fn normalizes_at_min_exponent() {
        // expo = -18 is the lower bound. 1_000_000_000_000 at -18 → /10^12 = 1.
        let (p, _) = validate_and_normalize_price(1_000_000_000_000, 0, -18).unwrap();
        assert_eq!(p, 1);
    }

    #[test]
    fn rejects_tight_conf_strictly_over_one_percent() {
        // exactly 100bps + 1 ulp over should still reject.
        assert_err(
            validate_and_normalize_price(10_000, 101, -6),
            ErrorCode::PriceTooUncertain,
        );
    }

    #[test]
    fn accepts_conf_at_half_percent() {
        // 50bps conf — comfortably inside the 100bps limit.
        let (p, c) = validate_and_normalize_price(200_000_000, 1_000_000, -6).unwrap();
        assert_eq!(p, 200_000_000);
        assert_eq!(c, 1_000_000);
    }

    #[test]
    fn huge_conf_with_huge_price_still_enforces_ratio() {
        // $1B feed (1e15 micro) with $12M conf (1.2% of price) — reject.
        assert_err(
            validate_and_normalize_price(1_000_000_000_000_000, 12_000_000_000_000, -6),
            ErrorCode::PriceTooUncertain,
        );
    }
}

#[cfg(test)]
mod dlmm_math_tests {
    //! Unit tests for `compute_expected_amount_out` and
    //! `compute_safety_floor` — the pure-math core of the DLMM swap
    //! integration. Covers each reject path (InvalidSwapDirection,
    //! ZeroNavBasis for quote→base, SwapAmountExceedsMpcSize on each
    //! side, MathOverflow on the scaling edge).
    //!
    //! Fixtures use SOL/USDC-style scales:
    //!   - base_decimals = 9 (SOL lamports)
    //!   - quote decimals = 6 (micro-USDC, implicit via TARGET_PRICE_EXPO)
    //!   - prices in micro-USD per whole SOL
    //!
    //! Example: SOL = $150 → ask_price = 150_000_000. Swapping
    //! 1 SOL (1e9 lamports) base→quote yields 150_000_000 micro-USDC.
    use super::*;
    type TestResult = std::result::Result<u64, anchor_lang::error::Error>;

    fn assert_err(res: TestResult, expected: ErrorCode) {
        let e = res.expect_err("expected error");
        assert!(
            format!("{e:?}").contains(&format!("{expected:?}")),
            "expected {expected:?}, got {e:?}"
        );
    }

    // ----- compute_expected_amount_out -----

    #[test]
    fn base_to_quote_happy_path_sol_usdc() {
        // 1 SOL (1e9 lamports) base→quote at ask_price = $150 →
        //   out = 1e9 * 150_000_000 / 1e9 = 150_000_000 micro-USDC = $150.00
        let out = compute_expected_amount_out(
            0,
            1_000_000_000,          // 1 SOL in lamports
            149_625_000,            // bid  (unused for dir=0)
            150_375_000,            // ask  ($150.375 per SOL)
            83,                     // bid_size (unused)
            10_000,                 // ask_size (10k SOL available)
            9,                      // base_decimals = SOL
        )
        .unwrap();
        assert_eq!(out, 150_375_000); // $150.375 in micro-USD
    }

    #[test]
    fn quote_to_base_happy_path_sol_usdc() {
        // 150 USDC (150e6 micro) quote→base at bid_price = $149.625 per SOL →
        //   out = 150e6 * 1e9 / 149_625_000 ≈ 1.0025 SOL (integer-truncated)
        let out = compute_expected_amount_out(
            1,
            150_000_000,            // 150 USDC in micro-USDC
            149_625_000,            // bid $149.625
            150_375_000,            // ask (unused)
            100_000,                // bid_size (SOL we'd buy, plenty)
            0,                      // ask_size (unused)
            9,                      // base_decimals = SOL
        )
        .unwrap();
        // Expected: 150_000_000 * 1_000_000_000 / 149_625_000 = 1_002_506_265
        assert_eq!(out, 1_002_506_265);
    }

    #[test]
    fn base_to_quote_exactly_at_size_cap_accepted() {
        // amount_in == ask_size * base_scale should pass the cap.
        let out = compute_expected_amount_out(
            0,
            10_000 * 1_000_000_000, // 10k SOL in lamports
            0,
            150_000_000,
            0,
            10_000,                  // cap = 10k SOL
            9,
        )
        .unwrap();
        // 10k SOL * $150 = $1.5M in micro-USDC
        assert_eq!(out, 1_500_000_000_000);
    }

    #[test]
    fn base_to_quote_over_size_cap_rejects() {
        // amount_in > ask_size * base_scale
        assert_err(
            compute_expected_amount_out(
                0,
                10_001 * 1_000_000_000,
                0,
                150_000_000,
                0,
                10_000,
                9,
            ),
            ErrorCode::SwapAmountExceedsMpcSize,
        );
    }

    #[test]
    fn quote_to_base_over_size_cap_rejects() {
        // amount_in / bid_price > bid_size
        // e.g. bid_size = 10 SOL at $150: max amount_in = 10 * 150 * 1e6 = 1.5e9
        // Pass 2e9 → equivalent_base = 2e9 / 150e6 = 13 > 10
        assert_err(
            compute_expected_amount_out(
                1,
                2_000_000_000,           // 2000 USDC
                150_000_000,             // bid $150
                0,
                10,                       // bid_size = 10 SOL
                0,
                9,
            ),
            ErrorCode::SwapAmountExceedsMpcSize,
        );
    }

    #[test]
    fn quote_to_base_with_zero_bid_rejects() {
        // bid_price = 0 must reject (would div-by-zero otherwise).
        assert_err(
            compute_expected_amount_out(1, 100, 0, 150_000_000, 10, 10, 9),
            ErrorCode::ZeroNavBasis,
        );
    }

    #[test]
    fn invalid_direction_rejects() {
        assert_err(
            compute_expected_amount_out(2, 100, 100, 100, 10, 10, 9),
            ErrorCode::InvalidSwapDirection,
        );
        assert_err(
            compute_expected_amount_out(255, 100, 100, 100, 10, 10, 9),
            ErrorCode::InvalidSwapDirection,
        );
    }

    #[test]
    fn zero_amount_in_returns_zero_out() {
        // Not an error at the math layer — the handler checks `amount_in > 0`
        // before calling the helper. Pure-function answers honestly: out = 0.
        let out = compute_expected_amount_out(0, 0, 0, 150_000_000, 0, 10, 9).unwrap();
        assert_eq!(out, 0);
    }

    #[test]
    fn extreme_base_decimals_scale_works() {
        // 6-decimal base (USDC-style) swapping USDC→USDC-like.
        // 1 USDC base * $1 ask / 1e6 = 1_000_000 quote-raw.
        let out = compute_expected_amount_out(
            0,
            1_000_000,               // 1 unit in 6-dec raw
            0,
            1_000_000,               // $1 per unit
            0,
            1_000_000,               // plenty of cap
            6,
        )
        .unwrap();
        assert_eq!(out, 1_000_000);
    }

    #[test]
    fn base_decimals_too_high_overflows() {
        // base_decimals = 19 makes 10^19 > u64::MAX / 10 → fits in u128 but
        // `amount_in * base_scale` would blow if amount_in is large too.
        // With amount_in = 1 it shouldn't overflow (1 * 10^19 fits in u128).
        let out = compute_expected_amount_out(1, 1, 100, 0, 1, 0, 19);
        // 1 / 100 = 0 SOL equivalent_base → cap passes
        // 1 * 10^19 / 100 = 10^17 ≤ u64::MAX → OK
        assert_eq!(out.unwrap(), 100_000_000_000_000_000);
    }

    #[test]
    fn base_decimals_above_39_overflows_10_pow() {
        // 10^39 > u128::MAX — `checked_pow` returns None → MathOverflow.
        assert_err(
            compute_expected_amount_out(0, 1, 0, 1, 0, u64::MAX, 39),
            ErrorCode::MathOverflow,
        );
    }

    // ----- compute_safety_floor -----

    #[test]
    fn safety_floor_at_5_percent_cap() {
        // $100 expected_out at 5% cap → floor = $95
        let floor = compute_safety_floor(100_000_000, 500).unwrap();
        assert_eq!(floor, 95_000_000);
    }

    #[test]
    fn safety_floor_at_zero_bps_equals_expected() {
        // 0% cap means the floor IS the expected — no slippage tolerated.
        let floor = compute_safety_floor(100_000_000, 0).unwrap();
        assert_eq!(floor, 100_000_000);
    }

    #[test]
    fn safety_floor_at_100_percent_bps_is_zero() {
        // 10_000 bps = 100% — floor collapses to 0. Valid arithmetically.
        let floor = compute_safety_floor(100_000_000, 10_000).unwrap();
        assert_eq!(floor, 0);
    }

    #[test]
    fn safety_floor_rejects_over_100_percent_bps() {
        // 10_001 bps would underflow 10_000 - bps → MathOverflow.
        assert_err(
            compute_safety_floor(100_000_000, 10_001),
            ErrorCode::MathOverflow,
        );
    }

    #[test]
    fn safety_floor_zero_expected_out_is_zero_floor() {
        // 0 * anything = 0. Pure function gives the honest answer.
        let floor = compute_safety_floor(0, 500).unwrap();
        assert_eq!(floor, 0);
    }

    #[test]
    fn safety_floor_extreme_expected_out_no_overflow() {
        // u64::MAX expected_out × u16 cap works because the u128
        // intermediate is comfortable.
        let floor = compute_safety_floor(u64::MAX, 500).unwrap();
        // (2^64 - 1) * 9500 / 10_000 ≈ 0.95 * 2^64, fits in u64.
        let expected = ((u64::MAX as u128) * 9500 / 10_000) as u64;
        assert_eq!(floor, expected);
    }

    // ----- combined: integration of the two helpers -----

    #[test]
    fn handler_floor_matches_expected_times_safety_factor() {
        // A full walkthrough: compute expected_out, then floor, and
        // assert the relationship holds arithmetically.
        let expected = compute_expected_amount_out(
            0,
            1_000_000_000,
            0,
            150_000_000,
            0,
            10_000,
            9,
        )
        .unwrap();
        let floor = compute_safety_floor(expected, 500).unwrap();
        // expected = 150_000_000 micro-USDC; 5% cap → floor = 142_500_000
        assert_eq!(expected, 150_000_000);
        assert_eq!(floor, 142_500_000);
    }
}

#[cfg(test)]
mod invariant_tests {
    use super::ENCRYPTED_STATE_OFFSET;

    /// The MPC cluster reads the encrypted vault state directly from the
    /// account bytes at a fixed offset (via `.account(pubkey, offset, size)`
    /// in Arcis ArgBuilder). If anyone inserts a field above `encrypted_state`
    /// in the Vault struct, the offset must be updated — otherwise the MPC
    /// reads wrong bytes and every circuit produces garbage.
    ///
    /// This test pins the offset to the serialized layout of the preamble so
    /// a layout change fails fast at `cargo test` time rather than silently
    /// corrupting encrypted state on-chain.
    #[test]
    fn encrypted_state_offset_matches_vault_preamble() {
        // Vault serialized preamble (Anchor uses borsh, which writes fields
        // sequentially without padding):
        //   discriminator  : 8 bytes  (Anchor-injected account tag)
        //   bump           : u8       =  1
        //   authority      : Pubkey   = 32
        //   token_a_mint   : Pubkey   = 32
        //   token_b_mint   : Pubkey   = 32
        //   token_a_vault  : Pubkey   = 32
        //   token_b_vault  : Pubkey   = 32
        //   share_mint     : Pubkey   = 32
        //   total_shares         : u64 = 8
        //   total_deposits_a     : u64 = 8
        //   total_deposits_b     : u64 = 8
        //   last_rebalance_slot  : u64 = 8
        //   state_nonce          : u128 = 16
        //
        //   Sum = 8 + 1 + (6 * 32) + (4 * 8) + 16 = 249
        const EXPECTED: u32 = 8 + 1 + (6 * 32) + (4 * 8) + 16;
        assert_eq!(
            ENCRYPTED_STATE_OFFSET, EXPECTED,
            "ENCRYPTED_STATE_OFFSET drift: if you added/removed a Vault field above \
             `encrypted_state`, update both the constant and this test."
        );
    }
}
