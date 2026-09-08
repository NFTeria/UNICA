# secret-patterns.sh — ONE definition of what a secret looks like, sourced by every scanner.
#
# WHY THIS FILE EXISTS. The pattern used to live in script/scan.sh and be COPIED into
# script/check-surface.sh, with a comment saying the two were the same. On 2026-09-08 they were
# not: scan.sh's copy had been taught the JSON `NAME: value` shape and check-surface.sh's had not,
# so the scanner guarding the PUBLISHED page was the weaker of the two and nothing said so. Two
# descriptions of one thing is a mismatch waiting to happen; this file is the one description.
#
# It defines variables and does nothing else — no checks, no output, no exit. Sourcing it must be
# free of side effects, because both scanners source it before their own controls run.
#
# THE RULE, in two stages. Stage one finds a name, a separator and a value of eight or more
# characters. Stage two keeps only values carrying a digit or a hyphen, which is what separates a
# credential from code: `undefined`, `SecretsConfig`, `endpoint.secrets` and `key.length` are all
# eight-plus characters and none of them is a secret. Both stages must match.
#
# KNOWN GAP, stated rather than assumed closed: an all-alphabetic passphrase — `correcthorse` —
# is NOT caught, because nothing about its shape distinguishes it from an identifier. Each scanner
# carries a control asserting that gap so it stays visible. Closing it needs entropy analysis,
# which is a different tool than this one.

q="[\"']"                          # a quote, either kind
nq="[^[:space:]<\$\"']"            # a value character: not space, not < or $ (placeholders), not a quote
nqd="[^[:space:]<\$\"'-]"          # ...and not a hyphen, which guards the FIRST value character only:
                                   # without it `${PASSWORD:-default}` reads as a value with a hyphen,
                                   # because the name repeats inside the braces past the `$` guard.
name="(PRIVATE_KEY|MNEMONIC|SECRET|API_KEY|AUTH_TOKEN|PASSWORD)[A-Z_]*"
sep="${q}?[[:space:]]*[:=][[:space:]]*${q}?"

assign="${name}${sep}${nq}{8,}"            # stage one
material="${name}${sep}${nqd}${nq}*[0-9-]" # stage two
tokens='"ciphertext"|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}'
