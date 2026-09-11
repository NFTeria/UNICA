# UNICA v5 — The Graph: reusable patterns and differentiation

Track: **FROM SCRATCH** (owner-confirmed 2026-09-11). Earlier drafts in this repository said
"Continuity"; that was wrong and is not repeated here. This document is READ-ONLY research and
design. It changes no application or contract code, deploys nothing, and authorizes nothing.

Retrieval date for every web citation in this file, unless a row states otherwise: **2026-09-11**.

## 0. No channel transcript was supplied

A channel discussion of peer patterns was referenced in the assignment for this document, but its
content did not arrive with the assignment. No transcript, message log, or summary of one exists in
this repository or in the material handed to this work. Nothing below is derived from, or
attributed to, any such discussion. Every pattern in the catalogue (§3) is derived instead from The
Graph's own public documentation, its official blog and example repositories, and this repository's
own `integrations/graph/` and `integrations/graph-v2/` source — each cited by URL or file path where
it is used. Where a claim cannot be traced to one of those sources it is marked UNKNOWN (§9) rather
than inferred.

## 1. What exists in this repository today

Read in full for this document: `integrations/graph/schema.graphql`, `subgraph.yaml`,
`src/mapping.ts`; `integrations/graph-v2/schema.graphql`, `subgraph.yaml`, `README.md`, and
`provider.mjs` (client) and `copilot.mjs` (analyst) in outline. Stated honestly against the pattern
catalogue in §3, so that no row below re-derives what already exists:

- **`integrations/graph/`** — VERIFIED (repository). specVersion 1.0.0, apiVersion 0.0.9, one
  network (Ethereum Sepolia), one ABI (`V4SettlementHook`), two fixed-address data sources (the V1
  hook at `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` from block 11639895, the V3 hook at
  `0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0` from block 11667702), one event handler
  (`handleSettlementReceipt`), one immutable entity (`Settlement`, 16 fields). No templates, no
  dynamic data sources, no derived fields, no MCP surface, no caching, no cross-chain composition.
  A plain historical-receipt indexer, and its simplicity is itself a fact worth recording: nothing
  in it can go wrong that a bigger manifest could not also get wrong, and nothing in it does more
  than the one job of turning one log into one row.
