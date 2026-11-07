// Read-only smoke test: verifies RelayLedger config, contract presence, the
// anchorer authorization (immutable `anchorer` == signer address implied by
// RELAY_LEDGER_PRIVATE_KEY) and an isAnchored() call on 0G Galileo.
// No transaction is sent; only eth_call — no gas spent.
import { loadConfig } from "@dabbawala/config";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: "../../.env" });
loadConfig();

const { RelayLedgerAnchorer, bytes32FromString } = await import("./src/services/relay-ledger.js");

const cfgAddress = process.env.RELAY_LEDGER_ADDRESS;
const rpc = process.env.ZERO_G_RPC_URL;
const chainId = Number(process.env.ZERO_G_CHAIN_ID);

console.log("RELAY_LEDGER_ADDRESS:", cfgAddress);
console.log("ZERO_G_RPC_URL:", rpc, "chainId:", chainId);

let anchorer: import("./src/services/relay-ledger.js").RelayLedgerAnchorer;
try {
  anchorer = new RelayLedgerAnchorer();
  console.log("Anchorer constructed: OK (signer address logged above)");
} catch (err) {
  console.log("Anchorer construction FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// Deterministic id derivations (pure, no RPC)
const robotId32 = bytes32FromString("ramu");
const probeEpisodeId32 = bytes32FromString("anchor-smoke-probe-0001");
console.log("bytes32(robotId 'ramu'):", robotId32);
console.log("bytes32(probe episodeId):", probeEpisodeId32);

const anchoredProbe = await anchorer.isAnchored(probeEpisodeId32);
console.log("isAnchored(probe):", anchoredProbe, "(expect false — probe id was never anchored)");

// Authorization check: RelayLedger.anchorer() must equal the signer address
// (vault: constructor sets anchorer = deployer = RELAY_LEDGER_PRIVATE_KEY).
const { createPublicClient, defineChain, http } = await import("viem");
const client = createPublicClient({
  chain: defineChain({
    id: chainId,
    name: "0G Galileo",
    nativeCurrency: { name: "A0GI", symbol: "A0GI", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    testnet: true,
  }),
  transport: http(rpc),
});
const ANCHORER_ABI = [
  { type: "function", name: "anchorer", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "anchor", inputs: [{ name: "robotId", type: "bytes32" }, { name: "episodeId", type: "bytes32" }, { name: "rootHash", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
] as const;
const onchainAnchorer = await client.readContract({
  address: cfgAddress as `0x${string}`,
  abi: ANCHORER_ABI,
  functionName: "anchorer",
  args: [],
});
console.log("contract anchorer:", onchainAnchorer);

// Simulation-only authorization probe: estimateGas for anchor() with a fresh
// episode id. Success => the signer is authorized; revert => Unauthorized.
const signerKeyRaw = process.env.RELAY_LEDGER_PRIVATE_KEY;
if (!signerKeyRaw) { console.log("RELAY_LEDGER_PRIVATE_KEY missing"); process.exit(1); }
const signerKey = signerKeyRaw.startsWith("0x") ? signerKeyRaw : `0x${signerKeyRaw}`;
const { privateKeyToAccount } = await import("viem/accounts");
const account = privateKeyToAccount(signerKey as `0x${string}`);
if (onchainAnchorer.toLowerCase() !== account.address.toLowerCase()) {
  console.log("MISMATCH: configured signer", account.address, "is NOT the contract anchorer", onchainAnchorer);
  process.exit(2);
}
await client.estimateGas({
  account: account.address,
  to: cfgAddress as `0x${string}`,
  data: await (async () => {
    const { encodeFunctionData } = await import("viem");
    return encodeFunctionData({
      abi: ANCHORER_ABI,
      functionName: "anchor",
      args: [robotId32, probeEpisodeId32, `0x${"11".repeat(32)}`],
    });
  })(),
}).then((gas) => console.log("estimateGas(anchor) OK:", gas.toString(), "— signer authorized"));
console.log("SMOKE OK — RelayLedger is readable on 0G Galileo and the signer is the authorized anchorer.");

