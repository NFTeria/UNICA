// apps/web/tests/local-pay.test.mjs — unit tests of the PURE functions in
// apps/web/assets/local-pay.js: no DOM, no network, no chain. `node --test apps/web/tests/`.
//
// local-pay.js imports tools/unica-pos-cli/render.mjs and web/ensv2/keccak.mjs by ordinary relative
// path, which resolve here exactly as they do on any other file in this repository — the browser
// path (through script/anvil/serve.sh's two passthrough routes) is exercised only by hand, per
// script/anvil/README-browser.md, not by this file.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REASON_TEXT,
  businessNameFrom,
  computeBlockers,
  decisionText,
  deriveStatus,
  encodeApproveCalldata,
  encodePayCalldata,
  formatCountdown,
  formatFeesLine,
  orderExpiredBlocker,
  registerNameFrom,
  renderTermsText,
  selectorOf,
  statusText,
  terminalRevokedBlocker,
  wordFromAddress,
  wordFromBytes32,
  wordFromUint,
  wrongNetworkBlocker,
  wrongPayerBlocker,
} from "../assets/local-pay.js";

const PAYER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const OTHER = "0x0000000000000000000000000000000000000001";
const EXECUTOR = "0x1111111111111111111111111111111111111111";

function baseRecord(overrides = {}) {
  return {
    manifest: { environment: "LOCAL_ANVIL_NO_VALUE", chainId: 31337 },
    chainId: 31337,
    order: {
      id: "0x" + "3".repeat(64),
      payer: PAYER,
      inputAmount: "1000000000000000000",
      inputSymbol: "tAST",
      inputAsset: EXECUTOR,
      minimumOutput: "1950000",
      outputSymbol: "uUSD",
      expiry: 2_000_000_000, // far future
    },
    terminal: { name: "chair-1.terminals.freshcuts.unica.eth", statusAtAdmission: "ACTIVE" },
    merchant: { name: "freshcuts.unica.eth", address: "0x2222222222222222222222222222222222222222" },
    evidence: null,
    ...overrides,
  };
}
function baseConfig(overrides = {}) {
  return { rpc: "REDACTED", chainId: 31337, manifest: { chainId: 31337 }, record: null, ...overrides };
}

// ---- blockers: wrong network ----------------------------------------------------------------------

test("wrongNetworkBlocker is false when config.chainId matches the manifest", () => {
  assert.equal(wrongNetworkBlocker(baseConfig()), false);
});
test("wrongNetworkBlocker is true when config.chainId disagrees with the manifest", () => {
  assert.equal(wrongNetworkBlocker(baseConfig({ chainId: 1 })), true);
});
test("wrongNetworkBlocker is false (not a crash) with no manifest at all", () => {
  assert.equal(wrongNetworkBlocker({ chainId: 1 }), false);
});
test("wrongNetworkBlocker is true when the connected wallet's chain disagrees with the manifest", () => {
  assert.equal(wrongNetworkBlocker(baseConfig(), 11155111), true);
  assert.equal(wrongNetworkBlocker(baseConfig(), 31337), false);
  assert.equal(wrongNetworkBlocker(baseConfig(), null), false);
});

// ---- blockers: wrong payer --------------------------------------------------------------------------

test("wrongPayerBlocker is false for the record's own bound payer", () => {
  assert.equal(wrongPayerBlocker(baseRecord(), PAYER), false);
});
test("wrongPayerBlocker is false for the same address in a different case", () => {
  assert.equal(wrongPayerBlocker(baseRecord(), PAYER.toUpperCase().replace("0X", "0x")), false);
});
test("wrongPayerBlocker is true for a `?as=` address that is not the bound payer", () => {
  assert.equal(wrongPayerBlocker(baseRecord(), OTHER), true);
});
test("wrongPayerBlocker is false when no wallet has connected yet", () => {
  assert.equal(wrongPayerBlocker(baseRecord(), null), false);
});

// ---- blockers: expiry -------------------------------------------------------------------------------

test("orderExpiredBlocker is false before the deadline", () => {
  assert.equal(orderExpiredBlocker(baseRecord(), 1_000_000_000), false);
});
test("orderExpiredBlocker is true at and after the deadline", () => {
  const record = baseRecord({ order: { ...baseRecord().order, expiry: 100 } });
  assert.equal(orderExpiredBlocker(record, 100), true);
  assert.equal(orderExpiredBlocker(record, 101), true);
  assert.equal(orderExpiredBlocker(record, 99), false);
});

// ---- blockers: revoked terminal -----------------------------------------------------------------------

test("terminalRevokedBlocker is false for an ACTIVE terminal", () => {
  assert.equal(terminalRevokedBlocker(baseRecord()), false);
});
test("terminalRevokedBlocker is true once the terminal's recorded status is not ACTIVE", () => {
  const record = baseRecord({ terminal: { name: "lost-tablet", statusAtAdmission: "REVOKED" } });
  assert.equal(terminalRevokedBlocker(record), true);
});
test("terminalRevokedBlocker is false with no terminal recorded at all", () => {
  assert.equal(terminalRevokedBlocker({}), false);
});

