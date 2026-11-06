/**
 * Live 0G Compute smoke test / S-0G latency spike.
 *
 *   pnpm --filter @dabbawala/zero-g-adapter build
 *   ZERO_G_ROUTER_BASE_URL=... ZERO_G_ROUTER_API_KEY=... ZERO_G_MODEL_ID=... \
 *     node packages/zero-g-adapter/dist/cli/live-compute-check.js [--count N]
 *
 * Exit codes: 0 all calls returned a TEE-verified proposal; 1 at least one
 * call halted; 2 BLOCKED (missing credentials; no network call made);
 * 3 malformed configuration.
 *
 * SPENDS ROUTER CREDITS (one request per --count). Default count = 1, max 50.
 * Run it yourself with a key that holds testnet/no-real-value funds. Output
 * contains identifiers, latency and status only, never the key.
 */

import type { StateSummary } from "@dabbawala/shared";
import { createZeroGRuntime } from "../runtime.js";
import { percentile } from "../provenance.js";

const SYNTHETIC_STATE: StateSummary = {
  robotId: "ramu",
  currentCell: "mahim-3",
  heading: "north",
  checkpointIndex: 2,
  totalCheckpoints: 6,
  availableRoutes: ["route-a", "route-b"],
  restrictedZones: ["churchgate"],
  remainingBudgetAtomic: "5000",
  scenarioHints: ["SYNTHETIC smoke-test state; simulation only"],
  seed: "DABBAWALA_2026_SEED_42",
};

function parseCount(argv: readonly string[]): number {
  const i = argv.indexOf("--count");
  if (i === -1) return 1;
  const n = Number(argv[i + 1]);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 1;
}

async function main(): Promise<number> {
  const rt = createZeroGRuntime(process.env);
  if (!rt.ok) {
    console.error(JSON.stringify({ status: "CONFIG_ERROR", issues: rt.error }, null, 2));
    return 3;
  }
  const { brain, provenance } = rt.value;
  const ready = rt.value.readiness();
  if (ready.compute.status !== "LIVE") {
    console.error(
      JSON.stringify({ status: ready.compute.status, blockedBy: ready.compute.blockedBy }, null, 2),
    );
    return ready.compute.status === "BLOCKED" ? 2 : 3;
  }

  const count = parseCount(process.argv);
  const latencies: number[] = [];
  let halts = 0;
  for (let i = 0; i < count; i += 1) {
    const { result, provenance: p } = await brain.decideWithProvenance(SYNTHETIC_STATE);
    const last = p.attempts[p.attempts.length - 1];
    if (last !== undefined) latencies.push(last.latencyMs);
    if ("halted" in result) halts += 1;
    console.log(JSON.stringify({ call: i + 1, result, provenance: p }));
  }
  console.log(
    JSON.stringify({
      summary: {
        calls: count,
        halts,
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
        records: provenance.list().length,
      },
    }),
  );
  return halts === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    console.error("live-compute-check crashed");
    process.exitCode = 3;
  },
);
