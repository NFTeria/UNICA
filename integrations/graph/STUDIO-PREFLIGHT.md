# STUDIO PREFLIGHT — Subgraph Studio deployment, not yet taken

This file records what was checked before any Subgraph Studio deployment, and the
exact commands the owner runs to take that step. Nothing here performs the deployment:
`graph auth` and `graph deploy` both need a Studio account and a deploy key, which this
session does not have and must never handle. **No hosted subgraph availability is
claimed by this file.** That claim becomes true only after the owner runs the deploy
commands below and `verify-hosted.sh` (same directory) passes against the resulting
query URL.

## The manifest is pinned and must not change

`integrations/graph/subgraph.yaml` and `integrations/graph/networks.json` name one
hook, on one network, from one block:

| Field | Value |
|---|---|
| Network | `sepolia` |
| Hook address | `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` |
| Start block | `11639895` (the hook's deploy block) |

`networks.json:2-7` and `subgraph.yaml:9-13` carry these values verbatim. **This
pairing must not change.** A different address or a different start block is a
different subgraph indexing a different deployment; if the live hook is ever replaced,
that is a new manifest and a new Studio subgraph, never an edit to this one in place.

## Pre-deploy checks — run now, read-only against the committed tree

Every command below was run from `integrations/graph/` against the committed files,
with the pinned toolchain from `package.json` (`@graphprotocol/graph-cli` `0.98.1`,
`@graphprotocol/graph-ts` `0.38.2`, `matchstick-as` `0.6.0`). None of them talks to
Subgraph Studio; `graph build` and `graph test` compile and test entirely locally.

### 1. `npx graph codegen`

```
$ npx graph codegen
...
- Generate types for contract ABIs
  Generate types for contract ABI: V4SettlementHook (abis/V4SettlementHook.json)
  Write types to generated/V4SettlementHook/V4SettlementHook.ts
✔ Generate types for contract ABIs
- Load GraphQL schema from schema.graphql
✔ Load GraphQL schema from schema.graphql
- Generate types for GraphQL schema
  Write types to generated/schema.ts
✔ Generate types for GraphQL schema

Types generated successfully
```

Exit 0. Regenerates `generated/` only (gitignored); nothing tracked changes.

### 2. `npx graph build --network sepolia --network-file networks.json`

```
$ npx graph build --network sepolia --network-file networks.json
- Update sources network
  Reading networks config
  Skip 'V4SettlementHook': No changes to network configuration
✔ Update sources network
...
- Compile subgraph
  Compile data source: V4SettlementHook => build/V4SettlementHook/V4SettlementHook.wasm
✔ Compile subgraph
- Write compiled subgraph to build/
  Write subgraph manifest build/subgraph.yaml
✔ Write compiled subgraph to build/

Build completed: build/subgraph.yaml
```

Exit 0. "Skip … No changes to network configuration" is the CLI itself confirming that
the address and start block already committed in `subgraph.yaml` match
`networks.json` for `sepolia` — there is no substitution to make. Confirmed after the
build with:

```
$ git diff --quiet -- subgraph.yaml && echo "CLEAN: subgraph.yaml unmodified"
CLEAN: subgraph.yaml unmodified
```

`git status --porcelain integrations/graph` was also empty before and after codegen,
build and test — the committed tree (`subgraph.yaml`, `networks.json`, `schema.graphql`,
`src/mapping.ts`, `abis/V4SettlementHook.json`, `tests/settlement.test.ts`) is untouched
by any command in this file. Only the gitignored `generated/` and `build/` directories
were written.

### 3. `npx graph test`

```
$ npx graph test
settlement
--------------------------------------------------
  handleSettlementReceipt, schema v1:
    √ one receipt becomes one immutable Settlement with every field as emitted - 0.633ms
    √ a receipt of another schema version creates nothing - 0.012ms
    √ two receipts in one transaction are two entities with distinct ids - 0.157ms
  handleSettlementReceipt, live Sepolia receipt (tx 0x1120af18...ecb83):
    √ the live receipt becomes exactly one Settlement with the on-chain field values - 0.115ms
    √ delivering the identical live event twice leaves exactly one entity - 0.117ms
    √ the identical live log with schemaVersion 2 instead of 1 creates no entity - 0.011ms

All 6 tests passed! 😎
```

Six tests, six passed, zero failed — matchstick against the fixtures in
`tests/settlement.test.ts` (one synthetic receipt, one pinned to the live Sepolia log).

### 4. The receipt topic is present exactly once in the deployed hook's bytecode

The subgraph's one event handler is keyed on `SettlementReceipt`'s topic 0. Re-derived
and checked against the live contract over the public RPC, not assumed from
`docs/RECEIPT-SCHEMA.md`:

```
$ cast keccak 'SettlementReceipt(bytes32,bytes32,address,uint16,address,address,address,address,uint128,uint128,uint128,bytes32)'
tx 0xf9b834e9c2d7d0250251dfdb3c5fdc3f97d829dbe3402f45c89257ab4ec43563

$ cast code 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 \
    --rpc-url https://ethereum-sepolia-rpc.publicnode.com > hook.bytecode.txt
$ grep -o "f9b834e9c2d7d0250251dfdb3c5fdc3f97d829dbe3402f45c89257ab4ec43563" hook.bytecode.txt | wc -l
       1
```

The topic the recomputed hash produces is embedded in the deployed runtime exactly
once, matching the constant recorded in `docs/RECEIPT-SCHEMA.md`. The manifest's
`eventHandlers` entry (`subgraph.yaml:24-26`) decodes this same signature.

**Every pre-deploy check above: 4 run, 4 passed, 0 failed.** (codegen exit 0; build
exit 0 with the manifest unmodified; 6/6 matchstick tests; the topic present once.)

## The exact owner-run commands

Everything past this point needs a Subgraph Studio account and a deploy key. Both are
the owner's alone. **The deploy key is typed at an interactive prompt or passed as a
CLI argument by the owner, in the owner's own terminal — never written to a file, an
env var checked into anything, or pasted into this conversation or any other.**

Run from `integrations/graph/`, with the exact pinned CLI (`npx` resolves to the
`0.98.1` binary already installed in `node_modules/`, confirmed above — no version
drift between what was tested here and what deploys).

**1. Create the subgraph in the Studio web UI first.** The Studio flow does not use a
CLI `create` step (unlike a self-hosted graph-node, which needs `graph create`): the
subgraph name/slug is registered by creating it at
`https://thegraph.com/studio/` and choosing a slug — call it `SLUG` below. This step
has no command; it is owner-only browser action.

**2. Authenticate** (reads the pinned CLI's own `graph auth --help`: `Sets the deploy
key to use when deploying to a Graph node.` One positional argument, `[DEPLOY-KEY]`):

```sh
cd integrations/graph
npx graph auth
# prompted: "What is your Subgraph Studio deploy key?" — type it, it is not echoed to
# shell history this way. (Typing `npx graph auth <KEY>` on one line also works, but
# puts the key in the shell's history file — prefer the bare prompt form.)
```

Confirmed against the installed package
(`node_modules/@graphprotocol/graph-cli/dist/commands/auth.js` and
`dist/command-helpers/node.js`): with no `--node` flag, `graph auth` always targets
`https://api.studio.thegraph.com/deploy/` and validates the key as 32 hex characters
before saving it to `~/.graph-cli.json`, keyed by that URL — nothing is written inside
this repository.

**3. Deploy**, with a version label derived from the commit this manifest is built
from (reads the pinned CLI's own `graph deploy --help`):

```sh
npx graph deploy SLUG \
  --network sepolia --network-file networks.json \
  --version-label "v1-$(git rev-parse --short HEAD)"
```

Replace `SLUG` with the slug chosen in Studio. `the commit deployed from` is `HEAD` as of this preflight
(`git log -1 --format='%h %H %ad' --date=short HEAD` →
`the commit deployed from the commit deployed from0b926e886345070827e94065155201065 2026-09-05`); use the commit `HEAD`
actually points to at deploy time, not this one, if it has moved. `--network` and
`--network-file` are the same flags used in the pre-deploy `graph build` check above,
for the same reason: confirmation that the address and start block deployed are the
ones committed, not a substitution (the check above already showed there is nothing to
substitute). With no `--node` flag, `graph deploy` defaults to the same Studio URL as
`graph auth` (confirmed in `dist/command-helpers/node.js`:
`SUBGRAPH_STUDIO_URL = 'https://api.studio.thegraph.com/deploy/'`, returned whenever
`node` is not passed) and picks up the key saved by step 2 automatically — no
`--deploy-key` flag is needed if step 2 ran first in the same environment.

Per the current Subgraph Studio deployment guide (verified against the pinned CLI's
own `--help` output and against
<https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/>,
fetched 2026-09-05): `graph deploy <SUBGRAPH_SLUG>` is the documented form; passing
`--version-label` (`-l`) up front, as above, answers the prompt the CLI would otherwise
ask interactively ("Which version label to use?"). No IPFS node needs to be run or
specified — `--ipfs` defaults to `https://api.thegraph.com/ipfs/api/v0`
(`dist/command-helpers/ipfs.js`), the same public gateway `graph deploy` always uses
for a Studio target.

## What to expect in Studio, once deployed

- Studio starts the subgraph syncing from block `11639895` — the hook's deploy block,
  not genesis. Nothing before that block is or should be indexed; there was nothing to
  index (the hook did not exist).
- The one on-chain event this deployment has ever had reason to index is the live
  settlement at block `11640026`, transaction
  tx `0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83`, log index `107`
  — order id
  tx `0x72b25a9b4e6f89138766bb0251a1fc41f8da15efb0d87f058390da1737aab8e9`, `amountOut`
  `2003660`. Once Studio reports itself synced past block `11640026`, exactly one
  `Settlement` entity should exist with these values. `verify-hosted.sh` checks this
  automatically (its checks 1 and 3).
- The failed first deploy attempt, transaction
  tx `0xd4240fbde823a37ca484bbf90272e71fd6456277a7fe173ea4489acfc9cec089` (reverted,
  `DeadlineInPast`, same block as the deploy, `11639895`), emitted no
  `SettlementReceipt` log and must produce zero entities. `verify-hosted.sh` check 2.
- Studio's sync progress is visible as a block-height counter on the subgraph's own
  page inside `https://thegraph.com/studio/`, reached after creating it there (the
  exact per-subgraph URL is assigned by Studio at creation time and is not predicted
  here). There is no CLI command in this preflight for reading that counter, since it
  is also queryable over GraphQL (`verify-hosted.sh` check 3,
  `_meta { block { number } }`), which does not depend on guessing a UI URL.

## The claim this file does not make

Nothing above has been run against Subgraph Studio. **No hosted subgraph availability
is claimed** — not that a subgraph exists at any Studio URL, not that it is synced, not
that it answers queries — until the owner runs the two commands above and
`verify-hosted.sh` (same directory as this file) is run against the resulting query URL
and reports its checks passed. Until then, `docs/INTEGRATIONS.md`'s own line stands:
"**Qualification: pending** until it is, and until 'what became easier because a
shared schema was used' is shown with a second hook's receipts answering the same
query."
