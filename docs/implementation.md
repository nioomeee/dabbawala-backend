# Dabbawala Backend — Implementation Plan

Status: docs-only artifact, written after analyzing the frontend repo
(`dabbawala-frontend/docs/progress.md`, `docs/CONSOLE_ENDPOINTS.md`,
`src/app/console/services/consoleApi.ts`, `data/types.ts`, `data/scenarios.ts`,
`state/useScenarioRunner.ts`) against the backend scaffolding.

This document defines WHAT the backend implements next and HOW, for the stage
where the local EVM tests run on **Hardhat** (not Foundry/Anvil yet for safety
of the timebox), the operational database is **NeonDB** (cloud PostgreSQL), and
the **frontend names are final**. Sponsor-grade integrations (0G Router, 0G
Storage, Hedera x402) are Interfaces to keep real where the ROADMAP demands it;
everything the frontend labels `source: "sim"` stays simulated and labelled
until Phase B lands (AGENTS.md §10 disclosure rule).

---

## 1. Decisions and conflicts resolved by the human

| # | Decision | Authority |
|---|---|---|
| D1 | Robot identities are **ramu / sakhu / janu** (frontend names are final). ROADMAP §4.5's `andheri-01 / bandra-02 / colaba-03` is superseded. | Human directive (2026-10-31) |
| D2 | **NeonDB** replaces local `docker-compose` PostgreSQL as the operational database for development and testing. `DATABASE_URL` must carry `sslmode=require`. | Human directive |
| D3 | The local EVM for the current stage is **Hardhat** (chain id `31337`, RPC `http://127.0.0.1:8545`). Foundry tests stay as scripts but CI/test entry point moves to Hardhat until B-4. | Human directive |
| D4 | The frontend contract documents (`dabbawala-frontend/docs/CONSOLE_ENDPOINTS.md`) are the frozen swap boundary: the backend serves exactly those five functions' response shapes; the frontend only swaps function bodies to `fetch()`. | INTERPRETATION, ratified by frontend docs |

Consequence of D1: `packages/shared/src/types/index.ts` currently exports
`RobotId = "andheri-01" \| "bandra-02" \| "colaba-03"` (VERIFIED — read on
2026-10-31). It must be amended to `"ramu" \| "sakhu" \| "janu"` together with
`ROBOT_IDS`. Per AGENTS.md §14 shared types change on human proposal only —
this document is that proposal; amend after the human approves.

Consequence of D2: `docker-compose.yml` remains in-tree but is no longer part
of the setup path; `db:start` / `db:stop` scripts are de-scoped. Migrations run
against the Neon branch via `pnpm db:migrate`.

Consequence of D3: `pnpm anvil:start` is de-scoped for this stage. `contracts/`
gains a Hardhat config and test suite; `forge:test` remains but is not the
acceptance gate until the contracts return to Foundry for deployment.

---

## 2. Robot identity registry (final names)

Source of truth for names: `dabbawala-frontend/src/app/console/data/types.ts`
and `services/consoleApi.ts` (VERIFIED 10/31).

| RobotId | ENS name (display) | Role (from scenarios.ts) | Passport zones | Budget (sim) |
|---|---|---|---|---|
| `ramu` | `ramu.dabbawala.eth` | Primary Western Line courier | mahim, dadar, churchgate | 5000 microHbar |
| `sakhu` | `sakhu.dabbawala.eth` | Monsoon canal detour scout | mahim, dadar | 5000 microHbar |
| `janu` | `janu.dabbawala.eth` | Restricted Zone R-2 cargo specialist | docks-r2 | 5000 microHbar |

- Zones used by scenarios: `mahim`, `dadar`, `churchgate`, `docks-r2` (Zone R-2
  hazard hatch on the board). The Zone Gate and approver allowlist keys must use
  these ids verbatim.
- Env vars rename accordingly:
  `ENS_ROBOT_ANDHERI_01_RESOLVER → ENS_ROBOT_RAMU_RESOLVER`, etc., and
  `ROBOT_ANDHERI_01_PRIVATE_KEY → ROBOT_RAMU_PRIVATE_KEY`, etc. The remapped
  `.env.example` (committed with this doc) is normative.

---

## 3. Component inventory — what exists vs. what to build

Existing scaffolding (VERIFIED — read on 2026-10-31):

