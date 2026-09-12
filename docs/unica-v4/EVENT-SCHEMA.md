# UNICA v4 — event schema

Draft for owner review, not committed, authorising nothing (Q131). Written from
`docs/unica-v4/DECISIONS.md` (the ledger), which binds it, and from the two interface documents
beside it: `SPEC-CONTRACTS.md` (cited SC §n) and `SPEC-ORACLE-AND-CHAINS.md` (cited SOC §n). Where
this file and either of them disagree, they win and this file is wrong; §11 records how their
former disagreements with each other are reconciled. Evidence:
`docs/unica-v4/evidence/DESIGN-REVIEW.md` (DR), `MAINNET-CAPABILITY-PROBE.md` (MCP) and
`CHAINLINK-AVAILABILITY.md` (CA). "UNICA v4" is the UNICA release; "Uniswap v4" is the AMM. The
frozen experimental generation (tag `experimental-46630-settled`) is not UNICA v4 and is never
modified.

This file fixes every event's fields, indexed topics and canonical signature (topic0 is computed at
implementation), the surface that consumes it, and the indexed-history path (Q90). Error
catalogues belong to SC and SOC; the manifest's layout to the deployment specification. Every
consumer inherits the honesty rules: faucet stock tokens and uTUSD have no real-world value; an
opening rate is a demonstration rate the admin sets; a `demonstrationOnly` receipt is shown as
"Testnet demonstration — no-value tokens" and "Demonstration rate — no oracle" (Q123, SOC §14);
Chainlink is **planned** (Q125): no deployed UNICA v4 contract reads a Chainlink price.

**Count, stated.** 12 events across 3 emitting contracts: registry 9, hook 1, executor 2. Factory
0 (SC §7). Adapters: 0 specified; §7 proposes 2. The registry's ninth event is `OraclePolicySet`
(§4.4), and SC and SOC now agree on it as the one tighten event (§11).

## 1. Blockers

The first row blocks writing anything; after the owner's G0, none of the others blocks writing or
testing the events, and each blocks freezing, deploying or publishing.

| Ledger or evidence item | State | What it blocks in this file |
| --- | --- | --- |
| "What the missing answers mean", item 1 (owner, 2026-09-11) | **in force** until the owner's G0 (`IMPLEMENTATION-PLAN.md` §3) | Writing any event declaration, handler, subgraph or row of §13 before G0. |
| Q127 | the schema must be frozen before live contract integration | Live data in any surface. The schema **cannot be frozen** while the unconfirmed event completions of §12 stand and SR1 rows 15–17 (chain-file source prefixes, receipt documentation home, determinism pin; `IMPLEMENTATION-PLAN.md` §3) stay open. The SC/SOC conflicts formerly tracked at §11 are reconciled. Until then the checkout and dashboard consume frozen fixtures only. |
| The Graph on 46630 | **UNKNOWN**: MCP probed mainnets only; 46630 is not in any evidence file | A 46630 subgraph. Until a read-only check records The Graph's support page for 46630 as evidence, 46630 history uses the bounded event indexer or the clearly limited beta history view (§10.3, Q90). |
| Q9, Q132 | **OPEN** (Arbitrum One recommended, MCP); **unanswered** | Any mainnet emitter, so any 42161 subgraph or watcher. The Graph supports 42161 (MCP), but `config/chains/42161.json` stays `enabled: false`. |
| Q64, Q70 | **NOT READY** | Mainnet `AdminTransferStarted`/`AdminTransferred` to a Safe and a mainnet `PauserSet`: no Safe and no pauser key exist to name. |
| Q91 | **NOT SELECTED** | The watcher and readback RPC on any mainnet: the chain helper refuses while the named variable (for 42161, `ARBITRUM_MAINNET_RPC_URL`) is unset. |
| Q95 | **NOT PROVIDED** (account ownership and payment for hosting and paid services) | A Subgraph Studio account and any query-fee payment; Streams reports, so no Streams event can occur (§7). |
| Q131 | **NO AUTHORIZATION** | Deploying a subgraph to Subgraph Studio or the network, and publishing the evidence page. Both are publication. |
| Q110 (NFLX rate) | **NOT SELECTED** | Any NFLX event on 46630. NFLX exists only in local and fork test logs. |
| Q108 | **NOT READY** | A public merchant beta: `OrderCreatorSet(…, true)` names only founder-controlled or invited creators (Q35). |
| Chainlink on 46630 | no feeds; Streams verification UNCONFIRMED; CRE hosted writes unproven (CA §2a, §3a, §4) | Any receipt on 46630 with non-zero reference fields. Every 46630 receipt carries the demonstration values (§5). |

## 2. Conventions

