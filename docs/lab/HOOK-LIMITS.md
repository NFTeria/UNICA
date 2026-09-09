# HOOK-LIMITS — where a Uniswap v4 hook stops

**EXPERIMENT B of the UNICA laboratory.** Six questions about the edges of the v4 hook interface,
each answered by a separate probe contract, each number produced by a command that is written down
next to it. Nothing here is part of UNICA's settlement path and nothing here is deployed anywhere.

This is the document I wanted to find and could not: what a hook *can* do, where it *stops*, and —
the part that is usually missing — **which of those limits is the protocol, which is the router you
happened to arrive through, and which is merely the toolchain you measured with.** Those three get
collapsed constantly, and a number with the wrong label on it is worse than no number.

---

## How to read this

Every measured figure below carries the command that produced it. Anything that is *not* measured
is in [NOT MEASURED](#not-measured) at the bottom, in its own section, rather than dressed up as a
result. Where a number is arithmetic from a published gas schedule rather than an observation, it
says **arithmetic**, not *measured*.

Each finding is labelled with where the limit actually lives:

| Label | Means |
|---|---|
| **PROTOCOL** | v4's own code or the EVM. Moves only if Uniswap or a hard fork moves it. |
| **ROUTER** | The way the swap reached v4. A different router gives a different number. |
| **ECONOMICS** | Not a limit at all. A price. It moves with the block gas limit and the market. |
| **TOOLCHAIN** | An artefact of Foundry/revm. Says nothing about a real chain. |

---

## Run it

```sh
bash test/lab/run-limits.sh
```

The runner ends with `checks run: N, passed: P, failed: F` and exits non-zero when `F > 0`. It
never prints a blank panel: a run that cannot compile reports **one failed check**, not zero of
everything, because an empty result and a broken reporter look identical from the outside.

**Result of the run these numbers come from:**

```
checks run: 39, passed: 39, failed: 0
```

That is 31 test cases, 1 discriminator (gas ceiling vs toolchain memory ceiling), 6 sabotages, and
1 restore-integrity check.

### Environment

| | |
|---|---|
| Repository commit | `811d7f6` (working tree, `src/lab/` + `test/lab/` + `docs/lab/` only) |
| forge | `1.3.5-foundry-zksync-v0.1.9` |
| solc | `0.8.30`, `evm_version = cancun`, `optimizer = false`, `via_ir = false` |
| Foundry gas limit per test | `1073741824` |
| Foundry memory limit | `134217728` (128 MiB) |
| PoolManager | Uniswap's **official deployed runtime**, 24009 bytes, etched by `test/utils/SettlementTestBase.sol` — not a local compile and not a mock |
| `lib/uniswap-hooks` | `bd5287c` |
| Chosen block budget | **36,000,000 gas** — a *chosen* parameter, not a protocol constant. Every ceiling below moves when it moves. |

While these measurements were taken, `src/lab/` also held EXPERIMENT A, mid-write by another
session and not yet compiling. Those runs used
`LIMITS_FORGE_SKIP='*NanoAuthorization*' bash test/lab/run-limits.sh`; the final numbers in this
document were re-taken with **no skip at all** once that file compiled, and the runner prints the
skip glob it used on every run so a reader never has to take that on trust.

---

## The instruments

Five contracts in `src/lab/LimitProbes.sol`, deliberately **not one**:

| Probe | Permissions | Measures |
|---|---|---|
| `HookDataSizeProbe` | `beforeSwap` (`0x80`) | what payload actually arrived, length and digest |
| `GasBurnProbe` | `beforeSwap` (`0x80`) | gas burned inside a callback, loop and bookkeeping counted separately |
| `TransientEchoProbe` | `beforeSwap \| afterSwap` (`0xC0`) | a transient slot across a swap, and after one |
| `ReentrancyProbe` | `beforeSwap` (`0x80`) | one chosen PoolManager entry point, called from inside a callback |
| `RevertShapeProbe` | `beforeSwap` (`0x80`) | twelve ways for a callback to fail or to return garbage |

A sixth measurement — address mining — needs no contract and lives in the test file.

---

# B1 — hookData

### The question
How much `hookData` can reach a callback, and what breaks first: calldata cost, a router limit, the
PoolManager, or memory?

### The measurement

Marginal gas per byte, at sizes an integration might plausibly send. Each row is the **second** swap
at that size — the first swap at any size pays first-touch storage costs the next does not, and a
curve built from first swaps is not even monotonic (measured: the 1024-byte row came out *cheaper*
than the 0-byte row, which is a warm-up artefact and would have been read as a property of
hookData).

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B1_03_gasCurve -vv
```

| bytes | gas, whole swap | marginal gas/byte since previous row |
|---:|---:|---:|
| 0 | 80,551 | — |
| 1,024 | 82,794 | 2 |
| 4,096 | 89,869 | 2 |
| 16,384 | 125,369 | 2 |
| 65,536 | 382,559 | 5 |
| 262,144 | 3,254,519 | 14 |

The cost is **superlinear**, and visibly so by 64 KiB. EVM memory expansion is quadratic and the
payload is re-materialised in several call frames on the way in, so each frame pays its own
quadratic term.

### The ceiling, bisected

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B1_04 -vv
```

| | |
|---|---|
| Largest hookData that fits a 36,000,000-gas swap | **929,792 bytes** (resolution 4,096) |
| Gas consumed at that ceiling | 35,018,725 |
| First failing size | 933,888 bytes |

Both sides are proved: the reported ceiling is re-run and passes, and one page past it is re-run and
fails. A ceiling that was never shown to fail on the far side is a guess with a number attached.

### What breaks first

**Gas.** Not calldata, not the PoolManager, not a router limit, not memory.

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B1_05 -vv
```

| bytes | succeeded | gas consumed (cap 300,000,000) | error bytes returned |
|---:|:---:|---:|---:|
| 4,194,304 | no | 297,435,934 | **0** |
| 8,388,608 | no | 300,000,827 | **0** |
| 16,777,216 | no | 300,000,830 | **0** |

Two things worth stopping on.

**There is no error to read.** Above the ceiling the frame simply halts, and the caller receives
*zero bytes* of revert data — the same thing it receives from a hook that called `revert()`. An
over-large payload and a deliberate refusal are indistinguishable by shape.

**The 4 MiB row did not consume its whole budget** (297.4M of 300M) while the two above it consumed
every last unit. That is the EIP-150 63/64 rule made visible: at 4 MiB the allocation succeeds and a
*nested* frame runs out, so the outer frames keep their retained 1/64 slices; at 8 MiB the outermost
frame dies allocating, and nothing is retained.

**Ruling out the toolchain.** An out-of-gas and revm's `MemoryLimitOOG` are indistinguishable from
*inside* the EVM — both halt with empty return data. They are distinguishable from outside, and the
runner does it as a check rather than leaving it to argument: re-run the ladder with Foundry's
memory limit raised from 128 MiB to 4 GiB and see whether any verdict moves.

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B1_05 -vv
forge test --memory-limit 4294967296 --match-path test/lab/Limits.t.sol --match-test test_B1_05 -vv
```

Verdicts identical at both memory limits. **The ceiling is gas.** Foundry's memory limit never
binds, so nothing in B1 is a toolchain artefact.

### How much of the ceiling is the router's fault

The rows above all went through `PoolSwapTest`, which `abi.encode`s the entire call — hookData
included — into `unlock`'s argument and `abi.decode`s it back out. The payload therefore crosses
three ABI boundaries instead of one. The test contract also implements `IUnlockCallback` itself and
builds the payload *inside* the callback, so the same probe, pool, and payload can be priced with
and without a router.

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B1_06 -vv
```

| 262,144 bytes of hookData | gas |
|---|---:|
| through `PoolSwapTest` | 3,254,508 |
| through `manager.unlock` directly | 1,080,109 |
| **the router's share** | **2,174,399 (67%)** |

| Ceiling under 36,000,000 gas | bytes |
|---|---:|
| through `PoolSwapTest` | 929,792 |
| through `manager.unlock` directly | **1,695,744** |

**Two thirds of the cost of a large hookData payload, and 45% of the payload ceiling, belongs to the
router, not to v4.** Anyone quoting a hookData limit without saying how they reached the pool is
quoting their router.

### Verdicts

| Finding | Label |
|---|---|
| Cost grows quadratically with payload size | **PROTOCOL** (EVM memory expansion) |
| 929,792-byte ceiling at 36M gas | **ECONOMICS** — a price under a chosen budget, not a limit |
| 45% of that ceiling is the router's encoding | **ROUTER** |
| Failure above the ceiling carries no revert data | **PROTOCOL** |
| Foundry's 128 MiB memory limit | never binds — **not** a factor, discriminated, not assumed |

---

# B2 — gas per callback

### The question
How much can `beforeSwap` burn before a swap is unusable, and what does a starved callback look like
from outside?

### Is the instrument real?

A burn probe that does not burn would make every ceiling below it fiction, so the burn is measured,
not requested. The probe reports the **loop's** burn and the **whole callback's** cost separately,
because they differ by its own bookkeeping.

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B2_01 -vv
```

| requested | burned by the loop | whole callback | difference |
|---:|---:|---:|---:|
| 1,000,000 | 1,000,349 | 1,044,787 | 44,438 |

The loop overshoots by 349 gas — one keccak round, which is its granularity. The 44,438-gas
difference is exactly two cold `SSTORE`s at 22,100 each. Reporting only the total would have looked
like a loop that overshoots its request by 2%, and that number would have been wrong.

Baseline, for scale: a swap through an idle hook costs **197,425** gas end to end, of which
**4,517** is inside `beforeSwap` — and nearly all of that 4,517 is the probe's own bookkeeping.

### The ceiling, bisected

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B2_02 -vv
```

| | |
|---|---|
| Largest burn that still fits a 36,000,000-gas swap | **33,000,000 gas requested** (resolution 250,000) |
| Measured inside the callback at that point | 33,001,009 |
| Whole-swap gas at that point | 33,083,562 |
| First failing request | 33,250,000 |

**A `beforeSwap` may consume roughly 92% of a 36M-gas block on its own.** There is no per-callback
gas cap in v4 — `Hooks.callHook` forwards `gas()`, so the callback receives 63/64 of everything the
PoolManager had. The only thing standing between a hook and the whole block is the transaction's own
gas limit. A pool's users are paying for whatever its hook decides to do.

### What a starved callback looks like

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B2_03 -vv
```

A hook that loops until the EVM stops it produces, at the caller:

```
decodes as:          WrappedEmptyReason
reverting contract:  0x000000b200000000000000000000000000000080   (the hook)
failed callback:     beforeSwap
reason selector:     0x00000000                                    (there is none)
```

The ERC-7751 wrapper still names **which hook** and **which callback** — those two facts survive an
out-of-gas. The *reason* does not exist to be read, and an out-of-gas is therefore
indistinguishable from a hook that called bare `revert()`. See B5 for the full collision set.

### Verdicts

| Finding | Label |
|---|---|
| No per-callback gas cap; `gas()` is forwarded | **PROTOCOL** |
| ~92% of a block burnable inside one `beforeSwap` | **ECONOMICS** |
| An out-of-gas callback is an empty-reason wrapper | **PROTOCOL** |

---

# B3 — transient storage

### The question
Is a `tstore` in `beforeSwap` readable in `afterSwap`? And — the half people assume rather than
check — is it *gone* in the next transaction?

### The half everyone checks

```
forge test --match-path test/lab/Limits.t.sol --match-contract B3TransientWithinATransactionTest -vv
```

Yes. `beforeSwap` writes `0xC0FFEE`, `afterSwap` reads `0xC0FFEE`. The instrument is validated by
changing the value and requiring the echo to follow it, so the row cannot pass against a hard-coded
constant.

### The half that matters

**Two swaps in ONE transaction share the slot.**

| | slot on entry to `beforeSwap` | written | echoed in `afterSwap` |
|---|---:|---:|---:|
| first swap | 0 | `0xAAAA` | `0xAAAA` |
| second swap, same transaction | **`0xAAAA`** | `0xBBBB` | `0xBBBB` |

And an ordinary external `peek()` in that same transaction still reads `0xBBBB`.

EIP-1153 clears transient storage at the end of a **transaction** — not at the end of a call, not at
the end of a swap, and not at the end of an `unlock`. **A hook that uses a transient flag as
"once per swap" is wrong**, and it is wrong in exactly the case an attacker controls: two swaps
batched into one transaction. This is the row worth taking away from B3.

### The next-transaction half

```
forge test --match-path test/lab/Limits.t.sol --match-contract B3TransientAcrossTransactionsTest -vv
```

The swap happens in `setUp()`; the assertion runs in the test function, a separate top-level call.
The transient slot reads **0**, while the *persistent* field written in the same callback still
reads `0xFEEDFACE`. The pair is what makes this a measurement instead of a fixture reset: one field
survived and one did not.

**Honest caveat, and it is a real one.** What this row proves is that **Foundry's** boundary between
`setUp()` and a test function clears transient storage. Foundry's boundary is not automatically the
chain's. The behaviour matches EIP-1153 as written, but this row measures the toolchain agreeing
with the specification, not the specification itself. Labelled **TOOLCHAIN** below for that reason,
and the sabotage sweep exists so that the row at least cannot pass while measuring nothing.

### Verdicts

| Finding | Label |
|---|---|
| `tstore` in `beforeSwap` readable in `afterSwap` | **PROTOCOL** |
| Two swaps in one transaction share the slot | **PROTOCOL** — and the one to design around |
| Slot empty in the next transaction | **TOOLCHAIN** — Foundry's transaction boundary, consistent with EIP-1153 |

---

# B4 — the re-entrancy surface

### The question
What can a hook call back into during a callback, and what does the lock refuse?

### The instrument, and why it has two modes

One mode cannot answer this. A probe that only recorded outcomes to storage would lose every row
whose outer transaction reverts — and those are precisely the rows worth having, because the storage
write reverts with the transaction. So:

- **REPORT** — make the inner call, then deliberately revert carrying the outcome out through the
  PoolManager's ERC-7751 wrapper. Always tells the truth about the **inner call**.
- **CONTINUE** — make the inner call, swallow the outcome, let the swap run on. Tells you whether
  the **whole transaction** survives. A different question.

The reporter is itself validated by requiring it to carry both verdicts out of a doomed frame:
`sync` succeeds, `unlock` does not.

### The table

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B4_03 -vv
```

| entry point called from inside `beforeSwap` | inner call | inner error | transaction survives | outer error |
|---|:---:|---|:---:|---|
| `unlock` | ✗ | `AlreadyUnlocked` `0x5090d6c6` | ✓ | — |
| `initialize` (a new pool) | ✓ | — | ✓ | — |
| `swap` (its own pool) | ✓ | — | ✗ | `CurrencyNotSettled` `0x5212cba1` |
| `swap` (another pool) | ✓ | — | ✗ | `CurrencyNotSettled` |
| `modifyLiquidity` (its own pool) | ✓ | — | ✗ | `CurrencyNotSettled` |
| `donate` (its own pool) | ✓ | — | ✗ | `CurrencyNotSettled` |
| `take` (native) | ✓ | — | ✗ | `CurrencyNotSettled` |
| `settle()` | ✓ | — | ✓ | — |
| `sync` (native) | ✓ | — | ✓ | — |
| `clear` (native) | ✗ | `MustClearExactPositiveDelta` `0xbda73abf` | ✓ | — |
| `mint` (ERC-6909 claims) | ✓ | — | ✗ | `CurrencyNotSettled` |
| `burn` (ERC-6909 claims) | ✗ | `Panic(uint256)` `0x4e487b71` | ✓ | — |
| `setProtocolFee` | ✗ | `InvalidCaller` `0x48f5c3ed` | ✓ | — |

**9 of 13 inner calls succeed. 7 of 13 transactions survive.**

Every cell is frozen as an assertion in the test, not merely printed. A change in v4's behaviour
breaks a row instead of quietly re-printing a different table under the same passing test.

### What this actually says

**The lock refuses exactly one thing: `unlock`.** Everything else guarded by `onlyWhenUnlocked` is
*open* to a hook mid-callback, because a callback only ever happens **inside** an unlock — the
manager is not locked to a hook, it is unlocked to it. The refusal is `AlreadyUnlocked`, never
`ManagerLocked`, and the test asserts that distinction explicitly.

**What constrains a re-entrant hook is delta settlement, not a lock.** Six of the seven fatal rows
die at the *end* of the outer `unlock` with `CurrencyNotSettled` — the hook opened a position it
never paid for. It could do the thing; it could not afford it.

**A hook's own callbacks are skipped when it calls the PoolManager itself.** `Hooks.noSelfCall`
compares `msg.sender` against the hook's address and skips the callback when they match. So a hook
re-entering `swap` on its own pool *succeeds* and its `beforeSwap` is **not** called again. The
guard against a hook recursing on itself is not a lock and not a depth counter — it is a
`msg.sender` comparison, and it protects the hook from itself rather than the pool from the hook.

Two rows that succeed while changing nothing are worth naming so they are not misread as capability:
`settle()` with no value and nothing synced accounts a zero delta, and `sync(native)` resets the
synced-currency slot. Both were measured as *inner success, outer survives*; neither was measured as
harmless in a topology where the caller had already synced.

### Verdicts

| Finding | Label |
|---|---|
| Only `unlock` is refused; `AlreadyUnlocked`, not `ManagerLocked` | **PROTOCOL** |
| Delta settlement, not a lock, is the real constraint | **PROTOCOL** |
| A hook's own callbacks are skipped on self-call (`noSelfCall`) | **PROTOCOL** |

---

# B5 — revert propagation

### The question
Does a hook's revert reason reach the caller intact, wrapped, or erased? And does this repository's
ERC-7751 decoder (`test/v2/util/HookRevertDecoder.sol`) help?

### What survives

```
forge test --match-path test/lab/Limits.t.sol --match-contract B5RevertPropagationTest -vv
```

| the hook does | arrives as | hook named? | reason readable? |
|---|---|:---:|:---:|
| custom error with arguments | `Wrapped` | ✓ | ✓ — **arguments and all** |
| `require(false, "…")` | `Wrapped`, reason `Error(string)` | ✓ | ✓ — string intact |
| division by zero | `Wrapped`, reason `Panic(uint256)` = `0x12` | ✓ | ✓ |
| bare `revert()` | `WrappedEmptyReason` | ✓ | ✗ |
| 1-byte revert payload | `WrappedEmptyReason` | ✓ | ✗ |
| 3-byte revert payload | `WrappedEmptyReason` | ✓ | ✗ |
| runs out of gas (B2) | `WrappedEmptyReason` | ✓ | ✗ |
| returns the **wrong selector** | `Direct`, `InvalidHookResponse` | ✗ | ✗ |
| returns **nothing** | `Direct`, `InvalidHookResponse` | ✗ | ✗ |
| returns **31 bytes** | `Direct`, `InvalidHookResponse` | ✗ | ✗ |

**Does the decoder help? Yes, and precisely where it matters.** For every revert-shaped failure the
wrapper preserves *which contract* and *which callback* — so the decoder can assert "this hook
refused, in `beforeSwap`, for this reason", which is four claims where a bare `vm.expectRevert()`
makes one. The repository already learned this the expensive way: a sabotage run once deleted a
guard from *both* callbacks and every row stayed green, because each row asserted only that the call
reverted.

**And here is where it cannot help.** A hook that *returns* something malformed is rejected by the
PoolManager's own `InvalidHookResponse` — a **direct** error that names nothing. The hook's address
is not in the payload at all. If your hook returns garbage, the revert data cannot tell anyone which
hook it was.

**Four different failures collapse to one shape.** Bare `revert()`, a 1-byte payload, a 3-byte
payload, and an out-of-gas all decode identically as `WrappedEmptyReason`. "The hook refused" and
"the hook broke" are not separable by shape.

### The revert data bomb, measured

v4's `CustomRevert.bubbleUpAndRevertWith` carries a comment saying it is vulnerable to a revert data
bomb. It is, and the caller pays for it:

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B5_05 -vv
```

| hook's revert payload | gas the caller paid | error bytes the caller received |
|---:|---:|---:|
| 1,000 | 85,241 | 1,252 |
| 10,000 | 98,522 | 10,244 |
| 100,000 | 354,929 | 100,228 |
| 1,000,000 | **15,197,116** | 1,000,228 |

A hook can hand its caller a megabyte to parse and a 15-million-gas bill for the privilege, on a
swap that never happened. The payload is copied into the PoolManager's memory and re-emitted, so the
cost is quadratic.

**And the bomb decodes as a well-formed wrapper.** Its "reason selector" is simply the first four
bytes of whatever the hook chose — so a hostile hook can hand a decoder the selector of somebody
else's legitimate error. The wrapper's `target` field is the one part it cannot forge, which is
exactly why this repository's decoder asserts on the target and the callback and **never** searches
revert data for a selector.

### Verdicts

| Finding | Label |
|---|---|
| Reverts are wrapped in ERC-7751 with target + callback intact | **PROTOCOL** |
| Malformed *returns* produce a direct error naming no hook | **PROTOCOL** |
| Four distinct failures share one decoded shape | **PROTOCOL** |
| Revert bombs are unbounded and billed to the caller | **PROTOCOL** |

---

# B6 — address mining

### The question
What does mining a permission-bit address actually cost? Not "1 in 2^k" — what did it *cost*?

### What v4 requires

`Hooks.validateHookPermissions` compares **all fourteen** permission bits for exact equality. A hook
is not mining a prefix; it is mining a full 14-bit match, including every bit it wants *off*. The
address is `keccak256(0xff ‖ factory ‖ salt ‖ initCodeHash)` truncated to twenty bytes.

### The distribution, measured

Forty independent searches for the exact pattern `0xC0` (`beforeSwap | afterSwap` — UNICA V1's set),
each against a different init-code hash.

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B6_02 -vv
```

| | salts tried |
|---|---:|
| fewest | 162 |
| mean | 18,867 |
| **worst case actually hit** | **59,676** |
| 2^14, for reference | 16,384 |

The mean lands near 2^14, as it must. **The number that matters is the worst case: 59,676, which is
3.2× the mean.** A deploy script sized for the average is a deploy script that appears to hang.
Miners are usually written with a bounded loop; that bound needs to be well past 2^14, not near it.

### Every extra constrained bit multiplies the search

```
forge test --match-path test/lab/Limits.t.sol --match-test test_B6_03 -vv
```

| pattern | mean salts (6 searches each) |
|---|---:|
| the 14 permission bits only | 7,387 |
| those 14 **plus one chosen nibble** above them | 299,680 |
| measured ratio | **40.6×** |

The theoretical ratio for four extra bits is 16×. The measured 40.6× is over six searches per arm —
a sample far too small to call the difference anything but variance, and it is reported as what it
is rather than rounded toward the theory. **The direction is the finding, and the direction is
brutal: vanity beyond what v4 requires is not free, and it compounds.** It is also why the probe
addresses in this experiment are *etched* rather than mined.

One consequence this repository already lives by: the init-code hash includes **constructor
arguments**. A hook with a per-chain constructor argument has a different address on every chain and
needs a fresh search for each one. UNICA's hooks take none, deliberately.

### Verdicts

| Finding | Label |
|---|---|
| All 14 bits must match exactly, including the off ones | **PROTOCOL** |
| Worst case 3.2× the mean over 40 searches | **PROTOCOL** (it is just keccak) |
| Constructor arguments change the address | **PROTOCOL** |

---

## Where things stopped

The output that matters is where things stop, so here it is in one list.

1. **hookData stops at gas, and two thirds of the bill is the router.** 929,792 bytes through a
   router, 1,695,744 direct, under the same 36M budget. No protocol constant is involved.
2. **A callback can burn 92% of a block.** There is no per-hook gas cap. `gas()` is forwarded.
3. **Transient storage does not reset between swaps in one transaction.** A "once per swap"
   transient flag is broken by batching.
4. **The lock refuses exactly one entry point.** Nine of thirteen re-entrant calls succeed; what
   kills the transaction is unsettled deltas, not a lock.
5. **A hook's own callbacks are skipped when it calls the manager itself** — a `msg.sender`
   comparison, not a reentrancy guard.
6. **Four different failures are one shape at the caller**, and a malformed *return* names no hook
   at all.
7. **A revert bomb is unbounded** and costs the caller 15M gas for a megabyte.
8. **Address mining's worst case is several times its mean**, and every extra constrained bit
   multiplies it.

### Things that surprised me while measuring

- The 4 MiB row not consuming its whole gas cap. That is the 63/64 rule, and it is a usable
  discriminator for *which frame* died.
- The gas curve being non-monotonic on first swaps. The 1,024-byte row cost **less** than the
  0-byte row until every row was measured on its second swap. That would have shipped as a
  property of hookData.
- `unlock` failing with `AlreadyUnlocked` rather than `ManagerLocked`. The manager is not locked to
  a hook — it is unlocked to it, and the mental model of "the lock stops re-entrancy" is wrong here.
- A 1,000-byte revert bomb of zeros decoding as a **well-formed** wrapper with reason selector
  `0x00000000`. The reason selector is attacker-chosen. That is a real reason never to search
  revert data for a selector.

---

## Every guard was validated by sabotage

A check that has never failed is not a check. `test/lab/sabotage-limits.sh` breaks one instrument at
a time, requires the test that should notice to **fail**, restores the file, and proves the restore
was exact with a SHA-256 taken before the edit.

```
bash test/lab/sabotage-limits.sh
```

| what is broken | which test must scream | result |
|---|---|---|
| the hookData digest is not the payload's | `test_B1_00` | failed, as it must |
| the burn loop burns a thousandth of its request | `test_B2_01` | failed, as it must |
| `peek()` reads persistent storage, not the transient slot | `test_B3_04` | failed, as it must |
| the re-entrancy reporter always reports success | `test_B4_01` | failed, as it must |
| the argument-carrying error becomes the bare one | `test_B5_01` | failed, as it must |
| the miner accepts a superset of the wanted bits | `test_B6_01` | failed, as it must |
| — | both files restored byte-for-byte | sha256 matches |

```
sabotage checks run: 7, passed: 7, failed: 0
```

Three further guards failed for real during construction, before anyone sabotaged them, and each
one changed a number in this document: the gas curve's underflow (fixed by measuring second swaps),
the 1 MiB row that *succeeded* when it was assumed to fail (the ladder was raised), and the burn
probe's apparent 2% overshoot (which was two cold `SSTORE`s, not the loop).

The runner's own reporter was validated the same way: run with a tree that does not compile and it
reports `checks run: 9, passed: 8, failed: 1` and exits 1 — not a silent zero. That run also
exposed a real bug in the runner (`"${SKIP_ARGS[@]}"` is unbound under `set -u` in bash 3.2, so the
no-skip path was not actually invoking forge), which is the entire argument for making a reporter
fail loudly.

---

## NOT MEASURED

Everything in this section is outside what the experiment observed. None of it is a result.

- **Transaction calldata pricing.** Every measurement above happens with hookData in *memory*. On a
  real chain the payload arrives as transaction calldata and is priced before execution begins.
  **Arithmetic, not measured:** under EIP-2028 a non-zero calldata byte costs 16 gas, and under
  EIP-7623 the transaction pays at least a floor of 10 gas per token where a non-zero byte is 4
  tokens — 40 gas per non-zero byte. At that floor, 929,792 non-zero bytes cost **37,191,680 gas in
  calldata alone**, before any execution at all. The in-EVM ceiling measured in B1 is therefore
  **not reachable on a real chain under a 36M budget**; calldata pricing binds first, at roughly
  900,000 non-zero bytes for the floor alone. This is arithmetic from the published gas schedule
  and nothing in this repository measured it.
- **The Universal Router.** B1's router split used `PoolSwapTest`, v4-core's own test router.
  Uniswap's Universal Router encodes commands differently and its numbers will differ. Not measured.
- **Any live chain.** Nothing here was broadcast anywhere. All measurements are Foundry-EVM
  measurements against Uniswap's official PoolManager runtime.
- **Blob or calldata-market economics**, block-builder inclusion behaviour, and whether a
  block-filling hook would actually be *included*. Not measured.
- **`afterSwap` gas**, and the `*_RETURNS_DELTA` callbacks. Every gas measurement here is
  `beforeSwap`. `afterSwap` was exercised only in B3 and never timed.
- **Liquidity callbacks** (`beforeAddLiquidity` and friends) and `beforeInitialize` / `afterInitialize`.
  Untouched by every probe.
- **ERC-20 pools.** Every pool here is native-ETH/mock-ERC20. Token transfer costs, fee-on-transfer
  tokens, and `sync`/`settle` accounting for ERC-20 inputs are out of scope.
- **Whether the B3 next-transaction result generalises beyond Foundry.** It matches EIP-1153 as
  written; it was measured against Foundry's transaction boundary and nothing else.
- **Statistical significance of B6's 40.6× ratio.** Six searches per arm. The theoretical value is
  16×. The gap is not evidence of anything and is not claimed as such.
- **Whether any of these limits differ on an L2** with a different gas schedule or block gas limit.
  Not measured.

---

## Files

| Path | What |
|---|---|
| `src/lab/LimitProbes.sol` | the five probe contracts (527 lines) |
| `test/lab/Limits.t.sol` | the six experiments, 31 test cases (1,003 lines) |
| `test/lab/run-limits.sh` | the runner; prints the tally, exits non-zero on failure |
| `test/lab/sabotage-limits.sh` | breaks each instrument on purpose and requires it to be caught |
| `test/lab/summarise-forge-json.py` | one line per test from `forge test --json` |
| `docs/lab/HOOK-LIMITS.md` | this document |

Reused, not rewritten: `test/utils/SettlementTestBase.sol` (official PoolManager bytecode) and
`test/v2/util/HookRevertDecoder.sol` (the ERC-7751 decoder).
