/**
 * Adding a business to a name that has no sign-up contract — the plan, and nothing else.
 *
 * WHY THIS FILE EXISTS. On the local testnet a business signs itself up: one call to the onboarding
 * contract makes the name, the payout record, the `terminals` branch, the first register and the
 * badge, all or none, and `local-join.js` sends it. Ethereum Sepolia has no such contract. There,
 * every business is a subname of one name, and the records under that name may only be written by
 * the account the name's own access control says may write them. So the same screen, on that
 * network, does not send ONE transaction — it plans a SEQUENCE, and the person who holds the name
 * signs each one in their own wallet.
 *
 * WHAT THE SEQUENCE IS, AND WHY IT IS IN THAT ORDER.
 *
 *   1. the payout record on the business's own name — `setAddr(bytes32,address)`
 *   2. the first register's status, set to "active"  — `setText(bytes32,string,string)`
 *   3. the business under the parent name            — `registerLineage(bytes32,string)`
 *   4. the `terminals` branch under the business     — `registerLineage(bytes32,string)`
 *   5. the first register under `terminals`          — `registerLineage(bytes32,string)`
 *
 * and one more, only when the person names an operator wallet for that first register:
 *
 *   6. that wallet may write the register's status  — `authorizeTextRoles(bytes,string,address,bool)`
 *
 * It is sent between the two record writes and the parentage rows, because it is a record-store
 * write like them. Leave the field empty and it is not planned at all — and then the register can be
 * switched on and off only by the wallet that holds the name.
 *
 * Records first, parentage last, because those are what a reader of this name tree walks: a
 * business is listed by the parentage row that names it, so a business whose parentage lands BEFORE
 * its payout record would be listed for as long as it takes the person to confirm the next
 * transaction — listed, and unpayable. The other way round, an unfinished sequence is a name
 * nothing lists yet, which is what an unfinished sign-up should look like. This is the same order
 * `script/ensv2/freshcuts-plan.mjs` hands the owner to run by hand; this file is that plan, written
 * for the screen, and neither copies the other's bytes — both derive the same calls from the same
 * two contract sources.
 *
 * WRITES AND READS GO TO DIFFERENT ADDRESSES, ON PURPOSE. The two record calls are sent to the
 * record store the manifest names (`identity.ensV2Resolver`). The three parentage calls are sent to
 * the name authority (`identity.authority`), which is the contract that keeps parentage for a
 * subname the name tree itself does not register. Every READ in this file goes to the authority,
 * which forwards `addr` and `text` to the record store — so one address answers every question and
 * two addresses take the two kinds of write. Mixing them up would be a transaction that reverts,
 * which is why the step carries the address it is for rather than the screen choosing at send time.
 *
 * REGISTERING PARENTAGE TWICE IS NOT AN ERROR. `src/identity/EnsV2ResolverAuthority.sol`
 * `registerLineage` returns the same child and changes nothing when the row is already recorded and
 * agrees — it reverts only on a row that DISAGREES, which needs a keccak collision to reach, since
 * the child is derived from the pair being registered. So skipping a recorded row is a courtesy to
 * the person signing, never a correctness requirement, and a parentage read that fails is allowed
 * to plan the row anyway: the worst that costs is one redundant confirmation. A failed payout-record
 * read is NOT allowed to do the same — see `readNameState`.
 *
 * NOTHING HERE SENDS. `planBusiness` is pure: answers in, steps out, no chain, no clock, no DOM.
 * `sendPlan` is the only function that reaches a wallet, and it sends exactly the steps the plan
 * carries, in the plan's order, waiting for each receipt and stopping on the first one the network
 * declined.
 */
import { childNode, decodeAddress, decodeBool, decodeString, encodeCall, selectorOf, textResource } from "./abi.js";
import { LABEL_RULE_SENTENCE, ZERO_ADDRESS, isAddress, isValidLabelLocal, payNameFor } from "./local-join.js";
import { waitForReceipt } from "./wallet.js";

