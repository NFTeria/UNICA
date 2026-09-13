// apps/web/tests/wrap.test.mjs — the wrap step, decided before any of a customer's money moves.
//
// Two halves. The first exercises the pure functions in apps/web/assets/wrap.js directly: no DOM,
// no network, no chain. The second reads apps/web/assets/local-pay.js as text and asserts the order
// the checkout runs them in, because "the deposit is mined before the approval" is a claim about a
// sequence, and a sequence cannot be asserted by calling a function.
//
// Every guard here has a control beside it. A test that would still pass with the guard deleted is
// decoration, and the margin below is exactly the kind of guard that is easy to drop by accident.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { encodeDepositCalldata } from "../assets/local-pay.js";
import { ASSET_STATUS } from "../assets/product.js";
import {
  GAS_MARGIN_WEI,
  NATIVE_DECIMALS,
  WRAPPED_NATIVE_NOTE,
  assetInFor,
  isPayableAsset,
  isWrappedNative,
  payAssetLabel,
  shortEthText,
  weiHex,
  wrapPlan,
  wrappingText,
} from "../assets/wrap.js";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const WETH = { symbol: "WETH", decimals: 18 };
/** The same asset as the register carries it: one a customer can actually pay with. */
const WETH_ROW = { ...WETH, status: ASSET_STATUS.DIRECT };
const ETH = 10n ** 18n;
const CENT = ETH / 100n; // 0.01

// ── what the plan decides ─────────────────────────────────────────────────────────────────────────

test("a wallet that already holds enough wrapped asset wraps nothing", () => {
  const plan = wrapPlan({ need: CENT, wethBalance: CENT, ethBalance: 0n, gasMargin: GAS_MARGIN_WEI });
  assert.equal(plan.ok, true);
  assert.equal(plan.wrap, 0n);
  assert.equal(plan.shortfall, 0n);
  // ...and holding more than the price is still nothing to wrap.
  assert.equal(wrapPlan({ need: CENT, wethBalance: ETH, ethBalance: 0n }).wrap, 0n);
});

test("a short wallet with enough ETH wraps the shortfall exactly, never a round number above it", () => {
  const plan = wrapPlan({ need: CENT, wethBalance: CENT / 4n, ethBalance: ETH, gasMargin: GAS_MARGIN_WEI });
  assert.equal(plan.ok, true);
  assert.equal(plan.wrap, CENT - CENT / 4n);
  assert.equal(plan.shortfall, plan.wrap);
  // The whole price, when the wallet holds none of the wrapped asset at all.
  assert.equal(wrapPlan({ need: CENT, wethBalance: 0n, ethBalance: ETH, gasMargin: GAS_MARGIN_WEI }).wrap, CENT);
});

test("a wallet short of both refuses, says the ETH is short too, and wraps nothing", () => {
  const plan = wrapPlan({ need: CENT, wethBalance: 0n, ethBalance: CENT / 2n, gasMargin: GAS_MARGIN_WEI });
  assert.equal(plan.ok, false);
  assert.equal(plan.wrap, 0n);
  assert.equal(plan.shortfall, CENT);
  assert.match(plan.why, /ETH does not cover/);
  assert.match(plan.why, /Nothing was sent/);
});

test("an unread balance is refused in a sentence a customer can act on", () => {
  const plan = wrapPlan({ need: CENT, wethBalance: null, ethBalance: null });
  assert.equal(plan.ok, false);
  assert.equal(plan.why, "Your balances could not be read, so nothing was sent.");
  // The shortfall stays zero, so the caller shows this sentence rather than one naming an amount
  // it never established: an unread balance has no shortfall to name.
  assert.equal(plan.shortfall, 0n);
});

test("a balance that could not be read is refused, never read as zero", () => {
  for (const missing of [{ wethBalance: null }, { ethBalance: null }, { need: null }, { wethBalance: undefined }]) {
    const plan = wrapPlan({ need: CENT, wethBalance: 0n, ethBalance: ETH, ...missing });
    assert.equal(plan.ok, false, JSON.stringify(missing));
    assert.equal(plan.wrap, 0n);
  }
  // control: the same call with all three present is the one that goes through, so the rows above
  // are refusing for the missing value and not because this shape never passes.
  assert.equal(wrapPlan({ need: CENT, wethBalance: 0n, ethBalance: ETH }).ok, true);
});

