/**
 * Encoding and decoding the shapes these screens send and read back, written from the Solidity ABI
 * specification rather than pulled from a library.
 *
 * WHY BY HAND. Everything these screens send is a handful of static words and a few dynamic
 * strings. A general-purpose encoder would be a dependency, a version and a supply chain for a
 * problem the specification describes in two paragraphs: a static argument is one 32-byte word, a
 * dynamic one puts the byte offset of its tail in the head and the length-plus-bytes in the tail.
 * The one thing not written here is keccak-256, which the ENSv2 layer already carries in a
 * browser-safe form and which every name derivation below depends on.
 *
 * THE SAME SPECIFIER RESOLVES IN BOTH PLACES. `node --test` reads web/ensv2/keccak.mjs off the
 * disk; a browser gets the identical bytes because script/anvil/serve.sh streams that exact
 * repository path. Nothing is copied to make that work.
 *
 * EVERY FUNCTION HERE IS PURE, and apps/web/tests/local-join.test.mjs checks the calldata against
 * calldata produced independently by a different tool.
 */
import { keccak256, toHex } from "../../../web/ensv2/keccak.mjs";

// ---- ABI encoding: static words and dynamic strings ---------------------------------------------

const stripHex = (h) => (typeof h === "string" && (h.startsWith("0x") || h.startsWith("0X")) ? h.slice(2) : h);
const WORD = 64;

export function wordFromAddress(address) {
  const h = stripHex(address).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`not a 20-byte address: ${address}`);
  return h.padStart(WORD, "0");
}

export function wordFromUint(value) {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n) throw new Error("uint256 is unsigned");
  const h = v.toString(16);
  if (h.length > WORD) throw new Error("value does not fit in 32 bytes");
  return h.padStart(WORD, "0");
}

export function wordFromBytes32(value) {
  const h = stripHex(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`not 32 bytes: ${value}`);
  return h;
}

export function wordFromBool(value) {
  return wordFromUint(value ? 1 : 0);
}

/** UTF-8 bytes of `s`, as hex, right-padded to a whole number of 32-byte words. */
export function paddedUtf8Hex(s) {
  const bytes = new TextEncoder().encode(String(s));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  const remainder = hex.length % WORD;
  if (remainder !== 0) hex += "0".repeat(WORD - remainder);
  return { hex, byteLength: bytes.length };
}

const isDynamic = (type) => type === "string" || type === "bytes";

const UINT_N = /^uint(\d+)$/;
const INT_N = /^int(\d+)$/;
const BYTES_N = /^bytes(\d+)$/;

/** A sized unsigned integer: one word, refused when the value does not fit its declared width. */
function wordFromSizedUint(value, bits) {
  const v = BigInt(value);
  if (v < 0n || v >= 1n << BigInt(bits)) throw new Error(`value does not fit uint${bits}`);
  return wordFromUint(v);
}

/** A sized signed integer: two's complement in one word, refused when out of range. */
function wordFromSizedInt(value, bits) {
  const v = BigInt(value);
  const half = 1n << BigInt(bits - 1);
  if (v < -half || v >= half) throw new Error(`value does not fit int${bits}`);
  return wordFromUint(v < 0n ? (1n << 256n) + v : v);
}

/** bytesN: the N bytes left-aligned in the word, the rest zero. */
function wordFromSizedBytes(value, n) {
  const hex = String(value ?? "").replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex) || hex.length !== n * 2) throw new Error(`bytes${n} needs exactly ${n} bytes`);
  return hex.padEnd(64, "0");
}

function encodeStatic(type, value) {
  switch (type) {
    case "address": return wordFromAddress(value);
    case "uint256": return wordFromUint(value);
    case "bytes32": return wordFromBytes32(value);
    case "bool": return wordFromBool(value);
    default: {
      let m;
      if ((m = UINT_N.exec(type))) { const bits = Number(m[1]); if (bits % 8 === 0 && bits >= 8 && bits <= 256) return wordFromSizedUint(value, bits); }
      if ((m = INT_N.exec(type))) { const bits = Number(m[1]); if (bits % 8 === 0 && bits >= 8 && bits <= 256) return wordFromSizedInt(value, bits); }
      if ((m = BYTES_N.exec(type))) { const n = Number(m[1]); if (n >= 1 && n <= 32) return wordFromSizedBytes(value, n); }
      throw new Error(`unsupported static type: ${type}`);
    }
  }
}

function encodeDynamic(type, value) {
  if (type !== "string") throw new Error(`unsupported dynamic type: ${type}`);
  const { hex, byteLength } = paddedUtf8Hex(value);
  return wordFromUint(byteLength) + hex;
}

/**
 * Encode `values` as the argument tuple for `types`. Static arguments occupy one head word each;
 * a dynamic argument's head word is the byte offset of its tail, measured from the start of the
 * tuple, and the tails follow the head in argument order.
 */
export function abiEncode(types, values) {
  if (types.length !== values.length) throw new Error(`expected ${types.length} values, got ${values.length}`);
  const headBytes = types.length * 32;
  const heads = [];
  const tails = [];
  let tailBytes = 0;
  for (let i = 0; i < types.length; i++) {
    if (isDynamic(types[i])) {
      const tail = encodeDynamic(types[i], values[i]);
      heads.push(wordFromUint(headBytes + tailBytes));
      tails.push(tail);
      tailBytes += tail.length / 2;
    } else {
      heads.push(encodeStatic(types[i], values[i]));
    }
  }
  return heads.join("") + tails.join("");
}

export function selectorOf(signature) {
  return toHex(keccak256(new TextEncoder().encode(signature)).slice(0, 4));
}

