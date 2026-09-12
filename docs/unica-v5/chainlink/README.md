# UNICA v5 / Chainlink — synthesis

Research draft for owner review. Not committed. Authorizes nothing. UNICA v5 scope; it does not
reopen or modify merged UNICA v4.

Retrieval date for every claim restated below is 2026-09-11 unless a claim states otherwise.
Labels are unchanged from the ten files this document synthesizes: **VERIFIED** (source cited),
**PROPOSED** (a design choice, not an observation), **UNKNOWN** (no source settles it). No claim
below is asserted without a label; where this document restates a finding rather than re-deriving
it, the citation points to the file and section that did the original sourcing rather than
repeating every URL a second time.

**What is true today, stated once, plainly, because every part below depends on it.** Two
Chainlink-adjacent code directories exist in this repository. Only one of them — the
guardian-subject integration — registers and calls a confidential TEE handler, and that call has
only ever run inside Chainlink's own local CLI simulator, never on a hosted network; the simulator
itself states, at the point the handler runs, that it is not a real trusted execution environment.
The other directory holds decision logic and schemas with no workflow entry point of its own. No
Confidential Workflows private-beta enrollment has been requested. Generic CRE deploy access
(`cre account access`) has been requested and, as of this retrieval, has not been granted. No
receiver contract exists anywhere in this repository. No Chainlink report — confidential or
otherwise — has ever reached a chain from this repository, and none has been checked, decoded, or
accepted by any contract this repository has written, because no such contract exists. Chainlink is
**not** one of UNICA's three submitted integrations; `docs/SPONSOR-ELIGIBILITY.md` (2026-09-09,
SUPERSEDED note, TEAM GUIDANCE) names Uniswap v4, ENSv2 on Sepolia and The Graph as the submitted
set, and nothing in this document reverses that record.

## File index

Every file below was read in full for this synthesis and none is edited by it.

| File | What it is |
|---|---|
| `CONFIDENTIAL-COMMERCE.md` | The order-admission thesis: a Confidential Workflow evaluating private invoice/merchant-policy inputs, its permitted public-output schema, and its explicit prohibitions |
| `DEMO-PLAN.md` | The full "Private Invoice, Publicly Verifiable Payment" design, the seven-beat flow, the adversarial-case table, the verified receiver-success lead, and the honest build recommendation |
| `MENTOR-QUESTIONS.md` | Nine questions about track eligibility and mechanics, each answered as far as public Chainlink/ETHGlobal sources settle it, with the residue marked as needing written confirmation |
| `PEER-COMPARISON.md` | A twelve-dimension comparison of UNICA's existing Chainlink work against Chainlink's own CRE template catalogue and concept documentation |
| `PRIVACY.md` | Field-by-field classification of every private input and public output named in `CONFIDENTIAL-COMMERCE.md`, plus a twelve-vector leakage analysis and the commitment-salting arithmetic |
| `PRIZE-FIT.md` | Track structure, pool amounts, eligibility risk, and the finding that the prize page's own evidence bar is more permissive than the reasoning behind the 2026-09-09 NOT SELECTED decision |
| `PRODUCT-FIT.md` | Every candidate Chainlink product (Confidential Workflows, Data Feeds, Automation, CCIP, VRF, Functions) graded to BUILD / LATER / REJECT against a named necessary problem |
| `RECEIVER.md` | A specification (no contract written) for the settlement-admission receiver: required interfaces, constructor configuration, the fifteen-step `onReport` check order, and a five-condition definition of "delivered" |
| `REPORT-SCHEMA.md` | The 26-field `AdmissionReport` struct, its digest/domain-separator construction, and a field-by-field check against Advisory 001's failure mode |
| `SIMULATION-VS-DON.md` | Six distinct rungs from "compiles locally" to "a live DON delivers this report," and exactly which one (partial rung 0, below even CLI simulation) this repository has reached |
| `THREAT-MODEL.md` | Threats filed under six layers (CRE, receiver, settlement contracts, backend policy, indexer evidence, interface), each with its mitigation, enforcing layer, and status |

## The admission-layer flow, and which layer enforces what

Text diagram of the optional layer `CONFIDENTIAL-COMMERCE.md` and `DEMO-PLAN.md` design — nothing
below is built, deployed, or wired into any v4 contract; every arrow is a design proposal, and every
"enforces" line names the layer that would actually run the check if the layer above it existed.

