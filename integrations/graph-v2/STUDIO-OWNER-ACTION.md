# Subgraph Studio deployment — owner action

Everything in this directory runs today. The deployment does not, and **the blocker is not the
Studio credential** — it is Step 0: the contract this manifest names does not exist on any public
chain, so the deployment it would produce could only ever index nothing. Read Step 0 before Step 1.

If what you want is a live Graph deployment against real UNICA data, that is **`integrations/graph/`**
(the V1 hook), whose event has been confirmed emitted on Sepolia — see Step 0 and
`integrations/graph/STUDIO-PREFLIGHT.md`. This document stays here for the day a V2 executor is
deployed, and is correct from Step 1 onward once it is.

> **The deploy key is never pasted into this repository and never committed to it.**
> It never enters a chat either. It is a bearer credential for publishing under your Studio
> account, and `graph auth` stores it in
> `~/.graph-cli.json`, outside this checkout, which is where it should stay. Do not paste it into a
> file here, into a commit message, into an issue, or into a conversation with any tool or person —
> including this one. A key in a public repository is disclosed the moment it is pushed, and a
> pushed commit cannot be un-pushed.

---

## Step 0 — the precondition, still unmet, re-measured 2026-09-09

**A subgraph can only index a contract that exists.** The executor address in `networks.json` and
`subgraph.yaml` is the **fork-local** V2 executor from `test/fork`. Re-measured against live
Ethereum Sepolia on **2026-09-09**, at head block **11666369**, through the repository's configured
alias rather than a pasted URL:

```sh
cast code    0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f --rpc-url sepolia_testnet   # -> 0x  (0 bytes)
cast nonce   0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f --rpc-url sepolia_testnet   # -> 0
cast balance 0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f --rpc-url sepolia_testnet   # -> 379390040000000000
```

**Zero bytes of code.** Note the third line: the address is *not* untouched — it holds 0.37939 ETH
from activity that has nothing to do with UNICA. "It has a balance" is exactly the kind of signal
that reads as "something is deployed there" and is not. The only reading that decides this question
is `eth_getCode`, and it returns nothing.

Deploying the subgraph as it stands would produce a Studio deployment that syncs to head and indexes
nothing, forever, with no error anywhere. This repository's own rule is that an empty result proves
nothing; a *permanently* empty one that looks like a working integration is worse.

So before anything below:

- **Either** deploy a V2 `QuoteSettlementExecutor` to Sepolia and record its address and the block
  it was deployed in,
- **or** decide deliberately to deploy the subgraph against a contract that does not exist yet, in
  which case say so wherever the result is quoted.

### This directory is not the route to a live subgraph today — `integrations/graph/` is

The V1 hook and executor **are** live and **have emitted**. This was established from the chain on
2026-09-09, not inferred from a document:

| Measured | Value |
|---|---|
| `topic0`, recomputed with `cast keccak` from the manifest's own event signature | `0xf9b834e9c2d7d0250251dfdb3c5fdc3f97d829dbe3402f45c89257ab4ec43563` |
| `eth_getLogs` at the V1 hook, 10-block window `0xb19cd5`–`0xb19cde` | **1 log** — block `11640026`, `logIndex` 107 |
| that log's transaction | `0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83`, status `0x1` |
| sabotage control — same window, last nibble of `topic0` flipped `3`→`4` | **0 logs**, so an empty answer here is a real answer |
| the V1 hook's code at block `11639894` / `11639895` | `0` bytes / `10634` bytes — the manifest `startBlock` **is** the creation block |

`integrations/graph/` subscribes to that event, at that address, from that block. It is deployable
today against real data, and `integrations/graph/STUDIO-PREFLIGHT.md` is its owner-action document.
**If the goal is a live Graph deployment, take that one — not this one.** This directory becomes
deployable when, and only when, a V2 executor exists on a public chain.

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
