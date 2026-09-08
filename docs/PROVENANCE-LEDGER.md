# UNICA — provenance ledger

What was written before the event, what was written during it, and the commands that prove each.
Written because a submission that gets provenance wrong is disqualified for misrepresentation,
which is a worse outcome than losing on merit.

## The headline, and it decides which track applies

**UNICA is a from-scratch entry, not a Continuity entry.**

```sh
git log --format='%h %ad %s' --date=iso | tail -1
#   24989a5  2026-09-04 16:00:06 -0400  chore: initialise the repository
```

That is **2026-09-04 20:00:06 UTC** — four hours after the build window opened at 16:00 UTC. Every
one of the 249 commits in this repository falls inside the window. There is no pre-event code, and
therefore no continuity to claim.

Anyone preparing a submission should read that as a constraint, not a preference: selecting a
Continuity track for this repository would be a false statement about its history, and the history
is one command away from any judge.

## What genuinely predates the event

Two documents, and nothing else:

| Artifact | What it is |
|---|---|
| `specs/HOOK-SPEC.md` | the hook specification, written before the window |
| `specs/THREAT-MODEL.md` | the threat model, written before the window |

Both ship **unedited**, are named in the README, and are disclosed rather than hidden. Disclosure is
the sanctioned treatment; re-dating them, rewriting them mid-event to look fresh, or omitting them
from `specs/` would each convert a disclosed advantage into the offence.

Separately, `docs/PRIOR-ART.md` classifies every carried-in file line by line — including the two
Vyper contracts deliberately left untracked (`calculator.vy`, `flash_liquidator.vy`), which are
**not** in the repository and are not claimed.

## The event period, by checkpoint

Each tag is a green gate at the moment it was cut.

| Range | Date | Commits | What landed |
|---|---|---|---|
| genesis → `day1-green` | 09-04 | 44 | repository, toolchain, the scaffold hook, a real local swap, first deploy |
| → `day2-green` | 09-04 | 19 | router admission boundary, the `0xC0` gate, I1 |
| → `day2-night-green` | 09-04 | 30 | the executor path, I2 receipt, hook-side invariants |
| → `day3-green` | 09-04 | 7 | receipt schema frozen as tests |
| → `day5-green` | 09-05 | 13 | the indexer, the surface |
| → `deploy-candidate-1…5` | 09-05 | 19 | deployment rehearsals |
| → **`live-green`** | 09-05 | 3 | **the live, verified Sepolia deployment** |
| → `deploy-candidate-6,7`, `v1.0.0` | 09-05 | 15 | post-deploy proof |
| → `HEAD` | 09-05→09-08 | **114** | V2, the security review, the tooling, the integrations |

## Where the work went

Files touched since genesis, by top-level area:

```
integrations 62   docs 62   test 40   vy 29   script 23
tools 13   src 8   broadcast 6   web 4   specs 3   lib 3   .github 2
```

`src` is 8 because the contracts are small and were frozen early; the weight is in tests,
integrations and the evidence trail, which is the correct distribution for a project whose claim is
that its behaviour is checkable.

## V1 has not moved since it went live

```sh
git diff --stat live-green..HEAD -- src/V4SettlementHook.sol src/SettlementExecutor.sol src/libraries/
```

Prints nothing. The deployed generation is byte-identical to the tag it was deployed from, which is
what lets the live addresses be cited against source at HEAD.

## Verify any of this

```sh
git log --format='%h %ad %s' --date=iso | tail -1     # genesis, inside the window
git rev-list --count HEAD                             # 249
git rev-list --count live-green..HEAD                 # 114
git log --format=%ad --date=short | sort | uniq -c    # every commit's day
```

## Status

`FROM_SCRATCH_CONFIRMED`. Continuity tracks do not apply. The pre-event specification and threat
model are disclosed prior art and are not code.
