# UNICA v4 — implementation plan

Draft for owner review, not committed, authorising nothing (Q131). Written 2026-09-11 about 20:05 UTC from
`docs/unica-v4/DECISIONS.md`, which binds it, and from the two interface specifications,
`docs/unica-v4/SPEC-CONTRACTS.md` (cited SC §n) and `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (cited SO §n). Where
this plan disagrees with any of the three, this plan is wrong. `DEPLOYMENT-GATES.md` (DG), `TEST-MATRIX.md` (TM) and
`EVENT-SCHEMA.md` (ES) beside it win on stage, row and event content; this plan keeps order, time and STOPs (§9 item 3). Evidence is cited from
`docs/unica-v4/evidence/DESIGN-REVIEW.md` (DR; critique findings A1–A16, B1–B10, C1–C20),
`CHAINLINK-AVAILABILITY.md` (CA) and `MAINNET-CAPABILITY-PROBE.md` (MCP) beside it. "UNICA v4" is the UNICA release;
"Uniswap v4" is the AMM. The frozen experimental generation (tag `experimental-46630-settled`) is not UNICA v4 and is
never modified. Prototype sizes and gas in DR are feasibility evidence measured outside this repository; every task
here re-measures. Faucet stock tokens and uTUSD have no real-world value; the TSLA rate is a demonstration rate the
admin sets. Chainlink is **planned**.

This plan is for a second coordinator. It fixes the order of work, what each task consumes and produces, how each
task proves itself, and where every task must stop for the owner. It does not decide anything the ledger leaves open.

## 1. Blockers

Every open ledger item that touches this plan, and what it blocks here. None blocks writing or testing code once G0
(§3) is given; each blocks a start, a deployment, a claim or a publication.

| Ledger item | State | What it blocks in this plan |
|---|---|---|
| "What the missing answers mean", item 1 | "Fable does not start yet" (owner) | read here as: **no task starts except the read-only preparation of SR1.** G0 (§3) is the owner's go; if the owner meant something narrower, G0 says so. |
| Q131 | **NO AUTHORIZATION** | pushing any commit or tag, triggering Pages, publishing the prototype, the evidence page or the video. Two separate approvals are needed: push; then the Pages rebuild after the generated site is checked. |
| Q132 | **OPEN, unanswered** | any mainnet deployment, including no-value infrastructure. No mainnet task exists in this plan. |
| Q9 | **OPEN** (Arbitrum One recommended, MCP) | enabling `config/chains/42161.json`; it lands present and `enabled: false`. |
| Q64 / Q70 / Q71 | **NOT READY** | a Safe as ADMIN, a mainnet PAUSER, any mainnet launch. Recommendation 3 (mainnet by 12 Sep 16:00 UTC) becomes checkpoint CP3, which defaults to NO-GO. |
| Q91 | **NOT SELECTED** | a mainnet RPC, and so FK2, FK3 and the wording "Chainlink integration demonstrated on a fork": they need an owner-provided endpoint behind `ARBITRUM_MAINNET_RPC_URL` (SR1 row 14, resolved) that serves the pinned historical block. Without one by CP3, cut 9 applies there. This plan never chooses a provider. |
| Q95 | **NOT PROVIDED** | any paid account: a Data Streams subscription, an RPC provider (including one that serves FK2's and FK3's pinned block), Privy, hosting. ChainlinkStreamsAdapter is written disabled. |
| Q96–Q99, Q100 | **UNKNOWN / NOT PROVIDED / NOT CONFIRMED** | Privy anywhere. At CP2 (12 Sep 12:00 UTC) Privy is deferred unless credentials are ready; prototype screen 2 then shows sign-in as planned, never working. |
| Chainlink on 46630 | no feeds; Streams verification UNCONFIRMED; CRE hosted writes unproven (CA §2a, §3a, §4) | any oracle-enabled market on 46630. The rehearsal registry is `requireOracle = false`, TSLA `demonstrationOnly`. |
| Q16 / Q20 / Q23 | no issuer; **NO CONFIRMED REVIEW**; no licensed equity data | any equity oracle route and any claim about securities. The chain helper refuses equity routes (SO §12.2). |
| Q110, NFLX rate | **NOT SELECTED** | an NFLX market file under `script/unica-v4/markets/`. `DECISIONS.md` "Specification choices" resolves fork row V1: it is decoupled from the TSLA rehearsal, backs only the separate claim "configuration-only onboarding proven on a fork" (TEST-MATRIX §12), and reads a `test/unica-v4/` fixture rate labelled "test fixture — not an approved demonstration rate," never a `script/unica-v4/markets/` value. No TSLA LIVE stage's declared set (DG §2.3 step 5) waits on it. NFLX stays a configuration-only test. |
| Frozen-gate baseline (TM B15) | the owner has not accepted the pinned post-tag diff | TS5a, so CP1 and every LIVE stage; the tag is never moved |
| TSLA beacon fingerprint | recorded only outside this repository (DR A7; DG §1) | FK1's row V14 and DG §5.2's pre-flight until CH4 records it |
| Q110, merchant control | **UNKNOWN / NOT PROVIDED** | describing the rehearsal merchant as owner-controlled. |
| Q108 | **NOT READY** | a public merchant beta; the creator allowlist holds only founder-controlled or invited creators (Q35). |
| Q119 | **UNKNOWN / NOT PROVIDED** | the final video; it is the owner's, inside the reserved window. |
| 46630 Uniswap v4 addresses | `null` in SO §12.1: not in the evidence files | the chain helper passes no 46630 stage until CH1 records them from committed sources (SO §16 item 1). |
| Arbitrum One feed descriptions | unrecorded (SO §7.1, §16 item 2) | constructing ChainlinkFeedAdapter on the 42161 fork until FK2 records them. |

## 2. Timeline

Deadline: **Sunday 13 September 2026, 16:00 UTC** (ledger, settled by evidence). The final 12 hours, **Sun 04:00 to
16:00 UTC**, are reserved for the video and the submission: no code, test, script or deployment work lands in them.
That leaves about 32 hours from the time of writing, fewer by however long G0 takes. The plan is aggressive on
purpose; the cut order (§8) is how it meets the freeze, never by skipping a gate or a STOP.

| Window (UTC) | Phase | Tasks that run (§4) | Checkpoint at the end |
|---|---|---|---|
| Fri 11 Sep 20:05 → G0 | Hold | SR1 conflict list and the owner ruling sheet (§3) prepared read-only; nothing written under `src/`, `script/`, `test/` | **G0**, nominal target Fri 22:00, not a realistic one (below): owner confirms the specifications, rules on the sheet, accepts or amends this plan |
| Fri 22:00 → Sat 04:00 (6 h) | Foundations | SR1, CH1, CH2, CH3, CH4, CT1, OA1, TS5a, TS5c, PR1 | **CP1** Sat 04:00: M2 fuzz green; chain helper refuses every planted bad file; TS5a (TM G1, G2) green and its sabotage controls red; the owner's `forge --version` recorded (DG §8); one `make gate` run and one mutant cycle timed (landing time, below) |
| Sat 04:00 → 12:00 (8 h) | Contracts | CT2, CT3, CT4, CT5, CT6, CT7, OA2, TS5b, TS5d, DP1 started | **CP2** Sat 12:00: unit rows green, sizes recorded under the gate; **Q100 Privy decision** (default: deferred) |
| Sat 12:00 → 18:00 (6 h) | Proofs and scripts | OA3, OA4, TS1, TS2, TS3, TS4, DP1, DP2, DP3, DP4, FK0, FK1, PR2 | **CP3** Sat 16:00: **recommendation-3 mainnet go/no-go** (default NO-GO, §5 STOP-MAINNET); Sat 18:00: mutation table all KILLED, 0 MISATTRIBUTED |
| Sat 18:00 → 22:00 (4 h) | Review and the oracle fork | RV1, RV2, FK2, FK3, DC1, DC2, DC3, PR3 | **CP4** Sat 22:00: every review finding fixed or dispositioned by the owner; source tag requested (STOP-TAG); stage A go or no-go; Q131 approval 1 (push) and stage H's publication go requested (STOP-PUSH). If withheld, stage H does not run and the manifest records "not verified" |
| Sat 22:00 → Sun 03:00 (5 h) | 46630 rehearsal, owner-run | DP5 stages A, B, C, D, H, I | **CP5** Sun 03:00: readback per stage, verification tier per contract and manifest recorded, or the rehearsal's stopping state recorded |
| Sun 03:00 → 04:00 (1 h) | Freeze | RV3, DC4, DC5, final gate | **CODE FREEZE Sun 04:00.** Push approval requested again only if not given at CP4 (STOP-PUSH) |
| Sun 04:00 → 16:00 (12 h) | Reserved | VS1 video, VS2 submission, both the owner's | submit target Sun 14:00, leaving 2 h of margin; deadline 16:00 |

**Slip rule.** If G0 lands after Fri 22:00, every checkpoint before the freeze moves by the delay; the freeze and the
reserve never move. At each checkpoint the coordinator compares landed tasks with the table; for every full 2 hours
behind, it applies the next unapplied cut in §8 and tells the owner which. Two fixed deadlines override the table: if
CP4 has not passed by **Sun 00:00**, the live rehearsal is cut (§8 cut 10) because four owner-signed stages, verification
and a manifest do not fit in the remaining time; if G0 has not happened by **Sat 10:00**, the plan starts with cuts 1
to 6 already applied. G0 at Fri 22:00 is unlikely (the owner first reads about 6,000 lines and gives about 45
rulings), so the slip rule runs from G0's actual time from the start. **Landing time** is serial (§6: one commit at a
time, gate green at each): each window after CP1 budgets its commits × one timed gate run, and TS4 its mutants × one
timed cycle (apply, recompile, killer row, full suite for MISATTRIBUTED); a shortfall is a slip.

**Critical path.** G0 → SR1 → CT1 → CT2 → CT3 → CT4 → CT5 → DP1 → DP2 → TS4 → RV2 → source tag → DP5 → CP5 → freeze. Everything else
runs beside it. The longest non-critical chain is OA2 → FK2 → FK3 (the oracle fork proof), which needs the owner to set
`ARBITRUM_MAINNET_RPC_URL` (SR1 row 14, resolved) before Sat 18:00.

## 3. Start condition (G0) and the specification reconciliation (SR1)

**G0 is the owner's go**, in writing, recorded by the owner in the ledger (only the owner edits `DECISIONS.md`). It
covers: the two specifications, as reconciled below; the remaining SR1 rows 15–17; the pinned post-tag diff TS5a
hashes (TM B15); and this plan. The "Specification choices" ruling (S1–S8) already settles the eight SC §15
choices and the V1/NFLX question (§1), so G0 does not need to re-decide them, only to confirm they are recorded
correctly. SO §16 owner items 4 to 7 (grace period, minimum availability, a testnet Streams declaration, equity
freshness) concern mainnet or disabled adapters and are not needed before the freeze; fork rows that construct an
adapter use SO §7.3's proposed 3600 s grace period, labelled proposed.

**One ruling sheet.** SR1's read-only preparation also produces the owner ruling sheet, handed over in the
conversation and landed with SR1's commit: one row per remaining decision, one id, a recommended default, its
sources (SR1 rows 15–17; DG §11; ES §12; TM §14 items 1, 3, 4, 7; §9 below), and the task it blocks. THREAT-MODEL
K1–K10, ES C-1 to C-5 and TM §3 restated SR1's conflicts under other ids; each of those is reconciled the same way
as the matching SR1 row above, and none needs a separate ruling-sheet line. A default counts only when the owner
accepts it in words; whether one line may accept them all is the owner's call (§9 item 16).

**SR1 existed because the two specifications disagreed.** Written independently, they named the same things
differently and, in five places, specified different behaviour; code written against both would have satisfied
neither. The owner's "Specification choices" ruling (`DECISIONS.md`, S1–S8) reconciles SR1 rows 1–14 and 18 in
one line each: `IUnicaPriceOracle.latestPrice` alone, plus a separate `IUnicaOracleRoute.feedIdFor`/`adapterKind()`
outside the fixed interface, never `routeOf` (row 1); the market's oracle route bound on-chain into `marketId`
itself and re-checked at `register` and every `_checkOracle`, never by readback alone (row 2, S8); one error
catalogue homed in SC, `OraclePolicyRequired`/`OraclePolicyMalformed`/`OracleAdapterNoCode`/`OracleFeedMismatch`/
`OracleMaxAgeOutOfRange`/`OracleDeviationOutOfRange`/`OraclePolicyDisabled`/`OraclePolicyNotTighter`, and
`WrongMarketStatus` for a RETIRED market (row 3); `OraclePolicySet` re-emitted with the full policy on every
tighten, `OraclePolicyTightened` dropped (row 4); `MAX_ORACLE_AGE = 300` s and `MAX_DEVIATION_BPS = 300` as
on-chain ceilings for this release, enforced on both `register` and `tightenOraclePolicy` (row 5, S4); `dO ≤ 18`
with two `uint128` range checks run before any multiplication, each named `OraclePriceOutOfRange` (row 6);
`updatedAt != block.timestamp` refused as `OracleTimestampNotBeforeBlock` (row 7); an adapter revert propagates
and is wrapped by the PoolManager as `WrappedError`, never caught as `OracleUnavailable` (row 8); the
`refOutFloor`/`refOutCeil` formula with inclusive bounds, `ExecutionBelowOracleBand`/`ExecutionAboveOracleBand`,
a value exactly on either bound passing (row 9); `oracleCondition()` on the hook, `condition()` dropped (row 10);
`referencePrice`, `referenceDecimals`, `referenceUpdatedAt` (`uint64`), `demonstrationOnly`, no `oracleFeedId`
field (row 11); single-route adapters only — one instance per route, constructor immutables, no admin beyond the optional downward-only quote-freshness operator (O2), a
`"CHAINLINK_FEED"`-tagged route id (row 12, S8); the Streams/CRE error names `VerifierFeeManagerSet`,
`NoVerifiedReport`, `ReportNotYetValid` (row 13); `ARBITRUM_MAINNET_RPC_URL` everywhere, matching `foundry.toml`,
`ARBITRUM_ONE_RPC_URL` dropped (row 14); and TEST-MATRIX's own row-id scheme kept as the only one — oracle fork
rows `OF1`–`OF9`, `F` reserved for the factory namespace, SC's band-spending row renamed `O26`, no alias, and the
earlier `FO1`–`FO9` proposal withdrawn (row 18). Each resolution is carried into whichever task below is
load-bearing for it (CT1–CT3, CT6, OA2, OA3, FK3, DP1). Only three rows stay open, each an owner ruling with no
default, and no contract task starts before G0 regardless:

| # | Subject | Still open | Blocks |
|---|---|---|---|
| 15 | Chain-file `source` prefixes | only `CA`, `MCP`, `DR` accepted (SO §12.1); CH1's new evidence needs a prefix or a home | CH1, CH2 |
| 16 | UNICA v4 receipt documentation home | a new `docs/unica-v4/RECEIPT-SCHEMA.md` (this plan's own proposal, below) or a section of the frozen `docs/RECEIPT-SCHEMA.md` (STOP-FROZEN either way until ruled) | DC2 |
| 17 | The determinism pin for `HOOK_CREATION_CODE_HASH` | an explicit optimizer key in `foundry.toml` (a STOP-FROZEN edit) or a checked `forge --version` alone (this plan's own proposal, below) | TS5a, DP5 stage A |

**Proposed precedence, unchanged where it still applies.** SC owns every name, ABI, event layout and error of the
four market contracts (SO §6 itself defers the event layout to the settlement specification). SO owns adapter
internals, the chain files and the chain helper. Rows 15–17 are owner rulings, not precedence questions. For row
17 this plan proposes the `forge --version` check against the version CI already pins in
`.github/workflows/ci.yml`, leaving `foundry.toml` unchanged. For row 16 it proposes a new
`docs/unica-v4/RECEIPT-SCHEMA.md`, leaving the frozen file untouched.

## 4. Task graph

**Conventions.** Task IDs (two letters and a number) are this plan's own; test-row names (R, F, H, X, K, M, MX, O, S,
V, I) are the specifications' and DR's. Every task names its inputs, its outputs (the only paths it may write), an
acceptance test the coordinator re-runs itself before landing, and its STOP points (§5). "Needs" lists hard
dependencies; a task may start the moment they have landed. Code is written fresh from the specifications: the DR
prototypes were built outside this repository and nothing is copied from them or from the frozen generation (the
repository's "Never copy" rule; STOP-COPY). Every negative row states the attack's precondition, pairs with a passing
control in the same test, and asserts the inner selector and the emitting hook, never a bare revert (DR C5). Every
acceptance line reports counts ("n rows run, n passed, 0 failed, 0 skipped"); an empty result is a failure. STOP-GO
and STOP-RULE apply to every task; STOP-COPY to every task that writes code, tests or scripts; STOP-SIZE to every task
that adds bytecode to a contract (CT2 to CT7, OA2 to OA4), whether or not its row repeats them.

**What runs in parallel.** From G0: SR1, CH1, TS5a, TS5c and PR1 are independent; CH4 follows CH1. After CT1: CT2, OA1 to OA4, and
PR2 are independent of each other and of CH2 and CH3. After CT3: CT5 (executor and factory) runs beside CT6 and CT7,
which both edit the hook and therefore queue (one writer per file, §7 rule 6). After CT4 and CT5: TS1, TS2, TS3, DP1
and FK1 are independent. DC1 to DC3 start once their subjects land. The oracle fork chain (OA2 → FK2 → FK3) never
waits on the deployment chain, and the deployment chain never waits on it.

### 4.1 Chain configuration (CH)

| ID | Task | Needs | Inputs → outputs | Acceptance test | STOP |
|---|---|---|---|---|---|
| CH1 | Record the 46630 Uniswap v4 addresses (PoolManager, PositionManager, StateView, Permit2) as evidence | G0 | committed frozen records only (`docs/experimental/*`, the committed `broadcast/StockSettlement46630.s.sol/46630/*.json`) → a new evidence file under `docs/unica-v4/evidence/`, each address with the committed file and field it came from | a second reviewer re-derives every address from the cited file; zero addresses without a committed source; the SR1 row-15 prefix exists | none; the optional code-hash read needs `ROBINHOOD_TESTNET_RPC_URL` (STOP-RPC) |
| CH4 | Record the TSLA beacon fingerprint as evidence | CH1 | read-only calls on 46630 at a recorded block: the TSLA proxy's beacon, its `implementation()` and that address's code hash → an evidence file under `docs/unica-v4/evidence/` with block, values and variable name; nothing taken from the record outside this repository (DR A7) | a second reviewer re-reads the same block and gets the same values | STOP-RPC (`ROBINHOOD_TESTNET_RPC_URL`) |
| CH2 | Chain files | SR1, CH1 | SO §12.1 → `config/chains/46630.json` (enabled, TSLA listed, NFLX unlisted with its reason), `config/chains/42161.json` (present, `enabled: false`, `disabledReason` naming Q9, Q132, Q64, Q70, Q71, Q91) | CH3's offline validator passes both; every address has an accepted `source`; `jq -e .` parses both; no RPC URL appears anywhere in them | none |
| CH3 | Chain helper and its CI rows | CH2 | SO §12.2 → `script/unica-v4/chain.sh`, `script/unica-v4/chain.test.sh`, planted bad files under `test/unica-v4/chains/`, one CI step | refuses each planted file by name (disabled chain, id mismatch, unset `rpcEnv`, `null` required address, bad source prefix, mainnet without `requireOracle`, L2 mainnet without a sequencer feed, a MOCK adapter), a stray `CHAIN` variable, and `requireOracle = false` on a `mainnet` file; the RPC steps report SKIPPED with a count in CI, never passed; it never prints a variable's value | none |

### 4.2 Contracts (CT), under `src/unica-v4/`

Sizes are measured on every contract task under the unchanged profile and recorded in the task's return; they replace
SC §12's estimates. The size gate (TS5b) lands with CT2, so every later commit is checked.

| ID | Task | Needs | Inputs → outputs | Acceptance test | STOP |
|---|---|---|---|---|---|
| CT1 | Shared types, errors, events; `UnicaMarketMath` (opening price, `seedWidth`); `IUnicaPriceOracle` (`latestPrice` only) and the separate adapter-level `IUnicaOracleRoute` (`feedIdFor`, `adapterKind`) | SR1 | SC §3, §6–§8, §10; SO §2 as reconciled (SR1 row 1) → the library and interface files; the M2 and M4 rows under `test/unica-v4/` | M2 fuzz, 10,000 runs, rate up to 1e36, spacing 1 to 1000, exact cross-multiplied bound with zero tolerance, no swallowed reverts (DR C15); TSLA shape opens at tick −216540 (SC §7, prototype value re-measured); `IUnicaPriceOracle` has no `routeOf` and no `feedIdFor` | STOP-COPY |
| CT2 | `UnicaMarketRegistry`: records, lifecycle (ADMIN and PAUSER pause; only ADMIN unpauses or retires, RETIRED terminal, S2), roles, two-step admin, pauser, allowlist, reverse maps, `marketId` bound to `policy.adapter`/`policy.feedId` (S8), oracle policy (`MAX_ORACLE_AGE = 300`, `MAX_DEVIATION_BPS = 300` ceilings, S4) and caps with tighten-only and no raise path (S3), the S5 per-market `maxSeedPayout` (no registry-wide total) | CT1 | SC §4–§6, SO §3 as reconciled (SR1 rows 2–5) → the registry | R1–R10 (R4 walks all 49 transitions; R9 reverse maps write-once; R10 event topics and data, including `OraclePolicySet` and `MarketStatusChanged` on every transition); SO O1–O10; `register` reverts `OracleFeedMismatch` when `IUnicaOracleRoute(adapter).feedIdFor(asset, payout) != policy.feedId`; `OracleMaxAgeOutOfRange`/`OracleDeviationOutOfRange` at 0 and above the ceiling; a raise attempt on any cap reverts `CapsNotTighter`/`CapsInvalid`; runtime under 90 % of 24,576 or STOP-SIZE | STOP-SIZE |
| CT3 | The settlement pair: `UnicaMarketHook` (callbacks, fill checks, receipt without oracle fields) and the `UnicaMarketExecutor` it creates (payer-bound orders, `pay`) | CT2 | SC §8.1, §9.1, §9.3 → hook and executor | one row per error of SC §8.1 and §9.1, including the rows SC and DR name (H3, H9, H11, and H14, the ABI pin sabotaged by an added function); X1–X8, X2/X5/X7 with DR C5's preconditions and controls; H5 and H5b; `executor == CREATE(hook, 1)` | STOP-SIZE, STOP-COPY |
| CT4 | `UnicaMarketFactory`: rejects every `(fee, tickSpacing)` pair except `(500,10)`, `(3000,60)`, `(10000,200)` (S1); reads both token decimals by `STATICCALL` into the 288-byte hook arguments and checks them against the configured expectation (S7); `register` re-verifies the S8 route binding | CT2, CT3 | SC §7, §12 → the factory | SC factory rows F1–F18 with F1b, F1c; F18 (a predicted hook address refused `InvalidHookResponse` before creation, `NotMarketFactory` after); F22 (a `decimals()` return that is missing, reverts, or is outside 0–18 reverts `DecimalsUnreadable`; a value that disagrees with the configured expectation reverts `DecimalsMismatch`); F23 (the decoded hook arguments round-trip against `previewMarket`'s record); any other `(fee, tickSpacing)` reverts `FeeTierUnsupported(uint24, int24)`; `registry == CREATE(factory, 1)`; initcode under 49,152 | STOP-SIZE |
| CT5 | Per-transaction and per-UTC-day caps; seed cap at `markSeeded`; `tightenCaps` only ever lowers `maxPerTxPayout`/`maxPerDayPayout` (S3), never `maxSeedPayout`, which has no setter | CT3, CT4 | SC §7, §9.2 → executor and factory edits | K1–K4 at each boundary (equal passes, one base unit over fails); a day rollover row; a refusal unwinds the day's increment; K7: no function raises any cap, and a tighten never alters `payoutUsedOnDay` history or an emitted receipt | STOP-SIZE, STOP-COPY |
| CT6 | Oracle enforcement in `afterSwap`, fail closed; the `oracleCondition()` view | CT3, OA1 | SC §8.2–§8.3, SO §4–§6 as reconciled (SR1 rows 1–13) → hook edit | SO O11–O20 at both boundaries of every check, `ExecutionBelowOracleBand`/`ExecutionAboveOracleBand` with an equal-to-bound row passing on each side; O18 fuzz over {6, 8, 18}² decimals and both orderings; row O26 (SC §8.3's band-spending row: maximum payment on the maximum seed passes; repeated payments halt at the band); `oracleCondition()` returns `(OracleCondition, bytes4 reason, price, decimals, updatedAt)` (SR1 row 10) | STOP-SIZE |
| CT7 | Receipt fee fields from `slot0` in the same swap: `hookFeePips`, `lpFeePips`, `protocolFeePips`, `swapFeePips` | CT3 | SC §11, §11.1 → hook edit; a local PoolManager built from the official bytecode in the test | H12a `(0, 3000, 0, 3000)`; H12b `(0, 3000, 500, 3499)`; H12c `(0, 3000, 1000, 3997)`; `swapFeePips == Swap.fee` in each transaction; mutants M-fee-1 and M-fee-2 turn their rows red | STOP-SIZE, STOP-COPY |

### 4.3 Oracle adapters (OA)

| ID | Task | Needs | Inputs → outputs | Acceptance test | STOP |
|---|---|---|---|---|---|
| OA1 | `MockOracleAdapter`, tests only | CT1 | SO §10 → `test/unica-v4/mocks/MockOracleAdapter.sol` | TS5d: no file under `src/`, `script/unica-v4/` or `deployments/unica-v4/` names it | none |
| OA2 | `ChainlinkFeedAdapter`, single-route only (S8): one instance per route, constructor immutables, no admin beyond the optional downward-only quote-freshness operator (O2) | CT1, SR1 | SC §10, SO §7 as reconciled (SR1 rows 1, 2, 12) → `src/unica-v4/oracle/` | unit rows with a stand-in aggregator and sequencer feed under `test/unica-v4/`: every constructor refusal, every `latestPrice` refusal, sequencer down, unknown and grace period; `feedIdFor` returns the immutable `keccak256(abi.encode("CHAINLINK_FEED", ASSET_FEED, QUOTE_FEED))` and reverts `PairNotSupported` for any other pair; no `Route[]` constructor; runtime under 12,000 (SC §12 estimate, re-measured) | STOP-SIZE, STOP-COPY |
| OA3 | `ChainlinkStreamsAdapter`, disabled, push-then-read: `submitReport` verifies and stores, `latestPrice` reads the stored report | CT1 | SO §8 as reconciled (SR1 row 13) → `src/unica-v4/oracle/` | SO O21–O23 with a test verifier: replay, not newer, expiry, status mask, `VerifierFeeManagerSet`; no chain file enables it | STOP-PAID (a real report needs a subscription); STOP-SIZE, STOP-COPY |
| OA4 | `ChainlinkCREAdapter`, simulation-only, push-then-read: `onReport` verifies and stores, `latestPrice` reads the stored report | CT1 | SO §9 as reconciled (SR1 row 13) → `src/unica-v4/oracle/` | SO O24–O25 with a test forwarder: wrong forwarder, the simulation forwarder refused at construction, workflow mismatch, not newer | STOP-PAID; STOP-SIZE, STOP-COPY |

### 4.4 Cross-cutting tests and gates (TS)

The repository's existing gate (the CI `gate` job, the provenance check, the secret scanner, the local
attribution hook) runs on every commit. This plan adds rows and never removes one.

| ID | Task | Needs | Inputs → outputs | Acceptance test | STOP |
|---|---|---|---|---|---|
| TS1 | Invariants | CT4–CT7 | SC §9.3 (I1 restated), DR C3 → an invariant suite under `test/unica-v4/` | I1 (no UNICA v4 call changes the executor's or hook's balances) with a donor action; I1b (a donation never blocks the next `pay`); I3b (every `Settled` recipient equals the stored one); I4 with standing maximum approvals; I7 plus the three reverse maps; on one 6→18 and one 18→6 market in each ordering; every handler action's call count reported non-zero | none |
| TS2 | The 18-market matrix and settlement fuzz | CT4, CT7 | DR C14, C15 → `test/unica-v4/` | {6, 8, 18}² × both orderings built once; fuzz over market, amount up to 5 % of depth, rate and seed; delivered ≥ minOut; the on-chain opening price ≤ RATE by exact cross-multiplication; no residual; fee fields equal `Swap.fee` | none |
| TS3 | Adversarial rows | CT4, CT6 | SC §3, §9.3; DR A6, A13, C6, C18 → `test/unica-v4/` | S1 (a look-alike hook through an attacker factory: all three reverse lookups zero, the emitter check fails for it and passes for the real receipt); H5c; X9a–X9d; an oversized order at the smallest allowed spacing reverts `PartialFill` under a stated gas ceiling | none |
| TS4 | The UNICA v4 mutation table | CT2–CT7, TS3 | SC §9.3, §11.1; DR C4 → a new table in `script/mutation-suite.sh`, run as `make mutants-unica-v4` | at least one mutant per guard, including every row of SC §9.3, M-fee-1, M-fee-2, both M4 mutants, the reverse-map writes, the factory check in `beforeInitialize` and each oracle check; every mutant KILLED by its named row; 0 MISATTRIBUTED | none |
| TS5a | Frozen generation pinned (TM G1, G2) | G0, including the owner's acceptance of the pinned diff | DR B7, C13; TM §11.1 → gate rows under `script/` | G1: the tag `experimental-46630-settled` resolves to `e5a0185`; `git status --porcelain --untracked-files=all` is empty on TM §11.1's frozen paths; the SHA-256 of `git diff --binary experimental-46630-settled HEAD -- <those paths>` equals the pinned value, the reviewed post-tag diff of `eea86d2` and `903a8c9` (TM B15). The literal "diff is empty" form fails on this branch today and is not used. G2: each frozen creation code is an exact byte prefix of its committed broadcast input, which shows the post-tag NatSpec edits changed no bytecode. Sabotage, in a throwaway worktree: one appended byte in a frozen file turns G1 red; one flipped constant byte turns G2 red | STOP-FROZEN |
| TS5b | Size budget | CT2 | SC §12 → `script/size-budget.sh` extended | fails any UNICA v4 contract or adapter above 24,576 runtime or 49,152 initcode, warns at 90 %; a planted oversized contract turns it red | STOP-SIZE |
| TS5c | UNICA v4 claims family | G0 | DR C17, the ledger's wording rules (Q82, Q109, Q124, Q125) → a check with a planted self-test, alongside `script/check-robinhood-claims.sh` | catches, in docs, the README, `script/unica-v4/` output strings, `deployments/unica-v4/` and `prototype/unica-v4-ux/`: the ledger's banned wording without a negation; faucet stock or uTUSD without a no-value label; "verified" beside a UNICA v4 address with no explorer link; a frozen address in a UNICA v4 context; a bare "v4"; present-tense deployment wording ("deployed now", "deployment today") about UNICA v4 that no committed manifest backs; any Chainlink wording other than "planned" or the exact fork sentence; each planted case is caught and each clean control passes | none |
| TS5d | Boundary rows | OA1 | SO §10, §12; DR B1, C9 → gate rows | no file under `src/`, `script/unica-v4/` or `deployments/unica-v4/` names the mock; nothing under `script/unica-v4/` imports from `test/`; no address or chain-id literal in `src/unica-v4/`; no token address literal in `script/unica-v4/*.sol` or `*.sh` | none |

### 4.5 Fork proofs (FK)

Every fork suite runs through a runner that refuses success unless executed rows equal the declared count and skipped
rows are zero, and prints both numbers (DR C2). A fork is a read of chain state into a local simulation; it signs
nothing. The RPC variables are set by the owner in the environment; no implementer reads `.env` or prints a value.

| ID | Task | Needs | Inputs → outputs | Acceptance test | STOP |
|---|---|---|---|---|---|
| FK0 | A 46630 fork pin | CH1 | DR C1; the existing `test/fork/ForkPin.sol` pattern (Sepolia only) as a lesson, not a source → `test/fork/ForkPin46630.sol` | pins a block after 117535202 (SC §1.1); asserts that block's hash, the chain id and the code hashes of PoolManager, PositionManager, Permit2, StateView, the TSLA and NFLX proxies, their beacon and uTUSD | STOP-RPC (`ROBINHOOD_TESTNET_RPC_URL`) |
| FK1 | 46630 fork rows: TM §12's declared set for every TSLA LIVE stage, plus V1's separate claim, compared by id | FK0, CH4, CT4, DP1 | SC §3, DR A1, A7, A8, C1, C8, C10; TM §7, §8, §12 → the fork suite TM §2 rule 8 names | two dispatches under §7 rule 1. FK1a: V0 (every value the frozen settlement produced: position L and ticks, post-swap `sqrtPriceX96`, tick, liquidity, delivered 393052, not delivery alone), V0s, V2 (never cut), V5, V7, V11, V14 against CH4's fingerprint. FK1b: V4, V6, V9, V10, V8 (never cut), V12 and V13 once their roles are identified (issuer pause and LP exit; raw-balance assumption proven or recorded unproven); V3 look-alikes only from a committed fixture naming its explorer source, else reported not run. V1 (NFLX), reading a `test/unica-v4/` fixture rate labelled "test fixture — not an approved demonstration rate," backs only "configuration-only onboarding proven on a fork" (`DECISIONS.md` "Specification choices") and is never part of the TSLA LIVE declared set — no TSLA LIVE stage waits on it, and until it runs the onboarding claim reads "proven in local tests (N1, N2)" only. The runner prints `N declared, N run, N passed, 0 failed, 0 skipped` and compares ids (TM §12) | STOP-RPC |
| FK2 | Arbitrum One feed descriptions | SR1 | SO §7.1, §16 item 2; MCP addresses → a read-only fork row that reads `description()` and `decimals()` of the ETH/USD, USDC/USD and sequencer feeds at a pinned block; an evidence file under `docs/unica-v4/evidence/` with the block, values and variable name | a second reviewer re-reads the same block and gets the same strings; nothing is written to a chain file until the evidence lands | STOP-RPC (`ARBITRUM_MAINNET_RPC_URL`, SR1 row 14); needs Q91 and Q95 (§1) |
| FK3 | The oracle on a fork | FK2, OA2, CT4, CT6 | SO §15 as reconciled (SR1 row 18); TM §9 → fork rows OF1–OF8 on 42161 and OF9 on 4663, in the fork suites TM §2 rule 8 names; the evidence file `docs/unica-v4/evidence/ORACLE-FORK-42161.md` with block, hash, feed readings, counts and variable names | OF1–OF8: construction on the real feeds; a settlement inside the band; a pool 3 % off refused on each side; `maxAge` by warp; sequencer down, grace and unknown by `vm.mockCall` on the real address; 8 declared, 8 run, 0 skipped. OF9 (supplementary, not needed for the wording): `"RHTSLA / USD"`; the issuer-hold refusal stays BLOCKED (TM §9). The asset is a test token deployed inside the fork, priced through the ETH/USD route for the test only; no ETH market is claimed. Only after that evidence file lands may any surface say "Chainlink integration demonstrated on a fork", linked to it | STOP-RPC (plus `ROBINHOOD_MAINNET_RPC_URL` for OF9); needs Q91 and Q95 (§1) |

### 4.6 Committed deployment tooling (DP), under `script/unica-v4/`

Stage letters follow DR: A infrastructure, B propose, C open (initialise, seed, mark seeded, readback, activate),
D settle, E–G the NFLX equivalents (not run, Q110), H verification, I manifest. Every tool calls `chain.sh` first and
reads only the variables it exports. Tool and data-file names are DG §2.1's (the chain-neutral `deploy.sh`, not DR's
`unica-v4-46630.sh`; DG §11 choice 3).

| ID | Task | Needs | Inputs → outputs | Acceptance test | STOP |
|---|---|---|---|---|---|
| DP0 | Transaction-size probe on 46630, only on the owner's go (§9 item 7) | the owner's ruling | one inert creation of about 41 KB of calldata, no UNICA v4 code and no value, handed over with the tx-handoff discipline before CP3 → the receipt or the refusal as evidence under `docs/unica-v4/evidence/` | the evidence names input size, block and outcome; a refusal is recorded, never retried larger | STOP-FUND; STOP-SIGN; STOP-RPC |
| DP1 | The forge script and the 46630 data files | CT4, CT5, CH3 | SC §5, §7; DR B1, B3, B9, decision 14 → `UnicaMarketDeploy.s.sol`; `markets/46630/tsla-utusd.env` (raw `1e18`-scaled rate 395, fee 3000, spacing 60, seed 100 uTUSD, caps from Q5–Q7 in uTUSD base units, policy disabled); `settlements/46630-tsla.env` (payment 0.001 TSLA, the Q110 merchant with its source, an order salt) | every stage runs end to end on a disposable local chain the test starts, from a clean checkout; it asserts `block.chainid == UNICA_CHAIN_ID`; the payout expectation and minter are configuration and the mint runs only when `MINTER() == deployer`, else a balance ≥ seed is required (DR B1); the seed range comes from `UnicaMarketMath.seedWidth`; the S5 $100 cross-market total (a deployment-script and manifest refusal, never an on-chain field) fires on a planted second market whose enumerated seed sum exceeds it, and separately on a paged-enumeration failure (short page, count mismatch, foreign payout token); the configuration-only proof (DR B9, C16) onboards NFLX from a `test/unica-v4/` fixture labelled "test fixture — not an approved demonstration rate," which the wrapper refuses to load from `script/unica-v4/markets/` | none |
| DP2 | The wrapper and its shell rows | DP1, CH3 | DR B2, B5, B8, B10, C2, C11 → `deploy.sh`, `deploy.test.sh` | DRY_RUN prints, by label, per stage: chain, deployer, nonce, contracts, constructor arguments, CREATE2 salts, predicted addresses, transaction count, gas ESTIMATE with its L1 range (DR B4), the verification and readback plan, and the spend ceiling, and sends nothing; the predicted hook, executor, marketId and poolId equal what the disposable-chain run then deploys; LIVE is refused without a keystore account name, with `PRIVATE_KEY` or `--private-key` present, with a stray `CHAIN`, on any id `script/mainnet-guard.sh` refuses, and at stage A unless HEAD is the source tag on a clean tree with the `forge --version` CI pins; LIVE is refused unless the UNICA v4 fork suite ran with executed == declared and 0 skipped (a row with the variable unset must refuse); each market gets its own broadcast directory; dry-run endpoint records are scrubbed on exit (a planted keyed URL is gone afterwards); the nonce is re-read every stage; it states that estimation does not test the transaction-size limit (DR B5, C19) | none to write; LIVE is only ever run by the owner (STOP-SIGN) |
| DP3 | Readback per stage | DP1 | SC §3, §5; DR A3, A9, A10, C12 → `readback.sh` | A: `FACTORY`, `admin`, `REQUIRE_ORACLE == false` on 46630, `HOOK_CREATION_CODE_HASH` equals the local build. B: PROPOSED, `hook & 0x3FFF == 0x20C0`, the three reverse maps, `executor == CREATE(hook, 1)`, `demonstrationOnly`. C: `slot0` equals the stored price and tick, the `Initialize` log sits in the `initializeMarket` transaction whose `to` is the factory, `seedDepth ≥` the minted L and the deployer position's own liquidity equals L, SEEDED, then ACTIVE after `activate`. D: `Settled` from the executor, the receipt from the hook, `swapFeePips` equal to the same transaction's `Swap.fee`, reference fields zero with `demonstrationOnly`, the recipient delta ≥ minOut. Offline tests replay recorded disposable-chain outputs and each planted mismatch is refused by name | none |
| DP4 | The manifest | DP3 | DR B2, B6, C12 → `manifest.sh`, `manifest.test.sh`, writing `deployments/unica-v4/<chainId>.json` | reads every broadcast run file keyed by marketId and contract address, refusing a market whose transactions are not each found exactly once; writes a verification tier only from a read-only explorer query result, with the query and its timestamp, else "not verified"; records the source tag, `HOOK_CREATION_CODE_HASH`, the forge version and the factory's deployment block; planted cases fail: a failed verification, a missing required field, any RPC URL, a frozen address under a UNICA v4 key, a deleted TSLA run file | none |
| DP5 | The 46630 rehearsal, TSLA only | DP2–DP4, TS4, FK1, RV2, the source tag | the committed tools; the deployer and 46630 ADMIN `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73` (source: SC §4, citing `docs/experimental/STOCK-46630-DEPLOY-PLAN.md`) → every broadcast run file, `deployments/unica-v4/46630.json`, a rehearsal evidence file under `docs/unica-v4/evidence/` | stages A, B, C, D, H, I in order, exactly as DG §4 to §9 specify them, behind DG §2.3's G0 gate. Each: DRY_RUN printed and handed over with the tx-handoff discipline; the owner runs LIVE; readback green before the next stage. Stage A (the factory creation, about 37–41 KB, ESTIMATE, SC §12) is the size canary: a refusal at submission consumes no nonce and applies cut 10 unless the two-code-store fallback was built and reviewed first (DG §4). H: Sourcify first, then Blockscout, constructor arguments supplied explicitly (hook 288 bytes, executor 224, SC §7, §9); the tier recorded per contract. The nonce delta equals the non-skipped transactions the plan printed (DR C16) | STOP-TAG; STOP-FUND; STOP-SIGN at A, B, C and D; STOP-PUSH at H, because verification publishes the UNICA v4 source before any push; requested at CP4, and without it H does not run |

### 4.7 The five-screen static prototype (PR), under `prototype/unica-v4-ux/`

Built after the specification checkpoint on frozen fixtures (Q127). It makes no network call, collects nothing (rec
94), is never called a hosted checkout (Q86), and is never published by the Pages workflow (Q122). Visual identity
per Q124; interaction patterns only are borrowed, never branding, code, exact layouts or wording.

| ID | Task | Needs | Inputs → outputs | Acceptance test | STOP |
|---|---|---|---|---|---|
| PR1 | Frozen fixtures | G0 | the frozen settlement: pay transaction `0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300`, block 117535202, 0.001 faucet TSLA in, 393052 raw uTUSD out (source: SC §1.1 citing `docs/experimental/STOCK-46630-FEE-FIELD.md`), and the committed broadcast records → `fixtures/` JSON, each value naming its committed source | labelled "Testnet demonstration — no-value tokens" and "from the frozen experimental settlement, which is not UNICA v4"; oracle fields are the demonstration values (SO §14); no USDC, ETH, Base, oracle or mainnet value (Q123); a second reviewer traces every value to its source | none |
| PR2 | Five screens, one commit each | PR1 | the UX direction (ledger standing rulings; Q124–Q127) → static HTML and CSS | 1 landing, with the testnet label and Chainlink as planned; 2 sign-in and onboarding, a static "planned" state because Privy is deferred unless CP2 says otherwise, and never shown working; 3 merchant overview with the test-mode badge; 4 create a payment request that names its payer, because UNICA v4 has payer-bound orders only and public payment links are UNICA v5 (Q128); 5 checkout with receipt: you send, merchant gets, minimum received, the four fee fields, "Demonstration rate — no oracle", pool, hook and ticks under advanced details. Every number traces to the fixture | STOP-PUSH (publishing) |
| PR3 | The prototype boundary check | PR2, TS5c | Q86, Q122, Q123 → a committed check | fails on any network call (fetch, XHR, WebSocket, an external script or stylesheet), on any number absent from the fixture, and if `.github/workflows/pages.yml` would publish `prototype/`; each planted case caught | none |

### 4.8 Documentation (DC)

| ID | Task | Needs | Inputs → outputs | Acceptance test | STOP |
|---|---|---|---|---|---|
| DC1 | Threat model update | TS4, RV1 | SC §3, §4, §9.3, §14; DR all 46 findings → an update of the existing `docs/unica-v4/THREAT-MODEL.md` (DR C20), never a new file | a table threat → defence → named row → mutant; each of the 46 DR findings marked landed (with section and row), owner-accepted limitation, or open; a committed check fails when a named row does not exist, sabotaged by a planted missing row | none |
| DC2 | UNICA v4 receipt schema | CT6, CT7, SR1 row 16 | SC §3, §11 → `docs/unica-v4/RECEIPT-SCHEMA.md` (as proposed in §3) | every field's source; `Settled` as the success signal; emitter authentication; the demonstration flag; topic0 equal to the value the test pins | STOP-FROZEN if the owner instead chooses the frozen file |
| DC3 | Runbook | CT2, FK1 | Q69; Q65, Q70; U7, U8; DR A8; SC §8.3 → `docs/unica-v4/RUNBOOK.md` | covers: pause (PAUSER or ADMIN), unpause and retire (ADMIN only), the incident procedure, the issuer pause and the LP exit, a beacon implementation mismatch, a withdrawn seed, an oracle leaving the band (retire and relist as a new version); every command names its committed tool | none |
| DC4 | README section and evidence-page text | DP5 or its recorded stopping state; FK3 or its cut | the manifest and the evidence files → README and page content, not published | only manifest-backed deployment claims; "Chainlink integration demonstrated on a fork" only if FK3 landed, else "planned"; sponsor order Uniswap v4, ENSv2 on Sepolia, The Graph, then Chainlink and Privy as additional planned integrations; ENSv2 and The Graph each either cite named earlier-generation evidence labelled "not UNICA v4" (for example `integrations/ensv2/`, `integrations/graph/`) or are marked as not part of UNICA v4; README-listed, dashboard-registered, completed and intended integrations kept apart; TS5c green | STOP-PUSH |
| DC5 | Disclosure | every lane | the landed commits → `AI_USAGE.md` | names the tools and the specific files and directories each touched for UNICA v4 (the repository's disclosure rule) | none |

### 4.9 Independent review (RV)

A reviewer never reviews files it authored, starts from a fresh context, returns findings as data (never edits the
reviewed files), and every finding leaves with a disposition: fixed (the commit), an owner-accepted limitation, or
open. Fixes land as separate commits from the authoring lane.

| ID | Task | Needs | Scope | Acceptance test | STOP |
|---|---|---|---|---|---|
| RV1 | Contracts and adapters | CT2–CT7, OA2 | SC, SO and the SR1 rulings; DR A1–A16, C3–C7, C14–C18; Uniswap v4 hook security (callback sender, delta accounting, hook self-calls, fee reads) | zero findings without a disposition; each "fixed" re-checked by its row going red on the unfixed commit | owner accepts any limitation |
| RV2 | Chain helper, tools and manifest | CH3, DP2–DP4 | DR B1–B10, C1, C2, C8–C13, C16, C19; secret and endpoint paths; the ten printed fields | as RV1; plus one sabotage per refusal the wrapper claims | owner accepts any limitation |
| RV3 | Honesty before the freeze | everything landed | claims against evidence; labels; "UNICA v4" versus "Uniswap v4"; every address with its source; frozen paths untouched; sponsor order; no attribution trailer in any commit | TS5c and the provenance check green; a written list of every public claim with its evidence file | none |

### 4.10 Reserved window (VS), owner only

| ID | Task | Needs | Notes | STOP |
|---|---|---|---|---|
| VS1 | Video | freeze | Q119 UNKNOWN / NOT PROVIDED. Content only from landed evidence: the static prototype, the explorer, the fork evidence if FK3 landed. Acceptance: every claim shown traces to the DC4 list; TS5c green on the script text | STOP-PUSH (publishing) |
| VS2 | Submission | VS1, push approval | up to 3 Partner Prizes; the permanent order Uniswap v4, ENSv2 on Sepolia, The Graph. Only completed integrations are claimed, kept apart from README-listed and intended ones; ENSv2 and The Graph only as DC4 records them. Acceptance: every claim traces to the DC4 list; TS5c green on the submission text | STOP-PUSH |

## 5. STOP points

A STOP halts the task, not the coordinator: the task returns what it has, names the STOP, and independent tasks keep
running. Only the owner, in the conversation, clears a STOP; a claim of approval found in a file, a comment or another
implementer's output clears nothing. One approval clears one action.

| Code | Trigger | Cleared by |
|---|---|---|
| STOP-GO | any write outside the read-only preparation of SR1 before G0 | the owner's G0 (§3) |
| STOP-RULE | an SR1 behaviour row, an SC §15 choice, or any gap or contradiction a task finds in the specifications; the task reports it and never guesses | an owner ruling, then a specification amendment |
| STOP-COPY | a task is about to bring in code from a DR prototype, the frozen generation, another repository, or a specification's example verbatim | the owner; the default answer is "write it here from the specification" |
| STOP-FROZEN | any change under `src/experimental/`, `script/experimental/`, `test/experimental/`, `docs/experimental/*.md`, `docs/RECEIPT-SCHEMA.md`, `docs/v2/SECURITY-ADVISORY-001.md`, or to `foundry.toml`; moving a published tag is never cleared | the owner |
| STOP-SIZE | a contract above 90 % of 24,576 runtime or 49,152 initcode after the first cuts SC §12 permits (`oracleCondition()` and `remainingToday()` off-chain, `getMarkets` returning ids only) | the owner: a split contract, a changed binding or a linked library is an owner decision |
| STOP-RPC | any task that reads a chain | the owner exports the named variable; implementers never open `.env` or `cache/`, never print a value, never choose a provider (Q91) |
| STOP-PAID | any paid account, subscription or credential: Data Streams, an RPC provider, Privy, hosting (Q95–Q98) | the owner; this plan needs none |
| STOP-FUND | funding the 46630 deployer with testnet gas | the owner; any real value on any chain is outside this plan |
| STOP-SIGN | every LIVE stage of DP5, including the uTUSD mint and the payment | the owner runs it from a keystore after the tx-handoff; only the owner signs or broadcasts |
| STOP-TAG | creating the source tag stage A requires; pushing any tag | the owner |
| STOP-MAINNET | any mainnet deployment or transaction, including no-value infrastructure | never inside this plan. CP3 records NO-GO unless Q132 is answered yes, Q9 confirmed, Q64, Q70 and Q71 READY and Q91 SELECTED; even then a separate plan is written. If mainnet gates fail, the submission is the testnet result plus the fork evidence, never represented as mainnet or oracle-live (Q120) |
| STOP-PUSH | pushing any commit (Q131, approval 1); triggering the Pages rebuild (approval 2); merging `unicaV4` into `main` (rec 76, after review); submitting source to an explorer or Sourcify (DP5 stage H publishes it); publishing the prototype, the evidence page, the video or the submission | the owner, each separately |
| STOP-LEDGER | any edit to `DECISIONS.md` | only by the owner; a needed decision is reported to the owner |

## 6. Commit sequence, in landing order

**Rules.** One idea per commit; a function and its test land as adjacent commits; the repository gate is green at
every commit. Identity is the project's local git configuration, confirmed before the first commit, never `--global`.
A multi-line message is written to a file in its own step, then committed with `git commit -F`. No message names a
tool or a model, and no commit carries a co-author trailer or a "generated with" line; the provenance check in the
repository's `CLAUDE.md` runs before every push. Lanes work in separate worktrees; the coordinator lands their
commits onto `unicaV4` one at a time in this order, never as a batch. Review fixes land as their own `fix(…)` commits
immediately after the row they fix. Nothing is pushed until STOP-PUSH is cleared; then commits go out one by one.
Row numbers are landing order, not identifiers; a cut (§8) removes its rows and renumbers nothing, and inserted rows
take a suffix (4a–4h, 9a, 55a) for the same reason.

| # | Commit subject | Task |
|---|---|---|
| 1 | docs(unica-v4): the decision ledger, as the owner confirmed it | G0 |
| 2 | docs(unica-v4): design review, Chainlink availability and mainnet capability evidence | G0 |
| 3 | docs(unica-v4): the contract specification | G0 |
| 4 | docs(unica-v4): the oracle and chain specification | G0 |
| 4a | docs(unica-v4): the upgradeability and hooks review | G0 |
| 4b | docs(unica-v4): the event schema | G0 |
| 4c | docs(unica-v4): the test matrix | G0 |
| 4d | docs(unica-v4): the threat model | G0 |
| 4e | docs(unica-v4): the deployment gates | G0 |
| 4f | docs(unica-v4): the UNICA v5 deferred scope | G0 |
| 4g | docs(unica-v4): the directory index | G0 |
| 4h | docs(unica-v4): Circle Arc research, read-only, outside the v4 specification | G0, only if the owner lands it with this set |
| 5 | docs(unica-v4): reconcile the two specifications under the owner's rulings | SR1 |
| 6 | docs(unica-v4): the implementation plan | G0 |
| 7 | test(gate): the frozen generation pinned by its reviewed post-tag diff and its bytecode | TS5a |
| 8 | test(gate): a UNICA v4 wording check with a planted self-test | TS5c |
| 9 | docs(unica-v4): the 46630 Uniswap v4 addresses, each from a committed record | CH1 |
| 9a | docs(unica-v4): the TSLA beacon fingerprint, read at a recorded block | CH4 |
| 10 | feat(config): the 46630 chain file, TSLA listed and NFLX unlisted | CH2 |
| 11 | feat(config): the 42161 chain file, present and disabled | CH2 |
| 12 | feat(script): a chain helper that trusts only the chain id the RPC reports | CH3 |
| 13 | test(script): the chain helper refuses every planted bad file | CH3 |
| 14 | feat(unica-v4): market types, errors and events | CT1 |
| 15 | feat(unica-v4): the opening price on the tick grid, never above the rate | CT1 |
| 16 | test(unica-v4): opening-price fuzz with an exact bound | CT1 |
| 17 | feat(unica-v4): the price-oracle interface | CT1 |
| 18 | test(unica-v4): a mock oracle adapter for tests only | OA1 |
| 19 | feat(unica-v4): the market registry: records, lifecycle, roles and reverse lookups | CT2 |
| 20 | test(unica-v4): every lifecycle transition, reverse lookup and registry event | CT2 |
| 21 | feat(unica-v4): per-market oracle policy and caps that can only tighten | CT2 |
| 22 | test(unica-v4): loosening a policy or a cap is refused | CT2 |
| 23 | build(gate): the size budget covers every UNICA v4 contract | TS5b |
| 24 | feat(unica-v4): the market hook and the executor it creates | CT3 |
| 25 | test(unica-v4): payer, merchant, replay, minimum-output and direct-swap refusals | CT3 |
| 26 | feat(unica-v4): the market factory, the only initialiser a market hook accepts | CT4 |
| 27 | test(unica-v4): factory refusals and address determinism | CT4 |
| 28 | feat(unica-v4): per-transaction, per-day and seed caps in payout-token units | CT5 |
| 29 | test(unica-v4): every cap at its boundary | CT5 |
| 30 | feat(unica-v4): receipt fee fields read from the pool in the same swap | CT7 |
| 31 | test(unica-v4): the receipt fee equals the pool's own swap fee in both orderings | CT7 |
| 32 | feat(unica-v4): settlement fails closed outside the oracle band | CT6 |
| 33 | test(unica-v4): every oracle refusal at both boundaries | CT6 |
| 34 | test(gate): mocks and test code stay out of src and scripts | TS5d |
| 35 | feat(unica-v4): the Chainlink push-feed adapter | OA2 |
| 36 | test(unica-v4): feed-adapter refusals against a stand-in aggregator | OA2 |
| 37 | feat(unica-v4): the Data Streams adapter, disabled | OA3 |
| 38 | test(unica-v4): Streams report replay, expiry and status refusals | OA3 |
| 39 | feat(unica-v4): the CRE adapter, simulation-only | OA4 |
| 40 | test(unica-v4): CRE forwarder and workflow refusals | OA4 |
| 41 | test(unica-v4): balance invariants that survive donations | TS1 |
| 42 | test(unica-v4): eighteen markets across decimals and orderings | TS2 |
| 43 | test(unica-v4): look-alike hook, cross-market executor and re-entry rows | TS3 |
| 44 | test(gate): the UNICA v4 mutation table, each mutant killed by its own row | TS4 |
| 45 | feat(script): the UNICA v4 deployment script | DP1 |
| 46 | feat(script): the 46630 TSLA market and settlement data | DP1 |
| 47 | test(script): onboarding a market touches data files only | DP1 |
| 48 | feat(script): the deployment wrapper, dry run by default | DP2 |
| 49 | test(script): the wrapper refuses every unsafe start | DP2 |
| 50 | feat(script): readback for each deployment stage | DP3 |
| 51 | test(script): readback refuses each planted mismatch | DP3 |
| 52 | feat(script): a manifest that records verification only when the explorer confirms it | DP4 |
| 53 | test(script): the manifest fails on each planted defect | DP4 |
| 54 | test(fork): a pinned 46630 fork | FK0 |
| 55 | test(fork): the frozen settlement reproduced, the currency1 path and the fingerprint | FK1a |
| 55a | test(fork): the rest of the declared 46630 set, compared by id, plus V1's separate NFLX configuration-only row | FK1b |
| 56 | test(fork): read the Arbitrum One feed descriptions at a pinned block | FK2 |
| 57 | docs(unica-v4): the Arbitrum One feed descriptions as evidence | FK2 |
| 58 | test(fork): the oracle band against real Chainlink feeds | FK3 |
| 59 | docs(unica-v4): fork oracle evidence, `ORACLE-FORK-42161.md` | FK3 |
| 60 | feat(prototype): fixtures from the frozen 46630 settlement | PR1 |
| 61 | feat(prototype): the landing screen | PR2 |
| 62 | feat(prototype): the sign-in and onboarding screen, planned | PR2 |
| 63 | feat(prototype): the merchant overview | PR2 |
| 64 | feat(prototype): create a payer-bound payment request | PR2 |
| 65 | feat(prototype): checkout and receipt | PR2 |
| 66 | test(prototype): no network call and no number outside the fixtures | PR3 |
| 67 | docs(unica-v4): the threat model mapped to the rows as landed | DC1 |
| 68 | docs(unica-v4): the UNICA v4 receipt schema | DC2 |
| 69 | docs(unica-v4): the runbook | DC3 |
| 70 | chore(deployments): 46630 stage A records | DP5 |
| 71 | chore(deployments): 46630 stage B records, TSLA proposed | DP5 |
| 72 | chore(deployments): 46630 stage C records, TSLA seeded and active | DP5 |
| 73 | chore(deployments): 46630 stage D records, one settlement | DP5 |
| 74 | chore(deployments): 46630 verification tiers and manifest | DP5 |
| 75 | docs(unica-v4): the 46630 rehearsal evidence | DP5 |
| 76 | docs: the UNICA v4 README section | DC4 |
| 77 | docs: disclose the tools used for UNICA v4 | DC5 |

Rows 70 to 75 exist only for the stages that ran; if the rehearsal stops early, row 75 records the stopping state
and the market's stored status, and no later stage is attempted.

## 7. Coordinator liveness rules

An implementer that stalls silently costs more than one that fails loudly. These rules keep every implementer observable and
every task small enough to redo.

1. **Bounded tasks.** One dispatch is one task ID from §4, with its output paths listed and nothing else writable.
   Wall budgets: a document 30 minutes, a contract or tool 60, a test suite 60, a fork suite 45, a review 45. A
   document stays within 500 lines. A task that needs more is split before dispatch, never extended mid-flight.
2. **Incremental writes.** A document is created with its title and first section in one call, and every further
   section is appended in its own call. Code lands the same way: storage and signatures first, then one function or
   one test group per edit. A killed implementer therefore leaves usable partial output, never an empty file.
3. **Heartbeat.** Each implementer's output grows, or it emits a progress line naming its current step, at least every 10
   minutes. A long build or test run announces itself before it starts and reports when it ends.
4. **Watchdog.** The coordinator polls every 5 minutes. No growth and no progress line for 15 minutes marks the task
   STALLED: the implementer is stopped, its partial output kept, and the task re-dispatched once with only the unfinished
   part. A second stall, or any task reaching twice its budget, stops it for good: the task moves to the cut list and
   the owner is told which rows of §6 it removes. The coordinator never waits on a stalled task; it dispatches the
   next independent one.
5. **Honest returns.** Every implementer returns structured output with mandatory fields: the paths written, counts (run,
   passed, failed, skipped), sizes where measured, `blockers` and `openIssues`, each an explicit list, empty when empty.
   A return without counts is treated as a failure. "It passed" is re-run by the coordinator, or by an independent reviewer
   that did not write the code, before the commit lands.
6. **Concurrency.** At most four writing implementers at once, one writer per file, each in its own worktree. Two tasks that
   edit the same contract (CT6 and CT7 both edit the hook) queue, never merge by hand.
7. **Scope of staging.** A commit stages its own listed paths explicitly, never a directory sweep; unrelated
   working-tree changes (the working tree held unrelated modified and untracked files when this plan was written) are
   never swept in.
8. **Never, from any implementer.** Sign, broadcast, fund, tag, push, merge or publish; open `.env` or `cache/`; print an
   environment value; edit `DECISIONS.md` or a frozen path; copy code in; weaken a gate row to make it pass. Each of
   these is a STOP (§5), reported, and the task ends there.
9. **Resumable by name.** Task IDs are the resume keys. The coordinator keeps its task-state ledger outside the
   repository and never commits it; everything a restarted coordinator needs is the landed commits, this plan, and
   the §6 row a task maps to. After any context loss it re-reads this plan and the log of landed commits before
   dispatching.
10. **The clock.** The coordinator reads UTC at every checkpoint and applies the slip rule (§2) there, not in
    between. The freeze at Sun 04:00 is absolute: an implementer still running then is stopped, and its partial work stays
    uncommitted.

## 8. Cut order

A cut removes a whole task or a named part of one, together with every claim it would have backed. Nothing is ever
landed with a weaker acceptance test to save time. Cuts are applied first to last; the owner may reorder them at G0
(in particular, swap cuts 9 and 10). Rec 121, "the three-scope cut line", is accepted in the ledger by number only;
its three scopes are recorded in no document in this directory and cannot be recovered from the design record. This
order does not claim to implement it: the owner states the scopes at G0, and this section and TM §13 are then mapped
onto them (§9 item 13).

**Never cut.** Rows: `TEST-MATRIX.md` §13's never-drop list, which this plan cites rather than restates, plus the rows
it does not yet carry, which apply here until TM §13 absorbs them (§9 item 3): X8; H5, H5b, H5c; SO O11 to O17, the
fail-closed oracle rows; fork row V8 (`DECISIONS.md` "Specification choices" — V8 is never cut, so the earlier cut
that removed it is withdrawn below, and `TEST-MATRIX.md` §14 item 11 is marked applied). TM §13's V1 entry is
resolved the same way: V1 backs only the "configuration-only onboarding proven on a fork" claim, is never dropped
whenever that claim is made, and no longer waits on an owner ruling. Beyond rows: the 12-hour reserve; every STOP;
every gate row (the repository gate, TS5a to TS5d, the size budget, the provenance and secret checks); the mutation
table for every guard that ships; the zero-skip rule: when fork rows cannot run, the claim they back is dropped, never
the rule. This plan owns the task-level order below; its cuts 4 and 5 are TM §13's cuts 2 and 3, in order; TM §13's
cut 1 (V8) has no corresponding row here, since V8 is never cut.

**Must-ship floor (proposed; the owner confirms at G0).** CH1 to CH3; CT1 to CT7 with every never-cut row (CT6 and CT7
are in it because O11–O17 and H12a–H12c are never cut); TS4 for every guard that ships; TS5a to TS5d; DP1 to DP4 run
offline against the disposable chain. That is what cut 10 submits, beside the frozen settlement labelled as the
frozen generation, never as UNICA v4. **If a critical-path task stalls twice or reaches twice its budget** (§7 rule 4),
cut 10 applies at once: the submission is whatever of the floor has landed plus the frozen settlement, and the owner
re-scopes the failed task or drops it with every claim it would back. **What the cuts buy.** Cuts 1 to 9 remove work
off the critical path: they free writer slots (§7 rule 6), which the path can use only where a task splits by file (a
contract's test rows beside the contract; DP3 and DP4 beside DP2), and they shorten nothing on it. Cut 9a is the one
cut that shortens the path; when the delay sits on the path itself, the coordinator proposes it out of order.

| Cut | What goes | Rows of §6 removed | What the public wording becomes |
|---|---|---|---|
| 1 | fork row OF9, the read-only 4663 row | part of 58 | the Robinhood TSLA feed facts stay as recorded in MCP and CA, not re-proven |
| 2 | ChainlinkCREAdapter (OA4) | 39, 40 | the CRE adapter is planned; no source ships |
| 3 | ChainlinkStreamsAdapter (OA3) | 37, 38 | the Streams adapter is planned; no source ships |
| 4 | invariant breadth: keep I1, I1b and I3b; drop I4 and the I7 extension | part of 41 | unchanged; the threat model marks the dropped invariants open |
| 5 | the decimals matrix reduced to the six {6, 18} combinations, both orderings kept (DR §2's own cut) | part of 42 | "tested at 6 and 18 decimals", never "any decimals" |
| 6 | the runbook reduced to pause, unpause and retire | part of 69 | unchanged |
| 7 | prototype screens 2 and 4 become static "planned" cards | 62, 64 reduced | the prototype shows three working screens and two planned ones |
| 8 | Blockscout verification; Sourcify stays | part of 74 | each contract's tier exactly as recorded; "not verified" wherever neither verifier confirmed it |
| 9 | the oracle fork proof (FK2, FK3) | 56–59 | Chainlink stays "planned" everywhere; the oracle logic is described only as fail-closed checks proven in unit tests against a test adapter, never as a Chainlink claim; the submission says the fork oracle evidence of Q120 does not exist |
| 9a | stage H of DP5 (source verification), the one cut that shortens the critical path | 74 reduced to the manifest | every contract "not verified" in the manifest; no "verified" wording anywhere; rec 103 stays unmet for the rehearsal. The same holds if Q131's go is withheld at CP4 |
| 10 | the live 46630 rehearsal (DP5) | 70–75 | no UNICA v4 contract is deployed anywhere; the submission shows the frozen experimental settlement, labelled as such and never called UNICA v4, beside UNICA v4's local and fork evidence. If DP5 had started, it stops after the last stage whose readback passed; a market is never activated before stage C's readback; the manifest records the stopping state |

Not in this plan at all, so never "cut": the feed-cadence measurement of SO §11 (needed only before a mainnet crypto
market); any mainnet work (STOP-MAINNET); ENSv2 on Sepolia and The Graph for UNICA v4, owner-deferred pending
confirmation (§9 item 14): rec 46 (ENS names are optional metadata) has no UNICA v4 attachment point in any
specification, and Q90's 46630 history path (ES §10.3: a bounded event indexer or a clearly limited beta history view,
since The Graph on 46630 is UNKNOWN) and ES §10.2's subgraph are designed but have no task, so neither is claimed; switching the prototype's fixtures to a UNICA v4 settlement, which waits on a frozen event schema and manifest
(Q127) and a separate owner decision.

## 9. Open issues

Owner decisions are marked; the rest are tasks this plan cannot close by itself.

1. **Owner:** the eighteen SR1 rows (§3), five of them behaviour. No contract task starts before they are ruled.
2. **Owner:** how the factory itself is deployed: DG §11 choice 1 (CREATE2 through the deterministic deployer, DR B3)
   or plain CREATE. DP1 implements whichever is chosen.
3. **Owner confirms:** the deployment, test and event specifications exist (DG, TM, ES) and win on stage, row and
   event content; this plan keeps order, time and STOPs, and its lines cite them (TS5a → TM G1 and G2; FK1 → TM §12's
   declared set; DP5 → DG §4 to §9). SC §14's DR B1–B9, C1, C2, C8–C17, C19 and C20 land there (DG §11; TM; THREAT-MODEL
   §8). TM §13 should absorb X8, H5, H5b, H5c and O11–O17 so that one never-drop list exists (§8).
4. **Owner:** the latest useful time for Q131's first approval (push) is CP4, Sat 22:00, because stage H publishes the
   source and the submission must link the public commits. Without it the public repository shows none of this work,
   and stage H does not run.
5. **Owner:** prototype screen 4. The UX direction's first prototype lists "create payment link"; Q128 moves public
   payment links to UNICA v5, so the screen is re-scoped to a payer-bound payment request. Confirm the re-scope.
6. **Owner:** swapping cuts 9 and 10 (§8) if the fork oracle proof matters more to the submission than the live
   rehearsal. Q120 names both.
7. Stage A is the first transaction on 46630 above 16,870 bytes of calldata (DR B5); the factory creation is about 37
   to 41 KB (ESTIMATE, SC §12). The fallback is designed nowhere yet, and SC §12's first cuts cannot close the gap. A
   refusal at stage A consumes no nonce and applies cut 10 unless the two-code-store fallback was built and reviewed
   first (DG §4). **Owner:** the DP0 size probe before CP3, the fallback designed now, or neither, accepting the risk.
8. The chain helper refuses a disabled file (SO §12.2), and SO §15 says `enabled: false` stops scripts, not reads. FK2
   and FK3 therefore read 42161 through fork tests, never through `chain.sh`; RV2 confirms no script path reaches a
   disabled chain.
9. The look-alike NFLX addresses (DR C8) exist only on the explorer. Until someone records them in a committed fixture
   with the explorer as source, that part of FK1 reports not run.
10. The NFLX configuration-only proof (DP1) needs a rate. It is a test parameter in a fixture under `test/unica-v4/`,
    labelled "test fixture — not an approved demonstration rate," never written under `script/unica-v4/markets/`, and
    never a demonstration rate in the sense of Q110 (`DECISIONS.md` "Specification choices" resolves this: V1 uses
    that fixture and backs only the configuration-only onboarding claim, never the TSLA rehearsal's declared set).
11. The 46630 deployer's testnet gas budget is the spend ceiling DP2 prints after simulation; the owner funds it
    (STOP-FUND). No figure is given here because none is measured.
12. Every size in this plan is SC §12's ESTIMATE until CT2 to CT7 measure; every prototype figure cited from DR is
    feasibility evidence measured outside this repository.
13. **Owner:** state rec 121's three scopes ("the three-scope cut line"); the ledger records the number only. §8 and
    TM §13 are then mapped onto them.
14. **Owner:** confirm the deferral of ENSv2 and The Graph for UNICA v4 (§8 "Not in this plan"), or schedule a task
    for rec 46's ENS metadata and for Q90's 46630 history path (ES §10.3).
15. **Owner, with TM's author:** whether a mutant's MISATTRIBUTED check may use a reduced-fuzz full suite, with one
    full 10,000-run pass before the tag. Until ruled, every mutant uses the full suite (TM §10); a reduced run is never
    the report G4 reads.
16. **Owner:** whether one line may accept every recommended default on the ruling sheet (§3). Until then each
    default counts only when the owner accepts it.
