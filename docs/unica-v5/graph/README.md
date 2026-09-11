Research draft for owner review. Not committed. Authorizes nothing. UNICA v5 scope; it does not
change or delay the UNICA v4 specification or its merge gate.

Retrieval date for every citation below is 2026-09-11 unless a cited document's own row states
otherwise. Track: **FROM SCRATCH** (owner ruling, 2026-09-11). No transcript of any sponsor-channel
discussion was supplied to any document in this directory; nothing here reports, summarizes, or
attributes an idea to such a discussion — every claim below is a citation to a document in this
directory (which itself cites a public source, the repository, or labels PROPOSED/UNKNOWN) or a
synthesis judgment stated as such. This document changes no file outside
`docs/unica-v5/graph/README.md`, `ARCHITECTURE.md`, and `OPEN-QUESTIONS.md`.

## File index

| File | Covers |
|---|---|
| `PEER-PATTERNS.md` | Twelve Graph patterns compared against what UNICA already has; prize framing; differentiation gaps |
| `SETTLEMENT-SCHEMA.md` | The 26-entity settlement evidence graph; the ten-link receipt-authentication chain; reorg/finality/versioning policy |
| `ENS-NFT-SCHEMA.md` | The ENS merchant-identity and renderer-provenance graph; fifteen entities; the never-authorizes-settlement discipline |
| `AI-MCP-TOOLS.md` | The evidence toolkit — TypeScript SDK, CLI, MCP server; response envelope; reason-code catalogue; nine tools |
| `X402-EVIDENCE.md` | The boundary between x402 payment negotiation and the evidence toolkit; which checks must be live RPC vs. may read an index |
| `NETWORK-OPTIONS.md` | Ten indexing paths compared per chain, resolved against The Graph's own network registry |
| `SCALABILITY.md` | Three settlement-volume scenarios; entity cardinality; aggregation/timeseries; retention and privacy |
| `PRIZE-FIT.md` | ETHOnline 2026 Graph-track eligibility analysis for a second, distinguishable submission |
| `DEMO-PLAN.md` | Five candidate demos scored and ranked; the corrected minimal build sequence |
| `MENTOR-QUESTIONS.md` | Six eligibility questions answered from public sources as far as they go, with the remainder flagged for written confirmation |
| `QUERIES.graphql` | Twelve buildable GraphQL queries against the settlement evidence schema |
| `README.md` | This document — the eighteen-part synthesis |
| `ARCHITECTURE.md` | The layered design end to end, trust boundaries, and the thirteen governing rules mapped to enforcement points |
| `OPEN-QUESTIONS.md` | Every owner decision collected from every document above, numbered G1–G25, blocking ones first |

## 1. Current UNICA Graph usage

Two manifests exist. `integrations/graph/` is **BUILT and deployed**: specVersion 1.0.0, apiVersion
0.0.9, network Ethereum Sepolia, one ABI (`V4SettlementHook`), two fixed-address data sources — the
V1 hook (`0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`, start block 11639895) and the V3 hook
(`0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0`, start block 11667702) — one event handler
(`handleSettlementReceipt`), and exactly one entity: `Settlement @entity(immutable: true)`, 17
scalar fields, no relations, no derived fields, no aggregation. Per this repository's own
`README.md`, it is live and synced at Subgraph Studio with `hasIndexingErrors: false`, returning a
decoded `Settlement` matching a real receipt (PEER-PATTERNS.md §1; SETTLEMENT-SCHEMA.md §3.1).

`integrations/graph-v2/` is **BUILT but undeployed** — a separate manifest and schema
(`InvoiceSettlement`, `Deployment`) for the frozen V2 executor's `QuoteSettled` event, with the
manifest's own address a fork-local test address, never a public chain (SETTLEMENT-SCHEMA.md §3.2).
`Deployment` is the one entity in either subgraph with a `@derivedFrom` relation and running
counters (`settlementCount`, `firstBlock`, `lastBlock`); its own doc comment — "Its presence proves
a matching settlement receipt was indexed. Its ABSENCE proves nothing on its own" — is the
discipline both new schemas in this directory inherit rather than restate independently.
`integrations/graph-v2/provider.mjs` and `copilot.mjs` are, on the evidence read, the most advanced
Graph-adjacent code in the repository today: a 17-named failure taxonomy, a mandatory `_meta`
freshness check against an independent RPC head, and zero fixture fallback (PEER-PATTERNS.md §1,
§3.1, §3.9).

