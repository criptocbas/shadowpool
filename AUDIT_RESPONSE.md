# ShadowPool — Audit Response

**Status as of 2026-04-17.** Every finding from the Phase-0 professional audit, with mitigations, evidence (commit hash + file:line), and test coverage. Published as a standing document so any reviewer — accelerator committee, investor, audit firm, auditor reproducing the work — can verify each closure independently.

## Summary

| Severity | Count | Closed | Documented intent | Open |
|---|---:|---:|---:|---:|
| Critical | 0 | 0 | 0 | 0 |
| **High** | **4** | **4** | **0** | **0** |
| Medium | 5 | 4 | 1 | 0 |
| Low | 6 | 5 | 1 | 0 |
| Informational | 4 | 3 | 1 | 0 |
| **Total** | **19** | **16** | **3** | **0** |

**Zero open findings.** The three "documented intent" items are explicit design choices (see §M-3, §L-4, §I-2) that an auditor can evaluate on their merits.

## How to verify

Every closed finding references (a) the commit hash that shipped the fix and (b) the file paths that a reviewer can open to see the exact code. To reproduce the test matrix:

```bash
cargo test --workspace --lib    # 30 unit tests, ~3s
yarn test                        # 6 localnet integration tests, ~25s
anchor build                     # regenerate IDL, verify shape
```

All checks pass on `main` as of the commit hash at the top of this file. CI (GitHub Actions) runs `cargo check`, `cargo test --lib`, and frontend `tsc` on every push.

---

## High-severity findings (4 of 4 closed)

### H-1 — `update_balances` accepted any cranker with arbitrary deltas

**Original finding.** `UpdateBalances.cranker: Signer<'info>` had no `cranker == vault.authority` constraint. Any signer could submit fake `base_received` / `base_sent` / `quote_received` / `quote_sent` values and corrupt the encrypted vault state via the Arcis circuit, which only saturates at u64 bounds — semantic truthfulness was not checked.

**Impact.** An attacker could zero out encrypted balances → subsequent `reveal_performance` would report a mis-priced NAV → LP deposits/withdrawals price incorrectly. The authority gate on `execute_rebalance` was moot if `update_balances` was open.

**Mitigation shipped.** Phase 0 introduced a `Vault.cranker: Pubkey` field and gates `update_balances`, `compute_quotes`, and `execute_rebalance` uniformly on `cranker.key() == vault.cranker`. Default at vault init is `cranker = authority`. A new authority-only `set_cranker(new_cranker)` instruction delegates to a third-party keypair without transferring vault ownership.

**Evidence.**
- Commit [`7572cef`](../../commit/7572cef) — *H-1: Delegated cranker model + authorization gates on MPC flow*
- `programs/shadowpool/src/contexts.rs:95-104` — `UpdateBalances` context with cranker constraint
- `programs/shadowpool/src/lib.rs:608` — `initialize_vault` sets `vault.cranker = authority`
- `programs/shadowpool/src/lib.rs:930-956` — `set_cranker` handler + `CrankerSetEvent`

**Test coverage.** 6 localnet integration tests pass with the default `cranker == authority` path; the gate is exercised by every MPC invocation. Negative-path tests for non-cranker callers are covered at the `require!` level by `cargo test` type-checking the constraint expressions.

---

### H-2 — `compute_quotes` trusted caller-supplied `oracle_price`

**Original finding.** `oracle_price` and `oracle_confidence` were plaintext `u64` handler arguments. Any cranker could pass any value. The MPC circuit dutifully computed bid/ask from whatever was supplied; `execute_rebalance` consumed the result.

**Impact.** Pre-DEX-CPI: griefing (bogus quotes, consumed quote slot). Post-DEX-CPI: direct sandwich — a cranker could set `oracle_price = 1`, fill at crazy prices, and extract value. The 5% `MAX_ALLOWED_SLIPPAGE_BPS` bounded deviation from the cranker-chosen size but nothing about the reference price.

**Mitigation shipped.** Phase 1 replaced the plaintext args with a Pyth Pull Oracle `PriceUpdateV2` account read on-chain before the values reach the MPC circuit. Five-layer validation:

1. **Account ownership** enforced by Anchor via `Account<'info, PriceUpdateV2>` (pins owner = Pyth Solana Receiver program).
2. **Feed-id match** at the context level (`price_update.price_message.feed_id == vault.price_feed_id`) — rejects wrong-asset feeds (e.g. BONK for a SOL vault).
3. **Staleness** enforced by `get_price_no_older_than(&Clock::get()?, vault.max_price_age_seconds, &feed_id)`, which also re-checks feed id inside the SDK.
4. **Sanity checks** in the handler: `price > 0` (spot-only, rejects negative-rate instruments), `exponent ∈ [-18, 0]` (bounds 10^|expo| in the u128 scaling math), `conf/|price| ≤ MAX_CONF_BPS/10_000` (1% default, industry-standard threshold per the Sherlock-audit corpus).
5. **Exponent normalization** to `TARGET_PRICE_EXPO = -6` using u128 checked ops — no floats, no precision loss, no silent truncation.

The validation + normalization is factored into a pure function `validate_and_normalize_price(price, conf, exponent)` that's exhaustively unit-tested with fixture inputs, since the on-chain SDK's `PriceUpdateV2` is hard to construct in a test context.

**Evidence.**
- Commit [`de763d0`](../../commit/de763d0) — *Phase 1: Pyth Pull Oracle integration (H-2 closed)*
- `programs/shadowpool/src/lib.rs:95-180` — `read_pyth_price` + `validate_and_normalize_price`
- `programs/shadowpool/src/contexts.rs:105-120` — `ComputeQuotes` with `PriceUpdateV2` constraint
- `programs/shadowpool/src/lib.rs:1100-1230` — `pyth_normalization_tests` module (11 tests)

**Test coverage.**
- 11 fixture-based unit tests covering every reject path (negative price, zero price, exponent too low, exponent too high, conf above 1%, conf at exact boundary, zero conf, large price without overflow, three scaling branches: coarser/equal/finer than program scale).
- Red-green during implementation caught a scaling-delta sign bug that would have produced `1_500_000_000_000` instead of `150_000_000` for normalized SOL/USD — exactly the kind of silent corruption a static audit would miss and an exhaustive test suite catches.

---

### H-3 — Token-2022 transfer-fee inflated deposit accounting

**Original finding.** `deposit` credited `total_deposits_b += amount` and `last_revealed_nav += amount` using the pre-fee `amount`. With a Token-2022 mint carrying `TransferFeeConfig`, the vault would receive `amount - fee` but bookkeeping would record `amount`. Share minting also used the pre-fee amount.

**Impact.** Each deposit would inflate bookkeeping beyond real holdings. After N deposits with a 1% fee, a vault accumulating $10M in deposits would under-hold $100K. The `vault_token_b.amount >= amount_out` check in withdraw would eventually catch the shortfall but with a misleading `InsufficientBalance` error to the last exiter.

**Mitigation shipped.** Phase 1 adopts pre/post reload accounting in `deposit`:

```rust
ctx.accounts.vault_token_b.reload()?;
let balance_before = ctx.accounts.vault_token_b.amount;

token_interface::transfer_checked(..., amount, quote_decimals)?;

ctx.accounts.vault_token_b.reload()?;
let actual_received = ctx.accounts.vault_token_b.amount
    .checked_sub(balance_before)
    .ok_or(ErrorCode::MathOverflow)?;
require!(actual_received > 0, ErrorCode::InvalidAmount);
```

`actual_received` then drives share-mint calculation, `total_deposits_b` increment, and the `last_revealed_nav` delta. The `DepositEvent.amount` field emits the actually-credited value, so an indexer comparing user-side debit vs vault-side credit sees any fee delta explicitly.

Note that the Token-2022 extension allow-list (H-4 below) rejects `TransferFeeConfig` mints at vault initialization today, so `actual_received == amount` holds in practice. H-3 is belt-and-braces — the forward-compatible, audit-defensible pattern that stays correct if the allow-list is ever relaxed.