```
[Merchant private policy + payer invoice request]
  private inputs — never leave the enclave except as a commitment (PRIVACY.md §3.1)
        |
        v
[1. CRE confidential workflow — a TEE handler]
  enforces: the policy decision only (PROCEED/REFUSE-shaped verdict); no typed settlement price is
  ever produced (CONFIDENTIAL-COMMERCE.md §7 item 1); attestation binds which code ran inside the
  enclave, never whether the private inputs it was fed were true (CONFIDENTIAL-COMMERCE.md §6, §9)
        |  public output only: the AdmissionReport-shaped fields, additionalProperties:false
        v
[2. A CRE forwarder delivering the report]
  enforces: a signature threshold from a configured signer set, once a production forwarder and a
  live signer set both exist — covering the entire raw report end to end (REPORT-SCHEMA.md §3);
  proves nothing about which chain, which receiver, or whether the receiver's own logic accepted the
  report (RECEIVER.md §7; MENTOR-QUESTIONS.md Q4)
        |
        v
[3. A settlement-admission receiver contract — onReport, fifteen checks, no early return]
  enforces: forwarder identity, workflow id and owner (checked twice — once from the forwarder's own
  argument, once inside the signed payload), chain id, verifying-contract and receiver match, release
  and registry match, market ACTIVE and version match, quote/policy expiry, and single-use consumption
  of the nonce (RECEIVER.md §5); writes an admission record — never a token transfer, never an order,
  never a settlement mark (RECEIVER.md §2)
        |
        v
[4. A single-use authorization commitment — the admission digest]
  enforces: every one of the struct's fields sits inside the domain separator or the struct hash —
  none is optional, closing the exact class of gap Advisory 001 found when ten of sixteen fields sat
  outside a signed witness (REPORT-SCHEMA.md §5–§6)
        |
        v
[5. Payer-bound order creation — createOrder, then pay(orderId)]
  enforces: the admission record's merchant/payer/amount fields must match the order's own fields
  exactly, or by ceiling for a non-exact input — a cross-check at order-creation time, never a check
  inside onReport, since no order exists yet when onReport runs (RECEIVER.md §6); every existing
  `SPEC-CONTRACTS.md` check (`WrongPayer`, the allowlist, ACTIVE-market gate) still runs, unchanged
        |
        v
[6. Unchanged UNICA v4 settlement — hook, executor, oracle band]
  enforces: oracle freshness and deviation, caps, lifecycle state, payer binding — exactly as
  `SPEC-ORACLE-AND-CHAINS.md` and `SPEC-CONTRACTS.md` already specify, with zero dependency on
  anything above ever having run (THREAT-MODEL.md §4.3, §5): if every step above approves an order
  and the market is then PAUSED before `createOrder` executes, `createOrder` still fails on its own
  terms, independent of what any report claimed
```

## 1. Where UNICA stands with Chainlink today, honestly

Two directories, one real handler. `integrations/chainlink-cre-guardian/` imports and calls
`handlerInTee` (confirmed at a specific line by direct read, `PEER-COMPARISON.md` §1) and has three
recorded simulator runs against a treasury-policy subject, reaching "TEE Execution requested" under
the real CRE CLI after a toolchain defect (a bun-version mismatch) was found and fixed
(`PRODUCT-FIT.md` §1). `integrations/chainlink-cre-robinhood/` — the settlement-quote-policy subject
this synthesis's own design work extends — has an untracked, empty `workflow/` directory and no
workflow entry point at all; `git ls-files` for that directory lists nine files, none a workflow
manifest or entry module (`PEER-COMPARISON.md` §1).

Below even Chainlink's own simulator. `SIMULATION-VS-DON.md` §2–§3 names six rungs from "compiles
locally" to "a live DON delivers this report to an on-chain receiver," and places this repository's
`chainlink-cre-robinhood` work at **rung 0** — hand-written, offline Node.js tests reimplementing
the workflow's own decision logic, checked only against itself, one level below even running
Chainlink's own CLI simulator (rung 1). No CRE CLI session, account, key, or RPC has ever been used
for that subject. The guardian subject alone has reached rung 1 (local simulation, no broadcast).
No UNICA-authored work has reached rung 2 (`--broadcast` against a mock forwarder), rung 3 (a
receiver tested against `MockKeystoneForwarder`), rung 4 (a receiver tested against a production
forwarder's real signature check), rung 5 (a workflow deployed to a hosted DON) or rung 6 (a
receiver accepting a DON-delivered report on chain) — because rungs 3–6 all require a receiver
contract, and none exists (`RECEIVER.md` §8).

Oracle adapters, a separate and orthogonal Chainlink surface. UNICA v4's own three Chainlink-sourced
oracle adapters are fully specified and none is deployed: `ChainlinkFeedAdapter` has been
demonstrated only on an Arbitrum One fork; `ChainlinkStreamsAdapter` and `ChainlinkCREAdapter` are
disabled or simulation-only (`PRODUCT-FIT.md` §1). This oracle-integrity research is real and
independently strong — live on-chain reads against Robinhood Chain testnet, `cast codesize`, `cast
call` — but it belongs to Data Feeds and Data Streams, a different Chainlink surface than the CRE
Confidential Workflow this synthesis otherwise evaluates, and must never be presented as evidence
for the CRE work specifically (`PEER-COMPARISON.md` §3.7, §11.5).

