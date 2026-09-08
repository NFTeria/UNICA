// The copilot's rules, each with its boundary and its sabotage row.
//
// Offline and deterministic by construction: no network, no clock, no randomness. Every record is
// built here, so every figure the copilot reports can be checked against arithmetic done by hand in
// the comment above the row.
//
// HOW EACH RULE IS TESTED. A rule is not tested by watching it fire. It is tested by building the
// input that must NOT fire it — the control — and then moving ONE figure across the threshold and
// watching it go red. A test that only ever sees the rule fire cannot tell a working rule from a
// rule that fires on everything, and every boundary below is written from that side first.
//
// Run: node integrations/graph-v2/copilot-test.mjs

import {FINDING, SEVERITY, THRESHOLDS, VERDICT, REQUIRED_FIELDS, analyse, renderReport} from "./copilot.mjs";
import {LIVE_SOURCE} from "./provider.mjs";
import {OFFLINE_SOURCE, offlineSettlements, OFFLINE_AS_OF} from "./samples.mjs";

let passed = 0;
let failed = 0;
const rows = [];

function check(name, ok, why) {
  rows.push(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) {
    passed++;
  } else {
    failed++;
    for (const line of [].concat(why ?? [])) rows.push(`        ${line}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, [`expected ${expected}`, `got      ${actual}`]);
}

// If this suite dies before printing its tail — an unexpected throw, a module that fails to load —
// the exit hook below says so and counts the crash as a failure. A run that produced no count line
// and a run that passed must never look the same to whoever reads the output; measured on this
// suite, a deliberately broken provider crashed it and it printed nothing at all.
let finished = false;
process.on("exit", () => {
  if (finished) return;
  console.log(rows.join("\n"));
  console.log("\nABORTED: the suite threw before it finished; the rows above are all that ran");
  console.log(`checks run: ${passed + failed + 1}, passed: ${passed}, failed: ${failed + 1}`);
});

// ---- the fixture builder ------------------------------------------------------------------------

const USDC = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
const DAI = "0x00000000000000000000000000000000000da1da1";
const MERCHANT = "0xa50802fbcafc5af3d0093026d301a82ec341652a";
const PAYER_A = "0x00000000000000000000000000000000000000a1";
const PAYER_B = "0x00000000000000000000000000000000000000b2";
const PAYER_C = "0x00000000000000000000000000000000000000c3";
const PAYER_D = "0x00000000000000000000000000000000000000d4";

let seq = 0;
function rec(over = {}) {
  const i = over.i ?? seq++;
  const amount = over.amount ?? 100n;
  return {
    id: `0x${String(i).padStart(4, "0")}`,
    quoteId: `0xq${String(i).padStart(3, "0")}`,
    quoteDigest: `0xd${String(i).padStart(3, "0")}`,
    payer: over.payer ?? PAYER_A,
    merchantSigner: MERCHANT,
    recipient: MERCHANT,
    tokenIn: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    actualIn: "1000",
    maxIn: "2000",
    tokenOut: over.token ?? USDC,
    amountOut: String(amount),
    deliveredOut: String(over.delivered ?? amount),
    executor: "0x5615deb798bb3e4dfa0139dfa1b3d433cc23b72f",
    policyVersion: "1",
    transactionHash: `0xt${String(i).padStart(3, "0")}`,
    logIndex: "0",
    blockNumber: String(11_000_000 + (over.ts ?? 0)),
    blockTimestamp: String(1_770_000_000 + (over.ts ?? 0)),
    source: over.source ?? LIVE_SOURCE,
  };
}

const AS_OF = String(1_770_000_000);
function run(settlements, {asOf = AS_OF, source = LIVE_SOURCE, thresholds} = {}) {
  return analyse({settlements, source, asOfTimestamp: asOf, thresholds});
}
function findingsOf(report, name) {
  return report.findings.filter((f) => f.finding === name);
}
function has(report, name) {
  return findingsOf(report, name).length > 0;
}
/// The first finding of a kind, or a placeholder that fails every assertion made against it.
///
/// The sub-rows below are deliberately NOT guarded by `if (f)`. A guard like that removes rows when
/// the finding is missing, so sabotaging a rule shrinks the suite instead of reddening it — and a
/// suite that shrinks silently is the "an empty result and a broken reporter look identical" defect
/// this repository publishes advisories about. Measured: with the concentration threshold broken on
/// purpose, the guarded version printed 110 rows and one failure where it should have printed 115
/// and five.
const NO_FINDING = Object.freeze({
  finding: "(no such finding)",
  severity: "(no such finding)",
  rule: "(no such finding)",
  statement: "(no such finding)",
  figures: {},
  entityIds: [],
});
function first(report, name) {
  return findingsOf(report, name)[0] ?? NO_FINDING;
}

// ---- controls on the instrument itself -----------------------------------------------------------
//
// If the median is wrong, every rule below is wrong in a way no rule-level assertion would show.

{
  const r = run([rec({i: 1, amount: 10n}), rec({i: 2, amount: 30n}), rec({i: 3, amount: 20n})]);
  eq("control: the median of 10, 20, 30 is 20 (odd count)", r.byToken[0].medianAmount, "20");
  eq("control: the total of 10, 20, 30 is 60", r.byToken[0].totalRequested, "60");
  eq("control: the minimum is 10", r.byToken[0].minAmount, "10");
  eq("control: the maximum is 30", r.byToken[0].maxAmount, "30");
}
{
  // Even count: floor of the mean of the two middles. The two middles must sum to an ODD number
  // or this row cannot tell flooring from rounding up — 20 and 30 average exactly, 20 and 31 do
  // not. The first version of this row used 30 and passed against a deliberately broken median.
  const r = run([rec({i: 4, amount: 10n}), rec({i: 5, amount: 20n}), rec({i: 6, amount: 31n}), rec({i: 7, amount: 41n})]);
  eq("control: the median of 10, 20, 31, 41 is 25 (even count, floored not rounded)", r.byToken[0].medianAmount, "25");
}

// ---- determinism ----------------------------------------------------------------------------------

{
  const set = [rec({i: 10, amount: 100n, ts: 0}), rec({i: 11, amount: 200n, ts: 60}), rec({i: 12, amount: 300n, ts: 120})];
  const a = JSON.stringify(run(set));
  const b = JSON.stringify(run(set));
  check("the same input produces byte-identical output", a === b, "the analyst is not deterministic");

  const shuffled = [set[2], set[0], set[1]];
  eq("the input's arrival order does not change the report", JSON.stringify(run(shuffled)), a);
}

// ---- the input is rejected rather than half-analysed -----------------------------------------------

{
  const r = analyse({settlements: "not an array", source: LIVE_SOURCE, asOfTimestamp: AS_OF});
  eq("a non-array input is rejected", r.findings[0].finding, FINDING.INPUT_REJECTED);
  eq("...and the report is not usable", r.usable, false);
  eq("...and the verdict says so", r.verdict, VERDICT.INPUT_REJECTED);
}
{
  const r = analyse({settlements: [], asOfTimestamp: AS_OF});
  eq("a set with no declared source is rejected", r.findings[0].finding, FINDING.INPUT_REJECTED);
}
{
  const r = analyse({settlements: [rec({i: 20})], source: LIVE_SOURCE});
  eq("a missing asOfTimestamp is rejected", r.findings[0].finding, FINDING.INPUT_REJECTED);
  check("...naming the field rather than defaulting to now",
        r.findings[0].statement.includes("asOfTimestamp"), r.findings[0].statement);
}
{
  // The sabotage: remove one required field from an otherwise valid record.
  for (const field of REQUIRED_FIELDS) {
    const bad = rec({i: 21});
    delete bad[field];
    const r = run([bad]);
    check(`a record missing \`${field}\` is rejected`,
          r.findings[0].finding === FINDING.INPUT_REJECTED && r.findings[0].figures.field === field,
          [`got ${r.findings[0].finding} / ${JSON.stringify(r.findings[0].figures)}`]);
  }
}
{
  const bad = rec({i: 22});
  bad.amountOut = "1.5";
  const r = run([bad]);
  eq("a non-integer amount is rejected", r.findings[0].finding, FINDING.INPUT_REJECTED);
  eq("...naming the field", r.findings[0].figures.field, "amountOut");
}
{
  const bad = rec({i: 23});
  bad.amountOut = "-1";
  eq("a negative amount is rejected", run([bad]).findings[0].finding, FINDING.INPUT_REJECTED);
}
{
  // CONTROL for all of the above: the same shape, complete, is accepted.
  const r = run([rec({i: 24, amount: 100n})]);
  eq("control: a complete, well-formed record is accepted", r.usable, true);
}

