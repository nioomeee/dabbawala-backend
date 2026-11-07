// Isolating the 0G Storage evidence upload leg outside the API server.
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "@dabbawala/config";
import { createZeroGRuntime } from "@dabbawala/zero-g-adapter";
import { readFileSync } from "node:fs";

loadDotenv({ path: "../../.env" });
loadConfig();

const rt = createZeroGRuntime(process.env, { logger: { info: () => {}, warn: () => {}, error: () => {} } });
if (!rt.ok) {
  console.log("0G config INVALID:", JSON.stringify(rt.error));
  process.exit(1);
}

const content = readFileSync("C:/Users/nioom/AppData/Local/Temp/opencode/episode-bf2.jsonl", "utf8");

const started = Date.now();
const put = await rt.value.evidence.put({
  episodeId: "bf2-storage-isolate-0003",
  robotId: "ramu",
  kind: "episode-log",
  content,
});
console.log("elapsed:", Date.now() - started, "ms");
console.log("put ok:", JSON.stringify(put.ok ? put.value : put.error).slice(0, 900));
rt.value.close();
process.exit(0);
