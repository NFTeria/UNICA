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

// ---- the frozen V1 subgraph is untouched -------------------------------------------------------
//
// This namespace exists so V1 does not have to change. Saying so is cheap; proving it is cheaper
// than discovering otherwise.

const v1Manifest = text(`${V1}/subgraph.yaml`);
chk("the V1 manifest still names the V1 hook",
    v1Manifest.includes("0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0")
      && v1Manifest.includes("V4SettlementHook"),
    "the frozen V1 subgraph has been edited");
chk("the V1 schema still declares Settlement and not InvoiceSettlement",
    text(`${V1}/schema.graphql`).includes("type Settlement ")
      && !text(`${V1}/schema.graphql`).includes("InvoiceSettlement"),
    "the frozen V1 schema has been edited");
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
console.log(`\nchecks run: ${checks}, failed: ${failures}, skipped: ${skipped}`);
process.exit(failures === 0 ? 0 : 1);
