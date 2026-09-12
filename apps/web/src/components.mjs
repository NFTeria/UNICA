/** Shared blocks. Defined once so a disclosure cannot drift between two routes. */
import { h, raw, esc, hex, evidenceBadge } from "./html.mjs";
import { SITE, V3, EXPERIMENT } from "./site.mjs";

/** A status banner. `kind` drives text and an icon glyph, never colour alone. */
export function banner(kind, title, body) {
  const mark = { info: "i", warn: "!", block: "✕", ok: "✓" }[kind] ?? "i";
  return raw(h`<div class="banner banner-${kind}" role="note">
  <p class="banner-t"><span class="mark" aria-hidden="true">${mark}</span> <strong>${title}</strong></p>
  <p>${body}</p></div>`);
}

/** A live region. Empty in the served HTML; script may fill it. Announced when it changes. */
export function statusRegion(id, initial = "") {
  return raw(h`<p class="status" id="${id}" role="status" aria-live="polite">${initial}</p>`);
}

export function addressRow(label, value, explorer) {
  const link = explorer
    ? h`<a href="${explorer}/address/${value}">${hex(value, label)}</a>`
    : hex(value, label);
  return raw(h`<tr><th scope="row">${label}</th><td>${raw(link)}</td></tr>`);
}

/** The V3 disclosures, verbatim in structure with the shipped page's claims. */
export function v3Disclosure() {
  return raw(h`<details class="fold">
  <summary>What the current settlement demo accepts</summary>
  <ul>
    <li>Native ETH in. The payer sends ETH and nothing else.</li>
    <li>One configured payout currency out, fixed per chain at deployment and not selectable.</li>
    <li>One approved pool shape. A pool of any other shape is refused where it is created.</li>
  </ul>
  <p class="sub">These are refusals enforced in the contracts, not interface restrictions.</p>
</details>`);
}

/** Every prerequisite the experimental route is missing, stated one by one. */
export const EXPERIMENT_BLOCKERS = [
  ["Hook not deployed", "No settlement hook exists on chain " + EXPERIMENT.chainId + "."],
  ["Executor not deployed", "No settlement executor exists on that chain."],
  ["Payout token unresolved", "No payout token's issuer or mint authority has been verified there."],
  [
    "No hook-enabled pool",
    "Every pool holding this input has hooks = the zero address, so a hook can enforce nothing on it.",
  ],
  [
    "Hosted CRE access under review",
    "Confidential Workflows access has been applied for and is not granted.",
  ],
  [
    "No confirmed settlement",
    "No transaction on that chain has ever satisfied the confirmed-evidence requirement.",
  ],
];

export function blockerList() {
  const items = EXPERIMENT_BLOCKERS.map(([t, d]) => h`<li><strong>${t}.</strong> ${d}</li>`);
  return raw(h`<ul class="blockers">${raw(items.join(""))}</ul>`);
}

/** A disabled action that says exactly why, rather than being merely greyed out. */
export function disabledAction(label, reasonId) {
  return raw(h`<p><button type="button" class="cta" disabled aria-describedby="${reasonId}">${label}</button></p>
<p class="sub" id="${reasonId}">Disabled: every prerequisite above is unmet. This control is not
wired to any chain and cannot become enabled by a link, a setting, or a wallet.</p>`);
}

export function evidenceKey() {
  return raw(h`<dl class="evidence-key">
  <dt>${evidenceBadge("mock")}</dt><dd>Fixture data. Nothing was executed.</dd>
  <dt>${evidenceBadge("simulated")}</dt><dd>Executed against a local chain or the CRE local simulator. Not a settlement.</dd>
  <dt>${evidenceBadge("confirmed")}</dt><dd>A confirmed transaction on a real chain, with matching contracts, a measured merchant balance increase and the settlement event in its own logs. No experimental record has ever met this.</dd>
</dl>`);
}

export function approvedClaim() {
  return raw(h`<p class="lead">${SITE.approvedClaim}</p>`);
}

export function v3PinsTable() {
  return raw(h`<table class="pins">
  <caption>The deployment this demo pays through</caption>
  <tbody>
    ${addressRow("Executor", V3.executor, V3.explorer)}
    ${addressRow("Hook", V3.hook, V3.explorer)}
    ${addressRow("PoolManager", V3.poolManager, V3.explorer)}
    ${addressRow("Payout currency", V3.payout, V3.explorer)}
    <tr><th scope="row">Chain</th><td>${V3.chainName} (${V3.chainId})</td></tr>
    <tr><th scope="row">Pool id</th><td>${hex(V3.poolId, "pool id")}</td></tr>
    <tr><th scope="row">Deploy block</th><td>${V3.deployBlock}</td></tr>
    <tr><th scope="row">Release</th><td>${V3.releaseTag} at ${V3.releaseCommit}</td></tr>
  </tbody></table>`);
}

