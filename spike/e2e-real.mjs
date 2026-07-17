// REAL end-to-end product lifecycle on Coston2 — no mocks anywhere — resumable:
// every completed step is persisted to e2e-state.json so reruns pick up where
// the last run stopped (real testnet money is never wasted).
import { Contract, hexlify, randomBytes } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  provider, log, sleep, addrHash, agentWallet, newFundedAccount, validatedLedger,
  sendXrplPayment, proveXrpPayment, proveSilence, buildMintMemo, xrplRpc,
  VAULT_ABI, FACTORY_ABI, XRP_DATA,
} from "./fdc-lib.mjs";

const dep = JSON.parse(readFileSync(new URL("../contracts/deployments.real.json", import.meta.url), "utf8"));
const BEACON = "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN";
const HEARTBEAT_PERIOD = 240n, GRACE = 60n, CHALLENGE = 120n;
const agent = agentWallet();

const stateFile = new URL("./e2e-state.json", import.meta.url);
const S = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(S, null, 2));

// --- accounts ----------------------------------------------------------------
const acctFile = new URL("./accounts.secret.json", import.meta.url);
let accts;
if (existsSync(acctFile)) {
  const saved = JSON.parse(readFileSync(acctFile, "utf8"));
  const xrpl = (await import("xrpl")).default;
  accts = Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, { ...v, wallet: xrpl.Wallet.fromSeed(v.seed) }]));
  log(`accounts: owner=${accts.owner.address} beneficiary=${accts.beneficiary.address}`);
} else {
  accts = { owner: await newFundedAccount("owner"), beneficiary: await newFundedAccount("beneficiary") };
  writeFileSync(acctFile, JSON.stringify({
    owner: { address: accts.owner.address, seed: accts.owner.seed },
    beneficiary: { address: accts.beneficiary.address, seed: accts.beneficiary.seed },
  }, null, 2));
}

// --- 1. vault -----------------------------------------------------------------
const factory = new Contract(dep.factory, FACTORY_ABI, agent);
if (!S.vault) {
  const reference = hexlify(randomBytes(32));
  const nowL = await validatedLedger();
  const cfg = [
    addrHash(accts.owner.address), addrHash(accts.beneficiary.address), addrHash(BEACON), reference,
    HEARTBEAT_PERIOD, GRACE, CHALLENGE, BigInt(nowL.ledger), BigInt(nowL.ts), BigInt(dep.lotSizeUBA),
  ];
  const tx = await factory.createVault(cfg, 0n);
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((p) => p?.name === "VaultCreated");
  S.vault = ev.args.vault; S.reference = reference; save();
}
log(`vault: ${S.vault} (reference ${S.reference.slice(0, 14)}…)`);
const vault = new Contract(S.vault, VAULT_ABI, agent);
const fxrp = new Contract(dep.fxrp, ["function balanceOf(address) view returns (uint256)"], provider);

// --- 2. fund via ONE XRPL payment (direct mint to the vault address) ----------
if (!S.mintXrplTx) {
  const pay = await sendXrplPayment(accts.owner, dep.coreVaultXrpl, 20_160_000n, buildMintMemo(S.vault), "direct-mint payment");
  S.mintXrplTx = pay.hash; save();
}
if (!S.mintExecuted) {
  if ((await fxrp.balanceOf(S.vault)) > 0n) {
    S.mintExecuted = true; save();
  } else {
    log(`proving mint payment ${S.mintXrplTx}…`);
    const proof = await proveXrpPayment(agent, S.mintXrplTx);
    const am = new Contract(dep.assetManager, [
      `function executeDirectMinting(tuple(bytes32[] merkleProof, ${XRP_DATA} data) _payment) payable`,
    ], agent);
    const tx = await am.executeDirectMinting({ merkleProof: proof.merkleProof, data: proof.data });
    await tx.wait();
    S.mintExecuted = true; S.mintExecuteTx = tx.hash; save();
  }
}
const funded = await fxrp.balanceOf(S.vault);
log(`vault FXRP balance = ${Number(funded) / 1e6} FXRP`);
if (!S.activated) {
  if (Number(await vault.state()) === 1) await (await vault.activate()).wait();
  S.activated = true; save();
}
log("vault ACTIVE");

