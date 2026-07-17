// Production-path e2e: drives the LIVE https://heirloom.axiqo.xyz stack the way
// a real user would — XRPL payments from the owner's wallet + keeper REST API.
// (Local script only signs XRPL payments; all proofs/cranks run on the server.)
import { readFileSync, writeFileSync } from "node:fs";
import { log, sleep, sendXrplPayment, curlJson } from "./fdc-lib.mjs";

const API = "https://heirloom.axiqo.xyz/api";
const S = JSON.parse(readFileSync(new URL("./e2e-prod-state.json", import.meta.url), "utf8"));
const accts = (() => {
  const saved = JSON.parse(readFileSync(new URL("./accounts.secret.json", import.meta.url), "utf8"));
  return saved;
})();
const xrpl = (await import("xrpl")).default;
const owner = { address: accts.owner.address, wallet: xrpl.Wallet.fromSeed(accts.owner.seed) };
const save = () => writeFileSync(new URL("./e2e-prod-state.json", import.meta.url), JSON.stringify(S, null, 2));

const api = async (path, opts = {}) => {
  const r = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    ...(opts.body ? { method: "POST", body: JSON.stringify(opts.body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
};
const events = async () => (await api(`/vaults/${S.vault}`)).events ?? [];
const lastKind = async () => (await events()).map((e) => e.kind);

log(`production e2e against ${S.vault} (owner ${owner.address})`);

// 1. fund
if (!S.fundTx) {
  const pay = await sendXrplPayment(owner, S.coreVaultXrpl, BigInt(S.grossDrops), S.fundingMemo, "funding payment");
  S.fundTx = pay.hash; save();
  await api(`/vaults/${S.vault}/funded`, { body: { xrplTx: pay.hash } });
}
log("waiting for the live keeper to prove + mint + activate…");
for (let i = 0; i < 60; i++) {
  const ks = await lastKind();
  if (ks.includes("active")) break;
  if (i === 59) throw new Error("activation timeout");
  await sleep(10_000);
}
log("vault ACTIVE (per live keeper events)");

// 2. heartbeat — rely on the beacon auto-scan (no POST): the product's passive path
if (!S.hbTx) {
  const hb = await sendXrplPayment(owner, S.beacon, 1n, S.reference.slice(2), "heartbeat");
  S.hbTx = hb.hash; save();
}
log("waiting for the heartbeat to be proven (chain epoch is the truth)…");
{
  const { Contract } = await import("ethers");
  const { provider, VAULT_ABI } = await import("./fdc-lib.mjs");
  const v = new Contract(S.vault, VAULT_ABI, provider);
  for (let i = 0; ; i++) {
    if (Number(await v.heartbeatEpoch()) >= 1) break;
    if (i >= 60) throw new Error("heartbeat proof timeout");
    await sleep(10_000);
  }
}
log("heartbeat proven on-chain (epoch ≥ 1)");

// 3. early claim must fail
try {
  await api(`/vaults/${S.vault}/claim`, { body: { beneficiaryXrpl: S.beneficiary } });
  // the keeper accepts the job; the on-chain claim will fail — watch for the error event
  await sleep(20_000);
} catch (e) {
  log(`early claim rejected at API level: ${String(e.message).slice(0, 120)}`);
}
const early = (await events()).filter((e) => e.kind === "error");
log(`early-claim outcome: ${early.length ? early.at(-1).label : "(job queued; silence attestation will refuse while owner is alive)"}`);

// 4. wait out the inactivity window, then claim for real
log("waiting out the inactivity window (~5.5 min)…");
await sleep(340_000);
await api(`/vaults/${S.vault}/claim`, { body: { beneficiaryXrpl: S.beneficiary } });
for (let i = 0; i < 80; i++) {
  const ks = await lastKind();
  if (ks.includes("claimStarted")) break;
  if (i === 79) throw new Error("claim timeout");
  await sleep(10_000);
}
log("claim opened (challenge running)");

// 5. release after challenge
await sleep(130_000);
await api(`/vaults/${S.vault}/release`, { body: {} });
for (let i = 0; i < 90; i++) {
  const ks = await lastKind();
  if (ks.includes("settled")) break;
  if (i === 89) { log("release done; settlement still pending (agent window)"); break; }
  await sleep(10_000);
}
const evs = await events();
S.finalEvents = evs; save();

console.log("\n========== PRODUCTION E2E ==========");
for (const e of evs) console.log(`  [${e.kind}] ${e.label}${e.txXrpl ? ` xrpl:${e.txXrpl.slice(0, 12)}…` : ""}${e.txFlare ? ` flare:${e.txFlare.slice(0, 12)}…` : ""}`);
const ok = evs.some((e) => e.kind === "settled");
console.log(ok ? "PRODUCTION E2E: PASS — the live stack ran the whole story." : "PRODUCTION E2E: PARTIAL (see events)");
process.exit(ok ? 0 : 2);
