// UNICA V2 — building, hashing and reading back everything a merchant or a payer signs.
//
// This is the CLIENT side of the frozen v2.0.0-rc1 interface, written from the EIP-712
// specification and Permit2's documented type strings rather than from the Solidity it is compared
// against. That is the whole point: a tool that asks the contract for a digest and signs whatever
// comes back cannot discover that both are wrong, and a wrong digest is rejected in a wallet, not
// in a test suite.
//
// IT HOLDS NO KEYS. Every signing entry point takes a `sign(digest) -> signature` callback, so the
// key stays wherever the caller keeps it. Nothing here reads an environment variable, writes a
// file, or logs a secret, and the test suite signs nothing at all — it tests digests.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {merchantConfigHash} from "../../integrations/ensv2/config.mjs";
import {
  bytesFromHex,
  concat,
  decodeBytes,
  encodeBytes,
  readAddress,
  readBool,
  readBytes32,
  readInt,
  readUint,
  selectorOf,
  wordAddress,
  wordBool,
  wordBytes32,
  wordInt,
  wordUint,
} from "./abi.mjs";

export {merchantConfigHash};

const utf8 = (s) => new TextEncoder().encode(s);
const hashOf = (s) => toHex(keccak256(utf8(s)));

// ---- the frozen type strings ----------------------------------------------------------------
//
// Byte-for-byte what `test/v2/InterfaceFreeze.t.sol` reads back from the deployed contracts. A
// character here is a different digest, and a different digest is a signature no wallet will make.

export const POOL_KEY_TYPE = "PoolKey(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";

export const QUOTE_TYPE =
  "Quote(uint8 version,bytes32 quoteId,address merchantSigner,address payer,address recipient," +
  "address tokenIn,uint256 maxIn,address tokenOut,uint256 amountOut,PoolKey pool,bool zeroForOne," +
  "uint256 deadline,address hook,address executor,bytes32 merchantConfigHash,uint32 policyVersion)" +
  POOL_KEY_TYPE;

export const PAYMENT_TYPE =
  "Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,address destination,address executor)";

export const TOKEN_PERMISSIONS_TYPE = "TokenPermissions(address token,uint256 amount)";

/// Permit2 concatenates its own stub with this. `TokenPermissions` comes last because EIP-712
/// orders referenced structs alphabetically and `Payment` sorts first.
export const PAYMENT_WITNESS_TYPE_STRING = `Payment witness)${PAYMENT_TYPE}${TOKEN_PERMISSIONS_TYPE}`;

export const PERMIT_WITNESS_STUB =
  "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,";

/// V2 reads NOTHING from calldata. Exposed as a function rather than left implicit, because
/// "we ignore hookData" is a claim and a caller building a transaction should be able to see the
/// empty answer rather than infer it.
export function hookData() {
  return "0x";
}

// ---- the merchant's half ----------------------------------------------------------------------

export function hashPoolKey(pool) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf(POOL_KEY_TYPE)),
        wordAddress(pool.currency0),
        wordAddress(pool.currency1),
        wordUint(pool.fee),
        wordInt(pool.tickSpacing),
        wordAddress(pool.hooks),
      ),
    ),
  );
}

const QUOTE_FIELDS = [
  "version", "quoteId", "merchantSigner", "payer", "recipient", "tokenIn", "maxIn", "tokenOut",
  "amountOut", "pool", "zeroForOne", "deadline", "hook", "executor", "merchantConfigHash", "policyVersion",
];

function requireQuote(q) {
  for (const f of QUOTE_FIELDS) {
    if (q[f] === undefined || q[f] === null) throw new Error(`quote is missing ${f}`);
  }
  for (const f of ["currency0", "currency1", "fee", "tickSpacing", "hooks"]) {
    if (q.pool[f] === undefined || q.pool[f] === null) throw new Error(`quote.pool is missing ${f}`);
  }
}

export function hashQuote(q) {
  requireQuote(q);
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf(QUOTE_TYPE)),
        wordUint(q.version),
        wordBytes32(q.quoteId),
        wordAddress(q.merchantSigner),
        wordAddress(q.payer),
        wordAddress(q.recipient),
        wordAddress(q.tokenIn),
        wordUint(q.maxIn),
        wordAddress(q.tokenOut),
        wordUint(q.amountOut),
        wordBytes32(hashPoolKey(q.pool)),
        wordBool(q.zeroForOne),
        wordUint(q.deadline),
        wordAddress(q.hook),
        wordAddress(q.executor),
        wordBytes32(q.merchantConfigHash),
        wordUint(q.policyVersion),
      ),
    ),
  );
}

