# Subgraph Studio deployment — owner action

Everything in this directory runs today except the one thing that needs a credential and a wallet:
the deployment itself. This document is the whole of that step, in order, with nothing left to guess.

> **The deploy key is never pasted into this repository and never committed to it.**
> It never enters a chat either. It is a bearer credential for publishing under your Studio
> account, and `graph auth` stores it in
> `~/.graph-cli.json`, outside this checkout, which is where it should stay. Do not paste it into a
> file here, into a commit message, into an issue, or into a conversation with any tool or person —
> including this one. A key in a public repository is disclosed the moment it is pushed, and a
> pushed commit cannot be un-pushed.

---

## Step 0 — the precondition, and it is currently unmet

**A subgraph can only index a contract that exists.** The executor address in `networks.json` is the
**fork-local** V2 executor from `test/fork`. Measured against live Ethereum Sepolia on 2026-09-08:

```sh
curl -s -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f","latest"]}' \
  https://ethereum-sepolia-rpc.publicnode.com
```

returned `"result":"0x"` — **zero bytes of code**. Deploying the subgraph as it stands would produce
a Studio deployment that syncs to head and indexes nothing, forever, with no error anywhere. This
repository's own rule is that an empty result proves nothing; a *permanently* empty one that looks
like a working integration is worse.

So before anything below:

- **Either** deploy a V2 `QuoteSettlementExecutor` to Sepolia and record its address and the block
  it was deployed in,
- **or** decide deliberately to deploy the subgraph against a contract that does not exist yet, in
  which case say so wherever the result is quoted. The V1 hook and executor **are** live
  (`0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` and `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`,
  both carrying code at the same check) — but they emit the V1 event, which **this** subgraph does
  not subscribe to. Pointing this manifest at them would index nothing for a different reason.

## Step 1 — set the network, the address and the start block, before building

`graph build` reads `networks.json`, not the manifest, when `--network-file` is passed. Both are
edited so a reader of either sees the truth.

```sh
# integrations/graph-v2/networks.json
{
  "sepolia": {
    "QuoteSettlementExecutor": {
      "address": "0x<THE DEPLOYED V2 EXECUTOR>",
      "startBlock": <THE BLOCK IT WAS DEPLOYED IN>
    }
  }
}
```

The start block must be **the deployment block, not zero and not a round number below it**. A start
block earlier than the deployment costs hours of syncing over blocks that cannot contain the event;
a start block later than it silently loses every settlement before that point. `check.mjs` refuses a
zero and refuses a disagreement between the two files, so run it after editing:

```sh
node integrations/graph-v2/check.mjs
```

## Step 2 — the toolchain

The CLI is already pinned in `package.json` at `@graphprotocol/graph-cli` **0.98.1**; the commands
below are the ones that version actually exposes, read from its own source rather than from memory.

```sh
cd integrations/graph-v2
ln -sfn ../graph/node_modules node_modules    # once, if node_modules is missing
npx graph --version                            # expect 0.98.1
```

## Step 3 — create the subgraph in Studio (browser, wallet, owner only)

1. Open <https://thegraph.com/studio/> and connect the wallet that should own the subgraph.
2. **Create a Subgraph**. Give it a name — the *slug* it generates is what `graph deploy` takes.
3. Set the network to **Sepolia**, matching `subgraph.yaml`'s `network: sepolia`.
4. Studio shows a **deploy key** on the subgraph's page. Copy it to the clipboard and nowhere else.
   It is 32 hexadecimal characters; the CLI rejects anything that is not.

## Step 4 — authenticate the CLI

```sh
npx graph auth <DEPLOY_KEY>
```

Positional argument, no `--studio` flag — that form belonged to an older CLI. The key is written to
`~/.graph-cli.json` against the default node `https://api.studio.thegraph.com/deploy/`. Run it in a
shell whose history you are willing to have it in, or run `npx graph auth` with no argument and
paste at the prompt so it never reaches the history at all.

