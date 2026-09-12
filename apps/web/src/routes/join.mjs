import { h, raw, hex, evidenceBadge } from "../html.mjs";
import { SITE, V3, EXPERIMENT } from "../site.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

export const JOIN = [
  {
    route: "join",
    h1: "Add your business",
    title: "Add your business — UNICA",
    description:
      "Set your business up from your own wallet: a pay name, the wallet that gets paid, the asset you want to receive, the assets you accept, and your first register.",
    ogTitle: "Add your business to UNICA",
    ogDescription: "One wallet confirmation sets up a pay name, a payout and a first register.",
    ogImage: "og-merchant.svg",
    body: h`
<section id="join">
  <p class="lead">Answer seven questions and press one button. Your wallet asks you to confirm once.
  When it is done you have a pay name, a wallet that gets paid, a first register and a business
  badge.</p>
  ${C.banner("info", "Testnet. No real money..", raw(`Nothing on <span id="join-network">this network</span> has value. The steps are the real steps; the money is not real.`))}
  <ol class="steps" id="form">
    <li>
      <h2>Connect your wallet</h2>
      <p>The wallet you connect becomes the owner of the business. Only it can add or revoke registers.</p>
      ${C.statusRegion("wallet", "No wallet has been connected.")}
      <p><button type="button" class="cta" id="connect" disabled aria-describedby="connect-why">Connect wallet</button></p>
      <p class="sub" id="connect-why">Disabled until this page has read its settings. Without a
      companion server this page stays a description of the steps.</p>
    </li>
    <li>
      <h2>Business name</h2>
      <p><label for="business-name">Business name</label><br>
      <input id="business-name" class="field" type="text" autocomplete="organization" spellcheck="false" inputmode="text" maxlength="32" placeholder="freshcuts" aria-describedby="name-check"></p>
      ${C.statusRegion("name-check", "Type the name customers will pay. Lowercase letters, numbers and hyphens.")}
    </li>
    <li>
      <h2>Payout wallet</h2>
      <p>By default, payments go to the wallet you connected.</p>
      <p><label><input type="checkbox" id="payout-other"> Pay a different wallet</label></p>
      <p><label for="payout-address">Payout wallet</label><br>
      <input id="payout-address" class="field" type="text" spellcheck="false" placeholder="0x…" disabled aria-describedby="payout-hint"></p>
      <p class="sub" id="payout-hint">Only when a different wallet should receive the money. It cannot be changed from this page afterwards.</p>
    </li>
    <li>
      <h2>Preferred payout asset</h2>
      <p><label for="payout-asset">The asset you want to receive</label><br>
      <select id="payout-asset" class="field" aria-describedby="payout-asset-hint"></select></p>
      <p class="sub" id="payout-asset-hint">Every payment you accept arrives in this asset.</p>
    </li>
    <li>
      <h2>Customer assets to accept</h2>
      <p>Choose the assets your customers may pay with. An asset that cannot be handled right now is
      shown but cannot be chosen, and says why.</p>
      <ul id="accept-list" class="assets"></ul>
      ${C.statusRegion("accept-said", "Payment assets are read once this page has its settings.")}
    </li>
    <li>
      <h2>Name your first register</h2>
      <p><label for="register-name">First register</label><br>
      <input id="register-name" class="field" type="text" value="Register 1" maxlength="40" aria-describedby="register-hint"></p>
      ${C.statusRegion("register-hint", "Saved as register-1.")}
    </li>
    <li>
      <h2>Transaction limit, if you want one</h2>
      <p><label for="tx-limit">Most a single payment may be (optional)</label><br>
      <input id="tx-limit" class="field" type="text" inputmode="decimal" placeholder="leave empty for no limit" aria-describedby="limit-hint"></p>
      ${C.statusRegion("limit-hint", "Leave it empty and any amount may be charged.")}
    </li>
  </ol>
  <h2>Confirm</h2>
  <dl class="evidence-key" id="confirm-summary">
    <dt>Business</dt><dd id="confirm-name">—</dd>
    <dt>Pay name</dt><dd id="confirm-payname">—</dd>
    <dt>Payout wallet</dt><dd id="confirm-payout">—</dd>
    <dt>You receive</dt><dd id="confirm-asset">—</dd>
    <dt>Accepting</dt><dd id="confirm-accepts">—</dd>
    <dt>First register</dt><dd id="confirm-register">—</dd>
    <dt>Transaction limit</dt><dd id="confirm-limit">—</dd>
  </dl>
  <p><button type="button" class="cta" id="join-submit" disabled aria-describedby="join-why">Add my business</button></p>
  <p class="sub" id="join-why">Connect a wallet first. It becomes the owner of the business.</p>
  ${C.statusRegion("join-status", "Nothing has been sent.")}
  <p class="sub" id="preferences-note">Your payout asset, the assets you accept and any transaction
  limit are settings this browser keeps for your register. The one confirmation your wallet asks
  for creates the business, the pay name, the payout wallet and the first register.</p>

  <div id="success" hidden>
    <h2>Your business is set up</h2>
    <dl class="evidence-key">
      <dt>Business</dt><dd id="done-business">—</dd>
      <dt>Pay name</dt><dd id="done-payname">—</dd>
      <dt>First register</dt><dd id="done-register">—</dd>
      <dt>Network</dt><dd id="done-network">—</dd>
    </dl>
    <p><img id="badge-image" class="badge-image" alt="" hidden></p>
    ${C.statusRegion("badge-said", "Reading your badge...")}
    <p class="ctas">
      <a class="cta" href="../business/">Open my business</a>
      <a class="cta cta-quiet" href="../business/payments/new/">Create payment</a>
      <a class="cta cta-quiet" href="#registers">Registers</a>
    </p>
    <details class="fold"><summary>Details</summary>
      <p>Business id: <span id="done-id" class="hex" translate="no">—</span>
      <button type="button" class="cta cta-quiet" id="copy-id">Copy the full id</button>
      <span id="copy-said" class="sub"></span></p>
    </details>

    <h2 id="registers">Registers</h2>
    <p>Each register is a place a sale can start. Revoking one stops new sales from it; sales it
    already started are unaffected.</p>
    <ul id="register-list" class="registers"></ul>
    ${C.statusRegion("registers-said", "Registers are read after your business is set up.")}
    <h3>Add a register</h3>
    <p><label for="new-register-name">Register name</label><br>
    <input id="new-register-name" class="field" type="text" placeholder="Front counter" maxlength="40"></p>
    <details class="fold"><summary>Advanced: who runs it</summary>
      <p><label for="new-register-operator">Operator address (leave empty to use this wallet)</label><br>
      <input id="new-register-operator" class="field" type="text" spellcheck="false" placeholder="0x…"></p>
    </details>
    <p><button type="button" class="cta" id="add-register">Add register</button></p>
    <p class="sub">Adding a register takes three wallet confirmations: create it, allow the operator, switch it on.</p>
  </div>
</section>
<script type="module" src="../assets/local-join.js"></script>`,
  },
];
