# Experiment A — the nanopayment authorization envelope

**Classification: `CROSS_CHAIN_AUTHORIZATION_ENVELOPE_SIMULATION`.**

- Contract: `src/lab/NanoAuthorizationHook.sol`
- Tests: `test/lab/NanoAuthorization.t.sol` — 48 tests, 0 failures; every guard validated by sabotage (section 8)
- Not deployed. Not part of UNICA V1. Nothing in this repository depends on it.

Run it:

```sh
forge test --match-contract NanoAuthorizationTest -vv
```

---

## 1. The three properties, and which of them this hook actually decides

This experiment exists because one sentence — "the hook verifies an Arc authorization" — silently
collapses three different things. Keeping them apart is the whole result.

| # | Property | Can a Sepolia hook decide it? | How, here |
|---|---|---|---|
| 1 | **Signature validity** — the signer authorized a typed message | **Yes** | ECDSA recovery over an EIP-712 digest. Chain-agnostic arithmetic; needs no counterparty. |
| 2 | **Resource / session binding** — the authorization is tied to a resource, request, session, token, recipient, ceilings and expiry | **Yes, but only because the complete envelope is handed to it** | Twenty-six fields checked in `beforeSwap` and `afterSwap`. The hook enforces the envelope it was *given*; it cannot go and fetch the envelope it should have been given. |
| 3 | **Arc consumption / settlement** — the authorization was accepted, consumed, revoked or settled **on Arc** | **NO** | Not by signature, not by envelope, not by any amount of care. It needs an authenticated cross-chain state path — a proven Circle mechanism, a bridge or messaging protocol, an oracle attestation, or an independently verified Arc state proof. **None of those exists in this repository and none is used here.** |

**Consequence, stated as plainly as it can be stated:** the `envelopeNonceSpent` and `itemNonceSpent`
maps prevent replay **within this chain and this hook only**. A nonce spent on Arc is invisible here.
A nonce spent here is invisible on Arc. There is no cross-chain replay protection in this
experiment, and a reader who believes otherwise has been misled by us.

The same limit is readable from the contract itself, so a summary that drops it is contradicted by
the artifact:

```
CLASSIFICATION()                          -> "CROSS_CHAIN_AUTHORIZATION_ENVELOPE_SIMULATION"
ARC_CONSUMPTION_IS_NOT_KNOWABLE_HERE()    -> the paragraph above, on chain
```

### Circle's authorization is untouched

Circle Gateway's batched authorization signs exactly six fields —
`from, to, value, validAfter, validBefore, nonce` — recorded independently in
`integrations/arc-nanopayments/protocol.mjs`. UNICA does not modify, extend or reinterpret it. The
envelope below is a **separate** structure standing alongside it, and it exists precisely because
those six fields carry no resource, no request digest, no session, no ceiling and no token address.

`test_RevertWhen_aCircleGatewayAuthorizationIsOfferedAsAnEnvelope` builds a genuine Gateway digest
under Circle's own domain, signs it with the real payer's key for the right amount, and offers it as
an envelope signature. It is refused. That is the separation, executed rather than asserted.

### The two payers are two accounts and nothing here links them

`arc.arcPayer` signs the envelope. `sepolia.payer` must appear as the swap's `sender` — the contract
that called `PoolManager.swap`. Two addresses, two chains. The hook checks each against the
envelope and has no mechanism whatever for proving they are the same principal.

`sepolia.merchantRecipient` is worse and is documented as such: v4 hands the swap's output delta to
the swapper, not to a named recipient, so **this hook cannot enforce that the merchant received the
funds.** The field is bound into the signature and into `merchantConfigHash` and is emitted in the
receipt. That is internal consistency of the envelope, not proof of payment to that address.

---

## 2. The envelope — twenty-six fields

Nested as four sub-structures under one primary type. That is EIP-712's own composition rule, and it
is also what keeps a twenty-six-field message out of `stack too deep`.

