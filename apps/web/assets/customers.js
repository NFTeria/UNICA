/**
 * Who has paid this business.
 *
 * THERE IS NO CUSTOMER RECORD, AND THAT IS THE DESIGN. This product never asks for a name, an
 * email address or a telephone number, so it has none to show. A customer here is a wallet that has
 * actually paid, worked out from the payments the chain recorded for the payout wallet — nobody
 * appears because a page remembered them, and nobody can be added by hand.
 *
 * WHAT IS COUNTED IS WHAT WAS CHECKED. A payment counts towards somebody's total only when its
 * verification decision is VERIFIED; the rest are counted separately and said out loud, because a
 * total that quietly includes an unverified payment is a total that overstates the takings.
 *
 * A TOTAL IS PER ASSET, NEVER SUMMED ACROSS THEM. Two assets are two numbers. Adding them would be
 * arithmetic on unlike things, and the answer would be wrong in a way nobody could see.
 *
 * COVER IS READ, NOT INFERRED. For a recurring product, how far a customer has paid through comes
 * from the catalogue's own `paidThrough`, one read per customer per recurring product. A read that
 * fails leaves that cell unread rather than showing a date nobody checked.
 */
import { fetchCatalog, fetchPayments, noSignupLine, openAdmin, readOnlySession, whenText } from "./business.js";
import { encodeCall, decodeUint } from "./abi.js";
import { say, shortId } from "./local.js";
import { formatAmountFor } from "./product.js";

/**
 * One line per wallet that has paid: how many times, how much of each asset, and when they last
 * did. Only VERIFIED payments reach a total; every payment reaches the count of visits, with the
 * unchecked ones counted apart so the screen can say how many they are.
 */
export function customersFrom(payments) {
  const list = Array.isArray(payments) ? payments : [];
  const byPayer = new Map();
  for (const p of list) {
    const payer = String(p?.payer ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(payer)) continue;
    const row = byPayer.get(payer) ?? { payer: String(p.payer), payments: 0, verified: 0, unchecked: 0, totals: new Map(), lastAt: 0 };
    row.payments += 1;
    if (String(p?.decision ?? "").toUpperCase() === "VERIFIED") {
      row.verified += 1;
      const asset = String(p?.asset ?? "").toLowerCase();
      row.totals.set(asset, (row.totals.get(asset) ?? 0n) + BigInt(p?.amount ?? 0));
    } else {
      row.unchecked += 1;
    }
    const at = Number(p?.settledAt ?? 0);
    if (Number.isFinite(at) && at > row.lastAt) row.lastAt = at;
    byPayer.set(payer, row);
  }
  return [...byPayer.values()]
    .map((row) => ({ ...row, totals: [...row.totals].map(([asset, units]) => ({ asset, units: units.toString() })) }))
    .sort((a, b) => b.lastAt - a.lastAt || b.payments - a.payments);
}

/** How far a customer's cover runs, from the date the catalogue answered with. Never inferred. */
export function coverText(paidThroughSeconds, nowSeconds) {
  const at = Number(paidThroughSeconds ?? 0);
  if (!Number.isFinite(at) || at <= 0) return "Not subscribed";
  return at > Number(nowSeconds) ? `Paid to ${whenText(at, null)}` : `Ran out ${whenText(at, null)}`;
}

// ---- DOM wiring; never runs under `node --test`, where there is no document -----------------------

if (typeof document !== "undefined" && document.getElementById("customer-rows")) {
  main().catch((e) => say("customers-said", `This page could not finish loading: ${e.message}`));
}

async function main() {
  const open = await openAdmin("../../");
  if (!open) return;
  const { config, session, business, wallet } = open;
  // A network with no business sign-up still has payments for this wallet; the reason it has no
  // business rides on the same sentence as the count, rather than on a line of its own.
  const reason = noSignupLine(business);
  const withReason = (sentence) => (reason ? `${sentence} ${reason}` : sentence);

  say("customers-said", "Reading your payments…");
  const answered = await fetchPayments(wallet);
  if (!answered) {
    say("customers-said", withReason("Your payments could not be read just now. Nobody is listed rather than a partial list."));
    return;
  }
  const rows = customersFrom(answered.payments);
  const now = Math.floor(Date.now() / 1000);
  const cover = await readCover(config, session.address, rows, now);

  const body = document.getElementById("customer-rows");
  body.replaceChildren();
  for (const row of rows) body.appendChild(rowElement(row, config, cover, now));
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "sub";
    td.colSpan = 5;
    td.textContent = "Nobody has paid you yet.";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  const unchecked = rows.reduce((n, r) => n + r.unchecked, 0);
  say("customers-said", withReason(`${rows.length} customer${rows.length === 1 ? "" : "s"} from ${answered.payments.length} payment${answered.payments.length === 1 ? "" : "s"}.${unchecked ? ` ${unchecked} payment${unchecked === 1 ? " is" : "s are"} not checked and ${unchecked === 1 ? "is" : "are"} not in a total.` : ""}`));
}

/** Cover per customer, for every recurring product this seller lists. One read each; never a guess. */
async function readCover(config, seller, rows, now) {
  const catalog = config.contracts?.productCatalog ?? null;
  const cover = new Map();
  if (!catalog || rows.length === 0) return cover;
  const answered = await fetchCatalog({ seller });
  const recurring = (answered?.products ?? []).filter((p) => p.kind === "recurring");
  if (recurring.length === 0) return cover;
  const session = readOnlySession(config);
  for (const row of rows) {
    const lines = [];
    for (const product of recurring) {
      try {
        const at = Number(decodeUint(await session.call({ to: catalog, data: encodeCall("paidThrough(uint256,address)", [product.id, row.payer]) })) ?? 0n);
        if (at > 0) lines.push(`${product.name}: ${coverText(at, now)}`);
      } catch {
        lines.push(`${product.name}: not read`);
      }
    }
    if (lines.length) cover.set(row.payer.toLowerCase(), lines.join(" · "));
  }
  return cover;
}

function rowElement(row, config, cover, now) {
  const tr = document.createElement("tr");
  const cell = (text, className) => {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  };
  tr.append(cell(shortId(row.payer), "adm-who"));
  tr.append(cell(String(row.payments), "adm-num"));
  tr.append(cell(row.totals.length ? row.totals.map((t) => formatAmountFor(t.units, t.asset, config)).join(" · ") : "Nothing checked yet", "adm-num"));
  tr.append(cell(whenText(row.lastAt, now)));
  tr.append(cell(cover.get(row.payer.toLowerCase()) ?? "—", "sub"));
  return tr;
}
