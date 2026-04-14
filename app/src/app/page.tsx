"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ─── Hooks ───────────────────────────────────────────────────────────────

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

// ─── Cipher Terminal Components ──────────────────────────────────────────

function CipherField({ name, delay }: { name: string; delay: number }) {
  const hex = useRandomHex(32, 100 + delay * 40);
  return (
    <div className="space-y-0.5">
      <div
        className="text-[9px] font-mono uppercase tracking-[0.2em]"
        style={{ color: "var(--text-tertiary)" }}
      >
        {name}
      </div>
      <div
        className="cipher-shimmer font-mono text-[11px] tracking-wider leading-tight break-all"
        style={{
          color: "var(--accent-encrypted)",
          animationDelay: `${delay * 0.3}s`,
        }}
      >
        0x{hex}
      </div>
    </div>
  );
}

function MPCNodes() {
  return (
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
  );
}

function CipherTerminal({ mounted }: { mounted: boolean }) {
  return (
    <div
      className={`cipher-terminal transition-all duration-1000 delay-300 ${
        mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
    >
      {/* Terminal header */}
      <div className="cipher-terminal-header flex items-center gap-2.5 px-4 py-2.5">
        <div
          className="live-dot w-[6px] h-[6px] rounded-full"
          style={{ background: "var(--accent-encrypted)" }}
        />
        <span
          className="text-[9px] font-mono uppercase tracking-[0.25em]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Live vault state
        </span>
      </div>

      {/* Encrypted fields */}
      <div className="px-4 py-4 space-y-3">
        {[
          "base_balance",
          "quote_balance",
          "spread_bps",
          "rebalance_threshold",
          "last_mid_price",
        ].map((field, i) => (
          <CipherField key={field} name={field} delay={i} />
        ))}
      </div>

      {/* MPC Computation divider */}
      <div className="cipher-terminal-mpc px-4 py-3 flex items-center gap-3">
        <MPCNodes />
        <span
          className="text-[9px] font-mono uppercase tracking-[0.2em]"
          style={{ color: "var(--accent-encrypted-dim)" }}
        >
          Arcium MPC
        </span>
        <div
          className="flex-1 h-px"
          style={{ background: "var(--border-subtle)" }}
        />
        <span
          className="text-[9px] font-mono uppercase tracking-[0.15em]"
          style={{ color: "var(--text-tertiary)" }}
        >
          computing
        </span>
      </div>

      {/* Revealed output */}
      <div className="cipher-terminal-revealed px-4 py-4 space-y-2.5">
        <div className="flex justify-between items-baseline">
          <span
            className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            Bid
          </span>
          <span
            className="revealed-price font-mono text-base font-light quote-reveal"
            style={{ color: "var(--accent-revealed)" }}
          >
            $149.625
          </span>
        </div>
        <div className="flex justify-between items-baseline">
          <span
            className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            Ask
          </span>
          <span
            className="revealed-price font-mono text-base font-light quote-reveal"
            style={{
              color: "var(--accent-revealed)",
              animationDelay: "0.1s",
            }}
          >
            $150.375
          </span>
        </div>
        <div
          className="flex justify-between items-baseline pt-1"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <span
            className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            Spread
          </span>
          <span
            className="font-mono text-xs"
            style={{ color: "var(--accent-revealed-dim)" }}
          >
            0.50%
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────

function StatCard({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent: "danger" | "warning" | "primary";
}) {
  const colorMap = {
    danger: "var(--accent-danger)",
    warning: "var(--accent-warning)",
    primary: "var(--accent-encrypted)",
  };

  return (
    <div className="stat-card stagger-enter" data-accent={accent}>
      <div
        className="text-[clamp(1.5rem,3.5vw,2.25rem)] font-light font-mono tracking-tight leading-none"
        style={{ color: colorMap[accent] }}
      >
        {value}
      </div>
      <div
        className="mt-2 text-xs tracking-wide uppercase leading-relaxed"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── How It Works Step ───────────────────────────────────────────────────

function StepIcon({ type }: { type: "deposit" | "compute" | "shield" }) {
  const color = type === "shield" ? "var(--accent-revealed)" : "var(--accent-encrypted)";

  if (type === "deposit") {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
        <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
    );
  }

  if (type === "compute") {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="12" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M8.5 11l7-4M8.5 13l7 4" />
      </svg>
    );
  }

  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 4v5c0 5.25-3.5 9.74-8 11-4.5-1.26-8-5.75-8-11V7l8-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function FlowConnector() {
  return (
    <div className="hidden md:flex items-center justify-center py-0">
      <svg width="48" height="24" viewBox="0 0 48 24" fill="none">
        <path
          d="M0 12h38"
          stroke="var(--accent-encrypted-dim)"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        <path
          d="M34 8l6 4-6 4"
          stroke="var(--accent-encrypted-dim)"
          strokeWidth="1"
          fill="none"
        />
      </svg>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg-deep)" }}
    >
      {/* Ambient background glow */}
      <div className="hero-glow" />

      {/* ═══ Navigation ═══ */}
      <nav
        className="relative z-10 flex items-center justify-between px-6 py-4 md:px-12"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: "var(--accent-encrypted)" }}
          />
          <span className="font-medium text-sm tracking-wide">SHADOWPOOL</span>
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

      {/* ═══ Hero Section ═══ */}
      <main className="relative z-10 flex-1 flex flex-col">
        <section className="flex-1 grid lg:grid-cols-[1fr,520px] gap-0 min-h-[calc(100vh-57px)]">
          {/* Left: Messaging */}
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
                  className="px-6 py-3 text-sm font-medium tracking-wide rounded transition-all duration-200 hover:brightness-110"
                  style={{
                    background: "var(--accent-encrypted)",
                    color: "var(--bg-deep)",
                  }}
                >
                  Open Vault &rarr;
                </Link>
                <a
                  href="#how-it-works"
                  className="px-6 py-3 text-sm tracking-wide rounded transition-colors duration-200 hover:border-[var(--border-medium)]"
                  style={{
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  How it works
                </a>
              </div>
            </div>

            {/* Mobile cipher terminal */}
            <div className="lg:hidden mt-12">
              <CipherTerminal mounted={mounted} />
            </div>
          </div>

          {/* Right: Desktop cipher terminal */}
          <div className="hidden lg:flex flex-col justify-center px-10 py-16">
            <CipherTerminal mounted={mounted} />
          </div>
        </section>

        {/* ═══ Stats Section ═══ */}
        <section
          className={`px-6 md:px-12 lg:px-16 py-16 transition-all duration-700 delay-500 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <div className="grid sm:grid-cols-3 gap-4 max-w-4xl">
            <StatCard
              value="$720M"
              label="MEV extracted annually on Solana"
              accent="danger"
            />
            <StatCard
              value="49.5%"
              label="of liquidity providers lose money"
              accent="warning"
            />
            <StatCard
              value="$3.8B"
              label="in LP capital — unprotected"
              accent="primary"
            />
          </div>
        </section>

        {/* ═══ How It Works ═══ */}
        <section
          id="how-it-works"
          className="px-6 md:px-12 lg:px-16 py-20"
          style={{
            background: "var(--bg-surface)",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <p
            className="text-[10px] tracking-[0.25em] uppercase mb-12"
            style={{ color: "var(--text-tertiary)" }}
          >
            How it works
          </p>

          <div className="grid md:grid-cols-[1fr,auto,1fr,auto,1fr] gap-y-6 items-stretch max-w-5xl">
            {/* Step 1 */}
            <div className="step-card flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <span
                  className="text-xs font-mono"
                  style={{ color: "var(--accent-encrypted-dim)" }}
                >
                  01
                </span>
                <StepIcon type="deposit" />
              </div>
              <h3
                className="text-lg font-normal mb-2"
                style={{ color: "var(--text-primary)" }}
              >
                Deposit
              </h3>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                Provide SOL or USDC to the vault. Receive spTokens representing
                your share of the pool.
              </p>
            </div>

            <FlowConnector />

            {/* Step 2 */}
            <div className="step-card flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <span
                  className="text-xs font-mono"
                  style={{ color: "var(--accent-encrypted-dim)" }}
                >
                  02
                </span>
                <StepIcon type="compute" />
              </div>
              <h3
                className="text-lg font-normal mb-2"
                style={{ color: "var(--text-primary)" }}
              >
                Encrypted Computation
              </h3>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                Arcium&rsquo;s MPC cluster computes optimal bid/ask quotes from
                your encrypted strategy. No single node sees the plaintext.
              </p>
            </div>

            <FlowConnector />

            {/* Step 3 */}
            <div className="step-card flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <span
                  className="text-xs font-mono"
                  style={{ color: "var(--accent-revealed-dim)" }}
                >
                  03
                </span>
                <StepIcon type="shield" />
              </div>
              <h3
                className="text-lg font-normal mb-2"
                style={{ color: "var(--text-primary)" }}
              >
                Protected Yield
              </h3>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                Quotes execute on-chain, but the strategy stays hidden. MEV bots
                can&rsquo;t predict the next trade — your yield is protected.
              </p>
            </div>
          </div>
        </section>

        {/* ═══ CTA Section ═══ */}
        <section className="px-6 md:px-12 lg:px-16 py-24 text-center">
          <div className="cta-line max-w-md mx-auto mb-12" />

          <h2
            className="text-[clamp(1.25rem,3vw,1.75rem)] font-light tracking-tight mb-8"
            style={{ color: "var(--text-primary)" }}
          >
            Stop leaking yield to{" "}
            <span style={{ color: "var(--accent-danger)" }}>MEV bots</span>.
          </h2>

          <Link
            href="/vault"
            className="inline-block px-8 py-3.5 text-sm font-medium tracking-wide rounded transition-all duration-200 hover:brightness-110"
            style={{
              background: "var(--accent-encrypted)",
              color: "var(--bg-deep)",
            }}
          >
            Open Vault &rarr;
          </Link>

          {/* Trust badges */}
          <div className="mt-12 flex items-center justify-center gap-6">
            <span
              className="text-[10px] tracking-[0.15em] uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              Powered by
            </span>
            {["Arcium MPC", "Solana", "Token-2022"].map((badge) => (
              <span
                key={badge}
                className="text-xs font-mono px-3 py-1.5 rounded"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                {badge}
              </span>
            ))}
          </div>
        </section>
      </main>

      {/* ═══ Footer ═══ */}
      <footer
        className="relative z-10 px-6 md:px-12 py-6 flex items-center justify-between text-xs"
        style={{
          color: "var(--text-tertiary)",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <span>ShadowPool &middot; Built on Solana &times; Arcium</span>
        <span>Frontier Hackathon 2026</span>
      </footer>
    </div>
  );
}
