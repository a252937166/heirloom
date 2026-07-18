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
const amSettings = new Contract(dep.assetManager, [
  "function directMintingPaymentAddress() view returns (string)",
  "function getDirectMintingFeeBIPS() view returns (uint256)",
  "function getDirectMintingMinimumFeeUBA() view returns (uint256)",
  "function getDirectMintingExecutorFeeUBA() view returns (uint256)",
  "function getDirectMintingLargeMintingThresholdUBA() view returns (uint256)",
  "function getDirectMintingLargeMintingDelaySeconds() view returns (uint256)",
  "function directMintingDelayState(bytes32) view returns (uint8 delayState, uint256 allowedAt, uint256 startedAt)",
], provider);

// live protocol settings for direct-minting quotes (60s cache). The static
// fallback keeps the funding flow alive through RPC blips — and is disclosed
// via `source`, never silently.
let _mintSettings = { at: 0, v: null };
async function mintSettings() {
  if (_mintSettings.v && Date.now() - _mintSettings.at < 60_000) return _mintSettings.v;
  try {
    const [feeBIPS, minFee, execFee, largeThreshold, largeDelay, payAddr] = await Promise.all([
      amSettings.getDirectMintingFeeBIPS(), amSettings.getDirectMintingMinimumFeeUBA(),
      amSettings.getDirectMintingExecutorFeeUBA(), amSettings.getDirectMintingLargeMintingThresholdUBA(),
      amSettings.getDirectMintingLargeMintingDelaySeconds(), amSettings.directMintingPaymentAddress(),
    ]);
    _mintSettings = { at: Date.now(), v: {
      feeBIPS: BigInt(feeBIPS), minFee: BigInt(minFee), execFee: BigInt(execFee),
      largeThreshold: BigInt(largeThreshold), largeDelay: Number(largeDelay),
      paymentAddress: payAddr?.startsWith("r") ? payAddr : dep.coreVaultXrpl, source: "asset-manager",
    } };
  } catch {
    _mintSettings = { at: Date.now(), v: {
      feeBIPS: 25n, minFee: 100000n, execFee: 100000n,
      largeThreshold: 100000000000n, largeDelay: 3600,
      paymentAddress: dep.coreVaultXrpl, source: "static-fallback",
    } };
  }
  return _mintSettings.v;
}

// protocol formula: mintedUBA = gross − max(⌊gross·feeBIPS/10000⌋, minFee) − executorFee
// (verified against the canonical case: 10275690 − 100000 − 100000 = 10075690)
const bmax = (a, b) => (a > b ? a : b);
const mintedFor = (g, s) => g - bmax((g * s.feeBIPS) / 10000n, s.minFee) - s.execFee;
function grossForNet(netUBA, s) {
  let g = netUBA + s.minFee + s.execFee; // min-fee regime (all demo sizes)
  if ((g * s.feeBIPS) / 10000n > s.minFee) {
    g = ((netUBA + s.execFee) * 10000n + (10000n - s.feeBIPS - 1n)) / (10000n - s.feeBIPS); // ceil
  }
  while (mintedFor(g, s) < netUBA) g += 1n; // exact forward check (≤2 steps)
  return g;
}

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
// durable meta writes: without these, a journal rebuild after state-file
// corruption would lose redemptions/settlements — loadStore replays them
const journalMeta = (addr, patch) => journal({ type: "meta", vault: addr.toLowerCase(), meta: jsonSafe(patch) });
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

let BUILD_SHA = "dev";
try { BUILD_SHA = readFileSync(new URL("../BUILD_SHA", import.meta.url), "utf8").trim(); } catch { /* dev run */ }
app.get("/api/health", (_req, res) => res.json({ ok: true, build: BUILD_SHA, factory: dep.factory, beacon: BEACON, at: Date.now() }));

