// The register holds a converted sale to the pool it actually settles on. Pure rows on the slot0
// decoder, on the sqrtPriceX96 -> rate arithmetic, on the choice between the feeds and the pool, on
// the sale line's wording, and on the order of reads in the register.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindingRate, crossRateFromFeeds, poolRateFromSqrtPrice, quoteOrder, SLIPPAGE_BPS } from "../assets/product.js";
import { decodeSlot0, priceNoteFor } from "../assets/cashier.js";

// vectors: the Sepolia pool — USDC is currency0 at 6 places, WETH is currency1 at 18 — as read 2026-09-13
const SHAPE = { assetIsCurrency0: false, assetDecimals: 18, payoutDecimals: 6 };
const LIVE_S = 1607493129951327422225119953682294n; // StateView.getSlot0(poolId) at block 11696383
const LIVE_TICK = 198367;
const OPENING_S = 1583006913070903104376321276546258n; // the manifest's initSqrtPriceX96
const OPENING_TICK = 198060;
const WETH = { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18 };
const USDC = { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 };
// the two feeds, 8 places each: ETH / USD round 18446744073709587628 (getRoundData), USDC / USD latestRoundData
const ETH_USD = { answer: 248103935330n, decimals: 8, updatedAt: 1789302624 };
const USDC_USD = { answer: 99984561n, decimals: 8, updatedAt: 1789229592 };
const LIVE_ETH_USD = { answer: 246786000000n, decimals: 8, updatedAt: 1789306308 }; // latestRoundData at block 11696383

const word = (n) => (n < 0n ? 2n ** 256n + n : n).toString(16).padStart(64, "0");
const asWhole = (r) => Number(r.price) / 1e18;
const tickPrice = (t) => 1e12 / 1.0001 ** t; // USDC per WETH at exactly this tick, for this pool's shape
const feedNote = (a, q) => `ETH / USD ${a.answer} at ${a.updatedAt} over USDC / USD ${q.answer} at ${q.updatedAt}`;

// ---- sqrtPriceX96 -> payout per whole asset at 18 places -------------------------------------------

test("the live sqrt price reads as about 2,429 USDC per WETH, inside its own tick", () => {
  const r = poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, ...SHAPE });
  assert.ok(r, "a live pool must price");
  assert.equal(r.decimals, 18);
  assert.ok(r.price > 2429n * 10n ** 18n && r.price < 2430n * 10n ** 18n, `got ${r.price}`);
  // one fact from outside the formula: a price at tick t sits between the prices of t and t+1
  assert.ok(asWhole(r) <= tickPrice(LIVE_TICK) && asWhole(r) > tickPrice(LIVE_TICK + 1), `${asWhole(r)} is not inside tick ${LIVE_TICK}`);
});

test("the opening sqrt price reads as about 2,505 USDC per WETH, inside the tick the pool was opened at", () => {
  const r = poolRateFromSqrtPrice({ sqrtPriceX96: OPENING_S, ...SHAPE });
  assert.ok(r.price > 2504n * 10n ** 18n && r.price < 2506n * 10n ** 18n, `got ${r.price}`);
  assert.ok(asWhole(r) <= tickPrice(OPENING_TICK) && asWhole(r) > tickPrice(OPENING_TICK + 1), `${asWhole(r)} is not inside tick ${OPENING_TICK}`);
});

test("the general form: the asset sorting first gives the reciprocal, and the two multiply to one", () => {
  const usdcPerWeth = poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, ...SHAPE });
  const wethPerUsdc = poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, assetIsCurrency0: true, assetDecimals: 6, payoutDecimals: 18 });
  assert.ok(wethPerUsdc.price > 411n * 10n ** 12n && wethPerUsdc.price < 412n * 10n ** 12n, `got ${wethPerUsdc.price}`);
  const product = usdcPerWeth.price * wethPerUsdc.price; // 1e18 * 1e18 when the two are reciprocals
  assert.ok(product > 10n ** 36n - 10n ** 22n && product < 10n ** 36n + 10n ** 22n, `product ${product}`);
});

test("control: a zero price, an unknown side or unknown places price nothing", () => {
  assert.equal(poolRateFromSqrtPrice({ sqrtPriceX96: 0n, ...SHAPE }), null);
  assert.equal(poolRateFromSqrtPrice({ sqrtPriceX96: "not a number", ...SHAPE }), null);
  assert.equal(poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, ...SHAPE, assetIsCurrency0: "false" }), null);
  assert.equal(poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, ...SHAPE, assetDecimals: undefined }), null);
  assert.equal(poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, ...SHAPE, payoutDecimals: "6" }), null);
  assert.equal(poolRateFromSqrtPrice(), null);
});

// ---- slot0 ------------------------------------------------------------------------------------------

