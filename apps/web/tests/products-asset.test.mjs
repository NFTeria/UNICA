/**
 * What a business is paid in, per product — as rules rather than as pixels.
 *
 * The catalogue keys a price to an ERC-20 address and takes any token that has code, so the asset
 * is the business's choice and not the deployment's. Everything that choice decides is a pure
 * function: which assets the chooser may offer, what a pasted address is allowed to become, what
 * the price box's sentence says afterwards, and what bytes the wallet is then asked to confirm.
 * Each is exercised here against the real function, offline — no browser, no chain, no wallet.
 *
 * THE NETWORK IS INJECTED, NEVER REACHED. `assetChoice` takes its reader as an argument, so every
 * answer below is one this file wrote: a token that has no code, one that will not say its name,
 * one that will not say its precision, and one that answers all three. A test that needed a node
 * running would prove nothing on the day the node is down.
 *
 * AND EVERY REFUSAL HAS ITS CONTROL. A refusal row that would still pass with the guard deleted is
 * decoration, so each one is paired with the SAME answer with the single missing field restored,
 * which must be accepted. The pair is what makes the refusal attributable to the guard it names.
 * `decimals: null` and `decimals: 0` are the pair that matters most: `Number(null)` is 0, so a
 * token that never answered would read as a token with no decimal places, and a price of "1" would
 * be listed a billion billion times too small. That defect was in this screen's first draft and
 * the two rows below are what found it.
 *
 * EVERY VECTOR HERE WAS PRODUCED INDEPENDENTLY with `cast` 1.3.5 — `cast calldata` against the
 * signature in src/unica-v5/IProductCatalog.sol, and `cast sig` and `cast abi-encode` for what an
 * ERC-20 is asked and what it answers. Checking this encoder against this encoder would prove only
 * that it agrees with itself.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  OTHER_ASSET,
  assetChoice,
  assetSaid,
  assetReaderFor,
  listCalldata,
  newProductPlan,
  paidInOptions,
  payoutChoice,
  priceHint,
  priceText,
  symbolAnswer,
} from "../assets/products.js";
import { productCard } from "../assets/storefront.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");

// Canonical Ethereum Sepolia WETH9, and the two local testnet tokens the other admin rows use.
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const UUSD = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const TAST = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const PAYOUT_WALLET = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const NOBODY = "0x0000000000000000000000000000000000000000";

const USDC_ENTRY = { address: UUSD, role: "payout", symbol: "uUSD", decimals: 6, labelled: true };
const WETH_ENTRY = { address: WETH, role: "customer", symbol: "WETH", decimals: 18, labelled: true };
const UNREADABLE = { address: TAST, role: "customer", symbol: null, decimals: null, labelled: false };
const CONFIG = { assets: [WETH_ENTRY, USDC_ENTRY, UNREADABLE] };

/** A reader that must never be called: proves a known asset costs the network nothing. */
const refuseToRead = () => {
  throw new Error("the network was asked about an asset this deployment had already named");
};

// ---- what the chooser may offer ------------------------------------------------------------------

test("the chooser offers every asset this deployment can price, what it pays out in first", () => {
  const options = paidInOptions(CONFIG);
  assert.deepEqual(
    options.map((o) => o.label),
    ["uUSD", "WETH", "Another asset by address"],
  );
  assert.equal(options[0].value, UUSD);
  assert.equal(options[0].asset.decimals, 6);
  assert.equal(options[1].asset.decimals, 18);
  assert.equal(options.at(-1).value, OTHER_ASSET);
  assert.equal(options.at(-1).asset, null);
});

test("an asset this network could not name is not offered, and naming it puts it back", () => {
  assert.equal(
    paidInOptions(CONFIG).some((o) => o.value === TAST),
    false,
  );
  // Control: the ONLY difference is the label. If the row above passed for any other reason, this
  // one fails and the filter is not doing what it claims.
  const labelled = { assets: [{ ...UNREADABLE, symbol: "tAST", decimals: 18, labelled: true }] };
  assert.deepEqual(
    paidInOptions(labelled).map((o) => o.label),
    ["tAST", "Another asset by address"],
  );
});

test("a deployment that named no asset at all still offers the one option that is not a list", () => {
  assert.deepEqual(
    paidInOptions({ assets: [] }).map((o) => o.value),
    [OTHER_ASSET],
  );
  assert.deepEqual(
    paidInOptions({}).map((o) => o.value),
    [OTHER_ASSET],
  );
});

