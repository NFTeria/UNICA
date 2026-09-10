/**
 * The document shell, navigation and footer. One definition, used by every route.
 *
 * PROGRESSIVE ENHANCEMENT IS THE RULE, NOT A COURTESY. A route's identity, its disclosures, its
 * status and its primary navigation are all in the served HTML. Script may add live chain reads and
 * interactivity; if it never loads, every page still says what it is, what it does not claim, and
 * how to leave. Nothing that matters is behind an event handler.
 */
import { h, raw, esc } from "./html.mjs";
import { SITE } from "./site.mjs";

/** Relative prefix from a route's own depth, so nothing depends on the deployment's base path. */
export function prefixFor(routePath) {
  const depth = routePath.split("/").filter(Boolean).length;
  return depth === 0 ? "./" : "../".repeat(depth);
}

const NAV = [
  ["", "Home"],
  ["how-it-works/", "How it works"],
  ["supported-assets/", "Supported assets"],
  ["networks/", "Networks"],
  ["security/", "Security"],
  ["proof/", "Proof"],
  ["status/", "Status"],
  ["merchant/", "Merchant"],
  ["experiments/robinhood/", "Experiment"],
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
