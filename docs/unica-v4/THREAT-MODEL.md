# UNICA v4 — threat model

Draft for owner review, not committed, authorising nothing (Q131). "UNICA v4" is the UNICA release; "Uniswap v4" is
the AMM. The frozen experimental deployment (tag `experimental-46630-settled`) is **not** UNICA v4, is never modified,
and appears here only as a neighbour on the same chain.

Binding sources, in order: `docs/unica-v4/DECISIONS.md` (the ledger; where anything here disagrees, the ledger wins),
then `docs/unica-v4/SPEC-CONTRACTS.md` (cited **SC §n**) and `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (**SO §n**).
This file adds no mechanism of its own: every mitigation below is a section of one of those two specifications. The
ten-point register of specification disagreements (K1–K10, formerly §10) is reconciled by the ledger's Specification
choices S1–S8 and by the oracle interface, error-catalogue, event and route-binding choices threaded through §3–§9;
§10 records the resolution and the few points that remain open without weakening any mitigation. Evidence:
`docs/unica-v4/evidence/DESIGN-REVIEW.md` (**DR**; its 46 critique findings cited A1–A16, B1–B10, C1–C20, as SC does),
`docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (**CA §n**), `docs/unica-v4/evidence/MAINNET-CAPABILITY-PROBE.md`
(**MCP**), and `docs/v2/SECURITY-ADVISORY-001.md` (**ADV-001**).

Faucet stock tokens and uTUSD have no real-world value; a faucet TSLA token is not a Tesla share; an opening rate is a
demonstration rate the admin sets. Chainlink is **planned**: no deployed UNICA v4 contract reads a Chainlink price.
After SO §15's fork rows pass with zero skips, the only permitted wording is "Chainlink integration demonstrated on a
fork", linked to its evidence (Q125). This document is not an audit, and it does not claim completeness beyond the
threats it lists.

## 1. Scope, and how to read the tables

**Modelled.** `UnicaMarketRegistry`, `UnicaMarketFactory`, `UnicaMarketHook` and `UnicaMarketExecutor` (one hook and
one executor per market), `IUnicaPriceOracle` and its three Chainlink adapters, `MockOracleAdapter` (tests only); the
committed scripts under `script/unica-v4/` (the chain helper `chain.sh`, the deploy wrapper, readback, manifest and
`feed-cadence.sh`); `config/chains/<chainId>.json`; `deployments/unica-v4/<chainId>.json`; and the consumers that read
them. Two deployment contexts:

- **46630 rehearsal**, the only enabled chain: TSLA only, registry `requireOracle = false`, the market flagged
  `demonstrationOnly` on-chain, ADMIN the deployer EOA, every token without real-world value. NFLX is proven
  configuration-only in local and fork tests, not deployed (Q110).
- **Mainnet**, designed and not authorised: `requireOracle = true`, ADMIN a Safe, a capped beta (Q5–Q7: $10 per
  transaction and $25 per day, both enforced on-chain per market; the $100 total at risk across markets sharing a
  payout token is a deployment-script and manifest refusal, never an on-chain invariant, S5). Q132 is unanswered, so
  no mainnet deployment exists, and every mainnet mitigation that depends on an unready ledger item is marked BLOCKED.

**Not modelled.** UNICA v5 (the dashboard) and public payment links (moved to v5 by Q128; §7.7 records why); Privy,
which touches no contract; refunds, subscriptions and partial payments (Q41–43); webhooks, API, database (Q87–89); any
UNICA fee (Q55–61); upgradeability, which does not exist (U1–U6); real tokenized equity (Q16, Q20, Q23).

**Row IDs.**

| Prefix | Meaning |
| --- | --- |
| `SC:` | a test row named in SPEC-CONTRACTS (for example `SC:S1`, `SC:X9a`, `SC:F18`; SC's band row "O9" is `SC:O26`) |
| `SO:` | a row of SO §15 (`SO:O1`–`SO:O25`, and the oracle fork rows `SO:OF1`–`SO:OF9`: OF1–OF8 on the 42161 fork, OF9 the read-only 4663 row) |
| `DR:` | a row of the reconciled design's test plan as recorded and critiqued in DR §3 (DR's forged-callback X9 is `DR:X12`) |
| `TM-n` | a row this document proposes; `docs/unica-v4/TEST-MATRIX.md` §2 adopts each under its own ID or drops it with a written reason |

The ID after every prefix is TEST-MATRIX's final ID, so its G8 check resolves it; the prefix records only the row's
origin. TEST-MATRIX owns every row id; oracle fork rows are `OF1`–`OF9` everywhere and `F` is the factory namespace
only, with no alias written in this file (K8, §10, reconciled).

**Status of each threat.** SPECIFIED: the mitigation and its row are both named in a specification. PROPOSED: the
mitigation is specified, the row is proposed here. BLOCKED: the mitigation depends on an open ledger item (§2).
RESIDUAL: accepted, not prevented, and stated so that no surface implies otherwise. CONFLICT: the two specifications
disagree on the mitigation; none of the ten points that once carried this status remain in conflict (§10).

## 2. Blockers

Open ledger items and UNCONFIRMED evidence that remove or weaken a mitigation below. This file resolves none of them.
None blocks writing, testing or fork-rehearsing; each blocks the deployment or claim named.

| Item | State | Mitigation it removes, and what it blocks |
| --- | --- | --- |
| Q132 no-value mainnet infrastructure | **OPEN, unanswered** | Every mainnet row. No registry with `requireOracle = true` is deployed anywhere, so no oracle mitigation below is live on any chain. |
| Q9 chain | **OPEN** (Arbitrum One recommended, MCP) | `config/chains/42161.json` stays `enabled: false`; the chain helper refuses it, so no mainnet adapter, sequencer check or readback exists. |
| Q64 Safe | **NOT READY** | The mainnet mitigation for ADMIN-key compromise (T-KEY-1). No mainnet market may leave SEEDED and no value moves. |
| Q70 pauser | **NOT READY** | The mainnet fast-pause mitigation (T-KEY-2, U7, U8, Q69). The pause-only rule is built in regardless. |
| Q71 launch gate | **NOT READY** | Any mainnet launch under the accepted gates (rec 72 to 75). |
| Q91 RPC | **NOT SELECTED** | Mainnet readback and monitoring (Q92): the helper refuses while the named variable is unset. |
| Q95 accounts and payment | **NOT PROVIDED** | Any Data Streams report, so `ChainlinkStreamsAdapter` has nothing to verify (T-OR-10, T-OR-11). |
| Q16, Q20, Q23 | no issuer; **NO CONFIRMED REVIEW**; no licensed equity data | Every equity oracle route; the helper refuses equity routes (T-OR-15, T-OR-16). Equities are future support (rec 15, 21). |
| Q25 against the 1755 s ETH/USD heartbeat | ledger "Semantic limit"; minimum availability **OPEN** | A mainnet crypto market on that route at useful availability (T-OR-1). |
| Q110 NFLX rate | **NOT SELECTED** | An NFLX market on 46630; NFLX stays configuration-only. |
| Q110 merchant control | **UNKNOWN/NOT PROVIDED** | Describing the rehearsal merchant as owner-controlled; a delivery there is not evidence the owner received it. |
| Q108 merchant terms | **NOT READY** | A public merchant beta; the order-creator allowlist holds only founder-controlled or invited creators (Q35). |
| Q131 publication | **NO AUTHORIZATION** | Pushing or publishing this file or anything built from it. |
| Chainlink on 46630 | no Data Feeds, no sequencer feed (CA §2a); Streams verification **UNCONFIRMED** (CA §3a); CRE hosted writes **UNCONFIRMED** (CA §4a) | Any oracle-enabled market on 46630; the rehearsal is demonstration-only (Q30). |
| Sequencer grace period | owner value **OPEN** (3600 s proposed, SO §16 item 4) | The value of `GRACE_PERIOD` in T-OR-14. |
| Robinhood token raw-balance relation | **unproven** (A7, SO §16 item 8) | Any route pricing a Robinhood token from its feed (T-OR-15), and the raw-balance assumption in T-KEY-6. |
| 46630 Uniswap v4 addresses | `null` in `config/chains/46630.json` (SO §12.1, §16 item 1) | Every 46630 stage; the helper refuses until a reviewed commit records them in evidence with a source. |
| B15 frozen-diff hash acceptance | **NOT ACCEPTED** (owner) | G1's pinned SHA-256 of the post-tag frozen diff in T-DEP-4; blocks only that check going live, never writing, testing or fork-rehearsing. |
| Seed-step listing denial of service | **OPEN**: no specification mitigates it; SC must choose a change (T-SET-20) | A market reaching SEEDED while a stranger objects, on 46630 and on mainnet; writing TM-17. |

## 3. Assets

What an attacker would want, and what UNICA v4 must keep true.

| # | Asset | Held where | Why it matters |
| --- | --- | --- | --- |
| AS1 | The payer's input tokens and allowance | the payer's wallet; pulled only inside `pay` (SC §9.1) | Only the bound payer's own `amountIn`, for one order, may ever leave that wallet. |
| AS2 | The merchant's right to the delivery | `order.recipient`, written once at `createOrder` | A settlement must pay the named recipient, at least `minOut`, or revert whole. |
| AS3 | The seed | the LP's position in the market pool (founder-controlled Safe on mainnet, $100 maximum, Q14) | It is what payers trade against; draining it at a bad rate is a loss to the LP. |
| AS4 | Market identity and "official" status | registry records and the three reverse maps (SC §3, §6) | Consumers decide what is a UNICA market from these alone. |
| AS5 | Receipt integrity | `SettlementReceipt` from the hook and `Settled` from the executor (SC §11) | Merchants, indexers and the evidence page rely on them as proof of payment. |
| AS6 | Oracle policy integrity | `_policy[id]` in the registry; the adapter and feed id also committed inside the market's own `marketId` (SC §6, §10; SO §3, §7.1; S8) | A loosened, re-pointed or unbound policy would admit settlements at a bad rate. |
| AS7 | Caps | `_caps[id]` and `payoutUsedOnDay` (SC §9.2) | They bound the value any single fault can move. |
| AS8 | ADMIN, PAUSER and deployer keys | a Safe on mainnet (NOT READY, Q64); the deployer EOA on 46630 | They control listing and liveness, never funds (SC §4). |
| AS9 | Chain configuration, manifest and evidence | `config/chains/`, `deployments/unica-v4/`, `docs/unica-v4/evidence/` | Every script and every public claim is derived from them. |
| AS10 | Secrets | RPC URLs (by variable name only), keystores | A keyed RPC URL or key in a public repository is permanent. |
| AS11 | The frozen generation | `src/experimental/*`, its tag, its live 46630 contracts | Its settlement is the evidence UNICA v4 reproduces; it must stay byte-identical. |
| AS12 | Truth of public claims | docs, README, script output, the prototype | A claim the chain cannot back spends trust (repository rule "Truth in what ships"). |

## 4. Actors

Roles are fixed across the specification set (SC §4). "Trusted for" is the most the design relies on each actor for;
everything else about that actor is treated as hostile.

