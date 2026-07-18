import { keccak256, toUtf8Bytes } from "ethers";
import { CONFIG } from "../config";

// Single source of truth for the Recovery Kit manifest: the Kit page and the
// Create success screen build byte-identical files from this schema. The
// checksum is keccak256 over the manifest without its checksum field, so a
// beneficiary (or anyone) can verify the file was not corrupted or edited.
export interface RecoveryInput {
  vault: string;
  ownerMode: "xrpl" | "evm";
  owner: string;                 // r-address (xrpl mode) or 0x-address (evm mode)
  beneficiaryXrpl: string;
  heartbeatReference: string;    // 0x-prefixed 32-byte hex
  beacon: string;
  rules: { heartbeatPeriodSec: number; gracePeriodSec: number; challengePeriodSec: number; vetoProofGraceSec: number };
  claimUrl: string;
}

export function buildRecoveryManifest(i: RecoveryInput) {
  const kitId = `HL-${i.vault.slice(2, 6).toUpperCase()}-${i.vault.slice(-4).toUpperCase()}`;
  const body = {
    kitId,
    schema: "heirloom-recovery/v4",
    vault: i.vault,
    network: { flare: "Coston2 (chainId 114)", xrpl: "testnet" },
    contracts: { factory: CONFIG.factory, implementation: CONFIG.implementation, fxrp: CONFIG.fxrp, assetManager: CONFIG.assetManager },
    owner: i.owner,
    ownerMode: i.ownerMode,
    beneficiary: i.beneficiaryXrpl,
    heartbeatBeacon: i.beacon,
    heartbeatReference: i.heartbeatReference,
    claimUrl: i.claimUrl,
    rules: i.rules,
    proofRecipe: i.ownerMode === "evm"
      ? "silence clock = Flare consensus time vs lastHeartbeatTs; after period+grace anyone may call startClaim(beneficiary) → owner heartbeat cutoff (challenge end) → wait the veto-proof grace → executeRelease only after releaseEligibleAt"
      : "silence proof = FDC ReferencedPaymentNonexistence over the beacon with the heartbeat reference, checkSourceAddresses=true, sourceAddressesRoot=keccak256(keccak256(owner)), chained from lastHeartbeatLedger+1; then startClaim(beneficiary) → owner heartbeat cutoff (challenge end; a heartbeat proof with XRPL timestamp ≤ the cutoff still vetoes during the grace) → wait the veto-proof grace → executeRelease only after releaseEligibleAt",
    claimSteps: [
      "1. Start the claim: startClaim(beneficiary) once silence is proven.",
      "2. Wait until the owner heartbeat cutoff (claimChallengeEndsAt) — an owner heartbeat whose XRPL timestamp is <= the cutoff still vetoes during the grace.",
      `3. Wait through the additional proof settlement buffer (${i.rules.vetoProofGraceSec}s).`,
      "4. Execute the release only after releaseEligibleAt = cutoff + buffer; earlier calls revert ChallengeNotOver.",
    ],
    buildSha: __BUILD_SHA__,
    generatedAt: new Date().toISOString(),
  };
  return { ...body, checksum: keccak256(toUtf8Bytes(JSON.stringify(body))) };
}

export type RecoveryManifest = ReturnType<typeof buildRecoveryManifest>;

export function downloadManifest(m: RecoveryManifest) {
  const blob = new Blob([JSON.stringify(m, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `heirloom-recovery-${m.vault.slice(2, 10)}.json`;
  a.click();
}
