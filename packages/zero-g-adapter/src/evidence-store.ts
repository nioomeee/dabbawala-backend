/**
 * Episode-evidence storage boundary over 0G Storage.
 *
 * `EvidenceStore.put` uploads one JSONL object (an episode log or a provenance
 * bundle) and returns the identifiers the NETWORK returned (rootHash, txHash,
 * txSeq). Nothing is fabricated: in MOCK mode the receipt carries null ids and
 * mode "MOCK"; in BLOCKED mode no work is attempted.
 *
 * Safety properties:
 *   - Input must be non-empty JSONL, within maxEvidenceBytes.
 *   - Built-in lint AND an optional injected lint (AI-01 log-lint) must pass
 *     BEFORE any key is touched (invariant §4.3.11: public + permanent).
 *   - Galileo-only guard: chain id of the RPC must equal 16602 before the
 *     first transaction is sent (testnets only, AGENTS.md §11).
 *   - The root hash computed locally by the SDK must equal the root the upload
 *     returns; otherwise ROOT_MISMATCH (nothing is anchored on a mismatch).
 *   - Failure never throws; callers mark the episode `unanchored` and may call
 *     put() again: same bytes => same root, so retries are idempotent in effect.
 *   - A timeout is reported with mayHaveLanded=true and the expected root so
 *     the caller can verifyStored() before re-spending.
 */

import { createHash } from "node:crypto";
import { err, ok, type Result, type RobotId } from "@dabbawala/shared";
import { GALILEO_CHAIN_ID, redactSecrets, type StorageSettings, type ZeroGSecrets } from "./config.js";
import { checkJsonl, lintEvidence, type LintFinding, type LintResult } from "./evidence-lint.js";
import type { StorageClientPort } from "./storage-client.js";
import { NOOP_LOGGER, SYSTEM_CLOCK, type AdapterLogger, type Clock } from "./types.js";

export type EvidenceKind = "episode-log" | "provenance";

export interface EvidenceInput {
  readonly episodeId: string;
  readonly robotId: RobotId;
  readonly kind: EvidenceKind;
  /** JSONL text. */
  readonly content: string;
}

export interface EvidenceReceipt {
  readonly schema: "dabbawala.0g-evidence-receipt/v1";
  readonly mode: "LIVE" | "MOCK";
  readonly episodeId: string;
  readonly robotId: RobotId;
  readonly kind: EvidenceKind;
  readonly bytes: number;
  readonly lines: number;
  readonly contentSha256: string;
  /** Merkle root returned by 0G Storage. null in MOCK. */
  readonly rootHash: string | null;
  /** Flow-contract transaction hash returned by the upload. null in MOCK. */
  readonly txHash: string | null;
  readonly txSeq: number | null;
  /** Root the SDK computed locally before upload. null in MOCK. */
  readonly expectedRootHash: string | null;
  readonly chainId: number | null;
  readonly uploadedAtMs: number;
  readonly latencyMs: number;
}

export type EvidenceFailureKind =
  | "BLOCKED"
  | "INVALID_INPUT"
  | "TOO_LARGE"
  | "LINT_BLOCKED"
  | "CHAIN_MISMATCH"
  | "TIMEOUT"
  | "SDK_ERROR"
  | "ROOT_MISMATCH"
  | "FRAGMENTED_RESULT"
  | "BAD_RESULT"
  | "VERIFY_MISMATCH";

export interface EvidenceFailure {
  readonly kind: EvidenceFailureKind;
  /** Redacted, length-capped operator detail. Never a secret. */
  readonly detail: string;
  readonly expectedRootHash: string | null;
  /** True if the upload may have been accepted by the network. */
  readonly mayHaveLanded: boolean;
  readonly lintFindings?: readonly LintFinding[];
}

export interface EvidenceStore {
  readonly mode: "LIVE" | "MOCK" | "BLOCKED";
  put(input: EvidenceInput): Promise<Result<EvidenceReceipt, EvidenceFailure>>;
  /** Download by root with Merkle proof and compare content hash. */
  verifyStored(rootHash: string, expectedSha256: string): Promise<Result<true, EvidenceFailure>>;
  close(): Promise<void>;
}

