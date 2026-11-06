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

export type LintResult =
  | { ok: true }
  | { ok: false; violations: Array<{ pattern: string; excerpt: string }> };

export function lintEpisodeLog(content: string): LintResult {
  const violations: Array<{ pattern: string; excerpt: string }> = [];

  for (const { name, re } of SECRET_PATTERNS) {
    const match = re.exec(content);
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