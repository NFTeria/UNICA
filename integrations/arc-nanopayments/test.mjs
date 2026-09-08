// The Arc nanopayments integration — the suite.
//
// Run: node integrations/arc-nanopayments/test.mjs      (offline, no key, no endpoint, no SDK)
//
// THE VECTOR WAS SIGNED BY CIRCLE'S OWN SDK. `vectors.json` holds an authorization produced by
// @circle-fin/x402-batching@2.0.4 with a throwaway key derived from a fixed phrase, alongside the
// digest and the signature. Nothing here imports that SDK: the point of this module is to be a
// SECOND implementation, and a verifier that shared code with the thing it checks could not
// disagree with it.
//
// STREAMED, and a throw becomes a NAMED failing row. Three suites in this repository have now
// learned that the hard way.

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {
  ARC_TESTNET, AUTHORIZATION_TYPE, AUTH_STATUS, GATEWAY_DOMAIN_NAME, GATEWAY_DOMAIN_VERSION,
  SIGNED_FIELDS, UNSIGNED_CONCERNS, authorizationDigest, authorizationStructHash,
  domainSeparator, verifyAuthorization,
} from "./protocol.mjs";
import {
  EVIDENCE, EVIDENCE_GRADE, POLICY_STATUS, SessionBudget, authorizeAction, evidenceDigest,
  mandateDigest, requestDigest, responseDigest, setRoot,
} from "./mandate.mjs";

chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const V = JSON.parse(readFileSync("integrations/arc-nanopayments/vectors.json", "utf8"));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
  else { fail++; if (detail !== undefined) console.log(`        ${detail}`); }
}
const eq = (n, a, b) => check(n, a === b, `expected ${b}\n        got      ${a}`);
function guard(name, fn) {
  try { return fn(); } catch (e) { check(name, false, `threw: ${e.message}`); return undefined; }
}

const ctx = {chainId: V.environment.chainId, verifyingContract: V.environment.verifyingContract};
const payload = () => ({
  x402Version: 2,
  payload: {authorization: {...V.authorization}, signature: V.expected.signature},
});
const asked = (over = {}) => ({
  ...ctx, payTo: V.authorization.to, amount: V.authorization.value, at: 1788900000, ...over,
});

// =================================================================================================
console.log("Arc nanopayments — the protocol, derived independently\n— the pinned constants come from the SDK, not from documentation —");
eq("the EIP-712 domain name", GATEWAY_DOMAIN_NAME, "GatewayWalletBatched");
eq("the EIP-712 domain version", GATEWAY_DOMAIN_VERSION, "1");
eq("the authorization type string", AUTHORIZATION_TYPE,
  "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter," +
  "uint256 validBefore,bytes32 nonce)");
eq("Arc testnet chain id", ARC_TESTNET.chainId, 5042002);
eq("the network string is CAIP-2", ARC_TESTNET.network, `eip155:${ARC_TESTNET.chainId}`);
eq("USDC has six decimals", ARC_TESTNET.usdcDecimals, 6);
eq("the verifying contract is the GatewayWallet, NOT the token",
  ctx.verifyingContract.toLowerCase(), "0x0077777d7eba4688bdef3e311b846f25870a19b9");
check("the token is not the verifying contract",
  ARC_TESTNET.usdc.toLowerCase() !== ctx.verifyingContract.toLowerCase());

console.log("— what a Gateway authorization does and does not bind —");
eq("exactly six fields are signed", SIGNED_FIELDS.length, 6);
check("the signed fields are payer, recipient, amount, window and nonce",
  JSON.stringify(SIGNED_FIELDS) === JSON.stringify(["from","to","value","validAfter","validBefore","nonce"]));
