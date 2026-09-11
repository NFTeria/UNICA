# UNICA v5 / The Graph — demo plan

Engineering record. Track: **From Scratch** (confirmed 2026-09-11). Retrieval date 2026-09-11
unless stated otherwise. Labels: VERIFIED (source cited), PROPOSED (UNICA design), UNKNOWN. Reads
against `docs/unica-v5/graph/PRIZE-FIT.md`, which this file does not repeat.

## 1. Purpose

Rank five candidate demos for the Track 2 (AI Tooling or AI Use Case, From Scratch) submission,
recommend one primary and two fallbacks, and lay out the minimal build sequence for the primary —
correcting the research brief's starting proposal where the evidence gathered for `PRIZE-FIT.md`
disagrees with it. Today is 2026-09-11; ETHOnline 2026 runs through 2026-09-16 (VERIFIED,
`PRIZE-FIT.md` §7) — five days of runway from this file's retrieval date, a hard constraint on
every score below.

## 2. Candidate demos, described

PROPOSED (UNICA design), as given by the research brief, restated so the scoring in §3 is legible
without cross-referencing the brief:

| Code | Demo |
|---|---|
| A | Verified settlement explorer — a query and screen that takes an order or transaction identifier and returns VERIFIED / REFUSED / UNKNOWN with a reason code and the block the answer was read at, backed by the live Sepolia subgraph |
| B | Agent refusal through MCP — the same verdict, wrapped in one MCP tool (`unica_verify_receipt`) and driven by an actual agent loop that must act on the verdict: proceed on VERIFIED, decline on REFUSED or UNKNOWN |
| C | ENS identity NFT provenance — an NFT whose provenance is tied to an ENS-resolved merchant identity, indexed and queried back |
| D | Cross-chain operations dashboard — one screen showing UNICA activity across more than one chain |
| E | x402 evidence gate — an x402 facilitator's `/settle` step gated on a Graph-backed verification verdict before it is allowed to proceed |

## 3. Scoring matrix

PROPOSED (UNICA judgment, reasoned from the evidence in `PRIZE-FIT.md` and the local specification
files cited inline). Scale: High / Medium / Low, each with the reasoning that produced it rather
than a bare number, per the project's own rule that a stated reason beats an unexplained score.

| Axis | A | B | C | D | E |
|---|---|---|---|---|---|
| Distinctiveness | Medium — a verification query is a recognizable shape | **High** — an agent that refuses is a rarer, more vivid demo of the same mechanism | Low — provenance-of-identity is a different value proposition, and dilutes the separately-submitted ENS track | Low — a multi-chain dashboard is a common hackathon pattern | High — gating an HTTP-402 payment on subgraph evidence is a genuinely novel combination |
| Build time (5 days left) | Low — reuses the already-deployed, already-synced V1/V3 subgraph (`PRIZE-FIT.md` §7); adds a query and a screen | Medium — everything in A plus one agent-loop harness that calls the MCP tool and decides | High — needs a wholly new, unspecified NFT-minting feature; no existing design doc found anywhere in the repository | High — needs multiple chains wired, each with its own RPC and indexing story | High — needs a real or realistically mocked x402 resource server and facilitator in addition to A's query |
| Live dependency on The Graph | High — the verdict has no other input | High — same query, one layer further from the screen | Medium — could index mint events, but the load-bearing case is weaker | Medium for the Sepolia leg; UNKNOWN for any other leg (see §7, §6) | Medium — Graph evidence is a precondition check, not the flow's primary driver, which risks looking like a bolt-on rather than load-bearing |
| Judge clarity | High — one query, one verdict | **High**, and more vivid than A — the abstract verdict becomes a concrete behavior (the agent stops) | Medium — needs the NFT and ENS story explained first | Medium — a dashboard is visually appealing but the message dilutes across chains | Medium — needs the x402 handshake explained before the punch line lands, inside a 2–4 minute cap (`PRIZE-FIT.md` §11.5) |
| Reliability | High — fewest moving parts of any candidate | Medium-High — one more moving part than A (the agent transport), still scriptable and rehearsable | Medium — new minting logic is new failure surface | Low — most moving parts of any candidate: multiple RPCs, multiple indexers, cross-chain reconciliation | Medium-Low — a facilitator/resource-server pair plus the query is more surface than A or B |
| Security value | High — operationalizes emitter authentication (`PRIZE-FIT.md` §6) | **High**, and the clearest embodiment of "an indexing failure must never create, authorize, or settle a payment" — an agent that fails closed *is* the security story | Low — identity provenance is not a payment-security story | Low-Medium | Medium-High in concept, unproven in practice — x402 has zero UNICA code today, only the reference document `docs/unica-v4/arc/X402.md` |
| Sponsor relevance (Track 2 wording) | High — "AI agents or apps that use The Graph as their live source of blockchain data" | **Very high** — the clearest embodiment of the track's own two named shapes at once (`PRIZE-FIT.md` §4) | Medium — touches ENS and Graph but risks the "querying one Subgraph" disqualifier if the indexing is thin | Medium | Medium — a submission whose headline is x402/Arc with Graph as a supporting check risks not reading as Graph-load-bearing to a Graph judge |
| Risk of overreach | Low — grounded in already-live infrastructure; no new contract | Low-Medium — must not claim the agent "prevents" a real payment when nothing is actually authorized or broadcast (the standing rule: never sign, broadcast, spend) | High — a new, unspecified feature invented for this stream, and it blurs two sponsors' separately-submitted tracks together | High — explicitly contradicted by the research brief's own ordering ("only then consider more chains") and by the network-support gaps in §6 | High — three sponsor surfaces (Graph, Arc, x402) in one demo, one week, none of it built yet |

