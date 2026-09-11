# UNICA v5 ENS — record inventory

Status: DRAFT, research and architecture only. Nothing in this file is committed, deployed, or
written to any name. No registry, resolver, proxy, or NFT is deployed by this work; no name or
subname is registered; no MockUSDC is minted or approved; no key is signed or broadcast; no ENS
record is changed. This file is read-only research over ENSv2 Sepolia (chain id `11155111`) and
the ENSv2 hackathon-branch documentation; it never describes production ENS mainnet behaviour as
observed, only as documented, and any ENSv2 Sepolia beta behaviour is labelled as beta behaviour,
never generalized to ENS mainnet.

Labels used throughout: **VERIFIED** (source cited and read), **PROPOSED** (UNICA v5 design
choice, not fixed by any standard), **DOCUMENTED_NOT_OBSERVED** (read from documentation, never
exercised against the deployed contract by this repository), **UNKNOWN** (neither confirmed nor
safely inferred). Authority labels — **ENSV2_ONCHAIN**, **UNICA_ONCHAIN**, **BACKEND_POLICY**,
**GRAPH_EVIDENCE**, **CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION** — mark which layer performs
each action; no claim below blends two layers into one sentence.

## 1. Scope and non-negotiable boundary

This document inventories ENS text records for UNICA v5 merchant, terminal, and agent identity. It
never proposes an ENS record as a settlement authority. Binding on every row below: for an
existing market or order the payout address, token addresses,
chain id, hook, executor, amount, minimum output, and bound payer are fixed by UNICA's own
contracts (ENSV2_ONCHAIN and UNICA_ONCHAIN never blend). ENS may aid discovery **before** order
creation; once an order exists, the resolved identity is bound immutably and no record change ever
redirects it. Every record below states, in its own row, whether a client may treat its value as
binding — the answer is always **no**; the value is discovery only and MUST be independently
re-verified against the registry/contract state before it influences a payment (CLIENT_VERIFICATION,
never a substitute for UNICA_ONCHAIN or ENSV2_ONCHAIN checks).

## 2. Sources

