#!/usr/bin/env node
/**
 * execution-viewer.mjs — the automatic, hourly collection run.
 *
 * Meant to be invoked by the launchd job installed by install-collector.sh, not run by hand every
 * time — see OBSERVER.md and status.mjs for the human-facing side of this system. It is safe to
 * run it by hand too: it is idempotent (see cre-lib.mjs's loadSeen/complete logic) and lock-guarded
 * against overlapping runs.
 *
 * ZERO LLM TOKENS ON A NORMAL RUN. This script never calls any model. On a deterministic failure
 * it writes a small incident bundle to local/incidents/ and stops — see cre-lib.mjs's
 * writeIncident(). Reading and acting on that bundle, if anyone ever does, is a separate, human-
 * or agent-initiated step.
 *
 * USAGE.
 *   node execution-viewer.mjs                                   # both known workflows
 *   node execution-viewer.mjs unica-treasury-guardian-staging    # one workflow by name
 */

import * as lib from "./cre-lib.mjs";

async function collectWorkflow(name) {
  const wfOutcome = { newRecords: 0, skippedForRetry: 0, listFailed: false, coverageWarning: null, newGap: null };

  let list;
  try {
    list = await lib.creJson(["execution", "list", name, "--json", "--limit", String(lib.LIST_LIMIT)]);
  } catch (e) {
    wfOutcome.listFailed = true;
    lib.writeIncident("LIST_FAILED", { workflowName: name, error: lib.sanitize(e.message) });
    return wfOutcome;
  }

  const coverage = lib.checkCoverage(name, list);
  if (coverage.newGap) {
    lib.appendCoverageGap(coverage.newGap);
    wfOutcome.newGap = coverage.newGap;
    lib.writeIncident("COVERAGE_GAP_DETECTED", coverage.newGap);
  } else if (coverage.warning) {
    wfOutcome.coverageWarning = coverage.warning;
  }

  const seen = lib.loadSeen();
  for (const item of Array.isArray(list) ? list : []) {
    if (seen.has(item.uuid)) continue;
    const record = await lib.buildRecord(name, item.uuid);
    if (!record.complete) {
      wfOutcome.skippedForRetry++;
      if (record.warnings.some((w) => w.startsWith("unrecognized status value"))) {
        lib.writeIncident("UNKNOWN_STATUS", { workflowName: name, executionUuid: item.uuid, record });
      }
      continue;
    }
    lib.appendRecord(record);
    seen.add(item.uuid);
    wfOutcome.newRecords++;
  }
  return wfOutcome;
}

async function main() {
  const workflowNames = process.argv.slice(2).length > 0 ? process.argv.slice(2) : lib.DEFAULT_WORKFLOWS;
  const gotLock = lib.acquireLock();
  if (!gotLock) {
    console.log("another collection is already running — exiting without doing work (this is normal, not an error)");
    return;
  }

  const runStartedAt = new Date().toISOString();
  const outcome = { runStartedAt, workflows: workflowNames, perWorkflow: {}, ok: true };
  try {
    for (const name of workflowNames) {
      outcome.perWorkflow[name] = await collectWorkflow(name);
    }
  } catch (e) {
    outcome.ok = false;
    outcome.error = lib.sanitize(e.message);
    lib.writeIncident("COLLECTOR_CRASHED", { error: lib.sanitize(e.message), stack: lib.sanitize(String(e.stack ?? "")) });
  } finally {
    outcome.finishedAt = new Date().toISOString();
    lib.appendRunLog(outcome);
    lib.releaseLock();
  }

  console.log(JSON.stringify(outcome, null, 2));
  if (!outcome.ok) process.exitCode = 1;
}

main().catch((e) => {
  // A failure this late (e.g. releasing a lock that somehow vanished) is still reported, never silent.
  console.error(`execution-viewer failed: ${e.message}`);
  process.exitCode = 1;
});
