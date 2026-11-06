/**
 * Hedera x402 types and interfaces.
 *
 * Ref: R-HE-4 (exact-scheme spec), R-HE-5 (Hiero SDK docs)
 *
 * IMPORTANT: All technical claims are cited from official Hedera documentation (R-HE-*).
 * F10: @x402/hedera NOT on npm — using Hiero SDK (Strategy B).
 */

import { z } from "zod";

// ── Constant: Hedera Testnet USDC (verified F12) ───────────────────────────────

/** Hedera testnet USDC token ID (F12: 0.0.6001, 6 decimals) */
export const HEDERA_TESTNET_USDC = "0.0.6001" as const;

// ── x402 Exact-Scheme (per R-HE-4) ────────────────────────────────────────────

/**
 * The x402 exact-scheme as defined by Hedera AI x402 documentation.
 * Ref: https://docs.hedera.com/solutions/ai/x402/exact-scheme
 */
export const X402ExactSchemeSchema = z.object({
  network: z.literal("hedera:testnet"),
  asset: z.string().default(HEDERA_TESTNET_USDC),
  amount: z.string().min(1, "amount required"),
  fee: z.string().min(1, "fee required"),
  payTo: z.string().min(1, "payTo required"),
  expiry: z.string().optional(),
  memo: z.string().optional(),
  royaltyRecipient: z.string().optional(),
  royaltyMaxFee: z.string().optional(),
  royaltyFeeSimple: z.boolean().optional(),
  royaltyPercentageNumerator: z.number().optional(),
  royaltyPercentageDenominator: z.number().optional(),
});

export type X402ExactScheme = z.infer<typeof X402ExactSchemeSchema>;

// ── Payment Result ───────────────────────────────────────────────────────────

export interface PaymentResult {
  /** Transaction ID: "0.0.12345678-1234567890.0.0.0" */
  transactionId: string;
  /** The exact-scheme that was signed */
  scheme: X402ExactScheme;
  /** Whether confirmed by Mirror Node */
  confirmed: boolean;
  /** Node status summary */
  nodeStatus?: string;
}

// ── HCS Spend Log Entry ───────────────────────────────────────────────────────

export interface SpendLogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Ledger epoch */
  ledgerTime: number;
  /** Robot ID */
  robotId: string;
  /** Route intel leg ID */
  legId: string;
  /** Amount in atomic units */
  amount: string;
  /** Hedera tx ID */
  transactionId: string;
  /** Policy block number */
  policyBlock: bigint;
  /** Policy values hash */
  policyHash: string;
  /** Optional memo */
  memo?: string;
}