| # | Source | Author/org | Kind | Retrieved | Used for | Conflicts |
|---|---|---|---|---|---|---|
| S1 | `raw.githubusercontent.com/ensdomains/ensips/master/ensips/5.md` (ENSIP-5, Text Records) | ENS | OFFICIAL | 2026-09-11 | Global key table (`avatar`, `description`, `url`, …), value-format rule ("arbitrary UTF-8 string"), Service Key reverse-dot-notation convention | None found |
| S2 | `docs.ens.domains/ensip/12` (ENSIP-12, Avatar Text Records) | ENS | OFFICIAL | 2026-09-11 (also cited `docs/unica-v4/ENS-ART-LAYER.md`, retrieved there 2026-09-11) | The NFT-reference avatar grammar, `eip155:<chainId>/erc721:<contract>/<tokenId>` | None found |
| S3 | `raw.githubusercontent.com/ensdomains/ensips/master/ensips/25.md` (ENSIP-25, AI Agent Registry ENS Name Verification) | ENS (contributors premm.eth, raffy.eth, workemon.eth, ses.eth) | OFFICIAL REPO, **status: draft** | 2026-09-11 | The `agent-registration[<registry>][<agentId>]` key, its ERC-7930/ERC-8004 grounding, its security-considerations text | None found against the docs.ens.domains rendering of the same page, which agreed |
| S4 | `raw.githubusercontent.com/ensdomains/ensips/master/ensips/26.md` (ENSIP-26, Agent Text Records) | ENS | OFFICIAL REPO, **status: draft** | 2026-09-11 | `agent-context` and `agent-endpoint[<protocol>]` keys, their grammar, the resolution order | None found |
| S5 | `raw.githubusercontent.com/ensdomains/ensips/master/ensips/27.md` (ENSIP-27, Node Classification and Metadata) | ENS (contributors jkm.eth, 1a35e1.eth) | OFFICIAL REPO, **status: draft** | 2026-09-11 | The `class` and `schema` keys, the pascal-case class table, the JSON-Schema `schema` pointer grammar | **Conflicts with S6** — see §5.4 |
| S6 | `discuss.ens.domains/t/ensip-27-agent-card-schema-well-known-agent-json/22130` | An ENS DAO governance-forum poster (community proposal, referencing an unmerged PR #75) | COMMUNITY | 2026-09-11 | A second, different draft that also calls itself "ENSIP-27," titled "Agent Card Schema," describing a `/.well-known/agent.json` document | **Conflicts with S5** — the merged `ensips` repository's file at path `27.md` is titled "Node Classification and Metadata" and has nothing to do with agent cards or `/.well-known/agent.json`. This forum post's own body dates to 2026-05-19 and cites an **unmerged** PR #75; the raw-repository file (S5) is the number the ENSIP process has actually assigned as of this retrieval. Both numbers cannot be "ENSIP-27" at once — this file treats S5 as the number-of-record because it is read from the merged specification repository, and treats S6's content as a **candidate, unassigned proposal**, cited by its own title ("Agent Card Schema") rather than by number, everywhere below |
| S7 | `docs.ens.domains/ensv2/permissioned-resolver` | ENS | OFFICIAL | 2026-09-11 (also retrieved 2026-09-08 by `integrations/ensv2/permissioned.mjs`, repo file) | Full write-function list (`setText`, `setAddr`, `setContenthash`, `setData`, `setAlias`, `clearRecords`, `authorizeNameRoles`, `authorizeTextRoles`, `authorizeDataRoles`, `authorizeAddrRoles`), the emitted record-change events, the explicit statement that a name-level grant and a record-level (per-key/per-coin-type) grant are both supported access-control granularities | None found against the repository's own `permissioned.mjs`/`roles.mjs`, whose `authorizeTextRoles` fork measurement (see §5.5) independently confirms the per-key granularity this page states |
| S8 | `docs.ens.domains/ensv2/enhanced-access-control` | ENS | OFFICIAL | 2026-09-08 (repository citation; not independently re-fetched for this document — see note) | Role bitmap constants, resource derivation formulas (`keccak256(node ‖ part)`), `ROOT_RESOURCE` semantics | Not re-verified here; taken from `integrations/ensv2/permissioned.mjs`'s own header citation of the same URL, which records the retrieval date as 2026-09-08 |
| S9 | `docs.ens.domains/ensv2/universal-resolver-v2` | ENS | OFFICIAL | 2026-09-05 (repository citation; not re-fetched for this document) | `resolve(bytes,bytes)` wire shape, wildcard resolution, the three non-reverting failure shapes | Not re-verified here; taken from `web/ensv2/resolve.mjs`'s own header citation |
| S10 | `raw.githubusercontent.com/ChainAgnostic/CAIPs/main/CAIPs/caip-10.md` | Chain Agnostic Standards Alliance | OFFICIAL (for that standard) | 2026-09-11 | The CAIP-10 account-id grammar (`chain_id + ":" + account_address`, chain_id per CAIP-2) used for `com.unica.registry`'s value grammar | None found |
| S11 | `raw.githubusercontent.com/ChainAgnostic/CAIPs/main/CAIPs/caip-22.md` (via `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` S5, re-cited not re-fetched) | Chain Agnostic Standards Alliance | OFFICIAL | 2026-09-11 (sibling document's retrieval) | Chain-scoped `erc721` asset-reference format, used for the `avatar` evaluation | None found |
| S12 | `ethglobal.com/events/ethonline2026/prizes` | ETHGlobal | OFFICIAL (event organizer, not an ENS-team statement) | 2026-09-11 | The ENS sponsor track's exact wording: "Best Use of ENSv2" ($4,500 across four places) and "Best Integration of ENSv2 into an Existing Project" (Continuity, $500); the explicit bonus-points language "think agents as namespaces, each with their own identity and permissions" | None found; corroborates rather than conflicts with `docs/unica-v5/graph/PRIZE-FIT.md`'s reading of the same page's general structure (per-sponsor pool split) |

Repository files read for this document, not re-derived: `integrations/ensv2/README.md`,
`ENS-OWNER-ACTION.md`, `permissioned.mjs`, `roles.mjs`, `records.mjs`, `merchant-config.mjs`,
`web/ensv2/resolve.mjs`, `docs/ensv2/UNICA-ETH-ADDR-REPORT.md`, `docs/unica-v4/ENS-ART-LAYER.md`,
`docs/unica-v4/SPEC-CONTRACTS.md`, `docs/unica-v4/EVENT-SCHEMA.md`, `docs/v2/SECURITY-ADVISORY-001.md`,
`HACKATHON.md`, `docs/unica-v5/graph/ENS-NFT-SCHEMA.md`, `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md`
(sibling stream, cited, not edited), all read 2026-09-11.

**No transcript was supplied.** An ENS sponsor-channel discussion was referenced as a source of
prior claims, but its content was not supplied for this document. Nothing below reports,
summarizes, or attributes an idea to that discussion; the "isolated deployment," "Universal
Resolver override," "invalid old initialize/authorize interfaces," "direct contract registration,"
"MockUSDC is not Circle USDC," and "manager UI failures" claims are treated as **UNVERIFIED
LEADS**, checked against the official sources above rather than assumed true or false (see §8).

## 3. Methodology — why these keys and not others

Before defining a vendor key, ENSIP-5's own global-key table (S1) and the three agent-facing
ENSIPs (S3–S5) were checked for a standard key whose semantics already match. Three of the ten
candidate discovery surfaces (a rendered avatar, a description, a canonical URL) already have
Final, widely-implemented standard keys — §4 evaluates those directly rather than shadowing them
with a vendor key. UNICA's delegated-agent surface (the terminal and agent subnames this stream
designs, and the already-live delegation in `integrations/ensv2/roles.mjs`) is close enough to
ENSIP-25/26's stated purpose ("a single identity model for multichain agents," S4) that §5
evaluates adopting them directly, rather than inventing a UNICA-specific agent-discovery grammar
that would duplicate a draft standard already aimed at exactly this problem. Everything left over
— which release, which registry, which discovery/receipt/graph/x402 endpoint, which chains, which
renderer, which terminal status, which agent policy pointer — has no matching global or draft key,
so §6 defines it as a Service Key under the `com.unica` namespace, per S1's own convention
("reverse dot notation for a namespace which the service owns... must contain at least one dot").

A found overlap is recorded rather than silently resolved: this repository's already-BUILT
settlement-configuration keys (`integrations/ensv2/roles.mjs`, `RECORD_KEYS`) use a **different**
naming convention — `unica:chain-id`, `unica:token`, `unica:executor`, `unica:policy-version`,
`unica:policy-commitment`, `unica:policy-scheme`, `unica:agent`, `unica:capabilities`,
`unica:revocation` — colon-delimited, not ENSIP-5's reverse-dot-notation Service Key form. §5.5
records this as a real inconsistency between BUILT code and the standard it is meant to follow,
states which of the two families each new key in §6 sits beside, and does not silently rename or
migrate the existing live keys, which are load-bearing in a scoped delegation that is already
signed and broadcast on Sepolia (`HACKATHON.md` §6).

## 4. Standard ENSIP-5 fields evaluated

### 4.1 `avatar`

| Field | Value |
|---|---|
| Exact key | `avatar` |
| Standard / ENSIP | ENSIP-5 (S1), status Final; NFT-reference grammar per ENSIP-12 (S2) |
| Vendor prefix | None — global key |
| Value grammar | Either a direct image URL (S1: "a URL to an image used as an avatar or logo") or, for UNICA's planned identity art, the CAIP-22/29 NFT reference `eip155:<chainId>/erc721:<contractAddress>/<tokenId>` (S2, S11) — chain-scoped, one chain id per reference, not restricted to mainnet |
| Maximum encoded length | Not stated by S1 or S2; PROPOSED bound 256 bytes, comfortably above the NFT-reference grammar's length and short enough that a write's calldata size stays predictable |
| Mutability | Mutable — set by the name owner or a delegate holding `SET_TEXT` at this key's per-key resource |
| Authorized writer | ENSV2_ONCHAIN: the account holding `SET_TEXT` at `keccak256(abi.encode(node, keccak256(bytes("avatar"))))` (the per-key resource, `integrations/ensv2/permissioned.mjs`'s `textResource`), via `authorizeTextRoles` |
| Authorized revoker | ENSV2_ONCHAIN: whoever holds `adminRole(SET_TEXT)` at that same per-key resource — on this deployment, revocation is the same `authorizeTextRoles` call with `granted = false` (`integrations/ensv2/roles.mjs`'s `planAgentRevoke`) |
| Validation logic | CLIENT_VERIFICATION: a client MUST parse the CAIP-22/29 grammar, resolve `tokenURI`, and — per ENSIP-12's own SHOULD-level rule (S2) — verify the referenced token's owner against the name's **independently, live-resolved** address; on a mismatch the avatar is shown with a warning and never treated as identity proof (`docs/unica-v4/ENS-ART-LAYER.md` §4.3, H11, restated in `GRAPH-COMPOSITION.md` §5 of this stream) |
| Security significance | MEDIUM — a stale or mismatched avatar can only mislead a display; per the non-negotiable boundary, it never participates in resolving a payout address, so it cannot redirect funds |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 5 minutes, matching one checkout visit; re-read before any payment-adjacent screen renders |
| Failure behaviour | Absent, malformed, or a parse failure: no avatar shown; never inferred from a stale cached value |
| Example testnet value | `eip155:11155111/erc721:<art_token_address>/<tokenId>` — **PROPOSED placeholder only**; the art token is SPECIFIED-NOT-BUILT (`docs/unica-v4/ENS-ART-LAYER.md` §1), so no live value exists as of 2026-09-11 |

### 4.2 `description`

| Field | Value |
|---|---|
| Exact key | `description` |
| Standard / ENSIP | ENSIP-5 (S1), Final |
| Vendor prefix | None — global key |
| Value grammar | "A description of the name" (S1) — arbitrary UTF-8 string |
| Maximum encoded length | Not stated by S1; PROPOSED bound 280 bytes (a short merchant tagline, not a policy document) |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` holder at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder at the same resource |
| Validation logic | CLIENT_VERIFICATION: display-only text; a checkout MUST NOT parse this field for any machine-actionable field (no embedded addresses, no embedded amounts) — free text is exactly the kind of value an attacker-controlled record could set to something misleading, and nothing here treats it as anything but a caption |
| Security significance | LOW — pure display text, no fund-safety path |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 15 minutes — lower-churn than `avatar` or a discovery endpoint |
| Failure behaviour | Absent: show nothing, never a placeholder that could be mistaken for a real merchant statement |
| Example testnet value | "UNICA demonstration merchant — ENSv2 Sepolia beta, no real value" — PROPOSED, illustrates the required no-real-value disclosure this project's own house style already uses (`docs/unica-v4/SPEC-CONTRACTS.md` §1: "Faucet stock tokens and uTUSD have no real-world value") |

### 4.3 `url`

| Field | Value |
|---|---|
| Exact key | `url` |
| Standard / ENSIP | ENSIP-5 (S1), Final |
| Vendor prefix | None — global key |
| Value grammar | "a website URL" (S1) |
| Maximum encoded length | Not stated by S1; PROPOSED bound 256 bytes |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` holder at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder at the same resource |
| Validation logic | CLIENT_VERIFICATION: SHOULD be restricted to `https://` before being rendered as a clickable link in a payment-adjacent screen (a payment UI linking to an arbitrary scheme is a phishing vector); the destination's content is untrusted data, never a source of order terms |
| Security significance | LOW-MEDIUM — a malicious URL here is a phishing link, not a fund-redirection path; standard link-hygiene (`https://` only, no auto-navigation) closes the practical risk |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 15 minutes |
| Failure behaviour | Absent or non-`https://`: no link rendered |
| Example testnet value | "https://example-merchant.invalid" — PROPOSED placeholder, no live merchant website is attached to any UNICA-controlled ENSv2 Sepolia name as of 2026-09-11 |

## 5. ENSIP-25/26/27 fields evaluated

### 5.1 `agent-registration[<registry>][<agentId>]` (ENSIP-25)

| Field | Value |
|---|---|
| Exact key | `agent-registration[<registry>][<agentId>]` — parameterized, per name |
| Standard / ENSIP | ENSIP-25 (S3), **status: draft**, created 2025-10-02 |
| Vendor prefix | None — a global parameterized key defined by the ENSIP itself |
| Value grammar | Non-empty string; S3: "Implementations SHOULD set the value to `\"1\"`... the presence of a non-empty value is interpreted as an attestation" |
| Maximum encoded length | Key itself can be long (`<registry>` is a full ERC-7930 interoperable address, e.g. `0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432` in S3's worked example); value is 1 byte in the recommended usage |
| Mutability | Mutable; one record per (registry, agentId) pair ever attested |
| Authorized writer | ENSV2_ONCHAIN: the name owner, or a delegate scoped to this exact parameterized key via `authorizeTextRoles` (the per-key resource hash is over the **full parameterized key string**, including the brackets, per this repository's own `textResource` derivation — never over the unparameterized prefix alone, which would let a delegate scoped to one registry/agentId pair write a different one) |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder at that exact per-key resource |
| Validation logic | CLIENT_VERIFICATION, per S3's own four-step flow: obtain the agent id and registry address from the on-chain registry entry first, construct the exact key, resolve it, and treat a non-empty value as verified — **never** the reverse (never trust an ENS record's claimed registry/agentId without an independent on-chain registry read) |
| Security significance | MEDIUM — S3's own security-considerations text: "If an ENS name is transferred to a new owner, any existing verification text records may become stale... Clients SHOULD consider ENS name ownership changes... and MAY apply additional freshness or revocation checks." UNICA has no live ERC-8004-style agent registry today (UNKNOWN/NOT-BUILT), so this key has no current UNICA use; recorded for a future agent-identity integration, not adopted now |
| Cacheable | Yes, but S3's own staleness warning applies — re-check on any name-ownership change |
| Cache lifetime | PROPOSED: re-verify whenever the name's owner/controller changes, not on a fixed timer |
| Failure behaviour | Absent or empty: verification MUST fail (S3: "If the text record does not exist or resolves to an empty value, verification MUST fail") |
| Example testnet value | None — UNICA has not registered an agent in any ERC-8004-style registry; DOCUMENTED_NOT_OBSERVED for this project |

### 5.2 `agent-context` (ENSIP-26)

| Field | Value |
|---|---|
| Exact key | `agent-context` |
| Standard / ENSIP | ENSIP-26 (S4), **status: draft**, created 2025-05-17 |
| Vendor prefix | None — a global key defined by the ENSIP |
| Value grammar | "Any format suitable for agentic systems (plain text, Markdown, YAML, JSON, etc.)" (S4); "describes the agent and how to interact with it," MAY reference registries or endpoint records |
| Maximum encoded length | Not stated by S4; PROPOSED bound 1024 bytes for a UNICA delegated agent (a short capability summary, not a full policy document — a pointer, not the payload, for anything larger) |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` holder at this key's per-key resource — for UNICA's delegated agent, this is the agent's own leaf resource per `integrations/ensv2/roles.mjs`'s `AGENT_DEFAULT_ROLES = ["SET_TEXT"]`, scoped to one key |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder — the merchant/operator that granted the delegation |
| Validation logic | CLIENT_VERIFICATION: free-form description, never machine-executed; a client MAY display it, MUST NOT derive a settlement parameter from it |
| Security significance | LOW-MEDIUM — S4's own security-considerations text: "There are no security considerations specific to this ENSIP. Standard ENS security considerations apply." For UNICA specifically, this record sits on the agent's own scoped leaf, never on a name a merchant relies on (`integrations/ensv2/roles.mjs`'s `PROTECTED_RESOURCE` screen), so a compromised or misleading value cannot escalate |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 15 minutes |
| Failure behaviour | Absent: no agent description shown |
| Example testnet value | None published by UNICA as of 2026-09-11; this repository's live agent delegation (`HACKATHON.md` §6) currently publishes capability facts under the existing `unica:capabilities` key (§5.5), not under this ENSIP-26 key — adopting `agent-context` is a §8 open question, not yet a fact |

### 5.3 `agent-endpoint[<protocol>]` (ENSIP-26)

| Field | Value |
|---|---|
| Exact key | `agent-endpoint[<protocol>]` — parameterized by protocol: `mcp`, `a2a`, `web`, or others as the ecosystem adds them |
| Standard / ENSIP | ENSIP-26 (S4), **status: draft** |
| Vendor prefix | None — global parameterized key |
| Value grammar | "A URL (e.g. `https://`, `http://`) identifying the endpoint for the specified agent protocol"; S4: "The value MUST be a valid URL, including IPFS URIs (e.g. `ipfs://{cid}`)" |
| Maximum encoded length | Not stated; PROPOSED bound 512 bytes |
| Mutability | Mutable; multiple protocol-specific records may coexist |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at the exact parameterized key's per-key resource (bracket-and-all, same rule as §5.1) |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder at that resource |
| Validation logic | CLIENT_VERIFICATION: MUST restrict to `https://` or `ipfs://` for anything that will be dereferenced automatically (plain `http://` accepted by the ENSIP text but not recommended here); the endpoint's response is untrusted data — an agent reachable at this URL never gains authority to settle a payment merely by answering here, exactly as `com.unica.x402-endpoint` states in §6.6 |
| Security significance | MEDIUM — S4: "There are no security considerations specific to this ENSIP." UNICA's own layered rule still applies: reachability at this endpoint is a discovery fact, never an authorization fact |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 5 minutes |
| Failure behaviour | Absent for a given protocol: that protocol is simply not offered; never inferred from another protocol's endpoint |
| Example testnet value | None published by UNICA as of 2026-09-11 |

### 5.4 `class` and `schema` (ENSIP-27, as merged) — and the ENSIP-27 naming conflict

**The conflict, stated once here rather than per-field.** Two documents both call themselves
"ENSIP-27" as of this retrieval (§2, S5 vs S6). The file actually merged into the specification
repository at `ensips/27.md` (S5) is titled "Node Classification and Metadata" and defines `class`
and `schema`. A separate, unmerged governance-forum post (S6, referencing PR #75, dated
2025-05-19) is titled "ENSIP-27: Agent Card Schema" and describes a `/.well-known/agent.json`
document discovered via ENSIP-26's `agent-endpoint[mcp]`. This document treats S5 as the
number-of-record (it is the merged specification-repository content) and cites S6's proposal by
its own title, never by number, everywhere it appears. Whether the forum proposal is later
assigned a different number, merged as ENSIP-27 in place of S5, or abandoned is **UNKNOWN** and is
carried to §8 rather than guessed.

| Field | Value |
|---|---|
| Exact key | `class` |
| Standard / ENSIP | ENSIP-27 (S5), **status: draft**, created 2025-12-15 — builds on ENSIP-5 and ENSIP-24 |
| Vendor prefix | None — global key |
| Value grammar | S5: "MUST be pascal case, using only alphabet characters." Recommended values: `Agent`, `Application`, `Committee`, `Contract`, `Council`, `Delegate`, `Group`, `Org`, `Person`, `Treasury`, `Wallet`, `Workgroup` — "other values MAY be used for specialized use cases" |
| Maximum encoded length | Not stated; PROPOSED bound 32 bytes (a single pascal-case word) |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder |
| Validation logic | CLIENT_VERIFICATION: display/filtering label only. Directly relevant to this stream: a UNICA terminal subname could carry `class = Wallet` and a UNICA agent subname `class = Agent`, per S5's own table, giving `docs/unica-v5/ens/GRAPH-COMPOSITION.md`'s indexer a standard, cross-ecosystem-legible field to filter on instead of a UNICA-only convention — a candidate for adoption, not adopted by this document (§8) |
| Security significance | LOW — S5's own Security Considerations section: "None." A `class` mislabelling is a display/filtering error, never a fund-safety one, because nothing in UNICA's contracts reads it |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 15 minutes |
| Failure behaviour | Absent: no classification shown; a client MUST NOT infer a class from context |
| Example testnet value | None published by UNICA as of 2026-09-11; if adopted, a UNICA agent subname's example value would be `Agent` |

| Field | Value |
|---|---|
| Exact key | `schema` |
| Standard / ENSIP | ENSIP-27 (S5), **status: draft** |
| Vendor prefix | None — global key |
| Value grammar | S5: "MUST start with one of the following prefixes... `ipfs://`... `cbor:`... `https://`," pointing to a JSON Schema (2020-12) describing the node's additional metadata attributes, itself constrained to a flat object of `string`-typed properties, kebab-case key names, every property carrying a `description` |
| Maximum encoded length | Not stated for the pointer itself; PROPOSED bound 256 bytes (it is a URI, not the schema payload) |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder |
| Validation logic | CLIENT_VERIFICATION: S5 itself warns "schemas provided over `https` can change at any time or become unavailable... implementations MUST be designed in a way that harm to users is minimized"; a UNICA reader would prefer `ipfs://` per S5's own recommendation, and MUST validate any resulting record write against the schema's `required`/`type` constraints before writing, never write first and validate later |
| Security significance | LOW — S5's Security Considerations: "None." The one UNICA-specific risk worth naming: a mutable `https://` schema pointer that changes after a client already validated against it could make a previously-valid record look non-conformant, or vice versa — a display/UX defect, not a fund-safety one |
| Cacheable | Yes, but re-fetch the schema itself before any write-time validation, never trust a cached schema for a write |
| Cache lifetime | PROPOSED: the schema pointer, 15 minutes; the schema payload itself, revalidated at every write |
| Failure behaviour | Absent: no schema-driven validation is possible; a client falls back to the closed vendor-key vocabulary in §6 |
| Example testnet value | None; not adopted by UNICA as of 2026-09-11 |

### 5.5 Conflict with this repository's existing `unica:` vendor keys

**Recorded, not resolved by this document.** `integrations/ensv2/roles.mjs`'s `RECORD_KEYS`
(repo file, read 2026-09-11) already defines and, per `HACKATHON.md` §6, has already **live
broadcast** a set of colon-delimited keys — `unica:chain-id`, `unica:token`, `unica:executor`,
`unica:policy-version`, `unica:policy-commitment`, `unica:policy-scheme`, `unica:agent`,
`unica:capabilities`, `unica:revocation` — none of which follow ENSIP-5's Service Key convention
("reverse dot notation for a namespace which the service owns... must contain at least one dot,"
S1). These are a different vendor-key **family** from the `com.unica.*` keys this document defines
in §6: the `unica:` family carries **v4 per-market settlement configuration and the live agent
delegation's own scope**, already signed and broadcast on Sepolia; the `com.unica.*` family (§6)
carries **v5 identity-discovery surfaces** (release, registry pointer, discovery/receipt/graph/x402
endpoints, supported chains, renderer, terminal status, agent-policy pointer) that did not exist
before this stream. Two of the ten new keys brush against an existing `unica:` key's purpose —
`com.unica.agent-policy` against `unica:capabilities`, and `com.unica.release` against
`unica:policy-version` — and §6.10 and §6.1 each state exactly how they are scoped apart rather
than duplicated. **This document does not rename, migrate, or deprecate any `unica:` key.** Whether
the two families should eventually be unified under one reverse-dot-notation namespace is an
owner decision, carried to §8, not made here — doing so would be a live record migration on a name
that has already broadcast a scoped delegation, and a from-scratch architecture document is not the
place to schedule that migration.

## 6. UNICA v5 vendor keys (`com.unica.*`)

### 6.1 `com.unica.release`

| Field | Value |
|---|---|
| Exact key | `com.unica.release` |
| Standard / ENSIP | Vendor Service Key per ENSIP-5's own convention (S1); no ENSIP defines its semantics |
| Vendor prefix | `com.unica` |
| Value grammar | PROPOSED: one token from the closed set published in `docs/versions` (repo file), e.g. `v1`, `v3`, `v4` — never a free-form string, and never itself a contract address |
| Maximum encoded length | 16 bytes |
| Mutability | Mutable — changes when a merchant migrates which UNICA generation their active market targets |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder at that resource — ultimately traceable to the name owner's `register()`-time admin bits |
| Validation logic | CLIENT_VERIFICATION: value MUST be one of the enumerated release tokens; a client MUST NOT select a contract or ABI purely from this string — it selects which `com.unica.registry[<chainId>]` and on-chain registry to *look up*, and the registry's own on-chain state (`statusOf`, `marketIdOfHook`, per `docs/unica-v4/SPEC-CONTRACTS.md` §3's "Official" test) is the only thing that confirms a market is real |
| Security significance | LOW for fund safety (this string never reaches a contract call); MEDIUM for UX-phishing (a record falsely claiming a newer, unaudited release could steer a payer toward an unintended flow) — closed by the registry-side re-verification rule above |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 5 minutes |
| Failure behaviour | Absent or not in the enumerated set: UNKNOWN release — the interface prompts for manual release selection or defaults to the last release it independently confirmed live via the registry, never to the newest-sounding token |
| Example testnet value | `v3` — the one UNICA generation independently VERIFIED live and settled on Ethereum Sepolia as of 2026-09-11 (`HACKATHON.md` §8) |

### 6.2 `com.unica.registry`

| Field | Value |
|---|---|
| Exact key | `com.unica.registry` (or, for a multi-chain merchant, the parameterized form `com.unica.registry[<chainId>]`, reusing ENSIP-26/27's own bracket-parameterization convention, S4/S5, rather than inventing a new one) |
| Standard / ENSIP | Vendor Service Key; parameterization borrows the ENSIP-26/27 bracket grammar as a house convention, not itself a standard |
| Vendor prefix | `com.unica` |
| Value grammar | CAIP-10 account id (S10): `chain_id:account_address`, e.g. `eip155:11155111:0x...` — the `UnicaMarketRegistry` address for that chain, per `docs/unica-v4/SPEC-CONTRACTS.md` §6 |
| Maximum encoded length | 96 bytes (comfortably covers `eip155:<chainid>:0x` + 40 hex chars) |
| Mutability | Mutable — repointed only across a new deployment generation (a registry's own `HOOK_CREATION_CODE_HASH` is immutable once deployed, SC §7; this record can be updated to point at a *different* deployment, which is a merchant/operator decision, not a contract capability) |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder at that resource |
| Validation logic | CLIENT_VERIFICATION, mandatory, never optional: parse the CAIP-10 value, confirm the address has code (`eth_getCode`), then perform the full "Official" test from `SPEC-CONTRACTS.md` §3 before treating anything the registry reports as real. This record is **discovery only** — it tells a client *where to look*, never *what is true* |
| Security significance | HIGH for discovery-phishing (a malicious value could point at a look-alike registry serving fabricated market data), but LOW for fund safety **by construction**: order creation still requires the allowlisted creator to sign a transaction against the real contract the interface actually calls, and an existing order's terms are already bound on-chain and untouched by any ENS record (§1) |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 5 minutes; MUST be re-read (not served from cache) immediately before order creation |
| Failure behaviour | Absent: fall back to the deployment manifest (`deployments/unica-v4/<chainId>.json`, `docs/unica-v4/EVENT-SCHEMA.md` §9's "MF" row) rather than refusing outright, since the manifest is this project's own primary source for registry addresses; if neither exists, UNKNOWN — no market list shown |
| Example testnet value | `eip155:11155111:0x0000000000000000000000000000000000000000` — **PROPOSED placeholder.** `UnicaMarketRegistry` is SPECIFIED-NOT-BUILT (`docs/unica-v4/SPEC-CONTRACTS.md` §1.2, blocked on the owner's G0); no real address exists as of 2026-09-11 |

### 6.3 `com.unica.market-discovery`

| Field | Value |
|---|---|
| Exact key | `com.unica.market-discovery` |
| Standard / ENSIP | Vendor Service Key |
| Vendor prefix | `com.unica` |
| Value grammar | An `https://` or `ipfs://` URL to a merchant-hosted manifest of active order-creation options (product list, prices, accepted markets) |
| Maximum encoded length | 512 bytes |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder |
| Validation logic | CLIENT_VERIFICATION: the fetched payload is untrusted display data. Per this stream's instruction-source discipline, a discovery manifest describes *candidate* products; it never itself constructs a binding order — order creation still requires the allowlisted creator's own signed on-chain action, and the customer-facing review screen re-resolves everything before payment (`docs/unica-v5/pos/POS-FLOWS.md` §4, §7, cited not edited) |
| Security significance | MEDIUM — a compromised endpoint can misquote products or prices shown to a browsing customer; it cannot construct a payable order or move funds by itself |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 5 minutes; always re-read before the final order-review screen |
| Failure behaviour | Absent or unreachable: no automated discovery; UI falls back to manual entry or a QR-provided order id — shown as "discovery unavailable," never as "no products" |
| Example testnet value | `https://example-merchant.invalid/unica/markets.json` — PROPOSED placeholder; no live UNICA merchant discovery endpoint exists as of 2026-09-11 |

### 6.4 `com.unica.receipt-endpoint`

| Field | Value |
|---|---|
| Exact key | `com.unica.receipt-endpoint` |
| Standard / ENSIP | Vendor Service Key |
| Vendor prefix | `com.unica` |
| Value grammar | An `https://` URL, PROPOSED convention allowing a `{orderId}` placeholder token for client-side substitution, e.g. `https://.../receipt/{orderId}` |
| Maximum encoded length | 512 bytes |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder |
| Validation logic | CLIENT_VERIFICATION and, critically, never authoritative: proof of settlement is only the mined `Settled` event from the market's own executor (`docs/unica-v4/EVENT-SCHEMA.md` §6.2, "the success signal"), confirmed live over RPC, exactly as that file's own "CK" row already requires ("once live, confirms payment over RPC, never from an indexer"). A page served at this endpoint claiming "paid" with no corresponding on-chain `Settled` is not evidence of anything |
| Security significance | MEDIUM-HIGH for social engineering: a malicious receipt page could try to induce a merchant's staff to release goods before real on-chain settlement — closed only by never wiring this endpoint into the success-confirmation logic, which `docs/unica-v5/pos/POS-FLOWS.md`'s own success screen (cited, not edited) already keys off the mined log alone |
| Cacheable | Yes for display; the underlying settlement confirmation is never cached beyond a fresh RPC read |
| Cache lifetime | PROPOSED 5 minutes for the URL itself |
| Failure behaviour | Absent: receipts shown from indexed graph data (`com.unica.graph-endpoint`, §6.5) or a raw block-explorer link only |
| Example testnet value | `https://example-merchant.invalid/receipts/{orderId}` — PROPOSED placeholder |

### 6.5 `com.unica.graph-endpoint`

| Field | Value |
|---|---|
| Exact key | `com.unica.graph-endpoint` |
| Standard / ENSIP | Vendor Service Key |
| Vendor prefix | `com.unica` |
| Value grammar | An `https://` GraphQL endpoint URL |
| Maximum encoded length | 512 bytes |
| Mutability | Mutable — moves if the merchant/operator migrates subgraph hosting or versions |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder |
| Validation logic | GRAPH_EVIDENCE, never authority: per `docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` §4.0's finality convention (cited, not edited), every query result from this endpoint MUST be shown beside its `_meta.block` so staleness is visible; per `docs/unica-v4/EVENT-SCHEMA.md` §2, "an indexer never supplies current status" — this record points at evidence, never at a settlement authority (restated in `GRAPH-COMPOSITION.md` §2 of this stream) |
| Security significance | LOW for fund safety (pure read layer); MEDIUM for information integrity (a malicious endpoint could show fabricated settlement history) |
| Cacheable | Yes for the URL; results carry their own staleness marker and are never treated as RPC-equivalent |
| Cache lifetime | PROPOSED 15 minutes for the URL |
| Failure behaviour | Absent: fall back to the bounded RPC-scan or limited beta history view already specified in `docs/unica-v4/EVENT-SCHEMA.md` §10.3 |
| Example testnet value | `https://api.studio.thegraph.com/query/1755384/unica-settlements/v2-39b6f91` — **VERIFIED live** (`docs/unica-v5/graph/SETTLEMENT-SCHEMA.md` T6, `README.md`), the actual deployed and synced V1/V3 receipt subgraph; used here as a real, currently-reachable example rather than an invented placeholder — this indexes the V1/V3 frozen-generation receipt, not a UNICA v4 market, and that qualifier belongs beside any live use of this value |

### 6.6 `com.unica.x402-endpoint`

| Field | Value |
|---|---|
| Exact key | `com.unica.x402-endpoint` |
| Standard / ENSIP | Vendor Service Key |
| Vendor prefix | `com.unica` |
| Value grammar | An `https://` URL for an x402-style payment-required endpoint |
| Maximum encoded length | 512 bytes |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder |
| Validation logic | CLIENT_VERIFICATION: per `HACKATHON.md` §7, "UNICA complements x402 by enforcing the merchant's settlement rules on-chain; it does not implement the x402 protocol." This endpoint is a discovery/pricing hint for an x402-aware agent; any order it triggers still binds payer, merchant, asset, amount, chain, executor, order id, and expiry on-chain exactly per Advisory 001's rule (`docs/v2/SECURITY-ADVISORY-001.md`) — an HTTP 402 response is never itself a signed authorization |
| Security significance | MEDIUM — same class as `com.unica.market-discovery`: a malicious endpoint can misquote price or terms, never move funds by itself, because settlement still requires the payer's own on-chain-checked authorization |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 5 minutes |
| Failure behaviour | Absent: no x402 surface offered for this name |
| Example testnet value | **None.** UNICA has not built an x402 endpoint; `HACKATHON.md` §7 states x402 support is "not listed as a sponsor integration." DOCUMENTED_NOT_OBSERVED / NOT-BUILT — this key is recorded for future use, not in service today |

### 6.7 `com.unica.supported-chains`

| Field | Value |
|---|---|
| Exact key | `com.unica.supported-chains` |
| Standard / ENSIP | Vendor Service Key |
| Vendor prefix | `com.unica` |
| Value grammar | A comma-separated list of CAIP-2 chain identifiers (S10's own dependency), e.g. `eip155:11155111` |
| Maximum encoded length | 256 bytes |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder |
| Validation logic | CLIENT_VERIFICATION: each listed chain id MUST be cross-checked against a corresponding `com.unica.registry[<chainId>]` entry (§6.2) and, ultimately, the on-chain registry itself — listing a chain here never by itself proves a market is live there |
| Security significance | LOW-MEDIUM: a wrong or stale list is a discovery-accuracy defect; it cannot create a market or move funds on a chain the merchant does not actually operate on |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 15 minutes |
| Failure behaviour | Absent: assume Sepolia only — the one chain independently VERIFIED live for UNICA as of 2026-09-11 (`HACKATHON.md` §8); never assume mainnet |
| Example testnet value | `eip155:11155111` |

### 6.8 `com.unica.identity-renderer`

| Field | Value |
|---|---|
| Exact key | `com.unica.identity-renderer` |
| Standard / ENSIP | Vendor Service Key |
| Vendor prefix | `com.unica` |
| Value grammar | PROPOSED: the descriptive renderer-version label itself (H7's naming convention, `docs/unica-v4/ENS-ART-LAYER.md`), e.g. `svgrender-v1` — matching `docs/unica-v5/graph/ENS-NFT-SCHEMA.md` §5's `RendererVersion.id` ("the descriptive version label itself... human-readable") |
| Maximum encoded length | 64 bytes |
| Mutability | Mutable as a *current pointer* only — a merchant may mint a new identity under a newer renderer and update this record, but the OLD identity's minted NFT and its `RendererDeployment` stay immutable and readable forever (H6, restated `ENS-NFT-SCHEMA.md` §4.2) |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder |
| Validation logic | CLIENT_VERIFICATION: value SHOULD match the renderer actually behind the `avatar` record's referenced `IdentityNFT`; per `ENS-NFT-SCHEMA.md` §4.6, a mismatch here is informational, never a blocking warning — an older version's output is just as valid, forever |
| Security significance | LOW — purely cosmetic/informational; the art layer structurally cannot influence settlement (`docs/unica-v4/ENS-ART-LAYER.md` H3) |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 15 minutes |
| Failure behaviour | Absent: a client reads the renderer version directly from the avatar-referenced `IdentityNFT`'s on-chain data instead, once that layer exists |
| Example testnet value | **None.** The entire art layer (`namemath_v2`, `logobackground_v2`, `svgrender`, the ERC-721 art token) is SPECIFIED-NOT-BUILT (`docs/unica-v4/ENS-ART-LAYER.md` §1). This key is entirely PROPOSED, with no artifact behind it as of 2026-09-11 |

### 6.9 `com.unica.terminal-status`

| Field | Value |
|---|---|
| Exact key | `com.unica.terminal-status` |
| Standard / ENSIP | Vendor Service Key |
| Vendor prefix | `com.unica` |
| Value grammar | PROPOSED closed enumeration: `active` \| `maintenance` \| `revoked` \| `retired` |
| Maximum encoded length | 16 bytes |
| Mutability | Mutable, expected to change often (shift changes, maintenance windows) |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` scoped to this key on the **terminal's own subname resource** — never the merchant's root, mirroring `integrations/ensv2/roles.mjs`'s existing protected-resource design for the agent case |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder at that terminal-scoped resource |
| Validation logic | BACKEND_POLICY is authoritative, not this record: per `docs/unica-v5/pos/PRIVY-DEVICE-MODEL.md` §6 (cited, not edited), the lost/stolen-device procedure's first, load-bearing step is "disable the affected staff account in UNICA's own backend/role table first — this is what actually revokes access," independent of any token or record's own propagation delay. This ENS record is a **display/discovery convenience only**; a terminal showing `active` here after a real backend revocation is a known, documented staleness window (see `PAYMENT-BINDING.md` §4.1–§4.2 of this stream), never mistaken for continued authority. A terminal's actual ability to act is additionally gated by the on-chain order-creator allowlist (`docs/unica-v4/SPEC-CONTRACTS.md` §4's "Order creator" row) where relevant |
| Security significance | MEDIUM as a UX-freshness concern only, **provided** nothing downstream ever branches real authorization on this record — a rule this document states explicitly and `PAYMENT-BINDING.md` enforces at every revocation-timeline row |
| Cacheable | Yes, short TTL matching ENS propagation lag |
| Cache lifetime | PROPOSED 2 minutes; always shown beside its read-time so staleness is visible, mirroring `ENS-NFT-SCHEMA.md`'s own `IdentityMismatch.asOfBlock` convention |
| Failure behaviour | Absent: UNKNOWN, never defaulted to `active`. The UI shows "status unknown — verify with the merchant" rather than assuming either active or revoked |
| Example testnet value | `active` — PROPOSED, illustrative; no live UNICA terminal subname exists as of 2026-09-11 |

### 6.10 `com.unica.agent-policy`

| Field | Value |
|---|---|
| Exact key | `com.unica.agent-policy` |
| Standard / ENSIP | Vendor Service Key |
| Vendor prefix | `com.unica` |
| Value grammar | PROPOSED: an `https://` or `ipfs://` URL to a **human-readable** policy explanation page — deliberately **not** the machine-checkable capability list, to avoid duplicating the already-BUILT `unica:capabilities` key (§5.5) |
| Maximum encoded length | 512 bytes |
| Mutability | Mutable |
| Authorized writer | ENSV2_ONCHAIN: `SET_TEXT` at this key's per-key resource — for a self-describing agent, the agent's own leaf, per its `AGENT_DEFAULT_ROLES` scope; for a merchant-level policy page, the merchant/operator |
| Authorized revoker | ENSV2_ONCHAIN: `adminRole(SET_TEXT)` holder |
| Validation logic | CLIENT_VERIFICATION, and this is the key's central rule: **never authoritative for what an agent may actually do.** The authoritative facts are the on-chain per-key EAC grants, read via `integrations/ensv2/permissioned.mjs`'s `readAuthorization`/`roles()`/`hasRoles()` at the **exact per-key resource** — `roles.mjs`'s own `resourceNote` warns that reading only the name-level or `ROOT_RESOURCE` shows zero even when the agent can write a specific key, so any consumer of this record MUST perform that specific per-key read before trusting anything the agent claims here or that this page describes |
| Security significance | MEDIUM — a misleading policy description could over- or understate what an agent can do in a merchant's or payer's eyes, but never changes what EAC actually enforces on-chain, which is independent of this text |
| Cacheable | Yes |
| Cache lifetime | PROPOSED 15 minutes |
| Failure behaviour | Absent: treat the agent's capabilities as UNKNOWN; a consumer MUST fall back to a live per-key EAC read before trusting anything the agent publishes elsewhere |
| Example testnet value | **None.** No live value exists at this specific key as of 2026-09-11. The repository's live, related fact sits at the existing `unica:capabilities` key (`HACKATHON.md` §6: the agent's scope is provable "in six rows, five of them refusals"), which this document does not re-read or restate as a value here — see §5.5 for why the two keys are scoped apart rather than merged |

## 7. What must never be stored in any UNICA ENS record

Binding on every key above: no secret, token, private
endpoint, customer data, raw payment authorization, or recovery material is ever stored in an ENS
record. No record is ever the sole holder of a mutable trusted settlement address without
independent on-chain verification — `com.unica.registry` (§6.2) and every future record like it
is a discovery pointer that a client MUST re-verify, never a value a client is entitled to trust
outright. No record holds an unbounded JSON document; every value above carries a stated maximum
length, and any structured payload larger than that bound is referenced by a pointer (an
`ipfs://` or `https://` URL) rather than inlined. This rule is why `com.unica.agent-policy` (§6.10)
is a pointer and not the policy itself, and why the ENSIP-27 `schema` field (§5.4) is a pointer to
a JSON Schema rather than the schema inlined into the record.

## 8. Unknowns

1. Whether the two "ENSIP-27" documents (§2 S5 vs S6) are ever reconciled under one number, and
   which content — if either — ships as the final ENSIP-27 — not resolvable from the sources
   retrieved on 2026-09-11.
2. Whether UNICA should adopt ENSIP-25/26 (`agent-registration`, `agent-context`,
   `agent-endpoint[<protocol>]`) for its already-live delegated-agent surface, or keep the
   existing `unica:agent`/`unica:capabilities` keys, or publish both — an owner decision, not
   settled by this document (§5.5).
3. Whether the `unica:` colon-delimited key family and the `com.unica.*` reverse-dot-notation
   family (§5.5) should ever be unified under one namespace, and if so, how a live, already-
   broadcast delegation (`HACKATHON.md` §6) would be migrated without a window where two
   different keys carry the same fact — not addressed here.
4. Whether ENSIP-27's `class`/`schema` mechanism (§5.4) is adopted for UNICA terminal/agent
   subnames in `docs/unica-v5/ens/AGENT-IDENTITY.md` and `POS-TERMINALS.md`, or whether those
   documents' own status/policy keys stand alone — each of those files states its own position;
   this document does not decide for them.
5. The exact maximum length ENSv2's Permissioned Resolver enforces, if any, for a single text
   record's value. `docs.ens.domains/ensv2/permissioned-resolver` (S7) states none; this document's
   per-key length bounds above are therefore UNICA-side PROPOSED product bounds for UI and
   gas-cost predictability, not a protocol-enforced ceiling, and a value exceeding a PROPOSED
   bound would still be accepted on-chain unless a future write-time check refuses it.
6. Whether Enhanced Access Control's `enhanced-access-control` documentation page (S8) has changed
   since its 2026-09-08 retrieval by `integrations/ensv2/permissioned.mjs` — not re-fetched for
   this document; a future revision of this file should re-verify it directly rather than continue
   citing the earlier retrieval.
7. The "isolated deployment," "Universal Resolver override," "invalid old initialize/authorize
   interfaces," "direct contract registration," "MockUSDC is not Circle USDC," and "manager UI
   failures" claims, said to be repeated from an unavailable sponsor-channel transcript, remain
   **UNVERIFIED LEADS**. Of these, this document's own research neither confirms
   nor refutes any of them against an official source; they are not incorporated into any record
   design above and are carried forward as open items for whoever next has access to that channel
   or an equivalent official statement.
8. Whether the ENS sponsor track's "Best Use of ENSv2" bonus language — "think agents as
   namespaces, each with their own identity and permissions" (S12) — is meant to describe exactly
   the terminal/agent-subname design this stream is building, or a different shape entirely; no
   ENS team member has confirmed either reading in writing.
