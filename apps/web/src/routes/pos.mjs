import { h, raw } from "../html.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

/**
 * The register. A number you can read across a counter, a keypad under it, the shop's own list and
 * the assets a customer may pay with beside it, and one button. Everything a person reads here is
 * a label, a figure or a one-line state; there is nothing to study while somebody is waiting.
 *
 * The served document is already true with no script: the amount is zero, the lists say they have
 * not been read, and the one button says why it is disabled. Script fills the figures in.
 */
export const POS = [
  {
    route: "business/payments/new",
    h1: "Create payment",
    title: "Create payment — UNICA",
    description:
      "The register: tap an amount or an item, choose what the customer pays with, and hand them a link or a square to scan.",
    ogTitle: "Create a UNICA payment",
    ogDescription: "Tap an amount. Hand over a link. Wait for the check.",
    ogImage: "og-merchant.svg",
    body: h`
<link rel="stylesheet" href="../../../assets/screens/pos.css">
<div class="pos"${P("create-order")} id="register">
  <section class="pos-pad" aria-label="Amount">
    <output class="amount-display" id="amount-display" aria-live="polite">0.00</output>
    <p class="sub pos-line" id="amount-line">—</p>
    <div class="keypad" id="keypad">
      <button type="button" class="key" data-key="1">1</button>
      <button type="button" class="key" data-key="2">2</button>
      <button type="button" class="key" data-key="3">3</button>
      <button type="button" class="key" data-key="4">4</button>
      <button type="button" class="key" data-key="5">5</button>
      <button type="button" class="key" data-key="6">6</button>
      <button type="button" class="key" data-key="7">7</button>
      <button type="button" class="key" data-key="8">8</button>
      <button type="button" class="key" data-key="9">9</button>
      <button type="button" class="key" data-key="00">00</button>
      <button type="button" class="key" data-key="0">0</button>
      <button type="button" class="key" data-key="backspace" aria-label="Delete the last digit">⌫</button>
    </div>
  </section>

  <section class="pos-sale">
    <h2>This sale</h2>
    <p class="pos-line"><span id="sale-name">No item chosen</span>
      <span class="pos-mark" id="sale-mark" hidden></span></p>

    <ul class="pos-picks" id="quick-picks">
      <li class="sub">Your list has not been read yet.</li>
    </ul>

    <h3>Customer pays with</h3>
    <ul class="pos-assets" id="pay-assets">
      <li class="sub">The payment assets have not been read yet.</li>
    </ul>
    <p class="sub" id="pay-assets-why">Read when this register signs in.</p>

    <p class="formfield">
      <label for="register-choice">Register</label>
      <select class="field" id="register-choice" aria-describedby="register-choice-help"><option value="">Not read yet</option></select>
      <span class="help" id="register-choice-help">Your switched-on registers.</span>
    </p>

    <p class="formfield">
      <label for="customer">Customer wallet</label>
      <input class="field" id="customer" type="text" autocomplete="off" spellcheck="false" aria-describedby="customer-help">
      <span class="help" id="customer-help">Needed for a typed amount. An item from your list does not need one.</span>
    </p>

    <button type="button" class="cta charge" id="charge" disabled aria-describedby="charge-why">Charge</button>
    <p class="sub" id="charge-why">Disabled until this register has read its settings and is signed in.</p>
    ${C.statusRegion("sale-status", "Nothing has been created yet.")}
  </section>
</div>

<section id="handover" hidden>
  <h2>Hand this to the customer</h2>
  <div class="qr" id="qr" role="img" aria-label="Square the customer can scan to open this payment"></div>
  <p class="pos-link" id="pay-link"></p>
  <p class="ctas">
    <button type="button" class="cta cta-quiet" id="copy-link">Copy</button>
    <button type="button" class="cta cta-quiet" id="share-link" hidden>Share</button>
    <button type="button" class="cta cta-quiet" id="check-again" hidden>Check again</button>
  </p>
  ${C.statusRegion("copy-said", "The link is the whole payment.")}
  ${C.statusRegion("handover-status", "Waiting for the customer.")}
  <p class="ctas"><a class="cta cta-quiet" href="../../">Back to my business</a></p>
</section>
${C.advancedVerification("adv")}
<script type="module" src="../../../assets/cashier.js"></script>`,
  },
];
