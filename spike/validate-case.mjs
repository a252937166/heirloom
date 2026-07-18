// Static validator for the shipped case manifest (web/src/case-001.json).
// Runs in CI with zero dependencies: if any claim the dashboard makes stops
// being true — a check unpassed, a hash missing, the wrong contract version —
// the build fails instead of shipping a false receipt.
import { readFileSync } from "node:fs";

const m = JSON.parse(readFileSync(new URL("../web/src/case-001.json", import.meta.url), "utf8"));
const dep = JSON.parse(readFileSync(new URL("../contracts/deployments.real.json", import.meta.url), "utf8"));

const fails = [];
const ok = (c, msg) => { if (!c) fails.push(msg); };

ok(m.verdict === "SETTLED · FULLY RECONCILED", `verdict: ${m.verdict}`);
ok(m.finalState === 5, `finalState: ${m.finalState}`);
ok(m.finalFxrpBalance === "0", `finalFxrpBalance: ${m.finalFxrpBalance}`);
ok(Array.isArray(m.integrityChecks) && m.integrityChecks.length >= 5, "integrityChecks missing/short");
for (const c of m.integrityChecks ?? []) ok(c.passed === true, `check not passed: ${c.label}`);
for (const f of ["createdTxFlare", "fundingTxXrpl", "mintTxFlare", "heartbeatTxXrpl", "heartbeatTxFlare", "silenceTxFlare", "claimStartTxFlare", "releaseTxFlare"]) {
  ok(typeof m[f] === "string" && m[f].length >= 32, `missing tx hash: ${f}`);
}
ok(typeof m.settlement?.hash === "string" && m.settlement.hash.length === 64, "settlement.hash missing");
ok(/v4/.test(m.contractVersion ?? ""), `contractVersion not v4: ${m.contractVersion}`);
ok((m.contractVersion ?? "").includes(dep.factory), "factory in contractVersion != deployments.real.json");
ok(Number(m.challenge?.vetoProofGraceSec) > 0, "challenge.vetoProofGraceSec missing");
ok(Number(m.challenge?.releaseEligibleAt) > 0 && Number(m.challenge?.releaseExecutedAt) >= Number(m.challenge?.releaseEligibleAt),
  `release executed (${m.challenge?.releaseExecutedAt}) before eligible (${m.challenge?.releaseEligibleAt})`);
ok(m.protectedFxrpSource === "chain", `protectedFxrp not chain-derived: ${m.protectedFxrpSource}`);
ok(m.payoutXrpSource === "chain", `payoutXrp not chain-derived: ${m.payoutXrpSource}`);

if (fails.length) {
  console.error("case-001 INVALID:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log(`case-001 valid: ${m.vault} · ${m.verdict} · release ${m.challenge.releaseExecutedAt} ≥ eligible ${m.challenge.releaseEligibleAt}`);
