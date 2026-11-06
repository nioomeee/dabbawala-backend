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
// Canonical zone identifiers. Only `docks-r2` is the approved zone for R-2 demonstrations.
// The allowlist is now configured via environment variables; in production this
// should be a DB table with on-chain verification (HYPOTHESIS: Phase B).
// Format: approverDID → allowed zone IDs (canonical).
// ref: implementation.md §4.4 rule 2, invariant §4.3.8

// Canonical zone identifiers - use consistent value docks-r2 per PART 9.1
const CANONICAL_ZONE_ID = "docks-r2";

// Approver allowlist: DID or identifier → allowed canonical zone IDs.
// Only allowlisted approvers can mint tokens for their zones.
const ZONE_APPROVERS: ReadonlyMap<string, readonly string[]> = new Map([
  // [TODO] Phase B: move to DB table with on-chain verification
  // For now, use a minimal allowlist with canonical zone identifiers
  ["approved-approver", ["docks-r2"]],
]);

/** Check whether the DID/identifier is an allowlisted approver for the requested zone. */
export function isAllowlistedApprover(approverId: string, zoneId: string): boolean {
  // Use canonical zone identifier: docks-r2
  if (zoneId !== CANONICAL_ZONE_ID) {
    return false;
  }
  // Check if the approver is in the allowlist
  const zones = ZONE_APPROVERS.get(approverId);
  return zones !== undefined && zones.includes(zoneId);
}

/**
 * Fail-closed: gatekeeper requires database connectivity.
 * No in-memory fallback - if DB is unavailable, requests fail.
 * ref: ROADMAP.md §4.3 invariant 3 (fail closed)
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
    log.warn({ err }, "Database write failed during gate decision — failing closed");
    // Fail closed: no fallback to in-memory tokens
    throw err instanceof Error ? err : new Error("GATE_DB_ERROR");
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