Neither manifest uses templates, an MCP surface, response caching, cross-chain composition, or a
subscription mechanism, and neither has a registry, a market concept, or a lifecycle — because
neither the frozen generation nor V2 has one (SETTLEMENT-SCHEMA.md §3.3). This is a plain
historical-receipt indexer, and its simplicity is itself a fact worth recording: nothing in it can
go wrong that a bigger manifest could not also get wrong, and nothing in it does more than the one
job of turning one log into one row (PEER-PATTERNS.md §1).

## 2. Gaps

- **No relations, no registry, no lifecycle.** The live `Settlement` entity cannot answer "which
  market is this," "was this market ever paused," "does this hook belong to the official registry,"
  or "what did this merchant receive this month" without a client re-joining raw addresses by hand
  (SETTLEMENT-SCHEMA.md §3.1).
- **No dynamic data sources.** Neither manifest uses templates (`Template.create(address)`), the
  mechanism UNICA v4's per-market hook/executor pairs need and already specify using
  (EVENT-SCHEMA.md §10.2, cited PEER-PATTERNS.md §3.4).
- **No aggregation or timeseries entities.** Both schemas are on specVersion 1.0.0, which predates
  The Graph's native `@entity(timeseries: true)` / `@aggregation` feature; `Deployment`'s lifetime
  counters are the only existing aggregate, and they are coarse — a single total, not a per-day or
  per-merchant breakdown (SCALABILITY.md §0, §2, §3).
- **No cross-chain discipline exercised, though the pattern is present.** `Deployment.id` already
  folds `network` into the id (`network ++ executor`); no other entity anywhere needs it yet because
  every deployment today is single-chain (SCALABILITY.md §5).
- **No MCP surface, no block-pinned replay, no query-reduction pattern applied deliberately** (only
  incidentally, by combining `_meta` and rows in one request) (PEER-PATTERNS.md §3.2, §3.3, §3.10).
- **Two differentiation claims have no Graph-documented pattern at all**: merchant identity and
  deterministic versioned NFT identity. Both need bespoke schema design, which §5, §7 below and
  `ENS-NFT-SCHEMA.md` in full supply (PEER-PATTERNS.md §5).
- **The deployed ABI has no paired second event.** `SettlementReceipt` alone cannot be
  cross-matched against a separate executor event the way UNICA v4's `Settled` allows — that pairing
  is a v4-only design, not something the live contracts emit (PRIZE-FIT.md §1; DEMO-PLAN.md §5 step
  3).

## 3. Patterns worth adapting

From the twelve-pattern catalogue in `PEER-PATTERNS.md` §3, the ones this design set adopts,
narrowed to what changes for UNICA specifically:

| Pattern | Adopt for v5 as |
|---|---|
| Dynamic data sources (templates) | Already the plan of record for v4 (EVENT-SCHEMA.md §10.2); confirmed against the current official manifest syntax, not altered (PEER-PATTERNS.md §3.4) |
| Block-pinned evidence | Stamp every evidence-toolkit response with the `_meta` block number and hash it used, so a second caller can replay the identical query (PEER-PATTERNS.md §3.2; realized as `query_or_evidence_hash` in AI-MCP-TOOLS.md §4) |
| MCP tools over Graph queries | Wrap the deterministic validator, not a laxer client, in an MCP server — the value UNICA adds over The Graph's own Subgraph MCP is that every answer already carries the freshness refusal and key-redaction guarantees `provider-test.mjs` already proves (PEER-PATTERNS.md §3.1, §3.3) |
| Explainable refusal decisions | Already UNICA's most differentiated pattern — a 17-named failure taxonomy more developed than anything found in The Graph's own AI-tooling docs. Extend the same numbered-taxonomy discipline to v4 entities as they are added; describe it as an original UNICA contribution, never attribute it to The Graph (PEER-PATTERNS.md §3.9) |
| Query reduction, bounded pagination | Adopt request-combining and `first:`-bounded, cursor-style pagination; explicitly reject result-level caching anywhere in the evidence path, since a caching layer that stores results could make a refusal-based system look live while serving stale data (PEER-PATTERNS.md §3.10; SCALABILITY.md §4) |
| Timeseries and aggregation entities | Bump to specVersion 1.1.0+; add per-merchant daily/hourly rollups so a dashboard never re-scans raw `Settlement` rows for a number the indexer can maintain natively (SCALABILITY.md §3, §8 — "the single highest-leverage recommendation") |
| "RPC-authoritative, Graph-additive," not "Graph-first, RPC-fallback" | State this explicitly rather than using the generic "fallback" framing, which invites the failure mode this design refuses (PEER-PATTERNS.md §3.6) |

