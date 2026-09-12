// tools/unica-pos-cli — payment status and the two countertop views, against fixture states. No
// network, no live evidence lookup: `node --test tools/unica-pos-cli/test/`.

import assert from "node:assert/strict";
import {test} from "node:test";

import {canAuthorizePayment, canInitiateSale, paymentStatus, renderCustomerView, renderMerchantView} from "../render.mjs";

const MANIFEST = {chainId: 31337, environment: "LOCAL_ANVIL_NO_VALUE"};

function baseState(overrides = {}) {
  return {
    manifest: MANIFEST,
    chainId: 31337,
    connectedAddress: "0xPAYER00000000000000000000000000000000",
    merchant: {
      name: "freshcuts.unica.eth",
      address: "0xMERCHANT0000000000000000000000000000001",
      identityToken: "0xIDENTITY000000000000000000000000000001:1",
      rendererVersion: "unica-identity-svg/1",
    },
    terminal: {name: "chair-1", statusAtAdmission: "ACTIVE"},
    order: {
      id: "0xorder1",
      boundPayer: "0xPAYER00000000000000000000000000000000",
      recipientAtAdmission: "0xMERCHANT0000000000000000000000000000001",
      amountIn: "1000000",
      minOut: "500000",
      deadline: 4102444800, // year 2100, never expired in this suite unless overridden
      inputAsset: {symbol: "tTSLA"},
      outputAsset: {symbol: "uTUSD"},
    },
    fees: {hookFeePips: 0, lpFeePips: 3000, protocolFeePips: 0, swapFeePips: 3000},
    now: 1000,
    txSubmitted: false,
    txHash: null,
    txReceipt: null,
    evidence: null,
    ...overrides,
  };
}

// ---- paymentStatus --------------------------------------------------------------------------------

test("no wallet action yet is AWAITING_PAYER", () => {
  assert.equal(paymentStatus(baseState()), "AWAITING_PAYER");
});

test("a submitted-but-not-yet-hashed transaction is SUBMITTED, never PAID", () => {
  const s = paymentStatus(baseState({txSubmitted: true}));
  assert.equal(s, "SUBMITTED");
  assert.notEqual(s, "PAID");
});

test("a transaction hash with no evidence yet is PENDING, never PAID", () => {
  const s = paymentStatus(baseState({txHash: "0xabc"}));
  assert.equal(s, "PENDING");
  assert.notEqual(s, "PAID");
});

test("a reverted receipt is FAILED, regardless of evidence", () => {
  const s = paymentStatus(baseState({txHash: "0xabc", txReceipt: {status: "0x0"}, evidence: {decision: "VERIFIED"}}));
  assert.equal(s, "FAILED");
});

test("UNKNOWN evidence is UNKNOWN, never PAID and never silently treated as ALLOW", () => {
  const s = paymentStatus(baseState({txHash: "0xabc", evidence: {decision: "UNKNOWN", reasonCodes: ["AWAITING_FINALITY"]}}));
  assert.equal(s, "UNKNOWN");
});

test("REFUSED evidence is FAILED, never PAID", () => {
  const s = paymentStatus(baseState({txHash: "0xabc", evidence: {decision: "REFUSED", reasonCodes: ["HOOK_PROVENANCE_MISMATCH"]}}));
  assert.equal(s, "FAILED");
});

test("only evidence.decision === VERIFIED reaches PAID", () => {
  const s = paymentStatus(baseState({txHash: "0xabc", evidence: {decision: "VERIFIED", reasonCodes: []}}));
  assert.equal(s, "PAID");
});

test("a bare tx hash, a decoded Swap-shaped object, or a ReportProcessed(true) never reaches PAID", () => {
  assert.notEqual(paymentStatus(baseState({txHash: "0xabc"})), "PAID");
  assert.notEqual(paymentStatus(baseState({txHash: "0xabc", evidence: {swapSeen: true}})), "PAID");
  assert.notEqual(paymentStatus(baseState({txHash: "0xabc", evidence: {reportProcessed: true}})), "PAID");
  assert.notEqual(paymentStatus(baseState({txHash: "0xabc", evidence: {decision: "verified"}})), "PAID"); // case-sensitive, on purpose
});

