// Live Case Dashboard — one REAL testnet lifecycle, played back as a product
// story with audit-grade evidence. All numbers come from case-001.json, which
// is generated (and cross-checked against chain + XRPL) by spike/build-case.mjs
// — never hand-written. The timeline overlays the keeper's live journal.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CONFIG } from "../config";
import { PulseDial } from "../components/PulseDial";
import { VaultView, readVault, fmtFxrp } from "../lib/chain";
import { EvidenceTimeline, KeeperEvent } from "./Vault";
import { NodeStepper } from "../components/NodeStepper";
import manifest from "../case-001.json";

type Ev = { chain: "XRPL" | "Flare" | "Rule"; label: string; hash?: string | null; url?: string; extra?: string };

interface Chapter {
  id: string;
  n: string;
  title: string;
  actor: string;      // human layer
  tech: string;       // technical layer
  result: string;     // one-line outcome
  evidence: Ev[];
  raw: string;        // collapsed technical detail
  dial: { state: number; frac: number; label: string };
  ember?: boolean;    // conflict chapters shift the accent
}

const m = manifest;
const CHAPTER_ICON: Record<string, string> = {
  promise: "✍", funded: "⇄", heartbeat: "♥", "early-claim": "✕", silence: "◎", challenge: "⏳", payout: "✓",
};
const CHAPTER_SHORT: Record<string, string> = {
  promise: "Promise", funded: "Funded", heartbeat: "Heartbeat", "early-claim": "Blocked",
  silence: "Silence", challenge: "Challenge", payout: "Payout",
};
const xrplTx = (h?: string | null) => (h ? `${CONFIG.xrplExplorer}/transactions/${h}` : undefined);
const flareTx = (h?: string | null) => (h ? `${CONFIG.explorer}/tx/${h}` : undefined);

