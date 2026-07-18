import { Link, Route, Routes, useLocation } from "react-router-dom";
import { createContext, useContext, useEffect, useState } from "react";
import { Landing } from "./pages/Landing";
import { Create } from "./pages/Create";
import { Vault } from "./pages/Vault";
import { Claim } from "./pages/Claim";
import { Kit } from "./pages/Kit";
import { WalletState, connectWallet } from "./lib/gem";
import { short, vaultsOfOwner } from "./lib/chain";

const WalletCtx = createContext<{
  wallet: WalletState;
  connect: () => Promise<void>;
  connecting: boolean;
  notice: string | null;
}>({ wallet: { installed: false, address: null, network: null }, connect: async () => {}, connecting: false, notice: null });
export const useWallet = () => useContext(WalletCtx);

export default function App() {
  const [wallet, setWallet] = useState<WalletState>({ installed: false, address: null, network: null });
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [myPlans, setMyPlans] = useState<string[]>([]);
  const [plansOpen, setPlansOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    if (!wallet.address) return;
    vaultsOfOwner(wallet.address).then(setMyPlans).catch(() => {});
  }, [wallet.address]);
  const connect = async () => {
    setConnecting(true);
    setNotice(null);
    try {
      const w = await connectWallet();
      setWallet(w);
      if (!w.installed) {
        setNotice("no-wallet");
      } else if (!w.address) {
        setNotice("rejected");
      } else if (w.network && !/test/i.test(w.network)) {
        setNotice("wrong-network");
      }
    } catch {
      setNotice("no-wallet");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <WalletCtx.Provider value={{ wallet, connect, connecting, notice }}>
      <header style={{ borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "color-mix(in srgb, var(--ink) 88%, transparent)", backdropFilter: "blur(8px)", zIndex: 10 }} className="no-print">
        <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 62 }}>
          <Link to="/" style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", color: "var(--paper)", textDecoration: "none" }}>
            Heirloom<span style={{ color: "var(--lamplight)" }}>.</span>
          </Link>
          <nav style={{ display: "flex", gap: 18, alignItems: "center" }}>
            {loc.pathname !== "/create" && (
              <Link to="/create" style={{ color: "var(--mist)", fontSize: "0.9rem" }}>
                Create a plan
              </Link>
            )}
            {wallet.address && (
              <span style={{ position: "relative" }}>
                <button className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: "0.85rem" }} onClick={() => setPlansOpen((o) => !o)}>
                  My plans{myPlans.length ? ` (${myPlans.length})` : ""}
                </button>
                {plansOpen && (
                  <div style={{ position: "absolute", right: 0, top: 46, background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 10, minWidth: 240, zIndex: 30 }}>
                    {myPlans.length === 0 && <p style={{ fontSize: "0.8rem", padding: 6 }}>No plans yet — create your first.</p>}
                    {myPlans.map((p) => (
                      <Link key={p} to={`/vault/${p}`} onClick={() => setPlansOpen(false)}
                        style={{ display: "block", padding: "8px 10px", borderRadius: 8, fontSize: "0.8rem" }} className="mono">
                        {short(p, 10)}
                      </Link>
                    ))}
                  </div>
                )}
              </span>
            )}
            {wallet.address ? (
              <span className="pill gold" title={wallet.address}>
                ● {short(wallet.address, 6)}
              </span>
            ) : (
              <button className="btn btn-ghost" style={{ padding: "8px 16px", fontSize: "0.85rem" }} onClick={connect} disabled={connecting}>
                {connecting ? "Looking for wallet…" : "Connect XRPL wallet"}
              </button>
            )}
          </nav>
        </div>
        {notice === "no-wallet" && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice" style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                No XRPL wallet extension detected. Install{" "}
                <a href="https://gemwallet.app" target="_blank" rel="noreferrer">GemWallet</a> (2 minutes, testnet
                supported) — or continue without one: paste your address where asked, and every payment is shown as
                copyable instructions for Xaman or any wallet.
              </span>
              <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: "0.78rem" }} onClick={() => setNotice(null)}>
                Got it
              </button>
            </div>
          </div>
        )}
        {notice === "rejected" && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice err">The wallet declined the connection. Open GemWallet and try again.</div>
          </div>
        )}
        {notice === "wrong-network" && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice err">
              Your wallet is on <span className="mono">{wallet.network}</span>. Switch GemWallet to the{" "}
              <strong>XRPL Testnet</strong> — Heirloom runs on testnet with demo timing.
            </div>
          </div>
        )}
      </header>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/create" element={<Create />} />
        <Route path="/vault/:address" element={<Vault />} />
        <Route path="/claim/:address" element={<Claim />} />
        <Route path="/kit/:address" element={<Kit />} />
      </Routes>
      <footer className="footer-honest no-print">
        <div className="wrap">
          <p style={{ maxWidth: 760 }}>
            <strong>Honest boundaries.</strong> Heirloom never holds your keys, cannot change your recipient, and
            cannot release funds before the configured inactivity and challenge periods have both elapsed. Settlement
            relies on Flare FAssets, FDC consensus, and the XRP Ledger. Heirloom is a technical continuity mechanism —
            not a substitute for a legally valid will. Running on Flare <span className="mono">Coston2</span> testnet
            with demo timing.
          </p>
        </div>
      </footer>
    </WalletCtx.Provider>
  );
}
