# UNICA v4 — test matrix

Draft for owner review, uncommitted, authorising nothing (Q131). Bound by `docs/unica-v4/DECISIONS.md`; it never
contradicts `SPEC-CONTRACTS.md` (cited SC §n) or `SPEC-ORACLE-AND-CHAINS.md` (SO §n), and §3 records how their
former oracle disagreements are reconciled. Evidence: `docs/unica-v4/evidence/DESIGN-REVIEW.md` (DR; critique findings
A1–A16, B1–B10, C1–C20), `CHAINLINK-AVAILABILITY.md` (CA), `MAINNET-CAPABILITY-PROBE.md` (MCP). "UNICA v4" is the
release; "Uniswap v4" is the AMM. The frozen generation (tag `experimental-46630-settled`, commit `e5a0185`) is not
UNICA v4, and no row modifies it. Every size, gas figure or count taken from DR was measured on a prototype outside
this repository; the implementation re-measures. Faucet stock tokens and uTUSD have no real-world value; an opening
rate is a demonstration rate the admin sets; a test-fixture rate is neither. Chainlink is **planned**; only §9 can
earn the exact wording "Chainlink integration demonstrated on a fork".

**What this file is.** The named rows that prove UNICA v4. Ids are stable, cited by `THREAT-MODEL.md`, never reused;
a dropped row keeps its id, marked dropped. **Nothing here has been run**: no row is claimed passing.

## 1. Blockers

None blocks writing this matrix. Each blocks running, writing as code, or relying on the rows named.

| # | Ledger or evidence item | State | What it blocks here |
|---|---|---|---|
| B1 | Q132 | unanswered | No mainnet stage exists to gate. A fork of a mainnet chain is never evidence of a deployment. |
| B2 | Q9 | OPEN | Arbitrum One is forked as a demonstration chain only (§9); `config/chains/42161.json` stays `enabled: false`, and G6 asserts it. |
| B3 | Q64, Q70, Q71 | NOT READY | Every mainnet readback row and every Safe row on a live chain. R3b and R5 prove the role rules locally only. |
| B4 | Q91 | NOT SELECTED | A provider behind `ARBITRUM_MAINNET_RPC_URL` and `ROBINHOOD_MAINNET_RPC_URL`. Without them as CI secrets (rec 93), §9 cannot run in CI and the fork wording cannot be earned there. |
| B5 | Q95 | NOT PROVIDED | Any real Data Streams report. O21–O25 run against a local verifier and forwarder stand-in only; no fork Streams row exists. |
| B6 | Q110, NFLX rate | NOT SELECTED | Any NFLX market file under `script/unica-v4/` and any live NFLX row. N1, N2 and V1 use a rate that lives only under `test/unica-v4/`, labelled "test fixture — not an approved demonstration rate". |
| B7 | Q110, merchant control | UNKNOWN / NOT PROVIDED | Any wording about who controls `0x19E56831a10d43CfF5d77f886c799C6b916da7Ae` (source: DECISIONS.md Q110). V0 uses it only as a recipient inside a fork. |
| B8 | Q16, Q20, Q23 | no issuer; NO CONFIRMED REVIEW; no licence | Any equity oracle route. OF9 is read-only; G6 plants an equity route and requires the refusal. |
| B9 | Q131 | NO AUTHORIZATION | Publishing any evidence file these rows produce. |
| B10 | 46630 Uniswap v4 addresses | not in the evidence files (SO §16 item 1) | Every §7 row and V1: the chain helper refuses a `null` required address. |
| B11 | Fork pins | no block number or hash is recorded for 46630, 42161 or 4663 | `test/fork/ForkPin46630.sol`, `ForkPin42161.sol`, `ForkPin4663.sol` hold PENDING until a read-only probe records each in evidence. No row runs against `latest` (C1). |
| B12 | Arbitrum One feed descriptions | `null` (SO §7.1, §16 item 2) | OF1's description pin, and so OF1–OF8. |
| B13 | NFLX look-alike token addresses | not in the evidence (DR C8 reports "at least five", scouted) | V3. No address is invented for it. |
| B14 | Reconciliation of SC and SOC (§3) | **RESOLVED**: one selector and one semantics for every line of the former table, per `DECISIONS.md` ("Specification choices", S1–S8) and its canonical choices | Nothing. O1–O29, X19, EV6, EV7, OF3–OF8, the oracle H rows and the receipt's oracle-field assertions are written against the resolved selectors of §3. |
| B15 | Frozen-gate baseline | `git diff` against the tag is non-empty today | G1 in its literal "diff exits 0" form fails on this branch: commits `eea86d2` and `903a8c9`, after the tag, changed NatSpec in `UnicaStockSettlementHook.sol` and `UnicaStockSettlementExecutor.sol` and added to `docs/experimental/` (read-only `git diff --stat`, 4 files, 124 insertions, 3 deletions). Tags are never moved. G1 therefore pins the reviewed post-tag diff by hash (§11), and the owner confirms that form. Every live stage requires G1. |

## 2. Rules every row obeys

1. **Precondition and control** (C5). A negative row puts the attacker in their real starting position (funded,
   approved, on a seeded ACTIVE market); its control, in the same test, passes with only the refused element changed.
   It asserts the inner selector and the emitter, unwrapping `WrappedError`; never a bare `vm.expectRevert()`.
2. **Names.** `test_<ID>_<Name>`, `invariant_<ID>_<Name>`; shell rows print their id. G8 enforces the mapping.
3. **Stated counts.** Every report states run, passed, failed and skipped; an empty or all-skipped result fails.
4. **Real parts.** The real factory and salt mining; the official PoolManager bytecode from hookmate's artifact;
   MockERC20s placed by `deployCodeTo` to force an ordering; the frozen hostile tokens in
   `test/experimental/util/TestAssets.sol` imported read-only, never copied; `MockOracleAdapter` in local rows only.
5. **Runs.** Fuzz at the profile's `runs = 10000` (`foundry.toml` is unchanged; changing it trips G1); invariants at
   the profile's defaults, each suite asserting non-vacuity (§6).
6. **No file reads** (`fs_permissions = []` stays): a constant from a committed record is a literal, cross-checked
   offline by G9.
7. **Fork rows** fork a pinned block (B11), name their RPC variable, and assert the pin's code hashes first; the
   `UNICA_FORK_BLOCK` override recorded in `test/fork/ForkPin.sol` applies. A skip is legal in `forge test` and
   never counts towards §12.
8. **Where rows live.** `test/unica-v4/` joins `make gate` (CI, no local state). Fork suites live under `test/fork/`,
   which the gate excludes: `UnicaMarkets46630Fork.t.sol`, `UnicaOracle42161Fork.t.sol`, `UnicaOracle4663Fork.t.sol`.

**Row-id reconciliation.** The two specifications and DR reuse letters; this matrix gives every row one id.

| This matrix | SC | SO | DR | Why |
|---|---|---|---|---|
| F1–F23, factory | F18 | — | F1–F17, F1b, F1c | DR, an immutable evidence record, and SC both use F for the factory. F22 and F23 are new, for S7's decimals-from-tokens change. |
| OF1–OF9, oracle fork | — | F1–F8, F9 | — | Renamed to free F; applied throughout this file and in SO §15 (§14). |
| O1–O25, oracle unit | — | O1–O25 | — | Unchanged. |
| O26, band spend | "O9" (§8.3) | O9 is a tighten row | — | SC's single citation collides with SO's block. |
| X9a–X9d, re-entry | X9a–X9d | — | X9 is the forged callback | SC wins; the forged callback is X12. |
| MUT-nn, mutants | M-fee-1, M-fee-2 | — | M4, H13 as sabotage | Mutants get their own namespace; M rows are math rows. SC's two names are kept. |
| EV1–EV10, event schema | — | — | — | `EVENT-SCHEMA.md` §13's ids, kept (§4.8); that file leaves final numbering here. |

