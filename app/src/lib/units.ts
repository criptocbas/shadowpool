/**
 * Number-formatting helpers for the vault UI.
 *
 * Kept pure and dependency-free so they can be unit-tested in isolation
 * and reused across components.
 */

/** USDC (quote) has 6 decimals on Solana. */
export const QUOTE_DECIMALS = 6;

/** Share tokens are minted with 9 decimals by the program. */
export const SHARE_DECIMALS = 9;

/**
 * Parse a user-typed decimal string into raw on-chain units (as bigint),
 * without floating-point drift.
 *
 * - Returns `null` for unparseable input.
 * - Splits on `.`, pads the fractional part to `decimals` places, then
 *   composes via BigInt so "1.234567" * 10^6 -> 1_234_567n exactly.
 * - Extra fractional digits beyond `decimals` are truncated, not rounded.
 */
export function toRawUnits(
  displayAmount: string,
  decimals: number
): bigint | null {
  const trimmed = displayAmount.trim();
  if (!trimmed || isNaN(Number(trimmed))) return null;
  const [intPart, fracPart = ""] = trimmed.split(".");
  const paddedFrac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  try {
    return (
      BigInt(intPart || "0") * BigInt(10 ** decimals) +
      BigInt(paddedFrac || "0")
    );
  } catch {
    return null;
  }
}
