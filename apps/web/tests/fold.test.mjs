/**
 * Every screen at every size, and the fold — executable.
 *
 * IT READS THE EMITTED ARTIFACT, NOT THE SOURCE FILE. `assets/fold.css` only matters if the build
 * copies it into `out/assets/`, so every claim below is made against the built copy. A build that
 * quietly stopped emitting it would leave the source file perfect and the product unstyled, and
 * that is exactly the failure a test reading the source could not see.
 *
 * EVERY SCANNER HERE IS PROVEN ON A PLANTED INPUT FIRST. A regex that says "the reduced-motion rule
 * is present" is worthless until it has been shown to say "absent" about a stylesheet that lacks
 * one. Four controls below do that job, and each is paired with the check it guards.
 *
 * NO BROWSER. Nothing here renders. The layout claim is a mechanical property of the declarations —
 * a fixed width wider than the narrowest content box, uncapped, is the cause of a page that scrolls
 * sideways — and the contrast claim is arithmetic. docs/unica-v4/SCREENS.md says plainly what that
 * leaves unverified.
 *
 * Offline. No network, no chain, no wallet.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const ROOT = join(APP, "..", "..");

/** A build of this file's own, for the reason apps/web/build.mjs states about UNICA_BUILD_OUT. */
const OUT = mkdtempSync(join(tmpdir(), "unica-fold-"));
execFileSync(process.execPath, [join(APP, "build.mjs")], {
  encoding: "utf8",
  env: { ...process.env, UNICA_BUILD_OUT: OUT },
});

const fold = readFileSync(join(OUT, "assets", "fold.css"), "utf8");
const base = readFileSync(join(OUT, "assets", "unica.css"), "utf8");
const screens = readFileSync(join(ROOT, "docs", "unica-v4", "SCREENS.md"), "utf8");

// ── the fold is expressed in standards ───────────────────────────────────────────────────────

test("the emitted stylesheet carries both segment media features", () => {
  assert.match(fold, /@media\s*\(\s*horizontal-viewport-segments:\s*2\s*\)/);
  assert.match(fold, /@media\s*\(\s*vertical-viewport-segments:\s*2\s*\)/);
});

/**
 * Resolve one level of custom-property indirection, so a claim about what the hinge is MADE OF
 * survives the two names it is assembled through. Without this the test could only say the file
 * mentions the env() functions somewhere, which is not the same claim.
 */
function resolved(css, name) {
  const value = css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
  assert.ok(value, `--${name} is not declared at all`);
  return value.replace(/var\(--([a-z0-9-]+)[^)]*\)/g, (_, inner) => resolved(css, inner));
}

