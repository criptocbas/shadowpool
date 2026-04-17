"use client";

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

/**
 * Subscribe to an Anchor event, run a transaction-producing callback,
 * and resolve once the event fires for the expected vault. Handles the
 * race window between tx send and event dispatch by subscribing BEFORE
 * the tx is submitted.
 *
 * Generic over the full event map; each caller picks the event name
 * + asserts the `vault` field matches. Timeout cleans up the listener.
 *
 * Used by every MPC-callback-bound flow (compute_quotes, update_strategy,
 * reveal_performance, update_balances, create_vault_state).
 */
export async function awaitMpcEvent<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  P extends anchor.Program<any>,
>(
  program: P,
  eventName: string,
  vaultKey: PublicKey,
  sendTx: () => Promise<string>,
  timeoutMs = 60_000,
): Promise<{ txSig: string; event: Record<string, unknown> }> {
  let listenerId: number | null = null;

  const eventPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (listenerId !== null) program.removeEventListener(listenerId);
      reject(
        new Error(
          `MPC callback "${eventName}" did not fire within ${timeoutMs / 1000}s`,
        ),
      );
    }, timeoutMs);

    listenerId = program.addEventListener(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventName as any,
      (event: Record<string, unknown>) => {
        const evVault = event.vault as PublicKey | undefined;
        if (!evVault || !evVault.equals(vaultKey)) return;
        clearTimeout(timer);
        if (listenerId !== null) program.removeEventListener(listenerId);
        resolve(event);
      },
    );
  });

  try {
    const txSig = await sendTx();
    const event = await eventPromise;
    return { txSig, event };
  } catch (err) {
    if (listenerId !== null) program.removeEventListener(listenerId);
    throw err;
  }
}

/**
 * Deterministic x25519 key derivation from a wallet signature.
 * Same wallet always produces the same keypair — re-signing the
 * message regenerates the private key for update_strategy flows.
 *
 * Shared between initialize_vault_state and update_strategy so both
 * encrypt under the SAME shared secret, so the MPC cluster decrypts
 * the updated params against the same key material.
 */
export async function deriveArciumEncryptionKeys(
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

/**
 * Fetch the MXE pubkey with retry — ARX nodes take a few seconds to
 * cold-start after MXE creation, so a single fetch after init is
 * racy. 20 × 500ms matches the Arcium docs pattern.
 */
export async function fetchMxePublicKeyWithRetry(
  getMXEPublicKey: (
    provider: anchor.AnchorProvider,
    programId: PublicKey,
  ) => Promise<Uint8Array | null>,
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxAttempts = 20,
  delayMs = 500,
): Promise<Uint8Array> {
  for (let i = 0; i < maxAttempts; i++) {
    const key = await getMXEPublicKey(provider, programId);
    if (key) return key;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Failed to fetch MXE public key after ${maxAttempts} attempts`);
}

/** Fresh 16-byte nonce for Rescue cipher encryption. Never reuse. */
export function freshNonce(): Uint8Array {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  return nonce;
}

/** Fresh random u64 for Arcium computation offset. */
export function freshComputationOffset(): anchor.BN {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return new anchor.BN(Buffer.from(bytes));
}
