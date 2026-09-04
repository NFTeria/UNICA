# AI_USAGE.md

Disclosure of AI tooling used to build this repository. Granular by design: a blanket
"AI was used" is not a disclosure, and in judged work it is treated as non-compliance.

**Authorship is separate from tooling.** Every commit here is authored under the
repository owner's project identity alone (see `CLAUDE.md`); no commit carries an AI
co-author trailer, and none will. This file records which tools assisted and exactly
where. Both statements are true at once.

**Who did what.** An AI coding assistant, directed by the owner in an interactive
session, drafted the files listed below and ran the local git, build, and test
commands. The owner set the design, made every ruling recorded in the design documents,
reviewed the output, and holds the keys: every on-chain broadcast, every account, every
form, and every purchase is the owner's own action, performed outside the assistant.

## Tools

| Tool | Version / model | What it was used for |
|---|---|---|
| Claude Code (Anthropic) | `claude-fable-5-1` | Drafting every file named in the table below, under the owner's direction; running `forge`, `cast`, and `git` locally; reading official documentation and on-chain state to verify facts before they were written down |
| Uniswap AI skills (`github.com/Uniswap/uniswap-ai`) | as installed in the same assistant | Consulted before the hook frame was written, as the track's own resources suggest; what it produced, and where it broke against the pinned dependencies, is logged in `FEEDBACK.md` the hour it happened |
| Foundry | forge/cast `1.3.5-foundry-zksync-v0.1.9`, anvil `1.5.1-stable` | Build, test, fuzz, deploy. Not an AI tool; listed so the toolchain is on record with the rest |

## Files and directories each tool touched

Updated with every commit that adds or changes a file. A path missing from this table
was not AI-assisted.

| Path | Tool | Nature of assistance |
|---|---|---|
| `LICENSE` | Claude Code | Standard MIT text; the third-party notice paragraph was drafted by the assistant |
| `README.md` | Claude Code | Drafted by the assistant from the design documents; every address, hash, and count in it is verified by the command printed beside it |
| `.gitignore` | Claude Code (earlier session, owner's toolkit) | Public repository template from the owner's toolkit, written with AI assistance before this repository existed; it is configuration, not project code |
| `CLAUDE.md` | Claude Code (earlier session, owner's toolkit) | Public repository template from the owner's toolkit, same provenance as `.gitignore`; the header block naming this project was added by the assistant in this session |
| `AI_USAGE.md` | Claude Code | This file, drafted by the assistant from the toolkit's public template |
| `FEEDBACK.md`, `BACKFEED.md`, `docs/feedback/README.md` | Claude Code (earlier session, owner's toolkit) | Public templates from the owner's toolkit; every entry added to them is written in this session at the time the friction or the thought occurred |

## Pre-existing work carried in

Everything written before the build window (2026-09-04 16:00 UTC) is listed here by name
and lives where the table says. Disclosed prior work is permitted; **undisclosed** prior
work is the offence, and re-dating or quietly rewriting it to look fresh converts a
disclosed advantage into misrepresentation.

| Artifact | Written | Where it sits here | Disclosed as |
|---|---|---|---|
| The settlement-hook specification (design of record v2 with v3 addenda) | 2026-08-21, addenda 2026-08-23, internal links pruned 2026-09-04 before the window opened | `specs/` | Pre-event design. Drafted in the owner's private planning tree with the same AI tooling. Shipped unedited from the moment the window opened; its own date stamps are its dates |
| The threat model (T1–T13) | 2026-08-21 | `specs/` | Pre-event analysis, same provenance and same rule |
| Toolchain configuration: `foundry.toml`, `remappings.txt`, the CI workflow | drafted 2026-08-23 and rehearsed in throwaway drills that were deleted | `foundry.toml`, `remappings.txt`, `.github/workflows/ci.yml` | Starter-kit configuration in the class the rules permit. Brought in file by file, each re-verified against the vendored tree in this session. No Solidity, no test, and no repository existed before the window |
| Public repository templates (`CLAUDE.md`, `.gitignore`, `AI_USAGE.md`, `FEEDBACK.md`, `BACKFEED.md`, `docs/feedback/README.md`) | the owner's toolkit, before the window | repository root and `docs/feedback/` | Generic templates that name no project; the same files go into every public repository the owner starts |
| `github.com/Uniswap/v4-template` (MIT, copyright 2023 saucepoint) | upstream, pinned at `1fbf955` (2025-10-28) | its dependency set and ten remappings are reproduced in `.gitmodules` and `remappings.txt`; the template was not cloned | Public starter kit, disclosed and attributed in `LICENSE` |
| `forge-std`, OpenZeppelin `uniswap-hooks` v1.1.1, `hookmate`, and through them `v4-core`, `v4-periphery`, `permit2`, `solmate`, `openzeppelin-contracts` | upstream | `lib/`, as git submodules with their own licences | Dependencies, used normally, never relicensed |

The line a judge can check in one command: the first commit in this history is after
2026-09-04 16:00 UTC, and no Solidity, test, or repository for this project existed
before it.

## Prompts

The session was driven by written task briefs kept in the owner's private planning tree.
They carry the event schedule, sponsor rulings, and other material that is not part of
the contribution, so they are not published. The design inputs the assistant worked from
are the two documents in `specs/`, which are published in full. Where a prompt shaped a
specific artifact, the artifact's commit message says so.

## What was NOT AI-assisted

- The design decisions: the router-gated architecture, the invariants and their ranking,
  the native-ETH / Circle-USDC demo pair, the multi-chain single-address requirement,
  the choice of partners. These are the owner's and are recorded in `specs/`.
- Every on-chain broadcast. The assistant prepares and validates commands; the owner runs
  them from a keystore the assistant never reads.
- Every account, form submission, purchase, and the recorded voice in the demo video.
- Review and acceptance of every change. The assistant's output was read before it was
  committed, and the owner is responsible for what is in this history.
