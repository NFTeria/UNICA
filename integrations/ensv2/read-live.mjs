// The live read path: every UNICA record comes off the real UniversalResolver on Sepolia, or it
// does not come at all.
//
// THE PROPERTY THIS FILE EXISTS TO HOLD. There is no fixture fallback in live mode, and it is not
// a discipline — it is a shape. `createLiveReader` takes an endpoint and nothing else. It has no
// parameter that can carry a transport, a stub, a cache, a record, or a default answer, so there
// is no argument a caller could pass that would make it return something the chain did not say.
// When the endpoint fails, the reader refuses by name. It never returns a record it did not read.
//
// WHY THAT IS WORTH A WHOLE MODULE. The tempting shape is one reader with an optional `fixtures`
// argument, live in production and stubbed in tests. It works until the day the endpoint is down
// and someone has left the fixtures wired in, and then a checkout resolves a merchant from a file
// in the repository and pays whoever that file names. The failure is silent, it is total, and it
// looks exactly like success. So the two readers are two functions, and the live one has no door.
//
// HOW TESTS READ WITHOUT THE NETWORK. `createReaderOverTransport` — a separate factory, named for
// what it is. Everything it returns is stamped `evidence: "INJECTED_TRANSPORT"`, and that stamp is
// a literal inside the factory, not something a caller can supply: `assertLiveEvidence` and the
// preflight in `merchant-config.mjs` refuse anything that is not `LIVE_RPC` when they are asked
// for a live answer. An offline reader cannot pass itself off as a live one, because the word it
// would have to say about itself is not in its vocabulary.
//
// EVERY CALL RESOLVES AGAIN. There is no cache. A merchant's records are mutable state and a
// checkout that reuses a resolution from ninety seconds ago is quoting a name that may already
// point somewhere else. The request count is exposed so a test can prove that two reads made two
// resolutions rather than one read and one memory.
//
// THE ENDPOINT IS NEVER PRINTED. `redactRpc` is the only thing that ever renders it, and it
// renders the origin. This repository is public and provider URLs carry their key in the path.

import {toHex} from "../../web/ensv2/keccak.mjs";
import {utf8, wordUint} from "../permit2/digest.mjs";
import {ENSV2, dnsEncode, encodeResolveCall, decodeResolveReturn, namehash, normalizeName} from "../../web/ensv2/resolve.mjs";
import {SELECTOR, redactRpc, decodeRevert} from "./permissioned.mjs";
import {RECORD_KEY, SCHEMAS, decodeRecord} from "./records.mjs";

export const EVIDENCE = {
  LIVE_RPC: "LIVE_RPC",
  INJECTED_TRANSPORT: "INJECTED_TRANSPORT",
};

export const LIVE_STATUS = {
  READ: "READ",
  RECORD_MISSING: "RECORD_MISSING",
  NAME_REFUSED: "NAME_REFUSED",
  WRONG_CHAIN: "WRONG_CHAIN",
  RESOLVER_NOT_FOUND: "RESOLVER_NOT_FOUND",
  UNSUPPORTED_PROFILE: "UNSUPPORTED_PROFILE",
  OFFCHAIN_LOOKUP: "OFFCHAIN_LOOKUP",
  REVERTED: "REVERTED",
  MALFORMED_OUTER_RETURN: "MALFORMED_OUTER_RETURN",
  MALFORMED_TEXT_RETURN: "MALFORMED_TEXT_RETURN",
  MALFORMED_RECORD: "MALFORMED_RECORD",
  RPC_FAILURE: "RPC_FAILURE",
};

