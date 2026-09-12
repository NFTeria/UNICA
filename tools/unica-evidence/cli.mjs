#!/usr/bin/env node
// node tools/unica-evidence/cli.mjs --order 0x.. [--manifest path] [--rpc url] [--confirmations n]
//   [--fixture path] [--kind direct|market]
// node tools/unica-evidence/cli.mjs --sale 0x..  (the same flags; a product-catalogue sale id)
//
// Prints the JSON authentication verdict for one order id, market or direct settlement alike, with
// its own `kind: "direct" | "market"` field naming which chain this order id was actually found on.
// `--sale` asks the third question instead: was this ONE SALE from the shop's own list made by the
// catalogue this deployment names. A sale id is not an order id and the two are never mixed, so it
// is a separate flag rather than another thing `--order` might turn out to mean.
// Never reaches a non-localhost RPC by default: with no --rpc flag this reads UNICA_LOCAL_RPC
// (default http://127.0.0.1:8545), and with --fixture it makes no network call at all.
//
// KIND DETECTION. An order id commits to the contract that minted it (both the market executor's
// and the direct settler's `createOrder` fold `address(this)` into the id), so the two kinds' ids
// never collide in practice — but this CLI still detects the kind from the EVIDENCE actually found
// (which OrderCreated/receipt shape names this order id), not from a guess, and `--kind` overrides
// detection outright for a caller that already knows which settlement this order id belongs to.

import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {identifyLog, decodeLog} from "./codec.mjs";
import {
  authenticateDirectReceipt,
  authenticateProductSale,
  authenticateReceipt,
  defaultLocalRpcUrl,
  fetchDirectOrder,
  projectEvidence,
} from "./index.mjs";

const lc = (s) => (typeof s === "string" ? s.toLowerCase() : s);
const sameHex = (a, b) => Boolean(a) && Boolean(b) && lc(a) === lc(b);

/// Which settlement kind an orderId's own evidence names, from already-fetched/decoded logs.
/// A DirectReceipt or a direct-shaped OrderCreated for this id means "direct"; a SettlementReceipt
/// or a market-shaped OrderCreated for this id means "market". Neither present returns null — the
/// caller decides the default rather than this function guessing one.
function detectKind(orderId, logs) {
  let sawDirect = false;
  let sawMarket = false;
  for (const raw of logs) {
    const name = identifyLog(raw);
    if (!name) continue;
    let log;
    try {
      log = decodeLog(name, raw);
    } catch {
      continue;
    }
    if (!sameHex(log.orderId, orderId)) continue;
    if (name === "DirectReceipt" || name === "DirectOrderCreated") sawDirect = true;
    if (name === "SettlementReceipt" || name === "OrderCreated") sawMarket = true;
  }
  if (sawDirect && !sawMarket) return "direct";
  if (sawMarket && !sawDirect) return "market";
  return null;
}

function parseArgs(argv) {
  const out = {confirmations: 0};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--order") out.order = argv[++i];
    else if (a === "--sale") out.sale = argv[++i];
    else if (a === "--manifest") out.manifest = argv[++i];
    else if (a === "--rpc") out.rpc = argv[++i];
    else if (a === "--confirmations") out.confirmations = Number(argv[++i]);
    else if (a === "--fixture") out.fixture = argv[++i];
    else if (a === "--from-block") out.fromBlock = argv[++i];
    else if (a === "--to-block") out.toBlock = argv[++i];
    else if (a === "--index-head") out.indexHead = argv[++i];
    else if (a === "--kind") out.kind = argv[++i];
    else throw new Error(`unrecognised argument: ${a}`);
  }
  if (out.order && out.sale) throw new Error("--order and --sale name different things; pass one");
  if (!out.order && !out.sale) throw new Error("--order 0x.. or --sale 0x.. is required");
  if (out.sale && out.kind !== undefined) throw new Error("--kind belongs to --order; a --sale is always a product sale");
  if (out.kind !== undefined && out.kind !== "direct" && out.kind !== "market") {
    throw new Error(`--kind must be "direct" or "market", got ${JSON.stringify(out.kind)}`);
  }
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
  let directOrder = null;
  let rpcUrl;
  if (args.fixture) {
    const fixture = JSON.parse(readFileSync(resolve(args.fixture), "utf8"));
    logs = fixture.logs ?? [];
    chainHead = fixture.chainHead;
    // A fixture may carry its own already-decoded `orders(orderId)` answer for a direct
    // settlement, since `authenticateDirectReceipt` never issues that eth_call itself.
    directOrder = fixture.directOrder ?? null;
  } else {
    rpcUrl = args.rpc ?? defaultLocalRpcUrl();
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
        kind: args.kind ?? null,
        reasonCodes: ["EVIDENCE_ENDPOINT_UNAVAILABLE"],
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

  if (args.sale) {
    const saleVerdict = authenticateProductSale({
      saleId: args.sale,
      logs,
      manifest,
      chainHead,
      requiredConfirmations: args.confirmations,
      indexHead: args.indexHead,
    });
    process.stdout.write(JSON.stringify(saleVerdict, null, 2) + "\n");
    process.exitCode = saleVerdict.decision === "VERIFIED" ? 0 : saleVerdict.decision === "REFUSED" ? 1 : 2;
    return;
  }

  const kind = args.kind ?? detectKind(args.order, logs) ?? "market";

  if (kind === "direct" && directOrder === null && rpcUrl) {
    const settler = manifest?.contracts?.directSettlement?.address;
    if (settler) {
      try {
        directOrder = await fetchDirectOrder({rpc: rpcUrl, settler, orderId: args.order});
      } catch {
        // Left null: authenticateDirectReceipt reads a missing order as UNKNOWN, never as a match.
        directOrder = null;
      }
    }
  }

  const verdict =
    kind === "direct"
      ? authenticateDirectReceipt({
          orderId: args.order,
          logs,
          manifest,
          chainHead,
          requiredConfirmations: args.confirmations,
          indexHead: args.indexHead,
          directOrder,
        })
      : authenticateReceipt({
          orderId: args.order,
          logs,
          manifest,
          chainHead,
          requiredConfirmations: args.confirmations,
          indexHead: args.indexHead,
        });
  verdict.kind = kind;

  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  process.exitCode = verdict.decision === "VERIFIED" ? 0 : verdict.decision === "REFUSED" ? 1 : 2;
}

main().catch((e) => {
  process.stderr.write(`unica-evidence: ${e.message}\n`);
  process.exitCode = 2;
});
