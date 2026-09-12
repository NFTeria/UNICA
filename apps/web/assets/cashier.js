/**
 * The register (/business/payments/new/): the screen somebody taps all day while a customer waits.
 *
 * AMOUNT, ASSET, ONE BUTTON. A big number, a keypad under it, the shop's own list beside it, the
 * assets a customer may pay with, and Charge. Everything else the sale needs — which settlement
 * path it takes, what the customer's spend has to be, what floor protects the business — is worked
 * out here from the active deployment. A cashier is never asked to choose between two settlement
 * implementations, because a cashier has no way to know which is right and no way to recover if
 * they pick wrong.
 *
 * THE AMOUNT IS ENTERED THE WAY A TILL IS ENTERED: digits arrive from the right. Two decimal places
 * is what a person types; the asset's own precision is what the chain is told, and the conversion
 * between the two is one multiplication, in `entryToBaseUnits`, tested rather than trusted. An
 * amount is always the amount the BUSINESS RECEIVES, so the per-payment ceiling can be checked
 * against it exactly, before a key is even accepted.
 *
 * THE PATH IS CHOSEN, NOT OFFERED. The payout asset goes to the direct settler; a different asset
 * goes through the market; an item picked from the shop's list, paid in the asset that item names,
 * is a catalogue purchase and needs no confirmation from the counter at all. A path the deployment
 * cannot perform is refused before the sale exists rather than after the customer has pressed pay.
 *
 * THE PRICE IS THE DEPLOYMENT'S OWN. A converted sale is worked out from the price the deployment's
 * oracle answers with, right now, and refused if that read fails. No rate is written into this file
 * and none is remembered from a previous sale.
 *
 * PAID IS NOT A GUESS. `saleVerdict` says Paid only where `paymentStatus` says PAID, which happens
 * only on a VERIFIED verification — never on a transaction hash, never on a timer, and never
 * because the customer says so. The other three words it may say are Checking, Refused and Unknown.
 */
import { encodeCall, selectorOf, topicOf, wordsOf } from "./abi.js";
import { INTEGRATIONS, businessAccent, businessStyle } from "./brand.js";
import { fillAdvanced, loadConfig, loadEvidence, say, shortId, show } from "./local.js";
import { listRegisters, readBusinessJoined } from "./local-join.js";
import {
  ASSET_STATUS,
  assetLabel,
  assetMenu,
  chooseSettlementRoute,
  formatAsset,
  fromBaseUnits,
  isAddress,
  paymentStatus,
  quoteOrder,
  registerDisplayName,
  validateEnvironment,
  withinPaymentLimit,
} from "./product.js";
import { loadQr, qrSvg } from "./qr.js";
import { readBusiness, silentReconnect } from "./session.js";
import { waitForReceipt } from "./wallet.js";

/** How long a customer has to pay before the sale stops being payable, in seconds. */
export const PAYMENT_WINDOW_SECONDS = 900;

/** `OrderCreated(bytes32,address,address,address,uint128,uint128,uint64)` puts the id in topic 1. */
export const ORDER_CREATED_SIGNATURE = "OrderCreated(bytes32,address,address,address,uint128,uint128,uint64)";

/** Robinhood Chain's test network. The one chain where a tokenized stock is what somebody pays with. */
export const ROBINHOOD_CHAIN_ID = 46630;

// ---- the amount, as a till enters it ------------------------------------------------------------

/** The most digits one sale may carry. A key beyond this is refused rather than silently dropped. */
export const ENTRY_MAX_DIGITS = 12;

/**
 * How many decimal places a person types for this asset. Two, the way a price is written, unless
 * the asset itself holds fewer — a whole-unit asset is entered in whole units, not in imaginary
 * hundredths that would round away on the way to the chain.
 */
export function entryDecimalsFor(asset) {
  const places = Number(asset?.decimals);
  if (!Number.isInteger(places) || places < 0) return null;
  return Math.min(2, places);
}

const pow10 = (n) => 10n ** BigInt(n);
const digitsOnly = (s) => String(s ?? "").replace(/\D/g, "");

/** "1250" at two entry places and six asset places -> 12500000n. The one multiplication, in one place. */
export function entryToBaseUnits(digits, decimals, entryDecimals) {
  const clean = digitsOnly(digits);
  const places = Number(decimals);
  const entry = Number(entryDecimals);
  if (!Number.isInteger(places) || !Number.isInteger(entry) || entry > places) {
    throw new Error("This register does not know how precise this asset is, so it will not price a sale.");
  }
  return BigInt(clean || "0") * pow10(places - entry);
}

