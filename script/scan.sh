#!/usr/bin/env bash
# scan.sh — the same secret and private-material scans CI runs, runnable before a push so the two
# cannot diverge. Every check proves itself on a planted input first; a scan that has never fired
# is not a scan. Prints a stated count, never a blank pass.
set -uo pipefail
cd "$(dirname "$0")/.."
ok=0; fail=0
chk() { if eval "$2"; then echo "PASS  $1"; ok=$((ok+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }

# The secret patterns live in ONE place, sourced here and by script/check-surface.sh. They used to
# be copied between the two and had already drifted apart; secret-patterns.sh says why.
#
# TWO defects were found in this rule on 2026-09-08, by sabotage: planting a key inside a path the
# bare-value rule excludes, in order to prove that exclusion was safe, and watching the scan stay
# green at 17 of 17.
#
#   1. The separator was `=` only, so `"PRIVATE_KEY": "0x..."` was MISSED. JSON is the natural
#      shape of a config file, and it is the shape a pasted key actually arrives in.
#   2. It ran `git grep` WITHOUT `--untracked`, so a NEW file was invisible to it — which is the
#      exact case a pre-commit scan exists to catch. A key in a new JSON file passed both rules.
#
# Both are fixed, and every row that found them is a permanent control below: a regression here
# would otherwise be silent, this scan printing the same PASS lines while catching strictly less.
[ -r "$(dirname "$0")/secret-patterns.sh" ] || { echo "FAIL  secret-patterns.sh is missing — refusing to scan with no patterns"; exit 1; }
. "$(dirname "$0")/secret-patterns.sh"
secrets="$assign|$tokens"
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
# `resource` joins the vocabulary for ENSv2: an Enhanced Access Control resource identifier is a
# 32-byte value that is public by construction — it is derived from a name, and the whole point of
# printing one is that a reader can recompute it. Same class as a pool id or a log topic, and the
# two rows below prove the widening did not blunt the rule.
# `roles` and `token ?id` join it on 2026-09-09, for the ENSv2 observation file: a role bitmap and a
# registry token id are both READ OFF A PUBLIC CHAIN with `cast call`, and both are recomputable by
# anyone — the token id is keccak256(label) with its low 32 bits cleared. `token ?id` deliberately
# requires the `id`, so a bare `token:` beside a 64-hex value stays caught; an API token is exactly
# the shape this rule exists to find. Both words have a control below in each direction.
label='pool ?id|salt|hash|keccak|sha-?256|tx|transaction|block|bytes32|id[[:space:]:]|swap|receipt|topic|digest|witness|domain|vector|curve|signature|resource|roles|token ?id'

# The controls, first: each pattern must catch a planted bad input and pass a planted good one.
chk "control: a labelled key is caught"        "printf 'PRIVATE_KEY=0x%064d\n' 1 | grep -qiE '$secrets'"
chk "control: a lowercase key is caught"       "printf 'private_key=0x%064d\n' 1 | grep -qiE '$secrets'"
# The rows below are the sabotage that found the two defects, kept permanently: a regression here
# would be silent, the scan printing the same PASS lines while catching strictly less.
chk "control: a key in JSON form is caught"    "printf '  \"PRIVATE_KEY\": \"0x%064d\"\n' 1 | grep -qiE \"\$assign\" | grep -qiE \"\$material\" || printf '  \"PRIVATE_KEY\": \"0x%064d\"\n' 1 | grep -qiE \"\$material\""
chk "control: a key in YAML form is caught"    "printf 'private_key: 0x%064d\n' 1 | grep -qiE \"\$material\""
chk "control: a key in an UNTRACKED file is caught" "d=\$(mktemp -d ./.scanprobe-XXXX); printf 'PRIVATE_KEY=0x%064d\n' 1 > \$d/p.json; r=1; git grep --untracked -qiE \"\$assign\" -- \$d >/dev/null 2>&1 || r=0; rm -rf \$d; [ \$r -eq 1 ]"
chk "control: a docker-compose password literal is caught" "printf '      POSTGRES_PASSWORD: let-me-in\n' | grep -qiE \"\$material\""
# ...and the shapes that are CODE, not credentials. Each of these was a real false positive when
# stage two was absent; each must stay quiet or stage two has stopped doing its job.
chk "control: a TypeScript type annotation is NOT caught"  "! (printf '  secrets_ids: SecretsConfig;\n'            | grep -qiE \"\$material\")"
chk "control: an undefined env value is NOT caught"        "! (printf '{API_KEY: undefined, GRAPH_API_KEY: undefined}\n' | grep -qiE \"\$material\")"
chk "control: an enum member name is NOT caught"           "! (printf '  NO_API_KEY: \"NO_API_KEY\",\n'            | grep -qiE \"\$material\")"
chk "control: a member expression is NOT caught"           "! (printf '  secrets: endpoint.secrets,\n'              | grep -qiE \"\$material\")"
chk "control: an env-substituted value is NOT caught"      "! (printf 'POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}\n'  | grep -qiE \"\$material\")"
chk "control: a shell default substitution is NOT caught"  "! (printf 'POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-graph-node-local}\n' | grep -qiE \"\$material\")"
chk "control: ...but a literal beside one IS still caught"  "printf 'POSTGRES_PASSWORD: \${X:-y} PRIVATE_KEY=0x%064d\n' 1 | grep -qiE \"\$material\""
# The bare-value rule, sabotaged both ways. A widened label vocabulary is the easiest way to turn
# this check into decoration, so the negative row is the one that matters: an unlabelled word must
# still be caught after every widening.
chk "control: an UNLABELLED 32-byte value is still caught" "printf '  const x = \"0x%064d\";\n' 1 | grep -viE \"\$label\" | grep -qE '0x[a-fA-F0-9]{64}'"
chk "control: a labelled resource id is NOT caught"        "! (printf '  registryResource = \"0x%064d\";\n' 1 | grep -viE \"\$label\" | grep -qE '0x[a-fA-F0-9]{64}')"

# The stated gap, asserted so it is visible rather than believed closed.
chk "KNOWN GAP: an all-alphabetic passphrase is NOT caught" "! (printf 'PASSWORD=correcthorse\n' | grep -qiE \"\$material\")"
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
# The 2026-09-09 widening, both directions. The negative rows are the ones that matter: a word added
# to the vocabulary is a word an attacker could put on the line beside a key.
chk "control: a role bitmap is NOT caught"      "! (printf '  \"ownerRolesAtParent\": \"0x%064d\",\n' 1 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label')"
chk "control: a registry token id is NOT caught" "! (printf '  \"parentTokenId\": \"0x%064d\",\n' 1 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label')"
chk "control: a bare 'token' does NOT exempt"   "printf '  \"token\": \"0x%064d\",\n' 1 | grep -E '0x[a-fA-F0-9]{64}' | grep -qviE '$label'"
chk "control: a key on a line that also says 'roles' is STILL caught"    "printf 'roles PRIVATE_KEY=0x%064d\n' 9 | grep -qiE '$secrets'"
chk "control: a key on a line that also says 'token id' is STILL caught" "printf 'token id PRIVATE_KEY=0x%064d\n' 9 | grep -qiE '$secrets'"

# Then the tree.
# script/check-surface.sh carries this same pattern and a planted control key, as this file does; both are scanners.
# --untracked, for defect 2 above. Both stages run: stage one narrows the tree, stage two decides.
# The three scanners are excluded from the secret rule because each one CONTAINS the patterns it
# looks for; a scanner that fails on its own definitions is a scanner nobody can run.
scanpaths=". ':!lib' ':!.github/workflows/ci.yml' ':!script/scan.sh' ':!script/check-surface.sh' ':!script/secret-patterns.sh'"
leaks=$(eval "git grep --untracked -niE \"\$assign\" -- $scanpaths" 2>/dev/null | grep -iE "$material" || true)
toks=$(eval "git grep --untracked -niE \"\$tokens\" -- $scanpaths" 2>/dev/null || true)
chk "no labelled secret or token format" "[ -z \"\$leaks\$toks\" ]"
[ -n "$leaks$toks" ] && printf '%s\n' "$leaks" "$toks" | grep -v '^$' 
chk "no private runtime file tracked"    "! { git ls-files; git ls-files --others --exclude-standard; } | grep -qE '$names'"
chk "no private location mentioned"      "! git grep --untracked -nE '$marks' -- . ':!lib' ':!.github/workflows/ci.yml' ':!.gitignore' ':!script/scan.sh'"
# CAPTURED CHAIN ARTIFACTS are excluded from the bare-value rule, and only from that one.
# `broadcast/` and `tools/unica-verify/fixtures/` hold bytes a node returned, recorded verbatim
# because the whole point of a captured artifact is that nobody edited it — a receipt's topics and
# data are structurally nothing but unlabelled 32-byte words, and labelling them would mean
# rewriting the evidence. The `secrets` rule above still reads both directories, so a key that
# somehow landed in one is still caught by name.
# These paths hold bytes a node returned, recorded verbatim: a receipt's topics and an `eth_call`
# return are structurally nothing but unlabelled 32-byte words, and labelling them would mean
# rewriting the evidence. The `secrets` rule above still reads every one of them — and as of
# 2026-09-08 that is TRUE rather than merely asserted, because probing this exclusion is what
# found the two defects the rule now carries controls for.
#
#   broadcast/                                   forge deployment records
#   tools/unica-verify/fixtures/                 a settlement captured off a fork
#   integrations/ensv2/fixtures/                 ENSv2 Sepolia wire bytes, three real refusals among them
#   integrations/arc-treasury/transcript.json    an Arc RPC request/response transcript
#   tools/unica-sign/vectors.json                hand-authored EIP-712 signing vectors
#   integrations/arc-nanopayments/vectors.json   hand-authored authorization vectors
#
# The two vectors.json files are named INDIVIDUALLY and not by a `*/vectors.json` glob, on purpose.
# They were exempt by accident until 2026-09-09: the label filter ran on git grep's whole output
# line, the alternation contains `vector`, and the FILENAME supplied the match — so every 32-byte
# value in them was invisible to this rule, and so was anything in any `*.txt` (the alternation also
# contains `tx`). Naming them is a decision; inheriting an exemption from a filename is an accident.
artifacts="':!broadcast/' ':!tools/unica-verify/fixtures/' ':!integrations/ensv2/fixtures/' ':!integrations/arc-treasury/transcript.json' ':!tools/unica-sign/vectors.json' ':!integrations/arc-nanopayments/vectors.json'"
# The label filter must see ONLY the line's CONTENT, never the "path:lineno:" prefix that
# `git grep -n` prepends. It used to be applied to the whole line, and the alternation contains
# `tx` — so every file whose PATH contained a label word was silently exempt from this rule.
# `.txt` was the one that found it: a bare 32-byte value in any `notes.txt` was never reported.
# A guard that a filename can switch off is not a guard, and the two controls below are what stop
# this coming back.
bare=$(eval "git grep --untracked -nE '0x[a-fA-F0-9]{64}' -- . ':!lib' $artifacts ':!script/scan.sh'" | while IFS= read -r line; do
  content=${line#*:}; content=${content#*:}
  printf '%s\n' "$content" | grep -qiE "$label" || printf '%s\n' "$line"
done || true)
chk "control: a label word in the PATH does not exempt the line" "d=\$(mktemp -d ./scanprobe-XXXX); printf 'const k = \"0x%064d\";\\n' 1 > \$d/notes.txt; r=0; git grep --untracked -nE '0x[a-fA-F0-9]{64}' -- \$d | while IFS= read -r l; do c=\${l#*:}; c=\${c#*:}; printf '%s\\n' \"\$c\" | grep -qiE \"\$label\" || exit 9; done; [ \$? -eq 9 ] && r=1; rm -rf \$d; [ \$r -eq 1 ]"
chk "no bare 32-byte value without a label on its line" "[ -z \"\$bare\" ]"
[ -n "$bare" ] && echo "$bare"

echo "checks run: $((ok+fail)), passed: $ok, failed: $fail"
[ "$fail" -eq 0 ]
