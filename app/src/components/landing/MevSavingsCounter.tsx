"use client";

import { useEffect, useState } from "react";

/**
 * Live-ticking counter: the cumulative MEV-extraction exposure that a
 * confidential-execution layer like ShadowPool could have avoided
 * since Arcium mainnet-alpha launched in February 2026.
 *
 * **The math** — explicitly sourced in
 * `submission/metrics/mev-savings-model.md`:
 *
 *   savings_usd = addressable_tvl * annual_drag_differential * elapsed_seconds / year
 *
 * Where:
 *   - addressable_tvl = $3.8B — unprotected concentrated LP capital on
 *     Solana (DefiLlama, Q4 2025).
 *   - annual_drag_differential = 7% — midpoint of (Z1 public drag
 *     8–12%) minus (Z2 confidential-execution residual 2–4%). The
 *     delta ShadowPool closes.
 *   - elapsed since 2026-02-01 (Arcium mainnet-alpha launch) — the
 *     date from which confidential execution was a *choice*
 *     institutional LPs could have made on Solana.
 *
 * The counter is a **projection**, not a claim ShadowPool has already
 * saved X dollars. Labeled accordingly. The intent is to make the
 * cost of inaction legible — every second the on-chain LP industry
 * doesn't have this primitive in production is extraction that
 * could have been avoided.
 */

// Genesis of confidential-execution-as-an-option on Solana.
const MPC_ALPHA_LAUNCH = Date.UTC(2026, 1, 1); // Feb 1 2026
const ADDRESSABLE_TVL_USD = 3_800_000_000;
const ANNUAL_DRAG_DIFFERENTIAL = 0.07;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// Update cadence — visible motion, not frantic.
const TICK_MS = 120;

function computeSavings(nowMs: number): number {
  const elapsedMs = Math.max(0, nowMs - MPC_ALPHA_LAUNCH);
  return (
    ADDRESSABLE_TVL_USD * ANNUAL_DRAG_DIFFERENTIAL * (elapsedMs / YEAR_MS)
  );
}

function formatUsd(n: number): { whole: string; cents: string } {
  const whole = Math.floor(n)
    .toLocaleString("en-US")
    .padStart(1, "0");
  const cents = (n - Math.floor(n)).toFixed(2).slice(1); // ".XX"
  return { whole, cents };
}

export function MevSavingsCounter() {
  // SSR-safe: compute deterministically from a fixed reference so the
  // server-rendered HTML exactly matches the client's first paint.
  // The first useEffect tick replaces it with the actual current time.
  const [value, setValue] = useState(() => computeSavings(MPC_ALPHA_LAUNCH));
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setValue(computeSavings(Date.now()));
    const id = setInterval(() => setValue(computeSavings(Date.now())), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const { whole, cents } = formatUsd(value);

  return (
    <div className="relative">
      {/* Section kicker */}
      <div className="flex items-baseline justify-between mb-8 flex-wrap gap-3">
        <div>
          <div
            className="text-[10px] font-mono tracking-[0.25em] uppercase mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            · 00b · Extraction tax · live projection
          </div>
          <h2
            className="font-editorial text-[clamp(1.75rem,3.5vw,2.5rem)] leading-tight max-w-4xl"
            style={{ color: "var(--text-editorial)" }}
          >
            Every second this primitive
            <span
              className="font-editorial-italic"
              style={{ color: "var(--accent-danger)" }}
            >
              {" "}
              isn&rsquo;t in production
            </span>
            ,<br />
            the tax keeps compounding.
          </h2>
        </div>

        <div
          className="text-[10px] font-mono tracking-[0.15em] uppercase max-w-[22rem]"
          style={{ color: "var(--text-tertiary)" }}
        >
          since Arcium mainnet-alpha · 2026-02-01 ·
          $3.8B unprotected LP tvl × 7% p.a. drag differential
        </div>
      </div>

      {/* Main number */}
      <div className="flex items-baseline gap-1 flex-wrap">
        <span
          className="text-[10px] font-mono tracking-[0.3em] uppercase pr-3"
          style={{ color: "var(--text-tertiary)" }}
        >
          USD
        </span>
        <span
          className="metric-display-number tabular-nums leading-none"
          style={{
            color: "var(--accent-danger)",
            fontSize: "clamp(3rem, 9vw, 7rem)",
            fontWeight: 300,
            textShadow: mounted
              ? "0 0 40px oklch(0.65 0.18 25 / 0.2)"
              : undefined,
          }}
          aria-live="polite"
          aria-label={`${whole} dollars and ${cents.replace(".", "")} cents`}
        >
          {whole}
          <span
            className="ml-1"
            style={{
              color: "var(--accent-danger)",
              opacity: 0.55,
              fontSize: "0.38em",
              verticalAlign: "baseline",
            }}
          >
            {cents}
          </span>
        </span>
      </div>

      {/* Footnote */}
      <div
        className="mt-6 max-w-2xl text-[13px] leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        MEV-extraction exposure avoidable if Solana&rsquo;s concentrated
        LP capital had deployed behind a confidential execution layer
        from day one. Compounds continuously at{" "}
        <span
          className="font-mono text-[12px]"
          style={{ color: "var(--accent-danger)" }}
        >
          ${Math.round(
            (ADDRESSABLE_TVL_USD * ANNUAL_DRAG_DIFFERENTIAL) / (365 * 24 * 60 * 60),
          ).toLocaleString()}
        </span>{" "}
        per second. Projection, not a claim of saved capital —
        ShadowPool is the primitive that would have closed the gap.
      </div>

      <div
        className="mt-5 text-[10px] font-mono tracking-[0.12em] uppercase"
        style={{ color: "var(--text-tertiary)" }}
      >
        sources · Arcium mainnet-alpha launch · Feb 2026 ·
        DefiLlama concentrated-LP TVL · Q4 2025 ·
        <a
          href="https://github.com/criptocbas/shadowpool/blob/main/WHITEPAPER.md"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline ml-2"
          style={{ color: "var(--accent-encrypted)" }}
        >
          whitepaper §12 ↗
        </a>
      </div>
    </div>
  );
}
