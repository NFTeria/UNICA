/**
 * The register (/business/payments/new/): the screen somebody stands at while a customer waits.
 *
 * THE WHOLE INTERACTION IS AMOUNT, CURRENCY, ONE BUTTON. Everything else the payment needs — which
 * settlement path it takes, what the customer's spend has to be, what floor protects the business —
 * is worked out here from the active deployment. A cashier is never asked to choose between two
 * settlement implementations, because a cashier has no way to know which is right and no way to
 * recover if they pick wrong.
 *
 * THE PATH IS CHOSEN, NOT OFFERED. Same asset in and out goes to the direct settler; different
 * assets go through the market. `chooseSettlementRoute` decides, from what the deployment carries,
 * and a path the deployment cannot perform is refused before the order exists rather than after
 * the customer has pressed pay.
 *
 * THE PRICE IS THE DEPLOYMENT'S OWN. The amount the customer will spend is derived from the price
 * the deployment's oracle answers with, right now, and the payment is refused if that read fails.
 * No price is written into this file and none is remembered from a previous sale.
 *
 * THE SQUARE IS A CONVENIENCE; THE LINK IS THE PAYMENT. If the square cannot be drawn — no
 * internet, a blocked script — the link is still complete and the screen says which one the
 * customer is looking at, rather than showing an empty box.
 */
import { encodeCall, topicOf, wordsOf } from "./abi.js";
import { fillAdvanced, loadConfig, loadEvidence, say, show } from "./local.js";
import {
  assetMenu,
  ASSET_STATUS,
  chooseSettlementRoute,
  formatAsset,
  paymentStatus,
  quoteOrder,
  routeLabel,
  toBaseUnits,
  validateEnvironment,
  withinPaymentLimit,
} from "./product.js";
import { connectWallet, discoverProviders, waitForReceipt } from "./wallet.js";

/** How long a customer has to pay before the sale stops being payable, in seconds. */
export const PAYMENT_WINDOW_SECONDS = 900;

/** `OrderCreated(bytes32,address,address,address,uint128,uint128,uint64)` puts the id in topic 1. */
export const ORDER_CREATED_SIGNATURE = "OrderCreated(bytes32,address,address,address,uint128,uint128,uint64)";

/**
 * The order id this transaction created, taken from the log the settlement contract itself emitted
 * rather than recomputed here. Recomputing it would mean this screen and the contract could
 * disagree about which payment the customer is being sent to, and the customer would find out.
 */
export function orderIdFromReceipt(receipt, contractAddress, topic0) {
  const logs = receipt?.logs ?? [];
  for (const log of logs) {
    if (String(log.address ?? "").toLowerCase() !== String(contractAddress ?? "").toLowerCase()) continue;
    if (String(log.topics?.[0] ?? "").toLowerCase() !== String(topic0 ?? "").toLowerCase()) continue;
    return log.topics?.[1] ?? null;
  }
  return null;
}

/** Decode the three words `latestPrice(address,address)` returns: price, decimals, updated time. */
export function decodeLatestPrice(hex) {
  const words = wordsOf(hex);
  if (words.length < 3) return null;
  return {
    price: BigInt("0x" + words[0]),
    decimals: Number(BigInt("0x" + words[1])),
    updatedAt: Number(BigInt("0x" + words[2])),
  };
}

/** The link a customer opens. Built from this page's own origin, so it works wherever it is served. */
export function customerLink(orderId, base) {
  const url = new URL("../../../pay/", base);
  url.search = `?order=${orderId}`;
  return url.toString();
}

// ---- DOM wiring; never runs under `node --test` -------------------------------------------------

if (typeof document !== "undefined" && document.getElementById("register")) {
  main().catch((e) => say("create-status", `This register could not finish loading: ${e.message}`));
}

