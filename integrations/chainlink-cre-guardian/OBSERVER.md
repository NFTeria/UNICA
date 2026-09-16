# The CRE execution observer

A local, read-only, automatic record of every execution of the two deployed UNICA treasury
guardian workflows (`unica-treasury-guardian-staging`, `unica-treasury-guardian`). It never
deploys, activates, pauses, signs, broadcasts, or touches a secret — every command it runs is one
of `cre execution list/status/events/logs`, enforced by an explicit allowlist in `cre-lib.mjs` that
every call passes through (proven by a sabotage test in `cre-lib.test.mjs`, not just asserted).

## The one command you need

```bash
node status.mjs
```

Prints observer health, scheduler health, the last collection time, the last observed production
execution and its decision, total warnings, and any unresolved history gaps — and exits nonzero
when something needs a look (production data stale, scheduler not loaded, or newest-100 headroom
running low). Add `--json` for the same facts as one object.

## How it runs

A launchd job (`install-collector.sh`) runs `execution-viewer.mjs` once an hour, resuming
automatically after reboot or login. It is lock-guarded (macOS has no `flock`, so this uses an
atomic PID-file lock instead — see `cre-lib.mjs`), so an overlapping run just exits without doing
anything rather than racing. A normal run costs zero LLM tokens — it is plain, deterministic code.

- **Install / update the schedule:** `sh install-collector.sh`
- **Uninstall:** `sh uninstall-collector.sh` (leaves all collected data untouched)
- **Run one collection by hand:** `node execution-viewer.mjs`
- **Logs:** `local/logs/collector.out.log`, `local/logs/collector.err.log`

## What gets stored, and where (all gitignored, none of it committed)

| File | What |
|---|---|
| `local/execution-history.jsonl` | one line per fully-observed execution — append-only, never rewritten |
| `local/run-log.jsonl` | one line per collector invocation, for `status.mjs` and staleness checks |
| `local/coverage-gaps.jsonl` | every known gap in history, and every backfill attempt's outcome |
| `local/incidents/*.json` | a compact bundle written only when a deterministic check fails or hits an unknown condition |
| `local/collector.lock` | the PID-file lock, present only while a collection is actually running |

## What "complete" means

A record is only ever written once its status is terminal (`SUCCESS` or `FAILURE`) and all three
sub-fetches (status/events/logs) succeeded. An execution still `TRIGGERED` or `IN_PROGRESS` when
observed, or one reporting a status value outside those four, is left out and retried on the next
run — nothing here ever finalizes a guess about an outcome that hadn't happened yet.

## The known history gap — recovery in progress

`cre execution list` caps at 100 results with no cursor, so between 2026-09-15T00:35:01Z and
2026-09-16T18:20:02Z — before this automatic system existed — roughly 500 production executions
aged out of that window before anything captured them. `backfill.mjs` recovers a gap like this
using the CLI's own `--start`/`--end` time-window flags, split narrow enough to stay under the
100-per-call limit:

```bash
node backfill.mjs <workflow-name> <start-iso> <end-iso> [window-hours]
```

It never infers a missing record from silence — a window that returns nothing is recorded as "the
platform returned nothing for this window," and only marked `unrecoverable` if that holds across
the whole gap. See `local/coverage-gaps.jsonl` for the exact, current recovery status of the known
gap (recovered / partially-recovered / unrecoverable) once a run has completed.

## Coverage protection going forward

Every regular collection run compares the newest-100 window it can currently see against the last
point it has on record. If that point has already scrolled out — a real, already-occurred gap — it
is logged immediately, both to `coverage-gaps.jsonl` and as an incident. If the remaining headroom
is getting thin (currently: under 3 hours), it is surfaced as a warning in `status.mjs` before a
gap actually happens, not after.
