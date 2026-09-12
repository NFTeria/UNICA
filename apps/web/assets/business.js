/**
 * The business dashboard (/business/, /business/payments/ and /business/payments/details/): what a
 * shop owner sees between customers.
 *
 * WHAT IT ANSWERS, IN THIS ORDER. Am I open? What will I be paid in? What can my customers pay
 * with right now? Which register is live? How much have I actually taken today? Everything else is
 * behind a link or a disclosure.
 *
 * IT READS; IT DOES NOT ASSUME. Every line comes from the companion server's view of the active
 * deployment or from the network itself. Nothing is remembered between visits and nothing is
 * defaulted to zero: a figure that could not be read says so, because an unread count and a real
 * zero look identical on a dashboard and mean opposite things to the person reading it.
 *
 * ONE ACTION CAN SPEND A CONFIRMATION: revoking a register. It goes through the same on-chain
 * sequence the join screen uses, from the same function, so "revoked" cannot mean two things.
 */
import {
  ASSET_STATUS,
  assetMenu,
  assetLabel,
  businessDisplayName,
  formatAmountFor,
  registerDisplayName,
  todaysPayments,
  validateEnvironment,
} from "./product.js";
import { fillAdvanced, loadConfig, say, shortId } from "./local.js";
import { listRegisters, registerStatusText, revokeRegisterOnChain } from "./local-join.js";
import { connectWallet, discoverProviders, rpcRequest } from "./wallet.js";
import { holdingsRows } from "./product.js";
import { encodeCall } from "./abi.js";

// ---- a read-only view of the chain, with no wallet and no ability to send -----------------------
// A dashboard should render for somebody who has not connected anything. This object exposes the
// two reads the chain helpers need and deliberately has no `send`, so no code path here can spend
// a confirmation the owner did not ask for.
export function readOnlySession(config, fetchImpl = globalThis.fetch) {
  const rpc = config?.rpc;
  return {
    address: null,
    chainId: Number(config?.chainId),
    call: (tx) => rpcRequest(rpc, "eth_call", [tx, "latest"], fetchImpl),
    request: (method, params = []) => rpcRequest(rpc, method, params, fetchImpl),
  };
}

/**
 * The clock a dashboard should count "today" by. A practice chain's own time can sit years away
 * from the browser's, so counting the day against the browser would report zero takings on a
 * network that has just processed a payment. The deployment's own recorded time wins when it has
 * one; the browser is the fallback, and the screen says which was used.
 */
export function dashboardClock(config, browserNow = Math.floor(Date.now() / 1000)) {
  const recorded = Number(config?.record?.now);
  if (Number.isFinite(recorded) && recorded > 0) return { seconds: recorded, source: "network" };
  return { seconds: browserNow, source: "browser" };
}

/** Every payment this business's record carries, in the shape `todaysPayments` counts. */
export function paymentsFromRecord(record) {
  if (!record?.order?.id) return [];
  return [
    {
      orderId: record.order.id,
      settledAt: Number(record.now ?? 0),
      amountOut: record.settlement?.outputDelivered ?? record.order?.minimumOutput ?? null,
      outputSymbol: record.order?.outputSymbol ?? null,
      inputSymbol: record.order?.inputSymbol ?? null,
      transactionHash: record.settlement?.transactionHash ?? null,
      evidence: record.evidence ?? null,
    },
  ];
}

// ---- DOM wiring; never runs under `node --test`, where there is no document --------------------

if (typeof document !== "undefined" && (document.getElementById("business-summary") || document.getElementById("payment-list") || document.getElementById("order-detail"))) {
  main().catch((e) => say("business-status", `This page could not finish loading: ${e.message}`));
}

