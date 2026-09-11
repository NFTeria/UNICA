# UNICA v5 ENS — indexed evidence composition

Status: DRAFT, research and architecture only. Nothing here is committed, deployed, or published.
No subgraph is deployed; no account or infrastructure spend is authorized. This document cites the
sibling `docs/unica-v5/graph/` stream where it applies and edits none of it.

Labels: **VERIFIED**, **PROPOSED**, **DOCUMENTED_NOT_OBSERVED**, **UNKNOWN**. Authority labels:
**ENSV2_ONCHAIN**, **UNICA_ONCHAIN**, **BACKEND_POLICY**, **GRAPH_EVIDENCE**,
**CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION**.

## 1. Sources

| # | Source | Author/org | Kind | Retrieved | Used for |
|---|---|---|---|---|---|
| S1 | `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` (sibling stream, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The full entity catalogue this document composes with: `ENSMerchantName`, `NormalizedName`, `Namehash`, `MerchantIdentity`, `ResolvedAddress`, `Resolver`, `AvatarRecord`, `ArtSeed`, `RendererDeployment`, `RendererVersion`, `MetadataVersion`, `IdentityNFT`, `Token`, `IdentityBindingObservation`, `IdentityMismatch`, `Anomaly` |
| S2 | `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` (sibling stream, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The settlement-side entity catalogue this document joins to: `Market`, `Order`, `Settlement`, `HookReceipt`, `ExecutorReceipt`, `Registry`, `RoleChange`, and the id/reorg/finality conventions (§4.0) reused verbatim below |
| S3 | `docs/unica-v4/EVENT-SCHEMA.md` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | §2's "current state is not history... an indexer never supplies current status" rule and the emitter-authentication rule, both restated here for the ENS-identity layer |
| S4 | `docs/unica-v5/ens/RECORDS.md`, `PAYMENT-BINDING.md`, `POS-TERMINALS.md`, `AGENT-IDENTITY.md` (this stream) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The record keys, revocation timelines, and terminal/agent lifecycles this document's entity catalogue must be able to cover as evidence |
| S5 | `docs.ens.domains/ensv2/permissioned-resolver` | ENS | OFFICIAL | 2026-09-11 | The full record-change event list (`TextChanged`, `AddrChanged`, `AddressChanged`, etc.) and the naming events (`NamedResource`, `NamedTextResource`, etc.) an indexer would subscribe to |
| S6 | `thegraph.com/docs/en/subgraphs/developing/creating/ql-schema/` (re-cited from S1's own S7) | The Graph | OFFICIAL | 2026-09-11 (sibling document's retrieval) | `@entity(immutable: true)` semantics, `@derivedFrom`, `Bytes!`-preferred ids — reused verbatim, not independently re-fetched for this document |
| S7 | `docs/unica-v5/graph/PRIZE-FIT.md` (sibling stream, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The load-bearing, fail-closed design rule this document's §5 restates: "an indexing failure must never create, authorize, or settle a payment" and "any UNKNOWN fails closed for value-moving behaviour" |

## 2. The rule this entire document restates

**An indexer is evidence, never authority.** Every entity in §4 answers "what was observed, at
which block" — never "what is currently authorized" and never "what should happen next." This is
the same rule `docs/unica-v4/EVENT-SCHEMA.md` §2 (S3) states for settlement ("Current state is not
history... An indexer never supplies current status, and its lag is shown") and the same rule
`ENS-NFT-SCHEMA.md` (S1) states for identity ("an indexing failure must never create, authorize, or
settle a payment, or be read as proof that a name owns a payout address"). This document adds
nothing to that rule; it applies it to the specific surfaces the assignment names — merchant
roots, terminal and agent subnames, resolver deployments, grants and revocations, identity NFTs,
renderer versions, record changes, market bindings, receipts, and historical identity snapshots —
and states, for each, exactly what GRAPH_EVIDENCE can and cannot claim.

## 3. What the indexer must cover

### 3.1 Merchant roots

**Coverage.** The merchant's own ENS name: its normalized form, namehash, resolver history, and
currently-resolved address, exactly as `MerchantIdentity`/`ResolvedAddress`/`Resolver` already
model (S1 §4.5, §5). **What it is evidence of:** which address a name resolved to, at which block.
**What it is never evidence of:** which address a name resolves to *right now* — a query answers as
of the indexer's last-processed block, always shown beside that block number (S2 §4.0's finality
convention, reused). **The wildcard trap, restated once more:** an unregistered subname under a
wildcard parent resolves successfully to the zero address without reverting (S1 §4.5's own carried-
forward note); the indexer records this as-is and does not attempt to classify it as
"unregistered" vs. "explicitly zeroed" — that classification needs a live text-record cross-check
the indexer does not perform.

### 3.2 Terminal and agent subnames

**Coverage.** Each terminal or agent leaf (`POS-TERMINALS.md`, `AGENT-IDENTITY.md`, S4) is a
`MerchantIdentity`-shaped row of its own (same entity type, §4 below extends S1's catalogue rather
than duplicating it under a new name) — its own namehash, its own resolver, its own record-change
history. **What it is evidence of:** that a given leaf existed, resolved a given way, and held
given text records, at given blocks. **What it is never evidence of:** that a terminal is currently
operable, or that an agent currently holds the authority its published records claim — both of
those are live BACKEND_POLICY/ENSV2_ONCHAIN facts (`POS-TERMINALS.md` §5, `AGENT-IDENTITY.md` §5),
never indexer facts. A `com.unica.terminal-status` or `com.unica.agent-policy` value the indexer
last saw is shown with its own block number, exactly like every other text-record history row.

### 3.3 Resolver deployments

**Coverage.** `Resolver` (S1 §5): one row per (resolver address, namehash) pair ever observed
serving a name, including the ERC-1967 implementation slot's contents when read — the same pattern
`integrations/ensv2/permissioned.mjs`'s live `readAuthorization` already performs by direct call,
now as an indexed history. **What it is evidence of:** which resolver contract, and which
implementation behind a proxy, served a name at a given block — directly useful for
`PAYMENT-BINDING.md` §4.7's "resolver replaced" row, where the indexer's own `Resolver` history is
exactly what lets a reader see *when* a replacement happened, after the fact. **What it is never
evidence of:** that a resolver replacement was authorized, benign, or expected — that judgment
belongs to whoever controls the name, not to the indexer.

### 3.4 Grants and revocations

**Coverage.** `IdentityBindingObservation` (S1 §5): one immutable row per EAC role-change or
record-change event, carrying the resource, the account, and the block — the indexed form of
exactly the events `integrations/ensv2/roles.mjs`'s live `authorizeTextRoles`/`planAgentRevoke`
calls emit, and of the naming events S5 lists (`NamedTextResource`, etc.). **What it is evidence
of:** that a specific account was granted or had revoked a specific role at a specific resource, at
a specific block — directly the evidence `POS-TERMINALS.md` §5 and `AGENT-IDENTITY.md` §5 point to
when they say a revoked terminal's or agent's past authority is indexable, permanently. **What it
is never evidence of:** the accept/refuse verdict of whether a grant or revocation was itself
*correct* — S1's own conclusion about `SettlementMerchant` applies unchanged here: a verdict needs
inputs (a supplied clock time, an off-chain policy) the indexer does not have, so no such verdict
field is proposed.

### 3.5 Identity NFTs and renderer versions

**Coverage.** `IdentityNFT`, `Token`, `RendererDeployment`, `RendererVersion`, `ArtSeed`,
`MetadataVersion` (S1 §5), unchanged from the sibling stream's design — this document adds no new
entity here, only confirms they are in scope for the ENS-identity indexer this file describes as a
whole. **What it is evidence of:** which seed, which renderer deployment, and which frozen
`tokenURI` a given token was minted with, and who currently owns it (S1 §4.2, §4.7–§4.8). **What it
is never evidence of:** that the referenced art is currently displayed at the `avatar` record, or
that owning the token proves anything about payment (`IdentityMismatch`, S1 §4.6; the payment-
history join rule, S1 §4.10 — restated in §5 below because it is the single sharpest place this
whole document's rule has to be enforced by schema design, not just by comment). **Status note:**
the entire art layer is SPECIFIED-NOT-BUILT (`docs/unica-v4/ENS-ART-LAYER.md` §1); every entity in
this subsection is SPECIFIED-NOT-BUILT as an indexed source today, exactly as S1 states.

### 3.6 Record changes

**Coverage.** `AvatarRecord` (S1 §5) generalizes directly to every text-record key this stream
defines (`RECORDS.md` §4–§6): one immutable row per `TextChanged` event on a given key, for a given
node, with a grammar-specific parse where one applies (the CAIP-22/29 parse for `avatar`; no
special parse needed for `com.unica.terminal-status`'s closed enumeration or
`com.unica.registry`'s CAIP-10 grammar, both of which can reuse the same "raw value plus a
parse-status field" shape S1 already specifies for `avatar`). **What it is evidence of:** the full,
timestamped history of every value a given key on a given node has ever held. **What it is never
evidence of:** the *current* authoritative value for anything a live contract or resolver call
would answer differently — `MerchantIdentity`'s own "current" fields are themselves explicitly a
projection of this history, never a second source of truth (S1 §4.5).

### 3.7 Market bindings

**Coverage.** The join named explicitly, never implicitly, exactly as S1 §4.10 and S2's `Market`/
`Order`/`Settlement` entities already specify: a UI MAY show settlements whose `recipient` equals
`MerchantIdentity.currentResolvedAddress` (or, for a historical settlement at block N, the
`ResolvedAddress` active at block N). **The join key is the address, resolved independently through
the ENS history — never the token's id or its current owner** (S1 §4.10, restated because it is
the rule §5 below exists to keep from being silently reintroduced by a future schema change).

### 3.8 Receipts

**Coverage.** `HookReceipt`, `ExecutorReceipt`, `Settlement` (S2 §4.15–§4.17) — this document adds
nothing new here; it is named in the assignment's coverage list because the ENS-identity layer's
own entities (`MerchantIdentity`, `AvatarRecord`, `IdentityNFT`) are the ones a UI joins *to*
receipts via the address/recipient key (§3.7), and that join's correctness depends on the
ENS-identity side's own entities being scoped exactly as S1 specifies — a looser identity model on
this side would weaken the settlement side's own emitter-authentication guarantees by association,
even though the settlement entities themselves are unchanged.

### 3.9 Historical identity snapshots

**Coverage.** "As of block N" for any identity fact is answered the same way S1 §4.5 already
answers it for a resolved address: the relevant history entity's row with the greatest
`blockNumber <= N` — an ordinary indexed query over immutable rows, no separate "as-of" machinery.
This applies uniformly to `ResolvedAddress`, `AvatarRecord`, `IdentityBindingObservation`, and
`Resolver` — every history entity in this catalogue is queryable "as of" any block a reader names,
which is precisely what lets `PAYMENT-BINDING.md`'s revocation-timeline rows (§4.1–§4.10 of that
document) be independently re-checked against indexed evidence after the fact, rather than trusted
from memory.

## 4. Entity catalogue (ENS-identity layer, joined to the sibling schemas)

This document does not repeat S1's full GraphQL entity definitions — they are read, cited, and
unedited (see file header). It states the **join surface** between S1's identity entities and S2's
settlement entities, which is the one thing neither sibling document owns on its own:

| Join | From | To | Key | Cardinality | Authority label of the join itself |
|---|---|---|---|---|---|
| Merchant → settlements | `MerchantIdentity.currentResolvedAddress` (S1) | `Order.recipient` / `Settlement` (S2, via `Merchant.id`) | the resolved address, live or as-of-block (§3.7, §3.9) | one merchant identity to many settlements, over time as the address may change | GRAPH_EVIDENCE, address-keyed only, never NFT-keyed (S1 §4.10) |
| Terminal/agent leaf → its own grant history | `MerchantIdentity` (as the terminal/agent leaf, §3.2) | `IdentityBindingObservation` (S1 §5) | `identity` foreign key | one leaf to many grant/revoke rows over its lifetime | GRAPH_EVIDENCE |
| Avatar → identity art | `AvatarRecord.parsedContract/parsedTokenId` (S1) | `IdentityNFT` (S1) | `(contract, tokenId)` match | one avatar record to at most one matching `IdentityNFT` | GRAPH_EVIDENCE, advisory only (`IdentityMismatch`, S1 §4.6) |
| Resolver history → EAC authority reads | `Resolver.implementation` (S1) | (no stored settlement-side entity; a UI cross-checks this against a live `permissioned.mjs` read) | resolver address | n/a — this row is explicitly named as a non-join, to state that resolver *implementation* history is evidence of *what code ran*, never of *what it currently authorizes*, which needs a live read (§3.3) | CLIENT_VERIFICATION for the live half; GRAPH_EVIDENCE for the historical half only |

**No entity in this catalogue stores a foreign key from an identity-art entity to a settlement
entity, and none is proposed** — restated a third time in this document (after S1 §4.10 and this
file's §3.5, §3.7) because it is the join a naive schema design would add by convenience and it is
exactly the join that would let a reader mistake "owns the token" for "received the payment."

## 5. What the indexer must never be read as

- **Not a settlement authority.** No query result from any entity in §3–§4 ever creates, modifies,
  or authorizes a UNICA order or payment (S3, S7's own "an indexing failure must never create,
  authorize, or settle a payment").
- **Not a revocation authority.** A `com.unica.terminal-status`/`com.unica.agent-policy` history row
  showing `revoked` is evidence that a revocation was *published*; the actual authority-cutting
  action is the on-chain EAC revocation and the BACKEND_POLICY account disable
  (`POS-TERMINALS.md` §4.7, `AGENT-IDENTITY.md` §4.6) — restated because it is the specific
  instance of "GRAPH_EVIDENCE never authorizes" this stream's other documents most directly depend
  on getting right.
- **Not proof of payment via NFT ownership.** Restated a final time: owning an `IdentityNFT` proves
  nothing about receiving a payment; the only safe join is the resolved-address join in §3.7/§4,
  and only a UI copy discipline that says "settlements to the address this name currently resolves
  to" — never "this NFT's payments" — keeps that distinction visible to a reader (S1 §4.10).
- **Not current.** Every entity carries or is queryable alongside a block number; "any UNKNOWN
  fails closed for value-moving behaviour" (S7) applies transitively: if the indexer cannot answer
  a query (lag, malformed id, network error), the correct result is UNKNOWN, never a stale
  "probably still true" answer presented as current.

## 6. Unknowns

1. Whether a single subgraph indexes both the settlement layer (S2) and the ENS-identity layer
   (S1, this document) together, or two separate subgraphs joined client-side — S1 §1 scopes itself
   to "one stream of the UNICA v5 read layer" precisely to leave this open; this document does not
   resolve it either, since the join surface in §4 works identically either way (a client-side join
   on the resolved address, never a stored cross-subgraph foreign key).
2. Whether The Graph indexes ENSv2 Sepolia specifically (as opposed to Ethereum Sepolia generally,
   which S1's own S1-citation-of-thegraph.com confirms) with the exact contract addresses this
   stream's per-name Permissioned Resolver proxies would need as dynamic-template data sources —
   not independently verified here; `docs/unica-v5/graph/NETWORK-OPTIONS.md` (sibling stream, cited, not
   read in full for this document) is the more authoritative source for network-support questions
   and should be consulted directly rather than this document's own restatement.
3. Whether `com.unica.registry`'s CAIP-10-parsed value (`RECORDS.md` §6.2) is ever indexed as its
   own typed history entity (mirroring `AvatarRecord`'s parse-status pattern, §3.6) or left as an
   unparsed raw string in a generic text-record-history entity — a schema-design choice not made by
   this document.
4. The exact indexing lag and reorg-depth behavior for whatever chain UNICA's ENSv2 identity layer
   ultimately indexes — `SETTLEMENT-SCHEMA.md`'s own S9 finding (`ETHEREUM_REORG_THRESHOLD`,
   default 250 blocks) is cited as the only concrete number found for the settlement side; whether
   the same graph-node deployment and the same default would serve the identity side is assumed,
   not independently re-verified here.
5. The unverified leads carried from an unavailable sponsor-channel transcript (isolated
   deployment, Universal Resolver override, invalid old initialize/authorize interfaces, direct
   contract registration, MockUSDC vs. Circle USDC, manager UI failures) were not confirmed or
   refuted by this document's research and play no role in any entity or join above — see
   `RECORDS.md` §8 item 7.