**Citations from `THREAT-MODEL.md`.** It cites `SC:`, `SO:` and `DR:` rows by this matrix's final id after the
prefix, which records only the origin (`SO:OF5`, `SC:O26`, `DR:X12`; DR's rounding sabotage as MUT-50, MUT-51). Its
proposed rows are adopted as follows, and G8 resolves each through this list: TM-1 → G17 and EV8; TM-2 → R8 with R6;
TM-3 → X18; TM-4 → X13; TM-5 → F20; TM-6 → X19; TM-7 → R3 and R3b; TM-8 → V12; TM-9 → OF8 and O28; TM-10 → OF8
and O28; TM-11 → O29; TM-12 → O27; TM-13 → I7 and I9; TM-14 → V13; TM-15 → G18; TM-16 → X13; TM-17 → F21. Dropped,
with its reason: TM-1's check of each market's adapter against the reviewed chain file, because UNICA v4 builds no
read layer; it binds the first one built (THREAT-MODEL §12 item 12).

## 3. SC and SOC, reconciled

The rows below name a refusal by its condition and the one resolved selector or rule the two specifications now
share, per `DECISIONS.md` ("Specification choices", S1–S8) and its canonical choices (B14, resolved). The rows of
§4.6 and §9 use these names directly, with no diverging mark. `IMPLEMENTATION-PLAN.md` §3 keeps the former SR1
numbering (rows 1–13) for citation; still open there, and touching nothing below, are SR1 rows 15 (chain-file
source prefixes), 16 (receipt documentation home) and 17 (determinism pin).

| Condition | Resolved selector or rule |
|---|---|
| Oracle required but disabled | `OraclePolicyRequired(bytes32)` |
| Malformed policy | `OraclePolicyMalformed(bytes32)`; no code at the adapter, `OracleAdapterNoCode(bytes32, address)`; `maxAge` out of range, `OracleMaxAgeOutOfRange(bytes32, uint48)`; bps out of range, `OracleDeviationOutOfRange(bytes32, uint16)` |
| `feedId` against the adapter's route | checked on-chain at `register` (`OracleFeedMismatch(bytes32, bytes32 expected, bytes32 actual)`) and again by `_checkOracle` on every settlement; view `feedIdFor(asset, quote)` on `IUnicaOracleRoute`; also committed inside `marketId` (S8) |
| Tighten not tighter; policy disabled; market retired | `OraclePolicyNotTighter(bytes32)`; `OraclePolicyDisabled(bytes32)`; `WrongMarketStatus(bytes32, uint8 actual)` |
| Adapter revert inside `afterSwap` | propagates; only the PoolManager's `WrappedError(hook, selector, reason, details)` wraps it |
| Decimals and price bounds | `dO ≤ 18` (`OracleDecimalsUnsupported`); `p ≤ type(uint128).max` and the scaled product ≤ `type(uint128).max`, each `OraclePriceOutOfRange` |
| Timestamp equal to the block | refused, `OracleTimestampNotBeforeBlock(bytes32, uint256 updatedAt)` |
| Deviation | `ExecutionBelowOracleBand`, `ExecutionAboveOracleBand`; absolute `minAllowed`/`maxAllowed`, each rounded against acceptance |
| Value exactly on the band | accepted: `minAllowed ≤ o ≤ maxAllowed` |
| Condition view | `oracleCondition() returns (OracleCondition, bytes4 reason, uint256, uint8, uint256)` |
| Feed adapter errors | `SequencerStatusUnknown`, `PairNotSupported`, the `Feed*` set, `VerifierFeeManagerSet`, `NoVerifiedReport`, `ReportNotYetValid` |
| Feed adapter shape | one instance per route, constructor immutables, no admin beyond the optional downward-only quote-freshness operator (O2) |
| Receipt oracle fields | `referencePrice`, `referenceDecimals`, `referenceUpdatedAt` (`uint64`), `demonstrationOnly`; no feed-id field |

Both agree on everything the fixed interface decisions state: `latestPrice(asset, quote)` returning `(price,
decimals, updatedAt)`, a per-market policy read live, tighten-only, and a fail-closed check of price above zero, no
future timestamp, `age ≤ maxAge`, a two-sided band, and sequencer up past its grace period where a feed exists.

## 4. Unit rows (`test/unica-v4/`)

Columns: **Precondition** is the attacker's or the fault's starting state; **Refused → selector** is the call and its
inner selector; **Control** passes in the same test. A positive row has "—" in the first and last columns.

### 4.1 Registry (`UnicaMarketRegistry.t.sol`, SC §5, §6)

| ID | Precondition | Refused → selector, or asserted | Control |
|---|---|---|---|
| R1 | — | constructor: `admin`, `FACTORY == factory`, `REQUIRE_ORACLE` as passed; zero admin → `ZeroAddress` | non-zero admin constructs |
| R2 | caller is ADMIN, the strongest non-factory | `register`, `recordInitialized`, `recordSeeded` → `NotFactory`; also from a stranger | the same calls through the factory succeed |
| R3 | stranger, and PAUSER | `activate`, `unpause`, `retire`, `tightenOraclePolicy`, `tightenCaps`, `setOrderCreator`, `setPauser`, `transferAdmin` → `NotAdmin` | ADMIN succeeds on each |
| R3b | PAUSER set, market ACTIVE | PAUSER `unpause`, `retire` → `NotAdmin`; second `pause` → `WrongMarketStatus` | PAUSER `pause` succeeds; ADMIN also pauses directly; ADMIN unpauses (S2) |
| R4 | every (from, to) over the 7 stored values | all 49 pairs: only SC §5's eleven edges succeed; the rest → `WrongMarketStatus` or `UnknownMarket`; RETIRED has no exit | the eleven edges, each with its caller |
| R5 | pending admin named | stranger `acceptAdmin` → `NotPendingAdmin`; pending has no power before accepting; after it the old admin loses every power, the implicit order-creator right included; `transferAdmin(0)` → `ZeroAddress`; no renounce exists | old admin keeps every power until `acceptAdmin` |
| R6 | 0, 1, 100, 101 and 250 markets | `getMarkets`: empty, clamp, offset past the end returns empty, `limit` capped at 100, registration order, retired included | — |
| R7 | two chain ids via `vm.chainId`, two versions | `marketId == keccak256(abi.encode(block.chainid, registry, asset, payout, version, policy.adapter, policy.feedId))`; ids differ per chain, version, adapter and feedId; zero for a demonstration market (S8) | — |
| R8 | a live (asset, payout) market | second `createMarket` → `LiveMarketExists`; wrong version → `WrongVersion`; after RETIRE version 2 gets a new id, hook, executor and pool, the old record stays readable, and the old executor refuses every call with `MarketNotActive(id, 6)` | relisting after RETIRE succeeds |
| R9 | two registered markets | `marketIdOfHook`, `marketIdOfExecutor`, `marketIdOfPool` equal the id; zero for an unregistered address; the second market never changes the first's entries (C7) | — |
| R10 | — | exact topics and data of every registry event, `MarketStatusChanged(id, 0, 1)` at register included; topic0 pinned (C7) | — |
| R11 | `REQUIRE_ORACLE = true`, policy disabled | `createMarket` → `OraclePolicyRequired` | enabled valid policy creates; with `REQUIRE_ORACLE = false` the disabled policy stores `demonstrationOnly = true` |

### 4.2 Factory (`UnicaMarketFactory.t.sol`, SC §7)

| ID | Precondition | Refused → selector, or asserted | Control |
|---|---|---|---|
| F1 | stranger with a valid config and salt | `createMarket` → `NotAdmin` | ADMIN creates |
| F1b, F1c | stranger; old admin after `acceptAdmin` | `initializeMarket`, `markSeeded` → `NotAdmin` (C16) | new admin succeeds |
| F2 | pair live; also PAUSED; also a fresh salt | `createMarket` → `LiveMarketExists` | the pair after RETIRE |
| F3 | (asset, payout) live | the reverse pair gets a distinct id and is allowed | — |
| F4, F5 | creation code with one byte flipped (F4); a salt whose predicted address lacks `0x20C0` (F5) | → `WrongHookCode`; → `HookFlagsWrong`, before any code is deployed | the pinned code with a mined salt |
| F6–F8 | asset == payout; no code at either token; `decimals()` reverting, short, long, or 19 | → `SameToken`; `NoCode`; `DecimalsUnreadable` | 6, 8 and 18 decimals accepted |
| F22 | configured `expectedAssetDecimals`/`expectedPayoutDecimals` (`config/chains/<chainId>.json`) differing from the value each token's `decimals()` returns | → `DecimalsMismatch(token, expected, actual)` (S7) | matching configuration creates |
| F23 | — | the 288-byte hook constructor arguments decode to the same nine values `previewMarket` recorded, both decimals included (S7) | — |
| F9 | every `(fee, tickSpacing)` outside (500, 10), (3000, 60), (10000, 200), with (3000, 10), (1000000, 60) and the dynamic-fee flag among them | → `FeeTierUnsupported` (A12, A13) | the three tiers |
| F10 | rate 0; `1e36 + 1`; an opening tick outside the usable range | → `RateOutOfRange` | rate 395e18 |
| F11, F17 | — | `previewMarket` equals the stored record, hook arguments 288 bytes (F11); the script's predicted hook, executor, marketId and poolId equal the deployed ones (F17) | — |
| F12 | market INITIALIZED | second `initializeMarket` → `WrongMarketStatus` | first call returns `initTick`; `slot0.sqrtPriceX96 == initSqrtPriceX96` (DR decision 6) |
| F13 | no liquidity; a range one grid step short of the opening tick; `minDepth` above depth; `minDepth` 0 — both orderings | → `SeedTooShallow`; `ZeroMinDepth` | a seed at the opening tick |
| F14 | depth near `2^128` | narrowing is `SafeCast`: it reverts, never truncates (A10) | normal depth |
| F15, F16 | — | `HOOK_CREATION_CODE_HASH == keccak256(type(UnicaMarketHook).creationCode)`; `registry == CREATE(factory, 1)`, `executor == CREATE(hook, 1)` | — |
| F18 | the predicted hook address, before `createMarket` | `PoolManager.initialize` with that key → `InvalidHookResponse`; after `createMarket`, a stranger → `NotMarketFactory` (A5) | the factory initialises |
| F19 | caps 0; per-tx above per-day; seed cap 0 | → `CapsInvalid` | valid caps |
| F20 | market INITIALIZED, seed minted; a third-party LP adds depth at the opening tick before `markSeeded` | the recorded depth is never below the seed's L; today the call records ≥ L or → `SeedAboveCap`, and F21's change fixes the exact assertion | no third party: it records L |
| F21 | a stranger adds depth whose payout-equivalent exceeds `maxSeedPayout` between `initializeMarket` and `markSeeded` (THREAT-MODEL T-SET-20) | under SC's text today → `SeedAboveCap` and the market cannot seed; written once SC chooses a change, it asserts SEEDED with the seed position's own liquidity recorded (§14) | no stranger: it seeds identically |

### 4.3 Hook (`UnicaMarketHook.t.sol`, SC §8, §11)

| ID | Precondition | Refused → selector, or asserted | Control |
|---|---|---|---|
| H1, H2 | — | every factory hook has `address & 0x3FFF == 0x20C0` and matching `getHookPermissions()`; `EXECUTOR.HOOK() == hook` | — |
| H3, H4 | the exact official key from a non-factory (H3); sibling keys by a stranger, and with the test acting as the hook's factory (H4) | `PoolManager.initialize` → `NotMarketFactory`, emitted by the hook; → `NotMarketFactory`; → `NotTheMarketPool` | the factory initialises the official key |
| H5, H5b | seeded ACTIVE pool; a funded attacker using PoolSwapTest (H5), or a raw unlock contract (H5b) | swap → `NotSettlementExecutor` | the same amount through the executor settles |
| H5c | a raw swapper placed at market A's executor address in a state copy | swap on market B's pool → `NotSettlementExecutor(executorA)` from hook B (C18) | A's executor on A's pool settles |
| H6 | a stranger calling each callback directly | → `NotPoolManager` | the PoolManager's own callbacks during a settlement |
| H7–H9 | a harness executor at the `EXECUTOR` address | H7: `hookData` not 32 bytes → `MalformedHookData`. H8: wrong direction; wrong amount → `ParamsDoNotMatchOrder`. H9: a second swap of one order in one transaction → `OrderAlreadySwapped`; an Open, not Paying, order → `OrderNotInFlight`; past deadline → `OrderExpired` | one swap of a Paying order with matching params |
| H10, H11 | a seed smaller than the order (H10); `minOut` one unit above what the pool gives (H11) | → `PartialFill`; → `OutputBelowMinimum` from the hook, not the executor's `RecipientShort` | a large enough seed; `minOut` equal to delivery |
| H12a | default pool, protocol fee 0 | receipt `(0, 3000, 0, 3000)`; `swapFeePips == Swap.fee` in the same transaction | — |
| H12b | local PoolManager, the test its owner: `setProtocolFeeController(test)`, `setProtocolFee(key, 500 \| 1000 << 12)`; asset currency0 | receipt `(0, 3000, 500, 3499)`; `swapFeePips == Swap.fee`; `protocolFeesAccrued(input)` rose | — |
| H12c | the same, asset currency1 | receipt `(0, 3000, 1000, 3997)`; the same two equalities | — |
| H13 | order far larger than the seed at spacing 10, the smallest allowed | → `PartialFill` under a gas ceiling the implementation measures and pins (A13) | an order within the seed settles |
| H14 | — | the hook's external ABI is exactly the BaseHook callbacks plus SC §8.1's views (A4) | — |
| H15 | demonstration market | receipt reference fields zero, `demonstrationOnly == true`; topic0 pinned; `log.address == getMarket(id).hook` | — |
| H16 | a `pay` that reverts after the receipt (short-delivering payout token) | the transaction leaves no receipt and `receiptCount` unchanged: a receipt without `Settled` cannot survive | a settling `pay` emits exactly one of each |

H12a–H12c are prototype measurements (DR §1.2, §2), re-measured by the implementation, and on the never-drop list.

### 4.4 Executor (`UnicaMarketExecutor.t.sol`, SC §9)

| ID | Precondition | Refused → selector, or asserted | Control |
|---|---|---|---|
| X1 | both orderings | settles; recipient delta == `Settled.amountDelivered` == receipt `amountOut`; executor balances unchanged | — |
| X2 | order bound to payer A; stranger B holds balance and approval ≥ `amountIn` | B `pay` → `WrongPayer(id, A, B)` | A pays → `Settled` |
| X3 | the bound payer, funded; each reserved recipient (this, hook, PoolManager, both tokens, registry, factory) | `createOrder` → `ReservedRecipient`; zero → `ZeroRecipient`; on a settled order the payer and caller receive no payout | the named recipient receives |
| X4 | a settled order; the same creator and salt; market A's order id at market B's executor | second `pay` → `OrderNotOpen`; → `OrderExists`; → `UnknownOrder` | a different creator with the same salt gets a distinct id |
| X5 | `minOut` = quote × 0.99 at creation; then a third-party LP removes 50% of depth | `pay` → `OutputBelowMinimum` (hook); a payout token that delivers short → `RecipientShort` (executor) | boundary `minOut == actualOut` passes, `actualOut + 1` fails |
| X6 | status PROPOSED, INITIALIZED, SEEDED, PAUSED, RETIRED | `createOrder` and `pay` → `MarketNotActive` | an order created before a pause is paid after unpause; never after RETIRE |
| X7 | a stranger holding 10 asset-equivalents and a max approval, ACTIVE seeded market | `createOrder(self, large amountIn, minOut 1)` → `NotOrderCreator` | an allowlisted creator's order settles; a revoked creator cannot create and its open orders stay payable |
| X8 | fee-on-transfer input; false-return and empty-return tokens (hostile tokens imported read-only) | → `InputNotExact`; → `TransferFailed` | the same order settles once the fee is off |
| X9a–X9d | an input token whose `transfer` to the PoolManager, while it is unlocked, re-enters (A6) | X9a `PM.sync(payout)` → `SettlementDidNotClose`; X9b `PM.settleFor(executor)`: the row asserts which occurs, a revert or zero executor deltas with nothing moved; X9c `PM.swap` on the market key → `NotSettlementExecutor`; X9d `PM.modifyLiquidity`: delivery and receipt unchanged | an honest token settles |
| X10, X11 | order past its deadline; a past deadline at creation; allowance one unit short | → `OrderExpired`; `DeadlineInPast`; `AllowanceTooLow` | a future deadline; exact allowance |
| X12 | a forged `unlockCallback` from a stranger; a callback for an order not Paying | → `NotPoolManager`; → `OrderNotInFlight` | the PoolManager's own callback |
| X13 | zero payer; zero amount; zero `minOut`; amount, then `minOut`, `uint128(type(int128).max) + 1` | → `ZeroPayer`; `ZeroAmount`; `ZeroMinOut`; `AmountTooLarge` (A11) | `uint128(type(int128).max)` passes validation; a non-zero payer is accepted |
| X14 | a hostile payout token leaving a residual on the executor | → `ExecutorResidualPayout`; likewise `ExecutorResidualInput` | a donation made before `pay` does not block it (residuals are snapshot-relative) |
| X15, X16 | a stub at the hook address that never increments `receiptCount` (X15); an input token charging a fee only on transfers to the PoolManager (X16) | → `NoReceipt`; → `SettlementDidNotClose` | the real hook; an honest token |
| X17 | a hostile input token whose `transferFrom` re-enters `pay` for a second open order | → `Reentered` | both orders settle one after the other |
| X18 | an id never created at this executor | `pay` → `UnknownOrder`; once created, `orders(id)` equals every field of this executor's own `OrderCreated` | the created order settles |
| X19 | ACTIVE market, an open order; the seed LP removes all its liquidity | `pay` → a named refusal (`PartialFill`, `OutputBelowMinimum` or `ExecutionBelowOracleBand`); payer and recipient balances unchanged; the order still Open | with the seed in place the order settles |
| X20 | ACTIVE market, an order sized to exactly consume the payout-side depth inside the recorded seed range | that order settles; a second order one raw payout unit larger, in the same state, → a named refusal (`PartialFill`, `OutputBelowMinimum` or a band error); payer and recipient balances unchanged, the order still Open (S6) | the exact-consuming order alone settles |

### 4.5 Caps (`UnicaMarketCaps.t.sol`, SC §9.2)

Each K row runs on an ACTIVE seeded market with an allowlisted creator and the bound payer, so only the cap refuses.
Equal passes; one base unit over fails.

| ID | Precondition | Refused → selector | Control |
|---|---|---|---|
| K1 | `minOut == maxPerTxPayout + 1` | `createOrder` → `OrderAboveCap` | `minOut == maxPerTxPayout` |
| K2 | `minOut` under the cap, delivery one unit above it | `pay` → `PaymentAboveCap` | delivery equal to the cap |
| K3 | `payoutUsedOnDay[day]` plus this delivery exceeds `maxPerDayPayout` by one | → `DailyCapExceeded`, still at timestamp `(d + 1) × 86400 − 1`; at `(d + 1) × 86400` (00:00 UTC) the new day starts at zero | the sum exactly equal |
| K4 | seed payout-equivalent `maxSeedPayout + 1` | `markSeeded` → `SeedAboveCap` | equal to the cap |
| K5 | an open order; then `tightenCaps` below its delivery | `pay` → `PaymentAboveCap`; a refused `pay` leaves `payoutUsedOnDay` unchanged; the payer's balance is unchanged, nothing trapped | before tightening the order settles |
| K6 | ADMIN loosening; per-tx above per-day; RETIRED market | `tightenCaps` → `CapsNotTighter`; `CapsInvalid`; `WrongMarketStatus`; `CapsSet` exact on success | a strictly lower pair |
| K7 | a settled receipt and its day's `payoutUsedOnDay`; ADMIN attempts to raise `maxPerTxPayout`, `maxPerDayPayout`, or reseed `maxSeedPayout` | no function accepts a higher value: `tightenCaps` → `CapsNotTighter` unless every component is unchanged or lower with at least one strictly lower; `maxSeedPayout` has no setter at all; the settled receipt's fields, `payoutUsedOnDay` history and past `CapsSet` logs are unchanged after a later tighten (S3) | tightening to a strictly lower pair succeeds and settled history is untouched |

### 4.6 Oracle, local (`UnicaOracle.t.sol`, `adapters/*.t.sol`; SO §3–§10, SC §8.2)

O1–O25 are SO §15's rows under their ids (O18, a fuzz row, is in §5). Local rows use `MockOracleAdapter` or local
stand-ins for an aggregator, verifier or forwarder; they prove UNICA v4's checks, never a claim about Chainlink (SO
§10). Every O row uses the resolved names of §3.

