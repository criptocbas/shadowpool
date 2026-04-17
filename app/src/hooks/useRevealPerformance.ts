"use client";

import { useCallback, useState } from "react";
import {
  useConnection,
  useAnchorWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getProgram } from "@/lib/program";
import { DEVNET_CLUSTER_OFFSET, getVaultPDA } from "@/lib/constants";
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getClusterAccAddress,
} from "@/lib/arcium-pdas";
import { awaitMpcEvent, freshComputationOffset } from "@/lib/arcium-helpers";

export type RevealPerformancePhase =
  | "idle"
  | "queueing"
  | "awaiting-mpc"
  | "complete"
  | "error";

export interface PerformanceRevealedPayload {
  totalValueInQuote: bigint;
  slot: bigint;
}

/**
 * Selective disclosure: queue the `reveal_performance` MPC and receive
 * the aggregate NAV in quote tokens. The cleanest MPC flow in the
 * program — no client-side encryption, no Pyth fetch, just a queue
 * call + callback wait. The returned value is the institutional
 * "attestable solvency" number auditors can query on demand without
 * ever seeing the underlying strategy.
 */
export function useRevealPerformance(authority: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [phase, setPhase] = useState<RevealPerformancePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    txSig: string;
    payload: PerformanceRevealedPayload;
  } | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  const reveal = useCallback(async () => {
    if (!wallet || !authority) {
      setError("Wallet not connected");
      setPhase("error");
      return null;
    }
    setError(null);
    setResult(null);
    try {
      const program = getProgram(connection, wallet);
      const [vaultPda] = getVaultPDA(authority);
      const computationOffset = freshComputationOffset();
      const compDefOffsetBytes = await getCompDefAccOffset("reveal_performance");
      const compDefOffset = compDefOffsetBytes.readUInt32LE();

      setPhase("queueing");
      const { txSig, event } = await awaitMpcEvent(
        program,
        "performanceRevealedEvent",
        vaultPda,
        async () => {
          const sig = await program.methods
            .revealPerformance(computationOffset)
            .accountsPartial({
              caller: wallet.publicKey,
              vault: vaultPda,
              computationAccount: getComputationAccAddress(
                DEVNET_CLUSTER_OFFSET,
                computationOffset,
              ),
              clusterAccount: getClusterAccAddress(DEVNET_CLUSTER_OFFSET),
              mxeAccount: getMXEAccAddress(program.programId),
              mempoolAccount: getMempoolAccAddress(DEVNET_CLUSTER_OFFSET),
              executingPool: getExecutingPoolAccAddress(DEVNET_CLUSTER_OFFSET),
              compDefAccount: getCompDefAccAddress(
                program.programId,
                compDefOffset,
              ),
            })
            .rpc({ commitment: "confirmed" });
          setPhase("awaiting-mpc");
          return sig;
        },
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toBigInt = (v: any): bigint => {
        if (typeof v === "bigint") return v;
        if (typeof v === "number") return BigInt(v);
        if (v?.toString) return BigInt(v.toString());
        return BigInt(0);
      };
      const payload: PerformanceRevealedPayload = {
        totalValueInQuote: toBigInt(event.totalValueInQuote),
        slot: toBigInt(event.slot),
      };

      setResult({ txSig, payload });
      setPhase("complete");
      return { txSig, payload };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase("error");
      return null;
    }
  }, [wallet, authority, connection]);

  return { reveal, phase, error, result, reset };
}
