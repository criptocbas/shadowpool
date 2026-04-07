use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // ============================================================
    // STATE TYPES — these exist only inside MPC, never as plaintext
    // ============================================================

    /// The core encrypted vault state. Stored on-chain as [[u8; 32]; 5] ciphertexts.
    /// Only the Arcium MPC cluster can read or modify these values.
    pub struct VaultState {
        pub base_balance: u64,       // Token A balance (e.g., SOL in lamports)
        pub quote_balance: u64,      // Token B balance (e.g., USDC in micro-units)
        pub spread_bps: u16,         // Market-making spread in basis points
        pub rebalance_threshold: u16, // Min price deviation (bps) to trigger rebalance
        pub last_mid_price: u64,     // Last oracle price used for computation
    }

    /// Client-encrypted strategy parameters for vault initialization and updates.
    pub struct StrategyParams {
        pub spread_bps: u16,
        pub rebalance_threshold: u16,
    }

    /// Plaintext output from compute_quotes — revealed for DEX execution.
    /// MEV bots see this AFTER computation, but can't predict the NEXT one.
    pub struct QuoteOutput {
        pub bid_price: u64,
        pub bid_size: u64,
        pub ask_price: u64,
        pub ask_size: u64,
        pub should_rebalance: u8, // 1 = yes, 0 = no
    }

    // ============================================================
    // INSTRUCTION 1: Initialize vault encrypted state
    // ============================================================
    // Called once when vault is created. Takes client-encrypted strategy
    // parameters and creates the initial Enc<Mxe, VaultState>.
    //
    // ArgBuilder pattern:
    //   .x25519_pubkey(owner_pubkey)
    //   .plaintext_u128(nonce)
    //   .encrypted_u16(spread_bps)
    //   .encrypted_u16(rebalance_threshold)
    //   .build()

    #[instruction]
    pub fn init_vault_state(
        params: Enc<Shared, StrategyParams>,
    ) -> Enc<Mxe, VaultState> {
        let p = params.to_arcis();
        Mxe::get().from_arcis(VaultState {
            base_balance: 0,
            quote_balance: 0,
            spread_bps: p.spread_bps,
            rebalance_threshold: p.rebalance_threshold,
            last_mid_price: 0,
        })
    }

    // ============================================================
    // INSTRUCTION 2: Compute quotes — THE CORE VALUE PROPOSITION
    // ============================================================
    // Takes encrypted vault state (via .account()) + public oracle price.
    // Returns PLAINTEXT quotes for DEX execution.
    // Does NOT modify state — state updates happen in update_balances.
    //
    // The strategy (spread, thresholds, balances) stays hidden.
    // Only the OUTPUT (bid/ask/sizes) becomes public.
    //
    // ArgBuilder pattern:
    //   .plaintext_u64(oracle_price)
    //   .plaintext_u64(oracle_confidence)
    //   .plaintext_u128(vault.state_nonce)
    //   .account(vault.key(), ENCRYPTED_STATE_OFFSET, ENCRYPTED_STATE_SIZE)
    //   .build()

    #[instruction]
    pub fn compute_quotes(
        state: Enc<Mxe, VaultState>,
        oracle_price: u64,
        oracle_confidence: u64,
    ) -> QuoteOutput {
        let s = state.to_arcis();

        // Widen spread when oracle confidence is low (> 1% of price)
        let confidence_multiplier: u16 = if oracle_confidence > oracle_price / 100 {
            2
        } else {
            1
        };
        let effective_spread = s.spread_bps * confidence_multiplier;

        // Compute bid/ask from encrypted spread + public oracle price
        let half_spread = oracle_price * (effective_spread as u64) / 20000;
        let bid_price = oracle_price - half_spread;
        let ask_price = oracle_price + half_spread;

        // Compute order sizes from encrypted balances
        let bid_size = if bid_price > 0 {
            s.quote_balance / bid_price
        } else {
            0u64
        };
        let ask_size = s.base_balance;

        // Determine if rebalance is needed (encrypted threshold comparison)
        let should_rebalance: u8 = if s.last_mid_price == 0 {
            1 // Always rebalance on first computation
        } else {
            let price_moved = if oracle_price > s.last_mid_price {
                oracle_price - s.last_mid_price
            } else {
                s.last_mid_price - oracle_price
            };
            let threshold_amount =
                s.last_mid_price * (s.rebalance_threshold as u64) / 10000;
            if price_moved > threshold_amount {
                1
            } else {
                0
            }
        };

        QuoteOutput {
            bid_price,
            bid_size,
            ask_price,
            ask_size,
            should_rebalance,
        }
        .reveal()
    }

    // ============================================================
    // INSTRUCTION 3: Update balances after trade execution
    // ============================================================
    // After the vault executes trades on a DEX, this updates the encrypted
    // internal balances to reflect actual token movements.
    //
    // ArgBuilder pattern:
    //   .plaintext_u64(base_received)
    //   .plaintext_u64(base_sent)
    //   .plaintext_u64(quote_received)
    //   .plaintext_u64(quote_sent)
    //   .plaintext_u128(vault.state_nonce)
    //   .account(vault.key(), ENCRYPTED_STATE_OFFSET, ENCRYPTED_STATE_SIZE)
    //   .build()

    #[instruction]
    pub fn update_balances(
        state: Enc<Mxe, VaultState>,
        base_received: u64,
        base_sent: u64,
        quote_received: u64,
        quote_sent: u64,
        new_mid_price: u64,
    ) -> Enc<Mxe, VaultState> {
        let mut s = state.to_arcis();
        s.base_balance = s.base_balance + base_received - base_sent;
        s.quote_balance = s.quote_balance + quote_received - quote_sent;
        s.last_mid_price = new_mid_price;
        state.owner.from_arcis(s)
    }

    // ============================================================
    // INSTRUCTION 4: Update strategy parameters
    // ============================================================
    // Vault owner can change spread and rebalance threshold.
    // New parameters are client-encrypted, old state is read from chain.
    //
    // ArgBuilder pattern:
    //   .x25519_pubkey(owner_pubkey)
    //   .plaintext_u128(nonce)
    //   .encrypted_u16(new_spread_bps)
    //   .encrypted_u16(new_rebalance_threshold)
    //   .plaintext_u128(vault.state_nonce)
    //   .account(vault.key(), ENCRYPTED_STATE_OFFSET, ENCRYPTED_STATE_SIZE)
    //   .build()

    #[instruction]
    pub fn update_strategy(
        state: Enc<Mxe, VaultState>,
        new_params: Enc<Shared, StrategyParams>,
    ) -> Enc<Mxe, VaultState> {
        let mut s = state.to_arcis();
        let p = new_params.to_arcis();
        s.spread_bps = p.spread_bps;
        s.rebalance_threshold = p.rebalance_threshold;
        state.owner.from_arcis(s)
    }

    // ============================================================
    // INSTRUCTION 5: Reveal vault performance (selective disclosure)
    // ============================================================
    // Returns total vault value in quote terms — for analytics and
    // share price calculation. Individual balances stay encrypted.
    //
    // ArgBuilder pattern:
    //   .plaintext_u128(vault.state_nonce)
    //   .account(vault.key(), ENCRYPTED_STATE_OFFSET, ENCRYPTED_STATE_SIZE)
    //   .build()

    #[instruction]
    pub fn reveal_performance(state: Enc<Mxe, VaultState>) -> u64 {
        let s = state.to_arcis();
        let base_value = if s.last_mid_price > 0 {
            s.base_balance * s.last_mid_price / 1_000_000
        } else {
            0u64
        };
        let total = base_value + s.quote_balance;
        total.reveal()
    }
}
