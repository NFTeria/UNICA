# Chainlink CRE Confidential Workflow — what exists, and the one action that is not ours

**Status: `READY_FOR_CRE_LOGIN`.** The workflow is written, typechecks against the official SDK,
and its decision logic is tested. The official simulation has **not** been run, because the CRE CLI
requires a login that is an owner action. No claim of eligibility is made here.

## The correction that started this

Until 2026-09-08 this repository described `integrations/chainlink-cre-guardian/*.mjs` as a
confidential workflow with "the confidential shape built and tested". **That was too generous.**
Those modules are a deterministic policy, an adapter, and a commitment, with a secrets-shaped
boundary. They never imported the CRE SDK, never registered a TEE handler, and never ran under the
CRE runtime. `git grep handlerInTee` over the tree returned one hit, in a feedback document
*describing* the requirement.

The published bar is `handlerInTee` (TypeScript) or `cre.HandlerInTee` (Go). A JavaScript function
named "confidential" does not meet it. The `.mjs` modules keep their value as the reference model
the decision arithmetic is checked against; they are not the submission.

## What now exists

`integrations/chainlink-cre-guardian/workflow/` — a real CRE Confidential Workflow.

| | |
|---|---|
| SDK | `@chainlink/cre-sdk@1.18.0`, pinned to match the official challenge |
| Handler | `handlerInTee(cron.trigger(...), onCronTrigger, {})` |
| Runtime type | `TeeRuntime<Config>` |
| Secrets | `runtime.getSecrets([...]).result()` — five private policy values |
| Typecheck | clean against the official SDK's own type definitions |
| Tests | 30 rows, 860 assertions, `bun test`, in `make gate` |

**Private, inside the handler:** minimum settlement reserve, target allocation, per-action cap,
risk threshold, cooldown.

**Public, returned:** policy commitment, workflow version, action class, bounded amount, reason
*category*, permitted target and selector, observation block and time, sequence, expiry, evidence
grade.

## The five actions, and nothing else

`NO_ACTION`, `HOLD_SETTLEMENT_ASSET`, `RESTORE_MINIMUM_RESERVE`, `REDUCE_APPROVED_EXPOSURE`,
`PROPOSE_BOUNDED_REALLOCATION`. There is no parameter that could carry a request to call something
else: the target and selector come from config and are checked against it before any calldata is
returned. Nothing constructs unrestricted calldata.

## What the commitment proves, precisely

That a decision was produced under a policy whose values hash to `policyCommitment`, and that the
same values reproduce it. It does **not** prove the policy is safe, is profitable, ran inside a TEE,
or that the output does not itself reveal the policy. The construction is FNV-1a over the decimal
values — deterministic and dependency-free inside the enclave, and **not** collision-resistant in
the cryptographic sense. It detects substitution; it is not a commitment scheme with a security
proof, and nothing here claims it is.

## The leak boundary, measured

`main.test.ts` asserts field by field, across the whole balance range, that the reserve, target
allocation, risk band and cooldown are never the value of any published field. A control row plants
a leak and proves the check catches it. The reason and action vocabularies are asserted to contain
no digits at all.

**One known limitation, asserted rather than hidden.** The per-action cap **is** inferable. It is
the supremum of every amount the policy can propose, so enough observations converge on it, and a
single *clamped* action publishes it exactly — the clamped amount is the cap. That is a property of
proposing a bounded action, not an encoding slip. Two test rows pin it, and if a future design hides
the cap, those rows are what start failing.

An earlier draft of the leak test compared secrets as substrings of the rendered JSON. That is
stricter-looking and wrong: an amount of `12500000` "contains" `2500`, so digit coincidence read as
leakage. Leakage is a field whose value *is* a secret, and that is what is now asserted.

## The owner action, in full

`cre workflow simulate` requires authentication. Both v1.32.0 and v1.21.0 of the CLI refuse with
*"not logged in and no CRE_API_KEY set"*, so this is not a version quirk.

**This is a smaller gate than Early Access, and the distinction matters.** The official challenge
README says simulation "works fine without" Early Access — true, Early Access gates *deployment*.
Simulation still needs a CRE **account**. Account registration is an owner action.

Once logged in, one command produces the evidence:

```sh
cd integrations/chainlink-cre-guardian
cre workflow simulate workflow --target staging-settings --non-interactive --trigger-index 0
```

Nothing is broadcast: `--broadcast` is deliberately absent, so the run reads Sepolia and returns a
decision. `workflow/.env` already carries demo policy values and is gitignored.

**Capture from that run:** the exact command, the CLI version, the workflow source hash, the
successful result, the confidential-handler registration line, redacted logs, the commitment, the
public action/no-action output, and the evidence grade.

## Evidence grading

`CRE_CONFIDENTIAL_SIMULATION` is what a successful CLI run earns, and it is what the workflow
returns. `TEE_ATTESTED` exists in the vocabulary and is **not** what this returns; only a real DON
run with attestation evidence may ever set it. A simulation is not a deployment and not an
attestation, and no document in this repository says otherwise.

## Honest status line for public use

> The confidential workflow is implemented against Chainlink's official Confidential Workflow
> handler and is ready to demonstrate through the CRE CLI simulation path. It has not been run: the
> CLI requires an account login, which is an owner action. It is not a live DON deployment and not
> a TEE attestation.

Only the word "demonstrated" changes, and only after the simulation succeeds.
