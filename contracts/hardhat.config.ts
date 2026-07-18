import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import fs from "node:fs";
import path from "node:path";

function loadKey(rel: string): string | undefined {
  try {
    return fs.readFileSync(path.join(__dirname, rel), "utf8").trim();
  } catch {
    return undefined;
  }
}

// Deployer/gas key: reuse the funded Coston2 key (testnet only).
const accounts = [loadKey("../../faktura-flare/keys/agent.key")].filter((k): k is string => Boolean(k));

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    coston2: {
      url: "https://coston2-api.flare.network/ext/C/rpc",
      chainId: 114,
      accounts,
    },
  },
  // Blockscout verification (judges can read the exact deployed source)
  etherscan: {
    apiKey: { coston2: "blockscout" },
    customChains: [
      {
        network: "coston2",
        chainId: 114,
        urls: {
          apiURL: "https://coston2-explorer.flare.network/api",
          browserURL: "https://coston2-explorer.flare.network",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  mocha: { timeout: 120000 },
};

export default config;
