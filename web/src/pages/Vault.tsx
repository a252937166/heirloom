import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PulseDial } from "../components/PulseDial";
import { CONFIG, STATE_NAMES } from "../config";
import { VaultView, fmtFxrp, readVault, short } from "../lib/chain";
import { useWallet } from "../App";
import { payWithMemo } from "../lib/gem";

export interface KeeperEvent {
  at: number;
  kind: string;
  label: string;
  txFlare?: string;
  txXrpl?: string;
  round?: number;
  tone?: "ok" | "gold" | "warn";
}

export function EvidenceTimeline({ events }: { events: KeeperEvent[] }) {
  if (!events.length) return <p style={{ fontSize: "0.85rem" }}>No events yet — they appear as proofs land.</p>;
  return (
    <div className="timeline">
      {[...events].reverse().map((e, i) => (
        <div key={i} className={`tl-item ${e.tone ?? ""}`}>
          <div className="tl-dot">●</div>
          <div className="tl-body">
            <h3>{e.label}</h3>
            <div className="meta">
              {new Date(e.at * 1000).toLocaleString()}
              {e.round ? ` · voting round ${e.round}` : ""}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {e.txXrpl && (
                <a href={`${CONFIG.xrplExplorer}/transactions/${e.txXrpl}`} target="_blank" rel="noreferrer">
                  XRPL tx ↗
                </a>
              )}
              {e.txFlare && (
                <a href={`${CONFIG.explorer}/tx/${e.txFlare}`} target="_blank" rel="noreferrer">
                  Flare tx ↗
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Vault() {
  const { address = "" } = useParams();
  const { wallet } = useWallet();
  const [v, setV] = useState<VaultView | null>(null);
  const [events, setEvents] = useState<KeeperEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setV(await readVault(address));
      const r = await fetch(`${CONFIG.api}/vaults/${address}`);
      if (r.ok) {
        const j = await r.json();
        setEvents(j.events ?? []);
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

  async function heartbeat() {
    if (!v) return;
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const hash = await payWithMemo({
        destination: CONFIG.beacon,
        amountDrops: "1",
        memoHex: v.heartbeatReference.slice(2),
      });
      if (!hash) throw new Error("The wallet rejected the payment.");
      setNote(`Heartbeat sent (${short(hash, 8)}). The keeper is proving it to Flare — the dial resets in ~2 minutes.`);
      await fetch(`${CONFIG.api}/vaults/${address}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xrplTx: hash }),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!v)
    return (
      <main className="wrap" style={{ padding: "60px 24px" }}>
        <p className="mono">loading vault {short(address, 10)}…</p>
        {err && <div className="notice err" style={{ marginTop: 12 }}>{err}</div>}
      </main>
    );

  const stateName = STATE_NAMES[v.state] ?? String(v.state);
  const tone = v.state === 2 ? "alive" : v.state === 3 || v.state === 4 ? "warn" : "gold";

  return (
    <main className="wrap" style={{ padding: "48px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="eyebrow">Continuity vault</div>
          <h1 style={{ fontSize: "1.9rem", margin: "8px 0 4px" }}>
            <span className="mono" style={{ fontSize: "1.2rem" }}>{short(address, 10)}</span>
          </h1>
          <a className="mono" style={{ fontSize: "0.75rem" }} href={`${CONFIG.explorer}/address/${address}`} target="_blank" rel="noreferrer">
            view on explorer ↗
          </a>
        </div>
        <span className={`pill ${tone}`}>● {stateName}</span>
      </div>

      {err && <div className="notice err" style={{ margin: "16px 0" }}>{err}</div>}
      {note && <div className="notice ok" style={{ margin: "16px 0" }}>{note}</div>}

      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 36, marginTop: 30, alignItems: "start" }}>
        <div style={{ textAlign: "center" }}>
          <PulseDial lastAliveTs={v.lastHeartbeatTs} deadlineTs={v.state === 3 ? v.claimChallengeEndsAt : v.silenceDeadline} state={v.state}
            label={v.state === 1 ? "waiting for funding" : v.state === 3 ? "challenge — one heartbeat vetoes" : undefined} />
          {v.state <= 3 && (
            <div style={{ marginTop: 18 }}>
              <button className="btn btn-primary" disabled={busy || !wallet.address} onClick={heartbeat}>
                {busy ? "Confirm in wallet…" : "I'm here — send heartbeat"}
              </button>
              {!wallet.address && (
                <p className="hint" style={{ fontSize: "0.75rem", marginTop: 8, color: "var(--mist-2)" }}>
                  Connect GemWallet, or send 1 drop to the beacon with your reference memo from any wallet.
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="status-grid">
            <div className="stat"><div className="k">Protected</div><div className="v">{fmtFxrp(v.fxrpBalance)} FXRP</div></div>
            <div className="stat"><div className="k">Heartbeats proven</div><div className="v">{v.heartbeatEpoch}</div></div>
            <div className="stat"><div className="k">Silence proven through</div><div className="v">{v.silenceProvenThroughTs ? new Date(v.silenceProvenThroughTs * 1000).toLocaleTimeString() : "—"}</div></div>
            <div className="stat"><div className="k">Inactivity window</div><div className="v">{Math.round(v.heartbeatPeriod / 60)}m + {Math.round(v.gracePeriod / 60)}m grace</div></div>
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3>Evidence timeline</h3>
              <span className="mono" style={{ fontSize: "0.68rem", color: "var(--mist-2)" }}>every entry is a public transaction</span>
            </div>
            <EvidenceTimeline events={events} />
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
            <Link className="btn btn-ghost" to={`/kit/${address}`}>Recovery Kit (print)</Link>
            <Link className="btn btn-ghost" to={`/claim/${address}`}>Beneficiary view</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