// ---- choosing one of the deployment's own assets --------------------------------------------------

test("a known asset is taken from what this deployment already read, without asking the network", async () => {
  const chosen = await assetChoice({ choice: WETH, assets: CONFIG.assets, read: refuseToRead });
  assert.equal(chosen.ok, true);
  assert.deepEqual(chosen.asset, { address: WETH, symbol: "WETH", decimals: 18, known: true });
});

test("an address is matched however it is cased, because a chooser and a manifest need not agree", async () => {
  const chosen = await assetChoice({ choice: WETH.toLowerCase(), assets: CONFIG.assets, read: refuseToRead });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.asset.symbol, "WETH");
});

test("choosing an asset this network could not name is refused, and naming it accepts it", async () => {
  const refused = await assetChoice({ choice: TAST, assets: CONFIG.assets, read: refuseToRead });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /decimal places/);
  // Control: same choice, same code path, one field restored.
  const named = await assetChoice({
    choice: TAST,
    assets: [{ ...UNREADABLE, symbol: "tAST", decimals: 18, labelled: true }],
    read: refuseToRead,
  });
  assert.equal(named.ok, true);
});

test("choosing nothing at all is refused in words that say what to do", async () => {
  const chosen = await assetChoice({ choice: "", assets: CONFIG.assets });
  assert.equal(chosen.ok, false);
  assert.match(chosen.error, /Choose which asset/);
});

test("the chooser starts on, and returns to, what this deployment pays out in", () => {
  assert.equal(payoutChoice(CONFIG), UUSD);
  // Control: with the payout asset unnamed it is not the answer, because it is not an option.
  assert.equal(payoutChoice({ assets: [WETH_ENTRY, { ...USDC_ENTRY, symbol: null, labelled: false }] }), WETH);
  // A deployment that could name nothing has one option, and that is where the chooser starts.
  assert.equal(payoutChoice({ assets: [] }), OTHER_ASSET);
  assert.equal(payoutChoice(), OTHER_ASSET);
});

// ---- an address the business pastes ---------------------------------------------------------------

/** What a healthy ERC-20 answers. Every refusal row below is this, with one field spoiled. */
const GOOD = { code: "0x60806040", symbol: "WETH", decimals: 18 };
const readerFor = (answer) => async () => answer;

test("a pasted address becomes an asset when the network answers all three questions", async () => {
  const chosen = await assetChoice({
    choice: OTHER_ASSET,
    assets: CONFIG.assets,
    address: `  ${WETH}  `,
    read: readerFor(GOOD),
  });
  assert.equal(chosen.ok, true);
  assert.deepEqual(chosen.asset, { address: WETH, symbol: "WETH", decimals: 18, known: false });
});

test("the address the reader is asked about is the one that was typed, trimmed and nothing else", async () => {
  let asked = null;
  await assetChoice({
    choice: OTHER_ASSET,
    assets: [],
    address: `\t${WETH}\n`,
    read: async (a) => {
      asked = a;
      return GOOD;
    },
  });
  assert.equal(asked, WETH);
});

test("an asset that holds no decimal places at all is a real answer and is accepted", async () => {
  const chosen = await assetChoice({ choice: OTHER_ASSET, address: WETH, read: readerFor({ ...GOOD, decimals: 0 }) });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.asset.decimals, 0);
});

test("a decimal count that arrives as a string or as a big integer is still a count", async () => {
  for (const answered of ["6", 6, 6n]) {
    const chosen = await assetChoice({ choice: OTHER_ASSET, address: WETH, read: readerFor({ ...GOOD, decimals: answered }) });
    assert.equal(chosen.ok, true, `decimals ${String(answered)} should have been read`);
    assert.equal(chosen.asset.decimals, 6);
  }
});

/**
 * Every way a pasted address can fail, and the sentence a person is given for it.
 *
 * ONE ROW PER GUARD, DELIBERATELY. These twelve were a single loop inside a single test until a red
 * line proved useless: the runner printed one failure naming the whole set, and which guard had
 * actually broken had to be found by reading the assertion message underneath it. Split like this
 * the TAP line IS the diagnosis — "no decimals answered" fails by name and the other eleven stay
 * green beside it, which is also what says the breakage is one guard and not the call itself.
 */