test("getSlot0 decodes the four words, the tick as a signed int24", () => {
  const hex = "0x" + word(LIVE_S) + word(198367n) + word(0n) + word(3000n);
  assert.deepEqual(decodeSlot0(hex), { sqrtPriceX96: LIVE_S, tick: 198367, protocolFee: 0, lpFee: 3000 });
  const below = "0x" + word(LIVE_S) + word(-887272n) + word(0n) + word(3000n);
  assert.equal(decodeSlot0(below).tick, -887272, "a negative tick arrives sign-extended and must read negative");
  assert.equal(decodeSlot0("0x" + word(LIVE_S) + word(198367n)), null, "fewer than four words is not slot0");
  assert.equal(decodeSlot0("0x" + word(0n) + word(0n) + word(0n) + word(0n)), null, "an uninitialised pool has no price");
});

// ---- the worse of the two, for the customer ---------------------------------------------------------

test("the pool 2.1% under the feeds binds: the sale is priced from the pool", () => {
  const feeds = crossRateFromFeeds({ asset: ETH_USD, quote: USDC_USD });
  const pool = poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, ...SHAPE });
  const rate = bindingRate({ feeds, pool });
  assert.equal(rate.source, "pool");
  assert.equal(rate.price, pool.price);
  assert.equal(rate.decimals, 18);
  assert.equal(rate.offsetTenths, -21, "2481.42 over 2429.19 is 2.105% under, which reads as 2.1");
});

test("the pool over the feeds does not bind: the feeds price the sale and the pool's distance is still known", () => {
  const feeds = crossRateFromFeeds({ asset: ETH_USD, quote: USDC_USD });
  const pool = poolRateFromSqrtPrice({ sqrtPriceX96: OPENING_S, ...SHAPE });
  const rate = bindingRate({ feeds, pool });
  assert.equal(rate.source, "feeds");
  assert.equal(rate.price, feeds.price);
  assert.equal(rate.offsetTenths, 9, "2504.92 over 2481.42 is 0.947% over, which reads as 0.9");
});

test("a clean pair: 1,950 against 2,000 is 2.5% under and binds; equal prices leave the feeds binding at 0.0", () => {
  const feeds = { price: 2000n * 10n ** 18n, decimals: 18 };
  assert.deepEqual(bindingRate({ feeds, pool: { price: 1950n * 10n ** 18n, decimals: 18 } }), { price: 1950n * 10n ** 18n, decimals: 18, source: "pool", offsetTenths: -25 });
  assert.deepEqual(bindingRate({ feeds, pool: { price: 2000n * 10n ** 18n, decimals: 18 } }), { price: 2000n * 10n ** 18n, decimals: 18, source: "feeds", offsetTenths: 0 });
  // a pool answering at 8 places is compared at a common scale, not word for word
  assert.equal(bindingRate({ feeds, pool: { price: 1950n * 10n ** 8n, decimals: 8 } }).source, "pool");
});

test("control: no pool price leaves the feeds binding with nothing to compare; no feeds price nothing", () => {
  const feeds = { price: 2000n * 10n ** 18n, decimals: 18 };
  assert.deepEqual(bindingRate({ feeds, pool: null }), { price: 2000n * 10n ** 18n, decimals: 18, source: "feeds", offsetTenths: null });
  assert.equal(bindingRate({ feeds: null, pool: { price: 1n, decimals: 18 } }), null);
  assert.equal(bindingRate({ feeds: { price: 0n, decimals: 18 }, pool: { price: 1n, decimals: 18 } }), null);
  assert.equal(bindingRate(), null);
});

// ---- what the spend then covers --------------------------------------------------------------------

test("2 USDC held to the pool: after the pool's 0.3% fee the spend covers the ticket at the pool's own price", () => {
  const usdc = 2_000_000n;
  const feeds = crossRateFromFeeds({ asset: ETH_USD, quote: USDC_USD });
  const pool = poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, ...SHAPE });
  const spend = (price) => quoteOrder({ invoiceUnits: usdc, invoiceIn: "payout", customerAsset: WETH, payoutAsset: USDC, price, priceDecimals: 18 }).amountIn;
  const held = spend(bindingRate({ feeds, pool }).price);
  const fromFeeds = spend(feeds.price);
  assert.ok(held > fromFeeds, "held to the lower rate, the customer is asked for more WETH");
  // USDC raw for WETH raw at the pool's spot, the fee taken off the input the way the pool takes it
  const paysAtSpot = (amountIn) => (amountIn * 997n * pool.price) / (1000n * 10n ** 30n);
  assert.ok(paysAtSpot(held) >= usdc, `at spot the pool pays ${paysAtSpot(held)} for the held spend`);
  assert.ok(held < (fromFeeds * (10_000n + BigInt(SLIPPAGE_BPS))) / 10_000n, "the pad on top is still the one allowed slippage, not two");
});

