/** The signed-in screens: the dashboard, the payments list and one payment's detail. One route per export so the index keeps the original order. */
import { h, raw, hex, evidenceBadge } from "../html.mjs";
import { SITE, V3, EXPERIMENT } from "../site.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

export const DASHBOARD = [
  {
    route: "business",
    h1: "My business",
    title: "My business — UNICA",
    description:
      "The business dashboard: the payout asset, which customer assets can be paid right now, the active register, and the payments verified today.",
    ogTitle: "Your business on UNICA",
    ogDescription: "Payout asset, payment assets, register, today's takings.",
    ogImage: "og-merchant.svg",
    body: h`
<section class="card"${P("merchant-drawer")} id="business-summary">
  <p class="headline" id="business-title">Fresh Cuts</p>
  <p class="big" id="business-ready">Ready to accept payments</p>
  <p class="sub" id="business-payname">—</p>
  <p class="ctas">
    <a class="cta" href="payments/new/">Create payment</a>
    <a class="cta cta-quiet" href="payments/">Receipts</a>
    <a class="cta cta-quiet" href="../join/">Add another register</a>
  </p>
</section>
<dl class="kpis">
  <div class="kpi"><dt>You receive</dt><dd id="payout-asset">—</dd></div>
  <div class="kpi"><dt>Active register</dt><dd id="active-register">—</dd></div>
  <div class="kpi"><dt>Verified payments today</dt><dd id="today-count">—</dd></div>
</dl>
${C.statusRegion("business-status", "This page reads your business from the network when it runs.")}

<h2>Payment assets your customers can use</h2>
<p>Each asset says what it can do right now. An asset is only offered when this setup can actually
complete a payment in it; otherwise it says it is temporarily unavailable, rather than failing
after a customer has pressed pay.</p>
<ul id="asset-list" class="assets"></ul>
${C.statusRegion("assets-said", "Payment assets have not been read yet.")}

<h2>What your wallet holds</h2>
<p>Every asset this app knows on this network, with the amount your payout wallet holds right now,
read from the network when this page opens. Read a different wallet instead by connecting it. An
asset this app does not know is not shown, and no amount is ever guessed.</p>
<p>
  <label for="holdings-address">Or read any wallet address</label>
  <input id="holdings-address" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="0x…" size="46">
  <button type="button" id="holdings-read">Read this wallet</button>
  <button type="button" id="holdings-connect">Read my connected wallet</button>
</p>
<ul id="holdings-list" class="assets"></ul>
${C.statusRegion("holdings-said", "Holdings have not been read yet.")}

<h2>Today</h2>
<p id="today-line">Today's verified payments are read from this business's own record.</p>
<ul id="today-list" class="registers"></ul>
<p class="sub" id="today-unresolved">A payment that has not been verified is never counted as taken.</p>

<h2>Registers</h2>
<p>A register is a place a sale can start. Revoking one stops new sales from it. Sales it already
started are unaffected.</p>
<ul id="register-list" class="registers"></ul>
${C.statusRegion("registers-said", "Registers have not been read yet.")}
<p><button type="button" class="cta cta-quiet" id="revoke-register" disabled aria-describedby="revoke-why">Revoke register</button></p>
<p class="sub" id="revoke-why">Disabled until a register has been read from the network and your
wallet is connected as the owner of this business.</p>

<section${P("ens-resolve")}>
  <h2>Your pay name</h2>
  <p>Customers pay a name, not an address. The name is resolved to your payout wallet before a sale
  exists, and the resolved wallet is shown for checking before anything is confirmed.</p>
  <p>Resolution fails closed. A name with no record resolves to nothing, never to an empty address
  that would quietly create a sale paying nobody.</p>
  ${C.statusRegion("ens-status", "The pay name has not been resolved yet.")}
</section>
${C.advancedVerification("adv")}
<script type="module" src="../assets/business.js"></script>`,
  },
];

export const PAYMENTS = [
  {
    route: "business/payments",
    h1: "Receipts",
    title: "Receipts — UNICA",
    description:
      "Every payment this business has taken, with the verification decision beside each one, read from the network rather than remembered.",
    ogTitle: "UNICA receipts",
    ogDescription: "Payments taken, and whether each was verified.",
    ogImage: "og-merchant.svg",
    body: h`
<p>Payments are read from the network when this page runs. It states the number it read, or says
the read failed. An unread count is never shown as zero.</p>
${C.statusRegion("orders", "Payments have not been read yet.")}
<ul id="payment-list" class="registers"></ul>
<p class="ctas">
  <a class="cta" href="new/">Create payment</a>
  <a class="cta cta-quiet" href="../">Back to my business</a>
</p>
<script type="module" src="../../assets/business.js"></script>`,
  },
];

export const PAYMENT_DETAILS = [
  {
    route: "business/payments/details",
    h1: "Payment details",
    title: "Payment details — UNICA",
    description:
      "One payment, addressed by its order number in the link, so the same link always reloads to the same payment.",
    ogTitle: "UNICA payment details",
    ogDescription: "One payment, reload-safe.",
    ogImage: "og-merchant.svg",
    body: h`
<p class="sub">This page takes an order number from the link, for example
<code>?order=0x…</code>. The state lives entirely in the link, so reloading or sharing it
reconstructs the same page. A static host cannot serve one file per order number, which is why it
is a query parameter rather than a path segment.</p>
${C.statusRegion("order-detail", "No payment in this link.")}
<p class="ctas">
  <a class="cta cta-quiet" href="../../../pay/">Open the customer's view</a>
  <a class="cta cta-quiet" href="../../../receipt/">Open the receipt</a>
</p>
<script type="module" src="../../../assets/business.js"></script>`,
  },
];
