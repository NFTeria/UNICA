#!/usr/bin/env node
// node tools/unica-evidence/cli.mjs --order 0x.. [--manifest path] [--rpc url] [--confirmations n] [--fixture path]
//
// Prints the JSON `authenticateReceipt` verdict for one order id. Never reaches a non-localhost RPC
// by default: with no --rpc flag this reads UNICA_LOCAL_RPC (default http://127.0.0.1:8545), and
// with --fixture it makes no network call at all.

import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {authenticateReceipt, defaultLocalRpcUrl, projectEvidence} from "./index.mjs";

function parseArgs(argv) {
  const out = {confirmations: 0};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--order") out.order = argv[++i];
    else if (a === "--manifest") out.manifest = argv[++i];
    else if (a === "--rpc") out.rpc = argv[++i];
    else if (a === "--confirmations") out.confirmations = Number(argv[++i]);
    else if (a === "--fixture") out.fixture = argv[++i];
    else if (a === "--from-block") out.fromBlock = argv[++i];
    else if (a === "--to-block") out.toBlock = argv[++i];
    else if (a === "--index-head") out.indexHead = argv[++i];
    else throw new Error(`unrecognised argument: ${a}`);
  }
  if (!out.order) throw new Error("--order 0x.. is required");
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest ?? "deployments/31337.local.json";
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  } catch (e) {
    throw new Error(`could not read the deployment manifest at ${manifestPath}: ${e.message}`);
  }

  let logs = [];
  let chainHead;
  if (args.fixture) {
    const fixture = JSON.parse(readFileSync(resolve(args.fixture), "utf8"));
    logs = fixture.logs ?? [];
    chainHead = fixture.chainHead;
  } else {
    const rpcUrl = args.rpc ?? defaultLocalRpcUrl();
    let projection;
    try {
      projection = await projectEvidence({
        rpc: rpcUrl,
        manifest,
        fromBlock: args.fromBlock,
        toBlock: args.toBlock,
      });
    } catch (e) {
      // An unreachable or failing evidence source is UNKNOWN, never a crash and never a verdict:
      // the caller must not read "no answer" as "not paid" or as "paid".
      const unknown = {
        decision: "UNKNOWN",
        reasonCodes: ["EVIDENCE_ENDPOINT_UNAVAILABLE"],
        registryAuthenticated: false,
        marketAuthenticated: false,
        hookMatched: false,
        executorMatched: false,
        poolMatched: false,
        receipt: null,
        detail: String(e && e.message ? e.message : e),
      };
      process.stdout.write(JSON.stringify(unknown, null, 2) + "\n");
      process.exitCode = 2;
      return;
    }
    logs = projection.logs;
    chainHead = projection.chainHead;
  }

  const verdict = authenticateReceipt({
    orderId: args.order,
    logs,
    manifest,
    chainHead,
    requiredConfirmations: args.confirmations,
    indexHead: args.indexHead,
  });

  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  process.exitCode = verdict.decision === "VERIFIED" ? 0 : verdict.decision === "REFUSED" ? 1 : 2;
}

main().catch((e) => {
  process.stderr.write(`unica-evidence: ${e.message}\n`);
  process.exitCode = 2;
});
