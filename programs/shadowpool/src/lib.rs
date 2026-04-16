use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as SplMint,
};
use anchor_spl::token_interface::{self, Burn, Mint, MintTo, TransferChecked};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

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
    /// Emits `VaultCreatedEvent` with slot.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
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
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitVaultStateOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

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
    /// encrypted strategy plus a public oracle price.
    ///
    /// **The core value proposition**: the strategy (spread, thresholds,
    /// inventory) never leaves the MPC cluster. Only the resulting
    /// `QuoteOutput` (bid/ask price + size + rebalance flag) is revealed
    /// by the callback.
    ///
    /// Caller is the cranker — any signer; the vault is seed-bound to
    /// its authority so cranker != authority is fine. The callback
    /// persists the revealed quotes to `vault.last_*` fields so
    /// `execute_rebalance` can consume them within `QUOTE_STALENESS_SLOTS`.
    pub fn compute_quotes(
        ctx: Context<ComputeQuotes>,
        computation_offset: u64,
        oracle_price: u64,
        oracle_confidence: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(vault.state_nonce > 0, ErrorCode::VaultNotInitialized);

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
        let vault = &ctx.accounts.vault;
        require!(vault.state_nonce > 0, ErrorCode::VaultNotInitialized);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // ArgBuilder order matches circuit: state (Enc<Mxe>) first, then plaintexts
        let args = ArgBuilder::new()
            .plaintext_u128(vault.state_nonce)
            .account(
                ctx.accounts.vault.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
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
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(UpdateBalancesOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

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
        let vault = &ctx.accounts.vault;
        require!(
            vault.authority == ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );
        require!(vault.state_nonce > 0, ErrorCode::VaultNotInitialized);

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // ArgBuilder order matches circuit: state (Enc<Mxe>) first, then new_params (Enc<Shared>)
        let args = ArgBuilder::new()
            .plaintext_u128(vault.state_nonce)
            .account(
                ctx.accounts.vault.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
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
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(UpdateStrategyOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

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
    /// Post-transfer, `last_revealed_nav` is incremented by exactly
    /// `amount` since the deposit is a deterministic, non-MPC delta —
    /// no fresh reveal is needed. Rejects a zero-shares mint via
    /// `ZeroShares` (protects against dust that rounds down).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Extract signer seeds before any mutable borrow
        let authority_key = ctx.accounts.vault.authority;
        let bump = ctx.accounts.vault.bump;
        let vault_key = ctx.accounts.vault.key();

        // NAV-aware share pricing.
        //
        // Pricing basis:
        //   - If the vault has a revealed NAV (last_revealed_nav > 0), use it.
        //     This is authoritative post-trade because the MPC-attested NAV
        //     reflects actual vault composition (base value + quote value).
        //   - Otherwise we're pre-first-reveal: no trades have happened, so
        //     total_deposits_b == NAV and is safe to use.
        //
        // Staleness guard:
        //   Once execute_rebalance has run, nav_stale is true until the next
        //   reveal_performance_callback. Depositing against a stale NAV would
        //   mis-price shares (the revealed NAV doesn't reflect post-trade
        //   holdings). Reject and require a refresh.
        require!(!ctx.accounts.vault.nav_stale, ErrorCode::NavStale);

        let uses_revealed_nav = ctx.accounts.vault.last_revealed_nav > 0;
        let nav_basis = if uses_revealed_nav {
            ctx.accounts.vault.last_revealed_nav
        } else {
            ctx.accounts.vault.total_deposits_b
        };

        // Calculate shares to mint. First deposit is 1:1 (bootstraps share
        // supply). Subsequent deposits dilute pro-rata against the nav_basis.
        //
        // If shares are outstanding but nav_basis is zero (edge case: a post-
        // rebalance state where encrypted balances hold the position but the
        // pre-reveal quote counter is drained), we'd otherwise divide by zero
        // and surface a confusing MathOverflow. Fail fast with a clearer
        // error so the caller knows to run reveal_performance.
        let shares_to_mint = if ctx.accounts.vault.total_shares == 0 {
            amount
        } else {
            require!(nav_basis > 0, ErrorCode::ZeroNavBasis);
            // u128 intermediate prevents overflow on amount * total_shares
            // for large vaults; downcast is safe because (amount / nav_basis)
            // <= 1 in typical conditions.
            let scaled = (amount as u128)
                .checked_mul(ctx.accounts.vault.total_shares as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(nav_basis as u128)
                .ok_or(ErrorCode::MathOverflow)?;
            u64::try_from(scaled).map_err(|_| ErrorCode::MathOverflow)?
        };
        require!(shares_to_mint > 0, ErrorCode::ZeroShares);

        // Transfer quote tokens from user to vault. transfer_checked
        // (vs the legacy transfer) validates mint identity and decimals,
        // which is also a requirement for any Token-2022 mint and the
        // current Solana docs recommendation everywhere.
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

        // Mint share tokens (spTokens) to user — vault PDA is the mint
        // authority. mint_to (rather than mint_to_checked) is fine here:
        // the share mint is our own program-owned mint, decimals are
        // fixed at vault creation, and Token-2022 compatibility for share
        // tokens is not on the roadmap.
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

        // Reload vault_token_b so any subsequent code that reads its amount
        // sees the post-transfer value rather than the pre-CPI snapshot.
        // No-op for the current state-update logic but required as soon as
        // execute_rebalance integrates a real DEX CPI.
        ctx.accounts.vault_token_b.reload()?;

        // Update vault state
        let vault = &mut ctx.accounts.vault;
        vault.total_shares = vault.total_shares.checked_add(shares_to_mint).ok_or(ErrorCode::MathOverflow)?;
        vault.total_deposits_b = vault.total_deposits_b.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;

        // NAV tracking: the deposit adds exactly `amount` quote tokens to the
        // vault, so a revealed NAV stays accurate after this deterministic
        // delta. Only update when we have a revealed NAV to track; the
        // pre-reveal path uses total_deposits_b which we already updated.
        if uses_revealed_nav {
            vault.last_revealed_nav = vault
                .last_revealed_nav
                .checked_add(amount)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        emit!(DepositEvent {
            vault: vault_key,
            user: ctx.accounts.user.key(),
            amount,
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
    // EXECUTE REBALANCE — read persisted quotes, CPI into DEX
    // ==========================================================
    // Called by the authority after compute_quotes writes fresh quotes.

    /// Read freshly-computed quotes, (eventually) execute the DEX trade,
    /// and mark the NAV stale until the next reveal.
    ///
    /// Authority-gated (constraint on the `cranker` signer in the
    /// context). Validates that:
    /// - quotes exist (`quotes_slot > 0`),
    /// - they haven't been used (`!quotes_consumed`),
    /// - they aren't stale (`slot - quotes_slot <= QUOTE_STALENESS_SLOTS`),
    /// - the MPC said a rebalance was needed (`should_rebalance == 1`),
    /// - `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS` (5% ceiling).
    ///
    /// **DEX CPI is a placeholder**: computes slippage bounds + logs
    /// the intended trade, but doesn't yet CPI into Meteora DLMM.
    /// Once the CPI is live, `update_balances` gets called with the
    /// actual deltas to re-sync encrypted state.
    ///
    /// Flips `nav_stale = true` and `quotes_consumed = true` on exit.
    pub fn execute_rebalance(
        ctx: Context<ExecuteRebalance>,
        max_slippage_bps: u16,
    ) -> Result<()> {
        // Cap slippage to 5% so a malicious or buggy cranker cannot quietly
        // pass 100% and nullify the slippage protection. Institutional MM
        // strategies rarely need >2% tolerance; 5% is the safety ceiling.
        require!(
            max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS,
            ErrorCode::SlippageTooHigh
        );

        let vault = &ctx.accounts.vault;

        // Validate quotes exist and haven't been used
        require!(!vault.quotes_consumed, ErrorCode::QuotesAlreadyConsumed);
        require!(vault.quotes_slot > 0, ErrorCode::NoQuotesAvailable);

        // Staleness check: quotes must be from within the last 150 slots (~1 minute)
        let current_slot = Clock::get()?.slot;
        let age = current_slot.saturating_sub(vault.quotes_slot);
        require!(age <= QUOTE_STALENESS_SLOTS, ErrorCode::QuotesStale);

        // Read the persisted quotes
        let bid_price = vault.last_bid_price;
        let bid_size = vault.last_bid_size;
        let ask_price = vault.last_ask_price;
        let ask_size = vault.last_ask_size;
        let should_rebalance = vault.last_should_rebalance;

        // Only rebalance if the MPC computation says so
        require!(should_rebalance == 1, ErrorCode::RebalanceNotNeeded);

        // Compute slippage bounds for DEX execution
        let bid_min_out = bid_size
            .checked_mul((10_000u64).checked_sub(max_slippage_bps as u64).ok_or(ErrorCode::MathOverflow)?)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::MathOverflow)?;
        let ask_min_out = ask_size
            .checked_mul((10_000u64).checked_sub(max_slippage_bps as u64).ok_or(ErrorCode::MathOverflow)?)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10_000)
            .ok_or(ErrorCode::MathOverflow)?;

        // ── DEX CPI PLACEHOLDER ──────────────────────────────────
        // Meteora DLMM integration goes here. The vault PDA signs:
        //   let signer_seeds = &[b"vault", authority.as_ref(), &[bump]];
        //
        // Two possible approaches:
        //   1. Swap: CPI into dlmm::cpi::swap() with bid/ask amounts
        //   2. LP:   CPI into dlmm::cpi::add_liquidity_by_strategy()
        //            with bid/ask converted to a bin range
        //
        // After CPI, read actual token deltas and pass to update_balances.
        // ─────────────────────────────────────────────────────────

        msg!(
            "execute_rebalance: bid={}@{} ask={}@{} slippage={}bps min_bid_out={} min_ask_out={}",
            bid_size, bid_price, ask_size, ask_price,
            max_slippage_bps, bid_min_out, ask_min_out,
        );

        // Mark quotes as consumed so they can't be replayed, and flag NAV as
        // stale — the (eventual) DEX CPI will change vault composition in a
        // way the previously-revealed NAV no longer reflects. Deposits and
        // withdrawals will be blocked until reveal_performance produces a
        // fresh NAV attestation.
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