const REFUSALS = [
  ["not an address at all", { address: "not-an-address" }, /forty letters or digits/],
  ["forty digits with no 0x", { address: WETH.slice(2) }, /forty letters or digits/],
  ["nothing typed yet", { address: "" }, /forty letters or digits/],
  ["nothing deployed there", { answer: { ...GOOD, code: "0x" } }, /Nothing is deployed/],
  ["an answer of only zeros", { answer: { ...GOOD, code: "0x0000" } }, /Nothing is deployed/],
  ["no decimals answered", { answer: { ...GOOD, decimals: null } }, /how many decimal places/],
  ["a decimal count that is not one", { answer: { ...GOOD, decimals: "many" } }, /how many decimal places/],
  ["a decimal count nothing could hold", { answer: { ...GOOD, decimals: 77 } }, /how many decimal places/],
  ["no name answered", { answer: { ...GOOD, symbol: null } }, /did not say what it is called/],
  ["a name of only spaces", { answer: { ...GOOD, symbol: "   " } }, /did not say what it is called/],
  [
    "a name in an encoding this screen cannot read",
    { answer: { ...GOOD, symbol: null, symbolUnreadable: true } },
    /encoding this screen does not read/,
  ],
  ["the network could not be reached", { throws: "connection refused" }, /could not be read just now/],
  ["no way to reach the network", { noReader: true }, /cannot reach the network/],
];

/** The one call every row above makes, with only the field that row spoils changed. */
function refusalCall(spoil) {
  const read = spoil.noReader
    ? null
    : spoil.throws
      ? () => {
          throw new Error(spoil.throws);
        }
      : readerFor(spoil.answer ?? GOOD);
  return {
    choice: OTHER_ASSET,
    assets: CONFIG.assets,
    address: "address" in spoil ? spoil.address : WETH,
    read,
  };
}

for (const [what, spoil, expected] of REFUSALS) {
  test(`a pasted address is refused when there is ${what}`, async () => {
    const chosen = await assetChoice(refusalCall(spoil));
    assert.equal(chosen.ok, false, `${what} should have been refused`);
    assert.match(chosen.error, expected, what);
  });
}

test("thirteen refusals are asserted, stated as a number rather than counted by eye", () => {
  assert.equal(REFUSALS.length, 13);
});

test("control: an unread name and an unreadable one are refused in two different sentences", async () => {
  // Both end with no symbol, so a single sentence would be indistinguishable from a working pair.
  const silent = await assetChoice(refusalCall({ answer: { ...GOOD, symbol: null } }));
  const garbled = await assetChoice(refusalCall({ answer: { ...GOOD, symbol: null, symbolUnreadable: true } }));
  assert.notEqual(silent.error, garbled.error);
  assert.equal(/encoding this screen does not read/.test(silent.error), false);
});

test("control: the unspoiled answer, through the same call, is accepted", async () => {
  // Without this row every refusal above could be passing for a reason that has nothing to do with
  // the guard it names — a call that refused everything would look identical to twelve working guards.
  const good = await assetChoice({ choice: OTHER_ASSET, assets: CONFIG.assets, address: WETH, read: readerFor(GOOD) });
  assert.equal(good.ok, true);
});

// ---- the three questions the screen actually asks the network ---------------------------------------

// What an ERC-20 answers, produced with `cast abi-encode "f(string)" WETH` and `cast abi-encode
// "f(uint8)" 18`. Decoding OUR encoder's output with OUR decoder would prove only self-consistency.
const SYMBOL_RETURN = // cast abi-encode vector
  "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045745544800000000000000000000000000000000000000000000000000000000"; // cast abi-encode vector
const DECIMALS_RETURN = // cast abi-encode vector
  "0x0000000000000000000000000000000000000000000000000000000000000012"; // cast abi-encode vector
// The two selectors an ERC-20 answers on, from `cast sig`. script/anvil/companion.mjs pins the same
// two, so a drift between this screen and the companion would show up as a failure here.
const SYMBOL_CALL = "0x95d89b41"; // cast sig vector
const DECIMALS_CALL = "0x313ce567"; // cast sig vector

/** A session that answers from a script, and records exactly what it was asked. */
function stubSession({ code = "0x60806040", symbol = SYMBOL_RETURN, decimals = DECIMALS_RETURN } = {}) {
  const asked = [];
  const answer = (value) => {
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    asked,
    request: async (method, params) => {
      asked.push([method, ...params]);
      return answer(code);
    },
    call: async (tx) => {
      asked.push(["eth_call", tx.to, tx.data]);
      return answer(tx.data === SYMBOL_CALL ? symbol : decimals);
    },
  };
}

