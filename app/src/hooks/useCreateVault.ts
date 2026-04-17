"use client";

import { useCallback, useState } from "react";
import {
  useConnection,
  useAnchorWallet,
} from "@solana/wallet-adapter-react";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { getProgram } from "@/lib/program";
import { getVaultPDA } from "@/lib/constants";

/**
 * Setup phases surfaced to the UI so the Create Vault panel can show
 * a progress indicator — each step is a separate on-chain round trip
 * and the UX wants honest latency reporting.
 */
export type CreateVaultPhase =
  | "idle"
  | "creating-mints"
  | "creating-accounts"
  | "initializing-vault"
  | "complete"
  | "error";

export interface CreateVaultResult {
  vaultPda: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  shareMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  userTokenAccount: PublicKey;
  userShareAccount: PublicKey;
  initTxSig: string;
}

export interface CreateVaultParams {
  /** 32 bytes. SOL/USD default baked in the UI. */
  priceFeedId: Uint8Array;
  /** Maximum age (seconds) for a Pyth price update. */
  maxPriceAgeSeconds: number;
  /**
   * Optional: mint some quote tokens to the user's wallet so they can
   * immediately test deposit after the vault is created. 0 = skip.
   */
  seedUserQuote?: bigint;
}

/**
 * End-to-end vault creation from the browser:
 *
 * 1. Generate three fresh SPL mint keypairs (base / quote / share).
 * 2. In one tx: create all three mint accounts (rent + InitializeMint2
 *    with `share_mint` authority set to the to-be-created vault PDA;
 *    other mints keep the wallet as authority so the user can mint
 *    test balances).
 * 3. In a second tx: create both vault-owned ATAs, the user's
 *    quote-side ATA, the user's share ATA, and optionally mint a
 *    seed amount of quote tokens to the user.
 * 4. In a third tx: call `initialize_vault` with the configured Pyth
 *    feed id + max price age.
 *
 * Three txs (rather than one big one) because bundling 10+ ixs in
 * a legacy v0 tx can exceed the 1232-byte limit, and staging lets us
 * confirm each phase and report progress to the UI.
 *
 * After this hook completes, the vault is usable for deposit/withdraw
 * immediately. Encrypted-state initialization (`create_vault_state`)
 * is a separate call — the wrapped MPC flow lives in its own future
 * hook so the UX stays predictable (this call chain is already ~5-8
 * seconds on devnet without the 5-10 second MPC round trip on top).
 */
