// The customer's two screens, asserted without a browser, a chain or a server.
//
// WHAT THIS FILE IS FOR. Everything a customer reads at /pay/ and /receipt/ is shaped by pure
// functions in apps/web/assets/storefront.js, so the card that a person will actually see can be
// checked here rather than by looking at it. The three links — an order, a catalogue product, a
// whole shop — go through the same shaping, and the rows below are what stops them drifting apart.
//
// AND FOR THE THINGS A SHAPE CANNOT PROVE. The last two sections read the BUILT documents: that the
// screens carry one integration mark each and start with all of them hidden, that the verdict pill
// starts at Checking and never at Paid, and that neither screen says a word this product does not
// use. A shaping test alone would pass while the page said something else.
//
// Offline. No network, no chain, no wallet.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ADDRESS,
  businessIdentity,
  orderCardFromRead,
  displayName,
  explorerTxLink,
  graphPanel,
  graphQueryFor,
  graphRowsFrom,
  integrationForCheckout,
  integrationForReceipt,
  orderCard,
  orderCardFromRead,
  paidThroughText,
  payLink,
  periodText,
  productCard,
  productKindText,
  readPayTarget,
  receiptLink,
  shopCard,
  shortAddress,
  verdict,
  verdictFromPayments,
  whenText,
} from "../assets/storefront.js";
import { INTEGRATIONS, contrastRatio } from "../assets/brand.js";
import { encodeCall } from "../assets/abi.js";
import { PILL_STATES } from "../src/components.mjs";
import { findPayment, readLink } from "../assets/receipt.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");

// ---- fixtures. The shapes the companion serves, written from the endpoint contract ---------------

const ORDER_ID = "0x9c2e8dee73a661f4395ea47006dde95bad7c99ed81501c309a2b6b0351930761";
const SALE_ID = "0x5d5800ebbd8d7714e7170b0cc722a18d856a5fc3798d2e6da44b4b32a952e241";
const TX_HASH = "0x6195d692c81b224d59c26c395c1e9ccd2eb3e4ee2a9de12d9b2acca4c295b770";
const MERCHANT_NODE = "0xf20516307d58ce944ff8836b2f4327b03d3ff731d4451487b4377784ecf7bb12"; // bytes32 name node
const SPEND = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const PAYOUT = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const SHOP = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const SELLER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BUYER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const assets = [
  { key: "payoutToken", role: "payout", address: PAYOUT, symbol: "uUSD", decimals: 6, labelled: true },
  { key: "assetToken", role: "customer", address: SPEND, symbol: "tAST", decimals: 18, labelled: true },
];

/** A deployment that converts: the customer spends one asset, the business receives another. */
const converting = () => ({
  rpc: "/local/rpc",
  chainId: 31337,
  assets,
  identityToken: "0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44",
  contracts: { executor: "0x8562a445A32131bede8832fA66De2cc07fC83A6A", productCatalog: "0xa82fF9aFd8f496c3d6ac40E2a0F282E47488CFc9" },
  manifest: {
    chainId: 31337,
    identity: { merchantName: "fresh-cuts.unica.eth", merchantNode: MERCHANT_NODE, tokenId: "1" },
    market: { oracle: { enabled: true } },
    explorer: { url: "https://explorer.invalid" },
  },
  record: {
    merchant: { name: "fresh-cuts.unica.eth", address: SHOP },
    order: {
      id: ORDER_ID,
      payer: BUYER,
      inputAsset: SPEND,
      outputAsset: PAYOUT,
      inputAmount: "1000000000000000000",
      minimumOutput: "1950000",
      expiry: "1789086612",
    },
    settlement: { transactionHash: TX_HASH },
  },
});

/** The same deployment taking the asset it is paid out in: no conversion, and no price check. */
const sameAsset = () => {
  const config = converting();
  config.record.order.inputAsset = PAYOUT;
  config.record.order.inputAmount = "2500000";
  return config;
};

