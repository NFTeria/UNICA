# UNICA v5 × Chainlink — product fit

Engineering record. Track: **From Scratch** (confirmed by the owner, 2026-09-11; UNICA v4's contracts
are specified as documentation and not built — `docs/unica-v4/README.md`, `docs/unica-v4/DECISIONS.md`).
Retrieval date for every claim below is **2026-09-11** unless a claim states otherwise. Labels:
**VERIFIED** (source cited, checked against a primary document or a live read), **PROPOSED** (a UNICA
design choice, not a claim about the sponsor or about eligibility), **UNKNOWN** (neither established
nor ruled out by anything read for this file).

**This file does not reopen or mutate UNICA v4.** UNICA v4's oracle layer
(`docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md`) is a merged, frozen specification; product B below cites
and affirms it, and changes nothing in it. Every other product (A, C, D, E, F) is evaluated as an
**optional admission layer that sits before order creation** — a layer that may decide whether a
payment is *attempted*, never one that decides whether a payment is *valid*. That distinction is the
lesson of this repository's own Advisory 001 (`docs/v2/SECURITY-ADVISORY-001.md`): a settlement that
lets any off-chain decision — a signature, a workflow result, a relayer's choice — stand in for a
binding cryptographic join can be redirected by whoever submits it. Every verdict below is graded
against that lesson.

**No claim of eligibility is made anywhere in this file.** Where a Chainlink prize track's wording is
quoted, it is quoted to state the bar, not to assert UNICA clears it.

---

## 0. Method

For each product: the **necessary problem** it would solve (not "a use for Chainlink" — a problem
UNICA already has), **why Chainlink specifically** (what a self-run alternative would cost or lack),
**trust assumptions**, **failure mode** (what happens when the product is wrong, slow, or absent),
**on-chain authority** (what it is allowed to move or decide by itself), **privacy effect**, **demo
value**, **implementation cost**, and a **verdict**: **BUILD** (a concrete next step exists and nothing
blocks starting it), **LATER** (a real problem exists but a named precondition is missing), or
**REJECT** (no necessary problem is identified today, or the fit is structurally wrong).

---

## 1. What already exists (measured, not reopened)

VERIFIED (repository, read for this file).

| Area | State | Where |
|---|---|---|
| Oracle layer (product B) | Fully specified: `IUnicaPriceOracle`, `IUnicaOracleRoute`, `OraclePolicy`, three adapter kinds, fork test rows OF1–OF9. Nothing deployed; `ChainlinkFeedAdapter` is fork-demonstration only pending the fork suite; `ChainlinkStreamsAdapter` and `ChainlinkCREAdapter` are disabled/simulation-only | `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §2–§9, §15 |
| Chain evidence for 46630/4663/42161 | No Data Feed on 46630 testnet; one TSLA-only Data Feed on 4663 mainnet; a live `VerifierProxy` and `KeystoneForwarder` on 46630 with no usable price behind either; a live CCIP router on 46630 with no reachable TSLA/NFLX feed on any lane destination | `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (cited throughout as "CA §n") |
| Confidential-workflow prototype, settlement-policy subject (relevant to product A) | Pure JS decision logic (`decide()`, `policyCommitment()`), a public-result JSON Schema with `additionalProperties:false`, 18 confidentiality-boundary tests passed, a repository scan (`script/check-cre-confidentiality.sh`) wired into the gate. **Never imported the CRE SDK and never registered a TEE handler** — its own README calls its confidentiality evidence "offline" | `integrations/chainlink-cre-robinhood/` (`README.md`, `policy.mjs`, `schemas/workflow-result.public.json`); `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` |
| Confidential-workflow prototype, liquidation-protection subject (a *different* subject — Chainlink's own challenge scenario, not UNICA's settlement) | A real `handlerInTee` workflow against `@chainlink/cre-sdk@1.18.0`, reaching **TEE Execution requested** under the real CRE CLI (v1.32.0) once a bun-version defect was found and fixed; `cre whoami` reported Deploy Access **not enabled**, account-access request submitted and awaiting review | `docs/v2/CRE-CONFIDENTIAL-WORKFLOW.md`; `integrations/chainlink-cre-guardian/`; `docs/feedback/chainlink.md` (2026-09-08 entry) |
| Prior Chainlink-product scoping for this repository | An executor-side price-feed sanity check was considered and set aside; no defect motivated it | `docs/feedback/chainlink.md` §1 |

### 1.1 The ETHOnline 2026 Chainlink prize page, as worded today

VERIFIED — <https://ethglobal.com/events/ethonline2026/prizes>, retrieved 2026-09-11. Three Chainlink
tracks:

| Track | Pool | Track type | Bar, quoted |
|---|---|---|---|
| Best Confidential Workflow | $2,000 (up to 2 teams, $1,000 each) | not marked Continuity | "Build a CRE Workflow that uses the Confidential Workflows to execute a meaningful part of the application"; the confidential portion "must process at least one sensitive input, secret, confidential API response, private parameter, or intermediate value inside the enclave"; demonstrated "via simulation or live CRE network deployment" |
| Best Chainlink-Powered Upgrade | $500 | **Continuity only** ("🆕 This prize is only available to Continuity Track participants") | "Integrate at least one Chainlink service directly within smart contract logic or workflows"; "must contribute to a state change on a blockchain" |
| Automated Liquidation Protection Challenge | $500 | From Scratch | A fixed, Chainlink-authored benchmark: protect a virtual ETH-collateral/debt position using a Confidential Workflow, against Chainlink-provided contracts |

The second row is **closed to this track** regardless of any technical decision here — it is the same
finding `docs/feedback/chainlink.md` already recorded on 2026-09-05 from the prize page's own
Continuity/From-Scratch split. The third row is a separate submission vehicle already explored under
`integrations/chainlink-cre-guardian/` (a Chainlink-authored scenario, not a UNICA product-fit
question) and is not evaluated further in this file. The first row is the one product A below is
graded against.

---

## 2. A — Confidential Workflows (private invoice / merchant-policy admission)

**Necessary problem.** A merchant may want an admission gate — reject a payment attempt before it is
even built, if the quoted price has drifted too far from a reference, if the quote has gone stale, or
if the counterparty's chain is not one the merchant supports — without publishing the exact thresholds
that gate looks for. Publishing `maxDeviationBps`, `maxQuoteAgeSeconds` or a preferred settlement venue
on chain (the way `OraclePolicy` publishes its own bounds, by design, in product B) lets any payer or
competitor find the exact edge of what the merchant will accept, which is a different problem for a
policy the merchant does not want to admit at all than for a bound the market is supposed to know
(product B's bound is a **safety rail everyone should see**; a merchant's admission policy is a
**business decision no one needs to see**). PROPOSED: this is the "private invoice and merchant-policy
evaluation" problem named for this stream — evaluated as real because `integrations/chainlink-cre-robinhood/`
already models exactly this policy shape (deviation, staleness, a floor, a supported-chain list,
`preferredVenue`) as private input.

**Why Chainlink specifically.** The alternative to a TEE-attested workflow is a server UNICA operates
and asks payers to trust — which is not credibly neutral (UNICA itself could see or change the policy
mid-flight) and is not attested to anyone. Chainlink's Confidential Workflows model runs the decision
inside a TEE and requires DON consensus over an attestation before the workflow is considered to have
completed: "Confidential workflows successfully complete execution only after DON consensus verifies
attestations from the enclave." — OFFICIAL, <https://docs.chain.link/cre/concepts/confidential-workflows>,
retrieved 2026-09-11. That is a property a self-hosted server cannot offer without building the same
attestation infrastructure from scratch.

**Trust assumptions.** VERIFIED, same source: secrets released into the enclave by a Vault DON, and
sensitive inputs and in-enclave capability calls are protected; the workflow's own source code, its
deployed binary, its orchestration metadata, its triggers, and its chain reads/writes are **not**
protected — they "always execute on Workflow DON nodes." Two documented caveats matter here: "Multiple
confidential workflows may execute within the same enclave" with Wasmtime as the only isolation
boundary between them (not per-workflow isolation), and side-channel or speculative-execution attacks
"may leak information" despite the TEE. Confidential Workflows is also, as of this retrieval, **invite-only**:
"Confidential Workflows is in private beta and requires enrollment through your Chainlink account
team." Enrollment status for this repository's account is UNKNOWN for the settlement-policy subject;
for the separate liquidation-protection subject, `cre whoami` returned Deploy Access **not enabled** and
an account-access request was awaiting review as of the 2026-09-08 entry in `docs/feedback/chainlink.md`
— simulation itself needed only an account login, not that approval (`docs/v2/CRE-CONFIDENTIAL-WORKFLOW.md`).

