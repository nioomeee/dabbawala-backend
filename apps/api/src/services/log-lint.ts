/**
 * log-lint — blocks upload of episode logs containing secret-shaped strings.
 *
 * Patterns checked (HYPOTHESIS set; extend before B-3 anchoring):
 *   - 0x-prefixed 64-char hex (likely private key)
 *   - Mnemonic-like 12/24 word sequences
 *   - Bearer/token headers
 *   - Neon DSN containing credentials
 *
 * ref: implementation.md §3 LOG-1, invariant §4.3.11, AGENTS.md §9
 */

import { createLogger } from "@dabbawala/observability";

const log = createLogger("log-lint");

const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "private-key-hex", re: /0x[0-9a-fA-F]{64}/ },
  { name: "bearer-header", re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i },
  { name: "neon-dsn", re: /postgresql:\/\/[^@]+:[^@]+@/ },
  { name: "mnemonic-12-words", re: /\b(\w+ ){11}\w+\b/ },
  { name: "mnemonic-24-words", re: /\b(\w+ ){23}\w+\b/ },
  { name: "api-key-header", re: /api[_-]?key\s*[:=]\s*\S+/i },
];

/**
 * Legitimate hash keys whose 0x-64-hex values are hashes/identifiers, not private keys.
 * ref: AI-03 README §Integration notes 5, user prompt §7
 */
const LEGITIMATE_HASH_PROPERTIES = new Set([
  "rootHash",
  "txHash",
  "txId",
  "policyHash",
  "valuesHash",
  "contentSha256",
  "requestSha256",
  "responseContentSha256",
  "expectedRootHash",
  "routeHash",
]);

const HASH_KEY_REGEX = new RegExp(
  `"(${Array.from(LEGITIMATE_HASH_PROPERTIES).join("|")})":\\s*"0x[0-9a-fA-F]{64}"`,
  "g"
);

export type LintResult =
  | { ok: true }
  | { ok: false; violations: Array<{ pattern: string; excerpt: string }> };

export function lintEpisodeLog(content: string): LintResult {
  const violations: Array<{ pattern: string; excerpt: string }> = [];

  // Exclude legitimate hashes from private-key-hex inspection
  const contentForHexCheck = content.replace(HASH_KEY_REGEX, '"$1":"0x[LEGITIMATE_HASH]"');

  for (const { name, re } of SECRET_PATTERNS) {
    const target = name === "private-key-hex" ? contentForHexCheck : content;
    const match = re.exec(target);
    if (match) {
      const excerpt = match[0].slice(0, 8) + "…[REDACTED]";
      violations.push({ pattern: name, excerpt });
    }
  }

  if (violations.length > 0) {
    log.error({ violations }, "log-lint BLOCKED: secret-shaped strings found in episode log");
    return { ok: false, violations };
  }

  return { ok: true };
}