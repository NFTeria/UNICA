# UNICA v5 — The Graph: network options and indexing paths

Research and design record. Read-only research; authorizes no deployment, no account
creation, no paid infrastructure, and no publication of any subgraph. Every claim below
is labeled VERIFIED (with source), PROPOSED (UNICA design), or UNKNOWN. Retrieval date
for every source cited here is 2026-09-11 unless a source's own row states otherwise.

Scope: the FROM SCRATCH track (owner confirmed 2026-09-11; earlier drafts elsewhere in
this project said Continuity, which was wrong and is not repeated here). No transcript
of any channel discussion was supplied to this record; nothing below reports,
summarizes, or attributes an idea to that discussion. Every claim traces to a public
source, the existing repository, or is marked PROPOSED / UNKNOWN.

## 0. What exists today (read, not re-derived)

- `integrations/graph/` — one live-shape subgraph, specVersion 1.0.0, apiVersion 0.0.9,
  network `sepolia`. Two data sources on one ABI (`V4SettlementHook`): V1 hook
  `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` from start block 11639895, and V3 hook
  `0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0` from start block 11667702. One event
  handler, `SettlementReceipt(...)` → `handleSettlementReceipt`. Schema: exactly one
  entity, `Settlement @entity(immutable: true)`, 17 scalar fields, no relations, no
  aggregation, no derived fields.
- `integrations/graph-v2/` — a separate manifest and schema (`InvoiceSettlement`,
  `Deployment`) for the V2 `QuoteSettlementExecutor`. Not deployed to any public chain;
  the address in its manifest is fork-local. `Deployment` is the one entity in either
  subgraph with a `@derivedFrom` relation and running counters
  (`settlementCount`, `firstBlock`, `lastBlock`).
- Neither subgraph is deployed to Subgraph Studio or the decentralized network. No
  Subgraph Studio account and no query-fee payment method exists for either (this
  stream did not create one; none is authorized).
- UNICA v4 contracts **do not exist yet**. The v4 event surface (12 events across 3
  emitting contracts) is specified only, in `docs/unica-v4/EVENT-SCHEMA.md` and
  `docs/unica-v4/SPEC-CONTRACTS.md`. Every v4 event named in this document is
  **SPECIFIED-NOT-BUILT** and is cited to the section it comes from; none is presented
  as an event a contract emits today.
- `EVENT-SCHEMA.md` §10 already records, as of 2026-09-11: The Graph's support for
  Robinhood Chain Testnet (46630) is **UNKNOWN, not probed**; Arbitrum One (42161)
  support is recorded YES from the project's own Mainnet Capability Probe; and until
  46630 support is recorded, its history is proposed to come from a bounded event
  indexer or a clearly limited beta history view. §4 of this document probes The
  Graph's own public registry directly and reports what it actually says — including
  for Arc testnet, which the v4 evidence files do not mention at all.

## 1. Method

Every option below is checked against The Graph's official documentation, the public
supported-networks registry (both the rendered docs page and the underlying
`graphprotocol/networks-registry` GitHub repository, which is the registry's primary
source data), `graph-cli`/`graph-node` docs, and, for prize framing only, ETHGlobal's
current published prize page for this event. A claim with no source that loads is
listed UNKNOWN in §9 rather than inferred. Chain ids used throughout: Ethereum Sepolia
`eip155:11155111`, Robinhood Chain Testnet `eip155:46630`, Arc testnet
`eip155:5042002` — all three confirmed against the registry itself in §4, not assumed
from the task brief.

## 2. Comparison table (summary)

| Option | Official status | Robinhood Chain (46630) | Arc testnet (5042002) | Decentralization | Prize-eligibility confidence |
| --- | --- | --- | --- | --- | --- |
| 3.1 Standard subgraph (Studio + gateway) | VERIFIED, core product | **NOT AVAILABLE** — empty `subgraphs` registry entry | **AVAILABLE** — Studio deploy URL registered | Single operator until published | UNKNOWN, see §6 |
| 3.2 Studio + its pre-publish query URL | VERIFIED, on-ramp to 3.1 | same as 3.1 | same as 3.1 | Single operator (Studio infra) | UNKNOWN, see §6 |
| 3.3 Published decentralized-network subgraph | VERIFIED mechanism | blocked — no subgraph target exists to publish | possible in principle; Indexer opt-in UNKNOWN | Real, multi-Indexer | UNKNOWN, plausibly strongest, see §6 |
| 3.4 Substreams | VERIFIED product | **AVAILABLE** via Pinax (+ StreamingFast, mainnet only) | **NOT AVAILABLE** — no provider endpoint registered | Compute open; today's endpoints are named third parties | Named explicitly on the prize page for one sub-track |
| 3.5 Firehose | VERIFIED product (StreamingFast) | same availability as 3.4 | same as 3.4 | same as 3.4 | UNKNOWN, not named standalone on the prize page |
| 3.6 Substreams-powered subgraph | VERIFIED product (graph-node is "Substreams aware") | UNKNOWN — registry does not distinguish this from 3.1's empty entry | possible for the subgraph half; no Substreams source yet | Depends on components | Named explicitly on the prize page |
| 3.7 Self-hosted graph-node | VERIFIED, open source | **AVAILABLE** — any RPC works, registry listing is irrelevant | **AVAILABLE** | Single operator only | UNKNOWN, likely weak |
| 3.8 Third-party Graph-compatible host/sink | third-party, not a Graph Foundation product | Pinax already serves this chain | Pinax serves this chain's RPC, not its Graph services | Provider-specific | UNKNOWN, and this document takes no position |
| 3.9 Direct RPC and log fallback | not a Graph product | **AVAILABLE** — public RPC listed in the registry | **AVAILABLE** — public RPC listed in the registry | As decentralized as the RPC operators used | VERIFIED low/none — no Graph product involved |
| 3.10 Hybrid | PROPOSED (UNICA design) | combines the above per §7 | combines the above per §7 | mixed | inherits the Graph-touching piece's confidence |

Full detail, including historical backfill, latency, finality/reorg handling, dynamic
data sources, cost, query limits, operational burden, public verifiability, and failure
behavior, is in §3, per option.

## 3. Options, in detail

### 3.1 Standard subgraph on a supported network (Subgraph Studio + gateway)

- **Official status.** VERIFIED. The core Graph product: a manifest, GraphQL schema and
  AssemblyScript mapping compiled and deployed with `graph-cli` to Subgraph Studio, then
  optionally published to the decentralized network (§3.3). Both existing UNICA
  subgraphs (`integrations/graph`, `integrations/graph-v2`) are this kind.
