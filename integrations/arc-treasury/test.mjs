// The Arc treasury suite — offline, deterministic, no network, no key.
//
// Run: node integrations/arc-treasury/test.mjs
//
// WHAT THIS PROVES, and the order matters. The headline claim of this integration is that a native
// 18-decimal amount and an ERC-20 amount at the scale its own contract reports are different
// quantities that cannot be mixed. A test that only showed the guard refusing would be worthless —
// a function that throws on everything refuses correctly and is still broken. So every refusal row
// below is paired with a CONTROL row that must PASS, and the control is written first.
//
// THE SABOTAGE ROW IS THE CENTREPIECE. A native amount and a token amount holding the SAME INTEGER
// are constructed and compared. They must not be equal, must not add, and must not compare — and
// the same two numbers, taken as one kind, must add correctly. If the guard were removed, the
// control rows would still pass and the sabotage rows would go red, which is what makes them a test
// rather than a demonstration.
//
// NO NETWORK. The ArcClient here is driven by a recorded transport that THROWS on any request it
// has no recording for. An offline run therefore cannot impersonate a live one — and the transcript
// it replays holds the exact bytes the live chain returned, so the offline suite and live-check.mjs
// are checking the same thing.
//
// DETERMINISTIC. No Date.now(), no Math.random() anywhere in this file or in what it imports on the
// asserted paths. The clock is a parameter.
//
// STREAMED, and a throw becomes a NAMED failing row rather than killing the run — three other
// suites in this repository learned that the hard way.

import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {
  ARC_ERROR, ARC_MIN_MAX_FEE_PER_GAS_WEI, ARC_TESTNET_CHAIN_ID, ARC_TESTNET_RPC, ArcClient,
  BALANCE_OF_SELECTOR, PERMITTED_METHODS, SUBMISSION_OUTCOME, publicEndpoint, recordedTransport,
  requireArcFeeFloor, requireNonZeroRecipient,
} from "./arc.mjs";
import {
  ACTION, ALL_ACTIONS, ALL_REASONS, REASON, decide,
} from "./treasury.mjs";
import {
  PREVIEW_ERROR, REQUIRES_OWNER_SIGNATURE, TRANSFER_SELECTOR, buildPreview, decodeTransfer,
  encodeTransfer, isActionable, renderPreview,
} from "./preview.mjs";
import {
  DECIMALS_SELECTOR, NATIVE_DECIMALS, UNIT_ERROR, add, cmp, decodeDecimalsReturn, eq, formatFixed,
  gte, isNative, isToken, label, lt, nativeFromWei, nativeFromWhole, sub, sum, toNative,
  tokenAmount, tokenFromWhole,
} from "./units.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0, skip = 0;
const seenActions = new Set(), seenReasons = new Set();

function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else { fail++; if (detail !== undefined) console.log(`        ${detail}`); }
}
function eqv(name, actual, expected) {
  check(name, actual === expected, `expected ${expected}\n        got      ${actual}`);
}
/// Assert that a call refuses with an exact code. The code, not the message: a refusal whose
/// identity is a substring of prose is a refusal that silently changes meaning when the prose is
/// reworded.
function refuses(name, code, fn) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (threw === null) return check(name, false, `expected refusal ${code}, nothing was thrown`);
  return check(name, threw.code === code, `expected code ${code}\n        got      ${threw.code} (${threw.message})`);
}
async function refusesAsync(name, code, fn) {
  let threw = null;
  try { await fn(); } catch (e) { threw = e; }
  if (threw === null) return check(name, false, `expected refusal ${code}, nothing was thrown`);
  return check(name, threw.code === code, `expected code ${code}\n        got      ${threw.code} (${threw.message})`);
}
function guard(name, fn) {
  try { return fn(); } catch (e) { check(name, false, `threw: ${e.code ?? ""} ${e.message}`); return undefined; }
}
/// Record which members of the closed vocabularies a row actually exercised, so the coverage
/// assertion at the end is measured rather than claimed.
function observe(d) { seenActions.add(d.action); seenReasons.add(d.reason); return d; }

// The live transcript. These are the exact strings the Arc RPC returned; live-check.mjs re-derives
// them against the chain. Loading them from a file rather than inlining them means the offline
// suite and the live check cannot drift apart silently.
const T = JSON.parse(readFileSync(resolve(HERE, "transcript.json"), "utf8"));

const ARC_USDC = T.observed.erc20Usdc.address;
const EMITTER = T.observed.systemEmitter.address;
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const MALLORY = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";

// The scale, decoded from the word the Arc USDC contract actually returned. Every token amount in
// this file stands on it, so nothing here can be built on an assumed 6.
const SIX = decodeDecimalsReturn(T.observed.erc20Usdc.decimalsReturn, {
  token: ARC_USDC, source: "recorded eth_call decimals() @ rpc.testnet.arc.io",
  blockNumber: T.observed.blockNumber,
});

const GAS_PRICE = BigInt(T.observed.gasPrice);
const GAS_LIMIT = 65000n;
const GAS_BUDGET = nativeFromWei(GAS_LIMIT * GAS_PRICE);

// =================================================================================================
console.log("Arc treasury — the decimal law\n— a native 18dp amount and an ERC-20 amount are different quantities —");