/**
 * The one place a person may read the machinery, behind a disclosure they have to open.
 *
 * WHY A DISCLOSURE AND NOT A SEPARATE PAGE. The people who need these identifiers — an auditor, a
 * judge, the business owner arguing with their accountant — need them for THIS payment, next to
 * the amount they are checking. Putting them on another page means correlating by hand. Putting
 * them on the surface means a customer buying a haircut reads the words pool and executor. A
 * closed disclosure serves both: nothing machine-shaped is on screen until somebody asks for it.
 *
 * Every value is filled by script from what the network answered. The served HTML carries the
 * labels and an em dash, so a page with no script still says which facts exist and shows none of
 * them as zero.
 */
export function advancedVerification(idPrefix = "adv") {
  const row = (label, id) => h`<dt>${label}</dt><dd id="${idPrefix}-${id}" class="hex">—</dd>`;
  return raw(h`<details class="fold" data-advanced="true">
  <summary>Advanced verification</summary>
  <p class="sub">These identifiers are for checking this payment against the network. Nothing here
  changes what was paid.</p>
  <dl class="evidence-key">
    ${raw(row("Registry and release", "release"))}
    ${raw(row("Market id", "market"))}
    ${raw(row("Hook", "hook"))}
    ${raw(row("Executor", "executor"))}
    ${raw(row("Pool", "pool"))}
    ${raw(row("Oracle adapter", "adapter"))}
    ${raw(row("Feed id", "feed"))}
    ${raw(row("Name lineage", "ens"))}
    ${raw(row("Order hash", "order"))}
    ${raw(row("Transaction hash", "tx"))}
    ${raw(row("Verification reason codes", "reasons"))}
  </dl>
</details>`);
}

// ── the product vocabulary ───────────────────────────────────────────────────────────────────────
// Everything below is a block a screen may use. Each one is defined ONCE here and styled once in
// apps/web/assets/unica.css, so the admin, the register and the checkout cannot drift into three
// dialects of the same product. apps/web/DESIGN.md shows each of them rendered, and
// apps/web/tests/design.test.mjs fails if a class named in that document is not in the stylesheet.
//
// TWO RULES BIND EVERY ONE OF THEM, and they are in DESIGN.md for the next builder as well:
//   1. No machine word on the business or the join screens. A block that would show one takes a
//      label from its caller instead of inventing the word itself.
//   2. Nothing here fabricates a value. A block given no data renders an empty state that says so,
//      never a plausible row, a sample price or an example customer.

/** A titled block. The title is optional: some cards are a figure and a sentence. */
export function card(title, body, { id = null, actions = null } = {}) {
  return raw(h`<section class="card"${id ? raw(` id="${esc(id)}"`) : ""}>
  ${title ? raw(h`<h2>${title}</h2>`) : ""}
  ${body}
  ${actions ? raw(h`<p class="ctas">${actions}</p>`) : ""}
</section>`);
}

/** A row of figures. Each is a term and a value; a value nobody has read yet is an em dash. */
export function kpis(items) {
  const cells = items.map(
    ([term, value, id]) =>
      h`<div class="kpi"><dt>${term}</dt><dd${id ? raw(` id="${esc(id)}"`) : ""}>${value ?? "—"}</dd></div>`,
  );
  return raw(h`<dl class="kpis">${raw(cells.join(""))}</dl>`);
}

/**
 * The six states anything in this product can be in, and the words a business owner reads for each.
 * `unknown` is deliberately not a failure and not a success: a check that could not run says so.
 */
export const PILL_STATES = Object.freeze({
  verified: ["✓", "Verified"],
  pending: ["◐", "Waiting"],
  refused: ["✕", "Refused"],
  unknown: ["?", "Not known"],
  active: ["●", "Active"],
  revoked: ["○", "Switched off"],
});

/** A status pill. The mark and the word both carry the meaning; the colour never carries it alone. */
export function pill(status, label = null) {
  const [mark, word] = PILL_STATES[status] ?? PILL_STATES.unknown;
  const known = Object.prototype.hasOwnProperty.call(PILL_STATES, status);
  return raw(
    h`<span class="pill" data-status="${known ? status : "unknown"}"><span aria-hidden="true">${mark}</span> ${label ?? word}</span>`,
  );
}

/**
 * A table of records. `columns` are headings; each row is a list of cells already rendered. The
 * wrapper is what scrolls sideways on a phone, so the page itself never does.
 */
