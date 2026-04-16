"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { IdlAccounts } from "@coral-xyz/anchor";
import { getProgram } from "@/lib/program";
import { getVaultPDA } from "@/lib/constants";
import type { Shadowpool } from "@/idl/shadowpool";

/**
 * Shape of the vault account, derived directly from the IDL via Anchor's
 * IdlAccounts helper. Kept as an exported alias so downstream components
 * can import it without re-touching the IDL.
 */
export type VaultData = IdlAccounts<Shadowpool>["vault"];

export function useVault(authority: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [vault, setVault] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVault = useCallback(async () => {
    if (!authority || !wallet) return;

    try {
      setLoading(true);
      setError(null);
      const program = getProgram(connection, wallet);
      const [vaultPda] = getVaultPDA(authority);
      const data = await program.account.vault.fetch(vaultPda);
      setVault(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Account not found is expected when vault doesn't exist yet
      if (msg.includes("Account does not exist")) {
        setVault(null);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [authority, wallet, connection]);

  // Initial fetch + poll every 10 seconds.
  //
  // Only start the interval when we have a wallet and an authority — with no
  // wallet connected, fetchVault is a no-op but re-running it every 10s is
  // pointless work (and on very slow machines can stack up microtasks).
  useEffect(() => {
    if (!authority || !wallet) {
      // Clear any previously fetched vault so a wallet change doesn't
      // surface stale data from the prior connection.
      setVault(null);
      return;
    }
    fetchVault();
    const interval = setInterval(fetchVault, 10_000);
    return () => clearInterval(interval);
  }, [fetchVault, authority, wallet]);

  return { vault, loading, error, refetch: fetchVault };
}
