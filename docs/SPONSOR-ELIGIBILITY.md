# UNICA — sponsor eligibility, by track

Five submissions, each to a **from-scratch** pool, because this repository was created inside the
build window and has no predecessor. The evidence for that is `docs/PROVENANCE-LEDGER.md`, and it
is one `git log` away.

This file exists so a judge does not have to reconstruct which parts of UNICA are live, which are
prepared, and which are blocked on something only the repository owner can do. **A status is not a
claim of quality — it is a statement about what has actually happened.** Nothing here is raised
because the work feels close to done.

## Status vocabulary

An earlier version of this file used the word **owner-gated**, and it was wrong in a way worth
correcting rather than quietly editing. It filed finished integrations under a label that reads as
unfinished.

UNICA not owning an ENS name does not make the ENS integration incomplete, any more than a payment
processor is unintegrated because it does not own a shop. The integration resolves whatever name a
merchant owns; that is the product. The same applies to Arc: reading a live position, deciding a
bounded action and producing a signable transaction IS the integration. Broadcasting one is a
demonstration of it.

So the axis below is **what the code actually does**, which is the question a judge is asking. How
deeply each has been demonstrated is a second, separate line in each section — a next step, not a
blocker.

| Status | Means |
|---|---|
| `LIVE ON CHAIN` | deployed and transacting on a public chain |
| `LIVE READ` | production code paths read real chain state, every run, with no fixture behind them |
| `RUNS IN THE SPONSOR'S RUNTIME` | executes under the sponsor's own toolchain, not merely against our tests |
| `INDEXED END TO END` | a real settlement indexed and queried back out |

What this project still will not do on its own is sign, broadcast, spend or submit a form. That is
one line about four verbs, not a status covering five integrations.

## The five

### 1. Uniswap — Best Uniswap Stack Contribution (From Scratch)

**Status: `LIVE ON CHAIN`**

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

**Status: `RUNS IN THE SPONSOR'S RUNTIME`**

A real CRE Confidential Workflow — a cron-triggered TEE handler that reads a merchant's treasury
position, applies a deterministic bounded policy, and publishes a decision without publishing the
policy that produced it.

| Evidence | Where |
|---|---|
| The workflow | `integrations/chainlink-cre-guardian/workflow/main.ts` |
| Its tests | `main.test.ts` — `cd integrations/chainlink-cre-guardian/workflow && bun test` |
| The deterministic policy underneath | `integrations/chainlink-cre-guardian/strategy.mjs` |
| The confidentiality boundary, and its one stated leak | the workflow's own header and its leak tests |

**It runs.** `cre workflow simulate` returns exit 0, the simulator reports *"Handler requested
TEE Execution"*, the five private policy values load from CRE secrets inside the handler, and the
published result carries a policy commitment, an action class and a reason category with **no
threshold in any field** — the boundary holding under Chainlink's engine rather than only under
our own suite.

Getting there took a control experiment worth reading: Chainlink's own unmodified
`hello-world-ts` template failed at byte-identical WASM offsets, which moved the question from
"what is wrong with our workflow" to "what is wrong with this machine". The answer was `bun`
below the SDK's declared `engines` requirement, reported as a bare `wasm unreachable` trap that
named neither. Two findings we had published before that control were wrong and are retracted in
`docs/feedback/chainlink.md` rather than edited away.

**What it is not.** The CLI says plainly that its simulator **is not a real TEE**. Nothing here
has executed in an enclave, and the workflow stamps `CRE_CONFIDENTIAL_SIMULATION` on its own
output, never `TEE_ATTESTED`. `cre account access` has been submitted and is awaiting Chainlink's
review; until it is granted there is no DON deployment to claim.

### 3. The Graph — Best AI Tooling or AI Use Case with The Graph (From Scratch)

**Status: `INDEXED END TO END` — a real settlement indexed and queried back**

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

> **UPDATE, 2026-09-09.** The **V1** subgraph is deployed and synced — endpoint in `README.md`'s
> dated block, `hasIndexingErrors: false`, one `Settlement` returned whose amounts match the raw
> log. `integrations/graph-v2/` is the one still undeployed, and not on a credential: it subscribes
> to V2's `QuoteSettled` and V2 is deployed nowhere.

### 4. ENS — Best Use of ENSv2 (From Scratch)

**Status: `LIVE READ` — the integration is complete and runs against live ENSv2 Sepolia**

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

No hard-coded demonstration values sit on the resolution path. Names resolve against live ENSv2
Sepolia contracts on every run, the Permissioned Resolver's authorization state is read from the
chain, and an edit is simulated from both an authorized and an unauthorized account with `eth_call`
— two real rows, neither costing gas nor needing a key. A name that cannot be normalised correctly
is refused rather than approximated.

**UNICA owns no ENS name, and that is not a gap in the integration.** The product resolves the name
a *merchant* owns; owning one ourselves would be a demo prop. Every live row reads a name somebody
else registered, discovered from the chain rather than hard-coded, which is a stronger demonstration
than pointing at a name we control.

> **CORRECTION, 2026-09-09.** The paragraph above is no longer true and is kept rather than deleted,
> because the reasoning in it still holds and the change is worth seeing. `unica.eth` **is** now
> registered on ENSv2 **Sepolia** to this project's deployer, and the delegation is broadcast —
> 12 transactions, blocks 11670554–11670579, all `status 1`. The rows that read a third party's name
> still run and still matter: resolution is not hard-coded to a name we hold. What we now
> additionally have is the *merchant* side, which needed a name we control to demonstrate at all.
> **Sepolia only.** ENSv2's registries hold zero bytes on mainnet; no mainnet name is claimed.

### 5. Arc — Best DeFi / Onchain Finance Application

**Status: `LIVE READ` — the integration is complete and runs against live Arc testnet**

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

**Nothing is broadcast on Arc, and that is the design rather than a gap.** The module reads a live
position, reads the ERC-20's own `decimals()`, decides one bounded action and emits a signable
transaction preview — that whole path is the integration, and every step of it runs. Broadcasting
the preview would demonstrate it; it would not complete it. There is no signer in the directory by
construction.

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
