# UNICA v5 — ENS: peer pattern catalogue and comparison

Status: complete draft. Retrieval date for every source below is 2026-09-11 unless a row states
otherwise. Track: FROM SCRATCH (owner-confirmed 2026-09-11); no prior UNICA codebase is a
dependency of this document and nothing is copied into this repository from any prior project or
from ENS's own implementation source.

## 0. No channel transcript was supplied

No ENS channel discussion transcript reached this document. Nothing below attributes an idea, a
claim, or a design choice to that discussion. Every pattern in the catalogue is built from
official ENS documentation, the ENSIPs, and public project pages cited in place, or is marked
UNKNOWN. Any claim in the originating brief that traces to that missing transcript is treated as
an UNVERIFIED LEAD and checked against official sources rather than repeated as fact.

## 1. Method

- Sources: current docs.ens.domains, the ENSIP index at docs.ens.domains/ensip, the official ENS
  blog at ens.domains/blog, ens.domains/ecosystem pages, the ENS DAO governance forum
  (discuss.ens.domains, COMMUNITY — a forum post is not a ratified ENSIP), and public project
  pages for pattern examples.
- Every ENSIP number named in the originating brief is checked against the official index before
  it is used. A number that does not exist, or names a different subject than the brief assumed,
  is reported as such in Section 4 rather than silently repeated.
- Every material claim below carries a label: VERIFIED (source cited), PROPOSED (UNICA design,
  not yet built), DOCUMENTED_NOT_OBSERVED (written in a spec or in this repository's own notes,
  not exercised against a live, adversarial call on any chain), or UNKNOWN.
- This repository's own ENSv2 findings (`integrations/ensv2/`, `docs/ensv2/UNICA-ETH-ADDR-REPORT.md`)
  are cited as TEAM GUIDANCE / first-party measurement — a different tier of evidence from ENS's
  own documentation, and named as such every time it is used.
- No ENS implementation source is read as code and none is copied. `ensdomains/contracts-v2`
  publishes no licence (recorded already in `integrations/ensv2/README.md`), so nothing from it
  is transcribed here; every mechanism below is described in prose from the documentation.
- Budget: 25 web fetches were allotted for this pair of documents; a source that failed to load
  after one retry is marked UNREAD in Section 6 rather than guessed at. None did — every URL
  fetched below returned content on the first attempt.

## 2. ENSIP index check

The official index (`docs.ens.domains/ensip`, OFFICIAL, retrieved 2026-09-11) currently lists
ENSIP-1 through ENSIP-28. The table below is the subset this catalogue draws on, with status as
published. **VERIFIED** for every row — this is a direct read of the index page, not an inference.

| ENSIP | Title (exact) | Status |
|---|---|---|
| 1 | ENS | Final |
| 3 | Reverse Resolution | Final |
| 5 | Text Records | Final |
| 9 | Multichain Address Resolution | Final |
| 10 | Wildcard Resolution | Final |
| 11 | EVM compatible Chain Address Resolution | Final |
| 12 | Avatar Text Records | Final |
| 13 | SAFE Authentication For ENS | Draft |
| 18 | Profile Text Records | Draft |
| 19 | Multichain Primary Names | Final |
| 21 | Batch Gateway Offchain Lookup Protocol | Draft |
| 25 | AI Agent Registry ENS Name Verification | Draft |
| 26 | Agent Text Records | Draft |
| 27 | Node Classification and Metadata | Draft |
| 28 | ENS Name Owned Accounts | Draft |

No ENSIP-29 or higher appeared on the index at retrieval time. Every ENSIP used as "required
ENSv2 feature" or as a pattern's mechanism in Section 3 is one of the rows above, checked against
this table rather than assumed from the brief's numbering.

## 3. Pattern catalogue

Columns, abbreviated for table width, with the full reasoning and citation for each row in the
subsection that follows it: **Str** = strength, **Weak** = weakness, **Central?** = does the
pattern make ENS central to the product or could it be swapped out losslessly, **UNICA** =
relevance to UNICA, **ENSv2 feature** = the ENSv2 (or ENSv1) feature the pattern needs, **Risk** =
implementation risk.

| # | Pattern | Central? | ENSv2 feature required | Risk |
|---|---|---|---|---|
| 1 | Basic resolving name | Partial | UniversalResolver, wildcard resolution (ENSIP-10) | Low |
| 2 | Profile and text records | Partial | Permissioned Resolver, per-key roles | Low |
| 3 | Agent heartbeat | Yes, if liveness gates an action | Text records (ENSIP-5), no on-chain freshness proof | Medium |
| 4 | Agent reputation | Partial (ENS names the subject, does not score it) | Text records + an external attestation registry (EAS) | Medium |
| 5 | Per-post / per-item subnames | Yes | Name Wrapper fuses or ENSv2 subregistry deployment | Medium |
| 6 | Revocable agent fleets | Yes | Enhanced Access Control, `authorizeTextRoles`/`authorizeAddrRoles`/`authorizeDataRoles` | High |
| 7 | Contract-controlled resolver roles | Yes | Enhanced Access Control, Permissioned Resolver | High |
| 8 | Public-record archives | Partial | Registry events (`NewOwner`, `Transfer`, `TextChanged`) | Low |
| 9 | Address-derived place names | Partial | Reverse Resolution (ENSIP-3), Multichain Primary Names (ENSIP-19) | Low |
| 10 | Machine namespaces | Yes | Subname delegation, ENSIP-27 `class`/`schema` keys (Draft) | Medium |
| 11 | SSH endpoints | No verified example found | Text records (ENSIP-5), arbitrary key | Low, but unproven |
| 12 | Wildcard resolution | Yes (this is an ENS-only mechanism) | ENSIP-10, `ExtendedResolver.resolve()` | Low |
| 13 | Permission inheritance | Yes | ENSv2 `ROOT_RESOURCE` cascading, registry hierarchy | High |
| 14 | Non-transferable names | Yes | Name Wrapper `CANNOT_TRANSFER` fuse (ENSv1) or ENSv2 equivalent role refusal | Medium |
| 15 | CCIP-Read | Yes | ENSIP-10 `OffchainLookup`, ENSIP-21 Batch Gateway (Draft), EIP-3668 | High |
| 16 | ENSIP-25 (as written: "agent registration") | Partial — see §4 | Text record `agent-registration[registry][agentId]` | Medium (Draft) |
| 17 | ENSIP-26 (as written: "agent communication") | Partial — see §4 | Text records `agent-context`, `agent-endpoint[protocol]` | Medium (Draft) |
| 18 | ENSIP-27 (as written: "agent communication") | No — see §4, this ENSIP is not agent-specific | Text records `class`, `schema` | Medium (Draft) |
| 19 | ENSIP-13 SAFE Authentication (added; verified to exist) | Partial | Text records `eip5131:<authKey>`, `eip5131:vault` | Medium (Draft) |
| 20 | ENSIP-19 Multichain Primary Names (added; verified to exist) | Yes | Reverse records across every registered chain | Low (Final) |
| 21 | ENSIP-28 ENS Name Owned Accounts (added; verified to exist) | Yes | Data records `accounts[chain-id]` + EIP-712 consent proofs | High (Draft) |