async function main() {
  const config = await loadConfig();
  const createBtn = document.getElementById("create");
  const currencySelect = document.getElementById("currency");
  if (!config) {
    say("create-status", "The companion server is not answering, so this register cannot create a payment. Start it and reload.");
    say("create-why", "Disabled: this register has not been able to read its settings.");
    return;
  }

  const environment = validateEnvironment(config.manifest ?? config);
  const banner = document.getElementById("env-banner");
  if (banner) {
    banner.textContent = environment.banner
      ? `${environment.banner} · ${environment.networkName}`
      : `${environment.networkName}`;
  }
  fillAdvanced(config);

  const menu = assetMenu(config);
  const payoutAsset = menu.find((a) => a.role === "payout") ?? null;
  const spendable = menu.filter((a) => a.status !== ASSET_STATUS.UNAVAILABLE);
  if (currencySelect) {
    currencySelect.innerHTML = "";
    for (const asset of menu.filter((a) => a.labelled)) {
      const option = document.createElement("option");
      option.value = asset.address;
      option.textContent = asset.role === "payout" ? `${asset.symbol} (what you receive)` : asset.symbol;
      currencySelect.appendChild(option);
    }
    if (payoutAsset) currencySelect.value = payoutAsset.address;
  }

  if (!payoutAsset?.labelled) {
    say("create-status", "This setup could not label your payout asset, so this register will not price a payment.");
    say("create-why", "Disabled: the payout asset could not be read from the network.");
    return;
  }
  if (spendable.length === 0) {
    say("create-status", "No payment asset can be accepted right now, so there is nothing to charge for.");
    say("create-why", "Disabled: every payment asset is temporarily unavailable.");
    return;
  }

  // The asset the customer will spend: the first one that can actually be paid right now. A
  // register with one market has exactly one; a register with more would offer the choice here.
  const customerAsset = spendable.find((a) => a.role !== "payout") ?? spendable[0];
  const route = chooseSettlementRoute({
    customerAsset,
    payoutAsset,
    marketPair: config.marketPair,
    contracts: config.contracts ?? {},
  });
  if (route.kind === "none") {
    say("create-status", route.why);
    say("create-why", `Disabled: ${route.why}`);
    return;
  }

  const recipient = config.record?.merchant?.address ?? null;
  if (!recipient) {
    say("create-status", "This register does not know which wallet gets paid yet, so it will not create a payment.");
    say("create-why", "Disabled: the payout wallet has not been read.");
    return;
  }
  // The customer's wallet is typed or pasted at the register (or carried by ?customer= on a link
  // the register itself made). It is never taken from a stored record or a manifest.
  const typed = document.getElementById("customer-wallet")?.value?.trim() ?? "";
  const customerWallet = /^0x[0-9a-fA-F]{40}$/.test(typed)
    ? typed
    : (new URLSearchParams(location.search).get("customer") ?? null);
  if (!customerWallet) {
    say("create-status", "This register does not know which customer wallet this payment is for, so it will not create one.");
    say("create-why", "Disabled: no customer wallet is named for this payment.");
    return;
  }

  if (createBtn) createBtn.disabled = false;
  say("create-why", `Creates a payment for customer wallet ${customerWallet}. ${routeLabel(route)}.`);
  say("create-status", `Ready. ${routeLabel(route)}: ${route.why}`);

  createBtn?.addEventListener("click", async () => {
    createBtn.disabled = true;
    try {
      await createPayment({ config, route, customerAsset, payoutAsset, recipient, customerWallet });
    } catch (e) {
      say("create-status", `Could not create the payment: ${e.message}`);
    } finally {
      createBtn.disabled = false;
    }
  });
}

