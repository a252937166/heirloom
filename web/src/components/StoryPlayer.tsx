// The five-chapter player: one REAL vault's lifecycle, replayed.
// Every chapter is backed by live keeper events carrying real tx links —
// Alex and Maya are names for the story; the transactions are not actors.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CONFIG } from "../config";
import { PulseDial } from "./PulseDial";
import type { KeeperEvent } from "../pages/Vault";

interface Chapter {
  n: string;
  title: string;
  body: string;
  kinds: string[]; // keeper event kinds that evidence this chapter
  dial: { state: number; frac: number; label: string };
  accent?: string;
}

const CHAPTERS: Chapter[] = [
  {
    n: "01",
    title: "The promise",
    body: "Alex chooses Maya and sets the rules: how long silence may last, and how long the final veto window stays open. One ordinary XRPL payment funds the vault — FAssets mints FXRP straight into it. Alex hands over no keys, to anyone.",
    kinds: ["created", "funding", "minted", "active"],
    dial: { state: 2, frac: 0.04, label: "plan active — 10 FXRP protected" },
  },
  {
    n: "02",
    title: "Still here",
    body: "Life goes on. Every period, Alex sends a 1-drop payment carrying the plan's private reference. Flare's data providers attest it, the epoch bumps, and the dial resets. Cost per heartbeat: a fraction of a cent.",
    kinds: ["heartbeat", "alive"],
    dial: { state: 2, frac: 0.12, label: "heartbeat proven — dial reset" },
  },
  {
    n: "03",
    title: "The silence",
    body: "Then the heartbeats stop. Nobody can say so on Alex's behalf — Maya's claim asks Flare's network for a proof of absence: a source-filtered attestation that no heartbeat existed, chained ledger by ledger from the last one. While Alex was alive, this proof was impossible to produce.",
    kinds: ["claim", "silence"],
    dial: { state: 2, frac: 0.97, label: "silence attested by consensus" },
  },
  {
    n: "04",
    title: "The final veto",
    body: "Even with silence proven, nothing moves yet. A challenge window opens — one heartbeat from Alex would cancel the claim instantly. It is the plan's last kindness to its owner: silence must survive one more chance to be broken.",
    kinds: ["claimStarted"],
    dial: { state: 3, frac: 0.5, label: "challenge window — one heartbeat vetoes" },
  },
  {
    n: "05",
    title: "The handover",
    body: "The window closes unbroken. The vault redeems through FAssets, and native XRP lands on Maya's own XRPL wallet — the one Alex chose, the only one possible. 9.95 XRP, delivered, with the payment reference of the redemption request on the transaction itself.",
    kinds: ["released", "settled", "residual"],
    dial: { state: 5, frac: 1, label: "9.95 XRP delivered to Maya" },
  },
];

export function StoryPlayer() {
  const [events, setEvents] = useState<KeeperEvent[]>([]);
  const [idx, setIdx] = useState(0);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    fetch(`${CONFIG.api}/vaults/${CONFIG.storyVault}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j) => setEvents(j.events ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % CHAPTERS.length), 7000);
    return () => clearInterval(t);
  }, [auto]);

  const ch = CHAPTERS[idx];
  const now = Math.floor(Date.now() / 1000);
  const evidence = useMemo(
    () => events.filter((e) => ch.kinds.includes(e.kind)),
    [events, ch],
  );
  const go = useCallback((i: number) => {
    setAuto(false);
    setIdx(((i % CHAPTERS.length) + CHAPTERS.length) % CHAPTERS.length);
  }, []);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 0 }} className="two-col">
        {/* dial pane */}
        <div style={{ padding: "34px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, borderRight: "1px solid var(--line)" }}>
          <PulseDial
            size={220}
            lastAliveTs={now - Math.floor(3600 * ch.dial.frac)}
            deadlineTs={now + Math.ceil(3600 * (1 - ch.dial.frac))}
            state={ch.dial.state}
            label={ch.dial.label}
          />
          <a className="mono" style={{ fontSize: "0.68rem", color: "var(--mist-2)" }}
            href={`${CONFIG.explorer}/address/${CONFIG.storyVault}`} target="_blank" rel="noreferrer">
            vault {CONFIG.storyVault.slice(0, 10)}… ↗
          </a>
        </div>
        {/* chapter pane */}
        <div style={{ padding: "30px 34px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            {CHAPTERS.map((c, i) => (
              <button
                key={c.n}
                onClick={() => go(i)}
                className="pill"
                style={{
                  cursor: "pointer",
                  background: i === idx ? "color-mix(in srgb, var(--lamplight) 16%, transparent)" : "transparent",
                  color: i === idx ? "var(--lamplight)" : "var(--mist-2)",
                  borderColor: i === idx ? "color-mix(in srgb, var(--lamplight) 50%, transparent)" : "var(--line)",
                }}
              >
                {c.n} · {c.title}
              </button>
            ))}
          </div>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", marginBottom: 10 }}>
            <span style={{ color: "var(--lamplight)" }}>{ch.n}</span> — {ch.title}
          </h3>
          <p style={{ fontSize: "0.95rem", minHeight: 96 }}>{ch.body}</p>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            {evidence.slice(0, 3).map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: "0.78rem" }}>
                <span className="mono" style={{ color: "var(--verdant)" }}>✓</span>
                <span style={{ color: "var(--mist)" }}>{e.label}</span>
                {e.txFlare && <a href={`${CONFIG.explorer}/tx/${e.txFlare}`} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: "0.7rem" }}>Flare tx ↗</a>}
                {e.txXrpl && <a href={`${CONFIG.xrplExplorer}/transactions/${e.txXrpl}`} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: "0.7rem" }}>XRPL tx ↗</a>}
              </div>
            ))}
            {evidence.length === 0 && (
              <span className="mono" style={{ fontSize: "0.72rem", color: "var(--mist-2)" }}>
                loading the real transactions…
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center" }}>
            <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: "0.8rem" }} onClick={() => go(idx - 1)}>← Back</button>
            <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: "0.8rem" }} onClick={() => go(idx + 1)}>Next →</button>
            <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: "0.8rem" }} onClick={() => setAuto((a) => !a)}>
              {auto ? "❚❚ Pause" : "▶ Autoplay"}
            </button>
            <Link to={`/claim/${CONFIG.storyVault}`} style={{ fontSize: "0.8rem", marginLeft: "auto" }}>
              open this plan's receipt →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
