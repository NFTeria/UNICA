# PAYOUT POLICY — the specification for more than one payout currency

Specification. Not implemented. The live release is USDC-only.

Written 2026-09-05 against `main` at commit `72cabd2`; the live release is tag `live-green`
(commit `5e1d843`). Every claim about current behaviour cites a file and line at that commit.
Where this document proposes something, the word "proposed" is beside it. Nothing here is a
promise about a chain, a token, or a sponsor; it is what a reviewer would need to implement a
second payout currency without weakening what the live release proves.

The live release, stated once: UNICA demonstrates a live, verified USDC settlement flow on Uniswap v4 Sepolia, with order-bound full-fill enforcement and an indexable receipt. The
control transaction for everything below is the live settlement
tx `0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83` on Ethereum Sepolia:
status 1, block 11640026, `SettlementReceipt` with `currencyOut` `0x1c7D4B19…C7238` and
`amountOut` 2003660, and the USDC `Transfer` from the PoolManager to the recipient of exactly
2003660 (read with `cast receipt … --json` on 2026-09-05T16:24:36Z).

---

## 1. Why: what the single currency stands in for

### 1.1 The rule as it exists

The payout currency is one address per chain, resolved in code, with no owner and no setter:

- `src/libraries/UniswapDeployments.sol:24-27` — `payoutCurrency(chainId)` returns Circle USDC
  `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` for chain 11155111 and reverts
  `UnsupportedChainId(chainId)` (declared at line 10) for anything else.
- `src/V4SettlementHook.sol:46` — the hook stores it as `immutable PAYOUT_CURRENCY`, set at
  line 106 in a zero-argument constructor (lines 30-34 explain why the constructor takes no
  argument: an argument enters the CREATE2 init-code hash).
- `src/V4SettlementHook.sol:153-160` — `_beforeInitialize` refuses any pool whose `currency0`
  is not `address(0)` or whose `currency1` is not `PAYOUT_CURRENCY`, with
  `NotTheSettlementShape(currency0, currency1)` (declared at line 82). A pool of another shape
  carrying this hook cannot be born.
- `src/SettlementExecutor.sol:150-151` — `createOrder` refuses an order whose `key.currency1`
  is not that address, with `PayoutCurrencyNotAllowed(currency1)` (declared at line 101).

The README still describes the earlier state: `README.md:287-290` says "The pool allowlist
(spec C2) and the payout-asset allowlist (C4) are not implemented" and that an order's output
currency "is whatever pool key the order names". That was true before the day-5 attack review;
it is not what the code does now (the four citations above), and `SECURITY.md:56-59` describes
the current rule correctly: "The payout currency is one address per chain." This specification
treats the single immutable address as the implemented stand-in for the allowlist the spec
asked for (`specs/HOOK-SPEC.md` C2 at line 152 and C4 at line 169), and the README sentence
as stale.

### 1.2 What the order cannot say

The order is `SettlementExecutor.Order` (`src/SettlementExecutor.sol:53-62`): `recipient`,
`creator`, `payer`, `key`, `amountIn`, `minOut`, `deadline`, `status`. There is no field for
the currency the payee expects to receive. The payout currency is implied by `key.currency1`
and nothing else: the executor reads it there to refuse the order (line 151), to measure the
recipient before and after the router call (lines 193 and 203), and to compose the `TAKE` that
pays the recipient (line 235); the hook reads it from the swap's key to fill the receipt's
`currencyOut` (`src/V4SettlementHook.sol:244`).

Anyone may create an order, and the caller names the recipient: "Anyone may create an order;
only the order decides where output goes" (`src/SettlementExecutor.sol:127-128`); `recipient`
is an argument (line 134) and `creator` is recorded as `msg.sender` (line 162). The recipient
does not have to be the creator.

With exactly one sanctioned currency this is harmless: whichever key the creator names, the
recipient is paid in the one currency that exists, or the order is refused. With two sanctioned
currencies it is not: the creator chooses the key, the key chooses the currency, and the
recipient has no field in which to say which one they expected. A recipient who quoted a price
in EURC could be registered against the USDC pool by whoever created the order, paid in USDC at
the pool's rate, and receipted for it; the receipt would be genuine (every field read from
storage or the swap, `docs/RECEIPT-SCHEMA.md:3-7`), the recipient's balance would have grown by
at least `minOut` (`src/SettlementExecutor.sol:203-205`), and no invariant in `docs/INVARIANTS.md` would have been broken, because none of them binds the payout currency to what the payee expected: I2 (`docs/INVARIANTS.md:31`) names both currencies only as receipt fields, and the guard at `:23` fixes the currency per chain, not per order. The
`minOut` floor does not save the recipient either: `minOut` is a number in the smallest unit of whatever `key.currency1` is (`src/SettlementExecutor.sol:203-205`: `minOut` is compared against a `balanceOf` delta in `key.currency1`; `docs/RECEIPT-SCHEMA.md:42` states the smallest-unit rule for the receipted amounts), so a minimum meant for one
currency is silently re-denominated in the other.

### 1.3 What the single-currency rule buys today, precisely

The library comment states the property (`src/libraries/UniswapDeployments.sol:19-23`): a pool
carrying this hook is native ETH against this token, "so nobody can stand up a pool of their own
devising, settle through it, and mint a receipt naming a recipient who received something
worthless." That is threat T2's closure (`docs/THREAT-MODEL.md:12`; the
attack is written out in `test/attack/HostilePool.t.sol:13-21`): a receipt from this hook names
output in a currency somebody other than the attacker sanctioned.

Two corollaries come free with one currency and must be named because they are what a second
currency disturbs:

1. **The payee's currency expectation is satisfied trivially.** There is one currency, so
   "which currency" is not a question the order needs to answer. This is the corollary that
   section 1.2 shows does not survive a second entry.
2. **T7 is reduced to one token.** Fee-on-transfer and rebasing behaviour cannot be brought in
   at all; what remains is the residual risk that the sanctioned token itself behaves that way,
   and the executor's recipient measurement covers that (`docs/THREAT-MODEL.md:17`;
   `src/SettlementExecutor.sol:199-205`).

