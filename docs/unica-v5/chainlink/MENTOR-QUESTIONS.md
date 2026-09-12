# UNICA v5 / Chainlink — mentor questions, answered from public sources first

These questions are answered here from official sources wherever the sources settle them. Nothing
here is a question sent to a person; each is closed with a citation or left open, marked as needing
written confirmation from an identifiable Chainlink team member, per project rule. Track: **From
Scratch** (owner ruling, 2026-09-11). Retrieval date 2026-09-11 unless stated otherwise. Labels:
VERIFIED (source cited), PROPOSED (UNICA design reasoning), UNKNOWN.

No transcript of any Chainlink channel discussion reached this document. Every claim below is built
from official Chainlink or ETHGlobal documentation, this repository's own prior measurements
(`docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md`, `docs/experimental/
CRE-CONFIDENTIAL-SIMULATOR.md`, `docs/feedback/chainlink.md`), or is marked PROPOSED/UNKNOWN —
nothing here attributes a design choice or a finding to an unavailable discussion.

## Q1. Is "Best Confidential Workflow" open to a From Scratch entry, or does it carry the same Continuity restriction as "Best Chainlink-Powered Upgrade"?

**Answered from the page's own wording: it carries no stated restriction, but no Chainlink team
member has confirmed that silence means eligibility.**

VERIFIED — the dedicated ETHOnline 2026 Chainlink prize subpage
(<https://ethglobal.com/events/ethonline2026/prizes/chainlink>, retrieved 2026-09-11) states, for
"Best Chainlink-Powered Upgrade," "This prize is only available to Continuity Track participants,"
and states no equivalent sentence anywhere in the "Best Confidential Workflow" section. The same
page's requirements for that track are "Build a CRE Workflow that uses the Confidential Workflows
to execute a meaningful part of the application," registering "a confidential TEE handler," and
processing "at least one sensitive input," with the accepted demo format being "either: A
Confidential Workflow simulation using the CRE CLI or a live deployment on the CRE network."

**What this does not settle.** The page's silence on a pool restriction for this one track, next to
an explicit restriction stated for a different track on the same page, is evidence that the two are
treated differently by the page's own author — but it is not itself a sentence granting From Scratch
eligibility, and this document does not treat silence as a grant. `docs/SPONSOR-ELIGIBILITY.md` §2
(2026-09-09, SUPERSEDED note, this repository) separately declined to select Chainlink for a
different reason (execution evidence a judge can see), a reasoning that predates this fetch of the
track's own accepted demo format naming CLI simulation as sufficient. Neither this document nor
`DEMO-PLAN.md` reopens that ledger entry. **Needs written confirmation** that the absence of a
stated pool restriction means From Scratch entries are considered for this specific prize.

## Q2. Does a workflow that reads its sensitive input from CRE secrets (rather than an external API call inside the enclave) satisfy "process at least one sensitive input"?

**Answered from the page's own wording: yes, on the evidence available, but not yet confirmed by a
Chainlink team member.**

VERIFIED — the same subpage's requirement text names no particular source for the sensitive input;
it requires only that "the confidential portion of the workflow must process at least one sensitive
input." VERIFIED, `docs.chain.link/cre/concepts/confidential-workflows` (retrieved 2026-09-11):
secrets "the Vault DON releases into the enclave" are named as one of the two categories of thing a
Confidential Workflow protects (the other being sensitive inputs and intermediate values not
explicitly shared outside the enclave), with no statement that a secret-sourced value counts less
than an API-sourced one for this purpose. This repository's own already-run workflow
(`integrations/chainlink-cre-guardian/`) reads five private policy values from CRE secrets inside
its handler and is the one place this repository's Chainlink work has actually executed under the
real CRE engine (SIM §2–§3); the design in `DEMO-PLAN.md` §4.2 reuses exactly this shape for a
different subject (invoice/merchant policy) rather than inventing an HTTP-based alternative,
because introducing CRE's confidential-HTTP capability where it is not load-bearing would add a
Chainlink product this design does not need. **Needs written confirmation** that a secrets-only
sensitive input satisfies the requirement as fully as an HTTP-fetched one would.

## Q3. Must the workflow's result be delivered on chain (a real write) for the demo to count, or is an off-chain-consumed verdict — read by a backend that then calls an ordinary contract function — an acceptable "meaningful part of the application"?

**Not settled by any source retrieved.**

VERIFIED — the requirement text quoted in Q1 says the Confidential Workflow must "execute a
meaningful part of the application" and separately requires a TEE handler and a sensitive input; it
says nothing about whether the workflow's *output* must reach a chain through a write, versus being
read by an off-chain process that itself later reaches a chain through an ordinary transaction. The
accepted demo format (Q1) offers "a CRE Workflow simulation using the CRE CLI" as one of exactly two
sufficient forms of evidence, and a CLI simulation by its own nature produces no on-chain write at
all (SIM §2 — `cre workflow simulate` makes no chain call). This is read as evidence, not proof,
that an on-chain write is not required for the demo-format bar specifically, since the officially
named "simulation" path structurally cannot include one. **Needs written confirmation** for the
narrower question of whether the workflow's role in the *application* (as opposed to the *demo
format*) is expected to include a write, versus `DEMO-PLAN.md`'s own design in which the workflow's
result is consumed entirely off-chain by a backend that independently recomputes its own terms
before ever calling `createOrder` (§4.2 beat 4).

