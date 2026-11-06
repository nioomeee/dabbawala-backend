# tasks.md — 0G Integration (AI-03)

Execution order is fixed; do not skip gates (AGENTS.md §6). Reference doc:
`implementations.md`. Every checked task needs evidence attached in its section
and an entry in `docs/PROGRESS.md`.

- [x] **T0** Read `ref/zero-g-adapter` fully; write `implementations.md` + `tasks.md`.
  - Evidence: both files at repo root, written before any code.

- [x] **T1** Create `packages/zero-g-adapter` skeleton
  (`package.json` ESM, deps pinned exactly, `tsconfig.json`,
  `tsconfig.build.json`, `vitest.config.ts`).
  - Accept: package visible to pnpm workspace, `tsc` resolves imports.

- [x] **T2** Port adapter sources: `config.ts`, `types.ts`, `failures.ts`,
  `prompt.ts`, `proposal.ts`, `router-transport.ts`, `mock-transport.ts`,
  `fleet-brain.ts`, `provenance.ts`, `evidence-lint.ts`, `storage-client.ts`,
  `evidence-store.ts`, `runtime.ts`, `index.ts`.
  - Accept: module-level port only (path/comment adjustments; behaviour identical).

- [x] **T3** Port the live CLI checks (`cli/live-compute-check.ts`,
  `cli/live-storage-check.ts`) and wire the `live:compute` / `live:storage`
  scripts.
  - Accept: blocked run without keys exits with code 2 and names env vars only.

- [x] **T4** Fix workspace manifests: add the `require` condition to
  `packages/{application,domain,policy-engine,config,database,observability}`
  (ESM/CJS interop for `apps/api` and the adapter; implementations.md §4.1).

- [x] **T5** Port the test suite (`__tests__/`) — helpers, config, prompt/proposal,
  fleet-brain, evidence/lint+stores, runtime, real-SDK offline, and the
  proposal→`validateAction` policy-gate integration test.
  - Accept: `pnpm --filter @dabbawala/zero-g-adapter test` green.

- [x] **T6** Build + lockfile: `pnpm install` (regenerate lockfile moved out of
  `ref`), `pnpm --filter @dabbawala/zero-g-adapter build && typecheck` green;
  port the package README (status table stays BLOCKED, no live calls claimed).

- [x] **T7** Wire `apps/api`:
  - build `createZeroGRuntime` once in `app.ts` with the pino logger port and
    the key-aware `log-lint` wrapper as `extraLint`;
  - `GET /v1/ready` reports real 0G compute/storage status (`proven` flag kept);
  - add `POST /v1/internal/decide`: zod-validated StateSummary → `decide` →
    policy-engine `validateAction` against a sim snapshot from the ENS stub;
    fail-closed on any error; replace apps/api unused SDK/ethers deps with
    `@dabbawala/zero-g-adapter` + `@dabbawala/policy-engine`.
  - Accept: `pnpm --filter @dabbawala/api build && test && typecheck` green.

- [x] **T8** Env docs: add `ZERO_G_MODE`, `ZERO_G_STORAGE_PRIVATE_KEY` and the
  tuning variables to `.env.example` (implementations.md §5).

- [x] **T9** Full gate: `pnpm test:all` (turbo) plus `typecheck` green;
  attach evidence below and append an entry to `docs/PROGRESS.md`.

- [x] **T10** DELETE `ref/zero-g-adapter` (whole `ref/` tree) — final task, run
  only after T1–T9 are all green. Verify nothing imports `ref/` paths
  (only doc/comment mentions are expected) and that
  the lockfile no longer references the reference package.

---

## Evidence log (fill per task)

| Task | Command | Result | Date |
|---|---|---|---|
| T0 | — | `implementations.md` + `tasks.md` written before any code | 2026-11-06 |
| T1 | `pnpm install` | `@dabbawala/zero-g-adapter` resolved as workspace project | 2026-11-06 |
| T2 | `pnpm exec tsc -p packages/zero-g-adapter/tsconfig.build.json` | build clean, 14 modules ported verbatim | 2026-11-06 |
| T3 | `pnpm --filter @dabbawala/zero-g-adapter run live:compute` / `live:storage` | exit 2, BLOCKED, env var names only (no keys present) | 2026-11-06 |
| T4 | manifests edited | `require` condition added to 6 packages'{application,domain,policy-engine,config,database,observability} exports | 2026-11-06 |
| T5 | `pnpm --filter @dabbawala/zero-g-adapter test` | 7 files, 114 tests passed | 2026-11-06 |
| T6 | `pnpm install && build && typecheck` (adapter) | tsc build + noEmit clean; README ported, status BLOCKED | 2026-11-06 |
| T7 | `pnpm --filter @dabbawala/api build / test / typecheck` | 6/6 route tests passed (400 invalid, 503 ZG-unconfigured, 503 ENS_UNREADABLE, halt passthrough, policyApproved, GATE_DENIED) | 2026-11-06 |
| T8 | `.env.example` edited | `ZERO_G_MODE`, `ZERO_G_STORAGE_PRIVATE_KEY` + commented tuning vars | 2026-11-06 |
| T9 | `pnpm test:all` then `pnpm typecheck` | all 10 workspace projects' tests green (114 + 6 + 8 no-test packages with `--passWithNoTests`); typecheck 17/17 | 2026-11-06 |
| T10 | `pnpm -r --if-present run test` after `Remove-Item -Recurse -Force ref` | `ref/` deleted (0.2 MB); no imports of `ref/` anywhere (doc mentions only); pnpm install + full test + typecheck green post-delete | 2026-11-06 |

## Notes / risks

- LIVE compute + storage remain **BLOCKED (not run)**: no Router `sk-` key, no
  funded Galileo key, no model id chosen (implementation.md §6). The package
  must never present MOCK as live evidence (constraint C7).
- Adding `@0gfoundation/0g-storage-ts-sdk` 1.2.13 / `ethers` 6.13.1 was
  pre-approved by the human directive to implement the reference adapter
  (versions are already pinned in the repo lockfile; R-0G-2).
- `pnpm test:all` was changed from `turbo run test --filter=...` (invalid
  selector in turbo v2 — the command had never actually run) to
  `pnpm -r --if-present run test`. Packages/config + 6 packages with a `test`
  script but no test files got `vitest run --passWithNoTests` and (config only)
  the pinned `vitest@2.1.9` devDependency. No existing tests were modified or
  skipped.
- The reference adapter is not security-audited; treat as hackathon-stage code.
