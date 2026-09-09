// UNICA's three ENSv2 records: the canonical encoding, the decoder, and the rule that ENS never
// holds a secret.
//
// WHAT IS BEING STORED AND WHY IT IS A STRING. ENSv2 stores merchant-published data as TEXT
// records — key/value pairs on a name, readable by anyone through the UniversalResolver. UNICA
// publishes exactly three, one per name in the architecture:
//
//   pay.<merchant>.<parent>            unica.pay        the canonical PUBLIC settlement config
//   treasury.<merchant>.<parent>       unica.treasury   PUBLIC policy metadata, never a policy
//   agent.treasury.<merchant>.<parent> unica.agent      the delegated agent's public capabilities
//
// THE ENCODING IS STRICT AND POSITIONAL, AND THAT IS THE POINT. A record is a pipe-separated
// sequence with a fixed field count per schema. There is no escaping, no optional trailing field
// and no whitespace tolerance: a field that would contain a separator is REFUSED at encode time
// rather than escaped, because escaping is where two strings start to mean the same thing. Two
// strings that mean the same thing is exactly what breaks a commitment — the merchant signs one
// spelling and the chain serves another, and nothing about the mismatch looks wrong.
//
// SO THE DECODER RE-ENCODES AND DEMANDS THE BYTES BACK. `decodeRecord` parses, then encodes what
// it parsed and requires the result to be byte-identical to the input. A value that decodes but
// does not round-trip — a leading zero on a number, an upper-case address, an unsorted key list —
// is NON_CANONICAL_ENCODING, not a warning. This is the round-trip requirement enforced on the
// read side, where an attacker's bytes actually arrive, rather than only in a test.
//
// A REFUSAL CARRIES NO PARTIAL RECORD. Every failure returns {ok:false, status, ...} with NO
// `record` field at all. A partial decode is the shape that gets read as "mostly fine": a caller
// writes `if (r.record) use(r.record)` and a malformed blob with three good fields out of ten
// becomes a payment instruction. There is no object to reach for on the failure path.
//
// ENS STORES NOTHING SECRET. Not a threshold, not an allocation, not a reserve, not a credential —
// only a COMMITMENT to them. Every field below is either public by nature (a chain id, a payout
// address, an expiry) or is a 32-byte commitment. `assertNoSecrets` is the instrument that proves
// it for a given record and a given set of private values, and it is exported rather than kept in
// the test because a planner should run it before it writes, not after.
//
// AND A COMMITMENT NEEDS A SALT, OR IT IS NOT HIDING ANYTHING. keccak256(threshold) where the
// threshold is "1000 USDC" is not a commitment; it is a public value with an extra step, and
// anybody can enumerate the plausible ones in a second. `commitPrivate` therefore REFUSES to build
// a commitment without at least 32 bytes of salt, and refuses an all-zero salt, because those are
// the two ways this gets got wrong by someone who is in a hurry.
//
// Nothing in this file touches a chain, a clock or a key. It is bytes in, bytes out.

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {concat, utf8, wordBytes32} from "../permit2/digest.mjs";

// ── the grammar ───────────────────────────────────────────────────────────────────────────────

/// The field separator. Chosen because it is the one printable character that appears in none of
/// the value shapes below and must be percent-encoded in a URL, so refusing it costs nothing.
export const SEP = "|";

/// The marker for a field that is present and deliberately empty. An absent optional field is
/// still a POSITION: dropping it would shift every field after it, and a shifted positional record
/// decodes to a different meaning rather than to an error.
export const ABSENT = "-";

/// The text-record keys. The domain tag inside the value repeats the key on purpose — a record
/// copied from one key to another must not decode, and a decoder that trusted the key it asked for
/// would let it.
export const RECORD_KEY = {
  pay: "unica.pay",
  treasury: "unica.treasury",
  agent: "unica.agent",
};