| Actor | Can | Trusted for | Treated as hostile in |
| --- | --- | --- | --- |
| Payer | `pay(orderId)` for orders naming it | its own approval | T-SET-2, T-SET-13 |
| Merchant / recipient | receive | nothing (a recipient never calls UNICA v4) | T-SET-3 |
| Order creator (allowlisted; ADMIN implicitly) | `createOrder` on an ACTIVE market | naming a real payer and recipient | T-SET-1, T-KEY-1 |
| Stranger | anything permissionless: pool initialisation, liquidity, token transfers, deploying look-alikes, Streams `submitReport` | nothing | all of §7.1, T-SET-1, T-SET-12 |
| ADMIN | listing, lifecycle, allowlist, pauser, tightening, admin transfer (SC §4) | not moving funds is enforced by construction, not trusted | T-KEY-1 |
| Pending admin | `acceptAdmin` only | nothing before accepting | T-KEY-3 |
| PAUSER | `registry.pause(id)` only | nothing beyond pausing | T-KEY-2 |
| Seed LP | its own PositionManager position | providing the designed seed before `markSeeded` | T-SET-14, T-SET-15 |
| Third-party LP | add and remove liquidity freely (no liquidity flags, SC §5) | nothing | T-SET-6, T-SET-14 |
| Uniswap v4 PoolManager (code) | accounting, callbacks | correct execution of the vendored core | boundary B2 |
| PoolManager owner / protocol-fee controller | set a protocol fee at any time (A9) | nothing; outside UNICA v4 | T-KEY-5 |
| Stock-token issuer / beacon owner | upgrade the implementation, pause, change `uiMultiplier` (A7, A8) | nothing; outside UNICA v4 | T-KEY-6, T-LC-5 |
| Payout-token minter | mint (uTUSD: the deployer; mainnet: Circle USDC, Q13) | nothing | T-KEY-7 |
| Oracle sources (feed proxies, Streams DON and VerifierProxy, CRE forwarder) | publish or deliver prices | an authenticated value at its own timestamp, re-validated by the adapter and the hook | §7.4 |
| Sequencer operator | halt and restart the L2 | nothing | T-OR-14 |
| Consumers (indexer, The Graph, dashboard, evidence page) | read logs and state | applying the emitter and registry checks of SC §3 | T-ID-1, T-ID-2 |
| Relayer or mempool observer | read pending calldata, front-run | nothing | T-SET-6, §7.7 |
| Deployer EOA and CI | send transactions (owner-run); run the gate with no local state | following the committed scripts | §7.6 |

## 5. Trust boundaries

```
 payer wallet ──approve, pay(orderId)──▶ UnicaMarketExecutor ──unlock──▶ Uniswap v4 PoolManager
      B1                                     │   B2 (issuer token code runs      │ callbacks
                                             │       while the lock is open)    ▼
 order creator ──createOrder──▶ (allowlist)  │                          UnicaMarketHook ──STATICCALL──▶ adapter ──▶ Chainlink
                                             │                                     B3                    B4
 ADMIN / PAUSER ──B5──▶ UnicaMarketRegistry ◀┴── UnicaMarketFactory (only initialiser, only registrar)
 consumers ◀──B6── logs and views (authenticated by emitter and registry, never by token pair or event field)
 scripts ──B7──▶ chain (chain helper: RPC-reported chain id, enabled config, variable-name RPC)
 UNICA v4 ──B8── frozen generation (never imported, never modified)     UNICA v4 ──B9── issuers, PoolManager owner
```

| # | Boundary | What crosses it | What the inner side assumes, and the check that enforces it |
| --- | --- | --- | --- |
| B1 | payer → executor | an ERC-20 approval, then `pay(orderId)` with no other data | Terms come only from storage written at `createOrder`; the pull is `transferFrom(msg.sender, …)` for exactly `amountIn`, and only by `order.payer` (SC §9.1). |
| B2 | executor → PoolManager, and back | the lock, the swap, `sync`/`settle`/`take`; issuer-controlled code runs inside the asset's `transfer` while the lock is open (A6) | Credit `== amountIn`, exactly one receipt, snapshot-relative residuals, the reentrancy latch (SC §9.1, §9.3). |
| B3 | hook → adapter | `IUnicaOracleRoute(adapter).feedIdFor(asset, payout)` checked against `policy.feedId`, then `IUnicaPriceOracle(adapter).latestPrice(asset, payout)`, both by STATICCALL | The adapter cannot change state or a fee mid-swap (A14); the feed id is re-checked on-chain before every price read (S8), and every value is re-checked by the hook (SC §8.2, SO §4.1). |
| B4 | adapter → Chainlink | feed rounds, verified Streams reports, CRE reports | Pinned proxy, description and decimals; sequencer; issuer hold; DON signature; forwarder; strictly newer timestamps (SO §7–§9). |
| B5 | ADMIN / PAUSER → registry and factory | lifecycle, allowlist, tightening | No function moves, pulls or approves tokens; identity and pricing fields are write-once; policy and caps are tighten-only (SC §4, §6). |
| B6 | chain → consumers | events and views | Official is decided by the registry pinned in `deployments/unica-v4/<chainId>.json` and its three reverse maps; a receipt is accepted only from `getMarket(id).hook`, `Settled` only from `getMarket(id).executor` (SC §3). |
| B7 | scripts → chain | transactions the owner signs | `chain.sh`: enabled file, RPC-reported chain id, variable-name RPC never printed, no `null` address, no MOCK adapter (SO §12.2). |
| B8 | UNICA v4 → frozen generation | nothing | UNICA v4 sources never import `src/experimental/*`; tests import frozen fixtures read-only (DR risk 14). |
| B9 | UNICA v4 → issuers, PoolManager owner, payout minter | their unilateral powers | Nothing inside UNICA v4 can stop them; every such change must fail closed in `pay` (T-KEY-5 to T-KEY-7). |

## 6. Standing security properties

Each property is the conjunction of several rows in §7; each names the rows that would go red if it broke.

| # | Property | Source | Rows |
| --- | --- | --- | --- |
| P1 | ADMIN can never move, pull, approve or freeze a user's tokens, nor redirect a settlement. The registry and factory have no token calls; the executor pulls only from `msg.sender` inside `pay`; `take` pays `order.recipient` only; no sweep. | SC §4 | DR:I4, TM-13 |
| P2 | Every refusal reverts the whole settlement with a named error: the payer keeps the input, the merchant receives nothing, no receipt survives, and nothing falls back to a demonstration rate. | SC §8.2, SO §4 | SO:O11–O17, SC:X9a–X9d |
| P3 | No UNICA v4 call changes the executor's or hook's balance of either token (I1 restated). A donation can; donated tokens are unrecoverable and never block the next payment. | SC §9.3, A15, C3 | DR:I1, DR:I1b |
| P4 | The hook never calls `PoolManager.initialize`, `swap`, `unlock`, `modifyLiquidity` or `donate`, because the PoolManager skips a hook's own callbacks when the hook is the caller. | SC §8.1, A4 | SC:H14 |
| P5 | Exactly one pool names a given UNICA v4 hook, initialised by the factory only. Hookless and foreign-hook pools on the same pair are always possible and are not UNICA markets. | SC §3, §8.1, A1 | SC:V5, DR:H3, DR:H4 |
| P6 | Only a market's own executor swaps in its pool. | SC §8.1 | SC:H5, SC:H5b, SC:H5c |
| P7 | Every order is payer-bound: it names a non-zero payer, and only that payer can pay it. | SC §9.1, Q111, Q128 | SC:X2, TM-16 |
| P8 | Oracle policy and caps are tighten-only on a live market; a new adapter, feed, rate, or any loosening needs RETIRE and a new version with a new `marketId`, since `marketId` itself commits to `policy.adapter` and `policy.feedId` (S8). | SC §6, SO §3, U5, S3, S8 | SO:O7–O10, SC:K1–K4, SC:K7, TM-2 |
| P9 | RETIRED is terminal: a retired market's executor refuses every call forever, and its records stay readable. | SC §5, Q112 | SC:R4, TM-2 |
| P10 | Contracts carry no chain constants; scripts refuse any chain without an enabled configuration, and identify the chain by the id the RPC reports. | SO §12, ledger "Chain-generic" | SO §12.2 CI planted files, DR:V10 |

## 7. Threats, mitigations and the rows that prove them

Every negative row states the attack's precondition, pairs with a passing control in the same test, and names the
inner selector and its emitter; a bare `vm.expectRevert()` never counts (C5, SO §15). Every guard has a mutant killed
by its own named row, with 0 misattributed, before any live stage (C4, SC §9.3).

### 7.1 Market identity, look-alikes and official status

