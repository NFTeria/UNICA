# vy — the settlement arithmetic, expressed a second time

This workspace is a **model**, not a product. It is not a deployment target, it is not a second
implementation of the settlement contracts, and nothing in it ever reaches a network. It exists
so that the arithmetic of settlement has a second, independent expression that is allowed to
**disagree** with the Solidity — which is the whole reason a second expression is worth writing.

A Vyper contract cannot be the v4 hook. A v4 hook's permissions are encoded in the low bits of
its own address and the framework the hook slots into is a set of Solidity base contracts. That
is a fact about the protocol, not a limitation of Vyper, and it is why this workspace models the
settlement rather than reimplementing it.

## The five modules

| module | the rule it models |
|---|---|
| `src/bushmaster.vy` | the pool's single-range swap step: fee, next price, both amount deltas, exact-input and exact-output |
| `src/constrictor.vy` | the full-fill rule — the pool consumed **exactly** the order's input, or the settlement is refused |
| `src/rattler.vy` | the two minimum-out gates: the pool's credit, and the recipient's realised balance change |
| `src/sidewinder.vy` | exact-input-with-a-floor against exact-output-with-a-ceiling, and where each residual lands |
| `src/egg_eater.vy` | 18-decimal input against 6-decimal payout: what the payout grid absorbs, and what it sheds |

## Running it

```sh
mox compile
mox test
```

`mox test` exits 0 on a clean run and 1 on any failure, so a gate can rely on its exit code.
Capture that exit code directly: piping the command into another one reports the other one's
status, not this one's.

## What it found

The model is worth its second language only if it can disagree with the first. It did, twice.

**It reproduced the live settlement's output from the pool's published state, at the first
attempt and without tuning.** From `sqrtPriceX96` 3961408125713216879677197, liquidity
204325880000 and fee 3000 pips, a single-range exact-input step gives 997000000000000 after the
fee, a next price of 3184480767118829947872700, and an output of **2003660** — the number the
recipient actually received (`README.md`, the settlement row). Computed twice, once in Vyper
inside the EVM and once in Python at arbitrary precision, and shown by sabotage to be capable of
disagreeing.

**It contradicted its own author on the direction of a rounding asymmetry.** Buying back exactly
the output that exact-input delivered costs 999999481731068, not the 1000000000000000 that was
paid. So an exact-output settlement of the same invoice would leave **518268932 wei of input
residual**, and a plan that settles the open delta has no action that returns it. That is a real
input to the V2 design and it was found by the model, not by the person writing the assertion.

## What it does not prove

It is arithmetic. It says nothing about the protocol: not the admission rule, not replay, not
custody, not the receipt, not what the deployed contracts do. Those live in `test/` and on chain.
A disagreement between this model and the Solidity is a question to investigate, never a verdict
on either.

## Validating it

Four sabotages, each restored and confirmed byte-identical afterwards:

| planted fault | result |
|---|---|
| `assert 1 == 2` | 1 failed, exit 1 |
| the observed output moved by one unit | 6 failed, exit 1 |
| liquidity moved by 0.1 per cent | 5 failed, exit 1 |
| the fee changed from 3000 pips to 500 | 5 failed, exit 1 |
| nothing planted | 33 passed, exit 0 |

A liquidity change of one unit in 204325880000 does **not** turn the quote row red, and that is
correct rather than a gap: it is a relative shift of about five parts in a trillion, far below
one unit of a 2003660 output, so the floor division lands on the same integer. Only the
round-trip row, which compares two large numbers rather than a rounded one, is sharp enough to
see it. A sabotage has to be bigger than the rounding it is trying to disturb.

## Provenance

The workspace skeleton — `.gitignore`, `.coveragerc`, `.gitattributes`, `script/__init__.py` and
the initial `moccasin.toml` — is the output of `mox init`, Moccasin's public starter kit,
disclosed here as starter-kit scaffold. The four live network sections that scaffold ships were
removed rather than left unused, so nothing here can be pointed at a chain by accident. Every
`.vy` module and every test was written for this repository from the descriptions in `src/` and
`docs/`; no code was copied from anywhere.
