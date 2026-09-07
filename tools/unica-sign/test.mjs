// UNICA V2 signing tool — the suite.
//
// Run: node tools/unica-sign/test.mjs
//
// NO KEY APPEARS HERE AND NONE IS NEEDED. Everything below is a digest, an encoding, or a refusal.
// The two "signatures" in the vectors are fixed-length filler so the calldata encoding is
// deterministic; they are named as filler and they sign nothing.
//
// The vectors are the quote that `test/fork/V2ForkSettlement.t.sol` actually settled, so
// `quoteDigest` is the digest a real settlement against the pinned Sepolia fork produced. Solidity
// re-derives every one of them in `test/v2/SigningVectors.t.sol`.

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

// ESM imports resolve relative to this FILE and are unaffected by chdir; readFileSync below is
// relative to the working directory, so the anchor is still needed. Two different rules in one
// file, and conflating them is how a tool ends up reading one tree and importing another.
import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {bytesFromHex, selectorOf, wordInt, wordUint} from "./abi.mjs";
import * as u from "./unica.mjs";

chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));

const V = JSON.parse(readFileSync("tools/unica-sign/vectors.json", "utf8"));
const env = {
  chainId: V.environment.chainId,
  permit2: V.environment.permit2,
  poolManager: V.environment.poolManager,
  nonce: BigInt(V.environment.permit2Nonce),
  deadline: BigInt(V.environment.permit2Deadline),
};
const quote = () => ({
  ...V.quote,
  maxIn: BigInt(V.quote.maxIn),
  amountOut: BigInt(V.quote.amountOut),
  deadline: BigInt(V.quote.deadline),
  pool: {...V.quote.pool},
});

let pass = 0;
let fail = 0;

