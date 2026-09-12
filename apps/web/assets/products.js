/**
 * What a business sells: the list, the payment link for each item, and the form that adds one.
 *
 * THE SELLER IS THE CONNECTED WALLET, ALWAYS. The catalogue keys a product by the account that
 * listed it, so this screen reads the wallet that is signed in and shows exactly that account's
 * products. There is no seller field to fill in and nothing to get wrong: a person cannot list on
 * somebody else's behalf here because the contract will not let them.
 *
 * EVERY LINK IS THE WHOLE STATE. A product's payment link carries the product's number and nothing
 * else, so the same link reloads to the same item on any device, and a printed code is a printed
 * link. The link is on screen as selectable text beside its code, because a code somebody cannot
 * read out is no use over a telephone.
 *
 * TWO ACTIONS SPEND A WALLET CONFIRMATION — adding a product and switching one on or off — and each
 * says so in one line before it is pressed. Neither is undone by this screen: a listing's terms
 * never move once it exists, which is what makes a payment link safe to hand out.
 *
 * The arithmetic and the calldata are pure functions at the top, so apps/web/tests/admin.test.mjs
 * exercises the real rule rather than a paraphrase of it.
 */
import { abiEncode, encodeCall, selectorOf } from "./abi.js";
import { drawQr, fetchCatalog, noSignupLine, openAdmin, wireShare } from "./business.js";
import { say, shortId } from "./local.js";
import { fromBaseUnits, isAddress, toBaseUnits } from "./product.js";
import { waitForReceipt } from "./wallet.js";

const DAY_SECONDS = 86400;
const NOBODY = "0x0000000000000000000000000000000000000000";

/** The three shapes a business may sell, and the word a business owner reads for each. */
export const KINDS = Object.freeze([
  ["one-off", "One-off"],
  ["recurring", "Recurring"],
  ["permanent", "Permanent"],
]);

export function kindLabel(kind) {
  return (KINDS.find(([k]) => k === kind) ?? [])[1] ?? "Not known";
}

/** The catalogue's own numbering, which is the order of the three above and not a coincidence. */
export function kindIndex(kind) {
  const at = KINDS.findIndex(([k]) => k === kind);
  return at === -1 ? null : at;
}

/** Whole days a period covers, or null when it covers no time at all. Never a rounded part-day. */
export function periodDays(seconds) {
  const s = Number(seconds ?? 0);
  if (!Number.isFinite(s) || s <= 0) return null;
  return s % DAY_SECONDS === 0 ? s / DAY_SECONDS : null;
}

/** A price as the person who set it typed it, or the raw count when the asset never said its precision. */
export function priceText(product) {
  if (!product || product.price === null || product.price === undefined) return "Not known";
  if (!Number.isInteger(product.decimals) || !product.symbol) return `${product.price} base units`;
  return `${fromBaseUnits(product.price, product.decimals)} ${product.symbol}`;
}

/** The three payment links this product has, exactly as the rest of the product spells them. */
export function productLink(base, id) {
  return new URL(`pay/?product=${encodeURIComponent(String(id))}`, base).href;
}

/**
 * What a filled-in form means, or the one sentence saying why it means nothing yet.
 *
 * Each refusal is the contract's own rule, checked here so a person is told at the keyboard rather
 * than by a wallet confirmation that reverts: a period belongs to a recurring product and to no
 * other kind, and only a one-off may be reserved for one named buyer.
 */
