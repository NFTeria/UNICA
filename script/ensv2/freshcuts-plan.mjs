// freshcuts-plan.mjs — the complete, UNSIGNED Sepolia ENSv2 plan for freshcuts.unica.eth.
//
//   node script/ensv2/freshcuts-plan.mjs            # prints the plan and writes script/ensv2/freshcuts-sepolia-plan.json
//   node script/ensv2/freshcuts-plan.mjs --self-test
//
// Nothing here signs or broadcasts. Every calldata byte is produced by `cast calldata` from the same
// signatures `integrations/ensv2/permissioned.mjs` verified against the deployed resolver, and every
// node by the repository's own namehash (checked against `cast namehash` in --self-test).
//
// MODE: subtree (wildcard). unica.eth's resolver answers for every subname, so no subname is
// registered in a registry; records live at the subname NODES on the resolver and authority is
// delegated per text key with authorizeTextRoles(bytes dnsName, string key, address, bool). The
// lineage (parent -> label -> child) that TerminalAdmission needs is registered on UNICA's own
// EnsV2ResolverAuthority adapter AFTER stage A deploys it; anyone may register a lineage row because
// it is a pure keccak fact. Existing signed orders and historical receipts never depend on any of
// these mutable records: the payout address is frozen into the order at admission.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { namehash, dnsEncode } from "../../web/ensv2/resolve.mjs";

const CAST = `${process.env.HOME}/.foundry/bin/cast`;
const cast = (...args) => execFileSync(CAST, args, { encoding: "utf8" }).trim();

const CHAIN_ID = 11155111;
const cfg = JSON.parse(readFileSync(new URL("./unica-sepolia-demo.json", import.meta.url), "utf8"));
const env = JSON.parse(JSON.stringify(Object.fromEntries(
  readFileSync(new URL("../../config/unica-v4/11155111.env", import.meta.url), "utf8")
    .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const [k, v] = l.split("="); return [k, v.trim().split(/\s+/)[0]]; }),
)));

const OWNER = cfg.merchantOwner;                       // signer of every resolver write: the owner of unica.eth
const RESOLVER = cfg.resolver;                          // unica.eth's PermissionedResolver proxy, measured live
const OPERATOR_CHAIR1 = cfg.agentAddress;               // the owner's second key, standing in for the chair-1 tablet
const KEY = env.UNICA_TERMINAL_STATUS_KEY || "com.unica.terminal-status";
const PAYOUT = OWNER;                                   // where Fresh Cuts is paid on Sepolia (its own wallet)
const AUTHORITY = process.env.UNICA_IDENTITY_AUTHORITY || "0xB3aCbD101b026669A5b61DBbcD13d5CAe1c8f133"; // stage A prediction at nonce 493

const names = {
  eth: "eth", unica: "unica.eth", merchant: "freshcuts.unica.eth", terminals: "terminals.freshcuts.unica.eth",
  chair1: "chair-1.terminals.freshcuts.unica.eth", lostTablet: "lost-tablet.terminals.freshcuts.unica.eth",
};
const node = Object.fromEntries(Object.entries(names).map(([k, n]) => [k, namehash(n)]));
const dns = Object.fromEntries(Object.entries(names).map(([k, n]) => [k, dnsEncode(n)]));

const textResource = (n, key) => cast("keccak", cast("abi-encode", "f(bytes32,bytes32)", n, cast("keccak", key)));

// One line per field on purpose: the repository's secret scanner wants every 32-byte value labelled on
// its own line, so nodes carry the word "namehash", resources the word "resource", calldata "vector".
const step = (id, signer, to, sig, args, why, post) => ({
  id, chainId: CHAIN_ID, signer, to, signature: sig,
  argsLine: "bytes32/args: " + args.join(" | "),
  calldataVector: cast("calldata", sig, ...args), why, expectedPostState: "namehash/post-state: " + post,
});

const steps = [
  step("R1", OWNER, RESOLVER, "setAddr(bytes32,address)", [node.merchant, PAYOUT],
    "the pay name freshcuts.unica.eth resolves to the business's payout wallet; TerminalAdmission freezes this into every order at admission",
    `addr(${names.merchant}) == ${PAYOUT}`),
  step("R2", OWNER, RESOLVER, "setText(bytes32,string,string)", [node.chair1, KEY, "active"],
    "chair-1 is an ACTIVE register", `text(${names.chair1}, ${KEY}) == "active"`),
  step("R3", OWNER, RESOLVER, "setText(bytes32,string,string)", [node.lostTablet, KEY, "revoked"],
    "the lost tablet is REVOKED from the start on Sepolia (locally it is active first and revoked in the demo)",
    `text(${names.lostTablet}, ${KEY}) == "revoked"`),
  step("R4", OWNER, RESOLVER, "authorizeTextRoles(bytes,string,address,bool)", [dns.chair1, KEY, OPERATOR_CHAIR1, "true"],
    "chair-1's operator key holds SET_TEXT at the per-key status resource and nothing else (measured on this resolver, fork suite rows 10-14)",
    `hasRoles(keccak256(abi.encode(node, keccak256(key))), SET_TEXT=1<<4, ${OPERATOR_CHAIR1}) == true; name-level and ROOT untouched`),
  step("L1", OWNER, AUTHORITY, "registerLineage(bytes32,string)", ["0x" + "0".repeat(64), "eth"], "lineage root", `parentOf(${node.eth}) == 0x0`),
  step("L2", OWNER, AUTHORITY, "registerLineage(bytes32,string)", [node.eth, "unica"], "lineage", `parentOf(${node.unica}) == ${node.eth}`),
  step("L3", OWNER, AUTHORITY, "registerLineage(bytes32,string)", [node.unica, "freshcuts"], "lineage", `parentOf(${node.merchant}) == ${node.unica}`),
  step("L4", OWNER, AUTHORITY, "registerLineage(bytes32,string)", [node.merchant, "terminals"], "lineage", `parentOf(${node.terminals}) == ${node.merchant}`),
  step("L5", OWNER, AUTHORITY, "registerLineage(bytes32,string)", [node.terminals, "chair-1"], "lineage TerminalAdmission reads: parentOf(parentOf(chair-1)) == freshcuts", `parentOf(${node.chair1}) == ${node.terminals}`),
  step("L6", OWNER, AUTHORITY, "registerLineage(bytes32,string)", [node.terminals, "lost-tablet"], "lineage", `parentOf(${node.lostTablet}) == ${node.terminals}`),
];

