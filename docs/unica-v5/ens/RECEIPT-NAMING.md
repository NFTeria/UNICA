# UNICA v5 / ENS — receipt naming: challenging the subname-per-receipt idea

Engineering record. Read-only research and architecture; authorizes no registration, no
deployment, no subname creation, no record write. Retrieval date for every claim below is
2026-09-11 unless a claim states otherwise. Labels: VERIFIED (source cited), PROPOSED (UNICA
design choice), DOCUMENTED_NOT_OBSERVED, UNKNOWN. Depends on the class definitions in
`docs/unica-v5/ens/NAMESPACE.md` (this stream, §7 in particular) and does not repeat their
derivation. Authority labels, never blended: ENSV2_ONCHAIN, UNICA_ONCHAIN, BACKEND_POLICY,
GRAPH_EVIDENCE, CLIENT_VERIFICATION, OFFCHAIN_OPERATION.

## 0. The question this document answers

`NAMESPACE.md` §7 rejected "one ENS name per receipt" as a class and pointed here for the
comparison that justifies it. A receipt in this repository's own live schema is a
`SettlementReceipt` event, and the graph sibling stream's schema stores it as one immutable
`Settlement` row keyed by transaction hash and log index (GRAPH_EVIDENCE,
`docs/unica-v5/graph/SCALABILITY.md` §0, sibling stream, cited not edited) — it already has a
unique, chain-native identifier before ENS enters the picture at all. The question is not
whether a receipt can be identified; it already is. The question is whether making that
identifier **ENS-resolvable** — human-typable, embeddable in a QR code, or lookup-able by name
instead of by raw id — is worth building, and if so, in which of five shapes. Five candidate
models are compared below, each scored on the same four questions: what it costs on-chain, what
it costs to look up, what it proves, and what it leaks.

## 1. Model A — one subname per receipt

**PROPOSED-then-rejected.** Every settled receipt gets its own registered or served subname,
e.g. `<receiptId>.merchant.<parent>`, written at settlement time.

- **Cost.** Even using the **cheapest** write this repository has actually measured as a floor —
  `setAddr`, **44,339 gas**, live-measured on the deployed Permissioned Resolver
  (ENSV2_ONCHAIN, `integrations/ensv2/ENS-OWNER-ACTION.md`) — a real **registration** (minting a
  registry token, not just setting one record on an existing name) is UNKNOWN in this
  repository's own measurements and would be expected to cost more, not less, than a single
  storage write (a registry mint plus at least one resolver write, by the shape of the
  transactions `docs/ensv2/DELEGATION-PLAN.md` already lists for its `subregistry` mode). Taking
  44,339 gas as an explicit, labelled **floor**, not an estimate of the real cost: at
  `docs/unica-v5/ens/SCALABILITY.md` §4's volume of 1,000,000 receipts/day, that floor alone is
  **44,339,000,000 gas/day**. Ethereum's own network gas limit is **60,000,000 per block**
  following the 2025 gas-limit increase (COMMUNITY, trade-press reporting a named ENS
  co-founder's public statement — see §8), giving roughly 432,000,000,000 gas/day of total
  network capacity at ~7,200 blocks/day. **This floor alone is ~10% of the entire Ethereum
  network's daily gas capacity, for one application's naming side-channel to a payment that is
  already recorded on-chain by the settlement event itself.** The real registration cost, being
  higher than the floor, only makes this worse.
- **Lookup.** Trivial once written — that is the entire appeal of this model, and the only thing
  it buys.
- **Proof.** No stronger than the underlying settlement event already is; the name adds no new
  authentication, since anyone can read the same event directly.
- **Leak.** If any semantically meaningful field (amount, payer, recipient) ever ends up as or
  inside the label, it becomes globally, permanently resolvable — worse than the chain's own
  event log for casual discoverability, because a name is exactly the shape a search engine or a
  casual browser indexes. Even an opaque id label leaks **write cadence**: anyone watching the
  resolver's own write events (the only way ENS names are ever enumerated at all — §5, official
  source) can infer a merchant's settlement volume and timing from name-creation frequency alone,
  without ever reading a value.

**Verdict: rejected outright on gas grounds alone**, before privacy is even considered.

## 2. Model B — wildcard-derived names resolved from settlement state

