// apps/web/tests/join-sepolia.test.mjs — the planner that adds a business to a name with no
// sign-up contract: apps/web/assets/join-sepolia.js. No DOM, no network, no chain, no wallet.
//
// EVERY CALLDATA VECTOR BELOW CAME OUT OF `cast` FIRST. `cast sig`, `cast namehash` and
// `cast calldata` (foundry 1.3.5) produced each constant before this planner encoded anything, so
// the encoder is compared against a tool that shares no code with it. The three selectors the plan
// is defined by — setAddr 0xd5fa2b00, setText 0x10f13a8c, registerLineage 0x68a874fa — are the same
// three script/ensv2/freshcuts-plan.mjs put on chain for the first business, which is the point:
// the screen must ask for the same calls the owner ran by hand, not a second way of doing it.
//
// The rows that matter most are the CONTROLS. A guard that has never been watched refuse something
// is decoration, so each one is exercised in both directions on the same request: the planted-bad
// input must be refused AND the planted-good input must be accepted. A guard deleted from the
// module turns the refusing half red; a guard widened until it refuses everything turns the
// accepting half red.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  ACTIVE,
  DEFAULT_REGISTER_LABEL,
  ROLE_SET_TEXT,
  SIGNATURES,
  TERMINALS_LABEL,
  dnsEncode,
  labelTaken,
  nameSettings,
  nodesFor,
  planBusiness,
  readBusinesses,
  readController,
  readNameState,
  sendPlan,
  stepSentence,
} from "../assets/join-sepolia.js";
import { LABEL_RULE_SENTENCE, isValidLabelLocal } from "../assets/local-join.js";
import { selectorOf, textResource } from "../assets/abi.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

// ---- the fixed points, from cast ----------------------------------------------------------------

const RESOLVER = "0x3D2d26801632e7b13B2fa75236a634e75684988c"; // the record store, deployments/unica-v4/11155111.json identity.ensV2Resolver
const AUTHORITY = "0xB3aCbD101b026669A5b61DBbcD13d5CAe1c8f133"; // the name authority, same manifest, identity.authority
const PAYOUT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OPERATOR = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const SOMEBODY_ELSE = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const KEY = "com.unica.terminal-status";
const LABEL = "sunrise-bakes";
const PARENT_NAME = "unica.eth";

const PARENT_NODE = "0xa1666e95e38a3be2115a9a801792914ca6dca4fa6297d21e835f284254337537"; // cast namehash unica.eth
const BUSINESS_NODE = "0x9195a19f45f9545f7cd0d4f70ab0eb3724ff83c1d7370603c946879cf2e75c71"; // cast namehash sunrise-bakes.unica.eth
const TERMINALS_NODE = "0x8cb60097d12ee63ed914444217bb188554bb7db3390d483920b58b4430f0d12f"; // cast namehash terminals.sunrise-bakes.unica.eth
const REGISTER_NODE = "0xd4f746f71f1efb66f637c31b25201c796bfcd4a064111c288e79c84d7e72fecd"; // cast namehash chair-1.terminals.sunrise-bakes.unica.eth

// cast calldata, one per step of a plan for a name nothing has been written to yet.
const SET_ADDR_VECTOR = "0xd5fa2b009195a19f45f9545f7cd0d4f70ab0eb3724ff83c1d7370603c946879cf2e75c7100000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8";
const SET_TEXT_VECTOR = "0x10f13a8cd4f746f71f1efb66f637c31b25201c796bfcd4a064111c288e79c84d7e72fecd000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000019636f6d2e756e6963612e7465726d696e616c2d7374617475730000000000000000000000000000000000000000000000000000000000000000000000000000066163746976650000000000000000000000000000000000000000000000000000";
const LINEAGE_BUSINESS_VECTOR = "0x68a874faa1666e95e38a3be2115a9a801792914ca6dca4fa6297d21e835f2842543375370000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000d73756e726973652d62616b657300000000000000000000000000000000000000";
const LINEAGE_TERMINALS_VECTOR = "0x68a874fa9195a19f45f9545f7cd0d4f70ab0eb3724ff83c1d7370603c946879cf2e75c71000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000097465726d696e616c730000000000000000000000000000000000000000000000";
const LINEAGE_REGISTER_VECTOR = "0x68a874fa8cb60097d12ee63ed914444217bb188554bb7db3390d483920b58b4430f0d12f0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000763686169722d3100000000000000000000000000000000000000000000000000";