Twelve-dimension scorecard, condensed from `PEER-COMPARISON.md` §4 (full detail and citations
there): meaningful confidential computation and confidential inputs both land at "meets the named
bar" for the guardian subject, with real TEE execution itself DOCUMENTED_NOT_OBSERVED; the public
output schema (`additionalProperties: false`, four fields) is stronger than Chainlink's own stated
bar; on-chain enforcement, replay protection at the UNICA layer, and receiver verification are all
honest gaps or findings rather than built defenses, because no receiver exists; economic
consequence is zero, by design, since the workflow's role is advisory only; identity integration
(ENS) does not exist and is not required by either Chainlink track; evidence discipline (an
evidence-class vocabulary, a repository scanner with proven controls) exceeds the bar Chainlink's
own page sets, though nothing is indexed; and product necessity is the one dimension where this
repository's own design choice — Chainlink CRE is permanently advisory, never load-bearing for
settlement — meets Chainlink's own lower "meaningful, not placeholder" bar while not meeting other
sponsors' stricter "central, not cosmetic" standard.

## 2. The unique thesis, and whether it survives scrutiny

**The thesis, stated once (`CONFIDENTIAL-COMMERCE.md` §2, PROPOSED).** A Confidential Workflow
evaluates private invoice and merchant-policy inputs that no on-chain contract, indexer, or observer
should ever see, and returns one output: a minimal, replay-resistant authorization that a specific,
already-configured UNICA v4 market may (APPROVE) or may not (REFUSE) proceed to create one exact,
payer-bound order. It extends this repository's own existing rule — "CRE may decide whether to
attempt a payment. Only the hook and executor decide whether a payment is valid on chain"
(`integrations/chainlink-cre-robinhood/README.md`) — one step earlier, to order *creation* rather
than order *settlement*.

**What it buys, precisely.** A merchant who alone owns wholesale cost, margin floor, and discount
rules already gets full confidentiality for those values by simply never publishing them — an
ordinary access-controlled server has that property for free. Chainlink's attestation model adds
something only when the party needing assurance is *not* the merchant itself: a platform mediating
between merchants who do not trust each other, or who do not want to trust a shared operator with
everyone's numbers at once, could use attestation to get "this decision was computed by the agreed
policy code" without the operator or any other merchant ever seeing one merchant's inputs
(`CONFIDENTIAL-COMMERCE.md` §10). That is the narrow case the thesis actually answers, not "any
merchant wants privacy" in general.

**Three limits that do not go away no matter how well it is built.**

1. **Attestation proves code integrity, never fact correctness.** A Confidential Workflow's
   attestation is honest about which code ran inside which enclave type; it says nothing about
   whether the private inputs fed to that code — a merchant's own inventory count, a vendor's
   fraud-scoring response — were true or current. A confidentially-computed APPROVE over a lying
   inventory feed produces an honest attestation and a wrong business conclusion
   (`CONFIDENTIAL-COMMERCE.md` §6, §9). This is checked against Chainlink's own documentation, not
   assumed from the assignment brief's own flagged lead: no source found makes the specific claim
   that a Confidential Workflow attestation has ever been wrong; the limit is a general property of
   the attestation model, not a documented incident.
2. **The eventual approved terms are recoverable from public chain data anyway.** `PRIVACY.md` §4.2,
   the most important single finding in the companion document: once a settlement happens, its
   delivered output amount and the market's own public reference price are both on chain, so any
   discount is the arithmetic difference between two public numbers, regardless of how well the
   workflow hid the computation that produced it. Confidentiality here protects the *reasoning
   path*, never the *eventual public terms* of an order that actually settles.
3. **It is advisory by design, which is a genuine security property and a genuine "not placeholder
   code" risk at once.** Removing the workflow entirely changes nothing about whether a UNICA
   settlement can occur (`PEER-COMPARISON.md` §3.11) — the correct posture given Advisory 001's
   lesson, and simultaneously the exact shape of tension a judge could read as decorative against
   Chainlink's own "meaningful... not placeholder" wording, even though that wording is a lower bar
   than other sponsors' "central, not cosmetic" standard (`PRIZE-FIT.md` §6, §11.3).

