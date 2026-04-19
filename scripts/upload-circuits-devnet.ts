/**
 * Upload all 5 Arcis circuit binaries to the devnet MXE. Required after
 * an `arcium deploy` that only ran the `init_comp_def` stage — without
 * the circuit bytecode, `queue_computation` fails with
 * `ComputationDefinitionNotCompleted` (6300).
 *
 * Idempotent: uploadCircuit returns an "already uploaded" error the
 * second time; we catch and continue.
 *
 * Run: source .env.local && yarn run --silent ts-node -T scripts/upload-circuits-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import { Shadowpool } from "../target/types/shadowpool";
import { uploadCircuit } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

const CIRCUITS = [
  "init_vault_state",
  "compute_quotes",
  "update_balances",
  "update_strategy",
  "reveal_performance",
];

async function main() {
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

  console.log(`Authority: ${owner.publicKey.toBase58()}`);
  console.log(`Program:   ${program.programId.toBase58()}\n`);

  for (const name of CIRCUITS) {
    const path = `build/${name}.arcis`;
    if (!fs.existsSync(path)) {
      console.log(`  [skip] ${name}: ${path} not found`);
      continue;
    }
    const raw = fs.readFileSync(path);
    process.stdout.write(`  [${name}] uploading ${raw.length} bytes… `);
    try {
      await uploadCircuit(
        provider,
        name,
        program.programId,
        raw,
        true,
        500,
        {
          skipPreflight: true,
          preflightCommitment: "confirmed",
          commitment: "confirmed",
        },
      );
      console.log("✓ done");
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      if (
        msg.includes("already") ||
        msg.includes("custom program error: 0x0") ||
        msg.includes("unknown action")
      ) {
        console.log("~ already complete (or RPC flake)");
      } else {
        console.log("✗ FAILED");
        console.error("     ", (e as Error).message);
      }
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