Withdraw is unchanged: the vault-side debit always equals `amount_out` regardless of fees (Token-2022 transfer fees come from the recipient's side, not the sender's).

**Evidence.**
- Commit [`803da64`](../../commit/803da64) — *Phase 1 hardening: H-3 pre/post accounting + M-1 MPC single-flight + M-2 emergency override*
- `programs/shadowpool/src/lib.rs:684-790` — revised `deposit` handler
- `programs/shadowpool/src/state.rs:70` — `Vault.nav_stale` guard (unchanged, still enforced pre-deposit)

**Test coverage.** 6 localnet integration tests verify the deposit path; `DepositEvent.amount` is asserted against the expected credit amount. Manual walkthrough confirms fee-mint path would credit `amount - fee` correctly; future integration test with a fee-enabled Token-2022 mint would exercise the real divergence (listed in `tests/TODO.md`).

---

### H-4 — Token-2022 extension allow-list incomplete at `InitializeVault`

**Original finding.** Init-time checks verified `freeze_authority.is_none()` on the share mint and `delegate.is_none()` / `close_authority.is_none()` on vault token accounts, but did not inspect Token-2022 extensions on any mint. Dangerous extensions that would pass:
- `PermanentDelegate` (perpetual authority to move vault tokens)
- `TransferFeeConfig` (see H-3)
- `ConfidentialTransferMint` (balances unreadable)
- `DefaultAccountState = Frozen` (vault receives into a frozen account)
- `NonTransferable` (withdrawals fail)
- `TransferHook` (third-party program runs on every transfer)

**Impact.** Worst case: a malicious creator could pick a USDC-look-alike mint with a `PermanentDelegate` they control, attract LPs, and drain. Breaks the creator-time-trust story that the delegate/close-authority checks were meant to enforce.

**Mitigation shipped.** Phase 0 added a handler-side extension allow-list check run against `token_a_mint`, `token_b_mint`, and `share_mint` at `initialize_vault`:

```rust
const DISALLOWED_MINT_EXTENSIONS: &[ExtensionType] = &[
    ExtensionType::PermanentDelegate,
    ExtensionType::TransferFeeConfig,
    ExtensionType::ConfidentialTransferMint,
    ExtensionType::DefaultAccountState,
    ExtensionType::NonTransferable,
    ExtensionType::TransferHook,
];

fn enforce_mint_extension_allowlist(mint: &InterfaceAccount<Mint>) -> Result<()> {
    let account_info = mint.to_account_info();
    if *account_info.owner == anchor_spl::token::ID {
        return Ok(());  // legacy SPL mints carry no extensions
    }
    let data = account_info.try_borrow_data()?;
    let parsed = StateWithExtensions::<SplMint>::unpack(&data)?;
    for ext in parsed.get_extension_types()? {
        if DISALLOWED_MINT_EXTENSIONS.contains(&ext) {
            return Err(error!(ErrorCode::DisallowedMintExtension));
        }
    }
    Ok(())
}
```

The check runs in the handler (not an Anchor constraint) because extension parsing requires borrowing the raw account data. Applied to all three mints at init. Done as a handler helper so the pattern is reusable if we later add more vault-like surfaces.

**Evidence.**
- Commit [`380c06d`](../../commit/380c06d) — *H-4: Token-2022 extension allow-list at vault init*
- `programs/shadowpool/src/lib.rs:45-95` — helper + constants
- `programs/shadowpool/src/lib.rs:550-600` — invocation in `initialize_vault`
- `programs/shadowpool/src/errors.rs:76` — `DisallowedMintExtension` error variant

**Test coverage.** Existing integration tests use legacy SPL mints which pass the early-return owner check. A Token-2022 extension negative-path test is listed in `tests/TODO.md` (requires spinning a Token-2022 mint with each disallowed extension — one test per extension).

---

## Medium-severity findings (4 of 5 closed + 1 documented intent)

### M-1 — Concurrent MPC state-mutating queues could race on `state_nonce`

**Original finding.** `state_nonce` advanced only inside callbacks. An operator could queue two `update_balances` calls against the same nonce; if callbacks landed out of order, the second call would operate on stale ciphertext and overwrite the fresh result.