| ID | Precondition | Refused → selector | Control |
|---|---|---|---|
| O1–O6 | one fault each: required but disabled; disabled with non-zero fields; adapter without code; `feedId` not the adapter's route; `maxAge` 0 or above 300; bps 0 or above 300 | `createMarket` → `OraclePolicyRequired`; `OraclePolicyMalformed`; `OracleAdapterNoCode`; `OracleFeedMismatch`; `OracleMaxAgeOutOfRange`; `OracleDeviationOutOfRange` (S4) | a valid enabled policy creates |
| O7, O8 | live market, enabled policy | O7: each loosening of `maxAge` or bps, and an unchanged pair → `OraclePolicyNotTighter` | O8: each tightening is accepted and binds the very next swap (the policy is read live) |
| O9, O10 | RETIRED market; disabled policy | O9: tighten on a RETIRED market → `WrongMarketStatus` | an ACTIVE market tightens; O10: the event's exact fields (`OraclePolicySet`'s full state, EVENT-SCHEMA §4.4) |
| O11–O15 | one fault each, everything else valid: price 0; decimals one above the bound (19); `updatedAt = now + 1`; `updatedAt == block.timestamp`; `age == maxAge + 1` or `updatedAt == 0` | `pay` → `OraclePriceZero`; `OracleDecimalsUnsupported`; `OracleTimestampInFuture`; `OracleTimestampNotBeforeBlock`; `OracleStale` | the same order with its one fault removed settles; `age == maxAge` settles |
| O16 | fresh positive price; output one unit below the low bound | → `ExecutionBelowOracleBand` | output exactly on `minAllowed`, which passes (§3) |
| O17 | the same, one unit above the high bound | → `ExecutionAboveOracleBand` | output exactly on `maxAllowed`, which passes (§3) |
| O19, O20 | ACTIVE with each adapter failure, PAUSED, RETIRED (O19); policy disabled (O20) | O19: `oracleCondition()` maps `MarketClosed` → MARKET_CLOSED and every other failure → STALE_ORACLE; PAUSED and RETIRED override. O20: receipt oracle fields zero, `demonstrationOnly` true, no adapter call | a fresh reading reads OK |
| O21–O23, O25 | Streams on a stand-in verifier: a replayed or older report (O21); past `expiresAt`, at submission and at read (O22); status closed or unknown (O23); a non-zero fee manager, wrong feed id, wrong schema, not yet valid (O25) | → `ReportNotNewer`; `ReportExpired`; `MarketClosed`, unknown never accepted; `VerifierFeeManagerSet`, `ReportFeedMismatch`, `ReportSchemaUnsupported`, `ReportNotYetValid` | a newer, unexpired, open, clean report is stored and read |
| O24 | CRE: wrong forwarder; workflow id or owner mismatch; the chain's simulation forwarder in the constructor | → `NotForwarder`; `WorkflowMismatch`, `WorkflowOwnerMismatch`; `ForwarderIsSimulationOnly` | the pinned forwarder and workflow |
| O26 | the maximum per-transaction payment on the maximum seed, repeated | payments halt with `ExecutionBelowOracleBand` or `ExecutionAboveOracleBand` exactly where the independent computation says the band is spent; the script's estimate refuses a config whose per-transaction impact plus one grid step exceeds bps (SC §8.3) | the first payment settles at the configured bps |
| O27 | an adapter that tries a storage write inside `latestPrice` | the STATICCALL fails and `pay` refuses with the propagated adapter revert, wrapped by the PoolManager's `WrappedError`: no fee or state can change between the two `slot0` reads (A14) | a `view` adapter settles |
| O28 | `ChainlinkFeedAdapter` on local aggregator stand-ins: answer ≤ 0; `updatedAt` or `startedAt` 0; `answeredInRound < roundId`; decimals or description changed; a reverting feed; sequencer answer 1, `startedAt` 0, inside grace; issuer `oraclePaused()` true or unreadable | each → its named refusal | a clean route returns `min(tA, tQ)` and the cross price at 18 decimals, over 6-, 8- and 18-decimal feeds |
| O29 | an adapter asked for (payout, asset); a mock returning the inverse of the configured reference, both orderings | reversed arguments → `PairNotSupported`; the inverse reading → `ExecutionBelowOracleBand` or `ExecutionAboveOracleBand` | the correct reference settles |

