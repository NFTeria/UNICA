/**
 * What a customer is shown, shaped once.
 *
 * Three links reach the same card: an order, a catalogue product, or a whole shop. Rather than
 * three screens that drift apart, this module turns each of them into ONE shape — an identity, a
 * line, a total, what is paid, what the business receives — and the checkout renders that shape.
 * Every function here is pure, so the card a person will read can be asserted in a test without a
 * browser, a chain or a server.
 *
 * NOTHING IS INVENTED. A field nobody has read is null, and the screen shows an em dash for it. No
 * amount is ever shown at anything but its own asset's decimals, because a figure off by six
 * places reads as a real price to the person paying it.
 *
 * ONE INTEGRATION COLOUR PER VIEW. Uniswap belongs where a payment converts, Chainlink where a
 * price check set the figure on screen, ENS where a name resolved, The Graph where a receipt was
 * indexed. More than one at a time turns attribution into decoration, so `integrationForCheckout`
 * and `integrationForReceipt` pick exactly one — the one closest to what the person is looking at
 * — and everything else is rendered in plain ink.
 */
import { formatAsset } from "./product.js";

export const ORDER_ID = /^0x[0-9a-fA-F]{64}$/;
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const PRODUCT_ID = /^[0-9]{1,20}$/;
const ZERO = "0x0000000000000000000000000000000000000000";

// ---- the links -----------------------------------------------------------------------------------

/**
 * What a payment link is asking for. Exactly three shapes are recognised and an identifier that is
 * not well formed is REFUSED rather than guessed at: a near-miss hash turned into a lookup is how
 * somebody ends up reading a stranger's payment.
 */
export function readPayTarget(search) {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const order = params.get("order");
  const product = params.get("product");
  const business = params.get("business");
  const malformed = Boolean(
    (order !== null && !ORDER_ID.test(order)) ||
      (product !== null && !PRODUCT_ID.test(product)) ||
      (business !== null && !ADDRESS.test(business)),
  );
  if (order && ORDER_ID.test(order)) return { kind: "order", order, product: null, business: null, malformed: false };
  if (product && PRODUCT_ID.test(product)) return { kind: "product", order: null, product, business: null, malformed: false };
  if (business && ADDRESS.test(business)) return { kind: "business", order: null, product: null, business, malformed: false };
  return { kind: null, order: null, product: null, business: null, malformed };
}

const trimSite = (site) => String(site ?? "").replace(/\/+$/, "");

/** The one place a payment link is written. An order, a product, or a whole shop. */
export function payLink(site, target = {}) {
  const base = trimSite(site) + "/pay/";
  if (target.order) {
    if (!ORDER_ID.test(target.order)) throw new Error("an order is 32 bytes as 0x-prefixed hex");
    return `${base}?order=${target.order}`;
  }
  if (target.product !== undefined && target.product !== null) {
    const id = String(target.product);
    if (!PRODUCT_ID.test(id)) throw new Error("a product is a whole number");
    return `${base}?product=${id}`;
  }
  if (target.business) {
    if (!ADDRESS.test(target.business)) throw new Error("a shop is a 20-byte address");
    return `${base}?business=${target.business}`;
  }
  throw new Error("a payment link needs an order, a product or a shop");
}

/** The receipt for one payment: a transaction on a network, or one catalogue sale. */
export function receiptLink(site, { chainId = null, tx = null, saleId = null } = {}) {
  const base = trimSite(site) + "/receipt/";
  if (!tx && !saleId) throw new Error("a receipt link needs a transaction or a sale");
  const parts = [];
  if (chainId !== null && chainId !== undefined && String(chainId) !== "") parts.push(`chain=${encodeURIComponent(chainId)}`);
  if (tx) parts.push(`tx=${tx}`);
  if (saleId) parts.push(`sale=${saleId}`);
  return `${base}?${parts.join("&")}`;
}

