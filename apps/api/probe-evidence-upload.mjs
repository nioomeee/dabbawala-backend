// BF-2 live end-to-end: POST /v1/evidence/upload with a real episode log.
// Drives: log-lint -> 0G Storage upload -> RelayLedger.anchor() real tx ->
// on-chain read-back verification. Prints the receipt verbatim.
const fs = await import("node:fs");

const content = (await fs).default.readFileSync(process.env.EPISODE_FILE, "utf8");
const body = {
  episodeId: process.env.EPISODE_ID,
  robotId: "ramu",
  kind: "episode-log",
  content,
};

const startedAt = Date.now();
const result = await fetch(
  `${process.env.TARGET_BASE ?? "http://localhost:3001"}/v1/evidence/upload`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(180_000),
});
const text = await result.text();
console.log("HTTP", result.status, "in", Date.now() - startedAt, "ms");
console.log(text);
