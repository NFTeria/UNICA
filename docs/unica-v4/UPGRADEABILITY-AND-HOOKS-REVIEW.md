# UNICA v4 — upgradeability and hooks review

Date: 2026-09-11. Scope: the U1–U9 upgradeability rulings, the hook sandwich per generation,
execution order, canonical receipt authentication, fee taxonomy, oracle placement, the bounded
configuration matrix, external proxy/beacon monitoring, hook-permission verification, the v4/v5
boundary, merge readiness, and launch blockers.
Every statement below is labelled with one of six labels — IMPLEMENTED AND TESTED, IMPLEMENTED BUT INSUFFICIENTLY TESTED, DESIGNED, NOT IMPLEMENTED, EXPERIMENTAL, FROZEN/BLOCKED, LAB ONLY — and cited to its source. Where the decision ledger's own words (NOT READY, OPEN, NOT PROVIDED, …) are quoted in §§12–13, they sit beside the label FROZEN/BLOCKED, never instead of it. "Tested" means a named test in `test/` exercises the claim; 20 named tests were re-run offline on 2026-09-11 (`forge test --offline --match-test …`, 20 passed, 0 failed, 0 skipped).

## 1. Accepted U1–U9 decisions

DESIGNED, NOT IMPLEMENTED — owner decisions with no contract to hold them yet (§3 C). Recorded in docs/unica-v4/DECISIONS.md:183-191 (owner, 2026-09-11): U1 market hook never upgradeable; U2 executor never upgradeable; U3 registry not proxy-upgradeable, bounded data only through defined roles; U4 factory not upgradeable, a new factory is a new release; U5 adapters not proxy-upgradeable, tightening only where bounded, replacing an adapter or its semantics means RETIRE plus a new version; U6 no upgrade role or timelock exists, bounded admin changes go through the Safe and emit events; U7 external proxy/beacon implementations pinned in reviewed config, monitored with automatic alerts, the pauser pauses affected markets, reopening needs Safe review and a newly verified config; U8 PAUSE (pauser), unpause (Safe), RETIRE (Safe, terminal), no hot-patching; U9 off-chain parts change by reviewed commits and never alter an existing market's identity or settlement rules. "Not upgradeable" does not mean "nothing is configurable": see §8.

## 2. The sandwich, per hook generation

Four generations exist in source: **V1** (`src/V4SettlementHook.sol` + `src/SettlementExecutor.sol`, live Sepolia, tag `live-green`) — IMPLEMENTED AND TESTED; **V3** (`src/v3/UnicaHookV3.sol` + `src/v3/UnicaExecutorV3.sol`, multi-chain router-layout compat) — IMPLEMENTED AND TESTED; **experimental** (`src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol` + `UnicaStockSettlementExecutor.sol`, tag `experimental-46630-settled`, frozen) — EXPERIMENTAL (its own suites in `test/experimental/` pass, one live settlement on 46630), frozen as deployed, never upgraded; **v4** (`UnicaMarketRegistry/Factory/Hook/Executor`) — DESIGNED, NOT IMPLEMENTED: no `src/unica-v4/` or `test/unica-v4/` directory exists in this tree (checked), only `docs/unica-v4/SPEC-CONTRACTS.md`.

**TOP BUN, precisely.** "Pulls exact input, rejects fee-on-transfer, enters PoolManager.unlock" describes the **experimental** generation and the **v4 design**, not V1/V3. V1 and V3 take native ETH as `msg.value` — there is nothing to "pull" and no input-side fee-on-transfer is possible — and neither executor calls `PoolManager.unlock` itself; the official Universal Router does, one level down (confirmed in `README.md:166`, "the router unlocks the PoolManager").

**TOP BUN — executor validates the order and enters settlement**
- V1: `SettlementExecutor.pay` (`src/SettlementExecutor.sol:181-196`) checks order exists/Open (`183-184`), deadline (`185`), `msg.value == amountIn` (`186`); moves `Open→Paying` before any external call (`190-191`, invariant I5); no payer pre-binding — `msg.sender` becomes the payer at line 190. Its one external call is `IUniversalRouter.execute` (`196`), not `PoolManager.unlock`.
- V3: identical shape, `src/v3/UnicaExecutorV3.sol:241-261`, plus `_requireRouterUnchanged()` (`251`, a router-code-hash check absent from V1).
- experimental: `UnicaStockSettlementExecutor.pay` (`src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol:144-181`) — reentrancy latch (`145-146`), order/expiry checks (`149-151`), **payer binding** via `WrongPayer` when `boundPayer` is set (`152-154`), allowance check (`160-161`), `Open→Paying` (`165-166`), **pulls** exact input via `_safeTransferFrom` and **measures** what arrived, rejecting a fee-on-transfer input as `InputNotExact` (`177-179`), then calls `POOL_MANAGER.unlock` **directly** (`181`).
- v4-designed: `SPEC-CONTRACTS.md:341-351` — same shape as experimental (latch, ACTIVE check, `WrongPayer`, allowance, `Paying` before the call, `transferFrom` measured exact, `POOL_MANAGER.unlock` directly). DESIGNED, NOT IMPLEMENTED.

**PLATE — beforeInitialize restricts the pool**
- V1: `_beforeInitialize` refuses any pool but native-ETH-vs-payout-currency (`src/V4SettlementHook.sol:153-160`).
- V3: `src/v3/UnicaHookV3.sol:175-182`, same shape, chain-resolved currency.
- experimental: `src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol:93-99` — either ordering of the fixed input/payout pair.
- v4-designed: `sender == FACTORY` and `key.toId() == POOL_ID` (`SPEC-CONTRACTS.md:254`); DESIGNED, NOT IMPLEMENTED.

**BEFORE-SWAP — only the executor may swap, order in flight, params match**
- V1: `_beforeSwap` (`src/V4SettlementHook.sol:167-185`): sender is the router and its `msgSender()` is the executor (`173-175`); order in-flight, not already swapped, not expired, direction/amount/pool match (`177-183`).
- V3: `src/v3/UnicaHookV3.sol:189-207`, same checks; no market-ACTIVE concept (no registry generation).
- experimental: `src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol:105-128` — `sender == SETTLEMENT_EXECUTOR` established by the PoolManager itself, not reported by a router (`110`); in-flight/replay/expiry/direction/amount/pool (`114-125`). No market-ACTIVE concept either.
- v4-designed (DESIGNED, NOT IMPLEMENTED): `SPEC-CONTRACTS.md:255`, same checks. "Market ACTIVE" is **not** re-checked here — it gates `createOrder`/`pay` on the executor (`SPEC-CONTRACTS.md:129-130`, "Gating"; `:333`, `:342`), so an inactive market never reaches this callback at all.

**FILLING — PoolManager swaps, the pool's own LP fee, atomic**
Out of UNICA's source in every generation (Uniswap v4-core, vendored under `lib/`). V1/V3 (IMPLEMENTED AND TESTED) reach it via the Universal Router's `V4Router._swap` → `poolManager.swap` (`lib/uniswap-hooks/lib/v4-periphery/src/V4Router.sol:156-162`); experimental (EXPERIMENTAL) and v4-designed (DESIGNED, NOT IMPLEMENTED) call `POOL_MANAGER.swap` directly from `unlockCallback` (`src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol:222-230`; `SPEC-CONTRACTS.md:349-351` for v4).

**AFTER-SWAP — full fill, minimum output, receipt (v4: oracle/deviation too)**
- V1: `_afterSwap` (`src/V4SettlementHook.sol:190-209`) — `PartialFill` (`198`), `OutputBelowMinimum` (`201`), marks swapped and emits `SettlementReceipt`+`HookFee` (`206-207`, body `232-251`). No oracle.
- V3: `src/v3/UnicaHookV3.sol:212-231`, same checks (`219-223`), receipt at `229`.
- experimental: `src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol:132-165` — `PartialFill` (`145`), `OutputBelowMinimum` (`147`), receipt emitted `149-163`. Explicitly does not assert delivery (contract comment, `34-38`).
- v4-designed: `SPEC-CONTRACTS.md:256` — fill check, then `_checkOracle` (authenticated adapter read, staleness, two-sided deviation, `SPEC-CONTRACTS.md:269-283`, fail-closed), then `_emitReceipt`. DESIGNED, NOT IMPLEMENTED.

**BOTTOM BUN — output to the bound merchant, delivery measured, Settled, or revert**
- V1: `TAKE` to `order.recipient` is encoded by the executor (`src/SettlementExecutor.sol:235`) and executed inside the router's plan; back in `pay`, delivery is measured against a before/after balance and `RecipientShort` reverts short delivery (`203-205`); status `Settled` and `emit Settled` (`207-208`).
- V3: `src/v3/UnicaExecutorV3.sol:329` (take), `268-270` (measure/`RecipientShort`), `272-273` (Settled).
- experimental: `take` runs **inside** `unlockCallback`, direct to the merchant, no intermediate custody (`src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol:242`); after the callback returns, `_verifyDelivery` measures delivery, checks exactly one new receipt (`NoReceipt`, `198`) and the minimum (`RecipientShort`, `201`), plus executor-residual checks (`204,206`); status `Settled`/`emit Settled` (`185-186`).
- v4-designed: `take` inside `unlockCallback`, then `NoReceipt`/`RecipientShort`/residual checks, then per-market caps, then `Settled` (`SPEC-CONTRACTS.md:349-356`). DESIGNED, NOT IMPLEMENTED.

**Findings on the sandwich model**

- (V1/V3: IMPLEMENTED AND TESTED; experimental: EXPERIMENTAL; v4: DESIGNED, NOT IMPLEMENTED.) TOP BUN as stated ("pulls exact input, rejects fee-on-transfer, enters PoolManager.unlock") does not describe V1 or V3: both take native ETH as msg.value (nothing to pull, no input-side fee-on-transfer is possible), and neither executor calls PoolManager.unlock itself — the Universal Router does, one level below the executor's only external call (src/SettlementExecutor.sol:196; confirmed in README.md:166). TOP BUN as stated accurately describes only the experimental generation and the v4 design, both of which do pull an ERC-20 input, measure it against fee-on-transfer, and call PoolManager.unlock directly.
- (DESIGNED, NOT IMPLEMENTED.) '(v4) market ACTIVE' is not a BEFORE-SWAP check. Per SPEC-CONTRACTS.md, ACTIVE is gated on the executor's createOrder and pay (SPEC-CONTRACTS.md:129-130, 333, 342), not re-checked inside the hook's beforeSwap callback itself; an inactive market simply never reaches beforeSwap because pay reverts first.
- No conflict (IMPLEMENTED BUT INSUFFICIENTLY TESTED for the fee tier, §6). The sandwich's PLATE step ("beforeInitialize restricts which pool may use the hook") is confirmed but narrowed by source: V1/V3/experimental restrict the pool's currencies only, not its fee tier — a fact this section's "Dynamic pool fee" rows make explicit rather than contradicting.
- (LAB ONLY — an external contract, read for evidence.) `docs/unica-v4/arc/TOKENS.md` §5 (row at :191, "UNKNOWN" ruling at :204) lists cirBTC's Arc-testnet contract address as unknown. That ruling is stale: Circle's `developers.circle.com/assets/cirbtc-contract-addresses` lists exactly `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` for Arc Testnet (fetched 2026-09-11), as does the committed `docs/feedback/arc.md:48-79` (§9.1).
- (LAB ONLY.) DESIGN-REVIEW.md:293 (finding 8) records TSLA and NFLX sharing one beacon; a fresh read on 2026-09-11 shows AMD, AMZN, and PLTR also sit behind that identical beacon and share TSLA/NFLX's exact proxy bytecode — the beacon-collision gap is wider (5 tokens, not 2) than the committed record states.
- (DESIGNED, NOT IMPLEMENTED.) EXPECT_ASSET_BEACON, referenced in DESIGN-REVIEW.md as if it names an existing check, is not implemented anywhere in script/, src/, or test/ — it is a name proposed only in that review document's recommendation text.
- No conflict (DESIGNED, NOT IMPLEMENTED, confirmed). The sandwich/inventory model (V4SettlementHook=V1, UnicaHookV3=V3, QuoteSettlementHook/V2 frozen, UnicaStockSettlementHook=experimental, UnicaMarketHook=v4 designed, lab hooks) is consistent with everything found in source: UnicaMarketHook and its siblings (Registry/Factory/Executor) exist only in docs/unica-v4/SPEC-CONTRACTS.md prose, with zero matches anywhere under src/, test/, or script/ — so 'v4, designed' is confirmed.
- (DESIGNED, NOT IMPLEMENTED.) The v4 specification/decision-ledger/evidence/Arc-research documents (14 files under docs/unica-v4/ at the §14.3 snapshot; 26 including this file as of 2026-09-11, `git status --short --untracked-files=all`) are not merely 'not yet written' — they exist in full but are entirely UNCOMMITTED (untracked working-tree files), and the owner's own Q131 ruling (DECISIONS.md:177) explicitly withholds authorization to push or publish any of it. 'Uncommitted' is the operative fact for §12/§13, distinct from 'undesigned'.

## 3. IMPLEMENTATION STATUS: V4 WORK BY AREA (A–G)

All git state below is read from `git status --short`, `git log`, and `git tag` on branch `unicaV4`, HEAD `903a8c9` (2026-09-11), which is 29 commits ahead of `main` (`f492bb7`) and 0 behind (`git rev-list --left-right --count main...unicaV4`). Four documentation-only commits landed on top 2026-09-11 (`faf5d0d`, `34cc719`, `9d9988b`, `0314918`; files `FEEDBACK.md` and `docs/feedback/*` only), moving HEAD to `0314918`, 33 ahead and 0 behind; nothing below changes because of them except the cirBTC ruling (§9.1).

| Area | Scope | Status | Exact git state |
|---|---|---|---|
| A. Historical/frozen code | V1, V2 (frozen), V3, experimental (frozen), lab | mixed — see rows below | tags below |
| B. v4 spec + decision ledger | `docs/unica-v4/DECISIONS.md`, `SPEC-CONTRACTS.md`, `SPEC-ORACLE-AND-CHAINS.md` | DESIGNED, NOT IMPLEMENTED | uncommitted: all three paths (`git status --short`) |
| C. v4 implemented contracts | `UnicaMarketRegistry/Factory/Hook/Executor`, oracle adapters | DESIGNED, NOT IMPLEMENTED | no files exist |
| D. v4 tests | tests for the above | DESIGNED, NOT IMPLEMENTED | no files exist |
| E. v4 deployment/config tooling | chain settings, deploy scripts, Makefile targets | DESIGNED, NOT IMPLEMENTED | no files exist |
| F. v4 documentation + prototype | evidence docs, UX prototype | DESIGNED, NOT IMPLEMENTED | uncommitted (evidence docs); prototype directory absent |
| G. Arc research | Circle Arc network/product notes for a v5 nanopayments design | DESIGNED, NOT IMPLEMENTED (research only) | uncommitted: all 12 `docs/unica-v4/arc/*.md` (8 at the §14.3 snapshot) |

**A — historical/frozen code, by generation:**
- V1 (`src/V4SettlementHook.sol`, `src/SettlementExecutor.sol`): IMPLEMENTED AND TESTED. Tag `live-green` = `5e1d843`. Tests: `test/V4SettlementHook.t.sol`, `test/SettlementExecutor.t.sol`, `test/I7NativeSettle.t.sol`. Live Sepolia settlement recorded at README.md:549–551. Last source commit `87f9eca`.
- V2 (`src/v2/`): FROZEN/BLOCKED. Candidate `v2.0.0-rc1` = `fcfe151`, frozen by commits `d375d24`/`e633200` (docs/v2/RELEASE-CANDIDATE-FREEZE.md). Security Advisory 001 (docs/v2/SECURITY-ADVISORY-001.md:1–9): Critical, status "OPEN. Reproduced, not fixed", affects `src/v2/QuoteSettlementExecutor.sol` lines 339–342 and 436–439, reproduced by `test/v2/WitnessBinding.t.sol` (IMPLEMENTED AND TESTED as a regression test) — never deployed to any chain (SECURITY-ADVISORY-001.md:8).
- V3 (`src/v3/`): IMPLEMENTED AND TESTED. Tags `v3.0.0` = `376df29`, `v3-settled` = `39b6f91`. Deployed on four chains (README.md:422–448), settled on Sepolia (README.md:329-338, first receipt; README.md:364, `receiptCount()` 2). Tests: `test/v3/SettlementV3.t.sol` (e.g. `test_V3_1_SettlesThroughTheOfficialRouterAndReceipts`, :42), `test/v3/MineHookV3.t.sol`. Last source commit `203baf7`.
- experimental (`src/experimental/robinhood-testnet/`): EXPERIMENTAL, FROZEN. Tag `experimental-46630-settled` = `e5a0185`. Tests: `test/experimental/*.t.sol`, `test/fork/StockSettlement46630Fork.t.sol`. Last commit `eea86d2`.
- lab (`src/lab/`): LAB ONLY. No tag; last commit `c3e9f69`. Tests: `test/lab/{Limits,NanoAuthorization,NoOp}.t.sol`.