// ---- provenance: an offline set cannot be analysed as a live one -------------------------------------

{
  const mixed = [rec({i: 30, source: LIVE_SOURCE}), rec({i: 31, source: OFFLINE_SOURCE})];
  const r = run(mixed);
  eq("records that disagree about their source are refused", r.findings[0].finding, FINDING.SOURCE_NOT_ESTABLISHED);
  eq("...and no totals are produced", r.byToken.length, 0);
}
{
  const offline = [rec({i: 32, source: OFFLINE_SOURCE}), rec({i: 33, source: OFFLINE_SOURCE})];
  const asLive = analyse({settlements: offline, source: LIVE_SOURCE, asOfTimestamp: AS_OF});
  eq("offline records declared as live are refused", asLive.findings[0].finding, FINDING.SOURCE_NOT_ESTABLISHED);
  // CONTROL: the same records, declared honestly, analyse fine.
  const asOffline = analyse({settlements: offline, source: OFFLINE_SOURCE, asOfTimestamp: AS_OF});
  eq("control: the same records declared as offline are accepted", asOffline.usable, true);
  eq("...and the report says which they are", asOffline.dataSource, OFFLINE_SOURCE);
}
{
  const offlineReport = analyse({
    settlements: offlineSettlements(),
    source: OFFLINE_SOURCE,
    asOfTimestamp: OFFLINE_AS_OF,
  });
  const text = renderReport(offlineReport);
  check("an offline report renders the words NOT LIVE DATA", text.includes("NOT LIVE DATA"), text.split("\n")[1]);
  const liveText = renderReport(run([rec({i: 34, amount: 100n})]));
  check("a live report does not", !liveText.includes("NOT LIVE DATA"), liveText.split("\n")[1]);
  check("the sample set is byte-identical on every call",
        JSON.stringify(offlineSettlements()) === JSON.stringify(offlineSettlements()));
}

