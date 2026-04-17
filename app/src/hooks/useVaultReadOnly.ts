"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { IdlAccounts } from "@coral-xyz/anchor";
import idl from "@/idl/shadowpool.json";
import type { Shadowpool } from "@/idl/shadowpool";

export type VaultReadOnlyData = IdlAccounts<Shadowpool>["vault"];

/**
 * Read-only vault fetch — no wallet required. Used by the public
 * auditor surface (/audit/[vault]) where anyone with a vault pubkey
 * can inspect the attested state without connecting a wallet.
 *
 * Builds a Program with a stub `Wallet` whose sign methods throw —
 * safe because `program.account.vault.fetch` only reads, never signs.
 * The stub pubkey is a fresh ephemeral keypair so nothing ambient
 * (e.g. a connected wallet's key) leaks into the read path.
 */
export function useVaultReadOnly(vaultPda: PublicKey | null) {
  const { connection } = useConnection();
  const [vault, setVault] = useState<VaultReadOnlyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVault = useCallback(async () => {
    if (!vaultPda) {
      setVault(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      // Ephemeral keypair — the stub wallet. Read-only flow never
      // calls sign methods.
      const stub = Keypair.generate();
      const provider = new AnchorProvider(
        connection,
        {
          publicKey: stub.publicKey,
          signTransaction: async () => {
            throw new Error("read-only provider");
          },
          signAllTransactions: async () => {
            throw new Error("read-only provider");
          },
        },
        { commitment: "confirmed" },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const program = new Program<Shadowpool>(idl as any, provider);
      const data = await program.account.vault.fetch(vaultPda);
      setVault(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Account does not exist")) {
        setVault(null);
        setError("vault not found at this address");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [connection, vaultPda]);

  useEffect(() => {
    fetchVault();
    if (!vaultPda) return;
    const id = setInterval(fetchVault, 15_000);
    return () => clearInterval(id);
  }, [fetchVault, vaultPda]);

  return { vault, loading, error, refetch: fetchVault };
}
