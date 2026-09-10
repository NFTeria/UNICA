#!/usr/bin/env node
/**
 * The generator. Node standard library only — no dependency, no network, no secret, no server.
 *
 * WHY A REPOSITORY-OWNED GENERATOR. What this artifact must be is narrow and unusual: one real
 * HTML document per route so a reload works; relative links so it survives a project base path;
 * output a claim scanner can read as plain files; and byte-identical rebuilds. A framework would
 * bring a router, a hydration story and a version to drift, for requirements it does not have.
 * Roughly three hundred lines does it, and every line is auditable by the people who own it.
 *
 * IT FAILS CLOSED. Duplicate routes, an unresolved placeholder, missing metadata, a broken internal
 * link, or a localhost/private/source-tree path in the output all abort the build. A generator that
 * emits a broken artifact and exits zero is worse than no generator.
 */
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  cpSync,
} from "node:fs";
import { join, dirname, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ROUTES, NOT_FOUND } from "./src/routes.mjs";
import { document_ } from "./src/shell.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const ASSETS = join(HERE, "assets");

const REQUIRED_META = ["title", "description", "ogTitle", "ogDescription", "ogImage", "h1"];

/** Shapes that must never reach a published artifact. */
const FORBIDDEN_IN_OUTPUT = [
  [/localhost|127\.0\.0\.1|0\.0\.0\.0/i, "a localhost or loopback address"],
  [/https?:\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./i, "a private network address"],
  [/\/Users\/|\/home\/[a-z]|[A-Z]:\\\\/, "an absolute filesystem path"],
  [/\{\{[^}]*\}\}/, "an unresolved handlebars-style placeholder"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY/, "private key material"],
];

function fail(message) {
  console.error(`BUILD FAILED: ${message}`);
  process.exit(1);
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split(/[\\/]/).join("/"));
  }
  return out;
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// ── 1. routes are unique ──────────────────────────────────────────────────────────────────────
const seen = new Set();
for (const r of [...ROUTES, NOT_FOUND]) {
  if (seen.has(r.route)) fail(`duplicate route "${r.route}"`);
  seen.add(r.route);
  for (const k of REQUIRED_META) if (!r[k]) fail(`route "${r.route}" is missing metadata: ${k}`);
  if (r.title.length > 70) fail(`route "${r.route}" title is longer than 70 characters`);
  if (r.description.length < 40) fail(`route "${r.route}" description is shorter than 40 characters`);
}
// Titles and descriptions must be UNIQUE: a shared one makes two routes indistinguishable in a tab,
// a bookmark list and a search result, which is a real failure rather than a style preference.
for (const field of ["title", "description"]) {
  const counts = new Map();
  for (const r of ROUTES) counts.set(r[field], (counts.get(r[field]) ?? 0) + 1);
  const dupes = [...counts].filter(([, n]) => n > 1).map(([v]) => v);
  if (dupes.length) fail(`duplicate ${field}: ${dupes.join(" | ")}`);
}

// ── 2. clean, then emit ───────────────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const emitted = [];
for (const r of ROUTES) {
  const html = document_(r);
  const rel = r.route ? posix.join(r.route, "index.html") : "index.html";
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, html);
  emitted.push(rel);
}
// 404 sits at the root, where a static host looks for it, and uses a root-relative prefix.
writeFileSync(join(OUT, "404.html"), document_({ ...NOT_FOUND, route: "" }));
emitted.push("404.html");

if (existsSync(ASSETS)) {
  cpSync(ASSETS, join(OUT, "assets"), { recursive: true });
  for (const a of walk(join(OUT, "assets"))) emitted.push(posix.join("assets", a));
}

// ── 3. nothing forbidden reached the output ───────────────────────────────────────────────────
for (const rel of emitted) {
  const text = readFileSync(join(OUT, rel), "utf8");
  for (const [re, why] of FORBIDDEN_IN_OUTPUT) {
    const m = text.match(re);
    if (m) fail(`${rel} contains ${why}: ${JSON.stringify(m[0].slice(0, 60))}`);
  }
  // An UNSUBSTITUTED `${...}` is only meaningful in generated HTML. In hand-written JavaScript it
  // is an ordinary template literal, and the first version of this rule failed the build on one.
  if (rel.endsWith(".html")) {
    const m = text.match(/\$\{[A-Za-z_]/);
    if (m) fail(`${rel} contains an unresolved template expression: ${JSON.stringify(m[0])}`);
  }
}

// ── 4. every internal link resolves to a file that exists ─────────────────────────────────────
const files = new Set(emitted);
const broken = [];
for (const rel of emitted.filter((f) => f.endsWith(".html"))) {
  const text = readFileSync(join(OUT, rel), "utf8");
  const from = posix.dirname(rel);
  for (const m of text.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#|data:)/i.test(href)) continue;
    const clean = href.split(/[?#]/)[0];
    if (clean === "") continue;
    if (clean.startsWith("/")) {
      broken.push(`${rel} -> ${href} (absolute path breaks a project base path)`);
      continue;
    }
    let target = posix.normalize(posix.join(from === "." ? "" : from, clean));
    if (target.startsWith("./")) target = target.slice(2);
    if (target === "." || target === "") target = "index.html";
    if (target.endsWith("/")) target += "index.html";
    if (!posix.basename(target).includes(".")) target = posix.join(target, "index.html");
    if (!files.has(target)) broken.push(`${rel} -> ${href} (resolved ${target})`);
  }
}
if (broken.length) fail(`broken internal links:\n  ${broken.join("\n  ")}`);

// ── 5. the manifest ───────────────────────────────────────────────────────────────────────────
// No timestamp and no build id: either would make two identical builds differ, and reproducibility
// is the property this manifest exists to demonstrate.
const entries = emitted.sort().map((rel) => ({ file: rel, sha256: sha(readFileSync(join(OUT, rel))) }));
const aggregate = sha(entries.map((e) => `${e.file} ${e.sha256}`).join("\n"));
const manifest = {
  routes: ROUTES.map((r) => ({
    route: "/" + (r.route ? r.route + "/" : ""),
    file: r.route ? posix.join(r.route, "index.html") : "index.html",
  })),
  files: entries,
  aggregate,
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`built ${ROUTES.length} routes + 404, ${entries.length} files`);
console.log(`aggregate ${aggregate}`);
