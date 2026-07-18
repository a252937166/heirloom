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
| Website | `https://heirloom.axiqo.xyz` |
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

## Fully proven on real infrastructure — twice, no mocks

Local lifecycle (vault `0x22d820…8826`) and the **production stack** (live keeper at heirloom.axiqo.xyz, vault `0x5655…BaEB`) each ran the whole story end-to-end:

| step | evidence |
|---|---|
| Fund with one XRPL payment | 32-byte recipient memo → `executeDirectMinting` → **Case #001 (contract v4): 10.07569 FXRP protected → FULL-balance redemption #39635850 → 10.03 XRP delivered · final balance 0 · SETTLED - FULLY RECONCILED** minted straight into the vault clone |
| Heartbeat | XRPL tx attested (rounds 1398606 / 1398650) → `recordHeartbeat` |
| Silence | source-filtered RPN chained from heartbeat ledger + 1 (rounds 1398610 / on-chain `0x6f89bcd7…`) |
| Claim → challenge → release | `ClaimStarted` → `ChallengeNotOver` enforced → `executeRelease` |
| **Real XRP delivered** | beneficiary's own XRPL wallet received **9.95 XRP** — twice (`7452922B…` and `F1B2764C…`) |

Rolling checkpoints for production-scale periods are implemented and chain-tested (attestation history depth measured at ~14 days; segments chain with `next.minimal == prev.firstOverflow`).

## Architecture

In the flagship XRP-native mode, the EVM side has **no privileged user key**. Every state change is authorized by an XRPL event proven by FDC, or a public timeout; every keeper action is a permissionless crank anyone could submit from public data (we watched a third-party executor beat our own keeper to a mint — the vault didn't care).

Contracts: `HeirloomVault` (7-state machine, dual-proof validation, challenge veto, XRPL-signed cancel, EVM-owner mode with consensus-time silence) + `HeirloomFactory` (EIP-1167 clone per plan). Factory (v3): `0xa1b97724E7447278ed749f57CEa1915Ad2C3AFA2` (Coston2). 15 unit tests incl. adversarial + EVM-owner suites.

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
- Factory explorer (v3): https://coston2-explorer.flare.network/address/0xa1b97724E7447278ed749f57CEa1915Ad2C3AFA2
- 两次完整生命周期的关键 tx 全在 README 表格（含 XRPL payout 双证）

## Team / Contact

- Team: solo（一句话沿用既往）
- Contact: Telegram 主联系（既往同款），WeChat backup
