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

import { HOME } from "./routes/home.mjs";
import { DOCS } from "./routes/docs.mjs";
import { DASHBOARD, PAYMENTS, PAYMENT_DETAILS } from "./routes/business.mjs";
import { POS } from "./routes/pos.mjs";
import { PAY } from "./routes/pay.mjs";
import { JOIN } from "./routes/join.mjs";
import { RECEIPT } from "./routes/receipt.mjs";
import { MORE } from "./routes/more.mjs";

// One file per screen a builder may own; the order here is the order the site has always had.
export const ROUTES = [...HOME, ...DOCS, ...DASHBOARD, ...PAYMENTS, ...POS, ...PAYMENT_DETAILS, ...PAY, ...JOIN, ...RECEIPT, ...MORE];

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
