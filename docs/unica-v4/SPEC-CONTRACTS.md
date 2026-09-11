# UNICA v4 — contract specification

Draft for owner review, not committed, authorising nothing (Q131). Written from `docs/unica-v4/DECISIONS.md`, which
binds it: where they disagree, the ledger wins. "UNICA v4" is the UNICA release; "Uniswap v4" is the AMM. The frozen
experimental deployment (tag `experimental-46630-settled`) is **not** UNICA v4 and is never modified. Evidence:
`docs/unica-v4/evidence/DESIGN-REVIEW.md` (design, prototype measurements, critique findings cited as A1–A16, B1–B10,
C1–C20), `CHAINLINK-AVAILABILITY.md` and `MAINNET-CAPABILITY-PROBE.md` beside it. Prototype sizes and gas are
feasibility evidence measured outside this repository; implementation re-measures. Faucet stock tokens and uTUSD have
no real-world value; an opening rate is a demonstration rate the admin sets, never a market price. Chainlink is
**planned**: no deployed UNICA v4 contract reads a Chainlink price.

## 1. Scope and non-scope

### 1.1 What the frozen experiment proved, and what it did not

The frozen generation (`src/experimental/robinhood-testnet/*`) settled once on 46630: pay transaction
`0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300`, block 117535202, 0.001 faucet TSLA in, 393052
raw uTUSD out to the merchant (`docs/experimental/STOCK-46630-FEE-FIELD.md`).

| Proved by the frozen settlement | Not proved, and what UNICA v4 does about it |
|---|---|
| An executor that takes the PoolManager lock itself, so the hook sees the executor as `sender` | Per-market generality: TSLA and uTUSD were constructor constants. UNICA v4 derives everything per market (§6–§9). |
| Payer binding, merchant binding, exact input, minOut checked twice, replay refusal, full fill, residual checks | That a stranger cannot drain the seed: `createOrder` was permissionless. UNICA v4 adds the order-creator allowlist (§4). |
| The hook-receipt / executor-`Settled` split: a receipt without `Settled` cannot survive | That only one pool exists: the frozen `_beforeInitialize` checks currencies only, so every fee tier of the pair is admitted (A1). UNICA v4 admits one exact key from the factory only (§8). |
| A hook that takes no fee and has no return-delta flags | That the receipt says what the payer paid in fees: its `fee` field is the hook's own fee, 0, while the pool charged 3000 pips (§11). |
| Settlement on a live chain with no-value tokens | Any oracle bound, any pause, any cap, any Safe, source verification (the frozen contracts were never verified, B6), an opening price on the tick grid (the live swap crossed 7 empty ticks). |

### 1.2 In scope, and not

**In scope.** Under `src/unica-v4/`: `UnicaMarketRegistry`, `UnicaMarketFactory`, `UnicaMarketHook` and
`UnicaMarketExecutor` (one of each per market), `IUnicaPriceOracle`, `ChainlinkFeedAdapter`,
`ChainlinkStreamsAdapter`, `ChainlinkCREAdapter`, and inlined libraries for types, errors, events and the
opening-price math; `MockOracleAdapter` under `test/unica-v4/` only. Planned first deployment, not built and not
authorized: a 46630 rehearsal, TSLA only, registry `requireOracle = false`, market flagged demonstration-only
on-chain. NFLX is proven configuration-only in local and fork tests, not deployed (Q110).

**Not in scope.** UNICA v5, the dashboard. Public payment links (v5, Q128). Refunds, subscriptions, partial payments
(Q41–43). Any UNICA fee (Q55–61). Webhooks, API, database (Q87–89). Upgradeability (Q66). Permit2 payment. Real
tokenized equities (Q16, Q20, Q23). Any mainnet deployment (Q132). Privy, which touches no contract.

## 2. Blockers

Open ledger items that touch a contract. The first row blocks every implementation task; after the owner's G0, none
of the others blocks writing, testing or fork-rehearsing, and each blocks deploying or activating something.

| Ledger item | State | What it blocks in this specification |
|---|---|---|
| "What the missing answers mean", item 1 (owner, 2026-09-11) | **in force** until the owner's G0 (`IMPLEMENTATION-PLAN.md` §3) | Any implementation of this specification: nothing is written under `src/unica-v4/`, `script/unica-v4/` or `test/unica-v4/` before G0. |
| Q132 | **OPEN, unanswered** | Any mainnet deployment, including no-value infrastructure. No registry with `requireOracle = true` is deployed anywhere. |
| Q9 | **OPEN** (Arbitrum One recommended by the probe) | Enabling `config/chains/42161.json`, which stays present but `enabled: false`. Therefore every mainnet constructor argument: PoolManager, adapter feed routes, sequencer feed. |
| Q64 | **NOT READY** | A Safe as ADMIN. Without it no mainnet market may leave SEEDED, and no value moves. |
| Q70 | **NOT READY** | Assigning a mainnet PAUSER. The rule stands and is built in: PAUSER pauses, only ADMIN unpauses. |
| Q71 | **NOT READY** | A mainnet launch, under the accepted gates. |
| Q91 | **NOT SELECTED** | The primary and fallback RPC for any mainnet chain: the chain helper refuses while the named variable (for 42161, `ARBITRUM_MAINNET_RPC_URL`) is unset, so no mainnet readback can exist. |
| Q95 | **NOT PROVIDED** | Any paid Chainlink access (Data Streams subscription), so `ChainlinkStreamsAdapter` has no report to verify. |
| Chainlink on 46630 | no feeds; Streams report verification UNCONFIRMED; CRE hosted writes unproven | Any oracle-enabled market on 46630. The rehearsal registry is `requireOracle = false`; the oracle path is proven only on a fork, labelled exactly "Chainlink integration demonstrated on a fork" (Q30, Q125). |
| Q16, Q20, Q23 | no issuer; **NO CONFIRMED REVIEW**; no licensed equity data | Any equity oracle policy on mainnet, and any claim about securities. Equities are future support (Q15, Q21). |
| Q110 (NFLX rate) | **NOT SELECTED** | Deploying an NFLX market. NFLX stays a configuration-only test. |
| Q110 (merchant control) | **UNKNOWN/NOT PROVIDED** | Describing the rehearsal merchant `0x19E56831a10d43CfF5d77f886c799C6b916da7Ae` (source: DECISIONS.md Q110) as owner-controlled. |
| Q108 | **NOT READY** | A public merchant beta. The order-creator allowlist holds only founder-controlled or invited creators (Q35). |
| Q131 | **NO AUTHORIZATION** | Pushing or publishing this specification or anything built from it. |
| SC/SO reconciliation (SR1, `IMPLEMENTATION-PLAN.md` §3) | **RECONCILED** (rows 1–13 and 18, per `DECISIONS.md` "Specification choices" S1–S8) | Rows 15 (chain-file source prefixes), 16 (receipt documentation home) and 17 (determinism pin) remain open for an owner ruling. Every other named conflict — the oracle interface views, `feedId` derivation and binding point, adapter shape, registry and hook error names, the tighten event, the `maxAge` and deviation ceilings, the reference-decimals bound, the equal-to-block timestamp, adapter-revert decoding, the band boundary, the condition view and the receipt oracle fields — is settled: each name in §6, §8.2, §10 and §11 exists once. |
| Q5–Q7 caps (DECISIONS.md S5) | **RULED** | Claiming the $100 cross-market total is enforced on-chain: it is not. It is a deployment-script and manifest refusal (S5), an operational deployment gate, never an on-chain invariant. Per-market per-transaction, per-day and seed caps are enforced on-chain over the range `W` only (§7, §9.2). Any deployment or activation that cannot enumerate and verify every registered market's `maxSeedPayout` fails closed. |
| Recs 32, 38–40 (merchant id and payout configuration on-chain; accepted assets; min/max payment) | **CONFLICT**, owner scope decision needed | Claiming the recs are met. There is no on-chain merchant record, merchant id, per-merchant asset list or minimum payment; §9.2 maps what exists onto the recs. |
| Q25 "Semantic limit" (1755 s ETH/USD heartbeat against the 300 s crypto cap) and the minimum availability `A(maxAge)` | **no remedy ruled**; minimum **OPEN** (owner) | Any enabled crypto policy on 42161 (SO §11). |
| Sequencer `GRACE_PERIOD` | **OPEN** (owner; 3600 s proposed, not an evidence fact, SO §7.3) | Deploying `ChainlinkFeedAdapter`, whose constructor takes it (§10). |
| 46630 Uniswap v4 addresses (PoolManager, PositionManager, StateView, Permit2) | `null` / `PENDING` in `config/chains/46630.json` (SO §12.1) | Factory construction on 46630 (§7 takes `POOL_MANAGER` from that file) and every 46630 stage, until a reviewed commit records them in evidence with a source. |

## 3. Architecture and market identity

