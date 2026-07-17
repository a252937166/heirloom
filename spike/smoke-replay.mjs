// Smoke replay on Coston2 against the deployed HeirloomVault:
//   1. fresh XRPPayment round-trip for the Gate-1 owner heartbeat tx → recordHeartbeat
//   2. attestSilence(seg1), attestSilence(seg2) — replayed from gate2-out.json (real proofs)
//   3. startClaim(beneficiary preimage) — silence covers period+grace
//   4. wait out the 120 s challenge period
//   5. executeRelease → mock redemption to the beneficiary's XRPL address → Released
import { AbiCoder, Contract, JsonRpcProvider, Wallet, encodeBytes32String, formatEther } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const VERIFIER = "https://fdc-verifiers-testnet.flare.network";
const API_KEY = "00000000-0000-0000-0000-000000000000";
const DA = "https://ctn2-data-availability.flare.network";
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

const gate1 = JSON.parse(readFileSync(new URL("./gate1-out.json", import.meta.url), "utf8"));
const gate2 = JSON.parse(readFileSync(new URL("./gate2-out.json", import.meta.url), "utf8"));
const dep = JSON.parse(readFileSync(new URL("../contracts/deployments.smoke.json", import.meta.url), "utf8"));
const hb = gate1.payments.ownerHeartbeat;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const coder = AbiCoder.defaultAbiCoder();

const provider = new JsonRpcProvider(RPC);
const agent = new Wallet(readFileSync(new URL("../../faktura-flare/keys/agent.key", import.meta.url), "utf8").trim(), provider);

// --- typed fragments (mirror periphery structs) ------------------------------
const XRP_REQ = "tuple(bytes32 transactionId, address proofOwner)";
const XRP_RES = "tuple(uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash, bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bool hasMemoData, bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status)";
const XRP_DATA = `tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ${XRP_REQ} requestBody, ${XRP_RES} responseBody)`;
const RPN_REQ = "tuple(uint64 minimalBlockNumber, uint64 deadlineBlockNumber, uint64 deadlineTimestamp, bytes32 destinationAddressHash, uint256 amount, bytes32 standardPaymentReference, bool checkSourceAddresses, bytes32 sourceAddressesRoot)";
const RPN_RES = "tuple(uint64 minimalBlockTimestamp, uint64 firstOverflowBlockNumber, uint64 firstOverflowBlockTimestamp)";
const RPN_DATA = `tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ${RPN_REQ} requestBody, ${RPN_RES} responseBody)`;

const vault = new Contract(dep.smokeVault, [
  `function recordHeartbeat(tuple(bytes32[] merkleProof, ${XRP_DATA} data) proof)`,
  `function attestSilence(tuple(bytes32[] merkleProof, ${RPN_DATA} data) proof)`,
  "function startClaim(string beneficiaryXrpl)",
  "function executeRelease() payable",
  "function state() view returns (uint8)",
  "function nextSilenceLedger() view returns (uint64)",
  "function silenceProvenThroughTs() view returns (uint64)",
  "function lastHeartbeatTs() view returns (uint64)",
  "function claimChallengeEndsAt() view returns (uint64)",
], agent);

function decodeRpn(hex) {
  const [d] = coder.decode([RPN_DATA], hex);
  return {
    attestationType: d[0], sourceId: d[1], votingRound: d[2], lowestUsedTimestamp: d[3],
    requestBody: { minimalBlockNumber: d[4][0], deadlineBlockNumber: d[4][1], deadlineTimestamp: d[4][2], destinationAddressHash: d[4][3], amount: d[4][4], standardPaymentReference: d[4][5], checkSourceAddresses: d[4][6], sourceAddressesRoot: d[4][7] },
    responseBody: { minimalBlockTimestamp: d[5][0], firstOverflowBlockNumber: d[5][1], firstOverflowBlockTimestamp: d[5][2] },
  };
}

// --- 1. XRPPayment round-trip for the heartbeat tx ---------------------------
log(`heartbeat XRPPayment attestation for tx ${hb.hash}`);
const prep = await (await fetch(`${VERIFIER}/verifier/xrp/XRPPayment/prepareRequest`, {
  method: "POST", headers: { "X-API-KEY": API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    attestationType: encodeBytes32String("XRPPayment"),
    sourceId: encodeBytes32String("testXRP"),
    requestBody: { transactionId: "0x" + hb.hash.toLowerCase(), proofOwner: agent.address.toLowerCase() },
  }),
})).json();
log(`prepare → ${prep.status}`);
if (prep.status !== "VALID") { console.error(prep); process.exit(1); }
const requestBytes = prep.abiEncodedRequest;

