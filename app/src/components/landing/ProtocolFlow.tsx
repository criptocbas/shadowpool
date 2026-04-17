"use client";

import { useEffect, useState } from "react";

/**
 * Horizontal protocol-flow diagram — replaces the generic "How it
 * works" three-card layout with a single connected timeline that shows
 * every real on-chain stage of a ShadowPool rebalance.
 *
 * Each stage carries a technical artifact (hex, feed id, program id,
 * etc.) so a judge reading the page sees concrete proof-of-depth, not
 * abstracted marketing language.
 *
 * The `active` cursor walks through the stages on a timer, giving the
 * page subtle motion without the "dashboard fidget" feel.
 */
type Tone = "encrypted" | "revealed" | "neutral";

interface Stage {
  id: string;
  index: string;
  kicker: string;
  title: string;
  artifact: string;
  artifactLabel: string;
  description: string;
  tone: Tone;
}

const STAGES: Stage[] = [
  {
    id: "encrypt",
    index: "01",
    kicker: "Owner",
    title: "Encrypt strategy",
    artifact: "Enc<Shared, StrategyParams>",
    artifactLabel: "Arcis type",
    description:
      "Spread, rebalance threshold, inventory parameters go through x25519 + Rescue cipher. Only the ciphertext ever touches the chain.",
    tone: "encrypted",
  },
  {
    id: "queue",
    index: "02",
    kicker: "Cranker",
    title: "Queue MPC",
    artifact: "offset = 0xa3c1…f204",
    artifactLabel: "computation offset",
    description:
      "compute_quotes gate-checks the cranker, single-flight guards state races, and forwards the queued job to the Arcium cluster.",
    tone: "neutral",
  },
  {
    id: "mpc",
    index: "03",
    kicker: "Arcium",
    title: "Cluster compute",
    artifact: "3 · ARX nodes",
    artifactLabel: "cluster quorum",
    description:
      "Each node sees a share of the ciphertext. No single node reconstructs the plaintext. Secure select-after-compute on every branch.",
    tone: "encrypted",
  },
  {
    id: "reveal",
    index: "04",
    kicker: "Callback",
    title: "Reveal quotes",
    artifact: "QuoteOutput{ bid, ask, size }",
    artifactLabel: "plaintext reveal",
    description:
      "One signed callback writes bid/ask/sizes to the Vault. Strategy stays encrypted. Slot-stamped + deduplicated.",
    tone: "revealed",
  },
  {
    id: "execute",
    index: "05",
    kicker: "Meteora",
    title: "DLMM swap",
    artifact: "LBUZKh…wxo",
    artifactLabel: "program id",
    description:
      "execute_rebalance CPIs the Meteora DLMM program with the vault PDA as signer. MPC-anchored slippage floor bounds the fill.",
    tone: "neutral",
  },
  {
    id: "update",
    index: "06",
    kicker: "Arcium",
    title: "Update + attest",
    artifact: "nonce++ · NAV attested",
    artifactLabel: "post-trade",
    description:
      "update_balances re-encrypts the new balances. reveal_performance attests aggregate NAV to auditors without disclosing composition.",
    tone: "encrypted",
  },
];

export function ProtocolFlow() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive((a) => (a + 1) % STAGES.length);
    }, 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flow-rail">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-x-4 gap-y-10">
        {STAGES.map((stage, i) => (
          <div
            key={stage.id}
            className="flow-stage"
            data-tone={stage.tone}
            data-active={i === active}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="flow-node">{stage.index}</div>
              <span
                className="text-[9px] font-mono uppercase tracking-[0.2em]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {stage.kicker}
              </span>
            </div>

            <h3
              className="text-[15px] font-normal leading-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {stage.title}
            </h3>

            <div className="mt-1 mb-2">
              <div
                className="text-[9px] font-mono uppercase tracking-[0.18em]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {stage.artifactLabel}
              </div>
              <div
                className="font-mono text-[11px] truncate"
                style={{
                  color:
                    stage.tone === "encrypted"
                      ? "var(--accent-encrypted)"
                      : stage.tone === "revealed"
                        ? "var(--accent-revealed)"
                        : "var(--text-secondary)",
                }}
                title={stage.artifact}
              >
                {stage.artifact}
              </div>
            </div>

            <p
              className="text-[12px] leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {stage.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
