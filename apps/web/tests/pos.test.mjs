/**
 * The register, executable.
 *
 * The four things a till can get wrong that nobody notices until money is involved: the arithmetic
 * between what a person types and what the chain is told; the amount a quick-pick fills in; the
 * link the customer is handed; and the word the screen uses about a payment. Each is a pure
 * function in assets/cashier.js and each is exercised here rather than paraphrased.
 *
 * Every check that could pass for the wrong reason is paired with a control that must fail.
 *
 * Offline. No network, no chain, no wallet, no browser: the module's DOM half is behind a
 * `typeof document !== "undefined"` guard, so importing it here runs none of it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { encodeCall, selectorOf, topicOf } from "../assets/abi.js";
import { fromBaseUnits } from "../assets/product.js";
import { INTEGRATIONS, contrastRatio, hexToRgb, rgbToHex } from "../assets/brand.js";
import {
  ENTRY_MAX_DIGITS,
  GATE_ERRORS,
  ORDER_ADMITTED_SIGNATURE,
  ORDER_CREATED_DIRECT_SIGNATURE,
  ORDER_CREATED_SIGNATURE,
  REFUSALS,
  REQUEST_ORDER_SIGNATURE,
  ROBINHOOD_CHAIN_ID,
  baseUnitsToEntry,
  chooseRegister,
  entryDecimalsFor,
  entryToBaseUnits,
  formatEntry,
  gateFor,
  integrationFor,
  loadCatalog,
  orderIdFromAdmission,
  orderLink,
  pickProductEntry,
  pressKey,
  productLink,
  refusalForRevert,
  saleVerdict,
  shopLink,
} from "../assets/cashier.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");

/** The payout asset of the local deployment: six places, so a person types two of them. */
const UUSD = { address: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", symbol: "uUSD", decimals: 6, labelled: true };
const TAST = { address: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", symbol: "tAST", decimals: 18, labelled: true };
/** The per-payment ceiling this deployment carries: 10.000000 uUSD in payout base units. */
const CAP = "10000000";
const PAGE = "https://example.test/shop/business/payments/new/";

// ── the amount, as a till enters it ──────────────────────────────────────────────────────────────

test("a person types two decimal places, whatever precision the asset holds", () => {
  assert.equal(entryDecimalsFor(UUSD), 2);
  assert.equal(entryDecimalsFor(TAST), 2);
  assert.equal(entryDecimalsFor({ decimals: 0 }), 0, "a whole-unit asset is entered in whole units");
  assert.equal(entryDecimalsFor({ decimals: 1 }), 1);
  assert.equal(entryDecimalsFor({}), null, "an asset that never said how precise it is gets no entry scale");
});

test("keypad presses become base units at the asset's own precision", () => {
  const press = (digits, key) => pressKey(digits, key, { decimals: 6, entryDecimals: 2, limitUnits: null }).digits;
  let digits = "";
  for (const key of ["1", "2", "5", "0"]) digits = press(digits, key);
  assert.equal(digits, "1250");
  assert.equal(formatEntry(digits, 2), "12.50");
  assert.equal(entryToBaseUnits(digits, 6, 2), 12500000n);
  // The same presses against an eighteen-place asset are the same amount, scaled once.
  assert.equal(entryToBaseUnits(digits, 18, 2), 12500000000000000000n);
  assert.equal(entryToBaseUnits(digits, 2, 2), 1250n);
});

test("control: the scaling is load-bearing, not a coincidence of six places", () => {
  assert.notEqual(entryToBaseUnits("1250", 6, 2), entryToBaseUnits("1250", 18, 2));
  assert.throws(() => entryToBaseUnits("1250", 2, 6), /how precise/);
});

test("00 adds two, backspace removes one, and an empty entry is a zero", () => {
  const opts = { decimals: 6, entryDecimals: 2, limitUnits: null };
  assert.equal(pressKey("5", "00", opts).digits, "500");
  assert.equal(formatEntry("500", 2), "5.00");
  assert.equal(pressKey("500", "backspace", opts).digits, "50");
  assert.equal(pressKey("5", "backspace", opts).digits, "");
  assert.equal(pressKey("", "backspace", opts).digits, "", "backspace on nothing is not an error");
  assert.equal(formatEntry("", 2), "0.00");
  assert.equal(formatEntry("", 0), "0");
  assert.equal(pressKey("", "clear", opts).digits, "");
  assert.equal(pressKey("12", "x", opts).digits, "12", "a key this pad does not have moves nothing");
});

test("a leading zero never becomes part of the number", () => {
  const opts = { decimals: 6, entryDecimals: 2, limitUnits: null };
  let digits = "";
  for (const key of ["0", "0", "7"]) digits = pressKey(digits, key, opts).digits;
  assert.equal(digits, "7");
  assert.equal(formatEntry(digits, 2), "0.07");
});

test("the till stops at the deployment's own ceiling, and says why", () => {
  const opts = { decimals: 6, entryDecimals: 2, limitUnits: CAP };
  // 10.00 exactly is the ceiling and is accepted; the next digit would make it 100.00.
  assert.equal(entryToBaseUnits("1000", 6, 2), 10000000n);
  const at = pressKey("100", "0", opts);
  assert.equal(at.digits, "1000");
  assert.equal(at.refusal, null);
  const over = pressKey("1000", "0", opts);
  assert.equal(over.digits, "1000", "the number does not move");
  assert.equal(over.refusal, REFUSALS.ABOVE_LIMIT);
});

test("control: without a ceiling the same press is accepted, so the ceiling is what refused it", () => {
  const over = pressKey("1000", "0", { decimals: 6, entryDecimals: 2, limitUnits: null });
  assert.equal(over.digits, "10000");
  assert.equal(over.refusal, null);
});

test("an entry cannot grow without end", () => {
  const opts = { decimals: 6, entryDecimals: 2, limitUnits: null };
  const full = "9".repeat(ENTRY_MAX_DIGITS);
  const refused = pressKey(full, "9", opts);
  assert.equal(refused.digits, full);
  assert.equal(refused.refusal, REFUSALS.TOO_MANY_DIGITS);
});

// ── the shop's own list ──────────────────────────────────────────────────────────────────────────

test("a quick-pick fills the amount with the item's own price", () => {
  const haircut = { id: "1", name: "Haircut", price: "1800000", decimals: 6, symbol: "uUSD" };
  const entry = pickProductEntry(haircut, 2);
  assert.equal(entry.digits, "180");
  assert.equal(entry.text, "1.80");
  assert.equal(entry.exactUnits, 1800000n);
  assert.equal(entryToBaseUnits(entry.digits, 6, 2), 1800000n, "what the keypad now holds is the same amount");
  // The width is the till's, not the number's: a price that loses its trailing zero across a
  // counter looks like a different price. Seen on the running screen as 1.8 before it was fixed.
  assert.equal(entry.text, formatEntry(entry.digits, 2));
  assert.notEqual(entry.text, fromBaseUnits(1800000n, 6));
});

test("a price the keypad cannot express is shown exactly and not rounded to fit", () => {
  const odd = { id: "2", name: "Trim", price: "1800001", decimals: 6, symbol: "uUSD" };
  const entry = pickProductEntry(odd, 2);
  assert.equal(entry.digits, "", "no keypad entry can mean this amount");
  assert.equal(entry.exactUnits, 1800001n, "the exact amount is what will be charged");
  assert.equal(entry.text, "1.800001");
  assert.equal(baseUnitsToEntry(1800001n, 6, 2), null);
  assert.equal(baseUnitsToEntry(1800000n, 6, 2), "180");
});

test("an item with no price fills nothing rather than a zero", () => {
  const entry = pickProductEntry({ id: "3", name: "Ask us" }, 2);
  assert.equal(entry.digits, "");
  assert.equal(entry.exactUnits, null);
  assert.equal(entry.text, "—");
});

test("the shop's list is read from the catalogue endpoint, and silence is an empty list", async () => {
  const seller = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const asked = [];
  const answer = {
    seller,
    chainId: 31337,
    products: [
      { id: "1", name: "Haircut", asset: UUSD.address, symbol: "uUSD", decimals: 6, price: "1800000", kind: "one-off", active: true },
      { id: "2", name: "Old special", asset: UUSD.address, symbol: "uUSD", decimals: 6, price: "900000", kind: "one-off", active: false },
    ],
  };
  const fetchImpl = async (url) => {
    asked.push(url);
    return { ok: true, json: async () => answer };
  };
  const products = await loadCatalog(seller, fetchImpl);
  assert.equal(asked[0], `/local/catalog?seller=${encodeURIComponent(seller)}`);
  assert.deepEqual(products.map((p) => p.name), ["Haircut"], "a listing the business switched off is not on the counter");

  assert.deepEqual(await loadCatalog(seller, async () => ({ ok: false, json: async () => ({}) })), []);
  assert.deepEqual(await loadCatalog(seller, async () => { throw new Error("nothing there"); }), []);
  assert.deepEqual(await loadCatalog("not-an-address", async () => { throw new Error("must not be asked"); }), []);
});

// ── the link the customer is handed ──────────────────────────────────────────────────────────────

test("the three payment links are exactly the three shapes the product publishes", () => {
  const orderId = "0xc1550b78cc3205fa39ae76239b1cb65f549a6c713facbe9cfd891c5e4c0b4f1b"; // an order id from the local run
  const seller = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  assert.equal(orderLink(orderId, PAGE), `https://example.test/shop/pay/?order=${orderId}`);
  assert.equal(productLink("7", PAGE), "https://example.test/shop/pay/?product=7");
  assert.equal(shopLink(seller, PAGE), `https://example.test/shop/pay/?business=${seller}`);
});

test("a link is composed against the page it is handed from, never against a written-in host", () => {
  const orderId = "0x" + "ab".repeat(32);
  const elsewhere = "https://pay.example.org/business/payments/new/";
  assert.equal(orderLink(orderId, elsewhere), `https://pay.example.org/pay/?order=${orderId}`);
  assert.match(orderLink(orderId, PAGE), /^https:\/\/example\.test\/shop\/pay\/\?order=0x[0-9a-f]{64}$/);
  assert.equal(readFileSync(join(APP, "assets", "cashier.js"), "utf8").includes("http"), false, "no host is written into the register");
});

// ── the word this screen may use about a payment ─────────────────────────────────────────────────

test("Paid appears only on a verified check; the other three words cover everything else", () => {
  assert.equal(saleVerdict({ evidence: { decision: "VERIFIED" } }).word, "Paid");
  assert.equal(saleVerdict({ evidence: { decision: "REFUSED", reasonCodes: ["WRONG_PAYER"] } }).word, "Refused");
  assert.equal(saleVerdict({ evidence: { decision: "UNKNOWN", reasonCodes: ["VERIFICATION_UNREACHABLE"] } }).word, "Unknown");
  assert.equal(saleVerdict({}).word, "Checking");
  assert.equal(saleVerdict({ evidence: null }).word, "Checking");
  const words = new Set(
    [{ evidence: { decision: "VERIFIED" } }, { evidence: { decision: "REFUSED" } }, { evidence: { decision: "UNKNOWN" } }, {}, { expired: true }]
      .map((s) => saleVerdict(s).word),
  );
  assert.deepEqual([...words].sort(), ["Checking", "Paid", "Refused", "Unknown"]);
});

test("control: a transaction hash is never Paid, and a reverted transaction is Refused", () => {
  assert.equal(saleVerdict({ txHash: "0x" + "11".repeat(32) }).word, "Checking");
  assert.equal(saleVerdict({ txHash: "0x" + "11".repeat(32), evidence: { decision: "PENDING" } }).word, "Checking");
  assert.equal(saleVerdict({ txReceipt: { status: 0 } }).word, "Refused");
});

test("a sale whose time is up stops being watched, and never claims to know what happened", () => {
  const out = saleVerdict({ expired: true });
  assert.equal(out.word, "Unknown");
  assert.equal(out.done, true);
  assert.match(out.line, /time is up/);
  // Verification still outranks the clock: a sale checked after it expired is paid.
  assert.equal(saleVerdict({ evidence: { decision: "VERIFIED" }, expired: true }).word, "Paid");
  assert.equal(saleVerdict({}).done, false, "an unexpired unchecked sale keeps being watched");
});

// ── refusals ─────────────────────────────────────────────────────────────────────────────────────

test("every refusal is one line, in the words of the shop", () => {
  const machine = /\b(hook|executor|registry|pool|tick|feed|calldata|hex)s?\b/i;
  for (const [name, line] of Object.entries(REFUSALS)) {
    assert.ok(line.length > 0 && line.length <= 96, `${name} is ${line.length} characters`);
    assert.equal(line.includes("\n"), false, `${name} is more than one line`);
    assert.equal(machine.test(line), false, `${name} says a machine word: ${line}`);
  }
  for (const named of ["WRONG_NETWORK", "NO_REGISTER", "ABOVE_LIMIT", "ASSET_UNAVAILABLE"]) {
    assert.ok(REFUSALS[named], `the register has no line for ${named}`);
  }
});

test("control: the machine-word check would catch a refusal that leaked one", () => {
  assert.equal(/\b(hook|executor|registry|pool|tick|feed|calldata|hex)s?\b/i.test("the executor refused it"), true);
});

// ── the register a cashier starts on ─────────────────────────────────────────────────────────────

test("the switched-on register is the one preselected", () => {
  const registers = [
    { node: "0x01", label: "chair-2", status: "revoked" },
    { node: "0x02", label: "chair-1", status: "active" },
    { node: "0x03", label: "chair-3", status: "active" },
  ];
  assert.equal(chooseRegister(registers).label, "chair-1");
  assert.equal(chooseRegister([{ node: "0x01", label: "chair-2", status: "revoked" }]), null);
  assert.equal(chooseRegister([]), null);
  assert.equal(chooseRegister(), null);
});

// ── colour: at most one integration, and never as the thing that carries the meaning ─────────────

test("one view names at most one integration, and only where the fact is on screen", () => {
  assert.equal(integrationFor({ customerAsset: UUSD, converts: false, chainId: 31337 }), null);
  assert.equal(integrationFor({ customerAsset: TAST, converts: true, chainId: 31337 }), INTEGRATIONS.uniswap);
  const stock = { ...TAST, kind: "stock" };
  const stockSale = { customerAsset: stock, converts: true, chainId: ROBINHOOD_CHAIN_ID };
  const stockColour = INTEGRATIONS.stock;
  assert.equal(integrationFor(stockSale), stockColour);
  assert.equal(
    integrationFor({ customerAsset: stock, converts: false, chainId: 31337 }),
    null,
    "a stock claim needs Robinhood Chain, not a word in a configuration file",
  );
  assert.equal(
    integrationFor({ customerAsset: TAST, converts: false, chainId: ROBINHOOD_CHAIN_ID }),
    null,
    "being on that chain does not make every asset a tokenized stock",
  );
});

/** color-mix(in srgb, a p%, b) is a component-wise mix of the two gamma-encoded colours. */
const mix = (a, b, p) => rgbToHex(hexToRgb(a).map((v, i) => v * p + hexToRgb(b)[i] * (1 - p)));
const SCHEMES = [
  { name: "light", ink: "#14161a", paper: "#fbfbfa" },
  { name: "dark", ink: "#eef1ef", paper: "#101215" },
];

test("the text this screen adds clears 4.5:1 in both schemes, computed rather than assumed", () => {
  for (const { name, ink, paper } of SCHEMES) {
    const surface = mix(ink, paper, 0.05);
    const muted = mix(ink, paper, 0.66);
    assert.ok(contrastRatio(ink, surface) >= 4.5, `${name}: the link text is ${contrastRatio(ink, surface).toFixed(2)}:1`);
    assert.ok(contrastRatio(muted, paper) >= 4.5, `${name}: the integration name is ${contrastRatio(muted, paper).toFixed(2)}:1`);
  }
});

test("a key's own edge clears the 3:1 a control's boundary needs, in both schemes", () => {
  const css = readFileSync(join(APP, "assets", "screens", "pos.css"), "utf8");
  assert.match(css, /\.pos \.keypad \.key\s*\{[^}]*border-color:\s*var\(--muted\)/);
  for (const { name, ink, paper } of SCHEMES) {
    const muted = mix(ink, paper, 0.66);
    const line = mix(ink, paper, 0.14);
    assert.ok(contrastRatio(muted, paper) >= 3, `${name}: a key's edge is ${contrastRatio(muted, paper).toFixed(2)}:1`);
    // ...and the quieter neutral it replaced would NOT have cleared it, which is why it was replaced.
    assert.ok(contrastRatio(line, paper) < 3, `${name}: the quiet rule would have passed, so this says nothing`);
  }
});

test("control: the ratio function fails a pair that should fail", () => {
  assert.ok(contrastRatio("#777777", "#888888") < 4.5);
  assert.ok(contrastRatio("#ffffff", "#000000") > 20.9);
});

test("an integration's colour is a 3px rule and never the text, because measured it could not be", () => {
  const css = readFileSync(join(APP, "assets", "screens", "pos.css"), "utf8");
  for (const [key, integration] of Object.entries(INTEGRATIONS)) {
    assert.equal(
      css.toLowerCase().includes(integration.colour.toLowerCase()),
      false,
      `${key}'s colour is written into the stylesheet instead of arriving as the one mark`,
    );
  }
  assert.match(css, /\.pos-mark\s*\{[^}]*border-left:\s*3px solid var\(--pos-mark/);
  assert.match(css, /\.pos-mark\s*\{[^}]*color:\s*var\(--muted\)/);
  // The reason, measured: as text on the light ground these colours do not reach the floor, so the
  // name carries the meaning and the colour only agrees with it.
  const paper = "#fbfbfa";
  const asText = Object.values(INTEGRATIONS).map((i) => contrastRatio(i.colour, paper));
  assert.ok(Math.min(...asText) < 4.5, `all five would have passed as text (worst ${Math.min(...asText).toFixed(2)}:1)`);
  assert.ok(contrastRatio(INTEGRATIONS.stock.colour, paper) < 3, "Robinhood Chain green is the one that proves it");
});

test("the one button takes the business's own accent, with the text colour computed against it", () => {
  const css = readFileSync(join(APP, "assets", "screens", "pos.css"), "utf8");
  assert.match(css, /\.pos \.charge\s*\{[^}]*background:\s*var\(--business-accent, var\(--accent\)\)/);
  assert.match(css, /\.pos \.charge\s*\{[^}]*color:\s*var\(--business-accent-text, var\(--on-accent\)\)/);
  assert.equal(/#[0-9a-f]{3,8}/i.test(css), false, "no colour is written into this stylesheet by hand");
});

test("the register is a phone screen first: the keypad fills the width and every target is 44px or more", () => {
  const css = readFileSync(join(APP, "assets", "screens", "pos.css"), "utf8");
  assert.match(css, /\.pos\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/, "one column by default");
  assert.match(css, /@media \(min-width: 52rem\)[\s\S]*grid-template-columns:\s*26rem minmax\(0, 1fr\)/, "26rem beside the sale on a desktop");
  const targets = [...css.matchAll(/min-height:\s*calc\(var\(--space\) \* (\d+)\)/g)].map((m) => Number(m[1]) * 4);
  assert.ok(targets.length >= 3, `only ${targets.length} sized targets found`);
  assert.deepEqual(targets.filter((t) => t < 44), [], "a target smaller than 44px");
});

// ── how a sale is actually raised ────────────────────────────────────────────────────────────────

test("each path names the gate its own deployment says admits it", () => {
  const manifest = {
    contracts: { terminalAdmission: { address: "0x09635F643e140090A9A8Dcd712eD6285858ceBef" } },
    directSettlement: { gate: "0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E" },
  };
  assert.equal(gateFor({ kind: "direct" }, manifest), manifest.directSettlement.gate);
  assert.equal(gateFor({ kind: "conversion" }, manifest), manifest.contracts.terminalAdmission.address);
  assert.equal(gateFor({ kind: "none" }, manifest), null);
  assert.equal(gateFor({ kind: "direct" }, {}), null, "a deployment that names no gate is not guessed at");
});

test("the register's call encodes at the widths the settlement ABI declares", () => {
  const args = [
    "0x" + "aa".repeat(32),
    "0x" + "bb".repeat(32),
    "0x" + "cc".repeat(32),
    "0x67d269191c92Caf3cD7723F116c85e6E9bf55933",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "1250000",
    "1250000",
    "1789085715",
    "0x" + "11".repeat(32),
  ];
  const data = encodeCall(REQUEST_ORDER_SIGNATURE, args);
  assert.equal(data.slice(0, 10), selectorOf(REQUEST_ORDER_SIGNATURE));
  assert.equal(data.length, 10 + 10 * 64, "ten static words follow the selector");
  assert.ok(data.includes((1250000).toString(16).padStart(64, "0")), "the amount is one whole word");
});

test("control: a value too wide for its declared width is refused, not silently truncated", () => {
  assert.throws(
    () =>
      encodeCall("createOrder(address,address,uint128,uint128,uint64,bytes32)", [
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
        "1",
        "1",
        (2n ** 64n).toString(),
        "0x" + "11".repeat(32),
      ]),
    /does not fit uint64/,
  );
  assert.throws(() => encodeCall("f(uint7)", ["1"]), /unsupported static type/);
});

test("a refusal from the chain becomes the one line for it", () => {
  // The exact message the local network answered with when a wallet that is not this register's
  // operator asked to raise a sale. Read off the running chain, not composed here.
  const said =
    "eth_call refused: execution reverted: custom error 0x890f1890: " +
    "782b05e4c83262070602527c08c2d159cc29720f120ccd7dd0a57fbb0f72a1cf" +
    "00000000000000000000000023618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f";
  assert.equal(refusalForRevert(said), REFUSALS.NOT_ALLOWED);
  assert.equal(refusalForRevert(`reverted ${selectorOf("TerminalNotActive(bytes32,string)")}`), REFUSALS.NO_REGISTER);
  assert.equal(refusalForRevert(`reverted ${selectorOf("OrderAboveCap(uint128,uint128)")}`), REFUSALS.ABOVE_LIMIT);
  assert.equal(refusalForRevert(`reverted ${selectorOf("ExecutorNotRegistered(address)")}`), REFUSALS.ASSET_UNAVAILABLE);
  // Also read off the running chain: what a converted sale answers with when its exact terms have
  // not been cleared. Without this row a cashier would read a raw revert at the counter.
  assert.equal(refusalForRevert('execution reverted: custom error 0x7995eba5: ""'), REFUSALS.NOT_CLEARED);
  assert.equal(selectorOf("PolicyNotAuthorized(bytes32)"), "0x7995eba5");
});

test("control: an error this register does not recognise is not given a confident line", () => {
  assert.equal(refusalForRevert("execution reverted: custom error 0xdeadbeef"), null);
  assert.equal(refusalForRevert(""), null);
  assert.equal(refusalForRevert(null), null);
  const selectors = GATE_ERRORS.map(([signature]) => selectorOf(signature));
  assert.equal(new Set(selectors).size, selectors.length, "one refusal is shadowing another");
});

test("the sale id is read back from the gate's own log, not from the screen's prediction", () => {
  const gate = "0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E";
  const orderId = "0xfcdf8f18559b5b1e659be767fe59a8a94a61729340d31241d5c6081e36419579"; // an order id from the local run
  const receipt = {
    logs: [
      {
        address: "0x67d269191c92Caf3cD7723F116c85e6E9bf55933",
        topics: [topicOf(ORDER_CREATED_DIRECT_SIGNATURE), "0x" + "99".repeat(32)],
      },
      { address: gate.toLowerCase(), topics: [topicOf(ORDER_ADMITTED_SIGNATURE), orderId, "0x" + "bb".repeat(32)] },
    ],
  };
  assert.equal(orderIdFromAdmission(receipt, gate), orderId);
  assert.equal(orderIdFromAdmission({ logs: [] }, gate), null);
  assert.equal(
    orderIdFromAdmission(
      { logs: [{ address: "0x0000000000000000000000000000000000000001", topics: [topicOf(ORDER_ADMITTED_SIGNATURE), orderId] }] },
      gate,
    ),
    null,
    "another contract's log of the same shape is not this sale",
  );
});

test("control: the two settlers name their OrderCreated differently, and both are looked for", () => {
  assert.notEqual(topicOf(ORDER_CREATED_SIGNATURE), topicOf(ORDER_CREATED_DIRECT_SIGNATURE));
  const source = readFileSync(join(APP, "assets", "cashier.js"), "utf8");
  assert.ok(source.includes("ORDER_CREATED_DIRECT_SIGNATURE)") && source.includes("ORDER_CREATED_SIGNATURE)"));
});

// ── the emitted document ─────────────────────────────────────────────────────────────────────────

const OUT = mkdtempSync(join(tmpdir(), "unica-pos-"));
execFileSync(process.execPath, [join(APP, "build.mjs")], { encoding: "utf8", env: { ...process.env, UNICA_BUILD_OUT: OUT } });
const page = readFileSync(join(OUT, "business", "payments", "new", "index.html"), "utf8");

test("the served register is already true with no script", () => {
  assert.match(page, /<output class="amount-display" id="amount-display" aria-live="polite">0\.00<\/output>/);
  const keys = [...page.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "backspace"]);
  assert.match(page, /<button type="button" class="cta charge" id="charge" disabled aria-describedby="charge-why">Charge<\/button>/);
  assert.match(page, /id="charge-why"/);
  assert.match(page, /id="quick-picks"[\s\S]*Your list has not been read yet/, "an unread list says so rather than showing a row");
  assert.match(page, /id="pay-assets"[\s\S]*have not been read yet/);
  assert.match(page, /href="\.\.\/\.\.\/\.\.\/assets\/screens\/pos\.css"/);
  assert.match(page, /src="\.\.\/\.\.\/\.\.\/assets\/cashier\.js"/);
  assert.match(page, /data-parity="create-order"/);
});

test("the handover carries the square, the link, Copy and Share", () => {
  const handover = page.slice(page.indexOf('id="handover"'), page.indexOf('data-advanced="true"'));
  assert.match(handover, /<div class="qr" id="qr" role="img"/);
  assert.match(handover, /<p class="pos-link" id="pay-link"><\/p>/, "the link is empty until a sale exists");
  assert.match(handover, /id="copy-link">Copy</);
  assert.match(handover, /id="share-link" hidden>Share</, "Share is hidden until the browser says it can");
  assert.match(page, /<section id="handover" hidden>/, "nothing is handed over before a sale exists");
});

test("nothing on this screen names the machinery", () => {
  const visible = page
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<details class="fold" data-advanced="true">[\s\S]*?<\/details>/g, "")
    .replace(/<[^>]+>/g, " ");
  assert.equal(/\b(hook|executor|registry|pool|tick|feed|calldata|hex)s?\b/i.test(visible), false, visible.slice(0, 200));
  for (const word of ["demo", "demonstration", "practice", "fixture", "rehearsal", "storyboard", "sample", "example"]) {
    assert.equal(new RegExp(`\\b${word}s?\\b`, "i").test(visible), false, `the register says "${word}"`);
  }
});

test("control: that scan reads the words a person sees, and would catch one", () => {
  const visible = '<p class="hex">a sample amount</p>'.replace(/<[^>]+>/g, " ");
  assert.equal(/\bsamples?\b/i.test(visible), true);
  assert.equal(/\bhexs?\b/i.test(visible), false, "a class name is not something a person reads");
});
