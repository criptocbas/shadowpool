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

        // Widen spread when oracle confidence is low (> 1% of price).
        //
        // Arcis note: both branches of if/else always execute in MPC, so the
        // multiplier is a straight select. No division-by-zero risk here.
        let confidence_multiplier: u16 = if oracle_confidence > oracle_price / 100 {
            2
        } else {
            1
        };
        // Bound effective spread to 9999 bps (<100%) so half_spread stays below
        // oracle_price and bid_price cannot underflow. u16 * 2 fits in u16 up
        // to 32767; we clamp to 9999 defensively.
        let raw_spread = (s.spread_bps as u32) * (confidence_multiplier as u32);
        let effective_spread: u32 = if raw_spread > 9999 { 9999 } else { raw_spread };

        // Compute bid/ask from encrypted spread + public oracle price.
        // u128 intermediate prevents overflow for large oracle prices.
        let half_spread =
            (((oracle_price as u128) * (effective_spread as u128)) / 20000u128) as u64;
        // effective_spread <= 9999 guarantees half_spread < oracle_price/2,
        // so bid_price cannot underflow and ask_price won't overflow for any
        // oracle_price <= u64::MAX/2 (which covers any realistic asset price).
        let bid_price = oracle_price - half_spread;
        let ask_price = oracle_price + half_spread;

        // Compute order sizes from encrypted balances.
        //
        // Arcis safe-divisor pattern: both branches of the if/else run in MPC.
        // Dividing by a secret zero is undefined behaviour (garbage output).
        // We must ensure the division operand is never zero, then select the
        // result afterwards. See the official arcium skill, Pattern #13.
        let bid_valid = bid_price != 0;
        let safe_bid_divisor = if bid_valid { bid_price } else { 1 };
        let bid_size_candidate = s.quote_balance / safe_bid_divisor;
        let bid_size = if bid_valid { bid_size_candidate } else { 0 };
        let ask_size = s.base_balance;

        // Determine if rebalance is needed (encrypted threshold comparison).
        // u128 intermediate for the threshold_amount multiplication.
        let should_rebalance: u8 = if s.last_mid_price == 0 {
            1 // Always rebalance on first computation
        } else {
            let price_moved = if oracle_price > s.last_mid_price {
                oracle_price - s.last_mid_price
            } else {
                s.last_mid_price - oracle_price
            };
            let threshold_amount = (((s.last_mid_price as u128)
                * (s.rebalance_threshold as u128))
                / 10000u128) as u64;
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

        // Apply deltas with u128 intermediates + saturating semantics so a
        // malformed caller cannot underflow the encrypted balance. Both
        // branches of every if/else run in MPC, so we use the select-after
        // -compute pattern (never compute a subtraction that would wrap).
        //
        // Real execution should never hit the clamp — the cranker is expected
        // to pass deltas consistent with what was actually traded. The clamp
        // is a safety net against corrupted inputs.

        let base_available = (s.base_balance as u128) + (base_received as u128);
        let base_sent_u = base_sent as u128;
        let base_sent_clamped = if base_sent_u > base_available {
            base_available
        } else {
            base_sent_u
        };
        s.base_balance = (base_available - base_sent_clamped) as u64;

        let quote_available = (s.quote_balance as u128) + (quote_received as u128);
        let quote_sent_u = quote_sent as u128;
        let quote_sent_clamped = if quote_sent_u > quote_available {
            quote_available
        } else {
            quote_sent_u
        };
        s.quote_balance = (quote_available - quote_sent_clamped) as u64;

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

        // Convert base holdings into quote-denominated value at the last mid
        // price. Use u128 throughout: base_balance * last_mid_price can
        // exceed u64::MAX for large vaults with high-priced assets
        // (e.g. 10M SOL * $1000 * 10^6 scale = 10^25), and the division by
        // 1_000_000 is exact at u128.
        //
        // Arcis note: both branches of the if/else run in MPC anyway, so the
        // guard on last_mid_price == 0 is purely a selector.
        let base_value_u128 =
            ((s.base_balance as u128) * (s.last_mid_price as u128)) / 1_000_000u128;
        let base_value: u64 = if s.last_mid_price > 0 {
            base_value_u128 as u64
        } else {
            0
        };

        // Total can overflow u64 for degenerate inputs; u128 + downcast is
        // safe as long as the sum doesn't exceed u64::MAX (which holds for
        // any realistic vault).
        let total = ((base_value as u128) + (s.quote_balance as u128)) as u64;
        total.reveal()
    }
}

// ==============================================================
// UNIT TESTS — pure math, no MPC context required
// ==============================================================
//
// Arcis #[instruction] functions take Enc<_, _> inputs that can't be
// constructed outside the MPC runtime, so we re-express the core arithmetic
// of each circuit as a plain function and test those. If these tests pass
// and the circuit body stays equivalent to them, the circuit's algorithmic
// behaviour is also correct. Any divergence between these helpers and the
// circuit bodies is itself a review signal.

#[cfg(test)]
mod tests {
    // ---- compute_quotes helpers ----

    /// Matches the effective_spread clamp in compute_quotes.
    fn clamp_effective_spread(spread_bps: u16, conf_multiplier: u16) -> u32 {
        let raw = (spread_bps as u32) * (conf_multiplier as u32);
        if raw > 9999 { 9999 } else { raw }
    }

    /// Matches the half_spread calculation in compute_quotes.
    fn half_spread(oracle_price: u64, effective_spread_bps: u32) -> u64 {
        (((oracle_price as u128) * (effective_spread_bps as u128)) / 20000u128) as u64
    }

