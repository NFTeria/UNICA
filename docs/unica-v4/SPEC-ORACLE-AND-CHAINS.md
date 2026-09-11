# UNICA v4 — oracle layer and chain configuration

Specification draft, uncommitted, held for owner confirmation. "UNICA v4" is the UNICA release;
"Uniswap v4" is the AMM. The binding source is `docs/unica-v4/DECISIONS.md` (the ledger); where
this file and the ledger disagree, the ledger wins and this file is wrong. Facts about Chainlink,
chains and addresses come only from `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (cited as
CA §n), `docs/unica-v4/evidence/MAINNET-CAPABILITY-PROBE.md` (MCP) and
`docs/unica-v4/evidence/DESIGN-REVIEW.md` (DR). No address, feed id or number here is invented;
each names its source, and anything the evidence does not hold is written `null` with a reason.

**Status today.** No Chainlink Data Feed exists on 46630 (CA §2a), so the 46630 rehearsal markets
run with the oracle off (`requireOracle = false`), flagged demonstration-only on-chain, labelled
"Testnet demonstration — no-value tokens". ChainlinkFeedAdapter is specified for a fork
demonstration; ChainlinkStreamsAdapter is disabled; ChainlinkCREAdapter is simulation-only;
MockOracleAdapter is tests only. Chainlink is "planned" until authenticated pricing is active in
deployed contracts; after the fork suite of §15 passes with zero skips, the only permitted wording is
"Chainlink integration demonstrated on a fork", linked to its evidence (ledger Q125). Faucet stock
tokens and uTUSD have no real-world value; a faucet TSLA token is not a Tesla share; 46630 rates are
demonstration rates the admin sets.

## 1. Blockers

Open ledger items and UNCONFIRMED evidence items, and what each stops. This file resolves none.

SR1 rows 1–13 and 18 (`IMPLEMENTATION-PLAN.md` §3) are reconciled by the owner's specification
choices S1–S8 (2026-09-11): the interface boundary (§2), route binding (§3, S8), the registry and
hook error catalogue (§5, §4.1), the tighten event (§3), the `MAX_ORACLE_AGE`/`MAX_DEVIATION_BPS`
ceilings (§3, §11, S4), the reference decimals cap (§4.1), the equal-to-block timestamp check
(§4.1), adapter-revert propagation (§4.1), the band formula and boundary (§4.2) and the condition
view and receipt fields (§6) below all reflect that reconciliation. Only SR1 rows 15, 16 and 17
stay open.

| Item | State | What it blocks |
| --- | --- | --- |
| "What the missing answers mean", item 1 (owner, 2026-09-11) | **in force** until the owner's G0 (`IMPLEMENTATION-PLAN.md` §3) | writing any adapter, chain file or chain-helper code; after G0, none of the rows below blocks writing or testing |
| SC/SO reconciliation, SR1 rows 15–17 (`IMPLEMENTATION-PLAN.md` §3) | **OPEN**, owner ruling at G0 | chain-file source prefixes (row 15), the receipt documentation's home (row 16), and the determinism pin (row 17) |
| Q9 chain choice | **OPEN** (Arbitrum One recommended, MCP) | `config/chains/42161.json` stays `enabled: false` |
| Q132 no-value mainnet infrastructure | **unanswered** | any mainnet deployment of the registry, factory or any adapter |
| Q64 Safe, Q70 pauser, Q71 launch gate | **NOT READY** | a mainnet ADMIN (`admin.safe` is `null`), a mainnet PAUSER, any mainnet launch |
| Q91 RPC provider | **NOT SELECTED** | a mainnet `rpcEnv` names a variable with no chosen provider |
| Q95 accounts and payment | **NOT PROVIDED** | a Data Streams subscription (all are paid, CA §3c); Privy; RPC; hosting |
| Q96 to Q99 Privy account, app id, secret, configuration | **UNKNOWN / NOT PROVIDED / NOT CONFIRMED** | Privy in any surface; Q100 defers it if credentials miss 12 Sep 12:00 UTC (§13) |
| Q20 legal review, Q23 equity data licence | **NO CONFIRMED REVIEW**, **none** | any equity route for value; any equity source reached through CRE |
| Q110 NFLX rate | **NOT SELECTED** | an NFLX market on 46630; NFLX stays configuration-only in local and fork tests |
| Q131 publication | **NO AUTHORIZATION** | publishing the prototype, the evidence page or any site change |
| Q25 against the 1755 s heartbeat | ledger "Semantic limit"; no remedy ruled | a mainnet crypto market on Arbitrum ETH/USD at useful availability (§11) |
| Streams digest on 46630; NFLX and v8 entitlement | **UNCONFIRMED** (CA §3a, §3b, §9) | enabling ChainlinkStreamsAdapter; any NFLX Streams route |
| CRE hosted writes to 46630; deploy approval | **UNCONFIRMED**; not enabled (CA §4) | deploying ChainlinkCREAdapter anywhere |
| Sequencer-uptime feed on 46630 and 4663 | absent (CA §2a, §6) | the sequencer check there; with Q71 it keeps 4663 out of a mainnet launch |
| Robinhood token feed unit | raw-balance relation unproven (CA §6, DR Lens A #7) | any route pricing a Robinhood token from its feed |

## 2. `IUnicaPriceOracle` and `IUnicaOracleRoute`

In `src/unica-v4/oracle/`. `latestPrice` is fixed for all UNICA v4 documents and is the *entire*
`IUnicaPriceOracle` interface; a separate adapter-level interface, `IUnicaOracleRoute`, carries the
two views the registry needs to bind a policy to a route and a readback needs to name an adapter.
`routeOf` does not exist in this or any UNICA v4 document.

```solidity
interface IUnicaPriceOracle {
    /// Reference value of ONE whole `asset` in whole `quote` units, scaled by 10**decimals.
    /// updatedAt is the upstream source's own publish time, never the time of this call.
    /// MUST revert with a named error when the pair is unpriceable. MUST NOT return a zero,
    /// a placeholder, a cached fallback or a demonstration rate.
    function latestPrice(address asset, address quote)
        external view returns (uint256 price, uint8 decimals, uint256 updatedAt);
}

interface IUnicaOracleRoute {
    /// The route identifier this adapter serves for (asset, quote); reverts PairNotSupported.
    function feedIdFor(address asset, address quote) external view returns (bytes32 feedId);