### 3.1 Basic resolving name

**Strength.** A name resolves to an address without a new lookup service; every wallet and client
already speaks the protocol (ENSIP-1, Final, `docs.ens.domains/ensip/1`, OFFICIAL). VERIFIED.

**Weakness.** By itself this is a lookup, not an identity: nothing about the pattern says who may
change the record or what depends on it. A single resolved value can be wrong, stale, or changed
between the moment a client reads it and the moment it is used, if nothing external pins the
value.

**Does it make ENS central?** Partial. The resolution step is only as load-bearing as what
consumes it. If a name is resolved once for display and never touched again, ENS is cosmetic.

**Relevance to UNICA.** This is precisely the `unica.eth` / `<merchant>.<parent>` → address step
already built: `web/ensv2/resolve.mjs` and `integrations/ensv2/` resolve a merchant name through
`UpgradableUniversalResolverProxy` before an order exists (TEAM GUIDANCE, first-party, VERIFIED
against this repository — `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §3 reads `unica.eth`'s current
`addr(bytes32)` as the zero address on Sepolia, and the checkout fails closed on that rather than
paying it).

**How UNICA advances it without copying.** [BACKEND_POLICY / CLIENT_VERIFICATION] Resolution is
treated as strictly a discovery step: the resolved address is captured once, bound into an
immutable on-chain order at creation, and never re-resolved at settlement. This is not an ENS
feature — it is a boundary UNICA's contracts enforce (`UnicaExecutorV3.Order.recipient`), stated
as PROPOSED architecture in the NON-NEGOTIABLE BOUNDARY governing this document and cross-checked
against `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §8, which already states the property for the one
address record this repository has read: "changing this record cannot redirect an existing order's
funds."

**Required ENSv2 feature.** UniversalResolver plus wildcard resolution (ENSIP-10, Final) so a
merchant subname needs no individual registry entry.

**Implementation risk.** Low for the read path itself. The risk is entirely at the interface
boundary — a UI or backend that re-resolves at settlement time by mistake — which is why the
boundary is enforced in the contract's stored `recipient`, not in the resolution client.

### 3.2 Profile and text records

**Strength.** ENSIP-5 (Final, `docs.ens.domains/ensip/5`) defines a small set of global text keys
(`avatar`, `description`, `display`, `email`, `keywords`, `mail`, `notice`, `location`, `phone`,
`url`) that any client can read without a bespoke API. ENSIP-18 (Draft, `docs.ens.domains/ensip/18`)
extends this with profile-specific keys (`header`, `theme`, `timezone`, `language`, `alias`,
`primary-contact`) and "profile service keys" derived from service domains such as `com.github`.
Both VERIFIED.

**Weakness.** ENSIP-18 itself names the open problem: a text record is self-asserted, with "no way
to verify if the information is actually correct" once displayed as profile data. The ENS DAO
forum thread "ENSIP: Text Record Attestations" (`discuss.ens.domains/t/ensip-text-record-attestations/22376`,
COMMUNITY, proposal stage — not a ratified ENSIP) proposes binding attestations to text records for
exactly this reason.

**Does it make ENS central?** Partial — central for discovery, not for trust. An attestation layer
(commonly EAS, external to ENS) is what would make a text record verifiable rather than merely
displayable.

**Relevance to UNICA.** A merchant's public storefront profile — display name, description,
support URL — is exactly this pattern, and UNICA already treats it as advisory: nothing in
`docs/ensv2/UNICA-ETH-ADDR-REPORT.md` or `integrations/ensv2/` uses a text record as a settlement
input.

**How UNICA advances it without copying.** [CLIENT_VERIFICATION] The interface separates the
merchant's *profile* (mutable, advisory, changeable any time by whoever holds the resolver role)
from the merchant's *settlement identity* (the address bound into a specific order, immutable
after creation) and names the difference to the person paying, rather than letting a profile
edit read as equally safe to an address edit. PROPOSED, directly required by the NON-NEGOTIABLE
BOUNDARY.

**Required ENSv2 feature.** Permissioned Resolver with per-key roles, so an employee can be given
authority to edit `description` without also holding `SET_ADDR` — see Pattern 6 and 7 below for
how UNICA's own delegation code already exercises this on a fork.

**Implementation risk.** Low technically. The risk is UX: a merchant editing `url` and assuming it
carries the same weight as editing an address record. UNICA's mitigation is interface separation,
not an ENS mechanism, and is labelled PROPOSED because it is not yet built.

### 3.3 Agent heartbeat

