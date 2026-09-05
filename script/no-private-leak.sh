#!/usr/bin/env bash
# A leak-prevention HEURISTIC, not a proof. It looks for phrasing that has travelled from
# private research material into a file destined for this public repository.
#
# Why it exists: a draft written this week printed a private filesystem path twice and carried a
# quoted phrase lifted from a private probe, while twice attesting in its own text that it had
# done neither. Whole-line comparison finds none of that — private prose is reflowed, trimmed and
# re-wrapped on its way into a document, so the leak is a PHRASE inside a line, never the line.
#
# HOW IT COMPARES. Both sides are normalised — lowercased, punctuation dropped, whitespace
# collapsed — and then cut into overlapping windows of WINDOW words (default 12). A public
# window that appears in the private corpus is reported. Twelve words is long enough that shared
# technical vocabulary does not trip it and short enough to catch a reflowed sentence.
#
# WHAT IT NEVER DOES. It never prints private text. A hit reports the PUBLIC file and line and a
# redaction carrying only the window's length, so a CI log or a terminal scrollback cannot become
# the leak it was meant to prevent. It never copies, stages or embeds private files, and it holds
# no private path: the corpus location comes from UNICA_PRIVATE_DIR at run time, so nothing about
# the private tree is committed here.
#
# WHAT IT DOES NOT CATCH. Paraphrase. Facts restated in new words. A leak of meaning rather than
# of phrasing. Material outside the named corpus. It is one cheap check against one real failure
# mode, and passing it is not evidence that a document is free of private content.
#
# With UNICA_PRIVATE_DIR unset it SKIPS, loudly, and says so — a skip is reported as a skip and
# never as a pass, because an empty corpus and a clean tree look identical.
#
#   UNICA_PRIVATE_FILES=/path/a.md:/path/b.md bash script/no-private-leak.sh
#   bash script/no-private-leak.sh --self-test    # synthetic corpus; needs no private material
set -uo pipefail
cd "$(dirname "$0")/.."
exec python3 - "${1:-}" <<'PY'
import os, re, subprocess, sys, tempfile, glob

MODE = sys.argv[1] if len(sys.argv) > 1 else ''
WINDOW = int(os.environ.get('WINDOW', '12'))

def norm(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9 ]+', ' ', text)
    return re.sub(r'\s+', ' ', text).strip().split()

def windows(words, n):
    return {' '.join(words[i:i + n]) for i in range(max(0, len(words) - n + 1))}

def corpus_from(paths):
    got = set()
    for p in paths:
        try:
            got |= windows(norm(open(p, encoding='utf-8', errors='ignore').read()), WINDOW)
        except OSError:
            pass
    return got

def scan(files, corpus):
    """Return (public_file, line_no, window_length). Never the matched text."""
    hits = []
    for f in files:
        try:
            lines = open(f, encoding='utf-8', errors='ignore').read().split('\n')
        except OSError:
            continue
        for i, line in enumerate(lines, 1):
            w = norm(line)
            if len(w) < WINDOW:
                continue
            for win in windows(w, WINDOW):
                if win in corpus:
                    hits.append((f, i, len(win.split())))
                    break
    return hits

checks = []

# ---- self-tests, on a synthetic corpus. No private material is read or needed. ----
if MODE == '--self-test':
    with tempfile.TemporaryDirectory() as td:
        secret = ('the deployer wallet was funded from the reserve account before the rehearsal '
                  'and the figure was never published anywhere')
        open(os.path.join(td, 'private.md'), 'w').write('# private\n\n' + secret + '\n')
        corpus = corpus_from(glob.glob(os.path.join(td, '*.md')))

        pos = os.path.join(td, 'leaky.md')
        open(pos, 'w').write('Some ordinary framing. ' + secret + ' And more framing.\n')
        checks.append(('self-test positive: a reflowed private phrase is caught',
                       len(scan([pos], corpus)) > 0))

        neg = os.path.join(td, 'clean.md')
        open(neg, 'w').write('The recipient receives at least the minimum the order names, and '
                             'the executor ends the transaction holding nothing at all here.\n')
        checks.append(('self-test negative: ordinary prose is not caught',
                       len(scan([neg], corpus)) == 0))

# The corpus is DESIGNATED, never swept. Pointing this at a whole research directory is the
# wrong shape and was measured to be: this project's war room holds the pre-event specification
# and threat model, which were deliberately disclosed and shipped into specs/, so a directory
# sweep reported 26 "leaks" that are the disclosure working as intended. Only files an owner has
# named as private-and-staying-private belong here.
priv = os.environ.get('UNICA_PRIVATE_FILES', '').strip()
if not priv:
    for name, good in checks:
        print(('PASS  ' if good else 'FAIL  ') + name)
    print('SKIP  private corpus not configured (set UNICA_PRIVATE_FILES to a colon-separated list of designated files); this is a SKIP, not a pass')
    npass = sum(1 for _, g in checks if g)
    print(f'checks run: {len(checks)}, passed: {npass}, failed: {len(checks) - npass}, skipped: 1')
    sys.exit(0 if npass == len(checks) else 1)

sources = []
for entry in priv.split(':'):
    entry = os.path.expanduser(entry.strip())
    if not entry:
        continue
    if os.path.isfile(entry):
        sources.append(entry)
    else:
        sources += [q for q in glob.glob(entry) if os.path.isfile(q)]
corpus = corpus_from(sources)
checks.append((f'designated private corpus loaded ({len(sources)} files, {len(corpus)} phrase windows)',
               len(corpus) > 0))

tracked = [f for f in subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split()
           if f.endswith(('.md', '.html', '.sh', '.sol', '.ts', '.yml', '.yaml'))]

# A phrase that is ALREADY PUBLIC cannot be a leak, whichever file it turns up in next.
# This subtraction is what makes the check usable, and the reason is worth stating: private
# research about a public repository QUOTES that repository, so raw phrase overlap runs in both
# directions and cannot say which way the text travelled. Measured here: against one designated
# private probe, sixteen tracked files matched, and every one was the probe quoting the repo.
# Subtracting the committed public corpus removes that whole class.
already_public = corpus_from(tracked)
corpus -= already_public

targets = tracked
extra = os.environ.get('UNICA_DRAFTS_DIR', '').strip()
if extra:
    targets += [p for p in glob.glob(os.path.join(os.path.expanduser(extra), '*.md')) if os.path.isfile(p)]

print(f'      (phrase windows already public and therefore excluded: {len(already_public)})')
hits = scan(targets, corpus)
checks.append((f'no public file reproduces a private phrase window of {WINDOW}+ words '
               f'({len(targets)} files scanned)', not hits))

for name, good in checks:
    print(('PASS  ' if good else 'FAIL  ') + name)
for f, i, n in hits[:40]:
    print(f'      {f}:{i}  matched a {n}-word private phrase  [REDACTED]')
if len(hits) > 40:
    print(f'      ... and {len(hits) - 40} more')

npass = sum(1 for _, g in checks if g)
print(f'checks run: {len(checks)}, passed: {npass}, failed: {len(checks) - npass}')
sys.exit(0 if npass == len(checks) else 1)
PY
