//! # shadowpool-math
//!
//! Pure arithmetic helpers for the ShadowPool program. Zero dependencies,
//! `no_std`-compatible, no Anchor, no Solana syscalls. The functions here
//! can be unit-tested with `cargo test`, fuzz-tested with `cargo-fuzz`,
//! and reused by third-party integrators building on the ShadowPool
//! primitive.
//!
//! The three functions map one-to-one with validation stages inside
//! `programs/shadowpool/src/lib.rs`:
//!
//! - [`validate_and_normalize_price`] — Pyth Pull Oracle sanitizer +
//!   exponent normalization. Enforces positive price, bounded exponent
//!   range, and a confidence ratio ceiling; normalizes to the program's
//!   micro-USD scale via u128 checked math.
//! - [`compute_expected_amount_out`] — DLMM swap output estimator +
//!   MPC size-cap enforcer. Direction-aware (base→quote / quote→base).
//! - [`compute_safety_floor`] — MPC-anchored slippage floor for
//!   `min_amount_out`. Prevents the cranker from loosening slippage
//!   beyond the program's hard cap.
//!
//! All error paths return [`MathError`] rather than an Anchor `Error`,
//! so the crate compiles cleanly under arbitrary targets (no Anchor
//! macro expansion, no borsh, no Solana syscalls). The consuming
//! ShadowPool program translates `MathError` → `ErrorCode` at the
//! boundary.

#![no_std]

// ============================================================
// Error taxonomy
// ============================================================

/// Error variants returned by every math helper. Lifted into the
/// ShadowPool `ErrorCode` enum at the program boundary via a simple
/// `From` impl in the consumer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    /// `conf * 10_000 > |price| * MAX_CONF_BPS` — Pyth confidence
    /// exceeds the configured percentage tolerance of price.
    PriceTooUncertain,
    /// Pyth reported `price <= 0`. Legal for some derivatives, rejected
    /// for ShadowPool's spot-only vaults.
    NegativePrice,
    /// Pyth exponent outside the accepted `[-18, 0]` range.
    InvalidPriceExponent,
    /// `swap_direction` is neither 0 nor 1.
    InvalidSwapDirection,
    /// `bid_price == 0` on a `quote→base` swap (division-by-zero guard).
    ZeroBidPrice,
    /// `amount_in` exceeds the MPC-revealed size on the chosen side.
    SwapAmountExceedsMpcSize,
    /// A checked arithmetic op overflowed. Covers `checked_mul`,
    /// `checked_div`, `checked_pow`, and u128→u64 downcast failures.
    MathOverflow,
}

// ============================================================
// Constants
// ============================================================

/// Program's internal fixed-point scale for asset prices.
/// `-6` means prices are stored as micro-USD.
pub const TARGET_PRICE_EXPO: i32 = -6;

/// Bounds on accepted Pyth exponent values. Legitimate spot feeds
/// publish in `[-18, 0]`. Values outside this range are rejected.
pub const MIN_PYTH_EXPONENT: i32 = -18;
pub const MAX_PYTH_EXPONENT: i32 = 0;

/// Maximum allowed confidence interval as basis points of price.
/// 100 bps = 1%.
pub const MAX_CONF_BPS: u64 = 100;

// ============================================================
// Pyth normalization
// ============================================================

/// Validate a Pyth price + confidence + exponent tuple and normalize
/// to `TARGET_PRICE_EXPO` (-6, micro-USD).
///
/// **Validation** (in order):
/// 1. `exponent ∈ [-18, 0]`.
/// 2. `price > 0` (spot-feed-only assumption).
/// 3. `conf / |price| ≤ MAX_CONF_BPS / 10_000` (1%).
///
/// **Normalization**: multiply both price and conf by `10^(exponent - TARGET_PRICE_EXPO)`:
/// - shift > 0 → Pyth scale coarser than target → multiply.
/// - shift < 0 → Pyth scale finer than target → divide.
/// - shift = 0 → identity.
///
/// All arithmetic goes through `u128` checked ops; any overflow is
/// returned as [`MathError::MathOverflow`] rather than panicking.
pub fn validate_and_normalize_price(
    price: i64,
    conf: u64,
    exponent: i32,
) -> Result<(u64, u64), MathError> {
    if exponent < MIN_PYTH_EXPONENT || exponent > MAX_PYTH_EXPONENT {
        return Err(MathError::InvalidPriceExponent);
    }
    if price <= 0 {
        return Err(MathError::NegativePrice);
    }

    // Confidence ratio in the *native* Pyth scale — ratios are scale-
    // invariant so there's no need to normalize first.
    //   conf/price > MAX_CONF_BPS/10_000
    //   <=> conf * 10_000 > price * MAX_CONF_BPS
    let price_abs = price.unsigned_abs();
    let lhs = (conf as u128)
        .checked_mul(10_000u128)
        .ok_or(MathError::MathOverflow)?;
    let rhs = (price_abs as u128)
        .checked_mul(MAX_CONF_BPS as u128)
        .ok_or(MathError::MathOverflow)?;
    if lhs > rhs {
        return Err(MathError::PriceTooUncertain);
    }

    // Normalize via u128 checked ops.
    let shift: i32 = exponent
        .checked_sub(TARGET_PRICE_EXPO)
        .ok_or(MathError::MathOverflow)?;

    let price_u128 = price as u128;
    let conf_u128 = conf as u128;

    let (norm_price, norm_conf): (u128, u128) = if shift >= 0 {
        let mult = 10u128
            .checked_pow(shift as u32)
            .ok_or(MathError::MathOverflow)?;
        (
            price_u128.checked_mul(mult).ok_or(MathError::MathOverflow)?,
            conf_u128.checked_mul(mult).ok_or(MathError::MathOverflow)?,
        )
    } else {
        let div = 10u128
            .checked_pow((-shift) as u32)
            .ok_or(MathError::MathOverflow)?;
        (
            price_u128.checked_div(div).ok_or(MathError::MathOverflow)?,
            conf_u128.checked_div(div).ok_or(MathError::MathOverflow)?,
        )
    };

    let price_u64: u64 = norm_price.try_into().map_err(|_| MathError::MathOverflow)?;
    let conf_u64: u64 = norm_conf.try_into().map_err(|_| MathError::MathOverflow)?;

    Ok((price_u64, conf_u64))
}

