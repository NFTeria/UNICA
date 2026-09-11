# UNICA v5 — The Graph: scalability at three settlement volumes

Research and design record. Read-only research; authorizes no deployment, no account
creation, no paid infrastructure, and no publication of any subgraph. Every claim below
is labeled VERIFIED (with source), PROPOSED (UNICA design), or UNKNOWN. Retrieval date
for every source cited here is 2026-09-11 unless a source's own row states otherwise.
Companion document: `docs/unica-v5/graph/NETWORK-OPTIONS.md`, which this document's §5
and §8 rely on for per-chain indexing-path facts.

**Indexing scalability and settlement scalability are different problems, stated
plainly up front, per the assignment's own instruction.** Whether The Graph (or any
indexer) can keep up with N events/day says nothing about whether it is economical to
settle N on-chain payments/day: gas and block space bound settlement; indexer
throughput, storage and query shape bound indexing. This document addresses the second
problem and its read-side economics. It does not re-litigate on-chain settlement
economics (gas cost per `pay` call, batching, or nano-payment aggregation design),
which are a contracts-layer question out of this stream's scope; where the two
questions meet (Scenario C, §1.3), this document says so explicitly rather than
answering the settlement half.

## 0. What exists today (read, not re-derived)

- `integrations/graph/` schema: one immutable entity, `Settlement`, 17 scalar fields,
  id = transaction hash ++ log index. No aggregation, no timeseries, no derived
  fields, no pagination helpers beyond GraphQL's own `first`/`skip`/`orderBy`. Two
  data sources, one network (Sepolia). specVersion 1.0.0.
- `integrations/graph-v2/` schema: `InvoiceSettlement` (immutable) plus `Deployment`
  (mutable, running counters `settlementCount`, `firstBlock`, `lastBlock`, and one
  `@derivedFrom` relation to `InvoiceSettlement`). Not deployed anywhere public.
  Also specVersion 1.0.0.
- Neither schema declares `@entity(timeseries: true)` or an `aggregation` type (§3).
  Both are hand-rolled, one-row-per-event designs; `Deployment`'s counters are the only
  existing aggregate, and they are coarse (lifetime totals, not daily/hourly).
- UNICA v4 contracts **do not exist yet**; every v4 event referenced below is
  **SPECIFIED-NOT-BUILT**, cited to `docs/unica-v4/EVENT-SCHEMA.md` by section, never
  presented as something a deployed contract emits today. Per that specification's own
  §10.2, a v4 subgraph would add `Market`, `MarketStatusChange`, `PolicyChange`,
  `CapsChange`, `RoleChange`, `Order`, `Settlement` and `Anomaly` entities — a richer
  but still non-aggregated, non-timeseries schema as specified.
