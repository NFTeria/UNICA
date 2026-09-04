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