/// The schema version this module emits and the only one it accepts. Bumping it changes every
/// encoding and therefore every commitment, which is the intent: an old signature must not fit a
/// new schema.
export const SCHEMA_VERSION = 1;

/// A cap on the whole record. ENSv2 imposes no limit that this survey observed, so this is UNICA's
/// own bound, stated as ours rather than presented as the protocol's. It exists so a decoder
/// cannot be handed a megabyte of text and asked to hash it inside a checkout.
export const MAX_RECORD_BYTES = 1024;

export const RECORD_STATUS = {
  DECODED: "DECODED",
  ENCODED: "ENCODED",
  NOT_A_STRING: "NOT_A_STRING",
  EMPTY_RECORD: "EMPTY_RECORD",
  RECORD_TOO_LONG: "RECORD_TOO_LONG",
  UNKNOWN_DOMAIN: "UNKNOWN_DOMAIN",
  WRONG_DOMAIN: "WRONG_DOMAIN",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  FIELD_COUNT_MISMATCH: "FIELD_COUNT_MISMATCH",
  MALFORMED_FIELD: "MALFORMED_FIELD",
  MISSING_FIELD: "MISSING_FIELD",
  NON_CANONICAL_ENCODING: "NON_CANONICAL_ENCODING",
  EVIDENCE_HALF_PRESENT: "EVIDENCE_HALF_PRESENT",
  SEPARATOR_IN_VALUE: "SEPARATOR_IN_VALUE",
};

export const RECORD_EXPLAIN = {
  DECODED: "Decoded.",
  ENCODED: "Encoded.",
  NOT_A_STRING: "A record is text; this was not.",
  EMPTY_RECORD: "The name carries no value under that key.",
  RECORD_TOO_LONG: "That record is longer than UNICA will read.",
  UNKNOWN_DOMAIN: "That value does not begin with a UNICA record tag.",
  WRONG_DOMAIN: "That value is a UNICA record of a different kind, published under the wrong key.",
  UNSUPPORTED_SCHEMA_VERSION: "That record uses a schema version this build does not accept.",
  FIELD_COUNT_MISMATCH: "That record has the wrong number of fields for its schema.",
  MALFORMED_FIELD: "A field in that record is not the shape its schema requires.",
  MISSING_FIELD: "A required value was not supplied.",
  NON_CANONICAL_ENCODING: "That record decodes, but not to the exact bytes it claims to be — refused.",
  EVIDENCE_HALF_PRESENT: "Evidence needs both a URL and a content hash, or neither.",
  SEPARATOR_IN_VALUE: "A value contains the field separator, which this encoding does not escape.",
};

const refuse = (status, extra = {}) => ({ok: false, status, explain: RECORD_EXPLAIN[status], ...extra});

// ── field types ───────────────────────────────────────────────────────────────────────────────
//
// Each type is a pair: `format` turns a JavaScript value into the ONE canonical string that stands
// for it, and `parse` turns a string back into the value or throws with a reason. `format` is
// total on the values it accepts and refuses everything else, so there is no path where an
// unexpected value is silently stringified — `String(undefined)` is "undefined", which is a
// perfectly good ten-character field that means nothing.

const HEX20 = /^0x[0-9a-f]{40}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const DEC = /^(0|[1-9][0-9]{0,77})$/;

const bad = (why) => { throw new Error(why); };

