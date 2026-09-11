# UNICA v5 / ENS — open questions for the owner

Research draft for owner review. Not committed. Authorizes nothing. UNICA v5 scope; it does not
change or delay UNICA v4 settlement.

**A provenance note, stated plainly rather than papered over.** The instruction governing this
document asked for the owner decisions "as one numbered copy-paste block E1 to E12 exactly as the
brief frames them." The material that reached this stream did not include that brief's own E1–E12
text or numbering — only the seventeen files in this directory and the three upstream research
summaries they were built from. Rather than invent wording and attribute it to a brief this stream
never received, the block below is compiled directly from the owner-decision points each of the
seventeen files states explicitly in its own text (most of them phrased, in the source file itself,
as "an owner decision" or "not decided by this document"), numbered E1 onward in descending order of
how many other decisions in this directory depend on the answer. This is the same honesty convention
every source file in this directory already applies to the missing ENS sponsor-channel transcript:
say plainly what did not arrive, rather than guess at its contents. E1–E12 are the twelve
highest-leverage, most cross-cutting items found this way; E13 onward are the narrower or
more implementation-specific decisions the individual streams raised, in the numbering the STREAM
brief specified.

---

## E1. Direct merchant registration versus a UNICA-managed subname

**Options:**
- (a) Every merchant registers their own ENSv2 name directly — the merchant holds their own
  registry-level admin authority from the first transaction.
- (b) A merchant receives a managed subname under a UNICA-controlled parent name — UNICA's own
  parent-registry admin authority sits where the merchant's own admin authority would otherwise be.

**(Recommended): (a), direct registration.** A single compromise of UNICA's own parent-registry key
under (b) is an excessive-root-grant event against every managed merchant simultaneously; under (a)
the same compromise reaches only one merchant. This is the sharpest reason to prefer direct
registration wherever the cost of a per-merchant registration is acceptable.

**Section:** `ACCESS-CONTROL.md` §8 (merchant-owner row), §9; `THREAT-MODEL.md` §3.7.

## E2. `subtree` (shared resolver) versus `subregistry` (individual proxy) mode as the onboarding default

**Options:**
- (a) `subtree` mode for every merchant: one shared resolver instance per parent, served by wildcard
  resolution, no per-merchant registry.
- (b) `subregistry` mode for every merchant: a registered subname with its own resolver and registry
  proxy set, deployed on demand.
- (c) `subtree` by default, `subregistry` only for a merchant that specifically needs a transferable,
  independently-owned name.

**(Recommended): (c).** `subtree` mode costs fewer transactions (13 versus 20) and bounds the count
of independently-initialized, authority-holding resolver instances to one per parent rather than one
per merchant — load-bearing once merchant count reaches the low thousands, where `subregistry` mode's
per-instance initialization risk stops being a tail risk and becomes an expected, recurring one.

**Section:** `NAMESPACE.md` §9, §12.2; `SCALABILITY.md` §3, §6, §7.

## E3. Whether a fork execution of the deployed bytecode is sufficient evidence to call per-key EAC resource scoping VERIFIED

**Options:**
- (a) Treat the existing Sepolia-fork execution (`authorizeTextRoles` granting a role that resolved to
  the per-key resource, not the name-level resource) as sufficient corroboration, alongside the
  matching official documentation, to call per-key scoping VERIFIED going forward.
- (b) Require a transaction actually processed by the maintained public Sepolia network — not a local
  fork replay of the deployed bytecode — before per-key scoping is treated as more than
  DOCUMENTED_NOT_OBSERVED-on-the-live-network.

**(Recommended): (b).** Every document in this directory that depends on per-key scoping already
carries both readings side by side and states the conservative assumption should govern until this is
answered; a staff/terminal delegation feature built on an unconfirmed live-chain assumption is the
single largest correctness risk this whole design carries forward.

