// tools/unica-evidence — the direct-settlement authentication chain (authenticateDirectReceipt),
// against hand-built fixture logs and a hand-built `orders(orderId)` result. Every log below is
// built with `encodeLog` (real topics + real ABI data), so the decoder in `codec.mjs` is exercised
// on every row, never bypassed with a hand-typed object. No network, no live RPC:
// `node --test tools/unica-evidence/test/`.

import assert from "node:assert/strict";
import {test} from "node:test";

import {encodeLog} from "../codec.mjs";
import {authenticateDirectReceipt} from "../index.mjs";
import {
  CHAIN_ID,
  DIRECT_ASSET,
  DIRECT_PAYER,
  DIRECT_RECIPIENT,
  DIRECT_SETTLEMENT,
  DIRECT_SETTLEMENT_ID,
  LOOKALIKE_DIRECT_SETTLEMENT,
  ORDER_ID,
  bytes32,
  makeManifest,
} from "../fixtures.mjs";

const MANIFEST = makeManifest();
const TX1 = "0x" + "bb".repeat(32);
const SETTLED = 3; // UnicaMarketTypes.OrderStatus.Settled

const directReceiptLog = (overrides = {}) =>
  encodeLog(
    "DirectReceipt",
    {
      orderId: ORDER_ID,
      recipient: DIRECT_RECIPIENT,
      payer: DIRECT_PAYER,
      asset: DIRECT_ASSET,
      amount: 1_000_000n,
      terminalNode: bytes32(0x71),
      settledAt: 1_700_000_000n,
      ...overrides.fields,
    },
    {address: DIRECT_SETTLEMENT, blockNumber: "0x64", transactionHash: TX1, logIndex: "0x0", ...overrides.meta},
  );

const goldenOrder = (overrides = {}) => ({
  recipient: DIRECT_RECIPIENT,
  creator: DIRECT_SETTLEMENT,
  payer: DIRECT_PAYER,
  amountIn: 1_000_000n,
  minOut: 1_000_000n,
  deadline: 1_800_000_000n,
  status: SETTLED,
  ...overrides,
});

function run(overrides = {}) {
  return authenticateDirectReceipt({
    orderId: ORDER_ID,
    manifest: MANIFEST,
    chainHead: 200,
    requiredConfirmations: 0,
    directOrder: goldenOrder(),
    ...overrides,
  });
}

// ---- 1. a registered direct receipt, matching the settler's own stored order, is VERIFIED --------

test("a registered DirectReceipt whose settler order matches is VERIFIED", () => {
  const v = run({logs: [directReceiptLog()]});
  assert.equal(v.decision, "VERIFIED");
  assert.deepEqual(v.reasonCodes, []);
  assert.equal(v.kind, "direct");
  assert.equal(v.settlementAuthenticated, true);
  assert.equal(v.emitterMatched, true);
  assert.equal(v.orderMatched, true);
  assert.ok(v.receipt);
  assert.equal(v.receipt.kind, "direct");
  assert.equal(v.receipt.orderId.toLowerCase(), ORDER_ID.toLowerCase());
  assert.equal(v.receipt.amount, "1000000");
});

// ---- 2. look-alike settler ------------------------------------------------------------------------

test("a DirectReceipt emitted by a look-alike settler address is REFUSED, UNREGISTERED_EMITTER", () => {
  const logs = [directReceiptLog({meta: {address: LOOKALIKE_DIRECT_SETTLEMENT}})];
  const v = run({logs});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["UNREGISTERED_EMITTER"]);
  assert.equal(v.emitterMatched, false);
});

// ---- 3. stale/unfinalized: not enough confirmations yet, still UNKNOWN ----------------------------

test("a direct receipt at chainHead - block < requiredConfirmations is UNKNOWN, AWAITING_FINALITY", () => {
  const v = run({logs: [directReceiptLog()], chainHead: 105, requiredConfirmations: 12});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["AWAITING_FINALITY"]);
  assert.equal(v.finality.confirmations, 5);
  assert.equal(v.finality.final, false);
  // content was fully authenticated; only confirmation depth is in question
  assert.equal(v.emitterMatched, true);
  assert.equal(v.orderMatched, true);
  assert.ok(v.receipt);
});

// ---- extra: no configured settler, never REFUSED or VERIFIED -------------------------------------

