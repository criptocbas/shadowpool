import { ImageResponse } from "next/og";

/**
 * Programmatic favicon. Next automatically serves this at /icon
 * and picks it over the stock favicon.ico. 32×32 is the standard
 * browser favicon size.
 *
 * Design: the "encrypted dot" — a cyan disc on the deep-bg dark,
 * matching the brand mark used in the site nav.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // brand bg-deep (~oklch 0.11), approx in sRGB
          background: "#16171f",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            // accent-encrypted (~oklch 0.55 0.12 200)
            background: "#4fa8c4",
            boxShadow: "0 0 8px #4fa8c4",
          }}
        />
      </div>
    ),
    size,
  );
}
