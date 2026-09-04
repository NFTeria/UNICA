# RECEIPT SCHEMA — the settlement receipt an indexer reads

Version 1, 2026-09-04. Emitted by the hook from inside the swap that settled the order
(`V4SettlementHook._receipt`), so a receipt exists only if the recipient was paid in the same
transaction. Every field is read from the order the executor stored or from the swap's delta,
never from hook data. A change to any field is version 2 with a new event signature; version 1
is never edited. An indexer keys on `schemaVersion` first.

## `SettlementReceipt`, version 1

Signature: `SettlementReceipt(bytes32,bytes32,address,uint16,address,address,address,address,uint128,uint128,uint128,bytes32)`

Topic 0: `0xf9b834e9c2d7d0250251dfdb3c5fdc3f97d829dbe3402f45c89257ab4ec43563` (re-verify: `cast keccak 'SettlementReceipt(bytes32,bytes32,address,uint16,address,address,address,address,uint128,uint128,uint128,bytes32)'`)

| # | Field | Type | Indexed | Meaning | Source |
|---|---|---|---|---|---|
| 1 | `orderId` | `bytes32` | yes | `keccak256(chainid, executor, count)`: bound to one chain and one executor, never repeated | the executor, at `createOrder` |
| 2 | `poolId` | `bytes32` | yes | the v4 pool id of the swap | the swap's key |
| 3 | `recipient` | `address` | yes | who received the output, the registered payout address (I1) | the order |
| 4 | `schemaVersion` | `uint16` | | `1` | the hook's constant |
| 5 | `payer` | `address` | | the attributed user: the caller of `pay`, recorded by the executor before it calls the router; the hook reaches it through the router's `msgSender()` and the order | the order |
| 6 | `executor` | `address` | | the `SettlementExecutor` that composed the router's plan | the hook's derived address |
| 7 | `currencyIn` | `address` | | the input currency; `address(0)` is native ETH | the swap's key |
| 8 | `currencyOut` | `address` | | the output currency | the swap's key |
| 9 | `amountIn` | `uint128` | | the order's amount, equal to what the pool consumed (a partial fill is refused, I6) | the order and the delta |
| 10 | `amountOut` | `uint128` | | the realised output, at least the order's minimum (I3) | the delta |
| 11 | `fee` | `uint128` | | `0`: this hook takes no fee | |
| 12 | `policyId` | `bytes32` | | reserved for a benefit or policy the executor applied to the order (a World-authorised discount, for one); `0` until one exists | the executor, later |

From the indexing context, not the event: chain id, block number, transaction hash, log index,
and the hook address (the emitter). Together `(chainId, hook, orderId)` identifies one settlement,
and there is exactly one receipt per order, ever (I5).

## The requirements, frozen (day 3, slice A)

These are the rules an indexer may rely on. Each is a test in `test/ReceiptSchema.t.sol` or in the
suite named beside it, and a change to any of them is a new schema version.

| Requirement | Rule | Proven by |
|---|---|---|
| Field types and indexed fields | as in the table above; three indexed topics, nine static data fields; the emitter is the hook | `test_Schema_TopicAndVersionAreTheDocumentedOnes` (the topic in this file equals the code's) |
| Units and semantics | amounts in the currency's smallest unit; `amountIn` is what the pool consumed, `amountOut` what it credited; both equal the PoolManager's own `Swap` deltas and, for a standard token, the recipient's balance change | `test_Schema_OneReceiptWhoseAmountsAreTheDeltasAndTheBalanceChange` |
| Native currency | `address(0)` in `currencyIn` or `currencyOut`, as in v4's pool key | the same test (`currencyIn == address(0)`) |
| Event order within the transaction | the PoolManager's `Swap`, then `SettlementReceipt`, then `HookFee`, then the token `Transfer` that pays the recipient, then the executor's `Settled`. The receipt precedes payment in the log; it survives only because the executor verifies the recipient afterwards and reverts otherwise | `test_Schema_LogOrderIsSwapReceiptFeeThenPayment` |
| Uniqueness key | `(chainId, hook, orderId)`; exactly one receipt exists for it, ever | `test_Schema_DuplicateOrderIdCannotProduceTwoReceipts`, `test_RevertWhen_OrderIsSwappedTwiceInOnePlan`, `test_OrderIdsAreChainBoundCreatorBoundAndKnownInAdvance` |
| Hook-address-agnostic decoding | an indexer selects by topic and `schemaVersion`, takes the hook from the emitter, and never hard-codes a deployment | `test_Schema_DecodingIsHookAddressAgnostic` (two hooks at two addresses, one decoder) |
| Versioning and migration | `schemaVersion` is the first data field; any change to fields, types, order or indexing is version 2 with a new signature and topic; version 1 is never edited; an indexer adds a handler for the new topic and leaves version-1 entities untouched | this file's rule; the constant `RECEIPT_SCHEMA_VERSION` |
| Completeness | a settlement is complete if and only if its receipt exists in a mined transaction: the receipt is emitted inside the swap, after the fill checks, and the whole transaction reverts on any refusal | the refusal tests below |
| Refused or reverted settlements | no receipt, no counter change, no entity: wrong path, stranger through the router, malformed hook data, order not in flight, expired, wrong parameters or pool, partial fill, short output, short delivery, second swap, replay | `test_RevertWhen_SwapSenderIsNotTheOfficialRouter`, `test_RevertWhen_OfficialRouterIsDrivenByAStranger`, `test_RevertWhen_HookDataIsNotAnOrderId`, `test_RevertWhen_OrderIsNotInFlight`, `test_RevertWhen_ExpiredOrderReachesTheHook`, `test_RevertWhen_SwapDirectionDisagreesWithTheOrder`, `test_RevertWhen_SwapParamsDisagreeWithTheOrder`, `test_RevertWhen_PoolDisagreesWithTheOrder`, `test_RevertWhen_PoolCannotFillTheOrder_NothingMoves`, `test_RevertWhen_OutputBelowMinimum_NothingMoves`, `test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer`, `test_RevertWhen_OrderIsSwappedTwiceInOnePlan`, `test_RevertWhen_OrderPaidTwice`, and row 3 of `test/I7NativeSettle.t.sol` |

Every control above was green against the implementation as of the commit that added this
section: the schema landed the same night with these properties, so no red control was needed to
motivate a change. The controls exist to keep it that way.

## Beside it

- OpenZeppelin `IHookEvents.HookFee(poolId, sender, feeAmount0, feeAmount1)` with `sender` the
  payer and both fees zero, so a generic hook indexer sees the settlement without knowing this
  schema. Note that `HookSwap` in Uniswap's own v4 subgraph is a different event with the same
  name (see `FEEDBACK.md`); this repository emits OpenZeppelin's.
- The executor's own `Settled(orderId, payer, recipient, amountIn, amountOut)`, measured at the
  recipient's balance. A convenience for callers, not the canonical record.

## Re-verify

```sh
forge test --match-test test_ReceiptCarriesTheOrderAndTheStandardEvent -vv
```

The test decodes both events field by field against the order and the recipient's balance.
