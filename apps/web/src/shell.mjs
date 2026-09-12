/**
 * The document shell, navigation and footer. One definition, used by every route.
 *
 * THE NO-VALUE LABEL LIVES HERE, NOT ON EACH PAGE. Every screen this generator emits runs on a
 * test network, so the label belongs to the document rather than to whichever page remembered to
 * add it. `apps/web/build.mjs` refuses to emit a document that lacks it, and refuses to emit one
 * that calls a chain a public network unless the build was told the environment is PUBLIC_MAINNET.
 *
 * PROGRESSIVE ENHANCEMENT IS THE RULE, NOT A COURTESY. A route's identity, its disclosures, its
 * status and its primary navigation are all in the served HTML. Script may add live chain reads and
 * interactivity; if it never loads, every page still says what it is, what it does not claim, and
 * how to leave. Nothing that matters is behind an event handler.
 */
import { h, raw, esc } from "./html.mjs";
import { SITE } from "./site.mjs";
import { MAINNET_ENVIRONMENT, NO_VALUE_BANNER } from "../assets/product.js";

/**
 * The environment this artifact is being built for. It is an explicit build input, never a guess:
 * a build says PUBLIC_MAINNET or it does not get to omit the no-value label. `apps/web/build.mjs`
 * checks the emitted documents against this same value, so the two cannot disagree.
 */
const BUILD_ENVIRONMENT = process.env.UNICA_BUILD_ENVIRONMENT ?? null;
export const BUILT_FOR_MAINNET = BUILD_ENVIRONMENT === MAINNET_ENVIRONMENT;

const envBar = BUILT_FOR_MAINNET
  ? ""
  : `<p class="envbar" id="env-banner" role="note"><strong>${esc(NO_VALUE_BANNER)}</strong> —
this is a test network. Nothing here is real money.</p>`;

/** Relative prefix from a route's own depth, so nothing depends on the deployment's base path. */
export function prefixFor(routePath) {
  const depth = routePath.split("/").filter(Boolean).length;
  return depth === 0 ? "./" : "../".repeat(depth);
}

const NAV = [
  ["", "Home"],
  ["business/", "My business"],
  ["join/", "Add your business"],
  ["how-it-works/", "How it works"],
  ["supported-assets/", "Payment assets"],
  ["networks/", "Networks"],
  ["security/", "Security"],
  ["status/", "Status"],
  ["proof/", "Verification"],
];

const FOOTER = [
  ["support/", "Support"],
  ["legal/terms/", "Terms"],
  ["legal/privacy/", "Privacy"],
  ["legal/risks/", "Risks"],
];

function nav(p, current) {
  const items = NAV.map(([href, label]) => {
    const isCurrent = href === current;
    return h`<li><a href="${p}${href}"${isCurrent ? raw(' aria-current="page"') : ""}>${label}</a></li>`;
  });
  return `<nav aria-label="Primary"><ul class="nav">${items.join("")}</ul></nav>`;
}

function footer(p) {
  const items = FOOTER.map(([href, label]) => h`<li><a href="${p}${href}">${label}</a></li>`);
  return `
  <footer>
    <nav aria-label="Footer"><ul class="nav">${items.join("")}</ul></nav>
    <p class="sub">Testnet only. Nothing here is a mainnet service.
      <a href="${esc(SITE.repo)}">Source and proofs</a>.</p>
  </footer>`;
}

/**
 * @param {{route:string,title:string,description:string,ogTitle:string,ogDescription:string,
 *          ogImage:string,experimental?:boolean,h1:string,body:string,navKey?:string}} page
 */
export function document_(page) {
  const p = prefixFor(page.route);
  // Relative on purpose: an absolute canonical names a path this artifact may not be served
  // at. "./" resolves against the document's own URL, which is right everywhere.
  const canonical = "./";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(page.ogTitle)}">
<meta property="og:description" content="${esc(page.ogDescription)}">
<meta property="og:image" content="${esc(p + "assets/" + page.ogImage)}">
<meta name="twitter:card" content="summary_large_image">
${page.experimental ? '<meta name="unica:status" content="testnet experiment">' : ""}
<link rel="stylesheet" href="${esc(p)}assets/unica.css">
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
${envBar}
<header class="site">
  <a class="mark" href="${esc(p)}"><span aria-hidden="true">◇</span> ${esc(SITE.name)}</a>
  ${nav(p, page.navKey ?? page.route + (page.route ? "/" : ""))}
</header>
<main id="main" tabindex="-1">
<h1>${esc(page.h1)}</h1>
${page.body}
</main>
${footer(p)}
<script type="module" src="${esc(p)}assets/app.js"></script>
</body>
</html>
`;
}
