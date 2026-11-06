/**
<<<<<<< HEAD
 * Dabbawala Protocol - Typed environment configuration
 *
 * All configuration is loaded from environment variables.
 * No secrets have defaults. Missing required vars throw at startup.
 * ref: AGENTS.md §8, implementation.md §1 CFG-1
=======
 * Dabbawala Protocol — Typed environment configuration
 *
 * All configuration is loaded from environment variables.
 * No secrets have defaults. Missing required vars throw at startup.
 * ref: AGENTS.md §8 (configuration strictly via env vars)
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
 */

import { z } from "zod";

<<<<<<< HEAD
const optionalUrl = () =>
  z
    .string()
    .optional()
    .transform((val) => (val && !val.startsWith("REPLACE_WITH_") ? val : undefined))
    .pipe(z.string().url().optional());

const optionalNumber = () =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === "") return undefined;
      if (typeof val === "string" && val.startsWith("REPLACE_WITH_")) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    });

const optionalString = () =>
  z
    .string()
    .optional()
    .transform((val) => (val && !val.startsWith("REPLACE_WITH_") ? val : undefined));

=======
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
const EnvSchema = z.object({
  // Application
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),

<<<<<<< HEAD
  // Database (NeonDB cloud PostgreSQL). ref: implementation.md §5 D2
  // Pooled connection string for app runtime; direct endpoint for migrations.
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL URL"),

  // Local EVM (Hardhat). ref: implementation.md §1 D3
=======
  // Database
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL URL"),

  // Local EVM
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
  LOCAL_RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  LOCAL_CHAIN_ID: z.coerce.number().int().positive().default(31337),

  // Sepolia (ENSv2)
<<<<<<< HEAD
  SEPOLIA_RPC_URL: optionalUrl(),
  SEPOLIA_CHAIN_ID: z.coerce.number().int().positive().default(11155111),

  // ENSv2 — fill after S-ENS spike. ref: REFERENCES.md §4
  ENS_PARENT_NAME: optionalString(),
  ENS_VERIFIABLE_FACTORY_ADDRESS: optionalString(),
  // Per-robot resolver addresses. ref: implementation.md §2, §8
  ENS_ROBOT_RAMU_RESOLVER: optionalString(),
  ENS_ROBOT_SAKHU_RESOLVER: optionalString(),
  ENS_ROBOT_JANU_RESOLVER: optionalString(),

  // Operator and safety officer keys (Sepolia / ENSv2). ref: AGENTS.md §11
  OPERATOR_PRIVATE_KEY: optionalString(),
  SAFETY_OFFICER_PRIVATE_KEY: optionalString(),

  // Robot signing keys — placeholders on Hardhat; never fund. ref: AGENTS.md §11
  ROBOT_RAMU_PRIVATE_KEY: optionalString(),
  ROBOT_SAKHU_PRIVATE_KEY: optionalString(),
  ROBOT_JANU_PRIVATE_KEY: optionalString(),

  // Gatekeeper signing key for chain writes. ref: implementation.md §3
  GATEKEEPER_PRIVATE_KEY: optionalString(),

  // 0G Compute (Router). ref: REFERENCES.md §2 R-0G-1
  ZERO_G_ROUTER_BASE_URL: optionalUrl(),
  ZERO_G_ROUTER_API_KEY: optionalString(),
  ZERO_G_MODEL_ID: optionalString(),

  // 0G Storage. ref: REFERENCES.md §2 R-0G-2
  ZERO_G_STORAGE_NODE_URL: optionalString(),
  ZERO_G_INDEXER_URL: optionalString(),

  // 0G Chain (Galileo). ref: implementation.md §6
  ZERO_G_CHAIN_ID: optionalNumber(),
  ZERO_G_RPC_URL: optionalString(),
  // Populated from Hardhat deployment output during local runs. ref: implementation.md §6
  RELAY_LEDGER_ADDRESS: optionalString(),

  // Hedera (Testnet). ref: REFERENCES.md §3 R-HE-1..R-HE-4
  HEDERA_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  HEDERA_OPERATOR_ACCOUNT_ID: optionalString(),
  HEDERA_OPERATOR_PRIVATE_KEY: optionalString(),
  // Spend Controller holds the only Hedera payment key — invariant §7.1
  SPEND_CONTROLLER_HEDERA_ACCOUNT_ID: optionalString(),
  SPEND_CONTROLLER_HEDERA_PRIVATE_KEY: optionalString(),
  // HCS audit topic — fill after B-6
  HEDERA_HCS_SPEND_TOPIC_ID: optionalString(),

  // x402 Facilitators (ref: R-HE-2; both open access)
=======
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
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
  X402_OFFICIAL_FACILITATOR_URL: z
    .string()
    .url()
    .default("https://x402.org/facilitator"),
  X402_BLOCKY402_FACILITATOR_URL: z
    .string()
    .url()
    .default("https://api.testnet.blocky402.com"),
<<<<<<< HEAD
  // Route-intel server config. ref: implementation.md §4.6
  ROUTE_INTEL_SERVER_PORT: z.coerce.number().int().positive().default(3001),
  ROUTE_INTEL_PRICE_PER_LEG_ATOMIC: optionalString(),
  ROUTE_INTEL_MERCHANT_ACCOUNT_ID: optionalString(),

  // Spend Controller limits. ref: AGENTS.md §7 invariant 9
  SPEND_CONTROLLER_HARD_CEILING_ATOMIC: optionalString(),
  SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC: optionalString(),
=======
  ROUTE_INTEL_SERVER_PORT: z.coerce.number().int().positive().default(3001),

  // Spend Controller
  SPEND_CONTROLLER_HARD_CEILING_ATOMIC: z.string().optional(),
  SPEND_CONTROLLER_PER_REQUEST_CAP_ATOMIC: z.string().optional(),
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
  SPEND_CONTROLLER_POLICY_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(15_000)
    .default(12_000),

<<<<<<< HEAD
  // Proof Worker paths. ref: implementation.md §8
  PROOF_WORKER_CIRCUIT_DIR: optionalString(),
  PROOF_WORKER_WASM_PATH: optionalString(),
  PROOF_WORKER_ZKEY_PATH: optionalString(),
  SNARKJS_VERIFICATION_KEY_PATH: optionalString(),

  // Simulation — deterministic seed is mandatory. ref: AGENTS.md §8 invariant §4.3
=======
  // Simulation
>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
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
<<<<<<< HEAD
=======

>>>>>>> 8902192ad8df810e30542a626bce32edd96805bf
