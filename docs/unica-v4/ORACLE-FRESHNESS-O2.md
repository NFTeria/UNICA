# Per-leg oracle freshness

Owner ruling of 2026-09-12. This document states what the rule is, where it is enforced, why it is
enforced there and not somewhere else, and what a deployer has to do before a market that depends on
it can go live. It is written against the code in
`src/unica-v4/oracle/ChainlinkFeedAdapter.sol` and the rows in
`test/unica-v4/oracle/ChainlinkFeedAdapter.t.sol`.

## The problem this fixes

A cross price is read from two feeds. The asset leg and the quote leg are two separate products with
two separate publishing schedules, and both can be behaving exactly as designed while one is minutes
old and the other is hours old. A major asset feed may update every few minutes. The stablecoin feed
behind a payout unit may update roughly once a day and be perfectly healthy the whole time.

The adapter used to fold that into one number: it reported the OLDER of the two publish times, and
the hook applied the market's single `maxAge` to it. That has only two settings and both are wrong.

- Set the market's `maxAge` to the fast leg's heartbeat and the slow leg drags every reading past it.
  Every settlement refuses. This is not hypothetical: the measurement recorded in
  `config/unica-v4/11155111.env` on 2026-09-12 found the Sepolia asset feed 855 seconds old and the
  Sepolia stablecoin feed about ten hours old, against an on-chain ceiling of 300 seconds. An
  oracle-enabled market on those two feeds would have refused essentially every sale.
- Set it to the slow leg's schedule and a frozen asset feed passes unnoticed behind a healthy quote
  feed, which is the exact failure the freshness check exists to catch.

One bound cannot describe two heartbeats. So there are two bounds.

## The rule

`ChainlinkFeedAdapter` takes two freshness bounds in its constructor, `assetMaxAge` and
`quoteMaxAge`, both `uint48` seconds. The asset bound is immutable. The quote bound is an immutable
CEILING with a downward-only lever under it (see "The quote leg's own lever" below). `latestPrice` refuses, fail-closed, if either
leg is older than ITS OWN bound, and the refusal names the feed that was stale:

```
error FeedStale(address feed, uint256 updatedAt, uint256 maxAge);
```

Alongside the bound, and unchanged from before, each leg is still refused if its answer is
non-positive, if its round is incomplete (`answeredInRound < roundId`), if either timestamp is
missing, if the feed cannot be read, if its `decimals()` is above 18, or if the answer is too large
to multiply safely. New with this ruling: a publish time later than the block reading it is refused
as `FeedTimestampInFuture` rather than treated as maximally fresh, because it is a state the contract
cannot reason about.

### Where it is enforced, and where it is not

In the ADAPTER. The hook is frozen and is not touched by this ruling. The hook keeps applying the
market's `policy.maxAge` to the timestamp the adapter reports, exactly as before.

WHICH LEG EACH CEILING REACHES, EXACTLY. The timestamp the adapter reports is the ASSET leg's, so
`policy.maxAge` bounds the ASSET LEG AND NOTHING ELSE. An earlier version of this table said "two
independent ceilings and the stricter one wins", and the adapter's own note said a market "may be
stricter than the adapter but never looser". Both were true of the asset leg and false of the quote
leg, whose age is not in the value the hook receives at all. The practical consequence of the false
reading is the one worth naming: `UnicaMarketRegistry.tightenOraclePolicy`, the market's emergency
lever, does nothing whatsoever to the quote leg — which is the stablecoin leg, and therefore exactly
the one an operator would reach for during a depeg.

| Ceiling | Set by | Applies to |
|---|---|---|
| `assetMaxAge` | the adapter's deployer, at construction, immutable | the ASSET leg's own publish time |
| `QUOTE_MAX_AGE` | the adapter's deployer, at construction, immutable | the ceiling on the QUOTE leg's own publish time |
| `quoteMaxAgeInForce` | the optional quote-freshness operator, downward only | what the QUOTE leg is actually checked against right now |
| `policy.maxAge` | the market's admin, on chain, capped at 300 s by ruling S4 | the ASSET leg only, by way of the timestamp the adapter reports |

### The quote leg's own lever

Because `policy.maxAge` cannot reach the quote leg, the adapter carries the only on-chain response
to a quote-leg incident. `ChainlinkFeedAdapter` takes a ninth constructor argument,
`quoteFreshnessOperator`, and exposes one function:

```
function tightenQuoteMaxAge(uint48 next) external;   // QUOTE_FRESHNESS_OPERATOR only
```

What it can do: lower `quoteMaxAgeInForce`, which starts at `QUOTE_MAX_AGE`. What it cannot do:
raise it (`QuoteMaxAgeNotTighter`), set it to zero, run on a DIRECT-MODE instance with no quote leg
(`NoQuoteLegToTighten`), be called by anybody else (`NotQuoteFreshnessOperator`), touch the asset
leg, change a feed, or make any reading pass that the immutable ceiling did not already allow. It
emits `QuoteMaxAgeTightened(previous, next)`. There is no way back up, deliberately, and for the
same reason `tightenCaps` and `tightenOraclePolicy` have none: an over-tightened bound refuses
settlements loudly, where a loosening lever would let one account quietly widen what a settled
market accepts. Recovering from an over-tightening is a new adapter and a new market, exactly as
changing any other part of the route is.

**Naming no operator is the default and means no lever.** `script/unica-v4/DeployPublic.s.sol` reads
`UNICA_QUOTE_FRESHNESS_OPERATOR` with `vm.envOr(..., address(0))`, so a deployment that does not set
it produces an adapter with no admin of any kind, exactly as every instance was before this. The
local Anvil script names its own admin, so the demonstration has the lever.

### What `updatedAt` means now

The adapter returns the ASSET leg's own publish time, not the older of the two.

This is the part worth being explicit about. The quote leg's staleness has already been enforced,
here, against the bound that was reviewed for that specific feed. Folding it into the returned
timestamp would then subject it a second time to the asset leg's tolerance by way of the market's
`maxAge`, which is precisely the refuse-everything behaviour this ruling removes. What the hook
receives is therefore the answer to the question it is actually asking: how old is the price of the
thing being sold.

### DIRECT MODE

`quoteFeed == address(0)` means the asset feed already prices the asset in the payout unit and no
cross is computed. In that mode `quoteMaxAge` must be zero, and a non-zero value is refused
(`QuoteMaxAgeWithoutQuoteFeed`) rather than silently ignored: a bound that governs nothing is a
configuration mistake. `isDirectRoute()` reports which mode an instance is in. In direct mode no
second feed is read at all, which the tests prove by breaking the quote feed and reading anyway.

### No default bounds, ever

`assetMaxAge` must be non-zero, and so must `quoteMaxAge` whenever there is a quote leg; otherwise
the constructor refuses with `MaxAgeRequired(feed)`. There is deliberately no default anywhere in the
deploy path: `script/unica-v4/DeployPublic.s.sol` reads `UNICA_ASSET_MAX_AGE` and
`UNICA_QUOTE_MAX_AGE` with `vm.envOr(..., 0)`, so an unset value is zero and the deploy stops at the
constructor.

**300 and 86400 are NOT production-approved constants.** They appear in
`config/unica-v4/example.env`, in `config/unica-v4/11155111.env` and in the local Anvil script as
illustrations of the SHAPE of an answer — a fast asset leg, a slow quote leg — and nothing more. The
Sepolia file marks both as NOT YET VALIDATED. Before a market goes oracle-on, the deployer reads the
heartbeat and deviation threshold Chainlink publishes for that specific feed on that specific
network and sets a bound at least as large as the heartbeat, and the owner signs it off.

## A freshness policy change is a new market

`feedIdFor` commits to the whole route:

```
keccak256(abi.encode("CHAINLINK_FEED", assetFeed, quoteFeed, assetMaxAge, quoteMaxAge,
                     quoteFreshnessOperator, asset, quote, chainid))
```

The two ceilings are inside the identity on purpose. A freshness policy is part of what a price
means, so changing one second of either ceiling produces a different `feedId`. There is no setter for
either, so changing one means deploying a NEW adapter, which yields a new `feedId`, which the
registry binds into a new `marketId`. The registry checks the commitment at `register` and the hook
repeats it on every swap, so a market cannot be quietly moved onto a different policy.

