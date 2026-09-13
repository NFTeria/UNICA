/**
 * The two screens the signed-in menu points at: what this business sells, and who has bought it.
 *
 * BOTH ARE READ FROM THE CHAIN AND FROM NOWHERE ELSE. Products come from the catalogue the active
 * deployment names, keyed by the wallet that is signed in — the catalogue keys a listing by the
 * account that made it, so a person cannot see or change anybody else's. Customers are worked out
 * from the payments that wallet actually received; this product asks for no name, no email address
 * and no telephone number, so it has none to show and none to leak.
 *
 * WHAT SHIPS IN THE DOCUMENT IS THE SHAPE OF THE ANSWER, NEVER THE ANSWER. A list with nothing in
 * it says so; a figure nobody has read is an em dash. There is no sample product, no example
 * customer and no placeholder price anywhere on either screen.
 *
 * WHAT A BUSINESS IS PAID IN IS ITS OWN CHOICE, PER PRODUCT. The "You are paid in" chooser ships
 * with one option saying it is being read, and is filled by script from the assets the active
 * deployment could actually name; the address box under it is for an asset it could not, and ships
 * HIDDEN, because it is shown only when that option is picked. Neither ships in the state script
 * will put it in a moment later: an empty chooser is a control with nothing to say for itself, and
 * an address box that is visible for one frame and then gone is a field the reader loses — or, on a
 * slow read, one they can type into before anything is listening.
 * The price box's help sentence is the same one the script writes once an asset has settled, so the
 * document and the script cannot end up saying two different things about the same number.
 *
 * The tables are written out rather than taken from `dataTable()` because script fills their bodies
 * row by row and needs an element to address. Their structure is the design system's, cell for
 * cell; apps/web/DESIGN.md is the copy that governs.
 */
import { h, raw } from "../html.mjs";
import * as C from "../components.mjs";

const gate = raw(`<div class="empty adm-gate" id="admin-gate" hidden>
  <p class="empty-t">Sign in to see your business</p>
  <p class="sub" id="gate-line">Use the wallet control at the top of this page.</p>
</div>`);

export const PRODUCTS = [
  {
    route: "business/products",
    h1: "Products",
    title: "Products — UNICA",
    description:
      "What this business sells: the name, the price and the asset it is priced in, whether it is on sale, and the payment link and code for each one.",
    ogTitle: "Products on UNICA",
    ogDescription: "What this business sells, and the link that pays for each.",
    ogImage: "og-merchant.svg",
    body: h`<link rel="stylesheet" href="../../assets/screens/admin.css">
${gate}
<div id="admin-body">
<h2>What you sell</h2>
<ul class="product-list" id="product-list"></ul>
<div class="empty" id="products-empty">
  <p class="empty-t">Nothing is listed yet</p>
  <p class="sub">Add your first item below and it gets its own payment link.</p>
</div>
${C.statusRegion("products-said", "Your products have not been read yet.")}

<h2>Add a product</h2>
<div class="adm-form">
  ${C.field({ id: "product-name", label: "Name", help: "What your customers call it." })}
  ${C.selectField({
    id: "product-asset",
    label: "You are paid in",
    options: [["", "Reading assets…"]],
    help: "Every asset this network can name, or one of your own by its address.",
  })}
  ${C.field({
    id: "product-asset-address",
    label: "Asset address",
    placeholder: "0x…",
    hidden: true,
    help: "Only when you chose another asset above. This screen reads its name and its decimal places before it will price anything in it.",
  })}
  ${C.field({ id: "product-price", label: "Price", inputmode: "decimal", help: "Choose what you are paid in above, then type the price in that asset." })}
  ${C.selectField({
    id: "product-kind",
    label: "Kind",
    options: [
      ["one-off", "One-off — sold once, then gone"],
      ["recurring", "Recurring — a period they keep paying for"],
      ["permanent", "Permanent — on the shelf, any number of times"],
    ],
  })}
  ${C.field({ id: "product-days", label: "Days one payment covers", inputmode: "numeric", help: "Whole days. Recurring only." })}
  ${raw('<div class="adm-wide">')}
  ${C.field({ id: "product-buyer", label: "Reserve it for one buyer", placeholder: "0x…", help: "Optional, and only for a one-off." })}
  ${raw("</div>")}
</div>
${C.button("Add this product", { id: "product-add", disabled: true, reason: "Disabled until this screen has read your business and the list it would be added to." })}
${C.statusRegion("product-add-said", "Nothing has been added yet.")}
</div>
<script type="module" src="../../assets/products.js"></script>`,
  },
];

export const CUSTOMERS = [
  {
    route: "business/customers",
    h1: "Customers",
    title: "Customers — UNICA",
    description:
      "The wallets that have paid this business: how often, how much of each asset, when they last paid, and what they are covered for.",
    ogTitle: "Customers on UNICA",
    ogDescription: "Who has paid this business, and when they last did.",
    ogImage: "og-merchant.svg",
    body: h`<link rel="stylesheet" href="../../assets/screens/admin.css">
${gate}
<div id="admin-body">
<p class="sub">Worked out from the payments you have taken. This product asks for no names, so it shows none.</p>
<div class="table-wrap">
  <table class="dtable">
    <caption>Wallets that have paid you</caption>
    <thead><tr>
      <th scope="col">Customer</th>
      <th scope="col">Payments</th>
      <th scope="col">Total checked</th>
      <th scope="col">Last paid</th>
      <th scope="col">Covered</th>
    </tr></thead>
    <tbody id="customer-rows"><tr><td class="sub" colspan="5">Nothing has been read yet.</td></tr></tbody>
  </table>
</div>
${C.statusRegion("customers-said", "No payments have been read yet.")}
<p class="ctas">
  <a class="cta cta-quiet" href="../payments/">Orders</a>
  <a class="cta cta-quiet" href="../">Overview</a>
</p>
</div>
<script type="module" src="../../assets/customers.js"></script>`,
  },
];