**Strength / example.** World's CaaS project (`github.com/fabianferno/caas`, COMMUNITY, retrieved
2026-09-11) stores agent metadata in ENS text records — `caas.soul`, `caas.personality`,
`caas.channels`, `caas.owner`, `caas.inft`, `caas.storage` — and its `@world-caas/agent-mini-app`
package "Heartbeats to CaaS every 30s so your app shows live/offline status in the store" (quoted
from the project's own README). VERIFIED as a public project, but the heartbeat itself is reported
to an off-chain service, not written to a text record on a fixed interval — the ENS text records
in this project are static identity metadata, and liveness is a separate off-chain signal layered
on top. This distinction matters: "an ENS record proves liveness" is not what this project actually
does, and no project doing exactly that was found within this document's research budget.

**Weakness.** A text record has no native freshness proof. A `status` key set once and never
updated looks identical, at the resolver level, to one updated every second — nothing in ENSIP-5
or ENSIP-26 defines a staleness bound. Any heartbeat-over-ENS design has to add its own timestamp
convention and have the consuming client enforce a staleness window; ENS supplies storage, not the
guarantee.

**Does it make ENS central?** Yes, if a downstream action (routing an order, admitting a terminal)
is actually gated on the heartbeat being fresh — otherwise the record is informational only.

**Relevance to UNICA.** A merchant's unattended checkout terminal or an automated settlement agent
publishing "I am processing orders" is the same shape of problem.

**How UNICA advances it without copying.** [BACKEND_POLICY] If built, UNICA's version would gate
on both a text-record timestamp and a maximum age enforced by the reading client (never trusting
"a value exists" as equivalent to "the value is current") — PROPOSED, and explicitly not built in
this repository today (SPECIFIED-NOT-BUILT would be the wrong label here because it is not even
specified yet; it is a candidate pattern, nothing more).

**Required ENSv2 feature.** Ordinary text records (ENSIP-5); no ENSv2-specific feature is required
for the storage half of this pattern.

**Implementation risk.** Medium. The failure mode is silent: a stale heartbeat that nobody notices
is stale, because ENS itself will answer the stale value without complaint.

### 3.4 Agent reputation

**Strength.** The official ENS blog post "The Identity Problem in Agentic Commerce: How ENS Can
Enable Trust for AI Agents" (`ens.domains/blog/post/ens-ai-agent-erc8004`, OFFICIAL, retrieved
2026-09-11) describes ERC-8004 as "introducing a standardized, onchain trust framework made of
three registries: Identity, Reputation, and Validation," and states "ENS names are treated as
first-class identifiers, alongside wallet addresses and associated metadata" within that framework.
Separately, `ens.domains/ecosystem/base` (OFFICIAL) describes onchain attestations issued via EAS
under `verifications.coinbase.eth` that "act as a reputation layer for discovery and trust among
builders." Both VERIFIED.

**Weakness.** ENS itself stores no score. Reputation in both examples above lives in a separate
registry (ERC-8004's Reputation registry; EAS attestations) — ENS supplies the stable name that the
score is indexed by, not the scoring mechanism.

**Does it make ENS central?** Partial. The name is the join key across systems; the trust judgment
is made elsewhere.

**Relevance to UNICA.** A merchant's or agent's settlement history (orders fulfilled, disputes,
refund rate) is a reputation signal a checkout surface could want to show — but per the
NON-NEGOTIABLE BOUNDARY, it must never be read as authorization.

**How UNICA advances it without copying.** [GRAPH_EVIDENCE / CLIENT_VERIFICATION] If built, a
reputation figure shown to a payer would be computed from indexed on-chain settlement events (the
sibling stream's evidence model, `docs/unica-v5/graph/PEER-PATTERNS.md` §3.9, "Explainable refusal
decisions" — cited, not edited, per this document's scope) rather than from a self-asserted ENS
text record or an external score UNICA cannot audit. PROPOSED; nothing of this kind exists in the
repository today.

**Required ENSv2 feature.** Text records to publish a *pointer* to where the evidence lives (for
example a subgraph endpoint or a receipt index), not to hold the score itself.

**Implementation risk.** Medium — the risk is exactly the one the NON-NEGOTIABLE BOUNDARY guards
against: reputation must stay informational and never gate settlement authorization, which is a
discipline UNICA has to hold itself, not one ENS enforces.

### 3.5 Per-post / per-item subnames

**Strength / mechanism.** ENS's own "Name Wrapper Use-Cases" page (`docs.ens.domains/wrapper/usecases/`,
OFFICIAL, retrieved 2026-09-11) documents minting one subname per discrete unit — an event ticket,
an NFT-holder perk — each with its own fuse configuration: a "soulbound" ticket burns
`CAN_EXTEND_EXPIRY | PARENT_CANNOT_CONTROL | CANNOT_UNWRAP | CANNOT_TRANSFER`, while an "expired"
ticket sets an expiry at the event's end date. VERIFIED. No verified public project issuing one
subname per individual content post (a blog entry, a social post) was found within this
document's research budget — the closest verified official pattern is per-ticket / per-NFT, not
per-post specifically. Flagged UNKNOWN for the literal "per-post" framing in the originating brief.

**Weakness.** Minting a subname per unit at scale means either an on-chain transaction per unit
(costly) or an off-chain / L2 issuance layer (the CCIP-Read pattern, §3.15) trading gas cost for
gateway trust.

**Does it make ENS central?** Yes, if the subname is the unit's actual identity (its ticket, its
membership) rather than a label attached after the fact.

**Relevance to UNICA.** A per-order or per-receipt subname (`order-<id>.<merchant>.<parent>`)
could give each settlement a permanent, individually-revocable-or-not name.

**How UNICA advances it without copying.** [UNICA_ONCHAIN / ENSV2_ONCHAIN] UNICA already has a
stronger per-order identity primitive that does not depend on ENS at all: the on-chain
`SettlementReceipt` paired with `Settled` in the same transaction (`docs/unica-v4/EVENT-SCHEMA.md`
§6.2, SPECIFIED-NOT-BUILT — v4 contracts do not exist yet). A per-order subname, if added, would be
a *discovery convenience* layered on top of that receipt, never a replacement for it, consistent
with the boundary that ENS aids discovery before order creation and never substitutes for
contract-level settlement evidence. PROPOSED.

**Required ENSv2 feature.** Name Wrapper fuses (ENSv1) or an ENSv2 subregistry deployed per
merchant, so subname issuance does not require a transaction against the parent's own registry
for every order.

