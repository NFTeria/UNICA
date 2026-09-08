# Chainlink

**Touches UNICA today:** nothing in the tree. One seam was considered and set aside: an
executor-side price-feed read as a sanity check on an order's quoted price before settlement.

**Published requirement** (Best Chainlink-Powered Upgrade, ethglobal.com/events/ethonline2026/
prizes, retrieved 2026-09-05): "Integrate at least one Chainlink service directly within smart
contract logic or onchain workflows."

**What would have to be built:** a price feed read inside `SettlementExecutor` or the hook,
comparing an order's stated minimum against a live feed before allowing settlement to proceed.
Not built; no defect motivated it, it is a hardening idea, not a fix. Separately, the
Confidential Workflow track's own bar — registering a TEE handler — is not met by a plain feed
read, and the Upgrade track's own prize is marked Continuity-only in our research, which closes
it to a from-scratch entry; neither track fits this seam as designed.

**What we'd ask Chainlink to change:** no request. Nothing encountered while scoping this seam
pointed at a documentation or interface gap.

Status: no claim of qualification.

---

## 2026-09-08 — source inspection of the liquidation-protection challenge

Pin: `solangegueiros/cf-liquidation-protection-challenge@58b24604795cd4c8a32ccd30e4d11f4962e3b3ac`,
MIT. Toolchain observed: `@chainlink/cre-sdk@1.18.0`, Bun (README asks for >= 1.2.21).

**VERIFIED** — the challenge is **owner protection**, not third-party liquidation. `README.md`:
"Build a Confidential Workflow that protects a virtual ETH-collateral/vUSD-debt position." Every
participant receives an identical position via `join()`.

**VERIFIED** — there is **no Chainlink price feed** in the challenge. `vETHPrice` is set by an
admin call, `updatevETHPrice()`. Data Feeds, Automation and Functions are not required; the trigger
is a CRE cron (`CronCapability` + `handlerInTee` in `automated-liquidation-protection-workflow/main.ts`).

**VERIFIED** — no asset conversion is needed. `join()` grants 5.00 free vETH and 3000.00 free vUSD
alongside the position, and both protective actions (`deposit`, `repay`) take assets the participant
already holds. We are therefore **not** routing this through Uniswap; doing so would add a failure
point and earn nothing in the published scoring.

**OBSERVED** — the effective liquidation boundary is higher than the threshold implies.
`calcHF` floors, and `checkAllHF` liquidates at `hf <= 100`. An untouched starting position is
liquidatable at any price at or below **1812.82** (9.4% below the start), and the $1800 step of the
"safe volatility" scenario floors to exactly 100. **All five published scenarios liquidate an
untouched position.** Reproducible: `node integrations/chainlink-cre-guardian/test.mjs`.

**OBSERVED** — the example workflow computes its collateral requirement with **floor** division
(`main.ts`, `neededCollateral`), where the contract also floors when it recomputes. That can land
one unit below the intended target. Our model rounds that division up; the difference is a killed
mutation in our suite.

**OBSERVED** — the example logs `hf`, `minHfTrigger` and `targetHf` through `runtime.log`. The
published confidentiality scoring awards three points for "no private inputs appear in logs, errors
or public configuration".

**BLOCKER** — `README.md` names ChallengeLending `0x9792b3cc…`, vETH `0x5dED1a40…`, vUSD
`0x6Fe92Ead…`. `automated-liquidation-protection-workflow/config.staging.json` names
`0x63b91836…`, `0x89F0DF6D…`, `0xC96c0070…`. Both sets are carried in our
`integrations/chainlink-cre-guardian/profiles.mjs` as named profiles with no default.

**SUGGESTION** — a one-line note in the README saying which set the shipped config points at, or
updating the config, would remove the trap entirely.

**QUESTION** — the fifteen open questions are in `FEEDBACK.md`. None has been answered.


---

## Running the real CLI, 2026-09-08 — three defects in our own workflow, and one wall

