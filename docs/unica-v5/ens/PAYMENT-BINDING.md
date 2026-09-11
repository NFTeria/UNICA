# UNICA v5 ENS — payment binding and the required revocation table

Status: DRAFT, research and architecture only. Nothing here is committed, deployed, or written to
any name. No registry, resolver, proxy, or NFT is deployed; no name or subname is registered; no
MockUSDC is minted or approved; no key is signed or broadcast; no ENS record is changed. This file
never presents ENSv2 Sepolia beta behaviour as production ENS mainnet behaviour, and it never
implies that revoking an ENS record rewrites chain history.

**UNICA v4 contracts do not exist yet, restated once here rather than at every occurrence below.**
Every reference in this document to `createOrder`, `pay()`/`pay(orderId)`, `WrongPayer`,
`NotOrderCreator`, `MarketNotActive`, `ZeroRecipient`/`ReservedRecipient`, `_orders[orderId]`, and
`payoutUsedOnDay` names a function, check, or storage slot from UNICA v4's own **specification**
(`docs/unica-v4/SPEC-CONTRACTS.md`, S1) — **SPECIFIED-NOT-BUILT**: no v4 contract has been written,
compiled, or deployed, so none of these checks currently execute anywhere. Where this document says
a v4 check "refuses," "enforces," or is "a second, independent gate," that is a claim about what the
written specification requires a future contract to do, never an observation of a live gate that
exists today. The one exception, called out explicitly every time it appears, is `UnicaExecutorV3`
and its `Order.recipient` field — **V1 and V3 are deployed and real** on Ethereum Sepolia, and the
address-record non-redirection property in §2 below is measured against that deployed V3 contract,
not against any v4 code.

Labels: **VERIFIED**, **PROPOSED**, **DOCUMENTED_NOT_OBSERVED**, **UNKNOWN**,
**SPECIFIED-NOT-BUILT** (a v4 contract mechanism that is written in the specification and has no
deployed code). Authority labels:
**ENSV2_ONCHAIN** (ENSv2 Permissioned Resolver / Enhanced Access Control state), **UNICA_ONCHAIN**
(a UNICA settlement contract's own state), **BACKEND_POLICY** (UNICA's own off-chain backend/role
table), **GRAPH_EVIDENCE** (an indexer's derived, lagging view), **CLIENT_VERIFICATION** (a live
read the interface performs itself before acting), **OFFCHAIN_OPERATION** (an action with no
on-chain component, e.g. disabling a staff account).

## 1. Sources