## 4. Recommendation — one primary, two fallbacks

**Primary: B, agent refusal through MCP**, built on top of A as its necessary first layer — A is
not a separate deliverable to skip but the foundation B is wrapped around. B wins on the two axes
that matter most for this specific prize (sponsor relevance and security value) while costing only
one bounded increment of build time and reliability risk over A, and it directly demonstrates the
task's own standing rule: "an indexing failure must never create, authorize, or settle a payment."

**Fallback 1: A, the verified settlement explorer alone.** If the agent-loop wrapper (the harness
that turns a verdict into a refused action) proves unreliable close to the demo date, degrade
gracefully to showing the MCP tool's JSON verdict live rather than a full agent transcript. This is
not a different build — it is B with the last layer removed, so choosing it late costs nothing
already spent.

**Fallback 2: E, the x402 evidence gate**, ranked ahead of C and D despite its Medium-Low
reliability score, because it is the only one of the three with real, dated, primary-source
documentation already in the repository (`docs/unica-v4/arc/X402.md`, retrieved 2026-09-11) rather
than an invented, undocumented feature. It is named as a fallback, not a co-primary, because
building it well this week would mean standing up three sponsor surfaces at once — recommended
only if the owner decides the Arc/x402 story is worth the extra build time and the diluted Graph
centrality named in §3.

**Not recommended for this event, with reasons kept rather than discarded:**
- **D (cross-chain dashboard)** matches UNICA's own longer-term v5 product shape — the owner's
  2026-09-11 release-naming ruling calls v5 "the dashboard" generation — so it is the right
  direction for *after* this event, not during the remaining five days of it. Its build-time and
  network-support problems (§6) are about this week's runway, not about the idea.
- **C (ENS identity NFT provenance)** is set aside because no design for it exists anywhere in this
  repository, which makes its build-time and reliability scores the worst of the five, and because
  folding it into the Graph submission would blur it with the already-separately-submitted ENSv2
  track (`docs/SPONSOR-ELIGIBILITY.md` §4) rather than strengthening either.

## 5. Minimal build sequence

PROPOSED. The research brief's starting order is kept where the evidence agrees with it and
corrected, with the correction stated, where it does not.

1. **Freeze the event surface.** Kept as given, with a correction: the brief's order implies the
   event surface is UNICA v4's. `PRIZE-FIT.md` §7 finds the v4 event surface is
   SPECIFIED-NOT-BUILT and blocked on the owner's G0. The surface actually frozen for this demo is
   the **already-deployed V1/V3 `SettlementReceipt` event** on `integrations/graph/`'s existing
   ABI and its one `Settlement` entity — a smaller, already-live surface, not the twelve-event v4
   surface of `docs/unica-v4/EVENT-SCHEMA.md`.
2. **Reuse, do not rebuild, the Sepolia subgraph.** The brief's order calls for building "one
   supported-chain subgraph on Sepolia." That subgraph already exists and is already synced
   (`PRIZE-FIT.md` §1, §10); the corrected step is to point the new verification query at it,
   adding no new data source unless a gap in §6 of `PRIZE-FIT.md` forces one.
