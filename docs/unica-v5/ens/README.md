# UNICA v5 / ENS — synthesis

Research draft for owner review. Not committed. Authorizes nothing. UNICA v5 scope; it does not
change or delay UNICA v4 settlement.

This document reads every file in this directory and edits none of them. It is read-only research
and architecture: it registers no name, deploys no registry/resolver/proxy/NFT, mints or approves
no MockUSDC, signs or broadcasts nothing, and changes no ENS record. Labels on every material
statement: **VERIFIED** (source cited), **PROPOSED** (UNICA design), **DOCUMENTED_NOT_OBSERVED**
(read from a document or a fork, never confirmed against a live broadcast this project made), or
**UNKNOWN**. Authority label on every described action, never blended: **ENSV2_ONCHAIN**,
**UNICA_ONCHAIN**, **BACKEND_POLICY**, **GRAPH_EVIDENCE**, **CLIENT_VERIFICATION**,
**OFFCHAIN_OPERATION**.

**No transcript of any ENS sponsor-channel discussion reached this directory.** Every one of the
seventeen source files says so independently, and this synthesis repeats it once, here, rather than
per section: the claims the originating brief attributed to that channel — an isolated deployment, a
Universal Resolver override, invalid old `initialize`/`authorize` interfaces, direct contract
registration, "MockUSDC is not Circle USDC," manager-UI failures — were each checked against
official ENS sources or this repository's own first-party measurements, independent of the missing
transcript, and are reported below exactly as confirmed, partially confirmed, or not confirmed by
that independent check (§19, §23).

## File index

Read in full for this synthesis, edited by none of it:

| File | Subject |
|---|---|
| `ACCESS-CONTROL.md` | Enhanced Access Control mechanism, roles for UNICA's actors, escape-route analysis |
| `AGENT-IDENTITY.md` | Delegated agent identity lifecycle, ENSIP-25/26/27 fit |
| `DEMO-PLAN.md` | Five candidate demos scored, primary/fallback recommendation, seven-phase build sequence |
| `DEPLOYMENT-CONFIG.md` | Pinned Sepolia addresses, proxy-chain volatility, preflight checks |
| `DIFFERENTIATION.md` | UNICA's ENS thesis argued section by section against peer patterns |
| `GRAPH-COMPOSITION.md` | Indexed evidence composition, join surface against the settlement schema |
| `IDENTITY-NFT.md` | Deterministic SVG identity NFT design, six-layer separation, golden-vector tests |
| `MENTOR-QUESTIONS.md` | Ten questions answered from public sources, each closed or left open |
| `NAMESPACE.md` | The smallest namespace hierarchy, four candidate classes rejected by name |
| `PAYMENT-BINDING.md` | The required revocation table, ten rows, the non-negotiable boundary as a design rule |
| `PEER-COMPARISON.md` | Peer-pattern catalogue (cited throughout; not independently re-read line by line here) |
| `POS-TERMINALS.md` | Point-of-sale terminal identity lifecycle |
| `PRIZE-FIT.md` | Track resolution, prize wording, eligibility risks, deadline conflict |
| `RECEIPT-NAMING.md` | Five receipt-discovery models compared and scored |
| `RECORDS.md` | Full text-record inventory: ENSIP-5, ENSIP-25/26/27, and `com.unica.*` vendor keys |
| `SCALABILITY.md` | Four settlement-volume scenarios, exact breaking points named |
| `THREAT-MODEL.md` | Twenty-eight threats, each with a real/hypothetical classification and a residual |
| `README.md` | This file |
| `OPEN-QUESTIONS.md` | The owner-decision block this synthesis compiles from the seventeen files above |

Cited, never edited: `docs/unica-v5/graph/` (a sibling stream running the same exercise for The
Graph) and `docs/unica-v5/pos/` (the countertop-workflow stream `POS-TERMINALS.md` builds on).

---

## 1. Current UNICA ENS usage

**VERIFIED**, repository. ENSv2 is one of three integrations already submitted
(`docs/SPONSOR-ELIGIBILITY.md`, cited by `PRIZE-FIT.md` §1), status `LIVE READ`: live Sepolia
resolution with every failure shape classified, name-to-configuration-to-quote commitment, and
permissioned resolution exercised against the deployed contracts. `unica.eth` is registered and
delegated on ENSv2 Sepolia to this project's deployer (12 transactions, blocks 11670554–11670579,
`PRIZE-FIT.md` §1). A delegated agent's `SET_TEXT` grant on one leaf name was broadcast in the same
block range and every transaction mined at `status 1` (`HACKATHON.md` §6). **Whether that grant
landed at the finer per-key resource, as `HACKATHON.md` §6 itself characterizes it, or only at the
coarser name-level resource `keccak256(node, bytes32(0))`, is DOCUMENTED_NOT_OBSERVED against the
live chain — not VERIFIED, and not settled by this broadcast alone.** This repository's own most
current adjudication (`ACCESS-CONTROL.md` §16) finds that every live Sepolia call it has observed,
including after this broadcast, has named only the name-level resource, and holds the per-key
resource formula confirmed by `FORK_EXECUTED` evidence only — a local-fork replay, not a live
readback. `HACKATHON.md` §6's own reading of a six-row simulated check
(`integrations/ensv2/agent.mjs`, `eth_call` against live post-broadcast state, not a further
broadcast) is not, on this record, sufficient to overturn that adjudication, because no source in
this directory prints the resource hash that check actually named beside the block number. §8, §13,
and Success criterion 8 below carry this same conservative label rather than three different ones,
cited throughout `AGENT-IDENTITY.md` and `ACCESS-CONTROL.md`. `integrations/ensv2/roles.mjs`,
`permissioned.mjs`, and `profile.mjs`
already implement: resource derivation for both registry and resolver, the full EAC role bitmap,
`authorizeTextRoles`-based delegation with a `DENIAL_MATRIX`, and a `verifyProfile` preflight that
fails closed on chain id, bytecode, and implementation mismatch (`ACCESS-CONTROL.md` §2, §6,
`DEPLOYMENT-CONFIG.md` §11–§12). None of this v5 stream's own files change any of that code; every
one of them is read-only research layered on top of it.

## 2. What is cosmetic versus operational