**Verdict, restated from `CONFIDENTIAL-COMMERCE.md` §10 and `PRODUCT-FIT.md` §2 (both PROPOSED, not
contradictory once read together).** The thesis survives scrutiny as a real, buildable improvement
over a self-hosted policy server, *conditional* on a platform-mediating-mutual-distrust role that no
UNICA document specifies today. For a single merchant protecting its own numbers, a conventional
access-controlled backend already delivers the same confidentiality without the enrollment,
HTTP-quota, single-region, or trusts-its-own-inputs costs the Chainlink-backed version carries.
`PRODUCT-FIT.md` §2 nonetheless grades the underlying admission-layer problem BUILD, because the
decision logic, its leak boundary, and its public schema are already written and tested offline
(`integrations/chainlink-cre-robinhood/`), and the remaining engineering work is translation along an
already-proven toolchain path, not new design.

## 3. The exact report schema

`REPORT-SCHEMA.md` in full defines this; nothing below has been compiled, simulated, or sent
anywhere. Status: DRAFT specification only. No workflow producing this exact payload exists; no
receiver decodes it.

**Where it sits.** The business-report bytes a receiver's `onReport(bytes metadata, bytes report)`
would decode as `report` — bytes 109 onward of a raw Keystone report, after a 64-byte metadata slice
(`workflow_cid`, `workflow_name`, `workflow_owner`, `report_id`) the forwarder itself slices off
(`REPORT-SCHEMA.md` §3, read directly from `KeystoneForwarder.sol` source).

**The `AdmissionReport` struct — 25 input fields plus one derived field:**

| # | Field | Type | Purpose |
|---|---|---|---|
| 1 | `chainId` | `uint256` | Defends against cross-chain replay of an identical signed payload |
| 2 | `verifyingContract` | `address` | The specific receiver instance; closes the gap where the forwarder's own metadata is unconfirmed to bind a receiver by itself |
| 3 | `unicaRelease` | `bytes32`/short string | Reuses `ProtocolRelease`'s existing tag; binds to one deployment generation |
| 4 | `registry` | `address` | The `UnicaMarketRegistry` this admission is scoped to |
| 5 | `marketId` | `bytes32` | The market this order would be created against |
| 6 | `marketVersion` | `uint32` | Blocks admission against a RETIRED-and-relisted market at a new version |
| 7 | `merchant` | `address` | The intended recipient — the exact field Advisory 001 found reachable outside a signed witness |
| 8 | `payer` | `address` | The bound payer, or the zero address if unbound (open question, Part 9) |
| 9 | `inputAsset` | `address` | The pulled asset |
| 10 | `outputAsset` | `address` | The delivered asset |
| 11 | `exactInput` | `bool` | Whether `inputAmount` is an exact pull or a payer-authorized ceiling |
| 12 | `inputAmount` | `uint256` | The exact amount or the ceiling, per #11 |
| 13 | `minOutput` | `uint128` | The minimum delivery this admission was computed for |
| 14 | `orderNonce` | `bytes32` | A workflow-chosen, single-use value — distinct from the on-chain `orderId`, which does not exist until `createOrder` runs |
| 15 | `quoteExpiry` | `uint64` | When the priced quote itself goes stale |
| 16 | `policyExpiry` | `uint64` | When the policy configuration behind this admission is superseded |
| 17 | `terminalNode` | `bytes32` | The originating point-of-sale terminal's ENS node, or zero |
| 18 | `terminalStatusSnapshot` | `bytes32` | A hash of the terminal-status record read at generation time — bounded by `policyExpiry`, not a live revocation check |
| 19 | `ensDeploymentId` | UNKNOWN | The ENSv2 deployment axis, deliberately left to the sibling ENS stream's own resolution |
| 20 | `policyVersionHash` | `bytes32` | A commitment to the policy version that decided this — audit only, never enforcement |
| 21 | `privateInputCommitment` | `bytes32` | A single generic, salted commitment to whatever private inputs the decision depended on |
| 22 | `workflowId` | `bytes32` | The CRE workflow content-address, restated a second time inside the signed payload |
| 23 | `workflowOwner` | `address` | Restated alongside #22 — a name is never checked without an owner in the same comparison |
| 24 | `workflowVersion` | UNKNOWN/PROPOSED | Either Chainlink's own `cre workflow hash` config hash or a UNICA-side counter (open question, Part 9) |
| 25 | `receiver` | `address` | The receiver contract, restated; must equal `verifyingContract` (#2) or the report is malformed |
| 26 | `domainSeparator` | `bytes32` | Derived, never independently supplied — a report carrying its own value here would let a submitter pick one that does not match the rest of the struct |

**The digest, exactly as specified:**

```
domainSeparator = hash( "UNICA-ADMISSION-V1", chainId, verifyingContract, unicaRelease, registry )
structHash      = hash( marketId, marketVersion, merchant, payer, inputAsset, outputAsset,
                         exactInput, inputAmount, minOutput, orderNonce, quoteExpiry, policyExpiry,
                         terminalNode, terminalStatusSnapshot, ensDeploymentId, policyVersionHash,
                         privateInputCommitment, workflowId, workflowOwner, workflowVersion,
                         receiver )
admissionDigest = hash( domainSeparator, structHash )
```

Every field of fields 1–25 sits inside `domainSeparator` or `structHash`; none is optional. This is
checked field by field against Advisory 001's own failure mode — ten of sixteen fields sat outside a
signed witness there — in `REPORT-SCHEMA.md` §6, and every row reads "yes, changing it alone changes
the digest," by construction of the struct's own definition (not yet tested against compiled code,
since no contract implementing it exists).

