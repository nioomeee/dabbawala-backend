# @dabbawala/zero-g-adapter

0G sponsor integration (AI-03). Proposal-only: **the model proposes, AI-01's policy engine decides.**

- `ZeroGFleetBrain implements IFleetBrain` over the **0G Compute Router** (OpenAI-compatible, `verify_tee: true`).
- `ZeroGStorageEvidenceStore` uploads episode evidence to **0G Storage** via `@0gfoundation/0g-storage-ts-sdk`.
- Explicit **LIVE / MOCK / BLOCKED** modes. No fake success anywhere.

THIS IS A SIMULATION PROJECT. Nothing here claims real-hardware deployment.

This package is the production port of the reference adapter (`ref/zero-g-adapter`,
deleted after the port). Module behaviour is identical; only paths and
documentation were adjusted. See root `implementations.md` and `tasks.md`.

## Status of the live operations

| Operation | Status | Why |
|---|---|---|
| Router chat completion with `verify_tee` | **BLOCKED (not run)** | No Router `sk-` key, funded balance, or model id supplied. Code, tests and startup validation are complete. |
| 0G Storage upload + proof download | **BLOCKED (not run)** | No funded Galileo testnet key supplied. Real SDK exercised offline only (Merkle root, failed upload to unreachable endpoints). |

Exact unblock inputs are listed under "Next action" of the original reference
effort; run them via the `live:compute` / `live:storage` scripts.

## Architecture

```
StateSummary -> validate+bound+sanitise -> prompt (state only as JSON data block)
   -> Router POST (verify_tee:true, temp 0, n=1, max_tokens cap, timeout)
   -> status/envelope/TEE check -> request id (ZG-Res-Key | id)
   -> strict closed-set parse (no extra keys) -> shared ActionSchema re-check
   -> grounding (routeId in availableRoutes, zoneId in restrictedZones)
   -> { action, requestId }  (a PROPOSAL)   or   Halt{reason}
   -> ProvenanceRecord -> sink (never contains prompt/model text/keys)

caller:  validateAction(action, freshPolicy, now)   // @dabbawala/policy-engine = the ONLY approver
```

Key decisions (unchanged from the reference design):

- **Retry**: at most one (`ZERO_G_MAX_RETRIES` from `@dabbawala/shared` = 1), only for TIMEOUT, NETWORK, HTTP 429/500/502/504, and TEE-unverified. 429 honours `Retry-After` up to `ZERO_G_MAX_RETRY_AFTER_MS`, else halts. Content failures (malformed, out-of-set, ungrounded, truncated) are **never** retried. No cached or local fallback; each `decide()` is a fresh Router call.
- **Halt mapping** (frozen codes from `@dabbawala/shared`): network/HTTP/blocked/concurrency -> halt code; non-JSON, bad envelope, missing id, TEE unverified, truncated, empty, schema failure, invalid state -> halt code; out-of-set type or ungrounded target -> `ACTION_NOT_ALLOWED`. Halt `detail` is a short code, never model or Router text.
- **TEE**: mandatory for LIVE. `tee_verified !== true` fails closed.
- **Storage**: lint before any key use; Galileo-only chain guard before the first tx; local Merkle root must equal returned root; typed failures (`mayHaveLanded` + `expectedRootHash` on timeout so you can `verifyStored` before re-spending). No automatic upload retry.
- Package is **ESM** (`"type":"module"`).

## Environment variables (names only)