export function dataTable({ caption = null, columns = [], rows = [], id = null, empty = "Nothing has been read yet." }) {
  const head = columns.map((c) => h`<th scope="col">${c}</th>`).join("");
  const body = rows.length
    ? rows.map((cells) => h`<tr>${raw(cells.map((c) => h`<td>${c}</td>`).join(""))}</tr>`).join("")
    : h`<tr><td class="sub" colspan="${columns.length || 1}">${empty}</td></tr>`;
  return raw(h`<div class="table-wrap">
  <table class="dtable"${id ? raw(` id="${esc(id)}"`) : ""}>
    ${caption ? raw(h`<caption>${caption}</caption>`) : ""}
    <thead><tr>${raw(head)}</tr></thead>
    <tbody>${raw(body)}</tbody>
  </table>
</div>`);
}

/**
 * A button, in the four shapes this product has. `disabled` REQUIRES a reason: a control that is
 * greyed out without saying why is the single most common way a screen wastes somebody's afternoon,
 * and apps/web/tests/build.test.mjs fails a disabled control with no aria-describedby.
 */
export function button(label, { variant = "primary", id = null, href = null, disabled = false, reason = null, reasonId = null } = {}) {
  const cls =
    variant === "quiet" ? "cta cta-quiet" : variant === "danger" ? "cta cta-danger" : "cta";
  const rid = reasonId ?? (id ? `${id}-why` : null);
  if (href && !disabled) return raw(h`<a class="${cls}" href="${href}"${id ? raw(` id="${esc(id)}"`) : ""}>${label}</a>`);
  if (disabled && !reason && !reasonId) {
    throw new Error("a disabled button must be given a reason: say why, or do not disable it");
  }
  return raw(h`<button type="button" class="${cls}"${id ? raw(` id="${esc(id)}"`) : ""}${disabled ? raw(` disabled aria-describedby="${esc(rid)}"`) : ""}>${label}</button>${
    disabled && reason ? raw(h`
<p class="sub" id="${rid}">${reason}</p>`) : ""
  }`);
}

/** A labelled input with its help and its error. The error is empty and announced, never hidden. */
export function field({ id, label, type = "text", help = null, error = true, value = null, placeholder = null, inputmode = null, attrs = "" }) {
  return raw(h`<p class="formfield">
  <label for="${id}">${label}</label>
  <input class="field" id="${id}" type="${type}"${value !== null ? raw(` value="${esc(value)}"`) : ""}${
    placeholder ? raw(` placeholder="${esc(placeholder)}"`) : ""
  }${inputmode ? raw(` inputmode="${esc(inputmode)}"`) : ""} autocomplete="off" spellcheck="false"${
    help ? raw(` aria-describedby="${esc(id)}-help"`) : ""
  }${attrs ? raw(" " + attrs) : ""}>
  ${help ? raw(h`<span class="help" id="${id}-help">${help}</span>`) : ""}
  ${error ? raw(h`<span class="error" id="${id}-error" role="status" aria-live="polite"></span>`) : ""}
</p>`);
}

/** The same, for a choice. Options may be empty: a select filled by script starts with nothing. */
export function selectField({ id, label, options = [], help = null }) {
  const opts = options.map(([v, t]) => h`<option value="${v}">${t}</option>`).join("");
  return raw(h`<p class="formfield">
  <label for="${id}">${label}</label>
  <select class="field" id="${id}"${help ? raw(` aria-describedby="${esc(id)}-help"`) : ""}>${raw(opts)}</select>
  ${help ? raw(h`<span class="help" id="${id}-help">${help}</span>`) : ""}
</p>`);
}

/** What a list says when it holds nothing. It never says nothing, and it never shows a fake row. */
export function emptyState(title, body, action = null) {
  return raw(h`<div class="empty">
  <p class="empty-t">${title}</p>
  <p class="sub">${body}</p>
  ${action ? raw(h`<p class="ctas">${action}</p>`) : ""}
</div>`);
}

/**
 * A message that arrives after the page has loaded. It is a live region like `statusRegion`, and
 * empty in the served HTML — a toast with words already in it was written by a page, not by an event.
 */
export function toast(id) {
  return raw(h`<p class="toast" id="${id}" role="status" aria-live="polite" hidden></p>`);
}

/** One thing the business sells. Price and availability come from the caller; nothing is invented. */
export function productCard({ name, price = null, status = "active", id = null }) {
  return raw(h`<li class="product"${id ? raw(` id="${esc(id)}"`) : ""}>
  <span class="product-name">${name}</span>
  <span class="product-price">${price ?? "—"}</span>
  ${pill(status)}
</li>`);
}