```
UnicaMarketFactory ─constructor CREATE─▶ UnicaMarketRegistry = CREATE(factory, 1)
   └ createMarket: CREATE2(salt, hookCreationCode ‖ hookArgs), keccak(code) == pinned hash
UnicaMarketHook (low 14 bits == 0x20C0) ─constructor CREATE─▶ UnicaMarketExecutor = CREATE(hook, 1)
   └ afterSwap: STATICCALL IUnicaOracleRoute(policy.adapter).feedIdFor(asset, payout) == policy.feedId
              ▶ STATICCALL IUnicaPriceOracle(policy.adapter).latestPrice(asset, payout)
```

**marketId** = `keccak256(abi.encode(block.chainid, address(registry), asset, payout, version, policy.adapter,
policy.feedId))`, with `adapter` and `feedId` zero for a demonstration market; `version` a `uint32` from 1 per pair,
so ids never collide across chains or releases. `register` (§6) recomputes `marketId` from the policy it is given and
requires it to equal the caller's argument (S8): the route is cryptographically bound into the id itself, and the id
travels inside the hook's 288-byte CREATE2 arguments (§7), so the hook address commits to the route too. Identity is
the token **address**; names and symbols are never stored or trusted. **One non-retired market per (asset, payout):**
a new version needs `liveMarketOf[asset][payout] == 0`, true only after the previous version is RETIRED; retired
records and their history stay readable forever.

**Versions make RETIRED safe.** The reconciliation rejected RETIRED because a re-used marketId could revive an
orphaned executor (DESIGN-REVIEW §2.2, decision 1). The ledger requires RETIRED (Q112); with the version in the id, a
relisted pair gets a new id, hook, executor and pool, and the old executor reads RETIRED forever and refuses every
call. This supersedes decision 1.

**Official** means, all from chain state: `statusOf(id) != None` on the registry named in
`deployments/unica-v4/<chainId>.json`; `marketIdOfHook(hook)`, `marketIdOfExecutor(executor)` and
`marketIdOfPool(poolId)` all equal `id`; the hook is the factory's CREATE2 of code hashing to
`HOOK_CREATION_CODE_HASH`. **Not official, and always possible (A1):** a pool on the same pair with no hook or another
hook (the still-live frozen hook admits TSLA/uTUSD at every fee tier). Consumers resolve pools only through the
registry, never by token pair; what is impossible is a second pool naming a UNICA v4 hook. **Emitter authentication
(C6):** anyone can deploy the same hook source through their own factory and emit receipts with an official marketId,
so a consumer accepts a `SettlementReceipt` only when `log.address == getMarket(marketId).hook`, and `Settled` only
from `getMarket(id).executor`. Row S1 deploys such a look-alike and proves all three reverse lookups return zero for
it.

## 4. Roles and permissions

The ledger's separate roles (Q62, Q63, Q65, Q70) supersede the reconciliation's single EOA (decision 10).

| Role | Who | Can call | Can never |
|---|---|---|---|
| ADMIN (`registry.admin`) | 46630: the deployer EOA `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73` (source: `docs/experimental/STOCK-46630-DEPLOY-PLAN.md`). Mainnet: a fresh deployer EOA until `transferAdmin` → the Safe's `acceptAdmin` (Q101); the Safe is **NOT READY** (Q64). | `factory.createMarket`, `initializeMarket`, `markSeeded`; `registry.activate`, `pause`, `unpause`, `retire`, `tightenOraclePolicy`, `tightenCaps`, `setOrderCreator`, `setPauser`, `transferAdmin` | move, pull, approve or freeze any user's tokens; redirect a settlement; edit or cancel an order; change a market's tokens, rate, opening price, fee, spacing, hook, executor, oracle adapter or feed; loosen an oracle policy or a cap; replace the factory or registry; swap through a market pool |
| Pending admin | the address named in `transferAdmin` | `registry.acceptAdmin` only | anything before accepting |
| PAUSER (`registry.pauser`) | set by ADMIN; zero means none. Mainnet key **NOT READY** (Q70). | `registry.pause(id)` | unpause, retire, or anything else |
| Order creator | the registry allowlist; ADMIN is implicitly one | `executor.createOrder` on an ACTIVE market | pay an order it did not name itself as payer of |
| Payer | exactly the address an order names | `executor.pay(orderId)` for that order | pay any other order (`WrongPayer`) |
| Factory | `registry.FACTORY` (immutable) | `registry.register`, `recordInitialized`, `recordSeeded`; is the only initialiser any UNICA v4 hook accepts | own anything; it reads `REGISTRY.admin()` at call time, so an admin transfer takes effect everywhere at once |
| Hook, executor | per-market instances | no admin, no setters | — |

In a two-step transfer the old admin keeps every power until `acceptAdmin` and loses all after, the implicit creator
right included. **ADMIN cannot move funds, by construction:** the registry and factory have no token calls; the executor's only pull is
`transferFrom(msg.sender, …)` inside `pay`, reachable only by the order's payer; `take` pays `order.recipient` only;
there is no sweep. **Outside UNICA v4** (threat-model lines, not ADMIN powers): the LP owning the PositionManager NFT;
the payout token's minter; the PoolManager owner, who can set a protocol fee at any time (A9); a stock token's beacon
owner, who can upgrade or pause it (A7, A8).

## 5. Lifecycle

Stored as `uint8`: None 0, PROPOSED 1, INITIALIZED 2, SEEDED 3, ACTIVE 4, PAUSED 5, RETIRED 6 (Q112). `OracleCondition`
(`OK`, `DEMONSTRATION_ONLY`, `STALE_ORACLE`, `MARKET_CLOSED`) is a computed view result returned by `oracleCondition()`,
never stored (§8.2).

| # | Transition | Caller | Checked on-chain |
|---|---|---|---|
| 1 | None → PROPOSED | `factory.createMarket` (ADMIN) | code hash; config validity (§7); `liveMarketOf[asset][payout] == 0`; `version == latestVersion + 1`; oracle policy valid, and enabled if `REQUIRE_ORACLE`; caps non-zero; predicted hook bits; CREATE2 landed |
| 2 | PROPOSED → INITIALIZED | `factory.initializeMarket` (ADMIN) | the hook admits only the factory and only `POOL_ID`; returned tick == `initTick` |
| 3 | INITIALIZED → SEEDED | `factory.markSeeded` (ADMIN) | depth at the opening tick ≥ `minDepth` > 0; seed payout-equivalent ≤ `maxSeedPayout` (§7) |
| 4 | SEEDED → ACTIVE | `registry.activate` (ADMIN) | status only. Activation follows readback (Q115): the script refuses to send it until the stage readback passes. |
| 5 | ACTIVE → PAUSED | `registry.pause` (ADMIN or PAUSER) | status only |
| 6 | PAUSED → ACTIVE | `registry.unpause` (ADMIN only) | status only |
| 7–11 | PROPOSED, INITIALIZED, SEEDED, ACTIVE or PAUSED → RETIRED | `registry.retire` (ADMIN) | status is not None or RETIRED; clears `liveMarketOf` |

Every other pair reverts `WrongMarketStatus` or `UnknownMarket`; row R4 walks all 49. RETIRED is terminal. **Gating:**
`createOrder` and `pay` require ACTIVE (`MarketNotActive`). Nothing is trapped: orders hold no tokens and input is
pulled only inside `pay`. Open orders survive a pause and are payable after unpause if unexpired, never on a RETIRED
market. No swap precedes ACTIVE, since only the executor swaps. Liquidity is never gated (no liquidity flags), so the
LP can always exit, subject to the issuer's own pause (A8).

## 6. UnicaMarketRegistry

**Purpose.** The discovery root and the on-chain answer to "is this an official UNICA v4 market": write-once records,
lifecycle, per-market oracle policy and caps, roles, reverse lookups. No tokens, no token code. **Constructor**
`(address admin_, bool requireOracle_)`, run only inside the factory's constructor, so `FACTORY = msg.sender`;
`ZeroAddress` on a zero admin. **Immutables:** `FACTORY`; `REQUIRE_ORACLE`, true for every mainnet deployment and
false only for the 46630 rehearsal (the script refuses false on any other chain id). **Constants** (product-safety
bounds, not chain constants): `MAX_ORACLE_AGE = 300` s, the on-chain ceiling for this release (S4): `register` and
`tightenOraclePolicy` enforce it for every policy, including one an ADMIN sends directly, and a market may configure
an equal or stricter value; the chain helper's own `maxAge > 300` refusal (SO §12.2 step 7) is a second layer, never
the only one. `MAX_DEVIATION_BPS = 300`, the hard ceiling (S4; the ledger's rec 26 default of 200 bps is set per
market, inside it). Neither ceiling is open for confirmation; a longer crypto `maxAge` needs a ledger amendment and a
new release, not a helper exception. `PAGE_LIMIT = 100`. Storage, then
external functions (views are in §13):