export const LIVE_EXPLAIN = {
  READ: "Read from the chain.",
  RECORD_MISSING: "That name publishes no record under that key.",
  NAME_REFUSED: "That is not a name this build will resolve.",
  WRONG_CHAIN: "The endpoint answered for a different chain.",
  RESOLVER_NOT_FOUND: "No resolver exists for that name.",
  UNSUPPORTED_PROFILE: "That resolver does not answer text queries.",
  OFFCHAIN_LOOKUP: "That name resolves through an offchain gateway, which this reader does not follow.",
  REVERTED: "The resolver refused the read.",
  MALFORMED_OUTER_RETURN: "The UniversalResolver's reply could not be decoded.",
  MALFORMED_TEXT_RETURN: "The resolver's reply was not a string.",
  MALFORMED_RECORD: "That name publishes something under that key that is not a UNICA record.",
  RPC_FAILURE: "Could not reach the network.",
};

const hexBody = (h) => String(h ?? "").replace(/^0x/, "").toLowerCase();
const w = (b) => hexBody(toHex(b));

/// ABI-encode `text(bytes32 node, string key)`. Two arguments, the second dynamic: the head is the
/// node word and an offset of 0x40, then the string's length and its bytes padded to a word.
///
/// The selector is DERIVED in `permissioned.mjs` from the signature string, never typed here. A
/// wrong selector on a resolver comes back as an empty return, an empty return decodes as an empty
/// string, and an empty string is RECORD_MISSING — a wrong four bytes would therefore report every
/// merchant on earth as having published nothing, which is the failure shape that looks calm.
export function encodeTextCall(node, key) {
  const bytes = utf8(String(key));
  const body = w(bytes);
  return SELECTOR.text + hexBody(node) + w(wordUint(0x40)) + w(wordUint(bytes.length)) +
    body.padEnd(Math.ceil(body.length / 64) * 64, "0");
}

