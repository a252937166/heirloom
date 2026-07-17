// Heirloom W1 spike #2: the positive leg + the inverse test.
// A) real XRPL heartbeat payment (owner → sink, 1 drop, destinationTag=vaultId)
//    — XRPL side via curl subprocess + offline signing (Node fetch can't reach
//      rippletest.net on this network; curl can)
// B) FDC XRPPayment proof round-trip for that heartbeat (raw + decoded saved)
// C) inverse: XRPPaymentNonexistence over a window CONTAINING the heartbeat
//    must be un-attestable → the on-chain form of "early claim REJECTED".
import { AbiCoder, Contract, JsonRpcProvider, Wallet, encodeBytes32String, formatEther, keccak256, toUtf8Bytes } from "ethers";
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
const SINK = "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN";
const TAG = 20260717;
const PROOF_OWNER = "0xe7bca53d56f6723f2c4317031f1da3b1d4ffe912";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function curlJson(url, body, extraArgs = []) {
  const args = ["-s", "-m", "25", url, "-H", "Content-Type: application/json", ...extraArgs];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await execFileP("curl", args, { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}
const xrplRpc = (method, params = {}) => curlJson(XRPL_HTTP, { method, params: [params] });

// --- A. XRPL heartbeat (curl + offline signing) ------------------------------
log("creating owner account via faucet (curl)…");
const fresp = await curlJson("https://faucet.altnet.rippletest.net/accounts", undefined, ["-X", "POST"]);
const ownerAddr = fresp.account.classicAddress ?? fresp.account.address;
const wallet = xrpl.Wallet.fromSeed(fresp.seed);
log(`owner = ${ownerAddr}`);
await sleep(6000); // funding settles

const ai = await xrplRpc("account_info", { account: ownerAddr, ledger_index: "validated" });
if (!ai.result.account_data) { console.error("owner not activated:", JSON.stringify(ai).slice(0, 300)); process.exit(1); }
const seq = ai.result.account_data.Sequence;
const cur = await xrplRpc("ledger_current", {});
const lastLedgerSeq = Number(cur.result.ledger_current_index) + 30;

const hbTx = {
  TransactionType: "Payment",
  Account: ownerAddr,
  Destination: SINK,
  Amount: "1", // 1 drop
  DestinationTag: TAG,
  Sequence: seq,
  Fee: "12",
  LastLedgerSequence: lastLedgerSeq,
};
const signed = wallet.sign(hbTx);
const subm = await xrplRpc("submit", { tx_blob: signed.tx_blob });
log(`submit → ${subm.result.engine_result} (${subm.result.engine_result_message ?? ""})`);
if (!String(subm.result.engine_result).startsWith("tes") && subm.result.engine_result !== "terQUEUED") {
  console.error(JSON.stringify(subm.result).slice(0, 400)); process.exit(1);
}
const hbHash = signed.hash;

let hb = null;
for (let i = 0; i < 20 && !hb; i++) {
  await sleep(3000);
  const t = await xrplRpc("tx", { transaction: hbHash });
  if (t.result?.validated) hb = t.result;
}
if (!hb) { console.error("heartbeat tx not validated in time"); process.exit(1); }
const hbLedger = Number(hb.ledger_index);
const lv = await xrplRpc("ledger", { ledger_index: "validated" });
const closeUnix = Number(lv.result.ledger.close_time) + 946684800;
log(`heartbeat validated: tx ${hbHash} ledger ${hbLedger} result ${hb.meta?.TransactionResult}`);

// --- B. XRPPayment proof round-trip ------------------------------------------
await sleep(15_000); // let verifier index reach confirmation depth (3 ledgers)
const prepPay = await (await fetch(`${VERIFIER}/verifier/xrp/XRPPayment/prepareRequest`, {
  method: "POST", headers: { "X-API-KEY": API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    attestationType: encodeBytes32String("XRPPayment"),
    sourceId: encodeBytes32String("testXRP"),
    requestBody: { transactionId: "0x" + hbHash.toLowerCase(), proofOwner: PROOF_OWNER },
  }),
})).json();
log(`XRPPayment prepareRequest → status=${prepPay.status ?? JSON.stringify(prepPay).slice(0, 200)}`);
if (prepPay.status !== "VALID") { console.error(prepPay); process.exit(1); }
const requestBytes = prepPay.abiEncodedRequest;

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
log(`submitted: fee=${formatEther(fee)} tx=${tx.hash}`);

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
log("finalized — fetching proof (raw + decoded)");

let raw = {};
for (let i = 0; i < 30 && !raw.response_hex; i++) {
  await sleep(8_000);
  raw = await (await fetch(`${DA}/api/v1/fdc/proof-by-request-round-raw`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
    body: JSON.stringify({ votingRoundId: round, requestBytes }),
  })).json().catch(() => ({}));
}
const dec = await (await fetch(`${DA}/api/v1/fdc/proof-by-request-round`, {
  method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
  body: JSON.stringify({ votingRoundId: round, requestBytes }),
})).json().catch(() => ({}));
log(`raw proof nodes=${raw.proof?.length}; decoded=${dec?.response ? "yes" : JSON.stringify(dec).slice(0, 120)}`);

// --- C. inverse: nonexistence over a window CONTAINING the heartbeat ---------
const inverse = await (await fetch(`${VERIFIER}/verifier/xrp/XRPPaymentNonexistence/prepareRequest`, {
  method: "POST", headers: { "X-API-KEY": API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    attestationType: encodeBytes32String("XRPPaymentNonexistence"),
    sourceId: encodeBytes32String("testXRP"),
    requestBody: {
      minimalBlockNumber: String(hbLedger - 5),
      deadlineBlockNumber: String(hbLedger + 5),
      deadlineTimestamp: String(closeUnix + 5),
      destinationAddressHash: keccak256(toUtf8Bytes(SINK)),
      amount: "1",
      checkFirstMemoData: false,
      firstMemoDataHash: "0x" + "00".repeat(32),
      checkDestinationTag: true,
      destinationTag: String(TAG),
      proofOwner: PROOF_OWNER,
    },
  }),
})).json();
log(`INVERSE nonexistence over heartbeat window → ${JSON.stringify(inverse).slice(0, 300)}`);

writeFileSync(new URL("./out-heartbeat.json", import.meta.url), JSON.stringify({
  owner: ownerAddr, sink: SINK, tag: TAG,
  heartbeat: { hash: hbHash, ledger: hbLedger },
  fdc: { requestTx: tx.hash, round, requestBytes, raw, decoded: dec },
  inverse,
  contracts: { hubAddr, relayAddr, fdcVerAddr },
}, null, 2));
log("saved → spike/out-heartbeat.json");
console.log(`\nHEARTBEAT PROOF: XRPL tx ${hbHash} (owner ${ownerAddr} → sink, 1 drop, tag ${TAG}) attested in round ${round}.`);
console.log(`INVERSE STATUS: ${inverse.status ?? "ERROR"} — ${inverse.status === "VALID" ? "verifier prepared it (falsity would surface at voting) — investigate" : "a claim window containing a heartbeat cannot even be prepared → early claim structurally impossible"}.`);
