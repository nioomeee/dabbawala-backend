/**
 * Live 0G Storage smoke test: uploads ONE small synthetic JSONL object,
 * prints the network-returned rootHash/txHash, then downloads it back with
 * Merkle proof verification and compares the content hash.
 *
 *   ZERO_G_INDEXER_URL=... ZERO_G_RPC_URL=... ZERO_G_CHAIN_ID=16602 \
 *   ZERO_G_STORAGE_PRIVATE_KEY=... \
 *     node packages/zero-g-adapter/dist/cli/live-storage-check.js
 *
 * Exit codes: 0 uploaded and verified; 1 upload or verification failed;
 * 2 BLOCKED (missing/invalid credentials; nothing sent); 3 malformed config.
 *
 * COSTS TESTNET GAS (Galileo only; other chain ids are refused). The object is
 * PUBLIC AND PERMANENT: only synthetic, non-sensitive content is uploaded.
 * Use a throwaway Galileo testnet key funded from the faucet; never a mainnet key.
 */

import { createZeroGRuntime } from "../runtime.js";

async function main(): Promise<number> {
  const rt = createZeroGRuntime(process.env);
  if (!rt.ok) {
    console.error(JSON.stringify({ status: "CONFIG_ERROR", issues: rt.error }, null, 2));
    return 3;
  }
  const { evidence } = rt.value;
  const ready = rt.value.readiness();
  if (ready.storage.status !== "LIVE") {
    console.error(
      JSON.stringify({ status: ready.storage.status, blockedBy: ready.storage.blockedBy }, null, 2),
    );
    return ready.storage.status === "BLOCKED" ? 2 : 3;
  }

  const content =
    JSON.stringify({
      type: "smoke-test",
      simulated: true,
      note: "synthetic dabbawala 0G storage smoke test",
      tsMs: Date.now(),
    }) + "\n";

  const put = await evidence.put({
    episodeId: `smoke-${String(Date.now())}`,
    robotId: "ramu",
    kind: "episode-log",
    content,
  });
  if (!put.ok) {
    console.error(JSON.stringify({ status: "UPLOAD_FAILED", failure: put.error }, null, 2));
    await rt.value.close();
    return 1;
  }
  console.log(JSON.stringify({ status: "UPLOADED", receipt: put.value }, null, 2));

  const rootHash = put.value.rootHash;
  let code = 0;
  if (rootHash !== null) {
    const verified = await evidence.verifyStored(rootHash, put.value.contentSha256);
    console.log(JSON.stringify({ status: verified.ok ? "VERIFIED" : "VERIFY_FAILED", detail: verified.ok ? null : verified.error }, null, 2));
    if (!verified.ok) code = 1;
  }
  await rt.value.close();
  return code;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    console.error("live-storage-check crashed");
    process.exitCode = 3;
  },
);
