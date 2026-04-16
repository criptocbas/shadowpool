"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Drive a mutation of a hex string at `interval` ms so on-screen
 * ciphertexts shimmer as if the underlying account was being rewritten
 * in real time. Purely cosmetic — the source string itself is the
 * authoritative on-chain value.
 */
function useShimmeringHex(base: string, interval: number) {
  const mutate = useCallback(() => {
    const chars = "0123456789abcdef";
    const arr = base.split("");
    const idx = Math.floor(Math.random() * arr.length);
    arr[idx] = chars[Math.floor(Math.random() * 16)];
    return arr.join("");
  }, [base]);

  const [hex, setHex] = useState(base);
  useEffect(() => {
    const id = setInterval(() => setHex(mutate()), interval);
    return () => clearInterval(id);
  }, [mutate, interval]);
  return hex;
}

/**
 * A labeled encrypted-state field shown in the dashboard's encrypted
 * panel. Renders a truncated ciphertext in the encrypted-accent color
 * with a shimmer animation proportional to `index`.
 */
export function EncryptedField({
  label,
  baseHex,
  index,
}: {
  label: string;
  baseHex: string;
  index: number;
}) {
  const hex = useShimmeringHex(baseHex, 80 + index * 20);
  return (
    <div
      className="cipher-shimmer py-2"
      style={{ animationDelay: `${index * 0.3}s` }}
    >
      <div
        className="text-[10px] font-mono uppercase tracking-wider mb-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-xs tracking-widest break-all leading-relaxed"
        style={{ color: "var(--accent-encrypted)" }}
      >
        0x{hex}
      </div>
    </div>
  );
}
