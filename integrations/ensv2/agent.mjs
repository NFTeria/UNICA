// THE AGENT — what a delegated program may do, proven against the live chain rather than asserted.
//
//   node integrations/ensv2/agent.mjs            # simulate every action against Sepolia
//   node integrations/ensv2/agent.mjs --json     # the same, as data
//
// WHY THIS FILE BROADCASTS NOTHING. The interesting claim about a delegated agent is not that it
// can act — anything with a key can act. It is that it can act on EXACTLY ONE THING and is refused
// everywhere else, and that claim is answered by `eth_call` from the agent's address against the
// deployed resolver. Every row below is a real call to a real contract at a real address; what is
// simulated is only whether the transaction would be mined, which is precisely the question.
//
// A broadcast would demonstrate the allowed row and could never demonstrate the refused ones,
// because a refused transaction is one that does not exist. So the refusals are the evidence, and
// they are only reachable this way.
//
// THE CONTROL COMES FIRST. A run where the allowed action is accepted proves nothing on its own —
// a resolver that accepts everything would look identical. So the same allowed call is also sent
// from an address holding no roles at all, and it MUST be refused. If that row ever passes, this
// tool is measuring nothing and says so instead of printing a green table.

const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

export const AGENT_TARGETS = {
  resolver: "0x3D2d26801632e7b13B2fa75236a634e75684988c",
  agent: "0x19E56831a10d43CfF5d77f886c799C6b916da7Ae",
  // An address that holds nothing anywhere. The control's caller, and nothing else.
  stranger: "0x000000000000000000000000000000000000dEaD",
};

// Namehashes of the three names this delegation touches, and the resources they resolve to.
// Each is derived in script/ensv2/plan.mjs and recomputable from the name alone.
export const NODES = {
  pay: "0xbed6d7078442c8974d1a79821b57e17b72191463f06ff6b27b65b17c6c801320",      // namehash pay.merchant.unica.eth
  treasury: "0x6bf658fbbf8fa7aa86872bb0288a0c5e46f78af9a5b11a64b28be8425af09e31", // namehash treasury.merchant.unica.eth
  agent: "0xc8747dad833b68df5a03ef4cf56f74a412be889cff223422340e32245f1aeb94",    // namehash agent.treasury.merchant.unica.eth
};
export const RESOURCES = {
  perKey: "0x9b289d4e553d53cae7128b89eba6a145403bcf03abd52b51158be2191e070e6f", // resource: agent leaf + "unica:capabilities"
  agentName: "0x1ab7299e2f7f2c26e85bcf47365146b44828be79be8035d32737f9403ab755e8", // resource: the same leaf, name level
  pay: "0xa4c00ea601a909af0e73a924061b704d33112b787811b8e4ed0c700e1ad479a2",      // resource: pay.merchant.unica.eth
  treasury: "0xa2e887e22a2c97e23063332f613bb9718303d0875d82f3efa9c97918317d3a77", // resource: treasury.merchant.unica.eth
  root: "0x0000000000000000000000000000000000000000000000000000000000000000", // resource: ROOT_RESOURCE — the agent must hold nothing here
};

// Each computed with `cast sig`, pinned beside its signature. A hand-typed selector fails as an
// empty return rather than as an error, which is the worst way for a check to be wrong.
const SEL = {
  setText: "0x10f13a8c", // setText(bytes32,string,string)
  setAddr: "0xd5fa2b00", // setAddr(bytes32,address)
  roles: "0x5adf4724",   // roles(uint256,address)
};

// ── the smallest ABI encoder this file needs ──────────────────────────────────────────────────
const w = (hex) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const wAddr = (a) => w(a);
const utf8 = (s) => new TextEncoder().encode(s);
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const dynStr = (s) => {
  const b = utf8(s);
  const body = hexOf(b).padEnd(Math.ceil(b.length / 32) * 64, "0");
  return w(b.length.toString(16)) + (body || "");
};

/// setText(node, key, value) — two dynamic arguments, so two offsets then two blocks.
function encodeSetText(node, key, value) {
  const k = dynStr(key), v = dynStr(value);
  const offKey = 0x60;                       // three head words
  const offVal = offKey + k.length / 2;
  return SEL.setText + w(node) + w(offKey.toString(16)) + w(offVal.toString(16)) + k + v;
}
const encodeSetAddr = (node, addr) => SEL.setAddr + w(node) + wAddr(addr);
const encodeRoles = (resource, account) => SEL.roles + w(resource) + wAddr(account);

