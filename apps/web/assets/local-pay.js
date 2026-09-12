/**
 * The customer's checkout (/pay/), wired to the companion server (script/anvil/serve.sh) that
 * fronts a loopback chain. If that server is not answering, this file does nothing further: the
 * page stays the static document it already is, which is still a correct description of a checkout
 * rather than a broken one.
 *
 * THREE LINKS, ONE CARD. `?order=` is a payment a register created, `?product=` is one thing out of
 * a business's catalogue, and `?business=` is the whole shop. `assets/storefront.js` turns each of
 * them into the same shape, and this file renders that shape and wires the one button.
 *
 * WHAT A CUSTOMER READS HERE. Who they are paying, what for, the total, the asset they spend and
 * the asset the business receives, and one line about the rate. Everything else is behind a
 * disclosure, and every figure is at its own asset's decimals.
 *
 * NOTHING HERE IS BAKED IN. The RPC endpoint, chain id, deployment manifest and the payment itself
 * all come from one fetch of `/local/config.json` and, for a catalogue, `/local/catalog`; never a
 * literal address written in this file. `apps/web/build.mjs`'s FORBIDDEN_IN_OUTPUT scan enforces
 * exactly this for every file this build emits, assets included.
 *
 * SENDING GOES THROUGH apps/web/assets/wallet.js. A browser wallet, when one is installed, signs in
 * its own extension; on the local testnet with no wallet, the chain's own already-unlocked account
 * executes `eth_sendTransaction({from})` with no key anywhere. This file never sees either.
 *
 * THE PAID RULE IS NOT REIMPLEMENTED HERE. `paymentStatus`, `canAuthorizePayment` and
 * `canInitiateSale` are imported from `tools/unica-pos-cli/render.mjs`, the one place UNICA states
 * "PAID only when evidence.decision === 'VERIFIED'" (docs/unica-v4/EVENT-SCHEMA.md F8). This file
 * only turns that status into the words a customer reads. The selector this file needs for
 * `approve`/`pay` calldata reuses the same keccak-256 implementation the ENSv2 layer already
 * carries at `web/ensv2/keccak.mjs`. Both are fetched, at runtime, from the two exact repository
 * paths a plain relative import already names below; `script/anvil/serve.sh` serves those two files
 * verbatim so the identical import specifier resolves the same way under `node --test` and in a
 * browser.
 *
 * WORDS ON SCREEN. A customer reads "business", "pay name", "register", "you pay", "they receive"
 * and the network's name. Contract names, calldata and long identifiers stay out of the page except
 * inside a disclosure somebody has to open.
 */
import { canAuthorizePayment, canInitiateSale, paymentStatus } from "../../../tools/unica-pos-cli/render.mjs";
import { keccak256, toHex } from "../../../web/ensv2/keccak.mjs";
import { PRACTICE_MODE_LABEL, connectWallet, discoverProviders, networkName, rpcRequest, waitForReceipt } from "./wallet.js";
import { fillAdvanced, loadConfig, loadEvidence, say as setText } from "./local.js";
const ORDER_URL = "/local/order";
import { chooseSettlementRoute, routeLabel, validateEnvironment } from "./product.js";
import { decodeString, decodeUint, encodeCall } from "./abi.js";
import { parseTokenUri } from "./local-join.js";
import { businessAccent, businessStyle } from "./brand.js";
import { businessIdentity, orderCard, paidThroughText, productCard, readPayTarget, shopCard, shortAddress, verdict, orderCardFromRead } from "./storefront.js";

// ---- labels ---------------------------------------------------------------------------------------

/** The practice-mode words, from the business-language dictionary. */
export const TEST_MODE_LABEL = "Testnet";
export const NO_VALUE_LABEL = PRACTICE_MODE_LABEL;
export { PRACTICE_MODE_LABEL };

const REASON_TEXT = {
  WRONG_NETWORK: "Wrong network. This sale was created on a different network than the one this page is connected to.",
  WRONG_PAYER: "This sale is for a different customer wallet than the one connected.",
  ORDER_EXPIRED: "This sale expired before it was paid. Nothing was charged.",
  TERMINAL_REVOKED: "The register that started this sale has since been revoked.",
};
export { REASON_TEXT };

// ---- pure blocker functions, unit-tested directly -----------------------------------------------