Under the policy in section 2:

| Property | Fate |
|---|---|
| Receipts name only sanctioned output (T2) | **Preserved.** The set stays closed and compiled; it merely has more than one member. |
| No owner, no setter, no proxy (`SECURITY.md:81-82`) | **Preserved.** Changing the set changes the hook's creation code and address (`src/libraries/UniswapDeployments.sol:23`), so a change is a new deployment, never a mutation. |
| T7 reduced to the sanctioned token | **Preserved per entry, weakened as a whole.** Each entry must clear the C4 bar separately (section 5); the residual-risk tests must run at every entry's address, not one. |
| The payee's expectation is implied | **Replaced.** The order carries the expected currency explicitly and registration refuses a mismatch (section 2.3). |
| An indexer can ignore `currencyOut` | **Weakened.** `(chainId, hook, orderId)` still identifies one settlement (`docs/RECEIPT-SCHEMA.md:31-32`), but the amount's unit is now read from `currencyOut` (field 8, line 24), which today carries one value per hook. The schema does not change; what changes is that the field is load-bearing. |
| One mock at the payout address in tests (`test/utils/SettlementTestBase.sol:101-111`) and one USDC constant in the deploy path (`script/go-live.sh:36`, `:77`) | **Replaced** by one mock and one table entry per policy member. |

---

## 2. The policy

### 2.1 An immutable, chain-specific set, resolved in code

The set of accepted payout assets for a chain is a pure function of `block.chainid`, compiled
into the library that already holds the single address. It is not stored, not settable, not
proxied, not governed, and not readable from any registry; there is no function that changes it
after deployment. This keeps the property `SECURITY.md:81-82` states ("No admin. No owner, no
roles, no pause, no upgrade, no configurable address") and the consequence
`src/libraries/UniswapDeployments.sol:23` states: any change to the set changes the hook's
creation code, therefore its CREATE2 address, therefore the executor's derived address
(`src/V4SettlementHook.sol:117-123`), and is a new deployment with a new verification. The live
release is not touched by the existence of this specification.

Shape (proposed), keeping the current function for the first entry so nothing that reads it
today changes:

```solidity
/// The sanctioned payout assets on this chain, in a fixed order. Each entry is an address
/// and the decimals the entry was sanctioned with. Anything not in the set is refused.
function isPayoutCurrency(uint256 chainId, address currency) internal pure returns (bool);
function payoutDecimals(uint256 chainId, address currency) internal pure returns (uint8);
```

Both revert `UnsupportedChainId(chainId)` (the existing error,
`src/libraries/UniswapDeployments.sol:10`) on a chain with no entry; `isPayoutCurrency` returns
`false`, never reverts, for an address that is not in the set of a supported chain. Native
currency (`address(0)`) is never a member on any chain.

Chain 11155111 is the only chain with an entry today (USDC). Section 5 states what must be true
before EURC becomes the second entry there. No other chain has an entry, and this document
adds none.

### 2.2 The pool shape

Unchanged in form: a pool carrying this hook is native ETH against a sanctioned asset, or it
cannot be initialised. `src/V4SettlementHook.sol:156` becomes
`currency0 != address(0) || !isPayoutCurrency(block.chainid, currency1)`, refused with the
existing `NotTheSettlementShape(currency0, currency1)` (line 82). Anyone may still initialise a
sanctioned shape at any fee tier: the check is on the currencies, not the caller
(`src/V4SettlementHook.sol:149-151`; `test/attack/HostilePool.t.sol:106-115`).

The currency ordering is fixed by construction: v4 requires `currency0 < currency1`
(`lib/uniswap-hooks/lib/v4-core/src/PoolManager.sol:121-125`, `CurrenciesOutOfOrderOrEqual`),
native is `address(0)`, so native is always `currency0` and the payout asset always `currency1`.
The executor keeps refusing any other input (`NativeInputOnly`,
`src/SettlementExecutor.sol:110` and `:155`).

### 2.3 The order names the payee's expected currency

`Order` (`src/SettlementExecutor.sol:53-62`) gains one field, `address payoutCurrency`, and
`createOrder` (lines 133-171) gains the matching argument. Registration, in this order, all
before any storage write:

1. the existing recipient checks (`ZeroRecipient`, `ReservedRecipient`; lines 141-148);
2. the existing hook check (`PoolNotGuarded`; line 149);
3. **policy membership**: `if (!isPayoutCurrency(block.chainid, payoutCurrency)) revert
   PayoutCurrencyNotAllowed(payoutCurrency)` — the existing error (line 101), now applied to
   the expected currency rather than to `key.currency1`;
4. **expectation against the pool** (proposed): `if (Currency.unwrap(key.currency1) !=
   payoutCurrency) revert PayoutCurrencyMismatch(payoutCurrency, Currency.unwrap(key.currency1))`;
5. **decimals against the entry** (proposed): read `decimals()` from `payoutCurrency` once,
   after step 3 so that no address outside the set is ever called (the rule
   `src/V4SettlementHook.sol:166` already applies to the router), and refuse
   `PayoutDecimalsUnexpected(payoutCurrency, expected, actual)` on disagreement. v4's
   `IERC20Minimal` has no `decimals()` (`lib/uniswap-hooks/lib/v4-core/src/interfaces/external/IERC20Minimal.sol:10-35`),
   so this needs a one-function interface in `src/`;
6. the existing amount, minimum, deadline and input checks (lines 152-155).

Step 4 makes step 3 on `key.currency1` redundant, and it is kept anyway: the two refusals name
different mistakes (an unknown asset versus a known asset in the wrong pool) and cost one
comparison.

The order binds the exact pool key today (`Order.key`, line 57, written at line 164) and the
hook compares pool ids, which cover both currencies, the fee, the tick spacing and the hook
(`src/V4SettlementHook.sol:183`, `PoolDoesNotMatchOrder`). The policy adds nothing there; it
adds the explicit expectation so that "the right pool" and "the currency the payee expected"
are checked as two facts rather than one.

### 2.4 Settlement refuses any currency outside the compiled policy

- The hook's `_beforeSwap` is unchanged (`src/V4SettlementHook.sol:167-185`): router, executor,
  in-flight order, one swap per order, deadline, direction and amount, pool id. A swap in a pool
  of any other currency is refused at line 183 because the pool id differs from the order's.
- The hook's `_afterSwap` (lines 190-209) adds one assertion before `_receipt` (proposed):
  `Currency.unwrap(key.currency1) == order.payoutCurrency`, refused with
  `PayoutCurrencyMismatch`. It is unreachable if registration held; it is there so that the
  receipt's `currencyOut` (line 244), the order's expectation and the delta's denomination
  (lines 189, 199) are equal by assertion rather than by argument.
- The executor's `pay` measures the recipient in `order.payoutCurrency` (today
  `order.key.currency1`, lines 193 and 203; equal by step 4) and keeps `NoReceipt` (line 198)
  and `RecipientShort` (line 205).
