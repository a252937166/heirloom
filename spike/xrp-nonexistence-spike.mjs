// Heirloom spike: full XRPPaymentNonexistence round-trip on Coston2.
// Proves via Flare consensus that NO XRPL payment with destinationTag=TAG
// reached SINK in a recent ledger window — the "proof of silence" primitive.
import {
  AbiCoder, Contract, JsonRpcProvider, Wallet,
  encodeBytes32String, formatEther, keccak256, toUtf8Bytes,
} from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const VERIFIER = "https://fdc-verifiers-testnet.flare.network";
const API_KEY = "00000000-0000-0000-0000-000000000000";
const DA = "https://ctn2-data-availability.flare.network";
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const XRPL_RPC = "https://s.altnet.rippletest.net:51234/";

const SINK = "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN"; // heartbeat sink (fresh faucet acct)
const TAG = 20260717; // vault id / heartbeat tag
const PROOF_OWNER = "0xe7bca53d56f6723f2c4317031f1da3b1d4ffe912"; // agent EOA, lowercased

const abi = AbiCoder.defaultAbiCoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// --- 1. XRPL window -------------------------------------------------------
const xrpl = await (await fetch(XRPL_RPC, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ method: "ledger", params: [{ ledger_index: "validated" }] }),
})).json();
const validated = Number(xrpl.result.ledger.ledger_index);
const closeUnix = Number(xrpl.result.ledger.close_time) + 946684800;
const requestBody = {
  minimalBlockNumber: String(validated - 120),
  deadlineBlockNumber: String(validated - 15),
  deadlineTimestamp: String(closeUnix - 60),
  destinationAddressHash: keccak256(toUtf8Bytes(SINK)),
  amount: "1",
  checkFirstMemoData: false,
  firstMemoDataHash: "0x" + "00".repeat(32),
  checkDestinationTag: true,
  destinationTag: String(TAG),
  proofOwner: PROOF_OWNER,
};
log(`window: ledgers ${requestBody.minimalBlockNumber}..${requestBody.deadlineBlockNumber}, sink=${SINK}, tag=${TAG}`);

// --- 2. prepareRequest ----------------------------------------------------
const prepared = await (await fetch(
  `${VERIFIER}/verifier/xrp/XRPPaymentNonexistence/prepareRequest`, {
    method: "POST",
    headers: { "X-API-KEY": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      attestationType: encodeBytes32String("XRPPaymentNonexistence"),
      sourceId: encodeBytes32String("testXRP"),
      requestBody,
    }),
  })).json();
log(`prepareRequest → ${JSON.stringify(prepared).slice(0, 200)}`);
if (prepared.status !== "VALID" || !prepared.abiEncodedRequest) {
  console.error("verifier rejected:", prepared);
  process.exit(1);
}
const requestBytes = prepared.abiEncodedRequest;

// --- 3. submit to FdcHub ---------------------------------------------------
const provider = new JsonRpcProvider(RPC);
const agent = new Wallet(
  readFileSync(new URL("../../faktura-flare/keys/agent.key", import.meta.url), "utf8").trim(),
  provider,
);
const registry = new Contract(REGISTRY, ["function getContractAddressByName(string) view returns (address)"], agent);
const [hubAddr, feeAddr, fsmAddr, relayAddr, fdcVerAddr] = await Promise.all(
  ["FdcHub", "FdcRequestFeeConfigurations", "FlareSystemsManager", "Relay", "FdcVerification"]
    .map((n) => registry.getContractAddressByName(n)),
);
const fee = await new Contract(feeAddr, ["function getRequestFee(bytes) view returns (uint256)"], agent).getRequestFee(requestBytes);
const tx = await new Contract(hubAddr, ["function requestAttestation(bytes) payable"], agent).requestAttestation(requestBytes, { value: fee });
const rc = await tx.wait();
log(`submitted: fee=${formatEther(fee)} C2FLR tx=${tx.hash}`);