**B — v4 specification and decision ledger:** DESIGNED, NOT IMPLEMENTED. DECISIONS.md:3 states of itself: "Draft, not committed." All three files are untracked working-tree content; none exists in any commit on `unicaV4` or `main`. Since the §14.3 snapshot, seven more top-level drafts have appeared beside them, equally untracked and equally DESIGNED, NOT IMPLEMENTED: `DEPLOYMENT-GATES.md`, `EVENT-SCHEMA.md`, `IMPLEMENTATION-PLAN.md`, `README.md`, `TEST-MATRIX.md`, `THREAT-MODEL.md`, `V5-DEFERRED.md` (not reviewed here).

**C — v4 implemented contracts:** DESIGNED, NOT IMPLEMENTED. SPEC-CONTRACTS.md:30–31 names the contracts ("Under `src/unica-v4/`: `UnicaMarketRegistry`, `UnicaMarketFactory`, `UnicaMarketHook` and `UnicaMarketExecutor`"), but a repo-wide search confirms `src/unica-v4/` does not exist, and grep for `UnicaMarketRegistry|UnicaMarketFactory|UnicaMarketHook|UnicaMarketExecutor` across `src/`, `test/`, `script/` returns zero hits.

**D — v4 tests:** DESIGNED, NOT IMPLEMENTED. SPEC-CONTRACTS.md:33 names `MockOracleAdapter` "under `test/unica-v4/` only"; that directory does not exist, and the full `test/` tree (66 tracked files, 62 of them `.sol`) contains no v4 suite.

**E — v4 deployment/configuration tooling:** DESIGNED, NOT IMPLEMENTED. Zero hits for `unica-v4` across `Makefile`, `script/`, `scripts/`, `integrations/`, `apps/`, `package.json`. No per-chain settings file (DECISIONS.md:18–20 describes the design — "one settings file per chain" — but none is written).