## 4. Receiver requirements

`RECEIVER.md` specifies this in full; status DRAFT, no contract written, compiled, or deployed.

**Interface.** `onReport(bytes calldata metadata, bytes calldata report) external`, and
`supportsInterface` must return true for the `IReceiver` interfaceId `0x805f2132` (independently
derived two ways in the source session) and for ERC-165's own self-declaration interfaceId
`0x01ffc9a7`. A receiver failing this check is never called at all — the forwarder's own `route()`
records `invalidReceiver = true` and moves on without invoking `onReport`.

**Constructor-pinned immutables, none with a setter.** The chain's *production* forwarder address
(refusing the chain's own simulation-forwarder address, matching `ChainlinkCREAdapter`'s existing
pattern); the registry; the chain id; the release tag; the workflow id and owner this receiver
accepts reports from; a report-schema version tag.

**The fifteen-step `onReport` check order (full revert names in `RECEIVER.md` §5), condensed:**
caller is the pinned forwarder → metadata is exactly 64 bytes → metadata decodes into workflow id,
name, owner, report id → workflow id and owner match the pinned values (checked once against the
forwarder's own metadata argument, once again inside the decoded report — closing the gap that the
metadata argument alone is unconfirmed to bind a receiver) → the report meets a minimum length →
its leading schema-version tag matches → it decodes exactly, with no unaccounted trailing bytes →
chain id matches → verifying contract and receiver both equal this contract → release and registry
match → the named market exists, is at the expected version, and is ACTIVE → both quote expiry and
policy expiry have not passed → a terminal-status snapshot is recorded as asserted, never
re-resolved → the nonce has not been consumed before, and is marked consumed → the admission digest
is recomputed and the admission record is written. **No step is a `return`; every rejection is a
`revert`.** This is the one property that makes `ReportProcessed(..., true)` reachable only through
the actual accept path — the design answer to Part 7's finding.

**"Delivered" is five conjoined conditions, not any one of them:** the forwarder transaction is
mined at status 1; the mined transaction's own `ReportProcessed` event carries `true` for the
specific transmission this admission was expected under; the receiver's `onReport` is built so a
`true` result is reachable only through the completed accept path above; a direct read of the
receiver's own storage shows the matching admission record; and enough confirmations have passed
that none of the above is at risk of a reorg unwinding it (the confirmation count itself is UNKNOWN
for every chain checked — Part 9).

## 5. Product-fit decisions

Full grading and citations in `PRODUCT-FIT.md`; every problem is evaluated against a necessary
UNICA problem, never "a use for Chainlink."

| Product | Verdict | Why, in one line |
|---|---|---|
| A — Confidential Workflows (order admission) | **BUILD** | A real problem exists (a merchant admission gate the merchant does not want public); the decision logic is already written and tested offline; the remaining work is translation, not design; failure mode is bounded to UX, never funds |
| B — Data Feeds / authenticated adapters | **BUILD** — already decided at the v4 layer, cited here, not reopened | The oracle-safety problem is real and already fully specified; nothing in this stream changes it |
| C — Automation | **LATER** | Chainlink Automation is past its own documented sunset (v1.x June 30 2026, v2.1 July 31 2026); the underlying visibility problem is real but not urgent, and any new work should target a CRE cron/log-trigger workflow, never a fresh Automation upkeep |
| D — CCIP (cross-chain order or receipt) | **REJECT, for now** | No committed UNICA document names a genuine cross-chain requirement today; no testnet lane this repository has evidence for carries a usable price feed to relay in the first place |
| E — VRF (fair assignment) | **REJECT** | No UNICA document specifies any mechanism with more than one candidate to choose fairly among; UNICA's own settlement design admits no random input anywhere by construction |
| F — Functions, vs. Confidential Workflows | **REJECT Functions as a standalone product; the comparison itself is resolved** | Functions is past its own documented sunset (June 30 2026); privacy-needing logic routes to product A, public-data-needing logic (if ever built) routes to a plain CRE workflow under product B's existing fail-closed adapter discipline — never a CRE-as-oracle shortcut, and never a workflow whose only protected element is a credential |