// --- 3. heartbeat -------------------------------------------------------------
if (!S.hbTx) {
  const hb = await sendXrplPayment(accts.owner, BEACON, 1n, S.reference.slice(2), "heartbeat");
  S.hbTx = hb.hash; S.hbLedger = hb.ledger; save();
}
if (!S.hbRecorded) {
  const proof = await proveXrpPayment(agent, S.hbTx);
  await (await vault.recordHeartbeat(proof)).wait();
  S.hbRecorded = true; save();
}
log(`heartbeat recorded → epoch=${await vault.heartbeatEpoch()} nextSilenceLedger=${await vault.nextSilenceLedger()}`);

// --- 4. silence ----------------------------------------------------------------
if (!S.silenceDone) {
  const deadlineTs = Number(await vault.silenceDeadline());
  const waitS = deadlineTs + 25 - Math.floor(Date.now() / 1000);
  if (waitS > 0) { log(`waiting out inactivity window (${waitS}s)…`); await sleep(waitS * 1000); }
  const nowL2 = await validatedLedger();
  const minLedger = Number(await vault.nextSilenceLedger());
  const silence = await proveSilence(agent, {
    beacon: BEACON, reference: S.reference, ownerAddress: accts.owner.address,
    minLedger, deadlineLedger: nowL2.ledger - 4, deadlineTs: deadlineTs + 1,
  });
  await (await vault.attestSilence(silence)).wait();
  S.silenceDone = true; S.silenceRound = silence.meta.round; save();
}
log(`silence proven through ${await vault.silenceProvenThroughTs()} (deadline ${await vault.silenceDeadline()})`);

// --- 5. claim + challenge -------------------------------------------------------
if (!S.claimed) {
  if (Number(await vault.state()) === 2) await (await vault.startClaim(accts.beneficiary.address)).wait();
  S.claimed = true; save();
}
const endsAt = Number(await vault.claimChallengeEndsAt());
log(`ClaimPending — challenge ends at ${endsAt}`);
const waitC = endsAt + 10 - Math.floor(Date.now() / 1000);
if (waitC > 0) { log(`waiting out challenge (${waitC}s)…`); await sleep(waitC * 1000); }

// --- 6. release → REAL FAssets redemption --------------------------------------
const beneBefore = await xrplRpc("account_info", { account: accts.beneficiary.address, ledger_index: "validated" });
const balBefore = BigInt(beneBefore.result.account_data.Balance);
if (!S.releaseTx) {
  const rel = await vault.executeRelease();
  await rel.wait();
  S.releaseTx = rel.hash; save();
}
log(`released (tx ${S.releaseTx}) → state=${await vault.state()} (4=Releasing, 5=Released)`);

// --- 7. watch beneficiary's XRPL account for the agent payout -------------------
log(`watching ${accts.beneficiary.address} for redemption payout…`);
let received = 0n, payoutTx = null;
for (let i = 0; i < 120; i++) {
  await sleep(15_000);
  const ai = await xrplRpc("account_info", { account: accts.beneficiary.address, ledger_index: "validated" });
  const bal = BigInt(ai.result.account_data.Balance);
  if (bal > balBefore) {
    received = bal - balBefore;
    const at = await xrplRpc("account_tx", { account: accts.beneficiary.address, limit: 5 });
    payoutTx = at.result.transactions?.find((t) => (t.tx_json ?? t.tx)?.Destination === accts.beneficiary.address);
    break;
  }
  if (i % 8 === 0) log(`…still waiting (${(i + 1) * 15}s)`);
}

S.payout = { receivedDrops: String(received), xrplTx: payoutTx ? (payoutTx.tx_json ?? payoutTx.tx)?.hash ?? payoutTx.hash : null };
S.finalState = Number(await vault.state());
save();

console.log("\n========== REAL E2E VERDICT ==========");
console.log(`vault ${S.vault}`);
console.log(`funded: ${Number(funded) / 1e6} FXRP via ONE XRPL payment (no EVM wallet)`);
console.log(`final state: ${S.finalState} (5=Released)`);
console.log(`beneficiary received: ${Number(received) / 1e6} XRP on XRPL (tx ${S.payout.xrplTx})`);
const pass = S.finalState >= 4 && received > 0n;
console.log(pass ? "REAL E2E: PASS — the whole product loop ran on real infrastructure." : "REAL E2E: PARTIAL — see e2e-state.json");
process.exit(pass ? 0 : 2);
