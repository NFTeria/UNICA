# INVARIANTS — the living record

The specification is `specs/HOOK-SPEC.md` section 3, with invariant I7 added by its addendum
"the non-negotiable three" (#3). This file tracks each invariant's state in the tree: the
enforcement point, the negative test that must fail before the positive is believed, and the
rung it has reached today. The specification is never edited; this file is.

Rungs, in order and never skipped: **PLANNED** (in the spec only) · **WRITTEN** (code exists)
· **TESTED** (a named test ran, its count was read, and its negative control was seen red)
· **LIVE-FIRED** (a real transaction on a public testnet, status 1, recorded in the README).

Day 2 (2026-09-04, night): the execution path is Uniswap's official Universal Router, driven by
the `SettlementExecutor`, and the hook admits nothing else (I1). The hook reads every term of the
order from the executor's storage and enforces it itself (I3, I4, I5), refuses a partial fill or
a short output (I6), and emits the receipt (I2). I7's defence is the official router's own
settle, proven in five rows. All seven are TESTED, against Uniswap's official PoolManager and
Universal Router bytecode. Nothing on this page is LIVE-FIRED yet: the day-1 live-fire was the
scaffold hook, which has none of this; the gated hook is live-fired on day 4. Why the official
router and not one of our own: `docs/EXECUTION-PATH.md`.

| # | Invariant (spec wording, abbreviated) | Enforcement point | Negative test | Rung today |
|---|---|---|---|---|
| **I1** | Recipient guarantee: output reaches only the registered payout address | `V4SettlementHook._beforeSwap` reverts `NotOfficialPath` unless the sender is the Universal Router, then `NotSettlementExecutor` unless the router's `msgSender()` is the executor at its derived address; the executor's plan `take`s the whole output to `order.recipient` from storage it wrote | a swap from the official test router → wrapped `NotOfficialPath`; the official router driven by a stranger → wrapped `NotSettlementExecutor(stranger)`, the stranger keeps every wei; the positive path asserts the recipient's balance delta equals the receipted output and nobody else, the executor and the router included, received | **TESTED** (`test_RevertWhen_SwapSenderIsNotTheOfficialRouter`, `test_RevertWhen_OfficialRouterIsDrivenByAStranger`, `test_SettlementDeliversToTheRegisteredRecipient`, fuzz 10,000) |
| **I2** | Fee transparency: net, fee, recipient id, order id in one receipt event, plus the standard `HookFee` event (addendum A4) | `V4SettlementHook._afterSwap`: `SettlementReceipt(orderId, poolId, recipient, payer, amountIn, amountOut, fee)` with the payer read from the order the executor recorded, and OpenZeppelin `IHookEvents.HookFee(poolId, payer, 0, 0)`; the fee is zero and says so | the test decodes both events and asserts exactly one of each, every field against the order and the recipient's balance | **TESTED** (`test_ReceiptCarriesTheOrderAndTheStandardEvent`) |
| **I3** | Slippage floor: realised output ≥ the order's minimum; exact-input partial fills revert (addendum A13) | the hook in `_afterSwap`, from the swap's delta against the order it reads: `PartialFill` if the pool consumed less than `amountIn`, `OutputBelowMinimum` if the output is short; `_beforeSwap` refuses a swap whose direction, amount, or pool is not the order's. The official router also checks its own `amountOutMinimum`, after the hook | output below minimum → wrapped `OutputBelowMinimum`, nothing moves; pool cannot fill → wrapped `PartialFill`, nothing moves; amount or pool differs → `ParamsDoNotMatchOrder`, `PoolDoesNotMatchOrder` | **TESTED** (`test_RevertWhen_OutputBelowMinimum_NothingMoves`, `test_RevertWhen_PoolCannotFillTheOrder_NothingMoves`, `test_RevertWhen_SwapParamsDisagreeWithTheOrder`, `test_RevertWhen_PoolDisagreesWithTheOrder`) |
| **I4** | Deadline: no settlement past the order's deadline | the executor in `pay`, and the hook in `_beforeSwap` from the deadline it reads itself | warp past the deadline → `OrderExpired` at the executor; the executor's check bypassed by the harness → wrapped `OrderExpired` at the hook | **TESTED** (`test_RevertWhen_OrderExpired`, `test_RevertWhen_ExpiredOrderReachesTheHook`) |
| **I5** | Replay protection: one order id settles at most once | the executor moves the order to `Paying` before any external call and to `Settled` after; the hook admits a swap only for an order that is `Paying` right now, so an unknown, open, or settled id is refused whatever the executor says | pay twice → `OrderNotOpen(Settled)`; a swap naming an unknown, an open, or a settled order → wrapped `OrderNotInFlight` with the state read | **TESTED** (`test_RevertWhen_OrderPaidTwice`, `test_RevertWhen_OrderIsNotInFlight`) |
| **I6** | **Never strand**: a rejected swap reverts the whole payment; the payer keeps the ETH and the order stays payable. Outranks I1–I5 | revert-only, everywhere; the hook never moves funds; the executor holds nothing and has no `receive` | every refusal test asserts the payer's balance unchanged, the recipient's unchanged, the executor and the router holding nothing, the order still `Open`, and no receipt | **TESTED** across every refusal in `test/SettlementExecutor.t.sol`, the hook checks in `test/V4SettlementHook.t.sol`, and row 3 of `test/I7NativeSettle.t.sol` |
| **I7** | Native settlement integrity: `sync(ADDRESS_ZERO)` immediately before `settle{value:}`, nothing between; nothing on the path holds a balance | the official router's `DeltaResolver._settle`, which syncs before every settle; the executor never holds a balance and has no `receive` | four rows against a stand-in at the router's address with the defence switchable (defence on/off × a foreign currency synced earlier in the same unlock; the defect row reverts `NonzeroNativeValue` and nothing moves), and a fifth against the official router's deployed bytecode with a foreign settle leg before the native one, which survives | **TESTED** (`test/I7NativeSettle.t.sol`, five rows plus the balance check) |

## The guard that every invariant depends on

**T5, the flag guard** (`specs/THREAT-MODEL.md` T5; `specs/HOOK-SPEC.md` section 5). A hook
whose address bits disagree with its declared permissions fails silently: the callback is
never called, nothing reverts, and every invariant above would hold vacuously.

| Test (`test/V4SettlementHook.t.sol`) | What it proves | Rung |
|---|---|---|
| `test_MinedAddress_MatchesDeclaredPermissions` | the mask in the address equals the mask read off the real runtime code | TESTED |
| `test_NoUndeclaredPermissionsCreepIn` | exactly the declared set: both swap callbacks, no returns-delta flag | TESTED |
| `test_RevertWhen_AddressBitsSayBeforeSwapOnly` | the same bytecode at a beforeSwap-only address is refused by v4 with `HookAddressNotValid` | TESTED |
| `test_RevertWhen_AddressBitsSayAfterSwapOnly` | the day-1 address shape (0x40) is refused by this code | TESTED |
| `test_ExecutorDerivationMatchesTheDeployedAddress` | the executor address the hook derives is where the executor lands | TESTED |
| `test_OfficialRouterIsTheDeployedRuntime` | the router the hook and the executor trust is Uniswap's Sepolia deployment, its runtime keccak asserted | TESTED |
| `test_MinedSalt_DeploysAtTheDeclaredMask` | a salt mined for the declared mask deploys | TESTED |
| `test_SwapOnAHooklessPoolIsNotObserved` | the counter measures this hook's path, not the manager's activity | TESTED |
| `testFuzz_EveryPaymentIsDeliveredOnce` (executor suite) | every payment the pool can fill is delivered once and receipted once, 10,000 runs | TESTED |

The guard's negative control has now been seen red twice: on day 1 by sabotage (flipping
`beforeSwap` on made `setUp` fail with `192 != 64`), and on day 2 for real, when the gate was
added and the suite still expected the day-1 mask, before any 0xC0 address was trusted.

Re-run everything: `forge test -vv`. Fuzz runs are set in `foundry.toml` and printed beside
each fuzz test in the output.
