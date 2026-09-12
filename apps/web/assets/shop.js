/**
 * A business's own page, found by its name.
 *
 * THE NAME IS RESOLVED, NOT LOOKED UP. `shop-resolve.js` asks the chain which node a label belongs
 * to and which business registered it; this file only decides what a person sees once that answer
 * comes back. Nothing is stored here and nothing is remembered between visits, so two people
 * opening the same link see the same shop, and a name that was never registered gets one line
 * saying exactly that instead of an empty page that looks broken.
 *
 * ONLY WHAT IS ON SALE IS SHOWN. A listing the business switched off, and a one-off somebody has
 * already bought, are not offers any more — putting either in front of a customer is an invitation
 * to press a button that cannot work. They are counted, and the count is said out loud, so the page
 * is never quietly shorter than the truth.
 *
 * ONE COLOUR RULE, ONE COLOUR. This page resolved a name, so ENS's mark is the one integration
 * allowed in the view, and the business's own accent comes from the hue of its badge. The badge
 * itself is drawn when the deployment names the contract that holds it; otherwise the accent square
 * stands in, which is the business's colour either way.
 *
 * WHAT IS PURE LIVES AT THE TOP, so apps/web/tests/admin.test.mjs exercises the real rule.
 */
import { businessAccent, businessStyle } from "./brand.js";
import { currentScheme, drawQr, fetchCatalog, markElement, readOnlySession } from "./business.js";
import { encodeCall, decodeString } from "./abi.js";
import { parseTokenUri } from "./local-join.js";
import { loadConfig, say } from "./local.js";
import { priceText } from "./products.js";
import { resolveShop } from "./shop-resolve.js";
import { rpcRequest } from "./wallet.js";

/** The name a shop link carries, or null when the link names nothing. */
export function askedName(search) {
  const value = new URLSearchParams(String(search ?? "")).get("name");
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * What a customer may actually buy right now.
 *
 * `active` is the business's own switch. `sold` only ends a one-off: a recurring or permanent
 * listing is bought again and again, and the catalogue sets `sold` on neither, so reading it for
 * every kind would hide a shop the first time anybody paid for a membership.
 */
export function onSale(products) {
  return (Array.isArray(products) ? products : []).filter((p) => p?.active && !(p?.kind === "one-off" && p?.sold));
}

/** The line under the list: how many are on sale, and how many are not, without ever hiding the second. */
export function shopCountText(total, showing) {
  if (total === 0) return "Nothing is listed here yet.";
  const away = total - showing;
  const shown = `${showing} of ${total} ${total === 1 ? "listing is" : "listings are"} on sale.`;
  return away > 0 ? `${shown} ${away} ${away === 1 ? "is" : "are"} not on sale at the moment.` : shown;
}

/** The link that pays for one product, from this page's own depth. */
export function buyHref(productId) {
  return `../pay/?product=${encodeURIComponent(String(productId))}`;
}

// ---- DOM wiring; never runs under `node --test`, where there is no document -----------------------

if (typeof document !== "undefined" && document.getElementById("shop-products")) {
  main().catch((e) => say("shop-said", `This page could not finish loading: ${e.message}`));
}

async function main() {
  const config = await loadConfig();
  if (!config) {
    say("shop-said", "This site is showing the product, not a business, so there is no shop to open here.");
    return;
  }
  const asked = askedName(location.search);
  if (!asked) {
    say("shop-said", "This link names no shop. A shop link ends in the business's own name.");
    return;
  }
  say("shop-said", "Reading this shop…");

  const session = readOnlySession(config);
  const found = await resolveShop(session, config, asked).catch(() => null);
  if (!found) {
    say("shop-said", "No shop by that name.");
    return;
  }

  await renderIdentity(config, found);
  await renderProducts(found.seller);
}

async function renderIdentity(config, found) {
  const block = document.getElementById("shop-id");
  if (block) block.hidden = false;

  const accent = businessAccent(found.merchantNode ?? null, currentScheme());
  const root = document.querySelector("main") ?? document.body;
  if (root && accent) root.setAttribute("style", businessStyle(accent));

  say("shop-name", found.name ?? "This business");
  if (found.by === "name") {
    say("shop-payname-text", `Pay them at ${found.name}`);
    const mark = markElement("ens");
    const slot = document.getElementById("shop-mark");
    if (mark && slot) slot.replaceChildren(mark);
  } else {
    say("shop-payname-text", "This business has no pay name.");
  }

  const square = document.getElementById("shop-badge");
  if (square && accent) square.setAttribute("style", businessStyle(accent));
  const holder = config.identityToken ?? null;
  if (!square || !holder || found.badgeTokenId === null || found.badgeTokenId === undefined) return;
  try {
    const answer = await rpcRequest(config.rpc, "eth_call", [
      { to: holder, data: encodeCall("tokenURI(uint256)", [found.badgeTokenId]) },
      "latest",
    ]);
    const art = parseTokenUri(decodeString(answer));
    if (art?.image) {
      const img = document.createElement("img");
      img.src = art.image;
      img.alt = "";
      square.replaceChildren(img);
    }
  } catch {
    // no picture to draw; the accent square already carries this business's colour
  }
}

async function renderProducts(seller) {
  const list = document.getElementById("shop-products");
  if (!list) return;
  const answered = await fetchCatalog({ seller });
  if (!answered) {
    say("shop-said", "This shop could not be read just now. Nothing is shown rather than a partial list.");
    return;
  }
  if (answered.note) {
    say("shop-said", "This network has no list of things to sell.");
    return;
  }
  const all = Array.isArray(answered.products) ? answered.products : [];
  const offers = onSale(all);
  list.replaceChildren();
  for (const product of offers) list.appendChild(await offerElement(product));
  const empty = document.getElementById("shop-empty");
  if (empty) empty.hidden = offers.length > 0;
  say("shop-said", shopCountText(all.length, offers.length));
}

async function offerElement(product) {
  const li = document.createElement("li");
  li.className = "product shop-offer";

  const head = document.createElement("div");
  head.className = "shop-offer-head";
  const name = document.createElement("span");
  name.className = "product-name";
  name.textContent = product.name;
  const price = document.createElement("span");
  price.className = "product-price";
  price.textContent = priceText(product); // the owner's screen and the customer's read a price identically
  head.append(name, price);
  li.append(head);

  const buy = document.createElement("a");
  buy.className = "cta";
  buy.href = buyHref(product.id);
  buy.textContent = "Buy";

  const qr = document.createElement("div");
  qr.className = "qr";
  const foot = document.createElement("div");
  foot.className = "shop-offer-foot";
  foot.append(buy, qr);
  li.append(foot);

  await drawQr(qr, new URL(buyHref(product.id), location.href).href);
  return li;
}
