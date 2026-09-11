# UNICA v5 / Chainlink — prize fit

Engineering record. Retrieval date for every claim below is 2026-09-11 unless a claim states
otherwise. Labels: VERIFIED (source cited), PROPOSED (UNICA design choice, not a claim about the
sponsor), DOCUMENTED_NOT_OBSERVED, UNKNOWN. Reads against
`docs/unica-v5/chainlink/PEER-COMPARISON.md` (this stream's companion file), `docs/SPONSOR-ELIGIBILITY.md`,
and `docs/unica-v5/ens/PRIZE-FIT.md` / `docs/unica-v5/graph/PRIZE-FIT.md` (sibling streams, cited
here, never edited). No eligibility is asserted anywhere in this file without the official citation
sitting next to it.

## 1. Scope and current status — read before anything else in this file

**Chainlink is not one of UNICA's three submitted integrations.** Per `docs/SPONSOR-ELIGIBILITY.md`
(TEAM GUIDANCE, first-party, correction dated 2026-09-09, quoted in full because it governs
everything below): "**SUPERSEDED, 2026-09-09.** Chainlink is **not one of the three submitted
integrations** and is **not part of the submitted integration** set. The section below is kept as
the record of what was built and how honestly it was graded. The workflow runs in Chainlink's own
simulator and has never executed in a TEE, and a track claim needs execution evidence a judge can
see. The three submitted integrations are **Uniswap v4, ENSv2 on Sepolia and The Graph**."

This file does not reverse that decision. It exists because the assignment that produced it asked
for a prize-fit evaluation of Chainlink specifically, and because one fact discovered while
researching it (§5, §11.4) directly bears on the reasoning the 2026-09-09 decision gave — which is
reported here as a finding for the owner to weigh, not as a unilateral reversal. Nothing in this
file edits `docs/SPONSOR-ELIGIBILITY.md`.

**What exists to build on, if the owner reconsiders:** `integrations/chainlink-cre-guardian/` (a
complete CRE workflow using `handlerInTee`, three recorded simulator runs, 18/18 confidentiality
checks) and `integrations/chainlink-cre-robinhood/` (a policy/schema layer with no workflow entry
point of its own — `docs/unica-v5/chainlink/PEER-COMPARISON.md` §1 establishes this distinction from
`git ls-files`). Both are read in full for this file; neither is modified by it.

## 2. Track structure, as worded today

VERIFIED — `https://ethglobal.com/events/ethonline2026/prizes/chainlink`, OFFICIAL, ETHGlobal /
Chainlink, retrieved 2026-09-11 (fetched twice directly, agreeing on every figure and quoted phrase
below; cross-checked a third time against the general prize-listing page,
`https://ethglobal.com/events/ethonline2026/prizes`, which agrees on all three amounts).

| Track, as titled on the page today | Pool | Prize |
|---|---|---|
| Best Confidential Workflow | **Open** — no From Scratch/Continuity restriction stated | $2,000 total (up to 2 teams, $1,000 each) |
| Best Chainlink-Powered Upgrade | **Continuity Track only** | $500 |
| Automated Liquidation Protection Challenge | **Open** (no pool restriction stated; has its own on-chain join requirement instead, §2c) | $500 |

Total Chainlink pool: **$3,000**, confirmed by two independent fetches summing identically.

**Track A — Best Confidential Workflow.** Quoted requirements: "Build a CRE Workflow that uses the
Confidential Workflows to execute a meaningful part of the application"; must "register and use a
confidential TEE handler, such as `handlerInTee` in TypeScript or `cre.HandlerInTee` in Go"; the
confidential portion must "process at least one sensitive input, secret, confidential API response,
private parameter, or intermediate value inside the enclave"; "Integrate meaningfully into core
functionality (not placeholder code)"; "Demonstrate successful execution via CRE CLI simulation or
live network deployment with evidence (demo video, logs, or deployment details)." Named focus
areas: "AI-powered smart contract audits, liquidation protection, portfolio rebalancing, automated
trading, privacy-preserving risk assessment, secure LLM workflows, and confidential financial
computations."

**Track B — Best Chainlink-Powered Upgrade.** "This prize is only available to Continuity Track
participants" — structurally inapplicable to UNICA, a From Scratch entry
(`docs/PROVENANCE-LEDGER.md`, owner-confirmed 2026-09-11). Requires "integrate at least one
Chainlink service directly within smart contract logic or onchain workflows" where "the Chainlink
integration must contribute to a state change on a blockchain," from an eligible-technology list
naming "CRE (including Confidential Workflows), Price Feeds, Data Streams, Proof of Reserve, or
VRF." Not pursued further in this file for the reason stated: the pool restriction alone excludes
UNICA, independent of any other consideration.

**Track C — Automated Liquidation Protection Challenge.** "Build a Confidential Workflow protecting
a virtual ETH-collateral/USDC-debt position while avoiding liquidation and preserving loan
benefits." Structural requirements distinct from Track A: "join via smart contract on Ethereum
Sepolia between Sept 9 and submission deadline"; "keep protection rules and credentials private";
"use emergency capital efficiently"; resources named on the page include "a challenge repository,
token contracts, and a deployment access form." **A separate, lower-confidence detail** — that
Chainlink runs scored market scenarios "within 24 hours" of joining and that a joined workflow
"cannot be updated after the deadline" — reached this file only through a search-engine summary,
not a direct fetch of a dedicated challenge page (no such page was located independently), and is
recorded here as UNCONFIRMED rather than folded into the paragraph above as an equally-solid fact.

## 3. General ETHOnline 2026 rules, as worded today

VERIFIED — `https://ethglobal.com/events/ethonline2026/info/details`, OFFICIAL, ETHGlobal, retrieved
2026-09-11 (fetched twice, agreeing both times). Submission deadline, quoted verbatim: "All
projects must be submitted by Sunday, September 13th 2026 at 12:00 pm EDT." Classic-track rule,
quoted: "All work on your project must begin after the hackathon officially starts. Any prior
project-specific code, designs, or assets are not allowed unless they're from public libraries or
starter kits." Public-repository requirement, quoted: "a GitHub Repo, Figma files, or equivalent,
proving the work was done during the hackathon." Demo requirement, quoted: "a 2-4 minute demo
video." Partner-prize rule, quoted: entrants "can select up to 3 Partner Prizes to apply for."

**A partner's multiple tracks count once against that ceiling of 3.** This specific detail was not
found on a page fetched directly for this file; it is carried forward from
`docs/unica-v5/graph/PRIZE-FIT.md` §9 (TEAM GUIDANCE, sibling stream, itself sourced "via search
summary of ETHGlobal event pages") and independently corroborated by a fresh search performed for
this file returning the same statement — "if a partner has multiple tracks, you can be eligible for
all of them while only counting as 1 Partner Prize" — across several other ETHGlobal event pages
consistently, though again via a search-engine summary rather than a direct fetch of this event's
own primary text stating it. Recorded as VERIFIED-by-consistent-pattern rather than a single quoted
primary source; §14 carries the residual uncertainty.

**Deadline conflict, carried forward rather than re-litigated.** `docs/unica-v5/ens/PRIZE-FIT.md`
§3 and `docs/unica-v5/graph/PRIZE-FIT.md` §7 disagree with each other on whether ETHOnline 2026's
overall window runs to 2026-09-16 or whether the binding submission cutoff is 2026-09-13 12:00 pm
EDT; this file's own retrieval of `info/details` finds only the 2026-09-13 date stated as a
deadline, matching the ENS file's tighter reading. This file uses that tighter number: from today's
retrieval date (2026-09-11), **roughly two days of runway**, not five.

## 4. Chainlink's categories, classified against UNICA

- **Track A is a direct, buildable-today fit.** `integrations/chainlink-cre-guardian/` already
  registers and calls `handlerInTee` (confirmed by direct read of `guardian.ts` line 472,
  `docs/unica-v5/chainlink/PEER-COMPARISON.md` §1), already processes five private policy values
  inside the enclave, and already has a written, honest record of three simulator runs
  (`docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md`). The page's own evidence bar — "CRE CLI
  simulation... with evidence (demo video, logs, or deployment details)" — is explicitly satisfied
  by exactly the kind of record this repository already has, not only by a live deployment.
- **Track B does not apply, structurally**, independent of merit: it is restricted to Continuity
  Track participants and UNICA is a From Scratch entry (§2).
- **Track C is a genuine but much larger lift.** UNICA's own architecture already has the right
  shape for the "keep protection rules... private" requirement — `policy.mjs`'s `policyCommitment`
  function is precisely a mechanism for publishing "decided under policy X" without publishing X —
  but the specific subject (a virtual ETH-collateral/USDC-debt position, scored against a live
  market scenario) does not exist in this repository in any form, and the challenge's own on-chain
  `join()` step is itself a broadcast action outside this document's read-only research scope and
  outside what this document recommends attempting without a separate owner decision (§8, §11).

## 5. A finding that bears directly on the 2026-09-09 decision

**Recorded plainly, not resolved here.** The 2026-09-09 correction in `docs/SPONSOR-ELIGIBILITY.md`
gave its reason as: "a track claim needs execution evidence a judge can see," in the context of "The
workflow runs in Chainlink's own simulator and has never executed in a TEE." Read on its own, that
sentence could be taken to mean live TEE execution is the evidence bar a judge would apply. **The
official Chainlink prize page, retrieved fresh for this file on 2026-09-11, states a different and
more permissive bar in its own words**: "Demonstrate successful execution via CRE CLI simulation
**or** live network deployment with evidence (demo video, logs, or deployment details)" —
`ethglobal.com/events/ethonline2026/prizes/chainlink`, OFFICIAL. Simulation is named as an
independently sufficient evidence path, not a fallback beneath live deployment.

This is a fact the 2026-09-09 decision did not have stated this explicitly when it was made — this
file did not verify what page text was available to that earlier decision, only what the page reads
today. It does not, by itself, mean the earlier decision was wrong: the decision may also have
weighed factors this file does not have access to (competitive strength relative to other
submissions, the owner's own confidence bar being stricter than the page's minimum, or the
partner-prize slot math in §11.1). It is recorded here as a fact worth the owner's reconsideration,
addressed to `docs/SPONSOR-ELIGIBILITY.md`'s own future maintainers, not as a claim that Chainlink
should be re-added to the submitted set.

## 6. Strongest eligible category

**Best Confidential Workflow (Track A), if pursued at all.** This is a classification from the
page's own wording (§2, §4), not a claim that eligibility is settled — no Chainlink team member has
confirmed in writing that this repository's specific existing artifact qualifies, and §12 carries
that open question forward. What is VERIFIED: the track's own named mechanism (`handlerInTee`, at
least one sensitive input processed inside the enclave, evidence via simulation or deployment) is,
word for word, what `integrations/chainlink-cre-guardian/` already does and has already recorded
doing (§4).

**What is honestly unresolved, not glossed over.** `docs/unica-v5/chainlink/PEER-COMPARISON.md` §3.11
establishes that Chainlink CRE is explicitly advisory-only in UNICA's architecture — removing it
changes nothing about whether a settlement can occur. Chainlink's own page asks for "meaningful,"
"not placeholder" integration, which is a lower bar than other sponsors' "central, not cosmetic"
wording, and the guardian workflow's real (if advisory) treasury-policy computation plausibly clears
that lower bar — but this file does not assert that a judge would agree, and no Chainlink team
member has said so.

## 7. What must be newly built

PROPOSED, separated into what is buildable within the ~2-day runway (§3) and what is not, per this
project's own rule of naming a real build order rather than describing a bigger one it cannot meet.
**Nothing below proposes adding a new Chainlink product without a load-bearing reason** — this
section stays inside CRE Confidential Workflows, the one Chainlink surface UNICA has already built
against.

**Buildable in the runway available, on already-existing infrastructure:**
1. A recorded, narratable `cre workflow simulate` run against `integrations/chainlink-cre-guardian/`
   — the exact sequence already performed and written up in
   `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` §2–§3 — captured as the demo video's evidence
   segment, per the page's own explicit acceptance of simulation-plus-logs.
2. A short written note, alongside any submission, stating plainly what
   `docs/unica-v5/chainlink/PEER-COMPARISON.md` §3.4/§3.6 already establish: no `IReceiver` contract
   consumes this workflow's output today, and the workflow's role is advisory pre-flight, not
   settlement authority — disclosed rather than allowed to read as more than it is.
3. If judged worth the risk in §11.2: a one-paragraph reframing of the guardian workflow's role that
   states its "meaningful part of the application" case on Chainlink's own lower bar, rather than
   attempting to claim the stricter "central, not cosmetic" standard it does not meet.

**Out of realistic scope at this runway, named rather than silently dropped:**
- Any live DON deployment or real-TEE execution — blocked on Chainlink's own review, per
  `docs/SPONSOR-ELIGIBILITY.md`: "`cre account access` has been submitted and is awaiting
  Chainlink's review; until it is granted there is no DON deployment to claim." This file does not
  propose working around that; it is the sponsor's own gate, not this repository's decision.
- Track C (Automated Liquidation Protection Challenge) — the join-and-score mechanics, the
  collateral/debt subject matter, and the on-chain `join()` transaction are all new work with their
  own owner-action requirement (§2, §8), not a same-week addition to what exists.
- Any new receiver contract implementing `IReceiver` to give the workflow's output on-chain effect
  — `docs/unica-v5/chainlink/PEER-COMPARISON.md` §3.4/§3.8 establish this does not exist today and
  flags a real receiver-verification hazard (Chainlink's own `KeystoneForwarder` does not revert the
  outer call on a failed receiver delivery) that any such contract would need to design around
  deliberately — not a two-day task done carefully.

**Recommendation, stated plainly:** if pursued at all, scope to item 1 and 2 above — the evidence
this repository already has, disclosed honestly, rather than a larger build the runway in §3 cannot
support.

## 8. What pre-existing work must be disclosed

VERIFIED (repository) / PROPOSED (how to disclose it here). Per `docs/PROVENANCE-LEDGER.md`, the
entire UNICA repository began inside this event's build window (2026-09-04 20:00:06 UTC genesis,
four hours after the window opened at 16:00 UTC), and zero commits precede it
(`git rev-list --count HEAD` at 250, re-derivable by any judge with `git log`). Confirmed
specifically for the Chainlink work by this file's own check: every commit touching
`integrations/chainlink-cre-guardian/`, `integrations/chainlink-cre-robinhood/`,
`docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md`, and
`docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` falls between 2026-09-08 and 2026-09-11, well
inside the window (`git log --diff-filter=A`, run for this file). What must still be named, honestly,
in any Track A submission built from this design:

