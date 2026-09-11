# UNICA v5 / ENS — scalability at four settlement volumes

Engineering record. Read-only research and architecture; authorizes no registration, no
deployment, no subname creation, no record write, no paid infrastructure. Retrieval date for
every claim below is 2026-09-11 unless a claim states otherwise. Labels: VERIFIED (source
cited), PROPOSED (UNICA design choice), DOCUMENTED_NOT_OBSERVED, UNKNOWN. Authority labels,
never blended: ENSV2_ONCHAIN, UNICA_ONCHAIN, BACKEND_POLICY, GRAPH_EVIDENCE,
CLIENT_VERIFICATION, OFFCHAIN_OPERATION.

**ENS-namespace scalability and indexing scalability are different problems.**
`docs/unica-v5/graph/SCALABILITY.md` (sibling stream, cited not edited) already states, for The
Graph, that indexer throughput and settlement gas economics are separate questions; the same
separation holds here, one layer up: whether ENS naming/resolution scales to N merchants and N
receipts/day is a question about registration gas, resolver/registry proliferation and
off-chain lookup design — not about on-chain settlement throughput (a contracts-layer question)
and not about indexer throughput (the graph stream's own question). This document addresses the
ENS-naming half only, and says so wherever the two would otherwise be conflated. It builds
directly on the class decisions in `docs/unica-v5/ens/NAMESPACE.md` (this stream — the recommended
hierarchy has **no** per-terminal or per-receipt node) and the discovery-model recommendation in
`docs/unica-v5/ens/RECEIPT-NAMING.md` (this stream — Model D default, Model E for durable
evidence, Model A rejected). Neither is re-derived here.

## 0. What this document inherits, and does not re-derive

- **The hierarchy being costed** is `NAMESPACE.md` §9's tree: one merchant root per merchant,
  `pay.`/`treasury.` beneath it, at most one `agent.` leaf per delegate needing public
  disclosure, **zero** nodes for terminals, staff-in-general, markets, or receipts.
- **The receipt discovery model being costed** is `RECEIPT-NAMING.md` §7's recommendation: a
  merchant service record (Model D, zero incremental on-chain footprint) as the default, an
  optional wildcard-resolved live lookup (Model B, also zero incremental footprint) as a
  complement, and an epoch commitment root (Model E) layered on top only where durable,
  ENS-anchored evidence is specifically required.
- **The unit gas figures used throughout** are this repository's own measurements, not invented:
  `setAddr` **44,339 gas** (live, ENSV2_ONCHAIN, `integrations/ensv2/ENS-OWNER-ACTION.md`);
  `setText` at an unregistered name **64,847 gas** (fork, ENSV2_ONCHAIN,
  `docs/ensv2/DELEGATION-PLAN.md`); `authorizeTextRoles` grant **89,280 gas** and revoke
  **41,622 gas** (fork, same source). Registration itself (`register()`) has **no first-party
  gas measurement anywhere in this repository** — carried as UNKNOWN throughout, per
  `NAMESPACE.md` §12.1 and `RECEIPT-NAMING.md` §9.1.
- **The network-capacity figure used as a denominator** — Ethereum's gas limit at **60,000,000
  per block** following a 2025 increase from 30,000,000 — is COMMUNITY, trade-press-reported
  (a named ENS co-founder's public statement about *why* ENS scrapped its planned Namechain L2;
  see §8). At ~7,200 blocks/day (12-second blocks) that is **~432,000,000,000 gas/day** of total
  network capacity. This figure was **not** independently corroborated on ENS's own official
  site: `ens.domains/ensv2`, fetched directly for this document, states only "ENSv2 is coming
  soon" with no architecture, gas, or timeline detail (fetched 2026-09-11) — so the 60M/30M
  figures are carried as COMMUNITY, not OFFICIAL, throughout this document.
- **This is the ENSv2 Sepolia beta**, chain id `11155111` (ENSV2_ONCHAIN, per `NAMESPACE.md`
  §0), not production ENS mainnet. Every cost figure below is a Sepolia-beta gas unit cost;
  nothing here is presented as a mainnet ENS cost, and no production ENS address is assumed
  anywhere in this document.

## 1. Scenario 1 — 1 merchant, 2 terminals

**Nodes created:** 1 merchant root, served under `subtree` mode (`NAMESPACE.md` §9's default),
plus `pay.`/`treasury.` beneath it. Zero terminal nodes (`NAMESPACE.md` §3). At most one
`agent.` leaf if a delegate needs public disclosure — not assumed present by default.

**One-time onboarding cost.** `docs/ensv2/DELEGATION-PLAN.md`'s own `subtree` mode is specified
as **thirteen transactions**, all signed by the parent's owner alone, covering the resolver
pointer, the merchant's `pay.`/`treasury.` records, and the verification/simulation steps that
accompany them (not every one of the thirteen is a state-changing write; several are the
prescribed read-back verifications). Using the measured unit costs as an illustrative ceiling —
thirteen transactions at the **highest** measured unit cost (89,280 gas, an `authorizeTextRoles`
grant) — is **1,160,640 gas total, once**, for the whole merchant. That is roughly 2% of a
**single block's** 60,000,000-gas capacity, and an immeasurably small fraction of a day's
capacity. **This scenario is trivially affordable under every approach named in §5** — its
purpose here is establishing the per-merchant unit cost the later scenarios multiply, not testing
a limit.

**Receipts.** Whatever volume the 2 terminals produce, `RECEIPT-NAMING.md`'s recommended Model D
adds zero incremental on-chain writes regardless of count — this scenario does not stress the
receipt question at all.

## 2. Scenario 2 — 100 merchants, 10 terminals each

**Nodes created:** 100 merchant roots (served, `subtree` mode) + their `pay.`/`treasury.`
children. 1,000 terminals, **zero** terminal nodes.

**One-time onboarding cost, shared-resolver (`subtree`) mode:** 100 × 13 transactions = 1,300
transactions. At the same illustrative ceiling (89,280 gas each): **116,064,000 gas total**,
once — under 2 full blocks' worth if it all happened in one instant, and trivial spread across
even a single day of onboarding.

**One-time onboarding cost, individual-proxy (`subregistry`) mode, for comparison:** 100 × 20
transactions = 2,000 transactions (`DELEGATION-PLAN.md`'s own count for that mode), deploying
**three registries per merchant** (300 registry contracts total) plus one resolver proxy per
merchant. Gas is still trivial in aggregate (order of 180,000,000 gas at the same ceiling), but
this is the first scenario where the **operational** distinction between the two modes — one
shared, audited resolver instance versus one hundred independently-initialized ones — becomes a
real, if still small, difference in what must be tracked. §6 names the scenario where that
difference becomes decisive.

**Receipts.** Still governed by `RECEIPT-NAMING.md` §7 regardless of merchant or terminal count —
this scenario does not change the receipt-layer answer.

**Enumeration.** At 100 merchants, a human could in principle still eyeball a list by hand; this
is close to the scenario where that stops being true (§6).

## 3. Scenario 3 — 10,000 merchants, 20 terminals each

**Nodes created:** 10,000 merchant roots + children. 200,000 terminals, **zero** terminal nodes.

**One-time onboarding cost, shared-resolver (`subtree`) mode:** 10,000 × 13 = 130,000
transactions. At the same illustrative ceiling: **11,606,400,000 gas total**, once — about
193 blocks' worth if concentrated into one instant (≈2.7% of a single **day's** 432,000,000,000-
gas network capacity, if the entire onboarding happened within 24 hours), and a rounding error
if spread over the weeks or months a real onboarding pipeline would take. **Gas is still not the
constraint at this scenario**, even at this ceiling.

**Where this scenario actually bites: resolver/registry proliferation, not gas.**
Individual-proxy (`subregistry`) mode at 10,000 merchants means **30,000 independently-deployed
`PermissionedRegistry` instances** (three per merchant, per `DELEGATION-PLAN.md`'s own count)
plus **10,000 independently-initialized resolver proxies** — each running the same audited
implementation code (deployed via the Verifiable Factory as a thin proxy, per
`docs.ens.domains/ensv2/overview`, OFFICIAL), so the **code** being audited does not grow more
complex with merchant count. What grows is the **number of instances whose initialization must
each be independently correct.** This repository has already measured, on exactly **one**
observed per-name resolver proxy, an anomaly that is precisely this class of risk: `roles
(ROOT_RESOURCE, owner)` reads `0` while `hasRoles(ROOT_RESOURCE, ..., owner)` reads `true` for
that one instance, and a **second, unidentified full-authority account** exists on it
(ENSV2_ONCHAIN, `docs/ensv2/DELEGATION-PLAN.md`, "a second full-authority account exists on a
per-name resolver and was not identified"). At **one** instance, that is a residual to track. At
**10,000** independently-initialized instances, the same class of anomaly recurring on some
non-zero fraction of them stops being a tail risk and becomes an expected, load-bearing
operational finding — this is the concrete point named in §6 as where "resolver complexity
becomes unsafe": not the audited bytecode, which does not change, but the **count of
independently-initialized authority-holding contract instances that must each be separately
verified**, which `subtree` (shared-resolver) mode holds at **one** regardless of merchant count,
and `subregistry` mode lets grow linearly with it.

**Enumeration.** At 10,000 merchants × 20 terminals, no UNICA operator dashboard could
meaningfully answer "which merchants exist and what do their records currently say" by reading
registry contracts directly — this is squarely the scale ENS's own official guidance already
addresses at far smaller scale: **"not all ENS names exist onchain... The ENS subgraph indexes
all events from relevant smart contracts"** is stated as the general answer to enumeration
(VERIFIED, OFFICIAL, `docs.ens.domains/web/enumerate/`, retrieved 2026-09-11), independent of any
UNICA-specific volume. §6 names this scenario as the point past which a Graph-indexed view
(GRAPH_EVIDENCE) stops being a nice-to-have and becomes the only workable answer, though the
official guidance itself implies this was already true at a much smaller merchant count than
10,000 — the scale here simply makes the alternative (manual enumeration) obviously absurd rather
than merely impractical.

## 4. Scenario 4 — 1,000,000 receipts a day

This scenario is `RECEIPT-NAMING.md`'s own subject; this section restates its conclusion in this
document's own terms rather than re-deriving it.

**Gas becomes unacceptable here, specifically for Model A (one ENS name per receipt).** Using the
cheapest measured write as an explicit floor (44,339 gas, `setAddr`) — not an estimate of the
real, higher registration cost, which is UNKNOWN — 1,000,000 receipts/day at that floor alone is
**44,339,000,000 gas/day**, roughly **10% of the entire Ethereum network's daily gas capacity**
(432,000,000,000 gas/day, COMMUNITY figure per §0), for one application's naming side-channel to
a payment that is already recorded on-chain by the settlement event itself
(`RECEIPT-NAMING.md` §1, §6). This is the exact scenario at which that model is rejected, not a
softer or later one — even Scenario 3's 10,000-merchant onboarding, at its own illustrative
ceiling, never crosses 3% of one day's capacity, and that was a **one-time** cost, not a
**daily, recurring** one the way Model A's per-receipt writes would be.

**The commitment-root model (Model E) wins decisively at exactly this volume.** A daily epoch
commitment is **one** `setText`-shaped write/day regardless of whether the day carried 1,000 or
1,000,000 receipts underneath it — at the measured 64,847-gas unit cost, that is
**0.00002% of a day's network capacity**, a rounding error next to Model A's ~10% floor
(`RECEIPT-NAMING.md` §5, §6). Gas is decoupled from receipt volume by construction; this is the
scenario the design choice was made for.

**Privacy degrades here specifically for any model with a per-receipt on-chain footprint.** At
Scenario 1–2 volumes, a single merchant's writes are indistinguishable from noise among the far
larger volume of unrelated Sepolia (or, in production, mainnet) transactions. At 1,000,000
writes/day tied to receipts (the hypothetical Model A shape), an observer watching the shared
resolver's own write events could reconstruct a near-real-time index of every merchant's
settlement cadence purely from **write timing**, with no indexer and no value ever read — this is
the concrete point at which "privacy degrades" as the assignment asks to name, and it is a
second, independent reason (beyond gas) that Model A is wrong at this volume, not merely
expensive. Model E's coarse, once-a-day (or once-an-hour) write cadence leaks vastly less by the
same measure — a merchant's day-level activity pattern, not per-receipt timing — and Models B/C/D
leak nothing at the ENS-write layer at all, since none of them writes anything per receipt.

**CCIP-Read adds availability and trust risk exactly where the answer is not already cheaply,
synchronously on-chain-readable** — not as a function of receipt volume by itself, but of data
locality. At Scenario 4's volume on a **single** chain, `RECEIPT-NAMING.md` §3 already concludes
Model B (a plain resolver read against live on-chain state) answers the same question Model C
would otherwise be built to fetch, without the extra gateway-operator or fingerprinting exposure
EIP-3668's own security section names (`RECEIPT-NAMING.md` §3, §8). The point at which Model C's
tradeoff must actually be made, rather than deferred, is **cross-chain** receipts — a shape that
becomes more likely as merchant count grows into Scenario 3's territory (10,000 merchants
plausibly spanning more than one chain) than as a direct function of Scenario 4's single-chain
receipt count.

## 5. Approach comparison across all four scenarios

The assignment names eight approaches to compare; each maps onto a decision this document or
`RECEIPT-NAMING.md` already made, restated here as one table so the mapping is explicit.

| Approach | What it is, here | Scenario it is safe through | Scenario it stops being safe / sufficient |
|---|---|---|---|
| Individual proxies | `subregistry` mode: one resolver+registry set per merchant (`NAMESPACE.md` §2, §9) | 1–2 (100 merchants: 300 registries, still trackable) | 3 (10,000 merchants: 30,000 registries, 10,000 independently-initialized authority holders — §3, §6) |
| Shared resolver | `subtree` mode: one resolver instance serves every merchant by wildcard (`NAMESPACE.md` §9's default) | 1 through 4 — the bound on independently-initialized instances is **one**, regardless of merchant or receipt count | Not reached in any scenario modeled here; its own residual (§6, "subtree capture NOT tested") is a correctness question, not a scale question |
| Wildcard (ENSIP-10) | The resolution mechanism making shared-resolver mode possible without registering every subname (`NAMESPACE.md` §0, §2) | 1 through 4 — this is a protocol mechanism, not a resource that is consumed | N/A |
| Minimal records | Publishing only a commitment or a small closed vocabulary of keys, never a raw value (`DELEGATION-PLAN.md`'s `commitPolicy` discipline, `NAMESPACE.md` §2/§5's "records exposed" rows) | 1 through 4 | N/A — this is a discipline, not a mechanism with its own scaling ceiling |
| CCIP-Read | `RECEIPT-NAMING.md` Model C: offchain gateway, signed or proof-backed | Any scenario where data is not already cheaply on-chain-readable | Becomes the right tool exactly at that data-locality point (§4), not at a specific volume |
| Graph-backed discovery | `RECEIPT-NAMING.md` Model D (merchant service record → subgraph) plus `NAMESPACE.md` §3/§6's enumeration answer for merchants/agents | 1 through 4 — this is the recommended default throughout | Its own limits are the graph sibling stream's subject (`docs/unica-v5/graph/SCALABILITY.md`), not this document's |
| Batched commitments | `RECEIPT-NAMING.md` Model E: one epoch root instead of one write per receipt; also `DELEGATION-PLAN.md`'s `multicallWithNodeCheck` for batching **setup** transactions (never role changes, by that document's own rule) | 1 through 4 — cost is decoupled from receipt/merchant count by construction | N/A within the scenarios modeled; the only open question is epoch length (`RECEIPT-NAMING.md` §9.4), a product choice, not a scaling ceiling |
| Event-only evidence | Relying on `EACRolesChanged`/`TextChanged` **events**, not the resolver's current-state view, as the durable record (`NAMESPACE.md` §2/§5's "what evidence survives revocation," `RECEIPT-NAMING.md` §5) | 1 through 4 — a log entry, once mined, does not degrade with scale | N/A — bounded by indexer/archive-node availability (GRAPH_EVIDENCE), not by ENS itself |

## 6. The exact points where each approach breaks

Per the assignment's own instruction to name these precisely rather than gesture at them:

- **Gas becomes unacceptable**: Scenario 4, for Model A specifically (one ENS name per settled
  receipt) — ~10% of one day's entire Ethereum network gas capacity at the measured **floor**
  alone, for a naming side-channel to an event already on-chain (§4). No other approach compared
  in §5 reaches an unacceptable gas figure at any scenario modeled here.
- **Resolver complexity becomes unsafe**: Scenario 3, for individual-proxy (`subregistry`) mode
  — not because the audited implementation code grows more complex (it does not; every proxy
  runs the same implementation), but because the **count of independently-initialized
  authority-holding contract instances** that must each be separately verified grows from one
  (shared-resolver mode, any scenario) to 10,000, and this repository has already observed one
  such instance carrying an unidentified second full-authority account (§3).
- **Enumeration requires an indexer**: officially true at any scale, per ENS's own guidance
  (§3) — but becomes **practically unavoidable**, not merely correct in principle, at Scenario 3
  (10,000 merchants × 20 terminals), the point at which no human-scale manual review of registry
  state remains plausible.
- **Privacy degrades**: Scenario 4, for any model with a per-receipt on-chain write (Model A) —
  write-timing alone becomes a real-time settlement-cadence index at that volume, a second,
  independent reason (beyond gas) that model is wrong there (§4). A weaker, coarse version of the
  same signal exists for Model E's once-a-day (or -hour) write, present at any scenario but
  bounded in resolution regardless of receipt count underneath it.
- **CCIP-Read adds availability and trust risk**: at the point data is not already cheaply,
  synchronously on-chain-readable — concretely, cross-chain receipts, a shape more likely once
  merchant count reaches Scenario 3's territory than a function of Scenario 4's single-chain
  receipt volume by itself (§4).
- **The commitment-root model wins**: decisively at Scenario 4 (1,000,000 receipts/day), where
  its cost is ~0.00002% of a day's network capacity against Model A's ~10% floor for the
  equivalent per-receipt approach (§4) — and it is already the more attractive choice for durable
  evidence at Scenario 3, before receipt volume alone forces the question, wherever a merchant or
  auditor needs a claim checkable independent of a live service's uptime.

## 7. Recommendation by scenario

**PROPOSED**, consistent with `NAMESPACE.md` §9 and `RECEIPT-NAMING.md` §7 throughout — this
section does not introduce a new design, it states which of the already-recommended defaults
applies at each scale:

- **Scenario 1 (1 merchant, 2 terminals):** `subtree` mode, no `agent.` leaf unless a delegate
  exists, Model D for any receipt lookup. Every approach in §5 is safe here; this scenario exists
  to fix the unit costs the later ones multiply.
- **Scenario 2 (100 merchants, 10 each):** `subtree` mode as the default; `subregistry` mode
  remains viable per-merchant for the specific merchants who need a transferable, independently-
  owned name, without yet being unsafe in aggregate.
- **Scenario 3 (10,000 merchants, 20 each):** `subtree` (shared-resolver) mode as the strong
  default, specifically **because** it holds the count of independently-initialized authority
  holders at one regardless of merchant count (§6); a Graph-indexed view for any merchant/agent
  enumeration becomes required, not optional, at this scale.
- **Scenario 4 (1,000,000 receipts/day):** Model D (merchant service record → subgraph) for
  ordinary discovery, Model E (epoch commitment root) for any durable-evidence requirement, Model
  A rejected outright. This is `RECEIPT-NAMING.md` §7's recommendation, unchanged.

## 8. Sources

| URL | Retrieved | Author/Org | Kind | Used for |
|---|---|---|---|---|
| https://docs.ens.domains/ensv2/overview | 2026-09-11 | ENS | OFFICIAL | Verifiable Factory / proxy-per-name mechanism underlying the "same code, more instances" distinction in §3, §6 |
| https://docs.ens.domains/web/enumerate/ | 2026-09-11 | ENS | OFFICIAL | "ENS names cannot be enumerated directly on-chain... the subgraph indexes all events" — §3, §6's enumeration point |
| https://ens.domains/ensv2 | 2026-09-11 | ENS | OFFICIAL | Checked directly for corroboration of the Namechain-abandonment/gas-limit claim below; states only "ENSv2 is coming soon," no further detail found |
| www.theblock.co, "ENS Labs scraps Namechain L2, shifts ENSv2 fully to Ethereum mainnet" | 2026-09-11 (event dated 2026-02-06) | The Block (trade press), reporting Nick Johnson (ENS co-founder) and Katherine Wu (ENS Labs COO) | COMMUNITY | 60,000,000 gas/block figure, the 30M→60M 2025 increase, and the "99% reduction in ENS registration gas costs over the past year" statement used as the network-capacity denominator throughout (§0, §4, §6) — **not independently corroborated on ENS's own official site** |
| `docs/ensv2/DELEGATION-PLAN.md` | 2026-09-11 | this repository | TEAM GUIDANCE | Transaction counts for `subtree` (13) and `subregistry` (20, three registries) modes; the observed per-proxy `ROOT_RESOURCE`/second-holder anomaly reused in §3, §6; measured gas unit costs |
| `integrations/ensv2/ENS-OWNER-ACTION.md` | 2026-09-11 | this repository | TEAM GUIDANCE | Live-measured `setAddr` gas figure (44,339) reused throughout |
| `docs/unica-v5/ens/NAMESPACE.md` | 2026-09-11 | this repository (this stream) | TEAM GUIDANCE | The hierarchy being costed (§0, §1–§4) |
| `docs/unica-v5/ens/RECEIPT-NAMING.md` | 2026-09-11 | this repository (this stream) | TEAM GUIDANCE | The five-model comparison and Model D/E recommendation restated in scenario terms (§4, §6, §7) |
| `docs/unica-v5/graph/SCALABILITY.md` | 2026-09-11 | this repository (sibling stream) | TEAM GUIDANCE | The indexing-vs-settlement separation framing adapted here to ENS-naming-vs-indexing (opening statement); the 1,000,000-receipts/day scenario definition reused as Scenario 4 |

## 9. Unknowns

1. **No first-party gas figure exists for `register()` itself anywhere in this repository**
   (carried from `NAMESPACE.md` §12.1 and `RECEIPT-NAMING.md` §9.1) — every onboarding-cost
   figure in §1–§3 uses measured **record-write** costs (`setAddr`, `setText`,
   `authorizeTextRoles`) as an illustrative ceiling for a transaction count that in `subregistry`
   mode also includes at least one actual registration, whose real cost is unmeasured and
   expected to be higher than the ceiling used.
2. **The 60,000,000 gas/block and 30,000,000→60,000,000 2025 increase figures are COMMUNITY
   (trade-press) sourced, reporting a named individual's public statement, and were not found
   stated on ENS's own official site when checked directly for this document** (§0, §8). Every
   percentage-of-network-capacity figure in this document inherits that provenance limit.
3. **Whether `subtree`-mode "capture" (a stranger registering under an attached-but-unused
   subregistry, then taking over resolution) is real was not tested** in this repository, and
   this document's Scenario 3 recommendation to prefer `subtree` mode at scale is made with that
   residual open, exactly as `NAMESPACE.md` §12.3 already states.
4. **No graph-node or subgraph throughput ceiling was found by the sibling graph stream either**
   (`docs/unica-v5/graph/SCALABILITY.md` §10.1, sibling stream) — this document's Scenario 3/4
   reliance on "a Graph-indexed view becomes required" inherits that same open question about
   what the indexing layer can actually sustain at those volumes; this document does not
   independently resolve it.
5. **No benchmark exists for how many independently-initialized Permissioned Resolver proxies
   this repository (or anyone) has actually surveyed for the `ROOT_RESOURCE`/second-holder
   anomaly named in §3** — the finding is real on the **one** proxy this repository has read, and
   the "expected, load-bearing at 10,000 instances" claim in §3/§6 is a PROPOSED extrapolation
   from a sample size of one, not a measured rate.
6. **No transcript of any ENS channel discussion reached this document.** Every scenario, cost
   figure, and named breaking point above is either given directly by this stream's own
   assignment (the four named scale points and the eight named comparison approaches) or derived
   from official ENS sources, this repository's own prior measurements, or explicitly labelled
   PROPOSED/COMMUNITY figures — never inferred from an unavailable discussion.
