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
- `compute_quotes` → MPC computes quotes from encrypted state + public oracle → callback reveals plaintext bid/ask
- `execute_rebalance` → separate instruction takes revealed quotes and CPIs into DEX

**5 Arcis circuits** (`encrypted-ixs/src/lib.rs`):
1. `init_vault_state` — create encrypted VaultState from client-encrypted strategy params
2. `compute_quotes` — encrypted state + plaintext oracle → revealed QuoteOutput
3. `update_balances` — update encrypted balances + mid_price after DEX trade
4. `update_strategy` — owner changes encrypted spread/threshold
5. `reveal_performance` — selective disclosure of total vault value

**State:** Encrypted state stored as `[[u8; 32]; 5]` ciphertexts in the Vault account. Read by MPC via `.account(key, offset, size)`. Byte offset is 249, size is 160.

**Token flow (MVP):** Public SPL deposits. Privacy is in the STRATEGY, not deposit amounts.

## File Structure

```
encrypted-ixs/src/lib.rs       # Arcis MPC circuits (5 instructions)
programs/shadowpool/src/lib.rs  # Anchor program (all instructions + accounts)
tests/shadowpool.ts             # 7 passing tests (full rebalance cycle)
app/src/app/                    # Next.js 15 frontend
  page.tsx                      #   Landing page with cipher visualization
  vault/page.tsx                #   Vault dashboard (encrypted vs revealed)
research/shadowpool/            # 15 research documents (560KB)
  14-architecture-blueprint.md  #   THE blueprint — read this for full architecture
```

## Critical Gotchas

1. **tools-version**: `[package.metadata.solana] tools-version = "v1.52"` in program Cargo.toml. Without this, build fails with `edition2024` error (platform-tools v1.48 bundles Rust 1.84.1, needs 1.85+).

2. **ArgBuilder order MUST match circuit parameter order**: `Enc<Mxe>` args first (nonce + .account()), then plaintext args, then `Enc<Shared>` args. Wrong order → runtime `InvalidArguments` error with no helpful message.

3. **Zombie validators**: `arcium test` leaves `solana-test-validator` running after completion. The `package.json` pre/post hooks handle this (`pkill -9 -x solana-test-val`). Always use `yarn test`, never bare `arcium test`.

4. **Box large accounts**: `Cluster`, `ComputationDefinitionAccount`, and `Vault` must be `Box<Account<'info, T>>` in account structs. Otherwise BPF stack overflow (access violation).

5. **`init_comp_def` takes 3 args**: `init_comp_def(ctx.accounts, None, None)`. NOT 4 args (the `u32` priority param was removed in v0.9).

6. **Import is `use arcis::*;`**: NOT `arcis_imports` (renamed in v0.6).

7. **`if/else` on secret values works**: Arcis compiles it to constant-time execution. `.select()` also works but `if/else` is cleaner.

8. **Idempotent comp def init**: Wrap `initXCompDef` calls in try/catch that swallows "already in use" errors. The `tests/shadowpool.ts` helper does this.

9. **ENCRYPTED_STATE_OFFSET = 249**: Manually calculated from Vault struct layout (8 disc + 1 bump + 32×6 pubkeys + 8×4 u64s + 16 u128). If you add/remove fields before `encrypted_state`, recalculate this.

## Current Status

- **Backend**: 7/7 tests passing. Full rebalance cycle proven (init → compute → update → recompute with non-zero sizes → strategy update → performance reveal).
- **Frontend**: Landing page + vault dashboard scaffolded with mock data. Not connected to on-chain program yet.
- **Next priorities**: Wire frontend to on-chain data, implement proper SPL token deposit/withdraw, devnet deployment.

## Code Patterns

- Every MPC instruction follows the sealed_bid_auction pattern: queue instruction → ArgBuilder → queue_computation → callback writes to vault account
- Callbacks use `CallbackAccount { pubkey: vault.key(), is_writable: true }` to pass the vault for state mutation
- Events emitted from callbacks for frontend consumption (QuotesComputedEvent, etc.)
- Oracle prices are plaintext inputs (public data, no point encrypting)
- `comp_def_offset("circuit_name")` generates the constant for each circuit

## Arcium Skill

The `arcium-solana-dev` skill at `~/.claude/skills/arcium-solana-dev/` is fully updated to v0.9.x with verified patterns. Reference it for Arcis types, ArgBuilder methods, account structs, and TypeScript client patterns.
