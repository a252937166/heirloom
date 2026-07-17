// Heirloom keeper — the permissionless crank, run as a service.
// It holds no user funds and no user keys: it can only submit proofs and cranks
// that anyone else could submit with the same public data.
//
//   POST /api/vaults                       create a vault (assisted setup)
//   POST /api/vaults/:addr/funded          prove the funding payment → mint → activate
//   POST /api/vaults/:addr/heartbeat       prove a heartbeat payment → recordHeartbeat
//   POST /api/vaults/:addr/claim           prove silence → attestSilence → startClaim
//   POST /api/vaults/:addr/release         executeRelease (+ payout watch)
//   GET  /api/vaults/:addr                 events + job status
//   GET  /api/health
import express from "express";
import cors from "cors";
import { Contract, hexlify, randomBytes } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  provider, log, sleep, addrHash, agentWallet, validatedLedger, xrplRpc,
  proveXrpPayment, proveSilence, VAULT_ABI, FACTORY_ABI, XRP_DATA, buildMintMemo,
} from "../spike/fdc-lib.mjs";

const dep = JSON.parse(readFileSync(new URL("../contracts/deployments.real.json", import.meta.url), "utf8"));
const BEACON = "r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN";
const agent = agentWallet();
const factory = new Contract(dep.factory, FACTORY_ABI, agent);
const fxrp = new Contract(dep.fxrp, ["function balanceOf(address) view returns (uint256)"], provider);
const assetManager = new Contract(dep.assetManager, [
  `function executeDirectMinting(tuple(bytes32[] merkleProof, ${XRP_DATA} data) _payment) payable`,
], agent);

// --- persistent event store ---------------------------------------------------
const storeFile = new URL("./keeper-state.json", import.meta.url);
const store = existsSync(storeFile) ? JSON.parse(readFileSync(storeFile, "utf8")) : { vaults: {} };
const persist = () => writeFileSync(storeFile, JSON.stringify(store, null, 2));
function rec(vaultAddr, kind, label, extra = {}) {
  const v = (store.vaults[vaultAddr.toLowerCase()] ??= { events: [], meta: {} });
  v.events.push({ at: Math.floor(Date.now() / 1000), kind, label, ...extra });
  persist();
  log(`[${vaultAddr.slice(0, 8)}] ${label}`);
}
const metaOf = (addr) => (store.vaults[addr.toLowerCase()] ??= { events: [], meta: {} }).meta;

const vaultAt = (addr) => new Contract(addr, VAULT_ABI, agent);

// --- background job runner (sequential per vault) -----------------------------
const jobs = new Map(); // vault → {name, startedAt} | undefined
async function runJob(vaultAddr, name, fn) {
  const key = vaultAddr.toLowerCase();
  if (jobs.get(key)) throw new Error(`busy: ${jobs.get(key).name} in progress`);
  jobs.set(key, { name, startedAt: Date.now() });
  (async () => {
    try {
      await fn();
    } catch (e) {
      rec(vaultAddr, "error", `${name} failed: ${(e.shortMessage ?? e.message ?? String(e)).slice(0, 160)}`, { tone: "warn" });
    } finally {
      jobs.delete(key);
    }
  })();
}

// --- app ----------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, factory: dep.factory, beacon: BEACON, at: Date.now() }));

app.post("/api/vaults", async (req, res) => {
  try {
    const { ownerXrpl, beneficiaryXrpl, heartbeatPeriod = 240, grace = 60, challenge = 120, lots = 2 } = req.body ?? {};
    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(ownerXrpl ?? "") || !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(beneficiaryXrpl ?? "")) {
      return res.status(400).send("ownerXrpl and beneficiaryXrpl must be valid XRPL classic addresses");
    }
    const reference = hexlify(randomBytes(32));
    const nowL = await validatedLedger();
    const cfg = [
      addrHash(ownerXrpl), addrHash(beneficiaryXrpl), addrHash(BEACON), reference,
      BigInt(heartbeatPeriod), BigInt(grace), BigInt(challenge),
      BigInt(nowL.ledger), BigInt(nowL.ts), BigInt(dep.lotSizeUBA),
    ];
    const tx = await factory.createVault(cfg, 0n);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((p) => p?.name === "VaultCreated");
    const vault = ev.args.vault;
    const meta = metaOf(vault);
    Object.assign(meta, { ownerXrpl, beneficiaryXrpl, reference, createdTx: tx.hash });
    // gross: net = lots*10 XRP; fee 0.25% + 0.1 executor + margin 0.15
    const net = lots * 10;
    const gross = Math.ceil((net + 0.1 + 0.15) / 0.9975 * 1e6);
    rec(vault, "created", `Vault created for ${ownerXrpl.slice(0, 8)}… → ${beneficiaryXrpl.slice(0, 8)}…`, { txFlare: tx.hash, tone: "gold" });
    res.json({ vault, reference, fundingMemo: buildMintMemo(vault), coreVaultXrpl: dep.coreVaultXrpl, grossDrops: String(gross) });
  } catch (e) {
    res.status(500).send(e.shortMessage ?? e.message);
  }
});

