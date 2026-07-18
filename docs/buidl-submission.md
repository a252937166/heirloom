# DoraHacks BUIDL 提交材料包（Heirloom · Flare Summer Signal）

> 提交时对照本文件逐字段填写。平台坑参照既往经验：logo **必须用户手动上传**（桌面已备 `heirloom-logo-512.png`）；Details 切 old editor 用原生 setter 注入；Category 输入后必须**点选**并核对 chips；Contact 强制 Telegram。
> 新建 BUIDL（不要动 Faktura 46370，它是独立第二张彩票）。

## Profile

| 字段 | 值 |
|---|---|
| BUIDL name | `Heirloom` |
| Vision (tagline) | `The continuity vault for XRP — if you go silent, your family receives your coins, proven by Flare consensus.` |
| Category | Crypto/Web3 → 子类勾 `DeFi` + `Infra`（若有 RWA/Consumer 选项可加） |
| L1s | `Flare` |
| AI Agent | **No** |
| Website | `https://heirloom.axiqo.xyz` (footer 与 /api/health 显示与提交 tag 相同的 build SHA) |
| GitHub | `https://github.com/a252937166/heirloom` |
| Demo video | （视频上传后填 YouTube 链接） |
| Social | 现有 X 账号主页 |

## Submission

- Hackathon: Flare Summer Signal
- Track: **Bounty 1 — Interoperable Asset Products**

## Details（old editor 注入以下 Markdown 全文）

```markdown
# Heirloom — the continuity vault for XRP

**If you go silent, your XRP reaches the person you chose — proven by Flare consensus, never by a company.**

Live app: **https://heirloom.axiqo.xyz** · GitHub: https://github.com/a252937166/heirloom · Flare Coston2 + XRPL testnet (demo timing)

Self-custodied assets become inaccessible the moment their holder can no longer act — and XRPL cannot express a resettable inactivity condition natively: escrows release on fixed dates and cannot be reset by a heartbeat. Custodial services solve it by taking your keys; Heirloom solves it without anyone taking them.

Heirloom is the non-custodial answer, and it is only possible on Flare:

- **FAssets** custodies the XRP programmatically (direct mint in, redemption out) — the owner funds a personal vault contract with **one ordinary XRPL payment**, the XRP-native path never needs an EVM wallet.
- **FDC `XRPPayment`** proves owner-signed facts: 1-drop heartbeats reset the dial; a special memo cancels and refunds; the funding payment itself is proven and minted.
- **FDC `ReferencedPaymentNonexistence`** — the FDC's consensus **proof of absence** — proves the silence, source-filtered so nobody can fake the owner's liveness, chained ledger-by-ledger so nobody can skip a heartbeat.

## The two impossibilities

**1. An attacker cannot keep the owner "alive."** Copycat heartbeats with the identical memo are invisible to the silence proof (`checkSourceAddresses`). Demonstrated on-chain: an attacker sent identical memos; the network still attested the silence (voting round 1398559, verified by `FdcVerification`).

**2. The beneficiary cannot come early.** While the owner lives, the proof is unproducible (`INVALID: REFERENCED TRANSACTION EXISTS`); the claim window must chain exactly from `lastHeartbeatLedger + 1`; and after real silence a challenge window still lets one heartbeat veto everything. An early release attempt was rejected on-chain with `ChallengeNotOver`.

## Proven on real infrastructure — the canonical case runs on the CURRENT contracts

**Case #001 (contract v4, fully reconciled)** — live at https://heirloom.axiqo.xyz/case/001, manifest
generated from chain + XRPL data by `spike/build-case.mjs`:

| step | evidence |
|---|---|
| Fund with **one XRPL payment** | direct-minted **10.07569 FXRP** into the vault |
| Heartbeat (1 drop + reference memo) | FDC-attested, `recordHeartbeat` on-chain |
| **Early-claim drill** | blocked on-chain via `staticCall` — `SilenceNotProven`, funds moved 0 (recorded in the journal) |
| Silence proven | source-filtered `ReferencedPaymentNonexistence`, chained from the heartbeat ledger + 1 |
| Challenge + veto-proof grace | release waited out the challenge **and** the 180s proof buffer — the XRPL timestamp decides a veto, never transaction ordering |
| **Full-balance redemption** | request `#39635850` for the entire 10.07569 FXRP, decoded from the release receipt |
| **Real XRP delivered** | beneficiary's own wallet received **10.025312 XRP** (exact to the drop: redeemed 10.07569 − 0.050378 agent fee) — settlement memo equals the redemption `paymentReference`, byte for byte |
| **Reconciled to zero** | final vault balance **0 FXRP** — `SETTLED · FULLY RECONCILED`, five integrity checks pass |

