// The V2 release manifest: everything a deployment would fix, recorded before one happens.
//
// A MANIFEST OF A REHEARSAL, NOT OF A DEPLOYMENT. Every address below is PREDICTED. None exists on
// any public chain, and the field naming says so rather than leaving a reader to infer it. The
// rehearsal that produces these values is `test/v2/DeploymentRehearsal.t.sol`, which is a test and
// therefore has no path that could broadcast.
//
// Everything is read from the compiler's own artifacts and from git, so running it twice on one
// commit produces one file.

import {execFileSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {keccak256, toHex} from "../../web/ensv2/keccak.mjs";

const git = (...a) => execFileSync("git", a, {encoding: "utf8"}).trim();
const artifact = (p) => JSON.parse(readFileSync(`out/${p}`, "utf8"));
const hexBytes = (h) => {
  const b = h.replace(/^0x/, "");
  const out = new Uint8Array(b.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(b.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const codeHash = (h) => toHex(keccak256(hexBytes(h)));
const size = (h) => (h.replace(/^0x/, "").length) / 2;

const FROZEN = [
  "src/v2/QuoteSettlementHook.sol",
  "src/v2/QuoteSettlementExecutor.sol",
  "src/v2/MerchantConfig.sol",
  "src/v2/interfaces/IQuoteSettlement.sol",
  "src/v2/interfaces/IPermit2Transfer.sol",
];

const hook = artifact("QuoteSettlementHook.sol/QuoteSettlementHook.json");
const exec = artifact("QuoteSettlementExecutor.sol/QuoteSettlementExecutor.json");
const foundry = readFileSync("foundry.toml", "utf8");
const pick = (k) => (foundry.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, "m"))?.[1] ?? "").trim();

const manifest = {
  what: "A REHEARSAL manifest. Every address is PREDICTED and none is deployed.",
  generatedFrom: "script/v2/release-manifest.mjs",
  rehearsal: "test/v2/DeploymentRehearsal.t.sol — a forge test, which cannot broadcast",

  source: {
    commit: git("rev-parse", "HEAD"),
    shortCommit: git("rev-parse", "--short", "HEAD"),
    describesTree: git("rev-parse", "HEAD^{tree}"),
    frozenBlobHashes: Object.fromEntries(FROZEN.map((f) => [f, git("hash-object", f)])),
  },

  toolchain: {
    solc: pick("solc_version").replace(/"/g, ""),
    evmVersion: pick("evm_version").replace(/"/g, "").split("#")[0].trim(),
    viaIR: pick("via_ir"),
    optimizer: pick("optimizer"),
    optimizerRuns: pick("optimizer_runs"),
    bytecodeHash: pick("bytecode_hash").replace(/"/g, ""),
    cborMetadata: pick("cbor_metadata"),
    note:
      "via_ir is load-bearing rather than a preference: V1's LIVE hook address was mined under "
      + "these exact settings, so changing any of them changes bytecode that is already deployed.",
  },

  contracts: {
    QuoteSettlementHook: {
      creationCodeHash: codeHash(hook.bytecode.object),
      creationCodeSize: size(hook.bytecode.object),
      deployedCodeSize: size(hook.deployedBytecode.object),
      eip170Headroom: 24576 - size(hook.deployedBytecode.object),
      constructorArgs: ["IPoolManager poolManager_", "address executor_"],
      deployedBy: "the canonical CREATE2 deployer at a mined salt",
    },
    QuoteSettlementExecutor: {
      creationCodeHash: codeHash(exec.bytecode.object),
      creationCodeSize: size(exec.bytecode.object),
      deployedCodeSize: size(exec.deployedBytecode.object),
      eip170Headroom: 24576 - size(exec.deployedBytecode.object),
      constructorArgs: ["IPoolManager poolManager_", "IPermit2Transfer permit2_"],
      deployedBy: "plain CREATE from the deployer, so its address is the deployer and a nonce",
    },
  },

  target: {
    chainId: 11155111,
    chainName: "Ethereum Sepolia",
    poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    create2Deployer: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  },

  hookAddress: {
    declaredPermissionBits: 8384,
    declaredPermissionBitsHex: "0x20c0",
    meaning: ["beforeInitialize", "beforeSwap", "afterSwap"],
    returnDeltaPermissions: "none — the NoOp surface is deliberately not claimed",
    saltIsMinedAgainst:
      "the executor's address, which is embedded in the hook's creation code. A different "
      + "executor mines a different hook address, which is what makes the binding unforgeable.",
    predicted: "NOT COMPUTED HERE — the salt depends on the executor address, which depends on the "
      + "deployer and nonce chosen at deployment time. test/v2/DeploymentRehearsal.t.sol proves the "
      + "search is deterministic given those two inputs.",
  },

  deploymentOrder: [
    "1. deploy QuoteSettlementExecutor (plain CREATE) — its address is fixed by deployer + nonce",
    "2. mine the hook salt against THAT executor address",
    "3. deploy QuoteSettlementHook through the CREATE2 deployer at the mined salt",
    "4. read back: the hook's EXECUTOR must equal the executor, and the executor must accept the hook",
  ],
  orderIsForced: "the hook's creation code embeds the executor, so step 2 cannot precede step 1",

  verificationInputs: {
    hook: "constructor(address poolManager, address executor) — both readable from the deployed code",
    executor: "constructor(address poolManager, address permit2)",
    note: "cbor_metadata is off and bytecode_hash is none, so verification compares bytecode exactly.",
  },

  status: {
    deployed: false,
    broadcast: false,
    deployable: false,
    blockedBy:
      "SECURITY-ADVISORY-001: the payer's Permit2 witness does not bind the merchant's half of the quote. "
      + "Critical, reproduced in test/v2/WitnessBinding.t.sol, unfixed. This file describes a REHEARSAL, "
      + "and the block is written here rather than in the JSON because the JSON is generated: an edit to "
      + "the output would disappear the next time anyone ran this script.",
    v1Untouched: true,
    v2Frozen: "v2.0.0-rc1 at 82c7dcb44038",
  },

  unresolvedAssumptions: [
    "the Critical defect in docs/v2/SECURITY-ADVISORY-001.md is unfixed, so no deployment of this candidate is sanctioned",
    "the deployer address and nonce are chosen by the owner at deployment time and are not fixed here",
    "no V2 address has been reserved, funded or announced anywhere",
    "source verification has not been submitted, because nothing is deployed to verify",
    "the fork suites need a Sepolia endpoint and are outside the default gate",
  ],
};

const out = "docs/v2/release-manifest.json";
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${out}`);
console.log(`  hook creation code     ${manifest.contracts.QuoteSettlementHook.creationCodeHash}`);
console.log(`  executor creation code ${manifest.contracts.QuoteSettlementExecutor.creationCodeHash}`);
console.log(`  hook headroom          ${manifest.contracts.QuoteSettlementHook.eip170Headroom} bytes`);
console.log(`  executor headroom      ${manifest.contracts.QuoteSettlementExecutor.eip170Headroom} bytes`);
console.log(`  deployed               ${manifest.status.deployed}`);
console.log(`  deployable             ${manifest.status.deployable}  (${manifest.status.blockedBy.split(":")[0]})`);
