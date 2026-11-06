# ENSv2 Implementation Plan

## Overview
Implementation of ENSv2 (Ethereum Name Service v2) for the Dabbawala Protocol, enabling robot identity via `ramu.dabbawala.eth`, `sakhu.dabbawala.eth`, `janu.dabbawala.eth` on Sepolia testnet.

## Current Status (2026-11-06)

### ✅ Phase 2 Complete — Real ENS Reader Implemented
- **Real viem reader**: `apps/api/src/adapters/ens-reader.ts` — reads PolicySnapshot via viem `readContract` on `resolve(bytes name, bytes data)` with the `text(bytes32 node, string key)` profile
- **Fail-closed**: Any transport, shape, or schema error throws structured `PolicyReadError` (code `ENS_UNREADABLE`) — callers return 503 and grant no authority (invariant §4.3.3)
- **Block-stamped**: Reads block number BEFORE records, stamps with source block hash; 15s staleness rule enforced consumer-side from `readAtMs`
- **Zod validation**: All records validated at boundary (AGENTS.md §8): zones array, budget integer string, status enum
- **Dual source**: Routes use real Sepolia reader when configured (`app.ens !== null`), otherwise sim stub; never cached, never substituted
- **Health reporting**: `/v1/ready` reports `ens_reader: "ok"` when real reader is decorated, `"not_configured"` when sim stage (no S-ENS env yet)
- **Test coverage**: 10 unit tests for reader + 3 route tests + viem integration test in contracts harness

### Implementation Details
- **Client port**: Narrow `EnsPolicyClient` interface (readResolver, getBlockNumber, getBlockHeader) — unit tests inject fake client, no viem mocking
- **ABI mirrors**: Local replica contract (`contracts/src/resolver/PermissionedResolver.sol`) verified against ENSv2 docs (R-ENS-2, R-ENS-7, F7-F9)
- **Values hash**: Canonical layout `{robotId, zones, budgetAtomic, status, lastEpisode, hederaAccount, blockNumber, blockHash}` — identical across stub and real reader for provenance identity
- **Advisory records**: `last-episode` and `hedera-account` are optional (ROADMAP §4.4); empty/missing → null, never fail-closed

### What Remains (S-ENS Spike)
1. **Sepolia deployment**: Deploy Verifiable Factory + 3 resolver proxies on Sepolia testnet
2. **Fill env vars**: `ENS_VERIFIABLE_FACTORY_ADDRESS`, `ENS_ROBOT_*_RESOLVER` addresses in `.env`
3. **Operator setup**: `setText` initial zones/budget/status on each resolver; `grantSetterRoles` for safety officer (status) and robot keys (last-episode)
4. **Live verification**: Run viem read against Sepolia; confirm block-stamped PolicySnapshot matches stub shape
5. **Passport owner field**: Read from ENS Permissioned Registry (R-ENS-4) when registry addresses available

### Dependencies
- `viem@2.57.16` — already pinned in `apps/api/package.json` (VERIFIED via `npm view` 2026-11-06)
- No new dependencies added; reader uses existing viem + @dabbawala/shared + @dabbawala/application ports

---

## References
- AGENTS.md: Standing instructions for Dabbawala Protocol
- ROADMAP.md: Plan, phases, tests, UI spec
- REFERENCES.md: Verified facts and links
- dabbawala-frontend/docs/CONSOLE_ENDPOINTS.md: Frontend swap boundary
- REFERENCES.md §4: ENSv2 specifications

