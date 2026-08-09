# Test Person 01 — real-data rehearsal

Status: **completed 7/7, then cancelled and fully settled**

Run: `rh-mslmyc74-3c9xr8`

Public build under test: `submission-v10` / `4e1a8c0`

Execution window: 2026-08-09 06:04:18–06:18:28 EDT

Cleanup completed: 2026-08-09 06:22:38 EDT

This run used a real browser, two independent XRPL Testnet accounts, real XRPL
payments, the deployed Coston2 contracts, the production keeper, and a
participant-held receipt. It is a human-style test-person simulation, not an
external human-subject pair, and must not be added to a claimed human-user or
human-pair count.

## Scenario

| Field | Value |
| --- | --- |
| Route | fresh XRPL-native plan, manual wallet instructions |
| Owner | `rGRRECsJ1NTPM7yehmCq9uyhzYvHpNtXqx` |
| Beneficiary | `rKZo43bi3Vt5ba9gKzUbzMGx4tXV9NUXpq` |
| Vault | [`0x0FBeF3524E824770E98F2D1A497CB559b007E797`](https://coston2-explorer.flare.network/address/0x0FBeF3524E824770E98F2D1A497CB559b007E797) |
| Protected amount | 10 XRP / 10 FXRP minted |
| Rules | 10-minute heartbeat + 1-minute grace; 2-minute veto; 180-second proof buffer |
| Result | 1 attempted, 1 completed; 14m 10s total |
| Debrief | 3/3 correct |

## Timed user path

| Step | EDT time | Elapsed | Evidence |
| --- | ---: | ---: | --- |
| Start rehearsal | 06:04:18 | 0s | Run id created in production local session |
| Manual wallet ready | 06:04:35 | 17s | Explicit manual XRPL path |
| Create + fund verified | 06:09:48 | 5m 30s | Vault `Active`; one 10.20-XRP funding payment |
| Heartbeat verified | 06:13:13 | 8m 55s | On-chain epoch became 1 after FDC round 1420447 |
| Recovery Kit handed over | 06:16:15 | 11m 57s | Recovery JSON downloaded and Kit inspected |
| Early-claim drill verified | 06:17:20 | 13m 02s | Tagged `SilenceNotProven` static call; funds moved 0 |
| Debrief recorded | 06:18:28 | 14m 10s | Answers B/B/B, 3/3 correct |

## Public chain and keeper evidence

| Event | Evidence |
| --- | --- |
| Vault created | [Coston2 transaction `0x3a9f…23e7`](https://coston2-explorer.flare.network/tx/0x3a9f802ce38b369bd6df81b999ff422cfcbde76a4a4545f00de2bd3caf0e23e7) |
| Funding paid | [XRPL transaction `6ACC…F380`](https://testnet.xrpl.org/transactions/6ACC1EA2069313E380998F6B7719C4D253DFB61A668216D1EBA7E6977CD9F380), `tesSUCCESS`, 10.20 test XRP |
| Vault activated | [Coston2 transaction `0xd6ee…e046`](https://coston2-explorer.flare.network/tx/0xd6eeaa3cda37ed46e74ac3dfbd5d7db2ee2122dc93ab0a1ab69f77647470e046) |
| Owner heartbeat | [XRPL transaction `F8DC…D1FD`](https://testnet.xrpl.org/transactions/F8DC756CED5BE7880F215AE7FE672EA4CC74FC81B47E1D7B3ADF6F911C2CD1FD), 1 drop |
| Heartbeat proven | [Coston2 transaction `0xb587…a67d`](https://coston2-explorer.flare.network/tx/0xb587e386acf8480c7e24f8c1e14d22a7fc8cbb3c17d13d2b2fef8f5f85aa67de), epoch 1, FDC round 1420447 |
| Early claim | Production UI showed 4m 26s remaining; contract returned `SilenceNotProven`; no transaction broadcast; funds moved 0; event carried `rh-mslmyc74-3c9xr8` |
| Owner cancel | [XRPL transaction `BD6A…7C3A`](https://testnet.xrpl.org/transactions/BD6A172A620B2FC022795F4CF29D42F3DA2200346D1B3BBFD7DFD5B8B39A7C3A), 1 drop |
| Cancel executed | [Coston2 transaction `0x2d3e…d596`](https://coston2-explorer.flare.network/tx/0x2d3e185d18be66e6ba3548176f20a1598efe3f737f086e92c9f91d30c239d596) |
| XRP returned | [XRPL transaction `E02F…D8E5`](https://testnet.xrpl.org/transactions/E02F3ABEC16B2638697D8FE5969C09BCD4CB6AA2B826C5879C6187E93180D8E5), 9.95 test XRP |

## Cleanup and residue

- Final contract state: `Cancelled`.
- Final vault balance: `0 FXRP`.
- Redemption request `#44323028` settled to the owner wallet.
- Keeper job: none; `awaitingSettlement`: empty.
- Owner balance: 38.262690 XRP before → 38.012652 XRP after.
- Net test cost: 0.250038 XRP, exactly the mint/redemption economics plus
  the three XRPL payment fees; no unexplained residue was observed.

## Test observations

1. The full manual XRPL path is operable without installing GemWallet. The user
   can create, fund, heartbeat, hand over the Kit, and run the beneficiary drill
   from copyable payment instructions.
2. The create page remained visually behind while its background tab was
   throttled, even after the public API showed `minted,active`. Returning to the
   rehearsal and binding the vault recovered the flow. A foreground/manual
   regression should decide whether to add an explicit `Check now` action to the
   create progress screen.
3. Chrome's native save dialog was part of both Recovery Kit and receipt
   downloads. Both files were saved successfully; the app did not upload them.
4. The production `4e1a8c0` journal event proves this particular drill happened
   while the UI showed 4m 26s remaining, but it predates the reviewed structured
   `insideOwnerWindow` fix. This receipt is valid evidence for this observed run;
   it is not proof that the new receipt semantics are deployed.
5. The working-tree fix now requires one pinned Coston2 block, an inside-window
   timestamp, a matching `rh`, and one immutable vault binding. It still needs a
   release/deployment verification before a future receipt can claim those
   stronger semantics.

## Attached evidence

- [Participant-held rehearsal receipt](./receipt.json)
- [Recovery manifest](./recovery.json)
- [Final keeper journal and settlement receipt](./keeper-final.json)
- [Recovery Kit screen](./recovery-kit.png)
- [Early-claim refusal screen](./early-claim-blocked.png)
- [7/7 rehearsal completion screen](./rehearsal-complete.png)
- [Cancelled / 0-FXRP cleanup screen](./cleanup-final.png)
- [SHA-256 manifest](./SHA256SUMS)
- Re-run `node docs/validation/test-person-01/verify.mjs` to validate the
  receipt, Recovery Kit checksum, run tag, terminal settlement, and residue
  assertions from the attached JSON files.