// ---- the empty set: insufficient data, never a confident zero -----------------------------------------

{
  const r = run([]);
  eq("an empty result is INSUFFICIENT_DATA", r.findings[0].finding, FINDING.INSUFFICIENT_DATA);
  eq("...and the verdict is not STEADY", r.verdict, VERDICT.INSUFFICIENT_DATA);
  eq("...and no per-token totals are invented", r.byToken.length, 0);
  eq("...and no payer breakdown is invented", r.byPayer.length, 0);
  check("...and the statement says an empty result proves nothing",
        r.findings[0].statement.includes("NOT a zero-volume finding"), r.findings[0].statement);
  const text = JSON.stringify(r);
  check("...and no total of any kind appears in the report",
        !text.includes("totalRequested") && !text.includes("totalDelivered"),
        "an empty result rendered a zero total");
}

// ---- concentration -------------------------------------------------------------------------------
//
// Threshold: a single payer at or above 6000 bps of one payout token.
// Built to land EXACTLY on it: A pays 3000 + 3000, B pays 4000. Total 10000, A's share 6000 bps.

{
  const set = [
    rec({i: 40, payer: PAYER_A, amount: 3000n, ts: 0}),
    rec({i: 41, payer: PAYER_A, amount: 3000n, ts: 60}),
    rec({i: 42, payer: PAYER_B, amount: 4000n, ts: 120}),
  ];
  const r = run(set);
  const f = first(r, FINDING.SINGLE_PAYER_CONCENTRATION);
  check("at exactly 6000 bps the concentration rule fires (the threshold is inclusive)",
        has(r, FINDING.SINGLE_PAYER_CONCENTRATION));
  eq("...and reports the share it fired on", f.figures.shareBps, "6000");
  eq("...and the payer", f.figures.payer, PAYER_A);
  eq("...and the token total it divided by", f.figures.tokenTotal, "10000");
  eq("...and carries the ids the figure came from", f.entityIds.join(","), "0x0040,0x0041");
  eq("...at ATTENTION, not ACTION", f.severity, SEVERITY.ATTENTION);
}
{
  // SABOTAGE, one unit below: A pays 3000 + 2999, B pays 4001. Total 10000, A's share 5999 bps.
  const set = [
    rec({i: 43, payer: PAYER_A, amount: 3000n, ts: 0}),
    rec({i: 44, payer: PAYER_A, amount: 2999n, ts: 60}),
    rec({i: 45, payer: PAYER_B, amount: 4001n, ts: 120}),
  ];
  const r = run(set);
  check("at 5999 bps it does not fire", !has(r, FINDING.SINGLE_PAYER_CONCENTRATION),
        JSON.stringify(findingsOf(r, FINDING.SINGLE_PAYER_CONCENTRATION)[0]?.figures ?? {}));
}
{
  // Below the moderate threshold of 3300 bps. Three equal payers would each hold 3333, which is
  // ABOVE it — so a diverse base needs four, and 2500 bps each is what that looks like.
  const set = [
    rec({i: 46, payer: PAYER_A, amount: 2500n, ts: 0}),
    rec({i: 47, payer: PAYER_B, amount: 2500n, ts: 60}),
    rec({i: 48, payer: PAYER_C, amount: 2500n, ts: 120}),
    rec({i: 49, payer: PAYER_D, amount: 2500n, ts: 180}),
  ];
  const r = run(set);
  check("a spread payer base is reported as diverse", has(r, FINDING.PAYER_BASE_DIVERSE));
  eq("...with the largest share stated", first(r, FINDING.PAYER_BASE_DIVERSE).figures.shareBps, "2500");
  check("...and no concentration finding is made", !has(r, FINDING.SINGLE_PAYER_CONCENTRATION));
}
{
  // Two settlements is not a payer base. One receipt is always 100% of one receipt.
  const set = [rec({i: 51, payer: PAYER_A, amount: 100n, ts: 0}), rec({i: 52, payer: PAYER_A, amount: 100n, ts: 60})];
  const r = run(set);
  check("below the minimum, concentration is not computed at all", !has(r, FINDING.SINGLE_PAYER_CONCENTRATION));
  const insufficient = findingsOf(r, FINDING.INSUFFICIENT_DATA).find((f) => f.rule.includes("concentration")) ?? NO_FINDING;
  check("...and says so rather than staying silent", insufficient !== NO_FINDING);
  eq("...naming the minimum", insufficient.figures.required, String(THRESHOLDS.minSettlementsForConcentration));
}