/** 12500000n at six asset places -> "1250" at two entry places, or null when it does not divide exactly. */
export function baseUnitsToEntry(units, decimals, entryDecimals) {
  const places = Number(decimals);
  const entry = Number(entryDecimals);
  if (!Number.isInteger(places) || !Number.isInteger(entry) || entry > places) return null;
  const scale = pow10(places - entry);
  const value = typeof units === "bigint" ? units : BigInt(units ?? 0);
  if (value < 0n || value % scale !== 0n) return null;
  return (value / scale).toString();
}

/** "1250" at two entry places -> "12.50". An empty entry is a zero, written at the same width. */
export function formatEntry(digits, entryDecimals) {
  const entry = Number(entryDecimals);
  const clean = digitsOnly(digits) || "0";
  if (!Number.isInteger(entry) || entry <= 0) return String(BigInt(clean));
  const padded = clean.padStart(entry + 1, "0");
  return `${BigInt(padded.slice(0, padded.length - entry))}.${padded.slice(padded.length - entry)}`;
}

/**
 * One key press. Returns the entry after it, and a refusal when the press was not accepted, so the
 * screen can say why the number did not move instead of appearing to have missed the tap.
 *
 * `limitUnits` is the deployment's per-payment ceiling in the payout asset's base units. Checking
 * it here means a cashier cannot enter an amount the network will later refuse: the till simply
 * stops accepting digits at the ceiling, the way a till stops at its own drawer limit.
 */
export function pressKey(digits, key, { decimals, entryDecimals, limitUnits = null } = {}) {
  const current = digitsOnly(digits);
  if (key === "backspace") return { digits: current.slice(0, -1), refusal: null };
  if (key === "clear") return { digits: "", refusal: null };
  const added = key === "00" ? "00" : /^[0-9]$/.test(String(key)) ? String(key) : null;
  if (added === null) return { digits: current, refusal: null };
  const next = (current + added).replace(/^0+(?=\d)/, "");
  if (next.length > ENTRY_MAX_DIGITS) return { digits: current, refusal: REFUSALS.TOO_MANY_DIGITS };
  if (limitUnits !== null && limitUnits !== undefined) {
    const limit = withinPaymentLimit(entryToBaseUnits(next, decimals, entryDecimals), limitUnits);
    if (!limit.ok) return { digits: current, refusal: REFUSALS.ABOVE_LIMIT };
  }
  return { digits: next, refusal: null };
}

/**
 * The entry a quick-pick fills. An item whose price lands exactly on the entry grid becomes digits
 * the keypad can keep editing; one that does not is shown at its own exact precision and left
 * uneditable, because rounding somebody's price to fit a keypad is inventing a price.
 */
export function pickProductEntry(product, entryDecimals) {
  const decimals = Number(product?.decimals);
  const price = product?.price === undefined || product?.price === null ? null : BigInt(product.price);
  if (price === null || !Number.isInteger(decimals)) return { digits: "", exactUnits: null, text: "—" };
  const digits = baseUnitsToEntry(price, decimals, entryDecimals);
  if (digits === null) return { digits: "", exactUnits: price, text: fromBaseUnits(price, decimals) };
  return { digits, exactUnits: price, text: formatEntry(digits, entryDecimals) };
}

// ---- the words a refusal is allowed to use ------------------------------------------------------

/**
 * One line each. A cashier reading a refusal mid-sale needs the fact and nothing else: what is
 * wrong, in the words of the shop rather than of the machinery.
 */
export const REFUSALS = Object.freeze({
  WRONG_NETWORK: "Wrong network: this wallet is not on the network this business is set up on.",
  NO_REGISTER: "No register: this business has no register switched on to sell from.",
  NOT_ALLOWED: "This register is not allowed to start sales on this network.",
  ABOVE_LIMIT: "Above the limit: this setup will not take a single payment this large.",
  ASSET_UNAVAILABLE: "That asset cannot be taken right now.",
  NOT_CLEARED: "A converted payment of this amount is not approved for this business yet.",
  TOO_MANY_DIGITS: "That is more digits than one sale may carry.",
  NO_CUSTOMER: "A typed amount needs the customer's wallet; an item from your list does not.",
  NO_PAYOUT: "This business has no payout wallet on record, so there is nowhere to be paid.",
  NOT_SIGNED_IN: "Sign in with the wallet control at the top of this page.",
});

// ---- what the customer is handed ----------------------------------------------------------------

const payBase = (base) => new URL("../../../pay/", base);

