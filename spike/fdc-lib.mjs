// Shared FDC/XRPL helpers — the keeper's core logic in library form.
// XRPL side goes through curl (Node fetch cannot reach rippletest.net on this
// network); Flare side uses Node fetch + ethers (proven reliable).
import { AbiCoder, Contract, JsonRpcProvider, Wallet, encodeBytes32String, keccak256, toUtf8Bytes } from "ethers";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import xrpl from "xrpl";

const execFileP = promisify(execFile);

export const RPC = "https://coston2-api.flare.network/ext/C/rpc";
export const VERIFIER = "https://fdc-verifiers-testnet.flare.network";
export const API_KEY = "00000000-0000-0000-0000-000000000000";
export const DA = "https://ctn2-data-availability.flare.network";
export const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
export const XRPL_HTTP = "https://s.altnet.rippletest.net:51234/";
export const RIPPLE_EPOCH = 946684800;

export const provider = new JsonRpcProvider(RPC);
export const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const addrHash = (r) => keccak256(toUtf8Bytes(r));
export const sourceRootFor = (r) => keccak256(addrHash(r));

export function agentWallet() {
  const keyPath = process.env.HEIRLOOM_KEY_FILE
    ? new URL(`file://${process.env.HEIRLOOM_KEY_FILE}`)
    : new URL("../../faktura-flare/keys/agent.key", import.meta.url);
  return new Wallet(readFileSync(keyPath, "utf8").trim(), provider);
}

// --- XRPL via curl -----------------------------------------------------------

// Transport adapts to the host: modern environments use Node fetch; hosts where
// fetch cannot reach XRPL (some local networks) fall back to curl. The first
// success wins and is remembered.
let xrplTransport = null; // "fetch" | "curl"

