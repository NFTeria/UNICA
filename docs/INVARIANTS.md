# INVARIANTS — the living record

The specification is `specs/HOOK-SPEC.md` section 3, with invariant I7 added by its addendum
"the non-negotiable three" (#3). This file tracks each invariant's state in the tree: the
enforcement point, the negative test that must fail before the positive is believed, and the
rung it has reached today. The specification is never edited; this file is.

Rungs, in order and never skipped: **PLANNED** (in the spec only) · **WRITTEN** (code exists)
· **TESTED** (a named test ran, its count was read, and its negative control was seen red)
· **LIVE-FIRED** (a real transaction on a public testnet, status 1, recorded in the README).

Day 2 (2026-09-04, evening): the router and the gate exist; I1, I6, I7 are TESTED; I3, I4, I5
are TESTED at the router and PLANNED at the hook, where the spec also wants them once the hook
reads the order it is asked to admit (day 3, with I2). Nothing on this page is LIVE-FIRED yet:
the day-1 live-fire was the scaffold hook, which has none of this.

| # | Invariant (spec wording, abbreviated) | Enforcement point | Negative test | Rung today |
|---|---|---|---|---|
| **I1** | Recipient guarantee: output reaches only the registered payout address | `UnicaHook._beforeSwap` reverts `NotSettler` unless the sender is the router at its derived address; the router `take`s to `order.recipient` from storage it wrote | swap from the official test router → wrapped `NotSettler`; the positive path asserts the recipient's balance delta equals the settled output and nobody else received | **TESTED** (`test_RevertWhen_SwapSenderIsNotTheRouter`, `test_SettlementDeliversToTheRegisteredRecipient`, fuzz 10,000) |
| **I2** | Fee transparency: net, fee, recipient id, order id in one receipt event, plus the standard `HookFee` event (addendum A4) | `afterSwap` | a receipt missing a component fails the decode test | PLANNED (day 3). Today the hook emits `AfterSwapObserved` and the router emits `Settled(orderId, payer, recipient, amountIn, amountOut)` |
| **I3** | Slippage floor: realised output ≥ the order's minimum; exact-input partial fills revert (addendum A13) | today: the router, after the swap, before any settle or take; from day 3 also the hook in `afterSwap` against the order it reads from the router | output below minimum → `OutputBelowMinimum`, nothing moves; pool cannot fill → `PartialFill`, nothing moves | **TESTED at the router** (`test_RevertWhen_OutputBelowMinimum_NothingMoves`, `test_RevertWhen_PoolCannotFillTheOrder_NothingMoves`); hook-side PLANNED |
| **I4** | Deadline: no settlement past the order's deadline | today: the router in `pay`; from day 3 also the hook in `beforeSwap` | warp past the deadline → `OrderExpired` | **TESTED at the router** (`test_RevertWhen_OrderExpired`); hook-side PLANNED |
| **I5** | Replay protection: one order id settles at most once | the router marks `settled` before the unlock, so a reentrant second payment meets it; from day 3 also the hook | pay twice → `OrderAlreadySettled` | **TESTED at the router** (`test_RevertWhen_OrderPaidTwice`); hook-side PLANNED |
| **I6** | **Never strand**: a rejected swap reverts the whole payment; the payer keeps the ETH and the order stays payable. Outranks I1–I5 | revert-only, everywhere; the hook never moves funds | every refusal test asserts the payer's balance unchanged, the recipient's unchanged, and `settled == false` | **TESTED** across every refusal in `test/UnicaSettlementRouter.t.sol` and row 3 of `test/I7NativeSettle.t.sol` |
| **I7** | Native settlement integrity: `sync(ADDRESS_ZERO)` immediately before `settle{value:}`, nothing between; the router never holds a balance and has no `receive` | `UnicaSettlementRouter._settleNativeInput` | four rows: defence on/off × a foreign currency synced earlier in the same unlock; the defect row reverts `NonzeroNativeValue` | **TESTED** (`test/I7NativeSettle.t.sol`, four rows plus the balance check) |

## The guard that every invariant depends on

**T5, the flag guard** (`specs/THREAT-MODEL.md` T5; `specs/HOOK-SPEC.md` section 5). A hook
whose address bits disagree with its declared permissions fails silently: the callback is
never called, nothing reverts, and every invariant above would hold vacuously.

| Test (`test/UnicaHook.t.sol`) | What it proves | Rung |
|---|---|---|
| `test_MinedAddress_MatchesDeclaredPermissions` | the mask in the address equals the mask read off the real runtime code | TESTED |
| `test_NoUndeclaredPermissionsCreepIn` | exactly the declared set: both swap callbacks, no returns-delta flag | TESTED |
| `test_RevertWhen_AddressBitsSayBeforeSwapOnly` | the same bytecode at a beforeSwap-only address is refused by v4 with `HookAddressNotValid` | TESTED |
| `test_RevertWhen_AddressBitsSayAfterSwapOnly` | the day-1 address shape (0x40) is refused by this code | TESTED |
| `test_SettlerDerivationMatchesTheRouterAddress` | the router address the hook derives is where the router lands | TESTED |
| `test_MinedSalt_DeploysAtTheDeclaredMask` | a salt mined for the declared mask deploys | TESTED |
| `test_SwapOnAHooklessPoolIsNotObserved` | the counter measures this hook's path, not the manager's activity | TESTED |
| `testFuzz_EveryPaymentIsDeliveredOnce` (router suite) | every payment the pool can fill is delivered once and observed once, 10,000 runs | TESTED |

The guard's negative control has now been seen red twice: on day 1 by sabotage (flipping
`beforeSwap` on made `setUp` fail with `192 != 64`), and on day 2 for real, when the gate was
added and the suite still expected the day-1 mask, before any 0xC0 address was trusted.

Re-run everything: `forge test -vv`. Fuzz runs are set in `foundry.toml` and printed beside
each fuzz test in the output.