const product = (over = {}) => ({
  id: "1",
  name: "Haircut",
  asset: PAYOUT,
  symbol: "uUSD",
  decimals: 6,
  price: "25000000",
  kind: "permanent",
  period: "0",
  payout: SHOP,
  onlyBuyer: "0x0000000000000000000000000000000000000000",
  active: true,
  sold: false,
  seller: SELLER,
  ...over,
});

// ---- the three links ------------------------------------------------------------------------------

test("a payment link is read as an order, a product or a shop", () => {
  assert.equal(readPayTarget(`?order=${ORDER_ID}`).kind, "order");
  assert.equal(readPayTarget("?product=7").kind, "product");
  assert.equal(readPayTarget(`?business=${SHOP}`).kind, "business");
  assert.equal(readPayTarget("").kind, null);
});

test("a near-miss identifier is refused, never rounded into a lookup", () => {
  const short = readPayTarget("?order=0x1234");
  assert.equal(short.kind, null);
  assert.equal(short.malformed, true);
  assert.equal(readPayTarget("?product=one").malformed, true);
  assert.equal(readPayTarget("?business=0xnothex").malformed, true);
});

test("an empty link is not malformed: it is simply a page nobody asked anything of", () => {
  assert.equal(readPayTarget("").malformed, false);
});

test("payLink writes exactly the three shapes the product publishes", () => {
  assert.equal(payLink("https://unica.example", { order: ORDER_ID }), `https://unica.example/pay/?order=${ORDER_ID}`);
  assert.equal(payLink("https://unica.example/", { product: 12 }), "https://unica.example/pay/?product=12");
  assert.equal(payLink("https://unica.example", { business: SHOP }), `https://unica.example/pay/?business=${SHOP}`);
});

test("payLink refuses an identifier it would otherwise publish as a working link", () => {
  assert.throws(() => payLink("https://unica.example", { order: "0xnope" }));
  assert.throws(() => payLink("https://unica.example", { business: "not-an-address" }));
  assert.throws(() => payLink("https://unica.example", {}));
});

test("receiptLink carries the network and the transaction, or the sale", () => {
  assert.equal(receiptLink("https://u.example", { chainId: 31337, tx: TX_HASH }), `https://u.example/receipt/?chain=31337&tx=${TX_HASH}`);
  assert.equal(receiptLink("https://u.example", { chainId: 31337, saleId: SALE_ID }), `https://u.example/receipt/?chain=31337&sale=${SALE_ID}`);
  assert.throws(() => receiptLink("https://u.example", { chainId: 31337 }));
});

test("the receipt route reads chain, transaction and sale out of its own link", () => {
  const link = readLink(`?chain=31337&tx=${TX_HASH}`);
  assert.equal(link.chainId, 31337);
  assert.equal(link.tx, TX_HASH);
  assert.equal(readLink(`?sale=${SALE_ID}`).saleId, SALE_ID);
  assert.equal(readLink("?tx=0x00").malformed, true);
});

test("an explorer link is built only from an explorer the deployment named", () => {
  assert.equal(explorerTxLink({ explorer: { url: "https://explorer.invalid/" } }, TX_HASH), `https://explorer.invalid/tx/${TX_HASH}`);
  assert.equal(explorerTxLink({}, TX_HASH), null);
  assert.equal(explorerTxLink({ explorer: { url: "https://explorer.invalid" } }, null), null);
});

// ---- who is being paid -------------------------------------------------------------------------

test("the business identity comes off the chain's own record, not off the link", () => {
  const id = businessIdentity(converting());
  assert.equal(id.payName, "fresh-cuts.unica.eth");
  assert.equal(id.display, "Fresh Cuts");
  assert.equal(id.address, SHOP);
  assert.equal(id.node, MERCHANT_NODE);
  assert.deepEqual(id.badge, { address: "0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44", tokenId: "1" });
});

test("a deployment with no identity token offers no badge to read, rather than a broken one", () => {
  const config = converting();
  delete config.identityToken;
  assert.equal(businessIdentity(config).badge, null);
});

test("a business with no name at all is named, not invented", () => {
  assert.equal(displayName(""), "This business");
  assert.equal(displayName("freshcuts"), "Freshcuts");
});

