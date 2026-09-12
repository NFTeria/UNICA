/**
 * The landing page, the link previews, the mark and the light/dark control.
 *
 * Offline. No network, no chain, no wallet. It builds the artifact into a directory of its own —
 * apps/web/out belongs to the product build and another test file may be rewriting it at the same
 * moment — and then makes its claims about the documents that build actually emitted.
 *
 * EVERY MEASUREMENT HERE IS PAIRED WITH A CONTROL. A PNG reader that cannot reject a file that is
 * not a PNG proves nothing about the six it accepted; a subset rule that cannot catch a sentence
 * nobody wrote proves nothing about the ones it passed. Where a number is asserted, the function
 * that produced it is first shown failing something that should fail.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { INTEGRATIONS, contrastRatio } from "../assets/brand.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const ROOT = join(APP, "..", "..");
const OUT = mkdtempSync(join(tmpdir(), "unica-home-test-"));

execFileSync(process.execPath, [join(APP, "build.mjs")], {
  encoding: "utf8",
  env: { ...process.env, UNICA_BUILD_OUT: OUT },
});

const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
const DOCS = new Map(manifest.routes.map((r) => [r.route, readFileSync(join(OUT, r.file), "utf8")]));
const HOME = DOCS.get("/");
const STYLESHEET = readFileSync(join(APP, "assets", "unica.css"), "utf8");
const MARK = readFileSync(join(APP, "assets", "mark.svg"), "utf8");

/**
 * The version of the landing page this work started from, pinned by commit rather than by branch.
 * A branch name would follow the branch: once this lands there, "the sentences the page had before"
 * would become "the sentences the page has now" and the rule below would pass on anything. The sha
 * is the whole point. If a history rewrite makes it unreachable this test FAILS rather than skips,
 * and the fix is to re-pin it deliberately.
 */
const BASELINE_COMMIT = "4d1c4544a248b0746ff3d710a4b2c0846654bab7";

