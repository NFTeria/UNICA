/**
 * cre-lib.mjs — shared, read-only plumbing for the local CRE execution observer.
 *
 * EVERY invocation of the `cre` binary from this codebase passes through `cre()` below, and
 * `cre()` refuses anything whose subcommand, action, or flag is not on the explicit allowlist
 * before it ever reaches `execFile`. That is the hard safety boundary in code, not just in
 * prose: a future bug or typo here cannot accidentally deploy, activate, pause, sign, broadcast,
 * or touch a secret, because the only reachable subcommand is "execution" and the only reachable
 * actions are list/status/events/logs. `cre-lib.test.mjs` proves this by sabotage — it calls this
 * same chokepoint with a forbidden command and asserts it throws before any process is spawned.
 *
 * WHAT "COMPLETE" MEANS, AND WHY IT MATTERS. A record is only ever persisted to the JSONL store
 * when every sub-fetch succeeded AND the execution's own status is terminal (SUCCESS or FAILURE).
 * An execution still TRIGGERED or IN_PROGRESS when we happen to query it is left unpersisted and
 * unmarked-seen on purpose, so a later run — not this one — is the one that records its real
 * outcome. Nothing here ever finalizes a guess.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  openSync,
  writeSync,
  closeSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

export const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = join(HERE, "local");
export const OUT_FILE = join(OUT_DIR, "execution-history.jsonl");
export const LOCK_FILE = join(OUT_DIR, "collector.lock");
export const RUN_LOG_FILE = join(OUT_DIR, "run-log.jsonl");
export const COVERAGE_GAPS_FILE = join(OUT_DIR, "coverage-gaps.jsonl");
export const INCIDENTS_DIR = join(OUT_DIR, "incidents");
export const LOGS_DIR = join(OUT_DIR, "logs");

export const DEFAULT_WORKFLOWS = ["unica-treasury-guardian-staging", "unica-treasury-guardian"];
export const PRODUCTION_WORKFLOW = "unica-treasury-guardian";

/** Single source of truth for the launchd job's identifier — install-collector.sh reads this same
 *  value via a one-line `node -e` call rather than hard-coding a second copy that could drift. */
export const LAUNCHD_LABEL = "click.nfteria.unica.cre-collector";

/**
 * `cre execution list` caps at 100 (its own documented maximum; default is 20) with no cursor,
 * so a workflow past 100 executions cannot be fully listed by one call. This is the source of the
 * 2026-09-15/16 coverage gap this system exists to prevent from recurring silently.
 */
export const LIST_LIMIT = 100;

/** Read/write cadence assumptions used only for the coverage-warning threshold, never for guessing data. */
export const COLLECTION_INTERVAL_MS = 60 * 60 * 1000; // matches the launchd StartInterval
export const COVERAGE_WARNING_HEADROOM_MS = 3 * 60 * 60 * 1000; // warn with less than 3h of buffer left
export const STALE_AFTER_MS = 15 * 60 * 1000; // Phase 3.9's own 15-minute threshold
export const LOCK_STALE_AFTER_MS = 55 * 60 * 1000; // just under the hourly cadence

export const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILURE"]);
export const NON_TERMINAL_STATUSES = new Set(["TRIGGERED", "IN_PROGRESS"]);

// ── the allowlist — the one place every `cre` call is checked before it runs ───────────────────

const ALLOWED_SUBCOMMAND = "execution";
const ALLOWED_ACTIONS = new Set(["list", "status", "events", "logs"]);
const ALLOWED_FLAGS = new Set(["--json", "--limit", "--start", "--end", "--status"]);

