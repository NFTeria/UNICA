// tools/unica-evidence — the ten-link receipt-authentication chain, against hand-built fixture
// logs. Every log below is built with `encodeLog` (real topics + real ABI data), so the decoder in
// `codec.mjs` is exercised on every row, never bypassed with a hand-typed object. No network, no
// live RPC: `node --test tools/unica-evidence/test/`.

import assert from "node:assert/strict";
import {test} from "node:test";

import {encodeLog} from "../codec.mjs";
import {authenticateReceipt, receiptByOrderId} from "../index.mjs";
import {
  ASSET,
  CHAIN_ID,
  EXECUTOR,
  FEED_ID,
  HOOK,
  LOOKALIKE_EXECUTOR,
  LOOKALIKE_HOOK,
  MARKET_ID,
  MARKET_VERSION,
  ORDER_ID,
  PAYER,
  PAYOUT,
  POOL_ID,
  RECIPIENT,
  REGISTRY,
  ZERO_ADDR,
  makeManifest,
} from "../fixtures.mjs";

const MANIFEST = makeManifest();
const TX1 = "0x" + "aa".repeat(32);

const marketProposedLog = (overrides = {}) =>
  encodeLog(
    "MarketProposed",
    {
      marketId: MARKET_ID,
      asset: ASSET,
      payout: PAYOUT,
      version: MARKET_VERSION,
      hook: HOOK,
      executor: EXECUTOR,
      poolId: POOL_ID,
      fee: 3000,
      tickSpacing: 60,
      rateE18: 1_000_000_000_000_000_000n,
      initSqrtPriceX96: 79228162514264337593543950336n,
      initTick: 0,
      demonstrationOnly: true,
      ...overrides.fields,
    },
    {address: REGISTRY, blockNumber: "0xa", transactionHash: "0x" + "01".repeat(32), logIndex: "0x0", ...overrides.meta},
  );

const oraclePolicyLog = (overrides = {}) =>
  encodeLog(
    "OraclePolicySet",
    {marketId: MARKET_ID, adapter: ZERO_ADDR, feedId: FEED_ID, maxAge: 0, maxDeviationBps: 0, enabled: false, ...overrides.fields},
    {address: REGISTRY, blockNumber: "0xa", transactionHash: "0x" + "01".repeat(32), logIndex: "0x1", ...overrides.meta},
  );

const receiptLog = (overrides = {}) =>
  encodeLog(
    "SettlementReceipt",
    {
      orderId: ORDER_ID,
      recipient: RECIPIENT,
      payer: PAYER,
      marketId: MARKET_ID,
      currencyIn: ASSET,
      currencyOut: PAYOUT,
      amountIn: 1_000_000n,
      amountOut: 500_000n,
      hookFeePips: 0,
      lpFeePips: 3000,
      protocolFeePips: 0,
      swapFeePips: 3000,
      referencePrice: 0n,
      referenceDecimals: 0,
      referenceUpdatedAt: 0n,
      demonstrationOnly: true,
      ...overrides.fields,
    },
    {address: HOOK, blockNumber: "0x64", transactionHash: TX1, logIndex: "0x0", ...overrides.meta},
  );

const settledLog = (overrides = {}) =>
  encodeLog(
    "Settled",
    {
      orderId: ORDER_ID,
      payer: PAYER,
      recipient: RECIPIENT,
      currencyIn: ASSET,
      currencyOut: PAYOUT,
      amountIn: 1_000_000n,
      amountDelivered: 500_000n,
      ...overrides.fields,
    },
    {address: EXECUTOR, blockNumber: "0x64", transactionHash: TX1, logIndex: "0x1", ...overrides.meta},
  );

const swapLog = (overrides = {}) =>
  encodeLog(
    "Swap",
    {
      id: POOL_ID,
      sender: EXECUTOR,
      amount0: -1_000_000n,
      amount1: 500_000n,
      sqrtPriceX96: 79228162514264337593543950336n,
      liquidity: 1_000_000_000n,
      tick: 0,
      fee: 3000,
      ...overrides.fields,
    },
    {address: "0x" + "40".padStart(40, "0"), blockNumber: "0x64", transactionHash: TX1, logIndex: "0x2", ...overrides.meta},
  );

function goldenLogs() {
  return [marketProposedLog(), oraclePolicyLog(), receiptLog(), settledLog()];
}

function run(overrides = {}) {
  return authenticateReceipt({
    orderId: ORDER_ID,
    manifest: MANIFEST,
    chainHead: 200,
    requiredConfirmations: 0,
    ...overrides,
  });
}

// ---- 1. registered legitimate receipt -------------------------------------------------------------