- **Supported chains.** VERIFIED. The public registry
  (`github.com/graphprotocol/networks-registry`, `main` branch, retrieved 2026-09-11)
  lists 130+ EVM entries under `registry/eip155/`. Ethereum mainnet, Ethereum Sepolia,
  Arbitrum One, Arc mainnet and Arc testnet all carry
  `"services": {"subgraphs": ["https://api.studio.thegraph.com/deploy"]}` in their
  registry JSON — a live Studio deploy target.
- **Robinhood Chain availability.** VERIFIED **NOT SUPPORTED**. Both
  `registry/eip155/robinhood.json` (mainnet, `eip155:4663`) and
  `registry/eip155/robinhood-sepolia.json` (testnet, `eip155:46630`, aliased
  `evm-46630`, `robinhood-testnet`) carry `"services": {"subgraphs": []}` — an empty
  array. No Studio subgraph-indexing deploy target is registered for either Robinhood
  Chain network as of 2026-09-11. This resolves, as **NO**, the item
  `docs/unica-v4/EVENT-SCHEMA.md` §10.1 records as "UNKNOWN: not probed" for 46630.
  (A rendered docs page under the guessed slugs `supported-networks/robinhood-testnet/`
  and `supported-networks/robinhood-chain-testnet/` both 404 — consistent with the
  registry finding, though the registry JSON is the primary evidence, not the 404s.)
- **Arc testnet availability.** VERIFIED **SUPPORTED**. `registry/eip155/arc-testnet.json`
  lists `"caip2Id": "eip155:5042002"` (matching the task brief's chain id exactly) and
  `"services": {"subgraphs": ["https://api.studio.thegraph.com/deploy"]}`. It also has
  a live rendered docs page at `thegraph.com/docs/en/supported-networks/arc-testnet/`
  (VERIFIED by direct fetch).
- **Historical backfill.** VERIFIED, general mechanic. Graph-node indexes forward from a
  manifest's configured `startBlock`, replaying chain data from a connected
  EVM-compatible JSON-RPC endpoint; depending on the subgraph's features an archive
  node or one supporting `trace_filter`/EIP-1898 may be required
  (`thegraph.com/docs/en/indexing/tooling/graph-node/`). A subgraph does not see history
  before its own `startBlock`; reaching further back means redeploying with an earlier
  one and re-syncing that whole range.
- **Latency.** No official numeric SLA was found in this pass. UNKNOWN precise figure;
  UNICA's own design principle already on record treats indexer lag as always shown,
  never presented as current status (`EVENT-SCHEMA.md` §2).
- **Finality/reorg handling.** VERIFIED. Graph-node's documented environment variables
  `ETHEREUM_REORG_THRESHOLD` (default 250 blocks) and `cache_size` (default 500 blocks,
  must exceed the reorg threshold) govern how large a reorg the indexer tolerates before
  data can become inconsistent (`github.com/graphprotocol/graph-node`,
  `docs/environment-variables.md`, `docs/config.md`).
- **Dynamic data sources.** VERIFIED. "Data source templates" let a handler instantiate
  new chain-based data sources at runtime (`thegraph.com/docs`, Advanced Subgraph
  Features page) — the exact mechanism `EVENT-SCHEMA.md` §10.2 proposes for
  per-market `UnicaMarketHook`/`UnicaMarketExecutor` templates keyed by `marketId`.
- **Cost.** VERIFIED for querying: Studio's published pricing states "100,000 free
  monthly queries," then "$2 per 100,000 queries" beyond that
  (`thegraph.com/studio-pricing/`, retrieved 2026-09-11). Deploying and testing on
  Studio itself is free. The GRT cost of curation signal to attract an Indexer once
  published (§3.3) was not found with a current figure in this pass — UNKNOWN.
- **Query limits.** VERIFIED 100,000 free queries/month against a Studio-issued API key
  through the gateway. A commonly repeated figure of 3,000 queries/day for the
  pre-publish Studio testing query URL appeared consistently across web search
  summaries of `thegraph.com` docs, but this document could not independently confirm
  it with a direct quote from a fetched page in this pass (two attempts against the
  Studio FAQ page returned no rate-limit text) — carried here as **reported, not
  independently verified**; see §9.
- **Operational burden.** PROPOSED assessment: lowest of every option that reaches
  production. Write a manifest, schema and mapping; `graph codegen && graph deploy`;
  Studio hosts the indexing infrastructure. No servers to run.
- **Public verifiability.** VERIFIED. Manifest, schema and mapping source are visible on
  Studio and (once published) on the network's Explorer; anyone can redeploy the same
  manifest against the same chain and compare results.
- **Decentralization.** Studio-hosted only is a single operator (Studio's own
  infrastructure), not decentralized; publishing to the network (§3.3) is what makes it
  decentralized.
- **Prize-eligibility confidence.** See §6 — UNKNOWN without a written answer from an
  identifiable Graph team member. The ETHOnline 2026 prize page states plainly:
  "Simply querying one Subgraph with no composition or standardization does not
  qualify" for its Composable/Standardized track (VERIFIED, fetched prize page,
  quoted in full in §6) — a plain single-entity subgraph like the current
  `Settlement` schema risks that exact bar.
- **Failure behavior.** VERIFIED as UNICA's own standing design principle, already on
  record: settlement correctness never depends on an indexer (`EVENT-SCHEMA.md` §2,
  "Current state is not history"; repeated in this stream's own brief). An indexing
  outage or lag means a subgraph shows stale or missing history, never a wrong or
  fabricated payment status — provided the consuming surface always reconfirms over RPC
  before treating anything as settled, exactly as `integrations/graph-v2/provider.mjs`
  already does for V2 (freshness check against an independent RPC head, refusal on
  staleness or indexing errors, no fixture fallback).

### 3.2 Subgraph Studio and its staging endpoint

- **Official status.** VERIFIED. Subgraph Studio
  (`thegraph.com/docs/en/subgraphs/providers/subgraph-studio/introduction/`) is the
  official deploy and development tool; every new subgraph has gone through it since
  The Graph's Hosted Service was sunset on 2024-06-12 (VERIFIED, corroborated by
  `thegraph.com/blog/sunsetting-hosted-service/` and multiple 2026-retrieved secondary
  sources describing the same date).
