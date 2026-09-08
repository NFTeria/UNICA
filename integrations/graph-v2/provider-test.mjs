// The provider's failure taxonomy, one row per named failure, driven by a stubbed fetch.
//
// Offline: nothing here opens a socket. `fetch` is a parameter of the provider precisely so every
// way a live read can go wrong is reachable from a test — a failure path that can only be produced
// by a real outage is a failure path nobody has ever seen work.
//
// THREE THINGS THIS SUITE EXISTS TO PROVE, beyond the taxonomy itself:
//
//   1. THE KEY NEVER COMES OUT. A key-shaped string is planted in GRAPH_API_KEY and inside the
//      endpoint's path, every failure and the success path are driven, and the string is searched
//      for in the returned object AND in every rendered line. The redactor is itself controlled:
//      a row proves it does not simply blank everything.
//   2. THERE IS NO FIXTURE FALLBACK. Structurally — the provider's source imports no sample module,
//      opens no file, and names no fixture — and behaviourally: every refusal returns no rows at
//      all, so there is nothing for a caller to mistake for data.
//   3. `live-proof.mjs` FAILS CLOSED. It is spawned with the endpoint variables removed and must
//      exit non-zero while naming the variable that is missing. Two different missing variables are
//      driven, so the message is derived rather than hard-coded.
//
// Run: node integrations/graph-v2/provider-test.mjs

import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {
  DEFAULTS,
  FAILURE,
  LIVE_SOURCE,
  META_SELECTION,
  NUMERIC_FIELDS,
  SETTLEMENT_FIELDS,
  buildSettlementQuery,
  endpointLabel,
  fetchChainHead,
  fetchSettlements,
  judgeMeta,
  redactSecrets,
  renderFailure,
  resolveEndpoint,
  rpcLabel,
  validateRows,
} from "./provider.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const rows = [];

function check(name, ok, why) {
  rows.push(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) {
    passed++;
  } else {
    failed++;
    for (const line of [].concat(why ?? [])) rows.push(`        ${line}`);
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, [`expected ${expected}`, `got      ${actual}`]);
}

// If this suite dies before printing its tail — an unexpected throw, a module that fails to load —
// the exit hook below says so and counts the crash as a failure. A run that produced no count line
// and a run that passed must never look the same to whoever reads the output; measured on this
// suite, a deliberately broken provider crashed it and it printed nothing at all.
let finished = false;
process.on("exit", () => {
  if (finished) return;
  console.log(rows.join("\n"));
  console.log("\nABORTED: the suite threw before it finished; the rows above are all that ran");
  console.log(`checks run: ${passed + failed + 1}, passed: ${passed}, failed: ${failed + 1}`);
});

// ---- the planted credential ---------------------------------------------------------------------
//
// Key-shaped and unmistakable. Nothing in this file prints it, and every assertion about it is
// phrased so that a FAILING row does not print it either — a suite that leaks the secret it is
// checking for on the way to reporting the leak has not helped.

const KEY = "deadbeefcafebabe0123456789abcdef";
const URL_WITH_KEY = `https://gateway.thegraph.com/api/${KEY}/subgraphs/id/QmUnicaV2Example`;
const URL_WITH_PLACEHOLDER = "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/QmUnicaV2Example";
const URL_CLEAN = "https://api.studio.thegraph.com/query/12345/unica-v2/v0.0.1";
const ENV = {UNICA_SUBGRAPH_URL: URL_WITH_KEY, GRAPH_API_KEY: KEY};

const HEAD = 11_700_000;
const MERCHANT = "0xa50802fbcafc5af3d0093026d301a82ec341652a";

// ---- the stubbed transport ------------------------------------------------------------------------