const T = {
  /// A canonical decimal integer: no sign, no leading zeros, no separators, fits in 256 bits.
  uint: {
    format: (v) => {
      if (typeof v === "number" && !Number.isSafeInteger(v)) bad("a number that is not a safe integer");
      let n;
      try { n = BigInt(v); } catch { bad(`not an integer: ${JSON.stringify(v)}`); }
      if (n < 0n) bad("negative");
      if (n >= 1n << 256n) bad("does not fit in 256 bits");
      return n.toString(10);
    },
    parse: (s) => {
      if (!DEC.test(s)) bad(`not a canonical decimal integer: ${JSON.stringify(s)}`);
      const n = BigInt(s);
      if (n >= 1n << 256n) bad("does not fit in 256 bits");
      return n;
    },
  },

  /// A 20-byte address in lower case. Lower case is the canonical spelling here, deliberately:
  /// EIP-55 checksum casing is a SECOND spelling of the same address, and two spellings of one
  /// value in a positional record means two different record strings for one meaning — which means
  /// two different commitments. A caller that hands in a checksummed address gets it lowered by
  /// `format` and gets the same bytes back; a RECORD that arrives checksummed does not round-trip
  /// and is refused as non-canonical, because that one came off the wire.
  address: {
    format: (v) => {
      const s = String(v ?? "").toLowerCase();
      if (!HEX20.test(s)) bad(`not a 20-byte address: ${JSON.stringify(v)}`);
      return s;
    },
    parse: (s) => { if (!HEX20.test(s)) bad(`not a lower-case 20-byte address: ${JSON.stringify(s)}`); return s; },
  },

  bytes32: {
    format: (v) => {
      const s = String(v ?? "").toLowerCase();
      if (!HEX32.test(s)) bad(`not 32 bytes: ${JSON.stringify(v)}`);
      return s;
    },
    parse: (s) => { if (!HEX32.test(s)) bad(`not a lower-case 32-byte value: ${JSON.stringify(s)}`); return s; },
  },

  /// A short lower-case identifier: a workflow name, an action-schema id. Same charset in both
  /// directions so an id cannot be written that cannot be read back.
  id: {
    format: (v) => { const s = String(v ?? ""); if (!ID.test(s)) bad(`not an identifier: ${JSON.stringify(v)}`); return s; },
    parse: (s) => { if (!ID.test(s)) bad(`not an identifier: ${JSON.stringify(s)}`); return s; },
  },

  /// A closed set of words. An enum is the only place this encoding carries free text, and it
  /// carries it from a list rather than from the caller.
  enumOf: (values) => ({
    values,
    format: (v) => { const s = String(v ?? ""); if (!values.includes(s)) bad(`not one of ${values.join("/")}: ${JSON.stringify(v)}`); return s; },
    parse: (s) => { if (!values.includes(s)) bad(`not one of ${values.join("/")}: ${JSON.stringify(s)}`); return s; },
  }),

  /// An https URL, or ABSENT. http is refused rather than upgraded: an evidence document fetched
  /// over plain http is a document an intermediary chose, and "we would have upgraded it" is not
  /// something the reader can check.
  url: {
    format: (v) => {
      if (v === null || v === undefined || v === ABSENT) return ABSENT;
      const s = String(v);
      if (!s.startsWith("https://")) bad("an evidence URL must be https");
      if (s.length > 200) bad("an evidence URL longer than 200 characters");
      if (/[\s|]/.test(s)) bad("an evidence URL containing whitespace or the field separator");
      return s;
    },
    parse: (s) => {
      if (s === ABSENT) return null;
      if (!s.startsWith("https://")) bad("an evidence URL must be https");
      if (s.length > 200) bad("an evidence URL longer than 200 characters");
      if (/[\s|]/.test(s)) bad("an evidence URL containing whitespace or the field separator");
      return s;
    },
  },

  /// bytes32 or ABSENT.
  optionalBytes32: {
    format: (v) => (v === null || v === undefined || v === ABSENT) ? ABSENT : T.bytes32.format(v),
    parse: (s) => (s === ABSENT ? null : T.bytes32.parse(s)),
  },

  /// A sorted, de-duplicated list of record keys, or ABSENT for "none". SORTED is part of the
  /// canonical form: the same set written in two orders would otherwise be two records.
  keylist: {
    format: (v) => {
      if (v === null || v === undefined || v === ABSENT) return ABSENT;
      const list = Array.isArray(v) ? v.map(String) : String(v).split(",").filter((x) => x.length);
      if (!list.length) return ABSENT;
      if (list.length > 16) bad("more than 16 allowed record keys");
      for (const k of list) if (!ID.test(k)) bad(`not a record key: ${JSON.stringify(k)}`);
      const sorted = [...list].sort();
      if (new Set(sorted).size !== sorted.length) bad("duplicate record keys");
      return sorted.join(",");
    },
    parse: (s) => {
      if (s === ABSENT) return [];
      const list = s.split(",");
      if (!list.length || list.some((k) => !ID.test(k))) bad(`not a list of record keys: ${JSON.stringify(s)}`);
      if (list.length > 16) bad("more than 16 allowed record keys");
      if (new Set(list).size !== list.length) bad("duplicate record keys");
      // The sort check lives here rather than only in the round-trip so the REASON is nameable.
      for (let i = 1; i < list.length; i++) if (list[i - 1] > list[i]) bad("record keys are not in ascending order");
      return list;
    },
  },
};

