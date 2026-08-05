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
   silence proof → challenge + 180s veto-proof grace → FULL-balance FAssets redemption → 10.025312 XRP on the
   beneficiary's wallet → final balance 0.
6. **Post-freeze hardening (soak-test findings, no product-surface changes)** — a two-week unattended run
   exposed real operational gaps and each got a root-cause fix: rolling checkpoints now stop once silence
   coverage reaches the claim deadline (two abandoned vaults had drained the crank wallet); `/api/health`
   reports write-readiness (keeper address, gas balance, RPC freshness, last successful write) instead of
   bare liveness; quotes and vault creation refuse to issue payment instructions from static fallback
   settings; multi-request redemptions only show "delivered" when EVERY payment reference has settled;
   event-text clocks are UTC; the spike lockfile resolves from the registry so a clean clone reproduces
   (enforced in CI). A fresh full lifecycle was re-run end-to-end on the live stack after the fixes.
7. **The rehearsal run sheet (`/rehearsal`)** — the Recovery Kit's "rehearse the claim once, together,
   today" as a product surface: a two-person, seven-step guided run where five checks flip only on chain
   or keeper evidence (vault answers, Active state, heartbeat epoch, the recorded on-chain drill refusal)
   and the two that cannot be verified say "self-attested". Ends in a downloadable JSON receipt — the
   evidence behind "N owner–beneficiary pairs rehearsed unassisted".

Frozen submission state: tag `submission-v6` — the tag's commit is the single source of truth and is shown verbatim in the site footer and `/api/health` (`build` field). Regenerate the case manifest with
`node spike/build-case.mjs` (defaults to the canonical v4 vault `0x35975770e1eD5431e0bFCaBB238B6188c94AeAdA`), then validate with `node spike/validate-case.mjs`.
