# UNICA v5 — ENS: differentiation thesis

Status: complete draft. Retrieval date for every source below is 2026-09-11 unless a row states
otherwise. Track: FROM SCRATCH (owner-confirmed 2026-09-11). Reads
`docs/unica-v5/ens/PEER-COMPARISON.md` as its companion and does not repeat that document's
sourcing table in full; a pattern number cited below (e.g. "§3.6") refers to that document.

## 0. No channel transcript was supplied

No ENS channel discussion transcript reached this document. The claims repeated in the
originating brief — isolated deployment, Universal Resolver override, invalid old
initialize/authorize interfaces, direct contract registration, MockUSDC is not Circle USDC,
manager UI failures — are treated in Section 9 as UNVERIFIED LEADS and checked against official
ENS sources and this repository's own first-party measurements, never presented as confirmed
because a channel repeated them. Several turned out to be checkable against official sources
found independently; that independence is stated plainly each time, not glossed over.

## 1. Thesis

ENS gives UNICA a name. It does not, and structurally cannot, give UNICA a guarantee that the
payment behind that name went where the name said it would. Every peer pattern in the companion
catalogue — profile records, agent text records, delegated subnames, Enhanced Access Control —
solves a *discovery* or *governance* problem: which address does this name mean, who may change
that answer, how is a non-human actor named and reached. None of them, individually or combined,
answers a *settlement* problem: given that money already moved, what proves it moved correctly,
and what happens to that proof when the name's records later change.

UNICA's thesis is that a payments product must answer the settlement question with contract state,
never with a name lookup, while still using ENS for everything a name lookup is actually good at:
discovery before commitment, human-readable identity, machine-readable capability, and
economically-scoped delegation. The seven sections below each name one piece of that thesis,
what ENS pattern it builds on (cited to the companion catalogue), and where the boundary against
ENS is drawn explicitly rather than left implicit.

This is argued from UNICA's own specified and (where noted) built architecture, not from a
channel transcript, and every claim below distinguishes VERIFIED (an ENS or first-party source is
cited), PROPOSED (a UNICA design not yet built), SPECIFIED-NOT-BUILT (named in a frozen v4 spec,
no contract exists yet), DOCUMENTED_NOT_OBSERVED, and UNKNOWN.

## 2. Merchant identity tied to real settlement evidence

**The pattern this builds on.** ENSIP-1's Registry makes every name change a public, permanent
Ethereum event (companion §3.8, "Public-record archives"), and ENSIP-3/19 let an address carry a
human-readable name across chains (companion §3.9). Both are VERIFIED, official mechanisms for
naming and for archiving *that a name changed*.

**What ENS does not do.** Neither mechanism records *that a payment settled correctly* — a name's
history is a history of naming decisions, not of payments. ENS has no concept of a UNICA order,
a receipt, or a bound payer.