// cast calldata, the optional sixth step: the operator wallet is allowed to write chair-1's status
// key and nothing else. The same selector script/ensv2/freshcuts-plan.mjs measured: 0xf2d1eb25.
const AUTHORIZE_VECTOR = "0xf2d1eb25000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000003c44cdddb6a900fa2b585dd299e03d12fa4293bc0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b0763686169722d31097465726d696e616c730d73756e726973652d62616b657305756e69636103657468000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000019636f6d2e756e6963612e7465726d696e616c2d73746174757300000000000000";
// the register's per-key resource, cast keccak of cast abi-encode f(bytes32,bytes32)
const REGISTER_STATUS_RESOURCE = "0xfbaa825bc3a47c1df192a5ec6e0a1fed2eafe66c67c3438b1a5e313935f05bf5";
// dns vector for chair-1.terminals.freshcuts.unica.eth, out of script/ensv2/freshcuts-sepolia-plan.json
const FRESHCUTS_CHAIR1_DNS_VECTOR = "0x0763686169722d31097465726d696e616c730966726573686375747305756e6963610365746800";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Every id in a document, in document order. */
const idsOf = (html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const duplicateIds = (html) => {
  const ids = idsOf(html);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
};

/**
 * The join page as the build emits it — components expanded, which is the only form in which every
 * id this flow drives is visible. Built into its own directory: apps/web/out belongs to the product
 * build, and `node --test` runs these files in parallel.
 */
let BUILT = null;
function builtJoinPage() {
  if (BUILT === null) {
    const out = mkdtempSync(join(tmpdir(), "unica-join-page-"));
    execFileSync(process.execPath, [join(HERE, "..", "build.mjs")], { encoding: "utf8", env: { ...process.env, UNICA_BUILD_OUT: out } });
    BUILT = readFileSync(join(out, "join", "index.html"), "utf8");
  }
  return BUILT;
}

/** A free name: read back, nothing recorded. The shape `readNameState` returns. */
const FREE = { addr: ZERO, lineage: {}, registerStatus: "" };

const request = (over = {}) => ({
  label: LABEL,
  payout: PAYOUT,
  registerLabel: DEFAULT_REGISTER_LABEL,
  parentNode: PARENT_NODE,
  parentName: PARENT_NAME,
  resolver: RESOLVER,
  authority: AUTHORITY,
  terminalStatusKey: KEY,
  existing: FREE,
  ...over,
});

// ---- selectors, against cast sig -----------------------------------------------------------------

test("every selector this plan sends or reads matches cast sig", () => {
  assert.equal(selectorOf(SIGNATURES.setAddr), "0xd5fa2b00");
  assert.equal(selectorOf(SIGNATURES.setText), "0x10f13a8c");
  assert.equal(selectorOf(SIGNATURES.registerLineage), "0x68a874fa");
  assert.equal(selectorOf(SIGNATURES.addr), "0x3b3b57de");
  assert.equal(selectorOf(SIGNATURES.text), "0x59d1d43c");
  assert.equal(selectorOf(SIGNATURES.lineageKnown), "0xe25e25c4");
  assert.equal(selectorOf(SIGNATURES.parentOf), "0xddeda132");
  assert.equal(selectorOf(SIGNATURES.isNamespaceController), "0x969a5259");
  assert.equal(selectorOf(SIGNATURES.authorizeTextRoles), "0xf2d1eb25");
  assert.equal(selectorOf(SIGNATURES.hasRoles), "0xd3bf89b1");
});

test("control: a selector is a fact about the whole signature, not about its name", () => {
  // Without this row the three above would pass against any signature whose first word matched.
  assert.notEqual(selectorOf("registerLineage(bytes32,bytes)"), "0x68a874fa");
  assert.notEqual(selectorOf("setAddr(bytes32,uint256,address)"), "0xd5fa2b00");
});

// ---- the name math -------------------------------------------------------------------------------

test("the three names a business occupies agree with cast namehash", () => {
  const nodes = nodesFor(PARENT_NODE, LABEL, DEFAULT_REGISTER_LABEL);
  assert.equal(nodes.businessNode, BUSINESS_NODE);
  assert.equal(nodes.terminalsNode, TERMINALS_NODE);
  assert.equal(nodes.registerNode, REGISTER_NODE);
});

test("the register hangs under terminals, not under the business", () => {
  // The admission contract reads the parent of the parent of a register and expects the business,
  // so a register derived one level too high would admit nothing. This is that shape, asserted.
  const nodes = nodesFor(PARENT_NODE, LABEL, DEFAULT_REGISTER_LABEL);
  assert.notEqual(nodes.registerNode, nodesFor(PARENT_NODE, LABEL, TERMINALS_LABEL).registerNode);
  assert.equal(nodes.terminalsNode, nodesFor(PARENT_NODE, LABEL, "anything").terminalsNode);
});

// ---- the plan, on a name nothing has been written to ----------------------------------------------

test("a free name plans five transactions, in the order the records must land in", () => {
  const plan = planBusiness(request());
  assert.equal(plan.ok, true);
  assert.equal(plan.refusal, null);
  assert.deepEqual(plan.steps.map((s) => s.id), ["N1", "N2", "N3", "N4", "N5"]);
  assert.deepEqual(plan.steps.map((s) => s.to), [RESOLVER, RESOLVER, AUTHORITY, AUTHORITY, AUTHORITY]);
  assert.deepEqual(plan.steps.map((s) => s.selector), ["0xd5fa2b00", "0x10f13a8c", "0x68a874fa", "0x68a874fa", "0x68a874fa"]);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.payName, "sunrise-bakes.unica.eth");
  assert.equal(plan.sentence, "Your wallet will ask you to confirm 5 transactions, one after another.");
});

test("every step's calldata is the vector cast produced for it", () => {
  const plan = planBusiness(request());
  const data = Object.fromEntries(plan.steps.map((s) => [s.id, s.data]));
  assert.equal(data.N1, SET_ADDR_VECTOR);
  assert.equal(data.N2, SET_TEXT_VECTOR);
  assert.equal(data.N3, LINEAGE_BUSINESS_VECTOR);
  assert.equal(data.N4, LINEAGE_TERMINALS_VECTOR);
  assert.equal(data.N5, LINEAGE_REGISTER_VECTOR);
});