test("an address is shortened the same way everywhere it is read aloud", () => {
  assert.equal(shortAddress(SHOP), "0x3C44…93BC");
  assert.equal(shortAddress(null), "—");
  assert.ok(ADDRESS.test(SHOP));
});

// ---- the order card ------------------------------------------------------------------------------

test("an order card carries one line, one total and both sides of the payment, at each asset's own decimals", () => {
  const card = orderCard(converting());
  assert.equal(card.kind, "order");
  assert.equal(card.total, "1 tAST");
  assert.equal(card.pay.text, "1 tAST");
  assert.equal(card.receive.text, "1.95 uUSD");
  assert.equal(card.line.what, "Fresh Cuts");
});

test("a converting order says so; a same-asset order does not", () => {
  assert.equal(orderCard(converting()).converts, true);
  assert.equal(orderCard(sameAsset()).converts, false);
});

test("the price check is claimed only when the deployment's market actually carries one", () => {
  assert.equal(orderCard(converting()).priceChecked, true);
  const noOracle = converting();
  noOracle.manifest.market.oracle.enabled = false;
  assert.equal(orderCard(noOracle).priceChecked, false);
  assert.equal(orderCard(sameAsset()).priceChecked, false);
});

test("an order nobody has read is no card at all, never a card of zeros", () => {
  assert.equal(orderCard({}), null);
  assert.equal(orderCard({ record: {} }), null);
});

test("an amount in an asset this deployment cannot label is never printed as if it were labelled", () => {
  const config = converting();
  config.assets = [];
  const card = orderCard(config);
  assert.equal(card.total, "1000000000000000000");
});

// ---- the product card ------------------------------------------------------------------------------

test("the three product kinds say what a buyer needs to hear before pressing pay", () => {
  assert.equal(productKindText(product()), "Anyone can buy");
  assert.equal(productKindText(product({ kind: "one-off" })), "One-off");
  assert.equal(productKindText(product({ kind: "one-off", onlyBuyer: BUYER })), "One-off, for one buyer");
  assert.equal(productKindText(product({ kind: "recurring", period: "2592000" })), "Renews every 30 days");
  assert.equal(productKindText({}), "Not known");
});

test("a period is read in the units a person uses for it", () => {
  assert.equal(periodText("86400"), "1 day");
  assert.equal(periodText("2592000"), "30 days");
  assert.equal(periodText("3600"), "1 hour");
  assert.equal(periodText("0"), null);
});

test("a product card prices at the product's own decimals and never converts", () => {
  const card = productCard(product(), converting());
  assert.equal(card.total, "25 uUSD");
  assert.equal(card.pay.text, "25 uUSD");
  assert.equal(card.receive.text, "25 uUSD");
  assert.equal(card.converts, false);
  assert.equal(card.priceChecked, false);
  assert.equal(card.line.what, "Haircut");
});

test("a product whose asset says neither symbol nor decimals shows no price at all", () => {
  const card = productCard(product({ symbol: null, decimals: null, asset: "0x0000000000000000000000000000000000000009" }), converting());
  assert.equal(card.total, null);
  assert.equal(card.pay.text, null);
});

test("paid through is only ever the date the chain answered with", () => {
  assert.equal(paidThroughText(1789086612), "Paid through 2026-09-11");
  assert.equal(paidThroughText(0), null);
  assert.equal(paidThroughText(null), null);
});

// ---- the shop --------------------------------------------------------------------------------------

test("a shop lists what is on sale and nothing else", () => {
  const catalog = {
    seller: SELLER,
    products: [
      product(),
      product({ id: "2", name: "Monthly membership", kind: "recurring", period: "2592000", price: "40000000" }),
      product({ id: "3", name: "Old chair", kind: "one-off", sold: true }),
      product({ id: "4", name: "Withdrawn", active: false }),
    ],
  };
  const shop = shopCard(catalog, converting());
  assert.deepEqual(
    shop.products.map((p) => p.name),
    ["Haircut", "Monthly membership"],
  );
  assert.equal(shop.products[1].kindText, "Renews every 30 days");
  assert.equal(shop.seller, SELLER);
});

