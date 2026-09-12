# integrations/graph/unica-v4

**Not deployed. Not indexing any chain.** There is no `subgraph.yaml` in this directory, no
`dataSources`, no Graph Node manifest, no Studio deployment, no query endpoint. `schema.graphql`
and `queries.graphql` here are design artifacts — a trimmed copy of the entity and query shapes
`docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` and `docs/unica-v5/graph/QUERIES.graphql` propose for a
future UNICA v4 subgraph, kept only so `schema.test.mjs` can check the two files stay internally
consistent with each other. Nothing in this repository executes `queries.graphql` against a running
endpoint.

## Where the real local evidence lives

**The local evidence layer is `tools/unica-evidence`** — a plain, dependency-free Node module, not
a Graph Node, not TypeScript/AssemblyScript, and not anything this directory's schema describes as
running. Label it precisely when it comes up: **LOCAL EVENT PROJECTION — NOT A GRAPH NODE.**

It does the one thing this directory's `ReceiptByOrderId` query would do if a subgraph existed —
answer "does this order have a canonical settlement record" — by calling `eth_getLogs` /
`eth_getTransactionReceipt` / `eth_blockNumber` directly against a local RPC endpoint (localhost
only by default: `UNICA_LOCAL_RPC`, itself defaulting to `http://127.0.0.1:8545`) and running the
same ten-link authentication chain `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` §5 specifies, in
plain JavaScript, entirely offline-testable (`tools/unica-evidence/test/`). `receiptByOrderId` in
`tools/unica-evidence/index.mjs` returns the same shape this directory's `ReceiptByOrderId` query
would, from that projection instead of an index.

Nothing about that function is "a subgraph running locally." It is a different thing, honestly
labelled, that happens to answer the same question for the same reason `docs/unica-v5/graph/
ARCHITECTURE.md`'s Layer 1b describes three interchangeable fallback paths (a Studio/Network
subgraph, a Substreams pipeline, or "a bounded RPC event indexer... where neither exists" —
EVENT-SCHEMA.md §10.3) behind one `ChainClients.graph` interface: this is the third path, run
against a local anvil node rather than a deployed chain. It is not the only path any more — the
sibling directory's manifest indexes the live Sepolia deployment — but it is the one that needs no
Studio account, no key and no network, which is why the local loop still runs on it.

## What the sibling subgraph can and cannot do

`integrations/graph/subgraph.yaml` (the sibling, already-BUILT subgraph, one directory up) defines
exactly three `dataSources`, each a static `kind: ethereum` source with a fixed `source.address`
(the v5 market hook, direct settler and product catalogue recorded in
`deployments/unica-v4/11155111.json`, all on Sepolia) and no `templates:` section anywhere in that
manifest. **A subgraph with no dynamic data sources and three pinned addresses can only ever index
logs from those three contracts — it structurally cannot pick up a log from a fourth, unlisted
address, however identical its topics.** That is a real property of that manifest, verified
by reading it, not an inference: EVENT-SCHEMA.md §2's authentication rule ("a consumer accepts... a
`SettlementReceipt` only when `log.address == registry.getMarket(marketId).hook`") is enforced for
that subgraph by address-pinning at the data-source level, before any handler code runs at all — the
same "rejected, structurally" pattern SETTLEMENT-SCHEMA.md §7 describes for a hypothetical v4
subgraph built the same way.

**This repository does not claim that guarantee for anything in this directory**, because nothing
in this directory is deployed. The pinning-based rejection described above is a property of
`integrations/graph`'s own manifest, cited here only to be precise about what it actually proves
(three fixed addresses, never a fourth) rather than overstating it as evidence about a v4 subgraph that
does not exist. Whether a future v4 subgraph is built the same way (pinned data sources) or with
`Template.create` off an authenticated `MarketProposed` (SETTLEMENT-SCHEMA.md §7's other structural
option) is exactly the open design choice that document's §11 records — not decided here, and not
needed here, because `tools/unica-evidence` authenticates every look-alike at the application layer
instead (its own tests include a look-alike-hook fixture that must be REFUSED).

## Files here

- `schema.graphql` — ten of `SETTLEMENT-SCHEMA.md` §4's ~27 proposed entities (its own §4.27
  count), trimmed to what `ReceiptByOrderId` touches, plus `Merchant`/`Payer`/`DeploymentManifest`
  which three of those ten reference directly.
- `queries.graphql` — `ReceiptByOrderId`, copied verbatim from `docs/unica-v5/graph/QUERIES.graphql`
  section 1.
- `schema.test.mjs` — structural checks only (balanced braces in both files, every type a field
  refers to is defined, every field the query selects exists on its type). It does not, and cannot,
  prove a real subgraph built from this schema would compile or index correctly — that would need
  `graph codegen`/`graph build` against an actual Graph Node toolchain, which is run one directory
  up, on the deployable manifest, and never on these two files.
