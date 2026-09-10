import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AmountFormatError,
  addAmounts,
  formatFixed,
  formatTokenAmount,
  formatUnits,
  parseUnits,
  tokenAmount,
} from "../src/token.js";

/**
 * The fixtures are the five real V3 settlements on Ethereum Sepolia, in USDC's smallest unit, as
 * read back from the chain. Using invented round numbers here would hide the one case that
 * actually bit: 1_452_240, whose trailing zero is real precision and disappears under a plain
 * format.
 */
const SETTLEMENTS = [2_216_294n, 1_774_099n, 1_452_240n, 1_210_685n, 1_024_770n];
const USDC_DECIMALS = 6;
const WEI = 18;

test("formatUnits renders each real settlement exactly", () => {
  assert.equal(formatUnits(2_216_294n, USDC_DECIMALS), "2.216294");
  assert.equal(formatUnits(1_774_099n, USDC_DECIMALS), "1.774099");
  assert.equal(formatUnits(1_210_685n, USDC_DECIMALS), "1.210685");
  assert.equal(formatUnits(1_024_770n, USDC_DECIMALS), "1.02477");
});

test("formatUnits strips trailing zeros, which is why formatFixed exists", () => {
  // Real precision, rendered as less precision. Correct for a sentence, wrong for a column.
  assert.equal(formatUnits(1_452_240n, USDC_DECIMALS), "1.45224");
  assert.equal(formatFixed(1_452_240n, USDC_DECIMALS, 6), "1.452240");
});

test("formatFixed pads every settlement to one width, so a column is a ledger", () => {
  const column = SETTLEMENTS.map((v) => formatFixed(v, USDC_DECIMALS, 6));
  assert.deepEqual(column, ["2.216294", "1.774099", "1.452240", "1.210685", "1.024770"]);
  const widths = new Set(column.map((s) => s.length));
  assert.equal(widths.size, 1, "a padded column must have exactly one width");
});

test("formatFixed truncates toward zero and never rounds up", () => {
  // Rounding up shows a payer more than the chain will deliver. 1.4522449 -> 1.45224, not 1.45225.
  assert.equal(formatFixed(1_452_249n, USDC_DECIMALS, 5), "1.45224");
  assert.equal(formatFixed(1_999_999n, USDC_DECIMALS, 2), "1.99");
  assert.equal(formatFixed(999_999n, USDC_DECIMALS, 0), "0");
  // ...in both directions, so "toward zero" is proven and not merely "floor".
  assert.equal(formatFixed(-1_452_249n, USDC_DECIMALS, 5), "-1.45224");
});

test("whole and zero amounts do not grow a stray point", () => {
  assert.equal(formatUnits(1_000_000n, USDC_DECIMALS), "1");
  assert.equal(formatUnits(0n, USDC_DECIMALS), "0");
  assert.equal(formatFixed(0n, USDC_DECIMALS, 6), "0.000000");
});

test("the 18-decimal native side survives without a float", () => {
  const oneFinney = 10n ** 15n; // the fixed 0.001 ETH input of every order the page registers
  assert.equal(formatUnits(oneFinney, WEI), "0.001");
  assert.equal(parseUnits("0.001", WEI), oneFinney);
  // A value no double can hold, round-tripped exactly.
  const awkward = 1_234_567_890_123_456_789n;
  assert.equal(parseUnits(formatUnits(awkward, WEI), WEI), awkward);
});

test("parseUnits round-trips every real settlement", () => {
  for (const value of SETTLEMENTS) {
    assert.equal(parseUnits(formatUnits(value, USDC_DECIMALS), USDC_DECIMALS), value);
    assert.equal(parseUnits(formatFixed(value, USDC_DECIMALS, 6), USDC_DECIMALS), value);
  }
});

test("parseUnits accepts the shapes a person actually types", () => {
  assert.equal(parseUnits("1", USDC_DECIMALS), 1_000_000n);
  assert.equal(parseUnits("1.", USDC_DECIMALS), 1_000_000n);
  assert.equal(parseUnits(".5", USDC_DECIMALS), 500_000n);
  assert.equal(parseUnits("  2.5  ", USDC_DECIMALS), 2_500_000n);
  assert.equal(parseUnits("-1.5", USDC_DECIMALS), -1_500_000n);
});

// ── the controls: every guard must be shown catching a bad input ────────────────────────────
// A check that has never failed is not a check. Each row below is a value the parser MUST refuse;
// if any one of them starts passing, the guard above it has quietly turned off.

test("control: excess precision is refused, not silently dropped", () => {
  // 1.0000005 USDC means something. Settling 1.000000 instead is the bug that only shows up in
  // someone's accounts, so it is refused at the boundary.
  assert.throws(() => parseUnits("1.0000005", USDC_DECIMALS), AmountFormatError);
  assert.throws(() => parseUnits("0.0000001", USDC_DECIMALS), AmountFormatError);
  // ...and the same digits are fine on the 18-decimal side, proving the rule is about the token.
  assert.equal(parseUnits("1.0000005", WEI), 1_000_000_500_000_000_000n);
});

test("control: an empty amount is unspecified, never zero", () => {
  assert.throws(() => parseUnits("", USDC_DECIMALS), AmountFormatError);
  assert.throws(() => parseUnits("   ", USDC_DECIMALS), AmountFormatError);
  assert.throws(() => parseUnits(".", USDC_DECIMALS), AmountFormatError);
  assert.throws(() => parseUnits("-", USDC_DECIMALS), AmountFormatError);
});

test("control: shapes that look numeric but are not exact are refused", () => {
  for (const bad of ["1e6", "1_000", "1,000", "0x10", "1.2.3", "abc", "1 000", "Infinity", "NaN"]) {
    assert.throws(() => parseUnits(bad, USDC_DECIMALS), AmountFormatError, `expected refusal: ${bad}`);
  }
});

test("control: adding across decimals is refused rather than coerced", () => {
  const usdc = tokenAmount(1_000_000n, 6);
  const wei = tokenAmount(1_000_000n, 18);
  assert.throws(() => addAmounts(usdc, wei), AmountFormatError);
  // The permitted case still works, so the guard is not simply refusing everything.
  assert.deepEqual(addAmounts(usdc, tokenAmount(216_294n, 6)), tokenAmount(1_216_294n, 6));
});

test("control: places beyond the token's decimals is a programming error, not a render", () => {
  assert.throws(() => formatFixed(1n, USDC_DECIMALS, 7), AmountFormatError);
  assert.throws(() => formatFixed(1n, USDC_DECIMALS, -1), AmountFormatError);
  assert.throws(() => formatUnits(1n, -1), AmountFormatError);
});

test("formatTokenAmount carries the symbol", () => {
  assert.equal(formatTokenAmount(tokenAmount(2_216_294n, 6), "USDC"), "2.216294 USDC");
});
