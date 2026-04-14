"use client";

import { useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

/**
 * Design-system-matched replacement for <WalletMultiButton />.
 *
 * The default wallet adapter button ships with a purple gradient and its
 * own CSS module that clashes with ShadowPool's quiet monochrome design.
 * This component renders the same four states (disconnected / connecting /
 * connected / disconnecting) using in-design tokens.
 */
export function ConnectButton() {
  const { publicKey, connected, connecting, disconnecting, wallet, disconnect } =
    useWallet();
  const { setVisible } = useWalletModal();

  const shortKey = useMemo(() => {
    if (!publicKey) return "";
    const b58 = publicKey.toBase58();
    return `${b58.slice(0, 4)}…${b58.slice(-4)}`;
  }, [publicKey]);

  const onClick = useCallback(() => {
    if (connecting || disconnecting) return;
    if (connected) {
      void disconnect();
      return;
    }
    setVisible(true);
  }, [connected, connecting, disconnecting, disconnect, setVisible]);

  const label = connecting
    ? "Connecting…"
    : disconnecting
      ? "Disconnecting…"
      : connected
        ? shortKey
        : "Connect Wallet";

  const dotColor = connected
    ? "var(--accent-revealed)"
    : connecting
      ? "var(--accent-warning)"
      : "var(--accent-encrypted)";

  return (
    <button
      onClick={onClick}
      disabled={connecting || disconnecting}
      className="group flex items-center gap-2 text-sm font-mono px-3 py-1.5 rounded transition-colors"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        color: "var(--text-primary)",
      }}
      title={
        connected && wallet
          ? `Connected with ${wallet.adapter.name} — click to disconnect`
          : "Connect a Solana wallet"
      }
    >
      <span
        className="w-1.5 h-1.5 rounded-full transition-colors"
        style={{ background: dotColor }}
      />
      <span className="tracking-wide">{label}</span>
      {connected && (
        <span
          className="text-[9px] tracking-[0.15em] uppercase opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--text-tertiary)" }}
        >
          click to disconnect
        </span>
      )}
    </button>
  );
}
