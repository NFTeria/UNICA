// Offline suite for the three UNICA record schemas: the encoding, the decoding, the commitments,
// and the rule that ENS is holding nothing secret.
//
//   node integrations/ensv2/records-test.mjs
//   node integrations/ensv2/records-test.mjs --self-test
//
// No network. Every row here is arithmetic over bytes, which is the whole reason this file can run
// in a gate on a machine with no endpoint and still mean something.
//
// A CHECK THAT HAS NEVER FAILED IS NOT A CHECK. `--self-test` replaces one function at a time with
// a version that has the defect this suite claims to catch — an encoder that forgets the domain
// tag, a decoder that skips the round trip, a commitment that ignores its salt, a leak scanner
// that always says fine — and requires the suite to go RED for each. A mutation that passes is
// reported as a FAIL against this file, not against the module, because it means these rows are
// not attached to the behaviour they describe.

import * as R from "./records.mjs";

/// JSON.stringify throws on a BigInt, and the decoder returns BigInts for every numeric field. A
/// detail line that throws turns a legible FAIL into a stack trace about the test file.
const show = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? `${x}n` : x));

// ── the sample values ─────────────────────────────────────────────────────────────────────────
//
// Addresses here are patterned so a misplaced field is visible in a diff at a glance. None of them
// is a real account and none is read from a chain: this file makes no claim about what any name
// publishes anywhere.

const SALT_A = "0x" + "7f".repeat(32);
const SALT_B = "0x" + "5c".repeat(32);

const PRIVATE_POLICY = {
  payoutThreshold: "1000000000",
  reserveFloor: "250000000",
  allocationBps: "1500",
};

const COMMIT_A = R.commitPrivate({domain: R.COMMITMENT_DOMAIN.policy, salt: SALT_A, entries: PRIVATE_POLICY});

const SAMPLE = {
  pay: {
    chainId: 11155111,
    executor: "0xe0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0",
    recipient: "0xd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1",
    token: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    configCommitment: "0x" + "ab".repeat(32),
    expiry: 1800000000,
    evidenceUrl: "https://example.invalid/merchant/terms.pdf",
    evidenceHash: "0x" + "cd".repeat(32),
  },
  treasury: {
    workflowVersion: 3,
    policyCommitment: COMMIT_A.commitment,
    actionSchema: "unica.action.v1",
    status: "ACTIVE",
    expiry: 1800000000,
    breaker: "FLOWING",
  },
  agent: {
    agent: "0xa9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9",
    workflowId: "unica.treasury-agent",
    workflowVersion: 2,
    allowedKeys: ["unica.treasury"],
    expiry: 1800000000,
    revocation: "ACTIVE",
  },
};

/// One alternative value per field, so "every field is in the encoding" can be proved by moving
/// each one in turn and requiring the bytes to change. A field that is silently dropped by the
/// encoder is invisible to a round-trip test — it round-trips perfectly, as undefined.
const TWEAK = {
  pay: {
    chainId: 1, executor: "0x0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e",
    recipient: "0x1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d",
    token: "0x2c7d4b196cb0c7b01d743fbc6116a902379c7238",
    configCommitment: "0x" + "ac".repeat(32), expiry: 1900000000,
    evidenceUrl: "https://example.invalid/merchant/other.pdf", evidenceHash: "0x" + "ce".repeat(32),
  },
  treasury: {
    workflowVersion: 4, policyCommitment: "0x" + "11".repeat(32), actionSchema: "unica.action.v2",
    status: "SUSPENDED", expiry: 1900000000, breaker: "HALTED",
  },
  agent: {
    agent: "0x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a", workflowId: "unica.payout-agent",
    workflowVersion: 3, allowedKeys: ["unica.agent"], expiry: 1900000000, revocation: "REVOKED",
  },
};

// ── the suite ─────────────────────────────────────────────────────────────────────────────────
//
// Written against an INJECTED implementation so `--self-test` can hand it a broken one. Nothing in
// here reaches for `R.encodeRecord` directly; it uses `impl.encodeRecord`, and the two are the same
// object on a normal run.

