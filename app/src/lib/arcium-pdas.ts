/**
 * Browser-safe reimplementation of the seven Arcium PDA helpers we use.
 *
 * `@arcium-hq/client@0.9.2` imports `fs` unconditionally at the top of
 * its ESM bundle (for the server-side `uploadCircuit` path). That
 * breaks `next build` in the browser. The helpers we actually use in
 * the frontend are all pure PDA derivations with no Node dependency,
 * so we reimplement them here.
 *
 * Reverse-engineered from node_modules/@arcium-hq/client/build/index.mjs
 * — Arcium program ID, seed strings, and helper signatures are all
 * public / on-chain facts; nothing proprietary.
 *
 * If Arcium ever changes a seed string we'll break visibly (PDA
 * mismatches → tx simulation fails with a clear error). Track the
 * upstream client and update here if that happens.
 */

import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { Buffer } from "buffer";

/** Arcium program ID — the PDA owner for every account derived below. */
export const ARCIUM_PROGRAM_ID = new PublicKey(
  "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
);

// ── Internal helpers ──────────────────────────────────────────────

function u32LE(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n, 0);
  return buf;
}

function derive(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, ARCIUM_PROGRAM_ID)[0];
}

/**
 * Browser-safe SHA-256 using the Web Crypto API. Async because
 * `crypto.subtle.digest` is async in the browser. The server-side
 * Node version in `@arcium-hq/client` is synchronous via
 * `crypto.createHash`, but we don't have that available client-side
 * without a polyfill.
 *
 * Only used by `getCompDefAccOffset` — callers already live inside
 * `async` paths so the Promise doesn't change their shape.
 */
async function sha256First4(input: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(input);
  // Re-back on a fresh ArrayBuffer (not SharedArrayBuffer) so TypeScript
  // accepts it as a BufferSource for crypto.subtle.digest.
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  bytes.set(encoded);
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hashBuf).slice(0, 4);
}

// ── Public helpers (same signatures as @arcium-hq/client) ─────────

/** Derive the MXE account PDA for a given program ID. */
export function getMXEAccAddress(mxeProgramId: PublicKey): PublicKey {
  return derive([Buffer.from("MXEAccount"), mxeProgramId.toBuffer()]);
}

/** Derive the Mempool account PDA for a cluster offset. */
export function getMempoolAccAddress(clusterOffset: number): PublicKey {
  return derive([Buffer.from("Mempool"), u32LE(clusterOffset)]);
}

/** Derive the executing-pool account PDA for a cluster offset. */
export function getExecutingPoolAccAddress(clusterOffset: number): PublicKey {
  return derive([Buffer.from("Execpool"), u32LE(clusterOffset)]);
}

/**
 * Derive the computation-definition account PDA for a given program +
 * comp-def offset (first 4 bytes of sha256(circuit name); see
 * `getCompDefAccOffset` below).
 */
export function getCompDefAccAddress(
  mxeProgramId: PublicKey,
  compDefOffset: number
): PublicKey {
  return derive([
    Buffer.from("ComputationDefinitionAccount"),
    mxeProgramId.toBuffer(),
    u32LE(compDefOffset),
  ]);
}

/**
 * First 4 bytes of sha256 of the circuit name, returned as a Buffer.
 *
 * **Async** in the browser (Web Crypto is async). Callers typically
 * already live inside async functions, so the Promise is natural.
 * To feed the result into `getCompDefAccAddress`, read it as a u32 LE:
 *
 *   const bytes = await getCompDefAccOffset("compute_quotes");
 *   const offset = Buffer.from(bytes).readUInt32LE();
 *   const pda = getCompDefAccAddress(programId, offset);
 */
export async function getCompDefAccOffset(
  circuitName: string
): Promise<Buffer> {
  const first4 = await sha256First4(circuitName);
  return Buffer.from(first4);
}

/** Derive the computation-account PDA for a cluster + computation offset. */
export function getComputationAccAddress(
  clusterOffset: number,
  computationOffset: BN
): PublicKey {
  return derive([
    Buffer.from("ComputationAccount"),
    u32LE(clusterOffset),
    computationOffset.toArrayLike(Buffer, "le", 8),
  ]);
}

/** Derive the Cluster account PDA for a cluster offset. */
export function getClusterAccAddress(clusterOffset: number): PublicKey {
  return derive([Buffer.from("Cluster"), u32LE(clusterOffset)]);
}