### 4.7 Math, matrix and identity (`UnicaMarketMath.t.sol`, `UnicaMarketMatrix.t.sol`, `UnicaMarketSpoof.t.sol`)

| ID | Precondition | Refused → selector, or asserted | Control |
|---|---|---|---|
| M1 | TSLA shape: 18 → 6 decimals, asset currency0, rate 395e18, spacing 60 | opens at tick −216540, `sqrtPriceX96` 1574013010446814381915148, 394.691222 uTUSD per TSLA; seed range [−223500, −216540] (DR §1.2) | — |
| M3, M5, M6 | out-of-range inputs (M3); both orderings (M5) | M3: each → its named error. M5: the seed range's near edge equals the opening tick; `seedWidth` gives `ceil(6960 / spacing) × spacing` for a demonstration market and 120 at 200 bps and spacing 60 (SC §7). M6: a first tiny swap delivers ≥ spot × (1 − swapFee) × (1 − 1e−4) | in-range inputs |
| MX1 | the 18 markets {6, 8, 18}² × 2 orderings, through factory, seed, activate and pay | opening price exact: `sqrtP² · den ≤ num · 2^192` (inverse for currency1) by 512-bit `mulDiv`, zero tolerance; delivered ≤ `floor(amountIn · openRate · (1e6 − swapFee) / 1e6)`; delivered ≥ 98.5% of configured, the prototype's measured bound (DR §1.2; exactness per C15) | — |
| S1 | an attacker factory CREATE2-deploys the UnicaMarketHook source with the official marketId, initialises its pool, settles one order | its receipt carries the official id; `marketIdOfHook`, `marketIdOfPool`, `marketIdOfExecutor` are all 0 for it; the emitter check refuses its receipt; with the official registry as its argument, its executor's `createOrder` → `NotOrderCreator` (C6) | the emitter check accepts the real hook's receipt |

### 4.8 Event schema (`UnicaMarketEvents.t.sol`; `EVENT-SCHEMA.md` §13)

EVENT-SCHEMA §13's rows under their ids, each with the sabotage stated there. EV1–EV7's sabotages are mutants MUT-52
to MUT-58 (§10.2); EV8's and EV10's are their own self-tests; EV9 is an equality row with none. They extend the rows
named, never replace them.

| ID | Asserted | Extends |
|---|---|---|
| EV1 | each event's selector equals its recorded topic0, held as a literal (rule 6) | R10, H15 |
| EV2 | each log's topic count, per EVENT-SCHEMA §13 | R10 |
| EV3 | `createMarket` emits exactly the four registry logs in EVENT-SCHEMA's fixed order with exact data, and nothing from the hook, executor or factory | R10 |
| EV4 | each SC §5 transition emits one `MarketStatusChanged(from, to)`; each refused pair of R4 emits none | R4 |
| EV5 | one receipt from the hook, one `Settled` from the executor, `Settled` last; the amounts agree with each other and the recipient's balance change; `swapFeePips == Swap.fee`; a refusal leaves `receiptCount` and the log count unchanged | X1, H12a, H16 |
| EV6 | a disabled policy gives zero reference fields and `demonstrationOnly` true; an enabled one gives the adapter's exact reading, the mock locally and the real feeds on OF2 | H15, O20, OF2 |
| EV7 | each tightening emits one full-state `OraclePolicySet` or `CapsSet` event (EVENT-SCHEMA §4.4, §4.5); a refused loosening emits none | O10, K6 |
| EV8 | a look-alike hook's receipt carrying the official `marketId` creates no subgraph entity and no bounded-indexer row; the official one creates one. Waits on the subgraph and indexer of EVENT-SCHEMA §12 items 5 and 6, which the owner has not confirmed; G17 covers the readback tool meanwhile | S1, G17 |
| EV9 | `OrderCreated` and `Settled` selectors equal the frozen generation's; `SettlementReceipt`'s differs from the frozen and schema v1 receipts | H15 |
| EV10 | a gate shell row, since a Solidity row reads no file (rule 6): every event in the four contracts' compiled ABIs is documented in EVENT-SCHEMA with a subgraph handler or an explicit "not indexed" line, and EV1's literals equal its recorded topic0 values | G8 |

## 5. Fuzz rows

No fuzz body swallows a revert (`catch {}`), and each carries a forced window of realistic inputs that must not
revert, so it cannot pass vacuously (C15). Bounds keep amounts at or under `uint128(type(int128).max)` (A11).