app.post("/api/vaults/:addr/funded", async (req, res) => {
  const { addr } = req.params;
  const { xrplTx } = req.body ?? {};
  if (!xrplTx) return res.status(400).send("xrplTx required");
  try {
    await runJob(addr, "funding", async () => {
      rec(addr, "funding", "Funding payment seen — proving it to Flare (FDC XRPPayment)", { txXrpl: xrplTx });
      // an official executor may beat us to executeDirectMinting — balance is the truth
      let bal = await fxrp.balanceOf(addr);
      if (bal === 0n) {
        try {
          const proof = await proveXrpPayment(agent, xrplTx);
          bal = await fxrp.balanceOf(addr);
          if (bal === 0n) {
            const tx = await assetManager.executeDirectMinting({ merkleProof: proof.merkleProof, data: proof.data });
            await tx.wait();
            bal = await fxrp.balanceOf(addr);
            rec(addr, "minted", `FXRP minted into the vault: ${Number(bal) / 1e6} FXRP`, { txFlare: tx.hash, round: proof.meta.round, tone: "ok" });
          }
        } catch (e) {
          bal = await fxrp.balanceOf(addr);
          if (bal === 0n) throw e; // real failure — surface it
        }
      }
      if (bal > 0n && !(store.vaults[addr.toLowerCase()]?.events ?? []).some((ev) => ev.kind === "minted")) {
        rec(addr, "minted", `FXRP minted into the vault: ${Number(bal) / 1e6} FXRP (executed by a network executor)`, { tone: "ok" });
      }
      const v = vaultAt(addr);
      if (Number(await v.state()) === 1) {
        const atx = await v.activate();
        await atx.wait();
        rec(addr, "active", "Vault is ACTIVE — the dial is live", { txFlare: atx.hash, tone: "ok" });
      }
    });
    res.json({ ok: true, job: "funding" });
  } catch (e) {
    res.status(409).send(e.message);
  }
});

app.post("/api/vaults/:addr/heartbeat", async (req, res) => {
  const { addr } = req.params;
  const { xrplTx } = req.body ?? {};
  if (!xrplTx) return res.status(400).send("xrplTx required");
  try {
    await runJob(addr, "heartbeat", async () => {
      rec(addr, "heartbeat", "Heartbeat seen on XRPL — proving it (FDC XRPPayment)", { txXrpl: xrplTx });
      const proof = await proveXrpPayment(agent, xrplTx);
      const v = vaultAt(addr);
      const tx = await v.recordHeartbeat(proof);
      await tx.wait();
      const wasClaim = false;
      rec(addr, "alive", `Heartbeat proven — epoch ${await v.heartbeatEpoch()}, dial reset${wasClaim ? " (claim vetoed)" : ""}`, { txFlare: tx.hash, round: proof.meta.round, tone: "ok" });
    });
    res.json({ ok: true, job: "heartbeat" });
  } catch (e) {
    res.status(409).send(e.message);
  }
});

app.post("/api/vaults/:addr/claim", async (req, res) => {
  const { addr } = req.params;
  const { beneficiaryXrpl } = req.body ?? {};
  if (!beneficiaryXrpl) return res.status(400).send("beneficiaryXrpl required");
  try {
    const v = vaultAt(addr);
    const meta = metaOf(addr);
    const ownerXrpl = meta.ownerXrpl;
    if (!ownerXrpl) return res.status(400).send("keeper does not know this vault's owner address");
    await runJob(addr, "claim", async () => {
      const deadline = Number(await v.silenceDeadline());
      const proven = Number(await v.silenceProvenThroughTs());
      if (proven < deadline) {
        rec(addr, "claim", "Claim requested — asking Flare's network to attest the silence", { tone: "warn" });
        const nowL = await validatedLedger();
        const minLedger = Number(await v.nextSilenceLedger());
        const cfg = await v.config();
        const proof = await proveSilence(agent, {
          beacon: BEACON, reference: cfg.heartbeatReference, ownerAddress: ownerXrpl,
          minLedger, deadlineLedger: nowL.ledger - 4, deadlineTs: deadline + 1,
        });
        const stx = await v.attestSilence(proof);
        await stx.wait();
        rec(addr, "silence", `Silence attested through ${new Date(Number(await v.silenceProvenThroughTs()) * 1000).toLocaleTimeString()}`, { txFlare: stx.hash, round: proof.meta.round, tone: "warn" });
      }
      const ctx = await v.startClaim(beneficiaryXrpl);
      await ctx.wait();
      rec(addr, "claimStarted", "Claim opened — challenge window running; one owner heartbeat cancels it", { txFlare: ctx.hash, tone: "warn" });
    });
    res.json({ ok: true, job: "claim" });
  } catch (e) {
    res.status(409).send(e.shortMessage ?? e.message);
  }
});