// ============================================================
// DLMM expected amount_out + size cap
// ============================================================

/// Compute the expected DLMM swap output amount and enforce the MPC-
/// revealed size cap on `amount_in`.
///
/// **Directions**:
/// - `swap_direction == 0` (base→quote): `amount_in` in base-raw units.
///   Returns `amount_in * ask_price / 10^base_decimals` (quote-raw).
///   Cap: `amount_in ≤ ask_size * 10^base_decimals`.
/// - `swap_direction == 1` (quote→base): `amount_in` in quote-raw units.
///   Returns `amount_in * 10^base_decimals / bid_price` (base-raw).
///   Cap: `amount_in / bid_price ≤ bid_size`.
/// - Any other direction → [`MathError::InvalidSwapDirection`].
pub fn compute_expected_amount_out(
    swap_direction: u8,
    amount_in: u64,
    mpc_bid_price: u64,
    mpc_ask_price: u64,
    mpc_bid_size: u64,
    mpc_ask_size: u64,
    base_decimals: u8,
) -> Result<u64, MathError> {
    let base_scale: u128 = 10u128
        .checked_pow(base_decimals as u32)
        .ok_or(MathError::MathOverflow)?;

    match swap_direction {
        0 => {
            // base → quote
            let cap = (mpc_ask_size as u128)
                .checked_mul(base_scale)
                .ok_or(MathError::MathOverflow)?;
            if (amount_in as u128) > cap {
                return Err(MathError::SwapAmountExceedsMpcSize);
            }

            let out = (amount_in as u128)
                .checked_mul(mpc_ask_price as u128)
                .ok_or(MathError::MathOverflow)?
                .checked_div(base_scale)
                .ok_or(MathError::MathOverflow)?;
            out.try_into().map_err(|_| MathError::MathOverflow)
        }
        1 => {
            // quote → base
            if mpc_bid_price == 0 {
                return Err(MathError::ZeroBidPrice);
            }

            let equivalent_base = (amount_in as u128)
                .checked_div(mpc_bid_price as u128)
                .ok_or(MathError::MathOverflow)?;
            if equivalent_base > mpc_bid_size as u128 {
                return Err(MathError::SwapAmountExceedsMpcSize);
            }

            let out = (amount_in as u128)
                .checked_mul(base_scale)
                .ok_or(MathError::MathOverflow)?
                .checked_div(mpc_bid_price as u128)
                .ok_or(MathError::MathOverflow)?;
            out.try_into().map_err(|_| MathError::MathOverflow)
        }
        _ => Err(MathError::InvalidSwapDirection),
    }
}

// ============================================================
// Safety floor
// ============================================================

