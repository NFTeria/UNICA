# UNICA v5 — the Graph Evidence Toolkit: TypeScript SDK, CLI, and MCP server

Draft for owner review. Nothing here is committed, deployed, or published; it authorizes no
account, no infrastructure spend, and no subgraph deployment. This document designs an evidence
toolkit — a TypeScript SDK, a CLI, and an MCP (Model Context Protocol) server — that lets an
autonomous agent or a developer tool ask deterministic questions about UNICA v4 state and receive
an auditable answer. It is **not** a chatbot: every decision is computed by validation code, never
by a language model, and every response carries the evidence a caller needs to check the decision
independently.

Track: this is UNICA's **from-scratch** entry (owner ruling, 2026-09-11; confirmed again against
the published prize page, §0). Earlier drafts said "Continuity"; that was wrong and is not repeated
here. No sponsor-channel transcript was supplied for this work; nothing below is attributed to a
peer discussion, and every claim is either cited to a source in §0 or labelled PROPOSED / UNKNOWN.
**UNICA v4 contracts do not exist yet.** Every event and view function this toolkit reads is
**SPECIFIED-NOT-BUILT**, cited to `docs/unica-v4/EVENT-SCHEMA.md` (cited EV §n) or
`docs/unica-v4/SPEC-CONTRACTS.md` (cited SC §n), and this file never presents one as live. Where a
tool has a narrower, real analogue against the deployed V1/V3 hooks and the live `integrations/graph`
subgraph, §7's preamble says so and labels it BUILT.

## 0. Sources and their status

| # | Source | URL | Retrieved | Author / org | Kind | Used for | Conflict |
|---|---|---|---|---|---|---|---|
| S1 | ETHOnline 2026 prize page | https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 | ETHGlobal | OFFICIAL | The three Graph bounty tracks, their exact requirements, the Start Fresh / Continuity pool split, and the resource links S2–S6 | none |
| S2 | Subgraph MCP introduction | https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/ | 2026-09-11 | The Graph (Edge & Node / GraphOps) | OFFICIAL | The five capabilities of the *official* Subgraph MCP server, which this toolkit is designed to sit beside, not duplicate | The same product is also documented at `.../ai-suite/subgraph-mcp/introduction/` and `.../subgraphs/subgraph-mcp/introduction/`; content agreed where checked, path is unstable across the docs site's own reorganizations |
| S3 | The Graph's AI overview | https://thegraph.com/docs/en/ai-overview/ | 2026-09-11 | The Graph | OFFICIAL | The AI Suite's three components (Subgraph MCP, Agent Skills for Subgraphs, Agent Skills for Substreams) and the explicit absence of stated verification/trust-boundary guidance for agents (§2) | none |
| S4 | GraphQL API reference, `_meta` | https://thegraph.com/docs/en/subgraphs/querying/graphql-api/ | 2026-09-11 | The Graph | OFFICIAL | The exact `_meta` shape (`deployment`, `block{number,hash,timestamp}`, `hasIndexingErrors`) this toolkit's staleness check is built on | none |
| S5 | Subgraph Skills repository | https://github.com/graphprotocol/subgraphs-skills | 2026-09-11 | The Graph (StreamingFast / GraphOps) | OFFICIAL | What "Agent SKILLs" are, so this toolkit is described accurately as a separate, UNICA-specific layer rather than a reimplementation of them | none |
| S6 | Substreams SKILLs repository | https://github.com/streamingfast/substreams-skills | referenced by S1, not independently fetched | StreamingFast | OFFICIAL | Named as the prize's "Featured Challenge" resource; not used for a load-bearing claim here because it was not independently fetched | listed UNREAD in §15 |
| S7 | Supported Networks registry, index | https://thegraph.com/docs/en/supported-networks/ | 2026-09-11 | The Graph | OFFICIAL | Confirms the registry is a single searchable table (not per-chain pages only), and that both "Robinhood Chain" and "Arc" appear in it | none |
| S8 | Supported Networks, Ethereum Sepolia | cited via `integrations/graph/subgraph.yaml` and prior evidence in this repository (`docs/unica-v4/evidence/MAINNET-CAPABILITY-PROBE.md`) | 2026-09-11 | The Graph / this repository | OFFICIAL + TEAM | Sepolia is where the only BUILT subgraph in this repository indexes today | none |
| S9 | Robinhood Chain Mainnet | https://thegraph.com/docs/en/supported-networks/robinhood/ | 2026-09-11 | The Graph | OFFICIAL | Confirms identifier `robinhood`, CAIP-2 `eip155:4663`; confirms this page says nothing about a Robinhood Chain **Testnet** (chain id 46630) | Consistent with `docs/unica-v4/evidence/MAINNET-CAPABILITY-PROBE.md`'s own citation of this same page for chain 4663; 46630 stays UNKNOWN there and here (EV §10.1), not re-derived |
| S10 | Arc Mainnet | https://thegraph.com/docs/en/supported-networks/arc/ | 2026-09-11 | The Graph | OFFICIAL | Chain identifier `arc`, CAIP-2 `eip155:5042`, labelled a mainnet network in this registry | `docs/unica-v4/arc/X402.md` §9, retrieved the same day, found **no** official Circle/Arc document (`docs.arc.io`) naming an Arc mainnet chain ID, and explicitly held it UNKNOWN pending one. This Graph registry page is a different official party (The Graph, not Circle/Arc) stating `eip155:5042` for its own indexing purposes; it does not settle X402.md's stricter bar of an Arc-published source, so this file keeps Arc mainnet chain id UNKNOWN for any UNICA-authored claim, per X402.md, and records the Graph-side fact separately here (§15) |
| S11 | Ethereum execution-apis specification, block tags | https://ethereum.github.io/execution-apis/api/methods/eth_getBlockByNumber/ | 2026-09-11 | Ethereum core devs | OFFICIAL | The `finalized` / `safe` block tags this toolkit's `finality` field is built on (§4); general EVM JSON-RPC behavior, not Graph-specific | Pre-merge or non-Ethereum-consensus chains may not support these tags at all; per-chain support is UNKNOWN unless probed (§15) |
| S12 | `docs/unica-v4/EVENT-SCHEMA.md` | this repository | 2026-09-11 | this repository | TEAM | Every event field, topic, emitter-authentication rule, and lifecycle code the toolkit reads | binds this file; where they disagree, EVENT-SCHEMA wins |
| S13 | `docs/unica-v4/SPEC-CONTRACTS.md` | this repository | 2026-09-11 | this repository | TEAM | Every view function, error name, and guard the toolkit reads or decodes | binds this file |
| S14 | `docs/v2/SECURITY-ADVISORY-001.md` | this repository | 2026-09-08 | this repository | TEAM | The binding failure this toolkit's identity/receipt checks are designed not to repeat | — |
| S15 | `integrations/graph/`, `integrations/graph-v2/` | this repository | 2026-09-11 | this repository | TEAM | The one BUILT subgraph (V1/V3 schema v1 receipts) and the one designed-but-undeployed V2 subgraph; the naming and env-var conventions this toolkit's CLI/MCP layer follows (`UNICA_SUBGRAPH_URL`, `GRAPH_API_KEY`, `UNICA_HEAD_RPC_URL`, `UNICA_MAX_LAG_BLOCKS` — pattern reused, not the same variables) | — |