**Anti-patterns checked against every verdict above and confirmed absent** (`PRODUCT-FIT.md` §8): a
workflow that merely calls a settlement function; one that hides only a vendor credential; a model
choosing a price; CRE replacing the on-chain oracle; an unenforced fraud score standing in for
enforcement; unbounded pause authority handed to an automated trigger; confidential logic whose
output can redirect funds; any product added only to be able to claim it.

## 6. The primary demo

**Recommendation, stated once (`DEMO-PLAN.md` §6):** ship the smaller, buildable slice, not the full
seven-beat design. The full design's later beats (an authenticated oracle price, Uniswap v4
settling, a receiver accepting a delivered report) all need UNICA v4 contracts that are specified
but not built, and, for a CRE-priced route, deploy approval this repository does not hold — neither
blocker is something this stream can close, and neither is a limitation of Chainlink's own
infrastructure. What is buildable today, with existing pieces, is beat 3 of the design alone: the
confidential policy computation, run through Chainlink's own local simulator.

**What that slice consists of.** `integrations/chainlink-cre-robinhood/policy.mjs`'s existing,
unit-tested `decide()` function, wrapped in a thin `handlerInTee` entry point following the pattern
`integrations/chainlink-cre-guardian/` has already proven runs under the real CRE CLI, then executed
through `cre workflow simulate`. This satisfies, in full, the Best Confidential Workflow track's own
accepted demo format — "a Confidential Workflow simulation using the CRE CLI" is named as one of
exactly two sufficient evidence forms on the prize page itself — without touching a single v4
contract, without any additional Chainlink account grant beyond what local simulation already needs
(confirmed not required for local simulation specifically, `MENTOR-QUESTIONS.md` Q7), and without
any ENS or Uniswap dependency.

**What the recorded demo would show, and would not overstate.** A real toolchain finding already on
record for the guardian subject (a bun-version mismatch that produced a WebAssembly failure, found
and fixed), the simulator's own printed statement that it is not a real trusted execution
environment, and a public result whose schema never carries any of the five private policy fields —
a genuinely narratable sequence rather than a bare "it compiled" claim (`PEER-COMPARISON.md` §3.12).
Presenting this slice as the full seven-beat design would overstate what runs; presenting it
honestly, labelled as one buildable increment of a larger, explicitly not-yet-built architecture,
does not.

## 7. The attack demonstration plan

**The finding this plan exists to demonstrate, confirmed against primary source
(`DEMO-PLAN.md` §4.7, `RECEIVER.md` §7, `MENTOR-QUESTIONS.md` Q4).** Chainlink's own
`KeystoneForwarder.report()` delivers a report to a receiver through a low-level call inside inline
assembly. A revert inside that call never propagates to the outer transaction — the forwarder's own
transaction still mines at status 1, and only a separate boolean, carried in the `ReportProcessed`
event, records whether the receiver-level call itself reverted. **This does not by itself mean a
false positive is possible** — a call that reverts is visible as `false` in that event. The sharper
hazard, stated precisely: a receiver whose `onReport` *returns normally* on a case it should have
rejected, rather than reverting, produces `ReportProcessed(..., true)` — indistinguishable on the
transaction's own face from a genuine accept — while having written nothing, or written something
other than what the report's own fields describe.

**Proposed method, not yet built, requiring no Chainlink account grant of any kind.**
`MockKeystoneForwarder` — read directly from Chainlink's own source (`SIMULATION-VS-DON.md` §2, rung
3) — is permissionless and skips every signature check, while reproducing the identical `route()`
isolation mechanics as the production contract byte for byte: the same `ERC165Checker` gate, the
same raw `call()` into `onReport`, the same `Transmission`/`ReportProcessed` bookkeeping. That means
the exact hazard above can be exhibited against the mock alone, with no live DON, no signer set, and
no deploy approval:

1. Deploy the mock forwarder and two contrived receiver contracts against it — never anything from
   `src/unica-v4/`. Receiver (i): a **deliberately wrong** implementation that `return`s normally on
   a rejection case instead of reverting (the exact anti-pattern `RECEIVER.md` §5 forbids). Receiver
   (ii): the specification's own design — every rejection path in `RECEIVER.md` §5 is a `revert`,
   never a `return`.