/** The exact signatures this file calls. Each selector is asserted against `cast sig` in the tests. */
export const SIGNATURES = Object.freeze({
  setAddr: "setAddr(bytes32,address)",
  setText: "setText(bytes32,string,string)",
  registerLineage: "registerLineage(bytes32,string)",
  addr: "addr(bytes32)",
  text: "text(bytes32,string)",
  lineageKnown: "lineageKnown(bytes32)",
  parentOf: "parentOf(bytes32)",
  isNamespaceController: "isNamespaceController(bytes32,address)",
  authorizeTextRoles: "authorizeTextRoles(bytes,string,address,bool)",
  hasRoles: "hasRoles(uint256,uint256,address)",
});

/**
 * The one role an operator wallet is given: permission to write THIS register's status key, at that
 * key's own resource, and nothing else. `src/identity/EnsV2ResolverAuthority.sol` names it
 * `ROLE_SET_TEXT = 1 << 4`; the same number is what the readback in `script/ensv2/freshcuts-plan.mjs`
 * asks `hasRoles` about.
 */
export const ROLE_SET_TEXT = 1 << 4;

/**
 * A name in the length-prefixed wire form `authorizeTextRoles` takes: each label preceded by its
 * length in one byte, the whole thing terminated by a zero byte. Written from that description —
 * `script/ensv2/freshcuts-plan.mjs` derives the same bytes for the same names and the tests compare
 * this against the vector that plan put on chain.
 */