| Slot | Written by | Why |
|---|---|---|
| `admin`, `pendingAdmin` | constructor and `acceptAdmin`; `transferAdmin` sets pending, `acceptAdmin` clears it | two-step transfer only |
| `pauser`, `isOrderCreator[a]` | `setPauser`, `setOrderCreator` (ADMIN) | the pause-only role (zero is none); the allowlist (Q31, Q35, Q111) |
| `_markets[id]` identity and pricing: `asset, payout, version, hook, executor, poolId, rateE18, initSqrtPriceX96, initTick, fee, tickSpacing, assetDecimals, payoutDecimals, assetIsCurrency0, demonstrationOnly, proposedAt` | `register` (FACTORY), once | never rewritten, so nothing can re-point a market |
| `_markets[id].status, updatedAt` | `recordInitialized`, `recordSeeded` (FACTORY); `activate`, `pause`, `unpause`, `retire` (roles in §5) | the lifecycle |
| `_markets[id].seedDepth` | `recordSeeded` (FACTORY), once | point-in-time seed proof |
| `_policy[id]` = `OraclePolicy{address adapter; bytes32 feedId; uint48 maxAge; uint16 maxDeviationBps; bool enabled}` | `register` (FACTORY); `maxAge` and `maxDeviationBps` only lowered by `tightenOraclePolicy` (ADMIN) | tighten-only; loosening, disabling or a new adapter or feed needs RETIRE and a new version |
| `_caps[id]` = `Caps{uint128 maxPerTxPayout; uint128 maxPerDayPayout; uint128 maxSeedPayout}` | `register` (FACTORY); per-tx and per-day only lowered by `tightenCaps` (ADMIN) | caps in payout-token units (Q5–Q7) |
| `_ids`; `latestVersion[asset][payout]`; `liveMarketOf[asset][payout]` | `register` (append-only; +1; sets), `retire` clears `liveMarketOf` | pagination in registration order; versioning; one non-retired market per pair |
| `marketIdOfHook`, `marketIdOfExecutor`, `marketIdOfPool` | `register`, write-once | emitter and pool authentication (C7) |

| Function | Access | Precondition, effect |
|---|---|---|
| `transferAdmin(next)` / `acceptAdmin()` | ADMIN / `pendingAdmin` | `next != 0` / moves admin, clears pending; no renounce exists |
| `setPauser(p)`, `setOrderCreator(a, allowed)` | ADMIN | `p` any (zero disables); `a != 0` |
| `activate`, `pause`, `unpause`, `retire` `(bytes32 id)` | per §5 | the §5 transitions; a second pause reverts, so a watcher sees the state it acted on |
| `tightenOraclePolicy(bytes32 id, uint48 maxAge, uint16 maxDeviationBps)` | ADMIN | not RETIRED; policy enabled; `0 < new ≤ current` for both, at least one strictly lower |
| `tightenCaps(bytes32 id, uint128 maxPerTx, uint128 maxPerDay)` | ADMIN | not RETIRED; `0 < new ≤ current` for both, `maxPerTx ≤ maxPerDay`, at least one strictly lower |
| `register(bytes32 id, Market m, OraclePolicy p, Caps c)` | FACTORY | status None; `id` recomputed from `(block.chainid, address(this), m.asset, m.payout, m.version, p.adapter, p.feedId)` and required to equal the caller's argument (S8, §3); `liveMarketOf == 0`; `m.version == latestVersion + 1`; policy valid (below, includes the route check); caps `0 < maxPerTx ≤ maxPerDay`, `maxSeed > 0`; writes everything; status PROPOSED |
| `recordInitialized(bytes32 id)`, `recordSeeded(bytes32 id, uint128 depth)` | FACTORY | PROPOSED → INITIALIZED; INITIALIZED → SEEDED, storing `seedDepth` |

A policy is valid when (a) `enabled`, `adapter` has code else `OracleAdapterNoCode`, `0 < maxAge ≤ MAX_ORACLE_AGE` else
`OracleMaxAgeOutOfRange`, `0 < maxDeviationBps ≤ MAX_DEVIATION_BPS` else `OracleDeviationOutOfRange`, and
`IUnicaOracleRoute(adapter).feedIdFor(m.asset, m.payout) == feedId` else `OracleFeedMismatch(id, expected, actual)`
(S8, §10); or (b) `!enabled` with every field zero (`adapter == 0`, `feedId == 0`) and `REQUIRE_ORACLE` false, which
sets `demonstrationOnly = true`, else `OraclePolicyMalformed`. Under `REQUIRE_ORACLE`, (b) reverts
`OraclePolicyRequired`.

**Events** (topics pinned by row R10 at implementation). `MarketProposed(bytes32 indexed marketId, address indexed
asset, address indexed payout, uint32 version, address hook, address executor, bytes32 poolId, uint24 fee, int24
tickSpacing, uint256 rateE18, uint160 initSqrtPriceX96, int24 initTick, bool demonstrationOnly)`;
`MarketStatusChanged(bytes32 indexed, uint8 indexed from, uint8 indexed to)` on every transition, None → PROPOSED
included; `MarketSeeded(bytes32 indexed, uint128 depthAtOpeningTick)`; `OraclePolicySet(bytes32 indexed, address
adapter, bytes32 feedId, uint48 maxAge, uint16 maxDeviationBps, bool enabled)` and `CapsSet(bytes32 indexed, uint128
maxPerTx, uint128 maxPerDay, uint128 maxSeed)` at register and every tighten; `OrderCreatorSet`, `PauserSet`,
`AdminTransferStarted`, `AdminTransferred`, each with indexed addresses.

**Errors.** This registry catalogue, and the hook's in §8.3, are the one home for every UNICA v4 policy and cap
error; `SPEC-ORACLE-AND-CHAINS.md` cites them rather than restating them. `NotFactory`, `NotAdmin`, `NotPauser`,
`NotPendingAdmin` (each with the caller), `ZeroAddress()`, `MarketExists(bytes32)`, `LiveMarketExists(bytes32 live)`,
`WrongVersion(uint32 expected, uint32 got)`, `UnknownMarket(bytes32)`, `WrongMarketStatus(bytes32, uint8 actual)`,
`OraclePolicyRequired(bytes32)`, `OraclePolicyMalformed(bytes32)`, `OracleAdapterNoCode(bytes32, address)`,
`OracleFeedMismatch(bytes32, bytes32 expected, bytes32 actual)`, `OracleMaxAgeOutOfRange(bytes32, uint48)`,
`OracleDeviationOutOfRange(bytes32, uint16)`, `OraclePolicyDisabled(bytes32)`, `OraclePolicyNotTighter(bytes32)`,
`CapsNotTighter(bytes32)`, `CapsInvalid(bytes32)`.

## 7. UnicaMarketFactory

**Purpose.** The only way a market comes to exist and the only initialiser any UNICA v4 hook accepts. It validates a
configuration, reads decimals and ordering on-chain, computes the opening price on-chain, CREATE2-deploys the hook
from calldata checked against a pinned hash, registers, initialises the pool at the recorded price, and proves SEEDED
from PoolManager state. No storage, no token code, no owner of its own. **Constructor** `(address admin_, IPoolManager
poolManager_, bytes32 hookCreationCodeHash_, bool requireOracle_)`, every value from `config/chains/<chainId>.json`
and the build (no chain constant); `ZeroAddress`/`ZeroHash` on zeros; the body runs `REGISTRY = new
UnicaMarketRegistry(admin_, requireOracle_)`. **Immutables:** `POOL_MANAGER`, `REGISTRY`, `HOOK_CREATION_CODE_HASH`
(of `type(UnicaMarketHook).creationCode`, pinned build, B10); constant `HOOK_FLAGS = 0x20C0`. **Input:**
`MarketConfig{asset; payout; uint256 rateE18; uint24 fee; int24 tickSpacing; OraclePolicy policy; Caps caps}`,
`rateE18` being whole payout per whole asset × 1e18.

