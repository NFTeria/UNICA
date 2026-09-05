# ABI MIGRATION REPORT — an expected payout currency on the order
Report. Nothing here is implemented. The live ABI is unchanged.

What this answers: if `SettlementExecutor.Order` gained a field naming the currency the recipient
expects to be paid in, what would move, what would not, and what the change would cost. It is
written against the tree at commit `72cabd2` (HEAD on `main`, 2026-09-05), whose `src/` is
byte-identical to the tag `live-green` (`5e1d843`) that the Sepolia deployment was built from:

```sh
git diff --stat live-green HEAD -- src foundry.toml remappings.txt     # prints nothing: identical
```

Every selector, topic, word count and slot count below was computed, not copied; the command is
beside the number. Live values were read from Ethereum Sepolia (chain id 11155111) over the public
RPC on 2026-09-05 at 16:20 UTC with `eth_call` only; nothing was sent. Line numbers are HEAD's.

## 1. Old and proposed structs, signatures and selectors

The struct today (`src/SettlementExecutor.sol` lines 53–62), and the proposal beside it:

```solidity
// today (live)                          // proposed
struct Order {                           struct Order {
    address recipient;                       address recipient;
    address creator;                         address creator;
    address payer;                           address payer;
    PoolKey key;                             PoolKey key;
    uint128 amountIn;                        uint128 amountIn;
    uint128 minOut;                          uint128 minOut;
                                             Currency payoutCurrency;   // new: what minOut is denominated in
    uint64 deadline;                         uint64 deadline;
    Status status;                           Status status;
}                                        }
```

`Currency` is v4-core's user-defined value type over `address`, the type `PoolKey` already uses;
its ABI type is `address`. The proposed `createOrder` mirrors the struct:

```solidity
function createOrder(
    address recipient,
    PoolKey calldata key,
    uint128 amountIn,
    uint128 minOut,
    Currency payoutCurrency,   // new
    uint64 deadline,
    bytes32 salt
) external returns (bytes32 orderId);
```

with one new check beside the existing ones (lines 141–155): `key.currency1 == payoutCurrency`, or
revert with a new error; the existing line 150–151 check that `key.currency1` is this chain's
sanctioned payout currency stays. So the field can never disagree with the pool that pays it.

| Item | Today (live) | Proposed | Moves |
|---|---|---|---|
| `Order` as an ABI tuple | `(address,address,address,(address,address,uint24,int24,address),uint128,uint128,uint64,uint8)`, 12 words | the same with `address` inserted after the second `uint128`, 13 words | yes: `orders()` return data grows by one word |
| `createOrder` signature | `createOrder(address,(address,address,uint24,int24,address),uint128,uint128,uint64,bytes32)` | `createOrder(address,(address,address,uint24,int24,address),uint128,uint128,address,uint64,bytes32)` | yes |
| `createOrder` selector | `0x849d8c9f` | `0x974fa766` | yes |
| `pay(bytes32)` | `0x8609cad1` | unchanged | no |
| `orders(bytes32)` | `0x9c3f1e90` | unchanged selector; 13-word return | return only |
| `orderCount()` | `0x2453ffa8` | unchanged | no |
| `HOOK()`, `SETTLEMENT_EXECUTOR()`, `receiptCount()`, `RECEIPT_SCHEMA_VERSION()` | `0xa54eb242`, `0x8dec7ecc`, `0x7f038f3c`, `0x5a6228b2` | unchanged | no |
| `OrderCreated` topic | `0xb44f69365ea9fe814655e6ffe1c0ba2e55cd0d2a6aa8ac7eb68db63fd5179cc0` | `0xf23aed85920d7a1908962aa74784f2737296fd44f8ef65bdf561ee21ccb92ffd` if the event gains the field (section 6); unchanged if not | decision |
| `Settled` topic | `0x2b48913bcaac5ca8fccdc740976517c444980bc382c153617621804fc277a184` | unchanged | no |
| `SettlementReceipt` topic | `0xf9b834e9c2d7d0250251dfdb3c5fdc3f97d829dbe3402f45c89257ab4ec43563` | unchanged (section 9) | no |
| `HookFee` topic | `0x444083dce778da1269b63671912c00569a2a58fa85827911902301f91793ffd7` | unchanged | no |

