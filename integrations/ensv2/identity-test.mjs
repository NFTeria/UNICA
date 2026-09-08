// The ENS-to-quote identity chain — the suite.
//
// Run: node integrations/ensv2/identity-test.mjs      (offline; no RPC, no key, no CLI)
//
// THE POLICY BYTES ARE REAL. `fixtures/merchant-policy.json` carries wire bytes encoded by
// `cast abi-encode` and asserted to decode to values captured from `merchant_policy.vy` running in
// Moccasin's EVM. Three implementations agree on that one policy, and the decoder here is checked
// against the bytes rather than against a hand-built object.
//
// Streamed; a throw becomes a named failing row; the verdict is the exit status.

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {namehash, normalizeName, resolveMerchant} from "../../web/ensv2/resolve.mjs";
import {merchantConfigHash} from "./config.mjs";
import {ID_STATUS, MERCHANT_ID_DOMAIN, deriveMerchantId} from "./merchant-id.mjs";
import {POLICY_SELECTOR, POLICY_STATUS, decodePolicyReturn, readPolicy} from "./policy.mjs";
import {
  CHAIN_STATUS, EVIDENCE, QUOTE_STATUS, bindIdentity, buildQuote, policyDigest, resolutionDigest,
} from "./identity.mjs";
import {hashQuote, quoteDigest} from "../../tools/unica-sign/unica.mjs";

chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const F = JSON.parse(readFileSync("integrations/ensv2/fixtures/merchant-policy.json", "utf8"));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++; else { fail++; if (detail !== undefined) console.log(`        ${detail}`); }
}
const eq = (n, a, b) => check(n, a === b, `expected ${b}\n        got      ${a}`);
async function guard(name, fn) {
  try { return await fn(); } catch (e) { check(name, false, `threw: ${e.message}`); return undefined; }
}

const CHAIN = 11155111;
const NAME = "merchant.eth";
const MERCHANT = "0x51050ec063d393217b436747617ad1c2285aeeee";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const AT_BLOCK = 11660000;

const DEPLOYMENT = {
  chainId: CHAIN,
  payoutCurrency: USDC,
  hook: "0xdD1FD0c33FEF7434443df2031f1E5e2e80dA60c0",
  executor: "0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f",
  registry: "0x0000000000000000000000000000000000000Reg".slice(0, 42),
};

const word = (h) => h.replace(/^0x/, "").padStart(64, "0");
const okReturn = (inner) => {
  const body = inner.replace(/^0x/, "");
  const len = word((body.length / 2).toString(16));
  return "0x" + word((64).toString(16)) + word("0".repeat(0)) + len + body.padEnd(Math.ceil(body.length / 64) * 64, "0");
};
// The resolver's return shape: (bytes result, address resolver).
const resolverReturn = (addr) => {
  const inner = word(addr.replace(/^0x/, ""));
  return "0x" + word((64).toString(16)) + word("51050ec063d393217b436747617ad1c2285aeeee")
    + word((32).toString(16)) + inner;
};
const resolveOk = (addr = MERCHANT) =>
  resolveMerchant(NAME, async () => resolverReturn(addr), {blockNumber: AT_BLOCK});

/// The injected policy reader: returns the fixture's real wire bytes.
const policyCall = (over = {}) => async (to, data) => {
  const sel = data.slice(0, 10);
  if (over.throwOn === sel) throw new Error("transport failure");
  if (sel === POLICY_SELECTOR.policy) return over.policy ?? F.returnVectors.policyReturnVector;
  if (sel === POLICY_SELECTOR.ownerOf) return over.ownerOf ?? F.returnVectors.ownerOfReturnVector;
  throw new Error(`unexpected selector ${sel}`);
};

const OPTS = (over = {}) => ({
  validForBlocks: 300, atBlock: AT_BLOCK, operator: F.operator, call: policyCall(), ...over,
});

