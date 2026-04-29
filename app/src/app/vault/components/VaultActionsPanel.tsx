"use client";

import { useState, useEffect } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  useComputeQuotesMpc,
  useUpdateStrategy,
  useRevealPerformance,
  useEmergencyOverride,
  type QuotesComputedPayload,
  type PerformanceRevealedPayload,
} from "@/hooks";

/**
 * Unified vault-actions card — the MPC control surface for an
 * initialized vault. Four rows:
 *
 *   01 · Compute quotes       — Pyth Hermes + compute_quotes MPC
 *   02 · Update strategy      — re-encrypt spread/threshold
 *   03 · Reveal performance   — selective NAV disclosure
 *   04 · Execute rebalance    — DLMM swap (placeholder for now)
 *
 * Each row is self-contained: owns its hook, displays its own phase
 * indicator, expands on interaction to show form (update_strategy)
 * or last-result (others). Keyboard-navigable; responsive to
 * prefers-reduced-motion (animations gate on no-motion preference).
 *
 * Visual style inherits the "institutional ops console" aesthetic —
 * tight 1px rules between rows, mono digits, no drop-shadows, no
 * rounded-pill buttons. Status dots + short labels carry state.
 */
export function VaultActionsPanel({
  authority,
  onRefresh,
}: {
  authority: PublicKey;
  onRefresh: () => void;
}) {
  return (
    <div
      className="rounded overflow-hidden"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div
        className="flex items-center gap-2 px-5 py-3 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full live-dot"
          style={{ background: "var(--accent-encrypted)" }}
        />
        <span
          className="text-[10px] tracking-[0.25em] uppercase"
          style={{ color: "var(--text-tertiary)" }}
        >
          Vault actions
        </span>
        <div className="flex-1" />
        <span
          className="text-[9.5px] font-mono tracking-wider"
          style={{ color: "var(--text-tertiary)", opacity: 0.9 }}
        >
          MPC-backed
        </span>
      </div>

      <ComputeQuotesRow authority={authority} onRefresh={onRefresh} />
      <UpdateStrategyRow authority={authority} onRefresh={onRefresh} />
      <RevealPerformanceRow authority={authority} onRefresh={onRefresh} />
      <ExecuteRebalanceRow />
      <EmergencyResetRow authority={authority} onRefresh={onRefresh} />
    </div>
  );
}

function EmergencyResetRow({
  authority,
  onRefresh,
}: {
  authority: PublicKey;
  onRefresh: () => void;
}) {
  const override = useEmergencyOverride(authority);

  const handleClick = async () => {
    const sig = await override.clear();
    if (sig) onRefresh();
  };

  return (
    <div
      className="px-5 py-3 flex items-center gap-3 flex-wrap"
      style={{ borderTop: "1px solid var(--border-subtle)" }}
    >
      <div
        className="text-[10px] font-mono tracking-[0.2em] uppercase w-7 shrink-0"
        style={{ color: "var(--accent-danger)" }}
      >
        ·
      </div>
      <div className="flex-1 min-w-[220px]">
        <div
          className="text-[10px] tracking-[0.2em] uppercase"
          style={{ color: "var(--accent-danger)" }}
        >
          Emergency reset
        </div>
        <div
          className="text-[11px] font-mono leading-relaxed"
          style={{ color: "var(--text-tertiary)" }}
        >
          Authority-gated M-2 override · clears{" "}
          <span style={{ color: "var(--accent-encrypted)" }}>
            pending_state_computation
          </span>{" "}
          and{" "}
          <span style={{ color: "var(--accent-encrypted)" }}>nav_stale</span> if
          an MPC callback times out.
        </div>
        {override.phase === "error" && override.error && (
          <div
            className="mt-1 text-[11px] font-mono break-all"
            style={{ color: "var(--accent-danger)" }}
          >
            {override.error}
          </div>
        )}
        {override.phase === "complete" && override.txSig && (
          <div
            className="mt-1 text-[11px] font-mono break-all"
            style={{ color: "var(--accent-revealed)" }}
          >
            ✓ {override.txSig.slice(0, 16)}…
          </div>
        )}
      </div>
      <button
        disabled={override.phase === "sending"}
        onClick={handleClick}
        className="px-3 py-2 text-[10px] font-mono tracking-[0.15em] uppercase rounded whitespace-nowrap transition-opacity hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: "transparent",
          border: "1px solid var(--accent-danger)",
          color: "var(--accent-danger)",
        }}
      >
        {override.phase === "sending" ? "Sending…" : "Reset →"}
      </button>
    </div>
  );
}