// ---- canAuthorizePayment / canInitiateSale ---------------------------------------------------------

test("a wallet on the wrong network cannot authorize payment", () => {
  const gate = canAuthorizePayment(baseState({chainId: 1}));
  assert.equal(gate.allowed, false);
  assert.ok(gate.reasons.includes("WRONG_NETWORK"));
});

test("a connected wallet that is not the order's bound payer cannot authorize payment", () => {
  const gate = canAuthorizePayment(baseState({connectedAddress: "0xSOMEONEELSE000000000000000000000000001"}));
  assert.equal(gate.allowed, false);
  assert.ok(gate.reasons.includes("WRONG_PAYER"));
});

test("an expired order cannot be approved", () => {
  const gate = canAuthorizePayment(baseState({now: 5_000_000_000, order: {...baseState().order, deadline: 1_000_000_000}}));
  assert.equal(gate.allowed, false);
  assert.ok(gate.reasons.includes("ORDER_EXPIRED"));
});

test("a correctly-networked, correctly-connected, unexpired order may be authorized", () => {
  const gate = canAuthorizePayment(baseState());
  assert.equal(gate.allowed, true);
  assert.deepEqual(gate.reasons, []);
});

test("a revoked terminal cannot initiate a new sale", () => {
  const gate = canInitiateSale(baseState({terminal: {name: "lost-tablet", statusAtAdmission: "REVOKED"}}));
  assert.equal(gate.allowed, false);
  assert.ok(gate.reasons.includes("TERMINAL_REVOKED"));
});

test("an active terminal may initiate a new sale", () => {
  const gate = canInitiateSale(baseState());
  assert.equal(gate.allowed, true);
});

// ---- rendered views ---------------------------------------------------------------------------------

test("both views carry the testnet label", () => {
  const merchant = renderMerchantView(baseState());
  const customer = renderCustomerView(baseState());
  assert.match(merchant, /TEST MODE/);
  assert.match(merchant, /no real value/i);
  assert.match(customer, /TEST MODE/);
  assert.match(customer, /no real value/i);
});

test("the customer view shows the full current merchant address and the customer-facing identity provenance line", () => {
  const customer = renderCustomerView(baseState());
  assert.match(customer, /0xMERCHANT0000000000000000000000000000001/);
  assert.match(customer, /token 0xIDENTITY000000000000000000000000000001:1/);
  assert.match(customer, /renderer unica-identity-svg\/1/);
});

test("the customer view shows the historical recipientAtAdmission separately when it differs from the current merchant address", () => {
  const state = baseState({
    merchant: {...baseState().merchant, address: "0xNEWMERCHANT000000000000000000000000002"},
    order: {...baseState().order, recipientAtAdmission: "0xMERCHANT0000000000000000000000000000001"},
  });
  const customer = renderCustomerView(state);
  assert.match(customer, /Recipient at admission.*0xMERCHANT0000000000000000000000000000001/s);
  assert.match(customer, /0xNEWMERCHANT000000000000000000000000002/);
});

test("the customer view does not call out a historical recipient when it matches the current merchant address", () => {
  const customer = renderCustomerView(baseState());
  assert.doesNotMatch(customer, /Recipient at admission/);
});

test("the merchant view never prints Paid unless evidence says VERIFIED", () => {
  const submitted = renderMerchantView(baseState({txSubmitted: true}));
  assert.doesNotMatch(submitted, /^Paid$/m);
  const verified = renderMerchantView(baseState({txHash: "0xabc", evidence: {decision: "VERIFIED"}}));
  assert.match(verified, /Status: Paid/);
});

test("the customer view disables the pay action and states why when authorization is blocked", () => {
  const customer = renderCustomerView(baseState({chainId: 1}));
  assert.match(customer, /Confirm and pay \] {2}-- disabled/);
  assert.match(customer, /Wrong network/);
});
