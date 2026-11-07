process.env.ZERO_G_ROUTER_BASE_URL = "https://router-api.0g.ai/v1";
process.env.ZERO_G_ROUTER_API_KEY = "sk-9ab48a55-1ad8-4f9d-ad1c-51bfab515bde";
process.env.ZERO_G_MODEL_ID = "0gm-1.0-35b-a3b-sia";
process.env.ZERO_G_INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";
process.env.ZERO_G_RPC_URL = "https://evmrpc-testnet.0g.ai";
process.env.ZERO_G_CHAIN_ID = "16602";
process.env.ZERO_G_STORAGE_PRIVATE_KEY = "0x" + "ab".repeat(32);

const { createZeroGRuntime } = require("./packages/zero-g-adapter/dist/runtime.js");

const rt = createZeroGRuntime(process.env);
console.log("Config result:", rt.ok ? "OK" : "ERROR");
if (!rt.ok) {
  console.log("Issues:");
  rt.error.forEach(issue => console.log(" -", issue.variable, ":", issue.problem));
} else {
  const c = rt.value.config;
  console.log("\nCompute status:", c.computeStatus.mode, "blockedBy:", c.computeStatus.blockedBy);
  console.log("Storage status:", c.storageStatus.mode, "blockedBy:", c.storageStatus.blockedBy);
  console.log("\nCompute endpoint:", c.compute.baseUrl);
  console.log("Storage indexerUrl:", c.storage.indexerUrl);
  console.log("Storage rpcUrl:", c.storage.rpcUrl);
  console.log("Storage chainId:", c.storage.chainId);
}