// =================================================================================================
console.log("ENS -> policy -> config -> quote\n— the merchant id is derived from the NAME —");
{
  const a = deriveMerchantId(NAME, {chainId: CHAIN});
  check("a normalised name derives an id", a.ok && a.merchantId > 0n);
  eq("the id matches the one the policy fixture was registered under", String(a.merchantId), F.merchantId);
  eq("case does not change it", String(deriveMerchantId("MERCHANT.eth", {chainId: CHAIN}).merchantId), F.merchantId);
  eq("trailing case in the TLD does not change it",
    String(deriveMerchantId("Merchant.ETH", {chainId: CHAIN}).merchantId), F.merchantId);
  check("a different name gives a different id",
    deriveMerchantId("other.eth", {chainId: CHAIN}).merchantId !== a.merchantId);
  check("a different chain gives a different id",
    deriveMerchantId(NAME, {chainId: 1}).merchantId !== a.merchantId);
  check("a different policy version gives a different id",
    deriveMerchantId(NAME, {chainId: CHAIN, policyVersion: 2}).merchantId !== a.merchantId);
  eq("a name that cannot be normalised derives nothing",
    deriveMerchantId("nodots", {chainId: CHAIN}).status, ID_STATUS.NAME_NOT_NORMALISABLE);
  eq("a name with no chain derives nothing", deriveMerchantId(NAME).status, ID_STATUS.NO_CHAIN);
  check("the derivation is domain-separated", MERCHANT_ID_DOMAIN.startsWith("UNICA."));
  // THE RULE. An operator is a key; deriving identity from it would make a key rotation a new
  // merchant. There is a mutation for this.
  check("the id does not depend on the operator in any way",
    !deriveMerchantId.toString().includes("operator"));
  check("the id carries the namehash it was derived through", a.namehash === namehash(NAME));
}

console.log("— the policy decoder, against bytes three implementations agree on —");
{
  const d = decodePolicyReturn(F.returnVectors.policyReturnVector);
  eq("bank basis points", String(d.bankBps), String(F.policy.bank_bps));
  eq("hold count", d.holds.length, F.policy.holds.length);
  check("every hold leg agrees with the Vyper capture",
    d.holds.every((h, i) => h.token.toLowerCase() === F.policy.holds[i][0].toLowerCase()
      && String(h.shareBps) === String(F.policy.holds[i][1])));
  eq("the payout reference", d.payoutRef, F.policy.payoutRefHash);
  eq("active", d.active, F.policy.active);
  check("the shares sum to ten thousand",
    d.bankBps + d.holds.reduce((a, h) => a + h.shareBps, 0n) === 10000n);
  for (const [label, bytes] of [
    ["empty return", "0x"],
    ["a short return", "0x" + "00".repeat(64)],
    ["a wrong head offset", "0x" + word("40") + "00".repeat(160)],
  ]) {
    let threw = false;
    try { decodePolicyReturn(bytes); } catch { threw = true; }
    check(`${label} is refused rather than decoded`, threw);
  }
}

console.log("— a failed read is NOT an empty policy —");
{
  const id = BigInt(F.merchantId);
  const good = await readPolicy(id, {registry: DEPLOYMENT.registry, call: policyCall(), operator: F.operator});
  check("a real policy reads", good.ok && good.policy.bankBps === 6000n, good.status);
  eq("... and names its operator", good.authorisedOperator.toLowerCase(), F.operator.toLowerCase());

  const failed = await readPolicy(id, {registry: DEPLOYMENT.registry,
    call: policyCall({throwOn: POLICY_SELECTOR.policy})});
  eq("a transport failure is READ_FAILED, not an empty policy", failed.status, POLICY_STATUS.READ_FAILED);
  check("... and returns no policy at all", failed.policy === undefined);

  const inactive = "0x" + word("20") + word("0") + word("80") + "00".repeat(32) + word("0") + word("0");
  eq("an all-zero answer is NOT_REGISTERED rather than a zero-share policy",
    (await readPolicy(id, {registry: DEPLOYMENT.registry, call: policyCall({policy: inactive})})).status,
    POLICY_STATUS.NOT_REGISTERED);

  const wrongOp = await readPolicy(id, {registry: DEPLOYMENT.registry, call: policyCall(),
    operator: "0x" + "ab".repeat(20)});
  eq("an unauthorised operator is refused", wrongOp.status, POLICY_STATUS.OPERATOR_NOT_AUTHORISED);
  check("... and returns no policy", wrongOp.policy === undefined);

  eq("an unsupported policy version is refused",
    (await readPolicy(id, {registry: DEPLOYMENT.registry, call: policyCall(), policyVersion: 2})).status,
    POLICY_STATUS.UNSUPPORTED_VERSION);
}

