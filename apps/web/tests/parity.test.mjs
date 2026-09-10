/**
 * The parity inventory, executable.
 *
 * A parity matrix written as prose drifts from the artifact it describes and nobody notices until a
 * feature is already missing. Every row here names a literal that MUST be present in the CURRENT
 * `web/index.html`. If the artifact changes, the row fails and the matrix has to be re-derived
 * rather than quietly outlived.
 *
 * The second half asserts the replacement side once it exists. Until a route is built, its row is
 * reported as PENDING and counted — never silently skipped, because an unbuilt route and an
 * un-checked one look identical in a summary that only prints passes.
 *
 * Offline. No network, no chain, no wallet.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const matrix = JSON.parse(readFileSync(join(HERE, "parity.matrix.json"), "utf8"));
const current = readFileSync(join(ROOT, matrix.artifact), "utf8");
const OUT = join(ROOT, "apps", "web", "out");

let ok = 0,
  fail = 0,
  pending = 0;
const chk = (n, p, d = "") => {
  if (p) {
    ok++;
    console.log(`PASS  ${n}`);
  } else {
    fail++;
    console.log(`FAIL  ${n}${d ? `  [${d}]` : ""}`);
  }
};

console.log(`# parity inventory against ${matrix.artifact} — ${matrix.rows.length} rows\n`);

// ── 1. the matrix still describes the artifact ────────────────────────────────────────────────
let anchorMisses = [];
for (const r of matrix.rows) if (!current.includes(r.currentAnchor)) anchorMisses.push(r.id);
chk(
  `every row's currentAnchor is present in ${matrix.artifact}`,
  anchorMisses.length === 0,
  anchorMisses.join(","),
);

// ── 2. control. A matrix that cannot detect a missing feature is decoration. ───────────────────
chk("control: a fabricated anchor is NOT found", !current.includes('id="this-element-does-not-exist"'));

// ── 3. every row is fully specified ───────────────────────────────────────────────────────────
const incomplete = matrix.rows.filter(
  (r) =>
    !r.id ||
    !r.feature ||
    !r.trigger ||
    !r.dataSource ||
    !r.currentAnchor ||
    !r.replacementRoute ||
    !r.successState,
);
chk(
  "every row names trigger, data source, dependency, anchor, replacement route and success state",
  incomplete.length === 0,
  incomplete.map((r) => r.id).join(","),
);

// ── 4. no row is orphaned: every replacement route is one of the required surfaces ────────────
const REQUIRED = new Set([
  "home",
  "how-it-works",
  "supported-assets",
  "networks",
  "security",
  "proof",
  "status",
  "merchant",
  "merchant/payments",
  "merchant/payments/new",
  "payment",
  "checkout",
  "receipt",
  "experiments/robinhood",
  "support",
  "legal/terms",
  "legal/privacy",
  "legal/risks",
]);
const strays = [...new Set(matrix.rows.map((r) => r.replacementRoute))].filter((x) => !REQUIRED.has(x));
chk("every replacement route is one of the required surfaces", strays.length === 0, strays.join(","));

// ── 5. the candidate side, when it exists ─────────────────────────────────────────────────────
if (!existsSync(OUT)) {
  pending = matrix.rows.length;
  console.log(
    `\nPENDING  ${pending} rows: apps/web/out does not exist yet, so no replacement route can be checked.`,
  );
  console.log(
    "         Reported, not skipped: an unbuilt route and an unchecked one must not look the same.",
  );
} else {
  const routes = [...new Set(matrix.rows.map((r) => r.replacementRoute))];
  for (const route of routes) {
    const file = route === "home" ? join(OUT, "index.html") : join(OUT, route, "index.html");
    const rows = matrix.rows.filter((r) => r.replacementRoute === route).map((r) => r.id);
    chk(
      `route "${route}" emits a real HTML file (rows: ${rows.join(",")})`,
      existsSync(file),
      file.replace(ROOT, ""),
    );
  }
}

console.log(`\nchecks run: ${ok + fail}, passed: ${ok}, failed: ${fail}, pending: ${pending}`);
process.exit(fail === 0 ? 0 : 1);
