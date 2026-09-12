# UNICA v5 — The Graph: owner decisions

Research draft for owner review. Not committed. Authorizes nothing. UNICA v5 scope; it does not
change or delay the UNICA v4 specification or its merge gate. Retrieval date for every citation is
2026-09-11 unless the cited document states otherwise.

Every owner decision surfaced anywhere in `docs/unica-v5/graph/` is collected here once, numbered
G1–G25, deduplicated where two documents raised the same fork. Blocking items (G1–G5, affecting what
ships before the ETHOnline 2026 window closes) come first; the rest are v5 design forks with no
near-term deadline. Each block is self-contained — copy one block to answer it. Every UNKNOWN in the
source documents that requires a **written answer from The Graph itself**, rather than an owner
ruling, lives in `MENTOR-QUESTIONS.md`, not here.

---

## Blocking (affect this event's submission)

```
G1. PRIMARY DEMO COMMITMENT
Decision: which candidate demo to build for the ETHOnline 2026 submission.
Options:
  (a) Demo B — agent refusal through MCP, built on Demo A as its foundation. (Recommended)
  (b) Demo A alone — the verified settlement explorer, no agent loop.
  (c) Demo E — the x402 evidence gate.
  (d) Demo C or D (ENS-identity-NFT provenance; cross-chain dashboard) — not recommended by
      DEMO-PLAN.md §4; no design exists for C, and D needs network support this event does not have.
Recommended: (a). Wins on sponsor relevance and security value; degrades cleanly to Fallback 1
(Demo A) if the agent-loop harness proves unreliable close to the demo date.
Source: DEMO-PLAN.md §3, §4.
```

```
G2. WHETHER TO PURSUE A SECOND GRAPH PRIZE TRACK THIS EVENT
Decision: whether to spend build time targeting "Best Use of Composable or Standardized Graph
Products" in addition to the AI-Tooling track, given its eligibility turns on unresolved wording.
Options:
  (a) Pursue Track 2 (AI Tooling, From Scratch) only this event; treat Track 1 as a stretch goal
      contingent on a written answer to MENTOR-QUESTIONS.md Q2. (Recommended)
  (b) Build toward both tracks now, accepting the risk that a hand-rolled query plus a custom MCP
      tool is judged "querying one Subgraph" and disqualified from Track 1.
Recommended: (a). The page's own text is genuinely ambiguous on whether routing through The Graph's
official Subgraph MCP converts one bespoke subgraph into "composing two Graph products," and building
against the wrong reading wastes a partner-prize slot (see G3).
Source: PRIZE-FIT.md §3, §5, §11.3; MENTOR-QUESTIONS.md Q2.
```

```
G3. PARTNER-PRIZE SLOT ALLOCATION
Decision: which of {Uniswap, ENSv2, The Graph (potentially two tracks), Arc} to select, given
ETHGlobal's stated ceiling of up to 3 partner prizes per submission.
Options:
  (a) Keep the three already-committed integrations (Uniswap, ENSv2, The Graph) and treat any
      Arc/x402 content as bonus material carrying no separate slot claim. (Recommended)
  (b) Drop one of the three existing commitments to make room for a fourth.
  (c) Submit Arc/x402 as a genuinely separate slot, accepting the loss of one of the other three.
Recommended: (a). No document in this directory finds a reason to reopen the existing three-slot
commitment, and DEMO-PLAN.md's own fallback ranking already treats the x402 demo as a fallback, not a
co-primary, for exactly this reason.
Source: PRIZE-FIT.md §11.1.
```

```
G4. ONE PROJECT OR TWO, FOR THE SAME GRAPH PRIZE POOL
Decision: how to present the existing treasury-copilot candidate (integrations/graph-v2/copilot.mjs,
already disclosed in docs/SPONSOR-ELIGIBILITY.md) alongside the new MCP verification-tool design in
this directory, both aimed at the same From-Scratch AI-tooling pool.
Options:
  (a) Submit as one project with one narrative, explicitly naming both artifacts as parts of the same
      From-Scratch Graph submission. (Recommended)
  (b) Submit only the new MCP verification tool and omit the treasury copilot from this track's
      narrative entirely.
  (c) Ask ETHGlobal/Graph in advance which framing they will accept, before finalizing either.
Recommended: (a), pending a written answer to MENTOR-QUESTIONS.md Q6's residual question (whether two
feature branches from one repository, one event, are judged as one project or as competing
submissions). No source found treats this negatively, and folding both into one narrative is the more
complete demonstration of the load-bearing claim.
Source: PRIZE-FIT.md §11.2; MENTOR-QUESTIONS.md Q6.
```

