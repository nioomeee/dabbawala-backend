# implementations.md — 0G Integration (AI-03)

Written 2026-11-06 from a full read of `ref/zero-g-adapter` (reference adapter) and
the current workspace. This document defines WHAT the production 0G integration
contains and HOW it attaches to the other tracks (AI-01 policy engine, the ENS
policy reader, the episode-log writer, and the API). Where `ref/` disagrees with
`ROADMAP.md`, `ROADMAP.md` §4.3 invariants win (AGENTS.md §4).

---

## 1. Goal

Promote the reference adapter `ref/zero-g-adapter` into a real workspace package,
`packages/zero-g-adapter` (`@dabbawala/zero-g-adapter`), and wire it into
`apps/api`, so that:

1. Every checkpoint decision comes from the **0G Compute Router** with
   `verify_tee: true`, and the `ZG-Res-Key` header is captured as the request id
   (R-0G-1, ROADMAP §1.1).
2. The model output stays a **proposal only**. Approval is exclusively
   `validateAction` from `@dabbawala/policy-engine` against a fresh policy
   snapshot (invariant §4.3.2).
3. Episode evidence (JSONL + provenance) is uploaded to **0G Storage** with a
   Merkle root, ready for anchoring on RelayLedger (invariants §4.3.10/11).
4. Failure is always explicit: **LIVE | MOCK | BLOCKED** per capability. No fake
   success anywhere (constraint C7: a fallback that fakes a decision disqualifies).

Scope note: the adapter is a *library*; it makes no approvals and holds no
payment keys (invariant §4.3.1).

## 2. Package layout (ported from ref, adjusted paths only)

```
packages/zero-g-adapter/
├── package.json               ESM ("type":"module"); deps pinned exactly
├── tsconfig.json              extends ../../tsconfig.base.json
├── tsconfig.build.json        excludes __tests__
├── vitest.config.ts           aliases policy-engine/domain to source (see §4)
├── README.md                  status, env table, runbook (port of ref README)
└── src/
    ├── index.ts               public API
    ├── config.ts              env parsing -> LIVE / MOCK / BLOCKED per capability
    ├── types.ts               failure taxonomy, AttemptRecord, ProvenanceRecord,
    │                          transport port, clock/logger ports
    ├── failures.ts            FailureKind -> frozen HaltReason mapping + retry policy
    ├── prompt.ts              bounded/sanitised state-only prompt (closed set)
    ├── proposal.ts            strict closed-set parse + grounding (untrusted input)
    ├── router-transport.ts    live fetch transport (key in closure, redirect:"error",
    │                          deadline covers body read, byte-capped response)
    ├── mock-transport.ts      MOCK transport (MOCK- ids, no invented TEE/billing)
    ├── fleet-brain.ts         ZeroGFleetBrain implements IFleetBrain (§4.3.2/4)
    ├── provenance.ts          bounded in-memory log + JSONL rendering + percentiles
    ├── evidence-lint.ts       key-aware JSONL lint (hash keys allowed, secrets blocked)
    ├── storage-client.ts      StorageClientPort + real @0gfoundation/0g-storage-ts-sdk
    │                          1.2.13 client (lazy import; ethers 6.13.1 signer)
    ├── evidence-store.ts      ZERO_G / MOCK / BLOCKED evidence stores; lint before
    │                          any key use; Galileo-16602 guard; typed failures with
    │                          mayHaveLanded + expectedRootHash on timeout
    ├── runtime.ts             createZeroGRuntime assembly + readiness()
    └── cli/
        ├── live-compute-check.ts   Router smoke test / p50-p95 spike (spends credits)
        └── live-storage-check.ts   Storage upload + proof-verified download
```

## 3. Contract with the other tracks

