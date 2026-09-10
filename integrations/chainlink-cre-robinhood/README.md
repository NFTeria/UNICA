# UNICA × Chainlink CRE — confidential settlement orchestration, simulator only

**Status.** UNICA is prototyping confidential settlement orchestration with the Chainlink CRE local
simulator while access to hosted Confidential Workflows is under review. The settlement contracts
independently enforce payment-critical constraints.

Nothing here is deployed. No Confidential Workflow has been deployed, no Private Registry action has
been taken, no hosted CRE chain capability has been used, and no claim is made that a live CRE
integration is operational.

## The one design rule

**CRE may decide whether to attempt a payment. Only the hook and executor decide whether a payment
is valid on chain.**

No contract in this repository trusts a workflow result. Every settlement-critical constraint —
chain, verifying contract, input token, maximum input, payout token, minimum output, recipient,
deadline, nonce, pool, hook — is enforced by `src/experimental/robinhood-testnet/` and holds with
CRE absent, stale, unavailable, or hostile. There is no CRE report verifier and no DON signer.
No contract emits a `CRE verified` signal, and `script/check-cre-confidentiality.sh` fails the
build if one ever appears.

## What the simulator can and cannot show

The simulator prints its own limits, and they are the reason this integration's confidentiality
evidence is offline rather than a simulator assertion:

> "The simulator is not a real TEE, and is meant to debug. Do not use it for sensitive information."
>
> "During real execution, user logs for this trigger will not be visible, and will not leave the
> TEE. They are presented in the simulator for debugging only."
>
> — <https://docs.chain.link/cre-templates/hello-confidential-workflows>

So a private value appearing in a **simulator log** is documented expected behaviour, not a leak.
Asserting its absence there would assert something the tool says is false. What can be tested — and
is, in `tests/confidentiality.test.mjs` — is whether a private value reaches the **public result**,
a serialized artifact, an error message, a stack trace, calldata, or a tracked file. Those surfaces
survive into production.

Chainlink's concept page states the rule this integration follows by construction:
"Don't log in production Confidential Workflows." —
<https://docs.chain.link/cre/concepts/confidential-workflows>

## Data boundary

| PRIVATE — never in the public result  | PUBLIC — must be public for settlement to exist  |
| ------------------------------------- | ------------------------------------------------ |
| Quote-source credential               | chain id, settlement contract, hook, PoolManager |
| Maximum reference/execution deviation | payer (where bound), input token, maximum input  |
| Merchant policy thresholds            | payout token, minimum output, recipient          |
| Preferred route or venue policy       | pool key / pool id, deadline, nonce              |
| Simulation policy                     | policy **commitment** (never the policy)         |
| Transaction-submission configuration  | verdict, evidence class, deviation               |

`schemas/workflow-result.public.json` sets `additionalProperties: false`, so a private value cannot
be added to the public result by accident.

## Evidence classes

`mock` (fixtures) · `simulated` (local simulator or local chain) · `confirmed` (**reserved** for a
real confirmed target-chain transaction). The workflow **cannot produce `confirmed`** — `decide()`
throws on it, and a test asserts that. Neither `mock` nor `simulated` may be rendered or serialized
as `confirmed`.

## Running it

```bash
node integrations/chainlink-cre-robinhood/tests/policy.test.mjs           # offline
node integrations/chainlink-cre-robinhood/tests/confidentiality.test.mjs  # offline
bash script/check-cre-confidentiality.sh                                  # repository scan
```

All three are offline: no CRE CLI, no account, no key, no RPC.

## Relationship to `integrations/chainlink-cre-guardian/`

That integration is kept and not duplicated. Reused from it: the thin-entry split, the
`secret-names.yaml` naming (the CRE default `secrets.yaml` is caught by this repository's broad
`secrets.*` ignore rule), and its honesty pattern of naming the execution modes a file may not
claim. Not reused: its policy arithmetic, deployment profiles and fixtures, all of which are
specific to a different subject.
