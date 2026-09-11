# Batch B — the experimental settlement, proved locally, and what is NOT proved

Entirely local. **No chain write was made.** No deploy, no approval, no pool initialization, no
liquidity, no CRE registration, no settlement broadcast, no Pages change. `main` is untouched and
the live V3 generation is byte-identical to `main`.

## 1. The architecture, and its largest departure

```
payer's ERC-20  →  bounded allowance  →  executor  →  PoolManager.unlock()
                                                   →  swap (hook enforces)
                                                   →  sync / transfer / settle
                                                   →  take → MERCHANT, directly
                                                   →  executor measures delivery → Settled
```

**There is no router and no Permit2.** V3 reaches the pool through Uniswap's Universal Router,
which for an ERC-20 input would need a Permit2 leg. Two facts made that the wrong choice:

- the router build on chain 46630 decodes a **different parameter head** than the one V3 encodes,
  and refuses the other with an empty revert that names nothing;
- Permit2 there is byte-verified but **has never had a signature transfer run against it**.

Rather than trust two unverified things, the executor takes the PoolManager's lock itself.

| Gained                                                                                                      | Cost                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| The hook's `sender` **is** the executor — an identity the PoolManager establishes, not one a router reports | The payer must grant an ERC-20 allowance first: two transactions where a Permit2 signature would have been one |
| The parameter-layout hazard disappears entirely                                                             | A payer who approves more than the order keeps a standing allowance. Stated, not hidden                        |
| Direct PoolManager → merchant delivery in one `take`                                                        | —                                                                                                              |

**Direct delivery is achieved.** The payout goes from the PoolManager to the merchant in a single
`take`. It never touches the executor, so there is no moment at which it could be stranded or swept.

## 2. Enforcement allocation, as built

| Enforced by the HOOK                                      | Enforced by the EXECUTOR                            |
| --------------------------------------------------------- | --------------------------------------------------- |
| Pool shape at `beforeInitialize`                          | Recipient fixed, reserved recipients refused        |
| Caller is the executor                                    | Order uniqueness, status machine, replay            |
| Order in flight, not already swapped this tx              | Deadline (again), payer binding                     |
| Deadline                                                  | Bounded allowance, read before value moves          |
| Swap direction **derived** from the key, never hard-coded | Input measured on arrival (`InputNotExact`)         |
| Amount matches the order                                  | Exactly one receipt (`NoReceipt`)                   |
| Pool id matches the order                                 | **Merchant's own balance delta** (`RecipientShort`) |
| Full fill; output ≥ minimum, by pool delta                | Zero residual input and payout                      |
| —                                                         | Reentrancy latch                                    |

**The hook never claims the merchant was paid.** At `afterSwap` the pool's delta is authoritative
about the _swap_ and silent about delivery — `take` has not run yet. Only the executor's measurement
after the lock closes may end an order.

`SettlementReceipt` (hook) is evidence. `Settled` (executor) is the success signal, emitted only
after delivery is measured. A test asserts the ordering.

## 3. The decimal finding

A Uniswap pool prices **raw units** and has never read `decimals()`. A pool initialised at
sqrtPrice 1:1 between an 18-decimal and a 6-decimal token is 1:1 in raw units and **1e12:1** in the
only terms anyone cares about — this settlement pays ~4.99e17 raw uTUSD for 1e18 raw mTSLA, which
reads as 499 billion uTUSD.

Two consequences, both load-bearing for any real chain:

1. A pool for a real pair **must** be initialised at a sqrtPrice already carrying the decimal
   difference. A reused 1:1 constant is a 1e12 error that every quote and every deviation check
   inherits.
2. **`minOut` is the only protection that does not care.** It is an absolute integer in the payout
   token's own units, so it binds correctly whatever the pool believes the price to be — which is
   precisely why the on-chain floor, and not an off-chain quote, is what must be enforced.

## 4. Local test assets

