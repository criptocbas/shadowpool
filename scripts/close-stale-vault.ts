/**
 * One-shot: close the stale vault PDA at
 *   7L7svML23JXnFGkhKpZjTAoTaNnV6bvy7AdfYvdkQzrP
 * that predates the current Vault layout (468-byte legacy).
 *
 * The deployed program's close_vault instruction takes the legacy
 * rescue path automatically when Vault::try_deserialize fails.
 *
 * Run: yarn run --silent ts-node -T scripts/close-stale-vault.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair, SystemProgram } from "@solana/web3.js";
import { Shadowpool } from "../target/types/shadowpool";
import * as fs from "fs";
import * as os from "os";

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) throw new Error("ANCHOR_PROVIDER_URL not set (source .env.local)");

  const connection = new Connection(rpcUrl, "confirmed");
  const owner = Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(
        fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8"),
      ),
    ),
  );
  const wallet = new anchor.Wallet(owner);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = anchor.workspace.Shadowpool as Program<Shadowpool>;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()],
    program.programId,
  );

  // Pre-check
  const info = await connection.getAccountInfo(vaultPda);
  if (!info) {
    console.log(`Vault ${vaultPda.toBase58()} does not exist — nothing to close.`);
    return;
  }
  console.log(`Found vault: ${vaultPda.toBase58()}`);
  console.log(`  size    : ${info.data.length} bytes`);
  console.log(`  lamports: ${info.lamports} (${info.lamports / 1e9} SOL)`);
  console.log(`  owner   : ${info.owner.toBase58()}`);

  const balanceBefore = await connection.getBalance(owner.publicKey);
  console.log(`\nAuthority balance before: ${balanceBefore / 1e9} SOL`);

  const sig = await program.methods
    .closeVault()
    .accountsPartial({
      authority: owner.publicKey,
      vault: vaultPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([owner])
    .rpc({ commitment: "confirmed" });
  console.log(`\nclose_vault tx: ${sig}`);
  console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  const infoAfter = await connection.getAccountInfo(vaultPda);
  console.log(
    `\nVault after close: ${infoAfter === null ? "GONE ✓" : `still alive (${infoAfter.data.length} bytes)`}`,
  );

  const balanceAfter = await connection.getBalance(owner.publicKey);
  console.log(`Authority balance after:  ${balanceAfter / 1e9} SOL`);
  console.log(`Reclaimed:                ${(balanceAfter - balanceBefore) / 1e9} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