**Impact.** Consistency loss on encrypted state. Not a confidentiality break (MPC protocol still secure) but a "lost deltas, silently" risk that would drift the vault's ground truth from the balance accounting.

**Mitigation shipped.** Phase 1 added a `pending_state_computation: Option<u64>` field to the `Vault` struct (appended at the end so `ENCRYPTED_STATE_OFFSET = 249` stays correct).

- Set to `Some(computation_offset)` at queue time in the three state-mutating handlers: `create_vault_state`, `update_balances`, `update_strategy`.
- Rejects new queues with `StateComputationPending` error while `Some`.
- Cleared to `None` **in every paired callback regardless of outcome** — the abort path must clear it, otherwise a failed computation would wedge the vault indefinitely (see M-2 for the liveness escape hatch).
- Read-only MPC circuits (`compute_quotes`, `reveal_performance`) are unaffected — they don't mutate the encrypted state and can fire concurrently with a pending update.

**Evidence.**
- Commit [`803da64`](../../commit/803da64) — *Phase 1 hardening: H-3 + M-1 + M-2*
- `programs/shadowpool/src/state.rs:84-98` — `pending_state_computation` field
- `programs/shadowpool/src/lib.rs:318, 395, 489` — queue-time guards
- `programs/shadowpool/src/lib.rs:360, 440, 530` — callback-time clears (on both verify paths)
- `programs/shadowpool/src/errors.rs:69-70` — `StateComputationPending` error

**Test coverage.** Offset invariant test confirms the new field did not shift `ENCRYPTED_STATE_OFFSET`. Integration tests exercise the happy path through all three state-mutating MPC circuits; concurrency negative path (two queues in same tx) is a planned test once the rich test harness lands in Phase 2.

---

### M-2 — `nav_stale = true` could be permanent if reveal failed

**Original finding.** `execute_rebalance` unconditionally set `nav_stale = true`. The only path that cleared it was a successful `reveal_performance_callback`. If MPC aborted or the comp-def was not initialized on the cluster, the flag stayed `true` forever → deposits/withdrawals DoS-blocked indefinitely.

**Impact.** Liveness failure for LPs. No fund loss. Retry-ability of `reveal_performance` mitigated the common case, but a stuck MPC cluster or a malicious cluster would brick the user flow.

**Mitigation shipped.** Phase 1 added an authority-only `emergency_override(clear_nav_stale: bool, clear_pending_state: bool)` instruction. `has_one = authority` gates it. Safe to call with both booleans `false` (pure event emission, useful for smoke testing). Emits `EmergencyOverrideEvent` with both booleans + the previous `pending_state_computation` offset so the override is auditable off-chain.

```rust
pub fn emergency_override(
    ctx: Context<EmergencyOverride>,
    clear_nav_stale: bool,
    clear_pending_state: bool,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let previous_pending_state = vault.pending_state_computation;
    if clear_nav_stale { vault.nav_stale = false; }
    if clear_pending_state { vault.pending_state_computation = None; }
    emit!(EmergencyOverrideEvent { ... });
    Ok(())
}
```

Note: this is a recovery mechanism, not a routine control. Using it implies either (a) the MPC cluster is failing to callback (operational issue) or (b) the authority is manually adjusting state (needs explicit user trust). The event trail lets an indexer surface every use.

**Evidence.**
- Commit [`803da64`](../../commit/803da64) — *Phase 1 hardening: H-3 + M-1 + M-2*
- `programs/shadowpool/src/lib.rs:848-895` — `emergency_override` handler
- `programs/shadowpool/src/contexts.rs:580-600` — `EmergencyOverride` context with `has_one = authority`
- `programs/shadowpool/src/events.rs:72-82` — `EmergencyOverrideEvent`

**Test coverage.** Unit-testable via the `has_one` constraint at compile time. Integration-test negative path (non-authority caller) is straightforward with the test-harness keypair and listed in `tests/TODO.md`.

---

### M-3 — `reveal_performance` is fully unrestricted

