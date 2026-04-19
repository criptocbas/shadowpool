/**
 * Emergency-override the authority-gated M-2 escape hatch on devnet.
 * Clears nav_stale and/or pending_state_computation on the vault PDA
 * for the caller's authority. Only works if the caller IS the vault
 * authority (has_one = authority guard).
 *
 * Run:
 *   source .env.local
 *   yarn run --silent ts-node -T scripts/emergency-override-devnet.ts \
 *     [--clear-pending] [--clear-nav-stale]
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Shadowpool } from "../target/types/shadowpool";
import * as fs from "fs";
import * as os from "os";

async function main() {
  const args = process.argv.slice(2);
  const clearPending = args.includes("--clear-pending");
  const clearNav = args.includes("--clear-nav-stale");
  if (!clearPending && !clearNav) {
    console.log("Nothing to clear. Pass --clear-pending and/or --clear-nav-stale.");
    return;
  }

  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  if (!rpcUrl) throw new Error("ANCHOR_PROVIDER_URL not set");
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

  // Vault PDA for THIS authority (the signing key). Must match the
  // vault being unstuck — if the vault was created by a different
  // authority (e.g. a Phantom wallet), this won't match.
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()],
    program.programId,
  );

  console.log(`Authority: ${owner.publicKey.toBase58()}`);
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);
  console.log(
    `Clearing: pending=${clearPending} nav_stale=${clearNav}\n`,
  );

  const sig = await program.methods
    .emergencyOverride(clearNav, clearPending)
    .accountsPartial({
      authority: owner.publicKey,
      vault: vaultPda,
    })
    .rpc({ commitment: "confirmed", skipPreflight: true });
  console.log(`✓ emergency_override tx: ${sig}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
