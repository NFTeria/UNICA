// UNICA V2 indexer — the checks matchstick cannot make.
//
// A mapping test proves the handler does the right thing with an event it is handed. It cannot
// prove the manifest subscribes to the right event, on the right chain, at the right address, with
// an ABI that still matches the contract — and those are exactly the ways a subgraph silently
// indexes nothing. The old topic simply stops appearing, with no error anywhere.
//
// Run: node integrations/graph-v2/check.mjs

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
// The provider and the copilot are IMPORTED rather than described. A second description of a field
// list is a second thing to keep in step, and the whole point of these rows is that nothing is kept
// in step by hand. Both modules read no file and open no socket at import time, which is why this
// is safe in a gate that runs on a fresh clone.
import {FAILURE, META_SELECTION, NETWORK_CHAIN_ID, SETTLEMENT_FIELDS, buildSettlementQuery} from "./provider.mjs";
import {FINDING, REQUIRED_FIELDS, SEVERITY, VERDICT} from "./copilot.mjs";

// Anchored, so this reads the repository and not whatever directory it was called from.
chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));

const HERE = "integrations/graph-v2";
const V1 = "integrations/graph";
const rows = [];
let checks = 0;
let failures = 0;
let skipped = 0;
// A SKIP is stated, never folded into a pass. `generated/` comes from `graph codegen`, which needs
// node_modules — and the gate has to run on a fresh clone that has neither. An absent generator and
// a passing check must not look the same.
function skip(name, why) {
  skipped++;
  rows.push(`  SKIP  ${name}`);
  rows.push(`        ${why}`);
}
function chk(name, ok, detail) {
  checks++;
  rows.push(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    for (const d of [].concat(detail ?? [])) rows.push(`        ${d}`);
  }
}

const text = (p) => readFileSync(p, "utf8");
const topicOf = (s) => toHex(keccak256(new TextEncoder().encode(s)));

// ---- controls -------------------------------------------------------------------------------

// ERC-20 Transfer's topic, which every explorer on earth agrees on. If this line is wrong, nothing
// else in this file means anything.
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
chk("control: the topic derivation matches a known value",
    topicOf("Transfer(address,address,uint256)") === ERC20_TRANSFER_TOPIC);

// ---- the ABI is the contract's, not a copy that can drift -----------------------------------

const artifact = JSON.parse(text("out/QuoteSettlementExecutor.sol/QuoteSettlementExecutor.json"));
const fromArtifact = artifact.abi.filter((e) => e.type === "event" && e.name === "QuoteSettled");
const fromFile = JSON.parse(text(`${HERE}/abis/QuoteSettlementExecutor.json`));

chk("the manifest ABI carries exactly the receipt event", fromFile.length === 1 && fromArtifact.length === 1);
chk("the manifest ABI is byte-identical to the compiled contract's",
    JSON.stringify(fromFile) === JSON.stringify(fromArtifact),
    "regenerate it from out/ rather than editing it by hand");

// ---- the manifest subscribes to the event that actually exists -------------------------------

const manifest = text(`${HERE}/subgraph.yaml`);
const declared = manifest.match(/- event:\s*([\s\S]*?)\n\s+handler:/);
chk("the manifest declares an event handler", declared !== null);

let manifestSig = null;
if (declared) {
  // YAML folds the long signature across lines; put it back and strip `indexed`, which is part of
  // the manifest's syntax and not part of the topic.
  manifestSig = declared[1].replace(/\s+/g, "").replace(/indexed/g, "");
  const abiSig = `${fromFile[0].name}(${fromFile[0].inputs.map((i) => i.type).join(",")})`;
  chk("the manifest's event signature matches the ABI", manifestSig === abiSig,
      [`manifest: ${manifestSig}`, `abi:      ${abiSig}`]);

  const frozen = JSON.parse(text("docs/v2/release-candidate.json"));
  const frozenTopic = frozen.contracts.QuoteSettlementExecutor.events[abiSig];
  chk("the topic the manifest will subscribe to is the FROZEN topic",
      frozenTopic !== undefined && frozenTopic === topicOf(abiSig),
      "an indexer watching a stale topic sees nothing, and nothing is not an error");
}

// ---- the manifest is explicit about where it is looking ---------------------------------------