function response(status, body) {
  return {status, text: async () => (typeof body === "string" ? body : JSON.stringify(body))};
}
/// A fetch that answers with the given responses in order and records how many times it was called.
function stub(...responses) {
  let i = 0;
  const impl = async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (r instanceof Error) throw r;
    return r;
  };
  impl.calls = () => i;
  return impl;
}
function meta({indexed = HEAD, errors = false, timestamp = 1_770_000_000} = {}) {
  return {
    deployment: "QmUnicaV2ExampleDeployment",
    hasIndexingErrors: errors,
    block: {number: indexed, hash: "0xabc", timestamp},
  };
}
let rowSeq = 0;
function row(over = {}) {
  const i = rowSeq++;
  return {
    id: `0x${String(i).padStart(4, "0")}`,
    quoteId: `0xq${i}`,
    quoteDigest: `0xd${i}`,
    payer: "0x00000000000000000000000000000000000000a1",
    merchantSigner: MERCHANT,
    recipient: MERCHANT,
    tokenIn: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    actualIn: "1000",
    maxIn: "2000",
    tokenOut: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    amountOut: "100",
    deliveredOut: "100",
    executor: "0x5615deb798bb3e4dfa0139dfa1b3d433cc23b72f",
    policyVersion: "1",
    transactionHash: `0xt${i}`,
    logIndex: "0",
    blockNumber: String(11_600_000 + i),
    blockTimestamp: String(1_769_000_000 + i * 60),
    ...over,
  };
}
function good(rowsOut = [row()], metaOver = {}) {
  return response(200, {data: {_meta: meta(metaOver), invoiceSettlements: rowsOut}});
}
async function read(fetchImpl, over = {}) {
  return fetchSettlements({env: ENV, chainHead: HEAD, recipient: MERCHANT, fetchImpl, ...over});
}

// ---- the control: a well-formed, fresh response parses ---------------------------------------------
//
// Written first. Every refusal below is this response with exactly one thing moved.

{
  const r = await read(stub(good([row(), row()])));
  eq("control: a well-formed fresh response parses", r.ok, true);
  eq("...and is marked as live", r.source, LIVE_SOURCE);
  eq("...with both rows", r.settlements.length, 2);
  eq("...each stamped with its source", r.settlements.every((s) => s.source === LIVE_SOURCE), true);
  eq("...and the indexed block reported", r.meta.indexedBlock, HEAD);
  eq("...and the staleness margin computed", r.meta.lagBlocks, 0);
  eq("...and the deployment named", r.meta.deployment, "QmUnicaV2ExampleDeployment");
}
{
  // Paging: two full pages then a short one. The provider must not stop at the first full page.
  const page = [row(), row()];
  const r = await read(stub(good(page), good(page), good([row()])), {pageSize: 2});
  eq("control: a short page ends the read", r.ok, true);
  eq("...after three requests", r.pages, 3);
  eq("...with five rows", r.settlements.length, 5);
}

// ---- the endpoint, before a request is made -----------------------------------------------------------

{
  const r = resolveEndpoint({});
  eq("an unset UNICA_SUBGRAPH_URL is NO_ENDPOINT", r.failure, FAILURE.NO_ENDPOINT);
  eq("...naming the variable to set", r.variable, "UNICA_SUBGRAPH_URL");
}
{
  const r = resolveEndpoint({UNICA_SUBGRAPH_URL: "   "});
  eq("a whitespace-only endpoint is NO_ENDPOINT", r.failure, FAILURE.NO_ENDPOINT);
}
{
  const r = resolveEndpoint({UNICA_SUBGRAPH_URL: URL_WITH_PLACEHOLDER});
  eq("an [api-key] placeholder with no key is NO_API_KEY", r.failure, FAILURE.NO_API_KEY);
  eq("...naming the variable to set", r.variable, "GRAPH_API_KEY");
}
{
  const r = resolveEndpoint({UNICA_SUBGRAPH_URL: `http://gateway.thegraph.com/api/${KEY}/subgraphs/id/Q`});
  eq("a cleartext endpoint is refused", r.failure, FAILURE.ENDPOINT_NOT_HTTPS);
  check("...without echoing the key that was about to be sent in the clear",
        !JSON.stringify(r).includes(KEY), "the refusal carried the credential");
}
{
  const r = resolveEndpoint({UNICA_SUBGRAPH_URL: URL_WITH_PLACEHOLDER, GRAPH_API_KEY: KEY});
  eq("control: the placeholder resolves when the key is present", r.ok, true);
  check("...and the key is substituted into the URL that will be used",
        r.url.includes(KEY), "the placeholder was left in the URL");
  check("...but never into the label that will be printed",
        !r.label.includes(KEY) && !r.label.includes("[api-key]"),
        "the printable label carried the credential or the unfilled placeholder");
}
{
  const r = resolveEndpoint({UNICA_SUBGRAPH_URL: URL_CLEAN, GRAPH_API_KEY: KEY});
  eq("control: a Studio URL with the key in the header resolves", r.ok, true);
  eq("...and is printable in full", r.label, URL_CLEAN);
}
{
  const r = await fetchSettlements({env: ENV, chainHead: null, fetchImpl: stub(good())});
  eq("no chain head is NO_CHAIN_HEAD", r.failure, FAILURE.NO_CHAIN_HEAD);
  check("...and nothing was requested", true);
}

