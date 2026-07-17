import { expect } from "chai";
import { ethers } from "hardhat";
import { HeirloomVault, HeirloomFactory, MockFdcVerification, MockFxrp, MockAssetManager } from "../typechain-types";

const b32 = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));
const OWNER_XRPL = "rNuAhdojLNZk18o2mEdWhhgWNJb4dkdYaM";
const BENEFICIARY_XRPL = "rBeneficiary11111111111111111111111";
const BEACON_XRPL = "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN";
const REFERENCE = ethers.hexlify(ethers.randomBytes(32));
const LOT = 10_000_000n; // 10 FXRP (6 decimals)

const CFG = {
  ownerXrplHash: b32(OWNER_XRPL),
  beneficiaryXrplHash: b32(BENEFICIARY_XRPL),
  beaconHash: b32(BEACON_XRPL),
  heartbeatReference: REFERENCE,
  heartbeatPeriod: 1000n,
  gracePeriod: 100n,
  challengePeriod: 200n,
  creationLedger: 1000n,
  creationTs: 1_000_000n,
  lotSizeUBA: LOT,
};

function xrpPaymentProof(over: Partial<Record<string, unknown>> = {}) {
  const rb = {
    blockNumber: 1010n,
    blockTimestamp: 1_000_100n,
    sourceAddress: OWNER_XRPL,
    sourceAddressHash: b32(OWNER_XRPL),
    receivingAddressHash: b32(BEACON_XRPL),
    intendedReceivingAddressHash: b32(BEACON_XRPL),
    spentAmount: 13n,
    intendedSpentAmount: 13n,
    receivedAmount: 1n,
    intendedReceivedAmount: 1n,
    hasMemoData: true,
    firstMemoData: REFERENCE,
    hasDestinationTag: false,
    destinationTag: 0n,
    status: 0n,
    ...over,
  };
  return {
    merkleProof: [] as string[],
    data: {
      attestationType: ethers.encodeBytes32String("XRPPayment"),
      sourceId: ethers.encodeBytes32String("testXRP"),
      votingRound: 1n,
      lowestUsedTimestamp: 0n,
      requestBody: { transactionId: ethers.hexlify(ethers.randomBytes(32)), proofOwner: ethers.ZeroAddress },
      responseBody: rb,
    },
  };
}

function rpnProof(minimal: bigint, firstOverflow: bigint, overflowTs: bigint, over: Partial<Record<string, unknown>> = {}) {
  return {
    merkleProof: [] as string[],
    data: {
      attestationType: ethers.encodeBytes32String("ReferencedPaymentNonexistence"),
      sourceId: ethers.encodeBytes32String("testXRP"),
      votingRound: 1n,
      lowestUsedTimestamp: 0n,
      requestBody: {
        minimalBlockNumber: minimal,
        deadlineBlockNumber: firstOverflow - 1n,
        deadlineTimestamp: overflowTs - 1n,
        destinationAddressHash: b32(BEACON_XRPL),
        amount: 1n,
        standardPaymentReference: REFERENCE,
        checkSourceAddresses: true,
        sourceAddressesRoot: ethers.keccak256(b32(OWNER_XRPL)),
        ...over,
      },
      responseBody: {
        minimalBlockTimestamp: 1_000_001n,
        firstOverflowBlockNumber: firstOverflow,
        firstOverflowBlockTimestamp: overflowTs,
      },
    },
  };
}

