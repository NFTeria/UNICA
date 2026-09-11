# The receipt's `fee` field on the 46630 settlement, and what it does not say

Written 2026-09-11, after the one settlement on Robinhood testnet 46630 (pay tx
`0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300`, block 117535202). Every number
below was read from that transaction's receipt or recomputed from it; the commands are at the end.

## What the receipt says

The experimental hook's `SettlementReceipt`, decoded from the log it emitted:

| Field         | Value                                        |
| ------------- | -------------------------------------------- |
| `currencyIn`  | faucet TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` |
| `currencyOut` | uTUSD `0xfb93352698150e720Bf0A321DEf3aC98D90B9874`       |
| `amountIn`    | 1000000000000000 (0.001 TSLA)                |
| `amountOut`   | 393052 (0.393052 uTUSD)                      |
| `fee`         | **0**                                        |
| `policyId`    | **0** (all 32 bytes zero)                    |

The source writes both as literals: `0` and `bytes32(0)` in the `emit` at
`src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol`, inside `_afterSwap`.

## What the swap paid

The PoolManager's own `Swap` event in the same transaction reports `fee = 3000`: the pool's LP fee,
3000 pips, which is 0.3%. The pool's protocol fee is 0 (`slot0` reads protocolFee 0, lpFee 3000),
and the PoolManager's `protocolFeesAccrued` for TSLA is 0, so the whole fee went to the liquidity.

No event states the fee as an amount. Recomputed from the swap's own price movement, 997000000000000
raw TSLA moved the price through the range and released 393052.14 raw uTUSD, which rounds down to
the 393052 delivered. The remaining **3000000000000 raw TSLA (0.000003 TSLA)** is the LP fee. That
is exactly `1e15 × 3000 / 1e6`, as the v4 fee rule gives for an exact-input swap that finishes
inside one liquidity range.

## Why both are true, and where the gap is

In this repository's receipt schema, `fee` has meant **the hook's own fee** since V1:
`docs/RECEIPT-SCHEMA.md`, row 11, defines it as "`0`: this hook takes no fee". The experimental
hook takes no fee, so `0` is correct in the receipt's own terms. `policyId` is reserved, and is
`0` until an executor applies a policy; none does here.

The gap is what the receipt leaves out. It does not carry the **pool's** LP fee, and the payer
did pay that inside the swap. A reader who takes a field called `fee` to mean what the payer paid
in fees would read 0 where the answer is 0.3%, which is 0.000003 TSLA here. The value is right;
the name, read on its own, invites the wrong question.

## What is and is not done about it

- **The deployed contracts are not changed.** They are frozen as deployed under the tag
  `experimental-46630-settled`, and a receipt already emitted cannot be edited.
- **Nobody should quote the receipt's `fee` as the fee paid.** The fee paid is the `Swap` event's
  `fee` (a rate, in pips), applied to the input.
- **UNICA v4 fixes it only if its test proves the fix.** The receipt should keep the hook's own
  fee explicitly and add the fee rate the PoolManager actually applied: the LP fee and the
  protocol fee, read from the pool's state in the same transaction. A test must set a non-zero
  protocol fee on a local PoolManager and assert the receipt reports it. Until that test exists
  and passes, no redeployment is justified on this ground alone.

## Re-derive it

```bash
PAY_TX=0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300   # the pay tx
cast receipt $PAY_TX --json --rpc-url robinhood_testnet | jq '.logs[] | select(.topics[0] == "0x2583a534a59ee6da3339351f87c9e89546b517294c1bcc57980f8a371716f177") | .data'
cast receipt $PAY_TX --json --rpc-url robinhood_testnet | jq -r '.logs[] | select(.topics[0] == "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f") | .data' | xargs cast abi-decode --input 'f(int128,int128,uint160,uint128,int24,uint24)'
cast call 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' 0x64553b2a4c30c7a7551f752184ef3442e40817cc17f118db3d95142839057a34 --rpc-url robinhood_testnet
```

The first topic is `SettlementReceipt`'s and the second is the v4 `Swap` event's. `robinhood_testnet`
is this repository's foundry alias; any 46630 endpoint answers the same.