Computed with:

```sh
cast sig 'createOrder(address,(address,address,uint24,int24,address),uint128,uint128,uint64,bytes32)'          # 0x849d8c9f
cast sig 'createOrder(address,(address,address,uint24,int24,address),uint128,uint128,address,uint64,bytes32)'  # 0x974fa766
cast sig 'pay(bytes32)'; cast sig 'orders(bytes32)'; cast sig 'orderCount()'                                    # 0x8609cad1 0x9c3f1e90 0x2453ffa8
cast keccak 'OrderCreated(bytes32,address,address,bytes32,uint128,uint128,uint64)'                              # 0xb44f6936…
cast keccak 'OrderCreated(bytes32,address,address,bytes32,uint128,uint128,address,uint64)'                      # 0xf23aed85…
cast keccak 'Settled(bytes32,address,address,uint256,uint256)'                                                  # 0x2b48913b…
```

The four live selectors equal the ones the surface pins (`web/index.html` lines 116–119), and the
live `orders()` return is twelve words, read now:

```sh
cast call 0x044bc8a8773EC7b9B8de2467766636dFFCaC6210 'orders(bytes32)' \
  tx 0x72b25a9b4e6f89138766bb0251a1fc41f8da15efb0d87f058390da1737aab8e9 --rpc-url https://ethereum-sepolia-rpc.publicnode.com
# 384 bytes = 12 words; word 11 (the last) is 0x…03, Status.Settled
```

**Placement, and why after `minOut`.** Three placements were priced: after `key` (selector
`0xfbd61fb8`), after `minOut` (`0x974fa766`), after `deadline` (`0x121bd1e1`).

- Meaning: `minOut` is an amount in some currency; the field that names the currency belongs beside
  the amount it qualifies.
- Storage: today's struct occupies 8 slots. After `minOut`, the 20-byte field shares slot 7 with
  `deadline` (8 bytes) and `status` (1 byte), 29 bytes, still 8 slots. After `key`, it cannot share
  with the two `uint128`s and the struct grows to 9 slots: one more cold store per `createOrder`
  and one more load every time the hook reads the order. Derived from the packing rules (a struct
  starts a fresh slot; fields pack in declaration order while they fit); confirm on a built tree
  with `forge inspect src/SettlementExecutor.sol:SettlementExecutor storage-layout`. Not run here.
- Readers: `status` stays the last word, so the two shell readers that take the last word of
  `orders()` (`script/settle-live.sh` line 70, `docs/proof/verify-live.sh` line 102) keep working.
- One layout serves the struct, the function and the event, so a reader holds one picture.

## 2. The order hash and the order-id derivation

Today (`src/SettlementExecutor.sol` line 157):

```solidity
orderId = keccak256(abi.encode(block.chainid, address(this), msg.sender, salt));
```

Confirmed against the chain: the id recomputed offline from the four inputs equals the `orderId`
topic of the live receipt.

```sh
salt=$(cast keccak "unica settle stage 1")
cast keccak "$(cast abi-encode 'f(uint256,address,address,bytes32)' 11155111 \
  0x044bc8a8773EC7b9B8de2467766636dFFCaC6210 0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73 "$salt")"
# 0x72b25a9b4e6f89138766bb0251a1fc41f8da15efb0d87f058390da1737aab8e9  = topics[1] of the SettlementReceipt in tx 0x1120af18…cb83
```

**It does not need to change, and should not.** The id is a namespace handle, not a commitment to
the order's contents: recipient, key, amounts and deadline are stored under the id and read back
from storage by the hook (`src/V4SettlementHook.sol` lines 256–265, spec C1), never derived from it.
A new field is more content, and content stays out of the id for the same reason the existing
fields are out of it. Putting the currency in would buy nothing: `pay(orderId)` can only pay the
stored order (section 3). It would cost something: a creator could then reuse one salt across two
currencies, which today's `OrderExists` refusal (line 158) forbids on purpose, and every offline
computer of the id would move for no gain (`script/LiveFire.s.sol` line 365, `script/settle-live.sh`
line 68, `integrations/graph/local-e2e.sh` line 98, `test/SettlementExecutor.t.sol` line 369).