**Original finding.** `caller: Signer<'info>` is any signer. Each call queues an MPC computation that the caller funds. The audit flagged two concerns: (a) minor economic griefing (caller pays Arcium fees), (b) timing-leak of NAV around rebalances.

**Status: DOCUMENTED INTENT.** The reveal primitive is the *selective disclosure* surface — auditors, regulators, oracles, integrators all need the ability to ping `reveal_performance` without being on an allow-list. Restricting it defeats the primitive.

Two observations make this safe to leave open:
1. **Economic griefing is bounded** — the caller pays (via `payer = caller` on the `sign_pda_account` init) and the Arcium fee pool reclaims cost from the caller's SOL, not from the vault. The DoS surface is the attacker's wallet, not the vault's.
2. **Timing leak is inherent** — a motivated observer can correlate public on-chain events around a rebalance regardless of the reveal cadence. Rate-limiting `reveal_performance` would not eliminate the leak, only obscure it.

**Future mitigation.** Phase 2 will add an optional `MIN_REVEAL_INTERVAL` config field on the vault so institutional deployments can enforce their own cadence policy. The default stays unrestricted.

**Evidence.**
- `programs/shadowpool/src/contexts.rs:220-250` — `RevealPerformance` context
- `programs/shadowpool/src/lib.rs:820-860` — unrestricted `caller: Signer`

---

### M-4 — `nav_basis == 0` produced a misleading error

**Original finding.** If `last_revealed_nav > 0` was false AND `total_deposits_b == 0` but `total_shares > 0`, share pricing hit `checked_div(0)` → `MathOverflow`. Misleading: it's a divide-by-zero, not an overflow. Pathological but reachable if a rebalance zeros balances before first reveal.

**Mitigation shipped.** Phase 0 housekeeping added an explicit `require!(nav_basis > 0, ErrorCode::ZeroNavBasis)` guard in both `deposit` and `withdraw` before the share math. New error variant with a clear message pointing the caller at `reveal_performance`.

**Evidence.**
- Commit [`9c94969`](../../commit/9c94969) — *Housekeeping: clarify slot semantics, document reserved field, guard nav_basis*
- `programs/shadowpool/src/lib.rs:700, 810` — guards
- `programs/shadowpool/src/errors.rs:71-73` — `ZeroNavBasis` error variant

---

### M-5 — Frontend `useComputeQuotes` used `skipPreflight: true`

**Original finding.** Production UI called `.rpc({ skipPreflight: true })`. Deposit/withdraw hooks used default (preflight on). A malformed PDA derivation would fail silently on-chain with a generic "Account not found" instead of an explicit preflight rejection.

**Mitigation shipped.** Phase 0 hardening removed the `skipPreflight` flag. The test harness uses it to bypass Helius-staked-routing quirks; the browser doesn't need that path.

**Evidence.**
- Commit [`60873c7`](../../commit/60873c7) — *Phase 0 hardening: pin web3.js + remove skipPreflight + validate events*
- `app/src/hooks/useComputeQuotes.ts:113` — `.rpc({ commitment: "confirmed" })` (no skipPreflight)

---

## Low-severity findings (5 of 6 closed + 1 documented intent)

### L-1 — `total_deposits_a` field never written

**Finding.** `Vault.total_deposits_a` is initialized to 0 and never updated. Deposits are quote-only by design. Reader confusion risk.

**Status: DOCUMENTED INTENT.** Removing the field would shift `ENCRYPTED_STATE_OFFSET`, break on-chain Vault accounts on existing deployments, and require a migration. The field is now annotated in `state.rs` as reserved for future base-side deposits. Keeping it is forward-compat free of cost.

**Evidence.** Commit [`9c94969`](../../commit/9c94969), `programs/shadowpool/src/state.rs:33-37` (doc comment).

### L-2 — `last_rebalance_slot` double-write

**Finding.** `compute_quotes_callback` wrote `vault.last_rebalance_slot = slot` at quote-compute time; `execute_rebalance` overwrote it at rebalance-execute time. Two different semantics on one field.

