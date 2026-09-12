// integrations/graph — the offline guards on the deployable subgraph. These do not replace
// `graph codegen` / `graph build` / `graph test`, which need the pinned CLI and its toolchain
// installed; they are the three drift checks that cost nothing and can run in the root `npm test`
// on a machine that has never installed it:
//
//   1. Every field the receipt page asks for (apps/web/assets/storefront.js, `graphQueryFor`)
//      exists on the entity this schema serves it from. A subgraph can build perfectly and still
//      answer the product's own query with "no such field".
//   2. Every event signature in subgraph.yaml is the signature that contract's ABI actually
//      declares, argument for argument, `indexed` included. A manifest that names an event the
//      chain never emits indexes nothing at all, silently, forever.
//   3. Every address and start block in subgraph.yaml is the one recorded in
//      deployments/unica-v4/11155111.json, and networks.json says the same.
//
// node --test integrations/graph/schema.test.mjs

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

const SCHEMA_TEXT = readFileSync(resolve(HERE, "schema.graphql"), "utf8");
const MANIFEST_TEXT = readFileSync(resolve(HERE, "subgraph.yaml"), "utf8");
const NETWORKS = JSON.parse(readFileSync(resolve(HERE, "networks.json"), "utf8"));
const STOREFRONT_TEXT = readFileSync(resolve(REPO, "apps/web/assets/storefront.js"), "utf8");
const DEPLOYMENT = JSON.parse(readFileSync(resolve(REPO, "deployments/unica-v4/11155111.json"), "utf8"));

/// The three data sources, by the contract each one indexes. The key is the data source's name in
/// subgraph.yaml and networks.json; `deployed` is the key under `contracts` in the deployment
/// record that must hold the same address.
const SOURCES = [
  {name: "UnicaMarketHook", deployed: "hook", abi: "UnicaMarketHook", event: "SettlementReceipt"},
  {name: "DirectSettlement", deployed: "directSettlement", abi: "DirectSettlement", event: "DirectReceipt"},
  {name: "ProductCatalog", deployed: "productCatalog", abi: "ProductCatalog", event: "ProductSold"},
];

// ---- reading the three files, without a YAML or a GraphQL dependency ----------------------------

