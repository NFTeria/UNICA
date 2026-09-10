import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_STALE_AFTER_SECONDS,
  headroomBasisPoints,
  quoteClearsMinimum,
  quoteIsFresh,
} from "../src/quote.js";
import { receiptKey, receiptHasPolicy, receiptTookFee, ZERO_POLICY_ID } from "../src/receipt.js";
import { paymentCanRetry, paymentIsInFlight, paymentIsTerminal } from "../src/payment.js";
import type { PaymentPhase } from "../src/payment.js";

const NOW = 1_789_057_411n;

test("a quote goes stale rather than refreshing under the reader", () => {
  assert.equal(quoteIsFresh({ readAtSeconds: NOW }, NOW), true);
  assert.equal(quoteIsFresh({ readAtSeconds: NOW - QUOTE_STALE_AFTER_SECONDS + 1n }, NOW), true);
  assert.equal(quoteIsFresh({ readAtSeconds: NOW - QUOTE_STALE_AFTER_SECONDS }, NOW), false);
});

test("a quote is measured against the order's floor, using the real numbers", () => {
  // The first V3 settlement paid 2.216294 USDC against a 0.5 USDC floor.
  assert.equal(quoteClearsMinimum({ amountOut: 2_216_294n }, 500_000n), true);
  assert.equal(quoteClearsMinimum({ amountOut: 400_000n }, 500_000n), false);
  assert.equal(quoteClearsMinimum({ amountOut: 500_000n }, 500_000n), true, "equal clears");
});

test("headroom is basis points of the floor, and refuses a zero floor", () => {
  assert.equal(headroomBasisPoints({ amountOut: 1_000_000n }, 500_000n), 10_000n); // +100%
  assert.equal(headroomBasisPoints({ amountOut: 500_000n }, 500_000n), 0n);
  assert.equal(headroomBasisPoints({ amountOut: 400_000n }, 500_000n), -2_000n); // -20%
  // control: a ratio against zero is not a number anyone should render.
  assert.equal(headroomBasisPoints({ amountOut: 1n }, 0n), null);
});

test("a receipt's reserved policy slot reads as absent, not as a value", () => {
  assert.equal(receiptHasPolicy({ policyId: ZERO_POLICY_ID }), false);
  assert.equal(receiptHasPolicy({ policyId: "0x" + "0".repeat(63) + "1" }), true);
});

test("the fee check is a check, not an assumption", () => {
  assert.equal(receiptTookFee({ fee: 0n }), false, "every receipt so far reads zero");
  assert.equal(receiptTookFee({ fee: 1n }), true);
});

test("a receipt key identifies one log, so two sources do not render it twice", () => {
  const hash = "0x4f4acbd1b1ed07eccbcf0d7c6f6fcb23a397b619dd3a1dd7fcf7ed7456768854"; // tx
  assert.equal(receiptKey({ transactionHash: hash, logIndex: 108 }), `${hash}#108`);
  // control: the same log read from an indexer and from a node must collapse to one key.
  assert.equal(
    receiptKey({ transactionHash: hash.toUpperCase().replace("0X", "0x"), logIndex: 108 }),
    receiptKey({ transactionHash: hash, logIndex: 108 }),
  );
});

test("in-flight phases are exactly the ones that must not open a second wallet request", () => {
  const inFlight: PaymentPhase[] = [
    { kind: "awaiting-signature" },
    { kind: "submitted" },
    { kind: "pending", transactionHash: "0xabc" },
  ];
  for (const p of inFlight) assert.equal(paymentIsInFlight(p), true, p.kind);

  const settled: PaymentPhase = {
    kind: "settled",
    receipt: {
      orderId: "0x" + "11".repeat(32),
      chainId: 11155111,
      recipient: "0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73",
      payer: "0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73",
      amountIn: 10n ** 15n,
      amountOut: 2_216_294n,
      fee: 0n,
      policyId: ZERO_POLICY_ID,
      transactionHash: "0xabc",
      blockNumber: 11_675_187n,
      logIndex: 108,
    },
  };
  const rest: PaymentPhase[] = [
    { kind: "idle" },
    { kind: "ready" },
    settled,
    { kind: "reverted", transactionHash: "0xabc", reason: null },
    { kind: "dismissed" },
    { kind: "failed", message: "no" },
  ];
  for (const p of rest) assert.equal(paymentIsInFlight(p), false, p.kind);

  assert.equal(paymentIsTerminal(settled), true);
  assert.equal(paymentCanRetry({ kind: "dismissed" }), true);
  assert.equal(paymentCanRetry(settled), false, "a settled payment must not offer a retry");
});
