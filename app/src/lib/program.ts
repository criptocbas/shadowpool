import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
// Bundled IDL — refresh via `yarn sync-idl` (see app/package.json) after any
// program rebuild. This avoids relying on ../../../target/ being present in
// a fresh checkout (which it isn't until `arcium build` runs).
//
// The typed IDL (Shadowpool type from shadowpool.ts) parameterizes Program<T>
// so `program.account.vault.fetch(...)` and `program.methods.deposit(...)`
// are fully typed at call sites — no more `as any` casts in the hooks.
import IDL_JSON from "@/idl/shadowpool.json";
import type { Shadowpool } from "@/idl/shadowpool";
import { PROGRAM_ID } from "./constants";

export type ShadowPoolProgram = Program<Shadowpool>;

/** Create an Anchor Program instance for the ShadowPool program */
export function getProgram(
  connection: Connection,
  wallet: AnchorWallet
): ShadowPoolProgram {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program<Shadowpool>(IDL_JSON as unknown as Shadowpool, provider);
}

export { PROGRAM_ID };
