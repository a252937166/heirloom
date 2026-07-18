// Builds the verified case manifest (web/src/case-001.json) from PUBLIC data:
// chain state on Coston2, the keeper's public journal, and the XRPL settlement
// transaction itself. Nothing in the dashboard is hand-written — if a check
// fails here, the page must say so instead of pretending.
//
//   node build-case.mjs [vaultAddress] [apiBase]
import { Contract, Interface, keccak256, toUtf8Bytes } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import { provider, curlJson, xrplRpc, VAULT_ABI, vaultConfig, log } from "./fdc-lib.mjs";

const dep = JSON.parse(readFileSync(new URL("../contracts/deployments.real.json", import.meta.url), "utf8"));
const VAULT = process.argv[2] ?? "0x35975770e1eD5431e0bFCaBB238B6188c94AeAdA";
const API = process.argv[3] ?? "https://heirloom.axiqo.xyz/api";

const v = new Contract(VAULT, VAULT_ABI, provider);
const fxrp = new Contract(dep.fxrp, ["function balanceOf(address) view returns (uint256)"], provider);

const [state, cfg, balance, epoch] = await Promise.all([
  v.state(), vaultConfig(v), fxrp.balanceOf(VAULT), v.heartbeatEpoch(),
]);
log(`chain: state=${state} balance=${balance} epochs=${epoch}`);

const j = await curlJson(`${API}/vaults/${VAULT}`);
const events = j.events ?? [];
if (!events.length) throw new Error("keeper journal empty — wrong API base?");

const byKind = (k) => events.filter((e) => e.kind === k);
const first = (k) => byKind(k)[0];
const minted = first("minted");
const settledAll = byKind("settled");
const settled = settledAll[0];
const silence = first("silence");
const claimStarted = first("claimStarted");
const released = first("released");
const residualEv = first("residual");

// --- decode the redemption from the release receipt (chain truth) ---------
const AM_EVENTS = new Interface([
  "event RedemptionRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, string paymentAddress, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei)",
]);
let redemption = null;
if (released?.txFlare) {
  try {
    const rc = await provider.getTransactionReceipt(released.txFlare);
    for (const lg of rc?.logs ?? []) {
      try {
        const p = AM_EVENTS.parseLog(lg);
        if (p?.name === "RedemptionRequested") {
          redemption = {
            requestId: p.args.requestId.toString(),
            valueUBA: p.args.valueUBA.toString(),
            feeUBA: p.args.feeUBA.toString(),
            paymentReference: p.args.paymentReference,
          };
        }
      } catch { /* other logs */ }
    }
  } catch {}
}

// --- find the recordHeartbeat tx on-chain when the journal lacks it --------
let heartbeatTxFlare = first("alive")?.txFlare ?? null;
if (!heartbeatTxFlare) {
  try {
    const sel = new Interface(VAULT_ABI).getFunction("recordHeartbeat")?.selector;
    const bs = await curlJson(`https://coston2-explorer.flare.network/api?module=account&action=txlist&address=${VAULT}`);
    const row = (Array.isArray(bs.result) ? bs.result : []).find((t) => t.input?.startsWith(sel) && t.isError === "0");
    if (row) heartbeatTxFlare = row.hash;
  } catch {}
}

// --- recover the mint tx from the chain when a network executor beat the
// keeper to executeDirectMinting (the event then has no hash on record)
let mintTxFlare = minted?.txFlare ?? null;
let redeemedFxrp = null;
let mintRow = null;
try {
  const bs = await curlJson(`https://coston2-explorer.flare.network/api?module=account&action=tokentx&address=${VAULT}`);
  const rows = Array.isArray(bs.result) ? bs.result : [];
  mintRow = rows.find((t) => t.to?.toLowerCase() === VAULT.toLowerCase() && /^0x0+$/.test(t.from)) ?? null;
  if (!mintTxFlare && mintRow) mintTxFlare = mintRow.hash;
  const burnRow = rows.find((t) => t.from?.toLowerCase() === VAULT.toLowerCase());
  if (burnRow) redeemedFxrp = (Number(burnRow.value) / 1e6).toString();
} catch {}