**Operational — a change here changes what the system can do, not merely how it looks**: the
per-key `authorizeTextRoles` delegation and its revocation (`ACCESS-CONTROL.md` §6, `AGENT-IDENTITY.md`
§4.3–§4.6, `POS-TERMINALS.md` §4.3–§4.7); the resolver/registry role architecture and its
`ROOT_RESOURCE` cascade (`ACCESS-CONTROL.md` §3, §15); wildcard resolution as the mechanism that lets
a merchant-controlled subname exist without a per-merchant registration transaction (`NAMESPACE.md`
§0, §2); the fixed entry point and bytecode/implementation preflight that decide whether a resolved
name is trusted at all (`DEPLOYMENT-CONFIG.md` §4, §12, `THREAT-MODEL.md` §3.1–§3.2); and the
non-negotiable settlement boundary itself, which is enforced by the UNICA contract reading a stored
value once, never by ENS (`PAYMENT-BINDING.md` §2–§3, `THREAT-MODEL.md` §2).

**Cosmetic — a change here changes what a viewer sees, never what a contract will do**: the `avatar`
identity NFT and its renderer (`IDENTITY-NFT.md` throughout, `RECORDS.md` §4.1, §6.8); `description`
and `url` (`RECORDS.md` §4.2–§4.3); `class`/`schema` (`RECORDS.md` §5.4); the operational-status
overlay drawn beside the immutable art (`IDENTITY-NFT.md` §5.2); and every discovery/endpoint pointer
(`com.unica.market-discovery`, `com.unica.receipt-endpoint`, `com.unica.x402-endpoint`,
`agent-context`, `agent-endpoint[<protocol>]`) — each one is explicitly a "here is where to ask,"
never "here is the answer that binds anything" (`RECORDS.md` §6.3–§6.6, §5.2–§5.3). The dividing
line is exact and stated the same way in every source file: does UNICA's own contract, or its own
backend-authority check, ever read this value before moving money or granting operational access? If
no, it is cosmetic, however important it is for trust and discovery.

## 3. Peer patterns worth adapting

From `DIFFERENTIATION.md` and the patterns it cites from `PEER-COMPARISON.md` (companion document,
cited not independently re-derived here):

- **Enhanced Access Control's precise, per-resource revocation** — a role removed from one assignee
  at one resource never touches another assignee or another resource (`DIFFERENTIATION.md` §6,
  `ACCESS-CONTROL.md` §11). This is the mechanism UNICA's terminal and agent revocation both build
  on directly.
- **ENSIP-10 wildcard resolution** as the mechanism that gives a merchant-controlled subname
  existence and records without a registration transaction (`NAMESPACE.md` §0, §2, §9) — the basis
  for the recommended `subtree`-mode default.
- **ENSIP-26's `agent-context`/`agent-endpoint[<protocol>]`** as a candidate, standards-track
  replacement or complement for UNICA's already-live `unica:agent`/`unica:capabilities` keys
  (`AGENT-IDENTITY.md` §4.5, `RECORDS.md` §5.2–§5.3, §5.5) — evaluated, not yet adopted (E7,
  `OPEN-QUESTIONS.md`).
- **ENSIP-12's avatar-ownership SHOULD-level cross-check** as the anti-substitution mechanism for a
  deterministic identity NFT (`IDENTITY-NFT.md` §10.2, `THREAT-MODEL.md` §3.20) — adopted as a
  client-side warning, never a settlement gate.
- **The official ENS blog's own framing of agentic-commerce identity** — "payment rails composable
  rather than collapsing them into identity systems" (`DIFFERENTIATION.md` §5, §8, quoted from
  `ens.domains/blog/post/ens-ai-agent-erc8004`, OFFICIAL) — read as independent, official
  corroboration of UNICA's own boundary, not the source of it.
- **CCIP-Read / EIP-3668's own trust-tradeoff framing** (signed gateway can lie; proof-backed gateway
  can only go offline) as the model to reach for once UNICA settlement data is not already cheaply,
  synchronously on-chain-readable — concretely, a future cross-chain receipt (`RECEIPT-NAMING.md` §3,
  §7).

## 4. Patterns to avoid copying

- **One ENS name per receipt.** Rejected outright on gas grounds alone: even the cheapest measured
  write as an explicit floor costs roughly 10% of Ethereum's entire daily network gas capacity at
  1,000,000 receipts/day, before privacy is even considered (`RECEIPT-NAMING.md` §1, §6,
  `SCALABILITY.md` §4, §6).
- **A per-merchant individually-proxied registry/resolver set (`subregistry` mode) as the default at
  scale.** Safe and even preferable at 1–100 merchants; at 10,000 merchants it means 30,000
  independently-deployed registries and 10,000 independently-initialized resolver proxies, each a
  separate authority-holding instance that must be separately verified — and this repository has
  already observed exactly this class of anomaly (a second, unidentified full-authority account) on
  the one proxy it has read (`SCALABILITY.md` §3, §6, `NAMESPACE.md` §12.2, `THREAT-MODEL.md` §3.7).
- **A shared registry across two unrelated names.** Explicitly warned against in the official
  mintlify architecture documentation ("both names would share the same subdomain namespace") and
  never proposed here (`MENTOR-QUESTIONS.md` Q3, `NAMESPACE.md` §11).
- **Treating an ENS role grant as itself the economic permission**, or an ENS text record's presence
  as proof a payment obligation was met, or NFT ownership as proof of receiving a payment.
  `DIFFERENTIATION.md` §3, §8 and `GRAPH-COMPOSITION.md` §5 each state this as a hard limit, restated
  independently by three documents in this directory rather than assumed once.
- **`grantRoles`/`revokeRoles`** — the call the generic Enhanced Access Control documentation leads a
  reader to. The deployed Permissioned Resolver disables both outright
  (`EACCannotGrantRoles`/`EACCannotRevokeRoles`); `authorize(Name|Text|Addr|Data)Roles` is the actual
  path (`ACCESS-CONTROL.md` §3.3, §6).
- **Naming a staff/terminal/cashier leaf name after a real person**, or storing receipt contents
  (rather than a pointer) in a text record — both would permanently publish personal or
  transactional data on a public, forever ledger (`THREAT-MODEL.md` §3.28).

## 5. UNICA's ENS thesis

Stated in full in `DIFFERENTIATION.md` §1 and restated here as this synthesis's own governing
sentence: **ENS gives UNICA a name; it does not, and structurally cannot, give UNICA a guarantee that
the payment behind that name went where the name said it would.** Every peer pattern in the companion
catalogue solves a discovery or governance problem — which address a name means, who may change that
answer, how a non-human actor is named and reached. None of them, individually or combined, answers a
settlement problem: given that money already moved, what proves it moved correctly, and what happens
to that proof when the name's records later change. UNICA's position, argued section by section in
`DIFFERENTIATION.md` §2–§8: a payments product must answer the settlement question with contract
state, never a name lookup, while using ENS for exactly what a name lookup is good at — discovery
before commitment, human-readable identity, machine-readable capability, and economically-scoped
delegation. `DIFFERENTIATION.md` §8 states the hard limit this thesis produces: no UNICA feature may
check "does this name resolve to this address" as a substitute for a contract's own access-control
state, may treat an ENS role grant as itself economic permission, or may treat a text record's
presence as proof an obligation was met.