export const AGENT_REVOCATION = ["ACTIVE", "REVOKED"];
export const TREASURY_STATUS = ["ACTIVE", "SUSPENDED", "RETIRED"];
/// FLOWING and HALTED rather than "open" and "closed". A circuit breaker that is OPEN stops
/// current in electrical usage and permits it in most software usage, so the word is a coin flip
/// and this field decides whether a treasury pays out.
export const BREAKER_STATE = ["FLOWING", "HALTED"];

// ── the three schemas ─────────────────────────────────────────────────────────────────────────
//
// Position is meaning. The domain tag and the schema version occupy positions 0 and 1 of every
// record so that a decoder can reject the wrong kind of record before it interprets a single
// field, and so that version 2 of any schema can be told apart from version 1 without guessing
// from the field count.

export const SCHEMAS = {
  pay: {
    domain: RECORD_KEY.pay,
    key: RECORD_KEY.pay,
    purpose: "the canonical PUBLIC settlement configuration a payer is quoted against",
    fields: [
      {name: "chainId", type: T.uint, why: "the chain this configuration settles on"},
      {name: "executor", type: T.address, why: "the settlement executor permitted to move the payment"},
      {name: "recipient", type: T.address, why: "the merchant's payout address"},
      {name: "token", type: T.address, why: "the settlement token"},
      {name: "configCommitment", type: T.bytes32, why: "a salted commitment to the private configuration inputs"},
      {name: "expiry", type: T.uint, why: "unix seconds after which this record must not be relied on"},
      {name: "evidenceUrl", type: T.url, why: "optional public evidence document"},
      {name: "evidenceHash", type: T.optionalBytes32, why: "the content hash of that document"},
    ],
  },
  treasury: {
    domain: RECORD_KEY.treasury,
    key: RECORD_KEY.treasury,
    purpose: "PUBLIC policy metadata — a commitment to a policy, never the policy",
    fields: [
      {name: "workflowVersion", type: T.uint, why: "the treasury workflow version in force"},
      {name: "policyCommitment", type: T.bytes32, why: "a salted commitment to the private policy inputs"},
      {name: "actionSchema", type: T.id, why: "the schema of actions this treasury permits"},
      {name: "status", type: T.enumOf(TREASURY_STATUS), why: "the public status of the treasury"},
      {name: "expiry", type: T.uint, why: "unix seconds after which this record must not be relied on"},
      {name: "breaker", type: T.enumOf(BREAKER_STATE), why: "FLOWING or HALTED — the public circuit-breaker state"},
    ],
  },
  agent: {
    domain: RECORD_KEY.agent,
    key: RECORD_KEY.agent,
    purpose: "the delegated agent's identity and the PUBLIC record keys it may write",
    fields: [
      {name: "agent", type: T.address, why: "the delegated agent's address"},
      {name: "workflowId", type: T.id, why: "which workflow this agent runs"},
      {name: "workflowVersion", type: T.uint, why: "that workflow's version"},
      {name: "allowedKeys", type: T.keylist, why: "the public record keys the agent is permitted to write"},
      {name: "expiry", type: T.uint, why: "unix seconds after which this delegation must not be relied on"},
      {name: "revocation", type: T.enumOf(AGENT_REVOCATION), why: "ACTIVE or REVOKED"},
    ],
  },
};

