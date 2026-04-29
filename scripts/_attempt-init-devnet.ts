/**
 * Focused devnet attempt of `create_vault_state` (the previously failing flow).
 * Mirrors test 2 in tests/shadowpool.ts but pointed at devnet cluster 456.
 *
 * Pre-reqs:
 *  - Vault PDA already initialized on devnet (initialize_vault has run)
 *  - encrypted_state all-zero, pending_state_computation = None
 *  - All 5 comp-defs OnchainFinalized
 *
 * Run: source .env.local && npx ts-node -T scripts/_attempt-init-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getClusterAccAddress,
  awaitComputationFinalization,
} from "@arcium-hq/client";
import { x25519 } from "@noble/curves/ed25519";
import { randomBytes } from "crypto";
import { Shadowpool } from "../target/types/shadowpool";
import * as fs from "fs";
import * as os from "os";

const DEVNET_CLUSTER_OFFSET = 456;

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries = 10,
  retryDelayMs = 1000,
): Promise<Uint8Array> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const pk = await getMXEPublicKey(provider, programId);
      if (pk) return pk;
    } catch (e) {
      // retry
    }
    await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  throw new Error(`Failed to fetch MXE pubkey after ${maxRetries} retries`);
}

async function main() {
  const conn = new Connection(process.env.ANCHOR_PROVIDER_URL!, "confirmed");
  const owner = Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(
        fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8"),
      ),
    ),
  );
  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(conn, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  anchor.setProvider(provider);
  const program = anchor.workspace.Shadowpool as Program<Shadowpool>;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()],
    program.programId,
  );

  console.log(`Authority: ${owner.publicKey.toBase58()}`);
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);
  console.log(`Cluster:   ${DEVNET_CLUSTER_OFFSET} (devnet)\n`);

  // 0. Pre-flight: vault must be in clean state
  const pre: any = await program.account.vault.fetch(vaultPda);
  if (pre.pendingStateComputation) {
    throw new Error(
      `pending_state_computation is set (${pre.pendingStateComputation}). Run scripts/emergency-override-devnet.ts --clear-pending first.`,
    );
  }
  const allZero = pre.encryptedState.every((ct: number[]) =>
    ct.every((b: number) => b === 0),
  );
  if (!allZero) {
    throw new Error(
      `encrypted_state already populated (state_nonce=${pre.stateNonce}). This script is for the FIRST init only.`,
    );
  }
  console.log("✓ Pre-flight: vault clean (no pending, encrypted_state zero)\n");

  // 1. Fetch MXE pubkey
  console.log("Fetching MXE x25519 pubkey from devnet...");
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);
  console.log(`✓ MXE pubkey (${mxePublicKey.length}b): ${Buffer.from(mxePublicKey).slice(0, 8).toString("hex")}…\n`);

  // 2. Generate x25519 ephemeral keypair and encrypt strategy
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const spreadBps = BigInt(50); // 0.5%
  const rebalanceThreshold = BigInt(100); // 1.0%
  const nonce = randomBytes(16);
  const ciphertext = cipher.encrypt([spreadBps, rebalanceThreshold], nonce);
  const computationOffset = new anchor.BN(randomBytes(8), "hex");
  const nonceBN = new anchor.BN(deserializeLE(nonce).toString());
  console.log(`Strategy: spread=${spreadBps}bps, threshold=${rebalanceThreshold}bps`);
  console.log(`computation_offset: ${computationOffset.toString()}\n`);

  // 3. Build accounts
  const compDefOffset = Buffer.from(getCompDefAccOffset("init_vault_state")).readUInt32LE();
  const accounts = {
    authority: owner.publicKey,
    vault: vaultPda,
    computationAccount: getComputationAccAddress(DEVNET_CLUSTER_OFFSET, computationOffset),
    clusterAccount: getClusterAccAddress(DEVNET_CLUSTER_OFFSET),
    mxeAccount: getMXEAccAddress(program.programId),
    mempoolAccount: getMempoolAccAddress(DEVNET_CLUSTER_OFFSET),
    executingPool: getExecutingPoolAccAddress(DEVNET_CLUSTER_OFFSET),
    compDefAccount: getCompDefAccAddress(program.programId, compDefOffset),
  };

  // 4. Listen for the success event
  const stateInitPromise = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for VaultStateInitializedEvent (90s)")),
      90_000,
    );
    const listener = program.addEventListener(
      "vaultStateInitializedEvent",
      (event: any) => {
        clearTimeout(timer);
        program.removeEventListener(listener);
        resolve(event);
      },
    );
  });

  // 5. Submit
  console.log("Submitting create_vault_state...");
  const t0 = Date.now();
  const sig = await program.methods
    .createVaultState(
      computationOffset,
      Array.from(ciphertext[0]) as any,
      Array.from(ciphertext[1]) as any,
      Array.from(publicKey) as any,
      nonceBN,
    )
    .accountsPartial(accounts)
    .signers([owner])
    .rpc({ skipPreflight: true, commitment: "confirmed" });
  console.log(`✓ queue_computation tx: ${sig}`);
  console.log(`  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  console.log(`  computation account: ${accounts.computationAccount.toBase58()}\n`);

  // 6. Wait for MPC finalization
  console.log("Waiting for MPC finalization...");
  try {
    await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      "confirmed",
    );
    console.log(`✓ MPC finalized in ${Date.now() - t0}ms`);
  } catch (e: any) {
    console.error(`✗ MPC FAILED after ${Date.now() - t0}ms: ${e.message}`);
    console.error("  computation account for Arcium support:", accounts.computationAccount.toBase58());
    process.exit(2);
  }

  // 7. Wait for callback event
  console.log("Waiting for VaultStateInitializedEvent...");
  const event = await stateInitPromise.catch((e) => {
    console.error(`✗ ${e.message}`);
    return null;
  });
  if (event) console.log(`✓ Callback fired: vault=${event.vault.toBase58()} slot=${event.slot}\n`);

  // 8. Verify final state
  const post: any = await program.account.vault.fetch(vaultPda);
  const postZero = post.encryptedState.every((ct: number[]) =>
    ct.every((b: number) => b === 0),
  );
  console.log("Post-state:");
  console.log(`  state_nonce:               ${post.stateNonce.toString()}`);
  console.log(`  encrypted_state all-zero?: ${postZero}`);
  console.log(`  pending_state_computation: ${post.pendingStateComputation ? post.pendingStateComputation.toString() : "None"}`);
  if (postZero) {
    console.error("\n✗ FAILED: encrypted_state still zero. MPC did not write back.");
    process.exit(3);
  }
  console.log("\n🎉 SUCCESS — devnet MPC init_vault_state completed end-to-end.");
}

main().catch((e) => {
  console.error("\nUnhandled error:", e);
  process.exit(1);
});
