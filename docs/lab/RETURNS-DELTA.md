# `beforeSwapReturnDelta` — a STUDY

> **THIS IS A STUDY, NOT A TOOL.** `src/lab/NoOpStudy.sol` is a laboratory artefact. It is not
> deployed, not imported by anything that ships, not a defence, and not something to reuse. It
> exists so this repository can *measure* what one Uniswap v4 permission actually permits, against
> Uniswap's real PoolManager bytecode, instead of repeating what everyone says about it.

**Classification of this document and the code it describes:** a local-fork behavioural study of
Uniswap v4 hook permissions. Nothing here was run on a live network. Nothing here proves anything
about any deployed hook other than the permission bits of one address, which are arithmetic.

---

## 0. The correction this study had to make to its own brief

The permission is commonly called **"bit 10"**. In a hook **address** it is **bit 3**.

`beforeSwapReturnDelta` is the eleventh field of `Hooks.Permissions` — index 10 — which is where the
number comes from. But the address flags are numbered from the other end:

Read it in the vendored source rather than here — this repository cites prior art and does not
reproduce it, so the two lines are named by position and left where they live:

| What it defines | Where | Shift |
|---|---|---|
| the before-swap returns-delta flag | `lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol`, line 44 | one shifted left by **3** |
| the after-add-liquidity flag | the same file, line 33 | one shifted left by **10** |

```sh
sed -n '33p;44p' lib/uniswap-hooks/lib/v4-core/src/libraries/Hooks.sol
```

**Address bit 10 is `afterAddLiquidity`.** A reviewer who tests a hook address for bit 10 learns
nothing at all about whether that hook can return a swap delta. This is not pedantry: it is the
difference between a check that works and a check that reads a different permission and reports
green. `test_BitTenIsNotTheReturnDeltaBit` is that correction, measured.

Everywhere below, "the bit" means **`1 << 3`, address mask `0x08`**.

---

## 1. What was measured

All seven rows run against the OFFICIAL PoolManager runtime — `SettlementTestBase` etches Uniswap's
own deployed bytecode at its canonical address and asserts its size — not a mock and not a local
recompile.

```sh
forge test --match-path test/lab/NoOp.t.sol
```

The recorded run needed four `--skip` flags that are **not part of this study**: sibling files in
`src/lab/` and `test/lab/` were being written in parallel sessions while these rows were measured
and did not compile, and `forge` compiles the whole tree before it runs one path. The exact command
that produced the output below was

```sh
forge test --match-path test/lab/NoOp.t.sol \
  --skip src/lab/NanoAuthorizationHook.sol --skip test/lab/NanoAuthorization.t.sol \
  --skip test/lab/Limits.t.sol --skip src/lab/LimitProbes.sol
```

Once those siblings compile, the plain one-line command runs the same seven rows.

```
Ran 7 tests for test/lab/NoOp.t.sol:NoOpStudyTest
[PASS] test_Attack_PayerPaysInFullAndReceivesNothing() (gas: 445846)
[PASS] test_BitTenIsNotTheReturnDeltaBit() (gas: 923)
[PASS] test_Control_HookHoldingBitTenBehaves_PayerIsPaid() (gas: 459570)
[PASS] test_Control_NoHook_PayerIsPaid() (gas: 451832)
[PASS] test_Sabotage_WithoutBitTen_TheSameTheftReverts() (gas: 465610)
[PASS] test_TheTwoStudyHooksCarryIdenticalPermissionBits() (gas: 1026)
[PASS] test_UnicaV1DoesNotHoldBitTen() (gas: 460)
Suite result: ok. 7 passed; 0 failed; 0 skipped
```

**checks run: 7, passed: 7, failed: 0.**