| Variable | Req (LIVE) | Purpose / default |
|---|---|---|
| `ZERO_G_MODE` | no | `live` (default) or `mock`. `mock` is rejected when `NODE_ENV=production`. |
| `ZERO_G_ROUTER_BASE_URL` | compute | Router base incl. `/v1`. https only (http only for loopback, never in production). No creds/query in URL. |
| `ZERO_G_ROUTER_API_KEY` | compute | Router **`sk-`** API key. `mk-` rejected. Secret. |
| `ZERO_G_MODEL_ID` | compute | Model id from the Router catalog (pc.0g.ai). |
| `ZERO_G_REQUEST_TIMEOUT_MS` | no | Per-attempt deadline incl. body read. Default 20000 (1000-120000). |
| `ZERO_G_RETRY_DELAY_MS` | no | Default 250. |
| `ZERO_G_MAX_RETRY_AFTER_MS` | no | Cap on honoured `Retry-After`. Default 2000. |
| `ZERO_G_MAX_OUTPUT_TOKENS` | no | `max_tokens`. Default 2048. |
| `ZERO_G_MAX_PROMPT_CHARS` | no | Default 8000. |
| `ZERO_G_MAX_RESPONSE_BYTES` | no | Default 65536. |
| `ZERO_G_MAX_CONCURRENT` | no | Local in-flight cap. Default 4. |
| `ZERO_G_JSON_MODE` | no | Send `response_format: json_object`. Default false. |
| `ZERO_G_DISABLE_THINKING` | no | Send `chat_template_kwargs.enable_thinking=false` (GLM-5). Default false. |
| `ZERO_G_INDEXER_URL` | storage | Storage indexer (turbo testnet per SDK docs). |
| `ZERO_G_RPC_URL` | storage | Galileo EVM RPC. |
| `ZERO_G_CHAIN_ID` | storage | Must be `16602`; anything else => BLOCKED. |
| `ZERO_G_STORAGE_PRIVATE_KEY` | storage | Throwaway funded **Galileo testnet** key, distinct from Gatekeeper/robot/Spend Controller keys (AGENTS.md §11). Secret. |
| `ZERO_G_STORAGE_TIMEOUT_MS` | no | Default 120000. |
| `ZERO_G_MAX_EVIDENCE_BYTES` | no | Default 1048576. |

`REPLACE_WITH_*` placeholders are treated as unset.

## Local setup

```bash
pnpm install
pnpm --filter @dabbawala/zero-g-adapter build
pnpm --filter @dabbawala/zero-g-adapter test
pnpm --filter @dabbawala/zero-g-adapter typecheck
```

MOCK (offline, tests/dev only; every record is labelled MOCK, ids prefixed `MOCK-`, no TEE/provider/billing invented, storage receipts carry null ids):

```bash
ZERO_G_MODE=mock node -e "import('./packages/zero-g-adapter/dist/index.js').then(async m=>{const r=m.createZeroGRuntime(process.env);console.log(r.value.readiness())})"
```

## Live verification (run by the key owner; spends credits/gas)

Never paste keys into chat; export them in your shell or secret manager.

```bash
# Compute: 1 call, or --count 20 for the S-0G p50/p95 spike (max 50). SPENDS ROUTER CREDITS.
export ZERO_G_ROUTER_BASE_URL=... ZERO_G_ROUTER_API_KEY=... ZERO_G_MODEL_ID=...
pnpm --filter @dabbawala/zero-g-adapter build
node packages/zero-g-adapter/dist/cli/live-compute-check.js --count 1
# exit 0 = TEE-verified proposal; 1 = halted; 2 = BLOCKED; 3 = bad config

# Storage: uploads one synthetic JSONL object, prints rootHash/txHash, downloads with proof, compares hash.
export ZERO_G_INDEXER_URL=... ZERO_G_RPC_URL=... ZERO_G_CHAIN_ID=16602 ZERO_G_STORAGE_PRIVATE_KEY=...
node packages/zero-g-adapter/dist/cli/live-storage-check.js
```

Raw curl equivalent of the compute call (docs shape), key from the environment:

```bash
curl -sS -D - "$ZERO_G_ROUTER_BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ZERO_G_ROUTER_API_KEY" \
  -d "{\"model\":\"$ZERO_G_MODEL_ID\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with {\\\"type\\\":\\\"handoff\\\"}\"}],\"verify_tee\":true,\"max_tokens\":64}"
# look for header  ZG-Res-Key: <chatID>   and body  x_0g_trace.tee_verified: true
```

Evidence to capture for the 0G submission once run: `ZG-Res-Key`, `x_0g_trace.request_id`, `provider`, `tee_verified`, latency p50/p95, Storage `rootHash` + `txHash` + StorageScan/ChainScan link.

## Usage in this repo