The id will nonetheless differ for every order on the proposed executor, because `address(this)`
is a term and the executor is a new contract at a new address (section 8). The domain changes by
itself; the formula does not have to.

One drift found while checking this: `docs/RECEIPT-SCHEMA.md` line 17 still describes the id as
`keccak256(chainid, executor, count)`. The code moved to creator and salt in commit `e08c4d0`
(2026-09-04, `git log -S'msg.sender, salt' -- src/SettlementExecutor.sol`), and
`docs/THREAT-MODEL.md` line 20 has the current formula. That is a prose error in the schema
document today, independent of this proposal; it is not a schema change (section 9).

## 3. Replay-domain implications

| Term | Where it binds | Can an order be replayed across it? |
|---|---|---|
| chain id | in the id (line 157) | No. The same creator and salt yield a different id on another chain, and the other chain's executor has no such order anyway: `pay` reverts `UnknownOrder` (line 183). The threat-model row T10 records the id binding as tested and a forked-chain replay test as planned (`docs/THREAT-MODEL.md` line 20); this proposal changes neither. |
| executor address | in the id, and the order lives only in that executor's `_orders` | No. An id from one executor is unknown to another; recreating the same salt on the new executor produces a different id. After a new pair exists (section 8) the old pair stays live with no pause and no owner, so two independent domains accept orders at once. Nothing crosses between them. |
| creator and salt | in the id; a reused salt is refused (`OrderExists`, line 158) | No. Per creator, per salt, one id, ever. |
| currency (new) | in the stored order, forced equal to `key.currency1` at creation | No. `pay` pays the stored order; the hook admits the swap only in the pool whose id equals `order.key.toId()` (`src/V4SettlementHook.sol` line 183) and the executor takes `key.currency1` to the recipient (`src/SettlementExecutor.sol` line 235). There is no path by which the same id settles in another currency. Two orders that differ only in currency need two salts; that is the existing rule, not a new one. |
| the same order, twice | `Open → Paying → Settled`, one receipt per order (I5) | No; unchanged. The live verifier checks it: a replay of `pay` on the settled order must revert (`docs/proof/verify-live.sh` line 104). The live order reads `status` 3, Settled, today. |

A limit worth stating plainly: the field is shape, not capability. The live hook binds one payout
currency per deployment in an immutable (`PAYOUT_CURRENCY`, `src/V4SettlementHook.sol` lines 46, 106,
156), and the executor accepts only that currency (line 150–151). On any hook built from this
source, the new field can only ever hold that one address. A second sanctioned currency is a
separate change to the hook and to `UniswapDeployments.payoutCurrency`, not a consequence of
this one.

## 4. Web changes, by line (`web/index.html`)

Two kinds of line move: those that move because the ABI moves, and those that move because the
contracts are redeployed (section 8). Both are listed, because the surface refuses to enable
anything while a pinned row disagrees with the chain (lines 241–254, 290): a stale pin is a dead
page, by design.

Because of the ABI:

