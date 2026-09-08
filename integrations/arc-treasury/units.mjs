// Two kinds of money that look identical and are not.
//
// WHAT THIS IS FOR. On Arc the native gas currency is USDC. Like every EVM native currency its
// `eth_getBalance` and `msg.value` are a wei-like 18-decimal fixed-point quantity. That is a fact
// about the NATIVE representation and about nothing else. It does NOT follow that an ERC-20 USDC
// contract reports 18 — USDC's ERC-20 deployments report 6, and the ERC-20 USDC deployed on Arc
// itself reports 6 when you ask it (see live-check.mjs, which asks).
//
// An earlier document in this repository recorded "USDC is 18 decimals on Arc, not 6" as a flat
// fact. That sentence is an overclaim, and believing it corrupts every amount by 10^12 in one
// direction or the other. A comment saying "careful, these are different" would not have prevented
// it, because comments do not fail. So the separation is built into the representation: a native
// amount and a token amount are different types, and every operation that mixes them THROWS.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not know a default number of decimals for any token,
// any chain, or any symbol. There is no fallback to 18 and no fallback to 6. A token amount can
// only be built on top of a scale that was DECODED FROM BYTES A CONTRACT RETURNED, so "we never
// actually read decimals()" is not a state this module can be in. It does not convert between the
// two kinds implicitly, ever; the conversion is a separate named function that makes the caller
// write down what it is assuming and why.
//
// It also does not do decimal arithmetic. Everything is an integer in the smallest unit of its own
// representation, because a price formatted for a screen and parsed back is how a rounding
// difference becomes a real loss.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {utf8} from "../permit2/digest.mjs";

/// Every refusal this module can make, as a closed set. A caller can branch on `err.code`; a test
/// can assert the exact one. A refusal that is only a message is a refusal nobody can check.
export const UNIT_ERROR = {
  /// A scale was offered as a bare number instead of as a reading. This is the headline refusal:
  /// it is what makes "we assumed 18" unrepresentable rather than merely discouraged.
  DECIMALS_NOT_READ: "DECIMALS_NOT_READ",
  /// `eth_call` of `decimals()` returned empty. On Arc the system emitter at 0xffff…FFFE does
  /// exactly this: it has zero bytes of code, so there is no `decimals()` to run and the call
  /// succeeds with no data. An empty answer is NOT zero and is NOT a licence to guess.
  DECIMALS_EMPTY_RETURN: "DECIMALS_EMPTY_RETURN",
  /// Return data of a length no `uint8` return can have.
  DECIMALS_MALFORMED_RETURN: "DECIMALS_MALFORMED_RETURN",
  /// Decoded, but outside anything an ERC-20 could mean.
  DECIMALS_OUT_OF_RANGE: "DECIMALS_OUT_OF_RANGE",
  /// A native amount and a token amount met in an operation that requires one kind.
  UNIT_KIND_MISMATCH: "UNIT_KIND_MISMATCH",
  /// Two token amounts of different tokens met.
  TOKEN_MISMATCH: "TOKEN_MISMATCH",
  /// Two token amounts of the same token at different scales met. This means one of the two
  /// readings is stale or wrong, which is worse than a mismatch and must never be averaged over.
  SCALE_MISMATCH: "SCALE_MISMATCH",
  /// A conversion was asked for, and the scale the caller stated is not the scale that was read.
  STATED_SCALE_DISAGREES_WITH_READING: "STATED_SCALE_DISAGREES_WITH_READING",
  /// A conversion was asked for without saying why it is sound.
  CONVERSION_RATIONALE_REQUIRED: "CONVERSION_RATIONALE_REQUIRED",
  /// The token's READ scale is wider than the native representation, so restating it as a native
  /// amount would have to divide and could lose value. decimals() returns a uint8 and tokens wider
  /// than 18 exist, so this is reachable from a real reading — and losing dust in a treasury
  /// conversion is exactly the silent error this module refuses to make.
  TOKEN_SCALE_WIDER_THAN_NATIVE: "TOKEN_SCALE_WIDER_THAN_NATIVE",
  /// Not an integer, negative where it cannot be, or otherwise not a quantity.
  MALFORMED_AMOUNT: "MALFORMED_AMOUNT",
  /// Not a 20-byte 0x address.
  MALFORMED_ADDRESS: "MALFORMED_ADDRESS",
};

