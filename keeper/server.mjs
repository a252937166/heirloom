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
import { Contract, Interface, hexlify, keccak256, concat, toUtf8Bytes, randomBytes } from "ethers";
import { readFileSync, writeFileSync, existsSync, renameSync, appendFileSync } from "node:fs";
import {
  provider, log, sleep, addrHash, agentWallet, validatedLedger, xrplRpc,
  proveXrpPayment, proveSilence, proveNonPayment, VAULT_ABI, FACTORY_ABI, XRP_DATA, buildMintMemo, DIRECT_MINT_PREFIX, vaultConfig,
} from "../spike/fdc-lib.mjs";

const AM_EVENTS = new Interface([
  "event RedemptionRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, string paymentAddress, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei)",
]);
const cancelRefOf = (heartbeatReference) =>
  keccak256(concat([toUtf8Bytes("HEIRLOOM/CANCEL"), heartbeatReference]));

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
const journalFile = new URL("./keeper-journal.ndjson", import.meta.url);
function loadStore() {
  try {
    if (existsSync(storeFile)) return JSON.parse(readFileSync(storeFile, "utf8"));
  } catch (e) {
    // corrupted state (e.g. crash mid-write): rebuild from the append-only journal
    log(`state file corrupt (${e.message}) — rebuilding from journal`);
    const s = { vaults: {} };
    if (existsSync(journalFile)) {
      for (const line of readFileSync(journalFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          const v = (s.vaults[j.vault] ??= { events: [], meta: {} });
          if (j.type === "event") v.events.push(j.event);
          else if (j.type === "meta") Object.assign(v.meta, j.meta);
        } catch { /* skip torn line */ }
      }
    }
    return s;
  }
  return { vaults: {} };
}
const store = loadStore();
const persist = () => {
  // atomic: a crash can never leave a half-written state file behind
  const tmp = new URL("./keeper-state.json.tmp", import.meta.url);
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, storeFile);
};
const journal = (obj) => { try { appendFileSync(journalFile, JSON.stringify(obj) + "\n"); } catch { /* best-effort */ } };
function rec(vaultAddr, kind, label, extra = {}) {
  const v = (store.vaults[vaultAddr.toLowerCase()] ??= { events: [], meta: {} });
  const event = { at: Math.floor(Date.now() / 1000), kind, label, ...extra };
  v.events.push(event);
  journal({ type: "event", vault: vaultAddr.toLowerCase(), event });
  persist();
  log(`[${vaultAddr.slice(0, 8)}] ${label}`);
}
const metaOf = (addr) => (store.vaults[addr.toLowerCase()] ??= { events: [], meta: {} }).meta;

const vaultAt = (addr) => new Contract(addr, VAULT_ABI, agent);
const jsonSafe = (x) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

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
app.use(express.json({ limit: "16kb" }));

// the keeper pays gas for sponsored creates — cap the burn rate
const createHits = new Map(); // ip → timestamps
let createsToday = { day: "", n: 0 };
function createAllowed(ip) {
  const now = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  if (createsToday.day !== day) createsToday = { day, n: 0 };
  if (createsToday.n >= 60) return "daily sponsored-create quota reached — try tomorrow or run your own keeper (open source)";
  const hits = (createHits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= 6) return "rate limit: 6 sponsored creates per hour per IP";
  hits.push(now);
  createHits.set(ip, hits);
  createsToday.n += 1;
  return null;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, factory: dep.factory, beacon: BEACON, at: Date.now() }));

