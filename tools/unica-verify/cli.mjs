// unica-verify — does this receipt record a settlement of THIS quote?
//
//   node tools/unica-verify/cli.mjs --input <evidence.json>
//   node tools/unica-verify/cli.mjs --input <evidence.json> --json
//   node tools/unica-verify/cli.mjs --input <evidence.json> --rpc-env SEPOLIA_RPC_URL --check-consumed
//
// READ-ONLY, ALWAYS. There is no key, no signing, no broadcast and no write path in this tool or in
// anything it imports. Online mode reaches a chain through a client that refuses any JSON-RPC
// method which is not a query.
//
// IT NEVER PRINTS AN ENDPOINT OR A SIGNATURE. An RPC URL routinely carries a key in its path or
// query string, so a URL is redacted to scheme, host and port everywhere it appears, errors
// included. The merchant signature is not printed either: it is not a secret, but showing it
// invites a reader to compare signatures instead of digests, which is the exact mistake this tool
// exists to prevent.

import {readFileSync} from "node:fs";
import {verifyOffline, verifyOnline, LIMITATIONS} from "./verify.mjs";
import {ReadOnlyRpc, scrub} from "./rpc.mjs";

const USAGE = `unica-verify — read-only verification of a UNICA V2 settlement receipt

  --input <file>        evidence JSON: the quote, the merchant signature, the receipt, and what
                        the caller expects (chain, executor, hook). Required.
  --json                machine-readable output with stable field names
  --quiet               suppress the streamed rows; print only the verdict
  --rpc <url>           online mode against this endpoint (read-only queries only)
  --rpc-env <VAR>       online mode, taking the endpoint from an environment variable — preferred,
                        because an endpoint on a command line ends up in a shell history
  --tx <hash>           the transaction to fetch in online mode, if the evidence has no receipt
  --check-consumed      additionally ask the hook whether it has consumed this quote
  --pins <file>         JSON of {label: {address, codeHash}} to compare deployed code against

Exit status is 0 only when every mandatory check passed.`;

const argv = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) flags.set(key, true);
  else {
    flags.set(key, next);
    i++;
  }
}

if (flags.has("help") || !flags.has("input")) {
  console.log(USAGE);
  process.exit(flags.has("help") ? 0 : 2);
}

const asJson = flags.has("json");
const quiet = flags.has("quiet") || asJson;

const evidence = JSON.parse(readFileSync(flags.get("input"), "utf8"));

// The endpoint is read from the environment by preference, and NEVER echoed. `--rpc` stays
// available because a local node's URL is not a secret, but it is the second-best door.
let rpcUrl = null;
if (flags.has("rpc-env")) {
  const name = flags.get("rpc-env");
  rpcUrl = process.env[name];
  if (!rpcUrl) {
    console.error(`the environment variable ${name} is not set`);
    process.exit(2);
  }
} else if (flags.has("rpc")) {
  rpcUrl = flags.get("rpc");
}

const input = {
  quote: evidence.quote,
  merchantSignature: evidence.merchantSignature,
  merchantConfiguration: evidence.merchantConfiguration ?? null,
  receipt: evidence.receipt ?? null,
  block: evidence.block ?? null,
  chainId: evidence.chainId,
  expected: {
    chainId: evidence.chainId ?? evidence.expected?.chainId,
    executor: evidence.expected?.executor,
    hook: evidence.expected?.hook,
    poolManager: evidence.expected?.poolManager,
    permit2: evidence.expected?.permit2,
  },
  transactionHash: flags.get("tx") ?? evidence.receipt?.transactionHash ?? null,
  checkConsumed: flags.has("check-consumed"),
  pins: flags.has("pins") ? JSON.parse(readFileSync(flags.get("pins"), "utf8")) : null,
  onRow: quiet ? null : (row) => {
    const mark = row.ok ? "PASS" : row.mandatory ? "FAIL" : "note";
    console.log(`  ${mark}  ${row.name}${row.detail ? `\n        ${row.detail}` : ""}`);
  },
};

// Online mode fetches the receipt itself unless one was supplied. `--tx` with a fixture that
// already carries a receipt still re-fetches nothing: the caller's receipt is what they asked
// about, and silently replacing it would verify a different transaction than the one they named.
if (!rpcUrl && input.checkConsumed) {
  console.error("--check-consumed needs an endpoint: pass --rpc-env <VAR> or --rpc <url>");
  process.exit(2);
}

let result;
try {
  if (rpcUrl) {
    if (!quiet) console.log("unica-verify — online, read-only\n");
    result = await verifyOnline(input, new ReadOnlyRpc(rpcUrl));
  } else {
    if (!quiet) console.log("unica-verify — offline, from the supplied receipt\n");
    result = verifyOffline(input);
  }
} catch (e) {
  // Nothing should reach here — every check wraps its own subject — but if something does, it is
  // reported as a failure with its reason and a non-zero exit, never as a silent pass.
  console.error(`unica-verify could not complete: ${scrub(e.message, rpcUrl)}`);
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify(result, jsonSafe, 2));
} else {
  report(result);
}
process.exit(result.verified ? 0 : 1);

/// BigInt is not JSON, and a verifier that silently formatted one into a Number would be lying
/// about amounts above 2^53 — which is most token amounts with eighteen decimals.
function jsonSafe(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function report(r) {
  const receipt = r.receipt ?? {};
  const passed = r.checks.filter((c) => c.ok).length;
  console.log("");
  console.log(r.verified ? "VERIFIED" : "NOT VERIFIED");
  console.log(`  ${passed} of ${r.checks.length} checks passed, ${r.errors.length} mandatory failures, ` +
    `${r.warnings.length} notes`);
  console.log("");
  line("chain", r.dependencies.chainId);
  line("transaction", receipt.transactionHash);
  // Decimal. A block number in hex is a block number a person has to convert before they can
  // compare it with an explorer, and every one of them will convert it wrong once.
  line("block", receipt.blockNumber === null || receipt.blockNumber === undefined
    ? null
    : Number(BigInt(receipt.blockNumber)));
  line("executor", r.dependencies.executor);
  line("hook", r.dependencies.hook);
  line("quote id", receipt.quoteId ?? r.quote.quoteId);
  line("quote digest", r.quote.recomputedDigest);
  line("merchant signer", receipt.merchantSigner);
  line("payer", receipt.payer);
  line("recipient", receipt.recipient);
  line("input token", receipt.tokenIn);
  line("input ceiling", receipt.maxIn);
  line("input actually spent", receipt.actualIn);
  line("output token", receipt.tokenOut);
  line("invoice amount", receipt.amountOut);
  line("delivered exactly", receipt.deliveredOut);
  line("pool id", r.quote.recomputedPoolId);
  line("merchant config hash", r.merchantConfiguration.quoteCommitment);
  line("config preimage", r.merchantConfiguration.supplied ? r.merchantConfiguration.name : "not supplied");
  line("matching receipts", receipt.matchingReceiptCount);
  if (r.evidence.confirmations !== undefined) line("confirmations", r.evidence.confirmations);
  console.log("");
  if (r.errors.length) {
    console.log("FAILURES");
    for (const e of r.errors) console.log(`  - ${e}`);
    console.log("");
  }
  if (r.warnings.length) {
    console.log("NOTES");
    for (const w of r.warnings) console.log(`  - ${w}`);
    console.log("");
  }
  console.log("WHAT THIS DOES NOT SAY");
  for (const l of LIMITATIONS) console.log(`  - ${l}`);
}

function line(label, value) {
  if (value === undefined || value === null) return;
  console.log(`  ${label.padEnd(22)} ${value}`);
}