- The executor's `_plan` takes the output in `order.key.currency1` to `order.recipient` (line
  235); unchanged.

### 2.5 No receipt on any mismatch

The receipt is emitted only from `_afterSwap` after the fill checks
(`src/V4SettlementHook.sol:197-207`), inside the swap, inside the router's call, inside `pay`.
Every refusal above is a revert, so the log is discarded with the transaction; there is no code
path that emits and then continues. The executor then requires that exactly one receipt was
counted (line 198) and that the recipient's balance grew by at least the minimum (line 205)
before it marks the order `Settled` (line 207). `docs/RECEIPT-SCHEMA.md:48` states the
completeness rule this preserves: a settlement is complete if and only if its receipt exists in
a mined transaction.

### 2.6 What is preserved, with its current enforcement line

| Property | Enforced today at | Under the policy |
|---|---|---|
| I1 recipient guarantee | hook `src/V4SettlementHook.sol:173-175` (router, then executor through `msgSender()`); executor `src/SettlementExecutor.sol:235` (`TAKE` to `order.recipient`), `:149` (`PoolNotGuarded`), `:142-148` (`ReservedRecipient`) | unchanged |
| I6 never strand | revert-only everywhere; the hook moves no funds; the executor has no `receive` (`src/SettlementExecutor.sol:35-37`); every refusal test asserts nothing moved (`test/SettlementExecutor.t.sol:530-543`) | unchanged; the new refusals are reverts |
| I7 native settlement integrity | the official router's settle syncs first; the executor holds nothing (`src/SettlementExecutor.sol:196` forwards the value); `test/I7NativeSettle.t.sol` | unchanged; the input leg is still native |
| Full fill | hook `src/V4SettlementHook.sol:197-198` (`PartialFill`) | unchanged |
| Replay | executor `:183-184`, `:190-191`, `:207` (Open to Paying before any external call, Settled after); hook `:264` (`OrderNotInFlight`), `:178` and `:216-228` (transient one-swap mark); ids `:157-158` (`OrderExists`) | unchanged; the id derivation does not include the currency and does not need to, because the order is single-use |
| Synchronisation | sync immediately before settle, by the official router (`docs/INVARIANTS.md:36`) | unchanged |
| Atomicity | one transaction: swap, receipt, `TAKE`, then `NoReceipt` (`:198`) and `RecipientShort` (`:205`) before `Settled` (`:207`) | unchanged |
| Never-strand of the pool's accounting | the plan settles and takes `OPEN_DELTA` (`src/SettlementExecutor.sol:233`, `:235`); T9 at `docs/THREAT-MODEL.md:19` | unchanged |
| Receipt schema v1 | `src/V4SettlementHook.sol:58`, `:65-78`; `docs/RECEIPT-SCHEMA.md` | unchanged; no field is added, `currencyOut` becomes load-bearing |

---

## 3. The red-test matrix

Fourteen rows. Each names its precondition, the call, the intended selector and reason, and is
held to the six assertions below. Where an error exists today it is named with its declaration
line; where none exists one is proposed and marked so. Wrapped means v4's
`CustomRevert.WrappedError(hook, callbackSelector, reason, HookCallFailed)`
(`lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol:131-137`), the shape the suite already
asserts with `_wrapped` (`test/SettlementExecutor.t.sol:545-553`).

The six assertions, applied to every row:

- **A1 No order consumption.** A refused payment leaves the order `Open` with `payer` zero; a
  refused registration creates nothing (`orders(id).status == None`, `orderCount` unchanged).
- **A2 No receipt.** `receiptCount` unchanged, and zero `SettlementReceipt` and zero `HookFee`
  logs from the hook under `vm.recordLogs()`.
- **A3 No balance leakage.** The payer's native balance unchanged; the recipient's balance in
  every policy currency unchanged; the executor and the router hold zero native and zero of
  every currency touched.
- **A4 No stranded PoolManager delta.** The manager's nonzero-delta count is zero and it is not
  unlocked after the call; the pool's liquidity is what it was. In a reverted transaction this
  holds by EVM semantics; it is asserted so that a future `pay` that caught the failure and
  returned would be caught by the test and not by a reader (the reasoning at
  `test/SettlementExecutor.t.sol:528-529`).
- **A5 Unchanged state except revert-neutral effects.** No pool initialised for a refused key
  (`sqrtPriceX96` zero); the transient one-swap mark gone with the transaction; nothing else
  written.
- **A6 The control row passes first.** The sibling positive test that differs from the row in
  exactly the sabotaged field settles once, with one receipt whose fields match. A row is not
  believed until its control has passed in the same suite; a refusal with no passing twin
  proves nothing (`docs/INVARIANTS.md:8-9`).

### Row 1 — EURC expected, registered against USDC

- Precondition: policy on 11155111 is {USDC, EURC}; sanctioned ETH/USDC and ETH/EURC pools
  exist with liquidity.
- Call: `createOrder(recipient, key{0, USDC, fee, ts, hook}, amountIn, minOut, deadline, salt,
  payoutCurrency = EURC)`.
- Selector: `PayoutCurrencyMismatch(EURC, USDC)` — proposed (section 2.3 step 4). Reason: the
  payee's expectation and the pool disagree; the payee would otherwise be paid in USDC at the
  pool's rate against a `minOut` denominated in EURC.
