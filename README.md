# Heirloom — the continuity vault for XRP

> **If you go silent, your XRP reaches the person you chose — proven by Flare consensus, never by a company.**

Live app: **https://heirloom.axiqo.xyz** · Network: Flare **Coston2** + **XRPL testnet** (demo timing) · Flare Summer Signal 2026, Bounty 1 (Interoperable Asset Products)

Heirloom is a non-custodial inheritance/continuity mechanism for XRP. The owner keeps their keys and simply stays "alive" with a 1-drop XRPL payment each period. If they go verifiably silent — proven by Flare's Data Connector, not by anyone's database — and a final challenge window passes unvetoed, the vault redeems its FAssets and **real XRP lands on the beneficiary's own XRPL wallet**.

XRPL cannot express this natively: escrows release on fixed dates and cannot be reset by a heartbeat. Programmable custody of XRP is exactly what FAssets provides, and *proof of silence* is exactly what FDC's `ReferencedPaymentNonexistence` attestation provides. Heirloom is the product those two primitives were waiting for.

---

## The two impossibilities

Everything in Heirloom reduces to two guarantees, both enforced by Flare's consensus rather than our code:

**1. An attacker cannot keep the owner "alive."**
Heartbeats are XRPL payments carrying the vault's 32-byte reference — but silence is proven with `checkSourceAddresses = true`. A copycat payment with the identical memo, sent by anyone else, is invisible to the proof. We demonstrated this on-chain:

| test | window contains | source filter | verifier verdict |
|---|---|---|---|
| A | the owner's real heartbeat | on | `INVALID: REFERENCED TRANSACTION EXISTS` — a living owner cannot be claimed against |
| B | only attacker copies of the same memo | on | `VALID` → proof finalized in round `1398559`, verified on-chain by `FdcVerification` |
| C′ | only attacker copies | off | `INVALID` — the source filter is precisely what protects the vault |

**2. The beneficiary cannot come early.**
The claim window is anchored to ledger numbers: it must start exactly at `lastHeartbeatLedger + 1` and cover the whole inactivity period as an unbroken chain of attestations. While the owner is alive the proof is unproducible; after real silence, a challenge window still lets one heartbeat cancel everything (`ClaimVetoed`).

## Proven end-to-end on real infrastructure — no mocks

One full lifecycle, every step a public transaction (vault [`0x22d820…8826`](https://coston2-explorer.flare.network/address/0x22d820B6dEf9e9F4204f3e815Eedbb57C7818826)):

| step | evidence |
|---|---|
| Fund with **one XRPL payment** (no EVM wallet) | XRPL tx `0CD404F5…DA123` → `executeDirectMinting` minted **19.96 FXRP** into the vault |
| Heartbeat (1 drop + reference memo) | XRPL tx `0DF8AF91…B168F`, attested in round `1398606`, `recordHeartbeat` on-chain |
| Silence proven after the real inactivity window | `ReferencedPaymentNonexistence`, round `1398610`, chained from heartbeat ledger + 1 |
| Claim → challenge → release | `executeRelease` tx [`0xe41c8489…a557`](https://coston2-explorer.flare.network/tx/0xe41c84898b07519a24f2f4287a3fe8c0bd435df090018f6be90254d9ff70a557) |
| **Beneficiary received real XRP** via FAssets redemption | XRPL tx [`7452922B…754B`](https://testnet.xrpl.org/transactions/7452922B3D276ED4ADF05C71FC0360177D1DB778D3E957A579DF3F5953C7754B) — **9.95 XRP** on their own wallet |

An early release attempt seven seconds before the challenge ended was rejected on-chain with `ChallengeNotOver` — the safety mechanics defending even against their own operator.

## How Flare is load-bearing (remove any piece and the product collapses)

- **FAssets** — the only trust-minimized way for a contract to custody XRP and pay real XRP back out (direct minting in, redemption out).
- **FDC `XRPPayment`** — heartbeats, funding detection and cancel commands are all owner-signed XRPL facts, proven to the contract.
- **FDC `ReferencedPaymentNonexistence`** — the industry's only consensus *proof of absence*: source-filtered silence, chained ledger-by-ledger. This attestation type had, to our knowledge, never been showcased in a product before.
- **The EVM side has no privileged keys.** Every state transition is authorized by an XRPL event or a public timeout; every keeper action is a permissionless crank anyone could submit with the same public data.

```
XRPL (where you act)                         Flare (where it is proven & enforced)
─────────────────────                        ─────────────────────────────────────
one funding payment ──── XRPPayment proof ──▶ executeDirectMinting → FXRP in vault
1-drop heartbeat ──────── XRPPayment proof ──▶ recordHeartbeat (resets the dial, vetoes claims)
silence (no payment) ──── RPN proof chain ───▶ attestSilence → startClaim → challenge
                    ◀──── FAssets redemption ─ executeRelease
beneficiary's wallet ◀─── real XRP
```

## Try it (judges)

1. **60 seconds:** open https://heirloom.axiqo.xyz — "A real plan, replayed" walks the five chapters of an
   actual completed vault (creation → heartbeat → silence → challenge → 9.95 XRP delivered), every chapter
   linking to its real transactions. Open the plan's receipt for the full payout evidence.
2. **5 minutes:** *Create a plan* → connect [GemWallet](https://gemwallet.app) (XRPL testnet) or paste any funded testnet address → the keeper deploys **your own vault** on Coston2 → fund it with the one displayed XRPL payment → watch FXRP arrive and the dial go live. Send a heartbeat; open the beneficiary view and try to claim early — watch the chain refuse.
3. **Deep:** contracts in [`contracts/`](contracts/) (12 unit tests incl. adversarial cases), proof mechanics in [`spike/`](spike/) (gate scripts with saved on-chain artifacts), keeper in [`keeper/`](keeper/), threat model in [`THREAT_MODEL.md`](THREAT_MODEL.md).

Demo timing note: heartbeat periods are minutes on testnet so the full story is visible in one sitting; production timing would be 90–180 days with 7-day rolling checkpoints (the ~14-day attestation window limit was measured, and the chaining is implemented and tested on-chain).

## Repository

| path | contents |
|---|---|
| `contracts/` | `HeirloomVault.sol` (7-state machine, dual-proof validation, challenge veto, XRPL-signed cancel), `HeirloomFactory.sol` (EIP-1167 clones), tests, deploy scripts |
| `keeper/` | permissionless crank service: proof automation, beacon auto-scan, REST API for the app |
| `web/` | the app — GemWallet integration, Pulse Dial, evidence timeline, printable Recovery Kit |
| `spike/` | gate scripts that de-risked every primitive on-chain before the product was built, with saved proofs |
| `docs/` | design document |

Deployed on Coston2: factory [`0x090a69eE156108A6aE0a6a1a96575443ef4b584a`](https://coston2-explorer.flare.network/address/0x090a69eE156108A6aE0a6a1a96575443ef4b584a) · implementation `0x6D70A70a682ea5a9F37088b85Cf6941b03c4B361` · FXRP `0x0b6A…3dc7` · AssetManagerFXRP `0xc1Ca…bDFA`.

## Honest boundaries

Heirloom never holds your keys, cannot change your recipient, and cannot release funds before the configured inactivity **and** challenge periods have both elapsed. Settlement relies on Flare FAssets, FDC consensus, and the XRP Ledger; the final payout is a public XRPL transaction. Heirloom is a technical continuity mechanism — **not** a substitute for a legally valid will. Full analysis: [THREAT_MODEL.md](THREAT_MODEL.md).

*Built from scratch during Flare Summer Signal (July 2026).*
