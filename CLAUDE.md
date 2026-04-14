# ShadowPool — Confidential Market-Making Vault on Solana

Encrypted LP strategy parameters via Arcium MPC. Only computed bid/ask quotes are revealed publicly.

## Build & Test

```bash
arcium build                    # Compile circuits + Anchor program
yarn test                       # Full suite (pre/post cleanup hooks handle zombie validators)
yarn test:clean                 # Reset localnet state + test
yarn test:nuke                  # Nuclear cleanup + test
cd app && npx next dev          # Frontend at localhost:3000
```

## Architecture

**Core insight:** Encrypted computation and public execution are SEPARATE instructions.
- `compute_quotes` — MPC computes quotes from encrypted state + public oracle, callback persists plaintext bid/ask to vault
- `execute_rebalance` — reads persisted quotes, CPIs into DEX (Meteora DLMM), marks quotes consumed
- `update_balances` — MPC updates encrypted internal balances with actual trade deltas

**Full rebalance cycle:**
```
compute_quotes (MPC) → quotes persisted on-chain
    → execute_rebalance (DEX CPI) → actual trade happens
        → update_balances (MPC) → encrypted state updated
```

**5 Arcis circuits** (`encrypted-ixs/src/lib.rs`):
1. `init_vault_state` — create encrypted VaultState from client-encrypted strategy params
2. `compute_quotes` — encrypted state + plaintext oracle → revealed QuoteOutput
3. `update_balances` — update encrypted balances + mid_price after DEX trade
4. `update_strategy` — owner changes encrypted spread/threshold
5. `reveal_performance` — selective disclosure of total vault value

**Non-MPC instructions** (`programs/shadowpool/src/lib.rs`):
- `initialize_vault` — create vault PDA, validate SPL mints/ATAs
- `deposit` — SPL token transfer + share token mint (vault PDA signs)
- `withdraw` — share token burn + SPL token transfer back (vault PDA signs)
- `execute_rebalance` — read persisted quotes, validate staleness, CPI into DEX (skeleton)

**State:** Encrypted state stored as `[[u8; 32]; 5]` ciphertexts in the Vault account. Read by MPC via `.account(key, offset, size)`. Byte offset is 249, size is 160. Quote persistence fields are stored AFTER `encrypted_state` to preserve the offset.

**Token flow:** Real SPL token deposit/withdraw with share token minting. Vault PDA owns token accounts and signs all transfers/mints. Privacy is in the STRATEGY, not deposit amounts.

## File Structure

```
programs/shadowpool/src/lib.rs  # Anchor program (19 instructions, ~1340 lines)
encrypted-ixs/src/lib.rs       # Arcis MPC circuits (5 encrypted instructions)
tests/shadowpool.ts             # Integration tests (MPC rebalance cycle)
app/
  src/
    app/
      page.tsx                  # Landing page
      vault/page.tsx            # Vault dashboard (mock data)
      layout.tsx                # Root layout
    providers/
      WalletProvider.tsx        # Solana wallet adapter (Phantom, Solflare, devnet)
    hooks/
      index.ts                  # Barrel export
      useVault.ts               # Fetch vault account, poll every 10s
      useQuotes.ts              # Listen for QuotesComputedEvent
      useDeposit.ts             # Call deposit instruction
      useWithdraw.ts            # Call withdraw instruction
      useComputeQuotes.ts       # Call computeQuotes with Arcium accounts
    lib/
      constants.ts              # Program ID, vault PDA derivation, offsets
      program.ts                # Anchor client setup, IDL import
target/
  idl/shadowpool.json           # Generated IDL (arcium build)
  types/shadowpool.ts           # Generated TypeScript types
```

## Critical Gotchas

1. **tools-version**: `[package.metadata.solana] tools-version = "v1.52"` in program Cargo.toml. Without this, build fails with `edition2024` error.

2. **ArgBuilder order MUST match circuit parameter order**: `Enc<Mxe>` args first (nonce + `.account()`), then plaintext args, then `Enc<Shared>` args. Wrong order → runtime `InvalidArguments` error with no helpful message.