// ---- computeBlockers: every reason is found, never just the first one --------------------------------

test("computeBlockers allows a clean order for its own payer", () => {
  const result = computeBlockers({ config: baseConfig(), record: baseRecord(), connectedAddress: PAYER, now: 1_000_000_000 });
  assert.deepEqual(result, { allowed: true, reasons: [] });
});
test("computeBlockers reports every blocker at once, not only the first", () => {
  const record = baseRecord({
    order: { ...baseRecord().order, expiry: 1 },
    terminal: { name: "lost-tablet", statusAtAdmission: "REVOKED" },
  });
  const result = computeBlockers({ config: baseConfig({ chainId: 999 }), record, connectedAddress: OTHER, now: 1_000_000_000 });
  assert.equal(result.allowed, false);
  for (const code of ["WRONG_NETWORK", "WRONG_PAYER", "ORDER_EXPIRED", "TERMINAL_REVOKED"]) {
    assert.ok(result.reasons.includes(code), `expected ${code} in ${result.reasons.join(",")}`);
  }
});
test("computeBlockers blocks a wallet connected on the wrong network even when the server agrees with its manifest", () => {
  const result = computeBlockers({ config: baseConfig(), record: baseRecord(), connectedAddress: PAYER, walletChainId: 11155111, now: 1_000_000_000 });
  assert.deepEqual(result, { allowed: false, reasons: ["WRONG_NETWORK"] });
});

// ---- the words a customer reads ----------------------------------------------------------------------

test("every blocker sentence uses the business-language dictionary, never the contract words", () => {
  for (const s of Object.values(REASON_TEXT)) {
    assert.doesNotMatch(s, /\border\b|\bpayer\b|\bterminal\b|\bmerchant\b|hook|executor|registry|calldata|0x/i, s);
  }
  assert.match(REASON_TEXT.WRONG_PAYER, /customer/);
  assert.match(REASON_TEXT.TERMINAL_REVOKED, /register/);
  assert.match(REASON_TEXT.ORDER_EXPIRED, /sale/);
});
test("statusText says Paid (checked) for PAID and for nothing else", () => {
  assert.equal(statusText("PAID"), "Paid (checked).");
  for (const s of ["FAILED", "PENDING", "SUBMITTED", "UNKNOWN", "AWAITING_PAYER", undefined]) {
    assert.doesNotMatch(statusText(s), /paid/i, String(s));
  }
  assert.equal(statusText("FAILED"), "Declined. Nothing was charged.");
  assert.equal(statusText("UNKNOWN"), "Not confirmed yet.");
  assert.equal(statusText("AWAITING_PAYER"), "Waiting for the customer.");
});
test("decisionText maps VERIFIED / REFUSED / UNKNOWN to the dictionary words", () => {
  assert.equal(decisionText("VERIFIED"), "Paid (checked)");
  assert.equal(decisionText("REFUSED"), "Declined");
  assert.equal(decisionText("UNKNOWN"), "Not confirmed yet");
  assert.doesNotMatch(decisionText(undefined), /paid/i);
});
test("the PAID rule and the words agree: a bare hash never reads as paid", () => {
  assert.doesNotMatch(statusText(deriveStatus({ txHash: "0xabc" })), /paid/i);
  assert.match(statusText(deriveStatus({ txHash: "0xabc", evidence: { decision: "VERIFIED" } })), /Paid \(checked\)/);
});
test("businessNameFrom and registerNameFrom take the first label of a full name", () => {
  assert.equal(businessNameFrom("freshcuts.unica.eth"), "freshcuts");
  assert.equal(registerNameFrom("chair-1.terminals.freshcuts.unica.eth"), "chair-1");
  assert.equal(businessNameFrom(undefined), "(unknown)");
});

// ---- status derivation: the PAID rule, from local-pay.js's own export -------------------------------

test("a bare transaction hash is PENDING, never PAID", () => {
  assert.equal(deriveStatus({ txHash: "0xabc" }), "PENDING");
});
test("a receipt with status 0 is FAILED even if evidence is somehow present", () => {
  assert.equal(deriveStatus({ txReceipt: { status: 0 }, evidence: { decision: "VERIFIED" } }), "FAILED");
});
test("evidence UNKNOWN yields UNKNOWN", () => {
  assert.equal(deriveStatus({ txHash: "0xabc", evidence: { decision: "UNKNOWN" } }), "UNKNOWN");
});
test("evidence VERIFIED is the only path to PAID", () => {
  assert.equal(deriveStatus({ txHash: "0xabc", evidence: { decision: "VERIFIED" } }), "PAID");
});
test("evidence REFUSED is FAILED, not UNKNOWN and not PAID", () => {
  assert.equal(deriveStatus({ txHash: "0xabc", evidence: { decision: "REFUSED" } }), "FAILED");
});
test("no transaction and no evidence at all is AWAITING_PAYER", () => {
  assert.equal(deriveStatus(), "AWAITING_PAYER");
});

