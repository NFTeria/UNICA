// The countertop business/customer text views and the payment-status rule they both read from.
//
// WORDS ON A SCREEN. Everything a person reads here is written in the words a shop owner already
// uses: business, register, customer, sale, payment, pay name, business badge. The code's own
// identifiers, events and errors keep their protocol names, because those are read by engineers
// and by other programs; a name that means one thing in the ABI and another on a receipt is worse
// than either. "Paid (checked)" is deliberately two words: it says the shop was paid AND that
// something checked, which is the whole claim this file is allowed to make.
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
  WRONG_NETWORK: "Wrong network: switch the customer's wallet to the network this sale was created on.",
  WRONG_PAYER: "This sale is set up for a different wallet than the one connected.",
  ORDER_EXPIRED: "This sale expired before it was paid. Nothing was charged.",
  TERMINAL_REVOKED: "This register has been switched off. It cannot start a new sale.",
};

// ---- shared text fragments --------------------------------------------------------------------------

const PRACTICE_TAG = "[PRACTICE MODE]";
const PRACTICE_LINE = "Practice mode: test money only -- no real value";

/// The network as a shop owner should see it: a place, not a chain id. An id nobody recognises is
/// named as unknown rather than dressed up, because "unknown network" is a reason to stop.
function networkLine(manifest = {}) {
  const chainId = manifest.chainId;
  if (Number(chainId) === 31337) return "Local practice network";
  if (Number(chainId) === 11155111) return "Sepolia test network";
  return `Unrecognised network (id ${chainId ?? "?"})`;
}

/// The ONE place the word "Paid" may be produced, and it is produced only for the PAID status,
/// which `paymentStatus` grants only on `evidence.decision === "VERIFIED"`. Rewording any line
/// below is safe; moving "Paid" onto another branch breaks the rule these tests exist to hold.
function statusLine(status) {
  switch (status) {
    case "PAID":
      return "Paid (checked)";
    case "FAILED":
      return "Declined";
    case "PENDING":
      return "Waiting for the network to confirm...";
    case "SUBMITTED":
      return "Sent, waiting for the network...";
    case "UNKNOWN":
      return "Not confirmed yet";
    default:
      return "Waiting for the customer";
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

// ---- business view ------------------------------------------------------------------------------

export function renderMerchantView(state = {}) {
  const lines = [];
  lines.push(`${state.merchant?.name ?? "Your business"}  ${PRACTICE_TAG}`);
  lines.push(PRACTICE_LINE);
  lines.push("");
  const order = state.order ?? {};
  lines.push(`Pay name: ${state.merchant?.name ?? "(none)"}`);
  lines.push(`Register: ${state.terminal?.name ?? "(none)"}`);
  lines.push(`Sale: ${order.id ?? "(no sale yet)"}`);
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
    lines.push("Do not close this screen. Nothing is marked as paid until the network confirms it.");
  }
  if (status === "PAID") {
    lines.push(`${fmtAmount(order.minOut, order.outputAsset?.symbol)} received.`);
    lines.push(`Checked on the ${networkLine(state.manifest)}.`);
  }
  if (status === "FAILED") {
    lines.push("Nothing was charged. This sale cannot be used again.");
  }
  if (status === "UNKNOWN") {
    lines.push("This screen cannot yet confirm or decline this payment. Do not hand over the goods.");
  }
  return lines.join("\n");
}

// ---- customer view -------------------------------------------------------------------------------

export function renderCustomerView(state = {}) {
  const lines = [];
  const merchant = state.merchant ?? {};
  const order = state.order ?? {};
  lines.push(`Review payment  ${PRACTICE_TAG}`);
  lines.push(PRACTICE_LINE);
  lines.push("");
  lines.push(`Business: ${merchant.name ?? "(unknown)"}`);
  lines.push(`Pay name: ${merchant.name ?? "(unknown)"}`);
  lines.push(`Payment address (full): ${merchant.address ?? "(unknown)"}`);
  if (merchant.identityToken || merchant.rendererVersion) {
    lines.push(
      `Business badge: token ${merchant.identityToken ?? "?"}, renderer ${merchant.rendererVersion ?? "?"} -- not proof of address ownership`,
    );
  }
  if (order.recipientAtAdmission && merchant.address && String(order.recipientAtAdmission).toLowerCase() !== String(merchant.address).toLowerCase()) {
    lines.push(`Recipient at admission (historical, from this sale's own record): ${order.recipientAtAdmission}`);
    lines.push("This differs from the business's current address shown above -- this sale still pays the address it named when it was created.");
  }
  lines.push("");
  lines.push(`You pay (max): ${fmtAmount(order.amountIn, order.inputAsset?.symbol)}`);
  lines.push(`The business receives (guaranteed minimum): ${fmtAmount(order.minOut, order.outputAsset?.symbol)}`);
  lines.push(`Network: ${networkLine(state.manifest)} (id ${state.manifest?.chainId ?? "?"})`);
  lines.push(`Expires: ${order.deadline !== undefined ? new Date(Number(order.deadline) * 1000).toISOString() : "unknown"}`);
  lines.push(feesLine(state.fees));
  lines.push(`Customer wallet: ${state.connectedAddress ?? "(not connected)"}`);

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
  lines.push(`Result: ${statusLine(status)}`);
  // The raw three-way decision stays on the screen next to the plain-language line, because the
  // plain line is a reading OF it. A customer who wants the underlying answer can see it.
  lines.push(`Checked receipt: ${state.evidence?.decision ?? "NONE"}`);
  return lines.join("\n");
}