| # | Row | Pool's hook | Payer paid | Payer received | What it establishes |
|---|---|---|---|---|---|
| 1 | `test_BitTenIsNotTheReturnDeltaBit` | — | — | — | the bit is `1 << 3`; address bit 10 is `afterAddLiquidity` |
| 2 | `test_TheTwoStudyHooksCarryIdenticalPermissionBits` | — | — | — | the attacker and the well-behaved hook carry the SAME mask `0x88`; the sabotage control differs in the bit alone |
| 3 | `test_Control_NoHook_PayerIsPaid` | none | 0.001 ETH | 996 006 981 039 903 | CONTROL: this pool pays |
| 4 | `test_Control_HookHoldingBitTenBehaves_PayerIsPaid` | `PassiveDeltaStudy`, mask `0x88` | 0.001 ETH | 996 006 981 039 903 | CONTROL: a hook HOLDING the bit pays exactly what the hookless pool pays, to the wei |
| 5 | `test_Attack_PayerPaysInFullAndReceivesNothing` | `NoOpStudy`, mask `0x88` | 0.001 ETH | **0** | **THE FINDING** — and the hook holds the 0.001 ETH; the pool's price and liquidity never moved |
| 6 | `test_Sabotage_WithoutBitTen_TheSameTheftReverts` | `NoBitTenStudy`, mask `0x80` | 0 (reverted) | 0 | the same code without the bit cannot do it: `CurrencyNotSettled()` |
| 7 | `test_UnicaV1DoesNotHoldBitTen` | — | — | — | UNICA V1's live address does not hold the bit |

The contract and row names keep the colloquial "bit ten" so anyone searching for the familiar phrase
lands here; every assertion message names the real bit, `1 << 3`.

Rows 3 and 4 were written and made to pass **before** row 5 existed. Without them, "the payer
received nothing" is a sentence, not a measurement.

The payout figure is 18-decimal mock units (the local stand-in token), frozen in the test as
`EXPECTED_OUT`; the shortfall against the 0.001 ETH in is the 0.3% fee plus price impact at this
pool's liquidity. The live pool pays six-decimal USDC; this number is a local-fork number and is not a
claim about any live pool.

### The instrument, validated by sabotage

A check that has never failed is not a check. Each of these was broken on purpose, the failure
observed, and the file restored and confirmed identical by SHA-256.

| Sabotage | What broke | What the suite said |
|---|---|---|
| `NoOpStudy` returns `ZERO_DELTA` instead of claiming the swap | the attack becomes honest | `FAIL: the payer received payout currency; the attack did not reproduce: 996006981039903 != 0` |
| the delta is returned but `take` is deleted | the hook claims the swap and leaves the credit unclaimed | `FAIL: CurrencyNotSettled()` |
| `UNICA_V1_HOOK` repointed to `0x…0C8` (an address that DOES hold the bit) | row 7's subject | `FAIL: UNICA V1 holds beforeSwapReturnDelta: 8 != 0` |

Both files restored and confirmed byte-identical afterwards, by SHA-256 of the shipped files:

```
7b0db816305efdb78f1733c2da765739de89c404795ee3aa60358890afa6da20  src/lab/NoOpStudy.sol
49cb625e22fc48e03c03e51236048b26147a8f433725227f8db7b7f76a5c27da  test/lab/NoOp.t.sol
```

The second sabotage is itself a finding: a hook that claims the swap **must** take the input. It
cannot merely refuse to deliver and let the value sit — the unlock refuses to close. The value has
to go somewhere, and the bit lets the hook decide that somewhere is itself.

---

## 2. The mechanism, from v4-core

Three steps, each citable, so nobody has to take this document's word for it. Pins:
`v4-core` at `d153b048868a60c2403a3ef5b2301bb247884d46`, reached through `uniswap-hooks` at
`bd5287c4a9f5c22c2393f7587a9b357662916115`.

**Step 1 — the hook's returned delta is read only if the address permits it.**
`Hooks.sol:266-279`: inside `beforeSwap`, `if (self.hasPermission(BEFORE_SWAP_RETURNS_DELTA_FLAG))`,
then `amountToSwap += hookDeltaSpecified`. Returning `-amountSpecified` drives `amountToSwap` to
zero. The guard that follows only forbids flipping exact-input into exact-output; consuming the
whole amount is explicitly within range.