/// Compute the minimum acceptable DLMM swap `amount_out` given the
/// program-derived `expected_out` and the hard slippage cap.
/// `min_amount_out` supplied by the cranker must be ≥ this floor.
///
/// Formula: `expected_out * (10_000 - max_slippage_bps_ceiling) / 10_000`.
///
/// `max_slippage_bps_ceiling > 10_000` (i.e. > 100%) returns
/// [`MathError::MathOverflow`] since `10_000 - ceiling` would underflow.
pub fn compute_safety_floor(
    expected_out: u64,
    max_slippage_bps_ceiling: u16,
) -> Result<u64, MathError> {
    let safety_factor = (10_000u64)
        .checked_sub(max_slippage_bps_ceiling as u64)
        .ok_or(MathError::MathOverflow)?;
    let floor = (expected_out as u128)
        .checked_mul(safety_factor as u128)
        .ok_or(MathError::MathOverflow)?
        .checked_div(10_000u128)
        .ok_or(MathError::MathOverflow)?;
    floor.try_into().map_err(|_| MathError::MathOverflow)
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;

    // -- Pyth normalization --

    #[test]
    fn normalizes_sol_usd_at_expo_minus_8() {
        let (p, c) = validate_and_normalize_price(15_000_000_000, 5_000_000, -8).unwrap();
        assert_eq!(p, 150_000_000);
        assert_eq!(c, 50_000);
    }

    #[test]
    fn normalizes_identity_at_target_expo() {
        let (p, c) = validate_and_normalize_price(150_000_000, 500_000, -6).unwrap();
        assert_eq!(p, 150_000_000);
        assert_eq!(c, 500_000);
    }

    #[test]
    fn normalizes_coarser_by_multiplying() {
        let (p, _) = validate_and_normalize_price(1_500_000, 0, -4).unwrap();
        assert_eq!(p, 150_000_000);
    }

    #[test]
    fn rejects_zero_price() {
        assert_eq!(
            validate_and_normalize_price(0, 0, -8),
            Err(MathError::NegativePrice)
        );
    }

    #[test]
    fn rejects_negative_price() {
        assert_eq!(
            validate_and_normalize_price(-1, 0, -8),
            Err(MathError::NegativePrice)
        );
    }

    #[test]
    fn rejects_exponent_below_minus_eighteen() {
        assert_eq!(
            validate_and_normalize_price(100, 0, -19),
            Err(MathError::InvalidPriceExponent)
        );
    }

    #[test]
    fn rejects_positive_exponent() {
        assert_eq!(
            validate_and_normalize_price(100, 0, 1),
            Err(MathError::InvalidPriceExponent)
        );
    }

    #[test]
    fn rejects_conf_above_one_percent() {
        assert_eq!(
            validate_and_normalize_price(15_000_000_000, 1_500_000_001, -8),
            Err(MathError::PriceTooUncertain)
        );
    }

    #[test]
    fn accepts_conf_at_exact_boundary() {
        let (_, c) =
            validate_and_normalize_price(15_000_000_000, 150_000_000, -8).unwrap();
        assert_eq!(c, 1_500_000);
    }

    #[test]
    fn accepts_zero_confidence() {
        let (_, c) = validate_and_normalize_price(15_000_000_000, 0, -8).unwrap();
        assert_eq!(c, 0);
    }

    // -- DLMM expected_amount_out --

    #[test]
    fn base_to_quote_happy_path() {
        let out = compute_expected_amount_out(
            0,
            1_000_000_000,
            149_625_000,
            150_375_000,
            83,
            10_000,
            9,
        )
        .unwrap();
        assert_eq!(out, 150_375_000);
    }

    #[test]
    fn quote_to_base_happy_path() {
        let out = compute_expected_amount_out(
            1,
            150_000_000,
            149_625_000,
            150_375_000,
            100_000,
            0,
            9,
        )
        .unwrap();
        assert_eq!(out, 1_002_506_265);
    }

    #[test]
    fn base_to_quote_over_size_cap() {
        assert_eq!(
            compute_expected_amount_out(
                0,
                10_001 * 1_000_000_000,
                0,
                150_000_000,
                0,
                10_000,
                9
            ),
            Err(MathError::SwapAmountExceedsMpcSize)
        );
    }

    #[test]
    fn quote_to_base_over_size_cap() {
        assert_eq!(
            compute_expected_amount_out(1, 2_000_000_000, 150_000_000, 0, 10, 0, 9),
            Err(MathError::SwapAmountExceedsMpcSize)
        );
    }

    #[test]
    fn quote_to_base_zero_bid_rejects() {
        assert_eq!(
            compute_expected_amount_out(1, 100, 0, 150_000_000, 10, 10, 9),
            Err(MathError::ZeroBidPrice)
        );
    }

    #[test]
    fn invalid_direction_rejects() {
        assert_eq!(
            compute_expected_amount_out(2, 100, 100, 100, 10, 10, 9),
            Err(MathError::InvalidSwapDirection)
        );
    }

    // -- Safety floor --

    #[test]
    fn safety_floor_5_percent() {
        assert_eq!(compute_safety_floor(100_000_000, 500).unwrap(), 95_000_000);
    }

    #[test]
    fn safety_floor_zero_bps_identity() {
        assert_eq!(
            compute_safety_floor(100_000_000, 0).unwrap(),
            100_000_000
        );
    }

    #[test]
    fn safety_floor_rejects_over_hundred_percent() {
        assert_eq!(
            compute_safety_floor(100_000_000, 10_001),
            Err(MathError::MathOverflow)
        );
    }

    #[test]
    fn safety_floor_at_u64_max_no_overflow() {
        let floor = compute_safety_floor(u64::MAX, 500).unwrap();
        let expected = ((u64::MAX as u128) * 9500 / 10_000) as u64;
        assert_eq!(floor, expected);
    }
}
