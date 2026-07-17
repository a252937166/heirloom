// Deploys the smoke set on Coston2: Mock FXRP + Mock AssetManager (redemption
// mocked for now — Gate 3/5 swap in the real FAssets) but REAL FDC verification
// via ContractRegistry (verificationOverride = 0). Then creates the smoke vault
// wired to the Gate-1 real XRPL artifacts.
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const b32 = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));
const LOT = 10_000_000n; // 10 FXRP (6dp) — matches real FXRP lot size

async function main() {
  const gate1 = JSON.parse(fs.readFileSync(path.join(__dirname, "../../spike/gate1-out.json"), "utf8"));
  const hb = gate1.payments.ownerHeartbeat;
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address);

  const fxrp = await (await ethers.getContractFactory("MockFxrp")).deploy();
  await fxrp.waitForDeployment();
  const am = await (await ethers.getContractFactory("MockAssetManager")).deploy(await fxrp.getAddress(), LOT);
  await am.waitForDeployment();
  const impl = await (
    await ethers.getContractFactory("HeirloomVault")
  ).deploy(await fxrp.getAddress(), await am.getAddress(), ethers.ZeroAddress); // ← real FDC via registry
  await impl.waitForDeployment();
  const factory = await (await ethers.getContractFactory("HeirloomFactory")).deploy(await impl.getAddress());
  await factory.waitForDeployment();

  const cfg = {
    ownerXrplHash: b32(gate1.owner),
    beneficiaryXrplHash: b32(gate1.attacker), // smoke: gate-1 attacker acct doubles as beneficiary
    beaconHash: b32(gate1.beacon),
    heartbeatReference: gate1.reference, // 0x…32B
    heartbeatPeriod: 600n,
    gracePeriod: 60n,
    challengePeriod: 120n,
    creationLedger: BigInt(hb.ledger) - 10n,
    creationTs: BigInt(hb.ts) - 40n,
    lotSizeUBA: LOT,
  };
  const tx = await factory.createVault(cfg, 0n);
  const rc = await tx.wait();
  const ev = rc!.logs.map((l) => factory.interface.parseLog(l)).find((p) => p?.name === "VaultCreated");
  const vault = ev!.args.vault as string;

  // fund with 3 mock lots and activate
  await (await fxrp.mint(vault, 3n * LOT)).wait();
  const v = await ethers.getContractAt("HeirloomVault", vault);
  await (await v.activate()).wait();

  const out = {
    network: "coston2",
    fxrp: await fxrp.getAddress(),
    assetManager: await am.getAddress(),
    implementation: await impl.getAddress(),
    factory: await factory.getAddress(),
    smokeVault: vault,
    config: { ...cfg, heartbeatPeriod: "600", gracePeriod: "60", challengePeriod: "120", creationLedger: String(cfg.creationLedger), creationTs: String(cfg.creationTs), lotSizeUBA: String(LOT) },
  };
  fs.writeFileSync(path.join(__dirname, "../deployments.smoke.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