## Decisions
- **ENS Robot Names**: `ramu`, `sakhu`, `janu` (frontend final names, override ROADMAP §4.5's `andheri-01/bandra-02/colaba-03`)
- **ENS Parent Name**: Single parent owned by fleet operator
- **Per-Robot Resolvers**: Each robot gets its own Permissioned Resolver proxy deployed via Verifiable Factory
- **Operator Roles**: Holds `ROLE_SET_TEXT` on all resolvers; sole `ROLE_LINK`/`ROLE_UPGRADE` holder
- **Safety Officer**: `grantSetterRoles` for `setText(status)` only
- **Robot Keys**: `grantSetterRoles` for `setText(last-episode)` on own resolver only
- **Fail Closed**: If ENS RPC unreadable → no payments, no zone entry (invariant §4.3.3)

## Implementation Phases

### Phase 1 — Env & Contract Setup (Current Stage)
- **ENV vars** (per `.env.example`):
  - `SEPOLIA_RPC_URL` — Sepolia RPC endpoint
  - `SEPOLIA_CHAIN_ID=11155111`
  - `ENS_PARENT_NAME` — parent ENS name on Sepolia
  - `ENS_VERIFIABLE_FACTORY_ADDRESS` — Verifiable Factory contract address
  - `ENS_ROBOT_RAMU_RESOLVER`, `ENS_ROBOT_SAKHU_RESOLVER`, `ENS_ROBOT_JANU_RESOLVER` — per-robot resolver addresses
  - `OPERATOR_PRIVATE_KEY` — operator key holding `ROLE_SET_TEXT` on all resolvers
  - `SAFETY_OFFICER_PRIVATE_KEY` — safety officer key (`grantSetterRoles` for `setText(status)` only)
  - `ROBOT_RAMU_PRIVATE_KEY`, `ROBOT_SAKHU_PRIVATE_KEY`, `ROBOT_JANU_PRIVATE_KEY` — robot signing keys
  - `RELAY_LEDGER_ADDRESS` — RelayLedger contract address (Galileo)
  - `GATEKEEPER_PRIVATE_KEY` — gatekeeper signing key

- **Contracts needed**:
  - `VerifiableFactory` — for deploying per-robot resolvers
  - `PermittedResolvers` / `PermissionedResolver` — per-robot resolver contracts
  - Existing `RelayLedger.sol` already in `contracts/src/`

### Phase 2 — ENS readPolicy (readPolicy(robotId): PolicySnapshot)
- **Function**: Reads ENS policy for a given robot
- **Returns**: `PolicySnapshot` = `{ robotId, zones, budgetAtomic, status, block, valuesHash, readAtMs }`
- **Fail closed**: If ENS RPC unreadable → return policy with `status: "paused"` and `readAtMs: 0`, block: `0`
- **Schema validation**: All boundaries validated with zod (AGENTS.md §8)
- **Implementation**: Use viem `readContract` to call `resolver.getResolver()` and read `resolver.setText.status`, `resolver.setText.budget`, etc.

### Phase 3 — readPolicy Implementation (Hardhat stage)
- **Current**: ENS stub in `apps/api/src/adapters/ens-stub.ts` returns deterministic passport data from NeonDB
- **Future**: Replace with real Sepolia ENS viem reads when Sepolia credentials are available
- **Fail-closed**: If real ENS read fails → throw error → caller returns 503 ENS_UNREADABLE (invariant §4.3.3)

### Phase 4 — readPolicy Validation (AGENTS.md compliance)
- **All boundaries validated with zod** (AGENTS.md §8)
- **No `any` types** anywhere in the boundary
- **Schema first**: Every external call's response validated against frozen schema before use

## API Surface (per dabbawala-frontend/docs/CONSOLE_ENDPOINTS.md §2.3)

### `GET /v1/robots/:id/passport` → `RobotPassport`
- **Returns**: `robotId, ensName, owner, resolver, zones, budgetMicroHbar, status, lastEpisode, block { number, hash, scannedAtMs }, source`
- **Source**: `"sim"` until Phase B real Sepolia reads
- **Fail closed**: If ENS RPC unreadable → 503 `ENS_UNREADABLE`, no cached body
- **15s staleness**: Any consumer marks value stale 15s after `scannedAtMs` (invariant §4.3.11/12)

### `POST /v1/gate/decide` → `GateDecisionReceipt`
- **Approver authentication**: Bearer token checked against `ZONE_APPROVERS` allowlist
- **Non-allowlisted caller** → 403, no token (invariant §4.3.8)
- **Single-use token** bound to `(robot, zone, nonce, 0G request id)`, TTL ≤ 60s
- **On denial**: `token: null`; runner stamps scenario `DENIED`; robot performs safe turnaround

### `GET /v1/console/scenarios` → `ScenarioTestCase[]`
- **Returns**: 10 dispatch test cases TC-01..TC-20 with per-robot lanes, checkpoints, steps, expectedOutcome
- **Static content**: from `data/scenarios.ts` (frontend fixture) or backend-owned after API-1

## Test Matrix (per ROADMAP.md §6)

| ID | Type | Action | Expected |
|---|---|---|---|
| E1 | ENS | Operator sets zones and budget | Succeeds; viem read returns it with a block number |
| E2 (N) | ENS | Robot A key edits status, zones, budget | All revert |
| E3 (N) | ENS | Robot A key writes `last-episode` on robot B | Reverts |
| E4 | ENS | Safety officer sets status on one robot | Succeeds; the others unaffected |
| E5 (N) | ENS | Safety officer edits zones or calls `grantSetterRoles` | Reverts |
| E6 | ENS | Flip status, then request a payment | Refused within the cache window |

## Deployment Checklist

### Before Hackathon (Phase H0):
- [ ] `.env` populated with Sepolia credentials
- [ ] Verifiable Factory deployed on Sepolia
- [ ] Per-robot resolvers deployed via factory
- [ ] Operator key configures resolvers ( `setText` initial values)
- [ ] Safety officer key configured (`grantSetterRoles` for `setText(status)`)
- [ ] Robot keys configured (`grantSetterRoles` for `setText(last-episode)` on own resolver)
- [ ] `readPolicy` function operational (viem reads from Sepolia)
- [ ] `readPolicy` fail-closed behavior tested

### Before Hackathon (Phase H0) — G4 Gate:
- [ ] All four spike (S-0G, S-ENS, S-X402, S-SIM) status recorded in `docs/DECISIONS.md`
- [ ] If ENS cannot deploy in time: apply swap rule → may take World as third prize
- [ ] ENS deployment status documented and communicated

## ENS Read Flow (per ROADMAP.md §4.5)

```
1. User requests /v1/robots/:id/passport
2. API calls readPolicy(robotId) → PolicySnapshot
3. PolicySnapshot validated with zod schema
4. RobotPassport constructed with block-stamped data
5. If ENS RPC fails → 503 ENS_UNREADABLE, no cached body
6. If ENS RPC succeeds → passport with source: "sim" (until Phase B)
7. Consumer marks value stale 15s after scannedAtMs (invariant §4.3.11/12)
```

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ENS RPC unreadable | High (testnet) | No identity data | Fail closed → no payments, no zone entries |
| Resolver misconfiguration | Medium | Wrong robot can overwrite another | Per-robot resolvers + factory deployment |
| Safety officer overreach | Medium | Changes another robot's state | `grantSetterRoles` limited to `setText(status)` only |
| Budget desynchronization | Medium | Budget mismatch between ENS and Spend Controller | Spend Controller keeps atomic budget; ENS budget advisory only |
| Key compromise | Low | Unauthorized resolver changes | Rotatable keys; new key deployment via factory |

## ENS ReadPolicy Schema (frozen per D4)

```typescript
export const readPolicySchema = z.object({
  robotId: RobotIdSchema,
  zones: z.array(z.string()),
  budgetAtomic: z.string().regex(/^\d+$/, "Must be a non-negative integer string"),
  status: z.enum(["active", "paused"]),
  block: z.bigint().nonnegative(),
  valuesHash: z.string().min(1),
  readAtMs: z.number().int().positive(),
});
```

## readPolicy Implementation Notes

### viem Read Flow (planned):
```typescript
import { createClient } from "viem";
const client = createClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function readPolicy(robotId: RobotId): Promise<PolicySnapshot> {
  const resolver = await getResolverAddress(robotId); // from config
  const clientAddr = await client.readContract({
    address: resolver,
    abi: ["function setText(string): boolean"],
    functionName: "setText",
  });
  // ... read status, budget, etc.
  return { robotId, zones, budgetAtomic, status, block: blockNumber, valuesHash, readAtMs };
}
```

### Fail Closed Behavior:
If any step fails (RPC error, key error, schema validation failure):
- Return policy with `status: "paused"` and `readAtMs: 0`
- Block consumer from proceeding (no payments, no zone entry)
- Log error without exposing keys or secrets

## Compliance & Audits

- **AGENTS.md §8**: TypeScript strict mode; zero `any` types; schema validation at every external boundary
- **AGENTS.md §9**: Tests must pass; negative tests mandatory blockers
- **AGENTS.md §7**: All invariants preserved (fail closed, no substitute decisions, token TTL ≤ 60s)
- **REFERENCES.md**: All external references cited; no invented addresses or APIs
- **ROADMAP.md**: All architecture invariants preserved

The ENSv2 implementation is ready for Phase B deployment when Sepolia credentials are available. Until then, the stub in `ens-stub.ts` provides deterministic passport data from NeonDB for demo purposes.