/** The link for one sale: the whole payment, whether or not a square can be drawn beside it. */
export function orderLink(orderId, base) {
  const url = payBase(base);
  url.search = `?order=${orderId}`;
  return url.toString();
}

/** The link for one item on the shop's list. Anybody may open it; nobody is bound to it. */
export function productLink(productId, base) {
  const url = payBase(base);
  url.search = `?product=${productId}`;
  return url.toString();
}

/** The link for the whole shop. */
export function shopLink(seller, base) {
  const url = payBase(base);
  url.search = `?business=${seller}`;
  return url.toString();
}

// ---- what a sale is allowed to be called --------------------------------------------------------

/**
 * The four words this product may use about a payment, and no others. Paid comes only from a
 * VERIFIED verification. When the sale's own window has run out with nothing verified, the honest
 * answer is Unknown and the watching stops: a payment may still have landed, and this register has
 * no way to say it did.
 */
export function saleVerdict({ evidence = null, expired = false, txHash = null, txReceipt = null } = {}) {
  const status = paymentStatus({ txSubmitted: Boolean(txHash), txHash, txReceipt, evidence });
  if (status === "PAID") return { word: "Paid", done: true, line: "Paid. Checked against the network." };
  if (status === "FAILED") return { word: "Refused", done: true, line: "Refused. Nothing was taken." };
  if (status === "UNKNOWN") return { word: "Unknown", done: true, line: "Unknown. The check could not answer for this sale." };
  if (expired) return { word: "Unknown", done: true, line: "Unknown. This sale's time is up and nothing was checked." };
  return { word: "Checking", done: false, line: "Checking. Nothing is paid until it has been checked." };
}

// ---- colour, spent once ---------------------------------------------------------------------------

/**
 * The ONE integration this view may name, or none. Two marks in one view would each dilute the
 * other's meaning, so this returns a single answer with a stated precedence: what the customer is
 * paying WITH outranks what happens to it afterwards.
 *
 * A tokenized stock is only ever claimed where the deployment itself says an asset is one AND the
 * chain is Robinhood Chain's test network. Nothing is inferred from a symbol.
 */
export function integrationFor({ customerAsset = null, converts = false, chainId = null } = {}) {
  const declared = customerAsset?.kind === "stock" || customerAsset?.stock === true;
  if (declared && Number(chainId) === ROBINHOOD_CHAIN_ID) return INTEGRATIONS.robinhood;
  if (converts) return INTEGRATIONS.uniswap;
  return null;
}

// ---- the business's own registers ----------------------------------------------------------------

/** The register a cashier starts on: the first switched-on one, or nothing when none is switched on. */
export function chooseRegister(registers = []) {
  const list = Array.isArray(registers) ? registers : [];
  return list.find((r) => String(r?.status ?? "").toLowerCase() === "active") ?? null;
}

// ---- the shop's own list ---------------------------------------------------------------------------

/** GET /local/catalog?seller=… — the products this business has listed. Never throws; [] on silence. */
export async function loadCatalog(seller, fetchImpl = globalThis.fetch) {
  if (!isAddress(seller)) return [];
  try {
    const res = await fetchImpl(`/local/catalog?seller=${encodeURIComponent(seller)}`);
    if (!res.ok) return [];
    const body = await res.json();
    const list = Array.isArray(body?.products) ? body.products : [];
    return list.filter((p) => p && p.active !== false);
  } catch {
    return [];
  }
}

// ---- how a sale is actually raised ---------------------------------------------------------------

/**
 * A REGISTER DOES NOT RAISE A SALE BY ITSELF; IT ASKS THE GATE THAT KNOWS ITS NAME.
 *
 * The settlement contracts accept `createOrder` only from an allowlisted creator, and on this
 * product that creator is the admission gate, never a person's wallet. The gate checks, in one
 * call, that the wallet standing at the counter is currently authorized to publish the chosen
 * register's status, that the register is under this business and reads active, that the business
 * still resolves to the payout wallet the customer was quoted, and only then raises the sale. So
 * the register the cashier picked is load-bearing rather than decorative, and a revoked register
 * cannot sell.
 */
export const REQUEST_ORDER_SIGNATURE =
  "requestOrder(bytes32,bytes32,bytes32,address,address,address,uint128,uint128,uint64,bytes32)";
export const ORDER_ADMITTED_SIGNATURE = "OrderAdmitted(bytes32,bytes32,bytes32,address,address,address,bytes32)";
export const CREATE_ORDER_SIGNATURE = "createOrder(address,address,uint128,uint128,uint64,bytes32)";
/** The same-asset settler names its own event differently from the market one; both are read. */
export const ORDER_CREATED_DIRECT_SIGNATURE = "OrderCreated(bytes32,address,address,uint128,uint64,bytes32)";

