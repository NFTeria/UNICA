# UNICA v5 / ENS — demo plan

Engineering record. Retrieval date 2026-09-11 unless stated otherwise. Labels: VERIFIED (source
cited), PROPOSED (UNICA design), DOCUMENTED_NOT_OBSERVED, UNKNOWN. Authority labels, one per
described action, never blended into a single claim: **ENSV2_ONCHAIN**, **UNICA_ONCHAIN**,
**BACKEND_POLICY**, **GRAPH_EVIDENCE**, **CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION**. §5 and §6
carry one on every phase and every adversarial-case row. Reads against
`docs/unica-v5/ens/PRIZE-FIT.md`, which this file does not repeat.

## 1. Purpose

Rank five candidate demos for the "Best Use of ENSv2" track, evaluate the brief's proposed primary
(a Revocable Merchant Trust Tree) on its merits, recommend one primary and one fallback, and lay out
the minimal build sequence for the primary in seven phases — correcting the brief's starting scope
where the evidence gathered for `PRIZE-FIT.md` disagrees with it.

**Runway, corrected.** `PRIZE-FIT.md` §3 records a direct conflict between this file's own retrieval
of the ETHOnline 2026 submission deadline (2026-09-13, 12:00 pm EDT, quoted verbatim from the
official page, retrieved twice) and the Graph sibling stream's "runs through 2026-09-16" / "five (the sibling file was corrected on 2026-09-11; it now states 2026-09-13)
days of runway" figure drawn from the same URL. This file uses the tighter, directly-quoted number:
**roughly two days of runway from this file's retrieval date (2026-09-11), not five.** Every score
and recommendation below assumes the tighter number; if an identifiable ETHGlobal source later
confirms 2026-09-16 as the true submission deadline, the scores below (particularly "build time")
should be revisited, not the recommendation itself, which already leans toward the smallest reliable
demo.

## 2. Candidate demos, described

PROPOSED (UNICA design), as given by the research brief, restated so the scoring in §3 is legible
without cross-referencing the brief:

| Code | Demo |
|---|---|
| A | Merchant Identity Passport — a read-only screen showing a merchant's ENS name resolved live, its address record, and (if present) its avatar, presented as an identity bundle a payer can inspect before paying |
| B | Revocable POS Fleet — a merchant root delegates a scoped, per-key `SET_TEXT` role (via `authorizeTextRoles`) to one or more terminal subnames representing physical or software checkout points; the merchant can revoke one terminal's role without touching the root or any other terminal |
| C | Agent Commerce Namespace — AI agents as ENS subnames/namespaces, each with its own delegated identity and permissions, discoverable via ENSIP-25/26/27-style text records |
| D | Named Verified Receipt — a settlement receipt's recipient address is cross-checked against an ENS-resolved merchant name, tied to an indexed subgraph verdict (the same shape the Graph sibling stream's demo B produces) |
| E | Full Merchant Trust Tree — the comprehensive design: a merchant root governing a full tree of purpose-scoped subnames (payment, treasury, terminal fleet, agents), each independently revocable via Enhanced Access Control, plus an ENS avatar per `docs/unica-v4/ENS-ART-LAYER.md` |

**The brief's proposed primary — a "Revocable Merchant Trust Tree" — is evaluated on its own merits
in §4 rather than assumed. It sits between B and E**: it is B's revocation mechanism plus a named
root and at least one purpose-scoped branch, without E's full breadth (avatar, agent namespace,
multi-category tree).

## 3. Scoring matrix

PROPOSED (UNICA judgment, reasoned from `PRIZE-FIT.md` and the local specification files cited
inline). Scale: High / Medium / Low, each with the reasoning that produced it, per the project's own
rule that a stated reason beats an unexplained score.

