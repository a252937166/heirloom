import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CONFIG, STATE_NAMES } from "../config";
import { readVault, short, vaultsOfOwner } from "../lib/chain";
import {
  REHEARSAL_STEPS, StepId, RehearsalSession,
  loadSession, newSession, saveSession, clearSession, markDone, doneCount, buildReceipt,
  drillSatisfies, classifyRun, heartbeatSatisfies, DrillEventLike,
} from "../lib/rehearsal";
import { useWallet } from "../App";
import { CopyBtn } from "../components/CopyBtn";
import { KeeperEvent } from "./Vault";

// The Recovery Kit says "rehearse the claim once, together, today" — this page
// is that sentence as a product surface: a two-person run sheet where every
// check that CAN be verified on-chain or in the keeper's public journal is
// verified there, never by a click. (The two self-attested steps say so.)

const DEBRIEF = [
  {
    id: "keys",
    q: "Who could move the protected XRP today?",
    options: {
      A: "Heirloom's operators",
      B: "Only the vault contract, under its published rules — Heirloom holds no keys",
      C: "The beneficiary, whenever they want",
    },
    correct: "B",
  },
  {
    id: "early",
    q: "What happened when your beneficiary tried to claim early?",
    options: {
      A: "The claim went into a queue for review",
      B: "The chain refused — silence cannot be proven while the owner acts",
      C: "Support had to cancel it",
    },
    correct: "B",
  },
  {
    id: "veto",
    q: "After a real claim starts, can the owner still stop it?",
    options: {
      A: "No — a started claim is final",
      B: "Yes — one heartbeat sent before the cutoff vetoes the whole claim",
      C: "Only by asking Heirloom to intervene",
    },
    correct: "B",
  },
] as const;

type StepStatus = "done" | "ready" | "locked";

interface StepCopy {
  title: string;
  who: "OWNER" | "BENEFICIARY" | "BOTH";
  instruction: ReactNode;
  verified: string; // how completion is judged — shown under the title
}

function fmtClock(sec: number) {
  return new Date(sec * 1000).toLocaleTimeString();
}

