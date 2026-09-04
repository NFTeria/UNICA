# THREAT MODEL — the living record

The analysis is `specs/THREAT-MODEL.md` (T1–T13), written before the event and published
unedited. This file tracks what the tree does about each threat today. "Inherited" means the
defence comes from a pinned dependency and is named by file and line; "TESTED" means a test in
this repository exercises it and its negative control has been seen red.

| # | Threat (spec wording, abbreviated) | Defence in the tree | Test | Status |
|---|---|---|---|---|
| T1 | A callback callable by anyone, not only the PoolManager (the Cork Protocol shape) | `BaseHook.onlyPoolManager` on every external callback, OpenZeppelin `uniswap-hooks` v1.1.1 `src/base/BaseHook.sol` lines 57–60; `_afterSwap` is `internal` and reachable only through it | direct-call test | INHERITED, test PLANNED |
| T2 | Hostile pool key: our hook attached to attacker-chosen currencies | pool allowlist (spec C2) | init an unlisted pool → revert | PLANNED |
| T3 | `hookData` is attacker-controlled | only an order id travels in `hookData`; everything else is read from hook storage written by an authenticated call (spec C1) | forged hook data → no effect | PLANNED |
| T4 | `BalanceDelta` sign conventions | exact-input and exact-output tests on both legs | both directions asserted | PLANNED |
| **T5** | **Flag / permission mismatch, fails silently** | mask asserted numerically off the real runtime code before deploy; v4's `HookAddressNotValid` as the second control | `test_MinedAddress_MatchesDeclaredPermissions`, `test_RevertWhen_AddressBitsSayBeforeSwapOnly` and the rest listed in `docs/INVARIANTS.md` | **TESTED**, control seen red 2026-09-04 |
| T6 | Reentrancy inside the unlock window | callback state keyed by pool and caller, cleared after use, own guard (spec C3) | reentrant swap between callbacks | PLANNED |
| T7 | Fee-on-transfer / rebasing payout tokens | payout-asset allowlist (spec C4); Circle USDC qualifies | FoT mock is refused | PLANNED |
| T8 | Revert-DoS on the exit path | I6: the hook never moves funds; revert is the only failure | force each revert, payment untouched | PLANNED |
| T9 | Dust / `clear()` settlement DoS | router settles exact deltas | dust-sized swap | PLANNED |
| T10 | Cross-chain replay | order ids bound to chain id and hook address | replay on a forked chain id | PLANNED |
| T11 | NoOp rug via `beforeSwapReturnDelta` | designed out: no returns-delta bits, ever; `test_NoUndeclaredPermissionsCreepIn` asserts both delta flags false | `test_NoUndeclaredPermissionsCreepIn` | TESTED (absence asserted) |
| T12 | Unbounded-loop gas exhaustion | no loops over user-controlled data in the hook | gas snapshot | PLANNED |
| T13 | Spot-price manipulation of the slippage floor | the floor is the registered order's minimum, never a spot quote read on-chain | move the pool, expect revert | PLANNED |

## Day 1

Only T5 and the T11 absence are tested. Everything else is the router-gate and invariant
work, one slice at a time, each with its negative test first. This table is updated in the
commit that changes a row.