app.post("/api/vaults/:addr/release", async (req, res) => {
  const { addr } = req.params;
  try {
    await runJob(addr, "release", async () => {
      const v = vaultAt(addr);
      const meta = metaOf(addr);
      const beneficiary = meta.beneficiaryXrpl ?? (await v.beneficiaryXrpl());
      const before = beneficiary ? BigInt((await xrplRpc("account_info", { account: beneficiary, ledger_index: "validated" })).result?.account_data?.Balance ?? 0) : 0n;
      const tx = await v.executeRelease();
      await tx.wait();
      rec(addr, "released", "Release executed — FAssets redemption started to the beneficiary's XRPL wallet", { txFlare: tx.hash, tone: "gold" });
      if (!beneficiary) return;
      for (let i = 0; i < 80; i++) {
        await sleep(15_000);
        const ai = await xrplRpc("account_info", { account: beneficiary, ledger_index: "validated" });
        const bal = BigInt(ai.result?.account_data?.Balance ?? 0);
        if (bal > before) {
          const at = await xrplRpc("account_tx", { account: beneficiary, limit: 5 });
          const ptx = at.result.transactions?.find((t) => (t.tx_json ?? t.tx)?.Destination === beneficiary);
          rec(addr, "settled", `Beneficiary received ${(Number(bal - before) / 1e6).toFixed(2)} XRP on their own wallet`, {
            txXrpl: ptx ? (ptx.tx_json ?? ptx.tx)?.hash ?? ptx.hash : undefined, tone: "ok",
          });
          return;
        }
      }
      rec(addr, "settling", "Redemption still settling on XRPL (agent payment window)", { tone: "warn" });
    });
    res.json({ ok: true, job: "release" });
  } catch (e) {
    res.status(409).send(e.shortMessage ?? e.message);
  }
});

app.get("/api/vaults/:addr", (req, res) => {
  const v = store.vaults[req.params.addr.toLowerCase()] ?? { events: [], meta: {} };
  const job = jobs.get(req.params.addr.toLowerCase());
  res.json({ events: v.events, job: job ? { name: job.name, startedAt: job.startedAt } : null });
});

// --- beacon auto-scan: detect heartbeats for known vaults without any POST ----
async function beaconScan() {
  try {
    const at = await xrplRpc("account_tx", { account: BEACON, limit: 20 });
    for (const t of at.result?.transactions ?? []) {
      const tx = t.tx_json ?? t.tx;
      if (!tx || tx.TransactionType !== "Payment") continue;
      const memo = tx.Memos?.[0]?.Memo?.MemoData?.toLowerCase();
      if (!memo || memo.length !== 64) continue;
      const ref = "0x" + memo;
      const vaultAddr = await factory.vaultByReference(ref);
      if (!vaultAddr || vaultAddr === "0x0000000000000000000000000000000000000000") continue;
      const key = vaultAddr.toLowerCase();
      const seen = ((store.vaults[key] ??= { events: [], meta: {} }).meta.seenHb ??= []);
      const hash = tx.hash ?? t.hash;
      if (seen.includes(hash)) continue;
      const vstate = Number(await vaultAt(vaultAddr).state());
      if (vstate >= 4 || vstate === 0) { seen.push(hash); persist(); continue; } // finalized vaults ignore heartbeats
      seen.push(hash);
      persist();
      if (!jobs.get(key)) {
        runJob(vaultAddr, "heartbeat-auto", async () => {
          rec(vaultAddr, "heartbeat", "Heartbeat detected on the beacon — proving it", { txXrpl: hash });
          const proof = await proveXrpPayment(agent, hash);
          const v = vaultAt(vaultAddr);
          const tx2 = await v.recordHeartbeat(proof);
          await tx2.wait();
          rec(vaultAddr, "alive", `Heartbeat proven — epoch ${await v.heartbeatEpoch()}, dial reset`, { txFlare: tx2.hash, round: proof.meta.round, tone: "ok" });
        }).catch(() => {});
      }
    }
  } catch (e) {
    log(`beaconScan: ${e.message?.slice(0, 80)}`);
  }
}
setInterval(beaconScan, 30_000);

const PORT = process.env.PORT ?? 8787;
app.listen(PORT, () => log(`heirloom keeper listening on :${PORT} (factory ${dep.factory})`));
