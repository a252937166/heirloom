import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CONFIG } from "../config";
import { useWallet } from "../App";
import { payWithMemo } from "../lib/gem";
import { short } from "../lib/chain";

type Draft = {
  ownerXrpl: string;
  beneficiaryXrpl: string;
  heartbeatPeriod: number;
  grace: number;
  challenge: number;
  lots: number;
};

const isXrplAddr = (s: string) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s.trim());

export function Create() {
  const nav = useNavigate();
  const { wallet, connect, connecting, notice } = useWallet();
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
  const [created, setCreated] = useState<{
    vault: string;
    reference: string;
    fundingMemo: string;
    grossDrops: string;
  } | null>(null);
  const [paidTx, setPaidTx] = useState<string | null>(null);

  const set = (k: keyof Draft, v: string | number) => setDraft((d) => ({ ...d, [k]: v }));

  async function createVault() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${CONFIG.api}/vaults`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!r.ok) throw new Error(await r.text());
      setCreated(await r.json());
      setStep(3);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function payFunding() {
    if (!created) return;
    setBusy(true);
    setErr(null);
    try {
      const hash = await payWithMemo({
        destination: CONFIG.coreVaultXrpl,
        amountDrops: created.grossDrops,
        memoHex: created.fundingMemo,
      });
      if (!hash) throw new Error("Payment was rejected in the wallet.");
      setPaidTx(hash);
      await fetch(`${CONFIG.api}/vaults/${created.vault}/funded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xrplTx: hash }),
      });
      setStep(4);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const stepTitles = ["Your address", "Your beneficiary", "Your rules", "Fund it", "Done"];

  return (
    <main className="wrap" style={{ padding: "56px 24px", maxWidth: 720 }}>
      <div className="eyebrow">Create a continuity plan</div>
      <h1 style={{ fontSize: "2.2rem", margin: "10px 0 8px" }}>{stepTitles[step]}</h1>
      <p className="mono" style={{ fontSize: "0.72rem", marginBottom: 30 }}>
        step {step + 1} of 5 · Coston2 testnet · demo timing
      </p>

      {err && <div className="notice err" style={{ marginBottom: 18 }}>{err}</div>}

      {step === 0 && (
        <div className="card">
          <p style={{ marginBottom: 16, fontSize: "0.92rem" }}>
            This is the wallet that owns the vault: only its heartbeats count, and only it can cancel.
          </p>
          {wallet.address ? (
            <div className="notice ok" style={{ marginBottom: 16 }}>
              Connected: <span className="mono">{wallet.address}</span>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <button className="btn btn-ghost" onClick={connect} disabled={connecting}>
                {connecting ? "Looking for wallet…" : "Connect GemWallet"}
              </button>
              {notice === "no-wallet" && (
                <p className="hint" style={{ fontSize: "0.8rem", color: "var(--mist)", marginTop: 10 }}>
                  GemWallet not detected — no problem. Paste your XRPL address below; you'll pay by copying the
                  payment details into Xaman or any wallet.
                </p>
              )}
            </div>
          )}
          <div className="field">
            <label>Your XRPL address</label>
            <input
              placeholder="r…"
              value={draft.ownerXrpl || wallet.address || ""}
              onChange={(e) => set("ownerXrpl", e.target.value.trim())}
            />
            <span className="hint">No GemWallet? Paste your Xaman address — you'll pay by scanning instead.</span>
          </div>
          <button
            className="btn btn-primary"
            disabled={!isXrplAddr(draft.ownerXrpl || wallet.address || "")}
            onClick={() => {
              if (!draft.ownerXrpl && wallet.address) set("ownerXrpl", wallet.address);
              setStep(1);
            }}
          >
            Continue
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <p style={{ marginBottom: 16, fontSize: "0.92rem" }}>
            After proven silence and the safety challenge, the vault redeems its FXRP and the XRP arrives on
            <em> this</em> wallet. Double-check it character by character — this cannot be corrected after release.
          </p>
          <div className="field">
            <label>Beneficiary's XRPL address</label>
            <input placeholder="r…" value={draft.beneficiaryXrpl} onChange={(e) => set("beneficiaryXrpl", e.target.value.trim())} />
            {isXrplAddr(draft.beneficiaryXrpl) && (
              <span className="hint mono">
                fingerprint: {draft.beneficiaryXrpl.slice(0, 6)} ···· {draft.beneficiaryXrpl.slice(-6)}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn btn-primary" disabled={!isXrplAddr(draft.beneficiaryXrpl) || draft.beneficiaryXrpl === draft.ownerXrpl} onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <div className="field">
            <label>Inactivity period — how long you may stay silent</label>
            <select value={draft.heartbeatPeriod} onChange={(e) => set("heartbeatPeriod", Number(e.target.value))}>
              <option value={240}>4 minutes (demo)</option>
              <option value={600}>10 minutes (demo)</option>
              <option value={3600}>1 hour</option>
            </select>
            <span className="hint">A real plan would use 90–180 days. Demo timing keeps the full lifecycle visible.</span>
          </div>
          <div className="field">
            <label>Safety challenge — your final veto window after a claim starts</label>
            <select value={draft.challenge} onChange={(e) => set("challenge", Number(e.target.value))}>
              <option value={120}>2 minutes (demo)</option>
              <option value={300}>5 minutes</option>
            </select>
          </div>
          <div className="field">
            <label>Amount to protect</label>
            <select value={draft.lots} onChange={(e) => set("lots", Number(e.target.value))}>
              <option value={1}>10 XRP (1 lot)</option>
              <option value={2}>20 XRP (2 lots)</option>
              <option value={3}>30 XRP (3 lots)</option>
            </select>
            <span className="hint">FAssets redeems in lots of 10; whole lots keep the payout exact.</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-primary" disabled={busy} onClick={createVault}>
              {busy ? "Creating vault…" : "Create the vault"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && created && (
        <div className="card">
          <div className="notice ok" style={{ marginBottom: 18 }}>
            Vault deployed at <a href={`${CONFIG.explorer}/address/${created.vault}`} target="_blank" rel="noreferrer" className="mono">{short(created.vault, 10)}</a>.
            It is yours: Heirloom holds no keys to it.
          </div>
          <p style={{ fontSize: "0.92rem", marginBottom: 14 }}>
            Now fund it with <strong>one XRPL payment</strong>. FAssets will mint FXRP directly into your vault —
            you never touch an EVM wallet.
          </p>
          <div className="status-grid" style={{ marginBottom: 18 }}>
            <div className="stat"><div className="k">Send exactly</div><div className="v">{(Number(created.grossDrops) / 1e6).toFixed(2)} XRP</div></div>
            <div className="stat"><div className="k">To (FAssets core vault)</div><div className="v mono">{CONFIG.coreVaultXrpl}</div></div>
            <div className="stat" style={{ gridColumn: "1 / -1" }}><div className="k">Memo (routes the mint to your vault)</div><div className="v mono">{created.fundingMemo}</div></div>
          </div>
          {wallet.address ? (
            <button className="btn btn-primary" disabled={busy} onClick={payFunding}>
              {busy ? "Waiting for wallet…" : "Pay with GemWallet"}
            </button>
          ) : (
            <div className="notice">
              Send the payment above from any XRPL testnet wallet (amount + destination + memo exactly as shown),
              then continue — the keeper detects it automatically.
            </div>
          )}
          <button className="btn btn-ghost" style={{ marginLeft: 10 }} onClick={() => setStep(4)}>
            I've sent it manually
          </button>
        </div>
      )}

      {step === 4 && created && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Your plan is being funded.</h3>
          {paidTx && (
            <p className="mono" style={{ fontSize: "0.78rem", marginBottom: 12 }}>
              payment: <a href={`${CONFIG.xrplExplorer}/transactions/${paidTx}`} target="_blank" rel="noreferrer">{short(paidTx, 10)}</a>
            </p>
          )}
          <p style={{ fontSize: "0.92rem", marginBottom: 16 }}>
            The keeper is proving your payment to Flare and activating the vault (2–4 minutes). Two things to do
            while it settles:
          </p>
          <ol style={{ color: "var(--mist)", fontSize: "0.92rem", paddingLeft: 20, marginBottom: 20 }}>
            <li>Download the Recovery Kit and give it to your beneficiary.</li>
            <li>Bookmark your vault page — your heartbeat button lives there.</li>
          </ol>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn-primary" onClick={() => nav(`/vault/${created.vault}`)}>Open my vault</button>
            <button className="btn btn-ghost" onClick={() => window.open(`/kit/${created.vault}`, "_blank")}>Recovery Kit</button>
          </div>
        </div>
      )}
    </main>
  );
}