Deliberately **not** adopted: Proof of Indexing as a data-integrity claim (it is an
indexer-reward/dispute mechanism, not consumer-facing — PEER-PATTERNS.md §3.8); push/subscription
mechanisms for settlement confirmation (a watcher alert only, never proof — PEER-PATTERNS.md §3.7);
Substreams for the 46630 rehearsal chain, given its Rust/WASM authoring cost against a single
testnet's bounded event set (PEER-PATTERNS.md §3.5, §3.12; NETWORK-OPTIONS.md §7).

## 4. Recommended architecture (summary — full design in ARCHITECTURE.md)

Contracts remain the source of settlement truth; The Graph (or its per-chain substitute) is a
derived, additive-only read and evidence layer; a deterministic validator (`@unica/evidence-sdk`)
sits between raw RPC/Graph reads and every consumer, computing an auditable decision that a language
model may explain but never override; a CLI and an MCP server are thin wrappers around the same
validation code, so no rule can drift between surfaces (AI-MCP-TOOLS.md §2, §3). Per-chain, the
indexing path differs (§10 below) but the validator's contract with its callers does not. See
`ARCHITECTURE.md` for the full layered diagram, the trust boundaries, and the thirteen rules mapped
to their enforcement points.

## 5. Entity and schema proposal (summary — full catalogues in SETTLEMENT-SCHEMA.md §4 and ENS-NFT-SCHEMA.md §5)

Two sibling graphs, never merged into one schema, joined only by an explicitly-named foreign key
where a join is safe (§7 below):

- **The settlement evidence graph** (`SETTLEMENT-SCHEMA.md`) — 26 entities against the task's fixed
  list, each tagged BUILT / SPECIFIED-NOT-BUILT / PROPOSED and cited to an exact `EVENT-SCHEMA.md` /
  `SPEC-CONTRACTS.md` section or marked as this document's own design. Two direct BUILT analogues
  (`Settlement`, `InvoiceSettlement`) become v4's `HookReceipt`/`ExecutorReceipt` plus a composite
  `Settlement` requiring both, paired inside one transaction (§6 below). One entity
  (`DeploymentManifest`) is honestly marked **not reconstructable from chain data alone** — its
  content is off-chain repository configuration, cross-checkable against on-chain immutables but not
  chain-derivable (SETTLEMENT-SCHEMA.md §4.25).
- **The identity and renderer-provenance graph** (`ENS-NFT-SCHEMA.md`) — 15 entities (plus
  supporting types) covering ENS resolution history, avatar-record parsing, art-seed determinism,
  and renderer-version provenance, deliberately **not** materializing the task's candidate
  `SettlementMerchant` entity (§7 below explains why).

Shared conventions, stated once in each document and reused, not reinvented, per entity:
`uint32`/`uint48`/`uint64`/`uint128`/`uint160`/`uint256` → GraphQL `BigInt`, never `Int` (signed
32-bit would truncate); `bytes32`/`address` → `Bytes`, never `ID`/`String`; log-keyed ids are
`transactionHash.concatI32(logIndex)`, the exact expression already running in the BUILT V1/V3
mapping; an entity is `@entity(immutable: true)` only when The Graph's own rule is satisfied —
writes happen in the same block the entity was created in (SETTLEMENT-SCHEMA.md §4.0; ENS-NFT-SCHEMA.md
§1, citing `thegraph.com/docs/en/subgraphs/developing/creating/ql-schema/`).

## 6. The canonical receipt-authentication algorithm

**A correct event signature alone must never confer trust** (EVENT-SCHEMA.md §2, quoted in
SETTLEMENT-SCHEMA.md §5): "Anyone can deploy the same hook source through their own factory and emit
a `SettlementReceipt` with an official `marketId`." The ten-link chain that closes that gap
(SETTLEMENT-SCHEMA.md §5, condensed):

1. **Registry** — exactly one address per chain, pinned off-chain in `DeploymentManifest`; every
   later link checks against this one address only.
2. **Release and version** — `marketId` cryptographically commits chain id, registry, and oracle
   route; `register()` recomputes and checks it.
3. **Registered market** — a `Market` row exists only from a `MarketProposed` log whose emitter
   address equals link 1's registry (an address-pinned data source, never topic-matched alone).
4. **Factory provenance** — the registry's own `FACTORY` immutable is set once, at construction, to
   its deploying factory; the indexer inherits this transitively.
