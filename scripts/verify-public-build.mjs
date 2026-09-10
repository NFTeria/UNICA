#!/usr/bin/env node
/**
 * verify-public-build.mjs — the gate on whatever GitHub Pages is about to publish.
 *
 * `script/check-surface.sh` is the incumbent, and it works because today's artifact is the source:
 * Pages uploads `web/` verbatim, so grepping the committed `web/index.html` and grepping the
 * published bytes are the same act. The moment a build step exists that stops being true, and a
 * gate that reads a file nobody serves keeps printing PASS while checking nothing. That failure is
 * silent, which makes it the most dangerous kind.
 *
 * So this verifier never learns a directory. It RESOLVES one, out of the Pages workflow itself —
 * it finds the `actions/upload-pages-artifact` step and reads the `path:` that step will upload.
 * Point the workflow at a build output and this follows it there. Point it somewhere that does not
 * exist and this fails loudly rather than passing over an empty tree. `--self-test` proves exactly
 * that by rewriting the path in a throwaway copy of the workflow and watching the resolution move.
 *
 * It replaces nothing yet. Both gates run against the same directory, and a drift row asserts that
 * every pin here also appears in `check-surface.sh`, so the two cannot quietly disagree about which
 * deployment the page names. That row is what makes running both safe rather than merely redundant.
 *
 * Usage:
 *   node scripts/verify-public-build.mjs              verify the resolved upload directory
 *   node scripts/verify-public-build.mjs --self-test  sabotage every family and require each to fail
 *   node scripts/verify-public-build.mjs --json       machine-readable rows
 *
 * Exit 0 only when every row passed. Prints a stated count, never a blank pass: an empty result and
 * a broken reporter look identical, and only one of them is fine.
 */

import {
  readFileSync,
  existsSync,
  statSync,
  readdirSync,
  mkdtempSync,
  cpSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, relative, dirname, posix } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST_PATH = join(ROOT, "scripts", "public-build.manifest.json");
const SURFACE_SCRIPT = join(ROOT, "script", "check-surface.sh");

// ── resolving the directory Pages will actually upload ────────────────────────────────────────

/**
 * Reads the upload directory out of the workflow text. Throws unless exactly one step matches:
 * zero means the workflow changed shape and this verifier is now guessing, and more than one means
 * two artifacts are uploaded and "the published directory" is no longer a single answer. Both are
 * conditions a gate must refuse rather than pick a winner for.
 */
