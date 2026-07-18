import { Link } from "react-router-dom";
import { CONFIG } from "../config";
import { StoryPlayer } from "../components/StoryPlayer";
import { FlareMark } from "../components/FlareMark";

export function Landing() {
  return (
    <main>
      {/* 1 · hero: the task, not the protocol */}
      <section className="wrap" style={{ padding: "78px 24px 54px", maxWidth: 900, textAlign: "center" }}>
        <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center" }}>The continuity vault for XRP · built on <FlareMark size={15} /></div>
        <h1 style={{ margin: "16px 0 18px" }}>
          Keep the keys.<br />
          <em style={{ color: "var(--lamplight)", fontStyle: "italic" }}>Leave a path.</em>
        </h1>
        <p style={{ fontSize: "1.08rem", maxWidth: 640, margin: "0 auto" }}>
          You stay in control through simple XRP heartbeats. If those heartbeats stop, Flare proves the
          silence, gives you one final veto window — and only then redeems your XRP to the wallet you chose.
        </p>
        <div style={{ display: "flex", gap: 14, marginTop: 30, justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/case/001" className="btn btn-primary">Watch a real plan complete</Link>
          <Link to="/create" className="btn btn-ghost">Create a test plan</Link>
        </div>
        <p className="mono" style={{ fontSize: "0.72rem", marginTop: 18, color: "var(--mist-2)" }}>
          No EVM wallet. No seed phrases shared. No company custody.
        </p>
      </section>

      {/* 2 · the real plan, replayed */}
      <section id="story" className="wrap" style={{ padding: "44px 24px" }}>
        <div className="eyebrow">One plan · two people · five moments</div>
        <h2 style={{ margin: "10px 0 6px" }}>A real plan, replayed.</h2>
        <p style={{ fontSize: "0.92rem", marginBottom: 18, maxWidth: 640 }}>
          This is not a mockup. "Alex" and "Maya" are names for the story — the vault, the proofs and every
          transaction below ran on Flare Coston2 and the XRPL testnet, and each one links to its explorer page.
        </p>
        <StoryPlayer />
        <div className="card" style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="mono" style={{ fontSize: "0.66rem", color: "var(--verdant)", marginBottom: 6 }}>CASE 001 · COMPLETED</div>
            <p style={{ fontSize: "0.88rem", color: "var(--mist)", margin: 0 }}>
              One funding payment · one owner heartbeat · one blocked early claim · one verified silence
              window · native XRP payout confirmed — with a reconciled receipt and integrity checks.
            </p>
          </div>
          <Link className="btn btn-ghost" to="/case/001" style={{ whiteSpace: "nowrap" }}>Open the full case dashboard →</Link>
        </div>
      </section>

      {/* 3 · two perspectives */}
      <section className="wrap" style={{ padding: "44px 24px" }}>
        <div className="eyebrow">Two people, one promise</div>
        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 16 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>While Alex is active</h3>
            <ul style={{ color: "var(--mist)", fontSize: "0.92rem", paddingLeft: 18, display: "grid", gap: 8 }}>
              <li>keeps the XRPL keys — Heirloom never sees them</li>
              <li>sends 1-drop heartbeats that reset the dial</li>
              <li>can cancel anytime and redeem everything back</li>
              <li>can veto a pending claim with a single heartbeat</li>
            </ul>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>If Alex can no longer act</h3>
            <ul style={{ color: "var(--mist)", fontSize: "0.92rem", paddingLeft: 18, display: "grid", gap: 8 }}>
              <li>Maya opens the printed Recovery Kit</li>
              <li>Flare's network proves the inactivity — no company decides</li>
              <li>the final challenge window runs its course</li>
              <li>native XRP arrives on Maya's own wallet</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 4 · the plan survives two attacks */}
      <section id="impossible" className="wrap" style={{ padding: "44px 24px" }}>
        <div className="eyebrow">Watch the plan survive two attacks</div>
        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 16 }}>
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>An attacker fakes Alex's heartbeat.</h3>
            <p style={{ fontSize: "0.92rem" }}>
              Copying the exact memo changes nothing: silence proofs are <em>source-filtered</em>, so payments
              not signed by Alex's address are invisible to them. We staged this attack on-chain — the attacker
              spammed identical heartbeats and the network still attested the silence.
            </p>
            <p style={{ marginTop: 10, fontSize: "0.78rem" }} className="mono">
              copycat payments → ignored · silence proof → still VALID
            </p>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Maya tries to claim early.</h3>
            <p style={{ fontSize: "0.92rem" }}>
              While Alex lives, the proof of silence is mathematically unproducible — the verifier answers{" "}
              <span className="mono">REFERENCED TRANSACTION EXISTS</span>. And even after real silence, the
              challenge window still lets one heartbeat cancel everything.
            </p>
            <p style={{ marginTop: 10, fontSize: "0.78rem" }} className="mono">
              early claim → SilenceNotProven · challenge veto → ClaimVetoed
            </p>
          </div>
        </div>
      </section>

      {/* 5 · why only Flare */}
      <section className="wrap" style={{ padding: "44px 24px" }}>
        <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7 }}>Why this needs <FlareMark size={16} /> — two ledgers, one plan</div>
        <div className="rails" style={{ marginTop: 8 }}>
          <span className="rail-label xrpl">XRP Ledger — where you act</span>
          <div className="rail xrpl" />
          <div className="rail-steps">
            <div className="rail-step">
              <div className="where">XRPL → FLARE</div>
              <h3>Fund with one payment</h3>
              <p>FAssets mints FXRP straight into your personal vault contract. XRPL alone cannot custody XRP programmatically.</p>
            </div>
            <div className="rail-step">
              <div className="where">XRPL</div>
              <h3>Heartbeats are facts</h3>
              <p>FDC payment proofs turn 1-drop payments into on-chain truths. Liveness stops being somebody's database.</p>
            </div>
            <div className="rail-step">
              <div className="where">FLARE</div>
              <h3>Silence is proven</h3>
              <p>ReferencedPaymentNonexistence — the industry's only consensus proof of absence, source-filtered and chained.</p>
            </div>
            <div className="rail-step">
              <div className="where">FLARE → XRPL</div>
              <h3>Real XRP returns home</h3>
              <p>FAssets redemption delivers native XRP to the beneficiary's wallet. Remove any piece and the product collapses.</p>
            </div>
          </div>
          <div className="rail flare" />
          <span className="rail-label flare" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><FlareMark size={13} /> — where it is proven and enforced</span>
        </div>
      </section>

      {/* 6 · CTA */}
      <section className="wrap" style={{ padding: "40px 24px" }}>
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Sixty seconds to a living plan.</h2>
            <p style={{ fontSize: "0.92rem" }}>
              Runs today on Flare Coston2 and the XRPL testnet — every step a real transaction you can verify.
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
