# ShadowPool — Confidential Execution Layer for Solana

Dark-pool execution on Solana. LP / institutional strategy parameters stay
encrypted inside Arcium's MPC network; only computed quotes are revealed
on-chain; selective disclosure for auditors is built in.

Active submission for the Colosseum Frontier hackathon (Apr 6 – May 11, 2026).
Program deployed on **devnet** at `BEu9VWMdba4NumzJ3NqYtHysPtCWe1gB33SbDwZ64g4g`.

## Build & Test

```bash
arcium build                    # Compile Arcis circuits + Anchor program
yarn test                       # Integration suite on localnet (~22s warm)
yarn test:clean                 # Reset localnet state + test
yarn test:nuke                  # Nuclear cleanup + test
cargo test --workspace --lib    # Pure-math unit tests (fast, no Docker)
cd app && yarn dev              # Frontend dev server (localhost:3000)
cd app && yarn build            # Production build (Turbopack)
```

Devnet runs use the Helius RPC, kept in the gitignored `.env.local`:
```bash
source .env.local && arcium test --cluster devnet --skip-build
```

## Source layout

### Program — `programs/shadowpool/src/` (modular)

```
lib.rs        # declare_id! + #[arcium_program] with thin handlers (rustdoc'd).
              # Holds thin Anchor wrappers over shadowpool-math helpers:
              #   - enforce_mint_extension_allowlist (Token-2022 init-time check)
              #   - read_pyth_price (Pyth SDK staleness check + call into
              #     shadowpool_math::validate_and_normalize_price)
              #   - compute_expected_amount_out / compute_safety_floor
              #     (translate shadowpool_math::MathError → ErrorCode)
              #   - math_err_to_anchor translation (explicit 1:1 mapping)
dlmm_cpi.rs   # Hand-rolled Meteora DLMM swap CPI. Narrower than
              # declare_program!(dlmm) (which fails to compile due to
              # DLMM's zero-copy account types); covers only the `swap`
              # instruction with discriminator + account list + invoke_signed.
constants.rs  # Comp-def offsets, ENCRYPTED_STATE_OFFSET, BPS ceilings,
              # Pyth tolerances (MAX_CONF_BPS, TARGET_PRICE_EXPO,
              # MIN/MAX_PYTH_EXPONENT)
state.rs      # #[account] Vault struct (MPC-byte-layout-sensitive!).
              # Tail-appended config fields (all below encrypted_state so
              # the offset stays at 249): cranker: Pubkey, price_feed_id:
              # [u8; 32], max_price_age_seconds: u64.
errors.rs     # #[error_code] ErrorCode (30 variants, grouped by concern;
              # append-only — stable numeric codes starting at 6000)
events.rs     # 12 #[event] structs (every event carries slot: u64;
              # CrankerSetEvent, EmergencyOverrideEvent)
contexts.rs   # 18 #[derive(Accounts)] structs. Every vault ref seed-bound
              # to its PDA. ComputeQuotes carries a Pyth PriceUpdateV2
              # constrained to vault.price_feed_id; ExecuteRebalance
              # carries the 10 DLMM swap accounts (IDL-ordered) +
              # bin-array remaining_accounts.
idls/         # Vendored third-party IDLs for reproducibility.
              #   dlmm.json — Meteora DLMM v0.8.2 (from MeteoraAg/cpi-examples).
```

### Pure-math crate — `crates/shadowpool-math/`

no_std-compatible workspace crate that owns the audit-critical math:
- `validate_and_normalize_price` — Pyth input sanitizer + normalizer.
- `compute_expected_amount_out` — DLMM swap expected output + cap.
- `compute_safety_floor` — MPC-anchored slippage floor.

Returns `MathError` instead of Anchor's `Error`. The shadowpool
program holds thin wrappers that translate `MathError → ErrorCode`
via `math_err_to_anchor`. Fuzz-testable with `cargo-fuzz` (see
`programs/shadowpool/fuzz/`); reusable by third-party integrators.

### Fuzz harness — `programs/shadowpool/fuzz/`

