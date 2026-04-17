import { ImageResponse } from "next/og";

/**
 * Social-preview card. 1200×630 (the canonical OG size). Rendered
 * dynamically via Next's OG API — Satori-based so the layout is
 * constrained to a flex-only subset of CSS, but everything here
 * stays within that surface.
 *
 * Design note: the two reveal words ("encrypted.", "yours.") get
 * serif-italic treatment in the live site via Instrument Serif.
 * Satori ships with Noto Sans only by default; loading Instrument
 * Serif here would need an explicit font fetch (bundled or remote).
 * For an OG card the default serif fallback reads cleanly enough
 * — the accent colors and composition carry the brand more than
 * the exact typeface at this size. Upgrade to bundled Instrument
 * Serif later if the OG card becomes load-bearing on the deck.
 */

export const alt =
  "ShadowPool — Confidential execution layer for Solana. Strategy stays encrypted in Arcium MPC; execution stays yours.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px",
          // brand bg-deep + subtle accent-encrypted radial
          background:
            "radial-gradient(ellipse 60% 70% at 70% 40%, rgba(79,168,196,0.06), transparent 70%), #16171f",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Top row: brand dot + wordmark + URL */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: "#4fa8c4",
              boxShadow: "0 0 10px #4fa8c4",
            }}
          />
          <span
            style={{
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 22,
              letterSpacing: "0.25em",
              color: "#e9ebef",
              fontWeight: 500,
            }}
          >
            SHADOWPOOL
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 14,
              letterSpacing: "0.22em",
              color: "rgba(255,255,255,0.4)",
              textTransform: "uppercase",
            }}
          >
            v0.1.0-alpha · devnet
          </span>
        </div>

        {/* Middle: editorial headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 16,
              letterSpacing: "0.28em",
              color: "#4fa8c4",
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            · Confidential execution layer · Solana
          </span>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontSize: 82,
              fontWeight: 300,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "#f0f1f5",
              gap: "0 18px",
            }}
          >
            <span>Your strategy stays</span>
            <span
              style={{
                fontStyle: "italic",
                color: "#4fa8c4",
                fontFamily: "Georgia, 'Times New Roman', serif",
              }}
            >
              encrypted.
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontSize: 82,
              fontWeight: 300,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "rgba(240,241,245,0.65)",
              gap: "0 18px",
            }}
          >
            <span>Your execution stays</span>
            <span
              style={{
                fontStyle: "italic",
                color: "#6eb78b",
                fontFamily: "Georgia, 'Times New Roman', serif",
              }}
            >
              yours.
            </span>
          </div>
        </div>

        {/* Bottom: sub + tech stack pills */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <div
            style={{
              fontSize: 22,
              lineHeight: 1.45,
              color: "rgba(240,241,245,0.7)",
              maxWidth: 780,
            }}
          >
            Dark-pool execution for Solana. Strategy lives inside Arcium&rsquo;s
            MPC cluster; only quotes reach the chain.
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 14,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            <span>Arcium MPC</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>Pyth Pull</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>Meteora DLMM</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>Token-2022</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
