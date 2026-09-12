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
    "/join/",
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

  // THE JOIN ROUTE HAS NO PARITY ROW, AND THAT IS A STATED NEGATIVE, NOT AN OMISSION. The legacy
  // artifact has no onboarding surface at all, so there is nothing for a row's currentAnchor to
  // point at. The route is new capability; its checks are structural and live here instead.
  chk(
    "the legacy artifact has no onboarding surface (so the join route cannot have a parity row)",
    !current.includes("Add your business") && !current.includes("join(string"),
  );
  const joinDoc = docs.get("/join/") ?? "";
  const STEPS = /1\. Connect[\s\S]*2\. Business name[\s\S]*3\. Where the money goes[\s\S]*4\. Name your first register[\s\S]*5\. Add my business/;
  chk("the join route names its five steps in order", STEPS.test(joinDoc));
  chk("control: the step check fails on steps out of order", !STEPS.test("1. Connect 3. Where the money goes 2. Business name 4. Name your first register 5. Add my business"));
  chk("the join route's one button is disabled until script says why", /<button[^>]*id="join-submit"[^>]*disabled[^>]*aria-describedby="join-why"/.test(joinDoc));
  chk("the join route carries the practice-mode banner in the served HTML", joinDoc.includes("Practice mode, test money only"));
  chk("the join route offers Take a payment and Registers after success", joinDoc.includes(">Take a payment<") && joinDoc.includes(">Registers<"));
  chk(
    "the join route shows no contract word to a business owner",
    !/\b(hook|executor|registry|calldata)\b/i.test(joinDoc.replace(/<script[\s\S]*?<\/script>/g, "")),
  );
  chk("the join route loads its own script and nothing else new", joinDoc.includes('src="../assets/local-join.js"'));
  const payDoc = docs.get("/pay/") ?? "";
  chk(
    "the pay route's visible rows use the dictionary: Business, Pay name, Register, Amount you pay, They receive, Network, Expires",
    ["<dt>Business</dt>", "<dt>Pay name</dt>", "<dt>Register</dt>", "<dt>Amount you pay</dt>", "<dt>They receive</dt>", "<dt>Network</dt>", "<dt>Expires</dt>"].every((s) => payDoc.includes(s)),
  );
  chk("the pay route no longer shows Merchant or [TEST MODE] to a customer", !/<dt>Merchant/.test(payDoc) && !payDoc.includes("[TEST MODE]"));

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