const CHAPTERS: Chapter[] = [
  {
    id: "promise", n: "1", title: "The promise was set",
    actor: "Alex chose Maya as the beneficiary and defined the inactivity and final-challenge periods.",
    tech: "A dedicated vault was created on Coston2 with an immutable beneficiary fingerprint and an owner-bound heartbeat reference.",
    result: "The rules were locked before any money moved.",
    evidence: [
      { chain: "Flare", label: "Vault creation", hash: m.createdTxFlare, url: flareTx(m.createdTxFlare) },
      { chain: "Flare", label: "Vault contract", hash: m.vault, url: `${CONFIG.explorer}/address/${m.vault}` },
    ],
    raw: "HeirloomFactory.createVault → EIP-1167 clone; Config{ownerXrplHash, beneficiaryXrplHash, beaconHash, heartbeatReference, periods}; event VaultCreated.",
    dial: { state: 2, frac: 0.03, label: "plan created — rules locked" },
  },
  {
    id: "funded", n: "2", title: "XRP entered the vault",
    actor: "Alex funded the plan with one payment from an existing XRPL wallet — no EVM wallet, no bridge UI.",
    tech: "FAssets verified the XRPL payment via FDC and minted FXRP straight into the vault contract.",
    result: "XRP became programmable without giving Heirloom a key.",
    evidence: [
      { chain: "XRPL", label: "Funding payment", hash: m.fundingTxXrpl, url: xrplTx(m.fundingTxXrpl) },
      { chain: "Flare", label: `Mint into the vault (${m.protectedFxrp} FXRP)`, hash: m.mintTxFlare, url: flareTx(m.mintTxFlare) },
    ],
    raw: "FDC XRPPayment attestation over the funding tx → AssetManager.executeDirectMinting(proof); memo = 0x4642505266410018‖00000000‖vault address. Minting was executed by a permissionless network executor — the crank is open by design.",
    dial: { state: 2, frac: 0.05, label: `${m.protectedFxrp} FXRP protected` },
  },
  {
    id: "heartbeat", n: "3", title: "Alex checked in",
    actor: "Alex sent a one-drop heartbeat. The plan stayed under the owner's control and the inactivity clock reset.",
    tech: "FDC verified the payment came from the configured owner address and carried the vault's exact 32-byte reference.",
    result: "Only the owner's payment counted.",
    evidence: [
      { chain: "XRPL", label: "Heartbeat (1 drop + reference memo)", hash: m.heartbeatTxXrpl, url: xrplTx(m.heartbeatTxXrpl) },
      { chain: "Flare", label: `recordHeartbeat on-chain${m.heartbeatRound ? ` · round ${m.heartbeatRound}` : ""}`, hash: m.heartbeatTxFlare, url: flareTx(m.heartbeatTxFlare) },
    ],
    raw: "FDC XRPPayment: sourceAddressHash must equal config.ownerXrplHash; firstMemoData must equal heartbeatReference; epoch += 1; a heartbeat during ClaimPending emits ClaimVetoed.",
    dial: { state: 2, frac: 0.12, label: "heartbeat proven — dial reset" },
  },
  {
    id: "early-claim", n: "4", title: "Maya could not claim early",
    actor: "Maya tested the recovery path while Alex was still active. The vault refused to release anything.",
    tech: "The required silence window had not been proven, so the contract rejects any claim: the proof of absence cannot even be built while a real heartbeat exists in the window.",
    result: "Funds moved: 0 · Owner control: unchanged.",
    evidence: [
      { chain: "Rule", label: "Contract enforcement — SilenceNotProven (no transaction possible: the FDC verifier answers REFERENCED TRANSACTION EXISTS)", extra: "contract rule, not a transaction" },
      { chain: "Rule", label: "Recorded production run: a release attempt 7 seconds early was rejected on-chain with ChallengeNotOver", extra: "same guard, later stage" },
    ],
    raw: "startClaim requires silenceProvenThroughTs ≥ silenceDeadline; the RPN attestation is source-filtered (checkSourceAddresses=true, sourceAddressesRoot=keccak²(owner)) — while the owner's heartbeat exists the verifier returns INVALID.",
    dial: { state: 2, frac: 0.45, label: "early claim refused — owner alive" },
    ember: true,
  },
  {
    id: "silence", n: "5", title: "Flare proved the silence",
    actor: "After the demo inactivity period elapsed, the network — not Heirloom's server — confirmed that no valid owner heartbeat existed in the required window.",
    tech: "A source-filtered ReferencedPaymentNonexistence attestation covered an unbroken ledger range starting at the last heartbeat's ledger + 1.",
    result: "The absence was proven, not inferred.",
    evidence: [
      { chain: "Flare", label: `attestSilence · FDC round ${m.silenceRound ?? "—"}`, hash: m.silenceTxFlare, url: flareTx(m.silenceTxFlare) },
    ],
    raw: "RPN request: {minimalBlockNumber = lastHeartbeatLedger+1, deadline, destinationAddressHash = beacon, standardPaymentReference = heartbeatReference, checkSourceAddresses = true, sourceAddressesRoot = keccak256(keccak256(owner))}; FdcVerification.verifyReferencedPaymentNonexistence on-chain.",
    dial: { state: 2, frac: 0.97, label: "silence attested by consensus" },
  },
  {
    id: "challenge", n: "6", title: "Alex received a final veto",
    actor: "A final challenge window opened. One valid owner heartbeat could still cancel the release.",
    tech: "The contract entered ClaimPending; release stayed impossible until the challenge deadline passed.",
    result: "Silence alone did not cause an immediate, irreversible payout.",
    evidence: [
      { chain: "Flare", label: "startClaim — challenge window opened", hash: m.claimStartTxFlare, url: flareTx(m.claimStartTxFlare) },
      ...(m.challenge ? [{ chain: "Rule" as const, label: `Window: ${new Date(m.challenge.startedAt * 1000).toLocaleTimeString()} → ${new Date(m.challenge.endedAt * 1000).toLocaleTimeString()}`, extra: "enforced by claimChallengeEndsAt" }] : []),
    ],
    raw: "state = ClaimPending; claimChallengeEndsAt = now + challengePeriod; recordHeartbeat during this window → ClaimVetoed, state back to Active; executeRelease before the deadline reverts ChallengeNotOver.",
    dial: { state: 3, frac: 0.5, label: "challenge — one heartbeat vetoes" },
    ember: true,
  },
  {
    id: "payout", n: "7", title: "XRP reached Maya",
    actor: "The challenge passed without a veto. The vault redeemed through FAssets and native XRP reached Maya's existing XRPL wallet.",
    tech: "executeRelease initiated the redemption; the settlement payment was matched to the beneficiary, the amount, and the redemption's payment reference.",
    result: "The plan completed without any Heirloom-controlled withdrawal key.",
    evidence: [
      { chain: "Flare", label: `executeRelease — ${m.redeemedFxrp ?? "10"} FXRP redeemed`, hash: m.releaseTxFlare, url: flareTx(m.releaseTxFlare) },
      { chain: "XRPL", label: `Settlement: ${m.payoutXrp} XRP delivered to the beneficiary`, hash: m.settlement?.hash, url: xrplTx(m.settlement?.hash) },
    ],
    raw: `AssetManager.redeemAmount(balance, beneficiaryXrpl) → RedemptionRequested(paymentReference); the XRPL settlement carries that reference as its memo (${m.settlement?.memoHex ? m.settlement.memoHex.slice(0, 18) + "…" : "memo"}) — attribution by reference, not balance guessing.`,
    dial: { state: 5, frac: 1, label: `${m.payoutXrp} XRP delivered` },
  },
];