export class UnitError extends Error {
  constructor(code, detail) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "UnitError";
    this.code = code;
  }
}

const refuse = (code, detail) => {
  throw new UnitError(code, detail);
};

/// The native currency's fixed-point width. This is a property of the EVM native-value encoding,
/// not of any token, and it is the ONLY hard-coded decimal count in this module.
export const NATIVE_DECIMALS = 18;

/// The widest scale an ERC-20 could plausibly declare. `decimals()` returns a uint8, so 255 is
/// encodable; anything past 36 is not a token, it is a bug or a hostile contract.
const MAX_TOKEN_DECIMALS = 36;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/// Addresses are compared lowercased throughout. Checksum casing is a display concern and two
/// spellings of one address must never read as two tokens.
export function normaliseAddress(addr) {
  if (typeof addr !== "string" || !ADDRESS.test(addr)) {
    refuse(UNIT_ERROR.MALFORMED_ADDRESS, String(addr));
  }
  return addr.toLowerCase();
}

function integer(value, what) {
  let v;
  if (typeof value === "bigint") v = value;
  else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) refuse(UNIT_ERROR.MALFORMED_AMOUNT, `${what} is not a safe integer: ${value}`);
    v = BigInt(value);
  } else if (typeof value === "string" && /^(0x[0-9a-fA-F]+|-?[0-9]+)$/.test(value)) {
    v = BigInt(value);
  } else {
    refuse(UNIT_ERROR.MALFORMED_AMOUNT, `${what} is not an integer: ${String(value)}`);
  }
  return v;
}

// ---- the two representations -------------------------------------------------------------------
//
// Neither class is exported. A value of either kind can only come from a factory in this file,
// which is what makes the invariants below true of every instance that exists rather than true of
// the ones that went through the front door.

