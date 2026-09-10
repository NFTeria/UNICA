/**
 * Progressive enhancement only. Small, local, auditable, and it holds no secret.
 *
 * Everything a page MEANS is already in the served HTML: its identity, its disclosures, its status
 * and its navigation. This file may add live reads later, through the adapter boundary. If it never
 * loads, nothing a reader needs disappears — which is why no disclosure is written from here.
 */
const q = new URLSearchParams(location.search);

/** Validates before it renders. An identifier that does not match is reported, never interpolated. */
export function readParam(name, pattern) {
  const values = q.getAll(name);
  if (values.length === 0) return { ok: false, reason: "missing" };
  if (values.length > 1) return { ok: false, reason: "duplicate" };
  if (!pattern.test(values[0])) return { ok: false, reason: "malformed" };
  return { ok: true, value: values[0] };
}

/** textContent, never innerHTML: a query value can never become markup on this page. */
function say(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const CHAIN = /^[0-9]{1,7}$/;

if (document.getElementById("receipt")) {
  const chain = readParam("chain", CHAIN);
  const tx = readParam("tx", HASH32);
  if (!chain.ok || !tx.ok) {
    const why = !chain.ok ? `chain id ${chain.reason}` : `transaction hash ${tx.reason}`;
    say("receipt", `No receipt can be shown: ${why}. An unrecognised link is never rendered as a settlement.`);
  } else {
    // Evidence is never taken from the URL. A record becomes confirmed only by presenting the full
    // proof to the validator, which no link can do.
    say("receipt", `Reading chain ${chain.value} for that transaction. Until the chain answers and every proof field matches, this record is not confirmed.`);
  }
}
if (document.getElementById("order-detail")) {
  const order = readParam("order", HASH32);
  say("order-detail", order.ok
    ? `Reading order ${order.value.slice(0, 10)}… from the chain.`
    : `No order in this link${order.reason === "missing" ? "" : ` (${order.reason})`}.`);
}