const network = manifest.match(/^\s+network:\s*(\S+)\s*$/m);
const address = manifest.match(/^\s+address:\s*"(0x[0-9a-fA-F]{40})"\s*$/m);
const startBlock = manifest.match(/^\s+startBlock:\s*(\d+)\s*$/m);
chk("the manifest names a network explicitly", network !== null, "a subgraph with an implied chain is a guess");
chk("the manifest names a 20-byte address explicitly", address !== null);
chk("the manifest names a start block", startBlock !== null && Number(startBlock[1]) > 0,
    "indexing from block 0 is a scan of the whole chain for events that cannot be there");

const networksFile = JSON.parse(text(`${HERE}/networks.json`));
if (network && address && startBlock) {
  const entry = networksFile[network[1]]?.QuoteSettlementExecutor;
  chk("networks.json agrees with the manifest", entry !== undefined
      && entry.address.toLowerCase() === address[1].toLowerCase()
      && String(entry.startBlock) === startBlock[1],
      "graph build takes the address from networks.json; a disagreement means the built subgraph is not the one reviewed");
}

// ---- the sibling subgraph stays a separate namespace ------------------------------------------
//
// ../graph indexes the live Sepolia market (UnicaMarketHook), the direct settler and the product
// catalogue; this namespace indexes the invoice path. Neither is edited for the other. Saying so
// is cheap; proving it is cheaper than discovering otherwise.

const v1Manifest = text(`${V1}/subgraph.yaml`);
chk("the sibling manifest names the Sepolia market hook and nothing from this namespace",
    v1Manifest.includes("0x2570a593e0D24ede29eC926e0c5a88B427b9A0c0")
      && v1Manifest.includes("UnicaMarketHook")
      && !v1Manifest.includes("InvoiceSettlement")
      && !v1Manifest.includes("QuoteSettled"),
    "the sibling subgraph has been pulled into the invoice path, or lost its market source");
chk("the sibling schema declares Settlement and not InvoiceSettlement",
    text(`${V1}/schema.graphql`).includes("type Settlement ")
      && !text(`${V1}/schema.graphql`).includes("InvoiceSettlement"),
    "the sibling schema has been edited for this namespace");
chk("the V2 schema declares InvoiceSettlement and not Settlement",
    text(`${HERE}/schema.graphql`).includes("type InvoiceSettlement ")
      && !/type Settlement\s/.test(text(`${HERE}/schema.graphql`)),
    "the two namespaces have merged");

// ---- every field a product query asks for exists in the schema --------------------------------

