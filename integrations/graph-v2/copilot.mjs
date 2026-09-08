// The merchant treasury copilot: a DETERMINISTIC ANALYST over live indexed data.
//
// THE "AI" HERE IS AN ANALYST, NOT A LANGUAGE MODEL, AND THAT IS A DELIBERATE CHOICE. Every
// recommendation this file produces carries three things: the rule that fired, the exact figures it
// fired on, and the entity ids those figures came from. A reader holding the same subgraph can run
// the same query and re-derive the number themselves. A recommendation you cannot re-derive is a
// recommendation you cannot audit, and a merchant deciding what to hold in reserve is entitled to
// audit it. A model that produced prose about the same rows would be more impressive to read and
// worth strictly less, because nobody could check it and nobody could tell the day it drifted.
//
// So: no model call, no network, no clock, no randomness. The time enters as `asOfTimestamp`, the
// data enters as records, the thresholds enter as a parameter with named defaults. Two runs over
// the same input produce byte-identical output, and the suite asserts exactly that.
//
// WHAT IT DELIBERATELY DOES NOT DO.
//   * It never sums amounts across tokens. Two payout tokens have two decimal scales and two
//     prices; a single "total volume" over both is a number that is wrong in a way that looks
//     right. Every total is per token and says which token.
//   * It never presents a confident zero. An empty result from a receipt indexer proves nothing on
//     its own — the invoices may be unpaid, unknown to this subgraph, or simply not indexed yet —
//     so an empty set produces INSUFFICIENT_DATA and no totals at all.
//   * It never converts to fiat, never prices a token, and never says a treasury is "healthy". It
//     reports shares, gaps and deviations against the merchant's OWN history, which is the only
//     baseline it actually has.
//   * It never guesses the provenance of its input. Every record must carry the same `source`
//     stamp as the declared source, so an offline sample set cannot be analysed as a live one.

/// Closed. A caller switching on severity cannot be handed a fourth value.
export const SEVERITY = Object.freeze({
  /// Worth knowing. No action implied.
  INFO: "INFO",
  /// A human should look at this before the next invoice.
  ATTENTION: "ATTENTION",
  /// Something is either wrong or outside the merchant's own history far enough to stop on.
  ACTION: "ACTION",
});

/// The closed vocabulary of findings. Nothing outside this map is ever emitted; `check.mjs`
/// asserts that every finding name used in this file is declared here.
export const FINDING = Object.freeze({
  /// The input could not be analysed at all. Never a partial answer.
  INPUT_REJECTED: "INPUT_REJECTED",
  /// The records do not all agree on where they came from.
  SOURCE_NOT_ESTABLISHED: "SOURCE_NOT_ESTABLISHED",
  /// Nothing was returned, or too little to say anything. Explicitly NOT a zero-volume finding.
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  /// One payer is at or above the high share threshold of a payout token's volume.
  SINGLE_PAYER_CONCENTRATION: "SINGLE_PAYER_CONCENTRATION",
  /// No payer reaches the moderate share threshold.
  PAYER_BASE_DIVERSE: "PAYER_BASE_DIVERSE",
  /// Nothing has settled for longer than this merchant's own cadence predicts.
  CADENCE_GAP: "CADENCE_GAP",
  /// Receipts are arriving within the merchant's own normal spacing.
  CADENCE_STEADY: "CADENCE_STEADY",
  /// A receipt is far outside the merchant's own amount history.
  UNUSUAL_AMOUNT: "UNUSUAL_AMOUNT",
  /// Every receipt sits inside the merchant's own amount history.
  AMOUNTS_WITHIN_HISTORY: "AMOUNTS_WITHIN_HISTORY",
  /// A bounded reserve, with the bound that produced it named.
  RESERVE_SUGGESTION: "RESERVE_SUGGESTION",
  /// A reserve was not suggested, and why.
  RESERVE_NOT_COMPUTABLE: "RESERVE_NOT_COMPUTABLE",
  /// Requested and delivered differ. The executor forbids that, so a row showing it means either
  /// the receipt or the index is wrong — and either way it is not a rounding difference to absorb.
  DELIVERY_SHORTFALL: "DELIVERY_SHORTFALL",
  /// More than one payout token. Stated because it is why there is no single total.
  MULTI_TOKEN_TREASURY: "MULTI_TOKEN_TREASURY",
});

