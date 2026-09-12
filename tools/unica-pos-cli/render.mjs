// The countertop merchant/customer text views and the payment-status rule they both read from.
//
// F8 (docs/unica-v4/EVENT-SCHEMA.md §5, §6.2; docs/unica-v5/pos/POS-FLOWS.md fact F8): "A
// SettlementReceipt is evidence, not success... No screen, role, or override may mark an order
// paid" until a mined transaction (status 1) holds BOTH the hook receipt and the executor's
// `Settled` for the expected order id. `paymentStatus` below is the one place that rule is
// enforced: it is PAID only when `evidence.decision === "VERIFIED"` — that field comes from
// `tools/unica-evidence`'s ten-link chain, never from a bare transaction hash, a raw log, a token,
// an ENS name, or a policy report's own boolean.
//
// POS-FLOWS.md §3 draws the confirmation boundary this file also enforces: order creation is a
// terminal/merchant action gated on the terminal's own admission status (`canInitiateSale`);
// authorizing payment is the payer's own action, gated on network, connected address, and expiry
// (`canAuthorizePayment`) — two different gates because they are two different people's mistakes.

// ---- payment status --------------------------------------------------------------------------------

const STATUSES = ["AWAITING_PAYER", "SUBMITTED", "PENDING", "PAID", "FAILED", "UNKNOWN"];

function statusIsReverted(txReceipt) {
  if (!txReceipt) return false;
  const status = txReceipt.status;
  if (status === undefined || status === null) return false;
  const n = typeof status === "string" ? Number(BigInt(status)) : Number(status);
  return n === 0;
}

/// The single rule that may ever say PAID. `evidence` is expected to be the object
/// `tools/unica-evidence`'s `authenticateReceipt`/`receiptByOrderId` returns (or its `.evidence`
/// field); anything else — a hash, a decoded log, a token id, a resolved ENS name, a
/// `ReportProcessed(true)`, or a graph answer with no `decision` field — simply does not have a
/// `.decision === "VERIFIED"` and therefore cannot reach PAID, structurally, not by a rule this
/// function has to remember to apply.
export function paymentStatus({txSubmitted = false, txHash = null, txReceipt = null, evidence = null} = {}) {
  if (statusIsReverted(txReceipt)) return "FAILED";
  if (evidence && evidence.decision === "VERIFIED") return "PAID";
  if (evidence && evidence.decision === "UNKNOWN") return "UNKNOWN";
  if (evidence && evidence.decision === "REFUSED") return "FAILED";
  if (txHash) return "PENDING";
  if (txSubmitted) return "SUBMITTED";
  return "AWAITING_PAYER";
}

export {STATUSES};

// ---- the confirmation boundary (POS-FLOWS.md §3) ---------------------------------------------------

/// Gate on the MERCHANT/terminal side: may this terminal initiate ("create") a new order at all.
/// A revoked or lost terminal must not be able to start a sale, independent of anything about the
/// eventual payer (POS-FLOWS.md §3's order-creator key discussion).
export function canInitiateSale(state = {}) {
  const status = state.terminal?.statusAtAdmission;
  if (status && status !== "ACTIVE") {
    return {allowed: false, reasons: ["TERMINAL_REVOKED"]};
  }
  return {allowed: true, reasons: []};
}

/// Gate on the PAYER side: may the connected wallet authorize `pay(orderId)` right now. Every
/// reason found is returned, not just the first, since a countertop screen showing only one blocker
/// at a time makes a payer fix it and then discover the next one.
export function canAuthorizePayment(state = {}) {
  const reasons = [];
  const manifestChainId = state.manifest?.chainId;
  if (manifestChainId !== undefined && state.chainId !== undefined && Number(state.chainId) !== Number(manifestChainId)) {
    reasons.push("WRONG_NETWORK");
  }
  const boundPayer = state.order?.boundPayer;
  if (boundPayer && state.connectedAddress && String(state.connectedAddress).toLowerCase() !== String(boundPayer).toLowerCase()) {
    reasons.push("WRONG_PAYER");
  }
  const deadline = state.order?.deadline;
  const now = state.now ?? Math.floor(Date.now() / 1000);
  if (deadline !== undefined && deadline !== null && Number(now) >= Number(deadline)) {
    reasons.push("ORDER_EXPIRED");
  }
  return {allowed: reasons.length === 0, reasons};
}

const REASON_TEXT = {
  WRONG_NETWORK: "Wrong network: switch your wallet to the network this order was created on.",
  WRONG_PAYER: "This order is bound to a different wallet address than the one connected.",
  ORDER_EXPIRED: "This order expired before it was paid. Nothing was charged.",
  TERMINAL_REVOKED: "This terminal's admission has been revoked. It cannot start a new sale.",
};

// ---- shared text fragments --------------------------------------------------------------------------

const TESTNET_TAG = "[TEST MODE]";
const TESTNET_LINE = "Testnet demonstration -- no real value";

