/** Shared blocks. Defined once so a disclosure cannot drift between two routes. */
import { h, raw, hex, evidenceBadge } from "./html.mjs";
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
