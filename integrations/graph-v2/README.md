# UNICA V2 — invoice settlement indexer

A **separate namespace** from [`../graph`](../graph), whose manifest and schema are frozen and are
not edited for this. Two subgraphs, two entity types, two sets of guarantees.

**Not deployed.** No Subgraph Studio deployment has been made and none is authorised. The address in
`subgraph.yaml` is the **fork-local** executor from `test/fork` — V2 is not deployed to any public
chain, and `networks.json` is where a real deployment's address and start block would go.

## What is live, what is not, and the one command that proves each

| Claim | State | The command that proves it |
|---|---|---|
| the mapping decodes the frozen receipt correctly | **proven, offline** | `npx graph test` (13 matchstick rows) |
| the manifest, ABI, queries, provider and copilot agree | **proven, offline** | `node integrations/graph-v2/check.mjs` |
| the live client refuses stale, broken and malformed answers | **proven, offline** | `node integrations/graph-v2/provider-test.mjs` |
| the copilot's every rule, boundary and refusal | **proven, offline** | `node integrations/graph-v2/copilot-test.mjs` |
| the subgraph is deployed and answering | **NOT TRUE YET** | `node integrations/graph-v2/live-proof.mjs` — today it prints a SKIP naming the variable that is missing and exits non-zero |
| the V2 executor exists on a public chain | **NOT TRUE YET** | `eth_getCode` on the address in `networks.json` returned `0x` — zero bytes — against live Sepolia on 2026-09-08 |

The last two rows are the whole of what is missing, and both are owner actions:
[`STUDIO-OWNER-ACTION.md`](./STUDIO-OWNER-ACTION.md) is the ordered list.

**What has been observed of the live path without a subgraph.** Pointed at a real https endpoint
that is not a subgraph, `live-proof.mjs` read the chain head from the public Sepolia node
(chain `11155111`, block `11664025`, 2026-09-08), performed a real HTTP round trip, refused the
answer as `HTTP_ERROR` with the server's own body quoted, and exited non-zero. So the transport, the
independent chain-head check and the failure naming are proven against a real network; what is not
yet proven is a successful read, because there is nothing deployed to read from.

## The live provider and the treasury copilot

`provider.mjs` is the only way settlement data reaches the copilot on the live path. That is what
makes The Graph load-bearing here rather than decorative: there is no local file the copilot can
read instead.

- **Every query asks `_meta` in the same request as the rows**, and the freshness verdict is reached
  before a single row is looked at. An index more than 25 blocks behind head is a **refusal**, not a
  warning; `hasIndexingErrors: true` is a refusal; and the head it is compared against comes from an
  **independent RPC**, because a server's own report of its progress cannot establish that it is
  current. That RPC's chain id is checked first, since a staleness margin measured against the wrong
  chain is a number that means nothing and looks fine.
- **Seventeen named failures, no catch-all.** `STALE_INDEX`, `INDEXING_ERRORS`, `PARTIAL_DATA`,
  `MALFORMED_JSON`, `SHAPE_MISMATCH`, `HEAD_WRONG_CHAIN` and the rest each say a different thing to
  whoever is reading, and each is driven by a row in `provider-test.mjs`.
- **No fixture fallback, at all.** `provider.mjs` does not import `samples.mjs`, opens no file, and
  imports nothing from `node:fs`. The suite asserts that structurally — over the source with comment
  lines stripped — as well as behaviourally, by proving every refusal returns no rows and no source.
  `check.mjs` repeats both rows in the gate, because it is the load-bearing claim of the whole
  integration.
- **The key never comes out.** `UNICA_SUBGRAPH_URL` may carry the API key in its path, so every
  printable form goes through a redactor. The suite plants a key-shaped string in the environment,
  in the URL and in a server error body, drives all eleven paths, and asserts it appears in no
  returned object and no rendered line — with a control proving the redactor does not simply blank
  everything.

`copilot.mjs` is the reasoning layer, and **the "AI" is a deterministic analyst, not a model call**.
Every recommendation carries the rule that fired, the exact figures it fired on, and the entity ids
those figures came from, so a reader holding the same subgraph can re-derive it. A recommendation
you cannot re-derive is one you cannot audit, and a merchant deciding what to hold in reserve is
entitled to audit it.

It computes, from live indexed receipts: volume and count **per payout token** (never summed across
tokens — two decimal scales), concentration as the largest single payer's share in basis points,
cadence and the silence since the last receipt, an unusual-amount flag against the merchant's **own**
history by median absolute deviation, and a **bounded** reserve suggestion whose binding constraint
is named. It refuses what it cannot establish: an empty result is `INSUFFICIENT_DATA` and produces no
totals at all, never a confident zero.

There is deliberately **no offline demo command**. `samples.mjs` exists for the suite, stamps every
record `OFFLINE_FIXTURE`, and the copilot refuses a set whose records disagree with the declared
source — so there is no way to produce a screenshot of an offline run that could be mistaken for a
live one. `live-proof.mjs` is the only command that renders a report, and it cannot run without a
real endpoint.

## Configuration

| Variable | Required | What it is |
|---|---|---|
| `UNICA_SUBGRAPH_URL` | yes | the Studio or gateway query URL. May contain `[api-key]` as a placeholder |
| `GRAPH_API_KEY` | only for the gateway | sent as `Authorization: Bearer`, and substituted for `[api-key]` if present |
| `UNICA_HEAD_RPC_URL` | no | the independent head source; defaults to a public Sepolia node. Its **host** is printed, because a proof whose independent source is secret proves nothing; a key-shaped path segment in it is redacted |
| `UNICA_MERCHANT` | no | a recipient address to filter to; without it, every indexed settlement |
| `UNICA_MAX_LAG_BLOCKS` | no | the staleness threshold, default 25 blocks (~5 minutes on Sepolia). A value that is not a whole number is **refused**, not defaulted: `Number("abc")` is NaN and every comparison against NaN is false, so a typo would delete the staleness check rather than widen it |

