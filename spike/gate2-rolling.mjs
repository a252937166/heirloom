// Gate 2: rolling silence checkpoints.
//   Segment 1: [lastHeartbeatLedger+1 … deadline T1]  → firstOverflowBlockNumber F1
//   Segment 2: [F1 … deadline T2]                     → chained, no gap, no overlap
// Both submitted in the SAME voting round, both proofs fetched and verified on-chain.
// Plus: LUT probe — how far back can minimalBlockNumber reach before the verifier
// refuses (determines max checkpoint interval for the real product).
import { AbiCoder, Contract, JsonRpcProvider, Wallet, encodeBytes32String, formatEther, keccak256, toUtf8Bytes } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const VERIFIER = "https://fdc-verifiers-testnet.flare.network";
const API_KEY = "00000000-0000-0000-0000-000000000000";
const DA = "https://ctn2-data-availability.flare.network";
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const XRPL_HTTP = "https://s.altnet.rippletest.net:51234/";
const BEACON = "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN";

const prev = JSON.parse(readFileSync(new URL("./gate1-out.json", import.meta.url), "utf8"));
const owner = prev.owner;
const reference = prev.reference.startsWith("0x") ? prev.reference.slice(2) : prev.reference;
const hb = prev.payments?.ownerHeartbeat ?? prev.hb;
const root = keccak256(keccak256(toUtf8Bytes(owner)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function xrplRpc(method, params = {}) {
  const { stdout } = await execFileP("curl", ["-s", "-m", "25", XRPL_HTTP, "-H", "Content-Type: application/json", "-d", JSON.stringify({ method, params: [params] })], { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}
const rpnPrepare = async (body) => await (await fetch(`${VERIFIER}/verifier/xrp/ReferencedPaymentNonexistence/prepareRequest`, {
  method: "POST", headers: { "X-API-KEY": API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ attestationType: encodeBytes32String("ReferencedPaymentNonexistence"), sourceId: encodeBytes32String("testXRP"), requestBody: body }),
})).json();
const mkBody = (minLedger, dlLedger, dlTs) => ({
  minimalBlockNumber: String(minLedger), deadlineBlockNumber: String(dlLedger), deadlineTimestamp: String(dlTs),
  destinationAddressHash: keccak256(toUtf8Bytes(BEACON)), amount: "1",
  standardPaymentReference: "0x" + reference, checkSourceAddresses: true, sourceAddressesRoot: root,
});

const lv = await xrplRpc("ledger", { ledger_index: "validated" });
const nowLedger = Number(lv.result.ledger.ledger_index);
const nowTs = Number(lv.result.ledger.close_time) + 946684800;
log(`validated ledger ${nowLedger} @ ${nowTs}; heartbeat was @ ${hb.ledger}/${hb.ts}`);

// --- LUT probe (cheap, prepare-only): how far back can a window start? -------
// XRPL testnet ≈ 3s/ledger → 1 day ≈ 28800 ledgers.
const DAY = 28800;
const probes = [1, 3, 7, 12, 13, 14, 15, 20, 30];
const lut = {};
for (const days of probes) {
  const minL = nowLedger - days * DAY;
  if (minL < 1) { lut[days] = "out-of-range"; continue; }
  const r = await rpnPrepare(mkBody(minL, minL + 200, 0 /*deadlineTimestamp far past → ts of minL+? */));
  // deadlineTimestamp=0 would be invalid; use timestamp shortly after window start:
  const r2 = String(r.status ?? "").length ? r : {};
  lut[days] = r2.status ?? JSON.stringify(r2).slice(0, 80);
  await sleep(300);
}
log(`LUT probe (deadlineTs=0 variant): ${JSON.stringify(lut)}`);
// second, correctly-formed probe: deadlineTimestamp = estimated ts of window end
const lut2 = {};
for (const days of probes) {
  const minL = nowLedger - days * DAY;
  if (minL < 1) { lut2[days] = "out-of-range"; continue; }
  const endTs = nowTs - days * 86400 + 900; // ~15 min after window start
  const r = await rpnPrepare(mkBody(minL, minL + 300, endTs));
  lut2[days] = r.status ?? JSON.stringify(r).slice(0, 80);
  await sleep(300);
}
log(`LUT probe (proper deadlineTs): ${JSON.stringify(lut2)}`);

// --- Segment 1: heartbeat+1 → T1 (a bit after heartbeat) ---------------------
const t1 = hb.ts + 600; // 10 minutes of silence
const s1Prep = await rpnPrepare(mkBody(hb.ledger + 1, hb.ledger + 400, t1));
log(`segment1 prepare → ${s1Prep.status}`);
if (s1Prep.status !== "VALID") { console.error(s1Prep); process.exit(1); }

// To chain segment 2 we need segment 1's firstOverflowBlockNumber — the verifier
// computes it; recover it from the prepared request's response by asking the DA
// only AFTER attestation. But prepareRequest alone doesn't return the response.
// Trick: firstOverflow = first ledger with number > deadlineBlockNumber AND
// timestamp > deadlineTimestamp. We probe XRPL directly for it.
async function firstOverflow(dlLedger, dlTs) {
  let L = dlLedger + 1;
  for (let i = 0; i < 500; i++) {
    const r = await xrplRpc("ledger", { ledger_index: L });
    const ts = Number(r.result.ledger.close_time) + 946684800;
    if (ts > dlTs) return { ledger: L, ts };
    L++;
  }
  throw new Error("no overflow found");
}
const f1 = await firstOverflow(hb.ledger + 400, t1);
log(`segment1 expected firstOverflow: ledger ${f1.ledger} @ ${f1.ts}`);

// --- Segment 2: F1 → T2 ------------------------------------------------------
const t2 = t1 + 900;
const s2Prep = await rpnPrepare(mkBody(f1.ledger, f1.ledger + 500, t2));
log(`segment2 prepare (min == F1) → ${s2Prep.status}`);
if (s2Prep.status !== "VALID") { console.error(s2Prep); process.exit(1); }

// --- submit BOTH in the same round -------------------------------------------
const provider = new JsonRpcProvider(RPC);
const agent = new Wallet(readFileSync(new URL("../../faktura-flare/keys/agent.key", import.meta.url), "utf8").trim(), provider);
const registry = new Contract(REGISTRY, ["function getContractAddressByName(string) view returns (address)"], agent);
const [hubAddr, feeAddr, fsmAddr, relayAddr, fdcVerAddr] = await Promise.all(
  ["FdcHub", "FdcRequestFeeConfigurations", "FlareSystemsManager", "Relay", "FdcVerification"].map((n) => registry.getContractAddressByName(n)),
);
const feeCfg = new Contract(feeAddr, ["function getRequestFee(bytes) view returns (uint256)"], agent);
const hub = new Contract(hubAddr, ["function requestAttestation(bytes) payable"], agent);
const nonce = await provider.getTransactionCount(agent.address);
const [fee1, fee2] = await Promise.all([feeCfg.getRequestFee(s1Prep.abiEncodedRequest), feeCfg.getRequestFee(s2Prep.abiEncodedRequest)]);
const tx1 = await hub.requestAttestation(s1Prep.abiEncodedRequest, { value: fee1, nonce });
const tx2 = await hub.requestAttestation(s2Prep.abiEncodedRequest, { value: fee2, nonce: nonce + 1 });
const [rc1] = await Promise.all([tx1.wait(), tx2.wait()]);
log(`both segments submitted: ${tx1.hash.slice(0, 14)}… / ${tx2.hash.slice(0, 14)}…`);

const fsm = new Contract(fsmAddr, ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"], provider);
const blk = await provider.getBlock(rc1.blockNumber);
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

async function fetchProof(requestBytes) {
  let pj = {};
  for (let i = 0; i < 30 && !pj.response_hex; i++) {
    await sleep(6_000);
    pj = await (await fetch(`${DA}/api/v1/fdc/proof-by-request-round-raw`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
      body: JSON.stringify({ votingRoundId: round, requestBytes }),
    })).json().catch(() => ({}));
  }
  return pj;
}
const [p1, p2] = [await fetchProof(s1Prep.abiEncodedRequest), await fetchProof(s2Prep.abiEncodedRequest)];
if (!p1.response_hex || !p2.response_hex) { console.error("missing DA proof", !!p1.response_hex, !!p2.response_hex); process.exit(1); }

const REQ_T = "tuple(uint64 minimalBlockNumber, uint64 deadlineBlockNumber, uint64 deadlineTimestamp, bytes32 destinationAddressHash, uint256 amount, bytes32 standardPaymentReference, bool checkSourceAddresses, bytes32 sourceAddressesRoot)";
const RES_T = "tuple(uint64 minimalBlockTimestamp, uint64 firstOverflowBlockNumber, uint64 firstOverflowBlockTimestamp)";
const RESPONSE_T = `tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ${REQ_T} requestBody, ${RES_T} responseBody)`;
const coder = AbiCoder.defaultAbiCoder();
function decode(pj) {
  const [d] = coder.decode([RESPONSE_T], pj.response_hex);
  return {
    attestationType: d[0], sourceId: d[1], votingRound: d[2], lowestUsedTimestamp: d[3],
    requestBody: { minimalBlockNumber: d[4][0], deadlineBlockNumber: d[4][1], deadlineTimestamp: d[4][2], destinationAddressHash: d[4][3], amount: d[4][4], standardPaymentReference: d[4][5], checkSourceAddresses: d[4][6], sourceAddressesRoot: d[4][7] },
    responseBody: { minimalBlockTimestamp: d[5][0], firstOverflowBlockNumber: d[5][1], firstOverflowBlockTimestamp: d[5][2] },
  };
}
const d1 = decode(p1), d2 = decode(p2);
const ver = new Contract(fdcVerAddr, [`function verifyReferencedPaymentNonexistence(tuple(bytes32[] merkleProof, ${RESPONSE_T} data) _proof) view returns (bool)`], provider);
const [ok1, ok2] = [await ver.verifyReferencedPaymentNonexistence({ merkleProof: p1.proof ?? [], data: d1 }), await ver.verifyReferencedPaymentNonexistence({ merkleProof: p2.proof ?? [], data: d2 })];
const chained = BigInt(d2.requestBody.minimalBlockNumber) === BigInt(d1.responseBody.firstOverflowBlockNumber);
log(`seg1 verify=${ok1} firstOverflow=${d1.responseBody.firstOverflowBlockNumber}`);
log(`seg2 verify=${ok2} minimal=${d2.requestBody.minimalBlockNumber} → chained=${chained}`);

writeFileSync(new URL("./gate2-out.json", import.meta.url), JSON.stringify({
  lutProbe: lut2, round,
  segment1: { tx: tx1.hash, minimal: String(d1.requestBody.minimalBlockNumber), firstOverflow: String(d1.responseBody.firstOverflowBlockNumber), verified: ok1, proof: p1.proof, response_hex: p1.response_hex },
  segment2: { tx: tx2.hash, minimal: String(d2.requestBody.minimalBlockNumber), firstOverflow: String(d2.responseBody.firstOverflowBlockNumber), verified: ok2, proof: p2.proof, response_hex: p2.response_hex },
  chained,
}, null, 2));

console.log("\n========== GATE 2 VERDICT ==========");
console.log(`LUT probe (days → status): ${JSON.stringify(lut2)}`);
console.log(`segment1: verified=${ok1}, [hb+1 … F1=${d1.responseBody.firstOverflowBlockNumber}]`);
console.log(`segment2: verified=${ok2}, starts at ${d2.requestBody.minimalBlockNumber}, chained=${chained}`);
const pass = ok1 && ok2 && chained;
console.log(pass ? "GATE 2: PASS — rolling silence checkpoints chain cleanly." : "GATE 2: PARTIAL — inspect gate2-out.json");
process.exit(pass ? 0 : 2);