async function fetchJson(url, body, method) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: ctl.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function curlJson(url, body, extraArgs = [], retries = 3) {
  for (let i = 0; ; i++) {
    try {
      if (xrplTransport !== "curl") {
        try {
          const j = await fetchJson(url, body, extraArgs.includes("-X") ? "POST" : undefined);
          xrplTransport = "fetch";
          return j;
        } catch (e) {
          if (xrplTransport === "fetch") throw e; // fetch was proven to work; treat as transient
          xrplTransport = "curl"; // never worked → fall through to curl permanently
        }
      }
      const args = ["-s", "-m", "30", url, "-H", "Content-Type: application/json", ...extraArgs];
      if (body !== undefined) args.push("-d", JSON.stringify(body));
      const { stdout } = await execFileP("curl", args, { maxBuffer: 10 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (e) {
      if (i >= retries) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}
export const xrplRpc = (method, params = {}) => curlJson(XRPL_HTTP, { method, params: [params] });

export async function newFundedAccount(label = "acct") {
  const f = await curlJson("https://faucet.altnet.rippletest.net/accounts", undefined, ["-X", "POST"], 5);
  const address = f.account.classicAddress ?? f.account.address;
  log(`${label}: ${address}`);
  return { address, seed: f.seed, wallet: xrpl.Wallet.fromSeed(f.seed) };
}

export async function validatedLedger() {
  const lv = await xrplRpc("ledger", { ledger_index: "validated" });
  return { ledger: Number(lv.result.ledger.ledger_index), ts: Number(lv.result.ledger.close_time) + RIPPLE_EPOCH };
}

/** Sign offline and submit via HTTP; waits for validation. memoHex: single-memo hex (no 0x). */
export async function sendXrplPayment(acct, destination, amountDrops, memoHex, label = "payment") {
  const ai = await xrplRpc("account_info", { account: acct.address, ledger_index: "validated" });
  if (!ai.result.account_data) throw new Error(`${label}: account not activated`);
  const cur = await xrplRpc("ledger_current", {});
  const tx = {
    TransactionType: "Payment",
    Account: acct.address,
    Destination: destination,
    Amount: String(amountDrops),
    Sequence: ai.result.account_data.Sequence,
    Fee: "12",
    LastLedgerSequence: Number(cur.result.ledger_current_index) + 40,
    ...(memoHex ? { Memos: [{ Memo: { MemoData: memoHex.toUpperCase() } }] } : {}),
  };
  const signed = acct.wallet.sign(tx);
  const sub = await xrplRpc("submit", { tx_blob: signed.tx_blob });
  if (!String(sub.result.engine_result).startsWith("tes")) {
    throw new Error(`${label} submit: ${sub.result.engine_result} ${sub.result.engine_result_message ?? ""}`);
  }
  for (let i = 0; i < 25; i++) {
    await sleep(3000);
    const t = await xrplRpc("tx", { transaction: signed.hash });
    if (t.result?.validated) {
      const ts = Number(t.result.date) + RIPPLE_EPOCH;
      log(`${label}: tx ${signed.hash} ledger ${t.result.ledger_index} ${t.result.meta?.TransactionResult}`);
      return { hash: signed.hash, ledger: Number(t.result.ledger_index), ts, result: t.result.meta?.TransactionResult };
    }
  }
  throw new Error(`${label}: not validated in time`);
}

// --- FDC round-trips ---------------------------------------------------------

async function fdcContracts(signer) {
  const registry = new Contract(REGISTRY, ["function getContractAddressByName(string) view returns (address)"], signer);
  const [hub, feeCfg, fsm, relay, fdcVer] = await Promise.all(
    ["FdcHub", "FdcRequestFeeConfigurations", "FlareSystemsManager", "Relay", "FdcVerification"].map((n) =>
      registry.getContractAddressByName(n),
    ),
  );
  return { hub, feeCfg, fsm, relay, fdcVer };
}

/** prepareRequest → FdcHub → finalization → DA raw proof. Returns {round, proof, response_hex, requestTx}. */
export async function attest(signer, pathType, requestBody, attestationType) {
  let prep;
  for (let i = 0; ; i++) {
    prep = await (await fetch(`${VERIFIER}/verifier/xrp/${pathType}/prepareRequest`, {
      method: "POST", headers: { "X-API-KEY": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        attestationType: encodeBytes32String(attestationType ?? pathType),
        sourceId: encodeBytes32String("testXRP"),
        requestBody,
      }),
    })).json();
    // the verifier indexes XRPL with a small lag; retry while it catches up
    const retriable = typeof prep.status === "string" &&
      (prep.status.includes("DOES NOT EXIST") || prep.status.includes("INDETERMINATE"));
    if (prep.status === "VALID" || !retriable || i >= 12) break;
    log(`${pathType} prepare: ${prep.status} — verifier still indexing, retry ${i + 1}/12`);
    await sleep(12_000);
  }
  if (prep.status !== "VALID") throw new Error(`${pathType} prepare: ${JSON.stringify(prep).slice(0, 200)}`);
  const requestBytes = prep.abiEncodedRequest;

  const c = await fdcContracts(signer);
  const fee = await new Contract(c.feeCfg, ["function getRequestFee(bytes) view returns (uint256)"], signer).getRequestFee(requestBytes);
  const tx = await new Contract(c.hub, ["function requestAttestation(bytes) payable"], signer).requestAttestation(requestBytes, { value: fee });
  const rc = await tx.wait();
  const fsm = new Contract(c.fsm, ["function firstVotingRoundStartTs() view returns (uint64)", "function votingEpochDurationSeconds() view returns (uint64)"], provider);
  const blk = await provider.getBlock(rc.blockNumber);
  const [startTs, epochSec] = await Promise.all([fsm.firstVotingRoundStartTs(), fsm.votingEpochDurationSeconds()]);
  const round = Number((BigInt(blk.timestamp) - startTs) / epochSec);
  const relay = new Contract(c.relay, ["function isFinalized(uint256,uint256) view returns (bool)"], provider);
  const protocolId = await new Contract(c.fdcVer, ["function fdcProtocolId() view returns (uint8)"], provider).fdcProtocolId();
  log(`${pathType} attestation submitted (round ${round}) — waiting for finalization`);
  const dl = Date.now() + 12 * 60_000;
  while (!(await relay.isFinalized(protocolId, round))) {
    if (Date.now() > dl) throw new Error("finalization timeout");
    await sleep(12_000);
  }
  let pj = {};
  for (let i = 0; i < 40 && !pj.response_hex; i++) {
    await sleep(6_000);
    pj = await (await fetch(`${DA}/api/v1/fdc/proof-by-request-round-raw`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
      body: JSON.stringify({ votingRoundId: round, requestBytes }),
    })).json().catch(() => ({}));
  }
  if (!pj.response_hex) throw new Error("DA returned no proof");
  return { round, proof: pj.proof ?? [], response_hex: pj.response_hex, requestTx: tx.hash };
}

// --- typed fragments + decoding ---------------------------------------------

export const XRP_REQ = "tuple(bytes32 transactionId, address proofOwner)";
export const XRP_RES = "tuple(uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash, bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bool hasMemoData, bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status)";
export const XRP_DATA = `tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ${XRP_REQ} requestBody, ${XRP_RES} responseBody)`;
export const RPN_REQ = "tuple(uint64 minimalBlockNumber, uint64 deadlineBlockNumber, uint64 deadlineTimestamp, bytes32 destinationAddressHash, uint256 amount, bytes32 standardPaymentReference, bool checkSourceAddresses, bytes32 sourceAddressesRoot)";
export const RPN_RES = "tuple(uint64 minimalBlockTimestamp, uint64 firstOverflowBlockNumber, uint64 firstOverflowBlockTimestamp)";
export const RPN_DATA = `tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ${RPN_REQ} requestBody, ${RPN_RES} responseBody)`;

const coder = AbiCoder.defaultAbiCoder();

export function decodeXrpPayment(hex) {
  const [d] = coder.decode([XRP_DATA], hex);
  return {
    attestationType: d[0], sourceId: d[1], votingRound: d[2], lowestUsedTimestamp: d[3],
    requestBody: { transactionId: d[4][0], proofOwner: d[4][1] },
    responseBody: {
      blockNumber: d[5][0], blockTimestamp: d[5][1], sourceAddress: d[5][2], sourceAddressHash: d[5][3],
      receivingAddressHash: d[5][4], intendedReceivingAddressHash: d[5][5], spentAmount: d[5][6],
      intendedSpentAmount: d[5][7], receivedAmount: d[5][8], intendedReceivedAmount: d[5][9],
      hasMemoData: d[5][10], firstMemoData: d[5][11], hasDestinationTag: d[5][12], destinationTag: d[5][13], status: d[5][14],
    },
  };
}

export function decodeRpn(hex) {
  const [d] = coder.decode([RPN_DATA], hex);
  return {
    attestationType: d[0], sourceId: d[1], votingRound: d[2], lowestUsedTimestamp: d[3],
    requestBody: { minimalBlockNumber: d[4][0], deadlineBlockNumber: d[4][1], deadlineTimestamp: d[4][2], destinationAddressHash: d[4][3], amount: d[4][4], standardPaymentReference: d[4][5], checkSourceAddresses: d[4][6], sourceAddressesRoot: d[4][7] },
    responseBody: { minimalBlockTimestamp: d[5][0], firstOverflowBlockNumber: d[5][1], firstOverflowBlockTimestamp: d[5][2] },
  };
}

/** Full XRPPayment proof for a validated XRPL tx, as vault calldata. */
export async function proveXrpPayment(signer, txHash) {
  const r = await attest(signer, "XRPPayment", {
    transactionId: "0x" + txHash.toLowerCase(),
    proofOwner: signer.address.toLowerCase(),
  });
  return { merkleProof: r.proof, data: decodeXrpPayment(r.response_hex), meta: r };
}

/** Full RPN proof for a silence window, as vault calldata. */
export async function proveSilence(signer, { beacon, reference, ownerAddress, minLedger, deadlineLedger, deadlineTs }) {
  const r = await attest(signer, "ReferencedPaymentNonexistence", {
    minimalBlockNumber: String(minLedger),
    deadlineBlockNumber: String(deadlineLedger),
    deadlineTimestamp: String(deadlineTs),
    destinationAddressHash: addrHash(beacon),
    amount: "1",
    standardPaymentReference: reference,
    checkSourceAddresses: true,
    sourceAddressesRoot: sourceRootFor(ownerAddress),
  });
  return { merkleProof: r.proof, data: decodeRpn(r.response_hex), meta: r };
}

// --- direct minting ----------------------------------------------------------

export const DIRECT_MINT_PREFIX = "4642505266410018";
export const buildMintMemo = (recipientEvm) => DIRECT_MINT_PREFIX + "00000000" + recipientEvm.slice(2).toLowerCase();

export const VAULT_ABI = [
  `function recordHeartbeat(tuple(bytes32[] merkleProof, ${XRP_DATA} data) proof)`,
  `function attestSilence(tuple(bytes32[] merkleProof, ${RPN_DATA} data) proof)`,
  `function cancel(string ownerXrpl, tuple(bytes32[] merkleProof, ${XRP_DATA} data) proof) payable`,
  "function startClaim(string beneficiaryXrpl)",
  "function executeRelease() payable",
  "function activate()",
  "function state() view returns (uint8)",
  "function nextSilenceLedger() view returns (uint64)",
  "function silenceProvenThroughTs() view returns (uint64)",
  "function lastHeartbeatTs() view returns (uint64)",
  "function lastHeartbeatLedger() view returns (uint64)",
  "function claimChallengeEndsAt() view returns (uint64)",
  "function heartbeatEpoch() view returns (uint32)",
  "function silenceDeadline() view returns (uint64)",
  "function beneficiaryXrpl() view returns (string)",
];
export const FACTORY_ABI = [
  "function createVault((bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint64,uint64,uint64,uint256) c, uint256 crankRewardWei) payable returns (address)",
  "function vaultCount() view returns (uint256)",
  "function vaultByReference(bytes32) view returns (address)",
  "event VaultCreated(address indexed vault, uint256 indexed index, bytes32 ownerXrplHash, bytes32 beneficiaryXrplHash, bytes32 heartbeatReference, uint64 heartbeatPeriod, uint64 gracePeriod, uint64 challengePeriod)",
];
