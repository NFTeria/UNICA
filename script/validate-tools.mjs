// UNICA — the tool ledger's validator.
//
// `docs/UNICA-TOOLS.md` is the living description of what UNICA contains, and
// `docs/unica-tools.json` is the same list in a form a machine can read. A ledger nobody checks
// becomes a wish list within a week, so this runs in `make gate` and every row below fails the
// build rather than printing a warning.
//
// THE RULE THAT MATTERS MOST is the last one: a tool's row goes stale the moment its code changes
// without the manifest changing in the same commit. That is what turns "keep the ledger current"
// from an instruction into a check. Without it the statuses drift, and a drifted status is worse
// than no status because it is believed.
//
// Every check proves itself first, against a deliberately broken copy. A validator that has never
// rejected anything is a validator nobody should trust.
//
// Run: node script/validate-tools.mjs

import {readFileSync, existsSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

// Anchor to the repository root. Every path below is relative, and a check that reads whatever
// happens to be in the caller's working directory is a check that can quietly pass against the
// wrong tree — the same defect class as reading a stale artifact or missing an untracked file.
chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import {execFileSync} from "node:child_process";

const JSON_PATH = "docs/unica-tools.json";
const MD_PATH = "docs/UNICA-TOOLS.md";

const ALLOWED_STATUS = [
  "LIVE AND VERIFIED",
  "IMPLEMENTED — LOCAL TESTS",
  "IMPLEMENTED — FORK TESTS",
  "PROTOTYPE",
  "SPECIFIED, NOT IMPLEMENTED",
  "BLOCKED",
  "UNSUPPORTED",
  "RETIRED",
];

/// Claims this repository does not make about itself. Each is an unambiguous assertion rather than
/// a word that happens to appear in honest prose: "USDC only" and "not audited" are fine and must
/// stay fine, so nothing here fires on them.
const BANNED = [
  "production-ready", "production ready", "battle-tested", "battle tested",
  "fully audited", "professionally audited", "independently audited",
  "one of a kind", "one-of-a-kind", "world's first", "the first ever", "first of its kind",
  "sponsor-qualified", "prize-qualified", "qualifies for the prize",
  "guaranteed to", "cannot fail", "bug-free", "bug free",
  "formally verified", "provably secure", "completely secure", "is secure", "is complete",
];

const rows = [];
let failures = 0;
let checks = 0;
// `rows` carries detail lines as well as verdicts, so the count is kept separately. An earlier
// version reported `rows.length` and printed "checks run: 28" for 25 checks plus three detail
// lines — a stated number that was wrong is worse than no number.
function chk(name, ok, detail) {
  checks++;
  rows.push(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    if (detail) for (const d of [].concat(detail)) rows.push(`        ${d}`);
  }
}

// ---- the checks, each a pure function over a manifest so a control can feed it a broken one ----

/// True when this is a shallow clone. Cached: it cannot change while the process runs.
let _shallow = null;
function shallow() {
  if (_shallow === null) {
    try {
      _shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {encoding: "utf8"}).trim() === "true";
    } catch {
      _shallow = false;
    }
  }
  return _shallow;
}

/// TRACKED paths under `paths` with uncommitted content changes, staged or not.
///
/// Untracked files are deliberately excluded, and the exclusion is load-bearing rather than
/// convenient: `vy/src/unica/` carries two contracts the owner keeps out of the tree on purpose,
/// so counting `??` entries would make this rule fire on every run forever, and a guard that is
/// always red is a guard everyone learns to ignore. The rule's claim is about HISTORY — a change
/// to a tool must move the manifest — and a file git is not tracking has not changed the tool.
function dirty(paths) {
  let out = "";
  try {
    out = execFileSync("git", ["status", "--porcelain", "--", ...paths], {encoding: "utf8"});
  } catch {
    return []; // not a git checkout, or git is unavailable: the commit half already handled that
  }
  return out.split("\n").filter(Boolean).filter((l) => !l.startsWith("??"))
    .map((l) => l.slice(3).trim()).filter(Boolean);
}

