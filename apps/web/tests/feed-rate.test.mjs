// The register prices a converted sale from the two Chainlink feeds the deployment names, crossed
// here. Pure rows on the cross, on the round decoder, and on the order of sources in the register.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crossRateFromFeeds, quoteOrder } from "../assets/product.js";
import { decodeLatestRoundData } from "../assets/cashier.js";

// vector: the two Sepolia feeds as read on 2026-09-13 (ETH / USD and USDC / USD, 8 decimals each)
const ETH_USD = { answer: 247402000000n, decimals: 8, updatedAt: 1789298928 };
const USDC_USD = { answer: 99984561n, decimals: 8, updatedAt: 1789229592 };

test("ETH/USD over USDC/USD crosses to about 2,474 USDC per WETH at 18 decimals", () => {
  const r = crossRateFromFeeds({ asset: ETH_USD, quote: USDC_USD });
  assert.ok(r, "the cross must answer for two live legs");
  assert.equal(r.decimals, 18);
  assert.ok(r.price > 2474n * 10n ** 18n && r.price < 2475n * 10n ** 18n, `got ${r.price}`);
  assert.equal(r.updatedAt, 1789229592, "the cross is as old as its older leg");
});

test("2 USDC on that cross: the floor is exactly 2 USDC and the spend is about 0.0008 WETH", () => {
  const r = crossRateFromFeeds({ asset: ETH_USD, quote: USDC_USD });
  const q = quoteOrder({ invoiceUnits: 2_000_000n, invoiceIn: "payout", customerAsset: { decimals: 18, address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" }, payoutAsset: { decimals: 6, address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" }, price: r.price, priceDecimals: r.decimals });
  assert.equal(q.minOut, 2_000_000n);
  assert.ok(q.amountIn > 800_000_000_000_000n && q.amountIn < 840_000_000_000_000n, `got ${q.amountIn}`);
});

test("control: a dead leg prices nothing", () => {
  assert.equal(crossRateFromFeeds({ asset: { ...ETH_USD, answer: 0n }, quote: USDC_USD }), null);
  assert.equal(crossRateFromFeeds({ asset: ETH_USD, quote: null }), null);
  assert.equal(crossRateFromFeeds({ asset: ETH_USD, quote: { ...USDC_USD, answer: "x" } }), null);
});

test("latestRoundData decodes the answer and the publish time from the five words", () => {
  const w = (n) => BigInt(n).toString(16).padStart(64, "0");
  // vector: roundId 7, answer 247402000000, startedAt 1789298900, updatedAt 1789298928, answeredInRound 7
  const hex = "0x" + w(7) + w(247402000000n) + w(1789298900) + w(1789298928) + w(7);
  assert.deepEqual(decodeLatestRoundData(hex), { answer: 247402000000n, updatedAt: 1789298928 });
  assert.equal(decodeLatestRoundData("0x" + w(1) + w(2)), null, "fewer than five words is not a round");
  assert.equal(decodeLatestRoundData("0x" + w(7) + "f".repeat(64) + w(1) + w(1) + w(7)), null, "a negative answer is not a price");
});

test("the register tries the feeds first, then the opening rate, and the manifest names both feeds", () => {
  const js = readFileSync(new URL("../assets/cashier.js", import.meta.url), "utf8");
  const at = (re) => { const m = re.exec(js); assert.ok(m, `missing: ${re}`); return m.index; };
  assert.ok(at(/const feeds = await readFeedRate\(market\);/) < at(/const opening = openingRateOf\(market\);/));
  assert.match(js, /priced from \$\{till\.priceNote\}/, "the sale line must name what it was priced from");
  const manifest = JSON.parse(readFileSync(new URL("../../../deployments/unica-v4/11155111.json", import.meta.url), "utf8"));
  assert.equal(manifest.market.assetFeed, "0x694AA1769357215DE4FAC081bf1f309aDC325306");
  assert.equal(manifest.market.quoteFeed, "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E");
});
