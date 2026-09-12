#!/usr/bin/env node
/**
 * The generator. Node standard library only for the build itself — no network, no secret, no server.
 * One declared dependency, the QR encoder (qrcode-generator, MIT), is copied from node_modules into
 * assets/vendor/ so the screens can draw a payment link as a code; the build refuses to run without it.
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
import { join, dirname, relative, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { ROUTES, NOT_FOUND } from "./src/routes.mjs";
import { BUILT_FOR_MAINNET, document_ } from "./src/shell.mjs";
import { NO_VALUE_BANNER } from "./assets/product.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * Where the artifact is written. `apps/web/out` unless UNICA_BUILD_OUT names somewhere else.
 *
 * WHY THE OVERRIDE EXISTS. `node --test apps/web/tests/*.test.mjs` runs the test files in PARALLEL,
 * and more than one of them needs a freshly built artifact to make claims about. Two builds into one
 * directory is a race — the first line of this generator deletes the directory the other is reading —
 * and a gate that fails one run in five teaches everybody to re-run it until it is green, which is
 * worse than no gate. A test that builds gives itself a directory of its own instead.
 */
const OUT = process.env.UNICA_BUILD_OUT ? resolve(process.env.UNICA_BUILD_OUT) : join(HERE, "out");
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

// ── the link-preview rasteriser ───────────────────────────────────────────────────────────────
/**
 * WHY THIS EXISTS AT ALL. A link preview has to be a PNG: several of the places a UNICA link gets
 * pasted will not render an SVG card, and one of them silently shows nothing at all. The repository
 * has one declared dependency and it is a QR encoder; adding a headless browser or an SVG toolchain
 * to draw six flat images would be a hundred megabytes of supply chain for six rectangles.
 *
 * SO IT DRAWS SHAPES AND REFUSES TO PRETEND ABOUT TEXT. There is no font here — there is no font
 * ANYWHERE in this project, deliberately, since the stylesheet may not fetch one — so the rasteriser
 * reads a preview drawing's `rect`, `circle` and `polygon` elements and ignores its `text`. The
 * words that belong to a card are carried by og:title and og:description, which is where a scraper
 * reads them from anyway, and a card that draws its own headline in a font the reader does not have
 * is a card that draws it in the wrong one.
 *
 * THE ENCODER IS WRITTEN FROM THE PNG SPECIFICATION. Signature, then IHDR (8-bit, colour type 6,
 * no interlace), then one IDAT of the zlib stream node:zlib produces from the filtered scanlines,
 * then IEND — each chunk length-prefixed and CRC-32 checked with the polynomial the specification
 * names. Every scanline uses filter type 0: these images are flat colour, where filtering buys
 * nothing and costs the ability to read the encoder and believe it.
 *
 * It supersamples 3× and box-averages down, which is the whole of its anti-aliasing.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** @param {Buffer} rgba width*height*4 bytes, row major, no padding. */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  const stride = width * 4;
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0; // filter type 0, none
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(filtered, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** `#rrggbb`, or the fallback inside a `var(--token, #rrggbb)`. Anything else is not paint. */
function parseColour(value) {
  const text = String(value ?? "");
  const inVar = text.match(/var\(\s*--[\w-]+\s*,\s*(#[0-9a-fA-F]{6})\s*\)/);
  const hexColour = inVar?.[1] ?? text.match(/^\s*(#[0-9a-fA-F]{6})\s*$/)?.[1];
  if (!hexColour) return null;
  const n = parseInt(hexColour.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const num = (tag, name, fallback = 0) => {
  const v = Number(attr(tag, name));
  return Number.isFinite(v) ? v : fallback;
};

/** Every filled shape a preview drawing declares, in document order. `text` is not one of them. */
function shapesOf(svg) {
  const out = [];
  for (const [tag] of svg.matchAll(/<(?:rect|circle|polygon)\b[^>]*>/g)) {
    const fill = parseColour(attr(tag, "fill"));
    if (!fill) continue;
    if (tag.startsWith("<rect")) {
      out.push({ kind: "rect", fill, x: num(tag, "x"), y: num(tag, "y"), w: num(tag, "width"), h: num(tag, "height") });
    } else if (tag.startsWith("<circle")) {
      out.push({ kind: "circle", fill, cx: num(tag, "cx"), cy: num(tag, "cy"), r: num(tag, "r") });
    } else {
      const points = (attr(tag, "points") ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (points.length >= 3) out.push({ kind: "polygon", fill, points });
    }
  }
  return out;
}

function viewBoxOf(svg) {
  const parts = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) throw new Error("a preview drawing must declare a viewBox");
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

/** An RGB surface at the supersampled resolution. Alpha is added once, at encode time. */
function surface(width, height, fill) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
  }
  return { width, height, data };
}

function paint(surf, x, y, rgb) {
  if (x < 0 || y < 0 || x >= surf.width || y >= surf.height) return;
  const i = (y * surf.width + x) * 3;
  surf.data[i] = rgb[0];
  surf.data[i + 1] = rgb[1];
  surf.data[i + 2] = rgb[2];
}

/** Draws one drawing's shapes into `surf`, mapping its viewBox onto the given box. */
function drawSvg(surf, svg, box) {
  const vb = viewBoxOf(svg);
  const sx = box.w / vb.w;
  const sy = box.h / vb.h;
  const toX = (ux) => box.x + (ux - vb.x) * sx;
  const toY = (uy) => box.y + (uy - vb.y) * sy;
  for (const shape of shapesOf(svg)) {
    if (shape.kind === "rect") {
      const x0 = Math.round(toX(shape.x));
      const y0 = Math.round(toY(shape.y));
      const x1 = Math.round(toX(shape.x + shape.w));
      const y1 = Math.round(toY(shape.y + shape.h));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) paint(surf, x, y, shape.fill);
    } else if (shape.kind === "circle") {
      const cx = toX(shape.cx);
      const cy = toY(shape.cy);
      const rx = shape.r * sx;
      const ry = shape.r * sy;
      const y0 = Math.floor(cy - ry);
      const y1 = Math.ceil(cy + ry);
      for (let y = y0; y <= y1; y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) paint(surf, x, y, shape.fill);
        }
      }
    } else {
      // Even-odd scanline fill. Every mark in this project is a convex figure, but even-odd is the
      // rule SVG states by default and costs nothing to honour.
      const pts = shape.points.map(([ux, uy]) => [toX(ux), toY(uy)]);
      const ys = pts.map((p) => p[1]);
      const y0 = Math.floor(Math.min(...ys));
      const y1 = Math.ceil(Math.max(...ys));
      for (let y = y0; y <= y1; y++) {
        const mid = y + 0.5;
        const crossings = [];
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[(i + 1) % pts.length];
          if (ay === by) continue;
          if (mid >= Math.min(ay, by) && mid < Math.max(ay, by)) {
            crossings.push(ax + ((mid - ay) / (by - ay)) * (bx - ax));
          }
        }
        crossings.sort((a, b) => a - b);
        for (let i = 0; i + 1 < crossings.length; i += 2) {
          for (let x = Math.round(crossings[i]); x < Math.round(crossings[i + 1]); x++) paint(surf, x, y, shape.fill);
        }
      }
    }
  }
}

/** Box-average the supersampled surface down to the emitted size, and add an opaque alpha. */
function resolve4x(surf, width, height, scale) {
  const out = Buffer.alloc(width * height * 4);
  const area = scale * scale;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < scale; sy++) {
        const row = (y * scale + sy) * surf.width;
        for (let sx = 0; sx < scale; sx++) {
          const i = (row + x * scale + sx) * 3;
          r += surf.data[i];
          g += surf.data[i + 1];
          b += surf.data[i + 2];
        }
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / area);
      out[o + 1] = Math.round(g / area);
      out[o + 2] = Math.round(b / area);
      out[o + 3] = 255;
    }
  }
  return out;
}

