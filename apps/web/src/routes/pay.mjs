import { h, raw, hex, evidenceBadge } from "../html.mjs";
import { SITE, V3, EXPERIMENT } from "../site.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

export const PAY = [
  {
    route: "pay",
    h1: "Checkout",
    title: "Checkout — UNICA",
    description:
      "The customer's view of a payment: the amount due, the most that can be charged, what the business is guaranteed to receive, and one confirmation.",
    ogTitle: "Pay with UNICA",
    ogDescription: "The business receives its asset, or nothing moves.",
    ogImage: "og-checkout.svg",
    body: h`
<section class="card"${P("demo")} id="checkout">
  <p class="headline" id="pay-business">This business</p>
  <p class="sub" id="pay-verified-name">—</p>
  <p class="big" id="pay-amount-due">—</p>
  <p class="sub">Amount due</p>
  ${C.statusRegion("terms", "This payment is read from the network when the page runs.")}
  <div id="order-terms" class="status" role="status" aria-live="polite" hidden>
    <dl class="evidence-key">
      <dt>Business</dt><dd id="order-merchant-name">—</dd>
      <dt>Pay name</dt><dd id="order-merchant-payname">—</dd>
      <dt>Register</dt><dd id="order-terminal">—</dd>
      <dt>Asset to spend</dt><dd id="order-input">—</dd>
      <dt>Most you can be charged</dt><dd id="order-max">—</dd>
      <dt>The business is guaranteed at least</dt><dd id="order-output">—</dd>
      <dt>Conversion</dt><dd id="order-route">—</dd>
      <dt>Fees</dt><dd id="order-fees">—</dd>
      <dt>Network</dt><dd id="order-network">—</dd>
      <dt>Expires</dt><dd id="order-expiry">—</dd>
    </dl>
    <details class="fold"><summary>Details</summary>
      <dl class="evidence-key">
        <dt>Where the money goes</dt><dd id="order-merchant-address">—</dd>
        <dt>Business badge</dt><dd id="order-identity-art">—</dd>
        <dt>Order number</dt><dd id="order-id">—</dd>
      </dl>
    </details>
  </div>
</section>
<section>
  <h2>Assets you can pay with right now</h2>
  <ul id="pay-asset-list" class="assets"></ul>
  ${C.statusRegion("pay-assets-said", "Payment assets have not been read yet.")}
</section>
<section${P("wallet")}>
  <h2>Your wallet</h2>
  ${C.statusRegion("wallet", "No wallet has been connected.")}
  <p><button type="button" class="cta" id="connect" disabled aria-describedby="connect-why">Connect a wallet</button></p>
  <p class="sub" id="connect-why">Disabled until this page has read its settings.</p>
</section>
<section${P("chain-switch")}>
  <h2>Network</h2>
  <p>This payment happens on the network the sale was created on. A wallet on another network is
  asked to switch; nothing is paid from the wrong network.</p>
  ${C.statusRegion("network", "The network has not been read.")}
</section>
<section${P("blockers")}>
  <h2>When this page disables everything</h2>
  <p>Each of these disables the payment and says so in one sentence rather than failing quietly:</p>
  <ul>
    <li>The network could not be read.</li>
    <li>A saved setting disagrees with the network.</li>
    <li>This amount cannot currently be converted safely.</li>
    <li>No wallet, or a wallet on the wrong network.</li>
    <li>The amount the business would receive is below what it was promised.</li>
  </ul>
  <ul id="active-blockers" class="status" role="status" aria-live="polite" hidden></ul>
</section>
<section${P("pay")}>
  <h2>Pay</h2>
  <p><button type="button" class="cta" id="pay" disabled aria-describedby="pay-why">Pay</button></p>
  <p class="sub" id="pay-why">Disabled until this payment is loaded, a wallet is connected on the
  right network, and every check above has passed.</p>
  <p${P("expired")}>An expired payment cannot be paid. The page says so and offers a new one.</p>
  <p${P("settled")}>A paid payment cannot be paid twice. The page offers a way to start another.</p>
  ${C.statusRegion("payment-status", "Waiting for the customer.")}
  <p><button type="button" class="cta cta-quiet" id="verify-again" hidden aria-describedby="verify-again-why">Check again</button></p>
  <p class="sub" id="verify-again-why">Re-checks this payment without sending anything.</p>
  <div id="evidence-output" hidden>
    <h3>Payment verification</h3>
    <p id="evidence-decision" class="sub"></p>
    <p><a href="../receipt/" id="receipt-link">Open the receipt</a></p>
  </div>
</section>
${C.advancedVerification("adv")}
<script type="module" src="../assets/local-pay.js"></script>`,
  },
];
