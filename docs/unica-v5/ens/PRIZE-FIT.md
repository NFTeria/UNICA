# UNICA v5 / ENS — prize fit

Engineering record. Retrieval date for every claim below is 2026-09-11 unless a claim states
otherwise. Labels: VERIFIED (source cited), PROPOSED (UNICA design choice, not a claim about the
sponsor), DOCUMENTED_NOT_OBSERVED, UNKNOWN. Authority labels, one per described action, never
blended into a single claim: **ENSV2_ONCHAIN**, **UNICA_ONCHAIN**, **BACKEND_POLICY**,
**GRAPH_EVIDENCE**, **CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION**. Reads against
`docs/unica-v5/graph/PRIZE-FIT.md` (a sibling stream, cited here, never edited) and against the
already-submitted ENSv2 integration recorded in `docs/SPONSOR-ELIGIBILITY.md` §4.

## 1. Scope and relationship to existing UNICA work

VERIFIED (repository). ENSv2 is already one of the three submitted integrations
(`docs/SPONSOR-ELIGIBILITY.md`, "The three submitted integrations are Uniswap v4, ENSv2 on Sepolia
and The Graph"), status `LIVE READ`: live Sepolia resolution with every failure shape classified,
name-to-configuration-to-quote commitment, and permissioned resolution/access control exercised
against the deployed contracts. `unica.eth` is registered and delegated on ENSv2 Sepolia to this
project's deployer (`docs/SPONSOR-ELIGIBILITY.md` §4 correction, 2026-09-09, 12 transactions, blocks
11670554–11670579).

This file is forward design for **UNICA v5** (the dashboard generation, per the owner's 2026-09-11
release-naming ruling) — it evaluates one additional, narrower submission shape built **on top of**
the already-live integration: a merchant root name delegating scoped, revocable authority to
terminal subnames via Enhanced Access Control, judged for whether it is worth building this event
and, if so, how small it should be. It does not replace, edit, or restate the already-disclosed
`LIVE READ` submission, and it does not touch `integrations/ensv2/`, `web/ensv2/`, or any contract.
A sibling stream, `docs/unica-v5/graph/`, is running the same exercise for The Graph; it is cited
here where useful and is not edited by this file.

## 2. Track and Continuity/From Scratch conflict — resolved against the page

