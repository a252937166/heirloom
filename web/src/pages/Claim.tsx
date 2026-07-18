import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CONFIG } from "../config";
import { VaultView, addrHash, fmtFxrp, readVault, short } from "../lib/chain";
import { Receipt, deriveSettlement } from "../lib/settlement";
import { EvidenceTimeline, KeeperEvent } from "./Vault";
import { PulseDial } from "../components/PulseDial";
import { CopyBtn } from "../components/CopyBtn";
import { NodeStepper } from "../components/NodeStepper";

const STEPS = ["Confirm beneficiary address", "Prove the silence", "Final challenge", "Redemption", "XRP received"];

interface DrillResult {
  blocked: boolean;
  stage: string;
  reason: string;
  detail?: string;
  fundsMoved: string;
}

const STEP_SHORT = ["Verify", "Proof", "Challenge", "Release", "Complete"];
function Stepper({ active }: { active: number }) {
  return (
    <div style={{ margin: "18px 0 22px", maxWidth: 600 }}>
      <NodeStepper size={30} items={STEP_SHORT.map((label, i) => ({
        icon: i < active ? undefined : String(i + 1),
        label,
        state: (i < active ? "done" : i === active ? "active" : "todo") as "done" | "active" | "todo",
      }))} />
    </div>
  );
}