// ---- the two shapes a token answers its own name in ------------------------------------------------

// Produced with `cast format-bytes32-string MKR` and `cast abi-encode "f(string)" MKR`, 1.3.5. The
// two are the SAME NAME in the two encodings tokens actually use, which is the whole point of the
// rows below: one word, or an offset and a length and the bytes.
const MKR_BYTES32 = "0x4d4b520000000000000000000000000000000000000000000000000000000000"; // cast format-bytes32-string vector
const MKR_STRING =
  "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000034d4b520000000000000000000000000000000000000000000000000000000000"; // cast abi-encode vector

test("a name answered in one word is a name, not a token with no name", () => {
  assert.deepEqual(symbolAnswer(MKR_BYTES32), { symbol: "MKR", unreadable: false });
});

test("the same name answered the ABI's way reads identically", () => {
  assert.deepEqual(symbolAnswer(MKR_STRING), { symbol: "MKR", unreadable: false });
  // Control: the two encodings are genuinely different bytes, so the row above is not reading one
  // path twice. If they were equal this pair would prove nothing about either shape.
  assert.notEqual(MKR_BYTES32, MKR_STRING);
});

test("a token that answered nothing at all is unanswered, and never unreadable", () => {
  for (const nothing of [null, undefined, "", "0x"]) {
    assert.deepEqual(symbolAnswer(nothing), { symbol: null, unreadable: false }, String(nothing));
  }
  // A whole word of zeros names nothing either, and is the token's answer rather than a bad encoding.
  assert.deepEqual(symbolAnswer("0x" + "0".repeat(64)), { symbol: null, unreadable: false }); // bytes32 of zeros
});

test("a word that is not text is called unreadable, which is not the same as unanswered", () => {
  const notText = "0xff01020300000000000000000000000000000000000000000000000000000000"; // bytes32 of raw bytes
  assert.equal(notText.length, 66, "the row below only means anything if this really is one word");
  assert.deepEqual(symbolAnswer(notText), { symbol: null, unreadable: true });
  assert.deepEqual(symbolAnswer("0xabc"), { symbol: null, unreadable: true }); // neither shape's length
});

test("a token that says its name in one word can be priced in, which is the defect this row names", async () => {
  const chosen = await assetChoice({
    choice: OTHER_ASSET,
    address: WETH,
    read: readerFor({ code: "0x60806040", symbol: "MKR", symbolUnreadable: false, decimals: 18 }),
  });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.asset.symbol, "MKR");
});

test("the reader turns a one-word answer into that name, through the same session it always used", async () => {
  const answered = await assetReaderFor(stubSession({ symbol: MKR_BYTES32 }))(WETH);
  assert.equal(answered.symbol, "MKR");
  assert.equal(answered.symbolUnreadable, false);
  assert.equal(answered.decimals, 18);
});

test("the reader asks for the code and for the two things an ERC-20 says about itself", async () => {
  const session = stubSession();
  const answered = await assetReaderFor(session)(WETH);
  assert.deepEqual(answered, { code: "0x60806040", symbol: "WETH", symbolUnreadable: false, decimals: 18 });
  assert.deepEqual(session.asked, [
    ["eth_getCode", WETH, "latest"],
    ["eth_call", WETH, SYMBOL_CALL],
    ["eth_call", WETH, DECIMALS_CALL],
  ]);
});

test("a token that will not answer one of the two questions answers null, not an exception", async () => {
  const noName = await assetReaderFor(stubSession({ symbol: new Error("execution reverted") }))(WETH);
  assert.equal(noName.symbol, null);
  assert.equal(noName.decimals, 18);
  const noPrecision = await assetReaderFor(stubSession({ decimals: new Error("execution reverted") }))(WETH);
  assert.equal(noPrecision.decimals, null);
  assert.equal(noPrecision.symbol, "WETH");
  // Control: the same reader, nothing reverting, answers both. Otherwise the two rows above could
  // be passing because the reader never reads anything at all.
  const whole = await assetReaderFor(stubSession())(WETH);
  assert.equal(whole.symbol, "WETH");
  assert.equal(whole.decimals, 18);
});

