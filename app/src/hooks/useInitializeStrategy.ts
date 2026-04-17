"use client";

import { useCallback, useState } from "react";
import {
  useConnection,
  useAnchorWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import { getProgram } from "@/lib/program";
import {
  DEVNET_CLUSTER_OFFSET,
  getVaultPDA,
} from "@/lib/constants";
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getClusterAccAddress,
} from "@/lib/arcium-pdas";

/**
 * State-machine phases surfaced to the UI. Each step has non-trivial
 * latency (wallet signature prompt, on-chain queue, MPC round trip) so
 * the UX must report what's happening rather than spin a generic
 * loader.
 */
export type InitializeStrategyPhase =
  | "idle"
  | "signing-key"
  | "fetching-mxe"
  | "encrypting"
  | "queueing"
  | "awaiting-mpc"
  | "complete"
  | "error";

export interface InitializeStrategyParams {
  /** Spread in basis points. 1–9999 (clamped at 9999 by the circuit). */
  spreadBps: number;
  /** Rebalance threshold in basis points. 1–9999. */
  rebalanceThresholdBps: number;
}

export interface InitializeStrategyResult {
  /** The create_vault_state tx signature. */
  txSig: string;
  /** Client-derived x25519 pubkey, persisted for later update_strategy calls. */
  encryptionPublicKey: Uint8Array;
}

// Max MPC round-trip tolerance. Devnet typically completes in 3–10s;
// a cluster issue stretches it but a full minute signals a real hang.
const MPC_TIMEOUT_MS = 60_000;

/**
 * Deterministic x25519 key derivation from a Solana wallet signature.
 *
 * Every call to `initialize` signs the exact same message, so the same
 * wallet always derives the same encryption keypair. This is the
 * production pattern from the Arcium docs: no random secret lives in
 * localStorage; re-signing the message regenerates the key for a
 * future update_strategy flow.
 *
 * Security note: the wallet signing abstraction doesn't universally
 * expose `signMessage` (wallet-adapter's `AnchorWallet` is a TX-only
 * wrapper). We reach for the underlying wallet via a dynamic import
 * of the wallet-adapter context so we can call `signMessage` directly.
 */
async function deriveEncryptionKeys(
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
  programId: PublicKey,
  x25519: { getPublicKey: (priv: Uint8Array) => Uint8Array },
  sha256: (input: Uint8Array) => Uint8Array,
): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const msg = new TextEncoder().encode(
    `ShadowPool · Arcium MPC encryption key · program ${programId.toBase58()}`,
  );
  const signature = await signMessage(msg);
  const privateKey = sha256(signature).slice(0, 32);
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export interface InitializeStrategyDeps {
  /** Wallet's signMessage (from `useWallet()` base wallet adapter). */
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
}

/**
 * Full `create_vault_state` MPC round-trip flow from the browser:
 *
 *   1. Wallet signs a deterministic message → SHA-256 → x25519 private key.
 *   2. Fetch MXE public key from devnet (with retry).
 *   3. x25519 shared secret → RescueCipher.
 *   4. Encrypt (spread_bps, rebalance_threshold) with a fresh 16-byte
 *      random nonce.
 *   5. Build + send `create_vault_state` with all Arcium accounts.
 *   6. Subscribe to `vaultStateInitializedEvent` and await firing
 *      (with timeout).
 *   7. Return the tx signature + the public encryption key (for later
 *      update_strategy flows).
 *
 * Cluster offset is pinned to DEVNET_CLUSTER_OFFSET. For mainnet this
 * needs a per-network constant.
 */
