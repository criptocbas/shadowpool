"use client";

import Link from "next/link";
import { useMemo, use } from "react";
import { PublicKey } from "@solana/web3.js";
import { useVaultReadOnly } from "@/hooks/useVaultReadOnly";
import { useProgramEvents } from "@/hooks/useProgramEvents";
import { PROGRAM_ID } from "@/lib/constants";

/**
 * Auditor surface: `/audit/<vault-pubkey>`.
 *
 * Read-only view built for a third party reviewing the vault's
 * attested state — compliance officer, auditor under an NDA, a
 * regulator with a compelled disclosure order, an institutional
 * allocator doing due diligence. Shows ONLY what the vault has
 * voluntarily disclosed through `reveal_performance`:
 *
 *   ✓ Aggregate NAV in quote units + slot timestamp
 *   ✓ Event history (revelations, deposits, withdrawals,
 *     rebalances) — all public chain state, no ciphertexts
 *   ✓ Verifiable identifiers (program, vault PDA, Pyth feed)
 *
 * Does NOT show:
 *
 *   ✗ Encrypted state ciphertexts
 *   ✗ Strategy parameters (spread, rebalance threshold)
 *   ✗ Individual asset balances
 *   ✗ Any data that only the MPC cluster can decrypt
 *
 * The page is the "selective disclosure" narrative made concrete as
 * its own surface — open the URL, see the attestation trail, cite
 * the on-chain proofs.
 */

interface Props {
  params: Promise<{ vault: string }>;
}

