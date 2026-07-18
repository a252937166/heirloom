import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PulseDial } from "../components/PulseDial";
import { CONFIG } from "../config";
import { VaultView, fmtFxrp, readVault, short } from "../lib/chain";
import { useWallet } from "../App";
import { payWithMemo } from "../lib/gem";
import { cancelEvmTx, friendlyEvmError, heartbeatEvmTx } from "../lib/evm";

const ZERO_EVM = "0x0000000000000000000000000000000000000000";

export interface KeeperEvent {
  at: number;
  kind: string;
  label: string;
  txFlare?: string;
  txXrpl?: string;
  round?: number;
  tone?: "ok" | "gold" | "warn";
}

export function EvidenceTimeline({ events, journey = true }: { events: KeeperEvent[]; journey?: boolean }) {
  if (!events.length) return <p style={{ fontSize: "0.85rem" }}>No events yet — they appear as proofs land.</p>;
  const list = journey ? events : [...events].reverse();
  return (
    <div className="timeline">
      {list.map((e, i) => (
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

const HEADLINES: Record<number, { title: string; sub: string }> = {
  1: { title: "Finish activating your plan", sub: "One XRPL payment away from a living plan." },
  2: { title: "Your continuity plan is active", sub: "Send a heartbeat within the window and nothing can move." },
  3: { title: "A claim has started", sub: "One heartbeat from you cancels it — this is your veto window." },
  4: { title: "XRP is being redeemed", sub: "The FAssets redemption is paying out to your beneficiary." },
  5: { title: "The plan completed", sub: "Everything was redeemed to the beneficiary's XRPL wallet." },
  6: { title: "Plan cancelled", sub: "The vault redeemed everything back to your XRPL wallet." },
};

export function Vault() {
  const { address = "" } = useParams();
  const { wallet } = useWallet();
  const [v, setV] = useState<VaultView | null>(null);
  const [events, setEvents] = useState<KeeperEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelIntent, setCancelIntent] = useState<{ beacon: string; memoHex: string } | null>(null);

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

  async function heartbeat() {
    if (!v) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      if (v.ownerEvm !== ZERO_EVM) {
        // EVM-owner plan: the check-in IS the transaction — no proof round-trip needed
        const hash = await heartbeatEvmTx(address);
        setNote(`Checked in (${short(hash, 8)}). The dial reset instantly — consensus time is the clock.`);
        fetch(`${CONFIG.api}/vaults/${address}/heartbeat`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evmTx: hash }),
        }).catch(() => {});
        await refresh();
        return;
      }
      const hash = await payWithMemo({ destination: CONFIG.beacon, amountDrops: "1", memoHex: v.heartbeatReference.slice(2) });
      if (!hash) throw new Error("The wallet rejected the payment.");
      setNote(`Heartbeat sent (${short(hash, 8)}). Flare is proving it — the dial resets in about two minutes.`);
      await fetch(`${CONFIG.api}/vaults/${address}/heartbeat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xrplTx: hash }),
      });
    } catch (e) {
      setErr(v.ownerEvm !== ZERO_EVM ? friendlyEvmError(e) : e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function openCancel() {
    setCancelOpen(true);
    if (v && v.ownerEvm !== ZERO_EVM) return; // EVM plans cancel with one wallet transaction
    if (!cancelIntent) {
      const r = await fetch(`${CONFIG.api}/vaults/${address}/cancel-intent`, { method: "POST" });
      if (r.ok) setCancelIntent(await r.json());
    }
  }

  async function cancelWithWallet() {
    setBusy(true); setErr(null);
    try {
      if (v && v.ownerEvm !== ZERO_EVM) {
        const hash = await cancelEvmTx(address);
        setNote(`Plan cancelled (${short(hash, 8)}). The vault handed all FXRP back to your wallet.`);
        setCancelOpen(false);
        await refresh();
        return;
      }
      if (!cancelIntent) return;
      const hash = await payWithMemo({ destination: cancelIntent.beacon, amountDrops: "1", memoHex: cancelIntent.memoHex });
      if (!hash) throw new Error("The wallet rejected the payment.");
      setNote(`Cancel command sent (${short(hash, 8)}). The keeper proves it, then the vault redeems everything back to you.`);
      setCancelOpen(false);
    } catch (e) {
      setErr(v && v.ownerEvm !== ZERO_EVM ? friendlyEvmError(e) : e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!v)
    return (
      <main className="wrap" style={{ padding: "60px 24px" }}>
        <p className="mono">loading plan {short(address, 10)}…</p>
        {err && <div className="notice err" style={{ marginTop: 12 }}>{err}</div>}
      </main>
    );

  const now = Math.floor(Date.now() / 1000);
  const dueSoon = v.state === 2 && v.silenceDeadline - now < v.heartbeatPeriod * 0.25;
  const head = HEADLINES[v.state] ?? { title: "Continuity plan", sub: "" };
  const tone = v.state === 2 ? (dueSoon ? "warn" : "alive") : v.state === 3 || v.state === 4 ? "warn" : "gold";
  const isEvmPlan = v.ownerEvm !== ZERO_EVM;
  const headSub = v.state === 6 && isEvmPlan ? "The vault handed all FXRP back to your connected wallet." : head.sub;

  return (
    <main className="wrap" style={{ padding: "44px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="eyebrow">Continuity plan</div>
          <h1 style={{ fontSize: "2rem", margin: "8px 0 4px" }}>{dueSoon ? "Your check-in is due" : head.title}</h1>
          <p style={{ fontSize: "0.92rem" }}>{headSub}</p>
        </div>
        <span className={`pill ${tone}`}>● {["", "Awaiting funding", dueSoon ? "Check-in due" : "Healthy", "Claim pending", "Releasing", "Released", "Cancelled"][v.state]}</span>
      </div>

      {err && <div className="notice err" style={{ margin: "16px 0" }}>{err}</div>}
      {note && <div className="notice ok" style={{ margin: "16px 0" }}>{note}</div>}

      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 36, marginTop: 26, alignItems: "start" }}>
        <div style={{ textAlign: "center" }}>
          <PulseDial lastAliveTs={v.lastHeartbeatTs} deadlineTs={v.state === 3 ? v.claimChallengeEndsAt : v.silenceDeadline} state={v.state}
            label={v.state === 1 ? "waiting for funding" : v.state === 3 ? "challenge — one heartbeat vetoes" : undefined} />
          {v.state <= 3 && (
            <div style={{ marginTop: 18, display: "grid", gap: 10, justifyItems: "center" }}>
              <button className="btn btn-primary" disabled={busy || (!isEvmPlan && !wallet.address)} onClick={heartbeat}>
                {busy ? "Confirm in wallet…" : v.state === 3 ? "Veto the claim — I'm here" : dueSoon ? "Check in now" : isEvmPlan ? "I'm here — check in" : "I'm here — send heartbeat"}
              </button>
              {isEvmPlan ? (
                <p className="hint" style={{ fontSize: "0.75rem", color: "var(--mist-2)", maxWidth: 280 }}>
                  One click in MetaMask/OKX — we connect and add Coston2 automatically. Gas is free testnet
                  C2FLR: <a href="https://faucet.flare.network/coston2" target="_blank" rel="noreferrer">faucet ↗</a>
                </p>
              ) : !wallet.address && (
                <p className="hint" style={{ fontSize: "0.75rem", color: "var(--mist-2)", maxWidth: 260 }}>
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
            <div className="stat"><div className="k">Next deadline</div><div className="v">{new Date((v.state === 3 ? v.claimChallengeEndsAt : v.silenceDeadline) * 1000).toLocaleTimeString()}</div></div>
            <div className="stat"><div className="k">Rules</div><div className="v">{Math.round(v.heartbeatPeriod / 60)}m + {Math.round(v.gracePeriod / 60)}m grace · {Math.round(v.challengePeriod / 60)}m veto</div></div>
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3>The plan's journey</h3>
              <span className="mono" style={{ fontSize: "0.68rem", color: "var(--mist-2)" }}>every entry is a public transaction</span>
            </div>
            <EvidenceTimeline events={events} journey />
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
            <Link className="btn btn-ghost" to={`/kit/${address}`}>Recovery Kit (print)</Link>
            <Link className="btn btn-ghost" to={`/claim/${address}`}>Beneficiary view</Link>
            {v.state >= 1 && v.state <= 3 && (
              <button className="btn btn-ghost" style={{ color: "var(--ember)", borderColor: "color-mix(in srgb, var(--ember) 40%, transparent)" }} onClick={openCancel}>
                Cancel plan & redeem back to me
              </button>
            )}
          </div>

          {cancelOpen && (
            <div className="card" style={{ marginTop: 16, borderColor: "color-mix(in srgb, var(--ember) 45%, transparent)" }}>
              <h3 style={{ marginBottom: 8 }}>Cancel this plan</h3>
              {isEvmPlan ? (
                <>
                  <p style={{ fontSize: "0.9rem", marginBottom: 12 }}>
                    Cancelling is one owner-signed transaction: your connected wallet calls{" "}
                    <span className="mono">cancelEvm()</span> and the vault hands every FXRP back to your
                    account. Nobody else can trigger it — the contract checks the caller is the owner.
                  </p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button className="btn btn-primary" disabled={busy} onClick={cancelWithWallet}>
                      {busy ? "Confirm in wallet…" : "Cancel with MetaMask / OKX"}
                    </button>
                    <button className="btn btn-ghost" onClick={() => setCancelOpen(false)}>Keep the plan</button>
                  </div>
                </>
              ) : (<>
              <p style={{ fontSize: "0.9rem", marginBottom: 12 }}>
                Cancelling is an owner-signed XRPL action: send <strong>1 drop</strong> to the beacon with your
                plan's cancel memo. The keeper proves it, and the vault redeems everything back to
                <em> your</em> XRPL wallet. Nobody else can trigger this — the proof must come from your address.
              </p>
              {cancelIntent ? (
                <>
                  <div className="status-grid" style={{ marginBottom: 12 }}>
                    <div className="stat"><div className="k">Send</div><div className="v">1 drop</div></div>
                    <div className="stat"><div className="k">To</div><div className="v mono">{cancelIntent.beacon}</div></div>
                    <div className="stat" style={{ gridColumn: "1 / -1" }}><div className="k">Memo (cancel command)</div><div className="v mono">{cancelIntent.memoHex}</div></div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {wallet.address && (
                      <button className="btn btn-primary" disabled={busy} onClick={cancelWithWallet}>
                        {busy ? "Confirm in wallet…" : "Cancel with GemWallet"}
                      </button>
                    )}
                    <button className="btn btn-ghost" onClick={() => setCancelOpen(false)}>Keep the plan</button>
                  </div>
                </>
              ) : (
                <p className="mono" style={{ fontSize: "0.75rem" }}>loading cancel instructions…</p>
              )}
              </>)}
            </div>
          )}

          <details style={{ marginTop: 20 }}>
            <summary style={{ cursor: "pointer", color: "var(--mist-2)", fontSize: "0.82rem" }}>Technical details</summary>
            <div className="status-grid" style={{ marginTop: 12 }}>
              <div className="stat" style={{ gridColumn: "1 / -1" }}><div className="k">Vault contract</div><div className="v mono"><a href={`${CONFIG.explorer}/address/${address}`} target="_blank" rel="noreferrer">{address}</a></div></div>
              <div className="stat"><div className="k">Silence proven through</div><div className="v">{v.silenceProvenThroughTs ? new Date(v.silenceProvenThroughTs * 1000).toLocaleTimeString() : "—"}</div></div>
              <div className="stat"><div className="k">Next silence ledger</div><div className="v mono">{v.nextSilenceLedger}</div></div>
              <div className="stat"><div className="k">Heartbeat epoch</div><div className="v">{v.heartbeatEpoch}</div></div>
            </div>
          </details>
        </div>
      </div>
    </main>
  );
}
