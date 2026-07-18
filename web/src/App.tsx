import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { createContext, useContext, useEffect, useState } from "react";
import { Landing } from "./pages/Landing";
import { Create } from "./pages/Create";
import { Vault } from "./pages/Vault";
import { Claim } from "./pages/Claim";
import { Kit } from "./pages/Kit";
import { CaseStudy } from "./pages/CaseStudy";
import { WalletModal } from "./components/WalletModal";
import { WalletState, connectWallet } from "./lib/gem";
import { EVM_NONE, EvmState, WalletOption, connectWith, retrySwitch } from "./lib/evm";
import { CONFIG } from "./config";
import { short, vaultsOfOwner } from "./lib/chain";

const WalletCtx = createContext<{
  wallet: WalletState;
  evm: EvmState;
  connect: () => Promise<WalletState>;
  openConnect: () => void;
  connecting: boolean;
  notice: string | null;
}>({
  wallet: { installed: false, address: null, network: null },
  evm: EVM_NONE,
  connect: async () => ({ installed: false, address: null, network: null }),
  openConnect: () => {},
  connecting: false,
  notice: null,
});
export const useWallet = () => useContext(WalletCtx);

export default function App() {
  const [wallet, setWallet] = useState<WalletState>({ installed: false, address: null, network: null });
  const [evm, setEvm] = useState<EvmState>(EVM_NONE);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
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

  // XRPL-native (GemWallet) is the hero path — 1-drop heartbeats proven by FDC.
  const connect = async (): Promise<WalletState> => {
    setConnecting(true);
    setNotice(null);
    let w: WalletState = { installed: false, address: null, network: null };
    try {
      w = await connectWallet();
      setWallet(w);
      if (!w.installed) setNotice("no-wallet");
      else if (!w.address) setNotice("rejected");
      else if (w.network && !/test/i.test(w.network)) setNotice("wrong-network");
    } catch {
      setNotice("no-wallet");
    } finally {
      setConnecting(false);
    }
    return w;
  };

  // EVM wallets from the Connections dialog — real identity via EIP-6963,
  // Coston2 switched/added automatically and verified with eth_chainId.
  const pickEvm = async (opt: WalletOption) => {
    setConnecting(true);
    setNotice(null);
    try {
      const st = await connectWith(opt);
      setEvm(st);
      if (st.address) setModalOpen(false);
      else setNotice("evm-rejected");
    } catch (e) {
      setNotice(/rejected|denied|4001/i.test(String((e as Error).message)) ? "evm-rejected" : "no-evm");
    } finally {
      setConnecting(false);
    }
  };

  const pickXrpl = async () => {
    const w = await connect();
    if (w.address) setModalOpen(false);
  };

  const retryNetwork = async () => {
    setConnecting(true);
    try {
      const ok = await retrySwitch();
      setEvm((s) => ({ ...s, chainOk: ok }));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <WalletCtx.Provider value={{ wallet, evm, connect, openConnect: () => setModalOpen(true), connecting, notice }}>
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
                ● {short(wallet.address, 6)} · GemWallet
              </span>
            ) : evm.address ? (
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="pill gold" title={evm.address} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {evm.icon ? <img src={evm.icon} alt="" style={{ width: 14, height: 14, borderRadius: 4 }} /> : <span>●</span>}
                  {short(evm.address, 6)} · {evm.kind}
                </span>
                {evm.chainOk ? (
                  <span className="pill" style={{ color: "var(--verdant)", fontSize: "0.68rem" }}>Coston2</span>
                ) : (
                  <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: "0.72rem", color: "var(--ember)", borderColor: "color-mix(in srgb, var(--ember) 45%, transparent)" }}
                    onClick={retryNetwork} disabled={connecting}>
                    {connecting ? "Switching…" : "Switch to Coston2"}
                  </button>
                )}
              </span>
            ) : (
              <button className="btn btn-ghost" style={{ padding: "8px 16px", fontSize: "0.85rem" }} onClick={() => setModalOpen(true)} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </nav>
        </div>
        {evm.address && !evm.chainOk && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice err" style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                {evm.kind} is connected but on another network. Heirloom runs on <strong>Flare Testnet Coston2</strong> —
                approve the switch prompt in your wallet.
              </span>
              <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: "0.78rem" }} onClick={retryNetwork} disabled={connecting}>
                {connecting ? "Switching…" : "Switch network"}
              </button>
            </div>
          </div>
        )}
        {notice === "no-evm" && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice err">
              That wallet didn't respond. Install{" "}
              <a href="https://gemwallet.app" target="_blank" rel="noreferrer">GemWallet</a> (XRPL, recommended) or{" "}
              <a href="https://metamask.io" target="_blank" rel="noreferrer">MetaMask</a> — or continue without a
              wallet: every payment is shown as copyable instructions.
            </div>
          </div>
        )}
        {notice === "evm-rejected" && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice err">The wallet declined. Approve the connection and the Coston2 network prompt, then try again.</div>
          </div>
        )}
        {notice === "no-wallet" && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice" style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                GemWallet isn't in this browser. <a href="https://gemwallet.app" target="_blank" rel="noreferrer">Install it</a>{" "}
                (2 minutes, testnet supported) — or pick an EVM wallet in <em>Connect wallet</em>; manual copy-paste
                mode works everywhere too.
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

      <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} onXrpl={pickXrpl} onEvm={pickEvm} busy={connecting} />

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