**UNICA's position.** [UNICA_ONCHAIN / GRAPH_EVIDENCE] Settlement evidence is the paired
`SettlementReceipt` and same-transaction `Settled` event specified in
`docs/unica-v4/EVENT-SCHEMA.md` §6.2 (SPECIFIED-NOT-BUILT — v4 contracts do not exist yet), checked
by emitter authentication rather than by trusting any indexer's or resolver's self-report — the
same discipline the sibling Graph stream states for its own evidence model
(`docs/unica-v5/graph/PEER-PATTERNS.md` §3.8, cited, not edited: "UNICA's actual on-chain
provenance is the receipt pairing itself... checked by emitter authentication... rather than by
trusting any indexer's attestation about its own correctness"). A merchant's ENS identity is the
*name a payer looked up before paying*; the receipt is the *proof of what happened after*. UNICA
keeps these as two separate, separately-verified objects, and a client reading a receipt never
needs to re-trust the ENS record that led to it.

**Why this is not a copy.** No peer pattern in the companion catalogue ties a name to a
transaction-bound receipt this way — the closest is per-item subnames (companion §3.5), which
gives a *unit* an identity but does not itself define what proves that unit's payment settled.
UNICA's receipt design is its own (SPECIFIED-NOT-BUILT), built from `docs/unica-v4/EVENT-SCHEMA.md`
and `SPEC-CONTRACTS.md`, not adapted from any named project.

## 3. Terminal and staff permissions with economic consequence

**The pattern this builds on.** Enhanced Access Control and the Permissioned Resolver (companion
§3.6, §3.7) let a name owner grant a role at a specific resource to a specific account, and revoke
it independently of every other grant — VERIFIED, live-measured by this repository:
`integrations/ensv2/README.md` records the deployed resolver accepting `setAddr` from the holder
of `ROLE_SET_ADDR` and refusing it from a derived probe address, with `EACUnauthorizedAccountRoles`
naming the resource and role. TEAM GUIDANCE, first-party, live (not fork).

**Where the consequence has to live, and where it must not.** The economic consequence of a
terminal or staff credential — can this account authorize a refund, change a payout address, void
an order — cannot be *created* by an ENS role grant, because ENS has no concept of UNICA's order
state. What an ENS role *can* do is scope which records a delegated account may touch, which is a
necessary but not sufficient control. This is precisely why `integrations/ensv2/roles.mjs`
(TEAM GUIDANCE, first-party, committed 2026-09-09) refuses to construct any grant whose effective
resource is `ROOT_RESOURCE` — quoting the file's own header: "the transaction granting the agent
authority on ROOT_RESOURCE is invalid and must be rejected BY THE PLANNER, not merely left
unwritten" — and why `screenPlanForAgentAuthority` re-checks an entire assembled plan rather than
trusting each call was individually screened.

**The unresolved provenance question, carried over from the companion document.** Whether a
per-key resource (as opposed to only a name-level resource) is genuinely available on the live
deployment is disputed between two sources this repository holds at once: the brief governing this
research states every live *refusal* observed named the name-level resource only
(DOCUMENTED_NOT_OBSERVED for anything finer); `integrations/ensv2/profile.mjs` records a
*successful grant*, executed by the impersonated owner on a pinned Sepolia fork (block 11666400,
`anvil`, nothing broadcast), that left a role set at a per-key resource
(`keccak256(abi.encode(node, keccak256(bytes(key))))`). Companion §3.6 records this conflict in
full and does not resolve it; it is repeated here because it is exactly the kind of gap this
section's argument depends on getting right before any staff-permission feature ships. Until it is
resolved by an owner decision and, ideally, a live (not fork) measurement, UNICA's staff/terminal
delegation design should assume the more conservative reading — name-level scoping only — and
treat per-key scoping as an unconfirmed upside, not a load-bearing assumption.

**How UNICA advances the pattern without copying.** [ENSV2_ONCHAIN / BACKEND_POLICY] A terminal or
staff credential's *identity* may live in ENS (a subname, a role); its *economic authority*
(what it can actually cause a contract to do) must be checked against UNICA's own contract state
at the moment of use, never inferred from "this account holds an ENS role." This is the same
separation Section 2 draws between identity and settlement evidence, applied to authorization
instead of payment history. PROPOSED; no staff/terminal delegation feature is built in this
repository today — `roles.mjs` builds the *agent* delegation calldata described above, which is a
narrower, already-code-level precedent for the same discipline, not the staff/terminal feature
itself.

## 4. Receipts surviving record changes

**The pattern this builds on.** Ordinary ENS mutability — a text or address record can be changed
by whoever holds the relevant role, at any time (companion §3.1, §3.2) — is a feature for a
profile and a hazard for a payment identity, because a payer's mental model of "the merchant's
address" can silently drift out from under an in-flight commitment.

**UNICA's binding boundary.** [UNICA_ONCHAIN] This is the NON-NEGOTIABLE BOUNDARY stated for this
research: "For an existing market or order the payout address, token addresses, chain id, hook,
executor, amount, minimum output and bound payer are fixed by the contracts. ENS may aid discovery
BEFORE order creation; the order then binds the resolved identity immutably." This repository has
already measured the specific case: `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §8 states, for the one
address record read from `unica.eth` on Sepolia, "changing this record cannot redirect an existing
order's funds. It can only affect orders created after the change" — because "the recipient is
resolved once, client-side, before the order exists, and is then stored on chain in
`UnicaExecutorV3.Order.recipient`. Settlement reads only that stored value and never re-resolves a
name." VERIFIED, TEAM GUIDANCE, first-party.

**What this requires of the interface, not just the contract.** A contract-level guarantee is only
as good as a user's understanding of it. UNICA's interface is required to "separate current
resolution from the identity observed at settlement" (the boundary's own wording) — meaning a
receipt or an order view must show the address that was actually bound, not re-resolve the
merchant's current name and display that instead, which would silently misrepresent history if the
merchant had since changed the record. PROPOSED for the display layer; the contract-side guarantee
it depends on is SPECIFIED-NOT-BUILT for v4 (`docs/unica-v4/EVENT-SCHEMA.md`) and VERIFIED-by-reading
for the one V3 case already on Sepolia.

**Why this is not a copy.** No peer pattern treats "the record changed after the fact" as a
first-class UX problem with a named interface obligation — ENS's own documentation is silent on
what a *consumer* of a name should do when the record it relied on changes after use, because ENS
does not track "uses" of a resolution the way an order does.

## 5. Machine-readable payment capability

**The pattern this builds on.** ENSIP-26's `agent-endpoint[<protocol>]` records (companion §3.17,
Draft, VERIFIED) let a name publish, machine-readably, how to reach it for a given protocol — the
official ENS blog on agentic commerce frames the adjacent problem directly: "By connecting payment
intent to an ENS name, an agent can publish human-readable, globally resolvable signals about how
it expects to be paid," explicitly keeping "payment rails composable rather than collapsing them
into identity systems" (`ens.domains/blog/post/ens-ai-agent-erc8004`, OFFICIAL, quoted in full in
companion §3.4's source list). This is the single clearest piece of official ENS guidance directly
on point for a payments product, and it agrees with UNICA's own boundary without UNICA having
written it: identity and payment rails are kept separate, not merged.

**UNICA's reading of "capability."** [BACKEND_POLICY / CLIENT_VERIFICATION] A merchant name
publishing *how* it can be paid — which assets, which chain, which minimum output — is a discovery
convenience exactly like the blog post describes, and exactly as non-binding: a client reads the
published capability to *construct* an order, and the order's own bound terms (amount, token,
chain id, hook, executor — the same list named in the NON-NEGOTIABLE BOUNDARY) are what actually
govern settlement, never the published capability record itself at the moment of settlement.
PROPOSED; no capability-publishing feature exists in this repository today.

**Why this is not a copy.** ENSIP-26 defines the record shape (an endpoint per protocol); it does
not define a payment-capability vocabulary (assets, minimums, chains) — that vocabulary, if built,
would be UNICA's own, derived from `docs/unica-v4/SPEC-CONTRACTS.md`'s own order parameters, not
transcribed from any ENSIP or any other project's schema.

## 6. Revocation propagating through operational interfaces

**The pattern this builds on.** Enhanced Access Control's revocation is precise — a role removed
from one assignee at one resource does not touch any other assignee (companion §3.6) — and the
registry hierarchy's `ROOT_RESOURCE` cascading (companion §3.13) is the mechanism that makes an
over-broad grant dangerous in the first place: "this user can set resolvers for ALL names" when
holding a root-level role (`ensdomains-contracts-v2.mintlify.app/concepts/architecture`, OFFICIAL,
VERIFIED). `roles.mjs`'s refusal to ever construct a `ROOT_RESOURCE`-effective grant (Section 3
above) is UNICA's own defense against that cascade, already code-level in this repository.

**What ENS revocation does not reach.** Revoking an ENS role stops that account from writing that
resource going forward. It says nothing about whatever *state* the account already wrote before
revocation, or about any *operational interface* (a POS terminal's local session, a staff member's
already-issued authorization token, a merchant's already-cached configuration) that is not itself
reading the ENS role live on every action.

**UNICA's position.** [BACKEND_POLICY] A revocation is only complete when every interface that
granted the account operational capability re-checks and honors the revocation — an ENS-level
`revokeRoles`/`authorizeTextRoles(..., granted=false)` call is necessary but not sufficient if a
terminal caches "am I authorized" at session start and does not re-check it. This is a design
obligation UNICA's own operational surfaces would have to meet; ENS supplies the revocable primitive,
not the propagation. PROPOSED; no terminal/staff session model exists in this repository today, so
this is stated as a requirement for any future one, not a built guarantee.

**Why this is not a copy.** The companion catalogue found no peer pattern that names propagation
as a distinct problem from revocation itself — every source read treats "the role is revoked" as
the end of the story. UNICA's framing that revocation and propagation are two different guarantees,
and that a payments product must hold both, is this document's own argument, not adapted from a
source.

## 7. Deterministic anti-substitution art

**The pattern this builds on.** ENSIP-12 (Avatar Text Records, Final) is the mechanism already
adopted in `docs/unica-v4/ENS-ART-LAYER.md`: an NFT avatar is written
`eip155:<chainId>/erc<standard>:<contract>/<tokenId>`, resolved per the ENSIP's own steps. That
plan's central rule — quoted from its own text — is that the art "is a function of the normalized
ENS name and an explicit renderer version, NEVER of mutable merchant data such as a payout
address." This is already a committed decision (docs/unica-v4/ENS-ART-LAYER.md §2, "Decisions
applied"), not new to this document.

**Why this belongs in a differentiation argument.** The art-layer rule is the visual expression of
exactly the boundary Sections 2 and 4 argue in contract terms: nothing that a payer relies on to
recognize a merchant should be able to drift when a mutable record changes. An avatar that were a
function of the payout address would let an address change silently change what the merchant
*looks like* to a returning payer, which is the same hazard as an address change silently
redirecting funds, one layer up in the interface. Keeping the art a function of the *name* and a
*pinned renderer version* — never of the address — means a payer's visual trust anchor cannot be
retargeted the way the payment target itself cannot be retargeted after order creation.

**Status.** SPECIFIED-NOT-BUILT. `docs/unica-v4/ENS-ART-LAYER.md` is a plan, not shipped code; no
ERC-721 or renderer exists in this repository today. This document does not claim otherwise, and
does not restate the art layer's own architecture beyond what is needed to make the differentiation
argument — the full design is that document's, cited here, not duplicated.

**Why this is not a copy.** `docs/unica-v4/ENS-ART-LAYER.md` §5 already states this repository's own
"dependency-boundary test," and separately records that the latest stable Vyper (0.4.3) and the
licensing reason (snekmate is AGPL-3.0, this repository is MIT) require a base64 encoder and an
ERC-721 to be written fresh rather than imported. Nothing here changes that; it is restated only to
the depth needed to connect the art layer's existing decision to this document's broader thesis.

## 8. The hard limit: ENS identity never replaces contract-level authorization

**Statement of the limit.** Every section above has drawn the same line from a different angle: a
name is evidence of *intent to identify*, never evidence of *authorization to act* or *proof that
an act occurred correctly*. ENS resolution, ENS text records, ENS roles, and ENS avatars are all,
structurally, inputs a client reads before or alongside a transaction — none of them is the
transaction, and none of them is checked by the EVM at the moment a UNICA contract decides whether
to move funds.

**Where this is already enforced, concretely, in this repository.** `web/ensv2/resolve.mjs` "fails
closed on an unset record rather than treating the zero address as an answer" (quoted from
`docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §3) — a resolution failure blocks the checkout from
proceeding, it does not substitute a default. `UnicaExecutorV3.Order.recipient` is read once and
never re-resolved (Section 4 above). Advisory 001
(`docs/v2/SECURITY-ADVISORY-001.md`, already binding on this repository) requires an authorization
to bind payer, merchant, asset, amount, chain, verifying contract, order or nonce, and expiry —
none of which an ENS record can supply on its own, and the advisory's own rule that "an indexer
never authorizes settlement" extends, by the same logic, to "an ENS resolver never authorizes
settlement" — this document states that extension explicitly because nothing in the advisory's own
text names ENS, and the gap should not be left implicit.