test("the horizontal hinge gap is the distance between the two published segment edges", () => {
  const hinge = resolved(fold, "hinge");
  assert.match(hinge, /^calc\(/, "--hinge is not a calculation");
  assert.match(hinge, /env\(\s*viewport-segment-left\s+1\s+0/);
  assert.match(hinge, /env\(\s*viewport-segment-right\s+0\s+0/);
  // the RIGHT edge of the left segment is subtracted from the LEFT edge of the right one
  assert.ok(
    hinge.indexOf("viewport-segment-left 1 0") < hinge.indexOf(") - "),
    `the two edges are not subtracted in that order: ${hinge}`,
  );
});

test("the vertical hinge gap is the distance between the two block-axis segment edges", () => {
  const hinge = resolved(fold, "hinge-block");
  assert.match(hinge, /^calc\(/, "--hinge-block is not a calculation");
  assert.match(hinge, /env\(\s*viewport-segment-top\s+0\s+1/);
  assert.match(hinge, /env\(\s*viewport-segment-bottom\s+0\s+0/);
});

test("the hinge is consumed as a gap by the app frame, not merely declared", () => {
  const horizontal = block(fold, "@media (horizontal-viewport-segments: 2)");
  assert.match(horizontal, /column-gap:\s*var\(--hinge\)/);
  assert.match(horizontal, /grid-template-columns:\s*var\(--seg-a-end\)\s+minmax\(0,\s*1fr\)/);
  const vertical = block(fold, "@media (vertical-viewport-segments: 2)");
  assert.match(vertical, /row-gap:\s*var\(--hinge-block\)/);
});

/** The stylesheet with its comments removed: the part a browser actually acts on. */
const declarations = (css) => css.replace(/\/\*[\s\S]*?\*\//g, " ");

test("no device name reached the rules the browser acts on", () => {
  // The fold is standards, not a model list. A device name in a selector is the failure mode; a
  // device name in a comment explaining WHY is the documentation, so comments are stripped first.
  const rules = declarations(fold);
  for (const word of ["Fold6", "Fold7", "Flip6", "Flip7", "Pixel", "iPhone", "Galaxy", "Surface", "Android"]) {
    assert.ok(!rules.includes(word), `a rule in assets/fold.css names a device: ${word}`);
  }
});

test("control: the device-name scan sees a name in a rule and ignores one in a comment", () => {
  assert.ok(declarations("/* the Galaxy note */ .a { color: red; }").includes("Galaxy") === false);
  assert.ok(declarations('.a[data-device="Galaxy"] { color: red; }').includes("Galaxy"));
});

// ── posture, and the reduced-motion promise ──────────────────────────────────────────────────

test("posture is answered both ways: the media feature and the mirrored attribute", () => {
  assert.match(fold, /@media\s*\(\s*device-posture:\s*folded\s*\)/);
  assert.match(fold, /:root\[data-posture="folded"\]/);
  // continuous is written down rather than left to the absence of the folded rule
  assert.match(fold, /:root\[data-posture="continuous"\]/);
});

test("the folded state is translucent, and blurs only where the browser supports it", () => {
  assert.match(fold, /color-mix\(in srgb, var\(--paper\) 62%, transparent\)/);
  assert.match(fold, /@supports\s*\(\(?backdrop-filter:\s*blur\(1px\)\)?/);
  assert.match(fold, /--frame-glass:\s*blur\(12px\)/);
});

/** The scanner the reduced-motion claim rests on, so it can be proven before it is trusted. */
const honoursReducedMotion = (css) => {
  const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
  if (at < 0) return false;
  return /transition:\s*none/.test(block(css, "@media (prefers-reduced-motion: reduce)"));
};

test("the 240ms posture transition is switched off under prefers-reduced-motion", () => {
  assert.match(fold, /transition:[^;]*240ms ease/);
  assert.equal(honoursReducedMotion(fold), true);
});

test("control: the reduced-motion scanner reports a stylesheet that lacks the rule", () => {
  assert.equal(honoursReducedMotion(".card { transition: background-color 240ms ease; }"), false);
  assert.equal(
    honoursReducedMotion(
      ".card { transition: background-color 240ms ease; }\n@media (prefers-reduced-motion: reduce) { .card { color: red; } }",
    ),
    false,
    "a reduced-motion block that does not stop the transition must not count",
  );
});

// ── the frames, at every width in the table ──────────────────────────────────────────────────

test("the sidebar collapse boundary is 52rem, and fold.css does not move it", () => {
  assert.match(base, /@media \(min-width: 52rem\) \{/);
  const expanded = block(base, "@media (min-width: 52rem)");
  assert.match(expanded, /grid-template-columns:\s*14rem minmax\(0, 1fr\)/);
  // fold.css owns the COLLAPSED side of the same boundary and no other value of it
  assert.match(fold, /@media \(max-width: 51\.999rem\)/);
  const others = [...fold.matchAll(/\((?:min|max)-width:\s*([\d.]+)rem\)/g)].map((m) => m[1]);
  assert.ok(others.includes("51.999"), "fold.css does not address the collapsed side at all");
});

test("the checkout card is capped at 28rem and centred, in the same rule", () => {
  // Anchored on the cap rather than on the first `.checkout {` in the file, because the narrow
  // block redeclares padding on the same selector and a positional match would read that one.
  const rules = [...declarations(fold).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel, body]) => /(^|,)\s*\.checkout\s*$/m.test(sel.trim()) && /max-width:\s*28rem/.test(body))
    .map(([, , body]) => body);
  assert.equal(rules.length, 1, "the 28rem cap on .checkout is missing or declared more than once");
  assert.match(rules[0], /margin-inline:\s*auto/, "the card is capped but not centred");
});

test("the keypad fills the width on a phone and is capped above it", () => {
  const narrow = block(fold, "@media (max-width: 29.999rem)");
  assert.match(narrow, /\.register\s*\{[^}]*max-width:\s*none/s);
  const wide = block(fold, "@media (min-width: 30rem)");
  assert.match(wide, /\.register\s*\{[^}]*max-width:\s*24rem/s);
});

test("44px targets are reached on a coarse pointer for the four controls under it", () => {
  const coarse = block(fold, "@media (pointer: coarse)");
  for (const sel of [".wchip .cta", ".wchip select", ".fold summary", ".theme-pick > select"]) {
    assert.ok(coarse.includes(sel), `${sel} is not raised to 44px on a coarse pointer`);
  }
  assert.match(coarse, /min-height:\s*44px/);
});

test("the theme control's own rule is beaten on order, which requires fold.css to load after it", () => {
  // theme.css sets `.theme-pick > select { min-height: calc(var(--space) * 9) }` — 36px. The
  // override above matches its specificity exactly, so it only wins because of link order. If the
  // shell ever moves fold.css above screens/, the control drops back to 36px in silence, and this
  // is the check that would notice.
  const theme = readFileSync(join(OUT, "assets", "screens", "theme.css"), "utf8");
  assert.match(theme, /\.theme-pick > select \{[^}]*min-height:\s*calc\(var\(--space\) \* 9\)/s);
  const html = readFileSync(join(OUT, "index.html"), "utf8");
  assert.ok(
    html.indexOf("assets/screens/theme.css") < html.indexOf("assets/fold.css"),
    "fold.css is loaded before screens/theme.css, so the 44px override no longer applies",
  );
});

/**
 * The pure layout check. A page scrolls sideways when something is given a fixed width larger than
 * the column it sits in and is not capped. 320 CSS px is the floor this product supports and
 * fold.css sets 12px gutters there, so the narrowest content box is 320 - 24 = 296.
 *
 * Returns the offending declarations, so a failure names them instead of merely counting them.
 */
const NARROWEST_CONTENT_BOX = 296;
function fixedWidthsOverflowing(css) {
  const bad = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = m;
    const width = body.match(/(?:^|[;\s])width:\s*(\d+(?:\.\d+)?)(px|rem)\s*(?:;|$)/);
    if (!width) continue;
    const px = width[2] === "rem" ? Number(width[1]) * 16 : Number(width[1]);
    if (px <= NARROWEST_CONTENT_BOX) continue;
    if (/max-width:\s*100%/.test(body)) continue;
    bad.push(`${selector.trim().slice(0, 60)} → width: ${width[1]}${width[2]}`);
  }
  return bad;
}

test("no rule fixes a width wider than the narrowest content box without capping it", () => {
  const offenders = [...fixedWidthsOverflowing(base), ...fixedWidthsOverflowing(fold)];
  assert.deepEqual(offenders, [], `these would push the page sideways at 320px:\n  ${offenders.join("\n  ")}`);
});

test("control: the overflow scanner catches a planted uncapped width", () => {
  assert.deepEqual(fixedWidthsOverflowing(".wide { width: 640px; }"), [".wide → width: 640px"]);
  // ...and stays quiet when the same width is capped, or is inside the box
  assert.deepEqual(fixedWidthsOverflowing(".wide { width: 640px; max-width: 100%; }"), []);
  assert.deepEqual(fixedWidthsOverflowing(".qr { width: 220px; }"), []);
});

test("wide content scrolls inside its own container, never on the document", () => {
  assert.match(base, /\.table-wrap \{[^}]*overflow-x:\s*auto/s);
  assert.match(fold, /overflow-x:\s*auto/);
  // the page's own inline axis is never clipped or hidden, which would mask the bug instead
  assert.ok(!/\b(html|body)\s*\{[^}]*overflow-x:\s*(hidden|clip)/s.test(fold));
});

// ── the glass treatment keeps its contrast, in both schemes ──────────────────────────────────

const hexOf = (css, name, from = 0) => {
  const m = css.slice(from).match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  return m ? m[1] : null;
};
const chan = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : (((c / 255 + 0.055) / 1.055) ** 2.4));
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const [r, g, b] = rgb(h);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a, b, pa) =>
  "#" +
  rgb(a)
    .map((ca, i) => Math.round(ca * pa + rgb(b)[i] * (1 - pa)).toString(16).padStart(2, "0"))
    .join("");

test("control: the contrast function fails a pair that must fail and passes one that must pass", () => {
  assert.ok(ratio("#000000", "#ffffff") > 20);
  assert.ok(ratio("#777777", "#808080") < 4.5);
});

test("the two ways of being dark declare the same ground, so one contrast run covers both", () => {
  // assets/unica.css carries the dark tokens twice: once for the system preference and once for
  // the explicit toggle on :root[data-theme="dark"]. They are separate blocks and can drift, and
  // the contrast run below reads only the first — so the run is only honest while they agree.
  const bySystem = base.indexOf("@media (prefers-color-scheme: dark)");
  const byChoice = base.indexOf(':root[data-theme="dark"]');
  assert.ok(byChoice > 0, "the explicit dark toggle no longer declares its own tokens");
  for (const token of ["paper", "ink", "accent", "on-accent"]) {
    assert.equal(
      hexOf(base, token, byChoice),
      hexOf(base, token, bySystem),
      `--${token} differs between the system dark scheme and the toggled one`,
    );
  }
});

test("the folded panel keeps 4.5:1 in both schemes, over every surface it can sit on", () => {
  const darkAt = base.indexOf("@media (prefers-color-scheme: dark)");
  const schemes = [
    { name: "light", paper: hexOf(base, "paper"), ink: hexOf(base, "ink") },
    { name: "dark", paper: hexOf(base, "paper", darkAt), ink: hexOf(base, "ink", darkAt) },
  ];
  const alpha = Number(fold.match(/var\(--paper\) (\d+)%, transparent/)[1]) / 100;
  assert.equal(alpha, 0.62);

  const worst = { ink: Infinity, muted: Infinity };
  for (const s of schemes) {
    assert.ok(s.paper && s.ink, `could not read the ${s.name} scheme out of the stylesheet`);
    const surface = mix(s.ink, s.paper, 0.05); // --surface
    const line = mix(s.ink, s.paper, 0.14); // --line
    const muted = mix(s.ink, s.paper, 0.66); // --muted
    for (const behind of [s.paper, surface, line]) {
      const panel = mix(s.paper, behind, alpha);
      worst.ink = Math.min(worst.ink, ratio(s.ink, panel));
      worst.muted = Math.min(worst.muted, ratio(muted, panel));
    }
  }
  assert.ok(worst.ink >= 4.5, `body text on the folded panel bottoms out at ${worst.ink.toFixed(2)}:1`);
  assert.ok(worst.muted >= 4.5, `quiet text on the folded panel bottoms out at ${worst.muted.toFixed(2)}:1`);
});

test("no external URL reached the fold stylesheet", () => {
  assert.deepEqual(fold.match(/https?:\/\/[^\s"')]+/g) ?? [], []);
});

// ── how the shell includes it ────────────────────────────────────────────────────────────────

/**
 * THE WIRING IS NOT THIS FILE'S TO DO, AND THE ORDER IS NOT NEGOTIABLE. `src/shell.mjs` places the
 * two tags, because a change to the shell touches every route and belongs to whoever owns it. What
 * IS asserted here is the contract: fold.css after unica.css, or every cascade override in it loses
 * to the file it is meant to override, and fold.js as a module.
 *
 * The check is written against however many documents currently carry the link, and it states that
 * number, so "the shell has not wired it yet" and "the shell wired it wrongly" cannot look the same
 * in a summary. The moment the first document links it, the ordering becomes a hard requirement.
 */
test("where the shell links it, fold.css comes after unica.css and fold.js is a module", () => {
  const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
  const docs = [...manifest.routes.map((r) => r.file), "404.html"];
  const linked = [];
  for (const rel of docs) {
    const html = readFileSync(join(OUT, rel), "utf8");
    if (!html.includes("assets/fold.css")) continue;
    linked.push(rel);
    assert.ok(
      html.indexOf("assets/unica.css") < html.indexOf("assets/fold.css"),
      `${rel} loads fold.css before unica.css, so every override in it is discarded`,
    );
    assert.match(html, /<script type="module" src="[^"]*assets\/fold\.js"><\/script>/, `${rel} does not load fold.js as a module`);
  }
  console.log(
    linked.length === docs.length
      ? `      fold.css is linked by all ${docs.length} emitted documents`
      : `      fold.css is linked by ${linked.length} of ${docs.length} emitted documents — the shell wiring is owned by src/shell.mjs and has not landed here`,
  );
});

test("the build emits both files into the artifact, whatever the shell does with them", () => {
  const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
  const files = manifest.files.map((f) => f.file);
  assert.ok(files.includes("assets/fold.css"), "assets/fold.css is not in the emitted artifact");
  assert.ok(files.includes("assets/fold.js"), "assets/fold.js is not in the emitted artifact");
});

// ── fold.js: it mirrors the posture, and does nothing else ───────────────────────────────────

/** Load the module fresh against a planted global environment. */
async function loadFold(navigator) {
  const el = {
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
  };
  const previous = { navigator: globalThis.navigator, document: globalThis.document };
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true, writable: true });
  globalThis.document = { documentElement: el };
  try {
    const url = pathToFileURL(join(APP, "assets", "fold.js")).href + `?n=${Math.random()}`;
    const mod = await import(url);
    return { el, mod };
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: previous.navigator, configurable: true, writable: true });
    globalThis.document = previous.document;
  }
}

test("with no DevicePosture API it does nothing and leaves the attribute unset", async () => {
  const { el } = await loadFold({});
  assert.deepEqual(el.attrs, {}, "an absent API must not be reported as a posture");
});

test("with a fake API it writes the posture, and rewrites it on change", async () => {
  const listeners = [];
  const posture = {
    type: "continuous",
    addEventListener(name, fn) {
      if (name === "change") listeners.push(fn);
    },
  };
  const { el } = await loadFold({ devicePosture: posture });
  assert.equal(el.attrs["data-posture"], "continuous");
  assert.equal(listeners.length, 1, "the change event is not listened for");

  posture.type = "folded";
  listeners[0]();
  assert.equal(el.attrs["data-posture"], "folded");

  posture.type = "continuous";
  listeners[0]();
  assert.equal(el.attrs["data-posture"], "continuous");
});

test("a posture word the specification does not define is dropped, not passed through", async () => {
  const listeners = [];
  const posture = {
    type: "half-open",
    addEventListener(n, fn) {
      if (n === "change") listeners.push(fn);
    },
  };
  const { el } = await loadFold({ devicePosture: posture });
  assert.equal(el.attrs["data-posture"], undefined);
  posture.type = "folded";
  listeners[0]();
  assert.equal(el.attrs["data-posture"], "folded");
  posture.type = "tent";
  listeners[0]();
  assert.equal(el.attrs["data-posture"], undefined, "an unknown posture must clear the attribute");
});

test("fold.js exports nothing", async () => {
  const { mod } = await loadFold({});
  assert.deepEqual(Object.keys(mod), []);
});

// ── the research document ────────────────────────────────────────────────────────────────────

/** Rows of the viewport table: the first table in the document whose header names a viewport. */
function viewportRows(md) {
  const lines = md.split("\n");
  const head = lines.findIndex((l) => /^\|\s*Device\s*\|/.test(l));
  assert.ok(head >= 0, "the viewport table is missing its Device header");
  const rows = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i]);
  return rows;
}

test("every device row in SCREENS.md carries a source URL", () => {
  const rows = viewportRows(screens);
  assert.ok(rows.length >= 11, `only ${rows.length} device rows; the brief names eleven devices`);
  const without = rows.filter((r) => !/https?:\/\/\S+/.test(r)).map((r) => r.split("|")[1].trim());
  assert.deepEqual(without, [], `these rows state a size with no source: ${without.join(", ")}`);
});

test("control: the row scanner catches a row with no URL", () => {
  const planted = "| Device | Cover | Inner | Basis | Source |\n|---|---|---|---|---|\n| Made up | 111 × 222 | — | — | trust me |\n";
  const rows = viewportRows(planted);
  assert.equal(rows.length, 1);
  assert.equal(/https?:\/\/\S+/.test(rows[0]), false);
});

test("every device the brief names has a row", () => {
  for (const name of [
    "iPhone 15",
    "iPhone 16",
    "iPhone 16 Pro Max",
    "iPad (10th generation)",
    "iPad Air",
    "Galaxy S24",
    "Galaxy S25",
    "Galaxy Z Fold6",
    "Galaxy Z Fold7",
    "Galaxy Z Flip6",
    "Galaxy Z Flip7",
    "Pixel 9 Pro Fold",
    "iPhone Duo",
  ]) {
    assert.ok(screens.includes(name), `SCREENS.md has no row for ${name}`);
  }
});

test("SCREENS.md says plainly that the platform has posture and segments, not a hinge angle", () => {
  assert.match(screens, /posture and segments, not a hinge angle/);
  assert.match(screens, /not, and\s*\n?cannot be, an animation driven by the angle of the hinge/);
});

test("a size nobody publishes is marked UNCONFIRMED rather than filled in", () => {
  // The Fold7 and Flip7 CSS viewports were not published by any source found; the panels were.
  assert.ok(screens.includes("UNCONFIRMED"), "no row admits a gap, which after this survey is not credible");
  const rows = viewportRows(screens);
  const fold7 = rows.find((r) => r.includes("Fold7"));
  assert.ok(fold7 && fold7.includes("UNCONFIRMED"), "the Fold7 CSS viewport is stated without a source");
});

test("every breakpoint the brief names is accounted for in the widths table", () => {
  for (const w of ["320", "360", "390", "430", "744", "820", "1024", "1280", "1440"]) {
    assert.ok(new RegExp(`^\\| ${w} \\|`, "m").test(screens), `${w} CSS px is not in the widths table`);
  }
});

// ── the counts in SCREENS.md are re-counted, not trusted ─────────────────────────────────────

/**
 * Every .html the build emitted, so a count is over the artifact and not over the source tree.
 */
function emittedDocuments(dir = OUT, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) emittedDocuments(p, acc);
    else if (entry.name.endsWith(".html")) acc.push(p);
  }
  return acc;
}