- A1-A5: registration refusal; no storage write, no PoolManager call at all.
- A6 control: the same call with `key{0, EURC, …}` creates the order; `pay` settles with one
  receipt whose `currencyOut` is EURC and the recipient's EURC balance grows by `amountOut`.

### Row 2 — USDC expected, registered against EURC

- Precondition: as row 1.
- Call: `createOrder(…, key{0, EURC, …}, …, payoutCurrency = USDC)`.
- Selector: `PayoutCurrencyMismatch(USDC, EURC)` — proposed. Reason: mirror of row 1.
- A1-A5: as row 1.
- A6 control: the live shape, `test_SettlementDeliversToTheRegisteredRecipient`
  (`test/SettlementExecutor.t.sol:45-69`), with `payoutCurrency = USDC`.

### Row 3 — allowed token through the wrong pool key

- Precondition: order registered against key A (ETH/USDC, fee 3000, tick spacing 60); a second
  sanctioned pool key B initialised by anyone (ETH/USDC at fee 500 and tick spacing 10, which
  `test/attack/HostilePool.t.sol:109-115` shows is permitted; or, under the policy, ETH/EURC);
  the executor harness at the executor's address (`test/utils/SettlementTestBase.sol:139-144`)
  composes A's order id into a swap in B.
- Call: `harness.payWithPlan{value: amountIn}(idA, commands, inputs)` with the swap's `poolKey`
  = B and `hookData = abi.encode(idA)`.
- Selector: wrapped `PoolDoesNotMatchOrder(idA)` in `beforeSwap` — existing
  (`src/V4SettlementHook.sol:96`, refused at `:183`). Reason: the pool id covers both
  currencies, the fee, the tick spacing and the hook; the order binds exactly one.
- A1-A5: the payment refusal set; the order stays `Paying` only inside the harness's own frame
  and is unwound with the revert.
- A6 control: `harness.planFor(idA)` in A settles once (the pattern at
  `test/V4SettlementHook.t.sol:283-286`).

### Row 4 — worthless third token

- Precondition: an attacker's ERC-20 (`MockERC20("Worthless", "WORTH", 6)`,
  `test/attack/HostilePool.t.sol:36`) as `currency1`.
- Calls: (a) `manager.initialize(key{0, WORTH, hook}, price)`; (b) `createOrder(victim,
  key{0, WORTH, hook}, …)`.
- Selectors: (a) wrapped `NotTheSettlementShape(0, WORTH)` in `beforeInitialize` — existing
  (`src/V4SettlementHook.sol:82`, refused at `:156-158`); (b) `PayoutCurrencyNotAllowed(WORTH)`
  — existing (`src/SettlementExecutor.sol:101`, refused at `:151`). Under the policy both are
  unchanged: membership is by address in a compiled set. Reason: threat T2, a genuine receipt
  for worthless output (`docs/THREAT-MODEL.md:12`).
- A1-A5: no pool (`sqrtPriceX96` zero for the key), no order, no receipt.
- A6 control: `test_TheSanctionedPoolStillSettles` (`test/attack/HostilePool.t.sol:93-104`) and
  `test_AnyoneMayInitialiseTheSanctionedShape` (`:109-115`).

### Row 5 — lookalike token with matching decimals and symbol

- Precondition: an ERC-20 at a different address reporting `symbol() == "USDC"` and
  `decimals() == 6`.
- Calls: as row 4, (a) and (b).
- Selectors: as row 4. Reason: neither the library (`src/libraries/UniswapDeployments.sol:24-26`
  returns an address), the hook (`:156` compares addresses) nor the executor (`:151` compares
  addresses) reads a symbol or a decimals value; under the policy the decimals read of section
  2.3 step 5 happens after membership, so the lookalike is never called.
- A1-A5: as row 4.
- A6 control: as row 4. The value of this row is that the test names the lookalike, so that a
  future change that resolves an asset by symbol or decimals turns it red.

### Row 6 — token with unexpected decimals

- Precondition: a policy entry whose runtime reports decimals other than the entry's compiled
  value (a proxy upgrade, a mis-transcribed entry, a chain where the canonical token differs).
  In a test, the runtime is placed at the entry's address with `vm.etch`, the technique the
  suite uses at `test/SettlementExecutor.t.sol:286-288`.
- Call: `createOrder(…, key{0, ENTRY, …}, …, payoutCurrency = ENTRY)` with `decimals()`
  returning 18 while the entry says 6.
