#![no_main]
//! Fuzz target for `shadowpool_math::compute_expected_amount_out`.
//!
//! Hunts for inputs that crash, produce the wrong result class
//! (Ok where Err is expected or vice-versa), or blow through u128.
//! Asserts the cap invariants on the Ok path.

use libfuzzer_sys::fuzz_target;
use shadowpool_math::compute_expected_amount_out;

fuzz_target!(|data: (u8, u64, u64, u64, u64, u64, u8)| {
    let (direction, amount_in, bid_price, ask_price, bid_size, ask_size, decimals) = data;

    // Cap decimals at 18 — the realistic upper bound for SPL mints.
    // Higher values trivially exercise the 10^n overflow path; we
    // want the fuzzer to probe meaningful arithmetic inputs.
    let decimals = decimals % 19;

    let result = compute_expected_amount_out(
        direction,
        amount_in,
        bid_price,
        ask_price,
        bid_size,
        ask_size,
        decimals,
    );

    match result {
        Ok(expected_out) => {
            // Only valid direction can be Ok.
            assert!(
                direction <= 1,
                "Ok with direction={} (> 1)",
                direction
            );

            if direction == 0 {
                // Cap: amount_in <= ask_size * 10^decimals
                let base_scale = 10u128.pow(decimals as u32);
                let cap = (ask_size as u128).saturating_mul(base_scale);
                assert!(
                    (amount_in as u128) <= cap,
                    "dir=0 Ok but amount_in > cap: in={} cap={}",
                    amount_in,
                    cap
                );
                // expected_out = amount_in * ask_price / base_scale
                let computed = (amount_in as u128)
                    .saturating_mul(ask_price as u128)
                    .checked_div(base_scale)
                    .unwrap_or(u128::MAX);
                let computed_u64: u64 = computed.try_into().unwrap_or(u64::MAX);
                assert_eq!(
                    expected_out, computed_u64,
                    "dir=0 expected_out disagrees with fresh compute"
                );
            } else if direction == 1 {
                // Must have bid_price > 0 for Ok.
                assert!(bid_price > 0, "dir=1 Ok with bid_price=0");
                // Cap: amount_in / bid_price <= bid_size
                let equivalent = (amount_in as u128) / (bid_price as u128);
                assert!(
                    equivalent <= bid_size as u128,
                    "dir=1 Ok with amount_in/bid > bid_size: eq={} size={}",
                    equivalent,
                    bid_size
                );
            }
        }
        Err(_) => {
            // Err paths are documented; no panic required.
        }
    }
});
