/**
 * Provenance storage and rendering.
 *
 * `InMemoryProvenanceLog` is a bounded ring buffer so a long-running process
 * cannot grow without limit. Durable evidence is produced by rendering records
 * to JSONL (`provenanceToJsonl`) and uploading via the EvidenceStore.
 *
 * Records contain: identifiers (ZG-Res-Key, router request id, provider),
 * model, latency, HTTP status, TEE flag, hashes of request/response content,
 * and the final outcome. They contain NO prompt text, NO model output text,
 * NO reasoning content, and NO credentials.
 */

import type { ProvenanceRecord, ProvenanceSink } from "./types.js";

export class InMemoryProvenanceLog implements ProvenanceSink {
  readonly #records: ProvenanceRecord[] = [];
  readonly #capacity: number;

  constructor(capacity = 1_000) {
    this.#capacity = Math.max(1, capacity);
  }

  record(entry: ProvenanceRecord): void {
    this.#records.push(entry);
    if (this.#records.length > this.#capacity) this.#records.shift();
  }

  list(): readonly ProvenanceRecord[] {
    return [...this.#records];
  }

  /** Find records whose final or any attempt request id matches. */
  findByRequestId(requestId: string): readonly ProvenanceRecord[] {
    return this.#records.filter(
      (r) =>
        (r.final.outcome === "PROPOSAL" && r.final.requestId === requestId) ||
        (r.final.outcome === "HALT" && r.final.requestId === requestId) ||
        r.attempts.some((a) => a.zgResKey === requestId || a.routerRequestId === requestId),
    );
  }

  clear(): void {
    this.#records.length = 0;
  }
}

/** One JSON object per line, stable key order from the record literal. */
export function provenanceToJsonl(records: readonly ProvenanceRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");
}

/** Latency percentile helper for the S-0G spike (nearest-rank). */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}