| # | Source | Author/org | Kind | Retrieved | Used for |
|---|---|---|---|---|---|
| S1 | `docs/unica-v4/SPEC-CONTRACTS.md` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | §4 roles table, §5 lifecycle, §9.1 `pay()`'s `WrongPayer` check, §9.3 guard table |
| S2 | `docs/v2/SECURITY-ADVISORY-001.md` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The counterparty-binding failure mode, the required-fields list (payer, merchant, asset, amount, chain, verifying contract, order/nonce, expiry), and why an indexer must never authorize |
| S3 | `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | §8's own proof that changing an ENS address record cannot redirect an already-created order, restated here as the general rule |
| S4 | `integrations/ensv2/roles.mjs`, `permissioned.mjs` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The live delegation/revocation mechanism (`authorizeTextRoles` with `granted=false`), per-key resource scoping, and the `resourceNote` staleness warning for a validator reading the wrong resource |
| S5 | `docs/unica-v5/pos/PRIVY-DEVICE-MODEL.md` §6 (sibling stream, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The lost/stolen-device procedure's own ordering: disable in the backend first, independent of any token's remaining validity |
| S6 | `docs/unica-v4/EVENT-SCHEMA.md` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | §2's "current state is not history... an indexer never supplies current status" rule, reused for the indexing-lag rows below |
| S7 | `docs.ens.domains/ensv2/permissioned-resolver` | ENS | OFFICIAL | 2026-09-11 | Confirms `setText`/`authorizeTextRoles`-family writes take effect at the next block that includes them — no protocol-level propagation delay beyond ordinary chain finality; any further delay (RPC cache, CDN, client cache) is off-chain |
| S8 | `docs/unica-v5/ens/RECORDS.md` (this stream) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The specific record keys (`com.unica.terminal-status`, `com.unica.agent-policy`, `com.unica.registry`, etc.) whose revocation this file's table walks |

## 2. The non-negotiable boundary, restated as a design rule

For an existing market or order the payout address, token addresses, chain id, hook, executor,
amount, minimum output, and bound payer are fixed by UNICA's own contracts (UNICA_ONCHAIN) at the
moment the order is created and, more narrowly, at the moment a payer's authorization is checked.
ENS (ENSV2_ONCHAIN) may aid discovery **before** order creation; once an order exists, the resolved
identity is bound immutably.

**Two different things are true here, and this document keeps them separate rather than letting one
stand in for the other.** The address-record half is **already measured, empirically, against
deployed code**: `UnicaExecutorV3` is real and deployed on Ethereum Sepolia (V1 and V3 are deployed;
v4 is not), and S3's own §8 states plainly — "changing this record cannot redirect an existing
order's funds. It can only affect orders created *after* the change" — measured against five settled
V3 orders (§4.5 below quotes the same line in full). The mechanism half is different in kind:
restated from `docs/unica-v4/SPEC-CONTRACTS.md` §9.1 (S1), UNICA v4's own **specification** —
**SPECIFIED-NOT-BUILT**, no v4 contract exists — says `createOrder` snapshots `recipient`, `payer`,
`amountIn`, `minOut`, and `deadline` into storage, written once; `pay(orderId)` later checks
`msg.sender == order.payer` (`WrongPayer` otherwise) and settles against exactly those stored
values, and no function anywhere in the executor re-resolves an ENS name. This document carries that
mechanism forward on the strength of V3's already-measured behaviour under the identical design
pattern — the same non-redirection property, the same "resolve once, store, never re-read" shape —
not as a second, independent measurement of v4 code that has not been written. Until v4 is built and
its own address-record behaviour is separately measured, the non-redirection property below is
VERIFIED for V3 and PROPOSED (carried forward by design, not yet observed) for v4.

**Four consequences that hold in every row of §4 below, stated once here rather than repeated ten
times:**

1. **No market silently redirects.** A revocation, an address change, or a resolver replacement
   changes what a *future* resolution returns. It never reaches into `_orders[orderId]` storage.
2. **Existing orders and receipts do not change.** An `OrderCreated` or `Settled` log, and the
   storage it was decoded from, are exactly as immutable as any other mined Ethereum state.
3. **A new order requires a fresh readback.** The interface never reuses a resolution result from
   before the order it is about to create; `docs/unica-v5/pos/POS-FLOWS.md`'s own review screen
   (cited, not edited) already performs this re-read.
4. **The interface separates current resolution from the identity observed at settlement.** A
   dashboard or receipt view shows *what the order was bound to when created*, not *what the name
   resolves to now* — the two are different questions and this document never conflates them.

**Advisory 001's rule, carried over from settlement to identity (S2).** Advisory 001 found that a
V2 release candidate's payer-side authorization did not bind the counterparty's half of a deal,
letting a submitter redirect payment to themselves while the payer's own signature stayed
byte-for-byte valid. The lesson generalizes directly to ENS: **an authorization must bind payer,
merchant, asset, amount, chain, verifying contract, order/nonce, and expiry** (S2's own list), and
an ENS record is never one of the bound fields, because a bound field must be fixed at
authorization time and an ENS record can change after. UNKNOWN or stale identity information
**fails closed** for anything that moves value — never open, and never "probably fine."

## 3. What binds an order, and what ENS never touches

**SPECIFIED-NOT-BUILT.** Every field named in the left column and every check named beside it
(`WrongPayer` included) is UNICA v4's own specified interface (`docs/unica-v4/SPEC-CONTRACTS.md`
§9.1, S1); v4 has no deployed code. The pattern is carried forward from V3's already-deployed,
already-measured `UnicaExecutorV3.Order.recipient` (§2 above), not observed directly in v4.

| Bound at order creation (UNICA_ONCHAIN, immutable after) | Never re-derived from ENS after creation |
|---|---|
| `recipient` (the merchant's payout address) | Even if the merchant's ENS `addr` record changes |
| `payer` (`WrongPayer` enforced at `pay()`, SPECIFIED-NOT-BUILT) | Even if a terminal or agent subname is later revoked |
| `amountIn`, `minOut` | Even if a discovery/market-listing record changes its quoted price |
| `deadline` | Even if a terminal's `com.unica.terminal-status` record is set to `revoked` after creation |
| `hook`, `executor`, `poolId`, chain id (via the market's own identity) | Even if `com.unica.registry` is repointed to a different deployment |

ENS's role is confined to the column on the left existing at all: a name resolves to an address,
a terminal or agent subname is discovered and its scoped authority read, and the interface builds
an order-creation call from what it independently verified at that moment
(CLIENT_VERIFICATION). After that call lands, ENS has no further read path into the order.

## 4. Required revocation table

Each row states, per layer, what happens — never blending ENSV2_ONCHAIN, UNICA_ONCHAIN,
BACKEND_POLICY, GRAPH_EVIDENCE, CLIENT_VERIFICATION, and OFFCHAIN_OPERATION into one sentence.

### 4.1 Terminal revoked before order creation

| Layer | Effect |
|---|---|
| ENS resolution (ENSV2_ONCHAIN) | The terminal's `com.unica.terminal-status` (RECORDS.md §6.9) is set to `revoked` via `authorizeTextRoles(..., granted=false)` or a fresh `true` write of the new value, at the terminal's own per-key resource. Effective at the next block, no protocol-level delay (S7) |
| Backend order creation (BACKEND_POLICY) | The staff/device role table entry is disabled first (S5's own ordering: "this is what actually revokes access, independent of the Privy token's own remaining... validity"). A disabled terminal cannot reach the order-creation flow at all — this is the layer that actually stops anything, not the ENS record |
| Existing on-chain order | None exists yet — there is nothing to affect |
| Customer interface | Never reaches a payment screen; the terminal's own UI is locked out at the backend layer |
| Settlement contract (UNICA_ONCHAIN) | Untouched. `docs/unica-v4/SPEC-CONTRACTS.md` §9.1 (S1) **specifies** that `createOrder`'s own `NotOrderCreator` check would additionally refuse the call if the terminal's operating key was ever removed from the on-chain order-creator allowlist — **SPECIFIED-NOT-BUILT**: no v4 contract exists to run this check today, so it is not a live backstop, only a written requirement for the contract v4 will eventually be. The backend disable in the row above is the only gate that actually exists and actually stops anything right now |
| Indexer (GRAPH_EVIDENCE) | Nothing to index; no order-creation attempt reached the chain |
| Historical receipt | None exists |

### 4.2 After an unsigned order

*("An unsigned order" — an order that exists on-chain (`OrderCreated` fired) but the payer has not
yet called `pay()`.)*

| Layer | Effect |
|---|---|
| ENS resolution | Any of the terminal's, agent's, or merchant's records may change or be revoked from this point forward; none of it touches the order |
| Backend order creation | Irrelevant now — creation already happened; a later revocation only prevents *future* `createOrder` calls |
| Existing on-chain order | `_orders[orderId]` (SPECIFIED-NOT-BUILT for v4; the deployed analogue is V3's `Order` struct on `UnicaExecutorV3`) is specified to hold `recipient`, `payer`, `amountIn`, `minOut`, `deadline` (S1 §9.1) — fixed, unaffected by any ENS change |
| Customer interface | The payer's own review screen, if it re-resolves the merchant name for display, may now show a *different* current resolution than what the order was created against — this is exactly the "current resolution vs. identity observed at settlement" distinction (§2 item 4); the interface MUST show the order's own bound `recipient`, never re-substitute a fresh resolution into the payment screen |
| Settlement contract | `pay(orderId)` (SPECIFIED-NOT-BUILT for v4) is specified to still check only `msg.sender == order.payer`, unrelated to any ENS record; the payer can still pay the address the order actually names, exactly as created |
| Indexer | `OrderCreated` was indexed at creation; nothing changes about that entity |
| Historical receipt | None yet — no `Settled` has fired |

### 4.3 After customer authorization but before settlement

*(A signed authorization exists off-chain, or a `pay()` transaction is pending in the mempool, but
has not yet been mined.)*

| Layer | Effect |
|---|---|
| ENS resolution | Irrelevant to the pending transaction — the calldata was already built from the order's stored values, not from a live ENS read at this moment |
| Backend order creation | N/A — creation already happened |
| Existing on-chain order | Status is `Open`, about to transition to `Paying`; unaffected by any ENS change during this window |
| Customer interface | Should show a "processing" state; per Advisory 001's own lesson (S2), the pending transaction's binding was fixed when the payer signed / submitted it — nothing an ENS record does in this window can widen or narrow what that transaction settles |
| Settlement contract | `pay()` (SPECIFIED-NOT-BUILT for v4) is specified in `docs/unica-v4/SPEC-CONTRACTS.md` §9.1 to execute its checks against on-chain state only; no ENS call exists anywhere in the specified executor or hook |
| Indexer | Nothing indexed yet for this attempt |
| Historical receipt | None yet |

### 4.4 During settlement

*(The `pay()` transaction is executing: input pull, swap, receipt, delivery, `Settled` — one
transaction, per `docs/unica-v4/EVENT-SCHEMA.md` §8's fixed log order. Every row below is
**SPECIFIED-NOT-BUILT**: it describes what the v4 specification requires, not an observation of a
mined v4 transaction, since v4 has no deployed code.)*

| Layer | Effect |
|---|---|
| ENS resolution | No ENS call is specified to occur inside a UNICA v4 contract at any point — restated because it is the load-bearing fact behind every other row: `web/ensv2/resolve.mjs`'s resolution path is a client-side, pre-order concern only, never an on-chain dependency of the specified `pay()` |
| Backend order creation | N/A |
| Existing on-chain order | Specified (S1 §9.1) to transition `Open` → `Paying` → `Settled` within one transaction; no revocation anywhere could interrupt a transaction already included in a block, once v4 exists to mine one |
| Customer interface | Waiting on the transaction receipt; nothing to do with ENS |
| Settlement contract | Specified to execute atomically; a revocation broadcast in a later block would not reach back into this transaction, once v4 exists to enforce it |
| Indexer | Will index `SettlementReceipt` and `Settled` once mined; not yet, mid-transaction |
| Historical receipt | Created at the end of this transaction, immutable from that point |

### 4.5 After settlement

| Layer | Effect |
|---|---|
| ENS resolution | Free to change from this point on — a merchant may rotate their payout address, revoke a terminal, or replace their resolver with no effect on what already happened |
| Backend order creation | N/A |
| Existing on-chain order | `status = Settled`, terminal state, never reopened |
| Customer interface | Shows the receipt from the mined `SettlementReceipt`/`Settled` pair (S1, `docs/unica-v4/EVENT-SCHEMA.md` §5–§6); a later ENS change never edits this display's underlying facts |
| Settlement contract | Nothing further to do for this order; `payoutUsedOnDay` (SPECIFIED-NOT-BUILT for v4) is specified to already be accounted (S1 §9.2) |
| Indexer | `Settlement`/`HookReceipt`/`ExecutorReceipt` entities (per `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` §4.15–§4.17, cited, not edited) are immutable once both paired events are observed |
| Historical receipt | Permanent. Restated from `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §8 (S3): "the five settled V3 orders on Sepolia keep the recipient they were created with, whatever `unica.eth` resolves to afterwards" — **VERIFIED for V3**, deployed and real; **PROPOSED, not yet measured,** as the same property for v4, which has no deployed code to observe it on |