**F — v4 documentation and prototype:** the docs (evidence/, plus the top-level spec files counted under B) are DESIGNED, NOT IMPLEMENTED and uncommitted. `prototype/unica-v4-ux/`, referenced at DECISIONS.md:31 (#122) and :36 (#127), does not exist in this checkout. The "prototype" cited throughout `evidence/DESIGN-REVIEW.md` (three lenses: security-first, deadline-first, dashboard/data-first) is explicitly built OUTSIDE this repository purely to measure the design's own claims, and per this repo's "Never copy" rule "nothing from any prototype was copied into it" (DESIGN-REVIEW.md:16–20) — it leaves zero in-repo artifact by design, not by omission. `docs/unica-v4/UPGRADEABILITY-AND-HOOKS-REVIEW.md`, cited at DECISIONS.md:194, is this file: present and untracked.

**G — Arc research:** DESIGNED, NOT IMPLEMENTED — 8 research files (`COMPATIBILITY, LIQUIDITY-ORACLES, NANOPAYMENTS, NETWORK, PRODUCT-FLOWS, THREAT-MODEL, TOKENS, X402`), plus 4 that appeared after the §14.3 snapshot (`DEPLOYMENT-GATES, OPEN-QUESTIONS, README, TEST-PLAN`, not reviewed here), all uncommitted, all citation-sourced prose with no contract code. Distinct from already-implemented, already-committed Arc integration code from the V1/V2 era (`integrations/arc-treasury/`, `integrations/arc-nanopayments/`, `docs/ARC-FACTS.md`), which predates and is out of scope of this v4/v5 research.

## 4. Execution order, from source

**V1 — IMPLEMENTED AND TESTED.** Trace confirmed by `forge test --match-test test_SettlementDeliversToTheRegisteredRecipient` (`test/SettlementExecutor.t.sol:45-69`) and by `docs/EXECUTION-PATH.md`'s own measured trace (its "call path, as measured" table).
1. `payer` → `SettlementExecutor.pay(orderId)` (`src/SettlementExecutor.sol:181`); order/expiry/value checks (`183-186`).
2. `order.status: Open→Paying`, payer recorded, **before** any external call (`190-191`).
3. `recipientBefore`/`receiptsBefore` measured (`193-194`).
4. The executor's **one** external call: `IUniversalRouter(UNIVERSAL_ROUTER).execute{value}(...)` (`196`) — this is not `PoolManager.unlock`; see the correction in §2.
5. Inside the (external, non-UNICA) Universal Router: `_executeActions` → `poolManager.unlock(unlockData)` (`lib/uniswap-hooks/lib/v4-periphery/src/base/BaseActionsRouter.sol:26`).
6. `PoolManager.unlock` calls back `unlockCallback` → `_unlockCallback` → `_executeActionsWithoutUnlock` → `_handleAction(SWAP_EXACT_IN_SINGLE)` → `_swap` → `poolManager.swap(...)` (`BaseActionsRouter.sol:32-46`; `v4-periphery/src/V4Router.sol:156-162`).
7. `PoolManager.swap` invokes `V4SettlementHook._beforeSwap` (`src/V4SettlementHook.sol:167`) — sender/caller/order/param checks; a failure here reverts the whole transaction with **nothing** written or emitted (tests: `test_RevertWhen_SwapSenderIsNotTheOfficialRouter`, `test/V4SettlementHook.t.sol:110-120`; `test_RevertWhen_OfficialRouterIsDrivenByAStranger`, `:125-140`).
8. PoolManager applies the swap and charges the pool's own LP fee (v4-core, not UNICA source).
9. `PoolManager.swap` invokes `V4SettlementHook._afterSwap` (`src/V4SettlementHook.sol:190`): full-fill/minimum checks (`198,201`), then **emits `SettlementReceipt` and `HookFee`** (`206-207`).
10. Still inside the same router call: the plan's `SETTLE` (native input) and `TAKE` (output to `order.recipient`) actions run (`src/SettlementExecutor.sol:232-235` encodes them; executed by the router/PoolManager).
11. `unlockCallback` returns, `PoolManager.unlock` returns, `UniversalRouter.execute` returns — control returns to `SettlementExecutor.pay` at the call site of step 4.
12. Back in `pay`: `hook.receiptCount() == receiptsBefore + 1` or `NoReceipt` reverts (`src/SettlementExecutor.sol:198`); `recipientAfter - recipientBefore >= minOut` or `RecipientShort` reverts (`203-205`).
13. `order.status = Settled`; `emit Settled(...)` (`207-208`) — the last write of a successful call.

**Plainly stated:** `SettlementReceipt` (step 9) is emitted **before** the executor independently confirms delivery (step 12) — confirmed by `test_Schema_LogOrderIsSwapReceiptFeeThenPayment` (`test/ReceiptSchema.t.sol:103-116`), log order `Swap → SettlementReceipt → HookFee → recipient Transfer`. Steps 9-13 are one top-level call, so a revert at step 12 (`RecipientShort`, `src/SettlementExecutor.sol:205`, or `NoReceipt`, `:198`) erases the `SettlementReceipt` log with it — a reverted call's logs are discarded, so nothing an indexer reads survives a short delivery. No pause is sent automatically anywhere in this path; both errors are synchronous reverts inside the same transaction.

**Experimental generation — EXPERIMENTAL**, ordering tested within the experiment (`test_A4_receipt_and_settled_both_emitted_in_the_right_order`, `test/experimental/StockSettlement.t.sol:93-112`), frozen, one live settlement on 46630.
1. `payer` → `UnicaStockSettlementExecutor.pay(orderId)` (`src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol:144`); reentrancy latch (`145-146`), order/expiry/`WrongPayer` checks (`149-154`), allowance check (`160-161`).
2. `Open→Paying` (`165-166`); a `Snapshot` of executor/recipient balances and `HOOK.receiptCount()` taken (`168-173`).
3. Executor **pulls** the exact input via `_safeTransferFrom` and measures what arrived; a short arrival (fee-on-transfer) reverts `InputNotExact` (`177-179`).
4. Executor calls `POOL_MANAGER.unlock(abi.encode(orderId))` **itself** — no router (`181`).
5. `unlockCallback` (`210`, only `POOL_MANAGER` may call it — `NotPoolManager` else, `211`); order-Paying check (`216`); calls `POOL_MANAGER.swap(...)` (`222-230`).
6. `PoolManager.swap` invokes `UnicaStockSettlementHook._beforeSwap` (`105`) — sender-is-executor (established by the PoolManager itself, not reported, `110`), order/replay/expiry/direction/amount/pool checks (`114-125`).
7. PoolManager applies the swap and its own LP fee (v4-core).
8. `PoolManager.swap` invokes `_afterSwap` (`132`) — full-fill/minimum checks (`145,147`), marks swapped, **emits `SettlementReceipt`** (`149-163`).
9. Still inside `unlockCallback`: `POOL_MANAGER.sync` (`234`), transfer to the PoolManager, `settle()` checked `== amountIn` or `SettlementDidNotClose` (`235-237`), then `POOL_MANAGER.take(payoutCurrency, order.recipient, out)` — **direct delivery**, no intermediate custody (`242`).
10. `unlockCallback` returns (`243`); `POOL_MANAGER.unlock` returns; control returns to `pay` at the call site of step 4.
11. `_verifyDelivery` (`183`, body `193-207`): exactly one new receipt or `NoReceipt` (`198`); delivered `>= minOut` or `RecipientShort` (`201`); executor-residual checks (`204,206`).
12. `order.status = Settled`; `emit Settled(...)` (`185-186`); latch released (`187`).

**Plainly stated:** as with V1, the receipt (step 8) is emitted before delivery is independently confirmed (step 11), proven by `test_A4` above; a revert at step 11 (`NoReceipt`/`RecipientShort`/residual, `198/201/204/206`) reverts the whole `pay` call and erases the receipt too — the direct `take` in step 9 is inside the same still-unresolved transaction, so no delivery is final until `pay` returns successfully. `test_G3_a_payout_token_that_delivers_short_is_refused_by_the_executor` (`test/experimental/StockSettlementGaps.t.sol:127`) exercises exactly this collapse.

**v4 design — DESIGNED, NOT IMPLEMENTED.** No `src/unica-v4/` or `test/unica-v4/` exists in this tree (checked directly). Per `docs/unica-v4/SPEC-CONTRACTS.md:341-356` (§9.1 `pay`), the order is: latch, ACTIVE check, order/payer/allowance checks (1) → `Paying` before the external call, snapshot (2) → `transferFrom` measured exact, `InputNotExact` on shortfall (3) → `POOL_MANAGER.unlock` directly → `unlockCallback`: `swap` (firing `beforeSwap`/`afterSwap`, the latter running the oracle check of §8.2 **before** the receipt, per `SPEC-CONTRACTS.md:256`) → `sync`/transfer/`settle`/`take` (4) → exactly one receipt, recipient delta, executor-residual checks (5) → per-market caps (6) → `Settled` status and event (7). This reproduces the experimental generation's shape — receipt before independently-measured delivery, one transaction, revert erases both — by specification only; none of it has been compiled, deployed, or exercised by a test, so the ordering claim for v4 is a design intent, not a measured fact.

## 5. Canonical receipt and its authentication

**Which event is canonical.** `docs/RECEIPT-SCHEMA.md` treats the hook's `SettlementReceipt` as the receipt ("Emitted by the hook from inside the swap that settled the order", line 3) and the executor's `Settled` as "A convenience for callers, not the canonical record" (lines 61-62). In practice, for V1, V3 and the experimental generation the two are **transactionally inseparable**: §4 shows the receipt is emitted mid-transaction and everything after it (`NoReceipt`, `RecipientShort`, the residual checks) can still revert the whole call, which erases the receipt log along with `Settled`. So a *mined* transaction can never carry `SettlementReceipt` without `Settled` beside it, or vice versa — an indexer that requires both together in one transaction gets the same completeness guarantee as one that trusts the hook's event alone, and is more robust against reading a not-yet-final simulation. IMPLEMENTED AND TESTED for this property: `test_Schema_LogOrderIsSwapReceiptFeeThenPayment` (`test/ReceiptSchema.t.sol:103-116`) for V1; `test_A4_receipt_and_settled_both_emitted_in_the_right_order` (`test/experimental/StockSettlement.t.sol:93-112`) for the experimental generation. For V3 the property is IMPLEMENTED BUT INSUFFICIENTLY TESTED: `test_V3_1_SettlesThroughTheOfficialRouterAndReceipts` (`test/v3/SettlementV3.t.sol:42-75`) asserts one receipt and `Settled` status after one `pay`, but no V3 test asserts the log order.

**Authentication path.**

*v4 design (DESIGNED, NOT IMPLEMENTED — no `src/unica-v4/` or `test/unica-v4/` exists).* `docs/unica-v4/SPEC-CONTRACTS.md` §3 (lines 82-91) and §6 (line 161) specify the full chain: registry `statusOf(marketId) != None` → the registry's write-once `marketIdOfHook(hook)`, `marketIdOfExecutor(executor)` and `marketIdOfPool(poolId)` all equal `marketId` → the hook itself is the factory's CREATE2 of code hashing to a pinned `HOOK_CREATION_CODE_HASH` → the pool key is rebuilt from the hook's immutables → the transaction's event is accepted only when `log.address == getMarket(marketId).hook` (receipts) or `== getMarket(id).executor` (`Settled`) — the spec calls this "Emitter authentication (C6)" and states the rule explicitly (line 88-91).

*V1/V3 today: no registry contract exists*, so "official" is established procedurally, not on-chain:
- `integrations/graph/subgraph.yaml` pins two specific addresses as separate dataSources — `V4SettlementHook` at `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` (line 12) and `UnicaHookV3` at `0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0` (line 33) — and only indexes `SettlementReceipt` logs whose emitter is one of those two addresses. IMPLEMENTED BUT INSUFFICIENTLY TESTED as an authentication control: the subgraph's own tests live under `integrations/graph/tests/`, and no test in `test/` asserts that a non-pinned emitter is ignored.
- `README.md:543` / `docs/DEPLOYMENT.md:48,97` record the same V1 address in prose as the deployment-of-record (IMPLEMENTED AND TESTED generation; the pinning itself is procedural, not a tested on-chain control).
- On-chain, the only mutual binding available to a caller is the CREATE2 pairing: the hook derives its executor's address from the executor's creation code plus its own address (`src/V4SettlementHook.sol:117-123`), and the executor stores the hook as an immutable constructor argument (`src/SettlementExecutor.sol:67,121`) — IMPLEMENTED AND TESTED by `test_ExecutorDerivationMatchesTheDeployedAddress` (`test/V4SettlementHook.t.sol:86`). This proves a *given* hook/executor pair is internally self-consistent; it does **not** prove that pair is the one anyone has agreed to trust — that trust is carried entirely by the pinned address lists above, off-chain.
- `tools/unica-verify` (a separate, V2 tool) does not consult a registry either: it takes the hook/pool identity from caller-supplied evidence JSON and *recomputes* digests to check internal consistency (`tools/unica-verify/README.md:14`, "It recomputes; it does not read and agree"; a V2-era tool, and V2 itself is FROZEN/BLOCKED), which authenticates the payload's arithmetic, not the emitter's legitimacy.

**Spoofed-receipt regression test.**

*DESIGNED spec, not built:* `SPEC-CONTRACTS.md:88-91` — "anyone can deploy the same hook source through their own factory and emit receipts with an official marketId... Row S1 deploys such a look-alike and proves all three reverse lookups return zero for it." Precondition: an attacker deploys `UnicaMarketHook` (same source) through their own factory/CREATE2 salt, encoding a real, live `marketId` into the constructor args, and emits a `SettlementReceipt` carrying that `marketId` from their own address. Control/assertion: `registry.marketIdOfHook(attackerHook) == 0`, `marketIdOfExecutor(attackerExecutor) == 0`, and `marketIdOfPool(attackerPoolId) == 0` — the registry's reverse maps are written only by the real factory's `register()` call (`SPEC-CONTRACTS.md:156`, `:165`), so the impersonator's address never appears in them, and a consumer following the C6 rule above rejects the log. **This test does not exist**: confirmed by the absence of `src/unica-v4/` and `test/unica-v4/`.

*What exists today for V1/V3/experimental is not this test.* A repo-wide search for spoof/look-alike/impersonation/attacker-hook language in `test/` found two adjacent but different tests: `test_Schema_DecodingIsHookAddressAgnostic` (`test/ReceiptSchema.t.sol:121-150`) deploys a **second legitimate** `V4SettlementHook`+`SettlementExecutor` pair, properly CREATE2-bound to each other, and checks that a topic-and-`schemaVersion` decoder correctly attributes each of two settlements to its own emitter — it proves multi-deployment decoding works, not that an *unbound, attacker-controlled* hook is rejected. `HostilePoolAttackTest` (`test/attack/HostilePool.t.sol:19-60`) attacks the **real, live V1 hook** with a pool of the wrong payout currency, refused by `_beforeInitialize`/`PayoutCurrencyNotAllowed` — a hostile *pool*, not a hostile *hook contract* emitting a look-alike event. Neither test deploys an attacker's own hook contract from a different address and checks whether a naive log-topic consumer would accept its `SettlementReceipt`. Given that `docs/RECEIPT-SCHEMA.md:46` explicitly instructs an indexer to "never hard-code a deployment" and instead "take the hook from the emitter," and that V1/V3 have no on-chain registry to check that emitter against, **a spoofed-receipt regression for V1/V3 is DESIGNED (via the v4 registry pattern) but not tested anywhere in this tree today**, and the pinned-address subgraph manifest is the only control actually in force.

## 6. Fee taxonomy

"Fee" names at least seven unrelated things in this tree — a pool parameter, a hook constant, a
receipt field, a protocol switch, a transfer-time refusal, and a third-party HTTP negotiation
protocol that never touches a UNICA contract. `docs/experimental/STOCK-46630-FEE-FIELD.md` exists
because two of these (pool LP fee vs. hook fee) were already conflated once, on a live receipt. One
note on naming: `src/V4SettlementHook.sol` is the **V1** generation (live Sepolia, tag `live-green`)
despite its filename — "UNICA v4" below means the release specified under `docs/unica-v4/`, which
has no source under `src/unica-v4/` (checked: no `unica-v4` path exists outside `docs/`) and is
**DESIGNED, NOT IMPLEMENTED** throughout this table.

| Term | What it is | Where it lives | Current value | Source |
|---|---|---|---|---|
| **Pool LP fee — V1** | static per-`PoolKey` fee, a Uniswap v4 mechanic, not a UNICA one | `key.fee` at `PoolManager.initialize`; read back via `StateView.getSlot0` | **3000** (0.3%), pool id `0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db` — LIVE (V1 generation: IMPLEMENTED AND TESTED) | on-chain read, chain id 11155111, `StateView.getSlot0(bytes32)` at `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C` → `(sqrtPriceX96, tick, protocolFee 0, lpFee 3000)`, read just now |
| **Pool LP fee — V3** | same mechanic, second generation, same pair | same call | **3000** (0.3%), pool id `0xf9b873f83814234224be42592795ec812fb948a300188e0c597796171ab9c57a` — LIVE (V3 generation: IMPLEMENTED AND TESTED) | on-chain read, chain id 11155111, same `StateView` address → `(…, protocolFee 0, lpFee 3000)`, read just now; also recorded at README.md:334 |
| **Pool LP fee — experimental** | same mechanic, TSLA/uTUSD pair | same call, different chain | **3000** (0.3%), pool id `0x64553b2a4c30c7a7551f752184ef3442e40817cc17f118db3d95142839057a34` — EXPERIMENTAL | on-chain read, chain id 46630, `StateView.getSlot0` at `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` → `(…, protocolFee 0, lpFee 3000)`, read just now; matches `docs/experimental/STOCK-46630-FEE-FIELD.md:25-26` |
| **Pool LP fee — all three** | — | — | measured identical (3000) but **not guaranteed** — no hook here restricts the tier a pool opens at, so a fourth market could open at any value — IMPLEMENTED BUT INSUFFICIENTLY TESTED | see "Dynamic pool fee" row below for why nothing stops this |
| **Dynamic pool fee — V1** | whether the hook refuses a dynamic-fee pool at creation | `_beforeInitialize` checks `currency0`/`currency1` only, no `isDynamicFee()` call | **not refused** — any fee tier, static or dynamic, is admitted for the sanctioned currency pair | `src/V4SettlementHook.sol:150-153` ("any fee tier: the check is on the currencies, not on the caller"); no test in `test/` creates a dynamic-fee pool against this hook — IMPLEMENTED BUT INSUFFICIENTLY TESTED |
| **Dynamic pool fee — V3** | same question, second generation | same pattern | **not refused**, identical reasoning | `src/v3/UnicaHookV3.sol:172-175`; same test gap — IMPLEMENTED BUT INSUFFICIENTLY TESTED |
| **Dynamic pool fee — V2** | same question, frozen generation | `_beforeInitialize` explicitly calls `key.fee.isDynamicFee()` | **refused** — `DynamicFeeNotSettleable` reverts at pool creation | `src/v2/QuoteSettlementHook.sol:97`, error `src/v2/interfaces/IQuoteSettlement.sol:113`, test `test_Init_ADynamicFeePoolIsRefused` at `test/v2/HookAdmission.t.sol:63` — IMPLEMENTED AND TESTED, but the whole V2 generation is FROZEN/BLOCKED (Advisory 001, deployed nowhere) |
| **Dynamic pool fee — experimental** | same question, frozen experiment | `_beforeInitialize` checks currency shape only, either order | **not refused**, same gap as V1/V3 | `src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol:88-93` ("any fee tier, and nobody may create any other shape") — EXPERIMENTAL, IMPLEMENTED BUT INSUFFICIENTLY TESTED |
| **Hook fee — V1** | OpenZeppelin's standard `HookFee(poolId, payer, fee0, fee1)` event; the hook takes none | `IHookEvents.HookFee`, emitted in `_afterSwap` | always **(0, 0)** — hardcoded literals, not computed | `src/V4SettlementHook.sol:250`, doc comment `:26,:34`; test `test_ReceiptCarriesTheOrderAndTheStandardEvent` (`test/SettlementExecutor.t.sol:76`, asserts `fee0 == 0`/`fee1 == 0` at `:98-99`) — IMPLEMENTED AND TESTED (live-green) |
| **Hook fee — V3** | same event, second generation | same pattern | always **(0, 0)** | `src/v3/UnicaHookV3.sol:275`, comment `:53` — IMPLEMENTED BUT INSUFFICIENTLY TESTED for this field: settled twice on Sepolia (README.md:329-338, :364), but no test in `test/v3/` decodes `HookFee` |
| **Hook fee — V2** | whether V2 emits `HookFee` at all | `QuoteSettlementHook.sol` imports no `IHookEvents` | **does not exist** — no such event in this generation | `grep IHookEvents src/v2/QuoteSettlementHook.sol` — no match; FROZEN/BLOCKED |
| **Hook fee — experimental** | the hook's own fee, carried as a field on `SettlementReceipt`, not a separate `HookFee` event | `SettlementReceipt.fee`, `docs/RECEIPT-SCHEMA.md` row 11 | **0**, literal | emit at `src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol:153`, field `src/experimental/robinhood-testnet/UnicaStockSettlementEvents.sol:26`, schema row `docs/RECEIPT-SCHEMA.md:27` — EXPERIMENTAL. This is the field the fee-discrepancy note is about: **0 is correct for "the hook's own fee"; it is not the pool's LP fee** (3000, above), which the field name alone does not say |
| **Hook fee — UNICA v4 design** | the hook's own fee as a receipt field, generalized | `hookFeePips` in the specified `SettlementReceipt`; constant `HOOK_FEE_PIPS` | **0**, by a structural constant — no return-delta flags, so the hook cannot take a fee even if the constant changed | `docs/unica-v4/SPEC-CONTRACTS.md:246` (constant), `:454` (field, "no return-delta flags"), `:239` ("no return-delta flags, fee override 0") — DESIGNED, NOT IMPLEMENTED (no `src/unica-v4/`) |
| **UNICA protocol fee** | a platform-level fee UNICA itself would charge, distinct from the pool's LP fee | nowhere in any deployed contract; a ledger decision for the v4 beta | **none** — fixed at 0, "no UNICA fee in the beta"; if one is ever added it is disclosed separately from the LP fee and capped behind a timelock | `docs/unica-v4/DECISIONS.md:115` (item 55), `:116` (item 58, "fees disclosed and recorded apart from LP fees"), `:117` (item 60, timelock), table row `:156` (items 56/57/59/61: "fee payer n/a, launch fee 0, fee recipient n/a, free beta"); scope line `docs/unica-v4/SPEC-CONTRACTS.md:37` ("Not in scope. … Any UNICA fee (Q55–61)"); reaffirmed `docs/unica-v4/arc/NANOPAYMENTS.md:12` ("UNICA's own fee is fixed at 0 in the beta … project decision") — DESIGNED, NOT IMPLEMENTED (there is no contract to implement it in; it is a stated non-feature) |
| **Uniswap protocol fee — V1 pool** | `slot0.protocolFee`, a PoolManager-level switch, set by whoever the PoolManager owner names as controller | `StateView.getSlot0` | **0** — LIVE (V1 generation: IMPLEMENTED AND TESTED; the switch itself is Uniswap's) | on-chain read, chain id 11155111, same call as the LP-fee row above, `protocolFee` return value 0, read just now |
| **Uniswap protocol fee — V3 pool** | same switch | same call | **0** — LIVE (V3 generation: IMPLEMENTED AND TESTED; the switch itself is Uniswap's) | on-chain read, chain id 11155111, same call, `protocolFee` return value 0, read just now |
| **Uniswap protocol fee — experimental pool** | same switch, plus the controller that could change it | `StateView.getSlot0`; `PoolManager.protocolFeeController()` | fee **0**; controller **unset** (`address(0)`) — no address can currently call `setProtocolFee` on this PoolManager at all; the PoolManager's `owner()` is `0x9701fb0aDe1E269c8f64Ec0C7b3cfADB31A13A52` and could assign one | on-chain reads, chain id 46630, PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` (24,009 bytes deployed, confirmed live): `getSlot0` → `protocolFee 0`; `protocolFeeController()` → `0x0000000000000000000000000000000000000000`; `owner()` → `0x9701fb0aDe1E269c8f64Ec0C7b3cfADB31A13A52`; all read just now. Corroborates `docs/experimental/STOCK-46630-FEE-FIELD.md:26-27` (`protocolFeesAccrued` for TSLA is 0) — EXPERIMENTAL |
| **Uniswap protocol fee — UNICA v4 design** | the same switch, generalized into the receipt as `protocolFeePips`, read same-transaction so a mid-swap `setProtocolFee` can't be missed | `feeRates()` view; `protocolFeePips` field, `afterSwap` STATICCALL reads | test rows specify **0** default and two non-zero cases (500, 1000 pips) that must match `Swap.fee` exactly | `docs/unica-v4/SPEC-CONTRACTS.md:264` (`feeRates()`), `:455-457,464-468` (receipt fields and derivation), `:478-484` (rows H12a/b/c and their mutants) — DESIGNED, NOT IMPLEMENTED |
| **Token transfer fee — V1** | fee-on-transfer / rebasing refusal; V1's only input is native ETH (no transfer fee possible), so this checks the **output** leg | recipient balance measured before/after, compared to `minOut` | reverts `RecipientShort` if the merchant's balance grows by less than the signed minimum | error `src/SettlementExecutor.sol:106`, comment `:104-105`; test `test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer` at `test/SettlementExecutor.t.sol:281` — IMPLEMENTED AND TESTED |
| **Token transfer fee — V2** | same idea, both legs, since V2 accepts ERC-20 input too | balance-delta checks on both the merchant and the executor | reverts `MerchantNotPaidExactly` (output must match **exactly**, not just a floor) or `ExecutorHeldTheInput`/`ExecutorHeldTheOutput` (custody mismatch) | `src/v2/QuoteSettlementExecutor.sol:183-193` (comment "a hostile token cannot describe away"), reverts at `:189` and `:192` — IMPLEMENTED, but FROZEN/BLOCKED (Advisory 001, undeployed) |
| **Token transfer fee — experimental** | input-side only; asset leg is an ERC-20 (faucet TSLA) that can carry a transfer fee | pulled amount measured, compared to the order's `amountIn` | reverts `InputNotExact(expected, received)` | error `src/experimental/robinhood-testnet/UnicaStockSettlementErrors.sol:37`, check `src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol:175-179`; test `test_D1_a_fee_on_transfer_input_is_refused_by_the_executor` at `test/experimental/StockSettlement.t.sol:258-263` (a sabotage run confirmed deleting this check turns the suite green, per the comment at `:255-257`) — EXPERIMENTAL, tested within the experiment |
| **x402 / facilitator fee** | a fee a third-party x402 facilitator charges for `/verify` and `/settle`; x402 itself defines no fee model | not a UNICA contract concept at all: `grep -rn x402 src/ test/` matches nothing in either tree | **not applicable to any UNICA generation** — the only place x402 appears in this repo is Arc-integration research, and it names the fee "protocol-silent … commercial, set by the facilitator, not by x402 itself" | `docs/unica-v4/arc/NANOPAYMENTS.md:94` (fee-model row), `:98` (x402's spec defines no facilitator-fee model); scope: `docs/unica-v4/SPEC-CONTRACTS.md:37` excludes public payment links from v4, and `docs/unica-v4/DECISIONS.md:174` (item 128) defers the unnamed-payer flow x402 would need to **v5**, "behind a separate signed-intent security review that starts with Advisory 001" — DESIGNED, NOT IMPLEMENTED (and not designed for UNICA specifically; the research is protocol-facts-only, per that file's own scope line at `:3-7`) |

Note on the pool-fee rows: the three measured pools (V1, V3, experimental) all happen to sit at 3000
pips today, but that is a coincidence of what each deploy script chose, not a UNICA invariant — none
of V1, V3, or the experimental hook's `_beforeInitialize` restricts the fee tier (see the "Dynamic
pool fee" rows), so a fourth pool naming any of these hooks could open at 500, 10000, or a dynamic
fee with no code change and no revert.

## 7. Oracle placement

**Status: DESIGNED, NOT IMPLEMENTED.** `src/unica-v4/` does not exist in this checkout (checked directly: only `src/V4SettlementHook.sol`, `src/SettlementExecutor.sol`, `src/v2/`, `src/v3/`, `src/experimental/robinhood-testnet/`, `src/lab/`, `src/compat/`, `src/libraries/` are present, none of them UNICA v4). `test/unica-v4/`, `script/unica-v4/` and `config/chains/` also do not exist. Everything below is DESIGNED, NOT IMPLEMENTED, read from `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (SO) and `docs/unica-v4/SPEC-CONTRACTS.md` (SC), both of which state `docs/unica-v4/DECISIONS.md` (DE) wins on any disagreement (SO:4, SC:3-4). Where SO/SC state a value SPEC choices S1–S8 (DECISIONS.md, "Specification choices") supersede, the binding S-value is stated here; SO and SC were re-read 2026-09-11 (SO 582 lines, SC 572 lines).

**Why the split exists.** The hook calls the adapter by `STATICCALL` inside `afterSwap`, "so nothing between the pool's `slot0` read and the hook's can change a fee" (SO:64-66). A state-changing authentication step — Chainlink Data Streams' `verify` — is structurally barred from that call path and must land in its own prior transaction (SO:66, :320-321; SC:428). That constraint decides most placements below.

| # | Check | Performed by | Why there, not elsewhere |
|---|---|---|---|
| 1a | Oracle authentication — feed pinning | Adapter constructor (immutable `ASSET_FEED`/`QUOTE_FEED`, pinned `description()` hash, `decimals()` read at construction), re-checked on every `latestPrice()` | A proxy can be re-pointed; "a documented address is not proof of what sits behind it" (SO:252-253). Registry adds a one-time gate at `createMarket`: `adapter.code.length>0`, `adapter.feedIdFor(asset,payout)==feedId` (SO:99-100). |
| 1b | Oracle authentication — Streams report | Adapter's `submitReport`: separate, permissionless, state-changing call to `VERIFIER_PROXY.verify(...)`; the DON signature authenticates, not a role (SO:316-321) | Cannot run inside the hook's `STATICCALL`. Disabled today — no paid Data Streams subscription (Q95 NOT PROVIDED) and the 46630 digest is UNCONFIRMED (SO:304-307). |
| 1c | Oracle authentication — CRE forwarder | Adapter's `onReport`: `msg.sender==FORWARDER`, workflow id/owner match metadata (SO:353-354) | Same reasoning; also not deployable — workflow approval and hosted writes unproven (SO:343-345). |
| 1d | Oracle authentication — adapter identity, chain level | Chain helper `script/unica-v4/chain.sh` (to be written): `extcodehash` equality against `oracleAdapters`, refuses `adapterKind()==MOCK` | Off-chain gate before any script talks to a deployed adapter; "`adapterKind` is a label, not a defence" on its own (SO:71-72, :496-497). |
| 2 | Freshness | Hook (`afterSwap`/`_checkOracle`), reading `policy.maxAge` live from the registry every swap | `maxAge` is a per-market policy value, not a source property; only the hook holds `block.timestamp` at settlement (SO:137; SC:277-278). Registry hard-caps it at `MAX_ORACLE_AGE=300s` (S4, DECISIONS.md, "Specification choices"), a ceiling the contract enforces on-chain for every policy, including one ADMIN sets directly; a market may configure a stricter value. |
| 3 | Positive answer | Adapter (per underlying feed, e.g. `FeedAnswerNotPositive`, SO:254) **and** hook, on the adapter's combined return (`OraclePriceZero`, SC:277) | Adapter checks are source-specific (each leg of a cross-route); the hook's check is adapter-agnostic, re-validating whatever any adapter kind returns — defense in depth. |
| 4 | Decimal normalisation | Adapter cross-multiplies both legs to a canonical decimal count (SO:256-258); hook then folds the adapter's `(price,decimals)` against the market's own `ASSET_DECIMALS`/`PAYOUT_DECIMALS` for the deviation math (SC:279-281) | Only the adapter knows both feeds' native decimals and never assumes a stablecoin payout is $1 — it reads that leg's own feed too (SO:257). Only the hook holds the market's token decimals (constructor immutables from `createMarket`). One bound, both sides: `dO <= 18` (`OracleDecimalsUnsupported`), matching every specified adapter (feed constructor refuses above 18; the cross route and Streams return 18). Both range checks — `p <= type(uint128).max` and `p * 10**dP / 10**(dA + dO) <= type(uint128).max` — run before any multiplication, each refusing by name as `OraclePriceOutOfRange`. |
| 5 | Market hours | Adapter only, and only for a status-bearing source (Streams/CRE, `MarketClosed(status)` against `ALLOWED_STATUS_MASK`); hook maps that revert to computed `MARKET_CLOSED` | A push Data Feed "has no market-status field and publishes nothing off-hours" and "does not improvise a wall-clock calendar" (SO:286-287). `ChainlinkFeedAdapter` alone can never prove "equities settle only while the market is open" — it can only go stale (SO:288-291). No equity route is enabled today (Q20/Q23/Q95). |
| 6 | Pool-vs-oracle deviation | Hook (`afterSwap`/`_checkOracle`), using `policy.maxDeviationBps` read live from the registry, against the pool's own swap `delta` and the same `slot0` fee read the receipt uses | Only the hook sees the actual swap delta and fee tier at settlement (SO:144-186; SC:279-283). Registry stores the tighten-only bound, hard-capped at `MAX_DEVIATION_BPS=300` (3%, S4); a market may configure lower. `minAllowed <= o <= maxAllowed` is inclusive at both bounds (a tie passes); a refusal names its direction, `ExecutionBelowOracleBand` or `ExecutionAboveOracleBand`, not one undirected `PriceDeviation`. |
| 7 | Quote/order expiry | Executor (`createOrder`: `DeadlineInPast`, SC:338; `pay`: `OrderExpired`, SC:342), re-checked by the hook's `beforeSwap` (`OrderExpired`) | `deadline` is a payer-facing per-order term owned by the order object, not a market-wide oracle parameter; the hook's second check is belt-and-suspenders inside the same atomic swap. |
| 8 | Minimum output | Hook (`afterSwap`: `produced>=minOut` else `OutputBelowMinimum`) **and** executor (`pay`: recipient's measured balance delta `>=minOut` else `RecipientShort`) — checked twice by design (SC:379) | The hook validates the pool's reported delta; the executor validates the recipient's actual observed balance change, closing the gap a fee-on-transfer or rebasing payout token would open (SC:347-348, :352-353). `minOut` is the payer's own protection against fee and price impact, distinct from the oracle band (SO:174). |

**Route binding (S8).** The owner rejected binding an oracle route by off-chain readback alone (DECISIONS.md, "Specification choices", S8): the deployed market is bound on-chain to an immutable adapter and an immutable route identifier, and settlement obtains authenticated data for exactly that route. `marketId` includes the policy's adapter and feedId (`keccak256(abi.encode(block.chainid, registry, asset, payout, version, policy.adapter, policy.feedId))`), so the hook's CREATE2 address itself commits to the route; `register` additionally requires `IUnicaOracleRoute(adapter).feedIdFor(asset, payout) == policy.feedId`, else `OracleFeedMismatch(marketId, expected, actual)`; and `_checkOracle` repeats that same check by STATICCALL before every `latestPrice` read. Only single-route adapters ship in this release (one instance per route, constructor immutables, and no admin beyond the optional quote-freshness operator the later O2 ruling added, which may only tighten the quote leg and is itself inside `feedIdFor`), so a route cannot vary out from under a market between `register` and any later swap. Off-chain pre-flight and readback stay additional evidence, never the sole control. DESIGNED, NOT IMPLEMENTED — no contract exists yet to hold `feedIdFor` or the per-swap re-check.

**No admin can supply a typed-in price.** Adapters are "one instance per route, no admin. Constructor immutables only: no owner, setter, pause or upgrade" (SO:67-68) — amended by the O2 ruling of 2026-09-12 to allow one optional operator who may only LOWER the quote leg's staleness bound, which refuses more readings and can never supply, raise or invent a price; the interface doc comment requires an adapter to "revert with a named error when the pair is unpriceable" and forbids returning "a zero, a placeholder, a cached fallback or a demonstration rate" (SO:51-52). `MockOracleAdapter` is the only settable price source; it lives outside `src/` under `test/unica-v4/mocks/`, `adapterKind()==MOCK` is refused by the chain helper and "a gate row fails if any file under `script/unica-v4/` imports from `test/`" (SO:363-364). The registry's ADMIN role explicitly can never "change a market's tokens, rate, opening price, fee, spacing, hook, executor, oracle adapter or feed; loosen an oracle policy or a cap" (SC:99). The ledger states settlement "fails closed; there is no demonstration-rate fallback... No feed address is ever invented" (DE:15-17). A market with no enabled oracle policy is not a hidden default price — it is flagged `demonstrationOnly=true` on-chain, zeros every reference-price receipt field (SO:220-222; SC:459), and is displayed as "Demonstration rate — no oracle", never a market price (SO:532).

**Changing an adapter, or its economic meaning, requires a new market version (U5).** "Oracle adapters are not proxy-upgradeable. Tightening an existing safety parameter is permitted only where the contract explicitly bounds it. Replacing an adapter or changing oracle semantics requires retiring the market and creating a new version" (DE:187, decision U5). This is structural, not procedural: `adapter`, `feedId` and `enabled` "have no setter: loosening, a new adapter or feed, or switching the oracle off or on means RETIRE and a new market version with a new `marketId`" (SO:111-113); only `maxAge` and `maxDeviationBps` carry a setter, and only in the tightening direction (SC:153). RETIRED is terminal — "a pair may later get a new versioned market id; the retired record and its history stay discoverable" forever (DE:49, decision 112).

## 8. Bounded configuration matrix

**Status: DESIGNED, NOT IMPLEMENTED** (`src/unica-v4/` absent; checked directly). Citations: SC = `docs/unica-v4/SPEC-CONTRACTS.md`, SO = `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md`, DE = `docs/unica-v4/DECISIONS.md`.

**Tightening, defined.** Lower per-tx cap, lower daily cap, shorter quote/order lifetime, lower max oracle age, lower max deviation — all on-chain tightenings: bounded, evented, and never altering an already-settled receipt (S3, S4). The $100 cross-market total (Q5) is a deployment-script and manifest refusal, never an on-chain field, so it is never counted among the on-chain tightenings above (S5; see the "Total at risk" row in Group 3). Adding a merchant/order-creator expands authority and is not a tightening. Raising any cap is never a tightening and is not permitted on a live market at all: "Caps are tighten-only on a live market, like the oracle policy; raising one needs RETIRE and a new version" (S3; SC §15). Payout token, PoolManager, and oracle source (adapter/feed) changes are forbidden outright for an existing market (Group 1 below; DE:183-187, U1/U2/U5).

### Group 1 — Immutable market identity (write-once at `register`, no setter, ever)

| Field(s) | Authority | Direction | Hard limit | Event | Monitoring | Recovery |
|---|---|---|---|---|---|---|
| `asset`, `payout`, `version`, `hook`, `executor`, `poolId`/PoolKey, `fee`/`tickSpacing`, decimals, `assetIsCurrency0`, `rateE18`/`initSqrtPriceX96`/`initTick`, oracle `adapter`/`feedId`/`enabled`, `maxSeedPayout` | FACTORY, once, via `registry.register` (SC §6) | None — forbidden; RETIRE + new version only (DE:183-187) | Fee tier ∈ {(500,10),(3000,60),(10000,200)}, no other pair, recorded in configuration and manifest (S1); decimals ≤18; `0<rateE18≤1e36` (SC §7) | `MarketProposed(...)` with the full record (SC §6) | Watch `MarketProposed`; anyone can recompute the CREATE2 hook address off-chain to confirm identity; `register` additionally requires `IUnicaOracleRoute(adapter).feedIdFor(asset,payout)==feedId` on-chain, else `OracleFeedMismatch` (S8) | None on-chain; a wrong value means RETIRE (from any pre-RETIRED state, SC §5) and redeploy as a new version |
| `tickLower`, `tickUpper` — the seed range | FACTORY, once, from `UnicaMarketMath.seedWidth(tickSpacing, policy)` at seed time; recorded in the market configuration and the manifest (S6) | None — no on-chain path adds liquidity to a market at or after SEEDED; a live market is never reseeded, widened or recentred | Readback asserts the seed position's ticks and the on-chain recomputation both equal the recorded range | `MarketSeeded(marketId, depthAtOpeningTick)`; the range itself is derived from `initTick`, `tickSpacing` and the policy, not separately logged | A pool tick outside the recorded range, or a positive `ModifyLiquidity` on a live market pool, are watcher-alert classes (S6) | Leaving the range or exhausting seed capacity: pause, then ADMIN retires and a new version is listed after review; unpausing into an exited range is not a remedy |
| `PoolManager` address, `HOOK_CREATION_CODE_HASH` | Factory constructor immutables, set once at factory deployment from `config/chains/<id>.json` and the build (SC §7) | None — fixed for the factory's whole life | `createMarket` refuses non-matching code (`WrongHookCode`, SC §7); hash depends on compiler/optimizer/metadata (SC §12) | none (constructor argument, not stored mutable state) | pin via `forge --version` + explicit `optimizer=false`, tag source before deployment (SC §12) | none needed — a wrong hash just makes `createMarket` permanently refuse, before any funds are at risk |
| `REQUIRE_ORACLE` | Registry constructor immutable, from `requireOracle_` (SC §6) | None post-construction | Chain helper refuses `requireOracle=false` on any file whose `network=="mainnet"` (SO §12.2) | none | the chain helper's invariant check on every script run | none — a new registry (Group 5) if wrong |

### Group 2 — Bounded on-chain operational settings

| Field | Authority | Direction | Hard limit | Event | Monitoring | Recovery |
|---|---|---|---|---|---|---|
| `maxAge` | ADMIN, `tightenOraclePolicy` (SC §6) | Tighten-only, `0<new≤current`, at least one of `maxAge`/`maxDeviationBps` strictly lower (SO §3) | Ceiling `MAX_ORACLE_AGE=300s` (S4), fixed at registry construction and enforced on-chain for every policy, including one ADMIN sets directly; a market may configure a stricter value | `OraclePolicySet(marketId, adapter, feedId, maxAge, maxDeviationBps, enabled)` — the full policy after the change — at register and at every tighten (SC §6, SO §3); `OraclePolicyTightened` does not exist | Re-verify feed cadence (SO §11) supports the new value before tightening; watch for a spike in `OracleStale` after | **Over-tightened below real cadence → every swap reverts `OracleStale`, permanently** (can't be raised back, tighten-only); only recovery is RETIRE + new version at a looser value |
| `maxDeviationBps` | ADMIN, `tightenOraclePolicy` (SC §6) | Tighten-only, `0<new≤current` | Ceiling `MAX_DEVIATION_BPS=300` (3%, S4), fixed at registry construction; a market may configure lower | `OraclePolicySet`, the same event and the same row as `maxAge` above — one full-policy event, not a separate tighten-only log | Watch `ExecutionBelowOracleBand`/`ExecutionAboveOracleBand` rate after a tighten (no separate undirected `PriceDeviation` error exists); re-check estimated per-tx price impact vs. the new bound (SC §8.3, SO §16 open issue 12) | **Over-tightened below the pool's actual per-payment impact → market "stops until relisted" the moment the band is breached, by design** (SC §8.2); cannot be loosened back |
| `maxPerTxPayout`, `maxPerDayPayout` | ADMIN, `tightenCaps` (SC §6) | Tighten-only, `0<new≤current` for both, `maxPerTx≤maxPerDay`, at least one strictly lower (S3) | No setter raises either value on a live market; raising either requires RETIRE and a new version (S3). `maxSeedPayout` has no setter at all — it is Group 1, write-once | `CapsSet(marketId, maxPerTx, maxPerDay, maxSeed)`, full values, at register and every tighten (SC §6) | Check no open order's `minOut` exceeds the new cap before tightening | **Tightened below an open order's floor → that order "is unpayable, which fails closed and traps nothing"** (SC §9.1) — no funds lost, but the order is stranded until it expires (no deadline ceiling, SC §9.1) or the market is retired |
| Lifecycle status (ACTIVE↔PAUSED, →RETIRED) | ADMIN or PAUSER may pause; only ADMIN may unpause or retire (S2; SC §5) | Fixed DAG only; any other pair reverts `WrongMarketStatus`/`UnknownMarket` (SC §5) | RETIRE is terminal from any pre-RETIRED state, never reversible (SC §5, DE:49) | `MarketStatusChanged(id, from, to)` on every transition, None→PROPOSED included (SC §6) | "an event watcher and explorer alerts" (DE:165, decision 92) — DESIGNED, NOT IMPLEMENTED: no watcher exists in this tree | Unpause reverses a pause (ADMIN only, after Safe review per U8, DE:190); RETIRE has no recovery — it is itself the recovery mechanism for every other row here |
| `isOrderCreator[address]` | ADMIN, `setOrderCreator` (SC §6) | Bidirectional: adding expands authority (not a tightening); removing is a tightening | `a != 0` (SC §6) | `OrderCreatorSet(address,bool)` (SC §6) | Watch additions closely — privilege expansion, not removal, is the risk | Removing is intentional DoS on that creator's future orders only; existing open orders they created remain payable by their bound payer (gating is per-market status, not per-creator, SC §5) |
| `pauser` | ADMIN, `setPauser` (SC §6) | Bidirectional, `p` any address, zero disables (SC §6) | None | `PauserSet(previous,next)` (SC §6) | Watch every `PauserSet`; setting to zero removes the emergency-pause capability entirely | ADMIN can set a new pauser at will — trivial to reverse, but the gap while unset is a monitoring-critical loosening of the safety net, not a tightening |
| `admin`/`pendingAdmin` | Current ADMIN initiates `transferAdmin`; `pendingAdmin` completes via `acceptAdmin` (SC §6) | One-directional two-step handoff; "no renounce exists" (SC §4, §6) | `next != 0` (SC §6) | `AdminTransferStarted`, `AdminTransferred` (SC §6) | Watch `AdminTransferStarted` immediately — "the old admin keeps every power until acceptance and loses all after" (SC §4) | None if the key is lost — no renounce, no fallback path; the mainnet Safe itself is **NOT READY** until "the Safe's chain, address, signers, threshold and hardware-wallet control are verified, and a test transaction has executed" (DE:157, Q64) |

### Group 3 — Off-chain pinned configuration (no on-chain role at all)

| Field(s) | Authority | Direction | Hard limit | Event / record | Monitoring | Recovery |
|---|---|---|---|---|---|---|
| `config/chains/<id>.json`: `enabled`, `requireOracle`, `rpcEnv`, `oracleAdapters`, `admin.safe`, sequencer feed/`gracePeriodSeconds`, `streams.enabled`, `cre.enabled`, token registrations | A reviewed commit; "off-chain components may change through reviewed commits. They must never alter the immutable identity or settlement rules of an existing on-chain market" (DE:191, U9) | Tightening (disable a chain, require a sequencer check, lower a proposed `maxAge`) is unrestricted; loosening (e.g. `requireOracle:false` on a mainnet file) is refused by the helper's own invariants (SO:498-500) | Offline self-test refuses disabled chain, id mismatch, unset `rpcEnv`, `null` required address, bad `source` prefix, mainnet without `requireOracle`, L2 mainnet without a sequencer feed, a MOCK adapter (SO:508-512) | No event — a config file has no transaction | The chain helper's live probe (address code, `typeAndVersion`, `extcodehash`) runs at every script invocation (SO:496-497) | Revert the commit; nothing on-chain to undo, since these values are only ever consumed as constructor arguments at deploy time |
| Per-adapter feed description hash / decimals, sourced from "recorded live reads" (SO:242) | Whoever writes the adapter deployment | Fixed at adapter deployment, no setter ever | Constructor refuses >18 decimals (`FeedDecimalsUnsupported`) and requires non-empty code (SO §7.1) | `QuoteMaxAgeTightened(previous, next)` only, from the optional quote-freshness lever the O2 ruling added; otherwise "no admin, no setters, routes fixed in the constructor" (SC:418-419) | The adapter's own re-check on every `latestPrice()` call (`FeedDescriptionChanged`, `FeedDecimalsChanged`) is the runtime monitor | A changed real-world feed permanently reverts that adapter — RETIRE and a new adapter/market version (U5) |
| `maxAge` choice, sourced from `script/unica-v4/feed-cadence.sh` measurements (to be written) (SO:378-380) | Owner, from committed read-only measurement | Re-measure and potentially lower before each new market; never loosens an already-set on-chain value by itself | Crypto ≤300s "or lower"; above 300 needs "a written owner amendment of Q25" (SO:389-390) | none — an evidence file, not a transaction | Re-measure before every new market; record the file in the manifest (SO:400-401) | Advisory input to a human decision, not itself binding state |
| "Total at risk" cap (the $100 figure, Q5) — a deployment-script and manifest refusal, never an on-chain invariant (S5) | Deployment script, before every `createMarket` and again before every `activate`: enumerates the registry via `marketCount()`/`getMarkets(offset,100)` to the end, requires the paged total to equal `marketCount()` and every `statusOf`/`capsOf` read to succeed, then sums `maxSeedPayout` over every non-RETIRED market plus the proposed one | Not an on-chain field at all — no registry-wide accounting exists in this release (SC §7) | Refuses above 100000000 raw of the configured 6-decimal payout; any RPC error, short page, count mismatch, or a non-RETIRED market whose payout token differs from the chain file's configured payout fails closed (S5) | none on-chain — the manifest records the enumerated ids, the block read, and the sum | script-level pre-flight check before every `createMarket` and every `activate` | Adjust the script's aggregate policy; no on-chain state to recover; an unenumerable or unverifiable market set fails closed rather than proceeding |

### Group 4 — External contracts we do not control

| Contract | Authority | Direction | UNICA-side limit / detection | Monitoring | Recovery |
|---|---|---|---|---|---|
| Uniswap v4 PoolManager | Its own owner | "the PoolManager owner, who can set a protocol fee at any time" (SC:111) | The receipt always reads `protocolFeePips`/`swapFeePips` live from the same transaction's `slot0`, never a cached constant (SC §11) | Required, continuous per U7: the implementation is "pinned in reviewed chain configuration... monitored and alert the operator automatically" (DE:189) — DESIGNED, NOT IMPLEMENTED: no monitor or alerting exists in this tree (§9.5); by design the alert would be automatic and the pause a manual PAUSER action, never automated | PAUSE (manual, by PAUSER) → Safe review → resume only after "a new, independently verified configuration" (DE:189) |
| LP / PositionManager NFT holder | Whoever holds the position | Can withdraw liquidity at will, "subject to the issuer's own pause" (SC:112, :133) | None imposed — "Liquidity is never gated (no liquidity flags), so the LP can always exit" (SC:132-133) | Seed depth is checked once at `markSeeded`; "SEEDED is point-in-time, so a withdrawn seed makes settlement fail safe until someone pauses" (SC:226-227) | Manual pause if depth is pulled — fail-safe stops swaps, does not make anyone whole |
| Chainlink feed proxies | Chainlink / the feed's own admin | Can repoint the implementation behind the proxy at any time (the U7 external-proxy risk, DE:189) | Adapter constructor pins expected `description()` hash and `decimals()`; a repoint changing either is caught, not prevented (SO §7.2) | The adapter's own live re-check on every call is the monitor (SO:252-253), plus the chain helper's offline `extcodehash` check | Disable the route / pause affected markets, Safe review, per U7 |
| Chainlink VerifierProxy / KeystoneForwarder | Chainlink-operated infrastructure | Controls fee-manager settings, forwarder registration | Adapter checks `s_feeManager()==0` (`VerifierFeeManagerSet` if ever turned on, SO:318-319); forwarder refused by address per chain, including the known simulation forwarder (SO §9) | Re-checked on every `submitReport`/`onReport` call | Set `streams.enabled:false`/`cre.enabled:false` in the chain file; route stays disabled |
| Stock-token issuer / beacon owner | The token issuer | "can upgrade or pause it" (SC:112) | Adapter detects an issuer pause via `oraclePaused()`, refuses with `OraclePausedByIssuer` (SO:279-280) | Checked live on every `latestPrice()` for that adapter kind | By design every settlement on that market reverts (computed STALE_ORACLE condition, fail-closed) — a synchronous revert, not a pause transaction; a permanent freeze needs RETIRE + new version |
| Payout-token minter/issuer (e.g. mainnet USDC's issuer; the 46630 uTUSD minter) | The token's own contract, entirely outside UNICA | Unbounded from UNICA's side | Executor refuses non-exact transfer amounts (`InputNotExact`), rejecting fee-on-transfer/rebasing input; measures balances before and after every step (SC:347-348, :352-353) | Executor's residual-balance checks (`ExecutorResidualInput`/`ExecutorResidualPayout`) run every payment | A compromised payout token fails closed on that payment; a structural break requires RETIRE + new version on a different payout token — changing the payout token on an existing market is otherwise forbidden (Group 1) |

### Group 5 — New-version deployment and migration

| Action | Authority | Direction | Hard limit | Event | Monitoring | Recovery |
|---|---|---|---|---|---|---|
| RETIRE | ADMIN only, `registry.retire` (SC:99, :127) | One-way, terminal, from any pre-RETIRED state | "status is not None or RETIRED" (SC:127) | `MarketStatusChanged(id, from, RETIRED)` (SC:175-176) | Clears `liveMarketOf[asset][payout]` so a new version can register (SC:127, :155) | None — RETIRE is itself the recovery for every over-tightened or compromised row above (U1, DE:183) |
| New version registration | ADMIN, `factory.createMarket` with `version==latestVersion+1` (SC:121, :165) | Forward-only counter, never reused | "One non-retired market per (asset, payout)": needs `liveMarketOf==0`, true only once the prior version is RETIRED (SC:73-74) | `MarketProposed` for the new market (SC:172-174) | Re-point indexers/dashboards to the new `marketId`; the retired record "stay[s] discoverable forever" (SC:75, DE:49) | n/a — this is itself the recovery mechanism |
| New factory / registry generation | Owner decision — a new factory "ships as a separately identified UNICA release with a new manifest" (DE:186, U4); the registry "is not proxy-upgradeable. Only explicitly bounded registry data may change, through defined roles" (DE:185, U3) | Entirely new deployment; no migration path for existing markets' storage | Any upgradeability proposal at all needs "a new owner decision, a threat model, an independent review and a public notice policy" (DE:188, U6) | A new entry in a future `deployments/unica-v4/<chainId>.json` manifest (pattern per SO §12.1; not yet written) | The manifest is the source of truth for "official" (SC §3) | n/a |

**Note on "a market stops as it settles."** Both the oracle-band and the seed-cap rows above converge on one owner-confirmed consequence: "a market stops, until relisted as a new version, whenever its oracle leaves the band or its seed is sold through" (SC:569-570) — meaning a market's own successful operation is itself a bounded, exhaustible resource, and every tightening on this page shortens that resource further. Every tightening in Groups 2 and 3 above still requires its bound, its event, and — per U7/U8/U9 (DE:188-191) — a human decision to reverse it, never an automatic unpause or automatic loosening.

## 9. EXTERNAL PROXY AND BEACON MONITORING

### 9.1 Fresh on-chain reads — Arc testnet, chain id 5042002

Rows below were read via the keyless public endpoint named in Arc's own docs
(`https://rpc.testnet.arc.io`, `docs.arc.io/arc/references/connect-to-arc.md`). `eth_chainId` →
`5042002`; block at read time `61617943`, re-read 2026-09-11 at block `61621815` (every value
reproduced except the "cirBTC" implementation code hash, corrected below — it had been recorded as
the proxy's own hash). Pattern and zOS slot constants cross-check against `test/fork/ForkPin.sol:66-74`
(Sepolia USDC, same zOS pattern, same `org.zeppelinos.proxy.implementation` slot value). Label for
every row in 9.1 and 9.2: **LAB ONLY** — external contracts read for evidence; no committed check
enforces any of these values. `implementation()` and `admin()` are callable from any address on all
three proxies and equal the zOS slot contents.

| Token | Address | Proxy type (on-chain read) | `implementation()` | `admin()` | Proxy runtime | Impl. code hash |
|---|---|---|---|---|---|---|
| USDC | `0x3600000000000000000000000000000000000000` | zOS `AdminUpgradeabilityProxy` — EIP-1967 slots read `0x0`, `org.zeppelinos.proxy.implementation`/`.admin` slots hold the values at right | `0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6` | `0x49f78af090F1f98e7184B7f61f1F1a8a8064b40d` | 1798 bytes | codehash `0x237a5899a4c4e1c8b60fe7626371778ce8ef0a554350cd92cdf8ae393f59966f` (LAB ONLY — cross-chain comparison only, no threshold enforced here) |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | zOS `AdminUpgradeabilityProxy`, own independent admin/impl (not shared with USDC) | `0xECA045ED98a6D70887d2050F3BE1Fb0F0311017c` | `0x667B894BcC6899F5dF1EBA73c006b94c661A2d95` | 1798 bytes | codehash `0x0d42c7ffcaa343c99a8172b6ebd9c0eeafdf29df33d68bccb22292df7d3fe177` (LAB ONLY) |
| cirBTC (Circle-listed, see below) | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | Also a zOS-pattern proxy (fresh finding — not the plain ERC-20 §5 of `docs/unica-v4/arc/TOKENS.md` implies) | `0x1D78868e73cAC95BA7036Eb3A0CCb13b88EDEb23` | `0xE1A6aEE7d850fa9C065830C964F843c309e1d335` | **1496 bytes** — different size from USDC/EURC's 1798, so not the same proxy build; proxy codehash `0x0833ebf26b18ab2caebefb078a62c34ba84c7e89e72a73986dbce75e8b08ad87` | implementation (18190 bytes) codehash `0x3895c88f0f828a15c13027ec8d74ae4999309b77d5ea04e7e70a124052dec355` (LAB ONLY) |

`decimals()`/`symbol()`/`name()`: USDC 6/`"USDC"`/`"USDC"`; EURC 6/`"EURC"`/`"EURC"`; the `0xf0C4…`
token 8/`"cirBTC"`/`"Circle Wrapped Bitcoin"`. `paused()` on all three: `false`. The `0xf0C4…`
token's `owner()` (a separate role, not the zOS admin) is `0xf2e323A5F154D4FeD1D6be14c75A130fDa540bd5`.

**The "cirBTC" address is Circle's.** `docs/unica-v4/arc/TOKENS.md` §5 (lines 151-228; this address
at :191) lists it as one of four self-labeled "cirBTC" tokens, verdict "UNKNOWN issuer", ruling
"cirBTC's exact Arc-testnet contract address is UNKNOWN" (TOKENS.md:204). That ruling is stale:
Circle's own per-asset page, `developers.circle.com/assets/cirbtc-contract-addresses` (fetched
2026-09-11), lists Arc Testnet cirBTC at `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` ("no
financial value, and are not backed by real Bitcoin"). `docs/feedback/arc.md:48-79` (commit
`0314918`, 2026-09-11) records the same match plus a Blockscout-verified Circle `FiatTokenProxy`
source whose deployed bytecode matches the 1,496-byte runtime read in 9.1;
`docs.arc.io/arc/references/contract-addresses.md` still omits cirBTC (`docs/feedback/arc.md:81-91`),
which is why TOKENS.md missed it. Label: **LAB ONLY** for the reads; **DESIGNED, NOT IMPLEMENTED**
for any use — no UNICA config or code references this address, and `TOKENS.md` §5/§9 should be
updated before any pre-flight relies on it. USDC and EURC are confirmed via the same Arc
contract-addresses page, testnet-only, no realizable value.

### 9.2 Fresh on-chain reads — Robinhood testnet, chain id 46630

Read via the `robinhood_testnet` foundry alias (URL not printed, per rule). `eth_chainId` →
`46630`; block at read time `117655854`.

| Token | Address | `decimals()` | `symbol()` | Beacon slot (EIP-1967 `eip1967.proxy.beacon`) | Proxy code hash |
|---|---|---|---|---|---|
| TSLA | `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` | 18 | `TSLA` | `0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5` | codehash `0x2f367e6a678e7b30ab613d5963e541e6f4d3ca586de76e2f441fbfeb1a27c440` |
| NFLX | `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93` | 18 | `NFLX` | `0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5` (same) | same codehash as TSLA row above |
| AMD | `0x71178BAc73cBeb415514eB542a8995b82669778d` | 18 | `AMD` | `0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5` (same) | same codehash |
| AMZN | `0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02` | 18 | `AMZN` | `0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5` (same) | same codehash |
| PLTR | `0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0` | 18 | `PLTR` | `0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5` (same) | same codehash |

**Fresh finding, wider than what is committed.** `docs/unica-v4/evidence/DESIGN-REVIEW.md:293`
(finding 8) scouted only that TSLA and NFLX share one beacon. The 2026-09-11 read shows **all
five** named tokens — TSLA, NFLX, AMD, AMZN, PLTR — share the identical beacon address and identical
proxy runtime bytecode (283 bytes each, one codehash). A beacon-only check cannot distinguish any
of these five from each other, nor from any other token the same faucet issues behind that beacon.

Beacon `0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5`: `implementation()` →
`0xBd14156E05c6AF28ad39aA53a2AB8eB9CDf657DA`; `owner()` reverts (no readable owner/admin role by
that selector); runtime 2332 bytes, beacon codehash `0x404e8188c4b1d0c9804205e0da253d11570e9d48d03964962cb689072b1735d2`.
Implementation contract 10992 bytes, implementation codehash `0x137f26aacb7b1675d89017cebbf5018515c7bf4b87ae1848984494a56f3e1912`. On TSLA:
`paused()` → `false`; `uiMultiplier()` → `1000000000000000000` (1e18).

**This matches, and refreshes, a fingerprint already on file.** `DESIGN-REVIEW.md:248` (finding 7)
records a prior TSLA-beacon fingerprint — `implementation=0xbd14156e…`,
`implementation_codehash=0x137f26aa…`, `paused=false`, `uiMultiplier=1e18` — explicitly "recorded
separately from this repository", i.e. not in a committed file. The 2026-09-11 read reproduces
every one of those four values exactly. Label: **LAB ONLY** — real and reproducible, but outside
`src/`/`test/` and not enforced by any committed check. All five tokens are faucet-issued testnet
instruments; `docs/chains/ROBINHOOD.md` (read 2026-09-10, lines ~30-51) already states they are not
to be called shares or securities — still true, no value.

### 9.3 Pinning

**DESIGNED, NOT IMPLEMENTED** for UNICA v4: `docs/unica-v4/DECISIONS.md:189` (U7) — "The
implementation behind every supported external proxy or beacon is pinned in reviewed chain
configuration" — never in settlement source. No `src/unica-v4/` directory exists (checked: only
`compat/`, `experimental/`, `lab/`, `libraries/`, `v2/`, `v3/`, plus the top-level V1 files), so U7
has no contract to pin inside yet. The one deployment that pins anything today is the
**EXPERIMENTAL** 46630 script: `script/experimental/StockSettlement46630.s.sol:430-448`
(`_chainRows`) pins `block.chainid == 46630` and the PoolManager's exact runtime byte count as
literals in the script, and `:451-457` (`_payoutRows`) pins the payout token's decimals and minter
— chain configuration inside the deploy script, not inside `UnicaStockSettlementHook.sol` or
`UnicaStockSettlementExecutor.sol` (settlement source proper), consistent with U7's "never in
settlement source." **EXPERIMENTAL, fork-tested**: `test/fork/StockSettlement46630Fork.t.sol:74`
(`test_F0_control_the_eleven_transactions_settle_a_TSLA_payment`) exercises those rows on a fork
and passes; that suite is fork-only, and its `onFork` modifier calls `vm.skip(true)` when no 46630
fork is configured (`:49-52`), so an offline gate run reports it skipped, not passed. **DESIGNED,
NOT IMPLEMENTED**: nothing in that script pins the TSLA/NFLX/AMD/AMZN/PLTR beacon's
`implementation()` or its code hash — confirmed by grep for `BEACON`/`Beacon` across
`script/experimental/StockSettlement46630.s.sol` and all three 46630 test files: zero hits. The name
`EXPECT_ASSET_BEACON`, cited in `DESIGN-REVIEW.md:248` and `:293` as what a pre-flight check would
be called, exists only in that review document's own prose — grep for `EXPECT_ASSET` across `src/`,
`script/`, `test/` returns nothing outside `docs/` (DESIGN-REVIEW.md, and the untracked
`docs/unica-v4/DEPLOYMENT-GATES.md:204`, which lists
`EXPECT_ASSET_IMPLEMENTATION`/`EXPECT_ASSET_IMPL_CODEHASH` as "pending"). A recommendation, not a
check on file.

### 9.4 Pre-flight (per DECISIONS U7 design intent)

**DESIGNED, NOT IMPLEMENTED** for UNICA v4 (no `src/unica-v4/` pre-flight exists to run). The shape
follows the pattern this repo already runs elsewhere and DECISIONS.md's own U7 language:

1. Read the configured address from reviewed chain config (never a literal in settlement source).
2. `code.length > 0` at that address.
3. `block.chainid` equals the expected chain id.
4. `decimals()` (and `symbol()` where available) match the configured value.
5. Detect proxy pattern by reading **both** the EIP-1967 slots and the legacy zOS
   (`org.zeppelinos.proxy.*`) slots — never assume one convention. **IMPLEMENTED AND TESTED**
   precedent already exists for Sepolia USDC: `test/fork/DependencyProvenance.t.sol:84-91` asserts
   the EIP-1967 slot reads zero and the zOS slot holds the real implementation; the Arc reads (9.1)
   reproduce the same pattern on USDC, EURC, and the `0xf0C4…` candidate alike. For a beacon proxy
   (Robinhood 46630), read the EIP-1967 beacon slot then call `implementation()` on the beacon, as
   done in §9.2.
6. Compare `implementation()`/beacon-`implementation()` and its `extcodehash` against the pinned
   values from step 1; refuse (revert, named error, no partial state) on any mismatch.

**EXPERIMENTAL, fork-tested** today, narrowly: the 46630 script's chain-id/code-exists/decimals
rows (§9.3, `StockSettlement46630Fork.t.sol:74`). Missing everywhere, including there: step 6 — no
committed pre-flight anywhere in this tree compares a read implementation address or code hash
against a pinned value and refuses on mismatch. `DESIGN-REVIEW.md:293` (finding 8) already flags
that a beacon-address check alone "cannot even tell TSLA from NFLX" since they share a beacon — the
2026-09-11 read (§9.2) shows that gap now spans five tokens, not two, and its own fix (pin the
asset's own address, not just its beacon) is **DESIGNED, NOT IMPLEMENTED**.

### 9.5 Runtime monitoring

**DESIGNED, NOT IMPLEMENTED**, per `DECISIONS.md:189-190` (U7, U8):

- Detect: a change in `implementation()`/beacon-`implementation()`, `admin()`, `paused()`, or the
  target's `extcodehash`, versus the pinned configuration (§9.3), on every relevant read (ideally
  every block or every settlement attempt, whichever is more frequent).
- Alert the operator on any detected change; treat the affected market as **unsafe** immediately —
  do not wait for a failed settlement to discover it.
- Pause: **U8** names the pauser role as instant-pause, human-authorized (S2). No file in this
  repository sends a pause transaction, automated or otherwise, against any of these tokens or any
  UNICA v4 contract (none exists to pause). The one automation that reads chain state and proposes
  a write in this codebase — `integrations/chainlink-cre-guardian/workflow/guardian.ts:381-396` —
  proposes an ERC-20 `transfer` to a configured merchant, never a pause call, and per
  `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md:7-9`, that workflow is **EXPERIMENTAL,
  simulator-only**: "Not accepted, not enabled, not deployed... makes [no] chain write." The PAUSER
  pauses, human-authorized in every case that exists today; no implemented, tested automation
  anywhere in this tree sends a pause transaction.
- Reopening: `DECISIONS.md:189` — Safe review and a newly, independently verified configuration
  before unpause, by ADMIN only (S2); `:190` (U8) — terminal RETIRE by the Safe, no hot-patching, if
  semantics changed (e.g. a beacon implementation swap that adds a fee or freezes transfers) rather
  than a like-for-like restore.

### 9.6 Summary — what exists versus what is designed

| Capability | Status |
|---|---|
| Dual-slot (EIP-1967 + zOS) proxy detection method | **IMPLEMENTED AND TESTED** — `test_ForkA_USDCIsAProxyAtANonEIP1967Slot`, `test/fork/DependencyProvenance.t.sol:84-91` (Sepolia USDC; a fork test that needs a Sepolia endpoint, `test/fork/ForkPin.sol:98-100`); reproduced fresh today on Arc (§9.1) |
| 46630 pre-flight: chain id, PoolManager byte count, payout decimals/minter | **EXPERIMENTAL, fork-tested** (skipped without a fork) — `script/experimental/StockSettlement46630.s.sol:430-457`, `test/fork/StockSettlement46630Fork.t.sol:74` |
| TSLA beacon fingerprint (`implementation`, code hash, `paused`, `uiMultiplier`) | **LAB ONLY** — real, reproduced fresh today (§9.2), not in a committed file |
| `EXPECT_ASSET_BEACON` / asset-address pinning pre-flight | **DESIGNED, NOT IMPLEMENTED** — name appears only in `DESIGN-REVIEW.md:248,293`; zero code hits |
| UNICA v4 pre-flight and runtime monitoring (U7) | **DESIGNED, NOT IMPLEMENTED** — no `src/unica-v4/` exists |
| Automated pause transaction | **DESIGNED, NOT IMPLEMENTED** — CRE guardian workflow is EXPERIMENTAL/simulator-only and proposes transfers, not pauses |

## 10. Hook-Permission Verification

### 10.1 Declared permissions, per hook

Uniswap v4's `Hooks` library defines 14 permission flags as bit positions on the hook's own address (`lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol:27-47`); `ALL_HOOK_MASK = (1<<14)-1 = 0x3FFF`. Each row below is `getHookPermissions()` read from source, converted to the 14-bit value by hand from the same flag constants.

| Hook | Classification | `getHookPermissions` | Flags set | Computed mask |
|---|---|---|---|---|
| `V4SettlementHook` (V1) | IMPLEMENTED AND TESTED — live Sepolia | `src/V4SettlementHook.sol:126-143` | beforeInitialize, beforeSwap, afterSwap | `0x20C0` |
| `UnicaHookV3` (V3) | IMPLEMENTED AND TESTED — live on 4 testnets | `src/v3/UnicaHookV3.sol:149-166` | beforeInitialize, beforeSwap, afterSwap | `0x20C0` |
| `QuoteSettlementHook` (V2) | FROZEN/BLOCKED — Advisory 001, "never been deployed or broadcast to any chain" (docs/v2/SECURITY-ADVISORY-001.md:8; README.md:101, "MUST NOT BE DEPLOYED") | `src/v2/QuoteSettlementHook.sol:70-90` | beforeInitialize, beforeSwap, afterSwap | `0x20C0` |
| `UnicaStockSettlementHook` (experimental) | EXPERIMENTAL — one settlement, chain 46630, tag `experimental-46630-settled` | `src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol:67-84` | beforeInitialize, beforeSwap, afterSwap | `0x20C0` |
| `UnicaMarketHook` (UNICA v4) | DESIGNED, NOT IMPLEMENTED — no `src/unica-v4/` directory exists (checked; `find src -iname unica-v4` empty) | `docs/unica-v4/SPEC-CONTRACTS.md:195` (`constant HOOK_FLAGS = 0x20C0`), guarded again at `:201` (`predicted & 0x3FFF == 0x20C0` in `createMarket`) and `:237` (hook address low 14 bits exactly `0x20C0`) | beforeInitialize, beforeSwap, afterSwap (spec only) | `0x20C0` |
| `NanoAuthorizationHook` (lab) | LAB ONLY | `src/lab/NanoAuthorizationHook.sol:348-363` | beforeSwap, afterSwap only (no beforeInitialize) | `0xC0` |
| `NoOpStudy` / `PassiveDeltaStudy` (lab) | LAB ONLY | `src/lab/NoOpStudy.sol:56-72` and `:107-123` | beforeSwap, beforeSwapReturnDelta | `0x88` |
| `NoBitTenStudy` (lab) | LAB ONLY | `src/lab/NoOpStudy.sol:149-165` | beforeSwap only | `0x80` |
| `LimitProbes` (lab, 5 probes) | LAB ONLY | `src/lab/LimitProbes.sol:61,114,199-201,304,450` | 4 probes: beforeSwap only (`0x80`); the transient-echo probe: beforeSwap+afterSwap (`0xC0`) | `0x80` / `0xC0` |

Every UNICA settlement-path hook (V1, V2, V3, experimental, and the designed UNICA v4 `UnicaMarketHook`) declares the identical `0x20C0` set. This is IMPLEMENTED AND TESTED for V1/V3, FROZEN/BLOCKED for V2, EXPERIMENTAL for the 46630 hook, and DESIGNED, NOT IMPLEMENTED for UNICA v4 — no source under `src/unica-v4/` exists to implement it.

### 10.2 Deployed-hook address check

For each hook with a live or experimental deployment, the low 14 bits of the address were computed directly (`address & 0x3FFF`) and code presence was read from the chain named, via the permitted RPC aliases (URLs not printed). Re-read 2026-09-11: all three addresses again `0x20C0` in their low 14 bits, runtime 10,634 / 10,634 / 10,518 bytes, identical to the rows below.

| Hook | Address | Chain | Low-14-bits of address | Code on chain |
|---|---|---|---|---|
| V1 `V4SettlementHook` | `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` (README.md:543) | Ethereum Sepolia, chain id 11155111 | `0x20C0` — matches declared | IMPLEMENTED AND TESTED: `cast code <addr> --rpc-url sepolia_testnet` returned 21,271 bytes of output (10,634 bytes runtime), non-empty |
| V3 `UnicaHookV3` | `0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0` (README.md:412-414, same address on all 4 chains) | Ethereum Sepolia, chain id 11155111 (one of the four; read here) | `0x20C0` — matches declared | IMPLEMENTED AND TESTED: `cast code <addr> --rpc-url sepolia_testnet` returned 21,271 bytes of output (10,634 bytes runtime), non-empty |
| Experimental `UnicaStockSettlementHook` | `0xAe1975f223824b5851564277656ebAC21667E0c0` (`src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol:19-20`; broadcast record `broadcast/StockSettlement46630.s.sol/46630/pool-latest.json`) | Robinhood testnet, chain id 46630 | `0x20C0` — matches declared | EXPERIMENTAL: `cast code <addr> --rpc-url robinhood_testnet` returned 21,039 bytes of output (10,518 bytes runtime), non-empty |

Each of the three deployed hooks' address bits, declared `getHookPermissions`, and (for V1/V3) mined-salt test all agree at `0x20C0`. IMPLEMENTED AND TESTED for V1: `test_MinedAddress_MatchesDeclaredPermissions` and `test_NoUndeclaredPermissionsCreepIn` (`test/V4SettlementHook.t.sol:45-47`, `:50-57`), `test_MinedSalt_DeploysAtTheDeclaredMask` (`test/V4SettlementHook.t.sol:72-77`), reading the permission struct off etched runtime code via `_declaredMask()` (`test/V4SettlementHook.t.sol:457-475`). IMPLEMENTED AND TESTED for V3: `test_M1_TheMinedAddressCarriesExactlyTheDeclaredBits` (`test/v3/MineHookV3.t.sol:28-35`), which asserts the literal value `0x20C0` (`test/v3/MineHookV3.t.sol:33`). The experimental hook's constructor takes the pool manager, executor, input and payout currencies as arguments (not zero-argument CREATE2-mined against a hash the way V1/V3 are; `src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol:59-65`), so its address/permission agreement is EXPERIMENTAL, established here by direct on-chain read rather than by a committed mined-salt test.

### 10.3 `0x20C0`, bit by bit

`0x20C0` = `0b10_0000_1100_0000`, three bits set out of the 14 (`Hooks.sol:27-47`):

| Bit | Flag | Why the settlement path needs it |
|---|---|---|
| `1 << 13` (`0x2000`) | `beforeInitialize` | Runs once, when a pool naming this hook is created. UNICA's hooks use it to refuse any pool whose currency pair is not the sanctioned settlement shape (native ETH against the chain's payout currency for V1/V3; the configured input/payout pair for the experimental and designed-v4 hooks) — `src/V4SettlementHook.sol:153-159` (`_beforeInitialize`), `docs/unica-v4/SPEC-CONTRACTS.md:254`. Without it, a pool with the same hook address but a currency pair of an attacker's choosing could exist and mint receipts indistinguishable from real ones. |
| `1 << 7` (`0x0080`) | `beforeSwap` | Runs before the AMM math executes. This is invariant I1's gate: sender must be the official Universal Router (or, for the experimental generation, the PoolManager lock held by the executor directly), the caller behind it must be the bound `SettlementExecutor`, and the swap's pool/direction/amount must match an order that is open, unexpired, and not already swapped (`src/V4SettlementHook.sol:167-184`). Without it the pool would execute any swap unconditionally — no admission control at all. |
| `1 << 6` (`0x0040`) | `afterSwap` | Runs after the AMM has moved the price and booked the delta — the only point at which the actual fill (full input consumed, output ≥ minimum) can be checked, and the only point where a receipt describing what really happened can be emitted (`src/V4SettlementHook.sol:190-208`, invariant I6/I2). Without it a partial fill or short output would settle silently, with no receipt and no revert. |

