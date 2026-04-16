//! On-chain events emitted by the ShadowPool program.
//!
//! Every event carries `slot: u64` so off-chain indexers can order
//! events without fetching the surrounding transaction context. The
//! event set is the canonical interface for any frontend or analytics
//! layer subscribing to vault activity.

use anchor_lang::prelude::*;

#[event]
pub struct VaultCreatedEvent {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub slot: u64,
}

#[event]
pub struct VaultStateInitializedEvent {
    pub vault: Pubkey,
    pub slot: u64,
}

#[event]
pub struct QuotesComputedEvent {
    pub vault: Pubkey,
    pub bid_price: u64,
    pub bid_size: u64,
    pub ask_price: u64,
    pub ask_size: u64,
    pub should_rebalance: u8,
    pub slot: u64,
}

/// Emitted when `compute_quotes_callback` overwrites a still-unconsumed
/// quote. Useful for surfacing missed cranker work or competing crankers.
#[event]
pub struct QuotesOverwrittenEvent {
    pub vault: Pubkey,
    pub previous_slot: u64,
    pub previous_bid_price: u64,
    pub previous_ask_price: u64,
    pub slot: u64,
}

#[event]
pub struct BalancesUpdatedEvent {
    pub vault: Pubkey,
    pub slot: u64,
}

#[event]
pub struct StrategyUpdatedEvent {
    pub vault: Pubkey,
    pub slot: u64,
}

#[event]
pub struct PerformanceRevealedEvent {
    pub vault: Pubkey,
    pub total_value_in_quote: u64,
    pub slot: u64,
}

#[event]
pub struct DepositEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares_minted: u64,
    pub slot: u64,
}

#[event]
pub struct WithdrawEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_burned: u64,
    pub amount_out: u64,
    pub slot: u64,
}

#[event]
pub struct RebalanceExecutedEvent {
    pub vault: Pubkey,
    pub bid_price: u64,
    pub bid_size: u64,
    pub ask_price: u64,
    pub ask_size: u64,
    pub slot: u64,
}
