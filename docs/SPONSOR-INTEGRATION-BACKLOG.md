# Sponsor integration backlog — many candidates, one product

UNICA is one product: a merchant is discovered by name, signs an invoice, a payer authorises a
ceiling of some other asset, and a v4 pool that admits nothing else settles it exactly, in one
transaction, leaving a receipt. Every row below is judged against that sentence, and the test each
must pass is written out per row:

> **Without this integration, UNICA cannot ______.**

If the blank cannot be filled with a real product capability, the row does not become code. That is
the entire purpose of this file: it is the thing that stops a working core competing for attention
with integrations that only exist to be counted.

## How to read the source column, and why so many say UNCONFIRMED

The doctrine this repository works under is: **a published requirement is quoted with the URL of the
artifact containing it, or it is marked UNCONFIRMED.** A remembered requirement is not a requirement.
Several rows below are UNCONFIRMED because their pages were not re-read while this file was written,
and inventing plausible text would be exactly the failure this project refuses to make.

**No row here claims qualification for anything.** A row saying a role is a good fit is a statement
about the product, not about a prize.

---

## P0 — the core product

### Uniswap

| Field | |
|---|---|
| Exact published requirement | For the stack-contribution track, quoted verbatim with its snapshot date in [`docs/INTEGRATIONS.md`](INTEGRATIONS.md) — a public repository with open-source code, a `FEEDBACK.md`, a completed Developer Feedback Form, and a README that points to the relevant contracts and lines. |
| Primary source | The prize page, snapshotted 2026-09-04T19:49Z and quoted in `docs/INTEGRATIONS.md`. Not re-fetched since. |
| Qualifying artifact | The live V1 hook and executor on Sepolia, source-verified, with one settled payment; and the V2 invoice hook and executor, implemented and locally tested. |
| Role in the invoice lifecycle | The venue and the enforcement. The pool IS the settlement, and the hook is what makes "every swap here discharges an invoice" a property of the pool rather than a habit of one caller. |
| Required code | Built. `src/V4SettlementHook.sol`, `src/SettlementExecutor.sol`, `src/v2/QuoteSettlementHook.sol`, `src/v2/QuoteSettlementExecutor.sol`. |
| Required external action | Owner: the Developer Feedback Form, and the identity decision it forces. Not taken. |
| Technical dependency | `v4-core`, `v4-periphery`, Permit2, the official Sepolia PoolManager. |
| Implementation estimate | Done for V1; V2 needs a deploy, which is an owner action. |
| Demo evidence | `make proof` — 36 of 36 against the live chain; tx `0x1120af18…ee0ecb83`. |
| Qualification confidence | Not claimed. The artifact exists; whether it qualifies is the judges' call. |
| Security risk | The highest of any row: this is the money path. Mitigated by 140 tests, 30 killed mutations, and an explicit refusal to claim more than is measured. |
| Status | **P0 — built, live for V1, local-tests for V2.** |
| Without this, UNICA cannot | …exist. There is no product without the pool and the hook. |

---

## P1 — directly strengthens the working product

### ENS