**Where a peer project's own official guidance agrees.** The ENS blog's agentic-commerce post
draws a version of the same line from the payments-rail side: identity and payment rails are kept
"composable rather than collapsing them into identity systems" (quoted in Section 5). UNICA's
position is the settlement-side mirror of that: identity and settlement *authorization* are kept
equally uncollapsed.

**What this rules out, plainly.** No UNICA feature may check "does this ENS name resolve to this
address" as a substitute for checking a contract's own access-control state. No UNICA feature may
treat an ENS role grant as itself the economic permission (Section 3). No UNICA feature may treat
an ENS text record's presence as proof that a payment obligation was met (Section 2). This is
stated as a hard limit, not a preference, because relaxing it in any one feature would reintroduce
the exact class of redirection risk the NON-NEGOTIABLE BOUNDARY exists to close.

## 9. UNVERIFIED LEADS from the originating brief

None of the six leads below reached this document through a transcript — none arrived at all.
Each is checked here against official ENS sources or this repository's own first-party
measurements, found independently of the brief's framing, and labelled by what that independent
check actually showed.

- **"Isolated deployment."** CONFIRMED, independently, by official ENS sources — not by the
  missing transcript. `ens.domains/blog/post/ensv2-beta-public-testing` (OFFICIAL) states the
  Sepolia Beta registry "creates a clean testing environment... names registered during earlier
  Alpha phases won't appear in the Beta registry" and "if you participated in previous App or
  Explorer testing, you should expect to start fresh in Beta." A community summary read alongside
  it (via search, not independently re-verified against a second official page) further
  characterizes the Sepolia ENSv2 deployment as "a temporary isolated testnet environment separate
  from the official ENSv1 mainnet contracts," and states Sepolia state "may be reset periodically
  due to routine contract deployments, with the most recent deployment on July 30, 2026." This
  matters beyond confirming the lead: it means any pinned observation this repository or its
  siblings record against the Sepolia ENSv2 deployment (block 11663994, per
  `docs/ensv2/UNICA-ETH-ADDR-REPORT.md`) could be invalidated by a future reset, and should be
  re-read before being relied on again, not assumed still current.
