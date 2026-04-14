use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Transfer, Burn};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

// Computation definition offsets — one per Arcis circuit
const COMP_DEF_OFFSET_INIT_VAULT_STATE: u32 = comp_def_offset("init_vault_state");
const COMP_DEF_OFFSET_COMPUTE_QUOTES: u32 = comp_def_offset("compute_quotes");
const COMP_DEF_OFFSET_UPDATE_BALANCES: u32 = comp_def_offset("update_balances");
const COMP_DEF_OFFSET_UPDATE_STRATEGY: u32 = comp_def_offset("update_strategy");
const COMP_DEF_OFFSET_REVEAL_PERFORMANCE: u32 = comp_def_offset("reveal_performance");

// Vault encrypted state layout
// Byte offset: 8 (disc) + 1 (bump) + 32 (authority) + 32 (token_a_mint) + 32 (token_b_mint)
//   + 32 (token_a_vault) + 32 (token_b_vault) + 32 (share_mint)
//   + 8 (total_shares) + 8 (total_deposits_a) + 8 (total_deposits_b)
//   + 8 (last_rebalance_slot) + 16 (state_nonce) = 249
const ENCRYPTED_STATE_OFFSET: u32 = 249;
const ENCRYPTED_STATE_SIZE: u32 = 32 * 5; // 5 ciphertexts × 32 bytes

declare_id!("BEu9VWMdba4NumzJ3NqYtHysPtCWe1gB33SbDwZ64g4g");

#[arcium_program]
pub mod shadowpool {
    use super::*;

    // ==========================================================
    // COMP DEF INITIALIZERS (one-time setup per circuit)
    // ==========================================================

    pub fn init_vault_state_comp_def(ctx: Context<InitVaultStateCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_compute_quotes_comp_def(ctx: Context<InitComputeQuotesCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_update_balances_comp_def(
        ctx: Context<InitUpdateBalancesCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_update_strategy_comp_def(
        ctx: Context<InitUpdateStrategyCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_reveal_performance_comp_def(
        ctx: Context<InitRevealPerformanceCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // ==========================================================
    // INITIALIZE VAULT — create vault PDA with empty state
    // ==========================================================

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
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

        emit!(VaultCreatedEvent {
            vault: vault.key(),
            authority: vault.authority,
            token_a_mint: vault.token_a_mint,
            token_b_mint: vault.token_b_mint,
        });
        Ok(())
    }

    // ==========================================================
    // INIT VAULT STATE — create encrypted strategy via MPC
    // ==========================================================
    // Called after initialize_vault. Owner encrypts strategy params,
    // MPC creates the initial Enc<Mxe, VaultState>.

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
        });
        Ok(())
    }

    // ==========================================================
    // COMPUTE QUOTES — encrypted strategy + public oracle → plaintext quotes
    // ==========================================================
    // THE CORE VALUE: strategy stays hidden, only output is revealed.

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
        vault.last_rebalance_slot = slot;

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
        });
        Ok(())
    }

    // ==========================================================
    // UPDATE BALANCES — after DEX trade, update encrypted balances
    // ==========================================================

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
        });
        Ok(())
    }

    // ==========================================================
    // UPDATE STRATEGY — owner changes encrypted params
    // ==========================================================

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
        });
        Ok(())
    }

    // ==========================================================
    // REVEAL PERFORMANCE — selective disclosure of vault value
    // ==========================================================

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
        });
        Ok(())
    }

    // ==========================================================
    // DEPOSIT — user deposits quote token (USDC) into vault
    // ==========================================================

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
        let shares_to_mint = if ctx.accounts.vault.total_shares == 0 {
            amount
        } else {
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

        // Transfer quote tokens from user to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_b.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // Mint share tokens (spTokens) to user — vault PDA is the mint authority
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", authority_key.as_ref(), &[bump]]];
        token::mint_to(
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
        });
        Ok(())
    }

    // ==========================================================
    // WITHDRAW — user burns share tokens and receives quote token
    // ==========================================================

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
        token::burn(
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

        // Transfer quote tokens from vault to user — vault PDA signs
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", authority_key.as_ref(), &[bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_b.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount_out,
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
        });
        Ok(())
    }

    // ==========================================================
    // EXECUTE REBALANCE — read persisted quotes, CPI into DEX
    // ==========================================================
    // Called by a cranker after compute_quotes writes fresh quotes.
    // Currently a skeleton: validates quotes, emits event, marks consumed.
    // DEX CPI (Meteora DLMM) will be added in the integration pass.

    pub fn execute_rebalance(
        ctx: Context<ExecuteRebalance>,
        max_slippage_bps: u16,
    ) -> Result<()> {
        // Cap slippage to 5% so a malicious or buggy cranker cannot quietly
        // pass 100% and nullify the slippage protection. Institutional MM
        // strategies rarely need >2% tolerance; 5% is the safety ceiling.
        const MAX_ALLOWED_SLIPPAGE_BPS: u16 = 500;
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
        require!(age <= 150, ErrorCode::QuotesStale);

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

// ==============================================================
// ACCOUNT STATE
// ==============================================================

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub bump: u8,
    pub authority: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub token_a_vault: Pubkey,
    pub token_b_vault: Pubkey,
    pub share_mint: Pubkey,
    pub total_shares: u64,
    pub total_deposits_a: u64,
    pub total_deposits_b: u64,
    pub last_rebalance_slot: u64,
    pub state_nonce: u128,
    pub encrypted_state: [[u8; 32]; 5],
    // --- Quote persistence (AFTER encrypted_state to preserve ENCRYPTED_STATE_OFFSET) ---
    pub last_bid_price: u64,
    pub last_bid_size: u64,
    pub last_ask_price: u64,
    pub last_ask_size: u64,
    pub last_should_rebalance: u8,
    pub quotes_slot: u64,        // Slot when quotes were computed (staleness check)
    pub quotes_consumed: bool,   // True after execute_rebalance uses the quotes
    // --- NAV tracking (authoritative share-pricing basis post-trade) ---
    // Until the first reveal_performance completes, last_revealed_nav is 0
    // and deposits/withdrawals price off total_deposits_b (equivalent to NAV
    // pre-trade). After the first reveal it holds the last MPC-attested NAV.
    // deposit and withdraw keep it in sync with their deterministic deltas;
    // execute_rebalance flips nav_stale=true when the vault composition has
    // actually changed, requiring a fresh reveal before more deposits or
    // withdrawals are allowed.
    pub last_revealed_nav: u64,
    pub last_revealed_nav_slot: u64,
    pub nav_stale: bool,
}

