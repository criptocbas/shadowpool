/**
 * One-shot devnet vault initialization. Creates two fresh SPL token
 * mints (base + quote), the vault-PDA-owned share mint, the two vault
 * ATAs, then calls `initialize_vault` with the canonical Pyth SOL/USD
 * feed id.
 *
 * Mirrors the `before()` + first `it()` of tests/shadowpool.ts but
 * pointed at devnet. Idempotent — bails cleanly if a vault already
 * exists at the authority's PDA.
 *
 * Run: source .env.local && yarn run --silent ts-node -T scripts/init-vault-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Shadowpool } from "../target/types/shadowpool";
import * as fs from "fs";
import * as os from "os";

const SOL_USD_FEED_ID =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const SOL_USD_FEED_ID_BYTES = Array.from(Buffer.from(SOL_USD_FEED_ID, "hex"));
const DEFAULT_MAX_PRICE_AGE_SECONDS = new anchor.BN(30);

async function main() {
  if (!process.env.ANCHOR_PROVIDER_URL) {
    throw new Error("ANCHOR_PROVIDER_URL not set (source .env.local first)");
  }
  process.env.ANCHOR_WALLET = `${os.homedir()}/.config/solana/id.json`;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Shadowpool as Program<Shadowpool>;

  const owner: Keypair = (provider.wallet as anchor.Wallet).payer;
  console.log(`Owner:   ${owner.publicKey.toBase58()}`);
  console.log(`Program: ${program.programId.toBase58()}\n`);

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()],
    program.programId,
  );
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);

  const existing = await provider.connection.getAccountInfo(vaultPda);
  if (existing) {
    console.log(`✓ Vault already initialized (${existing.data.length} bytes). Nothing to do.`);
    return;
  }

  // ---- Create SPL mints + ATAs --------------------------------------
  console.log("\nCreating SPL token fixtures (base + quote + share)...");
  const tokenAMint = await createMint(
    provider.connection,
    owner,
    owner.publicKey,
    null,
    9,
  );
  console.log(`  tokenAMint (base, 9d):  ${tokenAMint.toBase58()}`);

  const tokenBMint = await createMint(
    provider.connection,
    owner,
    owner.publicKey,
    null,
    6,
  );
  console.log(`  tokenBMint (quote, 6d): ${tokenBMint.toBase58()}`);

  const shareMint = await createMint(
    provider.connection,
    owner,
    vaultPda, // mint authority MUST be vault PDA
    null,
    9,
  );
  console.log(`  shareMint (sp, 9d):     ${shareMint.toBase58()}`);

  const tokenAVaultAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    tokenAMint,
    vaultPda,
    true, // allowOwnerOffCurve = true (PDA owner)
  );
  console.log(`  tokenAVault ATA:        ${tokenAVaultAta.address.toBase58()}`);

  const tokenBVaultAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    tokenBMint,
    vaultPda,
    true,
  );
  console.log(`  tokenBVault ATA:        ${tokenBVaultAta.address.toBase58()}`);

  // ---- Call initialize_vault ----------------------------------------
  console.log("\nCalling initialize_vault...");
  const sig = await program.methods
    .initializeVault(SOL_USD_FEED_ID_BYTES as any, DEFAULT_MAX_PRICE_AGE_SECONDS)
    .accountsPartial({
      authority: owner.publicKey,
      vault: vaultPda,
      tokenAMint,
      tokenBMint,
      tokenAVault: tokenAVaultAta.address,
      tokenBVault: tokenBVaultAta.address,
      shareMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([owner])
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  console.log(`✓ Vault initialized.`);
  console.log(`  sig: ${sig}`);
  console.log(`  https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  const vault = await program.account.vault.fetch(vaultPda);
  console.log(`\nVault state:`);
  console.log(`  authority:                 ${vault.authority.toBase58()}`);
  console.log(`  cranker:                   ${vault.cranker.toBase58()}`);
  console.log(`  encrypted_state all-zero?: ${vault.encryptedState.every((c: number[]) => c.every((b: number) => b === 0))}`);
  console.log(`  pending_state_computation: ${vault.pendingStateComputation ? vault.pendingStateComputation.toString() : "None"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