// ---- cadence -------------------------------------------------------------------------------------
//
// The floor dominates when the merchant settles quickly: allowed = max(median gap x 3, 3600s).
// Three receipts 10s apart give a median gap of 10s, so allowed is the 3600s floor.

{
  const set = [rec({i: 60, ts: 0}), rec({i: 61, ts: 10}), rec({i: 62, ts: 20})];
  // as of exactly last + 3600: not greater than allowed, so steady.
  const r = run(set, {asOf: String(1_770_000_000 + 20 + 3600)});
  check("at exactly the cadence floor the gap rule does not fire", has(r, FINDING.CADENCE_STEADY));
  eq("...and the allowed window is stated", first(r, FINDING.CADENCE_STEADY).figures.allowedSeconds, "3600");
}
{
  const set = [rec({i: 63, ts: 0}), rec({i: 64, ts: 10}), rec({i: 65, ts: 20})];
  // SABOTAGE: one second past the floor.
  const r = run(set, {asOf: String(1_770_000_000 + 20 + 3601)});
  check("one second past the floor it fires", has(r, FINDING.CADENCE_GAP));
  const f = first(r, FINDING.CADENCE_GAP);
  eq("...reporting the age it fired on", f.figures.ageSeconds, "3601");
  eq("...and the median gap it compared against", f.figures.medianGapSeconds, "10");
  eq("...and pointing at the last receipt", f.entityIds.join(","), "0x0065");
  check("...and saying silence is not proof of non-payment",
        f.statement.includes("not proof that nothing was paid"), f.statement);
}
{
  // The multiple dominates when the merchant settles slowly: gaps of 10000s -> allowed 30000s.
  const set = [rec({i: 66, ts: 0}), rec({i: 67, ts: 10_000}), rec({i: 68, ts: 20_000})];
  const steady = run(set, {asOf: String(1_770_000_000 + 20_000 + 30_000)});
  check("at exactly median gap x 3 the rule does not fire", has(steady, FINDING.CADENCE_STEADY));
  const fired = run(set, {asOf: String(1_770_000_000 + 20_000 + 30_001)});
  check("one second past median gap x 3 it fires", has(fired, FINDING.CADENCE_GAP));
}
{
  const r = run([rec({i: 69, ts: 0})]);
  eq("one settlement has no cadence at all", r.cadence, null);
  check("...and no cadence finding is emitted",
        !has(r, FINDING.CADENCE_GAP) && !has(r, FINDING.CADENCE_STEADY));
}