export const SCHEMA_NAMES = Object.keys(SCHEMAS);

/// The domain tag -> schema name, so a decoder can find out what it was handed before it is told.
export const SCHEMA_BY_DOMAIN = Object.fromEntries(
  Object.entries(SCHEMAS).map(([name, s]) => [s.domain, name]),
);

// ── encode ────────────────────────────────────────────────────────────────────────────────────

/// Encode one record. Returns {ok, status, value, schema, fields} or a named refusal.
///
/// There is no throwing path: a planner that is assembling an owner action wants the reason in a
/// value it can print next to the field, not in a stack trace.
export function encodeRecord(schemaName, input) {
  const schema = SCHEMAS[schemaName];
  if (!schema) return refuse(RECORD_STATUS.UNKNOWN_DOMAIN, {schemaName});
  if (!input || typeof input !== "object") return refuse(RECORD_STATUS.MISSING_FIELD, {field: "(the whole record)"});

  const parts = [schema.domain, String(SCHEMA_VERSION)];
  const fields = {};
  for (const f of schema.fields) {
    const supplied = input[f.name];
    const optional = f.type === T.url || f.type === T.optionalBytes32 || f.type === T.keylist;
    if (!optional && (supplied === undefined || supplied === null)) {
      return refuse(RECORD_STATUS.MISSING_FIELD, {field: f.name, why: f.why});
    }
    let text;
    try { text = f.type.format(supplied); } catch (e) {
      return refuse(RECORD_STATUS.MALFORMED_FIELD, {field: f.name, why: e.message});
    }
    if (text.includes(SEP)) return refuse(RECORD_STATUS.SEPARATOR_IN_VALUE, {field: f.name});
    parts.push(text);
    fields[f.name] = text;
  }

  // Evidence is a pair or it is nothing. Half of it published is worse than none: a URL with no
  // hash is a document anybody may swap, and a hash with no URL points at nothing.
  if (schemaName === "pay") {
    const hasUrl = fields.evidenceUrl !== ABSENT;
    const hasHash = fields.evidenceHash !== ABSENT;
    if (hasUrl !== hasHash) return refuse(RECORD_STATUS.EVIDENCE_HALF_PRESENT, {evidenceUrl: hasUrl, evidenceHash: hasHash});
  }

  const value = parts.join(SEP);
  if (utf8(value).length > MAX_RECORD_BYTES) {
    return refuse(RECORD_STATUS.RECORD_TOO_LONG, {bytes: utf8(value).length, max: MAX_RECORD_BYTES});
  }
  return {ok: true, status: RECORD_STATUS.ENCODED, schema: schemaName, key: schema.key, value, fields};
}

// ── decode ────────────────────────────────────────────────────────────────────────────────────

