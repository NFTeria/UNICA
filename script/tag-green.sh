#!/usr/bin/env bash
# tag-green.sh — cuts a milestone tag only when everything the tag will be read as claiming is
# already in history and green. `make tag-green TAG=<name> MSG=<file>`; DRY_RUN=1 checks only.
#
# Gates, in order, each read from the tree, the remote, CI or the chain now, never from a claim:
#  1 the tree is clean and HEAD equals origin/main: nothing local that the tag would omit
#  2 CI concluded success for HEAD's own sha (a run listed right after a push is the previous one)
#  3 the tag exists neither locally nor on the remote: a published tag is never moved or recreated
#  4 make proof is all green: verify-day1 and verify-live each end with "failed: 0"
#  5 every required document names the tag, so the evidence and its presentation are in history
#    BEFORE the tag. Measured 2026-09-05: live-green was cut one commit before the README rows because
#    a failing step inside a long shell run did not halt it. This script halts on every failure.
#  6 the message file exists, is not empty, and names no tool or AI
# Then: an annotated tag from the file, pushed to origin.
set -euo pipefail
cd "$(dirname "$0")/.."
TAG=${TAG:?TAG=<name> is required}
MSG=${MSG:?MSG=<file with the tag message> is required}
REQUIRED_DOCS=${REQUIRED_DOCS:-"README.md docs/DEPLOYMENT.md"}
fail() { echo "STOP: $1"; exit 1; }

echo "== tag-green $TAG"
test -z "$(git status --short)" || fail "the working tree is not clean:
$(git status --short)"
git fetch -q origin
sha=$(git rev-parse HEAD)
test "$sha" = "$(git rev-parse origin/main)" || fail "HEAD $(git rev-parse --short HEAD) is not origin/main $(git rev-parse --short origin/main); push first"
echo "tree                clean; HEAD $(git rev-parse --short HEAD) = origin/main"

run=$(gh run list --limit 20 --json databaseId,headSha,status,conclusion --jq "[.[] | select(.headSha==\"$sha\")][0]")
test -n "$run" && test "$run" != null || fail "no CI run for $sha yet"
test "$(printf '%s' "$run" | python3 -c "import sys,json;r=json.load(sys.stdin);print(r['status'], r['conclusion'])")" = "completed success" || fail "CI for $sha is not a completed success: $run"
echo "ci                  success for this sha (run $(printf '%s' "$run" | python3 -c "import sys,json;print(json.load(sys.stdin)['databaseId'])"))"

! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || fail "tag $TAG already exists locally; a published tag is never moved"
test -z "$(git ls-remote --tags origin "refs/tags/$TAG")" || fail "tag $TAG already exists on origin; a published tag is never moved"
echo "tag                 $TAG does not exist yet"

proof=$(make proof 2>&1) || true
n=$(printf '%s\n' "$proof" | grep -c "failed: 0" || true); f=$(printf '%s\n' "$proof" | grep -c "^FAIL" || true)
test "$n" = 2 && test "$f" = 0 || fail "make proof is not all green ($n of 2 verifiers ended with failed: 0; $f FAIL rows):
$(printf '%s\n' "$proof" | grep -E '^FAIL|checks run')"
echo "proof               $(printf '%s\n' "$proof" | grep 'checks run' | tr '\n' ';')"

for d in $REQUIRED_DOCS; do grep -q -- "$TAG" "$d" || fail "$d does not name $TAG; the documentation lands before the tag, not after it"; done
echo "docs                $REQUIRED_DOCS all name $TAG"

test -s "$MSG" || fail "message file $MSG is missing or empty"
! grep -iqE 'co-authored-by|generated with|claude|anthropic|copilot|chatgpt' "$MSG" || fail "the message names a tool"
echo "message             $MSG, $(wc -l < "$MSG" | tr -d ' ') lines"
echo "tag-green: go"
if [ "${DRY_RUN:-}" = "1" ]; then echo "DRY_RUN=1: stopping before the tag"; exit 0; fi
git tag -a "$TAG" -F "$MSG" "$sha" && git push origin "refs/tags/$TAG" && echo "tagged and pushed $TAG at $(git rev-parse --short "$sha")"