test("a shop with nothing listed is an empty shop, never a shop of examples", () => {
  assert.deepEqual(shopCard({ seller: SELLER, products: [] }, converting()).products, []);
  assert.deepEqual(shopCard(null, converting()).products, []);
});

// ---- the verdict vocabulary ------------------------------------------------------------------------

test("Paid comes from VERIFIED and from nothing else", () => {
  assert.deepEqual(verdict("VERIFIED"), { status: "verified", word: "Paid", mark: "✓" });
  assert.equal(verdict("REFUSED").word, "Refused");
  assert.equal(verdict("UNKNOWN").word, "Unknown");
  assert.equal(verdict(null).word, "Checking");
  assert.equal(verdict(undefined).word, "Checking");
  assert.equal(verdict("anything else").word, "Checking");
});

test("a check that has not run is neither a pass nor a failure", () => {
  assert.equal(verdict(null).status, "pending");
  assert.notEqual(verdict(null).status, "verified");
  assert.notEqual(verdict(null).status, "refused");
});

test("every verdict names a pill state the product already has, with that state's own mark", () => {
  for (const decision of ["VERIFIED", "REFUSED", "UNKNOWN", null]) {
    const spoken = verdict(decision);
    assert.ok(Object.prototype.hasOwnProperty.call(PILL_STATES, spoken.status), spoken.status);
    assert.equal(spoken.mark, PILL_STATES[spoken.status][0]);
  }
});

test("a sale's verdict is read off the payments the business was actually paid", () => {
  const payments = [
    { kind: "product", orderId: SALE_ID, transactionHash: TX_HASH, decision: "VERIFIED", reasonCodes: [] },
    { kind: "direct", orderId: ORDER_ID, transactionHash: "0x" + "1".repeat(64), decision: "REFUSED", reasonCodes: ["UNREGISTERED_EMITTER"] },
  ];
  assert.equal(verdictFromPayments(payments, { tx: TX_HASH }).word, "Paid");
  assert.equal(verdictFromPayments(payments, { orderId: ORDER_ID }).word, "Refused");
  assert.equal(verdictFromPayments(payments, { tx: "0x" + "9".repeat(64) }).word, "Checking");
  assert.equal(verdictFromPayments(null, { tx: TX_HASH }).word, "Checking");
});

test("the receipt finds its own payment by transaction or by sale, and nothing else", () => {
  const answer = { payments: [{ kind: "product", orderId: SALE_ID, transactionHash: TX_HASH, decision: "VERIFIED" }] };
  assert.equal(findPayment(answer, { tx: TX_HASH })?.orderId, SALE_ID);
  assert.equal(findPayment(answer, { saleId: SALE_ID })?.transactionHash, TX_HASH);
  assert.equal(findPayment(answer, { tx: null, saleId: null }), null);
  assert.equal(findPayment({ payments: [] }, { tx: TX_HASH }), null);
});

test("a time nobody recorded is named, never shown as the epoch", () => {
  assert.equal(whenText(0), "Not recorded");
  assert.equal(whenText(null), "Not recorded");
  assert.equal(whenText(1789084815), "2026-09-11 00:00:15 UTC");
});

// ---- the index panel, in its three states plus the one that is not an answer ----------------------

test("an index that answered with this receipt is the only state that claims an index", () => {
  const panel = graphPanel({ url: "https://index.invalid", rows: [{ id: SALE_ID }] });
  assert.equal(panel.state, "indexed");
  assert.equal(panel.text, "Indexed by The Graph");
  assert.equal(panel.colour, true);
});

test("an index that answered with nothing says so, and wears no colour", () => {
  const panel = graphPanel({ url: "https://index.invalid", rows: [] });
  assert.equal(panel.state, "empty");
  assert.equal(panel.text, "Not indexed yet");
  assert.equal(panel.colour, false);
});

test("a deployment that names no index says so, and asks nothing", () => {
  const panel = graphPanel({ url: null });
  assert.equal(panel.state, "none");
  assert.equal(panel.text, "Not indexed yet");
  assert.equal(panel.colour, false);
});