| Path | Contents |
|---|---|
| `apps/api` | Fastify server factory + `/v1` health routes, OpenAPI, CORS, error handler |
| `packages/shared` | Frozen types (§4.5/§4.6 of ROADMAP), halt codes, Result type, TTL constants |
| `packages/config` | zod env schema + `loadConfig()` |
| `packages/database` | Drizzle schema (robots, episodes, episode_logs, approval_tokens, pending_actions, spend_records) + client |
| `packages/domain` | robot, policy, approval, episode domain types |
| `packages/application` | ports: fleet-brain, policy-reader, gatekeeper, episode-log-writer, spend-controller |
| `packages/policy-engine` | action-validator entry |
| `packages/observability` | structured logger |
| `contracts` | `RelayLedger.sol`, `DeployRelayLedger.s.sol`, Foundry unit test |

Work items, in dependency order:

1. **SH-1** Amend `packages/shared` RobotId to ramu/sakhu/janu (D1), keeping
   everything else frozen (AGENTS.md §14 process).
2. **CFG-1** Extend `packages/config` env schema with the remapped robot keys
   (`ROBOT_RAMU_PRIVATE_KEY` …), ENS resolver addresses per robot,
   `GATEKEEPER_PRIVATE_KEY`, `SPEND_CONTROLLER_*`, `ENS_PARENT_NAME`,
   `ENS_VERIFIABLE_FACTORY_ADDRESS`, proof-worker paths, route-intel merch
   config — every key present in `.env.example` must be schema-visible or
   explicitly carried as `optional()` until its phase. AGENTS.md §8.
3. **DB-1** Repoint Drizzle client at NeonDB: driver `postgres` with
   `sslmode=require` honoured from `DATABASE_URL`; add `drizzle-kit push`
   against Neon; drop `db:start`/`db:stop` from docs; add seed script with the
   three robots from §2.
4. **API-1..API-5** Implement the frontend contract endpoints (section 4).
5. **GK-1** Gatekeeper + Zone Gate service (in-memory pending-action store now,
   `pending_actions` table once NeonDB is the operational store).
6. **ENS-READ-1** ENS reader adapter: real viem reads on Sepolia; a local
   Hardhat-stub adapter (deterministic block numbers, seeded records) so
   passport and policy flows are testable offline on Hardhat. Fail closed per
   invariant §4.3.3.
7. **LOG-1** Episode log writer + `log-lint` + JSONL schema
   `dabbawala.console.replay/v1` compatibility for the frontend export shape
   (INTERPRETATION; see §4.5).
8. **HH-1** Hardhat harness for `RelayLedger.sol` (section 6).
9. **B-2/B-5/B-6/B-7** Fleet Brain 0G loop, replay verifier, Spend Controller,
   route-intel x402 server per ROADMAP Phase B — unchanged in design, only
   their EVM touches run on Hardhat for now.

---

## 4. API surface (the frontend swap boundary)

All routes are mounted under `/v1` (the existing Fastify prefix is a mounting
detail; the frontend paths below are logical and map to `/v1/...`). Every
response carries `source: "sim" | "live"`. Every boundary is zod-validated
(AGENTS.md §8). Types mirror `data/types.ts` in the frontend exactly; no
renaming.

### 4.1 `GET /v1/console/scenarios` → `ScenarioTestCase[]`

- Serves the 10 dispatch test cases TC-01..TC-20 with per-robot `lanes`
  (Record<RobotId, RobotLane>), `checkpoints`, `steps`, `expectedOutcome`.
- Static content: seed from a `scenarios.json` fixture (same content as
  `data/scenarios.ts`; content becomes backend-owned at that point so the two
  repos do not drift). Response is cacheable.
- Validation: zod schema generated from the same shape — `RobotId` union from
  `packages/shared` after SH-1; tracks `"0G" | "Hedera" | "ENS" | "Integration"`.
- Errors: 200 with `[]` on empty registry is NOT acceptable — return 503
  `{ error: "SCENARIOS_NOT_SEEDED" }` so the UI distinguishes "backend down"
  from "no scenarios".

### 4.2 `GET /v1/console/scenarios/:id` → `ScenarioTestCase | null`

- Unknown id resolves to `200` with body `null`, never a throw (frontend
  contract §2.2). 404 would break `loadScenario`'s null contract.

### 4.3 `GET /v1/robots/:id/passport` → `RobotPassport`

- Response must carry exactly: `robotId, ensName, owner, resolver, zones,
  budgetMicroHbar, status ("active"|"paused"), lastEpisode,
  block { number, hash, scannedAtMs }, source`.