// STREAMED, not buffered to the end. An earlier version collected every verdict and printed the
// lot at the finish, so a sabotage that made the encoder throw produced a stack trace and NO
// report at all — every row that had already passed vanished with it, and a grep for FAIL found
// nothing. A harness whose output disappears exactly when something breaks is worse than no
// harness. Each row prints as it happens, and the summary follows.
function check(name, cond, detail) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) {
    pass++;
  } else {
    fail++;
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${expected}\n        got      ${actual}`);

/// For a row whose subject can THROW. A throw is a failure with a reason, not a crash: without
/// this, an encoder that produces unreadable calldata takes the whole report down with it.
function guard(name, fn) {
  try {
    return fn();
  } catch (e) {
    check(name, false, `threw: ${e.message}`);
    return undefined;
  }
}

function throws(name, fn) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  check(name, threw, "expected a refusal and got a value");
}

// ---- the golden vectors ------------------------------------------------------------------------

console.log("UNICA V2 signing tool\n— golden vectors —");
const q = quote();
eq("pool key hash", u.hashPoolKey(q.pool), V.expected.poolKeyHash);
eq("quote struct hash", u.hashQuote(q), V.expected.quoteStructHash);
eq("UNICA domain separator", u.domainSeparator({chainId: env.chainId, executor: q.executor}), V.expected.unicaDomainSeparator);
eq("quote digest", u.quoteDigest(q, env), V.expected.quoteDigest);
eq("payment witness", u.paymentWitness(q, env), V.expected.paymentWitness);
eq("Permit2 domain separator", u.permit2DomainSeparator(env), V.expected.permit2DomainSeparator);
eq("Permit2 signing digest", u.permitDigest(q, env), V.expected.permitDigest);
eq("settle selector", u.SETTLE_SELECTOR, V.expected.settleSelector);
eq("settle selector derives from the signature", selectorOf(u.SETTLE_SIGNATURE), V.expected.settleSelector);
eq("hookData is empty", u.hookData(), "0x");

// ---- the two domains are not the same shape ----------------------------------------------------

check(
  "UNICA's domain has a version member and Permit2's does not",
  u.domainSeparator({chainId: env.chainId, executor: env.permit2}) !== u.permit2DomainSeparator(env),
  "the two domains collided, which means one of them is built wrong",
);

// ---- every signed field moves the digest --------------------------------------------------------

console.log("— every signed field is inside the digest —");
const base = u.quoteDigest(q, env);
const mutations = {
  version: {version: 2},
  quoteId: {quoteId: "0x" + "11".repeat(32)},
  merchantSigner: {merchantSigner: "0x000000000000000000000000000000000000dEaD"},
  payer: {payer: "0x000000000000000000000000000000000000dEaD"},
  recipient: {recipient: "0x000000000000000000000000000000000000dEaD"},
  tokenIn: {tokenIn: "0x000000000000000000000000000000000000dEaD"},
  maxIn: {maxIn: BigInt(V.quote.maxIn) + 1n},
  tokenOut: {tokenOut: "0x000000000000000000000000000000000000dEaD"},
  amountOut: {amountOut: BigInt(V.quote.amountOut) + 1n},
  zeroForOne: {zeroForOne: true},
  deadline: {deadline: BigInt(V.quote.deadline) + 1n},
  hook: {hook: "0x000000000000000000000000000000000000dEaD"},
  executor: {executor: "0x000000000000000000000000000000000000dEaD"},
  merchantConfigHash: {merchantConfigHash: "0x" + "22".repeat(32)},
  policyVersion: {policyVersion: 2},
};
for (const [field, over] of Object.entries(mutations)) {
  check(`${field} moves the quote digest`, u.quoteDigest({...q, ...over}, env) !== base, "this field is not inside the signature");
}
for (const [field, over] of Object.entries({
  "pool.currency0": {currency0: "0x000000000000000000000000000000000000dEaD"},
  "pool.currency1": {currency1: "0x000000000000000000000000000000000000dEaD"},
  "pool.fee": {fee: 500},
  "pool.tickSpacing": {tickSpacing: 10},
  "pool.hooks": {hooks: "0x000000000000000000000000000000000000dEaD"},
})) {
  check(`${field} moves the quote digest`, u.quoteDigest({...q, pool: {...q.pool, ...over}}, env) !== base);
}
check("a different chain moves the quote digest", u.quoteDigest(q, {...env, chainId: 1}) !== base);

console.log("— every field the payer authorises is inside the Permit2 digest —");
const pbase = u.permitDigest(q, env);
check("a different nonce moves it", u.permitDigest(q, {...env, nonce: 1n}) !== pbase);
check("a different authorisation deadline moves it", u.permitDigest(q, {...env, deadline: env.deadline + 1n}) !== pbase);
check("a different chain moves it", u.permitDigest(q, {...env, chainId: 1}) !== pbase);
check("a different DESTINATION moves it", u.permitDigest(q, {...env, poolManager: "0x000000000000000000000000000000000000dEaD"}) !== pbase);
check("a different ceiling moves it", u.permitDigest({...q, maxIn: q.maxIn + 1n}, env) !== pbase);
check("a different input token moves it", u.permitDigest({...q, tokenIn: "0x000000000000000000000000000000000000dEaD"}, env) !== pbase);
check("a different quote id moves it", u.permitDigest({...q, quoteId: "0x" + "33".repeat(32)}, env) !== pbase);
check("a different executor moves it", u.permitDigest({...q, executor: "0x000000000000000000000000000000000000dEaD"}, env) !== pbase);

// ---- calldata ------------------------------------------------------------------------------------

console.log("— calldata —");
const MSIG = V.placeholderSignatures.merchant;
const PSIG = V.placeholderSignatures.payer;
const auth = {nonce: env.nonce, deadline: env.deadline, signature: PSIG};
const calldata = u.encodeSettleCalldata(q, MSIG, auth);
check("calldata length", (calldata.length - 2) / 2 === V.expected.calldataLength, `${(calldata.length - 2) / 2}`);
eq("calldata hash", toHex(keccak256(bytesFromHex(calldata))), V.expected.calldataHash);
eq("calldata begins with the settle selector", calldata.slice(0, 10), V.expected.settleSelector);

const back = guard("calldata decodes at all", () => u.decodeSettleCalldata(calldata)) ?? {
  quote: {pool: {}},
  auth: {},
};
eq("round trip: quoteId", back.quote.quoteId, q.quoteId);
eq("round trip: recipient", back.quote.recipient.toLowerCase(), q.recipient.toLowerCase());
eq("round trip: maxIn", back.quote.maxIn.toString(), q.maxIn.toString());
eq("round trip: amountOut", back.quote.amountOut.toString(), q.amountOut.toString());
eq("round trip: tickSpacing", String(back.quote.pool.tickSpacing), String(q.pool.tickSpacing));
check("round trip: zeroForOne", back.quote.zeroForOne === q.zeroForOne);
eq("round trip: merchant signature", back.merchantSignature, MSIG);
eq("round trip: payer signature", back.auth.signature, PSIG);
eq("round trip: nonce", back.auth.nonce.toString(), auth.nonce.toString());
// The decoded quote must hash to the same digest as the one that was encoded. This is the property
// that matters: a round trip that loses a field would still "look" like a round trip.
eq(
  "round trip: the decoded quote hashes to the same digest",
  u.quoteDigest({...back.quote, pool: back.quote.pool}, env),
  base,
);

// ---- precision and normalisation --------------------------------------------------------------

console.log("— precision and normalisation —");
const HUGE = (1n << 256n) - 1n;
const huge = {...q, maxIn: HUGE, amountOut: HUGE};
const hugeBack = guard("large-amount calldata round-trips at all", () =>
  u.decodeSettleCalldata(u.encodeSettleCalldata(huge, MSIG, auth))) ?? {quote: {}};
eq("2^256-1 survives encoding", hugeBack.quote.maxIn.toString(), HUGE.toString());
eq("2^256-1 survives in amountOut", hugeBack.quote.amountOut.toString(), HUGE.toString());
check("2^256-1 changes the digest", u.quoteDigest(huge, env) !== base);

const upper = {...q, recipient: q.recipient.toUpperCase().replace("0X", "0x")};
eq("address casing does not change the digest", u.quoteDigest(upper, env), base);
eq("address casing does not change the calldata", u.encodeSettleCalldata(upper, MSIG, auth), calldata);

// A negative tick spacing is legal in a PoolKey and must encode as two's complement.
const negative = {...q, pool: {...q.pool, tickSpacing: -60}};
const negBack = guard("negative-tick calldata round-trips at all", () =>
  u.decodeSettleCalldata(u.encodeSettleCalldata(negative, MSIG, auth))) ?? {quote: {pool: {}}};
eq("a negative tickSpacing round-trips", String(negBack.quote.pool.tickSpacing), "-60");
eq("wordInt(-1) is two's complement", toHex(wordInt(-1)), "0x" + "ff".repeat(32));
eq("wordInt(-60) matches the EVM's encoding", toHex(wordInt(-60)), "0x" + "ff".repeat(31) + "c4");

// ---- it refuses what it cannot encode -------------------------------------------------------------

console.log("— refusals —");
throws("a quote missing a field is refused", () => {
  const broken = quote();
  delete broken.recipient;
  u.hashQuote(broken);
});
throws("a pool missing a field is refused", () => {
  const broken = quote();
  delete broken.pool.hooks;
  u.hashQuote(broken);
});
throws("an authorisation missing its signature is refused", () =>
  u.encodeSettleCalldata(q, MSIG, {nonce: 0n, deadline: 1n}));
throws("a 19-byte address is refused", () => u.hashQuote({...q, recipient: "0x11223344556677889900aabbccddeeff001122"}));
throws("a 31-byte bytes32 is refused", () => u.hashQuote({...q, quoteId: "0x" + "11".repeat(31)}));
throws("a negative amount is refused", () => wordUint(-1n));
throws("an amount past 2^256 is refused", () => wordUint(1n << 256n));
throws("odd-length hex is refused", () => bytesFromHex("0xabc"));
throws("calldata with the wrong selector is refused", () => u.decodeSettleCalldata("0xdeadbeef" + "00".repeat(64)));
throws("truncated calldata is refused", () => u.decodeSettleCalldata(calldata.slice(0, 200)));

// ---- the reviewable summary --------------------------------------------------------------------

console.log("— the summary a payer is asked to read —");
const s = u.summarize(q, env);
eq("the summary names the destination", s.THE_TOKENS_GO_TO, env.poolManager);
eq("the summary names the spending ceiling", s.THE_MOST_THIS_CAN_SPEND, `${q.maxIn.toString()} of ${q.tokenIn}`);
eq("the summary carries the quote digest", s.quoteDigest, base);
eq("the summary names the direction in words", s.direction, "oneForZero (currency1 in, currency0 out)");
check("the summary is exhaustive over the signed fields",
      ["chainId","poolManager","permit2","hook","executor","pool","direction","payer","merchantSigner",
       "recipient","tokenIn","maxIn","tokenOut","amountOut","quoteDeadline","quoteId","merchantConfigHash",
       "policyVersion","quoteDigest","permit2Nonce","permit2Deadline","hookData"].every((k) => k in s));
check("nothing in the summary looks like a private key",
      !JSON.stringify(s).match(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g)?.some((v) => v !== base && v !== q.quoteId && v !== q.merchantConfigHash),
      "an unexpected 32-byte value appears in the summary");

// ---- signing never touches a key ------------------------------------------------------------------

console.log("— signing is delegated, never performed —");
let sawDigest = null;
const fakeSigner = (digest) => {
  sawDigest = digest;
  return "0x" + "99".repeat(65);
};
const sig = await u.signQuote(q, env, fakeSigner);
eq("signQuote hands the caller exactly the digest", sawDigest, base);
eq("signQuote returns whatever the caller's signer returned", sig, "0x" + "99".repeat(65));
sawDigest = null;
await u.signPayment(q, env, fakeSigner);
eq("signPayment hands the caller the Permit2 digest", sawDigest, pbase);

const source = readFileSync("tools/unica-sign/unica.mjs", "utf8") + readFileSync("tools/unica-sign/abi.mjs", "utf8");
check("no module reads a private key from the environment",
      !/privateKey|PRIVATE_KEY|process\.env/.test(source),
      "this tool must never learn where a key lives");

console.log(`\nrows run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