// The finding this whole integration turns on: a nanopayment proves an amount moved to somebody,
// and says nothing about what was bought. Asserted so any later claim to the contrary fails here.
for (const concern of UNSIGNED_CONCERNS) {
  check(`'${concern}' is NOT inside the payment signature`,
    !AUTHORIZATION_TYPE.includes(concern) && !SIGNED_FIELDS.includes(concern));
}
eq("the measured signed-field count agrees with the recorded one", V.measured.signedFieldCount, SIGNED_FIELDS.length);
eq("the SDK contains no batch commitment machinery", V.measured.merkleOrBatchCommitmentOccurrences, 0);
eq("the SDK's embedded ABI declares no events to index", V.measured.eventDefinitionsInSdkAbi, 0);
check("the demo's authorization window is about four days",
  V.measured.observedAuthorizationWindowSeconds === 346200
  && Math.round(V.measured.observedAuthorizationWindowSeconds / 86400) === 4);

console.log("— the vector Circle's own SDK signed, verified here without it —");
eq("the domain separator", domainSeparator(ctx), V.expected.domainSeparator);
const digest = guard("the digest derives", () => authorizationDigest(V.authorization, ctx));
check("the digest derives", digest !== undefined, "");
check("the struct hash is not the digest", authorizationStructHash(V.authorization) !== digest);
{
  const r = verifyAuthorization(payload(), asked());
  check("the SDK's signature verifies against this implementation", r.ok && r.status === AUTH_STATUS.VALID, r.detail);
  eq("the recovered signer is the payer the SDK used", r.signer.toLowerCase(), V.expected.signer.toLowerCase());
  eq("the recovered signer is the authorization's own `from`", r.signer.toLowerCase(), V.authorization.from.toLowerCase());
}

console.log("— every refusal the local verifier can make —");
function refuses(label, mutate, want) {
  const p = payload();
  const asks = asked();
  mutate(p, asks);
  const r = verifyAuthorization(p, asks, new Set());
  check(label, !r.ok && r.status === want, `got ${r.status} ${r.detail ?? ""}`);
  check(`... and hands back no signer`, r.signer === undefined);
}
refuses("a payload with no signature", (p) => { delete p.payload.signature; }, AUTH_STATUS.MALFORMED_PAYLOAD);
refuses("a payload with no authorization", (p) => { delete p.payload.authorization; }, AUTH_STATUS.MALFORMED_PAYLOAD);
refuses("a signature of the wrong length", (p) => { p.payload.signature = p.payload.signature.slice(0, -2); }, AUTH_STATUS.BAD_SIGNATURE);
refuses("a signature with a flipped byte", (p) => {
  p.payload.signature = p.payload.signature.slice(0, 10) + "ff" + p.payload.signature.slice(12);
}, AUTH_STATUS.SIGNER_IS_NOT_THE_PAYER);
refuses("an altered payer", (p) => { p.payload.authorization.from = "0x" + "cd".repeat(20); }, AUTH_STATUS.SIGNER_IS_NOT_THE_PAYER);
refuses("an altered recipient", (p) => { p.payload.authorization.to = "0x" + "cd".repeat(20); }, AUTH_STATUS.SIGNER_IS_NOT_THE_PAYER);
refuses("an altered amount", (p) => { p.payload.authorization.value = "1001"; }, AUTH_STATUS.SIGNER_IS_NOT_THE_PAYER);
refuses("an altered nonce", (p) => { p.payload.authorization.nonce = "0x" + "44".repeat(32); }, AUTH_STATUS.SIGNER_IS_NOT_THE_PAYER);
refuses("a recipient the seller did not ask for", (p, a) => { a.payTo = "0x" + "ab".repeat(20); }, AUTH_STATUS.WRONG_RECIPIENT);
refuses("an amount the seller did not ask for", (p, a) => { a.amount = "999"; }, AUTH_STATUS.WRONG_AMOUNT);
refuses("a different chain in the domain", (p, a) => { a.chainId = 1; }, AUTH_STATUS.SIGNER_IS_NOT_THE_PAYER);
refuses("a different verifying contract", (p, a) => { a.verifyingContract = "0x" + "ab".repeat(20); }, AUTH_STATUS.SIGNER_IS_NOT_THE_PAYER);
refuses("an authorization presented before it is valid", (p, a) => { a.at = 1788700000; }, AUTH_STATUS.NOT_YET_VALID);
refuses("an authorization presented after it expires", (p, a) => { a.at = 1789145601; }, AUTH_STATUS.EXPIRED);
{
  const seen = new Set();
  const first = verifyAuthorization(payload(), asked(), seen);
  const second = verifyAuthorization(payload(), asked(), seen);
  check("the first presentation of a nonce is accepted", first.ok);
  check("the second presentation of the same nonce is refused",
    !second.ok && second.status === AUTH_STATUS.NONCE_REPLAYED, second.status);
}

