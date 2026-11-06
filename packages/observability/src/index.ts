<<<<<<< HEAD
import pino, { type Logger } from "pino";

=======
/**
 * Dabbawala Protocol — Observability: structured logging via Pino
 *
 * Sanitise outputs so keys, secrets, and auth headers are never logged.
 * ref: AGENTS.md §8
 */

import pino from "pino";

/** Redact sensitive fields from log output. */
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
const REDACT_PATHS = [
  "privateKey",
  "mnemonic",
  "secret",
  "password",
  "token",
  "authorization",
  "Authorization",
  "x-payment",
  "X-Payment",
  "apiKey",
  "api_key",
  "*.privateKey",
  "*.mnemonic",
  "*.secret",
  "*.password",
  "*.token",
  "*.authorization",
  "*.apiKey",
];

<<<<<<< HEAD
export function createLogger(name: string, level = "info"): Logger {
=======
export function createLogger(name: string, level = "info"): pino.Logger {
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
  return pino({
    name,
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
    transport:
<<<<<<< HEAD
      process.env.NODE_ENV === "development"
=======
      process.env["NODE_ENV"] === "development"
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
        ? { target: "pino/file", options: { destination: 1 } }
        : undefined,
  });
}

<<<<<<< HEAD
export type { Logger };
=======
export type { Logger } from "pino";

>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