1. **Chainlink was previously marked NOT SELECTED for the submitted integration set**
   (`docs/SPONSOR-ELIGIBILITY.md`, 2026-09-09). A submission built from this file's design is
   reversing that internal decision, not extending an already-submitted integration the way the
   Uniswap/ENSv2/Graph submissions do — say so plainly rather than presenting Track A as always
   having been part of the plan.
2. **The workflow has never executed inside a real TEE.** `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md`
   states this outright and this file repeats it rather than softening it: the simulator "is not a
   real TEE," and every confidentiality result recorded is about the public result, serialized
   artifacts, error messages, and calldata — never a claim about enclave memory itself.
3. **Two documents predate the event entirely**: `specs/HOOK-SPEC.md` and `specs/THREAT-MODEL.md`
   (`docs/PROVENANCE-LEDGER.md`). Neither is Chainlink-specific, but both are named in the project's
   standing disclosure rule and that disclosure should be repeated wherever this submission's
   provenance is described.
4. **`integrations/chainlink-cre-robinhood/` has no CRE workflow entry point today.** If any
   submission text describes "the Chainlink integrations" in the plural, it must not imply that
   both directories register a TEE handler — only `chainlink-cre-guardian` does
   (`docs/unica-v5/chainlink/PEER-COMPARISON.md` §1).