| ID | Threat | Mitigation (spec) | Test rows | Status |
| --- | --- | --- | --- | --- |
| T-ID-1 | **Hookless or foreign-hook pools on the same pair (A1).** Anyone can initialise TSLA/uTUSD with `hooks = address(0)` or any other hook, at any static fee and price; the still-live frozen hook admits the pair at every fee tier. A reader that finds pools by token pair sees them and their prices. | Not preventable, and never denied. What is impossible is a second pool naming a UNICA v4 hook (`beforeInitialize`: `sender == FACTORY`, `key.toId() == POOL_ID`). Hookless and foreign-hook pools on the same pair are always possible and are not UNICA markets. Consumers resolve pools only through `getMarket(id).poolId` or `marketIdOfPool(poolId) != 0`, never by token pair; no UNICA contract reads any pool as a price source (SC §3, §8.1, §13). | SC:V5 (fork: a hookless TSLA/uTUSD pool initialisation must SUCCEED, then `marketIdOfPool(thatId) == 0`); DR:H4 (a sibling key naming the UNICA hook reverts `NotMarketFactory`) | RESIDUAL, pinned |
| T-ID-2 | **Spoofed receipts from a look-alike hook (C6).** The same hook source, deployed through an attacker's own factory with the official `marketId` in its arguments, opens its own pool and emits `SettlementReceipt`s carrying the official id. Through the public CREATE2 deployer instead, its `FACTORY` can never call `initialize`, so its pool never opens. | Emitter authentication: a consumer accepts a receipt only when `log.address == getMarket(marketId).hook`, and `Settled` only from `getMarket(id).executor`; the `marketId` inside an event is never enough. All three reverse lookups are zero for any look-alike (SC §3). On an oracle-enabled market, `marketId` also commits to `policy.adapter` and `policy.feedId` (S8), so a look-alike cannot forge a genuine id without controlling the real registry's `register` call. | SC:S1 (look-alike settles one order; `marketIdOfHook`, `marketIdOfExecutor`, `marketIdOfPool` all zero for it; emitter check fails for the fake and passes for the real; with the official registry as its argument, the fake executor's `createOrder` reverts `NotOrderCreator` for a non-allowlisted attacker); TM-1 (any indexer, subgraph or dashboard read layer, when built, rejects a fixture receipt from a fake emitter carrying the official id) | SPECIFIED on-chain; PROPOSED for read layers |
| T-ID-3 | **Look-alike tokens (C8).** At least five tokens named "NFLX Test Stock" exist on 46630 (scouted, C8); TSLA and NFLX sit behind one beacon, so a beacon check cannot tell them apart. | Identity is the token **address**; names and symbols are never stored, keyed or trusted, and a different address gives a different `marketId` (SC §3). Only ADMIN creates markets, from a reviewed, committed `config/chains/<chainId>.json` whose every address names its evidence source (SO §12.1). The pre-flight prints name and symbol labelled UNTRUSTED; the beacon check only screens out non-faucet tokens, and the address pin is the defence. | DR:V3 as corrected by C8 (the real look-alike addresses committed as a fixture, each refused by the address pin; control: the pinned NFLX address is accepted); SO §12.2 CI planted files (`null` address, bad `source` prefix) | SPECIFIED |
| T-ID-4 | **Early salt publication (A5).** Salts are committed before the hook exists, so anyone can call `initialize` with a key naming the predicted address. | `initialize` naming a still-empty address reverts `InvalidHookResponse` (an empty account returns no selector, A5); after creation, a stranger reverts `NotMarketFactory` (SC §7). | SC:F18 | SPECIFIED |
| T-ID-5 | **A pool initialised by a non-factory, with a sibling key, or at a wrong price (A2, A3, DR decision 6).** | `beforeInitialize` admits only the factory and only `POOL_ID`; the flag set is enforced three times (mining loop, factory pre-check, BaseHook constructor), `isValidHookAddress` being only a consistency check; the factory initialises at the recorded `initSqrtPriceX96` and checks the returned tick (`OpeningTickMismatch`). Readback asserts the `Initialize` log sits in the `initializeMarket` transaction whose `to` is the factory, and `slot0.sqrtPriceX96 == initSqrtPriceX96` (SC §7, §8.1, §14). | DR:H1, DR:H3, DR:H4, DR:F5 (sabotage: without the pre-check the error becomes `HookDeployFailed`), DR:F12; per-stage readback rows (C12) | SPECIFIED |
| T-ID-6 | **A predatory fee or tick spacing listed as official (A12, A13).** A fee near 100% turns input into fees; spacing 1 makes an oversized order walk 2,621 bitmap words before `PartialFill`. | `previewMarket` admits only (500, 10), (3000, 60), (10000, 200), else `FeeTierUnsupported`; every market configuration file names `fee` and `tickSpacing` explicitly, with no default and no assumed 0.3% tier; the manifest records both per market, and readback asserts `getMarket(id).fee`, `getMarket(id).tickSpacing` and the deployed `PoolKey` equal the configuration (SC §7; S1). | DR:F9 with SC's error name; G20 (a market file or manifest entry missing either value, or naming any other pair, is refused by `manifest.test.sh`); optional gas row for an oversized order at spacing 10 (A13) | SPECIFIED |
| T-ID-7 | **A re-used `marketId` revives an orphaned executor after RETIRED** (the hazard behind DR §2.2 decision 1). | `version` is inside the `marketId`; a new version needs `liveMarketOf == 0` (cleared only by `retire`) and `version == latestVersion + 1`; the old executor reads RETIRED forever and refuses every call (SC §3, §5; Q112 supersedes decision 1). | SC:R4 (all 49 status pairs); TM-2 (retire v1, create v2: new id, hook, executor and pool; v1 `createOrder` and `pay` revert `MarketNotActive`; v1 records still paged by `getMarkets`; a v3 while v2 is live reverts `LiveMarketExists`) | PROPOSED |
| T-ID-8 | **Reverse maps missing or overwritten (C7)**, breaking the authentication primitive of T-ID-2. | Written once, by `register` only (SC §6). | SC:R9, SC:R10, DR:I7 extended to the three maps | SPECIFIED |
| T-ID-9 | **A fake registry, a stale manifest, or frozen addresses presented as UNICA v4.** | Official means the registry pinned in `deployments/unica-v4/<chainId>.json` (SC §3); the manifest writes "verified" only after a read-only explorer query returns verified, and refuses frozen addresses under a UNICA v4 key (C12). The UNICA v4 receipt signature differs from the frozen one, so its topic0 differs and neither decoder can misread the other (SC §11). | the C12 manifest test (deployment specification); topic0 pin (SC §11); the C17 claims check flags a frozen address in a UNICA v4 context | PROPOSED |

### 7.2 Orders and settlement

| ID | Threat | Mitigation (spec) | Test rows (mutant) | Status |
| --- | --- | --- | --- | --- |
| T-SET-1 | **Seed drain.** In the frozen generation `createOrder` is permissionless, so a stranger can name itself recipient, pay its own asset, and take the seed's payout at the admin's rate. | The order-creator allowlist (`NotOrderCreator`, SC §4, §9.1; Q31, Q35, Q111). A stranger can pay an existing order only if it is that order's named payer, and the payout still goes to the recipient the order names. **Residual:** an allowlisted creator (or one a compromised ADMIN adds) can name itself payer and recipient and trade against the seed at the pool's price, bounded by per-transaction and per-day caps, the seed cap, the pause, and on an oracle market the two-sided band. On the 46630 demonstration market the seed is sold at the admin's demonstration rate, in tokens without real-world value. | DR:X7 as corrected by C5 (a stranger holding 10 TSLA-equivalent with a max approval on an ACTIVE seeded market reverts `NotOrderCreator`; control: an allowlisted creator's order settles; a revoked creator cannot create, and its open orders stay payable). Mutant: delete the `canCreateOrders` check → X7. | SPECIFIED; RESIDUAL as stated |
| T-SET-2 | **Wrong payer.** A third party pays, or consumes, an order meant for someone else (the frozen V1 grief recorded in ADV-001). | Every order names a non-zero payer (`ZeroPayer`); only that payer may pay (`WrongPayer(id, payer, caller)`) (SC §9.1; Q111). | SC:X2 (stranger B funded and approved for at least `amountIn` reverts `WrongPayer`; control: bound payer A settles); TM-16 (payer zero reverts `ZeroPayer`; control non-zero). Mutant: delete the `boundPayer` check → X2. | SPECIFIED; TM-16 PROPOSED |
| T-SET-3 | **Redirecting a settlement.** Delivery to anyone but the merchant, or to an address that can never spend it. | `take` pays `order.recipient` only, written once at `createOrder`; `ZeroRecipient`; `ReservedRecipient` for {executor, `HOOK`, `POOL_MANAGER`, `ASSET_TOKEN`, `PAYOUT_TOKEN`, `REGISTRY`, `REGISTRY.FACTORY()`}, the factory added per A16 (SC §9.1). | SC:X3 (a third-party payer cannot redirect; each reserved recipient, the factory included, reverts); DR:I3b (every `Settled` recipient equals the stored recipient). Mutant: `take` pays `msg.sender` → X3. | SPECIFIED |
| T-SET-4 | **Replay** of an order, a payment, or a swap within one payment; an id replayed on another market or chain. | `orderId = keccak256(abi.encode(block.chainid, executor, creator, salt))`, unused (`OrderExists`); status Open → Paying → Settled (`OrderNotOpen`); transient `swapped[orderId]` (`OrderAlreadySwapped`); exactly one new receipt (`NoReceipt`); another market's executor has no such id (`UnknownOrder`) (SC §8.1, §9.1). | SC:X4; DR:I5 (no order rests in Paying; Settled is terminal). Mutant: delete the `OrderNotOpen` check → X4. | SPECIFIED |
| T-SET-5 | **The `orderId` does not commit to the order's terms** (the V1 residual in ADV-001). A payer who prepares `pay(orderId)` before the order exists trusts whatever terms are later written. | Only the same creator can create a given id, and only once, so terms never change after creation; `pay` takes no data but the id, and the terms come from storage (SC §9.1). Surface rule (UNICA v5, recorded here so it is pinned rather than habit): take the id from `OrderCreated` emitted by the market's own executor, read `orders(id)` back, and approve exactly `amountIn` before paying. | TM-3 (`pay` on an uncreated id reverts `UnknownOrder`; after creation, `orders(id)` equals the `OrderCreated` fields) | PROPOSED; surface rule RESIDUAL until v5 |
| T-SET-6 | **Slippage and front-running.** A third-party LP removes depth just before a payment, or the PoolManager owner raises the protocol fee (A9); a relayer sees the pending `pay`. | Only the executor swaps, so nobody can trade inside the pool around a payment; removing depth or raising a fee can only worsen execution, and `minOut` is checked twice (`OutputBelowMinimum` in the hook, `RecipientShort` in the executor). The script recomputes `minOut` from `feeRates()` at send time (SC §9.3, §11). | SC:X5 (`minOut` from the quote at creation, then a third-party LP removes 50% of depth or the fee is raised → `OutputBelowMinimum`; boundary: `actualOut` passes, `actualOut + 1` fails); DR:H11. Mutant: delete `OutputBelowMinimum` → H11. | SPECIFIED |
| T-SET-7 | **Input that is not exact:** fee-on-transfer or rebasing input, a wrong swap direction or amount, or an issuer upgrade that adds a transfer fee (A7). | Measured pull `== amountIn` (`InputNotExact`); `params` must match the order (`ParamsDoNotMatchOrder`); settle credit `== amountIn` (`SettlementDidNotClose`) (SC §8.1, §9.1). Every such change fails closed. | SC:X8 (control settles once the fee is off); SC:H9 | SPECIFIED |
| T-SET-8 | **Partial fill:** an order larger than the depth fills partly, or walks the tick bitmap to the price limit. | Consumed `== amountIn` (`PartialFill`); spacing bounded by the fee-tier allowlist (T-ID-6) (SC §7, §8.1). | DR:H10 | SPECIFIED |
| T-SET-9 | **Direct swap** on the market pool, bypassing the executor's payer, merchant and cap checks. | `beforeSwap`: `sender == EXECUTOR` (`NotSettlementExecutor`). The executor takes the lock itself, so `sender` is established by the PoolManager, not reported (SC §8.1, §9). | SC:H5 (PoolSwapTest on a seeded ACTIVE pool, funded attacker; control: the same amount through the executor settles), SC:H5b (raw unlock), SC:H5c (market A's executor against market B's pool, C18); DR:V5 on the fork. Mutant: delete `sender == EXECUTOR` → H5, H5b. | SPECIFIED |
| T-SET-10 | **Re-entry through issuer code while the PoolManager is unlocked (A6).** Stock tokens are upgradeable beacon proxies; the asset's `transfer` to the PoolManager can call `sync`, `settle`, `settleFor`, `swap`, `modifyLiquidity` or `donate`. | The credit `== amountIn` check names the `sync` case (`SettlementDidNotClose`); a swap reverts `NotSettlementExecutor`; the transient latch (`Reentered`); snapshot-relative residuals; exactly one receipt (SC §9.1, §9.3). | SC:X9a (`sync` → `SettlementDidNotClose`), SC:X9b (`settleFor` leaves zero deltas; the row asserts which outcome), SC:X9c (`swap` → `NotSettlementExecutor`), SC:X9d (`modifyLiquidity` changes neither delivery nor receipt); DR:X12 (a forged `unlockCallback` → `NotPoolManager`) | SPECIFIED |
| T-SET-11 | **Amounts beyond `int128` (A11)** reach a SafeCast revert deep in the PoolManager, or a panic on `type(int128).min`. | `createOrder` refuses `amountIn` or `minOut` above `uint128(type(int128).max)` (`AmountTooLarge`); the hook requires `amountIn, produced < 2^127` before its 512-bit step (SC §8.2, §9.1). | TM-4 (the boundary passes creation; one above reverts `AmountTooLarge`); fuzzers bounded to it | PROPOSED |
| T-SET-12 | **Donations (A15, C3).** Anyone can transfer tokens straight to the executor or hook. | Property P3: residual checks are snapshot-relative, so a donation never blocks a payment; there is no sweep, so donated tokens are unrecoverable (SC §9.3). | DR:I1 restated (ghost before/after snapshots per handler call, with a donor action), DR:I1b (a donation does not block the next valid `pay`) | SPECIFIED; loss of donated tokens RESIDUAL |
| T-SET-13 | **Third-party pull** from a payer's standing allowance to the executor. | The only pull is `transferFrom(msg.sender, …)` inside `pay`, reachable only by the order's payer (SC §4). | DR:I4 as corrected by C3 (payers hold standing max approvals; each payer's debit equals the sum of `amountIn` over orders that payer paid) | SPECIFIED |
| T-SET-14 | **Third-party liquidity distorts the seed proof (A10).** `markSeeded` sums every LP's depth at the opening tick. | Depth is read from PoolManager state and narrowed with `SafeCast`; third-party depth can only make `markSeeded` refuse (`SeedAboveCap`), never reduce the recorded depth, and that refusal is itself a denial of service (T-SET-20); readback asserts `seedDepth ≥` the minted L and that the seed position's own liquidity equals L (SC §7). SEEDED does not prove who owns the depth. No deployment tool has a path that adds liquidity to a market at or after SEEDED, and a live market is never reseeded, widened or recentred (S6). | DR:F13 (`SeedTooShallow` in both orderings, and a range one step short); TM-5 (a third-party LP adds depth at the opening tick before `markSeeded`: the call records at least L or reverts `SeedAboveCap`); G21 (the tools refuse any liquidity add at or after SEEDED); per-stage readback (C12) | PROPOSED; ownership of depth RESIDUAL |
| T-SET-15 | **The seed is withdrawn after ACTIVE** (SEEDED is point-in-time, DR §2.2 decision 7). | Settlement then fails closed (`PartialFill`, `OutputBelowMinimum`, or the low side of the band) with nothing moved; the event watcher (Q92) sees liquidity leave the pool and the incident procedure pauses (Q69) (SC §7). Recovery is pause, review, then retire and relist a new version; the market is never reseeded (S6). | TM-6 (the seed LP removes all liquidity after ACTIVE; `pay` reverts with a named error; payer and merchant balances unchanged) | PROPOSED; detection RESIDUAL (off-chain) |
| T-SET-16 | **Caps bypassed**, a cap counted on the wrong quantity, or a cap raised on a live market. | Per market, in payout base units: `minOut ≤ maxPerTx` at creation (`OrderAboveCap`), delivered `≤ maxPerTx` (`PaymentAboveCap`), per UTC day (`DailyCapExceeded`); counted on the measured delivery inside a settling `pay` only; read live, so `tightenCaps` binds the next payment, and tightening below an open order's floor makes it unpayable without trapping anything (SC §9.2). `tightenCaps(id, maxPerTx, maxPerDay)` only lowers — `0 < new ≤ current`, `maxPerTx ≤ maxPerDay`, at least one strictly lower, else `CapsNotTighter` or `CapsInvalid` — and never alters `payoutUsedOnDay` history or any emitted receipt; no function raises any per-transaction, per-day, seed or total cap, and raising any of them requires RETIRE and a new version (S3). Per-transaction, per-day and per-market seed caps are enforced on-chain; the $100 total at risk across markets sharing a payout token is a deployment-script and manifest refusal, never an on-chain invariant (S5). Before any `createMarket` and again before `activate`, the deploy wrapper enumerates every registered market through `marketCount()` and paged `getMarkets(offset, 100)`, requires the paged total to equal `marketCount()`, sums `maxSeedPayout` over every non-RETIRED market plus the proposed one, and refuses above 100000000 raw of the configured 6-decimal payout token; any RPC error, short page, count mismatch, or non-RETIRED market on a different payout token fails closed (S5). | SC:K1–K4 (each at the boundary: equal passes, one base unit over fails); SC:K7 (no on-chain function raises any cap; a tightening never alters `payoutUsedOnDay` history or any emitted receipt); G19 (deployment gate: a sum over 100000000 raw, a page error, a count mismatch, a foreign payout token, and a wrongly-counted RETIRED market each fail closed; control: a set at exactly 100000000 raw succeeds) | SPECIFIED on-chain; the $100 total SPECIFIED as a deployment-script and manifest refusal (S5), never described as enforced on-chain |
| T-SET-17 | **Very long-lived orders** (no deadline ceiling, DR §2.2 decision 9). | Accepted: bounded by the allowlist, the pause, RETIRED, and by caps and the oracle being checked at `pay`, not at creation (SC §9.1). | DR:X10 (expired → `OrderExpired`; past deadline at creation → `DeadlineInPast`) | RESIDUAL |
| T-SET-18 | **A receipt taken as proof of payment without `Settled`**, or a forged pair of events. | The hook's receipt and the executor's `Settled` are emitted in one transaction, so a receipt without `Settled` cannot survive; `Settled` is the success signal, and both are accepted only from the registry's hook and executor (SC §3, §11). | DR:I2 (`receiptCount` equals the number of Settled orders); SC:S1 | SPECIFIED |
| T-SET-19 | **Fee fields misreport what the payer paid.** The frozen receipt's `fee = 0` is the hook's own fee while the pool charged 3000 pips; a protocol fee can be set at any time (A9); a state change between the pool's `slot0` read and the hook's would make the receipt wrong (A14). | Four fields from `slot0` in the same swap: `hookFeePips` (0), `lpFeePips`, `protocolFeePips` (the half for this direction), `swapFeePips` (the PoolManager's own expression). Every external call in `afterSwap` is a STATICCALL to a `view` (`orders()`, `latestPrice`). Readback compares with the same transaction's `Swap.fee`, never constants (SC §11). | SC:H12a, SC:H12b, SC:H12c. Mutants M-fee-1 (`swapFeePips` ← `lpFee`) and M-fee-2 (always the zeroForOne half). Never-drop rows. | SPECIFIED |
| T-SET-20 | **Listing denial of service at the seed step.** `initializeMarket` and `markSeeded` are separate transactions, and `markSeeded` counts every LP's depth at the opening tick (SC §7). Between them a stranger adds in-range depth whose payout-equivalent exceeds `maxSeedPayout`: `markSeeded` reverts `SeedAboveCap`, the market never reaches SEEDED, and ADMIN's only remedy is RETIRE. Liquidity is never gated and no swap precedes ACTIVE (SC §5), so the stranger risks only gas, withdraws at will, and repeats it on the next version. | None specified: SC §7 records the refusal as a limit, not as a threat. Either change would close it, and the choice is SC's: mint the seed and record it in the same transaction as `initializeMarket` (the factory minting through PositionManager or `modifyLiquidity`), or measure the seed position's own liquidity by owner and salt instead of total depth. | TM-17 (a stranger adds depth above the cap between `initializeMarket` and `markSeeded`; under the chosen change the market still reaches SEEDED with the seed position's own liquidity recorded; control: without the stranger it seeds identically), written once SC chooses | BLOCKED (SC change open, §2) |

### 7.3 Lifecycle, pause and RETIRED

| ID | Threat | Mitigation (spec) | Test rows (mutant) | Status |
| --- | --- | --- | --- | --- |
| T-LC-1 | **A pause traps funds, or a paused market still settles.** | `createOrder` and `pay` require ACTIVE (`MarketNotActive`). Nothing is trapped: orders hold no tokens and input is pulled only inside `pay`; open orders survive a pause and are payable after unpause if unexpired; liquidity is never gated, so the LP can always exit, subject to the issuer's own pause (T-LC-5) (SC §5). | DR:X6 (both calls revert in PROPOSED, INITIALIZED, SEEDED and PAUSED; after unpause an order created before the pause is paid); DR:V6 on the fork. Mutant: delete the ACTIVE check → X6. | SPECIFIED |
| T-LC-2 | **The PAUSER does more than pause:** unpauses, retires, re-lists, or edits the allowlist. | ADMIN and PAUSER may both call `registry.pause(id)`; only ADMIN may `unpause` or `retire` (S2; Q65, Q70, U8); a second pause reverts, so a watcher sees the state it acted on (SC §4, §6). Every lifecycle transition, `None → PROPOSED` included, emits `MarketStatusChanged(marketId, from, to)` (S2). | TM-7 (from the PAUSER: `unpause`, `retire`, `activate`, `tightenOraclePolicy`, `tightenCaps`, `setOrderCreator`, `setPauser` each revert `NotAdmin`; control: `pause` succeeds from both ADMIN and PAUSER; a second `pause` reverts `WrongMarketStatus`); DR:R3; R3b (PAUSER attempting `retire` after pausing reverts `NotAdmin`, a mutant killed only by this row, S2) | SPECIFIED |
| T-LC-3 | **RETIRED is undone, or a retired market still settles.** | RETIRED is terminal, reachable by ADMIN from every stored state but None and RETIRED; it clears `liveMarketOf`; the retired executor refuses every call; records and history stay readable (SC §5; Q112). The retired pool still exists in the PoolManager and names the retired hook; only its executor could swap and it refuses, so the pool can never trade again, while the LP can still withdraw. | SC:R4 (all 49 pairs; only the listed edges succeed); TM-2 | SPECIFIED; TM-2 PROPOSED |
| T-LC-4 | **An illegal transition:** activation before seeding or before readback, or initialisation and seeding by a stranger or an old admin. | Every other status pair reverts `WrongMarketStatus` or `UnknownMarket`; `markSeeded` requires depth at the opening tick; the script refuses `activate` until the stage readback passes (Q115); the factory reads `REGISTRY.admin()` at call time, so an admin transfer takes effect everywhere at once (SC §4, §5). | SC:R4; DR:I6 (status edges stay inside the graph); DR:F1, DR:F1b and DR:F1c (C16: `createMarket`, `initializeMarket`, `markSeeded` from a stranger and from the old admin after `acceptAdmin` revert `NotAdmin`); per-stage readback rows (C12) | SPECIFIED |
| T-LC-5 | **The issuer pauses the stock token (A8).** Every PoolManager transfer of the asset reverts: `pay` fails, and the LP's normal exit reverts once the position holds any asset. | `pay` fails closed (`TransferFailed`). The runbook records the LP exit that clears the asset credit instead of transferring it (`DECREASE_LIQUIDITY` + `CLEAR_OR_TAKE(asset)` + `TAKE(payout)`), which recovers the payout side and forfeits the asset credit (SC §14). | TM-8 (fork: prank the token's pauser, pause TSLA; `pay` reverts `TransferFailed`; the LP exits by `CLEAR_OR_TAKE` and recovers the uTUSD) | PROPOSED; forfeited asset credit RESIDUAL |
| T-LC-6 | **A stale or closed oracle is read as healthy** because STALE_ORACLE and MARKET_CLOSED are computed, never stored, and a watcher reads only `statusOf`. | One view, on the hook: `oracleCondition() returns (OracleCondition condition, bytes4 reason, uint256 price, uint8 decimals, uint256 updatedAt)`, with `enum OracleCondition { OK, DEMONSTRATION_ONLY, STALE_ORACLE, MARKET_CLOSED }` (K6, reconciled to SO §6). It runs the oracle checks under `try`/`catch` and reports the caught selector in `reason`; stored status is read from `registry.statusOf(id)`, and PAUSED and RETIRED override any condition; it cannot run the per-swap deviation check, so `OK` means the reference is usable now, not that a settlement will pass (SC §8.2). | SO:O19 (selector-to-condition mapping); SO:O20 (demonstration fields) | SPECIFIED |

### 7.4 Oracle

The enforcement point is the hook's `afterSwap` (SC §8.2, SO §4): the pool executes, the hook enforces the bound (rec
28), and any failure reverts the whole settlement. No oracle row below is live on any chain today (§2: Q132, Q9, and no
feeds on 46630); every one is proven by unit rows with `MockOracleAdapter` and, for Chainlink claims, only by fork rows
against real Chainlink contracts (SO §10, §15).

| ID | Threat | Mitigation (spec) | Test rows | Status |
| --- | --- | --- | --- | --- |
| T-OR-1 | **Stale price**, or a `maxAge` set from the heartbeat alone. | `now − updatedAt ≤ maxAge` (`OracleStale`; `updatedAt == 0` fails here). `maxAge` is per market and never derived from the heartbeat alone; the on-chain ceiling is `MAX_ORACLE_AGE = 300` s, enforced by `register` and `tightenOraclePolicy` for every policy including one ADMIN sends directly, with markets free to be stricter (S4). The chain helper's own `maxAge > 300` refusal stays as a second layer, never the only one (SO §11, §12.2); a longer crypto `maxAge` needs a ledger amendment and a new release, not a helper exception (S4). In a cross route the older timestamp governs (SO §7.2). The Arbitrum One ETH/USD heartbeat is 1755 s, so availability `A(300)` is measured by `script/unica-v4/feed-cadence.sh` before any market is created (SO §11). | SO:O11–O17 (`age == maxAge` passes, `+1` fails; a policy above 300 s reverts `OracleMaxAgeOutOfRange`); SO:OF5 (`maxAge` by warp on the real feeds) | SPECIFIED; useful availability at 300 s BLOCKED (minimum `A(300)` OPEN) |
| T-OR-2 | **Zero or negative price**, a carried-over round, or a round with no timestamp. | Adapter (SO §7.2, homed there, not in the registry/hook catalogue): `answer > 0` (`FeedAnswerNotPositive`), `updatedAt != 0 && startedAt != 0` (`FeedNoTimestamp`), `answeredInRound ≥ roundId` (`FeedRoundIncomplete`); `InvalidAnswer` is not used. A negative answer never crosses the interface, which returns `uint256`, so the adapter refuses before any cast (CA §8 rule 2). Hook: `price > 0` (`OraclePriceZero`). | SO:O11–O17 (mock zero price); TM-9 (on the 42161 fork, `vm.mockCall` on the real feed returns answer 0, answer −1, `updatedAt` 0, and `answeredInRound < roundId`: each reverts with its named error; control: the unmocked feed passes) | SPECIFIED; TM-9 PROPOSED |
| T-OR-3 | **Wrong feed:** a policy naming another route, a feed proxy re-pointed behind a documented address, or feed decimals changed. | Single-route adapters only this release: one instance per route, constructor immutables, no admin (SO §2; S8); pinned proxy, `keccak256(description())` and `decimals()` re-read on every call (`FeedDescriptionChanged`, `FeedDecimalsChanged`, SO §7.2; CA §8 rules 1, 14); the chain file pins each adapter's runtime code hash and the helper compares it (SO §12). `marketId = keccak256(abi.encode(block.chainid, registry, asset, payout, version, policy.adapter, policy.feedId))` commits the route into the market's own identity; `register` recomputes it and requires `IUnicaOracleRoute(adapter).feedIdFor(asset, payout) == policy.feedId`, else `OracleFeedMismatch`; `_checkOracle` repeats that STATICCALL check before every `latestPrice` (S8). Off-chain readback of the same values is additional evidence only, never the binding itself. The Arbitrum One descriptions are unrecorded, so nothing builds that adapter until a read-only probe records them (SO §7.1). | SO:O1–O6 (each `createMarket` refusal, with a valid control); SO:OF1 (construction on the real feeds); TM-10 (a `vm.mockCall` changing the description, then the decimals, of the real feed address reverts by name) | SPECIFIED; TM-10 PROPOSED |
| T-OR-4 | **Decimal normalisation**, including every combination of 6-, 8- and 18-decimal tokens and 0..18-decimal references. | Token decimals are read on-chain at `createMarket` by STATICCALL to each token's `decimals()`; the return must be exactly 32 bytes encoding a value in 0..18, else `DecimalsUnreadable(token)` (covering a missing, reverting, short, long or out-of-range return), and both are stored as hook immutables (S7). `MarketConfig` also carries `expectedAssetDecimals`/`expectedPayoutDecimals` from the chain file; any difference from the value read refuses with `DecimalsMismatch(token, expected, actual)`, so configuration decimals are never trusted alone (S7). One comparison, homed in SO §4.2 and cited by SC §8.2 step 4: `dO ≤ 18` (`OracleDecimalsUnsupported`), and both `p ≤ type(uint128).max` and the normalised output `≤ type(uint128).max` are checked before any multiplication, each named `OraclePriceOutOfRange`; every named refusal replaces an unnamed FullMath revert. | SO:O18 (fuzz over {6, 8, 18}² × both orderings × reference decimals 0..18 × fee tiers, zero-tolerance cross-multiplied bound, C14, C15; O11–O15 include the one-above-the-bound case at 19); DR:MX1 (18 real markets through factory, seed, activate and pay); DR:M2 (math fuzz with exact cross-multiplication, C15); F22 (a token whose configured decimals differ from its on-chain `decimals()` reverts `DecimalsMismatch`); F23 (the decoded hook arguments round-trip against `previewMarket`'s record, S7) | SPECIFIED |
| T-OR-5 | **Inverted pair:** a reference in asset per quote instead of quote per asset, or the hook reading the pair in currency order. | The interface fixes the direction: quote per ONE whole asset (SC §10, SO §2). Each adapter serves exactly (asset, quote) and refuses the reverse (`PairNotSupported`); the hook always calls `latestPrice(ASSET_TOKEN, PAYOUT_TOKEN)` and takes amounts by role, never by currency index (SO §4.2); a cross route divides asset/USD by quote/USD in that order (SO §7.2). An inverted reference is far outside a 1–3% band unless the price is near 1, where the reversed-pair refusal is the defence. | TM-11 (reversed arguments revert; a mock returning the inverse of the configured reference is refused by the band in both orderings; control: the correct reference settles) | PROPOSED |
| T-OR-6 | **Excessive deviation** between execution and reference, in either direction. | One formula, homed in SO §4.2 and cited by SC §8.2 step 4: `refOutFloor = mulDiv(a*(1e6-f), p*10**dP, 10**(6+dA+dO))`; `refOutCeil` the rounding-up version; `minAllowed = mulDivRoundingUp(refOutCeil, 10_000-m, 10_000)`; `maxAllowed = mulDiv(refOutFloor, 10_000+m, 10_000)`. Settlement passes iff `minAllowed ≤ o ≤ maxAllowed` — the bounds are inclusive and each side is rounded against acceptance; otherwise `ExecutionBelowOracleBand` or `ExecutionAboveOracleBand`, each naming direction. `maxDeviationBps` (1 to 300; default 200, rec 26; hard ceiling `MAX_DEVIATION_BPS = 300`, S4) with the pool fee divided out explicitly, using the same `slot0` read the receipt records. | SO:O16, SO:O17 (`o == minAllowed` and `o == maxAllowed` pass; one raw unit beyond either fails); SO:OF3, SO:OF4 (a pool 3% off refused on each side, in raw output units); SC:O26 (the maximum payment on the maximum seed passes; repeated payments halt exactly at the band) | SPECIFIED |
| T-OR-7 | **Future timestamp**, or a timestamp equal to the block, which makes every age zero. | `updatedAt ≤ now` (`OracleTimestampInFuture`). Also refused: `updatedAt != block.timestamp`, else `OracleTimestampNotBeforeBlock`, run after the future check and before the age check (K3, reconciled to SO §4.1 step 5; CA §8 rule 5). Every adapter reports the source's own publish time, never arrival or block time (SC §10; SO §8, §9; CA §8 rule 9). | SO:O11–O17 | SPECIFIED |
| T-OR-8 | **Oracle outage:** a reverting or unreadable feed, no route, no verified report, an expired report. | The settlement reverts with the adapter's named error; an adapter MUST NOT return a zero, a placeholder, a cached fallback or a demonstration rate (SO §2). `_checkOracle` does not catch the revert: it propagates and the PoolManager wraps it as `WrappedError(hook, selector, reason, details)`; tests decode the inner adapter selector (K9, reconciled). The market reads STALE_ORACLE (T-LC-6). | SO:O11–O17 (the mock's revert mode, one row per named adapter error); SO:O19 | SPECIFIED; halted settlement during an outage RESIDUAL by design |
| T-OR-9 | **Paused market** while the oracle is healthy, or an oracle state reopening a paused market. | `pay` checks ACTIVE before any swap, so a paused market never reaches the oracle; no oracle state changes the stored status; PAUSED and RETIRED override any oracle condition (SC §5, SO §6). | DR:X6; SO:O19 | SPECIFIED |
| T-OR-10 | **Replayed reports** (Streams, CRE), or out-of-order delivery. | Streams: observation timestamp strictly greater than the stored one (`ReportNotNewer`), `expiresAt ≥ now` (`ReportExpired`), validity start not in the future (`ReportNotYetValid`), feed id and schema pinned (SO §8). CRE: the source timestamp inside the report strictly increases (`ReportNotNewer`) (SO §9). | SO:O21–O25 (test verifier and forwarder: replay, not newer, expiry) | SPECIFIED; deployment BLOCKED (Q95; CRE approval; CA §3a, §4a) |
| T-OR-11 | **Unauthorised report submission.** | Streams `submitReport` is permissionless and authenticated by `VerifierProxy.verify` (the DON signature; an unregistered digest reverts in the proxy); a verifier with a non-zero fee manager is refused (SO §8). CRE `onReport` accepts only `FORWARDER` (`NotForwarder`) with the workflow id and owner pinned; the chain's simulation forwarder, which checks no signatures, is refused at construction, by a per-chain list because the same address is Ethereum mainnet's real forwarder (SO §9; CA §4a). | SO:O21–O25 (wrong forwarder, simulation forwarder) | SPECIFIED against local stand-ins only; no real report has verified (CA §3a); BLOCKED |
| T-OR-12 | **Both orderings:** the asset as `currency0` or `currency1` changes which delta is input, which half of the protocol fee applies, and the opening-price rounding. | Amounts by role; the protocol-fee half by direction; the exact "perfect tick" flag on the `currency1` branch (SC §7, §11; SO §4.2). | SO:O18; SC:H12c; DR:MX1; DR:V2 (the `currency1` path through the real script, which C10 moves onto the never-drop list); MUT-50, MUT-51 (DR's M4 sabotage of the rounding, killed by M2) | SPECIFIED |
| T-OR-13 | **Manipulated pool.** A flash loan, a sandwich, or a skewed or drained range makes the pool pay a rate far from the reference. | Only the executor swaps, so no third party moves a UNICA pool's price; it moves only down, only by payments (SC §8.3). No UNICA contract reads any pool as a price source, so manipulating the UNICA pool, a hookless sibling or a foreign-hook pool cannot move the reference. Each oracle market's liquidity range is `[initTick − W, initTick]` (or its mirror), `W = UnicaMarketMath.seedWidth(tickSpacing, policy)`, recorded as `tickLower`/`tickUpper` in the market configuration file and the manifest, and asserted by readback against the on-chain recomputation (SC §7; S6). No deployment tool adds liquidity to a market at or after SEEDED, and a live market is never reseeded, widened or recentred (S6). A pool paying more than the reference (a seed sold below value) or less (a skewed or drained range) is refused on that side of the band; when the pool price leaves the recorded range, or the in-range payout-side depth cannot carry one maximum payment, settlement already refuses by name (`PartialFill`, `OutputBelowMinimum`, or a band error). The watcher then alerts; PAUSER or ADMIN pauses; after review ADMIN retires the market and a new version is listed — unpausing into an exited range is not a remedy (S6). | SO:OF3, SO:OF4 (a pool 3% off refused on each side); SO:O11–O17; SC:O26; X20 (a payment that exactly consumes the recorded range settles; one raw unit more refuses by name, balances unchanged, order still Open); V0s (readback of the recorded ticks); G21 (the tools refuse any liquidity add at or after SEEDED) | SPECIFIED; a market that leaves the range stops until retired and relisted, never reseeded, widened or recentred (S6); RESIDUAL only for the pause-to-retire window |
| T-OR-14 | **Sequencer downtime**, or a price that looks fresh just after the sequencer returns. | Where the chain file names a sequencer feed, the adapter checks it before any price read: down (`SequencerDown`), unknown (`SequencerStatusUnknown`), within `GRACE_PERIOD` of restart (`SequencerGracePeriod`) (SO §7.3; CA §8 rule 4). The helper refuses `requireOracle = true` on any L2 file without one; 46630 and 4663 have none (CA §2a, §6), so no oracle market can be enabled there. | SO:OF6–OF8 (down, grace and unknown by `vm.mockCall` on the real Arbitrum One sequencer feed); SO §12.2 CI planted file (L2 mainnet without a sequencer feed) | SPECIFIED; `GRACE_PERIOD` BLOCKED (owner, SO §16 item 4) |
| T-OR-15 | **Tokenized-equity `oraclePaused` hold.** The one documented feed of this family silently holds its last value while the issuer token's `oraclePaused()` is true (CA §6), and reports a total-return value (× `uiMultiplier`), not a share quotation. | With `ISSUER_PAUSE_TOKEN` set, `true` reverts `OraclePausedByIssuer` and a revert or empty return reverts `IssuerPauseUnreadable`; the 46630 faucet tokens revert on it (CA §7), so the adapter cannot be built for them; no route prices a Robinhood token from its feed until the raw-balance relation is proven (A7); the helper refuses every equity route (SO §7.4). | SO:OF9 (fork of 4663, read-only: description `"RHTSLA / USD"` and the issuer-hold refusal) | BLOCKED for any use (Q16, Q20, Q23) |
| T-OR-16 | **Equity market closed:** off-hours, a push feed publishes nothing and has no status field. | The adapter never improvises a calendar (CA §8 rule 7). A closed market reads STALE_ORACLE once `age > maxAge`; for up to `maxAge` after the last pre-close update that value is still accepted. Streams carries a status and reverts `MarketClosed` outside `ALLOWED_STATUS_MASK` (default {2}; unknown never accepted) (SO §7.4, §8). Rec 27 cannot be proven by the feed adapter alone. | SO:O21–O25 (status); SO:O19 | BLOCKED (Q20, Q23, Q95); the post-close window RESIDUAL |
| T-OR-17 | **ADMIN loosens a live market's policy**, switches the oracle off, or swaps its adapter or feed. | Tighten-only: `maxAge` and `maxDeviationBps` may only fall, each already bounded to 1..300 s and 1..300 bps by the on-chain ceilings (`OracleMaxAgeOutOfRange`, `OracleDeviationOutOfRange`, S4); `adapter` and `feedId` have no setter and are additionally committed inside `marketId` (S8); `enabled` has no setter; anything else is RETIRE and a new version (SC §6, SO §3, U5). The hook reads the policy live, so a tightening binds the next swap (SC §8.2). One error catalogue, homed in SC (`OraclePolicyRequired`, `OraclePolicyMalformed`, `OracleAdapterNoCode`, `OracleFeedMismatch`, `OracleMaxAgeOutOfRange`, `OracleDeviationOutOfRange`, `OraclePolicyDisabled`, `OraclePolicyNotTighter`; RETIRED refuses with `WrongMarketStatus`), reconciled with SO (K5); one full-state event, `OraclePolicySet(marketId, adapter, feedId, maxAge, maxDeviationBps, enabled)`, emitted by `register` and by every `tightenOraclePolicy` — `OraclePolicyTightened` does not exist. | SO:O7–O10 (each loosening refused, each tightening accepted, RETIRED refused, `OraclePolicySet` fields exact) | SPECIFIED |
| T-OR-18 | **A mock or placeholder oracle in a value path**, even temporarily (CA §8 rule 13). | `MockOracleAdapter` lives under `test/unica-v4/` only; a gate row fails if anything under `script/unica-v4/` imports from `test/` or references it; the helper refuses adapter kind `MOCK` and the mock's code hash; `adapterKind` is a label, not a defence (SC §10; SO §2, §10, §12.2). | the mock-isolation gate row (SC §10, SO §10); SO §12.2 CI planted file (a MOCK adapter) | SPECIFIED |
| T-OR-19 | **An adapter changes state during the swap**: re-enters, or moves a fee between the pool's `slot0` read and the hook's. | `latestPrice` is `view`, so the hook's call is a STATICCALL: a write reverts and the settlement fails closed (A14; SC §8.2, SO §2). Streams `verify` changes state and therefore runs in its own transaction before `pay` (SO §8). | TM-12 (a test adapter whose `latestPrice` attempts a write, reached through the `view` interface: the settlement reverts; control: a read-only adapter settles) | PROPOSED |
| T-OR-20 | **A demonstration market mistaken for an oracle-priced one**, or `requireOracle = false` on mainnet. | `REQUIRE_ORACLE` is an immutable; under it `createMarket` without an enabled policy reverts; the helper refuses `requireOracle = false` in any file whose `network` is mainnet (SO §3, §12.2). `demonstrationOnly` is stored on-chain and carried in every receipt with zero reference fields (SC §6, §11). Surfaces show "Demonstration rate — no oracle" and never a reference price (SC §13, SO §14). | SO:O1–O6; SO:O20; SO §12.2 CI planted file (mainnet without `requireOracle`); the C17 claims check | SPECIFIED |

### 7.5 Keys, administration and outside powers

| ID | Threat | Mitigation (spec) | Test rows | Status |
| --- | --- | --- | --- | --- |
| T-KEY-1 | **ADMIN key compromise.** The attacker can list markets (look-alike tokens, or a new version with an adapter it controls), pause, unpause, retire, add order creators, set the pauser, transfer admin, and tighten policies and caps until markets halt. | By construction it cannot move, pull, approve or freeze a user's tokens, redirect a settlement, edit an order, change a live market's tokens, rate, opening price, fee, spacing, hook, executor, adapter or feed, loosen anything, replace the factory or registry, or swap in a market pool (P1; SC §4). What remains: liveness; an accomplice creator buying the seed at the pool's rate within caps and band (T-SET-1); and a new market whose adapter the attacker controls. S8 binds a market's `policy.adapter` and `policy.feedId` cryptographically into its own `marketId` and re-checks them on-chain at every settlement, which closes a *mismatch* between the two, but not a self-consistent, attacker-controlled adapter a compromised ADMIN deploys and points a new market to. That market is official by SC §3's on-chain definition, and the chain file's adapter code-hash pin binds only the script path (SO §12), so a read layer must still check each new market's adapter against the reviewed chain file (TM-1's layer); nobody pays such a market unless an allowlisted creator names them as payer and they approve it themselves, and the watcher sees its `MarketProposed`. On mainnet ADMIN is a Safe (Q62, Q63), every admin action emits an event the watcher sees (Q92), and the incident procedure applies (Q69). On 46630 the deployer EOA is ADMIN, LP, minter and payer (DR risk 11), over tokens without real-world value. | DR:F1, DR:F1b, DR:F1c; DR:R3; DR:R5; SC:R10; DR:I7; TM-13 (an invariant handler with ADMIN as an actor calling every ADMIN function in random order: payer and merchant balances change only through `pay`, and no record's identity or pricing field changes) | SPECIFIED on-chain; the Safe BLOCKED (Q64) |
| T-KEY-2 | **PAUSER key compromise.** | It can pause every market and nothing else; ADMIN unpauses and replaces or disables it with `setPauser` (SC §4, §6). | TM-7 | SPECIFIED; mainnet PAUSER BLOCKED (Q70) |
| T-KEY-3 | **Admin transfer hijacked or mistyped.** | Two-step: `transferAdmin(next)` then `acceptAdmin()` from `next`; the pending admin has no power before accepting; the old admin keeps every power until then and loses all after, the implicit creator right included; no renounce exists (SC §4, §6). | DR:R5 (a stranger cannot accept; pending has no power; the old admin loses everything); SC:R10 (`AdminTransferStarted`, `AdminTransferred` fields) | SPECIFIED |
| T-KEY-4 | **Deployer key exposure or a script sending the wrong thing.** | Keystore only; a `PRIVATE_KEY` variable or `--private-key` is refused; live without a keystore name is refused (C11). On mainnet a fresh EOA funded only for gas deploys, then administration transfers to the Safe (Q101); a value-moving transaction is never forced to meet a deadline (Q2). | the wrapper shell rows of C11 (ported in spirit, written fresh) in the deployment specification | PROPOSED |
| T-KEY-5 | **The PoolManager owner sets a protocol fee (A9).** | Outside UNICA v4 and not preventable; the receipt reports the rate actually applied, the payer is protected by `minOut`, and readback compares with the same transaction's `Swap.fee` (SC §11). | SC:H12b, SC:H12c; SC:X5 (fee-raised variant) | RESIDUAL |
| T-KEY-6 | **The stock-token issuer upgrades the implementation, pauses it, or changes `uiMultiplier` (A7).** | Every such change fails closed in `pay` (`InputNotExact` for a fee or rebase, `TransferFailed` for a pause). The pre-flight requires the beacon's implementation address and code hash to equal the rehearsed values, `paused() == false` and `uiMultiplier() == 1e18` (A7). Implementations are pinned in reviewed chain configuration and monitored; on a mismatch the pauser pauses, and reopening needs Safe review and a new verified configuration (U7). The token binding is permanent per market (DR risk 4). | DR:V0, DR:V1 (re-assert the fingerprint); TM-14 (fork: prank the role that changes `uiMultiplier`; `balanceOf(PoolManager)` and a settlement's credited amount are unchanged; if the role cannot be identified, the raw-balance assumption is recorded as unproven) | PROPOSED; raw-balance relation BLOCKED (unproven) |
| T-KEY-7 | **The payout-token minter inflates supply**, or a different payout token is substituted. | uTUSD's minter is the deployer, over a token without real-world value; on mainnet the payout is USDC only where it is Circle-native on the chosen chain (rec 13), and its issuer's powers are outside UNICA v4. The payout token is configuration pinned by address (`EXPECT_PAYOUT_*`), and the seed mint runs only when `MINTER()` is the deployer (B1, C9). | the B1/C9 shell row (a payout token other than the committed pin is refused) | RESIDUAL; pin PROPOSED |
| T-KEY-8 | **A Safe with the wrong signers or threshold**, or one never exercised. | No mainnet value moves until the Safe's chain, address, signers, threshold and hardware-wallet control are verified and a test transaction has executed (Q64). | readback: `registry.admin()` equals the verified Safe after `acceptAdmin` (deployment specification) | BLOCKED (Q64) |

