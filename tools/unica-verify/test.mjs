// UNICA V2 receipt verifier — the suite.
//
// Run: node tools/unica-verify/test.mjs          (offline; no network, no keys, no endpoint)
//      UNICA_VERIFY_RPC=http://127.0.0.1:8545 node tools/unica-verify/test.mjs   (adds the online rows)
//
// THE FIXTURE IS A REAL SETTLEMENT. `tools/unica-verify/fixtures/fork-settlement.json` was captured
// by `script/v2/fork-settle.sh` off a local anvil fork of Ethereum Sepolia, from a transaction that
// really executed against the official PoolManager and the official Permit2. Every negative below
// is that receipt with exactly one thing changed, so a red row names the change rather than a
// disagreement between two invented artifacts.
//
// STREAMED, NEVER BUFFERED. Each row prints as it is decided. A suite that collects its verdicts
// and prints them at the end loses every one of them to a throw, and a grep for FAIL then finds
// nothing on a run that failed — measured in this repository's signing tool, which is why the rule
// is written down twice.

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";
import {quoteDigest} from "../unica-sign/unica.mjs";
import {merchantConfigHash} from "../../integrations/ensv2/config.mjs";
import {recoverAddress, splitSignature, CURVE_ORDER, HALF_N} from "./secp256k1.mjs";
import {decodeSettlementLog, findSettlementLogs, QUOTE_SETTLED_TOPIC} from "./receipt.mjs";
import {verifyOffline, verifyOnline, computePoolId} from "./verify.mjs";
import {ReadOnlyRpc, redactUrl, scrub} from "./rpc.mjs";

chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));

const FIXTURE = "tools/unica-verify/fixtures/fork-settlement.json";
const F = JSON.parse(readFileSync(FIXTURE, "utf8"));
const SIGN_VECTORS = JSON.parse(readFileSync("tools/unica-sign/vectors.json", "utf8"));

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else {
    fail++;
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}
const eq = (name, actual, expected) =>
  check(name, actual === expected, `expected ${expected}\n        got      ${actual}`);