| Group | Fields |
|---|---|
| top level | `version`, `batchDigest`, `nonce`, `validAfter`, `validBefore` |
| `ArcSide` | `arcChainId`, `arcAuthorizationDomain`, `arcPayer`, `arcRecipient` |
| `Binding` | `resourceId`, `requestDigest`, `sessionId`, `merchantConfigHash` |
| `Limits` | `cumulativeSessionCeiling`, `perRequestCeiling`, `authorizationAmount` |
| `SepoliaSide` | `sepoliaChainId`, `sepoliaPoolManager`, `hookAddress`, `poolId`, `payer`, `merchantRecipient`, `settlementToken`, `tokenDecimals`, `exactOutput`, `maximumInput` |

### Why `tokenDecimals` is in there

`docs/ARC-FACTS.md` row 1, measured: the same USDC on Arc reports **6** through the ERC-20 and **18**
as the native gas asset, at the same instant, from the same account. Both readings are correct and
neither is convertible to the other without knowing which interface produced it. So a scale is a
property of the interface it was read from, never of the chain it was read on.

The hook therefore **reads** `decimals()` off the pool's own token and refuses an envelope that
assumed a different one (`TokenDecimalsMismatch`). An amount whose scale is not bound is not an
amount.

### `arcAuthorizationDomain` is recorded, not verified

It carries the Circle Gateway domain separator the envelope stands beside, so a reader can tell which
Gateway domain was in play. **The hook does not verify a Gateway authorization and does not try to.**

---

## 3. Five structures, five typehashes, and none of them is Circle's

Two structures that can produce the same bytes are one structure with a bug. So there are five
distinct typehashes, and their distinctness is proven by test rather than asserted in a comment:

| Structure | Covers |
|---|---|
| `Envelope` | the twenty-six fields, under UNICA's own EIP-712 domain |
| `NanoItem` | `index, resourceId, sessionId, amount, nonce` — **what was paid** |
| `NanoBatch` | `sessionId, itemCount, itemsRoot` — the ordered aggregate of item digests |
| `NanoRequestSet` | `resourceId, sessionId, itemCount, requestsRoot` — **what was asked for**, a second and independent aggregate over the same items |
| `MerchantConfig` | `merchantRecipient, settlementToken, tokenDecimals, cumulativeSessionCeiling, perRequestCeiling` |

Splitting money (`NanoBatch`) from content (`NanoRequestSet`) is deliberate: a merchant can re-derive
either without holding the other, and the two failures get distinct names. The test
`test_RevertWhen_theRequestSetDoesNotMatch` changes what was asked for, asserts the **money digest is
untouched**, and then catches the request digest — which is how we know the second check is not being
carried by the first.

UNICA's domain (`"UNICA Nano Authorization Envelope"`, version 1, this chain, this hook) is asserted
to differ from Circle's `GatewayWalletBatched` domain. The hook's own digest helpers are re-derived
in the test from the literal type strings, so a mistake inside the hook cannot hide behind the hook's
own arithmetic.

---

## 4. Which callback enforces what, and why

This was the design decision that mattered most, so the reasoning is written down rather than implied.

### `beforeSwap` — everything that must refuse before value moves

Ordered cheapest-first, and with the signature verified **before** the batch is walked so no nonce is
ever marked against an envelope nobody signed:

1. `version`
2. `sepoliaChainId` against `block.chainid`
3. `arcChainId` against the verified Arc testnet id (5042002)
4. `hookAddress` against `address(this)`
5. `sepoliaPoolManager` against the manager
6. `poolId` against the key being swapped
7. `payer` against the swap's `sender`
8. native input required; `settlementToken` against `currency1`
9. `tokenDecimals` against `decimals()` **read from the token**
10. `merchantConfigHash` against the recomputed merchant terms
11. validity window
12. swap shape and direction (`exactOutput`, `maximumInput`, `zeroForOne`)
13. **envelope signature**, then the envelope nonce
14. one pass over the batch: `index`, `resourceId`, `sessionId`, per-request ceiling, item nonce, running aggregate, both roots
15. batch digest, request-set digest, aggregate equality, session ceiling

