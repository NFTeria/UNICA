// Public-key recovery on secp256k1, written from SEC 1 §4.1.6 with nothing but BigInt.
//
// WHY THIS EXISTS RATHER THAN A DEPENDENCY. The verifier's job is to disagree with the contract
// when the contract is wrong. A verifier that recovers a signer with the same library the signer
// used cannot discover that the library is being fed the wrong digest, and pulling a package in
// would also break this repository's "no external dependency" rule for tooling. The arithmetic
// below is a few dozen lines of the curve's own definition; the risk is not in the maths, it is in
// the policy around it, which is why the policy is stated separately and tested separately.
//
// IT NEVER SEES A PRIVATE KEY. Recovery takes a digest and a signature and returns an address.
// There is no signing function here, no key material in this file, and none in the fixtures.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {bytesFromHex} from "./../unica-sign/abi.mjs";

// The curve, from its definition. y^2 = x^3 + 7 over F_p, with the standard generator and order.
const CURVE_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const CURVE_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const CURVE_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const CURVE_B = 7n;

/// Half the order, rounded down. A signature with `s` above this is the OTHER valid signature over
/// the same message — the malleable twin — and the V2 policy refuses it. Stated as the curve
/// constant it is, rather than copied in as an opaque literal.
export const HALF_N = CURVE_N >> 1n;

export const CURVE_ORDER = CURVE_N;

const mod = (a, m) => ((a % m) + m) % m;

/// Modular inverse by the extended Euclidean algorithm. Cheaper than exponentiation and, more to
/// the point, it fails loudly on a non-invertible input instead of returning a wrong answer.
function inverse(a, m) {
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error("value has no inverse on this field");
  return mod(old_s, m);
}

function power(base, exponent, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/// Affine points, with the point at infinity written as null. Affine costs one inversion per
/// operation, which for the few hundred operations one recovery needs is not worth trading
/// legibility for.
function add(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  if (p1.x === p2.x) {
    if (mod(p1.y + p2.y, CURVE_P) === 0n) return null;
    return double(p1);
  }
  const slope = mod((p2.y - p1.y) * inverse(p2.x - p1.x, CURVE_P), CURVE_P);
  const x = mod(slope * slope - p1.x - p2.x, CURVE_P);
  return {x, y: mod(slope * (p1.x - x) - p1.y, CURVE_P)};
}

function double(p1) {
  if (p1 === null || p1.y === 0n) return null;
  const slope = mod(3n * p1.x * p1.x * inverse(2n * p1.y, CURVE_P), CURVE_P);
  const x = mod(slope * slope - 2n * p1.x, CURVE_P);
  return {x, y: mod(slope * (p1.x - x) - p1.y, CURVE_P)};
}

function multiply(point, scalar) {
  let result = null;
  let addend = point;
  let k = mod(scalar, CURVE_N);
  while (k > 0n) {
    if (k & 1n) result = add(result, addend);
    addend = double(addend);
    k >>= 1n;
  }
  return result;
}

function onCurve(point) {
  return mod(point.y * point.y - point.x * point.x * point.x - CURVE_B, CURVE_P) === 0n;
}

/// The two coordinates, uncompressed and unprefixed, hashed — which is the whole of how Ethereum
/// derives an address from a public key.
function addressOf(point) {
  const xy = new Uint8Array(64);
  const put = (v, at) => {
    let n = v;
    for (let i = 31; i >= 0; i--) {
      xy[at + i] = Number(n & 0xffn);
      n >>= 8n;
    }
  };
  put(point.x, 0);
  put(point.y, 32);
  return toHex(keccak256(xy).slice(12));
}

/// The V2 merchant-signature policy, in one place: exactly 65 bytes, `v` of 27 or 28, `r` and `s`
/// both inside the curve's order, and `s` in the lower half.
///
/// It is the policy `ECDSA.recover` enforces in the executor — 65 bytes or a length error, a high
/// `s` refused outright, and a recovery that yields nothing refused as an invalid signature. This
/// verifier restates it rather than importing it, because a verifier that shares its rule with the
/// thing it checks cannot find a disagreement between them.
export function splitSignature(hex) {
  const bytes = bytesFromHex(hex);
  if (bytes.length !== 65) throw new Error(`a merchant signature is 65 bytes; this one is ${bytes.length}`);
  const word = (at) => {
    let v = 0n;
    for (let i = 0; i < 32; i++) v = (v << 8n) | BigInt(bytes[at + i]);
    return v;
  };
  const r = word(0);
  const s = word(32);
  const v = bytes[64];
  if (v !== 27 && v !== 28) throw new Error(`v must be 27 or 28; this one is ${v}`);
  if (r === 0n || r >= CURVE_N) throw new Error("r is not a scalar on this curve");
  if (s === 0n || s >= CURVE_N) throw new Error("s is not a scalar on this curve");
  if (s > HALF_N) throw new Error("s is in the upper half of the curve order: this is the malleable twin");
  return {r, s, v, recoveryId: v - 27};
}

/// SEC 1 §4.1.6, with the recovery identifier fixing which of the two candidate points is meant.
/// @param digest the 32-byte value that was signed — NOT a message to be hashed here. Hashing
///        belongs to whoever built the EIP-712 digest, and doing it in two places is how a
///        verifier ends up checking a signature over something nobody signed.
export function recoverAddress(digest, signatureHex) {
  const {r, s, recoveryId} = splitSignature(signatureHex);
  const digestBytes = bytesFromHex(digest);
  if (digestBytes.length !== 32) throw new Error("a digest is 32 bytes");
  let e = 0n;
  for (const byte of digestBytes) e = (e << 8n) | BigInt(byte);

  // Recover R from its x coordinate. y^2 = x^3 + 7, and p = 3 mod 4, so the square root is one
  // exponentiation. If it does not square back, r named an x that is not on the curve at all.
  const alpha = mod(r * r * r + CURVE_B, CURVE_P);
  const beta = power(alpha, (CURVE_P + 1n) / 4n, CURVE_P);
  if (mod(beta * beta, CURVE_P) !== alpha) throw new Error("r does not name a point on the curve");
  const y = (beta & 1n) === BigInt(recoveryId) ? beta : CURVE_P - beta;
  const R = {x: r, y};
  if (!onCurve(R)) throw new Error("the recovered point is not on the curve");

  // Q = r^-1 (sR - eG).
  const rInverse = inverse(r, CURVE_N);
  const point = add(multiply(R, s), multiply({x: CURVE_GX, y: CURVE_GY}, CURVE_N - mod(e, CURVE_N)));
  const Q = multiply(point, rInverse);
  if (Q === null) throw new Error("recovery produced the point at infinity");
  return addressOf(Q);
}
