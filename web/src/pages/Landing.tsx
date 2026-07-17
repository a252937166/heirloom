import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { PulseDial } from "../components/PulseDial";
import { CONFIG } from "../config";

// The hero dial runs the whole lifecycle as a 24 s ambient loop:
// alive (pulsing) → silence fills → claim challenge → released.
function HeroDial() {
  const [phase, setPhase] = useState(0); // 0 alive, 1 silence, 2 challenge, 3 released
  const [anchor, setAnchor] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const seq = [7000, 9000, 5000, 3000];
    const t = setTimeout(() => {
      setPhase((p) => (p + 1) % 4);
      setAnchor(Math.floor(Date.now() / 1000));
    }, seq[phase]);
    return () => clearTimeout(t);
  }, [phase]);
  const now = Math.floor(Date.now() / 1000);
  const props =
    phase === 0
      ? { lastAliveTs: now - 2, deadlineTs: now + 88, state: 2, label: "owner is alive — dial resets" }
      : phase === 1
        ? { lastAliveTs: anchor - 1, deadlineTs: anchor + 9, state: 2, label: "silence accumulating" }
        : phase === 2
          ? { lastAliveTs: anchor - 60, deadlineTs: anchor - 1, state: 3, label: "final challenge — owner can still veto" }
          : { lastAliveTs: anchor - 60, deadlineTs: anchor - 1, state: 5, label: "released to the beneficiary" };
  return <PulseDial size={300} {...props} />;
}

export function Landing() {
  return (
    <main>
      <section className="wrap" style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 40, alignItems: "center", padding: "72px 24px 60px" }} >
        <div>
          <div className="eyebrow">The continuity vault for XRP · built on Flare</div>
          <h1 style={{ margin: "14px 0 18px" }}>
            Your XRP, under your rules —<br />
            <em style={{ color: "var(--lamplight)", fontStyle: "italic" }}>even when you can no longer act.</em>
          </h1>
          <p style={{ fontSize: "1.05rem", maxWidth: 520 }}>
            Stay in control while you are active. If you go verifiably silent, and only after a final safety
            challenge, the person you chose receives your actual XRP — on their own XRPL wallet.
          </p>
          <div style={{ display: "flex", gap: 14, marginTop: 28 }}>
            <Link to="/create" className="btn btn-primary">Create your plan — one XRPL payment</Link>
            <a href="#impossible" className="btn btn-ghost">How it can't go wrong</a>
          </div>
          <p className="mono" style={{ fontSize: "0.72rem", marginTop: 18, color: "var(--mist-2)" }}>
            No EVM wallet. No seed phrases shared. No company custody.
          </p>
        </div>
        <div style={{ justifySelf: "center" }}>
          <HeroDial />
        </div>
      </section>

      <section id="impossible" className="wrap" style={{ padding: "50px 24px" }}>
        <div className="eyebrow">Two impossibilities, both proven by Flare consensus</div>
        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 18 }}>
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>An attacker cannot keep you "alive."</h3>
            <p style={{ fontSize: "0.92rem" }}>
              Heartbeats only count when they come from <em>your</em> XRPL address. Silence is proven with a
              source-filtered <span className="mono">ReferencedPaymentNonexistence</span> attestation — a copycat
              payment with your exact memo is simply invisible to the proof. We demonstrated this on-chain: an
              attacker sent identical heartbeats and the network still attested the silence.
            </p>
            <p style={{ marginTop: 10, fontSize: "0.8rem" }} className="mono">
              verifier: INVALID — REFERENCED TRANSACTION EXISTS ← only for the real owner
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>The beneficiary cannot come early.</h3>
            <p style={{ fontSize: "0.92rem" }}>
              While you are alive, the silence proof is mathematically impossible to produce — Flare's data
              providers will not attest to a silence that did not happen. And even after real silence, a final
              challenge window lets one heartbeat from you cancel everything.
            </p>
            <p style={{ marginTop: 10, fontSize: "0.8rem" }} className="mono">
              early claim → revert SilenceNotProven · challenge veto → ClaimVetoed
            </p>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ padding: "60px 24px" }}>
        <div className="eyebrow">How it works — two ledgers, one plan</div>
        <div className="rails" style={{ marginTop: 10 }}>
          <span className="rail-label xrpl">XRP Ledger — where you act</span>
          <div className="rail xrpl" />
          <div className="rail-steps">
            <div className="rail-step">
              <div className="where">XRPL → FLARE</div>
              <h3>1 · Fund with one payment</h3>
              <p>Send XRP once. FAssets mints FXRP straight into your personal vault contract. No EVM wallet involved.</p>
            </div>
            <div className="rail-step">
              <div className="where">XRPL</div>
              <h3>2 · Stay alive cheaply</h3>
              <p>Each period, send a 1-drop payment with your private reference. The dial resets. Cancel anytime the same way.</p>
            </div>
            <div className="rail-step">
              <div className="where">FLARE</div>
              <h3>3 · Silence is proven, not assumed</h3>
              <p>Rolling attestations chain ledger-by-ledger. A claim opens only when consensus says you were silent — then a challenge window still protects you.</p>
            </div>
            <div className="rail-step">
              <div className="where">FLARE → XRPL</div>
              <h3>4 · Real XRP reaches them</h3>
              <p>The vault redeems through FAssets. Your beneficiary receives native XRP on their own wallet — no new apps, no keys handed over.</p>
            </div>
          </div>
          <div className="rail flare" />
          <span className="rail-label flare">Flare — where it is proven and enforced</span>
        </div>
      </section>

      <section className="wrap" style={{ padding: "50px 24px" }}>
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Sixty seconds to a living plan.</h2>
            <p style={{ fontSize: "0.92rem" }}>
              Runs today on Flare Coston2 and the XRPL testnet — every step is a real transaction you can verify.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Link to="/create" className="btn btn-primary">Create your plan</Link>
            <a className="btn btn-ghost" href={`${CONFIG.explorer}/address/${CONFIG.factory}`} target="_blank" rel="noreferrer">
              Factory on explorer ↗
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
