// The two derivations, compared.
//
// `split.mjs` is JavaScript; `vy/src/unica/merchant_policy.vy` is what would run on chain. This
// file checks the first against 78 rows of what the SECOND actually computed, captured by
// `vy/tests/test_arc_split_parity.py` from the real contract in Moccasin's in-process EVM.
//
// Offline and deterministic: it reads a committed fixture and opens no socket.
//
// Run: node integrations/arc-treasury/split-test.mjs

import {readFileSync} from "node:fs";
import {chdir} from "node:process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {SPLIT_ERROR, split, policy} from "./split.mjs";
import {decodeDecimalsReturn, isToken, nativeFromWhole, tokenAmount} from "./units.mjs";

// Anchored, so this reads the repository and not whatever directory it was called from.
chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  if (ok) { pass++; return; }
  fail++;
  console.log(`  FAIL  ${name}`);
  for (const d of [].concat(detail ?? [])) console.log(`        ${d}`);
};
const say = (s) => console.log(s);

const F = JSON.parse(readFileSync("integrations/arc-treasury/fixtures/split-vectors.json", "utf8"));

// A real scale, decoded from the bytes Arc's own USDC returned for decimals(). Building it this
// way rather than from the number 6 is the point: split() must refuse a scale nobody read.
const USDC_ON_ARC = "0x3600000000000000000000000000000000000000";
// The word "vector" on the line below is not decoration: script/scan.sh refuses a bare 32-byte
// value that no word on its line explains, because that shape is how a pasted key hides in plain
// sight. This one is an eth_call return, so it says so.
const DECIMALS_SIX_RETURN_VECTOR = "0x0000000000000000000000000000000000000000000000000000000000000006";
const SIX = decodeDecimalsReturn(
  DECIMALS_SIX_RETURN_VECTOR,
  {token: USDC_ON_ARC, source: "eth_call decimals() on Arc, captured in transcript.json"},
);

say("— the fixture is real, and says which contract produced it —");
chk("the fixture names the Vyper source", F.contract === "vy/src/unica/merchant_policy.vy", F.contract);
chk("the fixture names the function", F.function === "split(uint256,uint256)", F.function);
chk("the fixture names its generator", F.capturedBy === "vy/tests/test_arc_split_parity.py", F.capturedBy);
chk("BPS agrees with split.mjs", BigInt(F.bps) === 10000n, String(F.bps));
chk("the vector table is not empty", Array.isArray(F.vectors) && F.vectors.length > 0, `${F.vectors?.length} vectors`);
chk("the table covers more than one policy shape", new Set(F.vectors.map((v) => v.policy)).size >= 5);

// ---- THE CONTROL, first. A row that must agree, before any row that must differ. -------------
say("\n— control: one hand-checked row agrees before the sweep is trusted —");
{
  const v = F.vectors.find((x) => x.policy === "three holds, thirds" && x.amount === "33333");
  const got = split(tokenAmount(BigInt(v.amount), SIX), {bankBps: v.bankBps, holdBps: v.holdBps});
  chk("the hand-checked row exists in the fixture", v !== undefined);
  chk("bank matches Vyper", got.bank.units === BigInt(v.bank), `js ${got.bank.units} vy ${v.bank}`);
  chk("parts match Vyper", got.parts.map((p) => String(p.units)).join(",") === v.parts.join(","),
    `js [${got.parts.map((p) => p.units)}] vy [${v.parts}]`);
  chk("and the last leg really does absorb the remainder (9999,9999,10002)",
    v.parts.join(",") === "9999,9999,10002", v.parts.join(","));
}

// ---- THE SWEEP -------------------------------------------------------------------------------
say("\n— every captured vector, against the JavaScript derivation —");
let agreed = 0;
const disagreements = [];
for (const v of F.vectors) {
  const amount = tokenAmount(BigInt(v.amount), SIX);
  const got = split(amount, {bankBps: v.bankBps, holdBps: v.holdBps});
  const bankOk = got.bank.units === BigInt(v.bank);
  const partsOk = got.parts.length === v.parts.length
    && got.parts.every((p, i) => p.units === BigInt(v.parts[i]));
  if (bankOk && partsOk) agreed++;
  else disagreements.push(`${v.policy} @ ${v.amount}: js ${got.bank.units}/[${got.parts.map((p) => p.units)}] vy ${v.bank}/[${v.parts}]`);
}
chk(`all ${F.vectors.length} vectors agree with Vyper`, disagreements.length === 0, disagreements.slice(0, 5));
chk("and every one of them was actually compared", agreed === F.vectors.length, `${agreed} of ${F.vectors.length}`);

