// receiptsForRecipient lists; it never judges. Both receipt shapes, one wallet, newest first, malformed skipped.
import assert from "node:assert/strict";
import {test} from "node:test";
import {encodeLog} from "../codec.mjs";
import {receiptsForRecipient} from "../index.mjs";

const ME = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const OTHER = "0xa121e1ef31bbf0826aa67dc01e7977e80af58d73";
const ORDER = (n) => "0x" + n.toString(16).padStart(64, "0");
const H = (n) => "0x" + n.toString(16);

const direct = (n, recipient, block, idx) => ({
  ...encodeLog("DirectReceipt", {orderId: ORDER(n), recipient, payer: OTHER, asset: OTHER, amount: 2500000n, terminalNode: ORDER(9), settledAt: 1700000000n + BigInt(n)}),
  address: OTHER, blockNumber: H(block), logIndex: H(idx), transactionHash: ORDER(100 + n),
});
const market = (n, recipient, block, idx) => ({
  ...encodeLog("SettlementReceipt", {
    orderId: ORDER(n), recipient, payer: OTHER, marketId: ORDER(7), currencyIn: OTHER, currencyOut: ME, amountIn: 10n ** 18n, amountOut: 1987612n,
    hookFeePips: 0, lpFeePips: 3000, protocolFeePips: 0, swapFeePips: 3000, referencePrice: 2n * 10n ** 8n, referenceDecimals: 8, referenceUpdatedAt: 1700000000n, demonstrationOnly: true,
  }),
  address: OTHER, blockNumber: H(block), logIndex: H(idx), transactionHash: ORDER(200 + n),
});

test("both receipt shapes for one wallet, newest first, other wallets and malformed logs skipped", () => {
  const logs = [direct(1, ME, 10, 0), market(2, ME, 12, 3), direct(3, OTHER, 13, 0), market(4, ME, 12, 1), {topics: ["0x00"], data: "0x"}];
  const rows = receiptsForRecipient({logs, recipient: ME.toUpperCase().replace("0X", "0x")});
  assert.deepEqual(rows.map((r) => [r.kind, r.orderId, r.blockNumber, r.logIndex]), [
    ["market", ORDER(2), 12, 3],
    ["market", ORDER(4), 12, 1],
    ["direct", ORDER(1), 10, 0],
  ]);
  assert.equal(rows[2].amount, "2500000");
  assert.equal(rows[2].settledAt, 1700000001);
  assert.equal(rows[0].amount, "1987612");
  assert.equal(rows[0].settledAt, null, "a market receipt carries no time of its own; the block does");
  assert.equal(rows[0].asset.toLowerCase(), ME);
});

test("no wallet, a malformed wallet, or no logs list nothing rather than everything", () => {
  assert.deepEqual(receiptsForRecipient({logs: [direct(1, ME, 1, 0)], recipient: null}), []);
  assert.deepEqual(receiptsForRecipient({logs: [direct(1, ME, 1, 0)], recipient: "0x12"}), []);
  assert.deepEqual(receiptsForRecipient({logs: [], recipient: ME}), []);
  assert.deepEqual(receiptsForRecipient({}), []);
});
