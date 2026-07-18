// GemWallet (XRPL browser extension) — the hero wallet path.
// Falls back to "manual mode" (QR/copy fields for Xaman) when not installed.
import { isInstalled, getAddress, sendPayment, getNetwork } from "@gemwallet/api";

export interface WalletState {
  installed: boolean;
  address: string | null;
  network: string | null;
}

export async function detectWallet(): Promise<WalletState> {
  try {
    const inst = await isInstalled();
    if (!inst.result.isInstalled) return { installed: false, address: null, network: null };
    return { installed: true, address: null, network: null };
  } catch {
    return { installed: false, address: null, network: null };
  }
}

export async function connectWallet(): Promise<WalletState> {
  const inst = await isInstalled();
  if (!inst.result.isInstalled) return { installed: false, address: null, network: null };
  const [addr, net] = await Promise.all([getAddress(), getNetwork()]);
  return {
    installed: true,
    address: addr.result?.address ?? null,
    network: net.result?.network ?? null,
  };
}

/** Sends an XRPL payment with a single MemoData memo (hex, no 0x). Returns tx hash. */
export async function payWithMemo(opts: {
  destination: string;
  amountDrops: string;
  memoHex?: string;
}): Promise<string | null> {
  const payload: Parameters<typeof sendPayment>[0] = {
    amount: opts.amountDrops,
    destination: opts.destination,
    ...(opts.memoHex
      ? { memos: [{ memo: { memoData: opts.memoHex.toUpperCase() } }] }
      : {}),
  };
  const res = await sendPayment(payload);
  return res.result?.hash ?? null;
}

/** Testnet XRP balance over WebSocket — the HTTP JSON-RPC port has no CORS
 * headers, so browsers can only reach XRPL via wss (same path xrpl.js uses). */
export function xrpBalance(address: string): Promise<string | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch { /* already closed */ }
      resolve(v);
    };
    try {
      ws = new WebSocket("wss://s.altnet.rippletest.net:51233");
    } catch {
      resolve(null);
      return;
    }
    const t = setTimeout(() => finish(null), 7000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, command: "account_info", account: address, ledger_index: "validated" }));
    ws.onmessage = (ev) => {
      clearTimeout(t);
      try {
        const j = JSON.parse(String(ev.data));
        const drops = j?.result?.account_data?.Balance;
        finish(drops ? (Number(drops) / 1e6).toFixed(2) : null);
      } catch {
        finish(null);
      }
    };
    ws.onerror = () => { clearTimeout(t); finish(null); };
  });
}

/** Ask the official XRPL testnet faucet to fund an existing address (CORS-enabled). */
export async function fundTestXrp(address: string): Promise<boolean> {
  try {
    const r = await fetch("https://faucet.altnet.rippletest.net/accounts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: address }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export const strToHex = (s: string) =>
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