test("the margin refuses a wallet whose ETH covers the shortfall and nothing more", () => {
  // Exactly the shortfall, to the wei: enough to wrap, nothing left for the approval and the payment.
  const borderline = { need: CENT, wethBalance: 0n, ethBalance: CENT };
  assert.equal(wrapPlan({ ...borderline, gasMargin: GAS_MARGIN_WEI }).ok, false);
  // ...and one wei short of the margin is still refused, while the margin itself passes.
  assert.equal(wrapPlan({ ...borderline, ethBalance: CENT + GAS_MARGIN_WEI - 1n, gasMargin: GAS_MARGIN_WEI }).ok, false);
  assert.equal(wrapPlan({ ...borderline, ethBalance: CENT + GAS_MARGIN_WEI, gasMargin: GAS_MARGIN_WEI }).ok, true);
});

test("control: with the margin removed, that same borderline wallet wrongly passes", () => {
  // This is the sabotage. If the `+ margin` were dropped from the comparison in wrapPlan, the row
  // above would read exactly like this one and the test file would stay green while the app sent a
  // customer's last wei into a wrap they could no longer spend.
  const plan = wrapPlan({ need: CENT, wethBalance: 0n, ethBalance: CENT, gasMargin: 0n });
  assert.equal(plan.ok, true);
  assert.equal(plan.wrap, CENT);
});

test("the default margin is the one the checkout uses, so the tested rule is the shipped rule", () => {
  assert.equal(wrapPlan({ need: CENT, wethBalance: 0n, ethBalance: CENT }).ok, false);
  assert.ok(GAS_MARGIN_WEI > 0n);
});

test("a margin that cannot be read as an amount refuses, and is never read as zero", () => {
  // Every row is the wallet the margin exists for: exactly the shortfall in ETH, nothing over. Read
  // as zero, each of these would pass and send that wallet's last wei into a wrap it could not then
  // spend, which is precisely the sabotage the control two tests above describes.
  const borderline = { need: CENT, wethBalance: 0n, ethBalance: CENT };
  for (const unreadable of [null, "", NaN, -1, -1n, "abc", {}, "0.5"]) {
    const plan = wrapPlan({ ...borderline, gasMargin: unreadable });
    assert.equal(plan.ok, false, String(unreadable));
    assert.equal(plan.wrap, 0n, String(unreadable));
    assert.match(plan.why, /margin/, String(unreadable));
  }
  // control: a margin nobody passed is not an unreadable one. It takes the floor this file ships,
  // and refuses this same wallet for the margin's own reason rather than for an unread argument.
  const missing = wrapPlan(borderline);
  assert.equal(missing.ok, false);
  assert.doesNotMatch(missing.why, /margin/);
  // control: these rows refuse for the margin and not because this shape never passes — the same
  // wallet with the margin to spare, and a margin that reads, goes through.
  assert.equal(wrapPlan({ ...borderline, ethBalance: CENT + GAS_MARGIN_WEI, gasMargin: GAS_MARGIN_WEI }).ok, true);
});

// ── which asset this step is allowed to touch ─────────────────────────────────────────────────────

test("only an 18-place asset that names itself WETH is treated as wrapped ETH", () => {
  assert.equal(isWrappedNative(WETH), true);
  assert.equal(isWrappedNative({ symbol: "weth", decimals: 18 }), true);
  assert.equal(isWrappedNative({ symbol: "uUSD", decimals: 6 }), false);
  // control: the decimal count is load-bearing. A token that borrows the name but not the shape is
  // not the one-to-one contract this step assumes, and sending it ETH would buy an unknown amount.
  assert.equal(isWrappedNative({ symbol: "WETH", decimals: 6 }), false);
  // An asset whose label could not be read is never wrapped on a guess.
  assert.equal(isWrappedNative({ symbol: null, decimals: null }), false);
  assert.equal(isWrappedNative(null), false);
});

// ── which record describes that asset ─────────────────────────────────────────────────────────────

const ADDR = "0x" + "1".repeat(40); // asset address, the same one under both spellings below

test("the asset is identified by address against the deployment, not by the card's own symbol", () => {
  // The shape the companion hands over for a token it could not label: the address is right, the
  // name and the places are gone. The deployment has always known both.
  const card = { assetIn: { address: ADDR.toUpperCase(), symbol: null, decimals: null } };
  const config = { assets: [{ address: ADDR, symbol: "WETH", decimals: 18, status: ASSET_STATUS.DIRECT }] };
  assert.equal(assetInFor(card, config).symbol, "WETH");
  assert.equal(isWrappedNative(assetInFor(card, config)), true);
  // control: the card alone is exactly the refusal this lookup exists to prevent.
  assert.equal(isWrappedNative(card.assetIn), false);
});