Earlier full runs (v1 lot-redemption era; v2 residual case) are kept in the README as provenance — each gap
drove the next contract revision.

## Architecture

In the flagship XRP-native mode, the EVM side has **no privileged user key**. Every state change is authorized by an XRPL event proven by FDC, or a public timeout; every keeper action is a permissionless crank anyone could submit from public data (we watched a third-party executor beat our own keeper to a mint — the vault didn't care).

Contracts: `HeirloomVault` (explicit lifecycle state machine — 8 states incl. re-crankable `Cancelling`, dual-proof validation, challenge veto + veto-proof grace, XRPL-signed cancel, alternative EVM-owner mode) + `HeirloomFactory` (EIP-1167 clone per plan). Factory (v4, source-verified): `0x8FFD0a1DeAb498A5F0A2798bBefb2C071091a77f` (Coston2). 19 unit tests incl. adversarial, veto-race and partial-redemption suites.

App: the **Live Case Dashboard** (`/case/001`) replays one real completed lifecycle in seven chapters — dual-ledger transaction rail, two attack drills, and a reconciled payout receipt whose five integrity checks are generated from chain data by `spike/build-case.mjs`, plus a 90-second guided tour. Create a plan in 60 seconds (GemWallet first; MetaMask/OKX auto-adds Coston2 for one-click check-ins; or any XRPL wallet via copyable instructions), a living Pulse Dial, an evidence timeline where every entry links to a public transaction, and a printable **Recovery Kit** so the beneficiary can claim without our help.

## What was built during the hackathon

Everything — first commit to live product during Flare Summer Signal (July 2026): contracts, keeper, web app, and the on-chain gate scripts that de-risked each primitive (all saved with their proofs in the repo).

## Honest boundaries

Heirloom never holds keys, cannot change the recipient, and cannot release before inactivity + challenge have both elapsed. Settlement relies on Flare FAssets, FDC consensus, and XRPL; the payout is a public transaction. It is a technical continuity mechanism, not a legal will. Full THREAT_MODEL in the repo (fake-liveness, premature claim, window cheating, keeper death, redemption defaults, dust, privacy).

## Roadmap

Mainnet with 90–180-day periods and 7-day rolling checkpoints · lost-key self-recovery (same primitive, second product) · multi-beneficiary value splits (FTSO-priced) · FBTC/FDOGE as FAssets expand — the continuity layer for all FAssets.
```

## 评委可测清单（Details 末尾或 comment 区可补）

- Live case（60 秒无钱包审计线路）: https://heirloom.axiqo.xyz/case/001
- Live: https://heirloom.axiqo.xyz （创建自己的金库全程真实交易；GemWallet 优先，MetaMask/OKX 自动加 Coston2）
- Factory explorer (v4): https://coston2-explorer.flare.network/address/0x8FFD0a1DeAb498A5F0A2798bBefb2C071091a77f
- Canonical v4 生命周期与历史 provenance 全部见 README（一个当前案例、一套数字、一条主证据链）

## Team / Contact

- Team: solo（一句话沿用既往）
- Contact: Telegram 主联系（既往同款），WeChat backup
