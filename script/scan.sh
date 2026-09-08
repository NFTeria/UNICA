#!/usr/bin/env bash
# scan.sh — the same secret and private-material scans CI runs, runnable before a push so the two
# cannot diverge. Every check proves itself on a planted input first; a scan that has never fired
# is not a scan. Prints a stated count, never a blank pass.
set -uo pipefail
cd "$(dirname "$0")/.."
ok=0; fail=0
chk() { if eval "$2"; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }

secrets='(PRIVATE_KEY|MNEMONIC|SECRET|API_KEY|AUTH_TOKEN|PASSWORD)[A-Z_]*[[:space:]]*=[[:space:]]*[^[:space:]<$]{8,}|"ciphertext"|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}'
names='(^|/)(STATE|MVP-PATH|SLOT-DECISION|BATTLE-PLAN|PLAYBOOK|PREBUILD|BOOTSTRAP|SESSION-PROMPT|ANSWERS|HANDOFF|SPONSORS|SPONSOR-BRIEF|LAW|PRIZE|SHIP|WHOSE-PROJECT|HOOK-CRAFT|UNISWAP-GITHUB|FEEDBACK-PLAN|FEEDBACK-DISCIPLINE|QUESTIONS|REMINDERS|PURSUIT-KIT|IDENTITY-RULING|WINNERS-EVIDENCE|UNISWAP-NEEDS|UF-SKILL-REVIEW|CHAIN-ADVANTAGES|INSIDE-THE-STACK|CHAINS|DISCIPLINE|privatenotes)\.md$|(^|/)(unica-closet|prize-watch|sponsors|routines|critique|do-not-ship|pseudocode|day1|warroom|war-room)/|\.REFERENCE$|\.output$'
marks='unica-closet|claude-toolkit|SESSION-PROMPT|prize-watch/|/Users/'
# What counts as a LABEL: a word on the same line that says the 32-byte value is a public
# identifier rather than a secret. Widened for the V2 Permit2 vectors, which pin EIP-712 domain
# separators, witness hashes and signing digests as literals on both sides of a two-language
# comparison. `id[[:space:]:]` rather than `id[[:space:]]` so a struct field like `quoteId:` counts.
# Widened again on 2026-09-08 by `curve` and `signature`, for `tools/unica-verify`: secp256k1's
# published domain parameters and a 65-byte ECDSA signature are both PUBLIC BY DEFINITION — the
# curve's parameters are in the standard, and a signature is the thing that gets broadcast. Neither
# widening touches the `secrets` rule, which matches on the NAME beside a value and still fires on
# `PRIVATE_KEY=` however the rest of the line reads; there is a control for exactly that below.
# Every addition here is paired with a control below: the scan must still catch a value with none
# of these words on its line, or the widening has quietly turned the check off.
label='pool ?id|salt|hash|keccak|sha-?256|tx|transaction|block|bytes32|id[[:space:]:]|swap|receipt|topic|digest|witness|domain|vector|curve|signature'

# The controls, first: each pattern must catch a planted bad input and pass a planted good one.
chk "control: a labelled key is caught"        "printf 'PRIVATE_KEY=0x%064d\n' 1 | grep -qiE '$secrets'"
chk "control: a lowercase key is caught"       "printf 'private_key=0x%064d\n' 1 | grep -qiE '$secrets'"
chk "control: a private name anywhere is caught" "printf 'docs/notes/privatenotes.md\n' | grep -qE '$names'"
chk "control: a private location is caught"    "printf 'see /Users/someone/notes\n' | grep -qE '$marks'"
chk "control: an unlabelled 32-byte value is caught" "printf '| key | 0x%064d |\n' 2 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label'"
chk "control: a labelled pool id is NOT caught" "! (printf 'pool id 0x%064d\n' 3 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label')"
chk "control: a labelled digest is NOT caught"  "! (printf 'digest 0x%064d\n' 4 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label')"
chk "control: a struct field named quoteId is NOT caught" "! (printf '  quoteId: \"0x%064d\",\n' 5 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label')"
chk "control: the widened label still catches a naked value" "printf '  \"0x%064d\",\n' 6 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label'"
chk "control: a curve parameter is NOT caught"  "! (printf 'const CURVE_GX = 0x%064d;\n' 7 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label')"
chk "control: a signature is NOT caught"        "! (printf '  signature: \"0x%064d\",\n' 8 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label')"
# The widening's own guard: the two new words must not become a place to hide a key. `secrets`
# matches on the NAME beside the value, so it fires whatever else the line says.
chk "control: a key on a line that also says 'signature' is STILL caught" "printf 'signature PRIVATE_KEY=0x%064d\n' 9 | grep -qiE '$secrets'"
chk "control: a key on a line that also says 'curve' is STILL caught"     "printf 'curve PRIVATE_KEY=0x%064d\n' 9 | grep -qiE '$secrets'"

# Then the tree.
# script/check-surface.sh carries this same pattern and a planted control key, as this file does; both are scanners.
chk "no labelled secret or token format" "! git grep -niE '$secrets' -- . ':!lib' ':!.github/workflows/ci.yml' ':!script/scan.sh' ':!script/check-surface.sh'"
chk "no private runtime file tracked"    "! { git ls-files; git ls-files --others --exclude-standard; } | grep -qE '$names'"
chk "no private location mentioned"      "! git grep -nE '$marks' -- . ':!lib' ':!.github/workflows/ci.yml' ':!.gitignore' ':!script/scan.sh'"
# CAPTURED CHAIN ARTIFACTS are excluded from the bare-value rule, and only from that one.
# `broadcast/` and `tools/unica-verify/fixtures/` hold bytes a node returned, recorded verbatim
# because the whole point of a captured artifact is that nobody edited it — a receipt's topics and
# data are structurally nothing but unlabelled 32-byte words, and labelling them would mean
# rewriting the evidence. The `secrets` rule above still reads both directories, so a key that
# somehow landed in one is still caught by name.
artifacts="':!broadcast/' ':!tools/unica-verify/fixtures/'"
bare=$(eval "git grep --untracked -nE '0x[a-fA-F0-9]{64}' -- . ':!lib' $artifacts ':!script/scan.sh'" | grep -viE "$label" || true)
chk "no bare 32-byte value without a label on its line" "[ -z \"\$bare\" ]"
[ -n "$bare" ] && echo "$bare"

echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
[ "$fail" -eq 0 ]