// ---- unusual amounts, against the merchant's own history ---------------------------------------------
//
// 90, 95, 100, 100, 100, 105, 110 plus a candidate. Median 100; deviations 10, 5, 0, 0, 0, 5, 10 plus
// the candidate's; the median absolute deviation is 5, so the threshold is 5 x 5 = 25.

const HISTORY = [90n, 95n, 100n, 100n, 100n, 105n, 110n];
{
  // CONTROL: the candidate deviates by exactly 25. Not GREATER than the threshold, so not unusual.
  const set = [...HISTORY, 125n].map((amount, k) => rec({i: 70 + k, amount, ts: k * 60}));
  const r = run(set);
  check("a deviation of exactly 5 median absolute deviations is not unusual", has(r, FINDING.AMOUNTS_WITHIN_HISTORY),
        JSON.stringify(findingsOf(r, FINDING.UNUSUAL_AMOUNT)[0]?.figures ?? {}));
  eq("...and the median it measured against is stated",
     first(r, FINDING.AMOUNTS_WITHIN_HISTORY).figures.median, "100");
  eq("...and the median absolute deviation",
     first(r, FINDING.AMOUNTS_WITHIN_HISTORY).figures.medianAbsoluteDeviation, "5");
}
{
  // SABOTAGE: one unit further out. 126 deviates by 26, which is past 25.
  const set = [...HISTORY, 126n].map((amount, k) => rec({i: 80 + k, amount, ts: k * 60}));
  const r = run(set);
  const f = first(r, FINDING.UNUSUAL_AMOUNT);
  check("one unit past the threshold is unusual", has(r, FINDING.UNUSUAL_AMOUNT));
  eq("...and exactly one row is named", f.entityIds.length, 1);
  eq("...and it is the right row", f.entityIds[0], "0x0087");
  eq("...and the amount is quoted", f.figures.amounts, "126");
  check("...and unusual is not called wrong", f.statement.includes("Unusual is not wrong"), f.statement);
}
{
  // The zero-deviation case: five identical receipts, then a different one.
  const same = [100n, 100n, 100n, 100n, 100n].map((amount, k) => rec({i: 90 + k, amount, ts: k * 60}));
  const control = run(same);
  check("control: an unbroken run of identical amounts is within history",
        has(control, FINDING.AMOUNTS_WITHIN_HISTORY));
  eq("...with a median absolute deviation of zero",
     first(control, FINDING.AMOUNTS_WITHIN_HISTORY).figures.medianAbsoluteDeviation, "0");

  const broken = [...same, rec({i: 95, amount: 101n, ts: 300})];
  const r = run(broken);
  check("a single different amount after identical history is unusual", has(r, FINDING.UNUSUAL_AMOUNT));
  check("...and the rule says why the threshold was zero",
        first(r, FINDING.UNUSUAL_AMOUNT).rule.includes("identical"), first(r, FINDING.UNUSUAL_AMOUNT).rule);
}
{
  // Below the minimum history there is no check at all, and it says so.
  const set = [100n, 100n, 100n, 999n].map((amount, k) => rec({i: 100 + k, amount, ts: k * 60}));
  const r = run(set);
  check("below the minimum history no amount check is made", !has(r, FINDING.UNUSUAL_AMOUNT));
  const insufficient = findingsOf(r, FINDING.INSUFFICIENT_DATA).find((f) => f.rule.includes("unusual-amount")) ?? NO_FINDING;
  check("...and says so rather than staying silent", insufficient !== NO_FINDING);
  eq("...naming the minimum", insufficient.figures.required, String(THRESHOLDS.minSettlementsForUnusual));
}

// ---- the bounded reserve suggestion -------------------------------------------------------------------