- **"Universal Resolver override."** PARTIALLY CONFIRMED. The same official beta post states ENS
  has been "working closely with wallets, apps, resolvers, and infrastructure providers to support
  ENSv2 compatibility across the ecosystem, supported by improvements to the Universal Resolver,"
  and a community summary states "the Universal Resolver and the ENS apps for Sepolia are linked
  against the ENSv2 deployment" rather than ENSv1. This is consistent with, but not a verbatim
  match for, "override" — the official framing is "improvements" and "linked against," not
  "override." This repository's own pinned read (`UpgradableUniversalResolverProxy` at
  `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, TEAM GUIDANCE, first-party) is consistent with a
  proxy sitting in front of ENSv2 resolution on Sepolia.
- **"Invalid old initialize/authorize interfaces."** PARTIALLY CONFIRMED, by two independent
  routes, neither the transcript. Officially, `docs.ens.domains/web/ensv2-readiness/` states
  plainly that "registering a name or setting a record is a direct contract interaction, and the
  write-side contracts change with ENSv2," and separately warns "never look up the name's
  configured resolver at write time... the resolver can be reconfigured at any point" and "a name's
  token ID can change over its lifetime" — confirming the write-path interfaces genuinely changed
  between v1 and v2, though this specific page does not name "initialize" or "authorize" by
  function name. Independently, this repository's own `integrations/ensv2/roles.mjs` (TEAM
  GUIDANCE, first-party, committed 2026-09-09) records that the deployed Permissioned Resolver
  refuses `grantRoles` from the name owner with `EACCannotGrantRoles`, and accepts
  `authorizeTextRoles`/`authorizeAddrRoles`/`authorizeDataRoles` instead — a concrete instance of
  exactly this lead's shape, found by this repository's own fork testing before this document
  existed, not by the missing transcript.
- **"Direct contract registration."** CONFIRMED, officially, independent of the transcript. The
  same readiness page states registration is "a direct contract interaction" in ENSv2, distinct
  from whatever UI flow a v1 integration may have relied on.
- **"MockUSDC is not Circle USDC."** CONFIRMED, but for a different subject than this repository's
  own MockUSDC/uTUSD test tokens (`docs/unica-v4` experimental settlement token work, out of this
  document's ENS scope). The official beta post states, about ENSv2's *own* Sepolia registration
  fees: "while we test more diverse payment options for users, Beta offers mockUSDC and official
  testnet USDC as payment options" — i.e. ENS's own registration flow, not UNICA's, distinguishes a
  mock stablecoin from real testnet USDC during Beta. Anyone registering a UNICA-owned ENSv2 name
  on Sepolia should read the registration fee options with this distinction in mind; this is not
  the same claim as, and should not be merged with, anything this repository states elsewhere about
  its own settlement test tokens.
- **"Manager UI failures."** NOT CONFIRMED. No official ENS source or public issue tracker entry
  describing a specific ENS Manager App failure mode on the ENSv2 Sepolia Beta was found within
  this document's research budget. Left as an open, unconfirmed lead — worth a targeted check
  (for example `github.com/ensdomains` issue trackers) before it is repeated as fact anywhere else
  in this project.

## 10. What this document does not claim

- It does not claim any staff/terminal permission feature, capability-publishing feature, or
  revocation-propagation mechanism is built. Every one of Sections 3, 5, and 6's UNICA-side claims
  is PROPOSED, not implemented.
- It does not claim the per-key ENSv2 resource scoping question (Section 3) is settled. It states
  the conflict and the conservative reading to assume until it is resolved.
- It does not claim UNICA's v4 contracts exist. Every reference to `EVENT-SCHEMA.md` or
  `SPEC-CONTRACTS.md` is SPECIFIED-NOT-BUILT, consistent with the standing note that "UNICA v4
  contracts DO NOT EXIST yet."
- It does not present ENSv2 Sepolia Beta behavior as ENS mainnet behavior anywhere in this
  document — every ENSv2-specific claim above is explicitly a Sepolia Beta observation or an
  official statement about the Beta, and Section 9's first finding states plainly that the Beta
  environment itself is temporary and subject to reset.
- It does not attribute any claim to the ENS channel discussion referenced in the originating
  brief, because no transcript of that discussion reached this document.

## 11. Sources

This document relies on the same source set as its companion; only the entries not already listed
in `docs/unica-v5/ens/PEER-COMPARISON.md` §6 are repeated here in full.

| URL | Kind | Status | Used for |
|---|---|---|---|
| https://ens.domains/blog/post/ensv2-beta-public-testing | OFFICIAL (ENS blog) | READ | Beta isolation, Universal Resolver wording, mockUSDC payment option, §9 |
| https://docs.ens.domains/web/ensv2-readiness/ | OFFICIAL | READ | Direct-contract write path, resolver/token-id mutability warnings, §3, §9 |
| `docs/unica-v4/ENS-ART-LAYER.md` | TEAM GUIDANCE, first-party (committed) | READ | Art layer decisions, §7 |
| `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` | TEAM GUIDANCE, first-party | READ | Fail-closed resolution, order-binding evidence, §4, §8 |
| `integrations/ensv2/README.md` | TEAM GUIDANCE, first-party | READ | Live EAC/resolver measurements, §3 |
| `integrations/ensv2/roles.mjs` | TEAM GUIDANCE, first-party | READ | ROOT_RESOURCE refusal, grantRoles/authorizeTextRoles finding, §3, §6, §9 |
| `integrations/ensv2/profile.mjs` | TEAM GUIDANCE, first-party | READ | Fork evidence detail, §3 |
| `docs/unica-v4/EVENT-SCHEMA.md` | UNICA design record (SPECIFIED-NOT-BUILT subject) | READ (cited from brief; not re-opened in full for this document) | Receipt pairing, §2, §4 |
| `docs/unica-v5/graph/PEER-PATTERNS.md` | TEAM GUIDANCE, first-party, sibling stream (cited, not edited) | READ | Evidence-model quote, §2 |
| ens.domains/blog/post/ens-ai-agent-erc8004 | OFFICIAL (ENS blog) | READ (full citation in companion §6) | Payment-rail/identity separation, §5, §8 |
| The NON-NEGOTIABLE BOUNDARY and Advisory 001 text governing this research | Owner-provided task instructions | N/A — primary instruction, not a fetched source | §4, §8 |

Every ENSIP and remaining official page cited by number or short name above (ENSIP-1, -3, -5, -12,
-26, the ENSv2 registry-hierarchy documentation) is sourced in full in the companion document's
Section 6 and not re-listed here.

## 12. Unknowns

- **The per-key vs. name-level resource-scoping conflict (Section 3, companion §3.6/§3.13)** is
  unresolved by this document on purpose; it is an owner decision, and this document states the
  conservative assumption to hold until it is made.
- **Whether the ENSv2 Sepolia Beta has been reset since this repository's pinned observations
  (block 11663994, `docs/ensv2/UNICA-ETH-ADDR-REPORT.md`)** is UNKNOWN as of this document's
  writing. The official beta post confirms resets happen ("the most recent deployment on July 30,
  2026," per a community summary read alongside it); whether one has occurred since 2026-09-11 is
  not something this document can check without a fresh live read.
- **"Manager UI failures"** remains an open, unconfirmed lead (Section 9) — not corroborated, not
  refuted, within this document's research budget.
- **Whether "invalid old initialize/authorize interfaces" refers specifically to functions named
  `initialize`/`authorize`**, versus the broader write-path changes this document found evidence
  for, is UNKNOWN — the official readiness page does not name those two functions specifically, so
  the match to this repository's own `grantRoles`/`authorizeTextRoles` finding is offered as the
  closest concrete evidence found, not as a confirmed one-to-one match to the lead's exact wording.
- **Whether any staff/terminal permission, capability-publishing, or revocation-propagation feature
  described in Sections 3, 5, and 6 will be built for v5 at all** is UNKNOWN — this document argues
  why the thesis requires the boundary it states if such features are built, not that they are
  scheduled.
- **Whether ENSv2 will reach mainnet with the same Enhanced Access Control / Permissioned Resolver
  interfaces this document and its companion cite** is UNKNOWN — `docs.ens.domains/ensv2/overview/`
  itself states "the contracts and interfaces described here are not yet final and may change
  prior to mainnet deployment" (OFFICIAL, quoted in full in companion §1's method notes).
