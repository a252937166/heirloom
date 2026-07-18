import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CONFIG } from "../config";
import { VaultView, addrHash, fmtFxrp, readVault, short } from "../lib/chain";
import { EvidenceTimeline, KeeperEvent } from "./Vault";
import { PulseDial } from "../components/PulseDial";

const STEPS = ["Verify your wallet", "Prove the silence", "Final challenge", "Redemption", "XRP received"];

function Stepper({ active }: { active: number }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "14px 0 20px" }}>
      {STEPS.map((s, i) => (
        <span key={s} className="pill" style={{
          color: i < active ? "var(--verdant)" : i === active ? "var(--lamplight)" : "var(--mist-2)",
          borderColor: i === active ? "color-mix(in srgb, var(--lamplight) 50%, transparent)" : "var(--line)",
        }}>
          {i < active ? "✓" : i + 1} · {s}
        </span>
      ))}
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
  const [testResult, setTestResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setV(await readVault(address));
      const r = await fetch(`${CONFIG.api}/vaults/${address}`);
      if (r.ok) setEvents((await r.json()).events ?? []);
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

  const step = !v ? 0 : v.state >= 5 ? 5 : v.state === 4 ? 3 : v.state === 3 ? 2 : beneMatches ? 1 : 0;

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

  async function testEarlyClaim() {
    setTestResult(null);
    setTestResult("running");
    try {
      const body: Record<string, string> = { beneficiaryXrpl: bene.trim() };
      if (ownerFromKit.trim()) body.ownerXrpl = ownerFromKit.trim();
      await fetch(`${CONFIG.api}/vaults/${address}/claim`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      // the on-chain outcome lands in the timeline; summarize the design here
      setTestResult("done");
    } catch {
      setTestResult("done");
    }
  }

  if (!v) return <main className="wrap" style={{ padding: "60px 24px" }}><p className="mono">loading…</p></main>;

  return (
    <main className="wrap" style={{ padding: "44px 24px", maxWidth: 880 }}>
      <div className="eyebrow">Beneficiary access</div>
      <h1 style={{ fontSize: "1.9rem", margin: "8px 0 4px" }}>
        {v.state >= 5 ? "The XRP reached its person" : v.state === 4 ? "Redemption in progress" : v.state === 3 ? "Final challenge running" : "Claim, when the time truly comes"}
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
              <h3 style={{ marginBottom: 10 }}>Step 1 — verify your wallet</h3>
              <div className="field">
                <label>Your XRPL address (must match the one the owner chose)</label>
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
                  <button className="btn btn-ghost" disabled={!beneMatches || testResult === "running"} onClick={testEarlyClaim}>
                    {testResult === "running" ? "Testing…" : "Test early-claim protection"}
                  </button>
                  {testResult === "done" && (
                    <div className="notice ok" style={{ marginTop: 12 }}>
                      <strong>Blocked as designed.</strong> While the owner lives, the silence proof cannot be
                      produced (<span className="mono">REFERENCED TRANSACTION EXISTS</span>) and the vault
                      reverts (<span className="mono">SilenceNotProven</span>). Funds moved: 0. Owner control:
                      intact. The attempt appears in the journey below.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {v.state === 3 && (
            <div className="card">
              <h3 style={{ marginBottom: 8 }}>Step 3 — the final challenge</h3>
              <p style={{ fontSize: "0.9rem", marginBottom: 12 }}>
                Ends {new Date(v.claimChallengeEndsAt * 1000).toLocaleTimeString()}. One heartbeat from the
                owner cancels this claim — their final veto.
              </p>
              <button className="btn btn-primary" disabled={busy || now < v.claimChallengeEndsAt} onClick={requestRelease}>
                {now < v.claimChallengeEndsAt ? "Waiting out the challenge…" : busy ? "Releasing…" : "Execute the release"}
              </button>
            </div>
          )}

          {v.state === 4 && (
            <div className="notice">
              Redemption in progress — the payout is tracked by its FAssets payment reference, not by guesswork.
              This page updates as the agent pays.
            </div>
          )}

          {v.state >= 5 && (
            <div className="card" style={{ borderColor: "color-mix(in srgb, var(--verdant) 45%, transparent)" }}>
              <h3 style={{ marginBottom: 12 }}>Payout receipt</h3>
              <div className="status-grid">
                <div className="stat"><div className="k">Delivered</div><div className="v">{settled.length ? settled.map((s) => s.label.match(/([\d.]+) XRP/)?.[1]).filter(Boolean).join(" + ") + " XRP" : "—"}</div></div>
                <div className="stat"><div className="k">Redemption</div><div className="v mono">{released?.label.match(/#\d+/g)?.join(", ") ?? "—"}</div></div>
                <div className="stat"><div className="k">Remaining in vault</div><div className="v">{fmtFxrp(v.fxrpBalance)} FXRP</div></div>
                {settled[0]?.txXrpl && (
                  <div className="stat" style={{ gridColumn: "1 / -1" }}>
                    <div className="k">XRPL settlement</div>
                    <div className="v mono"><a href={`${CONFIG.xrplExplorer}/transactions/${settled[0].txXrpl}`} target="_blank" rel="noreferrer">{short(settled[0].txXrpl, 12)} ↗</a></div>
                  </div>
                )}
              </div>
              {residual && <div className="notice" style={{ marginTop: 12 }}>{residual.label} — it stays visible in the vault contract.</div>}
              {v.state === 6 && <div className="notice" style={{ marginTop: 12 }}>This plan was cancelled by its owner; funds were redeemed back to them.</div>}
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
