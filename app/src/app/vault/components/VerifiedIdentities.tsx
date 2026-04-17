"use client";

import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/constants";

/**
 * Strip of on-chain identifiers — program, vault PDA, share mint,
 * Pyth feed, DLMM program — displayed as a compact ledger.
 *
 * Reads as "here are the accounts backing everything on this page;
 * every one is link-clickable to the explorer". Gives the dashboard
 * the institutional signal of showing its work — every claim is a
 * PublicKey an auditor can verify independently.
 */
type Identity = {
  label: string;
  value: string;
  explorerHref?: string;
  tone?: "encrypted" | "revealed" | "neutral";
};

// SOL/USD feed id (chain-agnostic) + DLMM program id — pinned in repo.
const SOL_USD_FEED_ID =
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const DLMM_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

function shorten(s: string, head = 6, tail = 4): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function VerifiedIdentities({
  vaultPda,
  shareMint,
  feedId,
  cluster = "devnet",
}: {
  vaultPda?: PublicKey | null;
  shareMint?: PublicKey | null;
  feedId?: string | null;
  cluster?: "devnet" | "mainnet-beta";
}) {
  const clusterQ = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  const explorer = (addr: string) =>
    `https://explorer.solana.com/address/${addr}${clusterQ}`;

  const ids: Identity[] = [
    {
      label: "Program",
      value: PROGRAM_ID.toBase58(),
      explorerHref: explorer(PROGRAM_ID.toBase58()),
      tone: "encrypted",
    },
    {
      label: "Vault PDA",
      value: vaultPda?.toBase58() ?? "—",
      explorerHref: vaultPda ? explorer(vaultPda.toBase58()) : undefined,
      tone: "neutral",
    },
    {
      label: "Share mint",
      value: shareMint?.toBase58() ?? "—",
      explorerHref: shareMint ? explorer(shareMint.toBase58()) : undefined,
      tone: "neutral",
    },
    {
      label: "Pyth feed",
      value: feedId ?? SOL_USD_FEED_ID,
      explorerHref: "https://insights.pyth.network/price-feeds/Crypto.SOL%2FUSD",
      tone: "revealed",
    },
    {
      label: "DLMM program",
      value: DLMM_PROGRAM_ID,
      explorerHref: explorer(DLMM_PROGRAM_ID),
      tone: "neutral",
    },
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 md:px-10 py-3"
      style={{
        background: "var(--bg-ticker)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <span
        className="text-[9px] font-mono tracking-[0.25em] uppercase"
        style={{ color: "var(--text-tertiary)" }}
      >
        · verified identities
      </span>
      {ids.map((id) => {
        const color =
          id.tone === "encrypted"
            ? "var(--accent-encrypted)"
            : id.tone === "revealed"
              ? "var(--accent-revealed)"
              : "var(--text-secondary)";

        const content = (
          <span className="flex items-center gap-2">
            <span
              className="text-[9px] tracking-[0.15em] uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              {id.label}
            </span>
            <span
              className="font-mono text-[10.5px] tabular-nums"
              style={{ color }}
              title={id.value}
            >
              {id.value.startsWith("0x")
                ? shorten(id.value, 8, 4)
                : shorten(id.value)}
            </span>
          </span>
        );

        return id.explorerHref ? (
          <a
            key={id.label}
            href={id.explorerHref}
            target="_blank"
            rel="noreferrer"
            className="transition-opacity hover:opacity-70"
          >
            {content}
          </a>
        ) : (
          <span key={id.label}>{content}</span>
        );
      })}
    </div>
  );
}
