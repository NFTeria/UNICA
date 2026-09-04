# specs/ — the disclosed pre-event design

**The specification and threat model were written before the event; every line of code was
written during it.**

The two documents in this directory were written before the ETHOnline 2026 build window
opened on 2026-09-04 16:00 UTC. They are the design this repository implements, and they are
disclosed here on purpose: a judged from-scratch entry may carry a written plan in as long as
the plan is named, dated, and left as it was. The offence would be hiding them, re-dating them,
or rewriting them mid-event to look fresh. None of that happens here.

| File | Its own stamp | Last modified (pre-window) | SHA-256 |
|---|---|---|---|
| `HOOK-SPEC.md` | v2 stamped 2026-08-21; v3 addenda 2026-08-23 | 2026-09-04 13:58 UTC (relative links to planning files pruned; no design change) | `71f213481380ee0905968bf22fb1b1c3b2badbbfd540ae6ccd387c475aa0500a` |
| `THREAT-MODEL.md` | stamped 2026-08-21 | 2026-09-04 13:58 UTC | `e25ed4e42d4fba30640ffa5b46a3f4dd4a770ae6a54f53987b2b53afc0b26e80` |

Re-verify either hash: `shasum -a 256 specs/HOOK-SPEC.md specs/THREAT-MODEL.md`.

## How to read them

- They were working documents in a private planning tree. They say "WAR-ROOM ONLY" and
  "PLANNED — does not exist" in their headers because that was true when they were written.
  They are published unedited, header and all.
- They reference other planning files by name (`PREBUILD.md`, `IDENTITY-RULING.md`,
  `UNISWAP-NEEDS.md`, and others). Those files are schedules, rulings, and prize arithmetic,
  not part of the contribution, and they are not in this repository. A dangling name is a
  disclosed absence, not a broken promise.
- The specification names an earlier settlement hook by the same author as prior art. It is
  cited, never copied: nothing from that project is a dependency of this one, and nothing
  from it was brought in.
- Where the design changed during the build, the change is recorded in `docs/` with its date
  and reason, and the specification stays as written. `docs/INVARIANTS.md` and
  `docs/THREAT-MODEL.md` are the living documents; these two are the record.

## The line a reviewer can check in one command

No Solidity, no test, and no repository for this project existed before the window opened.
The remote was created empty at 2026-09-04 16:06 UTC and the first commit is later than that:

```sh
git log --reverse --format='%H %cI %s' | head -1
```
