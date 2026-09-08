// Circle Gateway's batched x402 authorization, derived independently.
//
// WHAT THIS IS. A second implementation of the digest a payer signs for a Circle Gateway
// nanopayment on Arc, written from the EIP-712 specification and the type string observed in
// `@circle-fin/x402-batching@2.0.4`. It is NOT a copy of that SDK and does not import it.
//
// WHY IT EXISTS. The SDK's server half does not verify anything: `BatchFacilitatorClient.verify`
// and `.settle` are HTTP wrappers around Circle's hosted API, so a seller using them learns that
// Circle says a payment is valid and never checks for itself. But the payload a buyer sends
// carries BOTH the authorization and the signature over it, so local verification is available
// and simply unused. This module takes it.
//
// WHAT THE PAYER ACTUALLY SIGNS, and this is the whole finding:
//
//     domain  : GatewayWalletBatched, version 1, chainId, verifyingContract = the GatewayWallet
//     message : from, to, value, validAfter, validBefore, nonce
//
// Six fields. There is NO resource, NO request digest, NO response digest, NO session, NO
// cumulative ceiling and NO token address. A Gateway authorization proves that an account agreed
// to pay an amount to a recipient inside a time window on a chain — and says nothing whatever
// about what was bought. Anything UNICA needs beyond that has to be bound in UNICA's own signed
// mandate, and this module exists partly to make that gap checkable rather than assumed.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, wordAddress, wordBytes32, wordUint} from "../../tools/unica-sign/abi.mjs";
import {recoverAddress} from "../../tools/unica-verify/secp256k1.mjs";

const utf8 = (s) => new TextEncoder().encode(s);
const hashOf = (s) => toHex(keccak256(utf8(s)));

/// Observed in `@circle-fin/x402-batching@2.0.4`, `dist/client/index.mjs`. Pinned as wire
/// constants: a character difference here is a digest no Gateway will accept.
export const GATEWAY_DOMAIN_NAME = "GatewayWalletBatched";
export const GATEWAY_DOMAIN_VERSION = "1";

export const AUTHORIZATION_TYPE =
  "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter," +
  "uint256 validBefore,bytes32 nonce)";

/// Arc testnet, as the demo application configures it. Recorded rather than trusted: every one of
/// these is asserted against the upstream source by this module's suite.
export const ARC_TESTNET = {
  network: "eip155:5042002",
  chainId: 5042002,
  usdc: "0x3600000000000000000000000000000000000000",
  usdcDecimals: 6,
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  facilitator: "https://gateway-api-testnet.circle.com",
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
};

/// The six fields the signature covers, in the order the type string declares them.
export const SIGNED_FIELDS = ["from", "to", "value", "validAfter", "validBefore", "nonce"];

/// What the signature does NOT cover. Written down as data rather than prose so a test can assert
/// it, and so any claim that a nanopayment "binds what an agent bought" has something to fail.
export const UNSIGNED_CONCERNS = [
  "resource", "requestDigest", "responseDigest", "sessionId",
  "cumulativeBudget", "perCallCeiling", "asset",
];

export function domainSeparator({chainId, verifyingContract}) {
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        wordBytes32(hashOf(GATEWAY_DOMAIN_NAME)),
        wordBytes32(hashOf(GATEWAY_DOMAIN_VERSION)),
        wordUint(chainId),
        wordAddress(verifyingContract),
      ),
    ),
  );
}

export function authorizationStructHash(a) {
  for (const f of SIGNED_FIELDS) {
    if (a[f] === undefined || a[f] === null) throw new Error(`authorization is missing ${f}`);
  }
  return toHex(
    keccak256(
      concat(
        wordBytes32(hashOf(AUTHORIZATION_TYPE)),
        wordAddress(a.from),
        wordAddress(a.to),
        wordUint(a.value),
        wordUint(a.validAfter),
        wordUint(a.validBefore),
        wordBytes32(a.nonce),
      ),
    ),
  );
}