### 7.6 Deployment, chain configuration and evidence

SC §14 assigns these findings to the deployment and test specifications; this table records the threat and the
mitigation those specifications must carry. Every tool named is a committed script under `script/unica-v4/`, and CI
runs the gate with no local state.

| ID | Threat | Mitigation | Test rows | Status |
| --- | --- | --- | --- | --- |
| T-DEP-1 | **A script talks to the wrong chain**, an unknown one, or a disabled one. | `chain.sh` clears a stray `CHAIN` variable, loads `config/chains/<chainId>.json`, refuses a disabled file, an unset `rpcEnv` variable (never printing its value), a mismatch with the chain id the RPC reports, a `null` required address and a source without an evidence prefix; the forge script re-asserts `block.chainid`; `script/mainnet-guard.sh` still refuses mainnet ids (SO §12.2). | SO §12.2 CI planted files (disabled chain, id mismatch, unset `rpcEnv`, `null` address, bad prefix); DR:V10; the C11 shell rows (stray `CHAIN`, mainnet list) | SPECIFIED |
| T-DEP-2 | **A secret leaks:** a keyed RPC URL in output or in forge's dry-run records, or a key in the repository (B8). | RPCs are variable names only; the wrapper scrubs its own script's dry-run records on exit; nothing secret is committed, not once (repository rule "Secrets"). | the B8 planted-URL row (a fake keyed URL planted in a dry-run record is gone after the wrapper exits) | PROPOSED |
| T-DEP-3 | **Different hook code is deployed**, or the pinned hash drifts with the compiler profile (B10, DR risk 3). | The factory refuses code whose `keccak256` differs from `HOOK_CREATION_CODE_HASH` (`WrongHookCode`); the optimizer setting is pinned (the explicit key, or a checked `forge --version`); the source is tagged before stage A, and any hook or executor change after it means new infrastructure (SC §7, §12). | DR:F4 (one byte flipped reverts `WrongHookCode`); DR:F15 | SPECIFIED |
| T-DEP-4 | **The frozen generation is modified**, in source or in build (C13, B7). | G1 (TEST-MATRIX §11.1): the tag `experimental-46630-settled` resolves to `e5a0185`; `git status --porcelain --untracked-files=all` is empty on the frozen source, script, test and fork-test paths and `foundry.toml`; and the SHA-256 of `git diff --binary experimental-46630-settled HEAD -- <frozen paths>` equals the pinned, owner-accepted post-tag diff (B15). The literal empty-diff form (`git diff --exit-code`) is not used, because commits `eea86d2` and `903a8c9` changed frozen NatSpec after the tag and tags never move. G2: each frozen creation code is an exact byte prefix of its committed broadcast input (B7), with a one-byte sabotage control. UNICA v4 never imports `src/experimental/*`. | TEST-MATRIX G1, G2; DR:V11 (slot0 check kept as a sanity check only) | PROPOSED; G1's pinned value BLOCKED on the owner's acceptance (B15) |
| T-DEP-5 | **Fork evidence comes back all-skipped and looks green (C2).** | Before any live stage the wrapper runs the fork suite and refuses unless executed rows equal the declared count with zero skips, printing both numbers; the same rule governs SO §15's fork rows and the "demonstrated on a fork" wording; CI reports RPC-dependent steps as SKIPPED with a count, never passed (SO §12.2, §15). | the C2 shell row (the RPC variable unset → the wrapper refuses) | PROPOSED |
| T-DEP-6 | **The manifest loses records, or claims a verification that did not happen** (B2, B6, C12). | Per-market broadcast records, or a manifest keyed by `marketId` that refuses a market whose transactions are not all found exactly once; "verified" is written only after a read-only explorer query returns verified, with the query and its time; the verification tier is recorded per contract. | the C12 manifest test (planted cases: failed verification, a missing field, an RPC URL, frozen addresses under a UNICA v4 key); the B2 test that deletes one TSLA run file and must fail | PROPOSED |
| T-DEP-7 | **An oversized transaction is refused on 46630** (B5, C19): `createMarket` calldata is estimated at 36–39 KB against 16,870 bytes, the largest proven there (SC §12, ESTIMATE). | A size refusal happens at submission, is fail-safe and consumes no nonce; `eth_estimateGas` does not test it; the factory creation is the canary, and the fallback is decided before any market transaction (SC §12). | none offline: the first evidence is the live stage-A result, recorded before stage B | RESIDUAL |
| T-DEP-8 | **Nonce coupling** moves every predicted address if a stray deployer transaction lands (B3). | The wrapper re-reads the nonce each stage and refuses a mismatch with the printed plan; optionally the factory is deployed through the CREATE2 deployer with a committed salt (B3). | the C11 per-stage plan rows | PROPOSED |
| T-DEP-9 | **Negative rows pass for the wrong reason, and guards have no mutant** (C4, C5). | Each negative row reproduces the precondition, pairs with a control, and names the inner selector and emitter; a UNICA v4 table in the mutation suite, written fresh, needs every mutant KILLED by its named row and 0 MISATTRIBUTED before stage B (SC §9.3). | `make mutants-unica-v4` (C4) | PROPOSED |
| T-DEP-10 | **The owner signs a plan that omits a field** (C11). | Each stage's dry run prints chain, deployer, nonce, contracts, constructor arguments, salts, predicted addresses, transaction count, gas estimate and the verification and readback plan, and the predicted values equal what the loopback rehearsal deploys. | the C11 per-stage rows | PROPOSED |
| T-DEP-11 | **A public claim outruns the chain (C17).** | A UNICA v4 claims family with a planted self-test, run over docs, README, script output and the manifest: the ledger's banned phrases, faucet stock tokens or uTUSD without the no-value label, "verified" beside a UNICA v4 address without an explorer URL, a frozen address in a UNICA v4 context, a bare "v4"; Chainlink stays "planned" (Q125). | the C17 claims check (`--self-test`) | PROPOSED |
| T-DEP-12 | **The fork replay of the TSLA settlement proves less than it claims (C1).** Delivery of 393052 raw is the same at the live L and at the full-seed L. | The fork row asserts every value the live transactions produced (position L and ticks, post-swap `sqrtPriceX96`, tick and liquidity, delivery) at a pinned 46630 block with code-hash checks; the nonce delta equals the printed plan (C16). | DR:V0 as corrected by C1 and C16 | PROPOSED |
| T-DEP-13 | **"Configuration-only onboarding" is overstated** (B9, C16). | The NFLX onboarding change touches only data files and zero `.sol`, `.sh` or `.t.sol` files, enforced by a check with a planted control. | DR:V1; the config-only check | PROPOSED; an NFLX deployment BLOCKED (Q110) |