const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const PREVIEW_SCALE = 3;
/**
 * Where the mark sits on a card, in emitted pixels: centred, at a size that survives the thumbnail
 * every chat client crops it to. Centred because the card carries no text — a mark pushed to one
 * margin with nothing beside it reads as an image that failed to load rather than as a brand.
 */
const PREVIEW_MARK = { x: 450, y: 165, w: 300, h: 300 };

function renderPreview(cardSvg, markSvg) {
  const w = PREVIEW_WIDTH * PREVIEW_SCALE;
  const h = PREVIEW_HEIGHT * PREVIEW_SCALE;
  const surf = surface(w, h, [255, 255, 255]);
  drawSvg(surf, cardSvg, { x: 0, y: 0, w, h });
  drawSvg(surf, markSvg, {
    x: PREVIEW_MARK.x * PREVIEW_SCALE,
    y: PREVIEW_MARK.y * PREVIEW_SCALE,
    w: PREVIEW_MARK.w * PREVIEW_SCALE,
    h: PREVIEW_MARK.h * PREVIEW_SCALE,
  });
  return encodePng(resolve4x(surf, PREVIEW_WIDTH, PREVIEW_HEIGHT, PREVIEW_SCALE), PREVIEW_WIDTH, PREVIEW_HEIGHT);
}

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
  // The QR encoder: a declared dependency, never retyped. Its notice travels with it.
  const qrDir = join(HERE, "..", "..", "node_modules", "qrcode-generator");
  if (!existsSync(join(qrDir, "dist", "qrcode.mjs"))) fail("the QR encoder is not installed: run npm ci at the repository root");
  mkdirSync(join(OUT, "assets", "vendor", "qrcode-generator"), { recursive: true });
  cpSync(join(qrDir, "dist", "qrcode.mjs"), join(OUT, "assets", "vendor", "qrcode-generator", "qrcode.mjs"));
  cpSync(join(qrDir, "README.md"), join(OUT, "assets", "vendor", "qrcode-generator", "NOTICE.md"));
  cpSync(join(qrDir, "package.json"), join(OUT, "assets", "vendor", "qrcode-generator", "package.json"));

  // ── the link previews ───────────────────────────────────────────────────────────────────────
  // One PNG per preview drawing, same stem, drawn from the drawing's own shapes plus the mark.
  // The SVGs stay: they are the source, they are readable in a diff, and the raster is derived.
  // This runs BEFORE the walk below, so every image it writes is in the manifest like any other
  // file — a preview nobody hashed is a preview nobody can prove was not swapped.
  const markSvg = readFileSync(join(ASSETS, "mark.svg"), "utf8");
  const cards = readdirSync(ASSETS)
    .filter((f) => /^og-.+\.svg$/.test(f))
    .sort();
  if (cards.length === 0) fail("no og-*.svg preview drawing was found in apps/web/assets");
  for (const card of cards) {
    const png = renderPreview(readFileSync(join(ASSETS, card), "utf8"), markSvg);
    if (png.length < 100) fail(`the preview raster for ${card} came out empty`);
    writeFileSync(join(OUT, "assets", card.replace(/\.svg$/, ".png")), png);
  }
  console.log(`link previews: ${cards.length} drawn at ${PREVIEW_WIDTH}x${PREVIEW_HEIGHT}, 0 failed`);

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