**A live-broadcast record exists and does not, by itself, settle this.** `HACKATHON.md` §6 records
a live broadcast on the maintained public Sepolia network — twelve transactions, blocks
11670554–11670579, every one `status 1` — and describes the result, from a six-row simulated
readback (`integrations/ensv2/agent.mjs`, `eth_call` against live post-broadcast state, not a
further broadcast), as the agent holding `SET_TEXT` "at one per-key resource and nothing at the
name, the payment name or ROOT_RESOURCE." That readback is real and the transactions are real, but
this directory's own most current adjudication (`ACCESS-CONTROL.md` §16) does not treat
`HACKATHON.md` §6's own wording as dispositive: no source read for this directory prints the
resource hash that readback actually named beside the block number, and every live refusal this
repository has separately observed named only the name-level resource. So the record available here
does not affirmatively say those 12 transactions did **not** name a per-key resource — only that
no source prints the hash confirming they did. That gap, not an absence of any live broadcast, is
why option (b) is recommended: the fix is a printed resource hash from a live read, not a further
broadcast.

**Section:** `NAMESPACE.md` §0, §12.4; `ACCESS-CONTROL.md` §4, §6, §16; `DIFFERENTIATION.md` §3;
`PRIZE-FIT.md` §6; `HACKATHON.md` §6.

## E4. Whether to build staff/terminal delegation, capability-publishing, or revocation-propagation features for v5, and in what priority relative to UNICA v4's own contracts

**Options:**
- (a) Build one or more of these features now, ahead of or in parallel with UNICA v4 contract work.
- (b) Defer all three until UNICA v4's own contracts exist and E3 is resolved.
- (c) Do not build any of them for v5; the existing agent-delegation mechanism already covers the
  load-bearing case.

**(Recommended): (b).** Every one of these features is argued as a requirement *if built*, not as
something scheduled; building them against an unconfirmed per-key-scoping assumption (E3) or ahead of
the v4 contracts they would ultimately need to gate against risks having to redesign the delegation
layer twice.

**Section:** `DIFFERENTIATION.md` §3, §5, §6, §10.

## E5. Registered versus wildcard-resolved subnames for POS terminals

**Options:**
- (a) Every terminal gets a registered subname with its own resolver proxy.
- (b) Every terminal is a wildcard-resolved subname served by the merchant's own resolver, never
  separately registered.

**(Recommended): (b).** Matches the `subtree`-mode default recommended in E2, costs no per-terminal
registration transaction, and the terminal's EAC resource still isolates correctly because the
resource formula includes the terminal's own node, not just the parent's.

**Section:** `POS-TERMINALS.md` §3, §6 item 1; `NAMESPACE.md` §1, §9.

## E6. Whether to automate the two-step terminal/agent revocation into one action

**Options:**
- (a) Keep revocation as two independent, manually-triggered steps: backend account disable, then a
  separate on-chain EAC revocation.
- (b) Build a single "decommission" backend action that fires both steps together.

**(Recommended): (b), once resources allow.** The two-step design is deliberate — a partial failure
should leave an explicit, checkable state — but leaving it permanently manual means an operator who
only disables the backend account (and never separately revokes the EAC grant) leaves the old key
able to write its one scoped text record indefinitely, a residual this directory states rather than
hides.

**Section:** `POS-TERMINALS.md` §4.6, §4.7, §5, §6 item 3.

## E7. Whether to adopt ENSIP-25/26 agent-facing keys in place of, or alongside, the already-live `unica:agent`/`unica:capabilities` keys

**Options:**
- (a) Keep the existing `unica:` colon-delimited keys only.
- (b) Adopt ENSIP-26's `agent-context`/`agent-endpoint[<protocol>]` alongside the existing keys,
  without migrating.
- (c) Migrate fully to the ENSIP-26 keys and deprecate the `unica:` family.

**(Recommended): (b), for this event.** The `unica:` keys are already signed and broadcast on
Sepolia; migrating or deprecating them mid-event risks a window where two different keys carry the
same fact for the same delegation. Adopting ENSIP-26 alongside costs nothing already spent and gives
UNICA's agent surface a standards-track discovery veneer without touching the live grant.

**Section:** `RECORDS.md` §5.2–§5.3, §5.5, §8 item 2; `AGENT-IDENTITY.md` §4.5, §6 item 2.

## E8. Whether and when to layer the epoch-commitment-root model (Model E) on top of the merchant-service-record default (Model D) for receipt discovery, and at what epoch length

