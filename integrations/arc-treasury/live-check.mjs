// Read-only evidence, re-derived against real Arc RPC. Nothing here is remembered.
//
// Run: node integrations/arc-treasury/live-check.mjs
//
// WHAT THIS IS FOR. Every number this integration relies on is re-derived here with its own call,
// against the live chain, and PRINTED next to what the offline transcript recorded. A claim in a
// document is not evidence; this is. Where the two disagree the row goes red, which is what stops
// the recorded transcript from quietly drifting away from the chain it claims to describe.
//
// THE HEADLINE ROW is the decimal split, and it is worth being precise about what it proves:
//
//   * eth_getBalance returns a quantity whose magnitude only makes sense at 18 decimals. That
//     establishes the NATIVE representation, and nothing else.
//   * The ERC-20 USDC deployed on Arc is asked for its own decimals(), and answers 6.
//   * The system emitter is asked the same question and returns EMPTY, because it holds zero bytes
//     of code — the case that must be a named refusal rather than a default.
//
// Those three facts together are the correction: "USDC is 18 decimals on Arc" is true of the gas
// currency and false of the token, and code that carries one number for both is wrong twice.
//
// WHAT IT DELIBERATELY DOES NOT DO. It signs nothing, sends nothing and needs no key.
//
// IT READS ONE ENVIRONMENT VARIABLE: ARC_RPC_URL, the endpoint override. It prints only that URL's
// ORIGIN — scheme and host — via publicEndpoint(), never its path, query or userinfo, because the
// ordinary shape of a private endpoint is a public host with a project key in the path. An earlier
// version of this file both claimed to read no environment variable and echoed the override
// verbatim; a comment that contradicts line 60 of its own file is worse than no comment.
//
// IT FAILS CLOSED ON A WRONG CHAIN: a chain id that is not Arc's stops the run and exits 1.
//
// AN UNREACHABLE RPC IS A SKIP, counted separately and never printed as a pass — but be exact about
// what that means for a caller: THE PROCESS STILL EXITS 0, because a SKIP is not a failure. A gate
// row that only reads the exit status will therefore go green on a machine with no network, having
// verified nothing. That is why this belongs on a live target and not in the offline gate.

import {readFileSync, readdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {
  ARC_MIN_MAX_FEE_PER_GAS_WEI, ARC_SYSTEM_EMITTER, ARC_TESTNET_CHAIN_ID, ARC_TESTNET_RPC, ArcClient,
  fetchTransport, publicEndpoint,
} from "./arc.mjs";
import {DECIMALS_SELECTOR, NATIVE_DECIMALS, decodeDecimalsReturn, formatFixed, nativeFromWei} from "./units.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const T = JSON.parse(readFileSync(resolve(HERE, "transcript.json"), "utf8"));

const ARC_USDC = T.observed.erc20Usdc.address;
const ZERO = "0x0000000000000000000000000000000000000000";

let pass = 0, fail = 0, skip = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++; else { fail++; if (detail !== undefined) console.log(`        ${detail}`); }
};
const eqv = (name, a, b) => check(name, a === b, `expected ${b}\n        got      ${a}`);
const skipped = (name, why) => {
  console.log(`  SKIP  ${name}: ${why} (this is a SKIP, not a pass)`);
  skip++;
};
const report = () => {
  console.log("");
  console.log(`checks run: ${pass + fail + skip}, passed: ${pass}, failed: ${fail}`);
  if (skip > 0) console.log(`skipped: ${skip} (a SKIP is never a pass)`);
  // A LIVE capture that produced no passing row verified nothing, and `make` reads an exit code,
  // not a SKIP line. Exiting 0 there would let a machine with no network report a green
  // "Arc live decimal evidence" row having reached no chain at all — the precise shape of silent
  // pass this repository publishes advisories about. Found by the adversarial review, 2026-09-08.
  if (pass === 0) {
    console.log("VERIFIED NOTHING: no row passed, so this run is a failure, not a skip");
  }
  process.exit(fail > 0 || pass === 0 ? 1 : 0);
};

const rpc = process.env.ARC_RPC_URL ?? ARC_TESTNET_RPC;
console.log(`Arc treasury — live evidence, re-derived read-only`);
// The ORIGIN is printed because the reader needs to know which host was asked. The path and query
// are dropped: an overridden endpoint is exactly where a project key would live, and this line is
// the one place a key could reach stdout.
console.log(`endpoint: ${publicEndpoint(rpc)}${rpc === ARC_TESTNET_RPC ? "" : "   (overridden by ARC_RPC_URL; path and query withheld)"}\n`);

const client = new ArcClient({url: rpc, transport: fetchTransport()});