async function main() {
  const config = await loadConfig();
  if (!config) {
    say("business-status", "The companion server is not answering, so this page is showing the product, not your business. Start it and reload.");
    say("orders", "Payments could not be read: the companion server is not answering.");
    say("order-detail", "This payment could not be read: the companion server is not answering.");
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
  const merchantLabel = String(record?.merchant?.name ?? "").split(".")[0];
  say("business-title", businessDisplayName(merchantLabel));
  say("business-payname", record?.merchant?.name ? `Customers pay ${record.merchant.name}` : "This business has no pay name yet.");
  say("ens-status", record?.merchant?.address
    ? `${record.merchant.name ?? "This name"} resolves to ${record.merchant.address}. Payments go there.`
    : "No pay name has been resolved on this setup yet.");

  renderAssets(config);
  await renderHoldings(config, readOnlySession(config), record?.merchant?.address ?? null);
  wireHoldingsConnect(config);
  renderToday(config, record);
  fillAdvanced(config, {
    order: record?.order?.id ?? null,
    tx: record?.settlement?.transactionHash ?? null,
    reasons: config.record?.evidence?.reasonCodes ?? null,
  });
  renderPaymentList(config, record);
  renderPaymentDetail(config, record);

  const registers = await renderRegisters(config, record);
  wireRevoke(config, record, registers);
}

// What the wallet holds: one network read per asset this deployment knows, for the payout wallet
// by default and for a connected wallet on request. A read that fails leaves that asset "not read
// yet" rather than showing zero, and the sentence under the list says how many assets were asked
// and that unknown assets are not shown. Nothing here sends anything.
async function renderHoldings(config, session, owner) {
  const list = document.getElementById("holdings-list");
  if (!list) return;
  const holdings = Array.isArray(config.holdings) ? config.holdings : [];
  if (!owner) {
    say("holdings-said", "No wallet to read yet: this business has no payout wallet on record. Connect a wallet to read that one.");
    return;
  }
  say("holdings-said", `Reading ${holdings.length} asset${holdings.length === 1 ? "" : "s"} for ${shortId(owner)}...`);
  const balances = {};
  for (const h of holdings) {
    try {
      const hex = await session.call({ to: h.address, data: encodeCall("balanceOf(address)", [owner]) });
      balances[String(h.address).toLowerCase()] = BigInt(hex).toString();
    } catch {
      // left unread: the row says "Not read yet" instead of a guessed zero
    }
  }
  const rows = holdingsRows(config, balances);
  list.innerHTML = "";
  for (const r of rows) {
    const li = document.createElement("li");
    const sym = document.createElement("span");
    sym.className = "sym";
    sym.textContent = r.symbol ?? "Unnamed asset";
    const amount = document.createElement("span");
    amount.className = "availability";
    amount.dataset.status = r.amount === null ? "unavailable" : "available";
    amount.textContent = r.text;
    const why = document.createElement("span");
    why.className = "why";
    why.textContent = r.why;
    li.append(sym, amount, why);
    list.appendChild(li);
  }
  const read = rows.filter((r) => r.amount !== null).length;
  say("holdings-said", `${rows.length} asset${rows.length === 1 ? "" : "s"} this app knows on this network, ${read} read for ${shortId(owner)}. An asset this app does not know is not shown.`);
}

function wireHoldingsConnect(config) {
  const button = document.getElementById("holdings-connect");
  if (!button) return;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      say("holdings-said", "Looking for a wallet in this browser...");
      const providers = await discoverProviders(window);
      const result = await connectWallet({ config, providers });
      if (result.blocked) {
        say("holdings-said", result.blocked);
        return;
      }
      await renderHoldings(config, result.session, result.session.address);
    } catch (e) {
      say("holdings-said", `Could not read that wallet: ${e.message}`);
    } finally {
      button.disabled = false;
    }
  });
}

// The payout asset's address, remembered between the two renderers so an amount can be shown at
// the precision the deployment answered with rather than as a raw count.
let payoutAddressForAmounts = null;

function renderAssets(config) {
  const menu = assetMenu(config);
  const payout = menu.find((a) => a.role === "payout") ?? null;
  say("payout-asset", payout?.symbol ? payout.symbol : "Not known yet");
  payoutAddressForAmounts = payout?.address ?? null;
  const list = document.getElementById("asset-list");
  const target = list ?? document.getElementById("pay-asset-list");
  if (target) {
    target.innerHTML = "";
    for (const asset of menu) {
      const li = document.createElement("li");
      const sym = document.createElement("span");
      sym.className = "sym";
      sym.textContent = assetLabel(asset);
      const badge = document.createElement("span");
      badge.className = "availability";
      badge.dataset.status = asset.status;
      badge.textContent = asset.text;
      const why = document.createElement("span");
      why.className = "why";
      why.textContent = asset.why;
      li.append(sym, badge, why);
      target.appendChild(li);
    }
  }
  const available = menu.filter((a) => a.status !== ASSET_STATUS.UNAVAILABLE).length;
  say("assets-said", `${menu.length} payment asset${menu.length === 1 ? "" : "s"} read, ${available} available right now.`);
}

function renderToday(config, record) {
  const clock = dashboardClock(config);
  const { verified, verifiedCount, unresolvedCount } = todaysPayments(paymentsFromRecord(record), clock.seconds);
  say("today-count", String(verifiedCount));
  say("today-line", clock.source === "network"
    ? "Today, counted by this network's own clock."
    : "Today, counted by this browser's clock; the network did not report one.");
  const list = document.getElementById("today-list");
  if (list) {
    list.innerHTML = "";
    for (const p of verified) {
      const li = document.createElement("li");
      li.textContent = `${formatAmountFor(p.amountOut, payoutAddressForAmounts, config)} — order ${shortId(p.orderId)}`;
      list.appendChild(li);
    }
  }
  say("today-unresolved", unresolvedCount === 0
    ? "Every payment recorded today has been verified."
    : `${unresolvedCount} payment${unresolvedCount === 1 ? " is" : "s are"} not verified and ${unresolvedCount === 1 ? "is" : "are"} not counted above.`);
}

