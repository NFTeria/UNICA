/**
 * The customer's screen. One card: who is being paid, what for, how much, one button.
 *
 * THE SAME CARD SERVES ALL THREE LINKS. `?order=` is a payment a register created, `?product=` is
 * one thing out of a business's catalogue, and `?business=` is the whole shop. They differ in what
 * fills the card, never in what the card looks like, so a customer who has paid once recognises
 * the second one immediately.
 *
 * WHAT IS IN THE SERVED HTML. The frame, the labels, the em dashes and the disabled button with
 * its reason. Every figure arrives from the chain through `assets/local-pay.js`; nothing here is a
 * placeholder amount, because a plausible number on a checkout is indistinguishable from a real
 * one until somebody pays it.
 */
import { h, raw } from "../html.mjs";
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
<link rel="stylesheet" href="../assets/screens/checkout.css">
<div class="co">
  <div class="co-id">
    <span class="co-badge" id="co-badge"></span>
    <div class="co-id-text">
      <p class="co-name" id="co-business">This business</p>
      <p class="co-payname"><span id="co-payname">—</span><span class="int" data-int="ens" id="co-ens" hidden>ENS</span></p>
    </div>
  </div>
  <section class="co-card"${P("demo")} id="checkout">
    <div class="co-lines" id="co-lines">
      <div class="co-line"><span class="co-line-what" id="co-line-what">—</span><span class="co-line-much" id="co-line-much">—</span></div>
    </div>
    <ul class="shop" id="co-shop" hidden></ul>
    <p class="co-total"><span>Total</span><span id="co-total">—</span></p>
    <ul class="co-flow">
      <li><span class="co-k">You pay</span><span class="co-v" id="co-pay-asset">—</span></li>
      <li><span class="co-k">They receive</span><span class="co-v" id="co-receive-asset">—</span><span class="int" data-int="uniswap" id="co-uniswap" hidden>Uniswap</span></li>
    </ul>
    <p class="co-note"><span id="co-price-note">—</span><span class="int" data-int="chainlink" id="co-chainlink" hidden>Chainlink</span></p>
    <p class="co-actions"${P("pay")}>
      <button type="button" class="cta charge" id="co-pay" disabled aria-describedby="co-why">Pay</button>
    </p>
    <p class="sub" id="co-why">Disabled until this payment has been read.</p>
    <p class="co-status status" id="co-status" role="status" aria-live="polite">Waiting for the customer.</p>
    <p class="status" id="co-expired"${P("expired")} role="status" aria-live="polite" hidden></p>
    <p class="status" id="co-settled"${P("settled")} role="status" aria-live="polite" hidden></p>
    <p class="co-after" id="co-after" hidden><a href="../receipt/" id="co-receipt-link">View the receipt</a>
      <button type="button" class="cta cta-quiet" id="co-recheck">Check again</button></p>
  </section>
  <p class="status" id="wallet"${P("wallet")} role="status" aria-live="polite">No wallet is connected.</p>
  <p class="status" id="network"${P("chain-switch")} role="status" aria-live="polite">The network has not been read.</p>
  <details class="fold"${P("blockers")}>
    <summary>What disables everything</summary>
    <ul class="status" id="active-blockers" role="status" aria-live="polite"></ul>
    <p class="sub" id="blockers-none">Each refusal names itself here before the button is pressed.</p>
  </details>
  <details class="fold" id="order-terms">
    <summary>Payment details</summary>
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
      <dt>Where the money goes</dt><dd id="order-merchant-address">—</dd>
      <dt>Order number</dt><dd id="order-id">—</dd>
    </dl>
  </details>
  ${C.advancedVerification("adv")}
</div>
<script type="module" src="../assets/local-pay.js"></script>`,
  },
];
