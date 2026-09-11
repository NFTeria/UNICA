# UNICA v5 / ENS — namespace design: the smallest hierarchy

Engineering record. Read-only research and architecture; authorizes no registration, no
deployment, no subname creation, no record write. Retrieval date for every claim below is
2026-09-11 unless a claim states otherwise. Labels: VERIFIED (source cited), PROPOSED (UNICA
design choice, not a claim about ENS), DOCUMENTED_NOT_OBSERVED (written in ENS documentation or
this repository's own prior work, never exercised on a live or forked chain), UNKNOWN. Reads
against `docs/unica-v5/ens/PRIZE-FIT.md`, `MENTOR-QUESTIONS.md`, `DEMO-PLAN.md` and
`PEER-COMPARISON.md` (sibling stream, cited not edited) and against `docs/unica-v5/graph/`
(sibling stream, cited not edited). **Header correction, recorded rather than silently fixed**: an
earlier draft of this sentence stated those four sibling files "carry section headings only, so
nothing here relies on their content." That is no longer accurate and should not be read as a
current description — all four are now complete documents (`PEER-COMPARISON.md` alone runs 807
lines, headed "Status: complete draft"). This document does not repeat or re-derive their content,
and depends on exactly one thing from that sibling stream, named at its point of use (§11's ENSIP
index cross-check against `PEER-COMPARISON.md`'s own stated method) — nothing else in this
document rests on them, and nothing here should be taken as validated, or contradicted, by their
content beyond that one citation.

Authority labels used throughout, never blended within one claim: ENSV2_ONCHAIN,
UNICA_ONCHAIN, BACKEND_POLICY, GRAPH_EVIDENCE, CLIENT_VERIFICATION, OFFCHAIN_OPERATION.

## 0. What this document inherits, and does not re-derive

**The namespace already has a first draft, built and partly measured, and this document does
not restart it.** `docs/ensv2/DELEGATION-PLAN.md` (repo file, TEAM GUIDANCE, read 2026-09-11)
already specifies and partially fork-executes:

```
<owned-parent>                        owner controls ownership, resolver, subregistry
  merchant.<owned-parent>             merchant identity
    pay.merchant.<parent>             canonical PUBLIC settlement config, PROTECTED resource
    treasury.merchant.<parent>        PUBLIC policy metadata only, PROTECTED resource
      agent.treasury.merchant.<p>     the delegated agent's identity and public capabilities
```

This document's job is narrower than redesigning that: it evaluates **which additional classes**
— terminals, staff, agents (already above), markets, receipts, identity/renderer — earn a place
in that hierarchy, using the same evaluation columns the assignment specifies, and it rejects
every class that does not. §9 restates the result as one tree; it does not add a competing one.

**Chain facts pinned from this repository's own live reads** (ENSV2_ONCHAIN, TEAM GUIDANCE,
`integrations/ensv2/ENS-OWNER-ACTION.md` and `docs/ensv2/UNICA-ETH-ADDR-REPORT.md`, read
2026-09-11): ENSv2 beta runs on **Ethereum Sepolia, chain id `11155111`**. The
`UpgradableUniversalResolverProxy` is at address `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`,
and the `PermissionedResolverImpl` it proxies to is at address
`0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e`, confirmed at block `11663994` and again (proxy
factory added) at block `11666085`. This matches the **official** deployments listing (OFFICIAL,
<https://docs.ens.domains/learn/deployments>, retrieved 2026-09-11), which additionally names a
**Verifiable Factory** at address `0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef` and an
**ETHRegistry** at address `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` on the same beta — the
Verifiable Factory is how a name owner deploys their own registry/resolver proxy pair on demand,
per the ENSv2 overview (OFFICIAL, §0 below).

**A boundary this document never crosses**: this is the ENSv2 Sepolia **beta**, not production
ENS mainnet. `unica.eth` on Ethereum **mainnet** belongs to an unrelated third party this project
claims nothing from (`docs/ensv2/UNICA-ETH-ADDR-REPORT.md`, repo file). No production ENS
address is used for the isolated hackathon deployment anywhere in this document, and no ENSv2
beta behaviour below is presented as mainnet ENS behaviour.

**The resolver's one resource formula, now VERIFIED against the official page** (previously
carried in this repository as DOCUMENTED_NOT_OBSERVED for the per-key/per-coin-type cases —
see the reconciliation below):

```
resource = keccak256(node, part)

  part = bytes32(0)                        name-level resource — every record on the name
  part = keccak256(bytes(key))             one TEXT key       (role ROLE_SET_TEXT, 1<<4)
  part = keccak256(bytes(key))             one DATA key       (role ROLE_SET_DATA, 1<<36)
  part = keccak256(abi.encode(coinType))   one coin type/addr (role ROLE_SET_ADDR, 1<<0)
```

VERIFIED, OFFICIAL, <https://docs.ens.domains/ensv2/permissioned-resolver>, retrieved
2026-09-11: "resource = keccak256(node, part)"; `ROLE_SET_ADDR` at `1 << 0`, `ROLE_SET_TEXT` at
`1 << 4`, `ROLE_SET_DATA` at `1 << 36`; "the resolver supports per-record-type and per-key
granularity, allowing delegation of specific text keys or coin types to different accounts
rather than requiring all-or-nothing permissions." The companion page (OFFICIAL,
<https://docs.ens.domains/ensv2/enhanced-access-control>, retrieved 2026-09-11) states the
bitmap layout — "each role occupies one nybble (4 bits), giving space for up to 32 regular roles
and 32 corresponding admin roles," admin roles at `role << 128`, `ROOT_RESOURCE (0x0) represents
the contract itself. Permissions granted on ROOT_RESOURCE apply everywhere," and "the maximum
number of assignees per role is 15."

**A conflict inside this repository, reconciled here rather than silently picked.** The
narrower assignment brief this document was written under carries an "IMPORTANT provenance
limit" from `integrations/ensv2/README.md` (dated 2026-09-08): every live refusal observed
named the **name-level** resource only, and per-text-key/per-coin-type resource derivation was
DOCUMENTED_NOT_OBSERVED, "treat it that way; do not upgrade it to VERIFIED without new
evidence." Two pieces of evidence dated after that reading already sit in this repository:

1. `docs/ensv2/DELEGATION-PLAN.md` (repo file, dated after 2026-09-08, corrected 2026-09-09/10
   in-place with a banner rather than deleted) records executing
   `authorizeTextRoles(dns, key, account, true)` against the **deployed bytecode on a Sepolia
   fork** pinned at block `11666085`, and reading back `EACRolesChanged` naming exactly the
   per-key resource `keccak256(abi.encode(node, keccak256(bytes(key))))` — a **fork execution
   against the real deployed runtime**, not a claim from documentation alone.
2. The official page fetched fresh for this document (§0 above) independently states the same
   per-record/per-key design intent in prose, without this document or the fork having prompted
   it.

Neither is a **live broadcast on the maintained Sepolia network** — the fork is a local replay
of the deployed bytecode, not a transaction the network itself processed. Treating that
distinction as the one that matters, this document uses: per-key and per-coin-type resource
scoping is **VERIFIED as designed** (official page, direct quote) and **DOCUMENTED_NOT_OBSERVED
on the live network specifically, fork-corroborated** (the fork result is real evidence about
the deployed bytecode, carried with that qualifier rather than silently promoted to a live-chain
observation). Wherever a design decision below turns on this distinction, both readings are
carried side by side rather than one being assumed. A second discrepancy the fork surfaced and
this document also carries forward: the **official Enhanced Access Control page** describes
`grantRoles`/`revokeRoles` and `grantRootRoles`/`revokeRootRoles` as the granting mechanism, and
does not mention `authorizeTextRoles`/`authorizeAddrRoles` at all; `DELEGATION-PLAN.md`'s fork
execution found `grantRoles` **refused** by the deployed Permissioned Resolver
(`EACCannotGrantRoles`) even from the name owner, with `authorizeTextRoles`/`authorizeAddrRoles`
— functions absent from the generic page — the calls that actually succeed. This document
treats the **resolver-specific** behaviour (measured) as authoritative for anything routed
through the Permissioned Resolver, and the **generic page's** function names as describing the
underlying Enhanced Access Control library in the abstract, not this resolver's dispatch table.

**The non-negotiable settlement boundary this whole document is subordinate to** (owner rule,
restated from the assignment, not re-derived): an ENS record must never redirect a live UNICA
settlement. For an existing market or order, payout address, token addresses, chain id, hook,
executor, amount, minimum output and bound payer are fixed by the **contracts**. ENS may aid
discovery **before** order creation; the order then binds the resolved identity immutably. Every
class evaluated below is scored against this rule as much as against gas or privacy — a class
that could tempt a client into re-resolving a name **after** order creation is a defect
regardless of its other properties.

## 1. Method — the columns every candidate class is scored on

Per the assignment, each class below is scored on: why it needs a name at all · who creates it ·
who controls it · transferable · expiry · own registry · own resolver · wildcard suitability ·
records exposed · who may update each · how it is revoked · what parent revocation does · what
evidence survives revocation · gas · privacy. "Own registry" and "own resolver" are asked
because ENSv2 makes both **optional per name** — a name can be *served* by an ancestor's resolver
under wildcard resolution (ENSIP-10, §0) with no registry of its own at all, or it can be
*registered* with its own `PermissionedRegistry` and resolver proxy, deployed on demand via the
Verifiable Factory (OFFICIAL, `docs.ens.domains/ensv2/overview`, §0). `docs/ensv2/
DELEGATION-PLAN.md` names these **`subtree` mode** (served, no registry, 13 transactions, only
the parent's owner signs) and **`subregistry` mode** (registered at every level, three registries
deployed, 20 transactions, the owner then the merchant sign) — both are live options for every
class below, not a single fixed choice, and §9 states which default this document recommends per
class.

A class is **rejected** (§10) when its only justification is "ENS makes this possible," not "a
payer, an auditor, or a delegated writer needs to resolve or authenticate this specific thing
before an order exists." That test is applied literally below, not decoratively.

## 2. Candidate class: merchant root

| Column | Answer |
|---|---|
| Why a name at all | The one thing a payer resolves **before** an order exists (non-negotiable boundary, §0). Without this class nothing else in the hierarchy has a reason to exist. |
| Who creates | The merchant onboarding flow (BACKEND_POLICY) requests it; the actual `setResolver`/`register()` transaction is signed by whoever owns `<owned-parent>` — the UNICA operator in `subtree` mode, the merchant in `subregistry` mode (both per `DELEGATION-PLAN.md`, ENSV2_ONCHAIN). |
| Who controls | The merchant, once records are set — subject to the mode split below. |
| Transferable | **`subregistry` mode: yes** — ownership is a registry token (`ETHRegistry.ownerOf`, observed non-zero and readable, `UNICA-ETH-ADDR-REPORT.md` §2, ENSV2_ONCHAIN). **`subtree` mode: no** — nothing is registered, so there is no token to transfer; the name exists only as long as the parent's resolver serves it. |
| Expiry | `subregistry`: yes, a registry expiry (`getExpiry` read as `1979061984`, roughly 2032, on the repo's own pinned example — ENSV2_ONCHAIN, `UNICA-ETH-ADDR-REPORT.md` §2). `subtree`: none of its own; it lives and dies with the parent's resolver pointer. |
| Own registry | Only if the merchant must itself register further names beneath its own root with independent ownership semantics — i.e. only under `subregistry` mode. Not needed to be *served*. |
| Own resolver | **Yes, in either mode** — this is where `pay.`/`treasury.`/`agent.` records live, and is exactly the "every account gets its own Permissioned Resolver proxy" pattern the official overview describes (OFFICIAL, §0). |
| Wildcard suitability | High — `subtree` mode is precisely ENSIP-10 wildcard resolution: an unregistered `merchant.<parent>` is answered by the parent's resolver with the merchant's own records (VERIFIED mechanism, DELEGATION-PLAN.md's fork measurement: `setText` at an **unregistered** `pay.merchant.raffy.eth` was accepted and read back). |
| Records exposed | Address record (discovery), avatar (ENS-ART-LAYER.md NFT reference, ENSIP-12), a display/status text key. **Never** the fields the non-negotiable boundary fixes at the contract layer. |
| Who may update | The merchant (subregistry) or whoever the parent-resolver's `ROOT_RESOURCE`/scoped role names (subtree) — never a blanket grant wider than the merchant's own node's resource. |
| How revoked | `subregistry`: burn the relevant Enhanced Access Control role, or let the registration lapse at expiry. `subtree`: overwrite or clear the record — there is nothing registered to formally "revoke." |
| What parent revocation does | If the parent's resolver pointer changes or the parent registration lapses, **every name served beneath it stops resolving instantly**, in both modes — this is the single point of failure `DELEGATION-PLAN.md` already names as a residual ("subtree capture NOT tested"). |
| What evidence survives revocation | **Nothing, from ENS itself** — a resolver's current-state view has no history. The only durable trail is what a settled **UNICA** order already recorded independently (`UnicaExecutorV3.Order.recipient`, read once at order creation and never re-resolved — `UNICA-ETH-ADDR-REPORT.md` §8, UNICA_ONCHAIN) or what a Graph-indexed log of `EACRolesChanged`/`text(...)`-setting transactions captured before the change (GRAPH_EVIDENCE — see `docs/unica-v5/graph/`, sibling stream). |
| Gas | Registering the root itself: **UNKNOWN** — no first-party measurement exists anywhere in this repository; `register()` has never been executed (`ENS-OWNER-ACTION.md` marks it an owner-wallet step not yet done). Setting its address record: **44,339 gas, live-measured** (`ENS-OWNER-ACTION.md` §"What it costs", ENSV2_ONCHAIN, Sepolia gas price 1.07 gwei on 2026-09-08). |
| Privacy | None to protect — a merchant discovery name is meant to be public by design; this is the one class in this document where "more public" is the goal, not a leak. |

## 3. Candidate class: terminals

**Rejected as a name class — see §10 for the full reasoning.** Summary against the columns: a
terminal (a physical point-of-sale device) is never something a **payer** resolves before paying
— the payer only ever needs the merchant's own name (§2); a terminal identifier is an internal
attribution field UNICA's own receipt/settlement data already carries at the contract or
BACKEND_POLICY layer, not something that benefits from a globally-resolvable DNS-shaped name.
Giving each terminal its own subname buys no capability a plain field does not already provide,
and multiplies the "own resolver"/"parent revocation" and gas questions of §2 by the terminal
count for zero new capability — exactly the shape of class the assignment asks to reject and
justify.

## 4. Candidate class: staff

**Rejected as its own class, folded into agents (§5) where it earns a name at all — see §10.**
Staff differ from terminals in one respect: a staff member *can* have a legitimate reason to
hold a **scoped write role** (e.g. a shift lead toggling an "open/closed" status text key)
without being handed control of the whole merchant name. But Enhanced Access Control grants a
role to an **account** (`authorizeTextRoles(dns, key, account, true)` — DELEGATION-PLAN.md,
ENSV2_ONCHAIN), not to a name; the staff member needs no ENS name of their own to receive that
grant. Where a staff member's role additionally warrants **public capability disclosure** — the
same reason `agent.treasury.merchant.<p>` exists at all (§5) — that staff member is, from ENS's
perspective, simply an instance of the agent class, and is named as one rather than invented as
a second parallel hierarchy level.

## 5. Candidate class: agents

| Column | Answer |
|---|---|
| Why a name at all | Not the cryptographic delegation itself (that binds an **account** to a **resource**, no name required) but the **public capability disclosure** the delegation is meaningless without: a payer or auditor needs somewhere to read what this delegate claims it may do, independent of trusting the merchant's own say-so. `DELEGATION-PLAN.md` states the leaf is written "while the agent still holds nothing" — the name exists to publish metadata, not to grant authority. |
| Who creates | The merchant (the node's owner), before the delegate holds any role at all. |
| Who controls | The merchant controls the leaf's existence and every record except the one key the agent is scoped to; the agent controls **only** that one text key, and only after `authorizeTextRoles` grants it. |
| Transferable | No — a delegation slot, not an asset. If the delegate changes, revoke and re-grant to a new account; the leaf name is not sold or moved. |
| Expiry | PROPOSED: none via registry expiry (a multi-year instrument, §2, unsuited to agent liveness that can change hourly). Freshness is a **published timestamp text field**, read and judged stale by CLIENT_VERIFICATION — an unrenewed registry expiry says nothing about whether an agent is still trustworthy today. |
| Own registry | No — a leaf, never a parent to anything further. |
| Own resolver | No — served by the **same** Permissioned Resolver as the merchant root; this is exactly the wildcard case ENSIP-10 exists for (§0). |
| Wildcard suitability | High, by construction — `DELEGATION-PLAN.md`'s own `subtree` mode never registers the agent leaf. |
| Records exposed | Public capability descriptors, a liveness/heartbeat key, a protocol-version key. Never `pay.`/`treasury.` values — those resources are protected and the agent holds nothing there (`DELEGATION-PLAN.md` §"the role planner refuses; it does not merely avoid," every row naming `PROTECTED_RESOURCE` or `REGISTRY_TARGET_FORBIDDEN`). |
| Who may update | The merchant, for everything; the agent, for exactly one `SET_TEXT`-scoped key at its own per-key resource (VERIFIED per-record granularity, §0; fork-corroborated `DOCUMENTED_NOT_OBSERVED`-on-the-live-network per the same reconciliation). |
| How revoked | `authorizeTextRoles(dns, key, agent, false)` — the same function, the flag flipped. Fork-measured at **41,622 gas** (`DELEGATION-PLAN.md`, ENSV2_ONCHAIN on a fork of the deployed bytecode). |
| What parent revocation does | If the merchant's own resolver pointer changes, the agent leaf stops resolving with it — same single point of failure as §2. If only the **role** is revoked (resolver untouched), only that one key's write path closes; every other record the agent never controlled keeps resolving unaffected. |
| What evidence survives revocation | The resolver's **current** state, none — but the grant and the revoke are each an `EACRolesChanged` **event**, and an event is an immutable log entry, not mutable state. `DELEGATION-PLAN.md` observed this event directly: topic 0 matched the derived signature, topic 1 the resource, topic 2 the account, data the old→new bitmap (ENSV2_ONCHAIN, fork). A GRAPH_EVIDENCE indexer over that log — not the resolver's live-read surface — is what actually survives a later revocation. |
| Gas | Grant: **89,280 gas**, fork-measured. Revoke: **41,622 gas**, fork-measured. Both against the deployed Permissioned Resolver bytecode (`DELEGATION-PLAN.md`). |
| Privacy | Capability/liveness text is meant to be public — this is a defense-in-depth signal, not a secret, matching the "commitment, never a value" discipline already applied to treasury policy (`DELEGATION-PLAN.md` §"Nothing secret reaches the chain"). |

## 6. Candidate class: markets

**Rejected as a name class — see §10.** A market's identity is already its own on-chain
address/id in the (SPECIFIED-NOT-BUILT, `docs/unica-v4/EVENT-SCHEMA.md`, `SPEC-CONTRACTS.md`)
registry; a payer never types or resolves a market name — they resolve the **merchant**, and the
merchant's `pay.` record already carries the chain id, executor and hook fields a market needs
(UNICA_ONCHAIN data, exposed via an ENSV2_ONCHAIN record). A per-market subname would only
duplicate registry data in a second, independently-writable, unauthenticated place — a liability
under the non-negotiable boundary (§0), not a discovery improvement.

## 7. Candidate class: receipts

**Rejected as a name class in the general case — see §10 and `docs/unica-v5/ens/
RECEIPT-NAMING.md` (this stream) for the full comparison of five alternative discovery models.**
Summary for this document's own columns: a receipt is an immutable event that already has a
unique, chain-native id (transaction hash plus log index, per the graph sibling's own schema
description, GRAPH_EVIDENCE); naming it in ENS adds nothing a direct lookup by that id does not
already give, while multiplying every "own registry"/"gas"/"parent revocation" question in this
document by the daily receipt count. `RECEIPT-NAMING.md` §7 states which of the five compared
models this document's own reasoning here converges on.

## 8. Candidate class: identity / renderer classes

**Rejected as a distinct namespace level — absorbed into the merchant root's own `avatar`
record.** `docs/unica-v4/ENS-ART-LAYER.md` (repo file, PROPOSED, read 2026-09-11) already fixes
the shape: an NFT avatar is referenced from the **merchant's own name** in the ENSIP-12 CAIP-22
format `eip155:<chainId>/erc721:<contractAddress>/<tokenId>` — the art token is pointed **at**
by a record, it is not itself a name, and a renderer version is a small, code-level enumeration
inside the token's own metadata (H6: `output = f(normalized_name, renderer_version)`), not a
per-entity identity that benefits from DNS-shaped hierarchy. Giving renderer versions their own
subnames (e.g. a hypothetical `renderer-v2.<parent>`) would create a second place — independent
of the ERC-721 contract's own version tag — that could drift from what the token actually
implements, which is a correctness risk for zero discovery gain.

## 9. The recommended hierarchy — smallest first

```
<owned-parent>                         PROPOSED default: subtree (served) mode
  merchant.<owned-parent>              §2 — served by wildcard; own resolver, no own registry
    pay.merchant.<parent>              §2 — protected resource; UNICA_ONCHAIN settlement fields
    treasury.merchant.<parent>         §2 — protected resource; commitment only, never a value
      agent.treasury.merchant.<p>      §5 — ONE leaf per delegate needing public disclosure
                                             (subsumes staff-as-agent, §4; zero leaves if no
                                             delegate needs disclosure at all)
```

Nothing for terminals (§3), nothing for staff-in-general (§4), nothing for markets (§6),
nothing for receipts as individual names (§7), nothing for identity/renderer as a level (§8).
Every node above already exists in `DELEGATION-PLAN.md`'s design; this document's contribution
is the negative space around it — four candidate classes evaluated and rejected by name, with
the reasoning recorded rather than assumed.

**Mode recommendation, PROPOSED:** `subtree` (served, shared resolver, wildcard) by default for
every merchant; `subregistry` (registered, own resolver+registry proxy) only for a merchant that
specifically needs a **transferable, independently-owned** name — most merchants need neither
property. **This default rests on two grounds, both self-contained and independent of any other
document this stream wrote**, not on a citation chain that loops back through them: (1) `subtree`
mode costs fewer transactions — 13 vs. 20, a fork-measured count already recorded in
`docs/ensv2/DELEGATION-PLAN.md` (repo file, written before this stream existed, not part of it) —
and (2) it bounds the number of independently-initialized, authority-holding resolver instances to
one per parent rather than one per merchant, a structural property of the `subtree`/`subregistry`
split this section (§1) already states, true regardless of merchant count. Neither ground depends
on `SCALABILITY.md` or `RECEIPT-NAMING.md` reaching any particular conclusion. `docs/unica-v5/ens/
SCALABILITY.md` §6 (this stream) is cited only as **forward-pointing elaboration** of the scale at
which ground (2) stops being a minor property and starts being load-bearing — it restates this
section's own recommendation at each modeled volume (`SCALABILITY.md` §7 says so explicitly: "this
section does not introduce a new design, it states which of the already-recommended defaults
applies") rather than supplying a conclusion this section then imports back.

## 10. Rejected classes, and why

| Class | Why it exists only because it is possible | What replaces it |
|---|---|---|
| Terminals | No payer ever resolves a terminal name; it is an attribution field, not a discovery target. A name buys no capability a plain id does not. | A terminal id is a field inside receipt/settlement data (UNICA_ONCHAIN / BACKEND_POLICY), never an ENS label. |
| Staff (general) | Enhanced Access Control grants roles to accounts, not names — no staff member needs a name to receive a scoped grant. | The role grant directly, to the staff member's account; a name only if that staff member also needs public capability disclosure, in which case they are an **agent** (§5), not a new class. |
| Markets | A market's identity is already its on-chain address/id; the payer resolves the merchant, not the market, and the merchant's own protected record already carries the market-shaped fields. | The merchant's `pay.` record content, cross-referenced against the on-chain registry — never a second, independently-writable ENS copy of the same facts. |
| Receipts (individual names) | A receipt already has a unique chain-native id; naming it duplicates that id in a form that costs gas and does not scale (`RECEIPT-NAMING.md`, this stream, §1 and §6). | One of the four alternatives compared in `RECEIPT-NAMING.md` — none of which is a name per receipt. |
| Identity/renderer (as a level) | A renderer version is a handful of code-level values across the project's life, not a per-entity identity; giving it a name creates a second, driftable source of truth next to the token's own metadata. | The merchant's own `avatar` record (ENSIP-12) plus the ERC-721 token's own version field. |

## 11. Sources

| URL | Retrieved | Author/Org | Kind | Used for |
|---|---|---|---|---|
| https://docs.ens.domains/ensip | 2026-09-11 | ENS | OFFICIAL | ENSIP index and numbers (§0, cross-checked against `PEER-COMPARISON.md`'s own stated method) |
| https://docs.ens.domains/ensip/10 | 2026-09-11 | ENS (nick.eth, 0age) | OFFICIAL | Wildcard resolution mechanism, Final status (§0, §2, §5) |
| https://docs.ens.domains/ensv2/ | 2026-09-11 | ENS | OFFICIAL | ENSv2 beta-on-Sepolia confirmation |
| https://docs.ens.domains/ensv2/overview | 2026-09-11 | ENS | OFFICIAL | Registry/subregistry chain model, Enhanced Access Control replacing the Name Wrapper, per-account Permissioned Resolver, Verifiable Factory (§0, §1) |
| https://docs.ens.domains/ensv2/permissioned-resolver | 2026-09-11 | ENS | OFFICIAL | Resource derivation formula, role bit positions, per-record/per-key granularity statement (§0, load-bearing for the conflict reconciliation) |
| https://docs.ens.domains/ensv2/enhanced-access-control | 2026-09-11 | ENS | OFFICIAL | Bitmap layout (32 roles + 32 admin roles), `ROOT_RESOURCE`, 15-assignee cap (§0) |
| https://docs.ens.domains/registry/eth | 2026-09-11 | ENS | OFFICIAL | L1 **mainnet** `.eth` registration/renewal fee schedule ($5/$160/$640 by length) — cited only to keep mainnet cost separate from the Sepolia beta this document designs for |
| https://docs.ens.domains/wrapper/overview | 2026-09-11 | ENS | OFFICIAL | Name Wrapper / fuses — the ENSv1 mechanism Enhanced Access Control supersedes (§0) |
| https://docs.ens.domains/learn/deployments | 2026-09-11 | ENS | OFFICIAL | ENSv2 Sepolia beta contract addresses (Registry, Universal Resolver, Verifiable Factory, Permissioned Resolver implementation) |
| https://ethglobal.com/events/ethonline2026/prizes/ens | 2026-09-11 | ETHGlobal | OFFICIAL | ETHOnline 2026 ENS track requirements ("built on ENSv2 (Sepolia)," "central to the product, not a cosmetic add-on," "functional... not hard-coded") — the operational constraint this whole document designs under |
| `integrations/ensv2/README.md`, `ENS-OWNER-ACTION.md`, `permissioned.mjs`, `roles.mjs` | 2026-09-11 | this repository | TEAM GUIDANCE | Live-measured chain facts, gas figures, the original DOCUMENTED_NOT_OBSERVED provenance limit (§0) |
| `docs/ensv2/DELEGATION-PLAN.md` | 2026-09-11 | this repository | TEAM GUIDANCE | The already-adopted hierarchy, fork-executed per-key resource finding, gas figures, subtree/subregistry mode comparison, EAC residual findings (§0, §2, §5, §9) |
| `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` | 2026-09-11 | this repository | TEAM GUIDANCE | Registered-name expiry example, token id / `ownerOf` mechanics, order-recipient immutability (§2) |
| `docs/unica-v4/ENS-ART-LAYER.md` | 2026-09-11 | this repository | TEAM GUIDANCE | Avatar/renderer determinism rule (H6), ENSIP-12 CAIP-22 reference format (§8) |
| `docs/v2/SECURITY-ADVISORY-001.md` | 2026-09-11 | this repository | TEAM GUIDANCE | Cross-reference only, for the payer-binding discipline the non-negotiable boundary (§0) restates |
| `docs/unica-v5/graph/SCALABILITY.md` | 2026-09-11 | this repository (sibling stream) | TEAM GUIDANCE | Indexing-vs-settlement separation framing, reused here as ENS-naming-vs-indexing (§7 cross-reference) |

**Fetched, no usable content for this document's questions (not UNREAD — the page loaded):**
`https://docs.ens.domains/ensv2/registry` returned only site navigation; no subregistry gas or
Verifiable-Factory transaction-cost content was recovered from it.

## 12. Unknowns

1. **No first-party gas figure exists anywhere in this repository for `register()` itself** —
   only for `setAddr`, `setText`, and `authorizeTextRoles`/its revocation (§2, §5). Registration
   has never been executed, live or on a fork. Any scalability arithmetic that needs a
   registration cost (see `SCALABILITY.md`, this stream) must say so and use an explicit,
   labelled estimate rather than this repository's own measurement.
2. **Whether every per-name Permissioned Resolver proxy is initialized the same way** — the one
   proxy this repository has read grants `ROOT_RESOURCE` to **two** accounts, not one
   (`DELEGATION-PLAN.md`), which is why `subtree` mode's step 2 keeps a live simulation rather
   than trusting the pattern. This document inherits that unresolved question rather than
   closing it.
3. **Whether `subtree`-mode "capture" is real** — a stranger registering a label under an
   attached-but-unused subregistry, then calling `setResolver` to take over resolution for that
   label's subtree, is a residual `DELEGATION-PLAN.md` states outright as untested, because
   testing it needs a deployed `PermissionedRegistry` this repository will not deploy. This
   document's §9 recommendation to prefer `subtree` mode is made with that residual open, not
   despite having closed it.
4. **Whether the "fork execution" standard this document uses to distinguish VERIFIED-as-designed
   from DOCUMENTED_NOT_OBSERVED-on-the-live-network is the right bar**, or whether the owner
   wants nothing promoted at all short of a transaction the maintained Sepolia network itself
   processed. §0's reconciliation states both readings; which one governs future documents in
   this repository is the owner's call, not this document's.
5. **No transcript of any ENS channel discussion reached this document.** Every claim above is
   built from official ENS documentation, this repository's own prior measurements, or is marked
   PROPOSED/UNKNOWN — nothing here attributes a design choice to an unavailable discussion.