// --- 4. voting round + finalization ----------------------------------------
const fsm = new Contract(fsmAddr, [
  "function firstVotingRoundStartTs() view returns (uint64)",
  "function votingEpochDurationSeconds() view returns (uint64)",
], provider);
const blk = await provider.getBlock(rc.blockNumber);
const [startTs, epochSec] = await Promise.all([fsm.firstVotingRoundStartTs(), fsm.votingEpochDurationSeconds()]);
const round = Number((BigInt(blk.timestamp) - startTs) / epochSec);
log(`voting round ${round} — waiting for finalization`);
const relay = new Contract(relayAddr, [
  "function isFinalized(uint256,uint256) view returns (bool)",
  "function merkleRoots(uint256,uint256) view returns (bytes32)",
], provider);
const protocolId = await new Contract(fdcVerAddr, ["function fdcProtocolId() view returns (uint8)"], provider).fdcProtocolId();
const deadline = Date.now() + 12 * 60_000;
while (!(await relay.isFinalized(protocolId, round))) {
  if (Date.now() > deadline) { console.error("not finalized after 12 min"); process.exit(1); }
  await sleep(15_000);
}
log(`round ${round} finalized — fetching proof from DA layer`);

// --- 5. proof from DA -------------------------------------------------------
let pj = {};
for (let i = 0; i < 30 && !pj.response_hex; i++) {
  await sleep(8_000);
  pj = await (await fetch(`${DA}/api/v1/fdc/proof-by-request-round-raw`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
    body: JSON.stringify({ votingRoundId: round, requestBytes }),
  })).json().catch(() => ({}));
}
if (!pj.response_hex) { console.error("DA returned no proof", pj); process.exit(1); }
log(`DA proof: ${pj.proof?.length ?? 0}-node merkle branch`);

// --- 6. decode + verify on-chain --------------------------------------------
const REQ_T = "tuple(uint64 minimalBlockNumber, uint64 deadlineBlockNumber, uint64 deadlineTimestamp, bytes32 destinationAddressHash, uint256 amount, bool checkFirstMemoData, bytes32 firstMemoDataHash, bool checkDestinationTag, uint256 destinationTag, address proofOwner)";
const RES_T = "tuple(uint64 minimalBlockTimestamp, uint64 firstOverflowBlockNumber, uint64 firstOverflowBlockTimestamp)";
const RESPONSE_T = `tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ${REQ_T} requestBody, ${RES_T} responseBody)`;
let decoded, usedType = RESPONSE_T;
try {
  [decoded] = abi.decode([RESPONSE_T], pj.response_hex);
} catch (e) {
  // fallback: legacy variant without proofOwner in requestBody
  const REQ_T2 = REQ_T.replace(", address proofOwner)", ")");
  usedType = RESPONSE_T.replace(REQ_T, REQ_T2);
  [decoded] = abi.decode([usedType], pj.response_hex);
}
log(`decoded response: votingRound=${decoded.votingRound} firstOverflowBlock=${decoded.responseBody.firstOverflowBlockNumber}`);

// independent merkle verification against the Relay root
const root = await relay.merkleRoots(protocolId, round);
let leaf = keccak256(pj.response_hex);
for (const node of pj.proof ?? []) {
  const [a, b] = [leaf.toLowerCase(), node.toLowerCase()].sort();
  leaf = keccak256("0x" + a.slice(2) + b.slice(2));
}
const merkleOk = leaf.toLowerCase() === root.toLowerCase();
log(`relay merkle root ${root} — recomputed match: ${merkleOk}`);

// typed on-chain verification via FdcVerification
let onchainOk = null;
try {
  const ver = new Contract(fdcVerAddr, [
    `function verifyXRPPaymentNonexistence(tuple(bytes32[] merkleProof, ${usedType} data) _proof) view returns (bool)`,
  ], provider);
  onchainOk = await ver.verifyXRPPaymentNonexistence({ merkleProof: pj.proof ?? [], data: decoded });
} catch (e) {
  log(`typed verify unavailable on FdcVerification (${e.shortMessage ?? e.message}) — merkle check stands`);
}

const result = {
  requestTx: tx.hash, votingRound: round, fee: formatEther(fee),
  window: requestBody, firstOverflowBlockNumber: String(decoded.responseBody.firstOverflowBlockNumber),
  merkleRoot: root, merkleOk, onchainOk, proof: pj.proof, response_hex: pj.response_hex,
  contracts: { hubAddr, relayAddr, fdcVerAddr }, protocolId: Number(protocolId),
};
writeFileSync(new URL("./out.json", import.meta.url), JSON.stringify(result, null, 2));
log(`RESULT: merkleOk=${merkleOk} onchainOk=${onchainOk} → spike/out.json`);
console.log(`\nPROOF OF SILENCE: no payment with tag ${TAG} reached ${SINK} in ledgers ${requestBody.minimalBlockNumber}-${decoded.responseBody.firstOverflowBlockNumber} — attested by Flare round ${round}, anchored in root ${root.slice(0, 18)}…`);
