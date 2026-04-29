import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "Cf3vfadbcvDxaCGsdmKzaNFAVjn8ZGsB4J2rjpncRZkn"
);

export const ENCRYPTED_STATE_OFFSET = 249;
export const ENCRYPTED_STATE_SIZE = 160; // 5 ciphertexts × 32 bytes

export const DEVNET_CLUSTER_OFFSET = 456;

export const VAULT_SEED = Buffer.from("vault");

/** Derive the vault PDA for a given authority */
export function getVaultPDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, authority.toBuffer()],
    PROGRAM_ID
  );
}