function runChecks(impl, emit) {
  const {encodeRecord, decodeRecord, commitPrivate, assertNoSecrets, recordDigest} = impl;

  // ── 1. every schema round-trips, field by field ─────────────────────────────────────────────
  for (const schema of R.SCHEMA_NAMES) {
    const enc = encodeRecord(schema, SAMPLE[schema]);
    emit(`${schema}: encodes`, enc.ok === true, `status ${enc.status}${enc.field ? ` on ${enc.field}` : ""}`);
    if (!enc.ok) continue;

    const dec = decodeRecord(schema, enc.value);
    emit(`${schema}: decodes what it encoded`, dec.ok === true, `status ${dec.status} ${show(dec.field ?? "")}`);
    if (!dec.ok) continue;

    const again = encodeRecord(schema, dec.record);
    emit(`${schema}: re-encodes to the identical bytes`, again.ok && again.value === enc.value,
         `first ${enc.value}\n      again ${again.value}`);

    // Field by field: each declared field must survive the trip with the value it went in with.
    for (const f of R.SCHEMAS[schema].fields) {
      const went = SAMPLE[schema][f.name];
      const came = dec.record[f.name];
      const same = Array.isArray(came)
        ? JSON.stringify(came) === JSON.stringify(went ?? [])
        : String(came ?? "") === String(went ?? "").toLowerCase() || String(came ?? "") === String(went ?? "");
      emit(`${schema}.${f.name}: survives the round trip`, same, `in ${show(went)} out ${show(came)}`);
    }

    // And each field is actually IN the bytes: move it, and the bytes must move.
    for (const f of R.SCHEMAS[schema].fields) {
      const moved = encodeRecord(schema, {...SAMPLE[schema], [f.name]: TWEAK[schema][f.name]});
      emit(`${schema}.${f.name}: changing it changes the encoding`,
           moved.ok && moved.value !== enc.value,
           moved.ok ? "the encoding did not move, so this field is not in it" : `re-encode refused: ${moved.status}`);
    }
  }

  // ── 2. domain separation ────────────────────────────────────────────────────────────────────
  const payValue = encodeRecord("pay", SAMPLE.pay).value;
  const treasuryValue = encodeRecord("treasury", SAMPLE.treasury).value;
  emit("CONTROL — a pay record decodes as a pay record",
       decodeRecord("pay", payValue).ok === true, "the control itself failed, so the row below proves nothing");
  emit("a pay record published under the treasury key is WRONG_DOMAIN, not a treasury record",
       decodeRecord("treasury", payValue).status === R.RECORD_STATUS.WRONG_DOMAIN,
       `got ${decodeRecord("treasury", payValue).status}`);
  emit("a treasury record published under the pay key is WRONG_DOMAIN",
       decodeRecord("pay", treasuryValue).status === R.RECORD_STATUS.WRONG_DOMAIN,
       `got ${decodeRecord("pay", treasuryValue).status}`);
  emit("the three domain tags are distinct",
       new Set(Object.values(R.RECORD_KEY)).size === 3, "two schemas share a tag");

  // ── 3. every refusal, with the control it needs ─────────────────────────────────────────────
  const rows = [
    ["a value that is not text", () => decodeRecord("pay", 42), R.RECORD_STATUS.NOT_A_STRING],
    ["an empty value", () => decodeRecord("pay", ""), R.RECORD_STATUS.EMPTY_RECORD],
    ["a value longer than the cap", () => decodeRecord("pay", "unica.pay|1|" + "x".repeat(R.MAX_RECORD_BYTES)), R.RECORD_STATUS.RECORD_TOO_LONG],
    ["a value that is not a UNICA record at all", () => decodeRecord("pay", "hello|world"), R.RECORD_STATUS.UNKNOWN_DOMAIN],
    ["a schema version this build does not accept", () => decodeRecord("pay", payValue.replace("unica.pay|1|", "unica.pay|2|")), R.RECORD_STATUS.UNSUPPORTED_SCHEMA_VERSION],
    ["a field missing from the end", () => decodeRecord("pay", payValue.split("|").slice(0, -1).join("|")), R.RECORD_STATUS.FIELD_COUNT_MISMATCH],
    ["an extra field on the end", () => decodeRecord("pay", payValue + "|extra"), R.RECORD_STATUS.FIELD_COUNT_MISMATCH],
    ["an address in mixed case, which is a second spelling of one value",
     () => decodeRecord("pay", payValue.replace(SAMPLE.pay.executor, "0xE0E0E0E0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0")), R.RECORD_STATUS.MALFORMED_FIELD],
    ["a number with a leading zero", () => decodeRecord("pay", payValue.replace("|1800000000|", "|01800000000|")), R.RECORD_STATUS.MALFORMED_FIELD],
    ["an evidence URL over plain http", () => decodeRecord("pay", payValue.replace("https://", "http://")), R.RECORD_STATUS.MALFORMED_FIELD],
    ["an evidence URL with no content hash",
     () => decodeRecord("pay", payValue.replace("|0x" + "cd".repeat(32), "|-")), R.RECORD_STATUS.EVIDENCE_HALF_PRESENT],
    ["a key list that is not in ascending order",
     () => decodeRecord("agent", encodeRecord("agent", {...SAMPLE.agent, allowedKeys: ["unica.agent", "unica.treasury"]}).value
       .replace("unica.agent,unica.treasury", "unica.treasury,unica.agent")), R.RECORD_STATUS.MALFORMED_FIELD],
    ["an enum value outside its set", () => decodeRecord("treasury", treasuryValue.replace("|FLOWING", "|OPEN")), R.RECORD_STATUS.MALFORMED_FIELD],
    ["a treasury status outside its set", () => decodeRecord("treasury", treasuryValue.replace("|ACTIVE|", "|LIVE|")), R.RECORD_STATUS.MALFORMED_FIELD],
  ];
  for (const [what, run, want] of rows) {
    const got = run();
    emit(`refused: ${what} -> ${want}`, got.status === want, `got ${got.status}${got.field ? ` on ${got.field}` : ""}`);
    emit(`   and that refusal carries NO partial record`, !("record" in got),
         "a refusal handed back a record, which is the shape a caller reads as 'mostly fine'");
  }

  // Encode-side refusals: a planner must be told which field it got wrong, before it publishes.
  const encRows = [
    ["a recipient that is not an address", {recipient: "0x1234"}, R.RECORD_STATUS.MALFORMED_FIELD],
    ["a missing expiry", {expiry: undefined}, R.RECORD_STATUS.MISSING_FIELD],
    ["a negative chain id", {chainId: -1}, R.RECORD_STATUS.MALFORMED_FIELD],
    ["an evidence hash with no URL", {evidenceUrl: null}, R.RECORD_STATUS.EVIDENCE_HALF_PRESENT],
    ["an evidence URL containing the field separator", {evidenceUrl: "https://x.invalid/a|b"}, R.RECORD_STATUS.MALFORMED_FIELD],
  ];
  for (const [what, patch, want] of encRows) {
    const got = encodeRecord("pay", {...SAMPLE.pay, ...patch});
    emit(`encode refused: ${what} -> ${want}`, got.status === want, `got ${got.status}${got.field ? ` on ${got.field}` : ""}`);
  }
  emit("CONTROL — the unmodified sample still encodes, so the rows above are about the patch",
       encodeRecord("pay", SAMPLE.pay).ok === true, "the base sample stopped encoding");

  // ── 4. the round-trip backstop is wired to something ─────────────────────────────────────────
  //
  // Every shipped field type refuses a non-canonical spelling in `parse`, with a better error than
  // the backstop would give. So the backstop never fires on today's schemas — and a branch that
  // never fires is indistinguishable from a branch that cannot. This installs a temporary schema
  // whose parse accepts a spelling its format does not produce, and requires NON_CANONICAL_ENCODING
  // to come back. Then it removes it and proves the module is unchanged.
  // Counted from SCHEMAS itself, not from the exported SCHEMA_NAMES: that array is built once at
  // module load and would never move no matter what the test did to the object, so asserting on it
  // would be a row that cannot fail.
  const before = Object.keys(R.SCHEMAS).length;
  R.SCHEMAS.__probe = {
    domain: "unica.__probe", key: "unica.__probe", purpose: "a temporary schema, installed by the test suite",
    fields: [{name: "loose", why: "parse accepts what format does not emit", type: {
      // format always emits "canonical"; parse accepts anything. A value of "sloppy" therefore
      // decodes fine field-by-field and re-encodes to different bytes.
      format: () => "canonical",
      parse: (s) => s,
    }}],
  };
  R.SCHEMA_BY_DOMAIN["unica.__probe"] = "__probe";
  const loose = decodeRecord("__probe", "unica.__probe|1|sloppy");
  emit("the round-trip backstop fires when a type's parse and format disagree",
       loose.status === R.RECORD_STATUS.NON_CANONICAL_ENCODING, `got ${loose.status}`);
  emit("CONTROL — the same probe schema accepts its own canonical spelling",
       decodeRecord("__probe", "unica.__probe|1|canonical").ok === true, "the probe schema refuses everything, so the row above proves nothing");
  delete R.SCHEMAS.__probe;
  delete R.SCHEMA_BY_DOMAIN["unica.__probe"];
  emit("the probe schema was removed and the module is back to its shipped shape",
       Object.keys(R.SCHEMAS).length === before && R.SCHEMAS.__probe === undefined &&
         R.SCHEMA_BY_DOMAIN["unica.__probe"] === undefined,
       "the test left a schema behind");

  // ── 5. commitments ──────────────────────────────────────────────────────────────────────────
  const c1 = commitPrivate({domain: R.COMMITMENT_DOMAIN.policy, salt: SALT_A, entries: PRIVATE_POLICY});
  const c1again = commitPrivate({domain: R.COMMITMENT_DOMAIN.policy, salt: SALT_A, entries: PRIVATE_POLICY});
  emit("CONTROL — a well-formed commitment is produced", c1.ok === true, `status ${c1.status}`);
  emit("the same policy and the same salt give the same word", c1.ok && c1.commitment === c1again.commitment, "it is not deterministic");
  emit("field order does not change the word",
       c1.ok && commitPrivate({domain: R.COMMITMENT_DOMAIN.policy, salt: SALT_A,
         entries: {allocationBps: PRIVATE_POLICY.allocationBps, reserveFloor: PRIVATE_POLICY.reserveFloor, payoutThreshold: PRIVATE_POLICY.payoutThreshold}}).commitment === c1.commitment,
       "reordering the object changed the commitment, so it is not canonical");
  emit("a different salt gives a different word, which is what makes it a commitment at all",
       commitPrivate({domain: R.COMMITMENT_DOMAIN.policy, salt: SALT_B, entries: PRIVATE_POLICY}).commitment !== c1.commitment,
       "the salt is not in the digest");
  emit("a different policy gives a different word",
       commitPrivate({domain: R.COMMITMENT_DOMAIN.policy, salt: SALT_A, entries: {...PRIVATE_POLICY, reserveFloor: "1"}}).commitment !== c1.commitment,
       "the entries are not in the digest");
  emit("the config domain and the policy domain give different words for identical inputs",
       commitPrivate({domain: R.COMMITMENT_DOMAIN.config, salt: SALT_A, entries: PRIVATE_POLICY}).commitment !== c1.commitment,
       "the domain is not in the digest, so a config commitment could be replayed as a policy commitment");

  const saltRows = [
    ["no salt at all", {salt: undefined}, R.COMMIT_STATUS.SALT_REQUIRED],
    ["a salt shorter than 32 bytes", {salt: "0x" + "11".repeat(16)}, R.COMMIT_STATUS.SALT_TOO_SHORT],
    ["an all-zero salt, which is what a default produces", {salt: "0x" + "00".repeat(32)}, R.COMMIT_STATUS.SALT_IS_ZERO],
    ["a salt that is not bytes", {salt: "hunter2hunter2hunter2hunter2hunter2"}, R.COMMIT_STATUS.SALT_TOO_SHORT],
  ];
  for (const [what, patch, want] of saltRows) {
    const got = commitPrivate({domain: R.COMMITMENT_DOMAIN.policy, entries: PRIVATE_POLICY, salt: SALT_A, ...patch});
    emit(`commitment refused: ${what} -> ${want}`, got.status === want, `got ${got.status}`);
  }
  emit("commitment refused: an unknown domain",
       commitPrivate({domain: "something.else", salt: SALT_A, entries: PRIVATE_POLICY}).status === R.COMMIT_STATUS.UNKNOWN_COMMITMENT_DOMAIN, "");
  emit("commitment refused: no entries",
       commitPrivate({domain: R.COMMITMENT_DOMAIN.policy, salt: SALT_A, entries: {}}).status === R.COMMIT_STATUS.NO_ENTRIES, "");

  // ── 6. ENS is holding nothing secret ────────────────────────────────────────────────────────
  //
  // The claim under test is not "we did not mean to publish the threshold". It is "the threshold
  // is not recoverable from the bytes we publish", and the instrument is a substring scan over
  // every spelling the value plausibly takes on its way into a record.
  for (const schema of R.SCHEMA_NAMES) {
    const value = encodeRecord(schema, SAMPLE[schema]).value;
    const scan = assertNoSecrets(value, PRIVATE_POLICY);
    emit(`the published ${schema} record contains no private policy value in any spelling`,
         scan.ok === true, scan.ok ? "" : show(scan.leaks));
  }
  emit("the scanner checked every private value it was given",
       assertNoSecrets(payValue, PRIVATE_POLICY).secretsChecked === Object.keys(PRIVATE_POLICY).length, "");

  // The instrument, validated by sabotage rather than trusted: a record that DOES carry the value
  // must be caught, in each of the spellings it could arrive in.
  const spellings = R.secretSpellings(PRIVATE_POLICY.payoutThreshold).filter((s) => s.length >= 4);
  emit("the scanner considers more than one spelling of a number", spellings.length >= 4, `only ${spellings.length}`);
  for (const spelling of spellings) {
    const leaky = `${payValue}|${spelling}`;
    emit(`   a record carrying the threshold as ${spelling.length > 20 ? spelling.slice(0, 12) + "…" : spelling} is caught`,
         assertNoSecrets(leaky, {payoutThreshold: PRIVATE_POLICY.payoutThreshold}).status === R.SECRET_LEAKED,
         "a leak went unnoticed, so the clean rows above prove nothing");
  }
  // An unsalted "commitment" is the same value with an extra step, and the scanner treats it as a
  // leak rather than as protection.
  emit("a bare keccak of a private value is caught as a leak, not praised as a commitment",
       assertNoSecrets(`x|${R.secretSpellings(PRIVATE_POLICY.reserveFloor).find((s) => s.startsWith("0x") && s.length === 66)}`,
                       {reserveFloor: PRIVATE_POLICY.reserveFloor}).status === R.SECRET_LEAKED, "");

  // ── 7. the record digest binds the bytes to where they were served ──────────────────────────
  const node = "0x" + "12".repeat(32);
  const base = recordDigest({node, key: R.RECORD_KEY.pay, value: payValue});
  emit("recordDigest is deterministic", recordDigest({node, key: R.RECORD_KEY.pay, value: payValue}) === base, "");
  emit("the same bytes on a different name give a different digest",
       recordDigest({node: "0x" + "13".repeat(32), key: R.RECORD_KEY.pay, value: payValue}) !== base,
       "the node is not in the digest, so a record lifted onto another merchant's name would look identical");
  emit("the same bytes under a different key give a different digest",
       recordDigest({node, key: R.RECORD_KEY.treasury, value: payValue}) !== base, "the key is not in the digest");
  emit("different bytes give a different digest",
       recordDigest({node, key: R.RECORD_KEY.pay, value: payValue + " "}) !== base, "the value is not in the digest");
}