/// Entity name -> Set of field names, from `type Name @entity(...) { ... }` blocks. Docstrings and
/// `#` comments are dropped first so neither can be read as a field.
function schemaEntities(text) {
  const clean = text.replace(/"""[\s\S]*?"""/g, "").replace(/^[^\n"]*#.*$/gm, "");
  const entities = new Map();
  const typeRe = /type\s+(\w+)\s*(?:@\w+\([^)]*\))?\s*\{([^{}]*)\}/g;
  let m;
  while ((m = typeRe.exec(clean))) {
    const fields = new Set();
    for (const line of m[2].split("\n")) {
      const field = /^\s*(\w+)\s*:/.exec(line);
      if (field) fields.add(field[1]);
    }
    entities.set(m[1], fields);
  }
  return entities;
}

/// The manifest's data sources: name, address, startBlock, and each event handler's signature with
/// every space removed, because the CLI wraps a long `event:` value across lines when it rewrites
/// the file and the wrapping is not part of the signature.
function manifestSources(text) {
  const sources = [];
  const blockRe = /-\s+kind:\s+ethereum\n([\s\S]*?)(?=\n  -\s+kind:|\s*$)/g;
  let m;
  while ((m = blockRe.exec(text))) {
    const body = m[1];
    const name = /\n?\s*name:\s*(\S+)/.exec(body);
    const address = /address:\s*"(0x[0-9a-fA-F]{40})"/.exec(body);
    const startBlock = /startBlock:\s*(\d+)/.exec(body);
    const events = [...body.matchAll(/-\s+event:\s*([\s\S]*?)\n\s*handler:\s*(\w+)/g)].map((e) => ({
      signature: e[1].replace(/\s+/g, ""),
      handler: e[2],
    }));
    sources.push({
      name: name ? name[1] : null,
      address: address ? address[1] : null,
      startBlock: startBlock ? Number(startBlock[1]) : null,
      events,
    });
  }
  return sources;
}

/// `Name(indexed type,type,...)` for one event in a committed ABI file — the same spelling a
/// manifest's `event:` uses.
function abiEventSignature(abiName, eventName) {
  const abi = JSON.parse(readFileSync(resolve(HERE, `abis/${abiName}.json`), "utf8"));
  const event = abi.find((e) => e.type === "event" && e.name === eventName);
  assert.ok(event, `abis/${abiName}.json declares no event ${eventName}`);
  const args = event.inputs.map((i) => (i.indexed ? `indexed ${i.type}` : i.type)).join(",");
  return `${eventName}(${args})`.replace(/\s+/g, "");
}

/// The field list of one query in `graphQueryFor`, read out of the storefront's own source rather
/// than restated here: a check that quotes the thing it is checking cannot drift from it.
function storefrontSelection(queryName, field) {
  const re = new RegExp(`query ${queryName}\\([^)]*\\)\\s*\\{[^{]*${field}\\([^)]*\\)\\s*\\{([^}]*)\\}`);
  const m = re.exec(STOREFRONT_TEXT);
  assert.ok(m, `storefront.js has no \`query ${queryName}\` selecting \`${field}\``);
  return m[1].trim().split(/\s+/).filter(Boolean);
}

// ---- 1. the receipt page's own two queries ------------------------------------------------------

test("every field the receipt page asks of `settlements` exists on Settlement", () => {
  const entities = schemaEntities(SCHEMA_TEXT);
  const fields = entities.get("Settlement");
  assert.ok(fields, "schema.graphql defines no Settlement entity");
  const asked = storefrontSelection("Settlements", "settlements");
  assert.ok(asked.length > 0, "the storefront's Settlements query selects nothing");
  assert.deepEqual(
    asked.filter((f) => !fields.has(f)),
    [],
  );
  // The page filters on this one; it has to be a field, not only a selection.
  assert.ok(fields.has("transactionHash"));
});

test("every field the receipt page asks of `productSale` exists on ProductSale", () => {
  const entities = schemaEntities(SCHEMA_TEXT);
  const fields = entities.get("ProductSale");
  assert.ok(fields, "schema.graphql defines no ProductSale entity");
  const asked = storefrontSelection("Sale", "productSale");
  assert.ok(asked.length > 0, "the storefront's Sale query selects nothing");
  assert.deepEqual(
    asked.filter((f) => !fields.has(f)),
    [],
  );
});

// ---- 2. the manifest's event signatures are the ABIs' own ---------------------------------------

test("subgraph.yaml names the three data sources this deployment has, and no others", () => {
  const sources = manifestSources(MANIFEST_TEXT);
  assert.deepEqual(
    sources.map((s) => s.name),
    SOURCES.map((s) => s.name),
  );
});

test("every event signature in subgraph.yaml is the one its ABI declares", () => {
  const sources = manifestSources(MANIFEST_TEXT);
  for (const want of SOURCES) {
    const source = sources.find((s) => s.name === want.name);
    assert.ok(source, `subgraph.yaml has no data source ${want.name}`);
    assert.equal(source.events.length, 1, `${want.name} should handle exactly one event`);
    assert.equal(source.events[0].signature, abiEventSignature(want.abi, want.event));
  }
});

// ---- 3. the addresses and start blocks are the recorded deployment's ----------------------------

test("subgraph.yaml and networks.json both pin the addresses in deployments/unica-v4/11155111.json", () => {
  assert.equal(DEPLOYMENT.chainId, 11155111);
  const sources = manifestSources(MANIFEST_TEXT);
  for (const want of SOURCES) {
    const recorded = DEPLOYMENT.contracts[want.deployed].address.toLowerCase();
    const source = sources.find((s) => s.name === want.name);
    assert.equal(source.address.toLowerCase(), recorded, `${want.name} in subgraph.yaml`);
    assert.equal(NETWORKS.sepolia[want.name].address.toLowerCase(), recorded, `${want.name} in networks.json`);
    assert.equal(NETWORKS.sepolia[want.name].startBlock, source.startBlock, `${want.name} start block`);
  }
});

test("no data source starts before the block this deployment was made in", () => {
  const sources = manifestSources(MANIFEST_TEXT);
  for (const source of sources) {
    // Indexing from earlier than the deployment costs time and finds nothing; indexing from later
    // silently skips receipts that already exist.
    assert.ok(
      source.startBlock >= DEPLOYMENT.deployedAtBlock,
      `${source.name} starts at ${source.startBlock}, before the deployment's ${DEPLOYMENT.deployedAtBlock}`,
    );
  }
});