Neither credential is ever printed, logged or returned — and that includes the head RPC's own key,
which lives in an ordinary path segment where the endpoint redactor does not look. That is a tested
property, not a convention: the suite plants a key-shaped string in each place and asserts it never
comes back out.

## What it indexes

The frozen `v2.0.0-rc1` receipt, `QuoteSettled`, topic `0x1317a113…7b0cbd4`, into two entities:

- **`InvoiceSettlement`** — immutable, one per settlement, every field as emitted.
- **`Deployment`** — one per (network, executor), so two executors, or one executor on two chains,
  never blur together.

The ABI in `abis/` is generated from the compiled artifact, not written by hand, and `check.mjs`
fails if the two ever differ.

## What a row proves, and what an empty result does not

A returned row proves **a matching settlement receipt was indexed**.

An empty result proves nothing on its own. The invoice may be unpaid, unknown to this subgraph,
expired, settled on another deployment, or simply not indexed yet. Answering "was this invoice
paid?" in the negative needs a source of invoices, and a receipt indexer is not one. That is why
`queries.graphql` says so at the top and why no query is named `unpaidInvoices`.

## Identity

```
id = keccak256(network) [32] ++ executor [20] ++ transactionHash [32] ++ logIndex [4]
```

Every component is fixed width, so the concatenation is injective — two distinct settlements cannot
share an id, and no separator is needed. It can also be read back apart, which a hash could not.

The quote digest is deliberately **not** the id. A digest identifies an *invoice*; an invoice is not
an event. Making an event's identity depend on "one settlement per invoice" means a reorg or a
second deployment turns a duplicate into a silent overwrite. It is a field, and it is what
`InvoiceByQuoteDigest` looks up.

## Running it

The tooling is shared with the V1 subgraph rather than installed twice:

```bash
cd integrations/graph-v2
ln -sfn ../graph/node_modules node_modules   # once, if it is missing
npx graph codegen
npx graph test          # the mapping, 13 matchstick rows          (needs node_modules)
node check.mjs          # manifest, ABI, queries, provider, copilot (needs nothing)
node provider-test.mjs  # the live client's failure taxonomy        (needs nothing)
node copilot-test.mjs   # every copilot rule and its boundary       (needs nothing)
node live-proof.mjs     # the live read                    (needs a deployed subgraph)
```

The first four run offline. The fifth is the only one that cannot: with `UNICA_SUBGRAPH_URL` unset
it prints a SKIP naming the variable and **exits non-zero**, so an unconfigured run and a working
one never produce the same exit status. That behaviour is itself a row in `provider-test.mjs`, which
spawns the command and asserts on its exit code.

`check.mjs` runs in `make gate` and needs no `node_modules`; it reports the generated-bindings check
as a **SKIP** when `generated/` is absent, because an absent generator and a passing check must not
look the same.

## What is tested where

| Claim | Where |
|---|---|
| the handler maps every field as emitted | `tests/` — matchstick, 13 rows |
| ids cannot collide across logs, transactions or deployments | `tests/` |
| a replayed log leaves one entity and one count | `tests/` |
| a receipt of another schema version creates nothing | `tests/` |
| the largest representable amounts survive | `tests/` |
| the ABI matches the compiled contract | `check.mjs` |
| the manifest subscribes to the frozen topic | `check.mjs` |
| the manifest names a chain, an address and a start block | `check.mjs` |
| the frozen V1 subgraph is untouched | `check.mjs` |
| every query field exists in the schema | `check.mjs` |
| every query FILTER field exists in the schema | `check.mjs` |
| the provider's fields and the copilot's fields exist in the schema | `check.mjs` |
| `_meta` is asked for before the rows | `check.mjs`, `provider-test.mjs` |
| the live path cannot reach the offline samples | `check.mjs`, `provider-test.mjs` |
| all eighteen named failures are exercised | `check.mjs` (that they are), `provider-test.mjs` (that they work) |
| the API key never appears in any rendered output | `provider-test.mjs` |
| `live-proof.mjs` exits non-zero when unconfigured | `provider-test.mjs`, by spawning it |
| every copilot rule, its boundary and its sabotage row | `copilot-test.mjs` |
| an empty result is insufficient data, never a zero | `copilot-test.mjs` |
| the owner document carries a placeholder and no key | `check.mjs` |
| the head RPC's own credential never reaches the output | `check.mjs` (structurally), `provider-test.mjs` (by spawning it with a planted key) |
| an unparseable staleness threshold is refused, not obeyed | `check.mjs`, `provider-test.mjs` (both `judgeMeta` and the spawned command) |

The fixture in `tests/` is a **captured** receipt: every value was printed by
`test/fork/CaptureReceipt.t.sol` from a real settlement against the pinned Sepolia fork. A subgraph
tested against somebody's idea of a receipt is a subgraph tested against nothing.

A **reverted** settlement is not tested here and cannot be: reverted logs never reach an indexer, so
there is no input to hand a handler. The nearest meaningful boundary is tested instead — an indexer
that has seen nothing holds nothing — and the EVM fact is the guarantee.

## Known gap

The receipt does not carry `merchantConfigHash`. It is inside `quoteDigest`, so a verifier holding
the quote can check it and an indexer alone cannot surface it. See
[`docs/v2/COMPATIBILITY-001.md`](../../docs/v2/COMPATIBILITY-001.md) — no interface was changed to
work around this.