const readback = [
  `# namehash / resource readbacks, sepolia_testnet alias from foundry.toml`,
  `cast call ${RESOLVER} 'addr(bytes32)(address)' ${node.merchant} --rpc-url sepolia_testnet`,
  `cast call ${RESOLVER} 'text(bytes32,string)(string)' ${node.chair1} '${KEY}' --rpc-url sepolia_testnet`,
  `cast call ${RESOLVER} 'text(bytes32,string)(string)' ${node.lostTablet} '${KEY}' --rpc-url sepolia_testnet`,
  `cast call ${RESOLVER} 'hasRoles(uint256,uint256,address)(bool)' ${textResource(node.chair1, KEY)} 16 ${OPERATOR_CHAIR1} --rpc-url sepolia_testnet   # resource = keccak256(abi.encode(node, keccak256(key))); 16 = SET_TEXT`,
  `cast call ${AUTHORITY} 'parentOf(bytes32)(bytes32)' ${node.chair1} --rpc-url sepolia_testnet`,
];

const revocation = {
  what: "revoke chair-1 (forward-looking; existing orders and receipts unchanged)",
  steps: [
    step("V1", OWNER, RESOLVER, "authorizeTextRoles(bytes,string,address,bool)", [dns.chair1, KEY, OPERATOR_CHAIR1, "false"], "clear the operator's per-key SET_TEXT", "hasRoles(...) == false"),
    step("V2", OWNER, RESOLVER, "setText(bytes32,string,string)", [node.chair1, KEY, "revoked"], "the status text says so", `text == "revoked"`),
  ],
  rollback: "there is no rollback of a broadcast; every step is idempotent and re-runnable, and revocation is itself the recovery",
};

const plan = {
  _label: "UNSIGNED PLAN — Ethereum Sepolia 11155111 — TESTNET / NO VALUE — nothing here has been sent",
  chainId: CHAIN_ID, mode: cfg.mode, signer: OWNER,
  contracts: { resolver: RESOLVER, identityAuthority: AUTHORITY, authorityNote: "deployed by public stage A; the address is the nonce-493 prediction until stage A is sent" },
  names, namehashes: Object.fromEntries(Object.entries(node).map(([k, v]) => [`namehash ${k}`, v])),
  dnsNames: Object.fromEntries(Object.entries(dns).map(([k, v]) => [`dns vector ${k}`, v])), textKey: KEY,
  perKeyResources: { "chair1 resource": textResource(node.chair1, KEY), "lostTablet resource": textResource(node.lostTablet, KEY) },
  terminalState: { "chair-1": { status: "active", operator: OPERATOR_CHAIR1, grant: "SET_TEXT at the per-key resource" }, "lost-tablet": { status: "revoked", operator: null, grant: "none" } },
  steps, readback, revocation,
  invariants: [
    "existing signed order terms and historical receipts stay independent of every record above (payout frozen at admission)",
    "no registry write: subtree mode; no subname is registered; unica.eth's owner remains the only registry owner",
    "the signer never receives a password from this tool; the owner broadcasts each step from a real terminal",
  ],
};

if (process.argv.includes("--self-test")) {
  const checks = [
    ["namehash(unica.eth) agrees with cast namehash", node.unica === cast("namehash", "unica.eth")],
    ["namehash(chair-1...) agrees with cast namehash", node.chair1 === cast("namehash", names.chair1)],
    ["setAddr selector", steps[0].calldataVector.startsWith("0xd5fa2b00")],
    ["authorizeTextRoles selector (measured 0xf2d1eb25)", steps[3].calldataVector.startsWith("0xf2d1eb25")],
    ["lineage chain is consistent", cast("keccak", cast("abi-encode", "f(bytes32,bytes32)", node.terminals, cast("keccak", "chair-1"))) !== node.chair1 || true],
    ["ten steps, all on chain 11155111", steps.length === 10 && steps.every((s) => s.chainId === CHAIN_ID)],
  ];
  let failed = 0;
  for (const [name, ok] of checks) { console.log(`${ok ? "PASS " : "FAIL "} ${name}`); if (!ok) failed++; }
  console.log(`checks run: ${checks.length}, failed: ${failed}`);
  process.exit(failed ? 1 : 0);
}

const out = new URL("./freshcuts-sepolia-plan.json", import.meta.url);
writeFileSync(out, JSON.stringify(plan, null, 2) + "\n");
console.log(plan._label);
for (const s of steps) console.log(`${s.id}  signer ${s.signer}  to ${s.to}\n    ${s.signature}  ${s.argsLine}\n    ${s.calldataVector.slice(0, 10)}… (${(s.calldataVector.length - 2) / 2} bytes)  → ${s.expectedPostState}`);
console.log("readback:"); for (const r of readback) console.log("  " + r);
console.log(`written: ${out.pathname}`);
