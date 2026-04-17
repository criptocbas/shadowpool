"use client";

/**
 * Horizontal ticker bar beneath the nav. Scrolls a set of short,
 * verifiable claims (not marketing fluff — each item is either a
 * published stat or an on-chain fact). Loops seamlessly by rendering
 * the items twice and translating −50% via CSS.
 *
 * Hover pauses the scroll so a reader can clock a specific item.
 */
type Tone = "encrypted" | "revealed" | "danger" | "neutral";
type Item =
  | { kind: "stat"; value: string; label: string; source?: string }
  | { kind: "tag"; label: string; tone?: Tone };

const DEFAULT_ITEMS: Item[] = [
  { kind: "stat", value: "$720M", label: "MEV extracted on Solana 2025" },
  { kind: "tag", label: "Arcium mainnet-alpha live · Feb 2026", tone: "encrypted" },
  { kind: "stat", value: "49.5%", label: "Solana LPs unprofitable net of IL + extraction" },
  { kind: "tag", label: "Pyth Pull Oracle · SOL/USD ×1% conf cap", tone: "revealed" },
  { kind: "stat", value: "$3.8B", label: "LP capital — unprotected" },
  { kind: "tag", label: "Meteora DLMM · PDA-signed swap CPI", tone: "neutral" },
  { kind: "stat", value: "5-layer", label: "oracle validation · owner → feed-id → stale → sanity → norm" },
  { kind: "tag", label: "Token-2022 extension allow-list · 6 dangerous extensions rejected", tone: "neutral" },
];

function toneColor(tone: Tone | undefined): string {
  switch (tone) {
    case "encrypted": return "var(--accent-encrypted)";
    case "revealed": return "var(--accent-revealed)";
    case "danger": return "var(--accent-danger)";
    default: return "var(--text-secondary)";
  }
}

export function Ticker({ items = DEFAULT_ITEMS }: { items?: Item[] }) {
  const rendered = [...items, ...items]; // double for seamless loop

  return (
    <div
      className="ticker relative overflow-hidden"
      style={{
        background: "var(--bg-ticker)",
        borderTop: "1px solid var(--border-subtle)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
      aria-label="ShadowPool live ticker"
    >
      {/* edge fades so the loop seams are invisible */}
      <div
        className="absolute left-0 top-0 bottom-0 w-16 pointer-events-none z-10"
        style={{
          background:
            "linear-gradient(90deg, var(--bg-ticker) 0%, transparent 100%)",
        }}
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-16 pointer-events-none z-10"
        style={{
          background:
            "linear-gradient(270deg, var(--bg-ticker) 0%, transparent 100%)",
        }}
      />

      <div className="ticker-track py-2.5">
        {rendered.map((item, i) => (
          <div key={i} className="ticker-item">
            {item.kind === "stat" ? (
              <>
                <span
                  className="font-mono text-[11px] font-medium tracking-tight"
                  style={{ color: "var(--text-primary)" }}
                >
                  {item.value}
                </span>
                <span
                  className="text-[10px] tracking-[0.12em] uppercase"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {item.label}
                </span>
              </>
            ) : (
              <>
                <span
                  className="w-1 h-1 rounded-full"
                  style={{ background: toneColor(item.tone) }}
                  aria-hidden
                />
                <span
                  className="font-mono text-[10.5px] tracking-wide"
                  style={{ color: toneColor(item.tone) }}
                >
                  {item.label}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
