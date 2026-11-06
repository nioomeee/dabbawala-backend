# @dabbawala/zero-g-adapter

0G sponsor integration (AI-03). Proposal-only: **the model proposes, AI-01's policy engine decides.**

- `ZeroGFleetBrain implements IFleetBrain` over the **0G Compute Router** (OpenAI-compatible, `verify_tee: true`).
- `ZeroGStorageEvidenceStore` uploads episode evidence to **0G Storage** via `@0gfoundation/0g-storage-ts-sdk`.
- Explicit **LIVE / MOCK / BLOCKED** modes. No fake success anywhere.

THIS IS A SIMULATION PROJECT. Nothing here claims real-hardware deployment.

## Status of the live operations

| Operation | Status | Why |
|---|---|---|
| Router chat completion with `verify_tee` | **BLOCKED (not run)** | No Router `sk-` key, funded balance, or model id supplied. Code, tests and startup validation are complete. |
| 0G Storage upload + proof download | **BLOCKED (not run)** | No funded Galileo testnet key supplied. Real SDK was exercised offline only (Merkle root, failed upload to unreachable endpoints). |

Exact unblock inputs are listed under "Next action".

## Verified 0G facts (fetched live from docs.0g.ai, 2026-11-04)

| Item | Verified value | Source page |
|---|---|---|
| Router endpoint | `POST https://router-api.0g.ai/v1/chat/completions` (OpenAI-compatible) | Router Quickstart; Chat Completions |
| Auth | `Authorization: Bearer sk-...` (API key). `mk-` management keys cannot call inference (403). No wallet signature per request. | Router Authentication |
| TEE flag | Body field `"verify_tee": true` (Router extension, stripped before the provider) | Verifiable Execution |
| Request id | `ZG-Res-Key` response header; body `id` is the documented fallback | Verifiable Execution |
| Trace block | `x_0g_trace.{request_id, provider, billing.{input,output,total}_cost, tee_verified}` | Chat Completions; Verifiable Execution |
| `tee_verified` | `true` verified; `false` present-but-invalid (treat as untrusted); `null`/absent = not requested | Verifiable Execution |
| Errors | `{error:{message,type,code},request_id}`; 400/401/402/403/404/429/502/503; retry 429 (Retry-After) and 502; never 400/401/402/403; 503 unlikely to clear in seconds | Router Errors |
| Storage SDK | `@0gfoundation/0g-storage-ts-sdk` **1.2.13** (npm, verified), peer `ethers` **6.13.1** (exact) | npm registry; Storage SDK page |
| Storage flow | `new MemData(bytes)` -> `merkleTree()` -> `indexer.upload(mem, RPC_URL, signer)` -> `[{txHash, rootHash, txSeq}, err]`; flow contract auto-discovered from indexer | Storage SDK page; installed `.d.ts` |
| Galileo testnet | chain id **16602**, RPC `https://evmrpc-testnet.0g.ai` (dev only), faucet `https://faucet.0g.ai` | Testnet overview |
| Turbo indexer | `https://indexer-storage-testnet-turbo.0g.ai` | Storage SDK page |

### UNKNOWN / needs the key owner (not guessed)

1. **Is `router-api.0g.ai` funded with real-value tokens?** Router docs describe depositing "0G tokens" at pc.0g.ai and show only `router-api.0g.ai`. No testnet Router URL was found in official docs. AGENTS.md §11 says testnets only: **confirm the funds behind the key carry no real value before any live call.** `ZERO_G_ROUTER_BASE_URL` is deliberately not defaulted in code.
2. **Model id.** Docs examples use `glm-5.2` (an older doc revision showed `zai-org/GLM-5-FP8`). Choose from https://pc.0g.ai/models. `ZERO_G_MODEL_ID` has no default.
3. Whether the chosen model honours `response_format: json_object` (`ZERO_G_JSON_MODE`, default off) and, for GLM-5, `chat_template_kwargs.enable_thinking` (`ZERO_G_DISABLE_THINKING`, default off). Thinking tokens may consume `max_tokens`; if you see `TRUNCATED` halts, raise `ZERO_G_MAX_OUTPUT_TOKENS` or disable thinking. HYPOTHESIS until a live run.
4. Storage access restriction (REFERENCES F16) remains UNKNOWN: treat every upload as public and permanent.

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