| Line | Today | Proposed |
|---|---|---|
| 118 | `createOrder: "0x849d8c9f"` and its signature comment | `0x974fa766`, the new signature |
| 128 | `orderCreated: "0xb44f6936…"` | `0xf23aed85…` if the event gains the field (section 6); unchanged otherwise |
| 165 | `data.length < 2 + 12 * 64` | `13 * 64` |
| 167–172 | `decodeOrder`: words 0–9, then `deadline` word 10, `status` word 11 | words 0–9 unchanged; `payoutCurrency: addrOf(word(data, 10))`; `deadline` word 11; `status` word 12 |
| 422–425 | the hand-encoded `createOrder` calldata: ten 32-byte words after the selector (`from`, the five key words, `amountIn`, `minOut`, `deadline`, `salt`) | eleven words: the currency word inserted between `minOut` and `deadline`, i.e. `CFG.usdc` a second time (it is already the key's `currency1`, the third word after the selector) |

Unchanged: lines 116, 117, 119 (`orders`, `pay`, `orderCount`), 120–124 (readback selectors),
127 (the receipt topic), 176–185 (`decodeReceipt`), 433–436 (reads `topics[0]` and `topics[1]` only,
so the new topic pin at 128 is the whole change), 501 (`pay` calldata), 506–509 (receipt filter).

Because of the redeploy: 93–96 (the release comment), 102 `executor`, 103 `hook`, 107 `poolId`,
109 `codeBytes` (both sizes are unknown until the code is built), 110 `deployBlock`, 111 `release`,
and 113 `receiptTx`, which either moves to the first receipt of the new pair or stays as the
historical canonical receipt with a note; that is a wording decision, not a technical one.
`web/README.md` repeats the pins at lines 37–38, 51–52 and 56–57 and lists the readback selectors at
lines 60–62; `createOrder`'s selector is pinned in `index.html` alone; it also appears as recorded calldata in the committed `broadcast/` records, which are history and are not edited.

## 5. Subgraph compatibility (`integrations/graph/`)

The receipt entity is unchanged: `schema.graphql` lines 6–30 name the twelve emitted fields plus
the indexing context, and nothing in the proposal touches the receipt (section 9). The single
handler still copies field for field (`src/mapping.ts` lines 7–33) and its version guard (line 9)
still admits version 1.

`OrderCreated` is not indexed. The manifest has one data source, the hook (`subgraph.yaml` lines
6–13), one event handler, `SettlementReceipt` (lines 24–26), and the ABI file is the hook's:

```sh
grep -c OrderCreated integrations/graph/abis/V4SettlementHook.json    # 0
```

So the event's topic can move without a subgraph change. Indexing the executor's events would be
a new data source with its own ABI file and entity; none exists, and this report does not propose
one.

What does move, all of it because of the redeploy: `subgraph.yaml` line 11 (address) and line 13
(`startBlock`), `networks.json` lines 4–5 and `networks.local.json` lines 4–5. The hook's ABI file
does not change: the proposal adds nothing to the hook's public interface (the hook decodes `Order`
internally, at `src/V4SettlementHook.sol` line 263, which is bytecode, not ABI).
`tests/settlement.test.ts` lines 105–118 pin the live receipt of the present hook as a fixture; those
tests stay true for that hook and would need a second fixture for the new one. `local-e2e.sh`
derives both addresses from `predict()` (lines 44–45) and asserts that `networks.json` names the
predicted hook (line 68), so it fails loudly until the manifest is repointed, which is the right
failure; its `createOrder` call at line 100 carries the old signature and six arguments (ten calldata words) and moves
with section 1; lines 134–138 pin the present receipt's transaction, block and log index.

One design consequence for an indexer: with two live pairs (section 8), receipts from both are
valid version-1 receipts. The entity id is transaction hash plus log index and the `hook` field is
the emitter (`mapping.ts` lines 12, 27), so one subgraph can carry both hooks as two data sources
sharing the handler; the uniqueness key `(chainId, hook, orderId)` of `docs/RECEIPT-SCHEMA.md`
line 31 already anticipates it.

## 6. Event compatibility

**`OrderCreated`.** Today (`src/SettlementExecutor.sol` lines 75–83): three indexed topics
(`orderId`, `recipient`, `creator`) and four data fields (`poolId`, `amountIn`, `minOut`,
`deadline`). Two options:

- Add `address payoutCurrency` after `minOut`, mirroring the struct. The signature becomes
  `OrderCreated(bytes32,address,address,bytes32,uint128,uint128,address,uint64)` and the topic
  `0xf23aed85…`. Cost: one pin in the surface (line 128). Gain: the event states the order's
  currency, which today it cannot, because it carries `poolId`, a hash, and not the key; a reader
  who wants the currency today has to call `orders(orderId)` anyway.
- Leave the event alone. The topic stays `0xb44f6936…`, and the currency is read from `orders()`.

The in-tree consumers of the event are one: the surface, which reads `topics[0]` and `topics[1]`
(lines 433–436). Either option is safe for it. The first is the honest one if the field is worth
adding at all: an order announcement that omits the one new fact is a strange announcement.

