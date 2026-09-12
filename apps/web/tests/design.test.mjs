/**
 * The design system, executable.
 *
 * A style guide written as prose drifts from the stylesheet it describes and nobody notices until
 * two screens look like two products. Every rule in apps/web/DESIGN.md that CAN be checked is
 * checked here, against the real stylesheet and the real emitted artifact.
 *
 * THE CONTRAST CHECK RECOMPUTES, IT DOES NOT TRUST. The hex values are read out of the stylesheet
 * and the ratio is calculated from the WCAG definition — relative luminance of each colour, lighter
 * plus 0.05 over darker plus 0.05 — so a change of accent that forgets to change the text on it
 * fails here rather than in front of somebody who cannot read it. The ratio function itself is
 * proven first, on a pair whose answer is known and on a pair that must fail, because a contrast
 * checker that says everything passes is the easiest of all instruments to build by accident.
 *
 * Offline. No network, no chain, no wallet, no browser.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { layoutFor } from "../src/shell.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");

const css = readFileSync(join(APP, "assets", "unica.css"), "utf8");
const design = readFileSync(join(APP, "DESIGN.md"), "utf8");

/**
 * The artifact this file makes claims about, built into a directory of ITS OWN.
 *
 * `node --test apps/web/tests/*.test.mjs` runs the files in parallel, and build.test.mjs builds
 * too. Sharing apps/web/out means one run deletes the directory the other is halfway through
 * reading: measured at four failures in five runs when this file built there. A gate that fails
 * intermittently is worse than no gate, because it teaches everyone to run it again.
 */
const OUT = mkdtempSync(join(tmpdir(), "unica-design-"));
execFileSync(process.execPath, [join(APP, "build.mjs")], {
  encoding: "utf8",
  env: { ...process.env, UNICA_BUILD_OUT: OUT },
});
const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
const doc = (route) => readFileSync(join(OUT, manifest.routes.find((r) => r.route === route).file), "utf8");

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────

/** The first :root block, which is the light scheme and the source of every derived value. */
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const darkBlock = (() => {
  const at = css.indexOf("@media (prefers-color-scheme: dark)");
  return css.slice(at, css.indexOf("}", css.indexOf(":root {", at)));
})();
const tokenIn = (block, name) => block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;

test("the brand is four fields and a rule, all on :root", () => {
  for (const name of ["paper", "ink", "accent", "radius", "space", "on-accent"]) {
    assert.ok(tokenIn(rootBlock, name), `--${name} is not defined on :root`);
  }
  assert.equal(tokenIn(rootBlock, "radius"), "8px");
  assert.equal(tokenIn(rootBlock, "space"), "4px");
});

test("the dark scheme swaps the same fields and nothing else", () => {
  const swapped = ["paper", "ink", "accent", "on-accent"].filter((n) => tokenIn(darkBlock, n));
  assert.deepEqual(swapped, ["paper", "ink", "accent", "on-accent"]);
  // The derived neutrals must NOT be redefined there, or they have stopped being derived.
  for (const n of ["muted", "line", "surface", "accent-quiet"]) {
    assert.equal(tokenIn(darkBlock, n), null, `--${n} is redefined in the dark scheme instead of derived`);
  }
});

test("body text is 16px and the font stack is the system's", () => {
  const body = css.slice(css.indexOf("body {"), css.indexOf("}", css.indexOf("body {")));
  assert.match(body, /font:\s*400 16px/);
  assert.doesNotMatch(css, /@font-face|@import/);
});

test("only 400, 500 and 700 are used as font weights", () => {
  const weights = new Set([
    ...[...css.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]),
    ...[...css.matchAll(/font:\s*(\d+)\s/g)].map((m) => m[1]),
  ]);
  assert.deepEqual([...weights].sort(), ["400", "500", "700"]);
});

test("the focus ring is always the accent", () => {
  const focus = css.match(/:focus-visible\s*\{[^}]*\}/)[0];
  assert.match(focus, /outline:[^;]*var\(--accent\)/);
});

