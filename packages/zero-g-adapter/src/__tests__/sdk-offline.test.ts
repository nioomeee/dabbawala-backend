 
/**
 * Exercises the REAL @0gfoundation/0g-storage-ts-sdk 1.2.13 + ethers 6.13.1
 * with no network credentials: proves the SDK loads under this package's ESM
 * setup, that merkleRoot is deterministic, and that a real upload attempt
 * against unreachable endpoints fails closed with a typed error.
 * This is NOT a live 0G call.
 */
import { describe, expect, it } from "vitest";
import { SdkStorageClient } from "../storage-client.js";
import { ZeroGStorageEvidenceStore } from "../evidence-store.js";
import { FAKE_PK } from "./helpers.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("real SDK, offline", () => {
  it("computes a deterministic 0x-64-hex merkle root", async () => {
    const c = new SdkStorageClient({ indexerUrl: "http://127.0.0.1:1", rpcUrl: "http://127.0.0.1:1" });
    const a = await c.merkleRoot(enc('{"a":1}\n'));
    const b = await c.merkleRoot(enc('{"a":1}\n'));
    const d = await c.merkleRoot(enc('{"a":2}\n'));
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(d);
    await c.close();
  });

  it("upload against unreachable chain/indexer fails closed (typed, bounded, no throw)", async () => {
    const client = new SdkStorageClient({ indexerUrl: "http://127.0.0.1:1", rpcUrl: "http://127.0.0.1:1", privateKey: FAKE_PK });
    const s = new ZeroGStorageEvidenceStore({
      client,
      settings: { indexerUrl: "x", rpcUrl: "y", chainId: 16602, timeoutMs: 1500, maxEvidenceBytes: 4096 },
      secrets: { routerApiKey: undefined, storagePrivateKey: FAKE_PK },
    });
    const r = await s.put({ episodeId: "ep-off", robotId: "ramu", kind: "episode-log", content: '{"type":"x"}\n' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(["TIMEOUT", "SDK_ERROR"]).toContain(r.error.kind);
    expect(r.error.expectedRootHash).toMatch(/^0x[0-9a-f]{64}$/);
    await s.close();
  });
});