- Implementation now (Hardhat stage): ENS stub adapter — reads the seeded
  robot rows, stamps `block.number/hash` from the Hardhat chain state
  (`source: "sim"`), `scannedAtMs = Date.now()`.
- Phase B swap-out: real Sepolia ENSv2 viem read with block-stamping and
  `source: "live"` (ROADMAP B-8/B-9, CONSOLE_ENDPOINTS §2.3).
- **Unit mismatch to resolve (OQ-1, HYPOTHESIS):** ROADMAP §4.5 stores budget
  as atomic USDC (6 decimals) while the passport displays
  `budgetMicroHbar`. Interim rule: the policy engine and Spend Controller keep
  integer-string atomic units; the passport endpoint converts to microHbar
  (`5000` = 0.005 HBAR, matches sim data exactly). The conversion constant
  lives in one place (`packages/shared`) and is documented in README's
  simulated list until the ENS budget field is frozen.
- Failure semantics: fail closed. If the policy source is unreadable the
  endpoint returns `503 { error: "ENS_UNREADABLE", stale: false }` and no
  cached passport body (invariant §4.3.3, CONSOLE_ENDPOINTS §2.3).
- Staleness: any consumer marks the value stale 15 s after `scannedAtMs`
  (invariant 11/12). The backend also flags `stale: true` when
  `Date.now() - scannedAtMs > POLICY_STALE_AFTER_MS` (constant already in
  `packages/shared`).

### 4.4 `POST /v1/gate/decide` → `GateDecisionReceipt`

Request body: `{ request: GateRequest, decision: "approved" | "denied" }`.
Response: `{ requestId, decision, token: string | null, ttlMs, decidedAtMs,
source }`.

Server-enforced rules (each has a negative test in section 7):

1. Parse `GateRequest` with zod (`id`, `robotId∈robot union`, `zoneId`,
   `nonce`, `ttlMs`, `status`). Reject anything else — 400.
2. Approver authentication: at this stage the caller's identity is a
   Bearer-tagged allowlisted approver id per zone — `ZONE_APPROVERS` seeded
   config (e.g. approver key → allowed zones). Non-allowlisted caller →
   **HTTP 403 and no token** (invariant §4.3.8; frontend contract §2.4).
3. On `approved`: store the pending action, mint a single-use token bound to
   `(robotId, zoneId, nonce, requestId)`, `ttlMs = min(request.ttlMs, 60_000)`
   (invariant §4.3.7; the frontend runs a 60 s countdown — `GATE_TTL_MS` in
   `useScenarioRunner.ts` is fixed at 60_000), persist to `approval_tokens`.
   Token shape in sim mode `tok-<nonce>-<id>` is kept for display parity.
4. On `denied`: `token: null`, pending action closed as `denied`, receipt
   carries `denied` — the runner then stamps the scenario `DENIED` and the
   robot reroutes; no robot-side effect needed from the backend.
5. Expiry / replay: reuse of a consumed token → `409 GATE_REPLAYED`; expired
   token → `403 APPROVAL_EXPIRED`; both leave the gate closed.
6. Replay protection and expiry share the `approval_tokens` / `pending_actions`
   tables already in the Drizzle schema (VERIFIED — schema present).
7. `decidedAtMs = Date.now()` at mint time; `source` is `"sim"` until the
   Gatekeeper chain-writes, `"live"` only with block evidence.

### 4.5 `GET /v1/episodes/:scenarioId/log` → `EpisodeLog`

