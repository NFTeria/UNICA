/**
 * The receipt: what a customer keeps and a business shows its accountant.
 *
 * THE LINK IS THE RECEIPT. The network, the transaction and, for a catalogue sale, the sale id all
 * ride in the query string, so the same link always rebuilds the same record and nothing depends on
 * what this browser remembers. A static host cannot serve one file per transaction, which is why
 * these are query parameters rather than a path.
 *
 * ONE VERDICT, AND IT IS NOT DECIDED HERE. The pill says Paid only when the payment check answered
 * VERIFIED; every other answer reads Checking, Refused or Unknown, and the reason codes sit behind
 * the Advanced verification disclosure. `assets/storefront.js` owns that mapping so the checkout
 * and this page cannot come to different conclusions about the same payment.
 */
import { h, raw } from "../html.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

export const RECEIPT = [
  {
    route: "receipt",
    h1: "Receipt",
    title: "Receipt — UNICA",
    description:
      "One payment's receipt, addressed by network and transaction in the link, so the same link always rebuilds the same record.",
    ogTitle: "UNICA receipt",
    ogDescription: "Rebuildable from the network alone.",
    ogImage: "og-receipt.svg",
    body: h`
<link rel="stylesheet" href="../assets/screens/checkout.css">
<div class="co">
  <div class="co-id">
    <span class="co-badge" id="r-badge"></span>
    <div class="co-id-text">
      <p class="co-name" id="r-business">This business</p>
      <p class="co-payname"><span id="r-payname">—</span><span class="int" data-int="ens" id="r-ens" hidden>ENS</span></p>
    </div>
  </div>
  <section class="co-card"${P("receipt")} id="receipt-card">
    <div class="rc-head">
      <p class="rc-amount" id="r-amount">—</p>
      <span class="pill" data-status="pending" id="r-verdict"><span aria-hidden="true">◐</span> Checking</span>
    </div>
    <dl class="rc-rows">
      <dt>Amount</dt><dd id="r-paid">—</dd>
      <dt>Asset</dt><dd id="r-asset">—</dd>
      <dt>When</dt><dd id="r-when">—</dd>
      <dt>Network</dt><dd id="r-network">—</dd>
      <dt>Transaction</dt><dd id="r-tx" class="hex">—</dd>
    </dl>
    <p class="rc-links">
      <a href="#" id="r-explorer" hidden>Open on the network's own explorer</a>
      <button type="button" class="cta cta-quiet" id="r-download" disabled aria-describedby="r-keep-why">Download</button>
      <button type="button" class="cta cta-quiet" id="r-share" disabled aria-describedby="r-keep-why">Share</button>
    </p>
    <p class="sub" id="r-keep-why">Available once this receipt has been read from the network.</p>
    <p class="status" id="receipt" role="status" aria-live="polite">No payment in this link.</p>
  </section>
  <section class="graph-panel"${P("graph")}>
    <p><span id="graph-line">Not indexed yet</span> <span class="int" data-int="graph" id="graph-mark" hidden>The Graph</span></p>
    <ul class="graph-rows" id="graph-rows" hidden></ul>
    <p class="sub"${P("graph-fail")}>An index that did not answer and an index holding nothing are different answers.</p>
  </section>
  ${C.advancedVerification("adv")}
</div>
<script type="module" src="../assets/receipt.js"></script>`,
  },
];
