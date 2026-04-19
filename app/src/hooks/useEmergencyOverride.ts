"use client";

import { useCallback, useState } from "react";
import {
  useConnection,
  useAnchorWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getProgram } from "@/lib/program";
import { getVaultPDA } from "@/lib/constants";

export type EmergencyOverridePhase =
  | "idle"
  | "sending"
  | "complete"
  | "error";

/**
 * Authority-only escape hatch for M-1 and M-2 liveness bugs. Clears
 * `nav_stale` and/or `pending_state_computation` on the vault so the
 * authority can recover from a stuck Arcium cluster (DoS, timed-out
 * callback, devnet flakiness) without a program upgrade.
 *
 * Both booleans default to true because the button's purpose is "get
 * unstuck" — no downside to clearing a flag that was already False.
 * Emits `EmergencyOverrideEvent` with the previous state for audit.
 */
export function useEmergencyOverride(authority: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [phase, setPhase] = useState<EmergencyOverridePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTxSig(null);
  }, []);

  const clear = useCallback(
    async (opts?: {
      clearPendingState?: boolean;
      clearNavStale?: boolean;
    }): Promise<string | null> => {
      if (!wallet || !authority) {
        setError("Wallet not connected");
        setPhase("error");
        return null;
      }
      const clearPending = opts?.clearPendingState ?? true;
      const clearNav = opts?.clearNavStale ?? true;

      setError(null);
      setTxSig(null);

      try {
        setPhase("sending");
        const program = getProgram(connection, wallet);
        const [vaultPda] = getVaultPDA(authority);

        const sig = await program.methods
          .emergencyOverride(clearNav, clearPending)
          .accountsPartial({
            authority,
            vault: vaultPda,
          })
          .rpc({ commitment: "confirmed" });

        setTxSig(sig);
        setPhase("complete");
        return sig;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase("error");
        return null;
      }
    },
    [wallet, authority, connection],
  );

  return { clear, phase, error, txSig, reset };
}
