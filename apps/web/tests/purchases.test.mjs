// A customer's purchases: the index question, the rows out of its answer, and the receipt each row is.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { customerLabel, purchaseReceiptHref, purchaseRows, purchasesQuery, readPurchases } from "../assets/purchases.js";

const WHO = "0x19E56831a10d43CfF5d77f886c799C6b916da7Ae";
const SALE = "0x530bfd99a0f1c5d17c89bbaf1da8537b0a78ef5007895e7f61cbe9869e6814ec"; // sale id: the live one
const TX = "0x334d28030c94488b5cb30c25205c5887ab805eec89979a177f334b770e10b96e"; // its transaction

test("the question names the wallet lower-cased and asks both kinds, newest first", () => {
  const q = purchasesQuery(WHO);
  assert.equal(q.variables.who, WHO.toLowerCase());
  assert.match(q.query, /productSales\(where: \{ buyer: \$who \}, orderBy: settledAt, orderDirection: desc/);
  assert.match(q.query, /settlements\(where: \{ payer: \$who \}, orderBy: settledAt, orderDirection: desc/);
  assert.equal(purchasesQuery("nope"), null);
});

test("rows come out of the answer newest first, a missing field is null, and a non-answer is null", () => {
  const body = { data: {
    productSales: [{ id: SALE, productId: "1", seller: "0xa121e1ef31bbf0826aa67dc01e7977e80af58d73", payout: "0xa121e1ef31bbf0826aa67dc01e7977e80af58d73", asset: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", amount: "2000000", kind: 2, paidThrough: "0", settledAt: "1789260252", transactionHash: TX }],
    settlements: [{ id: "0x01", orderId: "0x" + "ab".repeat(32), recipient: "0x" + "cd".repeat(20), asset: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", amount: "500000", kind: "direct", settledAt: "1789270000", transactionHash: "0x" + "ef".repeat(32) }],
  } };
  const rows = purchaseRows(body);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "payment", "the later settlement comes first");
  assert.equal(rows[1].kind, "product");
  assert.equal(rows[1].id, SALE);
  assert.equal(rows[1].productId, "1");
  assert.equal(rows[1].seller, "0xa121e1ef31bbf0826aa67dc01e7977e80af58d73");
  assert.equal(rows[0].id, "0x" + "ab".repeat(32), "a settlement is named by its order id");
  assert.deepEqual(purchaseRows({ data: { productSales: [], settlements: [] } }), []);
  assert.equal(purchaseRows({ data: { productSales: [] } }), null, "half an answer is not an answer");
  assert.equal(purchaseRows({ errors: [{ message: "x" }] }), null);
  assert.equal(purchaseRows(null), null);
});

test("each row is the receipt the checkout hands out, with the business on the link", () => {
  const [row] = purchaseRows({ data: { productSales: [{ id: SALE, productId: "1", payout: "0xa121e1ef31bbf0826aa67dc01e7977e80af58d73", asset: "0x1c7d", amount: "2000000", settledAt: "1", transactionHash: TX }], settlements: [] } });
  assert.equal(purchaseReceiptHref("../", 11155111, row), `../receipt/?chain=11155111&sale=${SALE}&tx=${TX}&business=0xa121e1ef31bbf0826aa67dc01e7977e80af58d73`);
  const [pay] = purchaseRows({ data: { productSales: [], settlements: [{ id: "0x1", orderId: "0x" + "ab".repeat(32), recipient: "0x" + "cd".repeat(20), amount: "1", settledAt: "1", transactionHash: null }] } });
  assert.equal(purchaseReceiptHref("./", 31337, pay), `./receipt/?chain=31337&order=0x${"ab".repeat(32)}&business=0x${"cd".repeat(20)}`);
  assert.equal(customerLabel("consumer.eth", "0x19e5…a7ae"), "consumer.eth (0x19e5…a7ae)");
  assert.equal(customerLabel(null, "0x19e5…a7ae"), "0x19e5…a7ae");
});

test("the index is asked once, by POST, and anything but a clean answer is null", async () => {
  const calls = [];
  const ok = async (url, init) => (calls.push({ url, init }), { ok: true, json: async () => ({ data: { productSales: [], settlements: [] } }) });
  assert.deepEqual(await readPurchases("https://index.invalid/q", WHO, ok), []);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).variables.who, WHO.toLowerCase());
  assert.equal(await readPurchases(null, WHO, ok), null, "no index configured");
  assert.equal(await readPurchases("https://index.invalid/q", WHO, async () => ({ ok: false, status: 500, json: async () => ({}) })), null);
  assert.equal(await readPurchases("https://index.invalid/q", WHO, async () => { throw new Error("away"); }), null);
});

test("the dashboard lists purchases for a wallet with no business, and the customers tab names customers", () => {
  const markup = readFileSync(new URL("../src/routes/business.mjs", import.meta.url), "utf8");
  assert.match(markup, /id="purchases"/);
  assert.match(markup, /id="purchase-list"/);
  assert.match(markup, /id="purchases-said"/);
  const business = readFileSync(new URL("../assets/business.js", import.meta.url), "utf8");
  assert.match(business, /async function renderPurchases\(config, session, prefix\)/);
  assert.match(business, /if \(!business\.joined\) await renderPurchases\(config, session, prefix\);/);
  const customers = readFileSync(new URL("../assets/customers.js", import.meta.url), "utf8");
  assert.match(customers, /customerProfile\(config, row\.payer\)/);
  assert.match(customers, /customerLabel\(/);
});

test("the dashboard writes a wallet as its verified ENS name beside the address, else the address alone, one read per wallet", async () => {
  const { walletLabel } = await import("../assets/business.js");
  const config = { chainId: 11155111, rpc: "/local/rpc" };
  let reads = 0;
  const named = async (_config, wallet) => { reads += 1; return wallet.toLowerCase().startsWith("0xa121") ? "nfteria.eth" : null; };
  assert.equal(await walletLabel(config, "0xa121e1ef31bbf0826aa67dc01e7977e80af58d73", named), "nfteria.eth (0xa121e1…8d73)");
  assert.equal(await walletLabel(config, "0xA121e1eF31bBF0826aA67dC01e7977e80Af58D73", named), "nfteria.eth (0xa121e1…8d73)", "the same wallet in another case is the same read and the same label");
  assert.equal(reads, 1, "the second ask is answered from the first read");
  assert.equal(await walletLabel(config, "0x19e56831a10d43cff5d77f886c799c6b916da7ae", async () => null), "0x19e568…a7ae");
  assert.equal(await walletLabel(config, "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", async () => { throw new Error("away"); }), "0x3c44cd…93bc", "a failed read is the address, never a wrong name");
  assert.equal(await walletLabel(config, "nope", named), "Not known yet");
  const src = readFileSync(new URL("../assets/business.js", import.meta.url), "utf8");
  assert.match(src, /walletLabel\(config, wallet\)\.then\(\(label\) => say\("set-payout", label\)\)/, "the settings row is named");
  assert.equal((src.match(/read for \$\{await walletLabel\(config, wallet\)\}/g) || []).length, 2, "both 'read for' lines are named");
});