All eleven other bits are unset in every settlement hook: no liquidity callbacks, no donate callbacks, no `afterInitialize`, and critically **no returns-delta bit** (`beforeSwapReturnDelta: false`, `afterSwapReturnDelta: false` in every declared struct above) — see 10.4.

### 10.4 Why `beforeSwapReturnDelta` is dangerous, and why it is LAB ONLY

`docs/lab/RETURNS-DELTA.md` documents a measured attack, run only against a local Foundry fork etching Uniswap's official PoolManager bytecode (never against any live network): a hook whose address holds `BEFORE_SWAP_RETURNS_DELTA_FLAG` (`1 << 3`, address mask `0x08` — note this is address **bit 3**, not the commonly-cited "bit 10"; address bit 10 is the unrelated `afterAddLiquidity` flag, per `docs/lab/RETURNS-DELTA.md:16-38` and `test_BitTenIsNotTheReturnDeltaBit`, `test/lab/NoOp.t.sol:114`) can, inside `beforeSwap`, call `poolManager.take()` for the payer's entire input amount and return a `BeforeSwapDelta` that drives `amountToSwap` to zero. The pool then swaps nothing (no price or liquidity movement), but the hook has already taken the input. No revert, no missing event — the transaction succeeds and the payer receives nothing.

This is `src/lab/NoOpStudy.sol` (LAB ONLY, per its own header comment at `NoOpStudy.sol:18-19`: "not a product, not a library, not something to deploy, and not something to import"). It carries permission mask `0x88` (`beforeSwap | beforeSwapReturnDelta`, `NoOpStudy.sol:56-72`). The finding is LAB ONLY and IMPLEMENTED AND TESTED as a study: 7 named rows in `test/lab/NoOp.t.sol`, all passing (`docs/lab/RETURNS-DELTA.md:66-77`, "checks run: 7, passed: 7, failed: 0"): the attack itself (`test_Attack_PayerPaysInFullAndReceivesNothing`, `test/lab/NoOp.t.sol:160`, payer pays 0.001 ETH and receives 0), two controls that establish the hookless and well-behaved-hook baselines pay the payer in full (`test_Control_NoHook_PayerIsPaid`, `test/lab/NoOp.t.sol:129`; `test_Control_HookHoldingBitTenBehaves_PayerIsPaid`, `test/lab/NoOp.t.sol:142`, via `PassiveDeltaStudy` — byte-identical permission bits to `NoOpStudy`, opposite behavior), a sabotage control proving the theft requires the bit (`test_Sabotage_WithoutBitTen_TheSameTheftReverts`, `test/lab/NoOp.t.sol:185`, same code minus the flag reverts with `CurrencyNotSettled()`), and a direct check of UNICA's own live address (`test_UnicaV1DoesNotHoldBitTen`, `test/lab/NoOp.t.sol:202-207`, asserting `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`'s masked bits equal `0x20C0` with the return-delta bit at zero). The instrument itself was validated by sabotage — each of the three assertions above was deliberately broken and observed to fail before being restored (`docs/lab/RETURNS-DELTA.md:100-115`, SHA-256 confirmed). `docs/THREAT-MODEL.md:21` records this as threat T11, "designed out: no returns-delta bits, ever", TESTED via `test_NoUndeclaredPermissionsCreepIn`.

