import { Link } from "react-router-dom";
import { CONFIG } from "../config";

const VAULT = "0x0FBeF3524E824770E98F2D1A497CB559b007E797";
const RUN_ID = "rh-mslmyc74-3c9xr8";
const DOCS = `${CONFIG.github}/tree/main/docs/validation/test-person-01`;

const EVIDENCE = [
  {
    tone: "ok",
    title: "Plan created and funded",
    detail: "One 10.20-XRP Testnet payment activated a fresh vault with 10 FXRP.",
    links: [
      ["funding payment", `${CONFIG.xrplExplorer}/transactions/6ACC1EA2069313E380998F6B7719C4D253DFB61A668216D1EBA7E6977CD9F380`],
      ["activation transaction", `${CONFIG.explorer}/tx/0xd6eeaa3cda37ed46e74ac3dfbd5d7db2ee2122dc93ab0a1ab69f77647470e046`],
    ],
  },
  {
    tone: "ok",
    title: "Heartbeat proved on Flare",
    detail: "A 1-drop owner heartbeat became epoch 1 after FDC voting round 1420447.",
    links: [
      ["XRPL heartbeat", `${CONFIG.xrplExplorer}/transactions/F8DC756CED5BE7880F215AE7FE672EA4CC74FC81B47E1D7B3ADF6F911C2CD1FD`],
      ["Coston2 proof", `${CONFIG.explorer}/tx/0xb587e386acf8480c7e24f8c1e14d22a7fc8cbb3c17d13d2b2fef8f5f85aa67de`],
    ],
  },
  {
    tone: "warn",
    title: "Early claim refused",
    detail: `The live contract returned SilenceNotProven with 4m 26s left; run tag ${RUN_ID}; no transaction broadcast and no funds moved.`,
    links: [["public keeper journal", `${CONFIG.api}/vaults/${VAULT}`]],
  },
  {
    tone: "gold",
    title: "Owner exit fully settled",
    detail: "The owner cancelled with a 1-drop command; 9.95 test XRP returned and the vault finished Cancelled with 0 FXRP.",
    links: [
      ["cancel command", `${CONFIG.xrplExplorer}/transactions/BD6A172A620B2FC022795F4CF29D42F3DA2200346D1B3BBFD7DFD5B8B39A7C3A`],
      ["cancel execution", `${CONFIG.explorer}/tx/0x2d3e185d18be66e6ba3548176f20a1598efe3f737f086e92c9f91d30c239d596`],
      ["XRP refund", `${CONFIG.xrplExplorer}/transactions/E02F3ABEC16B2638697D8FE5969C09BCD4CB6AA2B826C5879C6187E93180D8E5`],
    ],
  },
] as const;

export function Validation() {
  return (
    <main className="wrap" style={{ paddingTop: 46, paddingBottom: 64, maxWidth: 940 }}>
      <section className="rise">
        <div className="eyebrow">PUBLIC VALIDATION · TEST PERSON 01</div>
        <h1 style={{ margin: "9px 0 12px", maxWidth: 720 }}>One dry run. Every residue closed.</h1>
        <p style={{ maxWidth: 700, fontSize: "1rem" }}>
          A real browser drove a fresh XRP-native plan across the XRPL Testnet, Flare FDC, and Coston2.
          The whole rehearsal completed, then the owner cancelled and the refund settled back to zero.
        </p>
        <div className="notice" style={{ marginTop: 18, maxWidth: 760 }}>
          <strong style={{ color: "var(--paper)" }}>Evidence boundary:</strong> Test Person 01 is an
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
          <div className="kv-row"><span className="k">Completion time</span><span className="v">14m 10s</span></div>
          <div className="kv-row"><span className="k">Debrief</span><span className="v">3/3 correct</span></div>
          <div className="kv-row"><span className="k">Route</span><span className="v">fresh · manual XRPL</span></div>
          <div className="kv-row"><span className="k">Infrastructure</span><span className="v">XRPL Testnet + Coston2 + FDC</span></div>
          <div className="kv-row"><span className="k">Terminal state</span><span className="v" style={{ color: "var(--verdant)" }}>Cancelled · 0 FXRP · refunded</span></div>
        </div>
      </section>

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
          <h2 style={{ marginBottom: 7 }}>Inspect the artifacts, not the claim.</h2>
          <p style={{ fontSize: "0.88rem" }}>
            The repository pack includes the participant-held receipt, Recovery manifest, final keeper JSON,
            screenshots, checksums, and a verifier script. The vault and every transaction remain public.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn btn-primary" href={DOCS} target="_blank" rel="noreferrer">Open evidence pack ↗</a>
          <a className="btn btn-ghost" href={`${CONFIG.explorer}/address/${VAULT}`} target="_blank" rel="noreferrer">Public vault ↗</a>
          <Link className="btn btn-ghost" to="/rehearsal">Run the rehearsal</Link>
        </div>
      </section>
    </main>
  );
}