const registry = new Contract(REGISTRY, ["function getContractAddressByName(string) view returns (address)"], agent);
const [hubAddr, feeAddr, fsmAddr, relayAddr, fdcVerAddr] = await Promise.all(
  ["FdcHub", "FdcRequestFeeConfigurations", "FlareSystemsManager", "Relay", "FdcVerification"].map((n) => registry.getContractAddressByName(n)),
);
const fee = await new Contract(feeAddr, ["function getRequestFee(bytes) view returns (uint256)"], agent).getRequestFee(requestBytes);
const reqTx = await new Contract(hubAddr, ["function requestAttestation(bytes) payable"], agent).requestAttestation(requestBytes, { value: fee });
const reqRc = await reqTx.wait();
log(`submitted (fee ${formatEther(fee)}) tx=${reqTx.hash}`);
const fsm = new Contract(fsmAddr, ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"], provider);
const blk = await provider.getBlock(reqRc.blockNumber);
const [startTs, epochSec] = await Promise.all([fsm.firstVotingRoundStartTs(), fsm.votingEpochDurationSeconds()]);
const round = Number((BigInt(blk.timestamp) - startTs) / epochSec);
const relay = new Contract(relayAddr, ["function isFinalized(uint256,uint256) view returns (bool)"], provider);
const protocolId = await new Contract(fdcVerAddr, ["function fdcProtocolId() view returns (uint8)"], provider).fdcProtocolId();
log(`round ${round} — waiting`);
const dl = Date.now() + 12 * 60_000;
while (!(await relay.isFinalized(protocolId, round))) {
  if (Date.now() > dl) { console.error("not finalized"); process.exit(1); }
  await sleep(15_000);
}
let pj = {};
for (let i = 0; i < 30 && !pj.response_hex; i++) {
  await sleep(8_000);
  pj = await (await fetch(`${DA}/api/v1/fdc/proof-by-request-round-raw`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
    body: JSON.stringify({ votingRoundId: round, requestBytes }),
  })).json().catch(() => ({}));
}
if (!pj.response_hex) { console.error("no DA proof"); process.exit(1); }
const [xd] = coder.decode([XRP_DATA], pj.response_hex);
const xrpData = {
  attestationType: xd[0], sourceId: xd[1], votingRound: xd[2], lowestUsedTimestamp: xd[3],
  requestBody: { transactionId: xd[4][0], proofOwner: xd[4][1] },
  responseBody: {
    blockNumber: xd[5][0], blockTimestamp: xd[5][1], sourceAddress: xd[5][2], sourceAddressHash: xd[5][3],
    receivingAddressHash: xd[5][4], intendedReceivingAddressHash: xd[5][5], spentAmount: xd[5][6],
    intendedSpentAmount: xd[5][7], receivedAmount: xd[5][8], intendedReceivedAmount: xd[5][9],
    hasMemoData: xd[5][10], firstMemoData: xd[5][11], hasDestinationTag: xd[5][12], destinationTag: xd[5][13], status: xd[5][14],
  },
};
log(`heartbeat proof decoded: ledger=${xrpData.responseBody.blockNumber} memo=${String(xrpData.responseBody.firstMemoData).slice(0, 18)}…`);

// --- 2. on-chain lifecycle ----------------------------------------------------
const hbTx = await vault.recordHeartbeat({ merkleProof: pj.proof ?? [], data: xrpData });
await hbTx.wait();
log(`recordHeartbeat OK → nextSilenceLedger=${await vault.nextSilenceLedger()} (expect ${hb.ledger + 1})`);

const s1 = decodeRpn(gate2.segment1.response_hex);
const s2 = decodeRpn(gate2.segment2.response_hex);
await (await vault.attestSilence({ merkleProof: gate2.segment1.proof, data: s1 })).wait();
log(`attestSilence seg1 OK → next=${await vault.nextSilenceLedger()}`);
await (await vault.attestSilence({ merkleProof: gate2.segment2.proof, data: s2 })).wait();
log(`attestSilence seg2 OK → provenThroughTs=${await vault.silenceProvenThroughTs()} lastHb=${await vault.lastHeartbeatTs()}`);

const claimTx = await vault.startClaim(gate1.attacker); // beneficiary preimage
await claimTx.wait();
log(`startClaim OK → state=${await vault.state()} challengeEndsAt=${await vault.claimChallengeEndsAt()}`);

log("waiting out the 120 s challenge period…");
await sleep(125_000);
const rel = await vault.executeRelease();
const relRc = await rel.wait();
log(`executeRelease OK (tx ${rel.hash}) → state=${await vault.state()}`);

const am = new Contract(dep.assetManager, [
  "function lastUnderlying() view returns (string)",
  "function lastLots() view returns (uint256)",
], provider);
const [underlying, lots] = [await am.lastUnderlying(), await am.lastLots()];
log(`mock redemption: ${lots} lots → ${underlying}`);

writeFileSync(new URL("./smoke-out.json", import.meta.url), JSON.stringify({
  vault: dep.smokeVault,
  heartbeat: { attestationRound: round, requestTx: reqTx.hash, recordTx: hbTx.hash },
  silence: { seg1Tx: true, seg2Tx: true },
  claimTx: claimTx.hash, releaseTx: rel.hash,
  finalState: Number(await vault.state()), redeemedLots: String(lots), redeemedTo: underlying,
}, null, 2));

console.log("\n========== SMOKE VERDICT ==========");
const st = Number(await vault.state());
console.log(`final state = ${st} (5 = Released)`);
console.log(`redeemed ${lots} lots to ${underlying} (beneficiary=${gate1.attacker})`);
console.log(st === 5 && underlying === gate1.attacker ? "SMOKE: PASS — full lifecycle on Coston2 with real FDC proofs." : "SMOKE: PARTIAL");
process.exit(st === 5 && underlying === gate1.attacker ? 0 : 2);