- Response shape is the frontend's export object: `schema:
  "dabbawala.console.replay/v1"`, `scenario`, `seed`, `exportedAtMs`,
  `simulated: boolean`, `robots[]`, `steps[]`, `verdict`, `haltReason`.
- Hardhat stage: serve from `episode_logs` rows assembled during a run
  (`simulated: true`). Phase B (B-3/B-5): serve the JSONL anchored on
  RelayLedger (0G Galileo) after `log-lint` passes; zero secrets/personal data
  (invariant §4.3.11).
- The replay verifier (B-5) re-hashes the file and compares with the
  RelayLedger root; on Hardhat it compares against the local contract root
  event — same code path, different RPC (`LOCAL_RPC_URL`).

### 4.6 Internal API (not consumed by the frontend console today)

Kept per ROADMAP §4.5 interfaces, mounted `/v1/internal/*`, never exposed to
CORS: `decide(state)` (Fleet Brain + 0G), `buyIntel(legId)` (Spend Controller),
`readPolicy(robotId)` (ENS reader), `applyAction(robotId, action)` (simulator
controller). These exist behind the ports in `packages/application` and are
built in Phase B tasks B-2, B-6, B-7.

---

## 5. Database (NeonDB)

- Provider: Neon (cloud PostgreSQL). Only `DATABASE_URL` is required; the
  old `POSTGRES_HOST/PORT/DB/USER/PASSWORD` local vars are removed from
  `.env.example` (docker-compose is de-scoped, D2).
- Connection: `postgres` driver; pooled endpoint string for app runtime,
  direct (non-pooled) endpoint for migrations — both variants come from the
  Neon dashboard. `sslmode=require` mandatory.
- Schema: the existing Drizzle tables (VERIFIED, section 3) are Neon-ready
  unchanged:
  - `robots(id varchar(32) pk, status, current_cell, checkpoint_index,
    halt_reason, halt_detail, last_policy_block, last_policy_hash, …)` —
    seeded with the three final robots.
  - `episodes`, `episode_logs` (unique `(episode_id, seq)`),
    `approval_tokens` (unique `nonce`), `pending_actions`, `spend_records`
    (unique `idempotency_key`).
- `robotId` columns are `varchar(32)`, not enums — the RobotId union is
  enforced only at the zod boundary; DB rows are cheap to rename.
- Migration commands: `pnpm db:migrate` (drizzle-kit against Neon), `pnpm
  db:seed` (inserts ramu/sakhu/janu + Zone approver allowlist). CI runs
  migrate + seed against a Neon **test branch** before `pnpm test:all` so the
  suite never writes to the dev branch.

---

## 6. Contracts under Hardhat (current stage)

- Scope for now: compile and unit-test `RelayLedger.sol` (the only contract in
  `contracts/src`, VERIFIED); deployment to 0G Galileo still goes through the
  Foundry script flow later (B-4 unchanged).
- `contracts` gains: `hardhat.config.ts` (chain id 31337, Solidity 0.8.x
  matching RelayLedger pragma), `test/hardhat/RelayLedger.t.ts` (TS, mirrors
  the existing Foundry test cases), `package.json` scripts `hardhat:test`,
  `hardhat:node`, `hardhat:compile`. Versions pinned exactly after running
  `npm view` per AGENTS.md §5 (no unpinned additions).
- Test cases (mapping FOUND unit test; ROADMAP §6):
  - `anchor()` emits event with `(robotId, episodeId, rootHash)` and read-back
    via ethers matches (test C1).
  - Replay-protection behaviour if present in the contract: second anchor of
    same episode must not silently pass (assert exact revert).
  - Gas + failure snapshots recorded in `docs/evidence/`.
- Local node: `npx hardhat node` on `127.0.0.1:8545` (same URL/chain id the
  config already expects), so `LOCAL_RPC_URL=http://127.0.0.1:8545` and
  `LOCAL_CHAIN_ID=31337` values in `.env.example` stay valid.
- `RELAY_LEDGER_ADDRESS` in `.env.example` is populated from the Hardhat
  deployment output during local runs; the Sepolia/Galileo value overwrites it
  at B-4.

---

## 7. Test matrix for the Hardhat stage

`pnpm test:all` (turbo) remains the gate. Matrix relevant now; the full
ROADMAP §6 matrix is unchanged.

| ID | Level | What | Expected |
|---|---|---|---|
| U1-zod | API | invalid JSON, out-of-set action, unknown scenario id, wrong robot id | 400s; never 500; unknown keep-alive paths return per §4.2 |
| G-403 (N) | API | approver not on zone allowlist calls decide | 403, no token (invariant §4.3.8) |
| G-replay (N) | API | approved token reused | 409 GATE_REPLAYED |
| G-expire (N) | API | token past TTL | 403 APPROVAL_EXPIRED |
| G-deny | API | deny decision | receipt.token null; pending action denied |
| ENS-failclosed (N) | API | stub adapter returns unreadable | 503 ENS_UNREADABLE; no cached passport |
| L-lint (N) | service | episode log containing a synthetic secret-shaped string | log-lint blocks upload; no write |
| W-safe (write) | db | 10 parallel spend inserts with same cap (U2 analogue) | budget/cap invariants hold via idempotency key |
| C1-hh | contract (Hardhat) | anchor a root and read it back | event + stored value match (ROADMAP §6 C1) |
| L2-hh (N) | contract (Hardhat)/service | change one byte of a stored episode, re-hash, compare with registry root | verifier reports mismatch (ROADMAP §6 L2) |

Evidence goes to `docs/evidence/` per AGENTS.md §9. Negative tests that need
live sponsors (0G, facilitator) remain blocked on their Phase B tasks and stay
simulated — no test is skipped or modified to fake a pass.

---

## 8. `.env.example` remap (committed with this doc)

| Old name | New name | Reason |
|---|---|---|
| `POSTGRES_HOST/PORT/DB/USER/PASSWORD` | removed (Neon) | D2 — cloud DB; `DATABASE_URL` carries everything |
| `DATABASE_URL` | `DATABASE_URL` (Neon pooled string now; direct for migrations) | D2 |
| `ENS_ROBOT_ANDHERI_01_RESOLVER` | `ENS_ROBOT_RAMU_RESOLVER` | D1 |
| `ENS_ROBOT_BANDRA_02_RESOLVER` | `ENS_ROBOT_SAKHU_RESOLVER` | D1 |
| `ENS_ROBOT_COLABA_03_RESOLVER` | `ENS_ROBOT_JANU_RESOLVER` | D1 |
| `ROBOT_ANDHERI_01_PRIVATE_KEY` | `ROBOT_RAMU_PRIVATE_KEY` | D1 |
| `ROBOT_BANDRA_02_PRIVATE_KEY` | `ROBOT_SAKHU_PRIVATE_KEY` | D1 |
| `ROBOT_COLABA_03_PRIVATE_KEY` | `ROBOT_JANU_PRIVATE_KEY` | D1 |
| Local EVM comment "(Anvil)" | "(Hardhat)" | D3 (URL/chain id values unchanged: 127.0.0.1:8545, 31337) |

Unchanged (already aligned): application, Sepolia, 0G, Hedera, x402,
Spend Controller, proof worker, simulation seed sections.

`packages/config` must be extended (CFG-1) to declare every new key — optional
keys stay `optional()` until their phase so `loadConfig()` keeps passing on a
fresh clone.

---

## 9. Build order

| # | Task | Files | Accept |
|---|---|---|---|
| 1 | SH-1 shared RobotId rename | `packages/shared` | types compile, app builds |
| 2 | CFG-1 config additions | `packages/config`, `.env.example` | loadConfig passes on fresh clone with example values |
| 3 | DB-1 Neon client + migrate + seed | `packages/database` | migrate+seed succeed on Neon; seed has 3 final robots |
| 4 | API-1/2 scenarios endpoints | `apps/api` | curl returns TC list matching frontend `SCENARIOS` shape |
| 5 | API-3 passport (stub ENS) | `apps/api` + adapter | block-stamped passport; fail-closed path tested |
| 6 | API-4 gate/decide | `apps/api` + gatekeeper | token mint, 403, expiry, replay tests pass |
| 7 | API-5 episode log | `apps/api` | export shape matches `EpisodeLog`, log-lint gates writes |
| 8 | HH-1 Hardhat harness | `contracts` | `hardhat:test` green; evidence saved |
| 9 | Frontend swap preview | none (backend only) | manual: point consoleApi at backend with `source:"sim"` — contract test only, no frontend repo edit from this repo |

Each step attaches evidence to `docs/evidence/` and a row in
`docs/PROGRESS.md` per AGENTS.md §6/§9.

---

## 10. Risks and open questions

- **OQ-1 (HYPOTHESIS)** budget unit: USDC-atomic (ROADMAP §4.5, chained to
  F12) vs `budgetMicroHbar` (frontend passport). Resolve before B-6; interim
  conversion is centralized in `packages/shared` and flagged simulated.
- **R1** Two repos owning scenario content will drift. Mitigation: backend
  owns `scenarios.json` after API-1; frontend keeps its copy for offline demo
  (D1 offline requirement) — drift is caught by a schema round-trip test.
- **R2** Neon pooled connections + Drizzle migrations on edge pools can hang;
  run migrations against the direct endpoint only.
- **R3** Robot keys in env are placeholders while on Hardhat; never fund them,
  never commit `.env` (AGENTS.md §10/§11).
- **R4** The `/api/console/scenarios` prefix lives outside `/v1` in the
  frontend contract's logical paths; mounting decision (prefix or rewrite)
  must be settled once with the frontend in API-4's review — do not let the
  frontend rewrite fetch paths.
- **R5** Hardhat + Foundry coexistence in `contracts/`: only RelayLedger is
  shared today; re-run `npm view` before pinning any Hardhat package version.