// ==============================================================
// ACCOUNT CONTEXTS — Queue Computation
// ==============================================================

// Macro generates standard Arcium accounts (mempool, execpool, computation, etc.)
// We add vault as a custom account for callbacks

#[queue_computation_accounts("init_vault_state", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CreateVaultState<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", authority.key().as_ref()],
        bump = vault.bump,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init_if_needed, space = 9, payer = authority,
        seeds = [&SIGN_PDA_SEED], bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_VAULT_STATE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("compute_quotes", cranker)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ComputeQuotes<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    // Bind vault to its derived PDA so a caller cannot pass an arbitrary
    // Vault account that happens to deserialize. Using vault.authority as
    // the seed keeps the cranker decoupled from the authority while still
    // proving the Vault is the legitimate one for that authority.
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init_if_needed, space = 9, payer = cranker,
        seeds = [&SIGN_PDA_SEED], bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_COMPUTE_QUOTES))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("update_balances", cranker)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct UpdateBalances<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init_if_needed, space = 9, payer = cranker,
        seeds = [&SIGN_PDA_SEED], bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPDATE_BALANCES))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("update_strategy", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct UpdateStrategy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", authority.key().as_ref()],
        bump = vault.bump,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init_if_needed, space = 9, payer = authority,
        seeds = [&SIGN_PDA_SEED], bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPDATE_STRATEGY))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("reveal_performance", caller)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RevealPerformance<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init_if_needed, space = 9, payer = caller,
        seeds = [&SIGN_PDA_SEED], bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_PERFORMANCE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

// ==============================================================
// CALLBACK ACCOUNT CONTEXTS
// ==============================================================

#[callback_accounts("init_vault_state")]
#[derive(Accounts)]
pub struct InitVaultStateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_VAULT_STATE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    // Custom callback account: vault to write encrypted state into.
    // Seed binding ensures Arcium can only deliver the callback to a
    // legitimate vault PDA, not an arbitrary account that happens to
    // deserialize as Vault.
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

#[callback_accounts("compute_quotes")]
#[derive(Accounts)]
pub struct ComputeQuotesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_COMPUTE_QUOTES))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

#[callback_accounts("update_balances")]
#[derive(Accounts)]
pub struct UpdateBalancesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPDATE_BALANCES))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

