import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import { CONFIG } from "../config";
import { VaultView, readVault, short } from "../lib/chain";

interface Recovery {
  ownerXrpl: string | null;
  ownerEvm?: string | null;
  mode?: string | null;
  beneficiaryXrpl: string | null;
  reference: string | null;
  beacon: string;
}

// Printable Recovery Kit — everything the beneficiary needs to claim without
// our help, and everything anyone needs to rebuild the proofs without our keeper.
export function Kit() {
  const { address = "" } = useParams();
  const [v, setV] = useState<VaultView | null>(null);
  const [rec, setRec] = useState<Recovery | null>(null);
  const [qr, setQr] = useState<string>("");
  const url = `${window.location.origin}/claim/${address}`;
  const kitId = `HL-${address.slice(2, 6).toUpperCase()}-${address.slice(-4).toUpperCase()}`;

  useEffect(() => {
    readVault(address).then(setV).catch(() => {});
    fetch(`${CONFIG.api}/vaults/${address}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setRec(j.recovery))
      .catch(() => {});
    QRCode.toDataURL(url, { width: 260, margin: 1, color: { dark: "#0E1526", light: "#FFFFFF" } }).then(setQr).catch(() => {});
  }, [address, url]);

  return (
    <main className="wrap kit-sheet" style={{ padding: "44px 24px", maxWidth: 720 }}>
      <div className="no-print" style={{ marginBottom: 22, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary" onClick={() => window.print()}>Print / save as PDF</button>
        <button className="btn btn-ghost" onClick={() => {
          // self-contained recovery manifest: everything needed to rebuild every
          // proof and finish a claim even if Heirloom disappears — no secrets inside
          const manifest = {
            kitId,
            vault: address,
            network: { flare: "Coston2 (chainId 114)", xrpl: "testnet" },
            contracts: { factory: CONFIG.factory, fxrp: CONFIG.fxrp, assetManager: CONFIG.assetManager },
            owner: rec?.ownerXrpl ?? rec?.ownerEvm ?? null,
            ownerMode: rec?.mode ?? "xrpl",
            beneficiary: rec?.beneficiaryXrpl ?? null,
            heartbeatBeacon: rec?.beacon ?? CONFIG.beacon,
            heartbeatReference: rec?.reference ?? null,
            claimUrl: url,
            rules: v ? { heartbeatPeriodSec: v.heartbeatPeriod, gracePeriodSec: v.gracePeriod, challengePeriodSec: v.challengePeriod } : null,
            proofRecipe: rec?.mode === "evm"
              ? "silence clock = Flare consensus time vs lastHeartbeatTs; after period+grace anyone may call startClaim(beneficiary), wait out the challenge, then executeRelease()"
              : "silence proof = FDC ReferencedPaymentNonexistence over the beacon with the heartbeat reference, checkSourceAddresses=true, sourceAddressesRoot=keccak256(keccak256(owner)), chained from lastHeartbeatLedger+1; then startClaim(beneficiary) → challenge → executeRelease()",
            generatedAt: new Date().toISOString(),
          };
          const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `heirloom-recovery-${address.slice(2, 10)}.json`;
          a.click();
        }}>⇩ Download recovery file</button>
        <span style={{ alignSelf: "center", fontSize: "0.85rem", color: "var(--mist)" }}>
          Give both to your beneficiary — and rehearse the claim once, together, today.
        </span>
      </div>

      <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 34 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div className="eyebrow" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>Heirloom · Recovery Kit · {v ? "demo timing (testnet)" : ""}</span>
              <span className="mono" style={{ letterSpacing: "0.06em" }}>Kit ID {kitId}</span>
            </div>
            <h1 style={{ fontSize: "1.7rem", margin: "10px 0 6px" }}>If I go silent, this is yours to use.</h1>
            <p style={{ fontSize: "0.88rem" }}>
              Someone chose you as the beneficiary of their XRP continuity vault. Keep this sheet safe. It is
              <strong> not a key</strong> and cannot move funds by itself — funds move only after Flare's
              network proves the owner's silence and a final challenge window passes.
            </p>
          </div>
          {qr && (
            <div style={{ textAlign: "center" }}>
              <img src={qr} alt="Claim page QR" style={{ borderRadius: 10, border: "4px solid #fff" }} />
              <div className="mono" style={{ fontSize: "0.62rem", marginTop: 6, color: "var(--mist-2)" }}>scan → claim page</div>
            </div>
          )}
        </div>

        <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse", marginTop: 20 }}>
          <tbody>
            {[
              ["Claim page", url],
              ["Vault contract", address],
              ["Network", "Flare Coston2 (chain 114) + XRPL testnet"],
              [rec?.mode === "evm" ? "Owner (MetaMask/OKX account)" : "Owner XRPL address", rec?.ownerXrpl ?? rec?.ownerEvm ?? "—"],
              ["Check-in method", rec?.mode === "evm" ? "One-click Flare transaction (heartbeatEvm)" : "1-drop XRPL payment to the beacon"],
              ["Beneficiary address", rec?.beneficiaryXrpl ?? "(the address the owner chose — yours)"],
              ["Heartbeat beacon", rec?.beacon ?? CONFIG.beacon],
              ["Heartbeat reference", rec?.reference ?? "—"],
              ["Inactivity window", v ? `${Math.round(v.heartbeatPeriod / 60)} min + ${Math.round(v.gracePeriod / 60)} min grace` : "…"],
              ["Final challenge", v ? `${Math.round(v.challengePeriod / 60)} min after a claim starts` : "…"],
            ].map(([k, val]) => (
              <tr key={k} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "9px 8px 9px 0", color: "var(--mist)", whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
                <td className="mono" style={{ padding: "9px 0", wordBreak: "break-all" }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ margin: "24px 0 10px" }}>When the time comes</h3>
        <ol style={{ fontSize: "0.88rem", color: "var(--mist)", paddingLeft: 20, display: "grid", gap: 7 }}>
          <li>Open the claim page (scan the QR above) from any browser.</li>
          <li>Enter <strong>your own</strong> XRPL address — it must match the one the owner chose.</li>
          <li>Press "Start the claim". If the owner is still active, it will be refused — that is normal and protective.</li>
          <li>Wait out the challenge window shown on screen.</li>
          <li>Press "Execute the release". Native XRP arrives on your own wallet — no keys handed over, nothing to install.</li>
        </ol>

        <h3 style={{ margin: "22px 0 10px" }}>Rehearse it now — while they're here</h3>
        <p style={{ fontSize: "0.85rem", color: "var(--mist)" }}>
          Open the claim page today and press <em>"Test early-claim protection"</em>. You will watch the network
          refuse the claim because the owner is alive — so when the day comes, you already know the path.
          <span className="mono"> Drill completed on: ____ / ____ / ______</span>
        </p>

        <h3 style={{ margin: "22px 0 10px" }}>If Heirloom itself is gone</h3>
        <p style={{ fontSize: "0.82rem", color: "var(--mist)" }}>
          {rec?.mode === "evm" ? (
            <>Everything above is enough for any developer to finish the claim without us: for this plan the
            silence clock is Flare consensus time itself — once{" "}
            <span className="mono">lastHeartbeatTs + period + grace</span> has passed, anyone can call{" "}
            <span className="mono">startClaim</span> with your address, wait out the challenge window, and call{" "}
            <span className="mono">executeRelease</span>. The contract is verified on the explorer; the keeper
            is open source at <span className="mono">github.com/a252937166/heirloom</span>.</>
          ) : (
            <>Everything above is enough for any developer to finish the claim without us: the vault contract
            verifies (1) an FDC <span className="mono">ReferencedPaymentNonexistence</span> proof over the beacon
            with the heartbeat reference, source-filtered by the owner address, chained from the last heartbeat
            ledger + 1, and (2) your address preimage. The contract is verified on the explorer; the keeper is
            open source at <span className="mono">github.com/a252937166/heirloom</span>. Any party may submit the
            proofs — the vault does not care who cranks it.</>
          )}
        </p>

        <p style={{ fontSize: "0.75rem", marginTop: 20, color: "var(--mist-2)" }}>
          This mechanism transfers control of on-chain funds; it is not a legal will — pair it with proper
          estate documents naming the same beneficiary. Verify everything yourself: vault {short(address, 8)} on{" "}
          {CONFIG.explorer.replace("https://", "")}.
        </p>
      </div>
    </main>
  );
}
