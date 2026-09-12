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
    h1: "Pay with UNICA",
    title: "UNICA — settlement on a Uniswap v4 hook",
    description:
      "A payment that settles through a Uniswap v4 hook: the merchant's recipient is fixed before payment, and the hook refuses anything that does not meet the order's terms.",
    ogTitle: "UNICA — settlement on a Uniswap v4 hook",
    ogDescription: "The merchant is paid in their chosen currency, or the payment reverts.",
    ogImage: "og-home.svg",
    body: h`
${C.approvedClaim()}
<p${P("hero")}>A payer sends one asset. The merchant receives another, at an address fixed before the
payment exists. A Uniswap v4 hook is the boundary that decides whether the swap counts as a
settlement at all.</p>
<p class="ctas">
  <a class="cta" href="pay/"${P("cta-pay")}>Try the payment</a>
  <a class="cta cta-quiet" href="receipt/"${P("cta-proof")}>View a receipt</a>
</p>
<p class="sub">Testnet only. One confirmation, or a full revert — there is no partial settlement.</p>
<nav aria-label="Sections"${P("anchor-rail")}><ul class="nav">
  <li><a href="how-it-works/">How it works</a></li>
  <li><a href="supported-assets/">Supported assets</a></li>
  <li><a href="pay/">Make a payment</a></li>
  <li><a href="receipt/">Live receipt</a></li>
  <li><a href="proof/">Technical proof</a></li>
</ul></nav>

<h2>Two modes, kept apart</h2>
<div class="modes">
  <section class="mode">
    <h3>Current settlement demo</h3>
    <p>The verified path. Native ETH in, one configured payout currency out, on ${V3.chainName}.
    This is the only mode that has ever settled.</p>
    <p><a href="pay/">Open the payment</a></p>
  </section>
  <section class="mode mode-exp">
    <h3>Robinhood testnet experiment <span class="tag">testnet experiment</span></h3>
    <p>A separate, local-only prototype on chain ${EXPERIMENT.chainId}. Nothing is deployed there and
    no payment has ever settled there. Its live action is disabled.</p>
    <p><a href="experiments/robinhood/">Open the experiment</a></p>
  </section>
</div>
<p class="sub"${P("builton")}>Built on Uniswap v4 (settlement), ENSv2 (merchant identity) and
The Graph (receipt indexing). Named as technologies used, not as endorsements.</p>
<p class="sub"${P("footer")}>Release evidence and the latest indexed settlement are different
things, and the <a href="proof/">proof page</a> keeps them apart.</p>`,
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
    route: "merchant",
    h1: "Merchant",
    title: "Merchant — UNICA",
    description:
      "Resolve a merchant identity and register an order whose recipient is fixed before any payment exists.",
    ogTitle: "UNICA for merchants",
    ogDescription: "Register an order; the recipient is fixed before payment.",
    ogImage: "og-merchant.svg",
    body: h`
<section${P("merchant-drawer")} id="merchant-mode">
  <h2>Merchant mode</h2>
  <p>Register an order. The recipient is resolved once, now, and then stored on chain.</p>
  <p><a class="cta" href="payments/new/">Create a payment</a>
     <a class="cta cta-quiet" href="payments/">See payments</a></p>
</section>
<section${P("ens-resolve")}>
  <h2>Merchant identity</h2>
  <p>A merchant name is resolved to an address <strong>before</strong> the order is created, and the
  resolved address is shown for checking before anything is signed.</p>
  <p>Resolution fails closed. An unset record resolves to nothing — never to the zero address, which
  would pass a truthiness check and create an order paying nobody.</p>
  ${C.statusRegion("ens-status", "Enter a name and resolve it when script is available.")}
</section>`,
  },
  {
    route: "merchant/payments",
    h1: "Payments",
    title: "Payments — UNICA",
    description: "Orders registered by this merchant, read from the chain.",
    ogTitle: "UNICA payments",
    ogDescription: "Orders and their state.",
    ogImage: "og-merchant.svg",
    body: h`
<p>Orders are read from the chain when script runs. This page states the count it read, or says the
read failed — an unread count is never rendered as zero.</p>
${C.statusRegion("orders", "Orders have not been read yet.")}
<p><a href="new/">Create a payment</a></p>`,
  },
  {
    route: "merchant/payments/new",
    h1: "Create a payment",
    title: "Create a payment — UNICA",
    description:
      "Register an order: recipient, amount and deadline are fixed at creation and cannot change afterwards.",
    ogTitle: "Create a UNICA payment",
    ogDescription: "Fixed at creation, enforced on chain.",
    ogImage: "og-merchant.svg",
    body: h`
<section${P("create-order")}>
  <h2>What gets fixed</h2>
  <ul>
    <li>The recipient address, resolved before this order exists.</li>
    <li>The exact input, ${V3.amountIn} ETH.</li>
    <li>The minimum the merchant must actually receive.</li>
    <li>The deadline, after which the order can no longer be paid.</li>
  </ul>
  <p>None of these can be altered by whoever pays. A payer chooses only whether to pay.</p>
  ${C.statusRegion("create-status", "Connect a wallet to register an order.")}
  <p><button type="button" class="cta" id="create" disabled aria-describedby="create-why">Register an order</button></p>
  <p class="sub" id="create-why">Disabled until a wallet is connected on ${V3.chainName} and the
  pinned deployment has been read back successfully.</p>
</section>`,
  },
  {
    route: "merchant/payments/details",
    h1: "Payment details",
    title: "Payment details — UNICA",
    description: "One order, addressed by its id in the URL so the link reloads to the same state.",
    ogTitle: "UNICA payment details",
    ogDescription: "One order, reload-safe.",
    ogImage: "og-merchant.svg",
    body: h`
<p class="sub">This page takes an order id from the URL, for example
<code>?order=0x…</code>. The state lives entirely in the link, so reloading or sharing it
reconstructs the same page. A static host cannot serve one file per id, which is why the id is a
query parameter rather than a path segment.</p>
${C.statusRegion("order-detail", "No order in this link.")}
<p><a href="../../../pay/">Open the payer's view</a></p>`,
  },
  {
    route: "pay",
    h1: "Make a payment",
    title: "Pay — UNICA",
    description:
      "Pay an order. Every term was fixed when the order was created; the payer chooses only whether to proceed.",
    ogTitle: "Pay with UNICA",
    ogDescription: "The merchant receives their currency, or it reverts.",
    ogImage: "og-checkout.svg",
    body: h`
<section${P("demo")} id="checkout">
  <h2>Payment terms</h2>
  <p class="sub">Add an order to this link as <code>?order=0x…</code> to pay a specific one.</p>
  ${C.statusRegion("terms", "Terms are read from the chain when script runs.")}
  <div id="order-terms" class="status" role="status" aria-live="polite" hidden>
    <p id="order-test-mode" class="tag">[TEST MODE]</p>
    <p id="order-no-value" class="sub">Testnet demonstration -- no real value</p>
    <dl class="evidence-key">
      <dt>Merchant</dt><dd id="order-merchant-name">—</dd>
      <dt>Merchant address (full)</dt><dd id="order-merchant-address">—</dd>
      <dt>Identity art</dt><dd id="order-identity-art">—</dd>
      <dt>You pay (max)</dt><dd id="order-input">—</dd>
      <dt>Merchant receives (minimum)</dt><dd id="order-output">—</dd>
      <dt>Network</dt><dd id="order-network">—</dd>
      <dt>Expires in</dt><dd id="order-expiry">—</dd>
      <dt>Fees</dt><dd id="order-fees">—</dd>
    </dl>
  </div>
  ${C.v3Disclosure()}
</section>
<section${P("wallet")}>
  <h2>Wallet</h2>
  ${C.statusRegion("wallet", "No wallet has been connected.")}
  <p><button type="button" class="cta" id="connect" disabled aria-describedby="connect-why">Connect a wallet</button></p>
  <p class="sub" id="connect-why">Disabled until this demo's runtime configuration has been read.</p>
</section>
<section${P("chain-switch")}>
  <h2>Network</h2>
  <p>This payment settles on ${V3.chainName} (${V3.chainId}). A wallet on another network is asked
  to switch; it is never paid from the wrong chain.</p>
  ${C.statusRegion("network", "Network has not been read.")}
</section>
<section${P("blockers")}>
  <h2>When this page disables everything</h2>
  <p>Each of these disables the payment and says so in one sentence rather than failing quietly:</p>
  <ul>
    <li>The chain could not be read.</li>
    <li>A pinned value disagrees with the chain.</li>
    <li>The pool holds no liquidity, or too little for this order.</li>
    <li>No wallet, or a wallet on the wrong network.</li>
    <li>The live quote is below the order's committed minimum.</li>
  </ul>
  <ul id="active-blockers" class="status" role="status" aria-live="polite" hidden></ul>
</section>
<section${P("pay")}>
  <h2>Pay</h2>
  <p><button type="button" class="cta" id="pay" disabled aria-describedby="pay-why">Pay</button></p>
  <p class="sub" id="pay-why">Disabled until an order is loaded, a wallet is connected on the right
  network, and every check above has passed.</p>
  <p${P("expired")}>An expired order cannot be paid. The page says so and offers a new one.</p>
  <p${P("settled")}>A settled order cannot be paid twice. The page offers a way to register another.</p>
  ${C.statusRegion("payment-status", "Awaiting payer.")}
  <p><button type="button" class="cta cta-quiet" id="verify-again" hidden aria-describedby="verify-again-why">Verify again</button></p>
  <p class="sub" id="verify-again-why">Re-checks this order's evidence without sending another transaction.</p>
  <div id="evidence-output" hidden>
    <h3>Verified receipt</h3>
    <p id="evidence-decision" class="sub"></p>
    <pre id="evidence-json" class="evidence-json"></pre>
  </div>
</section>
<script type="module" src="../assets/local-pay.js"></script>`,
  },
  {
    route: "receipt",
    h1: "Receipt",
    title: "Receipt — UNICA",
    description:
      "A settlement receipt, addressed by chain and transaction so the link reloads to the same record.",
    ogTitle: "UNICA receipt",
    ogDescription: "Rebuildable from chain data alone.",
    ogImage: "og-receipt.svg",
    body: h`
<p class="sub">This page takes <code>?chain=</code> and <code>?tx=</code> from the URL. The state is
entirely in the link, so it reloads and shares correctly. A static host cannot serve one file per
transaction hash, which is why these are query parameters.</p>
<section${P("receipt")}>
  <h2>Settlement</h2>
  ${C.statusRegion("receipt", "No transaction in this link.")}
  ${C.evidenceKey()}
</section>
<section${P("graph")}>
  <h2>Indexed settlements</h2>
  ${C.statusRegion("graph", "The index has not been read yet.")}
  <p${P("graph-fail")}>An index that cannot be reached and an index holding nothing are different
  answers, and this page never shows one as the other. A failed read says it failed.</p>
</section>
<section>
  <h2>Without the indexer</h2>
  <p>Every field above can be rebuilt from the transaction's own logs and the contracts' state. The
  index makes it faster; it is never the only route.</p>
</section>`,
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
  <li><strong>Liquidity is not guaranteed</strong> by anyone, and a thin pool moves on small size.</li>
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
