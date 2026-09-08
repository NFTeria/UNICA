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