test("an index that could not be reached is a different fact from an index holding nothing", () => {
  const unreachable = graphPanel({ url: "https://index.invalid", failed: true });
  const empty = graphPanel({ url: "https://index.invalid", rows: [] });
  assert.equal(unreachable.state, "unreachable");
  assert.equal(unreachable.text, "The index did not answer");
  assert.notEqual(unreachable.text, empty.text);
  assert.equal(unreachable.colour, false);
});

test("rows are read out of the field that was asked for, and a missing field is not an empty answer", () => {
  const ask = graphQueryFor({ saleId: SALE_ID });
  assert.equal(ask.field, "productSale");
  assert.equal(ask.variables.id, SALE_ID.toLowerCase());
  assert.deepEqual(graphRowsFrom({ data: { productSale: { id: SALE_ID } } }, "productSale"), [{ id: SALE_ID }]);
  assert.deepEqual(graphRowsFrom({ data: { productSale: null } }, "productSale"), []);
  assert.equal(graphRowsFrom({ errors: [{ message: "boom" }] }, "productSale"), null);
  assert.equal(graphRowsFrom({}, "productSale"), null);
});

test("a receipt with neither a transaction nor a sale asks the index nothing", () => {
  assert.equal(graphQueryFor({}), null);
  assert.equal(graphQueryFor({ tx: TX_HASH }).field, "settlements");
});

// ---- one integration colour per view ---------------------------------------------------------------

test("the checkout wears the mark closest to what changes the amount, and only one", () => {
  assert.equal(integrationForCheckout({ converts: true, priceChecked: true, payName: "x.eth" }), "uniswap");
  assert.equal(integrationForCheckout({ converts: false, priceChecked: true, payName: "x.eth" }), "chainlink");
  assert.equal(integrationForCheckout({ converts: false, priceChecked: false, payName: "x.eth" }), "ens");
  assert.equal(integrationForCheckout({}), null);
});

test("the receipt wears The Graph when the index answered, and the name otherwise", () => {
  assert.equal(integrationForReceipt({ indexed: true, payName: "x.eth" }), "graph");
  assert.equal(integrationForReceipt({ indexed: false, payName: "x.eth" }), "ens");
  assert.equal(integrationForReceipt({}), null);
});

test("each card names exactly one integration, so two can never be on screen at once", () => {
  assert.equal(orderCard(converting()).integration, "uniswap");
  assert.equal(orderCard(sameAsset()).integration, "ens");
  assert.equal(productCard(product(), converting()).integration, "ens");
});

// ---- the catalogue calls this screen sends -----------------------------------------------------------
//
// The four selectors below were produced independently, by `cast sig`, and are pinned here so a
// change to the encoder cannot quietly start sending a different function. A buy that lands on the
// wrong selector is a transaction that either reverts or does something nobody agreed to.

test("the calls the checkout sends carry the selectors the catalogue interface declares", () => {
  assert.equal(encodeCall("buy(uint256)", ["1"]).slice(0, 10), "0xd96a094a");
  assert.equal(encodeCall("allowance(address,address)", [BUYER, SHOP]).slice(0, 10), "0xdd62ed3e");
  assert.equal(encodeCall("tokenURI(uint256)", ["1"]).slice(0, 10), "0xc87b56dd");
  assert.equal(encodeCall("paidThrough(uint256,address)", ["2", BUYER]).slice(0, 10), "0x5c7f43bf");
});

test("buy(1) is the selector and one 32-byte word, and nothing else", () => {
  assert.equal(encodeCall("buy(uint256)", ["1"]), "0xd96a094a" + "0".repeat(63) + "1");
});

test("control: a different product id produces different calldata", () => {
  assert.notEqual(encodeCall("buy(uint256)", ["1"]), encodeCall("buy(uint256)", ["2"]));
});

// ---- colour, measured rather than believed ----------------------------------------------------------

const css = readFileSync(join(APP, "assets", "screens", "checkout.css"), "utf8");
const brandCss = readFileSync(join(APP, "assets", "unica.css"), "utf8");

