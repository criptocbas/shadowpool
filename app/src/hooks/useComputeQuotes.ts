"use client";

import { useCallback, useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { HermesClient } from "@pythnetwork/hermes-client";
import { getProgram } from "@/lib/program";
import { getVaultPDA, DEVNET_CLUSTER_OFFSET } from "@/lib/constants";
// Browser-safe PDA helpers (reimplemented from @arcium-hq/client). The
// upstream client imports `fs` unconditionally at ESM load time which
// breaks `next build`. See lib/arcium-pdas.ts for the reverse-engineered
// seeds.
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getClusterAccAddress,
} from "@/lib/arcium-pdas";

/**
 * Generate cryptographically random bytes in the browser. Equivalent
 * to Node's `crypto.randomBytes` but works in any environment that
 * exposes Web Crypto (all modern browsers + modern Node).
 */
function webRandomBytes(size: number): Uint8Array {
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  return arr;
}

/**
 * Convert a `0x`-prefixed or bare hex feed ID to the `0xHEX` form the
 * Hermes client expects.
 */
function toHermesFeedId(rawFeedIdBytes: number[] | Uint8Array): string {
  const bytes = rawFeedIdBytes instanceof Uint8Array
    ? rawFeedIdBytes
    : Uint8Array.from(rawFeedIdBytes);
  return "0x" + Buffer.from(bytes).toString("hex");
}

const HERMES_ENDPOINT = "https://hermes.pyth.network/";

/**
 * Trigger a compute_quotes MPC rebalance. The caller provides the
 * vault authority; the hook reads that vault's `priceFeedId` from the
 * program, fetches a fresh Pyth Pull Oracle VAA from Hermes, posts it
 * on-chain via the Pyth Solana Receiver (ephemeral pattern with rent
 * reclaimed same-tx), and bundles the `compute_quotes` instruction
 * into the same transaction atom so the price the MPC sees is the
 * price the cluster verifies against.
 */
export function useComputeQuotes(authority: PublicKey | null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const triggerRebalance = useCallback(async () => {
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

      // Fetch the vault so we know which Pyth feed it's pinned to.
      const vault = await program.account.vault.fetch(vaultPda);
      const feedIdHex = toHermesFeedId(vault.priceFeedId as number[]);

      // Pull a fresh, signed Pyth price update from Hermes. The binary
      // payload is the Wormhole-verified VAA that the on-chain receiver
      // program re-verifies before creating the PriceUpdateV2 account.
      const hermes = new HermesClient(HERMES_ENDPOINT, {});
      const { binary } = await hermes.getLatestPriceUpdates([feedIdHex], {
        encoding: "base64",
      });

      // Build an atomic transaction that (1) posts the Pyth update,
      // (2) calls compute_quotes consuming it, (3) closes the ephemeral
      // price-update account for a rent refund.
      const pythReceiver = new PythSolanaReceiver({
        connection,
        // Wallet adapter's signTransaction signature matches Pyth's expectations.
        wallet: wallet as unknown as Parameters<
          typeof PythSolanaReceiver.prototype.newTransactionBuilder
        >[0] extends never ? never : typeof wallet,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const txBuilder = pythReceiver.newTransactionBuilder({
        closeUpdateAccounts: true,
      });
      await txBuilder.addPostPriceUpdates(binary.data);

      await txBuilder.addPriceConsumerInstructions(
        async (getPriceUpdateAccount) => {
          const priceUpdate = getPriceUpdateAccount(feedIdHex);

          const computationOffset = new BN(Buffer.from(webRandomBytes(8)));
          const clusterAccount = getClusterAccAddress(DEVNET_CLUSTER_OFFSET);
          const compDefOffsetBytes = await getCompDefAccOffset("compute_quotes");
          const compDefOffset = compDefOffsetBytes.readUInt32LE();

          const ix = await program.methods
            .computeQuotes(computationOffset)
            .accountsPartial({
              cranker: wallet.publicKey,
              vault: vaultPda,
              priceUpdate,
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
            .instruction();

          return [{ instruction: ix, signers: [] }];
        }
      );

      // 50_000 microLamports = 0.00005 SOL/CU — a reasonable priority
      // fee for a latency-sensitive flow without being aggressive.
      const txs = await txBuilder.buildVersionedTransactions({
        computeUnitPriceMicroLamports: 50_000,
      });
      // PythSolanaReceiver provides a sendAll helper that signs, sends,
      // and confirms the full bundle atomically.
      const sigs = await pythReceiver.provider.sendAll!(txs, {
        commitment: "confirmed",
      });
      // The last tx in the bundle is the one that ran compute_quotes.
      setTxSig(sigs[sigs.length - 1]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [wallet, authority, connection]);

  return { triggerRebalance, loading, error, txSig };
}
