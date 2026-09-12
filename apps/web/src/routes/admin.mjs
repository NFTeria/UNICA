/**
 * Two admin screens the signed-in menu points at: what you sell, and who bought it.
 *
 * THEY ARE HONEST STUBS, AND THAT IS THE WHOLE POINT. The sidebar in `src/shell.mjs` names six
 * destinations, the build refuses a menu item that resolves to no file, and a menu item that leads
 * to a page pretending to hold data would be worse than a broken link — a broken link is obvious.
 * So each of these says, in one sentence a shop owner can read, what the screen will show and where
 * it will read it from, and shows no invented row, no placeholder price and no example customer.
 * The next build fills them in; until then nothing here can be mistaken for a record.
 */
import { h } from "../html.mjs";
import * as C from "../components.mjs";

export const PRODUCTS = [
  {
    route: "business/products",
    h1: "Products",
    title: "Products — UNICA",
    description:
      "The things this business sells: what each one is called, what it costs, and whether it can be rung up right now. Read from the business's own catalog.",
    ogTitle: "Products on UNICA",
    ogDescription: "What this business sells, and what each item costs.",
    ogImage: "og-merchant.svg",
    body: h`
<p class="lead">This screen lists what your business sells, so a register can ring up an item by
name instead of somebody typing the price from memory.</p>
<section class="card">
  <h2>Nothing is listed here yet</h2>
  <p>Your catalog is read from your business when this screen is built, in the next release. Until
  then this page shows no items, rather than showing examples that are not yours.</p>
  <p class="sub">Nothing on this page is a saved product, a price you have set, or an amount anyone
  can be charged.</p>
  <p class="ctas">
    <a class="cta" href="../payments/new/">Create payment</a>
    <a class="cta cta-quiet" href="../">Back to my business</a>
  </p>
</section>
${C.statusRegion("products-said", "No catalog has been read.")}`,
  },
];

export const CUSTOMERS = [
  {
    route: "business/customers",
    h1: "Customers",
    title: "Customers — UNICA",
    description:
      "The people who have paid this business: what they paid with, when they last bought, and the receipts that prove each visit happened.",
    ogTitle: "Customers on UNICA",
    ogDescription: "Who has paid this business, and when they last bought.",
    ogImage: "og-merchant.svg",
    body: h`
<p class="lead">This screen lists the wallets that have paid you, with the date of the last payment
and the receipts behind each one.</p>
<section class="card">
  <h2>Nobody is listed here yet</h2>
  <p>Your customers are worked out from the payments this business has actually taken, in the next
  release. A person appears here only once a payment of theirs has been checked against the
  network — never because a page remembered them.</p>
  <p class="sub">Nothing on this page is a saved customer, an email address, or a name anybody
  typed. This product asks for none of those.</p>
  <p class="ctas">
    <a class="cta cta-quiet" href="../payments/">Orders</a>
    <a class="cta cta-quiet" href="../">Back to my business</a>
  </p>
</section>
${C.statusRegion("customers-said", "No payments have been read.")}`,
  },
];
