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
label='pool ?id|salt|hash|keccak|sha-?256|tx|transaction|block|bytes32|id[[:space:]]|swap|receipt|topic'

# The controls, first: each pattern must catch a planted bad input and pass a planted good one.
chk "control: a labelled key is caught"        "printf 'PRIVATE_KEY=0x%064d\n' 1 | grep -qiE '$secrets'"
chk "control: a lowercase key is caught"       "printf 'private_key=0x%064d\n' 1 | grep -qiE '$secrets'"
chk "control: a private name anywhere is caught" "printf 'docs/notes/privatenotes.md\n' | grep -qE '$names'"
chk "control: a private location is caught"    "printf 'see /Users/someone/notes\n' | grep -qE '$marks'"
chk "control: an unlabelled 32-byte value is caught" "printf '| key | 0x%064d |\n' 2 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label'"
chk "control: a labelled pool id is NOT caught" "! (printf 'pool id 0x%064d\n' 3 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label')"

# Then the tree.
# script/check-surface.sh carries this same pattern and a planted control key, as this file does; both are scanners.
chk "no labelled secret or token format" "! git grep -niE '$secrets' -- . ':!lib' ':!.github/workflows/ci.yml' ':!script/scan.sh' ':!script/check-surface.sh'"
chk "no private runtime file tracked"    "! { git ls-files; git ls-files --others --exclude-standard; } | grep -qE '$names'"
chk "no private location mentioned"      "! git grep -nE '$marks' -- . ':!lib' ':!.github/workflows/ci.yml' ':!.gitignore' ':!script/scan.sh'"
bare=$(git grep --untracked -nE '0x[a-fA-F0-9]{64}' -- . ':!lib' ':!broadcast/' ':!script/scan.sh' | grep -viE "$label" || true)
chk "no bare 32-byte value without a label on its line" "[ -z \"\$(git grep --untracked -nE '0x[a-fA-F0-9]{64}' -- . ':!lib' ':!broadcast/' ':!script/scan.sh' | grep -viE '$label')\" ]"
[ -n "$bare" ] && echo "$bare"

echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
[ "$fail" -eq 0 ]