/**
 * Which gate admits this path, taken from the deployment's own manifest. The same-asset settler is
 * admitted through its own instance, so the two are named separately and neither is guessed.
 */
export function gateFor(route, manifest = {}) {
  if (route?.kind === "direct") return manifest?.directSettlement?.gate ?? null;
  if (route?.kind === "conversion") return manifest?.contracts?.terminalAdmission?.address ?? null;
  return null;
}

/**
 * Every refusal the gate and the settlers can raise, and the one line a cashier reads for it. The
 * chain answers with a four-byte error selector; this is the whole translation, in one place, so a
 * counter never shows somebody a raw revert.
 */
export const GATE_ERRORS = Object.freeze([
  ["TerminalNotAuthorized(bytes32,address)", "NOT_ALLOWED"],
  ["NotOrderCreator(address)", "NOT_ALLOWED"],
  ["TerminalNotActive(bytes32,string)", "NO_REGISTER"],
  ["TerminalNotUnderMerchant(bytes32,bytes32)", "NO_REGISTER"],
  ["MerchantHasNoPayoutAddress(bytes32)", "NO_PAYOUT"],
  ["RecipientMismatch(address,address)", "NO_PAYOUT"],
  ["WrongEnsDeployment(bytes32,bytes32)", "WRONG_NETWORK"],
  ["ExecutorNotRegistered(address)", "ASSET_UNAVAILABLE"],
  ["MarketNotActive(bytes32,uint8)", "ASSET_UNAVAILABLE"],
  ["OrderAboveCap(uint128,uint128)", "ABOVE_LIMIT"],
  // A converted sale's exact terms have to be cleared before the gate will raise it, so a register
  // that has not had them cleared meets this rather than a network error, and says so in one line.
  ["PolicyNotAuthorized(bytes32)", "NOT_CLEARED"],
]);

/** The refusal one line long for whatever the chain said, or null when this register cannot tell. */
export function refusalForRevert(text) {
  const said = String(text ?? "").toLowerCase();
  for (const [signature, refusal] of GATE_ERRORS) {
    if (said.includes(selectorOf(signature).toLowerCase())) return REFUSALS[refusal];
  }
  return null;
}

/** The sale the gate admitted, from the gate's own log rather than from what this screen predicted. */
export function orderIdFromAdmission(receipt, gate) {
  return orderIdFromReceipt(receipt, gate, topicOf(ORDER_ADMITTED_SIGNATURE));
}

/** The order id this transaction created, taken from the log the settlement contract itself emitted. */
export function orderIdFromReceipt(receipt, contractAddress, topic0) {
  const logs = receipt?.logs ?? [];
  for (const log of logs) {
    if (String(log.address ?? "").toLowerCase() !== String(contractAddress ?? "").toLowerCase()) continue;
    if (String(log.topics?.[0] ?? "").toLowerCase() !== String(topic0 ?? "").toLowerCase()) continue;
    return log.topics?.[1] ?? null;
  }
  return null;
}

/** Decode the three words `latestPrice(address,address)` returns: price, decimals, updated time. */
export function decodeLatestPrice(value) {
  const words = wordsOf(value);
  if (words.length < 3) return null;
  return {
    price: BigInt("0x" + words[0]),
    decimals: Number(BigInt("0x" + words[1])),
    updatedAt: Number(BigInt("0x" + words[2])),
  };
}

// ---- DOM wiring; never runs under `node --test` -------------------------------------------------

if (typeof document !== "undefined" && document.getElementById("register")) {
  main().catch((e) => say("sale-status", `This register could not finish loading: ${e.message}`));
}

/** Everything the screen holds between taps. Read from the chain; nothing is remembered on reload. */
const till = {
  config: null,
  session: null,
  business: null,
  register: null,
  payout: null,
  customerAsset: null,
  entryDecimals: 2,
  digits: "",
  exactUnits: null,
  product: null,
  limitUnits: null,
  route: null,
};