- **What "staging" means here.** PROPOSED clarification, stated honestly because the
  official docs fetched in this pass did not use the word "staging" as a distinct named
  tier: the closest official analogue found is Subgraph Studio's own pre-publish query
  URL (pattern `https://api.studio.thegraph.com/query/<ID>/<SUBGRAPH_NAME>/<VERSION>`),
  described by search-engine summaries of The Graph's docs as "intended for testing
  purposes only and rate-limited," as distinct from the post-publish gateway URL
  (`https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/<SUBGRAPH_ID>`). This
  document treats that pre-publish URL as "the staging endpoint" the task brief refers
  to; a team member could confirm whether The Graph has since introduced a
  separately-branded staging tier not surfaced in this pass — see §9.
- **Query limits.** As in §3.1: reported (not independently page-confirmed) ~3,000
  queries/day pre-publish; 100,000 free/month once queried via an API key against the
  gateway (VERIFIED for the latter figure).
- **Distinguishing property.** VERIFIED via the pricing page: a subgraph need never be
  "published" to the decentralized network at all — production queries can be served
  indefinitely straight from Studio's own API-key/gateway path, priced the same
  "100,000 free, then $2/100,000" way. Publishing (§3.3) is a separate, optional step
  that adds decentralized serving, not a requirement to serve queries in production.
- **Decentralization.** NOT decentralized. Whether or not a subgraph is later
  published, Studio's own query serving is Studio/Edge & Node infrastructure — a single
  operator.
- **Failure behavior.** Same single-operator risk as any centralized API: a Studio
  infrastructure outage stops queries entirely. UNICA's settlement correctness is
  unaffected only under the same rule as §3.1: nothing in the payment-confirmation path
  may read status from Studio instead of the chain.

### 3.3 Published decentralized-network subgraph

- **Official status.** VERIFIED. Studio's "Publish" step places a subgraph's metadata
  on the decentralized network, opening it to curation (GRT signal) and Indexer
  participation (`thegraph.com/blog/upgrade-indexer/`).
- **Opt-in mechanism.** VERIFIED. Indexers choose which subgraphs to index based on
  curation signal and expected query-fee revenue; a subgraph is not guaranteed
  independent-Indexer coverage merely by being published. The **Upgrade Indexer**, a
  Graph-Foundation-run bootstrapping Indexer, exists specifically "to ensure that every
  single subgraph that upgrades to the network can be served by the network," including
  ones with no independent Indexer yet, until curation attracts independent Indexers
  (VERIFIED, `thegraph.com/blog/upgrade-indexer/`, retrieved 2026-09-11). The blog post
  also states plainly that new chains served by the Upgrade Indexer "will not
  immediately be eligible for indexing rewards" — rewards are a separate, governed
  step (the Chain Integration Process) from being served at all.
- **Publishing on a chain with no indexing rewards.** The registry's `issuanceRewards`
  field is `false` for Arc mainnet, Arc testnet, Robinhood Chain mainnet and Robinhood
  Chain testnet, and `true` for Ethereum mainnet, Ethereum Sepolia and Arbitrum One
  (VERIFIED, registry JSON, §4). Nothing found in this pass restricts *publishing* a
  subgraph to only reward-eligible chains — the Upgrade Indexer's own stated purpose
  (serving every subgraph regardless) implies publishing on a non-reward chain is
  possible in principle. What is **UNKNOWN** from the sources read here: whether an
  independent Indexer is ever expected to opt in for a chain with no rewards, beyond
  the Upgrade Indexer's bootstrap coverage, and for how long that coverage is
  guaranteed. This is listed in §9 and is a good candidate for a written team answer.
- **Robinhood Chain, specifically.** Moot regardless of the rewards question: since
  `services.subgraphs` is empty for both Robinhood networks (§3.1), there is no Studio
  deploy target to publish in the first place. A standard subgraph cannot be built for
  Robinhood Chain today at all, independent of indexing-rewards eligibility.
- **Arc testnet, specifically.** A Studio deploy target exists (§3.1), so publishing is
  possible in the mechanical sense described above; whether an independent Indexer
  actually opts in given `issuanceRewards: false` is UNKNOWN without a trial or a team
  answer.
- **Cost.** Publishing requires GRT for curation signal; no current minimum-signal
  dollar or GRT figure was found in this pass — UNKNOWN. Query costs once served
  through the gateway are as in §3.1.
- **Decentralization.** VERIFIED. This is the only option in this comparison that is
  actually decentralized as shipped: multiple independent Indexers can serve the same
  subgraph, with the gateway routing across them.
- **Failure behavior.** A properly decentralized deployment degrades to "fewer
  Indexers serving it," not full unavailability, as long as at least one Indexer
  (Upgrade Indexer included) remains live.
- **Prize-eligibility confidence.** Plausibly the strongest of any option in this table
  for "live use of a Graph product," since it is the most literal reading of the prize
  page's "consume live data from a Graph provider" language — but this document does
  not conclude eligibility, and no UNICA subgraph is published today: publishing is
  itself a form of publication, out of this stream's read-only, no-deployment scope,
  and no owner authorization to publish exists (consistent with
  `EVENT-SCHEMA.md` §1, "Q131 NO AUTHORIZATION").

### 3.4 Substreams

- **Official status.** VERIFIED. A Rust-based, parallelized stream-processing framework
  that transforms raw chain data into typed protobuf outputs, developed by
  StreamingFast as part of The Graph ecosystem; official docs at `docs.substreams.dev`.
  The Graph's own blog frames it plainly: "Substreams enable massively parallelized
  streaming data... some subgraphs could sync more than 100x faster"
  (`thegraph.com/blog/substreams-parallel-processing/`).
- **Robinhood Chain availability.** VERIFIED **AVAILABLE**. Both registry entries list
  live Substreams endpoints. Mainnet (`robinhood.json`):
  `robinhood.substreams.pinax.network:443`, `mainnet.robinhood.streamingfast.io:443`,
  `robinhood.substreams.data.nexus:443`. Testnet/46630 (`robinhood-sepolia.json`):
  `robsepolia.substreams.pinax.network:443`. This is the sharpest finding of this
  document: Robinhood Chain has **no** subgraph-indexing path via Studio (§3.1), but it
  **does** have a working Substreams path, via named third-party providers (Pinax, and
  for mainnet also StreamingFast).
- **Arc testnet availability.** VERIFIED **NOT AVAILABLE**, as of 2026-09-11. Neither
  `arc.json` nor `arc-testnet.json` carries a `services.substreams` array at all — no
  named Substreams provider is registered for Arc or Arc testnet, even though both
  files carry the generic Firehose block-type descriptor (`sf.ethereum.type.v2.Block`)
  a provider would need to build one.
