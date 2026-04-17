"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ticker } from "@/components/landing/Ticker";
import { LiveTerminal } from "@/components/landing/LiveTerminal";
import { MarketData } from "@/components/landing/MarketData";
import { ProtocolFlow } from "@/components/landing/ProtocolFlow";
import { PersonaRows } from "@/components/landing/PersonaRows";
import { VerifiedFooter } from "@/components/landing/VerifiedFooter";

// ─── Main Landing ───────────────────────────────────────────────────────
export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg-deep)" }}
    >
      {/* ambient glow — dim, positioned where the terminal sits */}
      <div className="hero-glow" />

      {/* ═══ Nav ═══ */}
      <nav
        className="relative z-20 flex items-center justify-between px-6 py-4 md:px-10"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--accent-encrypted)" }}
          />
          <span
            className="font-mono text-xs tracking-[0.25em]"
            style={{ color: "var(--text-primary)" }}
          >
            SHADOWPOOL
          </span>
          <span
            className="hidden md:inline text-[9px] font-mono tracking-[0.2em] uppercase ml-3 px-1.5 py-0.5 rounded"
            style={{
              color: "var(--text-tertiary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            v0.1.0-alpha · devnet
          </span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="#protocol"
            className="text-[13px] hidden sm:inline transition-colors duration-200"
            style={{ color: "var(--text-tertiary)" }}
          >
            Protocol
          </a>
          <a
            href="https://github.com/criptocbas/shadowpool"
            className="text-[13px] hidden sm:inline transition-colors duration-200"
            style={{ color: "var(--text-tertiary)" }}
          >
            GitHub
          </a>
          <Link
            href="/vault"
            className="text-[13px] px-4 py-2 rounded transition-colors duration-200 hover:bg-[var(--bg-hover)]"
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

      {/* ═══ Ticker ═══ */}
      <Ticker />

      {/* ═══ Hero ═══ */}
      <main className="relative z-10 flex-1 flex flex-col">
        <section
          className="relative grid lg:grid-cols-[1.1fr,540px] gap-0"
          style={{
            borderBottom: "1px solid var(--border-subtle)",
            minHeight: "calc(100vh - 112px)",
          }}
        >
          <div className="scanlines" />

          {/* Left — editorial headline + sub + CTAs + mini-badges */}
          <div className="relative flex flex-col justify-center px-6 md:px-10 lg:px-16 py-16 lg:py-14">
            <div
              className={`max-w-xl transition-all duration-700 ${
                mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              {/* kicker */}
              <div className="flex items-center gap-3 mb-8">
                <div
                  className="w-6 h-px"
                  style={{ background: "var(--accent-encrypted)" }}
                />
                <p
                  className="text-[10px] tracking-[0.3em] uppercase"
                  style={{ color: "var(--accent-encrypted)" }}
                >
                  Confidential execution layer · Solana
                </p>
              </div>

              {/* headline — sans/serif interplay */}
              <h1
                className="text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[1.02] tracking-tight"
                style={{ color: "var(--text-primary)", fontWeight: 300 }}
              >
                Your strategy
                <br />
                stays{" "}
                <span
                  className="font-editorial-italic"
                  style={{ color: "var(--accent-encrypted)" }}
                >
                  encrypted.
                </span>
                <br />
                <span style={{ color: "var(--text-secondary)" }}>
                  Your execution
                </span>
                <br />
                <span style={{ color: "var(--text-secondary)" }}>stays</span>{" "}
                <span
                  className="font-editorial-italic"
                  style={{ color: "var(--accent-revealed)" }}
                >
                  yours.
                </span>
              </h1>

              {/* sub */}
              <p
                className="mt-10 text-[clamp(0.95rem,1.3vw,1.05rem)] leading-[1.6] max-w-md"
                style={{ color: "var(--text-secondary)" }}
              >
                The dark-pool execution layer for Solana. Strategy lives
                inside Arcium&rsquo;s MPC network. Only computed quotes reach
                the chain. Auditors get selective disclosure on demand.
                Institutions trade without broadcasting their hand.
              </p>

              {/* CTAs */}
              <div className="flex flex-wrap items-center gap-3 mt-10">
                <Link
                  href="/vault"
                  className="group inline-flex items-center gap-2 px-5 py-3 text-[13px] font-medium tracking-wide rounded transition-all duration-200 hover:brightness-110"
                  style={{
                    background: "var(--accent-encrypted)",
                    color: "var(--bg-deep)",
                  }}
                >
                  Open Vault
                  <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </Link>
                <a
                  href="#protocol"
                  className="inline-flex items-center gap-2 px-5 py-3 text-[13px] tracking-wide rounded transition-colors duration-200 hover:border-[var(--border-medium)]"
                  style={{
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  See the protocol
                </a>
              </div>

              {/* credibility strip */}
              <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10.5px] font-mono tracking-[0.1em] uppercase">
                <span style={{ color: "var(--text-tertiary)" }}>
                  Powered by
                </span>
                {["Arcium MPC", "Pyth Pull", "Meteora DLMM", "Token-2022"].map(
                  (badge, i) => (
                    <span
                      key={badge}
                      className="flex items-center gap-2"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {i > 0 && (
                        <span
                          className="w-1 h-1 rounded-full"
                          style={{ background: "var(--border-medium)" }}
                          aria-hidden
                        />
                      )}
                      {badge}
                    </span>
                  ),
                )}
              </div>
            </div>

            {/* mobile terminal */}
            <div className="lg:hidden mt-12">
              <LiveTerminal mounted={mounted} />
            </div>
          </div>

          {/* Right — desktop terminal */}
          <div
            className="hidden lg:flex flex-col justify-center px-6 lg:px-10 py-14"
            style={{ borderLeft: "1px solid var(--border-subtle)" }}
          >
            <LiveTerminal mounted={mounted} />
          </div>
        </section>

        {/* ═══ Market Data ═══ */}
        <section
          className="px-6 md:px-10 lg:px-16 py-20"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-baseline justify-between mb-10 flex-wrap gap-3">
            <div>
              <div
                className="text-[10px] font-mono tracking-[0.25em] uppercase mb-2"
                style={{ color: "var(--text-tertiary)" }}
              >
                · 00 · Market reference
              </div>
              <h2
                className="font-editorial text-[clamp(1.75rem,3.5vw,2.5rem)] leading-tight"
                style={{ color: "var(--text-editorial)" }}
              >
                The information MEV bots need
                <br />
                we never emit.
              </h2>
            </div>
            <div
              className="text-[10px] font-mono tracking-[0.15em] uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              figures as of Q4 2025
            </div>
          </div>

          <MarketData />
        </section>

        {/* ═══ Protocol Flow ═══ */}
        <section
          id="protocol"
          className="px-6 md:px-10 lg:px-16 py-20"
          style={{
            background: "var(--bg-surface)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div className="mb-8">
            <div
              className="text-[10px] font-mono tracking-[0.25em] uppercase mb-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              · 01 · Protocol
            </div>
            <h2
              className="font-editorial text-[clamp(1.75rem,3.5vw,2.5rem)] leading-tight max-w-4xl"
              style={{ color: "var(--text-editorial)" }}
            >
              Encrypted strategy in, revealed quote out —
              <span
                className="font-editorial-italic"
                style={{ color: "var(--accent-encrypted)" }}
              >
                {" "}never in between
              </span>
              .
            </h2>
            <p
              className="mt-3 text-[14px] leading-relaxed max-w-2xl"
              style={{ color: "var(--text-secondary)" }}
            >
              Six stages. Each a real on-chain step; the technical artifact
              beneath each name is what a judge (or auditor) can verify.
            </p>
          </div>

          <ProtocolFlow />
        </section>

        {/* ═══ Who this is for ═══ */}
        <section
          className="px-6 md:px-10 lg:px-16 py-20"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="mb-10">
            <div
              className="text-[10px] font-mono tracking-[0.25em] uppercase mb-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              · 02 · Who this is for
            </div>
            <h2
              className="font-editorial text-[clamp(1.75rem,3.5vw,2.5rem)] leading-tight max-w-4xl"
              style={{ color: "var(--text-editorial)" }}
            >
              Three surfaces, one primitive.
            </h2>
          </div>

          <PersonaRows />
        </section>

        {/* ═══ Closer ═══ */}
        <section className="px-6 md:px-10 lg:px-16 py-24 md:py-32 text-center relative">
          <div
            className="max-w-3xl mx-auto px-4"
            style={{
              borderLeft: "1px solid var(--border-subtle)",
              paddingLeft: "2rem",
              textAlign: "left",
            }}
          >
            <div
              className="text-[10px] font-mono tracking-[0.25em] uppercase mb-5"
              style={{ color: "var(--text-tertiary)" }}
            >
              · 03 · Close
            </div>

            <blockquote className="editorial-quote text-[clamp(2rem,5vw,3.75rem)]">
              Stop broadcasting your <em>strategy</em>
              <br />
              to every bot in the mempool.
            </blockquote>

            <p
              className="mt-8 text-[15px] leading-relaxed max-w-xl"
              style={{ color: "var(--text-secondary)" }}
            >
              Traditional finance solved this decades ago with dark pools,
              iceberg orders, sealed RFQs. On Solana, the primitive didn&rsquo;t
              exist. Now it does.
            </p>

            <div className="flex items-center gap-3 mt-10">
              <Link
                href="/vault"
                className="inline-flex items-center gap-2 px-5 py-3 text-[13px] font-medium tracking-wide rounded transition-all duration-200 hover:brightness-110"
                style={{
                  background: "var(--accent-encrypted)",
                  color: "var(--bg-deep)",
                }}
              >
                Open Vault
                <span>→</span>
              </Link>
              <span
                className="text-[10.5px] font-mono tracking-[0.15em] uppercase hidden sm:inline"
                style={{ color: "var(--text-tertiary)" }}
              >
                <span className="cursor-blink">▊</span> live · devnet
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* ═══ Footer ═══ */}
      <VerifiedFooter />
    </div>
  );
}