/**
 * How many emitted documents carry at least one element with this CLASS TOKEN.
 *
 * By token, and the distinction is the whole point of the function: `pay/` carries
 * `id="checkout"` and a `.co-card`, and neither is a `.checkout`. A substring search over the HTML
 * would report 2 for a class that nothing in the product renders, which is exactly the wrong number
 * that was in SCREENS.md before this test existed.
 */
function documentsRendering(cls, docs) {
  let n = 0;
  for (const p of docs) {
    const html = readFileSync(p, "utf8");
    for (const m of html.matchAll(/class="([^"]*)"/g)) {
      if (m[1].split(/\s+/).includes(cls)) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** The `| `.name` | 7 … |` rows of the block table, as [class, count] pairs. */
function blockCountRows(md) {
  return [...md.matchAll(/^\| `\.([a-z-]+)` \| \*{0,2}(\d+)\*{0,2}/gm)].map((m) => [m[1], Number(m[2])]);
}

test("control: the class-token count separates a class from an id and from a longer name", () => {
  const docs = emittedDocuments();
  // pay/ has id="checkout" and class="co-card". The contract's .checkout is rendered by nothing.
  const pay = readFileSync(join(OUT, "pay", "index.html"), "utf8");
  assert.ok(pay.includes('id="checkout"'), "the fixture for this control is gone: pay/ no longer has that id");
  assert.ok(pay.includes('class="co-card"'), "the fixture for this control is gone: pay/ no longer has that class");
  assert.equal(documentsRendering("checkout", docs), 0, "an id was counted as a class");
  assert.ok(documentsRendering("co-card", docs) > 0, "the class the page really renders was not seen");
  assert.ok(
    documentsRendering("card", docs) < documentsRendering("co-card", docs) + documentsRendering("card", docs),
    "`card` and `co-card` are being conflated",
  );
});

test("every count in the SCREENS.md block table is the number the artifact actually shows", () => {
  const docs = emittedDocuments();
  const rows = blockCountRows(screens);
  assert.ok(rows.length >= 10, `the block table in SCREENS.md was not found (${rows.length} rows parsed)`);
  const wrong = [];
  for (const [cls, claimed] of rows) {
    const actual = documentsRendering(cls, docs);
    if (actual !== claimed) wrong.push(`.${cls}: SCREENS.md says ${claimed}, the artifact shows ${actual}`);
  }
  assert.deepEqual(wrong, [], `SCREENS.md has gone stale:\n  ${wrong.join("\n  ")}`);
  // A stated negative, so an empty result and a broken parser cannot look the same.
  console.log(`SCREENS.md block table: ${rows.length} rows re-counted against ${docs.length} documents, 0 wrong`);
});

test("the contract's own names are rendered by nothing, and SCREENS.md says so", () => {
  const docs = emittedDocuments();
  for (const cls of ["checkout", "register", "empty"]) {
    assert.equal(documentsRendering(cls, docs), 0, `.${cls} is on screen now — SCREENS.md's claim that it is not is stale`);
  }
  assert.match(screens, /No document\s*\nemits either class\.|No document emits either class\./);
});

// ── section 7 reaches past the route stylesheet, or it reaches nothing ────────────────────────

test("the 28rem cap is on the card the product actually renders, at a specificity that survives", () => {
  const rules = [...declarations(fold).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel, body]) => /\.co-card/.test(sel) && /max-width:\s*28rem/.test(body));
  assert.equal(rules.length, 1, "the 28rem cap on .co-card is missing or declared more than once");
  const [, selector, body] = rules[0];
  assert.match(body, /margin-inline:\s*auto/, "the card is capped but not centred");
  // (0,2,0) — the layout class prefix is what beats screens/checkout.css, which is linked later.
  assert.match(selector, /\.lay-checkout\s+\.co-card/, "the cap is not prefixed, so the route stylesheet wins");
});