async function call(method, params) {
  const r = await fetch(RPC, {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  return r.json();
}

/// Returns {accepted, revertData, reason}. A revert is an ANSWER here, not a failure, so it is
/// returned rather than thrown — the caller decides which outcome each row was supposed to have.
async function simulate(from, data) {
  const j = await call("eth_call", [{from, to: AGENT_TARGETS.resolver, data}, "latest"]);
  if (j.error) {
    const d = j.error.data ?? "";
    const sel = typeof d === "string" && d.startsWith("0x") ? d.slice(0, 10) : null;
    return {accepted: false, revertData: typeof d === "string" ? d : null, selector: sel,
            reason: j.error.message ?? "reverted"};
  }
  return {accepted: true, revertData: null, selector: null, reason: null};
}

const ERROR_NAME = {
  "0x4b27a133": "EACUnauthorizedAccountRoles",
  "0xd1a3b355": "EACCannotGrantRoles",
};

/// Decode the three arguments an EACUnauthorizedAccountRoles revert carries, so a refusal can be
/// checked for naming the RIGHT resource rather than merely for being a refusal. "It reverted" and
/// "it reverted about the resource we expected" are different assertions, and only the second one
/// distinguishes a working scope from a broken address.
function decodeRefusal(data) {
  if (typeof data !== "string" || data.length < 10 + 192) return null;
  const b = data.slice(10);
  return {resource: "0x" + b.slice(0, 64), roleBitmap: "0x" + b.slice(64, 128),
          account: "0x" + b.slice(128 + 24, 192)};
}

export async function runAgent() {
  const {agent, stranger} = AGENT_TARGETS;
  const allowed = encodeSetText(NODES.agent, "unica:capabilities", "quote,receipt,settle");

  const rows = [];
  const add = (o) => { rows.push(o); return o; };

  // ── THE CONTROL, first. The allowed call, from an address holding nothing. It MUST be refused.
  // If it is not, the resolver is accepting anything and every row below is meaningless.
  const ctl = await simulate(stranger, allowed);
  add({
    kind: "control", name: "the agent's own call, sent by an address holding nothing",
    expected: "REFUSED", got: ctl.accepted ? "ACCEPTED" : "REFUSED",
    ok: !ctl.accepted, error: ERROR_NAME[ctl.selector] ?? ctl.selector,
    why: "without this row an acceptance proves only that the calldata is well formed",
  });

  // ── the one thing the agent may do.
  const a = await simulate(agent, allowed);
  add({
    kind: "allowed", name: 'setText(agent leaf, "unica:capabilities")',
    expected: "ACCEPTED", got: a.accepted ? "ACCEPTED" : "REFUSED",
    ok: a.accepted, error: ERROR_NAME[a.selector] ?? a.selector,
    why: "the single key the delegation scoped to",
  });

  // ── everything it may not. Each one is a thing a compromised agent would try first.
  const denials = [
    {name: "setAddr(pay.merchant…) — move the money", data: encodeSetAddr(NODES.pay, agent),
     resource: RESOURCES.pay, why: "the payment recipient. The whole point of the scope"},
    {name: 'setText(treasury…, "unica:policy-commitment")',
     data: encodeSetText(NODES.treasury, "unica:policy-commitment", "0x" + "00".repeat(32)),
     resource: RESOURCES.treasury, why: "rewriting the committed policy"},
    {name: 'setText(agent leaf, "unica:agent") — a DIFFERENT key on its OWN name',
     data: encodeSetText(NODES.agent, "unica:agent", "somebody.else.eth"),
     resource: RESOURCES.agentName, why: "the scope is per KEY, not per name — this is the row that proves it"},
    {name: "setAddr(agent leaf) — its own address record",
     data: encodeSetAddr(NODES.agent, stranger),
     resource: RESOURCES.agentName, why: "a different role (SET_ADDR) on the name it can write text at"},
  ];
  for (const d of denials) {
    const r = await simulate(agent, d.data);
    const named = r.revertData ? decodeRefusal(r.revertData) : null;
    const rightResource = named && named.resource.toLowerCase() === d.resource.toLowerCase();
    add({
      kind: "denied", name: d.name, expected: "REFUSED",
      got: r.accepted ? "ACCEPTED" : "REFUSED",
      ok: !r.accepted && rightResource,
      error: ERROR_NAME[r.selector] ?? r.selector,
      namesResource: named ? named.resource : null,
      expectedResource: d.resource,
      why: d.why,
    });
  }

  // ── and the authority itself, read rather than inferred.
  const roleWords = {};
  for (const [k, resource] of Object.entries(RESOURCES)) {
    const j = await call("eth_call", [{to: AGENT_TARGETS.resolver, data: encodeRoles(resource, agent)}, "latest"]);
    roleWords[k] = j.error ? null : BigInt(j.result).toString();
  }

  const controlOk = rows.find((r) => r.kind === "control")?.ok === true;
  return {
    ok: controlOk && rows.every((r) => r.ok),
    controlOk, rows, roleWords,
    // Said explicitly, because a tool that quietly measures nothing is worse than one that fails.
    verdict: !controlOk
      ? "THE CONTROL FAILED — the resolver accepted a call from an address holding nothing, so no row here means anything"
      : rows.every((r) => r.ok)
        ? "the agent may write one text key and is refused everywhere else"
        : "at least one row did not behave as the delegation says it should",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = process.argv.includes("--json");
  runAgent().then((res) => {
    if (json) { console.log(JSON.stringify(res, null, 2)); process.exit(res.ok ? 0 : 1); }
    console.log(`\nUNICA agent — simulated against Ethereum Sepolia, resolver ${AGENT_TARGETS.resolver}`);
    console.log(`agent ${AGENT_TARGETS.agent}\n`);
    for (const r of res.rows) {
      const mark = r.ok ? "PASS" : "FAIL";
      const tag = r.kind === "control" ? "CONTROL" : r.kind === "allowed" ? "ALLOWED" : "DENIED ";
      console.log(`${mark}  ${tag}  ${r.name}`);
      console.log(`            expected ${r.expected}, got ${r.got}${r.error ? ` (${r.error})` : ""}`);
      if (r.kind === "denied" && r.namesResource) {
        const same = r.namesResource.toLowerCase() === r.expectedResource.toLowerCase();
        console.log(`            the refusal names ${r.namesResource}${same ? " — the resource expected" : " — NOT the resource expected"}`);
      }
      console.log(`            ${r.why}`);
    }
    console.log("\nrole words read from the resolver:");
    for (const [k, v] of Object.entries(res.roleWords)) console.log(`  ${k.padEnd(10)} ${v}`);
    console.log(`\nrows: ${res.rows.length}, passed: ${res.rows.filter((r) => r.ok).length}, failed: ${res.rows.filter((r) => !r.ok).length}`);
    console.log(res.verdict);
    process.exit(res.ok ? 0 : 1);
  }).catch((e) => { console.error("the run did not complete:", e.message); process.exit(1); });
}
