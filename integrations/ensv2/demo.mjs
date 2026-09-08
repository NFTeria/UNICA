// One command, the whole chain: a name a person typed, to a quote a merchant could sign.
//
//   node integrations/ensv2/demo.mjs                 (fixtures only, no network, the default)
//   node integrations/ensv2/demo.mjs --json
//
// DEFAULT MODE MAKES NO RPC CALL AND SENDS NOTHING. The resolver reply and the policy bytes come
// from committed fixtures, and every stage is labelled with how strongly it is actually held —
// LOCAL_FIXTURE, LOCALLY_VERIFIED, FORK_VERIFIED, LIVE_VERIFIED or UNAVAILABLE. A fixture run is
// never reported as a live one, and there is no flag that would let it be.
//
// It prints no signature and no key. The merchant's signature here is fixed filler; the row that
// matters is that the DIGEST is reproducible from the chain.

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve as pathResolve} from "node:path";
import {fileURLToPath} from "node:url";

import {resolveMerchant} from "../../web/ensv2/resolve.mjs";
import {POLICY_SELECTOR} from "./policy.mjs";
import {EVIDENCE, bindIdentity, buildQuote} from "./identity.mjs";
import {quoteDigest} from "../../tools/unica-sign/unica.mjs";

chdir(pathResolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const F = JSON.parse(readFileSync("integrations/ensv2/fixtures/merchant-policy.json", "utf8"));
const asJson = process.argv.includes("--json");

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
  registry: "0x000000000000000000000000000000000000BEEF",
};

const word = (h) => h.replace(/^0x/, "").padStart(64, "0");
const resolverReply = () =>
  "0x" + word((64).toString(16)) + word(MERCHANT.slice(2)) + word((32).toString(16)) + word(MERCHANT.slice(2));

const stages = [];
const stage = (name, evidence, detail) => {
  stages.push({stage: name, evidence, detail});
  if (!asJson) console.log(`  ${evidence.padEnd(18)} ${name}${detail ? `\n${" ".repeat(21)}${detail}` : ""}`);
};

if (!asJson) console.log(`UNICA — ENS identity to V2 quote\n  merchant name: ${NAME}\n`);

const resolution = await resolveMerchant(NAME, async () => resolverReply(), {blockNumber: AT_BLOCK});
stage("ENS resolution", EVIDENCE.LOCAL_FIXTURE, `status ${resolution.status}, recipient ${resolution.recipient}`);

const binding = await bindIdentity(resolution, DEPLOYMENT, {
  validForBlocks: 300,
  atBlock: AT_BLOCK,
  operator: F.operator,
  // The policy bytes are the ones `cast abi-encode` produced and the real Vyper contract's values
  // agree with. No socket is opened.
  call: async (_to, data) =>
    data.slice(0, 10) === POLICY_SELECTOR.policy ? F.returnVectors.policyReturnVector : F.returnVectors.ownerOfReturnVector,
});
if (!binding.ok) {
  console.error(`chain refused: ${binding.status} ${binding.detail ?? ""}`);
  process.exit(1);
}
stage("merchant identity", EVIDENCE.LOCALLY_VERIFIED, `id ${binding.merchantId}`);
stage("canonical MerchantConfig", EVIDENCE.LOCALLY_VERIFIED, binding.merchantConfigHash);
stage("merchant policy", EVIDENCE.LOCAL_FIXTURE,
  `bank ${binding.policy.bankBps} bps, ${binding.policy.holds.length} hold leg(s), operator authorised`);
stage("policy/config consistency", EVIDENCE.LOCALLY_VERIFIED, "recipient, chain and payout all agree");

const terms = {
  version: 1,
  quoteId: "0x" + "77".repeat(32),
  merchantSigner: "0x" + "d1".repeat(20),
  payer: "0x" + "14".repeat(20),
  tokenIn: WETH,
  maxIn: 10n ** 18n,
  amountOut: 100000000n,
  deadline: 2000000000n,
  zeroForOne: false,
  policyVersion: 1,
  pool: {currency0: USDC, currency1: WETH, fee: 3000, tickSpacing: 60, hooks: DEPLOYMENT.hook},
};
const q = buildQuote(binding, terms);
if (!q.ok) {
  console.error(`quote refused: ${q.status} ${q.detail ?? ""}`);
  process.exit(1);
}
const digest = quoteDigest(q.quote, {chainId: CHAIN});
stage("V2 quote", EVIDENCE.LOCALLY_VERIFIED, `digest ${digest}`);
stage("merchant signature", EVIDENCE.UNAVAILABLE, "no key is used or needed here; the digest is the artifact");
stage("settlement", EVIDENCE.UNAVAILABLE, "V2 is not deployed to any public chain");

const summary = {
  mode: "LOCAL_FIXTURE",
  name: binding.name,
  merchantId: binding.merchantId.toString(),
  recipient: binding.immutable.recipient,
  payoutToken: binding.immutable.tokenOut,
  merchantConfigHash: binding.merchantConfigHash,
  resolutionDigest: binding.resolution.digest,
  policyDigest: binding.policyDigest,
  quoteDigest: digest,
  hook: binding.immutable.hook,
  executor: binding.immutable.executor,
  chainId: binding.immutable.chainId,
  stages,
  limitations: [
    "every stage above is a LOCAL FIXTURE or a local computation; none is a live chain read",
    "V2 is not deployed to any public chain, so no settlement can follow this quote",
    "the merchant policy was read from committed bytes, not from a deployed registry",
    "no key is used, nothing is signed, and nothing is sent",
  ],
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`\n  the payer would pay      ${terms.maxIn} of ${terms.tokenIn} at most`);
  console.log(`  the merchant receives    ${terms.amountOut} of ${binding.immutable.tokenOut}, exactly`);
  console.log(`  at                       ${binding.immutable.recipient} (resolved from ${NAME})`);
  console.log(`\n  quote digest             ${digest}`);
  console.log("\nWHAT THIS IS NOT");
  for (const l of summary.limitations) console.log(`  - ${l}`);
}