## 1. Scope and non-scope

**In scope.** The design of a TypeScript SDK, a CLI, and an MCP server that answer the eleven
questions the STREAM instruction names (§7 tool catalogue), each producing the response envelope of
§4, computed by deterministic code. **Not in scope, and not claimed:** any implementation under
`src/`, `tools/`, or `integrations/`; any subgraph deployment for UNICA v4 (blocked, EV §1: Q131 NO
AUTHORIZATION); any account or paid Graph Network usage; a chatbot, a general-purpose blockchain
Q&A assistant, or anything that lets a language model produce the `decision` field itself. This
toolkit is a **consumer** of Graph products (the official Subgraph MCP, a Studio or Network
subgraph, or a bounded self-hosted indexer where Graph coverage is absent) and of direct RPC reads;
it is not a replacement for any of them and does not compete with the official Subgraph MCP's
general-purpose querying — it is a narrow, UNICA-specific decision layer built on top.

## 2. Design principle: an evidence toolkit, not a chatbot

The official Subgraph MCP (S2) exposes five general capabilities — schema access, arbitrary
queries, subgraph discovery, query-volume stats, and natural-language-to-query translation — and
The Graph's own AI-overview documentation (S3) states no verification or trust-boundary guidance
for an agent consuming that data: the product's job ends at returning rows, correctly. UNICA's own
task boundary is different and stricter: **an indexing failure must never create, authorize, or
settle a payment**, and **any UNKNOWN fails closed for value-moving behaviour** (task instructions).
A general MCP server that hands an agent raw GraphQL rows leaves the "is this safe to pay" judgment
entirely to whatever language model is driving the agent — exactly the gap Advisory 001 (S14) shows
is dangerous when a security-relevant decision is made from unvalidated, unbound data.

This toolkit closes that gap for UNICA specifically: every tool call returns a **pre-computed
decision**, not a set of rows to reason about. The tools may be implemented **on top of** the
official Subgraph MCP or a Studio/Network subgraph as their data source (§3), but the validation
logic between "what the query returned" and "ALLOW / REFUSE / UNKNOWN" is UNICA's own deterministic
TypeScript, shared byte-for-byte between the SDK, the CLI, and the MCP server, so a decision made by
one path can be re-derived independently by another.

## 3. Architecture: SDK, CLI, MCP server

```
                    ┌───────────────────────────────────────────┐
                    │      @unica/evidence-sdk (TypeScript)      │
                    │  pure functions: (inputs, ChainClients)    │
                    │  -> EvidenceResult (§4). No side effects.  │
                    │  One function per §7 tool. Shared reason-  │
                    │  code table (§5) and fail-closed rules(§6).│
                    └───────────────┬─────────────┬──────────────┘
                                    │             │
                     ┌──────────────┘             └───────────────┐
                     ▼                                             ▼
        ┌─────────────────────────┐                 ┌─────────────────────────┐
        │  unica-evidence (CLI)   │                 │  unica-evidence-mcp     │
        │  one subcommand per     │                 │  (MCP server, stdio or  │
        │  tool; JSON or table    │                 │  HTTP transport)        │
        │  output; scripts and    │                 │  one MCP tool per SDK   │
        │  CI use this directly   │                 │  function; agent- and   │
        └─────────────────────────┘                 │  IDE-facing (Claude,    │
                                                      │  Cursor, an x402       │
                                                      │  resource server)      │
                                                      └─────────────────────────┘
                     ▲                                             ▲
                     └──────────────────┬──────────────────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    │              ChainClients                │
                    │  RPC (per chain, direct JSON-RPC) ──────┐│
                    │  Graph query client (Studio, Network    ││  every §6 "must be
                    │  Gateway, or the official Subgraph MCP  ││  live" check reads
                    │  as a pass-through) ─────────────────────┤  only the RPC arrow;
                    │  bounded-indexer client (EV §10.3, for   ││  every §7 "may read
                    │  chains The Graph does not cover) ───────┘  the index" check may
                    └───────────────────────────────────────────┘  read either
```

