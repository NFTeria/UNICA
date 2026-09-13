/**
 * The customer's own ENS profile, read the way the chain answers it.
 *
 * The universal resolver's reverse(bytes,uint256) says which name a wallet claims as its primary
 * name. A claim is not a fact until the name's own addr record points back at the wallet, so the
 * name is shown only after that forward check passes. The avatar is the name's "avatar" text
 * record, read through the same resolve(bytes,bytes) entry point a business record is read
 * through, and only an https, ipfs or data reference is drawn — an NFT reference needs a second
 * lookup this release does not make. Sepolia only, because that is where ENSv2 lives here. Every
 * read is an eth_call through the page's own RPC; nothing is remembered and nothing is typed in.
 */
import { keccak256, toHex } from "../../../web/ensv2/keccak.mjs";
import { decodeAddress, decodeStringAt, encodeCall, wordsOf } from "./abi.js";
import { rpcRequest } from "./wallet.js";

export const ENS_CHAIN_ID = 11155111;
export const UNIVERSAL_RESOLVER = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe";
const REVERSE_SELECTOR = "0x5d78a217"; // reverse(bytes,uint256)
const RESOLVE_SELECTOR = "0x9061b923"; // resolve(bytes,bytes)
const COIN_TYPE_ETH = 60;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const bytes = (s) => new TextEncoder().encode(s);
const word = (hex) => String(hex).replace(/^0x/, "").padStart(64, "0");

/** namehash(name), as EIP-137 defines it: the empty name is 32 zero bytes. */
export function namehash(name) {
  let node = new Uint8Array(32);
  const labels = String(name ?? "").toLowerCase().split(".").filter(Boolean);
  for (const label of labels.reverse()) {
    const joined = new Uint8Array(64);
    joined.set(node, 0);
    joined.set(keccak256(bytes(label)), 32);
    node = keccak256(joined);
  }
  return toHex(node);
}

/** The DNS wire form of a name: each label length-prefixed, then a zero. */
export function dnsEncode(name) {
  const labels = String(name ?? "").toLowerCase().split(".").filter(Boolean);
  const out = [];
  for (const label of labels) {
    const b = bytes(label);
    if (b.length === 0 || b.length > 63) throw new Error(`label out of range: ${label}`);
    out.push(b.length, ...b);
  }
  out.push(0);
  return toHex(Uint8Array.from(out));
}

/** reverse(bytes lookupAddress, uint256 coinType) calldata: the address as 20 bytes, coin type 60. */
export function encodeReverseCall(address) {
  const addr = String(address).replace(/^0x/, "").toLowerCase();
  return REVERSE_SELECTOR + word("40") + word(COIN_TYPE_ETH.toString(16)) + word("14") + addr.padEnd(64, "0");
}

/** The (string name, address resolver, address reverseResolver) tuple reverse() returns; null when unreadable. */
export function decodeReverseReturn(hex) {
  const words = wordsOf(hex);
  if (words.length < 4) return null;
  try {
    const at = Number(BigInt("0x" + words[0]));
    return { name: decodeStringAt(hex, at), resolver: decodeAddress("0x" + words[1]), reverseResolver: decodeAddress("0x" + words[2]) };
  } catch {
    return null;
  }
}

/** resolve(bytes name, bytes data) calldata around an inner call. */
export function encodeResolveCall(dnsHex, innerHex) {
  const dns = String(dnsHex).replace(/^0x/, "");
  const inner = String(innerHex).replace(/^0x/, "");
  const pad = (h) => h + "0".repeat((64 - (h.length % 64)) % 64);
  const dnsLen = word((dns.length / 2).toString(16));
  const innerLen = word((inner.length / 2).toString(16));
  const dnsPart = dnsLen + pad(dns);
  const innerOffset = word((0x40 + dnsPart.length / 2).toString(16));
  return RESOLVE_SELECTOR + word("40") + innerOffset + dnsPart + innerLen + pad(inner);
}

