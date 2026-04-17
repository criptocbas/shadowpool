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

/**
 * Fetch a fresh SOL/USD price from Pyth Hermes, post the VAA via the
 * Pyth Solana Receiver in an ephemeral account, then queue the
 * `compute_quotes` MPC call and await the `QuotesComputedEvent`
 * callback.
 *
 * Structured as a 5-phase state machine so the UI can report what's
 * happening — Hermes fetch alone is ~400ms; receiver post ~1s; MPC
 * round trip ~5–10s on devnet.
 */
export type ComputeQuotesPhase =
  | "idle"
  | "fetching-pyth"
  | "posting-receiver"
  | "queueing"
  | "awaiting-mpc"
  | "complete"
  | "error";

export interface QuotesComputedPayload {
  bidPrice: bigint;
  bidSize: bigint;
  askPrice: bigint;
  askSize: bigint;
  shouldRebalance: number;
}

const SOL_USD_FEED_ID =
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export function useComputeQuotesMpc(authority: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [phase, setPhase] = useState<ComputeQuotesPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    txSig: string;
    payload: QuotesComputedPayload;
  } | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  const compute = useCallback(async () => {
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

      setPhase("fetching-pyth");
      const { HermesClient } = await import("@pythnetwork/hermes-client");
      const { PythSolanaReceiver } = await import(
        "@pythnetwork/pyth-solana-receiver"
      );
      const hermes = new HermesClient("https://hermes.pyth.network/", {});
      const { binary } = await hermes.getLatestPriceUpdates([SOL_USD_FEED_ID], {
        encoding: "base64",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = (program.provider as any);
      const pythReceiver = new PythSolanaReceiver({
        connection,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wallet: wallet as any,
      });

      setPhase("posting-receiver");
      const txBuilder = pythReceiver.newTransactionBuilder({
        closeUpdateAccounts: true,
      });
      await txBuilder.addPostPriceUpdates(binary.data);

      const computationOffset = freshComputationOffset();
      const compDefOffsetBytes = await getCompDefAccOffset("compute_quotes");
      const compDefOffset = compDefOffsetBytes.readUInt32LE();

      // Event subscription BEFORE send to avoid the tx-confirm → event
      // dispatch race. awaitMpcEvent resolves on QuotesComputedEvent
      // whose vault field matches ours.
      setPhase("queueing");

      const { txSig, event } = await awaitMpcEvent(
        program,
        "quotesComputedEvent",
        vaultPda,
        async () => {
          let sentSig: string | null = null;
          await txBuilder.addPriceConsumerInstructions(
            async (getPriceUpdateAccount) => {
              const priceUpdate = getPriceUpdateAccount(SOL_USD_FEED_ID);
              const ix = await program.methods
                .computeQuotes(computationOffset)
                .accountsPartial({
                  cranker: wallet.publicKey,
                  vault: vaultPda,
                  priceUpdate,
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
                .instruction();
              return [{ instruction: ix, signers: [] }];
            },
          );

          const txs = await txBuilder.buildVersionedTransactions({
            computeUnitPriceMicroLamports: 50_000,
          });
          setPhase("awaiting-mpc");
          // sendAll returns an array of tx signatures; the last one
          // contains the compute_quotes ix and is what we want to surface.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const sigs = await pythReceiver.provider.sendAll!(txs, {
            commitment: "confirmed",
          });
          sentSig = sigs[sigs.length - 1];
          return sentSig;
        },
      );

      // Decode the event — fields arrive as BN / number.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toBigInt = (v: any): bigint => {
        if (typeof v === "bigint") return v;
        if (typeof v === "number") return BigInt(v);
        if (v?.toString) return BigInt(v.toString());
        return BigInt(0);
      };
      const payload: QuotesComputedPayload = {
        bidPrice: toBigInt(event.bidPrice),
        bidSize: toBigInt(event.bidSize),
        askPrice: toBigInt(event.askPrice),
        askSize: toBigInt(event.askSize),
        shouldRebalance: Number(event.shouldRebalance ?? 0),
      };

      setResult({ txSig, payload });
      setPhase("complete");
      return { txSig, payload };
      void provider;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase("error");
      return null;
    }
  }, [wallet, authority, connection]);

  return { compute, phase, error, result, reset };
}
