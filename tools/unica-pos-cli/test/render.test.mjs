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

test("both views carry the practice-mode label", () => {
  const merchant = renderMerchantView(baseState());
  const customer = renderCustomerView(baseState());
  assert.match(merchant, /PRACTICE MODE/);
  assert.match(merchant, /test money only/i);
  assert.match(merchant, /no real value/i);
  assert.match(customer, /PRACTICE MODE/);
  assert.match(customer, /test money only/i);
  assert.match(customer, /no real value/i);
});

test("both views name the business by its pay name", () => {
  assert.match(renderMerchantView(baseState()), /Pay name: freshcuts\.unica\.eth/);
  assert.match(renderCustomerView(baseState()), /Pay name: freshcuts\.unica\.eth/);
});

test("the business view names the register the sale was started on", () => {
  assert.match(renderMerchantView(baseState()), /Register: chair-1/);
});

test("the customer view shows the full current business address and the business-badge provenance line", () => {
  const customer = renderCustomerView(baseState());
  assert.match(customer, /0xMERCHANT0000000000000000000000000000001/);
  assert.match(customer, /Business badge: token 0xIDENTITY000000000000000000000000000001:1/);
  assert.match(customer, /renderer unica-identity-svg\/1/);
  assert.match(customer, /not proof of address ownership/);
});

// The network is a place, not a number, and an id nobody recognises must READ as unrecognised
// rather than as some default. The third row is the one that would catch a silent fallback.
test("the network is named in plain words, and an unknown id says so", () => {
  assert.match(renderCustomerView(baseState()), /Network: Local practice network/);
  const sepolia = renderCustomerView(baseState({manifest: {chainId: 11155111, environment: "SEPOLIA"}, chainId: 11155111}));
  assert.match(sepolia, /Network: Sepolia test network/);
  const foreign = renderCustomerView(baseState({manifest: {chainId: 999, environment: "?"}, chainId: 999}));
  assert.match(foreign, /Unrecognised network \(id 999\)/);
  assert.doesNotMatch(foreign, /practice network/);
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

// The rule this whole file exists for, in the new words. "Paid" is a substring of nothing else
// these views produce, so the negative rows can look for the bare word: any future rewording that
// leaks it onto a non-VERIFIED branch turns these red rather than merely reading oddly.
test("the word Paid appears on neither view unless the evidence decision is VERIFIED", () => {
  for (const state of [
    baseState({txSubmitted: true}),
    baseState({txHash: "0xabc"}),
    baseState({txHash: "0xabc", evidence: {decision: "UNKNOWN"}}),
    baseState({txHash: "0xabc", evidence: {decision: "REFUSED"}}),
    baseState({txHash: "0xabc", evidence: {decision: "verified"}}),
    baseState({txHash: "0xabc", txReceipt: {status: "0x0"}, evidence: {decision: "VERIFIED"}}),
  ]) {
    assert.doesNotMatch(renderMerchantView(state), /Paid/);
    assert.doesNotMatch(renderCustomerView(state), /Paid/);
  }
  const verified = baseState({txHash: "0xabc", evidence: {decision: "VERIFIED"}});
  assert.match(renderMerchantView(verified), /Status: Paid \(checked\)/);
  assert.match(renderCustomerView(verified), /Result: Paid \(checked\)/);
});

test("a refused decision reads Declined and an unknown one reads Not confirmed yet", () => {
  const refused = baseState({txHash: "0xabc", evidence: {decision: "REFUSED"}});
  assert.match(renderMerchantView(refused), /Status: Declined/);
  assert.match(renderMerchantView(refused), /Nothing was charged/);
  const unknown = baseState({txHash: "0xabc", evidence: {decision: "UNKNOWN"}});
  assert.match(renderMerchantView(unknown), /Status: Not confirmed yet/);
  assert.match(renderMerchantView(unknown), /Do not hand over the goods/);
});

test("the customer view keeps the raw three-way decision beside the plain-language line", () => {
  assert.match(renderCustomerView(baseState({txHash: "0xabc", evidence: {decision: "UNKNOWN"}})), /Checked receipt: UNKNOWN/);
  assert.match(renderCustomerView(baseState()), /Checked receipt: NONE/);
});

test("a switched-off register blocks a new sale, in words a shop owner can act on", () => {
  const view = renderMerchantView(baseState({terminal: {name: "lost-tablet", statusAtAdmission: "REVOKED"}}));
  assert.match(view, /New sale blocked/);
  assert.match(view, /This register has been switched off/);
});

test("the customer view disables the pay action and states why when authorization is blocked", () => {
  const customer = renderCustomerView(baseState({chainId: 1}));
  assert.match(customer, /Confirm and pay \] {2}-- disabled/);
  assert.match(customer, /Wrong network/);
  const wrongWallet = renderCustomerView(baseState({connectedAddress: "0xSOMEONEELSE000000000000000000000000001"}));
  assert.match(wrongWallet, /set up for a different wallet/);
});
