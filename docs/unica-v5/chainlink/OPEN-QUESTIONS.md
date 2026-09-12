# UNICA v5 / Chainlink — open questions for the owner

Research draft for owner review. Not committed. Authorizes nothing. Every item below is an owner
decision this synthesis surfaces rather than resolves — none is settled by anything in
`docs/unica-v5/chainlink/`. Copy-paste block, blocking items first (C1–C3), each with its options, a
recommended default marked (Recommended), and the section of `README.md` or its companion files the
recommendation is drawn from.

1. **(C1, blocking) Reconsider the 2026-09-09 NOT SELECTED status for Chainlink?**
   Options: (a) Keep NOT SELECTED — Chainlink stays out of the submitted integration set. (b)
   Reconsider it now, given the prize page's own wording naming CLI simulation as sufficient
   evidence in its own right, not only a fallback beneath live deployment. (c) Reconsider only after
   C2 (the slot ceiling) is resolved in Chainlink's favor.
   **(a) Keep NOT SELECTED, pending C2 — Recommended.** The runway from today is roughly two days,
   the partner-prize slot question (C2) is unresolved, and the "not placeholder code" tension (C4)
   is a real, unresolved risk even under the more permissive reading.
   Source: README.md Part 2, Part 9; PRIZE-FIT.md §5, §11.1, §14; `docs/SPONSOR-ELIGIBILITY.md`.

2. **(C2, blocking) Which sponsor commitments stay within ETHGlobal's "up to 3 Partner Prizes"
   ceiling if Chainlink is added?**
   Options: (a) Keep Uniswap v4, ENSv2, and The Graph only; do not add Chainlink. (b) Drop one
   already-submitted sponsor to make room for a Chainlink Confidential Workflow submission. (c) Add
   Chainlink as a fourth (or, with the Liquidation Protection Challenge, effectively fifth) named
   commitment and accept the ceiling risk pending ETHGlobal's own clarification.
   **(a) Keep the existing three — Recommended.** The "a partner's multiple tracks count once"
   reading that would soften this ceiling is sourced only via search-engine summaries, never a
   directly quoted primary sentence for this specific event.
   Source: README.md Part 9; PRIZE-FIT.md §3, §11.1, §14 item 5.

3. **(C3, blocking) Pursue the Automated Liquidation Protection Challenge at all?**
   Options: (a) No — out of scope this event. (b) Yes — pursue it as a separate submission alongside
   the Confidential Workflow track. (c) Defer past this event entirely.
   **(a) No — Recommended.** The challenge's own join step is a broadcast transaction outside this
   research's read-only scope, its subject matter (a virtual collateral/debt position) is new work
   this repository has not built, and the runway does not support a same-week addition of that size.
   Source: README.md Part 9; PRIZE-FIT.md §2c, §7, §11.7; PRODUCT-FIT.md §1.1; DEMO-PLAN.md §3.

4. **Submit an explicitly advisory-only Confidential Workflow at all, given the "not placeholder
   code" tension?**
   Options: (a) Submit with plain disclosure of the advisory-only design, resting on Chainlink's own
   lower "meaningful, not placeholder" bar rather than other sponsors' stricter "central, not
   cosmetic" standard. (b) Do not submit under this track. (c) Reframe as part of a larger, openly
   deferred v5 admission-layer narrative rather than a standalone Track A claim.
   **(a) Submit with plain disclosure, if C1/C2 clear — Recommended.** The guardian workflow's real
   treasury-policy computation plausibly clears Chainlink's own stated bar even though it does not
   clear the stricter bar other sponsors publish.
   Source: README.md Part 2; PEER-COMPARISON.md §3.11, §7; PRIZE-FIT.md §6, §11.3.

5. **Build the optional order-admission layer (the Confidential Workflow thesis) at all?**
   Options: (a) Build only for a platform mediating between mutually non-trusting merchants — the
   one case the design's trust model actually improves on. (b) Do not build; a conventional
   access-controlled backend already gives a single merchant the same confidentiality without the
   enrollment, HTTP-quota, and single-region costs. (c) Build a minimal version now regardless, as
   demo material only.
   **(b) Do not build — Recommended.** No UNICA-side platform role needing mutual distrust between
   merchants exists in any committed document today.
   Source: README.md Part 2; CONFIDENTIAL-COMMERCE.md §10, §12.

6. **Ship the minimal build sequence this event?**
   Options: (a) Yes — wire the existing decision logic into a real workflow entry point, run the CRE
   CLI's local simulator, and record the run. (b) No — leave the Chainlink work at its current state.
   (c) Yes, and also build the proposed attack-demonstration receiver pair against
   `MockKeystoneForwarder` (README.md Part 7).
   **(a) Yes, as the buildable floor — Recommended; (c) as an optional stretch if time allows.**
   Source: README.md Part 6, Part 7, Part 8; DEMO-PLAN.md §6–§7; SIMULATION-VS-DON.md §3.