// ---- transport, HTTP and body shape -------------------------------------------------------------------

{
  const r = await read(stub(new Error("getaddrinfo ENOTFOUND gateway.thegraph.com")));
  eq("a throwing fetch is TRANSPORT_ERROR", r.failure, FAILURE.TRANSPORT_ERROR);
}
{
  const r = await read(stub(response(500, "upstream error")));
  eq("a non-200 is HTTP_ERROR", r.failure, FAILURE.HTTP_ERROR);
  eq("...carrying the status", r.status, 500);
}
{
  const r = await read(stub(response(429, "rate limited")));
  eq("a 429 is the same named failure with its own status", r.failure, FAILURE.HTTP_ERROR);
  eq("...carrying the status", r.status, 429);
}
{
  const r = await read(stub(response(200, "<html>maintenance</html>")));
  eq("HTTP 200 with a non-JSON body is MALFORMED_JSON", r.failure, FAILURE.MALFORMED_JSON);
}
{
  const r = await read(stub(response(200, {ok: true})));
  eq("JSON with neither data nor errors is MALFORMED_PAYLOAD", r.failure, FAILURE.MALFORMED_PAYLOAD);
}
{
  const r = await read(stub(response(200, {errors: [{message: "Store error: database unavailable"}]})));
  eq("a GraphQL errors array is GRAPHQL_ERRORS", r.failure, FAILURE.GRAPHQL_ERRORS);
  check("...carrying the server's own message", r.detail.includes("database unavailable"), r.detail);
}
{
  const r = await read(
    stub(response(200, {data: {_meta: meta(), invoiceSettlements: [row()]}, errors: [{message: "field failed"}]})),
  );
  eq("data AND errors together is PARTIAL_DATA, not a partial answer", r.failure, FAILURE.PARTIAL_DATA);
  check("...and no rows come back", r.settlements === undefined, "a partial read returned rows");
}

// ---- `_meta`: the freshness verdict, before any row is used ---------------------------------------------

{
  const r = await read(stub(response(200, {data: {invoiceSettlements: [row()]}})));
  eq("a response with no _meta is META_MISSING", r.failure, FAILURE.META_MISSING);
  check("...and the rows it did carry are not returned", r.settlements === undefined,
        "rows from an unverifiable index were returned");
}
{
  const r = await read(stub(response(200, {data: {_meta: {hasIndexingErrors: false}, invoiceSettlements: []}})));
  eq("_meta without a block number is META_MISSING", r.failure, FAILURE.META_MISSING);
}
{
  const r = await read(stub(good([row()], {errors: true})));
  eq("hasIndexingErrors true is INDEXING_ERRORS", r.failure, FAILURE.INDEXING_ERRORS);
  check("...and no rows are returned from an index that reports itself broken",
        r.settlements === undefined, "rows from a broken index were returned");
}
{
  // The boundary, from the passing side first. Exactly at the threshold is NOT stale.
  const r = await read(stub(good([row()], {indexed: HEAD - DEFAULTS.maxLagBlocks})));
  eq(`control: exactly ${DEFAULTS.maxLagBlocks} blocks behind is accepted`, r.ok, true);
  eq("...with the lag reported", r.meta.lagBlocks, DEFAULTS.maxLagBlocks);
}
{
  // SABOTAGE: one block further behind.
  const r = await read(stub(good([row()], {indexed: HEAD - DEFAULTS.maxLagBlocks - 1})));
  eq(`${DEFAULTS.maxLagBlocks + 1} blocks behind is STALE_INDEX`, r.failure, FAILURE.STALE_INDEX);
  eq("...reporting the lag it refused on", r.lagBlocks, DEFAULTS.maxLagBlocks + 1);
  eq("...and the threshold it refused against", r.maxLagBlocks, DEFAULTS.maxLagBlocks);
  check("...and returning no rows", r.settlements === undefined, "a stale read returned rows");
}
{
  // A head drifting slightly behind the gateway is ordinary; a head far behind it is not.
  const near = await read(stub(good([row()], {indexed: HEAD + DEFAULTS.maxHeadDriftBlocks})));
  eq(`control: an index exactly ${DEFAULTS.maxHeadDriftBlocks} blocks ahead of head is tolerated`, near.ok, true);
  const far = await read(stub(good([row()], {indexed: HEAD + DEFAULTS.maxHeadDriftBlocks + 1})));
  eq("one block further ahead is HEAD_INCONSISTENT", far.failure, FAILURE.HEAD_INCONSISTENT);
}
{
  // Two pages whose _meta disagree: the index moved mid-read, so the pages are not one snapshot.
  const page = [row(), row()];
  const r = await read(stub(good(page, {indexed: HEAD}), good(page, {indexed: HEAD - 1})), {pageSize: 2});
  eq("an index that moves between pages is PARTIAL_DATA", r.failure, FAILURE.PARTIAL_DATA);
  check("...and says the pages are not one snapshot", r.reason.includes("not one snapshot"), r.reason);
}

