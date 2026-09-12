/**
 * Progressive enhancement for the /pay/ route ONLY, wiring it to a companion demo server
 * (script/anvil/serve.sh) that fronts a loopback Anvil chain. If that server is not running, the
 * fetch below 404s (or errors) and this file does nothing further — the page stays the static
 * document it already is.
 *
 * NOTHING HERE IS BAKED IN. The RPC endpoint, chain id, deployment manifest and demo record all
 * come from one relative fetch (`./../local/config.json`), never a literal address written in this
 * file — `apps/web/build.mjs`'s FORBIDDEN_IN_OUTPUT scan enforces exactly this for every file this
 * build emits, assets included.
 *
 * THE PAYER SIGNS NOTHING. The "wallet" here is one of the loopback chain's own pre-funded,
 * already-unlocked accounts, driven with `eth_sendTransaction({from})` and no private key anywhere
 * — the same impersonation discipline `script/anvil/lib.sh`'s `send_as` uses from the shell.
 *
 * THE PAID RULE IS NOT REIMPLEMENTED HERE. `paymentStatus`, `canAuthorizePayment` and
 * `canInitiateSale` are imported from `tools/unica-pos-cli/render.mjs` — the one place UNICA already
 * states "PAID only when evidence.decision === 'VERIFIED'" (docs/unica-v4/EVENT-SCHEMA.md F8). That
 * file has no imports of its own, so it is already browser-safe; this file does not re-derive its
 * rule, only its text. The selector this file needs for `approve`/`pay` calldata reuses the same
 * keccak-256 implementation the ENSv2 layer already carries at `web/ensv2/keccak.mjs` (also import-
 * free of anything Node-only). Both are fetched, at runtime, from the two exact repository paths a
 * plain relative import already names below — `script/anvil/serve.sh` serves those two files
 * verbatim (read, never copied) so the identical import specifier resolves the same way whether this
 * file runs under `node --test` (real filesystem) or in a browser (through the demo server).
 */
import { canAuthorizePayment, canInitiateSale, paymentStatus } from "../../../tools/unica-pos-cli/render.mjs";
import { keccak256, toHex } from "../../../web/ensv2/keccak.mjs";

// ---- labels, kept identical to the text tools/unica-pos-cli/render.mjs already uses -------------

export const TEST_MODE_LABEL = "[TEST MODE]";
export const NO_VALUE_LABEL = "Testnet demonstration -- no real value";

const REASON_TEXT = {
  WRONG_NETWORK: "Wrong network: this demo server's chain does not match the pinned deployment.",
  WRONG_PAYER: "This order is bound to a different address than the one connected (?as=0x..).",
  ORDER_EXPIRED: "This order expired before it was paid. Nothing was charged.",
  TERMINAL_REVOKED: "The terminal that admitted this order has since been revoked.",
};
export { REASON_TEXT };

// ---- pure blocker functions, unit-tested directly -----------------------------------------------

