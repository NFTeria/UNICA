// cre-lib.test.mjs — offline. No `cre` binary is invoked; no CRE or blockchain state is touched.
//
// THE ONE TEST THAT MATTERS MOST IS THE SABOTAGE CONTROL BELOW: it proves the allowlist actually
// refuses a forbidden command, by trying one, rather than merely asserting the allowlist "looks
// right" by inspection.

import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import * as lib from "./cre-lib.mjs";

// ── extractJson ──────────────────────────────────────────────────────────────────────────────

test("extractJson pulls the JSON out from between CLI progress noise", () => {
  const text = 'Initializing...\nFetching...\n{"a":1,"b":[1,2,3]}\n';
  assert.deepEqual(lib.extractJson(text), { a: 1, b: [1, 2, 3] });
});

test("extractJson survives trailing content after the JSON", () => {
  const text = '[{"a":1}]\n\n⚠️  Update available!';
  assert.deepEqual(lib.extractJson(text), [{ a: 1 }]);
});

test("extractJson is not fooled by a brace inside a string value", () => {
  const text = '{"message":"unica-guardian-decision:{weird}","x":2}';
  assert.deepEqual(lib.extractJson(text), { message: "unica-guardian-decision:{weird}", x: 2 });
});

test("extractJson throws when there is no JSON at all", () => {
  assert.throws(() => lib.extractJson("no json here"));
});

// ── the allowlist — proven by sabotage, not by inspection ──────────────────────────────────────

test("the allowlist accepts every command this system actually uses", () => {
  assert.doesNotThrow(() => lib.assertAllowed(["execution", "list", "some-workflow", "--json", "--limit", "100"]));
  assert.doesNotThrow(() => lib.assertAllowed(["execution", "status", "some-uuid", "--json"]));
  assert.doesNotThrow(() => lib.assertAllowed(["execution", "events", "some-uuid", "--json"]));
  assert.doesNotThrow(() => lib.assertAllowed(["execution", "logs", "some-uuid", "--json"]));
  assert.doesNotThrow(() => lib.assertAllowed(["execution", "list", "wf", "--start", "2026-01-01T00:00:00Z", "--end", "2026-01-02T00:00:00Z"]));
});

test("SABOTAGE: the allowlist refuses a state-changing subcommand", () => {
  assert.throws(() => lib.assertAllowed(["workflow", "deploy", "workflow"]), /not on the allowlist/);
  assert.throws(() => lib.assertAllowed(["workflow", "activate", "workflow"]), /not on the allowlist/);
  assert.throws(() => lib.assertAllowed(["workflow", "pause", "workflow"]), /not on the allowlist/);
  assert.throws(() => lib.assertAllowed(["secrets", "create", "secret-names.yaml"]), /not on the allowlist/);
  assert.throws(() => lib.assertAllowed(["secrets", "list"]), /not on the allowlist/);
});

test("SABOTAGE: the allowlist refuses a forbidden action even under the allowed subcommand", () => {
  assert.throws(() => lib.assertAllowed(["execution", "delete", "some-uuid"]), /not on the allowlist/);
});

test("SABOTAGE: the allowlist refuses a forbidden flag even on an allowed action", () => {
  assert.throws(() => lib.assertAllowed(["execution", "list", "wf", "--yes"]), /not on the allowlist/);
  assert.throws(() => lib.assertAllowed(["execution", "status", "uuid", "--unsigned"]), /not on the allowlist/);
});

// ── status classification ───────────────────────────────────────────────────────────────────

test("classifyStatus sorts the CLI's own four documented values correctly", () => {
  assert.equal(lib.classifyStatus("SUCCESS"), "terminal");
  assert.equal(lib.classifyStatus("FAILURE"), "terminal");
  assert.equal(lib.classifyStatus("TRIGGERED"), "non-terminal");
  assert.equal(lib.classifyStatus("IN_PROGRESS"), "non-terminal");
});

test("classifyStatus treats anything else as unknown, not silently as one of the known four", () => {
  assert.equal(lib.classifyStatus("CANCELLED"), "unknown"); // a plausible future CLI addition
  assert.equal(lib.classifyStatus(undefined), "unknown");
  assert.equal(lib.classifyStatus(null), "unknown");
});

// ── summarizeLogs ────────────────────────────────────────────────────────────────────────────