/// A quantity of the chain's NATIVE currency, in wei-like units at NATIVE_DECIMALS.
/// This is what `eth_getBalance` and `msg.value` carry. On Arc that currency happens to be USDC,
/// which is exactly why it is so easy to confuse with the ERC-20 and exactly why it has its own type.
class NativeAmount {
  #wei;
  constructor(wei, guard) {
    if (guard !== MINT) refuse(UNIT_ERROR.MALFORMED_AMOUNT, "NativeAmount is not directly constructible");
    this.#wei = wei;
    Object.freeze(this);
  }
  get kind() { return "NATIVE"; }
  get wei() { return this.#wei; }
  get decimals() { return NATIVE_DECIMALS; }
  toString() { return `${this.#wei} wei (native, ${NATIVE_DECIMALS}dp)`; }
  toJSON() {
    return {kind: "NATIVE", wei: this.#wei.toString(), decimals: NATIVE_DECIMALS, display: formatFixed(this.#wei, NATIVE_DECIMALS)};
  }
}

/// The scale of one ERC-20, together with the evidence that it was read rather than assumed.
/// There is no constructor that takes a plain number, which is the entire point.
class TokenScale {
  #decimals; #token; #source; #raw; #blockNumber;
  constructor(fields, guard) {
    if (guard !== MINT) refuse(UNIT_ERROR.DECIMALS_NOT_READ, "TokenScale is not directly constructible");
    this.#decimals = fields.decimals;
    this.#token = fields.token;
    this.#source = fields.source;
    this.#raw = fields.raw;
    this.#blockNumber = fields.blockNumber ?? null;
    Object.freeze(this);
  }
  get decimals() { return this.#decimals; }
  get token() { return this.#token; }
  /// Where the bytes came from. Carried so a report can say "read at block N from this RPC"
  /// rather than "6", and so an operator can tell a live reading from a recorded one.
  get source() { return this.#source; }
  get raw() { return this.#raw; }
  get blockNumber() { return this.#blockNumber; }
  toJSON() {
    return {token: this.#token, decimals: this.#decimals, source: this.#source, raw: this.#raw, blockNumber: this.#blockNumber};
  }
}

/// A quantity of one ERC-20, in that token's own smallest unit, carrying the scale it was measured
/// against and the address that scale was read from.
class TokenAmount {
  #units; #scale;
  constructor(units, scale, guard) {
    if (guard !== MINT) refuse(UNIT_ERROR.MALFORMED_AMOUNT, "TokenAmount is not directly constructible");
    this.#units = units;
    this.#scale = scale;
    Object.freeze(this);
  }
  get kind() { return "TOKEN"; }
  get units() { return this.#units; }
  get scale() { return this.#scale; }
  get decimals() { return this.#scale.decimals; }
  get token() { return this.#scale.token; }
  toString() { return `${this.#units} units (token ${this.#scale.token}, ${this.#scale.decimals}dp)`; }
  toJSON() {
    return {
      kind: "TOKEN", units: this.#units.toString(), token: this.#scale.token,
      decimals: this.#scale.decimals, display: formatFixed(this.#units, this.#scale.decimals),
      scaleSource: this.#scale.source,
    };
  }
}

/// The mint token. Module-private, so the three classes above can only be instantiated from here.
const MINT = Symbol("arc-treasury/units mint");

// ---- building a native amount --------------------------------------------------------------------

/// The ONLY way to name a native quantity. Takes wei — an integer, or the 0x-quantity an RPC
/// returns, which is what `eth_getBalance` hands back.
export function nativeFromWei(wei) {
  const v = integer(wei, "native wei");
  if (v < 0n) refuse(UNIT_ERROR.MALFORMED_AMOUNT, "native amounts are unsigned");
  return new NativeAmount(v, MINT);
}

/// A whole-unit convenience for fixtures and for a human writing a reserve floor. It multiplies by
/// 10^18 because that is the native representation's width; it is not a conversion between kinds.
export function nativeFromWhole(whole) {
  const v = integer(whole, "native whole units");
  if (v < 0n) refuse(UNIT_ERROR.MALFORMED_AMOUNT, "native amounts are unsigned");
  return nativeFromWei(v * 10n ** BigInt(NATIVE_DECIMALS));
}

// ---- building a token scale, which requires a reading ---------------------------------------------

/// Decode the return of `eth_call { to: token, data: decimals() }`.
///
/// This is the only door to a TokenScale, and it takes BYTES, not a number. To obtain a scale you
/// must produce what a contract actually returned, so a test can be deterministic and offline while
/// still being unable to express "we assumed 6".
///
/// The empty case is Arc's, observed and not hypothetical: the system emitter at 0xffff…FFFE has
/// zero bytes of code, so `eth_call` succeeds and returns "0x". A contract with no code answers
/// every call that way. It is a NAMED refusal here and never a default.
///
/// @param returnData 0x-prefixed hex, exactly as an RPC returned it
/// @param provenance {token, source, blockNumber} — where the bytes came from
export function decodeDecimalsReturn(returnData, provenance = {}) {
  const token = normaliseAddress(provenance.token);
  if (typeof returnData !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(returnData)) {
    refuse(UNIT_ERROR.DECIMALS_MALFORMED_RETURN, `not hex: ${String(returnData)}`);
  }
  const body = returnData.slice(2);
  if (body.length === 0) {
    refuse(
      UNIT_ERROR.DECIMALS_EMPTY_RETURN,
      `${token} returned no data for decimals() — it has no code, or it is not an ERC-20. ` +
      "There is no default to fall back to and this module will not invent one.",
    );
  }
  if (body.length !== 64) {
    refuse(UNIT_ERROR.DECIMALS_MALFORMED_RETURN, `expected one 32-byte word, got ${body.length / 2} bytes`);
  }
  const decimals = Number(BigInt(returnData));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    refuse(UNIT_ERROR.DECIMALS_OUT_OF_RANGE, `decimals() returned ${decimals}`);
  }
  return new TokenScale({
    decimals,
    token,
    source: provenance.source ?? "DECODED_FROM_RETURN_DATA",
    raw: returnData,
    blockNumber: provenance.blockNumber ?? null,
  }, MINT);
}

/// True for a value that really is a scale minted from a reading. Used by the policy to refuse
/// anything shaped like one.
export const isTokenScale = (v) => v instanceof TokenScale;

/// The ONLY way to name a token quantity: an integer, plus a scale that came from a reading.
/// Passing a bare number as the scale is the mistake this whole module exists to stop, so it is
/// refused by name rather than coerced.
export function tokenAmount(units, scale) {
  if (!isTokenScale(scale)) {
    refuse(
      UNIT_ERROR.DECIMALS_NOT_READ,
      "a token amount needs a scale read from the token's own decimals(), " +
      `not ${typeof scale === "number" ? `the bare number ${scale}` : String(scale)}. ` +
      "Use decodeDecimalsReturn() on what the contract returned.",
    );
  }
  const v = integer(units, "token units");
  if (v < 0n) refuse(UNIT_ERROR.MALFORMED_AMOUNT, "token amounts are unsigned");
  return new TokenAmount(v, scale, MINT);
}

/// Whole units of a token, at the scale that was read for it.
export function tokenFromWhole(whole, scale) {
  if (!isTokenScale(scale)) {
    refuse(UNIT_ERROR.DECIMALS_NOT_READ, "tokenFromWhole needs a scale read from decimals()");
  }
  const v = integer(whole, "token whole units");
  if (v < 0n) refuse(UNIT_ERROR.MALFORMED_AMOUNT, "token amounts are unsigned");
  return tokenAmount(v * 10n ** BigInt(scale.decimals), scale);
}

// ---- what you may do with them --------------------------------------------------------------------

export const isNative = (v) => v instanceof NativeAmount;
export const isToken = (v) => v instanceof TokenAmount;
export const isAmount = (v) => isNative(v) || isToken(v);

/// The guard. Every binary operation goes through it, so there is one place where the rule lives.
///
/// The two failures it exists to catch are the two that actually happen: a native amount meeting a
/// token amount (the 10^12 error), and two token amounts of the same token carrying different
/// scales (one of the readings is wrong, and averaging over that is worse than stopping).
function sameKind(a, b, op) {
  if (!isAmount(a) || !isAmount(b)) {
    refuse(UNIT_ERROR.MALFORMED_AMOUNT, `${op} needs two amounts`);
  }
  if (a.kind !== b.kind) {
    refuse(
      UNIT_ERROR.UNIT_KIND_MISMATCH,
      `${op} refused: ${a.kind} (${a.decimals}dp) and ${b.kind} (${b.decimals}dp) are different ` +
      "representations. On Arc both may be called USDC and they are still not the same quantity. " +
      "If a conversion is genuinely intended, call toNative() and state the scale.",
    );
  }
  if (a.kind === "TOKEN") {
    if (a.token !== b.token) refuse(UNIT_ERROR.TOKEN_MISMATCH, `${op}: ${a.token} vs ${b.token}`);
    if (a.decimals !== b.decimals) {
      refuse(UNIT_ERROR.SCALE_MISMATCH, `${op}: same token ${a.token} read at ${a.decimals}dp and ${b.decimals}dp — one reading is wrong`);
    }
  }
  return a.kind;
}

const raw = (x) => (isNative(x) ? x.wei : x.units);
const rebuild = (x, v) => (isNative(x) ? nativeFromWei(v) : tokenAmount(v, x.scale));

export function add(a, b) {
  sameKind(a, b, "add");
  return rebuild(a, raw(a) + raw(b));
}

/// Subtraction is where a reserve floor is actually enforced, so it refuses to go negative rather
/// than wrapping or clamping. A clamp here would silently turn "we cannot afford this" into "we
/// paid zero", which is the failure mode the policy above it is built to avoid.
export function sub(a, b) {
  sameKind(a, b, "sub");
  const v = raw(a) - raw(b);
  if (v < 0n) refuse(UNIT_ERROR.MALFORMED_AMOUNT, "sub would go negative");
  return rebuild(a, v);
}

/// -1, 0 or 1. Throws on a mixed comparison, which is the sabotage row: two amounts of the same
/// FACE VALUE and different kinds must not compare equal, and must not compare at all.
export function cmp(a, b) {
  sameKind(a, b, "cmp");
  const x = raw(a), y = raw(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export const lt = (a, b) => cmp(a, b) < 0;
export const lte = (a, b) => cmp(a, b) <= 0;
export const gt = (a, b) => cmp(a, b) > 0;
export const gte = (a, b) => cmp(a, b) >= 0;
export const eq = (a, b) => cmp(a, b) === 0;

/// Sum of a list of one kind. An empty list has no kind, so it cannot be summed — returning "zero"
/// would mean inventing a representation, which is the thing this module never does.
export function sum(amounts) {
  if (!Array.isArray(amounts) || amounts.length === 0) {
    refuse(UNIT_ERROR.MALFORMED_AMOUNT, "sum of an empty list has no representation");
  }
  return amounts.reduce((acc, x) => add(acc, x));
}

/// A quantity times a plain integer count. Scalars are dimensionless, so this is always sound —
/// gas units times a gas price is exactly this shape.
export function scaleBy(amount, factor) {
  if (!isAmount(amount)) refuse(UNIT_ERROR.MALFORMED_AMOUNT, "scaleBy needs an amount");
  const f = integer(factor, "factor");
  if (f < 0n) refuse(UNIT_ERROR.MALFORMED_AMOUNT, "scaleBy is unsigned");
  return rebuild(amount, raw(amount) * f);
}

// ---- the conversion, which is deliberately awkward -------------------------------------------------

/// Restate a token quantity as a native one at a stated scale.
///
/// This is the ONE bridge between the kinds, and it is written to be hard to reach for. The caller
/// must restate both scales — so a wrong assumption is a visible disagreement instead of a silent
/// rescale — and must write down WHY the conversion is sound at all, because a token unit and a
/// native unit are only interchangeable when something outside this module says they are.
///
/// On Arc that something is real: the native currency and the ERC-20 are both USDC, so one token
/// unit is one native unit of value. That is a claim about Arc, not about arithmetic, and this
/// signature forces whoever relies on it to say so in a string a reviewer can read.
export function toNative(amount, {statedTokenDecimals, statedNativeDecimals, rationale} = {}) {
  if (!isToken(amount)) {
    refuse(UNIT_ERROR.UNIT_KIND_MISMATCH, "toNative takes a token amount");
  }
  if (statedTokenDecimals !== amount.decimals) {
    refuse(
      UNIT_ERROR.STATED_SCALE_DISAGREES_WITH_READING,
      `caller stated ${statedTokenDecimals}dp for ${amount.token}, but decimals() was read as ${amount.decimals}dp`,
    );
  }
  if (statedNativeDecimals !== NATIVE_DECIMALS) {
    refuse(
      UNIT_ERROR.STATED_SCALE_DISAGREES_WITH_READING,
      `caller stated ${statedNativeDecimals}dp for the native currency, which is ${NATIVE_DECIMALS}dp`,
    );
  }
  if (typeof rationale !== "string" || rationale.trim().length < 8) {
    refuse(
      UNIT_ERROR.CONVERSION_RATIONALE_REQUIRED,
      "state why one token unit equals one native unit of value on this chain",
    );
  }
  if (amount.decimals > NATIVE_DECIMALS) {
    refuse(
      UNIT_ERROR.TOKEN_SCALE_WIDER_THAN_NATIVE,
      `${amount.token} was read at ${amount.decimals}dp, wider than the native ${NATIVE_DECIMALS}dp. ` +
      "Restating it natively would divide and could discard value, so it is refused rather than rounded.",
    );
  }
  const shift = BigInt(NATIVE_DECIMALS - amount.decimals);
  return nativeFromWei(amount.units * 10n ** shift);
}

// ---- display ----------------------------------------------------------------------------------

/// Integer to fixed-point string. Display only — nothing reads this back.
export function formatFixed(value, decimals) {
  const v = BigInt(value);
  if (decimals === 0) return v.toString();
  const d = 10n ** BigInt(decimals);
  const whole = v / d;
  const frac = (v % d).toString().padStart(decimals, "0");
  return `${whole}.${frac}`;
}

/// A label that always says which representation it is. Used everywhere a number reaches a human,
/// because "1.00 USDC" is the ambiguity this module exists to remove.
export function label(amount) {
  if (isNative(amount)) return `${formatFixed(amount.wei, NATIVE_DECIMALS)} USDC (native gas asset, 18dp)`;
  if (isToken(amount)) return `${formatFixed(amount.units, amount.decimals)} (ERC-20 ${amount.token}, ${amount.decimals}dp as read)`;
  refuse(UNIT_ERROR.MALFORMED_AMOUNT, "not an amount");
}

/// The 4-byte selector for `decimals()`, DERIVED from the signature with this repository's own
/// keccak rather than pasted from a table. A pasted selector is a typo nobody notices until an
/// `eth_call` returns empty and some other module decides that means zero.
export const DECIMALS_SELECTOR = toHex(keccak256(utf8("decimals()"))).slice(0, 10);
