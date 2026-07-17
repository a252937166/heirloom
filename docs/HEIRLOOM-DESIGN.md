# Heirloom — XRP 传承金库 · 产品与技术设计 **v2**

> 内部工作文档（中文）。对外材料一律英文。
> 比赛：Flare Summer Signal · Bounty 1 · 截止 2026-08-14
> **v2 变更（2026-07-17 外部 review 六项修正 + 一手文档核实后）**：
> ① claim 窗口改 ledger 锚定（修死锁 bug）② 心跳改「全局 Beacon + 32B reference + RPN source 过滤」③ 滚动检查点 P1→P0 ④ 建库入金改 Smart Accounts 0xFE + minimal proxy ⑤ 五态状态机 + 挑战期 ⑥ Recovery Kit P0 ⑦ 措辞三处收紧（XLS-86 已核实为 Firewall，弃用"修正案搁浅"叙事）
> 已验证地基：XRPPaymentNonexistence 链上验证 `true`（spike/out.json）；RPN `checkSourceAddresses/sourceAddressesRoot` 字段存在（官方规范）；0xFE 42 字节 memo/原子性/禁 destination tag/0xE0 恢复（官方文档）

---

## 0. 定位与句子

**产品名** Heirloom。**类别：XRP continuity vault**（不自称 legal will）。

**一句话**：The continuity vault for XRP. Stay in control while you are active; after verifiable inactivity and a final safety challenge, your designated recipient receives the redeemed XRP.

**短版**：Your XRP, under your rules — even when you can no longer act.

**核心亮点（评委 20 秒记住的那一个点）**：
> **两个"不可能"，都由 Flare 共识证明**：攻击者不可能替你续命（RPN source 过滤，冒名心跳被无视）；受益人不可能提前拿钱（沉默窗口 + 挑战期，缺席证明做不出来就是做不出来）。

**边界声明（必须出现在首页脚注与 README）**：
- Heirloom never holds your keys, cannot change your recipient, and cannot release funds before the configured inactivity and challenge periods have elapsed.
- Settlement relies on Flare FAssets, FDC consensus, and the XRP Ledger.（不再说 "no company in between"）
- Technical continuity mechanism, not a substitute for a legally valid will.
- 时间表述用 "never before your inactivity window and safety challenge have both elapsed"（不再说 "not a day earlier"）。

**需求论证（收紧后）**：~20% BTC 因死亡/丢钥匙永久消失；Ledger Recover 风波 = 需求大 + 拒绝托管；XRPL escrow 无可重置失活条件，社区反复讨论继承/恢复工具缺失（**不引用** "dead man's switch 修正案"——XLS-86 实为 Firewall，已核实）。定价先例：Kresus $99.99/yr、Casa 固定年费。

---

## 1. 心跳与沉默的证明设计（v2 核心）

### 1.1 全局 Heartbeat Beacon
- **一个**已激活的 XRPL 地址（一次储备金，永久复用；主密钥可禁用）。不再用 per-vault sink（未激活地址收不了 1 drop；tec 失败还会既不记心跳又堵死缺席证明——RECEIVER_FAILURE 在两类 nonexistence 里都算"匹配付款"，规范原文核实）。
- 每金库一个 **32 字节 heartbeatReference**（随机生成，创建时定死）。

### 1.2 心跳（正腿）— XRPPayment
owner → Beacon：**1 drop + 恰好一个 Memo，MemoData = reference（64 hex）**（= XRPL 标准付款引用格式）。
合约校验：`verifyXRPPayment` ✓ + `sourceAddressHash == ownerXrplHash` + `receivingAddressHash == beaconHash` + `firstMemoData == reference` + `status == SUCCESS` + `blockNumber > lastHeartbeatLedger`。
效果：`lastHeartbeatLedger = proof.blockNumber; lastHeartbeatTs = proof.blockTimestamp; heartbeatEpoch += 1`（旧 epoch 的沉默检查点全部作废）。

### 1.3 沉默（负腿）— ReferencedPaymentNonexistence（RPN）
请求：`destinationAddressHash = beaconHash`、`amount = 1`、`standardPaymentReference = reference`、**`checkSourceAddresses = true`、`sourceAddressesRoot = root(owner)`**。
- 攻击者冒发同 reference 付款 → source root 不匹配 → **不影响证明**（keep-alive 干扰在协议层解决，不再只靠文档披露）。
- ~~roadmap: 向 Flare 提议 source-filtered 类型~~（已原生存在，删）。
- `sourceAddressesRoot` 具体构造（单地址树根）由 **Gate 1 实测**确定。

### 1.4 窗口锚定（修死锁）
- v1 错误：`minimalBlockTimestamp <= lastAliveTs` 会把最后心跳包进搜索窗 → 证明永远做不出。
- v2：**第一段窗口 `minimalBlockNumber == lastHeartbeatLedger + 1`**；后续段 `next.minimalBlockNumber == prev.responseBody.firstOverflowBlockNumber`（首尾相接、不重叠、无缺口）；最后一段 `deadlineTimestamp >= expiresAt` 且 `firstOverflowBlockTimestamp > expiresAt`。
- 每段证明须绑定当前 `heartbeatEpoch`；epoch 变了检查点作废。