The OPERATOR is in the identity for the same reason, and this is the honest reading of the one
mutable value on the contract. What the id commits to is: *the quote leg is never older than
`QUOTE_MAX_AGE`, and this named account may make that stricter.* An adapter with a lever and an
otherwise identical adapter without one are two routes, so a market registered against one can never
be pointed at the other. `quoteMaxAgeInForce` itself is deliberately NOT in the id — folding it in
would change the id the moment an operator tightened, and break the very market the tightening was
meant to protect. A tightening can only refuse readings the ceiling already allowed, so the id's
promise stays exactly true after one.

The consequence that matters for the record: a market registered under the old bounds keeps pointing
at the OLD adapter, which is untouched, still deployed, still reporting its original `feedId` and its
original bounds. Its settled history stays interpretable under the policy it was actually settled
under. The chain id is in the identity too, so the same two proxy addresses on two networks are two
routes rather than one.

## What is proven, and how

`test/unica-v4/oracle/ChainlinkFeedAdapter.t.sol`, 26 rows, all passing. Every negative row sits
beside the control that differs from it in exactly one field, in the same function, because a revert
on its own cannot tell a working check from a fixture that never reached it. Every price in the file
comes from `FixtureAggregator`: settable, unsigned, not authenticated pricing, no value, no claim
about any real asset.

| What it proves | Row |
|---|---|
| fresh direct | `test_O30_freshDirectRoute` |
| stale direct | `test_O30_staleDirectRouteIsRefused` |
| fresh two-leg, asset timestamp reported | `test_O30_freshTwoLegReportsTheAssetLegsTimestamp` |
| stale asset leg, quote leg fresh | `test_O30_staleAssetLegIsRefusedAgainstItsOwnBound` |
| stale quote leg, asset leg fresh | `test_O30_staleQuoteLegIsRefusedWhileTheAssetLegIsFresh` |
| non-positive answer, either leg | `test_O28_answerNotPositive` |
| incomplete round, either leg | `test_O28_carriedOverRound` |
| answer out of range, either leg and direct | `test_O30_answerOutOfRange` |
| publish time in the future | `test_O30_timestampInTheFutureIsRefused` |
| bounds cannot be defaulted or ignored | `test_O30_constructorRefusesUnreviewedFreshnessBounds` |
| policy mismatch: a changed bound is a new feedId | `test_O30_feedIdChangesWhenAFreshnessBoundChanges` |
| historical stability: the old adapter is unmoved | `test_O30_anOldAdaptersFeedIdSurvivesTheNewPolicy` |
| the quote lever refuses a reading it used to accept | `test_O31_tighteningTheQuoteBoundRefusesAReadingItUsedToAccept` |
| the lever cannot loosen, and belongs to nobody else | `test_O31_theQuoteLeverCannotLoosenAndBelongsToNobodyElse` |
| DIRECT MODE has no quote bound to tighten | `test_O31_directModeHasNoQuoteBoundToTighten` |
| the operator is in the route id, the tightening is not | `test_O31_theOperatorIsInTheRouteIdAndTheTighteningIsNot` |
| the market ceiling reaches the asset leg only | `test_O1_theMarketCeilingReachesTheAssetLegAndTheQuoteLegHasItsOwnLever` (`test/unica-v5/DirectSettlementAttacks.t.sol`) |
| wrong feed id refused at registration | `test_O29_secondRouteIsADifferentFeedIdAndTheRegistryRefusesTheMismatch`, `test_O30_registryRefusesAMarketWhoseFreshnessPolicyMoved` |

The freshness rows were validated by sabotage, twice, because a check that has never failed is not a
check:

1. Deleting the `FeedStale` line failed exactly four rows (the three stale rows and the historical
   stability row, which asserts the replacement adapter's tighter bound bites) and left the other 18
   passing.
2. Reporting a timestamp one second off the asset leg's failed five rows, including the two that
   state which leg's time is returned.

Both sabotages were reverted and the suite returned to 22 passed, 0 failed. The four rows the quote
lever added on 2026-09-12 bring the file to 26 passed, 0 failed.

## Still open

- `_guards()` in `script/unica-v4/DeployPublic.s.sol` requires `UNICA_QUOTE_FEED` to be a contract,
  so DIRECT MODE cannot yet be deployed through that script even though the adapter supports it. The
  adapter is not the blocker; the guard is. Changing it is outside this slice's file ownership and is
  named here rather than done quietly.
- Neither Sepolia bound has been validated against a published heartbeat. Until that happens the
  Sepolia rehearsal stays `UNICA_REQUIRE_ORACLE=false`, a demonstration market on a testnet.