## Q4. Does a CRE forwarder transaction's own success (status 1) prove the receiver contract's business logic also succeeded?

**Answered, and the answer resolves the assignment's own flagged unverified lead: no.**

VERIFIED, `smartcontractkit/chainlink-evm`,
`contracts/cre/src/v1/KeystoneForwarder.sol` (commit `92897847daa3ba26ac2796ef284f57e6f3d1ca2a`),
retrieved 2026-09-11: the forwarder's report-delivery function calls the receiver through a
low-level call inside inline assembly, which returns a boolean rather than propagating a revert; a
false result is recorded as that specific report's own outcome, the forwarder's own transaction
does not revert because of it, and an event naming the receiver, the workflow execution id, the
report id, and that boolean is emitted regardless of which value the boolean took. VERIFIED,
`docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts`
(retrieved 2026-09-11): the documentation states that a reverting write "can be retried with a
higher gas limit" and that "the receiver is responsible for discarding stale reports" — consistent
with treating transaction inclusion and receiver-level correctness as two separate facts, though
the page does not itself spell out the low-level-call mechanism the source code shows.

**What follows.** A workflow author or an operator watching a CRE-delivered transaction cannot infer
"the receiver accepted this report" from "the forwarder transaction is mined." The correct check is
the per-report success field the forwarder's own event carries, or the receiver's own state for the
specific value expected. `THREAT-MODEL.md` §4.2 T-CH-7 and §4.5 T-CH-18 state this as a design
requirement for anything this stream ever builds. This closes the assignment brief's own flagged
lead with a citation rather than leaving it as an assumption either way.

## Q5. Is the Best Chainlink-Powered Upgrade track's Continuity-only restriction still accurate today, or has it changed since this repository's earlier (2026-09-05) reading?

**Answered: unchanged, reconfirmed with a fresh fetch.**

VERIFIED — `docs/feedback/chainlink.md` (this repository, dated 2026-09-05) already recorded: "the
Upgrade track's own prize is marked Continuity-only in our research, which closes it to a
from-scratch entry." The dedicated Chainlink subpage fetched fresh for this document
(<https://ethglobal.com/events/ethonline2026/prizes/chainlink>, retrieved 2026-09-11) states the
identical restriction verbatim: "This prize is only available to Continuity Track participants."
No change is found between the two readings six days apart. This closes the track to this
repository's From Scratch entry (`docs/PROVENANCE-LEDGER.md`; the owner's 2026-09-11 confirmation
that this is the From Scratch track) regardless of anything else in this document.

## Q6. Is there a published amount for "Best Confidential Workflow" that both pages agree on?

**Yes. Both pages state $2,000 total, up to 2 teams at $1,000 each — no conflict. An earlier
reading of this question mistook the dedicated page's own three-track pool total for a second,
competing figure specific to this track; that reading is withdrawn here.**

VERIFIED, general ETHOnline 2026 prizes page (<https://ethglobal.com/events/ethonline2026/prizes>,
retrieved 2026-09-11): "$2,000 (up to 2 teams receive $1,000 each)." VERIFIED, the dedicated
Chainlink subpage (<https://ethglobal.com/events/ethonline2026/prizes/chainlink>, re-fetched
2026-09-11 to resolve this question): the Best Confidential Workflow section itself states "$2,000"
with "Up to 2 teams will receive $1,000" — identical to the general page. A separate "$3,000" figure
does appear on the dedicated page, but as that page's own stated total Chainlink sponsorship summed
across all three tracks ($2,000 + $500 + $500), not inside the Best Confidential Workflow section
and not a competing amount for it. `PRIZE-FIT.md` §2 (this stream's companion file, two independent
fetches, agreeing) already carried this same reading. **No written confirmation is needed for the
amount itself**; both pages already agree, and this figure is safe to repeat elsewhere in this
stream as settled.