A search of every deploy record in `broadcast/` for the lab contract names found no matches (`grep -rl "NoOpStudy\|PassiveDeltaStudy\|NoBitTenStudy\|NanoAuthorizationHook\|LimitProbes" broadcast/` returned nothing; the only subdirectories under `broadcast/` are `DeployV3.s.sol`, `LiveFire.s.sol`, `StockSettlement46630.s.sol`, `Interactions.s.sol`, and `LiveFireV3.s.sol`). LAB ONLY, and never deployed, confirmed by absence of any broadcast record.

### 10.5 Mismatch check — BLOCKER search

Checked: declared `getHookPermissions()` value vs. the deployed address's own low-14-bit encoding vs. the mined-salt/deploy-time assertion, for every hook with an address.

- V1: declared `0x20C0` (10.1) = address bits `0x20C0` (10.2) = mined-salt assertion `0x20C0` (`test/V4SettlementHook.t.sol:33-36,45-47,72-77`). **No mismatch.**
- V3: declared `0x20C0` = address bits `0x20C0` = mined assertion `0x20C0` (`test/v3/MineHookV3.t.sol:28-35`). **No mismatch.**
- Experimental (46630): declared `0x20C0` = address bits `0x20C0` (10.2, read live from chain 46630). No committed mined-salt test for this generation (constructor takes runtime arguments rather than being CREATE2-mined against a fixed hash) — flagged above as EXPERIMENTAL rather than IMPLEMENTED AND TESTED for this specific check, not as a BLOCKER, since the two available signals (declared struct, on-chain address) still agree.
- UNICA v4 `UnicaMarketHook`: declared `0x20C0` in spec only (`docs/unica-v4/SPEC-CONTRACTS.md:195`); no address exists to compare against (DESIGNED, NOT IMPLEMENTED). Not comparable, therefore not a mismatch.

