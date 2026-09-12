// tools/unica-evidence — the product-catalogue authentication chain (authenticateProductSale),
// against hand-built fixture logs. Every log below is built with `encodeLog` (real topics, real ABI
// data), so the decoder in `codec.mjs` is exercised on every row and never bypassed with a
// hand-typed object. No network, no live RPC:
// `node --test tools/unica-evidence/test/authenticate-product.test.mjs`.
//
// THE ROW THIS FILE EXISTS FOR is the look-alike catalogue. Anybody can deploy the same source and
// sell the same named product at the same price to the same buyer; the sale event they emit is
// identical in every field a shopper can see, which `test/unica-v5/ProductCatalogAttacks.t.sol` S6
// measures on the chain itself. The only thing that tells the two apart is the address the log came
// from, so that is the check, and this is where it is proved.

import assert from "node:assert/strict";
import {test} from "node:test";

import {encodeLog} from "../codec.mjs";
import {authenticateProductSale} from "../index.mjs";
import {
  CATALOG_ID,
  CHAIN_ID,
  LOOKALIKE_PRODUCT_CATALOG,
  PRODUCT_ASSET,
  PRODUCT_BUYER,
  PRODUCT_CATALOG,
  PRODUCT_PAYOUT,
  PRODUCT_SELLER,
  SALE_ID,
  bytes32,
  makeManifest,
} from "../fixtures.mjs";

const MANIFEST = makeManifest();
const TX1 = "0x" + "ee".repeat(32);

const ONE_OFF = 0;
const RECURRING = 1;
const PERMANENT = 2;

const soldLog = (overrides = {}) =>
  encodeLog(
    "ProductSold",
    {
      productId: 1n,
      buyer: PRODUCT_BUYER,
      seller: PRODUCT_SELLER,
      payout: PRODUCT_PAYOUT,
      asset: PRODUCT_ASSET,
      amount: 25_000_000n,
      kind: PERMANENT,
      paidThrough: 0n,
      saleId: SALE_ID,
      ...overrides.fields,
    },
    {address: PRODUCT_CATALOG, blockNumber: "0x64", transactionHash: TX1, logIndex: "0x0", ...overrides.meta},
  );

function run(overrides = {}) {
  return authenticateProductSale({
    saleId: SALE_ID,
    manifest: MANIFEST,
    chainHead: 200,
    requiredConfirmations: 0,
    ...overrides,
  });
}

// ---- 1. a sale from the catalogue the deployment names is VERIFIED -------------------------------

test("a ProductSold from the registered catalogue is VERIFIED, with the sale on the receipt", () => {
  const v = run({logs: [soldLog()]});
  assert.equal(v.decision, "VERIFIED");
  assert.deepEqual(v.reasonCodes, []);
  assert.equal(v.kind, "product");
  assert.equal(v.catalogAuthenticated, true);
  assert.equal(v.emitterMatched, true);
  assert.equal(v.catalogIdMatched, true);
  assert.equal(v.fieldsConsistent, true);
  assert.equal(v.receipt.saleId.toLowerCase(), SALE_ID.toLowerCase());
  assert.equal(v.receipt.productId, "1");
  assert.equal(v.receipt.productKind, "permanent");
  assert.equal(v.receipt.amount, "25000000");
  assert.equal(v.receipt.recipient.toLowerCase(), PRODUCT_PAYOUT.toLowerCase());
  assert.equal(v.receipt.buyer.toLowerCase(), PRODUCT_BUYER.toLowerCase());
  assert.equal(v.receipt.catalog.toLowerCase(), PRODUCT_CATALOG.toLowerCase());
});

test("a recurring sale carries the date the buyer is now covered to", () => {
  const v = run({logs: [soldLog({fields: {kind: RECURRING, paidThrough: 1_702_592_000n}})]});
  assert.equal(v.decision, "VERIFIED");
  assert.equal(v.receipt.productKind, "recurring");
  assert.equal(v.receipt.paidThrough, "1702592000");
});

test("a one-off sale is verified and covers no stretch of time", () => {
  const v = run({logs: [soldLog({fields: {kind: ONE_OFF}})]});
  assert.equal(v.decision, "VERIFIED");
  assert.equal(v.receipt.productKind, "one-off");
  assert.equal(v.receipt.paidThrough, "0");
});

// ---- 2. the look-alike catalogue: identical shape, unnamed address ---------------------------------

test("the same sale emitted by a look-alike catalogue is REFUSED, UNREGISTERED_EMITTER", () => {
  const genuine = soldLog();
  const counterfeit = soldLog({meta: {address: LOOKALIKE_PRODUCT_CATALOG}});
  // The control that makes this row mean something: the two logs are the same event, field for
  // field. Only `address` differs, so the refusal below is the emitter check and nothing else.
  assert.deepEqual(counterfeit.topics, genuine.topics);
  assert.equal(counterfeit.data, genuine.data);

  const v = run({logs: [counterfeit]});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["UNREGISTERED_EMITTER"]);
  assert.equal(v.emitterMatched, false);
  assert.equal(v.receipt, null);

  // control: the byte-identical log from the named catalogue verifies.
  assert.equal(run({logs: [genuine]}).decision, "VERIFIED");
});

