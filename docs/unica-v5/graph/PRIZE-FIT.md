# UNICA v5 / The Graph — prize fit

Engineering record. Track: **From Scratch** (confirmed by the owner, 2026-09-11; earlier drafts
that said Continuity are wrong and are superseded by this line). Retrieval date for every claim
below is 2026-09-11 unless a claim states otherwise. Labels: VERIFIED (source cited), PROPOSED
(UNICA design choice, not a claim about the sponsor), UNKNOWN.

This file is forward design for **UNICA v5** (the dashboard generation, per the owner's
2026-09-11 release-naming ruling). It does not replace, edit, or contradict the already-submitted
Graph integration recorded in `docs/SPONSOR-ELIGIBILITY.md` §3 and built under
`integrations/graph/` (V1 receipt subgraph, deployed and synced on Ethereum Sepolia) and
`integrations/graph-v2/` (invoice-settlement subgraph, undeployed). This file evaluates a
**second, distinguishable** Graph submission-shape — a verification MCP tool over live indexed
data — against the prize page as it reads today, and states plainly where it depends on
UNICA v4 work that is **SPECIFIED-NOT-BUILT**.

## 1. Scope and relationship to existing UNICA work

VERIFIED (repository). Two Graph integrations already exist and are already disclosed:

| Integration | Location | Status, per `docs/SPONSOR-ELIGIBILITY.md` (dated 2026-09-05, 2026-09-09) |
|---|---|---|
| V1 receipt subgraph | `integrations/graph/` | Deployed and synced on Ethereum Sepolia; `hasIndexingErrors: false`; one `Settlement` entity returned matching a raw log |
| Invoice-settlement subgraph | `integrations/graph-v2/` | Manifest, schema, mappings and deterministic entity ids written; undeployed — blocked on a Subgraph Studio deploy key, not on code |

VERIFIED (repository, `integrations/graph/schema.graphql`, `subgraph.yaml`, per the research
brief). The V1/V3 subgraph has exactly one entity, `Settlement` (immutable), populated by one
event handler on one ABI (`V4SettlementHook`) across two data sources — the V1 hook at address
`0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` (start block 11639895) and the V3 hook at address
`0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0` (start block 11667702) — both on Ethereum Sepolia.
This ABI emits `SettlementReceipt` alone; it has no paired second event from a separate executor
contract, so a subgraph reading it cannot today do hook-to-executor cross-event matching. That
capability is a **UNICA v4** design (`docs/unica-v4/EVENT-SCHEMA.md` §5–§6, §10.2), not something
the currently deployed contracts emit. §7 of this file states what that gap means for the demo
plan.

PROPOSED (UNICA design). This research stream evaluates one additional, narrower submission
shape for the same sponsor: an MCP tool, `unica_verify_receipt`, that answers VERIFIED / REFUSED /
UNKNOWN for a settlement, backed by a live Graph-indexed subgraph, with the reasoning that
appears in `docs/unica-v5/graph/DEMO-PLAN.md`. Nothing here authorizes deploying it, and nothing
here asserts it as already built.

## 2. ETHGlobal prize page, as worded today

VERIFIED — <https://ethglobal.com/events/ethonline2026/prizes>, retrieved 2026-09-11 (fetched
directly; individual quotes below are verbatim from that retrieval). The Graph lists **$15,000**
across three tracks, each 1st/2nd/3rd at $2,500/$1,500/$1,000:

| Track, as titled on the page today | Pool | Prize |
|---|---|---|
| Best Use of Composable or Standardized Graph Products | one pool, no From Scratch/Continuity split | $5,000 |
| Best AI Tooling or AI Use Case with The Graph | **From Scratch** | $5,000 |
| Best AI Tooling or AI Use Case with The Graph | **Continuity** | $5,000 |

**Track 1 — Composable or Standardized Graph Products**, quoted:
> "Build on The Graph's composable and standardized data products" using "standardized subgraphs,
> Substreams packages, or the Subgraph MCP layer."
> "Either compose two or more of The Graph's products, or build meaningfully on a standardized
> schema."
> "Consume live data from a Graph provider... Mocked, local-only, or static datasets do not
> qualify."
> "Simply querying one Subgraph with no composition or standardization does not qualify."
> "Authoring or extending a Standardized Subgraph, or contributing a reusable composable
> Substreams module, is in scope." "Make the standards leverage clear: show what became easier."
> "Submit a public repository and a short demo video (two to four minutes)."