eqv("the ERC-20 on Arc reports its own decimals, and it is 6", SIX.decimals, 6);
eqv("the native representation is 18dp, and that is the only hard-coded scale", NATIVE_DECIMALS, 18);
eqv("the scale carries the raw word it was decoded from", SIX.raw, T.observed.erc20Usdc.decimalsReturn);
eqv("the scale carries the contract it was read from", SIX.token, ARC_USDC.toLowerCase());

// ---- CONTROL FIRST. Same kind, adds correctly. -------------------------------------------------
// Written before the sabotage rows on purpose: if these do not pass, the sabotage rows below prove
// nothing at all, because a module that refuses every operation would satisfy them.
const oneTokenA = tokenFromWhole(1, SIX);            // 1.000000 ERC-20  = 1_000_000 units
const oneTokenB = tokenFromWhole(1, SIX);
const oneNativeA = nativeFromWhole(1);               // 1.0 native       = 10^18 wei
const oneNativeB = nativeFromWhole(1);

eqv("CONTROL token + token adds", guard("t+t", () => add(oneTokenA, oneTokenB).units), 2_000_000n);
eqv("CONTROL native + native adds", guard("n+n", () => add(oneNativeA, oneNativeB).wei), 2n * 10n ** 18n);
eqv("CONTROL token == token compares equal", guard("t==t", () => eq(oneTokenA, oneTokenB)), true);
eqv("CONTROL native == native compares equal", guard("n==n", () => eq(oneNativeA, oneNativeB)), true);
eqv("CONTROL token sub works", guard("t-t", () => sub(tokenFromWhole(5, SIX), tokenFromWhole(2, SIX)).units), 3_000_000n);
eqv("CONTROL sum of one kind works", guard("sum", () => sum([oneTokenA, oneTokenB, oneTokenA]).units), 3_000_000n);

// ---- THE SABOTAGE ROW. Same integer, different kinds. ------------------------------------------
// 1_000_000 as a token quantity at 6dp is one whole USDC. 1_000_000 wei of the native currency is
// 0.000000000001 USDC. Identical integers, twelve orders of magnitude apart in value. This is the
// exact confusion the corrected ARC-FACTS row is about.
const faceToken = tokenAmount(1_000_000n, SIX);
const faceNative = nativeFromWei(1_000_000n);
eqv("the two carry the SAME integer", faceToken.units === faceNative.wei, true);
eqv("  …and mean different values: token reads", formatFixed(faceToken.units, faceToken.decimals), "1.000000");
eqv("  …and native reads", formatFixed(faceNative.wei, NATIVE_DECIMALS), "0.000000000001000000");
refuses("SABOTAGE equal integers, different kinds, must NOT compare", UNIT_ERROR.UNIT_KIND_MISMATCH, () => cmp(faceToken, faceNative));
refuses("SABOTAGE equal integers, different kinds, must NOT add", UNIT_ERROR.UNIT_KIND_MISMATCH, () => add(faceToken, faceNative));
refuses("SABOTAGE equal integers, different kinds, must NOT subtract", UNIT_ERROR.UNIT_KIND_MISMATCH, () => sub(faceToken, faceNative));
refuses("SABOTAGE eq() on mixed kinds refuses rather than answering false", UNIT_ERROR.UNIT_KIND_MISMATCH, () => eq(faceToken, faceNative));
refuses("SABOTAGE gte() on mixed kinds refuses", UNIT_ERROR.UNIT_KIND_MISMATCH, () => gte(faceNative, faceToken));
refuses("SABOTAGE sum() of a mixed list refuses", UNIT_ERROR.UNIT_KIND_MISMATCH, () => sum([oneTokenA, oneNativeA]));

// The whole-unit form of the same trap: "1 USDC" of each kind.
refuses("SABOTAGE one whole ERC-20 vs one whole native refuses", UNIT_ERROR.UNIT_KIND_MISMATCH, () => cmp(oneTokenA, oneNativeA));

// ---- THE DECISIVE ROW, offline, from the recorded chain reads ----------------------------------
// One account on Arc, one pot of money, both representations. The ERC-20 turns out to be a
// 6-decimal view of the same balance eth_getBalance reports at 18, so native / 10^12 == token
// exactly. This is the recorded twin of the row live-check.mjs re-derives against the chain.
const SAME = T.observed.sameAccountBothRepresentations;
const nativeOfZero = nativeFromWei(SAME.nativeWei);
const tokenOfZero = tokenAmount(BigInt(SAME.tokenUnits), SIX);
eqv("one Arc account: the ERC-20 balance is the native balance divided by 10^12",
  (nativeOfZero.wei / 10n ** 12n) === tokenOfZero.units, true);
eqv("  the native figure has 27 digits", nativeOfZero.wei.toString().length, 27);
eqv("  the token figure has 15 digits", tokenOfZero.units.toString().length, 15);
eqv("  both render as the same human amount at their OWN scales",
  formatFixed(tokenOfZero.units, 6), formatFixed(nativeOfZero.wei, 18).slice(0, formatFixed(tokenOfZero.units, 6).length));
eqv("  reading the token at 18dp understates the holding to near zero",
  formatFixed(tokenOfZero.units, 18), "0.000865034306417121");
refuses("SABOTAGE the two live balances refuse to add, though they are the same money",
  UNIT_ERROR.UNIT_KIND_MISMATCH, () => add(nativeOfZero, tokenOfZero));

