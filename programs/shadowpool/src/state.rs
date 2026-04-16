//! Program state (on-chain accounts owned by ShadowPool).

use anchor_lang::prelude::*;

/// The vault account.
///
/// **Byte layout is load-bearing.** The MPC cluster reads encrypted state
/// directly from this account's raw bytes at
/// `constants::ENCRYPTED_STATE_OFFSET` (249) via `.account(...)` in
/// ArgBuilder. Do not reorder fields above `encrypted_state` without
/// updating both the constant and the invariant test in `lib.rs`.
///
/// Field groups, in order:
/// 1. Identity (`bump`, `authority`, mint/vault/share pubkeys).
/// 2. Bookkeeping counters (`total_shares`, `total_deposits_*`, slot).
/// 3. MPC state nonce + `encrypted_state` ciphertexts.
/// 4. Quote persistence (plaintext after MPC reveal; appended after
///    `encrypted_state` to preserve the offset).
/// 5. NAV tracking (authoritative share-pricing basis post-trade).
/// 6. Authorization (the `cranker` pubkey allowed to drive the MPC
///    rebalance flow; defaults to `authority` at init so the legacy
///    authority-only flow keeps working, with a future `set_cranker`
///    instruction unlocking delegated/trustless cranking).
#[account]
#[derive(InitSpace)]
pub struct Vault {
    // --- Identity ---
    pub bump: u8,
    pub authority: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub token_a_vault: Pubkey,
    pub token_b_vault: Pubkey,
    pub share_mint: Pubkey,

    // --- Bookkeeping ---
    pub total_shares: u64,
    /// Reserved for future base-side deposits. Not written today (deposits
    /// are quote-only by design). Kept in the preamble so that enabling
    /// base-side deposits later does not shift `ENCRYPTED_STATE_OFFSET`.
    pub total_deposits_a: u64,
    pub total_deposits_b: u64,
    /// Slot when the most recent `execute_rebalance` executed. Written
    /// only by `execute_rebalance`; `compute_quotes_callback` tracks its
    /// own slot separately in `quotes_slot` below.
    pub last_rebalance_slot: u64,

    // --- MPC state (read directly by the Arcium cluster; see note above) ---
    pub state_nonce: u128,
    pub encrypted_state: [[u8; 32]; 5],

    // --- Quote persistence (appended after encrypted_state so adding fields
    //     here never shifts the MPC read offset) ---
    pub last_bid_price: u64,
    pub last_bid_size: u64,
    pub last_ask_price: u64,
    pub last_ask_size: u64,
    pub last_should_rebalance: u8,
    /// Slot when quotes were computed; used for staleness check in
    /// `execute_rebalance`.
    pub quotes_slot: u64,
    /// True once `execute_rebalance` consumes the quotes. Prevents replay
    /// of the same quote cycle.
    pub quotes_consumed: bool,

    // --- NAV tracking (authoritative share-pricing basis) ---
    //
    // Until the first reveal_performance completes, last_revealed_nav is 0
    // and deposit/withdraw price off total_deposits_b (equivalent to NAV
    // pre-trade). After the first reveal it holds the last MPC-attested NAV.
    // deposit and withdraw keep it in sync with their deterministic deltas;
    // execute_rebalance flips nav_stale=true when the vault composition has
    // actually changed, requiring a fresh reveal before more deposits or
    // withdrawals are allowed.
    pub last_revealed_nav: u64,
    pub last_revealed_nav_slot: u64,
    pub nav_stale: bool,

    // --- Authorization ---
    //
    // Identity allowed to drive MPC-side rebalance work: compute_quotes,
    // update_balances, and execute_rebalance. Defaults to `authority` at
    // init (so a fresh vault behaves exactly like the pre-cranker flow),
    // but is a separate field so a future `set_cranker` instruction can
    // promote it to a delegated/trustless cranker without reassigning
    // the vault's owning authority. Appended at the end of the struct so
    // adding this field does not shift any prior offset (in particular
    // `ENCRYPTED_STATE_OFFSET = 249` stays correct).
    pub cranker: Pubkey,
}
