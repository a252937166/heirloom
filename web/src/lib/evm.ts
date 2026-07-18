// EVM wallets (MetaMask / OKX / …) — the second door for owners without an
// XRPL wallet. Wallets are discovered via EIP-6963, so each shows its real
// name and icon (OKX spoofs `isMetaMask` on window.ethereum — the legacy flag
// is a last resort only). Connecting always switches/adds Flare Coston2 and
// verifies the chain with eth_chainId before we call the network OK.
import { BrowserProvider, Contract, Eip1193Provider } from "ethers";
import { CONFIG } from "../config";

type Injected = Eip1193Provider & { isMetaMask?: boolean; isOkxWallet?: boolean };

export interface WalletOption {
  id: string;
  name: string;
  icon: string | null; // data: URI from EIP-6963
  provider: Injected;
}

export interface EvmState {
  available: boolean;
  kind: string | null;
  icon: string | null;
  address: string | null;
  chainOk: boolean;
}

export const EVM_NONE: EvmState = { available: false, kind: null, icon: null, address: null, chainOk: false };

// --- EIP-6963 discovery (populated by announce events as wallets load) -------
const announced = new Map<string, WalletOption>();
let active: WalletOption | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (ev) => {
    const d = (ev as CustomEvent<{ info?: { uuid: string; rdns?: string; name: string; icon?: string }; provider?: Injected }>).detail;
    if (d?.info?.uuid && d.provider) {
      announced.set(d.info.rdns ?? d.info.uuid, {
        id: d.info.uuid,
        name: d.info.name,
        icon: d.info.icon ?? null,
        provider: d.provider,
      });
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** All EVM wallets present in this browser, best identification first. */
export function detectedWallets(): WalletOption[] {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("eip6963:requestProvider"));
  const list = [...announced.values()];
  if (list.length) return list;
  // legacy fallback for wallets that don't speak EIP-6963
  const w = window as unknown as { ethereum?: Injected; okxwallet?: { ethereum?: Injected } & Injected };
  const okx = w.okxwallet?.ethereum ?? w.okxwallet;
  if (okx) return [{ id: "legacy-okx", name: "OKX Wallet", icon: null, provider: okx }];
  if (w.ethereum) {
    return [{ id: "legacy", name: w.ethereum.isOkxWallet ? "OKX Wallet" : w.ethereum.isMetaMask ? "MetaMask" : "Browser wallet", icon: null, provider: w.ethereum }];
  }
  return [];
}

export const evmDetected = () => detectedWallets().length > 0;

const COSTON2 = {
  chainId: "0x72", // 114
  chainName: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: [CONFIG.rpc],
  blockExplorerUrls: [CONFIG.explorer],
};

/** Switch to Coston2, adding it first if the wallet doesn't know it. Returns chain-verified truth. */
async function ensureCoston2(p: Injected): Promise<boolean> {
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: COSTON2.chainId }] });
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (err.code === 4902 || /4902|unrecognized|not.*added|添加/i.test(String(err.message))) {
      try {
        // adding the chain also switches to it in MetaMask/OKX
        await p.request({ method: "wallet_addEthereumChain", params: [COSTON2] });
      } catch { /* user declined the add — reflected by the chain check below */ }
    }
    // any other rejection also falls through to the truth check
  }
  try {
    const id = (await p.request({ method: "eth_chainId" })) as string;
    return parseInt(id, 16) === CONFIG.chainId;
  } catch {
    return false;
  }
}

/** Connect a specific discovered wallet, then force the network to Coston2. */
export async function connectWith(opt: WalletOption): Promise<EvmState> {
  const accounts = (await opt.provider.request({ method: "eth_requestAccounts" })) as string[];
  const chainOk = await ensureCoston2(opt.provider);
  active = opt;
  return { available: true, kind: opt.name, icon: opt.icon, address: accounts?.[0] ?? null, chainOk };
}

/** Re-attempt the network switch on the active wallet (wrong-network banner action). */
export async function retrySwitch(): Promise<boolean> {
  if (!active) return false;
  return await ensureCoston2(active.provider);
}

async function signerOnCoston2() {
  if (!active) {
    const list = detectedWallets();
    if (list.length === 1) {
      await connectWith(list[0]); // sole wallet — connect it transparently
    } else {
      throw new Error(list.length ? "PICK_WALLET" : "No MetaMask or OKX extension detected.");
    }
  }
  const ok = await ensureCoston2(active!.provider);
  if (!ok) throw new Error("WRONG_NETWORK");
  return await new BrowserProvider(active!.provider).getSigner();
}

const VAULT_EVM_ABI = ["function heartbeatEvm()", "function cancelEvm()"];

/** One-click check-in: the transaction's consensus timestamp resets the dial. */
export async function heartbeatEvmTx(vault: string): Promise<string> {
  const signer = await signerOnCoston2();
  const tx = await new Contract(vault, VAULT_EVM_ABI, signer).heartbeatEvm();
  await tx.wait();
  return tx.hash;
}

/** Owner-signed cancel: the vault hands all FXRP back to the owner account. */
export async function cancelEvmTx(vault: string): Promise<string> {
  const signer = await signerOnCoston2();
  const tx = await new Contract(vault, VAULT_EVM_ABI, signer).cancelEvm();
  await tx.wait();
  return tx.hash;
}

export function friendlyEvmError(e: unknown): string {
  const m = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e);
  if (m === "PICK_WALLET") return "Choose which wallet to use first — open Connect wallet.";
  if (m === "WRONG_NETWORK") return "The wallet stayed on another network. Approve the Flare Coston2 prompt and retry.";
  if (/insufficient funds/i.test(m)) return "Not enough C2FLR for gas — get free testnet gas at faucet.flare.network (Coston2 tab), then retry.";
  if (/user rejected|denied|4001/i.test(m)) return "The wallet declined the transaction.";
  if (/No MetaMask or OKX/i.test(m)) return m;
  if (/revert|CALL_EXCEPTION|missing revert data/i.test(m)) return "The vault refused — make sure the connected account is this plan's owner account.";
  return m.slice(0, 180);
}
