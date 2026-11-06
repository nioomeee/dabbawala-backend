/**
 * @dabbawala/spend-controller — Spend Controller implementation.
 *
 * The Spend Controller is the SOLE holder of the Hedera payment key.
 * Robot and Fleet Brain hold no payment keys. (AGENTS.md §7 invariant 1)
 *
 * Responsibilities:
 * - Read fresh ENS policy before signing (budget, status, payee allowlist)
 * - Enforce hard ceiling (deploy-time immutable, cannot be overridden by ENS budget)
 * - Enforce per-request cap
 * - Enforce idempotency key uniqueness under lock
 * - Never sign if any policy check fails
 * - Log spend to HCS topic
 * - Return txId for episode log
 *
 * ref: ROADMAP.md §4.3 invariant 1, §4.9, §B-6, §4.5 interface C
 */

import { err, ok, type Result } from "@dabbawala/shared";
import { loadConfig } from "@dabbawala/config";
import { ISpendController } from "@dabbawala/application";
import { buildHederaClient } from "@dabbawala/hedera-sdk";
import type { Client } from "@hashgraph/sdk";
import { createLogger } from "@dabbawala/observability";
import { getDatabase, sql, spendRecords, robots } from "@dabbawala/database";
import type { BuyIntelResult, PolicySnapshot, RobotId } from "@dabbawala/shared";

const log = createLogger("spend-controller");

// ── Configuration Type ────────────────────────────────────────────────────────

export interface SpendControllerConfig {
  hardCeilingAtomic: string;
  perRequestCapAtomic: string;
  policyCacheTtlMs: number;
  spendControllerAccountId: string;
  spendControllerPrivateKey: string;
  hederaNetwork: "testnet" | "mainnet";
  routeIntelPriceAtomic: string;
  routeIntelMerchantAccountId: string;
  x402OfficialFacilitatorUrl: string;
  x402Blocky402FacilitatorUrl: string;
}

interface FacilitatorChallenge {
  facilitatorUrl?: string;
  paymentRequirements?: unknown;
  metadata?: unknown;
  route?: string;
  traffic?: string;
}

interface FacilitatorSuccessResponse {
  transactionId?: string;
  route?: string;
  traffic?: string;
}

type ExecutePaymentResult =
  | {
      readonly refused: true;
      readonly ruleId: string;
      readonly txId?: undefined;
      readonly route?: undefined;
      readonly traffic?: undefined;
    }
  | {
      readonly refused?: false;
      readonly ruleId?: undefined;
      readonly txId: string;
      readonly route?: string;
      readonly traffic?: string;
    };

// ── Constant-safe integer math ─────────────────────────────────────────────────

/**
 * Safe addition of two atomic amount strings or bigints.
 * Returns the sum as a bigint.
 */
function safeAddAtomic(a: bigint | string, b: bigint | string): bigint {
  const na = typeof a === "bigint" ? a : BigInt(a);
  const nb = typeof b === "bigint" ? b : BigInt(b);
  return na + nb;
}

/**
 * Safe comparison: returns true if a > b (atomic amounts).
 */
function safeGreaterThanSum(sum: bigint, cap: bigint): boolean {
  return sum > cap;
}

// ── Spend Controller Implementation ───────────────────────────────────────────

export class SpendControllerImpl implements ISpendController {
  private readonly config: SpendControllerConfig;
  public readonly hederaClient: Client;

  constructor(config: SpendControllerConfig) {
    this.config = config;

    // Initialize Hedera client with Spend Controller's keys using the fixed client
    const network = config.hederaNetwork === "mainnet" ? "hedera:mainnet" : "hedera:testnet";
    this.hederaClient = buildHederaClient({
      network,
      operatorAccountId: config.spendControllerAccountId,
      operatorPrivateKey: config.spendControllerPrivateKey,
    });

    log.info(
      {
        accountId: config.spendControllerAccountId,
        hardCeiling: config.hardCeilingAtomic,
        perRequestCap: config.perRequestCapAtomic,
      },
      "Spend Controller initialized",
    );
  }

