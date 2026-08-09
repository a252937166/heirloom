# Test Person 02 — deployed receipt-boundary verification

Status: **completed 7/7, then cancelled and fully settled**

Run: `rh-mslpxllp-5qgx0p`

Public build under test: `7e010a3`

Execution window: 2026-08-09 07:27:43–07:39:43 EDT

Cleanup completed: 2026-08-09 07:43:57 EDT

This release-verification run used a real browser, two independent XRPL
Testnet accounts, real XRPL payments, the deployed Coston2 contracts, and the
production keeper. It is a human-style Test Person simulation, not an external
human-subject pair, and is not added to a claimed human-user or human-pair count.

## Scenario

| Field | Value |
| --- | --- |
| Route | fresh XRPL-native plan, manual wallet instructions |
| Owner | `rGRRECsJ1NTPM7yehmCq9uyhzYvHpNtXqx` |
| Beneficiary | `rKZo43bi3Vt5ba9gKzUbzMGx4tXV9NUXpq` |
| Vault | [`0x5bbc816136a7ee4e3eb7147e28064bb367a53075`](https://coston2-explorer.flare.network/address/0x5bbc816136a7ee4e3eb7147e28064bb367a53075) |
| Protected amount | 10 XRP / 10 FXRP minted |
| Rules | 10-minute heartbeat + 1-minute grace; 2-minute veto; 180-second proof buffer |
| Result | 1 attempted, 1 completed; 12m 00s total |
| Debrief | 3/3 correct |

## Timed user path

| Step | EDT time | Elapsed | Evidence |
| --- | ---: | ---: | --- |
| Start rehearsal | 07:27:43 | 0s | Run created in the production browser session |
| Manual wallet ready | 07:27:57 | 14s | Explicit manual XRPL path |
| Fresh plan bound and funded | 07:33:31 | 5m 48s | Vault `Active`; one 10.20-XRP funding payment |
| Heartbeat verified | 07:38:15 | 10m 32s | On-chain epoch became 1 after FDC round 1420503 |
| Recovery Kit handed over | 07:38:33 | 10m 50s | Recovery JSON captured and Kit inspected |
| Strict early-claim drill verified | 07:39:11 | 11m 28s | Tagged `SilenceNotProven`; pinned block 33819040; funds moved 0 |
| Debrief recorded | 07:39:43 | 12m 00s | Answers B/B/B, 3/3 correct |

## Public chain and keeper evidence

| Event | Evidence |
| --- | --- |
| Vault created | [Coston2 transaction `0xeede…ede81`](https://coston2-explorer.flare.network/tx/0xeede4db70ea2d9171cbb6386b7de3274a0c39475108b3c9f1811c148ed1ede81) |
| Funding paid | [XRPL transaction `26DD…28D8`](https://testnet.xrpl.org/transactions/26DD1EB6A84F40048741AADEA41D1AA83074B95A72671D72C092B562D8DD28D8), `tesSUCCESS`, 10.20 test XRP |
| FXRP minted | [Coston2 transaction `0x94e6…fe60`](https://coston2-explorer.flare.network/tx/0x94e690a984ee957b7c901da83bf3581800b704112e8c58aa42da3eda41e8fe60), FDC round 1420500 |
| Vault activated | [Coston2 transaction `0x27d9…e71d`](https://coston2-explorer.flare.network/tx/0x27d9e7e0153667b0f7184c8adbb75cdf08a5b579de22887e14d8553005cce71d) |
| Owner heartbeat | [XRPL transaction `EE6B…147F`](https://testnet.xrpl.org/transactions/EE6B569037A255BDF4CEA7AB567102EFE09C700FD3601F9DCF53ED8F21D2147F), 1 drop |
| Heartbeat proven | [Coston2 transaction `0x713f…9305`](https://coston2-explorer.flare.network/tx/0x713f69c9421976e9662d18a91172daa6415233c6c082265753988b909b479305), epoch 1, FDC round 1420503 |
| Owner cancel | [XRPL transaction `6B8D…9219`](https://testnet.xrpl.org/transactions/6B8D018EF9A6B54B4318F9D586399200F71C1C1753425FBE5AED879FFC019219), 1 drop |
| Cancel executed | [Coston2 transaction `0x0076…a2e5`](https://coston2-explorer.flare.network/tx/0x00761100c23f2f7542c5e811790ac5fe3b0370a554fcdfa824eae2be6e5ba2e5) |
| XRP returned | [XRPL transaction `77F2…DC22`](https://testnet.xrpl.org/transactions/77F2AF6875486C4DFA69E996BDF9F17B3AF7B31A41534466F47AE33EE30BDC22), 9.95 test XRP |

## Strict receipt-boundary proof

The deployed keeper evaluated the drill against one pinned Coston2 block and
the deployed Web accepted only the event tagged to this run:

| Field | Recorded value |
| --- | --- |
| `vaultState` | `2` (`Active`) |
| `reason` | `SilenceNotProven` |
| `evaluatedBlock` | `33819040` |
| `evaluatedAt` | `1786275546` |
| `silenceDeadline` | `1786275912` |
| Headroom | 366 seconds inside the owner window |
| `insideOwnerWindow` | `true` |
| `rh` | `rh-mslpxllp-5qgx0p` |
| Funds moved | `0` |

This is the post-deployment evidence that Test Person 01 could not provide:
the journal, UI verdict, and downloaded receipt all use the strengthened
block-time, owner-window, immutable-vault, and run-tag semantics.

## Cleanup and residue

- Final contract state: `Cancelled` (`6`).
- Final vault balance: `0 FXRP`.
- Redemption request `#44366610` settled to the owner wallet.
- Keeper job: none; `awaitingSettlement`: empty.
- Owner balance: 38.012652 XRP before → 37.762614 XRP after.
- Net test cost: 0.250038 XRP, matching mint/redemption economics plus three
  XRPL payment fees; no unexplained residue was observed.

## Test observations

1. The production keeper and Web now agree on a single Coston2 block-time
   verdict. The live drill event includes every structured field required by
   the new receipt logic.
2. The full manual XRPL path remained operable after deployment: create,
   funding, heartbeat, Recovery Kit, beneficiary drill, debrief, cancel, and
   settlement all completed without a wallet extension.
3. The background create tab again lagged behind the public keeper state after
   activation. Binding the now-Active vault in the rehearsal recovered the
   flow. This remains a foreground/manual UX regression candidate, not a chain
   or keeper failure.
4. The first bind attempt used a non-checksummed mixed-case transcription and
   was rejected; the lowercase canonical address bound successfully. Copying
   the full address from the plan URL remains the safest user instruction.

## Attached evidence

- [Participant-held rehearsal receipt](./receipt.json)
- [Recovery manifest](./recovery.json)
- [Final keeper journal and settlement receipt](./keeper-final.json)
- [Recovery Kit screen](./recovery-kit.png)
- [Strict early-claim refusal screen](./early-claim-blocked.png)
- [7/7 rehearsal completion screen](./rehearsal-complete.png)
- [Cancelled / 0-FXRP cleanup screen](./cleanup-final.png)
- [SHA-256 manifest](./SHA256SUMS)
- Re-run `node docs/validation/test-person-02/verify.mjs` to validate the
  receipt, Recovery Kit checksum, strict block-time drill, terminal settlement,
  and residue assertions from the attached JSON files.