say("\n— the invariant the contract's own comment claims —");
{
  let exact = 0;
  for (const v of F.vectors) {
    const got = split(tokenAmount(BigInt(v.amount), SIX), {bankBps: v.bankBps, holdBps: v.holdBps});
    if (got.bank.units + got.parts.reduce((a, p) => a + p.units, 0n) === BigInt(v.amount)) exact++;
  }
  chk("bank plus every part equals the amount, on all vectors", exact === F.vectors.length,
    `${exact} of ${F.vectors.length}`);
}

// ---- SABOTAGE. The naive port, which is the mistake this file exists to catch. ---------------
say("\n— sabotage: the check must catch the port that gets the last leg wrong —");
{
  // Every leg computed the same way, instead of the last absorbing the remainder. This is what a
  // careful reader writes if they read the formula and not the loop.
  const naive = (units, {bankBps, holdBps}) => {
    const bank = (units * BigInt(bankBps)) / 10000n;
    const parts = holdBps.map((h) => (units * BigInt(h)) / 10000n);
    return {bank: holdBps.length === 0 ? units : bank, parts};
  };
  let caught = 0, identical = 0;
  for (const v of F.vectors) {
    const n = naive(BigInt(v.amount), {bankBps: v.bankBps, holdBps: v.holdBps});
    const same = n.bank === BigInt(v.bank) && n.parts.every((p, i) => p === BigInt(v.parts[i]));
    if (same) identical++; else caught++;
  }
  chk("the naive port disagrees with Vyper on at least one vector", caught > 0, `${caught} rows differ`);
  chk("...and it is a SUBTLE difference, not a wholesale one", identical > 0,
    `${identical} of ${F.vectors.length} rows are identical either way — which is why this is easy to ship`);
}

// ---- THE REFUSALS the contract makes, which JavaScript must make too ------------------------
say("\n— the shapes the contract refuses —");
for (const r of F.refusals ?? []) {
  let code = null;
  try { policy({bankBps: r.bankBps, holdBps: r.holdBps}); } catch (e) { code = e.code; }
  chk(`refused: ${r.why}`, code === SPLIT_ERROR.SHARES_NOT_TOTAL, `got ${code ?? "no refusal at all"}`);
}
{
  let code = null;
  try { policy({bankBps: 6000, holdBps: [3000, 1001]}); } catch (e) { code = e.code; }
  chk("shares totalling 10001 are refused", code === SPLIT_ERROR.SHARES_NOT_TOTAL, String(code));
  code = null;
  try { policy({bankBps: 0, holdBps: [2500, 2500, 2500, 2500, 0]}); } catch (e) { code = e.code; }
  chk("more legs than the contract can hold are refused", code === SPLIT_ERROR.TOO_MANY_HOLDS, String(code));
  // CONTROL: the valid neighbour of each refusal must still pass.
  chk("CONTROL exactly four legs is accepted", policy({bankBps: 0, holdBps: [2500, 2500, 2500, 2500]}).holdBps.length === 4);
  chk("CONTROL shares totalling exactly 10000 are accepted", policy({bankBps: 6000, holdBps: [3000, 1000]}).bankBps === 6000n);
}

// ---- THE DECIMAL LAW, which is why this splits TokenAmounts and not integers -----------------
say("\n— the decimal law survives the arithmetic —");
{
  const out = split(tokenAmount(1_000_000n, SIX), {bankBps: 6000, holdBps: [3000, 1000]});
  chk("the bank leg is a TokenAmount", isToken(out.bank));
  chk("every part is a TokenAmount", out.parts.every(isToken));
  chk("the scale carried out is the scale carried in", out.bank.scale === SIX && out.parts.every((p) => p.scale === SIX));
  chk("that scale is 6, read from the token and not chosen here", SIX.decimals === 6, String(SIX.decimals));

  let code = null;
  try { split(nativeFromWhole(1), {bankBps: 10000, holdBps: []}); } catch (e) { code = e.code; }
  chk("a NATIVE amount is refused — an 18-decimal gas balance is not a merchant payout",
    code === SPLIT_ERROR.NOT_A_TOKEN_AMOUNT, String(code));

  code = null;
  try { split(tokenAmount(1n, 6), {bankBps: 10000, holdBps: []}); } catch (e) { code = e.code; }
  chk("a bare number 6 cannot stand in for a scale nobody read", code !== null && code !== undefined, String(code));
}

console.log(`\nchecks run: ${pass + fail}, passed: ${pass}, failed: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