export function useInitializeStrategy(authority: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [phase, setPhase] = useState<InitializeStrategyPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InitializeStrategyResult | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  const initialize = useCallback(
    async (
      params: InitializeStrategyParams,
      deps: InitializeStrategyDeps,
    ): Promise<InitializeStrategyResult | null> => {
      if (!wallet || !authority) {
        setError("Wallet not connected");
        setPhase("error");
        return null;
      }

      setError(null);
      setResult(null);

      try {
        // Lazy-import @arcium-hq/client — its index.mjs has a top-level
        // `import fs from 'fs'` that breaks static browser bundles at
        // load time. Next 16 handles the dynamic chunk cleanly: the
        // chunk is loaded only on user action, and the fs stub is
        // harmless so long as we don't call helpers that actually read
        // files (we don't).
        const arcium = await import("@arcium-hq/client");
        const { x25519, RescueCipher, getMXEPublicKey, deserializeLE } = arcium;

        // Same for @noble — it's already a transitive dep so no extra
        // install. Importing `sha256` directly from @noble/hashes keeps
        // the surface narrow.
        const { sha256 } = await import("@noble/hashes/sha2");

        // --- Step 1: derive encryption keys via wallet signature ---
        setPhase("signing-key");
        const program = getProgram(connection, wallet);
        const { privateKey, publicKey: encryptionPublicKey } =
          await deriveEncryptionKeys(
            deps.signMessage,
            program.programId,
            x25519,
            sha256,
          );

        // --- Step 2: fetch MXE public key (with retry for cluster cold start) ---
        setPhase("fetching-mxe");
        let mxePublicKey: Uint8Array | null = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const provider = (program.provider as any);
          const key = await getMXEPublicKey(provider, program.programId);
          if (key) {
            mxePublicKey = key;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!mxePublicKey) {
          throw new Error("Failed to fetch MXE public key after 20 attempts");
        }

        // --- Step 3 + 4: shared secret, encrypt, fresh nonce ---
        setPhase("encrypting");
        const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
        const cipher = new RescueCipher(sharedSecret);

        const nonce = new Uint8Array(16);
        crypto.getRandomValues(nonce);

        const spreadBig = BigInt(params.spreadBps);
        const thresholdBig = BigInt(params.rebalanceThresholdBps);
        const ciphertexts = cipher.encrypt([spreadBig, thresholdBig], nonce);

        // Fresh computation offset (u64 random). Different from our
        // random nonce — used by Arcium to uniquely address this
        // specific computation's accounts.
        const offsetBytes = new Uint8Array(8);
        crypto.getRandomValues(offsetBytes);
        const computationOffset = new BN(Buffer.from(offsetBytes));

        // --- Step 5: assemble accounts + queue tx ---
        setPhase("queueing");
        const [vaultPda] = getVaultPDA(authority);
        const compDefOffsetBytes = await getCompDefAccOffset("init_vault_state");
        const compDefOffset = compDefOffsetBytes.readUInt32LE();

        // Subscribe to the callback event BEFORE sending the tx so
        // there's no race between tx confirmation and event dispatch.
        const eventPromise = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            program.removeEventListener(listenerId);
            reject(
              new Error(
                `MPC callback did not fire within ${MPC_TIMEOUT_MS / 1000}s`,
              ),
            );
          }, MPC_TIMEOUT_MS);

          const listenerId = program.addEventListener(
            "vaultStateInitializedEvent",
            (event: Record<string, unknown>) => {
              const evVault = event.vault as PublicKey | undefined;
              if (!evVault || !evVault.equals(vaultPda)) return;
              clearTimeout(timer);
              program.removeEventListener(listenerId);
              resolve();
            },
          );
        });

        const txSig = await program.methods
          .createVaultState(
            computationOffset,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Array.from(ciphertexts[0]) as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Array.from(ciphertexts[1]) as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Array.from(encryptionPublicKey) as any,
            new BN(deserializeLE(nonce).toString()),
          )
          .accountsPartial({
            authority: authority,
            vault: vaultPda,
            computationAccount: getComputationAccAddress(
              DEVNET_CLUSTER_OFFSET,
              computationOffset,
            ),
            clusterAccount: getClusterAccAddress(DEVNET_CLUSTER_OFFSET),
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(DEVNET_CLUSTER_OFFSET),
            executingPool: getExecutingPoolAccAddress(DEVNET_CLUSTER_OFFSET),
            compDefAccount: getCompDefAccAddress(program.programId, compDefOffset),
          })
          .rpc({ commitment: "confirmed" });

        // --- Step 6: wait for the MPC callback to land ---
        setPhase("awaiting-mpc");
        await eventPromise;

        setPhase("complete");
        const finalResult: InitializeStrategyResult = {
          txSig,
          encryptionPublicKey,
        };
        setResult(finalResult);
        return finalResult;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase("error");
        return null;
      }
    },
    [wallet, authority, connection],
  );

  return { initialize, phase, error, result, reset };
}
