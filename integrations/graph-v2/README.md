# UNICA V2 — invoice settlement indexer

A **separate namespace** from [`../graph`](../graph), whose manifest and schema are frozen and are
not edited for this. Two subgraphs, two entity types, two sets of guarantees.

**Not deployed.** No Subgraph Studio deployment has been made and none is authorised. The address in
`subgraph.yaml` is the **fork-local** executor from `test/fork` — V2 is not deployed to any public
chain, and `networks.json` is where a real deployment's address and start block would go.

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
npx graph test
node check.mjs
```

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
