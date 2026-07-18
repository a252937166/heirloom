# Heirloom — Threat Model & Honest Boundaries

Heirloom moves inheritance-grade value on consensus proofs. This document states plainly what protects you,
what we trust, and what can still go wrong. Every mitigation listed as "on-chain" is enforced by the vault
contract, not by our servers.

## Authorization model

The EVM side has **no privileged keys**. Every state change is authorized by one of:

1. an owner-signed XRPL payment, proven by an FDC `XRPPayment` attestation (heartbeat, cancel, funding);
2. a consensus proof of absence (`ReferencedPaymentNonexistence`) that anyone may submit;
3. a public timeout (challenge period) that anyone may crank.

The keeper is a convenience, not an authority: it can only submit proofs and cranks that any third party
could produce from public data. If our keeper disappears, nothing is lost — any party can run the same
open-source service against the same contracts.

## Threats and mitigations

| # | Threat | Status |
|---|---|---|
| 1 | **Fake liveness** — an attacker copies the owner's heartbeat memo to keep the vault alive and block inheritance | **Solved at the protocol level.** Silence proofs use `checkSourceAddresses` with the owner's address root; copycat payments are invisible to the attestation. Demonstrated on-chain (gate 1, round 1398559): attacker sent identical memos and the network still attested the silence. |
| 2 | **Premature claim** — the beneficiary (or anyone) tries to release funds while the owner is alive | **Structurally impossible.** The claim requires an unbroken attestation chain starting at `lastHeartbeatLedger + 1` and covering the full period; while the owner heartbeats, the verifier answers `INVALID: REFERENCED TRANSACTION EXISTS`. After silence, the challenge window still lets one heartbeat veto the claim (`ClaimVetoed`, tested). An early `executeRelease` reverts with `ChallengeNotOver` (observed on-chain). |
| 3 | **Window cheating** — a claimer picks a window that skips a heartbeat | Contract enforces exact chaining: first segment must start at `lastHeartbeatLedger + 1`, each next at the previous `firstOverflowBlockNumber`, and the final segment must cover `lastHeartbeatTs + period + grace`. A heartbeat bumps the epoch and voids all previous checkpoints. |
| 4 | **Silence ≠ death** — hospital stays, lost phones, travel | Grace period + challenge window are first-class config. The owner's veto is a single 1-drop payment from anywhere in the world. Roadmap: multi-channel expiry reminders. |
| 5 | **Keeper censorship or death** | All cranks are permissionless; the beneficiary's Recovery Kit contains everything needed to claim without us. Keeper is open source. |
| 6 | **Wrong beneficiary address** | The address is committed as a hash at creation and revealed at claim; the UI shows a fingerprint at both ends and the Recovery Kit repeats it. Nothing can change it after creation except the owner cancelling and re-creating — by design. |
| 7 | **FAssets redemption risk** — agent fails to pay the underlying XRP | FAssets' own default path compensates from agent collateral; the vault's `Releasing` state is re-crankable until the balance is settled. The vault redeems its **full balance** via `redeemAmount` (arbitrary amounts, no lot rounding); only a residual below the protocol's 5-FXRP redemption minimum can ever remain, in which case the vault closes honestly with a `ResidualBelowMinimum` event and the receipt shows the exact remainder. |
| 8 | **Direct-minting edge cases** — payment below minimum fee is forfeited by the protocol; wrong memo strands the mint | The app computes the gross amount with a safety margin and renders the exact memo; the keeper watches for `DirectMintingExecuted`. Recovery guidance for stuck mints is part of the funding screen. |
| 9 | **FCC / privacy expectations** | Heirloom does **not** claim private settlement: the final payout is a public XRPL transaction. On-chain, owner/beneficiary/beacon appear only as hashes until claim time — correlation from XRPL activity is possible and documented. |

## Trust assumptions (stated, not hidden)

- **Flare's FDC** — attestations are true if ≥ 50 % of data-provider signature weight is honest. This is the
  same trust root as FTSO and the rest of the Flare protocol stack.
- **FAssets** — custody of the underlying XRP sits with the FAssets system (agents + Core Vault with
  governance oversight), not with Heirloom. We inherit its collateral and emergency-pause mechanics.
- **XRPL finality** — 3-ledger confirmation depth (~12 s) before facts become attestable.
- **Attestation history window** — measured at ~14 days on Coston2's verifiers; production vaults therefore
  use 7-day rolling checkpoints (implemented and chain-tested) rather than single long windows.

## EVM-owner mode (v3) — what changes, honestly

For owners without an XRPL wallet, a vault can be configured with `ownerEvm` (MetaMask/OKX) instead of an
XRPL owner hash. The state machine, challenge veto, and FAssets redemption to the beneficiary's XRPL wallet
are identical. What differs:

- **Silence oracle.** XRPL mode proves absence with source-filtered FDC `ReferencedPaymentNonexistence`
  attestations. EVM mode uses Flare consensus time against `lastHeartbeatTs` — check-ins are owner-signed
  `heartbeatEvm()` transactions, so "silence" is simply the absence of an on-chain transaction only the
  owner's key can produce. Weaker narrative (no proof-of-absence attestation), equally enforceable on-chain.
- **Attack surface.** There is no beacon/memo surface to copy, so the copycat-heartbeat attack does not
  exist in this mode; the equivalent risk is EVM key compromise, which — exactly like XRPL key compromise —
  lets the holder keep the vault alive or `cancelEvm()` it. Heirloom never changes who the beneficiary is.
- **Cancel semantics.** `cancelEvm()` transfers the FXRP back to the owner account (the owner can redeem to
  XRP via FAssets at will) rather than forcing an immediate redemption.
- **Mode exclusivity.** A vault is one mode or the other, checked at initialization; XRPL proof paths revert
  in EVM mode and vice versa, so the two silence clocks can never be mixed on one vault.

## Known limitations (v1)

- Demo timing (minutes, clearly labelled) on Coston2; production timing is a config change.
- One beneficiary per vault; value-split across several heirs is roadmap.
- A residual below the 5-FXRP protocol redemption minimum stays visible in the vault (full-balance
  `redeemAmount` makes this ~zero in practice; the payout receipt always states the exact remainder).
- The keeper currently also acts as the direct-minting executor; any party can replace it.
- Legal standing: transferring key control is not the same as transferring legal title. Pair Heirloom
  with a will that names the same beneficiary.
