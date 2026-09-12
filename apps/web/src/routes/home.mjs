import { h, raw, hex, evidenceBadge } from "../html.mjs";
import { SITE, V3, EXPERIMENT } from "../site.mjs";
import * as C from "../components.mjs";

const P = (id) => raw(` data-parity="${id}"`);

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
];
