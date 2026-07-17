// Gate 1b: rerun the three-state RPN test against the run-1 payments already on
// the XRPL testnet ledger (no faucet, no new payments — pure proof mechanics).
import { AbiCoder, Contract, JsonRpcProvider, Wallet, encodeBytes32String, formatEther, keccak256, toUtf8Bytes } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const VERIFIER = "https://fdc-verifiers-testnet.flare.network";
const API_KEY = "00000000-0000-0000-0000-000000000000";
const DA = "https://ctn2-data-availability.flare.network";
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const BEACON = "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN";

const prev = JSON.parse(readFileSync(new URL("./gate1-out.json", import.meta.url), "utf8"));
const { owner, attacker, reference, hb, at1, at2 } = prev;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
log(`replaying against: owner=${owner} attacker=${attacker} ref=${reference.slice(0, 12)}…`);
log(`payments: hb@${hb.ledger} at1@${at1.ledger} at2@${at2.ledger}`);

// discovered in run 1: single-address source root = keccak(keccak(addr))
const root = keccak256(keccak256(toUtf8Bytes(owner)));

const mkBody = (minLedger, check) => ({
  minimalBlockNumber: String(minLedger),
  deadlineBlockNumber: String(at2.ledger + 2),
  deadlineTimestamp: String(at2.ts + 15),
  destinationAddressHash: keccak256(toUtf8Bytes(BEACON)),
  amount: "1",
  standardPaymentReference: "0x" + reference,
  checkSourceAddresses: check,
  sourceAddressesRoot: check ? root : "0x" + "00".repeat(32),
});
const rpnPrepare = async (body) => await (await fetch(`${VERIFIER}/verifier/xrp/ReferencedPaymentNonexistence/prepareRequest`, {
  method: "POST", headers: { "X-API-KEY": API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    attestationType: encodeBytes32String("ReferencedPaymentNonexistence"),
    sourceId: encodeBytes32String("testXRP"),
    requestBody: body,
  }),
})).json();

// A: window includes owner heartbeat, filter ON → INVALID (owner detected)
const a = await rpnPrepare(mkBody(hb.ledger - 2, true));
log(`A (owner in window, filter on)  → ${a.status}`);
// B: window starts AFTER heartbeat (attacker copies only), filter ON → VALID
const b = await rpnPrepare(mkBody(hb.ledger + 1, true));
log(`B (attacker only, filter on)    → ${b.status}`);
// C': same window, filter OFF → INVALID (attacker copies match without filter)
const c = await rpnPrepare(mkBody(hb.ledger + 1, false));
log(`C' (attacker only, filter off)  → ${c.status}`);

const aOk = String(a.status).startsWith("INVALID");
const cOk = String(c.status).startsWith("INVALID");
if (!(aOk && b.status === "VALID" && cOk)) {
  writeFileSync(new URL("./gate1-out.json", import.meta.url), JSON.stringify({ ...prev, phase: "gate1b-prepare-mismatch", a, b, c }, null, 2));
  console.error("prepare-phase expectations not met"); process.exit(2);
}

// B full round-trip → on-chain verification
const requestBytes = b.abiEncodedRequest;
const provider = new JsonRpcProvider(RPC);
const agent = new Wallet(readFileSync(new URL("../../faktura-flare/keys/agent.key", import.meta.url), "utf8").trim(), provider);
const registry = new Contract(REGISTRY, ["function getContractAddressByName(string) view returns (address)"], agent);
const [hubAddr, feeAddr, fsmAddr, relayAddr, fdcVerAddr] = await Promise.all(
  ["FdcHub", "FdcRequestFeeConfigurations", "FlareSystemsManager", "Relay", "FdcVerification"]
    .map((n) => registry.getContractAddressByName(n)),
);
const fee = await new Contract(feeAddr, ["function getRequestFee(bytes) view returns (uint256)"], agent).getRequestFee(requestBytes);
const tx = await new Contract(hubAddr, ["function requestAttestation(bytes) payable"], agent).requestAttestation(requestBytes, { value: fee });
const rc = await tx.wait();
log(`B submitted: fee=${formatEther(fee)} tx=${tx.hash}`);

