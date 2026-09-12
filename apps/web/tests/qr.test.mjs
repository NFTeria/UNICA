import assert from "node:assert/strict";
import { test } from "node:test";
import qrcode from "qrcode-generator";
import { loadQr, qrSvg } from "../assets/qr.js";

const ORDER_ID = "0x61ee9cf2b02b9d5bbd0f5096826d1fd18805b06fc7cd469f2a3d9669b7d03f6d"; // an order id from the local run
const LINK = `http://127.0.0.1:8787/pay/?order=${ORDER_ID}`;

test("a payment link becomes a scalable inline SVG through the one wrapper every screen uses", async () => {
  const impl = await loadQr({ impl: qrcode });
  assert.equal(impl, qrcode, "a handed-in module is used as is");
  const { svg, modules } = qrSvg(impl, LINK);
  assert.match(svg, /^<svg[^>]*viewBox="0 0 \d+ \d+"/);
  assert.ok(!/width="\d+px"/.test(svg), "scalable: the SVG has no fixed pixel width");
  assert.equal(modules, 41);
  assert.throws(() => qrSvg(impl, ""), /nothing to encode/);
  assert.throws(() => qrSvg(null, LINK), /encoder module/);
});