{
  // Four receipts of 100 at 0, 100, 200, 500. Gaps 100, 100, 300 -> median 100, longest 300.
  // ceil(300/100) = 3 median receipts = 300. Received 400, cap 10 x 100 = 1000. CADENCE binds.
  const set = [
    rec({i: 110, amount: 100n, ts: 0}),
    rec({i: 111, amount: 100n, ts: 100}),
    rec({i: 112, amount: 100n, ts: 200}),
    rec({i: 113, amount: 100n, ts: 500}),
  ];
  const reserved = run(set, {asOf: String(1_770_000_000 + 600)});
  const f = first(reserved, FINDING.RESERVE_SUGGESTION);
  check("a reserve is suggested once there is enough history", has(reserved, FINDING.RESERVE_SUGGESTION));
  eq("...and it is the cadence figure", f.figures.suggested, "300");
  eq("...bound by the cadence rule, not a cap", f.figures.boundedBy, "CADENCE");
  eq("...covering the right number of median receipts", f.figures.coverCount, "3");
  eq("...against the longest observed gap", f.figures.longestGapSeconds, "300");
  check("...and it does not call itself advice", f.statement.includes("not financial advice"), f.statement);
  eq("...and it names the ids it was computed from", f.entityIds.length, 4);
}
{
  // The total received binds: gaps 100, 100, 500 -> ceil(500/100) = 5 receipts = 500, but only 400
  // has ever been received.
  const set = [
    rec({i: 120, amount: 100n, ts: 0}),
    rec({i: 121, amount: 100n, ts: 100}),
    rec({i: 122, amount: 100n, ts: 200}),
    rec({i: 123, amount: 100n, ts: 700}),
  ];
  const f = first(run(set, {asOf: String(1_770_000_000 + 800)}), FINDING.RESERVE_SUGGESTION);
  eq("the suggestion never exceeds what was actually received", f.figures.suggested, "400");
  eq("...and names TOTAL_RECEIVED as the binding constraint", f.figures.boundedBy, "TOTAL_RECEIVED");
}
{
  // The cover-count cap binds: fifteen receipts of 100 (received 1500), one enormous gap so the
  // cadence arithmetic asks for 50 receipts. The cap is 10 x 100 = 1000, which is below both.
  const set = [];
  for (let k = 0; k < 14; k++) set.push(rec({i: 130 + k, amount: 100n, ts: k * 100}));
  set.push(rec({i: 150, amount: 100n, ts: 1300 + 5000}));
  const f = first(run(set, {asOf: String(1_770_000_000 + 6400)}), FINDING.RESERVE_SUGGESTION);
  eq("the cover-count cap bounds a runaway cadence figure", f.figures.suggested, "1000");
  eq("...and names COVER_COUNT_CAP", f.figures.boundedBy, "COVER_COUNT_CAP");
  eq("...and reports the uncapped figure it refused to use", f.figures.uncappedCoverCount, "50");
}
{
  // SABOTAGE: three receipts is below the minimum, so no number at all.
  const set = [rec({i: 160, amount: 100n, ts: 0}), rec({i: 161, amount: 100n, ts: 100}), rec({i: 162, amount: 100n, ts: 200})];
  const r = run(set, {asOf: String(1_770_000_000 + 300)});
  check("below the minimum history no reserve is suggested", !has(r, FINDING.RESERVE_SUGGESTION));
  check("...and it says why", has(r, FINDING.RESERVE_NOT_COMPUTABLE));
  check("...rather than producing a guess with a decimal point",
        first(r, FINDING.RESERVE_NOT_COMPUTABLE).statement.includes("guess wearing a decimal point"));
}

// ---- requested versus delivered ---------------------------------------------------------------------

{
  const set = [
    rec({i: 170, amount: 100n, ts: 0}),
    rec({i: 171, amount: 100n, delivered: 99n, ts: 60}),
    rec({i: 172, amount: 100n, ts: 120}),
  ];
  const r = run(set);
  const f = first(r, FINDING.DELIVERY_SHORTFALL);
  check("a receipt whose delivered amount differs from the requested one is a finding",
        has(r, FINDING.DELIVERY_SHORTFALL));
  eq("...at ACTION severity", f.severity, SEVERITY.ACTION);
  eq("...naming the single row", f.entityIds.join(","), "0x0171");
  eq("...with both figures", `${f.figures.firstRequested}/${f.figures.firstDelivered}`, "100/99");
  eq("...and the verdict escalates", r.verdict, VERDICT.ACTION_REQUIRED);
}
{
  // CONTROL: the same three rows with delivery equal to the request.
  const set = [
    rec({i: 173, amount: 100n, ts: 0}),
    rec({i: 174, amount: 100n, ts: 60}),
    rec({i: 175, amount: 100n, ts: 120}),
  ];
  const r = run(set);
  check("control: equal amounts produce no shortfall finding", !has(r, FINDING.DELIVERY_SHORTFALL));
  check("...and the verdict is not ACTION_REQUIRED", r.verdict !== VERDICT.ACTION_REQUIRED, r.verdict);
}

