// Re-verify the saved proof on-chain via FdcVerification.verifyXRPPaymentNonexistence.
// Rebuilds plain objects (ethers frozen-Result workaround) before the call.
import { AbiCoder, Contract, JsonRpcProvider } from "ethers";
import { readFileSync } from "node:fs";

const out = JSON.parse(readFileSync(new URL("./out.json", import.meta.url), "utf8"));
const provider = new JsonRpcProvider("https://coston2-api.flare.network/ext/C/rpc");

const REQ_T = "tuple(uint64 minimalBlockNumber, uint64 deadlineBlockNumber, uint64 deadlineTimestamp, bytes32 destinationAddressHash, uint256 amount, bool checkFirstMemoData, bytes32 firstMemoDataHash, bool checkDestinationTag, uint256 destinationTag, address proofOwner)";
const RES_T = "tuple(uint64 minimalBlockTimestamp, uint64 firstOverflowBlockNumber, uint64 firstOverflowBlockTimestamp)";
const RESPONSE_T = `tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ${REQ_T} requestBody, ${RES_T} responseBody)`;

const [d] = AbiCoder.defaultAbiCoder().decode([RESPONSE_T], out.response_hex);
const data = {
  attestationType: d[0], sourceId: d[1], votingRound: d[2], lowestUsedTimestamp: d[3],
  requestBody: {
    minimalBlockNumber: d[4][0], deadlineBlockNumber: d[4][1], deadlineTimestamp: d[4][2],
    destinationAddressHash: d[4][3], amount: d[4][4], checkFirstMemoData: d[4][5],
    firstMemoDataHash: d[4][6], checkDestinationTag: d[4][7], destinationTag: d[4][8],
    proofOwner: d[4][9],
  },
  responseBody: {
    minimalBlockTimestamp: d[5][0], firstOverflowBlockNumber: d[5][1], firstOverflowBlockTimestamp: d[5][2],
  },
};

const ver = new Contract(out.contracts.fdcVerAddr, [
  `function verifyXRPPaymentNonexistence(tuple(bytes32[] merkleProof, ${RESPONSE_T} data) _proof) view returns (bool)`,
], provider);
const ok = await ver.verifyXRPPaymentNonexistence({ merkleProof: out.proof, data });
console.log(`FdcVerification.verifyXRPPaymentNonexistence on-chain → ${ok}`);