**Failure mode.** By design this layer is advisory, never binding — the existing prototype states the
rule already: "CRE may decide whether to attempt a payment. Only the hook and executor decide whether
a payment is valid on chain." (`integrations/chainlink-cre-robinhood/README.md`, TEAM GUIDANCE, this
repository's own architectural rule.) So the worst case of a wrong, stale, unavailable, or hostile
workflow is a UX failure — a payment that should have proceeded is refused, or a payment that should
have been refused is attempted and then fails independently at the hook/executor — never a fund-safety
failure, provided nothing downstream ever treats a workflow result as authorization. A second,
narrower failure mode is documented in the workflow's own leak analysis: a *clamped* output can publish
the exact value of the private cap that clamped it — "the per-action cap **is** inferable... a single
clamped action publishes it exactly" (`docs/v2/CRE-CONFIDENTIAL-WORKFLOW.md`). Any new public field this
layer emits must be checked against the same test the existing `main.test.ts` runs, not assumed safe by
analogy.

**On-chain authority.** None, and none should ever exist. The public result already excludes anything
but a verdict enum, an evidence class, a policy commitment, and a deviation figure derivable from two
public quotes anyway (`schemas/workflow-result.public.json`, `additionalProperties: false`). No
contract should accept this result as a substitute for the hook/executor's own checks; no contract in
this repository does — "No contract trusts a workflow result. No CRE report verifier, no DON signer,
no `CRE verified` signal" (`docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` §6, describing the
guardian subject's boundary; the same rule is stated independently for the settlement-policy subject
in its own README, quoted above).

**Privacy effect.** Positive and specific: it is the one product among the six that can keep a
merchant's own decision thresholds off chain while still gating an on-chain attempt. No other product
evaluated here has this property.

**Demo value.** Matches the Best Confidential Workflow track's stated bar closely — a private
`maxDeviationBps`/`maxQuoteAgeSeconds`/floor/venue policy is exactly a "sensitive input... or
intermediate value" processed "inside the enclave," and the track accepts demonstration "via simulation
... or live CRE network deployment." Reaching that bar needs the decision logic that already exists
wrapped in a real `handlerInTee` entry point and run through the CRE CLI's simulate command — the exact
toolchain path (bun ≥ 1.2.21, a scoped `tsconfig.json`) is already proven to work for the separate
liquidation-protection subject (`docs/feedback/chainlink.md`, 2026-09-08 entry) and documented as a
one-command run once an account is logged in (`docs/v2/CRE-CONFIDENTIAL-WORKFLOW.md`). No claim is made
here that this has been done for the settlement-policy subject; it has not.

**Implementation cost.** Low relative to the other five products, because the hard part — the
decision arithmetic, its leak boundary, and its public-result schema — is already written and tested
offline (`integrations/chainlink-cre-robinhood/`). What remains is translation, not design: a
`workflow/` directory mirroring the guardian subject's shape (an entry module under a scoped
`tsconfig.json`, `secretsNames` mapped to the five private policy fields via `secret-names.yaml`'s
already-established naming convention, `handlerInTee` wrapping `decide()`), then one CRE-CLI simulate
run once the account/enrollment state allows it. This is an OWNER ACTION gate (login, enrollment), not
an engineering blocker.

**Verdict: BUILD.** The problem is real, the trust model is a genuine improvement over a self-hosted
server, the failure mode is bounded to UX rather than funds by the design rule already in force, and
the remaining engineering work is translation of an already-tested module along an already-proven
toolchain path. The one open dependency (account login / enrollment) is explicitly an owner action, not
a reason to defer the engineering work.

---

## 3. B — Data Feeds or authenticated adapters (settlement price and freshness)

**Necessary problem.** A market that settles against a reference price needs that price to be fresh,
positive, and from a source that fails closed rather than silently substituting a stale or fabricated
value — this is the ordinary oracle-safety problem, already fully specified at the v4 layer.

**Why Chainlink specifically.** Already the sponsor UNICA v4 is built against: `IUnicaPriceOracle` is
adapter-agnostic by interface, but the only adapters specified (`ChainlinkFeedAdapter`,
`ChainlinkStreamsAdapter`, `ChainlinkCREAdapter`) are all Chainlink-sourced, chosen for the same reason
this file exists — a decentralized, node-diverse, BFT-aggregated price is a materially different trust
object than a single API call.

**Trust assumptions, failure mode, on-chain authority.** Already fully specified and not repeated here
in full: `MAX_ORACLE_AGE` (300s) and `MAX_DEVIATION_BPS` (300) are on-chain registry ceilings enforced
for every policy including one an ADMIN submits directly; every check fails closed
(`docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §3–§4); no adapter has setter, owner, pause, or upgrade
authority — a route change is RETIRE-and-relaunch, never a live mutation (§2, §3, ledger Q112). This
file changes none of it.

**Privacy effect.** None — a price feed is meant to be public, and Data Streams reports carry a
`marketStatus` field precisely so consumers do not have to guess (CA §3d). Not a privacy product.

**Demo value.** No dedicated ETHOnline 2026 track rewards a Data Feeds integration by itself (§1.1);
its demo value is technical rather than prize-shaped — the difference between "Chainlink integration
demonstrated on a fork" (the wording UNICA v4's own spec permits only after fork rows OF1–OF9 pass with
zero skips, `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §15) and a claim with no evidence behind it.

