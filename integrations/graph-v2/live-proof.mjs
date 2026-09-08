// The live proof. Queries the real subgraph, prints what it actually saw, and refuses everything
// it cannot establish.
//
//   UNICA_SUBGRAPH_URL=... GRAPH_API_KEY=... node integrations/graph-v2/live-proof.mjs
//
// WHAT IT IS FOR. Everything else in this directory can pass offline. This command cannot: with no
// endpoint configured it prints a SKIP naming the variable that is missing and EXITS NON-ZERO, so
// an unconfigured run can never be mistaken for a successful one. That behaviour is itself a row in
// `provider-test.mjs` — a fail-closed path nobody tests is a fail-closed path nobody has seen work.
//
// WHAT IT DELIBERATELY DOES NOT DO. It prints no credential. `UNICA_SUBGRAPH_URL` may carry the API
// key in its path, so the endpoint is only ever shown through the provider's redaction. It signs
// nothing, sends nothing, and the only chain access is `eth_chainId` and `eth_blockNumber` against
// a public node, which is how the staleness margin is measured against something other than the
// gateway's own opinion of its progress.
//
// The head RPC is PRINTED, and defaults to a public endpoint for exactly that reason: a proof whose
// inputs are secret is not a proof.

import {
  DEFAULTS,
  FAILURE,
  LIVE_SOURCE,
  NETWORK_CHAIN_ID,
  fetchChainHead,
  fetchSettlements,
  renderFailure,
  resolveEndpoint,
  rpcLabel,
} from "./provider.mjs";
import {analyse, renderReport} from "./copilot.mjs";

const env = process.env;

/// The network the manifest names. Read from subgraph.yaml would be better still, but this command
/// must run from a fresh clone with no parsing surprises; `check.mjs` asserts the two agree.
const NETWORK = env.UNICA_SUBGRAPH_NETWORK ?? "sepolia";
const DEFAULT_HEAD_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

let passed = 0;
let failed = 0;
let skipped = 0;
const rows = [];

function pass(name, detail) {
  passed++;
  rows.push(`  PASS  ${name}`);
  for (const d of [].concat(detail ?? [])) rows.push(`        ${d}`);
}
function fail(name, detail) {
  failed++;
  rows.push(`  FAIL  ${name}`);
  for (const d of [].concat(detail ?? [])) rows.push(`        ${d}`);
}
function skip(name, why) {
  skipped++;
  rows.push(`  SKIP  ${name}`);
  rows.push(`        ${why} (this is a SKIP, not a pass)`);
}

function report(exitCode) {
  console.log(rows.join("\n"));
  console.log(`\nchecks run: ${passed + failed}, passed: ${passed}, failed: ${failed}, skipped: ${skipped}`);
  process.exit(exitCode);
}

console.log("UNICA V2 — live subgraph proof");
console.log(`network      ${NETWORK} (chain ${NETWORK_CHAIN_ID[NETWORK] ?? "unknown"})`);

// ---- the endpoint, before anything is attempted ------------------------------------------------
//
// Resolved first and on its own, so a missing variable is a SKIP that names the variable rather
// than a connection error thirty seconds later.

const endpoint = resolveEndpoint(env);
if (!endpoint.ok) {
  console.log(`endpoint     ${endpoint.label ?? "(unset)"}`);
  console.log("");
  // NOT CONFIGURED and CONFIGURED WRONGLY are two different states and are reported as two
  // different things. A missing variable is a SKIP: nobody has tried yet. An endpoint that IS set
  // and is unsafe — cleartext, where the key would be disclosed on the wire — is a FAILURE, because
  // somebody made a choice and it was the wrong one. Both exit non-zero; only one of them is
  // somebody's fault, and a reader deserves to know which.
  if (endpoint.variable) {
    skip("live subgraph proof", `${endpoint.reason}. Set ${endpoint.variable} and run again`);
    rows.push("        a SKIP is not a pass, so this command exits non-zero: an unconfigured run and");
    rows.push("        a successful one must never produce the same exit status.");
  } else {
    fail(`the endpoint was refused (${endpoint.failure})`, [endpoint.reason]);
  }
  rows.push("        See integrations/graph-v2/STUDIO-OWNER-ACTION.md for how to get an endpoint.");
  report(1);
}