export function Claim() {
  const { address = "" } = useParams();
  const [v, setV] = useState<VaultView | null>(null);
  const [events, setEvents] = useState<KeeperEvent[]>([]);
  const [bene, setBene] = useState("");
  const [ownerFromKit, setOwnerFromKit] = useState("");
  const [needOwner, setNeedOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillResult | "running" | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const refresh = useCallback(async () => {
    try {
      setV(await readVault(address));
      const r = await fetch(`${CONFIG.api}/vaults/${address}`);
      if (r.ok) {
        const j = await r.json();
        setEvents(j.events ?? []);
        if (j.receipt) setReceipt(j.receipt);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [address]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 12_000);
    return () => clearInterval(t);
  }, [refresh]);

  const now = Math.floor(Date.now() / 1000);
  const beneMatches = !!bene && !!v && addrHash(bene.trim()) === v.beneficiaryXrplHash;
  const deadlinePassed = !!v && now > v.silenceDeadline;
  const settled = useMemo(() => events.filter((e) => e.kind === "settled"), [events]);
  const residual = useMemo(() => events.find((e) => e.kind === "residual"), [events]);
  const released = useMemo(() => events.find((e) => e.kind === "released"), [events]);
  // Released means the redemption was REQUESTED; "delivered" is claimed only
  // once a settlement matching the payment reference exists
  const sett = deriveSettlement(receipt, events);

  const step = !v ? 0 : v.state === 5 ? 5 : v.state === 4 ? 3 : v.state === 3 ? 2 : v.state >= 6 ? 0 : beneMatches ? 1 : 0;

  async function requestClaim() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const body: Record<string, string> = { beneficiaryXrpl: bene.trim() };
      if (ownerFromKit.trim()) body.ownerXrpl = ownerFromKit.trim();
      const r = await fetch(`${CONFIG.api}/vaults/${address}/claim`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text();
        if (/ownerXrpl required/i.test(t)) { setNeedOwner(true); throw new Error("This keeper has no record of the owner's address — enter it from the Recovery Kit below."); }
        throw new Error(t);
      }
      setNote("Silence is being proven to Flare (2–4 minutes). If the network agrees, the challenge window opens.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); await refresh(); }
  }

  async function requestRelease() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch(`${CONFIG.api}/vaults/${address}/release`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      setNote("Release executed — the redemption is being tracked by its payment reference.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); await refresh(); }
  }

  // permissionless redemption-default: if the agent misses its underlying
  // window, a non-payment proof secures protocol collateral to the vault
  async function requestDefault() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch(`${CONFIG.api}/vaults/${address}/redemption-default`, { method: "POST" });
      const text = await r.text();
      if (!r.ok) throw new Error(text);
      let j: { eligible?: boolean; reason?: string } | null = null;
      try { j = JSON.parse(text); } catch { /* plain ack */ }
      setNote(j?.eligible === false
        ? `Not yet available: ${j.reason ?? "the agent's payment window is still open"}.`
        : "Default check started — the outcome (defaulted, or 'agent window still open') appears in the journey below.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); await refresh(); }
  }

  // the drill runs a staticCall server-side and reports CHAIN truth —
  // "blocked as designed" is only ever shown when the contract actually refused
  async function testEarlyClaim() {
    setDrill("running");
    try {
      const r = await fetch(`${CONFIG.api}/vaults/${address}/simulate-early-claim`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beneficiaryXrpl: bene.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      setDrill(await r.json());
    } catch (e) {
      setDrill(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally { await refresh(); }
  }

  if (!v) return <main className="wrap" style={{ padding: "60px 24px" }}><p className="mono">loading…</p></main>;

  return (
    <main className="wrap" style={{ padding: "44px 24px", maxWidth: 880 }}>
      <div className="eyebrow">Beneficiary access</div>
      <h1 style={{ fontSize: "1.9rem", margin: "8px 0 4px" }}>
        {v.state === 5 ? (sett.payoutConfirmed ? "The XRP reached its person" : "Redemption requested — XRP on its way") : v.state >= 6 ? "This plan was cancelled by its owner" : v.state === 4 ? "Redemption in progress" : v.state === 3 ? "Final challenge running" : "Claim, when the time truly comes"}
      </h1>
      <p style={{ fontSize: "0.92rem", maxWidth: 620 }}>
        Nothing on this page can rush the plan: funds move only after Flare's network proves the owner's
        silence and the final challenge passes unvetoed. That is the point.
      </p>
      <Stepper active={step} />

      {err && <div className="notice err" style={{ margin: "12px 0" }}>{err}</div>}
      {note && <div className="notice ok" style={{ margin: "12px 0" }}>{note}</div>}

      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 30, alignItems: "start" }}>
        <PulseDial size={210} lastAliveTs={v.lastHeartbeatTs} deadlineTs={v.state === 3 ? v.claimChallengeEndsAt : v.silenceDeadline} state={v.state}
          label={v.state === 3 ? "challenge window" : undefined} />
        <div>
          {v.state === 2 && (
            <div className="card">
              <h3 style={{ marginBottom: 10 }}>Step 1 — confirm the beneficiary address</h3>
              <div className="field">
                <label>Your XRPL address (must match the one the owner chose — no signature needed here)</label>
                <input placeholder="r…" value={bene} onChange={(e) => setBene(e.target.value)} />
                {bene && !beneMatches && <span className="hint" style={{ color: "var(--ember)" }}>This address does not match the beneficiary fingerprint.</span>}
                {beneMatches && <span className="hint" style={{ color: "var(--verdant)" }}>✓ matches the plan's beneficiary</span>}
              </div>
              {needOwner && (
                <div className="field">
                  <label>Owner's XRPL address — printed on your Recovery Kit</label>
                  <input placeholder="r…" value={ownerFromKit} onChange={(e) => setOwnerFromKit(e.target.value)} />
                  <span className="hint">Needed to build the source-filtered silence proof if the keeper lost its records.</span>
                </div>
              )}

              {deadlinePassed ? (
                <button className="btn btn-primary" disabled={!beneMatches || busy} onClick={requestClaim}>
                  {busy ? "Proving silence…" : "Start the claim"}
                </button>
              ) : (
                <>
                  <div className="notice" style={{ marginBottom: 12 }}>
                    The owner is still inside their window — a real claim is not available until{" "}
                    {new Date(v.silenceDeadline * 1000).toLocaleTimeString()}.
                  </div>
                  <button className="btn btn-ghost" disabled={!beneMatches || drill === "running"} onClick={testEarlyClaim}>
                    {drill === "running" ? "Asking the contract…" : "Test early-claim protection"}
                  </button>
                  {drill && drill !== "running" && drill.blocked && (
                    <div className="notice ok" style={{ marginTop: 12 }}>
                      <strong>Blocked on-chain.</strong> The contract refused with{" "}
                      <span className="mono">{drill.reason}</span>
                      {drill.detail ? <> — {drill.detail}</> : null}. Funds moved: {drill.fundsMoved}. Owner
                      control: intact. This was a real <span className="mono">staticCall</span> against the
                      vault — not an assumption; the drill appears in the journey below.
                    </div>
                  )}
                  {drill && drill !== "running" && !drill.blocked && (
                    <div className="notice" style={{ marginTop: 12 }}>
                      <strong>The inactivity window has already elapsed</strong> — the contract would accept a
                      claim now (nothing was executed). If this is a rehearsal, ask the owner to send a
                      heartbeat first, then run the drill again.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {v.state === 3 && (() => {
            const eligibleAt = v.claimChallengeEndsAt + v.vetoProofGrace;
            return (
              <div className="card">
                <h3 style={{ marginBottom: 8 }}>Step 3 — the final challenge</h3>
                <div className="kv" style={{ marginBottom: 12 }}>
                  <div className="kv-row"><span className="k">Owner heartbeat deadline</span><span className="v">{new Date(v.claimChallengeEndsAt * 1000).toLocaleTimeString()}</span></div>
                  <div className="kv-row"><span className="k">Proof settlement buffer</span><span className="v">{v.vetoProofGrace}s — a pre-deadline heartbeat proof may still land</span></div>
                  <div className="kv-row"><span className="k">Earliest release</span><span className="v">{new Date(eligibleAt * 1000).toLocaleTimeString()}</span></div>
                </div>
                <p style={{ fontSize: "0.85rem", marginBottom: 12 }}>
                  One heartbeat <em>sent</em> before the deadline cancels this claim — even if its proof
                  arrives during the buffer. The XRPL timestamp decides, not transaction ordering.
                </p>
                <button className="btn btn-primary" disabled={busy || now < eligibleAt} onClick={requestRelease}>
                  {now < eligibleAt ? "Waiting out the challenge + proof buffer…" : busy ? "Releasing…" : "Execute the release"}
                </button>
              </div>
            );
          })()}

          {v.state === 4 && (
            <div className="notice">
              Redemption in progress — the payout is tracked by its FAssets payment reference, not by guesswork.
              This page updates as the agent pays.
            </div>
          )}

          {v.state === 5 && (receipt?.settlements.length || settled.length) ? (
            <div className="card" style={{ textAlign: "center", borderColor: "color-mix(in srgb, var(--verdant) 40%, transparent)", marginBottom: 18, position: "relative", overflow: "hidden" }}>
              {["8%", "22%", "38%", "55%", "70%", "85%", "14%", "62%"].map((left, i) => (
                <span key={i} className="confetti" style={{ position: "absolute", top: -12, left, width: 5, height: 9, borderRadius: 2, background: ["var(--verdant)", "var(--lamplight)", "var(--violet)", "var(--ember)"][i % 4], animationDelay: `${i * 0.35}s`, animationDuration: `${2.4 + (i % 3) * 0.5}s` }} />
              ))}
              <span className="pop-in" style={{ display: "inline-grid", placeItems: "center", width: 74, height: 74, borderRadius: "50%", background: "color-mix(in srgb, var(--verdant) 16%, transparent)", border: "2px solid var(--verdant)", color: "var(--verdant)", fontSize: "2rem", fontWeight: 700, margin: "6px 0 12px", boxShadow: "0 0 40px color-mix(in srgb, var(--verdant) 35%, transparent)" }}>✓</span>
              <h2 style={{ marginBottom: 4 }}>XRP delivered!</h2>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "2.6rem", color: "var(--paper)", letterSpacing: "-0.02em" }}>
                {receipt?.settlements.length
                  ? receipt.settlements.map((s) => (Number(s.deliveredDrops) / 1e6).toFixed(2)).join(" + ")
                  : settled.map((s) => s.label.match(/([\d.]+) XRP/)?.[1]).filter(Boolean).join(" + ")} XRP
              </div>
              <p style={{ fontSize: "0.85rem", marginTop: 4 }}>has been sent to the beneficiary's own wallet</p>
              {(receipt?.settlements[0]?.txXrpl ?? settled[0]?.txXrpl) && (
                <>
                  <p className="mono" style={{ fontSize: "0.7rem", color: "var(--mist-2)", margin: "12px 0 4px" }}>
                    settlement tx {short((receipt?.settlements[0]?.txXrpl ?? settled[0]?.txXrpl) as string, 10)}
                  </p>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 10 }}>
                    <a className="btn btn-violet" style={{ padding: "9px 18px", fontSize: "0.85rem" }} target="_blank" rel="noreferrer"
                      href={`${CONFIG.xrplExplorer}/transactions/${receipt?.settlements[0]?.txXrpl ?? settled[0]?.txXrpl}`}>
                      View on XRPL Explorer
                    </a>
                    <button className="btn btn-ghost" style={{ padding: "9px 18px", fontSize: "0.85rem" }}
                      onClick={() => {
                        const blob = new Blob([JSON.stringify({ vault: address, receipt, events }, null, 2)], { type: "application/json" });
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `heirloom-receipt-${address.slice(2, 10)}.json`;
                        a.click();
                      }}>
                      ⇩ Download receipt
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
          {v.state === 5 && !sett.payoutConfirmed && (
            <div className="card" style={{ marginBottom: 18 }}>
              <h3 style={{ marginBottom: 8 }}>Redemption requested — awaiting the XRP payment</h3>
              <p style={{ fontSize: "0.88rem", marginBottom: 10 }}>
                The FAssets agent has a bounded underlying-payment window to deliver native XRP. Delivery is
                matched by the redemption's payment reference — this page updates the moment it lands.
              </p>
              {sett.awaiting.length > 0 && (
                <>
                  <div className="kv" style={{ marginBottom: 12 }}>
                    {sett.awaiting.map((ref) => (
                      <div className="kv-row" key={ref}>
                        <span className="k">Awaiting reference</span>
                        <span className="v mono" style={{ display: "flex", gap: 8, alignItems: "center" }}>{short(ref, 14)} <CopyBtn text={ref} /></span>
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-warn" disabled={busy} onClick={requestDefault}>
                    {busy ? "Checking the agent window…" : "Recover collateral (agent missed the window)"}
                  </button>
                  <p className="hint" style={{ fontSize: "0.72rem", color: "var(--mist-2)", marginTop: 8 }}>
                    If the agent misses its underlying deadline, the FAssets default path secures collateral
                    compensation to the vault (Flare-side assets; distribution to the XRPL beneficiary is
                    roadmap — the same disclosure as the docs). One click, permissionless — nothing fires
                    automatically.
                  </p>
                </>
              )}
            </div>
          )}
          {v.state >= 6 && (
            <div className="card">
              <h3 style={{ marginBottom: 8 }}>{v.state === 7 ? "Cancelling — value returning to the owner" : "Plan cancelled by its owner"}</h3>
              <p style={{ fontSize: "0.9rem" }}>
                {v.state === 7
                  ? "The cancel redemption is settling through FAssets. No beneficiary claim is available."
                  : "The redeemable value was returned to the owner. No beneficiary claim is available."}
              </p>
            </div>
          )}
          {v.state === 5 && sett.payoutConfirmed && (
            <div className="card" style={{ borderColor: "color-mix(in srgb, var(--verdant) 45%, transparent)" }}>
              <h3 style={{ marginBottom: 12 }}>Payout receipt</h3>
              <div className="status-grid">
                <div className="stat"><div className="k">Delivered</div><div className="v">{
                  receipt?.settlements.length
                    ? receipt.settlements.map((s) => (Number(s.deliveredDrops) / 1e6).toFixed(2)).join(" + ") + " XRP"
                    : settled.length ? settled.map((s) => s.label.match(/([\d.]+) XRP/)?.[1]).filter(Boolean).join(" + ") + " XRP" : "—"
                }</div></div>
                <div className="stat"><div className="k">Redemption</div><div className="v mono">{
                  receipt?.redemptions.length
                    ? receipt.redemptions.map((r) => `#${r.requestId}`).join(", ")
                    : released?.label.match(/#\d+/g)?.join(", ") ?? "—"
                }</div></div>
                <div className="stat"><div className="k">Remaining in vault</div><div className="v">{fmtFxrp(v.fxrpBalance)} FXRP</div></div>
                {settled[0]?.txXrpl && (
                  <div className="stat" style={{ gridColumn: "1 / -1" }}>
                    <div className="k">XRPL settlement</div>
                    <div className="v mono"><a href={`${CONFIG.xrplExplorer}/transactions/${settled[0].txXrpl}`} target="_blank" rel="noreferrer">{short(settled[0].txXrpl, 12)} ↗</a></div>
                  </div>
                )}
              </div>
              {residual && <div className="notice" style={{ marginTop: 12 }}>{residual.label} — it stays visible in the vault contract.</div>}
            </div>
          )}

          <div className="card" style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 12 }}>The plan's journey</h3>
            <EvidenceTimeline events={events} journey />
          </div>
        </div>
      </div>
    </main>
  );
}
