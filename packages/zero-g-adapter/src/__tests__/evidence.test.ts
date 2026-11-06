 
import { describe, expect, it, vi } from "vitest";
import { lintEvidence, checkJsonl } from "../evidence-lint.js";
import {
  BlockedEvidenceStore,
  MockEvidenceStore,
  ZeroGStorageEvidenceStore,
  type EvidenceInput,
} from "../evidence-store.js";
import { StorageClientError, type StorageClientPort } from "../storage-client.js";
import { FAKE_API_KEY, FAKE_PK } from "./helpers.js";

const ROOT = "0x" + "11".repeat(32);
const TX = "0x" + "22".repeat(32);

const SETTINGS = { indexerUrl: "https://i.invalid", rpcUrl: "https://r.invalid", chainId: 16602, timeoutMs: 100, maxEvidenceBytes: 4096 };
const SECRETS = { routerApiKey: FAKE_API_KEY, storagePrivateKey: FAKE_PK };

const GOOD: EvidenceInput = {
  episodeId: "ep-001",
  robotId: "ramu",
  kind: "episode-log",
  content:
    JSON.stringify({ seq: 1, type: "decision", requestId: "zg-key-1", txId: TX, policyHash: ROOT }) + "\n",
};

function fakeClient(over: Partial<StorageClientPort> = {}): StorageClientPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    chainId: () => { calls.push("chainId"); return Promise.resolve(16602n); },
    merkleRoot: () => { calls.push("merkleRoot"); return Promise.resolve(ROOT); },
    upload: () => { calls.push("upload"); return Promise.resolve({ rootHash: ROOT, txHash: TX, txSeq: 7 }); },
    download: () => { calls.push("download"); return Promise.resolve(new TextEncoder().encode(GOOD.content)); },
    close: () => Promise.resolve(),
    ...over,
  };
}

const store = (c: StorageClientPort, extra: Partial<ConstructorParameters<typeof ZeroGStorageEvidenceStore>[0]> = {}) =>
  new ZeroGStorageEvidenceStore({ client: c, settings: SETTINGS, secrets: SECRETS, ...extra });

describe("evidence lint", () => {
  it("accepts hashes under hash-bearing keys, Hedera ids and normal logs", () => {
    const line = JSON.stringify({ rootHash: ROOT, txId: "0.0.123@1700000000.123456789", detail: "policy paused for robot" });
    expect(lintEvidence(line).ok).toBe(true);
  });
  it.each([
    ["private key under a normal key", { detail: FAKE_PK }, "private-key-hex"],
    ["bearer token", { detail: "Authorization: Bearer abcdefghij1234567890" }, "bearer-token"],
    ["router key", { note: "key " + FAKE_API_KEY }, "router-key"],
    ["dsn with credentials", { x: "postgresql://user:pw@host/db" }, "db-dsn-with-credentials"],
    ["api key assignment", { x: "api_key=abcdef123456" }, "api-key-assignment"],
    ["pem", { x: "-----BEGIN PRIVATE KEY-----" }, "pem-block"],
    ["mnemonic", { x: "abandon ability able about above absent absorb abstract absurd abuse access accident" }, "mnemonic-shaped"],
    ["email (personal data)", { x: "contact alice.smith@example.com now" }, "email-address"],
    ["embedded hex", { x: "k=" + FAKE_PK + " end" }, "embedded-hex-64"],
  ])("blocks %s without echoing it", (_n, obj, pattern) => {
    const r = lintEvidence(JSON.stringify(obj));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.pattern)).toContain(pattern);
    expect(JSON.stringify(r)).not.toContain("abcdef123456");
    expect(JSON.stringify(r)).not.toContain(FAKE_PK);
  });
  it("checkJsonl rejects empty / non-object lines", () => {
    expect(checkJsonl("").ok).toBe(false);
    expect(checkJsonl("[1]\n").ok).toBe(false);
    expect(checkJsonl("not json\n").ok).toBe(false);
    expect(checkJsonl('{"a":1}\n{"b":2}\n')).toEqual({ ok: true, lines: 2 });
  });
});