const fsm = new Contract(fsmAddr, ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"], provider);
const blk = await provider.getBlock(rc.blockNumber);
const [startTs, epochSec] = await Promise.all([fsm.firstVotingRoundStartTs(), fsm.votingEpochDurationSeconds()]);
const round = Number((BigInt(blk.timestamp) - startTs) / epochSec);
const relay = new Contract(relayAddr, ["function isFinalized(uint256,uint256) view returns (bool)"], provider);
const protocolId = await new Contract(fdcVerAddr, ["function fdcProtocolId() view returns (uint8)"], provider).fdcProtocolId();
log(`round ${round} — waiting for finalization`);
const dl = Date.now() + 12 * 60_000;
while (!(await relay.isFinalized(protocolId, round))) {
  if (Date.now() > dl) { console.error("not finalized in 12min"); process.exit(1); }
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
if (!pj.response_hex) { console.error("DA returned no proof"); process.exit(1); }
log(`DA proof: ${pj.proof?.length}-node branch`);

const REQ_T = "tuple(uint64 minimalBlockNumber, uint64 deadlineBlockNumber, uint64 deadlineTimestamp, bytes32 destinationAddressHash, uint256 amount, bytes32 standardPaymentReference, bool checkSourceAddresses, bytes32 sourceAddressesRoot)";
const RES_T = "tuple(uint64 minimalBlockTimestamp, uint64 firstOverflowBlockNumber, uint64 firstOverflowBlockTimestamp)";
const RESPONSE_T = `tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ${REQ_T} requestBody, ${RES_T} responseBody)`;
const [d] = AbiCoder.defaultAbiCoder().decode([RESPONSE_T], pj.response_hex);
const data = {
  attestationType: d[0], sourceId: d[1], votingRound: d[2], lowestUsedTimestamp: d[3],
  requestBody: {
    minimalBlockNumber: d[4][0], deadlineBlockNumber: d[4][1], deadlineTimestamp: d[4][2],
    destinationAddressHash: d[4][3], amount: d[4][4], standardPaymentReference: d[4][5],
    checkSourceAddresses: d[4][6], sourceAddressesRoot: d[4][7],
  },
  responseBody: { minimalBlockTimestamp: d[5][0], firstOverflowBlockNumber: d[5][1], firstOverflowBlockTimestamp: d[5][2] },
};
const ver = new Contract(fdcVerAddr, [
  `function verifyReferencedPaymentNonexistence(tuple(bytes32[] merkleProof, ${RESPONSE_T} data) _proof) view returns (bool)`,
], provider);
const onchainOk = await ver.verifyReferencedPaymentNonexistence({ merkleProof: pj.proof ?? [], data });
log(`on-chain verifyReferencedPaymentNonexistence → ${onchainOk}`);

writeFileSync(new URL("./gate1-out.json", import.meta.url), JSON.stringify({
  owner, attacker, beacon: BEACON, reference: "0x" + reference,
  payments: { ownerHeartbeat: hb, attacker1: at1, attacker2: at2 },
  rootConstruction: "keccak256(keccak256(utf8(address)))", rootValue: root,
  testA: { status: a.status },
  testB: { status: b.status, requestTx: tx.hash, round, onchainVerified: onchainOk, firstOverflowBlockNumber: String(data.responseBody.firstOverflowBlockNumber), proof: pj.proof, response_hex: pj.response_hex },
  testCprime: { status: c.status },
}, null, 2));

console.log("\n========== GATE 1 VERDICT ==========");
console.log(`A  owner heartbeat in window + source filter → ${a.status}`);
console.log(`B  attacker copies only + source filter      → ${b.status}, on-chain verify=${onchainOk}`);
console.log(`C' attacker copies only, filter OFF          → ${c.status}`);
const pass = aOk && b.status === "VALID" && onchainOk === true && cOk;
console.log(pass ? "GATE 1: PASS — keep-alive griefing solved at the protocol level." : "GATE 1: PARTIAL — inspect gate1-out.json");
process.exit(pass ? 0 : 2);