/** `config` is the object served by GET /local/config.json: {rpc, chainId, manifest, record}. */
export function wrongNetworkBlocker(config, walletChainId = null) {
  if (!config || !config.manifest) return false;
  const manifestChainId = config.manifest.chainId;
  if (manifestChainId === undefined || manifestChainId === null) return false;
  if (Number(config.chainId) !== Number(manifestChainId)) return true;
  if (walletChainId !== null && walletChainId !== undefined && Number(walletChainId) !== Number(manifestChainId)) return true;
  return false;
}

/** `record` is the demo record shape written by script/anvil/demo.sh (or null). */
export function wrongPayerBlocker(record, connectedAddress) {
  const boundPayer = record?.order?.payer ?? record?.connectedPayer;
  if (!boundPayer || !connectedAddress) return false;
  return String(connectedAddress).toLowerCase() !== String(boundPayer).toLowerCase();
}

export function orderExpiredBlocker(record, nowSeconds = Math.floor(Date.now() / 1000)) {
  const deadline = record?.order?.expiry;
  if (deadline === undefined || deadline === null) return false;
  return Number(nowSeconds) >= Number(deadline);
}

export function terminalRevokedBlocker(record) {
  const status = record?.terminal?.statusAtAdmission;
  return Boolean(status) && String(status).toUpperCase() !== "ACTIVE";
}

/**
 * Every reason this customer may not proceed, found rather than short-circuited on the first one.
 * A countertop screen that shows only one blocker at a time makes a customer fix it and then
 * discover the next (the same reasoning `canAuthorizePayment` itself documents).
 */
export function computeBlockers({ config, record, connectedAddress, walletChainId = null, now } = {}) {
  const reasons = [];
  if (wrongNetworkBlocker(config, walletChainId)) reasons.push("WRONG_NETWORK");
  if (wrongPayerBlocker(record, connectedAddress)) reasons.push("WRONG_PAYER");
  if (orderExpiredBlocker(record, now)) reasons.push("ORDER_EXPIRED");
  if (terminalRevokedBlocker(record)) reasons.push("TERMINAL_REVOKED");
  return { allowed: reasons.length === 0, reasons };
}

// Re-exported so a caller of this module never has to reach into tools/unica-pos-cli/render.mjs
// separately, and so the "single rule that may say PAID" is exercised, not paraphrased, by tests.
export { canAuthorizePayment, canInitiateSale, paymentStatus };

/** Thin, named wrapper: the txHash-alone-is-never-PAID rule, under the name this file's tests use. */
export function deriveStatus({ txSubmitted = false, txHash = null, txReceipt = null, evidence = null } = {}) {
  return paymentStatus({ txSubmitted, txHash, txReceipt, evidence });
}

/**
 * What a customer is told about conversion, in the two phrases this product uses and no others.
 * The order itself already fixes both amounts, so the sentence never implies a price the customer
 * could still be moved off.
 */
export function conversionLine(record, config) {
  const inputAsset = record?.order?.inputAsset;
  const outputAsset = record?.order?.outputAsset;
  if (!inputAsset || !outputAsset) return "Not known yet.";
  const route = chooseSettlementRoute({
    customerAsset: { address: inputAsset },
    payoutAsset: { address: outputAsset },
    marketPair: config?.marketPair ?? null,
    contracts: config?.contracts ?? {},
  });
  return routeLabel(route);
}

/** The words a customer reads for each status. "Paid (checked)" only ever comes from PAID. */
export function statusText(status) {
  switch (status) {
    case "PAID": return "Paid (checked).";
    case "FAILED": return "Declined. Nothing was charged.";
    case "PENDING": return "Waiting for the network to confirm...";
    case "SUBMITTED": return "Sent. Waiting for the network...";
    case "UNKNOWN": return "Not confirmed yet.";
    default: return "Waiting for the customer.";
  }
}

/** The words for the payment check's own decision, shown above the raw details. */
export function decisionText(decision) {
  switch (decision) {
    case "VERIFIED": return "Paid (checked)";
    case "REFUSED": return "Declined";
    case "UNKNOWN": return "Not confirmed yet";
    default: return "No check yet";
  }
}

// ---- ABI encoding, by hand ------------------------------------------------------------------------
// Exactly the shapes `approve(address,uint256)` and `pay(bytes32)` need: static words only. Written
// from the ABI specification rather than imported; the one piece reused is keccak-256 itself.