**Implementation risk.** Medium — mainly a cost and scale question (transaction cost per subname
vs. an off-chain issuance layer's added trust surface).

### 3.6 Revocable agent fleets

**Strength.** ENSv2's Enhanced Access Control (`docs.ens.domains/ensv2/overview/`, OFFICIAL,
retrieved 2026-09-11 — "Role-based permission system replacing ENSv1 fuses," integrating "all the
functionality enabled by the Name Wrapper in ENSv1 into the core of ENSv2") lets a name owner grant
a specific role at a specific resource to a specific account, and revoke that one grant without
touching any other assignee. The official ENS blog frames the fleet shape directly: "delegated
subnames like shop.agent.eth, trade.agent.eth, or verify.agent.eth allow large-scale naming and a
neutral namespace" (`ens.domains/blog/post/ens-ai-agent-erc8004`, OFFICIAL). Both VERIFIED.

**Weakness / provenance conflict — recorded, not resolved here.** This repository's own
`integrations/ensv2/` carries two claims about resource granularity that this document does not
reconcile, and neither should be silently preferred over the other:

1. The brief governing this document states: "every live refusal observed on the deployed
   Permissioned Resolver named the NAME-LEVEL resource `keccak256(node, bytes32(0))`, not a finer
   per-text-key or per-coin-type resource. Per-key resource derivation is DOCUMENTED_NOT_OBSERVED."
   This is a claim about what an unauthorized call's *revert* names, on the live Sepolia deployment.
2. `integrations/ensv2/roles.mjs` and `profile.mjs` (committed to this repository, commit `9a9e504`,
   2026-09-09) record a *different* measurement: `authorizeTextRoles(dns, key, agent, true)`,
   executed by the impersonated name owner on a **pinned Sepolia fork** (block 11666400, anvil,
   loopback RPC only, nothing broadcast), left `roles(perKeyResource, agent)` non-zero at
   `keccak256(abi.encode(node, keccak256(bytes(key))))` — a per-key resource — and a subsequent
   authorization of a *different* key on the same name was refused. `profile.mjs` labels this a
   fork execution, explicitly weaker than "a canonical-history observation."

These are not the same measurement: one is a refusal's resource on the live chain; the other is a
successful grant's resource on a fork. Both can be true at once — refusals of ordinary calls like
`setText` may still name the name-level resource, while a purpose-built `authorizeTextRoles` call
writes a role at a per-key resource — but this document does not adjudicate that for the owner. It
is recorded here as an open conflict between the brief's stated provenance limit and this
repository's own newer fork evidence, and is repeated in Section 7 (Unknowns).

**Does it make ENS central?** Yes — this is the mechanism that makes a name a *governable*
identity rather than a single-key lookup, which is the ENS prize page's own bar: "ENSv2 features
should be central to the product, not a cosmetic add-on" (`ethglobal.com/events/ethonline2026/prizes/ens`,
retrieved 2026-09-11, OFFICIAL).

**Relevance to UNICA.** UNICA's plan is to delegate a leaf name's text-record authority to an
automated settlement agent, never the merchant's own address-bearing names.

**How UNICA advances it without copying.** [ENSV2_ONCHAIN] `integrations/ensv2/roles.mjs` refuses
to construct any grant whose *effective* resource is `ROOT_RESOURCE`, checked by re-deriving the
resource/bitmap/account triple a call would actually write and running it through
`screenAgentGrant` before returning any calldata — "the transaction granting the agent authority
on ROOT_RESOURCE is invalid and must be rejected BY THE PLANNER, not merely left unwritten" (quoted
from the file's own header). TEAM GUIDANCE, first-party, DOCUMENTED_NOT_OBSERVED as a *live*
grant (fork-only per the conflict above) but present as working, tested code in this repository.

**Required ENSv2 feature.** Enhanced Access Control's `authorizeTextRoles` / `authorizeAddrRoles`
/ `authorizeDataRoles` family (not `grantRoles`, which this deployment's Permissioned Resolver
refuses from the name owner with `EACCannotGrantRoles` per `roles.mjs`'s own header — TEAM
GUIDANCE, first-party).

**Implementation risk.** High. Getting a delegation boundary wrong is the exact failure mode the
NON-NEGOTIABLE BOUNDARY and Advisory 001 exist to prevent — an over-broad grant would let a
delegated agent touch merchant-owned identity it was never meant to reach.

### 3.7 Contract-controlled resolver roles

**Strength.** This is Enhanced Access Control and the Permissioned Resolver again, viewed from the
resolver's side rather than the delegation's side: "Rather than sharing a single Public Resolver,
every account gets its own Permissioned Resolver proxy with fine-grained per-record permissions and
record aliasing" (`docs.ens.domains/ensv2/overview/`, OFFICIAL). VERIFIED, and this repository has
read it live: `integrations/ensv2/README.md` records the deployed resolver's `roles`, `roleCount`,
`hasRootRoles`, `hasAssignees`, and `getAssigneeCount` all decoding correctly, and "the same
`setAddr` calldata... is ACCEPTED from the account the chain says holds `ROLE_SET_ADDR` and
REFUSED from a derived probe address, with `EACUnauthorizedAccountRoles` naming the resource and
the role." VERIFIED, TEAM GUIDANCE, first-party, live (not fork).

**Weakness.** A per-account resolver means the access-control surface is duplicated per name
rather than shared — auditing "who can write what" is now a per-resolver question, not a
protocol-wide constant.

**Does it make ENS central?** Yes.

**Relevance to UNICA.** This is the substrate every staff-permission and agent-delegation design
in this document's DIFFERENTIATION companion sits on.

**How UNICA advances it without copying.** [ENSV2_ONCHAIN] Nothing here is UNICA-specific yet to
add beyond what Pattern 6 already states; the two patterns are two views of one mechanism.

**Required ENSv2 feature.** Permissioned Resolver, Enhanced Access Control.

**Implementation risk.** High, for the same reason as Pattern 6.

### 3.8 Public-record archives

**Strength.** ENSIP-1 (Final, `docs.ens.domains/ensip/1`) defines the ENS Registry as a contract
whose ownership and resolver assignments are ordinary Ethereum state changes, which means every
`NewOwner`, `Transfer`, and `TextChanged` event is permanently, publicly queryable — a name's full
history of who owned it and what it pointed at is an append-only public record by construction,
with no separate archival system required. VERIFIED as a structural property of ENS's own
architecture (ENSIP-1), not tied to any one project.

**Weakness.** The archive records *that* a change happened and *who* made it, never *why*, and (as
Pattern 2 notes) never whether the resulting value was true.

**Does it make ENS central?** Partial — the archival property is a side effect of using Ethereum
state at all, not something ENS adds beyond it.

**Relevance to UNICA.** A merchant's address-record history is itself evidence: if a payer disputes
a payment, "what did this name resolve to at time T" is answerable from chain history, independent
of anything UNICA stores.

**How UNICA advances it without copying.** [CLIENT_VERIFICATION / GRAPH_EVIDENCE] UNICA does not
need to build an archive — it needs to read the one that already exists and pair it with its own
settlement receipts, which is the evidence model the sibling Graph stream documents
(`docs/unica-v5/graph/PEER-PATTERNS.md`, cited, not edited). PROPOSED.

**Required ENSv2 feature.** None beyond ordinary registry events; this pattern predates ENSv2.

**Implementation risk.** Low.

### 3.9 Address-derived place names

**Interpretation, stated plainly.** No public project literally deriving geographic "place names"
(a what3words-style scheme) from an Ethereum address was found within this document's research
budget; that specific reading of the brief's phrase is UNKNOWN. The closest verified ENS mechanism
that derives a *name* from an *address* — the direction the phrase most plausibly points to — is
reverse resolution: ENSIP-3 (Reverse Resolution, Final, `docs.ens.domains/ensip/3`) lets an address
claim a primary name that answers "what is this address called", and ENSIP-19 (Multichain Primary
Names, Final, `docs.ens.domains/ensip/19`) extends that to every registered EVM chain, so the same
address can have a chain-specific "place" in the namespace. Both VERIFIED.