**Implementation cost.** Already spent at the specification layer; the remaining cost is execution
(running OF1–OF9 against a pinned Arbitrum One fork and a read-only Robinhood-mainnet fork), which is
v4 implementation work, not a v5 decision.

**Verdict: BUILD — already decided, cited here, not reopened.** The v4 specification stands. Nothing
in this stream proposes a change to it. Where this stream's admission layer (product A) and this
product interact at all, it is only as a *public* input the admission layer's `referenceQuote` may be
compared against — the admission layer never becomes an oracle, and never substitutes for §3's on-chain
checks (see §6, integration to avoid #4).

---

## 4. C — Automation (public monitoring or bounded alerts)

**Necessary problem, if any.** A market that has left its recorded liquidity range, a feed that has
gone stale, or a sequencer that just came back online are all conditions UNICA v4 already computes
on-chain as a view (`oracleCondition()`, `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §6). The only
*additional* problem an automation product could solve is making that condition visible or actionable
**without waiting for a swap to attempt and reveal it** — i.e., a public monitor, not a new authority.

**Why Chainlink specifically, and a load-bearing correction.** VERIFIED, official: **Chainlink
Automation is past its own documented sunset as of this retrieval.** "Chainlink Automation v1.x
sunsets June 30, 2026. Chainlink Automation v2.1 sunsets July 31, 2026 (testnet: June 24, 2026)." —
OFFICIAL, <https://docs.chain.link/cre/reference/cla-migration-ts>, retrieved 2026-09-11 (a direct
verbatim fetch of the migration guide, not an inference). Every one of those dates is before today's
retrieval date. Whether the legacy Automation registries have actually stopped serving upkeeps on that
exact schedule was not independently checked here — no registry contract was probed on chain for this
file — but Chainlink's own documentation no longer presents "Automation" as the forward path: the
migration guide states the replacement shape directly, "a trigger (Cron or EVM Log) → off-chain logic
(replaces `checkUpkeep`) → a signed report written on-chain through the CRE `KeystoneForwarder` to an
`IReceiver` consumer, which then calls your execution function." So any new monitoring work should be
designed as a CRE cron/log-trigger workflow writing through the same `IReceiver` shape UNICA v4's
`ChainlinkCREAdapter` already specifies (§9), not as a fresh Automation upkeep registration.

**Trust assumptions.** Whichever shape is used, the same discipline the evidence file already states
for CRE applies: `msg.sender == FORWARDER` (never the simulation forwarder), the workflow id and owner
pinned in the receiver, replay blocked by a strictly-increasing observation time
(`docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §9). A monitor's report is exactly as trustworthy as any
other CRE report and no more — it is not a verified on-chain attestation by itself; a VerifierProxy
checks report signatures on chain for Data Streams, and no equivalent claim is made here for a plain
monitoring report.

**Failure mode.** A monitor that goes silent, stale, or wrong should degrade to "no alert shown," never
to a privileged action taken on stale information. This is exactly why the brief's own constraint —
"never unrestricted pause authority" — matters: PAUSER already exists in v4 as a role that can pause and
never unpause (Q65/Q70, ledger S2); handing an automated trigger the power to *call* pause turns a
monitoring convenience into a new denial-of-service surface (a false-positive alert now has the same
blast radius as a human pause decision, but with none of the judgment). The failure mode of a
*read-only* monitor is bounded to "someone was not notified promptly"; the failure mode of a
*pause-authorized* one is "the market stops without a human in the loop," which is a strictly worse
class of failure this brief explicitly rules out.

**On-chain authority.** PROPOSED: zero. A bounded design keeps the monitor's on-chain footprint to
either (a) a public view/log the workflow's report populates (a `StaleOracleObserved`-style event or a
public status field a UI reads), or (b) at most a call into `tightenOraclePolicy` — which by its own
construction can only ever move `maxAge`/`maxDeviationBps` **down**, never loosen, never touch
`adapter`/`feedId`/`enabled`, and is ADMIN-gated today (§3) — never a call into `pause`, which has no
such one-directional safety property once triggered.

**Privacy effect.** None; a monitor is only useful if its alert is visible.

**Demo value.** No dedicated ETHOnline 2026 track rewards Automation by itself (§1.1); given the sunset
finding above, framing a submission around "Automation" by name would also be describing a
product Chainlink's own docs no longer present as current.