2. Call `route()` (or `report()`, per the mock's own entry point) with a report payload constructed
   to trigger a rejection case in both receivers — for instance, a market status the receiver should
   refuse, or an already-consumed nonce.
3. Record, for each receiver, side by side: the outer transaction's own status; the
   `ReportProcessed` event's boolean; and a direct read of the receiver's own storage for the
   admission record that step 15 of `RECEIVER.md` §5 would have written.
4. **Predicted, sourced result, not yet observed:** receiver (i) mines at status 1 with
   `ReportProcessed(..., true)` and an empty admission record — a mined, "successful"-looking write
   that admitted nothing. Receiver (ii) either reverts (so the event carries `false`, and no
   ambiguity exists) or completes its own accept path and actually writes the record — never a
   silent `true` with nothing behind it.

**Scope, stated plainly.** This is a Solidity-level demonstration against rung 3 of
`SIMULATION-VS-DON.md`'s ladder — a mocked forwarder, never a live DON, never rung 4's real signature
check. It requires writing a receiver contract, which does not exist anywhere in this repository
today (`RECEIVER.md` §8), and is therefore **PROPOSED, not built, and not scheduled** as part of
Part 8's minimal sequence unless the owner selects that option explicitly (Open question C6).

## 8. The minimal build sequence

Reproduced in full from `DEMO-PLAN.md` §7, with its own cut line kept intact rather than extended:

1. Write `integrations/chainlink-cre-robinhood/workflow/main.ts`, importing the existing
   `policy.mjs` unmodified, following `chainlink-cre-guardian`'s already-proven thin-entry pattern.
2. Wire the already-written `secret-names.yaml` into the workflow's `secretsNames`; run
   `cre workflow simulate` locally against synthetic values, the same sequence already demonstrated
   for the guardian subject.
3. Confirm the confidentiality boundary holds for this subject the same way the existing
   confidentiality test suite already proves it for its own fixtures — the public result never
   carries `maxDeviationBps`, `minMerchantOut`, `preferredVenue`, or `supportedChainIds`.
4. Record the run — exit code, the simulator's own disclaimer, the public result — as this stream's
   own evidence file, in the same shape as the guardian subject's existing record.
5. **Cut here for this event.** A receiver contract, a live forwarder delivery, ENS terminal
   deployment, and any UNICA v4 contract are the target architecture named throughout this document,
   explicitly not attempted, because each depends on work outside this stream's scope (v4 contracts)
   or access this repository does not hold (CRE deploy approval, Confidential Workflows private-beta
   enrollment).

## 9. Eligibility uncertainties

Full detail and every citation in `PRIZE-FIT.md` §11, §14; condensed here to what a build-sequence
decision actually turns on.

- **The partner-prize slot ceiling is the largest single risk, and a portfolio decision, not a fact
  this document settles.** Uniswap v4, ENSv2, The Graph, and Arc already collectively press against
  ETHGlobal's stated "up to 3 Partner Prizes" ceiling; adding Chainlink adds a further named sponsor
  commitment against that same ceiling, and the "a partner's multiple tracks count once" reading that
  would soften this is sourced only via search-engine summaries, never a directly quoted primary
  sentence for this specific event.
- **A real prior decision, not a stale draft.** `docs/SPONSOR-ELIGIBILITY.md`'s 2026-09-09 NOT
  SELECTED status reflects an owner ruling; a finding that the prize page's own evidence bar is more
  permissive than that ruling's stated reasoning (Part 2, item 3 above) is a fact worth the owner's
  reconsideration, never a unilateral reversal.
- **A conflict between two official pages on the prize's own total amount** — $2,000 on the general
  prizes page versus $3,000 on the dedicated Chainlink subpage, both retrieved the same day, both
  agreeing only that at most two teams split it at $1,000 each.
- **The submission-deadline reading itself is contested across this repository's own sibling
  streams** — the tighter reading (2026-09-13, 12:00 pm EDT) leaves roughly two days of runway from
  this retrieval date, materially narrower than a five-day reading would.
- **The "up to 2 teams" selection mechanism for the Confidential Workflow track's own prize** is
  stated on the page without describing whether it is ranked judging, a category split, or something
  else.
- **The Automated Liquidation Protection Challenge's join step is a broadcast transaction** this
  research does not perform and does not recommend performing without a separate, later owner
  decision (Open question C3).

## 10. Questions needing written confirmation

Consolidated from `MENTOR-QUESTIONS.md` (full answers-from-public-sources and citations there) and
`PRIZE-FIT.md` §12. Every item below has already been answered as far as a public Chainlink or
ETHGlobal page settles it; what remains is a Chainlink or ETHGlobal team member's own word, not
further research against the same pages.

1. Whether the Best Confidential Workflow track's silence on a pool restriction — next to an
   explicit Continuity-only restriction stated for a different track on the same page — actually
   means a From Scratch entry is considered for it.
2. Whether a workflow's sensitive input sourced from CRE secrets (rather than an external API call
   made inside the enclave) satisfies "process at least one sensitive input" as fully as an
   API-sourced value would.
3. Whether the workflow's role in the *application* — as opposed to the *demo format*, which a CLI
   simulation structurally cannot include a chain write for — is expected to include an on-chain
   write.