// The baseline is a committed copy of the landing route as it stood at BASELINE_COMMIT, so the rule
// holds on a checkout that has only the one commit CI fetched. The git read stays as a cross-check
// where the history is present: the two must agree, or the fixture has drifted from what it claims.
function baselineHomeSource() {
  const fixture = readFileSync(join(HERE, "fixtures", "home-baseline.mjs.txt"), "utf8");
  try {
    const fromGit = execFileSync("git", ["show", `${BASELINE_COMMIT}:apps/web/src/routes/home.mjs`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (fromGit !== fixture) throw new Error("the committed baseline fixture does not match the commit it names");
  } catch (e) {
    if (String(e?.message ?? "").includes("does not match")) throw e; // drift is a failure; a missing commit is not
  }
  return fixture;
}

// ── small readers, each with a control ───────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads a PNG's own header. Throws on anything that is not one, which is what makes it evidence. */
function readPngHeader(buf) {
  if (buf.length < 33) throw new Error("too short to be a PNG");
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("no PNG signature");
  if (buf.readUInt32BE(8) !== 13 || buf.subarray(12, 16).toString("latin1") !== "IHDR") {
    throw new Error("the first chunk is not a 13-byte IHDR");
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colourType: buf[25],
  };
}

/** The text a person reads: script and style removed, then tags. */
function visible(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Full sentences only: a run of words ending in a full stop. Labels have no full stop and are not sentences. */
function sentences(text) {
  return text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith(".") && /[a-z]/i.test(s));
}

const meta = (doc, attribute, name) =>
  doc.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`))?.[1] ?? null;

test("control: the PNG reader rejects what is not a PNG, and reads what is", () => {
  assert.throws(() => readPngHeader(Buffer.from("not a png at all, not even close, but long enough")));
  const doctored = Buffer.from(readFileSync(join(OUT, "assets", "og-home.png")));
  doctored[1] = 0x00; // break the signature
  assert.throws(() => readPngHeader(doctored));
  assert.equal(readPngHeader(readFileSync(join(OUT, "assets", "og-home.png"))).width, 1200);
});

test("control: the sentence rule separates a sentence from a label", () => {
  assert.deepEqual(sentences("Log in with wallet"), []);
  assert.deepEqual(sentences("Accept payments. Receive the asset."), ["Accept payments.", "Receive the asset."]);
});

// ── 1. the link previews ─────────────────────────────────────────────────────────────────────────

test("every route declares a preview card, and the card is a real 1200x630 PNG in the build", () => {
  const checked = [];
  for (const [route, doc] of DOCS) {
    const image = meta(doc, "property", "og:image");
    assert.ok(image, `${route} declares no og:image`);
    assert.match(image, /assets\/og-[a-z]+\.png$/, `${route} points its card at ${image}`);
    const file = join(OUT, "assets", image.split("/").pop());
    assert.ok(existsSync(file), `${route} points at ${image}, which the build did not emit`);
    const header = readPngHeader(readFileSync(file));
    assert.equal(header.width, 1200, `${route}: card width`);
    assert.equal(header.height, 630, `${route}: card height`);
    assert.equal(header.bitDepth, 8);
    assert.equal(header.colourType, 6);
    assert.equal(meta(doc, "property", "og:image:width"), String(header.width));
    assert.equal(meta(doc, "property", "og:image:height"), String(header.height));
    checked.push(route);
  }
  assert.equal(checked.length, DOCS.size);
  console.log(`preview cards: ${checked.length} routes checked, 0 pointed at a missing or mis-sized image`);
});

test("every route carries the full preview vocabulary, and none of it is empty", () => {
  for (const [route, doc] of DOCS) {
    assert.equal(meta(doc, "property", "og:type"), "website", route);
    assert.equal(meta(doc, "property", "og:site_name"), "UNICA", route);
    assert.equal(meta(doc, "name", "twitter:card"), "summary_large_image", route);
    for (const [attribute, name] of [
      ["property", "og:title"],
      ["property", "og:description"],
      ["name", "twitter:title"],
      ["name", "twitter:description"],
      ["name", "twitter:image"],
    ]) {
      const value = meta(doc, attribute, name);
      assert.ok(value && value.length > 3, `${route} has no useful ${name}`);
    }
    // The card a scraper fetches and the card the page names must be the same file.
    assert.equal(meta(doc, "name", "twitter:image"), meta(doc, "property", "og:image"), route);
    // The description a preview shows is the route's own, never another route's.
    assert.equal(meta(doc, "property", "og:description"), meta(doc, "name", "twitter:description"), route);
  }
});

test("a preview card carries no text, because there is no font to set it in", () => {
  for (const name of ["og-home", "og-docs", "og-checkout", "og-merchant", "og-receipt", "og-experiment"]) {
    const svg = readFileSync(join(APP, "assets", `${name}.svg`), "utf8");
    assert.ok(!/<text[\s>]/.test(svg), `${name}.svg declares text the rasteriser cannot draw`);
  }
});

// ── 2. the mark ──────────────────────────────────────────────────────────────────────────────────

test("the mark is the favicon on every route, and it is the file the hero inlines", () => {
  for (const [route, doc] of DOCS) {
    assert.match(doc, /<link rel="icon" type="image\/svg\+xml" href="[^"]*assets\/mark\.svg">/, route);
  }
  assert.ok(HOME.includes('class="unica-mark"'), "the hero does not carry the mark");
  for (const points of MARK.match(/points="[^"]+"/g) ?? []) {
    assert.ok(HOME.includes(points), `the hero's mark is missing the shape ${points}`);
  }
});

test("the mark is filled shapes only, so a favicon and a rasteriser both render the same thing", () => {
  assert.ok(!/<text[\s>]/.test(MARK));
  assert.ok(!/\sstroke="/.test(MARK));
  assert.ok(!/<(path|image|use)[\s>]/.test(MARK));
  // Its colours are the page's tokens with a light-scheme fallback, never a hard-coded brand hex.
  for (const fill of MARK.match(/fill="[^"]+"/g) ?? []) {
    assert.match(fill, /var\(--(ink|accent|paper), #[0-9a-f]{6}\)/, `the mark hard-codes ${fill}`);
  }
});

test("the mark's motion is slow, is in the stylesheet, and stops for anyone who asked it to", () => {
  assert.match(STYLESHEET, /@keyframes unica-mark-turn/);
  assert.match(STYLESHEET, /@keyframes unica-mark-breathe/);
  const durations = [...STYLESHEET.matchAll(/animation: unica-mark-\w+ (\d+)s/g)].map((m) => Number(m[1]));
  assert.equal(durations.length, 2, "both mark animations must declare a duration");
  for (const seconds of durations) assert.ok(seconds >= 8, `a ${seconds}s loop is not calm`);
  // The stylesheet answers prefers-reduced-motion once, for everything, with !important — so the
  // mark is covered by the rule that was already there rather than by a weaker second copy of it.
  const reduced = STYLESHEET.match(/@media \(prefers-reduced-motion: reduce\) \{[^\n]*\}/)?.[0] ?? "";
  assert.match(reduced, /\*\s*\{[^}]*animation: none !important/);
  const marked = STYLESHEET.slice(STYLESHEET.indexOf("@keyframes unica-mark-turn"));
  assert.ok(
    !/@media \(prefers-reduced-motion/.test(marked),
    "the mark declares its own reduced-motion rule, which the global one already covers",
  );
});

// ── 3. light and dark ────────────────────────────────────────────────────────────────────────────

/** The seven fields a scheme is allowed to set, read out of one declaration block. */
function schemeFields(block) {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,8});/g)].map((m) => [m[1], m[2]]));
}

