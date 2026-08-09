import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, toUtf8Bytes } from "ethers";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const receipt = read("./receipt.json");
const recovery = read("./recovery.json");
const keeper = read("./keeper-final.json");

const steps = ["wallet", "create", "fund", "heartbeat", "handover", "drill", "debrief"];
const event = (kind) => keeper.events.find((e) => e.kind === kind);

assert.equal(receipt.kind, "heirloom-rehearsal-receipt");
assert.equal(receipt.runId, "rh-mslmyc74-3c9xr8");
assert.equal(receipt.runType, "fresh-plan");
assert.equal(receipt.vault, recovery.vault);
assert.equal(receipt.build, recovery.buildSha);
assert.deepEqual(Object.keys(receipt.steps), steps);
assert.equal(receipt.completedAt - receipt.startedAt, receipt.totalSeconds);
assert.equal(receipt.totalSeconds, 850);
assert.equal(receipt.debriefScore.length, 3);
assert(receipt.debriefScore.every((answer) => answer.correct));

const { checksum, ...recoveryBody } = recovery;
assert.equal(checksum, keccak256(toUtf8Bytes(JSON.stringify(recoveryBody))));

assert.equal(event("funding").txXrpl, "6ACC1EA2069313E380998F6B7719C4D253DFB61A668216D1EBA7E6977CD9F380");
assert.equal(event("alive").round, 1420447);
assert.equal(event("drill").reason, "SilenceNotProven");
assert.equal(event("drill").vaultState, 2);
assert.equal(event("drill").rh, receipt.runId);
assert.equal(event("cancelled").txFlare, "0x2d3e185d18be66e6ba3548176f20a1598efe3f737f086e92c9f91d30c239d596");
assert.equal(event("settled").txXrpl, "E02F3ABEC16B2638697D8FE5969C09BCD4CB6AA2B826C5879C6187E93180D8E5");
assert.equal(keeper.receipt.settlements[0].deliveredDrops, "9950000");
assert.equal(keeper.receipt.awaitingSettlement.length, 0);
assert.equal(keeper.job, null);

console.log(JSON.stringify({
  ok: true,
  runId: receipt.runId,
  vault: receipt.vault,
  steps: steps.length,
  totalSeconds: receipt.totalSeconds,
  debrief: "3/3",
  finalEvent: event("settled").kind,
  returnedDrops: keeper.receipt.settlements[0].deliveredDrops,
}, null, 2));