5. **Expected hook** — `Market.hook` is a write-once field, the factory's own CREATE2 result against
   a pinned code hash; a `SettlementReceipt` is accepted only when `log.address ==
   getMarket(marketId).hook`.
6. **Expected executor** — `Market.executor` is likewise write-once, `CREATE(hook, 1)`, computed
   inside the already-authenticated hook's own constructor.
7. **Expected PoolManager and pool key** — `Market.poolId` is write-once; an indexer that also wants
   to authenticate a raw PoolManager log must check `marketIdOfPool(poolId) != 0` on the registry —
   PoolManager itself has no concept of "official."
8. **Matching hook and executor events** — a canonical settlement requires a `SettlementReceipt`
   from link 5's hook **and** a `Settled` from link 6's executor, sharing the same `orderId`, inside
   the same transaction, with amounts equal across both.
9. **Transaction success** — not a separate check: a reverted transaction leaves no log at all.
10. **Finality threshold** — not specified by any UNICA source; PROPOSED here as either the chain's
    own `safe`/`finalized` tag or Graph Node's `ETHEREUM_REORG_THRESHOLD` default (250 blocks),
    recorded per network, never hardcoded once for every chain.

**Reading the chain as one sentence:** an entity is canonical only if every link holds — a registry
named off-chain, a market registered by that registry, a hook and executor both derived from that
market by on-chain construction, both emitting the paired events inside one successful transaction,
read back past whatever finality bar the deployment has chosen. Anything that breaks any one link is
rejected or labelled, never silently accepted (SETTLEMENT-SCHEMA.md §7's full rejection-rule table).

**What the canonical success record requires, decided from source, not asserted:** the paired
`HookReceipt` + `ExecutorReceipt` inside one transaction is necessary (a receipt alone is "evidence,
not success"; a `Settled` without a receipt is impossible on the honest path, since Solidity's
all-or-nothing execution means both or neither) and specification-sufficient (the on-chain
balance-delta check already runs before `Settled` can be emitted). An independent Transfer-log
balance cross-check is proposed as optional hardening against a contract that diverges from its own
specification, never as a requirement the source imposes (SETTLEMENT-SCHEMA.md §8).

## 7. ENS identity provenance

`ENS-NFT-SCHEMA.md` designs an indexed read layer over ENS-derived merchant identity and the planned
on-chain art layer (`docs/unica-v4/ENS-ART-LAYER.md`, itself SPECIFIED-NOT-BUILT throughout). Its
central mechanism: the art seed is `keccak256(normalized_ens_name)`, a pure function verified
directly in this repository's legacy `vy/src/logobackground.vy` (`@pure`, no imports, no storage
read); "same name plus same renderer version gives the same art forever" is enforced structurally,
not by promise — a renderer version is a separate contract deployment, never a mutable field on a
shared one (ENS-NFT-SCHEMA.md §4.1, §4.2).

**The identity/settlement boundary is drawn seven times, deliberately** (ENS-NFT-SCHEMA.md §8):
an identity NFT never authorizes settlement and never replaces address verification; every entity in
this graph feeds a read surface shown *beside* an independently performed ENS resolution, never
*instead of* one; `IdentityMismatch` carries `advisoryOnly: true` as a schema field, not only a claim
in prose; and the payment-history join (§4.10) keys exclusively on the independently-resolved
address, never on an NFT's `tokenId` or `currentOwner` — no foreign key from any identity/art entity
to any settlement entity exists or is proposed, precisely so the join cannot be mistaken for "the NFT
proves payment."

**`SettlementMerchant`, named in the original candidate list, is deliberately not materialized.**
Having read `integrations/ensv2/merchant-config.mjs` in full, the conclusion is that a subgraph
entity claiming "this name's currently accepted settlement configuration" would overclaim what it
can hold: `preflight()`'s own verdict depends on a caller-supplied clock time (an expiry check) and a
private commitment opening never published on chain — inputs a subgraph structurally cannot have.
What the graph provides instead: `MerchantIdentity.currentResolvedAddress` (the ENS-resolution half)
and `IdentityBindingObservation` (the on-chain-authority half); a UI combines both with a live clock
read to reproduce `preflight()`'s verdict itself, exactly as the off-chain module already does
(ENS-NFT-SCHEMA.md §5).

