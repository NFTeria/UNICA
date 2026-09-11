# UNICA v5 — the settlement evidence graph

Draft for owner review. Nothing here is committed, deployed, or published; it authorizes no
account, no infrastructure spend, and no subgraph deployment. This document designs the indexed
read layer that UNICA v5 (the dashboard, `docs/unica-v4/V5-DEFERRED.md` §1) would query. It never
supplies settlement truth: contracts are the source of settlement truth, and an indexing failure
must never create, authorize, or settle a payment (task boundary, restated at every entity below).

Track: this is UNICA's **from-scratch** entry (owner ruling, 2026-09-11). Earlier drafts said
"Continuity"; that was wrong and is not repeated here. No sponsor-channel transcript was supplied
for this work; nothing below is attributed to a peer discussion, and every claim is either cited to
a source in §0 or labelled PROPOSED / UNKNOWN.

## 0. Sources and their status

Retrieval date for every row below is 2026-09-11 unless the row states otherwise. "Kind" follows
the task's taxonomy: OFFICIAL (the org that owns the product), TEAM GUIDANCE (a named team
member's written statement — none obtained for this document), COMMUNITY (third party). A URL
that failed to load after one retry is marked UNREAD; nothing below is inferred from an unread
source.

| # | URL | Retrieved | Author / org | Kind | Used for | Conflict? |
|---|---|---|---|---|---|---|
| S1 | `thegraph.com/docs/en/supported-networks/` | 2026-09-11 | The Graph | OFFICIAL | Confirms Ethereum Mainnet, Ethereum Sepolia, and Arbitrum One are on the supported-networks registry; states that an unlisted network requires a self-hosted Graph Node | none found |
| S2 | `thegraph.com/docs/en/subgraphs/developing/creating/subgraph-manifest/` | 2026-09-11 | The Graph | OFFICIAL | `specVersion` 1.0.0 introduces `indexerHints` (prune: `never` / `auto` / a block count); data source templates (`Template.create(address)`, `Template.createWithContext`) only process the block in which they were created and later blocks, never historical data; `startBlock` skips irrelevant blocks | none found |
| S3 | `thegraph.com/docs/en/subgraphs/developing/creating/graph-ts/api/` | 2026-09-11 | The Graph | OFFICIAL | The `try_`-prefixed generated contract-call pattern for a view that may revert, used below for reading an immutable getter (e.g. a factory's `HOOK_CREATION_CODE_HASH()`) from inside a handler | none found |
| S4 | `thegraph.com/docs/en/subgraphs/developing/creating/advanced/` | 2026-09-11 | The Graph | OFFICIAL | Grafting (`graft: { base, block }`, schema must stay compatible, not for first deploy to the decentralized network); non-fatal errors (`subgraphError: allow`, `_meta.hasIndexingErrors`, and the network's own note that non-fatal-error mode is not yet supported on the decentralized network); `@entity(timeseries: true)` and `@aggregation` for interval rollups | none found |
| S5 | `thegraph.com/docs/en/substreams/overview/` (redirected from `/introduction/`) | 2026-09-11 | The Graph | OFFICIAL | Substreams is a Rust/WASM parallel transform layer that can feed a subgraph or a database sink and is described as fork-aware; Firehose is its gRPC block-streaming layer, also described as fork-aware | none found |
| S6 | `thegraph.com/docs/en/subgraphs/querying/graphql-api/` | 2026-09-11 | The Graph | OFFICIAL | The `_meta` field's exact shape: `block { number hash timestamp }`, `deployment` (the manifest's IPFS CID), `hasIndexingErrors` | none found |
| S7 | `thegraph.com/docs/en/indexing/new-chain-integration/` | 2026-09-11 | The Graph | OFFICIAL | Lists the EVM-JSON-RPC and Firehose integration paths for a new chain; checked specifically for reorg/finality wording and none was found on this page — recorded as a gap, not inferred | this page does not state a confirmation-depth or finality rule; §6 below treats that as UNKNOWN from official docs |
| S8 | `thegraph.com/docs/en/indexing/overview/` | 2026-09-11 | The Graph | OFFICIAL | Checked specifically for reorg-handling and finality wording; none found on this page — a second confirmed gap | same as S7 |
| S9 | `github.com/graphprotocol/graph-node/blob/master/docs/environment-variables.md` | 2026-09-11 | The Graph Foundation / graphprotocol (graph-node maintainers) | OFFICIAL | `ETHEREUM_REORG_THRESHOLD` — "Maximum expected reorg size, if a larger reorg happens, subgraphs might process inconsistent data. Defaults to 250" (blocks) — the one concrete, citable reorg-depth number found for graph-node | none found, but see §6: this is an indexer-operator configuration default, not a manifest-level or protocol-level finality guarantee |
| S10 | `ethglobal.com/events/ethonline2026/prizes` | 2026-09-11 | ETHGlobal | OFFICIAL (event organizer; not a Graph-team statement) | The Graph's three published ETHOnline 2026 tracks and prize amounts, quoted in §1 for scope framing only | eligibility itself is out of scope for this document — see `docs/unica-v5/graph/PRIZE-FIT.md` |
| S11 (search-derived, not directly fetched) | `thegraph.com/docs` subgraph-manifest (block handlers) | 2026-09-11 | The Graph | OFFICIAL, via search-engine summary rather than a direct page fetch | A polling `blockHandlers` filter (`kind: polling, every: N`) exists in the manifest and is only available on `kind: ethereum` data sources | none found; flagged as search-derived because the direct fetch budget for this document was spent elsewhere — a follow-on reader should re-verify by fetching the manifest page directly before relying on the exact YAML shape |
| T1 | `docs/unica-v4/EVENT-SCHEMA.md` (this repository) | 2026-09-11 | UNICA / repository | TEAM | Every SPECIFIED-NOT-BUILT v4 event, field, topic convention, emitter-authentication rule, and the existing subgraph design sketch in its §10.2 | this document's §10.2 sketch is extended and, in a few places, renamed here — every rename is called out where it occurs |
| T2 | `docs/unica-v4/SPEC-CONTRACTS.md` (this repository) | 2026-09-11 | UNICA / repository | TEAM | Contract-level authority for roles, lifecycle, storage layout, caps accounting, oracle enforcement, and the registry/factory/hook/executor relationships | none found against T1 |
| T3 | `docs/v2/SECURITY-ADVISORY-001.md` (this repository) | 2026-09-11 | UNICA / repository | TEAM | The binding failure mode (a payer-side authorization that does not commit the counterparty's half of a deal); informs §5's authentication chain and the warning against treating any single field as sufficient proof of a counterparty | none found |
| T4 | `integrations/graph/{subgraph.yaml,schema.graphql,src/mapping.ts,networks.json}` (this repository) | 2026-09-11 | UNICA / repository | TEAM | The BUILT V1/V3 subgraph: its one entity, its id strategy, its handler, its two data sources | none found |
| T5 | `integrations/graph-v2/{schema.graphql,subgraph.yaml,queries.graphql}` (this repository) | 2026-09-11 | UNICA / repository | TEAM | The BUILT (fork-local, undeployed) V2 subgraph: its two entities, its `@derivedFrom` relation, its stated "absence proves nothing" discipline | none found |
| T6 | `README.md` (this repository, root) | 2026-09-11 | UNICA / repository | TEAM | The V1/V3 subgraph's live Subgraph Studio URL and its `hasIndexingErrors: false` reading, and the local end-to-end reconstruction result | none found |

## 1. Scope and non-scope

**In scope.** A design for the indexed read layer UNICA v5 (`docs/unica-v4/V5-DEFERRED.md` §1–2) would
query: entity shapes, id strategies, relationships, reorg and finality handling, and the receipt-authentication
chain that separates an official settlement from a look-alike one. Every entity is modelled only from a source
event that exists today (BUILT) or is specified in `docs/unica-v4/EVENT-SCHEMA.md` / `SPEC-CONTRACTS.md`
(SPECIFIED-NOT-BUILT); no event is invented. The task's fixed entity list —
ProtocolRelease, Registry, Factory, Market, MarketVersion, Pool, Hook, Executor, OraclePolicy, Asset,
PayoutAsset, Merchant, Payer, Order, Settlement, HookReceipt, ExecutorReceipt, LiquiditySeed, MarketPause,
MarketUnpause, MarketRetirement, CapChange, RoleChange, TokenImplementationObservation, DeploymentManifest,
EvidenceStatus — is covered in §4, in full, including the ones for which the honest answer is "not
reconstructable from chain data alone."

**Not in scope, and never done here.** No account, deploy key, or paid infrastructure is created or described
beyond its setting name. No subgraph is deployed or published. No contract or application code is touched. No
claim is made that UNICA v4 contracts exist — they do not (task boundary, restated from `EVENT-SCHEMA.md` §1).
No claim is made about ETHGlobal prize eligibility; that belongs to
`docs/unica-v5/graph/PRIZE-FIT.md` and to `docs/unica-v5/graph/MENTOR-QUESTIONS.md` for anything unresolved.
No claim is made about which network(s) The Graph actually supports for Robinhood Chain Testnet (46630) or Arc
testnet beyond what `EVENT-SCHEMA.md` §10.1 already states as UNKNOWN — the exhaustive comparison lives in
`docs/unica-v5/graph/NETWORK-OPTIONS.md`; this document assumes, for schema-design purposes only, that a
network exists on which a standard subgraph can be deployed, and calls out the one entity
(`DeploymentManifest`, §4.23) that must record which network that turned out to be.

**The one rule every entity below obeys.** The Graph is a derived read and evidence layer. Contracts are the
source of settlement truth (task boundary). No entity here authorizes, creates, or settles a payment; every
entity is either a decoded log, a value read once through a `view` call and cached, or an explicit aggregation
over decoded logs — never a substitute for the on-chain checks in `SPEC-CONTRACTS.md`. Where a field cannot be
reconstructed from chain data alone, that is stated plainly in the entity's own row rather than left implicit.

## 2. Vocabulary: BUILT vs SPECIFIED-NOT-BUILT

Every entity in §4 opens with one of three tags, and the tag never softens on repetition:

- **BUILT.** A real ABI, a deployed contract, and a subgraph manifest exist for the source event in this
  repository today. Cited to the file under `integrations/graph/` or `integrations/graph-v2/`. The V1 hook
  (`0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`, Sepolia, start block 11639895) and V3 hook
  (`0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0`, Sepolia, start block 11667702) are both live and both indexed
  by the one deployed subgraph (T4, T6). The V2 executor is compiled and tested against a fork but **not
  deployed to any public chain** (T5) — it is BUILT in the sense that its ABI, schema, and mapping exist and
  are tested, and its entities are marked accordingly with that qualifier repeated, never dropped.
- **SPECIFIED-NOT-BUILT.** The event exists only as a signature and field table in `docs/unica-v4/EVENT-SCHEMA.md`
  or `docs/unica-v4/SPEC-CONTRACTS.md`. No UNICA v4 contract has been written, compiled, or deployed (task
  boundary, restated). Every such entity below cites the exact section (for example "EVENT-SCHEMA.md §4.1") it
  comes from, and never claims a topic0, since `EVENT-SCHEMA.md` §2 and §14 item 1 are explicit that topic0 "is
  computed at implementation" and is not yet a real value.
- **PROPOSED.** A UNICA v5 design choice with no source event of its own — an aggregation, a rollup, a
  convenience row, or a decision about how to store something the chain does not store as one field. A
  PROPOSED entity is still built only from BUILT or SPECIFIED-NOT-BUILT source events; it never invents a
  field the chain does not emit, and its provenance line says exactly which underlying event(s) it is computed
  from.

A fourth combination — SPECIFIED-NOT-BUILT plus PROPOSED — appears where this document extends a v4-specified
design beyond what `EVENT-SCHEMA.md` §10.2 already sketches (for example, indexing PoolManager logs that §10.2
explicitly says are *not* indexed by the v4 subgraph plan, see `Pool` and `LiquiditySeed` below). That
combination is flagged every time, because it is a divergence from the existing specification's own indexing
plan, not a restatement of it, and the owner has not ruled on it.

## 3. What exists today (BUILT) — the V1/V3 and V2 subgraphs

Read directly from the repository (T4, T5), not re-derived, and not contradicted below.

### 3.1 `integrations/graph/` — the V1/V3 receipt subgraph (deployed)

`specVersion: 1.0.0`, mapping `apiVersion: 0.0.9`, `language: wasm/assemblyscript`, network `sepolia`. Two
`kind: ethereum` data sources sharing one ABI (`V4SettlementHook`): the V1 hook from start block 11639895 and
the V3 hook (named `UnicaHookV3` in the manifest) from start block 11667702, each with one event handler on
`SettlementReceipt(indexed bytes32, indexed bytes32, indexed address, uint16, address, address, address,
address, uint128, uint128, uint128, bytes32)` → `handleSettlementReceipt`. Per `README.md` (T6), this subgraph
is **deployed and synced** at Subgraph Studio (`https://api.studio.thegraph.com/query/1755384/unica-settlements/v2-39b6f91`)
with `hasIndexingErrors: false`, and returns a decoded `Settlement` matching a real receipt (`amountIn
1000000000000000`, `amountOut 2003660`, id = the transaction hash followed by log position `0x6b`). This is the
one part of the whole settlement evidence graph that is live evidence today, not a design.

**The one entity**, `Settlement @entity(immutable: true)` (T4 `schema.graphql`): 17 scalar fields — `id`
(`Bytes`, transaction hash `concatI32` log index), `network` (from `dataSource.network()`), `schemaVersion`,
`orderId`, `poolId`, `payer`, `recipient`, `currencyIn`, `currencyOut`, `amountIn`, `amountOut`, `fee`,
`policyId` ("reserved; zero until the executor applies a policy or benefit" per the schema's own comment),
`executor`, `hook` (the log's own `event.address`, not a field of the event itself), `blockNumber`,
`blockTimestamp`, `transactionHash`, `logIndex`. No relations, no derived fields, no aggregation. The handler
(T4 `src/mapping.ts`) guards on `schemaVersion == 1` and returns early otherwise — "a later schema version gets
its own handler; version 1 fields are never reinterpreted," a comment this document's versioning policy (§9)
inherits rather than re-derives.

**What this flat shape cannot answer, and is why §4 exists.** One entity, no relations, means: no way to ask
"which market is this," "was this market ever paused," "does this hook belong to the official registry," or
"what did this merchant receive in total this month" without a client re-joining raw addresses by hand. The V1
and V3 hooks are the *frozen experimental generation* (see `docs/unica-v4/SPEC-CONTRACTS.md` §1.1) — this
subgraph is real, live evidence of what The Graph can do for UNICA, but it indexes the earlier generation's
9-field receipt (three `indexed` topics, `uint16 fee`, no market identity, no lifecycle, no oracle reference),
not the v4 event surface this document designs against.

### 3.2 `integrations/graph-v2/` — the V2 invoice-settlement subgraph (built, not deployed)

Separate manifest, separate schema, `network: sepolia` but the manifest's own description (T5
`subgraph.yaml`) states the address is "the FORK-LOCAL executor from `test/fork`" — V2 has never been deployed
to any public chain (also stated independently in `docs/v2/SECURITY-ADVISORY-001.md`, T3: "**Deployed? No.**").
One `QuoteSettlementExecutor` data source, one event handler on `QuoteSettled(...)` (15 fields) →
`handleQuoteSettled`.

**Two entities**, both instructive for §4's design: `InvoiceSettlement @entity(immutable: true)` (id =
`keccak(network) ++ executor ++ transactionHash ++ logIndex`, deliberately built so distinct settlements
cannot share an id even across a redeployed executor on the same network) and `Deployment @entity(immutable:
false)` (id = `network ++ executor`, holding `settlementCount`, `firstBlock`, `lastBlock`, and a `@derivedFrom`
list back to its settlements). `Deployment` is the one place in either existing subgraph that uses a derived
relation, and its own doc comment is the discipline this whole document follows: *"Its presence proves a
matching settlement receipt was indexed. Its ABSENCE proves nothing on its own — an invoice may be unpaid,
unknown to this subgraph, expired, settled on another deployment, or simply not yet indexed."* `policyVersion`
is stored as `BigInt`, not `Int`, with the schema's own comment explaining why: `policyVersion` is a `uint32`
on chain and GraphQL's `Int` is a signed 32-bit integer, so the top half of the range would truncate — a
correctness rule this document reuses verbatim in §4 for every `uint32`/`uint48`/`uint64`/`uint128` field
(never `Int`, always `BigInt`, or `BigInt` narrowed to a documented safe range).

### 3.3 What neither existing subgraph attempts

Neither indexes a registry, a market, a lifecycle transition, an oracle policy, a cap, a role, or a pause —
because neither the frozen generation nor V2 has a registry at all (`SPEC-CONTRACTS.md` §1.1: "TSLA and uTUSD
were constructor constants" in the frozen generation; V2 has no market concept either). Every entity in §4
beyond `HookReceipt`/`ExecutorReceipt` (the direct v4 analogues of `Settlement`/`InvoiceSettlement`) is new
design, not an extension of an existing shape.

## 4. Entity catalogue

Each entity below is stated first in prose (id strategy, source events, relationships, mutability, reorg and
finality behavior, provenance, reconstructability) and then, in §4.27, as one buildable `graphql` block that
declares every type named here with concrete fields, nullability and `@derivedFrom` targets. The two are the
same design in two forms; §4.27 introduces no field or fact absent from §4.1–§4.26, and cites this section's
numbering throughout rather than restating its reasoning.

### 4.0 Shared conventions, stated once rather than repeated twenty-six times

- **Id strategy, default.** Every event-sourced immutable entity keyed to one log uses `id =
  event.transaction.hash.concatI32(event.logIndex.toI32())` (`Bytes`) — the exact pattern already BUILT and
  running (T4 `src/mapping.ts`: "One receipt, one immutable entity. The id is the transaction hash concatenated
  with the log index"). Every stable-identity entity (one row per on-chain object, not per log) uses the
  chain's own identifier where the chain already defines one: `marketId`, an `orderId`, or a contract/EOA
  address. No id below is invented independently of an on-chain value or an explicitly-labelled off-chain
  composite.
- **Standard log metadata.** Every log-keyed entity carries `network` (`String`, from `dataSource.network()`,
  T4's own field), `blockNumber` (`BigInt`), `blockTimestamp` (`BigInt`), `transactionHash` (`Bytes`),
  `logIndex` (`BigInt`) — identical to both BUILT schemas (T4, T5).
- **`Settlement`'s transaction-metadata exception.** `Settlement` (§4.15) is not log-keyed — its id is
  `orderId`, not a transaction-hash/log-index pair — so the "every log-keyed entity" scope above does not,
  by itself, cover it. It nonetheless stores `blockNumber`, `blockTimestamp` and `transactionHash` as
  explicit fields (never `logIndex`, which would be ambiguous between its two paired source logs), because
  EVENT-SCHEMA §8's fixed log order for `pay` guarantees `SettlementReceipt` and `Settled` land in the same
  transaction (restated at §4.15, §6): "the settling transaction's own block and hash" is exactly as
  well-defined for `Settlement` as for any single log, even though `Settlement` decodes two of them.
  `QUERIES.graphql` §1, §2, §3, §10, §11, §12 read these three fields directly from `Settlement`.
- **Type mapping.** `uint32`/`uint48`/`uint64`/`uint128`/`uint160`/`uint256` → GraphQL `BigInt`, never `Int`
  (T5's own documented reason, reused verbatim: GraphQL's `Int` is signed 32-bit and would truncate). `bytes32`
  → `Bytes`. `address` → `Bytes`, not `ID`/`String` (T4/T5's own convention), so values compare and filter as
  raw bytes. The one stated exception is the lifecycle status code (`uint8`, range 0–6), stored as `Int` on
  `MarketPause`/`MarketUnpause`/`MarketRetirement` (§4.19–4.21) since it cannot approach the 32-bit signed
  ceiling.
- **Immutability test.** "Immutable" below means the `@entity(immutable: true)` declaration is safe under The
  Graph's own documented rule (S4): *"mappings can make changes to immutable entities as long as those changes
  happen in the same block in which the entity was created."* An entity written by two events guaranteed to
  land in one transaction (for example `SettlementReceipt` then `Settled`, per EVENT-SCHEMA §8's fixed log
  order for `pay`) may be immutable; an entity that can be legitimately rewritten in a later, unrelated block
  (`Market.status`, `Order.settled`) may not, and is declared `@entity(immutable: false)` instead.
- **Reorg behavior, default.** Graph Node's own documented reorg-depth configuration is
  `ETHEREUM_REORG_THRESHOLD`, default 250 blocks (S9): *"Maximum expected reorg size, if a larger reorg
  happens, subgraphs might process inconsistent data."* Within that depth, an orphaned block's entity writes
  are rolled back and the winning chain's blocks are reprocessed — this is an indexer-operator configuration
  default, not a manifest-level or protocol-guaranteed finality rule, and no more specific official
  reorg-rollback document than S9 was found (S7, S8 checked, both empty on this topic — a stated gap, not a
  silent one). Every entity below inherits this default unless its own row says otherwise.
- **Finality status, default.** `_meta.block.number` (S6) is the last block this subgraph has indexed, with no
  `safe`/`finalized` marker of its own (none was found in S6's own field list). A consumer needing to know
  whether a specific indexed block is reorg-safe must compare `_meta.block.number` against the chain's own
  `safe`/`finalized` tag over RPC, outside the subgraph. `EvidenceStatus` (§4.26) and the "receipts awaiting
  finality" query (`QUERIES.graphql` §11) exist because of this gap, not despite it.
- **Reconstructable-from-chain test.** Could an indexer with only `eth_getLogs`/Firehose access and the
  contract ABIs rebuild this entity's fields from nothing else? Where the answer is no or partial, the entity's
  own row says exactly what off-chain input is needed and why, rather than leaving the gap implicit.

### 4.1 `ProtocolRelease` — PROPOSED

No event names a "release" as such; this groups one immutable factory/registry pair under the identity SC §12
already gives it on-chain: a changed hook or executor is "new code with a new `HOOK_CREATION_CODE_HASH`, which
the deployed factory refuses, so it ships as a new factory, release and manifest (U4, SC §12)." **Id:** the
factory's own address (`Bytes`) — one factory embodies one release generation, since a factory's
`HOOK_CREATION_CODE_HASH` is immutable (SC §7). **Source:** no dedicated event; populated by one `try_`-pattern
call (S3) to the factory's own immutable views — `HOOK_CREATION_CODE_HASH()`, `POOL_MANAGER()`, `REGISTRY()`
(SC §7) — the first time this release's Registry data source handles any event, plus a human-supplied release
tag copied from the off-chain deployment manifest (never inferred). **Relationships:** has-many `Registry`
(modelled has-many for forward compatibility; in practice exactly one, since the registry is `CREATE(factory,
1)`, SC §3/§7); has-many `Market` (via Registry). **Immutable vs derived:** the three on-chain reads are safe
to cache once and never re-read; the release tag is off-chain provenance and must never be presented as if the
chain stated it. **Reorg/finality:** negligible once the deployment transaction itself is finalized — before
that, the data source these facts are read through was never validly instantiated on the canonical chain
(§6). **Provenance:** mixed (on-chain immutables plus an off-chain tag). **Reconstructable from chain alone:**
PARTIAL — the three addresses/hash, yes; the human-readable release name, no (that is what `DeploymentManifest`,
§4.25, exists to record, and `ProtocolRelease` should relate to it rather than duplicate it).

### 4.2 `Registry` — SPECIFIED-NOT-BUILT (SC §6; EVENT-SCHEMA §4)

**Id:** the registry's own address (`Bytes`) — "one per deployment" (SC §6). **Source:** created the first
time any of its nine events (EVENT-SCHEMA §4.1–4.6) is handled, or at the Registry data source's own
`startBlock` (address and block from the off-chain deployment manifest, EVENT-SCHEMA §9's "MF" row).
**Relationships:** belongs-to `ProtocolRelease` (via its factory); has-many `Market`; has-many `RoleChange`
(§4.23, `@derivedFrom`). **Immutable vs mutable:** immutable — `factory` (SC §6 `FACTORY`), `requireOracle`
(SC §6 `REQUIRE_ORACLE`, "true for every mainnet deployment and false only for the 46630 rehearsal"), `network`.
Mutable, written by `RoleChange` events: `admin`, `pendingAdmin`, `pauser` — cached copies of SC §6's storage
slots of the same names, with the full history in `RoleChange`. **Reorg/finality:** standard (§4.0).
**Provenance:** on-chain once seeded with an address supplied off-chain (the manifest). **Reconstructable from
chain alone:** YES for every field once seeded; the seed address itself is, as with every data-source address
in this catalogue, off-chain-supplied.

### 4.3 `Factory` — SPECIFIED-NOT-BUILT, and the one contract with zero events (SC §7)

EVENT-SCHEMA §3 states it plainly: `UnicaMarketFactory` emits **no events**, "so one emitter carries the whole
lifecycle" (the registry). **This document's PROPOSED default** is therefore *not* to model `Factory` as its
own row at all, but as three `Bytes`/`Bool` fields directly on `Registry`/`ProtocolRelease`
(`poolManager`, `hookCreationCodeHash`) — there being no event-driven reason to give an event-less contract its
own entity. **The alternative, recorded rather than chosen:** a standalone `Factory` entity, seeded the same
way as `ProtocolRelease` (one `try_` call per immutable view, S3), useful only if a future design wants to
record `previewMarket` calls or other off-chain-initiated reads against it — which are themselves `view` calls,
never logged, and so would need their own off-chain capture mechanism this document does not design. **Id** (if
built): the factory's address. **Immutable vs mutable:** entirely immutable (constructor reads only).
**Reorg/finality:** negligible, as `ProtocolRelease` (§4.1). **Provenance:** on-chain, once seeded with an
address supplied off-chain. **Reconstructable from chain alone:** YES for the three immutable fields, once
seeded.

### 4.4 `Market` — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §4.1, §10.2; SC §3, §6)

**Id:** `marketId` (`Bytes`) = the on-chain `bytes32` from EVENT-SCHEMA §4.1 field 1 —
`keccak256(abi.encode(block.chainid, address(registry), asset, payout, version, policy.adapter,
policy.feedId))`. Chain id, release, and the oracle route are all cryptographically committed inside this one
value (SC §3: "the route is cryptographically bound into the id itself"), though not separately recoverable
from the hash — `network` is still stored as its own explicit field (§4.0's convention), never decoded from the
id. **Source events:** created by `MarketProposed` (EVENT-SCHEMA §4.1); updated by `MarketStatusChanged`
(§4.2, `status`/`updatedAt`), `MarketSeeded` (§4.3, `seedDepth`), `OraclePolicySet` (§4.4, a cached current-policy
snapshot), `CapsSet` (§4.5, a cached current-caps snapshot). **Relationships:** belongs-to `Registry`;
belongs-to `ProtocolRelease` (via Registry→Factory); has-one `Hook` (`Hook.id == Market.hook`); has-one
`Executor`; has-one `Asset` (the asset side); has-one `PayoutAsset` (the payout side); has-many `MarketVersion`
siblings sharing the same (asset, payout) pair at different versions (§4.5); has-many `Order` (via Executor);
has-many `OraclePolicy` history (§4.9, `@derivedFrom`); has-many `CapChange` history (§4.22, `@derivedFrom`);
has-many `MarketPause`/`MarketUnpause` and an optional `MarketRetirement` (§4.19–4.21, `@derivedFrom`); has-one
`LiquiditySeed` (§4.18, at most one on the honest path, SC §15 item 6: "a live market is never reseeded,
widened or recentred"). **Immutable-at-creation fields:** `asset`, `payout`, `version`, `hook`, `executor`,
`poolId`, `fee`, `tickSpacing`, `rateE18`, `initSqrtPriceX96`, `initTick`, `demonstrationOnly` — every one of
SC §6's `_markets[id]` identity/pricing fields, "written by `register`, once... never rewritten." **Mutable
fields, "current status as last indexed"** (EVENT-SCHEMA §10.2's own phrase, repeated deliberately as a
warning, not a footnote): `status`, `updatedAt`, `seedDepth`, cached `policyAdapter`/`policyFeedId`/
`policyMaxAge`/`policyMaxDeviationBps`/`policyEnabled`, cached `capMaxPerTx`/`capMaxPerDay`/`capMaxSeed`.
**PROPOSED addition, on a SPECIFIED-NOT-BUILT base, called out rather than folded in silently:** `assetDecimals`,
`payoutDecimals`, `assetIsCurrency0`, `proposedAt` — EVENT-SCHEMA §4.1's own "not carried" list, read live via
`getMarket(marketId)` rather than emitted; this document proposes caching them at `MarketProposed`-handling time
via one `try_` call (S3), since every amount elsewhere in this schema needs `assetDecimals`/`payoutDecimals` to
render correctly. **Reorg/finality:** standard (§4.0). **Provenance:** fully on-chain, once the registry's
address is known. **Reconstructable from chain alone:** YES, in full, for the specified fields; the one PROPOSED
addition is likewise chain-derivable, just not chain-emitted.

### 4.5 `MarketVersion` — PROPOSED

No event of its own; the subgraph-side mirror of two registry **views** SC §6 already exposes —
`latestVersion[asset][payout]` and `liveMarketOf[asset][payout]` — expressed as a queryable row instead of an
RPC round trip, so `QUERIES.graphql` §6 ("a market's historical versions") can list every version of a pair in
one query rather than walking versions 1..N by hand. **Id:** PROPOSED `keccak256(registry address, asset
address, payout address)` — the pair identity, independent of any one version. **Source events:** none
directly; recomputed whenever a sibling `Market` is created (a new version) or transitions to RETIRED (clears
liveness) for the same pair. **Relationships:** has-many `Market` (`@derivedFrom`, ordered by `version`); at
most one is "live" at a time (SC §6: "one non-retired market per (asset, payout)"). **Immutable vs mutable:**
entirely derived/mutable — `latestVersion` (`BigInt`) and `liveMarketId` (`Bytes`, nullable) update with every
sibling `Market` write. **Reorg/finality:** standard, provided the mapping writes `MarketVersion` inside the
same handler that writes the triggering `Market`, so Graph Node's block-scoped rollback (§4.0) covers both
together. **Provenance:** fully derived from on-chain events `Market` already captures. **Reconstructable from
chain alone:** YES — a pure re-projection, no new on-chain read.

### 4.6 `Pool` — SPECIFIED-NOT-BUILT identity, PROPOSED enrichment that **diverges** from the v4 spec's own plan

`Market.poolId` (SC §4.1 field 7) is already SPECIFIED-NOT-BUILT and sufficient to *identify* a pool. A richer
`Pool` entity — current tick, current liquidity, swap history — requires indexing the shared Uniswap v4
`PoolManager` contract's own `Initialize`, `Swap`, `ModifyLiquidity`, `ProtocolFeeUpdated`,
`ProtocolFeeControllerUpdated` logs (EVENT-SCHEMA §8's external-events table), and **EVENT-SCHEMA §10.2 already
decides against this**: *"Not indexed: the PoolManager's Swap, ModifyLiquidity and ProtocolFee* logs, which
cover every pool; the watcher reads them by RPC with a poolId topic filter."* Building the fuller `Pool` entity
below therefore means reversing an existing decision, not extending it — flagged per §2's rule for a
SPECIFIED-NOT-BUILT-plus-PROPOSED combination. **Id:** `poolId` (`Bytes`). **Source events (external, if
adopted):** the five PoolManager events above. **Relationships:** has-one `Market`, but **only** if
`marketIdOfPool(poolId) != 0` on the official registry (SC §3's "Official" test, applied at index time — never
assumed from a PoolManager log alone, since PoolManager is shared by every pool on the chain, UNICA's and
everyone else's). **Immutable vs mutable:** `currency0`, `currency1`, `fee`, `tickSpacing`, `hooksAddress`,
`initSqrtPriceX96`, `initTick` set once by `Initialize`, never rewritten (a pool cannot be re-initialized);
`currentTick`, `currentSqrtPriceX96`, `liquidity`, `protocolFee` mutable, updated by every later log.
**Reorg/finality:** standard, but at far higher volume than any UNICA-specific entity, since `Swap` fires for
every trade on the pool, not only UNICA's (the hook's own `NotSettlementExecutor` gate, SC §8.1, is enforced
on-chain by the hook, not by an indexer watching PoolManager directly — an indexer taking this path must apply
the same `sender == executor` check itself, exactly the job EVENT-SCHEMA §8 already assigns to the watcher, not
to the subgraph). **Provenance:** on-chain, but from a contract UNICA does not own; "official" status for a
given `poolId` is a UNICA-side judgment (a registry lookup), never a PoolManager-side fact. **Reconstructable
from chain alone:** YES for pool mechanics; the "is this an official UNICA pool" judgment additionally needs
`Market`/`Registry`, which is exactly why §5 makes registry-first authentication mandatory, never poolId-first.
**This document's recommendation** (consistent with §7/§8's conclusions below): keep `Pool` limited to the
fields already visible through `Market` for a first cut — poolId, fee, tickSpacing, currency identities — and
leave live pool mechanics to RPC/StateView (`SPEC-CONTRACTS.md` §13's "PoolManager, via StateView" row),
matching EVENT-SCHEMA §10.2's existing decision rather than reversing it. The fuller entity above is recorded
as the alternative, for the owner to choose, not as a default this document adopts.

### 4.7 `Hook` — SPECIFIED-NOT-BUILT (SC §8)

**Id:** the hook's own CREATE2 address (`Bytes`) — "one instance per market, at a factory-CREATE2 address whose
low 14 bits are exactly `0x20C0`" (SC §8). **Source:** instantiated via a data-source **template**
(`Template.create(address)`, S2) inside the `MarketProposed` handler, with `marketId` passed as context
(`createWithContext`, S2; EVENT-SCHEMA §10.2: "Templates UnicaMarketHook and UnicaMarketExecutor are
instantiated in the MarketProposed handler with marketId as context"). Per S2, a template "will only process
the calls and events for the block in which it was created and all following blocks, but will not process
historical data" — not a limitation here, since a hook has no state before its own creation block. Updated by
`SettlementReceipt` (a cached `receiptCount`). **Relationships:** belongs-to `Market` (1:1, `Market.hook ==
Hook.id`); has-many `HookReceipt` (`@derivedFrom`). **Immutable:** `poolManager`, `factory`, `registry`,
`marketId`, `assetToken`, `payoutToken`, `fee`, `tickSpacing`, `assetDecimals`, `payoutDecimals`,
`assetIsCurrency0`, `poolId`, `executor`, `requireOracle` (SC §8's full immutables list). **Mutable:**
`receiptCount` — a cached echo of the hook's own `receiptCount` storage slot (SC §8: "written only in
`_afterSwap`"), incremented once per indexed `HookReceipt` rather than re-read over RPC; during indexing lag the
subgraph's copy can only trail the chain's, never exceed it, since a receipt cannot be indexed before its
transaction is mined. **Reorg/finality:** standard. **Provenance:** on-chain, once the template is instantiated
from an *official* `MarketProposed` — gated structurally by §5's authentication chain, since the data source
watching for `MarketProposed` is address-pinned to the real registry, never topic-pinned alone. **Reconstructable
from chain alone:** YES, entirely, once the registry's address and start block are known.

### 4.8 `Executor` — SPECIFIED-NOT-BUILT (SC §9)

**Id:** the executor's own `CREATE(hook, 1)` address (`Bytes`). **Source:** template-instantiated alongside
`Hook` in the same `MarketProposed` handler (both addresses are `MarketProposed` fields, EVENT-SCHEMA §4.1
fields 5–6); updated by `OrderCreated` (a cached `orderCount`) and `Settled` (marks the matching `Order`
settled; contributes to a derived `payoutUsedTodaySnapshot`, below). **Relationships:** belongs-to `Market`
(1:1); has-many `Order` (`@derivedFrom`); has-many `ExecutorReceipt` (`@derivedFrom`). **Immutable:**
`poolManager`, `hook`, `registry`, `marketId`, `assetToken`, `payoutToken`, `fee`, `tickSpacing`,
`assetIsCurrency0` (SC §9's immutables). **Mutable/derived:** `orderCount` (cached echo, same caveat as
`Hook.receiptCount`); `payoutUsedTodaySnapshot` / `payoutUsedTodayDay` — **PROPOSED, and explicitly not a mirror
of the contract's own state**, because the contract's real counter, `payoutUsedOnDay[utcDay]` (SC §9.2), is
written internally inside `pay` and **never emitted in any event** — there is no field of `Settled` or
`SettlementReceipt` that carries it. This document proposes computing it as an aggregate — the sum of
`ExecutorReceipt.amountDelivered` for this executor within the current UTC day, `block.timestamp / 86400` (SC
§9.2's own day boundary, reused identically) — reconstructable from already-indexed logs, but stated plainly as
a **derived approximation for display and reconciliation only** (`QUERIES.graphql` §12), never a substitute for
the contract's own live value, which `pay()` itself rechecks on every call (SC §9.2: "Read live: `tightenCaps`
binds the next payment"). **Reorg/finality:** standard for `orderCount`; the day aggregate additionally depends
on every same-day `Settled` being indexed, which is why it should always be shown with an indexing-lag
disclosure, not presented as a closing balance. **Provenance:** on-chain, once instantiated from an official
`MarketProposed` (same authentication chain as `Hook`). **Reconstructable from chain alone:** YES for the
immutables and `orderCount`; PARTIAL, as described, for the day aggregate.

### 4.9 `OraclePolicy` — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §4.4; SC §6)

Named `OraclePolicy` here per the task's entity list; `EVENT-SCHEMA.md` §10.2 calls the identically-shaped
history row `PolicyChange` — same event, same fields, renamed once here rather than at every mention. **Id:**
`transactionHash.concatI32(logIndex)` (`Bytes`) — one immutable row per `OraclePolicySet` emission, at
`register` and at every `tightenOraclePolicy` (EVENT-SCHEMA §4.4: "the last event alone is the current
policy"). **Source event:** `OraclePolicySet(bytes32 indexed marketId, address adapter, bytes32 feedId, uint48
maxAge, uint16 maxDeviationBps, bool enabled)`. **Relationships:** belongs-to `Market` (`@derivedFrom`, so
`market.oraclePolicyHistory` lists every row in emission order); the *current* policy is available either as
`Market`'s own cached snapshot (§4.4, O(1)) or as this entity's own latest row by block number (authoritative
by construction, since it is the raw log). **Immutable:** fully — `adapter`, `feedId`, `maxAge`,
`maxDeviationBps`, `enabled`, exactly the event's own fields; EVENT-SCHEMA §4.4 states the event always carries
"the full policy after the change," so no row is ever partial. **Reorg/finality:** standard. **Provenance:**
fully on-chain. **Reconstructable from chain alone:** YES. **What it is not:** a disabled, all-zero row
(`enabled = false`) is only possible where `REQUIRE_ORACLE` is false (SC §6's policy-validity rule (b)) — this
document never treats an absent `OraclePolicy` row as "no policy," since a row always exists; `demonstrationOnly`
on the same `Market` is the field a UI should key its "Demonstration rate — no oracle" label from (SC §8.2,
EVENT-SCHEMA §5).

### 4.10 `Asset` — PROPOSED

No dedicated event; assembled from `Market.asset` plus a cached `assetDecimals` read (§4.4's "not carried, and
not invented" note). **Id:** the token's contract address (`Bytes`), scoped to the one network this deployment
indexes; a future multi-chain deployment would need a `network ++ address` composite instead, exactly as
`integrations/graph-v2`'s `Deployment` entity already does (T5) — recorded as a forward-compatibility note, not
built now, since the v4 beta plan is single-chain (`SPEC-CONTRACTS.md` §1.2). **Source:** first observed inside
a `MarketProposed` handler; `decimals` from the same `try_`-pattern (S3) read `Market` already proposes
caching. **Relationships:** has-many `Market` (as the asset side, `@derivedFrom`). **Immutable vs mutable:**
`decimals`, as read the first time this token is seen, is treated as fixed for this entity's purposes, with the
explicit caveat that an upgradeable or malicious token could change its own `decimals()` later — this document
does not re-poll it here; `TokenImplementationObservation` (§4.24) exists to catch that class of drift
separately. **Reorg/finality:** standard; a reorg removing the only `MarketProposed` that referenced this token
removes the `Asset` row too, if nothing else references it. **Provenance:** on-chain read, cached at first
sight. **Reconstructable from chain alone:** YES, with the staleness caveat above.

### 4.11 `PayoutAsset` — PROPOSED, structurally identical to `Asset`, kept as a separate type on purpose

Populated from the `payout` side of `MarketProposed` and a cached `payoutDecimals` read; every dimension
(id, source, relationships, immutability, reorg, finality, provenance, reconstructability) mirrors `Asset`
(§4.10) exactly, substituting the payout side throughout. **Why a separate type rather than a role flag on one
`Token` type:** the task's entity list names `Asset` and `PayoutAsset` separately, and SC §9.2 gives the payout
side its own product semantics — "one stablecoin per market" (recs 38, 39), with accepted-asset rules framed
around it — that the asset (input) side has no equivalent of anywhere in `SPEC-CONTRACTS.md`. **The honest cost
of the split, stated rather than hidden:** nothing in `SPEC-CONTRACTS.md` forbids the same token address from
being an `Asset` in one market and a `PayoutAsset` in another (`previewMarket`'s `SameToken` check, SC §7, only
forbids one market pairing a token with itself) — a client wanting "every token UNICA has ever touched" must
union both entity sets rather than read one. Recorded as an open question in §10, not resolved by fiat here.

### 4.12 `Merchant` — PROPOSED rollup, never an authorization record

`SPEC-CONTRACTS.md` §9.2 states the gap this entity fills and does not close: *"The merchant is the order's
`recipient` address; there is no on-chain merchant record or merchant id (rec 32)."* **Id:** the recipient
address (`Bytes`). **Source:** first observed the first time an address appears as `recipient` in `OrderCreated`
(EVENT-SCHEMA §6.1 field 2). **Relationships:** has-many `Order` (as recipient, `@derivedFrom`); has-many
`Settlement` (as recipient, `@derivedFrom`). **Immutable vs mutable:** nothing on-chain describes "who this
merchant is" beyond the address; `firstSeenBlock`/`firstSeenAt` is the one PROPOSED display field, derived from
the earliest `OrderCreated` naming this address. **Reorg/finality:** standard. **Provenance:** fully derived
from logs already indexed elsewhere, adding no new on-chain read. **Reconstructable from chain alone:** YES, as
a rollup — but it answers "which addresses have received UNICA payments," never "who owns this address" or "is
this a real merchant," a distinction this document keeps deliberately sharp, in the same spirit as
`integrations/graph-v2`'s own stated discipline (T5): presence proves indexing; absence proves nothing; and
here, additionally, an address proves nothing about the identity behind it.

### 4.13 `Payer` — PROPOSED rollup, symmetric to `Merchant`

**Id:** the order's bound `payer` address (`Bytes`) — EVENT-SCHEMA §6.1 field 4, "always non-zero in UNICA v4
(payer-bound only, Q111, Q128)." **Relationships:** has-many `Order` (as payer, `@derivedFrom`); has-many
`Settlement` (as payer, `@derivedFrom`). Every other dimension mirrors `Merchant` (§4.12). **Worth naming
explicitly:** `docs/v2/SECURITY-ADVISORY-001.md` (T3) found that an earlier release's payer-side authorization
did not bind the counterparty's half of a deal at all, letting a submitter redirect payment. UNICA v4's payer
binding is enforced on-chain by `WrongPayer` (SC §9.3) at the moment of `pay()`, not by this rollup — `Payer` is
downstream evidence that the binding held on every indexed settlement, never a second copy of the check itself,
and never a place a design could quietly substitute for it.

### 4.14 `Order` — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §6.1, §10.2)

**Id:** `orderId` (`Bytes`) = `keccak256(abi.encode(block.chainid, executor, creator, salt))` (EVENT-SCHEMA
§6.1 field 1), "never reused." **Source events:** created by `OrderCreated`; updated (not replaced) by
`Settled`. **Declared mutable** (`@entity(immutable: false)`) — the one deliberate exception to "immutable
wherever possible" in this catalogue beyond `Market`/`Executor`/`Registry`/`Hook`'s counters, because
`OrderCreated` and `Settled` are not guaranteed to land in the same block: an order can sit `Open` for any
duration up to its `deadline` (EVENT-SCHEMA §6.1 field 7: "strictly after creation, no ceiling"), so S4's
same-block exemption for immutable entities does not apply. **Relationships:** belongs-to `Executor` (→
`Market`); has-one `Merchant` (`recipient`); has-one `Payer` (`payer`); has-one `Settlement` (nullable — present
only once a `Settled` names this `orderId`). **Immutable-at-creation:** `recipient`, `creator`, `boundPayer`,
`amountIn`, `minOut`, `deadline`. **Mutable:** `settled` (`Bool`, false until `Settled`, never reverted back).
**Explicitly not stored:** "expired" — EVENT-SCHEMA §10.2's own rule, repeated here because it shapes query
design directly: `QUERIES.graphql` never filters on a stored "expired" field, since the subgraph has no live
clock beyond its last indexed block's timestamp; that comparison is left to the caller. **Reorg/finality:**
standard, but the two-write pattern means a reorg removing only the `Settled` transaction (while `OrderCreated`
stays canonical) must revert `settled` back to `false` — ordinary Graph Node rollback (§4.0) covers this as
long as both writes are normal entity mutations. **Provenance:** fully on-chain. **Reconstructable from chain
alone:** YES, in full.

### 4.15 `Settlement` — SPECIFIED-NOT-BUILT, the canonical success record (see §5, §8)

The v4 analogue of the BUILT `Settlement` (T4) and `InvoiceSettlement` (T5) — generalized to require the paired
`Settled` event neither earlier shape needed, because UNICA v4 deliberately splits evidence (the hook's
receipt) from the success signal (the executor's `Settled`): EVENT-SCHEMA §5, "Evidence, not success." **Id:**
`orderId` (`Bytes`) — one `Settlement` per order, ever (EVENT-SCHEMA §5's uniqueness rule, restated for the
order: an order settles at most once). **Source events:** created only when **both** a `SettlementReceipt`
(from the market's official hook) and a `Settled` (from the market's official executor) are observed for the
same `orderId` inside the same transaction — see §5, §8 for exactly why both and in what order to check them.
**Declared immutable** (`@entity(immutable: true)`) — safe under S4's rule, since EVENT-SCHEMA §8's own
transaction log-order table fixes `pay` as ending "…, receipt, input settlement, delivery, `Settled` (last)":
both writes land in one transaction, hence one block. **Relationships:** belongs-to `Order` (1:1); belongs-to
`Market` (via `Order`→`Executor`); has-one `HookReceipt` (§4.16); has-one `ExecutorReceipt` (§4.17); has-one
`Merchant`; has-one `Payer`. **Fields**, all copied from the two paired events, never recomputed: `currencyIn`,
`currencyOut`, `amountIn` (equal by on-chain construction across both events, SC §9.1 steps 3/5), `amountOut`
(from the receipt), `amountDelivered` (from `Settled`; equal to `amountOut` by `DeliveryNotExact`'s on-chain
guard, SC §9.1 step 5 — a stored mismatch would itself be evidence of an `Anomaly`, never silently resolved),
`hookFeePips` (always `0`), `lpFeePips`, `protocolFeePips`, `swapFeePips`, `referencePrice`,
`referenceDecimals`, `referenceUpdatedAt`, `demonstrationOnly` (EVENT-SCHEMA §5's remaining receipt fields,
minus the identifiers already lifted to relations). **Plus** the settling transaction's own `blockNumber`,
`blockTimestamp`, `transactionHash` — §4.0's log-metadata convention is scoped to log-keyed entities and
`Settlement` is keyed by `orderId`, not a log, but §4.0's stated exception for this entity applies: both
paired events are guaranteed inside one transaction (EVENT-SCHEMA §8), so these three are well-defined and
explicitly stored (never `logIndex`, ambiguous between the two source logs' own indices, which remain
available only through `hookReceipt.logIndex`/`executorReceipt.logIndex`). `QUERIES.graphql` §1, §2, §3,
§10, §11, §12 read them directly from `Settlement`. **Reorg/finality:** standard, same-block write pattern as
noted. **Provenance:** fully on-chain, contingent on §5's authentication chain — EVENT-SCHEMA's own EV8 row: "a
look-alike hook's receipt carrying the official marketId creates no subgraph entity." **Reconstructable from
chain alone:** YES, entirely — this is the point of §5/§8: two on-chain logs plus registry-based authentication,
no off-chain input beyond the registry's own address.

### 4.16 `HookReceipt` — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §5)

The v4-generation analogue of the BUILT `Settlement` in `integrations/graph/` (T4), deliberately renamed so it
is never confused with the composite `Settlement` above (distinct topic0 values across generations, EVENT-SCHEMA
§5: "no decoder can confuse them"). **Id:** `transactionHash.concatI32(logIndex)` — the same id strategy as the
BUILT entity, reused rather than redesigned. **Source event:** `SettlementReceipt` (EVENT-SCHEMA §5's 16-field
signature), authenticated per §2/§5's emitter rule: accepted only when `log.address ==
getMarket(marketId).hook`. **Relationships:** belongs-to `Hook` (the emitter); has-one `Settlement` (nullable
until the matching `Settled` is processed). **Immutable:** fully — a one-shot decoded log, never mutated after
creation. **Reorg/finality:** standard. **Provenance:** on-chain, registry-authenticated at index time, never
accepted on topic-match alone. **Reconstructable from chain alone:** YES. **Reading rule inherited from source:**
"Evidence, not success" (EVENT-SCHEMA §5) — a `HookReceipt` alone proves a swap happened inside the order's
bounds; it never proves the merchant was paid. No query in `QUERIES.graphql` treats `HookReceipt` alone as proof
of payment (§8 explains why).

### 4.17 `ExecutorReceipt` — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §6.2)

**Id:** `transactionHash.concatI32(logIndex)`. **Source event:** `Settled(bytes32 indexed orderId, address
indexed payer, address indexed recipient, address currencyIn, address currencyOut, uint256 amountIn, uint256
amountDelivered)`, authenticated per §3's emitter rule: accepted only when `registry.marketIdOfExecutor(log.
address) != 0`. **Relationships:** belongs-to `Executor` (the emitter); has-one `Settlement` (nullable until
paired). **Immutable:** fully. **Reorg/finality:** standard. **Provenance:** on-chain, registry-authenticated.
**Reconstructable from chain alone:** YES. **Reading rule inherited from source:** the success signal
(EVENT-SCHEMA §6.2's own label) — "a surface confirms a payment only from a mined transaction with status 1
holding one `Settled` from the market's executor with the expected `orderId`." §5/§8 explain why even this row,
alone, is not sufficient for the canonical record without its paired `HookReceipt`.

### 4.18 `LiquiditySeed` — SPECIFIED-NOT-BUILT base, PROPOSED enrichment flagged the same way as `Pool`

**Id:** `marketId` (`Bytes`) rather than a log-keyed id — SC §15 item 6 makes at most one honest-path row per
market ("a live market is never reseeded, widened or recentred"); a second `MarketSeeded` for the same market
is impossible on-chain (INITIALIZED → SEEDED is one-way and one-shot, SC §5) and would itself be logged as an
`Anomaly` if ever observed. **Source event (sufficient for the base field):** `MarketSeeded(bytes32 indexed
marketId, uint128 depthAtOpeningTick)` (EVENT-SCHEMA §4.3). **Source event (external, needed only for the
richer range fields, and only if `Pool`'s divergence, §4.6, is adopted):** the PoolManager `ModifyLiquidity` log
matching this market's `poolId`, between `initializeMarket` and `markSeeded` (EVENT-SCHEMA §8's "seed" row).
**Relationships:** belongs-to `Market` (1:1). **Immutable vs mutable:** `depthAtOpeningTick` is immutable, from
the on-chain event. `tickLower`/`tickUpper`, if populated, come from the external `ModifyLiquidity` log rather
than any UNICA event field — and `SPEC-CONTRACTS.md` §7 is explicit that its own primary record of these two
values is **off-chain**: "recorded as `tickLower` and `tickUpper` in the market configuration file and the
deployment manifest," with the on-chain log serving only as a cross-check ("readback asserts the seed
position's ticks... equal the recorded values," SC §7, S6). **Reorg/finality:** standard for
`depthAtOpeningTick`; the `ModifyLiquidity`-derived fields inherit `Pool`'s higher-volume caveat if adopted.
**Provenance:** mixed — on-chain for `depthAtOpeningTick`; mixed on-chain/manifest for `tickLower`/`tickUpper`.
**Reconstructable from chain alone:** PARTIAL — the range fields are derivable from the chain in principle, but
the specification's own source of truth for them is a manifest file, not the chain, and this entity states that
rather than implying the chain is primary.

### 4.19–4.21 `MarketPause`, `MarketUnpause`, `MarketRetirement` — SPECIFIED-NOT-BUILT, one event split three ways

All three are drawn from the single `MarketStatusChanged(bytes32 indexed marketId, uint8 indexed from, uint8
indexed to)` event (EVENT-SCHEMA §4.2). `EVENT-SCHEMA.md` §10.2 models every transition generically as one
`MarketStatusChange` row; this document splits that shape into the three task-named types by filtering on
`(from, to)`, recorded once here rather than three times:

- **`MarketPause`** — created only on `(from, to) == (4, 5)` (ACTIVE → PAUSED, SC §5 row 5, caller ADMIN or
  PAUSER).
- **`MarketUnpause`** — created only on `(from, to) == (5, 4)` (PAUSED → ACTIVE, SC §5 row 6, caller ADMIN
  only).
- **`MarketRetirement`** — created only on `to == 6` (RETIRED, terminal, from any of PROPOSED / INITIALIZED /
  SEEDED / ACTIVE / PAUSED, SC §5 rows 7–11, caller ADMIN).

**Id (all three):** `transactionHash.concatI32(logIndex)`. **Relationships (all three):** belongs-to `Market`
(`@derivedFrom`, so `market.pauseHistory`, `market.unpauseHistory`, `market.retirement` — the last nullable
until terminal). **Immutable:** fully, all three. **Common fields:** `marketId`, `previousStatus` (`Int`,
§4.0's stated exception), `newStatus` (`Int`), plus §4.0's standard log metadata. **What none of the three ever
claims**, stated a third time because it matters most here: EVENT-SCHEMA §2, *"Current state is not history...
An indexer never supplies current status, and its lag is shown."* A `MarketPause` row proves a pause transition
was indexed at some past block; it never proves the market is paused right now. `Market.status` (§4.4) is this
subgraph's best last-indexed guess and is itself explicitly lag-bound, never authoritative — `QUERIES.graphql`
§5's "all paused markets" query carries this exact warning in its own comment. **Reorg/finality:** standard for
all three, with one added note for `MarketRetirement`: since RETIRED is terminal and a relisted pair gets an
entirely new `marketId` at a bumped version (SC §3), a reorg that un-retires a market cannot collide with any
later version, because no later version could have been validly created against a live `marketId` in the first
place (SC §6: `liveMarketOf[asset][payout] == 0` required at `register`). **Provenance:** fully on-chain, all
three. **Reconstructable from chain alone:** YES, all three.

### 4.22 `CapChange` — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §4.5; SC §6)

`EVENT-SCHEMA.md` §10.2 names the equivalent row `CapsChange`; this document uses the task's singular
`CapChange`, recorded once as with `OraclePolicy`/`PolicyChange` (§4.9). **Id:**
`transactionHash.concatI32(logIndex)`. **Source event:** `CapsSet(bytes32 indexed marketId, uint128 maxPerTx,
uint128 maxPerDay, uint128 maxSeed)`, emitted at `register` and every `tightenCaps` — full values each time,
"`maxSeed` repeats on a tighten" since `tightenCaps` never touches the seed cap (SC §6's function table).
**Relationships:** belongs-to `Market` (`@derivedFrom`). **Immutable:** fully — `maxPerTx`, `maxPerDay`,
`maxSeed`, all `BigInt`. **Reorg/finality:** standard. **Provenance:** fully on-chain. **Reconstructable from
chain alone:** YES. **What it cannot answer alone, stated rather than blurred:** SC §9.2 and §15 item 5 are
explicit that the $100 cross-market total is "a deployment-script and manifest refusal... never described as
enforced on-chain." A complete `CapChange` history, however thorough, never proves a cross-market total was
respected — that check lives in deployment tooling this subgraph cannot see, and no entity here implies
otherwise.

### 4.23 `RoleChange` — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §4.6; SC §6)

**Id:** `transactionHash.concatI32(logIndex)`. **Source events, one `kind` per event:** `OrderCreatorSet(address
indexed creator, bool allowed)`, `PauserSet(address indexed previousPauser, address indexed newPauser)`,
`AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin)`,
`AdminTransferred(address indexed previousAdmin, address indexed newAdmin)` — **topic0 for all four is not yet
fixed** (EVENT-SCHEMA §12 item 2 / §14 item 1: "computed at implementation"), so this document names the four
kinds by event name only, never by a topic0 value it does not have. **Relationships:** belongs-to `Registry`
(`@derivedFrom`). **Immutable:** fully. **Fields:** `kind` (`String` enum of the four event names), `addressA`,
`addressB` (generic slot names, since the four events do not share one layout), `allowed` (`Bool`, nullable,
populated only for `OrderCreatorSet`). **Reorg/finality:** standard. **Provenance:** fully on-chain.
**Reconstructable from chain alone:** YES. **Open item inherited, not resolved here:** EVENT-SCHEMA §14 item 4
records that no registry event names its caller (`tx.from` for a direct call, or visible only in a Safe's own
log/trace for a Safe-mediated call, "Q64 NOT READY"), and adding a non-indexed `caller` field would change
topic0 — this entity has no `caller` field for exactly that reason; adding one here would assert a commitment
the specification has not made.

### 4.24 `TokenImplementationObservation` — PROPOSED

No named UNICA event backs it. EVENT-SCHEMA §8's own table gives its only source-adjacent citation:
"implementation change of a pinned proxy or beacon | whatever the pinned contract emits | U7: the watcher
alerts on it where one is emitted and also polls the implementation, since a missed log is not proof of no
change." SC §4 names the underlying risk: "a stock token's beacon owner, who can upgrade or pause it (A7, A8)"
is explicitly outside ADMIN's powers and outside UNICA's control. **Id:** PROPOSED `network ++ token address ++
observedAtBlock` (`Bytes` composite) — each observation is its own evidentiary row, never an overwrite.
**Source, two possible mechanisms, both stronger than passive listening alone:**
1. If the pinned proxy/beacon emits its own upgrade event (an OpenZeppelin-style `Upgraded(address indexed
   implementation)` is the common shape, but **UNKNOWN whether any specific UNICA-accepted token actually uses
   it** — not established in `SPEC-CONTRACTS.md` or `EVENT-SCHEMA.md`, carried to §10): an ordinary event-driven
   data source on that address.
2. If no such event exists, or as a defense against a missed one: a `blockHandlers` entry with a `polling`
   filter (`kind: polling, every: N`, S11 — flagged in §0 as search-derived, due a direct re-check before this
   exact YAML shape is relied on) that reads an implementation slot or view on a fixed interval via a `try_`
   call (S3), writing a new row only on a changed value.
**Relationships:** belongs-to `Asset` or `PayoutAsset` (whichever role the token plays — §4.11's open question
about a token playing both roles applies here identically, not solved twice). **Immutable vs mutable:** each
row is immutable once written; the set is append-only, and "the current implementation" is the latest row by
block number, the same pattern as `OraclePolicy` (§4.9). **Reorg/finality:** standard for the event-driven
mechanism; the polling mechanism means `observedAtBlock` is whatever block the poll landed on, not necessarily
the block the change happened in — a real change is only known to have occurred somewhere between two
observations, a resolution gap stated here rather than implied away. **Provenance:** on-chain reads only, never
off-chain. **Reconstructable from chain alone:** YES where an upgrade event exists; YES-but-resolution-limited
under polling; **NO** for a token that emits no upgrade event, is not polled, and reverts its own implementation
between two polls — a narrow but non-zero residual, recorded honestly in §10.

### 4.25 `DeploymentManifest` — PROPOSED, and the one entity whose honest provenance is "not the chain"

The subgraph-side mirror of `deployments/unica-v4/<chainId>.json`, which EVENT-SCHEMA §9's "MF" row already
names as the record of "per stage the transaction, block and log index that prove it; the registry's creation
block starts every indexer." This entity exists purely so a query can retrieve, from inside the graph, which
manifest this deployment claims to index — an integrity record, not a technical requirement (the manifest's
addresses feed the subgraph's own build-time `subgraph.yaml`/`networks.json`, T4's own pattern, whether or not
this entity exists). **Id:** PROPOSED `network ++ registry address`. **Source: not on-chain.** Populated once,
at deployment time, by copying the manifest file's own values (registry address, factory address, hook creation
code hash, start block, release tag) — either a one-time seed write at the manifest's own `startBlock` (S11,
same re-check caveat) or a literal baked into the mapping's build. Either way, this is off-chain configuration,
restated inside the graph for queryability, never derived from a chain read. **Relationships:** belongs-to
`ProtocolRelease` (§4.1); belongs-to `Registry` (§4.2). **Immutable vs mutable:** immutable by convention (a
manifest is never edited in place, matching this repository's own rule for `deployments/unica-v4/<chainId>.json`
and for the frozen `docs/RECEIPT-SCHEMA.md`) but declared `@entity(immutable: false)` unless the chosen seeding
mechanism is confirmed to write inside one triggering event's block — S4's same-block exemption should not be
assumed here without checking. **Reorg/finality:** not chain-derived, so not meaningfully reorg-sensitive — a
reorg of the seeding block would trigger Graph Node's ordinary rollback of that write (§4.0's mechanics still
apply), but the content itself is constant configuration, not chain state. **Provenance: entirely off-chain**,
stated plainly rather than dressed up — the task explicitly asks for this dimension per entity, including where
the honest answer is "a file in this repository, not the chain." **Reconstructable from chain alone: NO.**
Cross-checkable against the chain (the named registry can be probed for code; the factory's
`HOOK_CREATION_CODE_HASH()` can be compared against the manifest's own pinned hash, exactly as `SPEC-CONTRACTS.md`
§12 requires for a real deployment), but the manifest's claim that "this address is the official UNICA v4
registry for chain X" is a human/CI assertion, not a chain-derivable fact — the chain can confirm internal
consistency but cannot, alone, tell a reader which of many possible registries UNICA intends as canonical.

### 4.26 `EvidenceStatus` — PROPOSED

A composite of (a) The Graph's own built-in `_meta` field (S6: `block { number hash timestamp }`, `deployment`,
`hasIndexingErrors` — a protocol-level query resolver, not a stored entity at all) and (b) a UNICA-side
`Anomaly` rollup, since `_meta.hasIndexingErrors` reports only Graph Node's own mapping-execution failures, not
the semantic anomalies EVENT-SCHEMA §10.2 already names as a discipline this subgraph must keep: "Anomalies are
shown, never dropped... Zero anomalies is stated, not implied." **Id:** PROPOSED singleton per deployment,
`network ++ registry address` (matching `DeploymentManifest`, §4.25). **Source:** `_meta` is queried directly,
never stored; `Anomaly` rows (EVENT-SCHEMA §10.2's own entity, id transaction hash + log index, "kind and
detail," imported here rather than redesigned) are written by any handler that observes one of §7's rejection
conditions — a look-alike hook's receipt, a `Settled` with no matching `HookReceipt` in its transaction, a
receipt whose `marketId` mismatches its template context, and so on; `EvidenceStatus` aggregates that list.
**Relationships:** belongs-to `DeploymentManifest`; has-many `Anomaly` (`@derivedFrom`). **Immutable vs
mutable:** `anomalyCount`/`lastAnomalyAt`/`lastAnomalyKind` are mutable rollup fields; each `Anomaly` row, once
written, is immutable. **Reorg/finality:** standard for the stored rows and their rollup; `_meta.block.number`
needs no rollback logic of its own — it simply reports whatever the indexed head is once any reorg has already
been processed. **Provenance:** `_meta` is Graph Node's own bookkeeping (on-chain-derived indexing progress, not
UNICA-specific); `Anomaly`/`EvidenceStatus` are on-chain-derived UNICA-specific judgments. **Reconstructable from
chain alone:** YES for `Anomaly`/`EvidenceStatus` (pure re-derivation from already-indexed logs and §5's
authentication chain); `_meta` is not "reconstructed" — it is reported as-is. **Why this entity exists at all:**
"a stated negative beats an absence... an empty result and a broken reporter look identical" — this repository's
own operating rule, applied here rather than only stated. `EvidenceStatus` is the mechanism by which "0
anomalies, block 12,345,678 last indexed, no indexing errors" is a value a client can query and display, not a
claim made in prose with nothing behind it.

### 4.27 Concrete schema — every entity above as buildable GraphQL

The block below is portable into a future `schema.graphql`; it is not one, since no `subgraph.yaml` names
data sources for it yet (§10 item 3: no UNICA v4 contract exists, so no topic0 can be pinned to an
`eventHandlers` entry). It declares nothing this section's prose did not already state: every type name,
field, and relationship traces back to its own numbered entry above, cited in a leading comment. Every
`@entity(immutable: …)` tag applies §4.0's own immutability test; every scalar type applies §4.0's own
type-mapping rule (`uint32`/`48`/`64`/`128`/`160`/`256` → `BigInt`, `bytes32`/`address` → `Bytes`), extended
here, without introducing a new rule, to widths that rule did not enumerate: `uint8`/`uint16`/`uint24` are
stored as `Int`, by the identical reasoning §4.0 already gives for the one width it does name this way (the
lifecycle status code, "since it cannot approach the 32-bit signed ceiling") — a `uint24` tops out at
16,777,215, well inside `Int`'s signed 32-bit range. `Factory` (§4.3) is deliberately not declared as its own
type: this document's chosen default folds its three immutable reads into `ProtocolRelease`, exactly as
§4.3's own prose decides; the alternative it also records is not modelled here, so as not to assert a
commitment the owner has not made (§11 item 8). `Anomaly` is declared even though it is not one of the
task's 26 names, because `EvidenceStatus.anomalies` (§4.26) needs a real target type to be buildable — it is
EVENT-SCHEMA §10.2's own entity, imported rather than redesigned, exactly as §4.26 already says. Singular
("has-one") relationships below are modelled as plain, independently-written fields on both sides where §4
describes two entities each naming the other (for example `Market.hook` and `Hook.market`), rather than as
`@derivedFrom`, so that this schema's buildability does not depend on graph-node's support for `@derivedFrom`
on a non-list field — a detail this document did not independently verify and so does not rely on. Only
genuine one-to-many relationships use `@derivedFrom`, matching the one pattern already proven BUILT (T5's
`Deployment.settlements: [InvoiceSettlement!]! @derivedFrom(field: "deployment")`).

```graphql
# ---- §4.1 ProtocolRelease — PROPOSED ----
type ProtocolRelease @entity(immutable: false) {
  id: Bytes!                        # the factory's own address (§4.1) — one factory embodies one release generation
  poolManager: Bytes!               # factory.POOL_MANAGER(), read once via try_ (S3)
  hookCreationCodeHash: Bytes!      # factory.HOOK_CREATION_CODE_HASH(), read once via try_ (S3)
  registryAddress: Bytes!           # factory.REGISTRY(), read once via try_ (S3)
  releaseTag: String                # off-chain provenance, copied from the deployment manifest — never chain-stated (§4.1)
  registries: [Registry!]! @derivedFrom(field: "protocolRelease")
  deploymentManifest: DeploymentManifest   # plain, set once a DeploymentManifest row (§4.25) names this release
}

# ---- §4.2 Registry — SPECIFIED-NOT-BUILT (SC §6; EVENT-SCHEMA §4) ----
type Registry @entity(immutable: false) {
  id: Bytes!                        # the registry's own address — "one per deployment" (SC §6)
  network: String!
  protocolRelease: ProtocolRelease! # belongs-to, via the deploying factory (§4.1)
  factory: Bytes!                   # immutable, SC §6 FACTORY
  requireOracle: Boolean!           # immutable, SC §6 REQUIRE_ORACLE — true on every mainnet deployment, false only for the 46630 rehearsal
  admin: Bytes!                     # mutable, written by RoleChange (AdminTransferred)
  pendingAdmin: Bytes               # mutable, written by RoleChange (AdminTransferStarted / cleared by AdminTransferred)
  pauser: Bytes                     # mutable, written by RoleChange (PauserSet); null means none
  markets: [Market!]! @derivedFrom(field: "registry")
  roleChanges: [RoleChange!]! @derivedFrom(field: "registry")
}

# ---- §4.3 Factory — deliberately NOT modelled as its own type ----
# EVENT-SCHEMA §3: the factory "emits no events, so one emitter carries the whole lifecycle" (the registry).
# This document's chosen default (§4.3) folds its three immutable reads into ProtocolRelease above instead.
# The alternative (a standalone Factory entity, useful only for off-chain-initiated `previewMarket` capture)
# is recorded in §4.3's prose only — never adopted, never silently declared here as if it had been (§11 item 8).

# ---- §4.4 Market — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §4.1, §10.2; SC §3, §6) ----
type Market @entity(immutable: false) {
  id: Bytes!                        # marketId (bytes32) — EVENT-SCHEMA §4.1 field 1; commits chain id, registry and oracle route (SC §3), not separately decoded here
  network: String!                  # always its own field, never decoded from id (§4.0, §4.4)
  registry: Registry!
  version: BigInt!                  # uint32, field 4
  asset: Asset!                     # field 2
  payoutAsset: PayoutAsset!         # field 3
  hook: Hook!                       # field 5, write-once; Hook.id == Market.hook
  executor: Executor!               # field 6, write-once
  poolId: Bytes!                    # field 7, write-once
  fee: Int!                         # uint24, field 8
  tickSpacing: Int!                 # int24, field 9
  rateE18: BigInt!                  # uint256, field 10 — a demonstration rate the admin sets, never a market price
  initSqrtPriceX96: BigInt!         # uint160, field 11
  initTick: Int!                    # int24, field 12
  demonstrationOnly: Boolean!       # field 13, write-once
  status: Int!                      # 0 None .. 6 RETIRED (SC §5) — LAST-INDEXED ONLY, never authoritative (EVENT-SCHEMA §2)
  updatedAt: BigInt!                # block timestamp of the last-indexed MarketStatusChanged
  seedDepth: BigInt                 # uint128, MarketSeeded.depthAtOpeningTick; null until seeded
  policyAdapter: Bytes              # cached current OraclePolicySet.adapter
  policyFeedId: Bytes               # cached current OraclePolicySet.feedId
  policyMaxAge: BigInt              # uint48, cached current OraclePolicySet.maxAge
  policyMaxDeviationBps: Int        # uint16, cached current OraclePolicySet.maxDeviationBps
  policyEnabled: Boolean            # cached current OraclePolicySet.enabled
  capMaxPerTx: BigInt               # uint128, cached current CapsSet.maxPerTx
  capMaxPerDay: BigInt              # uint128, cached current CapsSet.maxPerDay
  capMaxSeed: BigInt                # uint128, cached current CapsSet.maxSeed
  assetDecimals: Int                # PROPOSED (§4.4) — uint8, read live via getMarket(marketId), not carried by MarketProposed
  payoutDecimals: Int               # PROPOSED, uint8, same source
  assetIsCurrency0: Boolean         # PROPOSED, same source
  proposedAt: BigInt                # PROPOSED, same source
  marketVersion: MarketVersion!     # the (asset, payout) pair row this Market is one version of (§4.5)
  oraclePolicyHistory: [OraclePolicy!]! @derivedFrom(field: "market")
  capChangeHistory: [CapChange!]! @derivedFrom(field: "market")
  pauseHistory: [MarketPause!]! @derivedFrom(field: "market")
  unpauseHistory: [MarketUnpause!]! @derivedFrom(field: "market")
  retirement: MarketRetirement      # plain, nullable, at most one (terminal) — set by the same handler that creates the row
  liquiditySeed: LiquiditySeed      # plain, nullable, at most one on the honest path (SC §15 item 6)
  pool: Pool                        # plain, nullable — only if the §4.6 divergence is adopted
}

# ---- §4.5 MarketVersion — PROPOSED ----
type MarketVersion @entity(immutable: false) {
  id: Bytes!                        # keccak256(registry address, asset address, payout address) — PROPOSED composite (§4.5)
  latestVersion: BigInt!
  liveMarketId: Bytes               # null if the latest version is RETIRED and not yet relisted
  markets: [Market!]! @derivedFrom(field: "marketVersion")
}

# ---- §4.6 Pool — SPECIFIED-NOT-BUILT identity, PROPOSED enrichment that DIVERGES from EVENT-SCHEMA §10.2 ----
# §10.2 decides against indexing PoolManager logs; §4.6's own recommendation is to leave this to RPC/StateView
# and keep Pool limited to fields already visible through Market. What follows is the alternative, recorded
# for the owner to choose (§11 item 2), not this document's adopted default.
type Pool @entity(immutable: false) {
  id: Bytes!                        # poolId (bytes32)
  market: Market                    # plain, nullable — set only if marketIdOfPool(poolId) != 0 on the trusted registry (§4.6); never assumed from a PoolManager log alone
  currency0: Bytes!
  currency1: Bytes!
  fee: Int!                         # uint24, set once by Initialize
  tickSpacing: Int!                 # int24, set once
  hooksAddress: Bytes!              # set once
  initSqrtPriceX96: BigInt!         # uint160, set once
  initTick: Int!                    # int24, set once
  currentTick: Int                  # mutable, updated by every later Swap/ModifyLiquidity
  currentSqrtPriceX96: BigInt       # mutable
  liquidity: BigInt                 # mutable
  protocolFee: Int                  # uint24, mutable, from ProtocolFeeUpdated
}

# ---- §4.7 Hook — SPECIFIED-NOT-BUILT (SC §8) ----
type Hook @entity(immutable: false) {
  id: Bytes!                        # hook address, CREATE2, low 14 bits 0x20C0 (SC §8)
  market: Market!                   # plain, 1:1 — Market.hook == Hook.id
  poolManager: Bytes!
  factory: Bytes!
  registry: Bytes!
  marketId: Bytes!
  assetToken: Bytes!
  payoutToken: Bytes!
  fee: Int!                         # uint24
  tickSpacing: Int!                 # int24
  assetDecimals: Int!               # uint8
  payoutDecimals: Int!              # uint8
  assetIsCurrency0: Boolean!
  poolId: Bytes!
  executor: Bytes!
  requireOracle: Boolean!
  receiptCount: BigInt!             # mutable, cached echo of the on-chain counter — may trail it under indexing lag, never exceed it (§4.7)
  hookReceipts: [HookReceipt!]! @derivedFrom(field: "hook")
}

# ---- §4.8 Executor — SPECIFIED-NOT-BUILT (SC §9) ----
type Executor @entity(immutable: false) {
  id: Bytes!                        # executor address, CREATE(hook, 1)
  market: Market!                   # plain, 1:1
  poolManager: Bytes!
  hook: Bytes!
  registry: Bytes!
  marketId: Bytes!
  assetToken: Bytes!
  payoutToken: Bytes!
  fee: Int!
  tickSpacing: Int!
  assetIsCurrency0: Boolean!
  orderCount: BigInt!               # mutable, cached echo, same caveat as Hook.receiptCount
  payoutUsedTodaySnapshot: BigInt   # PROPOSED, NOT a mirror of on-chain payoutUsedOnDay — a derived approximation only (§4.8)
  payoutUsedTodayDay: BigInt        # PROPOSED, block.timestamp / 86400 (SC §9.2's own day boundary)
  orders: [Order!]! @derivedFrom(field: "executor")
  executorReceipts: [ExecutorReceipt!]! @derivedFrom(field: "executor")
}

# ---- §4.9 OraclePolicy — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §4.4; SC §6) ----
# Named OraclePolicy per the task's entity list; EVENT-SCHEMA §10.2 calls the identically-shaped history row
# PolicyChange — same event, same fields, renamed once here as §4.9 already notes.
type OraclePolicy @entity(immutable: true) {
  id: Bytes!                        # transactionHash.concatI32(logIndex) — one row per OraclePolicySet emission
  market: Market!
  adapter: Bytes!
  feedId: Bytes!
  maxAge: BigInt!                   # uint48
  maxDeviationBps: Int!             # uint16
  enabled: Boolean!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

# ---- §4.10 Asset — PROPOSED ----
type Asset @entity(immutable: true) {
  id: Bytes!                        # token contract address, scoped to the one network this deployment indexes (§4.10 — a future multi-chain deployment needs a network++address composite, §9)
  decimals: Int!                    # uint8, cached at first sight — TokenImplementationObservation (§4.24) catches later drift separately
  markets: [Market!]! @derivedFrom(field: "asset")
}

# ---- §4.11 PayoutAsset — PROPOSED, structurally identical to Asset, kept separate on purpose (§4.11) ----
type PayoutAsset @entity(immutable: true) {
  id: Bytes!                        # token contract address
  decimals: Int!                    # uint8, cached at first sight
  markets: [Market!]! @derivedFrom(field: "payoutAsset")
}

# ---- §4.12 Merchant — PROPOSED rollup, never an authorization record ----
type Merchant @entity(immutable: true) {
  id: Bytes!                        # the recipient address — SPEC-CONTRACTS.md §9.2: "there is no on-chain merchant record or merchant id"
  firstSeenBlock: BigInt            # PROPOSED display field: the earliest OrderCreated naming this address
  firstSeenAt: BigInt               # that event's block timestamp
  orders: [Order!]! @derivedFrom(field: "merchant")
  settlements: [Settlement!]! @derivedFrom(field: "merchant")
}

# ---- §4.13 Payer — PROPOSED rollup, symmetric to Merchant (§4.13) ----
type Payer @entity(immutable: true) {
  id: Bytes!                        # the order's bound payer address — always non-zero in UNICA v4 (payer-bound only, EVENT-SCHEMA §6.1)
  firstSeenBlock: BigInt
  firstSeenAt: BigInt
  orders: [Order!]! @derivedFrom(field: "payer")
  settlements: [Settlement!]! @derivedFrom(field: "payer")
}

# ---- §4.14 Order — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §6.1, §10.2) ----
type Order @entity(immutable: false) {
  id: Bytes!                        # orderId (bytes32) — EVENT-SCHEMA §6.1 field 1
  executor: Executor!               # belongs-to (Market reachable via executor.market, never duplicated here)
  merchant: Merchant!               # recipient
  payer: Payer!                     # boundPayer
  recipient: Bytes!                 # immutable-at-creation
  creator: Bytes!
  boundPayer: Bytes!
  amountIn: BigInt!                 # uint128
  minOut: BigInt!                   # uint128
  deadline: BigInt!                 # uint64 — "expired" is never stored (EVENT-SCHEMA §10.2); a caller compares against its own clock
  settled: Boolean!                 # mutable, false until Settled, never reverted back
  settlement: Settlement            # nullable, present only once a Settled names this orderId
  blockNumber: BigInt!              # of OrderCreated
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

# ---- §4.15 Settlement — SPECIFIED-NOT-BUILT, the canonical success record (see §5, §8) ----
type Settlement @entity(immutable: true) {
  id: Bytes!                        # orderId — one Settlement per order, ever (EVENT-SCHEMA §5)
  order: Order!                     # 1:1
  market: Market!                   # denormalized copy of order.executor.market, for one-hop queries — never an independent fact (§4.15)
  hookReceipt: HookReceipt!
  executorReceipt: ExecutorReceipt!
  merchant: Merchant!                # denormalized copy of order.merchant
  payer: Payer!                      # denormalized copy of order.payer
  currencyIn: Bytes!
  currencyOut: Bytes!
  amountIn: BigInt!                  # equal by on-chain construction across both paired events (SC §9.1 steps 3/5)
  amountOut: BigInt!                 # from the receipt, uint128
  amountDelivered: BigInt!           # from Settled, uint256; equal to amountOut by DeliveryNotExact (SC §9.1 step 5)
  hookFeePips: Int!                  # uint24, always 0 in this release
  lpFeePips: Int!                    # uint24
  protocolFeePips: Int!              # uint24
  swapFeePips: Int!                  # uint24
  referencePrice: BigInt!            # uint256, 0 when demonstrationOnly
  referenceDecimals: Int!            # uint8, 0 when demonstrationOnly
  referenceUpdatedAt: BigInt!        # uint64, 0 when demonstrationOnly
  demonstrationOnly: Boolean!
  blockNumber: BigInt!               # the settling transaction's block — §4.0's stated Settlement exception
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

# ---- §4.16 HookReceipt — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §5) ----
type HookReceipt @entity(immutable: true) {
  id: Bytes!                        # transactionHash.concatI32(logIndex) — same id strategy as the BUILT Settlement (T4)
  hook: Hook!                       # the emitter, accepted only when log.address == getMarket(marketId).hook (§2, §5)
  orderId: Bytes!
  recipient: Bytes!
  payer: Bytes!
  marketId: Bytes!
  currencyIn: Bytes!
  currencyOut: Bytes!
  amountIn: BigInt!                 # uint128
  amountOut: BigInt!                # uint128
  hookFeePips: Int!                 # uint24, always 0
  lpFeePips: Int!                   # uint24
  protocolFeePips: Int!             # uint24
  swapFeePips: Int!                 # uint24
  referencePrice: BigInt!           # uint256
  referenceDecimals: Int!           # uint8
  referenceUpdatedAt: BigInt!       # uint64
  demonstrationOnly: Boolean!
  settlement: Settlement            # plain, nullable until the matching Settled is processed
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

# ---- §4.17 ExecutorReceipt — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §6.2) ----
type ExecutorReceipt @entity(immutable: true) {
  id: Bytes!                        # transactionHash.concatI32(logIndex)
  executor: Executor!               # the emitter, accepted only when registry.marketIdOfExecutor(log.address) != 0 (§3)
  orderId: Bytes!
  payer: Bytes!
  recipient: Bytes!
  currencyIn: Bytes!
  currencyOut: Bytes!
  amountIn: BigInt!                 # uint256
  amountDelivered: BigInt!          # uint256
  settlement: Settlement            # plain, nullable until paired
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

# ---- §4.18 LiquiditySeed — SPECIFIED-NOT-BUILT base, PROPOSED enrichment flagged as Pool is (§4.18) ----
type LiquiditySeed @entity(immutable: false) {
  id: Bytes!                        # marketId, reused from Market — at most one honest-path row per market (SC §15 item 6)
  market: Market!                   # 1:1
  depthAtOpeningTick: BigInt!       # uint128, immutable, from MarketSeeded
  tickLower: Int                    # PROPOSED enrichment from the external ModifyLiquidity log — primary record is off-chain (SC §7)
  tickUpper: Int                    # same
  blockNumber: BigInt!              # of MarketSeeded
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

# ---- §4.19-4.21 MarketPause / MarketUnpause / MarketRetirement — one event split three ways (§4.19-4.21) ----
type MarketPause @entity(immutable: true) {
  id: Bytes!                        # transactionHash.concatI32(logIndex) — created only on (from, to) == (4, 5)
  market: Market!
  marketId: Bytes!
  previousStatus: Int!              # always 4 — §4.0's stated uint8 exception
  newStatus: Int!                   # always 5
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

type MarketUnpause @entity(immutable: true) {
  id: Bytes!                        # created only on (from, to) == (5, 4)
  market: Market!
  marketId: Bytes!
  previousStatus: Int!              # always 5
  newStatus: Int!                   # always 4
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

type MarketRetirement @entity(immutable: true) {
  id: Bytes!                        # created only on to == 6 (RETIRED, terminal)
  market: Market!
  marketId: Bytes!
  previousStatus: Int!              # 1, 2, 3, 4 or 5
  newStatus: Int!                   # always 6
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

# ---- §4.22 CapChange — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §4.5; SC §6) ----
# This document uses the task's singular CapChange; EVENT-SCHEMA §10.2 names the equivalent row CapsChange.
type CapChange @entity(immutable: true) {
  id: Bytes!                        # transactionHash.concatI32(logIndex)
  market: Market!
  marketId: Bytes!
  maxPerTx: BigInt!                 # uint128
  maxPerDay: BigInt!                # uint128
  maxSeed: BigInt!                  # uint128, repeats verbatim on a tighten
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

# ---- §4.23 RoleChange — SPECIFIED-NOT-BUILT (EVENT-SCHEMA §4.6; SC §6) ----
# topic0 for all four source events is not yet fixed (EVENT-SCHEMA §12 item 2 / §14 item 1) — kind is named
# by event name only, never by a topic0 value this document does not have.
type RoleChange @entity(immutable: true) {
  id: Bytes!                        # transactionHash.concatI32(logIndex)
  registry: Registry!
  kind: String!                     # "OrderCreatorSet" | "PauserSet" | "AdminTransferStarted" | "AdminTransferred"
  addressA: Bytes!                  # generic slot: creator / previousPauser / currentAdmin / previousAdmin
  addressB: Bytes                   # generic slot: unused for OrderCreatorSet / newPauser / pendingAdmin / newAdmin
  allowed: Boolean                  # populated only for OrderCreatorSet; null otherwise
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}

# ---- §4.24 TokenImplementationObservation — PROPOSED ----
type TokenImplementationObservation @entity(immutable: true) {
  id: Bytes!                        # network ++ token address ++ observedAtBlock — PROPOSED composite (§4.24); each row is its own evidentiary observation, never an overwrite
  asset: Asset                      # belongs-to Asset OR PayoutAsset, whichever role the token plays — §4.11's open question about a token playing both roles applies identically, not solved twice
  payoutAsset: PayoutAsset
  observedAtBlock: BigInt!
  implementation: Bytes             # the implementation slot's contents, when read
  mechanism: String!                # "EVENT" | "POLLING" — which of §4.24's two mechanisms produced this row
}

# ---- §4.25 DeploymentManifest — PROPOSED, the one entity whose honest provenance is "not the chain" (§4.25) ----
type DeploymentManifest @entity(immutable: false) {
  id: Bytes!                        # network ++ registry address
  protocolRelease: ProtocolRelease!
  registry: Registry!
  factory: Bytes!
  hookCreationCodeHash: Bytes!
  startBlock: BigInt!
  releaseTag: String!
  evidenceStatus: EvidenceStatus    # plain, nullable — set once an EvidenceStatus row (§4.26) exists for this deployment
}

# ---- §4.26 EvidenceStatus — PROPOSED ----
type EvidenceStatus @entity(immutable: false) {
  id: Bytes!                        # network ++ registry address, matching DeploymentManifest — singleton per deployment
  deploymentManifest: DeploymentManifest!
  anomalyCount: BigInt!             # mutable rollup
  lastAnomalyAt: BigInt
  lastAnomalyKind: String
  anomalies: [Anomaly!]! @derivedFrom(field: "evidenceStatus")
}

# ---- Anomaly — not one of the task's 26 names; EVENT-SCHEMA §10.2's own entity, imported per §4.26 ----
# rather than redesigned, so that EvidenceStatus.anomalies above has a real, buildable target type.
type Anomaly @entity(immutable: true) {
  id: Bytes!                        # transactionHash.concatI32(logIndex)
  evidenceStatus: EvidenceStatus!
  kind: String!
  detail: String!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}
```

## 5. Canonical receipt authentication — the central piece

**A correct event signature alone must never confer trust** — EVENT-SCHEMA §2 states this once, and every link
below exists because of it: "Anyone can deploy the same hook source through their own factory and emit a
`SettlementReceipt` with an official `marketId`" (SC §3, DR Lens C #6). The chain that closes that gap has ten
links, each citing the on-chain fact that makes it trustworthy rather than assumed.

| # | Link | What makes it trustworthy | Source |
|---|---|---|---|
| 1 | **Registry** | The indexer is configured, off-chain, with exactly one registry address per chain (`DeploymentManifest`, §4.25) — "the registry named in `deployments/unica-v4/<chainId>.json`." Every later link is checked against *this one address*, never a second candidate. Nothing on-chain names "the" registry for a chain; that binding is a build-time human/CI decision, stated plainly rather than hidden. | SC §3 "Official," EVENT-SCHEMA §9 "MF" |
| 2 | **Release and version** | `marketId = keccak256(abi.encode(block.chainid, address(registry), asset, payout, version, policy.adapter, policy.feedId))` — chain id, registry, and oracle route are cryptographically committed into the id itself, and `register()` recomputes and checks it against the caller's argument, so the id cannot be supplied independently of the route (S8). `latestVersion[asset][payout]` and `liveMarketOf[asset][payout]` (mirrored by `MarketVersion`, §4.5) establish which version, if any, is the live one for a pair. | SC §3, §6; EVENT-SCHEMA §4.1 |
| 3 | **Registered market** | `Market` rows are created *only* by a `MarketProposed` event whose `log.address` equals link 1's registry — the data source is address-pinned (a Graph Node manifest `source.address`, S2), so a log with the right topics from a different address is never even delivered to the handler. `statusOf(id) != None` (SC §3's "Official" test) is then simply "does a `Market` row exist." | SC §3, §6; this document §4.4 |
| 4 | **Factory provenance** | The registry's own `FACTORY` immutable (SC §6) is set once, at registry construction, to `msg.sender` — the factory that deployed it (SC §7: `REGISTRY = new UnicaMarketRegistry(admin_, requireOracle_)` runs inside the factory's constructor). `register`, `recordInitialized`, `recordSeeded` are gated `NotFactory` otherwise (SC §6's access table). The indexer never independently re-derives "which factory" — it inherits this guarantee transitively, because a `MarketProposed` could not have been emitted by `register()` unless the registry's own access check passed. | SC §6, §7 |
| 5 | **Expected hook** | `Market.hook` (a write-once `MarketProposed` field, SC §6: "never rewritten") is the factory's own CREATE2 result against a pinned `HOOK_CREATION_CODE_HASH`, checked to have low 14 bits `0x20C0` *before* any code was deployed (`HookFlagsWrong` otherwise, SC §7 step (c)) — the address is a function of on-chain-enforced code identity, not an arbitrary label. A `SettlementReceipt` is accepted **only** when `log.address == getMarket(marketId).hook` — never on topic-match, flag-match, or `marketId`-match alone. | SC §3, §7; EVENT-SCHEMA §2, §5 |
| 6 | **Expected executor** | `Market.executor` (field 6, likewise write-once) is `CREATE(hook, 1)`, computed inside the *already-authenticated* hook's own constructor (SC §8) — so an executor cannot exist independent of an authenticated hook. `Settled` is accepted only when `registry.marketIdOfExecutor(log.address) != 0`, equivalently `log.address == getMarket(marketId).executor`. | SC §3, §8; EVENT-SCHEMA §3, §6.2 |
| 7 | **Expected PoolManager and pool key** | `Market.poolId` (field 7) is write-once; the hook's own `beforeInitialize` refuses any pool key but the one matching its immutable `POOL_ID` (`NotTheMarketPool`, SC §8.1), and there is deliberately **no per-swap `POOL_ID` check inside `beforeSwap`** — "one key is admitted, and the executor rebuilds its key from identical immutables" (SC §8.1). An indexer that also wants to authenticate a raw PoolManager log (the `Pool` divergence, §4.6) must check `marketIdOfPool(poolId) != 0` on the registry before trusting any `Initialize`/`Swap`/`ModifyLiquidity` log's `poolId` topic as UNICA's — PoolManager itself has no concept of "official." | SC §3, §8.1 |
| 8 | **Matching hook and executor events** | A canonical settlement requires a `SettlementReceipt` from link 5's hook **and** a `Settled` from link 6's executor, sharing the same `orderId`, inside the same transaction, with `amountIn` equal across both and `amountDelivered == receipt.amountOut` — enforced on-chain by `pay` itself and re-asserted by the off-chain readback. | EVENT-SCHEMA §5, §6.2, §8 |
| 9 | **Transaction success** | Not a separate check: "Refusals emit nothing... A reverted transaction leaves no log" (EVENT-SCHEMA §2). Either event's mere existence already implies `status == 1` for its transaction; there is no partial or malformed log to distinguish from a clean one. | EVENT-SCHEMA §2 |
| 10 | **Finality threshold** | Not specified by SC or EVENT-SCHEMA for UNICA v4 at all — an **UNKNOWN**, carried to §10. **PROPOSED here**, not sourced as a UNICA requirement: treat a `Settlement` as "awaiting finality" until it is behind Graph Node's own `ETHEREUM_REORG_THRESHOLD` (S9, default 250 blocks) or the chain's own `safe`/`finalized` RPC tag, whichever a given chain's configuration prefers — recorded per network on `DeploymentManifest`/`EvidenceStatus`, never hardcoded once for every chain, since 250 blocks is a general Graph Node default, not a figure this repository has verified per chain. | S9 (default only); §6 below; UNKNOWN in §10 |

**Reading the chain as one sentence:** an entity is canonical only if every link above holds — a registry named
off-chain, a market registered by that registry, a hook and executor both derived from that market by on-chain
construction rather than named freely, both emitting the paired events inside one successful transaction, read
back past whatever finality bar the deployment has chosen. **Anything that breaks any one link is rejected or
labelled, never silently accepted** — the exact rules for each broken link are §7's table.

## 6. Reorg, finality, and reconstructability policy

This section states the *policy* a consuming client should follow; §4.0 already stated the *default facts*
(reorg depth, `_meta`'s shape, the reconstructability test) and every entity in §4 already stated its own
specifics. Nothing here repeats those facts — it only says what to do about them.

- **Never treat "indexed" as "final."** `_meta.block.number` (S6) is the last processed block, not a claim
  about reorg safety. A client showing a `Settlement` at or near the chain head should show it provisionally
  (`QUERIES.graphql` §11's "receipts awaiting finality" query exists for exactly this) and should not, for
  example, mark an order visually "done" in a way indistinguishable from a finalized one.
- **A reorg cannot split one transaction's logs across two blocks — that risk does not exist.** Every entity in
  §4 whose immutability depends on "both writes happen in one transaction" (`Settlement`, §4.15) is safe from a
  reorg concern of the form "what if the receipt and `Settled` end up on different sides of a reorg" — a
  transaction's logs are atomic to the block that includes it; either the whole transaction, with all its logs,
  is on the canonical chain, or none of it is. What a reorg *can* do is remove the entire transaction (both
  events vanish together) or leave it in place — never split it. This is a mechanical fact about how
  blockchains and Graph Node's rollback model both work, stated here because it is easy to worry about a
  scenario that cannot occur.
- **`ETHEREUM_REORG_THRESHOLD` (S9, default 250 blocks) is an indexer-operator setting, not a UNICA guarantee.**
  UNICA has not chosen or verified a finality depth for any chain it targets (46630, 42161 — see
  `docs/unica-v5/graph/NETWORK-OPTIONS.md` for the chain-support question itself). This document's §5 link 10
  proposes deferring to whichever confirmation policy the deployment's own `DeploymentManifest` records, rather
  than asserting one number here.
- **Reconstructability is a per-entity fact, not a subgraph-wide one.** §4's per-entity rows already say YES /
  PARTIAL / NO for every entity; the honest summary is: every SPECIFIED-NOT-BUILT entity sourced directly from
  a UNICA event is YES, once seeded with the registry's address (which is itself always off-chain-supplied, a
  constant caveat repeated rather than hidden); `Pool`/`LiquiditySeed`'s enrichment fields are PARTIAL, tied to
  a design choice this document does not make unilaterally (§4.6, §4.18); `DeploymentManifest` is honestly NO;
  `TokenImplementationObservation` ranges from YES to a narrow NO residual depending on the token's own upgrade
  pattern (§4.24).
- **Non-fatal errors and pruning are Graph Node features this design should use deliberately, not by default.**
  S4 documents `subgraphError: allow` / `_meta.hasIndexingErrors` (non-fatal indexing errors) and notes it "is
  not yet supported... for a subgraph published to The Graph Network" — a live constraint for any deployment
  choice `docs/unica-v5/graph/NETWORK-OPTIONS.md` recommends, not a design constraint for the schema itself.
  `indexerHints: prune` (S2) trades historical-query depth for indexing performance; since this subgraph's
  purpose is evidence and reconciliation history (`QUERIES.graphql` §12), `prune: never` is this document's
  PROPOSED default rather than `auto`, so a merchant's full settlement history is always queryable — recorded
  as a recommendation, not a decided configuration.

## 7. Rejection and labelling rules for adversarial and edge-case events

Two different responses appear below, and the table says which applies each time: **rejected** (the log is
never turned into an entity at all, or an existing entity is never created from it) or **labelled** (the log is
indexed, but flagged — a real, indexed fact the reader must not mistake for something it is not). Confusing the
two is itself a failure mode this table exists to prevent.

| Condition | What the indexer sees | Response | Why (source) |
|---|---|---|---|
| **Look-alike hook** | A `SettlementReceipt`-shaped log from an address the trusted registry does not name for that `marketId` (SC §3, DR Lens C #6) | **Rejected, structurally.** If `Hook` data sources are instantiated only via `Template.create` from an authenticated `MarketProposed`'s own `hook` field (§4.7, S2), a look-alike hook's address was never watched in the first place — no data source, no delivered log, nothing to reject at runtime because nothing arrives. If a design instead uses an address-unfiltered listener, the runtime check is `log.address == getMarket(marketId).hook`, else discard. Either way: no `HookReceipt`, no `Settlement`. | EVENT-SCHEMA §2, §10.2 (EV8); SC §3 |
| **Events from an attacker factory** | A `MarketProposed`-shaped log from a registry address that is not link 1 of §5 | **Rejected, structurally**, for the identical reason: this subgraph's data source(s) watch only the one registry named by `DeploymentManifest` (§4.25). A second registry, however plausible-looking, is simply never a configured address. This is also why §11 records "which registry address(es) does a deployment trust" as an owner decision, never something a client or user can add at runtime. | SC §3; this document §5 link 1 |
| **Unknown executor** | A `Settled`-shaped log from an address that is not `getMarket(marketId).executor` | **Rejected**, same structural-or-runtime pattern as look-alike hooks, applied to `Executor` (§4.8). `registry.marketIdOfExecutor(log.address) != 0` is the runtime form if an unfiltered listener is used. | EVENT-SCHEMA §3; SC §3 |
| **Retired release / market** | A `SettlementReceipt` or `Settled` timestamped after that market's own `MarketRetirement` (§4.21) | **Labelled as an `Anomaly`, never silently accepted.** On the honest path this cannot occur: `pay` and `createOrder` both require ACTIVE status (`MarketNotActive`), and no transition exists out of RETIRED (SC §5's transition table; RETIRED is terminal). A settlement genuinely dated *before* retirement remains valid evidence forever — "retired records and their history stay readable forever" (SC §3) — and is never itself flagged; only one dated *after* is. | SC §3, §5, §9.1 |
| **Mismatched pool key** | A PoolManager `Initialize`/`Swap`/`ModifyLiquidity` log whose `poolId` does not resolve via `marketIdOfPool` on the trusted registry (only relevant if the `Pool` divergence of §4.6 is built) | **Rejected from the `Market` relation** (no `Pool.market` link created), but the raw `Pool` row may still exist as an unaffiliated pool on the shared PoolManager — PoolManager itself has no concept of "official," so this is the one condition in this table where the underlying log is legitimately real and simply not UNICA's, not adversarial. | SC §3, §8.1 |
| **A hook receipt with no matching executor settlement** | A `SettlementReceipt` log in a transaction that contains no `Settled` from the same market's executor | **Impossible on the honest path, and labelled as a high-severity `Anomaly` if ever observed.** `SettlementReceipt` is emitted from `afterSwap`, itself only reachable through the executor's own `pay()`, whose remaining steps (delivery, cap accounting, `Settled`) run unconditionally to completion or the *entire transaction* reverts — Solidity's all-or-nothing execution model means a mined, successful transaction containing a `SettlementReceipt` from the official hook necessarily also contains the paired `Settled` unless the deployed contract diverges from its own specification. No `Settlement` row is created either way (§4.15 requires both). | SC §9.1 (steps 4–7); EVENT-SCHEMA §5, §8 |
| **Duplicate order ids** | A second `OrderCreated`-shaped log naming an `orderId` this subgraph already has an `Order` row for | **Impossible on the honest path** — `createOrder` requires the id "unused" (`OrderExists` otherwise, SC §9.1), so a genuine second creation with the same id cannot be mined. If one is nonetheless observed (an indexing bug, a mis-scoped multi-chain deployment sharing entity ids without a chain prefix — see §10 — or a corrupted replay), the mapping must **never overwrite the first-seen `Order`'s creation fields**; it should load the existing entity, leave its immutable-at-creation fields untouched, and record an `Anomaly`. **A related, not-yet-closed concern, inherited rather than newly found:** `orderId`'s own formula — `keccak256(chainId, executor, creator, salt)` (EVENT-SCHEMA §6.1) — does not commit to the order's terms (`recipient`, `amountIn`, `minOut`, `deadline`), the identical structural property `docs/v2/SECURITY-ADVISORY-001.md` (T3) recorded as an open, "neither exploitable today" residual for V1's own `orderId`. On-chain this is closed by `OrderExists` refusing any second creation regardless of terms, so it cannot manifest as two *different* orders sharing an id — but it means an indexer must never accept a client-supplied `orderId` as evidence of specific terms without loading the actual indexed `Order` row and checking its fields, exactly the discipline `docs/v2/SECURITY-ADVISORY-001.md`'s own remedy names ("never fix `pay(orderId)` calldata before the order exists on chain"). | SC §9.1; EVENT-SCHEMA §6.1; T3 |
| **Reverted transactions** | Nothing — there is no log to see | **No action needed; nothing to reject.** "Refusals emit nothing... A reverted transaction leaves no log" (EVENT-SCHEMA §2). This row exists in the table only because the task asks the question explicitly, and the honest answer is that the indexer has no special-case logic here at all: a revert is invisible to it by the chain's own design, not by an indexing choice. | EVENT-SCHEMA §2 |
| **Unfinalized events** | A `Settlement`/`HookReceipt`/`ExecutorReceipt` inside the last `ETHEREUM_REORG_THRESHOLD` blocks (or short of the chain's own `safe`/`finalized` tag) | **Labelled "awaiting finality," never rejected.** This is a real, indexed event that may or may not still be canonical; §6 states the policy, `QUERIES.graphql` §11 is the query that surfaces exactly this set. Labelling, not rejection, is the correct response — treating an unfinalized event as invalid would be as wrong as treating it as settled. | S9; this document §5 link 10, §6 |
| **Reorgs** | An already-indexed block is orphaned | **Handled automatically within the configured threshold** (Graph Node reprocesses the canonical chain's blocks and rolls back the orphaned ones, §4.0's default); **beyond the threshold, "subgraphs might process inconsistent data" (S9) and this design has no automatic detector** — the only remedy offered is `EvidenceStatus`/`_meta.hasIndexingErrors` plus a manual cross-check against the chain's own head, an honest limitation stated rather than concealed. | S9; §6 |
| **Unsupported token implementations** | A rebasing or fee-on-transfer token behind a market's `asset`/`payout` | **Already rejected on-chain, before any log exists**, for the ordinary case: `pay()`'s own snapshot-and-measure checks (`InputNotExact`, `DeliveryNotExact`, SC §9.1 steps 3, 5) refuse a token that does not move exactly the expected amount, so a genuinely incompatible implementation cannot produce a `Settled`/receipt pair at all. **The residual risk this design does watch for** is a token that upgrades *after* a market is created around it — `TokenImplementationObservation` (§4.24) — labelled as a **high alert** on any detected implementation change, matching EVENT-SCHEMA §8's own classification of this condition ("the watcher alerts on it... after a mismatch the pauser pauses the affected markets"); settlements indexed *before* the change remain valid evidence and are never retroactively flagged. | SC §9.1; EVENT-SCHEMA §8 (U7) |

## 8. What the canonical success record requires, and why

**The question, exactly as posed:** does the canonical success record need the executor `Settled` event only, the
hook receipt only, both matched inside one transaction, or both plus independent merchant-balance evidence?

**The answer, from source: both matched inside one transaction — necessary, and, as specified, sufficient.**
Independent merchant-balance evidence is a PROPOSED optional hardening measure, not a gap the specification
leaves open. Each half of that answer is argued separately below, from source, not asserted.

**Why the hook receipt alone is insufficient.** EVENT-SCHEMA §5 names this outright: `SettlementReceipt` is
*"Evidence, not success: the merchant is not yet proven paid."* Mechanically, the receipt is emitted from
`afterSwap`, before `pay()`'s own delivery measurement and cap accounting (SC §9.1 steps 4–6) have completed —
so at the exact moment the receipt is written, the merchant's actual payment has already physically occurred
(the swap has settled inside the PoolManager) but `pay()` has not yet finished checking that the outcome met
every bound it promised. Treating a `HookReceipt` as proof of payment would mean trusting a mid-transaction
checkpoint as if it were the transaction's own conclusion.

**Why `Settled` alone is insufficient, even though it is itself already balance-checked.** SC §9.1 step 5 is
explicit that, before `Settled` is emitted, `pay()` requires *"recipient delta ≥ `minOut` (`RecipientShort`)
and `== out`... the output taken from the pool (`DeliveryNotExact`...)"* — measured by snapshotting the
recipient's payout balance *before* the swap (step 2) and diffing it *after* (step 5). This means a genuine
`Settled` event already carries, by on-chain construction, the very "merchant balance evidence" the fourth
option in the question asks about — it is not a separate thing to go fetch. What `Settled` alone cannot rule
out is a **contract that diverges from this specification** (a bug, or a maliciously modified deployment
claiming to be UNICA v4) — the indexer has no way to independently verify that the bytecode behind an
apparently-authenticated executor really performs the balance check `SPEC-CONTRACTS.md` describes, beyond the
authentication chain of §5 (which confirms *which* address is trusted, not *what its code actually does*
beyond the pinned `HOOK_CREATION_CODE_HASH` comparison SC §7/§12 already perform for the hook — the executor's
own creation code is not independently hash-pinned anywhere in `SPEC-CONTRACTS.md`, an asymmetry recorded as an
open question in §10). Requiring the paired `HookReceipt` alongside `Settled` is a free, no-extra-oracle
consistency check against exactly that risk: §7's "hook receipt with no matching executor settlement" row
already showed that the two can only exist together on the honest path, so requiring both is a redundant,
low-cost tripwire against a contract that does not behave as specified, not merely a formality.

**Why "both, matched inside one transaction" is sufficient as specified, without also requiring an independent
Transfer-log balance re-check.** The on-chain check described above (SC §9.1 step 5) already performs the
balance measurement the fourth option would otherwise ask the indexer to redo by parsing the payout token's own
`Transfer(PoolManager, recipient, amount)` log (named separately in EVENT-SCHEMA §8's "Log set per transaction"
table for `pay`) and asserting `amount == Settled.amountDelivered`. Doing so would not surface any fact `pay()`
has not already required to be true before `Settled` could exist — it would only re-derive, from a second log,
a conclusion the first log's very existence already guarantees, given trust in the pinned contract code.

**What this document actually recommends, stated as a recommendation and not folded into the "requirement"
above:** a v5 implementation with a higher paranoia budget than this specification assumes may still choose to
add the `Transfer`-log cross-check as defense-in-depth against exactly the one risk the paragraph above
identifies — an executor that passes §5's address-authentication chain but runs code that does not actually
match `SPEC-CONTRACTS.md` (for example, because the executor's creation code, unlike the hook's, has no pinned
hash comparison anywhere in the specification, §10). This document proposes it as an optional `Anomaly` kind
("delivered-amount mismatch against the payout Transfer log") rather than a new required field on `Settlement`,
so that adopting it costs nothing when it agrees (the overwhelming majority of cases, if the deployed contract
matches spec) and produces a loud, specific signal on the rare case it does not.

**Summary answer:** `Settlement` (§4.15) — the paired `HookReceipt` + `ExecutorReceipt` inside one transaction —
is this document's canonical success record, exactly as `EVENT-SCHEMA.md` §5's own reading rule already implies
("one transaction holds both, so a receipt without `Settled` cannot survive") and as SC §9.1's own on-chain
enforcement makes true independent of anything the indexer does. No stronger record is specified; the one
optional strengthening this document names (the `Transfer`-log cross-check) is recorded as a recommendation for
the owner to accept or decline, not as part of the schema's required shape.

## 9. Versioning and migration

**UNICA v4 events carry no `schemaVersion` field at all** (SC §11, EVENT-SCHEMA §12) — unlike the BUILT V1/V3
receipt, which does (`schemaVersion: Int!`, T4), a v4 event is identified by "the manifest's registry address
and the topic0" (EVENT-SCHEMA §12). This document's versioning policy follows directly from that fact rather
than inventing a parallel one:

- **A new event signature is a new handler, never a rewritten one.** "Any change to name, types, order or
  `indexed` is a new signature; the old stays decodable, and an indexer adds a handler without touching old
  entities" (EVENT-SCHEMA §12) — this document's own reused pattern from T4's mapping.ts ("a later schema
  version gets its own handler; version 1 fields are never reinterpreted") generalizes directly: a future v4.1
  receipt shape gets its own entity type and handler, side by side with `HookReceipt`, never a mutated version
  of it.
- **A new release is new infrastructure, not a schema migration.** SC §12: a changed hook or executor "ships as
  a new factory, release and manifest (U4)... existing markets keep their shapes, and retired history stays
  readable." In this document's terms: a new `ProtocolRelease` (§4.1) and `DeploymentManifest` (§4.25) row, new
  `Hook`/`Executor` template addresses, but the *same* `Market`/`Order`/`Settlement` entity **types** — no
  entity type is redefined when a new release ships, only new rows of the same shape, scoped under the new
  release's registry.
- **The existing V1/V3 subgraph is never touched by any of this.** EVENT-SCHEMA §10.2 already decides the v4
  subgraph's location: `integrations/graph/unica-v4/`, "apart from the existing `integrations/graph/` subgraph
  for the schema v1 receipt, which is neither changed nor replaced." This document's entity catalogue (§4) is a
  design for that *separate* v4 subgraph, not a proposed migration of the BUILT V1/V3 one — the two remain
  independent deployments, exactly as the frozen-generation rule requires ("Frozen-generation events are never
  re-emitted and their documentation is never edited," EVENT-SCHEMA §12).
- **Grafting (S4) is a development convenience, not a migration strategy across incompatible shapes.** The
  Graph's own documentation warns against using it "when initially upgrading to The Graph Network," and
  requires the grafted subgraph's schema to stay "compatible" with its base (only additions/removals of types
  and nullability changes, S4) — a genuine entity-shape change (a new field on `Market`, say) is exactly the
  kind of change grafting is not meant to carry across, and this document does not propose relying on it for
  anything beyond speeding up a redeploy during development.
- **A future multi-chain deployment needs an id migration first, not after.** §4.10–4.11's forward-compatibility
  note applies to every entity in this catalogue: none of the ids designed here (`marketId`, `orderId`, a token
  address) are chain-prefixed, because the v4 beta plan is single-chain (`SPEC-CONTRACTS.md` §1.2). Before any
  UNICA v5 deployment indexes more than one chain in one subgraph instance, every id in §4 that is a bare
  address or a bare on-chain hash needs a `network ++` (or `chainId ++`) prefix, matching the pattern
  `integrations/graph-v2`'s `Deployment` entity already uses (T5) — recorded here as a precondition, not
  performed now, since doing it prematurely would only add composite-key overhead to a single-chain beta with
  no present need for it.

## 10. Open questions and unknowns

An honest list, not emptied for appearances:

1. The Graph's support for Robinhood Chain Testnet (46630) is **UNKNOWN** (EVENT-SCHEMA §10.1: "not probed")
   and is not independently re-verified in this document — that verification belongs to
   `docs/unica-v5/graph/NETWORK-OPTIONS.md`. This document assumes, for schema-design purposes only, that some
   network exists on which a standard subgraph can be deployed.
2. Arc testnet's chain id, and whether The Graph supports it at all, is not addressed in this document —
   likewise deferred to `NETWORK-OPTIONS.md`.
3. **No UNICA v4 contract exists**, so every topic0 this document would need to pin an event-handler
   `eventHandlers` entry to is, by EVENT-SCHEMA's own admission, "computed at implementation" (§14 item 1) —
   not yet a real value. Every SPECIFIED-NOT-BUILT entity's eventual manifest entry depends on a value this
   document cannot supply.
4. Whether the executor's own creation code is ever hash-pinned the way the hook's `HOOK_CREATION_CODE_HASH`
   is (SC §7, §12) is **UNKNOWN** from the sources read for this document — §8 names this asymmetry as the one
   residual reason a paired-receipt check adds real value beyond address-authentication alone, but does not
   resolve whether the specification intends to close it.
5. Whether any UNICA-accepted token's proxy or beacon actually emits an `Upgraded`-shaped event is **UNKNOWN**
   — not established in `SPEC-CONTRACTS.md` or `EVENT-SCHEMA.md`, and `TokenImplementationObservation`'s
   reconstructability (§4.24) depends on the answer per token.
6. The exact manifest YAML shape for a Graph Node `blockHandlers` polling filter (used by
   `TokenImplementationObservation` and `DeploymentManifest`'s seeding options) was retrieved via a
   search-engine summary rather than a direct documentation-page fetch in this pass (source row S11, §0) — it
   should be re-verified against the manifest documentation page directly before being relied on literally.
7. Whether The Graph Network's decentralized indexers now support non-fatal-error mode (`subgraphError:
   allow`) is unresolved beyond S4's own "not yet" wording, with no date attached — current status as of
   2026-09-11 is **UNKNOWN** beyond that.
8. No official Graph Node documentation page found in this pass (S7, S8, both checked and empty on this
   specific topic) states an explicit reorg-rollback mechanism or a recommended confirmation-depth policy
   beyond the `ETHEREUM_REORG_THRESHOLD` operator-configuration default (S9). Whether a more current, more
   specific statement exists elsewhere in The Graph's documentation is **UNKNOWN** from this pass's research
   budget, not asserted absent.
9. Whether UNICA v5 will adopt the `Pool`/`LiquiditySeed` PoolManager-indexing divergence this document
   describes as an alternative (§4.6, §4.18), reversing EVENT-SCHEMA §10.2's existing "not indexed" decision,
   is an owner decision not yet made (carried to §11).
10. Whether the same token address can legitimately serve as an `Asset` in one market and a `PayoutAsset` in
    another (§4.11) is architecturally possible per `SPEC-CONTRACTS.md` but has no existing UI or query
    convention to resolve it cleanly — open.
11. The confirmation depth or finality policy UNICA itself wants to require before showing a `Settlement` as
    final (§5 link 10, §6) has not been decided by the owner and is not fixed by any source found in this
    pass — this document's default (`ETHEREUM_REORG_THRESHOLD` or the chain's own `safe`/`finalized` tag) is a
    proposal, not a settled figure.
12. Whether any ETHGlobal or Graph-sponsor prize category applies to this design work, and whether an
    identifiable Graph team member has confirmed it in writing, is explicitly **out of scope for this document**
    (see `docs/unica-v5/graph/PRIZE-FIT.md` and `docs/unica-v5/graph/MENTOR-QUESTIONS.md`) — recorded here only
    so this document is not read as having silently answered it.
13. Whether `specVersion: 1.0.0` (the version the BUILT V1/V3 manifest already uses, T4) remains The Graph's
    current recommendation as of 2026-09-11, or whether a newer `specVersion` with additional manifest features
    has since become the default recommendation, was not independently checked against a manifest
    version-history page in this pass — **UNKNOWN**.

## 11. Owner decisions required

Every item below is a fork this document deliberately does not resolve on its own authority:

1. **Which registry address(es) a given chain's deployment trusts** (§5 link 1, §7) — must be a recorded,
   reviewed decision in `DeploymentManifest`, never inferred from a log or accepted from a runtime input.
2. **Whether to build the `Pool`/`LiquiditySeed` PoolManager-indexing divergence** (§4.6, §4.18) or keep to
   EVENT-SCHEMA §10.2's existing "not indexed" plan, leaving live pool mechanics to RPC/StateView.
3. **Whether to adopt the optional `Transfer`-log balance cross-check** (§8) as a required `Anomaly`-producing
   check, or leave the canonical record at the paired receipt/`Settled` match this document treats as
   sufficient per specification.
4. **Which finality/confirmation-depth policy to require** before labelling a `Settlement` final (§5 link 10,
   §6) — this document's `ETHEREUM_REORG_THRESHOLD`-or-`safe`/`finalized`-tag proposal is a default, not a
   ruling.
5. **Whether `TokenImplementationObservation`** (§4.24) is worth building for a beta whose tokens are stated
   throughout the source material to have "no real-world value," or should be deferred until a real-value
   token is ever accepted.
6. **`indexerHints: prune` — `never` (this document's proposal, §6) or `auto`** — a storage/performance versus
   full-history-depth trade-off for the owner, not a technical necessity either way.
7. **Whether and when to perform the chain-scoped id migration** (§9) — before UNICA v5 ever indexes a second
   chain in one deployment, not after.
8. **Whether `Factory` is modelled as its own entity or folded into `Registry`/`ProtocolRelease`** (§4.3) — a
   judgment call with no strong source pointing either way, since the factory itself emits no events either
   way.
9. **Whether to claim, or seek written confirmation of, any ETHGlobal/Graph-sponsor prize category** for this
   design work — explicitly deferred to `docs/unica-v5/graph/PRIZE-FIT.md` and
   `docs/unica-v5/graph/MENTOR-QUESTIONS.md`; never decided in this document.

## Appendix A — entity relationship sketch

```mermaid
graph TD
  DeploymentManifest --> ProtocolRelease
  DeploymentManifest --> Registry
  DeploymentManifest --> EvidenceStatus
  ProtocolRelease --> Registry
  Registry --> Market
  Registry --> RoleChange
  Market --> MarketVersion
  Market --> Hook
  Market --> Executor
  Market --> Asset
  Market --> PayoutAsset
  Market --> OraclePolicy
  Market --> CapChange
  Market --> MarketPause
  Market --> MarketUnpause
  Market --> MarketRetirement
  Market --> LiquiditySeed
  Market -.optional divergence, §4.6.-> Pool
  Hook --> HookReceipt
  Executor --> Order
  Executor --> ExecutorReceipt
  Order --> Merchant
  Order --> Payer
  Order --> Settlement
  HookReceipt --> Settlement
  ExecutorReceipt --> Settlement
  Settlement --> Merchant
  Settlement --> Payer
  Asset -.observed via.-> TokenImplementationObservation
  PayoutAsset -.observed via.-> TokenImplementationObservation
  EvidenceStatus --> Anomaly
```

Reading the diagram: every arrow is a "belongs-to" / "has-many" pair already stated with its citation in §4; the
dotted edges mark the two places this document names a divergence from EVENT-SCHEMA §10.2's existing plan
(`Pool`) or a PROPOSED entity with no dedicated source event (`TokenImplementationObservation`). `Anomaly` is
EVENT-SCHEMA §10.2's own entity, imported rather than redesigned (§4.26).

## Appendix B — id strategy quick reference

| Entity | Id | Kind of id |
|---|---|---|
| `ProtocolRelease` | factory address | on-chain address |
| `Registry` | registry address | on-chain address |
| `Factory` (if built, §4.3) | factory address | on-chain address |
| `Market` | `marketId` (`bytes32`) | on-chain hash, EVENT-SCHEMA §4.1 field 1 |
| `MarketVersion` | `keccak256(registry, asset, payout)` | PROPOSED composite over on-chain values |
| `Pool` | `poolId` (`bytes32`) | on-chain hash (Uniswap v4 `PoolId`) |
| `Hook` | hook address | on-chain CREATE2 address |
| `Executor` | executor address | on-chain `CREATE(hook, 1)` address |
| `OraclePolicy` | `transactionHash.concatI32(logIndex)` | log-keyed |
| `Asset` / `PayoutAsset` | token address | on-chain address (single-chain scope; §9 flags the multi-chain migration) |
| `Merchant` / `Payer` | address | on-chain address |
| `Order` | `orderId` (`bytes32`) | on-chain hash, EVENT-SCHEMA §6.1 field 1 |
| `Settlement` | `orderId` (`bytes32`) | reused from `Order`, by design (§4.15) |
| `HookReceipt` / `ExecutorReceipt` | `transactionHash.concatI32(logIndex)` | log-keyed, same pattern as BUILT `Settlement` (T4) |
| `LiquiditySeed` | `marketId` (`bytes32`) | reused from `Market`, at-most-one per market (§4.18) |
| `MarketPause` / `MarketUnpause` / `MarketRetirement` | `transactionHash.concatI32(logIndex)` | log-keyed |
| `CapChange` / `RoleChange` | `transactionHash.concatI32(logIndex)` | log-keyed |
| `TokenImplementationObservation` | `network ++ token address ++ observedAtBlock` | PROPOSED composite |
| `DeploymentManifest` / `EvidenceStatus` | `network ++ registry address` | PROPOSED composite, off-chain-provenance for `DeploymentManifest` |

`transactionHash.concatI32(logIndex)` is the one id strategy this document did not invent — it is the exact
expression already running in production (T4 `src/mapping.ts`: `event.transaction.hash.concatI32(event.logIndex.
toI32())`), reused everywhere a log-keyed id is called for rather than redesigned per entity.
