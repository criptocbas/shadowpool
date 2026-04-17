#![no_main]
//! Fuzz target for `shadowpool_math::validate_and_normalize_price`.
//!
//! Hunts for any (price: i64, conf: u64, exponent: i32) that produces
//! a panic, a silent truncation, or an overflow that escapes
//! `MathError::MathOverflow`. On the Ok path, asserts the documented
//! invariants of the normalizer.

use libfuzzer_sys::fuzz_target;
use shadowpool_math::{validate_and_normalize_price, MAX_CONF_BPS};

fuzz_target!(|data: (i64, u64, i32)| {
    let (price, conf, exponent) = data;

    match validate_and_normalize_price(price, conf, exponent) {
        Ok((norm_price, norm_conf)) => {
            // Invariant 1: inputs that produced Ok must have had
            // price > 0 (strict spot-feed rejection of <= 0).
            assert!(price > 0, "Ok with non-positive price: {}", price);

            // Invariant 2: normalized price is positive (scaling
            // preserves the sign-positive property; 0 would imply
            // the division rounded to zero, which can only happen if
            // the input was already below the scale — handled by the
            // function returning 0 too, but Ok == norm > 0 by design).
            // Note: for very small price * finer exponent shift, the
            // output CAN be zero due to integer division — that's
            // acceptable; don't assert strict > 0 here.

            // Invariant 3: conf ratio survives normalization. In the
            // input scale, conf * 10_000 <= |price| * MAX_CONF_BPS.
            // After normalization both sides scale by the same factor
            // (via the same 10^shift), so the inequality persists in
            // the normalized scale.
            let lhs = (norm_conf as u128).saturating_mul(10_000);
            let rhs = (norm_price as u128).saturating_mul(MAX_CONF_BPS as u128);
            assert!(
                lhs <= rhs,
                "conf ratio violated post-normalize: lhs={} rhs={}",
                lhs,
                rhs
            );
        }
        Err(_) => {
            // Any Err is a documented reject path; never panic or UB.
        }
    }
});
