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
 * THE BUSINESS CHOOSES WHAT IT IS PAID IN, ONE PRODUCT AT A TIME. The catalogue keys a price to an
 * asset, and takes any ERC-20 that has code, so this screen offers every asset the deployment can
 * already name and lets a business type the address of one it cannot. The price box then reads in
 * that asset and says so, because "25" means two different things in an asset with six decimal
 * places and one with eighteen.
 *
 * TWO ACTIONS SPEND A WALLET CONFIRMATION — adding a product and switching one on or off — and each
 * says so in one line before it is pressed. Neither is undone by this screen: a listing's terms
 * never move once it exists, which is what makes a payment link safe to hand out.
 *
 * The arithmetic and the calldata are pure functions at the top, so apps/web/tests/admin.test.mjs
 * exercises the real rule rather than a paraphrase of it; the asset choice is the same shape, with
 * its network reads injected, in apps/web/tests/products-asset.test.mjs.
 */
import { abiEncode, decodeString, decodeUint, encodeCall, selectorOf } from "./abi.js";
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

// ---- what the business is paid in, per product ---------------------------------------------------

/**
 * The value of the one option in the chooser that is not an asset: an address the business types.
 * A real asset's option value is its own address, so this word cannot collide with one.
 */
export const OTHER_ASSET = "other";

const sameAddress = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * Whether a price may be written in this asset at all. Both halves are required and neither can be
 * guessed: without a symbol a customer reads a number with no name on it, and without the decimal
 * count a typed "0.001" cannot be turned into base units — or, worse, is turned into the wrong ones.
 */
const canPrice = (asset) =>
  Boolean(asset?.symbol) && Number.isInteger(asset?.decimals) && asset?.labelled !== false && isAddress(asset?.address);

const entryOf = (asset) => ({ address: asset.address, symbol: asset.symbol, decimals: asset.decimals, known: true });

/**
 * What the "You are paid in" chooser offers.
 *
 * Every asset this deployment already read a name and a precision for, the one it pays out in
 * first because that is what most products will be priced in, and then the option that is not a
 * list at all. An asset this network could not label is left out rather than offered and refused:
 * a choice that cannot be taken is not a choice.
 */
export function paidInOptions(config = {}) {
  const assets = Array.isArray(config?.assets) ? config.assets : [];
  const priceable = assets.filter(canPrice);
  const ordered = [...priceable.filter((a) => a.role === "payout"), ...priceable.filter((a) => a.role !== "payout")];
  return [
    ...ordered.map((a) => ({ value: String(a.address), label: a.symbol, asset: entryOf(a) })),
    { value: OTHER_ASSET, label: "Another asset by address", asset: null },
  ];
}

/** True only when the network answered with bytes that are actually a program. */
const hasCode = (code) => {
  const h = String(code ?? "").trim().replace(/^0[xX]/, "");
  return /^[0-9a-fA-F]+$/.test(h) && /[1-9a-fA-F]/.test(h);
};

/**
 * The decimal count an asset answered with, or null when it answered nothing a count can be read
 * from.
 *
 * WRITTEN THIS WAY BECAUSE `Number(null)` IS 0. A token with no `decimals()` at all would otherwise
 * be taken for a token with none — and a price of "1" in an asset that really holds eighteen places
 * would be listed a billion billion times too small. Nothing but an actual count is a count here.
 */
const decimalsFrom = (value) => {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : null;
};

/**
 * Which asset this product is priced in, from what the business chose — or the one sentence saying
 * why the choice cannot be taken.
 *
 * THE CATALOGUE TAKES ANY ERC-20 THAT HAS CODE, so the business is not held to the deployment's
 * own two assets. An address it has never seen is not taken on trust either: `read` asks the
 * network whether anything is deployed there, what it calls itself and how many decimal places it
 * holds, and every one of the three has to answer. A price set against an asset whose precision
 * nobody read is wrong by whatever factor the guess was out by, and the customer is the one who
 * pays that.
 *
 * `read` is injected, so apps/web/tests/products-asset.test.mjs exercises this rule against
 * answers it writes itself rather than against a chain.
 */
export async function assetChoice({ choice, assets = [], address = null, read = null } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  const picked = String(choice ?? "").trim();

  if (picked !== OTHER_ASSET) {
    const known = list.find((a) => sameAddress(a?.address, picked));
    if (!known) return { ok: false, error: "Choose which asset you are paid in for this product." };
    if (!canPrice(known)) {
      return { ok: false, error: "This network did not say what that asset is called or how many decimal places it holds, so nothing can be priced in it." };
    }
    return { ok: true, asset: entryOf(known) };
  }

  const pasted = String(address ?? "").trim();
  if (!isAddress(pasted)) return { ok: false, error: "An asset's address is 0x followed by forty letters or digits." };
  if (typeof read !== "function") return { ok: false, error: "This screen cannot reach the network to check that address." };

  let answered;
  try {
    answered = await read(pasted);
  } catch (e) {
    return { ok: false, error: `That address could not be read just now: ${e.message}` };
  }
  if (!hasCode(answered?.code)) {
    return { ok: false, error: "Nothing is deployed at that address on this network, so it cannot be an asset." };
  }
  const decimals = decimalsFrom(answered?.decimals);
  if (decimals === null || decimals < 0 || decimals > 36) {
    return { ok: false, error: "That address did not say how many decimal places it holds, so a price in it cannot be worked out." };
  }
  const symbol = String(answered?.symbol ?? "").trim();
  if (!symbol) {
    return { ok: false, error: "That address did not say what it is called, so a customer would be shown a price with no name on it." };
  }
  return { ok: true, asset: { address: pasted, symbol, decimals, known: false } };
}