    /// keccak256 of the adapter kind: "CHAINLINK_FEED", "CHAINLINK_STREAMS", "CHAINLINK_CRE", "MOCK".
    function adapterKind() external view returns (bytes32);
}
```

- **`view` is load-bearing.** The hook calls the adapter inside `afterSwap` by STATICCALL, so
  nothing between the pool's `slot0` read and the hook's can change a fee (DR Lens A #14). A
  state-changing step (Streams `verify`) happens in a separate call before settlement (§8).
- **One instance per route, no admin.** Constructor immutables only: no owner, setter, pause or
  upgrade. A new route is a new adapter; on a live market that means RETIRE and a new version (§3).
  This release ships single-route adapters only: a multi-route adapter would need the market's
  `feedId` passed into every `latestPrice` call, and the ledger-fixed interface above has no such
  parameter (ledger S8).
- **No chain constants.** Feed, verifier and forwarder addresses are constructor arguments the
  deployment script takes from `config/chains/<chainId>.json` (§12).
- **Both interfaces, every adapter.** Every UNICA adapter (§7-§9) implements `IUnicaPriceOracle` for
  pricing and `IUnicaOracleRoute` for the registry's on-chain route-binding check (§3, ledger S8).
- **`adapterKind` is a label, not a defence.** ADMIN chooses the adapter at `createMarket`; the
  chain file pins each adapter's runtime code hash and the helper compares it (§12).
- **`feedIdFor` is the defence.** `register` requires `IUnicaOracleRoute(adapter).feedIdFor(asset,
  payout) == policy.feedId`, and the hook repeats that same check by STATICCALL on every settlement
  before calling `latestPrice` (§3, §4.1). Off-chain pre-flight and readback of the same values are
  additional evidence only, never the sole enforcement (ledger S8).

## 3. `OraclePolicy`, `requireOracle`, and the tighten-only rule

```solidity
struct OraclePolicy {
    address adapter;          // an IUnicaPriceOracle; zero when disabled
    bytes32 feedId;           // must equal adapter.feedIdFor(asset, payout)
    uint48  maxAge;           // seconds; 0 < maxAge <= MAX_ORACLE_AGE (300), ledger Q25, S4
    uint16  maxDeviationBps;  // two-sided band around the reference, 0 < value <= MAX_DEVIATION_BPS (300)
    bool    enabled;
}
```

The registry stores the policy at `createMarket`, keyed by `marketId`; the hook reads it on every
settlement through `registry.oraclePolicyOf(marketId)` (a view) and never caches it.

**`requireOracle`** is an immutable registry constructor argument: `true` for any mainnet
deployment, `false` only for the 46630 rehearsal. The registry cannot know its chain, so the chain
helper refuses `requireOracle = false` from any file whose `network` is `"mainnet"` (§12).

**Validation at `createMarket`** (registry):

| Case | Requirement | Error |
| --- | --- | --- |
| `requireOracle && !enabled` | refused | `OraclePolicyRequired(marketId)` |
| `!enabled` | all other fields zero; the record stores `demonstrationOnly = true` | `OraclePolicyMalformed(marketId)` |
| `enabled` | `adapter.code.length > 0` | `OracleAdapterNoCode(marketId, adapter)` |
| `enabled` | `IUnicaOracleRoute(adapter).feedIdFor(asset, payout) == feedId` | `OracleFeedMismatch(marketId, expected, actual)` |
| `enabled` | `0 < maxAge <= MAX_ORACLE_AGE` (registry constant, 300 seconds, ledger S4) | `OracleMaxAgeOutOfRange(marketId, maxAge)` |
| `enabled` | `0 < maxDeviationBps <= MAX_DEVIATION_BPS` (registry constant, 300, the hard ceiling; the ledger's rec 26 default is 200, set per market) | `OracleDeviationOutOfRange(marketId, bps)` |

`MAX_ORACLE_AGE` and `MAX_DEVIATION_BPS` are registry constants enforced on-chain for every policy,
including one an ADMIN submits directly; they are not a script-level convenience (ledger S4). No
live price is required at creation (a source may be closed); the deployment readback calls
`latestPrice` once and records the answer before activation. **Q25 is enforced on-chain by
`MAX_ORACLE_AGE` (ledger S4).** No contract knows an asset class, so the ceiling is generic (300 s)
rather than class-aware; a market may configure any stricter value, and an ADMIN calling
`createMarket` directly is bound by the same registry constant as the deployment script. The
chain helper's own `maxAge > 300` refusal (§12.2 step 7) stays as an earlier, second layer, never
the only one. Equities and other market-hours-sensitive assets never become real-value markets
under this generic crypto ceiling (ledger S4); an equity real-value market needs a separately
authenticated policy, not designed here.

**Route binding (ledger S8).** `marketId` commits to `policy.adapter` and `policy.feedId`
(`SPEC-CONTRACTS.md` §7); `register` recomputes it and requires
`IUnicaOracleRoute(adapter).feedIdFor(asset, payout) == feedId`, and the hook repeats that same
check by STATICCALL on every settlement, before calling `latestPrice` (§4.1). A single-route
adapter's immutable route is verified on-chain this way; off-chain pre-flight and readback of the
same values are additional evidence only, never the sole enforcement.

**Tighten-only.** `tightenOraclePolicy(bytes32 marketId, uint48 newMaxAge, uint16 newMaxDeviationBps)`,
ADMIN only, in any state but RETIRED (`WrongMarketStatus(marketId, actual)`). It requires an enabled
policy (`OraclePolicyDisabled(marketId)`), `0 < newMaxAge <= maxAge`,
`0 < newMaxDeviationBps <= maxDeviationBps`, and a strict decrease in at least one
(`OraclePolicyNotTighter(marketId)`). Both bounds already sit inside `MAX_ORACLE_AGE` and
`MAX_DEVIATION_BPS`, so a tightening can never land outside them. `register` and every
`tightenOraclePolicy` call emit the same full-state event,
`OraclePolicySet(marketId, adapter, feedId, maxAge, maxDeviationBps, enabled)`; the last log alone
gives the current policy (ledger S3). `OraclePolicyTightened` does not exist. `adapter`, `feedId` and
`enabled` have no setter: loosening, a new adapter or feed, or switching the oracle off or on means
RETIRE and a new market version with a new `marketId` (ledger Q112, which supersedes DR §2.2 row 1).
PAUSER can pause and never unpause (Q65, Q70; ledger S2). No oracle action by any role moves user
funds or redirects a settlement; the worst it does is make settlements revert.

## 4. Enforcement: `UnicaMarketHook.afterSwap`

The pool executes; the hook enforces the bound (ledger rec 28). Any failure reverts the whole
settlement: nothing transfers, no order changes state, no receipt is emitted, and there is no
fallback to a demonstration rate.

### 4.1 Order of checks

1. `policy = registry.oraclePolicyOf(MARKET_ID)`. If `!policy.enabled` (only possible when
   `requireOracle = false`), skip to the demonstration fields of §6.
2. `IUnicaOracleRoute(policy.adapter).feedIdFor(ASSET, PAYOUT) == policy.feedId`
   (`OracleFeedMismatch(MARKET_ID, expected, actual)`). This repeats, by STATICCALL, the same
   route-binding check `register` made at creation (§3, ledger S8); it runs before any price is read.
3. `(p, dO, t) = IUnicaPriceOracle(policy.adapter).latestPrice(ASSET, PAYOUT)`. An adapter revert,
   the sequencer check included (§7.3), propagates; the PoolManager wraps it as
   `WrappedError(hook, selector, reason, details)` (vendored Uniswap v4 core, `CustomRevert.sol:11`,
   `Hooks.sol:137`). Tests decode the inner selector, never a bare `expectRevert()` (DR Lens C #5).
4. `p > 0` (`OraclePriceZero(MARKET_ID)`); `dO <= 18` (`OracleDecimalsUnsupported(MARKET_ID, dO)`);
   `p <= type(uint128).max` and `p · 10**dP / 10**(dA + dO) <= type(uint128).max` (the reference
   value of one raw asset unit in raw payout units), both `OraclePriceOutOfRange(MARKET_ID, p)`,
   checked before any §4.2 multiplication.
5. `t <= block.timestamp` (`OracleTimestampInFuture(MARKET_ID, t)`).
6. `t != block.timestamp` (`OracleTimestampNotBeforeBlock(MARKET_ID, t)`). A timestamp equal to the
   block is never proof of freshness: a source that stamps "now" makes every age zero (CA §8 rule
   5). Cost: a push feed that updated in the same block refuses once, and the payer retries.
7. `block.timestamp - t <= policy.maxAge` (`OracleStale(MARKET_ID, age, maxAge)`); `t == 0` fails
   here.
8. The two-sided band of §4.2 (`ExecutionBelowOracleBand(MARKET_ID, o, minAllowed)`,
   `ExecutionAboveOracleBand(MARKET_ID, o, maxAllowed)`).

Steps 1 to 3 go through `view` interfaces (step 2's route check and step 3's price read are both
STATICCALL). The hook never calls `PoolManager.initialize`, `swap`, `unlock`, `modifyLiquidity` or
`donate` (DR Lens A #4).

### 4.2 The deviation formula

`a` = exact input in raw asset units, pool fee included; `o` = output in raw payout units; `f` =
swap fee in pips for this direction, from the same `slot0` read the receipt records; `dA`, `dP` =
token decimals (0..18, hook immutables read at `createMarket`); `p`, `dO` = the reference, one whole
asset = `p / 10**dO` whole payout; `m` = `maxDeviationBps`.

**Both orderings.** Amounts are taken by role, never by currency index. Asset is `currency0` (asset
address < payout address): `zeroForOne`, `a = uint128(-delta.amount0())`, `o = uint128(delta.amount1())`,
protocol fee = lower 12 bits of `slot0.protocolFee`. Asset is `currency1`: `a = uint128(-delta.amount1())`,
`o = uint128(delta.amount0())`, upper 12 bits. `f = protocolFee == 0 ? lpFee :
ProtocolFeeLibrary.calculateSwapFee(protocolFee, lpFee)`; `hookFeePips = 0` (no return-delta
flags). Casts use SafeCast; the executor refuses amounts above `type(int128).max` (DR Lens A #11).

**Reference output for the traded amount**, with the fee divided out so the band measures pool
pricing plus price impact against the reference, not the fee:

```
refOut      = a · (1e6 − f) · p · 10**dP  /  (1e6 · 10**(dA + dO))
refOutFloor = FullMath.mulDiv(         a · (1e6 − f), p · 10**dP, 10**(6 + dA + dO))
refOutCeil  = FullMath.mulDivRoundingUp(a · (1e6 − f), p · 10**dP, 10**(6 + dA + dO))
minAllowed  = FullMath.mulDivRoundingUp(refOutCeil,  10_000 − m, 10_000)   // o >= minAllowed
maxAllowed  = FullMath.mulDiv(          refOutFloor, 10_000 + m, 10_000)   // o <= maxAllowed
```

Both sides round against acceptance. Operand bounds: `a · (1e6 − f) < 2**147`, `p · 10**dP < 2**188`,
divisor at most `10**60`; FullMath's 512-bit product cannot overflow. The quotient is bounded by
§4.1 step 4, not by the caps (`refOut` grows with `p` and falls with `dA + dO`): with `a < 2**127`,
`refOut < 2**255` and `maxAllowed < 2**256`, so FullMath never reverts unnamed. The low side catches a pool paying less than the reference (an
oracle reading high, a skewed or drained pool, an order too large for the depth); the high side
catches a pool paying more (a seed sold below value, a manipulated pool, an oracle reading low).
The payer's protection against fee and price impact stays `minOut` (settlement spec).
**Effective tolerance.** The band measures against the reference, not the true price: a push feed
updates only past its deviation threshold or at its heartbeat, so against the true price the band is
roughly `m` + the feed's threshold + the drift within `maxAge`. Each chain-file feed entry records
`deviationThresholdBps` from evidence (`null` until recorded, §12.1), and the helper refuses a feed
policy whose `m` is not above it (§12.2); a larger required margin is an owner choice.

**Worked arithmetic, illustration only** (46630 has no oracle). TSLA shape: `dA = 18`, `dP = 6`,
asset is `currency0`, LP fee 3000, protocol fee 0, `a = 10**15` (0.001 token), `o = 393052`, the
delivery measured on the prototypes and on the frozen live settlement (DR §1.2). Take `p = 395·10**8`,
`dO = 8`: the admin's demonstration rate 395 (Q110) in adapter form, not a price from any source.

```
refOut = 10**15 · 997000 · 395·10**8 · 10**6 / (10**6 · 10**26) = 393815 (exact)
m = 200: minAllowed = 385939, maxAllowed = 401691
o = 393052 passes (19.37 bps below); o = 405629 (3 % above) fails
ExecutionAboveOracleBand(marketId, 405629, 401691); both o == minAllowed and o == maxAllowed pass,
one raw unit beyond either fails.
```

## 5. Error catalogue

`SPEC-CONTRACTS.md` §9 is the only home of the registry and hook error catalogues; this file adds
only the adapter catalogue below. Every refusal has a name; the condition is what §6's view reports.

| Raised by | Errors | Condition |
| --- | --- | --- |
| ChainlinkFeedAdapter | `FeedUnreadable`, `FeedDecimalsChanged`, `FeedDescriptionChanged`, `FeedAnswerNotPositive`, `FeedRoundIncomplete`, `FeedNoTimestamp`, `SequencerDown`, `SequencerStatusUnknown`, `SequencerGracePeriod`, `OraclePausedByIssuer`, `IssuerPauseUnreadable`, `PairNotSupported` | STALE_ORACLE (an issuer hold is not proof of a closed market) |
| ChainlinkStreamsAdapter | `MarketClosed` | MARKET_CLOSED |
| ChainlinkStreamsAdapter | `NoVerifiedReport`, `ReportExpired`, `ReportNotNewer`, `ReportFromFuture`, `ReportFeedMismatch`, `ReportSchemaUnsupported`, `ReportNotYetValid`, `VerifierFeeManagerSet`; the §7.3 sequencer errors | STALE_ORACLE, or the submission is refused |
| ChainlinkCREAdapter | `NotForwarder`, `WorkflowMismatch`, `WorkflowOwnerMismatch`, `ReportChainMismatch`, `ReportReceiverMismatch`, `PairNotSupported`, `ReportNotNewer`, `ReportFromFuture`, `NoVerifiedReport`; the §7.3 sequencer errors | STALE_ORACLE, or the report is refused |
| constructors | `FeedNoCode`, `FeedDescriptionMismatch`, `FeedDecimalsUnsupported`, `SequencerFeedNoCode`, `VerifierNoCode`, `ForwarderIsSimulationOnly`, `IssuerPauseUnreadable` | adapter never exists |

## 6. Computed conditions and the receipt's oracle fields

Stored states are PROPOSED, INITIALIZED, SEEDED, ACTIVE, PAUSED and RETIRED (Q112). STALE_ORACLE
and MARKET_CLOSED are computed, never stored (rec 24's STALE_ORACLE mark is a computation).

```solidity
enum OracleCondition { OK, DEMONSTRATION_ONLY, STALE_ORACLE, MARKET_CLOSED }
function oracleCondition() external view   // on UnicaMarketHook
    returns (OracleCondition condition, bytes4 reason, uint256 price, uint8 decimals, uint256 updatedAt);
