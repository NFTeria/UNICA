import { h, raw, hex, evidenceBadge } from "../html.mjs";
import { SITE, V3, EXPERIMENT } from "../site.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

export const DOCS = [
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
];