## 6. The minimal merchant namespace

**PROPOSED**, `NAMESPACE.md` §9, the smallest tree that survives the same evaluation columns applied
to every candidate:

```
<owned-parent>                         subtree (served) mode by default
  merchant.<owned-parent>              own resolver, no own registry, served by wildcard
    pay.merchant.<parent>              protected resource; UNICA_ONCHAIN settlement fields
    treasury.merchant.<parent>         protected resource; commitment only, never a value
      agent.treasury.merchant.<p>      ONE leaf per delegate needing public disclosure
                                        (subsumes staff-as-agent; zero leaves if none needed)
```

Four candidate classes were evaluated on the same columns and rejected by name, not silently
omitted: **terminals** (no payer ever resolves a terminal name; it is an attribution field, not a
discovery target — `NAMESPACE.md` §3, §10), **staff in general** (Enhanced Access Control grants
roles to accounts, not names; a staff member needing public disclosure is simply an instance of the
agent class — §4, §10), **markets** (a market's identity is already its on-chain address/id; the
payer resolves the merchant, never the market — §6, §10), and **receipts as individual names**
(rejected on gas and privacy grounds; see §14 below and `RECEIPT-NAMING.md` in full — §7, §10). Mode
recommendation: `subtree` (served, shared resolver, wildcard) by default for every merchant;
`subregistry` (registered, own resolver+registry proxy) only for a merchant that specifically needs a
transferable, independently-owned name (§9, and E2 in `OPEN-QUESTIONS.md`).

## 7. The complete authority and revocation matrix

See the REQUIRED AUTHORITY MATRIX below. It draws its rows from `ACCESS-CONTROL.md` §7–§9,
`AGENT-IDENTITY.md` §4–§5, `POS-TERMINALS.md` §4–§5, `PAYMENT-BINDING.md` §3–§4, `RECORDS.md`
§4–§6, `THREAT-MODEL.md` §3, `IDENTITY-NFT.md` §5, and `GRAPH-COMPOSITION.md` §3.

## 8. Resolver and registry architecture

**VERIFIED, ENSV2_ONCHAIN**, this repository's own reads corroborated by current official
documentation for the general shape (`ACCESS-CONTROL.md` §1–§5, `DEPLOYMENT-CONFIG.md` §4–§5): the
proxy chain is three hops with two independent admins — the fixed entry point
(`UpgradableUniversalResolverProxy`, `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`), an intermediate
`ManagedUniversalResolverProxy`, and the resolution implementation it currently points at, which the
ENS team's own README documents being deliberately, reversibly repointed mid-event
(`DEPLOYMENT-CONFIG.md` §5, quoted in full). Only the fixed entry point is safe to hard-code long
term; every address downstream of it must be walked live, every use (`DEPLOYMENT-CONFIG.md` §4,
§12). The resolver's resource formula is one function of two inputs — `resource = keccak256(node,
part)`, `part` being either the name-level zero value, a text/data key hash, or a coin-type hash —
now VERIFIED against current official documentation and independently corroborated by a fork
execution of the deployed bytecode (`ACCESS-CONTROL.md` §4, `NAMESPACE.md` §0). **This VERIFIED
status covers the formula's general shape only.** The name-level branch (`part = bytes32(0)`) is
additionally confirmed against the live chain — every live refusal this repository has observed
named exactly that resource. The per-key and per-coin-type branches remain DOCUMENTED_NOT_OBSERVED
against the live chain, confirmed only by the same fork execution, per §1 above and
`ACCESS-CONTROL.md` §16's own adjudication — a reader should not infer from this VERIFIED formula
that any specific live grant discussed elsewhere in this synthesis (§1, §13) has been confirmed at
its per-key branch. The registry's own
resource formula is derived from the label alone and is never interchangeable with the resolver's
formula (`ACCESS-CONTROL.md` §4). Each account gets its own resolver instance; **all names owned by
the same account share one resolver** — VERIFIED, official (`MENTOR-QUESTIONS.md` Q3) — which is
exactly the shape `subtree` mode already assumes: one merchant account, one resolver, many scoped
per-key grants to terminals and agents on it, never a resolver-per-delegate.

## 9. The deterministic identity NFT

**SPECIFIED-NOT-BUILT** throughout; no file exists under `vy/src/art/` or `vy/src/math/`
(`IDENTITY-NFT.md` §0, §3). The design fixes three determinism inputs — `ArtInputs = (normalizedName,
rendererVersion, ensv2DeploymentId)` — the third being new in this stream, closing a collision risk
that would otherwise let art derived from a bare string collide across two unrelated ENSv2
deployments sharing the same name (`IDENTITY-NFT.md` §4.1–§4.2). The seed recommendation is the
ENSIP-1 namehash **node** (a fixed 32-byte value), not the bare leaf label or the full string, because
a bare-label seed would let two merchants under different parents sharing one label collide into
byte-identical art — the exact failure the art layer exists to prevent (`IDENTITY-NFT.md` §4.3, §9).
Six things are kept strictly separate, each with exactly one authority label — immutable core art
(UNICA_ONCHAIN), a live operational-status overlay (CLIENT_VERIFICATION sourced from an ENSV2_ONCHAIN
or GRAPH_EVIDENCE read), the ENS avatar record itself (ENSV2_ONCHAIN, owner-wallet write), NFT
metadata (UNICA_ONCHAIN), a checkout verification badge (CLIENT_VERIFICATION performing live
ENSV2_ONCHAIN reads), and a historical receipt snapshot (BACKEND_POLICY assembling ENSV2_ONCHAIN
reads) — restated repeatedly that none of the six is proof of payout identity by itself
(`IDENTITY-NFT.md` §5, §14). Golden-vector tests are proposed for ASCII-only homograph pairs (the
class that actually reaches this renderer today, since the existing normalizer refuses all non-ASCII
input outright), a colour-only-distinction rule (five palette colours cannot be the sole
distinguisher), and a leaf-label collision case (`IDENTITY-NFT.md` §8, §13). Open: gas cost (no
benchmark exists), the OpenSea `image_data` field (two direct fetches did not confirm it), and
whether ENSIP-15's own normalization gap is ever closed (`IDENTITY-NFT.md` §11, §6.2, §15).

## 10. The record schema

`RECORDS.md` inventories every record UNICA v5's identity layer would use, in three families:

- **Standard ENSIP-5 global keys** — `avatar` (ENSIP-12 NFT-reference grammar), `description`, `url`
  — each Final, unmodified, evaluated directly rather than shadowed (`RECORDS.md` §4).
- **Draft ENSIP-25/26/27 agent-facing keys** — `agent-registration[<registry>][<agentId>]`,
  `agent-context`, `agent-endpoint[<protocol>]`, `class`, `schema` — all status **draft**, evaluated
  for fit and not yet adopted (`RECORDS.md` §5). A genuine naming conflict is recorded rather than
  silently resolved: two different documents both call themselves "ENSIP-27" as of retrieval — the
  merged specification-repository file (Node Classification and Metadata) and an unmerged
  governance-forum proposal (Agent Card Schema) — and this stream treats the merged file as the
  number-of-record, citing the forum proposal only by its own title (`RECORDS.md` §5.4).
- **UNICA vendor keys** — ten `com.unica.*` Service Keys covering release, registry pointer,
  discovery/receipt/graph/x402 endpoints, supported chains, renderer pointer, terminal status, and
  agent-policy pointer (`RECORDS.md` §6). A real inconsistency is recorded, not silently fixed: the
  already-live, already-broadcast `unica:*` colon-delimited keys (`roles.mjs`) predate this stream and
  follow a different convention than the reverse-dot-notation `com.unica.*` family this stream
  defines; neither is renamed or migrated by this document (`RECORDS.md` §5.5, and E7/E12 in
  `OPEN-QUESTIONS.md`).

Binding on every key in every family: no secret, private endpoint, customer data, raw payment
authorization, or recovery material is ever stored in an ENS record, and no record is ever the sole
holder of a mutable trusted settlement address without independent on-chain verification
(`RECORDS.md` §7).

## 11. The payment-binding safety boundary

**VERIFIED, UNICA_ONCHAIN**, already measured, not merely asserted (`PAYMENT-BINDING.md` §2, quoting
`docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §8): "The recipient is resolved once, client-side, before the
order exists, and is then stored on chain in `UnicaExecutorV3.Order.recipient`. Settlement reads only
that stored value and never re-resolves a name... The five settled V3 orders on Sepolia keep the
recipient they were created with, whatever `unica.eth` resolves to afterwards." `PAYMENT-BINDING.md`
§4 walks this through ten required states — terminal revoked before order creation, an unsigned
order, after authorization but before settlement, during settlement, after settlement, merchant root
revoked, resolver replaced, agent endpoint changed, parent registry paused, and a revocation not yet
indexed — and in every one of them, ENS resolution changes only what a future, independent read
returns; it never reaches into stored order state. Four consequences hold across every row, stated
once rather than ten times: no market silently redirects; existing orders and receipts do not change;
a new order requires a fresh readback; and the interface separates current resolution from the
identity observed at settlement (`PAYMENT-BINDING.md` §2). `THREAT-MODEL.md` §2 restates the same
boundary as the governing rule for its own twenty-eight-threat catalogue and adds: an indexer never
authorizes settlement, and an UNKNOWN read fails closed.