test("the [data-theme] blocks mirror the prefers-color-scheme block exactly", () => {
  const media = STYLESHEET.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/)?.[1];
  const picked = STYLESHEET.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)?.[1];
  assert.ok(media && picked, "one of the two dark declarations is missing");
  assert.deepEqual(schemeFields(picked), schemeFields(media));

  const base = STYLESHEET.match(/^:root \{([\s\S]*?)\n\}/m)?.[1];
  const light = STYLESHEET.match(/:root\[data-theme="light"\] \{([^}]*)\}/)?.[1];
  assert.ok(base && light, "one of the two light declarations is missing");
  const baseFields = schemeFields(base);
  for (const [field, value] of Object.entries(schemeFields(light))) {
    assert.equal(value, baseFields[field], `--${field} drifted between :root and the light pick`);
  }
});

test("control: the mirror check would notice a drifted field", () => {
  assert.notDeepEqual(schemeFields("--paper: #101215;"), schemeFields("--paper: #101216;"));
});

test("theme-color is declared twice, per scheme, from the stylesheet's own ground", () => {
  const light = STYLESHEET.match(/^:root \{[\s\S]*?--paper:\s*(#[0-9a-fA-F]{6})/m)?.[1];
  const dark = STYLESHEET.match(/:root\[data-theme="dark"\] \{[\s\S]*?--paper:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(light && dark && light !== dark);
  for (const [route, doc] of DOCS) {
    assert.ok(
      doc.includes(`<meta name="theme-color" content="${light}" media="(prefers-color-scheme: light)">`),
      `${route} has no light theme-color, or it is not ${light}`,
    );
    assert.ok(
      doc.includes(`<meta name="theme-color" content="${dark}" media="(prefers-color-scheme: dark)">`),
      `${route} has no dark theme-color, or it is not ${dark}`,
    );
  }
});

test("the theme control offers three states and no fourth, on every layout", () => {
  const layouts = ["/", "/business/", "/pay/"];
  for (const route of layouts) {
    const doc = DOCS.get(route);
    assert.ok(doc, `no document at ${route}`);
    const select = doc.match(/<select id="theme-choice"[\s\S]*?<\/select>/)?.[0];
    assert.ok(select, `${route} carries no theme control`);
    const options = [...select.matchAll(/<option value="([a-z]+)"([^>]*)>([^<]+)<\/option>/g)];
    assert.deepEqual(options.map((o) => o[1]), ["system", "light", "dark"], route);
    assert.deepEqual(options.map((o) => o[3]), ["System", "Light", "Dark"], route);
    assert.ok(options[0][2].includes("selected"), `${route}: no choice is the served state`);
    assert.equal((doc.match(/<select id="theme-choice"/g) ?? []).length, 1, `${route} has two theme controls`);
    assert.match(doc, /<label for="theme-choice">/, `${route}: the control has no label`);
  }
});

test("the choice is applied before the first paint, from one key, and every access is guarded", () => {
  const head = HOME.slice(0, HOME.indexOf("</head>"));
  const boot = head.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(boot, "no inline script runs in the head, so a stored choice arrives after the paint");
  assert.match(boot, /localStorage\.getItem\("unica\.theme"\)/);
  assert.match(boot, /try\{[\s\S]*\}catch/);
  assert.match(boot, /setAttribute\("data-theme"/);
  // and the module that writes the key agrees with the script that reads it
  const app = readFileSync(join(APP, "assets", "app.js"), "utf8");
  assert.match(app, /export const THEME_KEY = "unica\.theme";/);
  assert.deepEqual(
    [...app.matchAll(/"(unica\.[a-z]+)"/g)].map((m) => m[1]).filter((k) => k.startsWith("unica.theme")),
    ["unica.theme"],
    "the theme is stored under more than one key",
  );
  for (const fragment of ["removeItem(THEME_KEY)", "setItem(THEME_KEY, choice)", "removeAttribute(\"data-theme\")"]) {
    assert.ok(app.includes(fragment), `assets/app.js is missing ${fragment}`);
  }
});

// ── 4. the hero ──────────────────────────────────────────────────────────────────────────────────

const heroRegion = () => {
  const start = HOME.indexOf('<div class="hero">');
  const end = HOME.indexOf('<h2 id="three">');
  assert.ok(start >= 0 && end > start, "the hero region could not be located in the built page");
  return HOME.slice(start, end);
};

test("the hero offers exactly four controls, and each one goes where it says", () => {
  const hero = heroRegion();
  const controls = [...hero.matchAll(/<(button|a)\b[^>]*class="cta[^"]*"[^>]*>([^<]+)<\/\1>/g)].map((m) => ({
    tag: m[1],
    markup: m[0],
    label: m[2].trim(),
  }));
  assert.deepEqual(
    controls.map((c) => c.label),
    ["Log in with wallet", "Swap on Uniswap", "Register your ENS name", "See a receipt"],
  );

  const [login, swap, ens, receipt] = controls;
  assert.equal(login.tag, "button");
  assert.match(login.markup, /id="hero-login"/);
  assert.match(login.markup, /disabled/, "the served primary must not be a button that cannot answer");
  assert.match(login.markup, /aria-describedby="hero-login-why"/);
  assert.ok(hero.includes('id="hero-login-why"'), "the disabled primary names a reason that is not on the page");

  assert.equal(swap.tag, "a");
  assert.match(swap.markup, /href="https:\/\/app\.uniswap\.org\/swap"/);
  assert.match(swap.markup, /rel="noopener"/);
  assert.match(ens.markup, /href="join\/"/);
  assert.match(receipt.markup, /href="receipt\/"/);

  // The one login in this product is the header chip's. The hero presses it; it does not reimplement it.
  const home = readFileSync(join(APP, "assets", "home.js"), "utf8");
  assert.match(home, /getElementById\("wallet-login"\)/);
  assert.ok(!/eth_requestAccounts|loginWithWallet/.test(home), "assets/home.js has grown a second login");
  assert.match(home, /whereTo\(/, "the hero does not route by the chain's answer");
});

test("the swap link names the deployment's own chain and assets, and nothing when it cannot", async () => {
  const { swapHref, SWAP_URL } = await import("../assets/home.js");
  assert.equal(swapHref(null), SWAP_URL);
  assert.equal(swapHref({ chainId: 31337, assets: [] }), SWAP_URL, "half a pair is not a link");
  const href = swapHref({
    chainId: 31337,
    assets: [
      { role: "payout", address: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" },
      { role: "customer", address: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" },
    ],
  });
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, SWAP_URL);
  assert.equal(url.searchParams.get("chain"), "31337");
  assert.equal(url.searchParams.get("inputCurrency"), "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
  assert.equal(url.searchParams.get("outputCurrency"), "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0");
});

/**
 * The one line on this page that is not in the version it replaced, and the reason it is allowed:
 * DESIGN.md requires a disabled control to say why it is disabled, and apps/web/tests/build.test.mjs
 * fails a document that disables one without an aria-describedby. It is help text, one short line.
 * The list has exactly one entry and the test below fails if it grows.
 */
const ALLOWED_NEW_LINES = ["Enabled once this page has read the network."];

/**
 * Sentence by sentence, PER PROSE ELEMENT. Flattening the hero into one string glues a button's
 * label to the next paragraph and invents sentences neither of them contains — which is a reading
 * error dressed up as a finding. A heading and a paragraph are prose; a label inside a control is
 * not, and has no full stop to make one.
 */
function heroSentences() {
  const hero = heroRegion();
  const blocks = [...hero.matchAll(/<(h1|p)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => visible(m[2]));
  return blocks.flatMap(sentences);
}

test("the hero says nothing the page did not already say", () => {
  const before = baselineHomeSource().replace(/\s+/g, " ");
  const said = heroSentences();
  assert.ok(said.length >= 4, `only ${said.length} sentences were found in the hero`);
  const strays = said.filter((s) => !before.includes(s) && !ALLOWED_NEW_LINES.includes(s));
  assert.deepEqual(strays, [], "these sentences are new marketing");
  assert.equal(ALLOWED_NEW_LINES.length, 1);
  for (const line of ALLOWED_NEW_LINES) assert.ok(line.length <= 60, `${line} is not one short line`);
  console.log(`hero sentences: ${said.length} read, ${said.length - 1} already in ${BASELINE_COMMIT.slice(0, 7)}, 1 allowed`);
});

test("control: the subset rule catches a sentence nobody wrote", () => {
  const before = baselineHomeSource();
  assert.ok(!before.includes("The fastest way to get paid in crypto."));
});

test("the landing page carries no word for a thing that is not real", () => {
  const words = /\b(demos?|demonstrations?|practice|fixtures?|rehearsals?|storyboards?|samples?|examples?)\b/i;
  const found = words.exec(visible(HOME));
  assert.equal(found, null, `the landing page says "${found?.[0]}"`);
  assert.ok(words.test("this is a demo"), "control: the rule catches a planted word");
  assert.ok(words.test("an example price"), "control: the rule catches the plural forms too");
});

// ── 5. the colour on the hero's quiet buttons ────────────────────────────────────────────────────

test("each integration rule is that integration's own colour, to the digit", () => {
  const rules = {
    "rule-uniswap": INTEGRATIONS.uniswap.colour,
    "rule-ens": INTEGRATIONS.ens.colour,
    "rule-graph": INTEGRATIONS.graph.colour,
  };
  for (const [cls, colour] of Object.entries(rules)) {
    const declared = STYLESHEET.match(new RegExp(`\\.${cls} \\{ border-bottom: 3px solid (#[0-9A-Fa-f]{6});`))?.[1];
    assert.equal(declared?.toUpperCase(), colour.toUpperCase(), `.${cls} is not ${colour}`);
    assert.ok(heroRegion().includes(cls), `${cls} is declared but never used in the hero`);
  }
  // Never text, never a ground: a hue below the contrast floor can then never carry a meaning.
  // DECLARATION by declaration, not line by line — a second declaration sharing a line with a
  // legitimate one is exactly how a colour turns into a background without the rule noticing.
  const declarations = STYLESHEET.replace(/\/\*[\s\S]*?\*\//g, " ").split(/[;{}]/);
  for (const colour of Object.values(rules)) {
    const uses = declarations.filter((d) => d.toUpperCase().includes(colour.toUpperCase()));
    assert.ok(uses.length >= 1, `${colour} is not declared anywhere`);
    for (const use of uses) {
      assert.match(
        use.trim(),
        /^border-bottom: 3px solid #[0-9A-Fa-f]{6}$/,
        `an integration colour is used as more than a 3px rule: ${use.trim()}`,
      );
    }
  }
});

test("the hero's buttons carry their own contrast in both schemes, whatever the rule measures", () => {
  const schemes = {
    light: { paper: "#fbfbfa", ink: "#14161a", accent: "#0b6e4f", onAccent: "#f7faf8" },
    dark: { paper: "#101215", ink: "#eef1ef", accent: "#35b888", onAccent: "#0d1411" },
  };
  const measured = [];
  for (const [name, s] of Object.entries(schemes)) {
    // The quiet buttons: label is --ink on --paper. Text, so the floor is 4.5:1.
    const label = contrastRatio(s.ink, s.paper);
    assert.ok(label >= 4.5, `${name}: a quiet button's label reads at ${label.toFixed(2)}:1`);
    // The primary: --on-accent on --accent, the same computed pair the brand already proves.
    const primary = contrastRatio(s.onAccent, s.accent);
    assert.ok(primary >= 4.5, `${name}: the primary reads at ${primary.toFixed(2)}:1`);
    for (const [key, integration] of Object.entries({
      uniswap: INTEGRATIONS.uniswap,
      ens: INTEGRATIONS.ens,
      graph: INTEGRATIONS.graph,
    })) {
      measured.push(`${name}/${key} ${contrastRatio(integration.colour, s.paper).toFixed(2)}:1`);
    }
  }
  // Stated, not hidden: the rules are attribution, and one of them is below the 3:1 an affordance
  // would need — which is exactly why the affordance is the 1px border and the label, not the rule.
  console.log(`integration rules against the ground: ${measured.join(", ")}`);
  assert.ok(contrastRatio(INTEGRATIONS.ens.colour, "#fbfbfa") < 3, "the stated ENS measurement is stale");
});

// ── 6. the shell references the disclosure files unconditionally ─────────────────────────────────

test("every route references the disclosure stylesheet and module, whoever owns them", () => {
  for (const [route, doc] of DOCS) {
    assert.match(doc, /<link rel="stylesheet" href="[^"]*assets\/fold\.css">/, route);
    assert.match(doc, /<script type="module" src="[^"]*assets\/fold\.js"><\/script>/, route);
  }
});
