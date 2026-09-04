# THREAT MODEL — the living record

The analysis is `specs/THREAT-MODEL.md` (T1–T13), written before the event and published
unedited. This file tracks what the tree does about each threat today. "Inherited" means the
defence comes from a pinned dependency and is named by file and line; "TESTED" means a test in
this repository exercises it and its negative control has been seen red.

| # | Threat (spec wording, abbreviated) | Defence in the tree | Test | Status |
|---|---|---|---|---|
| T1 | A callback callable by anyone, not only the PoolManager (the Cork Protocol shape) | Hook: `BaseHook.onlyPoolManager` on every external callback, OpenZeppelin `uniswap-hooks` v1.1.1 `src/base/BaseHook.sol` lines 57–60. Executor: has no unlock callback at all; the official router owns that surface | `test_ExecutorHasNoUnlockCallback` | hook INHERITED; executor **TESTED** (the door does not exist) |
| T2 | Hostile pool key: our hook attached to attacker-chosen currencies | pool allowlist (spec C2) | init an unlisted pool → revert | PLANNED |
| T3 | `hookData` is attacker-controlled | only an order id travels in `hookData`; the hook refuses any other length and reads everything else from the executor's storage (spec C1) | empty and 20-byte hook data → wrapped `MalformedHookData`; a forged id names an order that is not in flight → wrapped `OrderNotInFlight` | **TESTED** (`test_RevertWhen_HookDataIsNotAnOrderId`, `test_RevertWhen_OrderIsNotInFlight`) |
| T4 | `BalanceDelta` sign conventions | exact-input and exact-output tests on both legs | both directions asserted | PLANNED |
| **T5** | **Flag / permission mismatch, fails silently** | mask asserted numerically off the real runtime code before deploy; v4's `HookAddressNotValid` as the second control | `test_MinedAddress_MatchesDeclaredPermissions`, `test_RevertWhen_AddressBitsSayBeforeSwapOnly` and the rest listed in `docs/INVARIANTS.md` | **TESTED**, control seen red 2026-09-04 |
| T6 | Reentrancy inside the unlock window | the hook keeps no state between callbacks: `beforeSwap` and `afterSwap` each read the order from the executor, so there is nothing to poison (spec C3's keyed state is not needed); a reentrant second swap meets the same gate | reentrant swap between callbacks | WRITTEN (by construction); the test is PLANNED |
| T7 | Fee-on-transfer / rebasing payout tokens | the executor measures the recipient's balance across the router call and refuses an order that arrived short of its minimum (`RecipientShort`); the hook's receipt records the pool's credit, the executor's event what arrived. A payout-asset allowlist (spec C4) remains the stronger answer | a token burning 1% on `take` is refused with exact numbers; the same order settles at the delivered amount | **TESTED** at the executor (`test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer`); allowlist PLANNED |
| T8 | Revert-DoS on the exit path | I6: the hook never moves funds; every refusal reverts the whole payment and leaves the order payable; the executor has no refund path at all (exact input, no `receive`) | every refusal test asserts nothing moved | **TESTED** |
| T9 | Dust / `clear()` settlement DoS | the plan settles the full debt and takes the full credit (`OPEN_DELTA`), never a caller-typed amount | dust-sized swap | WRITTEN; test PLANNED |
| T10 | Cross-chain replay | order ids are `keccak256(chainid, executor, creator, salt)`; a reused salt is refused | `test_OrderIdsAreChainBoundCreatorBoundAndKnownInAdvance` | **TESTED** (id binding); a forked-chain replay test PLANNED |
| T11 | NoOp rug via `beforeSwapReturnDelta` | designed out: no returns-delta bits, ever; `test_NoUndeclaredPermissionsCreepIn` asserts both delta flags false | `test_NoUndeclaredPermissionsCreepIn` | TESTED (absence asserted) |
| T12 | Unbounded-loop gas exhaustion | no loops over user-controlled data in the hook | gas snapshot | PLANNED |
| T13 | Spot-price manipulation of the slippage floor | the floor is the registered order's minimum, never a spot quote read on-chain; the hook enforces it from the swap's delta | output below the minimum reverts | **TESTED** at the hook (`test_RevertWhen_OutputBelowMinimum_NothingMoves`) |

## Day 2

T1 (executor), T3, T5, T7 (executor side), T8, T10, T13 and the T11 absence are tested; T6 and
T9 are written by construction and await their tests. T2 (pool allowlist), T4, T12 remain
PLANNED. This
table is updated in the commit that changes a row.