```
G5. WHETHER TO AUTHORIZE UNICA v4 IMPLEMENTATION WORK BEFORE THE 2026-09-13 DEADLINE
Decision: whether to grant authorization for UnicaMarketRegistry/Factory/Hook/Executor
implementation, unlocking the v4-dependent path (true hook-to-executor pairing, registry-based
emitter authentication, the full v4 subgraph) before the event window closes.
Options:
  (a) No — scope the submission to the buildable-today path (the live V1/V3 subgraph plus a pinned
      two-address allowlist). (Recommended)
  (b) Yes — authorize a compressed v4 implementation-and-deploy sequence this week.
Recommended: (a). PRIZE-FIT.md §7 states plainly that the v4-dependent path is "a multi-day sequence
with its own gates, not a same-week addition to a Graph submission," and the buildable-today path
already demonstrates the load-bearing, fail-closed, emitter-authentication story the prize rewards.
Source: PRIZE-FIT.md §7; DEMO-PLAN.md §5 step 1, §9 item 2.
```

---

## Settlement-schema design forks (no near-term deadline)

```
G6. WHICH REGISTRY ADDRESS(ES) A GIVEN CHAIN'S DEPLOYMENT TRUSTS
Decision: how a deployment records which registry address is canonical for a chain.
Options:
  (a) One canonical registry address per chain, pinned in DeploymentManifest, reviewed before any
      indexer is configured against it, never inferred from a log or accepted from runtime input.
      (Recommended)
  (b) Allow multiple trusted registries per chain (e.g., across releases) recorded as a list.
Recommended: (a) as the default; extend to (b) only if a genuine multi-registry-per-chain need
arises, since every later link in the authentication chain depends on this being unambiguous.
Source: SETTLEMENT-SCHEMA.md §5 link 1, §7 ("attacker factory" row), §11 item 1.
```

```
G7. POOL/LIQUIDITYSEED POOLMANAGER-INDEXING DIVERGENCE
Decision: whether to index the shared Uniswap v4 PoolManager's own Swap/ModifyLiquidity/
ProtocolFee* logs to build a richer Pool entity, reversing EVENT-SCHEMA.md §10.2's existing "not
indexed" decision.
Options:
  (a) Keep EVENT-SCHEMA.md §10.2's existing plan: do not index PoolManager logs; leave live pool
      mechanics to RPC/StateView; keep Pool limited to fields already visible through Market.
      (Recommended)
  (b) Build the fuller Pool entity, accepting far higher indexing volume (PoolManager is shared by
      every pool on the chain, not only UNICA's) and the extra authentication burden of checking
      `marketIdOfPool` on every raw log before treating it as UNICA's.
Recommended: (a). No new capability in (b) is needed for any demo or v5 feature currently scoped, and
it reverses an existing, deliberate specification decision.
Source: SETTLEMENT-SCHEMA.md §4.6, §4.18, §11 item 2.
```

```
G8. OPTIONAL TRANSFER-LOG BALANCE CROSS-CHECK
Decision: whether to require an independent Transfer-log balance cross-check as a mandatory
Anomaly-producing check, beyond the paired HookReceipt/ExecutorReceipt match.
Options:
  (a) Leave it optional — an Anomaly kind a v5 implementation may add as defense-in-depth, never a
      required field on Settlement. (Recommended)
  (b) Make it mandatory for every indexed Settlement.
Recommended: (a). The paired-receipt match is already specification-sufficient (SC §9.1 step 5's
on-chain balance check runs before Settled can be emitted); the cross-check adds value only against a
contract that diverges from its own specification, a narrower and rarer risk than the pairing already
covers.
Source: SETTLEMENT-SCHEMA.md §8, §11 item 3.
```

```
G9. FINALITY / CONFIRMATION-DEPTH POLICY
Decision: what confirmation depth to require before labelling a Settlement final, per chain.
Options:
  (a) The chain's own safe/finalized RPC tag where the chain's RPC implements it; Graph Node's
      ETHEREUM_REORG_THRESHOLD default (250 blocks) elsewhere; recorded per network on
      DeploymentManifest/EvidenceStatus, never hardcoded once for every chain. (Recommended)
  (b) A single fixed confirmation-count number applied uniformly across every chain.
Recommended: (a). No UNICA source fixes a number today, and per-chain RPC tag support has not been
probed (AI-MCP-TOOLS.md §15 lists this as UNKNOWN) — recording the choice per network rather than
guessing one number avoids either an unsafe assumption on a fast chain or needless latency on a slow
one.
Source: SETTLEMENT-SCHEMA.md §5 link 10, §6, §11 item 4; AI-MCP-TOOLS.md §15.
```

