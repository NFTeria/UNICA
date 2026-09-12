/**
 * The customer's checkout (/pay/), wired to a companion demo server (script/anvil/serve.sh) that
 * fronts a loopback Anvil chain. If that server is not answering, this file does nothing further:
 * the page stays the static document it already is, which is still a correct description of a
 * checkout rather than a broken one.
 *
 * WHAT A CUSTOMER READS HERE. The business and its pay name, the amount due, the most they can be
 * charged, what the business is guaranteed to receive, whether a conversion is involved, the fees,
 * the network, the expiry, and which assets can be paid with at this moment. Everything else is
 * behind a disclosure.
 *
 * NOTHING HERE IS BAKED IN. The RPC endpoint, chain id, deployment manifest and demo record all
 * come from one fetch of the companion server's `/local/config.json`, never a literal address
 * written in this file. `apps/web/build.mjs`'s FORBIDDEN_IN_OUTPUT scan enforces exactly this for every file this
 * build emits, assets included.
 *
 * SENDING GOES THROUGH apps/web/assets/wallet.js. A browser wallet, when one is installed, signs in
 * its own extension; on the local testnet with no wallet, the chain's own already-unlocked
 * account executes `eth_sendTransaction({from})` with no key anywhere. This file never sees either.
 *
 * THE PAID RULE IS NOT REIMPLEMENTED HERE. `paymentStatus`, `canAuthorizePayment` and
 * `canInitiateSale` are imported from `tools/unica-pos-cli/render.mjs`, the one place UNICA states
 * "PAID only when evidence.decision === 'VERIFIED'" (docs/unica-v4/EVENT-SCHEMA.md F8). This file
 * only turns that status into the words a customer reads: "Paid (checked)" appears when, and only
 * when, that function answers PAID. The selector this file needs for `approve`/`pay` calldata reuses
 * the same keccak-256 implementation the ENSv2 layer already carries at `web/ensv2/keccak.mjs`.
 * Both are fetched, at runtime, from the two exact repository paths a plain relative import already
 * names below; `script/anvil/serve.sh` serves those two files verbatim so the identical import
 * specifier resolves the same way under `node --test` and in a browser.
 *
 * WORDS ON SCREEN. A customer reads "business", "pay name", "register", "sale", "amount you pay",
 * "they receive", "Local testnet". Contract names, calldata and hex stay out of the page
 * except inside a "Details" disclosure.
 */
import { canAuthorizePayment, canInitiateSale, paymentStatus } from "../../../tools/unica-pos-cli/render.mjs";
import { keccak256, toHex } from "../../../web/ensv2/keccak.mjs";
import { PRACTICE_MODE_LABEL, connectWallet, discoverProviders, networkName, waitForReceipt } from "./wallet.js";
import { fillAdvanced, loadConfig, loadEvidence, say as setText, show as unhideId } from "./local.js";
import { ASSET_STATUS, assetLabel, assetMenu, chooseSettlementRoute, formatAmountFor, routeLabel, validateEnvironment } from "./product.js";

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

if (typeof document !== "undefined" && document.getElementById("checkout")) {
  main().catch((e) => {
    const wallet = document.getElementById("wallet");
    if (wallet) wallet.textContent = `The companion could not be reached: ${e.message}`;
  });
}

