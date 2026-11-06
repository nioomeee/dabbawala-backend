/**
 * Thin port over the 0G Storage TypeScript SDK, plus the real implementation.
 *
 * Real SDK: @0gfoundation/0g-storage-ts-sdk 1.2.13 (peer: ethers 6.13.1).
 * Verified against installed .d.ts and docs.0g.ai/developer-hub/building-on-0g/storage/sdk:
 *
 *   const memData = new MemData(bytes);
 *   const [tree, e1] = await memData.merkleTree();           // tree.rootHash()
 *   const [tx, e2]   = await indexer.upload(memData, RPC_URL, signer);
 *       // tx = { txHash, rootHash, txSeq } | { txHashes, rootHashes, txSeqs }
 *   const [blob, e3] = await indexer.downloadToBlob(root, { proof: true });
 *
 * The flow contract is auto-discovered from the indexer (docs: "flow contract
 * is auto-discovered"), so no flow address is configured here.
 *
 * The SDK is imported lazily so compute-only processes (and unit tests that
 * inject a fake StorageClientPort) never load it.
 */

import type * as Sdk from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";

export interface StorageUploadResult {
  readonly rootHash: string;
  readonly txHash: string;
  readonly txSeq: number;
}

export type StorageClientErrorKind = "SDK_ERROR" | "FRAGMENTED_RESULT" | "BAD_RESULT";

export class StorageClientError extends Error {
  readonly kind: StorageClientErrorKind;
  constructor(kind: StorageClientErrorKind, message: string) {
    super(message);
    this.name = "StorageClientError";
    this.kind = kind;
  }
}

export interface StorageClientPort {
  /** Chain id of the configured RPC (used for the Galileo-only guard). */
  chainId(): Promise<bigint>;
  /** Merkle root the SDK would assign to `data` (offline computation). */
  merkleRoot(data: Uint8Array): Promise<string>;
  /** Upload `data`; resolves with ids returned by the network. */
  upload(data: Uint8Array): Promise<StorageUploadResult>;
  /** Download by root hash with Merkle proof verification. */
  download(rootHash: string): Promise<Uint8Array>;
  /** Release provider resources. */
  close(): Promise<void>;
}

export type SdkModule = typeof Sdk;

export interface SdkStorageClientOptions {
  readonly indexerUrl: string;
  readonly rpcUrl: string;
  /** Required for upload(); omit for read-only/offline use. */
  readonly privateKey?: string;
  readonly loadSdk?: () => Promise<SdkModule>;
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "unknown error";
}

export class SdkStorageClient implements StorageClientPort {
  readonly #opts: SdkStorageClientOptions;
  #provider: ethers.JsonRpcProvider | null = null;
  #sdk: SdkModule | null = null;

  constructor(opts: SdkStorageClientOptions) {
    this.#opts = opts;
  }

  async #loadSdk(): Promise<SdkModule> {
    if (this.#sdk === null) {
      this.#sdk = await (this.#opts.loadSdk ?? (() => import("@0gfoundation/0g-storage-ts-sdk")))();
    }
    return this.#sdk;
  }

  #getProvider(): ethers.JsonRpcProvider {
    this.#provider ??= new ethers.JsonRpcProvider(this.#opts.rpcUrl);
    return this.#provider;
  }

  async chainId(): Promise<bigint> {
    const network = await this.#getProvider().getNetwork();
    return network.chainId;
  }

  async merkleRoot(data: Uint8Array): Promise<string> {
    const sdk = await this.#loadSdk();
    const mem = new sdk.MemData(data);
    const [tree, treeErr] = await mem.merkleTree();
    if (treeErr !== null || tree === null) {
      throw new StorageClientError("SDK_ERROR", `merkle tree: ${messageOf(treeErr)}`);
    }
    const root = tree.rootHash();
    if (typeof root !== "string" || root === "") {
      throw new StorageClientError("BAD_RESULT", "empty merkle root");
    }
    return root;
  }

  async upload(data: Uint8Array): Promise<StorageUploadResult> {
    const key = this.#opts.privateKey;
    if (key === undefined) {
      throw new StorageClientError("SDK_ERROR", "no signer configured");
    }
    const sdk = await this.#loadSdk();
    const signer = new ethers.Wallet(key, this.#getProvider());
    const indexer = new sdk.Indexer(this.#opts.indexerUrl);

    const mem = new sdk.MemData(data);
    // The SDK requires merkleTree() before upload (docs: "populates internal state").
    const [, treeErr] = await mem.merkleTree();
    if (treeErr !== null) {
      throw new StorageClientError("SDK_ERROR", `merkle tree: ${messageOf(treeErr)}`);
    }

    // Types-only dual-package hazard: the SDK's .d.ts resolves ethers' CommonJS
    // typings while this ESM package resolves the ESM ones (private-field brand
    // mismatch). At runtime both load the same ethers 6.13.1 ESM build.
    const sdkSigner = signer as unknown as Parameters<typeof indexer.upload>[2];
    const [tx, uploadErr] = await indexer.upload(mem, this.#opts.rpcUrl, sdkSigner);
    if (uploadErr !== null) {
      throw new StorageClientError("SDK_ERROR", `upload: ${messageOf(uploadErr)}`);
    }
    if (!("rootHash" in tx)) {
      throw new StorageClientError("FRAGMENTED_RESULT", "unexpected fragmented upload result");
    }
    return { rootHash: tx.rootHash, txHash: tx.txHash, txSeq: tx.txSeq };
  }

  async download(rootHash: string): Promise<Uint8Array> {
    const sdk = await this.#loadSdk();
    const indexer = new sdk.Indexer(this.#opts.indexerUrl);
    const [blob, err] = await indexer.downloadToBlob(rootHash, { proof: true });
    if (err !== null) {
      throw new StorageClientError("SDK_ERROR", `download: ${messageOf(err)}`);
    }
    return new Uint8Array(await blob.arrayBuffer());
  }

  close(): Promise<void> {
    this.#provider?.destroy();
    this.#provider = null;
    return Promise.resolve();
  }
}