/**
 * What the network says about one address: whether anything is deployed there, what it calls
 * itself, and how many decimal places it holds.
 *
 * The two token reads answer null when they revert, because a contract that has no `symbol()` is
 * an ordinary answer this screen has a sentence for. `eth_getCode` is NOT softened the same way: a
 * node that cannot be reached must not look like an address with nothing at it, so that one throws
 * and `assetChoice` says the address could not be read rather than that it is empty.
 */
export function assetReaderFor(session) {
  const quiet = async (run) => {
    try {
      return await run();
    } catch {
      return null;
    }
  };
  return async (address) => {
    const code = await session.request("eth_getCode", [address, "latest"]);
    const symbolHex = await quiet(() => session.call({ to: address, data: encodeCall("symbol()", []) }));
    const decimalsHex = await quiet(() => session.call({ to: address, data: encodeCall("decimals()", []) }));
    const places = decimalsHex ? decodeUint(decimalsHex) : null;
    return {
      code,
      symbol: symbolHex ? decodeString(symbolHex) : null,
      decimals: places === null || places === undefined ? null : Number(places),
    };
  };
}

/** The one line under the price box. It names the chosen asset, because the number is in that asset. */
export function priceHint(asset) {
  if (!asset?.symbol) return "Choose what you are paid in above, then type the price in that asset.";
  return `In ${asset.symbol}, the asset you are paid in for this product.`;
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
  state = {
    config,
    session,
    business,
    wallet,
    catalog: config.contracts?.productCatalog ?? null,
    asset: null, // what the next product is priced in; nothing until the chooser has settled one
    readAsset: assetReaderFor(session),
  };

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

/**
 * The chooser, its address box, and the price hint that follows whichever asset won.
 *
 * A read is racy by nature — a person can paste a second address before the first has answered —
 * so every read carries a token and a stale answer is dropped. Without that, the slower of two
 * reads would decide what the product is priced in, which is the one kind of wrong this screen
 * would never show a sign of.
 */
let assetReadToken = 0;

/**
 * The sentence the DOCUMENT shipped under the address box, captured once and put back after every
 * transient line this screen writes there. Taking it from the page rather than repeating it here
 * is what stops the served HTML and this script from drifting into saying two different things.
 */
let assetAddressHelp = "";

function fillAssetChooser(select) {
  if (!select) return;
  const options = paidInOptions(state?.config ?? {});
  select.replaceChildren();
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    select.appendChild(el);
  }
}

async function settleAsset() {
  const select = document.getElementById("product-asset");
  const box = document.getElementById("product-asset-address");
  const field = box?.closest(".formfield") ?? null;
  const pasting = (select?.value ?? "") === OTHER_ASSET;
  if (field) field.hidden = !pasting;

  const typed = String(box?.value ?? "").trim();
  if (pasting && typed === "") {
    state.asset = null;
    assetReadToken++; // an answer still in flight belongs to an address that is no longer typed
    say("product-asset-address-error", "");
    say("product-asset-address-help", assetAddressHelp);
    say("product-price-help", priceHint(null));
    return;
  }
  if (pasting) say("product-asset-address-help", "Reading that asset from the network…");

  const token = ++assetReadToken;
  const chosen = await assetChoice({
    choice: select?.value ?? "",
    assets: state?.config?.assets ?? [],
    address: typed,
    read: state?.readAsset ?? null,
  });
  if (token !== assetReadToken) return;

  state.asset = chosen.ok ? chosen.asset : null;
  say("product-asset-address-error", chosen.ok ? "" : chosen.error);
  if (pasting) {
    say(
      "product-asset-address-help",
      chosen.ok ? `${chosen.asset.symbol}, ${chosen.asset.decimals} decimal places, read from the network.` : assetAddressHelp,
    );
  }
  say("product-price-help", priceHint(state.asset));
}

function wireForm() {
  const button = document.getElementById("product-add");
  const kind = document.getElementById("product-kind");
  const period = document.getElementById("product-days");
  const buyer = document.getElementById("product-buyer");
  if (!button) return;

  const chooser = document.getElementById("product-asset");
  const assetAddress = document.getElementById("product-asset-address");
  assetAddressHelp = document.getElementById("product-asset-address-help")?.textContent ?? "";
  fillAssetChooser(chooser);
  chooser?.addEventListener("change", () => void settleAsset());
  assetAddress?.addEventListener("change", () => void settleAsset());
  void settleAsset();

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
      asset: state.asset?.address ?? null,
      payout: state.wallet,
      decimals: state.asset?.decimals ?? null,
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