// ─── Shared row primitive ─────────────────────────────────────────

function ActionRow({
  index,
  title,
  description,
  status,
  statusTone,
  phaseLabel,
  expanded,
  onToggle,
  cta,
  children,
  isLast,
}: {
  index: string;
  title: string;
  description: string;
  status: string;
  statusTone: "neutral" | "ready" | "busy" | "complete" | "error" | "locked";
  phaseLabel?: string;
  expanded?: boolean;
  onToggle?: () => void;
  cta: React.ReactNode;
  children?: React.ReactNode;
  isLast?: boolean;
}) {
  const statusColor =
    statusTone === "ready"
      ? "var(--accent-encrypted)"
      : statusTone === "busy"
        ? "var(--accent-warning)"
        : statusTone === "complete"
          ? "var(--accent-revealed)"
          : statusTone === "error"
            ? "var(--accent-danger)"
            : statusTone === "locked"
              ? "var(--text-tertiary)"
              : "var(--text-tertiary)";

  return (
    <div
      style={{
        borderBottom: isLast ? "none" : "1px solid var(--border-subtle)",
      }}
    >
      <div
        className="px-5 py-3.5 flex items-start gap-3 cursor-default"
        onClick={onToggle}
        role={onToggle ? "button" : undefined}
        tabIndex={onToggle ? 0 : undefined}
      >
        <div
          className="text-[10px] font-mono tracking-[0.2em] uppercase pt-0.5 w-7 shrink-0"
          style={{ color: "var(--text-tertiary)" }}
        >
          {index}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="text-[13px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {title}
            </span>
            <span
              className="flex items-center gap-1.5 text-[9.5px] tracking-[0.2em] uppercase"
              style={{ color: statusColor }}
            >
              <span
                className="w-1 h-1 rounded-full"
                style={{ background: "currentColor" }}
              />
              {status}
            </span>
          </div>
          <div
            className="text-[11.5px] leading-relaxed mt-0.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            {description}
          </div>
          {phaseLabel && (
            <div
              className="mt-1.5 text-[10.5px] font-mono"
              style={{ color: statusColor }}
            >
              {phaseLabel}
            </div>
          )}
        </div>

        <div className="shrink-0 self-start">{cta}</div>
      </div>

      {expanded && children && (
        <div
          className="px-5 pb-4 pt-0"
          style={{
            background: "var(--bg-deep)",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Compute Quotes ──────────────────────────────────────────────

function ComputeQuotesRow({
  authority,
  onRefresh,
}: {
  authority: PublicKey;
  onRefresh: () => void;
}) {
  const { compute, phase, error, result, reset } = useComputeQuotesMpc(authority);

  const busy = phase !== "idle" && phase !== "complete" && phase !== "error";
  const status =
    phase === "idle"
      ? "ready"
      : busy
        ? "running"
        : phase === "complete"
          ? "complete"
          : "error";
  const tone =
    phase === "idle"
      ? "ready"
      : busy
        ? "busy"
        : phase === "complete"
          ? "complete"
          : "error";

  const phaseLabel = (() => {
    switch (phase) {
      case "fetching-pyth":
        return "[1/4] Fetching Pyth Hermes VAA…";
      case "posting-receiver":
        return "[2/4] Posting VAA via Pyth receiver…";
      case "queueing":
        return "[3/4] Queueing compute_quotes…";
      case "awaiting-mpc":
        return "[4/4] Awaiting MPC callback…";
      case "error":
        return error ?? undefined;
      default:
        return undefined;
    }
  })();

  const handleClick = async () => {
    if (busy) return;
    if (phase === "complete" || phase === "error") {
      reset();
      return;
    }
    const r = await compute();
    if (r) onRefresh();
  };

  return (
    <ActionRow
      index="01"
      title="Compute quotes"
      description="Pull a fresh Pyth SOL/USD update, generate encrypted bid/ask inside Arcium MPC."
      status={status}
      statusTone={tone}
      phaseLabel={phaseLabel}
      expanded={!!result}
      cta={
        <button
          disabled={busy}
          onClick={handleClick}
          className={`text-[11px] font-medium tracking-wide px-3 py-1.5 rounded transition-colors ${
            busy
              ? "opacity-60 cursor-wait"
              : phase === "error"
                ? "cursor-pointer"
                : "cursor-pointer hover:brightness-110"
          }`}
          style={{
            background:
              phase === "error"
                ? "var(--bg-raised)"
                : phase === "complete"
                  ? "var(--bg-raised)"
                  : "var(--accent-encrypted)",
            color:
              phase === "error" || phase === "complete"
                ? "var(--text-primary)"
                : "var(--bg-deep)",
            border: phase === "error" || phase === "complete"
              ? "1px solid var(--border-medium)"
              : "none",
          }}
        >
          {busy
            ? "Running…"
            : phase === "complete"
              ? "Run again"
              : phase === "error"
                ? "Reset"
                : "Run →"}
        </button>
      }
    >
      {result && (
        <QuotesRevealDisplay payload={result.payload} txSig={result.txSig} />
      )}
    </ActionRow>
  );
}

function QuotesRevealDisplay({
  payload,
  txSig,
}: {
  payload: QuotesComputedPayload;
  txSig: string;
}) {
  const fmt = (n: bigint, decimals = 6) => {
    const s = n.toString();
    const whole = s.length > decimals ? s.slice(0, -decimals) : "0";
    const frac = s.padStart(decimals + 1, "0").slice(-decimals);
    return `${whole}.${frac.slice(0, 3)}`;
  };

  return (
    <div className="pt-4">
      <div
        className="text-[9.5px] tracking-[0.2em] uppercase mb-2"
        style={{ color: "var(--accent-revealed)" }}
      >
        · Revealed from MPC
      </div>
      <div
        className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11.5px] tabular-nums"
      >
        <div>
          <span style={{ color: "var(--text-tertiary)" }}>bid </span>
          <span style={{ color: "var(--accent-revealed)" }}>
            ${fmt(payload.bidPrice)}
          </span>
        </div>
        <div className="text-right">
          <span style={{ color: "var(--text-tertiary)" }}>size </span>
          <span style={{ color: "var(--text-secondary)" }}>
            {fmt(payload.bidSize, 9)}
          </span>
        </div>
        <div>
          <span style={{ color: "var(--text-tertiary)" }}>ask </span>
          <span style={{ color: "var(--accent-revealed)" }}>
            ${fmt(payload.askPrice)}
          </span>
        </div>
        <div className="text-right">
          <span style={{ color: "var(--text-tertiary)" }}>size </span>
          <span style={{ color: "var(--text-secondary)" }}>
            {fmt(payload.askSize, 9)}
          </span>
        </div>
      </div>
      <div
        className="mt-3 pt-2 flex items-center justify-between text-[10px] font-mono"
        style={{
          borderTop: "1px solid var(--border-subtle)",
          color: "var(--text-tertiary)",
        }}
      >
        <span>
          rebalance flag ·{" "}
          <span
            style={{
              color:
                payload.shouldRebalance === 1
                  ? "var(--accent-warning)"
                  : "var(--accent-revealed)",
            }}
          >
            {payload.shouldRebalance === 1 ? "needed" : "not needed"}
          </span>
        </span>
        <a
          href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
          style={{ color: "var(--accent-revealed)" }}
        >
          {txSig.slice(0, 8)}…{txSig.slice(-6)} ↗
        </a>
      </div>
    </div>
  );
}

// ─── Update Strategy ──────────────────────────────────────────────

function UpdateStrategyRow({
  authority,
  onRefresh,
}: {
  authority: PublicKey;
  onRefresh: () => void;
}) {
  const { update, phase, error, result, reset } = useUpdateStrategy(authority);
  const { signMessage } = useWallet();
  const [expanded, setExpanded] = useState(false);
  const [spread, setSpread] = useState(200);
  const [threshold, setThreshold] = useState(100);

  const busy = phase !== "idle" && phase !== "complete" && phase !== "error";
  const status =
    phase === "idle"
      ? "ready"
      : busy
        ? "running"
        : phase === "complete"
          ? "complete"
          : "error";
  const tone =
    phase === "idle"
      ? "ready"
      : busy
        ? "busy"
        : phase === "complete"
          ? "complete"
          : "error";

  const phaseLabel = (() => {
    switch (phase) {
      case "signing-key":
        return "[1/5] Deriving key from wallet signature…";
      case "fetching-mxe":
        return "[2/5] Fetching MXE public key…";
      case "encrypting":
        return "[3/5] Encrypting new params…";
      case "queueing":
        return "[4/5] Queueing update_strategy…";
      case "awaiting-mpc":
        return "[5/5] Awaiting MPC callback…";
      case "error":
        return error ?? undefined;
      default:
        return undefined;
    }
  })();

  // Auto-reset after successful update so the row doesn't stay in
  // "complete" indefinitely.
  useEffect(() => {
    if (phase === "complete") {
      const timer = setTimeout(() => {
        reset();
        setExpanded(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [phase, reset]);

  const handleSubmit = async () => {
    if (!signMessage) return;
    const r = await update(
      { spreadBps: spread, rebalanceThresholdBps: threshold },
      { signMessage },
    );
    if (r) onRefresh();
  };

  return (
    <ActionRow
      index="02"
      title="Update strategy"
      description="Re-encrypt spread + rebalance threshold. Same wallet signature → same key."
      status={status}
      statusTone={tone}
      phaseLabel={phaseLabel}
      expanded={expanded}
      onToggle={busy ? undefined : () => setExpanded((e) => !e)}
      cta={
        <button
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            if (busy) return;
            setExpanded((x) => !x);
          }}
          className={`text-[11px] font-medium tracking-wide px-3 py-1.5 rounded transition-colors ${
            busy ? "opacity-60 cursor-wait" : "cursor-pointer hover:brightness-110"
          }`}
          style={{
            background: "var(--bg-raised)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-medium)",
          }}
        >
          {busy ? "Updating…" : expanded ? "Cancel" : "Edit →"}
        </button>
      }
      isLast={false}
    >
      <div className="pt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <div
            className="text-[9.5px] tracking-[0.2em] uppercase mb-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            New spread
          </div>
          <div
            className="rounded flex items-baseline gap-2 px-2.5 py-2"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-medium)",
            }}
          >
            <input
              type="number"
              min={1}
              max={9999}
              value={spread}
              onChange={(e) => setSpread(Number(e.target.value))}
              disabled={busy}
              className="flex-1 bg-transparent outline-none font-mono text-[12px] disabled:opacity-60"
              style={{ color: "var(--text-primary)" }}
            />
            <span
              className="text-[9.5px] font-mono uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              bps · {(spread / 100).toFixed(2)}%
            </span>
          </div>
        </label>
        <label className="block">
          <div
            className="text-[9.5px] tracking-[0.2em] uppercase mb-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            Rebalance threshold
          </div>
          <div
            className="rounded flex items-baseline gap-2 px-2.5 py-2"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-medium)",
            }}
          >
            <input
              type="number"
              min={1}
              max={9999}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={busy}
              className="flex-1 bg-transparent outline-none font-mono text-[12px] disabled:opacity-60"
              style={{ color: "var(--text-primary)" }}
            />
            <span
              className="text-[9.5px] font-mono uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              bps · {(threshold / 100).toFixed(2)}%
            </span>
          </div>
        </label>
        <button
          disabled={!signMessage || busy || spread < 1 || threshold < 1}
          onClick={handleSubmit}
          className="col-span-2 px-4 py-2 text-[12px] font-medium tracking-wide rounded disabled:opacity-60"
          style={{
            background: "var(--accent-encrypted)",
            color: "var(--bg-deep)",
          }}
        >
          {busy ? "Encrypting…" : "Encrypt + queue update →"}
        </button>
        {result && (
          <div
            className="col-span-2 text-[10px] font-mono"
            style={{ color: "var(--accent-revealed)" }}
          >
            ✓ updated ·{" "}
            <a
              href={`https://explorer.solana.com/tx/${result.txSig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-2 hover:underline"
            >
              {result.txSig.slice(0, 8)}…{result.txSig.slice(-6)} ↗
            </a>
          </div>
        )}
      </div>
    </ActionRow>
  );
}

// ─── Reveal Performance ───────────────────────────────────────────

function RevealPerformanceRow({
  authority,
  onRefresh,
}: {
  authority: PublicKey;
  onRefresh: () => void;
}) {
  const { reveal, phase, error, result, reset } = useRevealPerformance(authority);

  const busy = phase !== "idle" && phase !== "complete" && phase !== "error";
  const status =
    phase === "idle"
      ? "ready"
      : busy
        ? "running"
        : phase === "complete"
          ? "complete"
          : "error";
  const tone =
    phase === "idle"
      ? "ready"
      : busy
        ? "busy"
        : phase === "complete"
          ? "complete"
          : "error";

  const phaseLabel = (() => {
    switch (phase) {
      case "queueing":
        return "[1/2] Queueing reveal_performance…";
      case "awaiting-mpc":
        return "[2/2] Awaiting MPC attestation…";
      case "error":
        return error ?? undefined;
      default:
        return undefined;
    }
  })();

  const handleClick = async () => {
    if (busy) return;
    if (phase === "complete" || phase === "error") {
      reset();
      return;
    }
    const r = await reveal();
    if (r) onRefresh();
  };

  return (
    <ActionRow
      index="03"
      title="Reveal performance"
      description="Selective disclosure: MPC attests aggregate NAV in quote tokens. Strategy stays encrypted."
      status={status}
      statusTone={tone}
      phaseLabel={phaseLabel}
      expanded={!!result}
      cta={
        <button
          disabled={busy}
          onClick={handleClick}
          className={`text-[11px] font-medium tracking-wide px-3 py-1.5 rounded transition-colors ${
            busy ? "opacity-60 cursor-wait" : "cursor-pointer hover:brightness-110"
          }`}
          style={{
            background:
              phase === "error" || phase === "complete"
                ? "var(--bg-raised)"
                : "var(--accent-encrypted)",
            color:
              phase === "error" || phase === "complete"
                ? "var(--text-primary)"
                : "var(--bg-deep)",
            border: phase === "error" || phase === "complete"
              ? "1px solid var(--border-medium)"
              : "none",
          }}
        >
          {busy
            ? "Revealing…"
            : phase === "complete"
              ? "Reveal again"
              : phase === "error"
                ? "Reset"
                : "Reveal →"}
        </button>
      }
    >
      {result && <NavRevealDisplay payload={result.payload} txSig={result.txSig} />}
    </ActionRow>
  );
}

function NavRevealDisplay({
  payload,
  txSig,
}: {
  payload: PerformanceRevealedPayload;
  txSig: string;
}) {
  // Quote side is 6-decimal USDC.
  const nav = Number(payload.totalValueInQuote) / 1e6;
  return (
    <div className="pt-4">
      <div
        className="text-[9.5px] tracking-[0.2em] uppercase mb-2"
        style={{ color: "var(--accent-revealed)" }}
      >
        · Attested NAV
      </div>
      <div
        className="metric-display-number text-[clamp(1.5rem,3vw,2rem)] leading-none"
        style={{ color: "var(--accent-revealed)" }}
      >
        ${nav.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>
      <div
        className="text-[10px] font-mono mt-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        quote units · attested at slot {payload.slot.toString()}
      </div>
      <div
        className="mt-3 pt-2 text-[10px] font-mono"
        style={{
          borderTop: "1px solid var(--border-subtle)",
          color: "var(--text-tertiary)",
        }}
      >
        <a
          href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
          style={{ color: "var(--accent-revealed)" }}
        >
          {txSig.slice(0, 8)}…{txSig.slice(-6)} ↗
        </a>
      </div>
    </div>
  );
}

// ─── Execute Rebalance (placeholder) ──────────────────────────────

function ExecuteRebalanceRow() {
  return (
    <ActionRow
      index="04"
      title="Execute rebalance"
      description="Consumes fresh quotes and swaps on Meteora DLMM. Requires a live pool + bin arrays."
      status="pool required"
      statusTone="locked"
      isLast
      cta={
        <button
          disabled
          title="DLMM pool configuration required — ships in a follow-up"
          className="text-[11px] font-medium tracking-wide px-3 py-1.5 rounded opacity-50 cursor-not-allowed"
          style={{
            background: "var(--bg-raised)",
            color: "var(--text-tertiary)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          Soon →
        </button>
      }
    />
  );
}
