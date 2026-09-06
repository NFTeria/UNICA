// keccak-256, written from FIPS-202 (the Keccak permutation) plus Ethereum's 0x01 domain byte.
//
// Why this file exists at all: the checkout has no build step, no bundler and no dependencies —
// that is a property of the surface worth keeping — and ENS name resolution needs namehash,
// which needs keccak-256. So it is implemented here from the specification rather than pulled in.
//
// Why namehash has to be RIGHT, rather than approximately right: measured on ENSv2 Sepolia on
// 2026-09-05, the two resolver families behave in opposite ways and neither complains about a
// mismatch. An ENSv1-style resolver answers from the NODE in the calldata and ignores the name it
// was reached by; an extended (wildcard) resolver answers from the NAME and ignores the node.
// Querying `ens.eth` while passing `raffy.eth`'s node returned raffy's address, with no revert.
// A wrong namehash is therefore not a failed lookup — it is a silent answer about a different
// name, and in this product that is a payment to the wrong merchant.
//
// Validated against published vectors and against `cast keccak` in test/keccak.test.mjs.

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets, indexed [x + 5y], from the specification's table.
const R = [
   0,  1, 62, 28, 27,
  36, 44,  6, 55, 20,
   3, 10, 43, 25, 39,
  41, 45, 15, 21,  8,
  18,  2, 61, 56, 14,
];

const M = (1n << 64n) - 1n;
const rotl = (x, n) => n === 0 ? x : (((x << BigInt(n)) | (x >> BigInt(64 - n))) & M);

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    // theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D;
    }
    // rho and pi
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], R[x + 5 * y]);
      }
    }
    // chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & M & B[(x + 2) % 5 + 5 * y]);
      }
    }
    // iota
    A[0] ^= RC[round];
  }
  return A;
}

/** keccak-256 of a byte array, returning 32 bytes. */
export function keccak256(bytes) {
  const RATE = 136; // 1088 bits, the rate for a 256-bit digest
  const input = Uint8Array.from(bytes);

  // Ethereum uses the original Keccak padding: 0x01 … 0x80, not SHA3-256's 0x06.
  const padLen = RATE - (input.length % RATE);
  const padded = new Uint8Array(input.length + padLen);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  let A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      A[i] ^= lane;
    }
    A = keccakF(A);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}

export const toHex = (bytes) => "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const keccak256Hex = (bytes) => toHex(keccak256(bytes));