- **`integrations/graph-v2/`** — VERIFIED (repository). A **separate** manifest for the frozen V2
  executor's `QuoteSettled` event, indexing `InvoiceSettlement` and `Deployment` entities. **Not
  deployed to any public chain** — the address in `subgraph.yaml` is a fork-local test address
  (`integrations/graph-v2/README.md`, `subgraph.yaml` header comment). Its `provider.mjs` and
  `copilot.mjs` are, as of this reading, the most advanced Graph-adjacent code in the repository and
  are discussed on their own merits at pattern rows 1 and 9 below: a live GraphQL client with a
  17-named failure taxonomy, mandatory `_meta`-freshness checks against an **independent** RPC
  chain head (never the indexer's own report of its progress), no fixture fallback of any kind, and
  a deterministic (non-model) treasury analyst whose every recommendation names the rule and the
  entity ids it fired on.

Neither manifest uses Substreams, dynamic data source templates, an MCP tool surface, response
caching, cross-chain query composition, or any subscription/push mechanism. That gap is the basis
for several rows in §3.

## 2. Method

Patterns are drawn from The Graph's official documentation (`thegraph.com/docs`), its official
blog, its GitHub organization (`github.com/graphprotocol`), the officially linked Substreams
reference site (`docs.substreams.dev`, StreamingFast), and, for prize framing, ETHGlobal's currently
published ETHOnline 2026 prize page. Every fetch is logged in §6 with retrieval date,
author/organization, and OFFICIAL / TEAM GUIDANCE / COMMUNITY status. A URL that did not load after
one retry, or that redirected outside the sourcing scope of this document, is listed **UNREAD** in
§6 and nothing here is inferred from it. Fetched pages were retrieved through an intermediary that
converts HTML to a summary against a prompt; where a quote is load-bearing it is reproduced as that
tool returned it, and §9 flags the two places where that indirection matters enough to caveat.

## 3. Pattern catalogue

Columns: pattern · where documented · why compelling · does UNICA already have it (checked against
`integrations/graph` and `integrations/graph-v2`) · how UNICA would use it differently ·
implementation effort · technical risk · prize relevance · recommendation. Narrative detail for each
row follows the table; the table is deliberately terse; do not read a table cell as the whole
finding.

| # | Pattern | Documented at | Why compelling | UNICA has it? | Effort | Risk | Prize relevance | Recommendation |
|---|---|---|---|---|---|---|---|---|
| 1 | Live Graph data as a load-bearing AI input | `thegraph.com/docs/en/ai-overview/`; `thegraph.com/blog/querying-blockchain-data-natural-language-mcp-skills/` (2026-06-10) | Turns indexed history into something an agent reasons over directly | **YES** — `integrations/graph-v2/provider.mjs` + `copilot.mjs`, built independently of The Graph's own MCP tooling | LOW (extend to v4 entities once a v4 subgraph exists) | LOW | HIGH | Keep; extend |
| 2 | Block-pinned evidence for agent decisions | `thegraph.com/docs/en/subgraphs/querying/graphql-api/` (`block: {number}` / `block: {hash}`; `_meta`) | A decision can cite the exact indexed block its numbers came from | PARTIAL — `_meta` is already required on every query; no fixed-block replay is stored | LOW | LOW | MEDIUM | Adopt for v5 |
| 3 | MCP tools exposing Graph queries | `thegraph.com/docs/en/ai-overview/`; blog above; community: `github.com/kukapay/thegraph-mcp` | Lets any MCP-aware agent query a subgraph in natural language, no hand-rolled GraphQL | NO | MEDIUM | MEDIUM | HIGH | Candidate, gated on a deployed subgraph |
| 4 | Dynamic data sources (templates) | `thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/` (`templates:`, `TemplateName.create(address)`) | Indexes contracts whose address is unknown at manifest-write time — UNICA v4's exact shape | NO in either existing manifest; **already proposed** for v4 in `docs/unica-v4/EVENT-SCHEMA.md` §10.2 | MEDIUM (blocked on v4 contracts existing) | LOW once built | MEDIUM | Already the plan of record; confirm citation only |
| 5 | Substreams for unsupported chains | `thegraph.com/docs/en/substreams/introduction/`; `docs.substreams.dev/reference-material/chains-and-endpoints` | Officially documented path when a chain isn't covered by subgraph indexing | NO | HIGH | MEDIUM | MEDIUM | Do not build for 46630; keep the bounded indexer (`EVENT-SCHEMA.md` §10.3) |
| 6 | Graph-first query with RPC or log fallback | Not found as a named official Graph pattern; nearest official framing treats RPC and indexed history as different tools, not a fallback chain | — | YES, inverted: RPC is **always authoritative**, Graph is **additive-only** (`EVENT-SCHEMA.md` §2, §10) | N/A | LOW | LOW–MEDIUM | Keep; document the direction explicitly, not as generic "fallback" |
| 7 | Real-time subscriptions or server push | Generic GraphQL subscriptions (Apollo/graphql.org); Substreams sinks documented as push (`thegraph.com/docs/en/substreams/developing/sinks/`: streaming, PubSub, webhook) | Faster alerting than polling | NO — polling only | HIGH if via Substreams | push trusted for confirmation would violate "settlement never depends on an indexer" | LOW | Do not adopt for settlement confirmation; consider only as a watcher alert accelerant, downgraded to "notice, not proof" |
| 8 | On-chain provenance | `thegraph.com/docs/en/indexing/overview/` — Proof of Indexing (POI), an indexer-reward/dispute mechanism, not documented as consumer-facing | Sounds like data-integrity proof; documentation says otherwise | NO, and correctly so — UNICA's provenance is the on-chain receipt pairing itself, not POI | N/A | mislabeling POI as data-integrity would be an inaccurate claim | LOW as a build item; MEDIUM as a "what not to claim" note | State explicitly that UNICA's provenance is receipt-based, not POI-based |
| 9 | Explainable refusal decisions | Not a Graph product feature; built on Graph primitives (`_meta`, GraphQL `errors`) | Turns an indexer's raw signals into an auditable "why" | **YES, and further along than anything found in The Graph's own docs** — 17 named `FAILURE` constants in `provider.mjs`, each driving a distinct refusal in `copilot.mjs` | LOW (extend taxonomy to v4) | LOW | HIGH | Keep as UNICA's most differentiated pattern; document as an original contribution, not attributed to The Graph |
| 10 | Query reduction and caching | `thegraph.com/docs/en/subgraphs/querying/best-practices/` (combine requests; `first:` bound, default 100; fragments); `.../querying/from-an-application/` (graph-client automatic pagination) | Fewer round trips, smaller payloads | PARTIAL — `_meta` and rows already combined in one request; no caching layer, which is correct here | LOW | caching RESULTS would reintroduce the "confident but stale" failure the design refuses | LOW–MEDIUM | Adopt request-combining and pagination bounds; explicitly reject result-level caching for the copilot path |
| 11 | A public self-hosted graph-node | `github.com/graphprotocol/graph-node` (official); `thegraph.com/docs/en/quick-start/` | Removes the Subgraph Studio account dependency (Q95) entirely | NO | MEDIUM–HIGH, standing infrastructure | MEDIUM — this stream may not create standing/paid infrastructure | LOW–MEDIUM | Note as available, not proposed; owner decision, out of this stream's authority |
| 12 | Graph-compatible third-party sinks | `thegraph.com/docs/en/substreams/developing/sinks/` (Postgres, Clickhouse, MongoDB, Subgraph, streaming, PubSub, webhook, CSV, KV, Prometheus) | Documented path into a SQL warehouse for reconciliation | NO | HIGH (shares Substreams authoring cost with row 5) | MEDIUM | MEDIUM | Plausible v5+ reconciliation direction; decide jointly with row 5, not separately |

### 3.1 Pattern 1 — Live Graph data as a load-bearing AI input

The Graph's own material describes the Subgraph MCP server as giving an AI assistant the ability to
"search for relevant Subgraphs by keyword or contract address, inspect GraphQL schemas, and execute
queries against specific deployments" (`thegraph.com/blog/querying-blockchain-data-natural-language-mcp-skills/`,
published 2026-06-10, The Graph Foundation) and frames the wider AI suite around "natural language
access" to on-chain data (`thegraph.com/docs/en/ai-overview/`). Neither official page documents a
freshness gate against an independent chain head as part of that pattern.