| ID | Domain | Asserts on every run |
|---|---|---|
| M2 | the opening-price library: `rateE18` up to 1e36, decimals 0–18 each side, both orderings, spacing 1–1000 (wider than the factory's three tiers on purpose) | payout per asset never above RATE, by exact cross-multiplication with zero tolerance; within one grid step of RATE; the TSLA shape's values from M1. The prototype fuzz runs are **not** cited as evidence for M2 (C15). |
| E1 | **end to end over {6, 8, 18}² × both orderings**: the 18 markets built once in `setUp` through the real factory, seed and activation; fuzzed market index, `amountIn` from 1 to 5% of depth, caps set above the domain so K rows alone test them | delivered ≥ `minOut`, where `minOut` is the test's own quote at creation; the opening price exact, as MX1; delivered ≤ `floor(amountIn · openRate · (1e6 − swapFee) / 1e6)`; executor and hook balances unchanged; recipient delta == `Settled.amountDelivered` == receipt `amountOut`; one receipt whose fee fields equal the same transaction's `Swap.fee`; `payoutUsedOnDay` rose by exactly the delivery (C14) |
| E1b | a fresh market per run: fuzzed (decimals pair, ordering, rate in the window the factory accepts, seed size) | the E1 assertions plus `markSeeded` depth == the minted L. Runs at the profile's count; if measured too slow, a lower per-test count is committed with its reason. |
| E1o | E1's 18 markets with an enabled policy on `MockOracleAdapter`; fuzzed reference price around the opening rate, `dO` over 0–18, bps 1–300 | `pay` settles if and only if the test's independent 512-bit band computation says the output is inside the band; otherwise `ExecutionBelowOracleBand` or `ExecutionAboveOracleBand` from the hook, with payer and recipient balances unchanged |
| O18 | the band arithmetic alone: {6, 8, 18}² decimals × both orderings, `dO` over 0–18, the three fee tiers, protocol fees 0–1000 | the hook's accept/refuse equals a zero-tolerance cross-multiplied reference; rounding always against acceptance (DR C14, C15; SO §15) |
| E2, E3 | random stored status (E2); random (recipient, payer, `amountIn`, `minOut`, deadline, salt) (E3) | E2: `createOrder` and `pay` succeed if and only if the status is ACTIVE, else `MarketNotActive`. E3: `createOrder` accepts if and only if SC §9.1's predicate, evaluated independently in the test, holds; each refusal names the first failed rule |

## 6. Invariant rows (`UnicaMarketInvariant.t.sol`)

Four instances: a 6 → 18 and an 18 → 6 market in each ordering (C14). The handler: `createOrder` by allowed and
disallowed creators; `pay` by random callers and bound payers, every payer holding a standing max approval to every
executor (C3); pause, unpause and retire by ADMIN, PAUSER and strangers; both tightens, `setOrderCreator` and the admin
transfer; direct swaps and sibling initialisations (expected to revert); third-party liquidity; **a donor sending
random amounts of both tokens to the executor and the hook**; mock oracle moves; warps across UTC days.

| ID | Invariant |
|---|---|
| **I1** | **No UNICA v4 call changes the executor's or the hook's balance of either token.** Measured per handler call from ghost before/after snapshots; the donor action's own delta is recorded separately, and the donor is in the handler so the invariant is proven robust to donations rather than blind to them (SC §9.3; A15, C3). Donated tokens are unrecoverable: there is no sweep. |
| I1b | After any donation, the next valid `pay` settles: residual checks are snapshot-relative. |
| I2 | Per market, `receiptCount` equals the number of `Settled` orders. |
| I3, I3b | Every settled delivery ≥ its order's `minOut` (I3); every `Settled` recipient equals the one stored at `createOrder` (I3b, C3). |
| I4 | Each payer's total debit equals the sum of `amountIn` over the orders that payer paid: no third-party pull, even with standing approvals (C3). |
| I5, I6 | No order rests in Paying after any call, Settled is terminal, and Open reaches Settled only through `pay` (I5); every status change is one of SC §5's eleven edges, and RETIRED never changes (I6). |
| I7 | Identity and pricing fields, the policy's adapter, `feedId` and `enabled`, and the three reverse maps never change; `maxAge`, bps and both per-transaction and per-day caps only ever decrease (C7). |
| I8 | Per market and UTC day, the sum of deliveries equals `payoutUsedOnDay[day]` and is ≤ `maxPerDayPayout`; each delivery is ≤ the `maxPerTxPayout` in force when it settled. |
| I9, I10 | No ADMIN, PAUSER or order-creator call changes any token balance of any address: ADMIN cannot move funds (I9). At most one non-retired market exists per (asset, payout), and `liveMarketOf` names it (I10). |
| I11 | With an enabled policy, every `Settled` payment's execution lies inside the band around the reference the adapter reported in that block, recomputed by the ghost; a failed check leaves no receipt. |

Non-vacuity: each instance fails unless its campaign recorded at least one settled payment per market, one donation,
one pause and unpause, one refused direct swap and one UTC day change. The report prints the counts.

## 7. Fork rows, Robinhood Chain Testnet 46630 (`test/fork/UnicaMarkets46630Fork.t.sol`)

**Pin.** `test/fork/ForkPin46630.sol`, new (the existing `ForkPin.sol` is Sepolia-only, C1): a block after 117535202,
its hash, chain id 46630, and the code hash of every dependency: the four Uniswap v4 contracts (B10), TSLA
`0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` and NFLX `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93` (source: CA §7),
their shared beacon `0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5` (source: DR C8, scouted), and uTUSD
`0xfb93352698150e720Bf0A321DEf3aC98D90B9874` (source: DR B1). RPC: `ROBINHOOD_TESTNET_RPC_URL`. Block and hashes are
PENDING (B11). Nonce and balance rows read deltas from the pinned block. UNICA v4 contracts exist only inside the fork.

**V0 — the live TSLA settlement, reproduced with every live value.** The frozen settlement: pay transaction
`0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300`, block 117535202, 0.001 faucet TSLA in (SC
§1.1). V0 creates a UNICA v4 TSLA/uTUSD market on the fork (rate 395e18 as a demonstration rate, fee 3000, spacing 60,
policy disabled, the beta caps in uTUSD units), which opens on the grid at tick −216540; mints the seed position with
exactly the live liquidity over the live ticks; activates; and settles one order of `1e15` raw TSLA from a funded
bound payer to the rehearsal merchant (B7) with `minOut` 393052. It asserts:

| Quantity | Expected, the live value | Why it is asserted |
|---|---|---|
| seed position liquidity | 17110143891811 | delivery alone cannot tell the live L from the full-seed L 17127271162974: both deliver 393052 (DR C1) |
| seed position ticks | −223500 / −216540 | the live range |
| pool `sqrtPriceX96` after the swap | 1572192990757546352782030 | separates the two L values (the full-seed L gives 1572194808674862261945643) |
| pool tick after the swap | −216564 | |
| pool liquidity after the swap | 17110143891811 | |
| delivered to the merchant | 393052 raw uTUSD | |
| receipt fees | `(0, 3000, 0, 3000)`, `swapFeePips ==` the same transaction's `Swap.fee` | the frozen receipt's `fee = 0` was the hook's own fee (SC §11.1) |
| receipt oracle fields | zero, `demonstrationOnly` true | the 46630 market has no oracle |

Paired negative, from a snapshot of the same state: `minOut` 393053 → `OutputBelowMinimum`. The live pool opened off
the grid and its swap first crossed 7 empty ticks (SC §1.1); the UNICA v4 pool opens on the grid, so the post-swap
state matches while the path does not. G9 checks every expected constant against the committed broadcast records.
V1, the NFLX row, is in §8.

| ID | Precondition | Refused → selector, or asserted | Control |
|---|---|---|---|
| V0s | the script's stage functions, driven by the environment the chain helper exports, as the real deployer | per-stage readback (C12): after `createMarket` status PROPOSED, `hook & 0x3FFF == 0x20C0`, the three reverse maps, `executor == CREATE(hook, 1)`; after initialise `slot0 == initSqrtPriceX96`, tick == `initTick`, and the `Initialize` log sits in the `initializeMarket` transaction whose `to` is the factory (A3); after seeding `seedDepth ≥ L` and the deployer position's own liquidity == L (A10); ACTIVE after activation; delivery equals the test's independent computation from the script's own L; nonce delta == the non-skipped transactions the plan printed (C16) | — |
| V2 | a payout test token placed below the TSLA address, its expectation from configuration, never a uTUSD literal (B1, C9) | the real script path on the real PoolManager, PositionManager and Permit2 with the asset as currency1: mint with `amount0Max = seed`, `amount1Max = 0`; `markSeeded`'s `L_active` branch; `seedDepth == L`; no asset spent; one payment settles. Never dropped (C10). | — |
| V3 | BLOCKED (B13): the recorded look-alike addresses, read on the fork | the pre-flight refuses each by the committed asset-address pin, and records which share the beacon; the beacon check is described only as screening non-faucet tokens | the real NFLX address is accepted |
| V4 | the TSLA market live | `createMarket` again → `LiveMarketExists`; from a stranger → `NotAdmin` | V0 |
| V5 | a stranger initialises a hookless TSLA/uTUSD pool | it **succeeds** and `marketIdOfPool(thatId) == 0` (A1); a funded stranger's direct swap on the UNICA v4 pool → `NotSettlementExecutor`; a sibling key naming the UNICA v4 hook → `NotMarketFactory` | the executor path settles |
| V6 | market PAUSED, order open | `pay` → `MarketNotActive` | after unpause the same order settles |
| V7 | the pinned block's protocol fee, read | receipt `swapFeePips` equals the same transaction's `Swap.fee`, never a constant (A9); `minOut` recomputed from `feeRates()` | — |
| V8 | the real PoolManager's owner and a controller pranked; a non-zero protocol fee set | receipt equals `Swap.fee`; `protocolFeesAccrued` rose. Never dropped: it is the only fork realisation of the fork protocol-fee test the ledger accepted (rec 118), since H12b and H12c run on a local PoolManager (§13). | — |
| V9, V10 | the seed stage stopped after its first transaction (V9); an RPC reporting another chain id (V10) | V9: the stage resumes without duplicating a transaction and readback passes. V10: the chain helper refuses; the forge script re-asserts `block.chainid == UNICA_CHAIN_ID` | 46630 proceeds |
| V11 | — | **sanity only**: the frozen hook (`0xAe1975f2…E0c0`), executor (`0x613dadd3…16cE`) (DR C12), uTUSD code hashes and the frozen pool's `slot0` are unchanged across the rehearsal. It cannot catch a source change, so it is not the freeze gate; G1 and G2 are (C13). | — |
| V12 | the TSLA pauser role identified from the verified ABI on the fork | TSLA paused by the issuer: `pay` → `TransferFailed`, payer unchanged; the LP still exits with `DECREASE_LIQUIDITY` + `CLEAR_OR_TAKE(asset)` + `TAKE(payout)` and recovers the uTUSD (A8) | unpaused, the same order settles |
| V13 | the role that changes `uiMultiplier()` identified | changing it leaves `balanceOf(PoolManager)` and a settlement's credited amount unchanged (A7). V12 and V13 are declared only once their role is identified; until then `THREAT-MODEL.md` records both properties as **unproven** | — |
| V14 | the asset fingerprint recorded in evidence (PENDING: DR A7 cites one recorded outside this repository) | a planted mismatch of the beacon's `implementation()`, its code hash, `paused()` or `uiMultiplier()` (via `vm.store`) → the pre-flight refuses by name | the unmodified fork passes |

## 8. NFLX configuration-only onboarding

A second market needs data, not code. NFLX is **not deployed** (Q110, rate NOT SELECTED): the claim is proven in local
and fork tests only, and no NFLX market file exists under `script/unica-v4/` (B6). The rate is a constant under
`test/unica-v4/` labelled "test fixture — not an approved demonstration rate"; G7 fails it anywhere else. V1 is
never part of a 46630 TSLA LIVE stage's declared set (§12): it backs only the claim "configuration-only onboarding
proven on a fork", alongside N1 and N2, and stays on the never-drop list (§13) whenever that claim is made. A TSLA
LIVE stage never waits on the NFLX rate ruling.

| ID | Where | Precondition | Asserted | Control |
|---|---|---|---|---|
| N1 | local | the TSLA-shaped market exists; a second 18-decimal token stands in for NFLX | the same compiled factory and the same `HOOK_CREATION_CODE_HASH` create the second market from market data alone, through the same stage functions; `marketCount() == 2`; each market settles independently; the first market's record and reverse maps are unchanged (R9) | — |
| N2 | local | both markets ACTIVE | pausing or retiring the second leaves the first ACTIVE and payable, and the reverse (rec 68, isolated markets); an order id of one refused at the other (X4) | — |
| V1 | fork 46630 | the pin of §7; the real NFLX token `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93` (source: CA §7) | NFLX/uTUSD created on the fork from the environment the chain helper exports, with no source change; the same code hash; `marketCount() == 2` on the fork; one order settles; the market exists only inside the fork | TSLA (V0) unchanged |
| G10 | CI, offline | a synthetic onboarding commit in a throwaway worktree the check creates and removes | it touches only this path set, which `DEPLOYMENT-GATES.md` §7's `config-only.test.sh` must state identically: data files under `script/unica-v4/markets/<chainId>/` and `script/unica-v4/settlements/` (DR B9), and in `config/chains/<chainId>.json` only the onboarded token's `listed` and `unlistedReason` keys, since SO §12.1 ships NFLX with `listed: false` and an `unlistedReason`, which onboarding flips; zero `.sol`, `.sh` or `.t.sol` files | a planted commit that also touches a `.sol` file, and one that changes any other key of the chain file, must each fail |

## 9. Fork rows, Arbitrum One — the oracle proof (`test/fork/UnicaOracle42161Fork.t.sol`)

**What it may earn.** Only when OF1–OF8 pass at the pinned block with 8 declared, 8 run, 8 passed, 0 failed and 0
skipped, recorded as evidence (proposed: `docs/unica-v4/evidence/ORACLE-FORK-42161.md`, with block, hash, feed
readings, counts and commit), may any surface say **"Chainlink integration demonstrated on a fork"**, linked to that
file (Q30, Q125). Never "Chainlink secured"; never a mainnet, oracle-live or market-priced claim (Q120). Arbitrum One
is forked because it carries the feeds (MCP); this chooses nothing for Q9 (B2) and deploys nothing (B1).

**Setup.** `test/fork/ForkPin42161.sol` (PENDING, B11): a block strictly after an ETH/USD update and within 300 s of
it (Q25's crypto cap; SO §4.1 step 5), its hash, and the code hash of each address below. RPC: `ARBITRUM_MAINNET_RPC_URL`.
Deployed **into the fork only**: the UNICA v4 factory with a `requireOracle = true` registry, on the real PoolManager
`0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` (MCP Arbitrum 1); `ChainlinkFeedAdapter` on the real ETH/USD
`0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` and USDC/USD `0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3` feeds (MCP
Arbitrum 2) and sequencer-uptime feed `0xFdB631F5EE196F0ed6FAa767959853A9F217697D` (MCP supplementary), grace 3600 s,
**proposed, not confirmed** (SO §7.3). The asset is an 18-decimal test token deployed in the fork and routed to ETH/USD
for the test only; no ETH market is claimed (SO §15). The payout is native USDC
`0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (MCP Arbitrum 3), funded with `deal`, the balance asserted. Policy:
`maxAge` 300, bps 200 (rec 26), a band-width seed (SC §7); the rate is derived from the adapter's reading, a test input.

| ID | Precondition | Refused → selector, or asserted | Control |
|---|---|---|---|
| OF1 | the real feed addresses; the expected descriptions recorded (B12) | the adapter constructs; `decimals()` read live equals 8 for both feeds (MCP); description hashes match; `feedIdFor` equals the policy's `feedId`; `adapterKind` is `CHAINLINK_FEED`. A random address → `FeedNoCode`; a wrong expected description → `FeedDescriptionMismatch` | the correct construction |
| OF2 | honest pool: opened at the reference, band-width seed | **settles**; receipt oracle price, decimals and `updatedAt` equal `latestPrice` in the same block, `updatedAt == min(t_ETH, t_USDC)`; `demonstrationOnly` false; `swapFeePips == Swap.fee`. OF2 is the control for OF3–OF8. | — |
| OF3 | from the pinned state, a market whose pool opened 3% below the reference; price fresh, sequencer up, so only the band can fail | `pay` → `ExecutionBelowOracleBand` from the hook; payer and merchant balances unchanged; order still Open; no receipt | OF2 |
| OF4 | the same, opened 3% above the reference | → `ExecutionAboveOracleBand` | OF2 |
| OF5 | OF2's market; `vm.warp` so that the older feed's age is `maxAge + 1` | → `OracleStale`; the condition view reads STALE_ORACLE | at age exactly `maxAge` it settles |
| OF6 | `vm.mockCall` on the real sequencer address returning answer 1 | → `SequencerDown`, raised inside the adapter | unmocked, the feed reads 0 (up, MCP) and OF2 settles |
| OF7 | mocked `startedAt` with `now − startedAt == gracePeriod` | → `SequencerGracePeriod` | `gracePeriod + 1` settles |
| OF8 | mocked on the real addresses: sequencer `startedAt == 0`; ETH/USD answer 0, then −1; `updatedAt` 0; `answeredInRound < roundId`; a changed `description()`, then `decimals()` | → `SequencerStatusUnknown`; the answer, timestamp, round, description and decimals refusals, each by name | the unmocked reads |
| OF9 | fork of Robinhood Chain mainnet 4663, read-only, `ROBINHOOD_MAINNET_RPC_URL`, `test/fork/ForkPin4663.sol` (PENDING) | `test/fork/UnicaOracle4663Fork.t.sol`: the TSLA/USD proxy `0x4A1166a659A55625345e9515b32adECea5547C38` (CA §2b) reports description "RHTSLA / USD" (SO §7.1, from MCP) and 8 decimals (CA §2b). The issuer-hold refusal against the real issuer token is BLOCKED: that token's address is not in the evidence; O28 covers the refusal locally. Supplementary: not required for the wording, never an equity route (B8). | — |

Mutations re-run on this fork, as §10's declared `--fork` subset: MUT-36, MUT-39, MUT-40 and MUT-42. In that run the
killer rows are OF5, OF3, OF4 and OF6 respectively, so red on the local killer of §10.2 or on any other row is
MISATTRIBUTED; the local run keeps §10.2's killers.

## 10. Mutation table

A UNICA v4 table in the repository's mutation suite, written fresh (the V2 table in `script/mutation-suite.sh`
covers `src/v2/` only, C4), run as `make mutants-unica-v4`, with a `--fork` subset whose killer rows §9 declares.
Each mutation is applied to the real tree, one at a time. It is **KILLED** only when the row that names it goes red; red elsewhere is
**MISATTRIBUTED**, a finding, not a pass. Exit 0 requires every mutant KILLED, 0 MISATTRIBUTED and the unmutated
control fully green. Not in `make gate`, because it recompiles once per mutant; required before any live stage (§12).

### 10.1 The guards carried over from the frozen generation

Origin is `src/experimental/robinhood-testnet/` (read, never edited). DR C4: none of these had a sabotage requirement.

| Mutant | Guard, frozen origin | Mutation | Killer row |
|---|---|---|---|
| MUT-01 | payer binding, executor `pay` | delete the `msg.sender == order.payer` check | X2 |
| MUT-02 | merchant binding, unlock callback | `take` pays `msg.sender` instead of `order.recipient` | X3 |
| MUT-03 | reserved recipients, `createOrder` | delete the reserved-recipient check | X3 |
| MUT-04, MUT-05 | replay, `pay`; replay, `createOrder` | delete the `OrderNotOpen` check; delete the `OrderExists` check | X4 |
| MUT-06 | replay within a transaction, hook | never write the transient `swapped[orderId]` flag | H9 |
| MUT-07 | `minOut`, hook `afterSwap` | delete `OutputBelowMinimum` | H11, which names the hook's selector, so the executor's `RecipientShort` firing instead turns it red |
| MUT-08 | `minOut`, executor after delivery | delete `RecipientShort` | X5 (short-delivering payout) |
| MUT-09 | exact input, `pay` | delete the measured `InputNotExact` check | X8 |
| MUT-10 | exact input, hook `beforeSwap` | drop the amount comparison from `ParamsDoNotMatchOrder` | H8 |
| MUT-11 | full fill, hook | delete `PartialFill` | H10 |
| MUT-12 | settlement closes, callback | delete `SettlementDidNotClose` | X16 |
| MUT-13 | direct-swap rejection, hook `beforeSwap` | delete `sender == EXECUTOR` | H5, H5b, H5c |
| MUT-14 | sole initialiser, hook `beforeInitialize` | delete the `FACTORY` check | H3 |
| MUT-15 | residual checks, `pay` | delete both residual comparisons | X14 |
| MUT-16 | reentrancy latch, `pay` | never set the transient latch | X17 |
| MUT-17 | callback caller, `unlockCallback` | delete the `NotPoolManager` check | X12 |
| MUT-18 | receipt split, `pay` | delete the `NoReceipt` check | X15 |

### 10.2 New guards

| Mutant | Mutation | Killer row |
|---|---|---|
| MUT-19 to MUT-22 | delete `canCreateOrders`; the ACTIVE check in `pay`; `ZeroPayer`; `AmountTooLarge` | X7; X6; X13; X13 |
| MUT-23 to MUT-27 | delete `OrderAboveCap`; `PaymentAboveCap`; `DailyCapExceeded`; `SeedAboveCap`; compute the day as `block.timestamp / 3600` | K1; K2; K3; K4; K3 |
| MUT-28 to MUT-33 | delete `SeedTooShallow`; the fee-tier allowlist; the code-hash check; the flags pre-check (the error becomes `HookDeployFailed`); each reverse-map write (MUT-32a–c); the `liveMarketOf` check | F13; F9; F4; F5; R9; R8 |
| MUT-34, MUT-35 | `tightenOraclePolicy` accepts a loosening; `tightenCaps` accepts a loosening | O7; K6 |
| MUT-36 to MUT-41 | delete the age check; the future-timestamp check; the price-above-zero check; the band's low side; its high side; compare without dividing out the swap fee | O15; O13; O11; O16; O17; O16 |
| MUT-42 to MUT-45 | delete the adapter's sequencer-down check; its grace check; ignore `REQUIRE_ORACLE` at register; read the policy once instead of live | O28; O28; R11; O8 |
| MUT-46 to MUT-49 | PAUSER may unpause; the old admin keeps power after `acceptAdmin`; `FACTORY` dropped from the reserved recipients (A16); one external function added to the hook | R3b; R5; X3; H14 |
| MUT-59 | PAUSER calls `retire` directly (S2) | R3b |
| MUT-50, MUT-51 | ceiling instead of floor for currency0; drop the currency1 "perfect tick" flag | M2 |
| M-fee-1 | `swapFeePips` ← `lpFee` | H12b, H12c (`3000 != 3499`, `3000 != 3997`, as measured on the prototype) |
| M-fee-2 | always read the zeroForOne half of the protocol fee | H12c (`500 != 1000`) |
| MUT-52 to MUT-58 | EVENT-SCHEMA §13's sabotage for EV1 to EV7, in that order | EV1 to EV7, in that order |

Unreachable guards are not sabotage-tested and not claimed: SC §8.1 drops the per-swap `POOL_ID` check for that
reason (DR decision 5).

## 11. Gate and shell rows

Each is a committed script (under `script/unica-v4/` unless it extends an existing check) whose `--self-test`
plants its failure and must catch it, and passes the unmodified tree. "Gate" is `make gate`, run in CI from a clean
clone with no local state and no RPC. G10 is in §8.

### 11.1 The frozen-generation gate (G1, G2)

**G1, source.** Paths: `src/experimental/robinhood-testnet/`, `script/experimental/`, `test/experimental/`,
`test/fork/StockSettlement46630Fork.t.sol`, `docs/experimental/`, `docs/RECEIPT-SCHEMA.md`,
`docs/v2/SECURITY-ADVISORY-001.md`, `broadcast/StockSettlement46630.s.sol/46630/` and `foundry.toml` (a profile change
alters the frozen build, C13). It requires: the tag `experimental-46630-settled` resolves to commit `e5a0185` (CI
fetches tags; a moved or absent tag fails, never skips); `git status --porcelain --untracked-files=all` is empty on
those paths; and the SHA-256 of `git diff --binary experimental-46630-settled HEAD -- <paths>` equals the pinned
value, which is the reviewed post-tag documentation diff of `eea86d2` and `903a8c9` (B15). Any further byte changes
the hash and fails. Self-test: append one byte to a frozen file in a throwaway worktree; the row must fail.

**G2, bytes.** Built under the unchanged profile, with no RPC and reading only committed files: the frozen runtime
sizes equal 10,518 (hook), 15,954 (executor) and 5,656 (TestPayoutToken) bytes; each creation code is an exact byte
prefix of its committed broadcast input — TestPayoutToken 7,486 bytes plus 32 bytes of arguments in
`token-latest.json`; the hook 12,523 plus 128 after the CREATE2 deployer's 32-byte salt, and the executor 16,742 plus
128, in `pair-latest.json` (DR B7, measured outside the repository; the gate re-measures); and the creation-code hashes
equal values pinned from the tag. Self-test: flip one byte of a constant in a frozen source; the row must fail. G2 is
what shows the post-tag NatSpec edits changed no bytecode; that is claimed only after G2 has run.

### 11.2 The other rows

| ID | Checks | Its planted failure | Runs in |
|---|---|---|---|
| G3 | `script/size-budget.sh` extended to every UNICA v4 contract and adapter: fail above 24,576 runtime or 49,152 initcode; warn at 90% (SC §12) | an oversized stand-in contract | gate |
| G4 | the mutation report of the same commit: every mutant KILLED, 0 MISATTRIBUTED (§10) | a mutant with a wrong killer row reports MISATTRIBUTED | before any live stage |
| G5 | `MockOracleAdapter` exists only under `test/unica-v4/mocks/`; nothing under `src/` or `script/unica-v4/` imports `test/`; `deployments/unica-v4/` never names the mock or its code hash (SO §10) | a script importing the mock | gate |
| G6 | every `config/chains/*.json` against schema `unica-v4-chain/1`; 46630 enabled, 42161 present and disabled (SO §12.2) | a disabled chain; id mismatch; unset `rpcEnv`; `null` required address; a `source` without a CA, MCP or DR prefix; mainnet without `requireOracle`; an L2 mainnet without a sequencer feed; a MOCK adapter; an equity route; crypto `maxAge` above 300 without a Q25 amendment. RPC-needing steps report SKIPPED with a count, never passed. | gate |
| G7 | a UNICA v4 claims family, written fresh beside `script/check-robinhood-claims.sh` (C17), over the UNICA v4 surfaces only: `docs/unica-v4/`, `script/unica-v4/` output strings, `deployments/unica-v4/`, `prototype/unica-v4-ux/` and the README's UNICA v4 section between committed markers. Frozen and earlier files (`docs/experimental/`, `docs/CLAIMS.md`, `docs/DEMO-SHOTLIST.md`, the rest of `docs/`) are out of scope and never edited to satisfy it. A committed allowlist of path plus line hash, each entry with its reason, admits a marked quotation of an outside source (Circle's "regulated" in `arc/`), a line of a file this release may not edit (the ledger, `evidence/`), and the lines that state these rules; a changed line leaves the allowlist | "market price", "regulated", "insured", "real equities", "Chainlink secured", "multi-chain", or "production" without a negation; faucet stock or uTUSD without "no real-world value"; "verified" beside a UNICA v4 address without an explorer URL; the frozen hook or executor address in a UNICA v4 context; "Chainlink integration demonstrated on a fork" without the §9 evidence file; the NFLX fixture rate outside `test/unica-v4/`; a bare "v4"; a banned word in a new file under `docs/unica-v4/`, and in an allowlisted line after one byte of it changes | gate |
| G8 | every row id `THREAT-MODEL.md` cites exists in this file: a prefixed id by the id after its prefix, a `TM-n` through §2's adoption list, a mutant in §10; every row here has a `test_<ID>_`, `invariant_<ID>_` or shell label in the tree once implemented (C20) | a cited id with no row (a planted `SO:F3`); a `TM-n` missing from §2; a row with no code | gate |
| G9 | V0's literals equal the values decoded offline from `broadcast/StockSettlement46630.s.sol/46630/settle-latest.json` (the pay receipt at block 117535202: `Swap` amount 393052, post-swap `sqrtPriceX96`, liquidity, tick) and `pool-latest.json` (L `0xf8fc40c7963` = 17110143891811, ticks −223500/−216540) (DR C1) | one V0 literal changed | gate |
| G11 | committed files under `docs/unica-v4/`, `script/unica-v4/`, `config/chains/` and `deployments/unica-v4/` name no temporary, home-directory, loopback or scratch path | each such path planted | gate |
| G12 | no token or asset address literal in `src/unica-v4/` or in `script/unica-v4/*.sol` and `*.sh`; addresses come only from `config/chains/` (DR B1, C9) | the uTUSD address in a script | gate |
| G13 | `manifest.test.sh`: `verified` is written only when a read-only explorer query returns verified, with the query and timestamp recorded; otherwise "not verified" (C12) | a failed verification; a missing required field (chain id, addresses, pool ids, transaction hashes, blocks); any RPC URL; the frozen hook or executor under a UNICA v4 key; one run record deleted (B2) | gate |
| G14 | the wrapper's dry run prints, per stage, the ten owner-named fields by label (chain, deployer, nonce, contracts, constructor arguments, salts, predicted addresses, transaction count, gas estimate, verification and readback plan), sends nothing and names the spend ceiling; the predicted hook, executor, marketId and poolId equal what the disposable local rehearsal then deploys (C11) | no mode; LIVE without a keystore name; `PRIVATE_KEY` or `--private-key` in the environment; a stray `CHAIN` variable (DR C11); a mainnet chain id (`script/mainnet-guard.sh`); balance below twice the estimate; LIVE without a salt; a payout token other than the configured one | gate |
| G15 | the wrapper removes the keyed endpoint that forge writes into its dry-run cache record, on every exit (DR B8) | a fake keyed URL planted in the record must be gone after exit | gate |
| G16 | the live-stage rule of §12 | RPC variable unset; one declared row skipped; one declared row failed; one declared row renamed or missing; an extra undeclared row counted in place of a declared one — each must refuse | gate |
| G17 | the readback tool accepts a `SettlementReceipt` only when `log.address == getMarket(marketId).hook`, and `Settled` only from `getMarket(id).executor` (SC §3, S1's off-chain half) | a receipt from S1's look-alike hook | gate |
| G18 | the registry, factory, hook and executor sources use no `ecrecover`, `EIP712`, `ECDSA`, `permit(`, `SignatureTransfer` or `isValidSignature` outside comments; the adapters under `src/unica-v4/oracle/` are excluded (THREAT-MODEL T-SIG-1) | a planted market-contract source containing one | gate |
| G19 | before every `createMarket` and again before every `activate`, the wrapper enumerates the manifest's registry through `marketCount()` and paged `getMarkets(offset, 100)` to the end, requires the paged total to equal `marketCount()`, sums `maxSeedPayout` over every non-RETIRED market plus the proposed one, and refuses above 100000000 raw of the configured 6-decimal payout (S5) | the sum exceeding the ceiling; a short or erroring page; a paged total short of `marketCount()`; a non-RETIRED market whose payout token differs from the chain file's; a RETIRED market wrongly counted — each must refuse closed | the sum at or under the ceiling, every market enumerated, proceeds |
| G20 | every market configuration file and manifest entry names `fee` and `tickSpacing` explicitly, and each equals (500, 10), (3000, 60) or (10000, 200); readback asserts `getMarket(id).fee`, `getMarket(id).tickSpacing` and the `PoolKey` equal the configuration (S1) | a market file missing either value; a manifest entry naming any other pair | a market file naming one of the three pairs |
| G21 | no committed deployment tool has a code path that adds liquidity to a market at or after SEEDED (S6) | a stand-in tool call minting a position on a SEEDED or later market | gate |

## 12. The live-stage rule: declared fork rows, zero skipped

A fork suite with its RPC variable unset skips every row, and `forge test` then exits 0 with nothing executed (C2). An
empty result and a broken reporter look identical, so no live stage may rest on one. **No live stage is authorised
today**; this rule is a precondition, never a permission. The committed wrapper under `script/unica-v4/` (its name is
fixed by the deployment specification) runs the chain helper first, then refuses to reach the owner's confirmation
prompt for any LIVE stage unless every one of these holds, printing each number:

1. G1, G2 and the full gate pass on HEAD with a clean tree.
2. G4's mutation report exists for the same commit: every mutant KILLED, 0 MISATTRIBUTED.
3. The chain's fork suite ran at its pinned block with the pin's code-hash rows passing. The wrapper runs it with
   `--json`, parses the result, and requires: the set of executed row ids **equals** the declared set; passed equals
   the declared count; failed 0; skipped 0. It prints `N declared, N run, N passed, 0 failed, 0 skipped`.
4. Ids are compared, not only counts, so a renamed, missing or extra row cannot make the numbers match. An unset RPC
   variable is a refusal, never a skip; a skipped row never counts as passed.
5. The report (ids, counts, block, pin hash, commit) is written into the stage's evidence beside its printed plan, and
   the owner sees it before confirming. G16 plants each failure of 3 and 4 and requires the refusal.

**Declared sets**, a committed list the wrapper reads; changing it is a reviewed commit:

| Stage or claim | Declared fork rows |
|---|---|
| every 46630 TSLA LIVE stage | V0, V0s, V2, V4, V5, V6, V7, V8, V9, V10, V11, V14; V12 and V13 once declared (§7). All wait on B10 and B11, and V14 on its recorded fingerprint. Never waits on the NFLX rate ruling. |
| the claim "configuration-only onboarding proven on a fork" | V1, beside N1 and N2 (§8); until the owner accepts NFLX's test-fixture rate (B6), the claim reads "proven in local tests (N1, N2)" only |
| any NFLX LIVE stage | none may exist (B6); it would add V3, which waits on B13 |
| any mainnet LIVE stage | none may exist (B1); it would add at least OF1–OF8 and a fork of the chosen chain's own stack |
| the wording "Chainlink integration demonstrated on a fork", which is a claim, not a stage | OF1–OF8, recorded as evidence (§9) |

## 13. Never drop, and the cut order

**Never dropped:** H12a–H12c with M-fee-1 and M-fee-2; X2 to X7; F1, F1b, F1c and F2; V0, V1 and V2 (V2 moved onto
this list by C10, since it alone runs the currency1 ordering through the real deployment path); V8 (rec 118 accepted
the fork protocol-fee test, and V8 is its only fork realisation); every ordering row (X1, MX1, E1); I1; G1, G2, G9
and G16; and OF1–OF8 whenever the fork wording is used. DR §2 records the cut order under schedule pressure; with V2
and V8 removed from it, it reads: 1. I4 and I7, after which `THREAT-MODEL.md` cites X2 and R9 alone for those
properties and says the invariant was cut; 2. MX1 reduced to DR's six {6, 18} combinations. Cutting V8 would need an
owner amendment of rec 118.
A cut is recorded in the evidence with its reason, never made silently, and the row keeps its id, marked dropped.

## 14. Open issues

Owner decisions are marked; the rest close before the affected rows are written.

1. **Applied.** §3 is reconciled and B14 is resolved; every row below it names the selector directly. SC holds
   the single error catalogue, and SO cites it.
2. **Applied.** The row-id renames of §2 are in force throughout this file, in SO §15 (F1–F9 → OF1–OF9) and in
   SC §8.3 ("O9" → O26).
3. **Owner:** accept G1's pinned post-tag diff (B15). Moving the tag is not an option.
4. **Owner:** SC §11 plans a UNICA v4 section inside `docs/RECEIPT-SCHEMA.md`, a file the frozen list says is never
   modified. G1 protects the whole file until the owner decides, for example a separate UNICA v4 receipt-schema file.
5. **Applied.** One RPC variable name for 42161: `ARBITRUM_MAINNET_RPC_URL`, matching `foundry.toml`;
   this file uses it throughout (§1, §9).
6. Read-only probes record, as evidence with sources: the 46630 Uniswap v4 addresses (B10); the three fork pins (B11);
   the Arbitrum One feed descriptions (B12); the NFLX look-alike addresses (B13); the TSLA fingerprint for V14; the
   4663 TSLA issuer token for OF9. None is invented to unblock a row.
7. **Owner:** the sequencer grace period (proposed 3600 s, SO §16 item 4). OF7 runs with it labelled proposed.
8. V12 and V13 wait on identifying the issuer's pauser and multiplier roles; the raw-balance relation of a Robinhood
   token to its feed unit stays unproven (DR A7), so no row prices a Robinhood token from its feed.
9. Implementation measurements, not guesses: H13's gas ceiling; E1b's run count; each invariant suite's non-vacuity
   minimums; MX1's 98.5% bound and every DR figure, which are prototype measurements the implementation re-measures.
10. The deployment specification fixes the wrapper's name; this file names it by role. Without CI secrets (B4), fork
    suites report SKIPPED with a count, never a pass, and §12 refuses on it.
11. **Applied here** (V8 never dropped, §13); other documents must still follow this file: `DEPLOYMENT-GATES.md` §7
    states G10's path set identically; `IMPLEMENTATION-PLAN.md` removes V8 from its cut list (rec 118), puts O25
    under the Streams task with O21–O23 and leaves O24 alone under CRE, and scopes TS5c as G7. F21 waits on SC's
    change for THREAT-MODEL T-SET-20 (owner).