export function Rehearsal() {
  const [params] = useSearchParams();
  const { wallet, evm, openConnect } = useWallet();
  const [session, setSession] = useState<RehearsalSession | null>(() => loadSession());
  const [vaultInput, setVaultInput] = useState("");
  const [bindErr, setBindErr] = useState<string | null>(null);
  const [myPlans, setMyPlans] = useState<string[]>([]);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [vaultState, setVaultState] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const update = useCallback((s: RehearsalSession) => { saveSession(s); setSession({ ...s }); }, []);
  // every mutation starts from the persisted session, not the render's copy —
  // the evidence timer writes concurrently and last-write-wins must not lose steps
  const fresh = useCallback((): RehearsalSession | null => loadSession(), []);

  // ?vault= deep link (the Kit links here) binds the plan before anything else
  useEffect(() => {
    const qv = params.get("vault");
    if (qv && /^0x[0-9a-fA-F]{40}$/.test(qv)) setVaultInput(qv);
  }, [params]);

  // a connected wallet completes this step by evidence, not by click — either
  // ledger counts: XRPL is the flagship path, EVM-owner mode is a supported one
  useEffect(() => {
    if (!session || session.steps.wallet) return;
    const addr = wallet.address ?? evm.address;
    if (!addr) return;
    const cur = fresh();
    if (!cur || cur.steps.wallet) return;
    update(markDone({ ...cur, mode: wallet.address ? "gemwallet" : "evm" }, "wallet", addr));
  }, [wallet.address, evm.address, session, update, fresh]);

  // plans owned by the connected wallet — the cheap way to bind without pasting
  useEffect(() => {
    if (!wallet.address) return;
    vaultsOfOwner(wallet.address).then((vs) => setMyPlans(vs.slice().reverse())).catch(() => {});
  }, [wallet.address]);

  const bindVault = useCallback(async (addr: string) => {
    setBindErr(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setBindErr("That is not a Coston2 contract address (0x…, 42 characters)."); return; }
    try {
      const v = await readVault(addr);
      const cur = fresh();
      if (!cur) return;
      // the receipt must never confuse "this run did it" with "history already
      // had it": classify by creation time and freeze a baseline to judge against
      const runType = classifyRun(v.creationTs, cur.startedAt);
      let s: RehearsalSession = {
        ...cur, vault: addr, runType,
        baseline: { state: v.state, heartbeatEpoch: v.heartbeatEpoch, creationTs: v.creationTs, boundAt: Math.floor(Date.now() / 1000) },
      };
      s = markDone(s, "create", runType === "fresh-plan" ? addr : `${addr} · pre-existing plan`);
      if (v.state >= 2) s = markDone(s, "fund", runType === "fresh-plan" ? `state=${STATE_NAMES[v.state]}` : `state=${STATE_NAMES[v.state]} · pre-existing`);
      // fresh plans: any proven epoch counts; existing plans start un-earned —
      // the epoch must GROW during the rehearsal (the poll below watches for it)
      if (runType === "fresh-plan" && v.heartbeatEpoch >= 1) s = markDone(s, "heartbeat", `epoch=${v.heartbeatEpoch}`);
      setVaultState(v.state);
      update(s);
    } catch {
      setBindErr("No vault answers at that address — check the plan page URL (it ends with your vault address).");
    }
  }, [fresh, update]);

  // evidence poll: one chain read + one keeper read, every 12s while something
  // verifiable is still open. Completion cascades from state, never from clicks.
  // Always re-read the persisted session first — a timer callback holding a
  // stale render's copy would silently overwrite steps completed in between.
  const verify = useCallback(async () => {
    const cur = loadSession();
    if (!cur?.vault) return;
    setChecking(true);
    try {
      let s = cur;
      const v = await readVault(cur.vault);
      setVaultState(v.state);
      const runType = s.runType ?? "fresh-plan";
      const baselineEpoch = s.baseline?.heartbeatEpoch ?? 0;
      if (!s.steps.fund && v.state >= 2) s = markDone(s, "fund", `state=${STATE_NAMES[v.state]}`);
      if (!s.steps.heartbeat && heartbeatSatisfies(v.heartbeatEpoch, runType, baselineEpoch)) {
        s = markDone(s, "heartbeat", runType === "fresh-plan" ? `epoch=${v.heartbeatEpoch}` : `epoch ${baselineEpoch}→${v.heartbeatEpoch} during this run`);
      }
      if (!s.steps.drill && s.steps.heartbeat) {
        const r = await fetch(`${CONFIG.api}/vaults/${cur.vault}`);
        if (r.ok) {
          const evs: DrillEventLike[] = (await r.json()).events ?? [];
          // verdict is structural (Active vault + SilenceNotProven + this run) —
          // a friendly "blocked" on a settled plan can never complete the drill
          const hit = evs.find((e) => drillSatisfies(e, s));
          if (hit) s = markDone(s, "drill", `${fmtClock(hit.at)} · SilenceNotProven refused in a live-chain staticCall${hit.rh ? " · run-tagged" : ""}`);
        }
      }
      if (s !== cur) update(s);
    } catch { /* transient — the next tick retries */ }
    setCheckedAt(Math.floor(Date.now() / 1000));
    setChecking(false);
  }, [update]);

  useEffect(() => {
    if (!session?.vault) return;
    const open = REHEARSAL_STEPS.some((id) => !session.steps[id] && (id === "fund" || id === "heartbeat" || id === "drill"));
    if (!open) return;
    verify();
    const t = setInterval(verify, 12_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.vault, session?.steps.fund, session?.steps.heartbeat, session?.steps.drill]);

  const statusOf = useMemo(() => {
    const done = new Set(REHEARSAL_STEPS.filter((id) => session?.steps[id]));
    return (id: StepId): StepStatus => {
      if (done.has(id)) return "done";
      const idx = REHEARSAL_STEPS.indexOf(id);
      const prevDone = REHEARSAL_STEPS.slice(0, idx).every((p) => done.has(p));
      return prevDone ? "ready" : "locked";
    };
  }, [session]);

  const allDone = session ? doneCount(session) === REHEARSAL_STEPS.length : false;

  const downloadReceipt = useCallback(() => {
    if (!session) return;
    const receipt = buildReceipt(session);
    const scored = DEBRIEF.map((d) => ({ id: d.id, answered: session.answers?.[d.id] ?? null, correct: session.answers?.[d.id] === d.correct }));
    const blob = new Blob([JSON.stringify({ ...receipt, debriefScore: scored }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `heirloom-rehearsal-${session.runId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [session]);

  if (!session) {
    return (
      <main className="wrap" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 860 }}>
        <p className="mono" style={{ fontSize: "0.66rem", letterSpacing: "0.14em", color: "var(--mist-2)" }}>REHEARSE THE HANDOVER</p>
        <h1 style={{ margin: "6px 0 10px" }}>Two people. One dry run. Real chain.</h1>
        <p style={{ maxWidth: 640, marginBottom: 8 }}>
          The Recovery Kit tells you to <em>rehearse the claim once, together, today</em>. This run sheet walks an
          owner and their beneficiary through the whole path on testnet — funding, heartbeat, the early-claim
          drill the chain must refuse — and hands you a receipt at the end. It runs only on Coston2 and the
          XRPL Testnet, on free test XRP — no real assets are used.
        </p>
        <p className="hint" style={{ fontSize: "0.8rem", color: "var(--mist-2)", maxWidth: 640, marginBottom: 20 }}>
          Honest scoring: four checks flip only on chain or keeper evidence, the wallet step is evidenced by
          your local session, and the two interpersonal steps (handing over the Kit, the debrief) say
          "self-attested" on the receipt.
        </p>
        <button className="btn btn-primary" onClick={() => setSession(newSession())}>Start a rehearsal</button>
        <Link to="/case/001" className="btn btn-ghost" style={{ marginLeft: 10 }}>Watch the finished case first</Link>
      </main>
    );
  }

  const steps: Record<StepId, StepCopy> = {
    wallet: {
      title: "Get the owner's wallet ready",
      who: "OWNER",
      verified: "verified by a connected wallet — or your explicit choice of the manual path",
      instruction: (
        <>
          <p>
            Install <a href="https://gemwallet.app" target="_blank" rel="noreferrer">GemWallet ↗</a> and press{" "}
            <strong>"Connect Wallet"</strong> (top right), then use the account menu's one-click test-XRP faucet.
            Any other XRPL wallet works too — every payment in this app is also shown as copyable instructions.
            No funded Testnet account yet? The{" "}
            <a href="https://xrpl.org/resources/dev-tools/xrp-faucets" target="_blank" rel="noreferrer">official XRPL faucet ↗</a>{" "}
            can generate one — import that test-only account into a Testnet-capable wallet, and never reuse its
            seed on Mainnet. A MetaMask/OKX wallet also counts here: EVM-owner mode is the alternative setup,
            with one-click check-ins on Coston2.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <button className="btn btn-primary" onClick={openConnect}>Connect a wallet</button>
            <button className="btn btn-ghost" onClick={() => update(markDone({ ...session, mode: "manual" }, "wallet", "manual path"))}>
              Continue with the manual path
            </button>
          </div>
        </>
      ),
    },
    create: {
      title: "Create the plan",
      who: "OWNER",
      verified: "verified when the vault contract answers on Coston2",
      instruction: (
        <>
          <p>
            Open <a href="/create" target="_blank" rel="noreferrer"><strong>Create a plan</strong> ↗</a> and finish
            through step 6 (Share). Choose a real second person as beneficiary if you can — the rehearsal is theirs
            too. Then come back and bind the vault address (it is the tail of your plan page's URL).
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <input name="rehearsal-vault" aria-label="Vault address" placeholder="0x… vault address" value={vaultInput} onChange={(e) => setVaultInput(e.target.value.trim())} style={{ minWidth: 300 }} />
            <button className="btn btn-primary" onClick={() => bindVault(vaultInput)}>Bind this plan</button>
          </div>
          {myPlans.length > 0 && (
            <p className="hint" style={{ marginTop: 8, fontSize: "0.78rem" }}>
              Plans on your connected wallet:{" "}
              {myPlans.slice(0, 3).map((p) => (
                <button key={p} className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: "0.74rem", marginRight: 6 }} onClick={() => bindVault(p)}>
                  {short(p, 6)}
                </button>
              ))}
            </p>
          )}
          {bindErr && <p className="hint" style={{ color: "var(--ember)", marginTop: 8 }}>{bindErr}</p>}
        </>
      ),
    },
    fund: {
      title: "Fund it with one XRPL payment",
      who: "OWNER",
      verified: "verified when FXRP lands and the vault turns Active on-chain",
      instruction: (
        <p>
          Pay the funding quote from the Create page's <strong>"Protect"</strong> step — one click with GemWallet,
          or the copyable manual payment (exact drops + memo).{" "}
          {session.vault && <a href={`/vault/${session.vault}`} target="_blank" rel="noreferrer">Watch the dial go live ↗</a>}
        </p>
      ),
    },
    heartbeat: {
      title: "Send the first heartbeat",
      who: "OWNER",
      verified: "verified when heartbeat epoch ≥ 1 on-chain (FDC-proven)",
      instruction: (
        <p>
          On your plan page press <strong>"I'm here — send heartbeat"</strong> — or send the 1-drop manual payment
          with your reference memo. The keeper spots it on the beacon and proves it to Flare; the dial resets when
          the proof lands.
        </p>
      ),
    },
    handover: {
      title: "Hand over the Recovery Kit",
      who: "BOTH",
      verified: "self-attested — no chain can see a sheet of paper change hands",
      instruction: (
        <>
          <p>
            {session.vault && <a href={`/kit/${session.vault}`} target="_blank" rel="noreferrer">Print or download the Kit ↗</a>}{" "}
            and physically give it to your beneficiary. It is not a key — it is the map they will need on the worst
            day. Let them read it now, while you can still answer questions.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => { const cur = fresh(); if (cur) update(markDone(cur, "handover", "self-attested")); }}>
            The Kit is in their hands
          </button>
        </>
      ),
    },
    drill: {
      title: "Beneficiary runs the early-claim drill",
      who: "BENEFICIARY",
      verified: "verified when the keeper's public journal records THIS run's live-chain staticCall refusal (SilenceNotProven, on an Active plan)",
      instruction: (
        <>
          <div className="notice warn" style={{ marginBottom: 10 }}>
            <strong>Beneficiary's move.</strong> Hand them the screen — or send them the tagged claim link below.
            Nothing on that page can rush the plan; that is the point of the drill.
          </div>
          <p>
            On the claim page they enter their XRPL address and press <strong>"Test early-claim protection"</strong>.
            The contract refuses in a live-chain <span className="mono">staticCall</span> — no transaction is
            broadcast, no funds move — and the keeper records the refusal in its public journal. Only a{" "}
            <span className="mono">SilenceNotProven</span> refusal on an <strong>Active</strong> plan completes
            this step; friendly refusals on settled plans do not count.
          </p>
          {vaultState != null && vaultState >= 3 && (
            <div className="notice err" style={{ marginTop: 8 }}>
              This plan is past Active ({STATE_NAMES[vaultState]}) — the safety drill cannot run on it. Bind a
              fresh plan (or an Active one) to rehearse the refusal for real.
            </div>
          )}
          {session.vault && (
            <p className="mono" style={{ fontSize: "0.78rem", marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {`${location.origin}/claim/${short(session.vault, 8)}?rh=…`}
              <CopyBtn text={`${location.origin}/claim/${session.vault}?rh=${session.runId}`} />
              <a href={`/claim/${session.vault}?rh=${session.runId}`} target="_blank" rel="noreferrer">open ↗</a>
            </p>
          )}
        </>
      ),
    },
    debrief: {
      title: "Debrief — three questions, honest answers",
      who: "BOTH",
      verified: "self-attested — answers are recorded verbatim on the receipt, right or wrong",
      instruction: (
        <>
          {DEBRIEF.map((d) => (
            <div key={d.id} style={{ marginBottom: 12 }}>
              <p style={{ marginBottom: 6 }}><strong>{d.q}</strong></p>
              {(Object.keys(d.options) as Array<keyof typeof d.options>).map((k) => (
                <label key={k} style={{ display: "block", fontSize: "0.88rem", marginBottom: 4, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name={`debrief-${d.id}`}
                    checked={(answers[d.id] ?? session.answers?.[d.id]) === k}
                    onChange={() => setAnswers((a) => ({ ...a, [d.id]: k }))}
                    style={{ marginRight: 8 }}
                  />
                  {d.options[k]}
                </label>
              ))}
            </div>
          ))}
          <button
            className="btn btn-primary"
            disabled={DEBRIEF.some((d) => !(answers[d.id] ?? session.answers?.[d.id]))}
            onClick={() => {
              const cur = fresh();
              if (!cur) return;
              const merged = { ...(cur.answers ?? {}), ...answers };
              update(markDone({ ...cur, answers: merged }, "debrief", `${DEBRIEF.filter((d) => merged[d.id] === d.correct).length}/${DEBRIEF.length} correct`));
            }}
          >
            Record the answers
          </button>
        </>
      ),
    },
  };

  return (
    <main className="wrap" style={{ paddingTop: 34, paddingBottom: 60, maxWidth: 860 }}>
      <p className="mono" style={{ fontSize: "0.66rem", letterSpacing: "0.14em", color: "var(--mist-2)" }}>REHEARSE THE HANDOVER</p>
      <h1 style={{ margin: "6px 0 8px" }}>The rehearsal run sheet</h1>
      <p style={{ maxWidth: 660, marginBottom: 6 }}>
        Owner and beneficiary, together, on testnet. Four checks flip only on chain or keeper evidence, one on
        your local wallet session — clicks cannot fake them; the two interpersonal steps are honestly
        self-attested.
      </p>
      <p className="mono" style={{ fontSize: "0.72rem", color: "var(--mist-2)", marginBottom: 18 }}>
        run {session.runId} · started {fmtClock(session.startedAt)} · {doneCount(session)}/{REHEARSAL_STEPS.length} complete
        {session.vault && <> · plan {short(session.vault, 6)} {vaultState != null && <>({STATE_NAMES[vaultState]})</>}{session.runType && <> · {session.runType}</>}</>}
        {checkedAt && <> · evidence checked {fmtClock(checkedAt)}{checking ? "…" : ""}</>}
        {" · "}
        <button className="btn btn-ghost" style={{ padding: "1px 8px", fontSize: "0.7rem" }} onClick={verify} disabled={checking || !session.vault}>Check now</button>
        <button
          className="btn btn-ghost"
          style={{ padding: "1px 8px", fontSize: "0.7rem", marginLeft: 6 }}
          onClick={() => { if (confirm("Restart the rehearsal? Your plan and its funds are untouched — only this run sheet resets.")) { clearSession(); setSession(newSession()); setAnswers({}); } }}
        >
          Restart
        </button>
      </p>

      {REHEARSAL_STEPS.map((id, i) => {
        const st = statusOf(id);
        const c = steps[id];
        const ev = session.steps[id];
        return (
          <div key={id} className="card" style={{ marginBottom: 12, opacity: st === "locked" ? 0.55 : 1 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: "0.9rem", color: st === "done" ? "var(--verdant)" : st === "ready" ? "var(--gold, #d8b45a)" : "var(--mist-2)" }}>
                {st === "done" ? "✓" : `${i + 1}`}
              </span>
              <h3 style={{ margin: 0 }}>{c.title}</h3>
              <span className="mono" style={{ fontSize: "0.62rem", letterSpacing: "0.1em", color: "var(--mist-2)" }}>{c.who}</span>
            </div>
            <p className="hint" style={{ fontSize: "0.72rem", color: "var(--mist-2)", margin: "4px 0 10px" }}>{c.verified}</p>
            {st === "done" ? (
              <p className="mono" style={{ fontSize: "0.78rem", color: "var(--verdant)" }}>
                done {fmtClock(ev!.doneAt)}{ev!.evidence ? <> · {ev!.evidence}</> : null}
              </p>
            ) : st === "ready" ? (
              <div>
                {c.instruction}
                {(id === "fund" || id === "heartbeat" || id === "drill") && (
                  <p className="mono" style={{ fontSize: "0.72rem", color: "var(--mist-2)", marginTop: 10 }}>
                    Waiting for chain evidence{checkedAt ? ` · checked ${fmtClock(checkedAt)}` : ""} — this flips by itself.
                  </p>
                )}
              </div>
            ) : (
              <p className="hint" style={{ fontSize: "0.8rem" }}>Finish the previous step first — this one unlocks by evidence, not by scrolling.</p>
            )}
          </div>
        );
      })}

      {allDone && (
        <div className="card" style={{ borderColor: "color-mix(in srgb, var(--verdant) 45%, transparent)", marginTop: 18 }}>
          <h3 style={{ marginBottom: 10 }}>Rehearsal complete</h3>
          <ul style={{ fontSize: "0.9rem", lineHeight: 1.7, marginBottom: 12 }}>
            <li>✓ Funding was one ordinary XRPL payment</li>
            <li>✓ Liveness is a 1-drop heartbeat, proven by Flare's Data Connector</li>
            <li>✓ The early claim was refused on-chain — while the owner lives, the proof cannot even be built</li>
            <li>✓ The beneficiary holds the Kit and knows the path</li>
            <li>✓ Heirloom held no keys at any point</li>
          </ul>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={downloadReceipt}>⇩ Download the rehearsal receipt</button>
            <Link to="/case/001" className="btn btn-ghost">See a plan that went all the way</Link>
          </div>
          <p className="hint" style={{ fontSize: "0.74rem", color: "var(--mist-2)", marginTop: 10 }}>
            The receipt is a participant-held JSON record — run id and type, per-step timestamps and evidence,
            total time, debrief answers — not a cryptographic proof. It contains public wallet/vault references
            and your answers: share it deliberately. Send it to the team if you're helping us test.
          </p>
        </div>
      )}
    </main>
  );
}