const schema = text(`${HERE}/schema.graphql`);
const entities = {};
for (const m of schema.matchAll(/type\s+(\w+)\s+@entity[^{]*\{([\s\S]*?)\n\}/g)) {
  const fields = new Set();
  for (const f of m[2].matchAll(/^\s{2}(\w+):/gm)) fields.add(f[1]);
  entities[m[1]] = fields;
}
chk("the schema declares the two entities", entities.InvoiceSettlement && entities.Deployment);

const queries = text(`${HERE}/queries.graphql`);
const queryNames = [...queries.matchAll(/^query\s+(\w+)/gm)].map((m) => m[1]);
chk("every product query the ledger promises is present", queryNames.length === 8,
    `found ${queryNames.length}: ${queryNames.join(", ")}`);

// Structural, not exhaustive: every bare selection inside a query body must be a field of one of
// the entities. It catches the thing that actually happens — a schema rename leaving a query
// asking for something that no longer exists.
const known = new Set([...Object.values(entities).flatMap((s) => [...s]), "settlements"]);
const unknown = new Set();
for (const line of queries.split("\n")) {
  const m = line.match(/^\s{4,}(\w+)\s*$/);
  if (m && !known.has(m[1])) unknown.add(m[1]);
}
chk("every field the queries select exists in the schema", unknown.size === 0, [...unknown]);

// ---- the start block is real -------------------------------------------------------------------
//
// The manifest row above already refuses block 0. networks.json is what `graph build` actually
// reads, so it is checked on its own terms rather than only against the manifest: the two agreeing
// on zero would pass the agreement row and index nothing.

for (const [net, entry] of Object.entries(networksFile)) {
  const sb = entry?.QuoteSettlementExecutor?.startBlock;
  chk(`networks.json start block for ${net} is a real block, not zero`,
      Number.isInteger(sb) && sb > 0,
      "indexing from block 0 scans the whole chain for events that cannot be there, and costs a Studio deployment hours");
}

// ---- the live provider asks for fields that exist -------------------------------------------------
//
// The provider validates every field it lists and refuses a row that is missing one. If the schema
// renames a field, that refusal fires against a LIVE endpoint, in front of whoever is watching. It
// is cheaper to fail here.

const settlementFields = entities.InvoiceSettlement ?? new Set();
const providerMissing = SETTLEMENT_FIELDS.filter((f) => !settlementFields.has(f));
chk("every field the live provider selects exists in the schema", providerMissing.length === 0, providerMissing);

const copilotMissing = REQUIRED_FIELDS.filter((f) => !settlementFields.has(f));
chk("every field the copilot requires exists in the schema", copilotMissing.length === 0, copilotMissing);

const notSelected = REQUIRED_FIELDS.filter((f) => !SETTLEMENT_FIELDS.includes(f));
chk("every field the copilot requires is one the provider actually asks for", notSelected.length === 0, notSelected,
    "the copilot would receive undefined and reject every live read");

const providerQuery = buildSettlementQuery({byRecipient: true});
chk("the provider's query asks _meta before it asks for rows",
    providerQuery.indexOf(META_SELECTION) < providerQuery.indexOf("invoiceSettlements"),
    "a freshness check made after the rows are read is a freshness check that arrived too late");
const queryMissing = SETTLEMENT_FIELDS.filter((f) => !new RegExp(`^\\s+${f}$`, "m").test(providerQuery));
chk("the provider's query selects every field the provider validates", queryMissing.length === 0, queryMissing);

// ---- the query filters name real fields too ---------------------------------------------------------
//
// The structural row above walks bare selections. A `where:` argument is not a bare selection, and a
// filter on a renamed field is the same silent-empty-result failure with a different shape.

const filterFields = new Set();
for (const m of queries.matchAll(/where:\s*\{([^}]*)\}/g)) {
  for (const f of m[1].matchAll(/(\w+)\s*:/g)) filterFields.add(f[1]);
}
const unknownFilters = [...filterFields].filter((f) => !known.has(f.replace(/_(gt|gte|lt|lte|in|not|contains)$/, "")));
chk(`every field the queries FILTER on exists in the schema (${filterFields.size} checked)`,
    unknownFilters.length === 0, unknownFilters);

// ---- the copilot's vocabulary is closed --------------------------------------------------------------
//
// The copilot's whole claim is that a reader can switch on its output. A finding name that is used
// but never declared breaks that quietly: the report still renders, and the consumer's switch falls
// through to nothing.

const copilotSource = text(`${HERE}/copilot.mjs`);
function undeclared(source, prefix, declared) {
  const used = new Set([...source.matchAll(new RegExp(`${prefix}\\.([A-Z_]+)`, "g"))].map((m) => m[1]));
  return [...used].filter((u) => !(u in declared));
}
chk("every FINDING the copilot emits is declared in its vocabulary",
    undeclared(copilotSource, "FINDING", FINDING).length === 0, undeclared(copilotSource, "FINDING", FINDING));
chk("every SEVERITY it uses is declared", undeclared(copilotSource, "SEVERITY", SEVERITY).length === 0,
    undeclared(copilotSource, "SEVERITY", SEVERITY));
chk("every VERDICT it can return is declared", undeclared(copilotSource, "VERDICT", VERDICT).length === 0,
    undeclared(copilotSource, "VERDICT", VERDICT));

// ---- every named failure is exercised by a test -------------------------------------------------------
//
// A taxonomy nobody drives is a list of strings. This does not prove the rows are good; it proves
// none of them is absent, which is the failure that happens when a new failure mode is added.

const providerTest = text(`${HERE}/provider-test.mjs`);
const untested = Object.keys(FAILURE).filter((f) => !providerTest.includes(`FAILURE.${f}`));
chk(`every one of the provider's ${Object.keys(FAILURE).length} named failures is named in its suite`,
    untested.length === 0, untested);

// ---- the live path cannot reach the offline samples -----------------------------------------------------
//
// The suite asserts this too. It is repeated in the gate because it is the load-bearing claim of the
// whole integration: an offline run that could render as a live one would make every screenshot in
// the submission worthless. Whole comment lines are stripped first, because the provider's header
// DOCUMENTS the absence and has to name the file to do it — a guard that fires on its own
// documentation is a guard that gets deleted.

const providerSource = text(`${HERE}/provider.mjs`);
const providerCode = providerSource
  .split("\n")
  .filter((l) => {
    const t = l.trim();
    return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
  })
  .join("\n");