```
G10. WHETHER TO BUILD TokenImplementationObservation FOR A NO-REAL-VALUE BETA
Decision: whether the proxy/beacon implementation-drift watcher entity is worth building now.
Options:
  (a) Defer until a real-value token is accepted by UNICA. (Recommended)
  (b) Build it now, ahead of any real-value token, as defense-in-depth from day one.
Recommended: (a). SPEC-CONTRACTS.md's own threat-model lines (A7, A8) name this risk against a
beacon owner who can upgrade or pause a stock token — a real risk only once real value is at stake;
building it now spends effort a demonstration-only beta does not need yet.
Source: SETTLEMENT-SCHEMA.md §4.24, §11 item 5.
```

```
G11. indexerHints: prune — never vs. auto
Decision: whether the v4/v5 subgraph manifest sets `indexerHints: prune: never` (full history depth,
higher storage) or `auto` (indexer-managed pruning, better performance/storage).
Options:
  (a) `never` — since this subgraph's purpose is evidence and reconciliation history, a merchant's
      full settlement history should always be queryable. (Recommended)
  (b) `auto` — trade historical query depth for indexing performance and storage cost.
Recommended: (a), consistent with the reconciliation and auditability differentiator this design
leans on; revisit only if storage cost becomes a real constraint at Scenario B/C volume.
Source: SETTLEMENT-SCHEMA.md §6, §11 item 6.
```

```
G12. TIMING OF THE CHAIN-SCOPED ID MIGRATION
Decision: when to prefix every bare-address or bare-on-chain-hash id (marketId, orderId, a token
address) with `network ++` or `chainId ++`, matching integrations/graph-v2's existing Deployment
pattern.
Options:
  (a) Perform the migration before UNICA v5 ever indexes a second chain in one deployment — not
      after, and not preemptively for a single-chain beta. (Recommended)
  (b) Perform it now, ahead of any second-chain need.
Recommended: (a). The v4 beta plan is single-chain; adding composite-key overhead now serves no
present need and can be done cleanly at the moment a second chain is actually configured.
Source: SETTLEMENT-SCHEMA.md §9, §11 item 7; SCALABILITY.md §5.
```

```
G13. WHETHER Factory IS ITS OWN ENTITY
Decision: whether to model the UnicaMarketFactory contract as its own subgraph entity, given it
emits no events of its own.
Options:
  (a) Fold its three immutable fields (poolManager, hookCreationCodeHash) directly onto
      Registry/ProtocolRelease; no standalone Factory entity. (Recommended)
  (b) Build a standalone Factory entity, seeded the same way as ProtocolRelease, useful only for a
      future design that wants to record off-chain-initiated `previewMarket` calls.
Recommended: (a). No event-driven reason exists to give an event-less contract its own entity type;
(b) is recorded as the alternative for the owner to choose, not adopted as a default.
Source: SETTLEMENT-SCHEMA.md §4.3, §11 item 8.
```

---

## ENS / art-layer design forks

```
G14. ARTSEED HASHING INPUT: NAME STRING OR NAMEHASH
Decision: whether the future namemath/logobackground successor hashes the normalized name string
(the legacy contract's own choice) or the ENSIP-1 namehash, for ArtSeed's seed value.
Options:
  (a) Keep the legacy contract's own choice — hash the normalized name string (bounded String[64]),
      preserving a length-bound constraint for very long merchant.parent names.
  (b) Switch to hashing the namehash instead, removing the length-bound constraint.
Recommended: not resolved here — docs/unica-v4/ENS-ART-LAYER.md §3.3 does not specify which encoding
"normalized_ens_name" means, so this decision belongs with whoever implements the versioned
successor module, informed by whichever constraint (a length bound vs. none) is preferred at that
time.
Source: ENS-NFT-SCHEMA.md §4.1, §9 item 2.
```

```
G15. NORMALIZER STRICTNESS: ASCII-CONSERVATIVE vs. FULL ENSIP-15
Decision: whether to accept this repository's conservative ASCII-only name normalizer as "safe by
refusal" relative to full ENSIP-15, or require full ENSIP-15 implementation before the art layer (or
any ENS-identity feature) reads any name.
Options:
  (a) Accept safe-by-refusal for the beta: any name this repository accepts today normalizes
      identically under both schemes; a name ENSIP-15 would accept but this repository refuses never
      reaches the art layer at all. (Recommended for beta)
  (b) Require full ENSIP-15 confusable/homograph detection before any name-keyed feature ships,
      including against ENSIP-15's own published validation test vectors (not yet run against this
      repository's normalizer).
Recommended: (a) for the beta; revisit before any release that accepts non-ASCII merchant names or
moves real value, since the safety argument has not been tested against ENSIP-15's own test vectors.
Source: ENS-NFT-SCHEMA.md §4.1, §9 item 1.
```