// tour schedule (seconds within the 90-second run when each chapter starts)
const TOUR_STARTS = [0, 10, 22, 34, 47, 61, 73];
const TOUR_TOTAL = 90;

const RAIL_XRPL = [
  { id: "fund", label: "Funding payment", hash: m.fundingTxXrpl, url: xrplTx(m.fundingTxXrpl), pair: "mint" },
  { id: "hb", label: "Owner heartbeat", hash: m.heartbeatTxXrpl, url: xrplTx(m.heartbeatTxXrpl), pair: "rec" },
  { id: "payout", label: "Beneficiary payout", hash: m.settlement?.hash, url: xrplTx(m.settlement?.hash), pair: "rel" },
];
const RAIL_FLARE = [
  { id: "created", label: "Vault created", hash: m.createdTxFlare, url: flareTx(m.createdTxFlare), pair: "" },
  { id: "mint", label: "FXRP minted", hash: m.mintTxFlare, url: flareTx(m.mintTxFlare), pair: "fund" },
  { id: "rec", label: "Heartbeat recorded", hash: m.heartbeatTxFlare, url: flareTx(m.heartbeatTxFlare), pair: "hb" },
  { id: "sil", label: "Silence attested", hash: m.silenceTxFlare, url: flareTx(m.silenceTxFlare), pair: "" },
  { id: "claim", label: "Claim started", hash: m.claimStartTxFlare, url: flareTx(m.claimStartTxFlare), pair: "" },
  { id: "rel", label: "Release executed", hash: m.releaseTxFlare, url: flareTx(m.releaseTxFlare), pair: "payout" },
];
const RAIL_NOTES: Record<string, string> = {
  fund: "One XRPL payment → FDC payment proof → FXRP minted on Flare. The user acted on XRPL; Flare made it programmable.",
  mint: "One XRPL payment → FDC payment proof → FXRP minted on Flare. The user acted on XRPL; Flare made it programmable.",
  hb: "A 1-drop heartbeat on XRPL → attested by FDC → the vault's dial reset on Flare. Owner action, network proof, contract effect.",
  rec: "A 1-drop heartbeat on XRPL → attested by FDC → the vault's dial reset on Flare. Owner action, network proof, contract effect.",
  payout: "executeRelease on Flare → the FAssets agent paid native XRP on XRPL, memo carrying the redemption reference. Contract decision, user result.",
  rel: "executeRelease on Flare → the FAssets agent paid native XRP on XRPL, memo carrying the redemption reference. Contract decision, user result.",
  sil: "No user action at all — that is the point. Flare's data providers proved the absence of a heartbeat.",
  claim: "The beneficiary's claim opened the challenge window. Still nothing moved.",
  created: "The vault clone was deployed with the promise burned into its config.",
};

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="mono" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }); }}
      style={{ background: "none", border: "1px solid var(--line)", borderRadius: 6, color: ok ? "var(--verdant)" : "var(--mist-2)", fontSize: "0.62rem", padding: "2px 7px", cursor: "pointer" }}>
      {ok ? "copied" : "copy"}
    </button>
  );
}

