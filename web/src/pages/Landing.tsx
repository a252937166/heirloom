import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CONFIG } from "../config";
import { FlareMark } from "../components/FlareMark";
import { PulseDial } from "../components/PulseDial";
import { factory, fxrp } from "../lib/chain";
import mcase from "../case-001.json";

// live, honest numbers straight from the chain — no marketing counters
function useLiveStats() {
  const [stats, setStats] = useState<{ plans: number | null; protectedXrp: string | null }>({ plans: null, protectedXrp: null });
  useEffect(() => {
    (async () => {
      try {
        const count = Number(await factory.vaultCount());
        let sum = 0n;
        const n = Math.min(count, 24);
        const addrs = await Promise.all(Array.from({ length: n }, (_, i) => factory.vaults(i).catch(() => null)));
        const bals = await Promise.all(addrs.filter(Boolean).map((a) => fxrp.balanceOf(a).catch(() => 0n)));
        for (const b of bals) sum += b as bigint;
        setStats({ plans: count, protectedXrp: (Number(sum) / 1e6).toFixed(2) });
      } catch { /* stats are decorative — the case strip below carries the proof */ }
    })();
  }, []);
  return stats;
}

const CASE_NODES: [string, string][] = [
  ["✓", "Promise"], ["✓", "Funded"], ["✓", "Heartbeat"], ["✕", "Early claim"],
  ["✓", "Silence"], ["✓", "Challenge"], ["✓", "Payout"],
];

export function Landing() {
  const stats = useLiveStats();
  const now = Math.floor(Date.now() / 1000);
  return (
    <main>
      {/* 1 · hero: the task on the left, the living dial on the right */}
      <section className="wrap hero-grid" style={{ padding: "64px 24px 46px", display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 40, alignItems: "center" }}>
        <div>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7 }}>The continuity vault for XRP · built on <FlareMark size={15} /></div>
          <h1 style={{ margin: "16px 0 18px" }}>
            Keep the keys.<br />
            <em style={{ color: "var(--lamplight)", fontStyle: "italic" }}>Leave a path.</em>
          </h1>
          <p style={{ fontSize: "1.08rem", maxWidth: 560 }}>
            You stay in control through simple XRP heartbeats. If those heartbeats stop, Flare proves the
            silence, gives you one final veto window — and only then redeems your XRP to the wallet you chose.
          </p>
          <div style={{ display: "flex", gap: 14, marginTop: 28, flexWrap: "wrap" }}>
            <Link to="/case/001" className="btn btn-primary">Watch a real plan complete</Link>
            <Link to="/create" className="btn btn-ghost">Create a test plan</Link>
          </div>
          <p className="mono" style={{ fontSize: "0.72rem", marginTop: 16, color: "var(--mist-2)" }}>
            No EVM wallet needed on the XRP-native path · no seed phrases shared · no company custody.
          </p>
        </div>
        <div style={{ textAlign: "center", justifySelf: "center" }}>
          <PulseDial size={230} lastAliveTs={now - 480} deadlineTs={now + 3120} state={2} label="you're in control — heartbeat received" />
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
            <span className="pill" style={{ fontSize: "0.62rem", color: "var(--verdant)" }}>silence window · not started</span>
            <span className="pill" style={{ fontSize: "0.62rem", color: "var(--mist-2)" }}>final veto · not started</span>
          </div>
        </div>
      </section>

      {/* live counters — honest, read from the chain */}
      <section className="wrap" style={{ padding: "0 24px 34px" }}>
        <div style={{ display: "flex", gap: 26, flexWrap: "wrap", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", padding: "14px 4px" }}>
          {[
            ["Plans created", stats.plans === null ? "…" : String(stats.plans)],
            ["XRP protected right now", stats.protectedXrp === null ? "…" : `${stats.protectedXrp} FXRP`],
            ["Canonical case", "settled · reconciled"],
            ["Custody", "100% non-custodial"],
          ].map(([k, v]) => (
            <span key={k} className="mono" style={{ fontSize: "0.74rem", color: "var(--mist)" }}>
              {k} <strong style={{ color: "var(--paper)" }}>{v}</strong>
            </span>
          ))}
        </div>
      </section>

      {/* 2 · the canonical case, compressed to one strip (full story lives in /case/001) */}
      <section className="wrap" style={{ padding: "10px 24px 40px" }}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <div>
              <span className="mono" style={{ fontSize: "0.66rem", color: "var(--verdant)" }}>A REAL PLAN, SETTLED · CASE #001</span>
              <h2 style={{ margin: "6px 0 0", fontSize: "1.4rem" }}>Alex → Maya, end to end.</h2>
            </div>
            <span className="mono" style={{ fontSize: "0.7rem", color: "var(--mist)" }}>
              {mcase.protectedFxrp} FXRP protected · {mcase.payoutXrp} XRP delivered · {mcase.finalFxrpBalance} FXRP residual, disclosed
            </span>
          </div>
          <div className="rail-row" style={{ display: "flex", gap: 8, alignItems: "center", overflowX: "auto", padding: "4px 0 12px" }}>
            {CASE_NODES.map(([mark, label], i) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                {i > 0 && <span className="rail-sep" style={{ flex: 1, height: 1, background: "var(--line)", minWidth: 12 }} />}
                <span className="pill" style={{ whiteSpace: "nowrap", fontSize: "0.68rem", color: mark === "✕" ? "var(--ember)" : "var(--verdant)" }}>
                  {mark} {label}
                </span>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link to="/case/001" className="btn btn-primary" style={{ padding: "9px 18px", fontSize: "0.85rem" }}>Open the live case</Link>
            <Link to="/case/001?tour=1" className="btn btn-ghost" style={{ padding: "9px 18px", fontSize: "0.85rem" }}>▶ 90-second tour</Link>
            <span className="mono" style={{ alignSelf: "center", fontSize: "0.66rem", color: "var(--mist-2)" }}>
              every step links to a public transaction · integrity checks generated from chain data
            </span>
          </div>
        </div>
      </section>

      {/* 3 · two perspectives */}
      <section className="wrap" style={{ padding: "24px 24px" }}>
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
      <section id="impossible" className="wrap" style={{ padding: "24px 24px" }}>
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
      <section className="wrap" style={{ padding: "24px 24px" }}>
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