## Step 5 — build

```sh
cd integrations/graph-v2
npx graph codegen
npx graph build --network sepolia --network-file networks.json
npx graph test          # the matchstick suite: 13 mapping rows
node check.mjs          # manifest, ABI, queries, provider and copilot consistency
```

All three must be green before deploying. `graph test` needs `node_modules`; `check.mjs` does not.

## Step 6 — deploy

```sh
npx graph deploy <SUBGRAPH_SLUG> --version-label v0.0.1 \
  --network sepolia --network-file networks.json
```

`--version-label` (`-l`) is prompted for if omitted. Use a version you can say out loud: it appears
in the query URL.

## Step 7 — wait for it to sync, then read three things off the Studio page

Do not quote a result before the indexing status reads **Synced**. While it is syncing, the endpoint
answers with a `_meta` block far behind head — which `provider.mjs` will correctly refuse as
`STALE_INDEX`, and that refusal is the tooling working, not a problem to route around.

Copy back:

| What | Looks like | Why it is needed |
|---|---|---|
| the slug | `unica-v2` | names the deployment in every later command |
| the **Development Query URL** | `https://api.studio.thegraph.com/query/<NUMBER>/<SLUG>/<VERSION>` | this is `UNICA_SUBGRAPH_URL` |
| the deployment id | `Qm…` | `live-proof.mjs` prints it, so a reader can check which build answered |
| the sync status and indexed block | `Synced, block N` | the staleness margin is measured against it |

**Do not copy back the deploy key.** Nothing downstream needs it. The Development Query URL carries
no credential, which is why it is the one to paste.

## Step 8 — prove it, from this repository

```sh
export UNICA_SUBGRAPH_URL='https://api.studio.thegraph.com/query/<NUMBER>/<SLUG>/<VERSION>'
node integrations/graph-v2/live-proof.mjs
```

or `make graph-v2-live`. With the variable unset it prints a SKIP naming it and exits non-zero, so
there is no way to mistake "not configured" for "working".

A green run prints the indexed block, the head it was compared against, the staleness margin, the
row count and a copilot verdict over exactly those rows.

## Step 9 — optional: publish to the decentralised network

Only if you want a gateway endpoint rather than the Studio development one. It costs GRT to signal
and it is a wallet transaction, so it is a separate decision:

```sh
npx graph publish
```

Publishing yields a gateway URL of the form
`https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>`, queried with an **API key** from
Studio's *API Keys* section sent as `Authorization: Bearer …`. Set both:

```sh
export UNICA_SUBGRAPH_URL='https://gateway.thegraph.com/api/subgraphs/id/<SUBGRAPH_ID>'
export GRAPH_API_KEY='<API_KEY>'
```

The older gateway form embeds the key in the path. `provider.mjs` accepts that too — write
`[api-key]` where the key goes and set `GRAPH_API_KEY`, and the key is substituted for the request
and redacted out of everything printed. Both forms are covered by the suite.

## What becomes true when this is done

- The treasury copilot's input is **live indexed data** and nothing else. There is no fixture path it
  can reach, and the suite proves that structurally as well as behaviourally.
- `live-proof.mjs` exits 0 and prints an indexed block, a real staleness margin against an
  independent chain head, and a verdict computed from the rows that endpoint actually returned.
- The claim "The Graph is load-bearing" stops being a design statement and becomes a command anyone
  can run.

## What is still not true afterwards

- A deployed subgraph does not make the executor exist. If step 0 was skipped, every query returns
  zero rows and the copilot correctly reports `INSUFFICIENT_DATA` — which is honest, and is not a
  demonstration of anything.
- Studio's development endpoint is rate-limited and is not a production dependency.
- Nothing here signs, sends, or spends. Steps 3, 4, 6 and 9 are the owner's, in the owner's browser
  and shell, with the owner's wallet.