`integrations/graph-v2/provider.mjs` already implements a stricter version of the same idea, built
before either official page was read for this document: every query asks `_meta` in the same
request as the rows; the freshness verdict is reached before a row is looked at; the chain head it
is compared against comes from an **independent** RPC (its own chain id checked first); there is
**no fixture fallback of any kind** (`provider.mjs` imports nothing from `node:fs` and names no
sample file, asserted structurally in `provider-test.mjs`); and the API key is redacted from every
printable form. This is not deployed (`integrations/graph-v2/README.md`: no Studio deployment, no
account, `live-proof.mjs` exits non-zero when unconfigured) — the gap is Studio access (Q95) and
authorization (Q131), which this document does not have standing to close.

**How UNICA would use it differently going forward:** the same discipline — refuse rather than
degrade — should be the acceptance bar for any v4 extension of this pattern, and for any MCP surface
built on top of it (row 3), rather than adopting The Graph's own MCP server's implicit trust model
(a Gateway API key and a live answer) without the freshness gate UNICA already built independently.

### 3.2 Pattern 2 — Block-pinned evidence for agent decisions

`thegraph.com/docs/en/subgraphs/querying/graphql-api/` documents exact syntax for pinning a query to
history:

```graphql
{ challenges(block: { number: 8000000 }) { challenger outcome } }
{ challenges(block: { hash: "0x5a0b54d5dc17e0aadc383d2db43b0a0d3e029c4c" }) { challenger outcome } }
{ _meta(block: { number: 123987 }) { block { number hash timestamp } deployment hasIndexingErrors } }
```

`provider.mjs` already reads `_meta` on every call but, from the files read, queries current head
rather than a fixed historical block — so a copilot recommendation can be shown to have been
computed from a fresh index, but cannot today be independently re-run against the **exact** snapshot
it was computed from once the chain has moved on. Stamping each recommendation with the `_meta`
block number and hash it used, and allowing a client to replay the identical query pinned to that
block, closes that gap cheaply and feeds the "reconciliation and auditability" differentiator (§5).

### 3.3 Pattern 3 — MCP tools exposing Graph queries

Officially: a Subgraph MCP server exposes "over 15,000 publicly available Subgraphs" to any
MCP-aware agent (blog, 2026-06-10), and Agent Skills package MCP access with domain expertise as an
installable unit for Claude Code or OpenClaw (`thegraph.com/docs/en/ai-overview/`). Independently, a
**community**, unofficial implementation exists at `github.com/kukapay/thegraph-mcp` — cited here
only to note that MCP-wrapping a Graph client is a known, reproducible shape, not to imply any
affiliation with The Graph.

UNICA has no MCP surface today. If one is built, it should wrap `provider.mjs` as it stands rather
than re-implement a laxer client: the value UNICA would add over The Graph's own Subgraph MCP is
that every answer an agent receives through it already carries the freshness refusal and the
key-redaction guarantees `provider-test.mjs` proves, which nothing in the officially documented MCP
pattern requires of a general-purpose subgraph.

### 3.4 Pattern 4 — Dynamic data sources

`thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/` documents the manifest
shape directly:

```yaml
templates:
  - name: Exchange
    kind: ethereum/contract
    network: mainnet
    source:
      abi: Exchange
    mapping: { ... }
```

instantiated at runtime with `Exchange.create(event.params.exchange)` inside a handler. This is
**already the plan of record** for UNICA v4 — `docs/unica-v4/EVENT-SCHEMA.md` §10.2 proposes exactly
this: "Templates `UnicaMarketHook` and `UnicaMarketExecutor` are instantiated in the
`MarketProposed` handler with `marketId` as context. Only the official registry creates them... so a
look-alike hook is never indexed: emitter authentication is structural." This document adds nothing
to that design beyond confirming the citation is accurate against the current official manifest
syntax, and beyond noting that neither event exists in a deployed contract yet
(SPECIFIED-NOT-BUILT, `docs/unica-v4/EVENT-SCHEMA.md` §1) — this pattern cannot be built before UNICA
v4 ships.

