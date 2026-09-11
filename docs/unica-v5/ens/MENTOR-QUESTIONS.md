# UNICA v5 / ENS — mentor questions, answered from public sources first

These ten questions are answered here from official sources wherever the sources settle them.
Nothing here is a question sent to a person; each is closed with a citation or left open, marked as
needing written confirmation from an identifiable ENS team member, per project rule. Retrieval date
2026-09-11 unless stated otherwise. Labels: VERIFIED (source cited), PROPOSED (UNICA design
reasoning), DOCUMENTED_NOT_OBSERVED, UNKNOWN. Reads against `docs/unica-v5/ens/PRIZE-FIT.md` and
`DEMO-PLAN.md`, which this file does not repeat.

## Q1. Does parent revocation prevent escape through SET_RESOLVER or SET_SUBREGISTRY?

**Answered for `SET_SUBREGISTRY` from an official source: yes, by a documented "emancipation"
pattern — but the mechanism is revocation on the child's own resource, not automatic propagation
down from a parent. `SET_RESOLVER`'s equivalent is not documented anywhere fetched for this file.**

VERIFIED — the ENSv2 Contracts documentation on hierarchical registries (retrieved 2026-09-11)
describes "emancipated registries": a `PermissionedRegistry` is deployed with **no root-level admin
roles** granted to the eventual owner, `setSubregistry()` links it into the parent, and the deployer
then revokes `ROLE_SET_SUBREGISTRY` from whoever held it. Quoted: "Once you revoke
`ROLE_SET_SUBREGISTRY`, you cannot undo it unless you also retained that role at the root level."
The result: nobody, including the original deploying/parent-side account, can re-point that
registry's subregistry pointer again. This is the mechanism, not "the parent revokes something and
it cascades down" — the child registry's *own* resource is what gets its role permanently emptied,
at deployment time, before the temporary holder gives it up.

**What is not documented anywhere fetched for this file:** whether the identical pattern applies to
`ROLE_SET_RESOLVER` (revoke it, with no root-level retention, to permanently lock the resolver
pointer). The Enhanced Access Control model is generic — roles are per-resource bitmap grants
checked the same way regardless of which specific role bit is being tested — so by construction of
the access-control system itself, the same revoke-without-retaining-root pattern should work
identically for `ROLE_SET_RESOLVER`. **This is PROPOSED reasoning by symmetry of the underlying
mechanism, not a documented statement**, and no example or worked case for the resolver-specific
version was found. **Needs written confirmation.**

## Q2. Can initialize(grants, calls) atomically establish key-scoped setter roles and drop temporary root administration?

**No function literally named `initialize(grants, calls)` was found in any source fetched. The
practical effect the question asks about is documented, but as a two-step pattern, not a single
named atomic call.**

VERIFIED, `ROOT_RESOURCE` mechanics (<https://docs.ens.domains/ensv2/enhanced-access-control>,
retrieved 2026-09-11): `ROOT_RESOURCE` is the constant `0`, representing contract-wide authority;
`grantRoles`/`revokeRoles` explicitly **reject** `ROOT_RESOURCE`, requiring the separate
`grantRootRoles`/`revokeRootRoles` calls instead — a deliberate API-level fence around root
authority, not an accident of naming.

VERIFIED, the emancipation pattern (Q1): a `PermissionedRegistry`'s eventual owner can be granted
scoped, non-root roles **at deployment time** ("subdomainOwner: 0 // No root-level admin roles!" is
the documented constructor-time pattern), after which a **separate** call revokes the temporary
holder's `ROLE_SET_SUBREGISTRY`. This achieves the practical outcome the question describes —
key-scoped roles established, temporary root-level administration dropped — but as at least two
transactions (deploy-with-scoped-grants, then revoke), not one atomic `initialize(grants, calls)`
call. A `VerifiableFactory` deploys registries and resolvers as proxies and its `deployProxy`
performs a `CREATE2` clone followed by an `initialize` call
(<https://github.com/ensdomains/verifiable-factory>, search-summarized, retrieved 2026-09-11,
COMMUNITY-adjacent — this is ENS's own factory repository but the specific fetch used was a search
summary, not a direct read of the source), but no `grants`/`calls`-array signature for that
initializer was found in any source fetched. **Needs written confirmation** whether a single
atomic call bundling scoped grants with a root-drop exists anywhere in the ENSv2 contract set, or
whether the two-step pattern above is the actual, intended mechanism.

## Q3. Does a shared PermissionedResolver suit many read-only terminal subnames?

