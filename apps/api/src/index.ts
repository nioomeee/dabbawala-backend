/**
 * Dabbawala Protocol API — Entry point
 * ref: user request §12
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "@dabbawala/config";
import { createLogger } from "@dabbawala/observability";
import { buildApp } from "./app.js";

// Load environment variables if available
const envPaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
];
for (const p of envPaths) {
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
      break;
    } catch {
      // fallback if already loaded or syntax discrepancy
    }
  }
}

const log = createLogger("api:main");

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp();

  try {
    await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
    log.info({ port: config.API_PORT }, "API server listening");
  } catch (err) {
    log.error({ err }, "Failed to start API server");
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  log.info("SIGTERM received; shutting down");
  process.exit(0);
});

process.on("SIGINT", () => {
  log.info("SIGINT received; shutting down");
  process.exit(0);
});

main().catch((err) => {
  log.error({ err }, "Fatal error during startup");
  process.exit(1);
});