The known gap left open honestly rather than resolved: this repository's actual name normalizer
(`web/ensv2/resolve.mjs`) is a conservative ASCII-only approximation of ENSIP-15, not the full
standard. The safety argument recorded is "safe by refusal" — for any name this repository accepts
today, the ASCII-conservative form and the full ENSIP-15 form coincide, while a name ENSIP-15 would
accept and this repository refuses never reaches the art layer at all — but this has not been tested
against ENSIP-15's own published validation vectors (ENS-NFT-SCHEMA.md §4.1, §9).

## 8. AI and MCP evidence tooling

`AI-MCP-TOOLS.md` designs a TypeScript SDK, a CLI, and an MCP server that answer deterministic
questions about UNICA v4 state — explicitly **not** a chatbot: every decision is computed by
validation code, never a language model, and every response carries the evidence a caller needs to
check the decision independently (AI-MCP-TOOLS.md §2). Architecture: one shared validation layer
(`@unica/evidence-sdk`, pure functions), consumed identically by a thin CLI and a thin MCP server, so
no rule can drift between the two surfaces (§3). The toolkit is designed to sit **on top of** the
official Subgraph MCP or a Studio/Network subgraph as its data source, not to duplicate a
general-purpose query gateway UNICA does not need to own (§3).

Every response is one fixed envelope (`decision`, `reasons_human`, `reason_codes`, `chain`, `block`,
`finality`, `evidence_source`, `query_or_evidence_hash`, `contracts`, `missing_evidence`,
`explorer_links`) — no field optional, so a caller can distinguish "checked, nothing wrong" from "not
checked" (§4). Thirty-one reason codes are catalogued, each mapped to exactly one of ALLOW / REFUSE /
UNKNOWN, with one deliberate asymmetry: `MARKET_DEMONSTRATION_ONLY` and `MARKET_NEWER_VERSION_EXISTS`
force nothing — they are required information, not refusal grounds (§5, §6).

Nine tools are catalogued: `unica_market_status`, `unica_verify_market`, `unica_verify_receipt`,
`unica_order_status`, `unica_merchant_history`, `unica_identity_provenance`,
`unica_token_implementation_status`, `unica_explain_payment_refusal`,
`unica_reconciliation_summary` (§7). **Only one has a real analogue against today's deployed
infrastructure**: `unica_verify_receipt` against the live V1/V3 subgraph, where "authenticity" can
only mean "the log's emitter is on a static two-address allowlist" — not the on-chain reverse-lookup
`§6` above specifies, because there is no registry yet. Every other tool depends on
`UnicaMarketRegistry` state that has not been written, deployed, or tested (§7 preamble).

What the language model may do: turn `reasons_human` and decoded refusal fields into fluent prose,
choose which non-authorizing tool to call next. What it may never do: set or override `decision`,
treat `UNKNOWN` or a missing field as `ALLOW`, invent a reason code, or fabricate `chain`/`block`
values — stated as a documented contract of the toolkit, not an enforceable guarantee against a
misbehaving caller (§10).

## 9. The x402 boundary

`X402-EVIDENCE.md` states the line between x402 payment negotiation and the evidence toolkit. x402
moves an exact, flat token transfer to a single address and nothing else — its `exact` scheme's
EIP-3009 authorization has six fields, its `permit2` witness exactly one more; neither carries an
order id, a quote digest, or a merchant identity beyond a bare recipient address (X402-EVIDENCE.md
§2, citing `docs/unica-v4/arc/X402.md`).

**Security Advisory 001, applied to UNICA v4's actual fields, not only in the abstract.** UNICA v4's
`pay(orderId)` takes no signature at all — it is gated on `msg.sender == order.payer`, and
`recipient` is fixed at order-creation by an allowlisted creator, never by whoever pays. The specific
substitution Advisory 001 found in V2 has no foothold in v4's base path, because v4 has no relayer
path at all. **The vulnerability reappears the moment a gasless/relayed wrapper is placed in front of
`pay()`** — exactly what wiring x402 in for a payer with no gas would require — and the field that
would remain unbound in any of x402's stock schemes is *which order* the authorized funds pay for,
the single most important row of the eight-binding table (§3, §4).

**The dividing line for which checks may read an index versus must read the chain directly is
decision-time state versus history, not "index versus chain" as a blanket rule.** Market status,
hook/executor/pool authenticity, oracle condition, caps remaining, and order/replay status must all
be live RPC reads before an x402 authorization is ever signed — an index lag of even one block could
show a market ACTIVE after an on-chain pause landed, wasting the payer's one-time authorization nonce
chasing a doomed settlement. Merchant history, reconciliation summaries, and status/policy timelines
may read an index, because they only ever answer "what already happened," never "is this payment
good" (§5, §6, §7).