console.log(`endpoint     ${endpoint.label}`);
const headRpc = env.UNICA_HEAD_RPC_URL ?? DEFAULT_HEAD_RPC;
// Through the label, never raw. The default is a public node with no credential in it, but the
// variable exists so an operator can point this at their own node — and a node provider's url
// carries its key as an ordinary path segment (`/v2/<key>`, `/v3/<key>`). Printing it raw would
// disclose that key to stdout, to a CI log, and to whatever the operator pastes the run into.
console.log(`head rpc     ${rpcLabel(headRpc)}`);
const recipient = env.UNICA_MERCHANT ?? null;
console.log(`merchant     ${recipient ?? "(no filter — every indexed settlement)"}`);
// Parsed strictly, and refused rather than defaulted. `Number("twenty-five")` is NaN, and every
// comparison against NaN is false — so a typo here would not widen the staleness margin, it would
// remove the staleness check entirely while the banner below still announced one. That is a green
// run that proves nothing, which is the one outcome this command exists to make impossible.
let maxLagBlocks = DEFAULTS.maxLagBlocks;
let badThreshold = null;
if (env.UNICA_MAX_LAG_BLOCKS !== undefined && String(env.UNICA_MAX_LAG_BLOCKS).trim() !== "") {
  const raw = String(env.UNICA_MAX_LAG_BLOCKS).trim();
  if (/^(0|[1-9][0-9]*)$/.test(raw)) {
    maxLagBlocks = Number(raw);
  } else {
    badThreshold = raw;
  }
}
console.log(`staleness    refuse at more than ${badThreshold === null ? maxLagBlocks : "(unusable)"} blocks behind head`);
console.log("");

if (badThreshold !== null) {
  fail(`the staleness threshold was refused (${FAILURE.BAD_THRESHOLD})`, [
    `UNICA_MAX_LAG_BLOCKS is "${badThreshold}", which is not a whole number of blocks`,
    "a threshold that cannot be compared against removes the staleness check rather than",
    "widening it, so this run is refused before anything is read.",
  ]);
  report(1);
}

// ---- the chain head, from somewhere other than the gateway ---------------------------------------

const head = await fetchChainHead({
  rpcUrl: headRpc,
  expectedChainId: NETWORK_CHAIN_ID[NETWORK] ?? null,
});
if (!head.ok) {
  fail(`the chain head could not be established (${head.failure})`, renderFailure(head, endpoint.secrets).split("\n"));
  rows.push("        without a head there is no staleness margin, and without a staleness margin");
  rows.push("        an answer from a stalled index is indistinguishable from a current one.");
  report(1);
}
pass(`the head RPC is chain ${head.chainId}, as the manifest's network requires`, [
  `head block ${head.blockNumber}`,
]);

// ---- the read -------------------------------------------------------------------------------------

const read = await fetchSettlements({
  env,
  chainHead: head.blockNumber,
  recipient,
  maxLagBlocks,
});

if (!read.ok) {
  fail(`the live read was refused (${read.failure})`, renderFailure(read, endpoint.secrets).split("\n"));
  if (read.failure === FAILURE.STALE_INDEX) {
    rows.push("        the subgraph is deployed but behind. Wait for it to catch up, or raise");
    rows.push("        UNICA_MAX_LAG_BLOCKS deliberately and say so when quoting the result.");
  }
  report(1);
}

pass("the live read succeeded and every row carried every field", [
  `deployment ${read.meta.deployment ?? "(not reported)"}`,
  `indexed block ${read.meta.indexedBlock}, head ${read.meta.chainHead}, lag ${read.meta.lagBlocks} of ${read.meta.maxLagBlocks} allowed`,
  `rows ${read.settlements.length} over ${read.pages} page(s)`,
]);
pass("the index is inside the staleness threshold", [
  `${read.meta.lagBlocks} blocks behind head at the moment of the read`,
]);
pass("every record is stamped with its source", [
  `source ${LIVE_SOURCE} on all ${read.settlements.length} record(s)`,
]);

// ---- the copilot's verdict over exactly those rows -------------------------------------------------
//
// Analysed AS OF the block the index reached, not as of the wall clock. The copilot reads no clock,
// so the moment has to come from the data — and the indexed block's own timestamp is the only
// moment for which this row set is the complete answer.

const asOf = read.meta.indexedTimestamp;
if (asOf === null || asOf === undefined) {
  skip(
    "the treasury copilot's verdict",
    "`_meta.block.timestamp` was not returned by this endpoint, so there is no moment to analyse as of",
  );
  // The copilot verdict is this command's headline deliverable. A run that could not produce it
  // has not proved what the command claims to prove, so it exits non-zero even though nothing
  // FAILED — the file's own header says an unconfigured run and a successful one must never share
  // an exit status, and a verdict-less run is closer to the first. Found by the review, 2026-09-08.
  report(1);
}

const verdict = analyse({
  settlements: read.settlements,
  source: LIVE_SOURCE,
  asOfTimestamp: String(asOf),
});
pass(`the copilot produced a verdict over the live rows: ${verdict.verdict}`, [
  `${verdict.findings.length} finding(s), each carrying its rule, its figures and the ids they came from`,
]);

console.log(rows.join("\n"));
console.log("");
console.log(renderReport(verdict));
console.log("");
console.log(`checks run: ${passed + failed}, passed: ${passed}, failed: ${failed}, skipped: ${skipped}`);
process.exit(failed === 0 ? 0 : 1);