// =================================================================================================
console.log("\n— the mandate binds what the payment cannot —");
const AGENT = V.authorization.from;
const PROVIDER = V.authorization.to;
const USDC = ARC_TESTNET.usdc;
const OUT = "0x4444444444444444444444444444444444444444";
const RESOURCE = "market.snapshot";
const NOW = 1788900000;

const mandate = () => ({
  sessionId: "0x" + "55".repeat(32),
  agent: AGENT,
  chainId: ARC_TESTNET.chainId,
  providers: [PROVIDER],
  resources: [RESOURCE],
  assets: [USDC, OUT],
  actions: ["BUY"],
  recipient: "0x6666666666666666666666666666666666666666",
  maxPerCall: "2000",
  sessionBudget: "1000000",
  maxActionInput: "25000000",
  maxDataAge: 120,
  expiry: NOW + 3600,
  policyVersion: 1,
});

const reqD = requestDigest({resource: RESOURCE, params: {base: "ETH", quote: "USDC"}, nonce: 1});
const body = {observedAt: NOW - 5, price: "250000000", sources: ["a", "b"]};
const resD = responseDigest(body);
const evidence = () => ({
  authorization: {...V.authorization},
  resource: RESOURCE,
  requestDigest: reqD,
  responseDigest: resD,
  observedAt: NOW - 5,
  price: V.authorization.value,
});
const proposal = () => ({
  action: "BUY", tokenIn: USDC, tokenOut: OUT,
  maximumInput: "20000000", minimumOutput: "19000000",
  requestDigest: reqD, responseDigest: resD, reasonCode: "SPREAD_THRESHOLD_MET",
});
const runCtx = () => ({now: NOW, chainId: ARC_TESTNET.chainId, budget: new SessionBudget("1000000")});

{
  const r = authorizeAction(mandate(), evidence(), proposal(), runCtx());
  check("the acceptance path authorises one action", r.ok && r.status === POLICY_STATUS.AUTHORIZED, r.detail);
  check("the action mandate points at its own evidence",
    r.actionMandate.evidenceDigest === evidenceDigest(evidence()));
  check("the action mandate points at the owner's mandate",
    r.actionMandate.mandateDigest === mandateDigest(mandate()));
  check("the recipient comes from the MANDATE, never from the proposal",
    r.actionMandate.recipient === mandate().recipient);
  check("no calldata is produced by a policy decision", r.calldata === null);
  check("amounts stay base-unit strings", typeof r.actionMandate.maximumInput === "string");
}