## 9. Public-repository requirements

VERIFIED — §3: "a GitHub Repo... proving the work was done during the hackathon" and "a 2-4 minute
demo video." UNICA's repository is already public and MIT-licensed (`CLAUDE.md`, `LICENSE`), so the
public-repository requirement is met by the repository as a whole; nothing this file proposes needs
a new repository or a fork.

## 10. Required live dependency

**Asymmetric across tracks, stated precisely rather than assumed uniform.** Track A's own text
(§2, §5) explicitly accepts CLI-simulation evidence as sufficient — there is **no** requirement
that the confidential handler have executed in a live TEE, unlike ENS's and The Graph's own prize
pages, both of which state a live-data requirement in their own words
(`docs/unica-v5/ens/PRIZE-FIT.md` §3: "functional and not just include hard-coded values";
`docs/unica-v5/graph/PRIZE-FIT.md` §2: "Consume live data from a Graph provider... Mocked,
local-only, or static datasets do not qualify"). Track C, by contrast, has a hard live dependency by
construction: joining requires "a smart contract on Ethereum Sepolia," a real broadcast transaction,
and the scoring itself runs against "market simulations" Chainlink's own team executes — there is no
simulation-only path for Track C at all, unlike Track A.

## 11. Eligibility risks

1. **Partner-prize slot ceiling — the largest risk, and a portfolio decision, not a fact this file
   settles.** `docs/unica-v5/graph/PRIZE-FIT.md` §11.1 already records that Uniswap, ENSv2, both
   Graph tracks, and Arc collectively exceed the "up to 3 Partner Prizes" ceiling (§3) if all are
   pursued at once. Adding Chainlink Track A (and possibly Track C, which per §3's one-partner-
   counts-once reading would not cost an additional slot beyond Track A) would add a fifth named
   sponsor commitment to a ceiling of three. This file does not resolve which sponsors the owner
   drops; it only states that pursuing Chainlink at all requires that decision to be made first.
2. **The NOT SELECTED status is a real prior decision, not a stale draft.** Reversing it needs an
   owner ruling, not an inference from this file's finding in §5. This file's job is to report the
   finding, not to act on it.
3. **The advisory-only design tension (§6, `PEER-COMPARISON.md` §3.6/§3.11) is a real weakness
   against "meaningful... not placeholder code."** A judge could read a workflow whose removal
   changes nothing about settlement correctness as decorative despite its real computation, even
   though Chainlink's own wording is lower-bar than other sponsors'. Not resolved here.
4. **Live TEE execution remains blocked on Chainlink's own review**, per `docs/SPONSOR-ELIGIBILITY.md`
   (§7). If a judge does weight live execution higher than the page's text requires (§5's open
   question), this risk cannot be closed by anything this repository does alone before the
   deadline in §3.
