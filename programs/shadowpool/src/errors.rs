//! Program error codes.
//!
//! Each variant carries a complete user-facing sentence via `#[msg(...)]`.
//! Codes are grouped by concern for easier scanning; Anchor auto-assigns
//! stable numeric codes starting at 6000 in declaration order, so keep
//! the order append-only when adding new variants.

use anchor_lang::prelude::*;

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

    // --- NAV basis degenerate state ---
    #[msg("NAV basis is zero while shares are outstanding — recover with reveal_performance")]
    ZeroNavBasis,
}