| Axis | A | B | C | D | E |
|---|---|---|---|---|---|
| ENS centrality | Medium — resolution alone, no delegation exercised | **High** — Enhanced Access Control and revocable subnames are exactly Track 1's own named features (`PRIZE-FIT.md` §3) | High — namespaces/agent identity is the track's own bonus line, but bonus, not core | Medium — ENS provides the name layer; the Graph subgraph is the load-bearing verifier | **High**, and broadest — every named Track 1 feature at once, plus the bonus |
| Originality | Low — a resolved-name display is the least distinctive shape among the five | Medium-High — revocation demonstrated live, not merely described | High — few hackathon entries pair agent identity with commerce settlement | Medium — resembles the Graph sibling stream's own primary demo, risking overlap across two separately-submitted tracks | Medium — comprehensive but assembled from already-named parts, not a single novel mechanism |
| UNICA relevance | High — this is the already-`LIVE READ` integration's own display surface | **High** — a merchant's checkout terminals are a real UNICA-shaped problem (which register may act) | Medium — UNICA has no agent-commerce feature built or specified anywhere in the repository | Medium — ties into a v4 dependency currently SPECIFIED-NOT-BUILT (`docs/unica-v4/EVENT-SCHEMA.md`) | High — same relevance as B, extended |
| Security value | Medium — display only, nothing to fail closed on except the existing `ZERO_ADDRESS`/`NOT_A_PERMISSIONED_RESOLVER` refusals | **High** — a scoped, revocable delegation that is measurably narrower than the merchant's own authority is a real access-control story, not a display | Medium — identity discovery is not itself a payment-security story | Medium-High in concept, but the receipt-naming half depends on unbuilt v4 emitter authentication | High — same as B, plus more surface (avatar, agent) that is not itself security-load-bearing |
| Judge clarity | High — one name, one address, easy to narrate in seconds | **High** — "here is a terminal that can act; watch it get cut off and immediately fail" is a vivid, one-sentence demo | Medium — needs the agent-identity concept explained before the punch line lands | Medium — needs the ENS-then-Graph handshake explained first | Medium — breadth dilutes the single clearest beat inside a 2–4 minute video |
| Build time (≈2 days left, `PRIZE-FIT.md` §3) | **Very Low** — reuses the already-live resolution path entirely; adds a screen, no new calldata | Low — one delegation call already measured (`roles.mjs`), one revocation call of the same shape, one screen | High — no design exists anywhere in the repository for agent identity, ERC-8004, or ENSIP-25/26/27 wiring | High — needs the Graph sibling's own verification layer built and wired, doubling the dependency surface | High — B's build plus an avatar layer that is explicitly "planned, not implemented" (`ENS-ART-LAYER.md` §1) and an agent namespace with no existing design |
| Gas | Low — read-only, no gas at all | Low-Medium — the one measured comparable write, `setAddr(bytes32,address)`, costs 44,339 gas (`ENS-OWNER-ACTION.md` §2); `authorizeTextRoles`'s own gas is not yet measured in this repository | UNKNOWN — no calldata built | UNKNOWN — depends on the unbuilt v4 path | Medium — several writes across a wider tree, none yet measured |
| Reliability | **High** — fewest moving parts of any candidate, and the path is already exercised on every existing test run | Medium-High — one more moving part than A (the delegation/revocation round trip), but the exact call shape and its refusal/acceptance rows are already measured on a pinned fork (`roles.mjs`) | Low — new, unmeasured mechanism end to end | Low-Medium — depends on a second sponsor's live subgraph plus a v4-shaped receipt that does not exist yet | Low — most moving parts of any candidate |
| Dependency risk | Low — no new dependency | Low — depends only on the already-deployed Permissioned Resolver and the already-measured call shape | High — depends on ERC-8004/ENSIP-25 infrastructure this repository has never touched | High — depends on the Graph sibling stream's own build landing, and on v4 (SPECIFIED-NOT-BUILT) | Medium-High — depends on the art-layer plan's own open questions (`ENS-ART-LAYER.md` §10: ENSIP-15 normalization unverified, ERC-721 base undecided) |
| Privacy | High — a merchant's public name and address are already meant to be public | High — a terminal's identity and role state are operational metadata, not customer data | Medium — an agent's namespace could imply more about internal operations than a merchant intends to disclose | Medium — a receipt ties a name to a specific settlement, which is more disclosure than a bare identity display | Medium — same as D, plus whatever the avatar's mint history discloses |
| Scalability | Medium — one resolution per view, scales fine | **High** — the delegation pattern is explicitly per-resource; adding a hundredth terminal costs one more call, not a redesign | Medium — namespace-per-agent scales the same way, in principle | Low-Medium — depends on indexer throughput, a second sponsor's infrastructure | Medium — the tree itself scales via EAC, but the avatar-rendering path has an unmeasured on-chain SVG gas cost (`ENS-ART-LAYER.md` §10) |