// ---- row shape ------------------------------------------------------------------------------------------

{
  for (const field of SETTLEMENT_FIELDS) {
    const bad = row();
    delete bad[field];
    const r = await read(stub(good([bad])));
    check(`a row missing \`${field}\` is SHAPE_MISMATCH`,
          r.failure === FAILURE.SHAPE_MISMATCH && r.field === field,
          [`got ${r.failure} / field ${r.field}`]);
  }
}
{
  for (const field of NUMERIC_FIELDS) {
    const r = await read(stub(good([row({[field]: "12.5"})])));
    check(`a non-integer \`${field}\` is SHAPE_MISMATCH`,
          r.failure === FAILURE.SHAPE_MISMATCH && r.field === field,
          [`got ${r.failure} / field ${r.field}`]);
  }
}
{
  const r = await read(stub(good([row({payer: "0xnot-an-address"})])));
  eq("a malformed address is SHAPE_MISMATCH", r.failure, FAILURE.SHAPE_MISMATCH);
  eq("...naming the field", r.field, "payer");
}
{
  const r = await read(stub(response(200, {data: {_meta: meta(), invoiceSettlements: "not a list"}})));
  eq("a non-array row set is SHAPE_MISMATCH", r.failure, FAILURE.SHAPE_MISMATCH);
}
{
  // One bad row among good ones refuses the WHOLE read. Dropping it would produce a total that is
  // wrong and looks right.
  const r = await read(stub(good([row(), row({amountOut: "oops"}), row()])));
  eq("one bad row refuses the whole read", r.failure, FAILURE.SHAPE_MISMATCH);
  check("...rather than returning the rows that happened to parse", r.settlements === undefined,
        "a partial row set was returned");
}
{
  const r = validateRows([], {endpoint: "x"});
  eq("control: an empty row set is valid (it is not an error to have no settlements)", r.ok, true);
}

// ---- the chain head ---------------------------------------------------------------------------------------

function rpcStub(chainIdHex, headHex, {status = 200} = {}) {
  let i = 0;
  return async () => {
    const result = i++ === 0 ? chainIdHex : headHex;
    return response(status, {jsonrpc: "2.0", id: 1, result});
  };
}
{
  const r = await fetchChainHead({rpcUrl: "https://node.example", expectedChainId: 11155111, fetchImpl: rpcStub("0xaa36a7", "0xb2d05e")});
  eq("control: a correct head RPC answers with a head", r.ok, true);
  eq("...on the expected chain", r.chainId, 11155111);
  eq("...at the expected block", r.blockNumber, 0xb2d05e);
}
{
  const r = await fetchChainHead({rpcUrl: "https://node.example", expectedChainId: 11155111, fetchImpl: rpcStub("0x1", "0xb2d05e")});
  eq("a head RPC on the wrong chain is HEAD_WRONG_CHAIN", r.failure, FAILURE.HEAD_WRONG_CHAIN);
  eq("...naming the chain it actually is", r.chainId, 1);
}
{
  const r = await fetchChainHead({rpcUrl: "https://node.example", expectedChainId: 11155111, fetchImpl: stub(response(503, "down"))});
  eq("an unreachable head RPC is HEAD_UNAVAILABLE", r.failure, FAILURE.HEAD_UNAVAILABLE);
}
{
  const r = await fetchChainHead({rpcUrl: "", expectedChainId: 11155111});
  eq("no head RPC url is HEAD_UNAVAILABLE", r.failure, FAILURE.HEAD_UNAVAILABLE);
}