test("the payout record is written to the business's own name and carries the chosen wallet", () => {
  const plan = planBusiness(request());
  const n1 = plan.steps.find((s) => s.id === "N1");
  assert.ok(n1.data.includes(BUSINESS_NODE.slice(2)), "the business name is in the payout call");
  assert.ok(n1.data.toLowerCase().includes(PAYOUT.slice(2).toLowerCase()), "the payout wallet is in the payout call");
  // control: a different payout wallet must produce different bytes, or the row above proves nothing
  const other = planBusiness(request({ payout: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" }));
  assert.notEqual(other.steps.find((s) => s.id === "N1").data, n1.data);
});

test("a renamed first register changes the register's name and nothing else", () => {
  const plan = planBusiness(request({ registerLabel: "front-counter" }));
  assert.equal(plan.steps.find((s) => s.id === "N1").data, SET_ADDR_VECTOR);
  assert.equal(plan.steps.find((s) => s.id === "N3").data, LINEAGE_BUSINESS_VECTOR);
  assert.notEqual(plan.steps.find((s) => s.id === "N5").data, LINEAGE_REGISTER_VECTOR);
  assert.equal(plan.nodes.registerNode, nodesFor(PARENT_NODE, LABEL, "front-counter").registerNode);
});

// ---- the optional sixth step: a wallet that may switch the register on and off ---------------------

test("a name in the wire form the grant takes is the plan's own vector, label by label", () => {
  // script/ensv2/freshcuts-sepolia-plan.json carries the bytes the first business's grant was made
  // with. Same name, same bytes, derived here from the description rather than read out of it.
  assert.equal(dnsEncode("chair-1.terminals.freshcuts.unica.eth"), FRESHCUTS_CHAIR1_DNS_VECTOR);
  assert.equal(dnsEncode("eth"), "0x0365746800");
  // control: the length byte is a length, so a longer label must move every byte after it
  assert.notEqual(dnsEncode("chair-11.terminals.freshcuts.unica.eth"), FRESHCUTS_CHAIR1_DNS_VECTOR);
  assert.throws(() => dnsEncode("a".repeat(256)), /1 to 255 bytes/);
});

test("no operator means five transactions; an operator means six, and the sixth is the grant", () => {
  const without = planBusiness(request());
  assert.deepEqual(without.steps.map((s) => s.id), ["N1", "N2", "N3", "N4", "N5"]);
  assert.equal(without.operator, null);
  const with_ = planBusiness(request({ operator: OPERATOR }));
  assert.deepEqual(with_.steps.map((s) => s.id), ["N1", "N2", "N6", "N3", "N4", "N5"]);
  const grant = with_.steps.find((s) => s.id === "N6");
  assert.equal(grant.selector, "0xf2d1eb25");
  assert.equal(grant.to, RESOLVER, "a permission is kept where the records are");
  assert.equal(grant.data, AUTHORIZE_VECTOR, "the bytes cast produced for this grant");
  assert.equal(with_.registerName, "chair-1.terminals.sunrise-bakes.unica.eth");
  assert.equal(with_.sentence, "Your wallet will ask you to confirm 6 transactions, one after another.");
});

test("the grant names one register's status key, so a different register is a different call", () => {
  const chair = planBusiness(request({ operator: OPERATOR })).steps.find((s) => s.id === "N6");
  const counter = planBusiness(request({ operator: OPERATOR, registerLabel: "front-counter" })).steps.find((s) => s.id === "N6");
  assert.notEqual(chair.data, counter.data);
  // control: and a different wallet is a different call too, or the address would not be in there
  const other = planBusiness(request({ operator: SOMEBODY_ELSE })).steps.find((s) => s.id === "N6");
  assert.notEqual(chair.data, other.data);
  assert.ok(chair.data.toLowerCase().includes(OPERATOR.slice(2).toLowerCase()));
});

test("an operator wallet that is not a wallet plans nothing, and an empty one plans five", () => {
  assert.match(planBusiness(request({ operator: "0x123" })).refusal, /operator wallet must be a full address/);
  assert.match(planBusiness(request({ operator: ZERO })).refusal, /Leave the operator wallet empty/);
  for (const empty of ["", null, undefined, "   "]) {
    assert.equal(planBusiness(request({ operator: empty })).steps.length, 5, `${JSON.stringify(empty)} is no operator`);
  }
});

test("a grant the chain already records is skipped, and says so", () => {
  const plan = planBusiness(request({ operator: OPERATOR, existing: { ...FREE, grant: true } }));
  assert.deepEqual(plan.steps.map((s) => s.id), ["N1", "N2", "N3", "N4", "N5"]);
  assert.deepEqual(plan.skipped.map((s) => s.id), ["N6"]);
  // control: the same request with the grant not recorded still plans it
  assert.equal(planBusiness(request({ operator: OPERATOR, existing: { ...FREE, grant: false } })).steps.length, 6);
});

// ---- skipping what the chain already records -------------------------------------------------------

test("a recorded parentage row is skipped, and the plan says which", () => {
  const plan = planBusiness(request({
    existing: { addr: ZERO, lineage: { [BUSINESS_NODE]: true, [TERMINALS_NODE]: true }, registerStatus: "" },
  }));
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((s) => s.id), ["N1", "N2", "N5"]);
  assert.deepEqual(plan.skipped.map((s) => s.id), ["N3", "N4"]);
  assert.ok(plan.skipped.every((s) => s.sentence.includes("already")), "a skipped step says why it was skipped");
  assert.equal(plan.sentence, "Your wallet will ask you to confirm 3 transactions, one after another.");
});

test("a register already switched on does not get switched on again", () => {
  const plan = planBusiness(request({ existing: { addr: ZERO, lineage: {}, registerStatus: ACTIVE } }));
  assert.deepEqual(plan.steps.map((s) => s.id), ["N1", "N3", "N4", "N5"]);
  assert.deepEqual(plan.skipped.map((s) => s.id), ["N2"]);
});

test("control: the skip rule reads the chain's answer, not the shape of the request", () => {
  // Planted-good: the same request with nothing recorded must still plan all five. Without this
  // half, a skip rule that fired on everything would look identical to a working one.
  assert.equal(planBusiness(request()).steps.length, 5);
  // Planted-bad-ish: a row recorded for a DIFFERENT name must not skip this one.
  const elsewhere = planBusiness(request({ existing: { addr: ZERO, lineage: { [PARENT_NODE]: true }, registerStatus: "" } }));
  assert.equal(elsewhere.steps.length, 5);
  assert.equal(elsewhere.skipped.length, 0);
});

test("a recorded row is matched however the node is cased", () => {
  const plan = planBusiness(request({
    existing: { addr: ZERO, lineage: { [BUSINESS_NODE.toUpperCase().replace("0X", "0x")]: true }, registerStatus: "" },
  }));
  assert.deepEqual(plan.skipped.map((s) => s.id), ["N3"]);
});

// ---- THE CONTROL THE WHOLE FILE IS BUILT AROUND ---------------------------------------------------

test("control: a name that pays SOMEBODY ELSE is refused, and a free one is not", () => {
  // Delete the payout-record guard from planBusiness and this half goes green-with-five-steps:
  // the screen would then plan setAddr over another business's payout wallet, which is the one
  // mistake in this flow that moves somebody else's money.
  const taken = planBusiness(request({ existing: { addr: SOMEBODY_ELSE, lineage: {}, registerStatus: "" } }));
  assert.equal(taken.ok, false);
  assert.equal(taken.steps.length, 0);
  assert.match(taken.refusal, /sunrise-bakes\.unica\.eth already belongs to a business/);
  // ...and the accepting half, on the same request with the same everything but a free name.
  const free = planBusiness(request({ existing: { addr: ZERO, lineage: {}, registerStatus: "" } }));
  assert.equal(free.ok, true);
  assert.equal(free.steps.length, 5);
});

test("a payout record that is ALREADY this wallet is a sequence that stopped, not another business", () => {
  // This is what a declined second confirmation leaves behind, and refusing it would strand the
  // person on a name only they can finish. The step is skipped, the rest are still planned.
  const plan = planBusiness(request({ existing: { addr: PAYOUT, lineage: {}, registerStatus: "" } }));
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map((s) => s.id), ["N2", "N3", "N4", "N5"]);
  assert.deepEqual(plan.skipped.map((s) => s.id), ["N1"]);
  // control: the guard still fires on the address that is not this wallet's, one character apart
  // in the same object.
  assert.equal(planBusiness(request({ existing: { addr: SOMEBODY_ELSE, lineage: {}, registerStatus: "" } })).ok, false);
});

test("a name where every step already stands says there is nothing left to send", () => {
  const plan = planBusiness(request({
    existing: { addr: PAYOUT, lineage: { [BUSINESS_NODE]: true, [TERMINALS_NODE]: true, [REGISTER_NODE]: true }, registerStatus: ACTIVE },
  }));
  assert.equal(plan.ok, false);
  assert.equal(plan.steps.length, 0);
  assert.match(plan.refusal, /already set up on this network/);
  assert.equal(plan.skipped.length, 5, "and it says which five steps it found");
});

test("control: a payout record that could not be READ is refused too, and never treated as free", () => {
  // An unread name and a free name differ by one character in this object. Refusing only the
  // recorded case would leave the dangerous one — a read that failed — planning a write.
  for (const unread of [null, undefined, "", "0x", "not-an-address"]) {
    const plan = planBusiness(request({ existing: { addr: unread, lineage: {}, registerStatus: "" } }));
    assert.equal(plan.ok, false, `an addr of ${JSON.stringify(unread)} must not plan anything`);
    assert.match(plan.refusal, /could not be read/);
  }
});

// ---- the rest of the refusals ---------------------------------------------------------------------

test("the label rule is the contract's rule, and a name that breaks it plans nothing", () => {
  for (const bad of ["", "ab", "-leading", "trailing-", "Upper", "two--hyphens", "a".repeat(33)]) {
    assert.equal(isValidLabelLocal(bad), false, `${bad} is not a valid label`);
    const plan = planBusiness(request({ label: bad }));
    assert.equal(plan.ok, false);
    assert.equal(plan.refusal, LABEL_RULE_SENTENCE);
  }
  assert.equal(planBusiness(request({ label: "a-b" })).ok, true);
});

test("a register name that breaks the label rule is refused, and says it is the register", () => {
  const plan = planBusiness(request({ registerLabel: "Chair 1" }));
  assert.equal(plan.ok, false);
  assert.match(plan.refusal, /^Give the first register a name\./);
  assert.equal(planBusiness(request({ registerLabel: "chair-1" })).ok, true);
});

test("a payout that is not a wallet, or is the empty address, plans nothing", () => {
  assert.match(planBusiness(request({ payout: "0x123" })).refusal, /full address starting with 0x/);
  assert.match(planBusiness(request({ payout: ZERO })).refusal, /cannot be the empty address/);
  assert.equal(planBusiness(request({ payout: PAYOUT })).ok, true);
});

test("a network whose settings do not say where names are kept plans nothing", () => {
  for (const over of [{ resolver: null }, { authority: null }, { parentNode: null }, { terminalStatusKey: "" }, { parentNode: "0x1234" }]) {
    const plan = planBusiness(request(over));
    assert.equal(plan.ok, false, `${JSON.stringify(over)} must refuse`);
    assert.match(plan.refusal, /do not say where business names are kept/);
  }
  assert.equal(planBusiness(request()).ok, true);
});

test("planBusiness called with nothing at all refuses rather than throwing", () => {
  const plan = planBusiness();
  assert.equal(plan.ok, false);
  assert.equal(plan.steps.length, 0);
});

// ---- the sentences a person reads -----------------------------------------------------------------

test("a step's sentence names the step and asks for one confirmation", () => {
  const plan = planBusiness(request());
  assert.equal(
    stepSentence(plan.steps[0], 1, plan.steps.length),
    "Step 1 of 5: Send payments for sunrise-bakes.unica.eth to the wallet you chose. Confirm in your wallet.",
  );
});

test("nothing a person reads on this screen carries a machine word", () => {
  // The same dictionary tests/parity.test.mjs enforces on the built pages, applied to the sentences
  // this module puts into them — which parity cannot see, because they arrive after the page loads.
  const MACHINE_WORDS = /\b(hook|executor|registry|pool|tick|feed|calldata|hex)s?\b/i;
  const plan = planBusiness(request({ existing: { addr: ZERO, lineage: { [BUSINESS_NODE]: true }, registerStatus: ACTIVE } }));
  const said = [plan.sentence, ...plan.steps.map((s) => s.sentence), ...plan.skipped.map((s) => s.sentence)];
  for (const sentence of said) assert.equal(MACHINE_WORDS.test(sentence), false, sentence);
  assert.equal(MACHINE_WORDS.test("the executor did it"), true, "control: the dictionary still fires");
});

// ---- reading the chain, against a session that answers from a table --------------------------------

function fakeSession(answers, { failOn = [] } = {}) {
  const seen = [];
  return {
    seen,
    address: PAYOUT,
    async call(tx) {
      seen.push(tx.data);
      for (const prefix of failOn) if (tx.data.startsWith(prefix)) throw new Error("this node refused");
      const hit = Object.entries(answers).find(([prefix]) => tx.data.startsWith(prefix));
      return hit ? hit[1] : "0x";
    },
  };
}

const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const TRUE_WORD = "0x" + word("1");
const FALSE_WORD = "0x" + word("0");
const ADDR_ANSWER = "0x" + word(PAYOUT.slice(2).toLowerCase());
// abi.encode("active") as a single returned string: offset word, length word, then the bytes.
const ACTIVE_ANSWER = "0x" + word("20") + word("6") + Buffer.from(ACTIVE, "utf8").toString("hex").padEnd(64, "0");

test("readNameState reads all three names and the register's published status", async () => {
  const nodes = nodesFor(PARENT_NODE, LABEL, DEFAULT_REGISTER_LABEL);
  const session = fakeSession({ "0xe25e25c4": TRUE_WORD, "0x3b3b57de": ADDR_ANSWER, "0x59d1d43c": ACTIVE_ANSWER });
  const state = await readNameState(session, { authority: AUTHORITY, nodes, terminalStatusKey: KEY });
  assert.equal(state.addr.toLowerCase(), PAYOUT.toLowerCase());
  assert.equal(state.registerStatus, ACTIVE);
  assert.deepEqual(Object.values(state.lineage), [true, true, true]);
  assert.equal(session.seen.length, 5, "three parentage reads, one payout read, one status read");
  assert.ok(session.seen.every((d) => typeof d === "string" && d.startsWith("0x")));
});

test("a free name reads back as the empty address and no parentage", async () => {
  const nodes = nodesFor(PARENT_NODE, LABEL, DEFAULT_REGISTER_LABEL);
  const session = fakeSession({ "0xe25e25c4": FALSE_WORD, "0x3b3b57de": "0x" + word("0"), "0x59d1d43c": "0x" + word("20") + word("0") });
  const state = await readNameState(session, { authority: AUTHORITY, nodes, terminalStatusKey: KEY });
  assert.equal(state.addr, ZERO);
  assert.deepEqual(Object.values(state.lineage), [false, false, false]);
  assert.equal(planBusiness(request({ existing: state })).steps.length, 5);
});

test("control: the two read failures fail in opposite directions", async () => {
  const nodes = nodesFor(PARENT_NODE, LABEL, DEFAULT_REGISTER_LABEL);
  // A payout read that fails must answer null, so the planner refuses...
  const noAddr = await readNameState(fakeSession({ "0xe25e25c4": FALSE_WORD }, { failOn: ["0x3b3b57de"] }), {
    authority: AUTHORITY, nodes, terminalStatusKey: KEY,
  });
  assert.equal(noAddr.addr, null);
  assert.equal(planBusiness(request({ existing: noAddr })).ok, false);
  // ...while a parentage read that fails answers false, which plans a row that changes nothing if
  // it was already there. Answering the other way round would be the unsafe pair.
  const noLineage = await readNameState(fakeSession({ "0x3b3b57de": "0x" + word("0") }, { failOn: ["0xe25e25c4"] }), {
    authority: AUTHORITY, nodes, terminalStatusKey: KEY,
  });
  assert.deepEqual(Object.values(noLineage.lineage), [false, false, false]);
  assert.equal(planBusiness(request({ existing: noLineage })).ok, true);
});

test("the operator's existing grant is read at that register's own status key, and only when asked", async () => {
  const nodes = nodesFor(PARENT_NODE, LABEL, DEFAULT_REGISTER_LABEL);
  const withOperator = fakeSession({ "0xd3bf89b1": TRUE_WORD, "0x3b3b57de": "0x" + word("0") });
  const state = await readNameState(withOperator, { authority: AUTHORITY, nodes, terminalStatusKey: KEY, operator: OPERATOR });
  assert.equal(state.grant, true);
  const asked = withOperator.seen.find((d) => d.startsWith("0xd3bf89b1"));
  assert.ok(asked.includes(REGISTER_STATUS_RESOURCE.slice(2)), "the per-key resource of this register");
  assert.ok(asked.includes(word(ROLE_SET_TEXT.toString(16))), "and the one role an operator is given");
  assert.equal(textResource(nodes.registerNode, KEY), REGISTER_STATUS_RESOURCE);
  // control: with no operator the question is not asked at all, and the answer is a no
  const without = fakeSession({ "0xd3bf89b1": TRUE_WORD, "0x3b3b57de": "0x" + word("0") });
  const plain = await readNameState(without, { authority: AUTHORITY, nodes, terminalStatusKey: KEY });
  assert.equal(plain.grant, false);
  assert.equal(without.seen.some((d) => d.startsWith("0xd3bf89b1")), false);
  // a read that fails plans the grant again, which changes nothing on chain
  const unread = await readNameState(fakeSession({ "0x3b3b57de": "0x" + word("0") }, { failOn: ["0xd3bf89b1"] }), { authority: AUTHORITY, nodes, terminalStatusKey: KEY, operator: OPERATOR });
  assert.equal(unread.grant, false);
});

test("every read goes to the name authority, never to the record store", async () => {
  const nodes = nodesFor(PARENT_NODE, LABEL, DEFAULT_REGISTER_LABEL);
  const to = [];
  await readNameState({ call: async (tx) => { to.push(tx.to); return "0x"; } }, { authority: AUTHORITY, nodes, terminalStatusKey: KEY });
  assert.deepEqual([...new Set(to)], [AUTHORITY]);
});

// ---- who the connected wallet is ------------------------------------------------------------------

const okJson = (body) => async () => ({ ok: true, json: async () => body });

test("the chain says who holds the name, and the answer is asked of the name authority", async () => {
  const session = fakeSession({ "0x969a5259": TRUE_WORD });
  const to = [];
  const watched = { ...session, call: async (tx) => { to.push(tx.to); return session.call(tx); } };
  const answer = await readController(watched, { authority: AUTHORITY, parentNode: PARENT_NODE, account: PAYOUT });
  assert.deepEqual(answer, { controller: true, reachable: true });
  assert.deepEqual(to, [AUTHORITY], "the question goes to the authority, not to a server");
  assert.ok(session.seen[0].startsWith("0x969a5259"), session.seen[0]);
  assert.ok(session.seen[0].includes(PARENT_NODE.slice(2)), "it asks about the parent name");
  assert.ok(session.seen[0].toLowerCase().includes(PAYOUT.slice(2).toLowerCase()), "and about this wallet");
});

test("control: not the holder and could not read are THREE answers with the yes, never two", async () => {
  // Folding the unread case into "no" is the mistake this separation exists to prevent: it sends
  // the holder of a name away to change a record by hand because something was restarting.
  const yes = await readController(fakeSession({ "0x969a5259": TRUE_WORD }), { authority: AUTHORITY, parentNode: PARENT_NODE, account: PAYOUT });
  const no = await readController(fakeSession({ "0x969a5259": FALSE_WORD }), { authority: AUTHORITY, parentNode: PARENT_NODE, account: PAYOUT });
  const unread = await readController(fakeSession({}, { failOn: ["0x969a5259"] }), { authority: AUTHORITY, parentNode: PARENT_NODE, account: PAYOUT });
  assert.deepEqual(yes, { controller: true, reachable: true });
  assert.deepEqual(no, { controller: false, reachable: true });
  assert.deepEqual(unread, { controller: false, reachable: false });
  // an empty answer is a node that answered nothing, which is unread and not a no
  const empty = await readController(fakeSession({}), { authority: AUTHORITY, parentNode: PARENT_NODE, account: PAYOUT });
  assert.deepEqual(empty, { controller: false, reachable: false });
  // and nothing is asked at all when the settings or the wallet are not there to ask about
  for (const over of [{ authority: null }, { parentNode: null }, { account: "0x1" }]) {
    const asked = [];
    const answer = await readController({ call: async (tx) => { asked.push(tx); return TRUE_WORD; } }, { authority: AUTHORITY, parentNode: PARENT_NODE, account: PAYOUT, ...over });
    assert.deepEqual(answer, { controller: false, reachable: false }, JSON.stringify(over));
    assert.equal(asked.length, 0, "a question that cannot be asked is not asked");
  }
});

test("the companion is asked for the list of businesses, and for nothing else", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, json: async () => ({ controller: true, parentName: PARENT_NAME, businesses: [{ label: "freshcuts" }] }) };
  };
  const listing = await readBusinesses({ parentName: PARENT_NAME }, PAYOUT, fetchImpl);
  assert.deepEqual(listing, { reachable: true, parentName: PARENT_NAME, businesses: [{ label: "freshcuts" }] });
  assert.equal("controller" in listing, false, "a server never gets to say who holds a name");
  assert.ok(seen[0].startsWith("/local/businesses?wallet="), seen[0]);
});