/**
 * Flatten a stylesheet to [selector, property] facts, including rules nested inside @media, with
 * the selector's specificity. Only class/id/element counting is needed here: nothing in these files
 * uses a selector these three numbers cannot rank.
 */
/**
 * The shorthands these four stylesheets actually use, expanded to the longhands they set.
 *
 * Not the full CSS shorthand set, and deliberately not: a table copied out of the specification
 * would be mostly dead weight and would still need checking. It is here because the first version
 * of this scanner compared property NAMES literally, so `background-color` in fold.css and
 * `background` in screens/checkout.css looked like two unrelated properties — and a sabotage run
 * that deleted the prefix from the glass rule went green. A shorthand is a collision.
 */
const SHORTHANDS = {
  background: ["background-color", "background-image"],
  border: ["border-color", "border-width", "border-style"],
  "border-radius": [],
  font: ["font-size", "font-weight", "font-family"],
  gap: ["row-gap", "column-gap"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  inset: ["top", "right", "bottom", "left"],
  "margin-inline": ["margin-left", "margin-right"],
  transition: ["transition-property", "transition-duration"],
};

/** A property plus everything it also sets, so shorthand and longhand compare equal. */
function propertyAndWhatItSets(prop) {
  return [prop, ...(SHORTHANDS[prop] ?? [])];
}

function selectorFacts(css) {
  const out = [];
  for (const [, rawSelector, body] of declarations(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].flatMap((m) => propertyAndWhatItSets(m[1]));
    if (!props.length) continue;
    for (const one of rawSelector.split(",").map((x) => x.trim()).filter(Boolean)) {
      if (one.startsWith("@")) continue;
      const spec = [
        (one.match(/#[\w-]+/g) ?? []).length,
        (one.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+\(?/g) ?? []).length,
        (one.match(/(?:^|[\s>+~])[a-z]+/g) ?? []).length,
      ];
      const keyCompound = one.split(/[\s>+~]+/).filter(Boolean).pop() ?? one;
      out.push({
        selector: one,
        props,
        spec,
        key: new Set((keyCompound.match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1))),
      });
    }
  }
  return out;
}

const rank = (a) => a[0] * 10000 + a[1] * 100 + a[2];

/**
 * THE INVARIANT, stated as the cascade states it. fold.css is linked in <head>; a route's
 * assets/screens/*.css is linked inside <main>, so it comes LATER. Later wins at equal specificity.
 * Therefore any rule in fold.css that sets a property a route stylesheet also sets, on an element
 * both can match, must be STRICTLY more specific — or it silently does nothing.
 *
 * This replaced a first version that sliced the file at section 7's comment heading and asked
 * whether each selector carried a layout prefix. That version had two faults, and the sabotage run
 * found the second: it named prose as selectors when the slice cut a comment in half, and when the
 * prefix was removed from the 28rem cap the slice's own anchor MOVED PAST the sabotaged rule, so
 * the check went green on exactly the damage it existed to catch. A check whose scope is defined by
 * the text it is checking can be walked out of. This one has no anchor and no scope: it reads every
 * rule in the file.
 */
function losesToRouteStylesheet(foldCss, routeSheets) {
  const mine = selectorFacts(foldCss);
  const theirs = routeSheets.flatMap((sheet) => selectorFacts(sheet));
  const beaten = [];
  for (const m of mine) {
    for (const t of theirs) {
      // The KEY compound — the rightmost one — is what decides which ELEMENT a rule lands on.
      // Comparing any shared class instead reported `.lay-app .pos { gap }` as beaten by
      // `.pos .keypad { gap }`, which is wrong: those style the container and the grid inside it.
      const shared = [...m.key].filter((c) => t.key.has(c));
      if (!shared.length) continue;
      const clash = [...new Set(m.props.filter((prop) => t.props.includes(prop)))];
      if (!clash.length) continue;
      if (rank(m.spec) > rank(t.spec)) continue;
      beaten.push(`${m.selector} { ${clash.join(", ")} } is beaten by ${t.selector} (later in the document)`);
    }
  }
  return [...new Set(beaten)];
}

/**
 * The overrides that are MEANT to be beaten, each with the reason. Everything else is a bug.
 *
 * This is a list and not a loosened check on purpose: weakening the scanner to make these go quiet
 * would also silence the next real one. A rule that belongs here is a rule where the later file is
 * doing the same job, deliberately, and doing it at least as well. The test below it asserts each
 * excuse is still needed, so the list cannot outlive its reasons — it has already caught one:
 * `.theme-pick` was excused here until that test pointed out the scanner never flagged it.
 *
 * WHERE THIS SCANNER IS BLIND, stated rather than left to be discovered. It compares the classes of
 * the KEY compound, so a selector whose key compound is a bare element — `.theme-pick > select`,
 * which theme.css and fold.css both declare at identical specificity — is invisible to it. That
 * exact pair is the one deliberate order-dependent override in this file, and it has its own named
 * test above asserting the link order it depends on. Two blind spots remain unguarded and are worth
 * knowing about: a route stylesheet that arrives later with a NEW element-keyed collision, and any
 * clash decided by !important, which nothing in these files uses.
 */
const INTENDED_OVERRIDES = [
  // checkout.css sets the same `min-width: 0` on the same element. Identical value, no behaviour to
  // lose; fold.css keeps it so section 1 is complete on its own.
  ".co-line-what",
  // pos.css sizes the till's keypad LARGER than fold.css's floor at every width — 12px gap and 64px
  // keys against 8px and 60px — so the route stylesheet winning is the better outcome, not a
  // regression. fold.css's values stay as the floor for the `.keypad` of DESIGN.md, which no
  // document renders outside the till yet (see the block table in docs/unica-v4/SCREENS.md).
  ".keypad",
];

test("no fold.css rule is silently beaten by a route stylesheet loaded after it", () => {
  const routes = ["checkout.css", "pos.css", "theme.css"].map((f) =>
    readFileSync(join(OUT, "assets", "screens", f), "utf8"),
  );
  const beaten = losesToRouteStylesheet(fold, routes);
  const unexplained = beaten.filter((b) => !INTENDED_OVERRIDES.some((allowed) => b.startsWith(allowed)));
  assert.deepEqual(unexplained, [], `these rules do nothing on the page:\n  ${unexplained.join("\n  ")}`);
  // A stated negative: an empty list and a scanner that found nothing must not look the same.
  console.log(
    `cascade: ${selectorFacts(fold).length} fold.css selectors vs 3 route stylesheets — ` +
      `${beaten.length} beaten, ${INTENDED_OVERRIDES.length} kinds intended, ${unexplained.length} unexplained`,
  );
});

test("the intended overrides are real: each one is actually beaten, so the list cannot rot", () => {
  const routes = ["checkout.css", "pos.css", "theme.css"].map((f) =>
    readFileSync(join(OUT, "assets", "screens", f), "utf8"),
  );
  const beaten = losesToRouteStylesheet(fold, routes);
  for (const allowed of INTENDED_OVERRIDES) {
    assert.ok(
      beaten.some((b) => b.startsWith(allowed)),
      `${allowed} is excused from the cascade check but is no longer beaten — delete the excuse`,
    );
  }
});

test("the till's keys are at least as big as fold.css asks, whichever file wins", () => {
  // The reason `.keypad` is on the excuse list, checked rather than asserted in a comment.
  const pos = readFileSync(join(OUT, "assets", "screens", "pos.css"), "utf8");
  const posKey = block(pos, ".pos .keypad .key");
  const mine = block(block(fold, "@media (max-width: 29.999rem)"), ".keypad .key");
  const px = (css) => Number(css.match(/min-height:\s*calc\(var\(--space\) \* (\d+)\)/)[1]) * 4;
  assert.ok(px(posKey) >= px(mine), `the till's keys are ${px(posKey)}px, below fold.css's ${px(mine)}px floor`);
  assert.ok(px(posKey) >= 44, `the till's keys are ${px(posKey)}px, under the 44px target`);
});

test("control: the cascade check catches a rule that the later stylesheet outranks", () => {
  // Equal specificity, same property, later file — the exact shape of the bug.
  assert.deepEqual(
    losesToRouteStylesheet(".co-card { max-width: 28rem; }", [".co-card { max-width: 34rem; }"]),
    [".co-card { max-width } is beaten by .co-card (later in the document)"],
  );
  // One class more, so it wins — and a property nobody else sets is never at risk.
  assert.deepEqual(
    losesToRouteStylesheet(".lay-checkout .co-card { max-width: 28rem; }", [".co-card { max-width: 34rem; }"]),
    [],
  );
  assert.deepEqual(losesToRouteStylesheet(".co-card { rotate: 1deg; }", [".co-card { max-width: 34rem; }"]), []);
  // A shorthand in the later file collides with a longhand in the earlier one. This is the case the
  // literal-name version of the scanner missed, proven here rather than assumed.
  assert.deepEqual(
    losesToRouteStylesheet(".co-card { background-color: red; }", [".co-card { background: blue; }"]),
    [".co-card { background-color } is beaten by .co-card (later in the document)"],
  );
  // And the key compound, not any shared class, decides which element a rule lands on.
  assert.deepEqual(losesToRouteStylesheet(".pos { gap: 1px; }", [".pos .keypad { gap: 2px; }"]), []);
});

test("fold.css is linked before every route stylesheet, which is why the prefixes are needed", () => {
  const pay = readFileSync(join(OUT, "pay", "index.html"), "utf8");
  assert.ok(
    pay.indexOf("assets/fold.css") < pay.indexOf("assets/screens/checkout.css"),
    "fold.css now loads after screens/checkout.css; section 7's specificity note is wrong",
  );
});

/** The text of a rule or at-rule block, matched by brace depth so a nested block is included. */
function block(css, opener) {
  const at = css.indexOf(opener);
  assert.ok(at >= 0, `not found in the stylesheet: ${opener}`);
  let i = css.indexOf("{", at);
  let depth = 0;
  const start = i;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after ${opener}`);
}