The research brief for this file referred to "Continuity" for the ENS prize. The owner separately
confirmed 2026-09-11 that UNICA is a **From Scratch** entry. Reading the two together as a single
axis (as The Graph's prize does — one track name split into a From-Scratch pool and a Continuity
pool of equal size) would be wrong for ENS: **VERIFIED — ENS's own prize page does not split its
main track that way.** Retrieved 2026-09-11
(<https://ethglobal.com/events/ethonline2026/prizes/ens>):

| Track, as titled on the page today | Pool restriction | Prize |
|---|---|---|
| Best Use of ENSv2 | none stated — open to Classic/From-Scratch and Continuity entrants alike | $4,500 |
| Best Integration of ENSv2 into an Existing Project | **Continuity track participants only** | $500 |

So the page's actual shape is one open track plus one much smaller Continuity-exclusive track, not
a from-scratch/continuity split of one pool. **Resolution: UNICA, as a From Scratch entry, is
eligible for "Best Use of ENSv2" and is not eligible for "Best Integration of ENSv2 into an Existing
Project."** This is not only a rule-text exclusion — Track 2 requires targeting "an existing
project's testnet deployment," and UNICA's ENSv2 work has no pre-existing (pre-event) project to
integrate into (`docs/PROVENANCE-LEDGER.md`: repository genesis 2026-09-04, four hours after this
event's build window opened). The brief's reference to "Continuity" is therefore read as naming the
track that does **not** apply to this entry, and this file scopes entirely to Track 1 from here on.
**[OFFCHAIN_OPERATION — a submission-track eligibility reading, not a chain fact.]**

**Cross-document conflict, named and reconciled.** `docs/unica-v5/ens/DEPLOYMENT-CONFIG.md` §1–§2
(a sibling stream's file, cited here, not edited by this file) states as VERIFIED that ENS's page
"names two ENSv2 tracks, one **'From Scratch'** (net-new, $4,500) and one **'Continuity'**
(integration into an existing project, $500)" — wording that reads Track 1 itself as named and
bounded by entry type. That file's own §1 records its source as the general listing page,
`ethglobal.com/events/ethonline2026/prizes`, not the ENS-specific page (`/prizes/ens`) this file
cites. Re-retrieved live for this repair, a second pass, 2026-09-11, both URLs, quoted verbatim:

- General page, `https://ethglobal.com/events/ethonline2026/prizes` — ENS section: "Track 1: Best
  Use of ENSv2 ... Eligibility: 'Project must be built on ENSv2 (Sepolia). ENSv2 features should be
  central to the product, not a cosmetic add-on.'" No occurrence of the words "From Scratch" inside
  Track 1's own eligibility text on this re-fetch. "Track 2: Best Integration of ENSv2 into an
  Existing Project ... Eligibility: 'This track is only available to Continuity Track
  participants.'"
- ENS-specific page, `https://ethglobal.com/events/ethonline2026/prizes/ens` — quoted verbatim:
  "🧬 Best Use of ENSv2 ⸺ $4,500," with no pool-restriction sentence anywhere in that track's own
  text, and "🔗 Best Integration of ENSv2 into an Existing Project ⸺ $500," restricted by: "This
  prize is only available to Continuity Track participants."

Both URLs, re-read on today's date on this second pass, agree with each other and with this file's
own §2–§3 above: **neither page's own printed text ever labels "Best Use of ENSv2" a "From Scratch"
track, and neither states a pre-existing-project restriction on it.** `DEPLOYMENT-CONFIG.md` §1's
phrase — "'From Scratch' (net-new, $4,500)" — is that document's own paraphrase of Track 1, built by
contrast with Track 2's explicit Continuity-only restriction, not a quoted heading or restriction
from either page; that file's own §2 says as much in its final sentence ("Full track resolution and
prize-fit analysis is `docs/unica-v5/ens/PRIZE-FIT.md`'s job... this document only needed to confirm
the deployment target"). **Single resolution, carried forward from both readings: "Best Use of
ENSv2" carries no entry-type restriction on either official page as printed; UNICA is eligible for
it as a From Scratch entry regardless of whether that entry type is also, informally, the paraphrase
`DEPLOYMENT-CONFIG.md` uses for the track's own name.** The two documents are not in factual
conflict once each is read for what it actually claims — `DEPLOYMENT-CONFIG.md` never asserted a
restriction exists, only used "From Scratch" as a label of convenience for the track it was
confirming as a shared deployment target — but the label invites the misreading this section closes.
**[OFFCHAIN_OPERATION — reconciling two documents' wording of the same publicly-printed prize page;
no chain state is involved.]**

## 3. ETHGlobal ENS prize page, as worded today

VERIFIED — <https://ethglobal.com/events/ethonline2026/prizes/ens>, retrieved 2026-09-11.

**Both tracks, shared requirements (quoted/paraphrased from the retrieval):** projects must be
"built on ENSv2 (Sepolia)"; ENSv2 features must be "central to the product, not a cosmetic
add-on"; demos must be "functional and not just include hard-coded values"; code must be "open
source and accessible on Github or a similar platform"; submissions require "a video recording or
link to a live demo (ideally both)."

**Track 1 — Best Use of ENSv2 ($4,500: 1st $1,500 / 2nd $1,500 / 3rd $1,000 / Runner-up $500).**
Named focus areas: exploring "the new hierarchical registry structure: resolve subnames straight
off a parent's resolver with wildcard resolution," or deploying custom subname registries;
leveraging "Enhanced Access Control" for delegated permissions; implementing "expiring/revocable
subnames or permissioned resolvers." Bonus, explicitly optional: "Bonus points if you bring AI
agents into the mix — think agents as namespaces, each with their own identity and permissions."

**Track 2 — Best Integration of ENSv2 into an Existing Project ($500, Continuity track only).**
Must target "an existing project's testnet deployment" and show how ENSv2's feature set "can plug
into an existing protocol or project to improve the user experience"; it should be "clear how ENSv2
improves the project, not just a cosmetic add-on." Not pursued — §2.

**Resources named on the page:** documentation for the Permissioned Registry, Permissioned
Resolver, and Enhanced Access Control; tutorials for contract and app developers; ENSv2 overview
docs; "building with AI" guidance; an agent-native CLI; an AI Agent Registry name-verification
spec; agent text-record standards; a workshop video link.

**General event facts, VERIFIED, retrieved 2026-09-11 from
<https://ethglobal.com/events/ethonline2026/info/details>, quoted verbatim:** "All projects must be
submitted by Sunday, September 13th 2026 at 12:00 pm EDT." The same page's Classic-track rule,
quoted: "All work on your project must begin after the hackathon officially starts. Any prior
project-specific code, designs, or assets are not allowed unless they're from public libraries or
starter kits." Public-repository requirement, quoted: submissions must include "a GitHub Repo,
Figma files, or equivalent, proving the work was done during the hackathon." Demo requirement,
quoted: "a 2-4 minute demo video," at least 720p, no AI voiceover or text-to-speech. Partner-prize
rule, quoted: entrants "can select up to 3 Partner Prizes to apply for," with a partner's multiple
tracks counting as one selection.

**Conflict, recorded rather than silently resolved.** `docs/unica-v5/graph/PRIZE-FIT.md` §7 and
`DEMO-PLAN.md` §1 state "ETHOnline 2026 runs through 2026-09-16" and compute "five days of runway"
from a 2026-09-11 retrieval of the same info/details page this file also retrieved. **This file's own
retrieval of that exact URL, twice, on 2026-09-11, returns only one explicit date: the submission
deadline quoted above, Sunday 2026-09-13 at 12:00 pm EDT — not 2026-09-16.** A general web search
performed for this file separately characterizes "ETHOnline 2026" as "running September 4–16," which
would be consistent with a longer overall event/showcase window that *contains* an earlier
submission cutoff, but no single official page fetched for either stream states both dates together
in one place, and neither retrieval method here is strong enough to rule the other reading out.
**What is not in question: the text actually printed on the info/details page, quoted above, is a
2026-09-13 submission deadline.** This file's own runway arithmetic (§7, `DEMO-PLAN.md` §1) uses
that number — roughly **two days** from this file's retrieval date, not five. Anyone building from
both this file and the Graph sibling file should use the tighter number until an identifiable
ETHGlobal source resolves the discrepancy (§12).

## 4. ENS's categories, classified against UNICA v5

- **Track 1 is a direct fit for already-built work, not only for new design.** "Enhanced Access
  Control for delegated permissions" and "expiring/revocable subnames or permissioned resolvers" are
  named on the page as the track's own centerpiece features, and `integrations/ensv2/roles.mjs` and
  `permissioned.mjs` already exercise exactly this mechanism against the deployed contracts (§6). The
  proposed "Revocable Merchant Trust Tree" demo (`DEMO-PLAN.md`) is this same mechanism extended one
  layer, not a new sponsor story invented for the prize.
- **The "AI agents as namespaces" line is a named bonus, not a requirement.** UNICA's Candidate C
  ("Agent Commerce Namespace," `DEMO-PLAN.md` §2) maps to it, but the page's own wording — "Bonus
  points if..." — makes it optional, which is why the brief's cut order removes it first (§7,
  `DEMO-PLAN.md` §7) without an eligibility cost.
- **Track 2 does not apply**, for the reasons in §2: Continuity-only by the page's own restriction,
  and structurally mismatched — UNICA has no pre-existing (pre-event) product for ENSv2 to be
  integrated into.

## 5. Strongest eligible category

**Best Use of ENSv2.** This is a classification from the page's own wording (§3), not a claim that
eligibility is settled — no ENS team member has confirmed in writing that the specific planned
artifact (a revocable delegation tree layered on the already-live integration) satisfies the track,
and §12 carries that open question forward. What is VERIFIED: the track's own named features
(hierarchical/wildcard resolution, Enhanced Access Control, revocable subnames, permissioned
resolvers) are, word for word, the mechanisms `integrations/ensv2/` already exercises against the
deployed Sepolia contracts (`docs/SPONSOR-ELIGIBILITY.md` §4), and the "functional... not just
hard-coded values" bar is already cleared by that integration's design (resolution runs on every
call against live chain state, never a fixture).

## 6. Why UNICA fits

- **A merchant is a name, and the name is an authorization model, not a lookup.** This is the
  already-disclosed integration's own framing (`docs/SPONSOR-ELIGIBILITY.md` §4) and it is also,
  independently, the exact shape Track 1 asks for. **[OFFCHAIN_OPERATION — a design framing, not a
  chain read or write.]**
- **Enhanced Access Control is already exercised, not merely read about.**
  `integrations/ensv2/roles.mjs` (dated 2026-09-09) records that `grantRoles` — the call the
  documentation leads a reader to — is REFUSED by the deployed resolver with `EACCannotGrantRoles`
  (`0xd1a3b355`) even from an account holding every role at `ROOT_RESOURCE`, and that the call the
  deployment actually ACCEPTS is `authorizeTextRoles(bytes dnsName, string key, address account, bool
  granted)` (`0xf2d1eb25`) and its siblings `authorizeAddrRoles`/`authorizeDataRoles`. This was
  established by executing the calls against the deployed bytecode on a **pinned Sepolia fork** — a
  local simulation of the real deployed contract, not a broadcast transaction to public Sepolia — and
  is recorded here as VERIFIED (repository, fork execution) rather than as a live broadcast result.
  **[CLIENT_VERIFICATION — a local fork simulation performed by this repository's own tooling against
  the deployed bytecode; not a live write to ENSv2 state.]**
- **Per-key scoping is measured, not assumed — and this corrects an earlier finding in the same
  repository.** The same file records that an agent authorized via `authorizeTextRoles` for one text
  key wrote that key successfully and was REFUSED (`EACUnauthorizedAccountRoles`, `0x4b27a133`) on a
  *different* key of the *same* name, which read back empty — direct evidence that the resource
  `authorizeTextRoles` grants is `keccak256(abi.encode(node, keccak256(bytes(key))))`, a per-key
  resource, not the name-level resource. **This conflicts with, and by its own text explicitly
  refutes, an earlier finding recorded one day earlier** in
  `integrations/ensv2/README.md`/`ENS-OWNER-ACTION.md` (dated 2026-09-08) and repeated in the
  research brief's own "WHAT EXISTS TODAY" briefing: that "every live refusal observed... named the NAME-LEVEL
  resource" and that per-key resource derivation was `DOCUMENTED_NOT_OBSERVED`. `roles.mjs` marks its
  own correction inline ("SUPERSEDED... It is REFUTED — see the block above for the measurement that
  refutes it") rather than silently overwriting the prior claim, and this file follows that same
  discipline: the per-key finding is treated as the current state of repository evidence (fork
  execution against deployed bytecode), the superseded per-name-only claim is named rather than
  quietly dropped, and both are carried to `MENTOR-QUESTIONS.md` Q1–Q3 and to the top-level conflict
  list for this research. **Neither finding is a broadcast to public Sepolia** — that remains
  DOCUMENTED_NOT_OBSERVED for `authorizeTextRoles` specifically (§10, `ENS-OWNER-ACTION.md` step 3
  still describes the delegation as an action to take through the ENS app's own interface, not
  through calldata this repository has broadcast). **[CLIENT_VERIFICATION for the fork measurement
  described in this bullet; the underlying `authorizeTextRoles` mechanism itself, once actually
  broadcast, would be ENSV2_ONCHAIN — that broadcast has not happened, per the sentence above.]**
- **Fail-closed by construction, and it is UNICA's own house rule as much as it is a prize
  criterion.** A resolver whose ERC-1967 implementation slot does not match the pinned
  `PermissionedResolverImpl` is classified `NOT_A_PERMISSIONED_RESOLVER` and refused; an unset
  address record fails closed as `ZERO_ADDRESS` rather than resolving to nothing silently
  (`docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §3). **[ENSV2_ONCHAIN for the implementation-slot fact being
  read; CLIENT_VERIFICATION for the classification/refusal logic applied to what was read.]**
- **The non-negotiable settlement boundary is itself a security property Track 1 rewards.** ENS may
  aid discovery before an order exists; once an order is created, the resolved identity is bound
  immutably and no later record change redirects it (research brief's boundary, restated and already true of the
  contracts per `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §8: "the recipient is resolved once, client-side,
  before the order exists... settlement reads only that stored value and never re-resolves a name").
  **[UNICA_ONCHAIN — a binding property of UNICA's own settlement contracts (v4:
  SPECIFIED-NOT-BUILT); ENS's role is discovery only, and is not this bullet's own authority layer.]**

## 7. What must be built during the event

PROPOSED, with the buildable-today path separated from the higher-risk path, and corrected for the
tighter ~2-day submission-deadline reading in §3 rather than the sibling stream's 5-day one.

**Buildable in the runway available, on already-live infrastructure:**
1. At least one terminal subname under the merchant root, delegated `SET_TEXT` at its own **per-key**
   resource via `authorizeTextRoles`, mirroring the exact call shape already measured in
   `integrations/ensv2/roles.mjs` (§6) — built and previewed as calldata, per the repository's
   standing rule that nothing here signs or broadcasts (`ENS-OWNER-ACTION.md`; any real grant is the
   owner's wallet action). **[OFFCHAIN_OPERATION for the calldata construction itself; the grant it
   describes would be ENSV2_ONCHAIN only once the owner signs and broadcasts it, which this item does
   not do.]**
2. One live revocation of that delegation (`authorizeTextRoles(..., granted=false)`, already named as
   a code path in `roles.mjs`), read back via `eth_call`/fork execution exactly as `authz-sim.mjs`
   already contrasts an authorized and unauthorized account for `setAddr`. **[CLIENT_VERIFICATION —
   fork execution and readback, not a broadcast transaction.]**
3. A judge-facing screen showing the merchant root, the terminal's authorization state before and
   after revocation, and one adversarial case (§6 of `DEMO-PLAN.md`) rendered side by side.
   **[OFFCHAIN_OPERATION — building the interface itself; the state it displays is sourced from the
   CLIENT_VERIFICATION reads in items 1–2.]**
4. Reuse of the already-registered `unica.eth` delegation (`docs/SPONSOR-ELIGIBILITY.md` §4
   correction) as the merchant root — no new registration needed. **[ENSV2_ONCHAIN — an
   already-existing state fact on the deployed registry, read rather than re-created.]**

**Out of realistic scope at a ~2-day runway, named rather than silently dropped:**
- A full multi-terminal "fleet" (more than one or two terminals) and any bulk-provisioning tooling.
- The ENS art layer (`docs/unica-v4/ENS-ART-LAYER.md`) — explicitly "planned, not implemented," gated
  on the v4 specification commit, and cut first if the deadline is unsafe by that plan's own H12.
  Nothing in this stream implies building it this event.
- Any tie to a UNICA v4 event or a v4 market registry — v4 contracts do not exist
  (SPECIFIED-NOT-BUILT, `docs/unica-v4/EVENT-SCHEMA.md`, `SPEC-CONTRACTS.md`); a receipt-naming demo
  that leaned on v4 language would risk describing unbuilt contracts as live.
- Candidate C (Agent Commerce Namespace) and any x402/CCIP-Read/bulk-provisioning work — all named in
  the brief's own cut order (`DEMO-PLAN.md` §7) as first to go.

**Recommendation, stated plainly:** given the corrected runway, scope to the smallest version of the
Track-1-native story — one merchant root, one or two terminals, one live revocation, one adversarial
case — rather than the full seven-phase "trust tree." `DEMO-PLAN.md` §4–§5 carries the exact
recommendation and the reasoning for cutting further than the brief's starting proposal.

## 8. What pre-existing work must be disclosed

VERIFIED (repository) / PROPOSED (how to disclose it here). Per `docs/PROVENANCE-LEDGER.md`, the
entire UNICA repository began inside this event's build window (2026-09-04), so nothing here is
"project-specific prior code" in the sense the Classic-track rule (§3) means. What must still be
named, honestly, in any Track 1 submission built from this design — **all four items below are
[OFFCHAIN_OPERATION]: submission-text disclosure obligations, not chain facts:**

1. **The ENSv2 resolution and authorization modules already exist and are already disclosed.**
   `integrations/ensv2/`, `web/ensv2/resolve.mjs`, and the `unica.eth` registration/delegation
   (2026-09-09) were built earlier in this same event window and are already recorded in
   `docs/SPONSOR-ELIGIBILITY.md` §4 as a `LIVE READ` submission. A Track-1 submission reusing them as
   its foundation is extending already-built-this-event infrastructure, not writing ENSv2 integration
   from nothing this week; say so in the submission text.
2. **Two documents predate the event entirely**: `specs/HOOK-SPEC.md` and `specs/THREAT-MODEL.md`
   (`docs/PROVENANCE-LEDGER.md`). Neither is ENS-specific, but both are named in the project's
   standing disclosure rule and that disclosure should be repeated wherever this submission's
   provenance is described.
3. **The ENS art layer plan predates any art-layer code.** `docs/unica-v4/ENS-ART-LAYER.md` is a
   planning document written this event window but explicitly "planned, not implemented" (§1 of that
   file) — if any part of it is built for this stream, the submission must say the plan predates the
   implementation and the implementation, if any, was written during the event.
4. **The per-key EAC finding used in §6 was measured on a pinned fork, not broadcast to public
   Sepolia.** A submission that describes the delegation mechanism must say so precisely — "measured
   against the deployed bytecode via a local fork" is a different, weaker claim than "observed on
   public Sepolia," and the two must not be conflated in submission text.

## 9. Public-repository requirements

VERIFIED — both tracks (§3) require "open source and accessible on Github or a similar platform"
and "a video recording or link to a live demo." UNICA's repository is already public and MIT-licensed
(`CLAUDE.md`, `LICENSE`); the public-repository requirement is met by the repository as a whole. The
specific files this stream would add (delegation calldata, a preview script, a judge-facing screen)
need their own README section, not a repository-wide change. **[OFFCHAIN_OPERATION — a
repository/documentation structuring decision, not a chain fact.]**

## 10. Required ENSv2 dependency and the isolated-deployment question

VERIFIED, both tracks: "built on ENSv2 (Sepolia)" (§3). **No isolated or custom deployment
requirement was found on the official page** — the plain text asks only that the project be built on
ENSv2 on Sepolia, which the canonical, shared "Sepolia (ENSv2 Beta)" deployment satisfies.

**Cross-check, VERIFIED by exact address match.** This repository's own on-chain reads
(`docs/ensv2/UNICA-ETH-ADDR-REPORT.md`, `integrations/ensv2/ENS-OWNER-ACTION.md`, both measured
directly against Sepolia) name three contracts: `ETHRegistry` at
`0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2`, `PermissionedResolverImpl` at
`0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e`, and `UpgradableUniversalResolverProxy` at
`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`. The official ENS deployments page
(<https://docs.ens.domains/learn/deployments>, retrieved 2026-09-11, read as raw page text rather
than a summarized extraction) lists, under its own "Sepolia (ENSv2 Beta)" heading, **the identical
three addresses** for `ETHRegistry`, `PermissionedResolverImpl`, and `UpgradableUniversalResolverProxy`
(case differences only, which do not change an EVM address). **This proves UNICA's already-live
integration reads the same canonical, shared ENSv2 Sepolia Beta deployment ENS itself publishes — not
a separate, isolated instance** — and that this satisfies "built on ENSv2 (Sepolia)" under the plain
text of the page. **[ENSV2_ONCHAIN for the three addresses as read from the deployed contracts;
CLIENT_VERIFICATION for the cross-check against the official page's own listing.]**

**A side finding from the same page, on one of the research brief's UNVERIFIED LEADS — corrected in
this repair, because the address it named had never actually been read.** The canonical deployment
table on `docs.ens.domains/learn/deployments` lists a contract named `MockUSDC` at
`0x768f42455a2d082e23ceef7d51e5787c82d67a39` as part of **ENS's own** Sepolia ENSv2 Beta
infrastructure (most likely used for the registrar's stablecoin-denominated fee path,
`docs.ens.domains/web/ensv2-readiness/`: "Registration fees now paid in stablecoins rather than
ETH," retrieved 2026-09-11).

**This disagrees with a different document's citation, and until this repair neither address had
been read on chain.** `docs/unica-v5/ens/DEPLOYMENT-CONFIG.md` §6 (a sibling stream's file, cited
here, not edited by this file) names a *different* address for `MockUSDC`,
`0xd3322b29a7bdee707d1684676f149bf41aa3422f`, sourced from `contracts/docs/addresses/sepolia.md` (a
GitHub-generated table dated 2026-06-29) — and that file's own §4 already documents, independently,
that every contract "downstream" of the fixed entry-point proxy is volatile across the two source
generations it checked. That file marks its own address `DOCUMENTED_NOT_OBSERVED` for exactly this
reason. This file's earlier draft named its own address as "independent, official confirmation"
without having read it either — an overclaim: an address appearing on an official page is a citation,
not a read.

**Corrected by a live read performed for this repair, 2026-09-11, chain id `11155111`, block
`11685213`** (public endpoint `ethereum-sepolia-rpc.publicnode.com`, `eth_getCode` plus `eth_call`
against `symbol()`, `name()`, `decimals()`, `totalSupply()` — a read-only RPC call, no signature, no
broadcast): **both** addresses carry deployed bytecode and **both** answer `symbol()`/`name()` with
`"USDC"` and `decimals()` with `6`; their `totalSupply()` values differ
(`0x180ca4ce7c5fb29` raw for `0x768f...a39` vs. `0x295be96e646165a5fac469` raw for
`0xd332...22f`), and their runtime bytecode differs in its dispatcher prologue (`5f5ffd5b` vs.
`5f80fd5b`) — **two distinct, independently-deployed contracts, not one contract under two labels.**
**[CLIENT_VERIFICATION — a read-only `eth_getCode`/`eth_call` performed against live Sepolia for this
repair; no state was changed.]**

**What this does and does not settle.** VERIFIED, now by live read rather than by citation alone: the
address this file names (`0x768f...a39`, from the current official ENS docs page) is a real,
currently-deployed ERC-20-shaped token symbol/name `"USDC"`, 6 decimals — consistent with a mock
stablecoin used for a registration-fee path, and not Circle's real USDC contract (Circle's USDC is
not listed on any ENS deployment page fetched for this file, at any address). The address
`DEPLOYMENT-CONFIG.md` §6 names (`0xd332...22f`, from the older generated table) is **also** a real,
currently-deployed contract with the identical symbol and decimals — so that address is not simply
wrong or abandoned; it is a second contract this repository has now observed but not sourced to any
current official page. **What remains UNKNOWN, and is not settled by this live read:** which of the
two addresses, if either, the live ENSv2 registrar contract's own fee-path configuration currently
points to — that requires reading the registrar's own configured fee-token address, a call this file
has not made. The safe, narrower claim this file now makes, replacing the earlier "independent,
official confirmation" language: **"MockUSDC" in the ENSv2 ecosystem is ENS's own test-shaped mock
token and not Circle's USDC, for both addresses observed** — the specific, narrower question of which
one address is wired into the live registrar's fee path today is carried forward to
`MENTOR-QUESTIONS.md` Q9's own unknowns rather than answered here.

**What remains unconfirmed.** The research brief's other referenced leads — "Universal Resolver
override," "invalid old initialize/authorize interfaces," "direct contract registration," "manager
UI failures" — are **not addressed, confirmed, or contradicted** by any source fetched for this
file. They are carried forward as UNVERIFIED LEADS, unchanged, to `MENTOR-QUESTIONS.md` Q9.

## 11. Eligibility risks

1. **Partner-prize slot: already spent, not newly spent.** ENSv2 is already one of the three
   integrations submitted (`docs/SPONSOR-ELIGIBILITY.md`), so pursuing Track 1 under this design does
   not consume a new slot against the "up to 3 Partner Prizes" ceiling (§3) — but the sibling Graph
   file's own §11.1 already flags that Uniswap + ENSv2 + both Graph tracks + Arc collectively exceed
   3 if all are pursued; that is a portfolio decision outside this file's scope, named here because it
   bears on how much attention ENS's Track 1 gets relative to the other three.
2. **Track 2 misfire.** A submission that frames its language as "integrating ENSv2 into an existing
   project" would target the wrong (Continuity-only) track and could be disqualified from Track 1's
   own framing as a result; submission text must use Track 1's language (§2).
3. **The corrected, tighter deadline reading (§3) is the single largest risk to this stream.** If the
   2026-09-13 submission deadline is the binding one rather than 2026-09-16, roughly two days of
   runway remain from this file's retrieval date — sharply narrower than the seven-phase build the
   research brief describes. `DEMO-PLAN.md` §5 scopes to what is realistic at that runway; building the
   brief's full sequence without re-confirming the deadline risks running out of time mid-build.
4. **The "functional, not hard-coded" bar is a real disqualifier, not boilerplate.** Track 1's own
   wording (§3) matches language ENS has used to reject demos before; the primary demo must perform
   a real `eth_call` or fork execution live, not display a pre-computed value.
5. **A demo that leans on the ENS art layer or v4 language risks describing unbuilt work as live.**
   Both are named explicitly not-yet-built in §7; the recommendation there removes this risk rather
   than managing it.
6. **The AI-agent bonus is easy to overweight.** It is optional by the page's own wording (§3); time
   spent on Candidate C at the expense of the core revocable-delegation story would trade a bonus for
   the track's own named centerpiece feature.

## 12. What needs written confirmation from an identifiable ENS team member

Carried in full, with citations, to `docs/unica-v5/ens/MENTOR-QUESTIONS.md`. Summarized here: whether
"built on ENSv2 (Sepolia)" is satisfied by the canonical shared deployment (§10 argues yes from the
page's plain text and an exact address cross-check, but no ENS team member has confirmed this
reading in writing); the exact submission-deadline-vs-event-end-date reconciliation (§3, a real
conflict between this file's own retrieval and the Graph sibling file's); whether the per-key EAC
scoping measured on a pinned fork (§6) is expected to hold identically on a genuine broadcast to
public Sepolia, which has never been attempted; and whether Track 1 judges weigh the AI-agent bonus
as a meaningful differentiator or a minor tiebreaker. Until answered in writing by an identifiable
ENS team member, none of these is claimed as settled.

## 13. Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ETHOnline 2026 ENS prize page | https://ethglobal.com/events/ethonline2026/prizes/ens | 2026-09-11 (fetched twice: initial draft and this repair's §2 reconciliation pass) | ETHGlobal / ENS | OFFICIAL | §2, §3, §4, §5, §9 — track names, prize amounts, exact requirements, named focus features |
| ETHOnline 2026 general prize page | https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 (fetched twice: initial draft and this repair's §2 reconciliation pass) | ETHGlobal | OFFICIAL | §2 — cross-check that the ENS-specific page's shape is not contradicted by the general listing, and the exact-wording comparison against `DEPLOYMENT-CONFIG.md` §1's citation of this same URL |
| ETHOnline 2026 info/details | https://ethglobal.com/events/ethonline2026/info/details | 2026-09-11 (fetched twice) | ETHGlobal | OFFICIAL | §3, §11 — quoted submission deadline, Classic-track rule, demo-video spec, partner-prize rule |
| ENS Docs — Deployments (Sepolia ENSv2 Beta) | https://docs.ens.domains/learn/deployments | 2026-09-11 (raw page text, fetched twice: initial draft and this repair's §10 MockUSDC re-check) | ENS Labs | OFFICIAL | §10 — exact address cross-check against this repository's own on-chain reads; MockUSDC finding |
| ENS Docs — ENSv2 Readiness | https://docs.ens.domains/web/ensv2-readiness/ | 2026-09-11 | ENS Labs | OFFICIAL | §10 — stablecoin registration-fee context for the MockUSDC finding |
| Sepolia public RPC, live read (`ethereum-sepolia-rpc.publicnode.com`) | n/a — JSON-RPC endpoint, not a web page | 2026-09-11, chain `11155111`, block `11685213`, this repair | Public RPC operator, not ENS or ETHGlobal | OFFICIAL-adjacent (public Sepolia chain data, not a curated document) | §10 — `eth_getCode`/`eth_call` (`symbol`, `name`, `decimals`, `totalSupply`) against both candidate MockUSDC addresses, read-only, no signature or broadcast |
| `docs/unica-v5/ens/DEPLOYMENT-CONFIG.md` (sibling stream, cited not edited) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §2, §10 — the conflicting track-wording paraphrase and the conflicting MockUSDC address, both reconciled in this repair |
| `docs/SPONSOR-ELIGIBILITY.md` (this repository) | n/a — local file | 2026-09-05, updated 2026-09-09 | UNICA / NFTeria | TEAM GUIDANCE | §1, §5, §6, §8, §11 — the already-disclosed ENSv2 submission and its status |
| `docs/PROVENANCE-LEDGER.md` (this repository) | n/a — local file | 2026-09-08 (file date); re-derivable any time | UNICA / NFTeria | TEAM GUIDANCE | §2, §8 — from-scratch provenance facts |
| `integrations/ensv2/roles.mjs` (this repository) | n/a — local file | 2026-09-09 (file date) | UNICA / NFTeria | TEAM GUIDANCE | §6 — the per-key EAC measurement that supersedes the 2026-09-08 per-name-only finding |
| `integrations/ensv2/README.md`, `ENS-OWNER-ACTION.md` (this repository) | n/a — local files | 2026-09-08/09 (file dates) | UNICA / NFTeria | TEAM GUIDANCE | §6 — the superseded finding, named rather than hidden |
| `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` (this repository) | n/a — local file | 2026-09-10 (file date) | UNICA / NFTeria | TEAM GUIDANCE | §6, §10 — address cross-check inputs, non-redirect settlement property |
| `docs/unica-v4/ENS-ART-LAYER.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §7, §8 — art-layer plan status |
| `docs/unica-v5/graph/PRIZE-FIT.md`, `DEMO-PLAN.md` (sibling stream, cited not edited) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §1, §3, §11 — the parallel Graph submission and the deadline-reading conflict |

## 14. Unknowns

1. **The submission deadline conflict is unresolved.** This file's own retrieval of
   `ethonline2026/info/details` (twice) finds only a 2026-09-13 12:00 pm EDT submission deadline
   quoted verbatim; the Graph sibling file cites the same URL for "runs through 2026-09-16." No
   single source fetched for either file states both dates together, so neither claim can be ruled
   out from what was retrieved (§3).
2. Whether "built on ENSv2 (Sepolia)" (§3) is satisfied, in the judges' own reading, by resolving and
   writing against the canonical shared Sepolia ENSv2 Beta deployment (as UNICA already does, and as
   §10's exact address cross-check demonstrates) or requires a separately-deployed instance — not
   stated on the page and not addressed by any other source fetched.
3. Whether the per-key Enhanced Access Control resource scoping measured on a pinned Sepolia fork
   (§6, `roles.mjs`) holds identically on a genuine broadcast transaction to public Sepolia — never
   attempted in this repository.
4. Whether pursuing both Track 1 here and the parallel Graph submission is worth the shared
   partner-prize accounting given UNICA's other sponsor commitments (§11.1) — an owner portfolio
   decision, not a fact this research can settle.
5. Whether ENS's judges weigh the optional "AI agents as namespaces" bonus (§3) as a meaningful
   differentiator for Track 1, or treat it as a minor tiebreaker relative to the track's named
   centerpiece features (revocable subnames, Enhanced Access Control, permissioned resolvers) —
   not stated on the page.
6. The remaining UNVERIFIED LEADS from the research brief's own briefing — "isolated deployment" (partially
   addressed in §10: no such requirement was found on the official page, but a stricter unpublished
   requirement cannot be ruled out), "Universal Resolver override," "invalid old initialize/authorize
   interfaces," "direct contract registration," "manager UI failures" — remain unconfirmed by any
   source fetched for this file; no transcript of the referenced ENS channel discussion was supplied
   to verify or refute them.
7. **Which of the two live, code-bearing `MockUSDC`-shaped addresses (§10) the ENSv2 registrar's own
   fee-path configuration currently reads** — this file's live read (§10) confirms both
   `0x768f...a39` and `0xd332...22f` are real, currently-deployed contracts with matching
   symbol/decimals, but neither the registrar's own configured fee-token address nor which
   generation of the deployment is presently authoritative was read for this repair. Carried to
   `MENTOR-QUESTIONS.md` Q9.