export function resolveUploadPath(workflowText, action, input) {
  const lines = workflowText.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(action)) continue;
    const stepIndent = lines[i].search(/\S/);
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "") continue;
      const indent = line.search(/\S/);
      // A new list item at or left of this step's indent ends the step.
      if (indent <= stepIndent && /^\s*-\s/.test(line)) break;
      if (indent < stepIndent) break;
      const m = line.match(new RegExp(`^\\s+${input}:\\s*(.+?)\\s*$`));
      if (m) {
        found.push(m[1].replace(/^["']|["']$/g, ""));
        break;
      }
    }
  }
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one "${action}" step with a "${input}:" input, found ${found.length}. ` +
        `A gate that guesses which directory ships is not a gate.`,
    );
  }
  return found[0];
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────

function walkFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, base, out);
    else out.push(relative(base, full).split(/[\\/]/).join("/"));
  }
  return out;
}

const TEXTUAL = /\.(html?|m?js|css|json|md|txt|svg|xml|webmanifest)$/i;

/** Every reference a browser would fetch or a module loader would resolve. */
function extractReferences(text) {
  const refs = [];
  for (const m of text.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/gi)) refs.push(m[1]);
  for (const m of text.matchAll(/(?:src|href)\s*=\s*'([^']*)'/gi)) refs.push(m[1]);
  for (const m of text.matchAll(/\bfrom\s*["']([^"']+)["']/g)) refs.push(m[1]);
  for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) refs.push(m[1]);
  return refs;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// ── the checks ────────────────────────────────────────────────────────────────────────────────

/**
 * Runs every family against an explicit (uploadDir, manifest) pair, so the self-test can point it
 * at a sabotaged copy without the production path being special-cased anywhere.
 */
export function runChecks({ uploadDir, manifest, surfaceScriptText }) {
  const rows = [];
  const chk = (family, name, ok, detail = "") => rows.push({ family, name, ok: Boolean(ok), detail });

  // 1. the directory itself
  if (!existsSync(uploadDir) || !statSync(uploadDir).isDirectory()) {
    chk("upload-path", `the resolved upload directory exists: ${uploadDir}`, false, "not a directory");
    return rows;
  }
  chk("upload-path", `the resolved upload directory exists: ${uploadDir}`, true);

  const served = walkFiles(uploadDir);
  chk("upload-path", `the upload directory is not empty (${served.length} files)`, served.length > 0);

  const entryRel = manifest.entry;
  const entryPath = join(uploadDir, entryRel);
  const hasEntry = existsSync(entryPath);
  chk("entry", `the entry document is present: ${entryRel}`, hasEntry);
  if (!hasEntry) return rows;

  const entry = readFileSync(entryPath, "utf8");
  const entryLines = entry.split("\n");

  // 2. the pins: which deployment the published page NAMES
  for (const pin of manifest.requiredPins) {
    const present =
      pin.kind === "word" ? new RegExp(`\\b${pin.value}\\b`).test(entry) : entry.includes(pin.value);
    chk("pins", `pins ${pin.label}`, present);
  }

  // 3. the routes: which deployment it SENDS TO. A page that merely mentions the right addresses
  //    while paying the wrong ones passes every row above and fails these.
  for (const route of manifest.requiredRoutes) {
    const re = new RegExp(route.pattern);
    chk(
      "routes",
      route.label,
      entryLines.some((l) => re.test(l)),
    );
  }
  for (const rejected of manifest.rejectedRoutes) {
    const re = new RegExp(rejected.pattern);
    chk("routes", rejected.label, !entryLines.some((l) => re.test(l)));
  }

  // 4. prohibited claims, over every served file — a claim in a served README ships too
  for (const claim of manifest.prohibitedClaims) {
    const re = new RegExp(claim.pattern, "i");
    const hits = served.filter((f) => TEXTUAL.test(f) && re.test(readFileSync(join(uploadDir, f), "utf8")));
    chk("claims", `no prohibited claim "${claim.id}"`, hits.length === 0, hits.join(", "));
  }

  // 5. the one approved sentence, if the marker appears at all
  const { marker, accepted } = manifest.approvedClaim;
  if (entry.includes(marker)) {
    chk(
      "claims",
      `the "${marker}" claim matches an approved wording`,
      accepted.some((a) => entry.includes(a)),
    );
  } else {
    chk("claims", `no "${marker}" claim is made (nothing to check)`, true);
  }

  // 6. no external script, stylesheet, font or CDN
  for (const rule of manifest.prohibitedExternal) {
    const re = new RegExp(rule.pattern, "i");
    chk("external", `no ${rule.id}`, !re.test(entry), rule.why);
  }

  // 7. assets: relative, resolvable, and inside the uploaded tree.
  //
  //    Some of this page's links are BUILT AT RUNTIME — `href="${CFG.explorer}/tx/${hash}"` inside
  //    a template literal. No static reader can resolve those, and pretending to would either fail
  //    on every one of them or, worse, tempt someone to widen the resolve rule until it stopped
  //    catching a genuinely missing file. They are counted and reported separately instead, and the
  //    one thing that IS decidable about them is still decided: a computed reference whose literal
  //    prefix is "/" is absolute however the rest of it is spelled, and breaks under a project-pages
  //    subpath or an IPFS CID prefix exactly like a static one.
  const absolute = [];
  const missing = [];
  const badScheme = [];
  const dynamic = [];
  const allowed = new Set(manifest.assets.allowedExternalSchemes);
  const isComputed = (ref) => ref.includes("${") || /['"]\s*\+|\+\s*['"]/.test(ref);
  for (const file of served.filter((f) => /\.(html?|m?js|css)$/i.test(f))) {
    const text = readFileSync(join(uploadDir, file), "utf8");
    for (const ref of extractReferences(text)) {
      if (ref === "" || ref.startsWith("#")) continue;
      if (ref.startsWith("/")) {
        absolute.push(`${file} -> ${ref}`);
        continue;
      }
      if (isComputed(ref)) {
        dynamic.push(`${file} -> ${ref}`);
        continue;
      }
      if (SCHEME.test(ref)) {
        const scheme = ref.slice(0, ref.indexOf(":") + 1).toLowerCase();
        if (!allowed.has(scheme)) badScheme.push(`${file} -> ${ref}`);
        continue;
      }
      const target = posix.normalize(posix.join(posix.dirname(file), ref.split(/[?#]/)[0]));
      if (target.startsWith("..") || !existsSync(join(uploadDir, target))) missing.push(`${file} -> ${ref}`);
    }
  }
  chk(
    "assets",
    "no absolute-path local reference, computed ones included",
    absolute.length === 0,
    absolute.join(", "),
  );
  chk(
    "assets",
    "every static relative reference resolves inside the upload directory",
    missing.length === 0,
    missing.join(", "),
  );
  chk(
    "assets",
    "every external reference uses an allowed scheme",
    badScheme.length === 0,
    badScheme.join(", "),
  );
  chk(
    "assets",
    `${dynamic.length} reference(s) are built at runtime and cannot be resolved statically`,
    true,
    "reported, not resolved",
  );

  // 8. metadata a link preview and a screen reader both need
  const title = entry.match(/<title>([^<]*)<\/title>/i);
  if (manifest.metadata.requireTitle) {
    chk("metadata", "a non-empty <title>", Boolean(title && title[1].trim()));
  }
  const desc = entry.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  if (manifest.metadata.requireDescription) {
    const value = desc ? desc[1].trim() : "";
    chk(
      "metadata",
      `a description of at least ${manifest.metadata.minDescriptionLength} characters`,
      value.length >= manifest.metadata.minDescriptionLength,
      value ? `${value.length} chars` : "absent",
    );
  }

  // 9. drift: the two gates must not disagree about which deployment ships
  if (surfaceScriptText !== null) {
    const absent = manifest.requiredPins.filter((p) => !surfaceScriptText.includes(p.value));
    chk(
      "drift",
      "every pin here is also asserted by script/check-surface.sh",
      absent.length === 0,
      absent.map((p) => p.label).join(", "),
    );
  }

  return rows;
}

// ── the self-test: every family is fed a known-bad input and must go red ───────────────────────

const SABOTAGES = [
  {
    id: "pins",
    why: "a pin removed from the published page",
    apply: (dir, m) => patchEntry(dir, m, (t) => t.replaceAll("8cdf141", "0000000")),
  },
  {
    id: "routes",
    why: "the page still names V3 but pays V1's executor",
    apply: (dir, m) =>
      patchEntry(dir, m, (t) =>
        t.replace(
          /^  executor: "0x015692C9E43ca19a2504F79368D1156A56680517",$/m,
          '  executor: "0x044bc8a8773EC7b9B8de2467766636dFFCaC6210",',
        ),
      ),
  },
  {
    id: "claims",
    why: "a prohibited claim in a served file",
    apply: (dir, m) =>
      patchEntry(dir, m, (t) => t.replace("</body>", "<p>EURC settlement supported.</p></body>")),
  },
  {
    id: "external",
    why: "a third-party script tag",
    apply: (dir, m) =>
      patchEntry(dir, m, (t) =>
        t.replace("</body>", '<script src="https://cdn.example.com/a.js"></script></body>'),
      ),
  },
  {
    id: "assets",
    why: "an absolute-path module reference that breaks under a subpath or a CID prefix",
    apply: (dir, m) =>
      patchEntry(dir, m, (t) => t.replace('from "./ensv2/resolve.mjs"', 'from "/ensv2/resolve.mjs"')),
  },
  {
    id: "assets",
    why: "a reference to a file that is not in the uploaded directory",
    apply: (dir, m) =>
      patchEntry(dir, m, (t) => t.replace('from "./ensv2/resolve.mjs"', 'from "./ensv2/gone.mjs"')),
  },
  {
    id: "assets",
    why: "a RUNTIME-BUILT reference whose literal prefix is absolute",
    apply: (dir, m) => patchEntry(dir, m, (t) => t.replace("</body>", '<a href="/tx/${hash}">x</a></body>')),
  },
  {
    id: "metadata",
    why: "the page ships with no title",
    apply: (dir, m) => patchEntry(dir, m, (t) => t.replace(/<title>[^<]*<\/title>/i, "")),
  },
];

function patchEntry(dir, manifest, fn) {
  const p = join(dir, manifest.entry);
  writeFileSync(p, fn(readFileSync(p, "utf8")));
}

function selfTest(manifest, surfaceScriptText, realUploadDir) {
  const rows = [];
  const chk = (name, ok, detail = "") => rows.push({ family: "self-test", name, ok, detail });

  // The control first. A drill whose control fails indicts the drill, never the subject.
  const clean = mkdtempSync(join(tmpdir(), "unica-pb-"));
  cpSync(realUploadDir, join(clean, "site"), { recursive: true });
  const control = runChecks({ uploadDir: join(clean, "site"), manifest, surfaceScriptText });
  const controlFails = control.filter((r) => !r.ok);
  chk(
    "control: an untouched copy of the upload directory passes every row",
    controlFails.length === 0,
    controlFails.map((r) => r.name).join("; "),
  );
  rmSync(clean, { recursive: true, force: true });

  for (const s of SABOTAGES) {
    const dir = mkdtempSync(join(tmpdir(), "unica-pb-"));
    const site = join(dir, "site");
    cpSync(realUploadDir, site, { recursive: true });
    s.apply(site, manifest);
    const out = runChecks({ uploadDir: site, manifest, surfaceScriptText });
    const failed = out.filter((r) => !r.ok);
    const caughtByFamily = failed.some((r) => r.family === s.id);
    chk(
      `sabotage "${s.why}" is caught by the ${s.id} family`,
      caughtByFamily,
      caughtByFamily ? `${failed.length} row(s) red` : "NOTHING WENT RED",
    );
    rmSync(dir, { recursive: true, force: true });
  }

  // The resolution itself: the directory must FOLLOW the workflow, not a constant in this file.
  const wf = readFileSync(join(ROOT, manifest.uploadPath.workflow), "utf8");
  const real = resolveUploadPath(wf, manifest.uploadPath.action, manifest.uploadPath.input);
  const moved = wf.replace(/^(\s+)path:\s*\S+\s*$/m, "$1path: dist/site");
  let movedResolved = null;
  try {
    movedResolved = resolveUploadPath(moved, manifest.uploadPath.action, manifest.uploadPath.input);
  } catch {
    /* recorded as a failure below */
  }
  chk(
    "sabotage: repointing the workflow moves the directory this verifier checks",
    real !== "dist/site" && movedResolved === "dist/site",
    `real="${real}" repointed="${movedResolved}"`,
  );
  let refusedTwo = false;
  try {
    resolveUploadPath(wf + "\n" + wf, manifest.uploadPath.action, manifest.uploadPath.input);
  } catch {
    refusedTwo = true;
  }
  chk("control: two upload steps are refused rather than one of them picked", refusedTwo);

  return rows;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────

function main() {
  const args = new Set(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const surfaceScriptText = existsSync(SURFACE_SCRIPT) ? readFileSync(SURFACE_SCRIPT, "utf8") : null;

  const workflowPath = join(ROOT, manifest.uploadPath.workflow);
  if (!existsSync(workflowPath)) {
    console.error(`FAIL  the Pages workflow is missing: ${manifest.uploadPath.workflow}`);
    console.log("checks run: 1, passed: 0, failed: 1");
    process.exit(1);
  }

  let uploadRel;
  try {
    uploadRel = resolveUploadPath(
      readFileSync(workflowPath, "utf8"),
      manifest.uploadPath.action,
      manifest.uploadPath.input,
    );
  } catch (err) {
    console.error(`FAIL  could not resolve the upload directory: ${err.message}`);
    console.log("checks run: 1, passed: 0, failed: 1");
    process.exit(1);
  }
  const uploadDir = join(ROOT, uploadRel);

  const rows = args.has("--self-test")
    ? selfTest(manifest, surfaceScriptText, uploadDir)
    : runChecks({ uploadDir, manifest, surfaceScriptText });

  const failed = rows.filter((r) => !r.ok);
  if (args.has("--json")) {
    console.log(JSON.stringify({ uploadPath: uploadRel, rows }, null, 2));
  } else {
    if (!args.has("--self-test"))
      console.log(`# upload directory resolved from ${manifest.uploadPath.workflow}: ${uploadRel}`);
    for (const r of rows) {
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  [${r.detail}]`}`);
    }
    console.log(
      `checks run: ${rows.length}, passed: ${rows.length - failed.length}, failed: ${failed.length}`,
    );
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