### 7.7 Signed-intent risk (the Advisory-001 class), and why public payment links are v5

ADV-001 records a Critical defect in the never-deployed `v2.0.0-rc1`: the payer's Permit2 witness does not bind the
merchant's half of the quote, so anyone who sees the payer's authorisation — every relayer, every observer of a pending
`settle` — can rebuild the quote with their own recipient and redirect the payment to themselves, up to the payer's
full signed ceiling; the payer is debited and the merchant is never paid. A merchant
allowlist would not close it, because a second legitimate merchant can perform the same theft. ADV-001 names the three
things the class needs: **a transferable off-chain authorisation, a submitter distinct from the authorising party, and
a destination outside what was authorised.**

**UNICA v4 has none of the three, by design.** The registry, factory, hook and executor contain no signature path:
no Permit2, no EIP-712, no `ecrecover`, no ERC-1271 (DR §2.2 decision 13: approve, then pay). The payer submits `pay`
itself (`msg.sender == order.payer`). The destination is written on-chain at `createOrder` by an allowlisted creator,
and `pay` carries no data but the order id. The cost is two payer transactions per payment. The Streams and CRE
adapters do verify Chainlink signatures (T-OR-11); that authenticates a price, never a payer, and moves no funds.

**Why public payment links wait for v5 (Q128).** A link that any payer may fulfil must either leave the payer unbound —
the frozen V1 residual in ADV-001, where anyone may pay and so consume an order — or authorise a payer off-chain and
let someone else submit, which is exactly the class above. Q111 permits such a mode only as a separately designed
public payment-link mode with its own caps and replay protections; Q128 moves it to v5, behind a signed-intent security
review that starts with ADV-001. That review's entry conditions, recorded here and not designed here: any payer
authorisation binds the complete quote digest (ADV-001's recommended option A), so that recipient, output token and
amount, `marketId` and executor, deadline and chain are all inside what the payer signed; no relayer chooses any field;
per-link caps and replay protection; and rows that invert ADV-001's two `KNOWN_DEFECT` characterisation tests.

| ID | Threat | Mitigation | Test rows | Status |
| --- | --- | --- | --- | --- |
| T-SIG-1 | **A signed-intent path appears in UNICA v4** (a permit, a meta-transaction, a signed order) and reopens the Advisory-001 class. | Mechanism absence in the four market contracts; payer-bound orders only (SC §1.2, §9.1; Q111, Q128). Adding any signature primitive is a v5 decision under the review above, never an edit. | TM-15 (a gate row: the registry, factory, hook and executor sources contain no use of `ecrecover`, `EIP712`, `ECDSA`, `permit(`, `SignatureTransfer` or `isValidSignature` outside comments; a planted control file containing one must fail; the adapters under `src/unica-v4/oracle/` are excluded and covered by T-OR-11) | PROPOSED |
| T-SIG-2 | **An unbound order** (the payment-link shape) is created on-chain anyway. | `createOrder` refuses a zero payer (`ZeroPayer`) and `pay` refuses anyone else (`WrongPayer`) (SC §9.1). | TM-16; SC:X2 | PROPOSED |
| T-SIG-3 | **Public payment links shipped before their review.** | Out of scope for UNICA v4 (SC §1.2; Q128); no UNICA v4 surface offers one. The v5 review above is the gate. | none in UNICA v4 | BLOCKED (v5 review not started) |

## 8. Every design-review critique finding, and where it lands

DR §3 leaves the mapping of its 46 findings to the specification set. Each finding below lands in at least one row of
§6 or §7; the check of §11 fails if one is missing.

| Findings | Rows |
| --- | --- |
| A1 hookless and foreign-hook pools · A2 flag enforcement · A3 initialiser not logged · A4 hook self-calls · A5 early salts | T-ID-1 · T-ID-5 · T-ID-5 · P4 (SC:H14) · T-ID-4 |
| A6 re-entry while unlocked · A7 issuer upgrade, `uiMultiplier` · A8 issuer pause traps the LP | T-SET-10 · T-KEY-6, T-OR-15 · T-LC-5 |
| A9 protocol fee changeable · A10 third-party depth · A11 `int128` bounds · A12 fee near 100% · A13 spacing 1 | T-KEY-5, T-SET-6, T-SET-19 · T-SET-14, T-SET-20 · T-SET-11 · T-ID-6 · T-ID-6, T-SET-8 |
| A14 STATICCALL dependence · A15 donations · A16 factory as recipient | T-SET-19, T-OR-19 · T-SET-12 · T-SET-3 |
| B1 payout token hard-coded · B2 manifest overwrite · B3 nonce coupling · B5 size limit · B6 explorer verification | T-KEY-7 · T-DEP-6 · T-DEP-8 · T-DEP-7 · T-DEP-6 |
| B7 frozen byte-prefix check · B8 keyed URLs in `cache/` · B9 config-only overstated · B10 hash drift | T-DEP-4 · T-DEP-2 · T-DEP-13 · T-DEP-3 |
| B15 frozen-diff SHA-256 pin (post-tag NatSpec commits `eea86d2`, `903a8c9`) | T-DEP-4 |
| B4 gas double-counting | not a threat: an estimate-accuracy finding the deployment specification carries as a labelled ESTIMATE range |
| C1 V0 cannot tell seeds apart · C2 all-skipped fork evidence · C3 I1 and I4 vacuous · C4 no mutants for frozen guards | T-DEP-12 · T-DEP-5 · T-SET-12, T-SET-13 · T-DEP-9 |
| C5 negative rows without preconditions · C6 spoofed receipts · C7 reverse maps untested · C8 look-alike tokens | §7 preamble and every negative row, T-DEP-9 · T-ID-2 · T-ID-8 · T-ID-3 |
| C9 payout pin · C10 `currency1` script path · C11 printed plan · C12 verification and readback · C13 frozen guard | T-KEY-7 · T-OR-12 · T-DEP-10, T-DEP-1, T-KEY-4, T-DEP-8 · T-DEP-6, T-ID-9, T-LC-4 · T-DEP-4 |
| C14 no decimals-by-ordering fuzz · C15 rounding blind spots · C16 contradictions · C17 language rules | T-OR-4 · T-OR-4 · T-LC-4, T-DEP-12, T-DEP-13 · T-DEP-11 |
| C18 cross-market executor · C19 size-limit instrument · C20 threat model with row check | T-SET-9 · T-DEP-7 · this file, §11 |

## 9. Residual risks, accepted and stated

Nothing below is prevented; each is bounded as its row says, and no surface may imply otherwise.

1. Hookless and foreign-hook pools on every UNICA pair, including the frozen hook's (T-ID-1).
2. An allowlisted creator can buy the seed at the pool's rate within caps and band (T-SET-1); the seed's depth is not
   proven to be the LP's (T-SET-14), and a withdrawn seed is noticed off-chain (T-SET-15).
3. Donated tokens are unrecoverable (T-SET-12). Orders have no deadline ceiling (T-SET-17).
4. The $100 total at risk across markets sharing a payout token is a deployment-script and manifest refusal, never
   an on-chain invariant (T-SET-16, S5). Per-transaction, per-day and per-market seed caps are enforced on-chain.
5. Outside powers: the PoolManager owner's protocol fee (T-KEY-5), the issuer's upgrade, pause and multiplier
   (T-KEY-6, T-LC-5, where an LP exit forfeits the asset credit), the payout minter (T-KEY-7).
6. Fail closed costs liveness: an oracle outage, a stale feed, or an oracle outside the band halts settlement; a
   market that leaves the band stops until retired and relisted (T-OR-8, T-OR-13). A closed equity market's last value
   is accepted for up to `maxAge` after the close (T-OR-16), which is one reason equity routes are refused.
7. A compromised ADMIN key controls listing and liveness, never funds (T-KEY-1).
8. A 46630 size refusal is discovered only at the live factory creation (T-DEP-7).
9. Two payer transactions per payment, the price of having no signature path (§7.7).

## 10. Conflicts between the two specifications, reconciled

SPEC-CONTRACTS and SPEC-ORACLE-AND-CHAINS previously disagreed on the ten points below. Each is now reconciled by the
oracle interface, route-binding, error-catalogue, event and formula choices threaded through §3–§9 above, and by
`docs/unica-v4/DECISIONS.md`'s Specification choices S1–S8. None blocks writing a row any longer; the table below
records the resolution and where it is applied, in place of the prior "SC says / SO says" register.

| # | Point | Resolution | Applied at |
| --- | --- | --- | --- |
| K1 | Deviation refusal | One formula (SO §4.2, cited by SC §8.2 step 4): two directional errors, `ExecutionBelowOracleBand` / `ExecutionAboveOracleBand`; the inclusive bound is `minAllowed ≤ o ≤ maxAllowed`, each side rounded against acceptance, so a value exactly on the bound passes. | T-OR-6 |
| K2 | Reference decimals | `dO ≤ 18` (`OracleDecimalsUnsupported`); both `p ≤ type(uint128).max` and the normalised output `≤ type(uint128).max` are checked before any multiplication, each named `OraclePriceOutOfRange`. | T-OR-4 |
| K3 | Timestamp equal to the block | Refused in both specifications: `updatedAt != block.timestamp`, else `OracleTimestampNotBeforeBlock`. | T-OR-7 |
| K4 | Binding `policy.feedId` to the adapter | Bound on-chain three ways: cryptographically inside `marketId` itself, by `register`'s `feedIdFor` check against `policy.feedId`, and by `_checkOracle`'s repeat of that check before every `latestPrice` (S8). Off-chain readback of the same values is additional evidence only, never the binding. | T-OR-3, T-ID-2, T-KEY-1, AS6, B3 |
| K5 | Registry policy validation and events | One error catalogue, homed in SC: `OraclePolicyRequired`, `OraclePolicyMalformed`, `OracleAdapterNoCode`, `OracleFeedMismatch`, `OracleMaxAgeOutOfRange`, `OracleDeviationOutOfRange`, `OraclePolicyDisabled`, `OraclePolicyNotTighter`; RETIRED refuses with `WrongMarketStatus`. `MAX_ORACLE_AGE = 300` s and `MAX_DEVIATION_BPS = 300` are on-chain ceilings enforced on every policy (S4). One full-state event, `OraclePolicySet`, at `register` and every tighten; `OraclePolicyTightened` does not exist. | T-OR-1, T-OR-17, §7.4 preamble |
| K6 | Condition view | One view, `oracleCondition()`, returning `(OracleCondition, bytes4 reason, price, decimals, updatedAt)` with `enum OracleCondition { OK, DEMONSTRATION_ONLY, STALE_ORACLE, MARKET_CLOSED }`; PAUSED and RETIRED, read from `registry.statusOf(id)`, override it. | T-LC-6 |
| K7 | Receipt oracle fields | SC's fields kept: `referencePrice`, `referenceDecimals`, `referenceUpdatedAt` (`uint64`), `demonstrationOnly`; no feed-id field, since the feed id is committed inside `marketId` instead (S8). | AS5, T-OR-17 |
| K8 | Row namespaces | TEST-MATRIX owns every row id: oracle fork rows are `OF1`–`OF9` everywhere (OF1–OF8 on the 42161 fork, OF9 the read-only 4663 row); SC's band row is `SC:O26`; `F` is the factory namespace only. No alias (`SO's F1–F8`, `SO numbers F1–F9`, `FO1–FO9`) is written anywhere in this file. | §1 Row IDs, T-OR-1 through T-OR-20 |
| K9 | How an adapter's revert surfaces | `_checkOracle` does not catch an adapter revert; it propagates and the PoolManager wraps it as `WrappedError(hook, selector, reason, details)`; tests decode the inner selector. Only the view `oracleCondition()` uses try/catch. `OracleUnavailable` does not exist. | T-OR-8 |
| K10 | Adapter shape | Single-route adapters only this release: one instance per route, constructor immutables, no admin, pinned description hash and decimals, an issuer-pause check, `SequencerStatusUnknown`; Streams and CRE are push-then-read, verifying and storing a report in its own transaction ahead of the `latestPrice` view. SC's multi-route `Route[]`, `StreamRoute[]` and `CreRoute[]` constructors are removed. | T-OR-3, T-OR-10, T-OR-11, T-OR-14, T-OR-15, §7.4 preamble |

Still open, and none removes or weakens a threat listed here: the chain-file source-prefix convention, the receipt
documentation's single home, and the determinism pin, carried in the specification registers as their still-open
rows (SR1 rows 15–17).

## 11. How this file is checked (C20)

A table whose rows name tests that do not exist protects nothing. A committed script, `script/unica-v4/threat-model-check.sh`
(to be written; bash, no RPC, no local state, so CI runs it as it runs the rest of the gate):

1. parses the §7 tables and refuses a duplicate threat ID or a status outside the five of §1;
2. resolves every `SC:`, `SO:`, `DR:` and `TM-` test ID named in a SPECIFIED or PROPOSED row to a test under
   `test/unica-v4/`, the UNICA v4 fork suite, or a shell test under `script/unica-v4/`, by the naming convention the
   test specification sets (the ID after a prefix is TEST-MATRIX's final ID; a `TM-` ID resolves through TEST-MATRIX
   §2's adoption list), and fails naming each ID it cannot resolve;
3. requires every finding A1–A16, B1–B10 and C1–C20 to appear in §8;
4. requires every mutant a row names to be registered in the UNICA v4 mutation table (C4);
5. prints a stated negative, "N rows checked, M test IDs resolved, 0 unresolved", never a blank;
6. carries a self-test: a planted row naming a nonexistent test, a planted duplicate ID, and a §8 with one finding
   removed must each fail, and the unchanged file must pass.

Until the UNICA v4 suites exist, every ID is unresolved; the check then runs in report mode and prints the count. It
becomes blocking at the same point as the mutation gate: before any live stage (C4). A new guard or a new finding adds
its row here in the same change; a row leaves only with a written reason.

## 12. Open issues

Owner decisions are marked; the rest must close before the rows they name can be written.

1. **RESOLVED:** K1–K10 (§10) are reconciled via `DECISIONS.md` S1–S8 and the interface, error-catalogue, event and
   route-binding choices threaded through §3–§9. The specification registers still list three still-open, non-
   mitigating items: the chain-file source-prefix convention, the receipt documentation's single home, and the
   determinism pin (SR1 rows 15–17).
2. TEST-MATRIX §2 adopts TM-1 to TM-17 under its own IDs, plus the new rows this reconciliation adds (G19, G20, G21,
   X20, V0s, F22, F23, SC:K7); the only part dropped is TM-1's adapter check for a read layer, which waits on item 12.
3. Rows citing B1, B2, B7, B8, B15, C2, C4, C11, C12, C13 and C17 depend on the deployment and test specifications,
   which SC §14 assigns those findings to.
4. **RESOLVED:** `ARBITRUM_MAINNET_RPC_URL` (`foundry.toml`'s existing name) is used everywhere in this file;
   `ARBITRUM_ONE_RPC_URL` is not used (SO §16 item 3).
5. **Owner:** the sequencer `GRACE_PERIOD`; the minimum `A(300)` for a crypto launch; whether the 300 s on-chain
   ceiling (S4) is ever amended for a 1755 s heartbeat feed (T-OR-1, T-OR-14).
6. **RESOLVED by `DECISIONS.md` S1–S8:** the fee-tier allowlist (T-ID-6, S1); ADMIN and PAUSER both pause, only ADMIN
   unpauses or retires (T-LC-2, S2); tighten-only caps with no raise path, ever (T-SET-16, S3); the on-chain ceilings
   `MAX_ORACLE_AGE = 300` s and `MAX_DEVIATION_BPS = 300` (T-OR-1, T-OR-6, S4); the $100 total as a deployment-script
   and manifest refusal (T-SET-16, S5); narrow recorded seed ranges, pause-and-replace only (T-OR-13, S6); token
   decimals read from the tokens (T-OR-4, S7); the on-chain route binding (T-OR-3, T-ID-2, T-KEY-1, S8).
7. The Robinhood token raw-balance relation to its feed's unit is unproven (A7; T-KEY-6, T-OR-15).
8. Scouted facts carried without re-verification: the look-alike token count, the shared beacon and its slot (C8, DR
   risk 13). Fork rows re-establish them before any send.
9. The four 46630 Uniswap v4 addresses are `null` in the chain configuration until a reviewed commit records them in
   evidence (SO §16 item 1).
10. The market and settlement data layout: DR's design used per-market files under `script/unica-v4/`, while SO §12
    puts chain addresses in `config/chains/<chainId>.json`; T-DEP-13's path rule needs the final layout.
11. Detection for T-SET-15, T-KEY-1 and T-KEY-6 rests on the event watcher and explorer alerts of Q92, which no
    specification yet defines (which events, which thresholds, who is alerted); on mainnet the PAUSER who would act is
    NOT READY (Q70).
12. No UNICA v4 read layer exists yet; TM-1 binds the first one built (an indexer, The Graph subgraph, or the UNICA v5
    dashboard) to emitter authentication and to checking each market's adapter against the reviewed chain file
    (T-ID-2, T-KEY-1). S8 already closes the on-chain mismatch case, so this remaining check is only for a
    self-consistent but unreviewed adapter a compromised ADMIN might point a new market to.
13. **Owner, with the specification authors:** close T-SET-20 in SC §7 with one of its two changes (seed minted and
    recorded in the `initializeMarket` transaction, or the seed position measured by owner and salt); TM-17 waits.
