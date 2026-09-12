/**
 * The route table. Data, not eighteen copied documents.
 *
 * Every element a parity row maps to carries `data-parity="<row id>"`, so the parity test asserts
 * the CONTROL exists rather than that some matching text does. Prose can drift into a page by
 * accident; an attribute cannot.
 *
 * IDENTIFIERS IN QUERY STRINGS, and why. A static host cannot serve `/receipt/0xabc…/`, because
 * that would need one file per hash. Identifiers therefore ride in validated query parameters —
 * `/receipt/?chain=11155111&tx=0x…` — which reload to the same state because the state is entirely
 * in the URL. The compromise is documented on the routes that use it.
 */
import { h, raw, hex, evidenceBadge } from "./html.mjs";
import { SITE, V3, EXPERIMENT } from "./site.mjs";
import * as C from "./components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

export const ROUTES = [
  {
    route: "",
    h1: "Accept payments. Receive the asset your business prefers.",
    title: "UNICA — accept payments, receive your own asset",
    description:
      "Take payments in the assets your customers already hold, receive the one your business asked for, and give every customer a receipt that can be checked independently.",
    ogTitle: "UNICA — accept payments, receive your own asset",
    ogDescription: "Customers pay with what they hold. You receive what you chose.",
    ogImage: "og-home.svg",
    body: h`
<p class="lead"${P("hero")}>Customers pay with what they hold. You receive the asset you chose, in
the same payment, at the wallet you named before the sale existed. Every payment ends in a receipt
your customer and your accountant can check for themselves.</p>
<p class="ctas">
  <a class="cta" href="join/">Add your business</a>
  <a class="cta cta-quiet" href="business/">Open my business</a>
  <a class="cta cta-quiet" href="pay/"${P("cta-pay")}>See a customer checkout</a>
  <a class="cta cta-quiet" href="receipt/"${P("cta-proof")}>View a receipt</a>
</p>
<nav aria-label="Sections"${P("anchor-rail")}><ul class="nav">
  <li><a href="#three">Three things it does</a></li>
  <li><a href="how-it-works/">How it works</a></li>
  <li><a href="supported-assets/">Payment assets</a></li>
  <li><a href="business/">My business</a></li>
  <li><a href="proof/">Verification</a></li>
</ul></nav>

<h2 id="three">Three things it does</h2>
<div class="modes">
  <section class="mode">
    <h3>You choose what you keep</h3>
    <p>Pick one payout asset. Every payment you accept arrives in it, whatever the customer spent,
    and it goes to the wallet you named when you added your business.</p>
  </section>
  <section class="mode">
    <h3>Customers pay with what they have</h3>
    <p>Your register shows only the assets that can actually be paid right now. An asset that
    cannot be handled at this moment says so instead of failing at the counter.</p>
  </section>
  <section class="mode">
    <h3>Every payment can be checked</h3>
    <p>A payment is marked paid only after it has been checked against the network. Until then the
    receipt says it is still being confirmed, and tells the customer not to pay twice.</p>
  </section>
</div>

<h2>What a payment looks like</h2>
<ol>
  <li>Your register creates the sale for an amount, and hands the customer a link or a square to scan.</li>
  <li>The customer sees the amount, the most they can be charged, and what you are guaranteed to receive.</li>
  <li>They confirm once in their own wallet. Either the whole payment happens, or nothing does.</li>
  <li>Both of you get the same receipt, and it can be checked again at any time.</li>
</ol>
<p><a href="how-it-works/">How it works, in more detail</a></p>

<h2>Before you take a real payment</h2>
${C.banner("warn", "This release runs on test networks only.", raw(`Every screen carries the
label at the top of this page. Nothing here moves real money, and no page will call a network a
public one unless the deployment it is reading says so.`))}
<p class="sub"${P("builton")}>Built on Uniswap v4 (payment settlement), ENSv2 (business identity)
and The Graph (receipt indexing). Named as technologies used, not as endorsements.</p>
<p class="sub"${P("footer")}>Release evidence and the latest indexed payment are different things,
and the <a href="proof/">verification page</a> keeps them apart.</p>`,
  },
  {
    route: "how-it-works",
    h1: "How it works",
    title: "How it works — UNICA",
    description:
      "Three layers: an identity that resolves before the order exists, a hook that enforces the order's terms inside the swap, and a receipt that can be rebuilt from chain data alone.",
    ogTitle: "How UNICA settles a payment",
    ogDescription: "Identity, enforcement, receipt.",
    ogImage: "og-docs.svg",
    body: h`
<section${P("how")}>
  <h2>Three layers</h2>
  <ol>
    <li><strong>Identity.</strong> A merchant name resolves to an address <em>before</em> the order
    exists. The address is then stored on chain. Settlement never re-reads a name, so a record
    changed afterwards cannot redirect an order that already exists.</li>
    <li><strong>Enforcement.</strong> The hook runs inside the swap. It refuses a partial fill and
    an output below the order's floor.</li>
    <li><strong>Receipt.</strong> The hook emits evidence; the executor emits the success signal
    only after measuring the merchant's own balance.</li>
  </ol>
</section>
<section${P("hook")}>
  <h2>What the hook does, in order</h2>
  <ol>
    <li>Refuses any pool that is not the approved shape, where the pool is created.</li>
    <li>Admits a swap only from the settlement executor, for an order being paid right now.</li>
    <li>After the swap, refuses a partial fill or an output below the minimum.</li>
    <li>Emits the receipt. That is evidence about the swap, not proof the merchant was paid.</li>
  </ol>
  <p>The final check is the executor's: it measures the merchant's own balance after the swap and
  refuses to finish if it did not rise by at least the committed minimum.</p>
</section>`,
  },
  {
    route: "supported-assets",
    h1: "Supported assets",
    title: "Supported assets — UNICA",
    description:
      "The current demo accepts native ETH and pays one configured currency. Both are enforced in the contracts, not in the interface.",
    ogTitle: "What UNICA accepts",
    ogDescription: "Native ETH in, one configured payout out.",
    ogImage: "og-docs.svg",
    body: h`
<section${P("accepts")}>
  <h2>Current settlement demo</h2>
  <p>Pay with native ETH. The merchant receives the configured payout currency.</p>
  ${C.v3Disclosure()}
</section>
<section>
  <h2>Robinhood testnet experiment <span class="tag">testnet experiment</span></h2>
  <p>The experiment models an ERC-20 input. Its input is a faucet-issued test token bearing the
  symbol ${EXPERIMENT.inputSymbol}; its payout is a local fixture named
  ${EXPERIMENT.payoutName} (${EXPERIMENT.payoutSymbol}).</p>
  <p><strong>Neither is a real asset.</strong> The input is a testnet faucet token and is not a
  share, a security, or anything anyone owns. The payout fixture is not a stablecoin and nothing
  backs it. See <a href="../experiments/robinhood/">the experiment</a>.</p>
</section>`,
  },
  {
    route: "networks",
    h1: "Networks",
    title: "Networks — UNICA",
    description:
      "One hook address across four testnets, and exactly one of them has ever processed a settlement.",
    ogTitle: "UNICA networks",
    ogDescription: "Four testnets, one settled.",
    ogImage: "og-docs.svg",
    body: h`
<section${P("chains")}>
  <h2>One hook address across four testnets</h2>
  <p>The hook and executor carry the same address on Ethereum Sepolia, Base Sepolia, Unichain
  Sepolia and Arbitrum Sepolia. <strong>Only ${V3.chainName} has processed a settlement.</strong></p>
  <p>Being deployed on four chains is availability of the same code at the same address. It is not a
  cross-chain payment, and no payment has ever crossed a chain.</p>
</section>
<section>
  <h2>Chain ${EXPERIMENT.chainId} <span class="tag">testnet experiment</span></h2>
  <p>${EXPERIMENT.chainName} is researched and probed. <strong>The current demo does not support it</strong>
  and no UNICA contract is deployed there.</p>
</section>`,
  },
  {
    route: "security",
    h1: "Security",
    title: "Security — UNICA",
    description:
      "What the contracts refuse, what has no administrative control, and what a scoped identity permission can and cannot do.",
    ogTitle: "UNICA security posture",
    ogDescription: "Immutable, ownerless, pause-less — and what that costs.",
    ogImage: "og-docs.svg",
    body: h`
<section>
  <h2>No owner, no pause, no proxy</h2>
  <p>Every chain-dependent parameter is fixed at construction and can never be written again. There
  is no owner, no pauser and no upgrade path. That is deliberate, and it has a cost worth stating:
  <strong>if a defect is found there is no recall.</strong> The only response is to stop directing
  payments to that deployment.</p>
</section>
<section${P("ens-perm")}>
  <h2>Scoped identity permission</h2>
  <p>A delegated agent is modelled to hold one text-record permission and no address permission.
  <strong>No agent currently holds a live role</strong>, and settlement does not depend on any
  record: the recipient is fixed before the order exists.</p>
  ${C.statusRegion("ens-roles", "Permission state is read from chain when script runs. Unread authority is not absent authority.")}
</section>`,
  },
  {
    route: "proof",
    h1: "Technical proof",
    title: "Proof — UNICA",
    description:
      "Pinned addresses, the release they belong to, and the checks anyone can re-run against the chain.",
    ogTitle: "UNICA proof",
    ogDescription: "Pins, releases and re-runnable checks.",
    ogImage: "og-docs.svg",
    body: h`
<section${P("inventory")}>
  <h2>What this demo pays through</h2>
  ${C.v3PinsTable()}
  <p class="sub"><span${P("pin-chainid")}>Chain ${V3.chainId}</span> ·
  <span${P("pin-hook")}>hook ${hex(V3.hook, "hook address")}</span> ·
  <span${P("pin-exec")}>executor ${hex(V3.executor, "executor address")}</span></p>
  <p class="sub"><span${P("pin-pool")}>pool id ${hex(V3.poolId, "pool id")}</span> ·
  <span${P("pin-tag")}>${V3.releaseTag}</span> · <span${P("pin-commit")}>${V3.releaseCommit}</span></p>
</section>
<section${P("readback")}>
  <h2>Read back from the chain</h2>
  <p>When script runs, every pinned value above is re-read and compared. A disagreement disables the
  payment rather than being reported quietly.</p>
  ${C.statusRegion("readback", "Not yet read. This page states its pins whether or not script runs.")}
</section>
<section${P("evidence")}>
  <h2>Evidence checklist</h2>
  <p>Each line is read, not asserted. Where a read fails the line says so instead of showing a zero.</p>
  ${C.statusRegion("evidence", "Chain and indexer have not been read yet.")}
</section>
<section${P("earlier")}>
  <details class="fold"><summary>Earlier generation</summary>
  <p>An earlier generation settled once before this one. It is named as prior evidence and is kept
  out of the current proof.</p></details>
</section>`,
  },
  {
    route: "status",
    h1: "Status",
    title: "Status — UNICA",
    description: "What is live, what is local-only, and what is waiting on access that has not been granted.",
    ogTitle: "UNICA status",
    ogDescription: "Live, local, and waiting.",
    ogImage: "og-docs.svg",
    body: h`
<table class="pins"><caption>Current state</caption><tbody>
  <tr><th scope="row">Current settlement demo</th><td>Live on ${V3.chainName}</td></tr>
  <tr><th scope="row">Robinhood experiment</th><td>Local only. Nothing deployed to chain ${EXPERIMENT.chainId}</td></tr>
  <tr><th scope="row">Hosted Confidential Workflows</th><td>Applied for, under review. Not granted</td></tr>
  <tr><th scope="row">CRE local simulator</th><td>Available and exercised locally</td></tr>
  <tr><th scope="row">Confirmed experimental settlement</th><td>None</td></tr>
</tbody></table>
${C.banner("info", "This page is static.", raw(`It states what was true when the artifact was built. Live values are read by script where a page says so.`))}`,
  },
  {
    route: "business",
    h1: "My business",
    title: "My business — UNICA",
    description:
      "The business dashboard: the payout asset, which customer assets can be paid right now, the active register, and the payments verified today.",
    ogTitle: "Your business on UNICA",
    ogDescription: "Payout asset, payment assets, register, today's takings.",
    ogImage: "og-merchant.svg",
    body: h`
<section class="card"${P("merchant-drawer")} id="business-summary">
  <p class="headline" id="business-title">Fresh Cuts</p>
  <p class="big" id="business-ready">Ready to accept payments</p>
  <p class="sub" id="business-payname">—</p>
  <p class="ctas">
    <a class="cta" href="payments/new/">Create payment</a>
    <a class="cta cta-quiet" href="payments/">Receipts</a>
    <a class="cta cta-quiet" href="../join/">Add another register</a>
  </p>
</section>
<dl class="kpis">
  <div class="kpi"><dt>You receive</dt><dd id="payout-asset">—</dd></div>
  <div class="kpi"><dt>Active register</dt><dd id="active-register">—</dd></div>
  <div class="kpi"><dt>Verified payments today</dt><dd id="today-count">—</dd></div>
</dl>
${C.statusRegion("business-status", "This page reads your business from the network when it runs.")}

<h2>Payment assets your customers can use</h2>
<p>Each asset says what it can do right now. An asset is only offered when this setup can actually
complete a payment in it; otherwise it says it is temporarily unavailable, rather than failing
after a customer has pressed pay.</p>
<ul id="asset-list" class="assets"></ul>
${C.statusRegion("assets-said", "Payment assets have not been read yet.")}

<h2>What your wallet holds</h2>
<p>Every asset this app knows on this network, with the amount your payout wallet holds right now,
read from the network when this page opens. Read a different wallet instead by connecting it. An
asset this app does not know is not shown, and no amount is ever guessed.</p>
<p><button type="button" id="holdings-connect">Read my connected wallet</button></p>
<ul id="holdings-list" class="assets"></ul>
${C.statusRegion("holdings-said", "Holdings have not been read yet.")}

<h2>Today</h2>
<p id="today-line">Today's verified payments are read from this business's own record.</p>
<ul id="today-list" class="registers"></ul>
<p class="sub" id="today-unresolved">A payment that has not been verified is never counted as taken.</p>

<h2>Registers</h2>
<p>A register is a place a sale can start. Revoking one stops new sales from it. Sales it already
started are unaffected.</p>
<ul id="register-list" class="registers"></ul>
${C.statusRegion("registers-said", "Registers have not been read yet.")}
<p><button type="button" class="cta cta-quiet" id="revoke-register" disabled aria-describedby="revoke-why">Revoke register</button></p>
<p class="sub" id="revoke-why">Disabled until a register has been read from the network and your
wallet is connected as the owner of this business.</p>

<section${P("ens-resolve")}>
  <h2>Your pay name</h2>
  <p>Customers pay a name, not an address. The name is resolved to your payout wallet before a sale
  exists, and the resolved wallet is shown for checking before anything is confirmed.</p>
  <p>Resolution fails closed. A name with no record resolves to nothing, never to an empty address
  that would quietly create a sale paying nobody.</p>
  ${C.statusRegion("ens-status", "The pay name has not been resolved yet.")}
</section>
${C.advancedVerification("adv")}
<script type="module" src="../assets/business.js"></script>`,
  },
  {
    route: "business/payments",
    h1: "Receipts",
    title: "Receipts — UNICA",
    description:
      "Every payment this business has taken, with the verification decision beside each one, read from the network rather than remembered.",
    ogTitle: "UNICA receipts",
    ogDescription: "Payments taken, and whether each was verified.",
    ogImage: "og-merchant.svg",
    body: h`
<p>Payments are read from the network when this page runs. It states the number it read, or says
the read failed. An unread count is never shown as zero.</p>
${C.statusRegion("orders", "Payments have not been read yet.")}
<ul id="payment-list" class="registers"></ul>
<p class="ctas">
  <a class="cta" href="new/">Create payment</a>
  <a class="cta cta-quiet" href="../">Back to my business</a>
</p>
<script type="module" src="../../assets/business.js"></script>`,
  },
  {
    route: "business/payments/new",
    h1: "Create payment",
    title: "Create payment — UNICA",
    description:
      "The register: enter an amount, choose the currency to invoice in, and hand the customer a link or a square to scan.",
    ogTitle: "Create a UNICA payment",
    ogDescription: "Enter an amount. Hand over a link. Wait for the check.",
    ogImage: "og-merchant.svg",
    body: h`
<section class="card"${P("create-order")} id="register">
  <h2>Amount</h2>
  <p><label for="amount">Amount to charge</label><br>
  <input id="amount" class="field" type="text" inputmode="decimal" autocomplete="off" placeholder="12.50" aria-describedby="amount-hint"></p>
  <p class="sub" id="amount-hint">Digits and one decimal point. This is what the customer owes.</p>
  <p><label for="currency">Invoice in</label><br>
  <select id="currency" class="field" aria-describedby="currency-hint"></select></p>
  <p class="sub" id="currency-hint">The currency the amount above is written in. You still receive
  your payout asset.</p>
  <p><button type="button" class="cta" id="create" disabled aria-describedby="create-why">Create payment</button></p>
  <p class="sub" id="create-why">Disabled until this register has read its settings and a wallet is
  connected on the right network.</p>
  ${C.statusRegion("create-status", "Nothing has been created yet.")}
</section>

<section id="handover" hidden>
  <h2>Hand this to the customer</h2>
  <div class="paylink">
    <input id="pay-link" class="field" type="text" readonly aria-label="Customer payment link">
    <button type="button" class="cta cta-quiet" id="copy-link">Copy link</button>
  </div>
  <div class="qr" id="qr" role="img" aria-label="Square the customer can scan to open this payment"></div>
  ${C.statusRegion("qr-said", "The square is drawn once the payment exists.")}
  <h3>Waiting for the customer</h3>
  ${C.statusRegion("payment-progress", "Waiting for the customer to pay.")}
  <p><button type="button" class="cta cta-quiet" id="check-again" hidden aria-describedby="check-again-why">Check again</button></p>
  <p class="sub" id="check-again-why">Re-checks this payment against the network. Nothing is sent.</p>
  <p class="ctas"><a class="cta cta-quiet" href="../../">Back to my business</a></p>
</section>
${C.advancedVerification("adv")}
<script type="module" src="../../../assets/cashier.js"></script>`,
  },
  {
    route: "business/payments/details",
    h1: "Payment details",
    title: "Payment details — UNICA",
    description:
      "One payment, addressed by its order number in the link, so the same link always reloads to the same payment.",
    ogTitle: "UNICA payment details",
    ogDescription: "One payment, reload-safe.",
    ogImage: "og-merchant.svg",
    body: h`
<p class="sub">This page takes an order number from the link, for example
<code>?order=0x…</code>. The state lives entirely in the link, so reloading or sharing it
reconstructs the same page. A static host cannot serve one file per order number, which is why it
is a query parameter rather than a path segment.</p>
${C.statusRegion("order-detail", "No payment in this link.")}
<p class="ctas">
  <a class="cta cta-quiet" href="../../../pay/">Open the customer's view</a>
  <a class="cta cta-quiet" href="../../../receipt/">Open the receipt</a>
</p>
<script type="module" src="../../../assets/business.js"></script>`,
  },
  {
    route: "pay",
    h1: "Checkout",
    title: "Checkout — UNICA",
    description:
      "The customer's view of a payment: the amount due, the most that can be charged, what the business is guaranteed to receive, and one confirmation.",
    ogTitle: "Pay with UNICA",
    ogDescription: "The business receives its asset, or nothing moves.",
    ogImage: "og-checkout.svg",
    body: h`
<section class="card"${P("demo")} id="checkout">
  <p class="headline" id="pay-business">This business</p>
  <p class="sub" id="pay-verified-name">—</p>
  <p class="big" id="pay-amount-due">—</p>
  <p class="sub">Amount due</p>
  ${C.statusRegion("terms", "This payment is read from the network when the page runs.")}
  <div id="order-terms" class="status" role="status" aria-live="polite" hidden>
    <dl class="evidence-key">
      <dt>Business</dt><dd id="order-merchant-name">—</dd>
      <dt>Pay name</dt><dd id="order-merchant-payname">—</dd>
      <dt>Register</dt><dd id="order-terminal">—</dd>
      <dt>Asset to spend</dt><dd id="order-input">—</dd>
      <dt>Most you can be charged</dt><dd id="order-max">—</dd>
      <dt>The business is guaranteed at least</dt><dd id="order-output">—</dd>
      <dt>Conversion</dt><dd id="order-route">—</dd>
      <dt>Fees</dt><dd id="order-fees">—</dd>
      <dt>Network</dt><dd id="order-network">—</dd>
      <dt>Expires</dt><dd id="order-expiry">—</dd>
    </dl>
    <details class="fold"><summary>Details</summary>
      <dl class="evidence-key">
        <dt>Where the money goes</dt><dd id="order-merchant-address">—</dd>
        <dt>Business badge</dt><dd id="order-identity-art">—</dd>
        <dt>Order number</dt><dd id="order-id">—</dd>
      </dl>
    </details>
  </div>
</section>
<section>
  <h2>Assets you can pay with right now</h2>
  <ul id="pay-asset-list" class="assets"></ul>
  ${C.statusRegion("pay-assets-said", "Payment assets have not been read yet.")}
</section>
<section${P("wallet")}>
  <h2>Your wallet</h2>
  ${C.statusRegion("wallet", "No wallet has been connected.")}
  <p><button type="button" class="cta" id="connect" disabled aria-describedby="connect-why">Connect a wallet</button></p>
  <p class="sub" id="connect-why">Disabled until this page has read its settings.</p>
</section>
<section${P("chain-switch")}>
  <h2>Network</h2>
  <p>This payment happens on the network the sale was created on. A wallet on another network is
  asked to switch; nothing is paid from the wrong network.</p>
  ${C.statusRegion("network", "The network has not been read.")}
</section>
<section${P("blockers")}>
  <h2>When this page disables everything</h2>
  <p>Each of these disables the payment and says so in one sentence rather than failing quietly:</p>
  <ul>
    <li>The network could not be read.</li>
    <li>A saved setting disagrees with the network.</li>
    <li>This amount cannot currently be converted safely.</li>
    <li>No wallet, or a wallet on the wrong network.</li>
    <li>The amount the business would receive is below what it was promised.</li>
  </ul>
  <ul id="active-blockers" class="status" role="status" aria-live="polite" hidden></ul>
</section>
<section${P("pay")}>
  <h2>Pay</h2>
  <p><button type="button" class="cta" id="pay" disabled aria-describedby="pay-why">Pay</button></p>
  <p class="sub" id="pay-why">Disabled until this payment is loaded, a wallet is connected on the
  right network, and every check above has passed.</p>
  <p${P("expired")}>An expired payment cannot be paid. The page says so and offers a new one.</p>
  <p${P("settled")}>A paid payment cannot be paid twice. The page offers a way to start another.</p>
  ${C.statusRegion("payment-status", "Waiting for the customer.")}
  <p><button type="button" class="cta cta-quiet" id="verify-again" hidden aria-describedby="verify-again-why">Check again</button></p>
  <p class="sub" id="verify-again-why">Re-checks this payment without sending anything.</p>
  <div id="evidence-output" hidden>
    <h3>Payment verification</h3>
    <p id="evidence-decision" class="sub"></p>
    <p><a href="../receipt/" id="receipt-link">Open the receipt</a></p>
  </div>
</section>
${C.advancedVerification("adv")}
<script type="module" src="../assets/local-pay.js"></script>`,
  },
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
  ${C.banner("info", "Practice mode, test money only.", raw(`Nothing on <span id="join-network">this network</span> has value. The steps are the real steps; the money is not real.`))}
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
  {
    route: "receipt",
    h1: "Receipt",
    title: "Receipt — UNICA",
    description:
      "One payment's receipt, addressed by network and transaction in the link, so the same link always rebuilds the same record.",
    ogTitle: "UNICA receipt",
    ogDescription: "Rebuildable from the network alone.",
    ogImage: "og-receipt.svg",
    body: h`
<p class="sub">This page takes <code>?chain=</code>, <code>?tx=</code> and <code>?order=</code> from
the link. The state is entirely in the link, so it reloads and shares correctly. A static host
cannot serve one file per transaction, which is why these are query parameters.</p>
<section class="card"${P("receipt")} id="receipt-card">
  <p class="headline" id="r-business">This business</p>
  <p class="big" id="r-amount">—</p>
  <p id="r-statement" class="sub">Nothing has been checked yet.</p>
  <dl class="receipt-lines">
    <dt>Paid amount</dt><dd id="r-paid">—</dd>
    <dt>Customer asset</dt><dd id="r-customer-asset">—</dd>
    <dt>Payout asset</dt><dd id="r-payout-asset">—</dd>
    <dt>Date and time</dt><dd id="r-when">—</dd>
    <dt>Order number</dt><dd id="r-order" class="hex">—</dd>
    <dt>Payment status</dt><dd id="r-status">—</dd>
    <dt>Verification status</dt><dd id="r-verification">—</dd>
    <dt>Transaction</dt><dd id="r-tx" class="hex">—</dd>
  </dl>
  <p class="ctas">
    <button type="button" class="cta cta-quiet" id="r-download" disabled aria-describedby="r-download-why">Download this receipt</button>
    <button type="button" class="cta cta-quiet" id="r-share" disabled aria-describedby="r-download-why">Share this receipt</button>
  </p>
  <p class="sub" id="r-download-why">Available once this receipt has been read from the network.</p>
  ${C.statusRegion("receipt", "No transaction in this link.")}
  ${C.evidenceKey()}
</section>
<section${P("graph")}>
  <h2>Indexed payments</h2>
  ${C.statusRegion("graph", "The index has not been read yet.")}
  <p${P("graph-fail")}>An index that cannot be reached and an index holding nothing are different
  answers, and this page never shows one as the other. A failed read says it failed.</p>
</section>
<section>
  <h2>Without the index</h2>
  <p>Every line above can be rebuilt from the transaction's own record and the network's own state.
  The index makes it faster; it is never the only route.</p>
</section>
${C.advancedVerification("adv")}
<script type="module" src="../assets/receipt.js"></script>`,
  },
  {
    route: "experiments/robinhood",
    h1: "Robinhood testnet experiment",
    experimental: true,
    title: "Robinhood testnet experiment — UNICA",
    description:
      "A local-only prototype settling a faucet-issued test token into a local payout fixture. Nothing is deployed, nothing has settled, and the live action is disabled.",
    ogTitle: "UNICA testnet experiment",
    ogDescription: "Local-only prototype. Nothing deployed, nothing settled.",
    ogImage: "og-experiment.svg",
    body: h`
${C.banner("warn", "This is a testnet experiment.", raw(`Nothing here is deployed to chain ${EXPERIMENT.chainId}, no payment has ever settled there, and the live action below is disabled. This is not an integration with, partnership with, or endorsement by any third party.`))}
<section>
  <h2>The subject</h2>
  <table class="pins"><tbody>
    <tr><th scope="row">Chain</th><td>${EXPERIMENT.chainName} (${EXPERIMENT.chainId})</td></tr>
    <tr><th scope="row">Input</th><td>${EXPERIMENT.inputSymbol}, a <strong>faucet-issued test token</strong>. Not a share, not a security, not owned by anyone. ${hex(EXPERIMENT.inputToken, "input token address")}</td></tr>
    <tr><th scope="row">Payout</th><td>${EXPERIMENT.payoutName} (${EXPERIMENT.payoutSymbol}), a <strong>local test fixture</strong>. Not a stablecoin, nothing backs it, and it exists only in local tests.</td></tr>
  </tbody></table>
</section>
<section>
  <h2>Architecture</h2>
  <p>Settlement would run through a <strong>dedicated hook-enabled pool</strong>. Existing pools
  holding this token carry no hook at all, so a hook can enforce nothing on them.</p>
  <p>Those existing pools are used only as a <strong>separate executable reference venue</strong>.
  Separate is not independent: a different pool is not independent market data, does not establish
  fair value, and is not manipulation-resistant. It is one policy input, never an authorization.</p>
  ${C.banner("warn", "Thin liquidity, size-dependent quotes.", raw("The reference venue is thin. A quote for a larger size is materially worse than one for a smaller size, so a quote must be read at the size actually being settled rather than extrapolated."))}
</section>
<section>
  <h2>Confidential orchestration</h2>
  <ul>
    <li>The CRE <strong>local simulator</strong> is available and has been exercised locally.</li>
    <li>Hosted Confidential Workflows access is <strong>applied for and under review</strong>. It is not granted.</li>
    <li><strong>The simulator is not a real TEE.</strong> Its own output says so.</li>
    <li><strong>Simulator logs are visible for debugging.</strong> In real execution they would not leave the enclave.</li>
    <li><strong>Never put a real secret in the simulator.</strong> Local runs use synthetic values only.</li>
    <li>There is <strong>no live CRE deployment</strong>, and no contract trusts a workflow result.</li>
  </ul>
</section>
<section>
  <h2>Why the live action is disabled</h2>
  ${C.blockerList()}
  ${C.disabledAction("Settle on chain " + EXPERIMENT.chainId, "exp-why")}
</section>
<section>
  <h2>What may be shown here</h2>
  ${C.evidenceKey()}
  ${C.statusRegion("exp-demo", "Mock and simulated demonstrations run only when script is available. Neither is a settlement.")}
</section>`,
  },
  {
    route: "support",
    h1: "Support",
    title: "Support — UNICA",
    description:
      "Where to read the source, how to verify a settlement yourself, and how to report a problem.",
    ogTitle: "UNICA support",
    ogDescription: "Source, verification and reporting.",
    ogImage: "og-docs.svg",
    body: h`
<ul>
  <li><a href="${SITE.repo}">Source and proofs</a> — every contract, script and check.</li>
  <li>Verify a settlement yourself from the transaction's own logs; the indexer is a convenience.</li>
  <li>Security reports: see SECURITY.md in the repository. Do not open a public issue for anything
  exploitable.</li>
</ul>`,
  },
  {
    route: "legal/terms",
    h1: "Terms",
    title: "Terms — UNICA",
    description: "Testnet software provided as is, with no service, no custody and no warranty.",
    ogTitle: "UNICA terms",
    ogDescription: "Testnet software, as is.",
    ogImage: "og-docs.svg",
    body: h`<p>This is testnet software provided as is, without warranty. It is not a financial service and
not a product. Nothing here custodies anyone's assets: the contracts hold no balance after a
settlement, and take no fee.</p>`,
  },
  {
    route: "legal/privacy",
    h1: "Privacy",
    title: "Privacy — UNICA",
    description: "No accounts, no analytics, no cookies, no server. What the browser sends, and to whom.",
    ogTitle: "UNICA privacy",
    ogDescription: "No accounts, no analytics, no server.",
    ogImage: "og-docs.svg",
    body: h`<p>There is no account system, no analytics, no cookie and no server operated by this project.
The page is static files. When script runs it may contact a public blockchain endpoint and a public
index; those third parties see the request as any web request. Nothing is stored about a visitor.</p>`,
  },
  {
    route: "legal/risks",
    h1: "Risks",
    title: "Risks — UNICA",
    description:
      "Immutable contracts cannot be recalled, testnet assets are worthless, and an experiment is not a product.",
    ogTitle: "UNICA risks",
    ogDescription: "What can go wrong and cannot be undone.",
    ogImage: "og-docs.svg",
    body: h`
<ul>
  <li><strong>No recall.</strong> The contracts have no owner and no pause. A defect cannot be
  patched in place; the only response is to stop using that deployment.</li>
  <li><strong>Not audited.</strong> No external audit has been performed.</li>
  <li><strong>Testnet assets have no value.</strong> Faucet tokens are not shares or securities.</li>
  <li><strong>An experiment is not a product.</strong> The experimental route has never settled.</li>
  <li><strong>Liquidity is not guaranteed</strong> by anyone, and a thin market moves on small size.</li>
</ul>`,
  },
];

export const NOT_FOUND = {
  route: "404",
  h1: "Page not found",
  title: "Not found — UNICA",
  description:
    "That address does not exist on this site. This page never turns an unrecognised link into a receipt or a payment.",
  ogTitle: "Not found — UNICA",
  ogDescription: "That address does not exist on this site.",
  ogImage: "og-docs.svg",
  body: h`
<p>That address does not exist on this site.</p>
${C.banner("info", "An unknown link is never a receipt.", raw("This page will not turn an unrecognised URL into a payment or a settlement record. If you followed a receipt link, check the transaction hash in it."))}
<p><a href="./">Go to the home page</a> · <a href="./receipt/">Open a receipt</a> ·
<a href="./pay/">Make a payment</a></p>`,
};
