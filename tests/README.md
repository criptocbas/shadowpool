# ShadowPool integration tests

## Test matrix

| Test | Cluster | Gate | What it covers |
|---|---|---|---|
| 1. creates a vault | localnet | — | InitializeVault flow |
| 2. initializes encrypted vault state | localnet | — | `create_vault_state` MPC |
| 3. computes plaintext quotes | any | `PYTH_TEST=1` | `compute_quotes` + live Pyth |
| 4. updates encrypted balances | localnet | — | `update_balances` MPC |
| 4b. recomputes quotes with non-zero sizes | any | `PYTH_TEST=1` | Full rebalance cycle |
| 5. updates encrypted strategy | localnet | — | `update_strategy` MPC |
| 5b. recomputes quotes with updated spread | any | `PYTH_TEST=1` | Strategy change reflected |
| 6. reveals total vault value | localnet | — | `reveal_performance` MPC |
| 7. state persistence | localnet | — | encrypted state survives calls |

Six tests run on every default `yarn test` (localnet, ~25s). Three
Pyth-dependent tests are gated on `PYTH_TEST=1` and a cluster with
the Pyth Solana Receiver deployed.

## Run commands

```bash
# Fast localnet cycle — 6 tests, no Pyth, no devnet
yarn test

# Clean state first (wipes the test-validator ledger)
yarn test:clean

# Devnet cycle — all 9 tests, live Pyth, requires .env.local
yarn test:devnet
# equivalent: PYTH_TEST=1 source .env.local && arcium test --cluster devnet --skip-build
```

## Why Pyth tests don't run on localnet

The `compute_quotes` instruction requires a `PriceUpdateV2` account
owned by the Pyth Solana Receiver program
(`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`). The receiver program
verifies Wormhole-guardian signatures on the VAA payload, which
requires the Wormhole guardian-set account to exist on the cluster.

In principle this can be wired into localnet via `Anchor.toml`
`[[test.validator.clone]]` directives for:

1. The Pyth Solana Receiver program.
2. The Wormhole Core Bridge program.
3. The current Wormhole GuardianSet account.
4. (Possibly) the Pyth receiver's config + treasury PDAs.

In practice the Pyth receiver's behaviour under `arcium test` has not
been reproducible enough for us to rely on it during the Frontier
window. `test:devnet` uses the real live programs on devnet where
everything is already set up and maintained by Pyth.

When a user wants to run the Pyth-dependent tests:

1. **Precondition:** the ShadowPool program has been redeployed to
   devnet with the current vault layout (includes `price_feed_id` +
   `max_price_age_seconds` fields). `source .env.local && arcium
   deploy …` to do so.

2. **Precondition:** a vault exists for the test wallet on devnet.
   Run `yarn test` once on devnet via `test:devnet` with
   `PYTH_TEST=0` first to go through the non-Pyth tests and get the
   vault + comp-defs initialized. (Or `arcium clean --only-accounts`
   if you want a fresh start.)

3. **Run Pyth tests:**
   ```bash
   PYTH_TEST=1 source .env.local && arcium test --cluster devnet --skip-build
   ```

## Helper: `getPythPriceUpdateAccount`

Located in `tests/shadowpool.ts`. Uses `@pythnetwork/hermes-client` +
`@pythnetwork/pyth-solana-receiver` to:

1. Fetch the latest signed VAA for the feed id from Hermes.
2. Call the Pyth receiver to post the update on-chain.
3. Return the resulting `PriceUpdateV2` PDA.

The helper is cluster-agnostic — it works against any connection
where the receiver is deployed. Switching from devnet to localnet (if
we ever wire up the validator clones) requires zero changes to the
helper.

## CI strategy

GitHub Actions currently runs:

- `cargo check --workspace`
- `cargo test --workspace --lib` (unit tests, no Docker, ~3s)
- `tsc --noEmit` on frontend + tests
- Occasionally `cargo +nightly fuzz run` against each target for a
  bounded time (in separate workflow, runs on `workflow_dispatch`).

Full integration (`yarn test`) needs Docker + `arcium test`, which
isn't currently wired into CI. Post-hackathon we plan to:

1. Add a nightly CI job that runs the localnet integration suite.
2. Add a devnet-nightly job that runs the full suite including Pyth
   tests against a dedicated CI wallet's devnet vault.
3. Surface fuzz-corpus coverage deltas on PRs.
