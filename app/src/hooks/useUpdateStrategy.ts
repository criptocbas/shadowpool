"use client";

import { useCallback, useState } from "react";
import {
  useConnection,
  useAnchorWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
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
import {
  awaitMpcEvent,
  deriveArciumEncryptionKeys,
  fetchMxePublicKeyWithRetry,
  freshComputationOffset,
  freshNonce,
} from "@/lib/arcium-helpers";

export type UpdateStrategyPhase =
  | "idle"
  | "signing-key"
  | "fetching-mxe"
  | "encrypting"
  | "queueing"
  | "awaiting-mpc"
  | "complete"
  | "error";

export interface UpdateStrategyParams {
  spreadBps: number;
  rebalanceThresholdBps: number;
}

export interface UpdateStrategyDeps {
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
}

export function useUpdateStrategy(authority: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [phase, setPhase] = useState<UpdateStrategyPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txSig: string } | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  const update = useCallback(
    async (params: UpdateStrategyParams, deps: UpdateStrategyDeps) => {
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

        const arcium = await import("@arcium-hq/client");
        const { x25519, RescueCipher, getMXEPublicKey, deserializeLE } =
          arcium;
        const { sha256 } = await import("@noble/hashes/sha2");

        // Derive keys from wallet signature — same message as
        // initialize_strategy, so the same wallet → same keypair →
        // same shared secret, so the MPC cluster can decrypt the new
        // params against the VaultState it's already holding.
        setPhase("signing-key");
        const { privateKey, publicKey: encryptionPublicKey } =
          await deriveArciumEncryptionKeys(
            deps.signMessage,
            program.programId,
            x25519,
            sha256,
          );

        setPhase("fetching-mxe");
        const mxePublicKey = await fetchMxePublicKeyWithRetry(
          getMXEPublicKey,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          program.provider as any,
          program.programId,
        );

        setPhase("encrypting");
        const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
        const cipher = new RescueCipher(sharedSecret);
        const nonce = freshNonce();
        const ciphertexts = cipher.encrypt(
          [BigInt(params.spreadBps), BigInt(params.rebalanceThresholdBps)],
          nonce,
        );
        const computationOffset = freshComputationOffset();
        const compDefOffsetBytes = await getCompDefAccOffset("update_strategy");
        const compDefOffset = compDefOffsetBytes.readUInt32LE();

        setPhase("queueing");
        const { txSig } = await awaitMpcEvent(
          program,
          "strategyUpdatedEvent",
          vaultPda,
          async () => {
            const sig = await program.methods
              .updateStrategy(
                computationOffset,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                Array.from(ciphertexts[0]) as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                Array.from(ciphertexts[1]) as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                Array.from(encryptionPublicKey) as any,
                new BN(deserializeLE(nonce).toString()),
              )
              .accountsPartial({
                authority,
                vault: vaultPda,
                computationAccount: getComputationAccAddress(
                  DEVNET_CLUSTER_OFFSET,
                  computationOffset,
                ),
                clusterAccount: getClusterAccAddress(DEVNET_CLUSTER_OFFSET),
                mxeAccount: getMXEAccAddress(program.programId),
                mempoolAccount: getMempoolAccAddress(DEVNET_CLUSTER_OFFSET),
                executingPool: getExecutingPoolAccAddress(
                  DEVNET_CLUSTER_OFFSET,
                ),
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

        void Buffer; // keep import alive for BN constructor compat
        setResult({ txSig });
        setPhase("complete");
        return { txSig };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase("error");
        return null;
      }
    },
    [wallet, authority, connection],
  );

  return { update, phase, error, result, reset };
}
