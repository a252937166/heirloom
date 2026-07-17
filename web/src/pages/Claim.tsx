import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CONFIG, STATE_NAMES } from "../config";
import { VaultView, addrHash, fmtFxrp, readVault, short } from "../lib/chain";
import { EvidenceTimeline, KeeperEvent } from "./Vault";
import { PulseDial } from "../components/PulseDial";

export function Claim() {
  const { address = "" } = useParams();
  const [v, setV] = useState<VaultView | null>(null);
  const [events, setEvents] = useState<KeeperEvent[]>([]);
  const [bene, setBene] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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

  if (!v) return <main className="wrap" style={{ padding: "60px 24px" }}><p className="mono">loading…</p></main>;

  const now = Math.floor(Date.now() / 1000);
  const beneMatches = bene && addrHash(bene.trim()) === v.beneficiaryXrplHash;
  const silenceReady = v.silenceProvenThroughTs >= v.silenceDeadline && v.state === 2;
  const deadlinePassed = now > v.silenceDeadline;

  async function requestClaim() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch(`${CONFIG.api}/vaults/${address}/claim`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beneficiaryXrpl: bene.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      setNote("Silence is being proven to Flare (2–4 minutes). If the network agrees you may claim, the challenge window opens.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); await refresh(); }
  }
  async function requestRelease() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch(`${CONFIG.api}/vaults/${address}/release`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      setNote("Release executed. The FAssets redemption pays real XRP to the beneficiary's wallet — watch the timeline.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); await refresh(); }
  }

  return (
    <main className="wrap" style={{ padding: "48px 24px", maxWidth: 860 }}>
      <div className="eyebrow">Beneficiary access</div>
      <h1 style={{ fontSize: "1.9rem", margin: "8px 0 6px" }}>Vault <span className="mono" style={{ fontSize: "1.2rem" }}>{short(address, 10)}</span></h1>
      <p style={{ fontSize: "0.95rem", maxWidth: 620 }}>
        This page can release funds only when Flare's network has proven the owner's silence, and only after the
        safety challenge. Nothing here can rush that — and that is the point.
      </p>

      {err && <div className="notice err" style={{ margin: "14px 0" }}>{err}</div>}
      {note && <div className="notice ok" style={{ margin: "14px 0" }}>{note}</div>}

      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 30, marginTop: 24, alignItems: "start" }}>
        <PulseDial size={220} lastAliveTs={v.lastHeartbeatTs} deadlineTs={v.state === 3 ? v.claimChallengeEndsAt : v.silenceDeadline} state={v.state}
          label={v.state === 3 ? "challenge window" : undefined} />
        <div>
          <div className="status-grid" style={{ marginBottom: 18 }}>
            <div className="stat"><div className="k">Status</div><div className="v">{STATE_NAMES[v.state]}</div></div>
            <div className="stat"><div className="k">Protected</div><div className="v">{fmtFxrp(v.fxrpBalance)} FXRP</div></div>
            <div className="stat"><div className="k">Silence deadline</div><div className="v">{new Date(v.silenceDeadline * 1000).toLocaleTimeString()}</div></div>
          </div>

          {v.state === 2 && (
            <div className="card">
              <h3 style={{ marginBottom: 10 }}>Start a claim</h3>
              <div className="field">
                <label>Your XRPL address (must match the one the owner chose)</label>
                <input placeholder="r…" value={bene} onChange={(e) => setBene(e.target.value)} />
                {bene && !beneMatches && <span className="hint" style={{ color: "var(--ember)" }}>This address does not match the beneficiary fingerprint.</span>}
              </div>
              {!deadlinePassed ? (
                <div className="notice">
                  The owner is not past their silence deadline. A claim now would be rejected on-chain
                  (<span className="mono">SilenceNotProven</span>) — you can try, and watch it refuse.
                </div>
              ) : null}
              <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={!beneMatches || busy} onClick={requestClaim}>
                {busy ? "Proving silence…" : silenceReady ? "Start claim" : "Request silence proof & claim"}
              </button>
            </div>
          )}

          {v.state === 3 && (
            <div className="card">
              <h3 style={{ marginBottom: 8 }}>Challenge window open</h3>
              <p style={{ fontSize: "0.9rem", marginBottom: 12 }}>
                Ends {new Date(v.claimChallengeEndsAt * 1000).toLocaleTimeString()}. One heartbeat from the owner
                cancels this claim — their final veto.
              </p>
              <button className="btn btn-primary" disabled={busy || now < v.claimChallengeEndsAt} onClick={requestRelease}>
                {now < v.claimChallengeEndsAt ? "Waiting out the challenge…" : busy ? "Releasing…" : "Execute release"}
              </button>
            </div>
          )}

          {v.state >= 4 && (
            <div className="notice ok">
              {v.state === 4 ? "Redemption in progress — real XRP is on its way to the beneficiary's wallet." :
               v.state === 5 ? "Released. The vault has redeemed everything to the beneficiary's XRPL wallet." :
               "This vault was cancelled by its owner."}
            </div>
          )}

          <div className="card" style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 12 }}>Evidence timeline</h3>
            <EvidenceTimeline events={events} />
          </div>
        </div>
      </div>
    </main>
  );
}
