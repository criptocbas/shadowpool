import { Program, AnchorProvider, type Idl } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import IDL_JSON from "../../../target/idl/shadowpool.json";
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
