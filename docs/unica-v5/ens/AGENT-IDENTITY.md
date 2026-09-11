# UNICA v5 ENS — delegated agent identity lifecycle

Status: DRAFT, research and architecture only. Nothing here is committed, deployed, or written to
any name beyond what this repository has already live-tested and disclosed elsewhere
(`integrations/ensv2/agent.mjs`, `HACKATHON.md` §6). No new registry, resolver, proxy, or NFT is
deployed by this work; no new name or subname is registered; no MockUSDC is minted or approved; no
key is signed or broadcast; no ENS record is changed by this file.

Labels: **VERIFIED**, **PROPOSED**, **DOCUMENTED_NOT_OBSERVED**, **UNKNOWN**. Authority labels:
**ENSV2_ONCHAIN**, **UNICA_ONCHAIN**, **BACKEND_POLICY**, **GRAPH_EVIDENCE**,
**CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION**.

## 1. Sources

| # | Source | Author/org | Kind | Retrieved | Used for |
|---|---|---|---|---|---|
| S1 | `integrations/ensv2/roles.mjs` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The entire already-BUILT delegation mechanism: `authorizeTextRoles`, `screenAgentGrant`, `DENIAL_MATRIX`, `AGENT_ALLOWLIST`/`AGENT_DEFAULT_ROLES`, `checkAssigneeHeadroom`, `commitPolicy`, `RECORD_KEYS` |
| S2 | `integrations/ensv2/permissioned.mjs` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | `readAuthorization`, the `PROBE`/`AUTHZ_STATUS` vocabulary, the resource derivation functions, the `INTERFACE`/`RESOURCE_DERIVATIONS` observation ledgers |
| S3 | `HACKATHON.md` §6 (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The live, broadcast fact: "12 transactions, blocks 11670554–11670579, every one `status 1`... The agent holds `SET_TEXT` at one per-key resource and nothing at the name, the payment name or ROOT_RESOURCE" |
| S4 | `raw.githubusercontent.com/ensdomains/ensips/master/ensips/25.md` (ENSIP-25) | ENS | OFFICIAL REPO, status draft | 2026-09-11 | `agent-registration[<registry>][<agentId>]`, its ERC-8004/ERC-7930 grounding, its verification flow |
| S5 | `raw.githubusercontent.com/ensdomains/ensips/master/ensips/26.md` (ENSIP-26) | ENS | OFFICIAL REPO, status draft | 2026-09-11 | `agent-context`, `agent-endpoint[<protocol>]`, the resolution order |
| S6 | `raw.githubusercontent.com/ensdomains/ensips/master/ensips/27.md` (ENSIP-27, as merged) | ENS | OFFICIAL REPO, status draft | 2026-09-11 | `class`/`schema`, the pascal-case class table including `Agent` |
| S7 | `docs/unica-v5/ens/RECORDS.md` (this stream) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | §5's full field-by-field evaluation of ENSIP-25/26/27 for an agent surface, and §6.10's `com.unica.agent-policy` |
| S8 | `docs/unica-v5/ens/PAYMENT-BINDING.md` (this stream) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | §4.8's revocation-timeline row for an agent endpoint change |
| S9 | `ethglobal.com/events/ethonline2026/prizes` | ETHGlobal | OFFICIAL | 2026-09-11 | The ENS track's own bonus language: "think agents as namespaces, each with their own identity and permissions" (`RECORDS.md` §2 S12) |

## 2. What is already BUILT and live, and what this file adds

**Already BUILT and independently reproducible, not redesigned here.** This repository's own
`integrations/ensv2/roles.mjs` and `permissioned.mjs` (S1, S2) constitute a working, fork-tested
agent-delegation mechanism, and — per `HACKATHON.md` §6 (S3) — the grant itself is
**live-broadcast** on ENSv2 Sepolia: twelve transactions, blocks 11670554–11670579, every one
`status 1`. `HACKATHON.md` §6 (S3) further describes six simulated rows run against live
post-broadcast state (`integrations/ensv2/agent.mjs`, `eth_call`, not a further broadcast),
"five of them refusals," and characterizes the result as the agent holding `SET_TEXT` at exactly
one per-key resource of one leaf name. **This document does not carry that per-key characterization
as VERIFIED.** Whether the broadcast grant landed at the finer per-key resource or the coarser
name-level resource is **DOCUMENTED_NOT_OBSERVED** against the live chain: this repository's own
most current adjudication (`ACCESS-CONTROL.md` §16) finds that every live Sepolia call it has
observed, including after this broadcast, has named only the name-level resource, and that the
per-key resource formula is confirmed by `FORK_EXECUTED` evidence only — a local-fork replay, never
a live readback that prints the resource hash beside the block number. `docs/unica-v5/ens/README.md`
Success criterion 8 states the same conservative reading; this document carries it too rather than a
stronger one. This document does not redesign the delegation mechanism itself. It states the
lifecycle it already implements, end to end, with each step's authority label made explicit — because
the assignment asks for "the two lifecycles end to end, each step carrying its authority label,
including what a revoked terminal or agent can and cannot still do," and the agent half of that
already has a working implementation to describe accurately rather than invent.

**What this file adds.** Three things not present in `roles.mjs`/`permissioned.mjs` today: (a) an
explicit fit-check against ENSIP-25/26/27, the ENS DAO's own draft standards for exactly this
problem (§4.2); (b) the full step-by-step lifecycle table with authority labels, generalizing the
one delegation this repository has actually executed into a repeatable sequence; and (c) an
explicit "what a revoked agent can and cannot still do" section (§5), which restates and sharpens
`roles.mjs`'s own `DENIAL_MATRIX` in the vocabulary this stream's other documents use.

## 3. Agent identity model

An agent's ENS identity is a leaf subname the merchant/operator controls — in this repository's
live case, a `.eth`-rooted leaf under the merchant's own name, per `HACKATHON.md` §6's own
description of the broadcast delegation. The agent is granted **`SET_TEXT` at exactly one per-key
resource** on that leaf — never at the leaf's name-level resource, never at `ROOT_RESOURCE`, and
never at any resource belonging to a name the merchant relies on (`unica.pay`, `unica.treasury`,
per S1's `PROTECTED_RESOURCE` screen). This is the load-bearing security property `roles.mjs`'s own
header states plainly: "the agent is given authority at the resource of a LEAF NAME that carries
nothing the merchant relies on, and no authority at any resource belonging to the merchant's own
names." An agent's ENS identity, exactly like a terminal's (`POS-TERMINALS.md` §3 of this stream),
is a **discovery and status-publication surface**, never a signing identity for settlement — the
agent's authority is scoped to writing text, nothing else, and `screenAgentGrant` refuses every
shape of call that would let it do more (§4.3, §5).

**Fit against ENSIP-25/26/27 (S4–S6, `RECORDS.md` §5).** ENSIP-26's own stated design philosophy —
"a single identity model for multichain agents," eliminating fragmentation (S5) — matches this
repository's own architecture closely enough that adopting `agent-context` and
`agent-endpoint[<protocol>]` for the capability-description half of this lifecycle is a real
candidate, evaluated in §4.5 rather than assumed. ENSIP-25's `agent-registration[<registry>]
[<agentId>]` (S4) is grounded in ERC-8004-style on-chain agent registries, which UNICA does not use
today (no ERC-8004 registry exists in this project) — recorded as a non-fit for now, not a future
commitment, in §4.2. ENSIP-27's `class = Agent` (S6) is a plausible, low-cost label for this leaf if
adopted (§4.5), entirely orthogonal to the actual authority question, which EAC alone answers.

## 4. Lifecycle, step by step, each step's authority label

### 4.1 Naming and subname reservation

| | |
|---|---|
| Authority label | OFFCHAIN_OPERATION (choosing the leaf label) |
| What happens | The merchant/operator picks the agent's leaf name (in the live case, a subname under the merchant's own `.eth` name, `HACKATHON.md` §6) and computes its node via `namehash`, exactly as `integrations/ensv2/permissioned.mjs`'s `managedSubname` (S2) does for the general case |
| Who acts | The merchant/operator |
| Failure behaviour | A malformed label is refused before anything is registered (`SUBNAME_STATUS.BAD_LABEL`, S2) |

### 4.2 Registration (ENSIP-25/26 fit)

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN if a registered subname is minted; OFFCHAIN_OPERATION for the ENSIP-25/26 fit decision itself |
| What happens | If the agent is also registered in an on-chain agent-identity registry (an ERC-8004-style contract), ENSIP-25 (S4) defines `agent-registration[<registry>][<agentId>]` as the standard verification key linking that registry entry back to this ENS leaf. **UNICA does not use such a registry today** — this step is DOCUMENTED_NOT_OBSERVED for this project, recorded because a future integration would slot in exactly here, not because it exists |
| Who acts | N/A today; would be the merchant/operator (grantor) and the registry-recorded agent identity (subject), per S4's own flow |
| What this repository actually does instead | Publishes the agent's own descriptive facts directly as UNICA vendor keys (`unica:agent`, per `RECORD_KEYS` in S1) rather than through a registry-verification key — a narrower, self-contained design that does not depend on any external registry existing |

### 4.3 Scoped permission grant

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN |
| What happens | The merchant/operator, holding `adminRole(SET_TEXT)` at the agent leaf's chosen per-key resource, calls `authorizeTextRoles(agentDnsName, recordKey, agentAddress, granted=true)` — S1's `planAgentGrant`/`buildTextDelegation`. The planner **computes and targets** the effective resource `keccak256(abi.encode(node, keccak256(bytes(recordKey))))` (S1's `resourceNote`), not the name-level resource — the property `roles.mjs`'s own header calls "the resource IS the separation." `recordKey` must be one of the closed vocabulary in `RECORD_KEYS` (S1) — never an arbitrary string. **This is a property of the planner's own code, PROPOSED for what the call targets — not yet a live-confirmed property of the resource the chain actually recorded**; see the "Live proof" row below and §2 above for why the two are kept separate |
| Who acts | The merchant/operator signs; the agent's own address is the grantee |
| Precondition, checked by `screenAgentGrant` (S1) before this call is ever built | Resource is not `ROOT_RESOURCE` (`ROOT_RESOURCE_FORBIDDEN`); method is not `authorizeNameRoles` (`NAME_LEVEL_METHOD_FORBIDDEN` — the wide call); bitmap carries no admin bit (`ADMIN_ROLE_FORBIDDEN`); bitmap is only allowlisted roles (`ROLE_NOT_ALLOWLISTED`/`ROLE_NOT_OBSERVED`); resource is not on the merchant's protected list (`PROTECTED_RESOURCE`); grantee is not the merchant itself (`AGENT_IS_MERCHANT`); grantee does not already hold `ROOT_RESOURCE` roles (`AGENT_HOLDS_ROOT_ROLES`); assignee headroom is available (`ASSIGNEE_CAP_REACHED`/`ASSIGNEE_COUNT_UNOBSERVED`) |
| Measured (VERIFIED, S1's own header) | `grantRoles` — the call the documentation leads a reader to — is **refused by the deployed contract itself** with `EACCannotGrantRoles` (`0xd1a3b355`) even from the name owner holding every root role; `authorizeTextRoles` is the call that is actually accepted. `screenAgentGrant` refuses `grantRoles`/`revokeRoles` by name (`GRANT_ROLES_NOT_THE_DELEGATION_PATH`) as the last, least-urgent check, precisely so a call that is *also* wrong in a more dangerous way reports the more dangerous reason first |
| Live proof | `HACKATHON.md` §6 (S3): 12 transactions, blocks 11670554–11670579, all `status 1` — proof the grant call was broadcast and mined, **not**, on this record, proof of which resource it landed at. Per §2 above and `ACCESS-CONTROL.md` §16, that specific question is DOCUMENTED_NOT_OBSERVED against the live chain; no source in this directory prints the resource hash the post-broadcast readback actually named |

### 4.4 Normal operation

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN |
| What happens | The agent writes its scoped text key (e.g. a status or capability string, S1's `RECORD_KEYS`) using its own held `SET_TEXT` grant. It cannot write any other key on this leaf, any key on the merchant's protected names, or anything at `ROOT_RESOURCE` — enforced by the chain itself (`EACUnauthorizedAccountRoles`), not merely by the planner's screen (§5) |
| Who acts | The agent's own held key |
| What this step never does | Create a UNICA order, call `pay()`, or touch any settlement contract — an agent in this design has **no** on-chain settlement capability of any kind; its entire on-chain footprint is text-record writes at one scoped resource |

### 4.5 Capability publication

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN (the write itself) and CLIENT_VERIFICATION (how a reader must treat it) |
| What happens | The agent (or the merchant, on its behalf) publishes a human-readable description of what the agent does. Three candidate mechanisms, none adopted over the others by this document: (a) the existing `unica:capabilities`/`unica:agent` keys (S1, already BUILT and scoped exactly as §4.3 describes); (b) ENSIP-26's `agent-context` and `agent-endpoint[<protocol>]` (S5, `RECORDS.md` §5.2–§5.3); (c) `com.unica.agent-policy` (`RECORDS.md` §6.10), scoped as a **pointer to an explanatory page**, deliberately distinct from (a) so the two do not duplicate one payload under two keys |
| Who acts | The agent's own scoped key, for whichever of (a)/(b)/(c) it is granted `SET_TEXT` over |
| The rule that governs all three | Restated from `RECORDS.md` §6.10 and S1's own `resourceNote`: **none of these publications is authoritative for what the agent may actually do.** A reader (merchant, payer, or another agent) MUST perform a live `roles()`/`hasRoles()` read at the agent's **exact per-key resource** before trusting any claim the agent publishes about its own capabilities — reading only the name-level or `ROOT_RESOURCE` resource shows zero even when the agent can legitimately write a specific key (S1's own measured warning), which is the wrong-direction failure this whole design exists to avoid |

### 4.6 Revocation

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN |
| What happens | The merchant/operator calls the **same** `authorizeTextRoles` function with `granted=false` (S1's `planAgentRevoke` — "the undo is the same function, which is a small mercy: there is no second permission to have forgotten to arrange") |
| Who acts | The merchant/operator, holding `adminRole(SET_TEXT)` at the same resource the grant was made at |
| Precondition | None beyond holding the admin bit — `checkAssigneeHeadroom`'s cap check applies only to granting, never to revoking (S1: "Revoking frees a slot; refusing a revocation because the resource is full would be refusing the one call that fixes it") |
| Effect | The agent's `SET_TEXT` grant at that one resource is removed; every other resource the agent never held stays exactly as it was (nothing to revoke there) |

### 4.7 Re-delegation

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN |
| What happens | A new grant (§4.3) to a new agent address, at the same or a different scoped resource, following the identical screened path — nothing about re-delegation is a distinct mechanism from the original grant |
| Who acts | The merchant/operator |
| What is checked again, not assumed carried over | `AGENT_HOLDS_ROOT_ROLES` and `AGENT_IS_MERCHANT` are re-checked against the **new** agent address; a re-delegation to an address that happens to already hold broader authority elsewhere is refused exactly as a first-time grant would be |

## 5. What a revoked agent can and cannot still do

**Cannot, from the moment the on-chain revocation transaction is mined (a hard, protocol-level
guarantee — not a policy this document merely recommends):**

- Write the revoked text key, or any other key or resource it never held. `EACUnauthorizedAccountRoles`
  fires on the very next attempt (S1, S2's own `PROBE`/`AUTHZ_STATUS` vocabulary), the same
  refusal shape already measured live for an unauthorized probe address (`integrations/ensv2/README.md`).
- Escalate to any wider authority than it ever had — because it never held any (§3, §4.3's
  precondition list), revocation removes the one narrow thing it could do; there is no broader
  capability lurking underneath to worry about.
- Move funds, create an order, or influence settlement in any way, before or after revocation —
  restated because it was never true either way (§4.4).

**What is a genuine, stated residual, not hidden:**

- **Off-chain caches of the agent's pre-revocation publications persist until they expire or are
  overwritten.** If the agent published `agent-context`/`com.unica.agent-policy`/`unica:capabilities`
  describing itself before revocation, a reader relying on a cached copy of that description
  (rather than a live per-key EAC read) may act on stale information for as long as its own cache
  TTL runs (`RECORDS.md`'s own stated TTLs per key). This is exactly why §4.5's rule is stated in
  the imperative — a reader that skips the live EAC check and trusts a cached capability claim is
  the one place a revoked agent's *old words* can still mislead, even though its *new actions* are
  cut off immediately on-chain.
- **A revoked agent's past writes remain in ENS history and in any indexer that captured them**
  (`GRAPH-COMPOSITION.md` §3.4 of this stream) — permanently, as evidence. This is not a
  vulnerability; it is the same "revocation does not rewrite history" property `PAYMENT-BINDING.md`
  §4.5/§6 states for orders, applied here to record writes.

## 6. Unknowns

1. Whether UNICA ever adopts an ERC-8004-style on-chain agent registry, which would make ENSIP-25's
   `agent-registration[<registry>][<agentId>]` (§4.2) directly applicable rather than
   DOCUMENTED_NOT_OBSERVED — no such registry exists in this repository as of 2026-09-11.
2. Whether ENSIP-26's `agent-context`/`agent-endpoint[<protocol>]` (§4.5) are adopted in place of,
   or alongside, the existing `unica:agent`/`unica:capabilities` keys — an owner decision, carried
   from `RECORDS.md` §8 item 2, not resolved here.
3. Whether a future design ever grants an agent `SET_ADDR` (available in `roles.mjs`'s
   `AGENT_ALLOWLIST` as an opt-in, never the default, S1) for a legitimate operational-address
   publication use case, and if so, what additional review that would need beyond the existing
   `screenAgentGrant` path — not designed here; §3 states the current design grants `SET_TEXT`
   only.
4. Whether the two still-unmerged "ENSIP-27" proposals (`RECORDS.md` §5.4's conflict) settle in a
   way that changes which draft standard, if either, ends up governing an `Agent`-classed node —
   not resolvable from sources retrieved on 2026-09-11.
5. Whether the ETHGlobal ENS track's "agents as namespaces, each with their own identity and
   permissions" bonus language (S9) is meant to describe exactly this lifecycle, a different shape,
   or is deliberately open-ended — no ENS team member has confirmed a reading in writing (restated
   from `RECORDS.md` §8 item 8).
6. The unverified leads carried from an unavailable sponsor-channel transcript (isolated
   deployment, Universal Resolver override, invalid old initialize/authorize interfaces, direct
   contract registration, MockUSDC vs. Circle USDC, manager UI failures) were not confirmed or
   refuted by this document's research and play no role in any step above — see `RECORDS.md` §8
   item 7.