export function useCreateVault() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [phase, setPhase] = useState<CreateVaultPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateVaultResult | null>(null);

  const create = useCallback(
    async (params: CreateVaultParams): Promise<CreateVaultResult | null> => {
      if (!wallet) {
        setError("Wallet not connected");
        setPhase("error");
        return null;
      }

      setError(null);
      setResult(null);
      try {
        const program = getProgram(connection, wallet);
        const payer = wallet.publicKey;
        const [vaultPda] = getVaultPDA(payer);

        // Fresh mint keypairs — the addresses exist only in memory
        // until tx 1 lands. Share-mint authority is set to `vaultPda`
        // at init, which is fine because PDAs don't need a signature
        // for program-authored mint_to (handled by the Anchor program).
        const tokenAMintKp = Keypair.generate();
        const tokenBMintKp = Keypair.generate();
        const shareMintKp = Keypair.generate();

        const lamports = await getMinimumBalanceForRentExemptMint(connection);

        // ── Tx 1: create three mints in one shot ─────────────────
        setPhase("creating-mints");
        {
          const mintIxs: TransactionInstruction[] = [];
          for (const [kp, decimals, authority, freeze] of [
            [tokenAMintKp, 9, payer, null],           // base (SOL-like)
            [tokenBMintKp, 6, payer, null],           // quote (USDC-like)
            [shareMintKp, 9, vaultPda, null],         // share — mint auth = vault PDA
          ] as const) {
            mintIxs.push(
              SystemProgram.createAccount({
                fromPubkey: payer,
                newAccountPubkey: kp.publicKey,
                space: MINT_SIZE,
                lamports,
                programId: TOKEN_PROGRAM_ID,
              }),
              createInitializeMint2Instruction(
                kp.publicKey,
                decimals,
                authority,
                freeze,
                TOKEN_PROGRAM_ID,
              ),
            );
          }
          const tx = new Transaction().add(...mintIxs);
          tx.feePayer = payer;
          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash("confirmed");
          tx.recentBlockhash = blockhash;
          // Mint keypairs sign along with the wallet (signatures enforced
          // by SystemProgram::createAccount on each new account).
          tx.partialSign(tokenAMintKp, tokenBMintKp, shareMintKp);
          const signed = await wallet.signTransaction(tx);
          const sig = await connection.sendRawTransaction(signed.serialize());
          await connection.confirmTransaction(
            { signature: sig, blockhash, lastValidBlockHeight },
            "confirmed",
          );
        }

        // Derived accounts (ATAs) — once mints exist, ATAs are PDAs we
        // can compute deterministically.
        const [tokenAVault, tokenBVault, userTokenAccount, userShareAccount] =
          await Promise.all([
            getAssociatedTokenAddress(
              tokenAMintKp.publicKey,
              vaultPda,
              true, // allowOwnerOffCurve — vault PDA is off-curve
              TOKEN_PROGRAM_ID,
            ),
            getAssociatedTokenAddress(
              tokenBMintKp.publicKey,
              vaultPda,
              true,
              TOKEN_PROGRAM_ID,
            ),
            getAssociatedTokenAddress(
              tokenBMintKp.publicKey,
              payer,
              false,
              TOKEN_PROGRAM_ID,
            ),
            getAssociatedTokenAddress(
              shareMintKp.publicKey,
              payer,
              false,
              TOKEN_PROGRAM_ID,
            ),
          ]);

        // ── Tx 2: create the four ATAs + optional user quote mint ──
        setPhase("creating-accounts");
        {
          const ataIxs: TransactionInstruction[] = [
            createAssociatedTokenAccountIdempotentInstruction(
              payer,
              tokenAVault,
              vaultPda,
              tokenAMintKp.publicKey,
              TOKEN_PROGRAM_ID,
            ),
            createAssociatedTokenAccountIdempotentInstruction(
              payer,
              tokenBVault,
              vaultPda,
              tokenBMintKp.publicKey,
              TOKEN_PROGRAM_ID,
            ),
            createAssociatedTokenAccountIdempotentInstruction(
              payer,
              userTokenAccount,
              payer,
              tokenBMintKp.publicKey,
              TOKEN_PROGRAM_ID,
            ),
            createAssociatedTokenAccountIdempotentInstruction(
              payer,
              userShareAccount,
              payer,
              shareMintKp.publicKey,
              TOKEN_PROGRAM_ID,
            ),
          ];
          if (params.seedUserQuote && params.seedUserQuote > BigInt(0)) {
            ataIxs.push(
              createMintToInstruction(
                tokenBMintKp.publicKey,
                userTokenAccount,
                payer,
                params.seedUserQuote,
                [],
                TOKEN_PROGRAM_ID,
              ),
            );
          }

          const tx = new Transaction().add(...ataIxs);
          tx.feePayer = payer;
          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash("confirmed");
          tx.recentBlockhash = blockhash;
          const signed = await wallet.signTransaction(tx);
          const sig = await connection.sendRawTransaction(signed.serialize());
          await connection.confirmTransaction(
            { signature: sig, blockhash, lastValidBlockHeight },
            "confirmed",
          );
        }

        // ── Tx 3: initialize_vault ───────────────────────────────
        setPhase("initializing-vault");
        const feedIdArray = Array.from(params.priceFeedId);
        if (feedIdArray.length !== 32) {
          throw new Error(
            `priceFeedId must be 32 bytes; got ${feedIdArray.length}`,
          );
        }

        const initTxSig = await program.methods
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .initializeVault(feedIdArray as any, new BN(params.maxPriceAgeSeconds))
          .accountsPartial({
            authority: payer,
            vault: vaultPda,
            tokenAMint: tokenAMintKp.publicKey,
            tokenBMint: tokenBMintKp.publicKey,
            tokenAVault,
            tokenBVault,
            shareMint: shareMintKp.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed" });

        const finalResult: CreateVaultResult = {
          vaultPda,
          tokenAMint: tokenAMintKp.publicKey,
          tokenBMint: tokenBMintKp.publicKey,
          shareMint: shareMintKp.publicKey,
          tokenAVault,
          tokenBVault,
          userTokenAccount,
          userShareAccount,
          initTxSig,
        };
        setResult(finalResult);
        setPhase("complete");
        return finalResult;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase("error");
        return null;
      }
    },
    [wallet, connection],
  );

  return { create, phase, error, result, reset: () => { setPhase("idle"); setError(null); setResult(null); } };
}