test("the card is the fallback, and only when the deployment holds nothing for that address", () => {
  const card = { assetIn: { address: ADDR, symbol: "WETH", decimals: 18 } };
  assert.equal(assetInFor(card, { assets: [] }), card.assetIn);
  assert.equal(assetInFor(card, {}), card.assetIn);
  assert.equal(assetInFor(card, { assets: [{ address: "0x" + "2".repeat(40), symbol: "uUSD", decimals: 6 }] }), card.assetIn);
  // A catalogue card names its asset under pay.asset; the same lookup answers for both links.
  const product = { pay: { asset: { address: ADDR, symbol: null, decimals: null } } };
  assert.equal(assetInFor(product, { assets: [{ address: ADDR, symbol: "WETH", decimals: 18 }] }).symbol, "WETH");
  // Nothing to go on at all is null, never a guess.
  assert.equal(assetInFor(null, {}), null);
  assert.equal(assetInFor({ assetIn: { address: null } }, { assets: [{ address: ADDR, symbol: "WETH", decimals: 18 }] })?.symbol ?? null, null);
});

test("the checkout reads the asset through that lookup before it decides to wrap", () => {
  const src = readFileSync(join(APP, "assets", "local-pay.js"), "utf8");
  assert.match(src, /const payAsset = assetInFor\(card, config\);/);
  assert.match(src, /if \(isWrappedNative\(payAsset\)\) \{/);
  assert.equal(src.includes("isWrappedNative(card.assetIn)"), false, "the card's own symbol is no longer what decides");
});

// ── the words, and the value on the transaction ───────────────────────────────────────────────────

test("the status line says what is happening, with the amount at the asset's own places", () => {
  assert.equal(wrappingText(CENT, WETH), "Wrapping 0.01 ETH to WETH…");
  assert.equal(wrappingText(ETH, WETH), "Wrapping 1 ETH to WETH…");
  assert.equal(NATIVE_DECIMALS, 18);
});

test("the refusal names the shortfall and says nothing was sent", () => {
  assert.equal(
    shortEthText(CENT, WETH),
    "This payment needs 0.01 WETH more than this wallet holds, and its ETH does not cover the difference and the network fee. Nothing was sent.",
  );
});

test("no screen text from this step uses a word the product does not say", () => {
  const said = [
    wrappingText(CENT, WETH),
    shortEthText(CENT, WETH),
    wrapPlan({ need: CENT, wethBalance: 0n, ethBalance: 0n }).why,
    wrapPlan({ need: CENT, wethBalance: 0n, ethBalance: 0n, gasMargin: null }).why,
    wrapPlan({ need: CENT, wethBalance: null, ethBalance: 0n }).why,
  ];
  for (const line of said) {
    assert.doesNotMatch(line, /\b(demo|practice|fixture|mock|till)\b/i, line);
  }
});

test("a transaction value is a bare hex quantity, and a negative one is refused", () => {
  assert.equal(weiHex(0n), "0x0");
  assert.equal(weiHex(CENT), "0x" + CENT.toString(16));
  assert.equal(weiHex(255n), "0xff");
  assert.throws(() => weiHex(-1n));
  assert.throws(() => weiHex(null));
});

// ── what the register calls the asset ─────────────────────────────────────────────────────────────

test("the register's WETH row says a customer may hold plain ETH instead", () => {
  assert.equal(payAssetLabel(WETH_ROW), "WETH · or ETH, wrapped at payment");
  assert.equal(payAssetLabel({ ...WETH, status: ASSET_STATUS.CONVERSION }), "WETH · or ETH, wrapped at payment");
});

test("a row with no route promises nothing, whatever asset it names", () => {
  // There is no settler and no market pair behind this row, so nobody is paying this price in ETH
  // or in anything else. It reads exactly as it did before the note existed.
  assert.equal(payAssetLabel({ ...WETH, status: ASSET_STATUS.UNAVAILABLE }), "WETH");
  // A row carrying no status at all is not assumed to have a route either.
  assert.equal(payAssetLabel(WETH), "WETH");
  assert.equal(isPayableAsset({ status: ASSET_STATUS.UNAVAILABLE }), false);
  assert.equal(isPayableAsset({}), false);
  // control: the two rows above refuse the note for the route and not because this shape never
  // carries it — the same asset, marked payable, still says what a customer may hold.
  assert.ok(payAssetLabel(WETH_ROW).includes(WRAPPED_NATIVE_NOTE));
});

test("no other asset carries that note, because no other asset can do it", () => {
  assert.equal(payAssetLabel({ symbol: "uUSD", decimals: 6, status: ASSET_STATUS.DIRECT }), "uUSD");
  assert.equal(payAssetLabel({ symbol: "tAST", decimals: 18, status: ASSET_STATUS.CONVERSION }), "tAST");
  // control: the note follows the same rule the wrap itself does. A token borrowing the name
  // without the shape is not wrapped, so it must not be advertised as though it were.
  assert.equal(payAssetLabel({ symbol: "WETH", decimals: 6, status: ASSET_STATUS.DIRECT }), "WETH");
  assert.equal(payAssetLabel({ symbol: "WETH", decimals: 6, status: ASSET_STATUS.DIRECT }).includes(WRAPPED_NATIVE_NOTE), false);
  // An unreadable label still falls back to the shortened address the register showed before.
  assert.equal(payAssetLabel({ symbol: null, address: "0x" + "a".repeat(40), status: ASSET_STATUS.DIRECT }), "0xaaaaaa…aaaa");
});

test("the register builds its list with that label, not the bare symbol", () => {
  const src = readFileSync(join(APP, "assets", "cashier.js"), "utf8");
  assert.match(src, /sym\.textContent = payAssetLabel\(asset\);/);
  assert.equal(src.includes("sym.textContent = assetLabel(asset);"), false, "the bare symbol is no longer what the row says");
  assert.match(src, /import \{ payAssetLabel \} from "\.\/wrap\.js";/);
});

// ── the calldata the wrap is sent as ──────────────────────────────────────────────────────────────

test("deposit() encodes to the published four bytes, and to nothing else", () => {
  // The instrument, checked against the value WETH9's own interface has carried since it was
  // deployed: if selectorOf ever computed a different keccak, this row fails rather than the app
  // sending ETH to a function that does not exist.
  assert.equal(encodeDepositCalldata(), "0xd0e30db0");
  assert.equal(encodeDepositCalldata().length, 10, "a no-argument call is the selector and nothing after it");
});

// ── the sequence the checkout runs, asserted in the source ────────────────────────────────────────

const orderPath = () => {
  const src = readFileSync(join(APP, "assets", "local-pay.js"), "utf8");
  const from = src.indexOf("const { settler, assetIn, amountIn } = settlementTarget(card, config);");
  const to = src.indexOf("encodePayCalldata(card.id)", from);
  assert.ok(from > 0 && to > from, "the order path could not be found in local-pay.js");
  return src.slice(from, to);
};

const plannerBeforeApproval = (src) => {
  const planned = src.indexOf("wrapPlan(");
  const approved = src.indexOf("encodeApproveCalldata(");
  return planned !== -1 && approved !== -1 && planned < approved;
};

test("the checkout asks the planner before it approves anything", () => {
  assert.equal(plannerBeforeApproval(orderPath()), true);
  // control, on a planted source: the same predicate must fail when the two are the other way
  // round, or it is asserting nothing about order at all.
  assert.equal(plannerBeforeApproval("encodeApproveCalldata(settler, amountIn); wrapPlan({});"), false);
  assert.equal(plannerBeforeApproval("wrapPlan({});"), false);
});

test("the deposit is awaited to its receipt, and carries the wrapped amount as the value", () => {
  const src = orderPath();
  assert.match(
    src,
    /waitForReceipt\(session, await session\.send\(\{ to: assetIn, data: encodeDepositCalldata\(\), value: weiHex\(plan\.wrap\) \}\)\)/,
    "the deposit must be mined before the sequence continues",
  );
  // The approval that follows keeps its own wait — this step must not have replaced it.
  assert.match(src, /waitForReceipt\(session, await session\.send\(\{ to: assetIn, data: encodeApproveCalldata\(settler, amountIn\) \}\)\)/);
});

test("a failed balance read reaches the planner, and is refused rather than skipped", () => {
  const src = orderPath();
  // The reading is handed over as it came — null and all — so the refusal is the planner's, in its
  // own words, on the screen. There is no branch that steps around the wrap when the read fails.
  assert.match(src, /wethBalance: purse\?\.held \?\? null,/);
  assert.match(src, /ethBalance: purse\?\.native \?\? null,/);
  assert.equal(src.includes("if (purse) {"), false, "a failed read no longer skips the wrap in silence");
  // ...and the sentence it refuses with is the one that reaches the status line.
  const refusal = src.indexOf("if (!plan.ok)");
  assert.match(src.slice(refusal, refusal + 300), /setText\("co-status", plan\.shortfall > 0n \? shortEthText\(plan\.shortfall, payAsset\) : plan\.why\)/);
});

test("a refusal from the planner sends nothing at all", () => {
  const src = orderPath();
  const refusal = src.indexOf("if (!plan.ok)");
  const deposit = src.indexOf("encodeDepositCalldata()");
  assert.ok(refusal > 0, "the refusal branch is missing");
  assert.ok(refusal < deposit, "the refusal must be decided before the deposit is built");
  assert.match(src.slice(refusal, deposit), /return;/, "the refusal returns rather than falling through to the send");
});