const CHECKS = {
  status: (m) => m.tools.filter((t) => !ALLOWED_STATUS.includes(t.status)).map((t) => `${t.id}: "${t.status}"`),

  ids: (m) => {
    const bad = [];
    const seen = new Set();
    for (const t of m.tools) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id ?? "")) bad.push(`not kebab-case: ${t.id}`);
      if (seen.has(t.id)) bad.push(`duplicate id: ${t.id}`);
      seen.add(t.id);
    }
    return bad;
  },

  requiredFields: (m) => {
    const need = ["id", "name", "version", "status", "paths", "networks", "dependencies", "tests",
                  "evidence", "limitations", "sponsorRoles", "lastVerifiedCommit"];
    const bad = [];
    for (const t of m.tools) for (const f of need) if (t[f] === undefined) bad.push(`${t.id}: missing ${f}`);
    return bad;
  },

  paths: (m, tracked) => {
    const bad = [];
    for (const t of m.tools) {
      for (const p of t.paths ?? []) {
        if (!existsSync(p)) bad.push(`${t.id}: ${p} does not exist`);
        else if (!tracked.has(p) && !tracked.hasPrefix(p)) bad.push(`${t.id}: ${p} is not tracked by git`);
      }
    }
    return bad;
  },

  tests: (m) => {
    const bad = [];
    for (const t of m.tools) for (const p of t.tests ?? []) if (!existsSync(p)) bad.push(`${t.id}: ${p} does not exist`);
    return bad;
  },

  liveEvidence: (m) => {
    const bad = [];
    for (const t of m.tools) {
      if (t.status !== "LIVE AND VERIFIED") continue;
      const ev = t.evidence ?? [];
      const addr = ev.find((e) => e.kind === "address" && e.chainId);
      const tx = ev.find((e) => e.kind === "transaction" && e.chainId);
      if (!addr) bad.push(`${t.id}: LIVE with no on-chain address carrying a chain id`);
      if (!tx) bad.push(`${t.id}: LIVE with no transaction carrying a chain id`);
    }
    return bad;
  },

  implementedHasTests: (m) =>
    m.tools
      .filter((t) => t.status.startsWith("IMPLEMENTED") && (t.tests ?? []).length === 0)
      .map((t) => `${t.id}: IMPLEMENTED with no test`),

  specifiedClaimsNothing: (m) => {
    const bad = [];
    for (const t of m.tools) {
      if (t.status !== "SPECIFIED, NOT IMPLEMENTED") continue;
      for (const e of t.evidence ?? []) {
        if (e.kind === "address" || e.kind === "transaction") {
          bad.push(`${t.id}: SPECIFIED but claims a deployed ${e.kind}`);
        }
      }
      if ((t.networks ?? []).length) bad.push(`${t.id}: SPECIFIED but claims a network`);
    }
    return bad;
  },

  noUnsupportedClaims: (m, _tracked, mdText) => {
    const bad = [];
    const haystacks = [JSON.stringify(m).toLowerCase(), (mdText ?? "").toLowerCase()];
    for (const h of haystacks) {
      for (const phrase of BANNED) if (h.includes(phrase)) bad.push(`the ledger says "${phrase}"`);
      // "audited" is permitted only in a negated form, and the negations must cover every mention.
      // "has been audited" is NOT in the banned list above, because it is a substring of the honest
      // sentence "No part of UNICA has been audited" — a phrase list that fires on its own
      // disclaimer teaches people to delete the disclaimer. The count below is the real check.
      const all = (h.match(/audited/g) ?? []).length;
      const negated = (h.match(
        /not audited|unaudited|never been audited|has not been audited|no part of [^.]*?has been audited|no audit/g,
      ) ?? []).length;
      if (all > negated) bad.push(`"audited" appears ${all} time(s) with only ${negated} negation(s)`);
    }
    return [...new Set(bad)];
  },

  markdownAgrees: (m, _tracked, mdText) => {
    const bad = [];
    const md = new Map();
    const re = /^- Id:\s*`([^`]+)`[\s\S]*?^- Status:\s*(.+)$/gm;
    let match;
    while ((match = re.exec(mdText)) !== null) md.set(match[1], match[2].trim());
    for (const t of m.tools) {
      if (!md.has(t.id)) bad.push(`${t.id}: in the manifest, absent from the ledger`);
      else if (md.get(t.id) !== t.status) {
        bad.push(`${t.id}: ledger says "${md.get(t.id)}", manifest says "${t.status}"`);
      }
    }
    for (const id of md.keys()) if (!m.tools.some((t) => t.id === id)) bad.push(`${id}: in the ledger, absent from the manifest`);
    return bad;
  },

  ledgerIsNotStale: (m) => {
    const bad = [];
    for (const t of m.tools) {
      const sha = t.lastVerifiedCommit;
      if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
        bad.push(`${t.id}: lastVerifiedCommit is not a full sha`);
        continue;
      }
      let reachable = true;
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {stdio: "ignore"});
      } catch {
        reachable = false;
      }
      if (!reachable) {
        // A shallow clone makes EVERY sha unreachable, which is a broken checkout rather than 35
        // stale tools. Say which, once, instead of printing the same confusing line per tool: CI
        // did exactly that, and the row that swallowed it meant nobody read the output.
        bad.push(
          shallow()
            ? `${t.id}: the checkout is SHALLOW, so no commit is reachable — this check needs full history (fetch-depth: 0)`
            : `${t.id}: lastVerifiedCommit ${sha.slice(0, 8)} is not an ancestor of HEAD`,
        );
        continue;
      }
      // Every commit since then that touched this tool must also have touched the manifest.
      const since = execFileSync("git", ["log", "--format=%H", `${sha}..HEAD`, "--", ...t.paths], {encoding: "utf8"})
        .split("\n").filter(Boolean);
      for (const c of since) {
        const files = execFileSync("git", ["show", "--name-only", "--format=", c], {encoding: "utf8"});
        if (!files.includes(JSON_PATH)) {
          bad.push(`${t.id}: commit ${c.slice(0, 8)} changed the tool without updating ${JSON_PATH}`);
        }
      }

      // And the same rule against the WORKING TREE, which is the half that was missing. Looking
      // only at commits means the rule cannot possibly fire until the offending commit exists, so
      // it guarantees at least one red gate on a commit that is already written and, if the push
      // was quick, already public. It fired that way four times before this line was added. Asked
      // of uncommitted changes as well, it says the same thing while the fix is still free.
      if (dirty(t.paths).length > 0 && dirty([JSON_PATH]).length === 0) {
        bad.push(`${t.id}: uncommitted changes to ${dirty(t.paths).join(", ")} without touching ${JSON_PATH}`);
      }
    }
    return bad;
  },
};

// ---- the controls: each check must reject a deliberately broken manifest --------------------

function control(name, check, broken, mdText = "") {
  const tracked = {has: () => true, hasPrefix: () => true};
  const found = CHECKS[check](broken, tracked, mdText);
  chk(`control: ${name}`, found.length > 0, "the check accepted a manifest it should have rejected");
}

const GOOD_TOOL = {
  id: "a-tool", name: "A Tool", version: "1", status: "PROTOTYPE",
  paths: [], networks: [], dependencies: [], tests: [], evidence: [], limitations: [],
  sponsorRoles: [], lastVerifiedCommit: "0".repeat(40),
};
const wrap = (over) => ({tools: [{...GOOD_TOOL, ...over}]});

control("a status outside the vocabulary is rejected", "status", wrap({status: "SHIPPED"}));
control("a non-kebab id is rejected", "ids", wrap({id: "A Tool"}));
control("a missing field is rejected", "requiredFields", (() => {
  const t = {...GOOD_TOOL};
  delete t.limitations;
  return {tools: [t]};
})());
control("a path that does not exist is rejected", "paths", wrap({paths: ["src/does-not-exist.sol"]}));
control("a test that does not exist is rejected", "tests", wrap({tests: ["test/nope.t.sol"]}));
control("a LIVE entry with no transaction is rejected", "liveEvidence",
        wrap({status: "LIVE AND VERIFIED", evidence: [{kind: "address", chainId: 1, value: "0x0"}]}));
control("an IMPLEMENTED entry with no test is rejected", "implementedHasTests",
        wrap({status: "IMPLEMENTED — LOCAL TESTS", tests: []}));
control("a SPECIFIED entry claiming an address is rejected", "specifiedClaimsNothing",
        wrap({status: "SPECIFIED, NOT IMPLEMENTED", evidence: [{kind: "address", chainId: 1, value: "0x0"}]}));
control("an unsupported claim is rejected", "noUnsupportedClaims",
        wrap({limitations: ["this is production-ready"]}));
control("an unnegated 'audited' is rejected", "noUnsupportedClaims", wrap({limitations: ["audited in June"]}));
control("a ledger that omits a tool is rejected", "markdownAgrees", wrap({}), "");
control("a ledger whose status disagrees is rejected", "markdownAgrees", wrap({}),
        "- Id: `a-tool`\n- Status: RETIRED\n");
chk("control: an honest row passes every check",
    ["status", "ids", "requiredFields", "tests", "liveEvidence", "implementedHasTests",
     "specifiedClaimsNothing", "noUnsupportedClaims"].every(
      (c) => CHECKS[c](wrap({}), {has: () => true, hasPrefix: () => true}, "- Id: `a-tool`\n- Status: PROTOTYPE\n").length === 0),
    "a valid manifest was rejected, so every rejection above is meaningless");

// ---- and now the real ledger -----------------------------------------------------------------

let manifest, mdText;
try {
  manifest = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  mdText = readFileSync(MD_PATH, "utf8");
} catch (e) {
  console.log(rows.join("\n"));
  console.log(`FAIL  the ledger could not be read: ${e.message}`);
  process.exit(1);
}

const trackedList = execFileSync("git", ["ls-files"], {encoding: "utf8"}).split("\n").filter(Boolean);
const trackedSet = new Set(trackedList);
const tracked = {
  has: (p) => trackedSet.has(p),
  hasPrefix: (p) => trackedList.some((f) => f.startsWith(p.endsWith("/") ? p : p + "/")),
};

chk("the manifest declares schema version 1", manifest.schemaVersion === 1);
for (const [name, fn] of Object.entries(CHECKS)) {
  const found = fn(manifest, tracked, mdText);
  chk(`ledger: ${name}`, found.length === 0, found);
}

console.log("UNICA tool ledger");
console.log(rows.join("\n"));
console.log(`\ntools: ${manifest.tools.length}, checks run: ${checks}, failed: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