Decisions:

- **Retry**: at most one (`ZERO_G_MAX_RETRIES = 1`), only for TIMEOUT, NETWORK, HTTP 429/500/502/504, and TEE-unverified (another provider may serve the retry). 429 honours `Retry-After` up to `ZERO_G_MAX_RETRY_AFTER_MS`, else halts. Content failures (malformed, out-of-set, ungrounded, truncated) are **never** retried (re-sampling an untrusted model is prompt-shopping). No cached or local fallback; each `decide()` is a fresh Router call.
- **Halt mapping** (closed set, `@dabbawala/shared` unchanged): TIMEOUT -> `ZG_TIMEOUT`; network/HTTP/blocked/concurrency -> `ZG_TRANSPORT`; non-JSON, bad envelope, missing id, TEE unverified, truncated, empty, schema failure, invalid state -> `ZG_MALFORMED`; out-of-set type or ungrounded target -> `ACTION_NOT_ALLOWED`. Halt `detail` is a short code, never model or Router text.
- **TEE**: mandatory for LIVE. `tee_verified !== true` fails closed. Trust model per docs: this is the *Router's* attestation of the provider signature; independent verification (`broker.inference.processResponse(provider, ZG-Res-Key)` with `@0gfoundation/0g-compute-ts-sdk`) is possible with the recorded `provider` + `zgResKey` but is **not implemented here**.
- **DecideResult is frozen**, so provider/model/latency/status/TEE live in `ProvenanceRecord` via `decideWithProvenance()` and a `ProvenanceSink`.
- **Storage**: lint (built-in structural lint AND optional injected AI-01 `log-lint`) before any key use; Galileo-only chain guard before the first tx; local Merkle root must equal returned root; typed failures (`mayHaveLanded` + `expectedRootHash` on timeout so you can `verifyStored` before re-spending). No automatic upload retry (a retry after an ambiguous timeout could double-spend gas); retrying `put()` with the same bytes yields the same root.
- Package is **ESM** (`"type":"module"`) because the workspace libs only export an `import` condition (see Integration notes).

## Environment variables (names only)

| Variable | Req (LIVE) | Purpose / default |
|---|---|---|
| `ZERO_G_MODE` | no | `live` (default) or `mock`. `mock` is rejected when `NODE_ENV=production`. |
| `ZERO_G_ROUTER_BASE_URL` | compute | Router base incl. `/v1`. https only (http only for loopback, never in production). No creds/query in URL. |
| `ZERO_G_ROUTER_API_KEY` | compute | Router **`sk-`** API key. `mk-` rejected. Secret. |
| `ZERO_G_MODEL_ID` | compute | Model id from the Router catalog. |
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
| `ZERO_G_STORAGE_PRIVATE_KEY` | storage | **NEW name.** Throwaway funded **Galileo testnet** key, distinct from Gatekeeper/robot/Spend Controller keys (AGENTS.md §11). Secret. |
| `ZERO_G_STORAGE_TIMEOUT_MS` | no | Default 120000. |
| `ZERO_G_MAX_EVIDENCE_BYTES` | no | Default 1048576. |
| `ZERO_G_STORAGE_NODE_URL` | no | Existing var; **not used** (indexer selects nodes). |

`REPLACE_WITH_*` placeholders are treated as unset. Proposed `.env.example` additions (root file, not edited): `ZERO_G_MODE`, `ZERO_G_STORAGE_PRIVATE_KEY`, plus the optional tuning vars above.

## Local setup

```bash
pnpm install            # integration owner regenerates the lockfile once
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

## Usage

```ts
import { createZeroGRuntime, provenanceToJsonl } from "@dabbawala/zero-g-adapter";
import { validateAction } from "@dabbawala/policy-engine";

const rt = createZeroGRuntime(process.env, { logger, extraLint: lintEpisodeLog /* AI-01 log-lint, adapted */ });
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

`readiness()` for `/v1/ready`: `compute.status` and `storage.status` are `LIVE | MOCK | BLOCKED`; `compute.proven` is true only after a real TEE-verified call in this process; `networkProbed` is always false.

## Failure runbook