// direct-mint quote: protocol-exact drops computed from the AssetManager's
// LIVE direct-minting settings, paid to the live directMintingPaymentAddress().
// Quotes expire — never pay from a stale one.
app.get("/api/direct-mint/quote", async (req, res) => {
  try {
    const lots = Math.max(1, Math.min(10, Number(req.query.lots ?? 2)));
    const netUBA = BigInt(lots) * BigInt(dep.lotSizeUBA);
    const s = await mintSettings();
    const grossUBA = grossForNet(netUBA, s);
    res.json({
      quoteId: hexlify(randomBytes(8)),
      lots,
      netMintUBA: String(netUBA),
      exactPaymentDrops: String(grossUBA), // drops == UBA for XRP
      paymentAddress: s.paymentAddress,
      breakdown: {
        feeBIPS: String(s.feeBIPS),
        minimumFeeUBA: String(s.minFee),
        executorFeeUBA: String(s.execFee),
        source: s.source,
      },
      largeMint: {
        thresholdUBA: String(s.largeThreshold),
        delaySeconds: s.largeDelay,
        wouldDelay: grossUBA >= s.largeThreshold,
      },
      feeNote: `protocol-exact from live AssetManager settings: fee = max(gross×${s.feeBIPS}/10000, ${Number(s.minFee) / 1e6} XRP floor) + ${Number(s.execFee) / 1e6} XRP executor fee — no hidden margin`,
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
    // protocol-exact gross from live settings; remember the quote-time payment
    // address so the funding scan keeps working even if Flare rotates it
    const s = await mintSettings();
    const gross = grossForNet(BigInt(lots) * BigInt(dep.lotSizeUBA), s);
    Object.assign(meta, { ownerXrpl: evmMode ? null : ownerXrpl, ownerEvm: evmMode ? ownerEvm : null, mode: evmMode ? "evm" : "xrpl", beneficiaryXrpl, reference, createdTx: tx.hash, paymentAddress: s.paymentAddress, grossDrops: String(gross) });
    journalMeta(vault, { ownerXrpl: meta.ownerXrpl, ownerEvm: meta.ownerEvm, mode: meta.mode, beneficiaryXrpl, reference, createdTx: tx.hash, paymentAddress: meta.paymentAddress, grossDrops: meta.grossDrops });
    rec(vault, "created", `Vault created for ${(evmMode ? ownerEvm : ownerXrpl).slice(0, 8)}… → ${beneficiaryXrpl.slice(0, 8)}… (${evmMode ? "MetaMask/OKX owner" : "XRPL owner"})`, { txFlare: tx.hash, tone: "gold" });
    res.json({ vault, reference, fundingMemo: buildMintMemo(vault), coreVaultXrpl: dep.coreVaultXrpl, paymentAddress: s.paymentAddress, grossDrops: String(gross) });
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
              // the protocol tells us exactly when a delayed mint becomes
              // executable — schedule the retry instead of blind polling
              try {
                const [st, allowedAt] = await amSettings.directMintingDelayState(proof.data.requestBody.transactionId);
                if (Number(st) === 1) {
                  meta2.pendingMint.delayState = 1;
                  meta2.pendingMint.executionAllowedAt = Number(allowedAt);
                }
              } catch { /* view unavailable — fixed cadence still applies */ }
              journalMeta(addr, { pendingMint: meta2.pendingMint });
              persist();
              const waitNote = meta2.pendingMint.executionAllowedAt
                ? ` Protocol allows execution at ${new Date(meta2.pendingMint.executionAllowedAt * 1000).toLocaleTimeString()}.`
                : "";
              rec(addr, "mintPending", `Payment received by the protocol — minting is deferred by FAssets limits. The keeper retries with the same proof; no second payment is needed.${waitNote}`, { txFlare: tx.hash, round: proof.meta.round, tone: "warn" });
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

// decode RedemptionRequested logs from any receipt (release OR cancel path)
function parseRedemptionRequests(rc) {
  const reqs = [];
  for (const lg of rc?.logs ?? []) {
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
    } catch { /* other logs */ }
  }
  return reqs;
}
function recordRedemptions(addr, meta, reqs) {
  const known = new Set((meta.redemptions ?? []).map((r) => r.requestId));
  meta.redemptions = [...(meta.redemptions ?? []), ...reqs.filter((r) => !known.has(r.requestId))];
  journalMeta(addr, { redemptions: meta.redemptions });
  persist();
}
// watch XRPL for payouts matched by payment reference (release → beneficiary,
// cancel → owner). Unsettled refs land in awaitingSettlement and feed the
// permissionless redemption-default path.
async function watchSettlements(addr, destination, reqs, meta) {
  if (!destination || reqs.length === 0) return;
  const wanted = new Set(reqs.map((r) => r.paymentReference));
  for (let i = 0; i < 80 && wanted.size; i++) {
    await sleep(15_000);
    const at = await xrplRpc("account_tx", { account: destination, limit: 15 });
    for (const t of at.result?.transactions ?? []) {
      const txj = t.tx_json ?? t.tx;
      if (!txj || txj.Destination !== destination) continue;
      const memo = txj.Memos?.[0]?.Memo?.MemoData?.toLowerCase();
      if (!memo) continue;
      const ref = "0x" + memo;
      if (wanted.has(ref)) {
        wanted.delete(ref);
        const r = reqs.find((x) => x.paymentReference === ref);
        const delivered = (t.meta ?? t.metaData)?.delivered_amount ?? txj.Amount;
        (meta.settlements ??= []).push({ requestId: r.requestId, deliveredDrops: String(delivered), txXrpl: txj.hash ?? t.hash, paymentReference: ref });
        meta.awaitingSettlement = (meta.awaitingSettlement ?? []).filter((x) => x !== ref);
        journalMeta(addr, { settlements: meta.settlements, awaitingSettlement: meta.awaitingSettlement });
        persist();
        rec(addr, "settled",
          `Redemption #${r.requestId} settled: ${(Number(delivered) / 1e6).toFixed(2)} XRP delivered with payment reference ${ref.slice(0, 14)}…`,
          { txXrpl: txj.hash ?? t.hash, tone: "ok" });
      }
    }
  }
  if (wanted.size) {
    rec(addr, "settling", "Redemption payment(s) still inside the agent window — tracking by payment reference; if the agent misses the underlying deadline, the FAssets default path (collateral compensation) becomes available", { tone: "warn" });
    meta.awaitingSettlement = [...new Set([...(meta.awaitingSettlement ?? []), ...wanted])];
    journalMeta(addr, { awaitingSettlement: meta.awaitingSettlement });
    persist();
  }
}

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
      const reqs = parseRedemptionRequests(rc);
      recordRedemptions(addr, meta, reqs);
      rec(addr, "released",
        `Release executed — redemption request${reqs.length > 1 ? "s" : ""} ${reqs.map((r) => "#" + r.requestId).join(", ")} for ${reqs.reduce((s, r) => s + Number(r.valueUBA), 0) / 1e6} FXRP`,
        { txFlare: tx.hash, tone: "gold" });
      await watchSettlements(addr, beneficiary, reqs, meta);
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
          journalMeta(addr, { awaitingSettlement: meta.awaitingSettlement });
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
    receipt: { redemptions: v.meta?.redemptions ?? [], settlements: v.meta?.settlements ?? [], awaitingSettlement: v.meta?.awaitingSettlement ?? [] },
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
            const rcx = await ctx.wait();
            rec(vaultAddr, "cancelled", "Plan cancelled — the vault is redeeming everything back to the owner's XRPL wallet", { txFlare: ctx.hash, tone: "gold" });
            // cancel redemptions get the same tracking as release redemptions:
            // "returning" vs "returned" must be provable, not assumed
            const creqs = parseRedemptionRequests(rcx);
            if (creqs.length) {
              const cmeta = metaOf(vaultAddr);
              recordRedemptions(vaultAddr, cmeta, creqs);
              await watchSettlements(vaultAddr, ownerXrpl, creqs, cmeta);
            }
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
// Scans the union of {deployment core vault, live directMintingPaymentAddress(),
// every quote-time address stored on our vaults} so a Flare-side address
// rotation can never blind the auto-detection.
let _liveAddr = { at: 0, v: null };
async function livePaymentAddress() {
  if (Date.now() - _liveAddr.at < 300_000) return _liveAddr.v;
  try {
    const a = await amSettings.directMintingPaymentAddress();
    _liveAddr = { at: Date.now(), v: a?.startsWith("r") ? a : null };
  } catch { _liveAddr = { at: Date.now(), v: null }; }
  return _liveAddr.v;
}
async function fundingScan() {
  try {
    const addrs = new Set([dep.coreVaultXrpl]);
    const live = await livePaymentAddress();
    if (live) addrs.add(live);
    for (const sv of Object.values(store.vaults)) {
      if (sv.meta?.paymentAddress) addrs.add(sv.meta.paymentAddress);
    }
    for (const acct of addrs) {
      const at = await xrplRpc("account_tx", { account: acct, limit: 25 });
      for (const t of at.result?.transactions ?? []) {
        const tx = t.tx_json ?? t.tx;
        if (!tx || tx.TransactionType !== "Payment" || tx.Destination !== acct) continue;
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
    }
  } catch (e) {
    log(`fundingScan: ${e.message?.slice(0, 80)}`);
  }
}
async function pendingScan() {
  for (const [key, sv] of Object.entries(store.vaults)) {
    // (a) deferred direct mints: retry the SAME proof until FXRP lands. The
    // protocol's own delay state (executionAllowedAt) schedules the retry —
    // a Delayed mint waits for its window instead of blind-polling into it.
    const pm = sv.meta?.pendingMint;
    if (pm && !jobs.get(key)) {
      const now = Date.now();
      const dueAt = pm.delayState === 1 && pm.executionAllowedAt
        ? pm.executionAllowedAt * 1000 + 30_000 // allowedAt + settle margin
        : pm.at + 90_000;                        // no delay info — fixed cadence
      if ((pm.tries ?? 0) >= 200) {
        if (!pm.exhausted) {
          pm.exhausted = true; persist();
          rec(key, "error", "Deferred mint: 200 retries exhausted — the same proof remains executable by anyone (permissionless); manual crank required", { tone: "warn" });
        }
      } else if (now >= dueAt) {
        pm.tries = (pm.tries ?? 0) + 1; pm.at = now; pm.lastAttemptAt = now; persist();
        runJob(key, "mint-retry", async () => {
          let bal = await fxrp.balanceOf(key);
          if (bal === 0n) {
            try {
              const txId = pm.proof?.data?.requestBody?.transactionId;
              if (txId) {
                const [st, allowedAt] = await amSettings.directMintingDelayState(txId);
                pm.delayState = Number(st); pm.executionAllowedAt = Number(allowedAt); persist();
                if (Number(st) === 1 && Number(allowedAt) * 1000 > Date.now()) return; // still Delayed — don't burn a tx
              }
            } catch { /* view unavailable — keep the cadence */ }
            try {
              const tx = await assetManager.executeDirectMinting(pm.proof);
              await tx.wait();
            } catch { /* still deferred or already executed elsewhere */ }
            bal = await fxrp.balanceOf(key);
          }
          if (bal > 0n) {
            delete sv.meta.pendingMint; journalMeta(key, { pendingMint: null }); persist();
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
    }
    // (b) cancel redemptions that FAssets fulfilled only partially (state 7)
    if (!jobs.get(key) && !sv.meta?.pendingMint) {
      vaultAt(key).state().then((st) => {
        if (Number(st) === 7 && !jobs.get(key)) {
          runJob(key, "cancel-crank", async () => {
            const tx = await vaultAt(key).cancelCrank();
            const rcx = await tx.wait();
            rec(key, "cancelled", "Cancel redemption cranked — remaining balance settled toward the owner", { txFlare: tx.hash, tone: "gold" });
            // track the crank's redemption toward the owner like any other
            const creqs = parseRedemptionRequests(rcx);
            if (creqs.length) {
              const cmeta = metaOf(key);
              recordRedemptions(key, cmeta, creqs);
              await watchSettlements(key, cmeta.ownerXrpl, creqs, cmeta);
            }
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
    // attempt/success split: a FAILED attestation retries on a minutes-scale
    // backoff instead of silently waiting out a full checkpoint interval
    // (7 days in production). Legacy lastCkptAt counts as the last success.
    const ckpt = (meta.ckpt ??= { lastAttemptAt: 0, lastSuccessAt: meta.lastCkptAt ?? 0, failures: 0, nextRetryAt: 0 });
    const nowMs = Date.now();
    if (nowMs - ckpt.lastSuccessAt < CHECKPOINT_SEC * 1000 || nowMs < ckpt.nextRetryAt) continue;
    try {
      const v = vaultAt(key);
      if (Number(await v.state()) !== 2) continue;
      const [lastTs, provenTs] = await Promise.all([v.lastHeartbeatTs(), v.silenceProvenThroughTs()]);
      const nowTs = Math.floor(Date.now() / 1000);
      // only meaningful once real silence has accumulated beyond the interval
      if (nowTs - Number(lastTs) < CHECKPOINT_SEC || nowTs - Number(provenTs) < CHECKPOINT_SEC) continue;
      ckpt.lastAttemptAt = nowMs; persist();
      runJob(key, "checkpoint", async () => {
        try {
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
          ckpt.lastSuccessAt = Date.now(); ckpt.failures = 0; ckpt.nextRetryAt = 0;
          meta.lastCkptAt = Date.now(); // legacy mirror: a rollback stays sane
          persist();
          rec(key, "silence", `Checkpoint attested — silence proven through ${new Date(Number(await v.silenceProvenThroughTs()) * 1000).toLocaleTimeString()}`, { txFlare: stx.hash, round: proof.meta.round, tone: "warn" });
        } catch (e) {
          ckpt.failures = (ckpt.failures ?? 0) + 1;
          ckpt.nextRetryAt = Date.now() + Math.min(60_000 * 2 ** ckpt.failures, 3_600_000);
          persist();
          throw e; // runJob still records the error event
        }
      }).catch(() => {});
    } catch { /* per-vault errors never break the scan */ }
  }
}
setInterval(fundingScan, 30_000);
setInterval(pendingScan, 45_000);
setInterval(checkpointScan, 120_000);

const PORT = process.env.PORT ?? 8787;
app.listen(PORT, () => log(`heirloom keeper listening on :${PORT} (factory ${dep.factory})`));