- Selector: `PayoutDecimalsUnexpected(ENTRY, 6, 18)` — proposed (section 2.3 step 5). Reason:
  today nothing reads decimals (`test/utils/SettlementTestBase.sol:102-103`: "v4 never reads
  decimals"; the suite runs its mock at 18 decimals at the USDC address, `:105`), so the only
  effect of a decimals change is on the meaning of `minOut`, which is exactly the number the
  payee relies on. A silent re-denomination of the floor is a settlement short in everything
  but arithmetic.
- A1-A5: registration refusal set.
- A6 control: the canonical runtime reports the entry's decimals and the order is created; on a
  fork, every entry's `decimals()` equals its compiled value. Read on 2026-09-05T16:21:30Z on
  Ethereum Sepolia: USDC 6, EURC 6 (section 5).

### Row 7 — reversed currency order

- Precondition: `key{currency0 = USDC, currency1 = address(0), hook}`.
- Calls: (a) `manager.initialize(key, price)`; (b) `createOrder(…, key, …)`.
- Selectors: (a) v4's own `CurrenciesOutOfOrderOrEqual(USDC, 0)` — existing
  (`lib/uniswap-hooks/lib/v4-core/src/PoolManager.sol:121-125`), before any hook is called;
  (b) `PayoutCurrencyNotAllowed(address(0))` — existing (`src/SettlementExecutor.sol:101`).
  Reason for (b): at line 151 `currency1` is `address(0)`, which is not the payout address;
  this fires before `NativeInputOnly` at line 155 would have named the shape. Under the policy
  `address(0)` is never a member, so the selector is the same.
- A1-A5: no pool, no order.
- A6 control: the sanctioned ordering, row 4's controls.

### Row 8 — native currency in the payout position

- Precondition: the payee's expected payout is native: `payoutCurrency = address(0)` and, for
  the pool, `key{0, 0}`.
- Calls: (a) `manager.initialize(key{0, 0, hook}, price)`; (b) `createOrder(…, key{0, 0, …},
  …, payoutCurrency = address(0))`.
- Selectors: (a) `CurrenciesOutOfOrderOrEqual(0, 0)` — existing, v4; (b)
  `PayoutCurrencyNotAllowed(address(0))` — existing (`:101`), by section 2.3 step 3. Reason:
  a native payout has no `balanceOf`; had it passed registration, `pay` would call
  `IERC20Minimal(address(0)).balanceOf` (`src/SettlementExecutor.sol:193`) and revert with no
  reason at the payer's expense. The named refusal one step earlier is the point.
- A1-A5: no pool, no order.
- A6 control: row 4's controls.

### Row 9 — payout recipient mismatch

- Precondition: a plan whose `TAKE` names an address other than `order.recipient`.
- Calls and selectors, by path:
  - (a) a stranger drives the official router with such a plan: wrapped
    `NotSettlementExecutor(stranger)` in `beforeSwap` — existing (`src/V4SettlementHook.sol:86`,
    refused at `:173-175`). The hook does not observe the `TAKE` recipient at all; it refuses
    the driver.
  - (b) through the real executor the recipient cannot differ: `_plan` writes `order.recipient`
    into the `TAKE` (`src/SettlementExecutor.sol:235`), and if a token delivered elsewhere the
    executor's measurement refuses with `RecipientShort(id, minOut, received)` — existing
    (`:106`, refused at `:203-205`).
  - (c) a recipient on the settlement path is refused at registration with
    `ReservedRecipient(recipient)` — existing (`:96`, refused at `:142-148`).
- Reason: invariant I1; the property is structural, not a comparison the hook makes. Note for
  the implementer: the executor harness (`test/utils/ExecutorHarness.sol:15-21`) does not run
  the executor's `RecipientShort` check, so a harness plan with a foreign `TAKE` delivers to
  the stranger by test fiat; that is a property of the harness sitting at the executor's
  address (`test/utils/SettlementTestBase.sol:136-138`), not a hole, and must not be written up
  as one.
- A1-A5: for (a) the stranger keeps every wei (asserted at `test/V4SettlementHook.t.sol:140`),
  no receipt; for (b) the payment refusal set; for (c) the registration refusal set.
- A6 control: `test_SettlementDeliversToTheRegisteredRecipient`
  (`test/SettlementExecutor.t.sol:45-69`), which asserts that the recipient and nobody else,
  the executor and the router included, received.

### Row 10 — stale or replayed order under a different currency

- Precondition: an order settled in USDC (`Settled`), or expired, or still `Open`; a plan
  presents its id in the ETH/EURC pool.
- Calls: `pay(id)` a second time; or `harness.payWithPlan(id, planInEurcPool)`; or one plan with
  two swaps, the second in the other pool.
- Selectors, in the order the code reaches them:
  - a settled, unknown or open id at the hook: wrapped `OrderNotInFlight(id, status)` —
    existing (`src/V4SettlementHook.sol:90`, refused at `:264`), which fires inside
    `_inFlightOrder` before the pool comparison at `:183`;
  - a settled id at the executor: `OrderNotOpen(id, Settled)` — existing
    (`src/SettlementExecutor.sol:114`, refused at `:184`);
  - an expired id: `OrderExpired(id, deadline)` at the executor — existing (`:115`, refused at
    `:185`), or wrapped at the hook (`src/V4SettlementHook.sol:92`, refused at `:179`) when the
    executor's check is bypassed;
  - a second swap in the same plan, other pool: wrapped `OrderAlreadySwapped(id)` — existing
    (`:98`, refused at `:178`), which precedes `PoolDoesNotMatchOrder` at `:183`.
- Reason: I5 and I4; the currency of the second attempt is irrelevant because the order is
  single-use and time-bound before it is pool-bound.
- A1-A5: the settled order stays `Settled` with `receiptCount` unchanged; the open order stays
  `Open`.
- A6 control: one settlement, one receipt (`test_Schema_DuplicateOrderIdCannotProduceTwoReceipts`,
  `test/ReceiptSchema.t.sol:154`).

### Row 11 — receipt currency disagreeing with the actual deltas

- Precondition: none reachable by input. `currencyOut` is `key.currency1` of the key the
  PoolManager passed to `afterSwap` (`src/V4SettlementHook.sol:244`), and `delta.amount1` is
  denominated in that same currency (`:189`, `:199`). Under the policy, `_afterSwap` also
  asserts `key.currency1 == order.payoutCurrency` before `_receipt` (section 2.4).
- Call: a settlement; the negative exists only by mutation: change line 244 to emit
  `PAYOUT_CURRENCY` or `key.currency0` and the schema test must fail.
- Selector: `PayoutCurrencyMismatch(order.payoutCurrency, key.currency1)` — proposed, and
  unreachable if registration held; it is defence in depth.
- Reason: the receipt is what an indexer records; its unit must be the unit the pool moved and
  the unit the payee expected, by assertion rather than by reading the code.
- A1-A5: not applicable to a positive; the requirement is that the positive holds in every
  policy currency.
- A6 control: `test_Schema_OneReceiptWhoseAmountsAreTheDeltasAndTheBalanceChange`
  (`test/ReceiptSchema.t.sol:72`) and `_assertReceiptData`
  (`test/SettlementExecutor.t.sol:106-128`, `currencyOut == usdc` at `:123`), run once per
  policy currency. On the live chain the control is the settlement transaction in the header:
  `currencyOut` USDC, `amountOut` 2003660, USDC `Transfer` 2003660.

### Row 12 — partial fill and failed transfer

- Precondition and call, three shapes:
  - (a) an order larger than the band can fill: `pay(idTooLarge)`;
  - (b) a token that delivers less than the pool credited (fee on take), placed at a policy
    address with `vm.etch`: `pay(id)` with `minOut` at the pool's credit;
  - (c) a token whose `transfer` reverts or returns false, placed the same way: `pay(id)`.
- Selectors: (a) wrapped `PartialFill(id, requested, consumed)` — existing
  (`src/V4SettlementHook.sol:100`, refused at `:197-198`); (b) `RecipientShort(id, minOut,
  received)` — existing (`src/SettlementExecutor.sol:106`, refused at `:203-205`); (c) v4's
  `ERC20TransferFailed` (`lib/uniswap-hooks/lib/v4-core/src/types/Currency.sol:35`, raised at
  `:82-85`) bubbled through the router; the whole payment reverts. Under the policy: unchanged,
  and (b) and (c) must run at every entry's address, not only the first.
- Reason: I3 where it is felt and I6; a settlement is whole or it is not a settlement.
- A1-A5: `_assertNothingMoved` (`test/SettlementExecutor.t.sol:530-543`) plus A4.
- A6 control: (a) `test_SettlementDeliversToTheRegisteredRecipient`; (b) the same order with
  `minOut` at the delivered amount settles, and the two records say what each measured
  (`test/SettlementExecutor.t.sol:319-331`).

### Row 13 — unsupported chain

- Precondition: `block.chainid` has no policy entry.
- Call: `new V4SettlementHook()`; the executor cannot exist without it
  (`src/V4SettlementHook.sol:117-123`).
- Selectors, in the order the constructor reaches them (`src/V4SettlementHook.sol:104-107`):
  - a chain hookmate does not know: `UnsupportedChainId()` with no argument, from
    `AddressConstants.getPoolManagerAddress` (`lib/hookmate/src/constants/AddressConstants.sol:6`,
    raised at `:70`), evaluated first as the `BaseHook` argument at line 104;
  - a chain hookmate knows but the policy does not (84532, 1301 and 421614 today,
    `AddressConstants.sol:57-68`): `UnsupportedChainId(chainId)` — existing
    (`src/libraries/UniswapDeployments.sol:10`), from the router lookup at line 105, which
    precedes the payout lookup at line 106.
  Under the policy `isPayoutCurrency` and `payoutDecimals` revert with the same library error;
  the deploy script refuses first with `Chains.requireTestnet` (`script/Chains.sol:27-32`).
- Reason: a hook must not exist on a chain whose payout set was never sanctioned.
- A1-A5: no code at the predicted address; nothing broadcast.
- A6 control: construction on 11155111 (`deploySettlement`,
  `test/utils/SettlementTestBase.sol:127-134`).

### Row 14 — no-code or noncanonical token address

- Precondition: a compiled entry with no code on the target chain (a mis-transcribed address,
  or an address copied from another chain), or with code that is not the issuer's token.
- Call: today nothing checks. The deploy path asserts code at the hook and the executor only
  (`script/LiveFire.s.sol:105`, `:118`, `:179`, `:356`); no script asserts code at the payout address, and `script/go-live.sh:69` and `script/LiveFire.s.sol:224` call `balanceOf` on it for the deployer's balance, so a codeless address fails the pre-flight at `go-live.sh:73` by accident rather than by a named check;
  the first `pay` reaches `IERC20Minimal(entry).balanceOf` (`src/SettlementExecutor.sol:193`),
  which returns no data from a codeless address, and reverts with an empty reason at the
  payer's expense.
- Selectors (all proposed): (a) at deploy time, the script asserts for every entry on
  `block.chainid`: `code.length != 0`, `decimals()` equal to the entry, and `symbol()` and
  `currency()` equal to the entry's expectation, before any broadcast; (b) the same four
  assertions as a fork test per entry; (c) at registration, `PayoutCurrencyHasNoCode(entry)`
  when `entry.code.length == 0`, so the order is refused where it is born rather than failing
  the payer.
- Reason: the policy is a table of addresses; a table is only as good as the check that each
  address is what the table says, on the chain it says.
- A1-A5: registration refusal set for (c); nothing broadcast for (a).
- A6 control: the entries on 11155111 as read on 2026-09-05T16:21:30Z: USDC, 1798-byte proxy
  runtime, `decimals()` 6, `symbol()` "USDC", `currency()` "USD"; EURC, 1798-byte proxy runtime,
  `decimals()` 6, `symbol()` "EURC", `currency()` "EUR" (section 5).

---

## 4. Coverage today

"Covered" means a named test asserts the row's selector and its control passes in the same
suite. "Partial" means the code path exists and a neighbouring test exercises it without
pinning the reason or the exact shape. "Gap" means no test represents the row. "Cannot be
expressed" means the row needs a second policy currency or an order field that does not exist,
so no test can be written against the current code; that is a gap, stated plainly.

| Row | Existing test | Status |
|---|---|---|
| 1 EURC expected, USDC pool | none; `Order` has no `payoutCurrency` (`src/SettlementExecutor.sol:53-62`) and 11155111 has one entry (`src/libraries/UniswapDeployments.sol:24-27`) | **cannot be expressed** |
| 2 USDC expected, EURC pool | none, as row 1 | **cannot be expressed** |
| 3 wrong pool key | `test_RevertWhen_PoolDisagreesWithTheOrder` (`test/V4SettlementHook.t.sol:249-265`), asserting wrapped `PoolDoesNotMatchOrder`, control at `:283-286` | **covered** for the fee-tier variant; the other-currency variant cannot be expressed |
| 4 worthless third token | `test_RevertWhen_AttackerInitialisesAPoolWithTheirOwnToken` (`test/attack/HostilePool.t.sol:35-60`): registration asserts `PayoutCurrencyNotAllowed` with its argument (`:53-56`); initialisation asserts a bare `vm.expectRevert()` (`:48`) | **partial**: the initialisation reason is not pinned; the spec requires wrapped `NotTheSettlementShape(0, WORTH)` in `beforeInitialize`. Controls covered (`:93-104`, `:109-115`) |
| 5 lookalike token | the row-4 test uses `("Worthless", "WORTH", 6)` (`:36`): decimals match USDC's six, the symbol does not; the code path is identical by address | **partial**: not represented by name |
| 6 unexpected decimals | none; nothing reads decimals (`test/utils/SettlementTestBase.sol:102-103`); the proposed entry decimals do not exist | **cannot be expressed** |
| 7 reversed order | `test_RevertWhen_CreateOrderRejectsBadInputs` (`test/SettlementExecutor.t.sol:252-255`) puts an ERC-20 in `currency0` with the payout still in `currency1` (`NativeInputOnly`); `test_RevertWhen_ThePoolShapeIsNotTheSettlementShape` (`test/attack/HostilePool.t.sol:68-77`) initialises an ERC-20 input with a bare `vm.expectRevert()` (`:76`) | **gap** for the reversed key itself (`currency1 == address(0)`), which today is refused at `src/SettlementExecutor.sol:151` and by v4 at initialisation; expressible today |
| 8 native in payout position | none | **gap**; expressible today (`PayoutCurrencyNotAllowed(address(0))`) |
| 9 recipient mismatch | `test_RevertWhen_OfficialRouterIsDrivenByAStranger` (`test/V4SettlementHook.t.sol:125-141`), `test_RevertWhen_RecipientIsAContractOnThePath` (`test/SettlementExecutor.t.sol:338-347`), `test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer` (`:281-332`), control `test_SettlementDeliversToTheRegisteredRecipient` (`:45-69`) | **covered** |
| 10 replay, other currency | `test_RevertWhen_OrderIsNotInFlight` (`test/V4SettlementHook.t.sol:180`), `test_RevertWhen_OrderPaidTwice` (`test/SettlementExecutor.t.sol:151-160`), `test_RevertWhen_OrderIsSwappedTwiceInOnePlan` (`test/V4SettlementHook.t.sol:270-286`), `test_RevertWhen_ExpiredOrderReachesTheHook` (`:201`), `test_Schema_DuplicateOrderIdCannotProduceTwoReceipts` (`test/ReceiptSchema.t.sol:154`) | **covered** in one currency; the other-currency variant cannot be expressed |
| 11 receipt currency vs deltas | `test_Schema_OneReceiptWhoseAmountsAreTheDeltasAndTheBalanceChange` (`test/ReceiptSchema.t.sol:72`), `_assertReceiptData` (`test/SettlementExecutor.t.sol:106-128`) | **covered** as a positive in one currency; the mutation control is not in the suite (no mutation harness in the tree); the EURC leg cannot be expressed |
| 12 partial fill, failed transfer | (a) `test_RevertWhen_PoolCannotFillTheOrder_NothingMoves` (`test/SettlementExecutor.t.sol:217-233`); (b) `test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer` (`:281-332`) with the stand-in `test/utils/FeeOnTakeERC20.sol` | (a) **covered**; (b) **covered**; (c) a reverting or false-returning transfer is a **gap**; expressible today with a second stand-in |
| 13 unsupported chain | none (`grep -rn UnsupportedChainId test/` returns nothing at `72cabd2`) | **gap**; expressible today with `vm.chainId(84532)` and the library's selector |
| 14 no-code or noncanonical address | none; no script or test reads the payout address's code | **gap**; the deploy-time and registration-time checks are proposed |

Counted at commit `72cabd2` with `grep -c 'function test' test/*.t.sol test/attack/*.t.sol`:
`test/V4SettlementHook.t.sol` 18, `test/SettlementExecutor.t.sol` 21,
`test/ReceiptSchema.t.sol` 5, `test/I7NativeSettle.t.sol` 6, `test/attack/HostilePool.t.sol` 4.
Of the fourteen rows: 4 covered, 2 partial, 5 gaps expressible against the current code, and
rows 1, 2 and 6 plus the second-currency halves of rows 3, 10 and 11 cannot be expressed until
the policy exists. Three bare `vm.expectRevert()` calls remain in the attack suite
(`test/attack/HostilePool.t.sol:48`, `:76`, `:87`); each should name its wrapped reason.

---

## 5. EURC readiness: what must be true before it is the second entry

None of the following is claimed to hold. Each is a condition with the check that proves it,
and the facts read while writing this are dated. Sources are cited by URL, retrieval time and the passage read at that time; every address was also read from the chain with the command shown. This repository keeps no copy of third-party pages.

### 5.1 Canonical address per chain

Uniswap's official deployments page currently lists the verified v4 and Universal Router stack on four testnets: Ethereum Sepolia, Base Sepolia, Unichain Sepolia, and Arbitrum Sepolia.
(<https://developers.uniswap.org/contracts/v4/deployments>, retrieved 2026-09-05T16:52Z. Under the heading "Testnet Deployments" the page lists Unichain Sepolia 1301, Sepolia 11155111, Base Sepolia 84532 and Arbitrum Sepolia 421614, and also two interop-alpha development networks, 420120000 and 420120001, each with a router entry; those two are outside this review. On each of the four named testnets the PoolManager, the Universal Router and the StateView were read from the chain on 2026-09-05 and the router and the StateView both report that PoolManager.)

Circle's EURC contract-address page (<https://developers.circle.com/stablecoins/eurc-contract-addresses>, retrieved
2026-09-05T16:12:09Z; live fetch 2026-09-05T16:21:24Z byte-identical) lists, in its testnet
table: "Ethereum Sepolia 0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4 Base Sepolia
0x808456652fdb597867f38412077A9182bf77359F". The rendered text of that page contains
"Unichain" zero times and "Arbitrum" zero times, while the USDC page (<https://developers.circle.com/stablecoins/usdc-contract-addresses>, retrieved
2026-09-05T16:12:09Z; live fetch byte-identical) lists "Unichain Sepolia
0x31d0220469e10c4E71834a79b1f276d740d3768F". Stated as the negative it is: Circle lists no
EURC on Unichain Sepolia and none on Arbitrum Sepolia. The EURC page does list "World Chain
Sepolia 0xe479EcA5740Ac65d6E1823bea2f1C08Bc14e954F", and that chain has no entry on the
Uniswap page above, so it is outside this specification.

Read-only RPC on 2026-09-05T16:21:30Z (`cast code`, `cast call`): on chain 11155111 the EURC
address holds a 1798-byte runtime, `decimals()` 6, `symbol()` "EURC", `name()` "EURC"; on chain
84532 the Base Sepolia address holds a 1798-byte runtime, `decimals()` 6, `symbol()` "EURC". On
chain 1301, `cast code` at both EURC addresses returns `0x` (2026-09-05T16:21:35Z), which is
consistent with the page and is not itself proof of absence at some other address.

**Condition C-A.** The second entry on 11155111 is exactly
`0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4`, transcribed from that page, and the
row-14 deploy-time assertions pass against it. No entry is added for any chain on which the
hook is not deployed, verified and live-fired.

### 5.2 Decimals

EURC reports 6 on Ethereum Sepolia and on Base Sepolia; USDC reports 6 on Ethereum Sepolia
(same reads). The test base runs its mock at 18 (`test/utils/SettlementTestBase.sol:105`), so
nothing in the suite today would notice a decimals change.

**Condition C-B.** The entry is compiled as `(address, 6)`; row 6's registration check and its
fork control exist and pass; the schema suite's positive (row 11) runs against the entry.

### 5.3 Transfer behaviour

The C4 bar is "non-fee-on-transfer, non-rebasing" (`specs/HOOK-SPEC.md:169`). The live-fired
USDC delivers whole: the header's transaction shows the PoolManager's USDC `Transfer` to the
recipient equal to the receipted `amountOut`, 2003660 for 2003660. That fact cannot be borrowed
for EURC on Ethereum Sepolia: both tokens are proxies, and on 2026-09-05T16:25:03Z their
implementations differ — USDC at `0xda317c1d3e835dd5f1be459006471acaa1289068` (23464 bytes,
keccak `f4898b09…`), EURC at `0x76a1b9e4712e45c4c3d0ac6e2c3028ee0ce4d3b0` (23464 bytes, keccak
`e20f5a42…`). Same size, different bytes. (On Base Sepolia, USDC and EURC share one
implementation, `0xd74cc5d436923b8ba2c179b4bca2841d8a52c5b5`, keccak `1254951e…`; that is a
fact about Base Sepolia only.)

**Condition C-C.** On a fork of 11155111, a `TAKE` of EURC out of the PoolManager delivers the
full credited amount to the recipient (a positive), and the fee-on-take and reentrancy
stand-ins (`test/utils/FeeOnTakeERC20.sol`, `test/utils/ReenteringERC20.sol`) are run at the
EURC address exactly as they are run at the USDC address today
(`test/SettlementExecutor.t.sol:281-332`, `:431-491`). Not run for this document.

### 5.4 Liquidity feasibility

An ETH/EURC pool carrying the hook does not exist and cannot exist until the entry is compiled
(row 4). When it can, it needs its own seed: Circle's faucet configuration, embedded as JSON in
the page (<https://faucet.circle.com>, retrieved 2026-09-05T16:52Z), names for chain "ETH" the currencies `["USDC","EURC","CIRBTC"]` and for
"BASE" `["USDC","EURC"]`, with a limit window of 3600000 ms; the amount per request is not in
the saved text. The live ETH/USDC pool holds liquidity 204325880000 (the day's chain record);
the seed stage refuses below a floor (`script/go-live.sh:71-73`, five USDC) and the deploy
continues past an existing pool only at the price it chose (`docs/THREAT-MODEL.md:11`, T2b).

**Condition C-D.** The deployer holds at least the EURC analogue of the seed floor from a
source that is named; the pool's initial price is chosen from a quoted source at seeding time
and recorded; the deploy refuses any other price (the T2b rule, unchanged); one settlement is
live-fired through the EURC pool with status 1 and its receipt read back, before any sentence
about EURC appears in a README.

### 5.5 Sponsor relevance

In the event's published prize text (<https://ethglobal.com/events/ethonline2026/prizes>, retrieved 2026-09-05T16:12Z and again at 16:52Z with identical bytes), "EURC" occurs twice in the rendered
text, both in Arc's tracks: "USDC or EURC payment flows on Arc added to a commerce, fintech, or
wallet product". No track of the sponsor whose stack the hook runs on names EURC. An EURC entry
on Ethereum Sepolia is therefore a payout-policy exercise, not sponsor evidence.

**Condition C-E.** EURC support, if built, is described as what it is: a second sanctioned
payout asset on Ethereum Sepolia. Arc qualification is never claimed from EURC support. Arc
mainnet is an announced 2026-09-16 launch per Circle's press release (<https://www.circle.com/pressroom/circle-announces-founding-validator-cohort-and-major-integrations-for-arc-ahead-of-september-16-mainnet-launch>,
retrieved 2026-09-05T16:12:10Z; live fetch 2026-09-05T16:21:26Z, bytes differ, rendered
passage "is on track for a public mainnet launch on September 16, 2026"), never an established
launch. Any deployment on Arc is outside this specification.
A third-party Arc deployment of the identified BUSL-covered v4-core files is not authorized by any readable Additional Use Grant found in this review.
The Change Date is reported as the earlier of 2027-06-15 or a qualifying ENS-set date.
No deployment should occur without legal review.
This is licensing research, not legal advice.

### 5.6 The order of work, if the conditions are met

1. Rows 7, 8, 12(c), 13 and the reason-pinning of row 4: expressible today, no policy needed.
2. The policy library with two entries on 11155111 and the `Order` field; rows 1, 2, 6 and the
   second-currency halves of rows 3, 10 and 11, each red first with its control green.
3. Conditions C-A to C-D on a fork, then the new addresses (the hook's creation code changed),
   a new deployment, a new source verification, and one live-fired EURC settlement.
4. Only then the README, and only the sentence the evidence earns.

---

## What this specification does not decide

- The input currency: native ETH only (`src/SettlementExecutor.sol:128`, `:155`). A token input
  is a different specification.
- A fee, or a `policyId`: both reserved and zero (`src/V4SettlementHook.sol:62-64`,
  `docs/RECEIPT-SCHEMA.md:27-28`).
- Any chain other than 11155111. The library's error for every other chain is the whole of
  this document's position on them.
