// ENSv2 merchant resolution for the UNICA checkout — resolve once, then bind.
//
// WHAT THIS IS FOR. A merchant is identified by an ENSv2 name. The checkout resolves that name
// live on Sepolia, validates the answer, shows the payer the address, and binds exactly that
// address into the frozen V1 order. ENS supplies discovery; the settlement contracts supply
// enforcement. Nothing here runs inside a hook callback, and nothing here can change an order
// that already exists.
//
// WHAT IT IS NOT. It does not verify a merchant's identity, prove they are legitimate, execute
// the swap, prove payment, or guarantee fulfilment. It answers one question — which address does
// this name currently point at — and it refuses to guess when it cannot answer.
//
// THE FAILURE SHAPES ARE NOT ALL REVERTS. Measured on Sepolia, 2026-09-05: of the three ways a
// lookup fails, only one reverts. A name with no resolver anywhere reverts ResolverNotFound. But
// an unregistered subname under a wildcard parent SUCCEEDS and returns the zero address, and a
// registered name with no address record SUCCEEDS and returns the zero address. An integration
// that catches reverts and nothing else hands address(0) to createOrder. Every caller of this
// module gets a classified status, never a bare address.
//
// AND THE NODE MUST BE RIGHT. Also measured: the two resolver families disagree about which
// argument decides the answer, and neither errors on a mismatch. An ENSv1-style resolver answers
// from the node in the calldata; an extended resolver answers from the name. Asking for `ens.eth`
// while passing `raffy.eth`'s node returned raffy's address. A wrong namehash is not a failed
// lookup, it is a confident answer about a different name — which in a payment product means the
// wrong merchant. namehash is therefore computed here, from keccak, and never delegated.
//
// Interface taken from https://docs.ens.domains/ensv2/universal-resolver-v2 (documentation is
// CC0-1.0), retrieved 2026-09-05. No ENS implementation source is copied: `ensdomains/contracts-v2`
// publishes no licence, so only the documented signature is used.

import { keccak256, toHex } from "./keccak.mjs";

export const ENSV2 = {
  chainId: 11155111,
  chainName: "Ethereum Sepolia",
  // UpgradableUniversalResolverProxy — the fixed entry point. Checksum recomputed and the runtime
  // read back on 2026-09-05: 2491 bytes, codehash 0xf7ead24f8e5e731683ed38f7cd5052db9e3e8150fb2b5bc76c1a1bb450af74c5
  entryPoint: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
  // Selectors, each computed with `cast sig` and pinned beside its signature.
  sel: { resolve: "0x9061b923", addr: "0x3b3b57de" },   // resolve(bytes,bytes) · addr(bytes32)
  err: {
    "0x77209fe8": "RESOLVER_NOT_FOUND",          // ResolverNotFound(bytes)
    "0x1e9535f2": "RESOLVER_NOT_CONTRACT",       // ResolverNotContract(bytes,address)
    "0x7b1c461b": "UNSUPPORTED_PROFILE",         // UnsupportedResolverProfile(bytes4)
    "0x556f1830": "OFFCHAIN_LOOKUP",             // OffchainLookup(address,string[],bytes,bytes4,bytes)
  },
  docs: "https://docs.ens.domains/ensv2/universal-resolver-v2",
  retrieved: "2026-09-05",
};

const ZERO = "0x0000000000000000000000000000000000000000";
const utf8 = (s) => new TextEncoder().encode(s);

/**
 * Normalise a typed name, conservatively.
 *
 * Full ENSIP-15 normalisation needs a large Unicode table this surface deliberately does not
 * carry. Rather than approximate it — which is how a homograph reaches a payer — anything
 * outside a conservative ASCII subset is REFUSED, with a status saying so. A name we cannot
 * normalise correctly is a name we do not resolve.
 */
export function normalizeName(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, status: "EMPTY_NAME" };
  const name = raw.toLowerCase();
  if (name !== raw && /[^\x00-\x7F]/.test(raw)) return { ok: false, status: "NON_ASCII_NAME" };
  if (/[^a-z0-9.\-]/.test(name)) return { ok: false, status: "NON_ASCII_NAME" };
  const labels = name.split(".");
  if (labels.length < 2) return { ok: false, status: "MALFORMED_NAME" };
  for (const l of labels) {
    if (!l.length || l.length > 63) return { ok: false, status: "MALFORMED_NAME" };
    if (l.startsWith("-") || l.endsWith("-")) return { ok: false, status: "MALFORMED_NAME" };
  }
  return { ok: true, name, labels };
}

/** DNS wire format: each label length-prefixed, terminated by a zero byte. */
export function dnsEncode(name) {
  const parts = name.split(".").map(utf8);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 1));
  let i = 0;
  for (const p of parts) { out[i++] = p.length; out.set(p, i); i += p.length; }
  out[i] = 0;
  return toHex(out);
}

/** namehash, per ENSIP-1: fold labels right to left. */
export function namehash(name) {
  let node = new Uint8Array(32);
  for (const label of name.split(".").reverse()) {
    const lh = keccak256(utf8(label));
    const buf = new Uint8Array(64);
    buf.set(node, 0); buf.set(lh, 32);
    node = keccak256(buf);
  }
  return toHex(node);
}

const pad32 = (hexNo0x) => hexNo0x.padStart(64, "0");

