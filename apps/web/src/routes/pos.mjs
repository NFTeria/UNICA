import { h, raw, hex, evidenceBadge } from "../html.mjs";
import { SITE, V3, EXPERIMENT } from "../site.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

export const POS = [
  {
    route: "business/payments/new",
    h1: "Create payment",
    title: "Create payment — UNICA",
    description:
      "The register: enter an amount, choose the currency to invoice in, and hand the customer a link or a square to scan.",
    ogTitle: "Create a UNICA payment",
    ogDescription: "Enter an amount. Hand over a link. Wait for the check.",
    ogImage: "og-merchant.svg",
    body: h`
<section class="card"${P("create-order")} id="register">
  <h2>Amount</h2>
  <p><label for="customer-wallet">Customer wallet</label><br>
  <input id="customer-wallet" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="0x…" size="46"><br>
  <span class="sub">The wallet that will pay this sale.</span></p>
  <p><label for="amount">Amount to charge</label><br>
  <input id="amount" class="field" type="text" inputmode="decimal" autocomplete="off" placeholder="12.50" aria-describedby="amount-hint"></p>
  <p class="sub" id="amount-hint">Digits and one decimal point. This is what the customer owes.</p>
  <p><label for="currency">Customer pays in</label><br>
  <select id="currency" class="field" aria-describedby="currency-hint"></select></p>
  <p class="sub" id="currency-hint">You still receive your payout asset.</p>
  <p><button type="button" class="cta" id="create" disabled aria-describedby="create-why">Create payment</button></p>
  <p class="sub" id="create-why">Disabled until this register has read its settings and a wallet is
  connected on the right network.</p>
  ${C.statusRegion("create-status", "Nothing has been created yet.")}
</section>

<section id="handover" hidden>
  <h2>Hand this to the customer</h2>
  <div class="paylink">
    <input id="pay-link" class="field" type="text" readonly aria-label="Customer payment link">
    <button type="button" class="cta cta-quiet" id="copy-link">Copy link</button>
  </div>
  <div class="qr" id="qr" role="img" aria-label="Square the customer can scan to open this payment"></div>
  ${C.statusRegion("qr-said", "The square is drawn once the payment exists.")}
  <h3>Waiting for the customer</h3>
  ${C.statusRegion("payment-progress", "Waiting for the customer to pay.")}
  <p><button type="button" class="cta cta-quiet" id="check-again" hidden aria-describedby="check-again-why">Check again</button></p>
  <p class="sub" id="check-again-why">Re-checks this payment against the network. Nothing is sent.</p>
  <p class="ctas"><a class="cta cta-quiet" href="../../">Back to my business</a></p>
</section>
${C.advancedVerification("adv")}
<script type="module" src="../../../assets/cashier.js"></script>`,
  },
];