### 3.5 Pattern 5 — Substreams for unsupported chains

Substreams is documented as a parallel indexing engine reaching beyond EVM chains — "Solana,
Injective, Starknet, and Vara" among others (`thegraph.com/docs/en/substreams/introduction/`;
chain/endpoint list at `docs.substreams.dev/reference-material/chains-and-endpoints`, StreamingFast,
a Graph-ecosystem infrastructure provider rather than `thegraph.com` itself — labeled TEAM GUIDANCE,
not OFFICIAL, in §6).

`thegraph.com/docs/en/supported-networks/`, fetched for this document, lists **Robinhood Chain**
under identifier `robinhood` — independently corroborating `docs/unica-v4/EVENT-SCHEMA.md` §10.1's
existing citation of `MAINNET-CAPABILITY-PROBE.md` for chain id 4663 ("YES, identifier `robinhood`").
The fetch performed for this document, processed through a summarizing intermediary, did **not**
surface a distinct Robinhood Chain **Testnet** (46630) entry. That is consistent with, but does not
newly resolve, `EVENT-SCHEMA.md`'s existing "UNKNOWN: not probed" status for 46630 — this document's
fetch was not a raw, complete read of the page and cannot be relied on to prove an absence (§9).

If 46630 support is ever confirmed absent, Substreams-to-Postgres is the officially documented
fallback — but for a single-testnet rehearsal chain with 12 known event types across 3 emitting
contracts, the Rust/WASM authoring cost of a Substreams package is a heavier commitment than the
bounded RPC event indexer `EVENT-SCHEMA.md` §10.3 already specifies (`eth_getLogs` in fixed pages,
committed as a read-only script). **Recommendation: do not build Substreams for 46630; keep the
bounded indexer.** Revisit only if UNICA ever targets a chain The Graph's subgraph indexing does not
cover at all.

### 3.6 Pattern 6 — Graph-first query with RPC or log fallback

Searched for as a named pattern in The Graph's own documentation and not found there under that
name; the closest official framing treats RPC reads and indexed history as answers to two different
questions, not two sources ranked by availability. `docs/unica-v4/EVENT-SCHEMA.md` §2 and §10
already states UNICA's version of this, and it inverts the naive reading: *"RPC serves current state
and confirmation; The Graph serves indexed history where the chain is supported... Nothing in the
settlement path depends on an indexer"* and *"Current state is not history... An indexer never
supplies current status, and its lag is shown."*

`provider.mjs` implements the safety-relevant direction: on any indexer doubt it **refuses**, never
silently substituting an RPC read as an equivalent answer and never presenting a stale index as
current. Most generic "Graph-first, RPC-fallback" designs treat the two as interchangeable — trading
freshness for availability. UNICA's rule instead makes RPC **always authoritative for settlement
truth** and The Graph **additive-only for history**, so a Graph failure degrades a *feature*
(history, agent commentary) and never a *guarantee*. Recommendation: document this explicitly as
"RPC-authoritative, Graph-additive" in any v5 architecture note, rather than the generic
"fallback" framing — the generic framing invites exactly the failure mode this design exists to
refuse.

### 3.7 Pattern 7 — Real-time subscriptions or server push

No official The Graph documentation page was found (searched specifically) describing native
GraphQL `subscription` support on a decentralized-network subgraph as of 2026-09-11; the material
found under "GraphQL subscriptions" was generic (Apollo/graphql.org), not The Graph-specific.
Substreams sinks do document genuine push mechanisms — direct streaming, a PubSub sink, and a
webhook sink (`thegraph.com/docs/en/substreams/developing/sinks/`).

UNICA has none of this — every read in the repository is a poll. That is the correct posture for
the settlement path (a missed push must never be mistaken for "nothing happened" the way a
transaction receipt still gets checked regardless), so this is not a gap to close there. Where push
could help is the event **watcher** (`docs/unica-v4/EVENT-SCHEMA.md` §9 role "W"), which is
specified today as a polling script; a Substreams webhook or PubSub sink is the documented mechanism
if the watcher is ever moved off polling for faster alerting. **It must never become a confirmation
source** — only a notice that something happened, which a human or a script then verifies against
chain state, exactly as EVENT-SCHEMA.md already requires for every alert class.

### 3.8 Pattern 8 — On-chain provenance