export default function AuditPage({ params }: Props) {
  const { vault: vaultParam } = use(params);

  // Parse + validate the URL param. Invalid base58 or wrong length
  // short-circuits to a graceful error state rather than crashing.
  const vaultPda = useMemo(() => {
    try {
      return new PublicKey(vaultParam);
    } catch {
      return null;
    }
  }, [vaultParam]);

  const { vault, loading, error } = useVaultReadOnly(vaultPda);
  const events = useProgramEvents(vaultPda, 40);

  // Filter to the event types a public auditor cares about.
  // reveal_performance is the headline; deposit/withdraw/rebalance
  // are supporting disclosure events; strategy/balance updates are
  // encrypted-only and surface here as "state changed" markers
  // without any decrypted detail.
  const publicEvents = events.filter((e) =>
    [
      "performanceRevealedEvent",
      "rebalanceExecutedEvent",
      "depositEvent",
      "withdrawEvent",
      "vaultCreatedEvent",
      "vaultStateInitializedEvent",
      "balancesUpdatedEvent",
      "strategyUpdatedEvent",
      "crankerSetEvent",
      "emergencyOverrideEvent",
    ].includes(e.eventName),
  );

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg-deep)" }}
    >
      {/* ═══ Nav ═══ */}
      <nav
        className="relative z-20 flex items-center justify-between px-6 py-4 md:px-10"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--accent-revealed)" }}
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
              color: "var(--accent-revealed)",
              border: "1px solid var(--accent-revealed-dim)",
            }}
          >
            audit surface · read-only
          </span>
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-[13px] transition-colors"
            style={{ color: "var(--text-tertiary)" }}
          >
            Home
          </Link>
          <Link
            href="/vault"
            className="text-[13px] px-4 py-2 rounded transition-colors hover:bg-[var(--bg-hover)]"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-medium)",
              color: "var(--text-primary)",
            }}
          >
            Operator view →
          </Link>
        </div>
      </nav>

      <main className="relative z-10 flex-1 flex flex-col">
        {/* ═══ Header ═══ */}
        <section
          className="px-6 md:px-10 lg:px-16 py-20 max-w-5xl"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-3 mb-8">
            <div
              className="w-6 h-px"
              style={{ background: "var(--accent-revealed)" }}
            />
            <span
              className="text-[10px] tracking-[0.3em] uppercase"
              style={{ color: "var(--accent-revealed)" }}
            >
              Audit surface · selective disclosure
            </span>
          </div>

          <h1
            className="font-editorial text-[clamp(2.5rem,5vw,4rem)] leading-[1.05] tracking-tight mb-8"
            style={{ color: "var(--text-editorial)" }}
          >
            Attested vault state,
            <br />
            <span
              className="font-editorial-italic"
              style={{ color: "var(--accent-revealed)" }}
            >
              on demand.
            </span>
          </h1>

          <p
            className="text-[clamp(0.95rem,1.3vw,1.05rem)] leading-[1.6] max-w-2xl"
            style={{ color: "var(--text-secondary)" }}
          >
            This page shows exactly what an auditor sees of this vault:
            the MPC-attested aggregate NAV, the revealed-quotes trail,
            and every public event the program has emitted. The
            strategy itself and all individual balances remain
            encrypted inside Arcium&rsquo;s MPC cluster &mdash; not
            withheld from this page, but cryptographically
            inaccessible at all.
          </p>

          <div
            className="mt-8 pt-6 flex flex-wrap gap-x-10 gap-y-4"
            style={{ borderTop: "1px solid var(--rule-ledger)" }}
          >
            <AddressCell label="Vault PDA" value={vaultParam} cluster="devnet" />
            <AddressCell
              label="Program"
              value={PROGRAM_ID.toBase58()}
              cluster="devnet"
            />
          </div>
        </section>

        {/* ═══ Attested NAV ═══ */}
        <section
          className="px-6 md:px-10 lg:px-16 py-20 max-w-5xl"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div
            className="text-[10px] tracking-[0.25em] uppercase mb-4"
            style={{ color: "var(--text-tertiary)" }}
          >
            · 01 · Last attested NAV
          </div>

          {!vaultPda ? (
            <ErrorNote>Invalid vault address in URL.</ErrorNote>
          ) : loading && !vault ? (
            <div
              className="font-mono text-sm"
              style={{ color: "var(--text-tertiary)" }}
            >
              fetching…
            </div>
          ) : error && !vault ? (
            <ErrorNote>{error}</ErrorNote>
          ) : vault ? (
            <NavDisplay
              raw={vault.lastRevealedNav?.toString() ?? "0"}
              slot={vault.lastRevealedNavSlot?.toString() ?? "0"}
              stale={vault.navStale}
            />
          ) : null}
        </section>

        {/* ═══ What this page shows vs hides ═══ */}
        <section
          className="px-6 md:px-10 lg:px-16 py-20 max-w-5xl"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div
            className="text-[10px] tracking-[0.25em] uppercase mb-6"
            style={{ color: "var(--text-tertiary)" }}
          >
            · 02 · Scope of disclosure
          </div>

          <div className="grid md:grid-cols-2 gap-10">
            <DisclosureColumn
              heading="Public — shown here"
              accent="revealed"
              items={[
                "Aggregate NAV in quote units",
                "Timestamped attestation history",
                "Revealed quote bid/ask (post-MPC)",
                "Deposit / withdraw records",
                "Vault configuration (feed id, cluster)",
              ]}
            />
            <DisclosureColumn
              heading="Encrypted — not disclosed"
              accent="encrypted"
              items={[
                "Strategy parameters (spread, threshold)",
                "Individual base / quote balances",
                "Historical composition",
                "Any ciphertext contents",
                "Pre-execution trade intentions",
              ]}
            />
          </div>
        </section>

        {/* ═══ Event trail ═══ */}
        <section className="px-6 md:px-10 lg:px-16 py-20 max-w-5xl">
          <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
            <div>
              <div
                className="text-[10px] tracking-[0.25em] uppercase mb-2"
                style={{ color: "var(--text-tertiary)" }}
              >
                · 03 · Event trail
              </div>
              <h2
                className="font-editorial text-[clamp(1.5rem,3vw,2rem)] leading-tight"
                style={{ color: "var(--text-editorial)" }}
              >
                Every on-chain event, slot-stamped.
              </h2>
            </div>
            <span
              className="text-[10px] font-mono tracking-[0.15em] uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              {publicEvents.length}{" "}
              {publicEvents.length === 1 ? "event" : "events"} · live
            </span>
          </div>

          <div
            className="rounded stream-log p-5"
            style={{
              background: "oklch(0.095 0.011 260)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {publicEvents.length === 0 ? (
              <div
                className="text-[11px] font-mono italic"
                style={{ color: "var(--text-tertiary)", opacity: 0.9 }}
              >
                listening for events · run compute_quotes or
                reveal_performance from the operator view to populate
              </div>
            ) : (
              publicEvents.map((e) => (
                <div key={e.key} className="stream-log-entry">
                  <span className="stream-log-slot">
                    {e.slot.toString()} ·
                  </span>
                  <span className="stream-log-event" data-level={e.level}>
                    {e.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ═══ Footer ═══ */}
        <footer
          className="px-6 md:px-10 lg:px-16 py-12"
          style={{
            borderTop: "1px solid var(--border-subtle)",
            color: "var(--text-tertiary)",
          }}
        >
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[11px] font-mono">
            <span
              className="flex items-center gap-1.5"
              style={{ color: "var(--accent-revealed)" }}
            >
              <span
                className="w-1 h-1 rounded-full"
                style={{ background: "currentColor" }}
              />
              attestation source · Arcium MPC · cluster 456
            </span>
            <span>oracle · Pyth Pull · ef0d…b56d</span>
            <span>network · Solana devnet</span>
            <Link
              href="/"
              className="underline-offset-2 hover:underline ml-auto"
              style={{ color: "var(--accent-encrypted)" }}
            >
              Back to public site ↗
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}

function NavDisplay({
  raw,
  slot,
  stale,
}: {
  raw: string;
  slot: string;
  stale: boolean;
}) {
  // Quote side is 6-decimal micro-USDC — same scale the program uses
  // for TARGET_PRICE_EXPO.
  const nav = Number(BigInt(raw)) / 1e6;
  const isUnattested = raw === "0";

  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className="text-[10px] font-mono tracking-[0.3em] uppercase"
          style={{ color: "var(--text-tertiary)" }}
        >
          USD
        </span>
        <span
          className="metric-display-number tabular-nums leading-none"
          style={{
            color: isUnattested
              ? "var(--text-tertiary)"
              : "var(--accent-revealed)",
            fontSize: "clamp(2.5rem, 7vw, 5rem)",
            fontWeight: 300,
          }}
        >
          {isUnattested
            ? "—"
            : nav.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      </div>
      <div
        className="mt-4 text-[13px] leading-relaxed max-w-xl"
        style={{ color: "var(--text-secondary)" }}
      >
        {isUnattested ? (
          <>
            No NAV has been attested yet. The vault owner must run{" "}
            <span
              className="font-mono"
              style={{ color: "var(--accent-encrypted)" }}
            >
              reveal_performance
            </span>{" "}
            to produce the first attestation — the MPC cluster then
            reveals only the aggregate value, not the underlying
            balances.
          </>
        ) : (
          <>
            MPC-attested at slot{" "}
            <span className="font-mono tabular-nums">{slot}</span>.
            {stale && (
              <>
                {" "}
                <span style={{ color: "var(--accent-warning)" }}>
                  Flag: <strong>nav_stale</strong>
                </span>{" "}
                — a rebalance has occurred since this attestation; a
                fresh reveal is pending before deposits/withdrawals
                re-enable.
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DisclosureColumn({
  heading,
  accent,
  items,
}: {
  heading: string;
  accent: "revealed" | "encrypted";
  items: string[];
}) {
  const symbol = accent === "revealed" ? "✓" : "✗";
  const color =
    accent === "revealed"
      ? "var(--accent-revealed)"
      : "var(--accent-encrypted)";

  return (
    <div>
      <div
        className="text-[10px] tracking-[0.22em] uppercase mb-4"
        style={{ color: "var(--text-tertiary)" }}
      >
        {heading}
      </div>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-baseline gap-3 text-[13px] leading-relaxed"
            style={{ color: "var(--text-primary)" }}
          >
            <span
              className="font-mono text-[13px] shrink-0"
              style={{ color }}
            >
              {symbol}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddressCell({
  label,
  value,
  cluster,
}: {
  label: string;
  value: string;
  cluster: string;
}) {
  const href = `https://explorer.solana.com/address/${value}?cluster=${cluster}`;
  const short = value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group"
    >
      <div
        className="text-[9.5px] tracking-[0.22em] uppercase mb-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-[12px] tabular-nums transition-colors group-hover:underline"
        style={{ color: "var(--text-primary)" }}
      >
        {short} ↗
      </div>
    </a>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono text-sm"
      style={{ color: "var(--accent-danger)" }}
    >
      {children}
    </div>
  );
}