// direct-mint quote: exact drops + payment address, refreshed at pay time.
// Best-effort dynamic address (newer AssetManagers expose it); falls back to
// the deployment's core vault. Quotes expire — never pay from a stale one.
app.get("/api/direct-mint/quote", async (req, res) => {
  try {
    const lots = Math.max(1, Math.min(10, Number(req.query.lots ?? 2)));
    const net = lots * (Number(dep.lotSizeUBA) / 1e6);
    const grossDrops = Math.ceil((net + 0.1 + 0.15) / 0.9975 * 1e6);
    let paymentAddress = dep.coreVaultXrpl;
    try {
      const dyn = new Contract(dep.assetManager, ["function getDirectMintingPaymentAddress() view returns (string)"], provider);
      const a = await dyn.getDirectMintingPaymentAddress();
      if (a && a.startsWith("r")) paymentAddress = a;
    } catch { /* older AssetManager — deployment address is authoritative */ }
    res.json({
      quoteId: hexlify(randomBytes(8)),
      lots,
      netMintUBA: String(lots * Number(dep.lotSizeUBA)),
      exactPaymentDrops: String(grossDrops),
      paymentAddress,
      feeNote: "includes the FAssets minting fee (0.25%) + executor fee + safety margin",
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    });
  } catch (e) {
    res.status(500).send(e.shortMessage ?? e.message);
  }
});