/** keccak-256 of an event signature: the first topic of every log that event emits. */
export function topicOf(signature) {
  return toHex(keccak256(new TextEncoder().encode(signature)));
}

export function typesOf(signature) {
  const inner = signature.slice(signature.indexOf("(") + 1, signature.lastIndexOf(")"));
  return inner === "" ? [] : inner.split(",").map((t) => t.trim());
}

/** Selector plus encoded arguments: the `data` field of a call or a transaction. */
export function encodeCall(signature, values) {
  return selectorOf(signature) + abiEncode(typesOf(signature), values);
}

// ---- ABI decoding of what the chain answers -----------------------------------------------------

export function wordsOf(hex) {
  const h = stripHex(hex ?? "");
  const out = [];
  for (let i = 0; i + WORD <= h.length; i += WORD) out.push(h.slice(i, i + WORD));
  return out;
}

export function decodeBool(hex) {
  return BigInt("0x" + (wordsOf(hex)[0] ?? "0")) !== 0n;
}

export function decodeBytes32(hex) {
  const w = wordsOf(hex)[0];
  return w ? "0x" + w : null;
}

export function decodeUint(hex) {
  const w = wordsOf(hex)[0];
  return w ? BigInt("0x" + w) : null;
}

export function decodeAddress(hex) {
  const w = wordsOf(hex)[0];
  return w ? "0x" + w.slice(24) : null;
}

/** Decode one `string` at byte offset `at` of the tuple `hex` (the offset a head word named). */
export function decodeStringAt(hex, at) {
  const h = stripHex(hex);
  const start = at * 2;
  const length = Number(BigInt("0x" + h.slice(start, start + WORD)));
  const data = h.slice(start + WORD, start + WORD + length * 2);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = parseInt(data.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

/** A function that returns a single `string`: head word is the offset, then length, then bytes. */
export function decodeString(hex) {
  const words = wordsOf(hex);
  if (words.length < 2) return "";
  return decodeStringAt(hex, Number(BigInt("0x" + words[0])));
}

const ZERO32 = "0x" + "0".repeat(64); // bytes32 zero: "nobody joined with it" in the interface
export function isZeroBytes32(value) {
  return !value || String(value).toLowerCase() === ZERO32;
}

export const BUSINESS_JOINED_SIGNATURE = "BusinessJoined(bytes32,address,string,address,bytes32,bytes32,uint256)";
export const SUBNAME_REGISTERED_SIGNATURE = "SubnameRegistered(bytes32,bytes32,string,address)";
export const ROLES_GRANTED_SIGNATURE = "RolesGranted(uint256,uint256,address)";
export const ROLES_REVOKED_SIGNATURE = "RolesRevoked(uint256,uint256,address)";

/** `BusinessJoined`: topics carry merchantNode and owner; data carries the rest. */
export function decodeBusinessJoinedLog(log) {
  const topics = log?.topics ?? [];
  if (topics.length !== 3) return null;
  const words = wordsOf(log.data);
  if (words.length < 5) return null;
  return {
    merchantNode: topics[1],
    owner: "0x" + stripHex(topics[2]).slice(24),
    label: decodeStringAt(log.data, Number(BigInt("0x" + words[0]))),
    payout: "0x" + words[1].slice(24),
    terminalsNode: "0x" + words[2],
    firstTerminalNode: "0x" + words[3],
    badgeTokenId: BigInt("0x" + words[4]),
  };
}

/** `SubnameRegistered`: topics carry parent and node; data carries label and owner. */
export function decodeSubnameRegisteredLog(log) {
  const topics = log?.topics ?? [];
  if (topics.length !== 3) return null;
  const words = wordsOf(log.data);
  if (words.length < 2) return null;
  return {
    parent: topics[1],
    node: topics[2],
    label: decodeStringAt(log.data, Number(BigInt("0x" + words[0]))),
    owner: "0x" + words[1].slice(24),
  };
}

/**
 * Replay grant and revoke logs in chain order and return the accounts that currently hold the
 * role. A revoke after a grant removes the account; a grant after a revoke restores it.
 */
export function foldRoleEvents(events) {
  const held = new Set();
  const sorted = [...events].sort((a, b) => {
    const blockDelta = Number(BigInt(a.blockNumber ?? 0)) - Number(BigInt(b.blockNumber ?? 0));
    if (blockDelta !== 0) return blockDelta;
    return Number(BigInt(a.logIndex ?? 0)) - Number(BigInt(b.logIndex ?? 0));
  });
  for (const ev of sorted) {
    const account = ("0x" + stripHex(ev.topics?.[2] ?? "").slice(24)).toLowerCase();
    if (ev.kind === "granted") held.add(account);
    else if (ev.kind === "revoked") held.delete(account);
  }
  return [...held];
}

// ---- name math, the same derivations the fixture uses -------------------------------------------

function hexToBytes(hex) {
  const h = stripHex(hex);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** keccak256(parent ‖ keccak256(label)): the node of `<label>.<parent>`, as namehash defines it. */
export function childNode(parentNode, label) {
  const labelHash = keccak256(new TextEncoder().encode(label));
  const packed = new Uint8Array(64);
  packed.set(hexToBytes(parentNode), 0);
  packed.set(labelHash, 32);
  return toHex(keccak256(packed));
}

/** uint256(keccak256(abi.encode(node, keccak256(key)))): the per-key text resource. */
export function textResource(node, key) {
  const keyHash = keccak256(new TextEncoder().encode(key));
  const packed = new Uint8Array(64);
  packed.set(hexToBytes(node), 0);
  packed.set(keyHash, 32);
  return toHex(keccak256(packed));
}