async function main() {
  const config = await loadConfig();
  if (!config) {
    say("sale-status", "This register cannot reach its settings, so it will not start a sale.");
    say("charge-why", "Disabled: this register has not been able to read its settings.");
    return;
  }
  till.config = config;

  const environment = validateEnvironment(config.manifest ?? config);
  const banner = document.getElementById("env-banner");
  if (banner) banner.textContent = `${environment.banner} · ${environment.networkName}`;
  fillAdvanced(config);

  const menu = assetMenu(config);
  till.payout = menu.find((a) => a.role === "payout") ?? null;
  if (!till.payout?.labelled) {
    say("sale-status", "Your payout asset could not be read, so this register will not price a sale.");
    say("charge-why", "Disabled: the payout asset could not be read from the network.");
    return;
  }
  till.entryDecimals = entryDecimalsFor(till.payout) ?? 0;
  till.limitUnits = config.manifest?.market?.caps?.maxPerTxPayout ?? null;
  say("amount-line", `${till.payout.symbol} — what you receive`);
  renderAmount();
  wireKeypad();

  renderAssets(menu);

  const known = await silentReconnect(config);
  if (!known?.session) {
    say("sale-status", REFUSALS.NOT_SIGNED_IN);
    say("charge-why", `Disabled: ${REFUSALS.NOT_SIGNED_IN}`);
    return;
  }
  till.session = known.session;
  if (Number(known.session.chainId) !== Number(config.chainId)) {
    say("sale-status", REFUSALS.WRONG_NETWORK);
    say("charge-why", `Disabled: ${REFUSALS.WRONG_NETWORK}`);
    return;
  }

  till.business = await businessAtThisCounter(known.session, config);
  paintBusinessAccent(till.business?.merchantNode ?? null);
  if (!till.business?.payout) {
    say("sale-status", REFUSALS.NO_PAYOUT);
    say("charge-why", `Disabled: ${REFUSALS.NO_PAYOUT}`);
    return;
  }

  await fillRegisters();
  if (!till.register) {
    say("sale-status", REFUSALS.NO_REGISTER);
    say("charge-why", `Disabled: ${REFUSALS.NO_REGISTER}`);
    return;
  }

  // The shop's list belongs to the account that listed it, which is the account standing here.
  await fillPicks(till.session.address);

  const charge = document.getElementById("charge");
  if (charge) {
    charge.disabled = false;
    say("charge-why", "Creates this sale and hands the customer a link to pay it.");
    charge.addEventListener("click", () => {
      charge.disabled = true;
      chargeNow()
        .catch((e) => say("sale-status", `This sale was not created: ${e.message}`))
        .finally(() => {
          charge.disabled = false;
        });
    });
  }
  say("sale-status", "Ready.");
}

// ---- the amount ------------------------------------------------------------------------------------

function amountUnits() {
  if (till.exactUnits !== null) return till.exactUnits;
  return entryToBaseUnits(till.digits, till.payout.decimals, till.entryDecimals);
}

function renderAmount() {
  const display = document.getElementById("amount-display");
  if (!display) return;
  display.textContent =
    till.exactUnits !== null ? fromBaseUnits(till.exactUnits, till.payout.decimals) : formatEntry(till.digits, till.entryDecimals);
}

function wireKeypad() {
  const pad = document.getElementById("keypad");
  if (!pad) return;
  pad.addEventListener("click", (event) => {
    const key = event.target?.closest?.("[data-key]")?.dataset?.key;
    if (!key) return;
    // A typed digit is a new amount: an item picked from the list stops being the sale.
    if (till.exactUnits !== null && till.product) clearPick();
    const result = pressKey(till.digits, key, {
      decimals: till.payout.decimals,
      entryDecimals: till.entryDecimals,
      limitUnits: till.limitUnits,
    });
    till.digits = result.digits;
    till.exactUnits = null;
    renderAmount();
    if (result.refusal) say("sale-status", result.refusal);
  });
}

// ---- the assets a customer may pay with ------------------------------------------------------------

function renderAssets(menu) {
  const list = document.getElementById("pay-assets");
  if (!list) return;
  list.replaceChildren();
  const payable = menu.filter((a) => a.status !== ASSET_STATUS.UNAVAILABLE);
  if (payable.length === 0) {
    const li = document.createElement("li");
    li.className = "sub";
    li.textContent = REFUSALS.ASSET_UNAVAILABLE;
    list.append(li);
    return;
  }
  for (const asset of menu) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pos-asset";
    button.dataset.address = asset.address;
    button.disabled = asset.status === ASSET_STATUS.UNAVAILABLE;
    if (button.disabled) button.setAttribute("aria-describedby", "pay-assets-why");
    const sym = document.createElement("span");
    sym.className = "pos-asset-sym";
    sym.textContent = assetLabel(asset);
    const pill = document.createElement("span");
    pill.className = "availability";
    pill.dataset.status = asset.status;
    pill.textContent = asset.text;
    button.append(sym, pill);
    button.addEventListener("click", () => chooseAsset(asset));
    li.append(button);
    list.append(li);
  }
  say("pay-assets-why", "An asset with no way through is not offered.");
  chooseAsset(menu.find((a) => a.role === "payout" && a.status !== ASSET_STATUS.UNAVAILABLE) ?? payable[0]);
}