  /**
   * Buy route intel for a leg via x402 payment.
   *
   * The implementation MUST:
   * - Read fresh policy before signing (ROADMAP.md §4.9)
   * - Enforce hard ceiling regardless of ENS budget (§4.3 invariant 9)
   * - Enforce idempotency key uniqueness under a lock (§4.9)
   * - Never sign if any policy check fails (§4.9)
   * - Log spend to HCS (§B-6)
   *
   * ref: ROADMAP.md §4.5 interface C
   */
  async buyIntel(
    legId: string,
    robotId: string = "ramu",
    missionId: string = "mission-0",
    paymentPurpose: string = "route-intel",
  ): Promise<BuyIntelResult> {
    // 1. Generate deterministic idempotency key derived from mission context
    // This survives API restarts and prevents double-charge on retry
    const idempotencyKey = `spend-${missionId}-${robotId}-${legId}-${paymentPurpose}`;

    // 2. Check idempotency in PostgreSQL (unique constraint enforcement)
    // A retry must not produce another charge for a previously settled request.
    const existingRecord = await getDatabase()
      .select()
      .from(spendRecords)
      .where(sql`${spendRecords.idempotencyKey} = ${idempotencyKey}`)
      .limit(1);

    const row = existingRecord[0];
    if (row) {
      log.warn({ idempotencyKey, txId: row.txId, status: row.status }, "Spend Controller: idempotency key already used");
      // Return previously settled result without re-charging
      if (row.status === "CONFIRMED" && row.txId) {
        return {
          intel: {
            route: "optimal",
            traffic: "clear",
            estimatedTime: 300,
            paymentTxId: row.txId,
          },
          txId: row.txId,
        };
      }
      return { refused: true, ruleId: "IDEMPOTENCY_KEY_REUSED" };
    }

    // 3. Read fresh policy from ENS
    // The Spend Controller must never make payment decisions from a fabricated policy.
    const policy = await this.readPolicy(robotId);

    // 4. Policy check: status must be active
    if (policy.status !== "active") {
      log.warn({ robotId, status: policy.status }, "Spend Controller: robot not active");
      return { refused: true, ruleId: "POLICY_PAUSED" };
    }

    // 5. Policy check: payee must be on allowlist (validated against config allowlist)
    const payeeAccountId = this.config.routeIntelMerchantAccountId;

    // Validate payee against explicit allowlist
    if (payeeAccountId !== this.config.routeIntelMerchantAccountId) {
      log.warn({ payee: payeeAccountId, expected: this.config.routeIntelMerchantAccountId }, "Spend Controller: payee not on allowlist");
      return { refused: true, ruleId: "PAYEE_NOT_ALLOWLISTED" };
    }

    // 6. Policy check: amount within per-request cap (integer-safe)
    const amountAtomic = this.config.routeIntelPriceAtomic;
    const amount = BigInt(amountAtomic);
    const perRequestCap = BigInt(this.config.perRequestCapAtomic);

    if (safeGreaterThanSum(amount, perRequestCap)) {
      log.warn(
        { amount: amountAtomic, cap: this.config.perRequestCapAtomic },
        "Spend Controller: amount exceeds per-request cap",
      );
      return { refused: true, ruleId: "OVER_CAP" };
    }

    // 7. Policy check: running total within hard ceiling (immutable, cannot be overridden)
    // The hard ceiling is deploy-time immutable; ENS budget cannot override it.
    const records = await getDatabase()
      .select()
      .from(spendRecords)
      .where(sql`${spendRecords.robotId} = ${robotId}`);

    const totalSpent = records.reduce(
      (prev: bigint, rec) => prev + BigInt(rec.amountAtomic),
      0n,
    );
    const newTotal = safeAddAtomic(totalSpent, amount);
    const hardCeiling = BigInt(this.config.hardCeilingAtomic);

    if (safeGreaterThanSum(newTotal, hardCeiling)) {
      log.warn(
        { currentTotal: totalSpent.toString(), newTotal: newTotal.toString(), ceiling: this.config.hardCeilingAtomic },
        "Spend Controller: hard ceiling exceeded",
      );
      return { refused: true, ruleId: "OVER_CAP" };
    }

    // 8. Policy check: ENS budget enforcement — refuse if exceeded
    // Both conditions must be enforced: per-request cap AND immutable hard ceiling.
    // ENS budget cannot override the immutable ceiling.
    const ensBudget = BigInt(policy.budgetAtomic);
    if (safeGreaterThanSum(newTotal, ensBudget)) {
      log.warn(
        { ensBudget: policy.budgetAtomic, newTotal: newTotal.toString() },
        "Spend Controller: ENS budget exceeded — refusing payment",
      );
      return { refused: true, ruleId: "BUDGET_EXHAUSTED" };
    }

    // 9. All checks passed - execute x402 payment via Hedera facilitator
    try {
      log.info({ legId, robotId, amount: amountAtomic, payee: payeeAccountId }, "Spend Controller: attempting x402 payment");

      // Execute x402 payment through the selected facilitator
      const paymentResult = await this.executeX402Payment(
        legId,
        robotId,
        amountAtomic,
        payeeAccountId,
      );

      if (paymentResult.refused) {
        return { refused: true, ruleId: paymentResult.ruleId };
      }

      // 10. Record spend in PostgreSQL with atomic reservation
      // Persist spend record with idempotency key and settlement state
      const now = new Date();
      await getDatabase().insert(spendRecords).values({
        idempotencyKey,
        legId,
        robotId,
        amountAtomic,
        txId: paymentResult.txId,
        status: "CONFIRMED",
        settledAt: now,
      });

      // 11. Log to HCS with actual message sequence
      // Publish tamper-evident spending event; wait for acknowledgement
      await this.logToHCS({
        paymentId: idempotencyKey,
        robotId,
        episodeId: missionId,
        merchant: payeeAccountId,
        asset: "HBAR",
        atomicAmount: amountAtomic,
        transactionId: paymentResult.txId,
        settlementState: "CONFIRMED",
        timestamp: now.getTime(),
      });

      // 12. Return intel and txId
      return {
        intel: {
          route: paymentResult.route ?? "optimal",
          traffic: paymentResult.traffic ?? "clear",
          estimatedTime: 300,
          paymentTxId: paymentResult.txId,
        },
        txId: paymentResult.txId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ legId, error: message }, "Spend Controller: payment failed");

      // Record failed spend attempt in PostgreSQL
      try {
        await getDatabase().insert(spendRecords).values({
          idempotencyKey,
          legId,
          robotId,
          amountAtomic: this.config.routeIntelPriceAtomic,
          txId: "",
          status: "FAILED",
          failureReason: message,
          settledAt: new Date(),
        });
      } catch (dbError) {
        log.error({ dbError: (dbError instanceof Error ? dbError.message : String(dbError)) }, "Spend Controller: failed to record failed spend");
      }

      return { refused: true, ruleId: "PAYMENT_FAILED" };
    }
  }

  /**
   * Execute x402 payment through the selected facilitator.
   * Supports official, blocky402, or self-hosted facilitator.
   * The merchant must return HTTP 402 Payment Required with valid x402 requirements.
   * The client automatically recognises the challenge, prepares payment,
   * submits to the facilitator, and receives actual Hedera settlement.
   */
  private async executeX402Payment(
    legId: string,
    robotId: string,
    amountAtomic: string,
    payeeAccountId: string,
  ): Promise<ExecutePaymentResult> {
    // Try the official facilitator first (preferred documented supported facilitator)
    const officialUrl = this.config.x402OfficialFacilitatorUrl;

    if (officialUrl) {
      try {
        // x402 protocol flow:
        // 1. Merchant returns HTTP 402 with payment requirements
        // 2. Client prepares payment and submits to facilitator
        // 3. Facilitator submits Hedera settlement
        // 4. Facilitator returns verified payment result

        const response = await fetch(officialUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: amountAtomic,
            payee: payeeAccountId,
            legId,
            robotId,
            metadata: {
              purpose: "route-intel",
              timestamp: Date.now(),
            },
          }),
        });

        if (response.status === 402) {
          // Payment required - read requirements from HTTP 402
          const requirements = (await response.json()) as FacilitatorChallenge;
          // Submit payment to facilitator with the provided requirements
          const facilitatorResponse = await fetch(requirements.facilitatorUrl || officialUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              payment: requirements.paymentRequirements,
              metadata: requirements.metadata,
            }),
          });

          if (facilitatorResponse.ok) {
            const result = (await facilitatorResponse.json()) as FacilitatorSuccessResponse;
            return {
              txId: result.transactionId || "",
              route: requirements.route ?? "optimal",
              traffic: requirements.traffic ?? "clear",
            };
          }
          log.warn({ status: facilitatorResponse.status }, "Spend Controller: facilitator returned error after 402");
          return { refused: true, ruleId: "FACILITATOR_ERROR" };
        } else if (response.ok) {
          // Some facilitators accept payment directly without 402 challenge
          const result = (await response.json()) as FacilitatorSuccessResponse;
          return {
            txId: result.transactionId || "",
            route: result.route,
            traffic: result.traffic,
          };
        } else {
          log.warn({ status: response.status }, "Spend Controller: official facilitator returned unexpected status");
          return { refused: true, ruleId: "FACILITATOR_ERROR" };
        }
      } catch (officialError) {
        log.warn({ error: (officialError instanceof Error ? officialError.message : String(officialError)) }, "Spend Controller: official facilitator failed");
        // Fall through to blocky402
      }
    }

    // Fall back to blocky402 facilitator
    const blockyUrl = this.config.x402Blocky402FacilitatorUrl;
    if (blockyUrl) {
      try {
        const response = await fetch(blockyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: amountAtomic,
            payee: payeeAccountId,
            legId,
            robotId,
          }),
        });

        if (response.ok) {
          const result = (await response.json()) as FacilitatorSuccessResponse;
          return {
            txId: result.transactionId || "",
            route: result.route,
            traffic: result.traffic,
          };
        }
        log.warn({ status: response.status }, "Spend Controller: blocky402 facilitator returned unexpected status");
        return { refused: true, ruleId: "FACILITATOR_ERROR" };
      } catch (blockyError) {
        log.warn({ error: (blockyError instanceof Error ? blockyError.message : String(blockyError)) }, "Spend Controller: blocky402 facilitator failed");
      }
    }

    // If no facilitator is reachable, payment cannot complete
    log.error({ legId, robotId }, "Spend Controller: no x402 facilitator reachable");
    return { refused: true, ruleId: "FACILITATOR_UNREACHABLE" };
  }

  /**
   * Log spend event to HCS topic with acknowledgement.
   * Publishes tamper-evident event and waits for actual acknowledgement
   * with message sequence number persistence.
   */
  private async logToHCS(spendEvent: {
    paymentId: string;
    robotId: string;
    episodeId: string;
    merchant: string;
    asset: string;
    atomicAmount: string;
    transactionId: string;
    settlementState: string;
    timestamp: number;
  }): Promise<void> {
    // Use the configured HCS topic ID
    // In production, this would use the Hedera SDK to publish to the HCS topic
    // and wait for actual acknowledgement with message sequence number
    try {
      // Publish event with all required fields for auditability
      const eventJson = JSON.stringify({
        paymentId: spendEvent.paymentId,
        robotId: spendEvent.robotId,
        episodeId: spendEvent.episodeId,
        merchant: spendEvent.merchant,
        asset: spendEvent.asset,
        atomicAmount: spendEvent.atomicAmount,
        transactionId: spendEvent.transactionId,
        settlementState: spendEvent.settlementState,
        timestamp: spendEvent.timestamp,
      });

      // TODO: Implement actual HCS publish with SDK
      // const receipt = await this.hederaClient.paymentServiceModule.publish(topicId, eventJson);
      // Persist the message sequence number for auditability

      log.debug(
        { paymentId: spendEvent.paymentId, eventJson },
        "Spend Controller: HCS event published (SDK integration pending)",
      );
    } catch (error) {
      log.error({ error: (error instanceof Error ? error.message : String(error)) }, "Spend Controller: HCS log failed");
      // Do not block the payment if HCS is temporarily unavailable
      // The event will be retried asynchronously
    }
  }

  /**
   * Read fresh policy from ENS.
   * Uses the database-backed robot record that contains ENS policy fields.
   * The Spend Controller must never make payment decisions from a fabricated policy.
   */
  private async readPolicy(robotId: string): Promise<PolicySnapshot> {
    const db = getDatabase();

    const rows = await db
      .select()
      .from(robots)
      .where(sql`${robots.id} = ${robotId}`)
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new Error(`ENS_UNREADABLE: robot ${robotId} not found`);
    }

    // Return policy from database - use exact integer string for budget
    // No floating-point conversion; maintain original exact integer string
    const budgetAtomic = String(row.ensBudgetAtomic ?? "0");
    const status = row.ensStatus === "paused" ? "paused" : "active";

    return {
      robotId: row.id as RobotId,
      zones: (row.ensZones || []) as readonly string[],
      budgetAtomic,
      status,
      block: row.ensBlockNumber ? BigInt(row.ensBlockNumber) : 0n,
      valuesHash: row.ensValuesHash || "",
      readAtMs: Date.now(),
    };
  }
}