export type ExtraLint = (content: string) => LintResult;

const ROOT_RE = /^0x[0-9a-fA-F]{64}$/;
const EPISODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function fail(
  kind: EvidenceFailureKind,
  detail: string,
  extra: Partial<EvidenceFailure> = {},
): Result<never, EvidenceFailure> {
  return err({ kind, detail, expectedRootHash: null, mayHaveLanded: false, ...extra });
}

/** Shared pre-flight: shape, size, lint. Returns encoded bytes on success. */
function preflight(
  input: EvidenceInput,
  maxBytes: number,
  extraLint: ExtraLint | undefined,
): Result<{ bytes: Uint8Array; lines: number }, EvidenceFailure> {
  if (!EPISODE_ID_RE.test(input.episodeId)) {
    return fail("INVALID_INPUT", "EPISODE_ID_FORMAT");
  }
  const bytes = new TextEncoder().encode(input.content);
  if (bytes.byteLength > maxBytes) return fail("TOO_LARGE", "EVIDENCE_EXCEEDS_LIMIT");

  const jsonl = checkJsonl(input.content);
  if (!jsonl.ok) {
    return fail("INVALID_INPUT", jsonl.reason === "EMPTY" ? "EMPTY_CONTENT" : "NOT_JSONL");
  }

  const builtin = lintEvidence(input.content);
  if (!builtin.ok) {
    return fail("LINT_BLOCKED", "LINT_BUILTIN", { lintFindings: builtin.findings });
  }
  if (extraLint !== undefined) {
    const extra = extraLint(input.content);
    if (!extra.ok) {
      return fail("LINT_BLOCKED", "LINT_EXTRA", { lintFindings: extra.findings });
    }
  }
  return ok({ bytes, lines: jsonl.lines });
}

// ── LIVE ─────────────────────────────────────────────────────────────────────

export interface ZeroGStorageEvidenceStoreOptions {
  readonly client: StorageClientPort;
  readonly settings: StorageSettings;
  readonly secrets: ZeroGSecrets;
  readonly extraLint?: ExtraLint;
  readonly logger?: AdapterLogger;
  readonly clock?: Clock;
}

export class ZeroGStorageEvidenceStore implements EvidenceStore {
  readonly mode = "LIVE" as const;
  readonly #client: StorageClientPort;
  readonly #s: StorageSettings;
  readonly #secrets: ZeroGSecrets;
  readonly #extraLint: ExtraLint | undefined;
  readonly #log: AdapterLogger;
  readonly #clock: Clock;
  #chainVerified = false;

  constructor(opts: ZeroGStorageEvidenceStoreOptions) {
    this.#client = opts.client;
    this.#s = opts.settings;
    this.#secrets = opts.secrets;
    this.#extraLint = opts.extraLint;
    this.#log = opts.logger ?? NOOP_LOGGER;
    this.#clock = opts.clock ?? SYSTEM_CLOCK;
  }

  /** Strip secrets and any URL (RPC URLs can embed provider API keys). */
  #scrub(text: string): string {
    const noUrl = redactSecrets(text, this.#secrets).replace(/https?:\/\/\S+/gi, "[url]");
    return noUrl.replace(/\s+/g, " ").slice(0, 200);
  }