function statusLine(status) {
  switch (status) {
    case "PAID":
      return "Paid";
    case "FAILED":
      return "Not settled";
    case "PENDING":
      return "Waiting for network confirmation...";
    case "SUBMITTED":
      return "Submitted, waiting for a transaction hash...";
    case "UNKNOWN":
      return "Evidence unavailable -- status unknown";
    default:
      return "Awaiting payer";
  }
}

function fmtAmount(amount, symbol) {
  if (amount === undefined || amount === null) return `-- ${symbol ?? ""}`.trim();
  return `${amount} ${symbol ?? ""}`.trim();
}

function feesLine(fees = {}) {
  const lp = fees.lpFeePips ?? 0;
  const protocolFee = fees.protocolFeePips ?? 0;
  const hook = fees.hookFeePips ?? 0;
  return `Fees: LP ${(lp / 10000).toFixed(2)}% . Protocol ${(protocolFee / 10000).toFixed(2)}% . UNICA ${(hook / 10000).toFixed(2)}%`;
}

// ---- merchant view ------------------------------------------------------------------------------

export function renderMerchantView(state = {}) {
  const lines = [];
  lines.push(`${state.merchant?.name ?? "Merchant"}  ${TESTNET_TAG}`);
  lines.push(TESTNET_LINE);
  lines.push("");
  const order = state.order ?? {};
  lines.push(`Order: ${order.id ?? "(no order yet)"}`);
  lines.push(`Amount due: ${fmtAmount(order.minOut, order.outputAsset?.symbol)}`);

  const initiate = canInitiateSale(state);
  if (!initiate.allowed) {
    lines.push("");
    lines.push("New sale blocked:");
    for (const reason of initiate.reasons) lines.push(`  - ${REASON_TEXT[reason] ?? reason}`);
  }

  const status = paymentStatus(state);
  lines.push("");
  lines.push(`Status: ${statusLine(status)}`);
  if (status === "PENDING" || status === "SUBMITTED") {
    lines.push("Do not close this screen. Nothing is marked Paid until this transaction is mined.");
  }
  if (status === "PAID") {
    lines.push(`${fmtAmount(order.minOut, order.outputAsset?.symbol)} received.`);
    lines.push(`Confirmed on ${state.manifest?.environment ?? "the configured network"}.`);
  }
  if (status === "FAILED") {
    lines.push("Nothing was charged. This order cannot be reused.");
  }
  if (status === "UNKNOWN") {
    lines.push("This screen cannot yet confirm or refuse this payment from local evidence.");
  }
  return lines.join("\n");
}

// ---- customer view -------------------------------------------------------------------------------

export function renderCustomerView(state = {}) {
  const lines = [];
  const merchant = state.merchant ?? {};
  const order = state.order ?? {};
  lines.push(`Review payment  ${TESTNET_TAG}`);
  lines.push(TESTNET_LINE);
  lines.push("");
  lines.push(`Merchant: ${merchant.name ?? "(unknown)"}`);
  lines.push(`Merchant address (full): ${merchant.address ?? "(unknown)"}`);
  if (merchant.identityToken || merchant.rendererVersion) {
    lines.push(
      `Identity art: token ${merchant.identityToken ?? "?"}, renderer ${merchant.rendererVersion ?? "?"} -- not proof of address ownership`,
    );
  }
  if (order.recipientAtAdmission && merchant.address && String(order.recipientAtAdmission).toLowerCase() !== String(merchant.address).toLowerCase()) {
    lines.push(`Recipient at admission (historical, from this order's own record): ${order.recipientAtAdmission}`);
    lines.push("This differs from the merchant's current address shown above -- this order still pays the address it named at creation.");
  }
  lines.push("");
  lines.push(`You pay (max): ${fmtAmount(order.amountIn, order.inputAsset?.symbol)}`);
  lines.push(`Merchant receives (guaranteed minimum): ${fmtAmount(order.minOut, order.outputAsset?.symbol)}`);
  lines.push(`Network: ${state.manifest?.environment ?? "unknown"} (chainId ${state.manifest?.chainId ?? "?"})`);
  lines.push(`Expires: ${order.deadline !== undefined ? new Date(Number(order.deadline) * 1000).toISOString() : "unknown"}`);
  lines.push(feesLine(state.fees));
  lines.push(`Connected payer: ${state.connectedAddress ?? "(not connected)"}`);

  const auth = canAuthorizePayment(state);
  lines.push("");
  if (auth.allowed) {
    lines.push("[ Confirm and pay ]  -- enabled");
  } else {
    lines.push("[ Confirm and pay ]  -- disabled");
    for (const reason of auth.reasons) lines.push(`  - ${REASON_TEXT[reason] ?? reason}`);
  }

  const status = paymentStatus(state);
  lines.push("");
  lines.push(`Transaction result: ${statusLine(status)}`);
  lines.push(`Verified receipt status: ${state.evidence?.decision ?? "NONE"}`);
  return lines.join("\n");
}
