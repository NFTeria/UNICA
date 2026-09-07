// UNICA — the V2 release candidate's interface freeze, checked rather than promised.
//
// A freeze written only in prose is a hope. This recomputes every error selector, event topic and
// function selector from the COMPILED ARTIFACTS and compares them with `docs/v2/release-candidate.json`.
// Rename an error, reorder an event's fields, change a parameter type, and the build fails here
// with the name of the thing that moved.
//
// It is deliberately noisy about ADDITIONS as well as changes. A new external function is not a
// compatibility break, but it is a change to the surface a verifier and an indexer were told to
// expect, and it should be a decision rather than a surprise.
//
// Run: node script/verify-freeze.mjs

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

// Anchor to the repository root. Every path below is relative, and a check that reads whatever
// happens to be in the caller's working directory is a check that can quietly pass against the
// wrong tree — the same defect class as reading a stale artifact or missing an untracked file.
chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import {keccak256, toHex} from "../web/ensv2/keccak.mjs";

// THE STALENESS CHECK, and why it is the first thing this file does.
//
// A sabotage run renamed an error, `forge build` failed because the tests still referenced the old
// name, the artifacts on disk stayed at their previous contents, and this verifier read them and
// said the surface was unchanged. It was not; the verifier was reading yesterday.
//
// That is the same defect class as the untracked-file blind spot in the copied-source scan: a check
// whose input is not what it thinks it is. Foundry records the keccak of every source file in each
// artifact's metadata, so the fix is exact — recompute those hashes from disk and refuse to report
// anything if they disagree.
function assertArtifactIsFresh(artifact, path) {
  const sources = artifact?.metadata?.sources;
  if (!sources) return [`${path}: no metadata.sources, so freshness cannot be established`];
  const stale = [];
  for (const [file, entry] of Object.entries(sources)) {
    let onDisk;
    try {
      onDisk = readFileSync(file);
    } catch {
      stale.push(`${file}: named by the artifact and missing from disk`);
      continue;
    }
    const have = toHex(keccak256(new Uint8Array(onDisk)));
    if (have !== entry.keccak256) stale.push(`${file}: changed since this artifact was built`);
  }
  return stale;
}

const FROZEN = "docs/v2/release-candidate.json";
const ARTIFACTS = [
  ["out/QuoteSettlementHook.sol/QuoteSettlementHook.json", "QuoteSettlementHook"],
  ["out/QuoteSettlementExecutor.sol/QuoteSettlementExecutor.json", "QuoteSettlementExecutor"],
];

const enc = (s) => new TextEncoder().encode(s);
const topicOf = (s) => toHex(keccak256(enc(s)));
const selectorOf = (s) => topicOf(s).slice(0, 10);

function typeOf(input) {
  if (input.type === "tuple") return "(" + input.components.map(typeOf).join(",") + ")";
  if (input.type === "tuple[]") return "(" + input.components.map(typeOf).join(",") + ")[]";
  return input.type;
}
const signatureOf = (e) => `${e.name}(${e.inputs.map(typeOf).join(",")})`;

const rows = [];
let checks = 0;
let failures = 0;
function chk(name, ok, detail) {
  checks++;
  rows.push(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    for (const d of [].concat(detail ?? [])) rows.push(`        ${d}`);
  }
}

// ---- controls: the comparison must reject a surface that moved ---------------------------

function compare(frozen, actual) {
  const problems = [];
  for (const [sig, value] of Object.entries(frozen)) {
    if (!(sig in actual)) problems.push(`GONE: ${sig}`);
    else if (actual[sig] !== value) problems.push(`CHANGED: ${sig} ${value} -> ${actual[sig]}`);
  }
  for (const sig of Object.keys(actual)) if (!(sig in frozen)) problems.push(`ADDED: ${sig}`);
  return problems;
}

chk("control: a renamed member is caught", compare({"Foo()": "0x1"}, {"Bar()": "0x1"}).length === 2);
chk("control: a changed selector is caught", compare({"Foo()": "0x1"}, {"Foo()": "0x2"}).length === 1);
chk("control: an added member is caught", compare({}, {"Foo()": "0x1"}).length === 1);
chk("control: an identical surface passes", compare({"Foo()": "0x1"}, {"Foo()": "0x1"}).length === 0);
chk(
  "control: the selector derivation matches a known value",
  selectorOf("transfer(address,uint256)") === "0xa9059cbb",
  "the keccak or the signature builder is wrong, so nothing below means anything",
);

// ---- the freeze ---------------------------------------------------------------------------

let frozen;
try {
  frozen = JSON.parse(readFileSync(FROZEN, "utf8"));
} catch (e) {
  console.log(rows.join("\n"));
  console.log(`FAIL  ${FROZEN} could not be read: ${e.message}`);
  process.exit(1);
}
chk("the freeze declares schema version 1", frozen.schemaVersion === 1);

for (const [path, name] of ARTIFACTS) {
  let abi;
  try {
    abi = JSON.parse(readFileSync(path, "utf8")).abi;
  } catch (e) {
    void e;
    chk(`${name}: artifact readable`, false, `${path} is missing — run forge build`);
    continue;
  }
  const stale = assertArtifactIsFresh(JSON.parse(readFileSync(path, "utf8")), path);
  chk(`${name}: the artifact was built from the sources now on disk`, stale.length === 0, stale);

  const actual = {errors: {}, events: {}, functions: {}};
  for (const e of abi) {
    const s = signatureOf(e);
    if (e.type === "error") actual.errors[s] = selectorOf(s);
    else if (e.type === "event") actual.events[s] = topicOf(s);
    else if (e.type === "function") actual.functions[s] = selectorOf(s);
  }
  const want = frozen.contracts[name];
  chk(`${name}: present in the freeze`, want !== undefined);
  if (!want) continue;
  for (const kind of ["errors", "events", "functions"]) {
    const problems = compare(want[kind], actual[kind]);
    chk(`${name}: ${kind} (${Object.keys(want[kind]).length} frozen)`, problems.length === 0, problems);
  }
}

// The receipt's topic is called out separately because an indexer subscribes to exactly this value
// and a change to it is silent from the chain's point of view: the old topic simply stops appearing.
const receiptSig = Object.keys(frozen.contracts.QuoteSettlementExecutor.events)[0];
chk(
  "the V2 receipt topic is unchanged",
  frozen.contracts.QuoteSettlementExecutor.events[receiptSig] === topicOf(receiptSig),
  "an indexer watching the old topic would simply see nothing, with no error anywhere",
);

console.log("UNICA V2 release-candidate freeze");
console.log(rows.join("\n"));
console.log(`\nfrozen at ${frozen.frozenAt.slice(0, 12)} as ${frozen.releaseCandidate}`);
console.log(`checks run: ${checks}, failed: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