// =================================================================================================
console.log("\n— a scale must be READ; there is no default —");

refuses("a bare number is not a scale", UNIT_ERROR.DECIMALS_NOT_READ, () => tokenAmount(1n, 6));
refuses("a bare 18 is not a scale either (the overclaim, refused by construction)", UNIT_ERROR.DECIMALS_NOT_READ, () => tokenAmount(1n, 18));
refuses("an object shaped like a scale is not a scale", UNIT_ERROR.DECIMALS_NOT_READ, () => tokenAmount(1n, {decimals: 6, token: ARC_USDC}));
refuses("null is not a scale", UNIT_ERROR.DECIMALS_NOT_READ, () => tokenAmount(1n, null));
refuses("tokenFromWhole refuses a bare number too", UNIT_ERROR.DECIMALS_NOT_READ, () => tokenFromWhole(1, 6));

// The Arc case, exactly: an address with zero bytes of code returns empty and that is NAMED.
refuses("empty return from a codeless address is a named refusal, not a fallback",
  UNIT_ERROR.DECIMALS_EMPTY_RETURN,
  () => decodeDecimalsReturn(T.observed.systemEmitter.decimalsReturn, {token: EMITTER}));
eqv("  …and the observed emitter return really is empty", T.observed.systemEmitter.decimalsReturn, "0x");
eqv("  …and the observed emitter really has zero bytes of code", T.observed.systemEmitter.code, "0x");
refuses("a short return is malformed, not zero", UNIT_ERROR.DECIMALS_MALFORMED_RETURN, () => decodeDecimalsReturn("0x06", {token: ARC_USDC}));
refuses("a non-hex return is malformed", UNIT_ERROR.DECIMALS_MALFORMED_RETURN, () => decodeDecimalsReturn("six", {token: ARC_USDC}));
refuses("an absurd scale is out of range", UNIT_ERROR.DECIMALS_OUT_OF_RANGE, () => decodeDecimalsReturn("0x" + (200).toString(16).padStart(64, "0"), {token: ARC_USDC}));
// CONTROL for the three rows above: a well-formed word decodes.
eqv("CONTROL a well-formed word decodes to its number", guard("decode", () => decodeDecimalsReturn("0x" + (18).toString(16).padStart(64, "0"), {token: ARC_USDC}).decimals), 18);

// sub() must REFUSE rather than clamp. units.mjs says in prose that a clamp "would silently turn
// 'we cannot afford this' into 'we paid zero'" — and nothing asserted it, so replacing the refusal
// with `return rebuild(a, 0n)` left all 162 rows green. These two rows are that sabotage, caught.
refuses("sub() refuses to go negative rather than clamping to zero (token)", UNIT_ERROR.MALFORMED_AMOUNT,
  () => sub(tokenFromWhole(1, SIX), tokenFromWhole(2, SIX)));
refuses("sub() refuses to go negative rather than clamping to zero (native)", UNIT_ERROR.MALFORMED_AMOUNT,
  () => sub(nativeFromWhole(1), nativeFromWhole(2)));

// Two readings of the same token disagreeing is a fault, never an average.
const EIGHTEEN_SAME_TOKEN = decodeDecimalsReturn("0x" + (18).toString(16).padStart(64, "0"), {token: ARC_USDC, source: "a second, disagreeing reading"});
refuses("two disagreeing scales for ONE token refuse rather than averaging", UNIT_ERROR.SCALE_MISMATCH,
  () => add(tokenAmount(1n, SIX), tokenAmount(1n, EIGHTEEN_SAME_TOKEN)));
const OTHER_TOKEN = decodeDecimalsReturn(T.observed.erc20Usdc.decimalsReturn, {token: MALLORY, source: "a different token"});
const EIGHTEEN_OTHER_TOKEN = decodeDecimalsReturn("0x" + (18).toString(16).padStart(64, "0"), {token: MALLORY, source: "an 18dp token"});
refuses("two different tokens refuse to add", UNIT_ERROR.TOKEN_MISMATCH,
  () => add(tokenAmount(1n, SIX), tokenAmount(1n, OTHER_TOKEN)));

// =================================================================================================
console.log("\n— the conversion exists, and is deliberately awkward —");

eqv("CONTROL a correct conversion rescales by 10^12",
  guard("conv", () => toNative(tokenFromWhole(1, SIX), {
    statedTokenDecimals: 6, statedNativeDecimals: 18,
    rationale: "On Arc the native gas currency and this ERC-20 are both USDC, so one token unit is one native unit of value.",
  }).wei),
  10n ** 18n);
refuses("a wrong stated token scale is caught", UNIT_ERROR.STATED_SCALE_DISAGREES_WITH_READING,
  () => toNative(tokenFromWhole(1, SIX), {statedTokenDecimals: 18, statedNativeDecimals: 18, rationale: "both are USDC on Arc"}));
refuses("a wrong stated native scale is caught", UNIT_ERROR.STATED_SCALE_DISAGREES_WITH_READING,
  () => toNative(tokenFromWhole(1, SIX), {statedTokenDecimals: 6, statedNativeDecimals: 6, rationale: "both are USDC on Arc"}));
refuses("a conversion with no rationale is refused", UNIT_ERROR.CONVERSION_RATIONALE_REQUIRED,
  () => toNative(tokenFromWhole(1, SIX), {statedTokenDecimals: 6, statedNativeDecimals: 18}));
