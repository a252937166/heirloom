// MetaMask / OKX (EVM) — the second door for owners without an XRPL wallet.
// The XRPL-native wallet stays the primary path; here a check-in is a one-click
// Coston2 transaction and Flare's consensus timestamp is the silence clock.
import { BrowserProvider, Contract, Eip1193Provider } from "ethers";
import { CONFIG } from "../config";

type Injected = Eip1193Provider & { isMetaMask?: boolean; isOkxWallet?: boolean };

export interface EvmState {
  available: boolean;
  kind: string | null; // "MetaMask" | "OKX Wallet" | "browser wallet"
  address: string | null;
}

export const EVM_NONE: EvmState = { available: false, kind: null, address: null };

function rawProvider(): { p: Injected; kind: string } | null {
  const w = window as unknown as { ethereum?: Injected; okxwallet?: { ethereum?: Injected } & Injected };
  if (w.ethereum) {
    return { p: w.ethereum, kind: w.ethereum.isMetaMask ? "MetaMask" : w.ethereum.isOkxWallet ? "OKX Wallet" : "browser wallet" };
  }
  const okx = w.okxwallet?.ethereum ?? w.okxwallet;
  if (okx) return { p: okx, kind: "OKX Wallet" };
  return null;
}

export const evmDetected = () => rawProvider() !== null;

const COSTON2 = {
  chainId: "0x72", // 114
  chainName: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: [CONFIG.rpc],
  blockExplorerUrls: [CONFIG.explorer],
};

/** Connect and make sure the wallet is on Coston2 — adding the chain automatically if missing. */
export async function connectEvm(): Promise<EvmState> {
  const rp = rawProvider();
  if (!rp) return EVM_NONE;
  const accounts = (await rp.p.request({ method: "eth_requestAccounts" })) as string[];
  try {
    await rp.p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: COSTON2.chainId }] });
  } catch (e) {
    const err = e as { code?: number; message?: string };
    // 4902 = chain not added yet — this is the automatic setup the user asked for
    if (err.code === 4902 || /4902|unrecognized|not.*added/i.test(String(err.message))) {
      await rp.p.request({ method: "wallet_addEthereumChain", params: [COSTON2] });
    } else {
      throw e;
    }
  }
  return { available: true, kind: rp.kind, address: accounts?.[0] ?? null };
}

async function signerOnCoston2() {
  const rp = rawProvider();
  if (!rp) throw new Error("No MetaMask or OKX extension detected.");
  await connectEvm(); // re-asserts account + chain; a no-op when already connected
  return await new BrowserProvider(rp.p).getSigner();
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
  if (/insufficient funds/i.test(m)) return "Not enough C2FLR for gas — grab free testnet gas at faucet.flare.network (Coston2 tab), then retry.";
  if (/user rejected|denied|4001/i.test(m)) return "The wallet declined the transaction.";
  if (/No MetaMask or OKX/i.test(m)) return m;
  if (/revert|CALL_EXCEPTION|missing revert data/i.test(m)) return "The vault refused — make sure the connected account is this plan's owner account.";
  return m.slice(0, 180);
}
