#!/usr/bin/env bash
# check-robinhood-claims.sh — refuses six statements about chain 46630 that this repository has
# already had to correct once. Offline, read-only, no network and no chain call.
#
# WHY IT EXISTS. On 2026-09-09 the evidence said no stock token existed on Robinhood testnet, and
# `docs/chains/ROBINHOOD.md` said so. On 2026-09-10 a public faucet issued five testnet stock-token
# contracts and that sentence became false. Correcting a document is easy; keeping it corrected
# while eight other files repeat the old finding is the part that fails silently. This is the check
# that fails loudly instead.
#
# TWO STAGES, the same shape script/scan.sh uses. Stage one finds a CANDIDATE line; stage two drops
# it if the line also carries a negation or a supersession marker, because "V3 cannot be deployed on
# 46630" and "V3 is deployable on 46630" differ by one word and only one of them is a lie. A one-
# stage substring match would fire on every truthful denial in the tree, and a check that cries wolf
# on its own documentation gets ignored — which protects nothing.
#
#   bash script/check-robinhood-claims.sh              # the tracked tree
#   bash script/check-robinhood-claims.sh --self-test  # plant each claim and require it to be caught
set -uo pipefail
cd "$(dirname "$0")/.."
ok=0; fail=0
chk() { if eval "$2"; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }

# PORTABLE WORD BOUNDARIES. `\b` is a GNU grep extension. `git grep -E` uses POSIX ERE and simply
# does not match it — so a pattern written with `\b` passes a drill run through plain grep and then
# never fires through the real scanner. That happened here, and it is the reason the self-test below
# now calls scan_claim() itself instead of a lookalike pipeline.
W='[^[:alnum:]_]'
word() { # word() a b c  ->  (^|W)(a|b|c)($|W)
  local IFS='|'; printf '(^|%s)(%s)($|%s)' "$W" "$*" "$W"
}

# A line carrying any of these is a correction, a denial, or a quotation of a superseded finding —
# never a fresh claim. `~~` is markdown strikethrough; SUPERSEDED is the explicit marker.
NEGATION="SUPERSEDED|superseded|~~|refus|revert|research|probed|$(word no not never cannot without must unless until zero none neither)|would have to|does not|is absent"

# ...except for one family, and the self-test is what found it. "No stock token exists on 46630" is
# ITSELF a negative sentence, so the filter above — which exists to spare truthful denials — swallowed
# the very claim that family is for. That row failed on the first run and would have shipped a check
# that could never fire. This family is exempted only by an explicit supersession marker, never by
# the mere presence of the word "no".
SUPERSESSION='SUPERSEDED|superseded|~~|would have to|earlier finding|no longer'

# Files that legitimately hold the forbidden strings because their job is to forbid them.
# Each entry needs a reason; an unexplained exemption is a hole.
# Anchored with a trailing ':' because git grep emits "path:line:text" — a '$' after the filename
# never matches, which silently disabled every exemption the moment --untracked let this file see
# its own source. Found by the self-test going red on all six families at once.
EXEMPT='script/check-robinhood-claims\.sh|script/check-surface\.sh|scripts/public-build\.manifest\.json|docs/DEMO-SHOTLIST\.md'
#        this file itself                  the surface gate's banned list     the same list, as data   the recording session's do-not-claim list

# The claims, as parallel arrays. They were a pipe-delimited blob until the self-test caught the
# obvious defect: `|` is the field separator AND the regex alternation operator, so every pattern
# containing an alternation was split in half and grep was handed unbalanced parentheses. The
# self-test found it on its first run, which is the self-test earning its place.
CLAIM_ID=(
  "no-stock-tokens"
  "testnet-tokens-are-mainnet"
  "usdc-on-46630"
  "robinhood-integration"
  "existence-proves-liquidity"
  "v3-deployable-46630"
)
CLAIM_WHAT=(
  "that no stock-token contract exists on 46630"
  "that the observed testnet token addresses are the canonical mainnet ones"
  "that a verified USDC or payout path exists on 46630"
  "that UNICA is integrated with, partnered with, or endorsed by Robinhood"
  "that token existence proves a settlement path or liquidity"
  "that V3 is deployable, deployed, or constructible on 46630"
)
CLAIM_PAT=(
  # \b matters here: without it "no" matched inside "canonical" and the row fired on a true
  # sentence about chain 4663. Found by running the check against the real tree.
  "$(word no zero none).{0,40}stock.?tokens?.{0,40}(46630|this chain|testnet)|stock.?tokens?.{0,30}(does not exist|do not exist|are absent).{0,30}46630"
  "(canonical|mainnet).{0,60}(0xc9f9c869|0x5884ad2f|0x1fbe1a0e|0x3b8262a6|0x71178bac)"
  "(usdc|payout (token|currency|path)).{0,40}(exists|is (available|verified|present|established)).{0,20}(on )?(chain )?46630|46630.{0,40}(has|holds).{0,20}(a )?(verified )?(usdc|payout)"
  "robinhood.{0,25}(integration|integrated|partner|sponsor|endorse|official)|(integrated|partnered).{0,25}with robinhood|powered by robinhood"
  "(token|stock.?token).{0,30}(existence|exists).{0,30}(proves|means|implies|establishes).{0,30}(pool|liquidity|settl)|stock.?token.{0,20}pool.{0,20}(exists|is (funded|liquid|available))"
  "(v3|unicahookv3|unicaexecutorv3).{0,40}(is )?(deployable|deployed|constructible|constructed|live).{0,20}(on )?(chain )?46630|46630.{0,30}(deployable|deployed|constructed).{0,20}(v3|hook|executor)"
)