// ---- the gate. Nothing runs against a chain that is not Arc. -------------------------------------
let chainId;
try {
  chainId = await client.chainId();
} catch (e) {
  skipped("every live row", `Arc RPC unreachable (${e.code ?? e.name})`);
  console.log("\n        This run verified NOTHING against the chain. The recorded transcript was not");
  console.log("        checked, and no claim in it should be treated as confirmed by this run.");
  report();
}
eqv(`chain id is Arc testnet ${ARC_TESTNET_CHAIN_ID}`, chainId, ARC_TESTNET_CHAIN_ID);
if (chainId !== ARC_TESTNET_CHAIN_ID) {
  console.log("\n        FAILING CLOSED: this is not Arc. No further row is meaningful.");
  report();
}

const blockNumber = await client.blockNumber();
console.log(`\n  observed head block: ${blockNumber}  (transcript recorded ${T.observed.blockNumber})`);
check("the chain is producing blocks past the recorded head", blockNumber >= BigInt(T.observed.blockNumber),
  `head ${blockNumber} is behind the recorded ${T.observed.blockNumber}`);

// =================================================================================================
console.log("\n— the decimal split, re-derived —");

// (1) The NATIVE representation. Magnitude is the argument: read at 6 the number is absurd.
const zeroBal = await client.nativeBalance(ZERO);
console.log(`  eth_getBalance(0x0) = ${zeroBal.wei}`);
console.log(`     read as 18dp -> ${formatFixed(zeroBal.wei, 18)}`);
console.log(`     read as  6dp -> ${formatFixed(zeroBal.wei, 6)}   <- absurd; this is how 18 is established`);
check("the native balance is large enough that 18 decimals is the only sane reading",
  zeroBal.wei > 10n ** 24n, `got ${zeroBal.wei}`);
eqv("the native representation is 18dp", NATIVE_DECIMALS, 18);

// (2) The ERC-20. It is asked, not assumed.
const usdcCode = await client.getCode(ARC_USDC);
const usdcCodeBytes = (usdcCode.length - 2) / 2;
console.log(`\n  eth_getCode(${ARC_USDC}) = ${usdcCodeBytes} bytes of code`);
check("there IS a real ERC-20 USDC deployed on Arc", usdcCodeBytes > 0, "no code at that address");
const rawDecimals = await client.ethCall(ARC_USDC, DECIMALS_SELECTOR);
console.log(`  eth_call decimals()  = ${rawDecimals}`);
const scale = decodeDecimalsReturn(rawDecimals, {token: ARC_USDC, source: `eth_call decimals() @ ${publicEndpoint(rpc)}`, blockNumber: Number(blockNumber)});
eqv("the ERC-20 USDC on Arc reports 6 decimals, read from the contract itself", scale.decimals, 6);
eqv("  …and that matches the recorded transcript", rawDecimals, T.observed.erc20Usdc.decimalsReturn);
check("6 is NOT 18 — the native width does not propagate to the token", scale.decimals !== NATIVE_DECIMALS,
  "the token reported the same width as the native currency, which would make the split moot");

// (3) The codeless emitter. Empty, and that must be a refusal.
const emitterCode = await client.getCode(ARC_SYSTEM_EMITTER);
const emitterDecimals = await client.ethCall(ARC_SYSTEM_EMITTER, DECIMALS_SELECTOR);
console.log(`\n  eth_getCode(${ARC_SYSTEM_EMITTER}) = ${JSON.stringify(emitterCode)}`);
console.log(`  eth_call decimals()  = ${JSON.stringify(emitterDecimals)}`);
eqv("the system emitter holds zero bytes of code", emitterCode, "0x");
eqv("  …and returns EMPTY for decimals(), not a number", emitterDecimals, "0x");
let emptyRefused = false;
try { decodeDecimalsReturn(emitterDecimals, {token: ARC_SYSTEM_EMITTER}); }
catch (e) { emptyRefused = e.code === "DECIMALS_EMPTY_RETURN"; }
check("an empty return is a NAMED refusal, never a fallback to 6 or 18", emptyRefused);
let noCodeRefused = false;
try { await client.readTokenScale(ARC_SYSTEM_EMITTER); }
catch (e) { noCodeRefused = e.code === "NO_CODE_AT_ADDRESS"; }
check("reading a scale from the codeless emitter refuses by name", noCodeRefused);

// (4) THE DECISIVE ROW. One account, one pot of money, both representations at once.
//
// This is the whole correction in a single pair of numbers. The Arc ERC-20 USDC turns out to be a
// 6-decimal view of the very balance eth_getBalance reports at 18, so for any account
// native / 10^12 == token, exactly. The same money is a 27-digit integer in one representation and
// a 15-digit integer in the other. Code carrying one decimal count for both is not slightly wrong;
// it is wrong by a factor of a trillion, in whichever direction it guessed.
console.log("\n— one account, one pot of money, two representations —");
const nativeOfZero = await client.nativeBalance(ZERO);
const tokenOfZero = await client.tokenBalance(ARC_USDC, ZERO, scale);
console.log(`  account ${ZERO}`);
console.log(`    native  ${String(nativeOfZero.wei).padStart(30)}  = ${formatFixed(nativeOfZero.wei, 18)}  (18dp)`);
console.log(`    token   ${String(tokenOfZero.units).padStart(30)}  = ${formatFixed(tokenOfZero.units, scale.decimals)}  (${scale.decimals}dp, as read)`);
console.log(`    native / 10^12 = ${nativeOfZero.wei / 10n ** 12n}`);
check("the ERC-20 balance is exactly the native balance scaled down by 10^12",
  nativeOfZero.wei / 10n ** 12n === tokenOfZero.units,
  `native/1e12 = ${nativeOfZero.wei / 10n ** 12n}, token = ${tokenOfZero.units}`);
