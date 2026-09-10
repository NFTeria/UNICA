# Contributing to UNICA

UNICA is public and MIT. Everything committed here is readable by anyone, forever, including every
intermediate commit and every branch that was ever pushed. Write as if the whole world is looking.

Read [`CLAUDE.md`](CLAUDE.md) before your first edit — it is the short list of rules that have
already cost something to learn. This file is the practical version of it.

## The three rules that cannot be undone after a push

1. **Authorship.** Every commit is authored by the repository owner alone. No `Co-Authored-By:`
   trailer naming a tool, no "generated with" line, no robot banner. CI's `provenance` job enforces
   this over the full history. Tool use is disclosed in [`AI_USAGE.md`](AI_USAGE.md) instead, which
   names the tools *and the files each one touched* — disclosure is about honesty, authorship is
   about credit, and both hold at once.
2. **Never copy code in.** Not from another repository, not from a reference implementation, not
   from a file someone wrote earlier to save time. Cite prior art in prose; never move its bytes.
   Write from the specification instead — the reasoning transfers, the file does not.
3. **No secrets, not once, not "temporarily."** No private key, seed phrase, keystore path, API
   credential, or RPC URL carrying a token. `script/scan.sh` runs the same scans CI runs and every
   pattern in it proves itself against a planted input first.

## Getting the repository running

```bash
git clone --recurse-submodules git@github.com:NFTeria/UNICA.git
cd UNICA
cp .env.example .env      # names only — never a value
make deps                 # vendored Foundry submodules, pinned
npm install               # the workspace application tree
```

Two toolchains, deliberately separate:

| Layer | Tool | Command |
|---|---|---|
| Contracts, scripts, proofs | Foundry | `make gate` |
| Application, indexer, shared types | Node workspaces | `npm run check` |

`make gate` is the contract gate: build, tests, `forge fmt --check`, both secret scans, the ENS and
Permit2 vectors, the signing tool, the receipt verifier, the tool ledger, and the offline half of
the V3 proof. It needs no network and no key. Anything that needs somebody else's node lives
outside the gate on purpose — a gate that depends on a remote endpoint is a status page.

## Commits

- **One idea per commit.** A message that needs "and" is two commits.
- Subject line: `type(scope): what — why`. Write the body in a file and use `git commit -F`.
- Small, separate, pushed within minutes. Large single commits and missing history are a
  disqualifier in judged work and a review failure everywhere else.
- Never land a batch of generated files as one commit.

## Knowing it actually works

- "It passed" is a claim, not a fact. Look at the real result yourself.
- Validate the instrument before you trust the reading: break a check on purpose and confirm it
  screams. **A check that has never failed is not a check.**
- A stated negative beats an absence. Say "29 checks run, 0 failed" — never a blank panel, because
  an empty result and a broken reporter look identical.
- A negative test must reproduce the bug's *precondition*, not merely omit the defence.

## Truth in what ships

No feature, deadline, or demo is worth a claim that is not real. Deployed is not verified, verified
is not exercised, and a testnet is not a mainnet. The public surface is gated on this: 
`script/check-surface.sh` refuses a set of banned phrases and asserts the one approved product
claim verbatim. If a sentence trips it, the remedy is to reword the sentence, not to widen the ban.

## Reporting a vulnerability

See [`SECURITY.md`](SECURITY.md). Do not open a public issue for anything exploitable.
