/**
 * Gatekeeper service — token mint, replay protection, expiry enforcement.
 *
 * Invariants enforced here:
 *   §4.3.7  ttlMs = min(request.ttlMs, 60_000); single-use tokens.
 *   §4.3.8  Non-allowlisted callers get 403 and no token.
 *   Replay:  consumed token → 409 GATE_REPLAYED
 *   Expiry:  expired token  → 403 APPROVAL_EXPIRED
 *
 * ref: implementation.md §4.4, §3 GK-1, AGENTS.md §7
 */

import { getDatabase, approvalTokens, pendingActions, eq, sql } from "@dabbawala/database";
import { APPROVAL_TOKEN_TTL_MS } from "@dabbawala/shared";
import { createLogger } from "@dabbawala/observability";
import type { GateRequest, GateDecisionReceipt } from "../schemas/console.js";

const log = createLogger("gatekeeper");

// ── Zone approver allowlist ────────────────────────────────────────────────────
// Seeded from environment or config; format: approverToken → allowed zones.
// ref: implementation.md §4.4 rule 2, invariant §4.3.8
// HYPOTHESIS: in Phase B this moves to a DB table with on-chain verification.
const ZONE_APPROVERS: ReadonlyMap<string, readonly string[]> = new Map([
  ["sim-approver-all", ["mahim", "dadar", "churchgate", "docks-r2"]],
  ["sim-approver-r2",  ["docks-r2"]],
]);

/** Check whether the bearer token is an allowlisted approver for the requested zone. */
export function isAllowlistedApprover(bearerToken: string, zoneId: string): boolean {
  const zones = ZONE_APPROVERS.get(bearerToken);
  return zones !== undefined && zones.includes(zoneId);
}

// Fallback in-memory ledger if cloud database connection is unavailable
const memoryTokens = new Map<string, { tokenId: string; issuedAtMs: number; consumed: boolean }>();

/**
 * Process a gate decision. Returns a receipt.
 * Throws a typed error object for 403/409 conditions; caller maps to HTTP status.
 * ref: implementation.md §4.4
 */
