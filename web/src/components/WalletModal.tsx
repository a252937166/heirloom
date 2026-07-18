// The Connections dialog — sectioned by ledger, XRPL-native first.
// EVM wallets are listed from EIP-6963 discovery with their real names/icons.
import { useEffect, useState } from "react";
import { WalletOption, detectedWallets } from "../lib/evm";
import { detectWallet } from "../lib/gem";

function Row({ icon, name, note, right, onClick, disabled }: {
  icon: React.ReactNode; name: string; note?: string;
  right?: React.ReactNode; onClick?: () => void; disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const Tag: "button" | "div" = onClick && !disabled ? "button" : "div"; // never nest links inside a button
  return (
    <Tag onClick={onClick} {...(Tag === "button" ? { disabled } : {})}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
        padding: "12px 14px", borderRadius: 12, cursor: onClick && !disabled ? "pointer" : "default",
        background: hover && onClick && !disabled ? "color-mix(in srgb, var(--lamplight) 10%, transparent)" : "color-mix(in srgb, var(--paper) 3%, transparent)",
        border: `1px solid ${hover && onClick && !disabled ? "color-mix(in srgb, var(--lamplight) 40%, transparent)" : "var(--line)"}`,
        transition: "background .15s, border-color .15s", opacity: disabled ? 0.55 : 1,
      }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", overflow: "hidden", background: "var(--ink)", border: "1px solid var(--line)", flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", color: "var(--paper)", fontSize: "0.92rem", fontWeight: 500 }}>{name}</span>
        {note && <span className="mono" style={{ display: "block", fontSize: "0.64rem", color: "var(--mist-2)", marginTop: 2 }}>{note}</span>}
      </span>
      {right ?? <span style={{ color: "var(--mist-2)" }}>›</span>}
    </Tag>
  );
}

function SectionHead({ label, badge, note }: { label: string; badge?: string; note: string }) {
  return (
    <div style={{ margin: "18px 2px 8px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span className="mono" style={{ fontSize: "0.68rem", letterSpacing: "0.08em", color: "var(--paper)" }}>
          <span style={{ color: "var(--lamplight)" }}>▎</span>{label}
        </span>
        {badge && <span className="mono" style={{ fontSize: "0.58rem", letterSpacing: "0.1em", color: "var(--lamplight)" }}>{badge}</span>}
      </div>
      <div className="mono" style={{ fontSize: "0.62rem", color: "var(--mist-2)", marginTop: 3 }}>{note}</div>
    </div>
  );
}

export function WalletModal({ open, onClose, onXrpl, onEvm, busy }: {
  open: boolean;
  onClose: () => void;
  onXrpl: () => void;
  onEvm: (opt: WalletOption) => void;
  busy: boolean;
}) {
  const [gemInstalled, setGemInstalled] = useState<boolean | null>(null);
  const [evmList, setEvmList] = useState<WalletOption[]>([]);

  useEffect(() => {
    if (!open) return;
    detectWallet().then((w) => setGemInstalled(w.installed)).catch(() => setGemInstalled(false));
    setEvmList(detectedWallets());
    const t = setTimeout(() => setEvmList(detectedWallets()), 350); // 6963 announcements are async
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div onClick={onClose} className="no-print" role="dialog" aria-modal="true" aria-label="Connections"
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "color-mix(in srgb, var(--ink) 72%, transparent)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(420px, 100%)", background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 18, padding: "22px 22px 20px", boxShadow: "0 24px 80px rgba(0,0,0,.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", color: "var(--paper)" }}>Connections</h3>
          <button onClick={onClose} aria-label="Close"
            style={{ background: "none", border: "none", color: "var(--mist-2)", fontSize: "1.05rem", cursor: "pointer", padding: 4 }}>✕</button>
        </div>
        <p style={{ fontSize: "0.82rem", color: "var(--mist)", margin: "6px 0 2px" }}>
          A plan lives on two ledgers. XRPL is where you act — an EVM wallet is the wider door.
        </p>

        <SectionHead label="XRPL (NATIVE)" badge="RECOMMENDED" note="1-drop heartbeats · proven by Flare's Data Connector" />
        <Row
          icon={<span style={{ color: "var(--verdant)", fontWeight: 700, fontFamily: "var(--font-display)" }}>G</span>}
          name="GemWallet"
          note={gemInstalled === false ? "not detected in this browser" : "XRPL testnet"}
          right={gemInstalled === false
            ? <a href="https://gemwallet.app" target="_blank" rel="noreferrer" className="mono" style={{ fontSize: "0.7rem" }} onClick={(e) => e.stopPropagation()}>Install ↗</a>
            : undefined}
          onClick={gemInstalled === false ? undefined : onXrpl}
          disabled={busy}
        />

        <SectionHead label="FLARE COSTON2 (EVM)" note="one-click check-ins · the network is added & switched automatically" />
        <div style={{ display: "grid", gap: 8 }}>
          {evmList.map((w) => (
            <Row key={w.id}
              icon={w.icon
                ? <img src={w.icon} alt="" style={{ width: 22, height: 22 }} />
                : <span style={{ color: "var(--lamplight)", fontWeight: 700, fontFamily: "var(--font-display)" }}>{w.name.slice(0, 1)}</span>}
              name={w.name}
              onClick={() => onEvm(w)}
              disabled={busy}
            />
          ))}
          {evmList.length === 0 && (
            <Row
              icon={<span style={{ color: "var(--lamplight)", fontWeight: 700 }}>M</span>}
              name="MetaMask"
              note="not detected in this browser"
              right={<a href="https://metamask.io" target="_blank" rel="noreferrer" className="mono" style={{ fontSize: "0.7rem" }}>Install ↗</a>}
            />
          )}
        </div>

        <p className="mono" style={{ fontSize: "0.62rem", color: "var(--mist-2)", marginTop: 16, lineHeight: 1.6 }}>
          No wallet at all? Every payment in the app is also shown as copyable instructions — testnet gas is
          free: faucet.flare.network · {busy ? "waiting for the wallet…" : "nothing is signed without your approval."}
        </p>
      </div>
    </div>
  );
}
