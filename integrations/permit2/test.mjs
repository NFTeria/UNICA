// UNICA — the offline half of the Permit2 digest gate.
//
// Run: node integrations/permit2/test.mjs
//
// These rows check the JavaScript derivation against fixed vectors and against the structural
// requirements of EIP-712 and Permit2's type string composition. The SAME vector is pinned in
// `test/v2/Permit2Witness.t.sol`, where Solidity recomputes it independently and the deployed
// Permit2 runtime accepts a signature over it. Neither side was written from the other.

import {
  PAYMENT_TYPE,
  TOKEN_PERMISSIONS_TYPE,
  WITNESS_TYPE_STRING,
  PERMIT_WITNESS_TRANSFER_FROM_STUB,
  domainSeparator,
  paymentWitness,
  signingDigest,
  tokenPermissionsHash,
  typeHash,
  wordAddress,
  wordUint,
  bytesFromHex,
} from "./digest.mjs";

// ---- the vector, byte-for-byte the one pinned in the Solidity suite --------------------------
const V = {
  chainId: 11155111,
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  token: "0x7000000000000000000000000000000000000001",
  payer: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7", // vm.addr(0xA11CE)
  executor: "0xE7eC000000000000000000000000000000000001",
  destination: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543", // v4 PoolManager, Sepolia
  maxIn: 5000000000000000000n,
  nonce: 0,
  deadline: 1800000000,
};

const EXPECT = {
  quoteId: "0x72663bffbbd613d1f081e43d7f654b75f1ee32528bf207889f1161313248f63c",
  domain: "0x94c1dec87927751697bfc9ebf6fc4ca506bed30308b518f0e9d6c5f74bbafdb8",
  witness: "0x06529508d5f41365e7a88f31508e353f8802b22a74109598386b59c84859166a",
  digest: "0x68840f3503a85188f7fc526fbdbd889d592ef3cb54bbc50af4a79eee20a8f1f2",
};

let passed = 0;
let failed = 0;
const rows = [];

function check(name, actual, expected) {
  const ok = actual === expected;
  rows.push(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    rows.push(`        expected ${expected}`);
    rows.push(`        got      ${actual}`);
    failed++;
  } else {
    passed++;
  }
}

function checkTrue(name, cond, why) {
  rows.push(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) {
    rows.push(`        ${why}`);
    failed++;
  } else {
    passed++;
  }
}

function throws(name, fn) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  checkTrue(name, threw, "expected this to be rejected, and it was accepted");
}

// ---- the pinned vector -------------------------------------------------------------------
const quoteId = typeHash("unica.v2.permit2.vector.1");
check("quote id", quoteId, EXPECT.quoteId);
check("domain separator", domainSeparator({chainId: V.chainId, verifyingContract: V.permit2}), EXPECT.domain);

const witness = paymentWitness({
  quoteId,
  payer: V.payer,
  tokenIn: V.token,
  maxIn: V.maxIn,
  destination: V.destination,
  executor: V.executor,
});
check("payment witness", witness, EXPECT.witness);
check(
  "signing digest",
  signingDigest({
    chainId: V.chainId,
    permit2: V.permit2,
    permitted: {token: V.token, amount: V.maxIn},
    spender: V.executor,
    nonce: V.nonce,
    deadline: V.deadline,
    witness,
  }),
  EXPECT.digest,
);

// ---- structure, so a silent reshaping of the type string is caught here --------------------
checkTrue(
  "the witness type string opens by closing Permit2's parenthesis",
  WITNESS_TYPE_STRING.startsWith("Payment witness)"),
  `starts with ${WITNESS_TYPE_STRING.slice(0, 20)}`,
);
checkTrue(
  "TokenPermissions closes the witness type string",
  WITNESS_TYPE_STRING.endsWith(TOKEN_PERMISSIONS_TYPE),
  "EIP-712 orders referenced structs alphabetically; Payment sorts before TokenPermissions",
);
checkTrue(
  "the Payment struct appears exactly once in the witness type string",
  WITNESS_TYPE_STRING.split(PAYMENT_TYPE).length === 2,
  "a struct described twice is a struct that can disagree with itself",
);
checkTrue(
  "Permit2's domain carries no version field",
  !PERMIT_WITNESS_TRANSFER_FROM_STUB.includes("version"),
  "a generic EIP-712 helper adds one, and the digest is then wrong in every wallet",
);

// ---- the encoders refuse what they cannot encode --------------------------------------------
throws("a 19-byte address is rejected", () => wordAddress("0x11223344556677889900aabbccddeeff001122"));
throws("a negative amount is rejected", () => wordUint(-1n));
throws("an amount past 2^256 is rejected", () => wordUint(1n << 256n));
throws("odd-length hex is rejected", () => bytesFromHex("0xabc"));
throws("a non-hex string is rejected", () => bytesFromHex("nope"));

// ---- a control: the digest MOVES when any signed field moves --------------------------------
const base = signingDigest({
  chainId: V.chainId,
  permit2: V.permit2,
  permitted: {token: V.token, amount: V.maxIn},
  spender: V.executor,
  nonce: V.nonce,
  deadline: V.deadline,
  witness,
});
const moved = {
  "a different chain": {chainId: 1},
  "a different spender": {spender: "0x0000000000000000000000000000000000000BAD"},
  "a different nonce": {nonce: 1},
  "a different deadline": {deadline: V.deadline + 1},
  "a different ceiling": {permitted: {token: V.token, amount: V.maxIn + 1n}},
  "a different witness": {witness: EXPECT.quoteId},
};
for (const [label, override] of Object.entries(moved)) {
  const d = signingDigest({
    chainId: V.chainId,
    permit2: V.permit2,
    permitted: {token: V.token, amount: V.maxIn},
    spender: V.executor,
    nonce: V.nonce,
    deadline: V.deadline,
    witness,
    ...override,
  });
  checkTrue(`${label} changes the digest`, d !== base, "the field is not inside the signature");
}

// The token is inside TokenPermissions, so it must move the digest through that hash.
checkTrue(
  "a different token changes the permitted hash",
  tokenPermissionsHash({token: V.destination, amount: V.maxIn}) !==
    tokenPermissionsHash({token: V.token, amount: V.maxIn}),
  "the token is not inside the signature",
);

console.log("UNICA — Permit2 offline digest derivation");
console.log(rows.join("\n"));
console.log(`\nrows run: ${passed + failed}, passed: ${passed}, failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
