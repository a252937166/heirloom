# Built during Flare Summer Signal (July 2026)

Everything in this repository was built from the first commit during the hackathon window.
Chronology (see `git log` for the full record):

1. **Gates before product** — on-chain de-risking of every primitive with saved artifacts:
   source-filtered `ReferencedPaymentNonexistence` three-verdict experiment (round 1398559,
   `spike/gate1b-rpn.mjs`), rolling-checkpoint chaining + ~14-day attestation-depth measurement
   (`spike/gate2-rolling.mjs`).
2. **Contracts** — `HeirloomVault` v1 → v2 (full-balance `redeemAmount`, honest residual states)
   → v3 (alternative EVM-owner mode) → v4 (veto-race proof grace: the XRPL timestamp decides a veto, never
   transaction ordering; re-crankable cancel settlement). 19 unit tests incl. adversarial, race and
   partial-redemption suites. v4 deployed + source-verified on Coston2 (factory
   `0x8FFD0a1DeAb498A5F0A2798bBefb2C071091a77f`).
3. **Keeper** — permissionless crank service: FDC proof automation, beacon/funding auto-scans with
   self-healing retries, chain-truth early-claim simulation (`simulate-early-claim`), structured receipts.
4. **Web app** — story-first UI: Live Case Dashboard (`/case/001`) with a chain-generated, reconciled
   manifest (`spike/build-case.mjs`), guided 90-second tour, EIP-6963 wallet connections, Recovery Kit.
5. **Three full real-infrastructure lifecycles** (no mocks), one per contract era; the canonical v4 run
   ends fully reconciled: funding → heartbeat → staticCall early-claim drill (blocked, SilenceNotProven) →
   silence proof → challenge + 180s veto-proof grace → FULL-balance FAssets redemption → 10.03 XRP on the
   beneficiary's wallet → final balance 0.

Frozen submission state: tag `submission-v1` (v4 contracts + the fully-reconciled v4 canonical case); regenerate the case manifest with
`node spike/build-case.mjs`.