refuses("converting a native amount is not a thing", UNIT_ERROR.UNIT_KIND_MISMATCH,
  () => toNative(nativeFromWhole(1), {statedTokenDecimals: 6, statedNativeDecimals: 18, rationale: "both are USDC on Arc"}));
// A uint8 decimals() can legitimately exceed 18, and the shift would then be a negative BigInt
// exponent: a bare RangeError with no code, outside the closed refusal set. Named instead.
const TWENTY_FOUR = decodeDecimalsReturn("0x" + (24).toString(16).padStart(64, "0"), {token: MALLORY, source: "a 24dp token"});
refuses("a token read wider than the native 18dp refuses by name, not with a RangeError",
  UNIT_ERROR.TOKEN_SCALE_WIDER_THAN_NATIVE,
  () => toNative(tokenAmount(1n, TWENTY_FOUR), {statedTokenDecimals: 24, statedNativeDecimals: 18, rationale: "both are USDC on Arc"}));
eqv("CONTROL an 18dp token still converts (shift of zero)",
  guard("18dp conv", () => toNative(tokenAmount(5n, EIGHTEEN_OTHER_TOKEN), {
    statedTokenDecimals: 18, statedNativeDecimals: 18, rationale: "one unit of this token is one native unit",
  }).wei), 5n);

eqv("a label always names its representation (token)", label(tokenFromWhole(1, SIX)).includes("6dp as read"), true);
eqv("a label always names its representation (native)", label(nativeFromWhole(1)).includes("18dp"), true);

// =================================================================================================
console.log("\n— the Arc client is read-only by construction —");

const transport = recordedTransport(T.recordings);
const client = () => new ArcClient({transport});

eqv("the permitted method list contains only reads",
  PERMITTED_METHODS.every((m) => /^eth_(chainId|blockNumber|getBalance|getCode|call|gasPrice|estimateGas|getLogs|getTransactionCount)$/.test(m)), true);
eqv("no write method is permitted",
  PERMITTED_METHODS.some((m) => /send|sign|account|unlock|personal/i.test(m)), false);
await refusesAsync("eth_sendRawTransaction is refused before a request is built", ARC_ERROR.METHOD_NOT_PERMITTED,
  () => client().call("eth_sendRawTransaction", ["0xdeadbeef"]));
await refusesAsync("eth_sendTransaction is refused too", ARC_ERROR.METHOD_NOT_PERMITTED,
  () => client().call("eth_sendTransaction", [{}]));
await refusesAsync("eth_sign is refused", ARC_ERROR.METHOD_NOT_PERMITTED, () => client().call("eth_sign", []));
refuses("a client cannot be built without an explicit transport", ARC_ERROR.TRANSPORT_UNAVAILABLE, () => new ArcClient({}));

eqv("CONTROL a permitted read works against the recorded transcript",
  await guard("chainId", async () => client().chainId()), ARC_TESTNET_CHAIN_ID);

// A scale read from one contract must not label a balance read from another. preview.mjs already
// refused that pairing at the ENCODE; this is the earlier door, at the READ, where the mislabelled
// TokenAmount is actually minted. Without it a balanceOf against any address could be dressed in
// the Arc USDC scale and would look identical to a real reading.
await refusesAsync("a balance cannot be read at a scale belonging to another token",
  ARC_ERROR.SCALE_READ_FROM_ANOTHER_TOKEN,
  () => client().tokenBalance(MALLORY, ZERO, SIX));
await refusesAsync("  …and a missing scale is refused rather than defaulted",
  ARC_ERROR.SCALE_READ_FROM_ANOTHER_TOKEN,
  () => client().tokenBalance(ARC_USDC, ZERO, null));
eqv("CONTROL the matching scale reads the recorded balance",
  await guard("balance", async () => (await client().tokenBalance(ARC_USDC, ZERO, SIX)).units),
  BigInt(T.observed.sameAccountBothRepresentations.tokenUnits));

// The endpoint may be overridden, and the ordinary shape of a private endpoint is a public host
// with a project key in the path. Only the origin is ever rendered — into a printed line, into a
// TokenScale's source, and from there into the preview artifact and the served JSON.
eqv("an endpoint renders as its origin only", publicEndpoint("https://rpc.example.io/v2/KEY?apikey=SECRET"), "https://rpc.example.io");
eqv("  …userinfo is dropped too", publicEndpoint("https://user:pw@rpc.example.io/v2/KEY"), "https://rpc.example.io");
eqv("  …and a path key never survives", publicEndpoint("https://rpc.example.io/v2/KEY").includes("KEY"), false);
eqv("CONTROL the default public endpoint is unchanged by redaction", publicEndpoint(ARC_TESTNET_RPC), ARC_TESTNET_RPC);
eqv("an unparseable endpoint is withheld, not echoed", publicEndpoint("KEY-NOT-A-URL").includes("KEY"), false);
eqv("CONTROL requireArc passes on Arc", await guard("requireArc", async () => client().requireArc()), ARC_TESTNET_CHAIN_ID);
await refusesAsync("requireArc refuses a non-Arc chain id", ARC_ERROR.WRONG_CHAIN, () => {
  const sepolia = new ArcClient({transport: recordedTransport({"eth_chainId([])": "0xaa36a7"})});
  return sepolia.requireArc();
});
await refusesAsync("an unrecorded request is refused, never invented", ARC_ERROR.TRANSPORT_UNAVAILABLE,
  () => client().call("eth_getBalance", ["0x9999999999999999999999999999999999999999", "latest"]));

