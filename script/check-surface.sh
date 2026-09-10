#!/usr/bin/env bash
# check-surface.sh — read-only gate on the page GitHub Pages is about to publish (web/index.html).
# Run by .github/workflows/pages.yml before anything is uploaded, and runnable locally the same
# way (`bash script/check-surface.sh`) so a developer sees exactly what the workflow will see.
# Every check is planted-input tested below its own definition; a check that has never fired on a
# known-bad input is not a check. Prints a stated count, never a blank pass — the same discipline
# script/scan.sh uses, whose secret-pattern regex this script borrows (see SECRETS below).
set -uo pipefail
cd "$(dirname "$0")/.."

PAGE="web/index.html"
# Every file GitHub Pages will serve from web/: the pins live in index.html, but a secret or a banned
# phrase in any served file ships all the same, so those two scans run over all of them.
SERVED=$(find web -type f | sort | tr '
' ' ')
ok=0; fail=0
chk() { if eval "$2"; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }

if [ ! -f "$PAGE" ]; then
  echo "FAIL  $PAGE does not exist"
  echo "checks run: 1, passed: 0, failed: 1"
  exit 1
fi

# ── 1. the pins the page must carry, verbatim ─────────────────────────────────
# One grep per pinned fact named in docs/DEPLOYMENT.md and the live-green tag. A miss here means
# the page would go live naming a different deploy than the one this repository proves.
# REPOINTED TO V3, 2026-09-10. These asserted V1's addresses until the page was V1's. The demo the
# repository now proves is V3 — deployed and source-verified on four chains, live-settled on Ethereum
# Sepolia — so the page names V3 and this block follows it. That is the check working rather than
# being relaxed: it fired the moment the page changed deploy and refused to pass until the script
# agreed. V1 is still named on the page in one small prior-evidence section, which is why nothing
# here bans its strings; what the rows below assert is which deploy the page PAYS THROUGH.
chk "pins chain id 11155111"                  "grep -qE '\\b11155111\\b' '$PAGE'"
chk "pins the V3 hook address"                "grep -qF '0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0' '$PAGE'"
chk "pins the V3 executor address"            "grep -qF '0x015692C9E43ca19a2504F79368D1156A56680517' '$PAGE'"
chk "pins the V3 pool id"                     "grep -qF '0xf9b873f83814234224be42592795ec812fb948a300188e0c597796171ab9c57a' '$PAGE'"
chk "pins deployBlock 11667702"               "grep -qE '\\b11667702\\b' '$PAGE'"
chk "pins release tag v3-settled-indexed"     "grep -qF 'v3-settled-indexed' '$PAGE'"
chk "pins release commit 8cdf141"             "grep -qF '8cdf141' '$PAGE'"
chk "pins the V3 settlement transaction"      "grep -qF '0x4f4acbd1b1ed07eccbcf0d7c6f6fcb23a397b619dd3a1dd7fcf7ed7456768854' '$PAGE'"

# The two addresses the page actually SENDS TO, read off their own CFG keys rather than from anywhere
# in the file. A page that merely mentions V3 somewhere while still paying V1 would pass every row
# above and fail these two, which is the whole difference between naming a deploy and using one.
chk "CFG.executor is the V3 executor"         "grep -qE '^  executor: \"0x015692C9E43ca19a2504F79368D1156A56680517\",' '$PAGE'"
chk "CFG.hook is the V3 hook"                 "grep -qE '^  hook: \"0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0\",' '$PAGE'"

# control: prove the pin checks actually distinguish present from absent, on a throwaway fixture
tmp_pin=$(mktemp)
printf 'no pins here\n' > "$tmp_pin"
chk "control: a pin check fails on a fixture missing every pin" "! grep -qF '8cdf141' '$tmp_pin'"
printf '8cdf141\n' >> "$tmp_pin"
chk "control: the same check passes once the pin is present"    "grep -qF '8cdf141' '$tmp_pin'"
# control: the CFG-key rows must reject the PREVIOUS generation's address, not merely accept the new
# one. Without this row a check that matched any address at all would look identical to a working
# one — and matching any address is exactly the failure this pair exists to rule out.
printf '  executor: "0x044bc8a8773EC7b9B8de2467766636dFFCaC6210",\n' > "$tmp_pin"
chk "control: the CFG.executor row rejects V1's executor" \
    "! grep -qE '^  executor: \"0x015692C9E43ca19a2504F79368D1156A56680517\",' '$tmp_pin'"
printf '  executor: "0x015692C9E43ca19a2504F79368D1156A56680517",\n' > "$tmp_pin"
chk "control: ...and accepts V3's" \
    "grep -qE '^  executor: \"0x015692C9E43ca19a2504F79368D1156A56680517\",' '$tmp_pin'"
rm -f "$tmp_pin"

# ── 2. no external script, stylesheet, or font tag ────────────────────────────
# web/README.md's claim is "no analytics, no fonts, no libraries" — the page's only network calls
# are the RPC and the wallet, both from inline script. Any <script src=, <link>, or @import means
# GitHub Pages would start serving a third-party dependency this repository never disclosed.
chk "no <script src= tag"        "! grep -qiE '<script[^>]+src=' '$PAGE'"
chk "no <link> tag of any kind"  "! grep -qiE '<link[[:space:]]' '$PAGE'"
chk "no @import rule"            "! grep -qiE '@import' '$PAGE'"
chk "no known font/CDN host referenced" \
  "! grep -qiE 'fonts\\.(googleapis|gstatic)\\.com|cdn\\.jsdelivr\\.net|cdnjs\\.cloudflare\\.com|unpkg\\.com' '$PAGE'"

tmp_ext=$(mktemp)
printf '<script src="https://example.com/x.js"></script>\n' > "$tmp_ext"
chk "control: an external <script src=> is caught" "grep -qiE '<script[^>]+src=' '$tmp_ext'"
rm -f "$tmp_ext"

# ── 3. no secret-shaped string ────────────────────────────────────────────────
# The pattern is SOURCED, not copied. It used to be repeated here verbatim "with attribution",
# and on 2026-09-08 the two had silently drifted: scan.sh's copy had been taught the JSON
# `NAME: value` shape and this one had not, so the scanner guarding the PUBLISHED page was the
# weaker of the two and nothing said so. One definition now, in script/secret-patterns.sh.
[ -r "$(dirname "$0")/secret-patterns.sh" ] || { echo "FAIL  secret-patterns.sh is missing — refusing to publish with no patterns"; exit 1; }
. "$(dirname "$0")/secret-patterns.sh"

# Two stages, as the shared file defines them: $assign finds a name/separator/value, $material
# keeps only the values that carry a digit or a hyphen. A served file must satisfy neither.
served_hits=$(grep -hiE "$assign" $SERVED 2>/dev/null | grep -iE "$material" || true)
served_toks=$(grep -hiE "$tokens" $SERVED 2>/dev/null || true)
chk "no secret-shaped string in any served file ($(echo $SERVED | wc -w | tr -d ' ') files)" \
  "[ -z \"\$served_hits\$served_toks\" ]"
[ -n "$served_hits$served_toks" ] && printf '%s\n' "$served_hits" "$served_toks" | grep -v '^$'

chk "control: the secrets pattern catches a planted key" \
  "printf 'PRIVATE_KEY=0x%064d\\n' 1 | grep -qiE \"\$material\""
chk "control: ...and catches one in JSON form, which this file used to miss" \
  "printf '  \"apiKey\": \"0x%064d\"\\n' 1 | grep -qiE \"\$material\" || printf '  \"API_KEY\": \"0x%064d\"\\n' 1 | grep -qiE \"\$material\""
chk "control: the secrets pattern does not catch ordinary hex data" \
  "! printf 'poolId: \"0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db\"\\n' | grep -qiE \"\$material\""
chk "control: a shell default substitution is NOT caught" \
  "! printf 'PASSWORD: \${PASSWORD:-local}\\n' | grep -qiE \"\$material\""

# ── 4. the approved public claim, and only it ─────────────────────────────────
# The one sentence this project is allowed to claim in public:
APPROVED="UNICA demonstrates a live, verified USDC settlement flow on Uniswap v4 Sepolia, with order-bound full-fill enforcement and an indexable receipt."
# A "strict subset" means a contiguous prefix of that exact wording, cut only at a comma or the
# full stop — never a paraphrase and never a superset. Two acceptable prefixes are enumerated
# below; extend this list, not the wording, if a shorter approved cut is ever needed.
APPROVED_PREFIX_1="UNICA demonstrates a live, verified USDC settlement flow on Uniswap v4 Sepolia."
MARKER="UNICA demonstrates"
if grep -qF "$MARKER" "$PAGE"; then
  chk "the claim starting with '$MARKER' matches the approved sentence or an approved prefix" \
    "grep -qF \"$APPROVED\" '$PAGE' || grep -qF \"$APPROVED_PREFIX_1\" '$PAGE'"
else
  echo "PASS  no '$MARKER' claim is made on the page (nothing to check against the approved sentence)"
  ok=$((ok+1))
fi

# Phrases this project must never claim (HARD CONSTRAINTS: ERC-20/UNI input support, EURC support,
# multi-chain support, Robinhood support, Arc readiness, World Chain integration, hosted subgraph
# availability, public website availability, sponsor qualification). Matched case-insensitively;
# each entry is its own alternative so one match names exactly which claim leaked.
# A truthful denial that uses one of these words ("this does not imply sponsor qualification") still
# trips the substring match; word such sentences without the phrase, or add an approved exception here.
declare -a BANNED=(
  'ERC-?20[^.]{0,30}(input|support)'
  '\bUNI\b[^.]{0,30}(input|support|token)'
  '\bEURC\b'
  'multi-?chain'
  '\bRobinhood\b'
  'Arc[- ](readiness|ready)'
  'Arc integration'
  'World[- ]?Chain'
  'hosted subgraph'
  'public website'
  'sponsor qualif'
)
banned_hit=0
for pat in "${BANNED[@]}"; do
  if grep -qiE "$pat" $SERVED; then
    echo "FAIL  banned phrase found on the page, pattern: $pat"
    banned_hit=$((banned_hit+1))
  fi
done
chk "none of the ${#BANNED[@]} banned phrases appear in any served file" "[ $banned_hit -eq 0 ]"

tmp_banned=$(mktemp)
printf 'This page supports EURC and Robinhood.\n' > "$tmp_banned"
chk "control: a banned phrase (EURC) is caught on a planted fixture" "grep -qiE '\\bEURC\\b' '$tmp_banned'"
chk "control: an unrelated sentence is NOT caught by the same pattern" "! printf 'USDC settles here.\\n' | grep -qiE '\\bEURC\\b'"
rm -f "$tmp_banned"

echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
[ "$fail" -eq 0 ]
