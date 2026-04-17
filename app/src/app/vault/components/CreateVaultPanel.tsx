"use client";

import { useState } from "react";
import { useCreateVault, CreateVaultPhase } from "@/hooks/useCreateVault";

const SOL_USD_FEED_HEX =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < stripped.length; i += 2) {
    bytes[i / 2] = parseInt(stripped.slice(i, i + 2), 16);
  }
  return bytes;
}

function phaseLabel(phase: CreateVaultPhase): string {
  switch (phase) {
    case "creating-mints":
      return "[1/3] Creating SPL mints (base · quote · share)…";
    case "creating-accounts":
      return "[2/3] Creating vault + user token accounts…";
    case "initializing-vault":
      return "[3/3] Initializing vault on-chain…";
    case "complete":
      return "Vault initialized.";
    case "error":
      return "Error during setup.";
    default:
      return "";
  }
}

export function CreateVaultPanel({
  onVaultCreated,
}: {
  onVaultCreated: () => void;
}) {
  const { create, phase, error } = useCreateVault();
  const [feedHex, setFeedHex] = useState(SOL_USD_FEED_HEX);
  const [maxAge, setMaxAge] = useState(30);
  const [seed, setSeed] = useState("1000"); // USDC to mint to user for testing

  const busy =
    phase === "creating-mints" ||
    phase === "creating-accounts" ||
    phase === "initializing-vault";

  const handleCreate = async () => {
    // Normalize + validate the feed id. Must be 64 hex chars (32 bytes).
    const cleaned = feedHex.startsWith("0x") ? feedHex.slice(2) : feedHex;
    if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
      return; // UI validation would show an error; keeping silent for now
    }
    const bytes = hexToBytes(cleaned);
    const seedQuote = (() => {
      const n = Number(seed);
      if (!Number.isFinite(n) || n <= 0) return BigInt(0);
      // 6 decimals for the demo USDC mint
      return BigInt(Math.floor(n * 1_000_000));
    })();

    const result = await create({
      priceFeedId: bytes,
      maxPriceAgeSeconds: maxAge,
      seedUserQuote: seedQuote,
    });
    if (result) onVaultCreated();
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
          · Initialize new vault
        </span>
      </div>

      <h3
        className="font-editorial text-[clamp(1.25rem,2.5vw,1.75rem)] leading-tight mb-2"
        style={{ color: "var(--text-editorial)" }}
      >
        No vault yet for this wallet.
      </h3>
      <p
        className="text-[13px] leading-relaxed mb-6 max-w-lg"
        style={{ color: "var(--text-secondary)" }}
      >
        Generate three fresh SPL mints (base · quote · share), seed an
        ATA with demo quote tokens, and initialize the vault against
        your configured Pyth feed. Three signatures, ~8 seconds on devnet.
      </p>

      {/* Configuration form */}
      <div
        className="grid gap-4 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
      >
        <FormRow
          label="Pyth feed id"
          hint="32 bytes hex · SOL/USD default"
        >
          <input
            type="text"
            value={feedHex}
            onChange={(e) => setFeedHex(e.target.value)}
            disabled={busy}
            className="w-full bg-transparent outline-none font-mono text-[11px] disabled:opacity-60"
            style={{ color: "var(--text-primary)" }}
          />
        </FormRow>

        <FormRow label="Max price age" hint="seconds · Pyth staleness cap">
          <input
            type="number"
            min={1}
            max={600}
            value={maxAge}
            onChange={(e) => setMaxAge(Number(e.target.value))}
            disabled={busy}
            className="w-full bg-transparent outline-none font-mono text-[13px] disabled:opacity-60"
            style={{ color: "var(--text-primary)" }}
          />
        </FormRow>

        <FormRow
          label="Seed your USDC balance"
          hint="optional · tokens you can immediately deposit"
        >
          <div className="flex items-baseline gap-2">
            <input
              type="number"
              min={0}
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              disabled={busy}
              className="flex-1 bg-transparent outline-none font-mono text-[13px] disabled:opacity-60"
              style={{ color: "var(--text-primary)" }}
            />
            <span
              className="text-[10px] font-mono tracking-wider uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              demo USDC
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

      {/* Primary CTA */}
      <button
        disabled={busy}
        onClick={handleCreate}
        className={`px-5 py-3 text-[13px] font-medium tracking-wide rounded transition-all duration-200 ${
          busy ? "opacity-60 cursor-wait" : "hover:brightness-110 cursor-pointer"
        }`}
        style={{
          background: "var(--accent-encrypted)",
          color: "var(--bg-deep)",
        }}
      >
        {busy ? "Working…" : "Create Vault →"}
      </button>

      <p
        className="mt-6 text-[11px] leading-relaxed font-mono"
        style={{ color: "var(--text-tertiary)" }}
      >
        Fresh vault has empty encrypted state. Run{" "}
        <span style={{ color: "var(--accent-encrypted)" }}>
          create_vault_state
        </span>{" "}
        to initialize the MPC-side strategy params; deposit + withdraw work
        independently of that.
      </p>
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