// The two Arc divergences that are preconditions rather than outcomes.
eqv("CONTROL a fee at the floor is accepted", guard("floor", () => requireArcFeeFloor(ARC_MIN_MAX_FEE_PER_GAS_WEI)), ARC_MIN_MAX_FEE_PER_GAS_WEI);
eqv("CONTROL the observed gas price clears the floor", guard("obs", () => requireArcFeeFloor(GAS_PRICE)), GAS_PRICE);
refuses("a fee one wei under the floor is refused", ARC_ERROR.MAX_FEE_BELOW_ARC_FLOOR, () => requireArcFeeFloor(ARC_MIN_MAX_FEE_PER_GAS_WEI - 1n));
refuses("an Ethereum-shaped 1 Gwei fee is refused", ARC_ERROR.MAX_FEE_BELOW_ARC_FLOOR, () => requireArcFeeFloor(1_000_000_000n));
eqv("CONTROL a normal recipient is accepted", guard("nz", () => requireNonZeroRecipient(BOB)), BOB);
refuses("a send to address(0) is refused before it is built", ARC_ERROR.ZERO_ADDRESS_REFUSED, () => requireNonZeroRecipient(ZERO));

// A codeless address has no decimals() to read, and that is its own named refusal.
await refusesAsync("reading a scale from a codeless address refuses by name", ARC_ERROR.NO_CODE_AT_ADDRESS,
  () => client().readTokenScale(EMITTER));
const liveScale = await guard("readTokenScale", async () => client().readTokenScale(ARC_USDC));
eqv("CONTROL reading a scale from the real ERC-20 works, and returns 6", liveScale?.decimals, 6);
eqv("  …and records the block it was read at", liveScale?.blockNumber, T.observed.blockNumber);

// "No receipt" and "not submitted" are different facts, and nothing collapses them.
eqv("a blocklist revert has its own outcome, distinct from NOT_SUBMITTED",
  SUBMISSION_OUTCOME.BROADCAST_NO_RECEIPT_GAS_CONSUMED !== SUBMISSION_OUTCOME.NOT_SUBMITTED, true);
eqv("  …and a mempool rejection is distinct from both",
  new Set([SUBMISSION_OUTCOME.NOT_SUBMITTED, SUBMISSION_OUTCOME.REJECTED_BY_MEMPOOL, SUBMISSION_OUTCOME.BROADCAST_NO_RECEIPT_GAS_CONSUMED]).size, 3);

// =================================================================================================
console.log("\n— the policy: one bounded action, every branch —");

const APPROVED = [BOB];
const basePolicy = (over = {}) => ({
  reserveFloor: tokenFromWhole(250, SIX),
  perActionCap: tokenFromWhole(500, SIX),
  cooldownSeconds: 3600n,
  approvedCounterparties: APPROVED,
  gasBudget: GAS_BUDGET,
  ...over,
});
const basePosition = (over = {}) => ({
  operatingBalance: tokenFromWhole(1000, SIX),
  nativeBalance: nativeFromWhole(1),
  reserveSource: null,
  ...over,
});
const late = {now: 1_000_000n, lastActionAt: 0n};      // cooldown long elapsed
const soon = {now: 1_000_000n, lastActionAt: 999_000n}; // 1000s elapsed, under the 3600s cooldown
const pay = (amountWhole, to = BOB) => ({recipient: to, amount: tokenFromWhole(amountWhole, SIX)});

// --- NO_ACTION
let d = observe(decide(basePosition(), basePolicy(), null, late));
eqv("above the floor with nothing requested -> NO_ACTION", d.action, ACTION.NO_ACTION);
eqv("  reason", d.reason, REASON.ABOVE_RESERVE_NOTHING_REQUESTED);

// --- RELEASE_APPROVED_PAYMENT (the control for every refusal below)
d = observe(decide(basePosition(), basePolicy(), pay(400), late));
eqv("CONTROL an in-policy payment -> RELEASE_APPROVED_PAYMENT", d.action, ACTION.RELEASE_APPROVED_PAYMENT);
eqv("  reason", d.reason, REASON.WITHIN_ALL_LIMITS);
eqv("  the amount is carried at the READ scale", d.amount?.decimals, 6);
eqv("  the amount is the requested one, unrescaled", d.amount?.units, 400_000_000n);
eqv("  the balance after is computed in the same kind", d.balanceAfter?.units, 600_000_000n);