**`Settled`.** Unchanged, `Settled(bytes32,address,address,uint256,uint256)`, topic `0x2b48913b…`.
Its `amountOut` is the recipient's balance change in `key.currency1` (lines 203–208); the currency
is already stated by the hook's receipt in the same transaction, so nothing is added here.

**The receipt.** Unchanged; section 9.

## 7. Script and verifier changes, by line

Solidity and scripts:

| File | Lines | Moves |
|---|---|---|
| `script/LiveFire.s.sol` | 371–373 | the `createOrder` call gains one argument, the key's `currency1` (`Currency.unwrap(key.currency1)`, or `c.usdc` from `Chains`) |
| | 364–365 | salt and `expectedId`: unchanged (section 2) |
| | 96–128 | the deploy stage: no text moves, but `predict()` (147–156) returns a new salt and address, and the three assertions at 112, 116 and 125–126 are what prove the new pair is bound (section 10) |
| `script/Interactions.s.sol` | all | unchanged (four wrappers) |
| `script/go-live.sh` | 7–8, 30–31 | the target addresses; 33 the freeze tag (a new candidate, never a moved one, per its own comment at 45–47); 32 the nonce at validation, re-read at the time |
| `script/settle-live.sh` | 26–27 | addresses; 28 the freeze tag; 51–52 the two byte counts (unknown until built); 59 the pool id, derived from `HOOK` so it follows; 68 the id formula, unchanged; 69 the comment "twelve static words" becomes thirteen; 70 `[-64:]` still reads `status`; 79, 84 unchanged |
| `script/topup-live.sh` | 23–24, 45–46 | addresses and byte counts, the same way |
| `script/readback.sh` | 19–20 | derives both addresses from `predict()` and `predictExecutor()`; nothing to edit |
| `Makefile` | — | pins none of the four addresses (`grep -n 0x Makefile` finds one literal, the USDC token at line 133, which this proposal does not move); unchanged |
| `test/` | 21 lines call `createOrder(` (`grep -rc 'createOrder(' test`: 15 in `SettlementExecutor.t.sol`, 2 each in `ReceiptSchema.t.sol` and `attack/HostilePool.t.sol`, 1 each in `I7NativeSettle.t.sol` and `V4SettlementHook.t.sol`) | every call gains the argument; `test_OrderIdsAreChainBoundCreatorBoundAndKnownInAdvance` (lines 366–380) keeps its formula; new tests owed: the field must equal `key.currency1` or the order is refused, the field is stored and returned as word 10, `orders()` is thirteen words, and, if section 6 adds it, `OrderCreated` carries it |

The live verifier, `docs/proof/verify-live.sh`, 31 rows today (`grep -c '^chk ' docs/proof/verify-live.sh`):

| Lines | Rows | Moves |
|---|---|---|
| 18–19 | the two addresses | new pair |
| 59–60 | runtime byte counts 10634 and 11289 | new counts, unknown until built |
| 69 | pool id from the live key | follows `HOOK`; no edit |
| 76–85 | the deploy record: seven transactions from nonce 450, five landed, two failed, and the initialise price looked up at nonce 452 (line 80) | these rows describe this deployment's history, including its lost first settlement; a new deployment has its own record and nonce sequence, so rows 81–83 and 85 are rewritten from the new record, not re-pinned |
| 88–89 | `receiptCount` and `orderCount` at least 1 | pass only after the new pair's first settlement; before it they fail, which is the verifier's own control (its header, lines 12–13) |
| 90–109 | the settle record and the settlement transaction | work as written for a new settle record; 101 the comment "twelve" becomes thirteen; 102 `[-64:]` still reads `status` |
| 110–111 | Sourcify by address | new addresses, re-verified after `make verify` |
| — | a row worth adding | `orders(orderId)` returns 13 words and word 10 equals the sanctioned currency; the row would have failed against the live executor when written, which is how a new row earns its place |

`docs/proof/verify-day1.sh` is untouched: it proves the day-1 scaffold hook, a different contract.
Documents that repeat the pins: `docs/DEPLOYMENT.md` lines 37–51 and 75–79, `README.md` lines 164–172,
`docs/proof/README.md` lines 33–43, and the stale prose at `docs/RECEIPT-SCHEMA.md` line 17.

