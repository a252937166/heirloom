import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CONFIG } from "../config";
import { FlareMark } from "../components/FlareMark";
import { PulseDial } from "../components/PulseDial";
import { NodeStepper } from "../components/NodeStepper";
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
      } catch { /* decorative — the case strip carries the proof */ }
    })();
  }, []);
  return stats;
}

function MiniStatus({ dot, title, sub, dashed }: { dot: string; title: string; sub: string; dashed?: boolean }) {
  return (
    <div style={{
      background: "var(--ink-2)", border: `1px ${dashed ? "dashed" : "solid"} var(--line)`, borderRadius: 12,
      padding: "10px 13px", minWidth: 148,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.76rem", fontWeight: 600, color: "var(--paper)" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />{title}
      </div>
      <div className="mono" style={{ fontSize: "0.62rem", color: "var(--mist-2)", marginTop: 3 }}>{sub}</div>
    </div>
  );
}

export function Landing() {
  const stats = useLiveStats();
  const now = Math.floor(Date.now() / 1000);
  return (
    <main>
      {/* 1 · hero — copy left, living dial with status cards right */}
      <section className="wrap hero-grid" style={{ padding: "58px 24px 40px", display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 36, alignItems: "center" }}>
        <div>
          <span className="pill" style={{ marginBottom: 18 }}>◈ TESTNET · built on <FlareMark size={12} /></span>
          <h1 style={{ margin: "14px 0 16px" }}>
            Keep the keys.<br />Leave a path.
          </h1>
          <p style={{ fontSize: "1.02rem", maxWidth: 480 }}>
            If you go silent, your XRP reaches the person you chose. Not a day earlier. Heirloom never holds your keys and cannot redirect the payout.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 26, flexWrap: "wrap" }}>
            <Link to="/case/001" className="btn btn-primary">Watch a real plan complete</Link>
            <Link to="/create" className="btn btn-ghost">Create a test plan</Link>
          </div>
          <p className="mono" style={{ fontSize: "0.68rem", marginTop: 16, color: "var(--mist-2)" }}>
            No EVM wallet needed on the XRP-native path · no seed phrases shared · no custody.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 12 }}>
            <MiniStatus dot="var(--verdant)" title="You're in control" sub="heartbeat received · 8m ago" />
            <MiniStatus dot="var(--mist-2)" title="Silence window" sub="not started" />
          </div>
          <PulseDial size={218} lastAliveTs={now - 480} deadlineTs={now + 3120} state={2} label="you're in control" />
          <div style={{ display: "grid", gap: 12 }}>
            <MiniStatus dot="var(--mist-2)" title="Final veto" sub="not started" />
            <MiniStatus dot="var(--ember)" title="Would unlock" sub="only if silence is proven" dashed />
            <p className="mono" style={{ fontSize: "0.58rem", color: "var(--mist-2)", margin: 0, maxWidth: 150 }}>
              illustrative plan state
            </p>
          </div>
        </div>
      </section>

      {/* 2 · metric cards */}
      <section className="wrap" style={{ padding: "0 24px 30px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div className="metric"><span className="ic">▦</span><span><b>{stats.plans ?? "…"}</b><span className="lbl">Plans created</span></span></div>
          <div className="metric"><span className="ic green">◈</span><span><b>{stats.protectedXrp ?? "…"} FXRP</b><span className="lbl">Protected (sampled plans)</span></span></div>
          <div className="metric"><span className="ic violet">⇄</span><span><b>{mcase.payoutXrp} XRP</b><span className="lbl">Delivered in Case #001</span></span></div>
          <div className="metric"><span className="ic orange">⛨</span><span><b>0</b><span className="lbl">Heirloom-held keys</span></span></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 12 }}>
          {[
            ["✍", "You keep control", "cancel anytime with one XRPL payment"],
            ["✕", "Nobody can claim early", "strict rules on-chain block premature access"],
            ["♥", "XRP reaches your family", "native XRP to their wallet, automatically"],
            ["◎", "Proven on two ledgers", "XRPL events + Flare proofs make it verifiable"],
          ].map(([ic, t, s]) => (
            <div key={t} style={{ display: "flex", gap: 11, alignItems: "flex-start", border: "1px solid var(--line)", borderRadius: 13, padding: "13px 15px", background: "color-mix(in srgb, var(--paper) 1.5%, transparent)" }}>
              <span style={{ color: "var(--mist-2)", fontSize: "0.95rem", lineHeight: 1.5 }}>{ic}</span>
              <span>
                <span style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "var(--paper)" }}>{t}</span>
                <span style={{ display: "block", fontSize: "0.72rem", color: "var(--mist-2)" }}>{s}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 3 · the canonical case strip */}
      <section className="wrap" style={{ padding: "14px 24px 40px" }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>A real plan, settled</div>
        <div className="card" style={{ display: "grid", gridTemplateColumns: "215px 1fr", gap: 26, alignItems: "center" }}>
          <div style={{ borderRight: "1px solid var(--line)", paddingRight: 22 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <span className="mono" style={{ fontSize: "0.7rem", color: "var(--mist)" }}>Case #001</span>
              <span className="pill ok" style={{ fontSize: "0.58rem", padding: "2px 8px" }}>SETTLED</span>
            </div>
            <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--paper)" }}>Alex → Maya</div>
            <div className="mono" style={{ fontSize: "0.66rem", color: "var(--mist-2)", margin: "6px 0 12px" }}>
              {mcase.protectedFxrp} FXRP protected<br />{mcase.payoutXrp} XRP delivered
            </div>
            <Link to="/case/001" className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: "0.78rem" }}>View full case ›</Link>
          </div>
          <NodeStepper size={42} items={[
            { icon: "✍", label: "Promise", sub: "created", state: "done" },
            { icon: "⇄", label: "Funded", sub: "XRPL → FXRP", state: "done" },
            { icon: "♥", label: "Heartbeat", sub: "recorded", state: "done" },
            { label: "Early claim", sub: "blocked", state: "fail" },
            { icon: "◎", label: "Silence", sub: "proven", state: "done" },
            { icon: "⏳", label: "Challenge", sub: "passed", state: "done" },
            { label: "XRP", sub: "delivered", state: "done" },
          ]} />
        </div>
      </section>

      {/* 4 · two impossibilities + why Flare */}
      <section className="wrap" style={{ padding: "10px 24px 40px" }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Two impossibilities, proven</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.9fr", gap: 14 }} className="two-col">
          <div className="card">
            <span style={{ display: "inline-grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, background: "color-mix(in srgb, var(--lamplight) 14%, transparent)", color: "var(--lamplight-strong)", marginBottom: 10 }}>♥</span>
            <h3 style={{ marginBottom: 8 }}>Copycat heartbeat ignored</h3>
            <p style={{ fontSize: "0.85rem" }}>
              An attacker copied the exact memo to fake activity. The proof checks the real owner only —
              source-filtered at the consensus level.
            </p>
            <p className="mono" style={{ fontSize: "0.72rem", marginTop: 10 }}>
              <span style={{ color: "var(--verdant)" }}>✓ Result: ignored</span>
            </p>
            <Link to="/case/001?chapter=silence" className="btn btn-ghost" style={{ marginTop: 12, padding: "6px 13px", fontSize: "0.75rem" }}>View proof</Link>
          </div>
          <div className="card">
            <span style={{ display: "inline-grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, background: "color-mix(in srgb, var(--ember) 13%, transparent)", color: "var(--ember)", marginBottom: 10 }}>✕</span>
            <h3 style={{ marginBottom: 8 }}>Early claim blocked</h3>
            <p style={{ fontSize: "0.85rem" }}>
              Maya tried to claim before time. The contract refused — the silence proof cannot even be built
              while the owner acts.
            </p>
            <p className="mono" style={{ fontSize: "0.72rem", marginTop: 10 }}>
              <span style={{ color: "var(--ember)" }}>✕ Result: rejected</span>
            </p>
            <Link to="/case/001?chapter=early-claim" className="btn btn-ghost" style={{ marginTop: 12, padding: "6px 13px", fontSize: "0.75rem" }}>View attempt</Link>
          </div>
          <div className="card" style={{ background: "color-mix(in srgb, var(--lamplight) 5%, var(--ink-2))" }}>
            <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>Why <FlareMark size={13} /></div>
            <ul style={{ listStyle: "none", display: "grid", gap: 10, fontSize: "0.82rem", color: "var(--mist)" }}>
              <li>◆ FAssets makes XRP programmable</li>
              <li>◆ FDC verifies XRPL events</li>
              <li>◆ ReferencedPaymentNonexistence proves silence</li>
              <li>◆ Anyone can execute · no single operator</li>
            </ul>
            <Link to="/case/001#audit" style={{ display: "inline-block", marginTop: 14, fontSize: "0.8rem" }}>Learn more →</Link>
          </div>
        </div>
      </section>

      {/* 5 · CTA */}
      <section className="wrap" style={{ padding: "10px 24px 30px" }}>
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Sixty seconds to a living plan.</h2>
            <p style={{ fontSize: "0.9rem" }}>
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