export function assertAllowed(args) {
  if (args[0] !== ALLOWED_SUBCOMMAND) {
    throw new Error(`refused: subcommand "${args[0]}" is not on the allowlist — only "execution" is permitted`);
  }
  if (!ALLOWED_ACTIONS.has(args[1])) {
    throw new Error(`refused: action "${args[1]}" is not on the allowlist (${[...ALLOWED_ACTIONS].join(", ")})`);
  }
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (typeof a === "string" && a.startsWith("--")) {
      const flagName = a.split("=")[0];
      if (!ALLOWED_FLAGS.has(flagName)) {
        throw new Error(`refused: flag "${flagName}" is not on the allowlist`);
      }
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry(fn, { attempts = 3, baseDelayMs = 1000, label = "operation" } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr.message}`);
}

/** The sole chokepoint. Every `cre` invocation in this codebase goes through this function. */
export async function cre(args, { retry = true } = {}) {
  assertAllowed(args);
  const run = () =>
    execFileAsync("cre", args, { timeout: 30_000, maxBuffer: 20 * 1024 * 1024 }).then((r) => r.stdout);
  return retry ? withRetry(run, { attempts: 3, baseDelayMs: 1000, label: `cre ${args.join(" ")}` }) : run();
}

/**
 * `cre ... --json` prints progress lines before the JSON and sometimes a notice after it.
 * Scanning for a bracket-balanced value — aware of strings, so a `{` inside a log message can't
 * end the scan early — survives both, rather than assuming the JSON is the whole trimmed output.
 */
export function extractJson(text) {
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error(`no JSON found in: ${text.slice(0, 200)}`);
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error(`unbalanced JSON in: ${text.slice(0, 200)}`);
}

export async function creJson(args, opts) {
  const raw = await cre(args, opts);
  return extractJson(raw);
}

/** Strips anything credential- or path-shaped before a message is ever persisted to a local file. */
export function sanitize(text) {
  if (!text) return text;
  return String(text)
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted-long-token]")
    .slice(0, 2000);
}

export function classifyStatus(status) {
  if (TERMINAL_STATUSES.has(status)) return "terminal";
  if (NON_TERMINAL_STATUSES.has(status)) return "non-terminal";
  return "unknown";
}

/** The decision line(s) and the set of nodes that logged anything, from `cre execution logs`. */
export function summarizeLogs(logs) {
  const decisions = new Set();
  const nodes = new Set();
  for (const entry of Array.isArray(logs) ? logs : []) {
    if (entry.nodeID) nodes.add(entry.nodeID);
    const m = /^unica-guardian-decision:(.+)$/.exec(entry.message ?? "");
    if (m) decisions.add(m[1]);
  }
  return { decisions: [...decisions], nodeCount: nodes.size };
}

/**
 * Fetch status/events/logs for one execution and extract the non-secret fields. `complete` is
 * false whenever a sub-fetch itself failed (after retries) or the execution's status is not yet
 * terminal or is an unrecognized value — in every one of those cases the record is NOT persisted
 * by the caller, so a later run re-fetches it rather than freezing a guess into the store.
 */
export async function buildRecord(workflowName, uuid, injectedFetchers = {}) {
  const doStatus = injectedFetchers.fetchStatus ?? (() => creJson(["execution", "status", uuid, "--json"]));
  const doEvents = injectedFetchers.fetchEvents ?? (() => creJson(["execution", "events", uuid, "--json"]));
  const doLogs = injectedFetchers.fetchLogs ?? (() => creJson(["execution", "logs", uuid, "--json"]));

  const warnings = [];
  let status = null,
    events = [],
    logs = [];
  let fetchFailed = false;

  try {
    status = await doStatus();
  } catch (e) {
    warnings.push(`status fetch failed: ${sanitize(e.message)}`);
    fetchFailed = true;
  }
  try {
    events = await doEvents();
  } catch (e) {
    warnings.push(`events fetch failed: ${sanitize(e.message)}`);
    fetchFailed = true;
  }
  try {
    logs = await doLogs();
  } catch (e) {
    warnings.push(`logs fetch failed: ${sanitize(e.message)}`);
    fetchFailed = true;
  }

  for (const e of status?.errors ?? []) warnings.push(`${sanitize(e.error)} (x${e.count})`);

  const { decisions, nodeCount } = summarizeLogs(logs);
  let actionClass = null;
  if (decisions.length === 1) actionClass = decisions[0];
  else if (decisions.length > 1) warnings.push(`node disagreement on decision: ${decisions.join(", ")}`);

  const eventLabels = (Array.isArray(events) ? events : []).map((ev) => `${ev.capabilityID}:${ev.status}`);

  const statusValue = status?.status ?? null;
  const statusClass = fetchFailed ? "unknown" : statusValue ? classifyStatus(statusValue) : "unknown";
  if (!fetchFailed) {
    if (statusClass === "non-terminal") warnings.push(`execution not yet terminal (${statusValue})`);
    else if (statusClass === "unknown") warnings.push(`unrecognized status value: ${statusValue ?? "(none)"}`);
    else if (statusClass === "terminal" && statusValue === "SUCCESS" && decisions.length === 0) {
      warnings.push("no decision logged despite SUCCESS status");
    }
  }

  const complete = !fetchFailed && statusClass === "terminal";

  return {
    workflowName,
    executionUuid: uuid,
    startedAt: status?.startedAt ?? null,
    finishedAt: status?.finishedAt ?? null,
    status: statusValue ?? "UNKNOWN",
    actionClass,
    nodeCount,
    eventLabels,
    warnings,
    complete,
    fetchedAt: new Date().toISOString(),
  };
}

// ── local storage ────────────────────────────────────────────────────────────────────────────

export function ensureDirs() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(INCIDENTS_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a malformed line from an interrupted write is skipped, not fatal to the rest of the file
    }
  }
  return out;
}

export function loadAllRecords() {
  return readJsonl(OUT_FILE);
}

/** Every UUID this store already has complete, terminal data for. */
export function loadSeen() {
  return new Set(loadAllRecords().map((r) => r.executionUuid));
}

export function appendRecord(record) {
  ensureDirs();
  appendFileSync(OUT_FILE, JSON.stringify(record) + "\n");
}

export function appendRunLog(entry) {
  ensureDirs();
  appendFileSync(RUN_LOG_FILE, JSON.stringify(entry) + "\n");
}

export function loadRunLog() {
  return readJsonl(RUN_LOG_FILE);
}

export function appendCoverageGap(entry) {
  ensureDirs();
  appendFileSync(COVERAGE_GAPS_FILE, JSON.stringify(entry) + "\n");
}

export function loadCoverageGaps() {
  return readJsonl(COVERAGE_GAPS_FILE);
}

export function writeIncident(category, details) {
  ensureDirs();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(INCIDENTS_DIR, `${ts}-${category}.json`);
  const bundle = {
    failureCategory: category,
    timestamp: new Date().toISOString(),
    lastSuccessfulCollection: (() => {
      const runs = loadRunLog().filter((r) => r.ok);
      return runs.length ? runs[runs.length - 1].finishedAt : null;
    })(),
    lastObservedExecutionUuid: (() => {
      const rows = loadAllRecords();
      if (!rows.length) return null;
      return rows.reduce((a, b) => ((a.startedAt ?? "") > (b.startedAt ?? "") ? a : b)).executionUuid;
    })(),
    suggestedReadOnlyNextStep:
      SUGGESTED_STEPS[category] ?? "run `node status.mjs` and inspect the newest incident bundle under local/incidents/",
    details,
  };
  appendFileSync(path, JSON.stringify(bundle, null, 2));
  return path;
}

const SUGGESTED_STEPS = {
  LIST_FAILED: "run `cre execution list <workflow-name> --json` by hand to see the live error",
  COVERAGE_GAP_DETECTED: "run backfill.mjs with the gap's start/end to attempt recovery via time-windowed queries",
  UNKNOWN_STATUS: "run `cre execution status <uuid> --json` by hand and check the CLI's release notes for a new status value",
  COLLECTOR_CRASHED: "run `node execution-viewer.mjs` by hand in the foreground and read the full error",
};

// ── coverage check (Phase 3.10) ─────────────────────────────────────────────────────────────

/**
 * Compares what we already have locally against what a fresh, untimed `list` call can currently
 * reach. Returns a NEW gap only when our last-known point has already scrolled out of the newest-
 * LIST_LIMIT window (a fact, not a guess), or a warning when the remaining headroom is getting
 * thin — before that happens, not after.
 */
export function checkCoverage(workflowName, freshList, allRows = loadAllRecords()) {
  const rows = allRows.filter((r) => r.workflowName === workflowName && r.startedAt);
  if (rows.length === 0) return { newGap: null, warning: null }; // nothing collected yet — no claim to make
  const lastKnown = rows.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));

  const times = (Array.isArray(freshList) ? freshList : []).map((i) => i.startedAt).filter(Boolean);
  if (times.length === 0) return { newGap: null, warning: null };
  const oldestVisible = times.reduce((a, b) => (a < b ? a : b));

  if (lastKnown.startedAt < oldestVisible) {
    return {
      newGap: {
        workflowName,
        gapStart: lastKnown.startedAt,
        gapEnd: oldestVisible,
        discoveredAt: new Date().toISOString(),
        status: "unrecoverable-via-plain-list",
      },
      warning: null,
    };
  }

  const headroomMs = Date.parse(lastKnown.startedAt) - Date.parse(oldestVisible);
  if (headroomMs < COVERAGE_WARNING_HEADROOM_MS) {
    return {
      newGap: null,
      warning: {
        workflowName,
        headroomMinutes: Math.round(headroomMs / 60000),
        message: `only ${Math.round(headroomMs / 60000)} minutes of newest-${LIST_LIMIT} headroom left before the next collection would need to reach further back than a plain list call can see`,
      },
    };
  }
  return { newGap: null, warning: null };
}

// ── locking (Phase 3.2) — macOS has no `flock`; this is an atomic PID-file lock instead ────────

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock() {
  ensureDirs();
  try {
    const fd = openSync(LOCK_FILE, "wx");
    writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let info = null;
    try {
      info = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
    } catch {
      // an unreadable lock file is treated as stale below
    }
    const alive = info?.pid ? isPidAlive(info.pid) : false;
    let age = Infinity;
    try {
      age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    } catch {
      // file vanished between the EEXIST and this stat — try again fresh
    }
    if (!alive || age > LOCK_STALE_AFTER_MS) {
      try {
        unlinkSync(LOCK_FILE);
      } catch {
        // another process may have already reclaimed it — fall through and retry
      }
      return acquireLock();
    }
    return false; // genuinely still running elsewhere
  }
}

export function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // already gone — nothing to release
  }
}

export function lockInfo() {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    const info = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    return { ...info, alive: isPidAlive(info.pid), ageMs: age };
  } catch {
    return { corrupt: true };
  }
}
