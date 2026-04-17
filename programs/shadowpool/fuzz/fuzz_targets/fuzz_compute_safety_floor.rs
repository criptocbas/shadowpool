#![no_main]
//! Fuzz target for `shadowpool_math::compute_safety_floor`.
//!
//! Verifies: floor <= expected_out always, floor=0 at max_bps=10_000,
//! Err only when max_bps > 10_000, and the arithmetic matches a
//! freshly-computed reference.

use libfuzzer_sys::fuzz_target;
use shadowpool_math::compute_safety_floor;

fuzz_target!(|data: (u64, u16)| {
    let (expected_out, max_bps) = data;

    match compute_safety_floor(expected_out, max_bps) {
        Ok(floor) => {
            // Ok only when max_bps <= 10_000.
            assert!(max_bps <= 10_000, "Ok with max_bps={} (> 10_000)", max_bps);

            // Floor is never greater than the expected output.
            assert!(
                floor <= expected_out,
                "floor ({}) > expected_out ({})",
                floor,
                expected_out
            );

            // At 10_000 bps the floor collapses to zero.
            if max_bps == 10_000 {
                assert_eq!(floor, 0, "max_bps=10_000 but floor={}", floor);
            }

            // Arithmetic equality.
            let expected_floor =
                ((expected_out as u128) * (10_000 - max_bps as u64) as u128 / 10_000) as u64;
            assert_eq!(
                floor, expected_floor,
                "arithmetic mismatch: in={} bps={} got={} want={}",
                expected_out, max_bps, floor, expected_floor
            );
        }
        Err(_) => {
            // Err only when max_bps > 10_000.
            assert!(max_bps > 10_000, "Err with max_bps={} (<= 10_000)", max_bps);
        }
    }
});