/** `config` is the object served by GET /local/config.json: {rpc, chainId, manifest, record}. */
export function wrongNetworkBlocker(config) {
  if (!config || !config.manifest) return false;
  const manifestChainId = config.manifest.chainId;
  if (manifestChainId === undefined || manifestChainId === null) return false;
  return Number(config.chainId) !== Number(manifestChainId);
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
 * Every reason this payer may not proceed, found rather than short-circuited on the first one — a
 * countertop screen that shows only one blocker at a time makes a payer fix it and then discover
 * the next (the same reasoning `canAuthorizePayment` itself documents).
 */
export function computeBlockers({ config, record, connectedAddress, now } = {}) {
  const reasons = [];
  if (wrongNetworkBlocker(config)) reasons.push("WRONG_NETWORK");
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

// ---- ABI encoding, by hand ------------------------------------------------------------------------
// Exactly the shapes `approve(address,uint256)` and `pay(bytes32)` need: static words only. Written
// from the ABI specification rather than imported, per this task's own instruction; the one piece
// reused is keccak-256 itself (see the file banner), because re-deriving Keccak-f[1600] here would
// not make this file more auditable, only longer.

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

/** The first 4 bytes of keccak256(signature) — a Solidity function selector, computed, not looked up. */
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
  if (!receipt) return "Fees: not yet known -- available once a receipt is authenticated.";
  const pct = (pips) => (Number(pips ?? 0) / 10000).toFixed(2) + "%";
  return `Fees: LP ${pct(receipt.lpFeePips)} . Protocol ${pct(receipt.protocolFeePips)} . UNICA ${pct(receipt.hookFeePips)}`;
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

/** The full text block the "Payment terms" panel renders, so its labels are independently testable. */
export function renderTermsText(record) {
  const m = record?.merchant ?? {};
  const o = record?.order ?? {};
  const lines = [];
  lines.push(TEST_MODE_LABEL);
  lines.push(NO_VALUE_LABEL);
  lines.push(`Merchant: ${m.name ?? "(unknown)"}`);
  lines.push(`Merchant address (full): ${m.address ?? "(unknown)"}`);
  if (m.identityToken || m.rendererVersion) {
    lines.push(`Identity art: token ${m.identityToken ?? "?"}, renderer ${m.rendererVersion ?? "?"} -- not proof of address ownership`);
  }
  lines.push(`You pay (max): ${formatAmount(o.inputAmount, o.inputSymbol)}`);
  lines.push(`Merchant receives (minimum): ${formatAmount(o.minimumOutput, o.outputSymbol)}`);
  lines.push(`Network: ${record?.manifest?.environment ?? "unknown"} (chainId ${record?.chainId ?? record?.manifest?.chainId ?? "?"})`);
  lines.push(`Expires in: ${formatCountdown(o.expiry)}`);
  lines.push(formatFeesLine(record?.evidence?.receipt));
  return lines.join("\n");
}

// ---- JSON-RPC, over fetch, to whatever endpoint the demo server names ----------------------------

async function rpcCall(rpcUrl, method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method} refused: ${body.error.message}`);
  return body.result;
}

async function pollReceipt(rpcUrl, hash, { intervalMs = 500, timeoutMs = 30000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

// ---- DOM wiring — never runs under `node --test`; document is undefined there --------------------

if (typeof document !== "undefined" && document.getElementById("checkout")) {
  main().catch((e) => {
    const wallet = document.getElementById("wallet");
    if (wallet) wallet.textContent = `Local demo server unreachable or misbehaving: ${e.message}`;
  });
}

async function main() {
  let res;
  try {
    res = await fetch("./../local/config.json");
  } catch {
    return; // no companion server reachable — the page stays exactly the static document it was
  }
  if (!res.ok) return; // 404: no companion server. Nothing here is required for the static site.
  const config = await res.json();
  const record = config.record;

  say("terms", record
    ? "Terms read from the local demo server's record."
    : "The local demo server is running, but no demo order has been recorded yet. Run: make anvil-demo");
  if (record) {
    show("order-terms");
    set("order-merchant-name", record.merchant?.name ?? "(unknown)");
    set("order-merchant-address", record.merchant?.address ?? "(unknown)");
    const m = record.merchant ?? {};
    set("order-identity-art", m.identityToken || m.rendererVersion
      ? `token ${m.identityToken ?? "?"}, renderer ${m.rendererVersion ?? "?"} -- not proof of address ownership`
      : "(none recorded)");
    set("order-input", formatAmount(record.order?.inputAmount, record.order?.inputSymbol));
    set("order-output", formatAmount(record.order?.minimumOutput, record.order?.outputSymbol));
    set("order-network", `${record.manifest?.environment ?? "unknown"} (chainId ${record.chainId ?? config.chainId})`);
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

  let connectedAddress = null;

  const renderBlockers = () => {
    const now = Math.floor(Date.now() / 1000);
    const { allowed, reasons } = computeBlockers({ config, record, connectedAddress, now });
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
    if (payBtn) payBtn.disabled = !allowed || !connectedAddress || Boolean(record?.settlement?.transactionHash);
    return { allowed, reasons };
  };

  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      say("wallet", "Reading unlocked accounts from the local chain...");
      try {
        await rpcCall(config.rpc, "eth_accounts", []);
        const asParam = new URLSearchParams(location.search).get("as");
        connectedAddress = asParam || record?.order?.payer || null;
        say("wallet", connectedAddress
          ? `Connected as ${connectedAddress}. This order's bound payer: ${record?.order?.payer ?? "(none)"}.`
          : "Connected, but this link names no order to read a bound payer from.");
        say("network", `chainId ${config.chainId} (${record?.manifest?.environment ?? "local"})`);
      } catch (e) {
        say("wallet", `Could not read accounts: ${e.message}`);
      }
      renderBlockers();
    });
  }

  const showEvidence = (verdict) => {
    show("evidence-output");
    set("evidence-decision", `Decision: ${verdict?.decision ?? "NONE"}${verdict?.reasonCodes?.length ? ` (${verdict.reasonCodes.join(", ")})` : ""}`);
    const pre = document.getElementById("evidence-json");
    if (pre) pre.textContent = JSON.stringify(verdict, null, 2);
  };

  const fetchEvidence = async (orderId) => {
    const evRes = await fetch(`./../local/evidence?order=${orderId}`);
    return evRes.json();
  };

  const checkAndRenderStatus = async (orderId, { txReceipt = null } = {}) => {
    const verdict = await fetchEvidence(orderId);
    showEvidence(verdict);
    const status = paymentStatus({ txReceipt, evidence: verdict });
    say("payment-status", statusText(status));
    return status;
  };

  // Already settled by the demo script: never re-send, only ever re-verify.
  if (record?.settlement?.transactionHash && record?.order?.id) {
    unhide(verifyAgainBtn);
    checkAndRenderStatus(record.order.id, { txReceipt: { status: record.settlement.status } }).catch(() => {});
  }

  if (verifyAgainBtn) {
    verifyAgainBtn.addEventListener("click", () => {
      if (record?.order?.id) checkAndRenderStatus(record.order.id).catch((e) => say("payment-status", `Could not re-verify: ${e.message}`));
    });
  }

  if (payBtn) {
    payBtn.addEventListener("click", async () => {
      const { allowed } = renderBlockers();
      if (!allowed || !connectedAddress || !record?.order?.id) return;
      payBtn.disabled = true;
      try {
        say("payment-status", statusText("SUBMITTED"));
        const executor = record.manifest?.contracts?.executor?.address;
        const asset = record.order.inputAsset;
        const approveData = encodeApproveCalldata(executor, record.order.inputAmount);
        await rpcCall(config.rpc, "eth_sendTransaction", [{ from: connectedAddress, to: asset, data: approveData }]);

        const payData = encodePayCalldata(record.order.id);
        const payHash = await rpcCall(config.rpc, "eth_sendTransaction", [{ from: connectedAddress, to: executor, data: payData }]);
        say("payment-status", `${statusText("PENDING")} (${payHash})`);

        const receipt = await pollReceipt(config.rpc, payHash);
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

function statusText(status) {
  switch (status) {
    case "PAID": return "Paid.";
    case "FAILED": return "Not settled. Nothing was charged.";
    case "PENDING": return "Waiting for network confirmation...";
    case "SUBMITTED": return "Submitted, waiting for a transaction hash...";
    case "UNKNOWN": return "Evidence unavailable -- status unknown.";
    default: return "Awaiting payer.";
  }
}

function say(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function show(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}
function unhide(el) {
  if (el) el.hidden = false;
}