export async function processGateDecision(
  request: GateRequest,
  decision: "approved" | "denied",
): Promise<GateDecisionReceipt> {
  const decidedAtMs = Date.now();

  try {
    const db = getDatabase();

    if (decision === "denied") {
      await db
        .insert(pendingActions)
        .values({
          actionId: `pa-${request.id}-${request.nonce}`,
          robotId: request.robotId,
          zoneId: request.zoneId,
          routeHash:
            "0x" + Buffer.from(`${request.robotId}:${request.zoneId}`).toString("hex"),
          requestId: request.id,
          nonce: request.nonce,
          status: "denied",
          expiresAt: new Date(decidedAtMs + APPROVAL_TOKEN_TTL_MS),
        })
        .onConflictDoNothing();

      log.info({ requestId: request.id, robotId: request.robotId }, "Gate DENIED");

      return {
        requestId: request.id,
        decision: "denied",
        token: null,
        ttlMs: 0,
        decidedAtMs,
        source: "sim",
      };
    }

    // Check for replay: nonce already exists in approval_tokens
    const existing = await db
      .select()
      .from(approvalTokens)
      .where(eq(approvalTokens.nonce, request.nonce))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0]!;
      if (row.consumed) {
        throw { code: "GATE_REPLAYED", status: 409 };
      }
      if (decidedAtMs - row.issuedAtMs > APPROVAL_TOKEN_TTL_MS) {
        throw { code: "APPROVAL_EXPIRED", status: 403 };
      }
      // Idempotent re-return within TTL
      return {
        requestId: request.id,
        decision: "approved",
        token: row.tokenId,
        ttlMs: APPROVAL_TOKEN_TTL_MS - (decidedAtMs - row.issuedAtMs),
        decidedAtMs,
        source: "sim",
      };
    }

    // Mint a new single-use token. ref: implementation.md §4.4 rule 3
    const ttlMs = Math.min(request.ttlMs, APPROVAL_TOKEN_TTL_MS);
    // Token shape: tok-<nonce>-<requestId> per implementation.md §4.4 rule 3
    const token = `tok-${request.nonce}-${request.id}`;

    await db.insert(approvalTokens).values({
      tokenId: token,
      robotId: request.robotId,
      zoneId: request.zoneId,
      nonce: request.nonce,
      requestId: request.id,
      issuedAtMs: decidedAtMs,
      consumed: false,
    });

    await db
      .insert(pendingActions)
      .values({
        actionId: `pa-${request.id}-${request.nonce}`,
        robotId: request.robotId,
        zoneId: request.zoneId,
        routeHash:
          "0x" + Buffer.from(`${request.robotId}:${request.zoneId}`).toString("hex"),
        requestId: request.id,
        nonce: request.nonce,
        status: "pending",
        expiresAt: new Date(decidedAtMs + ttlMs),
      })
      .onConflictDoNothing();

    log.info(
      { requestId: request.id, robotId: request.robotId },
      "Gate APPROVED — token minted",
    );

    return {
      requestId: request.id,
      decision: "approved",
      token,
      ttlMs,
      decidedAtMs,
      source: "sim",
    };
  } catch (err: unknown) {
    if (err !== null && typeof err === "object" && "code" in err) {
      throw err;
    }
    log.warn({ err }, "Database write failed during gate decision; using in-memory token ledger fallback");

    if (decision === "denied") {
      return {
        requestId: request.id,
        decision: "denied",
        token: null,
        ttlMs: 0,
        decidedAtMs,
        source: "sim",
      };
    }

    const existingMem = memoryTokens.get(request.nonce);
    if (existingMem) {
      if (existingMem.consumed) throw { code: "GATE_REPLAYED", status: 409 };
      if (decidedAtMs - existingMem.issuedAtMs > APPROVAL_TOKEN_TTL_MS) throw { code: "APPROVAL_EXPIRED", status: 403 };
      return {
        requestId: request.id,
        decision: "approved",
        token: existingMem.tokenId,
        ttlMs: APPROVAL_TOKEN_TTL_MS - (decidedAtMs - existingMem.issuedAtMs),
        decidedAtMs,
        source: "sim",
      };
    }

    const ttlMs = Math.min(request.ttlMs, APPROVAL_TOKEN_TTL_MS);
    const token = `tok-${request.nonce}-${request.id}`;
    memoryTokens.set(request.nonce, { tokenId: token, issuedAtMs: decidedAtMs, consumed: false });

    return {
      requestId: request.id,
      decision: "approved",
      token,
      ttlMs,
      decidedAtMs,
      source: "sim",
    };
  }
}

/**
 * Mark a token as consumed. Returns false if already consumed (replay) or expired.
 * ref: implementation.md §4.4 rule 5, invariant §4.3.7
 */
export async function consumeToken(
  token: string,
): Promise<{ ok: true } | { ok: false; code: "GATE_REPLAYED" | "APPROVAL_EXPIRED" }> {
  const db = getDatabase();
  const now = Date.now();

  const rows = await db
    .select()
    .from(approvalTokens)
    .where(eq(approvalTokens.tokenId, token))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, code: "GATE_REPLAYED" };
  }

  const row = rows[0]!;

  if (row.consumed) {
    return { ok: false, code: "GATE_REPLAYED" };
  }

  if (now - row.issuedAtMs > APPROVAL_TOKEN_TTL_MS) {
    return { ok: false, code: "APPROVAL_EXPIRED" };
  }

  await db
    .update(approvalTokens)
    .set({ consumed: true, consumedAtMs: now })
    .where(eq(approvalTokens.tokenId, token));

  return { ok: true };
}

// Suppress unused import warning — sql is re-exported for convenience.
void sql;