test("a list that did not arrive says so rather than answering an empty one", async () => {
  const unreachable = await readBusinesses({}, PAYOUT, async () => { throw new Error("no server"); });
  assert.deepEqual([unreachable.reachable, unreachable.businesses], [false, []]);
  const refused = await readBusinesses({}, PAYOUT, async () => ({ ok: false, json: async () => ({ businesses: [{ label: LABEL }] }) }));
  assert.deepEqual([refused.reachable, refused.businesses], [false, []], "a non-200 answer carries no list");
  const notAWallet = await readBusinesses({}, "0x1", okJson({ businesses: [{ label: LABEL }] }));
  assert.equal(notAWallet.reachable, false, "nothing is asked about a value that is not a wallet");
  // control: the reachable half is real — a served list comes back reachable
  assert.equal((await readBusinesses({}, PAYOUT, okJson({ businesses: [] }))).reachable, true);
});

test("a label already listed under the parent name is seen as taken, whatever its case", () => {
  const space = { businesses: [{ label: "freshcuts" }, { label: LABEL }] };
  assert.equal(labelTaken(space, LABEL), true);
  assert.equal(labelTaken(space, "SUNRISE-BAKES"), true);
  assert.equal(labelTaken(space, "nobody-here"), false);
  assert.equal(labelTaken(null, LABEL), false);
});