// ---- ABI encoding, against vectors independently generated with `cast` ------------------------------

test("selectorOf matches cast sig for approve(address,uint256)", () => {
  assert.equal(selectorOf("approve(address,uint256)"), "0x095ea7b3");
});
test("selectorOf matches cast sig for pay(bytes32)", () => {
  assert.equal(selectorOf("pay(bytes32)"), "0x8609cad1");
});
test("selectorOf matches cast sig for transfer(address,uint256)", () => {
  assert.equal(selectorOf("transfer(address,uint256)"), "0xa9059cbb");
});

test("wordFromAddress left-pads a 20-byte address to a 32-byte word", () => {
  assert.equal(wordFromAddress("0x1111111111111111111111111111111111111111"), "0000000000000000000000001111111111111111111111111111111111111111");
});
test("wordFromUint encodes a decimal amount as a big-endian 32-byte word", () => {
  assert.equal(wordFromUint("1000000000000000000"), "0000000000000000000000000000000000000000000000000de0b6b3a7640000");
});
test("wordFromBytes32 passes through an already-32-byte value", () => {
  const v = "0x" + "22".repeat(32);
  assert.equal(wordFromBytes32(v), "22".repeat(32));
});
test("wordFromAddress refuses a value that is not 20 bytes", () => {
  assert.throws(() => wordFromAddress("0x1234"));
});

test("encodeApproveCalldata matches the known cast calldata vector", () => {
  const expected =
    "0x095ea7b300000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000de0b6b3a7640000"; // approve calldata vector
  assert.equal(encodeApproveCalldata(EXECUTOR, "1000000000000000000"), expected);
});
test("encodePayCalldata matches the known cast calldata vector", () => {
  const orderId = "0x" + "22".repeat(32);
  const expected = "0x8609cad1" + "22".repeat(32);
  assert.equal(encodePayCalldata(orderId), expected);
});

// ---- formatting: countdown, fees, and label presence in rendered text -------------------------------

test("formatCountdown counts down as mm:ss before the deadline", () => {
  assert.equal(formatCountdown(1_000_090, 1_000_000), "01:30");
});
test("formatCountdown reads 'expired' at and after the deadline", () => {
  assert.equal(formatCountdown(1_000_000, 1_000_000), "expired");
  assert.equal(formatCountdown(1_000_000, 1_000_050), "expired");
});
test("formatCountdown reads 'unknown' with no deadline at all", () => {
  assert.equal(formatCountdown(undefined, 1_000_000), "unknown");
});

test("formatFeesLine states fees are not known yet before a receipt exists", () => {
  assert.match(formatFeesLine(null), /not known yet/);
});
test("formatFeesLine renders pips as percentages once a receipt exists", () => {
  const line = formatFeesLine({ lpFeePips: 3000, protocolFeePips: 0, hookFeePips: 500 });
  assert.equal(line, "Fees: market 0.30% . protocol 0.00% . UNICA 0.05%");
});

test("renderTermsText carries the practice-mode label", () => {
  const text = renderTermsText(baseRecord());
  assert.match(text, /Practice mode, test money only/);
});
test("renderTermsText uses the dictionary rows: Business, Pay name, Register, Amount you pay, They receive, Network, Expires", () => {
  const text = renderTermsText(baseRecord());
  assert.match(text, /^Business: freshcuts$/m);
  assert.match(text, /^Pay name: freshcuts\.unica\.eth$/m);
  assert.match(text, /^Register: chair-1$/m);
  assert.match(text, /^Amount you pay: /m);
  assert.match(text, /^They receive: at least /m);
  assert.match(text, /^Network: Local practice network$/m);
  assert.match(text, /^Expires: /m);
  assert.doesNotMatch(text, /Merchant|chainId|\[TEST MODE\]/);
});
test("renderTermsText carries the full payout address, not a truncated one", () => {
  const record = baseRecord();
  const text = renderTermsText(record);
  assert.ok(text.includes(record.merchant.address));
});
test("renderTermsText carries the exact input amount and the minimum output", () => {
  const text = renderTermsText(baseRecord());
  assert.match(text, /1000000000000000000 tAST/);
  assert.match(text, /1950000 uUSD/);
});
test("renderTermsText carries the badge line, marked as not proof of ownership, when present", () => {
  const record = baseRecord({ merchant: { name: "freshcuts.unica.eth", address: "0x22", identityToken: "0xabc:1", rendererVersion: "v1" } });
  const text = renderTermsText(record);
  assert.match(text, /Business badge: 0xabc:1 \(a badge is not proof of who owns the address\)/);
});
