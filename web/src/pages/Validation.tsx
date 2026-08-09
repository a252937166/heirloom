import { Link } from "react-router-dom";
import { CONFIG } from "../config";

const VAULT = "0x5bbc816136a7ee4e3eb7147e28064bb367a53075";
const RUN_ID = "rh-mslpxllp-5qgx0p";
const DOCS = `${CONFIG.github}/tree/main/docs/validation/test-person-02`;
const BASELINE_DOCS = `${CONFIG.github}/tree/main/docs/validation/test-person-01`;

const EVIDENCE = [
  {
    tone: "ok",
    title: "Plan created and funded",
    detail: "One 10.20-XRP Testnet payment activated a fresh vault with 10 FXRP.",
    links: [
      ["funding payment", `${CONFIG.xrplExplorer}/transactions/26DD1EB6A84F40048741AADEA41D1AA83074B95A72671D72C092B562D8DD28D8`],
      ["activation transaction", `${CONFIG.explorer}/tx/0x27d9e7e0153667b0f7184c8adbb75cdf08a5b579de22887e14d8553005cce71d`],
    ],
  },
  {
    tone: "ok",
    title: "Heartbeat proved on Flare",
    detail: "A 1-drop owner heartbeat became epoch 1 after FDC voting round 1420503.",
    links: [
      ["XRPL heartbeat", `${CONFIG.xrplExplorer}/transactions/EE6B569037A255BDF4CEA7AB567102EFE09C700FD3601F9DCF53ED8F21D2147F`],
      ["Coston2 proof", `${CONFIG.explorer}/tx/0x713f69c9421976e9662d18a91172daa6415233c6c082265753988b909b479305`],
    ],
  },
  {
    tone: "warn",
    title: "Early claim refused",
    detail: `The live contract returned SilenceNotProven at pinned Coston2 block 33819040 with 366s of owner-window headroom; insideOwnerWindow=true; run tag ${RUN_ID}; no funds moved.`,
    links: [["public keeper journal", `${CONFIG.api}/vaults/${VAULT}`]],
  },
  {
    tone: "gold",
    title: "Owner exit fully settled",
    detail: "The owner cancelled with a 1-drop command; 9.95 test XRP returned and the vault finished Cancelled with 0 FXRP.",
    links: [
      ["cancel command", `${CONFIG.xrplExplorer}/transactions/6B8D018EF9A6B54B4318F9D586399200F71C1C1753425FBE5AED879FFC019219`],
      ["cancel execution", `${CONFIG.explorer}/tx/0x00761100c23f2f7542c5e811790ac5fe3b0370a554fcdfa824eae2be6e5ba2e5`],
      ["XRP refund", `${CONFIG.xrplExplorer}/transactions/77F2AF6875486C4DFA69E996BDF9F17B3AF7B31A41534466F47AE33EE30BDC22`],
    ],
  },
] as const;

export function Validation() {
  return (
    <main className="wrap" style={{ paddingTop: 46, paddingBottom: 64, maxWidth: 940 }}>
      <section className="rise">
        <div className="eyebrow">LATEST RELEASE VERIFICATION · TEST PERSON 02</div>
        <h1 style={{ margin: "9px 0 12px", maxWidth: 720 }}>One pinned block. One complete release check.</h1>
        <p style={{ maxWidth: 700, fontSize: "1rem" }}>
          Build <span className="mono">7e010a3</span> was exercised through a fresh XRP-native plan across the
          XRPL Testnet, Flare FDC, and Coston2. The strict receipt boundary passed, then the owner cancelled
          and the refund settled back to zero.
        </p>
        <div className="notice" style={{ marginTop: 18, maxWidth: 760 }}>
          <strong style={{ color: "var(--paper)" }}>Evidence boundary:</strong> Test Person 02 is an
          engineering-operated, human-style product simulation. It is <strong>not</strong> an external
          human-subject pair and is not counted as a user, pair, or unassisted-human result.
        </div>
      </section>

      <section className="card two-col rise" style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 28, marginTop: 28, animationDelay: "0.08s" }}>
        <div className="validation-receipt-lead">
          <span className="pill ok">FULL PATH COMPLETE</span>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "4.2rem", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.06em", marginTop: 20 }}>
            7/7
          </div>
          <p className="mono" style={{ fontSize: "0.66rem", marginTop: 12, color: "var(--mist-2)", wordBreak: "break-all" }}>
            receipt {RUN_ID}
          </p>
        </div>
        <div className="kv">
          <div className="kv-row"><span className="k">Build</span><span className="v">7e010a3</span></div>
          <div className="kv-row"><span className="k">Completion time</span><span className="v">12m 00s</span></div>
          <div className="kv-row"><span className="k">Debrief</span><span className="v">3/3 correct</span></div>
          <div className="kv-row"><span className="k">Route</span><span className="v">fresh · manual XRPL</span></div>
          <div className="kv-row"><span className="k">Strict verdict</span><span className="v">block 33819040 · insideOwnerWindow=true</span></div>
          <div className="kv-row"><span className="k">Infrastructure</span><span className="v">XRPL Testnet + Coston2 + FDC</span></div>
          <div className="kv-row"><span className="k">Terminal state</span><span className="v" style={{ color: "var(--verdant)" }}>Cancelled · 0 FXRP · refunded</span></div>
        </div>
      </section>

      <div className="notice rise" style={{ marginTop: 22, animationDelay: "0.12s" }}>
        <strong style={{ color: "var(--paper)" }}>Baseline retained:</strong> Test Person 01 ran against
        submission-v10 in 14m 10s and established the original full-path baseline, but predates the strict
        pinned-block receipt semantics. <a href={BASELINE_DOCS} target="_blank" rel="noreferrer">Open TP01 evidence ↗</a>
      </div>

      <section className="rise" style={{ marginTop: 34, animationDelay: "0.16s" }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>THE PUBLIC EVIDENCE CHAIN</div>
        <div className="card">
          <div className="timeline">
            {EVIDENCE.map((item) => (
              <div className={`tl-item ${item.tone}`} key={item.title}>
                <div className="tl-dot">●</div>
                <div className="tl-body">
                  <h3>{item.title}</h3>
                  <p style={{ fontSize: "0.84rem", margin: "4px 0 7px", maxWidth: 700 }}>{item.detail}</p>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {item.links.map(([label, href]) => (
                      <a key={label} href={href} target="_blank" rel="noreferrer">{label} ↗</a>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card rise" style={{ marginTop: 22, animationDelay: "0.22s", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 590 }}>
          <h2 style={{ marginBottom: 7 }}>Inspect the release evidence, not the claim.</h2>
          <p style={{ fontSize: "0.88rem" }}>
            The repository pack includes the participant-held receipt, Recovery manifest, final keeper JSON,
            screenshots, checksums, and a verifier script. The vault and every transaction remain public.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn btn-primary" href={DOCS} target="_blank" rel="noreferrer">Open TP02 evidence ↗</a>
          <a className="btn btn-ghost" href={BASELINE_DOCS} target="_blank" rel="noreferrer">TP01 baseline ↗</a>
          <a className="btn btn-ghost" href={`${CONFIG.explorer}/address/${VAULT}`} target="_blank" rel="noreferrer">Public vault ↗</a>
          <Link className="btn btn-ghost" to="/rehearsal">Run the rehearsal</Link>
        </div>
      </section>
    </main>
  );
}
