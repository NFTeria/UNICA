/**
 * The document shell, navigation and footer. One definition, used by every route.
 *
 * THREE LAYOUTS, CHOSEN BY ROUTE PATH, AND NOTHING ELSE DECIDES. A page does not get to ask for a
 * layout, because then two pages of the same kind drift apart. `layoutFor()` is a pure function of
 * the path:
 *
 *   marketing  the home page, the explanatory pages and the legal pages. Top navigation, a footer,
 *              a roomy measure, and a hero band the home page fills.
 *   app        business/* and join/. A left sidebar, a top bar carrying the business name and the
 *              wallet chip, and a content column that opens with the page title and its actions.
 *   checkout   pay/ and receipt/. One centred card, the least chrome that is still navigable, and
 *              the business identity above the card rather than inside it.
 *
 * THE NO-VALUE LABEL LIVES HERE, NOT ON EACH PAGE, AND IT IS ON ALL THREE. Every screen this
 * generator emits runs on a test network, so the label belongs to the document rather than to
 * whichever page remembered to add it. `apps/web/build.mjs` refuses to emit a document that lacks
 * it, and refuses to emit one that calls a chain a public network unless the build was told the
 * environment is PUBLIC_MAINNET.
 *
 * PROGRESSIVE ENHANCEMENT IS THE RULE, NOT A COURTESY. A route's identity, its disclosures, its
 * status and its primary navigation are all in the served HTML. Script may add live chain reads and
 * interactivity; if it never loads, every page still says what it is, what it does not claim, and
 * how to leave. Nothing that matters is behind an event handler — which is why the wallet chip's
 * served text is a true sentence about how signing in works, and not a button that does nothing.
 */
import { h, raw, esc } from "./html.mjs";
import { SITE } from "./site.mjs";
import { sidebarNav, walletChip } from "./components.mjs";
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
  : `<p class="envbar" id="env-banner" role="note"><strong>${esc(NO_VALUE_BANNER)}</strong></p>`;

/** Relative prefix from a route's own depth, so nothing depends on the deployment's base path. */
export function prefixFor(routePath) {
  const depth = routePath.split("/").filter(Boolean).length;
  return depth === 0 ? "./" : "../".repeat(depth);
}

/** Which of the three layouts a path gets. Pure, so a test can ask it the same question a build does. */
export function layoutFor(routePath) {
  const r = String(routePath ?? "").replace(/^\/+|\/+$/g, "");
  if (r === "pay" || r === "receipt" || r.startsWith("pay/") || r.startsWith("receipt/")) return "checkout";
  if (r === "business" || r === "join" || r.startsWith("business/") || r.startsWith("join/")) return "app";
  return "marketing";
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

/**
 * The signed-in menu. Every destination is a route this build actually emits — the build fails on a
 * link that resolves to no file, and apps/web/tests/design.test.mjs asks the same question of this
 * list directly, so a sixth item pointing at a screen somebody means to write cannot ship.
 */
const SIDENAV = [
  ["business/", "Overview"],
  ["business/products/", "Products"],
  ["business/payments/", "Orders"],
  ["business/customers/", "Customers"],
  ["business/#registers", "Registers"],
  ["join/", "Settings"],
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

/**
 * The wallet chip and the signed-in menu are defined once, in src/components.mjs, and only PLACED
 * here. `data-prefix` is how apps/web/assets/app.js knows where "business" and "join" are from this
 * depth, since every link in this artifact is relative to the document that carries it.
 */
const chip = (p) => walletChip(p).__raw;
const sidebar = (p, current) => sidebarNav(p, current, SIDENAV).__raw;

function footer(p) {
  const items = FOOTER.map(([href, label]) => h`<li><a href="${p}${href}">${label}</a></li>`);
  return `
  <footer>
    <nav aria-label="Footer"><ul class="nav">${items.join("")}</ul></nav>
    <p class="sub">Testnet only. Nothing here is a mainnet service.
      <a href="${esc(SITE.repo)}">Source and proofs</a>.</p>
  </footer>`;
}

function marketingBody(page, p, navKey) {
  return `<header class="site">
  <a class="mark" href="${esc(p)}"><span aria-hidden="true">◇</span> ${esc(SITE.name)}</a>
  ${nav(p, navKey)}
  ${chip(p)}
</header>
<main id="main" tabindex="-1">
<div class="hero"><h1>${esc(page.h1)}</h1></div>
${page.body}
</main>
${footer(p)}`;
}

function appBody(page, p) {
  const here = page.route + "/";
  return `<header class="topbar">
  <a class="mark" href="${esc(p)}"><span aria-hidden="true">◇</span> ${esc(SITE.name)}</a>
  <span class="topbar-business" id="topbar-business">Not signed in yet</span>
  ${chip(p)}
</header>
<div class="appframe">
${sidebar(p, here)}
<main id="main" tabindex="-1">
<div class="pagehead">
  <h1>${esc(page.h1)}</h1>
  <div class="actions" id="page-actions"></div>
</div>
${page.body}
</main>
</div>
${footer(p)}`;
}

function checkoutBody(page, p) {
  return `<header class="site checkout-top">
  <a class="mark" href="${esc(p)}"><span aria-hidden="true">◇</span> ${esc(SITE.name)}</a>
  <nav aria-label="Primary"><ul class="nav">
    <li><a href="${esc(p)}">Home</a></li>
    <li><a href="${esc(p)}support/">Support</a></li>
  </ul></nav>
  ${chip(p)}
</header>
<main id="main" tabindex="-1">
<p class="bizid" id="checkout-identity">The business you are paying is named on the payment below.</p>
<h1>${esc(page.h1)}</h1>
${page.body}
</main>
${footer(p)}`;
}

/**
 * @param {{route:string,title:string,description:string,ogTitle:string,ogDescription:string,
 *          ogImage:string,experimental?:boolean,h1:string,body:string,navKey?:string}} page
 */
export function document_(page) {
  const p = prefixFor(page.route);
  const layout = layoutFor(page.route);
  const navKey = page.navKey ?? page.route + (page.route ? "/" : "");
  // Relative on purpose: an absolute canonical names a path this artifact may not be served
  // at. "./" resolves against the document's own URL, which is right everywhere.
  const canonical = "./";
  const shell =
    layout === "app" ? appBody(page, p) : layout === "checkout" ? checkoutBody(page, p) : marketingBody(page, p, navKey);
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
<body class="lay lay-${layout}" data-layout="${layout}">
<a class="skip" href="#main">Skip to main content</a>
${envBar}
${shell}
<script type="module" src="${esc(p)}assets/app.js"></script>
</body>
</html>
`;
}
