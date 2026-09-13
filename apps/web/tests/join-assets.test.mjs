// The join screen's one sentence about assets is composed from the deployment's asset list, never typed.
import test from "node:test";
import assert from "node:assert/strict";
import { assetsSentence } from "../assets/join-sepolia.js";

const SEPOLIA = { assets: [
  { key: "payoutToken", role: "payout", symbol: "USDC", decimals: 6 },
  { key: "assetToken", role: "customer", symbol: "WETH", decimals: 18 },
] };

test("Sepolia: paid in USDC, customers pay USDC directly or WETH through the market", () => {
  assert.equal(assetsSentence(SEPOLIA), "Paid in USDC. Customers pay in USDC directly, or WETH through the Uniswap v4 market. Products can be priced in USDC, WETH or any ERC-20 you name.");
});

test("a deployment with only a payout asset does not mention a market", () => {
  const s = assetsSentence({ assets: [{ role: "payout", symbol: "USDC" }] });
  assert.equal(s, "Paid in USDC. Customers pay in USDC directly. Products can be priced in USDC or any ERC-20 you name.");
  assert.doesNotMatch(s, /Uniswap/);
});

test("control: no payout asset, no sentence", () => {
  assert.equal(assetsSentence({ assets: [{ role: "customer", symbol: "WETH" }] }), "");
  assert.equal(assetsSentence(null), "");
  assert.equal(assetsSentence({}), "");
});

test("the route carries the line and the screen fills it", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../src/routes/join.mjs", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../assets/local-join.js", import.meta.url), "utf8");
  assert.match(route, /statusRegion\("name-assets"/);
  assert.match(screen, /say\("name-assets", planner\.assetsSentence\(config\)/);
});