| Function | Access | Checks, in order | Result |
|---|---|---|---|
| `createMarket(MarketConfig c, bytes32 salt, bytes calldata hookCreationCode) returns (bytes32 marketId, address hook, address executor)` | ADMIN | (a) `keccak256(hookCreationCode) == HOOK_CREATION_CODE_HASH` else `WrongHookCode`; (b) `previewMarket(c)`; (c) `predicted & 0x3FFF == 0x20C0` else `HookFlagsWrong(predicted)`, before any code is deployed; (d) CREATE2 lands at `predicted` else `HookDeployFailed` (BaseHook's constructor re-validates the bits); (e) `executor = hook.EXECUTOR()`; (f) `REGISTRY.register(...)`, which re-checks version, liveness, policy and the route (`marketId` recompute and `feedIdFor`, S8, §3, §6) | PROPOSED |
| `initializeMarket(bytes32 id) returns (int24 tick)` | ADMIN | PROPOSED; `POOL_MANAGER.initialize(poolKeyOf(id), initSqrtPriceX96)`; returned tick `== initTick` else `OpeningTickMismatch` | INITIALIZED |
| `markSeeded(bytes32 id, uint128 minDepth) returns (uint128 depth)` | ADMIN | INITIALIZED; `minDepth > 0`; depth at the opening tick ≥ `minDepth` else `SeedTooShallow`; seed payout-equivalent ≤ `maxSeedPayout` else `SeedAboveCap` | SEEDED |
| `previewMarket(MarketConfig c) view returns (bytes32 marketId, uint32 version, bytes hookArgs, Market m)` | anyone | refuses `SameToken`; `NoCode` at either token; `DecimalsUnreadable` (not a 32-byte return, or above 18); `FeeTierUnsupported` unless `(fee, tickSpacing)` is one of (500, 10), (3000, 60), (10000, 200); `RateOutOfRange` (zero, above 1e36, or an opening tick outside the usable range) | — |
| `poolKeyOf(bytes32 id) view returns (PoolKey)` | anyone | — | — |

**Fee tiers.** The allowlist answers A12 (a fee near 100% would list a market that turns input into fees) and A13
(spacing 1 makes an oversized order walk 2,621 bitmap words before `PartialFill`; 263 at spacing 10). **Hook
arguments:** `abi.encode(POOL_MANAGER, REGISTRY, marketId, asset, payout, fee, tickSpacing, assetDecimals,
payoutDecimals)`, 288 bytes (the design's 224 plus the decimals the oracle check needs); `previewMarket` is the one
implementation and salts are mined against exactly these bytes. Publishing a salt early is safe:
`PoolManager.initialize` naming the still-empty predicted address reverts `InvalidHookResponse` (A5; row F18, and
`NotMarketFactory` for a stranger after creation). **Opening price** (`UnicaMarketMath`, DESIGN-REVIEW §2.1): RATE
rounded onto the grid so payout per asset never exceeds RATE and sits within one grid step of it, with the exact
"perfect tick" flag on the currency1 branch; direction is derived as `asset < payout`. The TSLA shape opens at tick
−216540, 394.691222 uTUSD per TSLA against RATE 395 (prototype).

**Seed proof and seed cap.** Depth is read through `StateLibrary`, never from a position: asset currency0 → `L_active
− liquidityNet(initTick)`; asset currency1 → `L_active`; narrowed with `SafeCast` (A10). A seed short of the opening
tick has depth 0 and is refused. The payout-equivalent is what `depth` holds across the designed range `[initTick −
W, initTick]` (or its mirror for the other ordering), `W = UnicaMarketMath.seedWidth(tickSpacing, policy)` on the
payout side of the opening tick; the script mints with the same function, so the range has one implementation, and is
recorded as `tickLower` and `tickUpper` in the market configuration file and the deployment manifest — readback
asserts the seed position's ticks and the on-chain recomputation of `W` both equal the recorded values (S6).
Demonstration markets: `W = ceil(6960 / spacing) × spacing`, the frozen range. Oracle markets: the largest multiple of
spacing with `1.0001^(W + tickSpacing) ≤ 1 + maxDeviationBps / 10⁴` (one step reserved for rounding), so the whole
seed trades inside the band (§8.3); `W = 120` at 200 bps and spacing 60. **Limits:** the on-chain seed cap bounds only
a mis-sized seed inside `W`, not what is at risk: a seed spread wider than `W` holds more than the check counts, it is
checked once, and liquidity added after SEEDED is never gated by this cap (§5) — though no deployment tool has a path
that adds liquidity to a market at or after SEEDED, and a live market is never reseeded, widened or recentred (S6);
third-party depth can only make `markSeeded` refuse; SEEDED is point-in-time, so a withdrawn seed makes settlement
fail safe until someone pauses. Per-transaction, per-day and per-market seed caps are enforced on-chain (§6, §9.2);
the $100 total at risk across markets sharing a payout token is a deployment-script and manifest refusal, documented
as an operational deployment gate, and is never described as enforced on-chain (S5): every deployment enumerates and
sums all registered markets' `maxSeedPayout` before proceeding, and any inability to enumerate or verify the complete
market set fails closed.

**Errors.** `NotAdmin(address)`, `ZeroAddress()`, `ZeroHash()`, `WrongHookCode(bytes32)`, `SameToken(address)`,
`NoCode(address)`, `DecimalsUnreadable(address)`, `FeeTierUnsupported(uint24, int24)`, `RateOutOfRange(uint256)`,
`HookFlagsWrong(address)`, `HookDeployFailed()`, `OpeningTickMismatch(int24, int24)`, `WrongMarketStatus`,
`ZeroMinDepth()`, `SeedTooShallow(bytes32, uint128, uint128)`, `SeedAboveCap(bytes32, uint256, uint128)`. No events.

## 8. UnicaMarketHook

**Purpose.** One source, one instance per market, at a factory-CREATE2 address whose low 14 bits are exactly `0x20C0`:
one pool, from the factory only; only its executor swaps; the in-flight order is checked before the swap, the fill,
minOut and the oracle bound after it; it emits the receipt. No admin, no setters, no return-delta flags, fee
override 0. **Constructor** `(IPoolManager poolManager_, address registry_, bytes32 marketId_, address asset_, address payout_,
uint24 fee_, int24 tickSpacing_, uint8 assetDecimals_, uint8 payoutDecimals_) BaseHook(poolManager_)`, built only by
the factory's CREATE2 (`FACTORY = msg.sender`); it computes `POOL_ID`, then `EXECUTOR = address(new
UnicaMarketExecutor(poolManager_, registry_, marketId_, asset_, payout_, fee_, tickSpacing_))`, i.e. `CREATE(hook, 1)`
(a new contract's nonce starts at 1, EIP-161); BaseHook reverts unless all 14 permission bits match. **Immutables:**
`poolManager`, `FACTORY`, `REGISTRY`, `MARKET_ID`, `ASSET_TOKEN`, `PAYOUT_TOKEN`, `FEE`, `TICK_SPACING`,
`ASSET_DECIMALS`, `PAYOUT_DECIMALS`, `ASSET_IS_CURRENCY0`, `POOL_ID`, `EXECUTOR`, `REQUIRE_ORACLE` (§8.2); constant
`HOOK_FEE_PIPS = 0`.
**Storage:** `receiptCount`, written only in `_afterSwap`. **Transient:** `swapped[orderId]`, written only in
`_afterSwap`, refusing a second swap of one order per transaction.

### 8.1 Callbacks (BaseHook's `onlyPoolManager`, else `NotPoolManager`)

| Callback | Checks | Returns |
|---|---|---|
| `beforeInitialize(sender, key, sqrtPriceX96)` | `sender == FACTORY` else `NotMarketFactory(sender)`; `key.toId() == POOL_ID` else `NotTheMarketPool(id)` (unreachable through the factory; unit-tested with the test contract as factory) | selector |
| `beforeSwap(sender, key, params, hookData)` | `sender == EXECUTOR` else `NotSettlementExecutor`; `hookData.length == 32` else `MalformedHookData`; `order = EXECUTOR.orders(orderId)` (a `view`, so a STATICCALL) is `Paying` else `OrderNotInFlight`; not swapped this transaction else `OrderAlreadySwapped`; `deadline ≥ now` else `OrderExpired`; `params.zeroForOne == ASSET_IS_CURRENCY0` and `amountSpecified == −amountIn` else `ParamsDoNotMatchOrder` | selector, `ZERO_DELTA`, 0 |
| `afterSwap(sender, key, params, delta, hookData)` | `_checkFill`: consumed `== amountIn` else `PartialFill`; produced `≥ minOut` else `OutputBelowMinimum`. `_checkOracle` (§8.2). `_emitReceipt` (§11): marks swapped, increments `receiptCount`, emits. Split in three because the legacy code generator hit "stack too deep" in one function; via-IR is not an option, since it would change the frozen contracts' bytecode too. | selector, 0 |
| every other callback | not flagged; BaseHook's `HookNotImplemented` | — |

No per-swap `POOL_ID` check (cut 5): one key is admitted, and the executor rebuilds its key from identical immutables
(A4). The flag set is enforced three times — mining loop, factory pre-check, BaseHook constructor;
`isValidHookAddress` is only a consistency check (A2). **Invariant (A4):** the hook never calls
`PoolManager.initialize`, `swap`, `unlock`, `modifyLiquidity` or `donate`, since the PoolManager skips a hook's own
callbacks when the hook is the caller; row H14 pins the external ABI and is sabotaged by adding a function. **Views:**
`getHookPermissions()`, `feeRates() returns (lpFee, protocolFee, swapFee)` for the market's direction,
`oracleCondition()`, `receiptCount()`, every immutable.

### 8.2 Oracle enforcement — fail closed

`_checkOracle` runs on every swap: an enabled policy takes steps 1 to 5, a disabled one the rule below. Any failure reverts the whole settlement with a named error: the payer
keeps the input, the merchant receives nothing, no receipt survives.
1. `p = REGISTRY.oraclePolicyOf(MARKET_ID)`, read live, so a tightening binds the next swap.
2. `IUnicaOracleRoute(p.adapter).feedIdFor(ASSET_TOKEN, PAYOUT_TOKEN) == p.feedId`, a STATICCALL, run before
   `latestPrice`, else `OracleFeedMismatch(MARKET_ID, expected, actual)` — the same check `register` already made,
   repeated on every swap because an adapter is not re-verified after deployment (S8, §3, §6, §10).
3. `(price, dec, updatedAt) = IUnicaPriceOracle(p.adapter).latestPrice(ASSET_TOKEN, PAYOUT_TOKEN)`, a STATICCALL (the
   interface is `view`), so it cannot re-enter or change a protocol fee (A14). `_checkOracle` does not catch a revert
   here: it propagates, and the PoolManager wraps it as `WrappedError(address hook, bytes4 selector, bytes reason,
   bytes details)`; tests decode the inner adapter selector (`SequencerDown`, `SequencerGracePeriod`, `MarketClosed`,
   `PairNotSupported`, or a push-then-read error, SO §5, §7–§9). The sequencer check is the adapter's, since the
   interface returns three values (§10). Only the view `oracleCondition()` below uses try/catch.
4. `price > 0` (`OraclePriceZero`); `updatedAt ≤ now` (`OracleTimestampInFuture`); `updatedAt != now`
   (`OracleTimestampNotBeforeBlock`) — a source that stamps the current block makes every age zero, so it is refused
   at the cost of one retry by the payer; `now − updatedAt ≤ maxAge` (`OracleStale`); `dec ≤ 18`
   (`OracleDecimalsUnsupported`, S4); `price ≤ type(uint128).max` and `price · 10^PAYOUT_DECIMALS /
   10^(ASSET_DECIMALS + dec) ≤ type(uint128).max` (both `OraclePriceOutOfRange`, SO §4.1's bound), each checked
   before any multiplication so an absurd price refuses by name, never by a bare panic.
5. The band, in raw payout-token output units, homed in SO §4.2: with `a = amountIn`, `f = swapFeePips`, `p = price`,
   `dP = PAYOUT_DECIMALS`, `dA = ASSET_DECIMALS`, `dO = dec`, and the pool fee divided out explicitly with the same
   `slot0` read the receipt uses, `refOutFloor = mulDiv(a · (10⁶ − f), p · 10^dP, 10^(6 + dA + dO))` (rounded down)
   and `refOutCeil` its rounding-up twin; `minAllowed = mulDivRoundingUp(refOutCeil, 10,000 − maxDeviationBps,
   10,000)` and `maxAllowed = mulDiv(refOutFloor, 10,000 + maxDeviationBps, 10,000)`. Settlement passes if and only
   if `minAllowed ≤ produced ≤ maxAllowed`, inclusive on both sides, each side rounded against acceptance; otherwise
   `ExecutionBelowOracleBand(marketId, produced, minAllowed)` or `ExecutionAboveOracleBand(marketId, produced,
   maxAllowed)`. `produced == minAllowed` and `produced == maxAllowed` pass; one raw unit beyond either fails — S4
   calls 300 bps a ceiling, so a value exactly on the bound is within tolerance, and THREAT-MODEL's earlier
   "a tie at the boundary refuses" is superseded. `amountIn, produced < 2^127` (`AmountTooLarge`), so every operand
   fits before `mulDiv`'s 512-bit step.

Disabled policy: the hook does not rely on the registry's validation alone. Its constructor reads
`REGISTRY.REQUIRE_ORACLE()` into the immutable `REQUIRE_ORACLE`, and `_checkOracle` reverts
`OraclePolicyRequired(marketId)` on a disabled policy when it is true; a registry mutant that skips the `register`
policy check must be killed by this row. Otherwise (only when `REQUIRE_ORACLE` is false): no call; reference fields
zero, `demonstrationOnly = true`.

**`oracleCondition() returns (OracleCondition condition, bytes4 reason, uint256 price, uint8 decimals, uint256
updatedAt)`** (SO §6), `enum OracleCondition { OK, DEMONSTRATION_ONLY, STALE_ORACLE, MARKET_CLOSED }`:
`registry.statusOf(id)` is read first — PAUSED and RETIRED override any oracle condition — then, for a live market,
`condition` is `DEMONSTRATION_ONLY` when the policy is disabled, `MARKET_CLOSED` when the adapter reverts
`MarketClosed`, `STALE_ORACLE` on any other adapter revert, a zero price, a future timestamp, a timestamp not before
the block, or an age above `maxAge`, and otherwise `OK`; `reason` carries the caught selector (zero when `OK`).
Neither is stored, and this view is the only caller that catches the adapter's revert (step 3 above never does). A
push feed has no market-status field, so `ChainlinkFeedAdapter` can only produce `STALE_ORACLE`
(CHAINLINK-AVAILABILITY §6). Deviation is per swap, not a condition.

### 8.3 What the bound means when only the executor can swap

Only the executor swaps, only asset → payout: the pool price moves only down, only by payments, never back towards the
oracle. There is no arbitrage path, and two consequences follow.
- **A market stops when the oracle leaves the band**, in either direction; every settlement then fails closed. The
  rate is write-once, so the remedy is RETIRE and a new version at a new rate. The 46630 demonstration market has no
  oracle and is unaffected.
- **Each payment spends band.** ESTIMATE by hand from the constant-liquidity range formula: a $100 seed over the
  frozen ~2× range executes a $10 payment on average about 2.9% below the opening price, beyond the 200 bps default;
  hence the band-width seed of §7, where the same payment moves about 0.1%. Row O26 measures it: the maximum payment
  on the maximum seed passes at the configured bps, and repeated payments halt with a band error
  (`ExecutionBelowOracleBand` or `ExecutionAboveOracleBand`, §8.2 step 5) exactly at the band. The script refuses a
  configuration whose estimated per-transaction impact plus one grid step exceeds `maxDeviationBps`.

**Errors.** `NotMarketFactory(address)`, `NotTheMarketPool(bytes32)`, `NotSettlementExecutor(address)`,
`MalformedHookData(uint256)`, `OrderNotInFlight(bytes32, uint8)`, `OrderAlreadySwapped(bytes32)`,
`OrderExpired(bytes32, uint64)`, `ParamsDoNotMatchOrder(bytes32)`, `PartialFill(bytes32, uint128, uint128)`,
`OutputBelowMinimum(bytes32, uint128, uint128)`, `OraclePolicyRequired(bytes32)`,
`OracleFeedMismatch(bytes32, bytes32 expected, bytes32 actual)`, `OraclePriceZero(bytes32)`,
`OracleDecimalsUnsupported(bytes32, uint8)`, `OraclePriceOutOfRange(bytes32, uint256)`,
`OracleTimestampInFuture(bytes32, uint256 updatedAt)`, `OracleTimestampNotBeforeBlock(bytes32, uint256 updatedAt)`,
`OracleStale(bytes32, uint256 age, uint48 maxAge)`, `ExecutionBelowOracleBand(bytes32, uint256 out, uint256
minAllowed)`, `ExecutionAboveOracleBand(bytes32, uint256 out, uint256 maxAllowed)`; BaseHook's `NotPoolManager`,
`HookNotImplemented`. The PoolManager wraps any hook revert as `WrappedError`; tests unwrap the inner selector and
check the emitter.

## 9. UnicaMarketExecutor

**Purpose.** One instance per market, created by its hook; the only address the hook lets swap. It takes the
PoolManager lock itself (no router), so the hook's `sender` is established by the PoolManager, not reported. It pulls
exactly `amountIn` from the order's named payer, swaps exact-input, settles, takes the payout straight to the
recipient, measures delivery and accounts it against the caps. No admin, no sweep, no balance at rest. **Constructor**
`(IPoolManager poolManager_, address registry_, bytes32 marketId_, address asset_, address payout_, uint24 fee_, int24
tickSpacing_)`, 224 bytes that verification must supply; run only by the hook's constructor, so `HOOK = msg.sender`.
**Immutables:** `POOL_MANAGER`, `HOOK`, `REGISTRY`, `MARKET_ID`, `ASSET_TOKEN`, `PAYOUT_TOKEN`, `FEE`, `TICK_SPACING`,
`ASSET_IS_CURRENCY0`; the PoolKey is rebuilt from them. **Storage:** `_orders[orderId] = Order{recipient; creator;
payer; uint128 amountIn; uint128 minOut; uint64 deadline; OrderStatus status}` (None 0, Open 1, Paying 2, Settled 3,
the frozen numbering), written whole once by `createOrder`, then only its `status` by `pay`; `orderCount` by
`createOrder`; `payoutUsedOnDay[utcDay]` by `pay` after delivery is measured; transient `LOCK_SLOT`, the reentrancy
latch.

### 9.1 Functions

**`createOrder(address recipient, address payer, uint128 amountIn, uint128 minOut, uint64 deadline, bytes32 salt)
returns (bytes32 orderId)`** — `REGISTRY.executionTermsOf(MARKET_ID)` status ACTIVE (`MarketNotActive`);
`canCreateOrders(msg.sender)` (`NotOrderCreator`); `recipient != 0` (`ZeroRecipient`) and not in {this, `HOOK`,
`POOL_MANAGER`, `ASSET_TOKEN`, `PAYOUT_TOKEN`, `REGISTRY`, `REGISTRY.FACTORY()`} (`ReservedRecipient`; the factory
added per A16); `payer != 0` (`ZeroPayer`; payer-bound only, Q111, Q128); `amountIn, minOut > 0` (`ZeroAmount`,
`ZeroMinOut`) and `≤ uint128(type(int128).max)` (`AmountTooLarge`, A11); `minOut ≤ maxPerTxPayout` (`OrderAboveCap`);
`deadline > now` (`DeadlineInPast`), with no ceiling (cut 9); `orderId = keccak256(abi.encode(block.chainid,
address(this), msg.sender, salt))` unused (`OrderExists`). Emits `OrderCreated`.

**`pay(bytes32 orderId)`**, in order:
1. Latch free (`Reentered`); ACTIVE (`MarketNotActive`); order exists (`UnknownOrder`), Open (`OrderNotOpen`),
   unexpired (`OrderExpired`); `msg.sender == order.payer` (`WrongPayer(id, payer, caller)`); allowance `≥ amountIn`
   (`AllowanceTooLow`).
2. Status Paying before any external call; snapshot the executor's two balances, the recipient's payout balance and
   `HOOK.receiptCount()`.
3. `transferFrom(msg.sender, this, amountIn)`, measured equal to `amountIn` (`InputNotExact`: fee-on-transfer and
   rebasing input refused).
4. `POOL_MANAGER.unlock` → `unlockCallback` (only the PoolManager, `NotPoolManager`; order Paying,
   `OrderNotInFlight`): `swap(key, ASSET_IS_CURRENCY0, −amountIn, extreme limit, hookData = orderId)`; `sync(asset)`,
   transfer, `settle()` with credit `== amountIn` (`SettlementDidNotClose`); `take(payout, order.recipient, out)`.
5. Exactly one new receipt (`NoReceipt`); recipient delta `≥ minOut` (`RecipientShort`) and `== out`, the output
   taken from the pool (`DeliveryNotExact`: a payout token that does not move exactly `out`, or any debit of the
   recipient's payout balance while the manager is unlocked, refuses); executor balances unchanged
   (`ExecutorResidualInput`, `ExecutorResidualPayout`).
6. Caps, on `out` (equal to the receipt's `amountOut` and, by step 5, to the delivery): `out ≤ maxPerTxPayout`
   (`PaymentAboveCap`); `payoutUsedOnDay[day] + out ≤ maxPerDayPayout` (`DailyCapExceeded`); store the total.
7. Status Settled; emit `Settled`, the success signal.

**Views:** `orders(bytes32)` (declared `view`, so the hook's read is a STATICCALL, A14), `orderCount()`, `poolKey()`,
`payoutUsedOnDay(uint256)`, `remainingToday() returns (uint256 perDayLeft, uint128 perTx)`.

### 9.2 Caps accounting

Units are payout-token base units, per market, set at `createMarket` from configuration. The beta values (Q5–Q7), $10
per transaction, $25 per day, $100 at risk, are 10,000,000 / 25,000,000 / 100,000,000 for a 6-decimal stablecoin; on
46630 the same numbers bound uTUSD, which has no real-world value, and only exercise the mechanism. **What counts:**
the pool's output `out`, which §9.1 step 5 requires to equal the delivery measured at the recipient; never `minOut` or
`amountIn`, and only inside a `pay` that settles (a refusal unwinds the increment). **The day:** `block.timestamp /
86400`, so days turn at 00:00 UTC and a new day starts at zero without a write. A calendar day is not a rolling window:
up to 2 × `maxPerDayPayout` can settle within seconds either side of midnight, a residual this file accepts and does
not hide. **One version only:** `payoutUsedOnDay` is executor storage, so a RETIRE and relist in mid-day (the §8.3
remedy, and the only way to raise a cap, §15 item 3) starts the new version at zero; the per-day cap binds one version,
not the pair. Keeping usage per (asset, payout, UTC day) in the registry would close it; that is an owner choice. **Checked twice:** `minOut ≤ maxPerTx` at creation, so no unsettleable order exists, and the measured
delivery at `pay`. **Read live:** `tightenCaps` binds the next payment; tightening below an open order's floor makes
it unpayable, which fails closed and traps nothing. The seed cap is checked once, at `markSeeded` (§7).

**Merchant settings (recs 32, 38–40), mapped onto what exists.** The merchant is the order's `recipient` address; there
is no on-chain merchant record or merchant id (rec 32). The payout configuration on-chain is the market's write-once
payout token plus the recipient each order names; one stablecoin per market (recs 38, 39). Accepted assets are the
ACTIVE markets an allowlisted creator chooses to create orders on, not a per-merchant list (recs 38, 40). Maximum
payment is the market's `maxPerTxPayout`, per market, not per merchant; there is no minimum payment; expiry is the
order's `deadline` (rec 40). The gaps are a §2 conflict: an owner scope decision, for example a deferral to v5.

### 9.3 Guards, their frozen origin, and the row that must fail without them

| Guard | Error | Frozen origin | Killer row (mutant) |
|---|---|---|---|
| payer binding | `WrongPayer` | `UnicaStockSettlementExecutor.sol` pay | X2 — wrong payer funded and approved; control: bound payer settles |
| merchant binding | `ReservedRecipient`; `take` to `order.recipient` only | createOrder | X3 |
| replay | `OrderExists`, `OrderNotOpen`, `OrderAlreadySwapped`, `NoReceipt` | createOrder, pay, hook | X4 |
| minOut, twice | `OutputBelowMinimum`, `RecipientShort` | hook afterSwap, pay | X5 — minOut from the quote at creation, then a third-party LP removes depth; boundary `actualOut` passes, `+1` fails |
| exact input, fee-on-transfer, full fill | `ParamsDoNotMatchOrder`, `InputNotExact`, `SettlementDidNotClose`, `PartialFill` | hook, pay, callback | X8, H9 |
| direct swap | `NotSettlementExecutor` | hook beforeSwap | H5 (PoolSwapTest on a seeded ACTIVE pool), H5b (raw unlock), H5c (market A's executor against market B's pool, C18) |
| creator allowlist; market ACTIVE | `NotOrderCreator`; `MarketNotActive` | new | X7 — a stranger holding asset and an approval on an ACTIVE seeded market; X6 |
| caps | `OrderAboveCap`, `PaymentAboveCap`, `DailyCapExceeded` | new | K1–K4, each at the boundary: equal passes, one base unit over fails |

Each mutant is registered in the repository's mutation suite, written fresh, and must be KILLED by its named row with
0 misattributed before any live stage (C4); each negative row reproduces the attack's precondition and pairs with a
passing control (C5). Re-entry through an issuer-controlled transfer while the PoolManager is unlocked (A6) has rows
X9a–X9d: `sync` reverts `SettlementDidNotClose`; `settleFor` leaves zero deltas (the row asserts which); `swap`
reverts `NotSettlementExecutor`; `modifyLiquidity` changes neither delivery nor receipt. **Invariant I1, restated
(A15, C3):** no UNICA v4 call changes the executor's or hook's balance of either token. A donation can; donated tokens
are unrecoverable (no sweep) and never block the next payment, because the residual checks are snapshot-relative.

**Events**, frozen shapes so frozen decoders still read them: `OrderCreated(bytes32 indexed orderId, address indexed
recipient, address indexed creator, address boundPayer, uint128 amountIn, uint128 minOut, uint64 deadline)`,
`boundPayer` now always the non-zero payer; `Settled(bytes32 indexed orderId, address indexed payer, address indexed
recipient, address currencyIn, address currencyOut, uint256 amountIn, uint256 amountDelivered)`.

**Errors.** `MarketNotActive(bytes32, uint8)`, `NotOrderCreator(address)`, `ZeroRecipient()`,
`ReservedRecipient(address)`, `ZeroPayer()`, `ZeroAmount()`, `ZeroMinOut()`, `AmountTooLarge(uint256)`,
`OrderAboveCap(uint128, uint128)`, `DeadlineInPast(uint64)`, `OrderExists(bytes32)`, `UnknownOrder(bytes32)`,
`OrderNotOpen(bytes32, uint8)`, `OrderExpired(bytes32, uint64)`, `WrongPayer(bytes32, address, address)`,
`AllowanceTooLow(address, uint256, uint256)`, `InputNotExact(uint128, uint256)`, `TransferFailed(address)`,
`SettlementDidNotClose(uint256, uint256)`, `NoReceipt(bytes32)`, `RecipientShort(bytes32, uint128, uint256)`,
`DeliveryNotExact(bytes32, uint256 out, uint256 delta)`,
`ExecutorResidualInput(uint256, uint256)`, `ExecutorResidualPayout(uint256, uint256)`, `PaymentAboveCap(uint256,
uint128)`, `DailyCapExceeded(uint256 day, uint256 used, uint128 cap)`, `Reentered()`, `NotPoolManager(address)`,
`OrderNotInFlight(bytes32, uint8)`.

## 10. Oracle interface and adapters

```solidity
interface IUnicaPriceOracle {
    /// quote per ONE whole asset, scaled by 10**decimals; updatedAt is the source's own publish time
    function latestPrice(address asset, address quote)
        external view returns (uint256 price, uint8 decimals, uint256 updatedAt);
}
```

Shared adapter rules (CHAINLINK-AVAILABILITY §8): `view`, so the hook's call is a STATICCALL; no admin, no setters,
routes fixed in the constructor from `config/chains/<chainId>.json`, so a market's (adapter, feedId) commitment cannot
drift; `updatedAt` is the source's timestamp, never arrival or block time; an unpriceable pair is a typed revert
(`PairNotSupported`), never a zero or a placeholder; every feed's `decimals()` is read live. `maxAge` and deviation
are the hook's, per market. Every adapter also implements a second, adapter-level interface, outside the fixed
`IUnicaPriceOracle` shape above:

```solidity
interface IUnicaOracleRoute {
    function feedIdFor(address asset, address quote) external view returns (bytes32 feedId); // reverts PairNotSupported
    function adapterKind() external view returns (bytes32);
}
```

`policy.feedId` is the value `feedIdFor` returns for the market's pair. It is not readback-only evidence: `register`
and every swap's `_checkOracle` (§6, §8.2) verify it on-chain (S8), and readback checks it again against the chain
configuration as additional evidence.

This release ships single-route adapters only: one instance per route, every route immutable in the constructor, no
admin. `ChainlinkFeedAdapter`, `ChainlinkStreamsAdapter` and `ChainlinkCREAdapter` each derive `feedId` from a kind
tag plus every immutable source identifier — the feed adapter's is `keccak256(abi.encode("CHAINLINK_FEED",
ASSET_FEED, QUOTE_FEED))` (SO §7.1), and Streams and CRE follow the same pattern (SO §8, §9) — and expose it through
`feedIdFor` and `adapterKind` above. Every kind carries the `SEQUENCER_FEED` and `GRACE_PERIOD` immutables and checks
them first. `ChainlinkStreamsAdapter` and `ChainlinkCREAdapter` are push-then-read: `submitReport` or `onReport`
verifies and stores a report in its own transaction, and `latestPrice` is a view over the stored report; their error
names are `VerifierFeeManagerSet`, `NoVerifiedReport` and `ReportNotYetValid` (SO §8, §9). Adapter internals, adapter
constructors and the full per-kind error catalogue are `SPEC-ORACLE-AND-CHAINS.md` §7–§9; this file states only the
shared rules above.

| Adapter | Status |
|---|---|
| `ChainlinkFeedAdapter` | **planned.** Arbitrum One carries the `eth-usd`, `usdc-usd` and sequencer-uptime feeds (source: DECISIONS.md, settled by evidence; MAINNET-CAPABILITY-PROBE.md). Deploying it is blocked by Q9 and Q132. A chain configuration for an L2 must name its sequencer feed, or state `none` with evidence; 46630 and 4663 have none (CHAINLINK-AVAILABILITY §2a). |
| `ChainlinkStreamsAdapter` | **not deployable.** Reports are paid-only (Q95 NOT PROVIDED); whether a TSLA/NFLX report verifies on the 46630 VerifierProxy is UNCONFIRMED; `lastTradedPrice` is deprecated, with removal by 2026-10-12 (CHAINLINK-AVAILABILITY §3d). Written and tested against a local verifier stand-in only. |
| `ChainlinkCREAdapter` | **not deployable.** Hosted writes to 46630 unproven, deploy access not enabled, no licensed equity source (Q23). |
| `MockOracleAdapter` | test-only, under `test/unica-v4/`, settable price and timestamp, and a mode that reverts with each named adapter error. **Tests only.** Never in `src/`, never referenced by `script/unica-v4/` or `deployments/unica-v4/`; a gate row fails if it is (rule 13). |

**On 46630 today** nothing an adapter can read exists for TSLA or NFLX, so the rehearsal registry is `requireOracle =
false`, its TSLA market `demonstrationOnly`, and every receipt says so. The oracle path is proven on a fork of a chain
that has the feeds; `MockOracleAdapter` serves local rows only.

## 11. Receipt, fee fields, and the frozen fee-discrepancy fix

The hook emits the receipt inside the swap, after every check: evidence the swap met the order's bounds. The success
signal is the executor's `Settled`, emitted after delivery is measured; one transaction means a receipt without
`Settled` cannot survive.

```
SettlementReceipt(
  bytes32 indexed orderId, address indexed recipient, address indexed payer,
  bytes32 marketId, address currencyIn, address currencyOut, uint128 amountIn, uint128 amountOut,
  uint24 hookFeePips, uint24 lpFeePips, uint24 protocolFeePips, uint24 swapFeePips,
  uint256 referencePrice, uint8 referenceDecimals, uint64 referenceUpdatedAt, bool demonstrationOnly)
```

| Field | Filled from |
|---|---|
| `currencyIn`, `currencyOut` | `ASSET_TOKEN`, `PAYOUT_TOKEN` |
| `amountIn`, `amountOut` | the pool's own delta: consumed (equal to the order's `amountIn`) and produced |
| `hookFeePips` | the constant `HOOK_FEE_PIPS = 0`. The hook structurally cannot take a fee: fee override 0, no return-delta flags. |
| `lpFeePips` | `slot0.lpFee`, via `StateLibrary.getSlot0(poolManager, POOL_ID)`, read in `afterSwap` of the same swap |
| `protocolFeePips` | the 12-bit protocol fee for this swap's direction: the low 12 bits when the asset is currency0, the high 12 bits otherwise, mirroring Uniswap v4 `Pool.sol` |
| `swapFeePips` | `protocolFee == 0 ? lpFee : ProtocolFeeLibrary.calculateSwapFee(protocolFee, lpFee)`, the same expression the PoolManager emits as `Swap.fee` |
| `referencePrice`, `referenceDecimals`, `referenceUpdatedAt` | the adapter reading the hook checked in §8.2; all zero when the oracle is off |
| `demonstrationOnly` | `!policy.enabled` from the same registry read, which equals the record's flag |

Rates, not amounts (cut 11): the fee is about `amountIn × swapFeePips / 10⁶`. The signature differs from the frozen
receipt and the design review's 12-field shape, so neither decoder can misread it; topic0 is pinned by test at
implementation. `docs/RECEIPT-SCHEMA.md` is frozen and never edited (its row 11 included); the UNICA v4 receipt is
documented under `docs/unica-v4/`: `EVENT-SCHEMA.md` §5 now, and a separate `docs/unica-v4/RECEIPT-SCHEMA.md` only if
the owner adopts SR1 row 16's proposal. **Why the read
is the applied rate:** a static-fee swap changes neither fee, dynamic fees are refused, and `setProtocolFee` (no lock
requirement) cannot run between the pool's `slot0` read and the hook's, because every external call in `afterSwap` is
a STATICCALL to a `view` (A14; a source comment ties the receipt to those declarations). The protocol fee is 0 at the
rehearsed block and the PoolManager owner can change it at any time (A9), so readback asserts equality with the same
transaction's `Swap.fee`, never constants, and the script recomputes `minOut` from `feeRates()` at send time.

### 11.1 The frozen discrepancy, and the fix

Recorded in `docs/experimental/STOCK-46630-FEE-FIELD.md`: the frozen hook emits `fee = 0` as a literal in
`_afterSwap`, meaning the hook's own fee (`docs/RECEIPT-SCHEMA.md` row 11), while the same transaction's `Swap` event
reports `fee = 3000` — the payer paid 0.000003 TSLA to liquidity. Right value, misleading name. The frozen contracts
are neither changed nor redeployed for it; the record's condition is that UNICA v4 fixes it only if a test proves the
fix. The fix is the four fee fields above; these rows prove it:

| Row | Setup | Asserts |
|---|---|---|
| H12a | default pool, protocol fee 0 | receipt `(0, 3000, 0, 3000)`; `swapFeePips == Swap.fee` in the same transaction |
| H12b | local PoolManager from the official bytecode, the test as its owner: `setProtocolFeeController(test)`, `setProtocolFee(key, 500 \| 1000 << 12)`; asset is currency0 | receipt `(0, 3000, 500, 3499)`; `swapFeePips == Swap.fee`; `protocolFeesAccrued(input)` increased, so the fee was really charged |
| H12c | the same, asset is currency1 | receipt `(0, 3000, 1000, 3997)`; the same two equalities |
| Mutant M-fee-1 | `swapFeePips` ← `lpFee` | H12b and H12c go red (`3000 != 3499`, `3000 != 3997`), as measured on the prototype |
| Mutant M-fee-2 | always read the zeroForOne half | H12c goes red (`500 != 1000`); this is why both orderings are required |

Expected values are prototype measurements (DESIGN-REVIEW §1.2, §1.3, §2), re-measured by the implementation. These
rows are on the never-drop list.

## 12. Contract size, the pinned creation code, and the constructor cycle

**The size-limit solution.** A factory that embedded the hook's creation code would carry the executor's too, since
the hook's constructor creates it: at least 30,799 bytes (DESIGN-REVIEW §1.2), over the 24,576-byte runtime limit. So
the code travels as **calldata**, accepted only if `keccak256(hookCreationCode) == HOOK_CREATION_CODE_HASH`, an
immutable fixed at the factory's construction; one hash pins both sources. Each creation code sits in exactly one
initcode and in no runtime: the registry's in the factory's, the executor's in the hook's. The hash depends on
compiler, optimizer and metadata settings; the optimizer is off by forge 1.x's default, not by a `foundry.toml` key,
so an older forge would build a different hash and be refused (B10). The deployment specification pins it (the
explicit key, measured as a no-op in B10, or a checked `forge --version`) and tags the source before stage A; any hook
or executor change after stage A means new infrastructure.

**The hook ↔ executor cycle.** The hook must know its executor (only it swaps) and the executor its hook (for
`receiptCount`). The frozen pair mined the hook against the executor predicted at the deployer's next nonce, which
needed two back-to-back transactions. In UNICA v4 **the hook's constructor CREATEs its executor**: the executor stores
`HOOK = msg.sender`, the hook stores `EXECUTOR`, and the executor lands at `CREATE(hook, 1)`. Immutable both ways, no
setter, no nonce coupling, one transaction per market. Cost (DESIGN-REVIEW §2.1, decision 3): the executor's
constructor arguments must be supplied to verification, and its address derives from the hook's. The EIP-1153 hand-off
lost (two blobs, two hashes, a view that must revert outside a deployment). The prototype confirmed `executor ==
CREATE(hook, 1)` and `registry == CREATE(factory, 1)` (10 of 10, §2); implementation re-proves both.

**Size estimates.** Every figure is an **ESTIMATE**, bytes, under the unchanged profile (solc 0.8.30, optimizer off,
`via_ir` false). Basis: the deadline-first prototype (DESIGN-REVIEW §1.2); as yardsticks, `quote()` (one external call
plus decoding) measured about 1,016 bytes and the dashboard-first registry 18,732 runtime (§1.3).

| Contract | Prototype base (measured outside the repo) | Features added by this specification | ESTIMATE, runtime | ESTIMATE, initcode |
|---|---|---|---|---|
| UnicaMarketRegistry | 18,732 / 19,623, the dashboard-first registry (§1.3), which lacked most of the features to the right; the deadline-first 11,109 / 11,652 is too low a base | allowlist, pool reverse map, pauser, RETIRED, versions and `liveMarketOf`, oracle policy with tighten, caps with tighten, `executionTermsOf`, 16-field `getMarkets` records | 21,000–23,000 (85–94%), at or above the 90 % warning, so the first cuts below (`getMarkets` returning ids only first) are expected | 21,900–23,900 |
| UnicaMarketFactory | 16,554 / 29,042 | fee-tier allowlist, policy and caps pass-through, seed width and seed cap math, `SafeCast`, 288-byte hook args | 18,500–20,000 (75–81%) | 41,200–44,800 (84–91%), includes the registry's |
| UnicaMarketHook | 11,283 / 30,799 | oracle read, the route check, and band math (`mulDiv`), `oracleCondition()`, four receipt fields, decimals | 14,500–16,500 (59–67%) | 35,400–38,300 (72–78%), includes the executor's |
| UnicaMarketExecutor | 15,213 / 16,476 | caps accounting, `ZeroPayer`, `AmountTooLarge`, factory as reserved recipient, `remainingToday()` | 16,600–17,500 (68–71%) | 17,900–18,800 |
| adapters | not prototyped | — | ESTIMATE under 12,000 each: no pool code | — |

**The rule.** **Implementation step 1 measures**: it builds the four contracts with full storage, ABI and checks, runs
`forge build --sizes` under the unchanged profile, and its figures replace this table. The size gate
(`script/size-budget.sh`, extended to every UNICA v4 contract and adapter) **fails** any contract above **24,576
runtime** or **49,152 initcode** and warns at 90% (22,118 / 44,236); there is no exception. The first cuts, if needed,
touch no security property: `oracleCondition()` and `remainingToday()` move off-chain and `getMarkets` returns ids only.
Crossing the 90 % warning applies these cuts; it is not a STOP. Only a contract still above the limit after them, or
anything further (a split contract, a changed binding, a linked library), is an owner decision. **Chain consequence:**
`createMarket` calldata grows from the measured 31,076 bytes (B4) to about 36–39 KB and the factory creation from
29,138 bytes to about 41–45 KB (ESTIMATE), against 16,870 bytes, the largest proven on 46630 (B5). `eth_estimateGas`
does not test a sequencer's size limit; a refusal at submission consumes no nonce. The factory creation is the canary;
the deployment specification owns the fallback.

## 13. Dashboard views, with pagination

Current state is read over RPC (Q90), with no indexer needed to list markets; history comes from events, through The
Graph where the chain is supported, otherwise a bounded event indexer. These are the reads UNICA v5 will have.

| Contract | Views |
|---|---|
| Registry | `marketCount()`; `getMarkets(uint256 offset, uint256 limit) returns (bytes32[] ids, Market[] records)` — `limit` capped at `PAGE_LIMIT = 100` and clamped to the list, an offset at or past the end returns empty arrays, registration order, retired markets included; `marketIdAt(i)`; `getMarket(id)`; `statusOf(id)`; `oraclePolicyOf(id)`; `capsOf(id)`; `executionTermsOf(id) returns (uint8 status, uint128 maxPerTx, uint128 maxPerDay)`; `marketIdFor(asset, payout, version)`; `liveMarketOf(asset, payout)`; `latestVersion(asset, payout)`; `marketIdOfHook`, `marketIdOfExecutor`, `marketIdOfPool`; `canCreateOrders(a)`, `isOrderCreator(a)`; `admin()`, `pendingAdmin()`, `pauser()`, `FACTORY()`, `REQUIRE_ORACLE()` |
| Factory | `poolKeyOf(id)`; `previewMarket(config)`; `HOOK_CREATION_CODE_HASH()`, `POOL_MANAGER()`, `REGISTRY()` — anyone can recompute a hook as `CREATE2(factory, salt, keccak(code ‖ hookArgs))` |
| Hook | `oracleCondition()` (§8.2); `feeRates()`; `receiptCount()`; every immutable |
| Executor | `orders(id)`, `orderCount()`, `poolKey()`, `payoutUsedOnDay(day)`, `remainingToday()` |
| PoolManager, via StateView | `getSlot0(poolId)`, `getLiquidity(poolId)` |

Orders are not enumerated on-chain (cut 4): a reader pages `OrderCreated` by block range from the factory's deployment
block (in the manifest), with `orderCount()` as the expected total and `orders(id)` for status. **Display rules:**
show token addresses; call the opening rate "a demonstration rate set by the admin", and never "market price" even
with an oracle; label faucet stock tokens and uTUSD as having no real-world value; show `demonstrationOnly` whenever
true; authenticate every event by its emitter (§3).

## 14. Critique findings that land in the contracts

DESIGN-REVIEW leaves the mapping of its findings to the specification. Contract-level: A1 §3 (fork row V5 initialises
a hookless pool, which must succeed, and asserts `marketIdOfPool == 0`); A2, A3, A4 §8.1 (readback checks that the
`Initialize` transaction's `to` is the factory); A5 §7 row F18; A6 §9.3 rows X9a–X9d; A7, A8 threat model and runbook,
with fork rows proving LP exit via `CLEAR_OR_TAKE`; A9, A14 §11; A10 §7; A11, A16 §9.1; A12, A13 §7; A15, C3, C4, C5,
C18 §9.3; B10 §12; C6, C7 §3 with rows S1, R9 (reverse maps) and R10 (registry event fields). The deployment, script,
manifest and test-harness findings (B1–B9, C1, C2, C8–C17, C19, C20) belong to the deployment and test specifications.

## 15. Choices this file makes, now settled by owner ruling

Each item below was an open choice in an earlier draft. `DECISIONS.md`, "Specification choices" S1–S8, has since
ruled on all eight; nothing here is still open for confirmation.
1. `(fee, tickSpacing)` restricted to (500, 10), (3000, 60), (10000, 200); no default and no assumed 0.3% (S1).
2. ADMIN as well as PAUSER may pause; only ADMIN, via the Safe, unpauses or retires; RETIRED is terminal (S2).
3. Caps are tighten-only on a live market, like the oracle policy; raising any per-transaction, per-day, seed or
   total market cap needs RETIRE and a new version, and a tightening never alters an already settled receipt (S3).
4. On-chain ceilings are `MAX_ORACLE_AGE = 300` s and `MAX_DEVIATION_BPS = 300` (§6), each a hard ceiling a market
   may configure stricter than; equities and other market-hours-sensitive assets need a separately authenticated
   policy and never become real-value markets under this generic crypto limit (S4).
5. The per-market seed cap is computed from depth over the designed range (§7) and enforced on-chain; the $100
   cross-market total is a deployment-script and manifest refusal, an operational deployment gate, and is never
   described as enforced on-chain; every deployment enumerates and sums all registered markets' `maxSeedPayout`
   first, and fails closed on any enumeration failure (S5).
6. Oracle markets seed only a band-width range, recorded as `tickLower`/`tickUpper` in configuration and the
   manifest (§7, §8.3), and a market stops, until relisted as a new version, whenever its oracle leaves the band or
   its seed is sold through; a live market is never reseeded, widened or recentred (S6).
7. The hook's arguments grow to 288 bytes to carry the two decimals, both immutable and read from each token by the
   factory, rejecting a missing, malformed or mismatched value within an explicit bounded range; configuration
   decimals are never trusted alone (S7).
8. `policy.feedId` is bound on-chain, not by readback alone: it is committed into `marketId` (§3), `register`
   verifies it against `IUnicaOracleRoute(adapter).feedIdFor(asset, payout)` (§6, §10), and `_checkOracle` repeats
   that check on every swap (§8.2); off-chain readback stays additional evidence only (S8).