`cargo-fuzz` crate, `[workspace]` empty table keeps nightly/sanitizer
flags from leaking into the Anchor build. Three targets — one per
pure-math helper. Latest overnight run: 266M iterations, 0 crashes.
Report in `fuzz/REPORT.md`. Corpus in `fuzz/corpus/` (gitignored via
the scaffold's default `.gitignore`).

### Arcis circuits — `encrypted-ixs/src/lib.rs` (5 circuits + unit tests)

1. `init_vault_state` — creates `Enc<Mxe, VaultState>` from client-encrypted strategy
2. `compute_quotes` — encrypted state + plaintext oracle → revealed `QuoteOutput`
3. `update_balances` — applies trade deltas to encrypted balances (saturating)
4. `update_strategy` — owner changes encrypted spread / threshold
5. `reveal_performance` — selective disclosure of total vault value (u128 math)

### Frontend — `app/src/`

```
app/
  layout.tsx                  # Server component; wraps children in <WalletProvider>
  page.tsx                    # Landing page
  vault/
    page.tsx                  # Vault dashboard (orchestrator)
    components/
      EncryptedField.tsx      # Shimmering ciphertext field + useShimmeringHex
      MPCDivider.tsx          # Three-node divider + LockIcon
      mock-vault.ts           # Demo-mode fallback data
components/
  ConnectButton.tsx           # Design-matched wallet button
providers/
  WalletProvider.tsx          # Solana wallet adapter (Phantom, Solflare, devnet)
hooks/
  useVault.ts                 # Fetch vault account (typed via IdlAccounts<Shadowpool>)
  useQuotes.ts                # Listen for QuotesComputedEvent
  useDeposit.ts, useWithdraw.ts, useComputeQuotes.ts
lib/
  constants.ts                # Program ID, vault PDA derivation, offsets
  program.ts                  # Program<Shadowpool> factory
  units.ts                    # toRawUnits() + QUOTE_DECIMALS / SHARE_DECIMALS
  arcium-pdas.ts              # Browser-safe reimplementation of 7 Arcium PDA
                              # helpers (avoids @arcium-hq/client's Node-only
                              # `fs` import that broke `next build`)
idl/
  shadowpool.json             # IDL (sync via `yarn sync-idl`)
  shadowpool.ts               # Typed IDL (parameterizes Program<T>)
```

### Frontend build stack

- **Next.js 16.2** with **Turbopack** (the default in v16; not webpack).
- **React 19.2** with the **React Compiler** enabled (`reactCompiler: true`).
  Auto-memoizes components; manual `useMemo`/`useCallback` is largely optional.
- **Tailwind v4** via `@tailwindcss/postcss`.
- **Typed IDL end-to-end**: `Program<Shadowpool>` with `Shadowpool` imported
  from `src/idl/shadowpool.ts`. No `as any` casts in the hooks.
- **Browser polyfills**: `buffer` for BN constructor compatibility; Web Crypto
  replaces Node `crypto.randomBytes` in `useComputeQuotes`.

## Rebalance cycle (end-to-end)

```
compute_quotes (MPC)
  → callback persists bid/ask/sizes + quotes_slot to vault
  → QuotesComputedEvent (or QuotesOverwrittenEvent if a prior quote was still unconsumed)

execute_rebalance (authority-gated, ≤5% max slippage)
  → validates quotes_slot <= QUOTE_STALENESS_SLOTS (150 slots ≈ 60s)
  → CPIs into DEX (Meteora DLMM — currently skeleton)
  → marks quotes_consumed = true, nav_stale = true, stamps last_rebalance_slot

update_balances (MPC)
  → applies actual trade deltas to encrypted state (saturating subtraction)
  → callback re-encrypts + persists to encrypted_state

reveal_performance (MPC)
  → computes total vault value at last_mid_price in u128
  → callback stamps last_revealed_nav + clears nav_stale
  → PerformanceRevealedEvent

deposit / withdraw (SPL token flow)
  → blocks while nav_stale=true (require!(!vault.nav_stale, NavStale))
  → prices shares off last_revealed_nav (post-first-reveal) or total_deposits_b (pre)
  → updates last_revealed_nav by the deterministic delta
```

## Critical gotchas

1. **`ENCRYPTED_STATE_OFFSET = 249`** is load-bearing. The Arcium cluster reads encrypted state directly from account bytes at this offset. Never reorder fields above `encrypted_state` in the `Vault` struct — the invariant test in `lib.rs` will fail at `cargo test` time if you do.

2. **Arcis both-branches-always-execute rule.** Both arms of every `if/else` run in MPC. Division by a secret zero is undefined — use the safe-divisor pattern (Pattern #13 in the arcium-official skill): compute a non-zero divisor first, divide into a candidate, select the final result with an if/else *after*.

3. **ArgBuilder parameter order MUST match circuit signatures left-to-right.** For `Enc<Shared, T>`: `.x25519_pubkey()`, `.plaintext_u128(nonce)`, then `.encrypted_*()`. For `Enc<Mxe, T>`: `.plaintext_u128(nonce)`, then `.encrypted_*()` (no pubkey). Wrong order is a runtime `InvalidArguments` with a useless error message.

4. **Zombie validators.** `arcium test` leaves `solana-test-validator` running. `package.json` pre/post hooks kill it with `pkill -9 -x solana-test-val` (15-char `comm` truncation — see the `arcium-solana-dev` skill for why `-x solana-test-validator` doesn't match). Always use `yarn test`, never bare `arcium test`.

5. **`init_comp_def` takes 3 args** in v0.9.x: `init_comp_def(ctx.accounts, None, None)`. The `u32` priority param was removed.

6. **`use arcis::*;`**, NOT `arcis_imports` (renamed in v0.6).

7. **Box large accounts.** `Cluster`, `ComputationDefinitionAccount`, and `Vault` must be `Box<Account<'info, T>>` to avoid BPF stack overflow.

8. **Vault PDA signing.** Extract `authority` and `bump` BEFORE any mutable borrow of the vault. Seeds: `[b"vault", authority.as_ref(), &[bump]]`.

9. **NAV staleness.** Any rebalance flips `vault.nav_stale = true`. Deposit/withdraw reject while stale. Only a successful `reveal_performance_callback` clears it.

10. **token_interface vs token.** The program uses `anchor_spl::token_interface` (accepts both legacy SPL Token AND Token-2022). Tests still create legacy mints for speed; Token-2022 paths will Just Work when they ship.

11. **idl-build feature.** `Cargo.toml` must include `anchor-spl/idl-build` or `TokenAccount`/`Mint` fail IDL generation with "no associated item named `DISCRIMINATOR`".

12. **Seed binding on every vault context.** All 17 Accounts structs that reference the vault enforce `seeds = [b"vault", vault.authority.as_ref()], bump = vault.bump`. Without this, Arcium callbacks could be delivered to arbitrary accounts that happen to deserialize as Vault.

13. **Cranker authorization model.** `compute_quotes`, `update_balances`, and `execute_rebalance` are all gated on `cranker.key() == vault.cranker` — a single uniform trust boundary for the MPC rebalance pipeline. At `initialize_vault` time `vault.cranker = authority` (self-cranking default). An authority-only `set_cranker(new_cranker)` instruction delegates the role to a hot wallet or third-party cranker without transferring vault ownership. Emits `CrankerSetEvent`. Replaces the legacy "authority-only on execute_rebalance, unrestricted on compute/update" split that shipped pre-Phase-0.

14. **`InitializeVault` hardening.** Runs both Anchor-constraint checks AND a handler-side Token-2022 extension allow-list. Constraints: vault token accounts have `delegate.is_none()` + `close_authority.is_none()`; share mint has `freeze_authority.is_none()`; Token A and B mints are distinct. Handler: `enforce_mint_extension_allowlist(&mint)` rejects any of `PermanentDelegate`, `TransferFeeConfig`, `ConfidentialTransferMint`, `DefaultAccountState`, `NonTransferable`, `TransferHook` on all three mints (token_a, token_b, share). Legacy SPL Token mints skip the parse (owner check). Blocks the worst creator-time backdoor vectors, most notably a `PermanentDelegate` on a USDC-look-alike that would let a malicious creator drain user deposits. Also stores the per-vault Pyth feed configuration (`price_feed_id` + `max_price_age_seconds`) so different vaults can point at different oracle feeds without a program upgrade.

15. **Pyth Pull Oracle integration.** `compute_quotes` reads price + conf from a `PriceUpdateV2` account supplied by the cranker. Five-layer defence: (1) Anchor enforces Pyth receiver program ownership via `Account<PriceUpdateV2>`; (2) context constraint pins `price_update.price_message.feed_id == vault.price_feed_id` — blocks wrong-asset feeds (BONK for a SOL vault); (3) SDK's `get_price_no_older_than` enforces `vault.max_price_age_seconds` + re-checks feed_id; (4) handler enforces `price > 0` (spot-only), `exponent ∈ [-18, 0]`, and `conf/|price| ≤ MAX_CONF_BPS/10_000` (1% default); (5) u128 checked-math normalization to `TARGET_PRICE_EXPO = -6` (micro-USD). No floats. `validate_and_normalize_price` is a pure function tested by 11 fixture-based Rust unit tests — the on-chain integration tests need a real `PriceUpdateV2` and are skipped on localnet unless `PYTH_TEST=1` is set with the Pyth receiver cloned into the test validator.

16. **Meteora DLMM swap CPI.** `execute_rebalance` CPIs into the Meteora DLMM program (`LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`, same on mainnet and devnet) to execute the rebalance. The vault PDA signs the swap. Hand-rolled CPI in `src/dlmm_cpi.rs` avoids `declare_program!(dlmm)` which fails to compile against DLMM's zero-copy account types. Handler contract: `(swap_direction: u8, amount_in: u64, min_amount_out: u64, max_slippage_bps: u16)`. Five-layer validation: (1) cranker gate; (2) `lb_pair.owner == dlmm::ID`; (3) `{token_x_mint, token_y_mint}` pair matches `{vault.token_a_mint, vault.token_b_mint}` in either ordering; (4) DLMM's own internal checks; (5) MPC-anchored slippage floor — `min_amount_out ≥ expected_out * (1 - MAX_ALLOWED_SLIPPAGE_BPS/10_000)` where `expected_out` is computed from the MPC-revealed bid/ask price + base-mint decimals. Cranker can tighten slippage but never loosen beyond the 5% cap. Bin arrays pass through `ctx.remaining_accounts` (client pre-computed from `lb_pair.active_id` via Meteora TS SDK's `getBinArrayForSwap`). Pre/post-snapshot on the out-side ATA for ground-truth `amount_out` in the event.

17. **Deposit pre/post reload accounting (H-3).** `deposit` handler snapshots `vault_token_b.amount` before + after the `transfer_checked` CPI and bookkeeps against the actually-received amount (`balance_after - balance_before`), not the caller-supplied `amount`. Share mint count and NAV tracking use `actual_received` too, so a fee-on-transfer shortfall mints shares pro-rata to what the vault got. `DepositEvent.amount` is the credited amount, so an indexer comparing the user-side debit vs the vault-side credit sees any fee delta. The Token-2022 extension allow-list in `initialize_vault` already rejects `TransferFeeConfig` mints, so in practice today `actual_received == amount`; H-3 is belt-and-braces for forward-compat and audit-defensibility. Withdraw unchanged — the vault-side debit always equals `amount_out` regardless of fees (Token-2022 fee comes from the recipient's side).

18. **MPC single-flight guard (M-1).** `Vault.pending_state_computation: Option<u64>` field. The three state-mutating Arcis circuits (`create_vault_state`, `update_balances`, `update_strategy`) set it to `Some(computation_offset)` at queue time and reject new queues while `Some`. All three paired callbacks clear it to `None` **regardless of success or abort** — an aborted computation that didn't clear would wedge the vault indefinitely. Read-only circuits (`compute_quotes`, `reveal_performance`) are unaffected and can still fire while a state update is in flight. Rejects with `StateComputationPending`.

19. **Emergency override escape hatch (M-2).** Authority-only `emergency_override(clear_nav_stale, clear_pending_state)` instruction. Unsticks the two internal liveness flags when the MPC cluster fails to deliver a callback (DoS, aborted reveal, devnet flakiness, uninitialized comp-def). Emits `EmergencyOverrideEvent` with both booleans + the previous pending offset for forensic audit trail. Authority gate via `has_one = authority`. Safe to call with both booleans `false` (pure event emission).

15. **Don't import `@arcium-hq/client` in client components.** Its ESM bundle imports `fs` unconditionally, which breaks `next build`. The seven PDA helpers we need (MXE / Mempool / Execpool / Cluster / Computation / CompDef / CompDefOffset) are reimplemented browser-safe in `app/src/lib/arcium-pdas.ts`. If you ever need `uploadCircuit` or similar Node-side helpers, put them in a server action, not a `"use client"` file.

16. **`@coral-xyz/anchor` + `@solana/web3.js` version pin.** `web3.js@1.95.x` is what `arcium-client` expects. `web3.js@1.98+` changed the `SendTransactionError` constructor signature in an Anchor-incompatible way, producing useless "Unknown action 'undefined'" errors that mask real transient RPC failures.

## Current status

### Shipped
- **Program**: 20 instructions, modular src/ layout, `token_interface` migration done, rustdoc on every public instruction.
- **Circuits**: 5 circuits, safe-divisor applied, u128 arithmetic hardening throughout.
- **Tests**: **9 integration tests** (6 localnet-runnable + 3 Pyth-gated via `PYTH_TEST=1`), all the localnet ones green in ~25s. **73 unit tests** (16 Arcis + 37 shadowpool-lib + 20 shadowpool-math) all green via `cargo test --workspace --lib` in ~3s. Plus **cargo-fuzz** harness with 3 targets and 266M iterations without a crash in the latest run.
- **Typed IDL end-to-end**: `Program<Shadowpool>` everywhere, `VaultData` derived from `IdlAccounts<Shadowpool>` — no `as any` casts in hooks.
- **Security**: NAV-aware share pricing, staleness guard, uniform `cranker` gate across the MPC rebalance pipeline (compute_quotes / update_balances / execute_rebalance), `nav_basis > 0` guard in deposit/withdraw, seed binding on every vault context, `transfer_checked`, vault init hardening (no freeze / delegate / close authority, distinct mints, Token-2022 extension allow-list), **five-layer Pyth Pull Oracle validation** on `compute_quotes` (owner / feed_id x2 / staleness / positive+exponent+conf / u128 normalization).
- **Devnet deployed**: program live at `BEu9VWMdba4NumzJ3NqYtHysPtCWe1gB33SbDwZ64g4g`. 3 of 5 comp defs initialized (last 2 pending — devnet flakiness). Post-Phase-0/1 the on-chain layout added `cranker`, `price_feed_id`, `max_price_age_seconds` fields; existing devnet vault accounts predate the new layout and need `arcium clean --only-accounts` + redeploy before devnet testing resumes.
- **Frontend**: `next build` succeeds (static prerender of / and /vault). React Compiler enabled. Browser-safe Arcium PDA helpers replace the Node-dependent `@arcium-hq/client` imports. `@solana/web3.js` pinned to `1.95.8` via yarn resolution (1.98.x is Anchor-incompatible). `useQuotes` runtime-validates event shape. `useComputeQuotes` fetches a fresh Pyth VAA from Hermes, posts it via `@pythnetwork/pyth-solana-receiver` (ephemeral, rent-reclaimed), and bundles `compute_quotes` into the same atomic transaction.
- **CI**: GitHub Actions runs `cargo check`, `cargo test --lib`, and frontend `tsc` on every push.
- **Submission docs**: private `submission/` folder (gitignored, own git repo) contains founder letter, 3-min demo script, shot list, judge walkthrough, founder-market-fit doc, bio rewrite, MEV savings model, institutional scenario, competitor table, pitch deck outline, sponsor outreach drafts.

### Next priorities (Phase 1 — in order)
1. ~~**Pyth oracle integration**~~ — ✅ shipped `de763d0` (2026-04-16). H-2 closed.
2. ~~**Meteora DLMM CPI in `execute_rebalance`**~~ — ✅ shipped `5a5aa57` (2026-04-16). Five-layer validation, hand-rolled CPI, MPC-anchored slippage floor, vault PDA signs. Real on-chain rebalance now works.
3. **H-3: Pre/post reload accounting in deposit/withdraw** — credit `balance_after - balance_before` instead of the pre-fee `amount`. Closes the remaining Token-2022 transfer-fee correctness gap (the extension allow-list rejects the extension entirely today, but the pattern is the right-long-term belt-and-braces).
4. **M-1: Single-flight MPC guard** — `pending_state_computation: Option<u64>` on the vault; reject new queues while pending. Prevents `state_nonce` races between concurrent `update_balances` / `update_strategy` calls.
5. **M-2: Emergency NAV escape hatch** — authority-clearable `nav_stale` flag so a stuck reveal doesn't DoS deposit/withdraw indefinitely.
6. **Redeploy program to devnet** with the new layout (requires `arcium clean --only-accounts`). Finish comp-def init (2 circuit buffers pending).
7. Wire the deposit/withdraw flow end-to-end on devnet via the dashboard (hooks exist, program live, just needs a canonical vault with the new layout).
8. Record the 3-minute demo video per `submission/demo/script-3min.md` — after Pyth + DLMM CPI land so the demo shows real execution, not narration.

## Code patterns

**MPC instruction skeleton:**
```rust
// 1. Queue from handler
let args = ArgBuilder::new()
    .plaintext_u128(vault.state_nonce)
    .account(vault.key(), ENCRYPTED_STATE_OFFSET, ENCRYPTED_STATE_SIZE)
    .build();
queue_computation(ctx.accounts, computation_offset, args,
    vec![MyCallback::callback_ix(computation_offset, &ctx.accounts.mxe_account,
        &[CallbackAccount { pubkey: vault.key(), is_writable: true }])?],
    1, 0)?;

// 2. Circuit in encrypted-ixs/src/lib.rs
#[instruction]
pub fn my_circuit(state: Enc<Mxe, VaultState>, plaintext_arg: u64) -> Enc<Mxe, VaultState> {
    let mut s = state.to_arcis();
    // ... arithmetic, mindful of both-branches-always-execute ...
    state.owner.from_arcis(s)
}

// 3. Callback writes re-encrypted state back
#[arcium_callback(encrypted_ix = "my_circuit")]
pub fn my_circuit_callback(ctx: Context<MyCallback>, output: SignedComputationOutputs<MyOutput>) -> Result<()> {
    let o = match output.verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account) {
        Ok(MyOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };
    let vault = &mut ctx.accounts.vault;
    vault.encrypted_state = o.ciphertexts;
    vault.state_nonce = o.nonce;
    emit!(MyEvent { vault: vault.key(), slot: Clock::get()?.slot });
    Ok(())
}
```

**Vault PDA signing for SPL operations:**
```rust
let authority_key = ctx.accounts.vault.authority;
let bump = ctx.accounts.vault.bump;
let signer_seeds: &[&[&[u8]]] = &[&[b"vault", authority_key.as_ref(), &[bump]]];
// ... CPI with signer_seeds, then mutably borrow vault for state updates
ctx.accounts.vault_token_b.reload()?;
```

**Quote lifecycle:** `compute_quotes_callback` persists quotes + sets `quotes_consumed=false`; `execute_rebalance` reads, validates staleness, executes, sets `quotes_consumed=true` + `nav_stale=true`; `reveal_performance_callback` clears `nav_stale`.

**Frontend PDA derivation (browser):**
```ts
import { getMXEAccAddress, getComputationAccAddress } from "@/lib/arcium-pdas";

const mxe = getMXEAccAddress(program.programId);                       // sync
const comp = getComputationAccAddress(clusterOffset, computationOffset); // sync
const compDefOffsetBytes = await getCompDefAccOffset("compute_quotes"); // async (Web Crypto)
const compDefOffset = compDefOffsetBytes.readUInt32LE();
```

## Skills

- `arcium-official`: canonical reference for Arcis circuit patterns and ArgBuilder semantics.
- `arcium-solana-dev`: operational/devops details (zombie validators, Arcium.toml, cluster offsets, version migration history).

## Strategic positioning

See `submission/positioning/execution-layer-pitch.md` for the canonical 1-sentence / 1-paragraph / 3-paragraph variants. Short version: ShadowPool is the dark-pool execution layer Solana is missing — strategy stays encrypted, execution stays public, compliance stays selective. The reference vault is the demo; the execution primitive is the product.