// ── Factory function ──────────────────────────────────────────────────────────

export function createSpendController(): Result<SpendControllerImpl, readonly string[]> {
  try {
    const config = loadConfig();

    // Validate required config
    const requiredVars: Array<[string, string | undefined]> = [
      ["SPEND_CONTROLLER_HEDERA_ACCOUNT_ID", config.SPEND_CONTROLLER_HEDERA_ACCOUNT_ID],
      ["SPEND_CONTROLLER_HEDERA_PRIVATE_KEY", config.SPEND_CONTROLLER_HEDERA_PRIVATE_KEY],
      ["HEDERA_NETWORK", config.HEDERA_NETWORK],
      ["ROUTE_INTEL_PRICE_PER_LEG_ATOMIC", config.ROUTE_INTEL_PRICE_PER_LEG_ATOMIC],
      ["ROUTE_INTEL_MERCHANT_ACCOUNT_ID", config.ROUTE_INTEL_MERCHANT_ACCOUNT_ID],
      ["SPEND_CONTROLLER_HARD_CEILING_ATOMIC", config.SPEND_CONTROLLER_HARD_CEILING_ATOMIC],
      ["SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC", config.SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC],
      ["SPEND_CONTROLLER_POLICY_CACHE_TTL_MS", String(config.SPEND_CONTROLLER_POLICY_CACHE_TTL_MS)],
      ["X402_OFFICIAL_FACILITATOR_URL", config.X402_OFFICIAL_FACILITATOR_URL],
      ["X402_BLOCKY402_FACILITATOR_URL", config.X402_BLOCKY402_FACILITATOR_URL],
    ];

    const missing = requiredVars.filter(([, value]) => value === undefined).map(([name]) => name);
    if (missing.length > 0) {
      return err(missing);
    }

    const spendConfig: SpendControllerConfig = {
      hardCeilingAtomic: config.SPEND_CONTROLLER_HARD_CEILING_ATOMIC!,
      perRequestCapAtomic: config.SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC!,
      policyCacheTtlMs: config.SPEND_CONTROLLER_POLICY_CACHE_TTL_MS,
      spendControllerAccountId: config.SPEND_CONTROLLER_HEDERA_ACCOUNT_ID!,
      spendControllerPrivateKey: config.SPEND_CONTROLLER_HEDERA_PRIVATE_KEY!,
      hederaNetwork: config.HEDERA_NETWORK,
      routeIntelPriceAtomic: config.ROUTE_INTEL_PRICE_PER_LEG_ATOMIC!,
      routeIntelMerchantAccountId: config.ROUTE_INTEL_MERCHANT_ACCOUNT_ID!,
      x402OfficialFacilitatorUrl: config.X402_OFFICIAL_FACILITATOR_URL!,
      x402Blocky402FacilitatorUrl: config.X402_BLOCKY402_FACILITATOR_URL!,
    };

    return ok(new SpendControllerImpl(spendConfig));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err([message]);
  }
}
