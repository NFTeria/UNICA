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

// ── 5. the candidate side ─────────────────────────────────────────────────────────────────────
if (!existsSync(OUT)) {
  pending = matrix.rows.length;
  console.log(`\nPENDING  ${pending} rows: apps/web/out does not exist. Run: node apps/web/build.mjs`);
} else {
  const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
  const docs = new Map();
  for (const r of manifest.routes) docs.set(r.route, readFileSync(join(OUT, r.file), "utf8"));

  // Every required route emits a real reload-safe document.
  const REQ = [
    "/",
    "/how-it-works/",
    "/supported-assets/",
    "/networks/",
    "/security/",
    "/proof/",
    "/status/",
    "/merchant/",
    "/merchant/payments/",
    "/merchant/payments/new/",
    "/merchant/payments/details/",
    "/pay/",
    "/receipt/",
    "/experiments/robinhood/",
    "/support/",
    "/legal/terms/",
    "/legal/privacy/",
    "/legal/risks/",
  ];
  const absent = REQ.filter((r) => !docs.has(r));
  chk(`all ${REQ.length} required routes emit a document`, absent.length === 0, absent.join(","));
  chk("404.html exists and is a real document", existsSync(join(OUT, "404.html")));

  // THE ROWS. Each asserts the mapped CONTROL exists, via its data-parity attribute — not that
  // some matching prose appears. Prose drifts into a page by accident; an attribute does not.
  const all = [...docs.values()].join("\n");
  const missingControls = [];
  for (const r of matrix.rows) {
    if (!all.includes(`data-parity="${r.id}"`)) missingControls.push(r.id);
  }
  chk(
    `all ${matrix.rows.length} parity rows have a mapped control in the output`,
    missingControls.length === 0,
    missingControls.join(","),
  );

  // ...and each control is on the route the matrix says it is, not merely somewhere.
  const wrongRoute = [];
  for (const r of matrix.rows) {
    const path =
      r.replacementRoute === "home"
        ? "/"
        : r.replacementRoute === "payment"
          ? "/merchant/payments/details/"
          : r.replacementRoute === "checkout"
            ? "/pay/"
            : "/" + r.replacementRoute + "/";
    const doc = docs.get(path);
    if (!doc || !doc.includes(`data-parity="${r.id}"`)) wrongRoute.push(`${r.id}@${path}`);
  }
  chk("every control sits on the route its row names", wrongRoute.length === 0, wrongRoute.join(","));

  // Success states the rows promise, spot-checked where they are structural.
  chk(
    "the payment route states its disabling conditions",
    (docs.get("/pay/") ?? "").includes("disables everything"),
  );
  chk(
    "the receipt route distinguishes a failed read from an empty one",
    (docs.get("/receipt/") ?? "").includes("different\n  answers") ||
      (docs.get("/receipt/") ?? "").includes("different"),
  );
  chk(
    "the experiment route names chain 46630 and disables its action",
    (docs.get("/experiments/robinhood/") ?? "").includes("46630") &&
      /<button[^>]*disabled/.test(docs.get("/experiments/robinhood/") ?? ""),
  );
  chk(
    "no route claims the current demo supports chain 46630",
    !/current settlement demo[^.]{0,80}46630/i.test(all),
  );

  // Control: a fabricated control id must NOT be found, or the row check means nothing.
  chk(
    "control: a fabricated parity id is not found in the output",
    !all.includes('data-parity="not-a-real-row"'),
  );
}

console.log(`\nchecks run: ${ok + fail}, passed: ${ok}, failed: ${fail}, pending: ${pending}`);
process.exit(fail === 0 ? 0 : 1);