// ---- 3. the manifest must be internally consistent about which catalogue it means -----------------

test("a manifest whose recorded catalogId does not recompute from its own address is REFUSED", () => {
  const v = run({
    logs: [soldLog()],
    manifest: makeManifest({
      contracts: {productCatalog: {address: PRODUCT_CATALOG, catalogId: bytes32(0xdead)}},
    }),
  });
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["CATALOG_ID_MISMATCH"]);
});

test("the fixture manifest's own catalogId is the recomputed one, on chain " + CHAIN_ID, () => {
  assert.equal(MANIFEST.contracts.productCatalog.catalogId, CATALOG_ID);
  assert.equal(MANIFEST.chainId, CHAIN_ID);
});

// ---- 4. fields a registered catalogue could not have emitted ---------------------------------------

test("a kind outside the three the contract knows is REFUSED, UNKNOWN_PRODUCT_KIND", () => {
  const v = run({logs: [soldLog({fields: {kind: 7}})]});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["UNKNOWN_PRODUCT_KIND"]);
  assert.equal(v.fieldsConsistent, false);
});

test("a paid-through date on a kind that covers no stretch of time is REFUSED", () => {
  const v = run({logs: [soldLog({fields: {kind: PERMANENT, paidThrough: 1_702_592_000n}})]});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["PAID_THROUGH_ON_NON_RECURRING"]);
});

test("a recurring sale with no paid-through date at all is REFUSED", () => {
  const v = run({logs: [soldLog({fields: {kind: RECURRING, paidThrough: 0n}})]});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["RECURRING_WITHOUT_PAID_THROUGH"]);
});

test("a sale for nothing is REFUSED, ZERO_AMOUNT — the catalogue refuses a price of zero at listing", () => {
  const v = run({logs: [soldLog({fields: {amount: 0n}})]});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["ZERO_AMOUNT"]);
});

// ---- 5. nothing to judge, and nothing configured to judge it against -------------------------------

test("no ProductSold for this saleId at all is REFUSED, MISSING_PRODUCT_SALE", () => {
  const v = run({logs: []});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["MISSING_PRODUCT_SALE"]);
  assert.equal(v.receipt, null);
});

test("a deployment with no catalogue is UNKNOWN, PRODUCT_CATALOG_NOT_CONFIGURED, never REFUSED", () => {
  const manifest = makeManifest();
  delete manifest.contracts.productCatalog;
  const v = run({logs: [soldLog()], manifest});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["PRODUCT_CATALOG_NOT_CONFIGURED"]);
  assert.equal(v.catalogAuthenticated, false);
});

test("a sale id that is not a 32-byte hash is UNKNOWN, MALFORMED_SALE_ID", () => {
  for (const bad of [undefined, null, "", "0x12", 7, bytes32(1).slice(0, -1)]) {
    const v = run({saleId: bad, logs: [soldLog()]});
    assert.equal(v.decision, "UNKNOWN", String(bad));
    assert.deepEqual(v.reasonCodes, ["MALFORMED_SALE_ID"]);
  }
});

test("no chain head at all is UNKNOWN, EVIDENCE_ENDPOINT_UNAVAILABLE", () => {
  const v = run({logs: [soldLog()], chainHead: undefined});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["EVIDENCE_ENDPOINT_UNAVAILABLE"]);
});

// ---- 6. finality, an index that has not caught up, and a duplicated id ------------------------------

test("a sale shallower than the required confirmations is UNKNOWN, AWAITING_FINALITY", () => {
  const v = run({logs: [soldLog()], chainHead: 105, requiredConfirmations: 12});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["AWAITING_FINALITY"]);
  assert.equal(v.finality.confirmations, 5);
  assert.equal(v.finality.final, false);
  // everything else was authenticated; only the depth is in question
  assert.equal(v.emitterMatched, true);
  assert.equal(v.fieldsConsistent, true);
  assert.ok(v.receipt);
});

test("an index behind the block the sale landed in is UNKNOWN, INDEX_BEHIND_REQUIRED_BLOCK", () => {
  const v = run({logs: [soldLog()], indexHead: 1});
  assert.equal(v.decision, "UNKNOWN");
  assert.deepEqual(v.reasonCodes, ["INDEX_BEHIND_REQUIRED_BLOCK"]);
});

test("two ProductSold logs claiming one sale id are REFUSED, DUPLICATE_SALE_ID, the first kept", () => {
  const second = soldLog({
    meta: {address: LOOKALIKE_PRODUCT_CATALOG, transactionHash: "0x" + "ab".repeat(32), blockNumber: "0x65"},
  });
  const v = run({logs: [soldLog(), second]});
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["DUPLICATE_SALE_ID"]);
  assert.equal(v.receipt.transactionHash.toLowerCase(), TX1.toLowerCase());
});

// ---- 7. a reverted transaction is refused before anything else is read -----------------------------

test("a known-reverted transaction hash is REFUSED, TRANSACTION_REVERTED", () => {
  const v = run({
    logs: [],
    transactionHash: TX1,
    transactionReceipts: [{transactionHash: TX1, status: "0x0"}],
  });
  assert.equal(v.decision, "REFUSED");
  assert.deepEqual(v.reasonCodes, ["TRANSACTION_REVERTED"]);
});