**Track 2 — AI Tooling or AI Use Case, From Scratch**, quoted:
> Rewards "both the tooling that makes The Graph easier to use from AI environments like Claude,
> Cursor, and ChatGPT" and "the AI agents or apps that use The Graph as their live source of
> blockchain data."
> Featured, optional challenge: "Use the Substreams SKILLs to go from a single natural-language
> prompt to a working, deployed Substreams pipeline." (UNICA's plan does not pursue this challenge;
> noted here so its absence is a choice, not an oversight.)
> Pool definition, From Scratch: "Projects begun and built during the hackathon. Open-source
> starter kits are fine; project-specific prior code is not."
> "Use The Graph as a load-bearing part of the project." "Consume live data from a Graph
> provider... Mocked, local-only, or static datasets do not qualify." "Do meaningful work with the
> data: reasoning, decisions, automation, or a natural-language interface." "Tooling submissions
> must be reusable infrastructure, not a single end-user app." "Open-source the code with a clear
> README or SKILL.md." "Submit a public repository plus a short demo video (two to four minutes)."
> "Select the pool that matches how you built: Start Fresh for net-new."

**Track 3 — AI Tooling or AI Use Case, Continuity** — identical requirements, pool definition:
> "Projects that extend an existing open-source repo or ship a new feature on an existing product.
> Document the pre-existing work; only work done during the event is judged."

Not applicable to this submission: the owner's 2026-09-11 ruling fixes UNICA to **From Scratch**.
Track 3 is recorded here only so the page's own three-way split is not silently flattened to two.

**Difference from what was assumed going in.** The research brief for this file referred to "any
AI tooling or AI use-case pool" and "any composable or standard Graph products pool" in the
singular. The page's actual wording is **Composable or Standardized Graph Products** (not
"standard") for track 1, and the AI track is **one track name split into two pools** (From
Scratch, Continuity), each carrying the full $5,000 structure independently — not one $5,000 pool
with a sub-selector. Per the rule that the page wins, this file uses the page's wording throughout.

**Dated wording drift, noted rather than hidden.** `docs/SPONSOR-ELIGIBILITY.md` (dated retrieved
2026-09-05) quotes the AI track's live-data rule as *"Must consume live data via API keys or
Graph Market streaming."* Today's retrieval (2026-09-11) reads *"Consume live data from a Graph
provider... Mocked, local-only, or static datasets do not qualify,"* with no mention of API keys
or Graph Market by name. **Conflict, recorded:** either the page's wording changed between
2026-09-05 and 2026-09-11, or the two retrievals paraphrased the same clause differently; nothing
here can distinguish those two explanations. Practically the newer wording is the more permissive
of the two readings — a subgraph deployed and synced on Subgraph Studio, queried over its GraphQL
endpoint, satisfies "live data from a Graph provider" under either wording, so the drift does not
change this file's eligibility conclusions.

## 3. The Graph's categories, classified against UNICA v5

VERIFIED / PROPOSED, combined.

- **Track 2 (AI Tooling or AI Use Case, From Scratch)** is a direct fit for the design in
  `DEMO-PLAN.md`: an MCP tool is explicitly named as one of the track's target artifact shapes
  ("tooling that makes The Graph easier to use from AI environments"), and a verification agent
  that reads a live subgraph and reasons to a verdict is explicitly named as the other
  ("AI agents or apps that use The Graph as their live source of blockchain data"). UNICA's design
  can be built to satisfy either framing, and the two are not mutually exclusive under the page's
  own wording — see §4.
- **Track 1 (Composable or Standardized Graph Products)** is a **possible, not a settled**, second
  submission. UNICA's `Settlement` entity is a bespoke schema, not one of The Graph's published
  Standardized Subgraphs (Messari's schema is the named example resource on the prize page), so
  the "build meaningfully on a standardized schema" branch does not apply as designed today. The
  "compose two or more of The Graph's products" branch turns on an unresolved design question —
  whether calling The Graph's own hosted Subgraph MCP server (rather than hand-rolling a GraphQL
  client against the same subgraph) counts as composing "a subgraph" with "the Subgraph MCP layer"
  as two distinct products. The page's own disqualifier — "simply querying one Subgraph with no
  composition or standardization does not qualify" — is worded broadly enough to catch a
  hand-rolled query and is silent on whether routing that same query through the official MCP
  server changes the answer. See `MENTOR-QUESTIONS.md` Q2. This is the pivot point of Track 1
  eligibility and is not resolved by public documentation alone.
