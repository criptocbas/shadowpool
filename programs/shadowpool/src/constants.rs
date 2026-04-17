//! Named constants shared across the ShadowPool program.
//!
//! Any value used in more than one instruction (or one whose magnitude
//! carries semantic meaning — slot windows, bps ceilings, byte offsets)
//! lives here. Keep this file small: if a value is only meaningful inside
//! one instruction, leave it there with a comment instead.

use arcium_anchor::prelude::*;

// =============================================================
// Arcium computation definition offsets
// =============================================================
//
// Must exactly match the #[instruction] function names in
// `encrypted-ixs/src/lib.rs`. `comp_def_offset` is a const fn that hashes
// the circuit name at compile time.

pub const COMP_DEF_OFFSET_INIT_VAULT_STATE: u32 = comp_def_offset("init_vault_state");
pub const COMP_DEF_OFFSET_COMPUTE_QUOTES: u32 = comp_def_offset("compute_quotes");
pub const COMP_DEF_OFFSET_UPDATE_BALANCES: u32 = comp_def_offset("update_balances");
pub const COMP_DEF_OFFSET_UPDATE_STRATEGY: u32 = comp_def_offset("update_strategy");
pub const COMP_DEF_OFFSET_REVEAL_PERFORMANCE: u32 = comp_def_offset("reveal_performance");

// =============================================================
// Vault account byte layout — MPC read contract
// =============================================================
//
// The MPC cluster reads encrypted vault state directly from the Vault
// account's raw bytes via `.account(pubkey, offset, size)` in
// ArgBuilder. That read must stay stable across program upgrades:
// changing the struct layout without updating these constants silently
// corrupts every MPC computation against existing vaults.
//
// The invariant is pinned by the `encrypted_state_offset_matches_vault_preamble`
// test at the bottom of `lib.rs`.
//
// Layout:
//   8   — Anchor discriminator
//   1   — bump
//   32  — authority
//   32  — token_a_mint
//   32  — token_b_mint
//   32  — token_a_vault
//   32  — token_b_vault
//   32  — share_mint
//   8   — total_shares
//   8   — total_deposits_a
//   8   — total_deposits_b
//   8   — last_rebalance_slot
//   16  — state_nonce
//   = 249 bytes before `encrypted_state: [[u8; 32]; 5]`

pub const ENCRYPTED_STATE_OFFSET: u32 = 249;
pub const ENCRYPTED_STATE_SIZE: u32 = 32 * 5; // 5 ciphertexts x 32 bytes

// =============================================================
// Rebalance / quote lifecycle
// =============================================================

/// Quotes older than this (in slots) cannot drive an execute_rebalance.
/// 150 slots ≈ 60 seconds at Solana's ~400ms/slot target.
pub const QUOTE_STALENESS_SLOTS: u64 = 150;

/// Hard ceiling on caller-supplied slippage tolerance. Bounds the
/// damage a buggy or malicious cranker can do. 500 bps = 5%.
pub const MAX_ALLOWED_SLIPPAGE_BPS: u16 = 500;

// =============================================================
// Pyth oracle integration
// =============================================================

/// Program's internal fixed-point scale for asset prices. `-6` means
/// prices are stored as micro-USD (matching USDC's 6 decimals), so
/// `150_000_000` represents $150.000000. The Pyth reader normalises
/// every feed into this scale regardless of the feed's native exponent.
pub const TARGET_PRICE_EXPO: i32 = -6;

/// Bounds on accepted Pyth exponent values. Feeds carry `expo: i32`;
/// legitimate spot feeds publish in `[-18, 0]` (Pyth's documented
/// range). Values outside this range are treated as corrupted or
/// malicious and cause `InvalidPriceExponent`.
pub const MIN_PYTH_EXPONENT: i32 = -18;
pub const MAX_PYTH_EXPONENT: i32 = 0;

/// Maximum allowed confidence interval, expressed as basis points of
/// the absolute price. `100` bps = 1% — the industry-standard Pyth
/// threshold (Sherlock-audit default; conservative for major pairs
/// like SOL/USD). Reject if `conf/|price| > MAX_CONF_BPS/10_000`.
/// Tighten toward 50 bps (0.5%) post-launch if feed quality allows.
pub const MAX_CONF_BPS: u64 = 100;
