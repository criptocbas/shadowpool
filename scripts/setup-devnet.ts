/**
 * One-shot devnet setup: registers all 5 Arcis comp-defs with the MXE.
 *
 * Mirrors salary-benchmark/scripts/setup-devnet.ts. Each call points the
 * MXE at the corresponding `.arcis` URL on the public circuits repo
 * (criptocbas/shadowpool-circuits) — the on-chain `circuit_hash!` baked
 * into the .so must match the bytes the cluster fetches, or `init_comp_def`
 * rejects.
 *
 * Run: source .env.local && yarn run --silent ts-node -T scripts/setup-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  getMXEAccAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import { Shadowpool } from "../target/types/shadowpool";
import * as fs from "fs";
import * as os from "os";

const CIRCUITS = [
  { method: "initVaultStateCompDef", circuit: "init_vault_state" },
  { method: "initComputeQuotesCompDef", circuit: "compute_quotes" },
  { method: "initUpdateBalancesCompDef", circuit: "update_balances" },
  { method: "initUpdateStrategyCompDef", circuit: "update_strategy" },
  { method: "initRevealPerformanceCompDef", circuit: "reveal_performance" },
];

async function main() {
  if (!process.env.ANCHOR_PROVIDER_URL) {
    throw new Error("ANCHOR_PROVIDER_URL not set (source .env.local first)");
  }
  process.env.ANCHOR_WALLET = `${os.homedir()}/.config/solana/id.json`;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Shadowpool as Program<Shadowpool>;
  const arciumProgram = getArciumProgram(provider);

  const payer = (provider.wallet as anchor.Wallet).payer;
  console.log(`Payer:   ${payer.publicKey.toBase58()}`);
  console.log(`Program: ${program.programId.toBase58()}\n`);

  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = new PublicKey(
    (await import("@arcium-hq/client")).getLookupTableAddress(
      program.programId,
      mxeAcc.lutOffsetSlot,
    ),
  );

  for (const { method, circuit } of CIRCUITS) {
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset(circuit);
    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgramId(),
    )[0];

    const existing = await provider.connection.getAccountInfo(compDefPDA);
    if (existing) {
      console.log(`[${circuit}] ✓ already initialized at ${compDefPDA.toBase58()}`);
      continue;
    }

    console.log(`[${circuit}] initializing comp def at ${compDefPDA.toBase58()} ...`);
    const sig = await (program.methods as any)
      [method]()
      .accounts({
        compDefAccount: compDefPDA,
        payer: payer.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .rpc({ commitment: "confirmed" });
    console.log(`[${circuit}] sig: ${sig}`);
  }

  console.log("\n✓ All 5 comp-defs initialized.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
