# Gap report — `flash_liquidator.vy` cannot be tested honestly yet

**Raised by:** attempting to characterise the Vyper Uniswap v4 flash liquidator (slice D1).
**Status:** BLOCKED. **No source was committed and no test was written**, because writing one would
have meant inventing the protocol this contract liquidates.

| | |
|---|---|
| Source | `vypersetup/contracts/flash_liquidator.vy` (untracked) |
| SHA-256 | `647005799d57e89eb8a9ee9a7e98675e43f662cdd1dcc511bb95323f4ff0d701` |
| Provenance | **carried-in prior art**, pasted by the owner 2026-09-08, not authored here |
| Compiler | compiles under Vyper 0.4.3; the file's own `^0.4.0` pragma is a range that 0.4.0 rejects |
| Classification | remains **merely inventoried** in `docs/PRIOR-ART.md` |

## Gap 1 — the lending counterparty does not exist

The contract's whole premise is step 2 of its own comment: *"repay the borrower's debt, receive
collateral"*. It performs that through an interface it declares itself:

```
interface ILender:
    def liquidate(borrower: address, repay: uint256) -> uint256   # returns collateral seized
    def collateral_token() -> address
```

**Nothing in this repository implements that interface, and it is not the shape of any lending
protocol we could name:**

| Protocol | Its liquidation entry point |
|---|---|
| Aave v3 | `liquidationCall(address,address,address,uint256,bool)` |
| Compound v2 | `liquidateBorrow(address,uint256,address)` |
| Compound v3 | `absorb(address,address[])` |
| Morpho Blue | `liquidate(MarketParams,address,uint256,uint256,bytes)` |
| **ChallengeLending** | `liquidateUser(address)` — **`internal`** |

The last row is the important one, because ChallengeLending is the lending market this project is
otherwise working against. It has **no third-party liquidation at all**: `liquidateUser` is
`internal`, reachable only from `checkAllHF()`, which is `onlyRole(ADMIN_ROLE)`. And it pays nobody
— it decrements `positions[user].debt` and `positions[user].collateral` and emits an event. No
collateral is transferred to a liquidator, because there is no liquidator.

So this contract cannot be pointed at the challenge market, and there is no other market here to
point it at. A mock implementing `ILender` would be a mock of a protocol that does not exist, and a
green suite built on it would measure nothing but our own invention.

**What would unblock it:** name the lending protocol this was written against — a repository, a
deployed address, or an interface file — and the characterisation can proceed against a mock that
reproduces *its* semantics rather than an imagined one.

## Gap 2 — the delta extraction is wrong in one of the two currency orderings

Found while reading, and provable with arithmetic alone. Uniswap v4 packs `BalanceDelta` as
`(amount0 << 128) | uint128(amount1)`, both `int128`. The contract unpacks it as:

```
a0: int256 = delta >> 128            # arithmetic shift: sign-extends, correct
a1: int256 = delta - (a0 << 128)     # NOT sign-extended
```

`a1` recovers the low 128 bits as a non-negative number. When `amount1` is negative it comes back as
`2^128 - |amount1|` instead:

| Ordering | amount0 | amount1 | `coll_delta` seen | `assert coll_delta < 0 and usdc_delta > 0` |
|---|---|---|---|---|
| collateral is `currency0` | −500 | +100000 | −500 | **passes** |
| collateral is `currency1` | +100000 | −500 | 340282366920938463463374607431768210956 | **fails** |

So the contract works only when the collateral token sorts **below** USDC, and reverts with
`"swap dir"` otherwise — even though `liquidate()` explicitly accepts both orderings two lines
earlier. The correct extraction sign-extends the low word, for example
`a1 = convert(convert(convert(delta, uint256) & (2**128 - 1), uint128), int256)` adjusted for sign,
or simply reading `amount1` as `int128`.

This is recorded rather than fixed. Repairing a carried-in contract before its counterparty is known
would be guessing at what the rest of it should do.

## Gap 3 — "zero-capital" is not yet demonstrable

The header calls this *"Zero-capital liquidation"*. That claim needs the positive path to run with
no principal prefunded, and the positive path cannot run (Gap 1). It also needs the caveat the
header already gives — *"the manager must hold enough USDC to take"* — plus gas, which is always
funded. **The claim is not repeated anywhere in this repository's public documents** and must not be
until a test proves it.

## What was NOT done, deliberately

- No lending mock was written.
- No test was written against an invented interface.
- The source was **not** committed, because committing it would imply a counterparty exists.
- `vy/src/unica/calculator.vy` remains untracked and outside this work entirely.
- The delta bug was **not** repaired.

## The Chainlink boundary this preserves

Two separate stories, and this file keeps them apart:

1. **The challenge submission** is owner protection through direct `deposit(vETH)` or `repay(vUSD)`.
   It needs no swap, and `integrations/chainlink-cre-guardian/` implements it.
2. **UNICA Guardian** is third-party liquidation where Uniswap v4 flash accounting is genuinely the
   mechanism. That is what this contract is for, and it is blocked here.

Forcing a DEX into the first would add a failure point and earn nothing in the published scoring.