test("control: a pool 5% under the feeds is short at spot when priced from the feeds alone, and covered when held", () => {
  const usdc = 2_000_000n;
  const feeds = { price: 2000n * 10n ** 18n, decimals: 18 };
  const pool = { price: 1900n * 10n ** 18n, decimals: 18 };
  const spend = (price) => quoteOrder({ invoiceUnits: usdc, invoiceIn: "payout", customerAsset: WETH, payoutAsset: USDC, price, priceDecimals: 18 }).amountIn;
  const paysAtSpot = (amountIn) => (amountIn * 997n * pool.price) / (1000n * 10n ** 30n);
  assert.ok(paysAtSpot(spend(feeds.price)) < usdc, "priced from the feeds, the pool pays less than the ticket");
  assert.ok(paysAtSpot(spend(bindingRate({ feeds, pool }).price)) >= usdc, "held to the pool, it covers");
});

// ---- the sale line ------------------------------------------------------------------------------------

test("the sale line names both feeds, then the pool's tick and how far under the feeds it sat", () => {
  const feeds = { ...crossRateFromFeeds({ asset: LIVE_ETH_USD, quote: USDC_USD }), note: feedNote(LIVE_ETH_USD, USDC_USD) };
  const pool = { ...poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, ...SHAPE }), tick: LIVE_TICK };
  const rate = bindingRate({ feeds, pool });
  assert.equal(rate.source, "pool");
  assert.equal(
    priceNoteFor({ feeds, pool, rate }),
    "ETH / USD 246786000000 at 1789306308 over USDC / USD 99984561 at 1789229592, held to the pool at tick 198367, 1.6% under the feeds",
  );
});

test("the sale line with the pool above the feeds still names the pool, and says so when the pool was not read", () => {
  const feeds = { ...crossRateFromFeeds({ asset: ETH_USD, quote: USDC_USD }), note: feedNote(ETH_USD, USDC_USD) };
  const pool = { ...poolRateFromSqrtPrice({ sqrtPriceX96: OPENING_S, ...SHAPE }), tick: OPENING_TICK };
  assert.equal(
    priceNoteFor({ feeds, pool, rate: bindingRate({ feeds, pool }) }),
    "ETH / USD 248103935330 at 1789302624 over USDC / USD 99984561 at 1789229592, pool at tick 198060 reads 0.9% over the feeds",
  );
  assert.equal(
    priceNoteFor({ feeds, pool: null, rate: bindingRate({ feeds, pool: null }) }),
    "ETH / USD 248103935330 at 1789302624 over USDC / USD 99984561 at 1789229592, pool price unread",
  );
  const level = { price: feeds.price, decimals: 18, tick: 198300 };
  assert.equal(
    priceNoteFor({ feeds, pool: level, rate: bindingRate({ feeds, pool: level }) }),
    "ETH / USD 248103935330 at 1789302624 over USDC / USD 99984561 at 1789229592, pool at tick 198300 level with the feeds",
  );
});

test("control: every figure on the line is one that was read — the line carries no number its inputs did not", () => {
  const feeds = { ...crossRateFromFeeds({ asset: ETH_USD, quote: USDC_USD }), note: feedNote(ETH_USD, USDC_USD) };
  const pool = { ...poolRateFromSqrtPrice({ sqrtPriceX96: LIVE_S, ...SHAPE }), tick: LIVE_TICK };
  const line = priceNoteFor({ feeds, pool, rate: bindingRate({ feeds, pool }) });
  const figures = line.match(/\d+(?:\.\d+)?/g);
  const known = new Set(["248103935330", "1789302624", "99984561", "1789229592", String(LIVE_TICK), "2.1"]);
  assert.deepEqual(figures.filter((f) => !known.has(f)), [], `unexplained figure on the line: ${line}`);
});

// ---- the register's order of reads, and the manifest ---------------------------------------------------

test("the register reads the pool after the feeds and before the opening rate, and the manifest names the StateView", () => {
  const js = readFileSync(new URL("../assets/cashier.js", import.meta.url), "utf8");
  const at = (re) => { const m = re.exec(js); assert.ok(m, `missing: ${re}`); return m.index; };
  const feeds = at(/const feeds = await readFeedRate\(market\);/);
  const pool = at(/const pool = await readPoolRate\(market\);/);
  const opening = at(/const opening = openingRateOf\(market\);/);
  assert.ok(feeds < pool && pool < opening, "the pool is read inside the feed branch, never as a source of its own");
  assert.match(js, /till\.priceNote = priceNoteFor\(\{ feeds, pool, rate \}\);/, "the sale line is the one the note builder writes");
  assert.match(js, /encodeCall\("getSlot0\(bytes32\)", \[poolId\]\)/, "slot0 is asked of the StateView by pool id");
  assert.match(js, /price: rate\.price,\s*priceDecimals: rate\.decimals,/, "the quote is worked out from the binding rate");
  const manifest = JSON.parse(readFileSync(new URL("../../../deployments/unica-v4/11155111.json", import.meta.url), "utf8"));
  assert.equal(manifest.market.stateView, "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C");
  assert.match(manifest.market.poolId, /^0x[0-9a-f]{64}$/i);
  assert.equal(manifest.market.assetIsCurrency0, false);
  assert.equal(manifest.market.assetDecimals, 18);
  assert.equal(manifest.market.payoutDecimals, 6);
});
