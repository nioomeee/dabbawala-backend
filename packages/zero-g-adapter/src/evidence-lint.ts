/**
 * Pre-upload lint for episode evidence.
 *
 * 0G Storage objects are PUBLIC and PERMANENT (REFERENCES.md R-0G-2: access
 * restriction UNKNOWN; AGENTS.md §7 invariant 11). Nothing secret or personal
 * may be uploaded. This lint is structural: it parses each JSONL line and
 * inspects every string value together with its key, which lets it accept
 * legitimate 0x-hashes (rootHash, txHash, ...) while rejecting a 0x-64-hex
 * value anywhere else (probable private key).
 *
 * It is an additional safety net, not a replacement for AI-01's `log-lint`;
 * callers may inject that as `extraLint` and BOTH must pass.
 *
 * Findings never include the matching text, only pattern name + JSON path.
 */

export interface LintFinding { readonly pattern: string; readonly path: string }

export type LintResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly findings: readonly LintFinding[] };

/** Keys whose values are legitimately 0x + 64 hex (hashes/ids, not keys). */
const HASH_KEYS = new Set([
  "rootHash",
  "txHash",
  "txId",
  "policyHash",
  "valuesHash",
  "contentSha256",
  "requestSha256",
  "responseContentSha256",
  "episodeId",
  "provider",
  "recordId",
]);

const HEX64 = /^0x[0-9a-fA-F]{64}$/;
const HEX64_ANYWHERE = /0x[0-9a-fA-F]{64}/;

const STRING_PATTERNS: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: "bearer-token", re: /Bearer\s+[A-Za-z0-9\-._~+/]{8,}=*/i },
  { name: "router-key", re: /\b(?:sk|mk)-[A-Za-z0-9_-]{16,}/ },
  { name: "db-dsn-with-credentials", re: /postgres(?:ql)?:\/\/[^\s/@:]+:[^\s/@]+@/i },
  { name: "api-key-assignment", re: /api[_-]?key["']?\s*[:=]\s*\S{6,}/i },
  { name: "pem-block", re: /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/ },
  // 12/24 lowercase 3-8 letter words separated by single spaces: mnemonic-shaped.
  { name: "mnemonic-shaped", re: /\b(?:[a-z]{3,8} ){11}(?:[a-z]{3,8})\b/ },
  // Personal data: e-mail address (must start with a letter so Hedera ids
  // like 0.0.123@1700000000.123456789 are not mistaken for e-mail).
  { name: "email-address", re: /[A-Za-z][\w.+-]*@[A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*)+/ },
];

function scan(
  value: unknown,
  key: string | null,
  path: string,
  out: LintFinding[],
): void {
  if (typeof value === "string") {
    if (HEX64.test(value)) {
      if (key === null || !HASH_KEYS.has(key)) out.push({ pattern: "private-key-hex", path });
      return;
    }
    if (HEX64_ANYWHERE.test(value)) out.push({ pattern: "embedded-hex-64", path });
    for (const { name, re } of STRING_PATTERNS) {
      if (re.test(value)) out.push({ pattern: name, path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      scan(v, key, `${path}[${String(i)}]`, out);
    });
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      scan(v, k, path === "" ? k : `${path}.${k}`, out);
    }
  }
}

export type JsonlCheck =
  | { readonly ok: true; readonly lines: number }
  | { readonly ok: false; readonly reason: "EMPTY" | "NOT_JSONL"; readonly line?: number };

/** Verifies content is non-empty JSONL: every non-blank line is a JSON object. */
export function checkJsonl(content: string): JsonlCheck {
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { ok: false, reason: "EMPTY" };
  for (const [i, line] of lines.entries()) {
    try {
      const v: unknown = JSON.parse(line);
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        return { ok: false, reason: "NOT_JSONL", line: i + 1 };
      }
    } catch {
      return { ok: false, reason: "NOT_JSONL", line: i + 1 };
    }
  }
  return { ok: true, lines: lines.length };
}

/** Lint JSONL evidence. Call `checkJsonl` first; unparseable lines are findings. */
export function lintEvidence(content: string): LintResult {
  const findings: LintFinding[] = [];
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  for (const [i, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      findings.push({ pattern: "unparseable-line", path: `line${String(i + 1)}` });
      continue;
    }
    scan(parsed, null, `line${String(i + 1)}`, findings);
  }
  return findings.length === 0 ? { ok: true } : { ok: false, findings };
}
