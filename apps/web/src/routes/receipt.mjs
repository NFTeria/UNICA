import { h, raw, hex, evidenceBadge } from "../html.mjs";
import { SITE, V3, EXPERIMENT } from "../site.mjs";
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
<p class="sub">This page takes <code>?chain=</code>, <code>?tx=</code> and <code>?order=</code> from
the link. The state is entirely in the link, so it reloads and shares correctly. A static host
cannot serve one file per transaction, which is why these are query parameters.</p>
<section class="card"${P("receipt")} id="receipt-card">
  <p class="headline" id="r-business">This business</p>
  <p class="big" id="r-amount">—</p>
  <p id="r-statement" class="sub">Nothing has been checked yet.</p>
  <dl class="receipt-lines">
    <dt>Paid amount</dt><dd id="r-paid">—</dd>
    <dt>Customer asset</dt><dd id="r-customer-asset">—</dd>
    <dt>Payout asset</dt><dd id="r-payout-asset">—</dd>
    <dt>Date and time</dt><dd id="r-when">—</dd>
    <dt>Order number</dt><dd id="r-order" class="hex">—</dd>
    <dt>Payment status</dt><dd id="r-status">—</dd>
    <dt>Verification status</dt><dd id="r-verification">—</dd>
    <dt>Transaction</dt><dd id="r-tx" class="hex">—</dd>
  </dl>
  <p class="ctas">
    <button type="button" class="cta cta-quiet" id="r-download" disabled aria-describedby="r-download-why">Download this receipt</button>
    <button type="button" class="cta cta-quiet" id="r-share" disabled aria-describedby="r-download-why">Share this receipt</button>
  </p>
  <p class="sub" id="r-download-why">Available once this receipt has been read from the network.</p>
  ${C.statusRegion("receipt", "No transaction in this link.")}
  ${C.evidenceKey()}
</section>
<section${P("graph")}>
  <h2>Indexed payments</h2>
  ${C.statusRegion("graph", "The index has not been read yet.")}
  <p${P("graph-fail")}>An index that cannot be reached and an index holding nothing are different
  answers, and this page never shows one as the other. A failed read says it failed.</p>
</section>
<section>
  <h2>Without the index</h2>
  <p>Every line above can be rebuilt from the transaction's own record and the network's own state.
  The index makes it faster; it is never the only route.</p>
</section>
${C.advancedVerification("adv")}
<script type="module" src="../assets/receipt.js"></script>`,
  },
];