/** srgb mix, the way `color-mix(in srgb, ink N%, paper)` computes --surface. */
function mix(inkHex, paperHex, inkPercent) {
  const c = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ir, ig, ib] = c(inkHex);
  const [pr, pg, pb] = c(paperHex);
  const w = inkPercent / 100;
  const one = (a, b) => Math.round(a * w + b * (1 - w));
  return "#" + [one(ir, pr), one(ig, pg), one(ib, pb)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

const inks = [...brandCss.matchAll(/--ink:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
const papers = [...brandCss.matchAll(/--paper:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);

test("the stylesheet still declares both schemes, or the arithmetic below is measuring one thing twice", () => {
  assert.ok(inks.length >= 2, `--ink declared ${inks.length} times`);
  assert.ok(papers.length >= 2, `--paper declared ${papers.length} times`);
  assert.notEqual(inks[0], inks[1]);
  assert.notEqual(papers[0], papers[1]);
});

test("the integration pill's own text clears 4.5:1 in both schemes", () => {
  for (const scheme of [0, 1]) {
    const surface = mix(inks[scheme], papers[scheme], 5);
    const ratio = contrastRatio(inks[scheme], surface);
    assert.ok(ratio >= 4.5, `${scheme === 0 ? "light" : "dark"}: ink on surface is ${ratio.toFixed(2)}:1`);
  }
});

test("control: the contrast arithmetic fails a pair that should fail", () => {
  assert.ok(contrastRatio("#777777", "#808080") < 4.5);
});

test("every integration rule in this screen's stylesheet is that integration's own colour, unaltered", () => {
  for (const [key, integration] of Object.entries(INTEGRATIONS)) {
    const declared = new RegExp(`\\.int\\[data-int="${key}"\\]\\s*\\{\\s*--int:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    assert.ok(declared, `no rule for ${key}`);
    assert.equal(declared[1].toUpperCase(), integration.colour.toUpperCase());
  }
});

test("the pill's colour is a 3px rule and never a background, so nothing depends on reading it", () => {
  assert.match(css, /\.int\s*\{[^}]*border-left:\s*3px solid var\(--int/);
  assert.doesNotMatch(css, /\.int\[data-int="[a-z]+"\]\s*\{[^}]*background/);
});

// ---- the built screens --------------------------------------------------------------------------

const OUT = mkdtempSync(join(tmpdir(), "unica-checkout-"));
execFileSync(process.execPath, [join(APP, "build.mjs")], { encoding: "utf8", env: { ...process.env, UNICA_BUILD_OUT: OUT } });
const payDoc = readFileSync(join(OUT, "pay", "index.html"), "utf8");
const receiptDoc = readFileSync(join(OUT, "receipt", "index.html"), "utf8");

/** Only what a person reads: no head, no script, no tags. */
const visible = (doc) =>
  doc
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ");

test("both screens load this screen's own stylesheet, and neither edits the shared one", () => {
  assert.match(payDoc, /href="\.\.\/assets\/screens\/checkout\.css"/);
  assert.match(receiptDoc, /href="\.\.\/assets\/screens\/checkout\.css"/);
});

test("the checkout carries one mark per integration it may ever show, and every one starts hidden", () => {
  for (const key of ["ens", "uniswap", "chainlink"]) {
    const marks = [...payDoc.matchAll(new RegExp(`data-int="${key}"`, "g"))];
    assert.equal(marks.length, 1, `${key} appears ${marks.length} times`);
    assert.match(payDoc, new RegExp(`<span class="int" data-int="${key}"[^>]*hidden>`));
  }
  assert.equal([...payDoc.matchAll(/data-int="graph"/g)].length, 0);
});

test("each mark carries its integration's NAME, so the colour is never the thing that has to be read", () => {
  assert.match(payDoc, /data-int="uniswap"[^>]*>Uniswap</);
  assert.match(payDoc, /data-int="chainlink"[^>]*>Chainlink</);
  assert.match(payDoc, /data-int="ens"[^>]*>ENS</);
  assert.match(receiptDoc, /data-int="graph"[^>]*>The Graph</);
});

test("the receipt's index panel starts at its no-claim line, with the colour hidden", () => {
  assert.match(receiptDoc, /id="graph-line">Not indexed yet</);
  assert.match(receiptDoc, /<span class="int" data-int="graph" id="graph-mark" hidden>/);
});

test("the receipt's verdict starts at Checking, and the served document never says Paid", () => {
  assert.match(receiptDoc, /id="r-verdict"[^>]*>.*Checking/);
  assert.match(receiptDoc, /<span class="pill" data-status="pending" id="r-verdict"/);
  assert.doesNotMatch(visible(receiptDoc), /\bPaid\b/);
});

test("neither screen shows a figure nobody has read as anything but an em dash", () => {
  assert.doesNotMatch(visible(payDoc), /\b0\.00\b/);
  assert.match(payDoc, /id="co-total">—</);
  assert.match(receiptDoc, /id="r-amount">—</);
});

test("neither screen uses a word this product does not say to a customer", () => {
  const BANNED = /\b(demo|demos|demonstration|practice|fixture|rehearsal|storyboard|sample|example|examples)\b/i;
  for (const [name, doc] of [["pay", payDoc], ["receipt", receiptDoc]]) {
    const hit = BANNED.exec(visible(doc));
    assert.equal(hit, null, `${name} says "${hit?.[0]}"`);
  }
});

test("control: the banned-word check catches one that is planted", () => {
  assert.match(visible("<p>this is a demo record</p>"), /\bdemo\b/);
});

test("the checkout's one action is a single button that says why it is disabled", () => {
  const buttons = [...payDoc.matchAll(/<button[^>]*class="cta charge"[^>]*>/g)];
  assert.equal(buttons.length, 1);
  assert.match(payDoc, /<button type="button" class="cta charge" id="co-pay" disabled aria-describedby="co-why">Pay<\/button>/);
});

test("an order read by id becomes the same card, paid to the settler that holds it, for a same-asset and a converting sale", () => {
  const config = { assets: [], manifest: { market: { oracle: { enabled: false } } }, contracts: { executor: "0x00000000000000000000000000000000000000e0" } };
  const uusd = { address: "0x00000000000000000000000000000000000000a1", symbol: "uUSD", decimals: 6 };
  const tast = { address: "0x00000000000000000000000000000000000000a2", symbol: "tAST", decimals: 18 };
  const business = { label: "freshcuts", name: "freshcuts.unica.eth", owner: "0x70", payout: "0x3c", merchantNode: "0x" + "f2".repeat(32) };
  const direct = orderCardFromRead(config, { orderId: "0x" + "ab".repeat(32), kind: "direct", settler: "0x00000000000000000000000000000000000000d1", order: { recipient: "0x3c", payer: "0x90", amountIn: "1250000", minOut: "1250000", deadline: "1789242653", status: 1 }, assetIn: uusd, assetOut: uusd, business });
  assert.equal(direct.pay.text, "1.25 uUSD");
  assert.equal(direct.converts, false);
  assert.equal(direct.settler, "0x00000000000000000000000000000000000000d1");
  assert.equal(direct.assetIn.address, uusd.address);
  assert.equal(direct.amountIn, "1250000");
  assert.equal(direct.identity.payName, "freshcuts.unica.eth");
  assert.equal(direct.identity.display, "Freshcuts");
  assert.equal(direct.expiry, 1789242653);
  assert.equal(direct.settled, false);
  assert.equal(direct.integration, "ens");
  const market = orderCardFromRead(config, { orderId: "0x" + "cd".repeat(32), kind: "market", settler: "0x00000000000000000000000000000000000000e0", order: { recipient: "0x3c", payer: "0x90", amountIn: "1000000000000000000", minOut: "1980000", deadline: "1789242653", status: 3 }, assetIn: tast, assetOut: uusd, business: null });
  assert.equal(market.converts, true);
  assert.equal(market.integration, "uniswap");
  assert.equal(market.receive.text, "1.98 uUSD");
  assert.equal(market.settled, true);
  assert.equal(orderCardFromRead(config, null), null);
  assert.equal(orderCardFromRead(config, { orderId: "0x1", order: null }), null);
});