### 1.5 滚动沉默检查点（P0）
FDC 链上数据证明只覆盖近期窗口（~14 天量级，Gate 2 实测确切值）→ 90 天沉默必须分段证明。合约维护：
```solidity
uint64 silenceProvenThroughLedger;   // 心跳后重置为 lastHeartbeatLedger
uint64 silenceProvenThroughTs;
uint32 heartbeatEpoch;
```
**keeper 经济学（P0-lite）**：金库创建时带小额维护储备（C2FLR/FLR），每次 checkpoint crank 从储备报销 + 固定小奖励；储备余额与最近 checkpoint 在 UI 可见；储备耗尽 → UI 醒目警告 + 任何人可代充。文档写明退出路径（keeper 停摆时任何人可 crank；owner 随时 CANCEL）。

---

## 2. 生命周期状态机（v2）

```
PendingFunding → Active ⇄ ClaimPending → Releasing → Released
                   │            │
                   └── Cancelled ┘（owner CANCEL，任意未 Released 阶段可退出）
ClaimPending + 有效心跳 → 回 Active（挑战期否决）
```

- **Active → ClaimPending**：滚动检查点覆盖到期线（受益人发起，提交末段证明 + beneficiary 地址原像）。
- **ClaimPending（挑战期，产品默认 30 天 / demo 2 分钟）**：仅等待；owner 一笔心跳即否决回 Active。**"沉默≠死亡"的安全阀，也是演示场景**（受益人无法抢跑）。
- **ClaimPending → Releasing**：挑战期满，任何人 crank → 发起 FAssets 赎回。
- **Releasing**：赎回是异步/可部分/多请求的——维护 `remainingFXRP / totalRedeemedUBA / mapping(requestId => status)`；全部请求 paid 或 default 处理完 → **Released**。
- 演示指标三拆（诚实口径）：`Silence proven: ~2m40s / Release authorized: +challenge / XRP settlement: 视 agent 窗口`。**不再承诺 "<4 min 到账"**。

**时间参数**：产品默认 心跳周期 90–180d + 宽限 14d + 挑战 30d；测试网 demo 心跳 5min + 宽限 2min + 挑战 2min，UI 标注 `Demo timing`。

---

## 3. 建库与入金（v2：Smart Accounts 0xFE）

### 3.1 主路径：一笔 XRPL 付款建库+入金
官方 Custom Instruction（已核实）：42 字节 memo = `0xFE + walletId + executorFee(8B) + keccak(PackedUserOperation)(32B)`；executor（自建）拿 FDC XRPPayment 证明调 `executeDirectMintingWithData` → **mint FXRP + 执行 userOp 原子完成**，失败则全回滚（XRP 留 Core Vault，`0xE0` 恢复重铸）。
流程：`XRPL Payment(0xFE) → mint 到 owner PersonalAccount → approve Factory → createAndFund(config) → per-vault minimal-proxy clone 持有 FXRP`。
- **禁 destination tag**（官方防抢跑规则）→ 建库流与心跳流天然分离（心跳用 memo reference，不用 tag）。
- **UI 必须带 0xE0 恢复入口**（卡单时重铸不重付）。

### 3.2 每金库一个 minimal proxy（EIP-1167）
共享合约无法归属裸转入的 FXRP；clone 的地址即金库身份：余额清晰、事故隔离、Evidence Timeline 好验证。

### 3.3 降级预案（Gate 3 不顺时）
keeper 预建 clone（assisted setup，诚实标注）→ 用户一笔普通直铸付款、mint recipient = clone 地址。UX 从"一笔付款全搞定"降为"表单+一笔付款"，产品不塌。

---

## 4. 前端（用户三条硬要求已固化）

1. **连钱包真实闭环**：主路径 **GemWallet**（XRPL 浏览器扩展，可编程弹真实签名，免 API key，支持测试网）；备路 Xaman 扫码/手动（展示精确付款字段+QR）。受益人同样连 XRPL 钱包领取。全部真实测试网操作，**零模拟**。评委动线：连钱包 → 建库（1 笔付款）→ 心跳 → 看 REJECT → 快进沉默 → 领取到账，全程 ≤5 分钟，亮点 ≤20 秒可见（首页即演示"两个不可能"）。
2. **故事完整+核心突出**：功能全景收敛到一条主线（保护→心跳→挑战→释放），首屏只讲"两个不可能"；其余（Recovery Kit、Timeline、储备）都是支撑证据不抢戏。
3. **设计打磨**：UI 动工时加载 `frontend-design` + `impeccable` + `ui-ux-pro-max` 三技能走完整流程；方向：庄重暖色、家书/羊皮纸质感、serif 标题，与全场赛博风区分；简洁第一。