test("every spacing declaration is on the 4px grid", () => {
  const offGrid = [];
  for (const m of css.matchAll(/\b((?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?)\s*:\s*([^;{}]+)/g)) {
    for (const px of m[2].matchAll(/(\d+)px/g)) {
      if (Number(px[1]) % 4 !== 0) offGrid.push(`${m[1]}: ${m[2].trim()}`);
    }
  }
  assert.deepEqual(offGrid, []);
});

// ── the computed text colour on the accent ───────────────────────────────────────────────────────

/** Relative luminance, from the sRGB definition: linearise each channel, then weight them. */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio: lighter plus 0.05 over darker plus 0.05. 1 at worst, 21 at best. */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test("control: the ratio function agrees with a known answer and fails a pair that should fail", () => {
  assert.ok(contrast("#ffffff", "#000000") > 20.9, "black on white must be about 21:1");
  assert.ok(contrast("#ffffff", "#ffffff") < 1.01, "a colour on itself must be 1:1");
  assert.ok(contrast("#777777", "#888888") < 4.5, "two mid greys must not pass");
});

for (const [scheme, block] of [
  ["light", rootBlock],
  ["dark", darkBlock],
]) {
  test(`text on the accent clears 4.5:1 in the ${scheme} scheme`, () => {
    const accent = tokenIn(block, "accent");
    const on = tokenIn(block, "on-accent");
    assert.match(accent, /^#[0-9a-f]{6}$/i, `--accent in ${scheme} is not a plain hex value`);
    assert.match(on, /^#[0-9a-f]{6}$/i, `--on-accent in ${scheme} is not a plain hex value`);
    const ratio = contrast(accent, on);
    assert.ok(ratio >= 4.5, `${on} on ${accent} is only ${ratio.toFixed(2)}:1`);
  });
}

test("the choice of text colour is the better of the two candidates, not a habit", () => {
  // Near-white and near-black are the only two candidates; whichever the stylesheet names must be
  // the one that wins on that accent. This is what makes the value COMPUTED rather than picked.
  const NEAR_WHITE = "#f7faf8";
  const NEAR_BLACK = "#0d1411";
  for (const [scheme, block] of [["light", rootBlock], ["dark", darkBlock]]) {
    const accent = tokenIn(block, "accent");
    const on = tokenIn(block, "on-accent").toLowerCase();
    const better = contrast(accent, NEAR_WHITE) >= contrast(accent, NEAR_BLACK) ? NEAR_WHITE : NEAR_BLACK;
    assert.equal(on, better, `${scheme}: ${on} is not the better of the two on ${accent}`);
  }
  // ...and the answer genuinely differs between the schemes, or this check proves nothing.
  assert.notEqual(tokenIn(rootBlock, "on-accent"), tokenIn(darkBlock, "on-accent"));
});

// ── no external anything ─────────────────────────────────────────────────────────────────────────

test("the stylesheet fetches nothing from the network", () => {
  const found = css.match(/https?:\/\/[^\s"')]+/g) ?? [];
  assert.deepEqual(found, []);
});

test("control: that check would catch a planted URL", () => {
  assert.match("background: url(https://fonts.example/x.woff2);", /https?:\/\/[^\s"')]+/);
});

// ── the three layouts ────────────────────────────────────────────────────────────────────────────

test("layoutFor sends each kind of route to its own frame", () => {
  assert.equal(layoutFor(""), "marketing");
  assert.equal(layoutFor("legal/terms"), "marketing");
  assert.equal(layoutFor("business"), "app");
  assert.equal(layoutFor("business/payments/new"), "app");
  assert.equal(layoutFor("join"), "app");
  assert.equal(layoutFor("pay"), "checkout");
  assert.equal(layoutFor("receipt"), "checkout");
});

test("the three layouts are emitted, each with the furniture that defines it", () => {
  const home = doc("/");
  assert.match(home, /data-layout="marketing"/);
  assert.match(home, /<div class="hero"><h1>/);

  const business = doc("/business/");
  assert.match(business, /data-layout="app"/);
  assert.match(business, /<nav class="sidebar" aria-label="Primary">/);
  assert.match(business, /<header class="topbar">/);
  assert.match(business, /<div class="pagehead">/);

  const pay = doc("/pay/");
  assert.match(pay, /data-layout="checkout"/);
  assert.ok(!/<p class="bizid"/.test(pay), "the line above the checkout heading duplicated the identity block and was removed");
  assert.doesNotMatch(pay, /class="sidebar"/);
});

test("the no-value banner and the wallet chip are on all three", () => {
  for (const route of ["/", "/business/", "/pay/"]) {
    assert.match(doc(route), /class="envbar"/, `${route} lost the no-value banner`);
    assert.match(doc(route), /id="wallet-chip"/, `${route} has no wallet chip`);
  }
});

// ── the left menu points at real documents ───────────────────────────────────────────────────────

test("every link in the left menu resolves to a document this build emitted", () => {
  const business = doc("/business/");
  const menu = business.slice(business.indexOf('<ul class="sidenav">'), business.indexOf("</ul>", business.indexOf('<ul class="sidenav">')));
  const hrefs = [...menu.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs.length, 6, "the menu is meant to name six destinations");
  const missing = hrefs.filter((href) => {
    const path = href.split("#")[0].replace(/^(\.\.\/)+/, "");
    return !existsSync(join(OUT, path, "index.html"));
  });
  assert.deepEqual(missing, []);
});

test("control: a menu entry pointing at a screen nobody wrote would be caught", () => {
  assert.equal(existsSync(join(OUT, "business/analytics", "index.html")), false);
});

// ── DESIGN.md and the stylesheet cannot drift apart ──────────────────────────────────────────────

const designClasses = (() => {
  const names = new Set();
  for (const m of design.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c) names.add(c);
  return [...names].sort();
})();

const inStylesheet = (name) => new RegExp(`\\.${name.replace(/-/g, "\\-")}(?![-\\w])`).test(css);

test("every class named in DESIGN.md exists in the stylesheet", () => {
  assert.ok(designClasses.length >= 40, `only ${designClasses.length} classes documented`);
  assert.deepEqual(designClasses.filter((c) => !inStylesheet(c)), []);
});

test("control: a class nobody has styled is NOT found", () => {
  assert.equal(inStylesheet("not-a-real-block"), false);
});

test("DESIGN.md states the machine-word rule and the no-value rule", () => {
  // markdown emphasis and the line wrap are not part of the rule
  const plain = design.replace(/\*/g, "").replace(/\s+/g, " ");
  assert.match(plain, /hook, executor, registry, pool, tick, feed, calldata or hex/);
  assert.match(plain, /TESTNET \/ NO VALUE/);
  assert.match(plain, /Testnet. No real money./);
});

// ── the two admin screens the menu needed ────────────────────────────────────────────────────────

test("the new admin screens promise nothing they do not have", () => {
  for (const route of ["/business/products/", "/business/customers/"]) {
    const d = doc(route);
    const visible = d.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(visible, /\b(hook|executor|registry|pool|tick|feed|calldata|hex)s?\b/i);
    assert.match(visible, /yet/, `${route} should say plainly that it holds nothing yet`);
  }
});

// ── the wallet chip's behaviour ──────────────────────────────────────────────────────────────────
//
// The chip is the whole sign-in, so its branches are worth more than its pixels. It is driven here
// against a document of about forty lines: enough DOM for `driveChip` to build its nodes and for a
// click to be delivered, and nothing else. No browser, no wallet, no chain — every collaborator is
// a function that returns what a real one would have returned.

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.own = "";
    this.dataset = {};
    this.attributes = {};
    this.handlers = new Map();
    this.disabled = false;
  }
  set textContent(value) {
    this.own = String(value);
    this.children = [];
  }
  get textContent() {
    return this.own + this.children.map((c) => c.textContent).join(" ");
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.own = "";
    this.children = [...nodes];
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  addEventListener(type, fn) {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  async click() {
    for (const fn of this.handlers.get("click") ?? []) await fn();
  }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const hit = child.find(predicate);
      if (hit) return hit;
    }
    return null;
  }
}

const byId = new Map();
globalThis.location = { search: "", assign() {}, reload() {} };
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  getElementById: (id) => byId.get(id) ?? null,
};

const { driveChip, destinationFor, shortAddress } = await import("../assets/app.js");

const newChip = (prefix = "../") => {
  const chip = new FakeElement("div");
  chip.dataset.prefix = prefix;
  return chip;
};
const SESSION = { address: "0x00112233445566778899aabbccddeeff00112233", chainId: 31337 };
const never = () => {
  throw new Error("this collaborator should not have been called");
};

test("with no companion server the chip says the site is showing the product, not a business", async () => {
  const chip = newChip();
  await driveChip(chip, { load: async () => null, reconnect: never, login: never, accounts: never, business: never });
  assert.match(chip.textContent, /showing the product, not a business/);
  assert.equal(chip.find((n) => n.tag === "button"), null, "there must be no button to press");
});

test("a wallet that already approved this site is recognised without a prompt", async () => {
  const chip = newChip();
  const topbar = new FakeElement("span");
  byId.set("topbar-business", topbar);
  await driveChip(chip, {
    load: async () => ({ chainId: 31337, rpc: "practice" }),
    reconnect: async () => ({ session: SESSION }),
    login: never,
    accounts: never,
    business: async () => ({ available: true, joined: true, name: "freshcuts.unica.eth" }),
  });
  byId.delete("topbar-business");
  assert.match(chip.textContent, /0x001122…2233/);
  assert.match(chip.textContent, /Local testnet/);
  assert.match(chip.textContent, /Log out/);
  assert.equal(topbar.textContent, "freshcuts.unica.eth");
});

test("on the testnet the accounts that network unlocks are offered before logging in", async () => {
  const chip = newChip();
  await driveChip(chip, {
    load: async () => ({ chainId: 31337, rpc: "practice" }),
    reconnect: async () => null,
    login: never,
    accounts: async () => ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"],
    business: never,
  });
  const chooser = chip.find((n) => n.tag === "select");
  assert.ok(chooser, "no account chooser was offered");
  assert.equal(chooser.children.length, 2);
  assert.match(chip.textContent, /Log in with wallet/);
});

test("a wallet the chain has never seen is sent to setup, and an owner to their business", async () => {
  for (const [joined, expected] of [
    [false, "../join/"],
    [true, "../business/"],
  ]) {
    const chip = newChip();
    let went = null;
    await driveChip(chip, {
      load: async () => ({ chainId: 11155111 }),
      reconnect: async () => null,
      login: async () => ({ session: { ...SESSION, chainId: 11155111 } }),
      accounts: never,
      business: async () => ({ available: true, joined, name: joined ? "freshcuts.unica.eth" : null }),
      go: (href) => {
        went = href;
      },
    });
    await chip.find((n) => n.tag === "button").click();
    assert.equal(went, expected);
  }
});

test("on a network with no sign-up nobody is moved anywhere, and the chip says why", async () => {
  const chip = newChip();
  let went = null;
  const reason = "Business sign-up is not available on this network in this release.";
  await driveChip(chip, {
    load: async () => ({ chainId: 84532 }),
    reconnect: async () => null,
    login: async () => ({ session: { ...SESSION, chainId: 84532 } }),
    accounts: never,
    business: async () => ({ available: false, joined: false, reason }),
    go: (href) => {
      went = href;
    },
  });
  await chip.find((n) => n.tag === "button").click();
  assert.equal(went, null, "nobody may be navigated away from a network that cannot sign them up");
  assert.match(chip.textContent, /not available on this network/);
});

test("a wallet that refuses leaves a sentence and no session", async () => {
  const chip = newChip();
  let went = null;
  await driveChip(chip, {
    load: async () => ({ chainId: 11155111 }),
    reconnect: async () => null,
    login: async () => ({ blocked: "You declined the connection. Nothing was sent." }),
    accounts: never,
    business: never,
    go: (href) => {
      went = href;
    },
  });
  await chip.find((n) => n.tag === "button").click();
  assert.equal(went, null);
  assert.match(chip.textContent, /You declined the connection/);
});

test("the destination is a decision about the chain's answer, not about the page", () => {
  assert.equal(destinationFor({ available: true, joined: true }, "./"), "./business/");
  assert.equal(destinationFor({ available: true, joined: false }, "../../"), "../../join/");
  assert.equal(destinationFor({ available: false, joined: false }, "./"), null);
  assert.equal(shortAddress("0x00112233445566778899aabbccddeeff00112233"), "0x001122…2233");
});