`cre login` succeeded (CLI **v1.32.0**, SDK **1.18.0**). What it unblocked was not a passing
simulation; it was the discovery that our workflow had never been compiled by the real toolchain,
only typechecked by us and run under `bun test`. Three things were wrong, and all three are ours:

1. **The test file broke the workflow build.** `tsconfig.json` had `"include": ["*.ts"]`, so the
   CRE compiler typechecked `main.test.ts` and failed on `Cannot find module 'bun:test'` — an
   error about the test runner, raised against the workflow, at build time. The `include` of the
   config the CRE compiler reads is a statement about what the WORKFLOW is, not about what the
   directory contains. Fixed by excluding `*.test.ts` and adding `tsconfig.test.json` so the test
   is still typechecked, just not by the workflow build.

2. **Javy refuses exported functions that take parameters.**

       Error: Exported functions with parameters are not supported

   Only the ENTRY module's exports become WASM exports, and `decide`, `policyCommitment`,
   `onCronTrigger` and `initWorkflow` all take arguments — and all must stay exported so the suite
   can drive them directly. Fixed by splitting: `guardian.ts` holds the logic, `main.ts` is the
   entry and its only export takes nothing. **This is worth documenting upstream.** Nothing in the
   quickstart says the entry module's export shape is constrained, and the error surfaces at the
   WASM step with a Javy backtrace rather than at the point where a developer chose to export a
   function.

3. **A `.ts` extension in a relative import** fails the typecheck under the shipped tsconfig
   (`allowImportingTsExtensions` is not enabled). Minor, but it cost a run.

**After those three, the workflow compiles.** That is new and it is checkable:

```
✓ Workflow compiled
  Binary hash: 924c5266c168abc84b59b52184ed1d364610a20d8b16ba455ec250395a55164b
  Config hash: bece38e7321bab5f104f7db19277b54b216940b97ce842960e0c65a85681769d
```

Secrets resolve from `--env`, the five secret names in `secret-names.yaml` bind, and credential
validation passes.

**Then it stops, and this one is not ours:**

```
Failed to create engine: failed to execute subscribe: error while executing at wasm backtrace:
    0:  0x9a097 - <unknown>!<wasm function 313>
    1:  0xdb47f - <unknown>!<wasm function 1231>
Caused by: wasm trap: wasm `unreachable` instruction executed
```

Narrowed by elimination, each a separate run:

| Hypothesis | Result |
|---|---|
| the TEE constraint shape | `{}` and `[{tee:"nitro",regions:[NITRO_REGIONS[0]]}]` **both trap** |
| `handlerInTee` specifically | swapping to plain `handler` **still traps** |
| our own config validation | replaced every `throw` with a log — **it never fires** |

So the throw is inside the SDK's subscribe path, before our code runs, and is not caused by the
confidential handler. **What we would ask for:** a JS-level error rather than a bare
`unreachable` trap with a raw WASM backtrace. As it stands the failure names no capability, no
field and no line, and the only way to learn anything is to bisect the workflow by deletion.

**Unverified hypothesis, stated as one:** CLI **v1.32.0** against SDK **1.18.0** may simply be
mismatched version lines. We have not confirmed which SDK version this CLI expects, and we are
not claiming a version bug — only that the pairing is untested by us and the error gives a
developer nothing to distinguish that from their own mistake.

Also observed, and transient: `api.cre.chain.link` returned a **Cloudflare 520** during credential
validation, self-described as retryable after 60 seconds. It cleared on the next attempt. Noted
only so a reader does not mistake it for the trap above.

**Account state:** `cre whoami` reports **Deploy Access: Not enabled**, so `cre login` alone does
not unblock a deployment; `cre account access` is the request path and is an owner action.

Status: `BLOCKED_ON_CRE_SIMULATE`. The workflow compiles to a CRE WASM binary with a stated hash.
It has never executed, in a TEE or otherwise, and the evidence grade it stamps on its own output
still says `CRE_CONFIDENTIAL_SIMULATION` rather than `TEE_ATTESTED`.
