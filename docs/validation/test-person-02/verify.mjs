import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, toUtf8Bytes } from "ethers";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const receipt = read("./receipt.json");
const recovery = read("./recovery.json");
const keeper = read("./keeper-final.json");

const steps = ["wallet", "create", "fund", "heartbeat", "handover", "drill", "debrief"];
const event = (kind) => keeper.events.find((entry) => entry.kind === kind);

assert.equal(receipt.kind, "heirloom-rehearsal-receipt");
assert.equal(receipt.runId, "rh-mslpxllp-5qgx0p");
assert.equal(receipt.runType, "fresh-plan");
assert.equal(receipt.vault, recovery.vault);
assert.equal(receipt.build, "7e010a3");
assert.equal(receipt.build, recovery.buildSha);
assert.deepEqual(Object.keys(receipt.steps), steps);
assert.equal(receipt.completedAt - receipt.startedAt, receipt.totalSeconds);
assert.equal(receipt.totalSeconds, 720);
assert.equal(receipt.debriefScore.length, 3);
assert(receipt.debriefScore.every((answer) => answer.correct));

const { checksum, ...recoveryBody } = recovery;
assert.equal(checksum, keccak256(toUtf8Bytes(JSON.stringify(recoveryBody))));

assert.equal(event("funding").txXrpl, "26DD1EB6A84F40048741AADEA41D1AA83074B95A72671D72C092B562D8DD28D8");
assert.equal(event("alive").round, 1420503);

const drill = event("drill");
assert.equal(drill.reason, "SilenceNotProven");
assert.equal(drill.vaultState, 2);
assert.equal(drill.evaluatedBlock, 33819040);
assert.equal(drill.insideOwnerWindow, true);
assert.equal(drill.rh, receipt.runId);
assert(drill.evaluatedAt <= drill.silenceDeadline);
assert.equal(drill.silenceDeadline - drill.evaluatedAt, 366);
assert.match(receipt.steps.drill.evidence, /Coston2 block 33819040/);
assert.match(receipt.steps.drill.evidence, /owner-window=true/);
assert.match(receipt.steps.drill.evidence, /run-tagged/);

assert.equal(event("cancelled").txFlare, "0x00761100c23f2f7542c5e811790ac5fe3b0370a554fcdfa824eae2be6e5ba2e5");
assert.equal(event("settled").txXrpl, "77F2AF6875486C4DFA69E996BDF9F17B3AF7B31A41534466F47AE33EE30BDC22");
assert.equal(keeper.receipt.settlements[0].deliveredDrops, "9950000");
assert.equal(keeper.receipt.awaitingSettlement.length, 0);
assert.equal(keeper.job, null);

console.log(JSON.stringify({
  ok: true,
  build: receipt.build,
  runId: receipt.runId,
  vault: receipt.vault,
  steps: steps.length,
  totalSeconds: receipt.totalSeconds,
  debrief: "3/3",
  evaluatedBlock: drill.evaluatedBlock,
  insideOwnerWindow: drill.insideOwnerWindow,
  finalEvent: event("settled").kind,
  returnedDrops: keeper.receipt.settlements[0].deliveredDrops,
}, null, 2));