test("a manifest with no directSettlement configured is UNKNOWN, DIRECT_SETTLEMENT_NOT_CONFIGURED", () => {
  const v = run({
    logs: [directReceiptLog()],
    manifest: {...MANIFEST, contracts: {...MANIFEST.contracts, directSettlement: undefined}},
  });
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["DIRECT_SETTLEMENT_NOT_CONFIGURED"]);
});

// ---- extra: no receipt at all ----------------------------------------------------------------------

test("no DirectReceipt for this orderId at all is REFUSED, MISSING_DIRECT_RECEIPT", () => {
  const v = run({logs: []});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["MISSING_DIRECT_RECEIPT"]);
  assert.equal(v.receipt, null);
});

// ---- extra: the settler's own SETTLEMENT_ID does not recompute to what the manifest names --------

test("a receipt whose recomputed SETTLEMENT_ID does not match the manifest's is REFUSED, SETTLEMENT_ID_MISMATCH", () => {
  const wrongId = bytes32(0xdead);
  const v = run({
    logs: [directReceiptLog()],
    manifest: {
      ...MANIFEST,
      contracts: {...MANIFEST.contracts, directSettlement: {...MANIFEST.contracts.directSettlement, settlementId: wrongId}},
    },
  });
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["SETTLEMENT_ID_MISMATCH"]);
});

test("recomputeSettlementId of a genuine fixture equals the fixture's own configured settlementId", () => {
  assert.equal(MANIFEST.contracts.directSettlement.settlementId, DIRECT_SETTLEMENT_ID);
});

// ---- extra: the settler's own stored order disagrees with the receipt ----------------------------

test("a receipt whose amount does not match the settler's own stored order is REFUSED, AMOUNT_MISMATCH", () => {
  const v = run({logs: [directReceiptLog()], directOrder: goldenOrder({amountIn: 2_000_000n})});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["AMOUNT_MISMATCH"]);
  assert.equal(v.orderMatched, false);
});

test("a receipt whose recipient does not match the settler's own stored order is REFUSED, ORDER_RECIPIENT_MISMATCH", () => {
  const v = run({logs: [directReceiptLog()], directOrder: goldenOrder({recipient: DIRECT_PAYER})});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["ORDER_RECIPIENT_MISMATCH"]);
});

test("a receipt whose payer does not match the settler's own stored order is REFUSED, ORDER_PAYER_MISMATCH", () => {
  const v = run({logs: [directReceiptLog()], directOrder: goldenOrder({payer: DIRECT_RECIPIENT})});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["ORDER_PAYER_MISMATCH"]);
});

test("a settler order that has not reached Settled is REFUSED, ORDER_NOT_SETTLED", () => {
  const v = run({logs: [directReceiptLog()], directOrder: goldenOrder({status: 2})}); // Paying
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["ORDER_NOT_SETTLED"]);
});

// ---- extra: no order lookup available yet — UNKNOWN, never treated as ALLOW ------------------------

test("a receipt with no fetched settler order yet is UNKNOWN, DIRECT_ORDER_UNAVAILABLE, never VERIFIED", () => {
  const v = run({logs: [directReceiptLog()], directOrder: null});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["DIRECT_ORDER_UNAVAILABLE"]);
});

// ---- extra: duplicate order ids ---------------------------------------------------------------------

test("two DirectReceipt logs naming the same orderId are REFUSED, DUPLICATE_ORDER_ID, first kept", () => {
  const second = directReceiptLog({meta: {transactionHash: "0x" + "cd".repeat(32), blockNumber: "0x65", logIndex: "0x0"}});
  const v = run({logs: [directReceiptLog(), second]});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["DUPLICATE_ORDER_ID"]);
  assert.equal(v.receipt.transactionHash.toLowerCase(), TX1.toLowerCase());
});

// ---- extra: reverted transaction, endpoint unavailable, chain id used in the requester -------------

test("a known-reverted transaction hash is REFUSED, TRANSACTION_REVERTED, before anything else is checked", () => {
  const v = run({
    logs: [],
    transactionHash: TX1,
    transactionReceipts: [{transactionHash: TX1, status: "0x0"}],
  });
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["TRANSACTION_REVERTED"]);
});

test("no chain head at all is UNKNOWN, EVIDENCE_ENDPOINT_UNAVAILABLE", () => {
  const v = run({logs: [directReceiptLog()], chainHead: undefined});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["EVIDENCE_ENDPOINT_UNAVAILABLE"]);
});

test("chainId " + CHAIN_ID + " is the fixture manifest's own chain id", () => {
  assert.equal(MANIFEST.chainId, CHAIN_ID);
});