### `afterSwap` — the two facts that do not exist until the pool has run

- how much input the pool actually consumed, against `maximumInput`
- how much output it actually produced, against `authorizationAmount`

A ceiling on money the pool has not yet quoted cannot be checked early; checking it early would be
checking a wish.

`afterSwap` never re-decodes `hookData`. It reads eight transient slots (EIP-1153) that `beforeSwap`
filled, because decoding a 13 KB payload twice would be the single most expensive thing this contract
could choose to do.

### The split of the two WRITES is a cost decision, not a safety one

- Item nonces are marked in `beforeSwap`, because that is where the batch is already being walked and
  walking sixty-four items twice would double the dominant cost.
- The session's cumulative spend is committed in `afterSwap`, because it is the number that should
  only exist once value has moved.

Both writes live or die with the transaction — a revert in `afterSwap` unwinds the marks made in
`beforeSwap` — so **neither placement is safer than the other.** Saying so is cheaper than letting a
future reader infer a safety property that is not there.

---

## 5. What was found while building it

**`InputAboveMaximum` is unreachable on the exact-input path.** v4 never consumes more than the
amount specified, and `beforeSwap` already refuses a specified amount above `maximumInput`, so on the
exact-input path the guard can never fire. A guard whose failing case is never constructed is not a
guard. It is reachable only on the **exact-output** path, where the input is not known until the pool
has run, so the test was written there —
`test_RevertWhen_exactOutputCostsMoreThanTheMaximumInput` — and it asserts the pool really did charge
a fee first, so the test cannot pass for the wrong reason.

**Reordering is caught twice, and both defences were checked separately.** Exchanging two items
trips `ItemIndexMismatch` because their `index` fields travel with them. Rewriting the indices to
match their new positions gets past that — and is then caught by the order-sensitive batch digest.
Two tests, because one would have hidden the other.

**Omitting an item is a wrong *batch*, not a wrong *amount*.** The digest comparison runs before the
aggregate comparison, so a dropped item is refused as `BatchDigestMismatch` rather than as a short
aggregate. The short-aggregate case is tested separately, by raising `authorizationAmount` on an
otherwise perfect batch.

**A nonce was spent globally instead of by its payer.** Found by review, not by a failing test, and
the most serious thing this experiment turned up. Both nonce maps were originally keyed on the raw
nonce. Nonce values are chosen by the payer, and a sequential counter is the obvious choice — so
under a global key, payer B settling a batch with nonce 1 would permanently burn payer A's nonce 1,
for free, forever. The fix keys both maps on `nonceKey(arcPayer, nonce)`. The new control
`test_control_aNonceIsSpentByAPayerNotGlobally` settles two payers presenting identical nonce values,
and the sabotage sweep re-globalises the key to prove that row is the one that screams. Cost of the
fix: about 496 gas per authorization, measured before and after — see section 7.

**`NotArmed` is a guard whose failing case cannot be constructed here.** `afterSwap` refuses if
`beforeSwap` left nothing in transient storage. With permissions `0xC0`, and `BaseHook` validating
the deployed address against them, both callbacks always run — so no test can reach it. It is kept as
defence in depth and listed in NOT MEASURED rather than presented as a proven guard.

**An event with fourteen parameters does not compile.** The receipt is a struct (`Receipt`) carried
as one non-indexed tuple, because the legacy code generator runs out of stack at fourteen loose
parameters and `via_ir` is not an option — turning it on would change V1's bytecode, and V1 is live.

---

## 6. Test inventory

48 tests, controls first. Every negative test does four things in this order: build a fixture,
**mutate exactly one thing**, assert the **named** refusal, then **restore that one thing and assert
the envelope digest is byte-identical to the pre-mutation digest** before asserting the same payload
now settles. The restore-and-confirm-by-hash step is what stops a test passing because the fixture
was broken all along.