**Weakness.** A primary/reverse name is self-set by the address's controller and is exactly as
trustworthy as any other self-asserted record (Pattern 2's weakness again).

**Does it make ENS central?** Partial.

**Relevance to UNICA.** A settlement terminal or executor contract address could carry a reverse
name for operator-facing display ("this payout went to `terminal-3.merchant.eth`" instead of a raw
address) — informational only, per the boundary.

**How UNICA advances it without copying.** [CLIENT_VERIFICATION] If used, purely as a display
convenience over an address UNICA already resolved through its own boundary-respecting path, never
as an input to settlement. PROPOSED.

**Required ENSv2 feature.** Reverse Resolution (ENSIP-3), Multichain Primary Names (ENSIP-19).

**Implementation risk.** Low.

### 3.10 Machine namespaces

**Strength.** The same official ENS blog post on agentic commerce frames subname delegation as a
namespace for non-human actors generally: "delegated subnames like shop.agent.eth, trade.agent.eth,
or verify.agent.eth allow large-scale naming and a neutral namespace" (`ens.domains/blog/post/ens-ai-agent-erc8004`,
OFFICIAL). ENSIP-27 (Node Classification and Metadata, Draft, `docs.ens.domains/ensip/27`) adds a
`class` text key intended to label "a node's general role" with a standardized list of values (the
proposal's own examples are "Person," "Treasury," "Contract," "Delegate") plus a `schema` key
pointing at a JSON Schema for additional attributes. VERIFIED, both official sources.

**Weakness.** ENSIP-27's own published example list does not name a "Device" or "Machine" class
value — it permits custom values, but a standardized "this subname is a machine" convention is not
itself part of the ENSIP as retrieved. UNKNOWN whether such a value exists in practice; not found
within budget.

**Does it make ENS central?** Yes, if a machine's operating parameters (which chain, which role,
which constraints) are actually read from its subname's records by the systems that interact with
it, rather than configured out-of-band.

**Relevance to UNICA.** A payment terminal, a settlement bot, or a hardware POS device is exactly
this shape of non-human actor.

**How UNICA advances it without copying.** [BACKEND_POLICY] If built, a terminal's subname would
carry a `class` value and a `schema` pointer describing its declared capabilities, checked by the
backend before trusting anything the terminal reports — PROPOSED, and explicitly speculative:
ENSIP-27 is Draft and could change before any implementation would be worth building against it.

**Required ENSv2 feature.** Subname delegation plus ENSIP-27's `class`/`schema` keys (Draft).

**Implementation risk.** Medium — chiefly the risk of building against a Draft ENSIP that changes.

### 3.11 SSH endpoints

**Finding, stated plainly.** No verified public project using ENS text records for SSH host-key
or endpoint verification was found within this document's research budget. Searches returned
conventional DNS SSHFP-record material (a genuinely analogous but non-ENS mechanism) and no ENS
equivalent. This pattern is recorded as UNKNOWN in its entirety — not as a verified ENS pattern
with an unverified example, but as a pattern this document could not confirm exists in practice.

**Plausible mechanism, not verified in use.** ENSIP-5's text records are an arbitrary key-value
store (VERIFIED, the mechanism itself), so nothing prevents a project from defining a convention
(for example `ssh.hostkey`) the way DNS's SSHFP record does — this document states that this is
*possible*, not that it has been *done*.

**Does it make ENS central?** No verified example to judge.

**Relevance to UNICA.** Low and speculative — UNICA has no SSH-facing surface today.

**How UNICA advances it without copying.** Not applicable; nothing to advance. Recorded for
completeness because the originating brief asked for it, and because saying "not found" honestly
is the correct answer to a pattern that does not check out, rather than manufacturing an example.

**Required ENSv2 feature.** Ordinary text records, if ever built.

**Implementation risk.** Low, but unproven — the risk is building a convention nobody else reads.

### 3.12 Wildcard resolution

**Strength.** ENSIP-10 (Wildcard Resolution, Final, `docs.ens.domains/ensip/10`, OFFICIAL) lets a
single resolver answer for every subname of a parent that has no resolver of its own set: "the cost
of doing so is currently prohibitive for large user bases, as a distinct record must be set on the
ENS Registry for each subdomain" is the problem it solves, by having a client "recursively strip
the leftmost label and check parent domains" until a resolver is found, then hand that resolver the
complete original name via an `ExtendedResolver.resolve()` call. VERIFIED.

**Weakness.** The resolver must implement `resolve()` itself and interpret the DNS-encoded name and
calldata correctly; a resolver that only implements the legacy single-record interface does not
benefit.

**Does it make ENS central?** Yes — this is an ENS-specific mechanism with no substitute outside
the protocol.

**Relevance to UNICA.** `integrations/ensv2/README.md` already records this live: "an unregistered
subname is answered by the same resolver as its parent — which is what makes
`<merchant>.<parent>` possible without a transaction per merchant." VERIFIED, TEAM GUIDANCE,
first-party, live.

**How UNICA advances it without copying.** [ENSV2_ONCHAIN] Already in production use in this
repository's resolution path; no further claim needed here beyond what is already measured.

**Required ENSv2 feature.** ENSIP-10 itself, carried into ENSv2's `UpgradableUniversalResolverProxy`.

**Implementation risk.** Low — already exercised, not merely planned.

### 3.13 Permission inheritance

**Strength.** ENSv2's registry hierarchy (`ensdomains-contracts-v2.mintlify.app/concepts/architecture`,
OFFICIAL project documentation, retrieved 2026-09-11) states "Root-level permissions automatically
apply to all names" within a registry, through a special `ROOT_RESOURCE` (value `0`) that "provides
contract-wide permissions" — "this user can set resolvers for ALL names" when holding a root-level
role. A subregistry can be "locked," producing an "emancipated" name the parent can no longer
reach. VERIFIED.

**Weakness.** Cascading permission is exactly as dangerous as it is convenient: a role granted at
`ROOT_RESOURCE` reaches every name under it, which is precisely the shape of over-grant the
NON-NEGOTIABLE BOUNDARY and Advisory 001 exist to prevent for anything with settlement
consequence.

**Does it make ENS central?** Yes.

