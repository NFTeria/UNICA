/**
 * The generator itself: determinism, escaping, structure, metadata, and the failure modes.
 * Offline. No network, no chain, no secret.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { h, esc, raw } from "../src/html.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const OUT = join(APP, "out");
let ok = 0,
  fail = 0;
const chk = (n, p, d = "") => {
  if (p) {
    ok++;
    console.log(`PASS  ${n}`);
  } else {
    fail++;
    console.log(`FAIL  ${n}${d ? `  [${d}]` : ""}`);
  }
};
const build = () => execFileSync(process.execPath, [join(APP, "build.mjs")], { encoding: "utf8" });

// ── escaping ──────────────────────────────────────────────────────────────────────────────────
chk(
  "every interpolation is escaped",
  h`<p>${"<img src=x onerror=alert(1)>"}</p>` === "<p>&lt;img src=x onerror=alert(1)&gt;</p>",
);
chk("quotes and ampersands are escaped", esc(`" ' & < >`) === "&quot; &#39; &amp; &lt; &gt;");
chk("arrays are escaped element by element", h`${["<a>", "<b>"]}` === "&lt;a&gt;&lt;b&gt;");
chk("null and false render as nothing", h`[${null}${undefined}${false}]` === "[]");
chk("raw() is the only way to opt out", h`${raw("<b>x</b>")}` === "<b>x</b>");

// ── deterministic rebuild ─────────────────────────────────────────────────────────────────────
build();
const first = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
build();
const second = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
chk(
  "two clean builds produce the same aggregate hash",
  first.aggregate === second.aggregate,
  `${first.aggregate?.slice(0, 12)} vs ${second.aggregate?.slice(0, 12)}`,
);
chk(
  "every file hash is identical between builds",
  JSON.stringify(first.files) === JSON.stringify(second.files),
);
chk(
  "the manifest carries no timestamp or build id",
  !JSON.stringify(first).match(/\d{4}-\d{2}-\d{2}T|buildId|timestamp/i),
);

// ── stale output is removed ───────────────────────────────────────────────────────────────────
const stale = join(OUT, "stale-artifact.html");
writeFileSync(stale, "<p>stale</p>");
build();
chk("a stale file is removed by the next build", !existsSync(stale));

// ── structure and accessibility, per document ─────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
const docs = manifest.routes.map((r) => [r.route, readFileSync(join(OUT, r.file), "utf8")]);

const oneH1 = docs.filter(([, d]) => (d.match(/<h1[ >]/g) ?? []).length !== 1).map(([r]) => r);
chk("every route has exactly one h1", oneH1.length === 0, oneH1.join(","));
const noSkip = docs.filter(([, d]) => !d.includes('class="skip"')).map(([r]) => r);
chk("every route has a skip link", noSkip.length === 0, noSkip.join(","));
const landmarks = docs
  .filter(
    ([, d]) => !(d.includes("<main") && d.includes("<header") && d.includes("<footer") && d.includes("<nav")),
  )
  .map(([r]) => r);
chk("every route has header, nav, main and footer landmarks", landmarks.length === 0, landmarks.join(","));
const navNamed = docs.filter(([, d]) => !d.includes('aria-label="Primary"')).map(([r]) => r);
chk("every navigation has an accessible name", navNamed.length === 0, navNamed.join(","));
const lang = docs.filter(([, d]) => !d.includes('<html lang="en">')).map(([r]) => r);
chk("every document declares a language", lang.length === 0, lang.join(","));
const vp = docs
  .filter(
    ([, d]) =>
      !d.includes("viewport-fit=cover") || d.includes("user-scalable=no") || d.includes("maximum-scale"),
  )
  .map(([r]) => r);
chk("no route blocks zoom, and all handle safe areas", vp.length === 0, vp.join(","));

// Heading order: no jump from h1 straight to h3.
const badOrder = docs
  .filter(([, d]) => {
    const levels = [...d.matchAll(/<h([1-3])[ >]/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) return true;
    return false;
  })
  .map(([r]) => r);
chk("no route skips a heading level", badOrder.length === 0, badOrder.join(","));

// Status regions announce.
const live = docs
  .filter(([, d]) => d.includes('class="status"') && !d.includes('aria-live="polite"'))
  .map(([r]) => r);
chk("every status region is a live region", live.length === 0, live.join(","));

// A disabled control must say why, through aria-describedby.
const undescribed = docs
  .filter(([, d]) => /<button[^>]*disabled/.test(d) && !/<button[^>]*aria-describedby/.test(d))
  .map(([r]) => r);
chk("every disabled control names its reason", undescribed.length === 0, undescribed.join(","));

// ── metadata ──────────────────────────────────────────────────────────────────────────────────
const titles = new Set(),
  descs = new Set();
let metaBad = [];
for (const [route, d] of docs) {
  const t = d.match(/<title>([^<]+)<\/title>/)?.[1];
  const desc = d.match(/name="description" content="([^"]+)"/)?.[1];
  const og = d.match(/property="og:title" content="([^"]+)"/)?.[1];
  const img = d.match(/property="og:image" content="([^"]+)"/)?.[1];
  const can = d.match(/rel="canonical" href="([^"]+)"/)?.[1];
  if (!t || !desc || !og || !img || !can) metaBad.push(route);
  if (can && can.startsWith("/")) metaBad.push(`${route}(absolute canonical)`);
  titles.add(t);
  descs.add(desc);
}
chk(
  "every route defines title, description, og title, og image and canonical",
  metaBad.length === 0,
  metaBad.join(","),
);
chk("titles are unique across routes", titles.size === docs.length);
chk("descriptions are unique across routes", descs.size === docs.length);
const exp = docs.find(([r]) => r === "/experiments/robinhood/")[1];
chk("the experiment route is labelled a testnet experiment", exp.includes('content="testnet experiment"'));
chk("the experiment preview card is its own, not the generic one", exp.includes("og-experiment.svg"));

// ── base-path safety ──────────────────────────────────────────────────────────────────────────
const absolute = docs.filter(([, d]) => /(?:href|src)="\/[^/]/.test(d)).map(([r]) => r);
chk("no route uses an absolute-root href or src", absolute.length === 0, absolute.join(","));

console.log(`\nchecks run: ${ok + fail}, passed: ${ok}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
