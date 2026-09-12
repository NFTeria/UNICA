/**
 * The business admin, as rules rather than as pixels.
 *
 * Everything a shop owner ACTS on is decided by a pure function: which payments count as today's,
 * what the verification decision is called, what a row says, what a price reads as, what a filled-in
 * form means, and what bytes a wallet is asked to confirm. Each of those is exercised here against
 * the real function, offline — no browser, no chain, no wallet, no companion server.
 *
 * EVERY CALLDATA AND SELECTOR VECTOR BELOW WAS PRODUCED INDEPENDENTLY with `cast` 1.3.5
 * (`cast calldata`, `cast sig`) against the signatures in src/unica-v5/IProductCatalog.sol, before
 * this file existed. Comparing this repository's encoder with this repository's encoder would prove
 * only that it is self-consistent; comparing it with a different tool is what makes the row worth
 * running.
 *
 * AND EVERY MEASUREMENT HAS A CONTROL. A contrast floor that nothing can fail is decoration, so the
 * colour rows are asked to fail a pair that must fail before they are believed on a pair that
 * passes; the same for the machine-word rule and the day boundary.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  MARK_FLOOR,
  MARK_GROUND,
  currentScheme,
  decisionPill,
  graphMarkAllowed,
  integrationMark,
  kpiFromPayments,
  orderRows,
  payoutWalletFor,
  receiptHref,
  startOfDay,
  whenText,
} from "../assets/business.js";
import {
  KINDS,
  kindIndex,
  kindLabel,
  listCalldata,
  newProductPlan,
  periodDays,
  priceText,
  productLink,
  setActiveCalldata,
} from "../assets/products.js";
import { coverText, customersFrom } from "../assets/customers.js";
import { INTEGRATIONS, contrastRatio } from "../assets/brand.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");

const UUSD = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const TAST = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const PAYOUT_WALLET = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const SELLER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BUYER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const NOBODY = "0x0000000000000000000000000000000000000000";

// A day the arithmetic can be reasoned about by hand: 1789084800 is exactly midnight UTC.
const MIDNIGHT = 1789084800;

// ---- the day boundary ---------------------------------------------------------------------------

test("a day starts at midnight UTC and a second before it belongs to the day before", () => {
  assert.equal(startOfDay(MIDNIGHT), MIDNIGHT);
  assert.equal(startOfDay(MIDNIGHT + 86399), MIDNIGHT);
  assert.equal(startOfDay(MIDNIGHT - 1), MIDNIGHT - 86400);
});

test("a moment reads as today only when it is today, and always in UTC", () => {
  assert.equal(whenText(MIDNIGHT + 3600 * 14 + 120, MIDNIGHT), "Today, 14:02");
  assert.equal(whenText(MIDNIGHT - 1, MIDNIGHT), "10 Sep, 23:59");
  assert.equal(whenText(0, MIDNIGHT), "Not known");
  assert.equal(whenText(null, MIDNIGHT), "Not known");
  // control: the same instant read against a different day must NOT say "Today"
  assert.equal(whenText(MIDNIGHT + 3600 * 14 + 120, MIDNIGHT + 86400), "11 Sep, 14:02");
});

// ---- what a decision is called --------------------------------------------------------------------

test("only VERIFIED reads as Paid; the rest say which of four other things they are", () => {
  assert.deepEqual(decisionPill("VERIFIED"), { status: "verified", label: "Paid" });
  assert.deepEqual(decisionPill("REFUSED"), { status: "refused", label: "Refused" });
  assert.deepEqual(decisionPill("UNKNOWN"), { status: "unknown", label: "Not known" });
  assert.deepEqual(decisionPill("PENDING"), { status: "pending", label: "Checking" });
  // An order the customer has simply not paid yet is not a check that failed and not a check that
  // could not run. The projection names that state; the pill uses the word a person would.
  assert.deepEqual(decisionPill("UNKNOWN", ["ORDER_OPEN"]), { status: "pending", label: "Waiting" });
});

test("control: a different reason on the same decision does NOT become Waiting", () => {
  assert.deepEqual(decisionPill("UNKNOWN", ["NO_MATCHING_LOG"]), { status: "unknown", label: "Not known" });
  assert.deepEqual(decisionPill("UNKNOWN", []), { status: "unknown", label: "Not known" });
  // ...and a refused order keeps its refusal whatever else is said about it
  assert.equal(decisionPill("REFUSED", ["ORDER_OPEN"]).label, "Refused");
});

test("control: nothing else in the world becomes Paid, however it is spelled", () => {
  for (const said of [null, undefined, "", "verified ", "OK", "SUCCESS", "TRUE", "paid"]) {
    assert.notEqual(decisionPill(said).label, "Paid", `${JSON.stringify(said)} must not read as Paid`);
  }
  // ...and the one that should is still recognised whatever its case, or the row above proves nothing
  assert.equal(decisionPill("verified").label, "Paid");
});

// ---- today's figures --------------------------------------------------------------------------------

const PAYMENTS = [
  { kind: "direct", orderId: "0xaa", payer: BUYER, asset: UUSD, amount: "2500000", settledAt: MIDNIGHT + 60, decision: "VERIFIED", blockNumber: 64 },
  { kind: "market", orderId: "0xbb", payer: BUYER, asset: UUSD, amount: "1987612", settledAt: MIDNIGHT + 30, decision: "VERIFIED", blockNumber: 60 },
  { kind: "product", orderId: "0xcc", productId: "1", payer: SELLER, asset: TAST, amount: "5000", settledAt: MIDNIGHT + 90, decision: "VERIFIED", blockNumber: 66 },
  { kind: "direct", orderId: "0xdd", payer: BUYER, asset: UUSD, amount: "9999999", settledAt: MIDNIGHT + 10, decision: "REFUSED", blockNumber: 58 },
  { kind: "direct", orderId: "0xee", payer: BUYER, asset: UUSD, amount: "1000000", settledAt: MIDNIGHT - 5, decision: "VERIFIED", blockNumber: 40 },
];

test("today's total is the verified payments of today, in the payout asset, and nothing else", () => {
  const k = kpiFromPayments(PAYMENTS, MIDNIGHT + 3600, UUSD);
  assert.equal(k.verifiedToday, 3);
  assert.equal(k.totalToday, "4487612"); // 2500000 + 1987612; the refused one and yesterday's are out
  assert.equal(k.countedInTotal, 2);
  assert.equal(k.otherAssetsToday, 1); // the one paid in another asset is counted, never added in
  assert.equal(k.unresolvedToday, 1);
  assert.equal(k.last.orderId, "0xcc"); // the newest block, not the newest timestamp in the list order
});

test("control: a refused payment of today is never inside the total", () => {
  const onlyRefused = [{ asset: UUSD, amount: "9999999", settledAt: MIDNIGHT + 10, decision: "REFUSED", blockNumber: 1 }];
  const k = kpiFromPayments(onlyRefused, MIDNIGHT + 3600, UUSD);
  assert.equal(k.totalToday, "0");
  assert.equal(k.verifiedToday, 0);
  assert.equal(k.unresolvedToday, 1);
});

test("with no payout asset known there is no total at all, rather than a zero", () => {
  assert.equal(kpiFromPayments(PAYMENTS, MIDNIGHT + 3600, null).totalToday, null);
  assert.equal(kpiFromPayments([], MIDNIGHT, UUSD).totalToday, "0"); // a read that found nothing IS zero
  assert.equal(kpiFromPayments([], MIDNIGHT, UUSD).last, null);
});

// ---- the orders table ----------------------------------------------------------------------------

test("a row says what was bought when the catalogue named it, and Sale when nothing named it", () => {
  const rows = orderRows(PAYMENTS, { names: { 1: "Haircut" }, nowSeconds: MIDNIGHT + 3600 });
  assert.deepEqual(rows.map((r) => r.what), ["Sale", "Sale", "Haircut", "Sale", "Sale"]);
  assert.deepEqual(rows.map((r) => r.converted), [false, true, false, false, false]);
  assert.deepEqual(rows.map((r) => r.label), ["Paid", "Paid", "Paid", "Refused", "Paid"]);
  assert.equal(rows[0].from, "0x90F79b…b906");
  assert.equal(rows[4].when, "10 Sep, 23:59");
});

test("a catalogue sale nobody could name says Item, never a made-up description", () => {
  const rows = orderRows([{ kind: "product", productId: "7", decision: "VERIFIED" }], {});
  assert.equal(rows[0].what, "Item");
});

test("a receipt link carries the chain and the transaction, and is absent without one", () => {
  assert.equal(
    receiptHref("../../", 31337, "0x03d3384ab581805f830306766e95b0fbcc07110beb74c59be99ce6e4056df7a2"), // transaction hash
    "../../receipt/?chain=31337&tx=0x03d3384ab581805f830306766e95b0fbcc07110beb74c59be99ce6e4056df7a2", // transaction hash
  );
  assert.equal(receiptHref("../../", 31337, null), null);
  assert.equal(receiptHref("../../", null, "0xabc"), null);
  assert.equal(receiptHref("../../", 0, "0xabc"), null); // Number(null) is 0; chain zero is not a chain
});

test("the wallet the money arrives at is the business's payout wallet, and the signed-in one alone otherwise", () => {
  assert.equal(payoutWalletFor({ joined: true, payout: PAYOUT_WALLET }, { address: SELLER }), PAYOUT_WALLET);
  assert.equal(payoutWalletFor({ joined: false }, { address: SELLER }), SELLER);
  assert.equal(payoutWalletFor({ available: false, joined: false }, { address: SELLER }), SELLER);
  assert.equal(payoutWalletFor({ joined: true, payout: "not an address" }, { address: SELLER }), SELLER);
});

// ---- colour: one integration in a view, and a mark that can actually be seen -----------------------

const css = readFileSync(join(APP, "assets", "unica.css"), "utf8");

test("the grounds this file measures against are every --paper the stylesheet declares", () => {
  // FOUR blocks declare it, not two: the bare :root, the media query, and the two the viewer's own
  // pick stamps. A ground that moved in one of the pick blocks and nowhere else would leave every
  // colour computed here settled against a page that no longer exists.
  const block = (from) => css.slice(from, css.indexOf("}", from));
  const paper = (text) => text.match(/--paper:\s*([^;]+);/)[1].trim().toLowerCase();
  const darkMedia = css.indexOf(":root {", css.indexOf("@media (prefers-color-scheme: dark)"));
  const grounds = {
    light: [block(css.indexOf(":root {")), block(css.indexOf(':root[data-theme="light"]'))],
    dark: [block(darkMedia), block(css.indexOf(':root[data-theme="dark"]'))],
  };
  let counted = 0;
  for (const [scheme, blocks] of Object.entries(grounds)) {
    for (const text of blocks) {
      assert.equal(paper(text), MARK_GROUND[scheme].toLowerCase(), `a ${scheme} --paper has moved away from this file`);
      counted += 1;
    }
  }
  assert.equal(counted, 4); // a stated count: four declarations checked, none skipped
});

test("a scheme somebody picked outranks the one the machine prefers", () => {
  const prefersDark = { matchMedia: () => ({ matches: true }) };
  const prefersLight = { matchMedia: () => ({ matches: false }) };
  const picked = (value) => ({ getAttribute: () => value });
  assert.equal(currentScheme(prefersDark, picked("light")), "light");
  assert.equal(currentScheme(prefersLight, picked("dark")), "dark");
  // no pick, and the preference decides again — or the row above proves only that it is ignored
  assert.equal(currentScheme(prefersDark, picked(null)), "dark");
  assert.equal(currentScheme(prefersLight, picked(null)), "light");
  assert.equal(currentScheme(prefersDark, picked("sideways")), "dark"); // an unknown stamp is not a pick
  assert.equal(currentScheme({}, null), "light"); // nothing can be asked: the safe default, never a throw
});

test("every integration's mark clears the non-text floor in both schemes", () => {
  const measured = [];
  for (const key of Object.keys(INTEGRATIONS)) {
    for (const scheme of ["light", "dark"]) {
      const mark = integrationMark(key, scheme);
      const ratio = contrastRatio(mark.colour, MARK_GROUND[scheme]);
      measured.push(`${key}/${scheme} ${ratio.toFixed(2)}`);
      assert.ok(ratio >= MARK_FLOOR, `${key} in the ${scheme} scheme is only ${ratio.toFixed(2)}:1`);
    }
  }
  assert.equal(measured.length, 10); // a stated count: five integrations, two schemes, none skipped
});

test("the brand hex is kept wherever it can be seen, and moved only where it cannot", () => {
  // Measured against the light ground: Uniswap 3.67, The Graph 4.88, Chainlink 5.65 all clear the
  // floor and are used verbatim. ENS reaches 2.78 and Robinhood 2.19, so those two are settled.
  for (const key of ["uniswap", "graph", "chainlink"]) {
    assert.equal(integrationMark(key, "light").colour, INTEGRATIONS[key].colour, `${key} should not have been moved`);
  }
  for (const key of ["ens", "robinhood"]) {
    const mark = integrationMark(key, "light");
    assert.notEqual(mark.colour, INTEGRATIONS[key].colour, `${key} cannot be seen unmoved and must have been settled`);
    assert.ok(contrastRatio(INTEGRATIONS[key].colour, MARK_GROUND.light) < MARK_FLOOR, `${key} was moved for no reason`);
  }
  assert.equal(integrationMark("not-an-integration", "light"), null);
});

test("control: the floor is one a colour can genuinely fail", () => {
  assert.ok(contrastRatio("#fbfbfa", "#f0f0ef") < MARK_FLOOR, "two near-identical papers must fail");
  assert.ok(contrastRatio("#fbfbfa", "#14161a") >= MARK_FLOOR, "ink on paper must pass");
});

test("the orders view never carries two integration colours at once", () => {
  const converted = [{ converted: true }];
  const plain = [{ converted: false }];
  assert.equal(graphMarkAllowed({ graph: { url: "an index" } }, plain), true);
  assert.equal(graphMarkAllowed({ graph: { url: "an index" } }, converted), false);
  // ...and no index named means no claim that one exists, whatever is in the list
  assert.equal(graphMarkAllowed({}, plain), false);
  assert.equal(graphMarkAllowed({ graph: {} }, plain), false);
});

// ---- products: the words, the numbers and the links -------------------------------------------------

test("the three kinds are the catalogue's own three, in the catalogue's own order", () => {
  assert.deepEqual(KINDS.map(([k]) => k), ["one-off", "recurring", "permanent"]);
  assert.deepEqual([kindIndex("one-off"), kindIndex("recurring"), kindIndex("permanent")], [0, 1, 2]);
  assert.equal(kindIndex("subscription"), null);
  assert.equal(kindLabel("recurring"), "Recurring");
  assert.equal(kindLabel("nonsense"), "Not known");
});

test("a period is whole days or it is not shown as days at all", () => {
  assert.equal(periodDays(2592000), 30);
  assert.equal(periodDays(86400), 1);
  assert.equal(periodDays(0), null);
  assert.equal(periodDays(90000), null); // a day and a quarter is not "1 day", and never rounds to it
});

test("a price reads at the asset's own precision, or says it is a raw count", () => {
  assert.equal(priceText({ price: "25000000", symbol: "uUSD", decimals: 6 }), "25 uUSD");
  assert.equal(priceText({ price: "2500000", symbol: "uUSD", decimals: 6 }), "2.5 uUSD");
  assert.equal(priceText({ price: "25000000", symbol: null, decimals: null }), "25000000 base units");
  assert.equal(priceText({ price: null }), "Not known");
});

test("a product's payment link is exactly the shape the rest of the product spells", () => {
  assert.equal(productLink("https://example.test/unica/", 4), "https://example.test/unica/pay/?product=4");
  // A base path is honoured, because a payment link is handed to somebody else and has to be absolute.
  assert.equal(productLink("https://example.test/", 12), "https://example.test/pay/?product=12");
});

// ---- the new-product form ----------------------------------------------------------------------------

const FORM = { name: "Haircut", price: "25", kind: "one-off", asset: UUSD, payout: PAYOUT_WALLET, decimals: 6 };

test("a filled-in one-off becomes the seven arguments the catalogue takes", () => {
  const answer = newProductPlan(FORM);
  assert.deepEqual(answer.plan, { name: "Haircut", asset: UUSD, price: "25000000", kindIndex: 0, period: 0, payout: PAYOUT_WALLET, onlyBuyer: NOBODY });
});

test("a recurring product must say how long one payment covers, in whole days", () => {
  assert.equal(newProductPlan({ ...FORM, kind: "recurring" }).ok, false);
  assert.equal(newProductPlan({ ...FORM, kind: "recurring", days: "0" }).ok, false);
  assert.equal(newProductPlan({ ...FORM, kind: "recurring", days: "1.5" }).ok, false);
  assert.equal(newProductPlan({ ...FORM, kind: "recurring", days: "30" }).plan.period, 2592000);
});

test("the two rules only the contract knows are enforced at the keyboard", () => {
  const period = newProductPlan({ ...FORM, kind: "permanent", days: "30" });
  assert.equal(period.ok, false);
  assert.match(period.error, /Only a recurring product/);
  const reserved = newProductPlan({ ...FORM, kind: "permanent", onlyBuyer: BUYER });
  assert.equal(reserved.ok, false);
  assert.match(reserved.error, /Only a one-off/);
  assert.equal(newProductPlan({ ...FORM, onlyBuyer: BUYER }).plan.onlyBuyer, BUYER);
});

test("a form that means nothing yet says so, once, in words a person can act on", () => {
  const rows = [
    [{ ...FORM, name: "  " }, /name/i],
    [{ ...FORM, name: "x".repeat(65) }, /64/],
    [{ ...FORM, kind: "" }, /kind/i],
    [{ ...FORM, price: "0" }, /above zero/],
    [{ ...FORM, price: "12.3456789" }, /decimal places/],
    [{ ...FORM, price: "free" }, /digits/],
    [{ ...FORM, onlyBuyer: "0xnope" }, /forty/],
    [{ ...FORM, asset: null }, /asset/],
    [{ ...FORM, payout: null }, /arrive/],
  ];
  for (const [form, expected] of rows) {
    const answer = newProductPlan(form);
    assert.equal(answer.ok, false, `${JSON.stringify(form)} should have been refused`);
    assert.match(answer.error, expected);
  }
  assert.equal(rows.length, 9); // a stated count: nine refusals asserted, none skipped
  // ...and a name of exactly 64 characters is accepted, or the length rule is off by one
  assert.equal(newProductPlan({ ...FORM, name: "x".repeat(64) }).ok, true);
});

// ---- the bytes a wallet is asked to confirm ------------------------------------------------------------

test("listing a one-off matches the calldata cast produced for the same seven arguments", () => {
  const expected = // cast calldata vector
    "0xffe26a9300000000000000000000000000000000000000000000000000000000000000e00000000000000000000000009fe46736679d2d9a65f0992f2272de9f3c7fa6e000000000000000000000000000000000000000000000000000000000017d7840000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003c44cdddb6a900fa2b585dd299e03d12fa4293bc000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000074861697263757400000000000000000000000000000000000000000000000000"; // cast calldata vector
  assert.equal(listCalldata(newProductPlan(FORM).plan).toLowerCase(), expected);
});

test("listing a recurring product matches cast, period word and all", () => {
  const expected = // cast calldata vector
    "0xffe26a9300000000000000000000000000000000000000000000000000000000000000e00000000000000000000000009fe46736679d2d9a65f0992f2272de9f3c7fa6e000000000000000000000000000000000000000000000000000000000002625a000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000278d000000000000000000000000003c44cdddb6a900fa2b585dd299e03d12fa4293bc000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000124d6f6e74686c79206d656d626572736869700000000000000000000000000000"; // cast calldata vector
  const plan = newProductPlan({ ...FORM, name: "Monthly membership", price: "2.5", kind: "recurring", days: "30" });
  assert.equal(listCalldata(plan.plan).toLowerCase(), expected);
});

test("switching a product off matches the calldata cast produced", () => {
  const expected = // cast calldata vector
    "0xe60a955d00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000"; // cast calldata vector
  assert.equal(setActiveCalldata("2", false).toLowerCase(), expected);
  assert.match(setActiveCalldata("2", true), /0{63}1$/); // the same call, the other way
});

test("control: a plan with a different price does NOT produce the pinned bytes", () => {
  const other = newProductPlan({ ...FORM, price: "26" });
  assert.notEqual(listCalldata(other.plan).toLowerCase(), listCalldata(newProductPlan(FORM).plan).toLowerCase());
});

// ---- customers ------------------------------------------------------------------------------------------

test("a customer is a wallet that paid, counted once, with a total per asset and nothing summed across", () => {
  const rows = customersFrom(PAYMENTS);
  assert.equal(rows.length, 2);
  const buyer = rows.find((r) => r.payer.toLowerCase() === BUYER.toLowerCase());
  assert.equal(buyer.payments, 4);
  assert.equal(buyer.verified, 3);
  assert.equal(buyer.unchecked, 1); // the refused one is counted as a visit and left out of the total
  assert.deepEqual(buyer.totals, [{ asset: UUSD.toLowerCase(), units: "5487612" }]);
  assert.equal(buyer.lastAt, MIDNIGHT + 60);
  const other = rows.find((r) => r.payer.toLowerCase() === SELLER.toLowerCase());
  assert.deepEqual(other.totals, [{ asset: TAST.toLowerCase(), units: "5000" }]);
  assert.equal(rows[0].payer.toLowerCase(), SELLER.toLowerCase()); // newest last payment first
});

test("two assets from one wallet stay two numbers", () => {
  const rows = customersFrom([
    { payer: BUYER, asset: UUSD, amount: "100", decision: "VERIFIED", settledAt: 2 },
    { payer: BUYER, asset: TAST, amount: "7", decision: "VERIFIED", settledAt: 3 },
  ]);
  assert.deepEqual(rows[0].totals, [{ asset: UUSD.toLowerCase(), units: "100" }, { asset: TAST.toLowerCase(), units: "7" }]);
});

test("a payment with no payer is not a customer, and an empty list is not a customer either", () => {
  assert.deepEqual(customersFrom([{ payer: null, amount: "1", decision: "VERIFIED" }]), []);
  assert.deepEqual(customersFrom([]), []);
  assert.deepEqual(customersFrom(null), []);
});

test("cover is what the catalogue answered, and an unsubscribed customer is not 'ran out'", () => {
  assert.equal(coverText(0, MIDNIGHT), "Not subscribed");
  assert.equal(coverText(MIDNIGHT + 86400, MIDNIGHT), "Paid to 12 Sep, 00:00");
  assert.match(coverText(MIDNIGHT - 86400, MIDNIGHT), /^Ran out /);
});

// ---- what these screens are no longer allowed to read ---------------------------------------------------

test("no admin screen reads the recorded demonstration any more", () => {
  for (const file of ["business.js", "products.js", "customers.js"]) {
    const source = readFileSync(join(APP, "assets", file), "utf8");
    assert.doesNotMatch(source, /config\??\.record|config\.record/, `${file} still reads the recorded run`);
  }
  // control: the rule is one a file could genuinely break
  assert.match("const r = config.record ?? null;", /config\.record/);
});

test("the three admin screens name no machinery in the sentences they can put on screen", () => {
  const banned = /\b(hook|executor|registry|pool|tick|feed|calldata|hex)s?\b/i;
  const said = [];
  for (const file of ["business.js", "products.js", "customers.js"]) {
    const source = readFileSync(join(APP, "assets", file), "utf8");
    // Every sentence this code can put in front of a person arrives through say(id, "..."), so those
    // are the strings that matter; a comment or an identifier is not something anybody reads.
    for (const m of source.matchAll(/say\((?:"[^"]*"|[A-Za-z0-9_.$\[\]`${}\- ]+),\s*(`[^`]*`|"[^"]*")\s*\)/g)) {
      said.push([file, m[1]]);
    }
  }
  const leaked = said.filter(([, sentence]) => banned.test(sentence));
  assert.deepEqual(leaked, [], "a machine word reached a sentence a shop owner reads");
  assert.ok(said.length >= 20, `only ${said.length} sentences were scanned; the scanner has stopped finding them`);
  assert.ok(banned.test("the executor refused"), "control: the rule catches a planted word");
});
