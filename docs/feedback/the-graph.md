# The Graph

> Requirement quotes on this page were read from the published prize page on 2026-09-05; that day's saved copy is kept privately with its hash. Where an older fetch is carried forward, the file says so.


**Touches UNICA today:** yes. `integrations/graph/` holds a manifest keyed by hook address per
network, a schema with one immutable `Settlement` entity, a handler keyed on schema version
one, six matchstick tests against a real local receipt, and `local-e2e.sh`, which reconstructs
a settlement from its log in a local graph-node and shows a refused payment yields no entity.
The hook itself imports and inherits `IHookEvents` and emits `HookFee`
(`src/V4SettlementHook.sol:5,35,250`).

**Published requirement** (Best Use of Composable or Standardized Graph Products,
ethglobal.com/events/ethonline2026/prizes, retrieved 2026-09-05): "Mocked, local-only, or
static datasets do not qualify."

**What would have to be built:** a Subgraph Studio deployment of `integrations/graph/` against
the live hook address. Everything upstream of that deployment step exists and passes locally;
the deployment itself is an owner action needing a Studio account, and has not been taken.

**The data it would index is real, and that was measured, not assumed (2026-09-09).** The question
"has this hook ever actually emitted?" was put to the chain rather than to a document:

| Measured | Result |
|---|---|
| `topic0`, recomputed with `cast keccak` from the manifest's own event signature | `0xf9b834e9c2d7d0250251dfdb3c5fdc3f97d829dbe3402f45c89257ab4ec43563` |
| `eth_getLogs` at `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`, 10-block window `0xb19cd5`–`0xb19cde` | **1 log**, block `11640026`, `logIndex` 107 |
| that transaction | `0x1120af18…ecb83`, status `0x1` (mined, succeeded) |
| decoded fields | `amountIn` 1000000000000000 (0.001 native), `amountOut` 2003660, `schemaVersion` 1, `fee` 0 |
| **sabotage control** — identical query, last nibble of `topic0` flipped `3`→`4` | **0 logs** — so the empty answers below are real answers, not a dead query |
| the reverted first attempt `0xd4240fbd…c089` | status `0x0`, block `11639895`, **0 logs** — a refused payment leaves no receipt |
| hook code at block `11639894` / `11639895` | `0` / `10634` bytes — the manifest `startBlock` is exactly the creation block |

Local, same day: `graph codegen` exit 0, `graph build --network sepolia --network-file networks.json`
exit 0 with the committed manifest unmodified, `graph test` **6 of 6 passed, 0 failed**,
`verify-hosted.sh --self-test` **2 checks, 0 failed** (accepts its control, rejects its sabotage).

**What this does not establish.** The configured Sepolia endpoint caps `eth_getLogs` at a 10-block
range, so the ~26,000 blocks from `startBlock` to head were **not** swept. What is proven is *at
least one* receipt exists — which is the whole of the precondition for deploying. It is **not**
proven that it is the only one, and no count of settlements should be quoted from this work.

**What we'd ask The Graph to change, with evidence:** the official `v4-subgraph`'s `HookSwap`
handler (5 params, `int256/uint24`) computes a different `topic0` than OpenZeppelin's
`IHookEvents.HookSwap` (6 params, `int128/uint128`) — confirmed with `cast keccak` on both
forms — so a hook emitting the standardized event is indexed by nothing today. Separately, the
hook data source in `v4-subgraph` exists for exactly one network, and the generator script that
could template it across networks does not. Both are detailed in `uniswap/README.md`, table (c),
since the affected repository is Uniswap's, not The Graph's own.

**A second ask, from building the V2 client (2026-09-08).** A subgraph whose manifest names an
address that holds **no code** deploys cleanly, syncs to head, and indexes nothing — forever, with
no error anywhere. Studio reports it as healthy and synced, because it is: there is simply nothing
to match. We hit this ourselves and caught it only by running `eth_getCode` against our own
manifest address before deploying, which is not a step anything told us to take.

It is the same failure shape as an event-signature mismatch, and it is invisible in the same way:
the honest signal and the broken one are both "0 entities". We would ask for a deploy-time or
Studio-side warning when a data source's `address` has no code at `startBlock` on the named
network. A one-line check would have saved us a deployment that could only ever have indexed
nothing, and would save anyone whose contract moved between networks.

Our own preflight now refuses a zero start block and a disagreement between `subgraph.yaml` and
`networks.json`; the code check is step 0 of `integrations/graph-v2/STUDIO-OWNER-ACTION.md`.

## Status — two subgraphs, two different blockers

| | `integrations/graph/` (V1) | `integrations/graph-v2/` (V2) |
|---|---|---|
| Subscribes to | `SettlementReceipt` | `QuoteSettled` |
| Target contract | V1 hook `0x11202071…a0C0` | fork-local executor `0x5615dEB7…b72f` |
| Code at that address on Sepolia | **10,634 bytes** | **0 bytes** (nonce 0; the 0.379 ETH balance there is unrelated) |
| Has the event ever fired there? | **Yes** — block `11640026`, verified above | No, and it cannot |
| Blocker | a Studio account and one `graph deploy` — **owner action, nothing else** | **V2 must be deployed somewhere first** |
| Status | `READY_FOR_STUDIO_OWNER_ACTION` | `BLOCKED_ON_V2_DEPLOYMENT` |

**The Graph is one Studio deploy away, via the V1 subgraph.** The earlier line on this page — that
no live read had been observed because nothing was deployed to read from — was true of the V2
client and was never true of V1; carrying it as the page's single status made the whole integration
look further away than it is.

Still not observed, and not claimed: no Subgraph Studio deployment exists, nothing has been queried
over a Studio endpoint, and `live-proof.mjs` exits non-zero with a named SKIP when
`UNICA_SUBGRAPH_URL` is unset rather than pretending otherwise. "Deployable today" is a statement
about the precondition, not about a running deployment.

The second ask above stands unchanged, and this session is a second instance of it: the only thing
separating "healthy and indexing" from "healthy and indexing nothing, forever" was an `eth_getCode`
and an `eth_getLogs` that no tooling asked us to run.
