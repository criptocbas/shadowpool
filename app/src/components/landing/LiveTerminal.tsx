"use client";

import { useEffect, useState } from "react";
import { HexDump } from "./HexDump";

/**
 * Hero terminal — larger, livelier successor to the original "cipher
 * panel." Organized like a trading/ops console:
 *   • header bar with cluster health dot + slot counter + cluster id
 *   • encrypted state block (xxd-style hex dump)
 *   • three-node MPC heartbeat
 *   • revealed quote pane with bid/ask/spread
 *   • rolling stream log at the bottom
 *
 * Every datum is stable and deterministic on the server; live tickers
 * only advance in a `useEffect` so the first paint is SSR-safe.
 */
export function LiveTerminal({ mounted }: { mounted: boolean }) {
  const [slot, setSlot] = useState(291_483_912);
  const [logTick, setLogTick] = useState(0);

  useEffect(() => {
    const s = setInterval(() => setSlot((x) => x + 1), 420);
    const l = setInterval(() => setLogTick((t) => t + 1), 2400);
    return () => {
      clearInterval(s);
      clearInterval(l);
    };
  }, []);

  return (
    <div
      className={`hero-terminal relative transition-all duration-1000 delay-200 ${
        mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
    >
      {/* Top status bar */}
      <div className="hero-terminal-bar">
        <div className="hero-terminal-dot" />
        <span
          className="text-[9px] font-mono uppercase tracking-[0.22em]"
          style={{ color: "var(--text-secondary)" }}
        >
          shadowpool · cluster-456
        </span>
        <div className="flex-1" />
        <span
          className="text-[10px] font-mono tabular-nums"
          style={{ color: "var(--text-tertiary)" }}
        >
          slot {slot.toLocaleString()}
        </span>
      </div>

      {/* Encrypted region */}
      <div
        className="px-5 py-5 border-b"
        style={{ borderColor: "oklch(0.22 0.015 200 / 0.3)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[10px] tracking-[0.22em] uppercase"
            style={{ color: "var(--accent-encrypted)" }}
          >
            encrypted_state · [[u8;32];5]
          </span>
          <span
            className="text-[9px] font-mono"
            style={{ color: "var(--text-tertiary)" }}
          >
            offset 0x00f9 · 160 bytes
          </span>
        </div>

        <HexDump rows={3} bytesPerRow={16} tickMs={260} />
      </div>

      {/* MPC heartbeat divider */}
      <div
        className="px-5 py-3 flex items-center gap-3"
        style={{
          background: "oklch(0.095 0.012 260)",
          borderBottom: "1px solid oklch(0.22 0.015 200 / 0.3)",
        }}
      >
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className="mpc-node w-[7px] h-[7px] rounded-full"
                style={{
                  background: "var(--accent-encrypted)",
                  animationDelay: `${i * 0.4}s`,
                }}
              />
              {i < 2 && (
                <div
                  className="mpc-line w-5 h-px"
                  style={{
                    background: "var(--accent-encrypted-dim)",
                    animationDelay: `${i * 0.4 + 0.2}s`,
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <span
          className="text-[9px] font-mono uppercase tracking-[0.2em]"
          style={{ color: "var(--accent-encrypted-dim)" }}
        >
          Arcium MPC
        </span>
        <div
          className="flex-1 h-px"
          style={{ background: "oklch(0.22 0.015 200 / 0.25)" }}
        />
        <span
          className="text-[9px] font-mono uppercase tracking-[0.15em]"
          style={{ color: "var(--text-tertiary)" }}
        >
          computing · compute_quotes
        </span>
      </div>

      {/* Revealed quote pane */}
      <div className="px-5 py-5">
        <div className="flex items-center justify-between mb-4">
          <span
            className="text-[10px] tracking-[0.22em] uppercase"
            style={{ color: "var(--accent-revealed)" }}
          >
            quote output · revealed
          </span>
          <span
            className="text-[9px] font-mono tabular-nums"
            style={{ color: "var(--text-tertiary)" }}
          >
            from encrypted · 42ms
          </span>
        </div>

        <div className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2.5 items-baseline">
          <span
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{ color: "var(--text-tertiary)" }}
          >
            bid
          </span>
          <div className="flex items-baseline justify-between">
            <span
              className="font-mono text-xl font-light tabular-nums"
              style={{ color: "var(--accent-revealed)" }}
            >
              149.625
            </span>
            <span
              className="text-[11px] font-mono"
              style={{ color: "var(--text-tertiary)" }}
            >
              10.0 SOL
            </span>
          </div>

          <span
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{ color: "var(--text-tertiary)" }}
          >
            ask
          </span>
          <div className="flex items-baseline justify-between">
            <span
              className="font-mono text-xl font-light tabular-nums"
              style={{ color: "var(--accent-revealed)" }}
            >
              150.375
            </span>
            <span
              className="text-[11px] font-mono"
              style={{ color: "var(--text-tertiary)" }}
            >
              10.0 SOL
            </span>
          </div>

          <span
            className="text-[10px] font-mono uppercase tracking-[0.2em] pt-1"
            style={{
              color: "var(--text-tertiary)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            spread
          </span>
          <div
            className="flex items-baseline justify-between pt-1"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <span
              className="font-mono text-sm tabular-nums"
              style={{ color: "var(--text-secondary)" }}
            >
              0.50%
            </span>
            <span
              className="text-[11px] font-mono"
              style={{ color: "var(--accent-revealed-dim)" }}
            >
              50 bps
            </span>
          </div>
        </div>
      </div>

      {/* Stream log */}
      <div
        className="px-5 py-4 stream-log"
        style={{
          background: "oklch(0.09 0.011 260)",
          borderTop: "1px solid oklch(0.22 0.015 200 / 0.25)",
        }}
      >
        {buildLogEntries(slot, logTick).map((e, i) => (
          <div key={`${slot}-${i}`} className="stream-log-entry">
            <span className="stream-log-slot">
              {e.slot.toLocaleString()} ·
            </span>
            <span className="stream-log-event" data-level={e.level}>
              {e.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildLogEntries(
  slot: number,
  tick: number,
): Array<{ slot: number; text: string; level: "enc" | "rev" | "default" | "warn" }> {
  // Deterministic pseudo-events seeded by the slot + tick so the log
  // refreshes on a timer without ever flashing untrustworthy noise.
  const events: Array<{ offset: number; text: string; level: "enc" | "rev" | "default" | "warn" }> = [
    { offset: 0, text: "compute_quotes · queued · cranker=B6Mt…zPt7", level: "enc" },
    { offset: -4, text: "pyth PriceUpdateV2 · feed=ef0d…b56d · age=2s", level: "default" },
    { offset: -11, text: "callback · QuotesComputedEvent · 50 bps", level: "rev" },
    { offset: -18, text: "execute_rebalance · DLMM swap · min_out=9.97", level: "default" },
    { offset: -29, text: "update_balances · nonce→4137 · encrypted_state rewritten", level: "enc" },
  ];
  // rotate on each tick so the log isn't static
  const rotate = tick % events.length;
  const rotated = [...events.slice(rotate), ...events.slice(0, rotate)];
  return rotated.slice(0, 5).map((e) => ({
    slot: slot + e.offset,
    text: e.text,
    level: e.level,
  }));
}
