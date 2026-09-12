// integrations/graph/unica-v4 — structural checks only. Neither file here is ever sent to a Graph
// Node toolchain (nothing is deployed, README.md), so this cannot and does not prove either file
// would pass `graph codegen`/`graph build`. What it does check, without any GraphQL library
// dependency (none is pinned in package-lock.json for this workspace):
//
//   1. Braces balance in both files.
//   2. Every type name used as a field's type in schema.graphql is actually defined there (as a
//      `type` or `scalar`), or is a GraphQL built-in scalar.
//   3. Every field `queries.graphql`'s `ReceiptByOrderId` selects exists on the schema type it is
//      selected against, walked recursively from `Query` down through `Settlement`/`Order` and
//      their nested selections.
//
// node --test integrations/graph/unica-v4/schema.test.mjs

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_TEXT = readFileSync(resolve(HERE, "schema.graphql"), "utf8");
const QUERIES_TEXT = readFileSync(resolve(HERE, "queries.graphql"), "utf8");

const BUILTIN_SCALARS = new Set(["ID", "String", "Boolean", "Int", "Float"]);

function stripComments(text) {
  return text
    .split("\n")
    .map((line) => {
      const at = line.indexOf("#");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

function braceBalance(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) return depth; // closed before opened
    }
  }
  return depth;
}

function baseTypeName(rawType) {
  return rawType.trim().replace(/[[\]!\s]/g, "");
}

/// Parses `type Name @dir(...) { field: Type ... }` and `scalar Name` blocks. Good enough for a
/// schema this small and this regular (no nested braces inside a field's own type expression here).
function parseSchema(text) {
  const clean = stripComments(text);
  const scalars = new Set([...clean.matchAll(/^\s*scalar\s+(\w+)/gm)].map((m) => m[1]));
  const types = new Map(); // typeName -> Map(fieldName -> baseTypeName)
  const typeRe = /type\s+(\w+)\s*(?:@\w+\([^)]*\))?\s*\{([^{}]*)\}/g;
  let m;
  while ((m = typeRe.exec(clean))) {
    const [, typeName, body] = m;
    const fields = new Map();
    for (const line of body.split("\n")) {
      const fieldMatch = /^\s*(\w+)\s*(?:\([^)]*\))?\s*:\s*(.+?)\s*$/.exec(line);
      if (!fieldMatch) continue;
      const [, fieldName, rawType] = fieldMatch;
      fields.set(fieldName, baseTypeName(rawType));
    }
    types.set(typeName, fields);
  }
  return {scalars, types};
}

/// Parses one GraphQL selection set into a tree: [{name, children: [...] | null}]. Handles field
/// arguments `name(arg: $var)` by skipping the parenthesised group; does not handle aliases,
/// fragments or directives, none of which queries.graphql's ReceiptByOrderId uses.
function parseSelectionSet(text, i) {
  const fields = [];
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "}") return {fields, next: i + 1};
    if (i >= text.length) return {fields, next: i};
    const idMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (!idMatch) {
      i++; // skip stray character defensively rather than looping forever
      continue;
    }
    const name = idMatch[0];
    i += name.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "(") {
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        i++;
      }
      while (i < text.length && /\s/.test(text[i])) i++;
    }
    if (text[i] === "{") {
      const sub = parseSelectionSet(text, i + 1);
      fields.push({name, children: sub.fields});
      i = sub.next;
    } else {
      fields.push({name, children: null});
    }
  }
  return {fields, next: i};
}

function parseReceiptByOrderIdQuery(text) {
  const clean = stripComments(text);
  const headerMatch = /query\s+ReceiptByOrderId\s*\([^)]*\)\s*\{/.exec(clean);
  assert.ok(headerMatch, "queries.graphql must declare `query ReceiptByOrderId(...)  { ... }`");
  const bodyStart = headerMatch.index + headerMatch[0].length;
  const {fields} = parseSelectionSet(clean, bodyStart);
  return fields;
}

// ---- 1. braces balance ------------------------------------------------------------------------

test("schema.graphql has balanced braces", () => {
  assert.equal(braceBalance(SCHEMA_TEXT), 0);
});

test("queries.graphql has balanced braces", () => {
  assert.equal(braceBalance(QUERIES_TEXT), 0);
});

// ---- 2. every type referenced in schema.graphql is defined --------------------------------------

test("every field type referenced in schema.graphql is a defined type or a built-in scalar", () => {
  const {scalars, types} = parseSchema(SCHEMA_TEXT);
  const known = new Set([...BUILTIN_SCALARS, ...scalars, ...types.keys()]);
  const undefinedRefs = [];
  for (const [typeName, fields] of types) {
    for (const [fieldName, ref] of fields) {
      if (!known.has(ref)) undefinedRefs.push(`${typeName}.${fieldName}: ${ref}`);
    }
  }
  assert.deepEqual(undefinedRefs, []);
});

test("schema.graphql defines every one of the ten SETTLEMENT-SCHEMA.md §4.27 entities named in the brief", () => {
  const {types} = parseSchema(SCHEMA_TEXT);
  const required = [
    "Registry",
    "ProtocolRelease",
    "Market",
    "MarketVersion",
    "Order",
    "Settlement",
    "HookReceipt",
    "ExecutorReceipt",
    "EvidenceStatus",
    "Anomaly",
  ];
  for (const name of required) assert.ok(types.has(name), `missing type ${name}`);
});

// ---- 3. the query's fields exist in the schema, walked recursively from Query --------------------

test("queries.graphql's ReceiptByOrderId only selects fields that exist on the corresponding schema type", () => {
  const {types} = parseSchema(SCHEMA_TEXT);
  const rootFields = parseReceiptByOrderIdQuery(QUERIES_TEXT);

  const queryType = new Map([
    ["settlement", "Settlement"],
    ["order", "Order"],
  ]);

  function walk(fields, typeName, path) {
    const typeFields = types.get(typeName);
    assert.ok(typeFields, `${path}: type ${typeName} is not defined in schema.graphql`);
    for (const field of fields) {
      const here = `${path}.${field.name}`;
      assert.ok(typeFields.has(field.name), `${here}: no such field on ${typeName}`);
      const fieldType = typeFields.get(field.name);
      if (field.children) {
        assert.ok(!BUILTIN_SCALARS.has(fieldType) && fieldType !== "Bytes" && fieldType !== "BigInt", `${here}: has a sub-selection but ${fieldType} is a scalar`);
        walk(field.children, fieldType, here);
      }
    }
  }

  for (const root of rootFields) {
    const typeName = queryType.get(root.name);
    assert.ok(typeName, `ReceiptByOrderId selects top-level field "${root.name}", which is not settlement/order`);
    assert.ok(root.children, `${root.name} must have a sub-selection`);
    walk(root.children, typeName, root.name);
  }
  assert.deepEqual(
    rootFields.map((f) => f.name),
    ["settlement", "order"],
  );
});