export function productList(items = [], { id = "product-list" } = {}) {
  return raw(h`<ul class="product-list" id="${id}">${raw(items.map((i) => (typeof i === "object" && "__raw" in i ? i.__raw : String(i))).join(""))}</ul>`);
}

/** One payment in a list: what it was for, when, how much, and where it stands. */
export function orderRow({ reference, when = "—", amount = "—", status = "pending", href = null }) {
  const label = href ? h`<a href="${href}">${reference}</a>` : h`${reference}`;
  return raw(h`<li class="order-row">
  <span class="order-ref">${raw(label)}</span>
  <span class="order-when">${when}</span>
  <span class="order-amount">${amount}</span>
  ${pill(status)}
</li>`);
}

/**
 * The register's keypad. Ten digits, a double zero, a backspace and one full-width charge button,
 * over a display big enough to read at arm's length across a counter. Every key is a real button,
 * so the whole thing works from a keyboard and reads correctly to a screen reader.
 */
export function keypad({ id = "keypad", display = "amount-display", charge = "charge", chargeLabel = "Charge" } = {}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];
  const cells = keys
    .map((k) =>
      k === "⌫"
        ? h`<button type="button" class="key" data-key="backspace" aria-label="Delete the last digit">⌫</button>`
        : h`<button type="button" class="key" data-key="${k}">${k}</button>`,
    )
    .join("");
  return raw(h`<div class="register">
  <output class="amount-display" id="${display}" aria-live="polite">0.00</output>
  <div class="keypad" id="${id}">${raw(cells)}</div>
  <button type="button" class="cta charge" id="${charge}" disabled aria-describedby="${charge}-why">${chargeLabel}</button>
  <p class="sub" id="${charge}-why">Disabled until an amount above zero has been entered and this
  register knows which network it is on.</p>
</div>`);
}

/**
 * The customer's card. Business identity at the top, the lines being paid, one total, one choice of
 * what to pay with, one button, and a status line underneath it that is the only thing that ever
 * says a payment succeeded.
 */
export function checkoutCard({ lines = [], total = "—", id = "checkout" } = {}) {
  const rows = lines.length
    ? lines.map(([what, much]) => h`<div class="checkout-line"><span>${what}</span><span>${much}</span></div>`).join("")
    : h`<div class="checkout-line"><span class="sub">This payment has not been read yet.</span><span class="sub">—</span></div>`;
  return raw(h`<section class="checkout" id="${id}">
  <div class="checkout-head">
    <p class="checkout-business" id="${id}-business">This business</p>
    <p class="sub" id="${id}-payname">—</p>
  </div>
  <div class="checkout-lines">${raw(rows)}</div>
  <div class="checkout-total"><span>Total</span><span id="${id}-total">${total}</span></div>
  <div class="asset-choice">
    <label for="${id}-asset">Pay with</label>
    <select class="field" id="${id}-asset"></select>
  </div>
  <button type="button" class="cta charge" id="${id}-pay" disabled aria-describedby="${id}-why">Pay</button>
  <p class="sub" id="${id}-why">Disabled until this payment has been read and a wallet is connected
  on the right network.</p>
  <p class="checkout-status" id="${id}-status" role="status" aria-live="polite">Waiting.</p>
</section>`);
}

/** Where somebody is in the join flow. The state is on the element, never on the colour alone. */
export function stepper(steps = [], current = 0) {
  const items = steps.map((label, i) => {
    const state = i < current ? "done" : i === current ? "current" : "todo";
    const mark = state === "done" ? "✓" : String(i + 1);
    return h`<li data-state="${state}"${state === "current" ? raw(' aria-current="step"') : ""}><span class="step-mark" aria-hidden="true">${mark}</span> ${label}</li>`;
  });
  return raw(h`<ol class="stepper">${raw(items.join(""))}</ol>`);
}

/**
 * The wallet chip and the signed-in menu. They live here rather than in the shell so that there is
 * exactly one definition of each; `src/shell.mjs` places them and decides which menu item is current.
 */
export function walletChip(prefix) {
  return raw(h`<div class="wchip" id="wallet-chip" data-prefix="${prefix}">
    <span class="wchip-line" id="wallet-chip-text">Your wallet is your sign-in. No account, no password.</span>
  </div>`);
}

export function sidebarNav(prefix, current, items) {
  const list = items.map(([href, label]) => {
    const isCurrent = href === current;
    return h`<li><a href="${prefix}${href}"${isCurrent ? raw(' aria-current="page"') : ""}>${label}</a></li>`;
  });
  return raw(h`<nav class="sidebar" aria-label="Primary"><ul class="sidenav">${raw(list.join(""))}</ul></nav>`);
}
