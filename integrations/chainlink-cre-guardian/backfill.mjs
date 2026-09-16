#!/usr/bin/env node
/**
 * backfill.mjs — attempt to recover a known coverage gap using `cre execution list`'s
 * `--start`/`--end` time-window flags, confirmed to exist in the local CLI's own --help output.
 *
 * NEVER INFERS. If a window returns nothing, that is recorded as "the platform returned nothing
 * for this window" — it is never reported or stored as "no executions happened." Whether the
 * platform still retains data that far back is exactly the open question this script answers by
 * observation, not assumption.
 *
 * The interval is split into windows narrow enough to stay comfortably under the CLI's own
 * 100-per-call maximum, since a window that itself exceeds 100 would silently truncate — the same
 * failure mode this whole system exists to stop.
 *
 * USAGE.
 *   node backfill.mjs <workflow-name> <start-iso> <end-iso> [window-hours]
 *   node backfill.mjs unica-treasury-guardian 2026-09-15T00:35:01Z 2026-09-16T18:20:02Z
 */

import * as lib from "./cre-lib.mjs";

function parseArgs() {
  const [workflowName, startIso, endIso, windowHoursArg] = process.argv.slice(2);
  if (!workflowName || !startIso || !endIso) {
    console.error("usage: node backfill.mjs <workflow-name> <start-iso> <end-iso> [window-hours]");
    process.exit(2);
  }
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start) || isNaN(end) || start >= end) {
    console.error("start/end must be valid ISO8601 timestamps with start < end");
    process.exit(2);
  }
  // Default 4h windows: at the observed ~12/hour production cadence that is ~48 per window,
  // comfortably under the 100 cap even allowing for a burst.
  const windowHours = windowHoursArg ? Number(windowHoursArg) : 4;
  if (!(windowHours > 0)) {
    console.error("window-hours must be a positive number");
    process.exit(2);
  }
  return { workflowName, start, end, windowMs: windowHours * 3600 * 1000 };
}

function splitWindows(start, end, windowMs) {
  const windows = [];
  let cursor = start.getTime();
  const endMs = end.getTime();
  while (cursor < endMs) {
    const next = Math.min(cursor + windowMs, endMs);
    windows.push([new Date(cursor).toISOString(), new Date(next).toISOString()]);
    cursor = next;
  }
  return windows;
}

async function main() {
  const { workflowName, start, end, windowMs } = parseArgs();
  const windows = splitWindows(start, end, windowMs);
  console.log(`attempting backfill for "${workflowName}"`);
  console.log(`  gap:     ${start.toISOString()} .. ${end.toISOString()}`);
  console.log(`  windows: ${windows.length} at ${(windowMs / 3600000).toFixed(1)}h each`);
  console.log();

  const seen = lib.loadSeen();
  let totalListed = 0;
  let totalNew = 0;
  let windowsWithData = 0;
  let windowsEmpty = 0;
  const perWindow = [];

  for (const [wStart, wEnd] of windows) {
    let list;
    try {
      list = await lib.creJson(["execution", "list", workflowName, "--json", "--start", wStart, "--end", wEnd, "--limit", String(lib.LIST_LIMIT)]);
    } catch (e) {
      console.log(`  [${wStart} .. ${wEnd}] list FAILED: ${lib.sanitize(e.message)}`);
      perWindow.push({ wStart, wEnd, result: "list-failed", error: lib.sanitize(e.message) });
      continue;
    }
    const items = Array.isArray(list) ? list : [];
    totalListed += items.length;
    if (items.length === 0) {
      windowsEmpty++;
      console.log(`  [${wStart} .. ${wEnd}] 0 executions returned`);
      perWindow.push({ wStart, wEnd, result: "empty", count: 0 });
      continue;
    }
    windowsWithData++;
    let newInWindow = 0;
    for (const item of items) {
      if (seen.has(item.uuid)) continue;
      const record = await lib.buildRecord(workflowName, item.uuid);
      if (!record.complete) continue; // left for the regular collector to retry, same rule as always
      lib.appendRecord(record);
      seen.add(item.uuid);
      newInWindow++;
      totalNew++;
    }
    console.log(`  [${wStart} .. ${wEnd}] ${items.length} returned, ${newInWindow} new`);
    perWindow.push({ wStart, wEnd, result: "data", count: items.length, new: newInWindow });
  }

  console.log();
  console.log(`totals: ${windows.length} windows queried, ${windowsWithData} returned data, ${windowsEmpty} returned nothing`);
  console.log(`        ${totalListed} executions listed across all windows, ${totalNew} new records recovered`);

  const fullyRecovered = windowsEmpty === 0 && windowsWithData === windows.length;
  const partiallyRecovered = totalNew > 0 && !fullyRecovered;
  const status = fullyRecovered ? "recovered" : partiallyRecovered ? "partially-recovered" : "unrecoverable";

  lib.appendCoverageGap({
    workflowName,
    gapStart: start.toISOString(),
    gapEnd: end.toISOString(),
    discoveredAt: new Date().toISOString(),
    backfillAttemptedAt: new Date().toISOString(),
    status,
    recoveredCount: totalNew,
    windowsQueried: windows.length,
    windowsWithData,
    windowsEmpty,
    note:
      status === "unrecoverable"
        ? "every window in this range returned zero executions — the platform's `execution list` endpoint does not appear to retain or serve data this old, even with explicit --start/--end. This is an observation, not an assumption: it means no data was returned, not that no executions happened."
        : status === "partially-recovered"
          ? "some windows returned data and some did not — the retained-history boundary likely falls inside this range."
          : "every window returned data; the gap should now be fully covered.",
  });

  console.log();
  console.log(`recorded to ${lib.COVERAGE_GAPS_FILE} as: ${status}`);
}

main().catch((e) => {
  console.error(`backfill failed: ${e.message}`);
  process.exitCode = 1;
});
