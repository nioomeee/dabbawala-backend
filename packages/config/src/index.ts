/**
 * Dabbawala Protocol — Typed environment configuration
 *
 * All configuration is loaded from environment variables.
 * No secrets have defaults. Missing required vars throw at startup.
 * ref: AGENTS.md §8 (configuration strictly via env vars)
 */

import { z } from "zod";

const EnvSchema = z.object({
  // Application
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),

  // Database
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL URL"),

  // Local EVM
  LOCAL_RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  LOCAL_CHAIN_ID: z.coerce.number().int().positive().default(31337),

  // Sepolia (ENSv2)
  SEPOLIA_RPC_URL: z.string().url().optional(),
  SEPOLIA_CHAIN_ID: z.coerce.number().int().positive().default(11155111),

  // 0G Compute
  ZERO_G_ROUTER_BASE_URL: z.string().url().optional(),
  ZERO_G_ROUTER_API_KEY: z.string().optional(),
  ZERO_G_MODEL_ID: z.string().optional(),

  // 0G Storage
  ZERO_G_STORAGE_NODE_URL: z.string().url().optional(),
  ZERO_G_INDEXER_URL: z.string().url().optional(),

  // 0G Chain
  ZERO_G_CHAIN_ID: z.coerce.number().int().positive().optional(),
  ZERO_G_RPC_URL: z.string().url().optional(),
  RELAY_LEDGER_ADDRESS: z.string().optional(),

  // Hedera
  HEDERA_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  HEDERA_OPERATOR_ACCOUNT_ID: z.string().optional(),
  HEDERA_OPERATOR_PRIVATE_KEY: z.string().optional(),

  // x402 Facilitators (ref: R-HE-2)
  X402_OFFICIAL_FACILITATOR_URL: z
    .string()
    .url()
    .default("https://x402.org/facilitator"),
  X402_BLOCKY402_FACILITATOR_URL: z
    .string()
    .url()
    .default("https://api.testnet.blocky402.com"),
  ROUTE_INTEL_SERVER_PORT: z.coerce.number().int().positive().default(3001),

  // Spend Controller
  SPEND_CONTROLLER_HARD_CEILING_ATOMIC: z.string().optional(),
  SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC: z.string().optional(),
  SPEND_CONTROLLER_POLICY_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(15_000)
    .default(12_000),

  // Simulation
  SIMULATION_SEED: z.string().default("DABBAWALA_2026_SEED_42"),
});

export type Config = z.infer<typeof EnvSchema>;

let _config: Config | undefined;

/** Parse and validate environment variables. Throws on missing required vars. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Configuration error:\n${result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  _config = result.data;
  return _config;
}

/** Get the cached config. Must call loadConfig() first. */
export function getConfig(): Config {
  if (!_config) {
    throw new Error("Config not loaded. Call loadConfig() before getConfig().");
  }
  return _config;
}

