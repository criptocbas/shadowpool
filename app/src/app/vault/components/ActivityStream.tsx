"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useProgramEvents } from "@/hooks/useProgramEvents";

/**
 * Live program-event stream — one line per on-chain event emitted
 * by the ShadowPool program for the connected wallet's vault.
 *
 * Subscribes via Anchor's `program.addEventListener` at mount, keeps
 * a 24-entry ring buffer newest-first, and formats each event's
 * payload into a log line with a slot prefix and a level-colored
 * body (enc / rev / warn / default).
 *
 * When no vault is connected, falls back to a deterministic sample
 * trace so the demo-mode visitor sees the styling and understands
 * what the stream represents.
 */
interface FallbackEvent {
  slot: number;
  level: "enc" | "rev" | "warn" | "default";
  text: string;
}

const FALLBACK_EVENTS: Array<Omit<FallbackEvent, "slot">> = [
  { level: "enc", text: "compute_quotes · queued · cranker=B6Mt…zPt7" },
  { level: "default", text: "pyth PriceUpdateV2 · feed=ef0d…b56d · age=2s" },
  { level: "rev", text: "QuotesComputedEvent · bid $149.625 · ask $150.375" },
  { level: "default", text: "execute_rebalance · DLMM swap · min_out=9.97" },
  { level: "enc", text: "update_balances · nonce→4137 · state rewritten" },
  { level: "rev", text: "PerformanceRevealedEvent · NAV $1_500_112.84" },
];

export function ActivityStream({
  vaultKey = null,
  baseSlot = 291_483_912,
}: {
  vaultKey?: PublicKey | null;
  baseSlot?: number;
}) {
  const events = useProgramEvents(vaultKey, 24);

  // Slot ticker for the sample trace fallback. Real-event mode reads
  // slot numbers directly from the events themselves.
  const [sampleSlot, setSampleSlot] = useState(baseSlot);
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    if (vaultKey) return; // real-event mode handles its own slots
    const a = setInterval(() => setSampleSlot((s) => s + 1), 420);
    const b = setInterval(() => setRotation((r) => r + 1), 3000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [vaultKey]);

  const hasLiveEvents = events.length > 0;
  const isLive = vaultKey !== null;

  return (
    <div>
      <div
        className="text-[10px] tracking-[0.25em] uppercase mb-3 flex items-center gap-2"
        style={{ color: "var(--text-tertiary)" }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full live-dot"
          style={{
            background: isLive
              ? "var(--accent-revealed)"
              : "var(--accent-encrypted)",
          }}
        />
        Activity
        <span className="flex-1" />
        <span
          className="text-[9px] font-mono normal-case tracking-normal"
          style={{ color: "var(--text-tertiary)", opacity: 0.7 }}
        >
          {isLive
            ? hasLiveEvents
              ? `${events.length} event${events.length === 1 ? "" : "s"}`
              : "listening…"
            : "demo · sample"}
        </span>
      </div>

      <div
        className="rounded stream-log p-4"
        style={{
          background: "oklch(0.095 0.011 260)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {isLive && !hasLiveEvents && (
          <div
            className="text-[10.5px] font-mono leading-relaxed italic"
            style={{ color: "var(--text-tertiary)", opacity: 0.7 }}
          >
            listening for program events · try running Compute quotes or
            Reveal performance from the actions panel
          </div>
        )}

        {isLive && hasLiveEvents &&
          events.map((e) => (
            <div key={e.key} className="stream-log-entry">
              <span className="stream-log-slot">
                {e.slot.toString()} ·
              </span>
              <span className="stream-log-event" data-level={e.level}>
                {e.text}
              </span>
            </div>
          ))}

        {!isLive &&
          buildSampleEntries(sampleSlot, rotation).map((e, i) => (
            <div key={`${sampleSlot}-${i}`} className="stream-log-entry">
              <span className="stream-log-slot">{e.slot.toLocaleString()} ·</span>
              <span className="stream-log-event" data-level={e.level}>
                {e.text}
              </span>
            </div>
          ))}
      </div>

      <p
        className="mt-2 text-[10px] leading-relaxed font-mono"
        style={{ color: "var(--text-tertiary)", opacity: 0.6 }}
      >
        {isLive
          ? "live · program.addEventListener across 13 events"
          : "sample trace · connect a wallet to stream your vault's events"}
      </p>
    </div>
  );
}

function buildSampleEntries(
  slot: number,
  rotation: number,
): FallbackEvent[] {
  const rotated = [
    ...FALLBACK_EVENTS.slice(rotation % FALLBACK_EVENTS.length),
    ...FALLBACK_EVENTS.slice(0, rotation % FALLBACK_EVENTS.length),
  ];
  return rotated.slice(0, 6).map((e, i) => ({
    ...e,
    slot: slot - i * 7,
  }));
}