**Options:**
- (a) Model D only, indefinitely.
- (b) Model D now; add Model E only when a dispute or third-party audit specifically needs a
  durable, ENS-anchored evidence trail independent of the merchant's own service uptime.
- (c) Build both from the outset.

**(Recommended): (b), with a daily epoch as the default cadence if and when Model E is built.**
Model D already answers ordinary discovery at every scenario modeled; Model E's cost is decoupled
from receipt volume by construction, so there is no urgency to build it before a concrete need
appears, and a daily cadence is the cheaper default absent a stated need for faster dispute
resolution.

**Section:** `RECEIPT-NAMING.md` §5, §7, §9 item 4; `NAMESPACE.md` §12.3.

## E9. Whether to build any part of the ENS art layer / identity NFT for this event, or defer it entirely

**Options:**
- (a) Build a minimal avatar and renderer this event.
- (b) Defer the entire art layer to post-event v5 work.

**(Recommended): (b).** The art layer is explicitly "planned, not implemented" and gated on the v4
specification commit; building any part of it this event trades runway away from the track's own
named centerpiece features (Enhanced Access Control, revocable subnames) for a feature the prize
page's own wording never requires.

**Section:** `DEMO-PLAN.md` §4, §7; `IDENTITY-NFT.md` §0; `PRIZE-FIT.md` §7.

## E10. Which demo to submit if the delegation/revocation build proves unreliable close to the deadline

**Options:**
- (a) Commit to the primary (scoped Revocable Merchant Trust Tree) regardless, and accept the risk of
  submitting nothing functional if it breaks late.
- (b) Pre-approve the fallback (Merchant Identity Passport alone) now, so a late degrade decision costs
  nothing already spent.

**(Recommended): (b).** The fallback is the primary with the delegation layer removed, not a
different build — approving it in advance removes a late, pressured decision from the critical path.

**Section:** `DEMO-PLAN.md` §4, §9 item 6.

## E11. Whether to require a Safe (multi-signature) rather than a single EOA as the admin-role holder for any UNICA-controlled ENSv2 name

**Options:**
- (a) A single EOA holds admin authority.
- (b) A Safe (or equivalent multi-signature holder) holds admin authority.

**(Recommended): (b).** Once the sole admin-role holder's key is lost, no third party can recover it
and every regular grant under that admin becomes unrevokable in practice; this mirrors UNICA v4's own
existing posture for its mainnet admin key and closes the sharpest single-point-of-failure in this
directory's own threat catalogue.

**Section:** `THREAT-MODEL.md` §3.8, §3.9, §3.19, §5.

## E12. Whether to unify the existing `unica:` colon-delimited key family with the new `com.unica.*` reverse-dot-notation family

**Options:**
- (a) Keep the two families separate indefinitely.
- (b) Unify now under one namespace.
- (c) Defer the decision; keep them separate for this event and revisit with a migration plan later.

**(Recommended): (c).** A live, already-broadcast delegation already exists on the `unica:` keys;
unifying mid-event risks a window where two different keys carry the same fact for the same
delegation, and a from-scratch architecture document is not the place to schedule that migration.

**Section:** `RECORDS.md` §5.5, §8 item 3.

---

## Further owner decisions raised by the individual streams

## E13. Which submission-deadline reading governs runway-dependent planning

**Options:**
- (a) Trust the tighter, directly-quoted reading: 2026-09-13, 12:00 pm EDT.
- (b) Trust the looser reading a sibling Graph-stream document cites from the same URL: "runs through
  2026-09-16."
- (c) Treat it as unresolved and seek a fresh, unambiguous confirmation before finalizing scope.

**(Recommended): (a), until an identifiable source resolves the conflict.** This file's own retrieval
of the event's info/details page, twice, returns only the 2026-09-13 date as printed text; planning on
the tighter number costs nothing if the looser one turns out to be correct, while planning on the
looser number and being wrong could mean missing the real deadline entirely.

**Section:** `PRIZE-FIT.md` §3, §14 item 1; `DEMO-PLAN.md` §1.

## E14. Whether to pursue the ENS Track 1 submission alongside Uniswap v4, both Graph tracks, and Arc given the "up to 3 Partner Prizes" ceiling