// --- verify the settlement against XRPL itself (destination + reference memo)
let settleTx = null;
if (settled?.txXrpl) {
  const t = await xrplRpc("tx", { transaction: settled.txXrpl });
  if (t.result?.validated) {
    settleTx = {
      hash: settled.txXrpl,
      destination: t.result.tx_json?.Destination ?? t.result.Destination,
      amountDrops: String(t.result.meta?.delivered_amount ?? t.result.tx_json?.Amount ?? t.result.Amount ?? ""),
      memoHex: (t.result.tx_json?.Memos ?? t.result.Memos ?? [])[0]?.Memo?.MemoData ?? null,
      ledger: t.result.ledger_index,
    };
  }
}
// --- chain-time truth for the challenge: block timestamps of the claim-start
// and release transactions, plus the vault's own cutoff/eligibility views
// (executeRelease never zeroes them, so they stay queryable at state 5).
// The keeper journal's wall-clock `.at` stamps are evidence, not proof.
const blockTsOf = async (h) => {
  try {
    const rc = await provider.getTransactionReceipt(h);
    return rc ? Number((await provider.getBlock(rc.blockNumber)).timestamp) : null;
  } catch { return null; }
};
const claimTs = claimStarted?.txFlare ? await blockTsOf(claimStarted.txFlare) : null;
const releaseTs = released?.txFlare ? await blockTsOf(released.txFlare) : null;
const [cutoffChain, eligibleChain] = await Promise.all([
  v.claimChallengeEndsAt().catch(() => 0n),
  v.releaseEligibleAt().catch(() => 0n),
]);
const graceSec = Number(cfg.vetoProofGrace ?? 0);
const heartbeatCutoffAt = Number(cutoffChain) || (claimTs != null ? claimTs + Number(cfg.challengePeriod) : null);
const releaseEligibleAt = Number(eligibleChain) || (heartbeatCutoffAt != null ? heartbeatCutoffAt + graceSec : null);
const challengeRespected = claimTs != null && releaseTs != null &&
  releaseTs >= claimTs + Number(cfg.challengePeriod) + graceSec;

// residual threshold: the contract's own gate is assetManager.minimumRedeemAmountUBA()
// (HeirloomVault.executeRelease) — read it live, fall back to the config lot size
let minRedeemUBA = Number(cfg.lotSizeUBA);
let minRedeemSource = "vault-config lot size";
try {
  const am = new Contract(dep.assetManager, ["function minimumRedeemAmountUBA() view returns (uint256)"], provider);
  minRedeemUBA = Number(await am.minimumRedeemAmountUBA());
  minRedeemSource = "assetManager.minimumRedeemAmountUBA()";
} catch {}

const destMatches = !!settleTx && keccak256(toUtf8Bytes(settleTx.destination)) === cfg.beneficiaryXrplHash;
const refBound = !!settleTx?.memoHex && !!redemption &&
  settleTx.memoHex.toLowerCase() === redemption.paymentReference.slice(2).toLowerCase();
const balanceUBA = Number(balance);
const releasedState = Number(state) === 5;
const zeroBalance = balanceUBA === 0;
const residualBelowMin = balanceUBA > 0 && balanceUBA < minRedeemUBA;
const linksPresent = [
  first("created")?.txFlare, first("funding")?.txXrpl, mintTxFlare,
  first("heartbeat")?.txXrpl, heartbeatTxFlare, silence?.txFlare,
  claimStarted?.txFlare, released?.txFlare, settleTx?.hash,
].every(Boolean);

