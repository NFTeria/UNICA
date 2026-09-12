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
import { mkdtempSync, readFileSync } from "node:fs";
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

test("44px targets are reached on a coarse pointer for the three controls under it", () => {
  const coarse = block(fold, "@media (pointer: coarse)");
  for (const sel of [".wchip .cta", ".wchip select", ".fold summary"]) {
    assert.ok(coarse.includes(sel), `${sel} is not raised to 44px on a coarse pointer`);
  }
  assert.match(coarse, /min-height:\s*44px/);
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
