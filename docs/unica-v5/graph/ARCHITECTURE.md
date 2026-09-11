# UNICA v5 — the Graph evidence layer: architecture

Research draft for owner review. Not committed. Authorizes nothing. UNICA v5 scope; it does not
change or delay the UNICA v4 specification or its merge gate. Retrieval date for every citation is
2026-09-11 unless the cited document states otherwise. This document restates, in one place, the
layered design already specified piecemeal across `SETTLEMENT-SCHEMA.md`, `ENS-NFT-SCHEMA.md`,
`AI-MCP-TOOLS.md`, `X402-EVIDENCE.md`, `NETWORK-OPTIONS.md`, and `SCALABILITY.md`, and maps thirteen
governing rules to the exact point in the design where each is enforced. It introduces no new
entity, tool, or query beyond what those documents already specify.

## 1. The layered design, end to end

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ LAYER 0 — CHAIN (the only source of settlement truth)                         │
│ UnicaMarketRegistry · UnicaMarketFactory · UnicaMarketHook · UnicaMarketExecutor│
│ · the shared Uniswap v4 PoolManager                                            │
│ Emits: MarketProposed, MarketStatusChanged, OraclePolicySet, CapsSet,          │
│ OrderCreated, SettlementReceipt, Settled, RoleChange (12 events, 3 emitters —  │
│ ALL SPECIFIED-NOT-BUILT, EVENT-SCHEMA.md, SPEC-CONTRACTS.md). The frozen V1/V3 │
│ SettlementReceipt (9-field, no market identity) is BUILT and live on Sepolia   │
│ today (integrations/graph/); V2's QuoteSettled is BUILT, compiled, undeployed. │
└───────────────────┬─────────────────────────────────┬─────────────────────────┘
                     │ eth_getLogs / eth_call            │ same logs, replayed by an
                     │ (always live, never lags)         │ indexing pipeline
                     ▼                                    ▼
┌────────────────────────────────┐     ┌──────────────────────────────────────────┐
│ LAYER 1a — DIRECT RPC           │     │ LAYER 1b — INDEX (derived evidence only)  │
│ current state, live view reads  │     │ Per chain: a standard Subgraph (Studio /  │
│ (registry.statusOf, oracle-     │     │ decentralized network) where one exists;  │
│ Condition, remainingToday),      │     │ a Substreams pipeline (Pinax) where one   │
│ transaction confirmation, the    │     │ does not (Robinhood Chain 46630); a       │
│ chain's own safe/finalized tag   │     │ bounded RPC event indexer as the          │
│ ALWAYS AUTHORITATIVE FOR         │     │ no-Graph-product fallback (EVENT-SCHEMA   │
│ VALUE-MOVING DECISIONS           │     │ §10.3). NEVER AUTHORITATIVE — additive-   │
│ (X402-EVIDENCE.md §6)            │     │ only, gated by _meta freshness, zero      │
│                                  │     │ fixture fallback (X402-EVIDENCE.md §7)    │
└───────────────────┬──────────────┘     └───────────────────┬────────────────────┘
                     │                                         │
                     └───────────────────┬─────────────────────┘
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — DETERMINISTIC VALIDATOR  (@unica/evidence-sdk, AI-MCP-TOOLS.md §2–§6) │
│ Pure functions: (inputs, ChainClients) -> EvidenceResult. Runs the ten-link     │
│ receipt-authentication chain (SETTLEMENT-SCHEMA.md §5); classifies every        │
│ outcome into a fixed reason-code catalogue; every fail condition resolves to    │
│ REFUSE or UNKNOWN, never ALLOW. Never reads a decision from a language model.   │
│ Shared byte-for-byte between every consumer below — a rule fixed once here is   │
│ fixed everywhere it is consumed.                                                │
└───────────────────┬─────────────────────────────────┬───────────────────────────┘
                     ▼                                  ▼
      ┌───────────────────────────┐        ┌─────────────────────────────────────┐
      │ LAYER 3a — CLI              │        │ LAYER 3b — MCP SERVER                 │
      │ unica-evidence <tool>       │        │ one MCP tool per SDK function; may sit │
      │ --json for CI; exit code    │        │ on top of The Graph's own official     │
      │ 0=ALLOW 1=REFUSE 2=UNKNOWN, │        │ Subgraph MCP as its data source rather │
      │ never 0 for anything but a  │        │ than duplicating a query gateway UNICA │
      │ clean ALLOW (AI-MCP-TOOLS   │        │ does not need to own                   │
      │ §11)                        │        │ (PEER-PATTERNS.md §3.1, §3.3)          │
      └───────────────────────────┘        └───────────────────┬───────────────────┘
                                                                  ▼
                                            ┌─────────────────────────────────────┐
                                            │ LAYER 4 — CONSUMERS                   │
                                            │ checkout UI (ENS name shown beside an  │
                                            │ independent resolution, never instead  │
                                            │ of one) · an x402 agent flow (evidence  │
                                            │ gate BEFORE any authorization is signed,│
                                            │ X402-EVIDENCE.md §5) · a merchant       │
                                            │ dashboard (reconciliation queries only, │
                                            │ QUERIES.graphql §12) · the judge-facing │
                                            │ demo screen (DEMO-PLAN.md §5 step 8)    │
                                            └─────────────────────────────────────┘
