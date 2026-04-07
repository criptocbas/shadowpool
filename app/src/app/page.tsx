"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

function useRandomHex(length: number, interval: number) {
  const generate = useCallback(() => {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * 16)];
    }
    return result;
  }, [length]);

  const [hex, setHex] = useState(generate);

  useEffect(() => {
    const id = setInterval(() => setHex(generate()), interval);
    return () => clearInterval(id);
  }, [generate, interval]);

  return hex;
}

function CipherBlock({ delay = 0 }: { delay?: number }) {
  const hex = useRandomHex(64, 120);
  return (
    <div
      className="cipher-shimmer font-mono text-[11px] leading-tight tracking-wider break-all"
      style={{
        color: "var(--accent-encrypted-dim)",
        animationDelay: `${delay}s`,
      }}
    >
      {hex}
    </div>
  );
}

function StatBlock({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="stagger-enter">
      <div
        className="text-[clamp(1.5rem,4vw,2.5rem)] font-light tracking-tight leading-none"
        style={{ color: accent || "var(--text-primary)" }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-sm tracking-wide uppercase"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg-deep)" }}
    >
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-6 py-4 md:px-12"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: "var(--accent-encrypted)" }}
          />
          <span className="font-medium text-sm tracking-wide">
            SHADOWPOOL
          </span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com"
            className="text-sm transition-colors duration-200"
            style={{ color: "var(--text-tertiary)" }}
          >
            Docs
          </a>
          <Link
            href="/vault"
            className="text-sm px-4 py-2 rounded transition-colors duration-200"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-medium)",
              color: "var(--text-primary)",
            }}
          >
            Launch App
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 grid lg:grid-cols-[1fr,480px] gap-0">
          {/* Left: messaging */}
          <div className="flex flex-col justify-center px-6 md:px-12 lg:px-16 py-16 lg:py-0">
            <div
              className={`max-w-xl transition-all duration-700 ${
                mounted
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
            >
              <p
                className="text-xs tracking-[0.2em] uppercase mb-6"
                style={{ color: "var(--accent-encrypted)" }}
              >
                Confidential liquidity on Solana
              </p>

              <h1
                className="text-[clamp(2rem,5vw,3.5rem)] font-light leading-[1.1] tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                Your strategy stays
                <br />
                <span style={{ color: "var(--accent-encrypted)" }}>
                  encrypted.
                </span>
                <br />
                Your yield stays
                <br />
                <span style={{ color: "var(--accent-revealed)" }}>yours.</span>
              </h1>

              <p
                className="mt-8 text-[clamp(0.9rem,1.5vw,1.05rem)] leading-relaxed max-w-md"
                style={{ color: "var(--text-secondary)" }}
              >
                ShadowPool vaults compute market-making quotes from encrypted
                strategy parameters via Arcium MPC. MEV bots see the trade —
                never the logic behind it.
              </p>

              <div className="flex items-center gap-4 mt-10">
                <Link
                  href="/vault"
                  className="px-6 py-3 text-sm font-medium tracking-wide rounded transition-all duration-200"
                  style={{
                    background: "var(--accent-encrypted)",
                    color: "var(--bg-deep)",
                  }}
                >
                  Open Vault →
                </Link>
                <a
                  href="#how-it-works"
                  className="px-6 py-3 text-sm tracking-wide rounded transition-colors duration-200"
                  style={{
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  How it works
                </a>
              </div>
            </div>

            {/* Stats */}
            <div
              className={`flex flex-wrap gap-x-12 gap-y-6 mt-16 pt-10 transition-all duration-700 delay-300 ${
                mounted
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
              style={{ borderTop: "1px solid var(--border-subtle)" }}
            >
              <StatBlock
                value="$720M"
                label="MEV extracted on Solana"
                accent="var(--accent-danger)"
              />
              <StatBlock
                value="49.5%"
                label="of LPs lose money"
                accent="var(--accent-warning)"
              />
              <StatBlock
                value="$3.8B"
                label="LP capital unprotected"
                accent="var(--text-secondary)"
              />
            </div>
          </div>

          {/* Right: live cipher visualization */}
          <div
            className="hidden lg:flex flex-col justify-center px-8 py-16 overflow-hidden"
            style={{
              background: "var(--bg-surface)",
              borderLeft: "1px solid var(--border-subtle)",
            }}
          >
            <div
              className={`transition-all duration-1000 delay-500 ${
                mounted
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-8"
              }`}
            >
              <p
                className="text-[10px] tracking-[0.25em] uppercase mb-6"
                style={{ color: "var(--text-tertiary)" }}
              >
                On-chain vault state
              </p>

              {/* Encrypted fields */}
              <div className="space-y-3">
                {[
                  "base_balance",
                  "quote_balance",
                  "spread_bps",
                  "rebalance_threshold",
                  "last_mid_price",
                ].map((field, i) => (
                  <div key={field}>
                    <div
                      className="text-[10px] font-mono mb-1"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {field}
                    </div>
                    <CipherBlock delay={i * 0.3} />
                  </div>
                ))}
              </div>

              {/* Arrow + revealed */}
              <div
                className="mt-8 pt-8"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              >
                <p
                  className="text-[10px] tracking-[0.25em] uppercase mb-4"
                  style={{ color: "var(--accent-revealed-dim)" }}
                >
                  ↓ MPC computation reveals
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between items-baseline">
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Bid
                    </span>
                    <span
                      className="font-mono text-lg font-light quote-reveal"
                      style={{ color: "var(--accent-revealed)" }}
                    >
                      $149.625
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Ask
                    </span>
                    <span
                      className="font-mono text-lg font-light quote-reveal"
                      style={{
                        color: "var(--accent-revealed)",
                        animationDelay: "0.1s",
                      }}
                    >
                      $150.375
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* How it works */}
        <section
          id="how-it-works"
          className="px-6 md:px-12 lg:px-16 py-20"
          style={{
            background: "var(--bg-surface)",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <p
            className="text-[10px] tracking-[0.25em] uppercase mb-10"
            style={{ color: "var(--text-tertiary)" }}
          >
            How it works
          </p>
          <div className="grid md:grid-cols-3 gap-12 max-w-4xl">
            {[
              {
                step: "01",
                title: "Deposit",
                description:
                  "Provide SOL or USDC to the vault. Receive spTokens representing your share of the pool.",
              },
              {
                step: "02",
                title: "Encrypted Computation",
                description:
                  "Arcium\u2019s MPC cluster computes optimal bid/ask quotes from your encrypted strategy. No single node sees the plaintext.",
              },
              {
                step: "03",
                title: "Protected Yield",
                description:
                  "Quotes execute on-chain, but the strategy stays hidden. MEV bots can\u2019t predict the next trade \u2014 your yield is protected.",
              },
            ].map((item) => (
              <div key={item.step} className="stagger-enter">
                <div
                  className="text-xs font-mono mb-3"
                  style={{ color: "var(--accent-encrypted-dim)" }}
                >
                  {item.step}
                </div>
                <h3
                  className="text-lg font-normal mb-2"
                  style={{ color: "var(--text-primary)" }}
                >
                  {item.title}
                </h3>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        className="px-6 md:px-12 py-6 flex items-center justify-between text-xs"
        style={{
          color: "var(--text-tertiary)",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <span>ShadowPool · Built on Solana × Arcium</span>
        <span>Frontier Hackathon 2026</span>
      </footer>
    </div>
  );
}
