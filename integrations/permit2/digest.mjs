// UNICA — an offline derivation of the Permit2 witness digest a payer signs.
//
// WHY THIS EXISTS. The V2 executor asks a payer's wallet to sign one thing: a Permit2
// `PermitWitnessTransferFrom` whose witness is the UNICA payment. If our idea of that digest and
// Permit2's differ by one byte, every signature a real wallet produces is rejected on chain — and a
// Solidity test that builds the digest the same way the contract-under-test builds it cannot
// discover that, because both sides share the mistake.
//
// So this is a SECOND, INDEPENDENT derivation: a different language, a different keccak (the
// FIPS-202 implementation written for the ENS module and validated against published vectors), and
// code written from the EIP-712 specification and Permit2's documented type strings rather than
// from the Solidity in `test/v2/`. The two are compared in `integrations/permit2/test.mjs` and
// again in `test/v2/Permit2Witness.t.sol`, where the value derived here is pinned as a literal and
// a signature over it is presented to the real deployed Permit2 runtime.
//
// Nothing here is copied from Permit2. The type strings below are the interface — the same text a
// wallet displays — and are written out because a digest is a hash of exactly these bytes.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";

const HEX = /^0x[0-9a-fA-F]*$/;

/** @param {string} hex 0x-prefixed, even length */
export function bytesFromHex(hex) {
  if (typeof hex !== "string" || !HEX.test(hex)) throw new Error(`not a hex string: ${hex}`);
  const body = hex.slice(2);
  if (body.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function utf8(s) {
  return new TextEncoder().encode(s);
}

export function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A 32-byte ABI word holding an unsigned integer. */
export function wordUint(value) {
  let v = BigInt(value);
  if (v < 0n) throw new Error("wordUint is unsigned");
  if (v >= 1n << 256n) throw new Error("value does not fit in 32 bytes");
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** A 32-byte ABI word holding a left-padded 20-byte address. */
export function wordAddress(addr) {
  const b = bytesFromHex(addr);
  if (b.length !== 20) throw new Error(`not a 20-byte address: ${addr}`);
  const out = new Uint8Array(32);
  out.set(b, 12);
  return out;
}

/** A 32-byte ABI word holding a bytes32 verbatim. */
export function wordBytes32(value) {
  const b = bytesFromHex(value);
  if (b.length !== 32) throw new Error(`not 32 bytes: ${value}`);
  return b;
}

// ---- the type strings, written from the specification ---------------------------------------

export const TOKEN_PERMISSIONS_TYPE = "TokenPermissions(address token,uint256 amount)";

/// The UNICA witness: what the payer authorises beyond "this token, this much".
export const PAYMENT_TYPE =
  "Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,address destination,address executor)";

/// Permit2 builds its type hash by concatenating its own opening with the caller's witness type
/// string. The witness FIELD declaration closes Permit2's parenthesis, the witness STRUCT follows,
/// and `TokenPermissions` comes last: EIP-712 orders referenced structs alphabetically, and
/// `Payment` sorts before `TokenPermissions`.
export const WITNESS_TYPE_STRING = `Payment witness)${PAYMENT_TYPE}${TOKEN_PERMISSIONS_TYPE}`;

export const PERMIT_WITNESS_TRANSFER_FROM_STUB =
  "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,";

export const EIP712_DOMAIN_TYPE = "EIP712Domain(string name,uint256 chainId,address verifyingContract)";

// ---- the derivation --------------------------------------------------------------------------

export function typeHash(text) {
  return toHex(keccak256(utf8(text)));
}

/// Permit2's domain has no `version` field, which is the detail most likely to be got wrong by
/// anyone reaching for a generic EIP-712 helper.
export function domainSeparator({chainId, verifyingContract}) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(typeHash(EIP712_DOMAIN_TYPE)),
        wordBytes32(typeHash("Permit2")),
        wordUint(chainId),
        wordAddress(verifyingContract),
      ),
    ),
  );
}

export function tokenPermissionsHash({token, amount}) {
  return toHex(
    keccak256(concat(wordBytes32(typeHash(TOKEN_PERMISSIONS_TYPE)), wordAddress(token), wordUint(amount))),
  );
}

export function paymentWitness({quoteId, payer, tokenIn, maxIn, destination, executor}) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(typeHash(PAYMENT_TYPE)),
        wordBytes32(quoteId),
        wordAddress(payer),
        wordAddress(tokenIn),
        wordUint(maxIn),
        wordAddress(destination),
        wordAddress(executor),
      ),
    ),
  );
}

/// @param spender the address that will CALL Permit2. Permit2 substitutes `msg.sender` here at
///        spend time, so a signature is bound to one spender without the payer naming anyone.
export function permitWitnessStructHash({permitted, spender, nonce, deadline, witness}) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(typeHash(PERMIT_WITNESS_TRANSFER_FROM_STUB + WITNESS_TYPE_STRING)),
        wordBytes32(tokenPermissionsHash(permitted)),
        wordAddress(spender),
        wordUint(nonce),
        wordUint(deadline),
        wordBytes32(witness),
      ),
    ),
  );
}

/// The EIP-191 `0x19 0x01` prefix, the domain, and the struct hash.
export function signingDigest({chainId, permit2, permitted, spender, nonce, deadline, witness}) {
  return toHex(
    keccak256(
      concat(
        new Uint8Array([0x19, 0x01]),
        wordBytes32(domainSeparator({chainId, verifyingContract: permit2})),
        wordBytes32(permitWitnessStructHash({permitted, spender, nonce, deadline, witness})),
      ),
    ),
  );
}