export function CaseStudy() {
  const [params, setParams] = useSearchParams();
  const initial = Math.max(0, CHAPTERS.findIndex((c) => c.id === params.get("chapter")));
  const [idx, setIdx] = useState(initial === -1 ? 0 : initial);
  const [events, setEvents] = useState<KeeperEvent[]>([]);
  const [live, setLive] = useState<VaultView | null>(null);
  const [railSel, setRailSel] = useState<string | null>(null);
  const [tour, setTour] = useState(false);
  const [tourPaused, setTourPaused] = useState(false);
  const [tourT, setTourT] = useState(0);
  const playerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (params.get("tour") === "1") { setTourT(0); setTour(true); }
    readVault(m.vault).then(setLive).catch(() => {});
    fetch(`${CONFIG.api}/vaults/${m.vault}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j) => setEvents(j.events ?? []))
      .catch(() => {});
  }, []);

  const go = useCallback((i: number, fromTour = false) => {
    const n = ((i % CHAPTERS.length) + CHAPTERS.length) % CHAPTERS.length;
    setIdx(n);
    if (!fromTour) { setTour(false); setParams({ chapter: CHAPTERS[n].id }, { replace: true }); }
  }, [setParams]);

  // 90-second guided tour: auto-advances chapters, pausable, never opens external links
  useEffect(() => {
    if (!tour) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (tourPaused) return;
    const t = setInterval(() => setTourT((s) => s + 0.5), 500);
    return () => clearInterval(t);
  }, [tour, tourPaused]);
  useEffect(() => {
    if (!tour) return;
    if (tourT >= TOUR_TOTAL) { setTour(false); setTourT(0); return; }
    const target = TOUR_STARTS.filter((s) => s <= tourT).length - 1;
    if (target >= 0 && target !== idx) go(target, true);
  }, [tour, tourT, idx, go]);

  const ch = CHAPTERS[idx];
  const now = Math.floor(Date.now() / 1000);
  const accent = ch.ember ? "var(--ember)" : "var(--lamplight)";
  const residual = Number(m.finalFxrpBalance) > 0;
  const liveBalance = live ? fmtFxrp(live.fxrpBalance) : null;

  const statusCards: [string, string][] = [
    ["Plan status", m.finalState === 5 ? "Settled" : m.finalState === 4 ? "Releasing" : "In progress"],
    ["Owner control", "Preserved until release"],
    ["Early claim", "Blocked"],
    ["Silence proof", "Verified"],
    ["XRP payout", "Confirmed"],
  ];
  const dataRow: [string, string, boolean?][] = [
    ["Protected FXRP", m.protectedFxrp ?? "—"],
    ["Beneficiary received", `${m.payoutXrp} XRP`],
    ["Heartbeat proofs", String(m.heartbeatEpochs)],
    ["FDC round", String(m.silenceRound ?? "—")],
    ["Final FXRP balance", m.finalFxrpBalance, residual],
  ];
  const checksAllPass = useMemo(() => m.integrityChecks.every((c) => c.passed), []);

  const NAV = [
    ["#overview", "▦", "Overview"], ["#story", "◈", "7-Step Story"], ["#audit", "⇄", "Dual-Ledger"],
    ["#attacks", "✕", "Attacks"], ["#receipt", "✓", "Receipt"], ["#evidence", "≡", "Evidence Log"],
  ] as const;
  return (
    <main style={{ paddingBottom: 60 }}>
      {tour && (
        <div style={{ position: "sticky", top: 62, zIndex: 9, background: "var(--ink-2)", borderBottom: "1px solid var(--line)" }} className="no-print">
          <div className="wrap" style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 24px" }}>
            <span className="mono" style={{ fontSize: "0.7rem", color: "var(--lamplight)" }}>{Math.min(90, Math.floor(tourT))}s / 90s · chapter {ch.n} of 7</span>
            <div style={{ flex: 1, height: 4, background: "var(--line)", borderRadius: 2 }}>
              <div style={{ width: `${Math.min(100, (tourT / TOUR_TOTAL) * 100)}%`, height: "100%", background: "var(--lamplight)", borderRadius: 2, transition: "width 0.5s linear" }} />
            </div>
            <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: "0.72rem" }} onClick={() => setTourPaused((p) => !p)}>{tourPaused ? "▶ Resume" : "❚❚ Pause"}</button>
            <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: "0.72rem" }} onClick={() => { setTour(false); setTourPaused(false); setTourT(0); }}>✕ Exit</button>
          </div>
        </div>
      )}

      <div className="wrap side-layout" style={{ paddingTop: 30 }}>
        <nav className="sidenav no-print" aria-label="Case sections">
          <span className="mono" style={{ fontSize: "0.62rem", color: "var(--mist-2)", letterSpacing: "0.12em", padding: "4px 12px 8px" }}>CASE #001</span>
          {NAV.map(([href, ic, label]) => (
            <a key={href} href={href}><span style={{ opacity: 0.7 }}>{ic}</span>{label}</a>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
      {/* ── hero: the conclusion first ─────────────────────────────────── */}
      <section id="overview" style={{ padding: "10px 0 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="pill gold">REAL TESTNET CASE</span>
            <span className="mono" style={{ fontSize: "0.68rem", color: "var(--mist)" }}>
              real XRPL transactions · real FDC attestations · real Coston2 contracts · real XRP Testnet payout
            </span>
          </div>
          <button className="btn btn-primary" style={{ padding: "9px 18px", fontSize: "0.85rem" }} onClick={() => { setTourT(0); setTour(true); }}>
            ▶ Start the 90-second tour
          </button>
        </div>
        <h1 style={{ fontSize: "2.3rem", margin: "20px 0 10px", maxWidth: 760 }}>
          A complete Heirloom lifecycle, proven across two ledgers.
        </h1>
        <p style={{ fontSize: "1rem", maxWidth: 700 }}>
          Alex protected XRP for Maya, stayed in control through owner-signed heartbeats, survived an early
          claim attempt, and completed a verified XRP Testnet payout.{" "}
          <span className="mono" style={{ fontSize: "0.74rem", color: "var(--mist-2)" }}>
            Demo identities · compressed timing — every transaction below is public and checkable.
          </span>
        </p>
        <div style={{ display: "flex", gap: 12, margin: "18px 0 26px", flexWrap: "wrap" }}>
          <a className="btn btn-ghost" href="#audit">Audit every transaction</a>
          <a className="mono" style={{ alignSelf: "center", fontSize: "0.72rem" }}
            href={`${CONFIG.explorer}/address/${m.vault}`} target="_blank" rel="noreferrer">
            vault {m.vault.slice(0, 12)}… ↗
          </a>
        </div>

        <div className="status-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <div className="stat"><div className="k">Protected</div><div className="v">{m.protectedFxrp} <span style={{ fontSize: "0.7rem", color: "var(--mist-2)" }}>FXRP</span></div></div>
          <div className="stat"><div className="k">Delivered</div><div className="v" style={{ color: "var(--verdant)" }}>{m.payoutXrp} <span style={{ fontSize: "0.7rem", color: "var(--mist-2)" }}>XRP</span></div></div>
          <div className="stat"><div className="k">Early claim</div><div className="v" style={{ color: "var(--ember)" }}>Blocked</div></div>
          <div className="stat"><div className="k">Silence proof</div><div className="v" style={{ color: "var(--verdant)" }}>Verified</div></div>
          <div className="stat"><div className="k">Challenge</div><div className="v" style={{ color: "var(--verdant)" }}>Passed</div></div>
          <div className="stat"><div className="k">Final balance</div><div className="v" style={{ color: "var(--lamplight-strong)" }}>{m.finalFxrpBalance} <span style={{ fontSize: "0.7rem", color: "var(--mist-2)" }}>FXRP</span></div></div>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 10, padding: "8px 2px", borderBottom: "1px solid var(--line)" }}>
          <span className="mono" style={{ fontSize: "0.7rem", color: "var(--mist)" }}>heartbeat proofs <strong style={{ color: "var(--paper)" }}>{m.heartbeatEpochs}</strong></span>
          <span className="mono" style={{ fontSize: "0.7rem", color: "var(--mist)" }}>FDC round <strong style={{ color: "var(--paper)" }}>{m.silenceRound ?? "—"}</strong></span>
          <span className="mono" style={{ fontSize: "0.7rem", color: "var(--mist-2)" }}>
            the protocol maximum was redeemed; the remainder is below the redemption minimum and disclosed{liveBalance ? ` · live: ${liveBalance} FXRP` : ""}
          </span>
        </div>
      </section>

      {/* ── the seven-chapter player ───────────────────────────────────── */}
      <section id="story" style={{ padding: "26px 0" }} ref={playerRef}>
        <div className="card" style={{ padding: 0, overflow: "hidden", borderColor: ch.ember ? "color-mix(in srgb, var(--ember) 35%, transparent)" : undefined }}>
          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "290px 1fr" }}>
            <div style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, borderRight: "1px solid var(--line)" }}>
              <PulseDial size={210} lastAliveTs={now - Math.floor(3600 * ch.dial.frac)} deadlineTs={now + Math.ceil(3600 * (1 - ch.dial.frac))}
                state={ch.dial.state} label={ch.dial.label} />
              <span className="mono" style={{ fontSize: "0.66rem", color: "var(--mist-2)" }}>chapter {ch.n} of 7</span>
            </div>
            <div style={{ padding: "26px 30px" }}>
              <div style={{ marginBottom: 18 }}>
                <NodeStepper size={34} items={CHAPTERS.map((c, i) => ({
                  icon: CHAPTER_ICON[c.id],
                  label: CHAPTER_SHORT[c.id],
                  state: (i === idx ? "active" : c.ember ? "fail" : "done") as "active" | "fail" | "done",
                  onClick: () => go(i),
                }))} />
              </div>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.45rem", marginBottom: 10 }}>
                <span style={{ color: accent }}>{ch.n}</span> — {ch.title}
              </h3>

              <div style={{ display: "grid", gap: 10, fontSize: "0.92rem" }}>
                <p><span className="mono" style={{ fontSize: "0.64rem", color: "var(--mist-2)", marginRight: 8 }}>WHAT HAPPENED</span>{ch.actor}</p>
                <p style={{ color: "var(--mist)" }}><span className="mono" style={{ fontSize: "0.64rem", color: "var(--mist-2)", marginRight: 8 }}>WHY IT MATTERS</span>{ch.tech}</p>
                <p style={{ color: accent, fontSize: "0.88rem" }}>→ {ch.result}</p>
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 7 }}>
                {ch.evidence.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: "0.78rem", flexWrap: "wrap" }}>
                    <span className="pill" style={{ fontSize: "0.6rem", padding: "2px 8px", color: e.chain === "XRPL" ? "var(--verdant)" : e.chain === "Flare" ? "var(--lamplight)" : "var(--mist-2)" }}>{e.chain === "Rule" ? "contract rule" : e.chain}</span>
                    <span style={{ color: "var(--mist)" }}>{e.label}</span>
                    {e.hash && <CopyBtn text={e.hash} />}
                    {e.url && <a className="mono" style={{ fontSize: "0.7rem" }} href={e.url} target="_blank" rel="noreferrer">open explorer ↗</a>}
                    {e.extra && <span className="mono" style={{ fontSize: "0.62rem", color: "var(--mist-2)" }}>{e.extra}</span>}
                  </div>
                ))}
                {ch.id === "early-claim" && (
                  <Link to={`/claim/${m.vault}`} style={{ fontSize: "0.78rem" }}>run this drill yourself on the claim page →</Link>
                )}
              </div>

              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", color: "var(--mist-2)", fontSize: "0.74rem" }}>Raw technical details</summary>
                <p className="mono" style={{ fontSize: "0.7rem", color: "var(--mist)", marginTop: 8, lineHeight: 1.6 }}>{ch.raw}</p>
              </details>

              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: "0.8rem" }} onClick={() => go(idx - 1)}>← Back</button>
                <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: "0.8rem" }} onClick={() => go(idx + 1)}>Next →</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── dual-ledger rail ───────────────────────────────────────────── */}
      <section style={{ padding: "16px 0" }} id="audit">
        <div className="eyebrow">Two ledgers, one plan</div>
        <h2 style={{ margin: "10px 0 4px", fontSize: "1.5rem" }}>The transaction rail</h2>
        <p style={{ fontSize: "0.88rem", marginBottom: 16, maxWidth: 640 }}>
          Users act on XRPL. Flare proves the facts and enforces the rules. Click any node — its counterpart
          on the other ledger lights up.
        </p>
        <div style={{ display: "grid", gap: 14 }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <h3>XRPL Ledger</h3><span className="mono" style={{ fontSize: "0.64rem", color: "var(--mist-2)" }}>people & payments</span>
            </div>
            <NodeStepper size={38} items={[
              { icon: "⇄", label: "Funding", sub: "payment", state: "done", onClick: () => window.open(xrplTx(m.fundingTxXrpl), "_blank") },
              { icon: "♥", label: "Heartbeat", sub: "payment", state: "done", onClick: () => window.open(xrplTx(m.heartbeatTxXrpl), "_blank") },
              { label: "(Copycat)", sub: "ignored", state: "fail" },
              { icon: "✓", label: "Payout", sub: "to Maya", state: "done", onClick: m.settlement?.hash ? () => window.open(xrplTx(m.settlement!.hash), "_blank") : undefined },
            ]} />
          </div>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <h3>Flare Ledger</h3><span className="mono" style={{ fontSize: "0.64rem", color: "var(--mist-2)" }}>proofs & execution</span>
            </div>
            <NodeStepper size={38} items={[
              { icon: "▢", label: "Vault", sub: "created", state: "done", onClick: m.createdTxFlare ? () => window.open(flareTx(m.createdTxFlare), "_blank") : undefined },
              { icon: "◈", label: "FXRP", sub: "minted", state: "done", onClick: m.mintTxFlare ? () => window.open(flareTx(m.mintTxFlare), "_blank") : undefined },
              { icon: "♥", label: "Heartbeat", sub: "recorded", state: "done", onClick: m.heartbeatTxFlare ? () => window.open(flareTx(m.heartbeatTxFlare), "_blank") : undefined },
              { label: "Early claim", sub: "rejected", state: "fail" },
              { icon: "◎", label: "Silence", sub: "proven", state: "done", onClick: m.silenceTxFlare ? () => window.open(flareTx(m.silenceTxFlare), "_blank") : undefined },
              { icon: "⏳", label: "Claim", sub: "started", state: "done", onClick: m.claimStartTxFlare ? () => window.open(flareTx(m.claimStartTxFlare), "_blank") : undefined },
              { icon: "⇄", label: "Release", sub: "executed", state: "done", onClick: m.releaseTxFlare ? () => window.open(flareTx(m.releaseTxFlare), "_blank") : undefined },
            ]} />
          </div>
          <p className="mono" style={{ fontSize: "0.64rem", color: "var(--mist-2)" }}>
            click any node to open its transaction · user action → network proof → contract effect → user result
          </p>
        </div>
      </section>

      {/* ── the two attacks ────────────────────────────────────────────── */}
      <section id="attacks" style={{ padding: "18px 0" }}>
        <div className="eyebrow">The conflicts in the story</div>
        <h2 style={{ margin: "10px 0 14px", fontSize: "1.5rem" }}>Two attacks, survived</h2>
        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div className="card" style={{ borderColor: "color-mix(in srgb, var(--ember) 35%, transparent)" }}>
            <h3 style={{ marginBottom: 10 }}>A copied heartbeat did not keep the owner "alive."</h3>
            <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
              <tbody>
                {[["Attacker action", "sent the same 1-drop payment with the identical reference memo, from their own address"],
                  ["Why it failed", "the silence proof is source-filtered — only the configured owner address counts"],
                  ["Effect on the vault", "none"],
                  ["Result", "attacker payment invisible to the proof"]].map(([k, val]) => (
                  <tr key={k} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 10px 8px 0", color: "var(--mist-2)", whiteSpace: "nowrap", verticalAlign: "top" }} className="mono">{k}</td>
                    <td style={{ padding: "8px 0", color: "var(--mist)" }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mono" style={{ fontSize: "0.66rem", color: "var(--mist-2)", marginTop: 10 }}>
              on-chain experiment: with copies only + source filter → proof VALID (round 1398559); with the
              real owner heartbeat present → INVALID. reproducible: spike/gate1b-rpn.mjs
            </p>
          </div>
          <div className="card" style={{ borderColor: "color-mix(in srgb, var(--ember) 35%, transparent)" }}>
            <h3 style={{ marginBottom: 10 }}>The beneficiary could not release early.</h3>
            <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
              <tbody>
                {[["Attempted", "release 7 seconds before the challenge window ended (recorded production run)"],
                  ["Contract result", "ChallengeNotOver — reverted"],
                  ["Funds moved", "0 XRP"],
                  ["Result", "owner protection preserved to the last second"]].map(([k, val]) => (
                  <tr key={k} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 10px 8px 0", color: "var(--mist-2)", whiteSpace: "nowrap", verticalAlign: "top" }} className="mono">{k}</td>
                    <td style={{ padding: "8px 0", color: "var(--mist)" }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: "0.78rem", marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link to={`/claim/${m.vault}`}>run the drill yourself →</Link>
              <a className="mono" style={{ fontSize: "0.7rem" }} href={`${CONFIG.github}/blob/main/contracts/contracts/HeirloomVault.sol`} target="_blank" rel="noreferrer">guard source ↗</a>
            </p>
          </div>
        </div>
      </section>

      {/* ── final payout receipt ───────────────────────────────────────── */}
      <section id="receipt" style={{ padding: "18px 0" }}>
        <div className="card" style={{ borderColor: "color-mix(in srgb, var(--verdant) 50%, transparent)", padding: 30 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
            <h2 style={{ fontSize: "1.5rem" }}>Final payout receipt</h2>
            <span className="pill" style={{ color: checksAllPass ? "var(--verdant)" : "var(--lamplight)", borderColor: "currentColor" }}>
              {m.verdict}
            </span>
          </div>
          <p style={{ fontSize: "0.9rem", margin: "10px 0 16px", maxWidth: 640 }}>
            The plan settled. Native XRP arrived at the configured beneficiary wallet; every number below is
            reconciled against the chain — to the drop, residual included.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "0.84rem", borderCollapse: "collapse" }}>
              <tbody>
                {([
                  ["Plan", "Case 001 (canonical demo lifecycle)"],
                  ["Vault", m.vault],
                  ["Protected FXRP", `${m.protectedFxrp} FXRP`],
                  ["Redeemed", m.redemption ? `${(Number(m.redemption.valueUBA) / 1e6).toFixed(2)} FXRP (request #${m.redemption.requestId})` : "—"],
                  ["Redemption fee (protocol)", m.redemption ? `${(Number(m.redemption.feeUBA) / 1e6).toFixed(2)} FXRP` : "—"],
                  ["Payment reference", m.redemption ? m.redemption.paymentReference : "—"],
                  ["XRP received", `${m.payoutXrp} XRP → ${m.settlement?.destination ?? "beneficiary wallet"}`],
                  ["Settlement transaction", m.settlement?.hash ?? "—"],
                  ["Release transaction", m.releaseTxFlare ?? "—"],
                  ["Silence proof round", String(m.silenceRound ?? "—")],
                  ["Challenge completed", m.challenge ? new Date(m.challenge.endedAt * 1000).toLocaleString() : "—"],
                  ["Final FXRP balance", `${m.finalFxrpBalance} FXRP${residual ? " (below one lot — disclosed, not hidden)" : ""}`],
                  ["Final vault state", m.finalState === 5 ? "Released" : String(m.finalState)],
                ] as [string, string][]).map(([k, val]) => (
                  <tr key={k} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "9px 12px 9px 0", color: "var(--mist-2)", whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
                    <td className="mono" style={{ padding: "9px 0", wordBreak: "break-all", color: "var(--paper)" }}>
                      {val}
                      {k === "Settlement transaction" && m.settlement?.hash && (
                        <> <a href={xrplTx(m.settlement.hash)} target="_blank" rel="noreferrer">↗</a></>
                      )}
                      {k === "Release transaction" && m.releaseTxFlare && (
                        <> <a href={flareTx(m.releaseTxFlare)} target="_blank" rel="noreferrer">↗</a></>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 6 }}>
            {m.integrityChecks.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: "0.8rem" }}>
                <span className="mono" style={{ color: c.passed ? "var(--verdant)" : "var(--ember)" }}>{c.passed ? "✓" : "✗"}</span>
                <span style={{ color: "var(--mist)" }}>{c.label}</span>
              </div>
            ))}
            <p className="mono" style={{ fontSize: "0.64rem", color: "var(--mist-2)", marginTop: 6 }}>
              checks generated from chain + XRPL data by spike/build-case.mjs · built {m.builtAt.slice(0, 16).replace("T", " ")} UTC
            </p>
          </div>
        </div>
      </section>

      {/* ── full chronological log ─────────────────────────────────────── */}
      <section id="evidence" style={{ padding: "10px 0" }}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <h3>Full chronological evidence log</h3>
            <span className="mono" style={{ fontSize: "0.68rem", color: "var(--mist-2)" }}>oldest first · every entry is public</span>
          </div>
          <EvidenceTimeline events={events} journey />
        </div>
      </section>

      <section style={{ padding: "26px 0", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", color: "var(--paper)", marginBottom: 18 }}>
          The promise completed — <em style={{ color: "var(--lamplight)" }}>and every step is public.</em>
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link className="btn btn-primary" to="/create">Create your own test plan</Link>
          <Link className="btn btn-ghost" to={`/vault/${m.vault}`}>Open the plan page</Link>
          <Link className="btn btn-ghost" to={`/kit/${m.vault}`}>See its Recovery Kit</Link>
        </div>
      </section>
        </div>
      </div>
    </main>
  );
}