**Relevance to UNICA.** Directly — this is the mechanism `integrations/ensv2/roles.mjs` refuses to
grant against (see Pattern 6).

**How UNICA advances it without copying.** [ENSV2_ONCHAIN] UNICA's delegation code treats
inheritance as a hazard to screen for, not a convenience to use: every constructed grant is
re-derived to its *effective* resource and refused if that resource is `ROOT_RESOURCE`, and a
second pass (`screenPlanForAgentAuthority`) re-checks an entire assembled plan rather than trusting
that each call was individually checked. TEAM GUIDANCE, first-party, code exists in this repository
today (fork-tested per the Pattern 6 conflict note, not live-tested).

**Required ENSv2 feature.** The registry hierarchy and `ROOT_RESOURCE` mechanic themselves.

**Implementation risk.** High — this is the single highest-consequence mechanism in the whole
catalogue for a payments product, because a mistake here is a mistake at every name below the
grant, not one.

### 3.14 Non-transferable names

**Strength.** The Name Wrapper's `CANNOT_TRANSFER` fuse (`docs.ens.domains/wrapper/fuses/`,
OFFICIAL, retrieved 2026-09-11) makes a wrapped name's NFT permanently non-transferable once
burned: "Burning CANNOT_TRANSFER means the wrapped NFT can no longer be transferred or sold." The
use-cases page's soulbound-ticket example burns
`CAN_EXTEND_EXPIRY | PARENT_CANNOT_CONTROL | CANNOT_UNWRAP | CANNOT_TRANSFER` together, and fuses
can only be burned on a name that is Locked. VERIFIED. This is an ENSv1 Name Wrapper mechanism;
this document did not find an equivalent named "fuse" in ENSv2, where the same effect would be
achieved by never granting a transfer-capable role and refusing to grant it later (Enhanced Access
Control's role model rather than a burn-once bitfield) — that ENSv2-side equivalence is this
document's own reading, not a quoted source, and is labelled PROPOSED accordingly.

**Weakness.** Once burned in ENSv1, `CANNOT_TRANSFER` cannot be un-burned; a decision made once is
permanent for that name.

**Does it make ENS central?** Yes.

**Relevance to UNICA.** A staff-badge or terminal-credential subname that should never move to a
new holder (only be revoked and reissued) is this exact shape.

**How UNICA advances it without copying.** [ENSV2_ONCHAIN] If built, UNICA's version would favor
the ENSv2 role-refusal equivalent over the ENSv1 fuse specifically because revocation (removing a
role) is possible where un-burning a fuse is not — a staff member who leaves needs their name's
capability revoked, not their name migrated. PROPOSED.

**Required ENSv2 feature.** Either the ENSv1 Name Wrapper fuse (if a v1 name is in play) or an
ENSv2 role grant that is simply never extended to include a transfer capability.

**Implementation risk.** Medium — mainly the risk of choosing permanence (fuse) where revocability
(role refusal) was actually wanted, or vice versa.

### 3.15 CCIP-Read

**Strength.** ENSIP-10's `resolve()` mechanism is also the vehicle for off-chain resolution: a
resolver can revert with `OffchainLookup` (EIP-3668) to redirect a client to a gateway server
instead of answering directly on-chain. `ens.domains/ecosystem/base` (OFFICIAL) documents this
live: an L1 resolver "reverts with an OffchainLookup error as defined in ENSIP-10," a client
queries a CCIP gateway Base operates, and the gateway "retrieves ownership and records from the L2
registry, returning responses formatted as a standard ENS resolution." ENSIP-21 (Batch Gateway
Offchain Lookup Protocol, Draft, `docs.ens.domains/ensip/21`) extends the pattern to batch multiple
offchain lookups into one gateway round trip. Both VERIFIED.

**Weakness.** The gateway is a trusted (or at least trust-minimized, depending on its own design)
off-chain component; a client is trusting the gateway's honesty for anything answered this way,
which is a different trust model from an on-chain-only read.

**Does it make ENS central?** Yes — this is how ENS extends to L2s and to data that would be too
costly to store on L1, and is the mechanism behind Base's entire Basenames product.

**Relevance to UNICA.** If UNICA ever needs to resolve merchant identity data that lives cheaper
off-chain (bulk catalog metadata, for example) without losing an ENS-compatible resolution path,
this is the mechanism, not a bespoke API.

**How UNICA advances it without copying.** [OFFCHAIN_OPERATION] Not built; if built, it would be
labelled explicitly as an off-chain-trust extension in any user-facing text, never presented with
the same trust weight as an on-chain read, consistent with the authority-label discipline this
document and its companion apply throughout. PROPOSED.

**Required ENSv2 feature.** ENSIP-10's `OffchainLookup` path; ENSIP-21 if batching multiple
lookups.

**Implementation risk.** High — mainly the operational burden and trust surface of running or
depending on a gateway, not the ENS-side mechanism itself.

### 3.16 ENSIP-25 (brief's label: "agent registration")

**What it actually is.** "ENSIP-25: AI Agent Registry ENS Name Verification" (Draft, created
2025-10-02, `docs.ens.domains/ensip/25`, OFFICIAL). It does not register an agent; it verifies that
an ENS name owner controls an entry the agent already has in an external registry (ERC-8004 is
named as the example). The mechanism is a text record
`agent-registration[<registry>][<agentId>]` — the registry address ERC-7930-encoded, the agent id
registry-defined — where any non-empty value attests the name owner controls that registration. A
client checks the claim by resolving this key and confirming it is non-empty. VERIFIED.

**Correction to the brief.** "Agent registration" over-states it: the registration happens in
ERC-8004 or an equivalent registry; ENSIP-25 only links a name to that pre-existing registration.
This distinction matters for UNICA because it means ENS is never the source of truth for *whether*
an agent is registered, only for *whether a name claims to be linked to* a registration — the
verification, not the registration, is what ENS-side code can trust.

**Does it make ENS central?** Partial — central to the *naming* half of agent identity, not to the
registry half.

**Relevance to UNICA.** If UNICA ever exposes an automated settlement agent under its own
namespace, this is the standard it would use to let a client confirm the agent's name is genuinely
linked to its registry entry, rather than inventing a bespoke verification scheme.

**How UNICA advances it without copying.** [CLIENT_VERIFICATION] Not built; PROPOSED, Draft-status
dependency.

**Required ENSv2 feature.** Text records; no ENSv2-specific mechanism beyond ordinary resolution.

