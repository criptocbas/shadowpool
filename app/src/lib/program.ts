import { Program, AnchorProvider, type Idl } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
// Bundled IDL — refresh via `yarn sync-idl` (see app/package.json) after any
// program rebuild. This avoids relying on ../../../target/ being present in
// a fresh checkout (which it isn't until `arcium build` runs).
import IDL_JSON from "@/idl/shadowpool.json";
import { PROGRAM_ID } from "./constants";

/** Create an Anchor Program instance for the ShadowPool program */
export function getProgram(
  connection: Connection,
  wallet: AnchorWallet
): Program {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(IDL_JSON as Idl, provider);
}

export { PROGRAM_ID };
