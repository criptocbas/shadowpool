use anchor_lang::prelude::*;
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
        vault.last_rebalance_slot = Clock::get()?.slot;

        // Emit PLAINTEXT quotes for the cranker to use for DEX execution.
        // The strategy that PRODUCED these quotes remains encrypted on-chain.
        // Note: revealed output fields are nested as field_0.field_0, field_0.field_1, etc.
        emit!(QuotesComputedEvent {
            vault: vault.key(),
            bid_price: o.field_0,       // bid_price
            bid_size: o.field_1,        // bid_size
            ask_price: o.field_2,       // ask_price
            ask_size: o.field_3,        // ask_size
            should_rebalance: o.field_4 as u8, // should_rebalance
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

        emit!(PerformanceRevealedEvent {
            vault: ctx.accounts.vault.key(),
            total_value_in_quote: total_value,
        });
        Ok(())
    }

    // ==========================================================
    // DEPOSIT — user deposits tokens into vault
    // ==========================================================

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Transfer USDC from user to vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
            },
        );
        // Note: For SPL tokens, use token::transfer instead of system_program::transfer
        // This will be properly implemented with anchor_spl::token

        // Calculate shares
        let vault = &mut ctx.accounts.vault;
        let shares_to_mint = if vault.total_shares == 0 {
            amount // First deposit: 1:1 ratio
        } else {
            amount
                .checked_mul(vault.total_shares)
                .unwrap()
                .checked_div(vault.total_deposits_b)
                .unwrap()
        };

        vault.total_shares = vault.total_shares.checked_add(shares_to_mint).unwrap();
        vault.total_deposits_b = vault.total_deposits_b.checked_add(amount).unwrap();

        // TODO: Mint spTokens to user via share_mint (vault PDA signs as mint authority)
        // anchor_spl::token::mint_to(cpi_ctx_mint, shares_to_mint)?;

        emit!(DepositEvent {
            vault: vault.key(),
            user: ctx.accounts.user.key(),
            amount,
            shares_minted: shares_to_mint,
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
    #[account(mut)]
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
    #[account(mut)]
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
    #[account(mut)]
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
    // Custom callback account: vault to write encrypted state into
    #[account(mut)]
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
    #[account(mut)]
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
    #[account(mut)]
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
    #[account(mut)]
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
    #[account(mut)]
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
    /// CHECK: token mint A
    pub token_a_mint: AccountInfo<'info>,
    /// CHECK: token mint B
    pub token_b_mint: AccountInfo<'info>,
    /// CHECK: vault ATA for token A (will be created separately)
    pub token_a_vault: AccountInfo<'info>,
    /// CHECK: vault ATA for token B
    pub token_b_vault: AccountInfo<'info>,
    /// CHECK: share mint (will be created separately)
    pub share_mint: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,
    /// CHECK: user's token account
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,
    /// CHECK: vault's token account
    #[account(mut)]
    pub vault_token_account: AccountInfo<'info>,
    /// CHECK: token program
    pub token_program: AccountInfo<'info>,
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

// ==============================================================
// ERROR CODES
// ==============================================================

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault state not initialized")]
    VaultNotInitialized,
    #[msg("Invalid amount")]
    InvalidAmount,
}
