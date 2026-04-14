"use client";

import { useCallback, useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getProgram } from "@/lib/program";
import { getVaultPDA } from "@/lib/constants";

export function useDeposit(authority: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const deposit = useCallback(
    async (
      amount: number,
      userTokenAccount: PublicKey,
      userShareAccount: PublicKey,
      vaultTokenB: PublicKey,
      shareMint: PublicKey,
      tokenBMint: PublicKey
    ) => {
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

        const sig = await (program.methods as any)
          .deposit(new BN(amount))
          .accountsPartial({
            user: wallet.publicKey,
            vault: vaultPda,
            userTokenAccount,
            tokenBMint,
            vaultTokenB,
            shareMint,
            userShareAccount,
          })
          .rpc({ commitment: "confirmed" });

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

  return { deposit, loading, error, txSig };
}