function chooseAsset(asset) {
  if (!asset) return;
  till.customerAsset = asset;
  for (const button of document.querySelectorAll(".pos-asset")) {
    const mine = String(button.dataset.address).toLowerCase() === String(asset.address).toLowerCase();
    button.setAttribute("aria-pressed", mine ? "true" : "false");
  }
  till.route = chooseSettlementRoute({
    customerAsset: asset,
    payoutAsset: till.payout,
    marketPair: till.config?.marketPair ?? null,
    contracts: till.config?.contracts ?? {},
  });
  paintIntegration();
}

/** At most one integration mark, as a 3px rule beside a name. Never a background, never two. */
function paintIntegration() {
  const mark = document.getElementById("sale-mark");
  if (!mark) return;
  const integration = integrationFor({
    customerAsset: till.customerAsset,
    converts: till.route?.kind === "conversion",
    chainId: till.config?.chainId,
  });
  if (!integration) {
    mark.hidden = true;
    mark.textContent = "";
    mark.style.removeProperty("--pos-mark");
    return;
  }
  mark.hidden = false;
  mark.textContent = integration.name;
  mark.style.setProperty("--pos-mark", integration.colour);
}

/** The business's own accent, from the hue of its badge, with the text colour computed against it. */
function paintBusinessAccent(node) {
  const root = document.getElementById("register");
  if (!root || !node) return;
  const dark = globalThis.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  const paint = () => {
    const accent = businessAccent(node, dark?.matches ? "dark" : "light");
    if (accent) root.setAttribute("style", businessStyle(accent));
  };
  paint();
  dark?.addEventListener?.("change", paint);
}

// ---- the registers and the shop's list ---------------------------------------------------------------

async function fillRegisters() {
  const select = document.getElementById("register-choice");
  const terminalsNode = till.business?.terminalsNode ?? null;
  const identity = till.config?.identity ?? null;
  if (!identity || !terminalsNode) return;
  const statusKey = till.config?.terminalStatusKey ?? "com.unica.terminal-status";
  const registers = await listRegisters(till.session, identity, terminalsNode, statusKey).catch(() => []);
  const open = registers.filter((r) => String(r.status ?? "").toLowerCase() === "active");
  till.register = chooseRegister(registers);
  if (!select) return;
  select.replaceChildren();
  for (const r of open) {
    const option = document.createElement("option");
    option.value = r.node;
    option.textContent = registerDisplayName(r.label);
    select.append(option);
  }
  if (till.register) select.value = till.register.node;
  select.addEventListener("change", () => {
    till.register = open.find((r) => r.node === select.value) ?? till.register;
  });
}

async function fillPicks(seller) {
  const list = document.getElementById("quick-picks");
  if (!list) return;
  const products = await loadCatalog(seller);
  list.replaceChildren();
  if (products.length === 0) {
    const li = document.createElement("li");
    li.className = "sub";
    li.textContent = "Nothing is on your list yet.";
    list.append(li);
    return;
  }
  for (const product of products) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pos-pick";
    const name = document.createElement("span");
    name.className = "pos-pick-name";
    name.textContent = product.name;
    const price = document.createElement("span");
    price.className = "pos-pick-price";
    price.textContent = `${fromBaseUnits(product.price, product.decimals)} ${product.symbol ?? ""}`.trim();
    button.append(name, price);
    button.addEventListener("click", () => pick(product));
    li.append(button);
    list.append(li);
  }
}

function pick(product) {
  till.product = product;
  const entry = pickProductEntry(product, till.entryDecimals);
  till.digits = entry.digits;
  till.exactUnits = entry.exactUnits;
  renderAmount();
  say("sale-name", product.name);
  for (const button of document.querySelectorAll(".pos-pick")) {
    button.setAttribute("aria-pressed", button.querySelector(".pos-pick-name")?.textContent === product.name ? "true" : "false");
  }
}

function clearPick() {
  till.product = null;
  till.exactUnits = null;
  say("sale-name", "No item chosen");
  for (const button of document.querySelectorAll(".pos-pick")) button.setAttribute("aria-pressed", "false");
}

// ---- charging ----------------------------------------------------------------------------------------

