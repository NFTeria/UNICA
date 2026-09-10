#!/usr/bin/env bash
# check-cre-confidentiality.sh — refuses the seven things a confidential-workflow prototype must
# never commit or claim. Offline, read-only, no network and no CRE runtime.
#
# WHY A REPOSITORY SCAN AND NOT A SIMULATOR ASSERTION. The simulator cannot test confidentiality,
# and says so itself: "The simulator is not a real TEE, and is meant to debug. Do not use it for
# sensitive information." It also DELIBERATELY shows enclave logs that production hides — "They are
# presented in the simulator for debugging only." So a green simulator run proves nothing here.
# What can be checked, exactly and forever, is what reaches the repository and what it claims.
# https://docs.chain.link/cre-templates/hello-confidential-workflows
set -uo pipefail
cd "$(dirname "$0")/.."
ok=0; fail=0
chk() { if eval "$2"; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
show() { [ -n "$1" ] && printf '      %s\n' "$1"; }

# 1. canaries. Tests generate these at run time; none may ever be committed.
canaries=$(git grep --untracked -nE 'CANARY-[a-z]+-[0-9a-f]{8,}' -- . 2>/dev/null | grep -vE '^script/check-cre-confidentiality\.sh:' || true)
chk "no generated canary value is tracked" "[ -z \"\$canaries\" ]"; show "$canaries"

# 2. populated secret assignments in the CRE trees. NAMES are fine; a VALUE is not.
populated=$(git grep --untracked -nE '^[[:space:]]*(UNICA_[A-Z0-9_]+|CRE_[A-Z0-9_]+)=[^[:space:]#]' \
  -- integrations/chainlink-cre-robinhood \
     integrations/chainlink-cre-guardian 2>/dev/null || true)
chk "no populated secret assignment in either CRE tree" "[ -z \"\$populated\" ]"; show "$populated"

# 3/4. key material and simulator credential files. The shared pattern is sourced, never copied.
[ -r script/secret-patterns.sh ] || { echo "FAIL  secret-patterns.sh missing"; exit 1; }
. script/secret-patterns.sh
keymat=$(git grep --untracked -hiE "$assign" -- integrations/chainlink-cre-robinhood 2>/dev/null | grep -iE "$material" || true)
chk "no key-shaped material in the confidential tree" "[ -z \"\$keymat\" ]"
credfiles=$(git ls-files | grep -E '(^|/)(secrets\.ya?ml|\.env|credentials\.json|cre_.*\.json)$' || true)
chk "no simulator credential file is tracked" "[ -z \"\$credfiles\" ]"; show "$credfiles"

# 5. fixtures and snapshots must hold no field a schema marks private.
fixleak=$(git grep --untracked -lE '"(quoteCredential|submissionConfig|preferredVenue|maxDeviationBps|maxQuoteAgeSeconds)"' \
  -- integrations/chainlink-cre-robinhood/fixtures 2>/dev/null || true)
chk "no private field name appears in a committed fixture" "[ -z \"\$fixleak\" ]"; show "$fixleak"

# 6/7. claims this repository is not entitled to make. Two stages, so a truthful DENIAL passes:
# "no contract emits CRE verified" must not trip the rule that bans claiming it does.
NEG='\bno\b|\bnot\b|\bnever\b|\bcannot\b|must not|\bwithout\b|would\b|~~|SUPERSEDED'
claim1=$(git grep --untracked -inE 'CRE[- ]verified|verified by (the )?DON|DON[- ]signed|attested by (the )?enclave' -- . 2>/dev/null \
  | grep -vE '^script/check-cre-confidentiality\.sh:' | grep -viE "$NEG" || true)
chk "never claims a CRE report is verified on chain" "[ -z \"\$claim1\" ]"; show "$claim1"
# Requires a verb that ASSERTS EXISTENCE. The bare word "production" near "confidential workflow"
# is not a claim - Chainlink's own guidance says "Don't log in production Confidential Workflows",
# and this rule fired on that quotation the first time it ran.
claim2=$(git grep --untracked -inE '(our|the|a) (live|deployed|operational|running) confidential workflow|confidential workflows? (is|are|went) (live|deployed|operational|running)|we (have|are) (running|operating) a confidential workflow' -- . 2>/dev/null \
  | grep -vE '^script/check-cre-confidentiality\.sh:' | grep -viE "$NEG" || true)
chk "never claims a live or deployed Confidential Workflow" "[ -z \"\$claim2\" ]"; show "$claim2"

# ── the controls. A check that has never fired is not a check. ────────────────────────────────
probe=$(mktemp -d ./.creprobe-XXXX); trap 'rm -rf "$probe"' EXIT
printf 'CANARY-quotecred-deadbeefcafe1234\n' > "$probe/a.md"
chk "control: a planted canary IS caught" "git grep --untracked -qE 'CANARY-[a-z]+-[0-9a-f]{8,}' -- $probe"
# A populated assignment, deliberately NOT token-shaped: script/scan.sh reads this file too,
# and a realistic-looking credential here would trip that scanner instead of this one.
printf 'UNICA_RH_QUOTE_CREDENTIAL=planted-populated-value\n' > "$probe/b.env.txt"
chk "control: a planted populated assignment IS caught" \
  "git grep --untracked -qE '^[[:space:]]*UNICA_[A-Z0-9_]+=[^[:space:]#]' -- $probe"
printf 'This settlement is CRE-verified on chain.\n' > "$probe/c.md"
chk "control: a planted CRE-verified claim IS caught" \
  "git grep --untracked -inE 'CRE[- ]verified' -- $probe | grep -viE \"\$NEG\" | grep -q ."
printf 'No contract here emits a CRE-verified signal.\n' > "$probe/d.md"
chk "control: a truthful DENIAL is NOT caught" \
  "! (git grep --untracked -inE 'CRE[- ]verified' -- $probe/d.md | grep -viE \"\$NEG\" | grep -q .)"
printf 'UNICA_RH_QUOTE_CREDENTIAL=\n' > "$probe/e.env.txt"
chk "control: an EMPTY assignment (a name only) is NOT caught" \
  "! git grep --untracked -qE '^[[:space:]]*UNICA_[A-Z0-9_]+=[^[:space:]#]' -- $probe/e.env.txt"

echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
[ "$fail" -eq 0 ]