/// The digest a payer's wallet is asked to sign.
export function authorizationDigest(a, {chainId, verifyingContract}) {
  return toHex(
    keccak256(
      concat(
        new Uint8Array([0x19, 0x01]),
        wordBytes32(domainSeparator({chainId, verifyingContract})),
        wordBytes32(authorizationStructHash(a)),
      ),
    ),
  );
}

export const AUTH_STATUS = {
  VALID: "VALID",
  MALFORMED_PAYLOAD: "MALFORMED_PAYLOAD",
  BAD_SIGNATURE: "BAD_SIGNATURE",
  SIGNER_IS_NOT_THE_PAYER: "SIGNER_IS_NOT_THE_PAYER",
  WRONG_RECIPIENT: "WRONG_RECIPIENT",
  WRONG_AMOUNT: "WRONG_AMOUNT",
  WRONG_CHAIN: "WRONG_CHAIN",
  WRONG_VERIFYING_CONTRACT: "WRONG_VERIFYING_CONTRACT",
  NOT_YET_VALID: "NOT_YET_VALID",
  EXPIRED: "EXPIRED",
  NONCE_REPLAYED: "NONCE_REPLAYED",
};

/// Verify a payment payload against what was asked for, LOCALLY.
///
/// This is the check `BatchFacilitatorClient` does not perform. It cannot tell you whether Circle
/// will settle the payment — only Circle knows the payer's Gateway balance and which nonces are
/// spent — but it does tell you, without asking anybody, that the account you think is paying
/// really signed for this recipient, this amount, this chain and this window.
///
/// @param seen a Set of nonces this verifier has already accepted, so a replay inside one session
///        is caught here rather than being discovered when Gateway refuses to settle it.
export function verifyAuthorization(payload, expected, seen = null) {
  const refuse = (status, detail) => ({ok: false, status, detail});
  const a = payload?.payload?.authorization;
  const signature = payload?.payload?.signature;
  if (!a || typeof signature !== "string") return refuse(AUTH_STATUS.MALFORMED_PAYLOAD, "no authorization or signature");

  if (Number(expected.chainId) !== Number(expected.observedChainId ?? expected.chainId)) {
    return refuse(AUTH_STATUS.WRONG_CHAIN);
  }

  let digest;
  let signer;
  try {
    digest = authorizationDigest(a, expected);
    signer = recoverAddress(digest, signature);
  } catch (e) {
    return refuse(AUTH_STATUS.BAD_SIGNATURE, e.message);
  }
  if (signer.toLowerCase() !== String(a.from).toLowerCase()) {
    return refuse(AUTH_STATUS.SIGNER_IS_NOT_THE_PAYER, `recovered ${signer}, authorization says ${a.from}`);
  }

  if (String(a.to).toLowerCase() !== String(expected.payTo).toLowerCase()) {
    return refuse(AUTH_STATUS.WRONG_RECIPIENT, `signed for ${a.to}, expected ${expected.payTo}`);
  }
  // Base units, compared as integers. A price formatted for a screen and then parsed back is how
  // a rounding difference becomes an accepted underpayment.
  if (BigInt(a.value) !== BigInt(expected.amount)) {
    return refuse(AUTH_STATUS.WRONG_AMOUNT, `signed ${a.value}, expected ${expected.amount}`);
  }

  const at = BigInt(expected.at ?? 0);
  if (at !== 0n) {
    if (at < BigInt(a.validAfter)) return refuse(AUTH_STATUS.NOT_YET_VALID, `valid from ${a.validAfter}, now ${at}`);
    if (at > BigInt(a.validBefore)) return refuse(AUTH_STATUS.EXPIRED, `valid until ${a.validBefore}, now ${at}`);
  }

  if (seen) {
    if (seen.has(a.nonce)) return refuse(AUTH_STATUS.NONCE_REPLAYED, a.nonce);
    seen.add(a.nonce);
  }

  return {ok: true, status: AUTH_STATUS.VALID, digest, signer, authorization: a};
}
