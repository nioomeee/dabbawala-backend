/**
 * Hardhat harness — current scheme per docs/implementation.md §6 (D3).
 * Chain id 31337 matches LOCAL_CHAIN_ID used by packages/config.
 * Foundry remains for the 0G Galileo deployment (ROADMAP B-4).
 *
 * Versions pinned exactly; verified via `npm view` on 2026-10-31:
 *   hardhat 2.29.1 · @nomicfoundation/hardhat-ethers 3.1.3 (hh2 tag) ·
 *   ethers 6.17.0 · chai 4.5.0 · ref: AGENTS.md §5, §8
 */
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";

const config: HardhatUserConfig = {
  paths: {
    sources: "./src",
    tests: "./test/hardhat",
  },
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // The persistent local node started with `npx hardhat node` (§6).
    localhost: {
      chainId: 31337,
      url: "http://127.0.0.1:8545",
    },
    // Ethereum Sepolia testnet for live ENSv2 deployment & verification.
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: process.env.OPERATOR_PRIVATE_KEY ? [process.env.OPERATOR_PRIVATE_KEY] : [],
    },
  },
};

export default config;