## 4. Evaluating the brief's proposed primary, and the recommendation

**The research brief proposes a "Revocable Merchant Trust Tree" as the primary demo. Evaluated on its
merits: the mechanism is right, and the word "Tree" is doing more work than the two-day runway can
afford.** Candidate B's mechanism — the merchant root, the per-key delegation, the live revocation —
scores highest or tied-highest on ENS centrality, UNICA relevance, security value, judge clarity,
reliability, and dependency risk (§3), and it is the only candidate whose exact call shape is already
measured against deployed bytecode (`roles.mjs`). Candidate E adds real named-track features on top
of that (a fuller tree, an avatar, more branches) but every addition is also where the brief's own
build-time, reliability, and dependency-risk axes get worse, and none of those additions is itself
load-bearing for the track's own two centerpiece features (Enhanced Access Control, revocable
subnames). **A smaller demo is the better bet.** The "trust tree" framing survives as the *name* of
what is being demonstrated — a small root with at least one governed branch is still a tree — but
the demo that should actually be built is B's mechanism plus a named root, not E's full breadth.

**Primary: a scoped "Revocable Merchant Trust Tree"** — the merchant root (`unica.eth`, already
registered and delegated, `docs/SPONSOR-ELIGIBILITY.md` §4) with one or two terminal subnames, each
delegated a per-key `SET_TEXT` role via `authorizeTextRoles`, with one live revocation shown against
the deployed resolver. This is Candidate B, named to match the track's own "trust" framing, built at
the scope the runway actually supports.

**Fallback: A, the Merchant Identity Passport alone.** If the delegation/revocation round trip proves
unreliable close to the deadline, degrade to showing the already-`LIVE READ` resolution path — one
merchant name, resolved live, with its address and (if time allows) avatar shown. This is not a
different build; it is the primary with the delegation layer removed, so choosing it late costs
nothing already spent, exactly as the Graph sibling stream's own fallback 1 is scoped
(`docs/unica-v5/graph/DEMO-PLAN.md` §4).

**Not recommended for this event, with reasons kept rather than discarded:**
- **E (Full Merchant Trust Tree)** is the right longer-term shape for UNICA v5's ENS identity story,
  but its added scope (avatar, multi-branch tree, agent namespace) does not fit a two-day runway
  without weakening the core delegation/revocation demonstration that the track actually names.
- **C (Agent Commerce Namespace)** matches the track's own bonus line but has no existing design
  anywhere in the repository (§3, build time: High) — building it this event would mean inventing an
  agent-identity feature from nothing in the time remaining, the same overreach risk the Graph
  sibling stream flagged for its own analogous candidate (`docs/unica-v5/graph/DEMO-PLAN.md` §4, "C").