**Why one shared validation layer.** The CLI and the MCP server are both thin: neither contains a
decision rule the SDK does not already export. A rule fixed once in the SDK is fixed everywhere it
is consumed; a rule that drifted between the CLI and the MCP server is exactly the kind of
inconsistency that makes an evidence tool untrustworthy (task instruction: "the decision is computed
by deterministic validation code; the language model may explain a decision but must never produce
one").

**Why the toolkit can sit on top of the official Subgraph MCP rather than always querying a
subgraph directly.** S2's five capabilities (query, schema, discovery, volume, natural-language)
are read primitives; nothing about layering UNICA's own validation logic on top of an MCP tool call
instead of a raw GraphQL fetch changes the query's own freshness or authenticity properties, which
are governed by `_meta` (S4) and by the emitter-authentication rule (EV §2), not by which client
issued the request. Using the official server where it is deployed avoids re-hosting a general
query gateway UNICA does not need to own; the `ChainClients.graph` interface (above) is written
against a plain GraphQL endpoint so either path is a drop-in.

## 4. The response envelope

Every SDK function, CLI subcommand, and MCP tool returns exactly this shape (PROPOSED, this file).
No field is optional in the type; `missing_evidence` and `reason_codes` are empty arrays, never
absent, when there is nothing to report, so a caller distinguishes "checked, nothing wrong" from "not
checked."

```ts
interface EvidenceResult {
  decision: "ALLOW" | "REFUSE" | "UNKNOWN";
  reasons_human: string[];        // plain-language, one string per finding, most severe first
  reason_codes: ReasonCode[];     // §5's catalogue; machine-matchable, never free text
  chain: { caip2: string; name: string };               // e.g. "eip155:11155111", "sepolia"
  block: { number: string; hash: string; timestamp: string } | null; // null only if CHAIN_QUERY_FAILED
  finality: {
    status: "final" | "safe" | "unconfirmed" | "unsupported" | "unknown"; // S11; "unsupported" when
    confirmations: number | null;                                         // the chain's RPC has no
  };                                                                      // finalized/safe tag (§15)
  evidence_source: {
    class: "rpc-direct" | "graph-network-gateway" | "graph-studio" | "bounded-indexer" | "none";
    endpoint_class_only: string;   // e.g. "Graph Network Gateway", never a URL or key (rule: setting
  };                                // names only, never secrets)
  query_or_evidence_hash: string;  // keccak256 of the canonical {tool, inputs, chain, block, raw
                                    // evidence fields} used to reach `decision`; lets a second caller
                                    // re-derive the same answer from the same inputs and confirm it
  contracts: { registry?: string; hook?: string; executor?: string; market_id?: string };
  missing_evidence: string[];      // named gaps that did NOT block the decision (still ALLOW-able)
                                    // vs the ones that DID (those show up as reason_codes instead)
  explorer_links: string[];        // block explorer URLs for the chain in `chain`, plain strings
}
```

**Why a hash, not just the raw evidence.** `query_or_evidence_hash` is not a substitute for the raw
fields (which are still returned per tool, in a `data` field each tool's §7 entry defines) — it is a
commitment a second party can recompute from the same raw fields to confirm nobody altered the
envelope in transit between the deterministic layer and whatever displayed it. PROPOSED; not a
Graph-provided guarantee.

## 5. Reason-code catalogue

Grouped by the check that raises them. Every code maps to exactly one `decision` outcome column
below; a tool may emit several codes, and the envelope's `decision` is the most severe of them
(`REFUSE` > `UNKNOWN` > `ALLOW`-implying/none).

| Code | Meaning | Raised by | Forces |
|---|---|---|---|
| `MARKET_UNKNOWN` | `registry.statusOf(id) == None` (EV §2, SC §5) | `unica_market_status`, `unica_verify_market` | REFUSE |
| `MARKET_NOT_ACTIVE` | status is PROPOSED, INITIALIZED, SEEDED, PAUSED, or RETIRED | same | REFUSE |
| `MARKET_RETIRED` | status is RETIRED — terminal, never reversible (SC §5) | same | REFUSE |
| `MARKET_DEMONSTRATION_ONLY` | `demonstrationOnly == true` (EV §4.1, §5) — informational, testnet, no-value | `unica_market_status`, `unica_reconciliation_summary` | none (ALLOW-compatible, always surfaced) |
| `MARKET_NEWER_VERSION_EXISTS` | `registry.latestVersion(asset,payout) > this market's version` (SC §3) | `unica_market_status` | none (informational; the caller decides whether to redirect) |
| `HOOK_LOOKALIKE` | `registry.marketIdOfHook(candidate) != marketId` (SC §3, "Not official"; EV §2) | `unica_verify_market`, `unica_verify_receipt` | REFUSE |
| `EXECUTOR_LOOKALIKE` | `registry.marketIdOfExecutor(candidate) != marketId` | same | REFUSE |
| `POOL_LOOKALIKE` | `registry.marketIdOfPool(candidate) != marketId` | `unica_verify_market` | REFUSE |
| `HOOK_CODE_HASH_MISMATCH` | the candidate hook's code hash is not `factory.HOOK_CREATION_CODE_HASH()` decoded from its own CREATE2 preimage (SC §7, §12) | `unica_verify_market` | REFUSE |
| `ORDER_UNKNOWN` | `executor.orders(id).status == None` (SC §9.1) | `unica_order_status`, `unica_verify_receipt` | REFUSE |
| `ORDER_NOT_OPEN` | status is Paying or Settled already (SC §9.1) | `unica_order_status` | REFUSE (for a *pay* decision); informational for a status query |
| `ORDER_EXPIRED` | `deadline < now`, computed at query time, never stored (EV §6.1) | `unica_order_status` | REFUSE |
| `ORDER_ALREADY_SETTLED` | status Settled (replay) | `unica_order_status`, `unica_verify_receipt` | REFUSE for a new payment; ALLOW-compatible for "was this paid" |
| `RECEIPT_MISSING` | no `SettlementReceipt` in the named transaction from the market's own hook | `unica_verify_receipt` | REFUSE |
| `RECEIPT_UNPAIRED` | a `SettlementReceipt` exists with no `Settled` in the same transaction (EV §5, "cannot survive") | same | REFUSE |
| `RECEIPT_EMITTER_MISMATCH` | `log.address != registry.getMarket(marketId).hook` (EV §2) | same | REFUSE |
| `RECEIPT_AMOUNT_MISMATCH` | `receipt.amountIn != Settled.amountIn`, or `Settled.amountDelivered != receipt.amountOut` (EV §6.2 pairing rule) | same | REFUSE |
| `ORACLE_DEMONSTRATION_ONLY` | policy disabled; reference fields are zero by design (EV §5) | `unica_verify_receipt`, `unica_market_status` | none (must be surfaced, never hidden) |
| `ORACLE_STALE` | `oracleCondition() == STALE_ORACLE` (SC §8.2) | `unica_market_status`, `unica_explain_payment_refusal` | REFUSE |
| `ORACLE_MARKET_CLOSED` | `oracleCondition() == MARKET_CLOSED` | same | REFUSE |
| `ORACLE_FEED_MISMATCH` | `feedIdFor(...) != policy.feedId`, checked live (SC §8.2 step 2) | same | REFUSE |
| `TOKEN_IMPLEMENTATION_UNEXPECTED` | a proxy/beacon's live implementation slot differs from the pinned value (EV §8, watcher class U7) | `unica_token_implementation_status` | REFUSE |
| `TOKEN_IMPLEMENTATION_UNKNOWN` | the token is not a recognized proxy pattern and no pinned implementation exists to compare against | same | UNKNOWN |
| `INDEX_STALE` | `_meta.block` more than the configured lag threshold behind an independently read chain head (S4; pattern from `integrations/graph-v2/provider.mjs`) | any tool reading the index | UNKNOWN, never silently served |
| `INDEX_HAS_ERRORS` | `_meta.hasIndexingErrors == true` (S4) | same | UNKNOWN |
| `INDEX_PROVIDER_DISAGREEMENT` | two configured Graph endpoints (e.g. Studio and Network Gateway) return different data for the same block | same | UNKNOWN |
| `INDEX_UNSUPPORTED_CHAIN` | the chain has no Graph Network or Studio coverage (S7, S9; EV §10.1, §10.3) | any tool falling back to the bounded indexer | none if the bounded indexer's own report is used instead (labelled, EV §10.3) |
| `INDEX_QUERY_FAILED` | the Graph endpoint returned an HTTP or GraphQL error | same | UNKNOWN |
| `INDEX_PARTIAL_DATA` | the query's own response is missing fields the schema declares required | same | UNKNOWN |
| `CHAIN_UNSUPPORTED` | no configured RPC for the named chain (chain-helper refusal pattern, EV §1) | any RPC-backed tool | UNKNOWN |
| `CHAIN_RPC_DISAGREEMENT` | two configured RPC endpoints for the same chain disagree on head or on a read | same | UNKNOWN |
| `CHAIN_REORG_UNCERTAIN` | the block the evidence was read at is neither `safe` nor `finalized` (S11) and no confirmation depth was configured | any tool | UNKNOWN unless the caller explicitly accepts `unconfirmed` |
| `CHAIN_FINALITY_UNSUPPORTED` | the chain's RPC has no `finalized`/`safe` tag (S11; not all EVM chains implement it) | same | not itself a refusal; `finality.status` records "unsupported" and the caller is told to configure a confirmation-count fallback |
| `CHAIN_QUERY_FAILED` | the RPC call itself errored or timed out | any RPC-backed tool | UNKNOWN, `block: null` |
| `IDENTITY_ENS_UNRESOLVED` | an ENS name given for provenance did not resolve at the queried block | `unica_identity_provenance` | UNKNOWN |
| `IDENTITY_MISMATCH` | the resolved address at the settlement block differs from the receipt's recorded `recipient` | same | REFUSE (for a "does this name still own this payout" claim) |
| `EVIDENCE_INSUFFICIENT` | every check that could run did, and none of them can answer the question asked (e.g. `unica_merchant_history` on a chain with no coverage of any kind) | any tool | UNKNOWN, never a confident negative (mirrors `integrations/graph-v2`'s own rule: "an empty result is INSUFFICIENT_DATA... never a confident zero") |

## 6. Fail-closed conditions

Restated from the fail-closed requirement above, each tied to the mechanism that enforces it:
**stale index** →
`INDEX_STALE`; **provider disagreement** → `INDEX_PROVIDER_DISAGREEMENT` or
`CHAIN_RPC_DISAGREEMENT`; **unknown market** → `MARKET_UNKNOWN`; **paused or retired market** →
`MARKET_NOT_ACTIVE` / `MARKET_RETIRED`; **lookalike hook** → `HOOK_LOOKALIKE` /
`EXECUTOR_LOOKALIKE` / `POOL_LOOKALIKE`; **mismatched receipt events** → `RECEIPT_UNPAIRED` /
`RECEIPT_AMOUNT_MISMATCH`; **unexpected token implementation** →
`TOKEN_IMPLEMENTATION_UNEXPECTED`; **reorg uncertainty** → `CHAIN_REORG_UNCERTAIN`; **unsupported
chain** → `CHAIN_UNSUPPORTED` / `INDEX_UNSUPPORTED_CHAIN`; **missing finality** → folded into
`CHAIN_REORG_UNCERTAIN` when the caller required confirmed evidence and none was available; **query
failure** → `CHAIN_QUERY_FAILED` / `INDEX_QUERY_FAILED`. Every one of these resolves to `REFUSE` or
`UNKNOWN`, never `ALLOW`; §5's table is the single place this is enforced, and §14 requires a
sabotage row per code proving it actually fires.

**The one deliberate asymmetry.** `MARKET_DEMONSTRATION_ONLY` and `MARKET_NEWER_VERSION_EXISTS`
force nothing — they are the toolkit's answer to "was the settlement testnet and no-value" and "is
there a newer market version," which is required as **information**, not
as refusal grounds. A demonstration market is not unsafe; it is unreal, and hiding that label would
be the actual failure (EV §9, "Checkout presentation": "Testnet demonstration — no-value tokens").

## 7. Tool catalogue

**What is BUILT today vs SPECIFIED-NOT-BUILT.** Only `unica_verify_receipt` has a narrower, real
analogue against today's deployed infrastructure: the V1 hook (`0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`,
Sepolia, start block 11639895) and the V3 hook (`0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0`, Sepolia,
start block 11667702), indexed today by the live `integrations/graph` subgraph (`schema.graphql`'s
single `Settlement` entity). That subgraph has **no registry**, so "authenticity" today can only mean
"the log's emitter address is one of the two addresses named in `networks.json`" — a static
allowlist, not the on-chain reverse-lookup EVENT-SCHEMA §2 specifies for UNICA v4. This gap is
exactly why the registry exists in the v4 design: every other tool below depends on
`UnicaMarketRegistry` state (SC §6) that has not been written, deployed, or tested, and is marked
SPECIFIED-NOT-BUILT throughout.

### 7.1 `unica_market_status`

**Answers:** is this a registered UNICA market; is it ACTIVE, PAUSED, or RETIRED; which release and
market version created it; is there a newer version.

| | |
|---|---|
| Input | `{ chainId, marketId }` |
| Live RPC reads | `registry.statusOf(marketId)`, `registry.getMarket(marketId)`, `registry.oraclePolicyOf(marketId)`, `registry.capsOf(marketId)`, `hook.oracleCondition()`, `registry.latestVersion(asset, payout)` (SC §13) |
| Optional index reads | `MarketStatusChanged` history for a timeline display only (EV §9, "IX" column); never used to decide current status ("current state is not history," EV §2) |
| Decision meaning | `ALLOW` = market exists and is ACTIVE; `REFUSE` = `MARKET_UNKNOWN` / `MARKET_NOT_ACTIVE` / `MARKET_RETIRED` |
| Cites | SC §5, §6, §13; EV §4.1–§4.5, §9 |

### 7.2 `unica_verify_market`

**Answers:** is this hook authentic; is this executor authentic; is this pool the one official pool
for this market (the emitter-authentication question, EV §2, SC §3's "Not official, and always
possible" clause).

| | |
|---|---|
| Input | `{ chainId, marketId, candidateHook?, candidateExecutor?, candidatePoolId? }` — any subset; a caller with only an address and no known `marketId` instead calls `registry.marketIdOfHook(candidateHook)` first and treats a zero return as `HOOK_LOOKALIKE` directly |
| Live RPC reads | `registry.marketIdOfHook`, `marketIdOfExecutor`, `marketIdOfPool` (all three, always — SC §3: "a consumer accepts a `SettlementReceipt` only when `log.address == getMarket(marketId).hook`, and `Settled` only from `getMarket(id).executor`"); optionally the hook's own bytecode hash against `factory.HOOK_CREATION_CODE_HASH()` for the deeper `HOOK_CODE_HASH_MISMATCH` check |
| Must be live, never index | Always — EV §2's whole rule exists because "anyone can deploy the same hook source through their own factory and emit a `SettlementReceipt` with an official `marketId`"; only a live reverse lookup against registry storage cannot be fooled by a fabricated log (§6 of this file, and X402-EVIDENCE.md §6) |
| Decision meaning | `ALLOW` = all three reverse lookups agree with `marketId`; `REFUSE` = any one of `HOOK_LOOKALIKE` / `EXECUTOR_LOOKALIKE` / `POOL_LOOKALIKE` / `HOOK_CODE_HASH_MISMATCH` |
| Cites | SC §3 ("Official" / "Not official"), row S1 (proves all three reverse lookups return zero for a look-alike); EV §2 |

### 7.3 `unica_verify_receipt`

**Answers:** has this order already settled; is the receipt finalized; did hook and executor
evidence match (the pairing question, EV §6.2).

| | |
|---|---|
| Input | `{ chainId, transactionHash, orderId? }` |
| Live RPC reads | the transaction receipt and its logs; `registry.getMarket(marketId).hook` and `.executor` to authenticate both emitters (SC §3); block confirmation depth against `finalized`/`safe` (S11) |
| Cross-checks | `receipt.amountIn == Settled.amountIn`; `Settled.amountDelivered == receipt.amountOut`; exactly one receipt and one `Settled`, `Settled` last (EV §6.2, "one transaction holds both, so a receipt without `Settled` cannot survive") |
| Optional index reads | the indexed `Settlement`/`Order` entities (EV §10.2), used only to **cross-check**, never to replace, the direct read — a mismatch between what the index says and what the chain says is `INDEX_PROVIDER_DISAGREEMENT`, and the chain read always wins the `decision` |
| Decision meaning | `ALLOW` = paired, matched, emitted by the market's real hook/executor; `REFUSE` = `RECEIPT_MISSING` / `RECEIPT_UNPAIRED` / `RECEIPT_EMITTER_MISMATCH` / `RECEIPT_AMOUNT_MISMATCH`; `UNKNOWN` = `CHAIN_REORG_UNCERTAIN` if the transaction is not yet at the caller's required confirmation depth |
| BUILT analogue today | against V1/V3: authenticate by static address (`networks.json`) instead of a registry lookup; no `marketId`, no lifecycle, no pairing with a separate lifecycle-aware `Settled` beyond what the frozen executor already emits |
| Cites | EV §5, §6.2, §9; SC §3, §9.1 step 7 |

### 7.4 `unica_order_status`

**Answers:** has this order already settled; what is its current status; is it expired.

| | |
|---|---|
| Input | `{ chainId, executor, orderId }` |
| Live RPC reads | `executor.orders(orderId)` (a `view`, SC §9.1) → `{recipient, creator, payer, amountIn, minOut, deadline, status}`; `expired` is **computed** in the SDK from `deadline` against the read block's timestamp, never stored (EV §6.1) |
| Optional index reads | historical `OrderCreated` for audit display (EV §9, column IX: "Order") |
| Decision meaning | This tool answers a status question, not an authorization question, so its `decision` field is `ALLOW` whenever the read succeeded, regardless of the order's own status; the **status itself** (`Open`/`Paying`/`Settled`/expired) is the payload, and `reason_codes` carries `ORDER_UNKNOWN` / `ORDER_EXPIRED` / `ORDER_ALREADY_SETTLED` as **informational** flags a caller combines with its own intent (e.g. "I wanted to pay this" turns `ORDER_ALREADY_SETTLED` into a refusal upstream) |
| Cites | SC §9.1, §9.3; EV §6.1 |

### 7.5 `unica_merchant_history`

**Answers:** which merchant identity has a recipient address received settlements under before (the
context a reconciliation or anti-fraud check needs; never an authorization signal on its own).

| | |
|---|---|
| Input | `{ chainId, recipient, marketId? }` |
| Index reads | indexed `Settlement`/`Order` entities filtered by `recipient` (EV §10.2); this is the one tool in the catalogue that is index-first by design, because it answers "what happened," which is exactly the class of question EV §2 assigns to events rather than RPC state ("events answer what happened... an indexer never supplies current status") |
| What an empty result means | **Nothing on its own** — mirrors `integrations/graph-v2`'s own documented rule verbatim in spirit: absence proves the merchant has no *indexed* history, never that the merchant has no history, is new, or is untrustworthy. `decision` is `UNKNOWN` with `EVIDENCE_INSUFFICIENT`, never a confident "no history" |
| Decision meaning | Never `REFUSE` by itself; this tool supplies `reason_codes` and `missing_evidence` that `unica_reconciliation_summary` (§7.9) or an agent's own policy may combine with other signals |
| Cites | `integrations/graph-v2/README.md` ("What a row proves, and what an empty result does not"), applied to UNICA v4's own entity design; EV §2, §10.2 |

### 7.6 `unica_identity_provenance`

**Answers:** which merchant identity was bound at settlement time (including an ENS name, where the
checkout resolved one, per `integrations/ensv2/`), and whether that binding still holds.

| | |
|---|---|
| Input | `{ chainId, transactionHash, ensName? }` |
| Live/historical RPC reads | the receipt's recorded `recipient` (an address, never a name — EV §2: "Identity is the token **address**; names and symbols are never stored or trusted" applies equally to merchant identity, by the same principle); if `ensName` is supplied, the resolver's recorded address **at or before the settlement block** (a historical `eth_call` against the resolver at that block number, or the resolver's own `TextChanged`/`AddrChanged` log history) |
| Decision meaning | `ALLOW` = the name resolved to the settlement's `recipient` at that block; `REFUSE` = `IDENTITY_MISMATCH` (the name pointed elsewhere at that block — a real finding, since ENS resolution can change after settlement and a stale display would misattribute a historical payment); `UNKNOWN` = `IDENTITY_ENS_UNRESOLVED` |
| Why this is a **historical**, not live, read | Provenance is a "what was true then" question (EV §2's own distinction); re-deriving it from a past block's state is the correct pattern, not a shortcut, per Q90's doctrine as already applied to indexed history |
| Cites | EV §2; `integrations/ensv2/` (this repository, ENSv2 merchant resolution) |

### 7.7 `unica_token_implementation_status`

**Answers:** was the token implementation the expected one (guards against the beacon/proxy upgrade
risk EV §8 assigns to the watcher's "U7" alert class, and SC §4's threat-model line: "a stock
token's beacon owner, who can upgrade or pause it").

| | |
|---|---|
| Input | `{ chainId, tokenAddress }` |
| Live RPC reads | the EIP-1967 implementation storage slot (or the token's own documented pattern) if the address is a proxy; the pinned implementation address/code hash from the deployment's chain configuration (`config/chains/<chainId>.json` pattern, SC §7, §10) |
| Decision meaning | `ALLOW` = implementation matches the pinned value, or the token is a plain non-proxy contract with a stable code hash; `REFUSE` = `TOKEN_IMPLEMENTATION_UNEXPECTED`; `UNKNOWN` = `TOKEN_IMPLEMENTATION_UNKNOWN` when no pinned value exists to compare against |
| Cites | EV §8 (watcher class U7); SC §4 (A7, A8 threat-model lines) |

### 7.8 `unica_explain_payment_refusal`

**Answers:** why an agent should refuse — decoding a reverted transaction's error into the named
catalogue SC already fixes (§6, §8.3, §9.3), including the PoolManager's own wrapping.

| | |
|---|---|
| Input | `{ chainId, transactionHash }` (a reverted transaction) or `{ chainId, calldata, from }` for a pre-flight `eth_call` simulation |
| Live RPC reads | the transaction's revert data; if it is `WrappedError(hook, selector, reason, details)`, the **inner** selector is decoded against the hook's own catalogue (SC §8.2 step 3: "the PoolManager wraps it as `WrappedError`... tests decode the inner adapter selector") |
| What the LLM may do here specifically | Turn the decoded selector and its named fields into a plain-language sentence ("this order's deadline had passed" for `OrderExpired`); it may **never** decide whether the refusal was correct or invent a reason not present in the decoded selector — the selector-to-name mapping is a fixed lookup table, not inference |
| Explicit non-goal | This tool explains **on-chain** refusals only. An x402-level refusal (`invalid_exact_evm_payload_*`, etc.) happens before UNICA is ever reached and has no on-chain transaction to decode; `X402-EVIDENCE.md` §11 states this boundary |
| Cites | SC §6 (registry errors), §8.3 (hook errors), §9.3 (executor errors), §8.2 step 3 (`WrappedError` unwrap) |

### 7.9 `unica_reconciliation_summary`

**Answers:** did hook and executor evidence match across a set of settlements; is the index's lag
acceptable; how many anomalies exist (EV §10.2, "Anomalies are shown, never dropped... Zero
anomalies is stated, not implied").

| | |
|---|---|
| Input | `{ chainId, marketId? , recipient?, fromBlock, toBlock }` |
| Reads | combines `unica_verify_receipt` over every indexed `Settlement` in range (cross-checked against chain, §7.3), the index's own `Anomaly` entities if the subgraph populates them (EV §10.2), and `_meta` for lag (S4) |
| The stated-negative rule | Mirrors the project's own measurement discipline: this tool always returns a count — "N settlements found, M confirmed against chain, K anomalies, index lag L blocks" — **never** a blank result for zero findings; a blank and a broken reporter must never look identical |
| Decision meaning | `ALLOW` = zero anomalies and index lag under the configured threshold; `UNKNOWN` = `INDEX_STALE` / `INDEX_HAS_ERRORS`; `REFUSE` is not typical output for a summary tool but is emitted if any individual receipt in range fails `unica_verify_receipt`'s own checks |
| Cites | EV §10.2; `integrations/graph-v2/README.md`'s freshness-first query pattern (asks `_meta` in the same request as the rows, judges freshness before looking at a single row) |

## 8. Worked example: a REFUSE result, in full

A caller asks `unica_verify_market` about a hook address seen in an unsolicited link, on Sepolia,
naming a `marketId` that **is** registered — but for a different hook. This is exactly SC §3's row
S1 scenario (a look-alike deployed through a stranger's own factory).

```json
{
  "decision": "REFUSE",
  "reasons_human": [
    "This address is not the official hook for market 0x7a3c…e91f. The registry names a different hook for this market id.",
    "Because the hook does not match, no receipt this address emits can be trusted for this market, regardless of its topics."
  ],
  "reason_codes": ["HOOK_LOOKALIKE"],
  "chain": { "caip2": "eip155:11155111", "name": "sepolia" },
  "block": { "number": "11700432", "hash": "0x4f9e…blockhash", "timestamp": "1799712000" },
  "finality": { "status": "final", "confirmations": 118 },
  "evidence_source": { "class": "rpc-direct", "endpoint_class_only": "public Sepolia JSON-RPC" },
  "query_or_evidence_hash": "0x9b2c…evhash",
  "contracts": {
    "registry": "0xREGISTRY_ADDRESS_FROM_MANIFEST",
    "hook": "0xCANDIDATE_ADDRESS_SUPPLIED_BY_CALLER",
    "market_id": "0x7a3c…e91f"
  },
  "missing_evidence": [],
  "explorer_links": [
    "https://sepolia.etherscan.io/address/0xCANDIDATE_ADDRESS_SUPPLIED_BY_CALLER",
    "https://sepolia.etherscan.io/address/0xREGISTRY_ADDRESS_FROM_MANIFEST"
  ]
}
```

Every value shown as a placeholder (`0xREGISTRY_ADDRESS_FROM_MANIFEST`, block hash, evidence hash)
is exactly that — a placeholder — because no UNICA v4 registry has been deployed. Nothing here is
presented as a live result.

## 9. Worked example: an ALLOW result, in full

`unica_market_status` for a hypothetical ACTIVE, oracle-enabled market, once one exists.

```json
{
  "decision": "ALLOW",
  "reasons_human": [
    "Market 0x7a3c…e91f is ACTIVE.",
    "No newer version of this asset/payout pair is registered.",
    "The oracle policy is enabled; the reference price was read live and is within its configured age and deviation bounds."
  ],
  "reason_codes": [],
  "chain": { "caip2": "eip155:11155111", "name": "sepolia" },
  "block": { "number": "11700900", "hash": "0x11ac…blockhash", "timestamp": "1799715600" },
  "finality": { "status": "final", "confirmations": 130 },
  "evidence_source": { "class": "rpc-direct", "endpoint_class_only": "public Sepolia JSON-RPC" },
  "query_or_evidence_hash": "0x02fe…evhash",
  "contracts": {
    "registry": "0xREGISTRY_ADDRESS_FROM_MANIFEST",
    "hook": "0xHOOK_ADDRESS_FROM_MARKET_RECORD",
    "executor": "0xEXECUTOR_ADDRESS_FROM_MARKET_RECORD",
    "market_id": "0x7a3c…e91f"
  },
  "missing_evidence": ["indexed MarketStatusChanged timeline not queried for this call (status-only request)"],
  "explorer_links": ["https://sepolia.etherscan.io/address/0xHOOK_ADDRESS_FROM_MARKET_RECORD"]
}
```

`ALLOW` never means "safe to pay any amount" — it means "this specific check found nothing to
refuse." An agent composing several tools (§ X402-EVIDENCE.md §5) is responsible for calling every
check its own decision needs; no single tool call is a substitute for the full pre-payment sequence.

## 10. What the language model may and may not do

**May:** turn `reasons_human` and the decoded fields of §7.8 into fluent prose for a human or another
agent; choose which non-authorizing tools to call next based on a `REFUSE`'s reason codes (e.g. call
`unica_explain_payment_refusal` after a `REFUSE` to get a fuller narrative); summarize a
`unica_reconciliation_summary` result.

**May never:** set or override `decision`; treat an `UNKNOWN` or a missing field as `ALLOW`; invent
a `reason_code` not in §5's table; call a tool with fabricated `chain`/`block` values to make a stale
answer look current; present a `demonstrationOnly` or `MARKET_DEMONSTRATION_ONLY` result as a live
payment. **This is a documented contract of the toolkit, not an enforceable guarantee against a
misbehaving caller** — nothing in an MCP tool's JSON response can force the calling model to respect
the `decision` field once it is returned; the toolkit's own responsibility ends at always emitting a
correct, fail-closed envelope. A caller (agent framework) that overrides `decision` is misusing the
tool, and that residual trust boundary is recorded here rather than hidden (§15, unknowns).

## 11. CLI surface

```
unica-evidence market-status   --chain <chainId> --market-id <id>
unica-evidence verify-market   --chain <chainId> --market-id <id> [--hook <addr>] [--executor <addr>] [--pool-id <id>]
unica-evidence verify-receipt  --chain <chainId> --tx <hash> [--order-id <id>]
unica-evidence order-status    --chain <chainId> --executor <addr> --order-id <id>
unica-evidence merchant-history --chain <chainId> --recipient <addr> [--market-id <id>]
unica-evidence identity        --chain <chainId> --tx <hash> [--ens-name <name>]
unica-evidence token-status    --chain <chainId> --token <addr>
unica-evidence explain-refusal --chain <chainId> --tx <hash>
unica-evidence reconcile       --chain <chainId> [--market-id <id>] [--recipient <addr>] --from-block <n> --to-block <n>
```

Every subcommand accepts `--json` (the raw §4 envelope, for scripting and CI) or a default
human-table view; exit code is `0` for `ALLOW`, `1` for `REFUSE`, `2` for `UNKNOWN` — never `0` for
anything but a clean `ALLOW`, so a CI gate that merely checks the exit code fails closed by
construction.

## 12. SDK surface (TypeScript)

```ts
import type { ChainClients, EvidenceResult } from "@unica/evidence-sdk";

export function marketStatus(clients: ChainClients, input: { chainId: number; marketId: `0x${string}` }): Promise<EvidenceResult>;
export function verifyMarket(clients: ChainClients, input: { chainId: number; marketId: `0x${string}`; candidateHook?: `0x${string}`; candidateExecutor?: `0x${string}`; candidatePoolId?: `0x${string}` }): Promise<EvidenceResult>;
export function verifyReceipt(clients: ChainClients, input: { chainId: number; transactionHash: `0x${string}`; orderId?: `0x${string}` }): Promise<EvidenceResult>;
export function orderStatus(clients: ChainClients, input: { chainId: number; executor: `0x${string}`; orderId: `0x${string}` }): Promise<EvidenceResult>;
export function merchantHistory(clients: ChainClients, input: { chainId: number; recipient: `0x${string}`; marketId?: `0x${string}` }): Promise<EvidenceResult>;
export function identityProvenance(clients: ChainClients, input: { chainId: number; transactionHash: `0x${string}`; ensName?: string }): Promise<EvidenceResult>;
export function tokenImplementationStatus(clients: ChainClients, input: { chainId: number; tokenAddress: `0x${string}` }): Promise<EvidenceResult>;
export function explainPaymentRefusal(clients: ChainClients, input: { chainId: number; transactionHash: `0x${string}` }): Promise<EvidenceResult>;
export function reconciliationSummary(clients: ChainClients, input: { chainId: number; marketId?: `0x${string}`; recipient?: `0x${string}`; fromBlock: bigint; toBlock: bigint }): Promise<EvidenceResult>;
```

`ChainClients` is supplied by the caller (no network access baked into the package's own defaults):
`{ rpc: Record<number, RpcClient>, graph?: GraphClient, boundedIndexer?: BoundedIndexerClient }`. No
function throws on a bad answer; every one resolves to an `EvidenceResult` whose `decision` already
carries the failure, per §6 ("any UNKNOWN fails closed" is a return value, not an exception, so a
caller cannot accidentally `catch` past a refusal).

## 13. MCP server surface

One MCP tool per SDK function, named identically to §7's headings
(`unica_market_status`, `unica_verify_market`, …). Configuration is by **environment variable name
only** — no key or URL is ever printed by this toolkit, matching this repository's existing pattern
in `integrations/graph-v2/provider.mjs`:

| Setting name | Purpose |
|---|---|
| `UNICA_EVIDENCE_RPC_URL_<CHAINID>` | the JSON-RPC endpoint for a given chain id, one variable per chain the server is configured for |
| `UNICA_EVIDENCE_GRAPH_URL` | a Studio or Network Gateway query URL, or the official Subgraph MCP endpoint if used as a pass-through (§3) |
| `UNICA_EVIDENCE_GRAPH_API_KEY` | sent as `Authorization: Bearer`, substituted into `[api-key]` where the URL carries a placeholder (pattern from `integrations/graph-v2`) |
| `UNICA_EVIDENCE_MAX_LAG_BLOCKS` | the `INDEX_STALE` threshold; a non-numeric value is refused, not defaulted (same reasoning as `integrations/graph-v2`'s own guard against a silently widened check) |
| `UNICA_EVIDENCE_REQUIRE_FINALITY` | `"final"` \| `"safe"` \| a confirmation-count integer; the default a deployment chooses for `CHAIN_REORG_UNCERTAIN`'s threshold |

The MCP tool descriptions themselves state, in their own text, that `decision` is authoritative and
`reason_codes` are drawn only from §5's fixed table — this is the closest the toolkit can come to
constraining a calling model's behavior (§10's residual-trust caveat still applies).

## 14. Testing and sabotage rows

Following this repository's own discipline (`docs/unica-v4/EVENT-SCHEMA.md` §13, `SPEC-CONTRACTS.md`
§9.3): every reason code in §5 needs one row that proves the ALLOW path when the condition is absent,
and one sabotage row that proves the REFUSE/UNKNOWN path fires when it is planted — for example, a
row that feeds `unica_verify_market` a hook address whose `marketIdOfHook` reverse lookup is
deliberately mocked to disagree, and asserts `decision === "REFUSE"` and
`reason_codes.includes("HOOK_LOOKALIKE")`; a companion control row using the *real* mapping asserts
`ALLOW`. Every fail-closed code in §6 needs a row where the underlying RPC or Graph client is made to
fail (timeout, malformed JSON, a planted disagreement between two configured endpoints) and the
suite asserts the envelope never reports `ALLOW`. This mirrors `integrations/graph-v2`'s own
`provider-test.mjs` pattern (seventeen named failures, one row each) rather than inventing a new
testing philosophy. None of this is implemented; it is the design this toolkit's own test suite
would follow once UNICA v4 exists to test against.

## 15. Open questions and unknowns

- Whether an MCP or AI-refusal tool consuming a **live** subgraph is required for eligibility in
  ETHOnline 2026's "AI Tooling or AI Use Case" tracks, or whether a tool built against direct RPC
  reads plus the *design* of a Graph-backed evidence layer (since UNICA v4 has no deployed contracts
  or subgraph yet) still qualifies — S1 states "consume live data from a Graph provider" as a key
  requirement; this toolkit's only BUILT-compatible tool (§7 preamble) is `unica_verify_receipt`
  against the live V1/V3 subgraph, and every other tool is undeployable until UNICA v4 ships. This
  question is duplicated verbatim in `MENTOR-QUESTIONS.md` Q1 in this directory and is not
  re-answered here without a written reply from an identifiable Graph team member, per the project's
  own rule.
- Whether layering this toolkit on top of the **official** Subgraph MCP (S2) rather than querying a
  UNICA-specific subgraph directly satisfies "Best Use of Composable... Graph Products" (S1's first
  track) — S1's own text ("layer the Subgraph MCP on top for cross-protocol analysis") suggests yes,
  but this is not independently confirmed by a Graph team member; duplicated in
  `MENTOR-QUESTIONS.md` Q2.
- Whether the Ethereum execution-apis `finalized`/`safe` tags (S11) are implemented identically, not
  at all, or under different names by every RPC provider this toolkit would be configured against
  (Sepolia specifically was not individually re-probed for tag support here); until
  probed per-chain, `finality.status: "unsupported"` is the toolkit's honest default rather than an
  assumption either way.
- Whether The Graph's own listing of Arc Mainnet at `eip155:5042` (S10) should be treated as
  sufficient provenance for a UNICA-authored claim about Arc's chain id, given that
  `docs/unica-v4/arc/X402.md` §9 held that value UNKNOWN pending an official Circle/Arc document.
  This file does not resolve that conflict; it keeps X402.md's stricter standard and records the
  Graph-side fact only as a citation, not a settled value (S10's own row).
- The Substreams SKILLs repository (S6) was named by the prize page as the track's "Featured
  Challenge" resource but was not independently fetched for this document; it is listed UNREAD and no
  claim in this file depends on its contents.
- Whether a bounded self-hosted indexer (EV §10.3) or a Substreams/Firehose-based pipeline, for a
  chain The Graph does not cover, would itself count as "a Graph provider" for prize purposes —
  duplicated in `MENTOR-QUESTIONS.md` Q3 and Q4, not re-answered here.
- No implementation of any function in §11–§13 exists; every code sample in this file is a design
  artifact, not a tested surface.

## 16. Owner decisions required

1. Whether to build the SDK/CLI/MCP server as described here at all before UNICA v4 contracts exist,
   given that eight of nine tools are undeployable until then (§7 preamble) — or to scope an initial
   submission to `unica_verify_receipt` against the live V1/V3 subgraph plus this document as the
   forward design for the rest.
2. Whether to seek the written Graph-team answers to the six questions in `MENTOR-QUESTIONS.md`
   before committing to the "Composable or Standardized Graph Products" track (S1) as a second
   submission target, given this toolkit's layering approach in §3.
3. The exact env-var names in §13 are PROPOSED and free to rename before any code is written; nothing
   here is load-bearing until an implementation exists.
