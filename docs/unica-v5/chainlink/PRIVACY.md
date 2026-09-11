# UNICA v5 / Chainlink — confidential commerce: field classification and leakage analysis

Design record, uncommitted, held for owner review. Companion to
`docs/unica-v5/chainlink/CONFIDENTIAL-COMMERCE.md`, which states the thesis, the mechanism, and the
prohibitions this document assumes rather than repeats. Nothing here deploys, enrolls, signs, or
broadcasts anything, and no field below has ever crossed a real enclave boundary — every
classification is a design analysis of a workflow that has not been built, simulated, or scaffolded
for this design (`CONFIDENTIAL-COMMERCE.md` §6 states that plainly for the parent thesis; the same
is true here).

## 0. Scope

This document classifies every field named in `CONFIDENTIAL-COMMERCE.md` §4 (candidate private
inputs) and §5 (permitted public output), plus the intermediate and downstream fields those two
lists imply, into one of the task's seven labels (§2), then analyses how each of twelve leakage
vectors could still let a private value be inferred even when every field is correctly classified.
It does not re-argue whether the design should be built — that is `CONFIDENTIAL-COMMERCE.md` §10 —
and does not restate UNICA v4's own contract behavior beyond what a classification needs to cite.

## 1. Sources

Retrieval date 2026-09-11 for every row. Kind: OFFICIAL (Chainlink), TEAM (this repository).

