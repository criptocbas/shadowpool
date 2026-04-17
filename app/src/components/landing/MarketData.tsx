import { Sparkline } from "./Sparkline";

/**
 * "Market data" block — replaces the three-stat-card grid with a ruled
 * ledger-style row table. Each row: numeric value, descriptive label,
 * tiny sparkline, and a source citation. Mirrors the aesthetic of a
 * research terminal or Bloomberg-style market dashboard more than a
 * web3 landing page.
 */
type Row = {
  value: string;
  label: string;
  source: string;
  trend: "up" | "down" | "neutral";
  tone?: "danger" | "warning" | "encrypted";
};

const DEFAULT_ROWS: Row[] = [
  {
    value: "$720M",
    label: "MEV extracted on Solana · 2025",
    source: "Solana FM · MEV Report Dec 2025",
    trend: "up",
    tone: "danger",
  },
  {
    value: "49.5%",
    label: "Liquidity providers unprofitable net of IL + extraction",
    source: "Orca + Raydium LP cohort study · Q4 2025",
    trend: "up",
    tone: "warning",
  },
  {
    value: "$3.8B",
    label: "LP capital deployed without confidential execution",
    source: "DefiLlama · Solana LP TVL breakdown",
    trend: "up",
    tone: "encrypted",
  },
  {
    value: "0",
    label: "Production confidential-execution primitives on Solana",
    source: "as of April 2026 · us, shipping",
    trend: "neutral",
    tone: "encrypted",
  },
];

export function MarketData({ rows = DEFAULT_ROWS }: { rows?: Row[] }) {
  return (
    <div className="market-data-wrap">
      {rows.map((r) => {
        const valueColor =
          r.tone === "danger"
            ? "var(--accent-danger)"
            : r.tone === "warning"
              ? "var(--accent-warning)"
              : "var(--accent-encrypted)";

        return (
          <div key={r.label} className="market-data-row">
            <div
              className="metric-display-number text-[clamp(1.5rem,3vw,2rem)] leading-none"
              style={{ color: valueColor, minWidth: "5rem" }}
            >
              {r.value}
            </div>

            <div>
              <div
                className="text-[13px] leading-snug"
                style={{ color: "var(--text-primary)" }}
              >
                {r.label}
              </div>
              <div
                className="mt-1 text-[10px] tracking-[0.1em] uppercase font-mono"
                style={{ color: "var(--text-tertiary)" }}
              >
                src · {r.source}
              </div>
            </div>

            <div className="hidden sm:block opacity-70">
              <Sparkline seed={r.label} trend={r.trend} />
            </div>

            <div
              className="hidden md:block text-[10px] tracking-[0.15em] uppercase font-mono"
              style={{ color: "var(--text-tertiary)" }}
            >
              {r.trend === "up" ? "↑ trending" : r.trend === "down" ? "↓ trending" : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
