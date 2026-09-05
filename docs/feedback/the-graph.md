# The Graph

> Requirement quotes on this page were read from the published prize page on 2026-09-05; that day's saved copy is kept privately with its hash. Where an older fetch is carried forward, the file says so.


**Touches UNICA today:** yes. `integrations/graph/` holds a manifest keyed by hook address per
network, a schema with one immutable `Settlement` entity, a handler keyed on schema version
one, three matchstick tests against a real local receipt, and `local-e2e.sh`, which reconstructs
a settlement from its log in a local graph-node and shows a refused payment yields no entity.
The hook itself imports and inherits `IHookEvents` and emits `HookFee`
(`src/V4SettlementHook.sol:5,36,202`).

**Published requirement** (Best Use of Composable or Standardized Graph Products,
ethglobal.com/events/ethonline2026/prizes, retrieved 2026-09-05): "Mocked, local-only, or
static datasets do not qualify."

**What would have to be built:** a Subgraph Studio deployment of `integrations/graph/` against
the live hook address. Everything upstream of that deployment step exists and passes locally;
the deployment itself is an owner action needing a Studio account, and has not been taken.

**What we'd ask The Graph to change, with evidence:** the official `v4-subgraph`'s `HookSwap`
handler (5 params, `int256/uint24`) computes a different `topic0` than OpenZeppelin's
`IHookEvents.HookSwap` (6 params, `int128/uint128`) — confirmed with `cast keccak` on both
forms — so a hook emitting the standardized event is indexed by nothing today. Separately, the
hook data source in `v4-subgraph` exists for exactly one network, and the generator script that
could template it across networks does not. Both are detailed in `uniswap/README.md`, table (c),
since the affected repository is Uniswap's, not The Graph's own.

Status: no claim of qualification.