7. **How should the workflow's off-chain `orderNonce` relate to the executor's on-chain `createOrder`
   salt/`orderId`?**
   Options: (a) Leave unresolved this event; do not wire the two together. (b) Define a mapping now
   and fold it into `REPORT-SCHEMA.md` as a follow-up revision. (c) Keep the admission record
   (`RECEIVER.md` §6) as the only binding mechanism, and never let a workflow's `orderNonce` become
   or derive a settlement-facing value directly.
   **(c) Keep the admission record as the sole binding mechanism — Recommended.** Resolving the seam
   the wrong way risks reopening an Advisory-001-shaped gap.
   Source: README.md Part 3; CONFIDENTIAL-COMMERCE.md §12; RECEIVER.md §6; REPORT-SCHEMA.md §4 row 14.

8. **`ensDeploymentId`'s concrete type and derivation.**
   Options: (a) Wait for the ENS sibling stream's own identity document to fix its encoding, then
   adopt it unchanged. (b) Propose a placeholder encoding from this stream now. (c) Drop the field
   until a concrete need is demonstrated.
   **(a) Wait for the ENS stream — Recommended.** `REPORT-SCHEMA.md` §4 row 19 already defers to
   that document by design; resolving it here would pre-empt work owned elsewhere.
   Source: README.md Part 3; REPORT-SCHEMA.md §4 row 19, §8 item 2.

9. **`workflowVersion`: Chainlink's own `cre workflow hash` output, or a separate UNICA-side
   counter?**
   Options: (a) Reuse Chainlink's own hash once a live CRE CLI session confirms it is stable and
   reproducible. (b) Use an independent UNICA-side monotonic counter. (c) Carry both fields until one
   is proven sufficient.
   **(a) Reuse Chainlink's own hash, in principle — Recommended, with (b) as the fallback** if a live
   session ever shows the value is not stable outside a controlled run.
   Source: README.md Part 3; REPORT-SCHEMA.md §4 row 24, §8 item 3; SIMULATION-VS-DON.md §4.

10. **May `payer` (`AdmissionReport` field 8) ever legitimately be the zero address in production?**
    Options: (a) No — every admitted order must name a specific payer. (b) Yes, for a narrow class of
    unbound admissions. (c) Leave it structurally permitted but operationally disallowed by policy
    until a concrete need is shown.
    **(c) Structurally permitted, operationally disallowed for now — Recommended**, matching the
    schema's own current, undecided stance.
    Source: README.md Part 3; REPORT-SCHEMA.md §4 row 8, §8 item 1.

11. **Add an explicit schema-version tag byte ahead of the `AdmissionReport`'s ABI-encoded fields,
    and fix its width and position?**
    Options: (a) Yes — a single leading byte, checked before any ABI decode. (b) No tag; rely on
    length checks alone. (c) A wider, multi-byte version field for future extensibility.
    **(a) A single leading byte — Recommended.** The receiver's own check order already assumes such
    a tag exists.
    Source: README.md Part 3, Part 4; REPORT-SCHEMA.md §8 item 5; RECEIVER.md §5 step 6.

12. **How strong a terminal-revocation check should the receiver build, beyond the `policyExpiry`
    time bound?**
    Options: (a) `policyExpiry` alone, accepting the residual window between revocation and expiry —
    the current specification. (b) Add a live ENS read from the receiver itself, accepting the added
    external-call dependency. (c) Require the backend/device role-table disable — already the
    primary gate — to be the sole enforcement point, with the receiver never attempting its own ENS
    read.
    **(c) Backend/device disable as the sole gate — Recommended.** Keeps the receiver self-contained
    and matches the existing design, which already treats a revoked ENS record as discovery-only.
    Source: README.md Part 4; RECEIVER.md §5 step 13, §9 item 1; THREAT-MODEL.md T-CH-16.

13. **What finality/confirmation count should be required, per chain, before treating an admission or
    any CRE delivery as settled?**
    Options: (a) Adopt whatever confirmation count a future UNICA v4 settlement-finality convention
    sets, once one is written. (b) Set a CRE-specific count now, conservatively, ahead of that
    convention. (c) Leave it UNKNOWN and block any production use of this design until it is
    resolved.
    **(c) Leave UNKNOWN and block on it — Recommended.** No source consulted anywhere in this stream
    states a number for any chain evaluated; specifying one now would not be sourced.
    Source: README.md Part 4; RECEIVER.md §7 point 5, §9 item 2; SIMULATION-VS-DON.md §4.

14. **Should a consumed `orderNonce` ever be reclaimable (an unused, expired admission), or must it
    remain permanently consumed?**
    Options: (a) Permanent consumption only — the current specification. (b) Allow reclaim once
    `policyExpiry` passes unused. (c) Allow reclaim only through an admin-gated function.
    **(a) Permanent consumption only — Recommended**, as the simpler, more conservative choice
    already specified.
    Source: README.md Part 4; RECEIVER.md §5 step 14, §9 item 3.

15. **Send the consolidated question list to an identifiable Chainlink team member before committing
    further build time to this track?**
    Options: (a) Yes — send the full list (README.md Part 10) before building further. (b) No —
    proceed on the best available reading of the public pages and accept the residual risk. (c) Send
    only the narrower, load-bearing subset (the pool-restriction question, the on-chain-write
    question, and the prize-total conflict).
    **(a) Send the full list — Recommended**, given the roughly two-day runway and the number of
    unresolved eligibility questions no further public-source research can close.
    Source: README.md Part 10; MENTOR-QUESTIONS.md; PRIZE-FIT.md §12.