4. Which of the two conflicting prize totals ($2,000 or $3,000) is correct.
5. What Chainlink's own documentation says, anywhere, about failure or unavailability behavior of
   the Confidential Workflows infrastructure itself (the TEE, the Vault DON) — as distinct from an
   ordinary handler-level revert — since the concept page most directly on point states nothing
   about this.
6. Whether joining the Automated Liquidation Protection Challenge and separately submitting a
   different Confidential Workflow build from the same repository would be read as one project
   extended twice or as two separate, competing submissions.
7. Whether an explicitly advisory-only (never load-bearing for settlement) Confidential Workflow
   satisfies "not placeholder code" for a judge, given that removing it changes nothing about
   whether a UNICA settlement can occur.
8. The exact selection mechanism behind the "up to 2 teams" cap on the Confidential Workflow track's
   own prize.
9. Whether pursuing this track and the Liquidation Protection Challenge together truly costs only
   one of the three Partner Prize slots under the one-partner-counts-once reading, given that reading
   is sourced only via search-engine summaries for this specific event.

## 11. The proposed uncommitted diff

Nothing below has been created, staged, or edited by this document or by anything else in this
stream — this stream is scoped to writing exactly the two files named at its top. This section is a
proposed manifest for the owner to authorize or decline, matching Part 8's minimal sequence exactly
and nothing beyond it.

| Change | File | Purpose |
|---|---|---|
| New file | `integrations/chainlink-cre-robinhood/workflow/main.ts` | A thin `handlerInTee` entry point importing the existing `policy.mjs`'s `decide()` unmodified, mirroring the already-proven pattern in `integrations/chainlink-cre-guardian/` |
| New file | a CRE workflow manifest for this subject (the guardian subject's `workflow.yaml` is the pattern to follow) | Wires the already-written `secret-names.yaml` mapping into the workflow's `secretsNames`; introduces no new secret value |
| New file | an evidence record for this subject's own simulator run, in the shape `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` already uses for the guardian subject | Records exit code, the simulator's own disclaimer text, and the public result — never a claim of live TEE execution |
| No change | every file under `src/unica-v4/`, every v4 spec, every existing `chainlink-cre-guardian` file | The minimal sequence touches no settlement contract, no oracle adapter, and no already-working integration |
| Not included | any receiver contract, any Confidential Workflows private-beta enrollment, any follow-up to the outstanding `cre account access` request, any ENS or Graph wiring | Each depends on access this repository does not hold or on work another stream owns; none is part of the buildable-today slice |

## Sources

Every URL, retrieval date, author/organization, and OFFICIAL/TEAM GUIDANCE label for the claims
synthesized above is carried in the source table of the file that originally established it — this
section names which file to open for which claim rather than repeating dozens of citations a second
time.

| Claim family | Primary file(s) of record |
|---|---|
| Current repository state, the twelve-dimension comparison | `PEER-COMPARISON.md` §1, §4, §6 |
| Product grading (BUILD/LATER/REJECT) | `PRODUCT-FIT.md` §1–§9 |
| Track structure, pool amounts, eligibility risk | `PRIZE-FIT.md` §2–§3, §11, §14 |
| Track/eligibility questions answered from public sources | `MENTOR-QUESTIONS.md` Q1–Q9 |
| The admission-layer thesis, its costs, and its recommendation | `CONFIDENTIAL-COMMERCE.md` §2, §6, §10, §12 |
| Field classification and leakage vectors | `PRIVACY.md` §3–§6 |
| The `AdmissionReport` schema and digest | `REPORT-SCHEMA.md` §3–§8 |
| The receiver's required checks and the "delivered" definition | `RECEIVER.md` §3–§9 |
| The six-rung simulation ladder and this repository's actual position on it | `SIMULATION-VS-DON.md` §2–§6 |
| Threats by layer, mitigations, and residual risks | `THREAT-MODEL.md` §1–§8 |
| The full design, the honest build judgment, and the verified receiver-success lead | `DEMO-PLAN.md` §3–§9 |

Two primary sources are load-bearing across nearly every part of this synthesis and are named here
once rather than in every part above: `KeystoneForwarder.sol`, commit
`92897847daa3ba26ac2796ef284f57e6f3d1ca2a`,
`github.com/smartcontractkit/chainlink-evm`, Chainlink Labs / smartcontractkit, OFFICIAL, retrieved
2026-09-11 (the receiver-delivery mechanics behind Parts 4, 6, 7); and the ETHOnline 2026 Chainlink
prize subpage, `ethglobal.com/events/ethonline2026/prizes/chainlink`, ETHGlobal / Chainlink,
OFFICIAL, retrieved 2026-09-11, fetched twice and agreeing on every quoted phrase (the track wording
behind Parts 5, 9, 10).