**Options:**
- (a) Pursue all four sponsor relationships and accept the portfolio risk of exceeding the effective
  prize-selection ceiling.
- (b) Prioritize a subset of three.

**(Recommended): not resolved by this stream.** This is an owner portfolio decision weighing relative
prize value and build risk across sponsors this stream has no visibility into; it is named here so it
is not silently decided by default.

**Section:** `PRIZE-FIT.md` §11 item 1.

## E15. Whether to keep chasing the still-unconfirmed leads before repeating them elsewhere

**Options:**
- (a) Continue spending research budget on "manager UI failures," the exact function-name match for
  "invalid old initialize/authorize interfaces," and whether judges weigh the AI-agent bonus
  meaningfully.
- (b) Accept these as permanently unconfirmed for this event and move on.

**(Recommended): (b).** Given the runway conflict in E13, further research budget is better spent on
the primary demo's own build than on leads that, even if confirmed, would not change this stream's
recommended scope.

**Section:** `DIFFERENTIATION.md` §9, §12; `MENTOR-QUESTIONS.md` Q5, Q7, Unknowns 4 and 6.

## E16. Whether to include an optional "creation epoch" field on the identity NFT

**Options:**
- (a) Include a manually-versioned era label, recorded on the minted token's identity facts, never
  read from `block.timestamp`.
- (b) Omit the field entirely.

**(Recommended): (b).** Safe to omit; omitting it changes nothing else in the design, and the art
layer is deferred for this event regardless (E9).

**Section:** `IDENTITY-NFT.md` §4.5, §15 item 6.

## E17. Whether the identity NFT's art seed is the ENSIP-1 namehash node or the full name string

**Options:**
- (a) `ArtSeed.sourceEncoding = "NAMEHASH"` — a fixed 32-byte value, cryptographically binding parent
  and label together by construction.
- (b) `ArtSeed.sourceEncoding = "STRING"` — the full normalized dotted name.

**(Recommended): (a), NAMEHASH.** Closes the leaf-label collision risk (two merchants under different
parents sharing a label would otherwise collide into byte-identical art) and avoids the `String[N]`
long-name sizing problem entirely.

**Section:** `IDENTITY-NFT.md` §4.3, §15 item 3.

## E18. Whether ENSIP-27's `class`/`schema` mechanism is adopted for UNICA terminal/agent subnames

**Options:**
- (a) Adopt both `class` and `schema`.
- (b) Adopt `class` only.
- (c) Adopt neither; keep the existing closed vocabulary of `com.unica.*`/`unica:` keys as the only
  classification mechanism.

**(Recommended): (b), `class` only.** A single pascal-case label (e.g. `Agent`, or a specialized
`Terminal` value) gives an indexer a standard, cross-ecosystem-legible filter field at near-zero cost;
`schema`'s own mutable-pointer risk (a schema that changes after a client already validated against
it) is not worth taking on for a field with no security significance either way.

**Section:** `RECORDS.md` §5.4, §8 item 4; `POS-TERMINALS.md` §3, §6 item 2.

## E19. Whether a terminal's decommission should explicitly clear its status record to `retired`, or leave the last-written value in place

**Options:**
- (a) Explicitly write `com.unica.terminal-status = retired` at decommission time.
- (b) Leave the last-written value (`active`/`maintenance`/`revoked`) in place, relying only on the
  EAC grant revocation.

**(Recommended): (a).** Gives a GRAPH_EVIDENCE reader an unambiguous "last known state" rather than a
value that could be misread as still current.

**Section:** `POS-TERMINALS.md` §4.8, §6 item 5.

## E20. Whether to build any part of the Agent Commerce Namespace (Candidate C) for v5

**Options:**
- (a) Build a minimal version this event, since it matches the ENS track's own named bonus.
- (b) Defer entirely; the bonus is optional and no design exists anywhere in the repository today.

**(Recommended): (b).** Named first in this stream's own cut order — building an agent-identity
feature from nothing in the runway available would trade the track's own named centerpiece features
(already-measured delegation and revocation) for an optional bonus with no existing design to build
from.

**Section:** `DEMO-PLAN.md` §4, §7; `PRIZE-FIT.md` §4, §6 item 6.