- `integrations/graph-v2/provider.mjs` already implements, off the indexer entirely,
  the freshness discipline this document recommends generalizing at scale: every query
  asks `_meta` in the same request as the rows, judges staleness against an
  *independent* RPC head (never the indexer's own claim), and refuses rather than
  returns a stale or error-bearing answer — seventeen named failure modes, no
  catch-all, no fixture fallback.

## 1. Three scale scenarios

Event counts below are estimated from the two schemas actually on record: today's
live schema v1 (1 indexed event per settlement, `SettlementReceipt` only) and the
SPECIFIED-NOT-BUILT v4 model (`docs/unica-v4/EVENT-SCHEMA.md` §8's "log set per
transaction" table: `pay` emits `SettlementReceipt` then `Settled`, and typically one
prior `OrderCreated` per order — taken here as a 1:1 order:settlement ratio, a
PROPOSED simplifying assumption stated explicitly because UNICA v4 does not require
every created order to be paid, so the real ratio could be higher). Administrative
registry events (`MarketProposed`, `MarketStatusChanged`, etc.) are excluded from the
volume estimate below because they are lifecycle events, not per-settlement events,
and are rare by construction (one market, or one status change, is nowhere near
per-transaction frequency).

### 1.1 Scenario A — 10 merchants, 1,000 settlements/day

| Model | UNICA events/day indexed | New rows/day | Notes |
| --- | --- | --- | --- |
| Schema v1 (live today) | 1,000 (`SettlementReceipt`) | 1,000 `Settlement` | matches `integrations/graph`'s actual entity |
| v4 (SPECIFIED-NOT-BUILT) | up to 3,000 (`OrderCreated` + `SettlementReceipt` + `Settled`) | 1,000 `Order`, 1,000 `Settlement` (completed by `Settled` in the same tx, per §10.2's table) | PROPOSED 1:1 order:settlement assumption |

Average rate: ~0.012–0.035 events/sec — trivial for any of the indexing paths in
`NETWORK-OPTIONS.md` §3, including a self-hosted graph-node or the direct-RPC fallback.
Query volume is PROPOSED-estimated at 3–10 reads per settlement across its lifecycle
(checkout confirmation, receipt view, a merchant's list refresh) — 3,000 to 10,000
queries/day, i.e. roughly 90,000 to 300,000/month. Studio's 100,000 free monthly
queries (VERIFIED, `NETWORK-OPTIONS.md` §5) covers the low end and is marginal or
insufficient at the high end of this range at only 10 merchants, if nothing is cached
client-side — a first, concrete argument for caching (§4) even at this small scale.

### 1.2 Scenario B — 1,000 merchants, 1,000,000 settlements/day

| Model | UNICA events/day indexed | New rows/day | New rows/year |
| --- | --- | --- | --- |
| Schema v1 | 1,000,000 | 1,000,000 `Settlement` | ~365,000,000 |
| v4 (SPECIFIED-NOT-BUILT) | up to 3,000,000 | 1,000,000 `Order`, 1,000,000 `Settlement` | ~730,000,000 combined |

Average rate: ~11.6 events/sec (schema v1) to ~34.7 events/sec (v4 model), steady
state; realistically bursty around business hours, which is itself a capacity-planning
input no source in this pass gave a graph-node throughput ceiling for (UNKNOWN, §9).
At 1,000,000 immutable `Settlement` rows/day with no pruning or aggregation declared in
either existing schema, this is squarely the "hot entity" and unbounded-cardinality
problem discussed in §2. Query volume, PROPOSED-estimated at even 2 reads/settlement
(receipt view + one list/dashboard refresh), is 2,000,000/day ≈ 60,000,000/month —
past the free tier, into Studio's paid $2/100,000-queries pricing (VERIFIED figure,
`NETWORK-OPTIONS.md` §5): illustratively, 60,000,000 queries/month ≈ $1,200/month at
that rate. This is an order-of-magnitude illustration from a PROPOSED query-count
assumption, not a quote, an estimate from The Graph, or a commitment of any kind.

### 1.3 Scenario C — nano-payment scale, 100,000,000 events/day

Average rate: ~1,157 events/sec steady-state, certainly higher at peak. Two separate
problems live here, and this document is careful to keep them separate as instructed:

- **The indexing question** (in scope here): can any of the paths in
  `NETWORK-OPTIONS.md` §3 ingest and store 100,000,000 discrete events/day? A
  conventional subgraph's handlers execute deterministically, in block-log order,
  within one indexing pipeline (VERIFIED general graph-node architecture); no source
  fetched in this pass gave a concrete events-per-second ceiling for WASM handler
  execution, so no such ceiling is asserted here — it is UNKNOWN (§9). What can be
  said without that number: storing every individual nano-payment as its own immutable
  GraphQL row — 100,000,000/day, ~36.5 billion/year for one entity type — is far beyond
  the cardinality either existing UNICA schema was designed for, and is exactly the
  scale at which Substreams' parallelized ingestion (`NETWORK-OPTIONS.md` §3.4) is the
  more plausible path than a conventional sequential-handler subgraph, precisely
  because The Graph's own materials frame Substreams' value proposition as parallel
  throughput at volumes a normal subgraph struggles with (VERIFIED directionally,
  `thegraph.com/blog/substreams-parallel-processing/`; no chain- or volume-specific
  number for this exact scenario was found — UNKNOWN precise ceiling either way).
- **The settlement question** (out of scope here, stated so it is not silently
  conflated with the indexing one): 100,000,000 on-chain events/day, if each
  nano-payment is its own transaction, implies gas and block-space economics that are
  a contracts-layer concern entirely separate from indexing throughput. Even a
  hypothetical indexer that could ingest 100,000,000 events/day at zero cost would say
  nothing about whether settling 100,000,000 distinct on-chain nano-payments/day is
  economical — that is bounded by the chain's own gas market, not by The Graph.
- **Recommendation at this scale (PROPOSED, and explicitly a contracts-side question,
  not an indexing one):** never index the individual nano-payment as its own row.
  Index only periodic aggregate checkpoints (a batch-settlement or channel-style rollup
  event), which is itself an undesigned v5+ settlement question flagged for the
  contracts side, not resolved here. This recommendation is about what a v5 *schema*
  should store, not about redesigning nano-payment settlement itself.

## 2. Entity cardinality and hot entities

- **Unbounded, linear growth is the default shape of every entity in both existing
  schemas.** `Settlement` and `InvoiceSettlement` are `@entity(immutable: true)` with
  one row per event, forever; nothing in either schema expires, archives, or rolls up
  a row. At Scenario B's 1,000,000/day this is ~2.7M rows/day sustained and climbing
  without bound — a single ever-growing table that every point and range query must
  scan or index against.
- **The hot entity today is `Settlement`/`InvoiceSettlement` itself**, and at v4 scale
  `Order` joins it (one row per order, one per settlement, both keyed by content that
  never repeats). `Deployment` (graph-v2 only) is comparatively cold — one row per
  (network, executor) pair, updated in place — but its running counters
  (`settlementCount`, `firstBlock`, `lastBlock`) are themselves a manual, coarse
  aggregate: a single lifetime total per deployment, not a per-day or per-merchant
  breakdown, and therefore cannot answer "how much did merchant X settle yesterday"
  without scanning the hot entity directly.
- **No entity in either schema is keyed for per-merchant or per-day access
  patterns.** `Settlement.recipient` and `InvoiceSettlement.recipient` are plain
  `Bytes` fields, queryable with a `where` filter, but every such query still touches
  the same unbounded table; nothing partitions or pre-groups by merchant or by day.
- **The v4 SPECIFIED-NOT-BUILT model does not change this shape.** `EVENT-SCHEMA.md`
  §10.2's proposed entity table adds more entity *types* (`Market`, `Order`,
  `Anomaly`, four kinds of change-log rows) but every one of them is still a flat,
  one-row-per-event or one-row-per-entity design with no stated aggregation, exactly
  like schema v1.

## 3. Daily aggregation, immutable entities, timeseries and aggregation support

- **The Graph has a native feature for exactly this gap, unused by either existing
  UNICA schema.** VERIFIED (`thegraph.com/docs/en/subgraphs/best-practices/timeseries/`,
  retrieved 2026-09-11): a schema on **specVersion 1.1.0** or later can declare a
  `@entity(timeseries: true)` type — "always immutable," raw data points collected over
  time — paired with a separate **aggregation** entity that performs "pre-declared
  calculations on the timeseries data points on an hourly or daily basis," computed
  automatically at the end of each interval and exposed as its own queryable GraphQL
  type. The docs frame the benefit directly: reduced indexing and query overhead,
  because "aggregation computations" are offloaded to the database rather than
  recomputed per query.
- **Both existing UNICA subgraphs are on specVersion 1.0.0**, which predates this
  feature; adopting it means a manifest version bump, not a schema rewrite from
  scratch — the existing immutable `Settlement`/`InvoiceSettlement` entities are
  already shaped like the "raw data point" half of the pattern (immutable, one row per
  event); what is missing is the paired aggregation entity and the `timeseries: true`
  annotation.
- **Recommended aggregation entities (PROPOSED, for v5):** a daily (and, at Scenario B
  and beyond, hourly) per-merchant volume/count/fee rollup, keyed by
  `(recipient, currencyOut, day)` or `(recipient, currencyOut, hour)`, mirroring the
  "never summed across tokens — two decimal scales" discipline the existing
  `graph-v2/copilot.mjs` already enforces off-chain; letting the indexer compute this
  natively removes the need for the copilot (or any dashboard) to re-scan raw
  `Settlement` rows for a number the schema itself can maintain.
- **A stated limitation found in this pass:** the fetched docs page did not state a
  maximum number of aggregation entities, a backfill mechanism (whether historical
  rows written before the feature was adopted get retroactively aggregated), or a
  storage-size implication — all three are UNKNOWN and worth a direct trial or a team
  answer before committing a v5 schema to this feature (§9).

## 4. Pagination, query complexity, caching, block-pinned queries

- **Pagination.** VERIFIED guidance (`thegraph.com/docs/en/subgraphs/querying/graphql-api/`,
  retrieved 2026-09-11): "Avoid using `skip` values in queries because they generally
  perform poorly" for large offsets; the docs recommend cursor-style pagination
  instead — filtering on an attribute (for example `where: { id_gt: $lastID }`) rather
  than an offset. A commonly repeated figure of a maximum `first` value of 1,000
  (default 100 when omitted) appeared in search results but, like the Studio
  rate-limit figure in `NETWORK-OPTIONS.md` §9, was not independently confirmed with a
  direct page quote in this pass — carried here as reported, not verified (§9). At
  Scenario B's 1,000,000 settlements/day, even the higher reported figure means
  enumerating one day's raw settlements needs on the order of 1,000 paginated
  requests — a second, independent argument (beyond query-cost) for the aggregation
  entities in §3 rather than raw enumeration for any "how much, this period" question.
- **Block-pinned queries.** VERIFIED: queries support a `block` argument (`number` or
  `hash`) for "historical state retrieval," but the same docs page states this comes
  with an explicit caveat: "The current implementation is still subject to certain
  limitations that might violate these guarantees" — specifically, the indexer "can
  not always tell that a given block hash is not on the main chain at all," and a
  result pinned to a not-yet-final block "could be influenced by a block
  reorganization." **This matters directly for UNICA:** a block-pinned query is not,
  by The Graph's own documentation, an unconditional consistency guarantee near the
  chain head — the existing `graph-v2/provider.mjs` design of confirming freshness
  against an *independent* RPC head before trusting any indexed answer is the right
  response to this exact caveat, not a redundant precaution.
- **Query complexity.** No default or maximum query-complexity limit was found stated
  on the fetched official GraphQL API page in this pass — UNKNOWN (§9). This is worth
  confirming before designing a v5 query surface that allows deep nested relations
  (e.g., `Deployment { settlements { ... } }` at Scenario B's row counts), since an
  unbounded nested query over a million-row relation is exactly the shape a complexity
  limit exists to stop.
- **Caching.** Not a Graph-provided feature; PROPOSED for v5: a thin caching layer in
  front of the gateway for read-heavy, slow-changing views (a merchant's daily
  aggregate, once §3's aggregation entities exist), respecting the same
  staleness-refusal discipline `provider.mjs` already implements rather than serving a
  cached answer past its own freshness bound.

## 5. Multi-chain ids and cross-chain aggregation

- **A single subgraph manifest is scoped to one network per data source** (standard
  graph-node/graph-cli behavior; corroborated by the existence of a documented
  "Deploying a Subgraph to Multiple Networks" workflow, which describes *separate*
  per-network deployments of the same manifest shape rather than one manifest
  querying several chains at once — `thegraph.com/docs/en/subgraphs/developing/deploying/multiple-networks/`,
  title and existence VERIFIED, full body not fetched in this pass). This matches
  both existing UNICA schemas' own `network` field discipline
  (`integrations/graph/schema.graphql` line 9's comment: "the network this subgraph
  indexes, from the data source") and `graph-v2/schema.graphql`'s `Deployment.network`
  field, whose own doc comment already states the reason: "so that two settlements
  sharing a transaction hash across chains are visibly different rows."
- **Multi-chain ids, therefore, are a per-entity discipline, not a manifest
  feature.** Every entity id that could collide across chains must fold the chain
  identity into the id (as `Deployment.id` already does: `network ++ executor
  address`) or into a queryable field (as `Settlement.network` already does). This is
  already correct in both existing schemas and should carry forward unchanged into any
  v4/v5 schema.
- **Cross-chain aggregation therefore cannot happen inside a single subgraph**; it
  needs either (a) a second layer that queries multiple per-chain subgraphs and
  combines results, or (b) subgraph composition, a documented Graph feature
  ("Aggregate Data Using Subgraph Composition,"
  `thegraph.com/docs/en/subgraphs/guides/subgraph-composition/`, title VERIFIED, full
  mechanics not fetched in this pass — treat the existence of the feature as VERIFIED
  and its exact composition semantics as UNKNOWN pending a closer read). §8
  recommends deferring this until a second chain is actually live, per
  `docs/unica-v4/V5-DEFERRED.md` item 9's own "first" condition ("Q9 closed by the
  owner; the second chain's config enabled").

## 6. Indexing lag, provider failover, duplicate processing, reorg recovery

- **Indexing lag** is not eliminated by any option in `NETWORK-OPTIONS.md` §3 except
  direct RPC (§3.9, which has none because there is no indexing step at all). No
  numeric SLA was found for any Graph-hosted indexing path in this pass (UNKNOWN,
  carried from `NETWORK-OPTIONS.md` §9). UNICA's own standing design principle already
  answers what to do about this regardless of the number: lag is shown, never
  presented as current status (`EVENT-SCHEMA.md` §2), and `provider.mjs` already
  refuses to answer at all past a configured lag threshold rather than guess.
- **Provider failover.** For a self-hosted graph-node (§3.7) or a direct-RPC script
  (§3.9), the registry already lists more than one public RPC per chain for every
  network checked in this pass (for example Robinhood Chain Testnet's own RPC plus a
  Pinax-hosted mirror; Arc Testnet's own RPC plus a dRPC mirror) — a PROPOSED,
  concrete failover pair for either path, at no additional discovery cost, since both
  are already named in the same registry JSON this document already reads for chain
  support. For a Studio-hosted or published subgraph, provider failover is Studio's
  or the decentralized network's own concern, not UNICA's to build.
- **Duplicate processing.** VERIFIED as already tested, not just assumed, in the
  existing repository: `integrations/graph-v2`'s own test table states "a replayed log
  leaves one entity and one count" as a proven property (its README's "What is tested
  where" table). This is the correct target for any v4/v5 mapping as well: an id
  derived deterministically from immutable, unique-per-log fields (transaction hash,
  log index, and — critically at multi-chain scale per §5 — the chain identity) is
  what makes a replay idempotent rather than a duplicate row.
- **Reorg recovery.** VERIFIED, graph-node's own documented mechanism: a chain reorg
  within `ETHEREUM_REORG_THRESHOLD` (default 250 blocks) is handled by the indexer
  itself; a reorg deeper than that threshold can leave a subgraph processing
  inconsistent data (`github.com/graphprotocol/graph-node`
  `docs/environment-variables.md`, `docs/config.md`, both VERIFIED, retrieved
  2026-09-11). For a self-hosted deployment this is a tunable the operator controls;
  for Studio or the decentralized network it is the host's own configuration, not
  UNICA's. Either way, this is a second, independent reason (beyond the block-pinned
  query caveat in §4) that no UNICA surface should treat an indexed answer as final
  near the chain head without an independent RPC confirmation, exactly as
  `provider.mjs` already does.

## 7. Retention, privacy leakage, cost controls

- **Retention.** Neither existing schema states a retention policy, and nothing found
  in the fetched docs in this pass described an automatic pruning mechanism for
  immutable entities at the application level (graph-node itself has internal
  history-pruning machinery for its own storage efficiency, but no source fetched here
  quantified it for a subgraph author's own planning — UNKNOWN, §9). At Scenario B's
  scale (~730,000,000 rows/year for the v4 model), an explicit retention or archival
  policy — for example, keeping full raw rows for a rolling window and relying on §3's
  aggregation entities for anything older — is a real design decision v5 should make
  deliberately rather than by omission, since "keep every row forever" is what both
  existing schemas already do by default.
- **Privacy leakage.** The underlying data (payer, recipient, amounts, tokens) is
  already public on-chain; a subgraph does not leak anything the chain itself does not
  already expose. What a subgraph — and especially an *aggregation* entity per §3 —
  changes is the **cost of discovery**: a raw chain requires scanning logs and
  decoding them to learn "how much did merchant X settle yesterday," while a published
  per-merchant daily-aggregate GraphQL field answers it in one query, to anyone who
  can query the subgraph. This is a real, PROPOSED-flagged consideration for v5: a
  merchant may not expect their volume trend to be one public GraphQL query away, even
  though the individual transactions were always public. Recommend either gating
  per-merchant aggregation fields behind the merchant's own consent, or accepting this
  as an explicit, disclosed property of a public read layer — an owner decision, not
  a technical one this document resolves.
- **Cost controls.** VERIFIED levers available: Studio's own tiered pricing (§5 of
  `NETWORK-OPTIONS.md`) caps runaway cost at $2/100,000 queries past the free
  100,000/month; cursor pagination instead of `skip` avoids the performance cliff the
  docs themselves warn about (§4); a caching layer in front of read-heavy aggregate
  views (§4, PROPOSED) reduces query count directly; and the aggregation-entity
  feature (§3) moves repeated computation into the indexer's own database once,
  rather than paying for it on every client query.

## 8. Recommendations (PROPOSED)

Not authorized to build, deploy, or publish; a recommendation for the owner's
decision, consistent with `NETWORK-OPTIONS.md` §7.

- **One subgraph per chain, sharing a common schema shape.** A single manifest cannot
  span chains (§5), and the existing repository already keeps v1 and V2 as separate
  manifests under separate directories; extend that pattern per chain and per release
  rather than attempting one global subgraph. "Per release" (v1 vs. v4) and "per
  chain" (Sepolia vs. Robinhood Chain vs. Arc) are two independent axes; keep both,
  matching `EVENT-SCHEMA.md` §10.2's own proposed location
  (`integrations/graph/unica-v4/`, apart from the existing schema-v1 subgraph, which
  is neither changed nor replaced).
- **A federated API is not needed at Scenario A or B on a single chain**, but is worth
  evaluating (via subgraph composition, §5) once a second chain is actually live —
  matching `docs/unica-v4/V5-DEFERRED.md` item 9's own stated precondition, not before.
- **Substreams is not needed for Scenario A or B on a registry-supported,
  `issuanceRewards: true` chain** (Ethereum Sepolia or Arbitrum One, per
  `NETWORK-OPTIONS.md` §4) — a conventional subgraph is simpler and sufficient there.
  It **is** needed wherever Robinhood Chain history must be indexed at all, since that
  is the only Graph-ecosystem path that chain has (`NETWORK-OPTIONS.md` §3.4), and it
  becomes the more plausible path generally as volume approaches Scenario C, since
  sequential AssemblyScript handler execution — not any Graph pricing or policy — is
  the more likely throughput bottleneck at that scale (§1.3).
- **An analytics sink alongside the subgraph is recommended starting at Scenario B.**
  A subgraph's own aggregation entities (§3) cover daily/hourly rollups well within
  one schema, but cross-chain analytics, long-tail ad hoc queries, and joins outside
  the subgraph's own schema are better served by periodically exporting indexed (or
  Substreams) output into a conventional warehouse. This widens the read layer; it
  does not change where settlement truth lives.
- **Materialized aggregates: yes**, via the native timeseries/aggregation feature
  (§3), once the manifest is on specVersion 1.1.0 or later — this is the single
  highest-leverage recommendation in this document, since it directly addresses the
  hot-entity problem (§2), the pagination-cost problem (§4), and the query-cost
  problem (§7) with one native feature, rather than three separate bespoke fixes.
- **Should v5 emit a compact receipt schema? Yes, at the read layer, without implying
  any change to a fixed on-chain event.** A subgraph mapping already chooses which
  emitted fields to store; it need not mirror a 16-field v4 `SettlementReceipt`
  (`EVENT-SCHEMA.md` §5) or a 17-field `Settlement` entity 1:1. A narrower
  `CompactReceipt`-shaped entity — storing only what cannot be cheaply recomputed or
  looked up elsewhere (order id, recipient, payer, both amounts, currencies, block
  reference) and omitting fields a client can derive or fetch on demand (individual
  fee-rate breakdowns, oracle reference fields when `demonstrationOnly` is true) —
  would meaningfully reduce per-row storage width at Scenario B/C cardinality. This is
  a v5+ read-layer design choice within the mapping, not a change to the fixed v4
  event surface, which this document does not propose altering.

## 9. Sources

See `docs/unica-v5/graph/NETWORK-OPTIONS.md` §8 for the full source table this
document shares (the registry JSON, `graph-node` docs, and Studio pricing page in
particular). Additional sources specific to this document:

| URL | Retrieved | Author/Org | Kind | Used for |
| --- | --- | --- | --- | --- |
| https://thegraph.com/docs/en/subgraphs/best-practices/timeseries/ | 2026-09-11 | The Graph | OFFICIAL | §3 timeseries and aggregation entities |
| https://thegraph.com/docs/en/subgraphs/querying/graphql-api/ | 2026-09-11 | The Graph | OFFICIAL | §4 pagination guidance, block-pinned query caveat |
| https://thegraph.com/docs/en/subgraphs/developing/creating/advanced/ | 2026-09-11 | The Graph | OFFICIAL | grafting reference (not load-bearing to any recommendation above); confirmed no pruning/retention statement on this page |
| https://thegraph.com/docs/en/subgraphs/developing/deploying/multiple-networks/ | 2026-09-11 | The Graph | OFFICIAL | §5 one-manifest-per-network confirmation (title/existence only; full body not fetched) |
| https://thegraph.com/docs/en/subgraphs/guides/subgraph-composition/ | 2026-09-11 | The Graph | OFFICIAL | §5, §8 subgraph composition existence (title only; full mechanics UNKNOWN, see §10) |
| https://thegraph.com/blog/substreams-parallel-processing/ | 2026-09-11 | The Graph | OFFICIAL | §1.3, §8 Substreams throughput framing |
| https://github.com/graphprotocol/graph-node (docs/environment-variables.md, docs/config.md) | 2026-09-11 | The Graph | OFFICIAL | §6 reorg threshold (250 blocks default) and cache size (500 blocks default) |
| `integrations/graph/schema.graphql`, `integrations/graph-v2/schema.graphql`, `integrations/graph-v2/README.md` | 2026-09-11 | this repository | repository (existing work, not re-derived) | §0, §2, §5, §6 baseline facts about what is actually built today |
| `docs/unica-v4/EVENT-SCHEMA.md` | 2026-09-11 | this repository | repository, SPECIFIED-NOT-BUILT | §0, §1, §2 v4 event-volume model |
| `docs/unica-v4/V5-DEFERRED.md` | 2026-09-11 | this repository | repository | §8 second-chain precondition |

## 10. Unknowns

Every item here is an honest gap, not a guess.

1. **No graph-node throughput ceiling (events/sec for WASM handler execution) was
   found in any source fetched in this pass.** Scenario C's indexing feasibility
   (§1.3) is discussed qualitatively for this reason, not with a hard number.
2. **The exact maximum `first` pagination value (reported as 1,000) and default
   (reported as 100)** were not independently confirmed with a direct page quote in
   this pass — same caveat as `NETWORK-OPTIONS.md` §9's Studio rate-limit figure.
3. **No default or maximum query-complexity limit** was found stated on the official
   GraphQL API docs page fetched in this pass.
4. **Whether historical timeseries/aggregation entities can be backfilled** for data
   written before a schema adopts the feature, and what storage overhead the feature
   adds, were not stated on the one timeseries docs page fetched in this pass.
5. **The exact mechanics of subgraph composition** (§5, §8) — how a composing
   subgraph's manifest references a composed one, whether both must be co-located or
   independently published, and what latency or cost it adds — were not fetched
   beyond confirming the feature's existence and page title.
6. **No stated automatic retention/pruning policy for subgraph data at the
   application-schema level** was found; graph-node's own internal storage-pruning
   machinery was referenced in passing in one search result but not independently
   confirmed or quantified in this pass.
7. **No transcript of any channel discussion about UNICA's own scale targets or
   settlement-cadence expectations was supplied** to this record. Every volume
   scenario above is either given directly by this stream's own assignment (the three
   named scale points) or estimated from the existing, cited repository schemas and
   specifications — never inferred from an unavailable discussion.
8. **Whether a real Robinhood-Chain Substreams pipeline (via the Pinax endpoint
   named in `NETWORK-OPTIONS.md` §4) can actually sustain Scenario B's ~35 events/sec
   or Scenario C's ~1,157 events/sec** was not measured; this document recommends it
   as the more plausible path at that scale on qualitative grounds only (§1.3, §8),
   not a benchmarked one.
9. **The per-row storage cost (dollars, or gigabytes per million rows) of either
   existing UNICA schema, on either Studio's own infrastructure or a self-hosted
   Postgres store,** was not found or estimated from an official source in this pass —
   any storage-cost comparison in this document is qualitative, not quantitative.
