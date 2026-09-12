/**
 * The landing page. It is the marketing page AND the way in, which is the only reason it carries a
 * control at all: somebody who already has a business should not have to find the header to log in.
 *
 * NO SENTENCE ON THIS PAGE IS NEW. The heading, the lead and every section below the hero are the
 * words the page already had; what changed is that the four things a visitor can DO are now four
 * controls instead of a paragraph pointing at them. apps/web/tests/home.test.mjs reads the previous
 * version of this file out of git and fails on a sentence that is not in it, so a marketing line
 * cannot arrive here by drift.
 *
 * THE PRIMARY CONTROL DOES NOT CONTAIN A LOGIN. There is one login in this product — the header
 * chip's, driven by assets/app.js — and the hero's button presses that one. Two implementations of
 * signing in is two answers to "am I signed in", and the second one is always the stale one.
 *
 * THE MARK IS READ FROM assets/mark.svg AT BUILD TIME, not retyped. The same file is the favicon
 * and the source of every link-preview raster, so there is exactly one description of the shape.
 */
import { readFileSync } from "node:fs";
import { h, raw } from "../html.mjs";

const P = (id) => raw(` data-parity="${id}"`);

/**
 * Inlined rather than referenced, because an <img> cannot inherit the page's brand tokens: inline,
 * every `var(--ink)` in the mark resolves against whichever scheme the viewer chose, and the
 * animation in assets/unica.css can reach the shapes. The file is trusted repository content, so
 * raw() is correct here and nowhere near anything a person or a chain supplied.
 */
const MARK = readFileSync(new URL("../../assets/mark.svg", import.meta.url), "utf8")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\n{2,}/g, "\n")
  .trim();

export const HOME = [
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
<div class="hero-lede">
  <div class="hero-art" aria-hidden="true">${raw(MARK)}</div>
  <p class="lead"${P("hero")}>Customers pay with what they hold. You receive the asset you chose, in
the same payment, at the wallet you named before the sale existed. Every payment ends in a receipt
your customer and your accountant can check for themselves.</p>
</div>
<p class="ctas hero-ctas">
  <button type="button" class="cta" id="hero-login" disabled aria-describedby="hero-login-why">Log in with wallet</button>
  <a class="cta cta-quiet rule-uniswap" id="hero-swap" href="https://app.uniswap.org/swap" rel="noopener">Swap on Uniswap</a>
  <a class="cta cta-quiet rule-ens" href="join/">Register your ENS name</a>
  <a class="cta cta-quiet rule-graph" href="receipt/"${P("cta-proof")}>See a receipt</a>
</p>
<p class="sub" id="hero-login-why">Enabled once this page has read the network.</p>
<nav aria-label="Sections"${P("anchor-rail")}><ul class="nav">
  <li><a href="#three">Three things it does</a></li>
  <li><a href="how-it-works/">How it works</a></li>
  <li><a href="supported-assets/">Payment assets</a></li>
  <li><a href="business/">My business</a></li>
  <li><a href="pay/"${P("cta-pay")}>Customer checkout</a></li>
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

<p class="sub"${P("builton")}>Built on Uniswap v4 (payment settlement), ENSv2 (business identity)
and The Graph (receipt indexing). Named as technologies used, not as endorsements.</p>
<p class="sub"${P("footer")}>Release evidence and the latest indexed payment are different things,
and the <a href="proof/">verification page</a> keeps them apart.</p>
<script type="module" src="./assets/home.js"></script>`,
  },
];