/// Decode one record, and require it to be the exact bytes its own meaning encodes to.
///
/// @param expectSchema the schema the CALLER asked for, because it read a particular text key. A
///        record of another UNICA kind found under that key is WRONG_DOMAIN, not a decode of the
///        other kind: a treasury blob republished under `unica.pay` must not become a payment
///        instruction, and the only way to be sure is to check the tag against what was asked for.
export function decodeRecord(expectSchema, value) {
  const schema = SCHEMAS[expectSchema];
  if (!schema) return refuse(RECORD_STATUS.UNKNOWN_DOMAIN, {schemaName: expectSchema});
  if (typeof value !== "string") return refuse(RECORD_STATUS.NOT_A_STRING, {typeofValue: typeof value});
  if (value.length === 0) return refuse(RECORD_STATUS.EMPTY_RECORD);
  const bytes = utf8(value).length;
  if (bytes > MAX_RECORD_BYTES) return refuse(RECORD_STATUS.RECORD_TOO_LONG, {bytes, max: MAX_RECORD_BYTES});

  const parts = value.split(SEP);
  const domain = parts[0];
  if (!SCHEMA_BY_DOMAIN[domain]) return refuse(RECORD_STATUS.UNKNOWN_DOMAIN, {domain});
  if (domain !== schema.domain) {
    return refuse(RECORD_STATUS.WRONG_DOMAIN, {domain, expected: schema.domain, actualSchema: SCHEMA_BY_DOMAIN[domain]});
  }

  // The version is read before the field count, because a version this build does not know may
  // legitimately have a different number of fields and "wrong field count" would be a misleading
  // reason to give for it.
  let version;
  try { version = T.uint.parse(parts[1] ?? ""); } catch (e) {
    return refuse(RECORD_STATUS.MALFORMED_FIELD, {field: "schemaVersion", why: e.message});
  }
  if (version !== BigInt(SCHEMA_VERSION)) {
    return refuse(RECORD_STATUS.UNSUPPORTED_SCHEMA_VERSION, {version: Number(version), supported: SCHEMA_VERSION});
  }

  const expected = schema.fields.length + 2;
  if (parts.length !== expected) {
    return refuse(RECORD_STATUS.FIELD_COUNT_MISMATCH, {found: parts.length, expected});
  }

  const record = {schemaVersion: SCHEMA_VERSION};
  for (let i = 0; i < schema.fields.length; i++) {
    const f = schema.fields[i];
    try { record[f.name] = f.type.parse(parts[i + 2]); } catch (e) {
      return refuse(RECORD_STATUS.MALFORMED_FIELD, {field: f.name, why: e.message, position: i + 2});
    }
  }

  if (expectSchema === "pay") {
    const hasUrl = record.evidenceUrl !== null;
    const hasHash = record.evidenceHash !== null;
    if (hasUrl !== hasHash) return refuse(RECORD_STATUS.EVIDENCE_HALF_PRESENT, {evidenceUrl: hasUrl, evidenceHash: hasHash});
  }

  // THE ROUND TRIP. Everything above proves each field is well shaped. This proves the whole
  // string is the canonical spelling of what it decoded to — the property a commitment depends on,
  // and the one that field-by-field validation cannot give you.
  //
  // BE HONEST ABOUT WHAT IT CATCHES TODAY: nothing. Every type shipped below has a `parse` strict
  // enough that a non-canonical spelling is already refused as MALFORMED_FIELD with a nameable
  // reason, which is the better error. This is the backstop for the NEXT field type — one whose
  // `parse` accepts a spelling its `format` does not produce — and a backstop nobody has ever seen
  // fire is indistinguishable from a backstop that cannot. So `records-test.mjs` adds a type whose
  // parse and format deliberately disagree and requires NON_CANONICAL_ENCODING to come back. That
  // is the only evidence that this branch is wired to anything.
  const back = encodeRecord(expectSchema, record);
  if (!back.ok) {
    return refuse(RECORD_STATUS.NON_CANONICAL_ENCODING, {reEncode: back.status, detail: back.field ?? back.why ?? null});
  }
  if (back.value !== value) {
    return refuse(RECORD_STATUS.NON_CANONICAL_ENCODING, {canonical: back.value, received: value});
  }

  return {ok: true, status: RECORD_STATUS.DECODED, schema: expectSchema, key: schema.key, value, record};
}

// ── commitments, which is the only way a private value is allowed near this file ──────────────

export const COMMITMENT_DOMAIN = {
  config: "UNICA.ensv2.config-commitment.v1",
  policy: "UNICA.ensv2.policy-commitment.v1",
};