const checks = [
  { label: "Payout destination matches the configured beneficiary (hash preimage verified against XRPL tx)", passed: destMatches },
  { label: "Settlement memo EQUALS the RedemptionRequested paymentReference (decoded from the release receipt)", passed: refBound },
  { label: "Challenge and veto-proof grace fully elapsed before release (verified from chain block timestamps)", passed: challengeRespected },
  { label: zeroBalance
      ? "Final vault FXRP balance is zero — fully reconciled"
      : `The vault redeemed the maximum the FAssets protocol accepts; the remaining ${(balanceUBA / 1e6).toFixed(2)} FXRP is below the protocol's minimum redeemable amount (${(minRedeemUBA / 1e6)} FXRP via ${minRedeemSource}) and stays publicly visible on-chain`,
    passed: releasedState && (zeroBalance || residualBelowMin) },
  { label: "All nine lifecycle claims carry public transaction hashes", passed: linksPresent },
];
const allPassed = checks.every((c) => c.passed);
const verdict = !releasedState ? "SETTLEMENT IN PROGRESS"
  : !allPassed ? "PARTIALLY RECONCILED"
  : zeroBalance ? "SETTLED · FULLY RECONCILED"
  : "SETTLED · RESIDUAL DISCLOSED";

const manifest = {
  id: "case-001",
  builtAt: new Date().toISOString(),
  network: "Flare Coston2 + XRPL Testnet",
  truth: "Real XRPL transactions · Real FDC attestations · Real Coston2 contracts · Real XRP Testnet payout — demo identities, compressed timing",
  vault: VAULT,
  finalState: Number(state),
  verdict,
  // amounts come from chain data (FXRP mint transfer / XRPL delivered_amount);
  // the journal label is only a disclosed fallback
  protectedFxrp: mintRow?.value ? (Number(mintRow.value) / 1e6).toString()
    : (minted?.label.match(/([\d.]+) FXRP/)?.[1] ?? null),
  protectedFxrpSource: mintRow?.value ? "chain" : "journal-label",
  payoutXrp: settleTx?.amountDrops ? (Number(settleTx.amountDrops) / 1e6).toString()
    : (settledAll.map((s) => s.label.match(/([\d.]+) XRP/)?.[1]).filter(Boolean).join(" + ") || null),
  payoutXrpSource: settleTx?.amountDrops ? "chain" : "journal-label",
  finalFxrpBalance: (balanceUBA / 1e6).toFixed(balanceUBA % 1e6 === 0 ? 0 : 2),
  heartbeatEpochs: Number(epoch),
  fdcRounds: [...new Set(events.map((e) => e.round).filter(Boolean))],
  silenceRound: silence?.round ?? null,
  redemptionIds: redemption ? [`#${redemption.requestId}`] : (released?.label.match(/#\d+/g) ?? []),
  redemption,
  contractVersion: cfg.vetoProofGrace !== undefined && Number(cfg.vetoProofGrace) > 0
    ? `HeirloomVault v4 (veto proof grace ${cfg.vetoProofGrace}s; factory ${dep.factory})`
    : cfg.ownerEvm !== undefined
      ? "HeirloomVault v3"
      : "HeirloomVault v2 (predates the v3 EVM-owner field)",
  mintTxFlare,
  fundingTxXrpl: first("funding")?.txXrpl ?? null,
  heartbeatTxXrpl: first("heartbeat")?.txXrpl ?? null,
  heartbeatTxFlare,
  heartbeatRound: first("alive")?.round ?? null,
  createdTxFlare: first("created")?.txFlare ?? null,
  claimStartTxFlare: claimStarted?.txFlare ?? null,
  silenceTxFlare: silence?.txFlare ?? null,
  redeemedFxrp,
  settlement: settleTx,
  releaseTxFlare: released?.txFlare ?? null,
  challenge: claimTs != null ? {
    startedAt: claimTs,                    // claim tx block timestamp (chain)
    heartbeatCutoffAt,                     // vault view claimChallengeEndsAt()
    vetoProofGraceSec: graceSec,
    releaseEligibleAt,                     // vault view releaseEligibleAt()
    releaseExecutedAt: releaseTs,          // release tx block timestamp (chain)
    endedAt: heartbeatCutoffAt,            // legacy alias for older readers
  } : null,
  residualNote: residualEv?.label ?? null,
  integrityChecks: checks,
};

const out = new URL("../web/src/case-001.json", import.meta.url);
writeFileSync(out, JSON.stringify(manifest, null, 2));
log(`verdict: ${verdict}`);
for (const c of checks) log(`${c.passed ? "✓" : "✗"} ${c.label}`);
log(`wrote ${out.pathname}`);
