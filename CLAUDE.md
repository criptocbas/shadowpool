# ShadowPool — Confidential Execution Layer for Solana

Dark-pool execution on Solana. LP / institutional strategy parameters stay
encrypted inside Arcium's MPC network; only computed quotes are revealed
on-chain; selective disclosure for auditors is built in.

Active submission for the Colosseum Frontier hackathon (Apr 6 – May 11, 2026).

## Build & Test

```bash
arcium build                    # Compile Arcis circuits + Anchor program
yarn test                       # Integration suite on localnet (~22s warm)
yarn test:clean                 # Reset localnet state + test
yarn test:nuke                  # Nuclear cleanup + test
cargo test --workspace --lib    # Pure-math unit tests (fast, no Docker)
cd app && yarn dev              # Frontend dev server (localhost:3000)
```

Devnet runs use the Helius RPC, kept in the gitignored `.env.local`:
```bash
source .env.local && arcium test --cluster devnet --skip-build
```

## Source layout

### Program — `programs/shadowpool/src/` (modular as of Apr 2026)

```
lib.rs        # declare_id! + #[arcium_program] with 19 thin handlers
constants.rs  # Comp-def offsets, ENCRYPTED_STATE_OFFSET, BPS ceilings
state.rs      # #[account] Vault struct (MPC-byte-layout-sensitive!)
errors.rs     # #[error_code] ErrorCode (18 variants, grouped by concern)
events.rs     # 10 #[event] structs (every event carries slot: u64)
contexts.rs   # All 17 #[derive(Accounts)] structs (queue / callback /
              # init-comp-def / InitializeVault / Deposit / Withdraw /
              # ExecuteRebalance), seed-bound to the vault PDA
```

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
  ConnectButton.tsx           # Design-matched wallet button (replaces WalletMultiButton)
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
idl/
  shadowpool.json             # IDL (sync via `yarn sync-idl`)
  shadowpool.ts               # Typed IDL (parameterizes Program<T>)
```

## Rebalance cycle (end-to-end)

```
compute_quotes (MPC)
  → callback persists bid/ask/sizes + quotes_slot to vault
  → QuotesComputedEvent (or QuotesOverwrittenEvent if a prior quote was still unconsumed)

execute_rebalance (authority-gated, ≤5% max slippage)
  → validates quotes_slot <= QUOTE_STALENESS_SLOTS (150 slots ~= 60s)
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

1. **`ENCRYPTED_STATE_OFFSET = 249`** is load-bearing. The Arcium cluster reads encrypted state directly from account bytes at this offset. Never reorder fields above `encrypted_state` in the `Vault` struct — there's an invariant test in `lib.rs` that will fail at `cargo test` time if you do.

2. **Arcis both-branches-always-execute rule.** Both arms of every `if/else` run in MPC. Division by a secret zero is undefined — use the safe-divisor pattern (Pattern #13 in the arcium-official skill): compute a non-zero divisor first, divide into a candidate, select the final result with an if/else *after*.

3. **ArgBuilder parameter order MUST match circuit signatures left-to-right.** For `Enc<Shared, T>`: `.x25519_pubkey()`, `.plaintext_u128(nonce)`, then `.encrypted_*()`. For `Enc<Mxe, T>`: `.plaintext_u128(nonce)`, then `.encrypted_*()` (no pubkey). Wrong order is a runtime `InvalidArguments` with a useless error message.

4. **Zombie validators.** `arcium test` leaves `solana-test-validator` running. `package.json` pre/post hooks kill it with `pkill -9 -x solana-test-val` (15-char `comm` truncation — see the `arcium-solana-dev` skill for why `-x solana-test-validator` doesn't match). Always use `yarn test`, never bare `arcium test`.

5. **`init_comp_def` takes 3 args** in v0.9.x: `init_comp_def(ctx.accounts, None, None)`. The `u32` priority param was removed.

6. **`use arcis::*;`**, NOT `arcis_imports` (renamed in v0.6).

7. **Box large accounts.** `Cluster`, `ComputationDefinitionAccount`, and `Vault` must be `Box<Account<'info, T>>` to avoid BPF stack overflow.

8. **Vault PDA signing.** Extract `authority` and `bump` BEFORE any mutable borrow of the vault. Seeds: `[b"vault", authority.as_ref(), &[bump]]`.

9. **NAV staleness.** Any rebalance flips `vault.nav_stale = true`. Deposit/withdraw reject while stale. Only a successful `reveal_performance_callback` clears it.

10. **token_interface vs token.** The program uses `anchor_spl::token_interface` (works for both legacy SPL Token AND Token-2022). Tests still create legacy mints for speed; Token-2022 paths will Just Work when they ship.

11. **idl-build feature.** `Cargo.toml` must include `anchor-spl/idl-build` or `TokenAccount`/`Mint` fail IDL generation with "no associated item named `DISCRIMINATOR`".

12. **Seed binding on every vault context.** All 17 Accounts structs that reference the vault enforce `seeds = [b"vault", vault.authority.as_ref()], bump = vault.bump`. Not just the discriminator check — without this, Arcium callbacks could be delivered to arbitrary accounts that happen to deserialize as Vault.

13. **`execute_rebalance` authority gate.** `cranker` must equal `vault.authority`. Otherwise any address could consume fresh quotes before the legitimate rebalance (griefing / sandwich vector once DEX CPI is live).

14. **`InitializeVault` hardening.** Vault token accounts must have `delegate.is_none()` + `close_authority.is_none()`. Share mint must have `freeze_authority.is_none()`. Token A and B mints must be distinct. These are creator-time checks that prevent the creator from setting up a vault with backdoor drains.

## Current status (Apr 2026)

### Shipped
- Program: 19 instructions, compiles clean, modular src/ layout, token_interface migration done.
- Circuits: 5 circuits, 11 pure-function unit tests, safe-divisor applied, u128 arithmetic hardening.
- Tests: **7/7 integration tests passing** on localnet in ~22s. Generated 11 Arcis unit tests + 1 invariant test (ENCRYPTED_STATE_OFFSET pinning).
- Typed IDL: `Program<Shadowpool>` everywhere in frontend — no `as any` in the hooks.
- Security: NAV-aware share pricing, staleness guard, authority gate on rebalance, seed binding on every vault context, transfer_checked, vault init hardening.
- Devnet: program deployed at `BEu9VWMdba4NumzJ3NqYtHysPtCWe1gB33SbDwZ64g4g`. 3 of 5 comp defs initialized (devnet flakiness, ongoing).
- CI: GitHub Actions workflow for `cargo check` + `cargo test --lib` + frontend `tsc`.

### Next priorities
1. Finish devnet comp-def init + upload remaining 2 circuits.
2. Replace `@arcium-hq/client` imports in the frontend with pure-math PDA helpers (unblocks `next build`).
3. Meteora DLMM CPI skeleton in `execute_rebalance`.
4. Pyth oracle integration (replace hardcoded `oracle_price` parameter).
5. Record the 3-minute demo video per `submission/demo/script-3min.md`.

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

## Skills

- `arcium-official`: canonical reference for Arcis circuit patterns and ArgBuilder semantics.
- `arcium-solana-dev`: operational/devops details (zombie validators, Arcium.toml, cluster offsets, version migration history).

## Strategic positioning

See `submission/positioning/execution-layer-pitch.md` for the canonical 1-sentence / 1-paragraph / 3-paragraph variants. Short version: ShadowPool is the dark-pool execution layer Solana is missing — strategy stays encrypted, execution stays public, compliance stays selective. The reference vault is the demo; the execution primitive is the product.