/// The minimum salt, in bytes. 32 because that is the width at which guessing the salt is the same
/// problem as guessing a private key, and anything less invites somebody to pick eight bytes.
export const MIN_SALT_BYTES = 32;

export const COMMIT_STATUS = {
  COMMITTED: "COMMITTED",
  UNKNOWN_COMMITMENT_DOMAIN: "UNKNOWN_COMMITMENT_DOMAIN",
  SALT_REQUIRED: "SALT_REQUIRED",
  SALT_TOO_SHORT: "SALT_TOO_SHORT",
  SALT_IS_ZERO: "SALT_IS_ZERO",
  NO_ENTRIES: "NO_ENTRIES",
  MALFORMED_ENTRY: "MALFORMED_ENTRY",
};

const HEXBLOB = /^0x([0-9a-fA-F]{2})+$/;

/// Commit to a set of private values.
///
/// WHY THE SALT IS MANDATORY. The values this commits to — a payout threshold, a reserve floor, an
/// allocation — come from small, guessable ranges. keccak256("threshold=1000000000") is a public
/// value with an extra step: anybody can enumerate every round number a merchant might have picked
/// and compare digests. A commitment without a salt does not hide a low-entropy input, it only
/// looks like it does, and looking like it does is worse than not trying. So a salt is required,
/// it is required to be at least 32 bytes, and it is required not to be zero — because a zero salt
/// is what you get when someone wires this up with a default.
///
/// THE SALT NEVER GOES INTO A RECORD. It stays with the merchant. Only the digest is published.
///
/// @param entries {[key]: value} — canonicalised by sorting on key and joining `key=value` with
///        newlines, so the same policy always commits to the same word regardless of object order.
export function commitPrivate({domain, salt, entries} = {}) {
  if (!domain || !Object.values(COMMITMENT_DOMAIN).includes(domain)) {
    return {ok: false, status: COMMIT_STATUS.UNKNOWN_COMMITMENT_DOMAIN, domain: domain ?? null};
  }
  if (salt === undefined || salt === null || salt === "") return {ok: false, status: COMMIT_STATUS.SALT_REQUIRED};
  const s = String(salt);
  if (!HEXBLOB.test(s)) return {ok: false, status: COMMIT_STATUS.SALT_TOO_SHORT, why: "a salt is 0x-prefixed bytes"};
  const saltBytes = (s.length - 2) / 2;
  if (saltBytes < MIN_SALT_BYTES) {
    return {ok: false, status: COMMIT_STATUS.SALT_TOO_SHORT, bytes: saltBytes, min: MIN_SALT_BYTES};
  }
  if (/^0x0+$/.test(s)) return {ok: false, status: COMMIT_STATUS.SALT_IS_ZERO};

  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return {ok: false, status: COMMIT_STATUS.NO_ENTRIES};
  }
  const keys = Object.keys(entries).sort();
  if (!keys.length) return {ok: false, status: COMMIT_STATUS.NO_ENTRIES};
  const lines = [];
  for (const k of keys) {
    const v = entries[k];
    if (v === undefined || v === null) return {ok: false, status: COMMIT_STATUS.MALFORMED_ENTRY, entry: k, why: "no value"};
    const text = typeof v === "bigint" ? v.toString(10) : String(v);
    if (/[\n=]/.test(k)) return {ok: false, status: COMMIT_STATUS.MALFORMED_ENTRY, entry: k, why: "a key contains = or a newline"};
    if (text.includes("\n")) return {ok: false, status: COMMIT_STATUS.MALFORMED_ENTRY, entry: k, why: "a value contains a newline"};
    lines.push(`${k}=${text}`);
  }
  const body = toHex(keccak256(utf8(lines.join("\n"))));
  const saltDigest = toHex(keccak256(Uint8Array.from((s.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16)))));

  const commitment = toHex(keccak256(concat(
    wordBytes32(toHex(keccak256(utf8(domain)))),
    wordBytes32(saltDigest),
    wordBytes32(body),
  )));
  return {ok: true, status: COMMIT_STATUS.COMMITTED, commitment, domain, entryKeys: keys};
}

