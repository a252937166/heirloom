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

export const strToHex = (s: string) =>
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