| Asset            | Symbol  | Decimals | Mint authority  | Note                                                                             |
| ---------------- | ------- | -------- | --------------- | -------------------------------------------------------------------------------- |
| Mock stock input | `mTSLA` | 18       | anyone, in-test | Not the faucet contract. A conventional ERC-20 stand-in                          |
| Payout           | `uTUSD` | 6        | anyone, in-test | **UNICA Test Dollar.** Not a stablecoin and no claim to be one; nothing backs it |

**No Circle name, no USDC symbol, no branding.** Chain 46630 carries four contracts using the
symbol `USDC` — two at 18 decimals — and six using `USDG`. Naming a fixture USDC would import that
ambiguity into the tests and into any screenshot of them. **Local use establishes nothing whatever
about a payout token's suitability on any real chain.**

## 5. Tests: 27 passing — and the sabotage result, which matters more

`forge test --match-path 'test/experimental/StockSettlement.t.sol'` → **27 passed, 0 failed.**
Full contract gate: **34 suites, 325 tests, 0 failed.**

A green suite is a claim. This is what it is worth, each check deleted one at a time:

| #   | Check deleted                   | Suite result        | Caught? |
| --- | ------------------------------- | ------------------- | ------- |
| A   | Hook: caller is the executor    | 26 passed, 1 failed | **yes** |
| B   | Hook: `PartialFill`             | 27 passed, 0 failed | **NO**  |
| C   | Hook: `OutputBelowMinimum`      | 27 passed, 0 failed | **NO**  |
| D   | Executor: `RecipientShort`      | 27 passed, 0 failed | **NO**  |
| E   | Executor: reentrancy latch      | 27 passed, 0 failed | **NO**  |
| F   | Executor: `InputNotExact`       | 26 passed, 1 failed | **yes** |
| G   | Executor: payer binding         | 26 passed, 1 failed | **yes** |
| H   | Executor: unlock-callback guard | 26 passed, 1 failed | **yes** |
| I   | Executor: residual-input check  | 27 passed, 0 failed | **NO**  |

**Four of nine.** Five security-critical checks are present in the code and **not evidenced by any
test.** Stated plainly because a 27-green suite would otherwise read as proof of a design that is,
on this evidence, only 44% proved.

Why each gap exists, so it can be closed rather than argued about:

- **B** — no row drives a genuine partial fill; the pool always fills completely at these sizes.
- **C and D are mutually redundant.** The hook's delta check and the executor's balance check both
  catch an underpayment, so deleting either leaves the other. Isolating them needs a row where only
  one can fire.
- **E** — the PoolManager's own lock already rejects a nested `unlock`, so the latch is defence in
  depth here rather than the only defence. Real, and not what the test proves.
- **I** — no row creates a residual balance.

One earlier defect was caught by this method and fixed: the token-hazard rows originally asserted
that the _fixtures_ took a fee and returned false, which proved the fixtures worked and nothing
about the executor. Deleting `InputNotExact` left the suite fully green. The rows now drive the
executor and F is caught.

### 5a. The five gaps, closed (2026-09-10)

The table above is left as it was measured. What changed since is a second suite,
`test/experimental/StockSettlementGaps.t.sol`, which isolates each check the first suite could not
tell apart, and a sabotage run repeated by the same method: each check deleted from a scratch copy of
the tree, its row required to go red, the check restored. Every row was first required to be GREEN on
the unmodified copy, so a red verdict below means the deletion caused it.

| #   | Check deleted                              | Row | Caught? |
| --- | ------------------------------------------ | --- | ------- |
| B   | Hook: `PartialFill`                        | G1  | **yes** |
| C   | Hook: `OutputBelowMinimum`                 | G2  | **yes** |
| D   | Executor: `RecipientShort`                 | G3  | **yes** |
| E   | Executor: reentrancy latch                 | G4  | **yes** |
| I   | Executor: residual-input check             | G5  | **yes** |
| —   | Executor: residual-payout check            | G6  | **yes** |
| —   | Executor: a `false` return read as success | G7  | **yes** |
| —   | Executor: an empty return read as failure  | G8  | **yes** |