// ---- two payout tokens are never summed ---------------------------------------------------------------

{
  const set = [
    rec({i: 180, amount: 100n, token: USDC, ts: 0}),
    rec({i: 181, amount: 200n, token: DAI, ts: 60}),
    rec({i: 182, amount: 300n, token: USDC, ts: 120}),
  ];
  const r = run(set);
  eq("two payout tokens produce two separate totals", r.byToken.length, 2);
  check("...and the multi-token statement is made", has(r, FINDING.MULTI_TOKEN_TREASURY));
  check("...and there is no report-level total across them",
        r.totalRequested === undefined && r.totalDelivered === undefined && r.totalVolume === undefined,
        "a figure spanning two decimal scales exists in the report");
  const usdc = r.byToken.find((t) => t.token === USDC);
  const dai = r.byToken.find((t) => t.token === DAI);
  eq("...USDC's total is its own", usdc.totalRequested, "400");
  eq("...DAI's total is its own", dai.totalRequested, "200");
}

// ---- every finding is auditable, and the vocabulary is closed --------------------------------------------

{
  const scenarios = [
    run([]),
    run([rec({i: 190, amount: 100n})]),
    run([...HISTORY, 126n].map((amount, k) => rec({i: 200 + k, amount, ts: k * 60}))),
    run([
      rec({i: 210, payer: PAYER_A, amount: 3000n, ts: 0}),
      rec({i: 211, payer: PAYER_A, amount: 3000n, ts: 60}),
      rec({i: 212, payer: PAYER_B, amount: 4000n, delivered: 3999n, ts: 120}),
    ]),
    analyse({settlements: [rec({i: 213, source: OFFLINE_SOURCE})], source: LIVE_SOURCE, asOfTimestamp: AS_OF}),
    analyse({settlements: "x", source: LIVE_SOURCE, asOfTimestamp: AS_OF}),
  ];
  const names = new Set(Object.values(FINDING));
  const severities = new Set(Object.values(SEVERITY));
  const verdicts = new Set(Object.values(VERDICT));
  let emitted = 0;
  let outside = [];
  let unaudited = [];
  for (const r of scenarios) {
    if (!verdicts.has(r.verdict)) outside.push(`verdict ${r.verdict}`);
    for (const f of r.findings) {
      emitted++;
      if (!names.has(f.finding)) outside.push(f.finding);
      if (!severities.has(f.severity)) outside.push(`severity ${f.severity}`);
      if (typeof f.rule !== "string" || f.rule.length === 0) unaudited.push(`${f.finding}: no rule`);
      if (typeof f.statement !== "string" || f.statement.length === 0) unaudited.push(`${f.finding}: no statement`);
      if (f.figures === undefined || typeof f.figures !== "object") unaudited.push(`${f.finding}: no figures`);
      if (!Array.isArray(f.entityIds)) unaudited.push(`${f.finding}: no entity ids`);
    }
  }
  check(`every finding emitted across ${scenarios.length} scenarios is in the closed vocabulary (${emitted} findings)`,
        outside.length === 0, outside);
  check("every finding carries its rule, its figures and the ids they came from", unaudited.length === 0, unaudited);
  check("control: the scenarios actually emitted findings", emitted > 0, "the loop above proved nothing");
}

// ---- the whole offline sample set, end to end -------------------------------------------------------------

{
  const r = analyse({settlements: offlineSettlements(), source: OFFLINE_SOURCE, asOfTimestamp: OFFLINE_AS_OF});
  eq("the sample set analyses", r.usable, true);
  eq("...as seven settlements", r.settlementCount, 7);
  eq("...in one payout token", r.byToken.length, 1);
  check("...with the concentration the sample was built to show", has(r, FINDING.SINGLE_PAYER_CONCENTRATION));
  check("...and the outlier receipt it was built to contain", has(r, FINDING.UNUSUAL_AMOUNT));
  check("...and a bounded reserve", has(r, FINDING.RESERVE_SUGGESTION));
  eq("...and the report names the sample as its source", r.dataSource, OFFLINE_SOURCE);
}

finished = true;
console.log("UNICA V2 — treasury copilot rules, boundaries and sabotage rows");
console.log(rows.join("\n"));
console.log(`\nchecks run: ${passed + failed}, passed: ${passed}, failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
