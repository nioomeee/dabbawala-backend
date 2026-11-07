/**
 * Hedera denomination constants and integer-safe conversions (unit freeze).
 *
 * Canonical scale: 1 HBAR = 100,000,000 tinybars; tinybar is the smallest
 * atomic unit; microbar ("microHbar" in this codebase) = 100 tinybars.
 * VERIFIED against the official Hedera docs (fetched 2026-11-06):
 * https://docs.hedera.com/support/faq/hbar.md — "1 HBAR = 100,000,000 tinybars"
 * (denominations: tinybar, microbar, millibar, HBAR). Recorded in
 * REFERENCES.md section 9; ref: R-HE-* for Hedera SDK usage.
 *
 * All arithmetic is BigInt on integer strings — no floating point
 * (AGENTS.md §8; SECURITY.md "Integer-safe calculations").
 */

/** 1 microbar = 100 tinybars (10^-6 HBAR = 100 × 10^-8 HBAR). */
export const TINYBARS_PER_MICROBAR = 100n;

/**
 * microbar integer string -> atomic tinybars integer string.
 * Throws on non-integer input so read boundaries stay fail-closed
 * (callers convert the throw to 503 ENS_UNREADABLE).
 */
export function microbarsToTinybarsAtomic(microbarsAtomic: string): string {
  if (!/^\d+$/.test(microbarsAtomic)) {
    throw new Error(`HEDERA_UNIT_ERROR: microbar amount is not a non-negative integer: ${microbarsAtomic}`);
  }
  return (BigInt(microbarsAtomic) * TINYBARS_PER_MICROBAR).toString();
}

/**
 * atomic tinybars integer string -> microbar integer string.
 * Exact for values derived from microbar records (the only source in this
 * API); floors otherwise.
 */
export function tinybarsAtomicToMicrobars(tinybarsAtomic: string): string {
  if (!/^\d+$/.test(tinybarsAtomic)) {
    throw new Error(`HEDERA_UNIT_ERROR: tinybar amount is not a non-negative integer: ${tinybarsAtomic}`);
  }
  return (BigInt(tinybarsAtomic) / TINYBARS_PER_MICROBAR).toString();
}