| # | URL / location | Author / org | Kind | Used for |
|---|---|---|---|---|
| C1 | `docs.chain.link/cre/concepts/confidential-workflows` | Chainlink | OFFICIAL | The protected/not-protected boundary; the "don't log in production" warning; the side-channel caveat this document's §4.3, §4.9 apply |
| C2 | `docs.chain.link/cre-templates/hello-confidential-workflows` | Chainlink | OFFICIAL | `runtime.usingTheDons()` as the one documented crossing point; the simulator's TEE disclaimer |
| C3 | `docs.chain.link/cre/capabilities/confidential-http-ts` | Chainlink | OFFICIAL | Request-parameter quorum versus response confidentiality — the basis for §4.8's classification of a vendor call's destination as not confidential even when its payload is |
| T1 | `integrations/chainlink-cre-robinhood/policy.mjs`, `tests/confidentiality.test.mjs` (this repository) | UNICA / repository | TEAM | The existing `policyCommitment()` function (FNV-1a, explicitly non-cryptographic by its own comment) as a worked negative example, §5; the existing confidentiality-test surface list (public result, thrown error, calldata, tracked files) this document extends in §4.13 |
| T2 | `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` (this repository) | UNICA / repository | TEAM | The `Order`, `Settlement`, `Merchant`, `Payer` entities and their fields, cited for §3's GRAPH_INDEXED rows and §4.12's finding |
| T3 | `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (this repository) | UNICA / repository | TEAM | The oracle band and its public `deviationBps` output, cited for §4.2's finding that a discount is recoverable from public settlement data regardless of this design |
| T4 | `docs/unica-v5/ens/THREAT-MODEL.md` (this repository, sibling stream) | UNICA / repository | TEAM | Cited by section heading only for §4.11 — its body was not yet written as of this retrieval, so no content from it is used or assumed |

## 2. The classification taxonomy

Applied literally, per field, in §3:

- **PRIVATE_INPUT** — raw data supplied to the workflow that must never appear, in cleartext or in
  any recoverable form, outside the enclave.
- **ENCLAVE_ONLY_DERIVATION** — a value computed inside the enclave from private input(s) that is
  used only to reach the decision and is never placed in `runtime.usingTheDons()`'s output.
- **PUBLIC_REPORT** — a field that does cross `runtime.usingTheDons()` (C2) and becomes part of the
  workflow's public result, per `CONFIDENTIAL-COMMERCE.md` §5's schema.
- **ONCHAIN_STATE** — a value that, only if and after a creator proceeds to call `createOrder` with
  matching terms, becomes a field of an on-chain `Order` (`SPEC-CONTRACTS.md`, T2 §4.14). Never
  automatic; a REFUSE verdict, or an APPROVE the creator does not act on, produces none of these.
- **GRAPH_INDEXED** — a field that, only once ONCHAIN_STATE exists, becomes visible through the
  read layer `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` designs (T2). Never populated directly from
  this workflow's output; always one hop downstream of an actual settlement.
- **UI_ONLY** — a presentational value, never signed, committed, or treated as authoritative by any
  contract or indexer.
- **FORBIDDEN** — must never appear in any of the categories above, under any circumstance, at any
  layer, at any time.

## 3. Field-by-field classification

### 3.1 PRIVATE_INPUT — never leaves the enclave except as a commitment (§5)

| Field | Note |
|---|---|
| Invoice line items (SKU, quantity, unit price) | The finest-grained private data this design handles |
| SKU inventory level | Read, decremented, or reserved only inside the enclave's own logic |
| Wholesale cost per unit | Never appears even approximately in any output field |
| Merchant margin floor | See §4.2 for why this is the field with the least protection the *chain itself* can offer, independent of the workflow |
| Discount rule set / active promotion identifier | — |
| Customer eligibility flag or tier | May itself derive from PII; see the FORBIDDEN note in §3.7 |
| Fraud and velocity signals | Includes any per-customer counters the merchant or a vendor maintains |
| Private API response payload (vendor inventory, pricing, or fraud-scoring data) | The *content* of the response; its *existence and destination* are a separate, less-protected concern, §4.8 |
| Vendor/quote-source API credential | Reuses this repository's existing naming discipline (`secret-names.yaml`'s `QUOTE_CREDENTIAL`) rather than inventing a new one |
| Tax jurisdiction inputs and computed tax amount | — |
| Shipping address and shipping cost inputs | A shipping address is also PII, §3.7 |
| Inventory exposure limit (maximum concurrently reserved units) | — |
| Merchant risk policy thresholds | The private analogue of `OraclePolicy`'s public thresholds (T3 §3) — never public here on purpose, unlike the oracle policy's `maxAge`/`maxDeviationBps`, which are deliberately on-chain and public |

### 3.2 ENCLAVE_ONLY_DERIVATION — computed, used, and discarded inside the boundary

| Field | Note |
|---|---|
| Effective price after discount, before the oracle-band check | Never exported; only a `maxInput`/`minOutput` bound (`CONFIDENTIAL-COMMERCE.md` §5) crosses out |
| Computed margin (price minus wholesale cost) | — |
| Fraud/velocity sub-scores | Only the final `decision` and a coarse `reasonCode` cross out (§3.3) |
| Inventory decrement or reservation state | Any reservation-hold bookkeeping the enclave keeps between calls |
| Resolved Confidential HTTP request values | The values substituted for `{{.key}}` placeholders (C3) — the request's destination and shape are not in this category, §4.8 |
| The private-input commitment's exact pre-image (the concatenated, domain-separated bytes before hashing) | Only the resulting hash is PUBLIC_REPORT; the pre-image itself never leaves, §5 |
| Any secret value retrieved via `runtime.getSecret()` | The value itself; its *name* (e.g. `QUOTE_CREDENTIAL`) is not secret and may appear in configuration exactly as this repository's existing `secret-names.yaml` already does for a different workflow |

### 3.3 PUBLIC_REPORT — `CONFIDENTIAL-COMMERCE.md` §5's schema, restated with the label

`decision`, `merchant`, `payer`, `settlementAsset`, `maxInput`, `minOutput`, `marketId`, `chainId`,
`orderNonce`, `expiry`, `policyVersionHash`, `privateInputCommitment`, `workflowIdentity`,
`reasonCode`. Every one of these is closed-schema and fixed-shape (present on both APPROVE and
REFUSE) per the parent document's own rule.

### 3.4 ONCHAIN_STATE — only downstream of an actual `createOrder`, never automatic

| Field (source) | Becomes |
|---|---|
| `merchant` (§3.3) | `Order.recipient` |
| `payer` (§3.3) | `Order.boundPayer` |
| `maxInput` (§3.3), if the creator uses it unchanged | `Order.amountIn` |
| `minOutput` (§3.3), if the creator uses it unchanged | `Order.minOut` |
| `expiry` (§3.3), if no stricter value is chosen | `Order.deadline` |

**Not automatic, and not the same value by construction:** `orderNonce` (§3.3) is not
`Order`'s on-chain identity. `orderId` is derived on chain from `(chainId, executor, creator, salt)`
(`SPEC-CONTRACTS.md`), and `salt` is the creator's own choice, not a field this workflow emits.
`CONFIDENTIAL-COMMERCE.md` §12 records this gap as an open question rather than assuming a mapping
that has not been designed.

### 3.5 GRAPH_INDEXED — only once ONCHAIN_STATE exists

Per `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` (T2), once an `Order` and, later, a paired
`Settlement` exist: `Order.recipient`, `Order.boundPayer`, `Order.amountIn`, `Order.minOut`,
`Order.deadline` (T2 §4.14); `Settlement`/`HookReceipt`/`ExecutorReceipt`'s amounts and currencies
(T2 §4.15–4.17); the `Merchant`/`Payer` address rollups (T2 §4.12–4.13, which that document's own
words state answer "which addresses have received UNICA payments," never "who owns this address").
**None of this workflow's own fields — `decision`, `reasonCode`, `policyVersionHash`,
`privateInputCommitment`, `workflowIdentity`, `orderNonce` — is indexed by any subgraph
`SETTLEMENT-SCHEMA.md` designs**, because none of them corresponds to a v4 event. If a future,
separate contract ever emitted an admission decision as an event, an indexer could in principle
capture the PUBLIC_REPORT fields (never the private inputs, by construction) — recorded here as a
hypothetical this document does not propose building.

### 3.6 UI_ONLY — presentational, never authoritative

| Field | Note |
|---|---|
| A human-readable label mapped from `reasonCode` | Mirrors `SPEC-ORACLE-AND-CHAINS.md` §6's `oracleCondition()` display-only pattern (T3) — computed for a screen, never checked by a contract |
| The merchant's resolved display name at checkout | An already-separate design in the sibling ENS stream; not this workflow's field, cited only for completeness |

### 3.7 FORBIDDEN — never appears anywhere, in any category, at any time

- The raw wholesale cost or margin floor value, in cleartext or via a weak or reused commitment, in
  any exported field (§3.3), log, or error message.
- The vendor/quote-source credential *value* (as distinct from its name) — the existing repository
  rule (`secret-names.yaml`'s own comment: "NAMES ONLY — no value appears in this file") extended
  here without modification.
- Customer PII (name, email, physical address) in any exported field, log, or commitment pre-image,
  unless combined with a domain-separated, high-entropy, never-disclosed per-subject salt — a bare
  hash of PII drawn from a known or guessable population is a preimage attack, worked in general
  form in §5.
- A typed settlement price, per `CONFIDENTIAL-COMMERCE.md` §7 item 1, restated here for the field
  catalogue's completeness.
- A schema shape that varies by branch (an optional field present only on APPROVE, or a
  variable-length reason string) where a fixed-shape encoding was feasible instead — see §4.6.

## 4. Leakage analysis by vector

### 4.1 Commitment reuse

Reusing the same salt, or a merchant-static (never-refreshed) salt, across multiple invoices lets
an observer who obtains or guesses one invoice's true inputs recompute every other commitment that
salt was used for and test candidate values against them — turning a single leak into a
correlation tool across a merchant's entire order history. §5 states the fix (a fresh, high-entropy
salt per commitment, never reused) and works the arithmetic that shows why reuse specifically
matters when the underlying value space is small.

### 4.2 Amounts — the ceiling the chain itself imposes, independent of Chainlink

The most important finding in this document. UNICA v4's oracle band computes and the executor's
receipt exposes `deviationBps` publicly, and `policy.mjs`'s own comment states why, for the
existing (different) workflow's public result: "included because a deviation figure is derivable
from two public quotes anyway, so hiding it buys nothing" (T1). The same arithmetic applies here by
construction: once a settlement happens, its delivered `amountOut` and the market's own public
reference price (`SPEC-ORACLE-AND-CHAINS.md` §4.1–4.2, T3) are both on chain. **Any discount,
however it was computed, is the arithmetic difference between those two public numbers.** A
confidential workflow can hide the *computation* — the discount rule, the eligibility check, the
margin floor that bounded it — but it cannot hide the *result* once an approved order settles on a
public chain against a public reference price. `maxInput`/`minOutput` framed as a ceiling rather
than an exact figure (`CONFIDENTIAL-COMMERCE.md` §5) narrows what is knowable *before* settlement,
never what becomes knowable *after* it.

### 4.3 Timing

Two distinct timing channels: (a) off-chain correlation — the interval between a private-state
change (an inventory decrement, a fraud-rule update) and the resulting on-chain order creation can
let an observer who watches both systems correlate which private event caused which public
transaction, even without seeing either payload directly; (b) workflow-execution latency — if a
policy branch that calls an external API (§4.8) takes measurably longer than a branch that rejects
before any call, and that latency is visible to whoever is waiting on the decision (a checkout UI's
own spinner, for instance), the elapsed time alone can disclose which branch executed. Chainlink's
own side-channel caveat (C1: "certain advanced vulnerabilities including side channel and
speculative execution attacks, may leak information") is stated generally, not about this
specifically, and is cited here as the general warning this vector is one concrete instance of.

### 4.4 Reason codes

A finer-grained reason taxonomy leaks more. `REJECT_INVENTORY` versus `REJECT_FRAUD` versus
`REJECT_ELIGIBILITY`, applied to one specific customer's one specific attempted order, tells an
observer which private branch fired for that customer — for a fraud or eligibility rejection in
particular, that is closer to a customer-specific accusation than a generic decline. The chosen
mitigation, stated once here and assumed by `CONFIDENTIAL-COMMERCE.md` §5: keep `reasonCode` to the
coarsest bucket that still lets a payer understand *that* their order cannot proceed, without
naming *which* private policy branch declined it — a single `POLICY_DECLINE` bucket, for instance,
rather than a taxonomy that mirrors the merchant's internal rule set one-to-one. On REFUSE, the
`reasonCode` and `privateInputCommitment` (§3.3) are the *only* two fields this decision ever
produces from private data — no order follows, so no later public settlement can ever add
context — which is exactly why this vector deserves the tightest scrutiny on the REFUSE path
specifically, more than on APPROVE (§4.2 already shows APPROVE's numbers become public anyway).

### 4.5 Gas

Not applicable to this design as specified: `CONFIDENTIAL-COMMERCE.md` §3 states the workflow's
output is not itself delivered on chain, so no gas cost, gas price, or transaction-revert pattern
exists to observe today. Flagged here as a vector that would need independent re-analysis if a
future revision ever proposed on-chain delivery (`CONFIDENTIAL-COMMERCE.md` §12's open question) —
a branch that does structurally more work on chain than another is a classic side channel wherever
gas is metered and visible, which it always is.

### 4.6 Report size

If the encoded result varies in byte size by branch (an optional field, a variable-length reason
string), an observer who can measure only the size of an encrypted or opaque payload — never
decoding it — can still distinguish branches. `CONFIDENTIAL-COMMERCE.md` §5's own rule (every field
present on both APPROVE and REFUSE, `additionalProperties: false`) is the mitigation, and §3.7's
FORBIDDEN row states the general schema-design principle this specific vector is one instance of:
fixed field count, fixed-width types, no optional presence keyed to which branch ran.

### 4.7 Logs

Chainlink's own documentation states plainly, for production Confidential Workflows generally, not
specifically for this design: "Logging within enclave execution logic should be avoided in
production workflows" because "anything you log from inside a Confidential Workflow handler could
leak data the enclave is meant to protect" (C1). This repository already has a tested discipline
for exactly this failure mode, built for a different workflow: `tests/confidentiality.test.mjs`
(T1) checks the public result, thrown error message and stack, an error raised after secret access,
a malformed private field, every rejection path, and constructed calldata, with two controls proving
the check itself fires (a planted canary is caught; a context including the private policy does
leak, which is why policy is never put in one context object, T1). **This document requires the
same test surface, unchanged in kind, be built for this design's own handler before it is ever
simulated** — not a new discipline, an extension of one already proven to catch what it claims to
catch.

### 4.8 HTTP requests

Per C3 (`CONFIDENTIAL-COMMERCE.md` §6 quotes this in full): the Workflow DON reaches quorum on
request *parameters* — destination URL, method, which fields are templated — before the one
confidential call executes; only the *values* substituted for `{{.key}}` placeholders are hidden.
**Which vendor a merchant's policy calls, how often, and in what shape is therefore visible to
ordinary Workflow DON nodes, never confidential, regardless of how well the response and credential
are protected.** For a merchant whose vendor relationship is itself sensitive (which inventory
system, which fraud-scoring provider), this is a real, structural leak this design cannot close
with the confidential variant of the HTTP capability alone — a distinct concern from response-body
confidentiality, and stated separately here so it is not mistaken for the same protection.

### 4.9 Vault access

`runtime.getSecret({id})` (C2) retrieves a value from the Vault DON, a distinct actor from the
Workflow DON (`CONFIDENTIAL-COMMERCE.md` §6). Whether the *pattern* of which secret ids are
requested, and how often, is itself observable by anyone outside the enclave — and would therefore
leak which policy branch ran even without learning any secret's value — is **not stated one way or
the other** in C1–C3 as fetched for this document. Labelled **UNKNOWN**, not assumed safe: a design
that calls a different named secret depending on which policy branch is active should be treated as
a candidate leak until Chainlink's own Vault DON access-pattern documentation is read and either
confirms or denies observability of the request pattern itself.

### 4.10 Retry behavior

Reasoned from general principle, not sourced to a specific Chainlink statement: if a workflow (or
an off-chain client polling for its completion) retries differently depending on which private
branch ran — for instance, only the branch that calls a slow external inventory API ever needs a
retry — the retry count or backoff pattern is a variant of the timing vector (§4.3), observable by
anyone who can see call attempts rather than only final results. Labelled **PROPOSED** risk,
consistent with §4.3 rather than independently sourced.

### 4.11 ENS names

`docs/unica-v5/ens/THREAT-MODEL.md` (T4, a sibling stream, cited not edited) already names two
headings directly on point — "3.22 Receipt-name spoofing" and "3.28 Privacy leakage from staff and
receipt names" — but as read on 2026-09-11 that document is a section skeleton with no body text
under either heading yet. This document cites the headings' existence honestly, as a named,
unresolved, cross-cutting concern that stream owns, and asserts nothing about their content, per
the instruction that an unread or not-yet-written source is never inferred from.

### 4.12 Indexed entities

Restated from §3.5 because it is a leakage vector, not only a classification fact: **the
confidentiality boundary this design builds exists only up to the moment `createOrder` executes.**
Everything ONCHAIN_STATE in §3.4 becomes GRAPH_INDEXED (T2) the instant a matching `Settlement` is
indexed — permanently, publicly, and queryable by anyone, with no participation from this workflow
at all. A design review that only checks "does the workflow itself leak" and stops there would miss
this; the leakage surface for anything the workflow approves and a creator acts on is the entire
downstream v4 settlement-evidence graph, not the workflow's own output.

### 4.13 Error messages

`tests/confidentiality.test.mjs`'s existing surface list (T1) already includes "thrown error
message and stack" and "error raised after secret access" as tested public/persistent surfaces for
a different workflow, with both passing today (T1: "0 of 5 canaries appeared anywhere in the
simulator's output" for the analogous check on that workflow). This document requires the identical
discipline for any handler built from this design: an error thrown after a private value has been
read into scope must never let that value reach an outward-facing message or stack trace, and the
test that proves it must plant a real canary and watch it fail to appear, not assert the absence
without ever having tried to make it appear (§4.7's same requirement, restated for this specific
surface).

## 5. Commitment construction, and why a low-entropy value needs more than a hash

`privateInputCommitment` and `policyVersionHash` (`CONFIDENTIAL-COMMERCE.md` §5) must be salted and
domain-separated. Both requirements, and why each is load-bearing, stated in order:

**Domain separation.** The pre-image must encode, unambiguously, what kind of thing is being
committed to and which version of the schema produced it — a fixed-order, fixed-width, or
length-prefixed encoding of `(tag, schemaVersion, field values...)`, never a naive
delimiter-joined string, because a delimiter that can also appear inside a value lets two different
inputs produce the same pre-image bytes. This is the same hygiene an EIP-712 domain separator and
type string already provide elsewhere in this repository's own designs (`SECURITY-ADVISORY-001.md`'s
fix binds a full quote digest into a typed-data witness for exactly this reason). Without it, a
commitment computed for one purpose (say, an invoice-amount commitment) could collide with, or be
mistaken for, a commitment computed for another (a policy-version commitment) if their raw byte
encodings ever overlapped.

**A worked negative example already in this repository, cited so a future implementer does not
repeat it.** `integrations/chainlink-cre-robinhood/policy.mjs`'s `policyCommitment()` (T1) uses
FNV-1a, and its own comment states exactly why that is fine *there* and would not be fine *here*:
"a plain digest of the private values, so an observer who already knows a candidate policy can
confirm it and an observer who does not learns nothing beyond its length... IT IS NOT AN ATTESTATION
and proves nothing about where the code ran." That function was built as a stable comparison tag
for a policy object whose fields (`maxDeviationBps`, `maxQuoteAgeSeconds`, `minMerchantOut`,
`preferredVenue`, `supportedChainIds`) are not the kind of low-entropy, individually-guessable
secret an invoice line item or a customer eligibility flag is. **Reusing that same function, or that
same design choice (a fast, non-cryptographic, unsalted hash) for `privateInputCommitment` here
would be a mistake this document flags explicitly, not a pattern to copy.**

**The arithmetic, worked plainly, for a small invoice-amount space.** Suppose an invoice total is an
integer number of cents in the ordinary retail range, $0.01 to $999.99 — 99,999 possible values.
Suppose further, for the worst case, that the salt used in the commitment's pre-image is fixed or
guessable (a constant domain-separator string, reused across every invoice, rather than a fresh
secret value). An attacker who wants to learn the true amount behind a published commitment need
only compute the commitment function once for each of the 99,999 candidate amounts and compare each
result against the observed value — a brute-force search over a space this small completes in a
negligible amount of time on any ordinary computer, a property that holds for essentially any
standard hash function's evaluation speed and needs no specific benchmark citation to be true: a
space of $10^5$ candidates is not a meaningful obstacle to any search method whose single evaluation
completes in microseconds, which every commonly used cryptographic hash does in software. **A hash
alone — however cryptographically strong the hash function itself is — does not hide a low-entropy
value.** The strength of the hash function is irrelevant to this attack; the attack never inverts
the hash, it only re-derives it forward for every plausible input and checks for a match, which is
exactly as fast as computing the hash 99,999 times.

**Generalizing, and the fix.** For a private value drawn from a space of size $N$, a commitment
`H(salt‖value)` is only as strong as a brute-force search over $N$ candidates when `salt` is public,
fixed, or otherwise guessable — regardless of which hash function `H` is. Two independent ways to
close this, either sufficient alone: (a) make $N$ itself astronomically large, which is not
available for a bounded, real-world quantity like a retail invoice amount; or (b) make `salt` a
freshly drawn, uniformly random value of at least 128 bits, generated once per commitment (never
reused across invoices, per §4.1), and never disclosed anywhere the commitment itself is disclosed
— which raises the effective search space to the size of the salt's own entropy, independent of how
small the underlying value's space is. **This design adopts (b)**: a fresh, undisclosed,
per-decision salt, domain-separated per the paragraph above, for both `privateInputCommitment` and
`policyVersionHash`. The same reasoning applies, with the same fix, to any PII field a future
revision might ever need to commit to (§3.7): an email address or a name drawn from a known or
guessable population is exactly the same shape of low-entropy value as a bounded invoice amount,
and needs exactly the same per-subject, undisclosed, high-entropy salt to resist the identical
brute-force search.

**What the commitment is actually good for, once salted correctly.** Not amount-hiding against a
generic observer forever — §4.2 already shows the *approved* amount becomes public anyway once an
order settles. Its real, narrower value is **audit binding for the REFUSE path and for dispute
resolution on the APPROVE path**: a party later given the true private inputs (a merchant proving
to an auditor, or a payer disputing a decline) can recompute the commitment from the disclosed
salt and inputs and confirm it matches what was published, while a party never given them learns
nothing from the commitment alone. That is the property a correctly salted commitment provides; a
weak or unsalted one, as the arithmetic above shows, provides none of it.

## 6. What this analysis does not establish

- Whether Vault DON secret-access patterns are independently observable outside the enclave
  (§4.9) — UNKNOWN, not resolved by any source read for this document.
- Whether retry or backoff behavior for this specific design's likely branches would be
  distinguishable in practice, as opposed to in principle (§4.10) — PROPOSED risk only, no
  measurement exists because no workflow has been built.
- The content of `docs/unica-v5/ens/THREAT-MODEL.md` §3.22 and §3.28 (§4.11) — not yet written as
  of this retrieval; nothing here assumes what it will conclude.
- Whether a future on-chain delivery of this workflow's output (explicitly not proposed,
  `CONFIDENTIAL-COMMERCE.md` §3, §12) would reopen the gas (§4.5) and report-size (§4.6) vectors in
  a form this document's off-chain-only analysis does not cover — flagged, not analysed, because
  the design it would apply to does not exist.
- Whether $10^5$ is the right order of magnitude for every invoice this design would ever see —
  used in §5 as an illustrative, conservative retail range; a merchant with a wider price range, or
  with quantities or SKU identifiers that are individually low-entropy in the same way, needs the
  identical arithmetic re-run against its own actual value space before trusting any specific salt
  length as sufficient.
- Whether the coarse `reasonCode` bucketing recommended in §4.4 is coarse enough for every policy
  a real merchant would configure, or whether some merchant's policy has so few live branches that
  even `APPROVE`/`REFUSE` plus a single-bucket `POLICY_DECLINE` still narrows the private branch
  meaningfully — an open, per-merchant question this document states rather than resolves.

## 7. Sources referenced

- https://docs.chain.link/cre/concepts/confidential-workflows
- https://docs.chain.link/cre-templates/hello-confidential-workflows
- https://docs.chain.link/cre/capabilities/confidential-http-ts
- `docs/unica-v5/chainlink/CONFIDENTIAL-COMMERCE.md` (this repository, companion document)
- `docs/v2/SECURITY-ADVISORY-001.md` (this repository)
- `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (this repository)
- `docs/unica-v4/SPEC-CONTRACTS.md` (this repository)
- `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` (this repository, sibling stream, cited not edited)
- `docs/unica-v5/ens/THREAT-MODEL.md` (this repository, sibling stream, cited by heading only, not edited)
- `integrations/chainlink-cre-robinhood/policy.mjs`, `secret-names.yaml`, `tests/confidentiality.test.mjs` (this repository)
