"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ─── Simulated Data (replace with on-chain reads) ─────────────────────
const MOCK_VAULT = {
  pair: "SOL / USDC",
  tvl: 1_250_000,
  apy: 12.4,
  sharePrice: 1.032,
  totalShares: 1_211_240,
  lastRebalance: 14,
  encryptedState: [
    "a3f2c1e847b9d06f5c8a3e27d14b096e",
    "7d91f3b2e8c40a1d6f95372c0e48d1ab",
    "5c6a0f82d39e71b4c28f5a0163e7d4b9",
    "2e8fc71d4a956b30e1c87f24d05a3c68",
    "9b4d62f8c1073e5a28d49b1f70c6e3a2",
  ],
  quotes: {
    bidPrice: 149.625,
    bidSize: 83.2,
    askPrice: 150.375,
    askSize: 10000,
    shouldRebalance: false,
    oraclePrice: 150.0,
    timestamp: Date.now() - 14000,
  },
  rebalanceHistory: [
    { time: "2m ago", bid: 149.625, ask: 150.375, rebalanced: false },
    { time: "3m ago", bid: 149.600, ask: 150.400, rebalanced: true },
    { time: "4m ago", bid: 149.550, ask: 150.450, rebalanced: false },
    { time: "5m ago", bid: 149.700, ask: 150.300, rebalanced: false },
    { time: "6m ago", bid: 149.400, ask: 150.600, rebalanced: true },
  ],
};

// ─── Hex Shimmer ──────────────────────────────────────────────────────
function useShimmeringHex(base: string, interval: number) {
  const mutate = useCallback(() => {
    const chars = "0123456789abcdef";
    const arr = base.split("");
    const idx = Math.floor(Math.random() * arr.length);
    arr[idx] = chars[Math.floor(Math.random() * 16)];
    return arr.join("");
  }, [base]);

  const [hex, setHex] = useState(base);
  useEffect(() => {
    const id = setInterval(() => setHex(mutate()), interval);
    return () => clearInterval(id);
  }, [mutate, interval]);
  return hex;
}