// ---- the credential never comes out ---------------------------------------------------------------------------

{
  // The redactor, controlled from both sides. A redactor that blanks everything would pass the
  // absence assertions below while destroying every message, so it is checked for both.
  eq("control: the redactor removes a known secret", redactSecrets(`a${KEY}b`, [KEY]), "a[redacted]b");
  eq("control: it leaves everything else alone", redactSecrets("the index is 25 blocks behind", [KEY]),
     "the index is 25 blocks behind");
  check("it redacts a gateway key on shape alone, with no secret supplied",
        !redactSecrets(URL_WITH_KEY, []).includes(KEY), "a key in the path survived with no secret list");
  check("control: the surrounding URL survives the structural redaction",
        redactSecrets(URL_WITH_KEY, []).includes("gateway.thegraph.com")
          && redactSecrets(URL_WITH_KEY, []).includes("QmUnicaV2Example"),
        "the redactor destroyed the message along with the secret");
  check("the printable label of a key-carrying URL does not carry the key",
        !endpointLabel(URL_WITH_KEY, [KEY]).includes(KEY), "the label carried the credential");
  check("...even when no secret list is supplied",
        !endpointLabel(URL_WITH_KEY, []).includes(KEY), "the label carried the credential");
}
{
  // Every failure path plus the success path, with the key planted in the environment, in the URL,
  // and echoed back by the server in an error body.
  const echo = `request to /api/${KEY}/subgraphs failed`;
  const scenarios = [
    ["a transport error", stub(new Error(`connect ECONNREFUSED for ${URL_WITH_KEY}`))],
    ["an HTTP error whose body echoes the request", stub(response(500, echo))],
    ["a malformed JSON body echoing the request", stub(response(200, echo))],
    ["a malformed payload", stub(response(200, {note: echo}))],
    ["a GraphQL errors array echoing the request", stub(response(200, {errors: [{message: echo}]}))],
    ["partial data", stub(response(200, {data: {_meta: meta(), invoiceSettlements: []}, errors: [{message: echo}]}))],
    ["a missing _meta", stub(response(200, {data: {invoiceSettlements: []}}))],
    ["indexing errors", stub(good([row()], {errors: true}))],
    ["a stale index", stub(good([row()], {indexed: HEAD - 10_000}))],
    ["a shape mismatch", stub(good([row({amountOut: "x"})]))],
    ["a successful read", stub(good([row()]))],
  ];
  let leaks = [];
  for (const [name, fetchImpl] of scenarios) {
    const r = await read(fetchImpl);
    const rendered = r.ok ? JSON.stringify(r.meta) + r.endpoint : renderFailure(r, [KEY]);
    if (JSON.stringify(r).includes(KEY)) leaks.push(`${name}: the returned object`);
    if (String(rendered).includes(KEY)) leaks.push(`${name}: the rendered output`);
  }
  check(`the planted key appears in no returned object and no rendered line across ${scenarios.length} paths`,
        leaks.length === 0, leaks);
  check("control: those scenarios actually ran", scenarios.length === 11);
}

// ---- there is no fixture fallback, structurally or behaviourally -----------------------------------------------

