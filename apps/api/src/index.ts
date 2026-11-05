/**
 * Dabbawala Protocol API — Entry point
 * ref: user request §12
 */

import { loadConfig } from "@dabbawala/config";
import { createLogger } from "@dabbawala/observability";
import { buildApp } from "./app.js";

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

await main();

