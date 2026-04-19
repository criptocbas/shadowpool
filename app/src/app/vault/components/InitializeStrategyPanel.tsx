"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  useInitializeStrategy,
  InitializeStrategyPhase,
} from "@/hooks/useInitializeStrategy";
import { useEmergencyOverride } from "@/hooks/useEmergencyOverride";

function phaseLabel(phase: InitializeStrategyPhase): string {
  switch (phase) {
    case "signing-key":
      return "[1/5] Deriving encryption key from wallet signature…";
    case "fetching-mxe":
      return "[2/5] Fetching MXE public key…";
    case "encrypting":
      return "[3/5] Encrypting strategy with RescueCipher…";
    case "queueing":
      return "[4/5] Queueing MPC computation on-chain…";
    case "awaiting-mpc":
      return "[5/5] Awaiting Arcium cluster callback…";
    case "complete":
      return "Encrypted state initialized.";
    case "error":
      return "Error during initialization.";
    default:
      return "";
  }
}

export function InitializeStrategyPanel({
  authority,
  onComplete,
}: {
  authority: PublicKey;
  onComplete: () => void;
}) {
  const { initialize, phase, error } = useInitializeStrategy(authority);
  const override = useEmergencyOverride(authority);
  const { signMessage } = useWallet();
  const [spread, setSpread] = useState(50);
  const [threshold, setThreshold] = useState(100);

  const busy =
    phase === "signing-key" ||
    phase === "fetching-mxe" ||
    phase === "encrypting" ||
    phase === "queueing" ||
    phase === "awaiting-mpc";

  const canSubmit =
    !busy &&
    typeof signMessage === "function" &&
    spread >= 1 &&
    spread <= 9999 &&
    threshold >= 1 &&
    threshold <= 9999;

  const handleInit = async () => {
    if (!signMessage) return;
    const res = await initialize(
      { spreadBps: spread, rebalanceThresholdBps: threshold },
      { signMessage },
    );
    if (res) onComplete();
  };

  return (
    <div
      className="p-6 md:p-8 rounded"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
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
          · Initialize encrypted strategy
        </span>
      </div>

      <h3
        className="font-editorial text-[clamp(1.25rem,2.5vw,1.75rem)] leading-tight mb-2"
        style={{ color: "var(--text-editorial)" }}
      >
        Your strategy,{" "}
        <span
          className="font-editorial-italic"
          style={{ color: "var(--accent-encrypted)" }}
        >
          encrypted
        </span>{" "}
        inside Arcium MPC.
      </h3>

      <p
        className="text-[13px] leading-relaxed mb-6 max-w-lg"
        style={{ color: "var(--text-secondary)" }}
      >
        Set your market-making parameters. They encrypt locally via
        x25519 + RescueCipher, land inside Arcium&rsquo;s MPC cluster, and
        the encrypted state ciphertexts persist on-chain. No validator,
        explorer, or MEV bot can read them.
      </p>

      {/* Configuration */}
      <div
        className="grid gap-4 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        <FormRow label="Spread" hint="basis points · 1–9999 (clamped at 9999)">
          <div className="flex items-baseline gap-2">
            <input
              type="number"
              min={1}
              max={9999}
              value={spread}
              onChange={(e) => setSpread(Number(e.target.value))}
              disabled={busy}
              className="flex-1 bg-transparent outline-none font-mono text-[13px] disabled:opacity-60"
              style={{ color: "var(--text-primary)" }}
            />
            <span
              className="text-[10px] font-mono tracking-wider uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              {(spread / 100).toFixed(2)}%
            </span>
          </div>
        </FormRow>

        <FormRow
          label="Rebalance threshold"
          hint="price deviation bps · triggers rebalance"
        >
          <div className="flex items-baseline gap-2">
            <input
              type="number"
              min={1}
              max={9999}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={busy}
              className="flex-1 bg-transparent outline-none font-mono text-[13px] disabled:opacity-60"
              style={{ color: "var(--text-primary)" }}
            />
            <span
              className="text-[10px] font-mono tracking-wider uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              {(threshold / 100).toFixed(2)}%
            </span>
          </div>
        </FormRow>
      </div>

      {/* Progress / error */}
      {(busy || phase === "complete" || phase === "error") && (
        <div
          className="mb-4 px-3 py-2 rounded font-mono text-[11.5px] leading-relaxed"
          style={{
            background: "var(--bg-deep)",
            border: "1px solid var(--border-subtle)",
            color:
              phase === "error"
                ? "var(--accent-danger)"
                : phase === "complete"
                  ? "var(--accent-revealed)"
                  : "var(--accent-encrypted)",
          }}
        >
          <div className="flex items-center gap-2">
            {busy && (
              <span
                className="live-dot w-1.5 h-1.5 rounded-full"
                style={{ background: "currentColor" }}
              />
            )}
            <span>{phaseLabel(phase)}</span>
          </div>
          {error && (
            <div
              className="mt-1 text-[11px] break-all"
              style={{ color: "var(--accent-danger)" }}
            >
              {error}
            </div>
          )}
        </div>
      )}

      <button
        disabled={!canSubmit}
        onClick={handleInit}
        className={`px-5 py-3 text-[13px] font-medium tracking-wide rounded transition-all duration-200 ${
          !canSubmit
            ? "opacity-60 cursor-not-allowed"
            : "hover:brightness-110 cursor-pointer"
        }`}
        style={{
          background: "var(--accent-encrypted)",
          color: "var(--bg-deep)",
        }}
      >
        {busy ? "Working…" : "Initialize Encrypted Strategy →"}
      </button>

      <p
        className="mt-6 text-[11px] leading-relaxed font-mono"
        style={{ color: "var(--text-tertiary)" }}
      >
        Keys are derived deterministically from your wallet signature —
        no secret stored in localStorage, re-signing regenerates the same
        key for future <span style={{ color: "var(--accent-encrypted)" }}>update_strategy</span> calls.
      </p>

      <div
        className="mt-6 pt-4 border-t text-[11px] font-mono leading-relaxed"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--text-tertiary)",
        }}
      >
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <div
              className="text-[10px] tracking-[0.2em] uppercase mb-1"
              style={{ color: "var(--accent-danger)" }}
            >
              · Emergency reset
            </div>
            <div>
              If the MPC cluster times out or aborts, the vault&rsquo;s
              pending-state guard can wedge. Clears{" "}
              <span style={{ color: "var(--accent-encrypted)" }}>
                pending_state_computation
              </span>{" "}
              and{" "}
              <span style={{ color: "var(--accent-encrypted)" }}>nav_stale</span>{" "}
              in one authority-gated tx. Emits{" "}
              <span style={{ color: "var(--accent-encrypted)" }}>
                EmergencyOverrideEvent
              </span>{" "}
              with the previous state for audit.
            </div>
            {override.phase === "error" && override.error && (
              <div
                className="mt-2 text-[11px] break-all"
                style={{ color: "var(--accent-danger)" }}
              >
                {override.error}
              </div>
            )}
            {override.phase === "complete" && override.txSig && (
              <div
                className="mt-2 text-[11px] break-all"
                style={{ color: "var(--accent-revealed)" }}
              >
                ✓ cleared · {override.txSig.slice(0, 16)}…
              </div>
            )}
          </div>
          <button
            disabled={override.phase === "sending" || busy}
            onClick={() => override.clear()}
            className="px-3 py-2 text-[10px] font-mono tracking-[0.15em] uppercase rounded whitespace-nowrap transition-opacity hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "transparent",
              border: "1px solid var(--accent-danger)",
              color: "var(--accent-danger)",
            }}
          >
            {override.phase === "sending" ? "Sending…" : "Emergency reset →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div
        className="text-[10px] tracking-[0.2em] uppercase mb-1.5"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </div>
      <div
        className="rounded px-3 py-2.5"
        style={{
          background: "var(--bg-deep)",
          border: "1px solid var(--border-medium)",
        }}
      >
        {children}
      </div>
      <div
        className="mt-1 text-[9.5px] tracking-wide"
        style={{ color: "var(--text-tertiary)", opacity: 0.6 }}
      >
        {hint}
      </div>
    </label>
  );
}