**Step 2 — the pool then does nothing.** `Pool.sol:320`: `if (params.amountSpecified == 0) return
(BalanceDeltaLibrary.ZERO_DELTA, …)`. No price move, no liquidity move, no tokens. Row 5 asserts
both `slot0.sqrtPriceX96` and the pool's liquidity are unchanged after the swap.

**Step 3 — the caller is billed for the hook's delta.** `Hooks.sol:306-312`: `hookDelta` is built
from that same `deltaSpecified` and `swapDelta = swapDelta - hookDelta`, above a comment saying the
caller has to pay for the hook's delta. `PoolManager.sol:224-226` then credits `hookDelta` to the
hook and debits `swapDelta` to the router. The hook takes its input inside `beforeSwap`; the debit
from `take` and the credit from step 3 cancel, so the hook's currency delta is zero at unlock and
nothing objects.

**The swap succeeds.** There is no revert to catch, no missing event to notice, no failed
transaction in the payer's history. `PoolSwapTest`'s own internal consistency requires
(`deltaAfter0 >= amountSpecified`, `deltaAfter1 >= 0`) are all satisfied by a payer who receives
zero. From the router's point of view nothing is wrong.

---

## 3. Defence — and the honest limit of it

**Nothing on-chain protects a payer here.** That is the finding, stated plainly, and the rest of
this section is the reasoning for it rather than a hedge.

The permission bits say a hook **MAY** return a delta. They never say it **WILL** behave. Row 4 is
that sentence turned into a measurement: `PassiveDeltaStudy` and `NoOpStudy` have byte-identical
permission masks (`0x88`), sit at addresses that differ only in bits nobody inspects, and produce
opposite outcomes for the payer — one pays out to the wei what a hookless pool pays, the other pays
out nothing. **An address is not an intent.**

### What a payer CAN check before signing

- **The mask itself**, offline, from the address alone — no RPC, no node, no trust:
  `uint160(hook) & 0x08 != 0` means this hook is *able* to consume a swap. That is a capability, not
  a prediction. Its only honest use is as a refusal criterion: *I do not route through hooks that
  hold this bit.*
- **Whether the hook has verified source** at that exact address, and whether the reader has
  actually read the `beforeSwap` body — not whether a badge is green.
- **Whether the address is one the payer already trusts** by name, from a list they control.
- **A simulation of the exact transaction** (`eth_call` / `debug_traceCall`) against current state,
  reading the payer's own balance deltas. This catches a hook that steals unconditionally.

### What a payer CANNOT check

- **That the hook will behave for THIS swap.** A hook can read `msg.sender`, `tx.origin`, block
  number, its own storage, an owner-flipped switch, or the swap size, and steal on the swaps that
  are worth stealing. A simulation proves what happened in the simulated state, not what will happen
  in the state the transaction actually lands in.
- **That the code will not change.** Verified source is verified for the deployed bytecode. A hook
  behind a proxy, or one holding `delegatecall`, or one with an admin-set target, can be honest at
  read time and hostile at execution time.
- **That "no delta bit" means safe.** It does not. A hook without the bit still runs code in
  `beforeSwap`/`afterSwap` and can revert, reorder, grief, or tax by other means. Absence of this
  bit removes exactly one attack, not a class.
- **Slippage protection does not cover it.** `sqrtPriceLimitX96` limits how far the *pool price*
  may move; here the price does not move at all. `amountOutMinimum` lives in a router, not in the
  PoolManager — and this study's row 5 runs through v4-core's own `PoolSwapTest`, which enforces no
  minimum at all. A payer whose router enforces a minimum would see this transaction revert; a payer
  whose router does not would see it succeed and lose the money. **The protection, where it exists,
  is entirely in the router, and it is the payer's job to know which router they are using.** That
  is the single most useful thing in this document for a payer, and it is not a property of v4.