export function newProductPlan({ name, price, kind, days, onlyBuyer, asset, payout, decimals } = {}) {
  const trimmed = String(name ?? "").trim();
  const bytes = new TextEncoder().encode(trimmed).length;
  if (bytes === 0) return { ok: false, error: "Give it a name." };
  if (bytes > 64) return { ok: false, error: "A name is at most 64 characters." };
  const at = kindIndex(kind);
  if (at === null) return { ok: false, error: "Choose what kind of thing this is." };
  if (!isAddress(asset)) return { ok: false, error: "This screen does not know which asset to price it in yet." };
  if (!isAddress(payout)) return { ok: false, error: "This screen does not know where the money should arrive yet." };
  let units;
  try {
    units = toBaseUnits(price, decimals);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (units <= 0n) return { ok: false, error: "Enter a price above zero." };

  let period = 0;
  if (kind === "recurring") {
    const whole = Number(String(days ?? "").trim());
    if (!Number.isInteger(whole) || whole <= 0) return { ok: false, error: "Say how many whole days one payment covers." };
    if (whole > 3650) return { ok: false, error: "One payment may cover at most 3650 days." };
    period = whole * DAY_SECONDS;
  } else if (String(days ?? "").trim() !== "") {
    return { ok: false, error: "Only a recurring product covers a period of time." };
  }

  const buyer = String(onlyBuyer ?? "").trim();
  let reserved = NOBODY;
  if (buyer !== "") {
    if (kind !== "one-off") return { ok: false, error: "Only a one-off may be reserved for one buyer." };
    if (!isAddress(buyer)) return { ok: false, error: "A buyer's address is 0x followed by forty letters or digits." };
    reserved = buyer;
  }
  return { ok: true, plan: { name: trimmed, asset, price: units.toString(), kindIndex: at, period, payout, onlyBuyer: reserved } };
}

/**
 * The calldata that lists it.
 *
 * `uint8` and `uint64` each occupy one whole 32-byte word, exactly as `uint256` does, so the
 * argument tuple is encoded with `uint256` in their places. The SELECTOR is taken from the TRUE
 * signature, which is the only place the declared widths change the bytes; getting that wrong is
 * a call to a function that does not exist, which is why it is derived here and never typed out.
 */
export const LIST_SIGNATURE = "list(string,address,uint256,uint8,uint64,address,address)";
const LIST_WORD_TYPES = ["string", "address", "uint256", "uint256", "uint256", "address", "address"];

export function listCalldata(plan) {
  return (
    selectorOf(LIST_SIGNATURE) +
    abiEncode(LIST_WORD_TYPES, [plan.name, plan.asset, plan.price, plan.kindIndex, plan.period, plan.payout, plan.onlyBuyer])
  );
}

export function setActiveCalldata(productId, active) {
  return encodeCall("setActive(uint256,bool)", [productId, Boolean(active)]);
}

// ---- DOM wiring; never runs under `node --test`, where there is no document -----------------------

if (typeof document !== "undefined" && document.getElementById("product-list")) {
  main().catch((e) => say("products-said", `This page could not finish loading: ${e.message}`));
}

let state = null;

/**
 * Where this site's root is, from the document's own address. Every link in this artifact is
 * relative so the site works at a domain root, under a project path or behind a content hash; a
 * payment link has to be ABSOLUTE, because it is handed to somebody else. Resolving "../../" against
 * this page is the only computation that gets both right at once.
 */
function siteRoot() {
  return new URL("../../", location.href).href;
}

async function main() {
  const open = await openAdmin("../../");
  if (!open) return;
  const { config, session, business, wallet } = open;
  const payoutAsset = (config.assets ?? []).find((a) => a.role === "payout") ?? null;
  state = { config, session, business, wallet, payoutAsset, catalog: config.contracts?.productCatalog ?? null };

  await renderList(session.address);
  wireForm();
}

async function renderList(seller) {
  const list = document.getElementById("product-list");
  if (!list) return;
  say("products-said", "Reading your products…");
  const answered = await fetchCatalog({ seller });
  if (!answered) {
    say("products-said", "Your products could not be read just now. Nothing is shown rather than a partial list.");
    return;
  }
  const products = Array.isArray(answered.products) ? answered.products : [];
  list.replaceChildren();
  for (const product of products) list.appendChild(await productElement(product));
  const reason = noSignupLine(state?.business);
  const sentence = answered.note
    ? "This network has no list of things to sell."
    : `${products.length} product${products.length === 1 ? "" : "s"} read for ${shortId(seller)}.`;
  say("products-said", reason ? `${sentence} ${reason}` : sentence);
  const empty = document.getElementById("products-empty");
  if (empty) empty.hidden = products.length > 0;
}

async function productElement(product) {
  const li = document.createElement("li");
  li.className = "product adm-product";

  const head = document.createElement("div");
  head.className = "adm-product-head";
  const name = document.createElement("span");
  name.className = "product-name";
  name.textContent = product.name;
  const price = document.createElement("span");
  price.className = "product-price";
  price.textContent = priceText(product);
  head.append(name, price, pill("active", product.active ? "Active" : "Switched off", product.active ? "active" : "revoked"));
  head.append(pill("kind", kindLabel(product.kind), "unknown"));
  if (product.kind === "recurring") {
    const days = periodDays(product.period);
    head.append(pill("period", days ? `Every ${days} days` : "Every period", "unknown"));
  }
  if (product.kind === "one-off") head.append(pill("sold", product.sold ? "Sold" : "For sale", product.sold ? "revoked" : "active"));
  if (product.onlyBuyer) head.append(pill("buyer", `For ${shortId(product.onlyBuyer)}`, "unknown"));
  li.append(head);

  const link = productLink(siteRoot(), product.id);
  const share = document.createElement("div");
  share.className = "adm-share";
  const qr = document.createElement("div");
  qr.className = "qr";
  const side = document.createElement("div");
  const address = document.createElement("code");
  address.className = "adm-link";
  address.textContent = link;
  const actions = document.createElement("div");
  actions.className = "adm-product-actions";
  actions.append(
    action("Copy link", { copy: true }),
    action("Share", { share: true }),
    action(product.active ? "Switch off" : "Switch on", { toggle: product.id, active: !product.active }),
  );
  const said = document.createElement("p");
  said.className = "sub";
  said.id = `product-said-${product.id}`;
  side.append(address, actions, said);
  share.append(qr, side);
  li.append(share);

  wireShare(share, link, said.id);
  wireToggle(share, product);
  await drawQr(qr, link);
  return li;
}

function pill(kind, label, status) {
  const el = document.createElement("span");
  el.className = "pill";
  el.dataset.status = status;
  el.dataset.kind = kind;
  el.textContent = label;
  return el;
}

function action(label, { copy = false, share = false, toggle = null, active = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cta cta-quiet";
  button.textContent = label;
  if (copy) button.dataset.copy = "true";
  if (share) button.dataset.share = "true";
  if (toggle !== null) {
    button.dataset.toggle = String(toggle);
    button.dataset.active = String(active);
  }
  return button;
}

function wireToggle(root, product) {
  const button = root.querySelector("[data-toggle]");
  if (!button) return;
  const saidId = `product-said-${product.id}`;
  say(saidId, product.active
    ? "Switching it off stops new sales of it. Your wallet will ask you to confirm."
    : "Switching it on lets it be bought again. Your wallet will ask you to confirm.");
  button.addEventListener("click", async () => {
    if (!state?.catalog) {
      say(saidId, "This network has no list of things to sell, so nothing can be changed.");
      return;
    }
    button.disabled = true;
    try {
      say(saidId, "Confirm it in your wallet…");
      const hash = await state.session.send({ to: state.catalog, data: setActiveCalldata(product.id, button.dataset.active === "true") });
      say(saidId, "Sent. Waiting for the network…");
      const receipt = await waitForReceipt(state.session, hash);
      if (!receipt) {
        say(saidId, "Sent, but the network has not confirmed it yet. Reload in a moment.");
        return;
      }
      await renderList(state.session.address);
    } catch (e) {
      say(saidId, `That did not go through: ${e.message}`);
    } finally {
      button.disabled = false;
    }
  });
}

function wireForm() {
  const button = document.getElementById("product-add");
  const kind = document.getElementById("product-kind");
  const period = document.getElementById("product-days");
  const buyer = document.getElementById("product-buyer");
  if (!button) return;

  const symbol = document.getElementById("product-price-help");
  if (symbol && state?.payoutAsset?.symbol) symbol.textContent = `In ${state.payoutAsset.symbol}, the asset you are paid in.`;

  const follow = () => {
    const chosen = kind?.value ?? "one-off";
    if (period) period.closest(".formfield").hidden = chosen !== "recurring";
    if (buyer) buyer.closest(".formfield").hidden = chosen !== "one-off";
  };
  kind?.addEventListener("change", follow);
  follow();

  if (!state?.catalog) {
    say("product-add-why", "This network has no list of things to sell, so nothing can be added here.");
    return;
  }
  button.disabled = false;
  say("product-add-why", "Adding it asks your wallet to confirm one transaction. Its terms never change afterwards.");

  button.addEventListener("click", async () => {
    const plan = newProductPlan({
      name: document.getElementById("product-name")?.value,
      price: document.getElementById("product-price")?.value,
      kind: kind?.value,
      days: period?.value,
      onlyBuyer: buyer?.value,
      asset: state.payoutAsset?.address ?? null,
      payout: state.wallet,
      decimals: state.payoutAsset?.decimals ?? null,
    });
    if (!plan.ok) {
      say("product-add-said", plan.error);
      return;
    }
    button.disabled = true;
    try {
      say("product-add-said", "Confirm it in your wallet…");
      const hash = await state.session.send({ to: state.catalog, data: listCalldata(plan.plan) });
      say("product-add-said", "Sent. Waiting for the network…");
      const receipt = await waitForReceipt(state.session, hash);
      if (!receipt) {
        say("product-add-said", "Sent, but the network has not confirmed it yet. Reload in a moment.");
        return;
      }
      say("product-add-said", `"${plan.plan.name}" is listed.`);
      for (const id of ["product-name", "product-price", "product-days", "product-buyer"]) {
        const box = document.getElementById(id);
        if (box) box.value = "";
      }
      await renderList(state.session.address);
    } catch (e) {
      say("product-add-said", `That did not go through: ${e.message}`);
    } finally {
      button.disabled = false;
    }
  });
}