/// Decode `abi.encode(string)`. Returns the string, or a reason why the bytes are not that shape.
///
/// The offset word is checked against 0x20 rather than followed. A non-standard offset is legal
/// ABI and no honest encoder emits one; following it here would mean this decoder accepts two
/// different byte strings for one value, which is the same malleability `records.mjs` refuses.
///
/// ZERO BYTES IS NOT AN EMPTY STRING, and conflating them is the mistake this repository has
/// already made once elsewhere. An unset text record comes back as a properly encoded empty string
/// — offset 0x20, length 0, verified against the live deployment on 2026-09-09 by asking raffy.eth
/// for a key it does not publish. Zero bytes back means something else entirely: a selector that
/// reached no dispatch arm, or an address with no code. Reporting that as "the merchant publishes
/// nothing" would turn "we could not ask" into a fact about the merchant.
export function decodeStringReturn(hex) {
  const b = hexBody(hex);
  if (b.length === 0) {
    return {ok: false, why: "zero bytes back — that is an empty RETURN, not an encoded empty string"};
  }
  if (b.length < 128) return {ok: false, why: `only ${b.length / 2} bytes back`};
  if (BigInt("0x" + b.slice(0, 64)) !== 0x20n) return {ok: false, why: "the string offset is not 0x20"};
  const len = Number(BigInt("0x" + b.slice(64, 128)));
  if (!Number.isSafeInteger(len)) return {ok: false, why: "the string length is not a usable number"};
  const need = 128 + len * 2;
  if (b.length < need) return {ok: false, why: `declared ${len} bytes, ${(b.length - 128) / 2} present`};
  // Trailing padding must be zero. Non-zero padding means the same string arrived with different
  // bytes, and this reader hashes the bytes it was served.
  const padding = b.slice(need);
  if (/[^0]/.test(padding)) return {ok: false, why: "the string padding is not zero"};
  const raw = b.slice(128, need);
  const arr = Uint8Array.from((raw.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  return {ok: true, value: new TextDecoder("utf-8", {fatal: false}).decode(arr)};
}

const ERR_STATUS = {
  RESOLVER_NOT_FOUND: LIVE_STATUS.RESOLVER_NOT_FOUND,
  RESOLVER_NOT_CONTRACT: LIVE_STATUS.RESOLVER_NOT_FOUND,
  UNSUPPORTED_PROFILE: LIVE_STATUS.UNSUPPORTED_PROFILE,
  OFFCHAIN_LOOKUP: LIVE_STATUS.OFFCHAIN_LOOKUP,
};

// ── the reader ────────────────────────────────────────────────────────────────────────────────
//
// One implementation, two doors. `evidence` is a literal supplied by each door and is never read
// from an options object, so no caller can dress an injected transport as a live read.

function makeReader(transport, evidence, {chainId, entryPoint, label, extraStats = {}}) {
  let calls = 0, resolves = 0;
  let observedChain = null;

  /// Ask the endpoint which chain it is, once, and remember only the ANSWER — never a record.
  /// Caching a chain id is safe in a way that caching a record is not: a chain id that changed
  /// under a live endpoint means the endpoint was swapped, and the code-hash checks in
  /// `merchant-config.mjs` catch that separately.
  async function ensureChain() {
    if (observedChain !== null) return observedChain;
    calls++;
    observedChain = Number(await transport("eth_chainId", []));
    return observedChain;
  }

  async function call(to, data) {
    calls++;
    return transport("eth_call", [{to, data}, "latest"]);
  }

  /// The same transport, in the shape `permissioned.mjs` already takes.
  ///
  /// The Enhanced Access Control reads — who may edit this merchant's records — are already
  /// written there, correctly, against a `{call, getCode, getStorageAt}` object. Exposing that
  /// shape here means the authorization check runs over the SAME endpoint as the record read, in
  /// the same run, rather than over a second connection that could be pointed somewhere else. It
  /// also means there is one implementation of those reads in this repository instead of two.
  const chainView = {
    call: (to, data) => call(to, data),
    getCode: (address) => { calls++; return transport("eth_getCode", [address, "latest"]); },
    getStorageAt: (address, slot) => { calls++; return transport("eth_getStorageAt", [address, slot, "latest"]); },
    chainId: () => ensureChain(),
  };

  /// One resolution through the fixed entry point. Never memoised.
  async function resolveThrough(name, inner) {
    const norm = normalizeName(name);
    if (!norm.ok) return {ok: false, status: LIVE_STATUS.NAME_REFUSED, detail: norm.status, name: String(name ?? "")};

    let chain;
    try { chain = await ensureChain(); } catch (e) {
      return {ok: false, status: LIVE_STATUS.RPC_FAILURE, detail: e?.message ?? String(e), name: norm.name};
    }
    if (chain !== chainId) {
      return {ok: false, status: LIVE_STATUS.WRONG_CHAIN, expected: chainId, observed: chain, name: norm.name};
    }

    const node = namehash(norm.name);
    const dns = dnsEncode(norm.name);
    resolves++;
    let raw;
    try {
      raw = await call(entryPoint, encodeResolveCall(dns, inner(node)));
    } catch (e) {
      const d = (e && e.data) || (e && e.error && e.error.data) || "";
      if (typeof d === "string" && d.length >= 10) {
        const known = ENSV2.err[d.slice(0, 10)];
        const named = decodeRevert(d);
        return {
          ok: false, status: ERR_STATUS[known] ?? LIVE_STATUS.REVERTED,
          revertSelector: d.slice(0, 10), revert: known ?? named.error, name: norm.name, node,
        };
      }
      return {ok: false, status: LIVE_STATUS.RPC_FAILURE, detail: e?.message ?? String(e), name: norm.name, node};
    }

    const outer = decodeResolveReturn(raw);
    if (!outer) return {ok: false, status: LIVE_STATUS.MALFORMED_OUTER_RETURN, raw, name: norm.name, node};
    return {ok: true, name: norm.name, node, dns, resolver: outer.resolver, result: outer.result, raw};
  }

  const stamp = (o) => ({...o, evidence, mode: label, chainId, entryPoint});

  /// One text record, exactly as served.
  ///
  /// Hoisted out of the returned object rather than written as a method, so that `readRecord` can
  /// call it directly. A method calling a sibling through `this` breaks the moment somebody writes
  /// `const {readRecord} = reader`, and it breaks by throwing inside a read — which is the least
  /// useful place for a wiring mistake to surface.
  async function readText(name, key) {
    const r = await resolveThrough(name, (node) => encodeTextCall(node, key));
    if (!r.ok) return stamp({...r, key});
    const s = decodeStringReturn(r.result);
    if (!s.ok) {
      return stamp({ok: false, status: LIVE_STATUS.MALFORMED_TEXT_RETURN, why: s.why, key,
                    name: r.name, node: r.node, resolver: r.resolver, raw: r.raw});
    }
    if (s.value === "") {
      return stamp({ok: false, status: LIVE_STATUS.RECORD_MISSING, key,
                    name: r.name, node: r.node, resolver: r.resolver});
    }
    return stamp({ok: true, status: LIVE_STATUS.READ, key, value: s.value,
                  name: r.name, node: r.node, resolver: r.resolver});
  }

  return {
    // Read-only, and the object says so where anything printing it will see it.
    kind: "ENSV2_RECORD_READER",
    mode: label,
    evidence,
    chainId,
    entryPoint,
    endpointLabel: () => label,

    /// The raw chain view, carried on the reader so an authorization read cannot silently be made
    /// against a different endpoint from the record read it is supposed to be about.
    chain: chainView,

    /// Requests issued, resolutions performed, and how many of them the endpoint had to be asked
    /// twice for. A test proves "no cache" with these, and a live run prints them — because a run
    /// that made three requests for six reads did something it did not say it was doing, and a run
    /// that needed ten retries is a weaker run than a clean one even when it is green.
    stats: () => ({calls, resolves, ...extraStats}),

    async blockNumber() {
      calls++;
      try { return Number(await transport("eth_blockNumber", [])); } catch { return null; }
    },

    async chainIdOf() {
      try { return await ensureChain(); } catch { return null; }
    },

    /// The address record, kept because a name that resolves to zero is the wildcard trap: it did
    /// not revert, and it is not evidence the name exists.
    async readAddr(name) {
      const r = await resolveThrough(name, (node) => SELECTOR.addr + hexBody(node));
      if (!r.ok) return stamp(r);
      if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(r.result)) {
        return stamp({ok: false, status: LIVE_STATUS.MALFORMED_TEXT_RETURN, why: "not an address word",
                      name: r.name, node: r.node, resolver: r.resolver});
      }
      const addr = "0x" + r.result.slice(26).toLowerCase();
      return stamp({ok: true, status: LIVE_STATUS.READ, name: r.name, node: r.node, resolver: r.resolver,
                    address: addr, isZero: /^0x0+$/.test(addr)});
    },

    readText,

    /// A text record plus the decode of it. The read and the decode are reported separately,
    /// because "the merchant published nothing" and "the merchant published nonsense" are
    /// different facts about that merchant and a validator treats them differently.
    async readRecord(schemaName, name) {
      const schema = SCHEMAS[schemaName];
      if (!schema) return stamp({ok: false, status: LIVE_STATUS.NAME_REFUSED, detail: `no such schema: ${schemaName}`});
      const t = await readText(name, schema.key);
      if (!t.ok) return {...t, schema: schemaName};
      const d = decodeRecord(schemaName, t.value);
      return stamp({
        ok: d.ok,
        status: d.ok ? LIVE_STATUS.READ : LIVE_STATUS.MALFORMED_RECORD,
        schema: schemaName, key: schema.key, name: t.name, node: t.node, resolver: t.resolver,
        value: t.value, decode: d, record: d.ok ? d.record : undefined,
      });
    },
  };
}

/// THE LIVE DOOR. An endpoint, and nothing else.
///
/// It builds its own transport from the platform's `fetch`. There is no parameter for a transport,
/// a fixture, a cache or a fallback, and an unrecognised option is a thrown error rather than an
/// ignored key — a typo'd option name that is silently dropped is how a safety switch ends up off.
export function createLiveReader(options = {}) {
  const allowed = new Set(["rpcUrl", "chainId", "entryPoint", "timeoutMs"]);
  for (const k of Object.keys(options)) {
    if (!allowed.has(k)) {
      throw new Error(
        `createLiveReader does not take ${JSON.stringify(k)}. It takes an endpoint and nothing else: ` +
        `there is deliberately no way to hand it data, so that a live read cannot be anything but a read.`,
      );
    }
  }
  const rpcUrl = options.rpcUrl;
  if (typeof rpcUrl !== "string" || !/^https?:\/\//.test(rpcUrl)) {
    throw new Error("createLiveReader needs an http(s) endpoint");
  }
  if (typeof globalThis.fetch !== "function") throw new Error("this runtime has no fetch, so there is no live path");

  const timeoutMs = options.timeoutMs ?? 20000;
  let id = 0;
  // Public and keyed Sepolia endpoints alike drop bodies under a burst of forty-odd sequential
  // reads — measured in this repository on 2026-09-09, where seven reads of one run came back with
  // a zero-byte HTTP 200 and every one of them succeeded on a later attempt. Transport failures are
  // therefore retried a bounded number of times and counted. A JSON-RPC error is NEVER retried: it
  // is the contract answering, and a revert is an answer.
  const stats = {retried: 0};
  const RETRIES = 4, BACKOFF_MS = 250;

  const once = async (method, params) => {
    id++;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await globalThis.fetch(rpcUrl, {
        method: "POST", headers: {"content-type": "application/json"}, signal: ac.signal,
        body: JSON.stringify({jsonrpc: "2.0", id, method, params}),
      });
      const text = await res.text();
      let j;
      // A truncated body is the endpoint, and it is named as the endpoint. Parsing it as a bug in
      // this file sends the reader looking in the wrong place.
      try { j = JSON.parse(text); } catch {
        throw new Error(`HTTP ${res.status} from ${redactRpc(rpcUrl)}: body is not JSON (${text.length} bytes) — transport, not contract`);
      }
      if (j.error) { const e = new Error(j.error.message); e.data = j.error.data; e.jsonRpc = true; throw e; }
      return j.result;
    } finally { clearTimeout(timer); }
  };

  const transport = async (method, params) => {
    let last;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try { return await once(method, params); } catch (e) {
        if (e && e.jsonRpc) throw e;
        last = e;
        if (attempt < RETRIES) { stats.retried++; await new Promise((r) => setTimeout(r, BACKOFF_MS * (attempt + 1))); }
      }
    }
    throw last;
  };

  return makeReader(transport, EVIDENCE.LIVE_RPC, {
    chainId: options.chainId ?? ENSV2.chainId,
    entryPoint: options.entryPoint ?? ENSV2.entryPoint,
    label: `LIVE ${redactRpc(rpcUrl)}`,
    extraStats: stats,
  });
}