/** ABI-encode resolve(bytes name, bytes data) — two dynamic arguments. */
export function encodeResolveCall(dnsHex, innerHex) {
  const enc = (hex) => {
    const body = hex.slice(2);
    const len = pad32((body.length / 2).toString(16));
    const padded = body.padEnd(Math.ceil(body.length / 64) * 64, "0");
    return len + padded;
  };
  const nameBlob = enc(dnsHex), dataBlob = enc(innerHex);
  const offName = pad32((64).toString(16));
  const offData = pad32((64 + nameBlob.length / 2).toString(16));
  return ENSV2.sel.resolve + offName + offData + nameBlob + dataBlob;
}

/** Decode (bytes result, address resolver); returns null if the shape is not that. */
export function decodeResolveReturn(hex) {
  const b = (hex || "").startsWith("0x") ? hex.slice(2) : hex;
  if (b.length < 64 * 4) return null;                       // two heads, a length, a word
  const resolver = "0x" + b.slice(64 + 24, 128);
  const off = parseInt(b.slice(0, 64), 16);
  if (!Number.isFinite(off) || off * 2 + 64 > b.length) return null;
  const len = parseInt(b.slice(off * 2, off * 2 + 64), 16);
  if (!Number.isFinite(len)) return null;
  const result = "0x" + b.slice(off * 2 + 64, off * 2 + 64 + len * 2);
  return { result, resolver, resultLen: len };
}

/**
 * Resolve a merchant name to a recipient address.
 *
 * `rpcCall(to, data)` is injected so this module holds no endpoint, needs no key, and is
 * testable without a network. It must return the raw hex result or throw with `.data` set to
 * revert data when the call reverts.
 *
 * Returns { ok, status, ... }. `ok` is true only for a non-zero address on the expected chain.
 */
export async function resolveMerchant(input, rpcCall, opts = {}) {
  const chainId = opts.chainId ?? ENSV2.chainId;
  const entryPoint = opts.entryPoint ?? ENSV2.entryPoint;
  const base = { input: String(input ?? ""), chainId, entryPoint, docs: ENSV2.docs };

  if (chainId !== ENSV2.chainId) return { ...base, ok: false, status: "WRONG_CHAIN" };

  const norm = normalizeName(input);
  if (!norm.ok) return { ...base, ok: false, status: norm.status };

  const name = norm.name;
  const dns = dnsEncode(name);
  const node = namehash(name);
  const inner = ENSV2.sel.addr + node.slice(2);
  const meta = { ...base, name, dns, namehash: node };

  let raw;
  try {
    raw = await rpcCall(entryPoint, encodeResolveCall(dns, inner));
  } catch (e) {
    const data = (e && e.data) || (e && e.error && e.error.data) || "";
    const sig = typeof data === "string" && data.length >= 10 ? data.slice(0, 10) : "";
    const known = ENSV2.err[sig];
    if (known) return { ...meta, ok: false, status: known, revertSelector: sig };
    return { ...meta, ok: false, status: "RPC_FAILURE", detail: e && e.message ? e.message : String(e) };
  }

  const decoded = decodeResolveReturn(raw);
  if (!decoded) return { ...meta, ok: false, status: "MALFORMED_OUTER_RETURN", raw };

  // The inner result is an ABI-encoded address: exactly one word, twelve leading zero bytes.
  const inner32 = decoded.result;
  if (decoded.resultLen !== 32 || inner32.length !== 66) {
    return { ...meta, ok: false, status: "MALFORMED_INNER_RESULT", raw, resolver: decoded.resolver };
  }
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(inner32)) {
    return { ...meta, ok: false, status: "WRONG_LENGTH_ADDRESS", raw, resolver: decoded.resolver };
  }

  const recipient = "0x" + inner32.slice(26);
  if (recipient.toLowerCase() === ZERO) {
    // The shape that does not revert: wildcard parent, or a registered name with no addr record.
    return { ...meta, ok: false, status: "ZERO_ADDRESS", resolver: decoded.resolver, recipient: null };
  }

  return {
    ...meta, ok: true, status: "RESOLVED",
    recipient, resolver: decoded.resolver, resolvedAt: opts.blockNumber ?? null,
  };
}

/** Human-readable, and deliberately blunt about what failed. */
export const EXPLAIN = {
  RESOLVED: "Resolved.",
  EMPTY_NAME: "Enter a merchant name.",
  MALFORMED_NAME: "That is not a well-formed ENS name.",
  NON_ASCII_NAME: "This checkout resolves plain ASCII names only, so that a lookalike name cannot be mistaken for another one.",
  WRONG_CHAIN: "Wrong network. Merchant names are resolved on Ethereum Sepolia.",
  RESOLVER_NOT_FOUND: "No resolver exists for that name.",
  RESOLVER_NOT_CONTRACT: "That name points at a resolver that is not a contract.",
  UNSUPPORTED_PROFILE: "That resolver does not answer address queries.",
  OFFCHAIN_LOOKUP: "That name resolves through an offchain gateway, which this checkout does not follow.",
  ZERO_ADDRESS: "That name resolves, but has no address record — so there is nobody to pay.",
  MALFORMED_OUTER_RETURN: "The resolver's reply could not be decoded.",
  MALFORMED_INNER_RESULT: "The resolver's reply was not an address.",
  WRONG_LENGTH_ADDRESS: "The resolver's reply was not an address.",
  RPC_FAILURE: "Could not reach the network to resolve that name.",
};
