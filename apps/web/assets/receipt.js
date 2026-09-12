/**
 * The receipt (/receipt/): the page a customer keeps and a business shows its accountant.
 *
 * ONE VERDICT, FROM THE CHECK AND NOTHING ELSE. Paid appears only when the payment check answered
 * VERIFIED. Refused, Unknown and Checking are the other three words, and a transaction hash on its
 * own is never any of them: a customer looking at an unresolved receipt and paying a second time is
 * the most expensive mistake this screen can cause. The mapping lives in `assets/storefront.js`, so
 * the checkout and this page cannot come to different conclusions about the same payment.
 *
 * WHERE THE VERDICT COMES FROM. An order is checked at `/local/evidence`, which is the projection
 * that authenticates a settlement against the deployment. A catalogue sale is read out of the
 * business's own payments at `/local/payments`, where the same projection has already decided it.
 *
 * THE INDEX IS NEVER ASSUMED. A deployment that names no index says so; an index that answered with
 * nothing says so; an index that could not be reached says THAT, which is a different fact. Only an
 * index that answered with this receipt may say it was indexed, and only then does the panel carry
 * The Graph's colour.
 *
 * THE LINK IS THE RECEIPT. Network, transaction and sale all ride in the query string, so the same
 * link always rebuilds the same record and nothing depends on what this browser remembers.
 */
import { fillAdvanced, loadConfig, loadEvidence, say, shortId } from "./local.js";
import { formatAmountFor, validateEnvironment } from "./product.js";
import { networkName, rpcRequest } from "./wallet.js";
import { businessAccent, businessStyle } from "./brand.js";
import { decodeString, encodeCall } from "./abi.js";
import { parseTokenUri } from "./local-join.js";
import {
  businessIdentity,
  explorerTxLink,
  graphPanel,
  graphQueryFor,
  graphRowsFrom,
  integrationForReceipt,
  shortAddress,
  verdict,
  whenText,
} from "./storefront.js";

/** A 32-byte identifier as it appears in a link. Anything else is not looked up. */
export const HASH32 = /^0x[0-9a-fA-F]{64}$/;

/** What the link is asking for. An identifier that is not well formed is refused, not guessed. */
export function readLink(search) {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const order = params.get("order");
  const tx = params.get("tx");
  const sale = params.get("sale");
  const chain = params.get("chain");
  return {
    order: order && HASH32.test(order) ? order : null,
    tx: tx && HASH32.test(tx) ? tx : null,
    saleId: sale && HASH32.test(sale) ? sale : null,
    chainId: chain && /^\d+$/.test(chain) ? Number(chain) : null,
    malformed: Boolean((order && !HASH32.test(order)) || (tx && !HASH32.test(tx)) || (sale && !HASH32.test(sale))),
  };
}

export { whenText };

/** The plain-text receipt a customer downloads. The same facts as the page, in the same words. */
export function receiptText(lines) {
  return (
    Object.entries(lines)
      .map(([label, value]) => `${label}: ${value}`)
      .join("\n") + "\n"
  );
}

/** One payment out of what a business was paid, matched on its transaction or its own identifier. */
export function findPayment(answer, { tx = null, saleId = null } = {}) {
  const list = Array.isArray(answer?.payments) ? answer.payments : [];
  const same = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();
  return list.find((p) => same(p.transactionHash, tx) || same(p.orderId, saleId)) ?? null;
}

// ---- DOM wiring; never runs under `node --test` -------------------------------------------------

if (typeof document !== "undefined" && document.getElementById("receipt-card")) {
  main().catch((e) => say("receipt", `This receipt could not be loaded: ${e.message}`));
}