## 10. Indexing strategy per chain

Resolved directly against `github.com/graphprotocol/networks-registry` (NETWORK-OPTIONS.md §4),
correcting `EVENT-SCHEMA.md` §10.1's prior "UNKNOWN: not probed" status for 46630 to a definite
answer:

| Chain | Studio subgraph | Substreams/Firehose | Recommendation |
|---|---|---|---|
| Ethereum Sepolia (`eip155:11155111`) | YES, `issuanceRewards: true` | Pinax, StreamingFast | Keep the existing `integrations/graph` subgraph; publishing it to the decentralized network is the cleanest Track-1 candidate |
| Robinhood Chain Testnet, 46630 (`eip155:46630`) | **NO** — `services.subgraphs: []`, VERIFIED against the registry | **YES**, Pinax only | Do not attempt a Studio subgraph; evaluate a Substreams pipeline against Pinax's endpoint, alongside the bounded RPC event indexer `EVENT-SCHEMA.md` §10.3 already specifies as the no-Graph-product fallback |
| Arc testnet, 5042002 (`eip155:5042002`) | YES, `issuanceRewards: false` | **NO** named provider as of 2026-09-11 | A conventional subgraph is mechanically available and the lowest-burden option if UNICA ever settles value there; back it with direct RPC for current-state confirmation, exactly as elsewhere |

One name-collision correction carried from `NETWORK-OPTIONS.md` §3 into this synthesis: The Graph's
own registry lists a network called "Arc" at `eip155:5042` (`docs.arc.network`) that is **not**
Circle's Arc (chain id `5042002`, `docs.arc.io`, testnet-only) — a collision between two unrelated
chains sharing a name, not a fact about Circle's Arc having a Graph-supported mainnet.

In every case, the standing rule is unchanged regardless of which path serves history: settlement
correctness never depends on an indexer; RPC confirms current state, The Graph (or its per-chain
substitute) narrates history (NETWORK-OPTIONS.md §7).

## 11. Scalability estimates

Three scenarios modelled against the two real schemas on record (SCALABILITY.md §1):

| Scenario | Settlements/day | Events/day (v4 model) | Query volume (proposed estimate) | Headline finding |
|---|---|---|---|---|
| A — 10 merchants | 1,000 | up to 3,000 | 3,000–10,000/day | Trivial for any indexing path; Studio's 100,000 free monthly queries is marginal at the high end even here — a first argument for caching |
| B — 1,000 merchants | 1,000,000 | up to 3,000,000 | ≈2,000,000/day (≈$1,200/month illustratively past the free tier) | `Settlement`/`Order` become unbounded "hot entities" with no pruning or aggregation declared in either existing schema |
| C — nano-payment scale | 100,000,000 | — | — | Indexing feasibility and settlement economics are two different problems, kept separate; recommend never indexing the individual nano-payment as its own row — periodic aggregate checkpoints only, itself an undesigned contracts-side question |