async function chargeNow() {
  const paysPayout = String(till.customerAsset?.address).toLowerCase() === String(till.payout.address).toLowerCase();

  // An item from the shop's own list, paid in the asset that item names, is a catalogue purchase:
  // the customer buys it themselves, so nothing is confirmed from this side of the counter.
  if (till.product && paysPayout) {
    say("sale-status", "Ready to pay. Hand this to the customer.");
    await handOver(productLink(till.product.id, location.href), null);
    return;
  }

  if (!till.route || till.route.kind === "none") {
    say("sale-status", REFUSALS.ASSET_UNAVAILABLE);
    return;
  }
  const customer = String(document.getElementById("customer")?.value ?? "").trim();
  if (!isAddress(customer)) {
    say("sale-status", REFUSALS.NO_CUSTOMER);
    return;
  }
  const minOut = amountUnits();
  if (minOut <= 0n) {
    say("sale-status", "Enter an amount above zero.");
    return;
  }
  if (!withinPaymentLimit(minOut, till.limitUnits).ok) {
    say("sale-status", REFUSALS.ABOVE_LIMIT);
    return;
  }

  const quote = await priceThisSale(minOut);
  const deadline = Math.floor(Date.now() / 1000) + PAYMENT_WINDOW_SECONDS;
  const salt = "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const gate = gateFor(till.route, till.config.manifest ?? {});
  const ensDeploymentId = till.config.manifest?.identity?.ensDeploymentId ?? till.business.ensDeploymentId ?? null;
  const args = [
    till.business.merchantNode,
    till.register.node,
    ensDeploymentId,
    till.route.contract,
    till.business.payout,
    customer,
    quote.amountIn.toString(),
    quote.minOut.toString(),
    String(deadline),
    salt,
  ];
  const throughGate = Boolean(gate && ensDeploymentId && till.business.merchantNode && till.register?.node);

  // THE DRY RUN COMES FIRST, AND IT COSTS NOTHING. The same call, asked as a question, runs every
  // one of the gate's checks and answers with the sale id it would raise. A refusal therefore
  // reaches the counter as one line BEFORE anybody is asked to confirm anything, and the id is
  // known before it is sent, so the sale can be recognised afterwards even if its log is missed.
  let predicted = null;
  if (throughGate) {
    try {
      predicted = await till.session.call({ from: till.session.address, to: gate, data: encodeCall(REQUEST_ORDER_SIGNATURE, args) });
    } catch (e) {
      say("sale-status", refusalForRevert(e?.message) ?? "This sale was refused before anything was sent.");
      return;
    }
  }

  say("sale-status", "Confirm this sale in your wallet. Nothing is charged to the customer by this step.");
  const tx = throughGate
    ? { to: gate, data: encodeCall(REQUEST_ORDER_SIGNATURE, args) }
    : {
        to: till.route.contract,
        data: encodeCall(CREATE_ORDER_SIGNATURE, [
          till.business.payout,
          customer,
          quote.amountIn.toString(),
          quote.minOut.toString(),
          String(deadline),
          salt,
        ]),
      };
  let hash;
  try {
    hash = await till.session.send(tx);
  } catch (e) {
    say("sale-status", refusalForRevert(e?.message) ?? `This sale was not created: ${e?.message ?? "your wallet did not answer"}`);
    return;
  }
  say("sale-status", "Sent. Waiting for the network.");
  const receipt = await waitForReceipt(till.session, hash);
  if (!receipt) {
    say("sale-status", "Not confirmed yet. Do not charge again; reload in a moment.");
    return;
  }
  if (Number(receipt.status) === 0) {
    say("sale-status", "The network declined this sale. Nothing was created and nothing was charged.");
    return;
  }

  // Read the id back from what the chain actually logged, and let that win over the prediction.
  const orderId =
    (throughGate ? orderIdFromAdmission(receipt, gate) : null) ??
    orderIdFromReceipt(receipt, till.route.contract, topicOf(ORDER_CREATED_SIGNATURE)) ??
    orderIdFromReceipt(receipt, till.route.contract, topicOf(ORDER_CREATED_DIRECT_SIGNATURE)) ??
    predicted;
  if (!orderId) {
    say("sale-status", "The sale was created but its number could not be read back. Open your orders to find it.");
    return;
  }
  fillAdvanced(till.config, { order: orderId, tx: hash });
  say("sale-status", `${formatAsset(quote.minOut, till.payout)} to you. Hand this to the customer.`);
  await handOver(orderLink(orderId, location.href), { orderId, deadline });
}

/**
 * What the customer spends and what the business is guaranteed. A same-asset sale is the amount
 * itself; a converted one is worked out from the price the deployment's own oracle answers with,
 * now, and refused if that read fails.
 */