```

## 2. Trust boundaries, drawn explicitly

- **Boundary A — chain vs. everything above it.** Only a mined, successful transaction's own logs
  and storage are truth. A reverted transaction leaves no log to see at all (EVENT-SCHEMA.md §2,
  cited SETTLEMENT-SCHEMA.md §5 link 9); nothing in any layer above manufactures evidence a revert
  did not produce.
- **Boundary B — direct RPC vs. the index.** RPC is always authoritative for value-moving decisions;
  the index is additive-only for history and narrative. A missed or lagging index degrades a
  *feature*, never a *guarantee* (PEER-PATTERNS.md §3.6). This is the exact line drawn between
  `X402-EVIDENCE.md` §6 (market status, hook/executor/pool authenticity, oracle condition, caps
  remaining, order/replay status — all must be live) and §7 (merchant history, reconciliation
  summaries, status timelines — may read an index).
- **Boundary C — the deterministic validator vs. any language model.** A decision is computed by
  validation code; a model may explain a decision but must never produce, override, or infer one
  where the toolkit returned UNKNOWN (AI-MCP-TOOLS.md §10). This is a documented contract of the
  toolkit, not an enforceable guarantee against a misbehaving caller — stated as a residual trust
  boundary rather than hidden (AI-MCP-TOOLS.md §10, §15).
- **Boundary D — UNICA's evidence layer vs. The Graph's own products.** The toolkit may consume the
  official Subgraph MCP or a Studio/Network subgraph as a data source, but the validation logic
  between "what the query returned" and ALLOW/REFUSE/UNKNOWN is UNICA's own — The Graph's own
  AI-tooling documentation states no verification or trust-boundary guidance for an agent consuming
  its data; that gap is exactly what this layer closes (AI-MCP-TOOLS.md §2, citing S3).
- **Boundary E — the identity/art graph vs. the settlement graph.** No foreign key runs from any
  `IdentityNFT`, `Token`, or `MerchantIdentity` row to any `Settlement`/`Order` row. The only
  permitted join is client-side, keyed on the independently-resolved address, never on a token's
  `tokenId` or `currentOwner` (ENS-NFT-SCHEMA.md §4.10).
- **Boundary F — demonstration data vs. real value.** `demonstrationOnly` (true on every 46630
  receipt today) propagates through every layer that touches a `Settlement` row and must be
  displayed, never dropped, at the consumer layer (SETTLEMENT-SCHEMA.md §4.9, §4.15; QUERIES.graphql
  §10).

## 3. The fallback path, per chain

Layer 1b is not one product — it is whichever of three paths a given chain actually supports,
resolved against The Graph's own network registry rather than assumed (NETWORK-OPTIONS.md §4, §7):
a standard Studio/decentralized-network subgraph where `services.subgraphs` is populated (Ethereum
Sepolia, Arc testnet); a Substreams pipeline against a named third-party endpoint where it is not but
Substreams/Firehose is (Robinhood Chain, both networks, via Pinax); or the bounded RPC event indexer
already specified as the no-Graph-product fallback (EVENT-SCHEMA.md §10.3) where neither exists.
Layer 2's validator is written against a plain `ChainClients.graph` interface so any of the three is
a drop-in, and every one of them is gated by the same `_meta`-freshness discipline before its answer
is trusted (AI-MCP-TOOLS.md §3, §5).

## 4. The thirteen rules, restated and mapped to enforcement

1. **The index never authorizes settlement.**
   Enforced at Boundary B. `SETTLEMENT-SCHEMA.md` §1: "No entity here authorizes, creates, or
   settles a payment; every entity is either a decoded log, a value read once through a `view` call
   and cached, or an explicit aggregation over decoded logs." `X402-EVIDENCE.md` §6 lists every check
   that gates an actual payment decision and requires each to be a live RPC read, never an index
   read. `AI-MCP-TOOLS.md` §2: the toolkit returns "a pre-computed decision, not a set of rows to
   reason about," and that decision's inputs are RPC-first by design (§7's per-tool "must be live"
   column).

2. **Contracts never depend on a subgraph.**
   Enforced at Layer 0/Boundary A by construction, not by the indexing design. `EVENT-SCHEMA.md` §2
   (quoted throughout every document in this directory): "Nothing in the settlement path depends on
   an indexer." `pay()` and every other state-changing function revert closed on their own guard
   table regardless of whether any subgraph exists, is synced, or is even deployed — `SETTLEMENT-SCHEMA.md`
   §8's whole argument for why the paired-receipt record is specification-sufficient rests on
   on-chain checks (`SPEC-CONTRACTS.md` §9.1 step 5) that run whether or not an indexer is watching.

3. **A query is not proof unless chain, block, source, and authentication path are explicit.**
   Enforced structurally in the response envelope, `AI-MCP-TOOLS.md` §4: `chain`, `block`,
   `finality`, `evidence_source`, and `query_or_evidence_hash` are mandatory fields, never optional,
   so a caller cannot receive a bare verdict with no way to check it. `PEER-PATTERNS.md` §3.2 adopts
   The Graph's own block-pinned query syntax specifically so a recommendation can be independently
   replayed against the exact block it was computed from.

4. **RPC fallback never passes weaker evidence off as equivalent.**
   Enforced by `evidence_source.class` (`AI-MCP-TOOLS.md` §4: `"rpc-direct" | "graph-network-gateway"
   | "graph-studio" | "bounded-indexer" | "none"`) — every answer names which class of source
   produced it, so a bounded-indexer or direct-RPC answer is never presented indistinguishably from a
   Graph-network answer. `AI-MCP-TOOLS.md` §5's `INDEX_PROVIDER_DISAGREEMENT` and
   `CHAIN_RPC_DISAGREEMENT` codes force `UNKNOWN` rather than silently preferring one disagreeing
   source over another.

5. **Historical receipts stay attached to their original release and market version.**
   Enforced by the id design itself: `marketId` embeds `block.chainid`, the registry address, and
   the market version inside a `keccak256` commitment (`SETTLEMENT-SCHEMA.md` §4.4, §9); a new
   release is new infrastructure — a new `ProtocolRelease` and `DeploymentManifest` row, new
   `Hook`/`Executor` template addresses — never a schema migration, and "retired records and their
   history stay readable forever" (`SPEC-CONTRACTS.md` §3, quoted `SETTLEMENT-SCHEMA.md` §9).

6. **A newer renderer, hook, or token implementation never rewrites historical evidence.**
   Enforced by non-upgradeability by construction on both sibling graphs. Settlement side: a changed
   hook or executor "is new code with a new `HOOK_CREATION_CODE_HASH`, which the deployed factory
   refuses, so it ships as a new factory, release and manifest" (`EVENT-SCHEMA.md` §12,
   `SETTLEMENT-SCHEMA.md` §9). Identity side: `RendererDeployment` is `@entity(immutable: true)`,
   keyed by `(chainId, contractAddress)`, never by a version integer alone — "a renderer version is
   not a mutable field on a shared contract; it is a separate contract deployment" — and `IdentityNFT`
   is immutable once minted, structurally: no field on it exists for a later resolution event to
   target (`ENS-NFT-SCHEMA.md` §4.2, §4.8).

7. **Testnet assets stay visibly no-value.**
   Enforced by the `demonstrationOnly` field, present on `Market` and `Settlement` and propagated to
   every query surface that touches either (`SETTLEMENT-SCHEMA.md` §4.4, §4.15). `QUERIES.graphql`
   §10 fixes a mandatory display rule — "MUST label these rows 'Testnet demonstration — no-value
   tokens' and must never present `market.rateE18` as a market price." `AI-MCP-TOOLS.md` §6's one
   deliberate asymmetry: `MARKET_DEMONSTRATION_ONLY` forces nothing but must always be surfaced,
   never hidden.

8. **Identity art is not proof of address ownership.**
   Enforced at Boundary E, and restated seven separate times in `ENS-NFT-SCHEMA.md` §8 rather than
   once, on purpose: `IdentityMismatch.advisoryOnly` is a schema field, not only prose; no foreign
   key exists from any identity/art entity to any settlement entity; the payment-history join is
   keyed on the independently-resolved address, never the NFT's `tokenId` or `currentOwner`; and the
   `SettlementMerchant` non-entity decision (§7 of `README.md`) exists specifically because a
   subgraph cannot hold the inputs a real accept/refuse verdict needs.

9. **AI decisions are reproducible from structured evidence.**
   Enforced by `query_or_evidence_hash` (`AI-MCP-TOOLS.md` §4): a `keccak256` of the canonical
   `{tool, inputs, chain, block, raw evidence fields}` used to reach `decision`, letting a second
   caller recompute and confirm nobody altered the envelope in transit. `AI-MCP-TOOLS.md` §14
   requires one sabotage row per reason code proving the refusal path fires, and one control row
   proving the ALLOW path holds when the condition is absent — the same discipline
   `integrations/graph-v2/provider-test.mjs` already applies to its own 17 named failures.

10. **UNKNOWN fails closed.**
    Enforced by the reason-code catalogue's own outcome column (`AI-MCP-TOOLS.md` §5, §6): every
    stale-index, disagreement, unsupported-chain, or query-failure condition is fixed to `UNKNOWN`,
    and `AI-MCP-TOOLS.md` §10 states plainly that a caller may never treat `UNKNOWN` or a missing
    field as `ALLOW`. `X402-EVIDENCE.md` §5's flow diagram makes this operational: "if UNKNOWN: stop
    here, or retry with a different configured RPC/Graph endpoint" — never proceed to signing an
    authorization.

11. **No secrets in clients, tool output, logs, or files.**
    Enforced by the MCP server's own configuration convention (`AI-MCP-TOOLS.md` §13): every setting
    is named by environment-variable name only — `UNICA_EVIDENCE_RPC_URL_<CHAINID>`,
    `UNICA_EVIDENCE_GRAPH_API_KEY`, and so on — never a printed key or URL, matching
    `integrations/graph-v2/provider.mjs`'s existing pattern of redacting the API key from every
    printable form (`PEER-PATTERNS.md` §3.1). The response envelope's own `evidence_source` field
    carries an `endpoint_class_only` string, explicitly never a URL or key (`AI-MCP-TOOLS.md` §4).

12. **Query-volume limits are designed into the client.**
    Enforced by `PEER-PATTERNS.md` §3.10's adopted pattern (combine requests; bound collections with
    `first:`; use cursor-style pagination, never large-offset `skip`, per The Graph's own documented
    guidance that large `skip` values "generally perform poorly," `SCALABILITY.md` §4) and by
    `UNICA_EVIDENCE_MAX_LAG_BLOCKS` (`AI-MCP-TOOLS.md` §13) as a designed-in refusal threshold rather
    than an unbounded retry loop. `SCALABILITY.md` §3's aggregation-entity recommendation exists
    specifically so a dashboard need not re-scan and re-paginate raw rows for a number the indexer
    can maintain natively.

13. **Prize requirements never weaken the security model.**
    Enforced by scoping the recommended build to what is buildable today without describing an
    unbuilt contract as live (`PRIZE-FIT.md` §11.4: "a demo that leans on v4 language risks
    describing unbuilt contracts as live... the recommendation to scope to the buildable-today path
    removes this risk entirely rather than managing it") and by `DEMO-PLAN.md` §7's cut lines, which
    exist independent of and prior to any prize consideration: never deploy or broadcast, the MCP
    tool never signs or spends, no v4 contract is described as live, and a demo that cannot fit the
    time cap is cut down rather than rushed past a safety check.

## 5. What this document does not do

It does not authorize a deployment, a Studio account, a subgraph publication, or any spend. It does
not resolve any of the forks recorded in `OPEN-QUESTIONS.md`. It does not claim ETHOnline 2026 prize
eligibility as settled for any track — that determination requires a written answer from an
identifiable Graph team member and is tracked in `MENTOR-QUESTIONS.md`, not here.