`thegraph.com/docs/en/indexing/overview/` defines Proof of Indexing (POI) as "a cryptographic proof
that an Indexer has correctly indexed a subgraph deployment up to a given block... a digest of all
entity store transactions." It is generated by the indexer-agent and verified on-chain by the
SubgraphService contract, used to gate indexing-reward collection and to force-close a stale
allocation (28-day staleness ceiling) — a mechanism for disputes **between indexers and the
network**. Nothing in the page read describes an ordinary query client verifying data integrity
through a POI.

UNICA should not build toward POI as a trust mechanism, and should say so plainly if the question
comes up: UNICA's actual on-chain provenance is the receipt pairing itself — a `SettlementReceipt`
that cannot survive without a same-transaction `Settled` from the correct executor
(`docs/unica-v4/EVENT-SCHEMA.md` §6.2), checked by emitter authentication (§2) rather than by
trusting any indexer's attestation about its own correctness. This is a stronger provenance
guarantee for UNICA's purposes than POI, because it requires trusting nothing but the chain itself.

### 3.9 Pattern 9 — Explainable refusal decisions

Not a product The Graph documents; it is a property UNICA already built on top of Graph primitives
(`_meta.hasIndexingErrors`, the GraphQL `errors` array) that The Graph's own pages do not by
themselves prescribe a response to. `integrations/graph-v2/provider.mjs` names **17** distinct
failure constants (`NO_ENDPOINT`, `STALE_INDEX`, `INDEXING_ERRORS`, `PARTIAL_DATA`,
`HEAD_WRONG_CHAIN`, `MALFORMED_JSON`, and others read in the file), each driving one specific,
auditable refusal rather than a catch-all `else`; `copilot.mjs`'s every recommendation "carries the
rule that fired, the exact figures it fired on, and the entity ids those figures came from"
(`integrations/graph-v2/README.md`), and an empty result is `INSUFFICIENT_DATA`, never a confident
zero.

This is, on the evidence read for this document, UNICA's single most differentiated pattern in this
catalogue — more developed than anything found in The Graph's own AI-tooling documentation, which
describes natural-language query access but not a named failure taxonomy or a rule-citing analyst.
**Recommendation:** keep it, extend the same numbered-taxonomy discipline to v4 entities as they are
added (a new named failure, never a broadened catch-all), and describe it in submission material as
an original UNICA contribution built on Graph primitives — not attribute the pattern itself to The
Graph, since it is not one of their documented features.

### 3.10 Pattern 10 — Query reduction and caching

`thegraph.com/docs/en/subgraphs/querying/best-practices/` recommends combining multiple queries into
one HTTP request ("improves the overall performance by reducing the time spent on the network"),
bounding collections explicitly with `first: N` (the default page size is 100), and using GraphQL
fragments to avoid repeating field lists.
`thegraph.com/docs/en/subgraphs/querying/from-an-application/` documents `graph-client`'s automatic
pagination and its **cross-chain subgraph handling** — querying multiple subgraphs in a single
composed query, a feature the page states is lost if a different client is used. UNICA does not use
`graph-client` today; `provider.mjs` is a plain `fetch`-based client. If UNICA ever needs
cross-chain payment history (differentiator, §5) across more than one deployment's subgraph,
`graph-client`'s composition feature is the documented path rather than merging per-chain responses
by hand.

Neither official page documents response-level caching guidance, and that silence is worth treating
as informative rather than as a gap: `provider.mjs` already combines `_meta` and the rows into one
request, which follows the documented advice for free. A caching layer that stores query **results**
would sit between the freshness check and the merchant and could make a refusal-based system look
live while serving old data — the exact failure mode the whole design refuses elsewhere.
**Recommendation:** adopt request-combining and `first:`-bounded pagination (cheap, official,
already half-true); adopt `graph-client` if and when cross-chain composition is needed; explicitly
reject result-level caching anywhere in the copilot's read path.

### 3.11 Pattern 11 — A public self-hosted graph-node

`github.com/graphprotocol/graph-node` is the official, Graph Protocol-maintained implementation.
Running one requires Rust, PostgreSQL (with the `pg_trgm`, `btree_gist`, and `postgres_fdw`
extensions), IPFS, a protobuf compiler, and a chain RPC endpoint; official guidance recommends
prebuilt Docker images over a from-source build for subgraph developers. This would remove the
Subgraph Studio account dependency recorded as Q95 in `docs/unica-v4/EVENT-SCHEMA.md` §1 entirely —
at the cost of UNICA itself becoming the operator of record for an always-on service, which is new
standing infrastructure. **This document does not propose standing one up**: the rules under which
it was written forbid creating accounts or paid infrastructure, and an always-on self-hosted node is
exactly that kind of commitment even where no fee is paid to a third party. Recorded here as an
available option for the owner to weigh, not as a recommendation.

### 3.12 Pattern 12 — Graph-compatible third-party sinks