    /// Matches the Arcis safe-divisor bid_size pattern.
    fn bid_size(quote_balance: u64, bid_price: u64) -> u64 {
        let valid = bid_price != 0;
        let safe = if valid { bid_price } else { 1 };
        let cand = quote_balance / safe;
        if valid { cand } else { 0 }
    }

    #[test]
    fn half_spread_fifty_bps_on_150_usdc_is_375_000() {
        // Oracle: $150.000000 in 6-decimal micro-USDC
        // 150_000_000 * 50 / 20000 = 375_000 (half of 0.5% spread)
        assert_eq!(half_spread(150_000_000, 50), 375_000);
    }

    #[test]
    fn half_spread_clamps_at_9999_bps_regardless_of_multiplier() {
        // Even with a 10000-bps spread and 2x multiplier (= 20000 raw),
        // the clamp prevents effective_spread from exceeding 9999.
        assert_eq!(clamp_effective_spread(10_000, 2), 9999);
        // Which caps half_spread at less than half the oracle price:
        let hs = half_spread(150_000_000, 9999);
        assert!(hs < 150_000_000 / 2);
        // Specifically: 9999 * 150_000_000 / 20000 = 74_992_500
        assert_eq!(hs, 74_992_500);
    }

    #[test]
    fn bid_ask_symmetric_around_oracle() {
        let oracle = 150_000_000u64;
        let hs = half_spread(oracle, 50);
        let bid = oracle - hs;
        let ask = oracle + hs;
        assert_eq!(bid, 149_625_000);
        assert_eq!(ask, 150_375_000);
        assert_eq!(ask - oracle, oracle - bid);
    }

    #[test]
    fn bid_size_with_zero_price_is_zero_not_undefined() {
        // This is the critical safe-divisor test: the previous
        // `if bid_price > 0 { q / bp }` would have invoked the division
        // on the false branch in MPC, producing undefined output.
        assert_eq!(bid_size(1_500_000_000, 0), 0);
    }

    #[test]
    fn bid_size_with_nonzero_price_divides_correctly() {
        // 1_500_000_000 micro-USDC / 149_625_000 micro-USDC-per-SOL ≈ 10 SOL
        // (integer division truncates — exact on these inputs)
        assert_eq!(bid_size(1_500_000_000, 149_625_000), 10);
    }

    // ---- update_balances helpers ----

    /// Mirrors the saturating-subtraction delta semantics.
    fn apply_delta(balance: u64, received: u64, sent: u64) -> u64 {
        let available = (balance as u128) + (received as u128);
        let clamped = if (sent as u128) > available { available } else { sent as u128 };
        (available - clamped) as u64
    }

    #[test]
    fn balance_update_adds_received_and_subtracts_sent() {
        // 1000 base + 500 received - 200 sent = 1300
        assert_eq!(apply_delta(1000, 500, 200), 1300);
    }

    #[test]
    fn balance_update_saturates_at_zero_on_underflow() {
        // A corrupt cranker passing sent > available must not underflow.
        assert_eq!(apply_delta(100, 50, 200), 0);
    }

    #[test]
    fn balance_update_handles_zero_flows() {
        assert_eq!(apply_delta(1000, 0, 0), 1000);
    }

    // ---- reveal_performance helpers ----

    /// Mirrors the u128-widening NAV computation.
    fn total_value(base_balance: u64, last_mid_price: u64, quote_balance: u64) -> u64 {
        let base_value =
            ((base_balance as u128) * (last_mid_price as u128)) / 1_000_000u128;
        let bv = if last_mid_price > 0 { base_value as u64 } else { 0 };
        ((bv as u128) + (quote_balance as u128)) as u64
    }

    // NAV scaling convention: the circuit uses /1_000_000 on base * price.
    // This treats (base_balance, last_mid_price) as sharing a micro-unit
    // scale — e.g. base in 6-decimal units and price in micro-USD per base
    // unit. Units are consistent as long as callers use the same convention
    // on both sides. The tests below assert the arithmetic against that
    // convention; separate work tracks whether base should also expose a
    // native-decimals scaling helper.

    #[test]
    fn total_value_pre_first_price_is_quote_only() {
        // last_mid_price = 0 means the base_value path contributes nothing.
        assert_eq!(total_value(10_000_000_000, 0, 500_000_000), 500_000_000);
    }

    #[test]
    fn total_value_combines_base_at_price_plus_quote() {
        // Under the circuit's convention (divide by 10^6):
        //   base_balance * last_mid_price / 10^6
        //   = 10_000_000_000 * 150_000_000 / 1_000_000
        //   = 1_500_000_000_000
        // Plus quote 1_500_000_000 = 1_501_500_000_000 total.
        assert_eq!(
            total_value(10_000_000_000, 150_000_000, 1_500_000_000),
            1_501_500_000_000
        );
    }

    #[test]
    fn total_value_u128_widening_prevents_overflow_on_large_vaults() {
        // A 10T-lamport vault at 200-micro-USD mid price — direct u64
        // multiplication base_balance * last_mid_price = 10^13 * 2*10^8 = 2*10^21
        // which overflows u64 (max ~1.8*10^19). The u128 widening in
        // total_value prevents silent corruption and downcasts safely
        // because after /10^6 the result (2*10^15) still fits in u64.
        let v = total_value(10_000_000_000_000, 200_000_000, 0);
        assert_eq!(v, 2_000_000_000_000_000);
    }
}