- **Historical backfill.** VERIFIED. Each registry entry names a
  `firehose.firstStreamableBlock`, so Substreams can in principle replay from a chain's
  first streamable block — backfill is bounded by the provider's own retention, not by
  when a UNICA subgraph happens to be deployed.
- **Latency.** VERIFIED directionally (designed for high parallel throughput, per the
  blog post cited above); no chain-specific numeric figure for a Robinhood-Chain
  pipeline was found — UNKNOWN without building and measuring one.
- **Dynamic data sources.** PROPOSED characterization: Substreams modules are composed
  at the package/module-graph level, not instantiated at runtime the way subgraph data
  source templates are (§3.1); UNICA's per-market template need is a subgraph or
  Substreams-powered-subgraph (§3.6) concern more naturally than a raw Substreams-module
  one.
- **Cost.** UNKNOWN in dollar terms; a named provider's (Pinax's) specific pricing was
  not fetched in this pass, and self-hosting a Firehose+Substreams stack is its own,
  unpriced-here, operational cost.
- **Operational burden.** PROPOSED: higher than a standard subgraph. Requires writing
  Rust modules and a `substreams.yaml` manifest, versus a subgraph's declarative
  manifest and AssemblyScript handler — a real learning curve given both existing UNICA
  indexers (`integrations/graph`, `integrations/graph-v2`) are conventional
  AssemblyScript subgraphs.
- **Public verifiability.** VERIFIED. Substreams packages (`.spkg`) are inspectable
  artifacts; output can be independently re-derived by anyone running the same package
  against the same or an equivalent Firehose.
- **Decentralization.** The compute model is open to any compliant Firehose, but the
  concrete endpoints available for Robinhood Chain today are named third-party
  operators (Pinax, StreamingFast) — not yet a fully permissionless market the way
  §3.3's decentralized network is.
- **Prize-eligibility confidence.** The ETHOnline 2026 prize page names a specific,
  concrete bar for its "From Scratch" AI track: "For Substreams challenge:
  demonstrate deploying a working Substreams pipeline from a single prompt" (VERIFIED,
  fetched prize page, quoted in full in §6) — a real, named path if UNICA pairs a
  Substreams pipeline with an AI/automation surface. UNKNOWN whether the existing
  deterministic (explicitly non-LLM) treasury analyst in
  `integrations/graph-v2/copilot.mjs` — its own README states "the 'AI' is a
  deterministic analyst, not a model call" — would itself satisfy a "single prompt"
  framing without an actual LLM step added; this is a design and eligibility question,
  not resolved here.
- **Failure behavior.** A provider outage stops the stream; UNICA's settlement
  correctness is unaffected under the same "never depends on an indexer" principle,
  provided the pipeline only ever answers "what happened," never "is this payment
  good."

### 3.5 Firehose

- **Official status.** VERIFIED. StreamingFast's low-level, gRPC-streamed,
  cursor-resumable raw block-data layer underneath both graph-node's chain ingestion
  and Substreams (`thegraph.com/blog/subgraphs-substreams-firehose-explained/`;
  `firehose.streamingfast.io`).
- **Robinhood Chain / Arc testnet availability.** Same finding as §3.4: Robinhood Chain
  (both networks) has live Firehose endpoints (Pinax on both; StreamingFast and
  "data.nexus" on mainnet only); Arc and Arc testnet carry only the block-type
  descriptor, no live named endpoint, as of 2026-09-11.
- **What it is for here.** PROPOSED: Firehose alone is not a query product. UNICA would
  only ever consume it as the transport underneath a Substreams package (§3.4) or a
  self-hosted graph-node's chain ingestion (§3.7) — never directly from an application
  surface.
- **Cost / operational burden / decentralization / failure behavior.** Inherited from
  whichever of §3.4 / §3.6 / §3.7 sits on top of it. Consuming it directly (writing a
  bespoke Firehose client) is the highest-burden, most bespoke option in this whole
  comparison and is not justified for UNICA's flat-receipt read model.
- **Prize-eligibility confidence.** UNKNOWN. Firehose is not named as its own eligible
  product on the fetched ETHOnline 2026 prize page (only Subgraph Studio / The Graph
  Market, Substreams, and standardized schemas are named); using it invisibly under
  Substreams likely inherits that path's framing rather than standing alone.

### 3.6 Substreams-powered subgraph

- **Official status.** VERIFIED. Graph-node is "Substreams aware": a subgraph manifest
  can declare a Substreams package as its data source instead of, or alongside,
  conventional event-handler data sources, combining Substreams' parallel-processing
  speed with a normal GraphQL query surface served through graph-node/Studio (VERIFIED,
  `thegraph.com/blog/subgraphs-substreams-firehose-explained/`; GIP-0053, "Enabling
  substreams-based subgraphs,"
  `github.com/graphprotocol/graph-improvement-proposals`).
- **Robinhood Chain.** UNKNOWN. A live Substreams endpoint exists for Robinhood Chain
  (§3.4), but `services.subgraphs` is empty for it (§3.1). Whether a Substreams-powered
  subgraph can still be deployed and served through Studio for a chain whose
  conventional `subgraphs` array is empty was not resolved by any source read in this
  pass — the registry schema does not label which of the two subgraph mechanisms an
  empty array actually refers to, and no fetched doc page addressed the combination
  directly. This is a good, concrete candidate for a hands-on trial or a written team
  answer; see §9.
- **Arc testnet.** Has a Studio deploy target (§3.1) but, per §3.4, no named Substreams
  provider yet — so a Substreams-powered subgraph has nothing to source from today even
  though the ordinary-subgraph path is open.
- **Everything else.** Combines §3.1's query interface, cost and query limits with
  §3.4's ingestion speed and Rust-authorship operational burden.
- **Prize-eligibility confidence.** Directly named as an example on the ETHOnline 2026
  prize page's Composable/Standardized track ("compose reusable Substreams packages
  into new pipelines... consume live data from a Graph provider" — VERIFIED, quoted in
  full in §6), though whether a specific UNICA implementation "qualifies" remains a
  judgment this document does not make.

### 3.7 Self-hosted graph-node

- **Official status.** VERIFIED. Graph-node is open source
  (`github.com/graphprotocol/graph-node`) and documented to run "on bare metal, or in a
  cloud environment," built from source or via Docker images
  (`thegraph.com/docs/en/indexing/tooling/graph-node/`).
