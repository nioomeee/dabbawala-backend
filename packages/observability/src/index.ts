import pino, { type Logger } from "pino";

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

export function createLogger(name: string, level = "info"): Logger {
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
      process.env.NODE_ENV === "development"
        ? { target: "pino/file", options: { destination: 1 } }
        : undefined,
  });
}

export type { Logger };