/** The inner result bytes out of resolve()'s (bytes result, address resolver); null when unreadable. */
export function decodeResolveReturn(hex) {
  const words = wordsOf(hex);
  if (words.length < 3) return null;
  try {
    const at = Number(BigInt("0x" + words[0]));
    const raw = String(hex).replace(/^0x/, "");
    const len = Number(BigInt("0x" + raw.slice(at * 2, at * 2 + 64)));
    return { result: "0x" + raw.slice(at * 2 + 64, at * 2 + 64 + len * 2), resolver: decodeAddress("0x" + words[1]) };
  } catch {
    return null;
  }
}

/** An avatar record this page will draw: https, ipfs (through a public gateway) or data. Anything else is not drawn. */
export function avatarSource(record) {
  const v = String(record ?? "").trim();
  if (/^https:\/\//i.test(v) || /^data:image\//i.test(v)) return v;
  if (/^ipfs:\/\//i.test(v)) return "https://ipfs.io/ipfs/" + v.replace(/^ipfs:\/\/(ipfs\/)?/i, "");
  return null;
}

/**
 * A deterministic gradient for a name with no avatar record, as a CSS background value: two hues
 * from keccak256(name), so the same name always draws the same circle and two names rarely share
 * one. Written from the description of what a name-derived placeholder must do; no library.
 */
export function avatarFallback(name) {
  const digest = keccak256(bytes(String(name ?? "").toLowerCase()));
  const h1 = ((digest[0] << 8) | digest[1]) % 360;
  const h2 = (h1 + 40 + (digest[2] % 80)) % 360;
  return `radial-gradient(circle at 30% 30%, hsl(${h1} 72% 62%), hsl(${h2} 70% 38%))`;
}

function callerFor(config) {
  return async (to, data) => rpcRequest(config.rpc, "eth_call", [{ to, data }, "latest"]);
}

/**
 * The verified primary name of a wallet, or null: no name claimed, the claim's addr record does not
 * point back, the wrong network, or a read that failed. Never throws.
 */
export async function primaryName(config, address, call = callerFor(config)) {
  if (Number(config?.chainId) !== ENS_CHAIN_ID || !ADDRESS.test(String(address ?? ""))) return null;
  try {
    const claimed = decodeReverseReturn(await call(UNIVERSAL_RESOLVER, encodeReverseCall(address)));
    const name = String(claimed?.name ?? "").trim().toLowerCase();
    if (!name || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) return null;
    const answer = decodeResolveReturn(await call(UNIVERSAL_RESOLVER, encodeResolveCall(dnsEncode(name), encodeCall("addr(bytes32)", [namehash(name)]))));
    const forward = answer?.result && wordsOf(answer.result).length === 1 ? decodeAddress(answer.result) : null;
    return forward && forward.toLowerCase() === String(address).toLowerCase() ? name : null;
  } catch {
    return null;
  }
}

/** The avatar a name publishes, as something an <img> can show, or null. Never throws. */
export async function avatarOf(config, name, call = callerFor(config)) {
  if (Number(config?.chainId) !== ENS_CHAIN_ID || !name) return null;
  try {
    const answer = decodeResolveReturn(await call(UNIVERSAL_RESOLVER, encodeResolveCall(dnsEncode(name), encodeCall("text(bytes32,string)", [namehash(name), "avatar"]))));
    if (!answer?.result || answer.result === "0x") return null;
    return avatarSource(decodeStringAt(answer.result, Number(BigInt("0x" + wordsOf(answer.result)[0]))));
  } catch {
    return null;
  }
}

/** { name, avatar } for a wallet: both null when the wallet has no verified name. Never throws. */
export async function customerProfile(config, address, call = callerFor(config)) {
  const name = await primaryName(config, address, call);
  if (!name) return { name: null, avatar: null };
  return { name, avatar: await avatarOf(config, name, call) };
}
