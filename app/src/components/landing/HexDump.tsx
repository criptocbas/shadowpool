"use client";

import { useEffect, useState } from "react";

/**
 * `xxd`-style hex dump. Row-offset gutter, 4 groups of 4 bytes, with
 * one byte per row randomly "hot" (highlighted in the revealed accent)
 * every tick to evoke "live encryption in progress" without becoming
 * a generic shimmer.
 *
 * Kept deterministic on first render (SSR-safe): the animation mutates
 * state only after `useEffect` fires on the client.
 */
export function HexDump({
  rows = 4,
  bytesPerRow = 16,
  baseOffset = 0x00,
  tickMs = 220,
}: {
  rows?: number;
  bytesPerRow?: number;
  baseOffset?: number;
  tickMs?: number;
}) {
  // Deterministic initial content (so server + first client render match).
  const seedBytes = (rowIdx: number, byteIdx: number): number =>
    ((rowIdx * 131 + byteIdx * 47 + 0x1a) & 0xff);

  const [hotByte, setHotByte] = useState<{ row: number; col: number } | null>(
    null,
  );
  const [bytes, setBytes] = useState<number[][]>(() =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: bytesPerRow }, (_, c) => seedBytes(r, c)),
    ),
  );

  useEffect(() => {
    const id = setInterval(() => {
      const row = Math.floor(Math.random() * rows);
      const col = Math.floor(Math.random() * bytesPerRow);
      setHotByte({ row, col });
      setBytes((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][col] = Math.floor(Math.random() * 256);
        return next;
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [rows, bytesPerRow, tickMs]);

  return (
    <div className="hex-dump">
      {bytes.map((row, rIdx) => (
        <HexRow
          key={rIdx}
          row={row}
          offset={baseOffset + rIdx * bytesPerRow}
          hotCol={hotByte?.row === rIdx ? hotByte.col : null}
        />
      ))}
    </div>
  );
}

function HexRow({
  row,
  offset,
  hotCol,
}: {
  row: number[];
  offset: number;
  hotCol: number | null;
}) {
  return (
    <>
      <span className="hex-dump-offset">
        {offset.toString(16).padStart(4, "0")}:
      </span>
      <span className="flex flex-wrap gap-x-[0.4rem] gap-y-0">
        {row.map((byte, i) => (
          <span key={i} className={`hex-dump-byte${hotCol === i ? " hot" : ""}`}>
            {byte.toString(16).padStart(2, "0")}
          </span>
        ))}
      </span>
    </>
  );
}