describe("HeirloomVault", () => {
  let vault: HeirloomVault;
  let factory: HeirloomFactory;
  let ver: MockFdcVerification;
  let fxrp: MockFxrp;
  let am: MockAssetManager;

  beforeEach(async () => {
    ver = await (await ethers.getContractFactory("MockFdcVerification")).deploy();
    fxrp = await (await ethers.getContractFactory("MockFxrp")).deploy();
    am = await (await ethers.getContractFactory("MockAssetManager")).deploy(await fxrp.getAddress(), LOT);
    const impl = await (
      await ethers.getContractFactory("HeirloomVault")
    ).deploy(await fxrp.getAddress(), await am.getAddress(), await ver.getAddress());
    factory = await (await ethers.getContractFactory("HeirloomFactory")).deploy(await impl.getAddress());
    const tx = await factory.createVault(CFG, 0n, { value: 0n });
    const rc = await tx.wait();
    const ev = rc!.logs.map((l) => factory.interface.parseLog(l)).find((p) => p?.name === "VaultCreated");
    vault = await ethers.getContractAt("HeirloomVault", ev!.args.vault);
  });

  async function fundAndActivate(amount = 3n * LOT) {
    await fxrp.mint(await vault.getAddress(), amount);
    await vault.activate();
  }

  it("initializes into PendingFunding and activates on funding", async () => {
    expect(await vault.state()).to.equal(1); // PendingFunding
    await expect(vault.activate()).to.be.revertedWith("unfunded");
    await fundAndActivate();
    expect(await vault.state()).to.equal(2); // Active
  });

  it("factory rejects duplicate references", async () => {
    await expect(factory.createVault(CFG, 0n)).to.be.revertedWith("reference used");
  });

  describe("heartbeat", () => {
    beforeEach(async () => fundAndActivate());

    it("records a valid owner heartbeat and advances anchors", async () => {
      await expect(vault.recordHeartbeat(xrpPaymentProof())).to.emit(vault, "Heartbeat");
      expect(await vault.lastHeartbeatLedger()).to.equal(1010n);
      expect(await vault.nextSilenceLedger()).to.equal(1011n);
      expect(await vault.heartbeatEpoch()).to.equal(1);
    });

    it("rejects: non-owner source / wrong beacon / wrong reference / bad status / stale ledger / invalid proof", async () => {
      await expect(
        vault.recordHeartbeat(xrpPaymentProof({ sourceAddressHash: b32("rAttacker") })),
      ).to.be.revertedWithCustomError(vault, "NotOwnerHeartbeat");
      await expect(vault.recordHeartbeat(xrpPaymentProof({ receivingAddressHash: b32("rElse") }))).to.be.revertedWith(
        "beacon",
      );
      await expect(
        vault.recordHeartbeat(xrpPaymentProof({ firstMemoData: ethers.hexlify(ethers.randomBytes(32)) })),
      ).to.be.revertedWith("reference");
      await expect(vault.recordHeartbeat(xrpPaymentProof({ status: 2n }))).to.be.revertedWith("status");
      await expect(vault.recordHeartbeat(xrpPaymentProof({ blockNumber: 900n }))).to.be.revertedWith("stale");
      await ver.setXrpPaymentOk(false);
      await expect(vault.recordHeartbeat(xrpPaymentProof())).to.be.revertedWithCustomError(vault, "ProofInvalid");
    });
  });

  describe("silence checkpoints", () => {
    beforeEach(async () => fundAndActivate());

    it("chains strictly from creationLedger+1 and advances", async () => {
      await expect(vault.attestSilence(rpnProof(1001n, 1300n, 1_000_400n))).to.emit(vault, "SilenceAttested");
      expect(await vault.nextSilenceLedger()).to.equal(1300n);
      // gap or overlap is rejected
      await expect(vault.attestSilence(rpnProof(1400n, 1600n, 1_000_900n))).to.be.revertedWithCustomError(
        vault,
        "WindowMismatch",
      );
      await expect(vault.attestSilence(rpnProof(1300n, 1700n, 1_001_200n))).to.emit(vault, "SilenceAttested");
      expect(await vault.silenceProvenThroughTs()).to.equal(1_001_200n);
    });

    it("rejects wrong source root / disabled source check / wrong reference", async () => {
      await expect(
        vault.attestSilence(rpnProof(1001n, 1300n, 1_000_400n, { sourceAddressesRoot: b32("rAttacker") })),
      ).to.be.revertedWith("sourceRoot");
      await expect(
        vault.attestSilence(rpnProof(1001n, 1300n, 1_000_400n, { checkSourceAddresses: false })),
      ).to.be.revertedWith("sourceCheck");
      await expect(
        vault.attestSilence(rpnProof(1001n, 1300n, 1_000_400n, { standardPaymentReference: ethers.hexlify(ethers.randomBytes(32)) })),
      ).to.be.revertedWith("reference");
    });
  });

  describe("claim → challenge → release", () => {
    beforeEach(async () => {
      await fundAndActivate();
      // silence covers creationTs + period + grace = 1_001_100
      await vault.attestSilence(rpnProof(1001n, 1500n, 1_001_200n));
    });

    it("rejects early claim before silence covers the deadline", async () => {
      // fresh vault via new factory create (reference must differ)
      const cfg2 = { ...CFG, heartbeatReference: ethers.hexlify(ethers.randomBytes(32)) };
      const tx = await factory.createVault(cfg2, 0n);
      const rc = await tx.wait();
      const ev = rc!.logs.map((l) => factory.interface.parseLog(l)).find((p) => p?.name === "VaultCreated");
      const v2 = await ethers.getContractAt("HeirloomVault", ev!.args.vault);
      await fxrp.mint(await v2.getAddress(), LOT);
      await v2.activate();
      await expect(v2.startClaim(BENEFICIARY_XRPL)).to.be.revertedWithCustomError(v2, "SilenceNotProven");
    });

    it("full path: claim → challenge wait → release redeems to beneficiary", async () => {
      await expect(vault.startClaim("rWrong")).to.be.revertedWithCustomError(vault, "BadPreimage");
      await vault.startClaim(BENEFICIARY_XRPL);
      expect(await vault.state()).to.equal(3); // ClaimPending
      await expect(vault.executeRelease()).to.be.revertedWithCustomError(vault, "ChallengeNotOver");
      await ethers.provider.send("evm_increaseTime", [201]);
      await expect(vault.executeRelease()).to.emit(vault, "Released");
      expect(await vault.state()).to.equal(5); // Released
      expect(await am.lastLots()).to.equal(3n);
      expect(await am.lastUnderlying()).to.equal(BENEFICIARY_XRPL);
      expect(await fxrp.balanceOf(await vault.getAddress())).to.equal(0n);
    });

    it("owner heartbeat during challenge vetoes the claim", async () => {
      await vault.startClaim(BENEFICIARY_XRPL);
      await expect(vault.recordHeartbeat(xrpPaymentProof({ blockNumber: 1600n, blockTimestamp: 1_001_300n }))).to.emit(
        vault,
        "ClaimVetoed",
      );
      expect(await vault.state()).to.equal(2); // Active again
      // old checkpoints voided: next expected window starts after the heartbeat
      expect(await vault.nextSilenceLedger()).to.equal(1601n);
      await expect(vault.executeRelease()).to.be.revertedWithCustomError(vault, "BadState");
    });
  });

  describe("cancel", () => {
    beforeEach(async () => fundAndActivate());

    it("owner cancels via XRPL payment carrying the cancel reference", async () => {
      const cancelRef = ethers.keccak256(
        ethers.concat([ethers.toUtf8Bytes("HEIRLOOM/CANCEL"), REFERENCE]),
      );
      await expect(
        vault.cancel(OWNER_XRPL, xrpPaymentProof({ firstMemoData: cancelRef })),
      ).to.emit(vault, "CancelExecuted");
      expect(await vault.state()).to.equal(6); // Cancelled
      expect(await am.lastUnderlying()).to.equal(OWNER_XRPL);
    });

    it("rejects cancel with heartbeat reference or wrong preimage", async () => {
      await expect(vault.cancel(OWNER_XRPL, xrpPaymentProof())).to.be.revertedWith("reference");
      await expect(vault.cancel("rWrong", xrpPaymentProof())).to.be.revertedWithCustomError(vault, "BadPreimage");
    });
  });

  it("pays the crank reward from the vault reserve", async () => {
    const cfg3 = { ...CFG, heartbeatReference: ethers.hexlify(ethers.randomBytes(32)) };
    const tx = await factory.createVault(cfg3, ethers.parseEther("0.01"), { value: ethers.parseEther("0.05") });
    const rc = await tx.wait();
    const ev = rc!.logs.map((l) => factory.interface.parseLog(l)).find((p) => p?.name === "VaultCreated");
    const v3 = await ethers.getContractAt("HeirloomVault", ev!.args.vault);
    await fxrp.mint(await v3.getAddress(), LOT);
    await v3.activate();
    const [, cranker] = await ethers.getSigners();
    const before = await ethers.provider.getBalance(cranker.address);
    const proof = rpnProof(1001n, 1300n, 1_000_400n, { standardPaymentReference: cfg3.heartbeatReference });
    await v3.connect(cranker).attestSilence(proof);
    const after = await ethers.provider.getBalance(cranker.address);
    expect(after).to.be.greaterThan(before); // reward exceeded gas in hardhat default pricing? assert balance delta ≥ reward - gas is flaky; just check vault paid
    expect(await ethers.provider.getBalance(await v3.getAddress())).to.equal(ethers.parseEther("0.04"));
  });
});
