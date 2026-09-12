/**
 * The shop every business gets for its name.
 *
 * ONE LINK, AND THE NAME IS THE WHOLE OF IT. `shop/?name=freshcuts` is the address a business hands
 * out, prints on a card or reads down a telephone. The name is resolved on the chain to the wallet
 * that registered it, and that wallet's own listings are the shop. Nothing about a business is
 * stored on this site, so the same link works on any device and on a fresh browser, and a name
 * nobody registered gets one honest line rather than an invented shop.
 *
 * WHAT SHIPS IN THE DOCUMENT IS THE SHAPE, NEVER THE ANSWER. There is no business name in this
 * file, no price, no product and no picture. Each of those is read when the page runs; until then
 * the page says, truthfully, that it has not read anything yet.
 *
 * The layout is the site's public one, because this page is for a customer, not an owner.
 */
import { h } from "../html.mjs";
import * as C from "../components.mjs";

export const SHOP = [
  {
    route: "shop",
    h1: "Shop",
    title: "Shop — UNICA",
    description:
      "A business's own page, addressed by its pay name: who they are, and everything they have for sale, each with the link that pays for it.",
    ogTitle: "A shop on UNICA",
    ogDescription: "A business, its name, and what it sells.",
    ogImage: "og-merchant.svg",
    body: h`<link rel="stylesheet" href="../assets/screens/admin.css">
<div class="shop" id="shop">
  <div class="shop-id" id="shop-id" hidden>
    <span class="shop-badge" id="shop-badge"></span>
    <div class="shop-id-text">
      <p class="shop-name" id="shop-name">—</p>
      <p class="shop-payname" id="shop-payname"><span id="shop-payname-text">—</span> <span class="adm-marks" id="shop-mark"></span></p>
    </div>
  </div>
  ${C.statusRegion("shop-said", "Nothing has been read yet.")}
  <ul class="product-list" id="shop-products"></ul>
  <div class="empty" id="shop-empty" hidden>
    <p class="empty-t" id="shop-empty-t">Nothing is for sale here yet</p>
    <p class="sub" id="shop-empty-sub">This business has listed nothing at the moment.</p>
  </div>
</div>
<script type="module" src="../assets/shop.js"></script>`,
  },
];