| Group | Rows |
|---|---|
| Controls | 1 / 4 / 16 / 64-item batches settle; receipt carries the pool's own numbers; a hookless pool is not observed; **a nonce is spent by a payer, not globally** |
| Classification | on-chain classification string, Arc chain id, permission mask `0xC0` |
| Domain separation | five typehashes pairwise distinct and none is Circle's; digests independently re-derived; batch digest signed in place of the envelope digest; **a genuine Circle Gateway authorization offered as an envelope** |
| Statics | version · Sepolia chain id · Arc chain id · hook address · pool manager · pool id · Sepolia payer · settlement token · token decimals · merchant config · expired · not-yet-valid · swap shape · wrong signing key · empty hook data |
| Nonces | envelope nonce replayed · same envelope settled twice · one item twice in a batch · an item nonce crossing from an earlier batch |
| Batch | reordered · reordered with indices rewritten · omitted item · injected item · a valid envelope reused over a different batch · request set mismatch · wrong resource · wrong session |
| Amounts | above the per-request ceiling · aggregate overflow · short of the authorization · above the authorization · session ceiling exceeded · empty batch |
| `afterSwap` | output below what the batch authorized · exact-output input above the maximum |
| Measurement | gas for 1 / 4 / 16 / 64 against an identical hookless pool |

---

## 7. THE MEASUREMENT — and it decides the experiment

Command that produced every number below:

```sh
forge test --match-test test_measurement_gasCostPerAuthorization -vv
```

Baseline is an **identical hookless pool** — same currencies, same fee, same tick spacing, same
liquidity, same swap — so the difference is the hook and nothing else. Both pools are warmed with one
prior swap so neither figure pays a first-touch cost the other avoided.

**Baseline swap, no hook: 75,577 gas.**

| authorizations in the batch | execution gas, hook included | hook overhead over baseline | overhead per authorization | hookData bytes | intrinsic calldata gas | **per authorization, incl. calldata** |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 200,629 | 125,052 | 125,052 | 1,280 | 12,512 | **137,564** |
| 4 | 281,515 | 205,938 | 51,484 | 1,856 | 19,616 | **56,388** |
| 16 | 605,277 | 529,700 | 33,106 | 4,160 | 47,888 | **36,099** |
| 64 | 1,910,890 | 1,835,313 | 28,676 | 13,376 | 161,276 | **31,196** |

Two things the table does not include, both of which make it an **under**-estimate of a real
transaction: the 21,000 intrinsic transaction cost, and — in the execution column — the per-byte cost
of carrying the payload in calldata. The calldata column computes that separately on the cancun
schedule (4 gas per zero byte, 16 per non-zero) and the last column adds them.

### Batching works

Sixty-four separate one-item settlements would cost `64 x 200,629 = 12,840,256` gas. One batch of
sixty-four costs **1,910,890** — an **85% reduction**. The aggregation is doing real work.

### The marginal cost is flat, and that is the finding

The interesting number is not the average, it is the slope:

| step | extra gas | extra authorizations | **marginal gas per authorization** |
|---|---:|---:|---:|
| 1 -> 4 | 80,886 | 3 | **26,962** |
| 4 -> 16 | 323,762 | 12 | **26,980** |
| 16 -> 64 | 1,305,613 | 48 | **27,200** |

Plus calldata: the payload grows by 192 bytes per item, `(161,276 - 47,888) / 48 = 2,362` gas each.

> **One more metered nanopayment costs about 29,600 gas, and roughly 20,000 of that is the single
> cold storage write that stops it being replayed.**

The 20,000 figure is the EVM's cold-`SSTORE` price, a spec constant, not an independent measurement
here. It is **73% of the execution marginal** (20,000 of 27,200) and **68% once calldata is counted**
(20,000 of 29,600) — and it is the part that cannot be optimised away without giving up the replay
mark — which is the only reason a nanopayment
authorization is worth anything at all.

**What the payer-namespacing fix cost.** Keying both nonce maps on `keccak256(arcPayer, nonce)`
instead of the bare nonce (section 5) moved the marginal from 26,704 to 27,200 gas — **about 496 gas
per authorization, 1.7% of a sixty-four-item settlement**. Both figures were produced by the same
command, before and after the change. That is the price of removing a free griefing vector, and it
is noise beside the 20,000-gas write it protects.