describe("ZeroGStorageEvidenceStore (LIVE path, fake SDK client)", () => {
  it("returns the identifiers the network returned", async () => {
    const c = fakeClient();
    const r = await store(c).put(GOOD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      mode: "LIVE", rootHash: ROOT, txHash: TX, txSeq: 7, expectedRootHash: ROOT, chainId: 16602,
      episodeId: "ep-001", robotId: "ramu", kind: "episode-log", lines: 1,
    });
    expect(r.value.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(c.calls).toEqual(["merkleRoot", "chainId", "upload"]);
  });

  it("checks the chain id once, not per upload", async () => {
    const c = fakeClient();
    const s = store(c);
    await s.put(GOOD); await s.put(GOOD);
    expect(c.calls.filter((x) => x === "chainId")).toHaveLength(1);
  });

  it("lint failure happens BEFORE any key/network use", async () => {
    const c = fakeClient();
    const bad = { ...GOOD, content: JSON.stringify({ detail: FAKE_PK }) + "\n" };
    const r = await store(c).put(bad);
    expect(r).toMatchObject({ ok: false, error: { kind: "LINT_BLOCKED" } });
    expect(c.calls).toEqual([]);
  });

  it("injected AI-01 log-lint must also pass", async () => {
    const c = fakeClient();
    const extraLint = vi.fn(() => ({ ok: false as const, findings: [{ pattern: "x", path: "line1" }] }));
    const r = await store(c, { extraLint }).put(GOOD);
    expect(r).toMatchObject({ ok: false, error: { kind: "LINT_BLOCKED", detail: "LINT_EXTRA" } });
    expect(extraLint).toHaveBeenCalledOnce();
    expect(c.calls).toEqual([]);
  });

  it.each([
    ["non-JSONL", { ...GOOD, content: "hello\n" }, "INVALID_INPUT"],
    ["empty", { ...GOOD, content: "" }, "INVALID_INPUT"],
    ["bad episode id", { ...GOOD, episodeId: "../x" }, "INVALID_INPUT"],
    ["too large", { ...GOOD, content: JSON.stringify({ a: "x".repeat(5000) }) + "\n" }, "TOO_LARGE"],
  ])("rejects %s without touching the network", async (_n, input, kind) => {
    const c = fakeClient();
    const r = await store(c).put(input);
    expect(r).toMatchObject({ ok: false, error: { kind } });
    expect(c.calls).toEqual([]);
  });

  it("refuses a non-Galileo RPC before sending any transaction", async () => {
    const c = fakeClient({ chainId: () => Promise.resolve(16661n) });
    const r = await store(c).put(GOOD);
    expect(r).toMatchObject({ ok: false, error: { kind: "CHAIN_MISMATCH", expectedRootHash: ROOT, mayHaveLanded: false } });
    expect(c.calls).not.toContain("upload");
  });

  it("upload timeout: mayHaveLanded + expected root for safe re-verify", async () => {
    const c = fakeClient({ upload: () => new Promise(() => undefined) });
    const r = await store(c).put(GOOD);
    expect(r).toMatchObject({ ok: false, error: { kind: "TIMEOUT", mayHaveLanded: true, expectedRootHash: ROOT } });
  });

  it("SDK error is classified, scrubbed of secrets and URLs", async () => {
    const c = fakeClient({
      upload: () => Promise.reject(new StorageClientError("SDK_ERROR", `upload: failed at https://rpc.example/key123 using ${FAKE_PK}`)),
    });
    const r = await store(c).put(GOOD);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("SDK_ERROR");
    expect(r.error.mayHaveLanded).toBe(true);
    expect(JSON.stringify(r.error)).not.toContain(FAKE_PK);
    expect(JSON.stringify(r.error)).not.toContain("key123");
  });

  it("root mismatch between local and returned root is an error", async () => {
    const c = fakeClient({ upload: () => Promise.resolve({ rootHash: "0x" + "99".repeat(32), txHash: TX, txSeq: 1 }) });
    expect(await store(c).put(GOOD)).toMatchObject({ ok: false, error: { kind: "ROOT_MISMATCH" } });
  });

  it("malformed identifiers from the SDK are rejected (nothing fabricated)", async () => {
    const c = fakeClient({ upload: () => Promise.resolve({ rootHash: ROOT, txHash: "nope", txSeq: 1 }) });
    expect(await store(c).put(GOOD)).toMatchObject({ ok: false, error: { kind: "BAD_RESULT" } });
  });

  it("fragmented results are surfaced as FRAGMENTED_RESULT", async () => {
    const c = fakeClient({ upload: () => Promise.reject(new StorageClientError("FRAGMENTED_RESULT", "x")) });
    expect(await store(c).put(GOOD)).toMatchObject({ ok: false, error: { kind: "FRAGMENTED_RESULT" } });
  });

  it("verifyStored compares downloaded content hash", async () => {
    const c = fakeClient();
    const s = store(c);
    const put = await s.put(GOOD);
    if (!put.ok) throw new Error("x");
    expect((await s.verifyStored(ROOT, put.value.contentSha256)).ok).toBe(true);
    expect(await s.verifyStored(ROOT, "0".repeat(64))).toMatchObject({ ok: false, error: { kind: "VERIFY_MISMATCH" } });
    expect(await s.verifyStored("bad", "x")).toMatchObject({ ok: false, error: { kind: "INVALID_INPUT" } });
  });
});

describe("MOCK and BLOCKED stores", () => {
  it("MOCK receipts carry no network identifiers and are labelled MOCK", async () => {
    const m = new MockEvidenceStore({ maxEvidenceBytes: 4096 });
    const r = await m.put(GOOD);
    expect(r.ok && r.value).toMatchObject({ mode: "MOCK", rootHash: null, txHash: null, txSeq: null, chainId: null });
  });
  it("MOCK still enforces lint", async () => {
    const m = new MockEvidenceStore({ maxEvidenceBytes: 4096 });
    expect(await m.put({ ...GOOD, content: JSON.stringify({ d: FAKE_PK }) + "\n" })).toMatchObject({ ok: false });
  });
  it("BLOCKED names env vars, does nothing", async () => {
    const b = new BlockedEvidenceStore(["ZERO_G_STORAGE_PRIVATE_KEY"]);
    expect(await b.put(GOOD)).toMatchObject({ ok: false, error: { kind: "BLOCKED", detail: "STORAGE_BLOCKED:ZERO_G_STORAGE_PRIVATE_KEY" } });
  });
});