**Implementation risk.** Medium — Draft status, and the ERC-8004 dependency it names is itself
external to ENS.

### 3.17 ENSIP-26 (brief's label: "agent communication")

**What it actually is.** "ENSIP-26: Agent Text Records" (Draft, `docs.ens.domains/ensip/26`,
OFFICIAL). It defines two text keys: `agent-context` (a description of the agent and how to
interact with it, possibly pointing to a registry or to endpoint records) and
`agent-endpoint[<protocol>]` (URLs for specific protocols such as MCP or A2A). VERIFIED.

**Correction to the brief.** "Agent communication" is a fair description of the `agent-endpoint`
half but not of `agent-context`, which is closer to a generalized identity/description field. The
ENSIP names its own priority as "simplicity and flexibility," not communication specifically.

**Does it make ENS central?** Yes, for the specific job of publishing where an agent can be
reached — this is a use of ENS no other naming system does natively.

**Relevance to UNICA.** An automated settlement or support agent could publish an MCP or webhook
endpoint this way, letting other systems discover how to reach it from the name alone.

**How UNICA advances it without copying.** [BACKEND_POLICY] Not built; if built, an
`agent-endpoint` value would be treated as a discovery pointer only, never as an authorization
credential — reaching an endpoint is not the same as that endpoint being trusted with anything.
PROPOSED, Draft-status dependency.

**Required ENSv2 feature.** Text records.

**Implementation risk.** Medium — Draft status; the protocol identifiers it parameterizes over
(MCP, A2A) are themselves still evolving externally.

### 3.18 ENSIP-27 (brief's label, grouped with "agent communication")

**What it actually is.** "ENSIP-27: Node Classification and Metadata" (Draft, created 2025-12-15,
`docs.ens.domains/ensip/27`, OFFICIAL). It is **not agent-specific**. It defines a `class` text key
(a pascal-case role label — the ENSIP's own examples are "Person," "Treasury," "Contract,"
"Delegate" — with custom values permitted) and a `schema` key pointing to a JSON Schema (2020-12)
declaring what additional attributes a node may carry, with inheritance from parent nodes. VERIFIED.

**Correction to the brief.** This is the clearest miscategorization in the originating brief:
ENSIP-27 addresses general-purpose organizational subname metadata (a treasury subname, a delegate
subname, a contract subname) — agent identity is at most one instance of the pattern it enables,
not its subject. Grouping it with ENSIP-25/26 as "agent communication" materially misrepresents
what it specifies.

**Does it make ENS central?** Yes for organizational subname structures generally; not specifically
for agents or for communication.

**Relevance to UNICA.** This is actually a *better* fit for UNICA's own subname structure than the
brief's framing suggests: a merchant's namespace already has organizational roles worth classifying
— a treasury address, a delegated settlement agent, a staff terminal — and `class`/`schema` is
exactly the vocabulary for declaring which is which, machine-readably.

**How UNICA advances it without copying.** [BACKEND_POLICY] If built, UNICA would classify its own
subname roles (`class: Treasury`, `class: Delegate`, a UNICA-defined `class` value for a terminal)
using this convention rather than inventing an unrelated one, while keeping the actual
authorization decision in Enhanced Access Control roles, never in the `class` label itself — a
label is metadata, not a permission. PROPOSED, Draft-status dependency.

**Required ENSv2 feature.** Text records `class`, `schema`.

**Implementation risk.** Medium — Draft status; a UNICA-specific `class` value is not part of the
ENSIP's own list and would need to be a documented extension, not silently assumed compatible.

### 3.19 — 3.21 Other current ENSIPs verified relevant, not named in the brief

**ENSIP-13, SAFE Authentication For ENS** (Draft, `docs.ens.domains/ensip/13`, OFFICIAL). Lets a
secondary "auth" address authenticate on behalf of a primary "vault" address via two matching text
records (`eip5131:<authKey>` on the vault, `eip5131:vault` on the auth address), so the vault never
has to sign anything for a read-only proof of control. VERIFIED. **Relevance to UNICA**: a
cold-storage merchant treasury address authorizing a warm operational address to prove linkage
without the treasury key ever touching a hot signer is exactly this shape — [CLIENT_VERIFICATION],
PROPOSED, Draft-status dependency, not built.

**ENSIP-19, Multichain Primary Names** (Final, `docs.ens.domains/ensip/19`). Already covered under
Pattern 9; listed here because it is Final, not Draft, making it the most implementation-ready of
the three additions. VERIFIED.

**ENSIP-28, ENS Name Owned Accounts** (Draft, `docs.ens.domains/ensip/28`, OFFICIAL). Lets a name
list multiple accounts per chain (`accounts[<chain-id>]`) — Safes, ERC-6551 token-bound accounts —
each with its own EIP-712 consent proof expiring within two years, verified by ECDSA recovery or
ERC-1271. VERIFIED. **Relevance to UNICA**: a merchant name could list its treasury Safe, its
settlement executor, and a staff terminal as separately-consented accounts under one identity —
[ENSV2_ONCHAIN / CLIENT_VERIFICATION], PROPOSED, Draft-status, and explicitly not a substitute for
the NON-NEGOTIABLE BOUNDARY's requirement that a specific order's bound payer/payee is fixed at
order creation regardless of what a name lists.

## 4. Patterns named in the brief that do not check out as written

- **ENSIP-25** is not "agent registration" — it is verification of a name-to-registry link the
  registration itself happens elsewhere (ERC-8004). See §3.16.
- **ENSIP-26** is "Agent Text Records," broader than "agent communication" — it includes an
  identity/description record (`agent-context`) alongside the communication-shaped
  `agent-endpoint` records. See §3.17.
- **ENSIP-27** is "Node Classification and Metadata" and is **not** an agent-communication ENSIP at
  all — it is a general subname role/schema convention. Grouping it with 25/26 in the brief is the
  most significant miscategorization found in this research. See §3.18.
- All four ENSIPs the brief and this catalogue lean on for agent patterns (13, 25, 26, 27) plus 28
  are **Draft**, not Final, as of retrieval (2026-09-11) — none is a stable ENS feature yet, which
  is why every pattern built on one is labelled Draft-status dependency / PROPOSED rather than
  VERIFIED-as-stable.
- **"Address-derived place names"** and **"SSH endpoints"** did not check out as named — see §3.9
  and §3.11 for the honest UNKNOWN finding on each.

## 5. Authority-label note