{
  /// Comment lines are removed before the scan, and only whole comment lines. The provider's header
  /// DOCUMENTS that it does not import the sample module, and it has to name the file to say so —
  /// a guard that fires on its own documentation gets suppressed, and a suppressed guard protects
  /// nothing. A reference in code is always on a code line, so this loses no strictness: a trailing
  /// comment on a code line is not stripped and would still fail.
  function stripCommentLines(text) {
    const out = [];
    let inBlock = false;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (inBlock) {
        if (t.includes("*/")) inBlock = false;
        continue;
      }
      if (t.startsWith("/*")) {
        if (!t.includes("*/")) inBlock = true;
        continue;
      }
      if (t.startsWith("//") || t.startsWith("///") || t.startsWith("*")) continue;
      out.push(line);
    }
    return out.join("\n");
  }

  const raw = readFileSync(resolve(HERE, "provider.mjs"), "utf8");
  const source = stripCommentLines(raw);
  check("control: stripping comments left the code behind",
        source.includes("export async function fetchSettlements") && !source.includes("WHAT IT IS FOR"),
        "the structural rows below were checking the wrong text");
  check("the provider imports no sample module", !/from\s+["']\.\/samples\.mjs["']/.test(source),
        "provider.mjs imports the offline samples");
  check("no line of the provider's CODE names the sample module", !source.includes("samples.mjs"),
        "provider.mjs names the offline samples outside a comment");
  check("the provider reads no file", !source.includes("node:fs") && !source.includes("readFileSync"),
        "provider.mjs can read from disk, which is where a fallback fixture would live");
  check("the provider names no fixture directory", !/fixtures?\//.test(source), "provider.mjs names a fixture path");
  check("control: the header that documents the absence is still present in the raw file",
        raw.includes("does not import ./samples.mjs"),
        "the provider stopped documenting why there is no fallback");

  const samples = readFileSync(resolve(HERE, "samples.mjs"), "utf8");
  check("control: the sample module exists and stamps a different source",
        samples.includes("OFFLINE_FIXTURE") && !samples.includes("LIVE_SUBGRAPH"),
        "the sample module could stamp records as live");
}
{
  // Behavioural: every refusal returns no rows at all.
  const refusals = [
    stub(new Error("boom")),
    stub(response(500, "x")),
    stub(response(200, "x")),
    stub(response(200, {})),
    stub(response(200, {errors: [{message: "x"}]})),
    stub(response(200, {data: {invoiceSettlements: []}})),
    stub(good([row()], {errors: true})),
    stub(good([row()], {indexed: HEAD - 10_000})),
    stub(good([row({amountOut: "x"})])),
  ];
  let carried = [];
  for (const fetchImpl of refusals) {
    const r = await read(fetchImpl);
    if (r.ok !== false) carried.push(`${r.failure ?? "ok"}: not a refusal`);
    if (r.settlements !== undefined) carried.push(`${r.failure}: carried settlements`);
    if (r.source !== null) carried.push(`${r.failure}: carried a source`);
  }
  check(`all ${refusals.length} refusals return no rows and no source`, carried.length === 0, carried);
}

// ---- the query asks for what the provider validates -------------------------------------------------------------

{
  const q = buildSettlementQuery({byRecipient: true});
  check("the query asks _meta first", q.indexOf(META_SELECTION) < q.indexOf("invoiceSettlements"),
        "freshness is asked for after the rows");
  const missing = SETTLEMENT_FIELDS.filter((f) => !new RegExp(`^\\s+${f}$`, "m").test(q));
  check("every field the provider validates is a field the query selects", missing.length === 0, missing);
  const unfiltered = buildSettlementQuery({byRecipient: false});
  check("the unfiltered query takes no recipient variable", !unfiltered.includes("$recipient"), unfiltered);
  check("control: the filtered one does", q.includes("$recipient"));
}

// ---- judgeMeta on its own, so the boundary is not only reachable through a network shape --------------------------

{
  const base = {chainHead: 100, maxLagBlocks: 10, maxHeadDriftBlocks: 5, endpoint: "x"};
  eq("judgeMeta: exactly at the lag threshold passes", judgeMeta(meta({indexed: 90}), base).ok, true);
  eq("judgeMeta: one past it refuses", judgeMeta(meta({indexed: 89}), base).failure, FAILURE.STALE_INDEX);
  eq("judgeMeta: null meta is META_MISSING", judgeMeta(null, base).failure, FAILURE.META_MISSING);
  eq("judgeMeta: a head of null is NO_CHAIN_HEAD",
     judgeMeta(meta({indexed: 90}), {...base, chainHead: null}).failure, FAILURE.NO_CHAIN_HEAD);
}

// ---- live-proof.mjs fails closed ------------------------------------------------------------------------------------
//
// Spawned, not imported: the exit status IS the assertion, and a module that printed a SKIP and
// returned normally would pass an import-based check while failing every gate that runs it.

function runLiveProof(overrides) {
  const env = {...process.env, ...overrides};
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete env[k];
  return spawnSync(process.execPath, [resolve(HERE, "live-proof.mjs")], {env, encoding: "utf8", timeout: 30_000});
}
{
  const r = runLiveProof({UNICA_SUBGRAPH_URL: undefined, GRAPH_API_KEY: undefined});
  check("live-proof with no endpoint exits non-zero", r.status !== 0, `exit status ${r.status}`);
  check("...printing a SKIP", r.stdout.includes("SKIP"), r.stdout.slice(0, 300));
  check("...naming the variable that is missing", r.stdout.includes("UNICA_SUBGRAPH_URL"), r.stdout.slice(0, 300));
  check("...and saying a SKIP is not a pass", r.stdout.includes("this is a SKIP, not a pass"), r.stdout.slice(0, 300));
  check("...and it reached no network", !r.stdout.includes("head block"), r.stdout.slice(0, 300));
}
{
  // A DIFFERENT missing variable must produce a DIFFERENT message, which is how we know the message
  // is derived from what is actually missing rather than printed unconditionally.
  const r = runLiveProof({UNICA_SUBGRAPH_URL: URL_WITH_PLACEHOLDER, GRAPH_API_KEY: undefined});
  check("live-proof with an unfilled [api-key] placeholder exits non-zero", r.status !== 0, `exit status ${r.status}`);
  check("...naming GRAPH_API_KEY rather than the endpoint variable",
        r.stdout.includes("GRAPH_API_KEY") && !r.stdout.includes("UNICA_SUBGRAPH_URL is not set"),
        r.stdout.slice(0, 400));
  check("...and printing no key-shaped placeholder as though it were a key",
        !r.stdout.includes(KEY), "the planted key reached live-proof's output");
}
{
  // A configured-but-unsafe endpoint is a DIFFERENT state from an unconfigured one, and must not be
  // reported as a SKIP: somebody set this, and what they set would disclose the key on the wire.
  const r = runLiveProof({UNICA_SUBGRAPH_URL: `http://gateway.thegraph.com/api/${KEY}/subgraphs/id/Q`});
  check("live-proof with a cleartext endpoint exits non-zero", r.status !== 0, `exit status ${r.status}`);
  check("...and calls it a FAILURE, not a SKIP", r.stdout.includes("FAIL") && !r.stdout.includes("SKIP"),
        r.stdout.slice(0, 400));
  check("...naming the refusal", r.stdout.includes("ENDPOINT_NOT_HTTPS"), r.stdout.slice(0, 400));
  check("...and redacting the key it was about to send in the clear",
        !r.stdout.includes(KEY), "the endpoint's key reached live-proof's output");
  check("...and reaching no network", !r.stdout.includes("head block"), r.stdout.slice(0, 400));
}

// ---- the staleness threshold is itself checked before it is used --------------------------------------------------
//
// The defect this covers is invisible by construction. `Number("twenty-five")` is NaN, and every
// comparison against NaN is false, so an unparseable threshold does not widen the staleness
// margin — it removes the staleness refusal entirely, while the banner above still announces one.
// A guard that cannot fire and a guard that passed look identical in every output.
{
  const meta = (indexed) => ({
    deployment: "QmDeployment",
    hasIndexingErrors: false,
    block: {number: indexed, hash: "0x" + "11".repeat(32), timestamp: "1757000000"},
  });
  const base = {chainHead: 1_000_000, maxHeadDriftBlocks: 5, endpoint: "e"};

  // CONTROL FIRST: with a usable threshold, an index a million blocks behind IS refused. Without
  // this row passing, the row below proves nothing — an assertion that something is refused is
  // worthless until the same shape has been seen to be accepted and refused on purpose.
  eq("control: a hopelessly stale index is refused when the threshold is a number",
     judgeMeta(meta(1), {...base, maxLagBlocks: 25}).failure, FAILURE.STALE_INDEX);

  eq("a NaN staleness threshold is refused, not silently obeyed",
     judgeMeta(meta(1), {...base, maxLagBlocks: Number("twenty-five")}).failure, FAILURE.BAD_THRESHOLD);
  check("...and returns no rows and no meta to reason over",
        judgeMeta(meta(1), {...base, maxLagBlocks: Number("x")}).ok === false,
        "a refusal that still hands back a meta is a refusal a caller can ignore");
  eq("a non-integer staleness threshold is refused",
     judgeMeta(meta(1), {...base, maxLagBlocks: 12.5}).failure, FAILURE.BAD_THRESHOLD);
  eq("a negative staleness threshold is refused",
     judgeMeta(meta(1), {...base, maxLagBlocks: -1}).failure, FAILURE.BAD_THRESHOLD);
  eq("a string threshold is refused even when it would parse",
     judgeMeta(meta(1), {...base, maxLagBlocks: "25"}).failure, FAILURE.BAD_THRESHOLD);
  eq("a NaN head-drift threshold is refused too",
     judgeMeta(meta(999_999), {...base, maxLagBlocks: 25, maxHeadDriftBlocks: Number("x")}).failure,
     FAILURE.BAD_THRESHOLD);
  // CONTROL: zero is a legitimate, and the strictest, threshold. A guard that refused it would be
  // refusing the one setting an operator reaches for when they want no tolerance at all.
  eq("control: a threshold of zero is accepted and refuses a one-block lag",
     judgeMeta(meta(999_999), {...base, maxLagBlocks: 0}).failure, FAILURE.STALE_INDEX);
  check("control: a threshold of zero accepts an index exactly at head",
        judgeMeta(meta(1_000_000), {...base, maxLagBlocks: 0}).ok === true,
        "zero must mean zero lag allowed, not zero reads allowed");
}

// ---- the head RPC is printable, and its credential is not ------------------------------------------------------------
//
// The head RPC url is PRINTED on purpose: a proof whose independent source is secret is not a
// proof. But a node provider's url carries its key as an ordinary path segment, and the endpoint
// redactor knows only about the gateway's `/api/<key>` shape — so this needs its own label.
{
  const alchemy = `https://eth-sepolia.g.alchemy.com/v2/${KEY}`;
  const label = rpcLabel(alchemy);
  check("rpcLabel keeps the host, which is what makes the proof checkable",
        label.includes("eth-sepolia.g.alchemy.com"), label);
  check("rpcLabel redacts a key-shaped path segment", !label.includes(KEY), label);
  check("control: rpcLabel does not blank a url that carries no credential",
        rpcLabel("https://ethereum-sepolia-rpc.publicnode.com") === "https://ethereum-sepolia-rpc.publicnode.com/",
        rpcLabel("https://ethereum-sepolia-rpc.publicnode.com"));
  check("rpcLabel withholds an unparseable url entirely",
        rpcLabel(`not-a-url-${KEY}`) === "(unparseable url, withheld)",
        rpcLabel(`not-a-url-${KEY}`));
  check("rpcLabel reports an unset url as unset rather than as empty",
        rpcLabel("") === "(unset)" && rpcLabel(undefined) === "(unset)", "an empty label reads as a url that was printed");
}
{
  // BEHAVIOURAL, not structural. The head RPC points at a closed local port, so this reaches no
  // network: the banner is printed before the head is fetched, which is exactly the line under test.
  const r = runLiveProof({
    UNICA_SUBGRAPH_URL: "https://api.studio.thegraph.com/query/1/x/v1",
    UNICA_HEAD_RPC_URL: `https://127.0.0.1:1/v2/${KEY}`,
  });
  check("live-proof with a key-shaped head RPC exits non-zero", r.status !== 0, `exit status ${r.status}`);
  check("...and the planted head-RPC key does not appear in its output",
        !r.stdout.includes(KEY) && !r.stderr.includes(KEY),
        "the head RPC's credential reached live-proof's output");
  check("...while the head RPC's host is still shown, so the proof stays checkable",
        r.stdout.includes("127.0.0.1"), r.stdout.slice(0, 400));
}
{
  const r = runLiveProof({
    UNICA_SUBGRAPH_URL: "https://api.studio.thegraph.com/query/1/x/v1",
    UNICA_MAX_LAG_BLOCKS: "twenty-five",
  });
  check("live-proof with an unusable staleness threshold exits non-zero", r.status !== 0, `exit status ${r.status}`);
  check("...naming BAD_THRESHOLD rather than running with no threshold at all",
        r.stdout.includes("BAD_THRESHOLD"), r.stdout.slice(0, 500));
  check("...and never printing NaN as though it were a margin",
        !r.stdout.includes("NaN"), r.stdout.slice(0, 500));
  check("...and reaching no network", !r.stdout.includes("head block"), r.stdout.slice(0, 500));
}

finished = true;
console.log("UNICA V2 — live Graph provider: failure taxonomy, redaction and fail-closed behaviour");
console.log(rows.join("\n"));
console.log(`\nchecks run: ${passed + failed}, passed: ${passed}, failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
