/**
 * The receipt (/receipt/): the page a customer keeps and a business shows its accountant.
 *
 * A RECEIPT MAY SAY THREE THINGS, AND ONLY THREE. Paid, when the payment verification says
 * VERIFIED. Declined, when it says the transaction is not a valid UNICA payment. Or that the
 * payment was sent and is still being checked — with the instruction not to pay again, because a
 * customer looking at an unresolved receipt paying a second time is the most expensive mistake
 * this screen can cause. Which of the three it is comes from `receiptStatement`, which asks the
 * same single rule the counter and the register ask.
 *
 * THE LINK IS THE RECEIPT. Order number, transaction and network all ride in the query string, so
 * the same link always rebuilds the same record and nothing depends on what this browser
 * remembers. Downloading gives the same facts as a file; sharing hands over the same link.
 */
import { fillAdvanced, loadConfig, loadEvidence, say, shortId } from "./local.js";
import {
  businessDisplayName,
  formatAmountFor,
  receiptStatement,
  registerDisplayName,
  validateEnvironment,
} from "./product.js";

/** A 32-byte identifier as it appears in a link. Anything else is not looked up. */
export const HASH32 = /^0x[0-9a-fA-F]{64}$/;

/** What the link is asking for. An identifier that is not well formed is refused, not guessed. */
export function readLink(search) {
  const params = new URLSearchParams(search ?? "");
  const order = params.get("order");
  const tx = params.get("tx");
  const chain = params.get("chain");
  return {
    order: order && HASH32.test(order) ? order : null,
    tx: tx && HASH32.test(tx) ? tx : null,
    chainId: chain && /^\d+$/.test(chain) ? Number(chain) : null,
    malformed: Boolean((order && !HASH32.test(order)) || (tx && !HASH32.test(tx))),
  };
}

/** A network timestamp as a person reads it. An absent time is named, never shown as the epoch. */
export function whenText(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "Not recorded";
  return new Date(n * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** The plain-text receipt a customer downloads. The same facts as the page, in the same words. */
export function receiptText(lines) {
  return Object.entries(lines)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n") + "\n";
}

// ---- DOM wiring; never runs under `node --test` -------------------------------------------------

if (typeof document !== "undefined" && document.getElementById("receipt-card")) {
  main().catch((e) => say("receipt", `This receipt could not be loaded: ${e.message}`));
}

async function main() {
  const link = readLink(location.search);
  if (link.malformed) {
    say("receipt", "That link does not contain a valid order number, so nothing was looked up.");
    return;
  }
  const config = await loadConfig();
  if (!config) {
    say("receipt", "The companion server is not answering, so this receipt cannot be checked. Nothing here is confirmed.");
    return;
  }

  const environment = validateEnvironment(config.manifest ?? config);
  const banner = document.getElementById("env-banner");
  if (banner) {
    banner.textContent = environment.banner
      ? `${environment.banner} — ${environment.networkName}. ${environment.reason}`
      : `${environment.networkName}. ${environment.reason}`;
  }

  const record = config.record ?? null;
  const orderId = link.order ?? record?.order?.id ?? null;
  if (!orderId) {
    say("receipt", "No payment in this link, and this setup has no recorded payment to show.");
    return;
  }

  const evidence = await loadEvidence(orderId);
  const txReceipt = record?.settlement?.status ? { status: record.settlement.status } : null;
  const statement = receiptStatement({ evidence, txReceipt });

  const merchantLabel = String(record?.merchant?.name ?? "").split(".")[0];
  const receiptFacts = evidence?.receipt ?? null;
  const paidAmount = receiptFacts?.amountDelivered ?? record?.settlement?.outputDelivered ?? null;

  const lines = {
    Business: businessDisplayName(merchantLabel),
    "Paid amount": paidAmount === null ? "Not confirmed yet" : formatAmountFor(paidAmount, record?.order?.outputAsset, config),
    "Customer asset": record?.order?.inputSymbol ?? "Not recorded",
    "Payout asset": record?.order?.outputSymbol ?? "Not recorded",
    "Date and time": whenText(receiptFacts?.referenceUpdatedAt ?? record?.now),
    "Order number": orderId,
    "Payment status": statement.heading,
    "Verification status": evidence?.decision ?? "No check yet",
    Transaction: link.tx ?? record?.settlement?.transactionHash ?? "Not recorded",
    Register: registerDisplayName(record?.terminal?.name),
    Network: environment.networkName,
  };

  say("r-business", lines.Business);
  say("r-amount", lines["Paid amount"]);
  say("r-statement", statement.sentence);
  say("r-paid", lines["Paid amount"]);
  say("r-customer-asset", lines["Customer asset"]);
  say("r-payout-asset", lines["Payout asset"]);
  say("r-when", lines["Date and time"]);
  say("r-order", shortId(orderId));
  say("r-status", statement.heading);
  say("r-verification", lines["Verification status"]);
  say("r-tx", lines.Transaction === "Not recorded" ? "Not recorded" : shortId(lines.Transaction));
  say("receipt", `This receipt was checked against the network. Verification says ${lines["Verification status"]}.`);
  fillAdvanced(config, { order: orderId, tx: lines.Transaction, reasons: evidence?.reasonCodes ?? null });

  wireKeeping(lines, statement);
}

/**
 * Downloading and sharing. Both hand over exactly what the page says: the download is the same
 * lines as text, the share is this page's own link. Neither is offered until the receipt has
 * actually been read, so nobody can save a blank one and believe it means something.
 */
function wireKeeping(lines, statement) {
  const download = document.getElementById("r-download");
  const share = document.getElementById("r-share");
  say("r-download-why", `This receipt says: ${statement.heading}.`);
  if (download) {
    download.disabled = false;
    download.addEventListener("click", () => {
      const blob = new Blob([receiptText(lines)], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `unica-receipt-${String(lines["Order number"]).slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  if (share) {
    share.disabled = false;
    share.addEventListener("click", async () => {
      const payload = { title: "UNICA receipt", text: receiptText(lines), url: location.href };
      if (navigator.share) {
        try {
          await navigator.share(payload);
          return;
        } catch {
          // The person cancelled, or this device refused. Fall through to copying the link.
        }
      }
      navigator.clipboard?.writeText(location.href).then(
        () => say("r-download-why", "Receipt link copied."),
        () => say("r-download-why", "Could not share here. Copy this page's address by hand."),
      );
    });
  }
}