| Track | Port / module | How the adapter attaches |
|---|---|---|
| AI-01 policy engine | `IFleetBrain` port + `@dabbawala/policy-engine` | `brain.decide(state)` returns `{action, requestId}` or Halt. The caller then runs `validateAction(proposal, freshPolicySnapshot, now)`; only `valid === true` may affect movement or the gate. `requestId` is bound into pending actions/approval tokens (invariant §4.3.7). |
| ENS policy reader (C) | `IPolicyReader` port | The resume/policy rule is enforced at the call site: a fresh `readPolicy(robotId)` must succeed after every halt before a robot resumes (invariant §4.3.5). In the Hardhat stage `apps/api` builds the snapshot from the ENS stub; the swap-out to a real Sepolia viem reader does not touch the adapter. |
| Episode log writer (AI-05) | `EvidenceStore` | At episode end: `evidence.put({episodeId, robotId, kind:"episode-log", content: episodeJsonl})` then `evidence.put({kind:"provenance", content: provenanceToJsonl(provenance.list())})`. Built-in lint AND any injected extra lint (apps/api `log-lint`, key-aware wrapper) must pass before upload (invariants §4.3.10/11). |
| RelayLedger (B-4) | receipt from `put()` | `rootHash`/`txHash` returned by the network are the anchor inputs for the RelayLedger call; nothing is fabricated in MOCK/BLOCKED, so an unanchored episode is the safe default. |
| API (apps/api) | runtime + readiness | `createZeroGRuntime` built once at server start; `readiness()` served by `GET /v1/ready`; `POST /v1/internal/decide` exposes decide+policy-validation for the simulator in stage B-2. |

Halt codes stay inside the frozen `@dabbawala/shared` set: TIMEOUT→`ZG_TIMEOUT`,
transport/credentials→`ZG_TRANSPORT`, content failures→`ZG_MALFORMED`,
out-of-set/ungrounded→`ACTION_NOT_ALLOWED` (ROADMAP §4.4).

## 4. Repo fixes required for the port (from ref README integration notes)

1. **Manifest fix.** `packages/{application,domain,policy-engine,config,database,observability}`
   declare only an `import` condition in `exports` while their dist is CommonJS;
   any ESM consumer (`apps/api` is `"type":"module"`) fails with
   `ERR_PACKAGE_PATH_NOT_EXPORTED` on transitive requires. Add
   `"require": "./dist/index.js"` (same file) to each, matching
   `@dabbawala/shared`. The adapter's vitest aliases stay as a belt-and-braces
   for source-level test runs.
2. **`/v1/ready` truthfulness.** It currently hard-codes `zero_g_router: "ok"`.
   Wire it to `readiness()` (compute status + `proven`).
3. **apps/api dependencies.** `@0gfoundation/0g-storage-ts-sdk` + `ethers` are
   pinned in `apps/api` but unused there; they move to the dedicated package.

## 5. Environment variables (added to `.env.example`; names in code unchanged)

`ZERO_G_MODE`, `ZERO_G_STORAGE_PRIVATE_KEY` (distinct throwaway Galileo key —
AGENTS.md §11), plus the documented tuning variables: `ZERO_G_REQUEST_TIMEOUT_MS`,
`ZERO_G_RETRY_DELAY_MS`, `ZERO_G_MAX_RETRY_AFTER_MS`, `ZERO_G_MAX_OUTPUT_TOKENS`,
`ZERO_G_MAX_PROMPT_CHARS`, `ZERO_G_MAX_RESPONSE_BYTES`, `ZERO_G_MAX_CONCURRENT`,
`ZERO_G_JSON_MODE`, `ZERO_G_DISABLE_THINKING`, `ZERO_G_STORAGE_TIMEOUT_MS`,
`ZERO_G_MAX_EVIDENCE_BYTES`. `REPLACE_WITH_*` placeholders count as unset.

## 6. Operations (all HYPOTHESIS until a live run, ROADMAP §12 Q5/Q6)

- LIVE compute/storage is unverified at authorship time (no keys, no funds):
  status stays BLOCKED/“configured but not proven”. `live-compute-check` and
  `live-storage-check` are run by the key owner and spend Router credits / gas.
- Unknown model id (choose at pc.0g.ai), unknown `json_object` support, thinking
  tokens may eat `max_tokens` — all surfaced via typed halts, never guessed.

## 7. Acceptance

- `pnpm --filter @dabbawala/zero-g-adapter build && test && typecheck` green,
  including the ported test suite (config, prompt/proposal, fleet brain,
  evidence/lint, mock/BLOCKED stores, real-SDK offline, and the
  proposal→policy-engine integration test).
- `pnpm test:all` stays green (turbo gate, AGENTS.md §9).
- `GET /v1/ready` reports the real 0G status; `POST /v1/internal/decide` returns
  a proposal + policy verdict or a Halt, fail-closed in every negative case.
- `ref/` deleted only after every check is green (last task in tasks.md).
