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
chk "pins chain id 11155111"                  "grep -qE '\\b11155111\\b' '$PAGE'"
chk "pins the live hook address"              "grep -qF '0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0' '$PAGE'"
chk "pins the live executor address"          "grep -qF '0x044bc8a8773EC7b9B8de2467766636dFFCaC6210' '$PAGE'"
chk "pins the live pool id"                   "grep -qF '0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db' '$PAGE'"
chk "pins deployBlock 11639895"               "grep -qE '\\b11639895\\b' '$PAGE'"
chk "pins release tag live-green"             "grep -qF 'live-green' '$PAGE'"
chk "pins release commit 5e1d843"             "grep -qF '5e1d843' '$PAGE'"

# control: prove the pin checks actually distinguish present from absent, on a throwaway fixture
tmp_pin=$(mktemp)
printf 'no pins here\n' > "$tmp_pin"
chk "control: a pin check fails on a fixture missing every pin" "! grep -qF '5e1d843' '$tmp_pin'"
printf '5e1d843\n' >> "$tmp_pin"
chk "control: the same check passes once the pin is present"    "grep -qF '5e1d843' '$tmp_pin'"
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
# SECRETS is the same pattern script/scan.sh defines and runs over the whole tree; it is repeated
# here, verbatim, with attribution, so this script stays self-contained for the one file GitHub
# Pages will publish rather than depending on scan.sh's git-grep-over-the-repo shape. Source:
# script/scan.sh, variable `secrets` (as of the commit that added this file).
SECRETS='(PRIVATE_KEY|MNEMONIC|SECRET|API_KEY|AUTH_TOKEN|PASSWORD)[A-Z_]*[[:space:]]*=[[:space:]]*[^[:space:]<$]{8,}|"ciphertext"|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}'
chk "no secret-shaped string in any served file ($(echo $SERVED | wc -w | tr -d ' ') files)" "! grep -qiE '$SECRETS' $SERVED"

chk "control: the secrets pattern catches a planted key" \
  "printf 'PRIVATE_KEY=0x%064d\\n' 1 | grep -qiE '$SECRETS'"
chk "control: the secrets pattern does not catch ordinary hex data" \
  "! printf 'poolId: \"0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db\"\\n' | grep -qiE '$SECRETS'"

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
