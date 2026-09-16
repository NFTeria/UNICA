#!/usr/bin/env node
/**
 * status.mjs — the one command a person actually needs to run: is the observer healthy right now.
 *
 * Purely local reads (the JSONL store, the run log, the coverage-gap log, the lock file) plus one
 * read-only `launchctl print` to check the scheduler's own state. Exits nonzero when production
 * data is stale, the scheduler is not loaded, or the most recent collection run reported it is
 * running low on newest-100 headroom — the three conditions that mean this system needs a look.
 *
 * USAGE.
 *   node status.mjs            # human-readable report
 *   node status.mjs --json     # the same facts as one JSON object
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as lib from "./cre-lib.mjs";

const execFileAsync = promisify(execFile);
const asJson = process.argv.includes("--json");

async function schedulerHealth() {
  try {
    const { stdout } = await execFileAsync("launchctl", ["print", `gui/${process.getuid()}/${lib.LAUNCHD_LABEL}`], {
      timeout: 10_000,
    });
    const running = /state = running/.test(stdout);
    const lastExitMatch = stdout.match(/last exit code = (-?\d+)/);
    return {
      installed: true,
      running,
      lastExitCode: lastExitMatch ? Number(lastExitMatch[1]) : null,
    };
  } catch {
    return { installed: false, running: false, lastExitCode: null };
  }
}

function latestRecordFor(workflowName, rows) {
  const filtered = rows.filter((r) => r.workflowName === workflowName && r.startedAt);
  if (filtered.length === 0) return null;
  return filtered.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));
}

async function main() {
  const rows = lib.loadAllRecords();
  const runLog = lib.loadRunLog();
  const gaps = lib.loadCoverageGaps();
  const lock = lib.lockInfo();
  const scheduler = await schedulerHealth();

  const lastRun = runLog.length ? runLog[runLog.length - 1] : null;
  const lastSuccessfulRun = [...runLog].reverse().find((r) => r.ok) ?? null;

  const prodLatest = latestRecordFor(lib.PRODUCTION_WORKFLOW, rows);
  const stagingLatest = latestRecordFor("unica-treasury-guardian-staging", rows);

  const now = Date.now();
  const prodAgeMs = prodLatest?.startedAt ? now - Date.parse(prodLatest.startedAt) : Infinity;
  const prodStale = prodAgeMs > lib.STALE_AFTER_MS;

  const totalWarnings = rows.reduce((n, r) => n + (r.warnings?.length ?? 0), 0);

  const unresolvedGaps = gaps.filter((g) => g.status !== "recovered");
  const latestCoverageWarning = lastRun?.perWorkflow
    ? Object.entries(lastRun.perWorkflow)
        .filter(([, wf]) => wf.coverageWarning)
        .map(([name, wf]) => ({ workflowName: name, ...wf.coverageWarning }))
    : [];

  const problems = [];
  if (prodStale) problems.push(`no completed production execution observed in the last ${Math.round(prodAgeMs / 60000)} minutes (threshold: ${lib.STALE_AFTER_MS / 60000})`);
  if (!scheduler.installed) problems.push("launchd job is not installed/loaded");
  else if (scheduler.lastExitCode != null && scheduler.lastExitCode !== 0) problems.push(`last scheduled run exited ${scheduler.lastExitCode}`);
  if (latestCoverageWarning.length > 0) problems.push(`newest-100 headroom is shrinking for: ${latestCoverageWarning.map((w) => w.workflowName).join(", ")}`);

  const report = {
    observer: {
      totalRecords: rows.length,
      totalWarnings,
      lastRunAt: lastRun?.finishedAt ?? null,
      lastRunOk: lastRun?.ok ?? null,
      lastSuccessfulRunAt: lastSuccessfulRun?.finishedAt ?? null,
      lockHeld: !!lock,
      lockInfo: lock,
    },
    scheduler,
    production: {
      lastObservedExecutionUuid: prodLatest?.executionUuid ?? null,
      lastStatus: prodLatest?.status ?? null,
      lastActionClass: prodLatest?.actionClass ?? null,
      lastStartedAt: prodLatest?.startedAt ?? null,
      ageMinutes: Number.isFinite(prodAgeMs) ? Math.round(prodAgeMs / 60000) : null,
      stale: prodStale,
    },
    staging: {
      lastObservedExecutionUuid: stagingLatest?.executionUuid ?? null,
      lastStatus: stagingLatest?.status ?? null,
      lastActionClass: stagingLatest?.actionClass ?? null,
      lastStartedAt: stagingLatest?.startedAt ?? null,
    },
    coverage: {
      unresolvedGapCount: unresolvedGaps.length,
      unresolvedGaps: unresolvedGaps.map((g) => ({ workflowName: g.workflowName, gapStart: g.gapStart, gapEnd: g.gapEnd, status: g.status })),
      currentHeadroomWarnings: latestCoverageWarning,
    },
    current: problems.length === 0,
    problems,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Observer health:   ${report.observer.lastRunOk === null ? "no runs yet" : report.observer.lastRunOk ? "ok" : "LAST RUN FAILED"}`);
    console.log(`  total records:     ${report.observer.totalRecords}  (${report.observer.totalWarnings} carry a warning)`);
    console.log(`  last run:          ${report.observer.lastRunAt ?? "never"}`);
    console.log(`  last successful:   ${report.observer.lastSuccessfulRunAt ?? "never"}`);
    console.log(`  lock:              ${lock ? `held by pid ${lock.pid} (${lock.alive ? "alive" : "dead"}, ${Math.round(lock.ageMs / 1000)}s old)` : "free"}`);
    console.log();
    console.log(`Scheduler:         ${scheduler.installed ? (scheduler.running ? "loaded, running" : "loaded, idle") : "NOT INSTALLED"}${scheduler.lastExitCode != null ? `  (last exit ${scheduler.lastExitCode})` : ""}`);
    console.log();
    console.log(`Production (${lib.PRODUCTION_WORKFLOW}):`);
    console.log(`  last execution:    ${report.production.lastObservedExecutionUuid ?? "(none observed)"}`);
    console.log(`  status / decision: ${report.production.lastStatus ?? "-"} / ${report.production.lastActionClass ?? "-"}`);
    console.log(`  observed at:       ${report.production.lastStartedAt ?? "-"}  (${report.production.ageMinutes ?? "?"} min ago)${report.production.stale ? "  ⚠ STALE" : ""}`);
    console.log();
    console.log(`Staging (unica-treasury-guardian-staging):`);
    console.log(`  last execution:    ${report.staging.lastObservedExecutionUuid ?? "(none observed)"}`);
    console.log(`  status / decision: ${report.staging.lastStatus ?? "-"} / ${report.staging.lastActionClass ?? "-"}`);
    console.log();
    console.log(`Coverage gaps:     ${report.coverage.unresolvedGapCount} unresolved`);
    for (const g of report.coverage.unresolvedGaps) console.log(`  - ${g.workflowName}: ${g.gapStart} .. ${g.gapEnd}  (${g.status})`);
    for (const w of report.coverage.currentHeadroomWarnings) console.log(`  ⚠ ${w.workflowName}: ${w.message}`);
    console.log();
    console.log(report.current ? "CURRENT — no known problems." : `NOT CURRENT:`);
    for (const p of report.problems) console.log(`  - ${p}`);
  }

  process.exitCode = report.current ? 0 : 1;
}

main().catch((e) => {
  console.error(`status failed: ${e.message}`);
  process.exitCode = 1;
});
