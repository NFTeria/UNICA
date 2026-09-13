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

import {
  ACTIVE,
  DEFAULT_REGISTER_LABEL,
  SIGNATURES,
  TERMINALS_LABEL,
  labelTaken,
  nameSettings,
  nodesFor,
  planBusiness,
  readNameState,
  readNamespace,
  sendPlan,
  stepSentence,
} from "../assets/join-sepolia.js";
import { LABEL_RULE_SENTENCE, isValidLabelLocal } from "../assets/local-join.js";
import { selectorOf } from "../assets/abi.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

// ---- the fixed points, from cast ----------------------------------------------------------------

const RESOLVER = "0x3D2d26801632e7b13B2fa75236a634e75684988c"; // the record store, deployments/unica-v4/11155111.json identity.ensV2Resolver
const AUTHORITY = "0xB3aCbD101b026669A5b61DBbcD13d5CAe1c8f133"; // the name authority, same manifest, identity.authority
const PAYOUT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
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

const ZERO = "0x0000000000000000000000000000000000000000";

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

test("control: a name that already has a payout record is refused, and a free one is not", () => {
  // Delete the payout-record guard from planBusiness and this half goes green-with-five-steps:
  // the screen would then plan setAddr over another business's payout wallet, which is the one
  // mistake in this flow that moves somebody else's money.
  const taken = planBusiness(request({ existing: { addr: PAYOUT, lineage: {}, registerStatus: "" } }));
  assert.equal(taken.ok, false);
  assert.equal(taken.steps.length, 0);
  assert.match(taken.refusal, /sunrise-bakes\.unica\.eth already belongs to a business/);
  // ...and the accepting half, on the same request with the same everything but a free name.
  const free = planBusiness(request({ existing: { addr: ZERO, lineage: {}, registerStatus: "" } }));
  assert.equal(free.ok, true);
  assert.equal(free.steps.length, 5);
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

test("every read goes to the name authority, never to the record store", async () => {
  const nodes = nodesFor(PARENT_NODE, LABEL, DEFAULT_REGISTER_LABEL);
  const to = [];
  await readNameState({ call: async (tx) => { to.push(tx.to); return "0x"; } }, { authority: AUTHORITY, nodes, terminalStatusKey: KEY });
  assert.deepEqual([...new Set(to)], [AUTHORITY]);
});

// ---- who the connected wallet is ------------------------------------------------------------------

const okJson = (body) => async () => ({ ok: true, json: async () => body });

test("the controller is recognised even when the parent name lists no business yet", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, json: async () => ({ controller: true, parentName: PARENT_NAME, businesses: [] }) };
  };
  const space = await readNamespace({ parentName: PARENT_NAME }, PAYOUT, fetchImpl);
  assert.equal(space.controller, true);
  assert.equal(space.reachable, true);
  assert.deepEqual(space.businesses, []);
  assert.ok(seen[0].startsWith("/local/businesses?wallet="), seen[0]);
});

test("a wallet that is not the controller, and a server that did not answer, are different answers", async () => {
  const notController = await readNamespace({}, PAYOUT, okJson({ controller: false, businesses: [] }));
  assert.deepEqual([notController.controller, notController.reachable], [false, true]);
  const unreachable = await readNamespace({}, PAYOUT, async () => { throw new Error("no server"); });
  assert.deepEqual([unreachable.controller, unreachable.reachable], [false, false]);
  const refused = await readNamespace({}, PAYOUT, async () => ({ ok: false, json: async () => ({ controller: true }) }));
  assert.equal(refused.controller, false, "a non-200 answer is never read as a yes");
  const notAWallet = await readNamespace({}, "0x1", okJson({ controller: true }));
  assert.equal(notAWallet.controller, false, "nothing is asked about a value that is not a wallet");
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
  const plan = planBusiness(request({ existing: { addr: PAYOUT, lineage: {}, registerStatus: "" } }));
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

test("the planner sends to two addresses and reads from one, as the module says it does", () => {
  const plan = planBusiness(request());
  assert.deepEqual([...new Set(plan.steps.filter((s) => s.where === "records").map((s) => s.to))], [RESOLVER]);
  assert.deepEqual([...new Set(plan.steps.filter((s) => s.where === "names").map((s) => s.to))], [AUTHORITY]);
  assert.equal(plan.steps.every((s) => s.where === "records" || s.where === "names"), true);
});