| Symptom (halt `detail` / receipt kind) | Meaning | Action |
|---|---|---|
| `ADAPTER_BLOCKED:<VARS>` / `STORAGE_BLOCKED:<VARS>` | Env vars missing; no call made | Set the named vars (values in secret manager). |
| `ROUTER_AUTH_FAILED` (401) | Bad/revoked key (`invalid_api_key`, `api_key_revoked`) | Issue new `sk-` key at pc.0g.ai, rotate secret. Not retried. |
| `ROUTER_INSUFFICIENT_BALANCE` (402) | Router deposit empty | Top up at pc.0g.ai (owner action). Not retried. |
| `ROUTER_FORBIDDEN` (403) | Key lacks permission / wrong key type | Use `sk-` key. |
| `ROUTER_BAD_REQUEST` (400) | Unsupported param for this model | Turn off `ZERO_G_JSON_MODE` / `ZERO_G_DISABLE_THINKING`; check model id. |
| `ROUTER_NO_PROVIDER` (503) | No healthy provider for model | Choose another model; robot stays halted. |
| `ROUTER_RATE_LIMITED` (429) | Rate limit | Reduce load; honoured `Retry-After` once. |
| `ZG_TIMEOUT` | Deadline hit twice | Raise `ZERO_G_REQUEST_TIMEOUT_MS`; check S-0G p95. |
| `TEE_SIGNATURE_INVALID` / `TEE_VERDICT_MISSING` | Provider signature failed / no verdict | Treat response as untrusted; try another model/provider; do not bypass. |
| `FINISH_REASON_LENGTH` | Output truncated | Raise `ZERO_G_MAX_OUTPUT_TOKENS` or disable thinking. |
| `ACTION_TYPE_NOT_IN_CLOSED_SET`, `ROUTE_NOT_OFFERED`, `ZONE_NOT_OFFERED` | Model proposed something outside the set/offered list | Expected under injection; robot halts. Investigate prompt/hints. |
| Storage `LINT_BLOCKED` | Secret/PII-shaped content in evidence | Fix the producer; never bypass. Findings list pattern + JSON path only. |
| Storage `CHAIN_MISMATCH` | RPC is not Galileo 16602 | Fix `ZERO_G_RPC_URL`. No tx was sent. |
| Storage `TIMEOUT` (`mayHaveLanded`) | Upload outcome unknown | Call `verifyStored(expectedRootHash, contentSha256)`; only re-`put` if it fails. Mark episode `unanchored` meanwhile. |
| Storage `ROOT_MISMATCH` / `BAD_RESULT` | SDK returned unexpected ids | Do not anchor; file a bug with `expectedRootHash`. |

Resume policy (invariant 5) belongs to the caller: resume after a halt only after a fresh successful `decide()` **and** a fresh policy read.

## Integration notes / pre-existing repo issues found (not edited)

1. Workspace libs (`shared`, `domain`, `application`, `policy-engine`) are CJS-compiled but their `exports` only declare `import`/`types`. ESM consumers can load `shared`, but **`@dabbawala/policy-engine` dist cannot be loaded at runtime** (`ERR_PACKAGE_PATH_NOT_EXPORTED` resolving `@dabbawala/domain`). Fix in those manifests (add `"default"`/`"require"`, or `"type":"module"`). This package's tests alias them to source.
2. Root `eslint.config.js` fails at baseline: imports `@eslint/js`/`typescript-eslint` (undeclared in root devDependencies) and references removed rule `@typescript-eslint/no-throw-literal` (now `only-throw-error`). This package was linted with a scratch-corrected copy.
3. `apps/api/src/routes/v1/health.ts` `/ready` hard-codes `zero_g_router: "ok"`. Wire it to `readiness()`.
4. A dedicated halt code for TEE failure (`ZG_TEE_UNVERIFIED`) would be clearer than `ZG_MALFORMED`; needs a Chief-approved `shared` change.
5. AI-01's `log-lint` flags any `0x`+64-hex string (including legitimate `txHash`/`rootHash`) and its 12-word regex is broad; this package's lint is key-aware. If both are injected, hash-bearing fields may be rejected by the old one.

## Security notes

- Key lives only in the transport closure; `redirect:"error"`; never logged, never in prompts/provenance (tested).
- Prompt injection cannot be fully prevented. Defences are deterministic: bounded identifiers, sanitised free text, closed-set strict parsing, grounding, then the policy engine.
- Not security-audited; not production-ready without independent review.