- **Robinhood Chain / Arc testnet availability.** VERIFIED **YES**, regardless of
  registry-listed support. A self-hosted graph-node's `[chains]` section in
  `config.toml` points at any EVM-compatible JSON-RPC endpoint an operator supplies;
  the official docs explicitly frame this as the intended path for "many Subgraphs
  indexing unsupported networks" that a chosen chain integration process has not yet
  reached (same source as above). This is the one option in this comparison where "the
  registry doesn't list it" is not a blocker at all: Robinhood Chain Testnet's own
  public RPC (`https://rpc.testnet.chain.robinhood.com`, per the registry JSON and
  matching `docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md`'s own `rpcEnv` convention for
  46630) is something a self-hosted graph-node could point at directly today.
- **Historical backfill / latency / reorg handling.** Same graph-node mechanics as
  §3.1 (`ETHEREUM_REORG_THRESHOLD` default 250 blocks, `cache_size` default 500 blocks
  — VERIFIED, graph-node docs), except the operator, not Studio, runs and pays for the
  Postgres store and the RPC/archive access, and is responsible for patching.
- **Cost.** No Studio/gateway query fees at all; the entire cost is the operator's own
  compute, storage and RPC access. Dollar figures are UNKNOWN without pricing a
  specific host, and out of this stream's scope regardless (RULES bar creating any paid
  infrastructure).
- **Query limits.** None imposed by The Graph; bounded only by what the operator's own
  server can sustain, unless later published to the network (§3.3).
- **Operational burden.** Highest of the run-it-yourself options: a database, a synced
  or RPC-accessible chain node, the graph-node binary or container, monitoring, and
  upgrades, all owned by UNICA.
- **Public verifiability.** Not automatically lower or higher than Studio — nothing
  about self-hosting makes results less verifiable, but nothing makes them verifiable
  either, unless the operator also publishes the manifest and documents how to
  reproduce the deployment.
- **Decentralization.** NOT decentralized: a single operator's server, unless multiple
  independent parties each run their own instance from the same public manifest.
- **Prize-eligibility confidence.** UNKNOWN, and likely weak: none of the three
  ETHOnline 2026 Graph tracks (quoted in full in §6) describe self-hosting graph-node
  as the "use" being rewarded — the prize page's own language ("consume live data from
  a Graph provider," "Subgraph Studio or The Graph Market") points at Graph-operated or
  Graph-network infrastructure, not a private graph-node. Not asserted as ineligible
  here — only as unconfirmed, and a fair question for a team member.
- **Failure behavior.** An outage is entirely UNICA's own to detect and fix; none of
  the decentralized network's redundancy applies.

### 3.8 Third-party Graph-compatible host or sink

- **Official status.** Third-party by definition, not an Edge & Node/Graph Foundation
  product. Concrete examples surfaced in this research: **Pinax**, which is already a
  named Substreams/Firehose/RPC provider for essentially every chain checked in this
  pass, including both Robinhood Chain networks, and is also **the current redirect
  target of The Graph's own Token API documentation** (see below); and
  **StreamingFast**, Firehose's own operating company, also a named provider for
  several chains including Robinhood Chain mainnet.
- **The Token API.** VERIFIED by direct fetch: `thegraph.com/docs/en/token-api/quick-start/`
  returns an HTTP 301 redirect to `https://app.pinax.network/docs/api/`, retrieved
  2026-09-11. The Graph's own docs site now sends Token API documentation traffic to
  Pinax, a third-party ecosystem provider, rather than hosting the docs on
  `thegraph.com` itself. Whether the Token API still counts as "a Graph product" for
  prize-eligibility purposes given this redirect is UNKNOWN, and is exactly the kind of
  question this record declines to settle without a written team answer (see §6, §9).
- **SubQuery and Alchemy Subgraphs.** Found only as historical Hosted-Service-sunset
  migration alternatives in community sources
  (`subquery.medium.com`, `alchemy.com/blog`, retrieved 2026-09-11), not as
  Graph-branded products. SubQuery in particular is its own independent indexing
  protocol with GraphQL compatibility, not a product of The Graph; noted here for
  completeness and not evaluated further, since it would not plausibly count as "using
  The Graph" for a Graph-sponsored prize track.
- **Robinhood Chain / Arc testnet.** Pinax is already a named provider for Robinhood
  Chain's (mainnet and testnet) Substreams/Firehose services, and separately for Arc
  testnet's plain RPC (`rpcUrls`, not a Graph-branded service). Using Pinax directly for
  Robinhood Chain, outside The Graph's own gateway/Studio product, is mechanically
  possible today (its hostnames are public, listed in the registry) but is a
  relationship with that provider specifically, not with "The Graph" as a brand or
  protocol.
- **Cost / operational burden / decentralization.** Provider-specific; UNKNOWN without
  contacting the provider, which is out of scope for this read-only record (no account
  or paid infrastructure is authorized by the assignment).
- **Prize-eligibility confidence.** UNKNOWN, and this document takes no position:
  routing through a third-party operator that happens to appear in The Graph's own
  public registry (or in its own docs' redirect target) is a materially different claim
  than "using The Graph," and only a written answer from an identifiable Graph team
  member settles which side of that line a given integration falls on.

### 3.9 Direct RPC and log fallback

- **Official status.** Not a Graph product. This is the baseline `eth_getLogs`/
  `eth_call` path any EVM chain offers on its own, already the backbone of UNICA v4's
  own design: `docs/unica-v4/EVENT-SCHEMA.md` §10.3 already specifies exactly this
  fallback for 46630 today — "a bounded event indexer" or "a clearly limited beta
  history view," both built on raw RPC, with no Graph product involved.
- **Robinhood Chain / Arc testnet availability.** VERIFIED via each chain's own public
  RPC, independent of any Graph product's support status. Robinhood Chain Testnet's
  registry entry lists `https://rpc.testnet.chain.robinhood.com` and a Pinax-hosted
  mirror; Arc Testnet's lists `https://rpc.testnet.arc.network` and a dRPC mirror
  (VERIFIED, registry JSON, §4).
- **Historical backfill.** Bounded only by the RPC's own retention (full archive vs.
  pruned) and by whatever `eth_getLogs` page-size limits a given provider imposes;
  exact limits for these specific public endpoints were not load-tested in this
  read-only pass — UNKNOWN.
- **Latency.** As fast as the RPC's own block propagation; no structural indexing lag
  at all, because there is no indexer.
- **Finality/reorg handling.** Entirely the caller's own responsibility. UNICA v4's own
  watcher and readback scripts already carry this responsibility explicitly
  (`EVENT-SCHEMA.md` §9, row "W").
- **Dynamic data sources.** Not applicable — there is no manifest; a script decides
  what to scan.
