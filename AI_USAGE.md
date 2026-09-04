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
| Uniswap AI skills (`github.com/Uniswap/uniswap-ai`, plugin `uniswap-hooks` 1.6.0) | as installed in the same assistant | Consulted before the hook frame was written, as the track's own resources suggest. Its generator depends on an MCP tool the plugin does not ship, so it produced no code; the hook was hand-written from the spec. Logged in `FEEDBACK.md` the hour it happened |
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
| `src/V4SettlementHook.sol` | Claude Code | Drafted on day 1 (as `UnicaHook`) from `specs/HOOK-SPEC.md` sections 5 and 7d and the pinned OpenZeppelin `BaseHook`. Reworked on day 2 night to the owner's execution-path ruling: the gate to the official Universal Router and the executor, the order checks read from the executor's storage, the receipt and the standard `HookFee`; renamed for the venue the same night |
| `src/SettlementExecutor.sol`, `src/libraries/UniswapDeployments.sol` | Claude Code | Day 2 night. The executor composes the Universal Router plan from the pinned v4-periphery `IV4Router`, `Actions` and `ActionConstants`, written from those sources and the owner's five-layer directive; the router address was read from the official deployments page and checksummed by `cast`. Replaces the day-2 `UnicaSettlementRouter`, whose history stays in git |
| `test/V4SettlementHook.t.sol` | Claude Code | Drafted from `specs/THREAT-MODEL.md` T5 and v4-core's own `Deployers` test utilities. The first salt-mining loop ran out of memory and was corrected in the same hour; the guard was sabotaged (beforeSwap flipped on) and seen to fail before it was trusted. Day 2 night: the gate tests against the deployed Universal Router runtime and the hook's order checks through the executor harness |
| `test/utils/SettlementTestBase.sol` | Claude Code | Written from the v4 interfaces and hookmate's artifact API on day 2 so the tests deploy Uniswap's official PoolManager bytecode instead of compiling it; replaces the day-1 dependency on v4-core's `Deployers`. Day 2 night: etches the official Universal Router runtime at its Sepolia address |
| `test/utils/artifacts/UniversalRouterV2Sepolia.sol` | Claude Code (a generator script) | The bytes are Uniswap's deployed runtime, read from Sepolia with `cast code` on 2026-09-04 and wrapped in a library by a script the assistant wrote; the keccak in the file re-verifies them |
| `test/SettlementExecutor.t.sol`, `test/I7NativeSettle.t.sol`, `test/utils/RouterHarness.sol`, `test/utils/ExecutorHarness.sol` | Claude Code | Day 2. The executor tests assert shape, never arithmetic; the fuzzer's partial-fill counterexample became its own test. The I7 file is the four-row design from the build card, defence on/off crossed with the foreign-sync precondition present/absent, with the router harness (now a stand-in at the official router's address) making the defence switchable, plus a fifth row against the official router's bytecode. The executor harness drives the official router with arbitrary plans so the hook's own checks are reachable |
| `script/Chains.sol`, `script/LiveFire.s.sol` | Claude Code | Drafted from `specs/HOOK-SPEC.md` sections 7c and 7d and the pinned v4-core test routers; every address was read from the official deployments page and checksummed by `cast`, not typed. Simulated against live Sepolia state and rehearsed on an anvil fork before any handoff |
| `script/DeploySettlement.s.sol`, `script/Interactions.s.sol` | Claude Code | Day 2: thin named entry points over the shared script base, so each stage is one `make` target |
| `script/rehearse-anvil.sh`, `script/readback.sh`, `script/verify.sh`, `Makefile` | Claude Code | Written from the conventions of the owner's earlier deploy tooling (keystore-only signing, public RPC defaults, anvil-fork rehearsal by impersonation); nothing was copied from it. Three bash 3.2 parse errors were found by running them and fixed the same hour |
| `design/README.md` | Claude Code | Drafted from the surface brief in the session's task description |
| `PLAN.md` | Claude Code | Drafted from the pre-event day budget, restricted to the technical schedule |
| `docs/INVARIANTS.md`, `docs/THREAT-MODEL.md`, `specs/README.md`, `HACKATHON.md` | Claude Code | Drafted by the assistant; every rung stated is the one the tree had reached at the commit |
| `docs/ARCHITECTURE.md` | Claude Code | Drafted from the owner's direction on the three partners and the Vyper allocation; corrected in place to the owner's ruling the same evening; the official-execution-path table appended the same night |
| `docs/EXECUTION-PATH.md` | Claude Code | The ten verification questions the owner set, answered from the pinned v4-periphery sources, the `Uniswap/universal-router` repository, and the deployed Sepolia routers read with `cast`; every answer carries its file and line |
| `.github/workflows/ci.yml` | Claude Code | Written from the starter-kit CI configuration, then reworked five times against real red runs on the remote (submodule tags, EIP-170 sizes, the secrets and private-material checks, compiler caching, the fresh-clone lane) |
| `.env.example` | Claude Code | Variable names only |
| `docs/proof/README.md`, `docs/proof/verify-day1.sh` | Claude Code | The manifest and the re-verification script, written from the receipts read back from Sepolia |
| `docs/proof/01-…04-*.png` | none (captures) | Screenshots of public explorer pages, taken with macOS `screencapture` of a browser window, cropped to remove the browser toolbar. Not generated or altered by any tool beyond the crop |
| `broadcast/LiveFire.s.sol/11155111/*.json` | none (Foundry output) | Written by `forge script --broadcast` when the owner ran the live-fire; committed unchanged as the deployment record |

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

- The design decisions: the architecture on the official execution path, the invariants and their ranking,
  the native-ETH / Circle-USDC demo pair, the multi-chain single-address requirement,
  the choice of partners. These are the owner's and are recorded in `specs/`.
- Every on-chain broadcast. The assistant prepares and validates commands; the owner runs
  them from a keystore the assistant never reads.
- Every account, form submission, purchase, and the recorded voice in the demo video.
- Review and acceptance of every change. The assistant's output was read before it was
  committed, and the owner is responsible for what is in this history.