3. **Zombie validators**: `arcium test` leaves `solana-test-validator` running. The `package.json` pre/post hooks handle this (`pkill -9 -x solana-test-val`). Always use `yarn test`, never bare `arcium test`.

4. **Box large accounts**: `Cluster`, `ComputationDefinitionAccount`, and `Vault` must be `Box<Account<'info, T>>` in account structs. Otherwise BPF stack overflow.

5. **`init_comp_def` takes 3 args**: `init_comp_def(ctx.accounts, None, None)`. NOT 4 args (the `u32` priority param was removed in v0.9).

6. **Import is `use arcis::*;`**: NOT `arcis_imports` (renamed in v0.6).

7. **`if/else` on secret values works**: Arcis compiles it to constant-time execution. `.select()` also works but `if/else` is cleaner.

8. **Idempotent comp def init**: Wrap `initXCompDef` calls in try/catch that swallows "already in use" errors. The `tests/shadowpool.ts` helper does this.

9. **ENCRYPTED_STATE_OFFSET = 249**: Calculated from Vault struct layout: `8 (disc) + 1 (bump) + 32*6 (pubkeys) + 8*4 (u64s) + 16 (u128) = 249`. Quote persistence fields (bid/ask/sizes/slot/consumed) are placed AFTER `encrypted_state` specifically to avoid invalidating this offset. Never add fields between `state_nonce` and `encrypted_state`.

10. **Vault PDA signing**: Seeds are `[b"vault", authority.as_ref(), &[bump]]`. Extract `authority` and `bump` from the vault before any mutable borrow to satisfy the Rust borrow checker.

11. **anchor-spl idl-build**: The `idl-build` feature in Cargo.toml must include `anchor-spl/idl-build` or `TokenAccount` / `Mint` types fail with "no associated item named `DISCRIMINATOR`" during IDL generation.

## Current Status

- **Program**: Compiles clean. 19 instructions in IDL. Full MPC rebalance cycle + SPL deposit/withdraw + execute_rebalance skeleton.
- **Tests**: 7/7 passing for the MPC cycle (pre-SPL token refactor). Tests need updating for new `InitializeVault` constraints (real mints/ATAs instead of random pubkeys).
- **Frontend**: Landing page + vault dashboard with mock data. Connection layer (WalletProvider, hooks, Anchor client) created but not yet wired into the UI pages.
- **DEX integration**: `execute_rebalance` validates and consumes persisted quotes but does not yet CPI into a DEX. Meteora DLMM is the target (research complete, `declare_program!` approach with IDL).

**Next priorities:**
1. Update tests for SPL token accounts (create real mints/ATAs in test setup)
2. Meteora DLMM CPI in `execute_rebalance`
3. Wire frontend hooks into vault dashboard UI
4. Devnet deployment

## Code Patterns

**MPC instructions:** Every encrypted instruction follows: queue instruction → ArgBuilder → `queue_computation` → callback writes to vault account. Callbacks use `CallbackAccount { pubkey: vault.key(), is_writable: true }`.

**Vault PDA signing for SPL operations:**
```rust
let authority_key = ctx.accounts.vault.authority;
let bump = ctx.accounts.vault.bump;
let signer_seeds: &[&[&[u8]]] = &[&[b"vault", authority_key.as_ref(), &[bump]]];
// CPI with signer_seeds, then mutably borrow vault for state updates
```

**Quote lifecycle:** `compute_quotes_callback` persists quotes + sets `quotes_consumed = false` → `execute_rebalance` reads quotes, validates staleness (150 slots), executes, sets `quotes_consumed = true` → prevents replay.

**Events:** Emitted from callbacks and instructions for frontend consumption (`QuotesComputedEvent`, `DepositEvent`, `WithdrawEvent`, `RebalanceExecutedEvent`, etc.).

## Arcium Skill

The `arcium-solana-dev` skill at `~/.claude/skills/arcium-solana-dev/` is fully updated to v0.9.x with verified patterns. Reference it for Arcis types, ArgBuilder methods, account structs, and TypeScript client patterns.