# Which second-stage filter each family uses. Index-aligned with the arrays above.
CLAIM_FILTER=(
  "$SUPERSESSION"
  "$NEGATION"
  "$NEGATION"
  "$NEGATION"
  "$NEGATION"
  "$NEGATION"
)

scan_claim() {
  # $1 pattern, $2 second-stage filter, $3 optional path scope (default: the whole tree).
  # The self-test passes a scope so its verdict is about THIS INSTRUMENT and not about whatever
  # else happens to be in the tree that day — otherwise a pre-existing hit makes the drill's
  # denial row fail and says nothing about the drill.
  git grep --untracked -inE "$1" -- "${3:-.}" 2>/dev/null \
    | grep -vE "^($EXEMPT):" \
    | awk -F: '{ f=$1; l=$2; $1=""; $2=""; print f ":" l ":" substr($0,3) }' \
    | grep -viE "$2" || true
}

if [ "${1:-}" = "--self-test" ]; then
  echo "# self-test: every claim family must catch a planted assertion and clear a planted denial"
  probe=$(mktemp -d ./.rhprobe-XXXX)
  trap 'rm -rf "$probe"' EXIT
  BAD=(
    "There are no stock tokens on chain 46630 today."
    "The canonical mainnet contract is 0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e here."
    "A verified USDC exists on chain 46630 for payouts."
    "UNICA ships an official Robinhood integration."
    "Token existence proves a settlement pool is available."
    "V3 is deployable on chain 46630 today."
  )
  GOOD=(
    "The earlier finding of no stock tokens on 46630 is SUPERSEDED by section 0."
    "These are not the canonical mainnet addresses; 0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e is a testnet contract."
    "No verified USDC exists on chain 46630, so payoutCurrency reverts."
    "UNICA has no Robinhood integration; the chain was probed and nothing was integrated."
    "Token existence does not prove a settlement pool; none has been shown."
    "V3 is not deployable on chain 46630 because the constructor reverts."
  )
  for i in "${!CLAIM_ID[@]}"; do
    printf '%s\n' "${BAD[$i]}"  > "$probe/bad.md"
    caught=$(scan_claim "${CLAIM_PAT[$i]}" "${CLAIM_FILTER[$i]}" "$probe")
    printf '%s\n' "${GOOD[$i]}" > "$probe/bad.md"
    passed=$(scan_claim "${CLAIM_PAT[$i]}" "${CLAIM_FILTER[$i]}" "$probe")
    rm -f "$probe/bad.md"
    chk "control: \"${CLAIM_ID[$i]}\" catches a planted assertion" "[ -n \"\$caught\" ]"
    chk "control: \"${CLAIM_ID[$i]}\" clears a planted denial"     "[ -z \"\$passed\" ]"
  done
  echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
  [ "$fail" -eq 0 ]
  exit $?
fi

echo "# six statements about chain 46630 this repository has already had to correct once"
echo "# evidence for each: docs/chains/ROBINHOOD.md section 0, read 2026-09-10"
for i in "${!CLAIM_ID[@]}"; do
  hits=$(scan_claim "${CLAIM_PAT[$i]}" "${CLAIM_FILTER[$i]}")
  chk "never claims ${CLAIM_WHAT[$i]}" "[ -z \"\$hits\" ]"
  [ -n "$hits" ] && printf '      %s\n' "$hits"
done

echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
[ "$fail" -eq 0 ]