5. **The oracle-integrity research in `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` is not
   Track A evidence and must not be presented as if it were** — it concerns Data Feeds and Data
   Streams on Robinhood Chain, a different Chainlink surface entirely from CRE Confidential
   Workflows (`PEER-COMPARISON.md` §3.7). Conflating the two in submission text would overstate the
   CRE work's own maturity using unrelated research.
6. **The deadline conflict (§3) is unresolved** and, at the tighter reading, leaves roughly two days
   — sharply narrower than building anything beyond §7's already-buildable items would need.
7. **Track C's `join()` step is a broadcast transaction** this document's own scope does not perform
   and does not recommend performing without a distinct owner decision, separate from and later than
   this file.
8. **The "up to 2 teams" cap on Track A's own prize** (§2) is stated on the page without describing
   the selection mechanism between competing entrants — whether it is a ranked judged outcome, a
   category split, or something else is not stated anywhere retrieved for this file.

## 12. What needs written confirmation from an identifiable Chainlink team member

Summarized here, none claimed as settled: whether a CLI-simulation-only submission is judged
identically to a live-TEE submission for Track A, despite the page's own wording appearing to accept
either (§5, §10); whether an explicitly advisory-only (never load-bearing for settlement)
Confidential Workflow satisfies "not placeholder code" (§6, §11.3); the exact selection mechanism
behind "up to 2 teams" winning Track A (§11.8); whether pursuing Track A and Track C together truly
costs only one of the three Partner Prize slots under the one-partner-counts-once rule (§3, §11.1),
given that rule was confirmed here only via search-engine summaries rather than a directly-quoted
primary sentence on this event's own page; and the submission-deadline reconciliation already
carried from the ENS and Graph sibling files (§3).