test("a registered receipt, paired with Settled in the same transaction, is VERIFIED", () => {
  const v = run({logs: goldenLogs()});
  assert.equal(v.decision, "VERIFIED");
  assert.deepEqual(v.reasonCodes, []);
  assert.equal(v.registryAuthenticated, true);
  assert.equal(v.marketAuthenticated, true);
  assert.equal(v.hookMatched, true);
  assert.equal(v.executorMatched, true);
  assert.equal(v.poolMatched, true);
  assert.ok(v.receipt);
  assert.equal(v.receipt.orderId.toLowerCase(), ORDER_ID.toLowerCase());
  assert.equal(v.marketVersion, MARKET_VERSION);
});

test("receiptByOrderId returns the QUERIES.graphql ReceiptByOrderId shape for a verified order", () => {
  const r = receiptByOrderId({orderId: ORDER_ID, manifest: MANIFEST, chainHead: 200, logs: goldenLogs()});
  assert.ok(r.settlement);
  assert.equal(r.settlement.id.toLowerCase(), ORDER_ID.toLowerCase());
  assert.equal(r.settlement.market.id.toLowerCase(), MARKET_ID.toLowerCase());
  assert.equal(r.settlement.amountOut, "500000");
  assert.equal(r.order, null);
});

// ---- 2. look-alike receipt from an unregistered hook ----------------------------------------------

test("a SettlementReceipt from an address that is not the registered hook is REFUSED", () => {
  const logs = [marketProposedLog(), oraclePolicyLog(), receiptLog({meta: {address: LOOKALIKE_HOOK}}), settledLog()];
  const v = run({logs});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["UNREGISTERED_EMITTER", "HOOK_PROVENANCE_MISMATCH"]);
  assert.equal(v.hookMatched, false);
});

// ---- 3. unknown executor -------------------------------------------------------------------------

test("a Settled from an address that is not the registered executor is REFUSED", () => {
  const logs = [marketProposedLog(), oraclePolicyLog(), receiptLog(), settledLog({meta: {address: LOOKALIKE_EXECUTOR}})];
  const v = run({logs});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["EXECUTOR_MISMATCH", "MISSING_EXECUTOR_SETTLED"]);
  assert.equal(v.executorMatched, false);
});

// ---- 4. mismatched pool key ----------------------------------------------------------------------

test("a Swap in the same transaction whose poolId does not match the market's is REFUSED", () => {
  const logs = [...goldenLogs(), swapLog({fields: {id: "0x" + "ff".repeat(32)}})];
  const v = run({logs});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["POOL_MISMATCH"]);
  assert.equal(v.poolMatched, false);
});

test("a receipt whose currencies do not match the market's asset/payout is REFUSED", () => {
  const logs = [marketProposedLog(), oraclePolicyLog(), receiptLog({fields: {currencyOut: "0x" + "99".repeat(20)}}), settledLog()];
  const v = run({logs});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["POOL_MISMATCH"]);
});

// ---- 5. hook receipt with no matching executor settlement -----------------------------------------

test("a hook receipt with no Settled at all is REFUSED, MISSING_EXECUTOR_SETTLED", () => {
  const logs = [marketProposedLog(), oraclePolicyLog(), receiptLog()];
  const v = run({logs});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["MISSING_EXECUTOR_SETTLED"]);
});

// ---- 6. executor settlement with no matching hook receipt ------------------------------------------

test("a Settled with no SettlementReceipt for the order at all is REFUSED, MISSING_HOOK_RECEIPT", () => {
  const logs = [marketProposedLog(), oraclePolicyLog(), settledLog()];
  const v = run({logs});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["MISSING_HOOK_RECEIPT"]);
  assert.equal(v.receipt, null);
});

// ---- 7. duplicate order ids ------------------------------------------------------------------------

test("two SettlementReceipt logs naming the same orderId are REFUSED, DUPLICATE_ORDER_ID, first kept", () => {
  const second = receiptLog({meta: {transactionHash: "0x" + "cc".repeat(32), blockNumber: "0x65", logIndex: "0x0"}});
  const logs = [marketProposedLog(), oraclePolicyLog(), receiptLog(), settledLog(), second];
  const v = run({logs});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["DUPLICATE_ORDER_ID"]);
  assert.equal(v.receipt.transactionHash.toLowerCase(), TX1.toLowerCase()); // the first-seen (lower block) kept
});

// ---- 8. reverted transaction: no logs, but a known tx hash with status 0 --------------------------

test("a known-reverted transaction hash is REFUSED, TRANSACTION_REVERTED, before anything else is checked", () => {
  const v = run({
    logs: [],
    transactionHash: TX1,
    transactionReceipts: [{transactionHash: TX1, status: "0x0"}],
  });
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["TRANSACTION_REVERTED"]);
});

// ---- 9. unfinalized -----------------------------------------------------------------------------

