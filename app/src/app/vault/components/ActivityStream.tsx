"use client";

import { useEffect, useState } from "react";

/**
 * Rolling "live activity" panel for the vault dashboard sidebar.
 *
 * Styled like a program log (stream-log CSS motif we already use in
 * the landing hero) — slot-stamped, colour-tagged events that evoke a
 * running program trace rather than a cartoon notification feed.
 *
 * Currently populates from a deterministic rotating set until the
 * real event-log subscription lands (Phase 2 work). The rotation is
 * driven by a client-only tick so the server-side render is stable.
 */
interface StreamEvent {
  slot: number;
  level: "enc" | "rev" | "warn" | "default";
  text: string;
}

const SAMPLE_EVENTS: Array<Omit<StreamEvent, "slot">> = [
  { level: "enc", text: "compute_quotes · queued · cranker=B6Mt…zPt7" },
  { level: "default", text: "pyth PriceUpdateV2 · feed=ef0d…b56d · age=2s" },
  { level: "rev", text: "QuotesComputedEvent · bid $149.625 · ask $150.375" },
  { level: "default", text: "execute_rebalance · DLMM swap · min_out=9.97" },
  { level: "enc", text: "update_balances · nonce→4137 · state rewritten" },
  { level: "rev", text: "PerformanceRevealedEvent · NAV $1_500_112.84" },
  { level: "warn", text: "QuotesOverwrittenEvent · previous quote dropped" },
];

export function ActivityStream({ baseSlot = 291_483_912 }: { baseSlot?: number }) {
  const [slot, setSlot] = useState(baseSlot);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const a = setInterval(() => setSlot((s) => s + 1), 420);
    const b = setInterval(() => setRotation((r) => r + 1), 3000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const entries: StreamEvent[] = SAMPLE_EVENTS.map((e, i) => ({
    ...e,
    slot: slot - (i + (rotation % SAMPLE_EVENTS.length)) * 7,
  })).slice(0, 6);

  return (
    <div>
      <div
        className="text-[10px] tracking-[0.25em] uppercase mb-3 flex items-center gap-2"
        style={{ color: "var(--text-tertiary)" }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full live-dot"
          style={{ background: "var(--accent-encrypted)" }}
        />
        Activity
        <span className="flex-1" />
        <span
          className="text-[9px] font-mono normal-case tracking-normal"
          style={{ color: "var(--text-tertiary)", opacity: 0.7 }}
        >
          devnet
        </span>
      </div>

      <div
        className="rounded stream-log p-4"
        style={{
          background: "oklch(0.095 0.011 260)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {entries.map((e, i) => (
          <div key={`${slot}-${i}`} className="stream-log-entry">
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
        sample trace · live event subscription lands in Phase 2
      </p>
    </div>
  );
}
