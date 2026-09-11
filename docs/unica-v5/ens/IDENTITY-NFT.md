# UNICA v5 — Identity NFT and deterministic SVG renderer

Draft for owner review. Nothing here is committed, deployed, compiled, or published; it authorizes
no mint, no ENS record write, no registry deployment, and no signature. This document designs a
versioned ERC-721 whose art is a pure function of a normalized ENS merchant name, an explicit
renderer version, and an explicit ENSv2 deployment identifier — never of mutable payout data — and
separates six things a careless implementation would blur into one. It restates, repeatedly, that
this NFT is an anti-substitution cue and never proof of payout identity; the interface verifies name
and address independently, every time.

Track: the owner confirmed 2026-09-11 that this is UNICA's **from-scratch** entry. No transcript of
any ENS sponsor-channel discussion was supplied for this document. Nothing below reports,
summarizes, or attributes an idea to a discussion that did not arrive. The claims repeated in the
brief that trace back to that missing transcript — an isolated deployment, a Universal Resolver
override, invalid old `initialize`/`authorize` interfaces, direct contract registration, "MockUSDC
is not Circle USDC," and manager-UI failures — are treated below as **UNVERIFIED LEADS**, checked
against primary sources where this document's scope touches them and otherwise named as
out-of-scope and left to the documents that already own that ground (§0.3).

Every material claim below is labelled **VERIFIED** (with source), **PROPOSED** (UNICA design),
**DOCUMENTED_NOT_OBSERVED**, or **UNKNOWN**. Every action described carries exactly one authority
label: **ENSV2_ONCHAIN**, **UNICA_ONCHAIN**, **BACKEND_POLICY**, **GRAPH_EVIDENCE**,
**CLIENT_VERIFICATION**, or **OFFCHAIN_OPERATION**.

## 0. Status and scope

- **Status: design only.** No contract described here exists. `vy/src/art/` and `vy/src/math/` are
  empty (VERIFIED, repo state, read 2026-09-11, matching `docs/unica-v4/ENS-ART-LAYER.md` §1's own
  status line). This document does not start that build; it designs one part of what that plan's
  own commit sequence (§9 there) will eventually implement, and it is explicit everywhere about
  which of its own proposals are additions to that plan versus restatements of it.
- **Read first, stayed consistent with:** `docs/unica-v4/ENS-ART-LAYER.md` (H1–H12, the binding
  decisions) and, for the read-layer half of the same surface, `docs/unica-v5/graph/ENS-NFT-SCHEMA.md`
  — a sibling document, cited throughout, never edited. Where this document proposes something that
  document's schema does not yet fix (the ENSv2 deployment identifier axis, §4.2; the seed-encoding
  recommendation, §4.3), it says so as a recommendation for that document's own open fields, not as
  an edit to it.
- **Track conflict, resolved.** ETHGlobal's own current ENS prize page (VERIFIED, S8, retrieved
  2026-09-11) names two separate ENS tracks: **"Best Use of ENSv2"** ($4,500 total, no
  pre-existing-project requirement stated) and **"Best Integration of ENSv2 into Existing
  Project"** ($500, explicitly "Continuity Track participants only," and explicitly requiring
  "integration against existing project testnets rather than building from scratch"). The brief's
  mention of "Continuity" names the second, ineligible track. Given the owner's from-scratch ruling,
  UNICA targets the first track only; the second is out of scope by construction, not a conflict
  requiring a judgment call. Also VERIFIED (S8): the track's own framing repeatedly invites
  identity-shaped submissions — "ENS is how you give them a name, a reputation, and a place to be
  found" — which is consistent with, but does not itself require, an identity NFT; nothing in the
  fetched page text ties prize eligibility specifically to an avatar NFT (§15, item 13).
- **Out of scope, explicitly.** Registration or resolver state of any name (owned by
  `integrations/ensv2/ENS-OWNER-ACTION.md`); `grantRoles`/`authorizeTextRoles` semantics and
  per-key resource scoping (owned by `integrations/ensv2/permissioned.mjs` and its own
  `DOCUMENTED_NOT_OBSERVED` ledger); the ENS manager app's own UI behavior; anything about
  `MockUSDC` versus Circle USDC (a settlement-layer question, not an identity-layer one). This
  document does not re-derive or contradict any of those; it points to them.