/// UNICA's domain. Note the `version` member — Permit2's domain does NOT have one, and mixing the
/// two up is the single easiest way to produce a digest nothing will accept.
export function domainSeparator({chainId, executor}) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        wordBytes32(hashOf("UNICA")),
        wordBytes32(hashOf("2")),
        wordUint(chainId),
        wordAddress(executor),
      ),
    ),
  );
}

export function quoteDigest(q, {chainId}) {
  return toHex(
    keccak256(
      concat(
        new Uint8Array([0x19, 0x01]),
        wordBytes32(domainSeparator({chainId, executor: q.executor})),
        wordBytes32(hashQuote(q)),
      ),
    ),
  );
}

// ---- the payer's half ---------------------------------------------------------------------------

/// `destination` is the PoolManager, and it is inside the witness even though Permit2 does not
/// enforce a transfer destination. Gate 0 measured Permit2 accepting a transfer to an attacker
/// without the payer's signature objecting; the executor writes the destination as a literal and
/// this records what was meant, so a signature made for one destination does not fit another.
export function paymentWitness(q, {poolManager}) {
  requireQuote(q);
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf(PAYMENT_TYPE)),
        wordBytes32(q.quoteId),
        wordAddress(q.payer),
        wordAddress(q.tokenIn),
        wordUint(q.maxIn),
        wordAddress(poolManager),
        wordAddress(q.executor),
      ),
    ),
  );
}

/// Permit2's domain: name and chain and address, and NO version member.
export function permit2DomainSeparator({chainId, permit2}) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf("EIP712Domain(string name,uint256 chainId,address verifyingContract)")),
        wordBytes32(hashOf("Permit2")),
        wordUint(chainId),
        wordAddress(permit2),
      ),
    ),
  );
}

export function permitDigest(q, {chainId, permit2, poolManager, nonce, deadline}) {
  const tokenPermissions = toHex(
    keccak256(concat(wordBytes32(hashOf(TOKEN_PERMISSIONS_TYPE)), wordAddress(q.tokenIn), wordUint(q.maxIn))),
  );
  const structHash = toHex(
    keccak256(
      concat(
        wordBytes32(hashOf(PERMIT_WITNESS_STUB + PAYMENT_WITNESS_TYPE_STRING)),
        wordBytes32(tokenPermissions),
        // The SPENDER, which Permit2 substitutes with msg.sender at spend time — so a signature is
        // bound to one caller without the payer having to name anybody.
        wordAddress(q.executor),
        wordUint(nonce),
        wordUint(deadline),
        wordBytes32(paymentWitness(q, {poolManager})),
      ),
    ),
  );
  return toHex(
    keccak256(
      concat(
        new Uint8Array([0x19, 0x01]),
        wordBytes32(permit2DomainSeparator({chainId, permit2})),
        wordBytes32(structHash),
      ),
    ),
  );
}

// ---- the transaction ------------------------------------------------------------------------------

export const SETTLE_SIGNATURE =
  "settle((uint8,bytes32,address,address,address,address,uint256,address,uint256," +
  "(address,address,uint24,int24,address),bool,uint256,address,address,bytes32,uint32),bytes,(uint256,uint256,bytes))";

export const SETTLE_SELECTOR = selectorOf(SETTLE_SIGNATURE);

/// The Quote encodes as a STATIC tuple of twenty words — every member is fixed width, and the
/// nested PoolKey is five of them inline. So the head is: quote, an offset to the merchant's
/// signature, an offset to the payer's authorisation.
const QUOTE_WORDS = 20;

export function encodeSettleCalldata(q, merchantSignature, auth) {
  requireQuote(q);
  for (const f of ["nonce", "deadline", "signature"]) {
    if (auth[f] === undefined || auth[f] === null) throw new Error(`authorisation is missing ${f}`);
  }
  const quote = concat(
    wordUint(q.version),
    wordBytes32(q.quoteId),
    wordAddress(q.merchantSigner),
    wordAddress(q.payer),
    wordAddress(q.recipient),
    wordAddress(q.tokenIn),
    wordUint(q.maxIn),
    wordAddress(q.tokenOut),
    wordUint(q.amountOut),
    wordAddress(q.pool.currency0),
    wordAddress(q.pool.currency1),
    wordUint(q.pool.fee),
    wordInt(q.pool.tickSpacing),
    wordAddress(q.pool.hooks),
    wordBool(q.zeroForOne),
    wordUint(q.deadline),
    wordAddress(q.hook),
    wordAddress(q.executor),
    wordBytes32(q.merchantConfigHash),
    wordUint(q.policyVersion),
  );

  const sigTail = encodeBytes(merchantSignature);
  // The authorisation is itself dynamic: two words, then an offset to its signature.
  const authTail = concat(
    wordUint(auth.nonce),
    wordUint(auth.deadline),
    wordUint(3 * 32),
    encodeBytes(auth.signature),
  );

  const headSize = (QUOTE_WORDS + 2) * 32;
  const body = concat(
    quote,
    wordUint(headSize),
    wordUint(headSize + sigTail.length),
    sigTail,
    authTail,
  );
  return toHex(concat(bytesFromHex(SETTLE_SELECTOR), body));
}