// ── the runner ────────────────────────────────────────────────────────────────────────────────

const REAL = {
  encodeRecord: R.encodeRecord,
  decodeRecord: R.decodeRecord,
  commitPrivate: R.commitPrivate,
  assertNoSecrets: R.assertNoSecrets,
  recordDigest: R.recordDigest,
};

function suite(impl) {
  let pass = 0, fail = 0;
  const lines = [];
  runChecks(impl, (name, ok, detail) => {
    if (ok) { pass++; lines.push(`PASS  ${name}`); }
    else { fail++; lines.push(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`); }
  });
  return {pass, fail, lines};
}

/// Each mutation is a defect this suite claims to catch. If one of them passes, the rows that were
/// supposed to catch it are decoration.
const SABOTAGE = [
  {
    what: "the encoder forgets the domain tag, so every record looks like every other kind",
    impl: () => ({...REAL, encodeRecord: (s, i) => {
      const r = R.encodeRecord(s, i);
      return r.ok ? {...r, value: r.value.split("|").slice(1).join("|")} : r;
    }}),
  },
  {
    what: "the decoder skips the round-trip check",
    impl: () => ({...REAL, decodeRecord: (s, v) => {
      const r = R.decodeRecord(s, v);
      return r.status === R.RECORD_STATUS.NON_CANONICAL_ENCODING ? {ok: true, status: R.RECORD_STATUS.DECODED, record: {}} : r;
    }}),
  },
  {
    what: "the decoder answers WRONG_DOMAIN records as if they were the kind that was asked for",
    impl: () => ({...REAL, decodeRecord: (s, v) => {
      const r = R.decodeRecord(s, v);
      if (r.status !== R.RECORD_STATUS.WRONG_DOMAIN) return r;
      return R.decodeRecord(r.actualSchema, v);
    }}),
  },
  {
    what: "the encoder drops the expiry field",
    impl: () => ({...REAL, encodeRecord: (s, i) => R.encodeRecord(s, i === undefined ? i : {...i, expiry: SAMPLE[s]?.expiry ?? i.expiry})}),
  },
  {
    what: "a commitment ignores its salt",
    impl: () => ({...REAL, commitPrivate: ({domain, entries}) => R.commitPrivate({domain, salt: "0x" + "01".repeat(32), entries})}),
  },
  {
    what: "a commitment ignores its domain",
    impl: () => ({...REAL, commitPrivate: ({salt, entries}) => R.commitPrivate({domain: R.COMMITMENT_DOMAIN.policy, salt, entries})}),
  },
  {
    what: "the leak scanner always says the record is clean",
    impl: () => ({...REAL, assertNoSecrets: () => ({ok: true, status: R.NO_SECRETS, secretsChecked: 3})}),
  },
  {
    what: "the record digest ignores which key the bytes were served under",
    impl: () => ({...REAL, recordDigest: ({node, value}) => R.recordDigest({node, key: "", value})}),
  },
  {
    what: "the record digest ignores which name the bytes were served on",
    impl: () => ({...REAL, recordDigest: ({key, value}) => R.recordDigest({node: "0x" + "00".repeat(32), key, value})}),
  },
];

const selfTest = process.argv.includes("--self-test");

console.log("UNICA ENSv2 records — offline encoding, decoding, commitments and the no-secrets rule");
console.log(`schema version ${R.SCHEMA_VERSION}, three schemas: ${R.SCHEMA_NAMES.join(", ")}`);
console.log("no network is used by this suite\n");

const base = suite(REAL);
for (const l of base.lines) console.log(l);

let extraRun = 0, extraPass = 0, extraFail = 0;
if (selfTest) {
  console.log("\n— sabotage: each defect must turn this suite RED —");
  for (const s of SABOTAGE) {
    extraRun++;
    const r = suite(s.impl());
    if (r.fail > 0) { extraPass++; console.log(`PASS  caught: ${s.what} (${r.fail} row(s) went red)`); }
    else { extraFail++; console.log(`FAIL  NOT caught: ${s.what} — the suite stayed green, so it does not check this`); }
  }
  const after = suite(REAL);
  extraRun++;
  if (after.pass === base.pass && after.fail === base.fail) {
    extraPass++;
    console.log(`PASS  the module is unchanged after sabotage (${after.pass} passed, ${after.fail} failed, same as before)`);
  } else {
    extraFail++;
    console.log(`FAIL  the module changed during sabotage: was ${base.pass}/${base.fail}, now ${after.pass}/${after.fail}`);
  }
}

const run = base.pass + base.fail + extraRun;
console.log(`\nchecks run: ${run}, passed: ${base.pass + extraPass}, failed: ${base.fail + extraFail}`);
if (!selfTest) console.log("run with --self-test to prove these checks can fail");
process.exit(base.fail + extraFail > 0 ? 1 : 0);