```
G16. THE SettlementMerchant NON-ENTITY
Decision: whether to accept ENS-NFT-SCHEMA.md's recommendation not to materialize a
`SettlementMerchant` subgraph entity (the task's original candidate name), in favor of
`MerchantIdentity` + `IdentityBindingObservation` plus a live client-side reproduction of
`preflight()`'s verdict.
Options:
  (a) Accept the non-entity design — a `SettlementMerchant` entity would overclaim what a subgraph
      can hold, since `preflight()`'s inputs include a caller-supplied clock time and a private
      commitment opening a subgraph structurally cannot have. (Recommended)
  (b) Require a `SettlementMerchant`-named entity anyway, accepting that it can only ever be a
      partial, potentially misleading proxy for the real verdict.
Recommended: (a). Naming an entity "the accepted settlement configuration" when it cannot actually
hold the fields that make a configuration accepted is exactly the overclaiming failure mode the
identity/settlement boundary exists to prevent.
Source: ENS-NFT-SCHEMA.md §5, §9.
```

```
G17. ERC-721 ART TOKEN: VENDOR SNEKMATE OR WRITE FROM SCRATCH
Decision: whether the eventual identity/art ERC-721 token vendors snekmate (AGPL-3.0, requiring
licence disclosure) or is written from scratch (MIT, consistent with this repository's own licence
and "never copy" rule).
Options:
  (a) Write from scratch, MIT-licensed, consistent with the repository's stated posture. (Recommended)
  (b) Vendor snekmate, disclosed by name, accepting the AGPL-3.0 obligation on that vendored portion.
Recommended: (a), for consistency with this repository's own from-scratch, MIT, no-copy stance
already stated in CLAUDE.md; this decision is already flagged open in docs/unica-v4/ENS-ART-LAYER.md
§7 and is restated here because ENS-NFT-SCHEMA.md's `IdentityNFT`/`RendererDeployment` design depends
on it before it can be finalized against a real ABI.
Source: ENS-NFT-SCHEMA.md §9 item 3, citing docs/unica-v4/ENS-ART-LAYER.md §7.
```

---

## Evidence-toolkit and x402 forks

```
G18. WHETHER TO BUILD THE FULL SDK/CLI/MCP TOOLKIT NOW
Decision: whether to build the nine-tool evidence toolkit as designed before UNICA v4 contracts
exist, given eight of nine tools are undeployable until then.
Options:
  (a) Scope the event build to `unica_verify_receipt` against the live V1/V3 subgraph; keep the
      remaining eight tools as forward design in AI-MCP-TOOLS.md, not implemented this event.
      (Recommended)
  (b) Build the full SDK/CLI/MCP surface now, with eight of nine tools returning UNKNOWN or a
      placeholder until v4 ships.
Recommended: (a), directly consistent with G5's recommendation not to authorize v4 implementation
work this week — building eight undeployable tools would demonstrate design completeness but no live
behavior a judge can exercise.
Source: AI-MCP-TOOLS.md §16 item 1, §7 preamble.
```

```
G19. WHETHER TO BUILD A UNICA-AUTHORED X402 GASLESS WRAPPER AT ALL
Decision: whether UNICA should build the hypothetical x402-fronted `pay()` wrapper analyzed in
X402-EVIDENCE.md §3–§4.
Options:
  (a) No — not until UNICA specifically wants to support payers who hold no gas; v4's unwrapped
      `pay(orderId)` already avoids Security Advisory 001's specific defect by construction, so a
      wrapper is a product decision, not a security requirement. (Recommended)
  (b) Build it now, ahead of any specific gasless-payer product need.
Recommended: (a). Building a wrapper before it is needed only creates a new, UNICA-specific attack
surface (the orderId-binding requirement in X402-EVIDENCE.md §4's crux row) with no corresponding
product benefit yet.
Source: X402-EVIDENCE.md §13 item 2.
```