- **Cost.** Whatever the RPC provider charges, or free-tier limits allow; no Graph
  pricing applies.
- **Query limits.** The RPC provider's own, not The Graph's.
- **Operational burden.** A committed, tested script — already the exact shape UNICA
  v4 specifies for the 46630 fallback — rather than a hosted product; lower burden than
  self-hosting graph-node, higher than a Studio-hosted subgraph, for equivalent history
  depth.
- **Public verifiability.** VERIFIED as high as the chain itself: any third party with
  the same RPC access and the same script can reproduce the same result
  deterministically — the fewest trust assumptions of any option here, beyond the chain
  and the RPC operator's own honesty about what it returns.
- **Decentralization.** As decentralized as the RPC providers actually used (the
  registry already names more than one public RPC per chain); not decentralized in The
  Graph protocol's sense — no curation, no Indexer market.
- **Prize-eligibility confidence.** VERIFIED low to none for a Graph-specific prize,
  since no Graph product participates at all. This option earns its place in UNICA's
  design on correctness merits alone (the standing rule that settlement never depends
  on an indexer), not on any prize angle.
- **Failure behavior.** An RPC outage stops reads entirely until a fallback RPC is
  reached; UNICA v4's chain helper already refuses cleanly, never silently, when its
  named RPC variable is unset (`docs/unica-v4/SPEC-ORACLE-AND-CHAINS.md` §12.2 step 3).

### 3.10 Hybrid

PROPOSED (UNICA design), not a Graph product category. Combine §3.9 (direct RPC) as
the always-available, zero-indexer-dependency source for current state and settlement
confirmation, with whichever of §3.1 / §3.3 / §3.4 is actually available per chain for
historical or aggregate reads:

- a **standard published subgraph** on a registry-supported, `issuanceRewards: true`
  chain (Ethereum Sepolia or Arbitrum One, per §4);
- a **Substreams pipeline** on Robinhood Chain, the only Graph-ecosystem path that
  chain actually has today (via Pinax/StreamingFast, §3.4);
- **self-hosted graph-node or direct RPC** on Arc testnet if and when a UNICA v4
  market exists there — Arc testnet has a Studio subgraph target but, per §3.4, no
  named Substreams provider yet, so a conventional subgraph or a plain RPC fallback are
  the two options actually available there today.

This is consistent with, not a departure from, the standing rule already on record:
"RPC serves current state and confirmation; The Graph serves indexed history where the
chain is supported, otherwise a bounded event indexer or a clearly limited beta history
view" (`EVENT-SCHEMA.md` §10, quoted verbatim). §7 below gives a concrete per-chain
recommendation. Operational burden is the sum of whichever pieces are chosen; prize
confidence is whatever the Graph-touching piece's own confidence is, since the RPC
piece contributes none on its own.

## 4. Robinhood Chain (46630) and Arc testnet (5042002): resolved against the registry

Probed directly against `github.com/graphprotocol/networks-registry` (`main` branch,
retrieved 2026-09-11), the primary source data behind `thegraph.com/docs/en/supported-networks/`.

| Chain | Registry id | caip2Id | `services.subgraphs` | `services.substreams` | `services.firehose` | `issuanceRewards` |
| --- | --- | --- | --- | --- | --- | --- |
| Robinhood Chain Mainnet | `robinhood` | `eip155:4663` | `[]` (empty) | Pinax, StreamingFast, "data.nexus" | Pinax, StreamingFast, "data.nexus" | `false` |
| **Robinhood Chain Testnet** | `robinhood-sepolia` | **`eip155:46630`** | **`[]` (empty)** | **Pinax only** | **Pinax only** | `false` |
| Arc Mainnet | `arc` | `eip155:5042` | Studio deploy URL present | not listed | not listed (block-type descriptor only) | `false` |
| **Arc Testnet** | `arc-testnet` | **`eip155:5042002`** | **Studio deploy URL present** | **not listed** | **not listed** (block-type descriptor only) | `false` |
| Ethereum Sepolia (reference) | `sepolia` | `eip155:11155111` | Studio deploy URL present | Pinax, StreamingFast | Pinax, StreamingFast | `true` |
| Ethereum Mainnet (reference) | `mainnet` | `eip155:1` | Studio deploy URL present | Pinax, StreamingFast | Pinax, StreamingFast | `true`; also lists a Token API endpoint (`tokenApi`) |
| Arbitrum One (reference) | `arbitrum-one` | `eip155:42161` | Studio deploy URL present | Pinax, StreamingFast | Pinax, StreamingFast | `true`; also lists a Token API endpoint |

**Resolution of the brief's specific questions:**

- *Is Ethereum Sepolia supported by Studio?* **YES** (VERIFIED, registry JSON).
- *Is Robinhood Chain testnet (46630) supported by Studio?* **NO** (VERIFIED,
  registry JSON: empty `subgraphs` array). This resolves
  `EVENT-SCHEMA.md` §10.1's "UNKNOWN: not probed" entry for 46630 to a definite answer,
  as of this retrieval date.
- *Is Arc testnet (5042002) supported by Studio?* **YES** (VERIFIED, registry JSON,
  and by a live rendered docs page).
- *Does a Substreams or Firehose provider exist for these chains?* Sepolia: **YES**
  (Pinax, StreamingFast). Robinhood Chain testnet: **YES** (Pinax). Arc testnet:
  **NO named provider** as of 2026-09-11, despite the protocol-level block-type
  descriptor being present.
- *Can a decentralized-network subgraph be published for a chain with no indexing
  rewards, and must an Indexer opt in?* See §3.3 — publishing itself is not blocked by
  `issuanceRewards: false`; the Upgrade Indexer bootstraps serving regardless; whether
  and for how long an *independent* Indexer is expected to opt in on a
  non-reward chain beyond that bootstrap is **UNKNOWN** from the sources read here.
- *Does a third-party host, a self-hosted graph-node, or the Token API count as live
  use of a Graph product?* **UNKNOWN** — not settled by this document; see §6 and §9.

## 5. Studio query limits and the gateway's free allowance

- **VERIFIED** (`thegraph.com/studio-pricing/`, retrieved 2026-09-11): "100,000 free
  monthly queries," "Your first 100K monthly queries are always free," then "$2 per
  100,000 queries" beyond that. No stated cap on subgraph creation ("unlimited
  subgraph creation," "unlimited testing" per the same page).