Every "how UNICA advances it without copying" entry in Section 3 carries its own bracketed
authority label — one of ENSV2_ONCHAIN, UNICA_ONCHAIN, BACKEND_POLICY, GRAPH_EVIDENCE,
CLIENT_VERIFICATION, or OFFCHAIN_OPERATION — stated per pattern rather than blended across
patterns. No pattern's advancement is described as more than one layer at once.

## 6. Sources

All retrieved 2026-09-11 unless noted. None failed to load; none is marked UNREAD.

| URL | Kind | Status | Used for |
|---|---|---|---|
| https://docs.ens.domains/ensip | OFFICIAL | READ | ENSIP index, §2 |
| https://docs.ens.domains/ensip/1 | OFFICIAL | READ | ENSIP-1, §3.1, §3.8 |
| https://docs.ens.domains/ensip/3 | OFFICIAL | READ | ENSIP-3, §3.9 |
| https://docs.ens.domains/ensip/5 | OFFICIAL | READ | ENSIP-5, §3.2 |
| https://docs.ens.domains/ensip/10 | OFFICIAL | READ | ENSIP-10, §3.12, §3.15 |
| https://docs.ens.domains/ensip/13 | OFFICIAL | READ | ENSIP-13, §3.19 |
| https://docs.ens.domains/ensip/18 | OFFICIAL | READ | ENSIP-18, §3.2 |
| https://docs.ens.domains/ensip/19 | OFFICIAL | READ (via search + index) | ENSIP-19, §3.9, §3.20 |
| https://docs.ens.domains/ensip/21 | OFFICIAL | READ (via index + ecosystem page) | ENSIP-21, §3.15 |
| https://docs.ens.domains/ensip/25 | OFFICIAL | READ | ENSIP-25, §3.16 |
| https://docs.ens.domains/ensip/26 | OFFICIAL | READ | ENSIP-26, §3.17 |
| https://docs.ens.domains/ensip/27 | OFFICIAL | READ | ENSIP-27, §3.18 |
| https://docs.ens.domains/ensip/28 | OFFICIAL | READ | ENSIP-28, §3.21 |
| https://docs.ens.domains/ensv2/overview/ | OFFICIAL | READ (via search summary) | Enhanced Access Control, Permissioned Resolver, §3.6, §3.7 |
| https://ensdomains-contracts-v2.mintlify.app/concepts/architecture | OFFICIAL project docs | READ | ENSv2 registry hierarchy, ROOT_RESOURCE, §3.13 |
| https://docs.ens.domains/wrapper/usecases/ | OFFICIAL | READ | Name Wrapper use cases, §3.5, §3.14 |
| https://docs.ens.domains/wrapper/fuses/ | OFFICIAL | READ (via search summary) | CANNOT_TRANSFER fuse, §3.14 |
| https://ens.domains/blog/post/ens-ai-agent-erc8004 | OFFICIAL (ENS blog) | READ | Agentic commerce identity, delegated subnames, ERC-8004, §3.4, §3.6, §3.10 |
| https://ens.domains/ecosystem/base | OFFICIAL (ENS ecosystem page) | READ | CCIP-Read / Basenames, reputation via EAS, §3.4, §3.15 |
| https://ethglobal.com/events/ethonline2026/prizes/ens | OFFICIAL (ETHGlobal) | READ | Prize tiers, "central not cosmetic" bar, Continuity-only integration prize, §3.6 |
| https://discuss.ens.domains/t/ensip-text-record-attestations/22376 | COMMUNITY (ENS DAO forum) | READ (via search summary) | Text-record attestation proposal, §3.2, §3.4 |
| https://github.com/fabianferno/caas | COMMUNITY (public project) | READ | Agent heartbeat example, §3.3 |
| `integrations/ensv2/README.md` | TEAM GUIDANCE, first-party | READ | Live resolver/EAC measurements, §3.7, §3.12 |
| `integrations/ensv2/roles.mjs` | TEAM GUIDANCE, first-party | READ | Delegation refusal design, per-key resource fork claim, §3.6, §3.13 |
| `integrations/ensv2/profile.mjs` | TEAM GUIDANCE, first-party | READ | Fork evidence detail (block, method), §3.6 |
| `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` | TEAM GUIDANCE, first-party | READ | `unica.eth` current state, §3.1 |
| `docs/unica-v5/graph/PEER-PATTERNS.md` | TEAM GUIDANCE, first-party, sibling stream (cited, not edited) | READ | Evidence-model cross-reference, §3.4, §3.8 |

A small number of official-page facts above were confirmed through a search engine's summary of
the official page rather than a direct fetch of the raw page (noted "via search summary" in the
table). Where that happened, the underlying URL is still the official one and is named; nothing is
attributed to the search engine itself.

## 7. Unknowns

- **The Pattern 6 / Pattern 13 provenance conflict is unresolved by this document on purpose.**
  The brief's stated live-refusal evidence (name-level resource only) and `roles.mjs`/`profile.mjs`'s
  fork-execution evidence (per-key resource, via `authorizeTextRoles`) describe different kinds of
  observations (a refusal vs. a successful grant; live chain vs. a pinned fork) and this document
  does not decide which should govern future ENSv2 delegation work. This is an owner decision, not
  a research gap this document can close by reading more.
- **"Address-derived place names"** — no verified project matching a literal what3words-style
  reading was found. The reverse-resolution reading substituted in §3.9 is this document's own
  best-effort interpretation of an ambiguous phrase, not a confirmed match to whatever the phrase
  was originally meant to describe.
- **"SSH endpoints"** — no verified ENS-based example exists in the sources checked. Recorded as
  UNKNOWN in full, not partially verified.
- **A standardized "machine" or "device" `class` value under ENSIP-27** — not found in the ENSIP's
  own published example list; UNKNOWN whether one exists elsewhere in the ENS ecosystem.
- **Whether ENSv2 has a direct equivalent to the ENSv1 Name Wrapper's `CANNOT_TRANSFER` fuse** —
  this document's own reading (role-refusal achieves the same effect) is PROPOSED reasoning, not a
  quoted ENSv2 source naming an equivalent mechanism.
- **`getAssigneeCount(uint256,uint256)` returning two words instead of the documented one** —
  already flagged as unresolved in `integrations/ensv2/README.md`; repeated here because it bears
  on how much to trust any ENSv2 interface description against the deployed bytecode without an
  independent readback.
- **Whether ENS's own documentation pages changed between this retrieval and any future reading** —
  every Draft-status ENSIP in this catalogue (13, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28) can change
  before reaching Final status; nothing here should be treated as a stable target to build against
  without re-checking its status at build time.
