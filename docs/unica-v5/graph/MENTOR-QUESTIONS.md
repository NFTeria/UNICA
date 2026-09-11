# UNICA v5 / The Graph — mentor questions, answered from public sources first

These six questions are answered here from official sources wherever the sources settle them.
Nothing here is a question sent to a person; each is closed with a citation or left open, marked
as needing written confirmation from an identifiable Graph team member, per project rule. Track:
**From Scratch** (confirmed 2026-09-11). Retrieval date 2026-09-11 unless stated otherwise. Labels:
VERIFIED (source cited), PROPOSED (UNICA design reasoning), UNKNOWN.

## Q1. Does an MCP or AI refusal tool consuming a live subgraph qualify for the AI tooling or AI use-case pool?

**Answered from the page's own wording: yes, on the evidence available, but not yet confirmed by
a Graph team member.**

VERIFIED — the ETHOnline 2026 prizes page (retrieved 2026-09-11) names both shapes explicitly as
in-scope for this one track: "both the tooling that makes The Graph easier to use from AI
environments like Claude, Cursor, and ChatGPT" and "the AI agents or apps that use The Graph as
their live source of blockchain data." An MCP tool that answers a verification question is the
first shape; an agent that consumes that tool's verdict and refuses to proceed on REFUSED or
UNKNOWN is the second. The page also requires the data be live ("Consume live data from a Graph
provider... Mocked, local-only, or static datasets do not qualify") and requires meaningful work
with it ("reasoning, decisions, automation, or a natural-language interface") — a REFUSE/PROCEED
decision is a decision in the page's own sense, not a passthrough display of raw fields.

One requirement needs a build choice, not a confirmation: "Tooling submissions must be reusable
infrastructure, not a single end-user app." `unica_verify_receipt` as one MCP tool, callable by any
MCP-capable agent against any UNICA-registered hook address (not hard-coded to one demo
transaction), reads as reusable infrastructure under this wording; a build that hard-codes the demo
receipt would not.

**What is not settled:** no Graph team member has confirmed in writing that this specific shape —
a refusal/verification tool over a bespoke (non-standardized) subgraph — satisfies the track,
as distinct from what the page's text implies. **Needs written confirmation.**

## Q2. For composable or standard Graph products, is a standard subgraph plus an MCP consumer sufficient, or are multiple Graph products expected?

**Not settled by public documentation. This is the one question in this file that turns entirely
on wording the page does not resolve.**

VERIFIED — the page's requirement (retrieved 2026-09-11): "Either compose two or more of The
Graph's products, or build meaningfully on a standardized schema," and, separately, "Simply
querying one Subgraph with no composition or standardization does not qualify." The page's list of
qualifying products for this track is "standardized subgraphs, Substreams packages, or the
Subgraph MCP layer" — three named things, one of which is explicitly "the Subgraph MCP layer"
itself.

PROPOSED reasoning, not a confirmed answer: a bespoke (non-standardized) subgraph queried by a
hand-rolled GraphQL client is, on the page's own words, "querying one Subgraph with no composition"
— disqualified. The open question is whether routing that same query through **The Graph's own
hosted Subgraph MCP server** (VERIFIED to exist: <http://thegraph.com/docs/en/ai-overview/>,
retrieved 2026-09-11, "The Subgraph MCP server connects models to Subgraphs on The Graph
Network") — rather than a hand-built client — converts "one subgraph" into "a subgraph composed
with the Subgraph MCP layer," i.e., two of the three named products. The page's wording does not
say either way, and no example submission or FAQ answering this specific composition question was
found.

**Needs written confirmation.** Until answered, `PRIZE-FIT.md` §5 treats Track 1 (Composable or
Standardized Graph Products) as a possible but unconfirmed second submission, not as a settled fit
— and recommends, as a design choice available to the owner, building the verification tool to
call The Graph's own Subgraph MCP server rather than a hand-rolled client, since that is the
version of the design most likely to satisfy this reading if it is the correct one.

## Q3. If Robinhood testnet and Arc testnet lack Studio support, does a Substreams/Firehose provider plus a self-hosted graph-node count as live use of a Graph provider?

**Partially answered, with one premise corrected by direct evidence, and the core policy question
left open.**

VERIFIED, network-registry findings (all <https://thegraph.com/docs/en/supported-networks/>,
retrieved 2026-09-11):

| Network checked | Found in The Graph's registry? | Chain id shown | Note |
|---|---|---|---|
| Robinhood Chain **Mainnet** | Yes — `/supported-networks/robinhood/` | `eip155:4663` | Subgraphs and Substreams guides listed; no Firehose column confirmed |
| Robinhood Chain **Testnet** (46630, the chain UNICA's rehearsal targets, per `docs/unica-v4/EVENT-SCHEMA.md` §10.1) | **Not found.** Both `/supported-networks/robinhood-testnet/` and `/supported-networks/robinhood-chain-testnet/` return the site's 404 page, and no search result surfaced a Graph docs page for it | — | This matches, and slightly firms up, the existing evidence file's "UNKNOWN: not probed" for 46630 — it was probed for this file and still not found |
| "Arc" (mainnet, slug `arc`) | Yes — `/supported-networks/arc/` | `eip155:5042`, linking to `docs.arc.network` | **Not Circle's Arc** — see the correction below |
| Circle's Arc **Testnet** (chain id `5042002`, per `docs/ARC-FACTS.md`, official source `docs.arc.io`) | **Yes**, under the slug `arc-testnet` — `/supported-networks/arc-testnet/`, chain id shown as `eip155:5042002`, exact match to Circle's own chain id | `eip155:5042002` | This page exists and is indexed by search, but does not appear in the default (non-toggled) view of the main network-list page fetched for this file; the page's own service checkmarks (which of Subgraphs/Substreams/Firehose) could not be extracted reliably through the fetch method used here |

**Correction to a premise in the research brief.** "Arc" on The Graph's supported-networks list
(chain id `eip155:5042`, `docs.arc.network`) is a **different network from Circle's Arc** (chain id
`5042002`, `docs.arc.io`, the network `docs/ARC-FACTS.md` and `docs/unica-v4/arc/` integrate with).
This is a name collision between two unrelated chains that both happen to be called "Arc," not a
fact about Circle's Arc having a Graph-supported mainnet. Circle's Arc has no mainnet
(`docs/ARC-FACTS.md`: "Arc is currently available on Testnet only," official, `docs.arc.io`), so no
claim that "Arc mainnet is Graph-supported" can be made about the chain UNICA actually uses.

**Revised premise for Circle's Arc, specifically:** the research brief's framing — "if... Arc
testnet lack[s] Studio support" — is not confirmed as true. Circle's Arc testnet has its own
documented page in The Graph's registry. Whether that page-existence means Subgraph Studio can
deploy to it today, versus only a self-hosted `graph-node` being possible against it, was not
resolved by the fetches performed for this file (see Unknowns).

**The core policy question — does self-hosting `graph-node` against a chain (with or without a
registry page) count as "a Graph provider" for prize purposes — is not answered by any source
retrieved.** VERIFIED, technical background only: The Graph's own new-chain-integration
documentation (`http://thegraph.com/docs/en/indexing/new-chain-integration/`, retrieved
2026-09-11) states that `graph-node` can index any EVM chain exposing standard JSON-RPC methods
(`eth_getLogs`, `eth_call`, `eth_getBlockByNumber`, etc.), independent of whether that chain
appears in the supported-networks registry — the registry is about Subgraph Studio and the
decentralized network's own coverage, not about what the open-source `graph-node` binary is
technically capable of indexing. That page draws no distinction between "self-hosted graph-node
against an unlisted chain" and "using a Graph provider" for eligibility purposes; it is a
technical document, not a rules document. **Needs written confirmation.**

## Q4. Would a third-party Graph-compatible host qualify, or must queries use Studio or the decentralized network?

**Not settled by any source retrieved.** No page fetched for this file — the ETHOnline prizes page,
the supported-networks registry, or the AI Suite overview — states a rule either permitting or
excluding a third-party Graph-compatible host (for example, a commercial `graph-node`-compatible
indexing service run by a company other than Edge & Node / The Graph Foundation). The prize page's
requirement is "Consume live data from a Graph provider," which is the only relevant phrase found,
and it does not define "a Graph provider" narrowly enough to say whether a third-party host
qualifies as one. **Needs written confirmation.**

## Q5. If the demo uses one officially supported chain through Studio plus unsupported chains through self-hosted indexing, is the project eligible overall?

**Not settled by any source retrieved, and this file recommends against needing an answer this
event (see `DEMO-PLAN.md` §4, item D deferred).** No eligibility rule was found anywhere in the
ETHGlobal or Graph pages fetched that addresses mixed-support submissions specifically. The closest
relevant fact is structural, not a rule: `PRIZE-FIT.md` §7 and `DEMO-PLAN.md` §5 already scope the
recommended build to Ethereum Sepolia alone — VERIFIED supported
(<https://thegraph.com/docs/en/supported-networks/sepolia/>) — so this question does not need to be
answered to ship the recommended demo. It remains open only for the deferred cross-chain direction
named in `DEMO-PLAN.md` §4 (demo D). **Needs written confirmation**, if and when that direction is
pursued.

## Q6. Is a public subdirectory of an existing MIT repository sufficient, provided the work built during the event is clearly identified, under From Scratch rules?

**Answered from official sources: yes, for this repository specifically, because the repository
itself satisfies the From Scratch pool definition as a whole — not merely as a general rule about
subdirectories.**

VERIFIED — the From Scratch pool definition (ETHOnline 2026 prizes page, retrieved 2026-09-11):
"Projects begun and built during the hackathon. Open-source starter kits are fine; project-specific
prior code is not." VERIFIED — `docs/PROVENANCE-LEDGER.md` (re-derivable at any time with `git
log`): this repository's genesis commit is dated 2026-09-04, four hours after this event's build
window opened, and zero commits precede that window. The pool definition's constraint is on
**project-specific prior code that predates the hackathon** — it is not a constraint on which
subdirectory of an already-hackathon-born repository a later feature is added to. Since the whole
project, not merely this Graph-focused subdirectory, began inside the window, adding
`docs/unica-v5/graph/` and any code it leads to is adding to a From-Scratch project, not smuggling
in pre-event work through a new folder.

What must still be true, and is a matter of practice rather than of the rule text: **the work built
during the event must be clearly identified**, exactly as the question asks. `docs/PRIOR-ART.md`
already states and follows this discipline for the two documents that genuinely predate the event
(`specs/HOOK-SPEC.md`, `specs/THREAT-MODEL.md`) and for every carried-in file; the same discipline
— naming what is new this week versus what was built earlier in the same event window (the already
existing `integrations/graph/` subgraph, per `PRIZE-FIT.md` §8) — is what keeps a From-Scratch claim
honest for this stream too, and is not itself in question.

**What is not settled:** whether ETHGlobal or The Graph would view a *second* feature built this
same event, layered on a subgraph built earlier this same event, and aimed at the same prize pool
as an already-partially-submitted candidate (`docs/SPONSOR-ELIGIBILITY.md` §3), as one From-Scratch
project extended twice, or as something closer to two competing submissions. This is the same open
question as `PRIZE-FIT.md` §11.2, restated here because it is the practical edge of Q6 rather than
a new fact. **Needs written confirmation.**

## Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ETHOnline 2026 prizes page | https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 | ETHGlobal | OFFICIAL | Q1, Q2, Q6 — track wording, From Scratch pool definition |
| The Graph — Supported Networks (index) | https://thegraph.com/docs/en/supported-networks/ | 2026-09-11 | The Graph | OFFICIAL | Q3 — table structure, columns (Subgraphs/Substreams/Firehose) |
| The Graph — Supported Networks, Robinhood Chain | https://thegraph.com/docs/en/supported-networks/robinhood/ | 2026-09-11 | The Graph | OFFICIAL | Q3 — Robinhood Chain **mainnet**, chain id `eip155:4663` |
| The Graph — Supported Networks, Arc (mainnet slug) | https://thegraph.com/docs/en/supported-networks/arc/ | 2026-09-11 | The Graph | OFFICIAL | Q3 — a distinct "Arc" network, chain id `eip155:5042`, not Circle's Arc |
| The Graph — Supported Networks, Arc Testnet | https://thegraph.com/docs/en/supported-networks/arc-testnet/ | 2026-09-11 | The Graph | OFFICIAL | Q3 — chain id `eip155:5042002`, matching Circle's Arc testnet |
| Robinhood/Arc testnet slug probes (404s) | https://thegraph.com/docs/en/supported-networks/robinhood-testnet/, .../robinhood-chain-testnet/ | 2026-09-11 | The Graph | OFFICIAL | Q3 — no Graph docs page found for Robinhood Chain testnet (46630) under either guessed slug |
| The Graph — new chain integration | http://thegraph.com/docs/en/indexing/new-chain-integration/ | 2026-09-11 | The Graph | OFFICIAL | Q3 — `graph-node`'s technical ability to index any JSON-RPC EVM chain, independent of the supported-networks registry |
| The Graph — AI Suite overview | http://thegraph.com/docs/en/ai-overview/ | 2026-09-11 | The Graph | OFFICIAL | Q1, Q2 — Subgraph MCP as a named, hosted product |
| `docs/ARC-FACTS.md` (this repository) | n/a — local file, primary source `docs.arc.io` | 2026-09-05/08 (file date) | UNICA / NFTeria, citing Circle | TEAM GUIDANCE citing OFFICIAL | Q3 — Circle's Arc chain id `5042002`, testnet-only status |
| `docs/unica-v4/EVENT-SCHEMA.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | Q3 — the existing "UNKNOWN: not probed" record for 46630 that this file's probe updates |
| `docs/PROVENANCE-LEDGER.md` (this repository) | n/a — local file | 2026-09-08 (file date); re-derivable any time | UNICA / NFTeria | TEAM GUIDANCE | Q6 — repository genesis date and zero-pre-window-commits fact |
| `docs/SPONSOR-ELIGIBILITY.md` (this repository) | n/a — local file | 2026-09-05, updated 2026-09-09 | UNICA / NFTeria | TEAM GUIDANCE | Q6 — the already-disclosed, already-partially-live existing Graph submission |

## Unknowns

1. Whether an MCP refusal/verification tool over a bespoke subgraph is confirmed (not merely
   inferred from wording) to qualify for Track 2 — Q1, no team-member confirmation found.
2. Whether a hand-rolled query plus a custom MCP tool constitutes "composing two or more of The
   Graph's products" for Track 1, versus routing the same query through The Graph's own hosted
   Subgraph MCP server — Q2, the page's wording does not resolve this.
3. Which specific services (Subgraphs, Substreams, Firehose) are marked supported for Circle's Arc
   testnet (`arc-testnet`, chain id `5042002`) on The Graph's own per-network page — the page's
   table content could not be reliably extracted through the fetch method used for this file; a
   direct visual read of the live page (not performed here) would settle it.
4. Whether Robinhood Chain testnet (46630) has any Graph-documented path at all — self-hosted or
   otherwise — beyond the two guessed URL slugs that returned 404 and the absence of any hit in
   search results; a broader slug search or a direct question to The Graph would settle this more
   conclusively than the probe performed here.
5. Whether self-hosting `graph-node` against a chain absent from the supported-networks registry
   counts as "using a Graph provider" for prize eligibility — a policy question, not a technical
   one; the technical capability is confirmed (Q3), the eligibility reading is not.
6. Whether a third-party Graph-compatible host (neither Subgraph Studio nor a self-hosted
   `graph-node` the team runs itself) would qualify — Q4, no source addresses this at all.
7. Whether ETHGlobal or The Graph treats two feature-branch submissions from the same repository,
   built in the same event, aimed at the same prize pool, as one project extended or as competing
   submissions — Q6, restated from `PRIZE-FIT.md` §11.2.
