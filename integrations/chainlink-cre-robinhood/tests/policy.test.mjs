/** Offline. No CRE CLI, no key, no RPC, no network. */
import { readFileSync } from "node:fs";
import { decide, deviationBps, quoteIsFresh, EVIDENCE, VERDICT } from "../policy.mjs";

let ok = 0, fail = 0;
const chk = (n, p, d = "") => { if (p) { ok++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}  [${d}]`); } };

const fx = JSON.parse(readFileSync(new URL("../fixtures/quotes.json", import.meta.url), "utf8"));
const policy = { maxDeviationBps: 250, maxQuoteAgeSeconds: 30, minMerchantOut: "1000000",
  preferredVenue: "settlement", supportedChainIds: [46630] };
const intent = { chainId: 46630, minOut: "30000000" };
const now = 1789060000;

for (const s of fx.scenarios) {
  const useIntent = s.id === "below-floor" ? { ...intent, minOut: "99999999" } : intent;
  const r = decide({ intent: useIntent, referenceQuote: s.reference, settlementQuote: s.settlement,
    policy, nowSeconds: now, evidence: EVIDENCE.MOCK });
  chk(`fixture "${s.id}" -> ${s.expect}`, r.verdict === s.expect, r.verdict);
}

chk("deviation is basis points of the reference", deviationBps("1000", "1100") === 1000);
chk("a zero reference yields null rather than a division", deviationBps("0", "1") === null);
chk("freshness is exclusive at the boundary", quoteIsFresh(100, 130, 30) === false && quoteIsFresh(100, 129, 30) === true);

let threw = false;
try { decide({ intent, referenceQuote: fx.scenarios[0].reference, settlementQuote: fx.scenarios[0].settlement,
  policy, nowSeconds: now, evidence: EVIDENCE.CONFIRMED }); } catch { threw = true; }
chk("control: the workflow may never produce 'confirmed' evidence", threw);

console.log(`\nchecks run: ${ok + fail}, passed: ${ok}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
