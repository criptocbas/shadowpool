# ShadowPool fuzz run report

**Run date:** 2026-04-17
**Host:** x86_64-unknown-linux-gnu, nightly-2024-11-01 rustc
**Tool:** [`cargo-fuzz`](https://rust-fuzz.github.io/book/cargo-fuzz.html) 0.13.x + `libfuzzer-sys` 0.4.12

## Targets

Each target exercises a pure-math function in the `shadowpool-math`
crate — the crate we extracted specifically so that the MPC-anchored
slippage math, Pyth normalization, and DLMM size-cap logic can be
fuzz-tested without the Anchor / Solana dependency graph.

| Target | Function under test | Config |
|---|---|---|
| `fuzz_validate_and_normalize_price` | Pyth input sanitizer + exponent normalizer | `(i64, u64, i32)` |
| `fuzz_compute_expected_amount_out` | DLMM swap output estimator + MPC size cap | `(u8, u64, u64, u64, u64, u64, u8)` |
| `fuzz_compute_safety_floor` | MPC-anchored min_amount_out floor | `(u64, u16)` |

Each target asserts the documented invariants on every Ok return path
(ratio preservation for the Pyth normalizer, cap adherence for the
DLMM helper, arithmetic equality + `floor ≤ expected_out` for the
safety floor).

## Results

| Target | Runs | Duration | Exec/s | Coverage points | Corpus | Crashes | Panics | Invariant failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `fuzz_compute_safety_floor` | 50,000,000 | 43s | ~1.16M | 45 | 5 | **0** | **0** | **0** |
| `fuzz_validate_and_normalize_price` | 119,715,918 | 121s | ~989k | 80 | 16 | **0** | **0** | **0** |
| `fuzz_compute_expected_amount_out` | 96,437,470 | 121s | ~797k | 85 | 23 | **0** | **0** | **0** |
| **Total** | **266,153,388** | **4m 45s** | — | — | **44** | **0** | **0** | **0** |

Every assertion held. No inputs caused a panic. No `unwrap()`
underneath the public helpers failed. The u128-checked arithmetic
inside each helper correctly surfaces overflow as
`MathError::MathOverflow` for every input the fuzzer produced.

## What this does (and does not) prove

**Does prove.** For 266 million randomly-generated inputs covering the
full `i64`, `u64`, `i32`, `u16`, and `u8` ranges, the three pure-math
helpers never panic, never return a value that violates the
documented invariants, and never produce silent numeric corruption.
The fuzzer found no divergence between the helper's result and a
freshly-computed reference computation for either `compute_safety_floor`
(checked via an independent arithmetic expression in the target) or
`compute_expected_amount_out` (checked via a parallel u128 compute).

**Does not prove.** Fuzzing does not establish absence of bugs in the
wider on-chain flow (account validation, CPI contracts, Arcis circuit
correctness, Pyth SDK signature verification). Those are covered by
integration tests + type checks. Fuzzing establishes the pure-math
core is robust under adversarial input distribution.

## How to reproduce

```bash
cd programs/shadowpool
cargo +nightly fuzz run fuzz_compute_safety_floor          -- -max_total_time=90
cargo +nightly fuzz run fuzz_validate_and_normalize_price  -- -max_total_time=120
cargo +nightly fuzz run fuzz_compute_expected_amount_out   -- -max_total_time=120
```

Longer runs (e.g. overnight with `-max_total_time=28800`) continue to
build coverage but have diminishing returns — libfuzzer converges on
the reachable branches within the first few million executions per
target. The corpus saved in `fuzz/corpus/<target>/` provides a fast
regression baseline for future `cargo fuzz cmin`.

## Continuous fuzzing

For post-hackathon CI:

1. Save the corpus as a build artifact and seed future runs from it.
2. Run `cargo +nightly fuzz cmin` periodically to shrink the corpus.
3. Introduce a weekly GitHub Action that runs each target for 10
   minutes against the saved corpus + publishes coverage deltas.
4. Integrate with `oss-fuzz` once ShadowPool crosses the public
   mainnet-deployment threshold.

## Findings

Nothing. Clean sweep. The helpers are correct under the input
distributions the fuzzer probed. Any future change to the math must
pass the fuzz suite before landing.