async function main() {
  const config = await loadConfig();
  // No companion server: the page stays exactly the static document it already is, which is a
  // correct description of a checkout rather than a broken one.
  if (!config) return;
  const record = config.record;

  const environment = validateEnvironment(config.manifest ?? config);
  const banner = document.getElementById("env-banner");
  if (banner) {
    banner.textContent = environment.banner
      ? `${environment.banner} — ${environment.networkName}. ${environment.reason}`
      : `${environment.networkName}. ${environment.reason}`;
  }
  renderPayableAssets(config);
  fillAdvanced(config, {
    order: record?.order?.id ?? null,
    tx: record?.settlement?.transactionHash ?? null,
    reasons: record?.evidence?.reasonCodes ?? null,
  });

  say("terms", record
    ? "Sale read from the network."
    : "The local practice server is running, but no sale has been recorded yet. Run: make anvil-demo");
  if (record) {
    show("order-terms");
    set("order-merchant-name", businessNameFrom(record.merchant?.name));
    set("order-merchant-payname", record.merchant?.name ?? "(unknown)");
    set("order-terminal", registerNameFrom(record.terminal?.name));
    set("order-merchant-address", record.merchant?.address ?? "(unknown)");
    const m = record.merchant ?? {};
    set("order-identity-art", m.identityToken || m.rendererVersion
      ? `${m.identityToken ?? "?"} (a badge is not proof of who owns the address)`
      : "(none recorded)");
    set("order-id", record.order?.id ?? "(unknown)");
    set("pay-business", businessNameFrom(record.merchant?.name));
    set("pay-verified-name", record.merchant?.name ? `Paying ${record.merchant.name}` : "This business has no pay name.");
    const due = formatAmountFor(record.order?.inputAmount, record.order?.inputAsset, config);
    const floor = formatAmountFor(record.order?.minimumOutput, record.order?.outputAsset, config);
    set("pay-amount-due", due);
    set("order-input", due);
    set("order-max", `${due} — this is the exact amount, and it cannot rise`);
    set("order-output", `at least ${floor}`);
    set("order-route", conversionLine(record, config));
    const receiptLink = document.getElementById("receipt-link");
    if (receiptLink && record.order?.id) receiptLink.href = `../receipt/?order=${record.order.id}`;
    set("order-network", networkName(record.chainId ?? config.chainId));
    set("order-fees", formatFeesLine(record.evidence?.receipt));
    const expiryEl = document.getElementById("order-expiry");
    if (expiryEl) {
      const tick = () => { expiryEl.textContent = formatCountdown(record.order?.expiry); };
      tick();
      setInterval(tick, 1000);
    }
  }

  const connectBtn = document.getElementById("connect");
  const payBtn = document.getElementById("pay");
  const verifyAgainBtn = document.getElementById("verify-again");
  if (connectBtn) connectBtn.disabled = false;

  let session = null;

  const renderBlockers = () => {
    const now = Math.floor(Date.now() / 1000);
    const { allowed, reasons } = computeBlockers({ config, record, connectedAddress: session?.address ?? null, walletChainId: session?.chainId ?? null, now });
    const list = document.getElementById("active-blockers");
    if (list) {
      list.innerHTML = "";
      if (reasons.length === 0) {
        list.hidden = true;
      } else {
        list.hidden = false;
        for (const code of reasons) {
          const li = document.createElement("li");
          li.textContent = REASON_TEXT[code] ?? code;
          list.appendChild(li);
        }
      }
    }
    if (payBtn) payBtn.disabled = !allowed || !session || Boolean(record?.settlement?.transactionHash);
    return { allowed, reasons };
  };

  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      say("wallet", "Looking for a wallet in this browser...");
      try {
        const providers = await discoverProviders(window);
        const asParam = new URLSearchParams(location.search).get("as");
        const result = await connectWallet({ config, providers, localFrom: asParam || record?.order?.payer || null });
        if (result.blocked) {
          say("wallet", result.blocked);
          say("network", "Not connected.");
          return;
        }
        session = result.session;
        say("wallet", `Connected: ${session.address}${result.note ? `. ${result.note}` : "."}`);
        say("network", session.networkName);
      } catch (e) {
        say("wallet", `Could not connect: ${e.message}`);
      }
      renderBlockers();
    });
  }

  const showEvidence = (verdict) => {
    show("evidence-output");
    set("evidence-decision", decisionText(verdict?.decision));
    fillAdvanced(config, {
      order: record?.order?.id ?? null,
      tx: record?.settlement?.transactionHash ?? null,
      reasons: verdict?.reasonCodes ?? null,
    });
  };

  const fetchEvidence = (orderId) => loadEvidence(orderId);

  const checkAndRenderStatus = async (orderId, { txReceipt = null } = {}) => {
    const verdict = await fetchEvidence(orderId);
    showEvidence(verdict);
    const status = paymentStatus({ txReceipt, evidence: verdict });
    say("payment-status", statusText(status));
    return status;
  };

  // Already paid by the demo script: never re-send, only ever re-check.
  if (record?.settlement?.transactionHash && record?.order?.id) {
    unhide(verifyAgainBtn);
    checkAndRenderStatus(record.order.id, { txReceipt: { status: record.settlement.status } }).catch(() => {});
  }

  if (verifyAgainBtn) {
    verifyAgainBtn.addEventListener("click", () => {
      if (record?.order?.id) checkAndRenderStatus(record.order.id).catch((e) => say("payment-status", `Could not check again: ${e.message}`));
    });
  }

  if (payBtn) {
    payBtn.addEventListener("click", async () => {
      const { allowed } = renderBlockers();
      if (!allowed || !session || !record?.order?.id) return;
      payBtn.disabled = true;
      try {
        say("payment-status", statusText("SUBMITTED"));
        const executor = record.manifest?.contracts?.executor?.address;
        const asset = record.order.inputAsset;
        await session.send({ to: asset, data: encodeApproveCalldata(executor, record.order.inputAmount) });
        const payHash = await session.send({ to: executor, data: encodePayCalldata(record.order.id) });
        say("payment-status", statusText("PENDING"));

        const receipt = await waitForReceipt(session, payHash);
        if (!receipt) {
          say("payment-status", statusText("UNKNOWN"));
          return;
        }
        if (Number(receipt.status) === 0) {
          say("payment-status", statusText("FAILED"));
          return;
        }
        await checkAndRenderStatus(record.order.id, { txReceipt: receipt });
        unhide(verifyAgainBtn);
      } catch (e) {
        say("payment-status", `Could not pay: ${e.message}`);
      } finally {
        renderBlockers();
      }
    });
  }

  renderBlockers();
}

/**
 * The assets this checkout can accept at this moment. A customer holding one that is temporarily
 * unavailable should read that here, before connecting anything, rather than discover it from a
 * refusal.
 */
function renderPayableAssets(config) {
  const list = document.getElementById("pay-asset-list");
  if (!list) return;
  const menu = assetMenu(config);
  list.innerHTML = "";
  for (const asset of menu) {
    const li = document.createElement("li");
    const sym = document.createElement("span");
    sym.className = "sym";
    sym.textContent = assetLabel(asset);
    const badge = document.createElement("span");
    badge.className = "availability";
    badge.dataset.status = asset.status;
    badge.textContent = asset.text;
    li.append(sym, badge);
    list.appendChild(li);
  }
  const available = menu.filter((a) => a.status !== ASSET_STATUS.UNAVAILABLE).length;
  setText("pay-assets-said", `${menu.length} payment asset${menu.length === 1 ? "" : "s"} read, ${available} available right now.`);
  unhideId("pay-asset-list");
}

function say(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function set(id, text) {
  say(id, text);
}
function show(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}
function unhide(el) {
  if (el) el.hidden = false;
}