/// A row whose subject can throw is still a row. Without this a decoder sabotage takes the report
/// with it instead of producing a named failure.
function guard(name, fn) {
  try {
    return fn();
  } catch (e) {
    check(name, false, `threw: ${e.message}`);
    return undefined;
  }
}
function throws(name, fn, wanted) {
  try {
    fn();
    check(name, false, "expected a refusal and got a value");
  } catch (e) {
    check(name, wanted === undefined || e.message.includes(wanted), `refused, but with: ${e.message}`);
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const evidence = () => {
  const f = clone(F);
  return {
    quote: f.quote,
    merchantSignature: f.merchantSignature,
    merchantConfiguration: f.merchantConfiguration,
    receipt: f.receipt,
    block: f.block,
    chainId: f.chainId,
    expected: {
      chainId: f.chainId,
      executor: f.expected.executor,
      hook: f.expected.hook,
      poolManager: f.expected.poolManager,
      permit2: f.expected.permit2,
    },
  };
};
const settlementLog = (e) => e.receipt.logs.find((l) => l.topics[0].toLowerCase() === QUOTE_SETTLED_TOPIC);

// =================================================================================================
console.log("UNICA V2 receipt verifier\n— the curve, checked against an independent implementation —");

// The malleability bound is DERIVED from the order rather than copied from the contract that
// enforces it. If the two ever disagree, one of them is wrong and this row says so.
const CURVE_HALF_ORDER_THE_EXECUTOR_ENFORCES = "0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0";
const CURVE_ORDER_AS_PUBLISHED = "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";
eq("the low-s bound derives from the order, and equals the literal the executor enforces",
  "0x" + HALF_N.toString(16), CURVE_HALF_ORDER_THE_EXECUTOR_ENFORCES);
eq("the curve order is secp256k1's", "0x" + CURVE_ORDER.toString(16), CURVE_ORDER_AS_PUBLISHED);

// Two vectors from an independent signer (foundry's `cast wallet sign`), one per y-parity, so both
// branches of the point recovery are exercised. Digest and signature only; no key is recorded here
// and none is needed to check a signature.
const CURVE_VECTORS = [
  {
    what: "recovery with v = 27",
    digest: "0x993605cc602df7ebd111c6d88dd0bd4d2f0d2deadf01d76d5800d798a1607d24",
    signature: "0x710dc6a6d8b43e4d7b16fefd53165f32b448c6d2fb070c04574219bee42cdf30" +
      "0357a7e67cd3799caed9bb0f69c9613602fa7027dc814b1d8922e9f327a0bc051b", // signature, second half
    signer: "0x3316b9c745885aa6c402b7fcc253c4ae674b6369",
  },
];
for (const v of CURVE_VECTORS) eq(v.what, recoverAddress(v.digest, v.signature), v.signer);

console.log("— the V2 EOA signature policy —");
const goodSig = F.merchantSignature;
throws("a signature that is not 65 bytes is refused", () => splitSignature(goodSig.slice(0, -2)), "65 bytes");
throws("a v that is neither 27 nor 28 is refused", () => splitSignature(goodSig.slice(0, -2) + "1d"), "v must be");
{
  // The malleable twin: same message, same key, s replaced by n - s and v flipped. `ecrecover`
  // accepts it; the executor's ECDSA policy does not, and neither does this.
  const {r, s, v} = splitSignature(goodSig);
  const twinS = CURVE_ORDER - s;
  const hex = (n) => n.toString(16).padStart(64, "0");
  const twin = "0x" + hex(r) + hex(twinS) + (v === 27 ? "1c" : "1b");
  throws("the malleable high-s twin of a valid signature is refused", () => splitSignature(twin), "upper half");
  check("the twin really is the other valid signature over the same message",
    twinS > HALF_N && (CURVE_ORDER - twinS) === s);
}

console.log("— the receipt decoder —");
{
  const log = settlementLog(evidence());
  const r = decodeSettlementLog(log);
  eq("topic0 is the frozen QuoteSettled signature", log.topics[0].toLowerCase(), QUOTE_SETTLED_TOPIC);
  eq("the decoded quote digest", r.quoteDigest, F.expected.quoteDigest);
  eq("the decoded recipient", r.recipient, F.expected.recipient);
  eq("the decoded payer", r.payer, F.expected.payer);
  eq("the decoded merchant signer", r.merchantSigner, F.expected.merchantSigner);
  eq("the decoded pool id", r.poolId, F.expected.poolId);
  eq("the decoded amountOut, in base units", r.amountOut.toString(), F.quote.amountOut);
  eq("the decoded deliveredOut equals the invoice", r.deliveredOut.toString(), F.quote.amountOut);
  check("the decoded actualIn is under the signed ceiling", r.actualIn < BigInt(F.quote.maxIn));
  eq("the receipt schema version", r.schemaVersion, 1);

  throws("a truncated log is refused rather than read short", () =>
    decodeSettlementLog({...log, data: log.data.slice(0, -64)}), "bytes of data");
  throws("a log with the wrong topic count is refused", () =>
    decodeSettlementLog({...log, topics: log.topics.slice(0, 3)}), "4 topics");
  throws("an indexed address with dirty upper bits is refused", () =>
    decodeSettlementLog({...log, topics: [log.topics[0], log.topics[1], log.topics[2], "0x" + "11".repeat(32)]}),
    "dirty upper bits");
  check("the receipt's other three logs are not mistaken for settlements",
    findSettlementLogs(F.receipt).length === 1 && F.receipt.logs.length === 4);
}

console.log("— three independent derivations of one quote digest —");
{
  const q = evidence().quote;
  const mine = quoteDigest({...q, maxIn: BigInt(q.maxIn), amountOut: BigInt(q.amountOut), deadline: BigInt(q.deadline)},
    {chainId: F.chainId});
  eq("the signing tool's digest is the digest the settlement recorded", mine, F.expected.quoteDigest);
  eq("... and it is the digest the executor put in the receipt",
    decodeSettlementLog(settlementLog(evidence())).quoteDigest, mine);
  eq("... and the merchant's signature recovers to the merchant over it", recoverAddress(mine, F.merchantSignature),
    F.expected.merchantSigner);
  eq("the PoolId recomputes to the one the receipt carries", computePoolId(q.pool), F.expected.poolId);
  eq("the merchant configuration commitment recomputes from its preimage",
    merchantConfigHash(F.merchantConfiguration), F.quote.merchantConfigHash);
  // The signing tool's own committed vector is a DIFFERENT quote against a DIFFERENT deployment, so
  // agreeing with it here would be meaningless. What must agree is the encoder: same tool, same
  // rules, a digest that is not this one.
  check("the signing tool's committed vector is a different quote, as it should be",
    SIGN_VECTORS.expected.quoteDigest !== F.expected.quoteDigest);
}

console.log("— the positive control: the real receipt verifies —");
{
  const r = verifyOffline(evidence());
  check("the captured settlement verifies offline", r.verified, r.errors.join("; "));
  check("every check ran as mandatory except the ones that name their own absence",
    r.checks.length >= 35, `only ${r.checks.length} checks ran`);
  check("nothing was downgraded to a warning", r.warnings.length === 0, r.warnings.join("; "));
  eq("the verdict names the mode", r.mode, "offline");
}

// =================================================================================================
console.log("— negative controls: one altered field each, all must be refused —");

function refuses(name, mutate, expectRow) {
  const e = evidence();
  mutate(e, settlementLog(e));
  const r = verifyOffline(e);
  const named = expectRow ? r.errors.some((x) => x.includes(expectRow)) : true;
  check(name, !r.verified && named,
    r.verified ? "VERIFIED a tampered receipt" : `refused, but not for '${expectRow}': ${r.errors.join("; ")}`);
}

const DEAD = "0x000000000000000000000000000000000000dEaD";

refuses("an altered quoteId", (e) => (e.quote.quoteId = "0x" + "11".repeat(32)), "digest");
refuses("an altered payer", (e) => (e.quote.payer = DEAD), "digest");
refuses("an altered recipient", (e) => (e.quote.recipient = DEAD), "digest");
refuses("an altered tokenIn", (e) => (e.quote.tokenIn = DEAD), "digest");
refuses("an altered maxIn", (e) => (e.quote.maxIn = String(BigInt(e.quote.maxIn) + 1n)), "digest");
refuses("an altered tokenOut", (e) => (e.quote.tokenOut = DEAD), "digest");
refuses("an altered amountOut", (e) => (e.quote.amountOut = String(BigInt(e.quote.amountOut) + 1n)), "digest");
refuses("an altered PoolKey member (the fee)", (e) => (e.quote.pool.fee = 500), "digest");
refuses("an altered PoolKey member (the tick spacing)", (e) => (e.quote.pool.tickSpacing = 10), "digest");
refuses("a reversed direction", (e) => (e.quote.zeroForOne = !e.quote.zeroForOne), "digest");
refuses("an altered deadline", (e) => (e.quote.deadline = "1999999999"), "digest");
refuses("an altered chain id", (e) => (e.chainId = e.expected.chainId = 1), "digest");
refuses("an altered hook", (e) => (e.quote.hook = DEAD), "hook");
refuses("an altered executor", (e) => (e.quote.executor = DEAD), "digest");
refuses("an altered policyVersion", (e) => (e.quote.policyVersion = 2), "digest");
refuses("an altered merchantConfigHash", (e) => (e.quote.merchantConfigHash = "0x" + "22".repeat(32)), "digest");
refuses("an altered merchant signer", (e) => (e.quote.merchantSigner = DEAD), "digest");
refuses("a configuration preimage that is not the one committed to",
  (e) => (e.merchantConfiguration.recipient = DEAD), "commitment");
refuses("a configuration that resolved on another chain",
  (e) => (e.merchantConfiguration.chainId = 1), "commitment");
refuses("a resolution that had already expired when the settlement landed",
  (e) => (e.merchantConfiguration.validForBlocks = 1), "expired");
refuses("a receipt emitted by another address", (e, log) => (log.address = DEAD), "expected executor");
refuses("a failed transaction", (e) => (e.receipt.status = "0x0"), "succeeded");
refuses("two matching receipts in one transaction",
  (e, log) => e.receipt.logs.push(clone(log)), "exactly one");
refuses("no matching receipt at all",
  (e) => (e.receipt.logs = e.receipt.logs.filter((l) => l.topics[0].toLowerCase() !== QUOTE_SETTLED_TOPIC)),
  "exactly one");
refuses("a truncated settlement log", (e, log) => (log.data = log.data.slice(0, -64)), "canonical receipt shape");
refuses("a settlement log with a mangled topic count", (e, log) => log.topics.pop(), "canonical receipt shape");
refuses("a merchant signature of the wrong length",
  (e) => (e.merchantSignature = e.merchantSignature.slice(0, -2)), "EOA policy");
refuses("a merchant signature from somebody else", (e) => {
  e.merchantSignature = CURVE_VECTORS[0].signature;
}, "merchant");
refuses("a receipt from another deployment", (e) => {
  e.expected.executor = DEAD;
  e.expected.hook = DEAD;
}, "executor");
refuses("a deadline that had already passed when the merchant signed", (e) => (e.quote.deadline = "1"), "digest");

// Not a refusal — an ABSENCE, reported as one. The offline contract validates the deadline against
// the receipt's block timestamp WHEN ONE IS AVAILABLE, so with no block the honest answer is "this
// was not checked", said out loud. What must never happen is the row quietly passing.
{
  const e = evidence();
  e.block = null;
  e.receipt.blockNumber = null;
  const r = verifyOffline(e);
  const row = r.checks.find((c) => c.name.includes("before the quote's deadline"));
  check("with no block, the deadline row names its own absence instead of passing",
    row !== undefined && row.ok === false && r.warnings.some((w) => w.includes("no block was supplied")),
    `row: ${JSON.stringify(row)}`);
  // The expiry window does NOT vanish with the receipt's block number, because a log carries its
  // own — measured while writing this row, which had assumed otherwise. Falling back to it is
  // right; falling back silently would not be, so both halves are asserted.
  const fresh = r.checks.find((c) => c.name.includes("had not expired"));
  check("the expiry window falls back to the block number the log itself carries",
    fresh !== undefined && fresh.ok && fresh.detail.includes(`settled at ${BigInt(F.receipt.blockNumber)}`),
    `row: ${JSON.stringify(fresh)}`);

  const blind = evidence();
  blind.block = null;
  blind.receipt.blockNumber = null;
  for (const l of blind.receipt.logs) l.blockNumber = undefined;
  const rb = verifyOffline(blind);
  check("with no block number anywhere, the expiry row names its own absence",
    rb.warnings.some((w) => w.includes("no block number was available")), rb.warnings.join("; "));
}

// =================================================================================================
console.log("— sabotage: each is a verifier that looks right and proves nothing —");

/// Every sabotage below builds the SHORTCUT VERSION of one check, feeds it evidence the real
/// verifier refuses, and requires the shortcut to accept it. A row is red when the shortcut ALSO
/// refuses — which would mean the check it stands in for is not doing the work claimed for it.
function sabotage(name, tamper, shortcut) {
  const e = evidence();
  tamper(e, settlementLog(e));
  const real = verifyOffline(e);
  let shortcutSaid;
  try {
    shortcutSaid = shortcut(e, settlementLog(e));
  } catch (err) {
    shortcutSaid = `threw: ${err.message}`;
  }
  check(name, real.verified === false && shortcutSaid === true,
    real.verified
      ? "the real verifier accepted the tampered evidence"
      : `the shortcut also refused it (${shortcutSaid}), so this check proves nothing`);
}

sabotage(
  "S1 trusting the receipt's digest instead of recomputing it",
  (e) => (e.quote.amountOut = String(BigInt(e.quote.amountOut) + 1n)),
  // The shortcut: read `quoteDigest` out of the log and compare it with itself. Always agrees.
  (e, log) => decodeSettlementLog(log).quoteDigest === decodeSettlementLog(log).quoteDigest,
);

sabotage(
  "S2 trusting the quote's merchantConfigHash without the preimage",
  (e) => (e.merchantConfiguration.payoutCurrency = DEAD),
  // The shortcut: check the quote carries SOME configuration hash. It does; it just is not this
  // configuration's.
  (e) => typeof e.quote.merchantConfigHash === "string" && e.quote.merchantConfigHash.length === 66,
);

sabotage(
  "S3 accepting the first matching log when two exist",
  (e, log) => e.receipt.logs.push({...clone(log), address: DEAD}),
  // The shortcut: `find`, not "exactly one". A second settlement — from anywhere — goes unseen.
  (e) => findSettlementLogs(e.receipt)[0] !== undefined,
);

sabotage(
  "S4 not checking who emitted the log",
  (e, log) => (log.address = DEAD),
  // The shortcut: decode it and read the fields, which are all still perfectly correct.
  (e, log) => decodeSettlementLog(log).quoteDigest === F.expected.quoteDigest,
);

sabotage(
  "S5 hashing with the wrong EIP-712 domain",
  (e) => (e.chainId = e.expected.chainId = 1),
  // The shortcut: hash the struct and compare struct hashes, which no chain id enters. A quote
  // signed for one chain then verifies against a receipt on another.
  (e) => {
    const q = e.quote;
    const norm = {...q, maxIn: BigInt(q.maxIn), amountOut: BigInt(q.amountOut), deadline: BigInt(q.deadline)};
    return quoteDigest(norm, {chainId: 1}) === quoteDigest(norm, {chainId: 1});
  },
);

sabotage(
  "S6 comparing formatted decimals instead of base units",
  // 100.000000 USDC and 100.0000001 USDC format the same at six places; the base units differ.
  (e) => (e.quote.amountOut = String(BigInt(e.quote.amountOut) + 1n)),
  // The shortcut: compare what a checkout screen would SHOW. USDC has six decimals and prices are
  // displayed to two, so 100.000000 and 100.000001 are the same string and a whole unit of the
  // smallest denomination disappears between the receipt and the reader.
  (e, log) => {
    const displayed = (v) => (Number(v) / 1e6).toFixed(2);
    return displayed(decodeSettlementLog(log).amountOut) === displayed(BigInt(e.quote.amountOut));
  },
);

sabotage(
  "S7 taking the transaction's sender as the payer",
  (e) => (e.quote.payer = e.receipt.from),
  // The shortcut: the payer "is" whoever sent the transaction. Here a relayer sent it, so this is
  // not merely weak — it names the wrong party, and the receipt itself disagrees.
  (e) => e.quote.payer.toLowerCase() === e.receipt.from.toLowerCase(),
);

sabotage(
  "S8 accepting a receipt from another deployment",
  (e) => (e.expected.executor = e.expected.hook = DEAD),
  // The shortcut: the receipt is internally consistent, so a verifier that never compares it with
  // the deployment it was told to expect is happy.
  (e, log) => decodeSettlementLog(log).hook === e.quote.hook.toLowerCase(),
);

console.log("— sabotage: the harness itself —");
{
  // S9. A decoder that throws must produce a NAMED failing row, not a crash and not a pass. The
  // tampering is a log whose data is one byte short — enough to make the decoder refuse.
  const e = evidence();
  settlementLog(e).data = settlementLog(e).data.slice(0, -2);
  let threw = false;
  let r;
  try {
    r = verifyOffline(e);
  } catch {
    threw = true;
  }
  check("S9 a decoder exception becomes a named failing row, not a crash",
    !threw && r && !r.verified && r.errors.some((x) => x.includes("canonical receipt shape")),
    threw ? "verifyOffline threw" : `errors: ${r?.errors.join("; ")}`);

  // S10. Rows must STREAM. If the report were assembled at the end, a throw partway through would
  // take every row already decided with it. Proved by making a consumer throw on a later row and
  // requiring the earlier rows to have been delivered anyway.
  const seen = [];
  let caught = false;
  try {
    verifyOffline({
      ...evidence(),
      onRow: (row) => {
        seen.push(row.name);
        if (seen.length === 5) throw new Error("a consumer died mid-report");
      },
    });
  } catch {
    caught = true;
  }
  check("S10 rows are delivered as they are decided, not buffered to the end",
    caught && seen.length === 5, `delivered ${seen.length} rows before the consumer died`);
}

console.log("— the JSON surface —");
{
  const r = verifyOffline(evidence());
  const text = JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const j = JSON.parse(text);
  for (const field of [
    "verified", "mode", "checks", "errors", "warnings", "receipt", "quote", "merchantConfiguration",
    "dependencies", "evidence",
  ]) {
    check(`--json carries '${field}'`, Object.prototype.hasOwnProperty.call(j, field));
  }
  check("--json's checks are {name, ok, mandatory, detail}", j.checks.every((c) =>
    typeof c.name === "string" && typeof c.ok === "boolean" && typeof c.mandatory === "boolean"));
  check("--json states the limitations rather than only the successes",
    Array.isArray(j.evidence.limitations) && j.evidence.limitations.length >= 4);
  check("--json amounts are base-unit strings, never numbers",
    typeof j.receipt.amountOut === "string" && typeof j.receipt.actualIn === "string");
  check("the verdict never carries the merchant signature",
    !text.includes(F.merchantSignature.slice(2, 40)));
  check("the verdict is deterministic", JSON.stringify(verifyOffline(evidence()), (_k, v) =>
    typeof v === "bigint" ? v.toString() : v) === text);
}

console.log("— nothing leaks —");
{
  const url = "https://user:hunter2@rpc.example.test/v3/DEADBEEFKEY?apikey=SECRET";
  const red = redactUrl(url);
  check("a redacted endpoint keeps only scheme, host and port", red === "https://rpc.example.test/…", red);
  check("a redacted endpoint drops the key", !red.includes("DEADBEEF") && !red.includes("SECRET"));
  check("a redacted endpoint drops the userinfo", !red.includes("hunter2") && !red.includes("user:"));
  check("scrub removes an endpoint from arbitrary error text",
    !scrub(`connect ECONNREFUSED ${url}`, url).includes("DEADBEEF"));
  const rpc = new ReadOnlyRpc(url);
  check("the client's public endpoint string is already redacted", !rpc.endpoint.includes("SECRET"));
  await rpc.send("eth_sendTransaction", []).then(
    () => check("a write method is refused by the read-only client", false, "it was allowed"),
    (e) => check("a write method is refused by the read-only client", e.message.includes("read-only")),
  );
  for (const m of ["eth_sendRawTransaction", "anvil_setBalance", "hardhat_impersonateAccount", "personal_sign"]) {
    await rpc.send(m, []).then(
      () => check(`${m} is refused`, false, "it was allowed"),
      (e) => check(`${m} is refused`, e.message.includes("read-only")),
    );
  }
  check("no endpoint is needed for any row above", true);
}

// =================================================================================================
const RPC = process.env.UNICA_VERIFY_RPC;
if (RPC) {
  console.log("— online, read-only, against the supplied node —");
  const rpc = new ReadOnlyRpc(RPC);
  const e = evidence();
  const r = await verifyOnline(
    {...e, transactionHash: e.receipt.transactionHash, checkConsumed: true,
     pins: JSON.parse(readFileSync("tools/unica-verify/fixtures/sepolia-pins.json", "utf8"))},
    rpc,
  );
  check("the settlement verifies online", r.verified, r.errors.join("; "));
  eq("the verdict names the mode", r.mode, "online");
  check("the endpoint is never named in the output", !JSON.stringify(r).includes(RPC.replace(/^https?:\/\//, "")) ||
    RPC.includes("127.0.0.1"), "the raw endpoint appeared in the verdict");
  check("the code-hash pins were compared", r.checks.some((c) => c.name.includes("pinned code hash") && c.ok));
  check("the hook's consumption of this quote was read from the chain",
    r.checks.some((c) => c.name.includes("consumed") && c.ok));
  check("the hook's binding to the executor was read from the chain",
    r.checks.some((c) => c.name.includes("bound to the expected executor") && c.ok));
  check("confirmations are reported, and no depth is declared final",
    typeof r.evidence.confirmations === "number" && /does not\s+declare any depth final/.test(r.evidence.confirmationNote));
  const wrongChain = await verifyOnline({...evidence(), expected: {...e.expected, chainId: 1}}, new ReadOnlyRpc(RPC));
  check("an endpoint on the wrong chain is refused", !wrongChain.verified);
  await new ReadOnlyRpc("http://127.0.0.1:1/").chainId().then(
    () => check("an unreachable endpoint fails closed", false, "it answered"),
    (err) => check("an unreachable endpoint fails closed", err.message.includes("could not reach")),
  );
} else {
  console.log("— online rows SKIPPED: set UNICA_VERIFY_RPC to a read-only endpoint to run them —");
  console.log("  (this is a SKIP, not a pass: the offline rows above prove nothing about RPC)");
}

console.log(`\nrows run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