```
G20. WHETHER THE PRE-X402 EVIDENCE CHECK SEQUENCE IS MANDATORY IN A CLIENT LIBRARY
Decision: whether any future UNICA-provided x402 client library must run the §5/§6 live-RPC check
sequence before requesting a PAYMENT-SIGNATURE, or may offer it as a skippable optional import.
Options:
  (a) Mandatory — skipping it does not create an on-chain vulnerability (v4's own guards hold either
      way) but does reintroduce the wasted-nonce and decoupled-reconciliation risks named in
      X402-EVIDENCE.md §11, with no offsetting benefit to making it optional. (Recommended)
  (b) Optional, left to the integrator's judgment.
Recommended: (a).
Source: X402-EVIDENCE.md §13 item 3.
```

---

## Scalability and operations forks

```
G21. PER-MERCHANT AGGREGATE VISIBILITY
Decision: whether a per-merchant daily/hourly volume aggregate (once built, per SCALABILITY.md §3)
should be gated behind the merchant's own consent, or accepted as a disclosed, public property of a
public read layer.
Options:
  (a) Disclose plainly in documentation and UI copy that per-merchant volume trends are one public
      GraphQL query away, without a consent gate — consistent with the underlying data already being
      on-chain and public. (Recommended, with mandatory disclosure)
  (b) Gate per-merchant aggregation fields behind the merchant's own opt-in consent.
Recommended: (a), because the underlying transactions are already public; but note the aggregate
genuinely changes the *cost of discovery* from scanning logs to one query, so the disclosure itself
is the mandatory part of this recommendation, not optional polish.
Source: SCALABILITY.md §7.
```

```
G22. RETENTION AND ARCHIVAL POLICY
Decision: whether to keep every raw Settlement/Order row forever (both existing schemas' current
default) or adopt a rolling-window-plus-aggregation approach.
Options:
  (a) Adopt native timeseries/aggregation entities (specVersion 1.1.0+) starting at Scenario B
      volume (1,000 merchants / 1,000,000 settlements per day); keep full raw retention at Scenario A.
      (Recommended)
  (b) Keep unbounded raw retention indefinitely regardless of scale, per both existing schemas'
      current default.
Recommended: (a) — SCALABILITY.md §8 calls this "the single highest-leverage recommendation" in that
document, addressing the hot-entity, pagination-cost, and query-cost problems together.
Source: SCALABILITY.md §3, §7, §8.
```

```
G23. WHETHER TO INVEST IN SUBSTREAMS FOR ROBINHOOD CHAIN (46630) NOW
Decision: whether to build a Substreams pipeline (via Pinax's registered endpoint) for 46630 now, or
keep the already-specified bounded RPC event indexer as the only history mechanism for that chain.
Options:
  (a) Keep the bounded RPC event indexer (EVENT-SCHEMA.md §10.3) for now; a single rehearsal
      testnet's bounded event set does not justify the Rust/WASM authoring cost of a Substreams
      package. (Recommended)
  (b) Build the Substreams pipeline now, since it is the only Graph-ecosystem path this chain has at
      all.
Recommended: (a) for the near term; revisit if 46630 volume or a specific prize angle (the
Substreams-challenge track) makes the investment worthwhile.
Source: PEER-PATTERNS.md §3.5, §3.12; NETWORK-OPTIONS.md §7; SCALABILITY.md §8.
```

```
G24. WHETHER TO EVER SELF-HOST graph-node
Decision: whether to stand up a self-hosted graph-node to remove the Subgraph Studio account
dependency entirely.
Options:
  (a) Do not — this is new, standing infrastructure UNICA would operate indefinitely, out of scope
      for a research/design stream to recommend as a default path. Record it as an available option
      only. (Recommended)
  (b) Stand one up, accepting the operational burden (a database, a synced or RPC-accessible chain
      node, monitoring, patching) in exchange for removing the Studio dependency.
Recommended: (a). No document in this directory finds a reason this event or this design set needs
it; it remains an owner-level infrastructure decision, not a design gap.
Source: PEER-PATTERNS.md §3.11; NETWORK-OPTIONS.md §3.7.
```

```
G25. ONE MCP SERVER, OR TWO
Decision: whether to build a separate MCP server wrapping integrations/graph-v2/provider.mjs
directly, independent of the AI-MCP-TOOLS.md evidence-toolkit design.
Options:
  (a) Fold provider.mjs's freshness/refusal discipline into the single AI-MCP-TOOLS.md toolkit design
      rather than building a second, separate MCP server with its own rules. (Recommended)
  (b) Build a second, standalone MCP server specifically for the V2/graph-v2 data path.
Recommended: (a). ARCHITECTURE.md's own rule ("one shared validation layer... a rule fixed once here
is fixed everywhere it is consumed") argues directly against a second, separately-maintained ruleset
for the same class of freshness/refusal decision.
Source: PEER-PATTERNS.md §3.1, §3.3.
```