const stripHex = (h) => (typeof h === "string" && (h.startsWith("0x") || h.startsWith("0X")) ? h.slice(2) : h);
const padLeft = (hex, len) => hex.padStart(len, "0");

export function wordFromAddress(address) {
  const h = stripHex(address).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`not a 20-byte address: ${address}`);
  return padLeft(h, 64);
}

export function wordFromUint(value) {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n) throw new Error("wordFromUint is unsigned");
  const h = v.toString(16);
  if (h.length > 64) throw new Error("value does not fit in 32 bytes");
  return padLeft(h, 64);
}

export function wordFromBytes32(value) {
  const h = stripHex(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`not 32 bytes: ${value}`);
  return h;
}

/** The first 4 bytes of keccak256(signature): a Solidity function selector, computed, not looked up. */
export function selectorOf(signature) {
  const digest = keccak256(new TextEncoder().encode(signature));
  return toHex(digest.slice(0, 4));
}

export function encodeApproveCalldata(spender, amount) {
  return selectorOf("approve(address,uint256)") + wordFromAddress(spender) + wordFromUint(amount);
}

export function encodePayCalldata(orderId) {
  return selectorOf("pay(bytes32)") + wordFromBytes32(orderId);
}

// ---- small formatting helpers, also pure and tested -----------------------------------------------

export function formatAmount(amount, symbol) {
  if (amount === undefined || amount === null) return `-- ${symbol ?? ""}`.trim();
  return `${amount} ${symbol ?? ""}`.trim();
}

export function formatFeesLine(receipt) {
  if (!receipt) return "Fees: not known yet. Shown once the payment is checked.";
  const pct = (pips) => (Number(pips ?? 0) / 10000).toFixed(2) + "%";
  return `Fees: market ${pct(receipt.lpFeePips)} . protocol ${pct(receipt.protocolFeePips)} . UNICA ${pct(receipt.hookFeePips)}`;
}

