# UNICA v5 / Chainlink — confidential commerce: an optional order-admission thesis

Design record, uncommitted, held for owner review. Nothing here deploys, enrolls, signs, or
broadcasts anything. No Confidential Workflow exists for this design, no Private Registry action
has been taken, no hosted CRE chain capability has been used, and no account or credential was
created to produce this document. Every claim about UNICA v4 is read from its own merged
specification and is never restated as if it changed there; this document proposes an **optional**
layer that sits before order creation and touches no v4 contract, no v4 interface, and no v4 event.

**Track.** This is UNICA's from-scratch entry (owner ruling, 2026-09-11). No sponsor-channel
transcript was supplied for this stream; nothing below is attributed to a peer discussion or a
named peer project. Every technical claim about a Chainlink product is either cited to a source in
§1 or labelled PROPOSED / UNKNOWN. The important lead named in the brief that produced this
document — that a CRE write can report success while the receiver-level result is false — is
treated below (§9) as an unverified claim to be checked against Chainlink's own documentation, not
repeated as established fact; §9 states exactly what the documentation does and does not say about
it.

## 0. What this document evaluates, and what it does not

**In scope.** Whether a Chainlink CRE Confidential Workflow that evaluates private invoice and
merchant-policy inputs, and emits only a minimal public authorization for one exact payer-bound
order, is a design worth building — including the possibility that the honest answer is no, not
yet, or only for a narrower case than the one asked about. Where it is worth building, this
document states the output schema, the prohibitions that keep it from becoming a second source of
settlement truth, and where each prohibition is actually enforced.