#[callback_accounts("update_strategy")]
#[derive(Accounts)]
pub struct UpdateStrategyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPDATE_STRATEGY))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

#[callback_accounts("reveal_performance")]
#[derive(Accounts)]
pub struct RevealPerformanceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_PERFORMANCE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: checked by arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

// ==============================================================
// INIT COMP DEF ACCOUNT CONTEXTS
// ==============================================================

#[init_computation_definition_accounts("init_vault_state", payer)]
#[derive(Accounts)]
pub struct InitVaultStateCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: checked by arcium program
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by arcium program
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("compute_quotes", payer)]
#[derive(Accounts)]
pub struct InitComputeQuotesCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: checked by arcium program
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by arcium program
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("update_balances", payer)]
#[derive(Accounts)]
pub struct InitUpdateBalancesCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: checked by arcium program
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by arcium program
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("update_strategy", payer)]
#[derive(Accounts)]
pub struct InitUpdateStrategyCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: checked by arcium program
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by arcium program
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("reveal_performance", payer)]
#[derive(Accounts)]
pub struct InitRevealPerformanceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: checked by arcium program
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by arcium program
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ==============================================================
// NON-ARCIUM ACCOUNT CONTEXTS
// ==============================================================

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", authority.key().as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, Vault>>,
    // Token A and B mints must be distinct so that we never accidentally
    // create a "self-pair" (e.g. SOL/SOL) where deposit/withdraw arithmetic
    // would conflate the two sides.
    #[account(
        constraint = token_a_mint.key() != token_b_mint.key() @ ErrorCode::DuplicateMint,
    )]
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    // Vault token accounts must be (a) owned by the vault PDA, (b) of the
    // expected mint, AND (c) free of any side-channel that would let a
    // creator drain funds out-of-band: no delegate, no close authority.
    #[account(
        constraint = token_a_vault.mint == token_a_mint.key() @ ErrorCode::MintMismatch,
        constraint = token_a_vault.owner == vault.key() @ ErrorCode::VaultOwnerMismatch,
        constraint = token_a_vault.delegate.is_none() @ ErrorCode::InvalidVaultAccount,
        constraint = token_a_vault.close_authority.is_none() @ ErrorCode::InvalidVaultAccount,
        constraint = token_a_vault.key() != token_b_vault.key() @ ErrorCode::DuplicateMint,
    )]
    pub token_a_vault: Account<'info, TokenAccount>,
    #[account(
        constraint = token_b_vault.mint == token_b_mint.key() @ ErrorCode::MintMismatch,
        constraint = token_b_vault.owner == vault.key() @ ErrorCode::VaultOwnerMismatch,
        constraint = token_b_vault.delegate.is_none() @ ErrorCode::InvalidVaultAccount,
        constraint = token_b_vault.close_authority.is_none() @ ErrorCode::InvalidVaultAccount,
    )]
    pub token_b_vault: Account<'info, TokenAccount>,
    // Share mint must be (a) authority = vault PDA, (b) zero supply at init,
    // (c) NO freeze authority (otherwise the creator could freeze user
    // share tokens after the fact and lock LPs out of withdrawals).
    #[account(
        constraint = share_mint.mint_authority.contains(&vault.key()) @ ErrorCode::VaultOwnerMismatch,
        constraint = share_mint.supply == 0 @ ErrorCode::InvalidAmount,
        constraint = share_mint.freeze_authority.is_none() @ ErrorCode::InvalidMint,
    )]
    pub share_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        mut,
        constraint = user_token_account.mint == vault.token_b_mint @ ErrorCode::MintMismatch,
        constraint = user_token_account.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = vault.token_b_vault @ ErrorCode::VaultOwnerMismatch,
    )]
    pub vault_token_b: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = vault.share_mint @ ErrorCode::MintMismatch,
    )]
    pub share_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = user_share_account.mint == vault.share_mint @ ErrorCode::MintMismatch,
        constraint = user_share_account.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub user_share_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        mut,
        constraint = user_token_account.mint == vault.token_b_mint @ ErrorCode::MintMismatch,
        constraint = user_token_account.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = vault.token_b_vault @ ErrorCode::VaultOwnerMismatch,
    )]
    pub vault_token_b: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = vault.share_mint @ ErrorCode::MintMismatch,
    )]
    pub share_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = user_share_account.mint == vault.share_mint @ ErrorCode::MintMismatch,
        constraint = user_share_account.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub user_share_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ExecuteRebalance<'info> {
    // Authority gate: only the vault's authority (creator) can execute
    // a rebalance. Otherwise any address could call this and consume a
    // freshly-computed quote (setting quotes_consumed=true) before the
    // legitimate cranker / DEX-routing flow runs — a griefing vector
    // and, post-DEX-CPI, a sandwich vector. A future iteration can add
    // a delegated `cranker` field to the Vault for trustless cranking.
    #[account(
        mut,
        constraint = cranker.key() == vault.authority @ ErrorCode::Unauthorized,
    )]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        mut,
        address = vault.token_a_vault @ ErrorCode::VaultOwnerMismatch,
    )]
    pub vault_token_a: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = vault.token_b_vault @ ErrorCode::VaultOwnerMismatch,
    )]
    pub vault_token_b: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    // --- Meteora DLMM accounts will be added here ---
    // pub dlmm_program: ...
    // pub lb_pair: ...
    // pub bin_array_lower: ...
    // pub bin_array_upper: ...
    // etc.
}