console.log("— the chain binds, and the four disagreements are checked —");
const bound = await guard("the chain binds end to end", async () =>
  bindIdentity(await resolveOk(), DEPLOYMENT, OPTS()));
{
  check("the chain binds end to end", bound?.ok === true, bound?.status + " " + (bound?.detail ?? ""));
  eq("the recipient is the RESOLVED address", bound.immutable.recipient.toLowerCase(), MERCHANT);
  eq("the merchant id is the derived one", String(bound.merchantId), F.merchantId);
  eq("the config hash is the canonical one", bound.merchantConfigHash, merchantConfigHash(bound.config));
  check("the resolution has its own digest", /^0x[0-9a-f]{64}$/.test(bound.resolution.digest));
  check("the policy has its own digest", /^0x[0-9a-f]{64}$/.test(bound.policyDigest));
  check("the policy digest moves when the policy does",
    policyDigest({...bound.policy, bankBps: 5999n}) !== bound.policyDigest);
  check("the resolution digest moves when the recipient does",
    resolutionDigest({...bound.resolution, name: bound.name.normalized, namehash: bound.name.namehash,
      recipient: "0x" + "ab".repeat(20), chainId: CHAIN}) !== bound.resolution.digest);
  eq("the hook is deployment-fixed", bound.immutable.hook, DEPLOYMENT.hook);
  eq("the executor is deployment-fixed", bound.immutable.executor, DEPLOYMENT.executor);
  eq("the payout token is deployment-fixed", bound.immutable.tokenOut, USDC);

  const again = await bindIdentity(await resolveOk(), DEPLOYMENT, OPTS());
  eq("a repeated build is byte-identical",
    JSON.stringify(again, (k, v) => (typeof v === "bigint" ? v.toString() : v)),
    JSON.stringify(bound, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

{
  // The equality check between the id's view of the name and the config's. Both normally derive
  // from one normaliser and so can never disagree — which is exactly why a mutation removing the
  // check survived until this row existed. The disagreement IS reachable: a resolution object whose
  // `name` has been tampered with after resolution, which is what a buggy or hostile resolver
  // adapter would hand over.
  const honest = await resolveOk();
  const tampered = {...honest, name: "other.eth", namehash: namehash("other.eth")};
  const r = await bindIdentity(tampered, DEPLOYMENT, OPTS());
  check("a resolution whose name was altered after resolution is refused",
    !r.ok && r.status === CHAIN_STATUS.NAME_DISAGREES, `${r.status} ${r.detail ?? ""}`);
  check("... and produces no binding", r.immutable === undefined);

  const namehashOnly = {...honest, namehash: namehash("other.eth")};
  const r2 = await bindIdentity(namehashOnly, DEPLOYMENT, OPTS());
  check("a resolution whose namehash was swapped for another name's is refused",
    !r2.ok && r2.status === CHAIN_STATUS.NAME_DISAGREES, r2.status);
}

console.log("— no address may arrive through an argument —");
for (const f of ["recipient", "payoutCurrency", "operatorOverride", "merchant", "payTo"]) {
  const r = await bindIdentity(await resolveOk(), DEPLOYMENT, {...OPTS(), [f]: "0x" + "ba".repeat(20)});
  check(`an option named '${f}' is refused`, !r.ok && r.status === CHAIN_STATUS.ADDRESS_ARGUMENT_REFUSED, r.status);
}

console.log("— the chain refuses, by name —");
{
  const cases = [
    ["a resolution that failed", await resolveMerchant(NAME, async () => resolverReturn("0x" + "00".repeat(20))), DEPLOYMENT, OPTS(), CHAIN_STATUS.RESOLUTION_REFUSED],
    ["a settlement chain that is not the resolution's", await resolveOk(), {...DEPLOYMENT, chainId: 1}, OPTS(), CHAIN_STATUS.CONFIG_REFUSED],
    ["an unlisted payout currency", await resolveOk(), {...DEPLOYMENT, payoutCurrency: "0x" + "cd".repeat(20)}, OPTS(), CHAIN_STATUS.CONFIG_REFUSED],
    ["a stale resolution", await resolveOk(), DEPLOYMENT, OPTS({atBlock: AT_BLOCK + 301}), CHAIN_STATUS.CONFIG_REFUSED],
    ["a missing policy", await resolveOk(), DEPLOYMENT, OPTS({call: policyCall({policy: "0x" + word("20") + word("0") + word("80") + "00".repeat(32) + word("0") + word("0")})}), CHAIN_STATUS.POLICY_REFUSED],
    ["a transport failure", await resolveOk(), DEPLOYMENT, OPTS({call: policyCall({throwOn: POLICY_SELECTOR.policy})}), CHAIN_STATUS.POLICY_REFUSED],
    ["an unauthorised operator", await resolveOk(), DEPLOYMENT, OPTS({operator: "0x" + "ab".repeat(20)}), CHAIN_STATUS.POLICY_REFUSED],
  ];
  for (const [label, res, dep, opt, want] of cases) {
    const r = await bindIdentity(res, dep, opt);
    check(`${label} is refused as ${want}`, !r.ok && r.status === want, `got ${r.status} ${r.detail ?? ""}`);
    check("... and produces no binding", r.immutable === undefined && r.config === undefined);
  }
}

console.log("— the quote takes only what a caller may choose —");
{
  const terms = {
    version: 1, quoteId: "0x" + "77".repeat(32), merchantSigner: "0x" + "d1".repeat(20),
    payer: "0x" + "14".repeat(20), tokenIn: WETH, maxIn: 10n ** 18n, amountOut: 100000000n,
    deadline: 2000000000n, zeroForOne: false, policyVersion: 1,
    pool: {currency0: USDC, currency1: WETH, fee: 3000, tickSpacing: 60, hooks: DEPLOYMENT.hook},
  };
  const q = buildQuote(bound, terms);
  check("a complete set of terms builds a quote", q.ok, q.status + " " + (q.detail ?? ""));
  eq("the recipient came from the binding", q.quote.recipient.toLowerCase(), MERCHANT);
  eq("the payout token came from the binding", q.quote.tokenOut, USDC);
  eq("the config hash came from the binding", q.quote.merchantConfigHash, bound.merchantConfigHash);
  eq("the hook came from the deployment", q.quote.hook, DEPLOYMENT.hook);
  eq("the executor came from the deployment", q.quote.executor, DEPLOYMENT.executor);
  eq("the input token is the caller's", q.quote.tokenIn, WETH);

  for (const f of ["recipient", "tokenOut", "merchantConfigHash", "hook", "executor", "chainId"]) {
    const bad = buildQuote(bound, {...terms, [f]: "0x" + "ba".repeat(20)});
    check(`supplying '${f}' is refused`, !bad.ok && bad.status === QUOTE_STATUS.IMMUTABLE_FIELD_SUPPLIED, bad.status);
    check("... and no quote is produced", bad.quote === undefined);
  }
  for (const f of ["quoteId", "payer", "tokenIn", "maxIn", "amountOut", "deadline"]) {
    const bad = buildQuote(bound, {...terms, [f]: undefined});
    check(`omitting '${f}' is refused`, !bad.ok && bad.status === QUOTE_STATUS.MISSING_TERM, bad.status);
  }
  eq("an unbound chain builds no quote", buildQuote({ok: false}, terms).status, QUOTE_STATUS.NOT_BOUND);

  // The quote must be the shape the frozen encoder accepts, and its digest must move with the
  // configuration — which is how the resolution the payer saw is bound WITHOUT adding a field.
  const d1 = quoteDigest(q.quote, {chainId: CHAIN});
  check("the frozen encoder accepts the assembled quote", /^0x[0-9a-f]{64}$/.test(d1));
  check("the struct hash is derivable too", /^0x[0-9a-f]{64}$/.test(hashQuote(q.quote)));
  const d2 = quoteDigest({...q.quote, merchantConfigHash: "0x" + "22".repeat(32)}, {chainId: CHAIN});
  check("a different resolution produces a different quote digest", d1 !== d2);
  check("the digest is stable across rebuilds", quoteDigest(buildQuote(bound, terms).quote, {chainId: CHAIN}) === d1);
}

console.log("— evidence is classified, never rounded up —");
{
  check("the classification vocabulary exists", Object.keys(EVIDENCE).length === 5);
  check("a fixture run cannot be called live",
    EVIDENCE.LOCAL_FIXTURE !== EVIDENCE.LIVE_VERIFIED && !!EVIDENCE.UNAVAILABLE);
}

console.log(`\nrows run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