// ---- sending, step by step -------------------------------------------------------------------------

function sendingSession() {
  const sent = [];
  return {
    sent,
    async send(tx) {
      sent.push(tx);
      return "0x" + String(sent.length).padStart(64, "0"); // transaction hash
    },
  };
}

const receipts = (statuses) => {
  let n = 0;
  return async () => {
    const s = statuses[n++];
    return s === null ? null : { status: s };
  };
};

test("a plan is sent one step at a time, each to the address its step names", async () => {
  const plan = planBusiness(request());
  const session = sendingSession();
  const steps = [];
  const result = await sendPlan({ session, plan, waitFor: receipts([1, 1, 1, 1, 1]), onStep: (n, total, sentence) => steps.push(`${n}/${total} ${sentence}`) });
  assert.equal(result.steps, 5);
  assert.deepEqual(session.sent.map((t) => t.to), [RESOLVER, RESOLVER, AUTHORITY, AUTHORITY, AUTHORITY]);
  assert.deepEqual(session.sent.map((t) => t.data), plan.steps.map((s) => s.data));
  assert.equal(steps.length, 5);
  assert.ok(steps[0].startsWith("1/5 Step 1 of 5:"), steps[0]);
});

test("control: a declined step stops the sequence and names which one", async () => {
  const plan = planBusiness(request());
  const session = sendingSession();
  await assert.rejects(
    () => sendPlan({ session, plan, waitFor: receipts([1, 1, 0]) }),
    (e) => {
      assert.match(e.message, /^Step 3 of 5 /);
      assert.match(e.message, /declined by the network/);
      assert.match(e.message, /The 2 steps before it stand\./);
      return true;
    },
  );
  assert.equal(session.sent.length, 3, "nothing after the declined step was asked for");
});

