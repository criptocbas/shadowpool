"use client";

import { useCallback, useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getProgram } from "@/lib/program";
import { getVaultPDA, DEVNET_CLUSTER_OFFSET } from "@/lib/constants";
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getClusterAccAddress,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";

export function useComputeQuotes(authority: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const triggerRebalance = useCallback(
    async (oraclePrice: number, oracleConfidence: number) => {
      if (!wallet || !authority) {
        setError("Wallet not connected");
        return;
      }

      setLoading(true);
      setError(null);
      setTxSig(null);

      try {
        const program = getProgram(connection, wallet);
        const [vaultPda] = getVaultPDA(authority);

        const computationOffset = new BN(randomBytes(8), "hex");
        const clusterAccount = getClusterAccAddress(DEVNET_CLUSTER_OFFSET);
        const compDefOffset = Buffer.from(
          getCompDefAccOffset("compute_quotes")
        ).readUInt32LE();

        const sig = await program.methods
          .computeQuotes(
            computationOffset,
            new BN(oraclePrice),
            new BN(oracleConfidence)
          )
          .accountsPartial({
            cranker: wallet.publicKey,
            vault: vaultPda,
            computationAccount: getComputationAccAddress(
              DEVNET_CLUSTER_OFFSET,
              computationOffset
            ),
            clusterAccount,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(DEVNET_CLUSTER_OFFSET),
            executingPool: getExecutingPoolAccAddress(DEVNET_CLUSTER_OFFSET),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              compDefOffset
            ),
          })
          .rpc({ skipPreflight: true, commitment: "confirmed" });

        setTxSig(sig);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [wallet, authority, connection]
  );

  return { triggerRebalance, loading, error, txSig };
}
