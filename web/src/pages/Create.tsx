import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CONFIG } from "../config";
import { useWallet } from "../App";
import { payWithMemo } from "../lib/gem";
import { short } from "../lib/chain";
import type { KeeperEvent } from "./Vault";

type Draft = {
  ownerXrpl: string;
  beneficiaryXrpl: string;
  heartbeatPeriod: number;
  grace: number;
  challenge: number;
  lots: number;
};

const isXrplAddr = (s: string) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s.trim());
const mins = (s: number) => (s % 60 === 0 ? `${s / 60} minute${s === 60 ? "" : "s"}` : `${s} seconds`);

export function Create() {
  const nav = useNavigate();
  const { wallet, evm, connect, openConnect, refreshPlans, connecting } = useWallet();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({
    ownerXrpl: "",
    beneficiaryXrpl: "",
    heartbeatPeriod: CONFIG.demo.heartbeatPeriod,
    grace: CONFIG.demo.grace,
    challenge: CONFIG.demo.challenge,
    lots: 2,
  });
  const [created, setCreated] = useState<{ vault: string; reference: string; fundingMemo: string; grossDrops: string } | null>(null);
  const [paidTx, setPaidTx] = useState<string | null>(null);
  const [manualTx, setManualTx] = useState("");
  const [progress, setProgress] = useState<KeeperEvent[]>([]);

  const set = (k: keyof Draft, v: string | number) => setDraft((d) => ({ ...d, [k]: v }));
  const owner = draft.ownerXrpl || wallet.address || "";
  // an XRPL wallet (or typed XRPL address) always takes priority; MetaMask/OKX is the fallback owner mode
  const evmMode = !isXrplAddr(owner) && !!evm.address;

  // funding progress: poll the keeper's events for the fresh vault
  useEffect(() => {
    if (!created || step < 4) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${CONFIG.api}/vaults/${created.vault}`);
        if (r.ok) {
          const evs: KeeperEvent[] = (await r.json()).events ?? [];
          setProgress(evs);
          if (evs.some((ev) => ev.kind === "active")) refreshPlans(); // plan count updates the moment it goes live
        }
      } catch {}
    }, 8000);
    return () => clearInterval(t);
  }, [created, step]);

  async function createVault() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${CONFIG.api}/vaults`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evmMode ? { ...draft, ownerXrpl: undefined, ownerEvm: evm.address } : { ...draft, ownerXrpl: owner }),
      });
      if (!r.ok) throw new Error(await r.text());
      setCreated(await r.json());
      refreshPlans();
      setStep(4);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function payFunding() {
    if (!created) return;
    setBusy(true); setErr(null);
    try {
      const hash = await payWithMemo({ destination: CONFIG.coreVaultXrpl, amountDrops: created.grossDrops, memoHex: created.fundingMemo });
      if (!hash) throw new Error("The wallet declined the payment.");
      setPaidTx(hash);
      await fetch(`${CONFIG.api}/vaults/${created.vault}/funded`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xrplTx: hash }),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function submitManualTx() {
    if (!created || !/^[A-Fa-f0-9]{64}$/.test(manualTx.trim())) { setErr("Paste the 64-character XRPL transaction hash of your payment."); return; }
    setBusy(true); setErr(null);
    try {
      setPaidTx(manualTx.trim());
      await fetch(`${CONFIG.api}/vaults/${created.vault}/funded`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xrplTx: manualTx.trim().toUpperCase() }),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const doneKinds = new Set(progress.map((p) => p.kind));
  const progressSteps = [
    ["funding", "XRPL payment found & being proven (FDC)"],
    ["minted", "FXRP minted into your vault"],
    ["active", "Plan activated — the dial is live"],
  ] as const;
  const isActive = doneKinds.has("active");

  const titles = ["Who should receive it?", "When should silence become concern?", "Your final veto", "Review the promise", "Protect the XRP", "Share & rehearse"];

  return (
    <main className="wrap" style={{ padding: "50px 24px", maxWidth: 720 }}>
      <div className="eyebrow">Create a continuity plan</div>
      <h1 style={{ fontSize: "2.1rem", margin: "10px 0 8px" }}>{titles[step]}</h1>
      <p className="mono" style={{ fontSize: "0.72rem", marginBottom: 28 }}>
        step {step + 1} of 6 · Coston2 testnet · demo timing
      </p>

      {err && <div className="notice err" style={{ marginBottom: 18 }}>{err}</div>}

      {step === 0 && (
        <div className="card">
          <p style={{ marginBottom: 14, fontSize: "0.92rem" }}>
            Two people, one promise. First, the wallets: <strong>yours</strong> keeps full control — only its
            heartbeats count, only it can cancel. <strong>Theirs</strong> is where the XRP arrives if you go silent.
          </p>
          {wallet.address ? (
            <div className="notice ok" style={{ marginBottom: 14 }}>Connected (XRPL): <span className="mono">{wallet.address}</span></div>
          ) : evm.address ? (
            <div className="notice ok" style={{ marginBottom: 14 }}>
              Owner via {evm.kind}: <span className="mono">{short(evm.address, 8)}</span> — your check-ins become
              one-click Flare transactions. Prefer XRPL-native heartbeats? Connect GemWallet or type an XRPL
              address below and it takes priority.
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" onClick={connect} disabled={connecting}>
                  {connecting ? "Looking for wallet…" : "Connect GemWallet (XRPL)"}
                </button>
                <button className="btn btn-ghost" onClick={openConnect} disabled={connecting} style={{ opacity: 0.85 }}>
                  EVM wallet (MetaMask / OKX)
                </button>
              </div>
              <p className="hint" style={{ fontSize: "0.8rem", color: "var(--mist)", marginTop: 10 }}>
                The XRPL wallet is the native path — 1-drop heartbeats, proven by Flare. No XRPL wallet? Use
                MetaMask/OKX: Coston2 is added automatically and check-ins are one click. Or paste addresses
                below and pay from any wallet.
              </p>
            </div>
          )}
          <div className="field">
            <label>{evmMode ? "Your XRPL address — optional; your connected EVM account is the owner" : "Your XRPL address (the owner)"}</label>
            <input placeholder={evmMode ? "r… (leave empty to check in from MetaMask/OKX)" : "r…"} value={draft.ownerXrpl || wallet.address || ""} onChange={(e) => set("ownerXrpl", e.target.value.trim())} />
          </div>
          <div className="field">
            <label>Their XRPL address (the beneficiary)</label>
            <input placeholder="r…" value={draft.beneficiaryXrpl} onChange={(e) => set("beneficiaryXrpl", e.target.value.trim())} />
            {isXrplAddr(draft.beneficiaryXrpl) && (
              <span className="hint mono">fingerprint: {draft.beneficiaryXrpl.slice(0, 6)} ···· {draft.beneficiaryXrpl.slice(-6)} — check it character by character; it cannot be changed after release.</span>
            )}
            {!draft.beneficiaryXrpl && (
              <span className="hint" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ padding: "4px 12px", fontSize: "0.74rem" }}
                  onClick={() => set("beneficiaryXrpl", CONFIG.demoBeneficiary)}>
                  Use the demo beneficiary
                </button>
                <span style={{ color: "var(--mist-2)", fontSize: "0.76rem" }}>
                  just exploring? This is "Maya" from the live case — payouts to her wallet are publicly visible.
                </span>
              </span>
            )}
          </div>
          <button className="btn btn-primary"
            disabled={(!isXrplAddr(owner) && !evmMode) || !isXrplAddr(draft.beneficiaryXrpl) || (isXrplAddr(owner) && owner === draft.beneficiaryXrpl)}
            onClick={() => { if (!draft.ownerXrpl && wallet.address) set("ownerXrpl", wallet.address); setStep(1); }}>
            Continue
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <p style={{ marginBottom: 16, fontSize: "0.92rem" }}>
            How long may you stay silent before anyone may even ask? You reset this clock with a 1-drop
            heartbeat — from your phone, from anywhere.
          </p>
          <div className="field">
            <label>Inactivity window</label>
            <select value={draft.heartbeatPeriod} onChange={(e) => set("heartbeatPeriod", Number(e.target.value))}>
              <option value={240}>4 minutes — demo</option>
              <option value={600}>10 minutes — demo</option>
              <option value={3600}>1 hour</option>
            </select>
            <span className="hint">A real plan would use 90–180 days. Demo timing keeps the whole story visible in one sitting.</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn btn-primary" onClick={() => setStep(2)}>Continue</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <p style={{ marginBottom: 16, fontSize: "0.92rem" }}>
            Even after proven silence, nothing moves yet: a challenge window opens first, and one heartbeat
            from you cancels the claim. Hospital stay, lost phone, long flight — this is your safety margin.
          </p>
          <div className="field">
            <label>Final veto window</label>
            <select value={draft.challenge} onChange={(e) => set("challenge", Number(e.target.value))}>
              <option value={120}>2 minutes — demo</option>
              <option value={300}>5 minutes</option>
            </select>
          </div>
          <div className="field">
            <label>Amount to protect</label>
            <select value={draft.lots} onChange={(e) => set("lots", Number(e.target.value))}>
              <option value={1}>10 XRP</option>
              <option value={2}>20 XRP</option>
              <option value={3}>30 XRP</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)}>Review the promise</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card" style={{ borderColor: "color-mix(in srgb, var(--lamplight) 45%, transparent)" }}>
          <h3 style={{ marginBottom: 14 }}>The promise you are about to make</h3>
          <div style={{ fontSize: "0.98rem", color: "var(--paper)", display: "grid", gap: 10, marginBottom: 18 }}>
            <p style={{ color: "var(--paper)" }}>
              · As long as you check in within <strong>{mins(draft.heartbeatPeriod)}</strong>
              {evmMode ? ` (one click in ${evm.kind ?? "your wallet"})` : ""}, nobody can touch
              this vault — not the beneficiary, not Heirloom, not anyone.
            </p>
            <p style={{ color: "var(--paper)" }}>
              · After {mins(draft.heartbeatPeriod)} plus {mins(draft.grace)} of grace,{" "}
              <span className="mono">{short(draft.beneficiaryXrpl, 6)}</span> may ask Flare's network to prove
              your silence.
            </p>
            <p style={{ color: "var(--paper)" }}>
              · You then still have a final <strong>{mins(draft.challenge)}</strong> veto window — one heartbeat
              cancels everything.
            </p>
            <p style={{ color: "var(--paper)" }}>
              · Only after all three have elapsed can <strong>{draft.lots * 10} XRP</strong> be redeemed to
              their wallet. You can cancel and take everything back at any time before that.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep(2)}>Adjust</button>
            <button className="btn btn-primary" disabled={busy} onClick={createVault}>
              {busy ? "Creating your vault…" : "I understand — create the vault"}
            </button>
          </div>
        </div>
      )}

      {step === 4 && created && (
        <div className="card">
          <div className="notice ok" style={{ marginBottom: 16 }}>
            Vault deployed at{" "}
            <a href={`${CONFIG.explorer}/address/${created.vault}`} target="_blank" rel="noreferrer" className="mono">{short(created.vault, 10)}</a>
            {" "}— it is yours; Heirloom holds no keys to it.
          </div>
          <p style={{ fontSize: "0.95rem", marginBottom: 14 }}>
            Now protect <strong>{draft.lots * 10} XRP</strong> with one payment
            {wallet.address ? " — review it in GemWallet." : " from any XRPL testnet wallet."}
            {evmMode && !wallet.address ? " The memo — not the sender — routes the mint to your vault, so any funded testnet account works." : ""}
          </p>

          {wallet.address ? (
            !paidTx && <button className="btn btn-primary" disabled={busy} onClick={payFunding}>{busy ? "Waiting for wallet…" : `Protect ${draft.lots * 10} XRP`}</button>
          ) : (
            !paidTx && (
              <>
                <div className="status-grid" style={{ marginBottom: 14 }}>
                  <div className="stat"><div className="k">Send exactly</div><div className="v">{(Number(created.grossDrops) / 1e6).toFixed(2)} XRP</div></div>
                  <div className="stat"><div className="k">To</div><div className="v mono">{CONFIG.coreVaultXrpl}</div></div>
                  <div className="stat" style={{ gridColumn: "1 / -1" }}><div className="k">Memo (routes the mint to your vault)</div><div className="v mono">{created.fundingMemo}</div></div>
                </div>
                <div className="field">
                  <label>After sending, paste your XRPL transaction hash</label>
                  <input placeholder="64-character hash…" value={manualTx} onChange={(e) => setManualTx(e.target.value.trim())} />
                  <span className="hint">The keeper also auto-detects core-vault payments within ~30 s — the hash just makes it instant.</span>
                </div>
                <button className="btn btn-primary" disabled={busy} onClick={submitManualTx}>I've sent it — track my payment</button>
              </>
            )
          )}

          {(paidTx || progress.length > 0) && (
            <div style={{ marginTop: 16 }}>
              {paidTx && (
                <p className="mono" style={{ fontSize: "0.75rem", marginBottom: 10 }}>
                  payment <a href={`${CONFIG.xrplExplorer}/transactions/${paidTx}`} target="_blank" rel="noreferrer">{short(paidTx, 10)} ↗</a>
                </p>
              )}
              <div style={{ display: "grid", gap: 8 }}>
                {progressSteps.map(([kind, label], i) => {
                  const done = doneKinds.has(kind);
                  const activeStep = !done && progressSteps.slice(0, i).every(([k]) => doneKinds.has(k));
                  return (
                    <div key={kind} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: "0.88rem" }}>
                      {done ? (
                        <span className="mono" style={{ color: "var(--verdant)" }}>✓</span>
                      ) : activeStep ? (
                        <span className="spinner" />
                      ) : (
                        <span className="mono" style={{ color: "var(--mist-2)" }}>○</span>
                      )}
                      <span style={{ color: done ? "var(--paper)" : activeStep ? "var(--paper)" : "var(--mist-2)" }}>
                        {label}{activeStep ? "…" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
              {!isActive && (
                <p className="mono pulse" style={{ fontSize: "0.68rem", color: "var(--mist-2)", marginTop: 10 }}>
                  Flare's data providers are attesting — a voting round takes about 90 seconds, finalization
                  2–3 minutes. This page updates itself.
                </p>
              )}
              {isActive && (
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setStep(5)}>
                  The plan is live — one last thing
                </button>
              )}
            </div>
          )}

          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", color: "var(--mist-2)", fontSize: "0.8rem" }}>Advanced payment details</summary>
            <div className="status-grid" style={{ marginTop: 10 }}>
              <div className="stat"><div className="k">Gross amount</div><div className="v mono">{created.grossDrops} drops</div></div>
              <div className="stat"><div className="k">FAssets core vault</div><div className="v mono">{CONFIG.coreVaultXrpl}</div></div>
              <div className="stat" style={{ gridColumn: "1 / -1" }}><div className="k">Mint memo</div><div className="v mono">{created.fundingMemo}</div></div>
            </div>
          </details>
        </div>
      )}

      {step === 5 && created && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Share the path. Rehearse it once.</h3>
          <p style={{ fontSize: "0.92rem", marginBottom: 16 }}>
            A continuity plan only works if the beneficiary can walk it without you. Print the Recovery Kit,
            hand it over, and — while you're both here — run one practice claim and watch it get refused.
          </p>
          <ol style={{ color: "var(--mist)", fontSize: "0.92rem", paddingLeft: 20, marginBottom: 18, display: "grid", gap: 6 }}>
            <li>Print the Recovery Kit and give it to your beneficiary.</li>
            <li>Have them open the claim page and run "Test early-claim protection".</li>
            <li>{evmMode ? "Open your plan and press “Check in” — one wallet click resets the dial." : "Send your first heartbeat and watch the dial reset."}</li>
          </ol>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={() => nav(`/vault/${created.vault}`)}>Open my plan</button>
            <button className="btn btn-ghost" onClick={() => window.open(`/kit/${created.vault}`, "_blank")}>Recovery Kit (print)</button>
          </div>
        </div>
      )}
    </main>
  );
}