- **Track 3 (Continuity)** does not apply; the owner fixed From Scratch on 2026-09-11.

## 4. Strongest eligible category

**Best AI Tooling or AI Use Case with The Graph — From Scratch.** This is a classification, not a
claim that eligibility is settled — no Graph team member has confirmed in writing that the
planned artifact qualifies, and §12 carries that open question forward rather than resolving it
here. What is VERIFIED is the textual match between the page's own wording and the design, for
three reasons each traceable to that wording (§2): UNICA v5's planned artifact is explicitly both
named shapes at once — a reusable MCP tool (`unica_verify_receipt`) that is also, when driven by
an agent loop, "an AI agent... that uses The Graph as its live source of blockchain data"; it does
"meaningful work with the data" in the page's own sense (a reasoned VERIFIED/REFUSED/UNKNOWN
verdict with a reason code is a decision, not a display of raw fields); and the load-bearing test
is satisfied by construction — remove the subgraph query and the tool has no verdict to return.
The whole UNICA repository's provenance (`docs/PROVENANCE-LEDGER.md`) already establishes the
From Scratch pool's own qualifying fact: **VERIFIED**, repository genesis is 2026-09-04 (four
hours after this event's build window opened), zero commits precede the window, and this is
independently re-checkable with `git log`.

## 5. Second-best eligible category

**Best Use of Composable or Standardized Graph Products** — PROPOSED as a candidate, not claimed
as met. It becomes eligible only if the implementation deliberately composes two Graph products
(§3) rather than querying one custom subgraph directly. This is a design choice available to the
owner, not a property of the plan as scoped in `DEMO-PLAN.md` today. Per §1's general ETHGlobal
finding (§9), applying to both of The Graph's tracks costs only one of UNICA's three
partner-prize slots (a partner with multiple tracks counts once), so pursuing both is not
structurally blocked — it is blocked only on the Track 1 design question in §3.

## 6. Why UNICA fits

- **Load-bearing, not decorative.** The verification verdict has no other input; deleting the
  subgraph query deletes the feature, which is the page's own test for "load-bearing."
- **Fail-closed by construction, which is also UNICA's own house rule.** The research brief's
  standing instruction — "an indexing failure must never create, authorize, or settle a payment"
  and "any UNKNOWN fails closed for value-moving behaviour" — is not a constraint invented for
  this prize; it restates what `docs/unica-v4/EVENT-SCHEMA.md` §2 already requires of every UNICA
  consumer ("Current state is not history... an indexer never supplies current status") and what
  Security Advisory 001 (`docs/v2/SECURITY-ADVISORY-001.md`) is a case study in the cost of
  *not* doing: an authorization that does not bind the counterparty's half of a deal is exactly
  the shape of bug a verification layer exists to catch before it reaches a payer.
- **A real emitter-authentication problem, not an invented one.** `docs/unica-v4/EVENT-SCHEMA.md`
  §2 states as a design fact that "anyone can deploy the same hook source through their own
  factory and emit a `SettlementReceipt` with an official `marketId`." A verification tool whose
  job is to tell a legitimate receipt from a look-alike one is answering a question UNICA's own
  specification already says is real, not a demo contrivance.
- **A natural MCP shape.** One GraphQL query, one verdict, one set of reason codes — small enough
  to specify precisely, which is what the Track 2 "reusable infrastructure, not a single end-user
  app" requirement rewards.

## 7. What must be built during the event

PROPOSED, with the buildable-today path separated from the v4-dependent path per the research
brief's instruction to correct the given build order where the evidence disagrees. Today is
2026-09-11; ETHOnline 2026 runs through 2026-09-16 (VERIFIED, ETHGlobal event page) — five days
of runway from this file's retrieval date.