### The economics, with no invented prices

Cost of one authorization in dollars:

```
cost_usd  =  G x p_gwei x 1e-9 x P_eth
```

Break-even against a metered request worth `V` dollars is therefore a condition on the **product** of
gas price and ETH price, which lets the arithmetic be stated without asserting either:

```
p_gwei x P_eth  <=  V x 1e9 / G
```

At the measured marginal `G = 29,600` and a request worth one tenth of a US cent (`V = $0.001`):

```
p_gwei x P_eth  <=  33.8
```

So the break-even gas price falls below **1 gwei** for any ETH price above about **$34**. Whether any
L1 sustains a sub-1-gwei gas price is not measured here; the arithmetic simply says that is what
would be required.

### The verdict, plainly

**On an L1, this hook costs more than the payments it meters, by orders of magnitude.** A batch of
sixty-four authorizations metering one tenth of a cent each is settling $0.064 of value while
spending roughly 1.9 million gas plus 161,000 gas of calldata to do it. Aggregation improves that by
85% and it is still not close.

This is a real result about nanopayments on an L1, and it is more useful than a hook that "works":

- The envelope design is sound and cheap to *verify* — signature recovery plus twenty-six field
  comparisons is a few thousand gas.
- What is expensive is **remembering**. Per-authorization replay protection is a cold storage write
  per authorization, and that alone puts the floor above what a nanopayment is worth.
- Therefore the honest conclusion is not "make the hook cheaper". It is that **per-item on-chain
  replay marks are the wrong shape for nanopayments on an L1.** Whatever remembers a spent nano-nonce
  has to be somewhere storage is not 20,000 gas — which, on this stack, is not here.
- And the thing that would make the design *correct* rather than merely cheaper — knowing what Arc
  did with the authorization — is not a gas problem at all. It is property 3, and no amount of
  optimisation reaches it.

---

## 8. Every guard validated by sabotage

A check that has never failed is not a check, and a suite that is green on the first run is the least
trustworthy result there is. So each guard was **removed or inverted one at a time**, the whole suite
re-run against the broken hook, and the failing tests compared against the tests that *should* have
failed. The file was then restored and confirmed by SHA-256.

Method: `forge test --match-contract NanoAuthorizationTest --json`, one sabotage at a time, file
restored between each. Run against the exact file that ships. Original and restored digest of
`src/lab/NanoAuthorizationHook.sol` both
`5d136d0e9c31d40f62c024021a614efbee4155a1dfdef33160af4c44f1acffc7` — **MATCH**.

| # | Guard removed or inverted | Caught? | Tests that failed |
|---|---|---|---|
| 1 | envelope-nonce mark | CAUGHT | envelope nonce replayed · same envelope twice · nonce-is-per-payer · one-item control |
| 2 | item-nonce mark | CAUGHT | item twice in a batch · item nonce across batches · one-item control · 64-item control |
| 3 | payer namespacing of the nonce key | CAUGHT | nonce-is-per-payer |
| 4 | batch digest comparison | CAUGHT | reordered+reindexed · omitted item · injected item · envelope reused over a different batch |
| 5 | request-set digest comparison | CAUGHT | request set mismatch |
| 6 | item `index` check | CAUGHT | reordered batch |
| 7 | reading `decimals()` from the token | CAUGHT | token decimals |
| 8 | signature recovery | CAUGHT | wrong key · batch digest signed as envelope · Circle Gateway authorization offered as an envelope |
| 9 | output floor (`afterSwap`) | CAUGHT | pool returned less than authorized |
| 10 | input ceiling (`afterSwap`) | CAUGHT | exact output above the maximum input |
| 11 | per-request ceiling | CAUGHT | item above the per-request ceiling |
| 12 | session ceiling | CAUGHT | session ceiling exceeded |
| 13 | item resource binding | CAUGHT | item names another resource |
| 14 | merchant config hash | CAUGHT | merchant recipient vs config hash |