test("summarizeLogs extracts one decision and counts distinct nodes", () => {
  const logs = [
    { nodeID: "Node 1", message: "unica-guardian-secrets-loaded" },
    { nodeID: "Node 1", message: "unica-guardian-decision:RESTORE_MINIMUM_RESERVE" },
    { nodeID: "Node 2", message: "unica-guardian-secrets-loaded" },
    { nodeID: "Node 2", message: "unica-guardian-decision:RESTORE_MINIMUM_RESERVE" },
  ];
  const { decisions, nodeCount } = lib.summarizeLogs(logs);
  assert.deepEqual(decisions, ["RESTORE_MINIMUM_RESERVE"]);
  assert.equal(nodeCount, 2);
});

test("summarizeLogs reports every distinct decision when nodes disagree, rather than picking one", () => {
  const logs = [
    { nodeID: "Node 1", message: "unica-guardian-decision:RESTORE_MINIMUM_RESERVE" },
    { nodeID: "Node 2", message: "unica-guardian-decision:HOLD_SETTLEMENT_ASSET" },
  ];
  const { decisions } = lib.summarizeLogs(logs);
  assert.deepEqual(decisions.sort(), ["HOLD_SETTLEMENT_ASSET", "RESTORE_MINIMUM_RESERVE"]);
});

test("summarizeLogs on an empty or missing log array reports nothing, not a crash", () => {
  assert.deepEqual(lib.summarizeLogs([]), { decisions: [], nodeCount: 0 });
  assert.deepEqual(lib.summarizeLogs(undefined), { decisions: [], nodeCount: 0 });
});

// ── buildRecord, with injected fetchers — no real `cre` call anywhere in this file ─────────────

const successStatus = (uuid) => ({
  uuid,
  status: "SUCCESS",
  startedAt: "2026-09-17T00:00:00Z",
  finishedAt: "2026-09-17T00:00:10Z",
});
const successLogs = () => [
  { nodeID: "Node 1", message: "unica-guardian-decision:RESTORE_MINIMUM_RESERVE" },
];
const successEvents = () => [{ capabilityID: "trigger", status: "success" }];

test("buildRecord marks a SUCCESS execution with a logged decision as complete", async () => {
  const record = await lib.buildRecord("wf", "u1", {
    fetchStatus: async () => successStatus("u1"),
    fetchEvents: async () => successEvents(),
    fetchLogs: async () => successLogs(),
  });
  assert.equal(record.complete, true);
  assert.equal(record.status, "SUCCESS");
  assert.equal(record.actionClass, "RESTORE_MINIMUM_RESERVE");
  assert.deepEqual(record.warnings, []);
});

test("buildRecord leaves a TRIGGERED (in-flight) execution incomplete, not finalized as a guess", async () => {
  const record = await lib.buildRecord("wf", "u2", {
    fetchStatus: async () => ({ uuid: "u2", status: "TRIGGERED", startedAt: "2026-09-17T00:00:00Z", finishedAt: null }),
    fetchEvents: async () => [{ capabilityID: "trigger", status: "success" }],
    fetchLogs: async () => [],
  });
  assert.equal(record.complete, false);
  assert.ok(record.warnings.some((w) => w.includes("not yet terminal")));
});

test("buildRecord flags a status value outside the CLI's known four as unknown, not silently accepted", async () => {
  const record = await lib.buildRecord("wf", "u3", {
    fetchStatus: async () => ({ uuid: "u3", status: "CANCELLED", startedAt: "2026-09-17T00:00:00Z" }),
    fetchEvents: async () => [],
    fetchLogs: async () => [],
  });
  assert.equal(record.complete, false);
  assert.ok(record.warnings.some((w) => w.startsWith("unrecognized status value")));
});

test("buildRecord marks a sub-fetch failure as incomplete even if the other two succeeded", async () => {
  const record = await lib.buildRecord("wf", "u4", {
    fetchStatus: async () => successStatus("u4"),
    fetchEvents: async () => successEvents(),
    fetchLogs: async () => {
      throw new Error("transient network error");
    },
  });
  assert.equal(record.complete, false);
  assert.ok(record.warnings.some((w) => w.startsWith("logs fetch failed")));
});

