"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";

/**
 * Fetch a wallet's SPL token balance for a given mint.
 *
 * Returns the raw (bigint) balance + the display amount (as number,
 * for UI), loading state, and a refetch callback. Polls on a 6s cadence
 * when the window is visible; pauses when hidden. Resolves the user's
 * Associated Token Account (ATA) lazily — if the ATA doesn't exist yet
 * (user has never held this token), balance = 0 without an error.
 */
export interface TokenBalance {
  /** Raw amount in the mint's smallest unit (lamports / micro). */
  raw: bigint;
  /** Display amount = raw / 10^decimals. */
  display: number;
  decimals: number;
}

export function useTokenBalance(
  owner: PublicKey | null,
  mint: PublicKey | null,
  decimals: number,
): {
  balance: TokenBalance | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    if (!owner || !mint) {
      setBalance(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ata = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID);
      const account = await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
      if (!mountedRef.current) return;
      const raw = account.amount; // bigint
      const display = Number(raw) / 10 ** decimals;
      setBalance({ raw, display, decimals });
    } catch (err: unknown) {
      // Missing ATA is the common case — surface as "zero balance,
      // not an error" so the UI doesn't show a scary message when the
      // user simply doesn't own any of this token yet.
      if (
        err instanceof TokenAccountNotFoundError ||
        err instanceof TokenInvalidAccountOwnerError
      ) {
        if (!mountedRef.current) return;
        setBalance({ raw: BigInt(0), display: 0, decimals });
      } else {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [connection, owner, mint, decimals]);

  useEffect(() => {
    mountedRef.current = true;
    fetch();

    // Poll while visible; pause when the tab is hidden to avoid
    // wasting RPC credits on stale views.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(fetch, 6000);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVis = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mountedRef.current = false;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetch]);

  return { balance, loading, error, refetch: fetch };
}