test("a step that never confirms stops the sequence too, and says the wallet has it", async () => {
  const plan = planBusiness(request());
  const session = sendingSession();
  await assert.rejects(
    () => sendPlan({ session, plan, waitFor: receipts([null]) }),
    /^Error: Step 1 of 5 .*is not confirmed yet/s,
  );
  assert.equal(session.sent.length, 1);
});

test("a refused plan sends nothing at all", async () => {
  const plan = planBusiness(request({ existing: { addr: SOMEBODY_ELSE, lineage: {}, registerStatus: "" } }));
  const session = sendingSession();
  await assert.rejects(() => sendPlan({ session, plan, waitFor: receipts([1]) }), /already belongs to a business/);
  assert.equal(session.sent.length, 0);
});

// ---- the settings this flow reads out of the active deployment -------------------------------------

test("nameSettings reads the record store off the manifest and the rest off the answered settings", () => {
  const config = {
    identity: AUTHORITY,
    parentNode: PARENT_NODE,
    parentName: PARENT_NAME,
    terminalStatusKey: KEY,
    merchantOnboarding: null,
    manifest: { identity: { ensV2Resolver: RESOLVER, authority: AUTHORITY } },
  };
  assert.deepEqual(nameSettings(config), {
    resolver: RESOLVER,
    authority: AUTHORITY,
    parentNode: PARENT_NODE,
    parentName: PARENT_NAME,
    terminalStatusKey: KEY,
    selfServe: false,
  });
});

