# INVARIANTS — the living record

The specification is `specs/HOOK-SPEC.md` section 3, with invariant I7 added by its addendum
"the non-negotiable three" (#3). This file tracks each invariant's state in the tree: the
enforcement point, the negative test that must fail before the positive is believed, and the
rung it has reached today. The specification is never edited; this file is.

Rungs, in order and never skipped: **PLANNED** (in the spec only) · **WRITTEN** (code exists)
· **TESTED** (a named test ran, its count was read, and its negative control was seen red)
· **LIVE-FIRED** (a real transaction on a public testnet, status 1, recorded in the README).

| # | Invariant (spec wording, abbreviated) | Enforcement point | Negative test | Rung today |
|---|---|---|---|---|
| **I1** | Recipient guarantee: output reaches only the registered payout address | `beforeSwap` reverts unless the sender is the authorised router; the router is the sole caller of `take()` | swap from an unauthorised router → revert | PLANNED |
| **I2** | Fee transparency: net, fee, recipient id, order id in one receipt event, plus the standard `HookFee` event (addendum A4) | `afterSwap` | a receipt missing a component fails the decode test | PLANNED |
| **I3** | Slippage floor: realised output ≥ the order's minimum; exact-output partial fills revert (addendum A13) | `afterSwap` against stored order | quote, move the pool, expect revert | PLANNED |
| **I4** | Deadline: no settlement past the order's deadline | `beforeSwap` | warp past the deadline → revert | PLANNED |
| **I5** | Replay protection: one order id settles at most once | `beforeSwap` marks consumed before any external effect | replay the same id → revert | PLANNED |
| **I6** | **Never strand**: a rejected swap reverts the swap; the payment stays settleable by the existing path. Outranks I1–I5 | revert-only; the hook never moves funds | force each revert above; assert payment state untouched | PLANNED |
| **I7** | Native settlement integrity: `sync()` immediately before a native `settle{value:}()`, refund by `call`, the router never spends its own balance | the router | omit the sync and expect `NonzeroNativeValue`; router balance zero before and after | PLANNED |

## The day-1 guard that every invariant depends on

**T5, the flag guard** (`specs/THREAT-MODEL.md` T5; `specs/HOOK-SPEC.md` section 5). A hook
whose address bits disagree with its declared permissions fails silently: the callback is
never called, nothing reverts, and every invariant above would hold vacuously.

| Test (`test/UnicaHook.t.sol`) | What it proves | Rung |
|---|---|---|
| `test_MinedAddress_MatchesDeclaredPermissions` | the mask in the address equals the mask read off the real runtime code | TESTED |
| `test_NoUndeclaredPermissionsCreepIn` | exactly the day-1 set is declared (afterSwap only) | TESTED |
| `test_RevertWhen_AddressBitsSayBeforeSwapOnly` | the same bytecode at a beforeSwap-only address is refused by v4 with `HookAddressNotValid` | TESTED |
| `test_MinedSalt_DeploysAtTheDeclaredMask` | a salt mined for the declared mask deploys | TESTED |
| `test_SwapExecutesThroughTheHook` | a real swap through v4-core's PoolManager reaches the callback (counter 0 → 1) | TESTED |
| `test_SwapOnAHooklessPoolIsNotObserved` | the counter measures this hook's path, not the manager's activity | TESTED |
| `testFuzz_EverySwapIsObservedOnce` | holds for every input size in range | TESTED |

The guard's own negative control, run on 2026-09-04 and recorded in the commit that added it:
flipping `beforeSwap` to `true` in `getHookPermissions()` makes `setUp` fail with
`declared permissions drifted from the day-1 set (afterSwap only): 192 != 64`. Restoring it
returns the suite to 7 passed, 0 failed.

Re-run everything: `forge test -vv`. Fuzz runs are set in `foundry.toml` and printed beside
each fuzz test in the output.