```ts
import { createZeroGRuntime, provenanceToJsonl } from "@dabbawala/zero-g-adapter";
import { validateAction } from "@dabbawala/policy-engine";
import type { AdapterLogger } from "@dabbawala/zero-g-adapter";

const rt = createZeroGRuntime(process.env, { logger });
if (!rt.ok) throw new Error(`0G config invalid: ${rt.error.map((i) => i.variable).join(",")}`);
const { brain, evidence, provenance, readiness } = rt.value;

const d = await brain.decide(state);                 // IFleetBrain
if ("halted" in d) { /* safe-stop with d.reason; resume only after a fresh successful call + fresh policy read */ }
else {
  const v = validateAction(d.action, await policyReader.readPolicy(state.robotId), Date.now());
  // only v.valid === true may affect movement/gate; bind d.requestId into the pending action/token
}
// end of episode
await evidence.put({ episodeId, robotId, kind: "episode-log", content: episodeJsonl });
await evidence.put({ episodeId, robotId, kind: "provenance", content: provenanceToJsonl(provenance.list()) });
```

`apps/api` wires this automatically: the runtime is built once in `buildApp`,
`GET /v1/ready` serves `readiness()`, and `POST /v1/internal/decide` runs
decide → `validateAction` against the stub policy snapshot (fail closed).

`readiness()` for `/v1/ready`: `compute.status` and `storage.status` are `LIVE | MOCK | BLOCKED`; `compute.proven` is true only after a real TEE-verified call in this process; `networkProbed` is always false.

## Failure runbook

| Symptom (halt `detail` / receipt kind) | Meaning | Action |
|---|---|---|
| `ADAPTER_BLOCKED:<VARS>` / `STORAGE_BLOCKED:<VARS>` | Env vars missing; no call made | Set the named vars (values in secret manager). |
| `ROUTER_AUTH_FAILED` (401) | Bad/revoked key | Issue new `sk-` key at pc.0g.ai, rotate secret. Not retried. |
| `ROUTER_INSUFFICIENT_BALANCE` (402) | Router deposit empty | Top up at pc.0g.ai (owner action). Not retried. |
| `ROUTER_FORBIDDEN` (403) | Key lacks permission / wrong key type | Use `sk-` key. |
| `ROUTER_BAD_REQUEST` (400) | Unsupported param for this model | Turn off `ZERO_G_JSON_MODE` / `ZERO_G_DISABLE_THINKING`; check model id. |
| `ROUTER_NO_PROVIDER` (503) | No healthy provider for model | Choose another model; robot stays halted. |
| `ROUTER_RATE_LIMITED` (429) | Rate limit | Reduce load; honoured `Retry-After` once. |
| `ATTEMPT_DEADLINE_EXCEEDED` | Deadline hit twice | Raise `ZERO_G_REQUEST_TIMEOUT_MS`. |
| `TEE_SIGNATURE_INVALID` / `TEE_VERDICT_MISSING` | Provider signature failed / no verdict | Treat response as untrusted; do not bypass. |
| `FINISH_REASON_LENGTH` | Output truncated | Raise `ZERO_G_MAX_OUTPUT_TOKENS` or disable thinking. |
| `ACTION_TYPE_NOT_IN_CLOSED_SET`, `ROUTE_NOT_OFFERED`, `ZONE_NOT_OFFERED` | Model proposed outside the set/offered list | Expected under injection; robot halts. |
| Storage `LINT_BLOCKED` | Secret/PII-shaped content in evidence | Fix the producer; never bypass. |
| Storage `CHAIN_MISMATCH` | RPC is not Galileo 16602 | Fix `ZERO_G_RPC_URL`. No tx was sent. |
| Storage `TIMEOUT` (`mayHaveLanded`) | Upload outcome unknown | Call `verifyStored(expectedRootHash, contentSha256)`; only re-`put` if it fails. Mark episode `unanchored` meanwhile. |
| Storage `ROOT_MISMATCH` / `BAD_RESULT` | SDK returned unexpected ids | Do not anchor; file a bug with `expectedRootHash`. |

Resume policy (invariant 5) belongs to the caller: resume after a halt only after a fresh successful `decide()` **and** a fresh policy read.

## Security notes

- Key lives only in the transport closure; `redirect:"error"`; never logged, never in prompts/provenance (tested).
- Prompt injection cannot be fully prevented. Defences are deterministic: bounded identifiers, sanitised free text, closed-set strict parsing, grounding, then the policy engine.
- Not security-audited; not production-ready without independent review.
