# UNICA — sponsor eligibility, by track

Five submissions, each to a **from-scratch** pool, because this repository was created inside the
build window and has no predecessor. The evidence for that is `docs/PROVENANCE-LEDGER.md`, and it
is one `git log` away.

This file exists so a judge does not have to reconstruct which parts of UNICA are live, which are
prepared, and which are blocked on something only the repository owner can do. **A status is not a
claim of quality — it is a statement about what has actually happened.** Nothing here is raised
because the work feels close to done.

## Status vocabulary

| Status | Means |
|---|---|
| `READY_FOR_FORM_SUBMISSION` | the engineering is complete; a human must fill in a form |
| `BLOCKED_ON_CRE_SIMULATE` | the workflow compiles to a CRE WASM binary; the CLI's own simulator cannot start an engine for it |
| `READY_FOR_STUDIO_OWNER_ACTION` | complete; blocked on a Subgraph Studio deploy key |
| `READY_FOR_WALLET_CONFIRMATION` | complete; blocked on a wallet signature the owner must give |
| `READY_FOR_ARC_DEPLOYMENT_ACTION` | complete; blocked on funding and a broadcast on Arc |

Every one of those boundaries is deliberate. No agent in this project signs, broadcasts, spends,
registers, or submits — those are owner actions, and stopping cleanly in front of them is a design
property, not an incomplete build.

## The five

### 1. Uniswap — Best Uniswap Stack Contribution (From Scratch)

**Status: `READY_FOR_FORM_SUBMISSION`**

Uniswap is not a component of UNICA; it is the settlement mechanism. A merchant's invoice names an
exact asset and an exact amount, and Uniswap v4 performs the conversion that discharges it, with a
hook that refuses anything short of a full fill.

| Evidence | Where |
|---|---|
| Deployed and source-verified on Ethereum Sepolia, one settlement receipted | the proof table in `README.md` |
| Tests run against Uniswap's deployed bytecode, not mocks | `test/fork/` — `make fork` |
| Every guard validated by deletion | `make mutants` |
| Developer feedback, written while building | `FEEDBACK.md` |
| Prepared form answers | `docs/UNISWAP-SUBMISSION.md` |

Remaining: the form itself.

### 2. Chainlink — Best Confidential Workflow (From Scratch)

**Status: `BLOCKED_ON_CRE_SIMULATE`**

A real CRE Confidential Workflow — a cron-triggered TEE handler that reads a merchant's treasury
position, applies a deterministic bounded policy, and publishes a decision without publishing the
policy that produced it.

| Evidence | Where |
|---|---|
| The workflow | `integrations/chainlink-cre-guardian/workflow/main.ts` |
| Its tests | `main.test.ts` — `cd integrations/chainlink-cre-guardian/workflow && bun test` |
| The deterministic policy underneath | `integrations/chainlink-cre-guardian/strategy.mjs` |
| The confidentiality boundary, and its one stated leak | the workflow's own header and its leak tests |

`cre login` is **done** (CLI v1.32.0, SDK 1.18.0), and running the real toolchain is what moved
this row. Three defects in our own workflow were found and fixed by it, after which the workflow
**compiles** — binary hash `924c5266…`, config hash `bece38e7…`, secrets bound, credentials
validated. That had never happened before today.

It then stops inside the SDK: `failed to execute subscribe` with a bare `wasm unreachable` trap.
Narrowed by elimination across separate runs — not the TEE constraint shape, not `handlerInTee`
versus `handler`, not our own config validation. `docs/feedback/chainlink.md` carries the table.

**It has never executed, in a TEE or otherwise**, and the evidence grade it stamps on its own
output says exactly that — `CRE_CONFIDENTIAL_SIMULATION`, never `TEE_ATTESTED`. Separately,
`cre whoami` reports **Deploy Access: Not enabled**, so a deployment needs `cre account access`
regardless.

### 3. The Graph — Best AI Tooling or AI Use Case with The Graph (From Scratch)

**Status: `READY_FOR_STUDIO_OWNER_ACTION`**

> Published requirement, retrieved 2026-09-05: *"Use The Graph as a load-bearing part of the
> project: either the AI tooling targets The Graph's products or AI Suite, or the agent/app uses
> The Graph (Subgraphs, the Subgraph MCP, or Substreams) as its source of blockchain data"*, and
> *"Must consume live data via API keys or Graph Market streaming."*