/// The one-line verdict, closed. `live-proof.mjs` prints this and nothing outside it exists.
export const VERDICT = Object.freeze({
  INPUT_REJECTED: "INPUT_REJECTED",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  ATTENTION_ADVISED: "ATTENTION_ADVISED",
  STEADY: "STEADY",
});

/// Defaults, all named and all overridable. They are policy, not arithmetic: a merchant with three
/// customers by design should raise the concentration thresholds rather than be told off weekly.
export const THRESHOLDS = Object.freeze({
  /// A single payer at or above this share of one payout token's volume, in basis points.
  concentrationHighBps: 6000n,
  /// Below this, the payer base is called diverse.
  concentrationModerateBps: 3300n,
  /// Fewer settlements than this and concentration is not computed at all: one receipt is always
  /// 100% of one receipt, and reporting that as concentration risk would be a rule firing on noise.
  minSettlementsForConcentration: 3,
  /// How many multiples of the merchant's own median gap may pass before silence is a finding.
  cadenceGapMultiple: 3n,
  /// And a floor, so a merchant settling every ten seconds is not alerted twice a minute.
  cadenceGapFloorSeconds: 3600n,
  /// Fewer than this and "unusual" has no history to be unusual against.
  minSettlementsForUnusual: 5,
  /// Deviation from the median, in multiples of the median absolute deviation.
  unusualMadMultiple: 5n,
  /// Fewer than this and no reserve is suggested.
  minSettlementsForReserve: 4,
  /// The hard ceiling on the reserve rule: never more than this many median receipts, whatever the
  /// cadence arithmetic says. A suggestion without a ceiling is not a suggestion, it is a leak.
  reserveMaxCoverCount: 10n,
});

/// The fields a record must carry for this file to work. `check.mjs` asserts each one is a field of
/// InvoiceSettlement in schema.graphql and is selected by the provider's query, so a schema rename
/// fails the gate rather than producing a report full of `undefined`.
export const REQUIRED_FIELDS = Object.freeze([
  "id",
  "payer",
  "recipient",
  "tokenOut",
  "amountOut",
  "deliveredOut",
  "blockNumber",
  "blockTimestamp",
]);

const DIGITS = /^(0|[1-9][0-9]*)$/;

function isCount(v) {
  return typeof v === "string" && DIGITS.test(v);
}

function big(v) {
  return BigInt(v);
}

/// Median of a sorted BigInt array. Even counts take the floor of the mean of the two middles, so
/// the result is an integer and the same input always gives the same answer.
function median(sortedAscending) {
  const n = sortedAscending.length;
  if (n === 0) return null;
  if (n % 2 === 1) return sortedAscending[(n - 1) / 2];
  return (sortedAscending[n / 2 - 1] + sortedAscending[n / 2]) / 2n;
}