export function dnsEncode(name) {
  const labels = String(name ?? "").split(".").filter((l) => l.length > 0);
  const bytes = [];
  for (const label of labels) {
    const utf8 = new TextEncoder().encode(label);
    if (utf8.length === 0 || utf8.length > 255) throw new Error(`a name label must be 1 to 255 bytes: ${label}`);
    bytes.push(utf8.length, ...utf8);
  }
  bytes.push(0);
  return "0x" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The branch every register of a business hangs under. Fixed by the admission contract, not a choice. */
export const TERMINALS_LABEL = "terminals";
/** What the first register is called when the person does not rename it. */
export const DEFAULT_REGISTER_LABEL = "chair-1";
/** The one status word that means a register may start a sale. */
export const ACTIVE = "active";
export const DEFAULT_STATUS_KEY = "com.unica.terminal-status";

const NODE32 = /^0x[0-9a-fA-F]{64}$/;
const lower = (v) => String(v ?? "").toLowerCase();

/**
 * Where this network keeps business names: the record store that takes the writes, the authority
 * that answers the reads and keeps parentage, the parent name every business hangs under, and the
 * key a register's status is published at. Every field is null when the active deployment does not
 * carry it, and `selfServe` is true on a network that has a sign-up contract — on which this whole
 * file is the wrong flow and the screen uses the one-button path instead.
 */
export function nameSettings(config) {
  const identity = config?.manifest?.identity ?? {};
  return {
    resolver: identity.ensV2Resolver ?? null,
    authority: config?.identity ?? identity.authority ?? null,
    parentNode: config?.parentNode ?? identity.parentNode ?? null,
    parentName: config?.parentName ?? identity.parentName ?? null,
    terminalStatusKey: config?.terminalStatusKey ?? identity.terminalStatusKey ?? DEFAULT_STATUS_KEY,
    selfServe: Boolean(config?.merchantOnboarding),
  };
}

/** The three names a new business occupies, derived the way the name tree derives them. */
export function nodesFor(parentNode, label, registerLabel) {
  const businessNode = childNode(parentNode, label);
  const terminalsNode = childNode(businessNode, TERMINALS_LABEL);
  return { businessNode, terminalsNode, registerNode: childNode(terminalsNode, registerLabel) };
}

function step(id, where, to, signature, args, sentence, expected) {
  return { id, where, to, signature, selector: selectorOf(signature), data: encodeCall(signature, args), sentence, expected };
}

/** "Step 2 of 5: ... Confirm in your wallet." — the one place a step's sentence is composed. */
export function stepSentence(s, n, total) {
  return `Step ${n} of ${total}: ${s.sentence} Confirm in your wallet.`;
}

const refuse = (refusal) => ({ ok: false, refusal, steps: [], skipped: [], sentence: refusal });

/**
 * The transactions that add one business, as a plan a person can read before anything is signed.
 *
 * `existing` is what the chain already says, from `readNameState`:
 *   { addr, lineage: { <node>: boolean }, registerStatus }
 * An `addr` that is not an address at all means the name could not be READ, which is refused rather
 * than assumed free — see below. Every other unknown is allowed to plan the step.
 */
export function planBusiness({
  label,
  payout,
  registerLabel = DEFAULT_REGISTER_LABEL,
  operator = null,
  parentNode,
  parentName,
  resolver,
  authority,
  terminalStatusKey,
  existing = {},
} = {}) {
  if (!isAddress(resolver) || !isAddress(authority) || !NODE32.test(String(parentNode ?? "")) || !String(terminalStatusKey ?? "")) {
    return refuse("This network's settings do not say where business names are kept, so nothing can be added from here.");
  }
  if (!isValidLabelLocal(label)) return refuse(LABEL_RULE_SENTENCE);
  if (!isValidLabelLocal(registerLabel)) return refuse(`Give the first register a name. ${LABEL_RULE_SENTENCE}`);
  if (!isAddress(payout)) return refuse("The payout wallet must be a full address starting with 0x.");
  if (lower(payout) === ZERO_ADDRESS) return refuse("Choose the wallet that gets paid. It cannot be the empty address.");
  const wantsOperator = String(operator ?? "").trim() !== "";
  if (wantsOperator && !isAddress(operator)) return refuse("The operator wallet must be a full address starting with 0x, or left empty.");
  if (wantsOperator && lower(operator) === ZERO_ADDRESS) return refuse("Leave the operator wallet empty rather than giving the empty address.");
  if (wantsOperator && !String(parentName ?? "")) return refuse("This network's settings do not name the parent, so an operator cannot be given a register to run.");

  const nodes = nodesFor(parentNode, label, registerLabel);
  const payName = payNameFor(label, parentName);

  // THE GUARD THIS FILE EXISTS AROUND. A business's payout record is the one record that says the
  // name is somebody's: the parent answers for its whole subtree, so an unused subname reads back
  // as the empty address without failing, and an address there means a business already lives here.
  // Overwriting it would move another business's money, which is why this refuses on a recorded
  // address AND refuses just as hard on a read that did not come back — an unread name and a free
  // one look identical to everything except this check.
  if (!isAddress(existing?.addr)) {
    return refuse("That name could not be read on this network just now, so nothing was planned. Try again in a moment.");
  }
  const payoutRecorded = lower(existing.addr) !== ZERO_ADDRESS;
  if (payoutRecorded && lower(existing.addr) !== lower(payout)) {
    return refuse(`${payName} already belongs to a business, so it cannot be added again. Choose another name.`);
  }

  // The recorded rows, keyed the one way this file compares names. `readNameState` already answers
  // in lower case; normalising here means a caller that does not cannot silently miss every row.
  const recordedRows = new Set(
    Object.entries(existing?.lineage ?? {}).filter(([, known]) => known === true).map(([node]) => lower(node)),
  );
  const recorded = (node) => recordedRows.has(lower(node));
  const steps = [];
  const skipped = [];

  // A payout record that is ALREADY the wallet on this screen is not another business — it is the
  // first step of a sequence that stopped part way, which is exactly what a retry has to be able to
  // carry on from. Anything else at that record is somebody's business and is refused above.
  if (payoutRecorded) {
    skipped.push({ id: "N1", sentence: `${payName} already pays out to that wallet, so that step is not needed.` });
  } else {
    steps.push(step("N1", "records", resolver, SIGNATURES.setAddr, [nodes.businessNode, payout],
      `Send payments for ${payName} to the wallet you chose.`,
      `${payName} pays out to ${payout}`));
  }

  if (lower(existing?.registerStatus) === ACTIVE) {
    skipped.push({ id: "N2", sentence: `"${registerLabel}" is already switched on, so that step is not needed.` });
  } else {
    steps.push(step("N2", "records", resolver, SIGNATURES.setText, [nodes.registerNode, terminalStatusKey, ACTIVE],
      `Switch the register "${registerLabel}" on.`,
      `${registerLabel}.${TERMINALS_LABEL}.${payName} is ${ACTIVE}`));
  }

  // The sixth transaction, and the only optional one. It gives ONE other wallet permission to write
  // THIS register's status key — the grant `script/ensv2/freshcuts-plan.mjs` made for the first
  // business's tablet — and nothing else: not the payout address, not any other key, not any other
  // register. Without it the register can be switched on and off only by the wallet that holds the
  // name. It is sent to the record store, because that is where the permission is kept.
  const registerName = `${registerLabel}.${TERMINALS_LABEL}.${payName}`;
  if (wantsOperator) {
    if (existing?.grant === true) {
      skipped.push({ id: "N6", sentence: `That wallet may already switch "${registerLabel}" on and off, so that step is not needed.` });
    } else {
      steps.push(step("N6", "records", resolver, SIGNATURES.authorizeTextRoles, [dnsEncode(registerName), terminalStatusKey, operator, true],
        `Let ${operator} switch the register "${registerLabel}" on and off.`,
        `${operator} may set the status of ${registerName} and nothing else`));
    }
  }

  const parentage = [
    ["N3", parentNode, label, nodes.businessNode, `List ${payName} under ${parentName ?? "the parent name"}.`, `${payName} is listed under ${parentName ?? "the parent name"}`, `${payName} is already listed, so that step is not needed.`],
    ["N4", nodes.businessNode, TERMINALS_LABEL, nodes.terminalsNode, `Open the place ${payName} keeps its registers.`, `${payName} has somewhere to keep registers`, `${payName} already has somewhere to keep registers, so that step is not needed.`],
    ["N5", nodes.terminalsNode, registerLabel, nodes.registerNode, `List "${registerLabel}" as a register of ${payName}.`, `${registerLabel} is a register of ${payName}`, `"${registerLabel}" is already listed as a register, so that step is not needed.`],
  ];
  for (const [id, parent, childLabel, child, sentence, expected, skipSentence] of parentage) {
    if (recorded(child)) skipped.push({ id, sentence: skipSentence });
    else steps.push(step(id, "names", authority, SIGNATURES.registerLineage, [parent, childLabel], sentence, expected));
  }

  if (steps.length === 0) {
    return { ok: false, refusal: `${payName} is already set up on this network, so there is nothing left to send.`, steps: [], skipped, sentence: `${payName} is already set up on this network, so there is nothing left to send.` };
  }

  return {
    ok: true,
    refusal: null,
    label,
    registerLabel,
    operator: wantsOperator ? operator : null,
    registerName,
    payName,
    payout,
    nodes,
    steps,
    skipped,
    sentence: steps.length === 1
      ? "Your wallet will ask you to confirm one transaction."
      : `Your wallet will ask you to confirm ${steps.length} transactions, one after another.`,
  };
}

/**
 * What the chain already says about the three names, read through the name authority — which
 * forwards the two record reads to the record store, so one address answers all four questions.
 *
 * THE TWO FAILURE DIRECTIONS ARE NOT THE SAME, and this function treats them differently on
 * purpose. A parentage read that fails answers `false`, which plans a row that changes nothing if
 * it was already there: the cost of being wrong is one redundant confirmation. A payout-record read
 * that fails answers `null`, NOT the empty address, because the empty address is what a free name
 * reads back as — answering it for a read that never happened would let a plan be made against a
 * name somebody else already uses. The planner refuses on `null`; it cannot refuse on a lie.
 */
export async function readNameState(session, { authority, nodes, terminalStatusKey, operator = null }) {
  const call = (signature, args) => session.call({ to: authority, data: encodeCall(signature, args) });
  const lineage = {};
  for (const node of [nodes.businessNode, nodes.terminalsNode, nodes.registerNode]) {
    try {
      lineage[lower(node)] = decodeBool(await call(SIGNATURES.lineageKnown, [node]));
    } catch {
      lineage[lower(node)] = false; // planning a recorded row again costs a confirmation, not correctness
    }
  }
  let addr = null;
  try {
    addr = decodeAddress(await call(SIGNATURES.addr, [nodes.businessNode]));
  } catch {
    addr = null; // unread, which the planner refuses; never the empty address, which means free
  }
  let registerStatus = null;
  try {
    registerStatus = decodeString(await call(SIGNATURES.text, [nodes.registerNode, terminalStatusKey]));
  } catch {
    registerStatus = null;
  }
  // The operator's grant, when there is an operator to ask about. It fails the forgiving way, like
  // parentage: a read that did not answer plans the grant again, and granting the same permission
  // twice changes nothing.
  let grant = false;
  if (isAddress(operator)) {
    try {
      grant = decodeBool(await call(SIGNATURES.hasRoles, [textResource(nodes.registerNode, terminalStatusKey), ROLE_SET_TEXT, operator]));
    } catch {
      grant = false;
    }
  }
  return { addr, lineage, registerStatus, grant };
}

/**
 * Whether this wallet may write the records under the parent name, asked of the CHAIN.
 *
 * `isNamespaceController(bytes32,address)` on the name authority is the same question the records
 * themselves answer at write time, so a yes here and a revert at the first confirmation cannot
 * disagree for any reason other than the chain changing underneath. It is deliberately not the
 * companion's answer: a server can be restarted, misconfigured, or pointed at another deployment,
 * and none of those are facts about who holds a name.
 *
 * THREE ANSWERS, AND THE THIRD IS NOT THE SECOND. `{ reachable: false }` is "the chain did not
 * answer", which is never folded into "not the holder" — a holder told they are not one would go
 * and change a record by hand for no reason.
 */
export async function readController(session, { authority, parentNode, account }) {
  if (!isAddress(authority) || !NODE32.test(String(parentNode ?? "")) || !isAddress(account)) {
    return { controller: false, reachable: false };
  }
  try {
    const answer = await session.call({ to: authority, data: encodeCall(SIGNATURES.isNamespaceController, [parentNode, account]) });
    if (typeof answer !== "string" || !/^0x[0-9a-fA-F]{64,}$/.test(answer)) return { controller: false, reachable: false };
    return { controller: decodeBool(answer), reachable: true };
  } catch {
    return { controller: false, reachable: false };
  }
}

/**
 * The businesses the parent name already lists, as the companion reads them from the chain.
 *
 * LISTING IS ALL IT IS ASKED. Whether this wallet may write the parent's records is a question for
 * the chain — `readController` — and not for a server: an endpoint that answers "you are the
 * holder" is a server claiming an authority it does not hold, and one that fails to answer would
 * otherwise read as "you are not". This function is about which labels are taken, which is a list,
 * and a list that did not arrive says so with `reachable`.
 */
export async function readBusinesses(config, wallet, fetchImpl = globalThis.fetch) {
  const settings = nameSettings(config);
  const blank = { reachable: false, parentName: settings.parentName, businesses: [] };
  if (!isAddress(wallet)) return blank;
  try {
    const res = await fetchImpl(`/local/businesses?wallet=${encodeURIComponent(wallet)}`);
    if (!res || !res.ok) return blank;
    const body = await res.json();
    return {
      reachable: true,
      parentName: body?.parentName ?? settings.parentName,
      businesses: Array.isArray(body?.businesses) ? body.businesses : [],
    };
  } catch {
    return blank;
  }
}

/**
 * Whether the parent name already lists this label. Trustworthy only for the holder of the name,
 * because the endpoint lists every business for them and only the asking wallet's own for anybody
 * else — and the holder is the only person this screen's flow is open to.
 */
export function labelTaken(listing, label) {
  return (listing?.businesses ?? []).some((b) => lower(b?.label) === lower(label));
}

/**
 * Send a plan, one transaction at a time, waiting for each receipt before asking for the next.
 *
 * `onStep(n, total, sentence, step)` runs BEFORE each wallet prompt, so a screen can say which
 * confirmation is being asked for. A step the network declined throws, naming that step and saying
 * what already stands — because the steps before it are on the chain and reloading is how the
 * person sees where they got to, not a retry of everything.
 */
export async function sendPlan({ session, plan, onStep = () => {}, waitFor = waitForReceipt }) {
  if (!plan?.ok) throw new Error(plan?.refusal ?? "There is nothing to send.");
  const total = plan.steps.length;
  const sent = [];
  for (let i = 0; i < total; i++) {
    const s = plan.steps[i];
    const n = i + 1;
    const before = n === 1 ? "Nothing before it was sent." : `The ${n - 1} step${n === 2 ? "" : "s"} before it stand.`;
    onStep(n, total, stepSentence(s, n, total), s);
    const hash = await session.send({ to: s.to, data: s.data });
    const receipt = await waitFor(session, hash);
    if (!receipt) throw new Error(`Step ${n} of ${total} (${s.sentence}) was sent but is not confirmed yet. Reload this page in a moment; your wallet has the transaction.`);
    if (Number(receipt.status) === 0) throw new Error(`Step ${n} of ${total} (${s.sentence}) was declined by the network. ${before}`);
    sent.push({ id: s.id, hash });
  }
  return { sent, steps: total };
}
