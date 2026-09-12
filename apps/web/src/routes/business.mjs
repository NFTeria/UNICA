/**
 * The signed-in business: the overview, the orders list, and one order.
 *
 * WHAT THE SERVED HTML IS FOR. Every figure on these screens is read from the chain when the page
 * runs, so what ships in the document is the SHAPE of the answer and never the answer: a label, an
 * em dash, and a live region that says nothing has been read yet. A page with no script is then a
 * true description of what this screen shows, and a page with script fills it in. Nothing here
 * carries a sample price, an example customer or a zero standing in for a number nobody has read.
 *
 * THE GATE IS HIDDEN AT REST, AND THAT IS DELIBERATE. `assets/business.js` reveals it and hides the
 * body when no wallet is recognised. Shipping it the other way round would mean a reader with no
 * script sees a sign-in prompt and none of the page, when the truth is that the page exists and
 * simply has not read anything.
 *
 * The table below is written out rather than taken from `dataTable()` because script fills its
 * body row by row and needs the element to address. Its structure is the design system's, cell for
 * cell; apps/web/DESIGN.md is the copy that governs.
 */
import { h, raw } from "../html.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

/** The one line a person reads when nobody is signed in, and the block that carries it. */
const gate = raw(`<div class="empty adm-gate" id="admin-gate" hidden>
  <p class="empty-t">Sign in to see your business</p>
  <p class="sub" id="gate-line">Use the wallet control at the top of this page.</p>
</div>`);

export const DASHBOARD = [
  {
    route: "business",
    h1: "My business",
    title: "My business — UNICA",
    description:
      "The overview: what you are paid in, what you took today, what your payout wallet holds, your registers and your settings.",
    ogTitle: "Your business on UNICA",
    ogDescription: "Payout asset, today's takings, holdings, registers.",
    ogImage: "og-merchant.svg",
    body: h`<link rel="stylesheet" href="../assets/screens/admin.css">
${gate}
<div id="admin-body">
<section class="card adm-owned"${P("merchant-drawer")} id="business-summary">
  <p class="headline" id="business-title">Your business</p>
  <p class="sub"><span id="business-payname">—</span> <span class="adm-marks" id="payname-mark"></span></p>
  <p class="ctas">
    <a class="cta" href="payments/new/">New sale</a>
    <a class="cta cta-quiet" href="products/">Add product</a>
  </p>
</section>
<dl class="kpis">
  <div class="kpi"><dt>You receive</dt><dd id="payout-asset">—</dd></div>
  <div class="kpi"><dt>Checked today</dt><dd id="today-count">—</dd></div>
  <div class="kpi"><dt>Taken today</dt><dd id="today-total">—</dd></div>
  <div class="kpi"><dt>Last payment</dt><dd id="last-payment">—</dd></div>
</dl>
${C.statusRegion("business-status", "Today's figures have not been read yet.")}

<h2>Your shop</h2>
<p class="sub">One page for everything you sell, at your own name.</p>
<div class="adm-share" id="shop-share">
  <div class="qr" id="shop-qr"></div>
  <div>
    <code class="adm-link" id="shop-link">—</code>
    <p class="ctas">
      <button type="button" class="cta cta-quiet" data-copy="true">Copy link</button>
      <button type="button" class="cta cta-quiet" data-share="true">Share</button>
    </p>
    <p class="sub" id="shop-said">Your shop link has not been read yet.</p>
  </div>
</div>

<h2>What your wallet holds</h2>
<p class="sub">Every asset this app knows on this network, for your payout wallet.</p>
<ul id="holdings-list" class="assets"></ul>
${C.statusRegion("holdings-said", "Holdings have not been read yet.")}

<h2 id="registers">Registers</h2>
<p class="sub">A register is a place a sale can start. Switching one off stops new sales from it.</p>
<dl class="kpis">
  <div class="kpi"><dt>Active register</dt><dd id="active-register">—</dd></div>
</dl>
<ul id="register-list" class="registers"></ul>
${C.statusRegion("registers-said", "Registers have not been read yet.")}
${C.button("Switch a register off", { variant: "danger", id: "revoke-register", disabled: true, reason: "Disabled until a register has been read and your wallet is connected as the owner." })}

<h2 id="settings">Settings</h2>
<dl class="adm-facts">
  <div${P("ens-resolve")}><dt>Pay name</dt><dd id="set-payname">—</dd></div>
  <div><dt>Payout wallet</dt><dd id="set-payout">—</dd></div>
  <div><dt>Your colour</dt><dd><span class="adm-swatch" id="set-accent">Not read yet</span></dd></div>
</dl>
${C.field({ id: "holdings-address", label: "Look up a wallet", placeholder: "0x…", help: "Reads what that wallet holds. Nothing is sent." })}
<p class="ctas">
  <button type="button" class="cta cta-quiet" id="holdings-read">Read this wallet</button>
  <button type="button" class="cta cta-quiet" id="holdings-connect">Read my wallet</button>
  <button type="button" class="cta cta-quiet" id="admin-logout">Log out</button>
</p>
${C.advancedVerification("adv")}
</div>
<script type="module" src="../assets/business.js"></script>`,
  },
];

export const PAYMENTS = [
  {
    route: "business/payments",
    h1: "Orders",
    title: "Orders — UNICA",
    description:
      "Every payment this business has taken, with what it was for, who paid it, and the verification decision beside each one.",
    ogTitle: "UNICA orders",
    ogDescription: "Payments taken, and whether each one was checked.",
    ogImage: "og-merchant.svg",
    body: h`<link rel="stylesheet" href="../../assets/screens/admin.css">
${gate}
<div id="admin-body">
<p class="ctas">
  <a class="cta" href="new/">New sale</a>
  <a class="cta cta-quiet" href="../">Overview</a>
</p>
<p class="adm-marks" id="orders-mark"></p>
<div class="table-wrap">
  <table class="dtable">
    <caption>Payments to your payout wallet</caption>
    <thead><tr>
      <th scope="col">When</th>
      <th scope="col">What</th>
      <th scope="col">Amount</th>
      <th scope="col">From</th>
      <th scope="col">State</th>
      <th scope="col">Receipt</th>
    </tr></thead>
    <tbody id="payment-list"><tr><td class="sub" colspan="6">Nothing has been read yet.</td></tr></tbody>
  </table>
</div>
${C.statusRegion("orders", "Payments have not been read yet.")}
</div>
<script type="module" src="../../assets/business.js"></script>`,
  },
];

export const PAYMENT_DETAILS = [
  {
    route: "business/payments/details",
    h1: "Payment details",
    title: "Payment details — UNICA",
    description:
      "One payment of yours, addressed by its number in the link, so the same link always reloads to the same payment.",
    ogTitle: "UNICA payment details",
    ogDescription: "One payment, reload-safe.",
    ogImage: "og-merchant.svg",
    body: h`<link rel="stylesheet" href="../../../assets/screens/admin.css">
${gate}
<div id="admin-body">
${C.statusRegion("order-detail", "No payment in this link.")}
<p class="ctas">
  <a class="cta cta-quiet" id="order-receipt" href="../../../receipt/" hidden>Open the receipt</a>
  <a class="cta cta-quiet" href="../">Back to orders</a>
</p>
${C.advancedVerification("adv")}
</div>
<script type="module" src="../../../assets/business.js"></script>`,
  },
];