app.post("/api/vaults", async (req, res) => {
  try {
    const limited = createAllowed(req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? req.ip ?? "?");
    if (limited) return res.status(429).send(limited);
    const { ownerXrpl, ownerEvm, beneficiaryXrpl, heartbeatPeriod = 240, grace = 60, challenge = 120, lots = 2 } = req.body ?? {};
    // proof grace: FDC rounds take 90-180s — a pre-cutoff heartbeat must never
    // lose a race against the release crank. EVM check-ins have no latency.
    const evmModeEarly = /^0x[0-9a-fA-F]{40}$/.test(ownerEvm ?? "");
    const vetoProofGrace = Number(req.body?.vetoProofGrace ?? (evmModeEarly ? 0 : 180));
    const evmMode = /^0x[0-9a-fA-F]{40}$/.test(ownerEvm ?? "");
    if (!evmMode && !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(ownerXrpl ?? "")) {
      return res.status(400).send("provide ownerXrpl (XRPL mode) or ownerEvm (MetaMask/OKX mode)");
    }
    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(beneficiaryXrpl ?? "")) {
      return res.status(400).send("beneficiaryXrpl must be a valid XRPL classic address");
    }
    const reference = hexlify(randomBytes(32));
    const nowL = await validatedLedger();
    const ZERO32 = "0x" + "00".repeat(32);
    const cfg = [
      evmMode ? ZERO32 : addrHash(ownerXrpl), addrHash(beneficiaryXrpl), addrHash(BEACON), reference,
      BigInt(heartbeatPeriod), BigInt(grace), BigInt(challenge), BigInt(vetoProofGrace),
      BigInt(nowL.ledger), BigInt(nowL.ts), BigInt(dep.lotSizeUBA),
      evmMode ? ownerEvm : "0x0000000000000000000000000000000000000000",
    ];
    const tx = await factory.createVault(cfg, 0n);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((p) => p?.name === "VaultCreated");
    const vault = ev.args.vault;
    const meta = metaOf(vault);
    Object.assign(meta, { ownerXrpl: evmMode ? null : ownerXrpl, ownerEvm: evmMode ? ownerEvm : null, mode: evmMode ? "evm" : "xrpl", beneficiaryXrpl, reference, createdTx: tx.hash });
    // gross: net = lots*10 XRP; fee 0.25% + 0.1 executor + margin 0.15
    const net = lots * 10;
    const gross = Math.ceil((net + 0.1 + 0.15) / 0.9975 * 1e6);
    rec(vault, "created", `Vault created for ${(evmMode ? ownerEvm : ownerXrpl).slice(0, 8)}… → ${beneficiaryXrpl.slice(0, 8)}… (${evmMode ? "MetaMask/OKX owner" : "XRPL owner"})`, { txFlare: tx.hash, tone: "gold" });
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
            if (bal === 0n) {
              // the protocol accepted the proof but deferred the mint (rate
              // limits / large-mint delay). The SAME proof retries later —
              // the user must never pay twice.
              const meta2 = metaOf(addr);
              meta2.pendingMint = { proof: jsonSafe({ merkleProof: proof.merkleProof, data: proof.data }), tries: 0, at: Date.now() };
              persist();
              rec(addr, "mintPending", "Payment received by the protocol — minting is deferred by FAssets limits. The keeper retries with the same proof; no second payment is needed.", { txFlare: tx.hash, round: proof.meta.round, tone: "warn" });
              return;
            }
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
  const { xrplTx, evmTx } = req.body ?? {};
  if (!xrplTx && !evmTx) return res.status(400).send("xrplTx or evmTx required");
  try {
    if (evmTx) {
      // EVM-owner check-in: the owner already sent the transaction — verify
      // against chain truth, then mirror it into the journey.
      const v = vaultAt(addr);
      const [ts, epoch] = await Promise.all([v.lastHeartbeatTs(), v.heartbeatEpoch()]);
      if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return res.status(400).send("no recent check-in on-chain");
      rec(addr, "alive", `Check-in recorded on Flare — epoch ${epoch}, dial reset (one-click owner transaction)`, { txFlare: evmTx, tone: "ok" });
      return res.json({ ok: true, job: "none" });
    }
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
  const { beneficiaryXrpl, ownerXrpl: ownerFromBody } = req.body ?? {};
  if (!beneficiaryXrpl) return res.status(400).send("beneficiaryXrpl required");
  try {
    const v = vaultAt(addr);
    const meta = metaOf(addr);
    const vcfg = await vaultConfig(v);
    const isEvmVault = vcfg.ownerEvm !== "0x0000000000000000000000000000000000000000";
    let ownerXrpl = null;
    if (!isEvmVault) {
      // the Recovery Kit carries the owner address so a claim never depends on
      // this keeper's private state
      ownerXrpl = meta.ownerXrpl ?? ownerFromBody;
      if (!ownerXrpl) {
        return res.status(400).send("ownerXrpl required (printed on the Recovery Kit) — this keeper has no record of it");
      }
      if (addrHash(ownerXrpl) !== vcfg.ownerXrplHash) {
        return res.status(400).send("ownerXrpl does not match this vault's owner hash");
      }
      if (!meta.ownerXrpl) { meta.ownerXrpl = ownerXrpl; persist(); }
    }
    await runJob(addr, "claim", async () => {
      const deadline = Number(await v.silenceDeadline());
      const proven = Number(await v.silenceProvenThroughTs());
      if (isEvmVault) {
        // EVM mode: consensus time is the silence oracle — no attestation needed
        rec(addr, "claim", "Claim requested — silence measured by Flare consensus time (EVM-owner plan)", { tone: "warn" });
      } else if (proven < deadline) {
        rec(addr, "claim", "Claim requested — asking Flare's network to attest the silence", { tone: "warn" });
        const nowL = await validatedLedger();
        const minLedger = Number(await v.nextSilenceLedger());
        const cfg = await vaultConfig(v);
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
      const tx = await v.executeRelease();
      const rc = await tx.wait();
      // bind the payout to the ACTUAL redemption request, not a balance change
      const reqs = [];
      for (const lg of rc.logs) {
        try {
          const p = AM_EVENTS.parseLog(lg);
          if (p?.name === "RedemptionRequested") {
            reqs.push({
              requestId: String(p.args.requestId),
              paymentReference: p.args.paymentReference.toLowerCase(),
              valueUBA: String(p.args.valueUBA),
              feeUBA: String(p.args.feeUBA),
              agentVault: p.args.agentVault,
              paymentAddress: p.args.paymentAddress,
              firstUnderlyingBlock: String(p.args.firstUnderlyingBlock),
              lastUnderlyingBlock: String(p.args.lastUnderlyingBlock),
              lastUnderlyingTimestamp: String(p.args.lastUnderlyingTimestamp),
            });
          }
        } catch {}
      }
      meta.redemptions = reqs;
      persist();
      rec(addr, "released",
        `Release executed — redemption request${reqs.length > 1 ? "s" : ""} ${reqs.map((r) => "#" + r.requestId).join(", ")} for ${reqs.reduce((s, r) => s + Number(r.valueUBA), 0) / 1e6} FXRP`,
        { txFlare: tx.hash, tone: "gold" });
      if (!beneficiary || reqs.length === 0) return;
      const wanted = new Set(reqs.map((r) => r.paymentReference));
      for (let i = 0; i < 80 && wanted.size; i++) {
        await sleep(15_000);
        const at = await xrplRpc("account_tx", { account: beneficiary, limit: 15 });
        for (const t of at.result?.transactions ?? []) {
          const txj = t.tx_json ?? t.tx;
          if (!txj || txj.Destination !== beneficiary) continue;
          const memo = txj.Memos?.[0]?.Memo?.MemoData?.toLowerCase();
          if (!memo) continue;
          const ref = "0x" + memo;
          if (wanted.has(ref)) {
            wanted.delete(ref);
            const r = reqs.find((x) => x.paymentReference === ref);
            const delivered = (t.meta ?? t.metaData)?.delivered_amount ?? txj.Amount;
            (meta.settlements ??= []).push({ requestId: r.requestId, deliveredDrops: String(delivered), txXrpl: txj.hash ?? t.hash, paymentReference: ref });
            persist();
            rec(addr, "settled",
              `Redemption #${r.requestId} settled: ${(Number(delivered) / 1e6).toFixed(2)} XRP delivered with payment reference ${ref.slice(0, 14)}…`,
              { txXrpl: txj.hash ?? t.hash, tone: "ok" });
          }
        }
      }
      if (wanted.size) {
        rec(addr, "settling", "Redemption payment(s) still inside the agent window — tracking by payment reference; if the agent misses the underlying deadline, the FAssets default path (collateral compensation) becomes available", { tone: "warn" });
        meta.awaitingSettlement = [...wanted];
        persist();
      }
      const residual = Number(await fxrp.balanceOf(addr)) / 1e6;
      if (residual > 0) rec(addr, "residual", `Residual ${residual} FXRP remains (below the protocol redemption minimum)`, { tone: "warn" });
    });
    res.json({ ok: true, job: "release" });
  } catch (e) {
    res.status(409).send(e.shortMessage ?? e.message);
  }
});

const VAULT_ERRORS = new Interface([
  "error SilenceNotProven()", "error BadState(uint8 s)", "error ChallengeNotOver()",
  "error NotBeneficiary()", "error BadProof()", "error StaleProof()",
]);
// P0: the early-claim drill must report chain truth — a staticCall against
// startClaim returns exactly why (or whether) the contract refuses. Nothing
// is ever executed by this endpoint.
app.post("/api/vaults/:addr/simulate-early-claim", async (req, res) => {
  const { beneficiaryXrpl } = req.body ?? {};
  if (!beneficiaryXrpl) return res.status(400).send("beneficiaryXrpl required");
  try {
    const v = vaultAt(req.params.addr);
    const [state, deadline] = await Promise.all([v.state(), v.silenceDeadline()]);
    const now = Math.floor(Date.now() / 1000);
    try {
      await v.startClaim.staticCall(beneficiaryXrpl);
      rec(req.params.addr, "drill", "Early-claim drill: the inactivity window has elapsed — a real claim could start now (nothing was executed)", { tone: "warn" });
      return res.json({ blocked: false, stage: "window-open", reason: "SILENCE_WINDOW_ELAPSED", fundsMoved: "0" });
    } catch (e) {
      let reason = null;
      const data = e.data ?? e.info?.error?.data;
      try { reason = VAULT_ERRORS.parseError(data)?.name ?? null; } catch { /* unknown selector */ }
      if (!reason) {
        const m = String(e.shortMessage ?? e.message);
        reason = /SilenceNotProven|ChallengeNotOver|BadState|NotBeneficiary/.exec(m)?.[0] ?? "REVERTED";
      }
      rec(req.params.addr, "drill", `Early-claim drill: blocked on-chain (${reason}) — funds moved: 0`, { tone: "ok" });
      return res.json({
        blocked: true,
        stage: Number(state) === 3 ? "challenge" : "silence-proof",
        reason,
        detail: reason === "SilenceNotProven"
          ? (now <= Number(deadline)
              ? "the owner is inside their window — the FDC verifier would answer REFERENCED TRANSACTION EXISTS; the proof cannot even be built"
              : "no silence attestation has been submitted for this window yet")
          : undefined,
        fundsMoved: "0",
      });
    }
  } catch (e) {
    res.status(500).send(e.shortMessage ?? e.message);
  }
});

// Redemption default: if the agent misses the underlying payment window, a
// non-payment proof lets the redeemer (this vault) claim collateral
// compensation via the FAssets protocol. Compensation lands on the redeemer
// (the vault contract) as Flare-side collateral — disclosed honestly.
const RPN_DATA = "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, tuple(uint32 minimalBlockNumber, uint32 deadlineBlockNumber, uint64 deadlineTimestamp, bytes32 destinationAddressHash, uint256 amount, bytes32 standardPaymentReference, bool checkSourceAddresses, bytes32 sourceAddressesRoot) requestBody, tuple(uint64 minimalBlockTimestamp, uint32 firstOverflowBlockNumber, uint64 firstOverflowBlockTimestamp) responseBody) data";
const amDefault = new Contract(dep.assetManager, [
  `function redemptionPaymentDefault(tuple(bytes32[] merkleProof, ${RPN_DATA}) _proof, uint256 _redemptionRequestId)`,
], agent);

async function tryRedemptionDefault(addr, r) {
  const nowL = await validatedLedger();
  if (nowL.ledger <= Number(r.lastUnderlyingBlock) + 4 || nowL.ts <= Number(r.lastUnderlyingTimestamp) + 15) {
    return { eligible: false, reason: "agent window still open" };
  }
  rec(addr, "defaulting", `Agent missed the underlying window for redemption #${r.requestId} — proving non-payment to claim protocol collateral`, { tone: "warn" });
  const amountDrops = BigInt(r.valueUBA) - BigInt(r.feeUBA);
  const proof = await proveNonPayment(agent, {
    redeemerXrpl: r.paymentAddress,
    amountDrops: String(amountDrops),
    paymentReference: r.paymentReference,
    firstBlock: r.firstUnderlyingBlock,
    lastBlock: r.lastUnderlyingBlock,
    lastTimestamp: r.lastUnderlyingTimestamp,
  });
  const tx = await amDefault.redemptionPaymentDefault({ merkleProof: proof.merkleProof, data: proof.data }, BigInt(r.requestId));
  await tx.wait();
  rec(addr, "defaulted", `Redemption #${r.requestId} defaulted — protocol collateral compensation secured to the vault (Flare-side assets; distribution to the XRPL beneficiary is roadmap)`, { txFlare: tx.hash, round: proof.meta.round, tone: "gold" });
  return { eligible: true, txFlare: tx.hash };
}

app.post("/api/vaults/:addr/redemption-default", async (req, res) => {
  const { addr } = req.params;
  try {
    const meta = metaOf(addr);
    const pending = (meta.redemptions ?? []).filter((r) => (meta.awaitingSettlement ?? []).includes(r.paymentReference));
    if (!pending.length) return res.status(400).send("no unsettled redemption on record for this vault");
    await runJob(addr, "redemption-default", async () => {
      for (const r of pending) {
        const out = await tryRedemptionDefault(addr, r);
        if (out.eligible) {
          meta.awaitingSettlement = (meta.awaitingSettlement ?? []).filter((x) => x !== r.paymentReference);
          persist();
        } else {
          rec(addr, "settling", `Redemption #${r.requestId}: ${out.reason} — default not yet available`, { tone: "warn" });
        }
      }
    });
    res.json({ ok: true, job: "redemption-default" });
  } catch (e) {
    res.status(409).send(e.shortMessage ?? e.message);
  }
});

// cancel: returns the exact XRPL payment the owner signs; detection is automatic
app.post("/api/vaults/:addr/cancel-intent", async (req, res) => {
  try {
    const v = vaultAt(req.params.addr);
    const cfg = await vaultConfig(v);
    res.json({
      beacon: BEACON,
      amountDrops: "1",
      memoHex: cancelRefOf(cfg.heartbeatReference).slice(2),
      note: "Send 1 drop to the beacon with this memo from the owner wallet; the keeper proves it and the vault redeems everything back to you.",
    });
  } catch (e) {
    res.status(500).send(e.shortMessage ?? e.message);
  }
});

app.get("/api/vaults/:addr", (req, res) => {
  const v = store.vaults[req.params.addr.toLowerCase()] ?? { events: [], meta: {} };
  const job = jobs.get(req.params.addr.toLowerCase());
  // public recovery data: enough for anyone to rebuild every proof without this
  // keeper (the owner's address is public on XRPL after the first heartbeat)
  const { ownerXrpl, ownerEvm, mode, beneficiaryXrpl, reference } = v.meta ?? {};
  res.json({
    events: v.events,
    job: job ? { name: job.name, startedAt: job.startedAt } : null,
    recovery: { ownerXrpl: ownerXrpl ?? null, ownerEvm: ownerEvm ?? null, mode: mode ?? (ownerEvm ? "evm" : "xrpl"), beneficiaryXrpl: beneficiaryXrpl ?? null, reference: reference ?? null, beacon: BEACON },
    receipt: { redemptions: v.meta?.redemptions ?? [], settlements: v.meta?.settlements ?? [] },
  });
});

// plans lookup for EVM owners (the factory indexes by XRPL owner hash only)
app.get("/api/plans/of/:owner", (req, res) => {
  const q = req.params.owner.toLowerCase();
  const out = [];
  for (const [k, sv] of Object.entries(store.vaults)) {
    const m = sv.meta ?? {};
    if ((m.ownerEvm && m.ownerEvm.toLowerCase() === q) || (m.ownerXrpl && m.ownerXrpl.toLowerCase() === q)) out.push(k);
  }
  res.json({ vaults: out });
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
      let vaultAddr = await factory.vaultByReference(ref);
      let isCancel = false;
      if (!vaultAddr || vaultAddr === "0x0000000000000000000000000000000000000000") {
        // not a heartbeat — maybe a cancel command (keccak("HEIRLOOM/CANCEL"‖ref))
        for (const [k, sv] of Object.entries(store.vaults)) {
          const r = sv.meta?.reference;
          if (r && cancelRefOf(r).toLowerCase() === ref) { vaultAddr = sv.meta.vaultAddr ?? k; isCancel = true; break; }
        }
      }
      if (!vaultAddr || vaultAddr === "0x0000000000000000000000000000000000000000") continue;
      if (isCancel) {
        const key2 = vaultAddr.toLowerCase();
        if (store.vaults[key2]?.meta?.mode === "evm") continue;
        const seen2 = ((store.vaults[key2] ??= { events: [], meta: {} }).meta.seenHb ??= []);
        const hash2 = tx.hash ?? t.hash;
        if (seen2.includes(hash2)) continue;
        seen2.push(hash2); persist();
        if (!jobs.get(key2)) {
          runJob(vaultAddr, "cancel", async () => {
            rec(vaultAddr, "cancelSeen", "Cancel command detected on the beacon — proving it", { txXrpl: hash2, tone: "warn" });
            const proof = await proveXrpPayment(agent, hash2);
            const v = vaultAt(vaultAddr);
            const ownerXrpl = store.vaults[key2]?.meta?.ownerXrpl;
            if (!ownerXrpl) throw new Error("owner address unknown; cancel via Recovery Kit data");
            const ctx = await v.cancel(ownerXrpl, proof);
            await ctx.wait();
            rec(vaultAddr, "cancelled", "Plan cancelled — the vault is redeeming everything back to the owner's XRPL wallet", { txFlare: ctx.hash, tone: "gold" });
          }).catch(() => {});
        }
        continue;
      }
      const key = vaultAddr.toLowerCase();
      if (store.vaults[key]?.meta?.mode === "evm") continue;
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
          const v = vaultAt(vaultAddr);
          const epochBefore = Number(await v.heartbeatEpoch());
          const proof = await proveXrpPayment(agent, hash);
          try {
            const tx2 = await v.recordHeartbeat(proof);
            await tx2.wait();
            rec(vaultAddr, "alive", `Heartbeat proven — epoch ${await v.heartbeatEpoch()}, dial reset`, { txFlare: tx2.hash, round: proof.meta.round, tone: "ok" });
          } catch (e) {
            // another crank (anyone may submit) can land the same proof first
            if (Number(await v.heartbeatEpoch()) > epochBefore) {
              rec(vaultAddr, "alive", `Heartbeat proven — epoch ${await v.heartbeatEpoch()} (recorded by another crank), dial reset`, { round: proof.meta.round, tone: "ok" });
            } else {
              throw e;
            }
          }
        }).catch(() => {});
      }
    }
  } catch (e) {
    log(`beaconScan: ${e.message?.slice(0, 80)}`);
  }
}
setInterval(beaconScan, 30_000);