### 4.6 Merchant root revoked

*(The merchant's own name's ownership, controller role, or every EAC role at `ROOT_RESOURCE` is
removed or transferred away — the most severe identity-layer event this table covers.)*

| Layer | Effect |
|---|---|
| ENS resolution | Future resolutions of the merchant's name may return a different address, or none, depending on what the new controller (if any) sets. `readAuthorization` (S4) would show a different or empty `authorized` list at the next read |
| Backend order creation | If the merchant's own backend/creator-allowlist entry is independently revoked (an OFFCHAIN_OPERATION, not an ENS effect), new order creation stops; the two are separate systems and one does not imply the other — a root-revoked ENS name does not, by itself, disable the on-chain order-creator allowlist, which is a UNICA_ONCHAIN fact this document does not conflate with ENS state |
| Existing on-chain order | Any order already created keeps its stored `recipient`, exactly as §4.5 — a root revocation, however severe at the ENS layer, cannot reach `_orders[orderId]` storage (SPECIFIED-NOT-BUILT for v4; the deployed analogue is V3's own order storage) |
| Customer interface | A checkout attempting a **new** order against this name would see the changed resolution at its next live read and refuse or warn, per `web/ensv2/resolve.mjs`'s classified failure shapes (e.g. `ZERO_ADDRESS` if the new state resolves nothing) |
| Settlement contract | Untouched for existing orders; a **new** order naming this merchant's now-unresolved address is specified to fail `createOrder`'s own `ZeroRecipient`/`ReservedRecipient` checks (SPECIFIED-NOT-BUILT for v4 — no such contract exists to run this check) if the interface tried to build one from a broken resolution — but the interface should refuse before ever reaching that call, per its own fail-closed resolution classification, since the v4 check itself is not yet a live backstop |
| Indexer | Would index whatever EAC role-change events fired (`IdentityBindingObservation` in `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §5, cited), as evidence a root event occurred — never as the authority that it occurred, per §5 of that document's own rule |
| Historical receipt | Permanent, unaffected |

### 4.7 Resolver replaced

*(The name's Permissioned Resolver proxy is swapped for a different implementation, or the name is
pointed at an entirely different resolver — a rarer event than a record write, but one ENSv2's own
architecture permits.)*

| Layer | Effect |
|---|---|
| ENS resolution | The Universal Resolver (`web/ensv2/resolve.mjs`) follows whatever the registry currently names as the resolver for that name — a fresh resolution picks up the new resolver automatically, per the wildcard/registry-driven design already measured in this repository (`integrations/ensv2/README.md`) |
| Backend order creation | Unaffected directly; if the new resolver behaves differently (e.g. answers `NOT_A_PERMISSIONED_RESOLVER`, per `integrations/ensv2/ENS-OWNER-ACTION.md`'s own status enum), any EAC-scoped delegation (terminal/agent) tied to the *old* resolver's roles is void — a role bitmap is state on a specific resolver contract, not a portable property of the name |
| Existing on-chain order | Untouched, same as every row above — this is the property that holds no matter what happens at the ENS layer |
| Customer interface | A fresh resolution before a **new** order picks up the new resolver's answer; if that answer is `NOT_A_PERMISSIONED_RESOLVER` or otherwise unexpected, the interface refuses to proceed with any EAC-dependent feature (delegation status, per-key checks) rather than guessing |
| Settlement contract | Untouched |
| Indexer | A resolver-replacement event (however the new resolver signals it, or its absence if the change is silent) is exactly the kind of `Anomaly` row `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §5's `Anomaly` entity and `docs/unica-v4/EVENT-SCHEMA.md` §10.2's "anomalies are shown, never dropped" rule exist for |
| Historical receipt | Permanent, unaffected. Every prior `ResolvedAddress`/`AvatarRecord`-style history row (if ever indexed, per `ENS-NFT-SCHEMA.md` §5) stays exactly as it was recorded — a resolver swap does not rewrite the *history* of what the old resolver answered, only what a *future* query returns |

### 4.8 Agent endpoint changed

*(A `com.unica.agent-policy` pointer or an ENSIP-26 `agent-endpoint[<protocol>]` record, RECORDS.md
§5.3/§6.10, is updated to a new URL.)*

| Layer | Effect |
|---|---|
| ENS resolution | The new URL is what a fresh `agent-endpoint`/`agent-policy` read returns from the next block onward; the old value is only visible in history if an indexer captured it (§ GRAPH-COMPOSITION.md §3.6) |
| Backend order creation | Unaffected — an agent's endpoint is a discovery/description surface, never a component of order-creation authority (`AGENT-IDENTITY.md` §4 of this stream states the agent's actual authority is EAC-scoped `SET_TEXT`, never order creation) |
| Existing on-chain order | Untouched |
| Customer interface | If the interface already had the old endpoint open mid-visit, it should treat the change as a normal cache-expiry event (RECORDS.md's stated TTLs) rather than an alarm; nothing about payment correctness depends on which endpoint answers |
| Settlement contract | Untouched — no contract reads this record |
| Indexer | A new `AvatarRecord`/text-record-history-style row, per `ENS-NFT-SCHEMA.md`'s own event-history entity pattern, if this class of key is ever indexed |
| Historical receipt | Unaffected |

### 4.9 Parent registry paused or abandoned

*(The UNICA `UnicaMarketRegistry` a merchant's `com.unica.registry` record points at is `pause`d,
or the operator abandons it entirely — a UNICA_ONCHAIN event, included here because it interacts
directly with ENS-layer discovery.)*

| Layer | Effect |
|---|---|
| ENS resolution | The `com.unica.registry` record itself does not change merely because the registry it points at is paused — the pointer is still technically valid; what changes is what the pointed-to contract *reports* |
| Backend order creation | A backend that checks live registry status before letting a terminal create an order sees `MarketPause`'s effect (`MarketStatusChanged` to `PAUSED`, S1 §5 row 5) and refuses; a backend that trusts a cached "market is active" fact without a fresh on-chain read does not, which is exactly the staleness risk this table exists to name |
| Existing on-chain order | Specified by `docs/unica-v4/SPEC-CONTRACTS.md` §5 (SPECIFIED-NOT-BUILT for v4): "Open orders survive a pause and are payable after unpause if unexpired, never on a RETIRED market" — a pause is specified not to void an already-open order, only to block *new* order creation and swaps while paused |
| Customer interface | Should show the live `oracleCondition()`/status view (S1 §8.2) rather than a cached "active" state before allowing a new payment attempt |
| Settlement contract | `MarketNotActive` is **specified** to refuse both `createOrder` and `pay` while paused (S1 §5, §9.1) — **SPECIFIED-NOT-BUILT**: no v4 contract exists to enforce this on-chain today, so this row is a requirement on the contract v4 will eventually be, not a live enforcement a design can rely on as a backstop right now |
| Indexer | `MarketPause` (`docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` §4.19, cited) records the transition as evidence; per that document's own repeated warning, "a `MarketPause` row proves a pause transition was indexed at some past block; it never proves the market is paused right now" |
| Historical receipt | Unaffected — settled history stands regardless of the registry's current status |

### 4.10 Revocation not yet indexed

*(The most common real-world state: a revocation transaction is mined and final, but the indexer
serving `com.unica.graph-endpoint` has not yet processed that block.)*

| Layer | Effect |
|---|---|
| ENS resolution | Already reflects the revocation — a live `eth_call`/resolver read against the current chain state returns the new, revoked value the moment the block is mined; ENS resolution has no separate "indexing" step of its own beyond ordinary chain state |
| Backend order creation | Any backend performing a **live** on-chain check (not a cached graph query) sees the revocation immediately; a backend that only consults the lagging indexer does not, until the indexer catches up |
| Existing on-chain order | Unaffected either way, per every row above |
| Customer interface | Per `docs/unica-v4/EVENT-SCHEMA.md` §2 (S6): "Current state is not history... An indexer never supplies current status, and its lag is shown." Any UI surfacing revocation status for an *active decision* (should this terminal be trusted right now) MUST use a live read (CLIENT_VERIFICATION/BACKEND_POLICY), never the indexer, and any indexer-sourced display MUST show its own lag (`_meta.block`, per `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` §4.0's finality-status convention) |
| Settlement contract | Enforces the current on-chain state regardless of what any indexer has processed — this is the one layer that is never lagging relative to itself |
| Indexer | GRAPH_EVIDENCE: will eventually process the revocation event and update its own entities; until then it reports the pre-revocation state, correctly labelled as lagging, never presented as current |
| Historical receipt | Unaffected |

## 5. Cross-cutting rules that hold across every row

- **ENS never authorizes settlement.** No row above has ENS resolution or an EAC role grant/revoke
  itself creating, modifying, or cancelling a UNICA order or a `pay()` call. It only changes what a
  *future*, independent resolution or authority read returns.
- **An indexer never authorizes settlement.** Restated from `docs/unica-v4/EVENT-SCHEMA.md` §2
  (S6): GRAPH_EVIDENCE rows in every table above are evidence, never the gate that lets an action
  proceed.
- **UNKNOWN fails closed.** Where a layer cannot determine current status — an unreachable
  resolver, an indexer that has not caught up, a backend that cannot reach its own database — the
  correct behaviour is to refuse or warn, never to assume the more permissive state (active, not
  revoked, not paused).
- **A revocation is never presented as rewriting history.** Every "existing on-chain order" and
  "historical receipt" cell above says the same thing for a reason: nothing in this design ever
  implies that revoking an ENS record, a role grant, or an endpoint changes a transaction that
  already happened. Advisory 001's central lesson (S2) — bind everything that matters at
  authorization time, because anything left unbound can be substituted later — is the same lesson
  in reverse: nothing bound at authorization time can be un-bound by a later, unrelated event.

## 6. Unknowns

1. Whether UNICA's backend (BACKEND_POLICY) will, in practice, always perform a live on-chain
   check before honoring a cached "active" status for a terminal or market, or will sometimes rely
   on cached/indexed state for latency reasons — an implementation decision not made by this
   document, and the exact latency budget for a live check is not specified anywhere read for this
   file.
2. Whether ENSv2's Permissioned Resolver enforces any block-level reorg-safety guarantee beyond
   ordinary chain finality for a role revocation — not stated by S7; this document assumes ordinary
   finality risk (a revocation could theoretically be reorged out, exactly like any other
   transaction) and does not claim a stronger guarantee.
3. The precise latency between an on-chain revocation and any CDN or client-side cache in front of
   an RPC endpoint used for resolution — an infrastructure detail outside ENS's own protocol and
   outside this document's scope, but relevant to how tight the "not yet indexed"/staleness window
   in §4.10 actually is in practice.
4. Whether a future UNICA v4 registry-side "pause propagates to a discovery record" convenience
   (e.g. automatically writing `com.unica.terminal-status = maintenance` when a market pauses) is
   ever built — no such automation exists or is proposed here; §4.9's table treats the ENS record
   and the on-chain pause as two independently-updated facts precisely because no such automation
   is assumed.
5. The unverified leads carried from an unavailable sponsor-channel transcript (isolated
   deployment, Universal Resolver override, invalid old initialize/authorize interfaces, direct
   contract registration, MockUSDC vs. Circle USDC, manager UI failures) were not confirmed or
   refuted by this document's research and are not reflected in any row above — see `RECORDS.md`
   §8 item 7 for the same statement made
   once, not repeated per document.