**Answered from an official source: yes, provided the terminal subnames are all owned by the same
account as the merchant root — the Permissioned Resolver is per-account, not per-name, and this is
also the exact design UNICA's own `roles.mjs` already implements.**

VERIFIED (<https://docs.ens.domains/ensv2/permissioned-resolver>, retrieved 2026-09-11): "each
account gets its own resolver instance, deployed as a UUPS-upgradeable proxy," and "all names owned
by the same account share one resolver." Separately, VERIFIED
(<https://docs.ens.domains/web/ensv2-readiness/>, retrieved 2026-09-11), the migration guidance for
applications that write to ENS states plainly: "Use per-account Permissioned Resolvers instead of
shared ones" — meaning the thing that must not be shared is a resolver **across unrelated
accounts**, not a resolver across many names **one** account owns.

Read together with Enhanced Access Control's per-resource role model (roles are checked against
`(resource, account)` pairs on one resolver instance, not against separate resolver deployments per
name — Q1, Q2), this settles the question for UNICA's actual shape: the merchant account owns the
root and, by extension, the one Permissioned Resolver instance that serves it and every subname
under it; terminal operators are given **scoped, per-key roles on that single shared instance** via
`authorizeTextRoles` (the mechanism `PRIZE-FIT.md` §6 already measures), rather than each terminal
needing its own resolver deployment. **This is exactly the architecture
`integrations/ensv2/roles.mjs` already builds calldata for** — one resolver, many scoped grants — so
this is not a new design question so much as a confirmation that the existing design matches the
documented pattern. The one caveat found is a general one from the mintlify architecture
documentation, unrelated to resolvers specifically but worth carrying: creating a **registry** shared
across two names is explicitly discouraged ("⚠️ WARNING: This is usually NOT what you want! Both
names would share the same subdomain namespace" — retrieved 2026-09-11) — a warning about shared
*registries*, not shared *resolvers*, and this design does not propose a shared registry.

## Q4. How should service capabilities be exposed — ENSIP-25 / 26 / 27 / vendor records?

VERIFIED, from official/ENS DAO governance-forum sources retrieved 2026-09-11 (search-summarized;
the direct fetch of `docs.ens.domains/ensip/25` succeeded, `ensip25.ens.domains` returned no
extractable content):

- **ENSIP-25** (status: Draft, created 2025-10-02, per the direct fetch of
  `docs.ens.domains/ensip/25`) defines a text-record key format,
  `agent-registration[<registry>][<agentId>]`, that verifies an ENS name is genuinely associated
  with an on-chain AI-agent-registry entry (e.g. ERC-8004). `<registry>` is an ERC-7930
  interoperable address; `<agentId>` is the registry's own identifier. Its own stated security note:
  if the ENS name is later transferred, existing verification records may go stale, so a verifying
  client must re-check freshness rather than trust a cached record.
- **ENSIP-26** defines two text-record types for discovery: `agent-context` (free-form capability,
  chain-coverage, token-support description) and `agent-endpoint[<protocol>]` (a per-protocol
  connection URI; named supported protocols include MCP, A2A, OASF, and web).
- **ENSIP-27** defines the schema for the JSON document served at the well-known path
  `/.well-known/agent.json`, fetched after resolving an ENSIP-26 endpoint record — the piece
  ENSIP-26 deliberately left open.

**For UNICA's own "vendor records" framing** (a merchant's service capabilities, as opposed to an
AI agent's), none of ENSIP-25/26/27 is written for a non-agent merchant use case, and no source
fetched proposes a distinct "vendor record" ENSIP. The closest fit for exposing a merchant's own
capabilities (accepted assets, chain, executor — the fields UNICA already commits into a signed
quote, `integrations/ensv2/config.mjs`, `identity.mjs`) is a plain text record under a project-owned
key namespace, not one of the ENSIP-25/26/27 keys, which are agent-specific by design. **This
question, as asked, conflates two different capability-exposure needs (AI-agent discovery vs.
merchant service capabilities); this file treats them separately rather than forcing one answer.**
Whether an ENS team member would recommend adopting the ENSIP-26 pattern (protocol-keyed endpoint
records) for a non-agent merchant use case, rather than a bespoke key, is **UNKNOWN — needs written
confirmation.**

## Q5. Does an NFT avatar plus deterministic renderer with EAC-governed subnames count as a meaningful ENSv2 integration?

**Partially answered: the two halves (avatar, EAC-governed subnames) are each independently
meaningful per the track's own wording; no source addresses whether combining them clears a higher
bar than either alone.**

VERIFIED, the track's own bar (`PRIZE-FIT.md` §3): ENSv2 features must be "central to the product,
not a cosmetic add-on," and the named focus areas explicitly include "permissioned resolvers" and
"Enhanced Access Control... delegated permissions." A tree of EAC-governed, independently-revocable
subnames (§4–§6 of `DEMO-PLAN.md`) is, on the page's own wording, squarely inside the named focus —
it is the load-bearing mechanism of the demo, not decoration. An avatar alone, by contrast, is
explicitly a **read-only display feature** in UNICA's own design (`docs/unica-v4/ENS-ART-LAYER.md`
H11: "the image alone is never treated as proof of payout identity") — which cuts the other way for
the "central, not cosmetic" bar if the avatar were the *only* ENSv2 feature shown, since it is by
design never load-bearing for anything.

**PROPOSED reasoning, not a confirmed answer:** combining a deterministic, renderer-versioned avatar
(H6, "same normalized name + same renderer version → same art, forever") with EAC-governed,
revocable subnames plausibly strengthens rather than dilutes the story — the avatar becomes a visible
signal of an identity whose *authority* is independently, mechanically verifiable via EAC, rather
than a decorative image sitting beside an unrelated resolution. Whether ENS's judges would read it
that way, or would read the avatar as scope creep away from the track's named EAC/revocation focus,
is not addressed by any source fetched. **Needs written confirmation.** Separately, and unconditional
on that answer: the avatar half is not planned to be built for this event regardless
(`docs/unica-v5/ens/PRIZE-FIT.md` §7, `DEMO-PLAN.md` §5 phase 3) — `ENS-ART-LAYER.md` itself is
"planned, not implemented" and gated on the v4 specification commit, so this question is answered
here for the record but does not change this event's build scope.

## Q6. What is the preferred high-volume receipt discovery model?

**Not settled by any official recommendation — and the one community project built to fill this gap
is archived.**

VERIFIED, official guidance (<https://docs.ens.domains/ensv2/indexing>, retrieved 2026-09-11): the
page states the ENSv2 contracts and interfaces "are not yet final and may change prior to mainnet
deployment," names **no** recommended indexing service (not The Graph, not any named successor), and
instead documents a DIY event-driven discovery pattern: start by watching the known `RootRegistry`
and `ETHRegistry` addresses; when a `SubregistryUpdated` event names a new subregistry address, add
it to the watch list; watch the `VerifiableFactory`'s `ProxyDeployed` event to catch registries and
resolvers "at deployment time" rather than missing them between deployment and first use (a
documented "blind spot" otherwise). Named events for this pattern: `LabelRegistered`,
`SubregistryUpdated`, `ResolverUpdated`, `EACRolesChanged`, `ProxyDeployed`.

VERIFIED, separately (<https://docs.ens.domains/web/subgraph/>, retrieved 2026-09-11): the official
Subgraph docs page makes no statement about ENSv2 compatibility at all in the content fetched; a
general web search (not a direct official-page fetch) characterizes the legacy ENS Subgraph as
architecturally mismatched with ENSv2's off-mainnet, hierarchical name issuance, but that specific
characterization is **not corroborated by a direct official-page quote** and is recorded as
UNCONFIRMED rather than VERIFIED.

VERIFIED (<https://github.com/namehash/ensnode>, retrieved 2026-09-11): ENSNode, described on its
own repository as "the full-stack development platform for ENSv2" and maintained by NameHash Labs
("backed by the ENS DAO as an official ENS Service Provider"), aimed to be exactly this successor —
a unified query API across ENSv1 and ENSv2. **The repository is marked `[ARCHIVED]` and was archived
2026-08-05**, roughly five weeks before this retrieval. So the one ENS-DAO-affiliated project built
specifically to answer this question is not presently a going concern.

**Conclusion for UNICA's own use, PROPOSED:** for the runway available (`DEMO-PLAN.md` §1), the
demo does not need high-volume discovery at all — it reads a small, known set of names (one root,
one or two terminals) directly via `eth_call`, which sidesteps this question entirely rather than
answering it. For any future v5 work that does need to discover many merchant subnames at scale, the
official, currently-live answer is the DIY event-driven pattern above, not an off-the-shelf indexer.
**Needs written confirmation** whether an ENS team member has a currently-maintained recommendation
that supersedes the archived ENSNode project.

## Q7. What does the prize require of direct contract interaction?

**Not stated as an explicit requirement on the official page fetched for this file.**

VERIFIED (`PRIZE-FIT.md` §3): the page's bar is functional, not procedural — "central to the product,
not a cosmetic add-on" and "functional and not just include hard-coded values." Nothing in the text
fetched requires bypassing the ENS App's own UI or forbids using it; the resources the page itself
names include "tutorials for contract and app developers" (plural, i.e. both paths are catered for).
UNICA's own existing integration already exceeds a plain-UI bar by construction — resolution and
authorization are read via `eth_call` in code on every run, not through the ENS App
(`docs/SPONSOR-ELIGIBILITY.md` §4) — so this question does not gate anything UNICA already does, but
the research brief's own referenced lead ("direct contract registration") as a *requirement* is **not found on
the page and is not addressed by any other source fetched. Needs written confirmation** whether a
stricter, unpublished rule (e.g. from the workshop video named on the prize page but not viewed for
this file) exists.

## Q8. What are the compatibility concerns for non-transferable identity NFTs as avatars?

**Answered from an official standard: technically compatible in principle; no ENS-specific statement
addresses it directly.**

VERIFIED (<https://eips.ethereum.org/EIPS/eip-5192>, retrieved 2026-09-11, status Final): a minimal
soulbound NFT implements `function locked(uint256 tokenId) external view returns (bool)` plus
`Locked`/`Unlocked` events, and requires only that "all EIP-721 functions of the contract that
transfer the token from one account to another must throw" once locked. Read-only ownership
functions (`ownerOf`, `balanceOf`) are not among the functions the standard requires to throw — the
standard is silent on them, which in EIP-721's own terms means they continue to behave normally.

VERIFIED (`docs/unica-v4/ENS-ART-LAYER.md` §4.2, citing ENSIP-12 directly, retrieved 2026-09-11): a
client resolving an NFT avatar performs an **ownership** check — "verify that address owns the
referenced NFT" — via the standard `ownerOf`/`balanceOf` calls, not via a transfer. Since a
soulbound token under ERC-5192 still answers those read calls normally, **a non-transferable
identity NFT is, in principle, compatible with ENSIP-12's own resolution steps** — the avatar
ownership check does not depend on the token ever being transferable.

**What is not addressed by any source fetched:** whether any deployed ENS-ecosystem client (wallet,
explorer) actually special-cases or rejects a `locked()`-true token when resolving an avatar, as
distinct from the bare EIP-721/ENSIP-12 read path working. `docs/unica-v4/ENS-ART-LAYER.md` §10
already records, independently, that "real-world client support for a Sepolia NFT-reference avatar"
is unverified for *any* NFT, transferable or not — this question inherits that same open item rather
than adding a new one specific to non-transferability. **Needs written confirmation.**

## Q9. Which deployment identifier prevents confusing this deployment with ordinary Sepolia ENS?

**Answered, and cross-verified by exact address match against this repository's own on-chain reads
(`PRIZE-FIT.md` §10) — the identifier is the resolver's own ERC-1967 implementation address, which
this repository's tooling already checks.**

VERIFIED, raw page text (<https://docs.ens.domains/learn/deployments>, retrieved 2026-09-11): Sepolia
carries **two** separate deployments at different addresses under one chain id (`11155111`), listed
as "Sepolia (ENSv2 Beta)" and "Sepolia (Legacy)." The page states plainly of the legacy set: "these
ENSv1 contracts still exist on Sepolia but are no longer in use: the Universal Resolver and the ENS
apps for Sepolia are linked against the ENSv2 deployment above" — meaning the **same**
`UpgradableUniversalResolverProxy` address (`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, identical
across Mainnet, Sepolia, and Holesky per the same page) now routes to the ENSv2 stack rather than the
legacy one. **Chain id alone does not distinguish the two deployments — the same proxy address is
reused.** What does distinguish them is what that proxy currently resolves a name's resolver *to*:
under ENSv2, a name's resolver is a 77-byte proxy whose ERC-1967 implementation slot points at
`PermissionedResolverImpl` (`0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e`); under the legacy ENSv1 set,
it would be the old Public Resolver (`0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`, listed on the same
page under "Sepolia (Legacy)"). **This is exactly the check `integrations/ensv2/`'s own tooling
already performs** — reading the ERC-1967 implementation slot and classifying anything that is not
`PermissionedResolverImpl` as `NOT_A_PERMISSIONED_RESOLVER` (`ENS-OWNER-ACTION.md` §Step 1) — so the
existing repository code is already the correct deployment-identifier check, not something new to
build.

**Separately, and directly relevant to whether UNICA's deployment could be confused with an
*isolated, non-canonical* ENSv2 instance rather than with legacy ENSv1:** `PRIZE-FIT.md` §10 already
establishes, by exact address match against the same official page, that UNICA reads the **canonical,
shared** Sepolia ENSv2 Beta deployment, not a separately-deployed instance. The research brief's referenced
leads about an "isolated deployment" and "Universal Resolver override" remain UNVERIFIED — no source
fetched confirms or denies that a *different* team's isolated ENSv2 deployment would look identical
to this canonical one from the outside (same contract bytecode, different addresses), which is the
actual scenario a "deployment identifier" would need to rule out. **Needs written confirmation.**

## Q10. What are the canonical events or read methods for enumerating scoped grants and revocations?

**Answered from an official source, and consistent with what this repository has already
independently measured about the read methods' limits.**

VERIFIED (<https://docs.ens.domains/ensv2/enhanced-access-control>, retrieved 2026-09-11): the one
documented event is `EACRolesChanged(resource, account, oldRoleBitmap, newRoleBitmap)`, emitted on
every grant or revoke. Documented read methods: `roles(resource, account)` (the effective bitmap),
`hasRoles(resource, roleBitmap, account)` (boolean check), `roleCount(resource)`, and
`getAssigneeCount(resource, roleBitmap)`. **No enumeration method — a way to list every account
holding a role at a resource — is documented anywhere fetched.** This matches, independently,
`docs.ens.domains/ensv2/indexing`'s own event list (Q6), which names `EACRolesChanged` as the
event to watch rather than describing any on-chain enumeration call.

VERIFIED (repository, `integrations/ensv2/README.md`, "Two things measured"): this absence of
enumeration is not merely a documentation gap — it is operationally real. This repository's own
`getAssigneeCount(uint256,uint256)` call, against the deployed contract, returns **two words**
where the documentation describes one `uint256`, and a bounded `eth_getLogs` scan for
`EACRolesChanged` over a load-balanced public Sepolia endpoint returned inconsistent results across
three consecutive identical runs (one matching log, then none, then one). The repository's own
conclusion — treat a log scan as something that can only *add* names to a holder list, and treat
`roleCount(resource)` as the authority on how many holders exist, printing both numbers side by side
whether or not they agree — is the practical answer to "how do you enumerate scoped grants" given
the documented tools' own limits, and this file adopts the same discipline rather than proposing a
different one. **Whether ENS intends a proper enumeration method to ship before ENSv2 reaches
mainnet (the same page states the interfaces are "not yet final," Q2/Q6) is UNKNOWN — needs written
confirmation.**

## Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ENS Docs — Hierarchical Registries (mintlify) | https://ensdomains-contracts-v2.mintlify.app/concepts/hierarchical-registries | 2026-09-11 | ENS Labs | OFFICIAL | Q1, Q2 — emancipated-registry pattern, quoted |
| ENS Docs — Enhanced Access Control | https://docs.ens.domains/ensv2/enhanced-access-control | 2026-09-11 | ENS Labs | OFFICIAL | Q1, Q2, Q10 — ROOT_RESOURCE mechanics, EACRolesChanged, read methods |
| ENS Docs — Permissioned Resolver | https://docs.ens.domains/ensv2/permissioned-resolver | 2026-09-11 | ENS Labs | OFFICIAL | Q3 — per-account resolver sharing model |
| ENS Docs — ENSv2 Readiness | https://docs.ens.domains/web/ensv2-readiness/ | 2026-09-11 | ENS Labs | OFFICIAL | Q3 — "per-account Permissioned Resolvers instead of shared ones" |
| ENS Docs — ENSv2 Overview | https://docs.ens.domains/ensv2/overview/ | 2026-09-11 | ENS Labs | OFFICIAL | Q1 — hierarchical registry background |
| ENS Docs — ENSv2 Indexing | https://docs.ens.domains/ensv2/indexing | 2026-09-11 | ENS Labs | OFFICIAL | Q6, Q10 — official event-driven discovery pattern, named events |
| ENS Docs — Subgraph | https://docs.ens.domains/web/subgraph/ | 2026-09-11 | ENS Labs | OFFICIAL | Q6 — no ENSv2 statement found in the content fetched |
| ENS Docs — Deployments | https://docs.ens.domains/learn/deployments | 2026-09-11 (raw page text) | ENS Labs | OFFICIAL | Q9 — the two Sepolia deployments and their addresses, quoted |
| ENSIP-25 | https://docs.ens.domains/ensip/25 | 2026-09-11 | ENS DAO / ENS Labs | OFFICIAL | Q4 — status, text-record key format, quoted |
| ENSIP-26, ENSIP-27 (via governance forum / blog, search-summarized) | https://discuss.ens.domains/t/ensip-27-agent-card-schema-well-known-agent-json/22130 and related | 2026-09-11 | ENS DAO | OFFICIAL (forum posts by the proposing team) | Q4 — text-record types, agent card schema |
| ERC-5192: Minimal Soulbound NFTs | https://eips.ethereum.org/EIPS/eip-5192 | 2026-09-11 | Ethereum Foundation (EIPs repository) | OFFICIAL | Q8 — locked() interface, transfer-only restriction |
| ENSNode (archived) | https://github.com/namehash/ensnode | 2026-09-11 | NameHash Labs | COMMUNITY (self-described ENS DAO-backed Service Provider) | Q6 — archived status of the one built successor indexer |
| ENS Verifiable Factory (search-summarized) | https://github.com/ensdomains/verifiable-factory | 2026-09-11 | ENS Labs | OFFICIAL, low-confidence extraction (search summary, not a direct read) | Q2 — deployProxy/initialize pattern |
| `docs/unica-v4/ENS-ART-LAYER.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | Q5, Q8 — avatar determinism, ENSIP-12 ownership check, open items |
| `integrations/ensv2/roles.mjs`, `README.md`, `ENS-OWNER-ACTION.md` (this repository) | n/a — local files | 2026-09-08/09 | UNICA / NFTeria | TEAM GUIDANCE | Q3, Q9, Q10 — the existing design and measurements this file checks against official sources |
| `docs/unica-v5/ens/PRIZE-FIT.md` (this stream) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | Q5, Q6, Q9 — the deployment cross-check and runway findings this file relies on |

## Unknowns

1. Whether the same emancipation-by-revocation pattern documented for `ROLE_SET_SUBREGISTRY` (Q1)
   applies identically to `ROLE_SET_RESOLVER` — reasoned by symmetry of the access-control mechanism,
   not confirmed by any worked example found.
2. Whether a single atomic function bundling scoped-role grants with dropping temporary root
   administration exists anywhere in the ENSv2 contract set, as opposed to the two-step
   deploy-then-revoke pattern this file found documented (Q2).
3. Whether ENS's judges would recommend the ENSIP-26 protocol-keyed endpoint-record pattern for a
   non-agent merchant's own service-capability records, or consider that a misuse of an
   agent-specific standard (Q4).
4. Whether combining a deterministic avatar with EAC-governed, revocable subnames is read by judges
   as a stronger integration than either alone, or as scope creep away from the track's named
   EAC/revocation focus (Q5) — not resolved by this event's build scope regardless (the avatar is not
   built this event).
5. Whether an ENS team member has a currently-maintained high-volume discovery recommendation that
   supersedes the archived ENSNode project (Q6).
6. Whether the prize page's plain-functionality bar hides an unpublished, stricter direct-contract-
   interaction requirement referenced only in the workshop video named on the prize page but not
   viewed for this file (Q7).
7. Whether any deployed ENS-ecosystem client special-cases a locked (non-transferable) NFT when
   resolving an ENSIP-12 avatar, beyond the bare read-path compatibility this file establishes (Q8) —
   inherits an existing open item from `docs/unica-v4/ENS-ART-LAYER.md` §10 rather than adding a new
   one.
8. Whether a different team's isolated ENSv2 deployment (same contract source, different addresses)
   would be visually or procedurally distinguishable from the canonical one to a judge who does not
   independently check the ERC-1967 implementation slot, and whether ETHGlobal or ENS requires that
   check as a matter of policy rather than of this repository's own practice (Q9).
9. Whether ENS intends to ship a proper on-chain enumeration method for Enhanced Access Control role
   holders before ENSv2 reaches mainnet, given the documented interfaces are stated as "not yet
   final" (Q10).
10. The submission-deadline conflict carried from `PRIZE-FIT.md` §3 and `DEMO-PLAN.md` §1
    (2026-09-13 vs 2026-09-16) bears on how much of this file's own open items are worth pursuing
    further before the event closes — not a mentor question in its own right, but named here because
    it gates how much of the above is worth chasing this week versus after.
