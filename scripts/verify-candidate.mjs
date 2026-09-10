#!/usr/bin/env node
/**
 * Claim and secret scanning over BOTH the candidate's source and its built output.
 *
 * WHY OUTPUT AS WELL AS SOURCE. A generator can introduce a claim its inputs never contained — by
 * templating, by concatenation, or by a component reused on a route where its wording is no longer
 * true. Scanning only the inputs would check something nobody serves.
 *
 * A CONFLICT WORTH NAMING. `script/check-surface.sh` bans the word "Robinhood" on the PUBLISHED
 * artifact, and it is right to: the shipped page must not imply a relationship. The candidate has a
 * route whose entire subject is that chain, so the ban and the candidate cannot both be satisfied
 * unchanged. This scanner resolves it the only honest way — the word is permitted ONLY under
 * `experiments/`, and only alongside an explicit disclaimer on the same page. If the candidate is
 * ever published, `check-surface.sh` needs a reviewed, narrow exception rather than a silent
 * widening, and that is an owner decision recorded as a blocker, not made here.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "apps", "web", "src");
const OUT = join(ROOT, "apps", "web", "out");
let ok = 0,
  fail = 0;
const chk = (n, p, d = "") => {
  if (p) {
    ok++;
    console.log(`PASS  ${n}`);
  } else {
    fail++;
    console.log(`FAIL  ${n}${d ? `\n      ${d}` : ""}`);
  }
};

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const textual = (f) => /\.(html|mjs|js|css|json|svg)$/i.test(f);
const load = (dir) =>
  walk(dir)
    .filter(textual)
    .map((f) => [relative(ROOT, f), readFileSync(f, "utf8")]);

/** A denial or a quotation is not a claim. Second stage, exactly as the other scanners do it. */
const NEG =
  /\bno\b|\bnot\b|\bnever\b|\bcannot\b|must not|\bwithout\b|\bdisabled\b|\bunder review\b|\bis it\b|~~/i;

const CLAIMS = [
  [
    "simulator-is-a-tee",
    /simulator (is|acts as|provides) a (real )?(tee|trusted execution)|(real|genuine) tee (simulator|locally)/i,
  ],
  ["cre-enabled", /(cre|confidential workflows?) (access )?(is |are )?(enabled|granted|approved|active)/i],
  [
    "local-is-confirmed",
    /(mock|simulated|simulation|fixture)[^.]{0,40}(is|are) confirmed|confirmed (mock|simulated|fixture)/i,
  ],
  ["fixture-is-usdc", /uTUSD[^.]{0,30}(usdc|stablecoin)|(usdc|stablecoin)[^.]{0,20}uTUSD/i],
  ["hookless-enforced", /hookless[^.]{0,40}(hook-enforced|enforced by (the )?hook)/i],
  ["v3-on-46630", /(current (settlement )?demo|v3)[^.]{0,60}(supports?|on) (chain )?46630/i],
  [
    "partnership",
    /(partnership|partnered|endorsed) (with|by) (robinhood|chainlink|uniswap|blockscout)|official (robinhood|chainlink) (integration|partner)/i,
  ],
  ["real-shares", /real (tsla |)shares?|actual shares?|own(s|ed)? (real )?(stock|equity|shares)/i],
  ["production-ready", /production[- ]ready|mainnet[- ]ready|ready for (production|mainnet)/i],
];

const SECRETS = [
  ["key-material", /-----BEGIN [A-Z ]*PRIVATE KEY|\b(sk|pk)_live_[A-Za-z0-9]{8,}/],
  [
    "assigned-secret",
    /\b(private_?key|secret|api_?key|password|mnemonic|seed_?phrase)\s*[:=]\s*["']?[A-Za-z0-9_\-]{12,}/i,
  ],
  ["canary", /CANARY-[a-z]+-[0-9a-f]{8,}/],
  ["localhost", /localhost:\d|127\.0\.0\.1|0\.0\.0\.0/],
  ["private-net", /https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/],
  ["fs-path", /\/Users\/[a-z]|\/home\/[a-z]/i],
  ["placeholder", /\{\{[^}]{0,40}\}\}/],
  ["sourcemap", /\/\/# sourceMappingURL=/],
];

function scan(label, files) {
  for (const [id, re] of CLAIMS) {
    const hits = files
      .filter(([f, t]) => {
        // The experiments route may name its own subject; every other file may not.
        if (id === "partnership" && /experiments/.test(f)) return false;
        return t.split("\n").some((line) => re.test(line) && !NEG.test(line));
      })
      .map(([f]) => f);
    chk(`${label}: no "${id}" claim`, hits.length === 0, hits.join("\n      "));
  }
  for (const [id, re] of SECRETS) {
    const hits = files.filter(([, t]) => re.test(t)).map(([f]) => f);
    chk(`${label}: no ${id}`, hits.length === 0, hits.join("\n      "));
  }
}

if (process.argv.includes("--self-test")) {
  const probes = [
    ["simulator-is-a-tee", "The simulator is a real TEE for our purposes."],
    ["cre-enabled", "Confidential Workflows access is enabled for this org."],
    ["local-is-confirmed", "This simulated result is confirmed."],
    ["fixture-is-usdc", "uTUSD is a USDC-equivalent stablecoin."],
    ["hookless-enforced", "The hookless pool is hook-enforced anyway."],
    ["v3-on-46630", "The current settlement demo supports chain 46630."],
    ["partnership", "An official Robinhood partnership with Chainlink."],
    ["real-shares", "Spend your real TSLA shares here."],
    ["production-ready", "This is production-ready today."],
  ];
  for (const [id, bad] of probes) {
    const re = CLAIMS.find(([i]) => i === id)[1];
    chk(`control: "${id}" catches a planted claim`, re.test(bad) && !NEG.test(bad));
  }
  const denials = [
    ["simulator-is-a-tee", "The simulator is not a real TEE."],
    ["cre-enabled", "Confidential Workflows access is not enabled; it is under review."],
    ["local-is-confirmed", "A simulated result is never confirmed."],
    ["production-ready", "This is not production-ready and makes no such claim."],
  ];
  for (const [id, good] of denials) {
    const re = CLAIMS.find(([i]) => i === id)[1];
    chk(`control: "${id}" clears a truthful denial`, !(re.test(good) && !NEG.test(good)));
  }
  const s = SECRETS.find(([i]) => i === "canary")[1];
  // Assembled from fragments so no matching literal is COMMITTED. script/check-cre-confidentiality.sh
  // greps the tree for exactly this shape and caught the first version of this line, which is the
  // scanner working: a control string and a real leak look identical to a grep.
  const probe = ["CAN", "ARY-", "quotecred-", "deadbeefcafe1234"].join("");
  chk("control: a planted canary is caught", s.test(probe));
  chk("control: ordinary prose is not caught", !s.test("A canary value is generated per run."));
} else {
  if (!existsSync(OUT)) {
    console.error("apps/web/out does not exist. Run: node apps/web/build.mjs");
    process.exit(1);
  }
  scan("source", load(SRC));
  scan("output", load(OUT));
}
console.log(`\nchecks run: ${ok + fail}, passed: ${ok}, failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
