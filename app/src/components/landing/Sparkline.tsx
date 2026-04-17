/**
 * Inline SVG sparkline. Deterministic from a seed string so each stat
 * gets a stable, distinct visual signature without runtime randomness.
 *
 * Intentionally minimal: no axes, no fill, no interaction. The chart is
 * a visual rhythm cue, not a data vehicle — the headline number carries
 * the content.
 */
function seededRandom(seed: string, i: number): number {
  // FNV-ish hash; deterministic, fast, good enough for shape generation.
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) {
    h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function Sparkline({
  seed,
  points = 24,
  width = 120,
  height = 32,
  trend = "neutral",
}: {
  seed: string;
  points?: number;
  width?: number;
  height?: number;
  trend?: "up" | "down" | "neutral";
}) {
  const values = Array.from({ length: points }, (_, i) => {
    const rand = seededRandom(seed, i);
    // apply a gentle trend bias so up/down sparklines look directional
    const biasPerStep =
      trend === "up" ? i * 0.02 : trend === "down" ? -i * 0.02 : 0;
    return 0.5 + (rand - 0.5) * 0.6 + biasPerStep;
  });

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const path = values
    .map((v, i) => {
      const x = (i / (points - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const color =
    trend === "up"
      ? "var(--accent-revealed)"
      : trend === "down"
        ? "var(--accent-danger)"
        : "var(--accent-encrypted)";

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d={path} stroke={color} strokeWidth="1" opacity="0.8" />
    </svg>
  );
}