- **Reported, not independently page-confirmed in this pass**: a ~3,000 queries/day
  limit on the pre-publish Studio testing query URL. This figure appeared consistently
  across independent web-search summaries of `thegraph.com` docs pages, but two direct
  fetches of the Studio FAQ page in this pass did not surface rate-limit text to quote
  verbatim. Carried here as a probable but unconfirmed figure; see §9.
- **UNKNOWN**: the exact GRT cost of curation signal needed to attract independent
  Indexer interest once a subgraph is published (§3.3) was not found with a current
  number in this pass.

## 6. Prize-eligibility confidence

This section states facts and quotes the prize page; it does not conclude eligibility.
Any unresolved eligibility question belongs in this design set's mentor-questions
record (maintained elsewhere in `docs/unica-v5/graph/`, not created by this document),
per the assignment's own instruction never to claim prize eligibility as settled
without a written answer from an identifiable Graph team member.

**The Graph's three prize tracks at ETHOnline 2026**, quoted from
`ethglobal.com/events/ethonline2026/prizes` (VERIFIED, fetched 2026-09-11):

1. **"Best Use of Composable or Standardized Graph Products"** — $5,000 pool.
   "Either compose two or more of The Graph's products, or build meaningfully on a
   standardized schema." Must "consume live data from a Graph provider (Subgraph
   Studio or The Graph Market)." "Simply querying one Subgraph with no composition or
   standardization does not qualify." Open to all participants; requires a public repo
   and a 2–4 minute demo video.