function renderPaymentList(config, record) {
  const list = document.getElementById("payment-list");
  if (!list) return;
  const payments = paymentsFromRecord(record);
  list.innerHTML = "";
  for (const p of payments) {
    const li = document.createElement("li");
    const decision = p.evidence?.decision === "VERIFIED" ? "Paid (checked)" : p.evidence?.decision === "REFUSED" ? "Declined" : "Not confirmed yet";
    li.textContent = `${formatAmountFor(p.amountOut, payoutAddressForAmounts, config)} — ${decision} — order ${shortId(p.orderId)}`;
    const link = document.createElement("a");
    link.href = `../../receipt/?order=${p.orderId}${p.transactionHash ? `&tx=${p.transactionHash}` : ""}`;
    link.textContent = "Receipt";
    li.append(" ", link);
    list.appendChild(li);
  }
  say("orders", `${payments.length} payment${payments.length === 1 ? "" : "s"} read from this business's record.`);
}

function renderPaymentDetail(config, record) {
  const target = document.getElementById("order-detail");
  if (!target) return;
  const asked = new URLSearchParams(location.search).get("order");
  if (!asked) {
    say("order-detail", "No payment in this link. Open one from your receipts.");
    return;
  }
  if (!record?.order?.id || String(record.order.id).toLowerCase() !== asked.toLowerCase()) {
    say("order-detail", "This setup has no record of that payment. It may belong to another business or another network.");
    return;
  }
  const decision = record.evidence?.decision === "VERIFIED" ? "Paid (checked)" : record.evidence?.decision === "REFUSED" ? "Declined" : "Not confirmed yet";
  say("order-detail", `${record.order.inputAmount} ${record.order.inputSymbol ?? ""} in, at least ${record.order.minimumOutput} ${record.order.outputSymbol ?? ""} to you. ${decision}.`);
}

async function renderRegisters(config, record) {
  const list = document.getElementById("register-list");
  const terminalsNode = record?.merchant?.terminalsNode ?? config.manifest?.identity?.terminalsNode ?? null;
  const identity = config.identity ?? null;
  const statusKey = config.terminalStatusKey ?? "com.unica.terminal-status";
  say("active-register", registerDisplayName(record?.terminal?.name));
  if (!list) return [];
  if (!identity || !terminalsNode) {
    say("registers-said", "This setup does not name where registers live, so none can be read.");
    return [];
  }
  say("registers-said", "Reading your registers from the network...");
  try {
    const registers = await listRegisters(readOnlySession(config), identity, terminalsNode, statusKey);
    list.innerHTML = "";
    for (const r of registers) {
      const li = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = r.label;
      li.append(name, document.createTextNode(`: ${registerStatusText(r.status)}`));
      list.appendChild(li);
    }
    say("registers-said", registers.length === 0
      ? "No registers were found for this business."
      : `${registers.length} register${registers.length === 1 ? "" : "s"} read from the network.`);
    return registers;
  } catch (e) {
    say("registers-said", `The registers could not be read: ${e.message}`);
    return [];
  }
}

function wireRevoke(config, record, registers) {
  const button = document.getElementById("revoke-register");
  if (!button) return;
  const active = registers.filter((r) => String(r.status).toLowerCase() === "active");
  if (active.length === 0) {
    say("revoke-why", "No active register was read from the network, so there is nothing to revoke.");
    return;
  }
  const target = active.find((r) => r.label === registerDisplayName(record?.terminal?.name)) ?? active[0];
  button.disabled = false;
  say("revoke-why", `Revokes "${target.label}". It stops new sales from that register; sales it already started are unaffected. Your wallet will ask you to confirm each step.`);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      say("registers-said", "Looking for a wallet in this browser...");
      const providers = await discoverProviders(window);
      const result = await connectWallet({ config, providers });
      if (result.blocked) {
        say("registers-said", result.blocked);
        return;
      }
      await revokeRegisterOnChain({
        session: result.session,
        identity: config.identity,
        statusKey: config.terminalStatusKey ?? "com.unica.terminal-status",
        register: target,
        onStep: (_n, _total, sentence) => say("registers-said", sentence),
      });
      say("registers-said", `"${target.label}" is revoked. Reload to see the current registers.`);
    } catch (e) {
      say("registers-said", `Could not revoke that register: ${e.message} Steps that already confirmed still stand.`);
    } finally {
      button.disabled = false;
    }
  });
}
