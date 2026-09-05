# THREAT MODEL — the living record

The analysis is `specs/THREAT-MODEL.md` (T1–T13), written before the event and published
unedited. This file tracks what the tree does about each threat today. "Inherited" means the
defence comes from a pinned dependency and is named by file and line; "TESTED" means a test in
this repository exercises it and its negative control has been seen red.

| # | Threat (spec wording, abbreviated) | Defence in the tree | Test | Status |
|---|---|---|---|---|
| T1 | A callback callable by anyone, not only the PoolManager (the Cork Protocol shape) | Hook: `BaseHook.onlyPoolManager` on every external callback, OpenZeppelin `uniswap-hooks` v1.1.1 `src/base/BaseHook.sol` lines 57–60. Executor: has no unlock callback at all; the official router owns that surface | `test_ExecutorHasNoUnlockCallback` | hook INHERITED; executor **TESTED** (the door does not exist) |
| T2b | Front-running the settlement pool's initialisation | the deploy script continues past an existing pool only at the price it chose, and refuses to seed any other; v4 pools cannot be re-initialised, so refusing is the only safe move | on a fork, an attacker initialises the key at 1:1: both stages refuse and the pool's liquidity reads back 0 | **TESTED** on a fork (day-5 attack review) |
| **T2** | **Hostile pool key: our hook attached to attacker-chosen currencies** | the hook's `beforeInitialize` refuses any pool that is not native ETH against this chain's payout currency, resolved from the chain id with no owner and no list to manage (spec C2 and C4 in one line); the executor refuses such an order too | an attacker's own token as `currency1` → the pool cannot be initialised, and `PayoutCurrencyNotAllowed` at order creation; the control is that the sanctioned shape still initialises, seeds and settles, at any fee tier and from any caller | **TESTED** (`test/attack/HostilePool.t.sol`, four tests). Found exploitable by the day-5 attack review: a genuine receipt could be minted for worthless output naming any recipient |
| T3 | `hookData` is attacker-controlled | only an order id travels in `hookData`; the hook refuses any other length and reads everything else from the executor's storage (spec C1) | empty and 20-byte hook data → wrapped `MalformedHookData`; a forged id names an order that is not in flight → wrapped `OrderNotInFlight` | **TESTED** (`test_RevertWhen_HookDataIsNotAnOrderId`, `test_RevertWhen_OrderIsNotInFlight`) |
| T4 | `BalanceDelta` sign conventions | exact-input and exact-output tests on both legs | `test_RevertWhen_SwapIsExactOutput_EitherDirection` (exact output, both directions, refused before a delta exists), `test_RevertWhen_SwapDirectionDisagreesWithTheOrder` (exact input the other way), `test_Schema_OneReceiptWhoseAmountsAreTheDeltasAndTheBalanceChange` (the settlement leg's amounts equal the deltas) | **TESTED** |
| **T5** | **Flag / permission mismatch, fails silently** | mask asserted numerically off the real runtime code before deploy; v4's `HookAddressNotValid` as the second control | `test_MinedAddress_MatchesDeclaredPermissions`, `test_RevertWhen_AddressBitsSayBeforeSwapOnly` and the rest listed in `docs/INVARIANTS.md` | **TESTED**, control seen red 2026-09-04 |
| T6 | Reentrancy inside the unlock window | the hook keeps no state between callbacks: `beforeSwap` and `afterSwap` each read the order from the executor, so there is nothing to poison (spec C3's keyed state is not needed); a reentrant second swap meets the same gate | `test_ReentrantPaymentOfTheSameOrderIsRefusedByItsState`, `test_ReentrantPaymentOfAnotherOrderIsRefusedByTheRouterLock_AndStaysPayable`: a payout token that calls out on transfer re-enters `pay` from inside the take that pays the recipient, the only point at which a settlement hands control to foreign code (after both callbacks, inside the unlock). Measured 2026-09-05: the same order is refused by its own state; another order is refused by the official router's own lock (`ContractLocked`) before the PoolManager's `AlreadyUnlocked` is reached, which was the prediction; each outer settlement has exactly one receipt | **TESTED** |
| T7 | Fee-on-transfer / rebasing payout tokens | the payout currency is fixed by the chain (C4, above), so a hostile token cannot be brought in at all; for the residual risk that the sanctioned token itself behaves this way, the executor measures the recipient's balance across the router call and refuses an order that arrived short (`RecipientShort`) | the fee-on-take runtime placed at the payout address burns 1% and the payment is refused with exact numbers; the same order settles at the delivered amount | **TESTED** (`test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer`) |
| T8 | Revert-DoS on the exit path | I6: the hook never moves funds; every refusal reverts the whole payment and leaves the order payable; the executor has no refund path at all (exact input, no `receive`) | every refusal test asserts nothing moved | **TESTED** |
| T9 | Dust / `clear()` settlement DoS | the plan settles the full debt and takes the full credit (`OPEN_DELTA`), never a caller-typed amount | `test_SmallSettlementReachesTheRecipientWhole` (the control: a thousand wei, the fee rounding up against it, every credited unit reaches the recipient), `test_RevertWhen_DustYieldsNoOutput_NothingMoves` (one wei is consumed whole by the fee, yields nothing, refused inside the swap, nothing moves) | **TESTED** |
| T10 | Cross-chain replay | order ids are `keccak256(chainid, executor, creator, salt)`; a reused salt is refused | `test_OrderIdsAreChainBoundCreatorBoundAndKnownInAdvance` | **TESTED** (id binding); a forked-chain replay test PLANNED |
| T11 | NoOp rug via `beforeSwapReturnDelta` | designed out: no returns-delta bits, ever; `test_NoUndeclaredPermissionsCreepIn` asserts both delta flags false | `test_NoUndeclaredPermissionsCreepIn` | TESTED (absence asserted) |
| T12 | Unbounded-loop gas exhaustion | no loops over user-controlled data in the hook | `test_Gas_OneSettlementStaysUnderTheCeiling`: one whole settlement, both callbacks included, asserted under 300,000 gas; measured 236,726 on 2026-09-05; the check went red at a ceiling of 236,000 before the real one was set | **TESTED** |
| T13 | Spot-price manipulation of the slippage floor | the floor is the registered order's minimum, never a spot quote read on-chain; the hook enforces it from the swap's delta | output below the minimum reverts | **TESTED** at the hook (`test_RevertWhen_OutputBelowMinimum_NothingMoves`) |

## Day 2

T1 (executor), T2, T3, T5, T7, T8, T10, T13 and the T11 absence are tested; T6 and T9 are written
by construction and await their tests. T4 and T12 remain PLANNED.

## Day 5

An adversarial attack review ran five lenses over the hook, the executor, the pool, the unlock
window and the accounting, each finding put to an independent verifier. It found two exploitable
defects, both now fixed with their own tests and commits: a pool of the attacker's own devising
could mint a genuine settlement receipt for worthless output naming any recipient (T2, closed by
the payout-currency check at initialisation), and an order could name a contract on the settlement
path as its recipient, leaving the output sweepable or stranded (closed by refusing all six at
order creation). The remaining findings are evidence gaps rather than breaks and are listed in
`docs/reviews/`. This
table is updated in the commit that changes a row.
