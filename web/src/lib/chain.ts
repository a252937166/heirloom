import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";
import { CONFIG } from "../config";

export const provider = new JsonRpcProvider(CONFIG.rpc);
export const addrHash = (r: string) => keccak256(toUtf8Bytes(r));

const VAULT_ABI = [
  "function state() view returns (uint8)",
  "function config() view returns (bytes32 ownerXrplHash, bytes32 beneficiaryXrplHash, bytes32 beaconHash, bytes32 heartbeatReference, uint64 heartbeatPeriod, uint64 gracePeriod, uint64 challengePeriod, uint64 creationLedger, uint64 creationTs, uint256 lotSizeUBA, address ownerEvm)",
  "function lastHeartbeatTs() view returns (uint64)",
  "function lastHeartbeatLedger() view returns (uint64)",
  "function heartbeatEpoch() view returns (uint32)",
  "function nextSilenceLedger() view returns (uint64)",
  "function silenceProvenThroughTs() view returns (uint64)",
  "function silenceDeadline() view returns (uint64)",
  "function claimChallengeEndsAt() view returns (uint64)",
  "function beneficiaryXrpl() view returns (string)",
  "function cancelReference() view returns (bytes32)",
];
const FACTORY_ABI = [
  "function vaultCount() view returns (uint256)",
  "function vaults(uint256) view returns (address)",
  "function vaultByReference(bytes32) view returns (address)",
  "function vaultsOf(bytes32) view returns (address[])",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

export const factory = new Contract(CONFIG.factory, FACTORY_ABI, provider);
export const fxrp = new Contract(CONFIG.fxrp, ERC20_ABI, provider);
export const vaultAt = (addr: string) => new Contract(addr, VAULT_ABI, provider);

export interface VaultView {
  address: string;
  state: number;
  fxrpBalance: bigint;
  heartbeatReference: string;
  heartbeatPeriod: number;
  gracePeriod: number;
  challengePeriod: number;
  lastHeartbeatTs: number;
  silenceProvenThroughTs: number;
  silenceDeadline: number;
  claimChallengeEndsAt: number;
  heartbeatEpoch: number;
  nextSilenceLedger: number;
  ownerXrplHash: string;
  beneficiaryXrplHash: string;
  ownerEvm: string;
}

// v2 vaults predate the EVM-owner field — decode their config tolerantly so
// already-completed plans stay first-class citizens.
const CONFIG_V2_ABI = [
  "function config() view returns (bytes32 ownerXrplHash, bytes32 beneficiaryXrplHash, bytes32 beaconHash, bytes32 heartbeatReference, uint64 heartbeatPeriod, uint64 gracePeriod, uint64 challengePeriod, uint64 creationLedger, uint64 creationTs, uint256 lotSizeUBA)",
];
async function readConfig(address: string) {
  try {
    return await vaultAt(address).config();
  } catch {
    const c = await new Contract(address, CONFIG_V2_ABI, provider).config();
    return {
      ownerXrplHash: c.ownerXrplHash, beneficiaryXrplHash: c.beneficiaryXrplHash,
      beaconHash: c.beaconHash, heartbeatReference: c.heartbeatReference,
      heartbeatPeriod: c.heartbeatPeriod, gracePeriod: c.gracePeriod,
      challengePeriod: c.challengePeriod, creationLedger: c.creationLedger,
      creationTs: c.creationTs, lotSizeUBA: c.lotSizeUBA,
      ownerEvm: "0x0000000000000000000000000000000000000000",
    };
  }
}

export async function readVault(address: string): Promise<VaultView> {
  const v = vaultAt(address);
  const [state, cfg, lastTs, proven, deadline, challenge, epoch, nextLedger, bal] = await Promise.all([
    v.state(),
    readConfig(address),
    v.lastHeartbeatTs(),
    v.silenceProvenThroughTs(),
    v.silenceDeadline(),
    v.claimChallengeEndsAt(),
    v.heartbeatEpoch(),
    v.nextSilenceLedger(),
    fxrp.balanceOf(address),
  ]);
  return {
    address,
    state: Number(state),
    fxrpBalance: bal,
    heartbeatReference: cfg.heartbeatReference,
    heartbeatPeriod: Number(cfg.heartbeatPeriod),
    gracePeriod: Number(cfg.gracePeriod),
    challengePeriod: Number(cfg.challengePeriod),
    lastHeartbeatTs: Number(lastTs),
    silenceProvenThroughTs: Number(proven),
    silenceDeadline: Number(deadline),
    claimChallengeEndsAt: Number(challenge),
    heartbeatEpoch: Number(epoch),
    nextSilenceLedger: Number(nextLedger),
    ownerXrplHash: cfg.ownerXrplHash,
    beneficiaryXrplHash: cfg.beneficiaryXrplHash,
    ownerEvm: cfg.ownerEvm,
  };
}

export async function vaultsOfOwner(ownerXrpl: string): Promise<string[]> {
  return await factory.vaultsOf(addrHash(ownerXrpl));
}

export const fmtFxrp = (uba: bigint) => (Number(uba) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const short = (s: string, n = 8) => (s.length > 2 * n ? `${s.slice(0, n)}…${s.slice(-4)}` : s);
