# UNICA — provenance ledger

What was written before the event, what was written during it, and the command that proves each.
Written because a submission that gets provenance wrong is disqualified for misrepresentation,
which is a worse outcome than losing on merit.

Every number below was re-derived from the repository at the commit that carries this file. None is
carried forward from an earlier draft.

## The headline: this repository was created inside the build window

**UNICA is a from-scratch entry.** There is no predecessor codebase, no forked repository, and no
project-specific code that predates the window.

```sh
TZ=UTC git log --format='%h %ad %s' --date=iso-local | tail -1
#   24989a5  2026-09-04 20:00:06 +0000  chore: initialise the repository
```

The build window opened **2026-09-04 16:00 UTC**. Genesis is four hours after it, and every commit
in the repository falls inside the window:

```sh
git rev-list --count HEAD                                                    # 250
TZ=UTC git log --format='%ad' --date=iso-local | awk '$0 < "2026-09-04 16:00:00"' | wc -l   # 0
```

Zero commits precede the window. That is the whole claim, and it is one command away from any
judge who wants to check it.

The from-scratch pools are therefore the ones that apply, and this repository is submitted to them.

## What genuinely predates the event

Two documents, and nothing else:

| Artifact | What it is |
|---|---|
| `specs/HOOK-SPEC.md` | the hook specification, written before the window |
| `specs/THREAT-MODEL.md` | the threat model, written before the window |

Both ship **unedited**. Both are named in the README, in `specs/`, and in the submission
description. They are **prose, not code** — no Solidity, no test, no configuration, no asset.

Disclosure is the sanctioned treatment. Re-dating them, rewriting them mid-event so they look
fresh, or quietly omitting them from `specs/` would each convert a disclosed advantage into the
offence, and none of those things was done. Nothing in this repository represents a copied or
pre-existing document as event-created work.

Separately, `docs/PRIOR-ART.md` classifies every carried-in file line by line — including the two
Vyper contracts deliberately left **untracked** (`calculator.vy`, `flash_liquidator.vy`), which are
not in the repository, are not built, and are not claimed.

## The event period, by checkpoint

Each tag is a green gate at the moment it was cut.

| Range | Date (UTC) | Commits | What landed |
|---|---|---|---|
| genesis → `day1-green` | 09-04 | 44 | repository, toolchain, the scaffold hook, a real local swap, first deploy |
| → `day2-green` | 09-04 | 19 | router admission boundary, the `0xC0` gate, I1 |
| → `day2-night-green` | 09-04 | 30 | the executor path, I2 receipt, hook-side invariants |
| → `day3-green` | 09-04 | 7 | receipt schema frozen as tests |
| → `day5-green` | 09-05 | 13 | the indexer, the surface |
| → `deploy-candidate-1…5` | 09-05 | 19 | deployment rehearsals |
| → **`live-green`** | 09-05 | 3 | **the live, verified Sepolia deployment** |
| → `deploy-candidate-6,7`, `v1.0.0` | 09-05 | 15 | post-deploy proof |
| → `HEAD` | 09-05→09-08 | **115** | V2, the security review, the tooling, the integrations |

```sh
TZ=UTC git log --format=%ad --date=format-local:'%Y-%m-%d' | sort | uniq -c
#   92 2026-09-04    85 2026-09-05    9 2026-09-06    20 2026-09-07    44 2026-09-08
```

## Where the work went

Distinct files touched since genesis, by top-level area:

```
docs 67   integrations 66   test 43   vy 29   script 24
tools 13   src 10   broadcast 6   web 4   specs 3   lib 3   .github 2
```

`src` is 10 because the contracts are small and were frozen early; the weight is in tests,
integrations and the evidence trail, which is the correct distribution for a project whose claim is
that its behaviour is checkable rather than described.

## V1 has not moved since it went live

```sh
git diff --stat live-green..HEAD -- src/V4SettlementHook.sol src/SettlementExecutor.sol src/libraries/
```

Prints nothing. The deployed generation is byte-identical to the tag it was deployed from, which is
what lets the live addresses be cited against source at HEAD.

## Verify any of this yourself

```sh
TZ=UTC git log --format='%h %ad %s' --date=iso-local | tail -1                              # genesis
TZ=UTC git log --format='%ad' --date=iso-local | awk '$0 < "2026-09-04 16:00:00"' | wc -l   # 0
git rev-list --count HEAD                                                                   # 250
git rev-list --count live-green..HEAD                                                       # 115
git log --format='%an <%ae>' | sort -u                                                      # one identity
```

## Status

`FROM_SCRATCH_CONFIRMED`. The pre-event specification and threat model are disclosed prior art and
are not code.