function EncryptedField({
  label,
  baseHex,
  index,
}: {
  label: string;
  baseHex: string;
  index: number;
}) {
  const hex = useShimmeringHex(baseHex, 80 + index * 20);
  return (
    <div
      className="cipher-shimmer py-2"
      style={{ animationDelay: `${index * 0.3}s` }}
    >
      <div
        className="text-[10px] font-mono uppercase tracking-wider mb-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-xs tracking-widest break-all leading-relaxed"
        style={{ color: "var(--accent-encrypted)" }}
      >
        0x{hex}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────
export default function VaultDashboard() {
  const [mounted, setMounted] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  useEffect(() => setMounted(true), []);

  const v = MOCK_VAULT;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-deep)" }}>
      {/* Top bar */}
      <header
        className="flex items-center justify-between px-6 md:px-10 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <Link href="/" className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: "var(--accent-encrypted)" }}
          />
          <span className="font-medium text-sm tracking-wide">SHADOWPOOL</span>
        </Link>
        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--accent-revealed)" }}
            />
            Devnet
          </div>
          <button
            className="text-sm px-4 py-1.5 rounded transition-colors"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-medium)",
              color: "var(--text-primary)",
            }}
          >
            Connect Wallet
          </button>
        </div>
      </header>

      <div
        className={`transition-all duration-500 ${
          mounted ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Vault Header */}
        <div className="px-6 md:px-10 pt-8 pb-6">
          <div className="flex items-baseline gap-3 mb-1">
            <h1
              className="text-2xl font-light tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {v.pair}
            </h1>
            <span
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{
                background: "var(--accent-encrypted-dim)",
                color: "var(--accent-encrypted)",
              }}
            >
              ENCRYPTED
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Confidential market-making vault · Arcium MPC
          </p>
        </div>

        {/* Key Metrics Row */}
        <div
          className="px-6 md:px-10 pb-8 flex flex-wrap gap-x-10 gap-y-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          {[
            {
              label: "TVL",
              value: `$${v.tvl.toLocaleString()}`,
              color: "var(--text-primary)",
            },
            {
              label: "APY",
              value: `${v.apy}%`,
              color: "var(--accent-revealed)",
            },
            {
              label: "Share Price",
              value: `$${v.sharePrice.toFixed(3)}`,
              color: "var(--text-primary)",
            },
            {
              label: "Last Rebalance",
              value: `${v.lastRebalance}s ago`,
              color: "var(--text-secondary)",
            },
          ].map((m) => (
            <div key={m.label}>
              <div
                className="text-[10px] tracking-[0.2em] uppercase mb-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                {m.label}
              </div>
              <div
                className="text-xl font-light font-mono tracking-tight"
                style={{ color: m.color }}
              >
                {m.value}
              </div>
            </div>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-[1fr,380px] gap-0">
          {/* Left: Encrypted vs Revealed */}
          <div
            className="px-6 md:px-10 py-8"
            style={{ borderRight: "1px solid var(--border-subtle)" }}
          >
            {/* The Privacy Visualization — THE demo moment */}
            <div className="grid md:grid-cols-2 gap-0 rounded overflow-hidden">
              {/* Encrypted State Panel */}
              <div
                className="p-6"
                style={{
                  background: "var(--bg-surface)",
                  borderRight: "1px solid var(--border-subtle)",
                }}
              >
                <div className="flex items-center gap-2 mb-5">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--accent-encrypted)" }}
                  />
                  <span
                    className="text-[10px] tracking-[0.25em] uppercase"
                    style={{ color: "var(--accent-encrypted)" }}
                  >
                    Encrypted on-chain state
                  </span>
                </div>

                <div className="space-y-1">
                  {[
                    "base_balance",
                    "quote_balance",
                    "spread_bps",
                    "rebalance_threshold",
                    "last_mid_price",
                  ].map((field, i) => (
                    <EncryptedField
                      key={field}
                      label={field}
                      baseHex={v.encryptedState[i]}
                      index={i}
                    />
                  ))}
                </div>

                <p
                  className="mt-4 text-[11px] leading-relaxed"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  These values are ciphertexts stored on Solana. No validator,
                  explorer, or MEV bot can read them.
                </p>
              </div>

              {/* Revealed Quotes Panel */}
              <div className="p-6" style={{ background: "var(--bg-raised)" }}>
                <div className="flex items-center gap-2 mb-5">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--accent-revealed)" }}
                  />
                  <span
                    className="text-[10px] tracking-[0.25em] uppercase"
                    style={{ color: "var(--accent-revealed)" }}
                  >
                    MPC revealed quotes
                  </span>
                </div>

                <div className="space-y-6">
                  {/* Oracle Price */}
                  <div>
                    <div
                      className="text-[10px] font-mono uppercase tracking-wider mb-1"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Oracle (Pyth)
                    </div>
                    <div
                      className="font-mono text-2xl font-light"
                      style={{ color: "var(--text-primary)" }}
                    >
                      ${v.quotes.oraclePrice.toFixed(2)}
                    </div>
                  </div>

                  {/* Bid / Ask */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div
                        className="text-[10px] font-mono uppercase tracking-wider mb-1"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        Bid
                      </div>
                      <div
                        className="font-mono text-lg font-light quote-reveal"
                        style={{ color: "var(--accent-revealed)" }}
                      >
                        ${v.quotes.bidPrice.toFixed(3)}
                      </div>
                      <div
                        className="font-mono text-xs mt-1"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {v.quotes.bidSize.toFixed(1)} SOL
                      </div>
                    </div>
                    <div>
                      <div
                        className="text-[10px] font-mono uppercase tracking-wider mb-1"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        Ask
                      </div>
                      <div
                        className="font-mono text-lg font-light quote-reveal"
                        style={{
                          color: "var(--accent-revealed)",
                          animationDelay: "0.15s",
                        }}
                      >
                        ${v.quotes.askPrice.toFixed(3)}
                      </div>
                      <div
                        className="font-mono text-xs mt-1"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {v.quotes.askSize.toLocaleString()} SOL
                      </div>
                    </div>
                  </div>

                  {/* Spread */}
                  <div>
                    <div
                      className="text-[10px] font-mono uppercase tracking-wider mb-1"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Effective spread
                    </div>
                    <div
                      className="font-mono text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {(
                        ((v.quotes.askPrice - v.quotes.bidPrice) /
                          v.quotes.oraclePrice) *
                        100
                      ).toFixed(2)}
                      %
                    </div>
                  </div>

                  {/* Status */}
                  <div
                    className="flex items-center gap-2 pt-3"
                    style={{ borderTop: "1px solid var(--border-subtle)" }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: v.quotes.shouldRebalance
                          ? "var(--accent-warning)"
                          : "var(--accent-revealed)",
                      }}
                    />
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {v.quotes.shouldRebalance
                        ? "Rebalance pending"
                        : "Position optimal"}
                    </span>
                  </div>
                </div>

                <p
                  className="mt-4 text-[11px] leading-relaxed"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  These quotes were computed from the encrypted state. The
                  strategy behind them remains hidden.
                </p>
              </div>
            </div>

            {/* Rebalance History */}
            <div className="mt-8">
              <div
                className="text-[10px] tracking-[0.25em] uppercase mb-4"
                style={{ color: "var(--text-tertiary)" }}
              >
                Recent computations
              </div>
              <div
                className="rounded overflow-hidden"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      {["Time", "Bid", "Ask", "Spread", "Action"].map((h) => (
                        <th
                          key={h}
                          className="text-left font-normal px-4 py-2.5"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {v.rebalanceHistory.map((r, i) => (
                      <tr
                        key={i}
                        style={{
                          borderBottom:
                            i < v.rebalanceHistory.length - 1
                              ? "1px solid var(--border-subtle)"
                              : "none",
                        }}
                      >
                        <td
                          className="px-4 py-2.5 font-mono"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {r.time}
                        </td>
                        <td
                          className="px-4 py-2.5 font-mono"
                          style={{ color: "var(--accent-revealed)" }}
                        >
                          ${r.bid.toFixed(3)}
                        </td>
                        <td
                          className="px-4 py-2.5 font-mono"
                          style={{ color: "var(--accent-revealed)" }}
                        >
                          ${r.ask.toFixed(3)}
                        </td>
                        <td
                          className="px-4 py-2.5 font-mono"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {(
                            ((r.ask - r.bid) /
                              ((r.ask + r.bid) / 2)) *
                            100
                          ).toFixed(3)}
                          %
                        </td>
                        <td className="px-4 py-2.5">
                          {r.rebalanced ? (
                            <span
                              className="text-[10px] font-mono px-2 py-0.5 rounded"
                              style={{
                                background: "var(--accent-revealed-dim)",
                                color: "var(--accent-revealed)",
                              }}
                            >
                              REBALANCED
                            </span>
                          ) : (
                            <span
                              className="text-[10px] font-mono"
                              style={{ color: "var(--text-tertiary)" }}
                            >
                              held
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Sidebar: Deposit / Withdraw + Strategy */}
          <div className="px-6 md:px-8 py-8">
            {/* Deposit / Withdraw */}
            <div
              className="rounded overflow-hidden"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {/* Tab switcher */}
              <div
                className="flex"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                {(["deposit", "withdraw"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="flex-1 py-3 text-xs tracking-[0.15em] uppercase transition-colors"
                    style={{
                      color:
                        activeTab === tab
                          ? "var(--text-primary)"
                          : "var(--text-tertiary)",
                      borderBottom:
                        activeTab === tab
                          ? "1px solid var(--accent-encrypted)"
                          : "1px solid transparent",
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="p-5">
                <div className="mb-4">
                  <label
                    className="block text-[10px] tracking-[0.2em] uppercase mb-2"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {activeTab === "deposit" ? "Amount (USDC)" : "Shares"}
                  </label>
                  <div
                    className="flex items-center rounded px-3 py-2.5"
                    style={{
                      background: "var(--bg-deep)",
                      border: "1px solid var(--border-medium)",
                    }}
                  >
                    <input
                      type="text"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 bg-transparent outline-none font-mono text-sm"
                      style={{ color: "var(--text-primary)" }}
                    />
                    <button
                      className="text-[10px] tracking-wider uppercase px-2 py-1 rounded transition-colors"
                      style={{
                        color: "var(--accent-encrypted)",
                        background: "var(--bg-raised)",
                      }}
                      onClick={() => setDepositAmount("1000")}
                    >
                      Max
                    </button>
                  </div>
                </div>

                {depositAmount && (
                  <div
                    className="mb-4 py-3 space-y-2"
                    style={{ borderTop: "1px solid var(--border-subtle)" }}
                  >
                    <div className="flex justify-between text-xs">
                      <span style={{ color: "var(--text-tertiary)" }}>
                        You receive
                      </span>
                      <span
                        className="font-mono"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {(
                          parseFloat(depositAmount || "0") / v.sharePrice
                        ).toFixed(2)}{" "}
                        spTokens
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span style={{ color: "var(--text-tertiary)" }}>
                        Share price
                      </span>
                      <span
                        className="font-mono"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        ${v.sharePrice.toFixed(4)}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  className="w-full py-3 text-sm font-medium tracking-wide rounded transition-all duration-200"
                  style={{
                    background: depositAmount
                      ? "var(--accent-encrypted)"
                      : "var(--bg-raised)",
                    color: depositAmount
                      ? "var(--bg-deep)"
                      : "var(--text-tertiary)",
                    cursor: depositAmount ? "pointer" : "default",
                  }}
                >
                  {activeTab === "deposit" ? "Deposit" : "Withdraw"}
                </button>
              </div>
            </div>

            {/* Strategy Status */}
            <div className="mt-6">
              <div
                className="text-[10px] tracking-[0.25em] uppercase mb-3"
                style={{ color: "var(--text-tertiary)" }}
              >
                Vault strategy
              </div>
              <div
                className="rounded p-5 space-y-3"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {[
                  { label: "Spread", value: "██████ bps" },
                  { label: "Rebalance Threshold", value: "██████ bps" },
                  { label: "Base Balance", value: "████████████" },
                  { label: "Quote Balance", value: "████████████" },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between">
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {item.label}
                    </span>
                    <span
                      className="text-xs font-mono"
                      style={{ color: "var(--accent-encrypted-dim)" }}
                    >
                      {item.value}
                    </span>
                  </div>
                ))}

                <div
                  className="pt-3 mt-2"
                  style={{ borderTop: "1px solid var(--border-subtle)" }}
                >
                  <p
                    className="text-[11px] leading-relaxed"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Strategy parameters are encrypted via Arcium MPC. Only the
                    vault owner can update them.
                  </p>
                </div>
              </div>
            </div>

            {/* Powered by */}
            <div className="mt-8 flex items-center gap-3">
              <div
                className="text-[10px] tracking-[0.15em] uppercase"
                style={{ color: "var(--text-tertiary)" }}
              >
                Powered by
              </div>
              <div
                className="flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                Arcium MPC
              </div>
              <div
                className="flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                Solana
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