// --- core-vault funding scan: manual payers need no tx-hash paperwork --------
async function fundingScan() {
  try {
    const at = await xrplRpc("account_tx", { account: dep.coreVaultXrpl, limit: 25 });
    for (const t of at.result?.transactions ?? []) {
      const tx = t.tx_json ?? t.tx;
      if (!tx || tx.TransactionType !== "Payment" || tx.Destination !== dep.coreVaultXrpl) continue;
      const memo = tx.Memos?.[0]?.Memo?.MemoData?.toLowerCase();
      if (!memo || !memo.startsWith(DIRECT_MINT_PREFIX.toLowerCase())) continue;
      const recipient = "0x" + memo.slice(DIRECT_MINT_PREFIX.length + 8);
      const key = recipient.toLowerCase();
      const known = store.vaults[key];
      if (!known) continue; // not one of our vaults
      const hash = tx.hash ?? t.hash;
      // self-healing: a timed-out proof must NOT strand the vault — retry with
      // a cooldown until the vault leaves PendingFunding (success ends it)
      const attempts = (known.meta.fundAttempts ??= {});
      const a = attempts[hash] ?? { n: 0, at: 0 };
      if (a.n >= 5 || Date.now() - a.at < 60_000) continue;
      const v = vaultAt(recipient);
      if (Number(await v.state()) !== 1) continue; // only PendingFunding vaults
      if (!jobs.get(key)) {
        attempts[hash] = { n: a.n + 1, at: Date.now() }; persist();
        runJob(recipient, "funding-auto", async () => {
          rec(recipient, "funding", `Funding payment detected on the core vault — proving it to Flare (FDC XRPPayment)${a.n ? ` · retry ${a.n + 1}/5` : ""}`, { txXrpl: hash });
          let bal = await fxrp.balanceOf(recipient);
          if (bal === 0n) {
            try {
              const proof = await proveXrpPayment(agent, hash);
              bal = await fxrp.balanceOf(recipient);
              if (bal === 0n) {
                const mtx = await assetManager.executeDirectMinting({ merkleProof: proof.merkleProof, data: proof.data });
                await mtx.wait();
                bal = await fxrp.balanceOf(recipient);
                rec(recipient, "minted", `FXRP minted into the vault: ${Number(bal) / 1e6} FXRP`, { txFlare: mtx.hash, round: proof.meta.round, tone: "ok" });
              }
            } catch (e) {
              bal = await fxrp.balanceOf(recipient);
              if (bal === 0n) throw e;
            }
          }
          if (bal > 0n && !(store.vaults[key]?.events ?? []).some((ev) => ev.kind === "minted")) {
            rec(recipient, "minted", `FXRP minted into the vault: ${Number(bal) / 1e6} FXRP (executed by a network executor)`, { tone: "ok" });
          }
          if (Number(await v.state()) === 1) {
            const atx = await v.activate();
            await atx.wait();
            rec(recipient, "active", "Vault is ACTIVE — the dial is live", { txFlare: atx.hash, tone: "ok" });
          }
        }).catch(() => {});
      }
    }
  } catch (e) {
    log(`fundingScan: ${e.message?.slice(0, 80)}`);
  }
}
async function pendingScan() {
  for (const [key, sv] of Object.entries(store.vaults)) {
    // (a) deferred direct mints: retry the SAME proof until FXRP lands
    const pm = sv.meta?.pendingMint;
    if (pm && !jobs.get(key) && Date.now() - pm.at > 90_000 && pm.tries < 20) {
      pm.tries += 1; pm.at = Date.now(); persist();
      runJob(key, "mint-retry", async () => {
        let bal = await fxrp.balanceOf(key);
        if (bal === 0n) {
          try {
            const tx = await assetManager.executeDirectMinting(pm.proof);
            await tx.wait();
          } catch { /* still deferred or already executed elsewhere */ }
          bal = await fxrp.balanceOf(key);
        }
        if (bal > 0n) {
          delete sv.meta.pendingMint; persist();
          rec(key, "minted", `FXRP minted into the vault: ${Number(bal) / 1e6} FXRP (deferred mint settled)`, { tone: "ok" });
          const v = vaultAt(key);
          if (Number(await v.state()) === 1) {
            const atx = await v.activate();
            await atx.wait();
            rec(key, "active", "Vault is ACTIVE — the dial is live", { txFlare: atx.hash, tone: "ok" });
          }
        }
      }).catch(() => {});
    }
    // (b) cancel redemptions that FAssets fulfilled only partially (state 7)
    if (!jobs.get(key) && !sv.meta?.pendingMint) {
      vaultAt(key).state().then((st) => {
        if (Number(st) === 7 && !jobs.get(key)) {
          runJob(key, "cancel-crank", async () => {
            const tx = await vaultAt(key).cancelCrank();
            await tx.wait();
            rec(key, "cancelled", "Cancel redemption cranked — remaining balance settled toward the owner", { txFlare: tx.hash, tone: "gold" });
          }).catch(() => {});
        }
      }).catch(() => {});
    }
  }
}
// Rolling silence checkpoints: production plans run 90-180 days but FDC can
// only attest ~14 days back, so the keeper checkpoints every interval —
// chained strictly, exactly like the gate2 experiment. Compressed on testnet.
const CHECKPOINT_SEC = Number(process.env.CHECKPOINT_SEC ?? 900); // 7 days in production
async function checkpointScan() {
  for (const [key, sv] of Object.entries(store.vaults)) {
    if (jobs.get(key)) continue;
    const meta = sv.meta ?? {};
    if (meta.mode === "evm") continue; // consensus time needs no checkpoints
    if (!meta.ownerXrpl) continue;
    if (Date.now() - (meta.lastCkptAt ?? 0) < CHECKPOINT_SEC * 1000) continue;
    try {
      const v = vaultAt(key);
      if (Number(await v.state()) !== 2) continue;
      const [lastTs, provenTs] = await Promise.all([v.lastHeartbeatTs(), v.silenceProvenThroughTs()]);
      const nowTs = Math.floor(Date.now() / 1000);
      // only meaningful once real silence has accumulated beyond the interval
      if (nowTs - Number(lastTs) < CHECKPOINT_SEC || nowTs - Number(provenTs) < CHECKPOINT_SEC) continue;
      meta.lastCkptAt = Date.now(); persist();
      runJob(key, "checkpoint", async () => {
        const nowL = await validatedLedger();
        const minLedger = Number(await v.nextSilenceLedger());
        const cfg = await vaultConfig(v);
        rec(key, "checkpoint", "Rolling silence checkpoint — chaining a proof segment before the attestation window slides away", { tone: "warn" });
        const proof = await proveSilence(agent, {
          beacon: BEACON, reference: cfg.heartbeatReference, ownerAddress: meta.ownerXrpl,
          minLedger, deadlineLedger: nowL.ledger - 4, deadlineTs: nowL.ts - 15,
        });
        const stx = await v.attestSilence(proof);
        await stx.wait();
        rec(key, "silence", `Checkpoint attested — silence proven through ${new Date(Number(await v.silenceProvenThroughTs()) * 1000).toLocaleTimeString()}`, { txFlare: stx.hash, round: proof.meta.round, tone: "warn" });
      }).catch(() => {});
    } catch { /* per-vault errors never break the scan */ }
  }
}
setInterval(fundingScan, 30_000);
setInterval(pendingScan, 45_000);
setInterval(checkpointScan, 120_000);

const PORT = process.env.PORT ?? 8787;
app.listen(PORT, () => log(`heirloom keeper listening on :${PORT} (factory ${dep.factory})`));
