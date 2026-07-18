# TG 首发帖草稿（待用户确认后由用户/我代发）

> 发帖门槛已满足：合约部署 ✓ 真实 e2e 证据 ✓ 线上产品 ✓ 两个只有官方能答的问题 ✓
> 格式对标 Jerry/Keyless 的成功范式：定位一句话 + 已跑通的硬事实 + 具体技术问题

---

Sharing what we've been building for Summer Signal: **Heirloom — the continuity vault for XRP** (Bounty 1).

If an XRP holder goes verifiably silent, their designated recipient receives the actual XRP — proven by FDC, never by a company. XRPL escrows can't express "resettable inactivity", and that's exactly what FAssets custody + FDC's `ReferencedPaymentNonexistence` make possible on Flare.

Working end-to-end on Coston2 + XRPL testnet, no mocks:
- Funding = **one XRPL payment** (direct mint straight into the vault clone — the primary flow never needs an EVM wallet; there's also an optional MetaMask/OKX owner mode that auto-adds Coston2 for one-click check-ins)
- Heartbeats = 1-drop payments, proven via `XRPPayment`; silence = **source-filtered** `ReferencedPaymentNonexistence` chained ledger-by-ledger from `lastHeartbeatLedger + 1`
- We demonstrated on-chain that an attacker copying the owner's exact heartbeat memo **cannot** block the silence proof (source root filtering), and that early claims are structurally impossible while the owner lives
- Full lifecycle ran on real infra: mint → heartbeat → silence → claim → challenge (an early release got correctly rejected with `ChallengeNotOver`) → FAssets redemption → **beneficiary's own XRPL wallet received 9.95 XRP** (tx `7452922B…C7754B`)

60-second audit path (no wallet needed) — one real completed lifecycle, seven chapters, dual-ledger
transaction rail, and a payout receipt whose integrity checks are generated from chain data:
https://heirloom.axiqo.xyz/case/001

Live app (create your own vault, testnet): https://heirloom.axiqo.xyz
Repo (contracts verified on the Coston2 explorer): https://github.com/a252937166/heirloom

Two questions:
1. `ReferencedPaymentNonexistence` windows seem to be attestable only ~14 days back on Coston2's verifiers (measured: 14d VALID, 15d "BLOCK DOES NOT EXIST"). Is that history depth the same on mainnet verifiers, or configurable? Our rolling-checkpoint cadence depends on it.
2. For `executeDirectMinting` with the 32-byte recipient memo, is there an official executor service planned for mainnet, or should products expect to run their own executor long-term (as we do now)?

Feedback very welcome — especially on whether the challenge-window UX (owner's final veto after a claim opens) feels right to you.