## 8. Migration or no-migration

There is no migration path, by construction:

- The hook's `SETTLEMENT_EXECUTOR` is an immutable (`src/V4SettlementHook.sol` line 48) computed
  once, in the constructor (line 107), from `type(SettlementExecutor).creationCode` plus the hook's
  own address, the canonical factory and salt zero (lines 117–123). Any other caller of the router
  is refused with `NotSettlementExecutor` (line 175).
- The executor's `HOOK` is an immutable too (`src/SettlementExecutor.sol` lines 67, 124).
- Neither contract has an owner, a setter, a proxy or a pause.

A changed `Order` changes the executor's runtime and so its creation code; a different creation
code hashes to a different CREATE2 address; the live hook keeps naming the old one and would refuse
the new one on its first swap. So the change is not an upgrade of anything. It is a second pair,
hook and executor, at two new addresses, with a new pool (the key names the hook, so the pool id
is new), initialised and seeded again, with its own deploy record, settle record, source
verification and tag; and the surface and the subgraph pointed at it.

The consequences that are easy to miss:

- The present pair does not go away. It keeps accepting `createOrder` and `pay` for its own ids,
  its receipts stay valid version-1 receipts, and its Sourcify matches stand. Two live domains,
  indefinitely.
- There is nothing to migrate. The live executor holds one order, and it is `Settled`
  (`orderCount` 1, `receiptCount` 1, read 2026-09-05 16:20 UTC). Orders are not moved between
  executors; ids are executor-bound.
- The live pool's liquidity stays in the live pool (`docs/DEPLOYMENT.md` line 169 records the
  position's holder and who may withdraw it). The new pool needs its own seed from what the
  deployer holds, within the seed stage's budget and floor (`script/LiveFire.s.sol` lines 46–49).
- The public sentence about the live flow stays true of the present pair. A new pair starts at
  "written" and climbs every rung again: built, tested, deployed, verified, live-fired.

## 9. Whether the receipt schema truly remains unchanged

Every field of `SettlementReceipt` version 1 (`src/V4SettlementHook.sol` lines 65–78, emitted at
236–249), checked against the table in `docs/RECEIPT-SCHEMA.md` lines 15–28:

| # | Field | Source today | Under the proposal |
|---|---|---|---|
| 1 | `orderId` | the order id | same derivation (section 2); the document's prose at line 17 is stale today (count instead of creator and salt) and is a prose fix, not a field change |
| 2 | `poolId` | the swap's key | same; a new value, because the key names a new hook |
| 3 | `recipient` | the order | same |
| 4 | `schemaVersion` | the constant, 1 (line 58) | same |
| 5 | `payer` | the order | same |
| 6 | `executor` | `SETTLEMENT_EXECUTOR` | same field; a new address |
| 7 | `currencyIn` | `key.currency0` | same |
| 8 | `currencyOut` | `key.currency1` | same, and by the new `createOrder` check it equals `order.payoutCurrency` by construction, so the receipt already states what the new field states |
| 9 | `amountIn` | the order, equal to the delta | same |
| 10 | `amountOut` | the delta | same |
| 11 | `fee` | 0 | same |
| 12 | `policyId` | 0 | same |

No field is added, removed, retyped, reordered or re-indexed, so under the document's own rule
(line 47: any such change is version 2 with a new signature) the version stays 1, the topic stays
`0xf9b834e9…`, `RECEIPT_SCHEMA_VERSION` stays 1, and the subgraph's guard at `mapping.ts` line 9 still
admits. This holds on one condition: the implementation must not add `payoutCurrency` to the
receipt. It would duplicate field 8 and force version 2 for nothing.

Two things a reader should not confuse with a schema change. The hook's runtime bytecode is
expected to change even though its ABI does not, because `_inFlightOrder` decodes the executor's
`Order` return (line 263) and the decoder is compiled from the struct; the new size is unknown until
built. And the uniqueness key `(chainId, hook, orderId)` (line 31) gets a new `hook` term, so old
and new receipts never collide.

