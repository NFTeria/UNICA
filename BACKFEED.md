# BACKFEED.md

The other half of feedback. `FEEDBACK.md` is what broke and how to fix it, written for
a partner's engineers. This file is what we were thinking while we built on their
work — written for the humans who will read the repository and want to know whether
we meant it.

It is a journal. First person. Dated. Honest. The author talks to themself here, or the
AI assisting the build talks to itself, and either way the reader is looking over a
shoulder at real reasoning rather than at a pitch.

## What this file is for

- **Why this partner.** Not the prize — the reason their tool was the right one for
  this problem, and what became possible because of it.
- **What we learned about their stack** that we did not know going in. The moments of
  "oh, that's why it's designed that way".
- **What we hope their ecosystem gets from this.** Concretely: what a developer after
  us can reuse, what a user gets that they could not get before.
- **What we would build next** on their work, if the window were longer.
- **Where our intention exceeded our evidence**, said plainly. "We wanted X to be
  true; here is how far we actually got."

The tone is positive because the intention is positive. Building on someone's work
is a form of respect, and this file says so without performing it.

## What never goes in this file

This file is public. It shows intention; it never gives up the edge.

- No prize arithmetic. No track names, tiers, places, reachable-versus-headline
  amounts, or slot decisions.
- No comparison between partners. Each partner is written about as if they were the
  only one.
- No war-room content: schedules, cut lines, day plans, risk registers, internal
  rulings, or anything from a planning tree.
- No private product detail: nothing about the integrator's business, customers,
  pricing, or roadmap beyond what `README.md` already says in prose.
- No claims that outrun the evidence. If it is a hope, it is written as a hope.
- No names of people who did not agree to be named.

If an entry would only matter to someone evaluating the project's strategy, it does
not belong here. If it would matter to someone deciding whether to build on the same
tools, it does.

## Format

```
### <date> — <partner> — <what was on my mind>

<a few paragraphs, first person, present tense where it happened that day>
```

Newest first. Never edited after the day it was written — if the thinking changed,
the next entry says so.

---

## Entries

<!-- newest first -->

---

## 2026-09-08 — Chainlink CRE, and a boundary that is not where it looks

Repository read at `solangegueiros/cf-liquidation-protection-challenge@58b24604`, MIT.

The thing I did not expect: **the liquidation boundary is higher than the threshold suggests,
and it is integer flooring that puts it there.** `ChallengeLending.calcHF` computes

```
hf = collateral * price * LIQUI_THRESHOLD / (100 * debt)
```

with Solidity's floor division, and `checkAllHF` liquidates at `hf <= 100`. Both halves matter.
Flooring means a position whose true ratio is 1.0028 reports 100, and `<=` means 100 is already
fatal. So the starting position — 5.00 vETH against 7000.00 vUSD at 2000.00 — is liquidatable at
any price at or below **1812.82**, which is 9.4% below where it starts, not the ~11% the headline
health factor of 1.11 implies.

Follow that through the published scenarios and the consequence is sharp: **every one of the five
liquidates an untouched position, including the one named "safe volatility"**, whose first step to
$1800 floors to exactly 100. Its stated expectation is *"avoid unnecessary interventions"*, and read
as "do nothing" that scenario is lost. I do not think that is a mistake in the challenge — it is a
genuinely interesting trap, and it rewards reading the contract over reading the table. But it is
worth knowing that the scenario named for restraint is not the one where restraint wins.

Two more things I would have wanted to know earlier, both reproducible:

**The example workflow's own address set disagrees with the README's.** `README.md` names the
official contracts; `automated-liquidation-protection-workflow/config.staging.json` names different
ones. A participant who follows the getting-started steps unchanged protects a position on a
deployment the organisers are not scoring, and nothing in the run output says so. We now carry both
as named profiles with no default, because picking one silently seemed worse than being blocked.

**A five-minute cron can miss the update that kills you.** In the sudden-crash path the *first*
price update is already below the line. Measured against our own model: observing every update
survives it; observing every second update does not. That makes the schedule a strategy decision
rather than a default, and I would like to know what the DON actually permits before assuming a
faster one is available.

What I liked: the challenge is scored by *running* the workflows rather than by reading them, and
the contract emits enough to reconstruct every participant's decisions afterwards. That is a much
better test of a strategy than a demo video, and it is why we put the arithmetic under 88 tests and
nine mutations before writing a single line of workflow code.

Where our intention exceeded our evidence: we have a policy and an adapter, both offline. We have
**not** deployed a workflow, called `join()`, installed the CRE CLI or produced anything a TEE
attested. Every evidence record this repository generates says `LOCAL_SIMULATION` in a field that
cannot be set to anything else, and that is deliberate.

## 2026-09-08 — Circle Gateway nanopayments, and what a batch does not prove

Repository read at `circlefin/arc-nanopayments@a29f920e`, Apache-2.0, with the protocol in
`@circle-fin/x402-batching@2.0.4`.

The question I went in with was whether batching produces a **verifiable commitment to every
nanopayment** or cheap operational accounting. It is the second, and the answer is in the SDK
rather than in any document: zero occurrences of merkle, root, proof, batch id, inclusion or
commitment, and no events in its embedded ABI. `settle` returns `{success, transaction}`, and that
transaction is the batch's — shared by every payment in it, with no index and no inclusion proof.

That is not a criticism of the design; for sub-cent payments it is probably the right trade. But it
draws a line we had to respect: a Gateway authorization is a **real signature over six fields** —
payer, recipient, amount, a validity window, a nonce, and through its domain the chain and the
GatewayWallet — and it says nothing whatever about *what was bought*. There is no resource, no
request digest, no response digest, not even the token address. So we bind those ourselves, in a
mandate, and grade every piece of the trail separately rather than calling the whole thing verified.

The thing I found genuinely surprising: **the SDK's server half verifies nothing.**
`BatchFacilitatorClient.verify` and `.settle` are `fetch` calls to Circle's hosted API, so a seller
using them learns that Circle says a payment is valid. Yet the payload the buyer sends carries both
the authorization *and* the signature over it — so local verification was available the whole time
and simply unused. We wrote it, from the EIP-712 spec, without importing the SDK; Circle's own SDK,
viem and our implementation all produce one digest.

A smaller one, from the demo app: it records payments to Postgres and stores `{requirements,
settleResult}` — **discarding the payer's signature**, which is the only cryptographic evidence it
ever held. If a seller wants to prove later that a payer authorised something, that is the field
they needed.

What a developer after us can reuse: an independent verifier for a Gateway authorization, and an
evidence grading that refuses to call an API answer a proof.
