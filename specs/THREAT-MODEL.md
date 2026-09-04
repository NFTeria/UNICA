# ⟠ Settle-and-Swap Hook — THREAT MODEL

**Stamped 2026-08-21.** WAR-ROOM ONLY. Written **before** the build window opens —
spec and threat-model work before Sep 4 is legal prep; hook *code* is not.

Design under analysis: [`HOOK-SPEC.md`](HOOK-SPEC.md) v2 (router-gated).
Format follows the author's prior audit-findings and invariants layout
(prior art only — neither file is referenced by this repo).

> **The rule this document exists to enforce:** every surface below names a
> **defense** *and* a **negative test that must fail before it passes**. A suite
> that never went red proves nothing (cheatcode #22). Silence is not evidence.

---

## The two real exploits this design is calibrated against

Both were **application/hook code**, not v4 core. v4-core itself shipped after five
audits and a $15.5M bug bounty.

| Incident | Loss | Root cause | What it teaches us |
|---|---|---|---|
| **Cork Protocol** (2025-05-28) | ~**$12M** | `onlyPoolManager` applied to `unlockCallback` but **not to `beforeSwap`** | `onlyWhenUnlocked` is **global** — anyone can unlock the PoolManager and then call your hook **directly** during that window |
| **Bunni v2** (2025-09-02) | ~**$8.4M** | rounding in idle-balance accounting, weaponized over 44 tiny withdrawals | **The PoolManager's settlement invariant held the entire time.** Balanced ≠ correct |

---

## T1 — Missing `onlyPoolManager` on a callback ★ the #1 killer

**Attack.** Attacker calls `poolManager.unlock()` themselves (permissionless), and
while the manager is unlocked calls our `beforeSwap` **directly** with a crafted
`PoolKey` and `hookData`. Our gate logic runs outside any real swap.

**Violates:** I1, I4, I5 — every `beforeSwap`-enforced invariant at once.

**Defense.** `onlyPoolManager` on **every** callback, not just the ones that look
dangerous. Inherit OZ `uniswap-hooks` `BaseHook`/`SafeCallback` rather than
hand-rolling. Our existing receipt hook already does this correctly — reuse the
pattern, write it fresh.

**Negative test.** `test_BeforeSwap_DirectCall_Reverts` — unlock the manager from an
attacker EOA, call `beforeSwap` directly, expect `NotPoolManager`. **Must fail if
the modifier is removed.**

---

## T2 — Unvalidated `PoolKey` / hostile pool

**Attack.** Anyone can create a pool carrying our hook with attacker-chosen
currencies (e.g. WORTHLESS/USDC), then "pay" a merchant in worthless tokens. Our
event trail records a settlement that never delivered value.

**Violates:** I1 (economically), I2 (the receipt lies).

**Defense.** Allowlist **pools**, not just tokens: `if (!allowedPools[key.toId()])
revert InvalidPool();`. Gate `beforeInitialize` or bind the allowlist at deploy.
*(Class: Doppler C-01, Semantic Layer SVFHook.)*

**Negative test.** `test_Swap_UnallowedPool_Reverts` — initialize a second pool with
our hook and junk currencies, attempt settlement, expect `InvalidPool`.

---

## T3 — `hookData` is attacker-controlled

**Attack.** A payer supplies a `hookData` naming a different merchant, a lower
`minOut`, a later deadline, or a smaller fee. Nothing in v4 authenticates it.

**Violates:** I1, I2, I3, I4, I5 — the entire spec, if trusted.

**Defense (C1 in the spec).** `hookData` carries **only an `orderId`**. Every
enforced value is read from hook storage, written by an authenticated
`registerOrder()`. `hookData` is an index, never a source of truth.

> Our own receipt hook's NatSpec already states this honestly: *"attribution is
> unverified and self-asserted… anyone can emit a receipt naming any merchant."*
> Carry that honesty forward — and this time, close the hole.

**Negative test.** `test_HookData_ForgedMerchant_Ignored` — settle with `hookData`
encoding an attacker payout address alongside a valid orderId; assert the emitted
receipt and the `take()` destination both use the **registered** merchant.

---

## T4 — `BalanceDelta` sign conventions ★ the notorious footgun

**The convention, stated once.** Signs are from the perspective of the address whose
ledger the delta applies to:
- **Negative = that address OWES the PoolManager** (debit; resolve via
  `sync` → transfer → `settle`)
- **Positive = the PoolManager OWES that address** (credit; claim via `take`)

For the `swapDelta` credited to the router: **input negative, output positive.**

> ⚠️ **The inversion that trips people:** `afterSwap`'s return value uses the
> *opposite feel* — *"Positive: the hook is owed/took currency; negative: the hook
> owes/sent currency."* You return **positive to take**. Then core applies
> `swapDelta = swapDelta - hookDelta`.

Evidence this genuinely confuses shipping developers: StabL's hook contains the
comment *"V4 may pass the output as a positive int128 … rather than negative. We
handle both conventions"* and then takes `abs()`. **There is one convention. That
code is guessing.** We will not guess.

**Defense.** We return **zero delta** (§2 rejected alternative) — the whole class is
mostly designed out. Where we *read* deltas (I3), assert the sign explicitly.

**Negative test.** `test_AfterSwap_ReturnsZeroDelta` + an I3 test that fails if the
realized-output sign is read backwards.

---

## T5 — Flag / permission mismatch ★ fails silently

**Attack.** Not an attack — a self-inflicted, silent break. Permissions live in the
hook's **address bits**:

| Mismatch | Result |
|---|---|
| Bit set, callback missing | revert |
| Callback implemented, bit missing | **silent no-op** |
| Returns-delta bit missing while returning a delta | **delta silently ignored** → `CurrencyNotSettled` |

`isValidHookAddress` does **not** catch a missing returns-delta bit. Real shipped
bug: Sorella Angstrom (all swaps reverted). The Crypto-UPI hook has the same shape
live today — it declares `afterSwapReturnDelta: false` yet calls
`poolManager.mint(...)` and returns `0`.

**Defense.** Our flags are `beforeSwap | afterSwap` = **`0xC0`**, and we return no
deltas. Assert the **mined address bits == the declared `getHookPermissions()`**,
read off the deployed contract (our existing deploy script's two-assert pattern).

**Negative test.** `test_MinedAddress_MatchesDeclaredPermissions` — must fail if the
mask and the declared permissions drift apart.

---

## T6 — Reentrancy inside the unlock window

**Attack.** State cached in `beforeSwap` and read in `afterSwap` is overwritten by a
reentrant swap between the two — via a second pool sharing our hook's storage, or a
callback-enabled token.

**Violates:** I3, I5 (a consumed orderId could be re-armed mid-flight).

**Defense.** **v4 gives no reentrancy protection inside the unlock window** — `swap`,
`take`, `settle`, `mint`, `burn`, `donate` are merely `onlyWhenUnlocked`, with no
per-pool and no per-hook guard. So: key temporary state by `(PoolId, caller)`, clear
it post-use, mark `orderId` consumed **before** any external effect (CEI), and add
our **own** guard on our callbacks.

**Negative test.** `test_Reentrancy_SecondSwapCannotOverwriteOrderState` — a
malicious token whose transfer hook re-enters `swap` on a second hooked pool; assert
the first settlement's invariants still hold.

---

## T7 — Fee-on-transfer / rebasing tokens

**Attack.** Payout token charges a transfer fee. `take()` moves the nominal amount;
the merchant receives less. **I3 passes on-chain while the merchant is underpaid.**

**Violates:** I3 (silently — the worst kind).

**Defense (C4).** Allowlist payout assets to non-FoT, non-rebasing tokens — the
right call for a payments product. Fallback: measure the merchant's realized balance
delta rather than trusting nominal.

**Negative test.** `test_FeeOnTransferToken_Rejected` — register an order with a
2%-fee token; assert it is refused at registration, not discovered at settlement.

---

## T8 — Revert-DoS on the exit path (I6 in reverse)

**Attack.** A non-essential operation reverts on an otherwise valid payment — event
emission, a fee-split division, an oracle read — and bricks settlement.

**Violates:** I6, the money-path law.

**Defense.** Nothing non-critical may revert a valid payment. Fee arithmetic must be
overflow-safe and total-preserving; wrap any non-critical external call in
`try`/`catch`. **A payments rail that bricks on an edge case is worse than one that
occasionally under-attributes.**

**Negative test.** `test_Settlement_SucceedsWhenNonCriticalPathFails` — force the
optional path to revert; assert the merchant is still paid.

---

## T9 — Dust / `clear()` settlement DoS

**Attack.** Donated-but-unsynced dust leaves a non-zero delta, so `unlock()` reverts
`CurrencyNotSettled` and the pool is permanently unusable for settlement.

**Defense.** Never rely on `clear()` for a non-exact amount — it requires an **exact**
match (`MustClearExactPositiveDelta`). Settle explicitly; assert
`NonzeroDeltaCount == 0` at the end of our own `unlockCallback`.

**Negative test.** `test_DustDonation_DoesNotBlockSettlement`.

---

## T10 — Cross-chain replay

**Attack.** The same signed order or `orderId` replayed on another chain where our
router is also deployed.

**Violates:** I5.

**Defense.** Domain-separate the consumed key by `block.chainid` (and by router
address if more than one may exist per chain).

**Negative test.** `test_OrderId_ReplayOnForkedChainId_Reverts` — `vm.chainId()` to a
second id, replay, expect revert.

---

## T11 — NoOp rug pull (`beforeSwapReturnDelta`) ★ designed out, stated anyway

**Attack.** A hook holding the `beforeSwapReturnDelta` bit returns a delta claiming it
handled the entire swap. The PoolManager accepts the claim and settles. The hook keeps
the input and delivers no output — the payer loses the whole amount.

Uniswap's own security skill ranks this **the single most dangerous permission** (bit 10,
CRITICAL, the only CRITICAL of the fourteen).

**Violates:** I1, I3 — the payer pays and the merchant receives nothing.

**Defense — structural, not procedural.** Our flags are **`0xC0`
(`beforeSwap | afterSwap`) and nothing else.** Every returns-delta bit stays unset, so
the PoolManager will not accept a delta from us at all. The attack is **unreachable by
construction**, not merely unused. This surface is written down precisely because a
v4-literate judge looks for it by name, and "we never enabled it" is the answer.

**Negative test.** Covered by T5's `test_MinedAddress_MatchesDeclaredPermissions` — any
drift that sets a returns-delta bit turns that test red before it can ship.

---

## T12 — Unbounded-loop gas exhaustion

**Attack.** A callback iterates a collection an attacker can grow — an allowlist, a
registered-order sweep, a participant array. Cost climbs until `beforeSwap` exceeds the
gas available inside the swap, and every settlement on the pool reverts. Denial of
service with no funds stolen and no way to recover, since the array only grows.

**Violates:** I6 (never strand) — valid payments stop completing.

**Defense.** No unbounded iteration in any callback, full stop. Allowlists are mapping
lookups (`O(1)`), never array scans. Any batch operation lives in an admin path outside
the swap, with an explicit cap.

**Budgets — Uniswap's published numbers, adopted as ours:**

| Callback | Target | Hard ceiling |
|---|---|---|
| `beforeSwap` | **< 50,000 gas** | 150,000 gas |
| `afterSwap` | **< 30,000 gas** | 100,000 gas |

Profile against these and publish both numbers — a hook measured against Uniswap's own
budget is a checkable claim, and checkable claims are the currency of the write-up.

**Negative test.** `test_BeforeSwap_GasUnderBudget` — assert measured gas stays under the
target; the test must go red when a loop is introduced. Pair with
`forge test --gas-report`.

---

## T13 — Spot-price manipulation of the slippage floor

**Attack.** The `minOut` protecting I3 gets derived from a single-block on-chain price.
An attacker flash-loans the pool off its true price, registers or settles an order
against the distorted quote, and the slippage floor authorises a bad fill. The invariant
reports success while the merchant is underpaid — the T7 failure shape reached through
pricing rather than through the token.

**Violates:** I3 (silently).

**Defense.** `minOut` is a value the **merchant fixes at registration**, never a number
the contract reads from a manipulable source at settlement time. Any future price read
uses a TWAP over a stated window plus a staleness bound, never a spot quote.

> **We have lived the adjacent failure.** Access0x1's Arc deployment reverts
> `OracleLib__StalePrice()` because a mock feed sat past the router's 1h staleness window.
> A price source carries two obligations — resistance to manipulation *and* proof of
> freshness. Meeting one alone still breaks the rail.

**Negative test.** `test_MinOut_IsRegistered_NotDerivedFromSpot` — move the pool price
hard between registration and settlement; assert the enforced floor is unchanged.

---

## Not reachable by construction (stated so the absence is deliberate)

| Surface | Why it cannot reach us |
|---|---|
| **Liquidity lock trapping LPs** (`beforeRemoveLiquidity` blocks withdrawal forever) | That callback is unflagged. `0xC0` carries no liquidity permissions, so the PoolManager never calls us on an LP path. |
| **LP-amount tampering** (`afterAddLiquidityReturnDelta`, `afterRemoveLiquidityReturnDelta`) | Both bits unset — see T11. |

A stated negative beats an absence. Each row above is a claim a judge can verify against
the deployed address in one `cast code` call.

## Coverage map — invariant → the threats that attack it

| | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **I1** recipient | ● | ● | ● | | ● | | | | | | ● | | |
| **I2** fee event | | ● | ● | | ● | | | ● | | | | | |
| **I3** slippage | | | ● | ● | ● | ● | ● | | | | ● | | ● |
| **I4** deadline | ● | | ● | | ● | | | | | | | | |
| **I5** replay | ● | | ● | | ● | ● | | | | ● | | | |
| **I6** never strand | | | | | | | | ● | ● | | | ● | |

Every invariant is attacked from at least three directions. **No row is empty and no
column is unused** — a stated negative beats an absence (cheatcode #26).

## Open — resolve during the build, not before

1. **Exact-in vs exact-out.** Merchants want *exactly X of asset Y* (exact-output),
   but exact-output changes which currency is "unspecified". Our router-gate design
   is agnostic — confirm on a real pool in week 1 and write the answer here.
2. **Registration authority.** Who may call `registerOrder()`? Merchant-signed
   (EIP-712) is stronger than owner-only but costs a day. Default: owner/settler-only
   for the hackathon, EIP-712 noted as roadmap.
3. **Multi-pool storage sharing** — if one hook instance serves many pools, T6's
   blast radius grows. Default to one allowlisted pool for the demo.

## Sources

Trail of Bits *"Building secure Uniswap v4 hooks"* (2026-07-30) · Cyfrin v4 hooks
deep dive · CertiK v4 hook security considerations · Certora v4 threat model ·
Dedaub + Cork post-mortem · Bunni v2 post-mortem · OpenZeppelin v4-core audit ·
v4-core `PoolManager.sol` / `Hooks.sol` / `IHooks.sol` · Uniswap BeforeSwapDelta
guide · Uniswap "Accessing msg.sender" · **Uniswap Labs' own `uniswap-hooks@uniswap-ai`
v1.6.0 skill** (T11–T13 and the gas budgets came from it — reviewed, with three verified
compile-breaking defects of its own, in [`UF-SKILL-REVIEW.md`](UF-SKILL-REVIEW.md)).
