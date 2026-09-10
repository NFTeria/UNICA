# Simulator-only confidential orchestration — what was run, and what it proves

**UNICA is prototyping confidential settlement orchestration with the Chainlink CRE local simulator
while access to hosted Confidential Workflows is under review. The settlement contracts
independently enforce payment-critical constraints.**

Not accepted, not enabled, not deployed. The application is under review. Nothing here deploys a
Confidential Workflow, touches the Private Registry, uses a hosted CRE chain capability, registers a
production secret, or makes any chain write.

## 1. Documentation used

| URL                                                          | What it settled                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs.chain.link/cre/concepts/confidential-workflows`        | What is and is not protected; the "don't log in production" rule; that Confidential Workflows is in private beta and requires enrollment                      |
| `docs.chain.link/cre-templates/hello-confidential-workflows` | `secretsNames` mapping, `runtime.getSecret({id})`, `cre.handlerInTee`, `runtime.usingTheDons()`, the simulate command, and the simulator's own TEE disclaimer |

Not opened this pass: the liquidation-protection, portfolio-rebalancing and AI-audit-firewall
templates. Neither of the two above required them, and opening them would have added nothing this
batch acts on.

## 2. Toolchain, and a reproducible finding

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| CRE CLI     | **v1.32.0**                                                  |
| bun, before | **1.2.5** — below the SDK's declared `engines.bun >= 1.2.21` |
| bun, after  | **1.4.2**                                                    |

**The `wasm unreachable` trap reproduced exactly on 1.2.5 and disappeared on 1.4.2.** The workflow
compiled either way; the engine failed only on the old bun. That confirms this repository's own
earlier diagnosis by experiment rather than by memory.

**The compiled binary hash changes with the bun version** — `924c5266…` on 1.2.5, `0e5079e0…` on
1.4.2, same source. Any recorded binary hash is therefore a hash of a _toolchain plus_ a source, and
saying only the latter would be misleading.

```bash
cd integrations/chainlink-cre-guardian
cre workflow simulate workflow --target staging-settings --non-interactive --trigger-index 0
```

## 3. Simulator results

Three runs, each answering something the previous one raised.

| Run                                    | Result                                                                                                            | What it established                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1, bun 1.2.5, no secrets exported      | `failed to replace secret names with environment variables: environment variable UNICA_MIN_RESERVE ... not found` | The documented `secretsNames` → env-var mechanism, confirmed by running it |
| 2, bun 1.2.5, synthetic canary secrets | compiled, then `wasm trap: unreachable`                                                                           | Secrets resolved; the engine failure is the bun version, not the workflow  |
| 3, bun 1.4.2, synthetic canary secrets | **TEE handler reached**; run ended `invalid BigInt literal`                                                       | The handler executed with the canaries live in its frame                   |

Run 3 printed the simulator's own disclaimer, which is the reason this integration's confidentiality
evidence is offline:

```
Handler requested TEE Execution
The simulator is not a real TEE, and is meant to debug.
Do not use it for sensitive information.
During real execution, user logs for this trigger will not be visible, and will not leave the TEE.
They are presented in the simulator for debugging only.
```

**Run 3 is also a confidentiality result.** The canaries were malformed for that workflow, which
expects numeric policy values. It failed on `invalid BigInt literal` — and **the error did not echo
the malformed secret. 0 of 5 canaries appeared anywhere in the simulator's output.** That is the
"malformed secret value" boundary, tested through the real tool rather than asserted.

## 4. The confidentiality boundary, and why it is tested offline

The simulator **cannot** test confidentiality, by its own statement, and deliberately shows enclave
logs that production hides. So a canary in a simulator log is expected behaviour, not a leak, and
asserting its absence there would assert something the tool says is false.

What survives into production — and is therefore what `tests/confidentiality.test.mjs` checks —
is the public result, serialized artifacts, error messages, stack traces, calldata, and tracked
files. **18 checks, 18 passed**, including two controls: a deliberately planted canary IS detected,
and a context that includes the private policy DOES leak, which is why policy is never put in one.

| Surface                                 | Canary present?    |
| --------------------------------------- | ------------------ |
| Public result (JSON and `util.inspect`) | no                 |
| Thrown error message and stack          | no                 |
| Error raised _after_ secret access      | no                 |
| Malformed private field                 | no                 |
| All four rejection paths                | no                 |
| Constructed calldata                    | no                 |
| Whole-context object excluding policy   | no                 |
| _Control:_ context including policy     | **yes, by design** |
| _Control:_ planted canary               | **yes, detected**  |

## 5. Repository scan

`script/check-cre-confidentiality.sh`, wired into `make gate`. **12 checks, 12 passed**, five of
them controls. It refuses: a committed canary, a populated secret assignment, key-shaped material,
a tracked simulator credential file, a private field name in a fixture, an unsupported "CRE
verified" claim, and an unsupported live-Confidential-Workflow claim.

It found two real things on its first run:

1. **`integrations/chainlink-cre-guardian/workflow/.env.example` carried populated demo values.**
   A populated `.env.example` is the shape that teaches the next person to put a real one there.
   Blanked to names only.
2. Its own claim rule fired on a **quotation** of Chainlink's "Don't log in production Confidential
   Workflows" guidance. Tightened to require a verb asserting existence, so a quoted warning and a
   truthful denial both pass — a check that cries wolf on its own documentation gets ignored.

## 6. Trust boundary

**No contract trusts a workflow result.** No CRE report verifier, no DON signer, no `CRE verified`
signal, and no contract argument that a workflow can influence. Every settlement-critical
constraint is enforced by `src/experimental/robinhood-testnet/` and holds with CRE absent, stale,
unavailable or hostile.

The workflow **cannot produce `confirmed` evidence** — `decide()` throws on it and a test asserts
that. `mock` and `simulated` may never be rendered as `confirmed`.

Recorded as a future candidate only, not implemented: the public docs reference a Confidential
Workflows Client SDK reference for on-chain interaction details. Compatibility and deployment
availability are both unproven, so nothing was built against it.

## 7. Permission matrix

| Activity                                                    | Status                  |
| ----------------------------------------------------------- | ----------------------- |
| Local simulator development                                 | permitted               |
| Public reference-template exploration                       | permitted               |
| Confidential Workflow deployment                            | **requires enablement** |
| CRE-hosted testnet reads / writes / triggers                | **requires enablement** |
| Robinhood testnet 46630 support                             | unresolved              |
| Test payout-token deployment                                | unresolved              |
| Hook / executor deployment                                  | unresolved              |
| Pool initialization                                         | unresolved              |
| Liquidity seeding                                           | unresolved              |
| Public disclosure of future workflow/deployment identifiers | unresolved              |

**Local-development permission is not permission for a blockchain write.** No chain write was made
and none is proposed.

## 8. Unresolved deployment questions

1. Whether enrollment has been granted — the application is under review; `Deploy Access` reads
   _Not enabled_.
2. Whether a real on-chain CRE verification interface exists that this settlement could use, and on
   which chains.
3. Whether any of the five unresolved rows in §7 is permitted.
4. Whether workflow identifiers may be disclosed publicly once one exists.