/// Re-derive a commitment and compare. Returns a boolean and never throws, so a validator can use
/// it in a condition without a try/catch that would swallow the difference between "does not
/// match" and "could not be computed".
export function commitmentMatches(published, {domain, salt, entries} = {}) {
  const c = commitPrivate({domain, salt, entries});
  if (!c.ok) return {ok: false, status: c.status, matches: false};
  return {ok: true, status: COMMIT_STATUS.COMMITTED, matches: c.commitment === String(published ?? "").toLowerCase(), commitment: c.commitment};
}

// ── the instrument that proves ENS is holding nothing secret ──────────────────────────────────

/// Every spelling a numeric or textual secret plausibly takes on its way into a record. A leak
/// check that only looked for the decimal spelling would miss the same number written as hex,
/// which is how it would actually get there — an ABI encoder produces the padded hex form.
export function secretSpellings(value) {
  const out = new Set();
  const add = (s) => { if (typeof s === "string" && s.length >= 2) out.add(s); };
  add(String(value));
  add(String(value).toLowerCase());
  let n = null;
  try { n = BigInt(value); } catch { /* not numeric — the string spellings above are all there is */ }
  if (n !== null && n >= 0n) {
    add(n.toString(10));
    const h = n.toString(16);
    add("0x" + h);
    add(h);
    add("0x" + h.padStart(64, "0"));
    add(h.padStart(64, "0"));
    // The commitment is a keccak of the value on its own. If a "commitment" in a record is really
    // just that, it is not hiding anything, and this catches it as a leak rather than praising it.
    add(toHex(keccak256(utf8(String(value)))));
    add(toHex(keccak256(utf8(n.toString(10)))));
  }
  return [...out];
}

export const NO_SECRETS = "NO_SECRETS";
export const SECRET_LEAKED = "SECRET_LEAKED";

/// Assert that none of `secrets` appears anywhere in `text` — a record value, an event payload, an
/// owner-action line, anything about to become public.
///
/// It is a substring scan, and a substring scan is exactly the right instrument here: the question
/// is not "did we intend to publish this" but "is this value recoverable from the bytes we are
/// about to publish". Short spellings are skipped, because a two-character secret matches
/// everything and a check that always fires is a check nobody keeps.
export function assertNoSecrets(text, secrets = {}) {
  const haystack = String(text ?? "");
  const lower = haystack.toLowerCase();
  const leaks = [];
  for (const [name, value] of Object.entries(secrets)) {
    for (const spelling of secretSpellings(value)) {
      if (spelling.length < 4) continue;
      if (lower.includes(spelling.toLowerCase())) leaks.push({secret: name, spelling, where: lower.indexOf(spelling.toLowerCase())});
    }
  }
  return leaks.length
    ? {ok: false, status: SECRET_LEAKED, leaks}
    : {ok: true, status: NO_SECRETS, scanned: haystack.length, secretsChecked: Object.keys(secrets).length};
}

// ── one word over a decoded record, for a binding to point at ─────────────────────────────────

export const RECORD_DIGEST_DOMAIN = "UNICA.ensv2.record.v1";

/// Hash a record as it was SERVED — the exact bytes, under the exact key, on the exact node.
///
/// The key and the node are in the digest because the same bytes under a different key, or on a
/// different name, are a different fact. Without them a pay record lifted from one merchant's name
/// onto another's would produce the same digest, and a binding that pinned only the digest would
/// not notice.
export function recordDigest({node, key, value}) {
  return toHex(keccak256(concat(
    wordBytes32(toHex(keccak256(utf8(RECORD_DIGEST_DOMAIN)))),
    wordBytes32(node),
    wordBytes32(toHex(keccak256(utf8(String(key))))),
    wordBytes32(toHex(keccak256(utf8(String(value))))),
  )));
}
