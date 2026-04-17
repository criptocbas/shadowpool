/**
 * One-shot devnet state inspector. Prints:
 *   - Whether the vault PDA for the current wallet exists and its size
 *   - Which of the 5 Arcis comp-defs are initialized on the MXE
 *
 * Run: yarn run --silent ts-node -T scripts/check-devnet-state.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { Shadowpool } from "../target/types/shadowpool";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
} from "@arcium-hq/client";
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
  if (!rpcUrl) {
    throw new Error("ANCHOR_PROVIDER_URL not set (source .env.local first)");
  }
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
  const vaultInfo = await connection.getAccountInfo(vaultPda);

  console.log(`Owner:     ${owner.publicKey.toBase58()}`);
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);
  console.log(`  exists: ${vaultInfo !== null}`);
  console.log(`  size  : ${vaultInfo?.data.length ?? "n/a"} bytes`);

  console.log("\nComp-def accounts:");
  for (const circuit of CIRCUITS) {
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset(circuit);
    const compDefPda = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgramId(),
    )[0];
    const info = await connection.getAccountInfo(compDefPda);
    console.log(
      `  ${circuit.padEnd(22)} ${info ? "✓ initialized" : "✗ not initialized"}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
