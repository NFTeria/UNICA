import { h, raw, hex, evidenceBadge } from "../html.mjs";
import { SITE, V3, EXPERIMENT } from "../site.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

export const MORE = [
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
  ${C.statusRegion("exp-demo", "Mock and simulated runs happen only when script is available. Neither is a settlement.")}
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