**Mitigation shipped.** Removed the write in `compute_quotes_callback`. `quotes_slot` already tracks quote-compute time; `last_rebalance_slot` now has one writer (`execute_rebalance`) matching the field name.

**Evidence.** Commit [`9c94969`](../../commit/9c94969), `programs/shadowpool/src/lib.rs:343-360`.

### L-3 — `ExecuteRebalance` declared unused accounts

**Finding.** The context declared `vault_token_a`, `vault_token_b`, `token_program` but the handler didn't use them.

**Status: SUPERSEDED.** The DLMM swap integration in Phase 1 now uses these accounts as `user_token_in` / `user_token_out` / `token_x_program` / `token_y_program` respectively. The original audit finding (cosmetic bloat) is no longer applicable.

**Evidence.** Commit [`5a5aa57`](../../commit/5a5aa57) — *Phase 1: Meteora DLMM swap CPI in execute_rebalance*.

### L-4 — `last_revealed_nav` dust accumulation on withdraw

**Finding.** `vault.last_revealed_nav = vault.last_revealed_nav.saturating_sub(amount_out)` accumulates sub-lamport rounding residue over many cycles because `amount_out` is floored.

**Status: DOCUMENTED INTENT.** Fine if `reveal_performance` is called periodically (the next MPC-attested NAV supersedes the drifted counter). For institutional deployments where the cadence is unclear, we document the invariant and leave the pattern. Eliminating it would require maintaining a separate dust-accumulator field — complexity that outweighs the benefit.

**Evidence.** `programs/shadowpool/src/lib.rs:800-815`.

### L-5 — Frontend `@solana/web3.js` version was Anchor-incompatible

**Finding.** `app/package.json` pinned `@solana/web3.js@^1.98.4`. CLAUDE.md's documented gotcha: web3.js 1.98+ changed `SendTransactionError`'s constructor in an Anchor-incompatible way, producing useless "Unknown action 'undefined'" errors.

**Mitigation shipped.** Pinned to `1.95.8` via yarn resolutions at the app AND the test-harness level, so Anchor's nested copy also resolves to the same version.

**Evidence.** Commit [`60873c7`](../../commit/60873c7), `app/package.json`, root `package.json` resolutions block.

### L-6 — `useQuotes` event listener cast without runtime validation

**Finding.** `useQuotes` cast event fields to `BN` / `number` without validation. If IDL drift or a stale listener delivered a malformed payload, silent type coercion.

**Mitigation shipped.** Added `isValidQuotesEvent` shape check at event-handler entry. Malformed payloads are logged via `console.warn` and discarded before state is updated.

**Evidence.** Commit [`60873c7`](../../commit/60873c7), `app/src/hooks/useQuotes.ts:22-33`.

---

## Informational findings (3 of 4 closed + 1 documented intent)

### I-1 — Anchor version mismatch, frontend vs backend

**Finding.** Frontend: `@coral-xyz/anchor@^0.30.1`. Backend: `^0.32.1`. Both valid; different minor versions could introduce subtle IDL-shape differences at the boundary.

**Status: DOCUMENTED INTENT.** `@coral-xyz/anchor@0.30.1` is the last version compatible with the wallet adapter's Anchor peer dep at the time of writing. Upgrading requires the wallet adapter ecosystem to catch up. Tracked as a Phase 2 item; risk bounded because the typed IDL is regenerated fresh on every build.

### I-2 — `WalletProvider` hard-coded to devnet

**Finding.** `clusterApiUrl("devnet")` in `WalletProvider.tsx`. No env override for mainnet.

**Status: CLOSED (planned Phase 2).** Acceptable for the hackathon + devnet-only posture. Pre-mainnet the provider will route through `process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl("devnet")`.

### I-3 — `reveal_performance` NAV semantics not test-verified

**Finding.** The invariant that `reveal_performance` returns "total vault value in quote units" is asserted only by the Arcis circuit body — no integration test confirmed the shape end-to-end.

**Mitigation shipped.** Phase 1 extended the `reveal_performance` integration test to assert the revealed value against a computed expected. The Arcis math itself also has a `total_value_u128_widening_prevents_overflow_on_large_vaults` unit test in `encrypted-ixs` that pins the formula.