`thegraph.com/docs/en/substreams/developing/sinks/` documents Substreams sinks to a SQL database
(Postgres, Clickhouse), MongoDB, a Subgraph, direct application streaming, a PubSub topic, a
webhook, CSV/file export, a key-value store, and Prometheus metrics. If UNICA's reconciliation and
auditability differentiator (§5) ever needs Settlement/Order/Market history joined against
off-chain accounting records in a SQL warehouse, a Postgres or Clickhouse sink is the documented
path rather than hand-rolling an ETL off the subgraph's GraphQL endpoint. This shares its dominant
cost — Substreams authoring — with row 5, so the two should be decided together: building a
Substreams package for a sink but not for chain coverage (or vice versa) would pay the same
engineering cost twice for two different reasons.

## 4. Prize framing — ETHOnline 2026, The Graph track

ETHGlobal's currently published prize page (`ethglobal.com/events/ethonline2026/prizes`, read
2026-09-11) states The Graph is offering **$15,000** total, split across tracks that include "Best
Use of Composable or Standardized Graph Products" and "Best AI Tooling or AI Use Case," the latter
run across two eligibility pools the page itself names **"Start Fresh"** (net-new projects begun
during the hackathon) and **"Continuity"** (extending an existing open-source repository or shipping
a feature on a current product). This vocabulary independently corroborates the owner's 2026-09-11
ruling that UNICA's submission is the **FROM SCRATCH** track (this document's own header,
restated from the assignment) — "Start Fresh" on the prize page is the same pool, in ETHGlobal's own
words rather than this repository's.

Stated prize requirements, as fetched: participants must "consume live data from a Graph provider,"
with mocked or local datasets disqualifying an entry; "simply querying one Subgraph doesn't qualify"
for the products track "unless composition or standardization is evident"; the AI track requires
using The Graph "as a load-bearing part of the project," with "meaningful work beyond printing raw
query results" mandatory. The Graph's own account (`x.com/graphprotocol`, retrieved via search,
2026-09-11) reads: *"An AI agent is only as good as the data behind it. Feed yours live on-chain
data with Subgraphs or Substreams. Make life easier by using The Graph's MCP and SKILLs."*

**What this document does not do, by the rule it was written under:** it does not declare UNICA
eligible or ineligible for any prize category. §3.9 and §3.1 above describe why UNICA's existing
`copilot.mjs`/`provider.mjs` design plausibly satisfies the "load-bearing, not printing raw results"
bar in substance — that is a design observation, not a ruling. The exact per-pool dollar breakdown
returned by this document's fetch of the prize page contained an internal inconsistency (§9) that a
direct, non-summarized read should resolve before it is quoted in submission material. **Any
determination of prize eligibility, and any claim that a Graph team member has confirmed it in
writing, belongs in `MENTOR-QUESTIONS.md` — a file this stream does not own and has not created —
and is not settled here.**

## 5. Differentiation test

UNICA's differentiation claims, tested against the pattern catalogue in §3. "Served by" lists
pattern numbers; "gap" states plainly where no catalogued pattern applies.