3. **Hook-to-executor receipt matching, corrected to emitter authentication.** The brief's order
   calls for "hook-to-executor receipt matching with explicit finality." `PRIZE-FIT.md` §1
   establishes that the deployed ABI has no paired second event to match against — that pairing is
   a v4-only design. The corrected, buildable-today check is **emitter authentication alone**: is
   this `SettlementReceipt` from an address on the pinned allow-list of registered hook addresses,
   the same test `docs/unica-v4/EVENT-SCHEMA.md` §2 states is the general UNICA rule ("a consumer
   accepts... a `SettlementReceipt` only when `log.address == registry.getMarket(marketId).hook`"),
   applied here without a registry because none is deployed yet — the allow-list is a pinned
   constant of the two known-good addresses in §1 of `PRIZE-FIT.md`, documented as such rather than
   presented as a v4 registry lookup.

   **Correction, evidence-driven: the allow-list check is vacuous against the subgraph alone.**
   `integrations/graph/subgraph.yaml` pins its two data sources to exactly these same two
   addresses, so every `Settlement` entity the subgraph can ever return already has `hook` on the
   allow-list — comparing it against the allow-list proves nothing, and a `SettlementReceipt`-shaped
   log from any other address is never indexed at all, so the subgraph alone can answer VERIFIED or
   "not found," never REFUSED. Producing a live REFUSED verdict for an address the subgraph does not
   index requires a second, independent live read alongside the subgraph query: an `eth_getLogs`
   call against the same Sepolia JSON-RPC endpoint for the order id's transaction hash, checked
   against the same allow-list, consulted only when the subgraph itself reports no match. This keeps
   a REFUSED verdict grounded in live chain data rather than in a subgraph result, without changing
   the subgraph's own scope or publishing anything new to it. It only fires, honestly, if a
   non-allowlisted emitter is actually found live on Sepolia during the event — UNICA does not
   broadcast one itself; step 4's "never broadcast" rule still holds. See §6 and step 8 below for
   what this does and does not make demonstrable to a judge within the event window.
4. **Add an adversarial look-alike fixture, in local tests only, never broadcast.** Kept as given.
   A locally deployed or locally simulated hook that emits a `SettlementReceipt`-shaped log from an
   address not on the allow-list, exercised only in test infrastructure, exactly as the research
   brief's rules require ("never deploy or publish a subgraph... never deploy or broadcast").
5. **Expose one GraphQL verification query** returning VERIFIED / REFUSED / UNKNOWN with reason
   codes and provenance (the block number and the queried entity's id). Kept as given.
6. **Wrap it in one MCP tool, `unica_verify_receipt`.** Kept as given.
7. **Add ENS provenance only after verification works.** Kept as given, and narrowed: given §4's
   decision not to build a new NFT-provenance feature, "ENS provenance" here means resolving the
   receipt's `recipient` address through the already-built `integrations/ensv2/` module
   (`docs/SPONSOR-ELIGIBILITY.md` §4) to show a merchant name beside the verdict — reusing existing,
   already-live ENSv2 code rather than building anything new for this stream.
8. **Build one judge-facing screen, corrected in scope.** The brief's order calls for a legitimate
   and a look-alike receipt shown side by side. Per step 3's correction and §6: the legitimate
   (VERIFIED) case and an endpoint-disabled or indexer-lag (UNKNOWN) case are shown live, each with
   the queried block and the subgraph's own `_meta` block, exactly as the brief intends — this half
   of the screen is fully load-bearing on the live subgraph. The look-alike case is shown as a
   second, clearly labeled panel: the reason-code layer's own test-suite output against the step-4
   local fixture, captioned as a local logic test, not a live query result — so the screen never
   presents a mocked or local-only dataset as if it were the live, load-bearing query the prize
   track requires. If the `eth_getLogs` fallback in step 3 ever catches a genuinely live
   non-allowlisted emitter during the event, that live REFUSED case replaces the labeled fixture
   panel; it is not assumed to arrive on schedule.
9. **Measure failure behaviour**: the endpoint disabled, and under simulated lag and reorg. Kept
   as given; see §6 for what "simulated" can honestly mean without a second live chain.
10. **Only then consider more chains** — kept as given, and, per §4, deferred past this event
    rather than merely sequenced last within it.

## 6. Failure-mode measurement plan

PROPOSED, expanding step 9. Each row must produce UNKNOWN, never a fabricated VERIFIED, and each
must be a stated negative ("N requests, 0 false-VERIFIED") rather than a blank pass, per the
project's own rule that clean output is the least trustworthy output.

| Condition | How it is produced, honestly | Required verdict |
|---|---|---|
| Endpoint disabled | Point the query at an unreachable or invalid subgraph URL | UNKNOWN, reason "endpoint unreachable" |
| Indexer lag | Query a block range ahead of the subgraph's last-indexed block (`_meta.block.number`) | UNKNOWN, reason "not yet indexed," with the lag shown, not hidden |
| Reorg | **UNKNOWN whether this can be produced honestly on public Sepolia within the event window.** A real reorg cannot be scheduled; simulating one requires either a local fork whose canonical chain is deliberately rewritten after indexing, or relying on the subgraph's own reorg-handling being exercised by chance. Recorded here as an open build risk rather than assumed solvable — do not claim a reorg row exists until one has actually been produced and observed, per the project's rule to validate the instrument before trusting the reading. |
| Look-alike receipt | The step-4 fixture, run locally, never broadcast — this proves the reason-code layer's own REFUSED logic in a test, not in a live query | REFUSED, in the test suite's own output; **not a live verdict** — see the note below |

**Note on the look-alike row, corrected.** Per step 3's finding, the live subgraph as currently
scoped cannot itself produce a REFUSED verdict — `integrations/graph/subgraph.yaml`'s two data
sources only ever index the two allow-listed addresses, so the allow-list check against subgraph
data is vacuous and a non-allowlisted emitter's log is never indexed. Only the `eth_getLogs`
fallback in step 3 can produce a live REFUSED verdict, and only if a genuinely non-allowlisted
emitter appears live on Sepolia during the event — not something this plan can schedule or
manufacture without breaking the "never broadcast" rule. Until that happens, or until it doesn't,
the REFUSED branch is proven the honest way available today: as test-suite output against the
local fixture, shown to a judge captioned as a logic test, not presented as a live query result
(step 8). `PRIZE-FIT.md` §7 item 1 is corrected to match.

## 7. Cut lines and overreach guards

PROPOSED. Stated once here so they do not have to be re-derived from the research brief mid-build:
never deploy or publish a subgraph; never deploy or modify application or contract code as part of
this research stream; the adversarial fixture is local-tests-only and is never broadcast to any
chain; the MCP tool never signs, broadcasts, or spends — it answers a question and nothing else;
no v4 contract is described as live; a demo that cannot fit inside the 2–4 minute cap
(`PRIZE-FIT.md` §11.5) is cut to the verdict-and-screen core (fallback 1, §4) rather than rushed.

## 8. Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ETHOnline 2026 prizes page | https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 | ETHGlobal | OFFICIAL | §1, §7 — demo video length, event date range |
| `docs/unica-v5/graph/PRIZE-FIT.md` (this stream) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | throughout — the eligibility and infrastructure findings this plan builds on |
| `docs/unica-v4/EVENT-SCHEMA.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §5 step 3, §7 — the v4-only pairing design and the emitter-authentication rule reused here |
| `docs/unica-v4/arc/X402.md` (this repository) | n/a — local file, primary sources: github.com/x402-foundation/x402, docs.x402.org, docs.cdp.coinbase.com/x402 | 2026-09-11 | UNICA / NFTeria, citing x402 Foundation / Coinbase | TEAM GUIDANCE citing OFFICIAL | §3, §4 — grading demo E |
| `docs/SPONSOR-ELIGIBILITY.md` (this repository) | n/a — local file | 2026-09-05, updated 2026-09-09 | UNICA / NFTeria | TEAM GUIDANCE | §4, §5 step 7 — existing live ENSv2 module reused rather than rebuilt |

## 9. Unknowns

1. Whether a reorg can be honestly produced and observed against public Sepolia, or a local fork,
   inside the remaining event window — not resolved by this file; see §6.
2. Whether the owner will grant G0 for any part of UNICA v4 before 2026-09-16, which would change
   whether the v4-dependent path in `PRIZE-FIT.md` §7 becomes reachable this event — an owner
   decision, not a fact this research can settle.
3. Whether four minutes of demo video is enough to show the verdict, the MCP tool, the
   side-by-side screen, and one failure-mode row credibly — not tested against an actual cut of
   the video, which does not yet exist.
4. Whether an agent-loop harness (demo B) can be built and rehearsed reliably enough by the demo
   date to justify its Medium-High rather than High reliability score in §3 — this is a schedule
   risk, not a technical unknown, and it is the reason fallback 1 exists.
5. Whether a genuinely non-allowlisted `SettlementReceipt`-shaped emitter will appear live on
   Sepolia during the remaining event window, making a live REFUSED verdict reachable through the
   step-3 `eth_getLogs` fallback — not something this plan can schedule or manufacture without
   breaking the "never broadcast" rule (§5 step 3, §6); until or unless one appears, the
   judge-facing REFUSED case stays a labeled local-fixture test, not a live query result.