**The single highest-leverage recommendation:** adopt The Graph's native `@entity(timeseries: true)`
plus a paired `@aggregation` entity (specVersion 1.1.0+) for per-merchant daily/hourly rollups. This
one native feature addresses the hot-entity problem, the pagination-cost problem (cursor pagination
over `skip`, since large-offset `skip` performs poorly per The Graph's own documented guidance), and
the query-cost problem at once, rather than three separate bespoke fixes (SCALABILITY.md §3, §4,
§8). A companion finding: a subgraph does not leak anything the chain itself does not already expose,
but a published per-merchant aggregate changes the **cost of discovery** — from scanning and decoding
logs to one GraphQL query — which is a disclosed property of a public read layer, or gated behind
consent, an owner decision either way (SCALABILITY.md §7; OPEN-QUESTIONS.md G21).

## 12. Failure and fallback behaviour

**"RPC-authoritative, Graph-additive," never "Graph-first, RPC-fallback."** A Graph failure degrades
a *feature* (history, agent commentary), never a *guarantee* (PEER-PATTERNS.md §3.6). Every fail
condition resolves to `REFUSE` or `UNKNOWN`, never `ALLOW`: stale index, provider disagreement,
unknown/paused/retired market, a lookalike hook or executor, mismatched receipt pairing, an
unexpected token implementation, reorg uncertainty, an unsupported chain, or a query failure
(AI-MCP-TOOLS.md §6). A block-pinned query is not, by The Graph's own documentation, an unconditional
consistency guarantee near the chain head — "the indexer can not always tell that a given block hash
is not on the main chain at all" — which is exactly why the evidence toolkit confirms freshness
against an independent RPC head rather than trusting an indexed answer outright (SCALABILITY.md §4).
A chain reorg within `ETHEREUM_REORG_THRESHOLD` (default 250 blocks) is handled by the indexer
itself; a deeper reorg can leave a subgraph processing inconsistent data, with no automatic detector
beyond `_meta.hasIndexingErrors` plus a manual cross-check — an honest limitation stated rather than
concealed (SETTLEMENT-SCHEMA.md §7, "Reorgs" row). Every measured failure must be a stated negative
("N requests, 0 false-VERIFIED"), never a blank pass, per this repository's own rule that clean
output is the least trustworthy output (DEMO-PLAN.md §6).

## 13. Prize fit

**Strongest eligible category, on the page's own wording, not yet confirmed in writing: Best AI
Tooling or AI Use Case with The Graph, From Scratch.** The planned artifact is explicitly both named
shapes at once — a reusable MCP tool and, when driven by an agent loop, "an AI agent... that uses The
Graph as its live source of blockchain data"; it does "meaningful work with the data" by construction
(a reasoned VERIFIED/REFUSED/UNKNOWN verdict is a decision, not a display of raw fields); and the
load-bearing test is satisfied by construction — remove the subgraph query and the tool has no
verdict to return. The whole repository's provenance already establishes the From Scratch pool's
qualifying fact independently: genesis commit 2026-09-04, four hours after the event's build window
opened, zero commits before it (PRIZE-FIT.md §4).

**Second-best, possible but not settled: Best Use of Composable or Standardized Graph Products.**
UNICA's `Settlement` entity is a bespoke schema, not one of The Graph's published Standardized
Subgraphs; whether routing a query through The Graph's own hosted Subgraph MCP server (rather than a
hand-rolled client) converts "querying one Subgraph" into "composing two Graph products" is not
resolved by the page's own wording and needs written confirmation (PRIZE-FIT.md §3, §5;
MENTOR-QUESTIONS.md Q2).