console.log(`    read WRONGLY at 18dp the token balance would display as ${formatFixed(tokenOfZero.units, 18)} USDC`);
check("…and reading the token at 18dp understates the holding by a factor of 10^12",
  tokenOfZero.units > 0n && formatFixed(tokenOfZero.units, 18) !== formatFixed(tokenOfZero.units, scale.decimals));
// The guard, on the live values: these two must not be mixable even though they describe one pot.
let liveMixRefused = false;
try { (await import("./units.mjs")).add(nativeOfZero, tokenOfZero); }
catch (e) { liveMixRefused = e.code === "UNIT_KIND_MISMATCH"; }
check("the two live balances refuse to be added, though they describe the same money", liveMixRefused);

// =================================================================================================
console.log("\n— the other Arc divergences, re-derived —");

const gasPrice = await client.gasPrice();
console.log(`  eth_gasPrice = ${gasPrice} wei = ${Number(gasPrice) / 1e9} Gwei`);
check(`gas price is at or above Arc's ${ARC_MIN_MAX_FEE_PER_GAS_WEI} wei (20 Gwei) mempool floor`,
  gasPrice >= ARC_MIN_MAX_FEE_PER_GAS_WEI, `got ${gasPrice}`);

// A send to address(0). Estimated, never sent — eth_estimateGas is a read.
let zeroSendRefused = false, zeroSendMessage = "";
try {
  await client.estimateGas({from: ZERO, to: ZERO, value: "0x1"});
} catch (e) {
  zeroSendRefused = e.code === "RPC_ERROR";
  zeroSendMessage = e.rpcMessage ?? e.message;
}
console.log(`  eth_estimateGas -> address(0): ${zeroSendMessage || "(no revert)"}`);
check("a send to address(0) reverts on Arc, as documented", zeroSendRefused, "the chain accepted it");
check("  …and the revert names the zero address", /zero address/i.test(zeroSendMessage), zeroSendMessage);

// A plain transfer between two ordinary addresses, for contrast: the same call that reverts above
// succeeds here, which is what makes the row above a property of address(0) and not of the method.
let ordinaryGas = null;
try {
  ordinaryGas = await client.estimateGas({from: ZERO, to: "0x2222222222222222222222222222222222222222", value: "0x0"});
} catch { /* recorded as null below */ }
console.log(`  eth_estimateGas -> an ordinary address: ${ordinaryGas ?? "(refused)"}`);
check("CONTROL the same estimate against an ordinary address succeeds", ordinaryGas === 21000n,
  `expected 21000, got ${ordinaryGas}`);

// =================================================================================================
console.log("\n— what this repository does NOT claim about Arc —");
// This row used to be `check(name, true)` — a check that cannot fail, counted among the passes.
// It now reads the directory and asserts the thing it claims: no UNICA deployment address appears
// anywhere in it. Sabotage it by pasting either address into any file here and it goes red.
// The two needles are assembled from halves ON PURPOSE. Written whole, this file would contain the
// literal it scans for, and the row would go red on its own source — a guard crying wolf on its own
// documentation, which is the failure CLAUDE.md records for the attribution check. Split, the scan
// can cover every file in the directory INCLUDING this one.
const UNICA_SEPOLIA = [
  "0x11202071da4eb91be" + "3041a174d0c20fdac0ea0c0",   // the UNICA V1 hook, on Sepolia
  "0x044bc8a8773ec7b9b" + "8de2467766636dffcac6210",   // the UNICA V1 executor, on Sepolia
];
const sources = readdirSync(HERE)
  .filter((f) => /\.(mjs|md|html|json)$/.test(f))
  .map((f) => [f, readFileSync(resolve(HERE, f), "utf8").toLowerCase()]);
const leaked = sources.filter(([, body]) => UNICA_SEPOLIA.some((a) => body.includes(a))).map(([f]) => f);
check(`no UNICA contract address is asserted on Arc by this module (${sources.length} files scanned)`,
  leaked.length === 0, `these files name a UNICA deployment address: ${leaked.join(", ")}`);
console.log("        Nothing in integrations/arc-treasury/ deploys, and no UNICA contract exists on Arc.");
console.log("        Uniswap is not deployed on Arc, so this integration builds no swap path and models no DEX.");
console.log("        Arc is testnet-only; there is no Arc mainnet to claim anything about.");

report();