test("a receipt at chainHead - block < requiredConfirmations is UNKNOWN, AWAITING_FINALITY", () => {
  const v = run({logs: goldenLogs(), chainHead: 105, requiredConfirmations: 12});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["AWAITING_FINALITY"]);
  assert.equal(v.finality.confirmations, 5);
  assert.equal(v.finality.final, false);
  // content was fully authenticated; only confirmation depth is in question
  assert.equal(v.hookMatched, true);
  assert.equal(v.executorMatched, true);
  assert.ok(v.receipt);
});

// ---- 10. paused / retired context -----------------------------------------------------------------

test("a market retired AFTER this receipt's block stays VERIFIED, labelled MARKET_RETIRED_AT_INDEX", () => {
  const retirement = encodeLog(
    "MarketStatusChanged",
    {marketId: MARKET_ID, from: 4, to: 6},
    {address: REGISTRY, blockNumber: "0xc8", transactionHash: "0x" + "05".repeat(32), logIndex: "0x0"}, // block 200, after receipt's 0x64
  );
  const v = run({logs: [...goldenLogs(), retirement]});
  assert.equal(v.decision, "VERIFIED");
  assert.deepEqual(v.reasonCodes, ["MARKET_RETIRED_AT_INDEX"]);
  assert.equal(v.marketStatusAtIndex, 6);
});

test("a market retired BEFORE this receipt's block is REFUSED, RECEIPT_AFTER_RETIREMENT", () => {
  const retirement = encodeLog(
    "MarketStatusChanged",
    {marketId: MARKET_ID, from: 4, to: 6},
    {address: REGISTRY, blockNumber: "0x1", transactionHash: "0x" + "05".repeat(32), logIndex: "0x0"}, // block 1, before receipt's 0x64
  );
  const v = run({logs: [...goldenLogs(), retirement]});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["RECEIPT_AFTER_RETIREMENT"]);
});

test("a market currently paused (as of index) stays VERIFIED, labelled MARKET_PAUSED_AT_INDEX", () => {
  const pause = encodeLog(
    "MarketStatusChanged",
    {marketId: MARKET_ID, from: 4, to: 5},
    {address: REGISTRY, blockNumber: "0xc8", transactionHash: "0x" + "06".repeat(32), logIndex: "0x0"},
  );
  const v = run({logs: [...goldenLogs(), pause]});
  assert.equal(v.decision, "VERIFIED");
  assert.deepEqual(v.reasonCodes, ["MARKET_PAUSED_AT_INDEX"]);
  assert.equal(v.marketStatusAtIndex, 5);
});

// ---- 11. historical version lookup ------------------------------------------------------------------

test("a receipt on a market that is not the latest version for its pair stays VERIFIED, labelled HISTORICAL_VERSION", () => {
  const laterVersion = marketProposedLog({
    fields: {version: 2},
    meta: {blockNumber: "0xc8", transactionHash: "0x" + "07".repeat(32), logIndex: "0x0"},
  });
  const v = run({logs: [...goldenLogs(), laterVersion]});
  assert.equal(v.decision, "VERIFIED");
  assert.deepEqual(v.reasonCodes, ["HISTORICAL_VERSION"]);
});

// ---- 12. stale index -----------------------------------------------------------------------------

test("an index watermark behind the receipt's own block is UNKNOWN, INDEX_BEHIND_REQUIRED_BLOCK", () => {
  const v = run({logs: goldenLogs(), indexHead: 50}); // receipt is at block 0x64 == 100
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["INDEX_BEHIND_REQUIRED_BLOCK"]);
});

// ---- 13. endpoint unavailable ----------------------------------------------------------------------

test("no chain head at all is UNKNOWN, EVIDENCE_ENDPOINT_UNAVAILABLE", () => {
  const v = run({logs: goldenLogs(), chainHead: undefined});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["EVIDENCE_ENDPOINT_UNAVAILABLE"]);
});

// ---- extra: registry not configured, and UNKNOWN never looks like a boolean -----------------------

test("a manifest with no registry address is UNKNOWN, REGISTRY_NOT_CONFIGURED, never REFUSED or VERIFIED", () => {
  const v = run({logs: goldenLogs(), manifest: {...MANIFEST, contracts: {...MANIFEST.contracts, registry: undefined}}});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["REGISTRY_NOT_CONFIGURED"]);
});

test("a MarketProposed for this marketId from a non-registry address is noted but does not, by itself, authenticate the market", () => {
  const spoofedRegistry = "0x" + "77".repeat(20);
  const logs = [marketProposedLog({meta: {address: spoofedRegistry, transactionHash: "0x" + "08".repeat(32)}}), receiptLog(), settledLog()];
  const v = run({logs});
  assert.equal(v.decision, "REFUSED");
  assert.ok(v.reasonCodes.includes("MARKET_NOT_REGISTERED"));
  assert.ok(v.reasonCodes.includes("REGISTRY_MISMATCH"));
});