**No BLOCKER found** among declared permissions, mined salt, and deployed address for any hook.

One documentation-only drift, separate from the above and NOT a permission/address mismatch (all three signals above still agree with each other): `src/V4SettlementHook.sol:29` and `README.md:202` both describe V1's permissions in prose as "`beforeSwap | afterSwap`, mask 0xC0", omitting `beforeInitialize`. The code at `src/V4SettlementHook.sol:126-143` and the deployed address both carry `beforeInitialize` and mask `0x20C0` (10.1-10.2); the prose comment is stale, the enforced value is not affected. Also noted in passing: `README.md:215`'s citation of `test/V4SettlementHook.t.sol:400` for "reading permissions off the real runtime code" no longer points at that logic (line 400 is now inside an unrelated Universal Router plan-builder helper); the permission-reading helper is at `test/V4SettlementHook.t.sol:454-475` (`_declaredMask()`). Both are citation/prose accuracy issues, not BLOCKERs against the hook-permission system itself.

## 11. V4 VS V5 BOUNDARY

Everything below is DESIGNED, NOT IMPLEMENTED — decision-ledger rulings and specification prose only; no v4 contract exists to hold any of it (§3, rows C/D). Citations are to the ledger and specification as drafted; both are currently uncommitted (§3 B).

**In v4 scope, as the owner set it:**
- **Payer-bound orders.** Every order binds an explicitly named payer; only that payer may settle it; a separate public-link mode is deferred to v5 (DECISIONS.md:48, Q111).
- **`WrongPayer` preserved.** Q111 explicitly preserves it (DECISIONS.md:48). The error is prior art in the EXPERIMENTAL generation only (`src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol:152-154`), tested there by `test_B5_refuses_the_wrong_payer_when_bound` (`test/experimental/StockSettlement.t.sol:172-181`, `expectRevert(WrongPayer)` at `:179`). V2 has no `WrongPayer` error: its wrong-payer refusal is `InvalidSigner` (`test/v2/SettlementRefusals.t.sol:286`), FROZEN/BLOCKED. As a v4 contract member it is DESIGNED, NOT IMPLEMENTED, since no v4 contract exists.
- **Immutable versioned markets.** Lifecycle PROPOSED→INITIALIZED→SEEDED→ACTIVE→PAUSED→RETIRED; RETIRED is terminal; a pair that changes gets a new versioned market id, and the retired record stays discoverable (DECISIONS.md:49, Q112). Reinforced by U1–U4: hook, executor, registry and factory are each never upgradeable — a rule change means retiring and deploying a new version (DECISIONS.md:183–186).
- **Registry-authenticated markets.** SPEC-CONTRACTS.md:30 scopes one `UnicaMarketRegistry`, `UnicaMarketFactory`, `UnicaMarketHook` and `UnicaMarketExecutor` per market; the hook is specified to admit one exact pool key created by its own factory only (SPEC-CONTRACTS.md §8, referenced at SPEC-CONTRACTS.md:20) — the v4 analogue of the sandwich's PLATE `beforeInitialize` gate, but registry-mediated rather than hook-local.
- **Bounded emergency controls.** U8: instant PAUSE by the pauser, Safe-controlled unpause after review, terminal RETIRE by the Safe, no hot-patching (DECISIONS.md:190).
- **Zero UNICA fee.** "No UNICA fee in the beta" (DECISIONS.md:115, #55); confirmed again as fee payer n/a, launch fee 0, fee recipient n/a, free beta (DECISIONS.md:156, Q56/57/59/61).
- **Authenticated pricing where conversion is enabled.** A generic `IUnicaPriceOracle` with interchangeable adapters, per-market policy (adapter, feed, maxAge, maxDeviationBps, enabled); mock oracle is local/fork-test only; no feed address is ever invented (DECISIONS.md:14–17). Chainlink stays labelled "planned" until authenticated pricing is active in a *deployed* contract (DECISIONS.md:34, Q125).
- **Fail-closed.** "Settlement fails closed; there is no demonstration-rate fallback" (DECISIONS.md:16); an oracle failure marks the market STALE_ORACLE rather than substituting a price (DECISIONS.md:99, #24).
- **No-value testnet labels.** Fixtures come only from the real 46630 settlement, labelled "Testnet demonstration — no-value tokens" (DECISIONS.md:32, Q123); an oracle-disabled market is demonstration-only and never called market-priced or production-ready (DECISIONS.md:45, Q30).

**v5 design review only, explicitly out of v4 scope:**
- **Public payment links / signed intents.** Q128: "v4 uses payer-bound orders only. Public payment links move to v5, behind a separate signed-intent security review that starts with Advisory 001" (DECISIONS.md:174) — a link/intent design is gated on *redoing* that review, not merely citing it.
- **x402.** Research only, `docs/unica-v4/arc/X402.md` (uncommitted): facilitator role, the `exact`/`upto`/`batch-settlement` schemes, and gas-sponsorship notes, all cited from x402's own spec and docs (X402.md:42–209) — no UNICA code.
- **Nano-payments.** `docs/unica-v4/arc/NANOPAYMENTS.md` (uncommitted) research note.
- **Arc production.** `docs/unica-v4/arc/NETWORK.md` confirms "Arc" means Circle's Layer-1 (NETWORK.md:9–11) and that "Testnet is live; mainnet is not yet public" (NETWORK.md:20) — a different chain entirely from the mainnet-capability probe's Arbitrum One recommendation (DECISIONS.md:73). Compatibility notes: `docs/unica-v4/arc/COMPATIBILITY.md` (uncommitted).
- **Batching / prepaid / escrow / facilitator / gas sponsorship.** Appear only in the x402/nanopayments research (`arc/X402.md`, `arc/NANOPAYMENTS.md`) or as explicit v4 non-scope items: no refunds, subscriptions or partial payments (DECISIONS.md:110, Q41–43); no fee role in v4 at all (DECISIONS.md:156). The ledger does not mention escrow; its absence from v4 follows from the payer-bound, no-custody design (SPEC-CONTRACTS.md:108-110, "there is no sweep").
- **Any upgradeability.** U6: "No contract upgrades are authorized... Any future proposal to introduce upgradeability needs a new owner decision, a threat model, an independent review and a public notice policy" (DECISIONS.md:188).
- **Advisory 001 as the first regression check.** Advisory 001 is Critical, "OPEN. Reproduced, not fixed" (docs/v2/SECURITY-ADVISORY-001.md:5), affects `src/v2/QuoteSettlementExecutor.sol:339–342` and `:436–439`, reproduced by `test/v2/WitnessBinding.t.sol` (IMPLEMENTED AND TESTED), never deployed (SECURITY-ADVISORY-001.md:8). Any v5 signed-intent or payment-link design must clear this exact witness-binding defect class before it is considered — it is not enough to reference it.

## 12. MERGE-READINESS

Label for all three verdicts below: FROZEN/BLOCKED (the ledger's own words are quoted beside it). Merging, launching and pushing `main` are three separate decisions; none implies another.

**MERGING (branch `unicaV4` → `main`): NOT READY FOR MERGE.**

`unicaV4` (`903a8c9` at the §14.3 snapshot; `0314918` after four feedback-doc commits landed 2026-09-11, 33 ahead) is 29 commits ahead of `main` (`f492bb7`) at the snapshot and 0 behind, so the merge itself would be a fast-forward touching no file under `web/` (DECISIONS.md:86–87, independently confirmed by `git diff main...unicaV4 --stat -- web/` returning empty). But per the standing rule, UNICA v4 contracts are DESIGNED, NOT IMPLEMENTED (§3 C/D), so the result defaults to NOT READY FOR MERGE unless the merge is explicitly documentation-only — and it cannot be, for three independent reasons:
0. **The 29 commits are not documentation-only by content.** `git diff --name-only main...unicaV4` includes contract source (`src/experimental/`, 7 files), tests (`test/experimental/`, 7; `test/fork/`, 1), deploy scripts (`script/experimental/`, 4), both CI workflows (`.github/workflows/ci.yml`, `.github/workflows/pages.yml`), and application code (`apps/web/`, `packages/adapters/`, `packages/protocol/`).
1. **Nothing v4-related is even committed.** All `docs/unica-v4/` files (14 at the §14.3 snapshot, 26 including this file as of 2026-09-11 — the whole of the spec, decision ledger, evidence and Arc research) are untracked working-tree content, not part of any commit on `unicaV4`. The 29 commits that would actually fast-forward carry no v4 work at all — they are already-shipped, already-labelled `experimental`/`cre`/`web` work (e.g. `c28596a`, `a059c3c`, `fec5a98`) that is a separate body of work from this file's v4 scope.
2. **The owner has not authorized committing or pushing it.** DECISIONS.md:177 (Q131): "**NO AUTHORIZATION.** Do not push, trigger Pages, or publish. Publishing will need two separate approvals: push the reviewed changes; then trigger the Pages rebuild after the generated site has been checked."

If the owner separately authorizes committing exactly the `docs/unica-v4/` tree (no `src/`, `test/`, or `script/` changes riding along), that one commit would be documentation by content — but merging `unicaV4` would still carry the 29 non-documentation commits of reason 0, so only a merge of that commit on its own (for example, a documentation-only branch cut from `main`) could qualify as READY WITH DOCUMENTATION-ONLY CAVEATS. As things stand today it is neither committed nor authorized, so the overall verdict is NOT READY FOR MERGE.

**LAUNCHING (a v4 mainnet settlement): NOT READY** (FROZEN/BLOCKED).
- "No real-value mainnet settlement is authorized" (DECISIONS.md:201, item 4 of "What the missing answers mean").
- Q64 — Safe verification: NOT READY; no mainnet value movement until the Safe's chain, address, signers, threshold and hardware-wallet control are verified and a test transaction has executed (DECISIONS.md:157).
- Q70 — unpause rule: NOT READY (DECISIONS.md:159). Q71 — general mainnet launch blocker under the accepted gates: NOT READY (DECISIONS.md:160).
- Q108 — merchant terms: NOT READY, so no public merchant beta (DECISIONS.md:171).
- Q132 — whether *any* no-value mainnet infrastructure is deployed while the Safe and reviewer are not ready: OPEN/unanswered, "so nothing is deployed on mainnet" (DECISIONS.md:212–213).
- There is no v4 contract to deploy in any case (§3 C).

**PUSHING MAIN: FROZEN/BLOCKED by owner ruling; workflows that would trigger, read from `.github/workflows/*.yml`:**
- `ci.yml` — `on: push` (no branch or path filter) and `on: pull_request` (ci.yml:3–5). A push to `main` unconditionally runs jobs `gate` (contract build/test/size guard, ci.yml:8–117), `workspace` (npm check + public-build verifier, ci.yml:126–149), `fresh-clone` (stranger clone + gate, ci.yml:153–201) and `provenance` (single-author/no-AI-attribution check + secret scan, ci.yml:203–230) — none of these are path-filtered.
- `pages.yml` — `on: push: branches: [main], paths: ['web/**', '.github/workflows/pages.yml']`, plus `workflow_dispatch` (pages.yml:10–16). **Pushing `main` to `unicaV4`'s head WOULD trigger it:** the 29 commits change `.github/workflows/pages.yml` itself (commit `7eacf49`, `git log main..unicaV4 -- .github/workflows/pages.yml`), which is one of the two trigger paths, even though no file under `web/` changes (DECISIONS.md:87 is true but does not settle this). The uncommitted working-tree delta (`docs/unica-v4/*`, `vy/src/unica/*.vy`, `FEEDBACK.md`, `docs/feedback/*`) touches neither path on its own. When the workflow triggers, job `check` (pages.yml:32–53) always runs; job `deploy` (pages.yml:55–85) additionally requires the repository variable `PAGES_ENABLED == 'true'` (pages.yml:59), which is set only in GitHub's own Settings → Variables UI (docs/PUBLISHING.md:13–14) and is UNKNOWN from this local checkout — so whether a qualifying push would actually rebuild Pages cannot be determined from the repository alone.
- Regardless of the above, DECISIONS.md:177 (Q131) is a standing "NO AUTHORIZATION" on pushing, triggering Pages, or publishing at all.

## 13. LAUNCH BLOCKERS

Pulled verbatim (status words and all) from the decision ledger, `docs/unica-v4/DECISIONS.md`, as the owner recorded them 2026-09-11. Label for every row: **FROZEN/BLOCKED**. These are governance/configuration blockers, not code-implementation claims, so the Status column keeps the ledger's own words (NOT READY / NOT SELECTED / NOT PROVIDED / UNKNOWN / OPEN) beside that label; none of them has an associated contract to label IMPLEMENTED or DESIGNED against, because no v4 contract exists (§3 C).

| # | Item | Status | Cite |
|---|---|---|---|
| Q9 | Chain selection | OPEN — waits for the capability probe and owner confirmation | DECISIONS.md:214, :83 |
| Q20 | Legal review of tokenized-equity scope | **NO CONFIRMED REVIEW** — blocks legal claims and any real tokenized-equity scope | DECISIONS.md:150 |
| Q64 | Safe verification (chain, address, signers, threshold, hardware-wallet control, test tx) | **NOT READY** | DECISIONS.md:157 |
| Q70 | Unpause rule (pauser pauses only; Safe unpauses) | **NOT READY** | DECISIONS.md:159 |
| Q71 | General mainnet launch blocker under the accepted gates | **NOT READY** | DECISIONS.md:160 |
| Q91 | Primary and fallback RPC | **NOT SELECTED** | DECISIONS.md:164 |
| Q95 | Account ownership/payment: Privy, RPC, Chainlink, hosting | **NOT PROVIDED** | DECISIONS.md:166 |
| Q96–98 | Privy account, app ID, server secret | **UNKNOWN/NOT PROVIDED** (only whether the secret is configured is ever recorded, never the secret itself) | DECISIONS.md:167 |
| Q99 | Production hosting configuration (`nfteria.github.io` proposed) | **NOT CONFIRMED** | DECISIONS.md:168 |
| Q108 | Merchant terms | **NOT READY** — no public merchant beta | DECISIONS.md:171 |
| Q110 | NFLX demonstration rate; merchant-wallet control | NFLX **NOT SELECTED** (removed from the current rehearsal pending owner approval); wallet control **UNKNOWN/NOT PROVIDED** | DECISIONS.md:172 |
| Q119 | Final submission video | **UNKNOWN/NOT PROVIDED** | DECISIONS.md:173 |
| Q131 | Push / Pages-trigger / publish authorization | **NO AUTHORIZATION** | DECISIONS.md:177 |
| Q132 | Any no-value mainnet infrastructure deployed while the Safe and reviewer are not ready | **OPEN**, unanswered — so nothing is deployed on mainnet | DECISIONS.md:212–213 |

**Roll-up, in the owner's own words** ("What the missing answers mean", DECISIONS.md:198–203): Fable does not start yet; no public merchant beta is authorized; no website publication is authorized; no real-value mainnet settlement is authorized; Privy stays conditional or deferred; NFLX is excluded from the immediate rehearsal.

**Timing context.** The stated deadline is Sunday 13 September 2026, 12:00 pm EDT / 16:00 UTC (DECISIONS.md:54–55, retrieved 2026-09-11T17:43:39Z from `ethglobal.com`). Today's date is 2026-09-11, so the blockers above sit inside roughly the final two days of runway; no item in this table has moved to a non-blocking state as of the git snapshot in §3 and §14.

## 14. Exact source and test citations

De-duplicated across §§1–13 above. Line ranges are collapsed per file but not merged into spans that were not themselves cited, so a file with two adjacent-but-separate citations (e.g. `:190` and `:190-209`) keeps both exactly as used above. The abbreviations `SC`/`SO`/`DE`, used only inside §§6–8 and §11, resolve to `docs/unica-v4/SPEC-CONTRACTS.md` / `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` / `docs/unica-v4/DECISIONS.md` respectively and are folded into those files' entries below.

### 14.1 De-duplicated citations

**UNICA v4 specification and decision-ledger files (`docs/unica-v4/`)**

- `docs/unica-v4/DECISIONS.md` — lines 3, 14-17, 16, 18-20, 31, 32, 34, 45, 48, 49, 54-55, 73, 86-87, 87, 99, 110, 115, 116, 117, 150, 156, 157, 159, 160, 164, 165, 166, 167, 168, 171, 172, 173, 174, 177, 183, 183-186, 183-187, 183-191, 185, 186, 187, 188, 188-191, 189, 189-190, 190, 191, 194, 198-203, 201, 212-213, 214
- `docs/unica-v4/SPEC-CONTRACTS.md` — lines 3-4, 20, 30, 30-31, 33, 37, 73-74, 75, 82-91, 88-91, 99, 107, 108-110, 111, 112, 120-127, 121, 127, 127-129, 129, 129-130, 132-133, 133, 140-141, 142, 143, 150, 153, 153-154, 155, 156, 160, 161, 163, 164, 165, 172-174, 175-176, 176-178, 178, 179, 191-195, 195, 201, 204, 226-227, 227-228, 237, 239, 246, 254, 255, 256, 264, 269-283, 277, 277-278, 278, 279-281, 279-283, 296-298, 303-304, 333, 338, 341-351, 341-356, 342, 347-348, 349-351, 349-356, 352-353, 369-370, 379, 418-419, 428, 454, 455-457, 459, 464-468, 478-484, 497, 497-498, 541, 566, 569-570; also cited by section number alone: §3, §6, §8, §9.1, §11 (line numbers re-checked 2026-09-11 against the 572-line draft on disk)
- `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` — lines 4, 51-52, 64-66, 66, 67-68, 71-72, 99-100, 109-110, 111, 111-113, 131, 137, 144-186, 174, 220-222, 242, 252-253, 254, 256-258, 257, 279-280, 286-287, 288-291, 304-307, 316-321, 318-319, 320-321, 343-345, 353-354, 363-364, 378-380, 389-390, 400-401, 496-497, 498-500, 499, 508-512, 532, 580-582; also cited by section number alone: §7.1, §7.2, §9, §11, §12.1
- `docs/unica-v4/DEPLOYMENT-GATES.md` — line 204 (appeared after the §14.3 snapshot)
- `docs/unica-v4/arc/NANOPAYMENTS.md` — lines 3-7, 12, 94, 98
- `docs/unica-v4/arc/NETWORK.md` — lines 9-11, 20
- `docs/unica-v4/arc/X402.md` — lines 42-209
- `docs/unica-v4/arc/TOKENS.md` — §5 (lines 151-228; the four-row "cirBTC" table at 189-194, this address at 191, the "UNKNOWN" ruling at 204), §9 item 1 (lines 310-313)
- `docs/unica-v4/arc/COMPATIBILITY.md` — named as an uncommitted research file, no line cited
- `docs/unica-v4/evidence/DESIGN-REVIEW.md` — lines 16-20, 248, 293
- `docs/unica-v4/UPGRADEABILITY-AND-HOOKS-REVIEW.md` — named at DECISIONS.md:194, no line (it is this document)

**Implemented / frozen / experimental / lab source contracts (`src/`)**

- `src/V4SettlementHook.sol` (V1) — lines 29, 117-123, 126-143, 150-153, 153-159, 153-160, 167, 167-184, 167-185, 190, 190-208, 190-209, 250
- `src/SettlementExecutor.sol` (V1) — lines 67, 104-105, 106, 121, 181, 181-196, 198, 205, 232-235, 235
- `src/v3/UnicaHookV3.sol` (V3) — lines 53, 149-166, 172-175, 175-182, 189-207, 212-231, 275
- `src/v3/UnicaExecutorV3.sol` (V3) — lines 241-261, 329
- `src/v2/QuoteSettlementHook.sol` (V2, frozen) — lines 70-90, 97
- `src/v2/QuoteSettlementExecutor.sol` (V2, frozen) — lines 183-193, 189, 192, 339-342, 436-439
- `src/v2/interfaces/IQuoteSettlement.sol` (V2, frozen) — line 113
- `src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol` (experimental) — lines 19-20, 59-65, 67-84, 88-93, 93-99, 105-128, 132-165, 153
- `src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol` (experimental) — lines 144, 144-181, 152-154, 175-179, 222-230, 242
- `src/experimental/robinhood-testnet/UnicaStockSettlementErrors.sol` (experimental) — line 37
- `src/experimental/robinhood-testnet/UnicaStockSettlementEvents.sol` (experimental) — line 26
- `src/lab/NoOpStudy.sol` (lab, also defines `PassiveDeltaStudy` and `NoBitTenStudy`) — lines 18-19, 56-72, 107-123, 149-165
- `src/lab/NanoAuthorizationHook.sol` (lab) — lines 348-363
- `src/lab/LimitProbes.sol` (lab, 5 probes) — lines 61, 114, 199-201, 304, 450

**Vendored Uniswap v4 source (not UNICA's own)**

- `lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol` — lines 27-47
- `lib/uniswap-hooks/lib/v4-periphery/src/V4Router.sol` — lines 156-162
- `lib/uniswap-hooks/lib/v4-periphery/src/base/BaseActionsRouter.sol` — lines 26, 32-46

**Off-chain integration, deployment scripts, and workflow config**

- `script/experimental/StockSettlement46630.s.sol` — lines 430-448, 430-457, 451-457
- `integrations/chainlink-cre-guardian/workflow/guardian.ts` — lines 381-396
- `integrations/graph/subgraph.yaml` — lines 12, 33
- `.github/workflows/ci.yml` — lines 3-5, 8-117, 126-149, 153-201, 203-230
- `.github/workflows/pages.yml` — lines 10-16, 32-53, 55-85, 59; changed on `unicaV4` by commit `7eacf49`
- `broadcast/StockSettlement46630.s.sol/46630/pool-latest.json` — named broadcast record, no internal line cited
- `broadcast/` directory listing (grep evidence, no line numbers): the only subdirectories present are `DeployV3.s.sol`, `LiveFire.s.sol`, `StockSettlement46630.s.sol`, `Interactions.s.sol`, `LiveFireV3.s.sol` — cited to show no lab-contract deployment record exists
- `package.json`, `Makefile`, `script/`, `scripts/`, `integrations/`, `apps/` — swept by grep for `unica-v4` (zero hits), no line
- `tools/unica-verify/README.md` — line 14 ("It recomputes; it does not read and agree")

**Documentation cited outside `docs/unica-v4/`**

- `README.md` — lines 101, 166, 202, 215, 329-338, 334, 364, 412-414, 422-448, 543, 549-551
- `docs/RECEIPT-SCHEMA.md` — lines 3, 27, 46, 61-62 (receipt-from-the-swap vs. convenience wording)
- `docs/THREAT-MODEL.md` — line 21
- `docs/DEPLOYMENT.md` — lines 48, 97
- `docs/PUBLISHING.md` — lines 13-14
- `docs/EXECUTION-PATH.md` — named (its own "call path, as measured" table), no line
- `docs/ARC-FACTS.md` — named, no line
- `docs/chains/ROBINHOOD.md` — lines ~30-51 (read 2026-09-10)
- `docs/experimental/STOCK-46630-FEE-FIELD.md` — lines 25-26, 26-27
- `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` — lines 7-9
- `docs/feedback/arc.md` — lines 48-79, 81-91 (committed in `0314918`, 2026-09-11)
- `docs/lab/RETURNS-DELTA.md` — lines 16-38, 66-77, 100-115
- `docs/v2/SECURITY-ADVISORY-001.md` — lines 1-9, 5, 8
- `docs/v2/RELEASE-CANDIDATE-FREEZE.md` — named, no line

**External, non-repo references consulted (provenance only — not file:line citations)**

- `docs.arc.io/arc/references/connect-to-arc.md`, `docs.arc.io/arc/references/contract-addresses.md`, `developers.circle.com/assets/what-is-cirbtc`, `developers.circle.com/assets/cirbtc-contract-addresses` (fetched 2026-09-11), `ethglobal.com` (deadline retrieval, 2026-09-11T17:43:39Z)

**Tests cited, by file**

- `test/V4SettlementHook.t.sol` — lines 33-36, 45-47, 50-57, 72-77, 86, 110-120, 125-140, 400, 454-475, 457-475; named tests: `test_ExecutorDerivationMatchesTheDeployedAddress`, `test_MinedAddress_MatchesDeclaredPermissions`, `test_NoUndeclaredPermissionsCreepIn`, `test_MinedSalt_DeploysAtTheDeclaredMask`, `test_RevertWhen_SwapSenderIsNotTheOfficialRouter`, `test_RevertWhen_OfficialRouterIsDrivenByAStranger`
- `test/SettlementExecutor.t.sol` — lines 45-69, 76, 98-99, 281; named tests: `test_SettlementDeliversToTheRegisteredRecipient`, `test_ReceiptCarriesTheOrderAndTheStandardEvent`, `test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer`; also cited via the command `forge test --match-test test_SettlementDeliversToTheRegisteredRecipient`
- `test/ReceiptSchema.t.sol` — lines 103-116, 121-150; named tests: `test_Schema_LogOrderIsSwapReceiptFeeThenPayment`, `test_Schema_DecodingIsHookAddressAgnostic`
- `test/attack/HostilePool.t.sol` — lines 19-60; named contract: `HostilePoolAttackTest`
- `test/experimental/StockSettlement.t.sol` — lines 93-112, 172-181, 179, 255-257, 258-263; named tests: `test_A4_receipt_and_settled_both_emitted_in_the_right_order` (referenced elsewhere as `test_A4`), `test_B5_refuses_the_wrong_payer_when_bound` (the `WrongPayer` precedent), `test_D1_a_fee_on_transfer_input_is_refused_by_the_executor`
- `test/experimental/StockSettlementGaps.t.sol` — line 127; named test: `test_G3_a_payout_token_that_delivers_short_is_refused_by_the_executor`
- `test/fork/DependencyProvenance.t.sol` — lines 84-91
- `test/fork/ForkPin.sol` — lines 66-74
- `test/fork/StockSettlement46630Fork.t.sol` — lines 49-52 (`onFork` skip), 74; named test: `test_F0_control_the_eleven_transactions_settle_a_TSLA_payment`
- `test/lab/NoOp.t.sol` — lines 114, 129, 142, 160, 185, 202-207; named tests: `test_BitTenIsNotTheReturnDeltaBit`, `test_Control_NoHook_PayerIsPaid`, `test_Control_HookHoldingBitTenBehaves_PayerIsPaid`, `test_Attack_PayerPaysInFullAndReceivesNothing`, `test_Sabotage_WithoutBitTen_TheSameTheftReverts`, `test_UnicaV1DoesNotHoldBitTen`
- `test/lab/NanoAuthorization.t.sol`, `test/lab/Limits.t.sol` — named only, as part of the brace-expanded group `test/lab/{Limits,NanoAuthorization,NoOp}.t.sol`; no specific line cited
- `test/v2/HookAdmission.t.sol` — line 63; named test: `test_Init_ADynamicFeePoolIsRefused`
- `test/v2/SettlementRefusals.t.sol` — line 286 (`test_Refuse_AnAuthorisationSignedByTheWrongPayer`, which asserts `InvalidSigner`; V2 has no `WrongPayer`)
- `test/v2/WitnessBinding.t.sol` — named only, as Advisory 001's regression test; no specific line cited
- `test/v3/MineHookV3.t.sol` — lines 28-35, 33; named test: `test_M1_TheMinedAddressCarriesExactlyTheDeclaredBits`
- `test/v3/SettlementV3.t.sol` — lines 42, 42-75; named test: `test_V3_1_SettlesThroughTheOfficialRouterAndReceipts`
- `test/I7NativeSettle.t.sol` — named only, no line

### 14.2 On-chain reads cited

Every read below was re-run 2026-09-11 (Sepolia via `sepolia_testnet`; 46630 via `robinhood_testnet` at block `117669822`; Arc via the keyless endpoint at block `61621815`) and reproduced, with one correction: the "cirBTC" implementation code hash (see its entry).

- Ethereum Sepolia (chain id 11155111), `StateView.getSlot0(bytes32)` at `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C`: V1 pool `0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db` → `(sqrtPriceX96, tick, protocolFee 0, lpFee 3000)`; V3 pool `0xf9b873f83814234224be42592795ec812fb948a300188e0c597796171ab9c57a` → the same shape, `protocolFee 0, lpFee 3000`.
- Robinhood testnet (chain id 46630), `StateView.getSlot0` at `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b`: experimental pool `0x64553b2a4c30c7a7551f752184ef3442e40817cc17f118db3d95142839057a34` → `protocolFee 0, lpFee 3000`.
- Robinhood testnet (chain id 46630), PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` (24,009 bytes deployed): `getSlot0` → `protocolFee 0`; `protocolFeeController()` → `0x0000000000000000000000000000000000000000`; `owner()` → `0x9701fb0aDe1E269c8f64Ec0C7b3cfADB31A13A52`.
- Arc testnet (chain id 5042002), via `https://rpc.testnet.arc.io`: `eth_chainId` → `5042002`; block at read time `61617943`.
  - USDC `0x3600000000000000000000000000000000000000`: zOS `AdminUpgradeabilityProxy`; EIP-1967 slots read `0x0`; `implementation()` `0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6`; `admin()` `0x49f78af090F1f98e7184B7f61f1F1a8a8064b40d`; proxy runtime 1798 bytes; impl. codehash `0x237a5899a4c4e1c8b60fe7626371778ce8ef0a554350cd92cdf8ae393f59966f`; `decimals()` 6, `symbol()`/`name()` "USDC"; `paused()` false.
  - EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`: `implementation()` `0xECA045ED98a6D70887d2050F3BE1Fb0F0311017c`; `admin()` `0x667B894BcC6899F5dF1EBA73c006b94c661A2d95`; proxy runtime 1798 bytes; impl. codehash `0x0d42c7ffcaa343c99a8172b6ebd9c0eeafdf29df33d68bccb22292df7d3fe177`; `decimals()` 6, symbol "EURC"; `paused()` false.
  - "cirBTC" candidate `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`: `implementation()` `0x1D78868e73cAC95BA7036Eb3A0CCb13b88EDEb23`; `admin()` `0xE1A6aEE7d850fa9C065830C964F843c309e1d335`; proxy runtime 1496 bytes, proxy codehash `0x0833ebf26b18ab2caebefb078a62c34ba84c7e89e72a73986dbce75e8b08ad87`; implementation runtime 18190 bytes, impl. codehash `0x3895c88f0f828a15c13027ec8d74ae4999309b77d5ea04e7e70a124052dec355` (corrected 2026-09-11; the proxy's hash had been recorded in this slot); `decimals()` 8, symbol "cirBTC", name "Circle Wrapped Bitcoin"; `paused()` false; `owner()` `0xf2e323A5F154D4FeD1D6be14c75A130fDa540bd5`.
- Robinhood testnet (chain id 46630), via the `robinhood_testnet` foundry alias: `eth_chainId` → `46630`; block at read time `117655854`.
  - TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`, NFLX `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93`, AMD `0x71178BAc73cBeb415514eB542a8995b82669778d`, AMZN `0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02`, PLTR `0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0`: each `decimals()` 18; each's EIP-1967 beacon slot → `0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5` (identical across all five); identical proxy codehash `0x2f367e6a678e7b30ab613d5963e541e6f4d3ca586de76e2f441fbfeb1a27c440`.
  - Beacon `0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5`: `implementation()` → `0xBd14156E05c6AF28ad39aA53a2AB8eB9CDf657DA`; `owner()` reverts; beacon runtime 2332 bytes, codehash `0x404e8188c4b1d0c9804205e0da253d11570e9d48d03964962cb689072b1735d2`; implementation contract 10992 bytes, codehash `0x137f26aacb7b1675d89017cebbf5018515c7bf4b87ae1848984494a56f3e1912`.
  - TSLA: `paused()` → false; `uiMultiplier()` → `1000000000000000000` (1e18).
- Ethereum Sepolia (chain id 11155111), `cast code <addr> --rpc-url sepolia_testnet`: V1 hook `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` → 21,271 bytes output (10,634 bytes runtime); V3 hook `0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0` → the same, 21,271 bytes output (10,634 bytes runtime).
- Robinhood testnet (chain id 46630), `cast code <addr> --rpc-url robinhood_testnet`: experimental hook `0xAe1975f223824b5851564277656ebAC21667E0c0` → 21,039 bytes output (10,518 bytes runtime).

### 14.3 Git and workflow snapshot (supporting material)

§13 above closes by pointing to "the git snapshot in §3 and §14" — this subsection is that snapshot: the evidentiary git state that §3, §12, and §13 draw their commit hashes, tags, and working-tree facts from.

Snapshot taken 2026-09-11T20:06:06Z, branch `unicaV4`.

**Refs.**
- `unicaV4` HEAD: `903a8c9c1f30264582796e77f5aca86ac83eeb37` (2026-09-11 12:40:09 -0400), same as `origin/unicaV4`.
- `main` / `origin/main` HEAD: `f492bb71383e34971e55f3b80ae80a6554fef5c4`.
- `git rev-list --left-right --count main...unicaV4` → `0	29` (0 commits only-on-main, 29 only-on-unicaV4).
- `git diff main...unicaV4 --stat -- web/` → empty (the 29 commits touch no file under `web/`).

**Relevant tags → commit:**
| Tag | Commit |
|---|---|
| `live-green` | `5e1d843` |
| `experimental-46630-settled` | `e5a0185` |
| `v2.0.0-rc1` | `fcfe151` |
| `v3.0.0` | `376df29` |
| `v3-settled` | `39b6f91` |
| `v1.0.0` | `5e1d843` (same commit as `live-green`) |
| `day1-green` / `day2-green` / `day3-green` | `df72c75` / `6df0426` / `49edd20` |

**Working-tree state (`git status --short --untracked-files=all`), same timestamp:**
```
 M FEEDBACK.md
 M docs/feedback/arc.md
 M docs/feedback/chainlink.md
 M docs/feedback/privy.md
 M docs/feedback/uniswap/robinhood.md
?? docs/unica-v4/DECISIONS.md
?? docs/unica-v4/SPEC-CONTRACTS.md
?? docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md
?? docs/unica-v4/arc/COMPATIBILITY.md
?? docs/unica-v4/arc/LIQUIDITY-ORACLES.md
?? docs/unica-v4/arc/NANOPAYMENTS.md
?? docs/unica-v4/arc/NETWORK.md
?? docs/unica-v4/arc/PRODUCT-FLOWS.md
?? docs/unica-v4/arc/THREAT-MODEL.md
?? docs/unica-v4/arc/TOKENS.md
?? docs/unica-v4/arc/X402.md
?? docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md
?? docs/unica-v4/evidence/DESIGN-REVIEW.md
?? docs/unica-v4/evidence/MAINNET-CAPABILITY-PROBE.md
?? vy/src/unica/calculator.vy
?? vy/src/unica/flash_liquidator.vy
```
The five modified `FEEDBACK.md`/`docs/feedback/*.md` files (69/39/118/27/40 lines added respectively, `git diff --stat`) are sponsor-feedback content, not v4 material, and were not present at the branch's earlier `903a8c9` state; this is a snapshot at 2026-09-11T20:06:06Z, not a stable state, since the working tree changes over time. The two `vy/src/unica/*.vy` files are Vyper math additions alongside the already-committed `merchant_policy.vy`/`payany_router.vy` (`63a815a`) and are V2-era, not v4.

**Later state, recorded 2026-09-11 (not part of the snapshot above):** `main` (`f492bb7`) and every tag are unchanged. `unicaV4` HEAD moved to `0314918` (33 ahead, 0 behind) when four commits touching only `FEEDBACK.md` and `docs/feedback/*` landed (`faf5d0d`, `34cc719`, `9d9988b`, `0314918`), so those modified files are no longer in the working tree. What remains untracked is `docs/unica-v4/` — 26 files (the 14 above, 7 more top-level drafts, 4 more `arc/` files, and this review) — plus the two `vy/src/unica/*.vy` files.

**Workflow files present:** `.github/workflows/ci.yml`, `.github/workflows/pages.yml` — no other workflow files exist. Full trigger/job detail is in §12 ("PUSHING MAIN").