  async #withTimeout<T>(work: Promise<T>): Promise<{ timedOut: true } | { value: T }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => {
        resolve({ timedOut: true });
      }, this.#s.timeoutMs);
    });
    try {
      return await Promise.race([work.then((value) => ({ value })), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async put(input: EvidenceInput): Promise<Result<EvidenceReceipt, EvidenceFailure>> {
    const startedMono = this.#clock.monotonicMs();
    const pre = preflight(input, this.#s.maxEvidenceBytes, this.#extraLint);
    if (!pre.ok) return pre;
    const { bytes, lines } = pre.value;

    // Offline root first: lets callers verify/retry even if the upload times out.
    let expectedRoot: string;
    try {
      expectedRoot = await this.#client.merkleRoot(bytes);
    } catch (e: unknown) {
      return fail("SDK_ERROR", this.#scrub(`merkle: ${e instanceof Error ? e.message : "error"}`));
    }

    // Galileo-only guard before any transaction.
    if (!this.#chainVerified) {
      const chain = await this.#withTimeout(this.#client.chainId().then((v) => v, (e: unknown) => e));
      if ("timedOut" in chain) {
        return fail("TIMEOUT", "CHAIN_ID_LOOKUP_TIMEOUT", { expectedRootHash: expectedRoot });
      }
      if (typeof chain.value !== "bigint") {
        return fail("SDK_ERROR", "CHAIN_ID_LOOKUP_FAILED", { expectedRootHash: expectedRoot });
      }
      if (chain.value !== BigInt(GALILEO_CHAIN_ID)) {
        return fail("CHAIN_MISMATCH", `RPC_CHAIN_ID_NOT_${String(GALILEO_CHAIN_ID)}`, {
          expectedRootHash: expectedRoot,
        });
      }
      this.#chainVerified = true;
    }

    const uploaded = await this.#withTimeout(
      this.#client.upload(bytes).then(
        (value) => ({ ok: true as const, value }),
        (e: unknown) => ({ ok: false as const, e }),
      ),
    );
    if ("timedOut" in uploaded) {
      this.#log.warn({ episodeId: input.episodeId, expectedRoot }, "0g storage upload timed out");
      return fail("TIMEOUT", "UPLOAD_DEADLINE_EXCEEDED", {
        expectedRootHash: expectedRoot,
        mayHaveLanded: true,
      });
    }
    if (!uploaded.value.ok) {
      const e = uploaded.value.e;
      const message = e instanceof Error ? e.message : "error";
      const kind = (e as { kind?: unknown } | null)?.kind;
      const mapped: EvidenceFailureKind =
        kind === "FRAGMENTED_RESULT" ? "FRAGMENTED_RESULT" : kind === "BAD_RESULT" ? "BAD_RESULT" : "SDK_ERROR";
      this.#log.warn({ episodeId: input.episodeId, kind: mapped }, "0g storage upload failed");
      return fail(mapped, this.#scrub(message), { expectedRootHash: expectedRoot, mayHaveLanded: true });
    }

    const result = uploaded.value.value;
    if (!ROOT_RE.test(result.rootHash) || !ROOT_RE.test(result.txHash)) {
      return fail("BAD_RESULT", "MALFORMED_IDENTIFIERS_FROM_SDK", {
        expectedRootHash: expectedRoot,
        mayHaveLanded: true,
      });
    }
    if (result.rootHash.toLowerCase() !== expectedRoot.toLowerCase()) {
      return fail("ROOT_MISMATCH", "UPLOAD_ROOT_DIFFERS_FROM_LOCAL_ROOT", {
        expectedRootHash: expectedRoot,
        mayHaveLanded: true,
      });
    }

    const finishedMono = this.#clock.monotonicMs();
    const receipt: EvidenceReceipt = {
      schema: "dabbawala.0g-evidence-receipt/v1",
      mode: "LIVE",
      episodeId: input.episodeId,
      robotId: input.robotId,
      kind: input.kind,
      bytes: bytes.byteLength,
      lines,
      contentSha256: sha256Hex(bytes),
      rootHash: result.rootHash,
      txHash: result.txHash,
      txSeq: result.txSeq,
      expectedRootHash: expectedRoot,
      chainId: GALILEO_CHAIN_ID,
      uploadedAtMs: this.#clock.nowMs(),
      latencyMs: Math.max(0, Math.round(finishedMono - startedMono)),
    };
    this.#log.info(
      { episodeId: receipt.episodeId, kind: receipt.kind, rootHash: receipt.rootHash, txHash: receipt.txHash },
      "0g storage upload ok",
    );
    return ok(receipt);
  }

  async verifyStored(
    rootHash: string,
    expectedSha256: string,
  ): Promise<Result<true, EvidenceFailure>> {
    if (!ROOT_RE.test(rootHash)) return fail("INVALID_INPUT", "ROOT_HASH_FORMAT");
    const dl = await this.#withTimeout(
      this.#client.download(rootHash).then(
        (value) => ({ ok: true as const, value }),
        (e: unknown) => ({ ok: false as const, e }),
      ),
    );
    if ("timedOut" in dl) return fail("TIMEOUT", "DOWNLOAD_DEADLINE_EXCEEDED");
    if (!dl.value.ok) {
      const e = dl.value.e;
      return fail("SDK_ERROR", this.#scrub(e instanceof Error ? e.message : "error"));
    }
    if (sha256Hex(dl.value.value) !== expectedSha256.toLowerCase()) {
      return fail("VERIFY_MISMATCH", "DOWNLOADED_CONTENT_HASH_DIFFERS");
    }
    return ok(true);
  }

  close(): Promise<void> {
    return this.#client.close();
  }
}

// ── MOCK ─────────────────────────────────────────────────────────────────────

/**
 * MOCK evidence store. LOCAL TESTS ONLY. Performs the same validation and lint
 * as LIVE but uploads nothing: receipts carry mode "MOCK" and null network
 * identifiers. A MOCK receipt is not evidence of anything on 0G.
 */
export class MockEvidenceStore implements EvidenceStore {
  readonly mode = "MOCK" as const;
  readonly #maxBytes: number;
  readonly #extraLint: ExtraLint | undefined;
  readonly #clock: Clock;
  readonly #stored = new Map<string, string>();

  constructor(opts: { maxEvidenceBytes: number; extraLint?: ExtraLint; clock?: Clock }) {
    this.#maxBytes = opts.maxEvidenceBytes;
    this.#extraLint = opts.extraLint;
    this.#clock = opts.clock ?? SYSTEM_CLOCK;
  }

  put(input: EvidenceInput): Promise<Result<EvidenceReceipt, EvidenceFailure>> {
    const pre = preflight(input, this.#maxBytes, this.#extraLint);
    if (!pre.ok) return Promise.resolve(pre);
    const sha = sha256Hex(pre.value.bytes);
    this.#stored.set(sha, input.content);
    return Promise.resolve(
      ok({
        schema: "dabbawala.0g-evidence-receipt/v1" as const,
        mode: "MOCK" as const,
        episodeId: input.episodeId,
        robotId: input.robotId,
        kind: input.kind,
        bytes: pre.value.bytes.byteLength,
        lines: pre.value.lines,
        contentSha256: sha,
        rootHash: null,
        txHash: null,
        txSeq: null,
        expectedRootHash: null,
        chainId: null,
        uploadedAtMs: this.#clock.nowMs(),
        latencyMs: 0,
      }),
    );
  }

  verifyStored(_rootHash: string, _expectedSha256: string): Promise<Result<true, EvidenceFailure>> {
    return Promise.resolve(fail("BLOCKED", "MOCK_STORE_HAS_NO_NETWORK_OBJECTS"));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

// ── BLOCKED ──────────────────────────────────────────────────────────────────

export class BlockedEvidenceStore implements EvidenceStore {
  readonly mode = "BLOCKED" as const;
  readonly #blockedBy: readonly string[];

  constructor(blockedBy: readonly string[]) {
    this.#blockedBy = blockedBy;
  }

  put(_input: EvidenceInput): Promise<Result<EvidenceReceipt, EvidenceFailure>> {
    return Promise.resolve(fail("BLOCKED", `STORAGE_BLOCKED:${this.#blockedBy.join(",")}`));
  }

  verifyStored(_rootHash: string, _expectedSha256: string): Promise<Result<true, EvidenceFailure>> {
    return Promise.resolve(fail("BLOCKED", `STORAGE_BLOCKED:${this.#blockedBy.join(",")}`));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