test("VERIFICATION 4: an execution that was TRIGGERED on one call is complete and correct once it reaches SUCCESS on a later call", async () => {
  // Same UUID, two calls in sequence — modeling exactly what the real collector does across two
  // scheduled runs: the first leaves it unpersisted, the second (once the platform has caught up)
  // persists the real outcome.
  const uuid = "u5-in-flight-then-done";
  const first = await lib.buildRecord("wf", uuid, {
    fetchStatus: async () => ({ uuid, status: "TRIGGERED", startedAt: "2026-09-17T00:00:00Z", finishedAt: null }),
    fetchEvents: async () => [{ capabilityID: "trigger", status: "success" }],
    fetchLogs: async () => [],
  });
  assert.equal(first.complete, false, "first observation, mid-flight, must not be persisted");

  const second = await lib.buildRecord("wf", uuid, {
    fetchStatus: async () => successStatus(uuid),
    fetchEvents: async () => successEvents(),
    fetchLogs: async () => successLogs(),
  });
  assert.equal(second.complete, true, "second observation, now terminal, must be complete");
  assert.equal(second.actionClass, "RESTORE_MINIMUM_RESERVE");
});

// ── checkCoverage — pure function over passed-in rows, no real file touched ────────────────────

test("checkCoverage reports no gap and no warning when the last-known record is well inside the visible window", () => {
  const rows = [{ workflowName: "wf", startedAt: "2026-09-17T05:00:00Z", executionUuid: "a" }];
  const freshList = [{ uuid: "a", startedAt: "2026-09-17T00:00:00Z" }, { uuid: "b", startedAt: "2026-09-17T05:00:00Z" }];
  const result = lib.checkCoverage("wf", freshList, rows);
  assert.equal(result.newGap, null);
  assert.equal(result.warning, null);
});

test("checkCoverage detects a real, already-occurred gap when the last-known point has scrolled out of the window", () => {
  const rows = [{ workflowName: "wf", startedAt: "2026-09-15T00:00:00Z", executionUuid: "old" }];
  const freshList = [{ uuid: "new", startedAt: "2026-09-17T00:00:00Z" }]; // window's oldest visible point is now after our last-known point
  const result = lib.checkCoverage("wf", freshList, rows);
  assert.ok(result.newGap, "a gap must be reported");
  assert.equal(result.newGap.gapStart, "2026-09-15T00:00:00Z");
  assert.equal(result.newGap.gapEnd, "2026-09-17T00:00:00Z");
});

test("checkCoverage warns when headroom is thin, before a gap actually occurs", () => {
  const rows = [{ workflowName: "wf", startedAt: "2026-09-17T05:00:00Z", executionUuid: "a" }];
  // oldest visible is only 1 hour before our last-known point — under the 3h warning threshold
  const freshList = [{ uuid: "old", startedAt: "2026-09-17T04:00:00Z" }, { uuid: "a", startedAt: "2026-09-17T05:00:00Z" }];
  const result = lib.checkCoverage("wf", freshList, rows);
  assert.equal(result.newGap, null, "not a gap yet — still visible");
  assert.ok(result.warning, "but headroom is thin enough to warn");
  assert.equal(result.warning.headroomMinutes, 60);
});

test("checkCoverage makes no claim at all when nothing has been collected yet for this workflow", () => {
  const result = lib.checkCoverage("brand-new-workflow", [{ uuid: "x", startedAt: "2026-09-17T00:00:00Z" }], []);
  assert.equal(result.newGap, null);
  assert.equal(result.warning, null);
});

// ── locking — real filesystem, self-contained and self-cleaning ────────────────────────────────

test("acquireLock/releaseLock: exclusive, and a held lock refuses a second acquire", () => {
  lib.releaseLock(); // in case a prior interrupted test left one behind
  assert.equal(lib.acquireLock(), true, "first acquire must succeed");
  assert.equal(lib.acquireLock(), false, "a second acquire while held must be refused, not silently granted");
  const info = lib.lockInfo();
  assert.equal(info.pid, process.pid);
  assert.equal(info.alive, true);
  lib.releaseLock();
  assert.equal(lib.lockInfo(), null, "released lock leaves no trace");
});

test("acquireLock reclaims a lock left by a process that is no longer running", () => {
  lib.releaseLock();
  // A pid that is essentially guaranteed not to exist, written directly the way a real lock file
  // looks, bypassing acquireLock so this test controls exactly what "stale" means here.
  lib.ensureDirs();
  writeFileSync(lib.LOCK_FILE, JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }));
  assert.equal(lib.acquireLock(), true, "a lock held by a dead pid must be reclaimed, not treated as still running");
  lib.releaseLock();
});