- **topic0** is `keccak256` of the canonical signature (name and parameter types, no spaces, no
  names, no `indexed`; `PoolId` reduces to `bytes32`). It is **computed at implementation** from the
  compiled ABI, recorded here (and in `docs/unica-v4/RECEIPT-SCHEMA.md` if the owner adopts SR1 row
  16's proposal, `IMPLEMENTATION-PLAN.md` §3; `docs/RECEIPT-SCHEMA.md` is frozen and never edited, SC §11), and pinned by EV1 (§13); no value in this draft is a topic hash. A new name, type or order changes topic0; new
  parameter names or `indexed` flags change decoding only. All are schema changes (§12). No event is
  anonymous; indexed `uint8` values are left-padded to 32 bytes.
- **Units.** Token amounts in base units, never scaled. Fees as rates in pips (1e-6), as Uniswap v4
  uses them; deviation in basis points. Unix seconds, from the source's clock for
  `referenceUpdatedAt`, otherwise from the block. `rateE18` is whole payout per whole asset × 1e18.
- **Lifecycle codes** (SC §5): None 0, PROPOSED 1, INITIALIZED 2, SEEDED 3, ACTIVE 4, PAUSED 5,
  RETIRED 6. STALE_ORACLE and MARKET_CLOSED are computed conditions, never stored and **never
  emitted**: no event carries them, and a surface that shows them reads them live (SC §8.2, SOC §6).
- **Emitter authentication (SC §3, DR Lens C #6).** Anyone can deploy the same hook source through
  their own factory and emit a `SettlementReceipt` with an official `marketId`. A consumer accepts
  registry events only from the registry in `deployments/unica-v4/<chainId>.json`; a
  `SettlementReceipt` only when `log.address == registry.getMarket(marketId).hook`; `OrderCreated`
  and `Settled` only when `registry.marketIdOfExecutor(log.address) != 0`. A log that fails is not a
  UNICA v4 event, whatever its topics say.
- **Pools are found through the registry, never by token pair** (DR Lens A #1): a hookless or
  foreign-hook pool on the same pair emits look-alike `Swap` and `Initialize` logs.
- **Refusals emit nothing.** A reverted transaction leaves no log; a surface learns of a refusal
  from the transaction status and revert data, whose error names are defined once, in SC's
  catalogue (§11, C-5).
- **Current state is not history.** RPC reads answer "what is true now" and confirm a payment;
  events answer "what happened" (Q90). An indexer never supplies current status, and its lag is shown.

## 3. Who emits what

| Contract | Events | Source of the shape |
| --- | --- | --- |
| `UnicaMarketRegistry` (one per deployment) | `MarketProposed`, `MarketStatusChanged`, `MarketSeeded`, `OraclePolicySet`, `CapsSet`, `OrderCreatorSet`, `PauserSet`, `AdminTransferStarted`, `AdminTransferred` | SC §6; the last four are completed by this file (§12) |
| `UnicaMarketFactory` | none | SC §7 ("No events"): the registry records every factory step, so one emitter carries the whole lifecycle |
| `UnicaMarketHook` (one per market) | `SettlementReceipt` | SC §11 |
| `UnicaMarketExecutor` (one per market) | `OrderCreated`, `Settled` | SC §9.3, frozen shapes |
| `ChainlinkFeedAdapter` | none: it has no state-changing function | SC §10, SOC §7 |
| `ChainlinkStreamsAdapter`, `ChainlinkCREAdapter` | none specified; `StreamsReportAccepted`, `CREReportAccepted` proposed (§7) | this file, for confirmation |
| `MockOracleAdapter` | tests only; never in any ABI a surface or indexer loads | SOC §10 |

## 4. `UnicaMarketRegistry` events

Authenticated by `log.address` equal to the manifest's registry; row R10 (SC §6, DR Lens C #7)
pins their exact topics and data.

### 4.1 `MarketProposed`

```
event MarketProposed(bytes32 indexed marketId, address indexed asset, address indexed payout,
    uint32 version, address hook, address executor, bytes32 poolId, uint24 fee, int24 tickSpacing,
    uint256 rateE18, uint160 initSqrtPriceX96, int24 initTick, bool demonstrationOnly);
canonical: MarketProposed(bytes32,address,address,uint32,address,address,bytes32,uint24,int24,uint256,uint160,int24,bool)
```

Emitted once per market, by `register`, inside `factory.createMarket` (SC §5 row 1).

| # | Field | Type | Indexed | Value and source |
| --- | --- | --- | --- | --- |
| 1 | `marketId` | `bytes32` | yes | `keccak256(abi.encode(block.chainid, address(registry), asset, payout, version, policy.adapter, policy.feedId))`; `adapter` and `feedId` are zero for a demonstration market (S8) |
| 2 | `asset` | `address` | yes | the asset token; identity is the address, never a name or symbol |
| 3 | `payout` | `address` | yes | the payout token |
| 4 | `version` | `uint32` | | 1 for a pair's first market, +1 per relisting after RETIRED |
| 5 | `hook` | `address` | | the factory's CREATE2 address, low 14 bits `0x20C0`; the only valid `SettlementReceipt` emitter for this market |
| 6 | `executor` | `address` | | `CREATE(hook, 1)`; the only valid `OrderCreated` and `Settled` emitter for this market |
| 7 | `poolId` | `bytes32` | | the one pool the hook admits |
| 8 | `fee` | `uint24` | | the pool's static LP fee in pips: 500, 3000 or 10000 |
| 9 | `tickSpacing` | `int24` | | 10, 60 or 200, paired with the fee (SC §7) |
| 10 | `rateE18` | `uint256` | | the demonstration rate the admin set, write-once |
| 11 | `initSqrtPriceX96` | `uint160` | | the opening price on the tick grid, computed on-chain |
| 12 | `initTick` | `int24` | | the opening tick; `initializeMarket` must land on it |
| 13 | `demonstrationOnly` | `bool` | | true exactly when the policy is disabled, possible only where `REQUIRE_ORACLE` is false |

Not carried, read with `getMarket(marketId)` at the log's block: `assetDecimals`, `payoutDecimals`,
`assetIsCurrency0`, `proposedAt`; the `PoolKey` from `factory.poolKeyOf`.

### 4.2 `MarketStatusChanged`

```
event MarketStatusChanged(bytes32 indexed marketId, uint8 indexed from, uint8 indexed to);
canonical: MarketStatusChanged(bytes32,uint8,uint8)
```

Emitted on every stored transition, None → PROPOSED included, and on nothing else.

| Emitting function | `from` → `to` | Caller |
| --- | --- | --- |
| `register` (in `createMarket`) | 0 → 1 | FACTORY |
| `recordInitialized` (in `initializeMarket`) | 1 → 2 | FACTORY |
| `recordSeeded` (in `markSeeded`) | 2 → 3 | FACTORY |
| `activate` | 3 → 4 | ADMIN, after the stage readback passes (Q115) |
| `pause` | 4 → 5 | ADMIN or PAUSER |
| `unpause` | 5 → 4 | ADMIN only (Q70) |
| `retire` | 1, 2, 3, 4 or 5 → 6 | ADMIN; terminal (Q112) |

A second pause reverts, so `(5, 5)` never appears. All three values are topics, so a watcher
filters `to == 5` or `6` at the RPC. The caller is not a field: who paused is `tx.from` (§14,
item 4).

### 4.3 `MarketSeeded`

```
event MarketSeeded(bytes32 indexed marketId, uint128 depthAtOpeningTick);
canonical: MarketSeeded(bytes32,uint128)
```

Emitted once, by `recordSeeded`, beside `MarketStatusChanged(marketId, 2, 3)`: the pool's active
liquidity at the opening tick, every LP's included, so third parties can inflate it, never reduce
it (DR Lens A #10). Point-in-time: a later withdrawal is a PoolManager `ModifyLiquidity` log (§8).
The readback asserts `depthAtOpeningTick >= L` and that the admin's own position holds exactly `L`.

### 4.4 `OraclePolicySet`

```
event OraclePolicySet(bytes32 indexed marketId, address adapter, bytes32 feedId, uint48 maxAge,
    uint16 maxDeviationBps, bool enabled);
canonical: OraclePolicySet(bytes32,address,bytes32,uint48,uint16,bool)
```

Emitted by `register` and every `tightenOraclePolicy` (SC §6) with the full policy after the
change, so the last event alone is the current policy; on a tighten only `maxAge` or
`maxDeviationBps` falls. A demonstration market's one event is all zeros and `false`. `feedId` is
`keccak256(abi.encode("CHAINLINK_FEED", ASSET_FEED, QUOTE_FEED))` for a feed-adapter route (SOC
§7.1) and equals `IUnicaOracleRoute(adapter).feedIdFor(asset, payout)`, checked on-chain both at
`register` and by `_checkOracle` on every settlement, and committed inside `marketId` (§4.1, S8).

### 4.5 `CapsSet`

```
event CapsSet(bytes32 indexed marketId, uint128 maxPerTx, uint128 maxPerDay, uint128 maxSeed);
canonical: CapsSet(bytes32,uint128,uint128,uint128)
```

Emitted by `register` and every `tightenCaps`, full values in payout base units (`maxSeed` repeats
on a tighten). Beta values (Q5 to Q7): 10,000,000 / 25,000,000 / 100,000,000 for a 6-decimal payout
(SC §9.2); on 46630 they bound no-value uTUSD and only exercise the mechanism.

### 4.6 Role events

SC §6 names these four and says only that their addresses are indexed. The field lists below are
this file's completion; they fix topic0, so they must be confirmed before the freeze (§12).

```
event OrderCreatorSet(address indexed creator, bool allowed);                          // setOrderCreator
event PauserSet(address indexed previousPauser, address indexed newPauser);            // setPauser
event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin); // transferAdmin
event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);        // acceptAdmin
canonical: OrderCreatorSet(address,bool)  PauserSet(address,address)
           AdminTransferStarted(address,address)  AdminTransferred(address,address)
```

- ADMIN is implicitly a creator with no `OrderCreatorSet`; `canCreateOrders(a)` is the live answer.
- `newPauser == 0` means none. A repeated `transferAdmin` replaces the pending admin and emits again;
  the old admin keeps every power until `AdminTransferred` (SC §4).
- Proposed: the registry constructor emits `AdminTransferred(address(0), admin_)`, so the first
  admin is in the logs from the registry's creation block; otherwise an indexer reads `admin()` there.

## 5. `UnicaMarketHook`: `SettlementReceipt`

```
event SettlementReceipt(bytes32 indexed orderId, address indexed recipient, address indexed payer,
    bytes32 marketId, address currencyIn, address currencyOut, uint128 amountIn, uint128 amountOut,
    uint24 hookFeePips, uint24 lpFeePips, uint24 protocolFeePips, uint24 swapFeePips,
    uint256 referencePrice, uint8 referenceDecimals, uint64 referenceUpdatedAt, bool demonstrationOnly);
canonical: SettlementReceipt(bytes32,address,address,bytes32,address,address,uint128,uint128,uint24,uint24,uint24,uint24,uint256,uint8,uint64,bool)
```

Emitted by `_afterSwap` after the fill, minOut and oracle checks (SC §8.1, §11). **Evidence, not
success**: the merchant is not yet proven paid. Success is `Settled` (§6); one transaction holds
both, so a receipt without `Settled` cannot survive.

| # | Field | Type | Indexed | Filled from (SC §11) |
| --- | --- | --- | --- | --- |
| 1 | `orderId` | `bytes32` | yes | the hook data, checked against the executor's in-flight order |
| 2 | `recipient` | `address` | yes | the order's recipient, the merchant |
| 3 | `payer` | `address` | yes | the order's bound payer |
| 4 | `marketId` | `bytes32` | | the hook's `MARKET_ID`; authenticate the emitter against it (§2) |
| 5 | `currencyIn` | `address` | | `ASSET_TOKEN` |
| 6 | `currencyOut` | `address` | | `PAYOUT_TOKEN` |
| 7 | `amountIn` | `uint128` | | the pool's consumed delta, equal to the order's `amountIn` (full fill) |
| 8 | `amountOut` | `uint128` | | the pool's produced delta, at least the order's `minOut` |
| 9 | `hookFeePips` | `uint24` | | the constant `HOOK_FEE_PIPS = 0`: the hook cannot take a fee |
| 10 | `lpFeePips` | `uint24` | | `slot0.lpFee`, read in `afterSwap` of the same swap |
| 11 | `protocolFeePips` | `uint24` | | the 12-bit protocol fee for this direction: low bits if the asset is currency0, high bits otherwise |
| 12 | `swapFeePips` | `uint24` | | `protocolFee == 0 ? lpFee : calculateSwapFee(protocolFee, lpFee)`; equals the same transaction's PoolManager `Swap.fee` |
| 13 | `referencePrice` | `uint256` | | the adapter's price the hook checked; 0 when the oracle is off |
| 14 | `referenceDecimals` | `uint8` | | the adapter's decimals; 0 when off |
| 15 | `referenceUpdatedAt` | `uint64` | | the source's own publish time; 0 when off. Narrowed from the interface's `uint256`: a value that does not fit is in the future and refused before emission, and the narrowing uses SafeCast regardless |
| 16 | `demonstrationOnly` | `bool` | | `!policy.enabled` from the same registry read; equals the market record's flag |

**Reading rules.** The fee is a rate: about `amountIn × swapFeePips / 10⁶` of the asset went to
liquidity and the protocol; `hookFeePips` is shown apart (rec 58) and is 0, with no UNICA fee in the
beta (Q55 to Q61). With `demonstrationOnly = true`, fields 13 to 15 are zero and the surface shows
"Demonstration rate — no oracle"; every 46630 receipt is of this kind. An enabled reference is
labelled "oracle reference", and neither it nor the execution rate is ever presented as a
quotation of any stock. Uniqueness: `(chainId, hook, orderId)`, one receipt per order, ever. The
feed is not a field: `adapter` and `feedId` are write-once per market, so `OraclePolicySet` names
it and `marketId` commits to it (§4.1, §4.4); SC and SOC agree on this 16-field layout (§11).

**Distinct from both earlier receipts.** The frozen hook's receipt (nine fields; topic0 recorded in
`docs/experimental/STOCK-46630-FEE-FIELD.md`) and the schema v1 receipt of `docs/RECEIPT-SCHEMA.md`
have other canonical signatures, so no decoder can confuse them. Frozen row 11 is untouched.

## 6. `UnicaMarketExecutor`: `OrderCreated` and `Settled`

Both keep the frozen shapes (SC §9.3), so their topic0 values equal the frozen executor's, which
still emits on 46630 (tag `experimental-46630-settled`). Filtering by topic0 alone mixes the two
generations: the emitter rule of §2 is mandatory, and EV9 asserts the equality.

### 6.1 `OrderCreated`

```
event OrderCreated(bytes32 indexed orderId, address indexed recipient, address indexed creator,
    address boundPayer, uint128 amountIn, uint128 minOut, uint64 deadline);
canonical: OrderCreated(bytes32,address,address,address,uint128,uint128,uint64)
```

| # | Field | Type | Indexed | Value |
| --- | --- | --- | --- | --- |
| 1 | `orderId` | `bytes32` | yes | `keccak256(abi.encode(block.chainid, executor, creator, salt))`, never reused |
| 2 | `recipient` | `address` | yes | the merchant; never a reserved address (SC §9.1) |
| 3 | `creator` | `address` | yes | `msg.sender`: an allowlisted creator or ADMIN |
| 4 | `boundPayer` | `address` | | the only address that can pay; always non-zero in UNICA v4 (payer-bound only, Q111, Q128) |
| 5 | `amountIn` | `uint128` | | exact input, asset base units |
| 6 | `minOut` | `uint128` | | minimum delivery, payout base units, at most the market's `maxPerTx` |
| 7 | `deadline` | `uint64` | | Unix seconds; strictly after creation, no ceiling |

The market is the emitter (`marketIdOfExecutor(log.address)`). Orders are not enumerated on-chain:
a reader pages `OrderCreated` from the manifest's start block, with `orderCount()` as the expected
total and `orders(id)` for live status (SC §13). There is no cancel; "expired" is computed from
`deadline`; `Paying` never survives a transaction, so committed state shows Open or Settled.

### 6.2 `Settled`

```
event Settled(bytes32 indexed orderId, address indexed payer, address indexed recipient,
    address currencyIn, address currencyOut, uint256 amountIn, uint256 amountDelivered);
canonical: Settled(bytes32,address,address,address,address,uint256,uint256)
```

| # | Field | Type | Indexed | Value |
| --- | --- | --- | --- | --- |
| 1 | `orderId` | `bytes32` | yes | the order settled |
| 2 | `payer` | `address` | yes | `msg.sender`, which `pay` requires to equal the order's payer (`WrongPayer` otherwise) |
| 3 | `recipient` | `address` | yes | the order's recipient; equal to the `OrderCreated` recipient (invariant I3b, DR Lens C #3) |
| 4 | `currencyIn` | `address` | | `ASSET_TOKEN` |
| 5 | `currencyOut` | `address` | | `PAYOUT_TOKEN` |
| 6 | `amountIn` | `uint256` | | the order's `amountIn`, pulled exactly (`InputNotExact` otherwise) |
| 7 | `amountDelivered` | `uint256` | | the recipient's measured payout balance increase, which `pay` requires to equal the pool's output `out` (`DeliveryNotExact`, SC §9.1): at least `minOut`, at most `maxPerTx`, and the amount added to `payoutUsedOnDay` |

**The success signal**, emitted last in `pay` (SC §9.1 step 7). A surface confirms a payment only
from a mined transaction with status 1 holding one `Settled` from the market's executor with the
expected `orderId`. **Pairing:** receipt and `Settled` share the transaction and `orderId`, come from
the same market's hook and executor, and agree on `amountIn`; `amountDelivered == receipt.amountOut`,
enforced on-chain by `pay` and asserted again by the readback.

## 7. Oracle adapters

Neither interface document specifies an adapter event. Every adapter implements
`IUnicaPriceOracle.latestPrice(asset, quote)` and the adapter-level `IUnicaOracleRoute`
(`feedIdFor(asset, quote)`, `adapterKind()`); this release ships single-route adapters only, one
instance per route, constructor immutables, no admin beyond the optional downward-only
quote-freshness operator the O2 ruling added (S8; `docs/unica-v4/ORACLE-FRESHNESS-O2.md`).

| Adapter | Emits | Why |
| --- | --- | --- |
| `ChainlinkFeedAdapter` | nothing | Constructor immutables and `view` functions only (SOC §2, §7). Its configuration is read with views and pinned by runtime code hash in `config/chains/<chainId>.json` (SOC §12.1); the hook's reading appears in each receipt. |
| `ChainlinkStreamsAdapter` | nothing specified; `StreamsReportAccepted` proposed | `submitReport` is permissionless and changes the reference every later settlement checks. |
| `ChainlinkCREAdapter` | nothing specified; `CREReportAccepted` proposed | `onReport` from the pinned forwarder changes the stored reference. |
| `MockOracleAdapter` | whatever its setters emit, as a test convenience | Tests only, outside `src/` (SOC §10). Its ABI is never loaded by a surface, the subgraph or the watcher; a gate row fails if it is. |

**Proposed, for confirmation (§12), not specified by SC or SOC:**

```
event StreamsReportAccepted(bytes32 indexed feedId, address indexed submitter, uint256 price,
    uint32 marketStatus, uint64 observationsTimestamp, uint64 expiresAt);
canonical: StreamsReportAccepted(bytes32,address,uint256,uint32,uint64,uint64)

event CREReportAccepted(bytes32 indexed workflowId, address indexed asset, address indexed quote,
    uint256 price, uint8 decimals, uint64 observedAt);
canonical: CREReportAccepted(bytes32,address,address,uint256,uint8,uint64)
```

Emitted only after every check of SOC §8 or §9 passes; a refused report emits nothing.
`marketStatus` takes the pinned schema's status width once the v8 and v11 layouts are transcribed.
Two names, because one name with two signatures would be two topic0 values under one label.
**Neither adapter is deployable in this release** (Q95; CA §3a, §4), so these block nothing today;
if not adopted, the watcher polls `latestPrice` instead.

## 8. External events UNICA v4 consumers read, and the log set of each transaction

Not emitted by UNICA v4, but its readback and watcher depend on them. Signatures from the vendored
Uniswap v4 core (`lib/uniswap-hooks/lib/v4-core/src/interfaces/IPoolManager.sol`,
`IProtocolFees.sol`) and ERC-20.

| Event (emitter) | Declared | Used for |
| --- | --- | --- |
| `Initialize` (PoolManager) | `Initialize(PoolId indexed id, Currency indexed currency0, Currency indexed currency1, uint24 fee, int24 tickSpacing, IHooks hooks, uint160 sqrtPriceX96, int24 tick)` | readback of `initializeMarket`: the log is in a transaction whose `to` is the factory (the event has no sender field, DR Lens A #3); `id == poolId`, `hooks == hook`, `tick == initTick` |
| `ModifyLiquidity` (PoolManager) | `ModifyLiquidity(PoolId indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)` | seed readback; watcher alert on a negative `liquidityDelta` in a market pool (a withdrawn seed makes settlement fail safe until someone pauses, SC §7), and on any `ModifyLiquidity` — positive included — once the market is SEEDED or later: a live market's recorded range is never reseeded, widened or recentred (S6) |
| `Swap` (PoolManager) | `Swap(PoolId indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)` | emitted before `afterSwap` (`PoolManager.sol`, the `_swap` comment), so it precedes the receipt; `sender == executor`; `fee == receipt.swapFeePips` (DR Lens A #9). A market-pool `Swap` whose sender is not the executor cannot occur (`NotSettlementExecutor`); one seen is a high alert |
| `ProtocolFeeUpdated` (PoolManager) | `ProtocolFeeUpdated(PoolId indexed id, uint24 protocolFee)` | watcher alert for a market pool: the PoolManager owner can set a protocol fee at any time (DR Lens A #9); the script recomputes `minOut` from `feeRates()` at send time |
| `ProtocolFeeControllerUpdated` (PoolManager) | `ProtocolFeeControllerUpdated(address indexed protocolFeeController)` | watcher notice: the first step towards a protocol fee |
| `Transfer` (asset and payout tokens) | `Transfer(address indexed from, address indexed to, uint256 value)` | readback of `pay`: the exact input pull and the delivery to the recipient |
| implementation change of a pinned proxy or beacon | whatever the pinned contract emits | U7: the watcher alerts on it where one is emitted and also polls the implementation, since a missed log is not proof of no change; after a mismatch the pauser pauses the affected markets |

**Log set per transaction**, pinned by EV3 to EV5 (§13). Consumers join on ids and transaction hash,
never adjacency: SC fixes no log order in `createMarket`, and tokens may emit extra logs.

| Transaction | UNICA v4 logs | Other logs the readback checks |
| --- | --- | --- |
| factory deployment | none as specified; `AdminTransferred(0, admin)` from the registry if §4.6's proposal is adopted | — |
| `createMarket` | `MarketProposed`, `OraclePolicySet`, `CapsSet`, `MarketStatusChanged(id, 0, 1)` | none: the hook and executor emit nothing at construction |
| `initializeMarket` | `MarketStatusChanged(id, 1, 2)` | `Initialize` |
| seed (PositionManager, not a UNICA v4 call) | none | `ModifyLiquidity`, token `Transfer`s |
| `markSeeded` | `MarketSeeded`, `MarketStatusChanged(id, 2, 3)` | none |
| `activate`, `pause`, `unpause`, `retire` | one `MarketStatusChanged` | for a Safe call, the Safe's own execution log |
| `tightenOraclePolicy`, `tightenCaps` | one `OraclePolicySet` or `CapsSet` | — |
| `setOrderCreator`, `setPauser`, `transferAdmin`, `acceptAdmin` | one role event | — |
| `createOrder` | `OrderCreated` | none |
| `pay` | `SettlementReceipt`, then `Settled` | asset `Transfer` payer → executor; `Swap`; asset `Transfer` executor → PoolManager; payout `Transfer` PoolManager → recipient |

`pay`'s order, from SC §9.1: input pull, `Swap`, receipt, input settlement, delivery, `Settled` (last).

## 9. Which surface consumes which event

| Code | Surface | How it uses events |
| --- | --- | --- |
| RB | the stage readback, committed under `script/unica-v4/` | after each stage transaction, asserts the exact fields and emitters of its logs; `activate` is sent only after it passes (Q115) |
| MF | `deployments/unica-v4/<chainId>.json` | records per stage the transaction, block and log index that prove it; the registry's creation block starts every indexer |
| W | the event watcher (Q92), committed under `script/unica-v4/`, to be written | RPC through `script/unica-v4/chain.sh` by variable name; sends nothing; reports "blocks A to B scanned, N logs, 0 alerts", never a blank |
| CK | the checkout: today `prototype/unica-v4-ux/`, static, frozen fixtures only (Q122, Q123, Q127) | once live, confirms payment over RPC, never from an indexer |
| IX | indexed history: the subgraph, or the bounded indexer (§10) | history only |
| DB | the UNICA v5 dashboard, out of scope | history from IX, current state from the SC §13 views |
| EV | the public evidence page, static; publishing needs Q131 | links the explorer transactions |

| Event | RB | MF | W | CK | IX | DB | EV |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `MarketProposed` | fields, emitter | `createMarket` stage | notice | — | Market | markets | — |
| `MarketStatusChanged` | each stage | each stage | alert on `to` 5 or 6, or on any transition not in the manifest's plan | — (status read live) | history | timeline | — |
| `MarketSeeded` | `>= L` | seed stage | — | — | Market | market detail | — |
| `OraclePolicySet` | at register | policy | notice on every tighten | — | history | market detail | — |
| `CapsSet` | at register | caps | notice on every tighten | — (limits read live) | history | market detail | — |
| `OrderCreatorSet` | allowlist before activation | — | alert | — | roles | team | — |
| `PauserSet` | pauser set | — | alert | — | roles | admin | — |
| `AdminTransferStarted` | — | — | high alert, every time | — | roles | admin (pending action) | — |
| `AdminTransferred` | handover | admin | alert | — | roles | admin | — |
| `OrderCreated` | settlement stage | — | — | the order shown | Order | payments | — |
| `SettlementReceipt` | fees, reference, pairing | settlement stage | notice | receipt details | Settlement | payment detail | yes |
| `Settled` | success | settlement stage | daily total against `maxPerDay` | the success signal | Settlement | payments | yes |

**Watcher alert classes.** High: `AdminTransferStarted`; a market-pool `Swap` not sent by its
executor; a `SettlementReceipt`-topic log from an address the registry does not name (a look-alike,
recorded, never trusted); a pinned implementation change (U7). Alert: `to` 5 or 6; role changes;
`ProtocolFeeUpdated`; a negative `ModifyLiquidity` on a market pool; a positive `ModifyLiquidity` on
a market pool at or after SEEDED, or a pool tick outside its recorded range (S6). Notice:
tightenings, settlements. The incident procedure (Q69) starts here: pause, notice, preserve
evidence, investigate, redeploy if necessary.

**Checkout presentation.** "Payment details": amount in, amount delivered, guaranteed minimum, LP
and protocol fees as rates, UNICA fee 0, the oracle reference or "Demonstration rate — no oracle".
"Advanced details": `orderId`, `marketId`, hook, executor, pool id, transaction. Green only on
`Settled`; amber (STALE_ORACLE, MARKET_CLOSED) only from the live condition view; red on a revert,
with its decoded error (Q124).

**The static prototype's fixture** is the frozen generation's settlement (pay transaction `0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300`),
source `docs/experimental/STOCK-46630-FEE-FIELD.md`, in the frozen receipt shape, labelled "Testnet
demonstration — no-value tokens" and as the frozen experimental settlement, never as a UNICA v4
receipt. Laid out in this schema's fields: `hookFeePips` 0, `lpFeePips` and `swapFeePips` 3000 (the
same transaction's `Swap.fee`), `protocolFeePips` 0 (its recorded `slot0`), reference fields 0,
`demonstrationOnly` true (SOC §14), and no `marketId`.

## 10. Indexed history: The Graph where supported (Q90)

RPC serves current state and confirmation; The Graph serves indexed history where the chain is
supported, otherwise a bounded event indexer or a clearly limited beta history view (Q90). The Graph
stays third in the permanent sponsor order. Nothing in the settlement path depends on an indexer.

### 10.1 Where it is supported, from the evidence

| Chain | The Graph | Source | UNICA v4 status |
| --- | --- | --- | --- |
| 46630 Robinhood Chain Testnet | **UNKNOWN**: not probed | none in the evidence files | enabled, the rehearsal chain; history from §10.3 until support is recorded |
| 42161 Arbitrum One | YES, "eip155:42161" | MCP, Arbitrum One section | present, `enabled: false` (Q9 OPEN, Q132) |
| 4663 Robinhood Chain | YES, identifier `robinhood` | MCP, Robinhood section | not a launch candidate: fails the probe (no Circle USDC; Privy unconfirmed) |
| 8453, 130, 1 | YES | MCP, per chain | no configuration file |

A manifest's `network` value is copied from recorded evidence, never guessed; for 42161 the
evidence quotes only the chain id (§14).

### 10.2 The subgraph

- **Location**, proposed (§12): `integrations/graph/unica-v4/`, apart from the existing
  `integrations/graph/` subgraph for the schema v1 receipt, which is neither changed nor replaced.
- **Data sources.** The registry, one per network, address and `startBlock` from
  `deployments/unica-v4/<chainId>.json`. Templates `UnicaMarketHook` and `UnicaMarketExecutor` are
  instantiated in the `MarketProposed` handler with `marketId` as context. Only the official
  registry creates them, and it accepts `register` from its factory alone, so a look-alike hook is
  never indexed: emitter authentication is structural. The receipt handler still requires
  `marketId == context.marketId`. ABIs come from the pinned build, never by hand; never the mock's.
- **Entities**, deterministic ids:

| Entity | Id | Written by | Holds |
| --- | --- | --- | --- |
| `Market` | `marketId` | `MarketProposed`, then updated | the §4.1 fields; current status as last indexed; seed depth; current policy and caps |
| `MarketStatusChange` | transaction hash + log index | `MarketStatusChanged` | `from`, `to`, block, timestamp |
| `PolicyChange`, `CapsChange` | transaction hash + log index | `OraclePolicySet`, `CapsSet` | the full values emitted |
| `RoleChange` | transaction hash + log index | the four role events | kind and addresses |
| `Order` | `orderId` | `OrderCreated`; `Settled` marks it settled | the §6.1 fields; "expired" is computed at query time, never stored |
| `Settlement` | `orderId` | `SettlementReceipt`, completed by `Settled` in the same transaction | every receipt field, `amountDelivered`, both log indices |
| `Anomaly` | transaction hash + log index | any handler | kind and detail |

- **Anomalies are shown, never dropped.** A `Settled` with no receipt, a receipt with no `Settled`
  in its transaction, a `marketId` unlike the template's: each is impossible on the official path,
  so an anomaly means the indexer is wrong. Zero anomalies is stated, not implied.
- **Not indexed:** the PoolManager's `Swap`, `ModifyLiquidity` and `ProtocolFee*` logs, which cover
  every pool; the watcher reads them by RPC with a `poolId` topic filter.
- **Lag** (the last indexed block) is shown beside subgraph data, which is never a market's current
  status. **Tests:** handler tests from the implementation suite's own logs, including a look-alike
  receipt (no entity, EV8) and a receipt and `Settled` pair (one `Settlement`).
- **Deployment** to Subgraph Studio or the network is publication: Q131 NO AUTHORIZATION; account
  and payment Q95 NOT PROVIDED.

### 10.3 Where The Graph is not available (46630 today)

- **Bounded event indexer**: a committed read-only script under `script/unica-v4/`, to be written.
  RPC through `chain.sh` by variable name; `eth_getLogs` from the manifest's start block in fixed
  pages (size is configuration); the registry first, then the hooks and executors it names; the
  §10.2 entity and anomaly rules; a report "blocks A to B scanned, N logs, M anomalies, 0 gaps",
  refusing success with a gap. Derived output, regenerated from the chain; it sends nothing.
- **Clearly limited beta history view**, if neither exists: one bounded RPC range, labelled
  "Recent history only: blocks A to B", never presented as complete.

## 11. SC and SOC, reconciled

The conflicts formerly tracked here are reconciled by the owner's specification choices
(`DECISIONS.md`, "Specification choices", S1–S8) and the canonical choices recorded with them: one
tighten event, `OraclePolicySet`, full state after every change (§4.4; was C-1); SC's 16-field
receipt layout (§5; was C-2); `feedId` derived as
`keccak256(abi.encode("CHAINLINK_FEED", ASSET_FEED, QUOTE_FEED))`, the view `feedIdFor`, checked
on-chain and committed inside `marketId` (§4.1, §4.4, S8; was C-3); `oracleCondition()` as the one
condition view (SC §12, §13; was C-4); and one error catalogue, homed in SC, with SOC citing it for
adapter internals (was C-5). `IMPLEMENTATION-PLAN.md` §3 keeps the former SR1 numbering (rows
1–13) for citation. Still open there, and untouched by any of this: SR1 rows 15 (chain-file source
prefixes), 16 (receipt documentation home) and 17 (determinism pin) — none of which names an
event's fields or topic0.

## 12. Versioning, and the choices this file makes

**Versioning.** UNICA v4 events carry no `schemaVersion` field (SC §11); a schema is identified by
the manifest's registry address and the topic0. Any change to name, types, order or `indexed` is a
new signature; the old stays decodable, and an indexer adds a handler without touching old
entities (the `docs/RECEIPT-SCHEMA.md` rule). The hook and executor are never upgradeable (U1, U2):
a changed event is new code with a new `HOOK_CREATION_CODE_HASH`, which the deployed factory
refuses, so it ships as a new factory, release and manifest (U4, SC §12); existing markets keep
their shapes, and retired history stays readable (Q112). Frozen-generation events are never
re-emitted and their documentation is never edited.

**Choices compatible with the ledger but not decided in it, for the owner to confirm:**
1. Names for SC's unnamed parameters (`marketId`, `from`, `to`); names only, no topic0 change.
2. The four role events' field lists (§4.6), which fix four topic0 values.
3. The registry constructor emitting `AdminTransferred(address(0), admin_)` (§4.6).
4. `StreamsReportAccepted` and `CREReportAccepted` (§7).
5. The subgraph in `integrations/graph/unica-v4/` (§10.2).
6. The watcher and bounded indexer as committed read-only scripts under `script/unica-v4/`, named
   by the deployment specification.
7. A fixed log order in `createMarket` (`MarketProposed`, `OraclePolicySet`, `CapsSet`,
   `MarketStatusChanged`), pinned by EV3 for an exact readback; consumers still join on ids.

## 13. Rows that pin the schema

Under `test/unica-v4/`, extending SC's R10, S1 and H12a to H12c and SOC's O19 and O20; the test
specification owns final numbering. Each negative row states its precondition and pairs with a
passing control; each guard has a mutant its own row kills (DR Lens C #4, #5).

| Row | Proves | Sabotage that must turn it red |
| --- | --- | --- |
| EV1 | each event's `selector` equals the topic0 recorded in this file at implementation | two fields swapped in the declaration |
| EV2 | each log's topic count: 4 for `MarketProposed`, `MarketStatusChanged`, `SettlementReceipt`, `OrderCreated`, `Settled`; 3 for `PauserSet`, `AdminTransferStarted`, `AdminTransferred`; 2 for `MarketSeeded`, `OraclePolicySet`, `CapsSet`, `OrderCreatorSet` | one `indexed` removed |
| EV3 | `createMarket` emits exactly the four registry logs of §8 with exact data, and nothing from the hook, executor or factory | `CapsSet` not emitted at register |
| EV4 | each SC §5 transition emits exactly one `MarketStatusChanged` with its `(from, to)`; every refused pair of R4 emits none | `unpause` emitting `(5, 5)` |
| EV5 | `pay` emits one receipt from the hook and one `Settled` from the executor; `receipt.amountIn == Settled.amountIn == order.amountIn`; `amountDelivered` equals the recipient's balance change and `receipt.amountOut`; `swapFeePips == Swap.fee`; `Settled` is the last UNICA v4 log; each refusal leaves `receiptCount` and the log count unchanged | `amountDelivered` taken from `minOut` |
| EV6 | a disabled policy gives zero reference fields and `demonstrationOnly = true`; an enabled policy gives the adapter's exact reading (mock locally, real feeds on the fork rows of SOC §15) | reference fields read from a cached value |
| EV7 | each tightening emits one full-state `OraclePolicySet` or `CapsSet`; a refused loosening emits none (as C-1 is settled) | the old values emitted |
| EV8 | a look-alike hook's receipt carrying the official `marketId` creates no subgraph entity and no bounded-indexer row; the official receipt creates one | the template check removed from the handler |
| EV9 | UNICA v4 `OrderCreated` and `Settled` selectors equal the frozen generation's; `SettlementReceipt` differs from the frozen and schema v1 receipts | — (an equality row: it records why the emitter rule of §2 is mandatory) |
| EV10 | every event in the compiled ABIs of the four contracts is documented here and has a subgraph handler or an explicit "not indexed" line | an undocumented event planted in a copy of the ABI |

## 14. Open issues

1. topic0 for every event is computed at implementation (EV1) and written into §4 to §7.
2. **Applied.** C-1 to C-5 (§11) are reconciled, as recorded there; this file's fields already
   follow the reconciled choice.
3. The Graph's support for 46630 is not in the evidence; a read-only check records it, or 46630
   history stays on §10.3. The 42161 manifest identifier is not recorded verbatim either.
4. **Owner:** no registry event names its caller. For a direct call it is `tx.from`; for a call
   through a Safe it is the Safe, visible only in the Safe's own log or a trace (Q64 NOT READY).
   Adding a non-indexed `address caller` changes topic0 and must be decided before the freeze.
5. The readback, the watcher, the bounded indexer and their shared chain helper
   (`script/unica-v4/chain.sh`, SOC §16 item 10) are to be written.
6. `docs/RECEIPT-SCHEMA.md` is frozen and gets no UNICA v4 section. This file (§5) is the UNICA v4
   receipt reference; a separate `docs/unica-v4/RECEIPT-SCHEMA.md`, written after the freeze from
   this file, exists only if the owner adopts SR1 row 16's proposal.
7. **Applied.** One RPC variable name for 42161: `ARBITRUM_MAINNET_RPC_URL`, matching
   `foundry.toml`; this file uses it throughout (§1).
8. The Streams status width in `StreamsReportAccepted` waits on the v8 and v11 layouts (§7).