**Eligibility risks recorded, not resolved:** a 3-partner-prize-slot ceiling already under pressure
from Uniswap, ENSv2, and Arc; two Graph-track feature branches (the existing treasury-copilot
candidate and this design's MCP verification tool) that may be judged as one project or as competing
submissions; a demo that leans on v4 language risking "describing unbuilt contracts as live," removed
entirely by scoping to the buildable-today path; and a 2–4 minute demo-video ceiling on every track
(PRIZE-FIT.md §11). **No claim of settled eligibility is made anywhere in this synthesis or the
documents it draws from.**

## 14. One recommended demo

**Demo B — agent refusal through MCP, built on Demo A as its necessary first layer.** A caller asks
`unica_verify_receipt`-equivalent question wrapped in one MCP tool, driven by an actual agent loop
that must act on the verdict: proceed on VERIFIED, decline on REFUSED or UNKNOWN. It wins on the two
axes that matter most for this prize — sponsor relevance (the clearest embodiment of the track's own
two named shapes at once) and security value (an agent that fails closed *is* the security story) —
while costing only one bounded increment of build time and reliability risk over Demo A
(DEMO-PLAN.md §3, §4).

## 15. Two fallbacks

**Fallback 1 — Demo A alone, the verified settlement explorer.** If the agent-loop harness proves
unreliable close to the demo date, degrade to showing the MCP tool's JSON verdict live rather than a
full agent transcript. This is Demo B with the last layer removed, so choosing it late costs nothing
already spent (DEMO-PLAN.md §4).

**Fallback 2 — Demo E, the x402 evidence gate.** Ranked ahead of the ENS-identity-NFT and
cross-chain-dashboard candidates despite a medium-low reliability score, because it is the only one
of the three with real, dated, primary-source documentation already in the repository
(`docs/unica-v4/arc/X402.md`) rather than an invented feature. Named as a fallback, not a co-primary,
because building it well this week would mean standing up three sponsor surfaces (Graph, Arc, x402)
at once (DEMO-PLAN.md §4).

**Not recommended for this event, with reasons kept rather than discarded:** a cross-chain dashboard
matches UNICA v5's longer-term shape but is the wrong build for this week's runway and network-support
gaps; an ENS-identity-NFT demo has no design anywhere in the repository and would blur the
already-separately-submitted ENSv2 track with the Graph track rather than strengthening either
(DEMO-PLAN.md §4).

## 16. The minimal build plan

The corrected ten-step sequence (DEMO-PLAN.md §5), with every correction to the original brief stated
where the evidence disagreed with it:

1. Freeze the event surface — corrected to the already-deployed V1/V3 `SettlementReceipt` event, not
   the twelve-event v4 surface.
2. Reuse, do not rebuild, the Sepolia subgraph — it already exists and is already synced.
3. Emitter authentication in place of hook-to-executor pairing — the deployed ABI has no paired
   second event to match against; the buildable-today check is a pinned two-address allowlist,
   documented as such rather than presented as a v4 registry lookup.
4. An adversarial look-alike fixture, local tests only, never broadcast.
5. One GraphQL verification query returning VERIFIED / REFUSED / UNKNOWN with reason codes and
   provenance.
6. Wrap it in one MCP tool, `unica_verify_receipt`.
7. ENS provenance narrowed to resolving the receipt's `recipient` through the already-built
   `integrations/ensv2/` module — no new NFT-provenance feature built for this stream.
8. One judge-facing screen, a legitimate and a look-alike receipt side by side, each with the block
   the answer was read at.
9. Failure-mode measurement: endpoint disabled, and under simulated indexer lag — each producing
   UNKNOWN, never a fabricated VERIFIED. Whether a reorg can be honestly produced and observed inside
   the event window is recorded as an open build risk, not assumed solvable (DEMO-PLAN.md §6).
10. Only then consider more chains — deferred past this event entirely, not merely sequenced last
    within it.

Cut lines, stated once rather than re-derived mid-build: never deploy or publish a subgraph; never
touch application or contract code; the adversarial fixture is local-tests-only, never broadcast; the
MCP tool never signs, broadcasts, or spends; no v4 contract is described as live; a demo that cannot
fit the 2–4 minute cap is cut to the verdict-and-screen core rather than rushed (DEMO-PLAN.md §7).

## 17. Items needing an owner decision

Every owner decision surfaced across all documents in this directory is collected, deduplicated, and
numbered G1–G25 in `OPEN-QUESTIONS.md`, blocking ones first. In outline: which demo to commit to and
whether to seek written confirmation before spending build time on a second prize track (G1–G5,
blocking); the settlement-schema design forks — registry trust, Pool/LiquiditySeed indexing
divergence, finality policy, pruning, id migration timing (G6–G13); the ENS/art-layer forks —
normalizer strictness, art-seed encoding, the `SettlementMerchant` non-entity, licence choice for the
eventual art token (G14–G17); the evidence-toolkit build scope and the x402 wrapper question
(G18–G20); and the scalability/operations forks — privacy disclosure, retention policy, Substreams
investment, self-hosting (G21–G25). None of these is resolved by this synthesis; each carries its own
recommended default and source citation in `OPEN-QUESTIONS.md`.

## 18. What still needs written confirmation from The Graph

Carried in full, with citations, in `MENTOR-QUESTIONS.md`. Six questions, each answered from public
sources as far as they go and left open where they do not, per the rule that prize eligibility is
never claimed as settled without a written answer from an identifiable Graph team member:

- **Q1.** Does an MCP or AI-refusal tool consuming a live subgraph qualify for the AI-tooling
  pool? Answered *yes, on the page's own wording*, but not confirmed in writing.
- **Q2.** For the Composable/Standardized track, is a standard subgraph plus an MCP consumer
  sufficient, or are multiple distinct Graph products expected? **Not settled by public
  documentation** — the one question that turns entirely on wording the prize page does not resolve.
- **Q3.** If Robinhood Chain testnet and Arc testnet lack full Studio support, does a
  Substreams/Firehose provider plus a self-hosted graph-node count as live use of a Graph provider?
  Partially answered — the underlying network facts are now resolved (§10 above), but the core
  eligibility policy question is not.
- **Q4.** Would a third-party Graph-compatible host (for example, Pinax) qualify on its own?
  **Not settled by any source retrieved.**
- **Q5.** If a demo mixes one officially supported chain through Studio with others through
  self-hosted indexing, is the project eligible overall? **Not settled**, and this synthesis
  recommends not needing an answer this event, since the recommended demo scopes to Sepolia alone.
- **Q6.** Is a public subdirectory of an existing MIT repository sufficient under From Scratch
  rules, provided the work built during the event is clearly identified? Answered *yes for this
  repository specifically* — genesis commit inside the event window, zero prior commits — but whether
  two feature branches aimed at the same pool are judged as one project or as competing submissions
  remains open.
