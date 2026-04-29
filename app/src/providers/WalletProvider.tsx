"use client";

import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { Buffer } from "buffer";

import "@solana/wallet-adapter-react-ui/styles.css";

// Install the `buffer` polyfill onto globalThis. Several Solana/Pyth
// packages internally call `Buffer.from(...)` expecting a Node-style
// global Buffer with the full method surface (readUint8, readUint16BE,
// etc.). Without this, Next.js/Turbopack provides a Uint8Array-like
// shim that lacks those methods, and `addPostPriceUpdates` blows up
// inside @pythnetwork/price-service-sdk's parseAccumulatorUpdateData
// with `data.readUint8 is not a function`.
if (typeof globalThis !== "undefined") {
  // @ts-expect-error — Buffer typing on globalThis isn't built-in
  if (!globalThis.Buffer) globalThis.Buffer = Buffer;
}

const DEVNET_RPC = clusterApiUrl("devnet");

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
