#!/usr/bin/env python3
"""One line per test in a `forge test --json` document: "<contract>::<test> <status>".

Kept out of run-limits.sh because a Python program embedded in a shell string cannot use quotes
freely, and the first version of this — inlined with escaped quotes inside an f-string — parsed
nothing at all and made the runner report "no test results". The runner treated that as a FAILED
check rather than as a pass, which is the only reason it was noticed. Silence is not evidence.
"""
import json
import sys

try:
    doc = json.load(sys.stdin)
except Exception as exc:  # a malformed document is a reportable failure, not an empty result
    print("PARSE_ERROR " + str(exc))
    sys.exit(1)

rows = []
for suite, body in doc.items():
    contract = suite.split(":")[-1]
    for name, result in (body.get("test_results") or {}).items():
        rows.append(contract + "::" + name.split("(")[0] + " " + str(result.get("status")))

for row in sorted(rows):
    print(row)
