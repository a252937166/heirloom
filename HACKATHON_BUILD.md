# Built during Flare Summer Signal (July 2026)

Everything in this repository was built from the first commit during the hackathon window.
Chronology (see `git log` for the full record):

1. **Gates before product** — on-chain de-risking of every primitive with saved artifacts:
   source-filtered `ReferencedPaymentNonexistence` three-verdict experiment (round 1398559,
   `spike/gate1b-rpn.mjs`), rolling-checkpoint chaining + ~14-day attestation-depth measurement
   (`spike/gate2-rolling.mjs`).
2. **Contracts** — `HeirloomVault` v1 → v2 (full-balance `redeemAmount`, honest residual states)
   → v3 (alternative EVM-owner mode). 15 unit tests incl. adversarial suites. v3 deployed + source-verified
   on Coston2 (factory `0xa1b97724E7447278ed749f57CEa1915Ad2C3AFA2`).
3. **Keeper** — permissionless crank service: FDC proof automation, beacon/funding auto-scans with
   self-healing retries, chain-truth early-claim simulation (`simulate-early-claim`), structured receipts.
4. **Web app** — story-first UI: Live Case Dashboard (`/case/001`) with a chain-generated, reconciled
   manifest (`spike/build-case.mjs`), guided 90-second tour, EIP-6963 wallet connections, Recovery Kit.
5. **Two full real-infrastructure lifecycles** (no mocks): funding → heartbeat → silence proof →
   claim → challenge → FAssets redemption → XRP on the beneficiary's wallet.

Frozen submission state: tag `submission` (see releases); regenerate the case manifest with
`node spike/build-case.mjs`.
