import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CONFIG } from "../config";
import { useWallet } from "../App";
import { payWithMemo } from "../lib/gem";
import { short } from "../lib/chain";
import { NodeStepper } from "../components/NodeStepper";
import { buildRecoveryManifest, downloadManifest } from "../lib/recovery";
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
  const [created, setCreated] = useState<{ vault: string; reference: string; fundingMemo: string; grossDrops: string; paymentAddress?: string; vetoProofGrace: number } | null>(null);
  type Quote = {
    exactPaymentDrops: string; paymentAddress: string; expiresAt: number;
    breakdown?: { feeBIPS: string; minimumFeeUBA: string; executorFeeUBA: string; source: string };
    largeMint?: { thresholdUBA: string; delaySeconds: number; wouldDelay: boolean };
  };
  const [quote, setQuote] = useState<Quote | null>(null);
  // a payment quote is only trustworthy while fresh — refetch at pay time, never reuse stale amounts
  async function freshQuote() {
    const r = await fetch(`${CONFIG.api}/direct-mint/quote?lots=${draft.lots}`);
    if (!r.ok) throw new Error(await r.text());
    const q = await r.json();
    setQuote(q);
    return q as Quote;
  }
  const [paidTx, setPaidTx] = useState<string | null>(null);
  const [manualTx, setManualTx] = useState("");
  const [progress, setProgress] = useState<KeeperEvent[]>([]);
  // quote expiry: the keeper's quote lives ~2 minutes (expiresAt, unix seconds).
  // Count it down every second; at zero clear it (stale amounts must disappear)
  // and re-quote automatically, capped so a dead API can't loop forever.
  const [quoteLeft, setQuoteLeft] = useState<number | null>(null);
  const [autoRefreshes, setAutoRefreshes] = useState(0);
  useEffect(() => {
    if (!quote || step !== 4 || paidTx) { setQuoteLeft(null); return; }
    const tick = () => setQuoteLeft(Math.max(0, quote.expiresAt - Math.floor(Date.now() / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [quote, step, paidTx]);
  useEffect(() => {
    if (quoteLeft !== 0 || !quote) return;
    setQuote(null);
    if (autoRefreshes < 10) { setAutoRefreshes((n) => n + 1); freshQuote().catch(() => {}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteLeft]);

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
      // pin the veto-proof grace explicitly (mirrors the keeper default) so the
      // locally-generated recovery file always matches what went on-chain
      const vetoProofGrace = evmMode ? 0 : 180;
      const r = await fetch(`${CONFIG.api}/vaults`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evmMode ? { ...draft, ownerXrpl: undefined, ownerEvm: evm.address, vetoProofGrace } : { ...draft, ownerXrpl: owner, vetoProofGrace }),
      });
      if (!r.ok) throw new Error(await r.text());
      setCreated({ ...(await r.json()), vetoProofGrace });
      refreshPlans();
      freshQuote().catch(() => {});
      setStep(4);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function payFunding() {
    if (!created) return;
    setBusy(true); setErr(null);
    try {
      const q = await freshQuote(); // exact drops + payment address, quoted at pay time
      const hash = await payWithMemo({ destination: q.paymentAddress, amountDrops: q.exactPaymentDrops, memoHex: created.fundingMemo });
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
      <div style={{ margin: "18px 0 26px", maxWidth: 640 }}>
        <NodeStepper size={30} items={["Who", "When", "Veto", "Review", "Protect", "Share"].map((label, i) => ({
          icon: String(i + 1), label,
          state: i < step ? "done" : i === step ? "active" : "todo",
        }))} />
      </div>

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
              Owner via {evm.kind}: <span className="mono">{short(evm.address, 8)}</span> — detected automatically;
              your check-ins become one-click Flare transactions. Prefer XRPL-native heartbeats? Connect GemWallet
              and it takes priority.
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <button className="btn btn-primary" onClick={connect} disabled={connecting}>
                {connecting ? "Looking for wallet…" : "Continue with GemWallet (XRPL)"}
              </button>
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", color: "var(--mist-2)", fontSize: "0.8rem" }}>Other setup options</summary>
                <div style={{ display: "grid", gap: 8, paddingTop: 10 }}>
                  <button className="btn btn-ghost" onClick={openConnect} disabled={connecting} style={{ justifySelf: "start" }}>
                    EVM wallet (MetaMask / OKX) — alternative setup
                  </button>
                  <p className="hint" style={{ fontSize: "0.76rem", color: "var(--mist-2)", margin: 0 }}>
                    Different model, honestly stated: silence is measured by Flare consensus time instead of an
                    FDC proof-of-absence; check-ins become one-click Flare transactions. Or skip wallets — paste
                    your XRPL address below and pay from any wallet.
                  </p>
                </div>
              </details>
            </div>
          )}
          {evmMode ? (
            <div className="kv" style={{ marginBottom: 16 }}>
              <div className="kv-row">
                <span className="k">Owner (auto-detected)</span>
                <span className="v" style={{ color: "var(--verdant)" }}>✓ {short(evm.address ?? "", 8)} · {evm.kind}</span>
              </div>
            </div>
          ) : (
            <div className="field">
              <label>Your XRPL address (the owner)</label>
              <input placeholder="r…" value={draft.ownerXrpl || wallet.address || ""} onChange={(e) => set("ownerXrpl", e.target.value.trim())} />
            </div>
          )}
          <div className="field">
            <label style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span>Their XRPL address (the beneficiary)</span>
              {isXrplAddr(draft.beneficiaryXrpl) && <span className="mono" style={{ fontSize: "0.66rem", color: "var(--verdant)" }}>✓ valid</span>}
            </label>
            <input placeholder="r…" value={draft.beneficiaryXrpl} onChange={(e) => set("beneficiaryXrpl", e.target.value.trim())} />
            {isXrplAddr(draft.beneficiaryXrpl) && (
              <span className="hint mono">fingerprint: {draft.beneficiaryXrpl.slice(0, 6)} ···· {draft.beneficiaryXrpl.slice(-6)} — check it character by character; it cannot be changed after release.</span>
            )}
            {!isXrplAddr(draft.beneficiaryXrpl) && (
              <>
                <span className="hint" style={{ marginTop: 8, fontSize: "0.72rem", color: "var(--mist-2)" }}>Or choose a demo beneficiary</span>
                <button type="button" onClick={() => set("beneficiaryXrpl", CONFIG.demoBeneficiary)}
                  style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer", background: "color-mix(in srgb, var(--paper) 2%, transparent)", border: "1px dashed var(--line)" }}>
                  <span style={{ width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--violet) 18%, transparent)", color: "var(--violet)", fontWeight: 700, flexShrink: 0 }}>M</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "var(--paper)" }}>Maya (Demo)</span>
                    <span className="mono" style={{ fontSize: "0.64rem", color: "var(--mist-2)" }}>{short(CONFIG.demoBeneficiary, 10)}</span>
                  </span>
                  <span className="mono" style={{ fontSize: "0.68rem", color: "var(--mist-2)" }}>use ›</span>
                </button>
                <span className="hint" style={{ fontSize: "0.68rem", color: "var(--mist-2)" }}>
                  Public test address · anyone can see funds sent here · judge demo only, never for a personal plan
                </span>
              </>
            )}
            <span className="hint" style={{ fontSize: "0.7rem", color: "var(--ember)" }}>
              Use a self-custody XRPL wallet. Never an exchange deposit address — those need a destination
              tag and the payout would be lost in the exchange's omnibus account.
            </span>
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
        <div className="card">
          <h3 style={{ marginBottom: 4, textAlign: "center" }}>Review your promise</h3>
          <p style={{ fontSize: "0.82rem", textAlign: "center", marginBottom: 16 }}>Confirm everything looks right before protecting your XRP.</p>
          <div className="kv" style={{ marginBottom: 16 }}>
            <div className="kv-row"><span className="k">Beneficiary</span><span className="v">{short(draft.beneficiaryXrpl, 8)}</span></div>
            <div className="kv-row"><span className="k">Heartbeat period</span><span className="v">{mins(draft.heartbeatPeriod)} (demo)</span></div>
            <div className="kv-row"><span className="k">Grace period</span><span className="v">{mins(draft.grace)}</span></div>
            <div className="kv-row"><span className="k">Final veto window</span><span className="v">{mins(draft.challenge)}</span></div>
            <div className="kv-row"><span className="k">Protected amount</span><span className="v">{draft.lots * 10}.00 XRP (you send ≈ {(draft.lots * 10 + 0.2).toFixed(2)} — exact amount live-quoted at payment)</span></div>
            <div className="kv-row"><span className="k">Owner ({evmMode ? evm.kind ?? "EVM" : "your wallet"})</span><span className="v">{evmMode ? short(evm.address ?? "", 8) : short(owner, 8)}</span></div>
          </div>
          <div className="notice" style={{ marginBottom: 10 }}>
            ⓘ You keep control until silence is proven <em>and</em> the veto window ends. Heirloom cannot
            redirect or release early; the beneficiary cannot claim early — the contract refuses.
          </div>
          <p className="hint" style={{ fontSize: "0.7rem", color: "var(--mist-2)", marginBottom: 16 }}>
            The send/protect difference covers the FAssets minting + executor fees. On release the vault redeems
            the protocol maximum; a residual below the protocol minimum stays visible on-chain.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
            <button className="btn btn-ghost" onClick={() => setStep(2)}>← Back</button>
            <button className="btn btn-primary" disabled={busy} onClick={createVault}>
              {busy ? "Creating your vault…" : evmMode ? "Create the plan" : "Protect with XRPL"}
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

          {!paidTx && (quote && quoteLeft != null ? (
            <p className="mono" style={{ fontSize: "0.72rem", marginBottom: 12, color: quoteLeft <= 15 ? "var(--ember)" : "var(--mist-2)" }}>
              Quote valid for {String(Math.floor(quoteLeft / 60)).padStart(2, "0")}:{String(quoteLeft % 60).padStart(2, "0")} — amounts re-quote automatically at expiry.
            </p>
          ) : (
            <div className="notice" style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span>{autoRefreshes >= 10
                ? "Auto-refresh paused after 10 quotes — refresh manually to continue."
                : "Fetching a live payment quote — payment unlocks once it arrives (never pay from stale numbers)."}</span>
              <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: "0.76rem" }} onClick={() => { setAutoRefreshes(0); freshQuote().catch(() => {}); }}>Refresh quote</button>
            </div>
          ))}
          {wallet.address ? (
            !paidTx && <button className="btn btn-primary" disabled={busy || !quote} onClick={payFunding}>{busy ? "Waiting for wallet…" : `Protect ${draft.lots * 10} XRP`}</button>
          ) : (
            !paidTx && (
              <>
                {quote && (
                  <div className="status-grid" style={{ marginBottom: 14 }}>
                    <div className="stat"><div className="k">Send exactly (live testnet quote)</div><div className="v">{(Number(quote.exactPaymentDrops) / 1e6).toFixed(2)} XRP</div></div>
                    <div className="stat"><div className="k">To</div><div className="v mono">{quote.paymentAddress}</div></div>
                    <div className="stat" style={{ gridColumn: "1 / -1" }}><div className="k">Memo (routes the mint to your vault)</div><div className="v mono">{created.fundingMemo}</div></div>
                  </div>
                )}
                <div className="field">
                  <label>After sending, paste your XRPL transaction hash</label>
                  <input placeholder="64-character hash…" value={manualTx} disabled={!quote} onChange={(e) => setManualTx(e.target.value.trim())} />
                  <span className="hint">The keeper also auto-detects core-vault payments within ~30 s — the hash just makes it instant.</span>
                </div>
                <button className="btn btn-primary" disabled={busy || !quote} onClick={submitManualTx}>I've sent it — track my payment</button>
              </>
            )
          )}

          {/* vertical activation progress (mock panel 4) */}
          <div style={{ marginTop: 18, display: "grid", gap: 0 }}>
            {(() => {
              const paid = !!paidTx || doneKinds.size > 0;
              const verifying = doneKinds.has("funding");
              const minted = doneKinds.has("minted");
              const steps = [
                { t: "Waiting for XRPL payment", s: wallet.address ? "confirm it in GemWallet — one payment, exact amount + memo" : "send the exact amount with the memo below", done: paid, act: !paid },
                { t: "Verifying payment on XRPL", s: "Flare's data providers attest the payment (≈ 90 s rounds)", done: minted, act: paid && verifying && !minted },
                { t: "Minting FXRP on Flare", s: "executeDirectMinting — any executor may beat us to it; balance is the truth", done: minted, act: false },
                { t: "Vault activated", s: "the dial goes live — your plan will be ready", done: isActive, act: minted && !isActive },
              ];
              return steps.map((st, i) => (
                <div key={st.t} style={{ display: "grid", gridTemplateColumns: "30px 1fr", gap: 12, position: "relative", paddingBottom: i < steps.length - 1 ? 18 : 0 }}>
                  {i < steps.length - 1 && <span style={{ position: "absolute", left: 14, top: 30, bottom: 0, width: 1.5, background: st.done ? "color-mix(in srgb, var(--verdant) 45%, transparent)" : "var(--line)" }} />}
                  <span style={{
                    width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", zIndex: 1,
                    fontSize: "0.78rem", fontWeight: 700,
                    color: st.done ? "var(--verdant)" : st.act ? "var(--lamplight)" : "var(--mist-2)",
                    border: `1.6px solid ${st.done ? "var(--verdant)" : st.act ? "var(--lamplight)" : "var(--line)"}`,
                    background: st.done ? "color-mix(in srgb, var(--verdant) 12%, var(--ink))" : "var(--ink)",
                  }}>
                    {st.done ? "✓" : st.act ? <span className="spinner" style={{ width: 12, height: 12 }} /> : i + 1}
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, color: st.done || st.act ? "var(--paper)" : "var(--mist-2)" }}>{st.t}</span>
                    <span style={{ display: "block", fontSize: "0.74rem", color: "var(--mist-2)" }}>{st.s}</span>
                  </span>
                </div>
              ));
            })()}
          </div>
          {paidTx && (
            <p className="mono" style={{ fontSize: "0.72rem", margin: "12px 0 0" }}>
              payment <a href={`${CONFIG.xrplExplorer}/transactions/${paidTx}`} target="_blank" rel="noreferrer">{short(paidTx, 10)} ↗</a>
            </p>
          )}
          <div style={{ marginTop: 16, border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", background: "#0d0e18" }}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="mono" style={{ display: "block", fontSize: "0.6rem", color: "var(--mist-2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Memo — routes the mint to your vault</span>
              <span className="mono" style={{ display: "block", fontSize: "0.72rem", color: "var(--paper)", wordBreak: "break-all", marginTop: 3 }}>{created.fundingMemo}</span>
            </span>
            <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: "0.72rem", flexShrink: 0 }}
              onClick={() => navigator.clipboard?.writeText(created.fundingMemo)}>copy</button>
          </div>
          {isActive && (
            <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} onClick={() => setStep(5)}>
              The plan is live — one last thing →
            </button>
          )}

          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", color: "var(--mist-2)", fontSize: "0.8rem" }}>Advanced payment details</summary>
            {/* ONE source of payment truth: everything here comes from the live quote */}
            <div className="status-grid" style={{ marginTop: 10 }}>
              {quote ? (
                <>
                  <div className="stat"><div className="k">Live quote amount</div><div className="v mono">{quote.exactPaymentDrops} drops</div></div>
                  <div className="stat"><div className="k">Payment address (live quote)</div><div className="v mono">{quote.paymentAddress}</div></div>
                  {quote.breakdown && (
                    <div className="stat" style={{ gridColumn: "1 / -1" }}>
                      <div className="k">Protocol fees ({quote.breakdown.source})</div>
                      <div className="v mono">max(gross×{quote.breakdown.feeBIPS}/10000, {Number(quote.breakdown.minimumFeeUBA) / 1e6} XRP) + {Number(quote.breakdown.executorFeeUBA) / 1e6} XRP executor</div>
                    </div>
                  )}
                  {quote.largeMint?.wouldDelay && (
                    <div className="stat" style={{ gridColumn: "1 / -1" }}>
                      <div className="k">Large-mint delay</div>
                      <div className="v">this size exceeds the protocol threshold — execution is delayed ≈{Math.round(quote.largeMint.delaySeconds / 60)} min (same proof, no second payment)</div>
                    </div>
                  )}
                  <div className="stat" style={{ gridColumn: "1 / -1" }}><div className="k">Mint memo</div><div className="v mono">{created.fundingMemo}</div></div>
                </>
              ) : (
                <div className="stat" style={{ gridColumn: "1 / -1" }}><div className="k">No live quote</div><div className="v">refresh above — payment details come only from a fresh quote</div></div>
              )}
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
            <li>Download the recovery file (and print the Kit) — give both to your beneficiary.</li>
            <li>Have them open the claim page and run "Test early-claim protection".</li>
            <li>{evmMode ? "Open your plan and press “Check in” — one wallet click resets the dial." : "Send your first heartbeat and watch the dial reset."}</li>
          </ol>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={() => downloadManifest(buildRecoveryManifest({
              vault: created.vault,
              ownerMode: evmMode ? "evm" : "xrpl",
              owner: evmMode ? (evm.address ?? "") : owner,
              beneficiaryXrpl: draft.beneficiaryXrpl,
              heartbeatReference: created.reference,
              beacon: CONFIG.beacon,
              rules: { heartbeatPeriodSec: draft.heartbeatPeriod, gracePeriodSec: draft.grace, challengePeriodSec: draft.challenge, vetoProofGraceSec: created.vetoProofGrace },
              claimUrl: `${window.location.origin}/claim/${created.vault}`,
            }))}>⇩ Download recovery file</button>
            <button className="btn btn-ghost" onClick={() => nav(`/vault/${created.vault}`)}>Open my plan</button>
            <button className="btn btn-ghost" onClick={() => window.open(`/kit/${created.vault}`, "_blank")}>Recovery Kit (print)</button>
          </div>
          <p className="hint" style={{ fontSize: "0.72rem", color: "var(--mist-2)", marginTop: 10 }}>
            The file is generated locally from your plan — no server involved. Save it with your estate
            documents; the claim recipe inside works even if Heirloom disappears.
          </p>
        </div>
      )}
    </main>
  );
}
