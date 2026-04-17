"use client";

import { useEffect, useRef, useState } from "react";
import {
  useConnection,
  useAnchorWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getProgram } from "@/lib/program";

/**
 * Formatted, UI-ready event record. One entry per on-chain event
 * the program emits; the formatter baked into the hook turns the raw
 * anchor event payload into a human-readable line with its slot,
 * level tag, and an optional numeric highlight.
 */
export interface ProgramEventRecord {
  key: string;           // unique id — event name + slot + counter
  slot: bigint;
  receivedAt: number;    // client Date.now() when dispatched
  level: "enc" | "rev" | "default" | "warn";
  eventName: string;
  text: string;
}

// Every event the program emits, per `programs/shadowpool/src/events.rs`.
// Order matters only for the listener order; nothing downstream depends on it.
const EVENTS: Array<{
  name: string;
  level: ProgramEventRecord["level"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  format: (ev: any, formatters: Formatters) => string;
}> = [
  {
    name: "vaultCreatedEvent",
    level: "default",
    format: (ev, f) =>
      `vault created · authority=${f.short(ev.authority)} · pair=${f.short(ev.tokenAMint, 4, 3)}/${f.short(ev.tokenBMint, 4, 3)}`,
  },
  {
    name: "vaultStateInitializedEvent",
    level: "enc",
    format: () => "encrypted state initialized · Enc<Mxe, VaultState> written",
  },
  {
    name: "quotesComputedEvent",
    level: "rev",
    format: (ev, f) =>
      `quotes computed · bid ${f.usd(ev.bidPrice)} / ask ${f.usd(ev.askPrice)} · rebalance=${Number(ev.shouldRebalance) === 1 ? "yes" : "no"}`,
  },
  {
    name: "quotesOverwrittenEvent",
    level: "warn",
    format: (ev, f) =>
      `quotes overwritten · previous slot=${f.num(ev.previousSlot)} · race between crankers`,
  },
  {
    name: "balancesUpdatedEvent",
    level: "enc",
    format: () => "encrypted balances updated · Enc<Mxe> rewritten · nonce advanced",
  },
  {
    name: "strategyUpdatedEvent",
    level: "enc",
    format: () => "encrypted strategy updated · spread / threshold rotated",
  },
  {
    name: "performanceRevealedEvent",
    level: "rev",
    format: (ev, f) =>
      `NAV attested · ${f.usd(ev.totalValueInQuote)} · selective disclosure`,
  },
  {
    name: "depositEvent",
    level: "default",
    format: (ev, f) =>
      `deposit · user=${f.short(ev.user)} · ${f.usd(ev.amount)} → ${f.raw(ev.sharesMinted, 9, 2)} spTokens`,
  },
  {
    name: "withdrawEvent",
    level: "default",
    format: (ev, f) =>
      `withdraw · user=${f.short(ev.user)} · ${f.raw(ev.sharesBurned, 9, 2)} spTokens → ${f.usd(ev.amountOut)}`,
  },
  {
    name: "rebalanceExecutedEvent",
    level: "rev",
    format: (ev, f) =>
      `rebalance executed · bid ${f.usd(ev.bidPrice)} / ask ${f.usd(ev.askPrice)} · DLMM swap`,
  },
  {
    name: "crankerSetEvent",
    level: "default",
    format: (ev, f) =>
      `cranker delegated · ${f.short(ev.previousCranker)} → ${f.short(ev.newCranker)}`,
  },
  {
    name: "emergencyOverrideEvent",
    level: "warn",
    format: (ev) => {
      const flags: string[] = [];
      if (ev.clearedNavStale) flags.push("nav_stale=false");
      if (ev.clearedPendingState) flags.push("pending_state=None");
      return `emergency override · ${flags.join(" · ") || "event-only"}`;
    },
  },
  {
    name: "vaultClosedEvent",
    level: "warn",
    format: (ev, f) =>
      `vault closed · ${f.raw(ev.lamportsReturned, 9, 4)} SOL returned${ev.wasLegacyLayout ? " · legacy-layout rescue" : ""}`,
  },
];

// Field-formatter helpers shared across every event's format function.
interface Formatters {
  short: (pk: PublicKey, head?: number, tail?: number) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usd: (v: any) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: (v: any, decimals?: number, precision?: number) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  num: (v: any) => string;
}

function makeFormatters(): Formatters {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toBig = (v: any): bigint => {
    if (typeof v === "bigint") return v;
    if (v === null || v === undefined) return BigInt(0);
    if (BN.isBN(v)) return BigInt(v.toString());
    if (typeof v === "number") return BigInt(v);
    if (v?.toString) return BigInt(v.toString());
    return BigInt(0);
  };
  const usd = (v: unknown): string => {
    // 6-decimal micro-USD scale
    const n = Number(toBig(v)) / 1e6;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };
  const raw = (v: unknown, decimals = 9, precision = 2): string => {
    const n = Number(toBig(v)) / 10 ** decimals;
    return n.toLocaleString(undefined, { maximumFractionDigits: precision });
  };
  const num = (v: unknown): string => toBig(v).toString();
  const short = (pk: PublicKey, head = 4, tail = 3): string => {
    if (!pk || typeof pk.toBase58 !== "function") return "?";
    const s = pk.toBase58();
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
  };
  return { short, usd, raw, num };
}

/**
 * Subscribe to every event the ShadowPool program emits, filter to
 * the supplied vault key, and keep a rolling buffer of the last
 * `capacity` records for UI consumption.
 *
 * When `vaultKey` is null, the hook returns an empty buffer and
 * skips subscribing (cheaper, no race between listener attach and
 * wallet connect).
 *
 * Listeners are attached once per (program, vaultKey) pair and
 * cleaned up on unmount — the `useRef` holds the ring buffer so
 * we don't re-subscribe on every render tick.
 */
export function useProgramEvents(
  vaultKey: PublicKey | null,
  capacity = 24,
): ProgramEventRecord[] {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [events, setEvents] = useState<ProgramEventRecord[]>([]);
  const counterRef = useRef(0);

  useEffect(() => {
    if (!wallet || !vaultKey) {
      setEvents([]);
      return;
    }

    const program = getProgram(connection, wallet);
    const formatters = makeFormatters();
    const listenerIds: number[] = [];

    for (const { name, level, format } of EVENTS) {
      try {
        const id = program.addEventListener(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          name as any,
          (payload: Record<string, unknown>) => {
            // Vault-scope filter: every event in the program carries a
            // `vault: Pubkey` field. Drop events for other vaults.
            const evVault = payload.vault as PublicKey | undefined;
            if (!evVault || !evVault.equals(vaultKey)) return;

            const slotField = payload.slot as unknown;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toBig = (v: any): bigint => {
              if (typeof v === "bigint") return v;
              if (v === null || v === undefined) return BigInt(0);
              if (BN.isBN(v)) return BigInt(v.toString());
              if (typeof v === "number") return BigInt(v);
              if (v?.toString) return BigInt(v.toString());
              return BigInt(0);
            };
            const slot = toBig(slotField);

            counterRef.current += 1;
            const record: ProgramEventRecord = {
              key: `${name}-${slot.toString()}-${counterRef.current}`,
              slot,
              receivedAt: Date.now(),
              level,
              eventName: name,
              text: format(payload, formatters),
            };

            setEvents((prev) => {
              // Newest-first ring buffer.
              const next = [record, ...prev];
              if (next.length > capacity) next.length = capacity;
              return next;
            });
          },
        );
        listenerIds.push(id);
      } catch {
        // Older program IDLs may not declare every event; silently
        // skip rather than crashing the whole subscription set.
      }
    }

    return () => {
      for (const id of listenerIds) {
        try {
          program.removeEventListener(id);
        } catch {
          // swallow — disposal must not throw
        }
      }
    };
  }, [connection, wallet, vaultKey, capacity]);

  return events;
}