### So the defence is

**Do not route through hooks you have not read, and use a router that enforces a minimum output.**
There is no on-chain mechanism that makes an unknown hook safe. Anything stronger than that sentence
would be this repository claiming something it did not measure.

---

## 4. UNICA V1 does not hold the bit

One command. It needs no network, because v4's permission bits **are** the low fourteen bits of the
address — this is a fact about the address itself, checkable by anyone holding it:

```sh
python3 -c "a=0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0; print(f'flags=0x{a & 0x3FFF:04X}  beforeSwapReturnDelta(bit 3)={(a>>3)&1}  afterAddLiquidity(bit 10)={(a>>10)&1}')"
```

```
flags=0x20C0  beforeSwapReturnDelta(bit 3)=0  afterAddLiquidity(bit 10)=0
```

`0x20C0` is `beforeInitialize | beforeSwap | afterSwap`. The return-delta bit is clear, so v4-core
never reads a delta from UNICA's hook: the branch at `Hooks.sol:266` is not taken, and
`amountToSwap` is the payer's amount, always. `test_UnicaV1DoesNotHoldBitTen` asserts both the bit
and the whole mask, and row 7's sabotage above shows that assertion is not vacuous.

That the address is UNICA's live deployment is a separate claim, evidenced elsewhere in this
repository (`make readback`, `docs/proof/`). This section proves only what the bits of that address
are.

---

## 5. The legitimate uses, and what each must get right

The bit is not a mistake in v4's design. It is the mechanism behind the features people build hooks
for. Each one is the same capability pointed somewhere useful.

| Use | What the bit buys | What it must get right |
|---|---|---|
| **JIT liquidity** | the hook can absorb part of the swap and fill it from liquidity it places for that block | the fill must be at or better than the pool's price, and the LP accounting must not let the hook keep the difference silently; the payer's minimum output is the only thing that makes this checkable |
| **Custom curves** | the hook takes the whole swap and prices it on its own curve, the pool holding no liquidity at all | the curve must be deterministic and readable from the hook's own state, and the hook must settle both legs in the same call — a curve hook that can return "priced at zero out" is the study above wearing a different name |
| **RFQ / quote fills** | a signed off-chain quote is filled by the hook, the pool untouched | the quote must be bound to the payer, the amounts, and an expiry, and it must be verified on-chain before any `take` — an unbound quote lets whoever relays it choose the price |
| **Async / two-step swaps** | the hook takes the input now and delivers later | this is the one where the payer's protection is weakest, because "later" is not a property the transaction can assert; it needs a claim the payer holds and can enforce |

The pattern in every row: **the bit lets a hook substitute itself for the pool, and the payer's only
leverage is a minimum output enforced somewhere the hook does not control.**

---

## NOT MEASURED

Stated so the absences are not mistaken for results.

- **Exact-output swaps.** `NoOpStudy` reverts on them (`StudyModelsExactInputOnly`). The sign
  convention differs and nothing here was run against it.
- **ERC-20 input.** Every row uses native ETH in, mock token out — the shape UNICA's pool has.
- **Conditional theft.** The study steals on every swap. A hook that steals selectively is strictly
  harder to catch, and the claim in §3 that simulation cannot catch it is reasoning from the
  mechanism, not a measured row.
- **`afterSwapReturnDelta` (`1 << 2`)** and the two liquidity return-delta bits. Not studied.
- **Any live network.** No transaction in this study was broadcast anywhere.
- **Routers other than `PoolSwapTest`.** The claim that a minimum-output router would revert on this
  attack is read from what a minimum output means, not from a row that ran the Universal Router
  against `NoOpStudy`. That row would be the obvious next thing to build.
- **Gas.** The numbers in §1 are forge's, unoptimised, on a local fork; they are not a cost claim.