## 10. Effect on deterministic addresses and CREATE2 mining

Measured sizes of the artifacts built from the live source (the executor's runtime equals the
chain's 11,289 bytes):

```sh
python3 -c "import json;j=json.load(open('out/SettlementExecutor.sol/SettlementExecutor.json'));print((len(j['bytecode']['object'])-2)//2,(len(j['deployedBytecode']['object'])-2)//2)"   # 12662 11289
python3 -c "import json;j=json.load(open('out/V4SettlementHook.sol/V4SettlementHook.json'));print((len(j['bytecode']['object'])-2)//2,(len(j['deployedBytecode']['object'])-2)//2)"        # 26712 10634
```

The hook's creation code (26,712 bytes) embeds the executor's creation code (12,662 bytes) through
`type(SettlementExecutor).creationCode` at `src/V4SettlementHook.sol` line 119, used only in the
constructor so that it never reaches the runtime (the embedding: `docs/DEPLOYMENT.md` lines 45–47; that it stays out of the runtime: the hook's own comment, `src/V4SettlementHook.sol` lines 110–116).
The chain of consequences of one new struct field:

1. The executor's runtime changes, so its creation code changes, so its init-code hash changes.
2. The hook's creation code embeds it, so the hook's init-code hash changes.
3. `predict()` (`script/LiveFire.s.sol` lines 147–156) walks salts from zero and returns the first
   whose address carries the declared flags and avoids the reserved top byte `0x91`. The live salt
   `0xd76` (`README.md` line 164) is void; the new salt and hook address are unknown until the
   candidate is compiled and `make predict` is run (`Makefile` lines 123–124). The flag bits of the
   live address are `0x20C0`, computed as `0x11202071…0C0 & 0x3FFF`: `beforeInitialize`,
   `beforeSwap`, `afterSwap`, the set at `script/LiveFire.s.sol` line 83. (`docs/DEPLOYMENT.md`
   line 37 says the salt is mined for `0xC0`; the script mines for `0x20C0`, and `README.md` line 164
   says so. A prose inconsistency, no effect on the mining.)
4. The executor's constructor argument is the hook's address, so the executor's address moves for
   two reasons at once: its own code and its argument.
5. The pool id is `keccak256(abi.encode(key))` with `key.hooks` the new hook, so it moves; the live
   id recomputes as `0xff4f4e24…56db` from the live key
   (`cast keccak "$(cast abi-encode 'f((address,address,uint24,int24,address))' "(0x0000…0000,0x1c7D…7238,3000,60,0x1120…a0C0)")"`).

What must be re-mined: the hook salt, once, on the frozen candidate. What must be re-verified, in
the order the deploy stage asserts it: the deployed hook address equals the prediction (line 112),
its flag bits equal the declared set (line 113), `hook.SETTLEMENT_EXECUTOR()` equals the executor
the script derives independently (line 116), the executor lands there (line 125) and names the hook
(line 126); then the permission tests that run on every build (`docs/INVARIANTS.md` line 52), the
runtime byte counts into every pin of sections 4 and 7, Sourcify for both new addresses, and the
readback in which each names the other. Adding a chain to `UniswapDeployments` would move the
addresses again, since both libraries resolve at construction (`src/libraries/UniswapDeployments.sol`
line 23); that is a separate change and is not proposed here.

## The decision

The owner can rule on one question: leave the live ABI as it is, with this report as the record of
what an expected-payout-currency field would cost, or open a new deploy candidate that adds
`Currency payoutCurrency` after `minOut` in the struct, the function and, on the second option of
section 6, the event, moving `createOrder` to selector `0x974fa766` and `orders()` to thirteen words
while `pay`, `orderCount`, `Settled` and the receipt stay as they are. Either way the facts are
these: the change cannot reach the live hook and executor, so it is a second pair, a second pool,
a second seed and a second round of verification, with the present pair staying live beside it;
the order-id derivation and the receipt schema do not move; and the field alone enables no second
payout currency, because the hook binds one per deployment. Nothing in this report recommends
deploying. It says what a deploy would entail if the owner chooses one.