The merchant's own record of what settled, indexed, and a deterministic analyst on top of it. The
subgraph is the source of blockchain data for that analysis — remove it and the feature has no
inputs.

| Evidence | Where |
|---|---|
| Subgraph manifest, schema, mappings, deterministic entity ids | `integrations/graph-v2/` |
| Consistency checks the mapping tests cannot make | `node integrations/graph-v2/check.mjs` |
| Live provider and the treasury analysis | `integrations/graph-v2/` — see its `README.md` |
| Owner steps to deploy | `integrations/graph-v2/STUDIO-OWNER-ACTION.md` |

Remaining: a Subgraph Studio deploy key. The live proof command **fails closed** without one — it
prints which variable is missing and exits non-zero. An offline run cannot be mistaken for a live
one, which is the whole point.

### 4. ENS — Best Use of ENSv2 (From Scratch)

**Status: `READY_FOR_WALLET_CONFIRMATION`**

> Published requirement, retrieved 2026-09-05: *"Project must be built on ENSv2 (Sepolia). ENSv2
> features should be central to the product, not a cosmetic add-on. Your demo must be functional
> and not just include hard-coded values."*

A merchant is a name, not an address — and in ENSv2 a name is also an authorization model. UNICA
resolves the name live on Sepolia, commits that reading into the signed quote so the address a
payer was shown is part of what was agreed, and exercises ENSv2's permissioned resolution and
access control rather than treating the name as decoration.

| Evidence | Where |
|---|---|
| Live Sepolia resolution, every failure shape classified | `node integrations/ensv2/live-check.mjs` |
| Name → canonical configuration → quote commitment | `integrations/ensv2/config.mjs`, `identity.mjs` |
| Permissioned resolution and access control | `integrations/ensv2/` — see its `README.md` |
| Owner steps | `integrations/ensv2/ENS-OWNER-ACTION.md` |

No hard-coded demonstration values sit on the resolution path: names resolve against live ENSv2
Sepolia contracts, and a name that cannot be normalised correctly is refused rather than
approximated.

Remaining: a wallet signature for the record the owner controls.

### 5. Arc — Best DeFi / Onchain Finance Application

**Status: `READY_FOR_ARC_DEPLOYMENT_ACTION`**

> Published requirement, retrieved 2026-09-05: *"Build stablecoin-native DeFi on Arc."* And,
> separately on the same page: *"Build lending, borrowing, swaps, liquidity, FX, yield, payments,
> treasury or fintech infrastructure using Arc and USDC."*

**Treasury is named in the requirement itself**, which is why this is the track and why no swap
had to be invented to reach it.

A merchant treasury on a chain where the money and the gas are the same asset. Bounded policy,
reserve floor, per-action cap, one permitted transfer — and a transaction preview that stops in
front of the signature.

**There is no swap path on Arc and this project does not pretend there is one.** Uniswap is
UNICA's exclusive DEX and no official source places Uniswap on Arc, so the Arc work is the leg that
needs no DEX. Sepolia Uniswap settlement and Arc treasury operation are two separate, separately
labelled network paths; nothing crosses between them.

| Evidence | Where |
|---|---|
| Official and observed Arc facts, each marked which | `docs/ARC-FACTS.md` |
| The treasury flow | `integrations/arc-treasury/` |
| Owner steps | `integrations/arc-treasury/OWNER-ACTION.md` |

Remaining: faucet funding and a broadcast on Arc testnet, both owner actions.

## A note on track names

Every track name on this page was read from the prize page and is dated. Names get edited during an
event, and a name carried forward from a doc rather than re-read from the page is the kind of stale
fact that costs a submission. **Re-confirm each one against the live page before the form is
filled.** `docs/INTEGRATIONS.md` deliberately preserves an earlier, differently-named Arc reading
rather than overwriting it, for the same reason.

## What UNICA does not claim

- No prize, placement, or finalist status at any event, past or present.
- No Uniswap deployment on Arc, and no UNICA contract running on Arc.
- No Arc mainnet — it does not exist; Arc is testnet-only in every source retrieved.
- No TEE attestation for the Chainlink workflow until it has actually run in one.
- No tokenized-asset availability. The Robinhood chain was probed and nothing was integrated.
- **V2 is not shipped.** It is frozen as `v2.0.0-rc1` with an open Critical that we found,
  reproduced, published and blocked our own release over. See `docs/v2/SECURITY-ADVISORY-001.md`.

## Who built it

UNICA is built by **NFTeria**. The name means *one of a kind*.