**页面**：Landing（亮点+边界声明）/ 建库向导（4 步+Recovery Kit 下载）/ Owner 仪表盘（倒计时、心跳按钮、储备、Timeline）/ Beneficiary 领取页（状态机可视化+一键 claim）/ 每金库 Evidence Timeline（心跳/检查点/claim/challenge/redemption/到账，全节点链上可点）。

**Recovery Kit（P0）**：可打印 claim packet——vaultId、claim URL、受益人地址指纹、QR、步骤说明、"这不是私钥"警示、法律边界提示、一次领取演练引导。
**Traction 口径（对外）**：`X owner–beneficiary pairs completed setup · Y beneficiaries finished a recovery drill unassisted · median setup 3m42s · 0 unauthorized early claims`。

---

## 5. 威胁模型 v2（THREAT_MODEL.md 英文对外）

| # | 威胁 | v2 处置 |
|---|---|---|
| 1 | Keep-alive 冒名续命 | **协议层解决**：RPN source root 过滤；冒名付款不影响缺席证明（Gate 1 场景 B 链上证据） |
| 2 | 受益人抢跑 | 窗口锚定 + 挑战期 owner 否决（demo 场景） |
| 3 | Keeper censorship/停摆 | 全 crank 无权限；维护储备公开；任何人可接管；owner 恒可 CANCEL |
| 4 | FDC 信任根 | 数据提供者 ≥50% 权重共识，如实声明 |
| 5 | 赎回违约/部分成交 | Releasing 状态机逐请求追踪 + default 路径（keeper 自动化 P1） |
| 6 | FAssets 暂停/Core Vault 治理 | 如实披露依赖与托管性质（Core Vault=治理监督多签） |
| 7 | 0xFE 执行失败 | 原子回滚 + 0xE0 恢复入口（UI 一键） |
| 8 | 沉默≠死亡（住院/出国/丢手机） | 宽限期+挑战期双保险；多通道到期提醒（邮件/TG，P1） |
| 9 | 隐私 | 身份以哈希上链、reference 不含个人信息；**结算公开**如实说明 |

---

## 6. 开发闸门（顺序执行，先脚本后 UI）

| Gate | 内容 | 判定 | 状态 |
|---|---|---|---|
| **G1** | RPN 三态：A owner 付款在窗 (root=owner) → INVALID；B 仅攻击者同 reference 付款 (root=owner) → VALID+链上 verify true；C' 同窗关 source 过滤 → INVALID 对照 | B 是产品成立性命门；**G1 失败才触发方向重估** | 🔄 |
| **G2** | 窗口锚定+两段滚动检查点首尾相接；实测 LUT 回溯上限 | 失败→缩短产品最大心跳周期（降级不弃船） | ⏳ |
| **G3** | 0xFE 一笔付款→mint→PersonalAccount→Factory→clone 入金（自建 executor） | 失败→ §3.3 降级预案 | ⏳ |
| **G4** | ClaimPending 被 owner 心跳否决 | 合约单测+链上 e2e | ⏳ |
| **G5** | 赎回状态机（多 request/partial/default 至少代码级正确） | 合约单测+至少一次真实赎回 | ⏳ |

## 7. 里程碑（修订）

- **W1 余下**（~7/24，CROO 值守并行）：G1→G2→合约骨架（状态机+窗口校验+单测）→G3 spike。**静默，不发帖**。
- **W2**（7/25–31）：合约全功能+keeper；UI 三技能打磨开工；e2e 录屏；**TG 首发帖（门槛：部署+e2e 证据+两个官方级问题）**；7/31 展示日。
- **W3**（8/1–7）：Recovery Kit、Timeline、招 owner–beneficiary 对子做 recovery drill、THREAT_MODEL、（若余力）verify CLI。
- **W4**（8/8–14）：视频（指标三拆口径）、BUIDL、冻结+评委路径 3 连测。

## 8. 商业模式（赛后叙事，比赛版不收费）
Free（testnet+一次演练）/ Standard $49–99/yr/vault / Family $199/yr 多受益人+协助 onboarding；协议侧仅固定 setup 维护储备。比赛材料只展示：checkpoint 成本谁付、储备怎么算、服务停摆用户怎么退出。

## 9. 素材速查（v2 增补）
- RPN 请求体 8 字段：minimalBlockNumber / deadlineBlockNumber / deadlineTimestamp / destinationAddressHash / amount / standardPaymentReference / checkSourceAddresses / sourceAddressesRoot（无 proofOwner，API 若要再补）
- XRPL 标准付款引用 = 恰好 1 个 Memo 且 MemoData=32 字节 hex；Memos 字段 hex 不带 0x
- Beacon（暂用 spike sink）：`r4vEYPxYkEWzoEySUETDRgnUKu8GG9b1GN`（已激活）
- 其余端点/密钥/坑同 v1 §10（verifier/DA/registry/agent.key/冻结 Result workaround/proofOwner 小写）
