import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUS_LABEL,
  OrderStatus,
  ZERO_ADDRESS,
  isOrderStatus,
  orderBlocker,
  orderHasPayer,
  orderIsExpired,
  orderIsPayable,
  secondsUntilDeadline,
} from "../src/order.js";
import type { Order } from "../src/order.js";

const NOW = 1_789_057_411n; // a real clock reading from this project's own chain reads

function order(over: Partial<Order> = {}): Order {
  return {
    id: "0x" + "11".repeat(32),
    chainId: 11155111,
    recipient: "0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73",
    creator: "0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73",
    payer: ZERO_ADDRESS,
    key: {
      currency0: ZERO_ADDRESS,
      currency1: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      fee: 3000,
      tickSpacing: 60,
      hooks: "0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0",
    },
    amountIn: 10n ** 15n,
    minOut: 500_000n,
    deadline: NOW + 3600n,
    status: OrderStatus.Open,
    ...over,
  };
}

test("the status numbering is the contract's, not ours", () => {
  // UnicaExecutorV3.Status is read out of a chain word. Renumbering here mislabels every order.
  assert.equal(OrderStatus.None, 0);
  assert.equal(OrderStatus.Open, 1);
  assert.equal(OrderStatus.Paying, 2);
  assert.equal(OrderStatus.Settled, 3);
  // ...and the labels line up with the ones the shipped page already renders.
  assert.deepEqual(
    [0, 1, 2, 3].map((n) => ORDER_STATUS_LABEL[n as OrderStatus]),
    ["none", "open", "paying", "settled"],
  );
});

test("an open, unexpired order is payable by anyone", () => {
  const o = order();
  assert.equal(orderIsPayable(o, NOW), true);
  assert.equal(orderBlocker(o, NOW), null);
  assert.equal(orderHasPayer(o), false, "an unpaid order carries the zero payer");
});

test("each blocker is distinct, because each needs a different sentence", () => {
  assert.equal(orderBlocker(order({ status: OrderStatus.None }), NOW), "unknown");
  assert.equal(orderBlocker(order({ status: OrderStatus.Settled }), NOW), "already-settled");
  assert.equal(orderBlocker(order({ status: OrderStatus.Paying }), NOW), "already-paying");
  assert.equal(orderBlocker(order({ deadline: NOW - 1n }), NOW), "expired");
});

test("a settled order reports settled, not expired, even when both are true", () => {
  // The contract checks status before deadline. A payer told "expired" about a paid order would
  // reasonably try again; the order in which these are reported is part of the answer.
  const o = order({ status: OrderStatus.Settled, deadline: NOW - 1n });
  assert.equal(orderBlocker(o, NOW), "already-settled");
});

test("the deadline boundary is exclusive, matching the contract's refusal", () => {
  assert.equal(orderIsExpired(order({ deadline: NOW }), NOW), true, "deadline == now is expired");
  assert.equal(orderIsExpired(order({ deadline: NOW + 1n }), NOW), false);
});

test("a countdown never renders negative", () => {
  assert.equal(secondsUntilDeadline(order({ deadline: NOW + 90n }), NOW), 90n);
  assert.equal(secondsUntilDeadline(order({ deadline: NOW - 10_000n }), NOW), 0n);
});

// ── controls ────────────────────────────────────────────────────────────────────────────────

test("control: a payer address is recognised case-insensitively", () => {
  assert.equal(orderHasPayer({ payer: ZERO_ADDRESS.toUpperCase().replace("0X", "0x") }), false);
  assert.equal(orderHasPayer({ payer: "0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73" }), true);
});

test("control: a status outside the contract's four is refused", () => {
  assert.equal(isOrderStatus(4), false);
  assert.equal(isOrderStatus(-1), false);
  for (const n of [0, 1, 2, 3]) assert.equal(isOrderStatus(n), true);
});