**Eight of eight**, including three checks the table above never listed. With the four already
caught (A, F, G, H), the twelve checks named in these two tables each have a row that fails without
them. That is not every check in the two contracts: others — `ParamsDoNotMatchOrder`,
`PoolDoesNotMatchOrder`, `OrderAlreadySwapped`, `SettlementDidNotClose`, `NoReceipt` among them —
have not been through a sabotage run, and nothing here says they are evidenced.
A negative control confirmed the harness discriminates: with `RecipientShort` deleted, the unrelated
row G1 stayed green and only G3 went red.

What made the difference, so it is not relearned:

- **A bare `expectRevert()` accepts any revert.** Where two checks guard one property, deleting the
  first lets the second fire and a bare row stays green. Every row in the new suite names the exact
  error and its arguments.
- **A hook's revert reaches the payer wrapped.** The PoolManager re-throws it as
  `WrappedError(hook, callback, reason, HookCallFailed)`, so the rows unwrap that envelope and compare
  the hook's own reason inside it.
- **The latch is not only defence in depth.** The note on E above was right about a payout token
  re-entering inside the PoolManager's lock, and incomplete: an INPUT token can re-enter from
  `transferFrom`, before `pay` has taken the lock, where nothing but the latch refuses it. G4 drives
  exactly that. Without the latch, the inner payment settles inside the outer one and the outer then
  reverts on `NoReceipt` — a legitimate payment becomes impossible.
- **C and D are separated by making only one of them true.** G2 has the pool itself produce one unit
  below the floor, so the hook refuses. G3 has the pool pay in full while the payout token delivers
  1% short, which only the merchant's measured balance can see.

Still true after this: every row ran locally, against fixtures. None of it is evidence about a real
faucet-issued token, a real payout token, or chain 46630.

## 6. CRE trust boundary

**CRE is outside the trusted settlement boundary and nothing here trusts a CRE report.** No
authorization report is constructed, verified, or referenced by any contract in this generation.
Every invariant in §2 holds with CRE absent, stale, unavailable, or hostile — none of them reads
anything a workflow produces.

This is forced, not chosen: Batch A established that nothing in this repository establishes how an
on-chain contract would verify a CRE report, and that Deploy Access is not enabled.

Not claimed anywhere: DON-verified, CRE-authorized, cryptographically attested.

## 7. Target-chain compatibility — read-only

| Assumption          | Chain 46630                                            | Status                                         |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| PoolManager runtime | 24,009 bytes, identical to the local build             | compatible                                     |
| Universal Router    | 24,546 bytes, six-field layout                         | **not used by this generation**                |
| Permit2             | present, 9,152 bytes                                   | **not used**; behaviour still untested         |
| Hook address bits   | low 14 must equal `0x20C0`                             | same rule; a target hook must be **mined**     |
| Local hook address  | derived from a local string, **no salt produces it**   | **unsuitable for deployment**, by construction |
| Payout token        | no verified candidate; `payoutCurrency(46630)` reverts | **blocker**                                    |
| Pool with our hook  | none exists                                            | **blocker**                                    |

## 8. Program permission — the write blocker

| Activity                            | Classification    |
| ----------------------------------- | ----------------- |
| Deploy a test contract to a testnet | PERMITTED         |
| **Deploy a custom test token**      | **UNRESOLVED**    |
| **Initialize a Uniswap v4 pool**    | **UNRESOLVED**    |
| **Seed liquidity**                  | **UNRESOLVED**    |
| Register/deploy a CRE workflow      | REQUIRES-APPROVAL |
| Sponsored or reimbursed gas         | UNRESOLVED        |
| Disclose addresses and tx hashes    | PERMITTED         |
| Deploy to any mainnet               | UNRESOLVED        |

The three activities Path 2 needs are all UNRESOLVED. **No chain-write plan is proposed.** The
questions that would settle them are drafted and awaiting the organizer.

## 9. What is NOT proved

- Anything about chain 46630. Every row here ran locally.
- ~~The five unevidenced checks in §5.~~ Closed locally on 2026-09-10; see §5a.
- Any behaviour of a real faucet-issued token, a real payout token, or real liquidity.
- That a hook-enabled pool can be created there, or that anyone may create one.
