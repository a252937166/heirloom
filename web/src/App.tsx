import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { createContext, useContext, useEffect, useState } from "react";
import { Landing } from "./pages/Landing";
import { Create } from "./pages/Create";
import { Vault } from "./pages/Vault";
import { Claim } from "./pages/Claim";
import { Kit } from "./pages/Kit";
import { CaseStudy } from "./pages/CaseStudy";
import { WalletState, connectWallet } from "./lib/gem";
import { EVM_NONE, EvmState, connectEvm as connectEvmWallet } from "./lib/evm";
import { CONFIG } from "./config";
import { short, vaultsOfOwner } from "./lib/chain";

const WalletCtx = createContext<{
  wallet: WalletState;
  evm: EvmState;
  connect: () => Promise<void>;
  connectEvm: () => Promise<void>;
  connecting: boolean;
  notice: string | null;
}>({
  wallet: { installed: false, address: null, network: null },
  evm: EVM_NONE,
  connect: async () => {},
  connectEvm: async () => {},
  connecting: false,
  notice: null,
});
export const useWallet = () => useContext(WalletCtx);

export default function App() {
  const [wallet, setWallet] = useState<WalletState>({ installed: false, address: null, network: null });
  const [evm, setEvm] = useState<EvmState>(EVM_NONE);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [myPlans, setMyPlans] = useState<string[]>([]);
  const [plansOpen, setPlansOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    if (wallet.address) {
      vaultsOfOwner(wallet.address).then(setMyPlans).catch(() => {});
    } else if (evm.address) {
      fetch(`${CONFIG.api}/plans/of/${evm.address}`)
        .then((r) => (r.ok ? r.json() : { vaults: [] }))
        .then((j) => setMyPlans(j.vaults ?? []))
        .catch(() => {});
    }
  }, [wallet.address, evm.address]);

  // The XRPL-native wallet is the primary path — heartbeats are 1-drop XRPL
  // payments proven by FDC. MetaMask/OKX is the wider door for owners without
  // an XRPL extension: Coston2 is added automatically, check-ins are one click.
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

  const connectEvm = async () => {
    setConnecting(true);
    setNotice(null);
    try {
      const st = await connectEvmWallet();
      setEvm(st);
      if (!st.available) setNotice("no-evm");
      else if (!st.address) setNotice("evm-rejected");
    } catch (e) {
      setNotice(/rejected|denied|4001/i.test(String((e as Error).message)) ? "evm-rejected" : "no-evm");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <WalletCtx.Provider value={{ wallet, evm, connect, connectEvm, connecting, notice }}>
      <header style={{ borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "color-mix(in srgb, var(--ink) 88%, transparent)", backdropFilter: "blur(8px)", zIndex: 10 }} className="no-print">
        <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 62 }}>
          <Link to="/" style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", color: "var(--paper)", textDecoration: "none" }}>
            Heirloom<span style={{ color: "var(--lamplight)" }}>.</span>
          </Link>
          <nav style={{ display: "flex", gap: 18, alignItems: "center" }}>
            {!loc.pathname.startsWith("/case") && (
              <Link to="/case/001" style={{ color: "var(--mist)", fontSize: "0.9rem" }}>
                Live case
              </Link>
            )}
            {loc.pathname !== "/create" && (
              <Link to="/create" style={{ color: "var(--mist)", fontSize: "0.9rem" }}>
                Create a plan
              </Link>
            )}
            {(wallet.address || evm.address) && (
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
                ● {short(wallet.address, 6)} · XRPL
              </span>
            ) : evm.address ? (
              <span className="pill gold" title={evm.address}>
                ● {short(evm.address, 6)} · {evm.kind}
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
                supported) — or use an EVM wallet instead: your check-ins become one-click Flare transactions and
                Coston2 is added automatically. Manual mode (copy-paste payments) also works everywhere.
              </span>
              <span style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: "0.78rem" }} onClick={connectEvm} disabled={connecting}>
                  Connect MetaMask / OKX
                </button>
                <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: "0.78rem" }} onClick={() => setNotice(null)}>
                  Got it
                </button>
              </span>
            </div>
          </div>
        )}
        {notice === "no-evm" && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice err">
              No MetaMask or OKX extension detected either. Install{" "}
              <a href="https://gemwallet.app" target="_blank" rel="noreferrer">GemWallet</a> (XRPL, recommended) or{" "}
              <a href="https://metamask.io" target="_blank" rel="noreferrer">MetaMask</a> — or continue without a
              wallet: paste your address where asked and pay by copying the payment details into any wallet.
            </div>
          </div>
        )}
        {notice === "evm-rejected" && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice err">The wallet declined. Approve the connection and the Coston2 network prompt, then try again.</div>
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
        <Route path="/case/001" element={<CaseStudy />} />
        <Route path="/case" element={<Navigate to="/case/001" replace />} />
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