// --- refusals, each one a single-variable change from that control
d = observe(decide(basePosition(), basePolicy(), pay(400, MALLORY), late));
eqv("an unapproved counterparty -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.COUNTERPARTY_NOT_APPROVED);

d = observe(decide(basePosition(), basePolicy(), pay(600), late));
eqv("above the per-action cap -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.ABOVE_PER_ACTION_CAP);

d = observe(decide(basePosition({operatingBalance: tokenFromWhole(300, SIX)}), basePolicy(), pay(100), late));
eqv("a payment that would breach the reserve -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.WOULD_BREACH_RESERVE);

d = observe(decide(basePosition({operatingBalance: tokenFromWhole(400, SIX)}), basePolicy({perActionCap: tokenFromWhole(5000, SIX), reserveFloor: tokenFromWhole(1, SIX)}), pay(450), late));
eqv("a payment above the balance -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.INSUFFICIENT_BALANCE);

d = observe(decide(basePosition(), basePolicy(), pay(400), soon));
eqv("inside the cooldown -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.COOLDOWN_NOT_ELAPSED);

d = observe(decide(basePosition(), basePolicy(), pay(0), late));
eqv("a zero-value payment -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.ZERO_AMOUNT_REQUESTED);

d = observe(decide(basePosition(), basePolicy(), pay(400, ZERO), late));
eqv("a payment to address(0) -> REFUSED (Arc reverts these)", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.ZERO_ADDRESS_RECIPIENT);

// --- THE ARC BRANCH: rich in ERC-20, broke in gas.
// This is the row the type system exists for. The merchant holds 1000 USDC as an ERC-20 and has
// almost no native currency. Code that added the two would see a healthy treasury.
d = observe(decide(basePosition({nativeBalance: nativeFromWei(1n)}), basePolicy(), pay(400), late));
eqv("1000 ERC-20 USDC and 1 wei of native -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason is the gas one, not a balance one", d.reason, REASON.INSUFFICIENT_NATIVE_FOR_GAS);
eqv("  …and the explanation names both representations",
  d.explanation.includes("native") && d.explanation.includes("ERC-20"), true);
// CONTROL: the identical position with gas money goes through, proving the refusal was about gas.
d = decide(basePosition({nativeBalance: GAS_BUDGET}), basePolicy(), pay(400), late);
eqv("CONTROL the same position with exactly the gas budget is released", d.action, ACTION.RELEASE_APPROVED_PAYMENT);

// --- below the floor
d = observe(decide(basePosition({operatingBalance: tokenFromWhole(100, SIX)}), basePolicy(), pay(10), late));
eqv("below the floor with no source -> HOLD_BELOW_RESERVE", d.action, ACTION.HOLD_BELOW_RESERVE);
eqv("  reason", d.reason, REASON.BELOW_RESERVE_NO_SOURCE);
eqv("  the shortfall is exact", d.shortfall?.units, 150_000_000n);

d = observe(decide(basePosition({operatingBalance: tokenFromWhole(100, SIX), reserveSource: tokenFromWhole(10, SIX)}), basePolicy(), null, late));
eqv("below the floor, source too small -> HOLD_BELOW_RESERVE", d.action, ACTION.HOLD_BELOW_RESERVE);
eqv("  reason", d.reason, REASON.BELOW_RESERVE_SOURCE_INSUFFICIENT);

d = observe(decide(basePosition({operatingBalance: tokenFromWhole(100, SIX), reserveSource: tokenFromWhole(900, SIX)}), basePolicy(), null, late));
eqv("below the floor with a sufficient source -> RESTORE_MINIMUM_RESERVE", d.action, ACTION.RESTORE_MINIMUM_RESERVE);
eqv("  reason", d.reason, REASON.BELOW_RESERVE_SOURCE_AVAILABLE);
eqv("  it moves EXACTLY the shortfall and no more", d.amount?.units, 150_000_000n);

d = observe(decide(basePosition({operatingBalance: tokenFromWhole(100, SIX), reserveSource: tokenFromWhole(900, SIX), nativeBalance: nativeFromWei(1n)}), basePolicy(), null, late));
eqv("a restore with no gas money -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.INSUFFICIENT_NATIVE_FOR_GAS);

// --- the guard firing on real policy inputs, not only in a unit test
d = observe(decide(basePosition({operatingBalance: nativeFromWhole(1000)}), basePolicy(), pay(400), late));
eqv("a NATIVE amount passed as the operating balance -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason names the kind mismatch", d.reason, REASON.UNIT_KIND_MISMATCH);

d = observe(decide(basePosition({nativeBalance: tokenFromWhole(1, SIX)}), basePolicy(), pay(400), late));
eqv("an ERC-20 amount passed as the gas balance -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.UNIT_KIND_MISMATCH);

d = observe(decide(basePosition(), basePolicy({reserveFloor: tokenAmount(250_000_000n, EIGHTEEN_SAME_TOKEN)}), pay(400), late));
eqv("a reserve floor read at a different scale -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason is the scale mismatch, not a comparison", d.reason, REASON.SCALE_MISMATCH);

d = observe(decide(basePosition(), basePolicy({reserveFloor: tokenFromWhole(250, OTHER_TOKEN)}), pay(400), late));
eqv("a reserve floor denominated in a DIFFERENT token -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason is the token mismatch", d.reason, REASON.TOKEN_MISMATCH);

d = observe(decide(basePosition(), basePolicy({gasBudget: tokenFromWhole(1, SIX)}), pay(400), late));
eqv("a gas budget denominated in the ERC-20 -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.MALFORMED_POLICY);

d = observe(decide(null, basePolicy(), null, late));
eqv("no position at all -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.MALFORMED_POSITION);
d = observe(decide(basePosition(), null, null, late));
eqv("no policy at all -> REFUSED", d.action, ACTION.REFUSED);
eqv("  reason", d.reason, REASON.MALFORMED_POLICY);
d = observe(decide(basePosition(), basePolicy(), {recipient: "not-an-address", amount: tokenFromWhole(1, SIX)}, late));
eqv("a malformed recipient -> REFUSED", d.action, ACTION.REFUSED);

// --- determinism
const twice = [1, 2].map(() => decide(basePosition(), basePolicy(), pay(400), late));
eqv("the same inputs give the same action twice", twice[0].action, twice[1].action);
eqv("  …and the same amount", twice[0].amount.units, twice[1].amount.units);

// =================================================================================================
console.log("\n— the preview: exact shape, and no way to send it —");

const good = decide(basePosition(), basePolicy(), pay(400), late);
const preview = guard("buildPreview", () => buildPreview(good, {
  from: ALICE, nonce: 7, maxFeePerGas: GAS_PRICE, gasLimit: GAS_LIMIT,
  gasEstimate: {source: "recorded eth_estimateGas"},
}));

eqv("the artifact names itself", preview?.kind, "ARC_TREASURY_TRANSACTION_PREVIEW");
eqv("chainId is Arc's", preview?.transaction.chainId, ARC_TESTNET_CHAIN_ID);
eqv("`to` is the TOKEN contract, not the recipient", preview?.transaction.to, ARC_USDC.toLowerCase());
eqv("`value` is zero — an ERC-20 transfer moves no native currency", preview?.transaction.value, "0x0");
eqv("`value` is labelled with its representation", preview?.transaction.valueRepresentation.includes("18dp"), true);
eqv("the selector is transfer(address,uint256)", TRANSFER_SELECTOR, "0xa9059cbb");
eqv("the calldata carries the recipient", preview?.decoded.recipient, BOB.toLowerCase());
eqv("the calldata carries the raw units", preview?.decoded.units, "400000000");
eqv("the decoded amount is rendered at the READ scale", preview?.decoded.humanAmount, "400.000000");
eqv("the artifact records where the scale came from", preview?.decoded.tokenDecimalsSource.includes("decimals()"), true);
eqv("the artifact records the raw decimals word", preview?.decoded.tokenDecimalsRawReturn, T.observed.erc20Usdc.decimalsReturn);
eqv("the artifact records the block the scale was read at", preview?.decoded.tokenDecimalsReadAtBlock, T.observed.blockNumber);
eqv("the gas cost is stated in the native representation", preview?.gasEstimate.maxCostNative.kind, "NATIVE");
eqv("  …at 18 decimals", preview?.gasEstimate.maxCostNative.decimals, 18);
eqv("the Arc mempool floor is stated in the artifact", preview?.gasEstimate.arcMempoolFloorWei, ARC_MIN_MAX_FEE_PER_GAS_WEI.toString());
eqv("the owner-signature marker is present and true", preview?.[REQUIRES_OWNER_SIGNATURE], true);
eqv("the artifact is frozen", Object.isFrozen(preview), true);

// Number(null) is 0, so an unstated nonce was rendering as a real nonce of 0 — a default standing
// in for a value nobody supplied. server.mjs passes exactly `nonce: null`.
const noNonce = guard("preview without a nonce", () => buildPreview(good, {
  from: ALICE, nonce: null, maxFeePerGas: GAS_PRICE, gasLimit: GAS_LIMIT,
}));
eqv("a nonce nobody stated stays null and is never rendered as 0", noNonce?.transaction.nonce, null);
eqv("  …and the handoff asks the owner for it", renderPreview(noNonce).includes("(owner to supply)"), true);
eqv("CONTROL a stated nonce is carried through", preview?.transaction.nonce, 7);

// The decode is a genuine round-trip of the bytes, so an encoder bug would show here.
const rt = guard("round-trip", () => decodeTransfer(preview.transaction.data));
eqv("round-trip: recipient", rt?.to, BOB.toLowerCase());
eqv("round-trip: units", rt?.units, 400_000_000n);
eqv("CONTROL encodeTransfer/decodeTransfer agree on a fresh value",
  guard("rt2", () => decodeTransfer(encodeTransfer(BOB, 123456n)).units), 123456n);
refuses("decodeTransfer rejects foreign calldata", PREVIEW_ERROR.MALFORMED_DECISION, () => decodeTransfer("0xdeadbeef"));
refuses("encodeTransfer refuses address(0)", ARC_ERROR.ZERO_ADDRESS_REFUSED, () => encodeTransfer(ZERO, 1n));

// A preview may only exist for a decision that corresponds to a transaction.
eqv("NO_ACTION is not actionable", isActionable(decide(basePosition(), basePolicy(), null, late)), false);
refuses("previewing a NO_ACTION is an error, not an empty artifact", PREVIEW_ERROR.NOT_ACTIONABLE,
  () => buildPreview(decide(basePosition(), basePolicy(), null, late), {maxFeePerGas: GAS_PRICE, gasLimit: GAS_LIMIT}));
refuses("previewing a REFUSED decision is an error", PREVIEW_ERROR.NOT_ACTIONABLE,
  () => buildPreview(decide(basePosition(), basePolicy(), pay(400, MALLORY), late), {maxFeePerGas: GAS_PRICE, gasLimit: GAS_LIMIT}));
refuses("previewing a HOLD_BELOW_RESERVE is an error", PREVIEW_ERROR.NOT_ACTIONABLE,
  () => buildPreview(decide(basePosition({operatingBalance: tokenFromWhole(1, SIX)}), basePolicy(), null, late), {maxFeePerGas: GAS_PRICE, gasLimit: GAS_LIMIT}));
refuses("a preview under the Arc fee floor is refused", ARC_ERROR.MAX_FEE_BELOW_ARC_FLOOR,
  () => buildPreview(good, {maxFeePerGas: 1_000_000_000n, gasLimit: GAS_LIMIT}));
refuses("a preview for another chain is refused", PREVIEW_ERROR.MALFORMED_DECISION,
  () => buildPreview(good, {chainId: 11155111, maxFeePerGas: GAS_PRICE, gasLimit: GAS_LIMIT}));
refuses("a scale read from one token cannot encode a call to another", PREVIEW_ERROR.MALFORMED_DECISION,
  () => buildPreview(good, {token: MALLORY, maxFeePerGas: GAS_PRICE, gasLimit: GAS_LIMIT}));

// A structural claim, asserted against the SOURCE rather than trusted: neither the preview builder
// nor the server has a signer or a way to broadcast. This is the row that catches someone
// "helpfully" adding one later.
//
// It scans CODE, not prose. The first version of this check scanned the raw file and went red on
// preview.mjs's own header comment — the one that promises there is no signer — which is a guard
// crying wolf on its own documentation. An ignored guard protects nothing, so comments are stripped
// before the scan and the words remain sayable in prose.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
}
const SIGNER_SHAPES = /eth_sendRawTransaction|eth_sendTransaction|sendTransaction|signTransaction|privateKey|PRIVATE_KEY|mnemonic|secp256k1|new Wallet|\.sign\(/;
const NETWORK_SHAPES = /fetch\(|node:http|XMLHttpRequest|WebSocket/;

// VALIDATE THE INSTRUMENT FIRST. A scanner that never fires is not a scanner, so it is fed a
// known-bad source and must go red on it before its verdict on the real files means anything.
const SABOTAGE_SOURCE = 'import {Wallet} from "x";\nconst w = new Wallet(process.env.PRIVATE_KEY);\nawait w.signTransaction(tx);\n';
eqv("SABOTAGE the signer scanner fires on a source that really does sign", SIGNER_SHAPES.test(stripComments(SABOTAGE_SOURCE)), true);
eqv("SABOTAGE the scanner still fires when the signing line is real code beside a comment",
  SIGNER_SHAPES.test(stripComments('// no signer here\nconst k = process.env.PRIVATE_KEY;')), true);
eqv("CONTROL the scanner does NOT fire on prose that merely names a signer",
  SIGNER_SHAPES.test(stripComments('// this file has no signTransaction and no PRIVATE_KEY\nconst x = 1;')), false);

const previewSource = stripComments(readFileSync(resolve(HERE, "preview.mjs"), "utf8"));
const serverSource = stripComments(readFileSync(resolve(HERE, "server.mjs"), "utf8"));
const treasurySource = stripComments(readFileSync(resolve(HERE, "treasury.mjs"), "utf8"));
eqv("preview.mjs contains no signer and no broadcast path", SIGNER_SHAPES.test(previewSource), false);
eqv("server.mjs contains no signer and no broadcast path", SIGNER_SHAPES.test(serverSource), false);
eqv("treasury.mjs contains no signer and no broadcast path", SIGNER_SHAPES.test(treasurySource), false);
eqv("preview.mjs performs no network I/O", NETWORK_SHAPES.test(previewSource), false);
eqv("treasury.mjs performs no network I/O", NETWORK_SHAPES.test(treasurySource), false);
eqv("treasury.mjs reads no clock and no randomness",
  /Date\.now|Math\.random|new Date\(/.test(treasurySource), false);
eqv("units.mjs reads no clock and no randomness",
  /Date\.now|Math\.random|new Date\(/.test(stripComments(readFileSync(resolve(HERE, "units.mjs"), "utf8"))), false);
eqv("the rendered handoff states the owner marker", renderPreview(preview).includes(REQUIRES_OWNER_SIGNATURE), true);

// =================================================================================================
console.log("\n— coverage of the closed vocabularies —");
// A stated negative: which members were exercised, counted, not asserted by hand.
const unseenActions = ALL_ACTIONS.filter((a) => !seenActions.has(a));
const unseenReasons = ALL_REASONS.filter((r) => !seenReasons.has(r));
eqv(`every ACTION member was produced by a row (${seenActions.size}/${ALL_ACTIONS.length})`, unseenActions.length, 0);

// A STATED NEGATIVE, not a tolerance. DECIMALS_NEVER_READ is defensive: `decide` maps that family
// of unit errors onto a reason, but its own input validation rejects a non-TokenAmount first, so no
// input can reach it. It is named here explicitly rather than hidden under a "<= 2 unexercised"
// threshold, because a soft threshold is where coverage drift goes to hide.
const EXPECTED_UNREACHABLE = ["DECIMALS_NEVER_READ"];
eqv(`REASON members exercised (${seenReasons.size}/${ALL_REASONS.length})`,
  unseenReasons.join(","), EXPECTED_UNREACHABLE.join(","));
console.log(`        every REASON is produced by a row except ${EXPECTED_UNREACHABLE.join(", ")}, which is defensive and unreachable through decide()`);

// =================================================================================================
console.log("");
console.log(`checks run: ${pass + fail + skip}, passed: ${pass}, failed: ${fail}`);
if (skip > 0) console.log(`skipped: ${skip}`);
process.exit(fail > 0 ? 1 : 0);
