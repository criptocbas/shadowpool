/**
 * "Built with" section — five infrastructure partners that make
 * ShadowPool possible. Typography-driven, no logo hunt — each row
 * is partner name (editorial serif) + role (mono uppercase) +
 * one-line description (sans) + a precise reference to where the
 * integration lives in the codebase / on-chain address.
 *
 * Deliberately avoids the usual "logo grid" cliche; every row is
 * actionable (link to the partner + the specific address/commit in
 * our repo where the integration happens). Reads as institutional
 * attribution, not a sponsor reel.
 */
const PARTNERS = [
  {
    index: "01",
    name: "Arcium",
    role: "mainnet-alpha MPC network",
    description:
      "Every encrypted state ciphertext lives inside Arcium's MPC cluster. All five Arcis circuits compile against the 0.9.2 client; compute_quotes, update_balances, update_strategy, reveal_performance run there.",
    reference: {
      label: "cluster 456 · devnet",
      href: "https://arcium.com",
    },
  },
  {
    index: "02",
    name: "Pyth Network",
    role: "Pull Oracle · SOL/USD",
    description:
      "Five-layer validation in compute_quotes: owner check, feed-id match, staleness, sanity bounds (price > 0, exp ∈ [-18,0], conf ≤ 1%), u128 normalization to micro-USD. Feed id ef0d…b56d.",
    reference: {
      label: "PriceUpdateV2 ↗",
      href: "https://insights.pyth.network/price-feeds/Crypto.SOL%2FUSD",
    },
  },
  {
    index: "03",
    name: "Meteora",
    role: "Dynamic Liquidity Market Maker",
    description:
      "execute_rebalance CPIs into the DLMM program with the vault PDA as signer. Bin arrays pre-computed client-side; MPC-anchored slippage floor enforced on every swap.",
    reference: {
      label: "LBUZKh…wxo",
      href: "https://explorer.solana.com/address/LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    },
  },
  {
    index: "04",
    name: "Solana",
    role: "Layer 1",
    description:
      "400ms slot time and cheap CUs make MPC round-trip latency tolerable in production. The whole primitive requires a fast, cheap, composable L1; Solana is the only one with all three.",
    reference: {
      label: "devnet",
      href: "https://explorer.solana.com/?cluster=devnet",
    },
  },
  {
    index: "05",
    name: "Token-2022",
    role: "SPL extension allow-list",
    description:
      "Six dangerous extensions explicitly rejected at InitializeVault: PermanentDelegate, TransferFeeConfig, ConfidentialTransferMint, DefaultAccountState, NonTransferable, TransferHook.",
    reference: {
      label: "spl-token-2022 ↗",
      href: "https://spl.solana.com/token-2022",
    },
  },
];

export function PartnersRows() {
  return (
    <div>
      {PARTNERS.map((p) => (
        <div
          key={p.index}
          className="grid gap-x-6 gap-y-2 py-6 items-baseline"
          style={{
            gridTemplateColumns: "4rem minmax(0,16rem) minmax(0,1fr) auto",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div
            className="text-[10px] font-mono tracking-[0.2em] uppercase"
            style={{ color: "var(--text-tertiary)" }}
          >
            {p.index}
          </div>

          <div>
            <div
              className="font-editorial text-[clamp(1.3rem,2vw,1.65rem)] leading-tight"
              style={{ color: "var(--text-editorial)" }}
            >
              {p.name}
            </div>
            <div
              className="mt-1 text-[10px] font-mono tracking-[0.18em] uppercase"
              style={{ color: "var(--accent-encrypted)" }}
            >
              {p.role}
            </div>
          </div>

          <div
            className="text-[13px] leading-relaxed max-w-xl"
            style={{ color: "var(--text-secondary)" }}
          >
            {p.description}
          </div>

          <a
            href={p.reference.href}
            target="_blank"
            rel="noreferrer"
            className="hidden lg:inline text-[10px] font-mono tracking-[0.12em] uppercase px-2.5 py-1.5 rounded whitespace-nowrap transition-opacity hover:opacity-70"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-tertiary)",
            }}
          >
            {p.reference.label}
          </a>
        </div>
      ))}
      <div
        style={{
          borderTop: "1px solid var(--border-subtle)",
          height: 0,
        }}
      />
    </div>
  );
}
