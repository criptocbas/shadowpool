/**
 * "Who this is for" — three persona rows. Typography-driven, no icons,
 * no cards. Each row: index, persona + specific pain, concrete tool
 * tag on the right. Reads like an editorial list, not a feature grid.
 */
const PERSONAS = [
  {
    index: "01",
    who: "Tokenized funds",
    pain:
      "rebalancing on-chain without broadcasting your strategy to every bot in the mempool.",
    tool: "vault · execute_rebalance",
  },
  {
    index: "02",
    who: "Protocols",
    pain:
      "embed confidential execution in your matching engine, auction, or vault — one MPC primitive, PDA-signer CPIs.",
    tool: "arcium · execution-layer SDK",
  },
  {
    index: "03",
    who: "LPs who want their edge back",
    pain:
      "if you've ever watched your P&L bleed into a sandwich log, this is the tool you needed. The strategy lives inside MPC, not on-chain.",
    tool: "dashboard · deposit",
  },
];

export function PersonaRows() {
  return (
    <div>
      {PERSONAS.map((p) => (
        <div key={p.index} className="persona-row">
          <div
            className="text-[10px] font-mono tracking-[0.2em] uppercase"
            style={{ color: "var(--text-tertiary)" }}
          >
            {p.index}
          </div>

          <div>
            <div
              className="font-editorial text-[clamp(1.2rem,2vw,1.5rem)] leading-tight"
              style={{ color: "var(--text-editorial)" }}
            >
              {p.who}
              <span
                className="font-sans font-normal ml-2 text-[clamp(0.9rem,1.4vw,1.05rem)]"
                style={{ color: "var(--text-secondary)" }}
              >
                — {p.pain}
              </span>
            </div>
          </div>

          <div className="hidden md:block">
            <span
              className="text-[10px] font-mono tracking-[0.12em] uppercase px-2 py-1 rounded whitespace-nowrap"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-tertiary)",
              }}
            >
              {p.tool}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