console.log("— the refusal path, one broken condition at a time —");
function denies(label, {m = {}, e = {}, p = {}, c = {}}, want) {
  const r = guard(label, () => authorizeAction(
    {...mandate(), ...m}, {...evidence(), ...e}, {...proposal(), ...p}, {...runCtx(), ...c})) ?? {};
  check(label, r.ok === false && r.status === want, `got ${r.status} ${r.detail ?? ""}`);
  check("... and returns no action mandate and no calldata",
    r.actionMandate === null && r.calldata === null);
}
denies("a provider outside the mandate", {m: {providers: ["0x" + "ab".repeat(20)]}}, POLICY_STATUS.UNKNOWN_PROVIDER);
denies("a resource outside the mandate", {m: {resources: ["other.tool"]}}, POLICY_STATUS.UNKNOWN_RESOURCE);
denies("a payer who is not the agent", {m: {agent: "0x" + "ab".repeat(20)}}, POLICY_STATUS.WRONG_PAYER);
denies("a price above the per-call ceiling", {m: {maxPerCall: "999"}}, POLICY_STATUS.PRICE_ABOVE_PER_CALL_CEILING);
denies("a mandate that has expired", {m: {expiry: NOW - 1}}, POLICY_STATUS.MANDATE_EXPIRED);
denies("a settlement chain that is not the mandate's", {c: {chainId: 1}}, POLICY_STATUS.WRONG_CHAIN);
denies("a response that answers another request", {p: {requestDigest: "0x" + "11".repeat(32)}}, POLICY_STATUS.REQUEST_MISMATCH);
denies("a proposal quoting a response nobody returned", {p: {responseDigest: "0x" + "11".repeat(32)}}, POLICY_STATUS.RESPONSE_MISMATCH);
denies("data older than the mandate allows", {e: {observedAt: NOW - 3600}}, POLICY_STATUS.STALE_DATA);
denies("data observed in the future", {e: {observedAt: NOW + 60}}, POLICY_STATUS.STALE_DATA);
denies("a proposal missing a field", {p: {reasonCode: null}}, POLICY_STATUS.MALFORMED_PROPOSAL);
denies("an action the mandate does not permit", {p: {action: "SELL"}}, POLICY_STATUS.UNPERMITTED_ACTION);
denies("an asset outside the mandate", {p: {tokenOut: "0x" + "ab".repeat(20)}}, POLICY_STATUS.PROPOSAL_ALTERED_A_BOUND_FIELD);
denies("a proposal that tries to move the recipient", {p: {recipient: "0x" + "ab".repeat(20)}}, POLICY_STATUS.PROPOSAL_ALTERED_A_BOUND_FIELD);
denies("an action larger than the mandate allows", {p: {maximumInput: "25000001"}}, POLICY_STATUS.ACTION_ABOVE_MANDATE);
denies("a signed amount that is not the quoted price", {e: {price: "999"}}, POLICY_STATUS.WRONG_RECIPIENT);

console.log("— the budget, which the upstream demo cannot hold —");
{
  // The upstream agent adds to `totalSpent` inside the promise's `.then`, so the ceiling is
  // compared AFTER settlement while other payments are still in flight; its own output prints the
  // in-flight count. Reserving before the spend is what makes a budget a budget.
  const b = new SessionBudget("1000");
  check("a reservation inside the budget succeeds", b.reserve("600"));
  check("a second reservation that would exceed it is refused", !b.reserve("600"));
  eq("the available balance reflects the reservation", b.available.toString(), "400");
  b.settle("600");
  eq("settling moves reserved into committed", `${b.reserved}/${b.committed}`, "0/600");
  check("a released reservation returns to the budget", (b.reserve("300"), b.release("300"), b.available === 400n));

  // The measured shape of the upstream pattern, modelled here so the difference is a number.
  let totalSpent = 0n;
  const limit = 1000n;
  let admitted = 0;
  for (let i = 0; i < 5; i++) if (totalSpent < limit) admitted++;   // all five see 0 spent
  totalSpent += BigInt(admitted) * 600n;
  check("checking a running total AFTER the spend admits an overspend",
    admitted === 5 && totalSpent > limit, `admitted ${admitted}, spent ${totalSpent}`);

  const reserved = new SessionBudget("1000");
  let ok = 0;
  for (let i = 0; i < 5; i++) if (reserved.reserve("600")) ok++;
  check("reserving BEFORE the spend admits only what fits", ok === 1, `admitted ${ok}`);
}

