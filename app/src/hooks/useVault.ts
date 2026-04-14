"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { BN } from "@coral-xyz/anchor";
import { getProgram } from "@/lib/program";
import { getVaultPDA } from "@/lib/constants";

export interface VaultData {
  authority: PublicKey;
  totalShares: BN;
  totalDepositsA: BN;
  totalDepositsB: BN;
  lastRebalanceSlot: BN;
  stateNonce: BN;
  encryptedState: number[][];
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  shareMint: PublicKey;
  // Quote persistence fields
  lastBidPrice: BN;
  lastBidSize: BN;
  lastAskPrice: BN;
  lastAskSize: BN;
  lastShouldRebalance: number;
  quotesSlot: BN;
  quotesConsumed: boolean;
  // NAV tracking (authoritative post-trade share-pricing basis)
  lastRevealedNav: BN;
  lastRevealedNavSlot: BN;
  navStale: boolean;
}

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
      const data = await (program.account as any).vault.fetch(vaultPda);
      setVault(data as unknown as VaultData);
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

  // Initial fetch + poll every 10 seconds
  useEffect(() => {
    fetchVault();
    const interval = setInterval(fetchVault, 10_000);
    return () => clearInterval(interval);
  }, [fetchVault]);

  return { vault, loading, error, refetch: fetchVault };
}