2. **"Best AI Tooling or AI Use Case with The Graph (From Scratch)"** — $5,000 pool,
   net-new projects only. "Use The Graph as a load-bearing part of the project."
   Must consume live Graph data ("Mocked, local-only, or static datasets do not
   qualify"). Must "do meaningful work with the data: reasoning, decisions,
   automation, or a natural-language interface." For a Substreams-specific challenge:
   "demonstrate deploying a working Substreams pipeline from a single prompt."
3. **"Best AI Tooling or AI Use Case with The Graph (Continuity)"** — $5,000 pool,
   same requirements as track 2, for projects extending existing open-source work,
   with the pre-existing work documented and only event-period work judged.

**What this means for UNICA's existing candidate integrations, stated as open
questions, not conclusions:**

- The current live-shape subgraph (`integrations/graph`) is a single flat
  `Settlement` entity with no composition, no aggregation, and no standardized
  cross-protocol schema. Track 1's own stated bar — "Simply querying one Subgraph with
  no composition or standardization does not qualify" — appears, on its face, not to be
  met by that schema alone. Whether pairing it with `integrations/graph-v2` (a second,
  related subgraph) or with the aggregation features discussed in
  `docs/unica-v5/graph/SCALABILITY.md` §3 would constitute "composing two or more of
  The Graph's products" is **UNKNOWN** and a fair question for a team member.
- The existing treasury copilot (`integrations/graph-v2/copilot.mjs`) already consumes
  live Graph data (through `provider.mjs`, with a documented freshness refusal and no
  fixture fallback) and already "does meaningful work with the data" in the sense of
  producing bounded reserve recommendations from indexed receipts — but its own README
  states explicitly: "the 'AI' is a deterministic analyst, not a model call." Whether a
  track literally named "AI Tooling or AI Use Case" is satisfied by deterministic,
  rule-based reasoning over live Graph data, without any LLM step, is **UNKNOWN** and
  is exactly the kind of question this record declines to answer unwritten.
- The Substreams challenge's own bar ("deploying a working Substreams pipeline from a
  single prompt") names a concrete artifact UNICA does not have today for any chain —
  building one would need the Robinhood Chain Substreams path in §3.4, which exists,
  paired with an actual prompt-driven deployment flow, which does not exist in the
  repository today.
- The Token API's redirect to a third-party provider (§3.8) is a separate open
  eligibility question in its own right.

## 7. Recommendation for UNICA v5 (PROPOSED)

Not authorized to build, deploy, or publish; a recommendation for the owner's decision.

- **Ethereum Sepolia** (where V1/V3 already emit real receipts today): keep the
  existing `integrations/graph` subgraph as the reference example of §3.1, and treat
  publishing it to the decentralized network (§3.3) as the cleanest, most literal
  candidate for Track 1, since Sepolia is registry-supported with
  `issuanceRewards: true` and needs no exotic provider relationship.
- **Robinhood Chain (46630, UNICA v4's rehearsal chain per `SPEC-ORACLE-AND-CHAINS.md`
  §12.1)**: do not attempt a standard Studio subgraph — none is possible today (§4).
  Evaluate a Substreams pipeline against Pinax's registered endpoint (§3.4) as the
  chain's only real Graph-ecosystem path, alongside the bounded RPC event indexer or
  limited beta history view `EVENT-SCHEMA.md` §10.3 already specifies as the
  no-Graph-product fallback.
- **Arc testnet (5042002)**: a standard Studio subgraph is mechanically available
  (§4) with no Substreams path yet; if UNICA ever settles value on Arc, a conventional
  subgraph there is the lowest-burden Graph-ecosystem option, backed by direct RPC
  (§3.9) for current-state confirmation exactly as elsewhere.
- In every case, keep the standing rule unchanged: settlement correctness never
  depends on an indexer; RPC confirms, The Graph (or its fallback) narrates history.
- Route every unresolved prize-eligibility question in §6 to this design set's
  mentor-questions record rather than assuming an answer.

## 8. Sources

| URL | Retrieved | Author/Org | Kind | Used for | Conflicts |
| --- | --- | --- | --- | --- | --- |
| https://github.com/graphprotocol/networks-registry (registry/eip155/{arc,arc-testnet,robinhood,robinhood-sepolia,sepolia,mainnet,arbitrum-one}.json, `main` branch) | 2026-09-11 | The Graph (graphprotocol org) | OFFICIAL | §3.1, §3.3, §3.4, §3.5, §4 chain-support facts | none found; this is treated as primary over the rendered docs pages below where they'd otherwise disagree |
| https://thegraph.com/docs/en/supported-networks/ | 2026-09-11 | The Graph | OFFICIAL | §3.1 overview, confirms registry is rendered here | none |
| https://thegraph.com/docs/en/supported-networks/arc-testnet/ | 2026-09-11 | The Graph | OFFICIAL | §3.1, §4 confirms Arc testnet has its own docs page | none |
| https://thegraph.com/docs/en/supported-networks/arc/ | 2026-09-11 | The Graph | OFFICIAL | §4 reference row | none |
| https://thegraph.com/docs/en/supported-networks/robinhood/ | 2026-09-11 | The Graph | OFFICIAL | §4 reference row (mainnet only) | none |
| https://thegraph.com/docs/en/supported-networks/robinhood-testnet/ , .../robinhood-chain-testnet/ | 2026-09-11 | The Graph | OFFICIAL | §3.1 — both 404; corroborates (does not solely prove) the registry's empty-array finding | none — consistent with the registry |
| https://thegraph.com/blog/upgrade-indexer/ | 2026-09-11 | The Graph | OFFICIAL | §3.3 opt-in mechanism, indexing-rewards bootstrap | none |
| https://thegraph.com/studio-pricing/ | 2026-09-11 | The Graph | OFFICIAL | §5 query limits and cost | none |
| https://thegraph.com/docs/en/subgraphs/providers/subgraph-studio/introduction/ ; .../subgraph-studio/studio-faq/ | 2026-09-11 | The Graph | OFFICIAL | §3.2 Studio description | did not yield a quotable rate-limit figure — see §9 |
| https://thegraph.com/blog/sunsetting-hosted-service/ (corroborated by community sources) | 2026-09-11 | The Graph | OFFICIAL | §3.2 Hosted Service sunset date | none |
| https://thegraph.com/blog/subgraphs-substreams-firehose-explained/ ; https://thegraph.com/blog/substreams-parallel-processing/ | 2026-09-11 | The Graph | OFFICIAL | §3.4, §3.5, §3.6 | none |
| https://github.com/graphprotocol/graph-improvement-proposals (GIP-0053) | 2026-09-11 | The Graph | OFFICIAL | §3.6 Substreams-powered subgraphs | none |
| https://firehose.streamingfast.io/references/faq | 2026-09-11 | StreamingFast | OFFICIAL (product owner, not The Graph Foundation itself) | §3.5 | none |
| https://docs.substreams.dev/reference-material/faq | 2026-09-11 | StreamingFast / Graph ecosystem | OFFICIAL | §3.4 | none |
| https://thegraph.com/docs/en/indexing/tooling/graph-node/ | 2026-09-11 | The Graph | OFFICIAL | §3.7 self-hosting | none |
| https://github.com/graphprotocol/graph-node (docs/environment-variables.md, docs/config.md) | 2026-09-11 | The Graph | OFFICIAL | §3.1, §3.7 reorg threshold and cache size | none |
| https://thegraph.com/docs/en/token-api/quick-start/ → redirects to https://app.pinax.network/docs/api/ | 2026-09-11 | The Graph (redirect source); Pinax (redirect target) | OFFICIAL (the redirect itself); COMMUNITY/third-party (the destination content) | §3.8 Token API status | The Graph's own docs site sends this traffic to a third party — flagged, not resolved |
| https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 | ETHGlobal | OFFICIAL | §6 prize tracks, quoted verbatim | none |
| https://docs.thegraph.academy/ (various pages) | 2026-09-11 | The Graph Academy (community/partner-run education site, not `thegraph.com`) | COMMUNITY | background only, not relied on for any load-bearing claim above | none load-bearing |
| https://subquery.medium.com/... ; https://www.alchemy.com/blog/sunsetting-the-graphs-hosted-service | 2026-09-11 | SubQuery Network; Alchemy | COMMUNITY | §3.8 background on Hosted Service alternatives | none load-bearing |
| ChainList entries for chain 46630 and 4663; Chainlink docs CCIP directory for Robinhood testnet; Fortune article on Robinhood Chain testnet launch | 2026-09-11 | ChainList (community aggregator); Chainlink; Fortune | COMMUNITY | corroborated chain id 46630 and its public RPC/explorer, cross-checked against the existing repo's own `config/chains/46630.json` | none — all agree with the existing repository record |

## 9. Unknowns

Every item here is an honest gap, not a guess.

1. **The exact 3,000 queries/day figure for Subgraph Studio's pre-publish testing
   query URL** was reported consistently by web-search summaries of The Graph's docs
   but could not be independently confirmed with a direct verbatim quote from a
   fetched page in this pass (two attempts against the Studio FAQ page turned up no
   rate-limit text). Treat as probable, not verified, until a team member or a
   directly-quotable page confirms it.
2. **Whether The Graph has a distinctly-branded "staging" tier** separate from the
   pre-publish Studio query URL was not found in any source fetched in this pass;
   §3.2 treats the pre-publish URL as the closest analogue, but this is a naming
   assumption, not a confirmed equivalence.
3. **Whether an independent (non-Upgrade) Indexer is ever expected to opt in on a
   chain with `issuanceRewards: false`**, and for how long the Upgrade Indexer's
   bootstrap coverage is guaranteed, was not resolved by any source read in this pass.
4. **The current GRT (or dollar) cost of curation signal** needed to publish and
   attract Indexer interest for a subgraph was not found with a current figure.
5. **Whether a Substreams-powered subgraph can be deployed and served through Studio
   for a chain whose conventional `services.subgraphs` array is empty** (Robinhood
   Chain, both networks) is unresolved — the registry does not distinguish the two
   subgraph mechanisms in this field, and no fetched doc page addressed the
   combination.
6. **Whether the Token API, a third-party Graph-compatible host, or a self-hosted
   graph-node counts as "live use of a Graph product"** for either ETHOnline 2026
   Graph prize track is explicitly not settled here, per the assignment's own
   instruction; it needs a written answer from an identifiable Graph team member.
7. **Whether UNICA's existing deterministic (non-LLM) treasury analyst
   (`integrations/graph-v2/copilot.mjs`) would satisfy the "AI Tooling or AI Use
   Case" track's bar** without an actual model-reasoning step added is unresolved.
8. **No official numeric indexing-latency SLA** (typical seconds-behind-head, or a
   percentile) was found for a standard subgraph on any of the chains discussed.
9. **Pinax's and StreamingFast's own pricing** for their Substreams/Firehose/RPC
   endpoints was not fetched in this pass; any cost comparison involving them in §3.4,
   §3.5 or §3.8 is qualitative only.
10. **No transcript of any channel discussion about The Graph or this hackathon's
    prize framing was supplied** to this record. Nothing above reports, summarizes, or
    attributes an idea to such a discussion; every claim traces to a public source, the
    existing repository, or is marked PROPOSED/UNKNOWN as stated throughout.
11. **Whether the ETHOnline 2026 prize page's "The Graph Market" (named alongside
    Subgraph Studio in Track 1's requirement)** is a distinct, separately-documented
    product from what this document has otherwise researched under "the decentralized
    network" (§3.3) was not independently confirmed — the phrase appeared only in the
    prize page fetch, not in any `thegraph.com` docs page fetched in this pass.