**PROPOSED, viable as a complement, not a default.** No name is ever registered or written for a
receipt. Instead, the merchant's own Permissioned Resolver implements `resolve(bytes name, bytes
data)` (ENSIP-10, VERIFIED Final, `docs.ens.domains/ensip/10`, retrieved 2026-09-11) to receive
the **full requested name**, including the leftmost label — a client resolving
`<receiptId>.merchant.<parent>` hands the resolver that entire DNS-encoded name, and the
resolver parses the leftmost label as a receipt id and answers by reading already-existing
settlement state directly (a call into the executor/hook, or an indexed lookup), computed on the
fly rather than stored anywhere as a distinct name.

- **Cost.** **Zero incremental on-chain writes, ever.** Only the original settlement transaction
  pays gas; resolving a name is a read (`eth_call`-shaped), which the CCIP-Read specification
  itself notes is not a metered transaction (VERIFIED, EIP-3668, §8). Receipt volume does not
  move this model's on-chain cost at all — it is decoupled by construction, which is exactly the
  property Model A lacks.
- **Lookup.** One resolver call, same shape as any other ENS resolution; no separate service to
  operate beyond the resolver contract itself, which already exists for the merchant root
  (`NAMESPACE.md` §2).
- **Proof.** As strong as the on-chain data the resolver reads — if it calls the executor/hook
  directly, this is genuinely UNICA_ONCHAIN evidence, not a claim.
- **Leak.** The label itself must still be an opaque id (never a semantically meaningful field,
  same discipline as Model A) — but because nothing is **written or stored** per receipt,
  there is no persistent enumerable event trail the way a registration or a `setText` call would
  leave one. A resolution is a read; ENS's own official guidance states plainly that on-chain
  enumeration works only for registered names with real registry events to scan (§5) — a
  read-only wildcard resolve leaves nothing of that kind behind at all.

**Verdict: a real option, and the natural complement to Model D (§4) whenever a client wants an
ENS-shaped pointer rather than a raw API call** — it needs no separate service and no
registration, only a resolver smart enough to parse the label it was already handed.

## 3. Model C — CCIP-Read backed by authenticated evidence

**PROPOSED, an upgrade path, not the default.** An offchain gateway answers receipt lookups,
backed by either a signed response or a Merkle/state-root proof against an on-chain commitment
(the commitment itself is Model E, §5). VERIFIED, OFFICIAL, `docs.ens.domains/resolvers/
ccip-read/`, retrieved 2026-09-11: "By leveraging CCIP Read in a Resolver, developers can store
name data beyond Ethereum Mainnet," resolved via an `OffchainLookup` revert (EIP-3668, VERIFIED,
`eips.ethereum.org/EIPS/eip-3668`, retrieved 2026-09-11) that a client follows to a gateway URL
and then calls back into the contract with the response.

The official page states the exact trust tradeoff this model inherits, quoted directly because
it is load-bearing rather than decorative: **"The worst case scenario of a trusted
implementation is that a malicious actor gains control of the gateway and can return false
information. The worst case scenario of a trustless implementation is that a malicious actor can
take a gateway offline, but it can never return false data."** (OFFICIAL, same page.) EIP-3668
itself places the authentication burden entirely on the **contract**, not the protocol:
"contracts MUST include sufficient information in the `extraData` argument to allow them to
verify the relevance and validity of the gateway's response" (VERIFIED, same source).

- **Cost.** No on-chain write per receipt at all — same zero-incremental-gas property as Model B
  — but adds an off-chain gateway to build, host, and keep available (OFFCHAIN_OPERATION), which
  Model B does not need at all when the answer is already cheaply readable from live on-chain
  state.
  - **Availability and trust risk, named explicitly, per the assignment's own instruction to
    locate this point:** a **signed-response** gateway can lie outright if compromised — the
    worse failure mode of the two named above. A **state-root/proof-backed** gateway can only go
    offline, never lie, which is the better failure mode but requires the harder engineering (a
    verified proof against an L1-readable state root, per the official page's own reference to
    "Unruggable Gateways" for the trustless case) — this repository has not built or evaluated
    either.
- **Lookup.** Three network round trips per EIP-3668's own flow (query, gateway fetch, callback
  verification) — strictly more moving parts than Model B's single resolver read.
- **Proof.** Only as strong as the chosen authentication: signed answers are exactly as
  trustworthy as the gateway operator; proof-backed answers inherit the security of whatever
  state root they check against.
- **Leak.** No different from Model B's label-opacity requirement, plus a new one: the gateway
  operator sees every lookup query in the clear (an IP address alongside a receipt id), which
  EIP-3668's own security-considerations section flags as a **fingerprinting** risk — "the
  potential for this to be used to identify users... to associate their wallet address with
  their IP address" (VERIFIED, same source) — a leak surface Model B (a plain on-chain
  `eth_call`, servable by any RPC provider the client already trusts) does not create.

**Verdict: the right upgrade from Model D (§4) specifically when receipt data is not cheaply,
synchronously readable from an L1 resolver call** — cross-chain receipts, or receipts whose
authoritative record lives somewhere an L1 contract cannot call into directly. For UNICA's
current, single-chain settlement shape, Model B already gives the on-chain-authenticated
answer Model C would otherwise be built to fetch, without the extra trust surface.

## 4. Model D — no receipt subnames; lookup through a merchant service record

**PROPOSED as the default.** The merchant's **already-existing** name (`NAMESPACE.md` §2) carries
one additional text/service record — a URL or endpoint, potentially the graph sibling stream's
own subgraph endpoint (GRAPH_EVIDENCE, `docs/unica-v5/graph/`, sibling stream) — and any client
looks up a receipt by id through that endpoint with an ordinary API/GraphQL call. ENS's job is
reduced to "here is where you ask," never "here is the answer."

- **Cost.** **One record, on a name that already exists for an unrelated reason (merchant
  discovery).** No new hierarchy level, no new resolver logic, no per-receipt anything, and no
  new infrastructure if the endpoint published is the subgraph the graph stream already
  recommends building (`docs/unica-v5/graph/SCALABILITY.md` §3's aggregation entities, sibling
  stream). This is the smallest possible on-chain footprint of any model compared here — smaller
  even than Model B, which still requires custom `resolve()` logic in the resolver contract.
- **Lookup.** A plain API/GraphQL call — no ENS resolution machinery involved at all beyond the
  one, already-necessary initial merchant-name lookup that finds the endpoint.
- **Proof.** Deliberately weaker at the ENS layer, and that is not a defect: the receipt itself
  (the on-chain settlement event) remains independently verifiable by the client directly from
  the chain regardless of what the merchant's service record claims, because the non-negotiable
  boundary (`NAMESPACE.md` §0) already requires funds-critical facts to come from the contract,
  never from a name. Model D only needs to be trusted for **convenience discovery of an id and a
  starting point**, never for the fact of settlement itself.
- **Leak.** No receipt-shaped identifier is ever exposed via ENS resolution at all — the
  identifier only travels over a query the client **chooses** to make to the service endpoint, a
  narrower disclosure surface than any model that makes ENS resolution itself carry the receipt
  id (Models A/B/C all do, even if opaque).

**Verdict: the recommended default for ordinary receipt discovery** — see §7.

## 5. Model E — epoch subnames carrying a commitment root

**PROPOSED as the durable-evidence layer, not the discovery default.** One subname **per time
epoch** (e.g. daily, or hourly at higher volume) — not per receipt, not per merchant beyond the
merchant's own root — whose text or data record carries a Merkle root committing to every
receipt settled in that epoch. A specific receipt is proven against that root with a Merkle
proof the client can independently verify, without trusting the merchant's own service (Model D)
or a gateway operator (Model C) to have told the truth.

- **Cost.** **One write per epoch, regardless of receipt count inside it.** At
  `docs/unica-v5/ens/SCALABILITY.md` §4's 1,000,000 receipts/day, a **daily** epoch is a single
  `setText`/`setData` call/day — using the fork-measured `setText`-at-an-unregistered-name figure
  of **64,847 gas** (ENSV2_ONCHAIN, `docs/ensv2/DELEGATION-PLAN.md`) as the concrete unit cost,
  the entire day's evidence-anchoring cost is that one figure, independent of whether the day
  carried 1,000 receipts or 1,000,000. Gas is **decoupled from receipt volume** by design — the
  Merkle root is computed off-chain (BACKEND_POLICY or GRAPH_EVIDENCE); only the 32-byte root
  itself is written on-chain, on a schedule the merchant or operator controls (hourly instead of
  daily multiplies the write count by at most 24, not by the receipt count).
- **Lookup.** A client fetches the day's root from the epoch name, and a Merkle proof (a handful
  of hashes) from wherever proofs are served — BACKEND_POLICY, GRAPH_EVIDENCE, or the merchant's
  own service record (Model D) can all serve the same proof without being trusted for its
  correctness, since the client checks it against the on-chain root itself.
- **Proof.** **The strongest of the five models for durable, ENS-anchored evidence
  specifically**, because the commitment is written on-chain as a genuine transaction — an
  `EACRolesChanged`/`TextChanged`-shaped **event**, immutable once mined, independent of whatever
  the resolver's *current* record shows later (`NAMESPACE.md` §5's same event-vs-state
  distinction, applied here to receipts instead of role grants). Even if the epoch name's
  resolver is later changed or the parent revoked, the historical event committing that day's
  root remains readable from chain history by anyone running an archive node or an indexer —
  which is precisely the property Models B/C/D do not have, since all three depend on a live
  resolver, gateway, or service staying up and honest.
- **Leak.** A 32-byte root reveals nothing about individual receipts by itself (a hash is opaque
  by construction) — but the mere existence of one write **per epoch** is itself a coarse,
  low-resolution timing signal (a merchant that stops writing epochs has gone quiet, or changed
  cadence), a far smaller leak than Model A's per-receipt write cadence and arguably smaller than
  even Model D's, since Model D's endpoint is not an on-chain event at all.

**Verdict: layer this on top of Model D, only where a durable, ENS-anchored evidence trail
independent of the merchant's own uptime and honesty is specifically required** — a dispute, an
auditor who does not trust the merchant's own service, or a claim that must still be checkable
after the merchant's service goes offline. Not needed for ordinary discovery, where Model D
already answers the question more cheaply.

## 6. Cost and privacy arithmetic, compared

All gas figures are this repository's own measurements or explicitly labelled floors/estimates —
none are invented. Volumes are `docs/unica-v5/ens/SCALABILITY.md` §4's own scenario (1,000,000
receipts/day); the two Ethereum network figures (60,000,000 gas/block, ~432,000,000,000 gas/day
at ~7,200 blocks/day) are COMMUNITY, trade-press-reported (§8).

| Model | On-chain writes/day at 1M receipts/day | Gas/day (this scenario) | % of daily network gas capacity | Proof strength | New leak surface beyond an opaque label |
|---|---|---|---|---|---|
| A — per-receipt name | 1,000,000 | ≥44,339,000,000 (measured floor; real registration cost UNKNOWN and higher) | ≥~10% (floor only) | No stronger than the underlying event | Write-cadence-as-volume-signal, per-receipt |
| B — wildcard-derived resolve | 0 | 0 | 0% | As strong as the on-chain call it makes | None beyond the read itself (unobservable on-chain) |
| C — CCIP-Read, authenticated | 0 (gateway is off-chain) | 0 | 0% | Signed: gateway-operator-bound. Proof-backed: state-root-bound | Gateway sees every query in the clear (IP/wallet fingerprinting, per EIP-3668's own security section) |
| D — merchant service record | 0 (record already exists on the merchant name for another reason) | 0 | 0% | Deliberately weak at the ENS layer; funds-critical facts come from the chain directly, never the record | Narrowest — identifier only travels over a query the client chooses to make |
| E — epoch commitment root | 1 (daily) to 24 (hourly) | 64,847 to 1,556,328 (measured unit cost × epoch count) | ~0.00002% | Strongest durable, ENS-anchored evidence of the five — survives resolver/parent change via chain history | Coarse per-epoch cadence signal only; root itself reveals nothing |

## 7. Recommendation — the smallest model

**PROPOSED.** Model D (merchant service record, reusing the graph stream's own subgraph as the
answer engine) as the default for ordinary receipt discovery — it needs no new ENS hierarchy
level, no new resolver logic, and no new infrastructure beyond what `docs/unica-v5/graph/`
already recommends building for an unrelated reason. Model B (wildcard-derived live resolve) as
an optional complement wherever a payer specifically wants an ENS-shaped name to type or embed
in a QR code rather than call an API directly — it costs nothing extra and needs no separate
service. Model E (epoch commitment root) layered on top of either, **only** where a durable,
on-chain-anchored evidence trail independent of the merchant's own service uptime is a real
requirement (disputes, third-party audit), because it is the one model whose evidence survives a
later resolver or parent change by virtue of being a mined event, not a live answer. Model A
(one name per receipt) is rejected outright on gas grounds (§1, §6). Model C (full CCIP-Read
with a signed or proof-backed gateway) is the correct **next** step only once UNICA settlement
data is not already cheaply, synchronously readable by an L1 resolver call — cross-chain receipts
being the concrete future case, not a demonstrated present one.

This recommendation composes directly with `NAMESPACE.md` §9's tree: it adds **zero** new nodes
to that hierarchy. The merchant root already carries a service/text record slot (§2's "records
exposed" row); Model D spends one of those slots. No `receipt.` level is added anywhere.

## 8. Sources

| URL | Retrieved | Author/Org | Kind | Used for |
|---|---|---|---|---|
| https://docs.ens.domains/ensip/10 | 2026-09-11 | ENS (nick.eth, 0age) | OFFICIAL | Wildcard resolution / `resolve()` mechanics underlying Model B |
| https://eips.ethereum.org/EIPS/eip-3668 | 2026-09-11 | Ethereum (EIP authors) | OFFICIAL | CCIP-Read `OffchainLookup` mechanism, gas-outside-normal-metering statement, fingerprinting security consideration (Model C) |
| https://docs.ens.domains/resolvers/ccip-read/ | 2026-09-11 | ENS | OFFICIAL | Offchain/L2 resolver architecture, the signed-vs-proof-backed trust tradeoff quoted verbatim in §3, the `jesse.base.eth` production example |
| https://docs.ens.domains/web/enumerate/ | 2026-09-11 | ENS | OFFICIAL | "ENS names cannot be enumerated directly on-chain... the subgraph indexes all events" — the basis for Model A/B's enumeration-leak comparison |
| `docs/ensv2/DELEGATION-PLAN.md` | 2026-09-11 | this repository | TEAM GUIDANCE | Measured `setText` (64,847 gas) and role-grant/revoke gas figures reused as unit costs in §5/§6 |
| `integrations/ensv2/ENS-OWNER-ACTION.md` | 2026-09-11 | this repository | TEAM GUIDANCE | Live-measured `setAddr` (44,339 gas) used as the explicit floor in §1/§6 |
| `docs/unica-v5/graph/SCALABILITY.md` | 2026-09-11 | this repository (sibling stream) | TEAM GUIDANCE | The 1,000,000-receipts/day scenario reused here (§0, §6); the subgraph this document's Model D proposes reusing rather than duplicating |
| www.theblock.co, "ENS Labs scraps Namechain L2, shifts ENSv2 fully to Ethereum mainnet" | 2026-09-11 (event dated 2026-02-06) | The Block (trade press), reporting Nick Johnson (ENS co-founder) | COMMUNITY | 60,000,000 gas/block figure and the 30M→60M 2025 gas-limit increase, used in §1/§6's Model A network-capacity comparison |

## 9. Unknowns

1. **The real gas cost of registering a name (not merely writing a record on an existing one) is
   UNKNOWN in this repository's own measurements** (carried from `NAMESPACE.md` §12.1). Model A's
   §1/§6 figures are an explicit, labelled **floor** using the cheapest measured write available,
   not an estimate of an actual registration transaction, which would be higher.
2. **No CCIP-Read gateway, signed or proof-backed, has been built or evaluated by this
   repository.** Model C's trust-tradeoff description (§3) is drawn entirely from the official
   EIP-3668 and ENS CCIP-Read pages, never from a first-party measurement.
3. **Whether The Graph's own query-cost economics (`docs/unica-v5/graph/SCALABILITY.md` §1's
   Scenario B/C dollar estimates, sibling stream) already price in Model D's expected receipt-
   lookup query volume, or whether Model D adds meaningfully to that volume beyond what the graph
   stream already assumed, was not reconciled between the two documents** — this document treats
   them as additive but does not re-derive the graph stream's own numbers.
4. **The exact schedule (daily vs. hourly vs. some other epoch) for Model E is not fixed here** —
   §6's arithmetic gives both endpoints (1/day, 24/day) to show the tradeoff shape, not a
   recommended cadence; that choice depends on how quickly a merchant needs a dispute answerable
   against a committed root, which is a merchant-facing product decision, not an ENS-engineering
   one.
5. **No transcript of any ENS channel discussion reached this document.** The "epoch subnames
   carrying a commitment root" and "CCIP-Read backed by authenticated evidence" framings were
   given directly in this stream's own assignment; nothing here attributes their origin to an
   unavailable discussion, and no additional peer idea beyond the assignment's own five named
   models is claimed to come from one.