**Buildable today, on already-live infrastructure, no new contract and no owner G0 needed:**
1. A reason-code verification layer over the **already deployed and synced** `integrations/graph/`
   V1/V3 subgraph: VERIFIED when a `Settlement`'s `hook` field matches a pinned allow-list of
   registered hook addresses; REFUSED when a well-formed `SettlementReceipt`-shaped log exists
   from an address not on that list (an adversarial fixture built and run locally only, never
   broadcast, per the research brief's constraint); UNKNOWN when the query cannot be answered
   (indexer lag, a malformed id, a network error) — UNKNOWN must never render as VERIFIED.
2. One GraphQL query exposing that verdict plus its reason code and the queried block, wrapped in
   one MCP tool, `unica_verify_receipt`.
3. One judge-facing screen showing a legitimate and a look-alike receipt side by side, each with
   its verdict and the block the answer was read at.
4. Failure-mode measurement: the same query with the endpoint disabled, and under simulated
   indexer lag, each producing UNKNOWN rather than a false VERIFIED.

**Depends on UNICA v4 (SPECIFIED-NOT-BUILT, blocked on the owner's G0 per
`docs/unica-v4/EVENT-SCHEMA.md` §1) and is out of this event's realistic scope unless G0 is
granted early:** true hook-to-executor pairing (`SettlementReceipt` matched against a separate
`Settled` event, `docs/unica-v4/EVENT-SCHEMA.md` §6.2), the registry-based emitter authentication
of §2 of that file, and the v4 subgraph proposed at `integrations/graph/unica-v4/` (§10.2 of that
file). Building this path this week additionally requires implementing `UnicaMarketRegistry`,
`UnicaMarketFactory`, `UnicaMarketHook` and `UnicaMarketExecutor` from `docs/unica-v4/
SPEC-CONTRACTS.md`, then deploying and seeding a market on a supported chain — a multi-day
sequence with its own gates, not a same-week addition to a Graph submission.

**Recommendation, stated plainly:** scope the event submission to the buildable-today path. It
already demonstrates the load-bearing, fail-closed, emitter-authentication story the prize
rewards, using data that is live today rather than data that depends on a separate, larger,
not-yet-authorized release.

## 8. What pre-existing work must be disclosed

VERIFIED (repository) / PROPOSED (how to disclose it here). Per `docs/PRIOR-ART.md` and
`docs/PROVENANCE-LEDGER.md`, the entire UNICA repository began inside this event's build window
(2026-09-04), so none of it is "project-specific prior code" that predates the hackathon in the
sense the From Scratch pool definition means. What must still be named, honestly, in any Track 2
submission built from this design:

1. **The V1/V3 subgraph and its live deployment already exist** and were built earlier in this
   same event window (`integrations/graph/`, disclosed in `docs/SPONSOR-ELIGIBILITY.md` since
   2026-09-05). A new submission reusing that subgraph as its data source is extending
   already-built-this-event infrastructure, not writing a subgraph from nothing; say so in the
   submission text rather than presenting the indexed history as newly produced this week.
2. **Two documents predate the event entirely**: `specs/HOOK-SPEC.md` and `specs/THREAT-MODEL.md`
   (`docs/PROVENANCE-LEDGER.md`). Neither is code and neither is Graph-specific, but both are named
   in the README and `specs/` per the project's standing disclosure rule, and that disclosure
   should be repeated wherever this submission's provenance is described.
3. **UNICA v4's specifications are pre-written design, not pre-written code.**
   `docs/unica-v4/EVENT-SCHEMA.md` and `SPEC-CONTRACTS.md` exist today as documents; if any part of
   the v4-dependent path in §7 is attempted, the submission must state that the specification
   predates the implementation and that the implementation, if any, was written during the event.
4. **Prior art named in `docs/PRIOR-ART.md`** (carried-in Vyper files, the Vyper settlement-hook
   prototype) is unrelated to the Graph integration and touches no file this stream would produce,
   but the file's own rule — disclose rather than hide — applies to this stream too if that
   changes.

## 9. Public-repository requirements

VERIFIED — every track quoted in §2 requires "a public repository" and "a short demo video (two
to four minutes)"; Track 2 additionally requires "Open-source the code with a clear README or
SKILL.md." UNICA's repository is already public and MIT-licensed (`CLAUDE.md`, `LICENSE`), so the
public-repository requirement is met by the repository as a whole; the specific files this stream
would add (an MCP tool, a query, a fixture) need their own README or SKILL.md section, not a
repository-wide change. VERIFIED (§8 above, "up to 3 Partner Prizes... a partner with multiple
tracks counts once") — ETHGlobal's own submission flow lets one public repository be submitted
once and evaluated against multiple partner tracks, so no second repository or fork is implied by
also targeting Track 1.

## 10. Required live Graph dependency

VERIFIED, both tracks: "Consume live data from a Graph provider... Mocked, local-only, or static
datasets do not qualify" (§2). PROPOSED, how UNICA meets it: the verification query reads the
already-deployed, already-synced Sepolia subgraph in `integrations/graph/` over its live GraphQL
endpoint — Ethereum Sepolia is a network The Graph documents as supported
(<https://thegraph.com/docs/en/supported-networks/sepolia/>, CAIP-2 `sepolia`, chain id
`eip155:11155111`, retrieved 2026-09-11), and a subgraph deployed to Subgraph Studio against a
supported network is squarely "a Graph provider" under any reading of the wording in §2. This
dependency must remain load-bearing through the demo: the failure-mode measurement in §7 item 4
exists specifically to show the verdict degrade to UNKNOWN, never to a fabricated VERIFIED, when
that live dependency is unavailable.

## 11. Eligibility risks

1. **Partner-prize slot competition.** VERIFIED, §9: a submission may select "up to 3 Partner
   Prizes." `docs/SPONSOR-ELIGIBILITY.md` already lists three other submitted integrations
   (Uniswap, ENSv2, The Graph) plus Arc as a fourth track pursued — more sponsor tracks than the
   3-slot ceiling if Arc, Uniswap, ENS and both Graph tracks (§5) are all pursued at once. This is
   an owner-level portfolio decision, not something this file resolves; it is named here because
   it directly bears on whether pursuing Track 1 (§5) alongside Track 2 is worth the slot.
2. **Two Graph submissions from one team, same event.** The existing (already-partially-live)
   Track-2 candidate described in `docs/SPONSOR-ELIGIBILITY.md` §3 (the deterministic treasury
   analyst over `integrations/graph-v2/`) and the MCP-verification design in this file are two
   different artifacts that could both plausibly be pointed at the same $5,000 From-Scratch pool.
   Nothing retrieved states whether ETHGlobal or The Graph judges a project once per pool or would
   treat two distinct feature branches as competing submissions from the same team. **Needs
   written confirmation** — carried to `MENTOR-QUESTIONS.md`.
3. **Track 1's "composition" test is genuinely ambiguous** for a design that queries one custom
   subgraph via a hand-built MCP tool (§3, §5). Building against the wrong reading wastes the
   partner-prize slot in §11.1 on a submission that a judge could rule "simply querying one
   Subgraph."
4. **A demo that leans on v4 language risks describing unbuilt contracts as live.** Every UNICA v4
   event in `docs/unica-v4/EVENT-SCHEMA.md` is SPECIFIED-NOT-BUILT; a submission that shows v4
   event names or v4 entity shapes without the qualifier invites exactly the "misrepresenting
   pre-existing or unbuilt work" risk `docs/PROVENANCE-LEDGER.md` exists to avoid. §7's
   recommendation to scope to the buildable-today path removes this risk entirely rather than
   managing it.
5. **The demo video length ceiling is two to four minutes** (§2, all three tracks) — a hard
   constraint on how much of the VERIFIED/REFUSED/UNKNOWN story, the MCP tool, and the
   side-by-side screen can be shown; this is a production constraint for `DEMO-PLAN.md`, not an
   eligibility gap, but it is recorded here because a submission that cannot fit its load-bearing
   proof inside four minutes risks being judged on the wrong evidence.

## 12. What needs written confirmation from an identifiable Graph team member

Carried in full, with citations, to `docs/unica-v5/graph/MENTOR-QUESTIONS.md`. Summarized here:
whether an MCP refusal tool qualifies (§4 argues yes from the page's own wording, but no Graph
team member has confirmed this reading in writing); whether a hand-rolled query plus a custom MCP
tool is "composition" for Track 1 (§3, §5); whether two feature-branch submissions from one
repository against the same pool are treated as one project or as competing (§11.2); and the two
network-support questions in §13/`MENTOR-QUESTIONS.md` Q3–Q5 (self-hosted indexing on a chain
absent from the supported-networks registry). Until answered in writing by an identifiable Graph
team member, none of these is claimed as settled.

## 13. Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ETHOnline 2026 prizes page | https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 | ETHGlobal | OFFICIAL | §2, §5, §9, §10, §11 — exact track wording, prize amounts |
| ETHOnline 2026 info/details | https://ethglobal.com/events/ethonline2026/info/details | 2026-09-11 | ETHGlobal | OFFICIAL | §11 — the Classic-track pre-event-code rule ("won't qualify for partner prizes or the Finalist category"); event date range 2026-09-04 to 2026-09-16 |
| ETHGlobal partner-prize selection rule (via search summary of ETHGlobal event pages) | https://ethglobal.com/events/ethonline2026/prizes and prior ETHGlobal event info pages | 2026-09-11 | ETHGlobal | OFFICIAL | §9, §11.1 — "up to 3 Partner Prizes," multi-track-one-partner-one-slot rule |
| The Graph — Supported Networks, Sepolia | https://thegraph.com/docs/en/supported-networks/sepolia/ | 2026-09-11 | The Graph | OFFICIAL | §10 — Sepolia is a supported network |
| The Graph — AI Suite overview | http://thegraph.com/docs/en/ai-overview/ | 2026-09-11 | The Graph | OFFICIAL | §2, §6 — Subgraph MCP and Agent Skills as named AI Suite components |
| `docs/SPONSOR-ELIGIBILITY.md` (this repository) | n/a — local file | 2026-09-05, updated 2026-09-09 | UNICA / NFTeria | TEAM GUIDANCE | §1, §2 (wording-drift conflict), §8, §11.2 — the already-disclosed Graph submission |
| `docs/PROVENANCE-LEDGER.md` (this repository) | n/a — local file | 2026-09-08 (file date); re-derivable any time | UNICA / NFTeria | TEAM GUIDANCE | §4, §8 — from-scratch provenance facts |
| `docs/unica-v4/EVENT-SCHEMA.md`, `SPEC-CONTRACTS.md` (this repository) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §1, §6, §7, §11.4 — v4 event surface, SPECIFIED-NOT-BUILT status |
| `docs/v2/SECURITY-ADVISORY-001.md` (this repository) | n/a — local file | 2026-09-08 | UNICA / NFTeria | TEAM GUIDANCE | §6 — the counterparty-binding failure mode a verification layer is meant to catch |

## 14. Unknowns

1. Whether a hand-rolled GraphQL client plus a custom MCP tool over one bespoke subgraph counts as
   "composing two or more of The Graph's products" for Track 1, or is caught by the "querying one
   Subgraph" disqualifier (§3, §5) — not settled by the page text retrieved.
2. Whether two distinct feature-branch submissions from the same public repository, both aimed at
   the same From-Scratch AI-tooling pool in the same event, are treated as one project judged once
   or as competing submissions (§11.2) — not addressed in any source retrieved.
3. Whether the AI-track wording drift between the 2026-09-05 retrieval ("API keys or Graph Market
   streaming") and the 2026-09-11 retrieval ("a Graph provider") reflects an actual page edit or
   two different paraphrases of stable underlying text — the retrieval method used here cannot
   distinguish the two, and no page-revision history was consulted.
4. Whether ETHGlobal or The Graph would view reusing the already-deployed `integrations/graph/`
   subgraph (built earlier in this same event window) as sufficiently "load-bearing new work" for
   a Track 2 submission whose new artifact is the verification layer on top of it, rather than the
   subgraph itself — the page's wording supports this reading (§4) but no team member has
   confirmed it.
5. Whether pursuing both Track 1 and Track 2 is worth the shared partner-prize slot given UNICA's
   other sponsor commitments (§11.1) — an owner portfolio decision, not a fact this research can
   settle.
6. The exact current chain id and mainnet/testnet status of the network The Graph's own
   `supported-networks/arc/` page (CAIP-2 `arc`, chain id `eip155:5042`, linking to
   `docs.arc.network`) documents. It is **not** Circle's Arc network that UNICA integrates
   elsewhere in this repository (`docs/ARC-FACTS.md`: Circle's Arc has chain id `5042002` and is
   documented at `docs.arc.io` as testnet-only). This is a name collision between two unrelated
   networks both called "Arc," not a fact about Circle's Arc; it is recorded here so it is never
   read backwards into a claim that Circle's Arc has a Graph-supported mainnet. Full detail and
   the related Robinhood-network findings are in `MENTOR-QUESTIONS.md` Q3.