## 12. The POS terminal lifecycle

A terminal's ENS identity is a subname of the merchant's parent name, carrying exactly one class of
authority — `SET_TEXT` scoped to `com.unica.terminal-status` at the terminal's own per-key resource,
nothing else, never `ROOT_RESOURCE`, never `SET_ADDR` (`POS-TERMINALS.md` §3). The lifecycle runs
naming → provisioning → role grant → normal operation → status update → key rotation → revocation →
decommission, each step carrying one authority label (`POS-TERMINALS.md` §4). Revocation is
deliberately two independent actions, not one: the backend/device role-table entry is disabled first
— "this is what actually revokes access" — and the on-chain `SET_TEXT` grant is revoked separately
(`POS-TERMINALS.md` §4.7, citing `docs/unica-v5/pos/PRIVY-DEVICE-MODEL.md` §6). The stated residual
this design does not hide: if an operator relies only on the backend disable and never separately
revokes the EAC grant, the old operating key remains technically capable of writing the one text
record it was scoped to indefinitely — which is exactly why `com.unica.terminal-status` is designed
to be read as a display convenience only, never as proof of continued authority
(`POS-TERMINALS.md` §5). Whether terminals use registered or wildcard-resolved subnames is an open
product decision (E5, `OPEN-QUESTIONS.md`).

## 13. The merchant-agent lifecycle

Already partly BUILT and live-broadcast, not merely designed: `integrations/ensv2/roles.mjs` and
`permissioned.mjs` implement a working, fork-tested agent-delegation mechanism, and the delegation
itself was broadcast — "twelve transactions, blocks 11670554–11670579, every one status 1"
(`HACKATHON.md` §6, `AGENT-IDENTITY.md` §2–§3). `HACKATHON.md` §6 itself characterizes the result as
"the agent holds `SET_TEXT` at one per-key resource and nothing at the name, the payment name, or
`ROOT_RESOURCE`," but whether the broadcast grant in fact landed at that finer per-key resource, or
at the coarser name-level resource, is **DOCUMENTED_NOT_OBSERVED** against the live chain — the same
adjudication carried in §1 and §8 above and `ACCESS-CONTROL.md` §16: the per-key resource formula is
confirmed by `FORK_EXECUTED` evidence, never by a live readback that prints the resource hash beside
the block number. This stream's own addition is the fit-check against ENSIP-25/26/27 (an
agent registry, ENSIP-25, is DOCUMENTED_NOT_OBSERVED for this project — no such registry exists), the
full step-by-step lifecycle table with authority labels, and an explicit statement of what a revoked
agent can and cannot still do (`AGENT-IDENTITY.md` §4–§5). Cannot, from the moment revocation is
mined: write the revoked key or any resource it never held, escalate to any wider authority (it never
held one), or move funds, create an order, or influence settlement in any way — restated because it
was never true either way. Genuine residual, stated rather than hidden: off-chain caches of the
agent's pre-revocation publications persist until their own TTL expires, and a revoked agent's past
writes remain permanently in ENS history and any indexer that captured them, as evidence, not as a
vulnerability (`AGENT-IDENTITY.md` §5).

## 14. The scalable receipt-discovery model

