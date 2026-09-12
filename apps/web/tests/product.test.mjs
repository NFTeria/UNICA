// apps/web/tests/product.test.mjs: the product rules that decide what a business owner and a
// customer are told. Pure functions only — no DOM, no network, no chain, no clock this file did
// not supply.
//
// EVERY RULE HERE HAS A CONTROL. A test that only shows the happy answer cannot tell a working
// rule from one that answers the same thing to everything, so each rule is also fed the input it
// must REFUSE: an asset with no route, a settler that does not exist, a manifest that claims a
// public network it cannot have, a transaction hash offered as proof of payment.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSET_STATUS,
  ASSET_STATUS_TEXT,
  LANGUAGE,
  MAINNET_ENVIRONMENT,
  NO_VALUE_BANNER,
  assetMenu,
  assetStatusFor,
  businessDisplayName,
  chooseSettlementRoute,
  formatAsset,
  fromBaseUnits,
  inBusinessWords,
  machineWordsIn,
  marketPairCovers,
  paymentStatus,
  quoteOrder,
  receiptStatement,
  registerDisplayName,
  routeLabel,
  toBaseUnits,
  todaysPayments,
  validateEnvironment,
  withinPaymentLimit,
} from "../assets/product.js";

// The two local test assets, exactly as the local deployment issues them. Neither is a dollar and
// neither has value; the symbols are the ones the deployment itself answers with.
const UUSD = { role: "payout", symbol: "uUSD", decimals: 6, address: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", labelled: true };
const TAST = { role: "customer", symbol: "tAST", decimals: 18, address: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", labelled: true };
const OTHER = { role: "customer", symbol: "tXYZ", decimals: 18, address: "0x1111111111111111111111111111111111111111", labelled: true };
const ACTIVE_PAIR = { marketId: "0x71efc7fd891008cf1471ff1228d6362fec9b316d1b485a59a368375012a798d6", currency0: UUSD.address, currency1: TAST.address, status: 4, active: true };
const DIRECT_SETTLER = "0x2222222222222222222222222222222222222222";
const EXECUTOR = "0x3333333333333333333333333333333333333333";

// ---- the words on screen ---------------------------------------------------------------------

test("every protocol phrase maps to the sentence a person reads", () => {
  assert.equal(inBusinessWords("Create market"), "Enable payment option");
  assert.equal(inBusinessWords("Execute swap"), "Process payment");
  assert.equal(inBusinessWords("Market active"), "Payment option available");
  assert.equal(inBusinessWords("No route"), "This payment asset is temporarily unavailable");
  assert.equal(inBusinessWords("Insufficient liquidity"), "This amount cannot currently be converted safely");
  assert.equal(inBusinessWords("Admission gate"), "Authorized terminal");
  assert.equal(inBusinessWords("Settlement evidence"), "Payment verification");
  assert.equal(inBusinessWords("Output token"), "Payout asset");
  assert.equal(Object.keys(LANGUAGE).length, 8);
});
test("an unmapped phrase comes back untouched rather than blank", () => {
  assert.equal(inBusinessWords("Add your business"), "Add your business");
});
test("control: no replacement sentence smuggles a machine word back in", () => {
  for (const sentence of Object.values(LANGUAGE)) {
    assert.deepEqual(machineWordsIn(sentence), [], sentence);
  }
});
test("control: the machine-word detector actually catches one", () => {
  assert.deepEqual(machineWordsIn("the executor called the hook"), ["hook", "executor"]);
});

// ---- the environment label ---------------------------------------------------------------------

test("a local practice chain is labelled a test network, whatever the manifest says", () => {
  const v = validateEnvironment({ chainId: 31337, environment: MAINNET_ENVIRONMENT });
  assert.equal(v.mainnet, false);
  assert.equal(v.banner, NO_VALUE_BANNER);
  assert.equal(v.networkName, "Local practice network");
});
test("Sepolia is labelled a test network", () => {
  assert.equal(validateEnvironment({ chainId: 11155111, environment: "SEPOLIA" }).banner, NO_VALUE_BANNER);
});
test("an unknown chain is a test network unless the manifest declares a public one", () => {
  const v = validateEnvironment({ chainId: 46630, environment: "EXPERIMENT" });
  assert.equal(v.mainnet, false);
  assert.equal(v.banner, NO_VALUE_BANNER);
});
test("only a declared PUBLIC_MAINNET manifest may drop the no-value label", () => {
  const v = validateEnvironment({ chainId: 1, environment: MAINNET_ENVIRONMENT });
  assert.equal(v.mainnet, true);
  assert.equal(v.banner, null);
});
test("control: chain 1 alone is not enough to be called a public network", () => {
  const v = validateEnvironment({ chainId: 1 });
  assert.equal(v.mainnet, false);
  assert.equal(v.banner, NO_VALUE_BANNER);
});
test("an empty manifest is a test network, not a crash", () => {
  assert.equal(validateEnvironment().banner, NO_VALUE_BANNER);
  assert.equal(validateEnvironment({}).mainnet, false);
});

// ---- asset status -------------------------------------------------------------------------------

test("the payout asset is direct when the deployment carries a direct settler", () => {
  const s = assetStatusFor(UUSD, { payoutAsset: UUSD, marketPair: ACTIVE_PAIR, directSettlement: DIRECT_SETTLER });
  assert.equal(s.status, ASSET_STATUS.DIRECT);
  assert.equal(s.text, ASSET_STATUS_TEXT.DIRECT);
});
test("the payout asset is TEMPORARILY UNAVAILABLE when the direct settler is not deployed", () => {
  const s = assetStatusFor(UUSD, { payoutAsset: UUSD, marketPair: ACTIVE_PAIR, directSettlement: null });
  assert.equal(s.status, ASSET_STATUS.UNAVAILABLE);
  assert.equal(s.text, ASSET_STATUS_TEXT.UNAVAILABLE);
});
test("a different asset is available with conversion when the pair is active", () => {
  const s = assetStatusFor(TAST, { payoutAsset: UUSD, marketPair: ACTIVE_PAIR, directSettlement: null });
  assert.equal(s.status, ASSET_STATUS.CONVERSION);
  assert.equal(s.text, ASSET_STATUS_TEXT.CONVERSION);
});
test("a pair that is not active converts nothing", () => {
  const paused = { ...ACTIVE_PAIR, status: 5, active: false };
  assert.equal(assetStatusFor(TAST, { payoutAsset: UUSD, marketPair: paused }).status, ASSET_STATUS.UNAVAILABLE);
});
test("an asset the manifest has no pair for is unavailable, never claimed", () => {
  const s = assetStatusFor(OTHER, { payoutAsset: UUSD, marketPair: ACTIVE_PAIR, directSettlement: DIRECT_SETTLER });
  assert.equal(s.status, ASSET_STATUS.UNAVAILABLE);
  assert.equal(s.why, "This payment asset is temporarily unavailable.");
});
test("an asset whose label could not be read is never offered, whatever route exists for it", () => {
  const unlabelled = { ...TAST, labelled: false, symbol: null, decimals: null };
  const s = assetStatusFor(unlabelled, { payoutAsset: UUSD, marketPair: ACTIVE_PAIR, directSettlement: DIRECT_SETTLER });
  assert.equal(s.status, ASSET_STATUS.UNAVAILABLE);
  assert.match(s.why, /could not be labelled/);
});
test("an unlabelled PAYOUT asset makes every payment asset unavailable, not just its own row", () => {
  const menu = assetMenu({ assets: [{ ...UUSD, labelled: false }, TAST], marketPair: ACTIVE_PAIR, contracts: { directSettlement: DIRECT_SETTLER } });
  assert.deepEqual(menu.map((a) => a.status), [ASSET_STATUS.UNAVAILABLE, ASSET_STATUS.UNAVAILABLE]);
});
test("control: the same two assets, labelled, are offered again", () => {
  const menu = assetMenu({ assets: [UUSD, TAST], marketPair: ACTIVE_PAIR, contracts: { directSettlement: DIRECT_SETTLER } });
  assert.deepEqual(menu.map((a) => a.status), [ASSET_STATUS.DIRECT, ASSET_STATUS.CONVERSION]);
});
test("marketPairCovers reads the pair in either direction and refuses a stranger", () => {
  assert.equal(marketPairCovers(ACTIVE_PAIR, TAST.address, UUSD.address), true);
  assert.equal(marketPairCovers(ACTIVE_PAIR, UUSD.address, TAST.address), true);
  assert.equal(marketPairCovers(ACTIVE_PAIR, OTHER.address, UUSD.address), false);
  assert.equal(marketPairCovers(null, TAST.address, UUSD.address), false);
});
test("the asset menu answers for every asset the deployment names", () => {
  const menu = assetMenu({ assets: [UUSD, TAST, OTHER], marketPair: ACTIVE_PAIR, contracts: { directSettlement: null } });
  assert.deepEqual(menu.map((a) => a.status), [ASSET_STATUS.UNAVAILABLE, ASSET_STATUS.CONVERSION, ASSET_STATUS.UNAVAILABLE]);
});
test("control: with the direct settler present the same menu changes exactly one answer", () => {
  const menu = assetMenu({ assets: [UUSD, TAST, OTHER], marketPair: ACTIVE_PAIR, contracts: { directSettlement: DIRECT_SETTLER } });
  assert.deepEqual(menu.map((a) => a.status), [ASSET_STATUS.DIRECT, ASSET_STATUS.CONVERSION, ASSET_STATUS.UNAVAILABLE]);
});

// ---- which settlement path a payment takes ------------------------------------------------------

test("same asset in and out goes to the direct settler and says no conversion is needed", () => {
  const r = chooseSettlementRoute({ customerAsset: UUSD, payoutAsset: UUSD, marketPair: ACTIVE_PAIR, contracts: { directSettlement: DIRECT_SETTLER, executor: EXECUTOR } });
  assert.equal(r.kind, "direct");
  assert.equal(r.contract, DIRECT_SETTLER);
  assert.equal(routeLabel(r), "No conversion needed");
});
test("different assets go through the market and say the conversion is included", () => {
  const r = chooseSettlementRoute({ customerAsset: TAST, payoutAsset: UUSD, marketPair: ACTIVE_PAIR, contracts: { directSettlement: DIRECT_SETTLER, executor: EXECUTOR } });
  assert.equal(r.kind, "conversion");
  assert.equal(r.contract, EXECUTOR);
  assert.equal(r.marketId, ACTIVE_PAIR.marketId);
  assert.equal(routeLabel(r), "Conversion included");
});
test("a same-asset payment is refused outright when no direct settler exists", () => {
  const r = chooseSettlementRoute({ customerAsset: UUSD, payoutAsset: UUSD, marketPair: ACTIVE_PAIR, contracts: { executor: EXECUTOR } });
  assert.equal(r.kind, "none");
  assert.equal(r.contract, null);
  assert.equal(routeLabel(r), LANGUAGE["No route"]);
});
test("control: a route is never invented for a pair the deployment does not have", () => {
  const r = chooseSettlementRoute({ customerAsset: OTHER, payoutAsset: UUSD, marketPair: ACTIVE_PAIR, contracts: { directSettlement: DIRECT_SETTLER, executor: EXECUTOR } });
  assert.equal(r.kind, "none");
});

// ---- amounts ---------------------------------------------------------------------------------------

test("an amount is read at the asset's own precision", () => {
  assert.equal(toBaseUnits("12.5", 6), 12500000n);
  assert.equal(toBaseUnits("1", 18), 1000000000000000000n);
  assert.equal(fromBaseUnits(12500000n, 6), "12.5");
  assert.equal(fromBaseUnits(2000000n, 6), "2");
});
test("more decimal places than the asset holds is refused, not rounded away", () => {
  assert.throws(() => toBaseUnits("1.1234567", 6), /6 decimal places/);
  assert.throws(() => toBaseUnits("twelve", 6), /digits/);
});
test("an amount nobody has yet reads as unknown, never as zero", () => {
  assert.equal(formatAsset(null, UUSD), "unknown uUSD");
  assert.equal(formatAsset(1987612n, UUSD), "1.987612 uUSD");
});

// ---- pricing one payment ------------------------------------------------------------------------

// The local deployment's own demonstration rate: two payout units per one whole customer asset.
const PRICE = { price: 2000000000000000000n, priceDecimals: 18 };

test("invoicing in the payout asset makes that amount the floor and pads the spend", () => {
  const q = quoteOrder({ invoiceUnits: 2000000n, invoiceIn: "payout", customerAsset: TAST, payoutAsset: UUSD, ...PRICE });
  assert.equal(q.minOut, 2000000n);
  // One whole customer asset buys exactly two payout units, plus 2.5% headroom.
  assert.equal(q.amountIn, 1025000000000000000n);
});
test("invoicing in the customer's asset fixes the spend and pads the floor downward", () => {
  const q = quoteOrder({ invoiceUnits: 1000000000000000000n, invoiceIn: "customer", customerAsset: TAST, payoutAsset: UUSD, ...PRICE });
  assert.equal(q.amountIn, 1000000000000000000n);
  assert.equal(q.minOut, 1950000n);
});
test("a same-asset payment is not priced at all", () => {
  const q = quoteOrder({ invoiceUnits: 500000n, customerAsset: UUSD, payoutAsset: UUSD, ...PRICE });
  assert.deepEqual(q, { amountIn: 500000n, minOut: 500000n, converted: false });
});
test("no price means no payment, rather than a payment at a guessed price", () => {
  assert.throws(() => quoteOrder({ invoiceUnits: 1n, customerAsset: TAST, payoutAsset: UUSD, price: 0n, decimals: 18, priceDecimals: 18 }), /no usable price/);
});
test("an asset with no decimal count is never priced", () => {
  const unlabelled = { ...TAST, decimals: null };
  assert.throws(() => quoteOrder({ invoiceUnits: 1n, customerAsset: unlabelled, payoutAsset: UUSD, ...PRICE }), /decimal places/);
});
test("the deployment's per-payment ceiling is checked before the order exists", () => {
  assert.equal(withinPaymentLimit(9000000n, "10000000").ok, true);
  const over = withinPaymentLimit(11000000n, "10000000");
  assert.equal(over.ok, false);
  assert.match(over.sentence, /limits how much a single payment may be/);
});
test("no ceiling means no ceiling, not a zero one", () => {
  assert.equal(withinPaymentLimit(999999999n, null).ok, true);
});

// ---- the day's takings -----------------------------------------------------------------------------

const DAY = 1789084810; // a second inside one UTC day, taken from the local demonstration record
const verified = { orderId: "0xabc", settledAt: DAY, evidence: { decision: "VERIFIED" } };
const unresolved = { orderId: "0xdef", settledAt: DAY + 10, evidence: { decision: "UNKNOWN" } };
const yesterday = { orderId: "0x123", settledAt: DAY - 86400, evidence: { decision: "VERIFIED" } };

test("today counts only verified payments from today", () => {
  const t = todaysPayments([verified, unresolved, yesterday], DAY);
  assert.equal(t.verifiedCount, 1);
  assert.equal(t.unresolvedCount, 1);
});
test("control: an unverified payment is never counted as taken", () => {
  assert.equal(todaysPayments([unresolved], DAY).verifiedCount, 0);
});
test("an empty record answers zero of both, and never throws", () => {
  const t = todaysPayments(null, DAY);
  assert.deepEqual([t.verifiedCount, t.unresolvedCount], [0, 0]);
});

// ---- the one rule that may say Paid -------------------------------------------------------------

test("Paid appears only on a VERIFIED verification", () => {
  const s = receiptStatement({ evidence: { decision: "VERIFIED" } });
  assert.equal(s.status, "PAID");
  assert.equal(s.heading, "Paid (checked)");
});
test("a transaction hash alone never says Paid, and warns against paying twice", () => {
  const s = receiptStatement({ txSubmitted: true, txHash: "0xdeadbeef" });
  assert.notEqual(s.heading, "Paid (checked)");
  assert.match(s.sentence, /Do not pay again/);
});
test("a refused verification says the transaction is not recognized", () => {
  const s = receiptStatement({ evidence: { decision: "REFUSED" } });
  assert.equal(s.heading, "Declined");
  assert.equal(s.sentence, "This transaction is not recognized as a valid UNICA payment.");
});
test("an unknown verification is still not paid", () => {
  assert.notEqual(receiptStatement({ evidence: { decision: "UNKNOWN" } }).heading, "Paid (checked)");
});
test("a reverted transaction is declined even if a stale verification says otherwise", () => {
  const s = receiptStatement({ txReceipt: { status: "0x0" }, evidence: { decision: "VERIFIED" } });
  assert.equal(s.heading, "Declined");
});
test("control: the statement is the same rule the counter uses, not a second one", () => {
  for (const evidence of [{ decision: "VERIFIED" }, { decision: "REFUSED" }, { decision: "UNKNOWN" }, null]) {
    assert.equal(receiptStatement({ evidence }).status, paymentStatus({ evidence }));
  }
});

// ---- names -----------------------------------------------------------------------------------------

test("a hyphenated label becomes the name on the shop sign", () => {
  assert.equal(businessDisplayName("fresh-cuts"), "Fresh Cuts");
  assert.equal(businessDisplayName("freshcuts"), "Freshcuts");
  assert.equal(businessDisplayName(""), "Your business");
});
test("a register is named as its owner named it", () => {
  assert.equal(registerDisplayName("chair-1.terminals.freshcuts.unica.eth"), "chair-1");
  assert.equal(registerDisplayName(null), "Unnamed register");
});