console.log("— evidence is graded, not assumed —");
{
  const grades = new Set(Object.values(EVIDENCE));
  for (const [k, v] of Object.entries(EVIDENCE_GRADE)) {
    check(`'${k}' carries a grade this module defines`, grades.has(v), v);
  }
  eq("a settled payment is API-reported, not verified", EVIDENCE_GRADE.paymentSettled, EVIDENCE.API_REPORTED);
  eq("a batch commitment is UNAVAILABLE at the pinned revision", EVIDENCE_GRADE.batchCommitment, EVIDENCE.UNAVAILABLE);
  eq("which resource was bought is UNAVAILABLE from the payment", EVIDENCE_GRADE.resourcePurchased, EVIDENCE.UNAVAILABLE);
  eq("the payer's agreement to pay IS protocol-signed", EVIDENCE_GRADE.payerAgreedToPay, EVIDENCE.PROTOCOL_SIGNED);
  eq("the request/response binding is UNICA's own, and verified",
    EVIDENCE_GRADE.requestResponseBinding, EVIDENCE.CRYPTOGRAPHICALLY_VERIFIED);
  check("nothing in the grading claims the chain proves what was bought",
    !Object.entries(EVIDENCE_GRADE).some(([k, v]) =>
      k.startsWith("resource") && v === EVIDENCE.CRYPTOGRAPHICALLY_VERIFIED));
}

console.log("— commitments move when their inputs move —");
{
  const base = mandateDigest(mandate());
  for (const [label, over] of Object.entries({
    "the session id": {sessionId: "0x" + "77".repeat(32)},
    "the agent": {agent: "0x" + "ab".repeat(20)},
    "the chain": {chainId: 1},
    "the provider set": {providers: ["0x" + "ab".repeat(20)]},
    "the resource set": {resources: ["other.tool"]},
    "the per-call ceiling": {maxPerCall: "2001"},
    "the session budget": {sessionBudget: "1000001"},
    "the action ceiling": {maxActionInput: "25000001"},
    "the expiry": {expiry: NOW + 3601},
    "the policy version": {policyVersion: 2},
  })) {
    check(`${label} moves the mandate digest`, mandateDigest({...mandate(), ...over}) !== base);
  }
  check("a set root does not depend on the order it was written in",
    setRoot(["b", "a"]) === setRoot(["a", "b"]));
  check("a set root does depend on its members", setRoot(["a"]) !== setRoot(["a", "b"]));
  const e = evidenceDigest(evidence());
  check("a different response moves the evidence digest",
    evidenceDigest({...evidence(), responseDigest: "0x" + "11".repeat(32)}) !== e);
  check("a different resource moves the evidence digest",
    evidenceDigest({...evidence(), resource: "other.tool"}) !== e);
  check("a response body change moves its digest", responseDigest({...body, price: "1"}) !== resD);
}

console.log("— no secret and no endpoint appears anywhere —");
{
  // The shipped modules, NOT this file. A scanner that reads the file naming the patterns it
  // looks for always finds them — script/scan.sh excludes itself for the same reason.
  const sources = ["protocol.mjs", "mandate.mjs", "vectors.json"]
    .map((f) => readFileSync(`integrations/arc-nanopayments/${f}`, "utf8")).join("\n");
  check("no private key literal", !/0x[0-9a-fA-F]{64}\s*(as|\/\/)?\s*(private|key|KEY)/.test(sources));
  check("no API key or token assignment", !/(API_KEY|SECRET|AUTH_TOKEN|PRIVATE_KEY)\s*=\s*["'][^"']{8,}/.test(sources));
  check("no Supabase or OpenAI credential names", !/SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY/.test(sources));
  check("the SDK is referenced but never imported",
    sources.includes("@circle-fin/x402-batching") && !/^import .*@circle-fin/m.test(sources));
}

console.log(`\nrows run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
