import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Landing } from "./pages/Landing";
import { Create } from "./pages/Create";
import { Vault } from "./pages/Vault";
import { Claim } from "./pages/Claim";
import { Kit } from "./pages/Kit";
import { CaseStudy } from "./pages/CaseStudy";
import { WalletModal } from "./components/WalletModal";
import { FlareMark } from "./components/FlareMark";
import lockup from "./assets/heirloom-lockup.png";
import { WalletState, connectWallet, fundTestXrp, xrpBalance } from "./lib/gem";
import { EVM_NONE, EvmState, WalletOption, connectWith, disconnectEvm, retrySwitch, silentReconnect } from "./lib/evm";
import { CONFIG } from "./config";
import { c2Balance, fmtFxrp, readVault, short, vaultsOfOwner } from "./lib/chain";

const PLAN_STATES = ["—", "Funding", "Active", "Claim pending", "Releasing", "Released", "Cancelled", "Cancelling"];
const PLAN_TONES = ["var(--mist-2)", "var(--lamplight)", "var(--verdant)", "var(--ember)", "var(--ember)", "var(--mist)", "var(--mist-2)", "var(--ember)"];

const WalletCtx = createContext<{
  wallet: WalletState;
  evm: EvmState;
  connect: () => Promise<WalletState>;
  openConnect: () => void;
  refreshPlans: () => void;
  connecting: boolean;
  notice: string | null;
}>({
  wallet: { installed: false, address: null, network: null },
  evm: EVM_NONE,
  connect: async () => ({ installed: false, address: null, network: null }),
  openConnect: () => {},
  refreshPlans: () => {},
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
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctBal, setAcctBal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null);
  const loc = useLocation();

  // account panel: balance is read from the chain itself, not trusted from the wallet
  useEffect(() => {
    if (!acctOpen) return;
    setAcctBal(null);
    if (evm.address) c2Balance(evm.address).then(setAcctBal).catch(() => setAcctBal("—"));
    else if (wallet.address) xrpBalance(wallet.address).then((b) => setAcctBal(b ?? "—")).catch(() => setAcctBal("—"));
  }, [acctOpen, evm.address, wallet.address]);

  const refreshPlans = useCallback(() => {
    if (wallet.address) {
      vaultsOfOwner(wallet.address).then((v) => setMyPlans([...v])).catch(() => {});
    } else if (evm.address) {
      fetch(`${CONFIG.api}/plans/of/${evm.address}`)
        .then((r) => (r.ok ? r.json() : { vaults: [] }))
        .then((j) => setMyPlans(j.vaults ?? []))
        .catch(() => {});
    }
  }, [wallet.address, evm.address]);
  useEffect(() => { refreshPlans(); }, [refreshPlans]);

  // survive page refreshes: remember the last wallet and restore it silently
  // (eth_accounts / an already-authorized GemWallet never pop a prompt)
  useEffect(() => {
    const saved = localStorage.getItem("hl.wallet");
    if (!saved) return;
    if (saved === "xrpl") {
      connectWallet().then((w) => {
        if (w.address) setWallet(w);
        else localStorage.removeItem("hl.wallet");
      }).catch(() => {});
    } else if (saved.startsWith("evm:")) {
      silentReconnect(saved.slice(4)).then((st) => {
        if (st) setEvm(st);
        else localStorage.removeItem("hl.wallet");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the plans menu shows live state + balance for each vault
  const [planInfo, setPlanInfo] = useState<Record<string, { state: number; bal: string }>>({});
  useEffect(() => {
    if (!plansOpen) return;
    refreshPlans();
    myPlans.slice(0, 8).forEach((p) => {
      readVault(p)
        .then((v) => setPlanInfo((m) => ({ ...m, [p]: { state: v.state, bal: fmtFxrp(v.fxrpBalance) } })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plansOpen, myPlans.join(",")]);

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
      if (st.address) {
        localStorage.setItem("hl.wallet", `evm:${opt.rdns}`);
        setModalOpen(false);
      } else setNotice("evm-rejected");
    } catch (e) {
      setNotice(/rejected|denied|4001/i.test(String((e as Error).message)) ? "evm-rejected" : "no-evm");
    } finally {
      setConnecting(false);
    }
  };

  const pickXrpl = async () => {
    const w = await connect();
    if (w.address) {
      localStorage.setItem("hl.wallet", "xrpl");
      setModalOpen(false);
    }
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

  // XRPL wallets need test XRP (not C2FLR — that's for 0x addresses only).
  // With GemWallet connected we fund the address directly via the official faucet.
  const fundXrp = async () => {
    if (!wallet.address) {
      window.open("https://xrpl.org/resources/dev-tools/xrp-faucets", "_blank");
      return;
    }
    setFaucetMsg("requesting…");
    const ok = await fundTestXrp(wallet.address);
    setFaucetMsg(ok ? "Test XRP requested — it lands on your wallet in a few seconds." : "Faucet unreachable — try xrpl.org/resources/dev-tools/xrp-faucets.");
    setTimeout(() => setFaucetMsg(null), 6000);
  };

  const disconnect = () => {
    localStorage.removeItem("hl.wallet");
    setWallet((w) => ({ installed: w.installed, address: null, network: null }));
    setEvm(EVM_NONE);
    setMyPlans([]);
    setAcctOpen(false);
    void disconnectEvm();
  };

  return (
    <WalletCtx.Provider value={{ wallet, evm, connect, openConnect: () => setModalOpen(true), refreshPlans, connecting, notice }}>
      <div className="bg-ambient" aria-hidden="true">
        <span className="blob b1" /><span className="blob b2" /><span className="blob b3" />
      </div>
      <header style={{ borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "color-mix(in srgb, var(--ink) 88%, transparent)", backdropFilter: "blur(8px)", zIndex: 10 }} className="no-print">
        <div className="wrap" style={{ display: "flex", alignItems: "center", gap: 26, height: 62 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <Link to="/" style={{ display: "inline-flex", alignItems: "center" }} aria-label="Heirloom home">
              <img src={lockup} alt="Heirloom — continuity vault for XRP" style={{ height: 30, display: "block" }} />
            </Link>
            <span className="pill" style={{ fontSize: "0.55rem", letterSpacing: "0.12em", padding: "3px 8px", color: "var(--mist-2)" }}>TESTNET</span>
            <a href="https://dev.flare.network" target="_blank" rel="noreferrer" className="mono" title="Built on Flare"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.62rem", color: "var(--mist-2)", textDecoration: "none" }}>
              on <FlareMark size={14} />
            </a>
          </span>
          <nav style={{ display: "flex", gap: 20, alignItems: "stretch", alignSelf: "stretch", flex: 1, minWidth: 0 }}>
            {[
              { to: "/case/001", match: "/case", icon: "▶", label: "Live case" },
              { to: "/create", match: "/create", icon: "＋", label: "Create a plan" },
            ].map((n) => {
              const active = loc.pathname.startsWith(n.match);
              return (
                <Link key={n.to} to={n.to} className="mono nav-item"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7, fontSize: "0.76rem", letterSpacing: "0.05em",
                    color: active ? "var(--lamplight)" : "var(--mist)", textDecoration: "none",
                    borderBottom: active ? "2px solid var(--lamplight)" : "2px solid transparent",
                    marginBottom: -1, padding: "0 2px", whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                  <span style={{ fontSize: "0.7rem", opacity: 0.9 }}>{n.icon}</span>{n.label}
                </Link>
              );
            })}
            {(wallet.address || evm.address) && (
              <span style={{ position: "relative", display: "inline-flex", alignItems: "stretch" }}>
                <button className="mono nav-item" aria-expanded={plansOpen} onClick={() => setPlansOpen((o) => !o)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7, fontSize: "0.76rem", letterSpacing: "0.05em",
                    color: plansOpen ? "var(--lamplight)" : "var(--mist)", background: "none", border: "none", cursor: "pointer",
                    borderBottom: plansOpen ? "2px solid var(--lamplight)" : "2px solid transparent", marginBottom: -1,
                    padding: "0 2px", whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                  <span style={{ fontSize: "0.7rem", opacity: 0.9 }}>▦</span>My plans
                  {myPlans.length > 0 && (
                    <span className="pill" style={{ fontSize: "0.58rem", padding: "1px 7px", color: "var(--lamplight)", borderColor: "color-mix(in srgb, var(--lamplight) 45%, transparent)" }}>
                      {myPlans.length}
                    </span>
                  )}
                </button>
                {plansOpen && (
                  <div style={{ position: "absolute", right: 0, top: 54, background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 14, padding: 12, width: 300, zIndex: 30, boxShadow: "0 18px 60px rgba(0,0,0,.45)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2px 6px 10px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>
                      <span style={{ fontSize: "0.85rem", color: "var(--paper)", fontWeight: 500 }}>My plans</span>
                      <span className="mono" style={{ fontSize: "0.62rem", color: "var(--mist-2)" }}>live from the chain</span>
                    </div>
                    {myPlans.length === 0 && (
                      <p style={{ fontSize: "0.8rem", padding: "4px 6px 8px", color: "var(--mist)" }}>No plans yet — create your first.</p>
                    )}
                    {myPlans.map((p) => {
                      const info = planInfo[p.toLowerCase()] ?? planInfo[p];
                      return (
                        <Link key={p} to={`/vault/${p}`} onClick={() => setPlansOpen(false)} className="menu-row"
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 8px", borderRadius: 9, textDecoration: "none" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: info ? PLAN_TONES[info.state] : "var(--line)", flexShrink: 0 }} />
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span className="mono" style={{ display: "block", fontSize: "0.78rem", color: "var(--paper)" }}>{short(p, 8)}</span>
                            <span className="mono" style={{ display: "block", fontSize: "0.62rem", color: info ? PLAN_TONES[info.state] : "var(--mist-2)", marginTop: 2 }}>
                              {info ? `${PLAN_STATES[info.state]} · ${info.bal} FXRP` : "reading state…"}
                            </span>
                          </span>
                          <span style={{ color: "var(--mist-2)" }}>›</span>
                        </Link>
                      );
                    })}
                    <Link to="/create" onClick={() => setPlansOpen(false)} className="menu-row"
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 8px", borderRadius: 9, marginTop: 4, borderTop: "1px solid var(--line)", textDecoration: "none" }}>
                      <span style={{ color: "var(--lamplight)" }}>＋</span>
                      <span style={{ fontSize: "0.8rem", color: "var(--mist)" }}>New plan</span>
                    </Link>
                  </div>
                )}
              </span>
            )}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {wallet.address || evm.address ? (
              <span style={{ position: "relative" }}>
                <button className="pill gold" title={wallet.address ?? evm.address ?? ""} onClick={() => setAcctOpen((o) => !o)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", background: "none", whiteSpace: "nowrap" }}>
                  {evm.address && evm.icon ? <img src={evm.icon} alt="" style={{ width: 14, height: 14, borderRadius: 4 }} /> : <span>●</span>}
                  {short((wallet.address ?? evm.address) as string, 6)} · {wallet.address ? "GemWallet" : evm.kind}
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: wallet.address || evm.chainOk ? "var(--verdant)" : "var(--ember)" }} />
                  <span style={{ fontSize: "0.6rem", color: "var(--mist-2)" }}>▾</span>
                </button>
                {acctOpen && (
                  <div style={{ position: "absolute", right: 0, top: 46, background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 14, padding: 16, width: 284, zIndex: 30, boxShadow: "0 18px 60px rgba(0,0,0,.45)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--ink)", border: "1px solid var(--line)", overflow: "hidden", flexShrink: 0 }}>
                        {evm.address && evm.icon
                          ? <img src={evm.icon} alt="" style={{ width: 20, height: 20 }} />
                          : <span style={{ color: "var(--verdant)", fontWeight: 700, fontFamily: "var(--font-display)" }}>{wallet.address ? "G" : "●"}</span>}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: "0.88rem", color: "var(--paper)", fontWeight: 500 }}>{wallet.address ? "GemWallet" : evm.kind}</span>
                        <span className="mono" style={{ fontSize: "0.66rem", color: "var(--mist-2)" }}>{short((wallet.address ?? evm.address) as string, 10)}</span>
                      </span>
                      <button className="mono"
                        onClick={() => { navigator.clipboard?.writeText((wallet.address ?? evm.address) as string); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
                        style={{ marginLeft: "auto", background: "none", border: "1px solid var(--line)", borderRadius: 6, color: copied ? "var(--verdant)" : "var(--mist-2)", fontSize: "0.62rem", padding: "3px 8px", cursor: "pointer" }}>
                        {copied ? "copied" : "copy"}
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: 9, fontSize: "0.8rem", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--mist-2)" }}>Network</span>
                        {wallet.address ? (
                          <span style={{ color: "var(--verdant)" }}>● XRPL {wallet.network ?? "Testnet"}</span>
                        ) : evm.chainOk ? (
                          <span style={{ color: "var(--verdant)" }}>● Flare Coston2</span>
                        ) : (
                          <button className="btn btn-ghost" style={{ padding: "3px 9px", fontSize: "0.7rem", color: "var(--ember)", borderColor: "color-mix(in srgb, var(--ember) 45%, transparent)" }}
                            onClick={retryNetwork} disabled={connecting}>
                            {connecting ? "Switching…" : "Wrong network — switch"}
                          </button>
                        )}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ color: "var(--mist-2)" }}>Balance</span>
                        <span className="mono" style={{ color: "var(--paper)" }}>
                          {acctBal ?? "…"} {wallet.address ? "XRP" : "C2FLR"}
                          {wallet.address && (
                            <> · <button onClick={fundXrp} className="mono" style={{ background: "none", border: "none", color: "var(--lamplight)", cursor: "pointer", fontSize: "0.7rem", padding: 0 }}>fund +</button></>
                          )}
                          {!wallet.address && acctBal !== null && Number(acctBal) === 0 && (
                            <> · <a href={CONFIG.faucet} target="_blank" rel="noreferrer" style={{ fontSize: "0.7rem" }}>faucet ↗</a></>
                          )}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <a className="mono" style={{ fontSize: "0.72rem" }} target="_blank" rel="noreferrer"
                          href={wallet.address ? `${CONFIG.xrplExplorer}/accounts/${wallet.address}` : `${CONFIG.explorer}/address/${evm.address}`}>
                          explorer ↗
                        </a>
                        <a className="mono" style={{ fontSize: "0.72rem" }} target="_blank" rel="noreferrer" href={CONFIG.github}>
                          GitHub ↗
                        </a>
                        {!wallet.address && (
                          <a className="mono" style={{ fontSize: "0.72rem" }} target="_blank" rel="noreferrer" href={CONFIG.faucet}>
                            C2FLR faucet ↗
                          </a>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 11, borderTop: "1px solid var(--line)" }}>
                      <button onClick={() => { setAcctOpen(false); setModalOpen(true); }}
                        style={{ background: "none", border: "none", color: "var(--mist-2)", fontSize: "0.74rem", cursor: "pointer", padding: 0 }}>
                        Change wallet
                      </button>
                      <button onClick={disconnect}
                        style={{ background: "none", border: "none", color: "var(--ember)", fontSize: "0.74rem", cursor: "pointer", padding: 0 }}>
                        Disconnect ⏻
                      </button>
                    </div>
                  </div>
                )}
              </span>
            ) : (
              <button className="btn btn-primary" style={{ padding: "9px 18px", fontSize: "0.85rem" }} onClick={() => setModalOpen(true)} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect Wallet"}
              </button>
            )}
            <span style={{ position: "relative" }} className="burger-wrap">
              <button className="btn btn-ghost burger" aria-expanded={menuOpen} aria-label="Menu"
                onClick={() => setMenuOpen((o) => !o)} style={{ padding: "6px 11px", fontSize: "0.9rem" }}>☰</button>
              {menuOpen && (
                <div style={{ position: "absolute", right: 0, top: 46, background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 10, width: 230, zIndex: 40, boxShadow: "0 18px 60px rgba(0,0,0,.45)" }}>
                  {[["/case/001", "▶ Live case"], ["/create", "＋ Create a plan"]].map(([to, label]) => (
                    <Link key={to} to={to} className="menu-row" onClick={() => setMenuOpen(false)}
                      style={{ display: "block", padding: "9px 10px", borderRadius: 8, fontSize: "0.85rem", textDecoration: "none", color: "var(--paper)" }}>
                      {label}
                    </Link>
                  ))}
                  <a className="menu-row" href={CONFIG.github} target="_blank" rel="noreferrer"
                    style={{ display: "block", padding: "9px 10px", borderRadius: 8, fontSize: "0.85rem", textDecoration: "none", color: "var(--mist)" }}>
                    GitHub ↗
                  </a>
                  <a className="menu-row" href={CONFIG.faucet} target="_blank" rel="noreferrer"
                    style={{ display: "block", padding: "9px 10px", borderRadius: 8, fontSize: "0.85rem", textDecoration: "none", color: "var(--mist)" }}>
                    C2FLR faucet ↗
                  </a>
                  {wallet.address && (
                    <button className="menu-row" onClick={() => { setMenuOpen(false); void fundXrp(); }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "9px 10px", borderRadius: 8, fontSize: "0.85rem", color: "var(--mist)" }}>
                      Get test XRP (one click)
                    </button>
                  )}
                </div>
              )}
            </span>
            </span>
          </nav>
        </div>
        {faucetMsg && (
          <div className="wrap" style={{ paddingBottom: 12 }}>
            <div className="notice ok">{faucetMsg}</div>
          </div>
        )}
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

      <div key={loc.pathname} className="page-enter">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/case/001" element={<CaseStudy />} />
        <Route path="/case" element={<Navigate to="/case/001" replace />} />
        <Route path="/create" element={<Create />} />
        <Route path="/vault/:address" element={<Vault />} />
        <Route path="/claim/:address" element={<Claim />} />
        <Route path="/kit/:address" element={<Kit />} />
      </Routes>
      </div>
      <footer className="footer-honest no-print">
        <div className="wrap">
          <p style={{ maxWidth: 760 }}>
            <strong>Honest boundaries.</strong> Heirloom never holds your keys, cannot change your recipient, and
            cannot release funds before the configured inactivity and challenge periods have both elapsed. Settlement
            relies on Flare FAssets, FDC consensus, and the XRP Ledger. Heirloom is a technical continuity mechanism —
            not a substitute for a legally valid will. Running on <FlareMark size={13} /> <span className="mono">Coston2</span> testnet
            with demo timing.
          </p>
        </div>
      </footer>
    </WalletCtx.Provider>
  );
}
