import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CONFIG } from "../config";
import { VaultView, readVault, short } from "../lib/chain";

// Printable Recovery Kit — what the beneficiary needs to claim without help.
export function Kit() {
  const { address = "" } = useParams();
  const [v, setV] = useState<VaultView | null>(null);
  useEffect(() => {
    readVault(address).then(setV).catch(() => {});
  }, [address]);

  const url = `${window.location.origin}/claim/${address}`;

  return (
    <main className="wrap kit-sheet" style={{ padding: "48px 24px", maxWidth: 680 }}>
      <div className="no-print" style={{ marginBottom: 24, display: "flex", gap: 12 }}>
        <button className="btn btn-primary" onClick={() => window.print()}>Print / save as PDF</button>
        <span style={{ alignSelf: "center", fontSize: "0.85rem", color: "var(--mist)" }}>
          Give this sheet to your beneficiary. It contains no keys and moves no money.
        </span>
      </div>

      <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 34 }}>
        <div className="eyebrow">Heirloom · Recovery Kit</div>
        <h1 style={{ fontSize: "1.8rem", margin: "10px 0 6px" }}>If I go silent, this is yours to use.</h1>
        <p style={{ fontSize: "0.9rem", marginBottom: 24 }}>
          Someone chose you as the beneficiary of their XRP continuity vault. Keep this sheet safe. It is not a key
          and cannot move any funds by itself — it only tells you where and how to claim when the time comes.
        </p>

        <table style={{ width: "100%", fontSize: "0.88rem", borderCollapse: "collapse" }}>
          <tbody>
            {[
              ["Vault", address],
              ["Claim page", url],
              ["Network", "Flare Coston2 (testnet demo)"],
              ["Beneficiary fingerprint", v ? `${v.beneficiaryXrplHash.slice(0, 10)}…${v.beneficiaryXrplHash.slice(-6)}` : "…"],
              ["Inactivity window", v ? `${Math.round(v.heartbeatPeriod / 60)} minutes + ${Math.round(v.gracePeriod / 60)}m grace (demo timing)` : "…"],
              ["Safety challenge", v ? `${Math.round(v.challengePeriod / 60)} minutes after a claim starts` : "…"],
            ].map(([k, val]) => (
              <tr key={k} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "10px 8px 10px 0", color: "var(--mist)", whiteSpace: "nowrap" }}>{k}</td>
                <td className="mono" style={{ padding: "10px 0", wordBreak: "break-all" }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ margin: "26px 0 10px" }}>When the time comes</h3>
        <ol style={{ fontSize: "0.9rem", color: "var(--mist)", paddingLeft: 20, display: "grid", gap: 8 }}>
          <li>Open the claim page above from any browser.</li>
          <li>Enter <strong>your own</strong> XRPL address — the one the owner chose for you.</li>
          <li>Press "Start claim". Flare's network will check the owner's silence; if they are still active, the claim is refused — that is normal and protective.</li>
          <li>Wait out the safety challenge shown on screen.</li>
          <li>Press "Execute release". The XRP arrives on your own wallet — you never hand over keys or install anything.</li>
        </ol>

        <p style={{ fontSize: "0.78rem", marginTop: 24, color: "var(--mist-2)" }}>
          This mechanism transfers control of on-chain funds. It is not a legal will; pair it with proper estate
          documents. Verify everything yourself: vault {short(address, 8)} on {CONFIG.explorer}.
        </p>
      </div>
    </main>
  );
}