const scheme = () => (globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light");

async function main() {
  const link = readLink(location.search);
  if (link.malformed) {
    say("receipt", "That link does not contain a valid payment, so nothing was looked up.");
    return;
  }
  const config = await loadConfig();
  if (!config) {
    say("receipt", "Nothing answered, so this receipt could not be checked.");
    return;
  }

  const environment = validateEnvironment(config.manifest ?? config);
  const banner = document.getElementById("env-banner");
  if (banner) {
    banner.textContent = environment.banner ? `${environment.banner} · ${environment.networkName}` : environment.networkName;
  }

  const identity = await renderIdentity(config);
  const record = config.record ?? null;
  const found = await readPayment(config, link, record);
  if (!found) {
    say("receipt", "No payment in this link.");
    return;
  }

  const spoken = verdict(found.decision);
  renderVerdict(spoken);
  const amount = formatAmountFor(found.amount, found.asset, config);
  const asset = (config.assets ?? []).find((a) => String(a.address ?? "").toLowerCase() === String(found.asset ?? "").toLowerCase()) ?? null;
  const network = networkName(link.chainId ?? config.chainId);

  say("r-amount", amount);
  say("r-paid", amount);
  say("r-asset", asset?.symbol ?? shortAddress(found.asset));
  say("r-when", whenText(found.settledAt));
  say("r-network", network);
  say("r-tx", found.transactionHash ? shortId(found.transactionHash) : "Not recorded");
  say("receipt", `This payment was checked. The check says ${spoken.word}.`);
  fillAdvanced(config, { order: found.id, tx: found.transactionHash, reasons: found.reasonCodes ?? null });

  const explorer = explorerTxLink(config.manifest, found.transactionHash);
  const link_ = document.getElementById("r-explorer");
  if (link_ && explorer) {
    link_.setAttribute("href", explorer);
    link_.hidden = false;
  }

  const lines = {
    Business: identity.display,
    "Pay name": identity.payName ?? "Not recorded",
    Amount: amount,
    Asset: asset?.symbol ?? String(found.asset ?? "Not recorded"),
    When: whenText(found.settledAt),
    Network: network,
    Transaction: found.transactionHash ?? "Not recorded",
    Verdict: spoken.word,
  };
  wireKeeping(lines, spoken);
  await renderGraph(config, { tx: found.transactionHash, saleId: found.kind === "product" ? found.id : null, payName: identity.payName });
}

/** Who was paid: the name, the pay name, and the badge or the business's own accent square. */
async function renderIdentity(config) {
  const identity = businessIdentity(config);
  say("r-business", identity.display);
  say("r-payname", identity.payName ?? "No pay name");
  const square = document.getElementById("r-badge");
  const accent = businessAccent(identity.node, scheme());
  if (square && accent) square.setAttribute("style", businessStyle(accent));
  if (square && identity.badge) {
    try {
      const answer = await rpcRequest(config.rpc, "eth_call", [
        { to: identity.badge.address, data: encodeCall("tokenURI(uint256)", [identity.badge.tokenId]) },
        "latest",
      ]);
      const art = parseTokenUri(decodeString(answer));
      if (art?.image) {
        const img = document.createElement("img");
        img.src = art.image;
        img.alt = "";
        square.replaceChildren(img);
      }
    } catch {
      // no badge to draw; the accent square is already correct
    }
  }
  return identity;
}

/**
 * The one payment this link names, in the shape the card renders. An order is checked against the
 * evidence projection; a catalogue sale is read out of the business's own payments.
 */
async function readPayment(config, link, record) {
  if (link.saleId) {
    const business = businessIdentity(config).address;
    const row = findPayment(await loadPayments(business), { saleId: link.saleId, tx: link.tx });
    if (!row) return null;
    return { ...row, id: row.orderId ?? link.saleId, kind: row.kind ?? "product" };
  }
  const settledTx = record?.settlement?.transactionHash ?? null;
  const orderId =
    link.order ??
    (link.tx && settledTx && link.tx.toLowerCase() === settledTx.toLowerCase() ? record?.order?.id ?? null : null) ??
    (!link.tx ? record?.order?.id ?? null : null);
  if (orderId) {
    const evidence = await loadEvidence(orderId);
    const receipt = evidence?.receipt ?? null;
    return {
      id: orderId,
      kind: receipt?.kind ?? "market",
      decision: evidence?.decision ?? null,
      reasonCodes: evidence?.reasonCodes ?? null,
      amount: receipt?.amountDelivered ?? receipt?.amount ?? record?.settlement?.outputDelivered ?? null,
      asset: receipt?.currencyOut ?? receipt?.asset ?? record?.order?.outputAsset ?? null,
      settledAt: receipt?.settledAt ?? receipt?.referenceUpdatedAt ?? null,
      transactionHash: receipt?.transactionHash ?? link.tx ?? settledTx,
    };
  }
  if (link.tx) {
    const business = businessIdentity(config).address;
    const row = findPayment(await loadPayments(business), { tx: link.tx });
    if (row) return { ...row, id: row.orderId ?? null, kind: row.kind ?? "direct" };
  }
  return null;
}

async function loadPayments(wallet, fetchImpl = globalThis.fetch) {
  if (!wallet) return null;
  try {
    const res = await fetchImpl(`/local/payments?wallet=${encodeURIComponent(wallet)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function renderVerdict(spoken) {
  const pill = document.getElementById("r-verdict");
  if (!pill) return;
  pill.dataset.status = spoken.status;
  const mark = document.createElement("span");
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = spoken.mark;
  pill.replaceChildren(mark, document.createTextNode(" " + spoken.word));
}

/**
 * The index panel. It asks only when the deployment names an index, and it never turns silence into
 * an answer: the three lines it may show are "Indexed by The Graph", "Not indexed yet" and "The
 * index did not answer", and only the first one wears the colour.
 */
async function renderGraph(config, { tx, saleId, payName }) {
  const url = config.graph?.url ?? config.manifest?.graph?.url ?? null;
  const ask = graphQueryFor({ tx, saleId });
  let rows = null;
  let failed = false;
  if (url && ask) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: ask.query, variables: ask.variables }),
      });
      const body = await res.json();
      rows = graphRowsFrom(body, ask.field);
      failed = rows === null;
    } catch {
      failed = true;
    }
  }
  const panel = graphPanel({ url, rows, failed });
  say("graph-line", panel.text);
  const mark = document.getElementById("graph-mark");
  if (mark) mark.hidden = !panel.colour;
  const ens = document.getElementById("r-ens");
  if (ens) ens.hidden = integrationForReceipt({ indexed: panel.colour, payName }) !== "ens";
  const list = document.getElementById("graph-rows");
  if (list) {
    list.replaceChildren();
    for (const row of panel.rows ?? []) {
      const li = document.createElement("li");
      li.textContent = shortId(row.id ?? row.transactionHash ?? "");
      list.appendChild(li);
    }
    list.hidden = (panel.rows ?? []).length === 0;
  }
}

/**
 * Keeping the receipt. The download is the same lines as text and the share hands over this page's
 * own link; neither is offered until the receipt has been read, so nobody can save a blank one and
 * believe it means something.
 */
function wireKeeping(lines, spoken) {
  const download = document.getElementById("r-download");
  const share = document.getElementById("r-share");
  say("r-keep-why", `This receipt says: ${spoken.word}.`);
  if (download) {
    download.disabled = false;
    download.addEventListener("click", () => {
      const blob = new Blob([receiptText(lines)], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `unica-receipt-${String(lines.Transaction).slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  if (share) {
    share.disabled = false;
    // A control says what it does: with no share sheet on this device, this copies the link.
    if (!globalThis.navigator?.share) share.textContent = "Copy link";
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
        () => say("r-keep-why", "Receipt link copied."),
        () => say("r-keep-why", "Copy this page's address by hand."),
      );
    });
  }
}