```

The view runs §4.1 steps 1 to 7 under `try`/`catch` and maps selectors as `SPEC-CONTRACTS.md` §9's
hook catalogue says, returning the caught selector in `reason`. It cannot run step 8, which needs a
swap: `OK` means the reference is usable now, not that a settlement will pass. PAUSED and RETIRED
override any condition. It sits on the hook because the hook already carries the checks and the
registry has the tightest size budget (DR §1.3: 76 % of EIP-170 on a prototype; the implementation
re-measures). A market that has left its recorded liquidity range or exhausted its seed capacity is
paused and replaced by a new version after review; it is never reseeded, widened or recentred while
live (ledger S6).

**Receipt fields this layer requires** (the settlement spec owns the event layout; written in the
same swap): `referencePrice` (`p`), `referenceDecimals` (`dO`), `referenceUpdatedAt` (`t`, `uint64`),
`demonstrationOnly` (`false`). There is no separate feed-id field: the route is recoverable from
`policy.feedId`, itself committed inside `marketId` (§3, ledger S8). With the oracle off: zeros and
`demonstrationOnly = true`. Beside them, `hookFeePips` (0), `lpFeePips`, `protocolFeePips` and
`swapFeePips`, from the same `slot0` read as `f`. The executor's `Settled` event is the success
signal; a receipt without it proves nothing.

## 7. `ChainlinkFeedAdapter` (push Data Feeds, `AggregatorV3Interface`)

### 7.1 Configuration (constructor immutables, one instance per route)

- `ASSET`, `QUOTE`: the only pair served (`PairNotSupported` otherwise).
- `ASSET_FEED` with `ASSET_DESC_HASH` and `ASSET_FEED_DECIMALS`: the pinned proxy (never the
  aggregator behind it, CA §2b), keccak256 of its expected `description()`, and `decimals()` read
  at construction.
- `QUOTE_FEED` with its hash and decimals: the payout token's own USD feed. Zero only for a feed
  documented as quoted in the payout token itself; none exists in the evidence.
- `SEQUENCER_FEED`, `GRACE_PERIOD` (§7.3); `ISSUER_PAUSE_TOKEN` (§7.4). Zero when not applicable.
- `feedIdFor(ASSET, QUOTE) = keccak256(abi.encode("CHAINLINK_FEED", ASSET_FEED, QUOTE_FEED))`;
  `adapterKind() = keccak256("CHAINLINK_FEED")` (§2, `IUnicaOracleRoute`).
- The constructor refuses: no code at a feed (`FeedNoCode`) or sequencer feed (`SequencerFeedNoCode`),
  a description mismatch (`FeedDescriptionMismatch`), feed decimals above 18
  (`FeedDecimalsUnsupported`), an unreadable issuer pause (`IssuerPauseUnreadable`).

Expected descriptions come from recorded live reads. The evidence holds Robinhood 4663 ETH/USD
`"ETH / USD"`, USDC/USD `"USDC / USD"` and TSLA/USD `"RHTSLA / USD"`, and Base plain `usdc-usd`
`"USDC / USD"` (MCP). The Arbitrum One descriptions were not recorded: the 42161 file carries
`null`, and nothing builds that adapter until a read-only probe records them as evidence.

### 7.2 Validation on every `latestPrice` call, in order

1. Pair check; then the sequencer (§7.3) and the issuer hold (§7.4).
2. For each feed: `decimals()` is read live (CA §8 rule 1) and must equal the pinned value
   (`FeedDecimalsChanged`); a revert of `decimals()` or `latestRoundData()` is `FeedUnreadable`.
   `keccak256(description())` must equal the pinned hash (`FeedDescriptionChanged`): a proxy can
   be re-pointed, and a documented address is not proof of what sits behind it (CA §8 rule 14).
   `answer > 0` (`FeedAnswerNotPositive`); `updatedAt != 0 && startedAt != 0` (`FeedNoTimestamp`);
   `answeredInRound >= roundId` (`FeedRoundIncomplete`, a carried-over round, CA §8 rule 2).
3. Cross route: `price = mulDiv(a · 10**dq, 1e18, q · 10**da)`, `decimals = 18`,
   `updatedAt = min(tA, tQ)`. A stablecoin payout is never assumed to be one dollar; its own feed is
   read (Arbitrum `usdc-usd`, MCP). Direct route: the feed's values unchanged.
4. The future, equal-to-block and age checks are the hook's (§4.1), identical for every adapter.

### 7.3 Sequencer uptime and grace period

`OraclePolicy` has no sequencer field, so the sequencer is configured per adapter and checked inside
the same `latestPrice` call the hook makes, failing the settlement just as a hook check would. This
applies to all three adapter kinds: the Streams and CRE adapters (§8, §9) carry the same
`SEQUENCER_FEED` and `GRACE_PERIOD` immutables and run these checks first in `latestPrice`, so a
pull route on an L2 never skips them and the helper's L2 rule (§12.2 step 7) covers every kind.
Where `SEQUENCER_FEED` is set, before any price read: `answer != 0` is `SequencerDown()` (0 is the
only "up" value; 1 is down, and any other value is treated as down, never as up);
`startedAt == 0` is `SequencerStatusUnknown()`; `block.timestamp - startedAt <= GRACE_PERIOD` is
`SequencerGracePeriod(startedAt, GRACE_PERIOD)`. A price can look fresh while the sequencer has only
just returned (CA §8 rule 4). Arbitrum One: `0xFdB631F5EE196F0ed6FAa767959853A9F217697D`, read "up"
at the probe (MCP). Robinhood 46630 and 4663 have no such feed and Chainlink is no longer adding
networks (CA §2a, §6; MCP): the check cannot be built there, their files say so in
`sequencerCheck`, and the helper refuses `requireOracle = true` on any L2 file without one.
`GRACE_PERIOD` is a chain-file value the owner confirms; 3600 s is proposed, not an evidence fact.

### 7.4 Tokenized-equity feeds: hold, value, hours

From the one documented feed of this family, Robinhood 4663 TSLA/USD (CA §2b, §6); later feeds of
the family are assumed to behave the same until proven otherwise.

- **Issuer hold.** The feed silently holds its last value while the issuer token's `oraclePaused()`
  is true. With `ISSUER_PAUSE_TOKEN` set, `true` is `OraclePausedByIssuer`, and a revert or empty
  return is `IssuerPauseUnreadable`. The 46630 faucet tokens revert on it (CA §7), so this adapter
  cannot be built for them.
- **Value.** A per-token total-return value (underlying × the issuer's `uiMultiplier()`), not a
  share quotation. Its relation to the raw balance unit is unproven (DR Lens A #7); no route prices
  a Robinhood token from it until a fork row proves that.
- **Hours.** A push feed has no market-status field and publishes nothing off-hours (CA §6). The
  adapter does not improvise a wall-clock calendar (CA §8 rule 7). A closed market reads
  STALE_ORACLE once `age > maxAge`, never MARKET_CLOSED, and for up to `maxAge` after the last
  pre-close update the last value is still accepted. This adapter alone cannot prove rec 27
  ("equities settle only while the market is open"). An equity market for value needs a source
  with an explicit status (§8) or an exchange calendar; neither is available (Q20, Q23, Q95).
- **Freshness.** Heartbeat 86400 s (CA §2b); a 24-hour-old equity price is never acceptable (Q25).
  No evidence quantifies "the strictest freshness the product safely supports", so the helper
  refuses every equity route.
- **SVR.** Enabled on Robinhood feeds; the secondary proxy's role is UNCONFIRMED (CA §2b). Only the
  primary proxy is pinned.

**Use in this release:** a fork demonstration only, the Arbitrum One cross route ETH/USD over
USDC/USD with the sequencer check, plus a read-only fork of the Robinhood 4663 TSLA feed (§15).
Nothing is deployed (Q9 OPEN, Q132 unanswered).

## 8. `ChainlinkStreamsAdapter` (pull reports, `VerifierProxy.verify`) — disabled

**Enable condition, all required:** a paid subscription exists (all are paid, CA §3c; Q95 NOT
PROVIDED); one real report for the pinned feed id has verified on the target chain's VerifierProxy,
recorded as evidence (the TSLA testnet digest on 46630 is UNCONFIRMED, CA §3a); and a reviewed
commit sets the chain file's `streams.enabled`. Until then the helper refuses any policy naming it.

**Immutables.** `VERIFIER_PROXY` (46630: `0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64`,
"VerifierProxy 2.0.0", CA §3a); `FEED_ID`, pinned per network (for example TSLA/USD v11 Regular,
testnet DON, feed id `0x000b08f5e1a8c355e9982cea5707cf7b60be8ef91c42bb8022fd63f1bd71f6ab`, CA §3b);
`SCHEMA` (8 or 11); `ALLOWED_STATUS_MASK`; `ASSET`; `QUOTE`; `SEQUENCER_FEED`, `GRACE_PERIOD` (§7.3);
an optional `QUOTE_FEED` for the payout token, validated as §7.2. Without it the payout must be
declared USD-denominated in the chain file, which the helper accepts only on a testnet file.
`feedIdFor(ASSET, QUOTE) = keccak256(abi.encode("CHAINLINK_STREAMS", FEED_ID, QUOTE_FEED))`;
`adapterKind() = keccak256("CHAINLINK_STREAMS")` (§2, `IUnicaOracleRoute`; `FEED_ID` here is
Chainlink's own Data Streams feed identifier, distinct from the registry's `policy.feedId`).

**`submitReport(bytes fullReport)`**, permissionless (the DON signature authenticates):

1. `s_feeManager()` is read live; non-zero is `VerifierFeeManagerSet` (UNICA v4 pays no on-chain
   fee; zero on 46630 today, CA §3a, but it can change).
2. `VERIFIER_PROXY.verify(fullReport, "")`. It changes state, which is why it cannot run inside the
   hook's STATICCALL. An unregistered digest reverts `VerifierNotFound` in the proxy.
3. Schema tag (first two bytes of the feed id, `0x0008` or `0x000B`, CA §3d) equals `SCHEMA`
   (`ReportSchemaUnsupported`); feed id equals `FEED_ID` (`ReportFeedMismatch`).
4. Validity start not after `block.timestamp` (`ReportNotYetValid`); `expiresAt >= block.timestamp`
   (`ReportExpired`), since no Verifier enforces expiry (CA §3d).
5. `observationsTimestamp <= block.timestamp` (`ReportFromFuture(t, now)`), so one future-dated
   report (a source or clock fault) cannot make every later report "not newer" and hold the market
   at STALE_ORACLE until RETIRE, since the adapter has no admin; then strictly greater than the
   stored one (`ReportNotNewer`), which blocks replay and out-of-order delivery. A positive price,
   the timestamps, expiry and status are stored.

**`latestPrice`** (view): `NoVerifiedReport()`; `ReportExpired` past `expiresAt`;
`MarketClosed(status)` when the status is outside `ALLOWED_STATUS_MASK`; else the price with
`decimals = 18` (CA §3b) and `updatedAt = min(observationsTimestamp, the price's own timestamp)`,
never the submission time (CA §8 rule 9). The DON can keep signing fresh observations of a price
that has not moved (a halted stock, a feed held for a corporate action), so the observation time
alone would pass a stale price. v11: the mid-price timestamp, normalised from its 1e6 multiplier
(CA §3d). v8: its last-update field is not recorded in the evidence (UNCONFIRMED), so no v8 route
is enabled until the decoding test pins it. Status values (CA §3d): v8 `0` unknown, `1` closed, `2` open; v11
`0` unknown, `1` pre-market, `2` regular, `3` post-market, `4` overnight, `5` closed. Default mask
`{2}` for both; unknown is never accepted; wider sessions are an owner decision under rec 27.

The v8 and v11 layouts are transcribed from the schema pages CA §3d cites and pinned by a decoding
test on the one real verified report. v11 `lastTradedPrice` is never used (deprecated, removal by
2026-10-12, CA §3d). A fresh report is submitted in its own transaction before `pay`; if it expires
or is superseded in between, `pay` refuses and nothing moves. **The submitter chooses the
reference.** `submitReport` (and, for §9, the forwarder's relay) is permissionless, so a bound payer
or a colluding creator can pick, among signed reports newer than the stored one and inside `maxAge`,
the one most favourable to the band; the replay rule stops going backwards, not this choice. The
bound in this release: that choice moves the reference by at most the price drift within `maxAge`,
so a Streams `maxAge` must sit far below the per-payment drift the band tolerates. Submitting the
report inside `pay` would remove the choice but changes the executor's ABI: an owner choice (§16).

## 9. `ChainlinkCREAdapter` (`IReceiver.onReport`) — simulation-only

Not deployable: workflow deployment needs Chainlink's per-organisation approval, not enabled for
us; hosted writes to 46630 are unproven (the CLI notes say "local simulation" while the forwarder
directory lists 46630, CA §4a, §9); no licensed equity source exists (Q23); Q95 is NOT PROVIDED.

**Immutables.** `FORWARDER` from the chain file (46630: `0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19`,
"KeystoneForwarder 1.0.0", CA §4a); `WORKFLOW_ID`; `WORKFLOW_OWNER`; `ASSET`; `QUOTE`;
`SEQUENCER_FEED`, `GRACE_PERIOD` (§7.3). The
constructor refuses the chain's simulation forwarder (`ForwarderIsSimulationOnly`); on 46630 that is
`0x0b93082D9b3C7C97fAcd250082899BAcf3af3885`, which checks no signatures (CA §4a). The same address
is Ethereum mainnet's real forwarder, so the refusal list is per chain, never global.
`feedIdFor(ASSET, QUOTE) = keccak256(abi.encode("CHAINLINK_CRE", WORKFLOW_ID, WORKFLOW_OWNER))`;
`adapterKind() = keccak256("CHAINLINK_CRE")` (§2, `IUnicaOracleRoute`); `FORWARDER` is chain delivery
infrastructure, not a route identifier, so it is excluded from `feedIdFor`.

**`onReport(bytes metadata, bytes report)`:** `msg.sender == FORWARDER` (`NotForwarder`); workflow id
and owner from the metadata match (`WorkflowMismatch`, `WorkflowOwnerMismatch`);
`report = abi.encode(chainId, receiver, asset, quote, price, decimals, observedAt)`, a UNICA-defined
schema: `chainId == block.chainid` (`ReportChainMismatch`), `receiver == address(this)`
(`ReportReceiverMismatch`) and the pinned pair (`PairNotSupported`). Whether the forwarder's signed
data binds the receiver is UNCONFIRMED in the evidence (CA §4b says only that the receiver pins the
workflow id and owner), so without these fields any receiver pinning the same workflow, on any chain,
would accept the same report. `observedAt <= block.timestamp` (`ReportFromFuture`), then strictly
increasing (`ReportNotNewer`). `observedAt` is the source's time
inside the report, because the forwarder's DON timestamp never reaches the receiver (CA §4b).
`latestPrice` returns the stored value or `NoVerifiedReport()`. This release has the source and unit
tests driven by a test forwarder under `test/unica-v4/`, and no instance on any chain.

## 10. `MockOracleAdapter` — tests only

It lives at `test/unica-v4/mocks/MockOracleAdapter.sol`, outside `src/`; a gate row fails if any
file under `script/unica-v4/` imports from `test/`. Its `adapterKind()` is `MOCK`, which the helper
refuses, as it refuses the mock's runtime code hash. Its price, decimals, timestamp and revert are
settable, which is exactly why it never touches anything that moves value, even temporarily (CA §8
rule 13). Unit tests use it to reach every refusal of §4 and §5; claims about Chainlink are proven
only against real Chainlink contracts on a fork (§15).

## 11. Setting `maxAge` from the measured feed cadence

**The rule** (Q25 and the ledger's "Semantic limit"): `maxAge` is capped per market, never derived
from the heartbeat alone; crypto at most 300 s initially, enforced on-chain by the registry's
`MAX_ORACLE_AGE` constant (§3, ledger S4), not only by the measurement tooling below; equities only
during supported hours at the strictest safe freshness, never 24 hours old. Arbitrum One ETH/USD has
a 1755 s heartbeat (MCP), so a correct price can be older than 300 s in a calm market; `maxAge` is
set from the measured cadence, and the market fails closed when the price is older.

**Measurement.** A committed, read-only tool, `script/unica-v4/feed-cadence.sh` (to be written):
resolves the RPC through the chain helper by variable name only (refusing when unset, never
printing the value); walks `getRoundData()` back from `latestRoundData()` over at least 7 days,
stopping at a phase boundary (the phase sits in the round id's upper 16 bits); computes the count,
p50, p90, p99 and maximum gap between consecutive `updatedAt` values, and the availability `A(x)`,
the share of the window in which the age was at most `x`, for `x` in {60, 120, 300, heartbeat};
and writes `docs/unica-v4/evidence/FEED-CADENCE-<chainId>-<feedKey>.md` with the block range, both
end timestamps and the variable name. It sends nothing.

**Choosing the value.**

- Crypto: `maxAge = 300` (the registry's `MAX_ORACLE_AGE` ceiling, ledger S4), or lower if the
  measurement supports a stricter value. The registry refuses any policy above 300 on-chain,
  including one an ADMIN submits directly; raising it needs a ledger amendment and a new release,
  not a script exception.
- `A(maxAge)` is the market's expected availability. Below the owner's minimum (**OPEN**, not yet
  set), the market does not launch on that route.
- In a cross route the older timestamp governs: USDC/USD (255 s heartbeat, MCP) sits under the cap,
  so ETH/USD decides availability.
- ESTIMATE, an arithmetic bound: if ETH/USD updated only on its heartbeat, the age would be at most
  300 s for 300 / 1755 ≈ 17 % of the time. Deviation-triggered updates raise the real figure; the
  threshold is not in the evidence, and the measurement replaces the bound.
- Faster routes are not usable yet: the Arbitrum svr and shared-svr variants were not probed and
  differ in decimals (MCP); Streams is disabled (§8).
- Re-measure before any market is created and record the file in the manifest. Tightening later is
  allowed; loosening means RETIRE (§3). Equities: no evidence quantifies a safe value, so the
  helper refuses every equity route.

## 12. Chain configuration and the chain helper

### 12.1 `config/chains/<chainId>.json`, schema `unica-v4-chain/1`

One file per chain. Every address is `{"address", "source"}`; `source` starts with `CA`, `MCP` or
`DR` (the three evidence files under `docs/unica-v4/evidence/`) plus a section, and the helper
refuses any other prefix. An address the evidence does not hold is `null` with source `PENDING`.
`rpcEnv` is a variable NAME, never a URL. `oracleAdapters` maps an adapter name to its address and
expected runtime code hash. **U7 pins.** Every token carries `proxy`: `{"kind": "none"}`, or the
kind (`beacon`, `eip1967`), the beacon where there is one, the pinned `implementation` and its
`codehash`, each with a `source`; the helper reads the live implementation (the beacon's
`implementation()` or the EIP-1967 slot) and its `extcodehash` and refuses a mismatch, a missing
`proxy`, or a `null` pin on a listed asset or the payout. So U7's "reviewed chain configuration" is
this file, not a market file. Each `dataFeeds` entry carries `deviationThresholdBps` (§4.2).

**Filled example, `config/chains/46630.json`** (enabled; the rehearsal is TSLA only):

```json
{
  "schema": "unica-v4-chain/1", "chainId": 46630, "name": "Robinhood Chain Testnet", "network": "testnet",
  "enabled": true, "disabledReason": null, "rpcEnv": "ROBINHOOD_TESTNET_RPC_URL", "l2": true,
  "requireOracle": false, "demonstrationOnly": true, "admin": {"kind": "deployer-eoa", "safe": null},
  "explorer": {"kind": "blockscout", "verifierUrl": "https://explorer.testnet.chain.robinhood.com/api/", "source": "DR Lens B #6"},
  "create2Deployer": {"address": "0x4e59b44847b379578588920cA78FbF26c0B4956C", "source": "MCP (address); DR Lens B #3 (46630 use)"},
  "uniswapV4": {"poolManager": {"address": null, "source": "PENDING"}, "positionManager": {"address": null, "source": "PENDING"},
                "stateView": {"address": null, "source": "PENDING"}, "permit2": {"address": null, "source": "PENDING"}},
  "tokens": {
    "uTUSD": {"address": "0xfb93352698150e720Bf0A321DEf3aC98D90B9874", "decimals": 6, "role": "payout",
              "value": "none: no-value test token", "source": "DR Lens B #1, §1.2", "proxy": {"kind": null, "source": "PENDING"}},
    "TSLA":  {"address": "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", "decimals": 18, "role": "asset", "listed": true,
              "value": "none: faucet test token", "source": "CA §7",
              "proxy": {"kind": "beacon", "beacon": {"address": "0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5", "source": "DR Lens C #8"},
                        "implementation": null, "codehash": null, "source": "PENDING: DR Lens A #7 records a truncated prefix only"}},
    "NFLX":  {"address": "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", "decimals": 18, "role": "asset", "listed": false,
              "unlistedReason": "Q110 NFLX rate NOT SELECTED", "value": "none: faucet test token", "source": "CA §7"}},
  "chainlink": {
    "dataFeeds": {}, "dataFeedsNote": "none exist (CA §2a)", "sequencerUptimeFeed": null, "gracePeriodSeconds": null,
    "sequencerCheck": "impossible: no Chainlink sequencer-uptime feed (CA §2a)",
    "streams": {"enabled": false, "disabledReason": "Q95 NOT PROVIDED; TSLA testnet digest UNCONFIRMED (CA §3a)",
      "verifierProxy": {"address": "0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64", "typeAndVersion": "VerifierProxy 2.0.0", "source": "CA §3a"},
      "feedIds": {"TSLA-USD-v11-regular-testnet": {"id": "0x000b08f5e1a8c355e9982cea5707cf7b60be8ef91c42bb8022fd63f1bd71f6ab", "type": "bytes32", "source": "CA §3b"}}},
    "cre": {"enabled": false, "disabledReason": "deploy approval not enabled; hosted writes UNCONFIRMED (CA §4a, §9); Q23; Q95",
      "forwarder": {"address": "0x8E6E6A1f2B2D4dF503bfd67951CF28F27BF3AF19", "typeAndVersion": "KeystoneForwarder 1.0.0", "source": "CA §4a"},
      "simulationForwarder": {"address": "0x0b93082D9b3C7C97fAcd250082899BAcf3af3885", "refused": true, "source": "CA §4a"}}},
  "oracleAdapters": {}, "privy": {"documentedSupport": "UNCONFIRMED: not probed for 46630", "source": null}
}
```

The four Uniswap v4 addresses for 46630 are not in the UNICA v4 evidence files. They stay `null`,
and the helper refuses every stage, until a reviewed commit records them in evidence with their
source (§16). `UPGRADEABILITY-AND-HOOKS-REVIEW.md` §6 cites a 46630 PoolManager read live; a review
is not an evidence file, so that value is not used here until the implementation plan's CH1 records
all four from committed sources, and every document then cites that evidence file.

**Disabled example: `config/chains/42161.json`.**

```json
{
  "schema": "unica-v4-chain/1", "chainId": 42161, "name": "Arbitrum One", "network": "mainnet", "enabled": false,
  "disabledReason": "Q9 OPEN; Q132 unanswered; Q64, Q70, Q71 NOT READY; Q91 NOT SELECTED",
  "rpcEnv": "ARBITRUM_MAINNET_RPC_URL", "l2": true, "requireOracle": true, "demonstrationOnly": false,
  "admin": {"kind": "safe", "safe": null, "safeNote": "Q64 NOT READY"},
  "safeDeployments": {"safe": {"address": "0x41675C099F32341bf84BFc5382aF534df5C7461a", "source": "MCP Arbitrum 5"},
    "safeL2": {"address": "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762", "source": "MCP Arbitrum 5"},
    "proxyFactory": {"address": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67", "source": "MCP Arbitrum 5"}},
  "explorer": {"kind": "arbiscan", "verifyPage": "https://arbiscan.io/verifyContract", "source": "MCP Arbitrum 6"},
  "create2Deployer": {"address": "0x4e59b44847b379578588920cA78FbF26c0B4956C", "source": "MCP Arbitrum supplementary"},
  "uniswapV4": {"poolManager": {"address": "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32", "source": "MCP Arbitrum 1"},
    "positionManager": {"address": "0xD88F38F930b7952f2Db2432Cb002E7abBF3dD869", "source": "MCP Arbitrum 1"},
    "stateView": {"address": "0x76fd297e2D437cd7f76d50F01AfE6160f86e9990", "source": "MCP Arbitrum 1"},
    "permit2": {"address": "0x000000000022D473030F116dDEE9F6B43aC78BA3", "source": "MCP Arbitrum 1"}},
  "tokens": {"USDC": {"address": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "decimals": 6, "role": "payout", "source": "MCP Arbitrum 3",
                      "proxy": {"kind": null, "implementation": null, "codehash": null, "source": "PENDING: MCP Arbitrum 3 records codesize 1852 only"}}},
  "tokensNote": "no asset token: none is recorded in the evidence",
  "chainlink": {
    "dataFeeds": {
      "ETH-USD": {"address": "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612", "decimals": 8, "heartbeatSeconds": 1755,
                  "class": "crypto", "expectedDescription": null, "deviationThresholdBps": null, "source": "MCP Arbitrum 2"},
      "USDC-USD": {"address": "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3", "decimals": 8, "heartbeatSeconds": 255,
                   "class": "crypto", "expectedDescription": null, "deviationThresholdBps": null, "source": "MCP Arbitrum 2"},
      "TSLA-USD": {"address": "0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3", "class": "equity", "usable": false,
                   "unusableReason": "Q20, Q23; equities are future support (rec 15, 21)", "source": "CA §2c; MCP Arbitrum supplementary"}},
    "sequencerUptimeFeed": {"address": "0xFdB631F5EE196F0ed6FAa767959853A9F217697D", "source": "MCP Arbitrum supplementary"},
    "gracePeriodSeconds": null,
    "streams": {"enabled": false, "verifierProxy": {"address": null, "source": "PENDING"}}, "cre": {"enabled": false}},
  "oracleAdapters": {}, "privy": {"documentedSupport": "YES", "source": "MCP Arbitrum 4"}
}
```

### 12.2 The chain helper, `script/unica-v4/chain.sh`

A committed bash script (`set -euo pipefail`, `jq`). Every UNICA v4 script stage calls it first;
nothing else decides which chain a command talks to. In order, it:

1. clears a stray `CHAIN` variable, which otherwise overrides `cast --chain` (DR Lens C #11);
2. loads `config/chains/<chainId>.json`, refusing a missing file, an unknown `schema`, or a
   `chainId` that differs from the file name; then refuses `enabled != true`, printing
   `disabledReason`;
3. refuses when the variable named by `rpcEnv` is unset or empty, never printing its value;
4. reads the chain id the RPC reports (`cast chain-id`) and refuses a mismatch: the reported id is
   the chain's identity, never a name or alias;
5. refuses a `null` required address (the Uniswap v4 four, the payout, every listed asset), a
   missing or `null` U7 `proxy` pin on the payout or a listed asset, and any `source` without a
   `CA`, `MCP` or `DR` prefix;
6. probes live: code at every required address, `typeAndVersion()` where recorded, `extcodehash`
   for every `oracleAdapters` entry, each pinned token implementation and its code hash (U7), and
   refuses any adapter whose kind is `MOCK`;
7. enforces: `mainnet` needs `requireOracle` and a non-null `admin.safe`; `l2 && requireOracle`
   needs a sequencer feed, for every adapter kind; a Streams policy needs `streams.enabled`; a feed
   policy needs a recorded `deviationThresholdBps` below its `maxDeviationBps`; crypto `maxAge > 300`
   is refused here early, and again on-chain by the registry's `MAX_ORACLE_AGE` ceiling (ledger S4)
   even for a policy an ADMIN submits directly; raising it needs a ledger amendment and a new
   release; equity routes are refused;
8. exports `UNICA_CHAIN_ID` and the addresses as environment variables. The forge script re-asserts
   `block.chainid == vm.envUint("UNICA_CHAIN_ID")` and reads them with `vm.envAddress`.

Environment variables, not `vm.readFile`, because `foundry.toml` sets `fs_permissions = []` and
changing the profile would trip the frozen-build diff gate DR Lens C #13 proposes. The existing
`script/mainnet-guard.sh` still refuses mainnet chain ids; enabling a mainnet file also needs a
reviewed change there, which waits on Q9 and Q132. **CI** (no local state, no RPC) validates every
file in `config/chains/` and must refuse planted bad files: disabled chain, id mismatch, unset
`rpcEnv`, `null` required address, bad `source` prefix, mainnet without `requireOracle`, L2 mainnet
without a sequencer feed, a MOCK adapter. Steps 4 and 6 need an RPC; without one CI reports them
SKIPPED with a count, never passed.

## 13. Privy — conditional (Q96 to Q100)

Privy is an additional planned integration, after the permanent top three (Uniswap v4, ENSv2 on
Sepolia, The Graph). No contract depends on it. Q96 to Q98 (account, app id, secret) are UNKNOWN /
NOT PROVIDED; only whether a secret is configured is ever recorded, never the secret. The app id is
per application, so it never appears in `config/chains/`. Q99: the `nfteria.github.io`
configuration is NOT CONFIRMED. Q100: Privy ships only if credentials are ready by 12 Sep 12:00 UTC;
otherwise it is deferred and no surface shows a Privy sign-in as working. `privy.documentedSupport`
records what Privy's docs say for a chain id (42161 YES, 4663 UNCONFIRMED, MCP; 46630 not probed),
which is not proof that UNICA's flow works there.

## 14. The static-prototype boundary (Q86, Q122 to Q127)

- `prototype/unica-v4-ux/` is never published by the Pages workflow (Q122); publishing needs two
  separate owner approvals (Q131: NO AUTHORIZATION).
- Fixtures come only from the real 46630 settlement, labelled "Testnet demonstration — no-value
  tokens" (Q123); no invented USDC, ETH, Base, oracle or mainnet activity. A fixture receipt's
  oracle fields are the §6 demonstration values.
- A demonstration market shows "Demonstration rate — no oracle", never a reference price; Chainlink
  shows as "planned" (Q125); STALE_ORACLE and MARKET_CLOSED are amber, failures red, success green
  (Q124); a mock value is never shown.
- It is a static prototype and evidence page with no RPC call, never called a hosted checkout
  (Q86). Live integration waits until the event schema and deployment manifest are frozen (Q127).

## 15. Tests that prove this layer

Under `test/unica-v4/`. Every negative row states its precondition, pairs with a passing control
and names the inner selector (DR Lens C #5); every guard has a mutant killed by its own row (DR Lens
C #4).

| Rows | Proves |
| --- | --- |
| O1–O6 unit | each `createMarket` refusal of §3, with a valid-policy control |
| O7–O10 unit | tighten-only: each loosening refused, each tightening accepted, RETIRED refused, exact event |
| O11–O17 unit, mock | each check of §4.1 steps 4 to 7 at both boundaries (`age == maxAge` passes, `+1` fails; `o` equal to either bound passes, one unit beyond fails) |
| O18 fuzz | the band over {6, 8, 18}² decimals × both orderings, `dO` 0..18, fee tiers, zero-tolerance cross-multiplied bound (DR Lens C #14, #15) |
| O19–O20 unit | `oracleCondition()` selector mapping; the demonstration receipt fields |
| O21–O25 unit | Streams and CRE with a test verifier and forwarder: replay, non-newer, a future-dated report refused at submission, expiry, status, wrong or simulation forwarder; a Streams report with fresh observations but a price timestamp older than `maxAge` refused; a validly signed CRE report for route A delivered to route B's adapter, or carrying another chain id, refused; the sequencer checks on both |
| OF1–OF8 fork 42161, pinned block | ChainlinkFeedAdapter on the real ETH/USD, USDC/USD and sequencer feeds: construction, a settlement inside the band, a pool 3 % off refused on each side, `maxAge` by warp; sequencer down, grace and unknown by `vm.mockCall` on the real address |
| OF9 fork 4663, read-only | the TSLA feed's description `"RHTSLA / USD"` and the §7.4 issuer-hold refusal |

Fork rows need `ARBITRUM_MAINNET_RPC_URL` and `ROBINHOOD_MAINNET_RPC_URL`; the runner refuses success
unless executed rows equal the declared count with zero skips (DR Lens C #2). `enabled: false` stops
scripts, not reads. On the 42161 fork the asset is a test token deployed inside the fork and priced
through the ETH/USD route for the test only; no ETH market is claimed. Only after OF1 to OF8 pass,
recorded as evidence, may a surface say "Chainlink integration demonstrated on a fork". These are the
only fork-row ids for this layer: `F` is the factory namespace (`SPEC-CONTRACTS.md`), and `FO1–FO9`
is never used.

## 16. Open issues

Owner decisions are marked; the rest are implementation tasks that must close first.

1. The 46630 Uniswap v4 addresses are not in the evidence files; a reviewed commit records them.
2. The Arbitrum One feed descriptions are unrecorded; a read-only probe records them before OF1–OF8.
3. Resolved: `ARBITRUM_MAINNET_RPC_URL`, the name `foundry.toml` already defines, is the Arbitrum One
   RPC variable used throughout this spec set; `ARBITRUM_ONE_RPC_URL` is removed.
4. **Owner:** the sequencer `GRACE_PERIOD` (proposed 3600 s).
5. **Owner:** the minimum `A(maxAge)` for a crypto launch. (Whether the 300 s `MAX_ORACLE_AGE`
   ceiling is ever raised for a 1755 s heartbeat feed is decided by a ledger amendment and a new
   release, ledger S4 — not a routine per-market toggle.)
6. **Owner:** whether a testnet Streams route may treat uTUSD as USD by declaration (never mainnet).
7. **Owner, with counsel:** an equity `maxAge`, an exchange calendar, wider Streams sessions (rec
   27); all wait on Q20 and Q23.
8. The Robinhood token raw-balance versus feed-unit relation (DR Lens A #7) is unproven.
9. No 42161 asset token address and no 42161 VerifierProxy address is in the evidence.
10. `script/unica-v4/chain.sh` and `script/unica-v4/feed-cadence.sh` are to be written; CI needs `jq`.
11. Registry size and hook gas with the oracle additions are unmeasured; prototype sizes are
    feasibility evidence only, and the implementation re-measures.
12. The low side of the band also counts price impact. With a $100 seed (Q14) and $10 per
    transaction (Q5 to Q7), impact alone may approach a 200 bps band; the implementation measures
    impact over the configured seed and caps before any policy value is proposed for mainnet. A
    market whose price exits its recorded liquidity range is paused and replaced with a new version
    (ledger S6); it is never reseeded, widened or recentred.
13. Resolved by ledger S4: `MAX_ORACLE_AGE = 300` is an on-chain registry ceiling, not merely a
    script-level control (§3). **Owner, still open:** whether a Streams report is verified inside
    `pay`, which changes the executor's ABI, instead of bounding the submitter's choice by `maxAge`
    (§8).
14. **Owner:** whether U7 monitoring runs for the 46630 rehearsal's ACTIVE market or is mainnet-only,
    and who pauses on 46630, where PAUSER is zero (ADMIN, the deployer EOA, can pause).
15. The U7 pins (uTUSD, TSLA implementation, Arbitrum USDC) and every `deviationThresholdBps` are
    `null`: a read-only probe records them in evidence before the helper can pass the chain concerned.