/// THE OTHER DOOR, named for what it is.
///
/// Everything it returns carries `evidence: "INJECTED_TRANSPORT"`. That word is a literal here; it
/// is not read from the options, so this factory cannot be talked into claiming a live read. Use
/// it in tests, and nowhere a live answer is required.
export function createReaderOverTransport(transport, options = {}) {
  if (typeof transport !== "function") throw new Error("createReaderOverTransport needs a transport function");
  return makeReader(transport, EVIDENCE.INJECTED_TRANSPORT, {
    chainId: options.chainId ?? ENSV2.chainId,
    entryPoint: options.entryPoint ?? ENSV2.entryPoint,
    label: "INJECTED TRANSPORT (not live)",
  });
}

/// The gate a caller puts in front of anything that must be a live answer.
///
/// It reads the stamp on the READER, not on a result, because a result is a plain object that
/// anybody can build. Exported so there is one description of this rule.
export function assertLiveEvidence(reader) {
  if (!reader || reader.kind !== "ENSV2_RECORD_READER") {
    return {ok: false, status: "NOT_A_READER"};
  }
  if (reader.evidence !== EVIDENCE.LIVE_RPC) {
    return {ok: false, status: "NOT_LIVE_EVIDENCE", evidence: reader.evidence};
  }
  return {ok: true, status: "LIVE_RPC"};
}

export {RECORD_KEY};