// ── 3b. the environment label is on every page, or the build said it is a public network ──────
// A build cannot drop the no-value label by accident: it has to be told UNICA_BUILD_ENVIRONMENT is
// PUBLIC_MAINNET, and then it must not carry the label either, so the artifact and the claim about
// the artifact can never disagree. This is the build-time half of `validateEnvironment`, which
// enforces the same rule at runtime against whatever deployment a page is actually reading.
{
  const htmlFiles = emitted.filter((f) => f.endsWith(".html"));
  const missing = [];
  const stale = [];
  for (const rel of htmlFiles) {
    const text = readFileSync(join(OUT, rel), "utf8");
    const hasLabel = text.includes(NO_VALUE_BANNER);
    if (!BUILT_FOR_MAINNET && !hasLabel) missing.push(rel);
    if (BUILT_FOR_MAINNET && hasLabel) stale.push(rel);
  }
  if (missing.length) fail(`these documents do not carry the ${NO_VALUE_BANNER} label: ${missing.join(", ")}`);
  if (stale.length) fail(`this build declares a public network but these documents still carry the ${NO_VALUE_BANNER} label: ${stale.join(", ")}`);
  console.log(
    BUILT_FOR_MAINNET
      ? `environment: PUBLIC_MAINNET declared; ${htmlFiles.length} documents checked, 0 carry the test label`
      : `environment: test network; ${htmlFiles.length} documents checked, ${htmlFiles.length} carry the ${NO_VALUE_BANNER} label`,
  );
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
