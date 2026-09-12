# integrations/graph — the deployable UNICA v5 subgraph

This directory is a real, buildable subgraph manifest for the UNICA v5 deployment on **Ethereum
Sepolia (chain 11155111)**. It is **not deployed by anything in this repository**: `graph auth` and
`graph deploy` need a Studio account and a deploy key, which is the owner's step and nobody else's.
What is proven here is everything that can be proven without one — the manifest loads, the types
generate, the three mappings compile to WebAssembly, and each handler turns a planted event into
the row the product actually asks for.

> Sibling: `integrations/graph/unica-v4/` is a **design artifact only** — a trimmed copy of the
> entity shapes `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` proposes, with no manifest and no data
> sources. Do not confuse the two. This directory is the one that gets deployed.

## What it indexes

Three pinned addresses on Sepolia, every one copied from `deployments/unica-v4/11155111.json` and
`config/unica-v4/11155111.env`, and repeated in `networks.json`:

| Data source | Address | From block | Event |
|---|---|---|---|
| `UnicaMarketHook` | `0x2570a593e0D24ede29eC926e0c5a88B427b9A0c0` | 11690161 | `SettlementReceipt` |
| `DirectSettlement` | `0x14a95db5463d27a97DF464001ec65d5DADffC88e` | 11691641 | `DirectReceipt` |
| `ProductCatalog` | `0xEf837110e2A60B4940E57570E5AD05f39d8C398A` | 11691641 | `ProductSold` |

There is no `templates:` section. **A manifest with three pinned addresses and no dynamic data
sources can only ever index logs from those three contracts** — a fourth contract emitting
byte-identical topics is rejected before any handler runs, by the manifest, not by mapping code.

The ABIs in `abis/` are the `abi` array of this repository's own compiled artifacts (`forge build`
→ `out/<Contract>.sol/<Contract>.json`), extracted whole and unedited.

### The two entities, and why they are shaped that way

`schema.graphql` is written to answer the receipt page's two queries — `graphQueryFor` in
`apps/web/assets/storefront.js` — and not one field more than that plus the indexing context.

- **`Settlement`** — one row per settlement receipt, from **either** path: the market hook
  (`kind: "market"`) or the direct settler (`kind: "direct"`). The id is the transaction hash
  concatenated with the log index. `asset`/`amount` are always the **merchant's** side (the swap's
  out leg, or the single asset of a direct settlement), because that is what a receipt is about.
  The four market-only fields (`marketId`, `amountIn`, `currencyIn`, `demonstrationOnly`) are left
  **unset** on a direct settlement rather than zeroed: a zero there would read as an answer about a
  market that settlement never had.
- **`ProductSale`** — one row per `ProductSold`, keyed by the catalogue's own `saleId`, so the same
  buyer buying the same permanent product twice is two rows.

`kind` on `Settlement` is written by the handler from **which data source's log it was**, never
from anything inside the log.

### The V1 and V3 hooks are no longer indexed

This manifest previously carried two older settlement hooks (`0x1120…0ea0c0`, `0x5d6A…d6a0c0`),
whose `SettlementReceipt` had twelve inputs and a `schemaVersion` field; neither their handler nor
their schema survives contact with the v5 receipt, and the live product is v5, so both data
sources were dropped rather than half-ported. `local-e2e.sh`, `verify-hosted.sh` and
`STUDIO-PREFLIGHT.md` in this directory were written against that older manifest and its v1 schema
and have **not** been brought forward; read them as a record of that work, not as instructions for
this one.

## Building it, offline

From this directory. Neither command touches the network or needs a key:

```sh
npm install                # not `npm ci`: the lockfile is deliberately not committed (.gitignore)
npx graph codegen
npx graph build --network sepolia --network-file networks.json
npx graph test             # matchstick; downloads its own binary on first run
```

`graph build --network-file` **rewrites `subgraph.yaml` in place** from `networks.json`, dropping
any comments in it. That is why the addresses are explained here and not there.

`node --test integrations/graph/schema.test.mjs` (part of the root `npm test`, and needing none of
the above installed) holds three things still: every field the receipt page asks for exists on the
entity that serves it, every event signature in the manifest is the one the ABI declares, and every
address and start block matches the recorded deployment.

## Deploying it — the owner's own commands

`graph auth` and `graph deploy` both need a Studio deploy key. **Nothing in this repository runs
them**, and the key never appears in a file here.

First register the slug once at <https://thegraph.com/studio/> (**Create a Subgraph**, named
`unica-v4`), then, from `integrations/graph`:

```sh
npx graph auth
# paste the deploy key at the prompt — passing it on the command line puts it in shell history

npx graph deploy unica-v4 \
  --version-label v0.2.0 \
  --network sepolia \
  --network-file networks.json
```

**Read the flags, not the habit.** This repository pins `@graphprotocol/graph-cli` **0.98.1**, and
that version has **no `--studio` flag on either command** (`npx graph auth --help`,
`npx graph deploy --help`). With no `--node`, both already target Studio:
`dist/command-helpers/node.js` falls back to `https://api.studio.thegraph.com/deploy/`. A command
written with `--studio` fails on this CLI.

### The query URL to put in `UNICA_SUBGRAPH_URL`

Studio prints the endpoint on the subgraph's own page once a version has synced. It has this shape:

```
https://api.studio.thegraph.com/query/<STUDIO_ACCOUNT_ID>/unica-v4/<VERSION_LABEL>
```

The account id is a number only Studio can tell you — do not guess it, copy it from that page.

That URL is what the product reads: `script/anvil/serve.sh` puts `UNICA_SUBGRAPH_URL` into the
config the web app loads as `config.graph.url`, and `apps/web/assets/receipt.js` asks it exactly
one question per receipt. With no URL set, the page asks nothing and reads "Not indexed yet"; an
index that fails to answer reads "The index did not answer", which is a different line from the one
an empty result gets, and only a row that actually came back wears the colour (`graphPanel`,
`apps/web/assets/storefront.js`).