/// Reads calldata back into the same shape it was built from. A tool that can only build is a tool
/// nobody can check; this is what makes the round-trip property testable.
export function decodeSettleCalldata(hex) {
  const data = bytesFromHex(hex);
  const selector = toHex(data.slice(0, 4));
  if (selector !== SETTLE_SELECTOR) throw new Error(`not a settle() call: ${selector}`);
  const b = data.slice(4);
  const w = (n) => n * 32;

  const q = {
    version: Number(readUint(b, w(0))),
    quoteId: readBytes32(b, w(1)),
    merchantSigner: readAddress(b, w(2)),
    payer: readAddress(b, w(3)),
    recipient: readAddress(b, w(4)),
    tokenIn: readAddress(b, w(5)),
    maxIn: readUint(b, w(6)),
    tokenOut: readAddress(b, w(7)),
    amountOut: readUint(b, w(8)),
    pool: {
      currency0: readAddress(b, w(9)),
      currency1: readAddress(b, w(10)),
      fee: Number(readUint(b, w(11))),
      tickSpacing: Number(readInt(b, w(12))),
      hooks: readAddress(b, w(13)),
    },
    zeroForOne: readBool(b, w(14)),
    deadline: readUint(b, w(15)),
    hook: readAddress(b, w(16)),
    executor: readAddress(b, w(17)),
    merchantConfigHash: readBytes32(b, w(18)),
    policyVersion: Number(readUint(b, w(19))),
  };

  const sigAt = Number(readUint(b, w(QUOTE_WORDS)));
  const authAt = Number(readUint(b, w(QUOTE_WORDS + 1)));
  const merchantSignature = decodeBytes(b, sigAt);
  const auth = {
    nonce: readUint(b, authAt),
    deadline: readUint(b, authAt + 32),
    signature: decodeBytes(b, authAt + Number(readUint(b, authAt + 64))),
  };
  return {quote: q, merchantSignature, auth};
}

// ---- what a person is asked to approve ------------------------------------------------------------

/// The canonical reviewable summary. Two lines matter more than the rest and are called out as
/// such: where the payer's money is going, and the most it can be. Everything else is context.
export function summarize(q, {chainId, permit2, poolManager, nonce, deadline}) {
  requireQuote(q);
  return {
    chainId,
    poolManager,
    permit2,
    hook: q.hook,
    executor: q.executor,
    pool: {...q.pool},
    direction: q.zeroForOne ? "zeroForOne (currency0 in, currency1 out)" : "oneForZero (currency1 in, currency0 out)",
    payer: q.payer,
    merchantSigner: q.merchantSigner,
    recipient: q.recipient,
    tokenIn: q.tokenIn,
    maxIn: q.maxIn.toString(),
    tokenOut: q.tokenOut,
    amountOut: q.amountOut.toString(),
    quoteDeadline: q.deadline.toString(),
    quoteId: q.quoteId,
    merchantConfigHash: q.merchantConfigHash,
    policyVersion: q.policyVersion,
    quoteDigest: quoteDigest(q, {chainId}),
    permit2Nonce: nonce.toString(),
    permit2Deadline: deadline.toString(),
    hookData: hookData(),
    // The two the payer has to actually read.
    THE_MOST_THIS_CAN_SPEND: `${q.maxIn.toString()} of ${q.tokenIn}`,
    THE_TOKENS_GO_TO: poolManager,
  };
}

// ---- signing, without ever holding a key ------------------------------------------------------------

/// @param sign an async or sync `(digest) -> signature` supplied by the caller. A wallet, a
///        hardware device, a keystore — anything that is not this module.
export async function signQuote(q, {chainId}, sign) {
  return sign(quoteDigest(q, {chainId}));
}

export async function signPayment(q, opts, sign) {
  return sign(permitDigest(q, opts));
}