async function createPayment({ config, route, customerAsset, payoutAsset, recipient, customerWallet }) {
  const amountText = document.getElementById("amount")?.value ?? "";
  const currencyAddress = document.getElementById("currency")?.value ?? payoutAsset.address;
  const invoiceAsset = currencyAddress.toLowerCase() === payoutAsset.address.toLowerCase() ? payoutAsset : customerAsset;
  const invoiceUnits = toBaseUnits(amountText, invoiceAsset.decimals);

  say("create-status", "Connecting to your wallet...");
  const providers = await discoverProviders(window);
  const localFrom = new URLSearchParams(location.search).get("as")
    ?? config.manifest?.accounts?.terminalChair1
    ?? null;
  const connected = await connectWallet({ config, providers, localFrom });
  if (connected.blocked) {
    say("create-status", connected.blocked);
    return;
  }
  const session = connected.session;

  // The price this payment is worked out from, read now, from the deployment's own oracle.
  let quote = { amountIn: invoiceUnits, minOut: invoiceUnits };
  if (route.kind === "conversion") {
    const adapter = config.manifest?.market?.adapter ?? config.contracts?.oracleAdapter ?? null;
    if (!adapter) throw new Error("This setup names no price source, so a converted payment cannot be priced.");
    const answer = decodeLatestPrice(
      await session.call({ to: adapter, data: encodeCall("latestPrice(address,address)", [customerAsset.address, payoutAsset.address]) }),
    );
    if (!answer) throw new Error("The price source did not answer, so this payment was not created.");
    quote = quoteOrder({
      invoiceUnits,
      invoiceIn: invoiceAsset.role === "payout" ? "payout" : "customer",
      customerAsset,
      payoutAsset,
      price: answer.price,
      priceDecimals: answer.decimals,
    });
  }

  const cap = config.manifest?.market?.caps?.maxPerTxPayout ?? null;
  const limit = withinPaymentLimit(quote.minOut, cap);
  if (!limit.ok) {
    say("create-status", limit.sentence);
    return;
  }

  const deadline = Math.floor(Date.now() / 1000) + PAYMENT_WINDOW_SECONDS;
  const salt = "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  say("create-status", "Confirm the new payment in your wallet. Nothing is charged to the customer by this step.");
  const hash = await session.send({
    to: route.contract,
    data: encodeCall("createOrder(address,address,uint128,uint128,uint64,bytes32)", [
      recipient,
      customerWallet,
      quote.amountIn.toString(),
      quote.minOut.toString(),
      String(deadline),
      salt, // bytes32 salt, one per payment
    ]),
  });
  say("create-status", "Sent. Waiting for the network to confirm the new payment...");
  const receipt = await waitForReceipt(session, hash);
  if (!receipt) {
    say("create-status", "Not confirmed yet. Do not create it again; reload this page in a moment.");
    return;
  }
  if (Number(receipt.status) === 0) {
    say("create-status", "The network declined this payment. Nothing was created and nothing was charged.");
    return;
  }
  const orderId = orderIdFromReceipt(receipt, route.contract, topicOf(ORDER_CREATED_SIGNATURE));
  if (!orderId) {
    say("create-status", "The payment was created but this register could not read its number back. Open your receipts to find it.");
    return;
  }

  say("create-status", `Payment created for ${formatAsset(quote.minOut, payoutAsset)}. ${routeLabel(route)}.`);
  show("handover");
  const link = customerLink(orderId, location.href);
  const linkField = document.getElementById("pay-link");
  if (linkField) linkField.value = link;
  document.getElementById("copy-link")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(link).then(
      () => say("qr-said", "Link copied. Hand it to the customer."),
      () => say("qr-said", "Could not copy. Select the link and copy it by hand."),
    );
  });
  fillAdvanced(config, { order: orderId, tx: hash });
  await drawSquare(link);
  await awaitPayment(orderId);
}

/**
 * Draw the square the customer scans, using a QR encoder fetched from a public CDN. When it cannot
 * be fetched the link stands on its own and the screen says so — an empty box beside the words
 * "scan this" is worse than no box at all.
 */
async function drawSquare(link) {
  const box = document.getElementById("qr");
  if (!box) return;
  box.innerHTML = "";
  try {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js");
    if (typeof window.QRCode !== "function") throw new Error("the square drawer did not load");
    new window.QRCode(box, { text: link, width: 200, height: 200 });
    say("qr-said", "Let the customer scan this square, or send them the link.");
  } catch {
    box.textContent = "No square";
    say("qr-said", "The square could not be drawn on this device. The link above is the whole payment; send that instead.");
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("script did not load"));
    document.head.appendChild(el);
  });
}

/**
 * Watch one payment until it is checked. The word "Paid" appears only when `paymentStatus` says
 * PAID, which happens only on a VERIFIED verification — never on a transaction hash, never on a
 * timer, and never because the customer said they paid.
 */
async function awaitPayment(orderId, { intervalMs = 3000, attempts = 100 } = {}) {
  const checkAgain = document.getElementById("check-again");
  const once = async () => {
    const evidence = await loadEvidence(orderId);
    const status = paymentStatus({ evidence });
    if (status === "PAID") {
      say("payment-progress", "Paid (checked). The customer's payment has been verified.");
      return true;
    }
    if (status === "FAILED") {
      say("payment-progress", "Declined. This transaction is not recognized as a valid UNICA payment.");
      return true;
    }
    say("payment-progress", "Waiting for the customer. Nothing is marked paid until it has been checked.");
    return false;
  };
  if (checkAgain) {
    checkAgain.hidden = false;
    checkAgain.addEventListener("click", () => {
      once().catch((e) => say("payment-progress", `Could not check: ${e.message}`));
    });
  }
  for (let i = 0; i < attempts; i++) {
    if (await once()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  say("payment-progress", "This payment has not been checked yet. It is not paid until it is. Use Check again.");
}