| Differentiator | Served by (pattern #) | Note |
|---|---|---|
| Authenticated payment receipts | 4 (emitter authentication in the handler), 8 (receipt pairing, not POI), 2 (block-pinned replay) | The authentication is a UNICA handler rule (`EVENT-SCHEMA.md` §2), not a Graph feature; the pattern only supplies the mechanism to encode it |
| Immutable market versions | 4 (a new version is a new `marketId`, indexed as a new template instance), 2 (a point-in-time query shows the exact version state) | — |
| Merchant identity | **gap** — no catalogued Graph pattern addresses off-chain identity; The Graph indexes on-chain data only | UNICA's merchant-identity story lives in ENSv2 (`integrations/ensv2/`), outside this document's scope; recorded here so the gap is not silently assumed closed |
| Oracle and execution evidence | 1 (live indexed reference-price and receipt fields as an AI input), 9 (an oracle condition — e.g. a future `STALE_ORACLE`/`MARKET_CLOSED` view result — is exactly the shape `provider.mjs`'s named-failure discipline already handles well) | — |
| Cross-chain payment history | 12/5 (Substreams sinks, if a chain needs coverage The Graph's subgraph indexing lacks), and `graph-client`'s cross-chain query composition noted under pattern 10 | UNICA does not use `graph-client` today; today, "cross-chain" would mean querying N per-chain subgraphs and merging client-side |
| Deterministic versioned NFT identity | **gap** — no catalogued pattern is NFT-identity-specific; pattern 4 (dynamic data sources) is the applicable *mechanism* if an NFT contract is deployed per-market the way the hook/executor pair is | This differentiator needs bespoke schema design, not an importable pattern |
| Agent-readable safety decisions | 9 (direct fit — UNICA's most-developed pattern), 1 | — |
| Reconciliation and auditability | 2 (block-pinned replay), 12 (a SQL sink for joining against off-chain records), 8 (provenance is receipt-based, stated explicitly so no one reaches for POI instead) | — |

Two explicit gaps (merchant identity, NFT identity) are recorded rather than papered over: The
Graph's documentation, read for this project, has no pattern that serves either directly, and this
document is not the place to invent UNICA's answer to them.

## 6. Sources

| # | URL / citation | Retrieved | Author / organization | Kind | Used for | Conflicts |
|---|---|---|---|---|---|---|
| 1 | `ethglobal.com/events/ethonline2026/prizes` | 2026-09-11 | ETHGlobal | OFFICIAL (event organizer) | Prize amounts, track structure, "Start Fresh"/"Continuity" pools, live-data requirement | The fetched summary's nesting of "Track 2" (two pools, $5K) and a separate "Track 3" ($5K, continuity-only) reads as internally inconsistent against the stated $15K total; flagged UNKNOWN (§9), not resolved here |
| 2 | `thegraph.com/docs/en/ai-overview/` | 2026-09-11 | The Graph Foundation | OFFICIAL | Subgraph MCP and Agent Skills overview | none found |
| 3 | `thegraph.com/docs/en/supported-networks/` | 2026-09-11 | The Graph Foundation | OFFICIAL | Confirms Sepolia, Arbitrum One, and Robinhood Chain (mainnet, `robinhood`) are listed | Does not resolve 46630 (Robinhood Chain Testnet) either way — see §9 |
| 4 | `thegraph.com/docs/en/substreams/developing/sinks/` | 2026-09-11 | The Graph Foundation | OFFICIAL | Sink types (Postgres, Clickhouse, MongoDB, Subgraph, streaming, PubSub, webhook, CSV, KV, Prometheus) | none found |
| 5 | `thegraph.com/docs/en/subgraphs/developing/creating/advanced/` | 2026-09-11 | The Graph Foundation | OFFICIAL | Attempted dynamic-data-source detail; page's fetched content centered on File Data Sources instead, with only a passing reference to "existing data source templates" | Superseded by source 6 for the exact template syntax |
| 6 | `thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/` | 2026-09-11 | The Graph Foundation | OFFICIAL | Exact `templates:` YAML and `TemplateName.create(address)` runtime call | none found |
| 7 | `thegraph.com/docs/en/subgraphs/querying/from-an-application/` | 2026-09-11 | The Graph Foundation | OFFICIAL | `graph-client`, cross-chain query composition, automatic pagination | none found |
| 8 | `thegraph.com/docs/en/indexing/overview/` | 2026-09-11 | The Graph Foundation | OFFICIAL | Proof of Indexing definition and scope (reward/dispute mechanism, not consumer verification) | none found |
| 9 | `github.com/graphprotocol/graph-node` | 2026-09-11 | The Graph Protocol (official org repository) | OFFICIAL | Self-hosted graph-node requirements and quick-start shape | none found |
| 10 | `thegraph.com/docs/en/ai-suite/token-api-mcp/` | 2026-09-11 | The Graph Foundation (attempted) | **UNREAD** | — | 301-redirected to `app.pinax.network/docs/api/getSkillsMarkdown`, a third-party domain outside this document's sourcing scope; not followed. Left UNREAD rather than substituted with a guess |
| 11 | `thegraph.com/blog/querying-blockchain-data-natural-language-mcp-skills/` | 2026-09-11 (published 2026-06-10) | The Graph Foundation | OFFICIAL (company blog) | MCP/Skills detail, composability vision quote, Subgraph MCP description | none found |
| 12 | `thegraph.com/docs/en/subgraphs/querying/best-practices/` | 2026-09-11 | The Graph Foundation | OFFICIAL | Query-combining guidance, `first:` default of 100, fragments | Page did not discuss block-pinned queries or response caching; see source 13 for the former |
| 13 | `thegraph.com/docs/en/subgraphs/querying/graphql-api/` | 2026-09-11 | The Graph Foundation | OFFICIAL | Exact block-pinned (`block: {number}` / `block: {hash}`) query syntax; `_meta` shape | none found |
| 14 | `docs.substreams.dev/reference-material/chains-and-endpoints` | 2026-09-11 | StreamingFast (Graph-ecosystem infrastructure provider) | TEAM GUIDANCE | Non-EVM chain and endpoint list for Substreams | Not a `thegraph.com` domain; labeled TEAM GUIDANCE rather than OFFICIAL for that reason |
| 15 | `x.com/graphprotocol` prize-announcement post | 2026-09-11 (search snippet, not a full page fetch) | The Graph (company account) | OFFICIAL (company account), read via search snippet only | Corroborating prize-copy quote ("Feed yours live on-chain data... MCP and SKILLs") | Read as a search-result summary, not a direct fetch; treated as lower-confidence than a full fetch |
| 16 | `github.com/kukapay/thegraph-mcp` | 2026-09-11 (search snippet only) | Independent, third-party ("kukapay") | COMMUNITY | Cited only to show an MCP-wrapped Graph client is a known, reproducible shape; no affiliation with The Graph implied or checked | Not fetched directly; description taken from search-result summary |
| 17 | `integrations/graph/schema.graphql`, `subgraph.yaml`, `src/mapping.ts` | 2026-09-11 (repository read) | This repository (UNICA / NFTeria) | TEAM (this repository's own code) | §1, and the "does UNICA have it" column throughout §3 | none — primary source |
| 18 | `integrations/graph-v2/schema.graphql`, `subgraph.yaml`, `README.md`, `provider.mjs`, `copilot.mjs` (outline) | 2026-09-11 (repository read) | This repository (UNICA / NFTeria) | TEAM (this repository's own code) | §1, §3.1, §3.9, and the "does UNICA have it" column throughout §3 | none — primary source |
| 19 | `docs/unica-v4/EVENT-SCHEMA.md`, `docs/unica-v4/SPEC-CONTRACTS.md` | 2026-09-11 (repository read) | This repository (UNICA / NFTeria) | TEAM (this repository's own specification, draft, not committed) | v4 event surface, §10.1/§10.2/§10.3 indexing design already on record, cited throughout §3 and §4 | This file states it is a draft, "authorising nothing"; treated here as the specification of record for what v4 will emit, not as evidence of a deployed contract |

## 7. Unknowns

An empty list here would not be credible, and is not offered as one.

1. **Exact ETHOnline 2026 Graph-track dollar breakdown.** The fetched summary of the prize page
   describes a "Track 2" ($5,000, split into "Start Fresh" and "Continuity" pools) and then a
   separate "Track 3" ($5,000, continuity-only) whose relationship to Track 2 is not clearly
   distinguished in what was returned, against a stated $15,000 total that would otherwise require a
   third, non-AI track to account for the remaining $5,000 (which the "Composable or Standardized
   Graph Products" track does supply). A direct, non-summarized read of
   `ethglobal.com/events/ethonline2026/prizes` should be done before any specific per-place dollar
   figure for the AI track is quoted in submission material.
2. **Prize eligibility for UNICA's specific submission is not settled by this document and is not
   settled by anything read for it.** No identifiable Graph team member's written confirmation was
   sought or obtained here. Per the rules this document was written under, that determination
   belongs in `MENTOR-QUESTIONS.md`, a file this stream does not own.
3. **Whether The Graph's decentralized network or Subgraph Studio supports a native GraphQL
   `subscription` (push) on a deployed subgraph today**, as distinct from a Substreams-based push
   sink. No official page found in this research states either way; §3.7 treats this as unresolved
   and does not recommend building against it.
4. **Whether the Subgraph MCP server is free to use at any volume, or requires a paid Gateway API
   key beyond some threshold.** Community and press summaries mention "a Gateway API key" without
   pricing detail; billing/pricing pages were not fetched, since evaluating a paid product tier is
   adjacent to the "never create accounts or paid infrastructure" boundary this stream was written
   under.
5. **What currently lives behind `thegraph.com/docs/en/ai-suite/token-api-mcp/`.** The URL
   301-redirected to a third-party domain (`app.pinax.network`) outside this document's sourcing
   scope. Whether this reflects Pinax now operating Token API infrastructure on The Graph's behalf,
   a documentation reorganization, or something else, is not established here. Left UNREAD (source
   10).
6. **Whether The Graph indexes Robinhood Chain Testnet (chain id 46630).** This document's fetch of
   `thegraph.com/docs/en/supported-networks/` was processed by a summarizing intermediary and did
   not return a complete raw table; it surfaced Robinhood Chain (mainnet, `robinhood`) but not a
   distinct testnet entry. Absence from a summarized fetch is not proof of absence from the page.
   This does **not** resolve the "UNKNOWN: not probed" status already recorded in
   `docs/unica-v4/EVENT-SCHEMA.md` §1 and §10.1, which this document leaves exactly as it found it.
7. **Whether any Graph-documented pattern serves UNICA's "merchant identity" or "deterministic
   versioned NFT identity" differentiators.** Searched for and not found (§5); both appear to need
   UNICA-specific schema design rather than an importable pattern from The Graph's own
   documentation.
8. **Whether the two `EVENT-SCHEMA.md` §12 "not yet decided" adapter events
   (`StreamsReportAccepted`, `CREReportAccepted`) would change anything in this catalogue if
   adopted.** Not investigated here — out of scope for a peer-patterns document, since neither event
   is specified as indexed by any Graph pattern today (`EVENT-SCHEMA.md` §7: "Neither adapter is
   deployable in this release").