test("a node that cannot be reached throws, so an unreachable one never reads as an empty address", async () => {
  const session = stubSession({ code: new Error("connection refused") });
  await assert.rejects(() => assetReaderFor(session)(WETH), /connection refused/);
  // ...and that is what `assetChoice` turns into a sentence about the READ, not about the address.
  const chosen = await assetChoice({ choice: OTHER_ASSET, address: WETH, read: assetReaderFor(session) });
  assert.equal(chosen.ok, false);
  assert.match(chosen.error, /could not be read just now/);
  assert.equal(/Nothing is deployed/.test(chosen.error), false);
});

test("end to end: an address nobody had named becomes a product priced in it", async () => {
  const chosen = await assetChoice({
    choice: OTHER_ASSET,
    assets: [USDC_ENTRY],
    address: WETH,
    read: assetReaderFor(stubSession()),
  });
  assert.equal(chosen.ok, true);
  const plan = newProductPlan({
    name: "Studio hour",
    price: "0.001",
    kind: "one-off",
    payout: PAYOUT_WALLET,
    asset: chosen.asset.address,
    decimals: chosen.asset.decimals,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.plan.price, "1000000000000000");
  assert.equal(priceText({ ...plan.plan, symbol: chosen.asset.symbol, decimals: chosen.asset.decimals }), "0.001 WETH");
});

// ---- the sentence under the price box -------------------------------------------------------------

test("the price hint names the asset that was chosen, and says so when none has been", () => {
  assert.equal(priceHint({ symbol: "WETH", decimals: 18 }), "In WETH, the asset you are paid in for this product.");
  assert.equal(priceHint({ symbol: "uUSD", decimals: 6 }), "In uUSD, the asset you are paid in for this product.");
  assert.match(priceHint(null), /Choose what you are paid in/);
  assert.match(priceHint({ symbol: null, decimals: 18 }), /Choose what you are paid in/);
});

// ---- where a refusal is written, which decides whether anybody reads it ------------------------------

const SHIPPED_HELP = "Only when you chose another asset above.";

test("a refusal about an asset from the chooser goes under the price, which is never hidden", () => {
  const said = assetSaid({ ok: false, error: "This network did not say what that asset is called." }, { pasting: false, help: SHIPPED_HELP });
  assert.equal(said.price, "This network did not say what that asset is called.");
  // ...and NOT into the address box's error, whose whole field is hidden while the chooser is in use.
  assert.equal(said.error, "");
});

test("a refusal about a typed address goes to that box's own error, which is on screen", () => {
  const said = assetSaid({ ok: false, error: "Nothing is deployed at that address on this network." }, { pasting: true, help: SHIPPED_HELP });
  assert.equal(said.error, "Nothing is deployed at that address on this network.");
  assert.match(said.price, /Choose what you are paid in/);
  assert.equal(said.help, SHIPPED_HELP);
});

test("control: no refusal is ever written to a node the chooser has hidden", () => {
  // The one rule the two rows above exist to enforce, stated once over both paths.
  for (const pasting of [true, false]) {
    const said = assetSaid({ ok: false, error: "refused" }, { pasting, help: SHIPPED_HELP });
    assert.equal([said.error, said.price].includes("refused"), true, `a refusal vanished when pasting=${pasting}`);
    if (!pasting) assert.notEqual(said.error, "refused");
  }
});

test("an asset that settled says what it is, in both places that carry a sentence about it", () => {
  const chosen = { ok: true, asset: { address: WETH, symbol: "WETH", decimals: 18, known: false } };
  assert.equal(assetSaid(chosen, { pasting: true, help: SHIPPED_HELP }).help, "WETH, 18 decimal places, read from the network.");
  assert.equal(assetSaid(chosen, { pasting: true, help: SHIPPED_HELP }).price, priceHint(chosen.asset));
  // Chosen from the list, the address box is not on screen, so its help stays the document's own.
  assert.equal(assetSaid(chosen, { pasting: false, help: SHIPPED_HELP }).help, SHIPPED_HELP);
  assert.equal(assetSaid(chosen, { pasting: false, help: SHIPPED_HELP }).error, "");
});

// ---- the price, in whatever asset was chosen --------------------------------------------------------

const FORM = { name: "Studio hour", kind: "one-off", payout: PAYOUT_WALLET };
const IN_WETH = { ...FORM, price: "0.001", asset: WETH, decimals: 18 };
const IN_USDC = { ...FORM, price: "25", asset: UUSD, decimals: 6 };

test("a price in an eighteen-place asset and the same form in a six-place one are different numbers", () => {
  assert.deepEqual(newProductPlan(IN_WETH).plan, {
    name: "Studio hour",
    asset: WETH,
    price: "1000000000000000",
    kindIndex: 0,
    period: 0,
    payout: PAYOUT_WALLET,
    onlyBuyer: NOBODY,
  });
  assert.equal(newProductPlan(IN_USDC).plan.price, "25000000");
});

test("the asset's own precision is the limit, and it is the asset's and not this screen's", () => {
  // Eighteen places is ordinary in WETH and impossible in a six-place asset. Same digits, two answers.
  const fine = newProductPlan({ ...IN_WETH, price: "0.000000000000000001" });
  assert.equal(fine.ok, true);
  assert.equal(fine.plan.price, "1");
  const refused = newProductPlan({ ...IN_USDC, price: "0.000000000000000001" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /decimal places/);
});

test("a product with no asset chosen is refused before a wallet is ever asked", () => {
  const chosen = newProductPlan({ ...IN_WETH, asset: null, decimals: null });
  assert.equal(chosen.ok, false);
  assert.match(chosen.error, /which asset/);
});

test("listing a product priced in WETH matches the calldata cast produced for the same arguments", () => {
  const expected = // cast calldata vector
    "0xffe26a9300000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000fff9976782d46cc05630d1f6ebab18b2324d6b1400000000000000000000000000000000000000000000000000038d7ea4c68000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003c44cdddb6a900fa2b585dd299e03d12fa4293bc0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b53747564696f20686f7572000000000000000000000000000000000000000000"; // cast calldata vector
  assert.equal(listCalldata(newProductPlan(IN_WETH).plan).toLowerCase(), expected);
});

test("control: the same product priced in the payout asset does NOT produce those bytes", () => {
  assert.notEqual(listCalldata(newProductPlan(IN_USDC).plan).toLowerCase(), listCalldata(newProductPlan(IN_WETH).plan).toLowerCase());
});

// ---- what the two sides then read ------------------------------------------------------------------

const LISTED_WETH = {
  id: 7,
  name: "Studio hour",
  asset: WETH,
  price: "1000000000000000",
  symbol: "WETH",
  decimals: 18,
  kind: "one-off",
  active: true,
  sold: false,
  onlyBuyer: NOBODY,
  seller: PAYOUT_WALLET,
  payout: PAYOUT_WALLET,
};

test("the business's own list reads a WETH price as WETH, at eighteen places", () => {
  assert.equal(priceText(LISTED_WETH), "0.001 WETH");
  assert.equal(priceText({ ...LISTED_WETH, price: "25000000", symbol: "uUSD", decimals: 6 }), "25 uUSD");
});

test("the customer's card reads the same price, in the same asset, on every line it shows", () => {
  const card = productCard(LISTED_WETH, CONFIG);
  assert.equal(card.total, "0.001 WETH");
  assert.equal(card.line.amount, "0.001 WETH");
  assert.equal(card.pay.text, "0.001 WETH");
  assert.equal(card.receive.text, "0.001 WETH");
  assert.equal(card.pay.asset.decimals, 18);
});

test("a card whose product carried no label falls back to the deployment's, and to nothing after that", () => {
  const bare = { ...LISTED_WETH, symbol: null, decimals: null };
  assert.equal(productCard(bare, CONFIG).total, "0.001 WETH");
  // Control: with no entry to fall back on, the card shows NO price rather than a wrong one.
  assert.equal(productCard(bare, { assets: [] }).total, null);
});

// ---- the wiring, asserted in the files that carry it -------------------------------------------------

const route = readFileSync(join(APP, "src", "routes", "admin.mjs"), "utf8");
const script = readFileSync(join(APP, "assets", "products.js"), "utf8");

test("the form carries the chooser, its address box, and a price hint that follows them", () => {
  assert.match(route, /id: "product-asset"/);
  assert.match(route, /label: "You are paid in"/);
  assert.match(route, /id: "product-asset-address"/);
  // The sentence the document ships under the price box is the SAME one the script writes when
  // nothing has been chosen. Two places, one sentence, proven equal rather than kept in step by hand.
  assert.ok(route.includes(priceHint(null)), "the served price hint is not the one priceHint(null) writes");
  assert.equal(route.includes("In the asset you are paid in."), false, "the old fixed hint is still in the document");
});

test("the script fills the chooser from the deployment and prices against what it settled", () => {
  assert.match(script, /fillAssetChooser/);
  assert.match(script, /paidInOptions\(/);
  assert.match(script, /await assetChoice\(/);
  assert.match(script, /assetSaid\(chosen, \{ pasting, help: assetAddressHelp \}\)/);
  // The refusal must not go straight to the hidden node again. One call site, decided by assetSaid.
  assert.equal(/say\("product-asset-address-error", chosen\.ok \? "" : chosen\.error\)/.test(script), false);
  assert.match(script, /readAsset: assetReaderFor\(session\)/);
  assert.match(script, /asset: state\.asset\?\.address \?\? null/);
  assert.match(script, /decimals: state\.asset\?\.decimals \?\? null/);
  // The old behaviour — every product priced in the deployment's payout asset — is gone, not merely
  // shadowed. A leftover would quietly win on any path that still read it.
  assert.equal(/payoutAsset/.test(script), false, "the payout asset is still pinned somewhere in this screen");
});

/**
 * The blocker these rows exist for.
 *
 * `state.asset` is only ever assigned after an awaited read. Pressing Add blurs the address box,
 * which is what started that read — so a handler that read `state.asset` on the same tick read
 * whatever the PREVIOUS address had settled to, or nothing. A product would have been listed priced
 * in an asset the business had already replaced, and a listing's terms never move once it exists.
 *
 * These are assertions about the wiring in the file, not about a browser, and they are honest about
 * that: nothing here presses a real button. What they can prove is that the four things the fix is
 * made of are present and that the shape that raced is gone rather than merely shadowed.
 */
test("the Add handler waits for the read before it reads what the product is priced in", () => {
  assert.match(script, /await assetSettled\(\); \/\/ never read `state\.asset`/);
  // The wait must come FIRST in that handler. After the plan is built it would prove nothing.
  const handler = script.slice(script.indexOf('button.addEventListener("click"'));
  assert.ok(
    handler.indexOf("await assetSettled()") < handler.indexOf("newProductPlan({"),
    "the asset is read before the read it depends on has been waited for",
  );
});

test("a read still counting down is brought forward rather than waited out or skipped", () => {
  assert.match(script, /async function assetSettled\(\) \{[\s\S]*clearTimeout\(assetDebounce\)[\s\S]*beginSettle\(\)[\s\S]*await state\?\.settling;/);
  assert.match(script, /state\.settling = running/);
});

test("the address box is listened to on every keystroke, not only when it is left", () => {
  assert.match(script, /assetAddress\?\.addEventListener\("input"/);
  assert.match(script, /assetAddress\?\.addEventListener\("change"/);
  assert.match(script, /const ASSET_READ_DELAY = 300;/);
  // Typing drops the settled asset and closes Add, so the two can never disagree while a key is down.
  const typing = script.slice(script.indexOf('assetAddress?.addEventListener("input"'));
  assert.match(typing.slice(0, 600), /state\.asset = null/);
  assert.match(typing.slice(0, 600), /setAddReady\(false\)/);
});

test("control: the shape that raced is gone from the file, not merely shadowed by the new one", () => {
  // A leftover `void settleAsset()` on a listener would start a read nothing holds a promise to,
  // and Add would have nothing to wait for on exactly the path this fix is about.
  assert.equal(/addEventListener\("(change|input)", \(\) => void settleAsset\(\)\)/.test(script), false);
  assert.equal(/^\s*void settleAsset\(\);\s*$/m.test(script), false);
});

test("a product that was added clears what it was priced in, with the rest of the form", () => {
  const reset = script.slice(script.indexOf('is listed.`)'));
  assert.match(reset.slice(0, 900), /"product-asset-address"/);
  assert.match(reset.slice(0, 900), /chooser\.value = payoutChoice\(/);
  assert.match(reset.slice(0, 900), /state\.asset = null/);
  // ...and the read that follows is what puts the sentence under the price back in step with it.
  assert.match(reset.slice(0, 900), /await beginSettle\(\)/);
});

test("control: the asset is cleared in the same list as every other field, not a second one", () => {
  // Two lists would drift. The row above would still pass; this one would not.
  assert.match(
    script,
    /for \(const id of \["product-name", "product-price", "product-days", "product-buyer", "product-asset-address"\]\)/,
  );
});

test("control: an id this screen does not have is found in neither file", () => {
  assert.equal(route.includes("product-asset-currency"), false);
  assert.equal(script.includes("product-asset-currency"), false);
});
