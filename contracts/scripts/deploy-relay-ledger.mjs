
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JsonRpcProvider,
  Wallet,
  ContractFactory,
  isAddress,
  formatEther,
} from "ethers";

const RPC_URL = "https://evmrpc-testnet.0g.ai";
const EXPECTED_CHAIN_ID = 16602n;
const EXPECTED_WALLET =
  "0x91243EbADad9fe4b574C170eBb05ee6F319eF1Dd";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(scriptDir, "..");

async function main() {
  const privateKey = process.env.RELAY_LEDGER_PRIVATE_KEY;
  const anchorer = process.env.ANCHORER_ADDRESS;

  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("RELAY_LEDGER_PRIVATE_KEY is missing or invalid.");
  }

  if (!isAddress(anchorer || "")) {
    throw new Error("ANCHORER_ADDRESS is missing or invalid.");
  }

  if (anchorer.toLowerCase() !== EXPECTED_WALLET.toLowerCase()) {
    throw new Error("Unexpected anchorer address. Aborting.");
  }

  const artifactPath = path.join(
    contractsDir,
    "artifacts/src/RelayLedger.sol/RelayLedger.json"
  );

  const artifact = JSON.parse(
    fs.readFileSync(artifactPath, "utf8")
  );

  const bytecode =
    typeof artifact.bytecode === "string"
      ? artifact.bytecode
      : artifact.bytecode?.object;

  if (!artifact.abi || !bytecode || bytecode === "0x") {
    throw new Error("Invalid RelayLedger ABI or deployment bytecode.");
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();

  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Wrong network: expected ${EXPECTED_CHAIN_ID}, got ${network.chainId}`
    );
  }

  const wallet = new Wallet(privateKey, provider);

  if (wallet.address.toLowerCase() !== EXPECTED_WALLET.toLowerCase()) {
    throw new Error("Private key does not match the expected wallet.");
  }

  const balance = await provider.getBalance(wallet.address);

  console.log("\n===== RELAY LEDGER PREFLIGHT =====");
  console.log("Network:", network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Wallet:", wallet.address);
  console.log("Balance:", formatEther(balance), "0G");
  console.log("Anchorer:", anchorer);

  const factory = new ContractFactory(
    artifact.abi,
    bytecode,
    wallet
  );

  const deploymentTx = await factory.getDeployTransaction(anchorer);

  const estimatedGas = await provider.estimateGas({
    ...deploymentTx,
    from: wallet.address,
  });

  const fees = await provider.getFeeData();
  const feePerGas = fees.maxFeePerGas ?? fees.gasPrice;

  console.log("Estimated gas:", estimatedGas.toString());

  if (feePerGas !== null) {
    const estimatedCost = estimatedGas * feePerGas;
    console.log("Estimated maximum cost:", formatEther(estimatedCost), "0G");

    if (balance < estimatedCost * 120n / 100n) {
      throw new Error("Insufficient balance for deployment with safety margin.");
    }
  } else {
    console.log("Gas price unavailable; review wallet balance before deployment.");
  }

  console.log("=================================\n");

  if (process.argv.includes("--check-only")) {
    console.log("Preflight passed. No transaction was broadcast.");
    return;
  }

  console.log("Submitting RelayLedger deployment...");

  const contract = await factory.deploy(anchorer);

  console.log("Transaction hash:", contract.deploymentTransaction().hash);

  const receipt = await contract.deploymentTransaction().wait(1);

  if (!receipt || receipt.status !== 1) {
    throw new Error("Deployment transaction failed.");
  }

  const address = await contract.getAddress();
  const deployedAnchorer = await contract.anchorer();

  if (deployedAnchorer.toLowerCase() !== anchorer.toLowerCase()) {
    throw new Error("On-chain anchorer verification failed.");
  }

  console.log("\n===== DEPLOYMENT SUCCESSFUL =====");
  console.log("Contract:", address);
  console.log("Anchorer:", deployedAnchorer);
  console.log("Transaction:", receipt.hash);
  console.log("Block:", receipt.blockNumber);
  console.log("Chain ID:", network.chainId.toString());
  console.log("Explorer:", `https://chainscan-galileo.0g.ai/address/${address}`);
  console.log("================================\n");
}

main().catch((error) => {
  console.error("\nDEPLOYMENT ERROR:", error.shortMessage || error.message);
  process.exitCode = 1;
});