Five models compared on cost, lookup, proof, and leak (`RECEIPT-NAMING.md` §1–§6): **A**, one
subname per receipt — rejected outright on gas alone (≥10% of Ethereum's daily network gas capacity
at the measured floor, at 1,000,000 receipts/day). **B**, a wildcard-derived name resolved live from
settlement state — zero incremental writes, a real complement wherever an ENS-shaped pointer is
wanted. **C**, CCIP-Read backed by a signed or proof-backed gateway — the right upgrade only once
receipt data is not already cheaply, synchronously on-chain-readable (concretely, cross-chain
receipts), and it adds a fingerprinting exposure Model B does not have. **D**, a merchant service
record pointing at an existing (or the Graph sibling stream's own) query endpoint — the recommended
default: one record on a name that already exists for an unrelated reason, zero new hierarchy,
deliberately weak at the ENS layer because the underlying settlement event remains independently
verifiable regardless of what the record claims. **E**, an epoch subname carrying a commitment root —
one write per epoch regardless of receipt count inside it (0.00002% of a day's network capacity at
1,000,000 receipts/day), the strongest durable ENS-anchored evidence of the five, layered on top of D
only where a dispute or third-party audit specifically needs a trail independent of the merchant's
own uptime (`RECEIPT-NAMING.md` §7). This recommendation adds zero new nodes to the namespace in §6.

## 15. Indexer composition

**An indexer is evidence, never authority** — the single rule `GRAPH-COMPOSITION.md` restates for
every entity it covers, the same rule `docs/unica-v4/EVENT-SCHEMA.md` §2 states for settlement and
`docs/unica-v5/graph/ENS-NFT-SCHEMA.md` (sibling stream, cited not edited) states for identity. The
indexer must cover merchant roots, terminal/agent subnames, resolver deployments, grants and
revocations, identity NFTs and renderer versions, record changes, market bindings (joined only by the
resolved **address**, never by an NFT's id or current owner — restated three times across the
sibling documents because it is exactly the join a naive schema would add by convenience), and
historical identity snapshots answered "as of block N" as an ordinary indexed query over immutable
rows (`GRAPH-COMPOSITION.md` §3). It must never be read as a settlement authority, a revocation
authority, proof of payment via NFT ownership, or current — every entity carries or is queryable
beside a block number, and "any UNKNOWN fails closed for value-moving behaviour" applies transitively
(`GRAPH-COMPOSITION.md` §5).

## 16. Deployment configuration and preflight

Only one address is safe to hard-code long term: the fixed entry point,
`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, confirmed identical across every source checked
(`DEPLOYMENT-CONFIG.md` §4). Everything downstream disagrees between this repository's own live reads
and the ENS team's own generated address table, and the ENS team's own README additionally documents
a third, distinct, deliberately temporary repoint — direct proof that this volatility is routine
operational practice, not a one-off accident (`DEPLOYMENT-CONFIG.md` §4–§5). All five preflight
checks the originating brief asked for — chain id, bytecode, implementation, ABI selectors, and a
negative control against a name that must not resolve through this deployment — already exist and
already run in this repository (`DEPLOYMENT-CONFIG.md` §12). What is not yet built: a check that
walks the live proxy chain on every use and compares it against the pinned downstream address as one
combined, reportable row, rather than only checking that a pinned address's own bytecode has not
changed (`DEPLOYMENT-CONFIG.md` §12, restated in `THREAT-MODEL.md` §3.1, §3.11). MockUSDC and MockDAI
addresses are DOCUMENTED_NOT_OBSERVED — read from the same generated table, never independently
confirmed live (`DEPLOYMENT-CONFIG.md` §6).

## 17. Scalability estimates

Four scenarios, gas figures drawn from this repository's own measurements, never invented
(`SCALABILITY.md` §0–§4): 1 merchant/2 terminals (trivial at every approach — establishes the unit
cost); 100 merchants/10 terminals each (still trivial; `subregistry` mode's operational cost starts to
diverge from `subtree` mode's, though neither is unsafe yet); 10,000 merchants/20 terminals each
(gas is still not the constraint — the constraint is `subregistry` mode's 30,000 independently-
deployed registries and 10,000 independently-initialized resolver proxies, each a separately-verified
authority holder, and enumeration becomes practically unavoidable rather than merely correct in
principle); 1,000,000 receipts/day (Model A becomes unacceptable at ~10% of Ethereum's daily network
gas capacity at the measured floor alone; Model E wins decisively at 0.00002% of the same). Exact
breaking points named, not gestured at: gas becomes unacceptable at Scenario 4 for Model A only;
resolver complexity becomes unsafe at Scenario 3 for `subregistry` mode; enumeration requires an
indexer at any scale officially, but becomes practically unavoidable at Scenario 3; privacy degrades
at Scenario 4 for any per-receipt on-chain write (`SCALABILITY.md` §6). The 60,000,000-gas/block
network-capacity figure used throughout is COMMUNITY, trade-press-sourced, and was checked directly
against ENS's own official site, which states only "ENSv2 is coming soon" — not independently
corroborated there (`SCALABILITY.md` §0, §8).

## 18. Threat model and mitigations

Twenty-eight threats, each classified real-and-already-observed or hypothetical, each mitigation
labelled by which layer actually enforces it — "a mitigation that lives only in prose is not a
mitigation" (`THREAT-MODEL.md` §1). Real and already demonstrated, not hypothetical: three distinct
`UniversalResolverV2` addresses claimed for one logical entry point across three sources retrieved the
same day (§3.1); two accounts holding full `ROOT_RESOURCE` authority on a third-party name's resolver,
with the second unidentified (§3.7); a deliberate, named, reversible repoint of the intermediate proxy
undertaken "at the team's request" mid-event (§3.11). Fully closed by existing, built code: wrong
Universal Resolver (fixed-entry-point hard-coding plus a live walk), wrong deployment (chain
id/bytecode check, fails closed on the first mismatch), confusable ASCII-refusing normalization,
malicious resolver (ERC-1967 implementation check), stale CCIP-Read (refused outright — "this
checkout does not follow"), cross-deployment replay (chain id bound inside the signed struct, plus a
freshness window), testnet-shown-as-mainnet (an explicit `WRONG_CHAIN` classification), and SVG
injection via the name itself (the accepted character set contains none of the markup-significant
characters, before any renderer exists). Two genuine, currently unaddressed gaps, named rather than
hidden: no bound on the **size** of a value written to an authorized text key (§3.26), and no fixed
leaf-naming convention that would keep a staff/terminal name from ever being a real person's name or
carrying receipt contents rather than a pointer (§3.28). One structural limitation of the mechanism
itself, not a design choice this document can close by picking better bits: Enhanced Access Control
has no "revoke-only" primitive — any account that can revoke a role can also grant it — so a true
least-authority "emergency revoker" must be built at `BACKEND_POLICY`, outside the chain (§3.9,
restated from `ACCESS-CONTROL.md` §3.3, §8).

## 19. Prize fit

**VERIFIED**, `ethglobal.com/events/ethonline2026/prizes/ens`, retrieved 2026-09-11
(`PRIZE-FIT.md` §2–§3): the page names two tracks, not a from-scratch/continuity split of one pool —
**Best Use of ENSv2** ($4,500, no pre-existing-project restriction stated) and **Best Integration of
ENSv2 into an Existing Project** ($500, Continuity track only). UNICA, confirmed by the owner as a
from-scratch entry, is eligible for the first and structurally not eligible for the second — it has no
pre-existing (pre-event) project for ENSv2 to be integrated into. This resolves, rather than leaves
open, the track-naming conflict the originating brief itself named as unresolved. Track 1's named
focus areas — hierarchical/wildcard resolution, Enhanced Access Control for delegated permissions,
expiring/revocable subnames or permissioned resolvers — are, word for word, mechanisms
`integrations/ensv2/` already exercises against the deployed contracts, not a new sponsor story
invented for the prize (`PRIZE-FIT.md` §4–§6). The AI-agent-namespace line is a named bonus, not a
requirement (`PRIZE-FIT.md` §4, §11). **A real, unresolved conflict, not silently picked**: this
document's own retrieval of the event's info/details page, twice, finds only a 2026-09-13, 12:00 pm
EDT submission-deadline quote; a sibling Graph-stream document cites the same URL for "runs through
2026-09-16." Neither retrieval rules out the other from what was actually fetched; this stream, like
`PRIZE-FIT.md` and `DEMO-PLAN.md`, plans on the tighter number (`PRIZE-FIT.md` §3, E13 in
`OPEN-QUESTIONS.md`). A side finding resolves one of the originating brief's own unverified leads: the
same official deployments table lists a `MockUSDC` contract as part of ENS's **own** Sepolia
infrastructure (its registration-fee path), independently confirming that "MockUSDC is not Circle
USDC" is correct, though for a different reason than a reader might assume (`PRIZE-FIT.md` §10).

## 20. Primary and fallback demos

Five candidates scored on nine axes (`DEMO-PLAN.md` §2–§3): Merchant Identity Passport (A), Revocable
POS Fleet (B), Agent Commerce Namespace (C), Named Verified Receipt (D), Full Merchant Trust Tree (E).
The originating brief's own proposed primary — a "Revocable Merchant Trust Tree" — is evaluated on its
merits rather than assumed: the mechanism is right, and Candidate B's mechanism (the merchant root,
per-key delegation, live revocation) scores highest or tied-highest on ENS centrality, UNICA
relevance, security value, judge clarity, reliability, and dependency risk, and is the only candidate
whose exact call shape is already measured against deployed bytecode. Candidate E's added breadth
(a fuller tree, an avatar, an agent namespace) worsens build-time, reliability, and dependency-risk
without being load-bearing for the track's own two centerpiece features (`DEMO-PLAN.md` §4).
**Recommended primary**: a scoped Revocable Merchant Trust Tree — the already-registered `unica.eth`
merchant root with one or two terminal subnames, each delegated a per-key `SET_TEXT` role, with one
live revocation shown against the deployed resolver. **Recommended fallback**: Candidate A alone, the
Merchant Identity Passport — the already-`LIVE READ` resolution path with the delegation layer
removed, costing nothing already spent if chosen late (`DEMO-PLAN.md` §4). Candidate C (Agent Commerce
Namespace) and Candidate D (Named Verified Receipt) are named, not silently dropped, as not
recommended for this event: C has no existing design anywhere in the repository, and D doubles the
dependency surface across two separately-submitted sponsor tracks (`DEMO-PLAN.md` §4).

## 21. The minimal build sequence

Seven phases, narrowed from the originating brief's own shape to what the corrected ~2-day runway
actually supports (`DEMO-PLAN.md` §5): (1) deployment correctness — re-run the already-existing
resolver-implementation check against the demo's specific names; (2) merchant root — reuse
`unica.eth`, no new registration; (3) deterministic identity — resolve the root's address live, show
an avatar only if one already exists, build nothing new; (4) terminal delegation — derive one or two
terminal subnames, build `authorizeTextRoles` calldata following the exact shape already measured,
verify by `eth_call`/fork execution, never broadcast without separate approval; (5) payment
association — show the terminal's role scoped to a leaf carrying nothing the merchant relies on,
touching no settlement contract; (6) evidence — capture the accepted, refused, and revoked rows in the
same measured, printed-not-asserted style this repository already uses; (7) judge-facing interface —
one screen, the root, its terminals, live authorization state, a revoke action wired to real (but
unsent) calldata, and at least one adversarial case beside the legitimate rows. Never cut first:
deployment correctness, per-key role narrowing, revocation, the payment-binding safety boundary. Cut
first, in order, before any of the four is touched: agent identity, x402, receipt naming, CCIP-Read,
bulk provisioning (`DEMO-PLAN.md` §7).

## 22. Owner decisions

Compiled in full, as a numbered copy-paste block, in `OPEN-QUESTIONS.md`. The highest-leverage
decisions, restated here in one line each: direct merchant registration versus a UNICA-managed
subname (E1 — the architectural fork that decides blast radius on a single-key compromise); `subtree`
versus `subregistry` mode as the onboarding default (E2); whether a fork execution of the deployed
bytecode is sufficient evidence to call per-key EAC resource scoping VERIFIED, or only a live
broadcast qualifies (E3 — every staff/terminal delegation design in this directory is built on the
conservative reading until this is answered); whether to build staff/terminal delegation,
capability-publishing, or revocation-propagation features for v5 at all, and in what order relative to
UNICA v4's own SPECIFIED-NOT-BUILT contracts (E4). The full block, with every option and a recommended
default named per item, is in `OPEN-QUESTIONS.md`.

## 23. What needs written ENS-team confirmation

Ten questions, each answered from public sources wherever they settle it and left open, marked as
needing a written confirmation from an identifiable ENS team member, otherwise (`MENTOR-QUESTIONS.md`
in full). The load-bearing ones for this stream's own design: **Q1** — parent revocation prevents
escape via `SET_SUBREGISTRY` by a documented emancipation pattern; whether the identical pattern
applies to `SET_RESOLVER` is reasoned by symmetry, not documented. **Q3** — a shared Permissioned
Resolver correctly suits many terminal subnames under one merchant account, confirmed against the
official per-account resolver-sharing statement; this is exactly the architecture already built, not
a new design question. **Q6** — no official recommendation exists for high-volume receipt discovery;
the one ENS-DAO-affiliated project built to answer it (ENSNode) is archived as of five weeks before
this retrieval. **Q9** — the deployment identifier that distinguishes this canonical Sepolia ENSv2
Beta from legacy ENSv1 is the resolver's own ERC-1967 implementation address, which this repository's
tooling already checks; whether it also rules out a *different* team's isolated, differently-addressed
ENSv2 instance is not addressed by any source fetched. **Q10** — the one documented enumeration event
is `EACRolesChanged`; no on-chain enumeration method exists, confirmed both by official documentation
and by this repository's own operationally-inconsistent `eth_getLogs` scans. None of the ten is
claimed as settled without a citation; where none exists, the question is left open rather than
guessed.

---

## REQUIRED AUTHORITY MATRIX

Every authority column names exactly one of **ENSV2_ONCHAIN**, **UNICA_ONCHAIN**, **BACKEND_POLICY**,
**GRAPH_EVIDENCE**, **CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION** — the layer that actually enforces
the action, never a blend. "PROPOSED" in a cell means the action is designed, not built; UNICA v4
settlement actions are SPECIFIED-NOT-BUILT throughout, restated once here rather than per row.

| Action | Initiator | Required authority | Source of truth | Enforcement point | Event / evidence | Revocation behaviour | Residual risk |
|---|---|---|---|---|---|---|---|
| Register merchant root | Merchant/operator (owner-wallet action) | ENSV2_ONCHAIN | `ETHRegistrar.register()`'s own `roleBitmap` argument, set once, atomically | `ETHRegistrar` / `PermissionedRegistry` | `NameRegistered`, `EACRolesChanged` (registry) | None — an admin role is only ever reduced by self or moved by transfer (never granted to a third party post-registration) | A wrong `roleBitmap` at registration has no repair short of losing and re-registering the name; a lost sole admin key has no recovery short of expiry |
| Create terminal | Merchant/operator backend | ENSV2_ONCHAIN | `authorizeTextRoles` grant of `SET_TEXT` at the terminal's own per-key resource | `PermissionedResolver` (EAC dispatch) | `EACRolesChanged` at the per-key resource | Same call with `granted=false`, two independent steps (backend disable, then EAC revoke) | Registered-vs-wildcard subname choice is undecided (E5); the two-step revoke leaves a stated window where the old key can still write status |
| Create agent | Merchant/operator | ENSV2_ONCHAIN | `authorizeTextRoles` grant at the agent leaf's own per-key resource | `PermissionedResolver` | `EACRolesChanged`; live-broadcast proof exists (12 tx, blocks 11670554–11670579) | Same call, `granted=false` | Per-key scoping holds only if `authorizeTextRoles` (never `authorizeNameRoles`) was used; a grant made by other tooling is outside this repository's own screen |
| Change description | Name owner or `SET_TEXT` delegate | ENSV2_ONCHAIN | `setText("description", value)` at the key's per-key resource | `PermissionedResolver` | `TextChanged` | Overwrite, or revoke the delegate's `SET_TEXT` grant | Free text, never parsed for a machine-actionable field; a misleading value is a display defect only |
| Change avatar | Name owner or `SET_TEXT` delegate | ENSV2_ONCHAIN | `setText("avatar", CAIP-22 reference)` at the key's per-key resource | `PermissionedResolver` (write); client-side ENSIP-12 ownership cross-check (read) | `TextChanged`; a live `ownerOf` cross-check | Overwrite, or revoke the delegate's grant | The image is never proof of payout identity; a mismatch is shown as a warning, never a block |
| Advertise an endpoint | Merchant/operator, or a scoped agent | ENSV2_ONCHAIN | `setText` at a `com.unica.*` / `agent-endpoint[<protocol>]` per-key resource | `PermissionedResolver` | `TextChanged` | Overwrite, or revoke the delegate's `SET_TEXT` grant | Reachability at an endpoint is a discovery fact, never an authorization fact; the endpoint's own content is untrusted |
| Create a payment order | Allowlisted order-creator (terminal/backend) | UNICA_ONCHAIN | `createOrder`, snapshotting recipient/payer/amountIn/minOut/deadline once | UNICA settlement contract (SPECIFIED-NOT-BUILT for v4) | `OrderCreated` | None from ENS; only the contract's own retire/invalidate path (row below) | v4 contracts do not exist yet; the ENS resolution feeding this call must be freshly re-read immediately before creation, never served from cache |
| Bind payer | Payer, via `pay(orderId)`; fixed at order creation | UNICA_ONCHAIN | `pay()`'s `msg.sender == order.payer` check (`WrongPayer` otherwise) | UNICA settlement contract | `OrderCreated` (payer field), `Settled` | None — immutable once the order is created | Advisory 001's binding discipline must hold at authorization time; ENS never participates in this binding at all |
| Bind merchant | Order-creator, from an independently-resolved address | UNICA_ONCHAIN | `createOrder`'s stored `recipient` field | UNICA settlement contract | `OrderCreated` (recipient field) | None — a later ENS address-record change never touches a bound order | The resolution used to build the order must be fresh; a stale cached resolution could bind the wrong merchant before the boundary even engages |
| Change payout discovery | Name owner or `SET_ADDR`/`SET_TEXT` delegate | ENSV2_ONCHAIN | `setAddr` / `setText` at the relevant per-key resource | `PermissionedResolver` | `AddrChanged`/`TextChanged`; `EACRolesChanged` if the grant itself changes | Overwrite, or revoke the delegate's grant | Exactly the class of change the non-negotiable boundary fences off from existing orders — affects only future resolutions |
| Execute settlement | Payer, calling `pay(orderId)` | UNICA_ONCHAIN | `pay()`'s own checks against stored order state, executed atomically | UNICA settlement contract / hook | `SettlementReceipt`, `Settled` (paired, same transaction) | None — atomic, cannot be interrupted by a later ENS change | No ENS call occurs inside a v4 contract at any point; the only residual is upstream, in whatever resolved the order's own terms before creation |
| Revoke terminal | Merchant/operator | BACKEND_POLICY (the step that actually cuts access), then ENSV2_ONCHAIN | Backend/device role-table disable, then `authorizeTextRoles(...,false)` | UNICA backend (order-creation gate) + `PermissionedResolver` | `EACRolesChanged`; a backend audit log (not ENS-visible) | Stops future order-creation attempts and future status writes; never touches an already-created order | If the EAC grant is not also separately revoked, the old key can still write the terminal's status text record indefinitely — a stated, unhidden residual |
| Revoke agent | Merchant/operator | ENSV2_ONCHAIN | `authorizeTextRoles(...,false)` at the agent's per-key resource | `PermissionedResolver` | `EACRolesChanged` | Immediate and complete for future writes; cannot be resisted by the agent | Cached copies of the agent's pre-revocation publications persist until their own TTL expires — old words can still mislead a reader who skips a live check |
| Invalidate an existing order | UNICA settlement contract's own governance path | UNICA_ONCHAIN | v4's own order-invalidation function (SPECIFIED-NOT-BUILT) | UNICA settlement contract | An order-status-change event (v4, not yet specified in detail) | n/a — this row is itself the revocation of an order | No ENS record, role, or resolver state can ever invalidate an order — restated because it is the boundary this whole design protects |
| Retire a market | Registry operator/governance | UNICA_ONCHAIN | The registry's own status transition (pause/retire) | `UnicaMarketRegistry` | `MarketPause` / `MarketStatusChanged` (also indexed as GRAPH_EVIDENCE) | Open orders survive a pause and are payable after unpause if unexpired, never on a retired market; a `com.unica.registry` ENS pointer is unaffected by the contract's own status | An ENS registry pointer can go stale relative to the contract's actual status; a client trusting the pointer without a live read sees the wrong picture |
| Verify a receipt | Any reader (payer, merchant, auditor) | CLIENT_VERIFICATION, backed by GRAPH_EVIDENCE and UNICA_ONCHAIN reads | The mined `SettlementReceipt`/`Settled` pair, confirmed live over RPC | The verifying client (the `tools/unica-verify` pattern) | `SettlementReceipt`, `Settled`; optionally an indexed `Settlement` row with its own block number | None — a settled receipt is permanent | An ENS-hosted "latest receipt" pointer is only ever a mutable, overwritable pointer, never itself proof |
| Resolve historical identity | Any reader, asking "what did this name resolve to at block N" | GRAPH_EVIDENCE (if indexed) or CLIENT_VERIFICATION (if replayed against archive state) | The greatest indexed history row with `blockNumber <= N` | The indexer's own entity history, or an archive-node read | `ResolvedAddress` / `AvatarRecord` / `Resolver` / `IdentityBindingObservation` history rows | None — history rows are immutable once indexed | An indexing failure or lag means a very recent block's answer may be UNKNOWN rather than wrong — fails closed, never presented as current |
| Update renderer version | UNICA protocol maintainer, deploying a new renderer contract | UNICA_ONCHAIN (a new immutable deployment; not an ENS action) | A new `(chainId, contractAddress)` renderer deployment, referenced by a new descriptive version label | The new renderer contract itself; a merchant's `com.unica.identity-renderer` text record is only ever a pointer to the current choice | The new contract's own deployment; a `TextChanged` if a merchant updates their pointer | None for prior tokens — a renderer version is permanent; a merchant may point a new mint at a newer one, but an old identity NFT's own recorded facts never change | A mismatch between the pointer and the renderer actually behind a minted token's avatar reference is informational only, never blocking |

---

## Success criteria

Ten criteria this design set out to meet, marked honestly against the seventeen source files and this
synthesis's own read of them:

1. **ENSv2's centerpiece features (Enhanced Access Control, revocable subnames, permissioned
   resolvers) are structurally load-bearing for UNICA's design, not cosmetic.** **MET** — the
   delegation/revocation mechanism this whole design extends was already live-exercised before this
   stream began (`AGENT-IDENTITY.md` §2, `PRIZE-FIT.md` §6).
2. **A minimal merchant namespace is defined, with every rejected class justified by the same
   evaluation columns.** **MET** — `NAMESPACE.md` §2–§10.
3. **A complete authority-and-revocation matrix covers every named action with one authority label,
   source of truth, enforcement point, evidence, revocation behaviour, and residual risk.** **MET** —
   built above from seven of the seventeen source files.
4. **The non-negotiable settlement boundary is shown to hold by construction, not by policy alone,
   with a real measured example.** **MET** — five settled V3 orders on Sepolia kept their recipient
   through a subsequent address-record change (`PAYMENT-BINDING.md` §2, `THREAT-MODEL.md` §2).
5. **A deterministic, anti-substitution identity NFT is designed end to end.** **PARTIAL** — the
   determinism formula and six-layer separation are complete; zero lines of contract code exist, and
   gas cost, the OpenSea `image_data` field, and the ENSIP-15 normalization gap remain open
   (`IDENTITY-NFT.md` §11, §15).
6. **A scalable, costed receipt-discovery model is chosen with named breaking points at multiple
   settlement volumes.** **MET** — `RECEIPT-NAMING.md` §1–§7, `SCALABILITY.md` §1–§6.
7. **A threat model names each threat's real-versus-hypothetical status, a mitigation with an
   authority label, and an honest residual, not just a mitigation.** **MET** — `THREAT-MODEL.md`,
   twenty-eight threats, two named as genuinely unaddressed (§3.26, §3.28).
8. **Every material claim is checked against current official ENS documentation and the ENSv2
   hackathon-branch contracts, not stale interfaces.** **PARTIAL** — the great majority of static
   claims are officially sourced and cross-verified; the single most load-bearing dynamic claim in
   this whole directory — per-key EAC resource scoping — has been exercised only on a local fork,
   never confirmed by a broadcast transaction against the live Sepolia deployment this project is
   pinned to (`ACCESS-CONTROL.md` §16, `NAMESPACE.md` §0, `PRIZE-FIT.md` §6, E3 in
   `OPEN-QUESTIONS.md`).
9. **A primary and fallback demo are scoped to the real submission runway, with a minimal build
   sequence an implementer could pick up directly.** **PARTIAL** — both are fully specified
   (`DEMO-PLAN.md` §4–§5); the runway itself rests on an unresolved conflict between two of this
   project's own sibling documents about the true submission deadline (§19 above, E13 in
   `OPEN-QUESTIONS.md`).
10. **Nothing in this stream's output is built, deployed, signed, or broadcast, and every claim is
    labelled VERIFIED / PROPOSED / DOCUMENTED_NOT_OBSERVED / UNKNOWN, with no content attributed to
    the unavailable sponsor-channel transcript.** **MET** — enforced by every one of the seventeen
    source files individually and restated once, in full, above.
