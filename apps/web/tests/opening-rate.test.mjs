// A market that runs without an oracle is priced by the register from the rate it was opened with.
// Pure rows on the helper and on the quote it feeds, with the bounds a real sale must satisfy, and
// controls for the two cases that must NOT use it: an oracle-on market, and a market with no rate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openingRateOf, quoteOrder, SLIPPAGE_BPS } from "../assets/product.js";

const RATE = "2515000000000000000000"; // 2,515 USDC per WETH, as config/unica-v4/11155111.env records it
const WETH = { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18 };
const USDC = { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 };

test("an oracle-off market with a recorded rate answers with that rate at 18 decimals", () => {
  assert.deepEqual(openingRateOf({ oracle: { enabled: false }, rateE18: RATE }), { price: 2515n * 10n ** 18n, decimals: 18 });
});

test("control: an oracle-on market never uses the opening rate, the adapter is its source", () => {
  assert.equal(openingRateOf({ oracle: { enabled: true }, rateE18: RATE }), null);
});

test("control: no recorded rate, or a zero one, prices nothing", () => {
  assert.equal(openingRateOf({ oracle: { enabled: false } }), null);
  assert.equal(openingRateOf({ oracle: { enabled: false }, rateE18: "0" }), null);
  assert.equal(openingRateOf({ oracle: { enabled: false }, rateE18: "not a number" }), null);
  assert.equal(openingRateOf(null), null);
});

test("2 USDC invoiced on that rate: the business floor is exactly 2 USDC and the spend is padded upward", () => {
  const opening = openingRateOf({ oracle: { enabled: false }, rateE18: RATE });
  const q = quoteOrder({ invoiceUnits: 2_000_000n, invoiceIn: "payout", customerAsset: WETH, payoutAsset: USDC, price: opening.price, priceDecimals: opening.decimals });
  assert.equal(q.minOut, 2_000_000n, "the business must end up with exactly what it typed");
  assert.equal(q.converted, true);
  // 2 / 2515 WETH is 0.000795228... ; the spend must sit above that by the slippage pad and no more.
  const exact = (2_000_000n * 10n ** 18n * 10n ** 18n) / (2515n * 10n ** 18n * 10n ** 6n);
  assert.ok(q.amountIn > exact, "the spend must exceed the exact figure");
  assert.ok(q.amountIn >= (exact * (10_000n + BigInt(SLIPPAGE_BPS))) / 10_000n, "the pad must be at least the allowed slippage");
  assert.ok(q.amountIn < (exact * (10_000n + BigInt(SLIPPAGE_BPS) + 5n)) / 10_000n, "the pad must not exceed the allowed slippage by more than rounding");
  assert.ok(q.amountIn > 790_000_000_000_000n && q.amountIn < 820_000_000_000_000n, "about 0.0008 WETH for 2 USDC");
});

test("the register asks for the opening rate before it asks an adapter, and a zero address is no source", () => {
  const js = readFileSync(new URL("../assets/cashier.js", import.meta.url), "utf8");
  const at = (re) => { const m = re.exec(js); assert.ok(m, `missing: ${re}`); return m.index; };
  const opening = at(/const opening = openingRateOf\(market\);/);
  const adapter = at(/const adapter = market\.adapter \?\? till\.config\.contracts\?\.oracleAdapter \?\? null;/);
  assert.ok(opening < adapter, "the opening rate must be tried first");
  assert.match(js, /\/\^0x0\{40\}\$\/i\.test\(String\(adapter\)\)/, "a zero address must be refused as a price source");
});