**14 sabotages, 14 caught, 0 silent.** In rows 4-14 the sabotage failed *exactly* the tests it was
predicted to fail and no others — which is the second half of the check: a guard whose removal breaks
everything is not localised, and a suite that fails the wrong rows is not measuring what it claims.
Rows 1 and 2 additionally failed the controls that assert the nonce was marked, which is correct: the
mark is what those sabotages delete.

---

## 9. NOT MEASURED

Everything in this section is absent, not estimated. A precise number that was never produced is a
defect, so none is given.

- **Anything on Arc.** No transaction was sent to Arc, no Arc state was read for this experiment, and
  no Gateway authorization was submitted, verified with Circle or settled. Property 3 is untouched.
- **Any live chain.** The pool is Uniswap's official PoolManager *bytecode* at its canonical address
  inside a local EVM. Nothing here is a testnet result and nothing was deployed.
- **A real transaction's total gas.** The table reports execution gas plus a separately computed
  calldata figure. The 21,000 intrinsic cost, access-list effects, and any L2 data-availability
  pricing are not included.
- **ETH price and gas price.** Deliberately left as free variables. The break-even is stated as a
  condition on their product.
- **EIP-7623 calldata floor pricing.** The calldata figure uses the cancun schedule the repository
  targets (4/16). The post-Prague floor rule is not applied.
- **Batch sizes above 64.** The block gas limit, not the hook, is what eventually stops this, and
  where exactly is not measured here. `test/lab/Limits.t.sol` (Experiment B) is the place that
  question belongs.
- **A calldata-slice decode.** The hook decodes the payload into memory with `abi.decode`. Decoding
  the struct as a calldata slice in assembly would be cheaper. It was not attempted, so no saving is
  claimed — the reported numbers are for the implementation that exists.
- **Whether the merchant was paid.** Structurally unknowable here, as section 1 says: v4 hands the
  output delta to the swapper, not to a named recipient.
- **`NotArmed`.** `afterSwap` refuses if `beforeSwap` left nothing in transient storage. With
  permissions `0xC0` and `BaseHook` validating the deployed address against them, both callbacks
  always run, so its failing case cannot be constructed in this experiment. It is kept as defence in
  depth and is the one guard in this contract with no test behind it.
- **A second swap for the same envelope inside one transaction.** Argued from the persistent
  envelope-nonce mark rather than constructed: `PoolSwapTest` performs one swap per unlock, and no
  two-swap harness was written. The cross-transaction case *is* tested
  (`test_RevertWhen_theSameEnvelopeIsSettledTwice`).
- **Signature malleability / ERC-1271.** Only ECDSA over an EOA key is tested. Contract signatures are
  not supported and not tested.
- **Concurrency between this experiment and Experiment B.** Both suites live in `test/lab/` and were
  developed at the same time in the same tree; they share no contract and no fixture.

---

## 10. Reproducing every number here

```sh
# the whole experiment: 47 tests
forge test --match-contract NanoAuthorizationTest -vv

# just the gas table
forge test --match-test test_measurement_gasCostPerAuthorization -vv

# the four controls that must pass before anything else is believed
forge test --match-test test_control_ -vv
```

Files:

- `src/lab/NanoAuthorizationHook.sol`
- `test/lab/NanoAuthorization.t.sol`
- `docs/lab/EXPERIMENT-A-NANO-AUTHORIZATION.md` (this file)

Nothing in `src/`, `test/` or `docs/` outside those three paths was touched.

---

## Result

```
tests   run: 48, passed: 48, failed: 0
sabotage rows run: 14, caught: 14, silent: 0
file digest before and after the sweep: MATCH
verdict: the hook works, and on an L1 it costs more than the payments it meters
```

The last line is the result. An experiment that stops somewhere specific is worth more than one that
passes, and this one stops at about **29,600 gas per metered nanopayment**, roughly two thirds of it
a single storage write, against a payment worth a tenth of a cent.