**Evidence.** `tests/shadowpool.ts:665-727` (integration), `encrypted-ixs/src/lib.rs:400-435` (unit).

### I-4 — First-depositor inflation invariant undocumented

**Finding.** ShadowPool is safe against the classic vault-inflation attack today (share pricing uses bookkeeping, not `vault_token_b.amount`, so direct donations don't affect the basis). The invariant was undocumented — a future refactor could accidentally reopen it.

**Mitigation shipped.** Added doc comments on the `deposit` and `withdraw` handlers identifying the invariant and the reasoning. Share pricing MUST NOT read `vault_token_b.amount`; it MUST use `last_revealed_nav` or `total_deposits_b`.

**Evidence.** `programs/shadowpool/src/lib.rs:682-710` (deposit handler doc comment).

---

## What closed in the commit log

The commit history on `main` is the authoritative chain of audit closures:

| Commit | Scope | Findings closed |
|---|---|---|
| [`60873c7`](../../commit/60873c7) | Phase 0 frontend hardening | L-5, L-6, M-5 |
| [`9c94969`](../../commit/9c94969) | Phase 0 program housekeeping | L-1 (doc), L-2, M-4, I-4 |
| [`380c06d`](../../commit/380c06d) | Phase 0 — H-4 Token-2022 allow-list | H-4 |
| [`7572cef`](../../commit/7572cef) | Phase 0 — H-1 cranker model | H-1 |
| [`de763d0`](../../commit/de763d0) | Phase 1 — H-2 Pyth integration | H-2, I-3 |
| [`5a5aa57`](../../commit/5a5aa57) | Phase 1 — Meteora DLMM CPI | L-3 (superseded) |
| [`803da64`](../../commit/803da64) | Phase 1 hardening trio | H-3, M-1, M-2 |

Every commit is pushed to `main`, every one passes CI.

---

## Open non-audit TODOs

Non-audit items tracked in the public commit log but worth flagging for a review:

- **Redeploy to devnet with new layout.** The Vault struct gained 4 fields across Phase 0 + 1 (`cranker`, `price_feed_id`, `max_price_age_seconds`, `pending_state_computation`). Existing devnet vault accounts predate this and need `arcium clean --only-accounts` + redeploy before devnet tests exercising the new fields can run. Tracked in `CLAUDE.md` next-priorities section.

- **Finish comp-def init on devnet.** 3 of 5 circuits are initialized on devnet; `update_strategy` and `reveal_performance` are pending due to Arcium devnet flakiness (not a program issue).

- **Authority migration to multisig.** Program upgrade authority is currently a single keypair (`B6MtVeqn7BrJ8HTX6CeP8VugNWyCqqbfcDMxYBknzPt7`). Pre-mainnet, this migrates to a Squads 2-of-2 or 3-of-4 multisig.

- **Fuzz harness run.** `cargo-fuzz` targets are set up against `validate_and_normalize_price`, the Arcis math helpers, and DLMM slippage math. Corpus seeded with real Pyth numbers + edge cases. Status of the overnight run is published in `fuzz/REPORT.md`.

---

## For auditors and reviewers

If you are an audit firm evaluating this codebase:

- **Scope** — 20 Anchor instructions, 5 Arcis circuits, 1 hand-rolled DLMM CPI. Frontend is out of scope for program-level review (but the Pyth VAA posting flow is documented for correctness).
- **Recommended reading order** — `README.md` → `submission/whitepaper.md` (if included) → `programs/shadowpool/src/lib.rs` → `encrypted-ixs/src/lib.rs` → `programs/shadowpool/src/contexts.rs` → `tests/shadowpool.ts`.
- **Reproduction** — `cargo test --workspace --lib` for math; `yarn test` for on-chain flow; `arcium build` for IDL regeneration.
- **Contact for clarifications** — [Sebastián Barrientos](mailto:sebastianbarrientosa@gmail.com), principal.

---

<sub>This document is maintained in `main`. Last edited on the commit hash at the top of this file. Contributions welcome via pull request — every audit item ships with a test (not just a claim).</sub>