**Implementation cost.** Not yet scoped past the shape above; a concrete cron/log-trigger workflow, its
`IReceiver` consumer, and its test suite do not exist today.

**Verdict: LATER.** The named product itself is not the right target to build against (past its own
sunset per official docs); the underlying problem (public visibility into a condition v4 already
computes) is real but not urgent, and the precondition to build well — deciding the exact bounded shape
in §4's "on-chain authority" row above, and choosing CRE cron/log triggers over the legacy product name
— is a design decision this file surfaces but does not resolve.

---

## 5. D — CCIP (cross-chain order or receipt)

**Necessary problem, checked against every UNICA v4/v5 document read for this file.** None is committed
today. UNICA v4's markets are single-chain by construction (`marketId` commits to a chain-scoped route,
`docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §2–§3); the sibling v5 streams treat a cross-chain shape only
as a **deferred** idea, never a committed one: the Graph stream's own demo-candidate table lists "Cross-chain
operations dashboard" as candidate D and separately notes it "matches UNICA's own longer-term v5 product
shape" — longer-term, not now (`docs/unica-v5/graph/DEMO-PLAN.md`); the ENS stream's own scalability
analysis names "cross-chain receipts" as the one shape where an off-chain-read tradeoff would ever be
worth making, and immediately qualifies it as a case "more likely once" a precondition that has not
happened occurs (`docs/unica-v5/ens/SCALABILITY.md`). Grep across every file under `docs/unica-v5/` and
`docs/unica-v4/` for "CCIP" or "cross-chain" found no design that commits to sending value or a
settlement-relevant message across chains today.

**Why Chainlink specifically, if the problem ever exists.** CCIP is the one live, general-purpose
cross-chain messaging product with a router already deployed on every chain UNICA v4 evidence covers
(46630's router at CA §5a); it would be the natural choice over a bespoke bridge for the same reasons
Chainlink's other products are chosen throughout this file — a shared, audited, multi-DON messaging
layer instead of a bespoke one.

**Trust assumptions and failure mode, already established by evidence.** CA §8 rule 8: "A
cross-chain-relayed price must be re-validated independently of the transport's own authentication."
CCIP proves who sent a message, never that the payload is correct or current; the (source-chain-selector,
sender) pair must be checked (never sender-address alone, since CREATE2/CREATE3 make identical addresses
across chains routine); the source's own timestamp must strictly increase to block replay and
out-of-order redelivery, since "exactly-once delivery is not the same as in-order delivery." CCIP transit
time is additive on top of whatever staleness a relayed value already carries — Chainlink's own
execution-latency page cites roughly 12–15 minutes for source-chain finality on an Ethereum-class PoS
chain before the committing DON even relays the message (CA §5b, citing
<https://docs.chain.link/ccip/ccip-execution-latency>).

**On why CCIP specifically does not solve the missing-feed problem.** CA §5b already establishes this
directly: none of Robinhood testnet's eight CCIP lane destinations carries a TSLA/USD or NFLX/USD
Chainlink Data Feed, and the one testnet that does carry a TSLA push feed (OP Sepolia) is not one of
those eight lane destinations at all — "a 'read a real feed on chain A, relay it over CCIP to an adapter
on 46630' design has no live TSLA source to relay from on any chain 46630's CCIP router can actually
reach." CCIP reachability is a fact about message transport, not about feed existence, and must never be
read as evidence toward the latter.

**On-chain authority, privacy effect.** N/A — no design exists to grade.

**Demo value.** No dedicated ETHOnline 2026 Chainlink track rewards CCIP by itself (§1.1).

**Implementation cost.** Not scoped; would require, at minimum, a genuine two-chain requirement (a
receipt or order provably needed on a second chain), a selector-keyed allowlist, and independent
re-validation of every relayed value per CA §8 rule 8 — none of which exists today.

**Verdict: REJECT, for now.** No necessary problem is identified in any committed UNICA v4 or v5
document; using CCIP without one would be exactly the anti-pattern this stream is asked to name and
avoid — a product added only to claim it (§6). This verdict flips to LATER only if a genuine
cross-chain order or receipt requirement is committed elsewhere (the Graph stream's deferred candidate D
is the only document that names a condition under which that could happen), and even then the design
would have to satisfy CA §8's re-validation rules from day one.

---

## 6. E — VRF (fair assignment, never randomness inside settlement)

**Necessary problem, checked against every UNICA v4/v5 document read for this file.** None is
identified. VRF is useful exactly when a system must choose fairly among multiple otherwise-equal
candidates — the brief names "fairly assign an auditor, facilitator or liquidity provider." No UNICA
document specifies a mechanism with more than one candidate to choose among: there is no auditor
registry, no facilitator pool, and no liquidity-provider rotation anywhere in `docs/unica-v4/` or
`docs/unica-v5/`. The ENS stream's `NAMESPACE.md` and `RECEIPT-NAMING.md` both use the word "auditor" —
but only as a party who *reads and verifies* a receipt after the fact, never as a role selected among
candidates. Separately, the ENS stream's own `IDENTITY-NFT.md` explicitly designs its identifier
derivation to admit **no** random input at all — "no salt, no nonce, no random seed" — for the same
reason UNICA v4's settlement is designed fail-closed and deterministic: a value that must be
independently recomputable and checkable cannot depend on an unpredictable input.

**Why Chainlink specifically, if the problem ever exists.** VRF's core property — a random value with
"cryptographic proof of how those values were determined," verified on chain before use, such that
"results cannot be tampered with or manipulated by any single entity including oracle operators, smart
contract developers, users, miners, or block builders" (OFFICIAL, <https://docs.chain.link/vrf>,
retrieved 2026-09-11) — is exactly what a fair multi-candidate selection needs and a naive
`blockhash`-based or off-chain "random" choice cannot offer, since both are influenceable by whoever
controls block construction or the off-chain process.

**Trust assumptions, failure mode.** VRF v2.5's subscription model requires funding "with either native
tokens or LINK," billed after fulfillment (OFFICIAL, same source); a request that is never fulfilled
(subscription underfunded, or the coordinator unavailable) simply never resolves, which for a selection
mechanism means whatever needed the pick stalls — a liveness failure, not a fund-safety one, provided
nothing settles before the pick resolves.

**On-chain authority, privacy effect.** N/A — no candidate mechanism exists.

**Demo value.** No dedicated ETHOnline 2026 Chainlink track rewards VRF by itself (§1.1), and
demonstrating VRF against a mechanism that does not exist would itself be the anti-pattern this stream
names: a product added only to claim it.

**Implementation cost.** Not scoped; would require, at minimum, an actual multi-candidate registry to
select among — a precondition this file finds does not exist.

**Verdict: REJECT.** No necessary problem exists in any committed document. The brief's own framing —
"never randomness inside deterministic settlement" — additionally forecloses the one place VRF might
otherwise have been tempting (any part of price, deviation, or payout computation), which UNICA v4
already keeps strictly deterministic and fail-closed by design.

---

## 7. F — Functions, compared against Confidential Workflows

**Necessary problem, and a load-bearing correction.** The brief asks for Functions to be compared
against Confidential Workflows "without duplicating responsibility." VERIFIED, official: **Chainlink
Functions is, like Automation, past its own documented sunset as of this retrieval.** "Chainlink
Functions sunsets June 30, 2026 (testnet: June 15, 2026)." — OFFICIAL,
<https://docs.chain.link/cre/reference/clf-migration-ts>, retrieved 2026-09-11 (direct verbatim fetch).
The stated replacement shape is the same family as Automation's: "a trigger (Cron, HTTP, or EVM Log) →
an HTTP fetch → a signed report written on-chain to an `IReceiver` consumer." So the live comparison
today is not "Functions vs. Confidential Workflows" as two current, equally-available products; it is
"a plain (non-confidential) CRE workflow vs. a Confidential Workflow" for whichever job is at hand.

**Why the comparison resolves without duplication.** The two answer different questions. A plain
workflow answers *is this off-chain data or computation reachable and reconcilable by DON consensus at
all* — useful for fetching a public value (e.g., an equity price, if a licensed source and CRE deploy
approval both existed, per `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §9's own unmet preconditions). A
Confidential Workflow answers *can this decision see something that must never become public* — the
merchant-policy problem product A exists for. Neither should ever stand in for product B's on-chain
adapter checks (§3) — "CRE replacing the on-chain oracle" is named explicitly in §8 as an integration to
avoid, and it applies to a plain workflow every bit as much as to a confidential one: a signed CRE
report reaching an `IReceiver` is, per `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §9, still subject to
the same fail-closed checks (forwarder identity, workflow id/owner pinning, chain-id match, strictly
increasing observation time) as any other adapter, never a trusted shortcut around them.

**The specific anti-pattern this axis exists to name.** Functions supports DON-managed secrets so a
workflow can hold, for example, an upstream API key without publishing it in source. That protects the
**credential**, not the **data or the computation** — the DON still executes the code and reconciles the
result across nodes, and the result is not enclave-protected. Calling that "confidential" would be
exactly the forbidden shape named in §8: **a workflow that hides only an API key.** Nothing in this
repository has made that claim; this section exists so nothing does.

**Trust assumptions, failure mode (of a plain workflow, for the data-fetching role it legitimately has).**
"The DON then aggregates all the independent return values from each execution... a minority of the
network cannot manipulate the response" (OFFICIAL, <https://docs.chain.link/chainlink-functions>,
retrieved 2026-09-11) — a BFT-style consensus property, materially better than one API call, but the
documentation is explicit that the requester owns the downstream risk: "You are responsible for
independently reviewing any code and API dependencies that you submit," and neither "Chainlink Labs,
the Chainlink Foundation, nor Chainlink node operators are responsible for unintended outputs... due to
issues in your code or downstream issues with API dependencies" (same source). A wrong or unavailable
result should fail the same way any adapter failure already must — closed, never substituted.

**On-chain authority.** None beyond what product B already grants any CRE-delivered report (§9's
checks) — never more, regardless of which product produced the report.

**Privacy effect.** None for Functions; positive only for the Confidential-Workflow side of the
comparison, which is product A.

**Demo value.** No dedicated ETHOnline 2026 track rewards Functions by itself, and building against a
sunset product to chase one would be building against the wrong target.

**Implementation cost.** N/A as a standalone build; the comparison's output is a routing rule (below),
not a new artifact.

**Verdict: REJECT Functions as a standalone product** (sunset, no confidentiality guarantee, and any
legitimate role it had is now the plain-CRE-workflow path). **The comparison itself is resolved, not
deferred:** privacy-needing logic routes to product A; public-data-needing logic, if ever built, routes
to a plain CRE workflow under product B's existing fail-closed adapter discipline — never to a
CRE-as-oracle shortcut, and never to a workflow whose only protected element is a credential.

---

## 8. Integrations to avoid, named explicitly

PROPOSED, cross-checked against every verdict above.

| Anti-pattern | Where this file's verdicts avoid it |
|---|---|
| A workflow that merely calls `pay()` | Product A's workflow returns a verdict enum only; it never holds a role that can call a settlement function, and the executor path is unchanged by anything in this file |
| One that hides only an API key | Named explicitly in §7 as the failure mode Functions-as-"confidential" would be; product A's own leak tests already check for more than credential-hiding |
| A model choosing a price | Not proposed anywhere in this file; product B's price comes only from a pinned Chainlink adapter, never an inference |
| CRE replacing the on-chain oracle | Named explicitly in §7; every CRE-delivered report, confidential or not, is still subject to product B's existing fail-closed checks (§9 of the oracle spec) |
| An unenforced fraud score | Product A's verdict is advisory by explicit design rule (§2, "on-chain authority") — it can refuse an *attempt*, never validate one, so there is nothing here that could be an unenforced score standing in for enforcement |
| Automation with unbounded pause authority | Named explicitly in §4 as the reason a monitor's on-chain footprint is proposed at zero, or at most a strictly-tightening call, never a `pause` call |
| Confidential logic whose output can redirect funds | Structurally excluded by product A's own schema (`additionalProperties:false`, no address or recipient field) and by the design rule quoted in §2 |
| Any product added only to claim it | Products C, D, E and F are each REJECT or LATER precisely because no necessary problem was found for them today — see each section's first paragraph |

---

## 9. Unknowns

Stated honestly; none of these is resolved by anything read for this file.

- Whether Confidential Workflows enrollment has been granted for the account this repository would use
  for the settlement-policy subject (product A) — UNKNOWN; the only enrollment-adjacent evidence found
  is for the *separate* liquidation-protection subject, where Deploy Access read **not enabled** and an
  access request was awaiting review as of 2026-09-08 (`docs/feedback/chainlink.md`).
  Enrollment and Deploy Access are documented as distinct gates (simulation needs only an account login;
  deployment needs Early Access approval, `docs/v2/CRE-CONFIDENTIAL-WORKFLOW.md`), so a resolution to
  one does not resolve the other.
- Whether the legacy Chainlink Automation and Functions registries/routers have actually stopped
  accepting new registrations or requests on the documented sunset dates, versus continuing to serve
  existing subscriptions past them — UNKNOWN; no registry or router contract was probed on chain for
  this file, and the finding above rests on Chainlink's own migration-guide dates, not a live check.
- Whether any future UNICA v5 design commits to a genuine cross-chain order or receipt requirement (the
  precondition that would move product D from REJECT to LATER) — UNKNOWN; the Graph stream's own demo
  plan treats it as a longer-term shape, not a committed one, as of this retrieval.
- Whether a licensed equity-price source reachable through CRE's HTTP capability exists at a cost and
  license UNICA could use (a precondition already named as unmet in `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md`
  §9, "Q23," and relevant to product F's plain-workflow role) — UNKNOWN, unchanged by this file.
- Whether the Best Confidential Workflow track's $1,000-per-team structure ("up to 2 teams") means a
  fixed number of awards regardless of entrant count, a per-category split, or something else — UNKNOWN;
  the prize page's own wording was quoted verbatim in §1.1 and not interpreted further.
- Whether Robinhood Chain testnet (46630) will ever carry a Data Feed for TSLA or NFLX — explicitly
  left open by the evidence file itself (CA §9) and not re-litigated here.

---

## Sources referenced

| URL | Retrieved | Author/organization | Kind | Used for |
|---|---|---|---|---|
| `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` (repository) | 2026-09-11 | this repository | TEAM GUIDANCE | product B's full specification, cited not reopened |
| `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (repository) | 2026-09-11 | this repository | TEAM GUIDANCE (primary sources cited within it are OFFICIAL) | chain-46630/4663/42161 facts throughout §1–§7 |
| `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (repository) | 2026-09-11 | this repository | TEAM GUIDANCE | trust-boundary rule quoted in §2 |
| `docs/v2/CRE-CONFIDENTIAL-WORKFLOW.md` (repository) | 2026-09-11 | this repository | TEAM GUIDANCE | guardian-subject TEE run, toolchain fix, enrollment/Deploy-Access distinction |
| `docs/v2/SECURITY-ADVISORY-001.md` (repository) | 2026-09-11 | this repository | TEAM GUIDANCE | the binding-vs-advisory framing used against every product |
| `docs/feedback/chainlink.md` (repository) | 2026-09-05, 2026-09-08, 2026-09-11 entries | this repository | TEAM GUIDANCE | prior scoping decision, liquidation-protection challenge findings, bun-version defect |
| `integrations/chainlink-cre-robinhood/README.md`, `policy.mjs`, `schemas/workflow-result.public.json` (repository) | 2026-09-11 | this repository | TEAM GUIDANCE | product A's existing decision logic and design rule |
| `docs/unica-v5/graph/DEMO-PLAN.md` (repository) | 2026-09-11 | sibling stream, cited not edited | TEAM GUIDANCE | product D's deferred-not-committed cross-chain candidate |
| `docs/unica-v5/ens/SCALABILITY.md`, `NAMESPACE.md`, `RECEIPT-NAMING.md`, `IDENTITY-NFT.md` (repository) | 2026-09-11 | sibling stream, cited not edited | TEAM GUIDANCE | products D and E's "no committed mechanism found" findings |
| <https://docs.chain.link/cre/concepts/confidential-workflows> | 2026-09-11 | Chainlink (Chainlink Labs / smartcontractkit documentation) | OFFICIAL | product A's protection scope, TEE/attestation model, enrollment status |
| <https://docs.chain.link/cre/reference/cla-migration-ts> | 2026-09-11 | Chainlink | OFFICIAL | Automation sunset dates and CRE replacement shape (product C) |
| <https://docs.chain.link/cre/reference/clf-migration-ts> | 2026-09-11 | Chainlink | OFFICIAL | Functions sunset dates and CRE replacement shape (product F) |
| <https://docs.chain.link/chainlink-automation> | 2026-09-11 | Chainlink | OFFICIAL | Automation trigger types, funding, registry/forwarder shape |
| <https://docs.chain.link/chainlink-automation/overview/supported-networks> | 2026-09-11 | Chainlink | OFFICIAL | confirms Arbitrum One listed, Robinhood Chain (testnet or mainnet) absent |
| <https://docs.chain.link/vrf> | 2026-09-11 | Chainlink | OFFICIAL | VRF v2.5 model, subscription funding, tamper-resistance property (product E) |
| <https://docs.chain.link/vrf/v2-5/supported-networks> | 2026-09-11 | Chainlink | OFFICIAL | confirms Arbitrum One listed, Robinhood Chain absent |
| <https://docs.chain.link/chainlink-functions> | 2026-09-11 | Chainlink | OFFICIAL | Functions DON-consensus model, self-responsibility clause (product F) |
| <https://docs.chain.link/cre/supported-networks-ts.md> | 2026-09-11 | Chainlink | OFFICIAL | CRE's Arbitrum One (mainnet) and Robinhood Testnet (not mainnet) listings |
| <https://docs.chain.link/ccip/ccip-execution-latency> | 2026-09-11 | Chainlink | OFFICIAL | cross-chain transit-latency figure cited via CA §5b (product D) |
| <https://ethglobal.com/events/ethonline2026/prizes> | 2026-09-11 | ETHGlobal | OFFICIAL (event organizer, prize wording verbatim) | §1.1 track pools, types, and eligibility wording |