// ==============================================================
// EVENTS
// ==============================================================

#[event]
pub struct VaultCreatedEvent {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
}

#[event]
pub struct VaultStateInitializedEvent {
    pub vault: Pubkey,
}

#[event]
pub struct QuotesComputedEvent {
    pub vault: Pubkey,
    pub bid_price: u64,
    pub bid_size: u64,
    pub ask_price: u64,
    pub ask_size: u64,
    pub should_rebalance: u8,
}

#[event]
pub struct BalancesUpdatedEvent {
    pub vault: Pubkey,
}

#[event]
pub struct StrategyUpdatedEvent {
    pub vault: Pubkey,
}

#[event]
pub struct PerformanceRevealedEvent {
    pub vault: Pubkey,
    pub total_value_in_quote: u64,
}

#[event]
pub struct DepositEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares_minted: u64,
}

#[event]
pub struct WithdrawEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_burned: u64,
    pub amount_out: u64,
}

#[event]
pub struct RebalanceExecutedEvent {
    pub vault: Pubkey,
    pub bid_price: u64,
    pub bid_size: u64,
    pub ask_price: u64,
    pub ask_size: u64,
    pub slot: u64,
}

// ==============================================================
// ERROR CODES
// ==============================================================

#[error_code]
pub enum ErrorCode {
    // --- Arcium MPC lifecycle ---
    #[msg("Arcium MPC computation was aborted by the cluster")]
    AbortedComputation,
    #[msg("Arcium cluster offset is not configured for this MXE")]
    ClusterNotSet,
    #[msg("Caller is not authorized for this vault operation")]
    Unauthorized,
    #[msg("Encrypted vault state has not been initialized — call create_vault_state first")]
    VaultNotInitialized,

    // --- Arithmetic / input validation ---
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Arithmetic overflow in vault math — inputs out of realistic range")]
    MathOverflow,
    #[msg("Insufficient quote balance on the vault for this withdrawal")]
    InsufficientBalance,
    #[msg("Share calculation resulted in zero shares; amount is too small relative to NAV")]
    ZeroShares,

    // --- SPL token constraints ---
    #[msg("Provided token mint does not match the vault's configured mint")]
    MintMismatch,
    #[msg("Vault token account owner does not match the vault PDA")]
    VaultOwnerMismatch,

    // --- Rebalance + quote lifecycle ---
    #[msg("No quotes have been computed yet — run compute_quotes first")]
    NoQuotesAvailable,
    #[msg("Quotes have already been consumed by a previous rebalance — recompute them")]
    QuotesAlreadyConsumed,
    #[msg("Quotes are stale (older than 150 slots, ~60s) — recompute before rebalancing")]
    QuotesStale,
    #[msg("MPC indicated no rebalance is needed for the current oracle price")]
    RebalanceNotNeeded,
    #[msg("Slippage tolerance exceeds the 5% ceiling (500 bps) — lower max_slippage_bps")]
    SlippageTooHigh,

    // --- NAV tracking (share pricing) ---
    #[msg("NAV is stale after a rebalance — call reveal_performance to refresh before deposit/withdraw")]
    NavStale,

    // --- Vault initialization safety ---
    #[msg("Mint is not safe for vault use (e.g. has a freeze authority)")]
    InvalidMint,
    #[msg("Vault token account is not safe (delegate or close authority is set)")]
    InvalidVaultAccount,
    #[msg("Provided mints or token accounts are duplicates of one another")]
    DuplicateMint,
}

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
