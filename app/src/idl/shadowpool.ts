/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/shadowpool.json`.
 */
export type Shadowpool = {
  "address": "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "metadata": {
    "name": "shadowpool",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Arcium & Anchor"
  },
  "instructions": [
    {
      "name": "computeQuotes",
      "docs": [
        "Queue the MPC computation that produces a bid/ask quote from",
        "encrypted strategy plus a Pyth-verified public price.",
        "",
        "**The core value proposition**: the strategy (spread, thresholds,",
        "inventory) never leaves the MPC cluster. Only the resulting",
        "`QuoteOutput` (bid/ask price + size + rebalance flag) is revealed",
        "by the callback.",
        "",
        "Oracle price is read from a Pyth Pull Oracle `PriceUpdateV2`",
        "account supplied by the cranker. The account is owner-checked by",
        "Anchor (`Account<PriceUpdateV2>`), feed-id-checked by the context",
        "constraint against `vault.price_feed_id`, then the handler calls",
        "`get_price_no_older_than` (which re-checks feed id internally) to",
        "enforce `vault.max_price_age_seconds`. The price/confidence are",
        "then sanity-checked (positive, bounded exponent, ≤1% conf ratio)",
        "and normalised to the program's micro-USD scale before being",
        "passed to the MPC circuit as plaintext `u64`s.",
        "",
        "Caller is the cranker (gated by `cranker == vault.cranker`). The",
        "callback persists the revealed quotes to `vault.last_*` fields so",
        "`execute_rebalance` can consume them within `QUOTE_STALENESS_SLOTS`."
      ],
      "discriminator": [
        44,
        107,
        253,
        156,
        188,
        222,
        61,
        1
      ],
      "accounts": [
        {
          "name": "cranker",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "priceUpdate"
        },
        {
          "name": "signPdaAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  65,
                  114,
                  99,
                  105,
                  117,
                  109,
                  83,
                  105,
                  103,
                  110,
                  101,
                  114,
                  65,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "mempoolAccount",
          "writable": true
        },
        {
          "name": "executingPool",
          "writable": true
        },
        {
          "name": "computationAccount",
          "writable": true
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "clusterAccount",
          "writable": true
        },
        {
          "name": "poolAccount",
          "writable": true,
          "address": "G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC"
        },
        {
          "name": "clockAccount",
          "writable": true,
          "address": "7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        }
      ],
      "args": [
        {
          "name": "computationOffset",
          "type": "u64"
        }
      ]
    },
    {
      "name": "computeQuotesCallback",
      "discriminator": [
        212,
        173,
        248,
        192,
        180,
        188,
        206,
        228
      ],
      "accounts": [
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "computationAccount"
        },
        {
          "name": "clusterAccount"
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "output",
          "type": {
            "defined": {
              "name": "signedComputationOutputs",
              "generics": [
                {
                  "kind": "type",
                  "type": {
                    "defined": {
                      "name": "computeQuotesOutput"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    },
    {
      "name": "createVaultState",
      "docs": [
        "Queue the MPC computation that creates the vault's initial",
        "encrypted strategy (installs `Enc<Mxe, VaultState>`).",
        "",
        "Called by the vault authority after `initialize_vault`. Takes",
        "client-side-encrypted `spread_bps` and `rebalance_threshold`",
        "(along with the x25519 public key + nonce that encrypted them)",
        "and queues the `init_vault_state` Arcis circuit. The callback",
        "writes the resulting `Enc<Mxe, VaultState>` into the vault's",
        "`encrypted_state` field at `ENCRYPTED_STATE_OFFSET`."
      ],
      "discriminator": [
        213,
        166,
        130,
        140,
        19,
        31,
        134,
        131
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "signPdaAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  65,
                  114,
                  99,
                  105,
                  117,
                  109,
                  83,
                  105,
                  103,
                  110,
                  101,
                  114,
                  65,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "mempoolAccount",
          "writable": true
        },
        {
          "name": "executingPool",
          "writable": true
        },
        {
          "name": "computationAccount",
          "writable": true
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "clusterAccount",
          "writable": true
        },
        {
          "name": "poolAccount",
          "writable": true,
          "address": "G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC"
        },
        {
          "name": "clockAccount",
          "writable": true,
          "address": "7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        }
      ],
      "args": [
        {
          "name": "computationOffset",
          "type": "u64"
        },
        {
          "name": "encryptedSpreadBps",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "encryptedRebalanceThreshold",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "pubkey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "nonce",
          "type": "u128"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Deposit quote tokens into the vault and receive spTokens pro-rata.",
        "",
        "Pricing: if a revealed NAV exists (`last_revealed_nav > 0`),",
        "prices shares against it; otherwise uses `total_deposits_b`",
        "(equivalent to NAV pre-trade). Blocks with `NavStale` if a",
        "rebalance has occurred since the last `reveal_performance`.",
        "",
        "Post-transfer, `last_revealed_nav` is incremented by exactly",
        "`amount` since the deposit is a deterministic, non-MPC delta —",
        "no fresh reveal is needed. Rejects a zero-shares mint via",
        "`ZeroShares` (protects against dust that rounds down)."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenBMint"
        },
        {
          "name": "vaultTokenB",
          "writable": true
        },
        {
          "name": "shareMint",
          "writable": true
        },
        {
          "name": "userShareAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "executeRebalance",
      "docs": [
        "Read freshly-computed MPC quotes, CPI into Meteora DLMM to",
        "execute the trade, and mark NAV stale until the next reveal.",
        "",
        "**Authority-gated** (cranker == vault.cranker, enforced by the",
        "context constraint). Validates:",
        "- quotes exist (`quotes_slot > 0`),",
        "- they haven't been used (`!quotes_consumed`),",
        "- they aren't stale (`slot - quotes_slot <= QUOTE_STALENESS_SLOTS`),",
        "- the MPC said a rebalance was needed (`should_rebalance == 1`),",
        "- `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS` (5% ceiling),",
        "- `swap_direction` is 0 (base→quote) or 1 (quote→base),",
        "- `amount_in` is within the size the MPC revealed on the chosen side,",
        "- `min_amount_out` is at least the MPC-derived safety floor",
        "(`expected_out * (1 - MAX_ALLOWED_SLIPPAGE_BPS)`) — the cranker",
        "can *tighten* slippage but never loosen it beyond the cap.",
        "",
        "Executes a DLMM `swap` with the vault PDA as the signer. Bin",
        "arrays traversed by the swap must be pre-computed client-side",
        "and passed via `ctx.remaining_accounts` (see Meteora's TS SDK",
        "`getBinArrayForSwap`). Post-CPI the handler reloads the vault's",
        "out-side ATA, computes the real `amount_out`, and emits the",
        "event with ground-truth values.",
        "",
        "**NAV staleness**: sets `nav_stale = true` so deposit/withdraw",
        "block until the next `reveal_performance` attestation. The",
        "cranker is expected to call `update_balances` with the real",
        "deltas next to re-sync the encrypted vault state."
      ],
      "discriminator": [
        36,
        232,
        110,
        192,
        96,
        226,
        100,
        120
      ],
      "accounts": [
        {
          "name": "cranker",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "vaultTokenA",
          "writable": true
        },
        {
          "name": "vaultTokenB",
          "writable": true
        },
        {
          "name": "lbPair",
          "docs": [
            "DLMM pool state. Owner-checked against the Meteora DLMM program."
          ],
          "writable": true
        },
        {
          "name": "dlmmReserveX",
          "docs": [
            "DLMM token-X reserve. Writable; DLMM moves tokens in/out during swap."
          ],
          "writable": true
        },
        {
          "name": "dlmmReserveY",
          "docs": [
            "DLMM token-Y reserve."
          ],
          "writable": true
        },
        {
          "name": "tokenXMint",
          "docs": [
            "Mint for DLMM pool's token X. Must match one of the vault's mints",
            "(in either X/Y position). The pairing constraint is placed on",
            "`token_y_mint` so both are examined together."
          ]
        },
        {
          "name": "tokenYMint",
          "docs": [
            "Mint for DLMM pool's token Y. Must pair with `token_x_mint` so that",
            "`{token_x_mint, token_y_mint} == {vault.token_a_mint, vault.token_b_mint}`."
          ]
        },
        {
          "name": "dlmmOracle",
          "docs": [
            "DLMM per-pool oracle (Meteora's internal price record, not Pyth)."
          ],
          "writable": true
        },
        {
          "name": "tokenXProgram",
          "docs": [
            "Token program for DLMM's X-side (SPL Token or Token-2022)."
          ]
        },
        {
          "name": "tokenYProgram",
          "docs": [
            "Token program for DLMM's Y-side."
          ]
        },
        {
          "name": "dlmmEventAuthority",
          "docs": [
            "DLMM event authority PDA (`[b\"__event_authority\"]` under DLMM)."
          ]
        },
        {
          "name": "dlmmProgram",
          "docs": [
            "DLMM program self-reference, required by emit_cpi!."
          ],
          "address": "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"
        }
      ],
      "args": [
        {
          "name": "swapDirection",
          "type": "u8"
        },
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minAmountOut",
          "type": "u64"
        },
        {
          "name": "maxSlippageBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initComputeQuotesCompDef",
      "docs": [
        "Register the `compute_quotes` Arcis circuit with the MXE."
      ],
      "discriminator": [
        183,
        89,
        240,
        114,
        144,
        156,
        195,
        80
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initRevealPerformanceCompDef",
      "docs": [
        "Register the `reveal_performance` Arcis circuit with the MXE."
      ],
      "discriminator": [
        89,
        19,
        148,
        229,
        249,
        110,
        94,
        131
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initUpdateBalancesCompDef",
      "docs": [
        "Register the `update_balances` Arcis circuit with the MXE."
      ],
      "discriminator": [
        147,
        202,
        233,
        56,
        138,
        103,
        230,
        146
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initUpdateStrategyCompDef",
      "docs": [
        "Register the `update_strategy` Arcis circuit with the MXE."
      ],
      "discriminator": [
        188,
        74,
        16,
        44,
        81,
        214,
        218,
        121
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initVaultStateCallback",
      "discriminator": [
        156,
        149,
        241,
        49,
        85,
        127,
        80,
        9
      ],
      "accounts": [
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "computationAccount"
        },
        {
          "name": "clusterAccount"
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "output",
          "type": {
            "defined": {
              "name": "signedComputationOutputs",
              "generics": [
                {
                  "kind": "type",
                  "type": {
                    "defined": {
                      "name": "initVaultStateOutput"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    },
    {
      "name": "initVaultStateCompDef",
      "docs": [
        "Register the `init_vault_state` Arcis circuit with the MXE."
      ],
      "discriminator": [
        136,
        243,
        15,
        160,
        243,
        123,
        250,
        228
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeVault",
      "docs": [
        "Creates the vault PDA + bookkeeping fields.",
        "",
        "Runs the creator-time safety checks via account constraints + an",
        "explicit Token-2022 extension allow-list inside the handler:",
        "(1) distinct token A/B mints, (2) vault token accounts with no",
        "delegate and no close authority, (3) share mint with the vault",
        "PDA as mint authority, zero supply, and no freeze authority,",
        "(4) every mint (token_a, token_b, share) free of Token-2022",
        "extensions that would compromise custody or accounting",
        "(PermanentDelegate, TransferFeeConfig, ConfidentialTransferMint,",
        "DefaultAccountState, NonTransferable, TransferHook). After",
        "creation the encrypted state is still all zeros — the owner",
        "must call `create_vault_state` (MPC) to install the initial",
        "strategy parameters.",
        "",
        "Oracle parameters:",
        "- `price_feed_id` — 32-byte chain-agnostic Pyth feed ID",
        "(e.g. SOL/USD = `0xef0d…b56d`). Gates which Pyth account is",
        "accepted by `compute_quotes`. Auditors prefer this in per-",
        "vault config over hard-coded program constants because it",
        "lets governance rotate a compromised feed without redeploy.",
        "- `max_price_age_seconds` — maximum staleness of a Pyth update",
        "passed to `compute_quotes`. Industry default is 30s; tighter",
        "values (10–15s) require the cranker to post the VAA in the",
        "same transaction. Must be > 0.",
        "",
        "Emits `VaultCreatedEvent` with slot."
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "tokenAMint"
        },
        {
          "name": "tokenBMint"
        },
        {
          "name": "tokenAVault"
        },
        {
          "name": "tokenBVault"
        },
        {
          "name": "shareMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "priceFeedId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "maxPriceAgeSeconds",
          "type": "u64"
        }
      ]
    },
    {
      "name": "revealPerformance",
      "docs": [
        "Queue the MPC computation that reveals the vault's total value",
        "(in quote units), without disclosing the underlying balances or",
        "strategy.",
        "",
        "The callback writes the result to `vault.last_revealed_nav` and",
        "clears `vault.nav_stale`, which unblocks subsequent deposits",
        "and withdrawals. The caller is unrestricted so any observer",
        "can request a fresh NAV reveal; the *content* revealed is only",
        "the aggregate total.",
        "",
        "This is the \"selective disclosure\" primitive that lets auditors",
        "attest to solvency or performance without touching the strategy."
      ],
      "discriminator": [
        244,
        34,
        222,
        185,
        223,
        67,
        151,
        16
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "signPdaAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  65,
                  114,
                  99,
                  105,
                  117,
                  109,
                  83,
                  105,
                  103,
                  110,
                  101,
                  114,
                  65,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "mempoolAccount",
          "writable": true
        },
        {
          "name": "executingPool",
          "writable": true
        },
        {
          "name": "computationAccount",
          "writable": true
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "clusterAccount",
          "writable": true
        },
        {
          "name": "poolAccount",
          "writable": true,
          "address": "G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC"
        },
        {
          "name": "clockAccount",
          "writable": true,
          "address": "7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        }
      ],
      "args": [
        {
          "name": "computationOffset",
          "type": "u64"
        }
      ]
    },
    {
      "name": "revealPerformanceCallback",
      "discriminator": [
        219,
        254,
        250,
        210,
        242,
        102,
        186,
        201
      ],
      "accounts": [
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "computationAccount"
        },
        {
          "name": "clusterAccount"
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "output",
          "type": {
            "defined": {
              "name": "signedComputationOutputs",
              "generics": [
                {
                  "kind": "type",
                  "type": {
                    "defined": {
                      "name": "revealPerformanceOutput"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    },
    {
      "name": "setCranker",
      "docs": [
        "Authority-only: re-assign `vault.cranker`. Every MPC rebalance",
        "instruction (`compute_quotes`, `update_balances`,",
        "`execute_rebalance`) is gated on `cranker == vault.cranker`, so",
        "this is how a vault owner promotes a delegated cranker (e.g. a",
        "hot wallet on a cranking bot) without handing over ownership.",
        "Passing `new_cranker = vault.authority` reverts to the default",
        "self-cranking model.",
        "",
        "Emits `CrankerSetEvent` with the old and new cranker."
      ],
      "discriminator": [
        175,
        5,
        111,
        78,
        71,
        59,
        188,
        129
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newCranker",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateBalances",
      "docs": [
        "Queue the MPC computation that applies post-trade deltas to the",
        "encrypted vault state.",
        "",
        "Called after `execute_rebalance` finishes a DEX CPI, with the",
        "actual base/quote tokens received and sent. The circuit uses",
        "u128 saturating arithmetic so a malformed cranker can't",
        "underflow the encrypted balance. Also records `new_mid_price`",
        "so subsequent `compute_quotes` calls can check price drift."
      ],
      "discriminator": [
        111,
        250,
        86,
        81,
        226,
        116,
        65,
        34
      ],
      "accounts": [
        {
          "name": "cranker",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "signPdaAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  65,
                  114,
                  99,
                  105,
                  117,
                  109,
                  83,
                  105,
                  103,
                  110,
                  101,
                  114,
                  65,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "mempoolAccount",
          "writable": true
        },
        {
          "name": "executingPool",
          "writable": true
        },
        {
          "name": "computationAccount",
          "writable": true
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "clusterAccount",
          "writable": true
        },
        {
          "name": "poolAccount",
          "writable": true,
          "address": "G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC"
        },
        {
          "name": "clockAccount",
          "writable": true,
          "address": "7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        }
      ],
      "args": [
        {
          "name": "computationOffset",
          "type": "u64"
        },
        {
          "name": "baseReceived",
          "type": "u64"
        },
        {
          "name": "baseSent",
          "type": "u64"
        },
        {
          "name": "quoteReceived",
          "type": "u64"
        },
        {
          "name": "quoteSent",
          "type": "u64"
        },
        {
          "name": "newMidPrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateBalancesCallback",
      "discriminator": [
        125,
        220,
        232,
        224,
        80,
        53,
        19,
        181
      ],
      "accounts": [
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "computationAccount"
        },
        {
          "name": "clusterAccount"
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "output",
          "type": {
            "defined": {
              "name": "signedComputationOutputs",
              "generics": [
                {
                  "kind": "type",
                  "type": {
                    "defined": {
                      "name": "updateBalancesOutput"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    },
    {
      "name": "updateStrategy",
      "docs": [
        "Queue the MPC computation that replaces the vault's encrypted",
        "`spread_bps` and `rebalance_threshold` with new client-encrypted",
        "values.",
        "",
        "Authority-only (enforced by `has_one = authority` on the context).",
        "Leaves balances and `last_mid_price` untouched; only the strategy",
        "parameters change. An observer sees the vault's quotes shift",
        "after the next `compute_quotes`, but cannot see why."
      ],
      "discriminator": [
        16,
        76,
        138,
        179,
        171,
        112,
        196,
        21
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "signPdaAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  65,
                  114,
                  99,
                  105,
                  117,
                  109,
                  83,
                  105,
                  103,
                  110,
                  101,
                  114,
                  65,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "mempoolAccount",
          "writable": true
        },
        {
          "name": "executingPool",
          "writable": true
        },
        {
          "name": "computationAccount",
          "writable": true
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "clusterAccount",
          "writable": true
        },
        {
          "name": "poolAccount",
          "writable": true,
          "address": "G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC"
        },
        {
          "name": "clockAccount",
          "writable": true,
          "address": "7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        }
      ],
      "args": [
        {
          "name": "computationOffset",
          "type": "u64"
        },
        {
          "name": "encryptedSpreadBps",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "encryptedRebalanceThreshold",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "pubkey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "nonce",
          "type": "u128"
        }
      ]
    },
    {
      "name": "updateStrategyCallback",
      "discriminator": [
        167,
        213,
        246,
        250,
        80,
        40,
        203,
        225
      ],
      "accounts": [
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "computationAccount"
        },
        {
          "name": "clusterAccount"
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "output",
          "type": {
            "defined": {
              "name": "signedComputationOutputs",
              "generics": [
                {
                  "kind": "type",
                  "type": {
                    "defined": {
                      "name": "updateStrategyOutput"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Burn spTokens and receive a pro-rata share of the vault's quote",
        "tokens.",
        "",
        "Pricing mirrors deposit (NAV-aware; blocks when `nav_stale`).",
        "Also enforces a real-balance solvency check: `vault_token_b.amount",
        ">= amount_out` — catches cases where the on-chain SPL balance",
        "has diverged from the bookkeeping counter (only possible post-",
        "DEX-CPI, but the check is cheap defence-in-depth).",
        "",
        "Post-transfer, `last_revealed_nav` decrements by `amount_out`",
        "(saturating to avoid sub-satoshi residuals from rounding)."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.authority",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenBMint"
        },
        {
          "name": "vaultTokenB",
          "writable": true
        },
        {
          "name": "shareMint",
          "writable": true
        },
        {
          "name": "userShareAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "arciumSignerAccount",
      "discriminator": [
        214,
        157,
        122,
        114,
        117,
        44,
        214,
        74
      ]
    },
    {
      "name": "clockAccount",
      "discriminator": [
        152,
        171,
        158,
        195,
        75,
        61,
        51,
        8
      ]
    },
    {
      "name": "cluster",
      "discriminator": [
        236,
        225,
        118,
        228,
        173,
        106,
        18,
        60
      ]
    },
    {
      "name": "computationDefinitionAccount",
      "discriminator": [
        245,
        176,
        217,
        221,
        253,
        104,
        172,
        200
      ]
    },
    {
      "name": "feePool",
      "discriminator": [
        172,
        38,
        77,
        146,
        148,
        5,
        51,
        242
      ]
    },
    {
      "name": "mxeAccount",
      "discriminator": [
        103,
        26,
        85,
        250,
        179,
        159,
        17,
        117
      ]
    },
    {
      "name": "priceUpdateV2",
      "discriminator": [
        34,
        241,
        35,
        99,
        157,
        126,
        244,
        205
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "balancesUpdatedEvent",
      "discriminator": [
        249,
        64,
        182,
        65,
        125,
        32,
        180,
        222
      ]
    },
    {
      "name": "crankerSetEvent",
      "discriminator": [
        46,
        207,
        206,
        179,
        217,
        161,
        171,
        246
      ]
    },
    {
      "name": "depositEvent",
      "discriminator": [
        120,
        248,
        61,
        83,
        31,
        142,
        107,
        144
      ]
    },
    {
      "name": "performanceRevealedEvent",
      "discriminator": [
        124,
        161,
        43,
        100,
        119,
        189,
        139,
        197
      ]
    },
    {
      "name": "quotesComputedEvent",
      "discriminator": [
        223,
        126,
        29,
        96,
        129,
        227,
        191,
        174
      ]
    },
    {
      "name": "quotesOverwrittenEvent",
      "discriminator": [
        223,
        236,
        49,
        194,
        179,
        85,
        82,
        232
      ]
    },
    {
      "name": "rebalanceExecutedEvent",
      "discriminator": [
        114,
        34,
        215,
        49,
        130,
        101,
        33,
        2
      ]
    },
    {
      "name": "strategyUpdatedEvent",
      "discriminator": [
        223,
        225,
        12,
        83,
        237,
        144,
        10,
        160
      ]
    },
    {
      "name": "vaultCreatedEvent",
      "discriminator": [
        81,
        80,
        244,
        58,
        136,
        54,
        236,
        111
      ]
    },
    {
      "name": "vaultStateInitializedEvent",
      "discriminator": [
        70,
        21,
        252,
        90,
        73,
        88,
        187,
        219
      ]
    },
    {
      "name": "withdrawEvent",
      "discriminator": [
        22,
        9,
        133,
        26,
        160,
        44,
        71,
        192
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "abortedComputation",
      "msg": "Arcium MPC computation was aborted by the cluster"
    },
    {
      "code": 6001,
      "name": "clusterNotSet",
      "msg": "Arcium cluster offset is not configured for this MXE"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "Caller is not authorized for this vault operation"
    },
    {
      "code": 6003,
      "name": "vaultNotInitialized",
      "msg": "Encrypted vault state has not been initialized — call create_vault_state first"
    },
    {
      "code": 6004,
      "name": "invalidAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6005,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow in vault math — inputs out of realistic range"
    },
    {
      "code": 6006,
      "name": "insufficientBalance",
      "msg": "Insufficient quote balance on the vault for this withdrawal"
    },
    {
      "code": 6007,
      "name": "zeroShares",
      "msg": "Share calculation resulted in zero shares; amount is too small relative to NAV"
    },
    {
      "code": 6008,
      "name": "mintMismatch",
      "msg": "Provided token mint does not match the vault's configured mint"
    },
    {
      "code": 6009,
      "name": "vaultOwnerMismatch",
      "msg": "Vault token account owner does not match the vault PDA"
    },
    {
      "code": 6010,
      "name": "noQuotesAvailable",
      "msg": "No quotes have been computed yet — run compute_quotes first"
    },
    {
      "code": 6011,
      "name": "quotesAlreadyConsumed",
      "msg": "Quotes have already been consumed by a previous rebalance — recompute them"
    },
    {
      "code": 6012,
      "name": "quotesStale",
      "msg": "Quotes are stale (older than 150 slots, ~60s) — recompute before rebalancing"
    },
    {
      "code": 6013,
      "name": "rebalanceNotNeeded",
      "msg": "MPC indicated no rebalance is needed for the current oracle price"
    },
    {
      "code": 6014,
      "name": "slippageTooHigh",
      "msg": "Slippage tolerance exceeds the 5% ceiling (500 bps) — lower max_slippage_bps"
    },
    {
      "code": 6015,
      "name": "navStale",
      "msg": "NAV is stale after a rebalance — call reveal_performance to refresh before deposit/withdraw"
    },
    {
      "code": 6016,
      "name": "invalidMint",
      "msg": "Mint is not safe for vault use (e.g. has a freeze authority)"
    },
    {
      "code": 6017,
      "name": "invalidVaultAccount",
      "msg": "Vault token account is not safe (delegate or close authority is set)"
    },
    {
      "code": 6018,
      "name": "duplicateMint",
      "msg": "Provided mints or token accounts are duplicates of one another"
    },
    {
      "code": 6019,
      "name": "zeroNavBasis",
      "msg": "NAV basis is zero while shares are outstanding — recover with reveal_performance"
    },
    {
      "code": 6020,
      "name": "disallowedMintExtension",
      "msg": "Mint carries a Token-2022 extension that is not allowed for vault use"
    },
    {
      "code": 6021,
      "name": "priceFeedMismatch",
      "msg": "Pyth price update does not match the vault's configured feed_id"
    },
    {
      "code": 6022,
      "name": "negativePrice",
      "msg": "Pyth reported a negative or zero price — unexpected for a spot feed"
    },
    {
      "code": 6023,
      "name": "invalidPriceExponent",
      "msg": "Pyth price exponent is outside the accepted [-18, 0] range"
    },
    {
      "code": 6024,
      "name": "priceTooUncertain",
      "msg": "Pyth confidence interval exceeds the 1% tolerance — price is unreliable"
    },
    {
      "code": 6025,
      "name": "invalidSwapDirection",
      "msg": "Swap direction must be 0 (base→quote) or 1 (quote→base)"
    },
    {
      "code": 6026,
      "name": "invalidDlmmPool",
      "msg": "DLMM pool account owner does not match the Meteora DLMM program"
    },
    {
      "code": 6027,
      "name": "slippageFloorViolated",
      "msg": "Caller-supplied min_amount_out is below the MPC-price safety floor"
    },
    {
      "code": 6028,
      "name": "swapAmountExceedsMpcSize",
      "msg": "Requested swap amount exceeds the size the MPC strategy revealed"
    },
    {
      "code": 6029,
      "name": "missingBinArrays",
      "msg": "No bin arrays supplied — DLMM swap requires at least one via remaining_accounts"
    }
  ],
  "types": [
    {
      "name": "activation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "activationEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "deactivationEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          }
        ]
      }
    },
    {
      "name": "arciumSignerAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bn254g2blsPublicKey",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "array": [
              "u8",
              64
            ]
          }
        ]
      }
    },
    {
      "name": "balancesUpdatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "circuitSource",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "local",
            "fields": [
              {
                "defined": {
                  "name": "localCircuitSource"
                }
              }
            ]
          },
          {
            "name": "onChain",
            "fields": [
              {
                "defined": {
                  "name": "onChainCircuitSource"
                }
              }
            ]
          },
          {
            "name": "offChain",
            "fields": [
              {
                "defined": {
                  "name": "offChainCircuitSource"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "clockAccount",
      "docs": [
        "An account storing the current network epoch"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "startEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "currentEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "startEpochTimestamp",
            "type": {
              "defined": {
                "name": "timestamp"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "cluster",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tdInfo",
            "type": {
              "option": {
                "defined": {
                  "name": "nodeMetadata"
                }
              }
            }
          },
          {
            "name": "authority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "clusterSize",
            "type": "u16"
          },
          {
            "name": "activation",
            "type": {
              "defined": {
                "name": "activation"
              }
            }
          },
          {
            "name": "maxCapacity",
            "type": "u64"
          },
          {
            "name": "cuPrice",
            "type": "u64"
          },
          {
            "name": "cuPriceProposals",
            "type": {
              "array": [
                "u64",
                32
              ]
            }
          },
          {
            "name": "lastUpdatedEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "nodes",
            "type": {
              "vec": {
                "defined": {
                  "name": "nodeRef"
                }
              }
            }
          },
          {
            "name": "pendingNodes",
            "type": {
              "vec": "u32"
            }
          },
          {
            "name": "blsPublicKey",
            "type": {
              "defined": {
                "name": "setUnset",
                "generics": [
                  {
                    "kind": "type",
                    "type": {
                      "defined": {
                        "name": "bn254g2blsPublicKey"
                      }
                    }
                  }
                ]
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "computationDefinitionAccount",
      "docs": [
        "An account representing a [ComputationDefinition] in a MXE."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "finalizationAuthority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "cuAmount",
            "type": "u64"
          },
          {
            "name": "definition",
            "type": {
              "defined": {
                "name": "computationDefinitionMeta"
              }
            }
          },
          {
            "name": "circuitSource",
            "type": {
              "defined": {
                "name": "circuitSource"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "computationDefinitionMeta",
      "docs": [
        "A computation definition for execution in a MXE."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circuitLen",
            "type": "u32"
          },
          {
            "name": "signature",
            "type": {
              "defined": {
                "name": "computationSignature"
              }
            }
          }
        ]
      }
    },
    {
      "name": "computationSignature",
      "docs": [
        "The signature of a computation defined in a [ComputationDefinition]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "parameters",
            "type": {
              "vec": {
                "defined": {
                  "name": "parameter"
                }
              }
            }
          },
          {
            "name": "outputs",
            "type": {
              "vec": {
                "defined": {
                  "name": "output"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "computeQuotesOutput",
      "docs": [
        "The output of the callback instruction. Provided as a struct with ordered fields",
        "as anchor does not support tuples and tuple structs yet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": {
              "defined": {
                "name": "computeQuotesOutputStruct0"
              }
            }
          }
        ]
      }
    },
    {
      "name": "computeQuotesOutputStruct0",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": "u64"
          },
          {
            "name": "field1",
            "type": "u64"
          },
          {
            "name": "field2",
            "type": "u64"
          },
          {
            "name": "field3",
            "type": "u64"
          },
          {
            "name": "field4",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "crankerSetEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "previousCranker",
            "type": "pubkey"
          },
          {
            "name": "newCranker",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "depositEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "sharesMinted",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "docs": [
        "The network epoch"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          "u64"
        ]
      }
    },
    {
      "name": "feePool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "initVaultStateOutput",
      "docs": [
        "The output of the callback instruction. Provided as a struct with ordered fields",
        "as anchor does not support tuples and tuple structs yet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": {
              "defined": {
                "name": "mxeEncryptedStruct",
                "generics": [
                  {
                    "kind": "const",
                    "value": "5"
                  }
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "localCircuitSource",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "mxeKeygen"
          },
          {
            "name": "mxeKeyRecoveryInit"
          },
          {
            "name": "mxeKeyRecoveryFinalize"
          }
        ]
      }
    },
    {
      "name": "mxeAccount",
      "docs": [
        "A MPC Execution Environment."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cluster",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "keygenOffset",
            "type": "u64"
          },
          {
            "name": "keyRecoveryInitOffset",
            "type": "u64"
          },
          {
            "name": "mxeProgramId",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "utilityPubkeys",
            "type": {
              "defined": {
                "name": "setUnset",
                "generics": [
                  {
                    "kind": "type",
                    "type": {
                      "defined": {
                        "name": "utilityPubkeys"
                      }
                    }
                  }
                ]
              }
            }
          },
          {
            "name": "lutOffsetSlot",
            "type": "u64"
          },
          {
            "name": "computationDefinitions",
            "type": {
              "vec": "u32"
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "mxeStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "mxeEncryptedStruct",
      "generics": [
        {
          "kind": "const",
          "name": "len",
          "type": "usize"
        }
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "type": "u128"
          },
          {
            "name": "ciphertexts",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                {
                  "generic": "len"
                }
              ]
            }
          }
        ]
      }
    },
    {
      "name": "mxeStatus",
      "docs": [
        "The status of an MXE."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "migration"
          }
        ]
      }
    },
    {
      "name": "nodeMetadata",
      "docs": [
        "location as [ISO 3166-1 alpha-2](https://www.iso.org/iso-3166-country-codes.html) country code"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ip",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "peerId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "location",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "nodeRef",
      "docs": [
        "A reference to a node in the cluster.",
        "The offset is to derive the Node Account.",
        "The current_total_rewards is the total rewards the node has received so far in the current",
        "epoch."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "offset",
            "type": "u32"
          },
          {
            "name": "currentTotalRewards",
            "type": "u64"
          },
          {
            "name": "vote",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "offChainCircuitSource",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "source",
            "type": "string"
          },
          {
            "name": "hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "onChainCircuitSource",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "isCompleted",
            "type": "bool"
          },
          {
            "name": "uploadAuth",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "output",
      "docs": [
        "An output of a computation.",
        "We currently don't support encrypted outputs yet since encrypted values are passed via",
        "data objects."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "plaintextBool"
          },
          {
            "name": "plaintextU8"
          },
          {
            "name": "plaintextU16"
          },
          {
            "name": "plaintextU32"
          },
          {
            "name": "plaintextU64"
          },
          {
            "name": "plaintextU128"
          },
          {
            "name": "ciphertext"
          },
          {
            "name": "arcisX25519Pubkey"
          },
          {
            "name": "plaintextFloat"
          },
          {
            "name": "plaintextPoint"
          },
          {
            "name": "plaintextI8"
          },
          {
            "name": "plaintextI16"
          },
          {
            "name": "plaintextI32"
          },
          {
            "name": "plaintextI64"
          },
          {
            "name": "plaintextI128"
          }
        ]
      }
    },
    {
      "name": "parameter",
      "docs": [
        "A parameter of a computation.",
        "We differentiate between plaintext and encrypted parameters and data objects.",
        "Plaintext parameters are directly provided as their value.",
        "Encrypted parameters are provided as an offchain reference to the data.",
        "Data objects are provided as a reference to the data object account."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "plaintextBool"
          },
          {
            "name": "plaintextU8"
          },
          {
            "name": "plaintextU16"
          },
          {
            "name": "plaintextU32"
          },
          {
            "name": "plaintextU64"
          },
          {
            "name": "plaintextU128"
          },
          {
            "name": "ciphertext"
          },
          {
            "name": "arcisX25519Pubkey"
          },
          {
            "name": "arcisSignature"
          },
          {
            "name": "plaintextFloat"
          },
          {
            "name": "plaintextI8"
          },
          {
            "name": "plaintextI16"
          },
          {
            "name": "plaintextI32"
          },
          {
            "name": "plaintextI64"
          },
          {
            "name": "plaintextI128"
          },
          {
            "name": "plaintextPoint"
          }
        ]
      }
    },
    {
      "name": "performanceRevealedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "totalValueInQuote",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceFeedMessage",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feedId",
            "docs": [
              "`FeedId` but avoid the type alias because of compatibility issues with Anchor's `idl-build` feature."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "conf",
            "type": "u64"
          },
          {
            "name": "exponent",
            "type": "i32"
          },
          {
            "name": "publishTime",
            "docs": [
              "The timestamp of this price update in seconds"
            ],
            "type": "i64"
          },
          {
            "name": "prevPublishTime",
            "docs": [
              "The timestamp of the previous price update. This field is intended to allow users to",
              "identify the single unique price update for any moment in time:",
              "for any time t, the unique update is the one such that prev_publish_time < t <= publish_time.",
              "",
              "Note that there may not be such an update while we are migrating to the new message-sending logic,",
              "as some price updates on pythnet may not be sent to other chains (because the message-sending",
              "logic may not have triggered). We can solve this problem by making the message-sending mandatory",
              "(which we can do once publishers have migrated over).",
              "",
              "Additionally, this field may be equal to publish_time if the message is sent on a slot where",
              "where the aggregation was unsuccesful. This problem will go away once all publishers have",
              "migrated over to a recent version of pyth-agent."
            ],
            "type": "i64"
          },
          {
            "name": "emaPrice",
            "type": "i64"
          },
          {
            "name": "emaConf",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceUpdateV2",
      "docs": [
        "A price update account. This account is used by the Pyth Receiver program to store a verified price update from a Pyth price feed.",
        "It contains:",
        "- `write_authority`: The write authority for this account. This authority can close this account to reclaim rent or update the account to contain a different price update.",
        "- `verification_level`: The [`VerificationLevel`] of this price update. This represents how many Wormhole guardian signatures have been verified for this price update.",
        "- `price_message`: The actual price update.",
        "- `posted_slot`: The slot at which this price update was posted."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "writeAuthority",
            "type": "pubkey"
          },
          {
            "name": "verificationLevel",
            "type": {
              "defined": {
                "name": "verificationLevel"
              }
            }
          },
          {
            "name": "priceMessage",
            "type": {
              "defined": {
                "name": "priceFeedMessage"
              }
            }
          },
          {
            "name": "postedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "quotesComputedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "bidPrice",
            "type": "u64"
          },
          {
            "name": "bidSize",
            "type": "u64"
          },
          {
            "name": "askPrice",
            "type": "u64"
          },
          {
            "name": "askSize",
            "type": "u64"
          },
          {
            "name": "shouldRebalance",
            "type": "u8"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "quotesOverwrittenEvent",
      "docs": [
        "Emitted when `compute_quotes_callback` overwrites a still-unconsumed",
        "quote. Useful for surfacing missed cranker work or competing crankers."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "previousSlot",
            "type": "u64"
          },
          {
            "name": "previousBidPrice",
            "type": "u64"
          },
          {
            "name": "previousAskPrice",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rebalanceExecutedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "bidPrice",
            "type": "u64"
          },
          {
            "name": "bidSize",
            "type": "u64"
          },
          {
            "name": "askPrice",
            "type": "u64"
          },
          {
            "name": "askSize",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "revealPerformanceOutput",
      "docs": [
        "The output of the callback instruction. Provided as a struct with ordered fields",
        "as anchor does not support tuples and tuple structs yet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "setUnset",
      "docs": [
        "Utility struct to store a value that needs to be set by a certain number of participants (keys",
        "in our case). Once all participants have set the value, the value is considered set and we only",
        "store it once."
      ],
      "generics": [
        {
          "kind": "type",
          "name": "t"
        }
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "set",
            "fields": [
              {
                "generic": "t"
              }
            ]
          },
          {
            "name": "unset",
            "fields": [
              {
                "generic": "t"
              },
              {
                "vec": "bool"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "signedComputationOutputs",
      "generics": [
        {
          "kind": "type",
          "name": "o"
        }
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "success",
            "fields": [
              {
                "generic": "o"
              },
              {
                "array": [
                  "u8",
                  64
                ]
              }
            ]
          },
          {
            "name": "failure"
          },
          {
            "name": "markerForIdlBuildDoNotUseThis",
            "fields": [
              {
                "generic": "o"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "strategyUpdatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "timestamp",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "updateBalancesOutput",
      "docs": [
        "The output of the callback instruction. Provided as a struct with ordered fields",
        "as anchor does not support tuples and tuple structs yet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": {
              "defined": {
                "name": "mxeEncryptedStruct",
                "generics": [
                  {
                    "kind": "const",
                    "value": "5"
                  }
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "updateStrategyOutput",
      "docs": [
        "The output of the callback instruction. Provided as a struct with ordered fields",
        "as anchor does not support tuples and tuple structs yet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": {
              "defined": {
                "name": "mxeEncryptedStruct",
                "generics": [
                  {
                    "kind": "const",
                    "value": "5"
                  }
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "utilityPubkeys",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "x25519Pubkey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ed25519VerifyingKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "elgamalPubkey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pubkeyValidityProof",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "The vault account.",
        "",
        "**Byte layout is load-bearing.** The MPC cluster reads encrypted state",
        "directly from this account's raw bytes at",
        "`constants::ENCRYPTED_STATE_OFFSET` (249) via `.account(...)` in",
        "ArgBuilder. Do not reorder fields above `encrypted_state` without",
        "updating both the constant and the invariant test in `lib.rs`.",
        "",
        "Field groups, in order:",
        "1. Identity (`bump`, `authority`, mint/vault/share pubkeys).",
        "2. Bookkeeping counters (`total_shares`, `total_deposits_*`, slot).",
        "3. MPC state nonce + `encrypted_state` ciphertexts.",
        "4. Quote persistence (plaintext after MPC reveal; appended after",
        "`encrypted_state` to preserve the offset).",
        "5. NAV tracking (authoritative share-pricing basis post-trade).",
        "6. Authorization (the `cranker` pubkey allowed to drive the MPC",
        "rebalance flow; defaults to `authority` at init so the legacy",
        "authority-only flow keeps working, with a future `set_cranker`",
        "instruction unlocking delegated/trustless cranking)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "tokenAMint",
            "type": "pubkey"
          },
          {
            "name": "tokenBMint",
            "type": "pubkey"
          },
          {
            "name": "tokenAVault",
            "type": "pubkey"
          },
          {
            "name": "tokenBVault",
            "type": "pubkey"
          },
          {
            "name": "shareMint",
            "type": "pubkey"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "totalDepositsA",
            "docs": [
              "Reserved for future base-side deposits. Not written today (deposits",
              "are quote-only by design). Kept in the preamble so that enabling",
              "base-side deposits later does not shift `ENCRYPTED_STATE_OFFSET`."
            ],
            "type": "u64"
          },
          {
            "name": "totalDepositsB",
            "type": "u64"
          },
          {
            "name": "lastRebalanceSlot",
            "docs": [
              "Slot when the most recent `execute_rebalance` executed. Written",
              "only by `execute_rebalance`; `compute_quotes_callback` tracks its",
              "own slot separately in `quotes_slot` below."
            ],
            "type": "u64"
          },
          {
            "name": "stateNonce",
            "type": "u128"
          },
          {
            "name": "encryptedState",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                5
              ]
            }
          },
          {
            "name": "lastBidPrice",
            "type": "u64"
          },
          {
            "name": "lastBidSize",
            "type": "u64"
          },
          {
            "name": "lastAskPrice",
            "type": "u64"
          },
          {
            "name": "lastAskSize",
            "type": "u64"
          },
          {
            "name": "lastShouldRebalance",
            "type": "u8"
          },
          {
            "name": "quotesSlot",
            "docs": [
              "Slot when quotes were computed; used for staleness check in",
              "`execute_rebalance`."
            ],
            "type": "u64"
          },
          {
            "name": "quotesConsumed",
            "docs": [
              "True once `execute_rebalance` consumes the quotes. Prevents replay",
              "of the same quote cycle."
            ],
            "type": "bool"
          },
          {
            "name": "lastRevealedNav",
            "type": "u64"
          },
          {
            "name": "lastRevealedNavSlot",
            "type": "u64"
          },
          {
            "name": "navStale",
            "type": "bool"
          },
          {
            "name": "cranker",
            "type": "pubkey"
          },
          {
            "name": "priceFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxPriceAgeSeconds",
            "docs": [
              "Maximum age (seconds) a Pyth price update can carry before being",
              "rejected as stale. Typical value: 30 (matches Pyth's own docs",
              "example). Tighter is safer for MEV-sensitive flows but demands",
              "that the cranker post a fresh VAA in the same transaction."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultCreatedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "tokenAMint",
            "type": "pubkey"
          },
          {
            "name": "tokenBMint",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultStateInitializedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "verificationLevel",
      "docs": [
        "Pyth price updates are bridged to all blockchains via Wormhole.",
        "Using the price updates on another chain requires verifying the signatures of the Wormhole guardians.",
        "The usual process is to check the signatures for two thirds of the total number of guardians, but this can be cumbersome on Solana because of the transaction size limits,",
        "so we also allow for partial verification.",
        "",
        "This enum represents how much a price update has been verified:",
        "- If `Full`, we have verified the signatures for two thirds of the current guardians.",
        "- If `Partial`, only `num_signatures` guardian signatures have been checked.",
        "",
        "# Warning",
        "Using partially verified price updates is dangerous, as it lowers the threshold of guardians that need to collude to produce a malicious price update."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "partial",
            "fields": [
              {
                "name": "numSignatures",
                "type": "u8"
              }
            ]
          },
          {
            "name": "full"
          }
        ]
      }
    },
    {
      "name": "withdrawEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "sharesBurned",
            "type": "u64"
          },
          {
            "name": "amountOut",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