- **Path isolation, inherited.** `docs/unica-v4/ENS-ART-LAYER.md` H3 fixes that no settlement
  contract, script, or test imports the art or math layer, enforced by a dependency-boundary test
  (that plan's §5). This document adds nothing that weakens that boundary; every determinism input
  named in §4 below is either a name string, a version label, or a deployment identifier — never a
  settlement-side value.
- **The non-negotiable boundary, restated once here in full, then again at every place it could be
  misread (§5.2, §5.5, §5.6, §14).** An ENS record must never redirect a live UNICA settlement. For
  an existing order the recipient, tokens, chain id, hook, executor, amount, minimum output, and
  bound payer are fixed by the contracts and read once, before the order exists — never
  re-resolved at settlement. This is not a promise this document makes; it is a property this
  repository's own contracts already have, evidenced concretely in
  `integrations/ensv2/ENS-OWNER-ACTION.md` §8 ("Effect on existing orders — none... The recipient is
  resolved once, client-side, *before* the order exists, and is then stored on chain... Settlement
  reads only that stored value and never re-resolves a name," VERIFIED repo file, read 2026-09-11).
  An identity NFT sits entirely upstream of that moment and has no mechanism to reach past it.

## 1. Sources and their status

| # | Source | Author / org | Kind | Retrieved | Used for | Conflicts |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | `docs.ens.domains/ensip/12` | ENS | OFFICIAL | 2026-09-11 | Avatar NFT URI format, the four-step client resolution procedure, the SHOULD-level ownership check, Final status (2022-01-18) | None found; matches `docs/unica-v4/ENS-ART-LAYER.md` §4 and `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` S1's own citation of the same page |
| S2 | `docs.ens.domains/ensip/15` | ENS | OFFICIAL | 2026-09-11 | Status (Final, created 2023-04-03), scope (Unicode 8.0.0–17.0.0, IDNA + UTS-51 emoji), that normalization is deterministic and idempotent, `ens-normalize.js` as the named reference implementation | None; matches `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` S2's own citation |
| S3 | `raw.githubusercontent.com/ensdomains/ensips/master/ensips/15.md` | ENS (canonical ENSIPs source repository) | OFFICIAL | 2026-09-11 | The exact bidi rule ("normalized labels are never bidirectional," full names may still mix label directions), the Maximum NSM count (4) and NSM-uniqueness rule, the whole-script-confusable mechanism, the Combining-Mark whitelist rule (currently empty for every listed script group), and the explicit absence of any stated label/name length limit | None found. This is the first place in this repository's documents that quotes ENSIP-15's bidi and NSM text directly rather than citing the page's general existence |
| S4 | `eips.ethereum.org/EIPS/eip-721` | Ethereum EIPs | OFFICIAL | 2026-09-11 | The three-field Metadata JSON Schema (`name`, `description`, `image` — no more, no fewer), the `tokenURI(uint256) external view returns (string)` signature, and the explicit "the URI MAY be mutable" permission | None; matches `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` S3 |
| S5 | `raw.githubusercontent.com/ChainAgnostic/CAIPs/main/CAIPs/caip-22.md` | Chain Agnostic Standards Alliance | OFFICIAL (for that standard) | 2026-09-11 | The `erc721` asset-reference grammar and its chain-**scoped** (one chain id per reference, not mainnet-restricted) reading | None; confirms and restates precisely the same correction `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` S5 already made against `docs/unica-v4/ENS-ART-LAYER.md` §4.1's looser "chain-agnostic" phrasing |
| S6 | `docs.opensea.io/docs/metadata-standards` and `docs.opensea.io/docs/media-and-traits` | OpenSea | OFFICIAL for OpenSea's own product; COMMUNITY-tier as an ecosystem-wide convention (one marketplace, not a standards body) | 2026-09-11 | Confirmed supported fields (`name`, `description`, `image`, `animation_url`, `attributes`, `background_color`, `external_url`); confirmed OpenSea caches and auto-converts SVG to PNG for its own display; confirmed a 300 MB externally-hosted media ceiling | **Gap, not a conflict.** Neither fetch's returned text confirmed an `image_data` (raw inline SVG) field that community write-ups commonly attribute to OpenSea. §6.2 records this as UNKNOWN rather than asserting it |
| S7 | `docs.vyperlang.org/en/stable/compiling-a-contract.html` | Vyper project | OFFICIAL | 2026-09-11 | The `bytecodeMetadata` compiler-settings flag (default `true`, embeds a Vyper signature in bytecode), the pragma-based reproducibility recommendation, and the `-f integrity` compiler output for confirming two builds match | None |
| S8 | `ethglobal.com/events/ethonline2026/prizes/ens` | ETHGlobal | OFFICIAL (event organizer) | 2026-09-11 | The two ENS prize tracks and their eligibility (§0), resolving the brief's "Continuity" tension | None; resolves rather than conflicts |
| S9 | `eips.ethereum.org/EIPS/eip-4906` | Ethereum EIPs | OFFICIAL | 2026-09-11 | `MetadataUpdate`/`BatchMetadataUpdate` events, Final status — used in §5.2 to name the standard route for live-changing metadata and explain why this design declines it for the image field | None |
| S10 | `docs.ens.domains/ensip/1` | ENS | OFFICIAL | 2026-09-11 | The exact recursive namehash algorithm and its published test vectors | None. **Gap recorded honestly (§9):** the fetched text gives the algorithm but does not itself assert namehash's one-wayness in prose; that property is attributed here to the general preimage-resistance of the underlying hash, not to ENSIP-1's own wording |
| — | `raw.githubusercontent.com/ensdomains/docs/master/ensip/15.mdx` | ENS (attempted mirror path) | — | attempted 2026-09-11 | — | **UNREAD.** HTTP 404 on the first attempt. Superseded by S3, a different canonical path that succeeded; nothing below is sourced to this dead URL |

Secondary sources, retrieved through search aggregation rather than a direct primary-page fetch for
this document, and treated as corroborating background rather than primary citations —
the same convention `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` applies to its own search-derived row:

| Topic | Where it points | Kind | Used for |
| --- | --- | --- | --- |
| Confusable/skeleton detection mechanism | Unicode Consortium, UTS #39 "Unicode Security Mechanisms" (`unicode.org/reports/tr39`) | OFFICIAL (for that standard), retrieved via search summary only | §8.3 — the general mechanism ENSIP-15's whole-script-confusable check is built from; the primary `confusables.txt` mapping tables were not independently reviewed |
| `<img>` tags do not execute embedded SVG `<script>` content | General search aggregation, one named source `packetwanderer.com/posts/svg-xss/` | COMMUNITY | §7.4, §12.2 — the basis for requiring `<img>`-only display of any resolved avatar SVG |
| OWASP sanitization guidance (avoid `innerHTML` for untrusted markup, prefer a hardened sanitizer) | OWASP Cheat Sheet Series (`cheatsheetseries.owasp.org`) | OFFICIAL guidance body, retrieved via search summary only | §7.4, §12.2 |
| A historical Vyper compiler nondeterminism bug (function ordering), reported fixed at 0.3.8 | General search aggregation | COMMUNITY, not independently re-verified against a changelog here | §11.2 — motivates pinning the exact build, not only the version string |
| Mixed wallet support for base64-encoded on-chain SVG `tokenURI` values (OpenSea renders them; a MetaMask mobile issue and forum thread describe gaps) | `github.com/MetaMask/metamask-mobile` issue #6200; `community.metamask.io` thread | COMMUNITY, dates and current status not independently re-tested | §12.1 |
| On-chain SVG NFT precedent and general gas-shape reasoning (Loot, Autoglyphs) | Assorted engineering write-ups | COMMUNITY | §11.1 — context only, never a number this document asserts for UNICA's own renderer |

Repository files read for this document (dated by their own "read" convention, all 2026-09-11):
`docs/unica-v4/ENS-ART-LAYER.md`, `docs/unica-v4/DECISIONS.md` ("ENS art layer," H1–H12),
`docs/unica-v4/EVENT-SCHEMA.md`, `docs/unica-v4/SPEC-CONTRACTS.md`, `docs/v2/SECURITY-ADVISORY-001.md`,
`docs/ensv2/UNICA-ETH-ADDR-REPORT.md`, `integrations/ensv2/README.md`,
`integrations/ensv2/ENS-OWNER-ACTION.md`, `vy/src/namemath.vy`, `vy/src/logobackground.vy` (headers
and structure, not full line-by-line review). `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` was read in
full and is cited throughout as a sibling document; it is never edited by this one.

## 2. Read first: what `docs/unica-v4/ENS-ART-LAYER.md` already fixes, and what this document adds

VERIFIED, that plan's own text, not re-argued here: the layout split (`vy/src/math/` vs
`vy/src/art/`, H1), the minimum-scope ceiling (namemath, logobackground, their math, and a new SVG
renderer only, H2), the dependency-boundary test (H3), the base determinism rule ("`output =
f(normalized_ens_name, renderer_version)`... never a function of mutable data," H6), descriptive
naming (H7), the exact Vyper pin discipline (H8), the test-plan shape (H9), legacy-file handling
(H10), the checkout-side "art beside independently resolved identity, never instead of it" behavior
(H11), and the plan/build-only-after-spec/cut-first sequencing (H12).

This document's additions, each marked PROPOSED where it first appears and never presented as an
amendment to H1–H12: a third determinism input, the ENSv2 deployment identifier (§4); an explicit
position on the seed-encoding question that plan leaves open (§4.3); the six-way layer separation
the assignment for this document asks for by name (§5); a concrete on-chain byte-allowlist guard
(§8.6); a named collision risk in leaf-label seeding (§4.3, §13.3); and a golden-vector test design
split specifically along the ASCII-confusable/Unicode-confusable line that this repository's own
ASCII-only gate creates (§8.2, §13.1) — none of which that plan's text states, because none of it
was in scope for a plan written before this document's own assignment existed.

## 3. What exists today (read, not re-derived)

- **The art layer is SPECIFIED-NOT-BUILT.** No file exists under `vy/src/art/` or `vy/src/math/`
  (VERIFIED, repo state). `vy/src/namemath.vy` and `vy/src/logobackground.vy` are the Sept 8 legacy
  copies (VERIFIED, repo files): self-contained, no imports, `pragma version 0.4.3`. Their new
  versioned successors do not exist.
- **`logobackground.vy`'s own comment states its seed mechanism directly** (VERIFIED, repo file):
  "The seed is keccak256 of a label, so a given name always yields the same automorphism, the same
  lattice field, and the same palette." Its module-level `_seed` takes a `String[64]` (VERIFIED,
  repo file) — whether callers today pass a bare label or a full dotted name is not settled by the
  file's header alone, and matters directly for §4.3 and §13.3.
- **ENSv2 resolution and authorization are BUILT and live-tested against Sepolia**, entirely
  outside this document's scope: `web/ensv2/resolve.mjs` (ASCII-conservative normalization,
  `dnsEncode`, ENSIP-1 namehash, `resolveMerchant`), `integrations/ensv2/permissioned.mjs` (Enhanced
  Access Control reads), and the pinned chain facts this document reuses in §4.2 — chain id
  `11155111`, `UpgradableUniversalResolverProxy` and `PermissionedResolverImpl` (VERIFIED,
  `integrations/ensv2/ENS-OWNER-ACTION.md`/`README.md`, measured at block 11663994).
  `unica.eth` itself resolves to the zero address on Sepolia as of the last recorded read
  (VERIFIED, `docs/ensv2/UNICA-ETH-ADDR-REPORT.md`) — no live merchant name is usable as an art-layer
  input yet.
- **UNICA v4 contracts do not exist.** Their event surface (`docs/unica-v4/EVENT-SCHEMA.md`,
  `SPEC-CONTRACTS.md`) is specified only. Neither file names an ENS, avatar, or NFT dependency
  (checked directly, this document's own read) — confirming H3's boundary from the settlement side,
  not only the art side.
- **`docs/unica-v5/graph/ENS-NFT-SCHEMA.md` already designs the read layer over this surface.** Its
  `ArtSeed`, `RendererVersion`, `RendererDeployment`, `IdentityNFT`, `Token`, `AvatarRecord`, and
  `IdentityMismatch` entities (all SPECIFIED-NOT-BUILT, its own §2/§5) are the indexing counterpart
  to the contract this document designs. Where the two overlap, this document points at that
  schema's field names rather than inventing new ones (§4.3, §10.3).

## 4. The determinism formula

### 4.1 The three inputs, precisely

**PROPOSED**, building on the VERIFIED H6 rule above:

```
ArtInputs = (normalizedName, rendererVersion, ensv2DeploymentId)
```

- **`normalizedName`** — the ENSIP-15-normalized (today, ASCII-conservative-approximated per
  `web/ensv2/resolve.mjs`, §8.2) **full dotted merchant name** — e.g. the whole string a checkout
  would resolve, not a bare label. §4.3 explains why "full name," not "label," is load-bearing.
- **`rendererVersion`** — the descriptive version label (H7) that names exactly one immutable
  `RendererDeployment` — `(chainId, contractAddress)` — per
  `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §4.2/§5 (repo file, PROPOSED there, read 2026-09-11):
  "a renderer version is not a mutable field on a shared contract — it is a separate contract
  deployment." A version and its deployment are one thing, not two independently-variable axes.
- **`ensv2DeploymentId`** — **new in this document**, PROPOSED. Identifies which ENSv2 instance's
  namespace validated the name at the time its art was derived — concretely, a value computed from
  this repository's own pinned Sepolia facts (chain id `11155111`, the
  `UpgradableUniversalResolverProxy` address, the `PermissionedResolverImpl` address; all VERIFIED,
  §3), for example `keccak256(chainId ‖ universalResolverProxyAddress)` as the deployment-identifying
  hash — the exact construction is an implementation-time choice, not fixed here. **Never a
  production ENS mainnet address**: the only value this axis takes today is the Sepolia ENSv2 beta
  deployment already pinned in this repository, satisfying the isolation rule structurally rather
  than by discipline alone.

### 4.2 Why "renderer version" and "ENSv2 deployment identifier" are two different axes

`rendererVersion` answers "which bytecode drew this." `ensv2DeploymentId` answers "which namespace
does this name string belong to." These are genuinely independent: the same textual name
(`"acme.unica.eth"`, say) could in principle exist under two different ENSv2 deployments over time —
a beta migration to a new proxy address, or, eventually, an ENSv2 mainnet deployment distinct from
today's Sepolia beta — meaning two entirely unrelated registrations, owners, and merchants could
share the same string. Without this axis, art derived from the string alone would collide across
those two unrelated merchants, defeating the anti-substitution purpose this whole design exists for.

**Honest scope of this finding:** with exactly one ENSv2 deployment in play (H5: "ENSv2 Sepolia
only"), this axis is a constant today, and adding it costs nothing. It becomes load-bearing only if
UNICA ever derives art against a second ENSv2 instance — **UNKNOWN** whether that will ever happen
(§15, item 5). This document includes the axis now because retrofitting a determinism input after
tokens have already been minted under a two-input formula is the kind of change H6 exists to make
impossible; naming it from the start costs one extra fixed field.

### 4.3 The seed: string, label, or namehash — and the collision risk of getting it wrong

`docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §4.1/§5 leaves `ArtSeed.sourceEncoding: "STRING" |
"NAMEHASH"` **open** (repo file, read 2026-09-11) — precisely because
`docs/unica-v4/ENS-ART-LAYER.md` §3.3 says only "normalized_ens_name," not which encoding of it, and
`logobackground.vy`'s own `_seed(name)` takes a bounded string without settling whether callers pass
a bare label or the full dotted name (§3).

**The risk, stated plainly:** if the deployed contract's seed input is only the leaf label
(`"acme"`) rather than the full name (`"acme.unica.eth"`), two different merchants under two
different parent names who happen to choose the same label collide into **byte-identical seeds and
byte-identical art** — defeating the entire anti-substitution purpose for exactly the pair of
merchants a payer would most need to tell apart.

**PROPOSED requirement:** the seed input is either (a) the full normalized dotted name string, or
(b) its ENSIP-1 namehash node (§9) — never the bare leaf label alone. This document recommends (b),
for two structural reasons:

1. **Fixed 32-byte size**, avoiding the `String[N]` long-name sizing problem entirely (§6.3, §8.5).
2. **Cryptographic binding of parent and label together by construction** — ENSIP-1's own recursive
   definition (§9, VERIFIED, S10) folds the parent's hash into every level, so two names sharing a
   label under different parents are namehash-distinct by the algorithm itself, not by a convention
   this document has to separately enforce.

**The trade-off, named honestly:** namehash is one-way (§9) — the human-readable name cannot be
recovered from the seed alone. The NFT's `name`/`description` metadata fields (§6) must carry the
human string as their own, separately-stored field, exactly as
`docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §4.7's field-authority table already treats "the raw, as-typed
merchant name" — its own field, never reconstructed from a hash.

This document records its recommendation for that sibling schema's open `sourceEncoding` field
without editing it: **PROPOSED — set to `"NAMEHASH"`** when the art token is implemented, for the
reasons above.

### 4.4 What is explicitly excluded from the formula

Excluded, and why, each VERIFIED against the cited rule:

- **Any payout address** (the `unica.pay` text record) — H3, H11.
- **Any merchant configuration commitment, EAC role state, or authority verdict** — H3; also
  `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §2's own reasoning for why `SettlementMerchant` is
  deliberately not materialized as an entity applies equally here: none of that state is a pure
  function of the name alone.
- **Any Market/Order/Settlement state** — out of reach regardless, since UNICA v4's contracts do
  not exist (§3); H3 forbids the dependency even once they do.
- **Wall-clock time, `block.number`, `block.timestamp`, or `msg.sender`** at generation time — a
  `tokenURI`/render call reading any of these for the SVG body would make two calls at different
  blocks for the same tokenId potentially disagree, contradicting H6 directly.
- **Any caller-supplied entropy beyond the three named inputs** — no salt, no nonce, no random seed.

**PROPOSED test, additive to `docs/unica-v4/ENS-ART-LAYER.md` §6's existing deterministic-rendering
golden tests:** assert `tokenURI` output bytes are identical across two calls for the same tokenId
made at different block numbers. That plan's text does not name this specific check; it is a direct
consequence of its own H6 rule, made explicit and executable here.

### 4.5 The optional creation epoch, and why it cannot be a fourth input to the art

The assignment for this document allows an *optional* immutable creation epoch. It cannot become a
fourth input to the art itself without contradicting the required property stated for this
document — "same normalized name plus same renderer version plus same deployment gives the same art
forever" names exactly three inputs as jointly sufficient. A creation epoch that varied per mint
(an actual mint timestamp, for instance) would make two mints of the same `(name, rendererVersion,
ensv2DeploymentId)` produce **different** art, breaking that property outright.

**PROPOSED resolution:** if used at all, "creation epoch" is a manually-versioned era label — bumped
deliberately, the same way `rendererVersion` is, never read from `block.timestamp` — recorded as a
plain, non-generative field on the minted token's identity facts (alongside
`docs/unica-v5/graph/ENS-NFT-SCHEMA.md`'s existing `IdentityNFT.mintedAtBlock`), for human and
dashboard readability only, and structurally excluded from whatever pure function computes the SVG.
**UNKNOWN** whether the owner wants this field at all (§15, item 6); it is safe to omit entirely,
and omitting it changes nothing else in this design.

## 5. Six things kept separate

Each of the six carries exactly one authority label. Three of the six restate the anti-substitution
rule directly, because those are the three a careless reader could most easily mistake for proof.

### 5.1 Immutable core art

The SVG bytes `svgrender` computes from `ArtInputs` (§4) alone. **Authority: UNICA_ONCHAIN** (once
the art token exists; SPECIFIED-NOT-BUILT today, §3). Recomputed identically on every read call —
never stored as a separate mutable field, never patched. Never includes a payout address, by
construction (§4.4).

### 5.2 Current operational-status overlay

A visual layer a checkout or dashboard draws **beside or around** the immutable art — a colored
ring, a badge, a corner glyph — reflecting live status: market ACTIVE/PAUSED/RETIRED once UNICA v4's
registry exists (`docs/unica-v4/EVENT-SCHEMA.md`, SPECIFIED-NOT-BUILT), or live EAC/binding
observations (`docs/unica-v5/graph/ENS-NFT-SCHEMA.md`'s `IdentityBindingObservation`).

**Authority: CLIENT_VERIFICATION**, sourced from a live **ENSV2_ONCHAIN** read (this repository's
existing `permissioned-live.mjs`/`merchant-config.mjs` pattern) or, once one exists, a
**GRAPH_EVIDENCE** indexed read. **Never** written into the token's stored bytes, its `tokenURI`
JSON, or the immutable SVG's own markup — composited at render time in the browser (an `<img>` for
the immutable art plus a separately-drawn badge on top, never merged server-side into one
re-hashable image), so §4.1's immutable art stays inspectable and provably unchanged regardless of
what the overlay currently shows. **Restated: this overlay conveys operational status, never
identity or payout proof.** EIP-4906's `MetadataUpdate` event (S9, VERIFIED) is the standard route
for signalling that a `tokenURI`'s JSON changed; this design declines to route live status through
it for the *image* specifically, precisely so the immutable image's own bytes never need a
"changed" event in the first place.

### 5.3 The ENS avatar record

The `avatar` text record on the merchant's resolver. **Authority: ENSV2_ONCHAIN**, and specifically
an **owner-wallet write** — nothing in this repository performs it (`docs/unica-v4/ENS-ART-LAYER.md`
§4.4, `integrations/ensv2/ENS-OWNER-ACTION.md`). Mutable, last-write-wins, the same property this
repository's own address-record reasoning already establishes (`ENS-OWNER-ACTION.md` §7: "An address
record is a mutable field, not an allocation... Call `setAddr` again with the new address. The last
write wins" — the identical mutability applies to `avatar`). Points at one `(contractAddress,
tokenId)` per ENSIP-12/CAIP-22 (§10). Changing this record changes **which minted token** a wallet's
avatar resolution shows; it cannot rewrite that token's own immutable facts (§4.8 in
`docs/unica-v5/graph/ENS-NFT-SCHEMA.md` gives the structural reason why not).

### 5.4 NFT metadata

The `tokenURI()` JSON envelope (§6): `name`, `description`, `image`, and any `attributes`, plus a
metadata-schema version distinct from the renderer version (`MetadataVersion`,
`docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §5). **Authority: UNICA_ONCHAIN.** Deterministic given the
same `ArtInputs`, versioned separately so the JSON *shape* can evolve without the SVG changing.

### 5.5 Checkout verification badge

A UI element distinct from the NFT and from the avatar record, showing the **live**, independently
performed cross-check `docs/unica-v4/ENS-ART-LAYER.md` §4.3 and
`docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §4.6 already specify: does the avatar-referenced NFT's
current owner match the independently-resolved payout address, checked at the moment of checkout,
never assumed from a cached or indexed value alone when a payment is imminent. **Authority:
CLIENT_VERIFICATION**, performing live **ENSV2_ONCHAIN** reads. **Restated: a PASS state means only
"no substitution detected as of this check," never "verified payout"; a WARN state is shown
plainly, never hidden or softened, exactly as H11 requires.**

### 5.6 Historical receipt snapshot

At settlement, the interface records — inside the settlement receipt itself, immutable once
written, following this repository's frozen receipt-schema discipline and the binding principle
Advisory 001 makes concrete (`docs/v2/SECURITY-ADVISORY-001.md`: an authorization that omits part of
what it should bind is exploitable; the general discipline it argues for is that an authorization
binds payer, merchant, asset, amount, chain, verifying contract, order-or-nonce, and expiry) — a
snapshot of exactly what the interface showed and checked at that moment: the resolved address, the
avatar reference and its parsed fields if any, the badge's PASS/WARN state (§5.5), and the block
number of each read. **Authority: BACKEND_POLICY**, assembling a record of **ENSV2_ONCHAIN** reads.

This snapshot exists because §5.2's overlay, §5.3's avatar record, and even §5.5's badge can all
look different tomorrow than they did at settlement — mirroring §0's restated non-negotiable
boundary directly: the recipient a settlement actually used is fixed at order creation and never
re-resolved, so the receipt is what proves what the payer was shown, never re-derived from today's
live state after the fact. **Restated a third time: none of this — the art, the badge, or the
snapshot — is proof of payout identity by itself; the contract's stored recipient is the only fact
that ever moved funds, and it was fixed before the identity layer's opinion could change.**

## 6. ERC-721 metadata and tokenURI design

### 6.1 What EIP-721 requires and does not require

VERIFIED (S4): the Metadata JSON Schema has exactly three fields — `name`, `description`, `image` —
no more are required by the standard itself. `tokenURI(uint256) external view returns (string)`; the
spec states plainly "the URI MAY be mutable." The spec's own prose ("Metadata is returned as a
string value. Currently this is only usable as calling from web3, not from other contracts")
describes how metadata is *consumed* — through an external, off-chain call — not a requirement that
the bytes themselves live off-chain. **PROPOSED reading:** an on-chain `data:` URI is fully
spec-compliant, because it is still returned exactly as a `string` from `tokenURI()`, consumed
identically by any caller.

### 6.2 The base64 JSON convention and its alternatives

`docs/unica-v4/ENS-ART-LAYER.md` §3.2 already establishes, correctly (VERIFIED, cross-checked
against S4 above): the `data:application/json;base64,...` wrapper with an embedded
`data:image/svg+xml;base64,...` image field is a widely used community convention, not a
requirement of EIP-721 or ENSIP-12.

An alternative convention, `image_data` (raw inline SVG markup, no base64/URI wrapper), is commonly
attributed to OpenSea in community write-ups. **This document attempted to confirm that field
directly against OpenSea's own documentation twice (S6) and could not** — neither the metadata
standards page nor the media-and-traits page's fetched text named an `image_data` field. **Recorded
as UNKNOWN, not asserted** (§15, item 4).

**PROPOSED:** ship the standard base64-wrapped `image` data URI as the sole image field — the one
both EIP-721 and ENSIP-12 name explicitly (S1, S4), and the one §12.1's wallet findings show
actually renders across the platforms checked. Do not add `image_data` unless a primary source
confirms its exact semantics before implementation.

### 6.3 Sizing: Vyper's fixed-size String/Bytes bounds against real SVG output

VERIFIED (`docs/unica-v4/ENS-ART-LAYER.md` §3.2, repo file): snekmate v0.1.2's reference bounds
(`String[512]`, 1024 bytes in / 1368 chars out) are undersized for this renderer's actual output;
exact bounds remain an implementation-time task that plan does not fix and this document does not
fix either. **PROPOSED addition** to that open task: sizing must be **worst-case-byte-length-aware**,
not glyph-count-aware — §8.5 explains why a `String[N]` bound is a byte bound, and why that matters
even under today's ASCII-only gate.

## 7. On-chain SVG assembly: escaping, injection, and why the generative design closes most of it

### 7.1 Why the image body needs no name-escaping

VERIFIED (`vy/src/logobackground.vy`, repo file, read 2026-09-11): the existing generative model
takes the name only to produce a `keccak256` seed that then drives geometry and palette selection —
the merchant name's literal characters are never written into the SVG's text nodes or attribute
values. **PROPOSED requirement, carried forward:** the new versioned renderer preserves this
property exactly — no `<text>` element anywhere in the generated markup contains the raw or
normalized name string. Because of this, the classic SVG/XML injection surface (an unescaped
user-controlled string spliced into markup, enabling `</text><script>...`) does not apply to the
image body **structurally**, not merely because of escaping discipline that could later lapse.

### 7.2 Where the name string still appears, and what that requires

The metadata JSON's `name`/`description` fields (§6) legitimately display the human-readable
merchant name. This needs ordinary JSON string escaping (quotes, backslashes, control characters —
mechanical, any correct JSON encoder handles it) plus the bidi/confusable handling of §8 — a
normalized-valid string can still spell something deceptive, which is a confusable problem (§8, §13),
not an escaping problem. **PROPOSED:** the `name` field is emitted through a JSON-escaping routine
tested against the same malformed-input corpus `docs/unica-v4/ENS-ART-LAYER.md` §6 already requires
for the image path.

### 7.3 What the renderer must never emit

**PROPOSED, structural, testable invariants:** no `<script>`; no `<foreignObject>`; no event-handler
attributes (`onload`, `onclick`, etc.); no external references (`xlink:href` to a non-`data:` URI, no
`<image href="http...">`); no `<style>` importing external CSS. Given the renderer's own vocabulary
is fixed geometry-plus-fill (per `namemath.vy`/`logobackground.vy`'s structure, VERIFIED), asserting
the absence of every item on this list is a cheap string-match test over the rendered output (§13.3).

### 7.4 Client-side display: `<img>` versus inline SVG versus `<object>`/`<iframe>`

An `<img src="data:image/svg+xml;base64,...">` is treated by common browsers as a static image and
does not execute embedded `<script>` content (COMMUNITY, search-aggregated, not independently
verified against a primary browser specification here — §1). `<object>`, `<iframe>`, direct
navigation to the data URI, or injecting the markup via `innerHTML`/`dangerouslySetInnerHTML` **do**
execute embedded scripts in the same sources' description, consistent with OWASP's general
DOM-based-XSS guidance (COMMUNITY, search-aggregated, §1).

**PROPOSED requirement** for any checkout or dashboard surface: always render a resolved avatar or
token image via `<img>` (or an equivalent non-executing image element); never
`innerHTML`/`dangerouslySetInnerHTML` fetched SVG markup. This matters beyond UNICA's own renderer:
**ENSIP-12 avatar resolution is generic across any ERC-721 contract** (§10) — a surface that resolves
avatars broadly, not only UNICA's own tokens, is exposed to arbitrary third-party SVG content and
must treat every resolved image as untrusted, regardless of how disciplined this repository's own
renderer is.

## 8. ENSIP-15 normalization, confusables, homographs, bidirectional controls, long names

### 8.1 ENSIP-15's own scope, as published

VERIFIED (S2, S3): status Final, created 2023-04-03; scope is standardizing ENS normalization across
Unicode's evolution (versions 8.0.0 through 17.0.0), explicit IDNA processing with UTS-51 emoji
support; normalization "is idempotent: applying normalization multiple times produces the same
result." The named reference implementation is the `ens-normalize.js` library (S2) — a JavaScript
library; no Vyper or general on-chain implementation is named by the standard itself.

### 8.2 This repository's normalizer versus the full standard

VERIFIED (`docs/unica-v4/ENS-ART-LAYER.md` §3.4, `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §4.1, both
repo files, and this document's own read of the same fact): `web/ensv2/resolve.mjs`'s normalizer is a
conservative ASCII-only approximation that refuses any non-ASCII input outright rather than
implementing confusable or bidi detection. This document inherits that gap; it does not resolve it.

**What this means concretely for the art layer:** every name that will ever reach `svgrender` has
already passed this refusal gate, so it is pure lowercase ASCII (`a`–`z`, `0`–`9`, hyphen, period).
This does **not** make ENSIP-15 irrelevant here — it sharpens exactly what matters: **ASCII-only
homoglyphs that require no Unicode at all** — `"rn"` vs `"m"`, `"vv"` vs `"w"`, `"cl"` vs `"d"`,
`"0"` vs `"o"`, `"1"`/`"l"`/`"I"`, `"5"` vs `"s"` — are exactly the confusable pairs that **do** reach
this renderer today, while full Unicode confusables (Cyrillic "а" versus Latin "a," per §8.3) are
excluded by the gate itself, not by anything this renderer does. §13.1 makes this split the spine of
the golden-vector test plan.

### 8.3 Confusables and homographs

VERIFIED (S3): "a label is whole-script confusable when a similarly-looking valid label can be
constructed using one alternative character from a different [Unicode] group" — ENSIP-15's own
mechanism progressively restricts permissible script groups as each character is evaluated. The
general technical foundation this builds on is Unicode's own UTS #39 confusable/skeleton mapping
(COMMUNITY-tier here, retrieved via search aggregation, not a direct fetch of the primary data
tables — §1; a future on-chain or off-chain implementation needing exact skeleton computation must
fetch `unicode.org/reports/tr39/confusables.html` or the `ens-normalize.js` reference data directly,
not this summary, §15 item 12).

### 8.4 Bidirectional control characters

VERIFIED (S3), quoted precisely: "Names may be composed of labels of different directions but
normalized labels are never bidirectional" — a single label may not mix left-to-right and
right-to-left scripts; a full dotted name may still contain labels of different directions (the
spec's own example: `bahrain.مصر` is valid; `bahrainمصر` combining both directions inside one label
is rejected for script mixing).

Since §8.2's ASCII-only gate refuses every non-ASCII character, and ASCII has no right-to-left
letters, **no bidi-mixing risk of any kind reaches the art layer today** — by refusal, exactly as
§8.2 argues for confusables generally. This document still proposes an on-chain defense-in-depth
check (§8.6) rather than resting entirely on the off-chain gate holding forever.

### 8.5 Long names and byte-length versus character-length

Vyper's `String[N]` bound is a **byte** bound, not a character bound (a general, uncontroversial fact
of EVM ABI string encoding). VERIFIED (S3): ENSIP-15's own text states no explicit label or name
length ceiling — "not mentioned in the normalization algorithm." So a `String[N]` sizing choice has
no ENS-side ceiling to lean on; it is a UNICA-local decision. Combined with §8.2's ASCII-only gate
(which caps expansion, since ASCII is exactly one byte per visible character, unlike a hypothetical
future Unicode-normalized name where composed forms could use more bytes than visible characters),
sizing today only needs to bound visible-character count 1:1 with bytes — but the bound must still be
chosen deliberately (not inherited from snekmate's undersized default, §6.3) and must **fail closed
(revert)** on an oversized name rather than silently truncate it, matching the "fails closed beyond
the declared grid" pattern `docs/unica-v4/ENS-ART-LAYER.md` §6 already requires of `namemath`/
`logobackground`.

### 8.6 A cheap on-chain guard, proposed

The art token cannot practically implement full ENSIP-15 on-chain — no normalization library exists
for Vyper, and the standard's own reference implementation is JavaScript (§8.1) — and it must not
simply trust that a caller-supplied string was properly normalized off-chain. **PROPOSED:** the
contract enforces a minimal, cheap byte-level allowlist at mint/render time — revert on any byte
outside `[a-z0-9.-]`, matching the off-chain gate's own accepted alphabet (cross-referenced against
`docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §4.1's description of `web/ensv2/resolve.mjs`'s behavior).
This is a single loop over bytes, needs no Unicode tables, and closes the gap where a future change
to the off-chain minting path could otherwise smuggle a byte the art contract has no independent way
to catch — including the bidi and NSM characters §8.3–§8.4 describe, none of which are ASCII.

## 9. labelhash and namehash

VERIFIED (S10), the exact recursive definition:

```
def namehash(name):
  if name == '':
    return '\0' * 32
  else:
    label, _, remainder = name.partition('.')
    return sha3(namehash(remainder) + sha3(label))
```

**labelhash** is the per-label step inside this recursion — `sha3(label)` for one segment.
**namehash** (the "node") is the full recursive fold, a fixed 32-byte value regardless of input
length. VERIFIED test vectors (S10): the empty name hashes to 32 zero bytes; `'eth'` and `'foo.eth'`
each have their own published 32-byte node value.

**One-wayness, precisely scoped:** the fetched ENSIP-1 text gives the algorithm; it does not itself
assert in prose that a name cannot be recovered from its node. This document attributes that
property to the general preimage-resistance of the underlying hash primitive, a cryptographic fact
independent of ENSIP-1's own wording — recorded here as a gap in what the primary source states
outright, not papered over (§15, item 11).

This is the concrete mechanism §4.3 recommends as the art seed's encoding: because each level folds
in the parent's own node, a namehash cryptographically binds label and parent together by
construction, closing the leaf-label collision risk §4.3 and §13.3 describe.

## 10. ENSIP-12 avatar resolution

### 10.1 The wire format

VERIFIED (S1, S5): `eip155:<chainId>/erc721:<contractAddress>/<tokenId>`. CAIP-22's own text defines
the reference as chain-**scoped** — one chain id per reference — and does not restrict that chain id
to mainnet; ENSIP-12's own worked example happens to use `eip155:1`, which both S1 and S5 read as
illustrative, not restrictive. Precisely as `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §4.4 already
states it (repo file, no restatement needed here beyond confirming the same reading independently).

### 10.2 The client procedure and its SHOULD-level ownership check

VERIFIED (S1), the four steps: retrieve the token's `tokenURI`; resolve it and fetch the ERC-721
metadata; extract `image`; resolve and display it. A client SHOULD additionally verify the name's
resolved address owns the referenced token; on failure it MUST treat the avatar URI as invalid.

**Authority split, stated once so it is not blended:** step 1 (retrieving `tokenURI`) is a
**UNICA_ONCHAIN** read against the art token; steps 2–4 and the ownership check are performed by
whatever wallet or dashboard is resolving the avatar, i.e. **CLIENT_VERIFICATION**, itself issuing
further **ENSV2_ONCHAIN** reads (the name's own `addr` and the art token's `ownerOf`). No single
label covers the whole procedure, because it spans two different systems.

### 10.3 What a subgraph can and cannot verify (pointer to the sibling document)

`docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §4.4 already states precisely what an indexer can honestly
claim here: it can parse the CAIP-22 string and compare two already-indexed fields (the referenced
token's on-chain-observed owner versus the name's currently resolved address), but it cannot perform
the live HTTP/RPC round trip ENSIP-12's own steps 2–4 require, because a subgraph mapping makes
neither kind of call. This document does not re-derive that finding; it is cited here only to keep
this document's own §5.5/§5.6 authority labels (`CLIENT_VERIFICATION`/`GRAPH_EVIDENCE` as genuinely
different things) consistent with that sibling schema's own boundary.

## 11. Renderer gas limits and determinism across compiler versions

### 11.1 Gas: what is measured, what is not

**UNKNOWN**, unchanged from `docs/unica-v4/ENS-ART-LAYER.md` §10's own line (VERIFIED, repo file):
"no gas benchmark exists yet for a several-KB on-chain SVG `tokenURI` on this toolchain." This
document does not manufacture a number. General context only, COMMUNITY-tier (§1): text-based SVG
storage is widely reported as cheaper than raster-image storage for on-chain NFTs (the Loot/
Autoglyphs precedent), and gas cost for this specific renderer's string concatenation and coordinate
math is a real, unmeasured concern §6.3's sizing discussion already flags structurally (fixed-size
type bounds), independent of any measured figure.

### 11.2 Determinism across compiler versions and builds

Two distinct claims, kept separate:

1. **Same source, same compiler, same settings → same logical output**, given the renderer's
   arithmetic is integer-only and checked (per `namemath.vy`'s own header comment, VERIFIED: "All
   arithmetic is checked int256. Evaluation reverts on overflow") — a property of deterministic
   integer arithmetic, not something a compiler version can silently change without an actual
   language semantics change.
2. **Same source, same compiler, same settings → same bytecode is not automatic**, and this is the
   claim worth being careful about. A historical Vyper bug produced different bytecode from
   identical source/version/settings depending on where compilation ran, reportedly fixed at 0.3.8
   (COMMUNITY, search-aggregated, not independently re-verified against a changelog, §1) — evidence
   that bytecode-level reproducibility has been a real, not theoretical, concern for this toolchain.
   Separately, VERIFIED (S7): Vyper's `bytecodeMetadata` setting defaults to `true` and embeds a
   compiler signature in the bytecode — meaning two compilations of identical source with identical
   settings will still differ byte-for-byte in that embedded signature unless the flag is disabled.
   S7 also names `-f integrity` as the tool for confirming two builds are the same.

**PROPOSED note for `docs/unica-v5/graph/ENS-NFT-SCHEMA.md`'s `RendererDeployment.runtimeCodeHash`
field** (that schema's own, not edited here): H8's exact-version pin (Vyper 0.4.3 exactly) is
necessary but not sufficient for that field to mean what it implies. Also pin and record the exact
compiler **build**, the `-f integrity` hash, and an explicit `bytecodeMetadata` setting — recorded as
an implementation-time decision, not fixed by this document.

## 12. Wallet, marketplace, and Content Security Policy

### 12.1 Which surfaces are known to resolve a base64 on-chain SVG tokenURI

COMMUNITY, search-aggregated (§1), not independently re-tested by this repository: OpenSea renders
base64-encoded data-URI images as expected; MetaMask's behavior is reported mixed — the browser
extension has been reported to display base64-encoded SVG correctly, while a mobile-app issue and
forum thread describe base64 `image`/`animation_url` data URIs not rendering (dates and current
status unconfirmed). Separately, VERIFIED (S6): OpenSea's own documentation states it caches and
"automatically" converts SVG to PNG for its own display — meaning even where a given wallet's
renderer is inconsistent, at least one major marketplace normalizes SVG server-side into a raster
format, which incidentally also neutralizes any embedded-script risk for viewers on that specific
platform. **This document does not rely on that as a security control** — §7.3/§7.4's requirements
that the renderer never emit script-capable markup, and that any client treat resolved SVG as
untrusted, hold regardless of which surface is displaying it.

### 12.2 Content Security Policy for the checkout surface

**PROPOSED, BACKEND_POLICY/CLIENT_VERIFICATION scope, not yet implemented** — no checkout code for
this exists (§3): restrict `img-src` to `'self' data:` (or an explicit allowlist) on any surface
displaying token or avatar images, and — independent of CSP, which is a second layer, not a
replacement for the first — never place fetched SVG or JSON content into the DOM via
`innerHTML`/`dangerouslySetInnerHTML` (§7.4). Where inline embedding is ever genuinely required
instead of `<img>`, sanitize first with a maintained sanitizer configured for SVG, per OWASP's own
guidance (COMMUNITY, search-aggregated, §1) to patch it regularly, since browser parsing behavior and
bypasses change over time.

## 13. Golden-vector test plan

### 13.1 Confusable and homograph name pairs

Two buckets, split along exactly the line §8.2 draws:

**(a) ASCII-only confusables that reach the renderer today.** `"rn"` vs `"m"`; `"vv"` vs `"w"`;
`"cl"` vs `"d"`; `"0"` vs `"o"`; `"1"`/`"l"`/`"I"`; `"5"` vs `"s"`; and combinations of these inside
otherwise-ordinary merchant-name-shaped strings (e.g. `"rnerchant"` vs `"merchant"`). **PROPOSED
test:** for every such pair, assert the two rendered SVGs differ in geometry, not only in which of
the five palette colours (`logobackground.vy`'s `PALETTE_N = 5`, VERIFIED, repo file) was chosen —
this is the direct, executable form of the assignment's own colour-only-distinction requirement,
expanded on in §13.2.

**(b) Unicode confusables excluded by the current ASCII gate** (e.g., Cyrillic "а" versus Latin "a,"
per §8.3). **PROPOSED test:** assert the off-chain normalization gate itself refuses these — fails
closed, producing no art at all — rather than asserting anything about rendered-art difference,
since these strings never reach `svgrender` today. This protects against a future loosening of the
gate silently becoming unsafe without anyone noticing the art layer was never tested against it.

### 13.2 The colour-only-distinction rule

**PROPOSED, structural.** With only five palette colours (VERIFIED, `logobackground.vy`'s
`PALETTE_N = 5`), two unrelated names sharing a palette by pigeonhole is common and expected —
palette alone cannot be, and is not intended to be, the art's distinguishing signal.
`namemath.vy`'s coordinate geometry is the load-bearing distinguisher. **The test:** for the pairs in
§13.1(a) and a wider generated set (every name at edit-distance 1 from a fixed corpus), assert
rendered **geometry** (the point set or path data `namemath` produces) differs between the two —
catching both "two names look the same because they only differ by palette" (a low-entropy,
colour-vision-deficiency-adjacent accessibility failure the assignment names directly) and, more
seriously, "two different names accidentally produced identical geometry too," which the palette
check alone could never catch.

### 13.3 Malformed and adversarial inputs

**PROPOSED**, following `docs/unica-v4/ENS-ART-LAYER.md` §6's existing "fails closed beyond the
declared grid" pattern: an empty name; a name at the exact `String[N]` bound (§6.3, §8.5); a name one
byte over the bound (must revert, never silently truncate); a name containing a byte outside §8.6's
allowlist (any control byte, any byte ≥ `0x80`) — must revert; a name that is valid ASCII per §8.6
but confusable per §13.1(a) — must still render (confusability is a design/test concern, not a
refusal condition, since these ARE valid merchant names); and the leaf-label collision case from
§4.3 — two full names sharing a leaf label under different parents (e.g. `"acme.unica.eth"` and
`"acme.otherparent.eth"`) — **must** produce different art if seeded per §4.3's recommendation,
catching a regression to the discouraged leaf-label-only seeding.

### 13.4 Determinism and version-bump tests

The cross-block-number identical-output test from §4.4; `docs/unica-v4/ENS-ART-LAYER.md` §6's own
golden-hash-pinning test (VERIFIED, repo file, cited not duplicated); and one new test this document
proposes that operationalizes §4's required property directly: pin one golden `(normalizedName,
rendererVersion, ensv2DeploymentId)` triple's expected output, then assert that independently varying
any **one** of the three inputs (holding the other two fixed) changes the output, and that two calls
with the identical triple never do.

## 14. The anti-substitution restatement (collected)

Every place this document could be read as implying the art is proof of anything, restated in one
place:

- **§0** — an ENS record must never redirect a live UNICA settlement; the receipt binds what
  happened, not what an identity layer says today.
- **§5.2** — the operational-status overlay conveys status, never identity or payout proof.
- **§5.5** — a checkout badge's PASS state means "no substitution detected as of this check," never
  "verified payout"; WARN is always shown plainly.
- **§5.6** — none of the art, the badge, or the snapshot is proof of payout identity by itself; the
  contract's stored recipient, fixed before the identity layer's opinion could change, is the only
  fact that ever moved funds.
- **§7.4** — a resolved avatar image is untrusted display content, not a security control, for any
  contract, including UNICA's own.
- **§10.2** — ENSIP-12's SHOULD-level ownership check is a client-side sanity check on an avatar
  reference, not a settlement authorization.

## 15. Open questions and UNKNOWNs

1. **ENSIP-15 versus the ASCII-conservative gate.** Inherited from
   `docs/unica-v4/ENS-ART-LAYER.md` §3.4 and `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §4.1; not
   resolved here.
2. **Vendor vs. from-scratch ERC-721/base64 base.** Inherited open question
   (`docs/unica-v4/ENS-ART-LAYER.md` §7/§10); out of this document's scope but directly affects §6's
   `tokenURI` implementation.
3. **`ArtSeed.sourceEncoding`.** This document recommends `"NAMEHASH"` (§4.3); the actual
   implementation decision remains open and belongs to `docs/unica-v5/graph/ENS-NFT-SCHEMA.md`'s own
   field, not settled here.
4. **Whether OpenSea's `image_data` field exists as commonly described.** Two direct fetches of
   OpenSea's own documentation did not confirm it (§6.2). UNKNOWN pending a direct primary
   confirmation.
5. **Whether the ENSv2 deployment identifier axis (§4.2) will ever be load-bearing** — i.e., whether
   UNICA will ever derive art against a second ENSv2 deployment. Currently a constant.
6. **Whether the owner wants a "creation epoch" field at all (§4.5).** Optional per the assignment
   itself; not decided here.
7. **Exact `String[N]`/`Bytes[N]` bounds** for the new `svgrender`/art token (§6.3, §8.5). An
   implementation-time task, following `docs/unica-v4/ENS-ART-LAYER.md`'s own precedent of leaving
   this open.
8. **On-chain SVG gas cost for this specific renderer.** No benchmark exists (§11.1), inherited from
   `docs/unica-v4/ENS-ART-LAYER.md` §10.
9. **Real-world wallet/marketplace behavior for a Sepolia (non-mainnet) ENSIP-12 avatar reference,
   for UNICA's own future token specifically.** Inherited from `docs/unica-v4/ENS-ART-LAYER.md` §10;
   §12.1's findings are general, not a test of UNICA's own contract, which does not exist yet.
10. **Whether Vyper 0.4.3's `bytecodeMetadata` default and the historical nondeterminism report
    (§11.2) affect this specific renderer.** No build has been attempted (§3).
11. **Whether ENSIP-1's namehash one-wayness is stated anywhere in ENS's own normative text**, or is
    only an inference from the underlying hash primitive (§9). Not resolved by further search here.
12. **UTS #39's primary confusable-mapping tables were not independently fetched** (§8.3, §1); a
    future implementation needing exact skeleton computation must go to
    `unicode.org/reports/tr39/confusables.html` or `ens-normalize.js`'s own data directly, not this
    document's summary.
13. **Whether ETHGlobal's "Best Use of ENSv2" track has judging criteria specific to identity
    NFTs/avatars beyond the general "central, not cosmetic" language quoted in §0.** The fetched page
    text did not surface a more detailed rubric; UNKNOWN whether one exists elsewhere on that page
    that was not surfaced.
14. **Two source-fetch gaps, recorded per this document's own sourcing rule:**
    `raw.githubusercontent.com/ensdomains/docs/master/ensip/15.mdx` returned HTTP 404 and is UNREAD
    (superseded by S3, a working mirror); OpenSea's `image_data` field (item 4 above) was not
    confirmed by either of two direct fetches.

## 16. Relationship to `docs/unica-v4/ENS-ART-LAYER.md`'s commit sequence

This document adds no new commit, no broadcast, no mint, no ENS record write, and no registry
deployment of its own — every action it describes above is either PROPOSED design or a citation of
work already done elsewhere (§3). Its additions fold into that plan's existing §9 commit sequence
without amending H1–H12: the ENSv2 deployment identifier (§4.1–§4.2) and the namehash-seed
recommendation (§4.3) belong in commit 4 (the math module) and commit 6 (`svgrender`); the
byte-allowlist guard (§8.6) belongs beside commit 7 (the ERC-721 art token's malformed-input tests);
and every test named in §13 is additive to that plan's own §6 test-plan section, not a replacement
for it. No new stop point is introduced beyond that plan's own §9 list — no broadcast, at any step;
no ENS record write outside a local fork simulation; no NFT mint on any network without separate
approval beyond this document.