- **D (Named Verified Receipt)** doubles the dependency surface (this stream's ENS work plus the
  Graph sibling stream's own verification layer, plus a v4 event surface that is SPECIFIED-NOT-BUILT)
  for a demo whose ENS half would look thin next to the Graph sibling stream's own, more complete,
  version of the same idea (`docs/unica-v5/graph/DEMO-PLAN.md` §2, Candidate B there). Building both
  would also blur two separately-submitted sponsor tracks together, which `PRIZE-FIT.md` §11.2 (via
  the Graph sibling file's own §11.2) already flags as a live risk for a different pair of
  candidates.

## 5. Minimal build sequence, in seven phases

PROPOSED. The research brief's seven phases are kept as the shape of the plan; each phase's scope is
narrowed to what §4's recommendation and the corrected runway (§1) actually support.

1. **Deployment correctness.** Confirm, live, that the resolver reached for the merchant root is the
   canonical `PermissionedResolverImpl` (ERC-1967 implementation check, already a code path in
   `integrations/ensv2/`), on chain id `11155111`, and that its address matches the canonical
   Sepolia ENSv2 Beta listing (`PRIZE-FIT.md` §10) rather than a stale or legacy resolver. This gate
   already exists; this phase is re-running it against the specific names used in the demo, not
   building it new. **Authority: ENSV2_ONCHAIN** — a live read of the deployed proxy's own
   implementation slot; no write, no signature.
2. **Merchant root.** Use the already-registered `unica.eth` (`docs/SPONSOR-ELIGIBILITY.md` §4) as
   the root. No new registration. Read its current root-level role holders so the demo can state,
   correctly, who holds what before any delegation is shown. **Authority: ENSV2_ONCHAIN** — reading
   existing registry/resolver state; no new registration or grant is made in this phase.
3. **Deterministic identity.** Resolve the root's address record live (the already-`LIVE READ` path);
   if an avatar exists, show it, but do not build a new one — the art layer is out of scope this event
   (`PRIZE-FIT.md` §7). **Authority: ENSV2_ONCHAIN** for the live `addr`/`text` resolution;
   **CLIENT_VERIFICATION** for any avatar ownership cross-check performed before display (ENSIP-12,
   per `docs/unica-v4/ENS-ART-LAYER.md` §4.3 — not itself built this event, per §9 below).
4. **Terminal delegation.** Derive one or two terminal subnames under the root. Build the
   `authorizeTextRoles` calldata for a per-key `SET_TEXT` grant on each, following the exact call
   shape `roles.mjs` already measured (§6 of `PRIZE-FIT.md`) — as calldata for preview, matching the
   repository's standing rule that nothing here signs or broadcasts. Verify via `eth_call`/fork
   execution that the grant, once made, is accepted for the authorized key and refused
   (`EACUnauthorizedAccountRoles`) for any other key or resource, exactly as already measured.
   **Authority: OFFCHAIN_OPERATION** for building the calldata (unsigned, unbroadcast);
   **CLIENT_VERIFICATION** for the `eth_call`/fork-execution check of its effect. Neither step is
   ENSV2_ONCHAIN — that label applies only once the owner actually signs and broadcasts the grant,
   which this phase does not do.
5. **Payment association.** Show the terminal's role scoped to a leaf name that carries nothing the
   merchant relies on — no authority over the merchant's own `pay.`/`treasury.` resources or over the
   root's `SET_SUBREGISTRY`/`SET_RESOLVER` roles — mirroring the residual-risk statement already
   written into `roles.mjs`'s own `DENIAL_MATRIX` ("the agent's authority does not extend to a second
   key even on its own leaf, and merchant., pay. and treasury. resources are additionally in
   protectedResources"). No new UNICA settlement contract is touched; this phase demonstrates the
   *boundary*, not a live payment. **Authority: CLIENT_VERIFICATION** — checking a scope boundary
   against the fork-measured `DENIAL_MATRIX`; explicitly not UNICA_ONCHAIN, since no settlement
   contract is invoked.
6. **Evidence.** Capture the `eth_call`/fork rows for: the terminal's authorized write (accepted), the
   terminal's out-of-scope write (refused), and the revocation (§7 below) — in the same measured,
   printed-not-asserted style as `permissioned-live.mjs` and `authz-sim.mjs` already use. **Authority:
   CLIENT_VERIFICATION** — capturing the results of local fork execution, not live chain events.
7. **Judge-facing interface.** One screen: the root, its terminal(s), each terminal's live
   authorization state, and a revoke action wired to the real `authorizeTextRoles(..., granted=false)`
   calldata shape (previewed, not auto-broadcast — any actual signature remains the owner's, per
   `ENS-OWNER-ACTION.md`'s standing rule). Show at least one adversarial case (§6 below) beside the
   legitimate rows. **Authority: OFFCHAIN_OPERATION** for the interface and the unsigned revoke
   calldata it displays; the live root/terminal state it renders is sourced from the
   **ENSV2_ONCHAIN**/**CLIENT_VERIFICATION** reads in phases 1–3 and 4–6 respectively, not read anew
   by the interface itself.

## 6. Adversarial cases the demo must show

PROPOSED, with the expected fail-closed behavior for each, reasoned from mechanisms already measured
or already documented in this repository. Cases not yet demonstrable in the runway available are
named as such rather than assumed solved.

| Case | Expected fail-closed behavior | Basis | Authority |
|---|---|---|---|
| Legitimate root | Resolves live to the merchant's address; root-level roles read back exactly as expected | Baseline — establishes the fixture is real, per the project's rule that a stated negative beats an absence | **ENSV2_ONCHAIN** — a live read of the real, already-registered `unica.eth` |
| Legitimate terminal | The terminal's authorized key write succeeds; any other key on the same name is refused | `roles.mjs` per-key measurement (`PRIZE-FIT.md` §6) | **CLIENT_VERIFICATION** — the grant exists only on a local fork (§5 phase 4); no terminal subname is registered or granted live |
| Revoked terminal | After `authorizeTextRoles(..., granted=false)`, the same key that previously succeeded is now refused (`EACUnauthorizedAccountRoles`); nothing else on the tree changes | Same mechanism as above, applied to the revoke path already named in `roles.mjs`'s method list | **CLIENT_VERIFICATION** — same fork-execution basis as the row above |
| Lookalike name | The checkout's independent resolution reads a different node/address than the legitimate merchant; normalization follows ENSIP-15 rather than a display-string fuzzy match, so a confusable label is never silently treated as the same name | `docs/unica-v4/ENS-ART-LAYER.md` §3.4 — ENSIP-15 verification is itself still an open item there; this demo does not resolve that gap, only avoids relying on unnormalized string comparison | **ENSV2_ONCHAIN** for resolving the lookalike name's own real, independent record; **CLIENT_VERIFICATION** for the normalization comparison itself |
| Counterfeit avatar | If an avatar is shown at all (§5 phase 3, optional), the ENSIP-12 ownership cross-check fails for an avatar the resolved address does not own, and the checkout warns rather than displaying it as proof — "the image alone is never treated as proof of payout identity" | `docs/unica-v4/ENS-ART-LAYER.md` §4.3, H11 | **CLIENT_VERIFICATION** — the ownership cross-check itself; the avatar record and the token's `ownerOf` it compares are each **ENSV2_ONCHAIN**/**UNICA_ONCHAIN** reads respectively |
| Resolver from the wrong deployment | Classified `NOT_A_PERMISSIONED_RESOLVER` and refused, exactly as the existing tooling already does for a name still served by the ENSv1 mirror | `integrations/ensv2/ENS-OWNER-ACTION.md` §Step 1 ("`vitalik.eth` on Sepolia returns exactly that today") | **ENSV2_ONCHAIN** — matches `DEPLOYMENT-CONFIG.md` §2's own label for this identical live check |
| Stale indexer view | Any cached or indexed view of authorization state is never trusted for the revocation demo; the judge-facing screen reads role state via `eth_call`/fork execution at demo time, not from a cache, and if it must show a cached value it states the block the cache was last updated at rather than presenting it as current | Consistent with this repository's own finding that a bounded `eth_getLogs` scan for `EACRolesChanged` over a load-balanced endpoint is non-deterministic (`integrations/ensv2/README.md`, "Two things measured") | **CLIENT_VERIFICATION** — the rule the judge-facing screen itself follows; the distrusted cache would be **GRAPH_EVIDENCE** or another indexed view, never treated as current on its own |
| A receipt created before revocation | Not built this event (§4 — Candidate D is deferred). If shown at all, the stated rule is the research brief's own non-negotiable boundary: an existing order/receipt does not change when a later ENS record is revoked; the interface must show the identity as observed at settlement, separately from current resolution, and never re-validate a past receipt against today's revoked state as if that revokes the original payment | Non-negotiable boundary, restated; consistent with `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §8's "no live call in this repository re-resolves a name after settlement" | **UNICA_ONCHAIN** — a binding property of UNICA's own settlement contract (v4: SPECIFIED-NOT-BUILT); **CLIENT_VERIFICATION** for how the interface must separate it from current resolution |

## 7. Cut order and overreach guards

PROPOSED, restating the research brief's own cut order so it does not have to be re-derived mid-build. **First
cut, in order, before any of the four items below are ever touched:** agent identity (Candidate C),
x402, receipt naming (Candidate D's ENS-to-Graph tie-in), CCIP-Read, bulk provisioning. **Never cut
first — these are the core the recommendation in §4 is built around:** deployment correctness, role
narrowing (per-key, not per-name, scoping — §6 of `PRIZE-FIT.md`), revocation, payment-binding safety
(the boundary in §5 phase 5 and §6's last row). **[OFFCHAIN_OPERATION — a build-priority ordering
decision, not itself a chain action; each item ordered here carries its own authority label in §5/§6
above.]**

Stated once, plainly: never deploy or publish anything; never register a new name (the root reuses
`unica.eth`); never grant a role from live calldata without separate owner approval — every
delegation and revocation shown is calldata built and verified by `eth_call`/fork execution, per
`ENS-OWNER-ACTION.md`'s standing rule, not a broadcast this research performs; no v4 contract or
event is described as live; the ENS art layer is not built for this stream; a demo that cannot fit
inside the 2–4 minute cap (`PRIZE-FIT.md` §3) is cut to the fallback (§4) rather than rushed.
**[OFFCHAIN_OPERATION for the calldata construction this paragraph restates; CLIENT_VERIFICATION for
the `eth_call`/fork-execution checks it names — matching §5 phase 4's own split; nothing in this
paragraph is ENSV2_ONCHAIN or UNICA_ONCHAIN, which is the point it is making.]**

## 8. Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ETHOnline 2026 ENS prize page | https://ethglobal.com/events/ethonline2026/prizes/ens | 2026-09-11 | ETHGlobal / ENS | OFFICIAL | §1, §3, §4 — track's named features, demo-video cap |
| ETHOnline 2026 info/details | https://ethglobal.com/events/ethonline2026/info/details | 2026-09-11 (fetched twice) | ETHGlobal | OFFICIAL | §1 — the submission-deadline conflict this plan's runway is built on |
| `docs/unica-v5/ens/PRIZE-FIT.md` (this stream) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | throughout — the eligibility, deployment, and per-key EAC findings this plan builds on |
| `integrations/ensv2/roles.mjs` (this repository) | n/a — local file | 2026-09-09 | UNICA / NFTeria | TEAM GUIDANCE | §3, §4, §5, §6 — the measured delegation/revocation call shape and its `DENIAL_MATRIX` |
| `integrations/ensv2/ENS-OWNER-ACTION.md` (this repository) | n/a — local file | 2026-09-08 | UNICA / NFTeria | TEAM GUIDANCE | §3, §5, §7 — the gas figure for the one measured comparable write; the no-broadcast standing rule |
| `docs/unica-v4/ENS-ART-LAYER.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §3, §5, §6 — avatar/art-layer status, ENSIP-12 ownership cross-check, ENSIP-15 open item |
| `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` (this repository) | n/a — local file | 2026-09-10 | UNICA / NFTeria | TEAM GUIDANCE | §4, §6 — non-redirect settlement property |
| `docs/unica-v4/EVENT-SCHEMA.md`, `SPEC-CONTRACTS.md` (this repository) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §3, §4 — v4 SPECIFIED-NOT-BUILT status, grading Candidate D down |
| `docs/unica-v5/graph/DEMO-PLAN.md` (sibling stream, cited not edited) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §4 — fallback-scoping pattern reused here; overlap risk with Candidate D |

## 9. Unknowns

1. Whether the true submission deadline is 2026-09-13 or 2026-09-16 (§1, `PRIZE-FIT.md` §3) — this
   plan's entire runway assumption rests on it, and it is not resolved by any source fetched.
2. Whether `authorizeTextRoles`'s gas cost is close enough to the one measured comparable write
   (44,339 gas for `setAddr(bytes32,address)`, `ENS-OWNER-ACTION.md` §2) to plan a demo transaction
   budget around — not yet measured for this specific call in this repository.
3. Whether the per-key EAC scoping measured on a pinned fork (§3, §5) holds identically on a genuine
   broadcast transaction to public Sepolia — never attempted; if it does not, the live revocation demo
   (§5 phase 4, §6) would need to be rebuilt against different observed behavior.
4. Whether four minutes of demo video is enough to show deployment correctness, one delegation, one
   revocation, and one adversarial case credibly — not tested against an actual cut of the video,
   which does not yet exist.
5. Whether a lookalike-name adversarial case (§6) can be shown honestly without first resolving the
   ENSIP-15 normalization verification `docs/unica-v4/ENS-ART-LAYER.md` §3.4 already flags as
   unverified — if normalization itself is not confirmed, a "lookalike is refused" claim risks
   asserting more than has actually been checked.
6. Whether the owner will treat the fallback (§4, Candidate A) as an acceptable submission on its own
   if the delegation/revocation build proves unreliable close to the deadline — an owner decision, not
   a fact this research can settle.
