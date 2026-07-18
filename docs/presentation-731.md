# 7/31 Live Presentation — 演示动线与 Q&A 预案

> 报名一句话模板（你在 TG 群发给 Kristaps / 官方即可）：
> "Hi! I'd like a presentation slot on July 31 for **Heirloom — the continuity vault for XRP** (Bounty 1).
> Live product + one fully completed on-chain lifecycle to walk through: https://heirloom.axiqo.xyz/case/001"

## 开场 15 秒（一句话定位）

"If an XRP holder goes silent forever, their XRP usually dies with them. Heirloom fixes that with
Flare — the owner keeps their keys, stays alive with one-drop heartbeats, and only after consensus-proven
silence plus a final veto window does real XRP reach the person they chose."

## 90 秒版（评委时间紧时，全程 /case/001 一页搞定）

1. 打开 https://heirloom.axiqo.xyz/case/001 → 点 **"Start the 90-second tour"**，让页面自己讲。
2. 导览进行时只补三句：
   - Chapter 2: "One ordinary XRPL payment — FAssets mints straight into the vault, no EVM wallet needed."
   - Chapter 4 (ember): "This is the attack: an early claim. The proof of absence cannot even be built —
     the verifier answers REFERENCED TRANSACTION EXISTS."
   - Chapter 7 / 收据: "9.95 real XRP on the beneficiary's own wallet, and the receipt's five integrity
     checks are generated from chain data — including the 0.08 FXRP residual, disclosed, not hidden."

## 5 分钟完整动线

| 时间 | 屏幕 | 讲什么 |
|---|---|---|
| 0:00–0:30 | 首页 hero | 定位一句话 + "XRPL can't express resettable inactivity; custodians want your keys — that's the gap." |
| 0:30–2:00 | /case/001 导览（手动切章） | 七章走完；在 Chapter 5 停顿："this is the industry's only consensus **proof of absence** — source-filtered RPN, chained ledger by ledger." |
| 2:00–2:45 | /case/001 双链轨道 | 点 Owner heartbeat → 配对高亮："user acts on XRPL, Flare proves and enforces. Remove any piece and the product collapses." |
| 2:45–3:30 | 攻击两卡 + 点进 Claim 页现场跑 "Test early-claim protection" | 现场看链拒绝（SilenceNotProven）——"the safety mechanics defend even against us." |
| 3:30–4:15 | Create 第 1 步 | 展示双钱包门：GemWallet 优先；点 MetaMask → Coston2 自动入钱包。"XRPL-native is the hero; MetaMask is the wider door — heartbeatEvm one-click check-ins, consensus time as the clock." |
| 4:15–5:00 | 收据 + Recovery Kit 打印视图 | 收尾："every claim on this screen is a public transaction. The Recovery Kit means the beneficiary can finish the claim even if Heirloom disappears. The promise completed — and every step is public." |

备用（网络故障 Plan B）：demo 视频成片（确认开拍后产出）从 t5a 章节起播。

## Q&A 预案

- **"Why Flare / could you do this on XRPL alone?"** — XRPL escrows release on fixed dates and cannot be
  reset by a heartbeat; no proof-of-absence primitive exists there. FAssets gives programmable custody of
  XRP; FDC RPN gives consensus silence. Both load-bearing.
- **"What stops a copycat heartbeat?"** — Silence proofs set checkSourceAddresses=true with the owner's
  source root; we ran the three-verdict experiment on-chain (round 1398559, spike/gate1b-rpn.mjs).
- **"What if your keeper dies?"** — Every action is a permissionless crank from public data; the Recovery
  Kit prints the full proof recipe; a network executor once beat our keeper to a mint and the vault didn't care.
- **"Attestation window limits?"** — Measured ~14 days on Coston2 verifiers; production uses 7-day rolling
  checkpoints chained `next.minimal == prev.firstOverflow` (implemented + chain-tested, gate2).
- **"EVM mode weakens the story?"** — Different silence oracle (consensus clock vs FDC proof-of-absence),
  same enforcement; honest THREAT_MODEL section covers it. XRPL-native remains the flagship path.
- **"Is this a legal will?"** — No, and we say so on every page: technical continuity mechanism; pair it
  with estate documents naming the same beneficiary.
- **"Mainnet cost/readiness?"** — Timing is config; contracts verified on the explorer; FAssets mainnet
  rollout is the dependency we track.

## 检查单（上台前 10 分钟）

- [ ] `curl -s https://heirloom.axiqo.xyz/api/health` → ok:true
- [ ] /case/001 打开、tour 正常
- [ ] 一个 Active 状态演示金库（现建：keeper API，period 600s）+ GemWallet 里 owner 账户就位
- [ ] MetaMask 里删掉 Coston2（演示自动加链）
- [ ] 备份：demo 视频本地文件
