// Gate 1: ReferencedPaymentNonexistence three-state test — the product's load-bearing wall.
//   A) owner heartbeat inside window, root=owner        → expect INVALID (owner detected)
//   B) only attacker copies of the same reference, root=owner → expect VALID + on-chain verify true
//      (= attacker CANNOT keep the vault alive)
//   C') same window as B but checkSourceAddresses=false → expect INVALID (control: filter is what saves us)
// Also discovers the correct sourceAddressesRoot construction for a single owner address.
import { AbiCoder, Contract, JsonRpcProvider, Wallet, encodeBytes32String, formatEther, keccak256, toUtf8Bytes, hexlify, randomBytes } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import xrpl from "xrpl";

const execFileP = promisify(execFile);
const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const VERIFIER = "https://fdc-verifiers-testnet.flare.network";
const API_KEY = "00000000-0000-0000-0000-000000000000";
const DA = "https://ctn2-data-availability.flare.network";
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const XRPL_HTTP = "https://s.altnet.rippletest.net:51234/";
const BEACON = "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN"; // activated global beacon

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function curlJson(url, body, extraArgs = []) {
  const args = ["-s", "-m", "25", url, "-H", "Content-Type: application/json", ...extraArgs];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await execFileP("curl", args, { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}
const xrplRpc = (method, params = {}) => curlJson(XRPL_HTTP, { method, params: [params] });

async function newFundedAccount(label) {
  const f = await curlJson("https://faucet.altnet.rippletest.net/accounts", undefined, ["-X", "POST"]);
  const addr = f.account.classicAddress ?? f.account.address;
  log(`${label} = ${addr}`);
  return { addr, wallet: xrpl.Wallet.fromSeed(f.seed) };
}

async function sendRefPayment(acct, referenceHex64, label) {
  const ai = await xrplRpc("account_info", { account: acct.addr, ledger_index: "validated" });
  if (!ai.result.account_data) throw new Error(`${label}: account not activated`);
  const cur = await xrplRpc("ledger_current", {});
  const tx = {
    TransactionType: "Payment",
    Account: acct.addr,
    Destination: BEACON,
    Amount: "1",
    Sequence: ai.result.account_data.Sequence,
    Fee: "12",
    LastLedgerSequence: Number(cur.result.ledger_current_index) + 30,
    Memos: [{ Memo: { MemoData: referenceHex64.toUpperCase() } }], // exactly one memo, 32 bytes
  };
  const signed = acct.wallet.sign(tx);
  const sub = await xrplRpc("submit", { tx_blob: signed.tx_blob });
  if (!String(sub.result.engine_result).startsWith("tes")) throw new Error(`${label} submit: ${sub.result.engine_result}`);
  let v = null;
  for (let i = 0; i < 20 && !v; i++) {
    await sleep(3000);
    const t = await xrplRpc("tx", { transaction: signed.hash });
    if (t.result?.validated) v = t.result;
  }
  if (!v) throw new Error(`${label}: not validated`);
  const ts = Number(v.date) + 946684800;
  log(`${label}: tx ${signed.hash} ledger ${v.ledger_index} result ${v.meta?.TransactionResult}`);
  return { hash: signed.hash, ledger: Number(v.ledger_index), ts };
}

async function rpnPrepare(body) {
  return await (await fetch(`${VERIFIER}/verifier/xrp/ReferencedPaymentNonexistence/prepareRequest`, {
    method: "POST", headers: { "X-API-KEY": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      attestationType: encodeBytes32String("ReferencedPaymentNonexistence"),
      sourceId: encodeBytes32String("testXRP"),
      requestBody: body,
    }),
  })).json();
}

// ---------------------------------------------------------------------------
log("Gate 1 start — creating owner + attacker accounts");
const owner = await newFundedAccount("owner");
const attacker = await newFundedAccount("attacker");
await sleep(6000);

const reference = hexlify(randomBytes(32)).slice(2); // 64 hex chars, no 0x
log(`heartbeatReference = ${reference}`);

// t0: owner heartbeat; t1,t2: attacker copies of the SAME reference
const hb = await sendRefPayment(owner, reference, "owner heartbeat");
const at1 = await sendRefPayment(attacker, reference, "attacker copy #1");
const at2 = await sendRefPayment(attacker, reference, "attacker copy #2");
await sleep(20_000); // confirmation depth + verifier indexing

const lv = await xrplRpc("ledger", { ledger_index: "validated" });
const nowUnix = Number(lv.result.ledger.close_time) + 946684800;
const validated = Number(lv.result.ledger.ledger_index);

// candidate constructions of sourceAddressesRoot for a single owner address
const leaf = keccak256(toUtf8Bytes(owner.addr));
const rootCandidates = {
  "leaf(keccak(addr))": leaf,
  "keccak(leaf)": keccak256(leaf),
  "sortedPair(leaf,leaf)": keccak256("0x" + leaf.slice(2) + leaf.slice(2)),
};

const mkBody = (minLedger, dlLedger, dlTs, check, root) => ({
  minimalBlockNumber: String(minLedger),
  deadlineBlockNumber: String(dlLedger),
  deadlineTimestamp: String(dlTs),
  destinationAddressHash: keccak256(toUtf8Bytes(BEACON)),
  amount: "1",
  standardPaymentReference: "0x" + reference,
  checkSourceAddresses: check,
  ...(check ? { sourceAddressesRoot: root } : { sourceAddressesRoot: "0x" + "00".repeat(32) }),
});

// --- Test A: window contains owner heartbeat, root = owner → INVALID --------
// (also discovers which root construction the verifier actually uses)
let workingRoot = null, aResults = {};
for (const [name, root] of Object.entries(rootCandidates)) {
  const r = await rpnPrepare(mkBody(hb.ledger - 2, at2.ledger + 2, nowUnix - 15, true, root));
  aResults[name] = r.status ?? r;
  log(`A[${name}] → ${JSON.stringify(r).slice(0, 160)}`);
  if (String(r.status).startsWith("INVALID") && !workingRoot) workingRoot = { name, root };
  await sleep(500);
}
// a root that makes the verifier SEE owner's payment (INVALID = matching payment found)
if (!workingRoot) {
  log("!! no candidate root made owner's payment match — dumping and stopping for analysis");
  writeFileSync(new URL("./gate1-out.json", import.meta.url), JSON.stringify({ phase: "A-failed", aResults, owner: owner.addr, attacker: attacker.addr, reference, hb, at1, at2 }, null, 2));
  process.exit(1);
}
log(`✓ Test A: owner detected with root=${workingRoot.name} (INVALID as expected)`);

// --- Test B: window AFTER owner heartbeat (attacker copies only), root=owner → VALID
const bPrep = await rpnPrepare(mkBody(hb.ledger + 1, at2.ledger + 2, nowUnix - 15, true, workingRoot.root));
log(`B prepare → ${JSON.stringify(bPrep).slice(0, 200)}`);
if (bPrep.status !== "VALID") {
  writeFileSync(new URL("./gate1-out.json", import.meta.url), JSON.stringify({ phase: "B-failed", aResults, bPrep, owner: owner.addr, attacker: attacker.addr, reference, hb, at1, at2 }, null, 2));
  console.error("Gate 1 FAILED at B — attacker payments were not filtered by source root");
  process.exit(1);
}

// --- Test C': same window as B but checkSourceAddresses=false → INVALID (control)
const cPrep = await rpnPrepare(mkBody(hb.ledger + 1, at2.ledger + 2, nowUnix - 15, false, null));
log(`C' prepare (no source filter) → status=${cPrep.status} (expect INVALID: attacker payment matches without filter)`);

// --- B full round-trip: submit → finalize → DA proof → on-chain verify -------
const requestBytes = bPrep.abiEncodedRequest;
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
const relay = new Contract(relayAddr, ["function isFinalized(uint256,uint256) view returns (bool)", "function merkleRoots(uint256,uint256) view returns (bytes32)"], provider);
const protocolId = await new Contract(fdcVerAddr, ["function fdcProtocolId() view returns (uint8)"], provider).fdcProtocolId();
log(`B round ${round} — waiting for finalization`);
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
log(`B DA proof: ${pj.proof?.length}-node branch`);

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
log(`B on-chain verifyReferencedPaymentNonexistence → ${onchainOk}`);

writeFileSync(new URL("./gate1-out.json", import.meta.url), JSON.stringify({
  owner: owner.addr, attacker: attacker.addr, beacon: BEACON, reference: "0x" + reference,
  payments: { ownerHeartbeat: hb, attacker1: at1, attacker2: at2 },
  testA: { results: aResults, workingRoot: workingRoot.name, rootValue: workingRoot.root },
  testB: { prepareStatus: bPrep.status, requestTx: tx.hash, round, onchainVerified: onchainOk, firstOverflowBlockNumber: String(data.responseBody.firstOverflowBlockNumber), proof: pj.proof, response_hex: pj.response_hex },
  testCprime: { status: cPrep.status },
}, null, 2));

console.log("\n========== GATE 1 VERDICT ==========");
console.log(`A  owner-in-window + source filter  → ${aResults[workingRoot.name]} (expect INVALID)  root=${workingRoot.name}`);
console.log(`B  attacker-only + source filter    → ${bPrep.status} (expect VALID), on-chain verify=${onchainOk}`);
console.log(`C' attacker-only, filter OFF        → ${cPrep.status} (expect INVALID)`);
const pass = String(aResults[workingRoot.name]).startsWith("INVALID") && bPrep.status === "VALID" && onchainOk === true && String(cPrep.status).startsWith("INVALID");
console.log(pass ? "GATE 1: PASS — keep-alive griefing is solved at the protocol level." : "GATE 1: PARTIAL — inspect gate1-out.json");
process.exit(pass ? 0 : 2);