| Field | |
|---|---|
| Exact published requirement | UNCONFIRMED — not re-read in this session. |
| Primary source | UNCONFIRMED. Must be fetched and quoted before any qualification language is written anywhere. |
| Qualifying artifact | `web/ensv2/resolve.mjs` — ENSv2 name resolution on Sepolia through the Universal Resolver at `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, with 36 offline rows and 7 live rows. |
| Role in the invoice lifecycle | **Discovery, and then binding.** The payer types a name; the resolved address becomes the invoice's recipient. The next slice binds the resolution into the quote's `merchantConfigHash`, so an altered ENS record cannot silently redirect an invoice a merchant already signed. |
| Required code | Built for resolution. Owed: the `merchantConfigHash` binding and its tests. |
| Required external action | None for resolution — reads only. Registering a name would be an owner action and is not required. |
| Technical dependency | The ENSv2 Universal Resolver on Sepolia; an RPC. |
| Implementation estimate | The binding is a small slice: hash the normalised name, namehash, recipient, payout currency, chain id and configuration version into `merchantConfigHash`, and four tests proving each component moves the hash. |
| Demo evidence | `node integrations/ensv2/test.mjs`; `make gate-live` for the live rows. |
| Qualification confidence | Unknown, and deliberately unstated. |
| Security risk | Low, and one specific thing must never be said: **resolution is not identity.** A name resolving proves who controls the name and nothing about the merchant. Two of three failure shapes return success with `address(0)` rather than reverting, which is why every outcome is classified explicitly. |
| Status | **P1 — resolution built; binding is the next ENS slice.** |
| Without this, UNICA cannot | …let a payer address a merchant by name and have that name be part of what the merchant signed. |

### The Graph

| Field | |
|---|---|
| Exact published requirement | UNCONFIRMED — not re-read in this session. The prior finding, recorded when it was read, was that a clean Studio deployment alone would not clear the published bar and that the exclusion text continues "; consider the Best AI Use Case track instead". That must be re-read before it is relied on. |
| Primary source | UNCONFIRMED. |
| Qualifying artifact | `integrations/graph/` — a V1 manifest, schema and handler with matchstick tests and a local end-to-end reconstruction. Not deployed. |
| Role in the invoice lifecycle | **Afterwards.** Invoice by quote digest, paid or unpaid, merchant history, payer history, volume by asset, V1 versus V2. A payment system that cannot answer "was this invoice paid" is not finished. |
| Required code | Built for V1. Owed for V2: a separate indexer namespace reading `QuoteSettled`. The frozen V1 manifest and schema are not to be edited for it. |
| Required external action | Owner: a Subgraph Studio deployment. Not taken. |
| Technical dependency | `graph-cli`, `matchstick`; a deployed V2 executor for the V2 namespace. |
| Implementation estimate | The V2 namespace is a day's work once a V2 receipt exists on a public chain. |
| Demo evidence | `bash integrations/graph/local-e2e.sh`. |
| Qualification confidence | **HOLD.** Held deliberately until an honest composition that meets the actual published requirement is found. |
| Security risk | None — it is an observer. |
| Status | **P1 — V1 implemented and locally tested; V2 specified; qualification HOLD.** |
| Without this, UNICA cannot | …answer "was this invoice paid, and by whom" without a node and a log filter. |

---

## P2 — useful after the V2 core

These rows are ranked by how close they sit to the invoice lifecycle, not by how impressive they
sound. **None of them is started, and none should be until the V2 core is deployed.**

### A wallet / onboarding provider

| Field | |
|---|---|
| Exact published requirement | UNCONFIRMED. |
| Role in the invoice lifecycle | Signing. Two signatures make a settlement — the merchant's EIP-712 quote and the payer's Permit2 witness — and both are currently produced by a test harness. A wallet is what makes them producible by a person. |
| Required code | A signing path in `web/`, and nothing in `src/`. The hook and the executor must not import a sponsor SDK. |
| Required external action | Likely an account or a project id. Owner. |
| Technical dependency | EIP-712 typed-data signing with a nested struct — the quote carries a `PoolKey`, so the wallet must render it. |
| Implementation estimate | Unknown until the requirement is read. |
| Security risk | Medium. A wallet that renders a quote badly is a wallet that gets a merchant to sign something they did not read. |
| Status | **P2 — not started.** |
| Without this, UNICA cannot | …be used by a human being. This is the strongest P2 row by that test. |

### An oracle / market-policy provider

| Field | |
|---|---|
| Exact published requirement | UNCONFIRMED. |
| Role in the invoice lifecycle | Only if a volatile input asset is supported. The payer's protection today is a ceiling they signed; an oracle would let a merchant express a policy about how far a price may move before an invoice stops being honourable. |
| Required code | A policy input to the quote, and a version bump. The hook stays ignorant of prices — **an in-hook oracle is a stop-list item in this project.** |
| Security risk | High if done carelessly: an oracle in a settlement path is a new trust assumption and a new failure mode. |
| Status | **P2 — not started, and correctly gated on a volatile-asset feature that does not exist.** |
| Without this, UNICA cannot | …safely quote against a volatile input. Today it does not try to, so the blank is honestly empty. |

### A payment-request / checkout protocol

| Field | |
|---|---|
| Exact published requirement | UNCONFIRMED. |
| Role in the invoice lifecycle | Transport. A signed quote has to get from a merchant to a payer somehow, and that is currently a function call in a test. |
| Required code | Serialisation of the quote and the payer's authorisation, outside the core. |
| Security risk | Low, provided transport cannot weaken quote binding, the ceiling, exactness, one-time consumption, recipient binding, custody or atomicity. That list is the boundary every sponsor module is held to. |
| Status | **P2 — not started.** |
| Without this, UNICA cannot | …move an invoice between two parties without a bespoke channel. |

### A stablecoin issuer / ecosystem

| Field | |
|---|---|
| Exact published requirement | UNCONFIRMED. |
| Role in the invoice lifecycle | The output asset. V1 is USDC-only by construction. `docs/PAYOUT-POLICY-SPEC.md` specifies how a second payout asset would be added and why it is not free: the payout table is compiled into the hook, so widening it moves the address. |
| Required external action | Faucet funding is an owner action. |
| Status | **P2 — specified, not implemented.** |
| Without this, UNICA cannot | …settle in a second currency. It settles in one today and says so. |

---

## P3 — future or blocked

| Candidate | Why it is here |
|---|---|
| Tokenized-asset issuers | A restricted or tokenized asset is only usable once transfer semantics and liquidity are proven compatible. UNICA's delivery promise is an exact balance increase; an asset that cannot honour that is refused by construction, not accommodated. Nothing is claimed about any specific issuer. |
| Chains without a canonical v4 deployment | `docs/` records the survey: a full official v4 stack plus Universal Router exists on Ethereum Sepolia, Base Sepolia, Unichain Sepolia and Arbitrum Sepolia. Where there is no PoolManager there is no product. |
| Chains where the dependencies exist but the licence does not permit deployment | `PoolManager.sol` and seven core libraries are BUSL-1.1, non-production use only, with an Additional Use Grant at an ENS record that currently resolves to nothing. A third party deploying v4-core somewhere new is restricted, and the one mechanism that could permit it cannot be read. Recorded as research; it becomes code only after a separate explicit decision. |
| Cosmetic additions | An integration that does not appear in the invoice lifecycle is not an integration. |

---

## The boundary every sponsor module is held to

Sponsor code lives under `integrations/<name>/`. The hook and the executor import no sponsor SDK,
and nothing outside the core may weaken any of these:

- quote binding — every security-relevant field inside the merchant's digest
- the payer's input ceiling
- exact output to the named recipient
- one-time consumption of an invoice
- recipient binding
- zero custody by the executor
- atomicity — all of it, or none of it

A module may discover merchants, transport signed quotes, onboard wallets, supply objective policy
inputs, index receipts, or display status. It may not touch the list above.