test("a network with a sign-up contract says so, and one with no settings answers nulls", () => {
  assert.equal(nameSettings({ merchantOnboarding: "0x5FbDB2315678afecb367f032d93F642f64180aa3" }).selfServe, true);
  const empty = nameSettings({});
  assert.equal(empty.resolver, null);
  assert.equal(empty.authority, null);
  assert.equal(empty.terminalStatusKey, "com.unica.terminal-status");
});

test("the Sepolia manifest in this repository carries what this flow needs", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "deployments", "unica-v4", "11155111.json"), "utf8"));
  const settings = nameSettings({ manifest, identity: manifest.identity.authority, parentNode: manifest.identity.parentNode, parentName: manifest.identity.parentName, terminalStatusKey: manifest.identity.terminalStatusKey });
  assert.equal(settings.resolver, RESOLVER);
  assert.equal(settings.authority, AUTHORITY);
  assert.equal(settings.parentNode, PARENT_NODE);
  assert.equal(settings.parentName, PARENT_NAME);
  assert.equal(settings.selfServe, false, "Sepolia has no sign-up contract, which is why this flow exists");
});

// ---- wiring: the screen reaches this module, and the page has somewhere to put it ------------------

test("the join screen loads this planner, and not in a way that makes a cycle", () => {
  const screen = readFileSync(join(HERE, "..", "assets", "local-join.js"), "utf8");
  assert.ok(screen.includes('import("./join-sepolia.js")'), "the screen loads the planner on the network that needs it");
  assert.equal(/^import[^(]*join-sepolia/m.test(screen), false, "a static import here would be a cycle: the planner imports this file");
});

test("the screen takes the branch only on a network with a name but no sign-up contract", () => {
  const screen = readFileSync(join(HERE, "..", "assets", "local-join.js"), "utf8");
  assert.match(screen, /if \(!onboarding && identity && config\.parentNode\) \{/);
  // control: the self-serve path must still exist for the network that has one, or this branch
  // would have replaced the flow rather than joined it.
  assert.match(screen, /encodeCall\("join\(string,address,string\)"/);
});

test("the join route carries every control this flow drives", () => {
  const route = readFileSync(join(HERE, "..", "src", "routes", "join.mjs"), "utf8");
  const screen = readFileSync(join(HERE, "..", "assets", "local-join.js"), "utf8");
  for (const id of ["join-self", "join-name", "name-parent", "name-connect", "name-label", "name-payout", "name-register", "name-register-hint", "name-operator", "name-operator-hint", "name-free", "name-plan", "name-plan-said", "name-submit", "name-why", "join-status", "name-said"]) {
    assert.ok(route.includes(`"${id}"`), `the route has no ${id}`);
    assert.ok(screen.includes(`"${id}"`), `the screen never touches ${id}`);
  }
  // control: an id the screen does not drive is not in the route either, so the row above is
  // asserting a real pairing rather than matching any string that happens to appear twice.
  assert.equal(route.includes('"name-nonexistent"'), false);
});

test("the page a person is sent can only fail somewhere they can read it", () => {
  // The page-level status region is where main() writes anything that went wrong before either flow
  // starts, and the Sepolia branch hides the self-serve block first. A status region INSIDE that
  // block is a failure nobody sees, which is why this asserts the built document's structure
  // rather than the route's source.
  const page = builtJoinPage();
  const selfServe = page.slice(page.indexOf('id="join-self"'), page.indexOf('id="join-name"'));
  assert.ok(page.includes('id="join-status"'), "the built page has a page-level status region");
  assert.equal(selfServe.includes('id="join-status"'), false, "and it is not inside the block the other flow hides");
  // control: the slice really does contain that block's own controls, so the row above is looking
  // at the right part of the document.
  assert.ok(selfServe.includes('id="join-submit"'), "the slice is the self-serve block");
});

// The self-serve lead promises a single wallet confirmation. On a network that adds businesses to a
// held name, that block is hidden and the flow asks for one transaction per step, so the promise
// may only be made inside the block that keeps it. Outside it, it sits above a sentence saying the
// opposite, and in the page's link preview it is shown to a person before they have read either.
const ONE_CONFIRMATION = /confirm once|one (?:wallet )?confirmation/i;
const promisedOutsideSelfServe = (html) => {
  const start = html.indexOf('id="join-self"');
  const end = html.indexOf('id="join-name"');
  if (start < 0 || end <= start) return null;
  return ONE_CONFIRMATION.test(html.slice(0, start) + html.slice(end));
};

test("the one-confirmation promise is made only inside the flow that keeps it", () => {
  const page = builtJoinPage();
  assert.equal(promisedOutsideSelfServe(page), false, "no one-confirmation promise outside the self-serve block, preview included");
  const selfServe = page.slice(page.indexOf('id="join-self"'), page.indexOf('id="join-name"'));
  assert.ok(ONE_CONFIRMATION.test(selfServe), "the promise is still made to the flow it describes, not deleted");
  // control: the same promise planted above the block must be caught, or the row above proves nothing.
  const planted = page.replace('<div id="join-self"', '<p>Your wallet asks you to confirm once.</p><div id="join-self"');
  assert.notEqual(planted, page, "the plant landed");
  assert.equal(promisedOutsideSelfServe(planted), true, "a promise above the block is detected");
});

test("the plan list says what it waits for: the wallet that holds the name, then a name", () => {
  // The list is built only once a connected wallet is shown to hold the name and a name is typed.
  // The screen writes its fallback back into the region the page served, so the two must be one
  // sentence, or the words would change under a person halfway through reading them.
  const route = readFileSync(join(HERE, "..", "src", "routes", "join.mjs"), "utf8");
  const screen = readFileSync(join(HERE, "..", "assets", "local-join.js"), "utf8");
  const served = route.match(/statusRegion\("name-plan-said", "([^"]+)"\)/)?.[1] ?? null;
  const fallback = screen.match(/say\("name-plan-said", plan\?\.refusal \?\? "([^"]+)"\)/)?.[1] ?? null;
  assert.ok(served && fallback, "both the served sentence and the screen's fallback were found");
  assert.equal(fallback, served, "the screen falls back to exactly what the page served");
  const waitsForWallet = (sentence) => /wallet that holds the name/i.test(sentence);
  assert.equal(waitsForWallet(served), true, "the sentence names the wallet the list waits for");
  // control: the wording this replaced promised the list on a typed name alone.
  assert.equal(waitsForWallet("The list is read from the network once a name is typed."), false);
});

test("the second flow never reuses the first flow's ids", () => {
  // Two forms in one document sharing an id is a form that writes into the other one's field. This
  // reads the BUILT page: ids reached through a component never appear as id="..." in the route
  // source, so scraping the source would leave every one of them unwatched.
  const page = builtJoinPage();
  assert.deepEqual(duplicateIds(page), [], "an id appears more than once in the built page");
  const ids = idsOf(page);
  assert.ok(ids.includes("name-label") && ids.includes("business-name"), "both flows have their own name field");
  assert.ok(ids.includes("name-plan-said"), "an id a component emitted is among the ones being watched");
  // control: plant a duplicate of an id the components emit, and the detector must go red on it.
  const planted = page.replace('id="name-why"', 'id="name-plan-said"');
  assert.deepEqual(duplicateIds(planted), ["name-plan-said"], "the detector is watching component ids too");
});

test("the planner sends to two addresses and reads from one, as the module says it does", () => {
  const plan = planBusiness(request());
  assert.deepEqual([...new Set(plan.steps.filter((s) => s.where === "records").map((s) => s.to))], [RESOLVER]);
  assert.deepEqual([...new Set(plan.steps.filter((s) => s.where === "names").map((s) => s.to))], [AUTHORITY]);
  assert.equal(plan.steps.every((s) => s.where === "records" || s.where === "names"), true);
});