function sortBig(values) {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/// Median absolute deviation: the median of the distances from the median. Chosen over a standard
/// deviation because one 25x receipt would inflate a standard deviation enough to hide itself.
function medianAbsoluteDeviation(values, med) {
  return median(sortBig(values.map((v) => (v > med ? v - med : med - v))));
}

function finding(name, severity, rule, statement, figures, entityIds) {
  return {
    finding: name,
    severity,
    rule,
    statement,
    figures,
    entityIds,
  };
}

function rejected(reason, detail) {
  return {
    usable: false,
    verdict: VERDICT.INPUT_REJECTED,
    dataSource: null,
    asOfTimestamp: null,
    settlementCount: 0,
    byToken: [],
    byPayer: [],
    cadence: null,
    findings: [
      finding(
        FINDING.INPUT_REJECTED,
        SEVERITY.ACTION,
        "every record must carry the required fields, agree on their source, and be analysed as of a supplied timestamp",
        reason,
        detail ?? {},
        [],
      ),
    ],
  };
}

/// The whole analysis. Pure: same input, same output, every time.
///
/// @param settlements  records as the provider returns them, each stamped with its source
/// @param source       the source those records are declared to have come from
/// @param asOfTimestamp  the moment to analyse as of, as a decimal string of unix seconds
export function analyse({settlements, source, asOfTimestamp, thresholds = {}} = {}) {
  const T = {...THRESHOLDS, ...thresholds};

  if (!Array.isArray(settlements)) {
    return rejected("`settlements` is not an array", {received: typeof settlements});
  }
  if (typeof source !== "string" || source.length === 0) {
    return rejected("no source was declared; a report that cannot say where its rows came from is not a report", {});
  }
  if (!isCount(asOfTimestamp)) {
    return rejected("`asOfTimestamp` is required and must be a decimal string of unix seconds", {
      received: String(asOfTimestamp),
    });
  }

  // Provenance before arithmetic. A set whose records disagree about where they came from is not a
  // set that may be summed.
  const stamps = new Set(settlements.map((r) => (r && typeof r === "object" ? r.source : undefined)));
  if (settlements.length > 0 && (stamps.size !== 1 || !stamps.has(source))) {
    return {
      usable: false,
      verdict: VERDICT.INPUT_REJECTED,
      dataSource: "SOURCE_NOT_ESTABLISHED",
      asOfTimestamp,
      settlementCount: settlements.length,
      byToken: [],
      byPayer: [],
      cadence: null,
      findings: [
        finding(
          FINDING.SOURCE_NOT_ESTABLISHED,
          SEVERITY.ACTION,
          "every record must carry the same `source` stamp as the declared source",
          "the records do not all agree on where they came from, so no total over them means anything",
          {declaredSource: source, stampsSeen: [...stamps].map((s) => String(s)).sort().join(", ")},
          [],
        ),
      ],
    };
  }

  for (let i = 0; i < settlements.length; i++) {
    const r = settlements[i];
    if (r === null || typeof r !== "object") return rejected(`record ${i} is not an object`, {index: String(i)});
    for (const f of REQUIRED_FIELDS) {
      if (r[f] === undefined || r[f] === null) {
        return rejected(`record ${i} is missing the field \`${f}\``, {index: String(i), field: f});
      }
    }
    for (const f of ["amountOut", "deliveredOut", "blockNumber", "blockTimestamp"]) {
      if (!isCount(String(r[f]))) {
        return rejected(`record ${i} field \`${f}\` is not a non-negative integer`, {
          index: String(i),
          field: f,
          value: String(r[f]),
        });
      }
    }
  }

  const asOf = big(asOfTimestamp);
  const findings = [];

  // ---- nothing to analyse ---------------------------------------------------------------------
  //
  // Explicitly not a zero. The V2 indexer's own documentation says an empty result proves nothing
  // on its own, and a treasury view that renders "volume: 0" over an empty result has quietly
  // converted "we do not know" into "there was none".
  if (settlements.length === 0) {
    findings.push(
      finding(
        FINDING.INSUFFICIENT_DATA,
        SEVERITY.INFO,
        "no settlements were returned for this merchant",
        "no receipts were indexed for this recipient. That is NOT a zero-volume finding: an invoice may be unpaid, "
          + "unknown to this subgraph, settled on another deployment, or simply not indexed yet. No totals are reported.",
        {settlementCount: "0"},
        [],
      ),
    );
    return {
      usable: false,
      verdict: VERDICT.INSUFFICIENT_DATA,
      dataSource: source,
      asOfTimestamp,
      settlementCount: 0,
      byToken: [],
      byPayer: [],
      cadence: null,
      findings,
    };
  }

  // A total order, so the report does not depend on the order the rows arrived in.
  const rows = [...settlements].sort((a, b) => {
    const ba = big(a.blockNumber);
    const bb = big(b.blockNumber);
    if (ba !== bb) return ba < bb ? -1 : 1;
    const la = big(a.logIndex ?? 0);
    const lb = big(b.logIndex ?? 0);
    if (la !== lb) return la < lb ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });

  // ---- per payout token: volume, count and shape ------------------------------------------------
  //
  // Per token, never across. Two payout tokens have two decimal scales; adding them produces a
  // number that is arithmetically valid and financially meaningless.
  const tokens = [...new Set(rows.map((r) => String(r.tokenOut).toLowerCase()))].sort();
  const byToken = [];
  for (const token of tokens) {
    const inToken = rows.filter((r) => String(r.tokenOut).toLowerCase() === token);
    const amounts = inToken.map((r) => big(r.amountOut));
    const sorted = sortBig(amounts);
    const med = median(sorted);
    byToken.push({
      token,
      count: inToken.length,
      totalRequested: amounts.reduce((a, b) => a + b, 0n).toString(),
      totalDelivered: inToken.map((r) => big(r.deliveredOut)).reduce((a, b) => a + b, 0n).toString(),
      minAmount: sorted[0].toString(),
      maxAmount: sorted[sorted.length - 1].toString(),
      medianAmount: med.toString(),
      settlementIds: inToken.map((r) => String(r.id)),
    });
  }

  if (byToken.length > 1) {
    findings.push(
      finding(
        FINDING.MULTI_TOKEN_TREASURY,
        SEVERITY.INFO,
        "more than one payout token appears in this merchant's receipts",
        "totals are reported per token and are never added together: two payout tokens have two decimal scales, "
          + "and a single figure spanning both would be wrong in a way that looks right.",
        {tokens: tokens.join(", "), tokenCount: String(byToken.length)},
        [],
      ),
    );
  }

  // ---- requested versus delivered ----------------------------------------------------------------
  const shortfalls = rows.filter((r) => big(r.amountOut) !== big(r.deliveredOut));
  if (shortfalls.length > 0) {
    findings.push(
      finding(
        FINDING.DELIVERY_SHORTFALL,
        SEVERITY.ACTION,
        "amountOut must equal deliveredOut in every receipt; the executor reverts otherwise",
        `${shortfalls.length} indexed receipt(s) show a requested amount that differs from the delivered amount. `
          + "The executor forbids that, so either the receipt or the index is wrong. Verify the transaction before "
          + "treating these rows as settled.",
        {
          affected: String(shortfalls.length),
          firstRequested: big(shortfalls[0].amountOut).toString(),
          firstDelivered: big(shortfalls[0].deliveredOut).toString(),
        },
        shortfalls.map((r) => String(r.id)),
      ),
    );
  }

  // ---- concentration: what share came from the single largest payer -------------------------------
  const byPayer = [];
  for (const t of byToken) {
    const inToken = rows.filter((r) => String(r.tokenOut).toLowerCase() === t.token);
    const totals = new Map();
    for (const r of inToken) {
      const p = String(r.payer).toLowerCase();
      const prev = totals.get(p) ?? {total: 0n, count: 0, ids: []};
      prev.total += big(r.amountOut);
      prev.count += 1;
      prev.ids.push(String(r.id));
      totals.set(p, prev);
    }
    const tokenTotal = big(t.totalRequested);
    const ranked = [...totals.entries()]
      .map(([payer, v]) => ({
        payer,
        token: t.token,
        count: v.count,
        total: v.total.toString(),
        shareBps: (tokenTotal === 0n ? 0n : (v.total * 10000n) / tokenTotal).toString(),
        settlementIds: v.ids,
      }))
      // Largest first; ties broken by address so the ordering is total and reproducible.
      .sort((a, b) => (big(b.total) - big(a.total) !== 0n ? (big(b.total) > big(a.total) ? 1 : -1) : a.payer < b.payer ? -1 : 1));
    byPayer.push(...ranked);

    if (t.count < T.minSettlementsForConcentration) {
      findings.push(
        finding(
          FINDING.INSUFFICIENT_DATA,
          SEVERITY.INFO,
          `concentration needs at least ${T.minSettlementsForConcentration} settlements in a token`,
          `concentration was not computed for ${t.token}: ${t.count} settlement(s) is not a payer base. `
            + "One receipt is always 100% of one receipt, and reporting that as a risk would be a rule firing on noise.",
          {token: t.token, settlementCount: String(t.count), required: String(T.minSettlementsForConcentration)},
          t.settlementIds,
        ),
      );
      continue;
    }

    const top = ranked[0];
    const shareBps = big(top.shareBps);
    if (shareBps >= T.concentrationHighBps) {
      findings.push(
        finding(
          FINDING.SINGLE_PAYER_CONCENTRATION,
          SEVERITY.ATTENTION,
          `a single payer's share of one payout token is at or above ${T.concentrationHighBps} bps`,
          `${top.shareBps} bps of this merchant's ${t.token} receipts came from one payer across ${top.count} settlement(s). `
            + "Losing that payer removes that share of the receipts; a reserve sized on total volume would be sized on a "
            + "volume that is one counterparty's decision.",
          {
            token: t.token,
            payer: top.payer,
            payerTotal: top.total,
            tokenTotal: t.totalRequested,
            shareBps: top.shareBps,
            thresholdBps: T.concentrationHighBps.toString(),
          },
          top.settlementIds,
        ),
      );
    } else if (shareBps < T.concentrationModerateBps) {
      findings.push(
        finding(
          FINDING.PAYER_BASE_DIVERSE,
          SEVERITY.INFO,
          `no payer reaches ${T.concentrationModerateBps} bps of one payout token`,
          `the largest single payer accounts for ${top.shareBps} bps of this merchant's ${t.token} receipts.`,
          {
            token: t.token,
            payer: top.payer,
            shareBps: top.shareBps,
            thresholdBps: T.concentrationModerateBps.toString(),
          },
          top.settlementIds,
        ),
      );
    }
  }

  // ---- cadence: the merchant's own rhythm, and the silence since --------------------------------
  let cadence = null;
  if (rows.length >= 2) {
    const gaps = [];
    for (let i = 1; i < rows.length; i++) {
      gaps.push(big(rows[i].blockTimestamp) - big(rows[i - 1].blockTimestamp));
    }
    const sortedGaps = sortBig(gaps);
    const medGap = median(sortedGaps);
    let longestIndex = 0;
    for (let i = 1; i < gaps.length; i++) if (gaps[i] > gaps[longestIndex]) longestIndex = i;
    const last = rows[rows.length - 1];
    const age = asOf - big(last.blockTimestamp);
    cadence = {
      medianGapSeconds: medGap.toString(),
      longestGapSeconds: gaps[longestIndex].toString(),
      longestGapBetween: [String(rows[longestIndex].id), String(rows[longestIndex + 1].id)],
      lastTimestamp: String(last.blockTimestamp),
      lastSettlementId: String(last.id),
      ageSeconds: age.toString(),
    };

    const allowed = medGap * T.cadenceGapMultiple > T.cadenceGapFloorSeconds
      ? medGap * T.cadenceGapMultiple
      : T.cadenceGapFloorSeconds;
    if (age > allowed) {
      findings.push(
        finding(
          FINDING.CADENCE_GAP,
          SEVERITY.ATTENTION,
          `nothing has settled for longer than max(median gap x ${T.cadenceGapMultiple}, ${T.cadenceGapFloorSeconds}s)`,
          `${age} seconds have passed since the last indexed receipt; this merchant's median gap is ${medGap} seconds. `
            + "An indexer's silence is not proof that nothing was paid — it is a reason to check the invoices directly.",
          {
            ageSeconds: age.toString(),
            medianGapSeconds: medGap.toString(),
            allowedSeconds: allowed.toString(),
            asOfTimestamp,
          },
          [String(last.id)],
        ),
      );
    } else {
      findings.push(
        finding(
          FINDING.CADENCE_STEADY,
          SEVERITY.INFO,
          `the time since the last receipt is within max(median gap x ${T.cadenceGapMultiple}, ${T.cadenceGapFloorSeconds}s)`,
          `${age} seconds since the last indexed receipt, against a median gap of ${medGap} seconds.`,
          {ageSeconds: age.toString(), medianGapSeconds: medGap.toString(), allowedSeconds: allowed.toString()},
          [String(last.id)],
        ),
      );
    }
  }

  // ---- unusual amounts, against this merchant's OWN history --------------------------------------
  for (const t of byToken) {
    const inToken = rows.filter((r) => String(r.tokenOut).toLowerCase() === t.token);
    if (inToken.length < T.minSettlementsForUnusual) {
      findings.push(
        finding(
          FINDING.INSUFFICIENT_DATA,
          SEVERITY.INFO,
          `an unusual-amount check needs at least ${T.minSettlementsForUnusual} settlements in a token`,
          `no amount check for ${t.token}: ${inToken.length} settlement(s) is not a history to be unusual against.`,
          {token: t.token, settlementCount: String(inToken.length), required: String(T.minSettlementsForUnusual)},
          t.settlementIds,
        ),
      );
      continue;
    }
    const amounts = inToken.map((r) => big(r.amountOut));
    const med = median(sortBig(amounts));
    const mad = medianAbsoluteDeviation(amounts, med);
    const unusual = inToken.filter((r) => {
      const v = big(r.amountOut);
      const deviation = v > med ? v - med : med - v;
      // With a zero deviation every receipt so far has been identical, so "different at all" is the
      // only honest threshold. Otherwise: further than N median deviations from the median.
      return mad === 0n ? deviation > 0n : deviation > mad * T.unusualMadMultiple;
    });
    if (unusual.length > 0) {
      findings.push(
        finding(
          FINDING.UNUSUAL_AMOUNT,
          SEVERITY.ATTENTION,
          mad === 0n
            ? "every previous receipt in this token was identical, so any different amount is outside the history"
            : `an amount further than ${T.unusualMadMultiple} median absolute deviations from this merchant's own median`,
          `${unusual.length} receipt(s) in ${t.token} sit outside this merchant's own amount history `
            + `(median ${med}, median absolute deviation ${mad}). Unusual is not wrong: a large legitimate invoice looks `
            + "exactly like this. It is a row to confirm, not a row to reject.",
          {
            token: t.token,
            median: med.toString(),
            medianAbsoluteDeviation: mad.toString(),
            multiple: T.unusualMadMultiple.toString(),
            amounts: unusual.map((r) => big(r.amountOut).toString()).join(", "),
          },
          unusual.map((r) => String(r.id)),
        ),
      );
    } else {
      findings.push(
        finding(
          FINDING.AMOUNTS_WITHIN_HISTORY,
          SEVERITY.INFO,
          `no amount is further than ${T.unusualMadMultiple} median absolute deviations from the median`,
          `every ${t.token} receipt sits inside this merchant's own amount history (median ${med}, median absolute deviation ${mad}).`,
          {token: t.token, median: med.toString(), medianAbsoluteDeviation: mad.toString()},
          [],
        ),
      );
    }
  }

  // ---- a BOUNDED reserve suggestion ----------------------------------------------------------------
  //
  // The rule: cover the merchant's longest observed dry spell at their own median receipt rate,
  // capped at reserveMaxCoverCount median receipts and never more than they have actually received
  // in this window. Both caps are reported, and the one that bound the answer is named — an
  // unbounded suggestion is not a suggestion.
  for (const t of byToken) {
    const inToken = rows.filter((r) => String(r.tokenOut).toLowerCase() === t.token);
    if (inToken.length < T.minSettlementsForReserve || cadence === null) {
      findings.push(
        finding(
          FINDING.RESERVE_NOT_COMPUTABLE,
          SEVERITY.INFO,
          `a reserve suggestion needs at least ${T.minSettlementsForReserve} settlements in a token and a measurable cadence`,
          `no reserve suggested for ${t.token}: ${inToken.length} settlement(s)`
            + `${cadence === null ? " and no measurable cadence" : ""}. A number produced from this little history would be `
            + "a guess wearing a decimal point.",
          {token: t.token, settlementCount: String(inToken.length), required: String(T.minSettlementsForReserve)},
          t.settlementIds,
        ),
      );
      continue;
    }
    const medGap = big(cadence.medianGapSeconds);
    const longest = big(cadence.longestGapSeconds);
    // How many median receipts the longest observed silence would have cost, rounded up.
    const rawCover = medGap === 0n ? 1n : (longest + medGap - 1n) / medGap;
    const coverCount = rawCover < 1n ? 1n : rawCover > T.reserveMaxCoverCount ? T.reserveMaxCoverCount : rawCover;
    const medAmount = big(t.medianAmount);
    const received = big(t.totalDelivered);

    // Three bounds, and the answer is the smallest of them. The one that is REPORTED is the one
    // that actually produced the number: naming a cap that was not the binding constraint would be
    // a statement about the arithmetic that is false, and this file's whole claim is that its
    // statements can be re-derived. Ties keep CADENCE, because a cap that changed nothing did not
    // bind anything.
    const candidates = [
      {name: "CADENCE", value: medAmount * (rawCover < 1n ? 1n : rawCover)},
      {name: "COVER_COUNT_CAP", value: medAmount * T.reserveMaxCoverCount},
      {name: "TOTAL_RECEIVED", value: received},
    ];
    let chosen = candidates[0];
    for (const c of candidates.slice(1)) if (c.value < chosen.value) chosen = c;
    const suggested = chosen.value;
    const boundedBy = chosen.name;
    findings.push(
      finding(
        FINDING.RESERVE_SUGGESTION,
        SEVERITY.INFO,
        "reserve = median receipt x ceil(longest observed gap / median gap), capped at "
          + `${T.reserveMaxCoverCount} median receipts and at the total actually received`,
        `holding ${suggested} of ${t.token} covers this merchant's longest observed silence `
          + `(${longest}s against a median gap of ${medGap}s) at their own median receipt of ${medAmount}. `
          + `The binding constraint was ${boundedBy}. This is an arithmetic suggestion over indexed receipts, `
          + "not financial advice, and it prices nothing.",
        {
          token: t.token,
          suggested: suggested.toString(),
          medianAmount: medAmount.toString(),
          coverCount: coverCount.toString(),
          uncappedCoverCount: rawCover.toString(),
          longestGapSeconds: longest.toString(),
          medianGapSeconds: medGap.toString(),
          totalDelivered: received.toString(),
          boundedBy,
        },
        t.settlementIds,
      ),
    );
  }

  const worst = findings.some((f) => f.severity === SEVERITY.ACTION)
    ? VERDICT.ACTION_REQUIRED
    : findings.some((f) => f.severity === SEVERITY.ATTENTION)
      ? VERDICT.ATTENTION_ADVISED
      : VERDICT.STEADY;

  return {
    usable: true,
    verdict: worst,
    dataSource: source,
    asOfTimestamp,
    settlementCount: rows.length,
    byToken,
    byPayer,
    cadence,
    findings,
  };
}

/// The report as text. The source is the FIRST line and is never omitted, so an offline run and a
/// live run cannot produce output that looks the same.
export function renderReport(report) {
  const out = [];
  out.push(`DATA SOURCE: ${report.dataSource ?? "(none declared)"}`);
  if (report.dataSource !== "LIVE_SUBGRAPH") {
    out.push("             NOT LIVE DATA — this report was not computed from a live subgraph read.");
  }
  out.push(`VERDICT:     ${report.verdict}`);
  out.push(`as of        ${report.asOfTimestamp ?? "(none)"} (unix seconds)`);
  out.push(`settlements  ${report.settlementCount}`);
  for (const t of report.byToken) {
    out.push(`  token ${t.token}`);
    out.push(`    count ${t.count}  requested ${t.totalRequested}  delivered ${t.totalDelivered}`);
    out.push(`    min ${t.minAmount}  median ${t.medianAmount}  max ${t.maxAmount}`);
  }
  if (report.cadence) {
    out.push(`  cadence  median gap ${report.cadence.medianGapSeconds}s, longest ${report.cadence.longestGapSeconds}s, `
      + `since last ${report.cadence.ageSeconds}s`);
  }
  out.push("");
  for (const f of report.findings) {
    out.push(`  ${f.severity.padEnd(9)} ${f.finding}`);
    out.push(`            rule:   ${f.rule}`);
    out.push(`            says:   ${f.statement}`);
    const figures = Object.entries(f.figures).map(([k, v]) => `${k}=${v}`).join("  ");
    if (figures) out.push(`            on:     ${figures}`);
    if (f.entityIds.length > 0) {
      const shown = f.entityIds.slice(0, 4).join(", ");
      out.push(`            ids:    ${shown}${f.entityIds.length > 4 ? ` (+${f.entityIds.length - 4} more)` : ""}`);
    }
  }
  return out.join("\n");
}
