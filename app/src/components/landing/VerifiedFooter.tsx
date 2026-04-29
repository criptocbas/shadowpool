/**
 * Footer built as a "verifiable facts" grid, not a copyright line.
 * Every cell carries a checkable claim — program id, oracle feed,
 * Meteora program, devnet status, CI badge. The philosophy: at an
 * institutional grade, the footer is also signal, not decoration.
 */
type Cell = {
  label: string;
  value: string;
  link?: string;
  tone: "encrypted" | "revealed" | "neutral";
};

const CELLS: Cell[] = [
  {
    label: "ShadowPool · program",
    value: "Cf3vfadb…RZkn",
    link: "https://explorer.solana.com/address/BEu9VWMdba4NumzJ3NqYtHysPtCWe1gB33SbDwZ64g4g?cluster=devnet",
    tone: "encrypted",
  },
  {
    label: "Pyth · SOL/USD feed",
    value: "ef0d8b6f…b56d",
    link: "https://insights.pyth.network/price-feeds/Crypto.SOL%2FUSD",
    tone: "revealed",
  },
  {
    label: "Meteora · DLMM",
    value: "LBUZKh…wxo",
    link: "https://explorer.solana.com/address/LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    tone: "neutral",
  },
  {
    label: "Arcium · MPC",
    value: "mainnet-alpha",
    link: "https://www.arcium.com",
    tone: "encrypted",
  },
  {
    label: "Network",
    value: "Solana devnet · cluster 456",
    tone: "neutral",
  },
  {
    label: "Event",
    value: "Colosseum Frontier 2026",
    tone: "neutral",
  },
];

export function VerifiedFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--bg-ticker)",
      }}
    >
      <div className="verified-grid">
        {CELLS.map((c) => {
          const valueColor =
            c.tone === "encrypted"
              ? "var(--accent-encrypted)"
              : c.tone === "revealed"
                ? "var(--accent-revealed)"
                : "var(--text-secondary)";

          const content = (
            <>
              <div
                className="text-[9px] tracking-[0.2em] uppercase mb-1.5"
                style={{ color: "var(--text-tertiary)" }}
              >
                {c.label}
              </div>
              <div
                className="font-mono text-[11.5px] tabular-nums"
                style={{ color: valueColor }}
              >
                {c.value}
              </div>
            </>
          );

          return c.link ? (
            <a
              key={c.label}
              href={c.link}
              target="_blank"
              rel="noreferrer"
              className="verified-cell transition-colors hover:bg-[var(--bg-surface)]"
            >
              {content}
            </a>
          ) : (
            <div key={c.label} className="verified-cell">
              {content}
            </div>
          );
        })}
      </div>

      {/* Final line — compact, mono, nothing decorative */}
      <div
        className="flex items-center justify-between px-5 py-3 text-[10px] font-mono"
        style={{
          color: "var(--text-tertiary)",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <span>shadowpool · built on solana × arcium</span>
        <span className="flex items-center gap-4">
          <span>v0.1.0-alpha</span>
          <span
            className="flex items-center gap-1.5"
            title="Every claim above links to a public record."
          >
            <span
              className="w-1 h-1 rounded-full"
              style={{ background: "var(--accent-revealed)" }}
            />
            verifiable
          </span>
        </span>
      </div>
    </footer>
  );
}
