// Production deployment on Coston2: REAL FTestXRP + REAL AssetManagerFXRP +
// REAL FDC verification (registry). Writes deployments.real.json.
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7"; // FTestXRP (Coston2)
const ASSET_MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA"; // AssetManagerFXRP

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address);
  const impl = await (
    await ethers.getContractFactory("HeirloomVault")
  ).deploy(FXRP, ASSET_MANAGER, ethers.ZeroAddress);
  await impl.waitForDeployment();
  const factory = await (await ethers.getContractFactory("HeirloomFactory")).deploy(await impl.getAddress());
  await factory.waitForDeployment();
  const out = {
    network: "coston2",
    fxrp: FXRP,
    assetManager: ASSET_MANAGER,
    implementation: await impl.getAddress(),
    factory: await factory.getAddress(),
    lotSizeUBA: "10000000",
    coreVaultXrpl: "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p",
  };
  fs.writeFileSync(path.join(__dirname, "../deployments.real.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
