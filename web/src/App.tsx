import { Link, Route, Routes, useLocation } from "react-router-dom";
import { createContext, useContext, useState } from "react";
import { Landing } from "./pages/Landing";
import { Create } from "./pages/Create";
import { Vault } from "./pages/Vault";
import { Claim } from "./pages/Claim";
import { Kit } from "./pages/Kit";
import { WalletState, connectWallet } from "./lib/gem";
import { short } from "./lib/chain";

const WalletCtx = createContext<{
  wallet: WalletState;
  connect: () => Promise<void>;
}>({ wallet: { installed: false, address: null, network: null }, connect: async () => {} });
export const useWallet = () => useContext(WalletCtx);

export default function App() {
  const [wallet, setWallet] = useState<WalletState>({ installed: false, address: null, network: null });
  const loc = useLocation();
  const connect = async () => setWallet(await connectWallet());

  return (
    <WalletCtx.Provider value={{ wallet, connect }}>
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
            {wallet.address ? (
              <span className="pill gold" title={wallet.address}>
                ● {short(wallet.address, 6)}
              </span>
            ) : (
              <button className="btn btn-ghost" style={{ padding: "8px 16px", fontSize: "0.85rem" }} onClick={connect}>
                Connect XRPL wallet
              </button>
            )}
          </nav>
        </div>
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
