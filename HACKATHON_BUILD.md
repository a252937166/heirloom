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
   today" as a product surface: a two-person, seven-step guided run. Four checks flip only on chain or
   keeper evidence (vault answers, Active state, heartbeat epoch growth, the live-chain `staticCall`
   refusal recorded in the keeper's public journal), the wallet step is evidenced by the local session,
   and the two interpersonal steps say "self-attested". The drill verdict is structural — one pinned Coston2
   block, Active plan, `SilenceNotProven`, still inside the owner's deadline, and this run's tag — so an
   untagged, late, or settled-plan refusal can never complete it; fresh plans and pre-existing plans are
   classified apart on the participant-held receipt. The verdict logic is pure-function unit-tested in CI.
8. **Public real-data validation** — Test Person 01 completed the 7/7 manual-XRPL rehearsal in 14m 10s with
   a 3/3 debrief, then cancelled and fully settled: `Cancelled`, 0 FXRP, 9.95 test XRP returned. The public
   `/validation` page and `docs/validation/test-person-01/` expose the vault, transaction links, receipt,
   keeper journal, checksums, and cleanup evidence. This is explicitly an engineering-operated Test Person
   simulation, not an external human-subject pair and not a claimed user count.

Last public frozen/deployed base: tag `submission-v10` at `4e1a8c004480c0cc1c72f80f9ede7685d006aadf`. The receipt-boundary and validation-visibility work in the current tree is post-v10 and must not be described as frozen or deployed until its release is committed, tagged, and verified. For that next release, the tag's commit is the single source of truth and must be shown verbatim in the site footer and `/api/health` (`build` field). Regenerate the case manifest with
`node spike/build-case.mjs` (defaults to the canonical v4 vault `0x35975770e1eD5431e0bFCaBB238B6188c94AeAdA`), then validate with `node spike/validate-case.mjs`.