## Q7. Does deploying UNICA's own receiver contract or running a workflow's confidential portion require the separate Confidential Workflows private-beta enrollment, beyond the generic `cre account access` this repository has already submitted?

**Answered: yes for anything beyond local simulation; no for local simulation itself.**

VERIFIED, `docs.chain.link/cre/account/confidential-workflows-access` (retrieved 2026-09-11):
"Confidential Workflows is currently in private beta and is invite-only, separate from the deploy
access required for regular CRE workflows," enrolled through a linked Chainlink-hosted request form
distinct from the CLI's `cre account access` command, and — the operationally important line for
this stream — "After submitting your request, you don't need to wait for early access. Your CRE
organization can run Confidential Workflows using the local simulator." This repository has already
submitted the generic `cre account access` request and it is awaiting review (`docs/feedback/
chainlink.md`); it has **not** submitted the separate Confidential Workflows enrollment form, and
this document does not submit it either, consistent with the READ-ONLY scope of this stream (no
form is filled by this research). Since `DEMO-PLAN.md` §6 recommends shipping the CLI-simulated
slice only, no enrollment beyond what already exists is needed for that recommendation; enrollment
would become relevant only if a live receiver or a hosted confidential workflow were ever pursued,
which this stream does not do.

## Q8. Does Chainlink's own documentation describe any failure or unavailability behavior for the Confidential Workflows infrastructure itself (the TEE, the Vault DON) that a consuming design should plan around?

**Not settled by the page most directly on point.**

VERIFIED, `docs.chain.link/cre/concepts/confidential-workflows` (retrieved 2026-09-11): the page
describes what is protected (secrets released into the enclave; sensitive inputs and intermediate
values not explicitly shared outside it), the boundary-crossing rule (anything needing Workflow DON
consensus, such as a signed report, explicitly crosses back out of the enclave), and the logging
warning, but states nothing about what happens if the TEE infrastructure itself is unreachable, if
the Vault DON cannot release a secret, or if a confidential handler times out. `THREAT-MODEL.md` §5
("CRE unavailable") is therefore written from this repository's own design principle — no
confidential-policy order is issued, nothing already created is altered, and correctness depends on
no off-chain query — rather than from a Chainlink-documented failure mode, because no such
documentation was found. **Needs written confirmation** of what a workflow author should expect (an
error, a timeout, a specific exception) when the confidential-execution path itself is unavailable,
as distinct from a normal handler-level revert.

## Q9. Is the Automated Liquidation Protection Challenge ($500) compatible with also submitting a separate From Scratch Confidential Workflow entry from the same repository, or does joining it draw a Continuity-shaped line around whatever work follows?

**Partially answered; the pool-neutral status is confirmed, the interaction with a second
submission is not.**

VERIFIED — the dedicated Chainlink subpage (retrieved 2026-09-11) states the Challenge is joined
"via smart contract before the submission deadline and is not constrained to either pool." This
repository has already explored the Challenge's own subject (a virtual ETH-collateral/debt
position) through `integrations/chainlink-cre-guardian/` and recorded several findings against the
published challenge contracts (`docs/feedback/chainlink.md`, 2026-09-08 entry) without joining the
challenge on chain — no join transaction has been sent, consistent with this stream's read-only,
no-broadcast scope. Whether entering that specific challenge, or entering `DEMO-PLAN.md`'s own
invoice-policy design for "Best Confidential Workflow," would be read by ETHGlobal or Chainlink as
one project extended twice or as two separate submissions competing for adjacent prizes is the same
open question `docs/unica-v5/graph/MENTOR-QUESTIONS.md` Q6 already raises for a different pair of
tracks in this same repository — restated here because it recurs, not because this document
resolves it differently. **Needs written confirmation.**

## Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ETHOnline 2026 prizes page | https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 | ETHGlobal | OFFICIAL | Q6 — general prize-page amount, agreeing with the dedicated subpage |
| ETHOnline 2026 Chainlink prize subpage | https://ethglobal.com/events/ethonline2026/prizes/chainlink | 2026-09-11, re-fetched same day for Q6 | ETHGlobal | OFFICIAL | Q1, Q2, Q3, Q5, Q6, Q9 — per-track requirement and restriction text; Q6 — the page's own total-pool figure, distinct from the per-track amount |
| CRE — Confidential Workflows concepts | https://docs.chain.link/cre/concepts/confidential-workflows | 2026-09-11 | Chainlink | OFFICIAL | Q2, Q8 — what is protected, the boundary-crossing rule |
| CRE — deploying workflows | https://docs.chain.link/cre/guides/operations/deploying-workflows | 2026-09-11 | Chainlink | OFFICIAL | Q7 — generic deploy-access approval mechanics |
| CRE — requesting Confidential Workflows access | https://docs.chain.link/cre/account/confidential-workflows-access | 2026-09-11 | Chainlink | OFFICIAL | Q7 — the separate private-beta form; local simulation needs no approval |
| CRE — building consumer contracts (on-chain write) | https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts | 2026-09-11 | Chainlink | OFFICIAL | Q4 — the retry/staleness language corroborating the source-code finding |
| `smartcontractkit/chainlink-evm`, `KeystoneForwarder.sol` | https://github.com/smartcontractkit/chainlink-evm/blob/92897847daa3ba26ac2796ef284f57e6f3d1ca2a/contracts/cre/src/v1/KeystoneForwarder.sol | 2026-09-11 | Chainlink (smartcontractkit) | OFFICIAL | Q4 — the low-level call and per-report event, resolving the assignment's flagged lead |
| `docs/feedback/chainlink.md` (this repository) | n/a — local file | 2026-09-05/08/11 | UNICA / NFTeria | TEAM GUIDANCE | Q5, Q7, Q9 — prior Upgrade-track finding, deploy-access submission status, Challenge exploration |
| `docs/SPONSOR-ELIGIBILITY.md` (this repository) | n/a — local file | 2026-09-09 | UNICA / NFTeria | TEAM GUIDANCE | Q1 — the standing SUPERSEDED reasoning this document flags but does not overrule |
| `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (this repository) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | Q2, Q3, Q8 — what has actually run, and under what disclaimer |
| `docs/PROVENANCE-LEDGER.md` (this repository) | n/a — local file, re-derivable any time | UNICA / NFTeria | TEAM GUIDANCE | Q5 — the From Scratch pool fact this document's track choice rests on |
| `docs/unica-v5/graph/MENTOR-QUESTIONS.md` (sibling stream) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | Q9 — the same open multi-submission question, restated for a different track pair |

## Unknowns

1. Whether the absence of a stated pool restriction on "Best Confidential Workflow" (Q1) means
   ETHGlobal or Chainlink actually considers a From Scratch entry for it — no team-member
   confirmation found.
2. Whether a secrets-sourced sensitive input is weighted the same as an API-sourced one for the
   "process at least one sensitive input" requirement (Q2) — the page's wording does not
   distinguish them, but no confirmation was found either.
3. Whether the workflow's role in the *application* (as opposed to the demo *format*) is expected
   to include an on-chain write for this track (Q3) — genuinely open on the page's own text.
4. What Chainlink's documentation says, if anything published elsewhere, about failure or
   unavailability behavior of the Confidential Workflows infrastructure itself, as distinct from an
   ordinary handler-level revert (Q8) — not found on the one page most directly on point.
5. Whether joining the Automated Liquidation Protection Challenge and separately submitting a
   different Confidential Workflow build from the same repository would be read as one project or
   two competing ones (Q9) — the same class of question already open for a different track pair in
   `docs/unica-v5/graph/MENTOR-QUESTIONS.md`.
6. Whether `docs/SPONSOR-ELIGIBILITY.md`'s 2026-09-09 decision not to select Chainlink should be
   revisited given Q1's finding about the track's own accepted demo format — an owner decision;
   this document surfaces the tension and does not resolve it.

(The total prize amount for Best Confidential Workflow, previously listed here as an unresolved
conflict between $2,000 and $3,000, is removed from this list: Q6 above now shows both pages agree
on $2,000, with $3,000 a page-total figure across all three tracks, not a competing per-track
amount. No external file cites this list's items by number across the removal point, so the
remaining items are renumbered rather than corrected in place — unlike `DEMO-PLAN.md` §9, whose
item 1 two sibling-stream files cite by number and which is therefore corrected in place instead.)