## 13. Sources

| Source | URL | Retrieved | Author/org | Kind | Used for |
|---|---|---|---|---|---|
| ETHOnline 2026 Chainlink prize page | https://ethglobal.com/events/ethonline2026/prizes/chainlink | 2026-09-11 (fetched twice, agreeing) | ETHGlobal / Chainlink | OFFICIAL | §2, §4, §5, §6, §10 — track names, pools, prize amounts, exact requirement wording |
| ETHOnline 2026 general prize page | https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 | ETHGlobal | OFFICIAL | §2 — cross-check of total pool and per-track amounts |
| ETHOnline 2026 info/details | https://ethglobal.com/events/ethonline2026/info/details | 2026-09-11 (fetched twice, agreeing) | ETHGlobal | OFFICIAL | §3, §9 — deadline, Classic-track rule, repository/demo requirements, partner-prize count |
| ETHGlobal partner-prize multi-track rule (via search summary, corroborated across multiple ETHGlobal event pages) | general ETHGlobal policy, no single ethonline2026 page directly quoted | 2026-09-11 | ETHGlobal | OFFICIAL, read via search summary | §3, §11.1 — one-partner-counts-once slot rule |
| `docs/SPONSOR-ELIGIBILITY.md` (this repository) | n/a — local file | 2026-09-09 correction (file date) | UNICA / NFTeria | TEAM GUIDANCE | §1, §5, §6, §7, §11.2, §11.4 — the NOT SELECTED status and its stated reasoning |
| `docs/PROVENANCE-LEDGER.md` (this repository) | n/a — local file | 2026-09-08 (file date), re-derived for this file | UNICA / NFTeria | TEAM GUIDANCE | §2, §8 — from-scratch provenance, exact genesis timestamp |
| `docs/experimental/CRE-CONFIDENTIAL-SIMULATOR.md` (this repository) | n/a — local file | 2026-09-11 (file date) | UNICA / NFTeria | TEAM GUIDANCE | §4, §7, §8 — the three simulator runs, the TEE disclaimer, the 18-check result |
| `docs/unica-v4/evidence/CHAINLINK-AVAILABILITY.md` (this repository) | n/a — local file | 2026-09-11 (file date) | UNICA / NFTeria | TEAM GUIDANCE | §11.5 — the unrelated oracle-integrity research named for exclusion |
| `docs/unica-v5/chainlink/PEER-COMPARISON.md` (this stream's companion) | n/a — local file | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §1, §4, §6, §7, §11 — the twelve-dimension comparison this file builds its eligibility read on |
| `docs/unica-v5/ens/PRIZE-FIT.md`, `docs/unica-v5/graph/PRIZE-FIT.md` (sibling streams, cited, not edited) | n/a — local files | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE | §3, §10, §11.1 — the deadline-conflict precedent and the partner-slot ceiling math |
| `git log`, `git rev-list`, `git ls-files` (this repository, run directly for this file) | n/a — local commands | 2026-09-11 | UNICA / NFTeria | TEAM GUIDANCE, first-party measurement | §1, §8 — commit-date verification for the Chainlink-specific paths |

## 14. Unknowns

1. **Whether the 2026-09-09 NOT SELECTED decision would change in light of §5's finding** — this
   file surfaces the finding; whether it changes the owner's judgment is explicitly not this file's
   call to make.
2. **Whether Chainlink judges treat CLI-simulation evidence and live-TEE evidence as equal**, despite
   the page's own "or" wording (§5, §10, §12) — not stated anywhere retrieved.
3. **Whether an advisory-only Confidential Workflow satisfies "not placeholder code"** (§6, §11.3,
   §12) — a judgment call no source retrieved resolves either way.
4. **The exact mechanism behind Track A's "up to 2 teams" cap** (§2, §11.8, §12) — not described on
   any page fetched.
5. **Whether the one-partner-counts-once Partner Prize rule (§3, §11.1) is stated anywhere on this
   specific event's own pages directly**, rather than only inferred from a cross-event pattern via
   search summaries — not confirmed by a direct fetch for this file.
6. **The Track C scoring mechanism's exact timing and update rules** ("within 24 hours," "cannot be
   updated after the deadline," §2) — reached this file only through a search-engine summary, not a
   direct primary fetch; no dedicated challenge page was located to confirm or refute it.
7. **Whether `integrations/chainlink-cre-robinhood/`'s empty `workflow/` directory represents an
   abandoned plan or dead scaffolding** — carried from `PEER-COMPARISON.md` §7's own unresolved item,
   repeated here because it bears on how the two Chainlink directories should be described together
   in any future submission text.
8. **No transcript of any Chainlink-related channel discussion was supplied to this document at
   any point**, and no named peer project was verified or compared against — repeated here in full
   per this stream's standing instruction, not only in the companion file.