chk("the live provider's code names no sample module", !providerCode.includes("samples.mjs"),
    "a fixture fallback is one import away from existing");
chk("the live provider's code reads no file",
    !providerCode.includes("node:fs") && !providerCode.includes("readFileSync"),
    "a module that can read from disk can fall back to a file on disk");
chk("control: the provider still documents why there is no fallback",
    providerSource.includes("does not import ./samples.mjs"),
    "the two rows above are checking a file that no longer explains itself");

// ---- nothing renders a credential ------------------------------------------------------------------------

const liveProof = text(`${HERE}/live-proof.mjs`);
chk("the live proof prints the endpoint's label and never its raw URL",
    !liveProof.includes("endpoint.url"),
    "the URL can carry the API key in its path; only the redacted label is printable");
// The row above covers the SUBGRAPH endpoint only, and for a while that was the whole of this
// section — which is how the head RPC came to be printed raw. UNICA_HEAD_RPC_URL exists so an
// operator can point the independent head source at their own node, and a node provider's url
// carries its key as an ordinary path segment (`/v2/<key>`), where the endpoint redactor does not
// look. The head RPC must stay VISIBLE — a proof whose independent source is secret proves
// nothing — so it goes through `rpcLabel`, which keeps the host and redacts the segment.
chk("the live proof prints the head RPC through a label, never the raw variable",
    /rpcLabel\(headRpc\)/.test(liveProof) && !/\$\{headRpc\}/.test(liveProof),
    "UNICA_HEAD_RPC_URL can carry a node provider's key in its path");
chk("the live proof refuses a staleness threshold it could not parse",
    liveProof.includes("BAD_THRESHOLD") && !/Number\(env\.UNICA_MAX_LAG_BLOCKS\)/.test(liveProof),
    "Number(\"abc\") is NaN and every comparison against NaN is false, so an unparseable threshold "
      + "deletes the staleness check instead of widening it");

// A pasted key would land in the owner document or the README, which is where somebody copies a
// working command back from. The provider suite's planted key is deliberately NOT scanned here: it
// is a fake, it is declared as a fake, and a scanner that fires on its own test fixture gets muted.
for (const doc of ["STUDIO-OWNER-ACTION.md", "README.md"]) {
  const body = text(`${HERE}/${doc}`);
  chk(`${doc} carries no filled-in API key`,
      !/\/api\/[0-9a-f]{16,}/i.test(body) && !/\b[0-9a-f]{32}\b/.test(body),
      "a key pasted into a document in a public repository is a disclosed key, permanently");
}
chk("the provider suite declares its planted key as a plant",
    providerTest.includes("the planted credential"),
    "the key-shaped constant in the suite is no longer labelled, and a reader would take it for a real one");

const ownerDoc = text(`${HERE}/STUDIO-OWNER-ACTION.md`);
chk("the owner document uses a placeholder for the deploy key",
    ownerDoc.includes("<DEPLOY_KEY>"),
    "the deploy steps must be copyable without inviting a real key into the repository");
chk("the owner document says the deploy key never comes back into the repository",
    /never.{0,80}(paste|commit)/is.test(ownerDoc),
    "the one rule the owner has to carry away is the one that cannot be undone");

// ---- the manifest's network is one the provider can measure staleness against -------------------------------

if (network) {
  chk(`the provider knows a chain id for the manifest's network (${network[1]})`,
      NETWORK_CHAIN_ID[network[1]] !== undefined,
      "the staleness margin is measured against a head from an independent RPC, and an unknown network has no head to compare with");
}

// ---- the generated bindings are in step with the schema ----------------------------------------

let generated = null;
try {
  generated = text(`${HERE}/generated/schema.ts`);
} catch {
  generated = null;
}
if (generated === null) {
  skip("the generated bindings cover every schema field",
       "generated/ is absent; run `npx graph codegen` in integrations/graph-v2 (this is a SKIP, not a pass)");
} else {
  const missing = [...(entities.InvoiceSettlement ?? [])].filter(
    (f) => !generated.includes(`get ${f}()`) && !generated.includes(`set ${f}(`),
  );
  chk("the generated bindings cover every schema field", missing.length === 0, missing);
}

console.log("UNICA V2 indexer — manifest, ABI and query consistency");
console.log(rows.join("\n"));
console.log(`\nchecks run: ${checks}, passed: ${checks - failures}, failed: ${failures}, skipped: ${skipped}`);
process.exit(failures === 0 ? 0 : 1);