**Not in scope.** Any change to `src/unica-v4/` (specified, not built — `SPEC-CONTRACTS.md` §1),
any change to `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md`'s oracle layer, any claim that Robinhood
Chain Testnet 46630 or any other chain has usable Chainlink pricing for this design (that is
`docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md`'s subject, cited here, never re-litigated),
Chainlink product selection for anything other than Confidential Workflows and the capabilities it
composes with (Confidential HTTP, the Vault DON), and any ETHGlobal prize-eligibility claim — that
belongs to a sibling stream's own document, never asserted here from discussion alone.

**Relationship to sibling streams.** `docs/unica-v5/graph/` and `docs/unica-v5/ens/` are being
written concurrently by separate work and are cited here where their content bears on this design
(the indexed read layer in §7; the resolved-merchant-name checkout flow in `PRIVACY.md` §4); neither
is edited by this document.

## 1. Sources

Retrieval date is 2026-09-11 for every row unless stated otherwise. "Kind" is OFFICIAL (the org
that owns the product), TEAM (a statement or artifact already in this repository), or COMMUNITY
(third party — none used below).

| # | URL | Author / org | Kind | Used for | Conflict? |
|---|---|---|---|---|---|
| C1 | `docs.chain.link/cre/concepts/confidential-workflows` | Chainlink (smartcontractkit) | OFFICIAL | The TEE/enclave execution model, what is and is not protected, the attestation + DON-consensus completion rule, the private-beta/enrollment status, the "don't log in production" warning, side-channel caveat | none found |
| C2 | `docs.chain.link/cre-templates/hello-confidential-workflows` | Chainlink | OFFICIAL | `secretsNames`, `runtime.getSecret`, `cre.handlerInTee`, `runtime.usingTheDons`, the simulate command, the simulator's own TEE disclaimer | none found |
| C3 | `docs.chain.link/cre/capabilities/confidential-http-ts` | Chainlink | OFFICIAL | The Confidential HTTP capability: template-resolved request values, optional AES-GCM response encryption, and — the specific finding this document leans on — that the Workflow DON reaches quorum on the **request parameters**, not on response data, before the one confidential call is made | none found |
| C4 | `docs.chain.link/cre` | Chainlink | OFFICIAL | CRE's own framing (an orchestration layer over DONs), the BFT consensus description, and its own "as is" disclaimer of warranty over workflow correctness | none found |
| C5 | `docs.chain.link/cre/guides/operations/deploying-workflows.md` | Chainlink | OFFICIAL | "Workflow deployment requires approval" — already cited by `CHAINLINK-AVAILABILITY.md` §4b item 3; reused here rather than re-fetched with a different quote | none found |
| C6 | `docs.chain.link/cre/service-quotas.md` | Chainlink | OFFICIAL | The plain HTTP capability's per-execution quotas (5 requests, 100 KB response cap, 10 KB request cap, 10 s connection timeout) — already cited by `CHAINLINK-AVAILABILITY.md` §4b item 1; reused here for the same reason as C5 | none found |
| T1 | `integrations/chainlink-cre-robinhood/README.md`, `policy.mjs`, `schemas/*.json` (this repository) | UNICA / repository | TEAM | The existing "no contract trusts a workflow result" design rule; the `VERDICT`/`EVIDENCE` vocabulary this document reuses rather than re-inventing; the `additionalProperties: false` closed-schema pattern; the `policyCommitment()` function this document explicitly does **not** reuse as-is (§6, `PRIVACY.md` §5) | this document diverges from `policyCommitment()`'s hashing choice and says exactly where and why |
| T2 | `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (this repository) | UNICA / repository | TEAM | The permission matrix — Confidential Workflow deployment and CRE-hosted testnet access both "require enablement," neither obtained | none found |
| T3 | `docs/v2/SECURITY-ADVISORY-001.md` (this repository) | UNICA / repository | TEAM | The binding rule this design inherits (§8): an authorization that does not commit the counterparty's half of a deal lets whoever submits it redirect the payment | none found |
| T4 | `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (this repository) | UNICA / repository | TEAM | `MarketId` construction, the tighten-only oracle-policy pattern, `ChainlinkCREAdapter`'s `WORKFLOW_ID`/`WORKFLOW_OWNER` fields as existing prior art for representing a CRE workflow's identity on chain, and the boundary this document must not cross (§3) | none found |
| T5 | `docs/unica-v4/SPEC-CONTRACTS.md` (this repository) | UNICA / repository | TEAM | Order lifecycle: `createOrder` (allowlisted creator, ACTIVE market only), `pay` (`WrongPayer`), immutable-at-creation order fields, `orderId` derivation from `(chainId, executor, creator, salt)` | none found |
| T6 | `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (this repository) | UNICA / repository | TEAM | CRE's forwarder/`IReceiver` shape on 46630, and the specific unresolved-trust finding restated in §9 | none found |

C1–C4 were fetched directly for this document on 2026-09-11; C5 and C6 restate quotes
`CHAINLINK-AVAILABILITY.md` already fetched and cites independently, not re-fetched here to avoid a
second, possibly divergent, quotation of the same sentence.

## 2. The thesis, stated precisely

**PROPOSED.** Nothing below is built, simulated, or scaffolded (§6); this section states a design,
not an observation.

A Confidential Workflow evaluates private invoice and merchant-policy inputs that no on-chain
contract, indexer, or observer should ever see, and produces one output: a minimal,
replay-resistant authorization that a specific, already-configured UNICA v4 market may (APPROVE) or
may not (REFUSE) proceed to create one exact, payer-bound order. The workflow decides whether an
order is *worth creating*. It never decides, and cannot be made to decide, whether a payment *is
valid on chain* — that remains the hook's and the executor's job alone, exactly as
`integrations/chainlink-cre-robinhood/README.md` already states for its own, narrower use of CRE
(T1): "CRE may decide whether to attempt a payment. Only the hook and executor decide whether a
payment is valid on chain." This document extends that same rule one step earlier in the pipeline,
to order *creation* rather than order *settlement*, and does not weaken it anywhere.

## 3. Where this sits relative to UNICA v4 — the admission-layer boundary

UNICA v4's order lifecycle (T5): an allowlisted creator calls `createOrder` on an ACTIVE market,
naming a bound payer, `amountIn`, `minOut`, and a `deadline`; the payer alone can later call `pay`
(`WrongPayer` otherwise); the hook enforces the oracle band before any swap completes
(`SPEC-ORACLE-AND-CHAINS.md` §4). Nothing about that lifecycle changes here. The workflow this
document designs sits **before** the creator's `createOrder` call, as one input the creator (a
human operator, a checkout script, or an automated order-creation service — the identity of the
creator is unchanged and is not a contract this document touches) may choose to require before it
calls `createOrder` at all.

Concretely: the workflow's APPROVE verdict, `amountIn`-shaped bound, and `minOut`-shaped bound are
candidate values the creator may then pass into `createOrder` unchanged. A REFUSE verdict is a
signal the creator should not call `createOrder` with those terms. Neither verdict is read by any
contract. `createOrder`'s own checks (ACTIVE market, allowlisted creator) run exactly as specified
whether or not this workflow exists, ran, or agreed. This is the same non-negotiable posture
`docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` §8 states as a general rule for any oracle
adapter and that this document treats as binding for an admission layer too: **an unconfigured or
unauthorized value must be a hard, typed revert on chain — never a placeholder a workflow's opinion
quietly stands in for.**

**What this document does not propose**, stated plainly rather than left to be assumed: an on-chain
gate that makes `createOrder` itself check a CRE report (via `IReceiver.onReport`, the mechanism
`ChainlinkCREAdapter` already specifies for oracle prices, T4 §9). Building that would require the
same rigor `SECURITY-ADVISORY-001.md` demands of any binding authorization (§8) and is a distinct,
larger design this document does not attempt — see the open seam recorded in §12.

## 4. Candidate private inputs

Every one of these is classified field-by-field, with its leakage exposure, in
`docs/unica-v5/chainlink/PRIVACY.md` §3. Listed here only to fix the scope of "private" this
document's prohibitions (§7) are written against:

invoice line items · SKU inventory · wholesale cost and margin floor · discount rules · customer
eligibility · fraud and velocity signals · private API data (a vendor inventory, pricing, or
fraud-scoring endpoint) · tax and shipping inputs · inventory exposure limits · merchant risk
policy.

None of these has a field anywhere in the public output below (§5). If a future revision of this
design ever needs to add one, that is a schema change made in the open, the same discipline
`schemas/workflow-result.public.json`'s `additionalProperties: false` already enforces for the
existing oracle-orchestration workflow (T1): a private field never arrives by accident.

## 5. Permitted public output

**PROPOSED**, in full — every field below is a design choice, not an observed or implemented
schema. The only thing that may cross the enclave boundary — Chainlink's own `runtime.usingTheDons()` (C2)
is the one-way call that does this, and "only data needing consensus should pass through here"
according to that page. Everything below is closed-schema (`additionalProperties: false`,
following T1's pattern) and fixed-shape: every field is present on both APPROVE and REFUSE, so an
observer who can measure only the *size* of the result learns nothing a fixed-shape encoding didn't
already make impossible to hide (`PRIVACY.md` §4 works this leakage vector in detail).

| Field | Type (illustrative) | What it is | Never |
|---|---|---|---|
| `decision` | enum `APPROVE \| REFUSE` | The one thing this workflow decides | a settlement outcome, a price, or a signal that funds moved |
| `merchant` | address | The order's intended recipient, already a configured value the creator holds — the workflow does not choose it | an address the workflow selects freely |
| `payer` | address | The order's intended bound payer | — |
| `settlementAsset` | address | The payout token already configured for the target market (T4's `payout`) | a new or arbitrary token |
| `maxInput` | uint | A ceiling on `amountIn`, never the workflow's own computed "exact" internal price (§7 explains why "maximum," not "exact," is the recommended shape) | a typed settlement price |
| `minOutput` | uint | The floor the creator should pass as `minOut` | a number the hook or executor is required to trust instead of computing its own band (T4 §4) |
| `marketId` | bytes32 | The exact, already-registered `marketId` (T4 §2: chain id, registry, asset, payout, version, and the oracle route are all committed inside this one value) this authorization is for | a new market, a new route, or a market the workflow proposes itself |
| `chainId` | uint | Restated explicitly, even though it is also committed inside `marketId`, because a human or a script reading this result off-chain should never have to decode a hash to find it | — |
| `orderNonce` | bytes32 | A value this workflow names for its own replay resistance — **not** assumed to be, and not automatically, the executor's own `salt` parameter that derives `orderId` on chain (T5); the seam between the two is an open question, §12 | a substitute for the on-chain `orderId` |
| `expiry` | uint64 | A deadline after which this authorization itself is stale, independent of and no looser than whatever `deadline` the resulting order would carry | an unbounded or open-ended authorization |
| `policyVersionHash` | bytes32 (hash) | A commitment to which version of the merchant's policy produced this decision, for audit, never for enforcement | proof the policy was fair, legal, or bug-free |
| `privateInputCommitment` | bytes32 (hash) | A domain-separated, salted commitment to the private inputs this decision was computed from (`PRIVACY.md` §5 works the construction and its failure modes) | a reversible encoding of those inputs |
| `workflowIdentity` | struct `{id, owner, version}` | Which workflow, whose, and which version — the same shape `ChainlinkCREAdapter` already pins for oracle reports (T4 §9: `WORKFLOW_ID`, `WORKFLOW_OWNER`) | an identity the workflow asserts about itself unverified — this is exactly the field Chainlink's own attestation model exists to make meaningful (§6) |
| `reasonCode` | enum, coarse | A minimal-leakage bucket, never a free-text message (`PRIVACY.md` §4 on reason-code granularity as a leakage vector) | a string that names which private branch ran |

This deliberately mirrors `docs/v2/SECURITY-ADVISORY-001.md`'s own binding list almost field for
field — payer, merchant, asset, amount, chain, a verifying-contract-equivalent, an order/nonce
identity, and expiry (§8 makes the correspondence explicit) — because that is the list a design in
this family has already been shown, once, to fail by omitting from.

## 6. The mechanism, in Chainlink's own terms

**VERIFIED** against C1–C4, retrieved 2026-09-11 (§1) — every claim below is quoted or closely
restated from those sources, never asserted as this repository's own behavior, and every sentence
that could otherwise read as a claim that this repository has a live or verified Confidential
Workflow instead states plainly that it does not.

- **The enclave.** A Confidential Workflow's handler runs inside a hardware-isolated Trusted
  Execution Environment rather than on ordinary Workflow DON nodes (C1). `cre.handlerInTee`
  registers such a handler with explicit constraints — as of C1's retrieval, "AWS Nitro in
  us-west-2 is the only available option," a single-region dependency worth naming plainly rather
  than assumed away (§12).
- **Secrets.** `runtime.getSecret({id})` (C2) retrieves a value "released by the Vault DON and
  decrypted only within the attested enclave — never exposed to regular DON nodes" (C1, C2). The
  Vault DON is a distinct actor from the Workflow DON nodes that route triggers and coordinate
  ordinary (non-confidential) capability calls (C1). No credential this design would need — a
  vendor inventory or fraud-scoring API's own credential, for instance — is ever read by this
  workflow outside that path.
- **What crosses the boundary and what does not.** C1, verbatim on the two sides of the line:
  protected by default are "secrets released by the Vault DON," "sensitive inputs and intermediate
  values you don't explicitly share outside," and "capability calls made from inside the enclave";
  **not** automatically protected are "your workflow's source code, deployed binary, and
  orchestration metadata," and "reports, transaction calldata, and any output you deliver outside
  the enclave boundary." `runtime.usingTheDons()` (C2) is the one documented crossing point, and its
  own guidance — "only data needing consensus should pass through here" — is exactly why §5's
  output list is kept as short as it is.
- **Attestation, not a business-logic guarantee.** "Confidential workflows successfully complete
  execution only after DON consensus verifies attestations from the enclave, proving the integrity
  of the workflow logic that executed within it" (C1). Read precisely: attestation proves *which
  code ran*, inside *which enclave type*, not that the private inputs fed to that code were true,
  current, or honestly supplied. A merchant's own inventory API can misreport stock and the enclave
  will faithfully compute over the lie — attestation cannot and does not claim otherwise. This is
  the single most important limit on the thesis, and §10 returns to it.
- **Confidential HTTP, and a finding worth stating precisely because it bounds what "confidential"
  covers.** Per C3: request-body values referenced as `{{.key}}` placeholders are "resolved inside
  the enclave, so sensitive values are designed not to appear in workflow memory" outside it, and a
  response may optionally be AES-GCM encrypted before it leaves the enclave. But the Workflow DON
  reaches "quorum on the request parameters (forwarded by each Workflow DON node) rather than on
  response data" (C3) — meaning the request's shape (destination URL, method, header *names*, which
  values are templated) is visible to, and agreed by, every ordinary Workflow DON node as a
  precondition for making the one confidential call. Only the *substituted values* behind `{{.key}}`
  are hidden, never the fact that a call to a specific vendor endpoint was made. `PRIVACY.md` §4
  treats this as a distinct leakage vector (which vendor, which endpoint, at what cadence).
- **Not deployable today, for this or any UNICA integration.** "Confidential Workflows is in
  private beta and requires enrollment through your Chainlink account team" (C1); this repository's
  own record of that state, obtained independently through the CRE CLI and simulator rather than
  read off the docs page alone, is T2's permission matrix: Confidential Workflow deployment and
  CRE-hosted testnet access both read "requires enablement," neither has been obtained, and nothing
  in this design changes that. **No Confidential Workflow for this design has been simulated,
  deployed, or even scaffolded** — this document is a specification, one level more abstract than
  T2's own simulator record for the existing oracle-orchestration workflow.
- **No warranty over correctness.** CRE's own terms state it "is provided on an 'as is' basis
  without any representations, warranties, covenants, or conditions of any kind" (C4) — a general
  disclaimer, not specific to this design, but a reason this document treats every CRE-produced
  value as advisory rather than authoritative by default, consistent with T1's existing rule.

## 7. Prohibitions as design constraints, and where each is enforced

Every prohibition below is a design constraint on this admission layer alone — none of them is a
new check inside `src/unica-v4/`, which this document does not touch.

1. **The workflow supplies no typed settlement price.** §5's schema has no `price` field, only
   `maxInput` and `minOutput` — bounds, never a rate. The number that actually prices the trade
   still comes from the pool and, where a market's `OraclePolicy.enabled` is true, from
   `IUnicaPriceOracle.latestPrice` inside the hook's own `afterSwap` check (T4 §4) — a call this
   workflow never makes, is never given the address of, and could not satisfy even if it tried,
   since `IUnicaPriceOracle` is a `view` interface the hook calls by `STATICCALL` from inside the
   pool's own transaction (T4 §2), a call this off-chain workflow structurally cannot be inside.
2. **It never replaces the authenticated oracle.** `ChainlinkCREAdapter` (T4 §9) is a wholly
   separate, oracle-only construct — simulation-only today, and, per T4 §9's own statement,
   "not deployable" for any UNICA v4 market regardless of this design. This admission workflow does
   not implement `IUnicaPriceOracle` or `IUnicaOracleRoute` (T4 §2), is never registered as a
   market's `policy.adapter`, and never appears anywhere in the hook's order-of-checks (T4 §4.1).
   Confusing the two — an oracle adapter and an order-admission workflow — would be exactly the
   category error this section exists to foreclose, so it is stated once, here, rather than left to
   be inferred: **they are unrelated Chainlink usages, one is a price route bound into a market's
   immutable identity, the other is an off-chain, advisory, pre-`createOrder` opinion, and neither
   substitutes for the other under any circumstance.**
3. **It selects no arbitrary contract or payout address.** `merchant`, `payer`, and
   `settlementAsset` in §5 are read from configuration the creator already holds — the market's
   registered payout token, and the specific merchant/payer pair this one invoice names — never
   proposed by the workflow itself. The workflow evaluates against inputs it is given; nothing in
   its interface lets it name a new address, and no field in §5 is typed to carry one that was not
   already load-bearing before the workflow ran.
4. **It changes no existing order.** At decision time no order exists yet — this workflow runs
   strictly before `createOrder` (§3) — so there is no `Order` struct anywhere for it to touch, and
   even if one already existed for an unrelated invoice, `Order`'s immutable-at-creation fields
   (T5: `recipient`, `creator`, `boundPayer`, `amountIn`, `minOut`, `deadline`) have no setter this
   workflow, or any off-chain actor, could call.
5. **It marks nothing settled.** `Order.settled` is written only inside the executor's `pay`, on a
   successful `Settled` emission (T5); `PRIVACY.md`'s field catalogue (§3) reuses the existing
   `PRODUCIBLE_EVIDENCE` discipline (T1: `mock`, `simulated` producible; `confirmed` reserved and
   never producible by a workflow function) as a matter of extending, not inventing, the vocabulary
   this repository already tests for. Nothing in §5's schema has a `confirmed` or `settled` field at
   all.
6. **Its output is never evidence that funds moved.** The only evidence that funds moved, anywhere
   in this repository's v4 design, is a mined transaction holding a `Settled` event from the
   market's own registered executor (T5's pattern, named "Evidence, not success" in
   `docs/unica-v4/EVENT-SCHEMA.md` §5 for the hook's receipt alone, and restated identically by the
   sibling read layer's own design, `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` §4.15: only the
   paired executor event is the actual success signal). §5's output has no transaction
   hash, no block number, and is not itself submitted on chain in this design (§3) — an
   `APPROVE` cannot be shown to anyone, including a payer, as proof a payment happened, because it
   necessarily predates the payment by construction.

## 8. The binding rule this design inherits from Advisory 001

`docs/v2/SECURITY-ADVISORY-001.md` (T3) found a release where a payer's signed authorization did
not commit the merchant's half of the deal — recipient, output token, amount, pool, deadline — and
that gap let whoever submitted the transaction redirect the entire payment to themselves, because
"the payer's signature and the merchant's signature intersect in only five values... none of which
identifies the merchant." The lesson generalizes past that one contract: **any authorization meant
to bind a payment must name payer, merchant, asset, amount, chain, a verifying-contract-equivalent,
an order or nonce identity, and an expiry, all inside the one value that gets checked — naming only
some of them is not a partial mitigation, it is the exact shape of the hole Advisory 001 found.**

§5's schema was built against that list on purpose: `payer`, `merchant`, `settlementAsset`,
`maxInput`/`minOutput`, `chainId`, `marketId` (which, per T4 §2, already commits the registry
address and the version — together the closest equivalent this design has to "a verifying
contract," since one `marketId` binds to exactly one immutable hook/executor pair, T5), `orderNonce`,
and `expiry`. **This design is advisory, not an authorization a contract checks (§3), so Advisory
001's defect class — a signature that is valid but under-specified — cannot recur here in the form
it took there: nothing in `src/unica-v4/` ever reads this workflow's output at all.** The binding
list is followed anyway, for two reasons stated plainly: first, so that if a future revision ever
does propose delivering this authorization on chain (§12, explicitly not proposed here), the schema
it would extend already carries the right fields rather than needing the gap rediscovered a second
time; second, so that the off-chain creator consuming this output today has enough named context to
avoid submitting `createOrder` with terms that silently drifted from what was actually approved.

## 9. What an APPROVE verdict does not prove — the unverified lead, checked

The brief that produced this document named, as an important unverified lead, the possibility that
"a CRE write can report success while the receiver-level result is false." Checked against C1–C4
and T6 rather than repeated from memory: no fetched Chainlink source makes a specific claim shaped
exactly that way about Confidential Workflows. What the sources do establish, and what supports
treating the lead as a reasonable generalization rather than a specific documented incident:

- CRE's own reports are DON-attested to the *code that produced them* (§6), never to the *truth of
  external facts that code was fed*. A confidentially-computed APPROVE over a lying inventory
  feed is not a false attestation — the attestation was honest about which code ran — but the
  business conclusion is still wrong. **An APPROVE therefore proves code integrity, never fact
  correctness**, and this document never states or implies otherwise anywhere in §5–§8.
- `CHAINLINK-AVAILABILITY.md` §4b (T6) already establishes the general shape of this gap for the
  CRE-to-chain delivery path this document does not use: "The receiver is responsible for
  discarding stale reports," quoting `IReceiver.sol` directly, and the forwarder's own DON
  timestamp "never reaches the receiver at all." A receiver contract that skipped its own staleness
  or replay check could accept an old or malformed report and be wrong regardless of whether the
  DON's delivery succeeded. This is architecturally the same lesson as the confidential-compute
  case above, one layer over: **a successful delivery, or a successful attestation, is never itself
  a correctness proof about what a consuming party then does with the delivered value** — the
  consuming logic must independently verify, every time, and this design's own consuming logic
  (the off-chain creator deciding whether to call `createOrder`) is told, explicitly, in §3 and §7,
  never to skip that.
- No source read for this document claims Confidential Workflows have ever produced an incorrect
  attestation, and none is claimed here. The lead is treated as a design discipline (never trust a
  workflow result without an independent check) rather than as evidence of a specific defect,
  because no defect was found or is asserted.

## 10. Evaluation on the merits — should this be built at all

**What a Confidential Workflow buys that a conventional, access-controlled merchant backend does
not.** A merchant who alone owns their wholesale cost, margin floor, and discount rules already gets
full confidentiality for those values by simply never publishing them — an ordinary private server
under the merchant's own control has that property for free, with none of the constraints below.
Chainlink's DON-attestation model adds something only when the party needing assurance is *not* the
merchant themselves: a platform mediating between merchants who do not trust each other, or who do
not want to trust a shared operator with everyone's numbers at once, could use attestation to get
"this decision was computed by the agreed policy code" without the operator (or any other merchant)
ever seeing any one merchant's inputs. That is a real, narrower case than "any merchant wants
privacy," and this design should be read as answering that narrower case, not the general one.

**What it costs, concretely, against what exists today.**

- **Not obtainable today.** Confidential Workflow deployment requires per-organization enrollment
  (C1) and this repository's own attempt to establish that access reads "requires enablement,"
  unresolved (T2). Nothing past a specification and a simulator run (T2's own, for a different,
  simpler workflow) is possible before that changes.
- **A real HTTP ceiling for a rich policy.** If merchant policy needs external data — a live
  inventory count, a fraud-scoring call, a tax-jurisdiction lookup — the plain HTTP capability's
  quotas (5 requests per execution, 100 KB response, 10 KB request, 10 s connection timeout, C6)
  bound how much of "invoice line items, SKU inventory, wholesale cost and margin floor, discount
  rules, customer eligibility, fraud and velocity signals, private API data, tax and shipping
  inputs, inventory exposure limits, merchant risk policy" (§4's full list) a single execution can
  actually gather and evaluate, whether or not the confidential variant of that capability is used.
  A policy needing more than a handful of external calls per decision does not fit this shape
  without redesign.
- **A structural ceiling attestation cannot lift.** §6 and §9 already establish this: confidential
  compute hides the computation, never the truth of what was fed into it. A platform relying on
  this design for fraud or eligibility decisions is still exposed to a merchant (or a compromised
  upstream vendor API) that lies to its own workflow.
- **A single-region dependency, as of this reading.** `cre.handlerInTee`'s only documented option
  (C2) is AWS Nitro in `us-west-2` — worth naming as an availability and centralization
  consideration for anything built to depend on it, not a reason on its own to reject the design,
  but not zero either.
- **A privacy ceiling the settlement layer itself imposes, independent of Chainlink.**
  `PRIVACY.md` §4 works this in full: because UNICA v4 settlement amounts and the reference price
  its oracle band checks against are both public once a settlement happens, the *effective*
  discount or margin on any approved order is recoverable from public chain data alone, regardless
  of how well this workflow hides its own computation. Confidentiality here protects the reasoning
  path, never the eventual public terms of an approved order.

**Recommendation (PROPOSED), stated as a verdict rather than left implicit.** Build this only for the narrower
case §10 opens with — a platform genuinely mediating between mutually non-trusting merchants, where
DON attestation buys something a private backend cannot. For a single merchant protecting their own
numbers from the public and from UNICA itself, a conventional access-controlled backend already
delivers the same confidentiality with none of the enrollment, HTTP-quota, single-region, or
"trusts its own inputs" costs above, and should be preferred until a concrete multi-merchant,
mutual-distrust scenario actually exists for UNICA. Where it is built, at any scale, it must remain
strictly advisory per §3 and §7 for as long as UNICA v4's contracts are the ones named in `T4`/`T5`
— an APPROVE never becomes a substitute for the hook's or executor's own checks, on this chain or
any other UNICA v4 targets.

## 11. Relationship to the existing chainlink-cre-robinhood and chainlink-cre-guardian integrations

`integrations/chainlink-cre-robinhood/` (T1) already prototypes a narrower, already-simulated use of
CRE: deciding whether a settlement's *quote* looks acceptable before a swap, with its own
`VERDICT`/`EVIDENCE` vocabulary, its own closed public schemas, and its own confidentiality test
suite (T1, T2). This document's admission layer is a *different* decision (whether to create an
order at all, evaluated over merchant-private policy, not over a public settlement quote) and is
**not** a replacement for, or a restatement of, that integration. Where vocabulary already exists
and fits — `PRODUCIBLE_EVIDENCE`'s `mock`/`simulated`/reserved-`confirmed` pattern (§7 item 5),
the closed-schema convention (§5) — this document reuses it by name rather than inventing a
parallel one, the same discipline `integrations/chainlink-cre-robinhood/README.md` states for its
own relationship to `chainlink-cre-guardian`: "That integration is kept and not duplicated."

## 12. Unknowns

Stated honestly rather than omitted:

- Whether UNICA (or NFTeria) has, or could obtain, Confidential Workflows private-beta enrollment
  (C1) or CRE-hosted deploy access for any chain this design would target — unresolved, matching
  T2's existing, unchanged permission matrix.
- The exact seam between this workflow's `orderNonce` field (§5) and the executor's on-chain `salt`
  parameter that derives `orderId` (T5) — this document deliberately does not resolve it, because
  resolving it well requires deciding whether, and how, a creator's off-chain choice of `salt` gets
  tied to a specific workflow decision without becoming a second authorization channel Advisory
  001's lesson (§8) would then apply to directly. Left open for the owner, not guessed at.
- Whether Confidential HTTP's request-parameter quorum (§6, C3) discloses enough about a policy's
  shape (which vendor, how many calls, at what cadence) to defeat the confidentiality goal for a
  policy whose *existence* or *vendor choice* is itself sensitive — not evaluated numerically here;
  `PRIVACY.md` §4 raises it as a leakage vector without a resolution.
- Whether `cre.handlerInTee`'s enclave-type/region option set (§6, C2: AWS Nitro, `us-west-2`
  only, as read on 2026-09-11) has since widened — not re-checked after the date on this document,
  and this document does not assume it has.
- Whether any UNICA-side platform role (as opposed to a single merchant) actually exists or is
  planned that would need the mutual-distrust property §10 identifies as this design's real value
  — no such role is specified anywhere in `docs/unica-v4/` today, so §10's recommendation is
  conditional on a role this document does not itself establish.
- Whether a future on-chain delivery of this authorization (via `IReceiver.onReport`, explicitly
  not proposed in §3) would need its own registry entry, its own `marketId`-equivalent binding, and
  its own Advisory-001-grade review before any contract could safely read it — flagged as a
  distinct, larger, unstarted design question, not answered here.

## 13. Sources referenced

- https://docs.chain.link/cre/concepts/confidential-workflows
- https://docs.chain.link/cre-templates/hello-confidential-workflows
- https://docs.chain.link/cre/capabilities/confidential-http-ts
- https://docs.chain.link/cre
- https://docs.chain.link/cre/guides/operations/deploying-workflows.md
- https://docs.chain.link/cre/service-quotas.md
- `docs/v2/SECURITY-ADVISORY-001.md` (this repository)
- `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (this repository)
- `docs/unica-v4/SPEC-CONTRACTS.md` (this repository)
- `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (this repository)
- `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (this repository)
- `integrations/chainlink-cre-robinhood/README.md`, `policy.mjs`, `schemas/settlement-intent.public.json`, `schemas/workflow-result.public.json` (this repository)
- `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` (this repository, sibling stream, cited not edited)