/** `mm:ss`, or "expired" once `nowSeconds` reaches `deadlineSeconds`. Never negative. */
export function formatCountdown(deadlineSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (deadlineSeconds === undefined || deadlineSeconds === null) return "unknown";
  const remaining = Number(deadlineSeconds) - Number(nowSeconds);
  if (remaining <= 0) return "expired";
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "freshcuts.unica.eth" -> "freshcuts": the business as a person names it. */
export function businessNameFrom(payName) {
  if (!payName) return "(unknown)";
  return String(payName).split(".")[0] || String(payName);
}

/** "chair-1.terminals.freshcuts.unica.eth" -> "chair-1": the register's own name. */
export function registerNameFrom(terminalName) {
  if (!terminalName) return "(unknown)";
  return String(terminalName).split(".")[0] || String(terminalName);
}

/** The full text block the "Sale" panel renders, so its labels are independently testable. */
export function renderTermsText(record) {
  const m = record?.merchant ?? {};
  const o = record?.order ?? {};
  const chainId = record?.chainId ?? record?.manifest?.chainId;
  const lines = [];
  lines.push(TEST_MODE_LABEL);
  lines.push(NO_VALUE_LABEL);
  lines.push(`Business: ${businessNameFrom(m.name)}`);
  lines.push(`Pay name: ${m.name ?? "(unknown)"}`);
  lines.push(`Register: ${registerNameFrom(record?.terminal?.name)}`);
  lines.push(`Amount you pay: ${formatAmount(o.inputAmount, o.inputSymbol)}`);
  lines.push(`They receive: at least ${formatAmount(o.minimumOutput, o.outputSymbol)}`);
  lines.push(`Network: ${networkName(chainId)}`);
  lines.push(`Expires: ${formatCountdown(o.expiry)}`);
  lines.push(formatFeesLine(record?.evidence?.receipt));
  lines.push(`Where the money goes: ${m.address ?? "(unknown)"}`);
  if (m.identityToken || m.rendererVersion) {
    lines.push(`Business badge: ${m.identityToken ?? "?"} (a badge is not proof of who owns the address)`);
  }
  return lines.join("\n");
}

// ---- DOM wiring; never runs under `node --test`; document is undefined there --------------------

export const CATALOG_URL = "/local/catalog";

/** One product, or one seller's list. Answers null rather than throwing when nothing is serving it. */
export async function loadCatalog(query, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${CATALOG_URL}?${query}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** The verdict for one transaction out of what a business was paid. Never derived from a hash alone. */
export function verdictForTransaction(answer, hash) {
  const list = Array.isArray(answer?.payments) ? answer.payments : [];
  const hit = list.find((p) => String(p.transactionHash ?? "").toLowerCase() === String(hash ?? "").toLowerCase()) ?? null;
  return verdict(hit?.decision ?? null);
}

if (typeof document !== "undefined" && document.getElementById("checkout")) {
  main().catch((e) => setText("co-status", `This payment could not be read: ${e.message}`));
}

const scheme = () => (globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light");

function setHidden(id, hidden) {
  const el = document.getElementById(id);
  if (el) el.hidden = hidden;
}

/**
 * The one integration mark this view is allowed to wear. Every other one is hidden, so a screen can
 * never end up showing two attributions at once however its data arrived.
 */
function showIntegration(which) {
  for (const [key, id] of [["ens", "co-ens"], ["uniswap", "co-uniswap"], ["chainlink", "co-chainlink"]]) {
    setHidden(id, key !== which);
  }
}

/** The badge the business's identity token draws, when this deployment carries one. */
async function readBadgeImage(config, badge) {
  try {
    const data = encodeCall("tokenURI(uint256)", [badge.tokenId]);
    const answer = await rpcRequest(config.rpc, "eth_call", [{ to: badge.address, data }, "latest"]);
    return parseTokenUri(decodeString(answer));
  } catch {
    return null;
  }
}

/** Who is being paid: the name, the pay name, and the badge or the business's own accent square. */
async function renderIdentity(config) {
  const identity = businessIdentity(config);
  setText("co-business", identity.display);
  setText("co-payname", identity.payName ?? "No pay name");
  const square = document.getElementById("co-badge");
  const accent = businessAccent(identity.node, scheme());
  if (square && accent) square.setAttribute("style", businessStyle(accent));
  if (square && identity.badge) {
    const art = await readBadgeImage(config, identity.badge);
    if (art?.image) {
      const img = document.createElement("img");
      img.src = art.image;
      img.alt = "";
      square.replaceChildren(img);
    }
  }
  return identity;
}

/** The lines, the total and the two sides of the payment. The same shape for all three links. */
function renderCard(card) {
  setText("co-line-what", card.line.what ?? "—");
  setText("co-line-much", card.line.amount ?? "—");
  setText("co-total", card.total ?? "—");
  setText("co-pay-asset", card.pay.text ?? "—");
  setText("co-receive-asset", card.receive.text ?? "—");
  showIntegration(card.integration);
}

async function main() {
  const config = await loadConfig();
  // Nothing answering: the page stays the static document it already is, which is a correct
  // description of a checkout rather than a broken one.
  if (!config) return;

  const environment = validateEnvironment(config.manifest ?? config);
  const banner = document.getElementById("env-banner");
  if (banner) {
    banner.textContent = environment.banner ? `${environment.banner} · ${environment.networkName}` : environment.networkName;
  }
  setText("order-network", networkName(config.chainId));
  await renderIdentity(config);

  const target = readPayTarget(location.search);
  if (target.malformed) {
    setText("co-status", "That link does not name a payment, so nothing was looked up.");
    return;
  }
  if (target.kind === "business") return renderShop(config, target.business);
  if (target.kind === "product") return renderProduct(config, target.product);
  return renderOrder(config, target.order ?? config.record?.order?.id ?? null);
}

// ---- a shop ---------------------------------------------------------------------------------------

/**
 * Everything one business is selling. Each product is its own card with its own way in, so the shop
 * link and a single product link lead to the same screen from either direction.
 */
async function renderShop(config, seller) {
  for (const id of ["co-lines", "co-total", "co-after"]) setHidden(id, true);
  const flow = document.querySelector(".co-flow");
  if (flow) flow.hidden = true;
  const note = document.querySelector(".co-note");
  if (note) note.hidden = true;
  const payBtn = document.getElementById("co-pay");
  if (payBtn) payBtn.hidden = true;
  setText("co-why", "");

  const catalog = await loadCatalog(`seller=${encodeURIComponent(seller)}`);
  if (!catalog) {
    setText("co-status", "This shop could not be read.");
    return;
  }
  const shop = shopCard(catalog, config);
  showIntegration(shop.integration);
  const list = document.getElementById("co-shop");
  if (!list) return;
  list.replaceChildren();
  for (const product of shop.products) {
    const li = document.createElement("li");
    li.className = "shop-item";
    const name = document.createElement("span");
    name.className = "shop-name";
    name.textContent = product.name ?? "Unnamed";
    const price = document.createElement("span");
    price.className = "shop-price";
    price.textContent = product.total ?? "—";
    const kind = document.createElement("span");
    kind.className = "shop-kind";
    kind.textContent = product.kindText;
    const buy = document.createElement("a");
    buy.className = "cta";
    buy.href = `./?product=${product.id}`;
    buy.textContent = "Buy";
    li.append(name, price, kind, buy);
    list.appendChild(li);
  }
  list.hidden = false;
  setText("co-status", shop.products.length === 0 ? "Nothing is on sale here right now." : `${shop.products.length} on sale.`);
}

// ---- one catalogue product --------------------------------------------------------------------------

async function renderProduct(config, productId) {
  setHidden("co-shop", true);
  const answer = await loadCatalog(`product=${encodeURIComponent(productId)}`);
  const product = answer?.product ?? null;
  if (!product) {
    setText("co-status", "This product could not be read.");
    setText("co-why", "Nothing has been read for this link.");
    return;
  }
  const card = productCard(product, config);
  renderCard(card);
  setText("co-price-note", card.kindText);
  setText("order-input", card.pay.text ?? "—");
  setText("order-max", card.total ?? "—");
  setText("order-output", card.receive.text ?? "—");
  setText("order-route", "No conversion needed");
  setText("order-id", card.id);
  setText("order-merchant-name", card.identity.display);
  setText("order-merchant-payname", card.identity.payName ?? "—");
  setText("order-merchant-address", card.payout ?? card.seller ?? "—");

  const catalogAddress = config.contracts?.productCatalog ?? config.manifest?.productCatalog?.address ?? null;
  const payBtn = document.getElementById("co-pay");
  if (!card.active || card.sold) {
    setText("co-why", card.sold ? "This one has already been bought." : "This is not on sale right now.");
    setText("co-status", card.sold ? "Sold." : "Not on sale.");
    return;
  }
  if (!catalogAddress) {
    setText("co-why", "This network cannot take a catalogue payment yet.");
    return;
  }
  if (payBtn) {
    payBtn.disabled = false;
    setText("co-why", "Your wallet approves the amount, then the purchase.");
    payBtn.addEventListener("click", () =>
      buyProduct({ config, card, product, catalogAddress }).catch((e) => setText("co-status", `Could not pay: ${e.message}`)),
    );
  }
}

async function buyProduct({ config, card, product, catalogAddress }) {
  const payBtn = document.getElementById("co-pay");
  if (payBtn) payBtn.disabled = true;
  const session = await connect(config, card.onlyBuyer);
  if (!session) {
    if (payBtn) payBtn.disabled = false;
    return;
  }
  setText("co-status", statusText("SUBMITTED"));
  const price = BigInt(product.price);
  const allowance = await readAllowance(config, product.asset, session.address, catalogAddress);
  if (allowance < price) {
    await session.send({ to: product.asset, data: encodeApproveCalldata(catalogAddress, product.price) });
  }
  const hash = await session.send({ to: catalogAddress, data: encodeCall("buy(uint256)", [card.id]) });
  setText("co-status", statusText("PENDING"));
  const receipt = await waitForReceipt(session, hash);
  if (!receipt) {
    setText("co-status", statusText("UNKNOWN"));
    return;
  }
  if (Number(receipt.status) === 0) {
    setText("co-status", statusText("FAILED"));
    return;
  }
  await settleProductVerdict({ config, card, session, hash });
}

/** A sale is Paid only when the business's own payments say VERIFIED, never because a hash exists. */
async function settleProductVerdict({ config, card, session, hash }) {
  const recipient = card.payout ?? card.seller ?? card.identity.address;
  const spoken = verdictForTransaction(await loadPayments(recipient), hash);
  setText("co-status", spoken.word === "Paid" ? statusText("PAID") : statusText("UNKNOWN"));
  const link = document.getElementById("co-receipt-link");
  if (link) link.setAttribute("href", `../receipt/?chain=${config.chainId}&tx=${hash}`);
  setHidden("co-after", false);
  if (card.productKind === "recurring") {
    const text = paidThroughText(await readPaidThrough(config, card.id, session.address));
    if (text) setText("co-price-note", text);
  }
}

async function loadPayments(wallet, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/local/payments?wallet=${encodeURIComponent(wallet)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function readAllowance(config, asset, owner, spender) {
  try {
    const data = encodeCall("allowance(address,address)", [owner, spender]);
    return BigInt(decodeUint(await rpcRequest(config.rpc, "eth_call", [{ to: asset, data }, "latest"])));
  } catch {
    return 0n;
  }
}

async function readPaidThrough(config, productId, buyer) {
  const catalogAddress = config.contracts?.productCatalog ?? config.manifest?.productCatalog?.address ?? null;
  if (!catalogAddress) return null;
  try {
    const data = encodeCall("paidThrough(uint256,address)", [productId, buyer]);
    return Number(decodeUint(await rpcRequest(config.rpc, "eth_call", [{ to: catalogAddress, data }, "latest"])));
  } catch {
    return null;
  }
}

// ---- one order from a register ----------------------------------------------------------------------

async function renderOrder(config, orderId) {
  setHidden("co-shop", true);
  const record = config.record ?? null;
  let card = orderCard(config);
  if (!card || !orderId || String(card.id ?? "").toLowerCase() !== String(orderId).toLowerCase()) {
    // Not the record's order: ask the chain for this id, through the companion, and build the card
    // from what it answers. A link is a claim; the chain is the answer.
    card = null;
    if (orderId) {
      try {
        const res = await fetch(`${ORDER_URL}?id=${encodeURIComponent(orderId)}`);
        if (res.ok) card = orderCardFromRead(config, await res.json());
      } catch {
        card = null;
      }
    }
    if (!card) {
      setText("co-status", "This payment could not be found.");
      setText("co-why", "Nothing has been read for this link.");
      return;
    }
  }
  // The chain's clock, read once: every deadline on this screen is judged and counted down by it.
  let chainSkew = 0;
  try {
    const head = await rpcRequest(config.rpc, "eth_getBlockByNumber", ["latest", false]);
    if (head?.timestamp) chainSkew = Number(BigInt(head.timestamp)) - Math.floor(Date.now() / 1000);
  } catch {
    chainSkew = 0;
  }
  renderCard(card);
  setText(
    "co-price-note",
    card.priceChecked ? "The price was set by a checked rate." : card.converts ? "The rate is fixed on this payment." : "No conversion needed.",
  );
  fillAdvanced(config, { order: card.id, tx: card.settledTx, reasons: record?.evidence?.reasonCodes ?? null });

  setText("order-merchant-name", card.identity.display);
  setText("order-merchant-payname", card.identity.payName ?? "—");
  setText("order-terminal", registerNameFrom(record?.terminal?.name));
  setText("order-merchant-address", card.identity.address ?? "—");
  setText("order-input", card.pay.text ?? "—");
  setText("order-max", card.pay.text ? `${card.pay.text} — this is the exact amount, and it cannot rise` : "—");
  setText("order-output", card.receive.text ? `at least ${card.receive.text}` : "—");
  setText("order-route", conversionLine(record, config));
  setText("order-fees", formatFeesLine(record?.evidence?.receipt));
  setText("order-id", card.id ?? "—");
  const expiry = document.getElementById("order-expiry");
  if (expiry) {
    const tick = () => {
      expiry.textContent = formatCountdown(card.expiry, Math.floor(Date.now() / 1000) + chainSkew);
    };
    tick();
    setInterval(tick, 1000);
  }

  let session = null;
  const payBtn = document.getElementById("co-pay");
  // The blockers judge THIS card, whether it came from the record or from the chain by id, and they
  // judge it by the chain's clock: a local testnet's time can sit hours from the wall clock, and an
  // order's deadline lives on the chain, not in this browser.
  const fromRecord = Boolean(record?.order?.id) && String(record.order.id).toLowerCase() === String(card.id ?? "").toLowerCase();
  const judged = fromRecord ? record : { order: { id: card.id, expiry: card.expiry, payer: card.payer }, terminal: null };
  const refresh = () => {
    const now = Math.floor(Date.now() / 1000) + chainSkew;
    const { allowed, reasons } = computeBlockers({
      config,
      record: judged,
      connectedAddress: session?.address ?? null,
      walletChainId: session?.chainId ?? null,
      now,
    });
    const list = document.getElementById("active-blockers");
    if (list) {
      list.replaceChildren();
      for (const code of reasons) {
        const li = document.createElement("li");
        li.textContent = REASON_TEXT[code] ?? code;
        list.appendChild(li);
      }
    }
    setHidden("blockers-none", reasons.length > 0);
    const expired = reasons.includes("ORDER_EXPIRED");
    setHidden("co-expired", !expired);
    if (expired) setText("co-expired", REASON_TEXT.ORDER_EXPIRED);
    const settled = Boolean(card.settledTx);
    setHidden("co-settled", !settled);
    if (settled) setText("co-settled", "This payment has already been made.");
    if (payBtn) {
      payBtn.disabled = !allowed || settled;
      setText(
        "co-why",
        settled
          ? "This payment has already been made."
          : allowed
            ? session
              ? "Your wallet confirms the amount."
              : "Your wallet opens when you press it."
            : "One of the checks above has not passed.",
      );
    }
    return allowed;
  };
  refresh();

  const check = async () => {
    const evidence = await loadEvidence(card.id);
    fillAdvanced(config, { order: card.id, tx: card.settledTx, reasons: evidence?.reasonCodes ?? null });
    const spoken = verdict(evidence?.decision ?? null);
    setText("co-status", spoken.word === "Paid" ? statusText("PAID") : decisionText(evidence?.decision));
    return spoken;
  };

  if (card.settledTx) {
    const link = document.getElementById("co-receipt-link");
    if (link) link.setAttribute("href", `../receipt/?chain=${config.chainId}&tx=${card.settledTx}`);
    setHidden("co-after", false);
    check().catch(() => {});
  }
  const recheck = document.getElementById("co-recheck");
  if (recheck) recheck.addEventListener("click", () => check().catch((e) => setText("co-status", `Could not check again: ${e.message}`)));

  if (payBtn) {
    payBtn.addEventListener("click", async () => {
      if (!refresh()) return;
      payBtn.disabled = true;
      try {
        if (!session) {
          session = await connect(config, card.payer);
          if (!session) {
            refresh();
            return;
          }
        }
        if (!refresh()) return;
        payBtn.disabled = true;
        setText("co-status", statusText("SUBMITTED"));
        // Pay the settler that holds this order, in the asset it is written in: the market executor
        // for a converting sale, the direct settler for a same-asset one. Never a guessed contract.
        const settler = card.settler ?? config.contracts?.executor ?? record?.manifest?.contracts?.executor?.address;
        const assetIn = card.assetIn?.address ?? record?.order?.inputAsset;
        const amountIn = card.amountIn ?? record?.order?.inputAmount;
        if (!settler || !assetIn || amountIn === null || amountIn === undefined) throw new Error("This payment does not say where it is paid or in what.");
        await session.send({ to: assetIn, data: encodeApproveCalldata(settler, amountIn) });
        const hash = await session.send({ to: settler, data: encodePayCalldata(card.id) });
        setText("co-status", statusText("PENDING"));
        const receipt = await waitForReceipt(session, hash);
        if (!receipt) {
          setText("co-status", statusText("UNKNOWN"));
          return;
        }
        if (Number(receipt.status) === 0) {
          setText("co-status", statusText("FAILED"));
          return;
        }
        const link = document.getElementById("co-receipt-link");
        if (link) link.setAttribute("href", `../receipt/?chain=${config.chainId}&tx=${hash}`);
        setHidden("co-after", false);
        await check();
      } catch (e) {
        setText("co-status", `Could not pay: ${e.message}`);
      } finally {
        refresh();
      }
    });
  }
}

/** The one way in. The wallet's own approval flow is the sign-in; there is no second login here. */
async function connect(config, preferred = null) {
  setText("wallet", "Opening your wallet…");
  try {
    const providers = await discoverProviders(window);
    const asParam = new URLSearchParams(location.search).get("as");
    const result = await connectWallet({ config, providers, localFrom: asParam || preferred || null });
    if (result.blocked) {
      setText("wallet", result.blocked);
      setText("network", "Not connected.");
      return null;
    }
    setText("wallet", `Connected ${shortAddress(result.session.address)}.`);
    setText("network", result.session.networkName);
    return result.session;
  } catch (e) {
    setText("wallet", `Could not connect: ${e.message}`);
    return null;
  }
}