async function priceThisSale(minOut) {
  if (till.route.kind !== "conversion") return { amountIn: minOut, minOut };
  const adapter = till.config.manifest?.market?.adapter ?? till.config.contracts?.oracleAdapter ?? null;
  if (!adapter) throw new Error("This setup names no price source, so a converted sale cannot be priced.");
  const answer = decodeLatestPrice(
    await till.session.call({
      to: adapter,
      data: encodeCall("latestPrice(address,address)", [till.customerAsset.address, till.payout.address]),
    }),
  );
  if (!answer) throw new Error("The price source did not answer, so this sale was not created.");
  return quoteOrder({
    invoiceUnits: minOut,
    invoiceIn: "payout",
    customerAsset: till.customerAsset,
    payoutAsset: till.payout,
    price: answer.price,
    priceDecimals: answer.decimals,
  });
}

/**
 * The business this counter sells for. The wallet standing here is usually the owner, but at a till
 * it is just as often an operator key that owns no business of its own — so when the chain has no
 * business for this wallet, the business the deployment names is read from the chain instead. No
 * authority is assumed either way: the gate decides whether THIS wallet may sell from that
 * business, and it decides it during the dry run, before a confirmation is spent.
 */
async function businessAtThisCounter(session, config) {
  const mine = await readBusiness(session, config).catch(() => null);
  if (mine?.joined) return mine;
  const identity = config?.manifest?.identity ?? null;
  const owner = identity?.joinedBy ?? null;
  if (!identity?.merchantNode || !isAddress(owner)) return mine;
  const joined = await readBusinessJoined(session, config.merchantOnboarding, owner).catch(() => null);
  if (!joined) return mine;
  return {
    available: true,
    joined: true,
    merchantNode: identity.merchantNode,
    label: joined.label ?? null,
    name: identity.merchantName ?? null,
    payout: joined.payout ?? null,
    terminalsNode: joined.terminalsNode ?? identity.terminalsNode ?? null,
    ensDeploymentId: identity.ensDeploymentId ?? null,
  };
}

// ---- what the customer is handed ------------------------------------------------------------------

async function handOver(link, watching) {
  show("handover");
  const text = document.getElementById("pay-link");
  if (text) text.textContent = link;
  wireCopy(link);
  wireShare(link);
  await drawSquare(link);
  if (watching) await watchSale(watching);
  else say("handover-status", "This one is on your list; the customer pays it themselves.");
}

function wireCopy(link) {
  const button = document.getElementById("copy-link");
  if (!button || button.dataset.wired === "yes") {
    if (button) button.dataset.link = link;
    return;
  }
  button.dataset.wired = "yes";
  button.dataset.link = link;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.link);
      say("copy-said", "Link copied.");
    } catch {
      say("copy-said", "Copying is unavailable here. Select the link and copy it.");
    }
  });
}

function wireShare(link) {
  const button = document.getElementById("share-link");
  if (!button) return;
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  button.dataset.link = link;
  if (button.dataset.wired === "yes") return;
  button.dataset.wired = "yes";
  button.addEventListener("click", async () => {
    try {
      await navigator.share({ url: button.dataset.link });
    } catch {
      say("copy-said", "Sharing was not completed. The link above is the whole payment.");
    }
  });
}

/** The square the customer scans. When it cannot be drawn the link still stands and the screen says so. */
async function drawSquare(link) {
  const box = document.getElementById("qr");
  if (!box) return;
  box.replaceChildren();
  try {
    const qr = await loadQr();
    const { svg } = qrSvg(qr, link);
    box.innerHTML = svg;
  } catch {
    box.textContent = "No square";
    say("copy-said", "The square could not be drawn here. The link above is the whole payment.");
  }
}

/**
 * Watch one sale until it is checked. The words are `saleVerdict`'s and nothing else may say Paid.
 */
async function watchSale({ orderId, deadline }, { intervalMs = 3000, attempts = 200, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const again = document.getElementById("check-again");
  const once = async () => {
    const evidence = await loadEvidence(orderId);
    const verdict = saleVerdict({ evidence, expired: now() >= Number(deadline) });
    say("handover-status", verdict.line);
    fillAdvanced(till.config, { order: orderId, reasons: evidence?.reasonCodes ?? null });
    return verdict.done;
  };
  if (again) {
    again.hidden = false;
    again.addEventListener("click", () => {
      once().catch((e) => say("handover-status", `Could not check: ${e.message}`));
    });
  }
  say("handover-status", `Sale ${shortId(orderId)}. Checking.`);
  for (let i = 0; i < attempts; i += 1) {
    if (await once()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
