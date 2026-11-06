/**
 * Strict parsing of the model's assistant content into an `Action` PROPOSAL.
 *
 * Model output is untrusted (invariant §4.3.2). This module:
 *   - accepts only a single JSON object (optionally wrapped in exactly one
 *     markdown fence that spans the whole content),
 *   - rejects extra keys, wrong types, arrays, oversize content,
 *   - rejects action types outside the closed set (-> ACTION_NOT_IN_SET),
 *   - re-validates with the frozen shared ActionSchema (second, independent check),
 *   - grounds reroute/ask_human targets in the state offered to the model.
 *
 * "Valid" here means "well-formed and offered". It does NOT mean "approved".
 * Approval is the exclusive job of AI-01's deterministic policy engine
 * (`validateAction` against a fresh PolicySnapshot).
 *
 * Model-originated text is never copied into returned details.
 */

import { z } from "zod";
import {
  ACTION_TYPES,
  ActionSchema,
  err,
  ok,
  type Action,
  type Result,
  type StateSummary,
} from "@dabbawala/shared";
import type { FailureKind } from "./types.js";

const MAX_CONTENT_CHARS = 4_096;
const IDENT = /^[A-Za-z0-9][A-Za-z0-9 _.:/#+-]{0,63}$/;
const ident = z.string().regex(IDENT);

const StrictProposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("continue") }).strict(),
  z.object({ type: z.literal("reroute"), routeId: ident }).strict(),
  z.object({ type: z.literal("handoff") }).strict(),
  z.object({ type: z.literal("ask_human"), zoneId: ident }).strict(),
]);

export interface ProposalFailure {
  readonly kind: Extract<
    FailureKind,
    | "EMPTY_CONTENT"
    | "BAD_PROPOSAL_JSON"
    | "BAD_PROPOSAL_SCHEMA"
    | "ACTION_NOT_IN_SET"
    | "ACTION_UNGROUNDED"
  >;
  /** Code-only detail. Never contains model text. */
  readonly detail: string;
}

const FENCE = /^```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

function unwrapFence(content: string): string {
  const m = FENCE.exec(content);
  if (m?.[1] === undefined) return content;
  // The captured body must not itself contain a fence (reject nested/multiple).
  return m[1].includes("```") ? content : m[1].trim();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseProposal(
  content: string | null | undefined,
  state: StateSummary,
): Result<Action, ProposalFailure> {
  if (content === null || content === undefined || content.trim() === "") {
    return err({ kind: "EMPTY_CONTENT", detail: "NO_ASSISTANT_CONTENT" });
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return err({ kind: "BAD_PROPOSAL_JSON", detail: "CONTENT_TOO_LONG" });
  }

  const candidate = unwrapFence(content.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return err({ kind: "BAD_PROPOSAL_JSON", detail: "CONTENT_NOT_JSON" });
  }
  if (!isPlainObject(parsed)) {
    return err({ kind: "BAD_PROPOSAL_JSON", detail: "CONTENT_NOT_OBJECT" });
  }

  // Out-of-set type is its own halt reason (ACTION_NOT_ALLOWED).
  const type = parsed.type;
  if (typeof type === "string" && !(ACTION_TYPES as readonly string[]).includes(type)) {
    return err({ kind: "ACTION_NOT_IN_SET", detail: "ACTION_TYPE_NOT_IN_CLOSED_SET" });
  }

  const strict = StrictProposalSchema.safeParse(parsed);
  if (!strict.success) {
    const codes = strict.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}:${i.code}`)
      .join(",");
    return err({ kind: "BAD_PROPOSAL_SCHEMA", detail: `PROPOSAL_${codes}` });
  }

  // Independent second validation with the frozen shared schema.
  const shared = ActionSchema.safeParse(strict.data);
  if (!shared.success) {
    return err({ kind: "BAD_PROPOSAL_SCHEMA", detail: "SHARED_ACTION_SCHEMA_REJECTED" });
  }
  const action = shared.data;

  // Grounding: only targets that were actually offered to the model.
  if (action.type === "reroute" && !state.availableRoutes.includes(action.routeId)) {
    return err({ kind: "ACTION_UNGROUNDED", detail: "ROUTE_NOT_OFFERED" });
  }
  if (action.type === "ask_human" && !state.restrictedZones.includes(action.zoneId)) {
    return err({ kind: "ACTION_UNGROUNDED", detail: "ZONE_NOT_OFFERED" });
  }

  return ok(action);
}