/** The network's own explorer, when the deployment named one. Never a guessed host. */
export function explorerTxLink(manifest, tx) {
  const base = manifest?.explorer?.url ?? null;
  if (!base || !tx) return null;
  return `${trimSite(base)}/tx/${tx}`;
}

// ---- who is being paid ------------------------------------------------------------------------

/**
 * The business behind this payment: the pay name the chain answered with, the name a person reads,
 * the wallet the money arrives at, the node its badge colours come from, and where its badge image
 * can be read when the deployment carries an identity token.
 */
export function businessIdentity(config = {}) {
  const identity = config.manifest?.identity ?? config.identity ?? {};
  const merchant = config.record?.merchant ?? {};
  const payName = merchant.name ?? identity.merchantName ?? null;
  const label = payName ? String(payName).split(".")[0] : null;
  const tokenId = identity.tokenId ?? null;
  const badgeAddress = config.identityToken ?? null;
  return {
    payName,
    label,
    display: displayName(label),
    address: merchant.address ?? null,
    node: identity.merchantNode ?? null,
    badge: badgeAddress && tokenId !== null ? { address: badgeAddress, tokenId: String(tokenId) } : null,
  };
}

/** "fresh-cuts" is a shop whose sign says Fresh Cuts. A label with no hyphen keeps its one word. */
export function displayName(label) {
  const text = String(label ?? "").trim();
  if (!text) return "This business";
  return text
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---- the one integration colour a view is allowed ----------------------------------------------

/**
 * Checkout: conversion outranks a price check, which outranks a name, because that is the order in
 * which each thing changes what the person is about to pay. Returns null when none of them applies.
 */
export function integrationForCheckout({ converts = false, priceChecked = false, payName = null } = {}) {
  if (converts) return "uniswap";
  if (priceChecked) return "chainlink";
  if (payName) return "ens";
  return null;
}

/** Receipt: an answered index outranks the name, because the index is what this panel is about. */
export function integrationForReceipt({ indexed = false, payName = null } = {}) {
  if (indexed) return "graph";
  if (payName) return "ens";
  return null;
}

// ---- the card ------------------------------------------------------------------------------------

const assetOf = (config, address) =>
  (config?.assets ?? []).find((a) => String(a.address ?? "").toLowerCase() === String(address ?? "").toLowerCase()) ?? null;

const amountText = (units, asset) => (units === null || units === undefined ? null : formatAsset(units, asset ?? {}));

/** What `order.status` means on the wire: 1 open, 2 paying, 3 settled. */
export const ORDER_STATUS = { 1: "open", 2: "paying", 3: "settled" };

/** The status word for a card, or "unknown" for a number this product does not define. */
export function orderStatusOf(status) {
  return ORDER_STATUS[Number(status)] ?? "unknown";
}

/**
 * An order, as a card — one line, one total, what the customer spends and what the business is
 * guaranteed to receive.
 *
 * `read` is the body of GET /local/order?id=<id>, and it is the authoritative source. A payment
 * link only CLAIMS an id; the chain is what answers for it. So the everyday path is: the link
 * names an id, the id is asked of the chain, and this shapes the chain's answer — the settler
 * that holds the order, the asset it is written in, the business it pays.
 *
 * `config.record` is a STORED snapshot of one single order. It is consulted only when the
 * companion did not answer at all (`read === null`) AND that snapshot is about the very id being
 * asked for. Without the id check, a link to ANY other order would silently render the stored
 * one, and the person paying would read one order's business, amount and expiry while paying
 * another's. That is the worst thing this screen can do, so a record that does not match the
 * requested id is no card at all rather than a plausible wrong one.
 */
export function orderCard(config = {}, read = null, orderId = null) {
  if (read) return read.order ? cardFromRead(config, read) : null;
  const record = config.record ?? null;
  const order = record?.order ?? null;
  if (!order) return null;
  if (!orderId || String(order.id ?? "").toLowerCase() !== String(orderId).toLowerCase()) return null;
  const spend = assetOf(config, order.inputAsset);
  const receive = assetOf(config, order.outputAsset);
  const converts = Boolean(
    order.inputAsset && order.outputAsset && String(order.inputAsset).toLowerCase() !== String(order.outputAsset).toLowerCase(),
  );
  const priceChecked = Boolean(config.manifest?.market?.oracle?.enabled) && converts;
  const identity = businessIdentity(config);
  return {
    kind: "order",
    id: order.id ?? null,
    identity,
    line: { what: identity.display, amount: amountText(order.inputAmount, spend) },
    total: amountText(order.inputAmount, spend),
    pay: { asset: spend, text: amountText(order.inputAmount, spend) },
    receive: { asset: receive, text: amountText(order.minimumOutput, receive) },
    converts,
    priceChecked,
    integration: integrationForCheckout({ converts, priceChecked, payName: identity.payName }),
    payer: order.payer ?? null,
    expiry: order.expiry ?? null,
    settledTx: record?.settlement?.transactionHash ?? null,
    settler: config.contracts?.executor ?? config.manifest?.contracts?.executor?.address ?? null,
    assetIn: spend,
    amountIn: order.inputAmount ?? null,
    orderKind: converts ? "market" : "direct",
    status: record?.settlement?.transactionHash ? "settled" : "open",
    settled: Boolean(record?.settlement?.transactionHash),
  };
}

/**
 * The chain's own answer for one id, as the card. The order's KIND is what decides whether this is
 * a conversion — not a comparison of the two asset addresses. A market order is routed through the
 * pool whatever it is denominated in, so `kind` is the honest signal; comparing addresses would
 * quietly drop the Uniswap attribution from a market order that happens to name one asset twice.
 */
function cardFromRead(config, read) {
  const o = read.order;
  const spend = read.assetIn ? { ...(assetOf(config, read.assetIn.address) ?? {}), ...read.assetIn } : null;
  const receive = read.assetOut ? { ...(assetOf(config, read.assetOut.address) ?? {}), ...read.assetOut } : null;
  const converts = read.kind === "market";
  const priceChecked = Boolean(config.manifest?.market?.oracle?.enabled) && converts;
  const fallback = businessIdentity(config);
  const b = read.business ?? null;
  const label = b?.label ?? (b?.name ? String(b.name).split(".")[0] : null);
  // The money arrives at the business's payout wallet; the order's recipient is the same address
  // on a well-formed order, and is what we fall back to when the business could not be read.
  const identity = b
    ? { payName: b.name ?? null, label, display: displayName(label), address: b.payout ?? o.recipient ?? null, node: b.merchantNode ?? null, badge: fallback.badge }
    : { ...fallback, address: o.recipient ?? fallback.address };
  const status = orderStatusOf(o.status);
  const settled = status === "settled";
  return {
    kind: "order",
    id: read.orderId ?? null,
    identity,
    line: { what: identity.display, amount: amountText(o.amountIn, spend) },
    total: amountText(o.amountIn, spend),
    pay: { asset: spend, text: amountText(o.amountIn, spend) },
    receive: { asset: receive, text: amountText(o.minOut, receive) },
    converts,
    priceChecked,
    integration: integrationForCheckout({ converts, priceChecked, payName: identity.payName }),
    payer: o.payer ?? null,
    expiry: o.deadline !== undefined && o.deadline !== null ? Number(o.deadline) : null,
    settledTx: null,
    settled,
    status,
    orderKind: read.kind ?? null,
    settler: read.settler ?? null,
    assetIn: spend,
    amountIn: o.amountIn ?? null,
  };
}

/** How long one period covers, in the words a person uses for it. Whole days, or hours below one. */
export function periodText(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const days = Math.round(n / 86400);
  if (days >= 1) return days === 1 ? "1 day" : `${days} days`;
  const hours = Math.round(n / 3600);
  if (hours >= 1) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${n} seconds`;
}

/** What kind of thing this is, said the way a buyer needs to hear it before pressing pay. */
export function productKindText(product = {}) {
  const kind = String(product.kind ?? "").toLowerCase();
  if (kind === "recurring") {
    const p = periodText(product.period);
    return p ? `Renews every ${p}` : "Renews each period";
  }
  if (kind === "permanent") return "Anyone can buy";
  if (kind === "one-off") return product.onlyBuyer && product.onlyBuyer !== ZERO ? "One-off, for one buyer" : "One-off";
  return "Not known";
}

/**
 * One catalogue product as a card. The price is shown at the product's own decimals, which the
 * catalogue endpoint reads from the asset itself; an unlabelled asset shows no price rather than a
 * wrong one.
 */
export function productCard(product, config = {}) {
  if (!product) return null;
  const asset = {
    address: product.asset ?? null,
    symbol: product.symbol ?? assetOf(config, product.asset)?.symbol ?? null,
    decimals: Number.isInteger(product.decimals) ? product.decimals : assetOf(config, product.asset)?.decimals ?? null,
  };
  const priced = Number.isInteger(asset.decimals) && Boolean(asset.symbol);
  const identity = businessIdentity(config);
  return {
    kind: "product",
    id: String(product.id),
    name: product.name ?? null,
    identity,
    line: { what: product.name ?? null, amount: priced ? amountText(product.price, asset) : null },
    total: priced ? amountText(product.price, asset) : null,
    pay: { asset, text: priced ? amountText(product.price, asset) : null },
    receive: { asset, text: priced ? amountText(product.price, asset) : null },
    converts: false,
    priceChecked: false,
    integration: integrationForCheckout({ converts: false, priceChecked: false, payName: identity.payName }),
    kindText: productKindText(product),
    productKind: String(product.kind ?? "").toLowerCase(),
    active: product.active !== false,
    sold: Boolean(product.sold),
    onlyBuyer: product.onlyBuyer && product.onlyBuyer !== ZERO ? product.onlyBuyer : null,
    seller: product.seller ?? null,
    payout: product.payout ?? null,
    link: null,
  };
}

/** A whole shop: the business, and every product it is currently selling. Sold-out ones are gone. */
export function shopCard(catalog, config = {}) {
  const identity = businessIdentity(config);
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  const open = products.filter((p) => p.active !== false && !(String(p.kind).toLowerCase() === "one-off" && p.sold));
  return {
    kind: "business",
    seller: catalog?.seller ?? null,
    identity,
    products: open.map((p) => productCard(p, config)).filter(Boolean),
    integration: integrationForCheckout({ converts: false, priceChecked: false, payName: identity.payName }),
  };
}

// ---- what a payment is allowed to be called ------------------------------------------------------

/**
 * The verdict vocabulary, and the only branch that says Paid. A decision nobody has read yet is
 * "Checking" — not Paid, and not Refused either, because a check that has not run is not a failure.
 */
export function verdict(decision) {
  const d = decision === null || decision === undefined ? "" : String(decision).toUpperCase();
  if (d === "VERIFIED") return { status: "verified", word: "Paid", mark: "\u2713" };
  if (d === "REFUSED") return { status: "refused", word: "Refused", mark: "\u2715" };
  if (d === "UNKNOWN") return { status: "unknown", word: "Unknown", mark: "?" };
  return { status: "pending", word: "Checking", mark: "\u25d0" };
}

/**
 * What the CHECKOUT says about the order in front of the person, in one sentence each.
 *
 * The order of these branches is the whole point. A decision that was actually reached — VERIFIED
 * or REFUSED — outranks the clock, because an order paid inside its deadline must keep reading
 * "Paid" a minute later when the deadline passes; letting expiry win would turn a settled payment
 * into "Expired" and send somebody to pay it twice. Only once no decision has been reached does an
 * expired deadline matter, and only then does an order the chain says is still open invite a
 * payment. Anything else is "Checking", because a check that has not answered is not a refusal.
 */
export function checkoutVerdict({ evidence = null, expiry = null, now = Math.floor(Date.now() / 1000) } = {}) {
  const decision = evidence?.decision === null || evidence?.decision === undefined ? "" : String(evidence.decision).toUpperCase();
  if (decision === "VERIFIED") return { status: "verified", word: "Paid", payable: false };
  if (decision === "REFUSED") return { status: "refused", word: "Refused", payable: false };
  const expired = expiry !== null && expiry !== undefined && Number.isFinite(Number(expiry)) && Number(now) >= Number(expiry);
  if (expired) return { status: "expired", word: "Expired", payable: false };
  const codes = (Array.isArray(evidence?.reasonCodes) ? evidence.reasonCodes : []).map((c) => String(c).toUpperCase());
  if (decision === "UNKNOWN" && codes.includes("ORDER_OPEN")) {
    return { status: "waiting", word: "Waiting for your payment", payable: true };
  }
  return { status: "pending", word: "Checking", payable: false };
}

/** The one sentence shown when the companion has no such order. A link is a claim; this is the answer. */
export const NOT_FOUND_TEXT = "This payment could not be found.";

/** The verdict for one payment out of /local/payments, matched on its transaction or its sale. */
export function verdictFromPayments(payments, { tx = null, orderId = null } = {}) {
  const list = Array.isArray(payments) ? payments : [];
  const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  const hit = list.find((p) => (tx && same(p.transactionHash, tx)) || (orderId && same(p.orderId, orderId))) ?? null;
  return { payment: hit, ...verdict(hit?.decision ?? null) };
}

// ---- The Graph panel ------------------------------------------------------------------------------

/**
 * Three states, and the screen never blurs them. An index that answered with this receipt is the
 * only one that may say indexed, and it is the only one that may wear the colour. An index that
 * answered with nothing, and a deployment that names no index at all, both say so plainly. An
 * index that could not be reached says THAT, because "not indexed yet" would be a claim about the
 * index rather than about the attempt.
 */
export function graphPanel({ url = null, rows = null, failed = false } = {}) {
  if (!url) return { state: "none", text: "Not indexed yet", colour: false };
  if (failed) return { state: "unreachable", text: "The index did not answer", colour: false };
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { state: "empty", text: "Not indexed yet", colour: false };
  return { state: "indexed", text: "Indexed by The Graph", colour: true, rows: list };
}

/** The query one receipt is looked up with. Written here so the panel and its test ask the same. */
export function graphQueryFor({ tx = null, saleId = null } = {}) {
  if (saleId) {
    return {
      query: "query Sale($id: ID!) { productSale(id: $id) { id amount asset buyer settledAt transactionHash } }",
      variables: { id: String(saleId).toLowerCase() },
      field: "productSale",
    };
  }
  if (tx) {
    return {
      query: "query Settlements($tx: Bytes!) { settlements(where: { transactionHash: $tx }, first: 5) { id amount asset payer settledAt transactionHash } }",
      variables: { tx: String(tx).toLowerCase() },
      field: "settlements",
    };
  }
  return null;
}

/** Rows out of whatever the index answered, or null when it did not answer at all. */
export function graphRowsFrom(body, field) {
  const data = body?.data ?? null;
  if (!data || !field || !(field in data)) return null;
  const value = data[field];
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// ---- dates ---------------------------------------------------------------------------------------

/** A network timestamp as a person reads it. An absent time is named, never shown as the epoch. */
export function whenText(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "Not recorded";
  return new Date(n * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** The date a recurring buyer is covered to. Only ever shown when the chain answered with one. */
export function paidThroughText(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `Paid through ${new Date(n * 1000).toISOString().slice(0, 10)}`;
}

/** An address as a person checks it: the first six and the last four, never the whole line. */
export function shortAddress(value) {
  const s = String(value ?? "");
  if (!ADDRESS.test(s)) return s || "—";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
