# INTEGRATIONS — what UNICA can fix or contribute, per sponsor

**Dated 2026-09-04.**

This file is the ranked, evidence-first record of every upstream fix, reproduction, schema, test and documentation correction UNICA is in a position to contribute, drawn entirely from the sponsor research pass completed on 2026-09-04. The qualification rule is strict and applied here without exception: an item counts as *fixing something* only when there is a reproducible defect and a small useful artifact that closes it — an available SDK, a badge, or a wrapper around a working product does not qualify, however much effort it would take. Every item below is ordered by the strength of its evidence and the usefulness of its artifact, never by which sponsor it points at; where the ranking rule and the strength of a measurement disagree, the rule wins and the disagreement is stated in the open.

**Ranking rule as applied.** Upstream fixes, minimal reproductions, reusable event schemas, conformance tests, tested adapters and precise documentation corrections outrank anything that merely adds an SDK. An item with no directly applicable published requirement cannot rank above one that has one — which is why three of the strongest measurements in this file (ranks 20–22) sit below weaker documentation items. That is deliberate, and it is called out on each of them.

**A note on names.** The research pass named several in-tree files by their earlier names. Paths in this report were re-checked against the repository on 2026-09-04 and are written in their current, verified form: `src/V4SettlementHook.sol`, `src/SettlementExecutor.sol`, `test/V4SettlementHook.t.sol`, `test/SettlementExecutor.t.sol`, `test/utils/SettlementTestBase.sol`. One name change is a component, not a file: the specification calls the settlement driver `UnicaSettlementRouter` (`specs/HOOK-SPEC.md` §2), and in the tree it is `src/SettlementExecutor.sol`. Where the research pass wrote "the router", this report writes "the executor" and means that contract — never Uniswap's official Universal Router, which is a separate contract the hook admits swaps from. All paths are repository-relative.

---

# Verified fixes, ranked by evidence and artifact

Every item in this part carries a reproduced defect and a small artifact that closes it. Confidence is stated per item; nothing here is a claim of qualification, which is pending until each published requirement is demonstrated end to end.

## 1 — Seven live v4 hook guides teach a `BaseHook` import path that exists nowhere in v4-periphery

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, Best Uniswap Stack Contribution, verbatim from the prize-page snapshot dated 2026-09-04T19:49Z: "This also includes new v4 hooks, extensions or improvements to official Uniswap repositories, and tooling or solutions built for the broader ecosystem." Qualification Requirements, verbatim: "A public GitHub repository with open-source code, a FEEDBACK.md file, and a completed submission to the Uniswap Developer Feedback Form … Make sure your README clearly points to the relevant contracts and lines of code so we can verify your integration." |
| **2. Exact user or developer problem** | The published hook guides instruct the reader to `import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol"`. That path is not in the repository at any commit on main. The file moved out of `src/base/hooks/` to `src/utils/` (v4-periphery issue #438), the docs were corrected to `src/utils/` (Uniswap/docs #896), and then `src/utils/` was deleted outright — so the correction is stale in the same way the original was. Expected: copy the import, run `forge build`, the hook compiles. Actual: solc cannot resolve the path, and the guide's first code block cannot compile as written. BaseHook's real home today is OpenZeppelin/uniswap-hooks `src/base/BaseHook.sol`. |
| **3. Official product or repository involved** | github.com/Uniswap/docs — seven files under `content/` (the only directory CONTRIBUTING.md says accepts PRs): `content/protocols/v4/guides/hooks/your-first-hook.mdx`, `getting-started.mdx`, `swap-hooks.mdx`, `liquidity-hooks.mdx`, `async-swap.mdx`, `accessing-msg.sender.mdx`, and `content/protocols/v4/guides/custom-accounting.mdx`. Seven further hits sit under `archive/`, which CONTRIBUTING.md excludes. |
| **4. Reproduction or primary-source evidence** | `gh api -X GET search/code -f q='"v4-periphery/src/utils/BaseHook.sol" repo:Uniswap/docs'` → 14 hits (7 under `content/`, 7 under `archive/`), fetched 2026-09-04T22:12:49Z. `gh api repos/Uniswap/v4-periphery/contents/src/utils` → HTTP 404, same timestamp. `gh api 'repos/Uniswap/v4-periphery/git/trees/main?recursive=1'` filtered for `basehook` → zero matches, same timestamp. `gh api repos/OpenZeppelin/uniswap-hooks/contents/src/base` → lists `BaseHook.sol`. |
| **5. Smallest useful artifact** | One line per file — `import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";` — plus one sentence stating that v4-periphery no longer ships BaseHook and naming the remapping. Seven files, one PR. It is complementary to the open PR #1116, not duplicative: #1116 touches only `docs/contracts/v4/quickstart/hooks/setup.mdx`, a path now under `archive/`, and has been dirty and unanswered since 2026-04-26. |
| **6. Red/green test or measurable proof** | RED: the guide's import as published does not resolve; `forge build` fails on file-not-found against a current v4-periphery. GREEN: `src/V4SettlementHook.sol:4` uses the corrected path, `forge build --sizes` exits 0 (measured 2026-09-04T22:10Z), and `test/V4SettlementHook.t.sol` is green (`test_MinedAddress_MatchesDeclaredPermissions`, `test_NoUndeclaredPermissionsCreepIn`, `test_RevertWhen_SwapSenderIsNotTheOfficialRouter`). The corrected path is also proven on-chain: the hook built from it is verified on Sepolia at `0x23b46783709E4A94C229612bfA55580a6682c040` and re-provable with `bash docs/proof/verify-day1.sh`, which prints its own stated negative — `checks run: 14, passed: 14, failed: 0`. |
| **7. Account, key, form, or owner dependency** | A GitHub account and a fork. No API key, no form, no sign-up. The owner opens the PR. |
| **8. License and upstream contribution path** | Uniswap/docs is MIT (`gh api repos/Uniswap/docs` → `license.spdx_id` MIT, 2026-09-04T22:08:47Z). CONTRIBUTING.md present; fork + PR against main, content changes only under `content/`; no CLA — CONTRIBUTING.md states verbatim: "By submitting a pull request you agree that your contribution is licensed under this repository's MIT license." Its own caveat matters: "The docs published at developers.uniswap.org are built from a separate source repository. When we accept a change here, we port it into that publishing pipeline." |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — nothing to remove. The hook already imports the corrected path; this is upstream-only. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 2 — `hook-deployment.mdx` teaches a deleted `HookMiner` import and links a 404

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, Best Uniswap Stack Contribution, verbatim: "extensions or improvements to official Uniswap repositories, and tooling or solutions built for the broader ecosystem"; Qualification Requirements, verbatim: "A public GitHub repository with open-source code, a FEEDBACK.md file, and a completed submission to the Uniswap Developer Feedback Form." (Snapshot dated 2026-09-04T19:49Z.) |
| **2. Exact user or developer problem** | The deployment guide instructs `import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";` and links a GitHub deep-link to the same path. Neither resolves: on v4-periphery main, HookMiner exists only at `test/shared/HookMiner.sol`. Expected: the import resolves and `forge script` mines a salt. Actual: the build fails at the one step a v4 hook cannot skip, and the linked page 404s. |
| **3. Official product or repository involved** | github.com/Uniswap/docs, `content/protocols/v4/guides/hooks/hook-deployment.mdx` (the only live file; the second hit is under `archive/`). |
| **4. Reproduction or primary-source evidence** | `gh api -X GET search/code -f q='"v4-periphery/src/utils/HookMiner.sol" repo:Uniswap/docs'` → 2 hits, 1 under `content/`, fetched 2026-09-04T22:12:49Z. `gh api repos/Uniswap/v4-periphery/contents/src/utils` → HTTP 404. The recursive tree filtered for `hookminer` → `test/shared/HookMiner.sol` and `test/shared/HookMinerCreate3.sol`, same timestamp. Downstream: `script/LiveFire.s.sol:19` carries `import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";` and resolves **only** because its v4-periphery is pinned at 7ebd04b (via OpenZeppelin uniswap-hooks v1.1.1), which predates the move. |
| **5. Smallest useful artifact** | A one-line import correction plus the dead deep-link, in one file: point at `v4-periphery/test/shared/HookMiner.sol` (noting that `test/shared` is not a stable public surface — see rank 11) or at hookmate, and add one sentence recommending a pinned commit SHA, since v4-periphery publishes zero tags and zero releases. |
| **6. Red/green test or measurable proof** | RED: `forge build` against v4-periphery main with the guide's import fails to resolve the file. GREEN: `script/LiveFire.s.sol` compiles and ran for real — the mined address `0x23b46783709E4A94C229612bfA55580a6682c040` deployed on Sepolia (receipt status 1) and `make predict` reproduces the address and the salt `0x93fb`. Re-provable with `bash docs/proof/verify-day1.sh`. The pin boundary itself is the red/green pair, which is the sharpest form a maintainer can act on. |
| **7. Account, key, form, or owner dependency** | GitHub account and fork. Owner opens the PR. |
| **8. License and upstream contribution path** | Uniswap/docs, MIT, fork + PR against `content/`, CONTRIBUTING.md present, no CLA (verbatim licence-grant sentence quoted at rank 1). |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes, and nothing in the hook changes. It would be honest to also annotate `script/LiveFire.s.sol:19` with the pinned form — a one-line change to a script, fully removable. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 3 — An official AI plugin ships a hook template importing `BaseHook` from a path that never existed on main

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, Best Uniswap Stack Contribution, verbatim: "extensions or improvements to official Uniswap repositories, and tooling or solutions built for the broader ecosystem"; and the qualification requirement "a FEEDBACK.md file, and a completed submission to the Uniswap Developer Feedback Form … that includes the link to your FEEDBACK.md file." |
| **2. Exact user or developer problem** | The `uniswap-hooks` plugin's base hook template has as line 11 `import {BaseHook} from "v4-periphery/src/base/hooks/BaseHook.sol";`. That path 404s on main, and unlike rank 1 it is not merely stale — no `BaseHook.sol` exists at any path in v4-periphery today. A tool shipped to generate hooks therefore emits code that cannot compile. The same template also uses `IPoolManager.SwapParams`, which in v4-core d153b04 is declared in `src/types/PoolOperation.sol` and does not exist inside `IPoolManager`. |
| **3. Official product or repository involved** | github.com/Uniswap/uniswap-ai, `packages/plugins/uniswap-hooks/skills/v4-security-foundations/references/base-hook-template.md`, line 11 (line 8 is `pragma solidity ^0.8.24;`). |
| **4. Reproduction or primary-source evidence** | `gh api repos/Uniswap/uniswap-ai/contents/packages/plugins/uniswap-hooks/skills/v4-security-foundations/references/base-hook-template.md` decoded and sliced at lines 8–14 → prints the literal import line, fetched 2026-09-04T22:13:04Z. The v4-periphery recursive tree filtered for `basehook` → zero output, same session. |
| **5. Smallest useful artifact** | Two lines in one file: the BaseHook import corrected to `@openzeppelin/uniswap-hooks/src/base/BaseHook.sol`, and the `SwapParams` reference corrected to the `PoolOperation.sol` type, with a one-line comment naming the v4-core commit the types come from. |
| **6. Red/green test or measurable proof** | RED: paste the template into a Foundry project on the current stack; `forge build` fails at the import. GREEN: `src/V4SettlementHook.sol:4` and `:14` use the corrected import and the corrected `SwapParams` source; `forge build --sizes` exits 0 (2026-09-04T22:10Z) and `test/V4SettlementHook.t.sol` passes. `FEEDBACK.md` carries the dated first-hand entry (2026-09-04, "`v4-security-foundations` run over the real gate and router") with its 22:02 UTC evidence line. |
| **7. Account, key, form, or owner dependency** | GitHub account and fork; if an outside PR is not accepted, the same reproduction filed as an issue. No API key, no form. |
| **8. License and upstream contribution path** | Uniswap/uniswap-ai is MIT (`gh api`, 2026-09-04T22:08:47Z). No CONTRIBUTING.md at root; contributions by PR or issue; no CLA found. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA at all. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 4 — `PoolManager` only fits under EIP-170 with v4-core's own `via_ir` and optimizer settings, and nothing says so

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, Best Uniswap Stack Contribution, verbatim: "extensions or improvements to official Uniswap repositories, and tooling or solutions built for the broader ecosystem." |
| **2. Exact user or developer problem** | `PoolManager` compiles to 34,623 bytes of runtime under Foundry's defaults — 10,047 bytes over EIP-170 — and to 24,050 bytes (526 bytes of margin) under v4-core's own `foundry.toml` (`via_ir = true`, `optimizer_runs = 44444444`). Any downstream project that compiles it into its own build and runs `forge build --sizes` gets a hard build error naming a contract it did not write and whose upstream deployment is demonstrably under the limit, so the error reads as a bug in the integrator's project. No README, doc page or comment states that these settings are load-bearing for *size* rather than for gas. |
| **3. Official product or repository involved** | github.com/Uniswap/v4-core — `src/PoolManager.sol` together with `foundry.toml` (`optimizer_runs = 44444444`, `via_ir = true`, `solc = "0.8.26"`, `evm_version = "cancun"`), fetched 2026-09-04T22:10:28Z; identical at the pinned d153b04. |
| **4. Reproduction or primary-source evidence** | Freshly reproduced 2026-09-04T22:10Z in a scratch project outside the repository (a four-line source file wrapping `PoolManager`, remapped into the pinned v4-core). RED, `via_ir=false` and no optimizer: `forge build --sizes` prints `| PoolManager | 34,623 | 35,048 | -10,047 | 14,104 |` and exits with `Error: some contracts exceed the runtime size limit (EIP-170: 24576 bytes)`. GREEN, same file with `via_ir=true, optimizer=true, optimizer_runs=44444444`: `| PoolManager | 24,050 | 24,235 | 526 | 24,917 |`, no error. Toolchain: forge 1.3.5-foundry-zksync-v0.1.9, solc 0.8.26. |
| **5. Smallest useful artifact** | A three-sentence README or CONTRIBUTING note in v4-core: `PoolManager` requires `via_ir` and a high `optimizer_runs` to stay under EIP-170; downstream projects should not compile it (etch the deployed bytecode instead) or must copy those settings; the current margin is about 500 bytes. Filed as an issue with the two-line red/green table. |
| **6. Red/green test or measurable proof** | Both halves were run today, with the exact byte counts above. UNICA's tree is the green end-state: because `test/utils/SettlementTestBase.sol` etches the official PoolManager runtime from hookmate's artifact rather than compiling the source, `forge build --sizes` exits 0. This also corrects an earlier internal phrasing — `--sizes` does **not** fail in UNICA's tree, and reporting it as a current UNICA symptom would mislead a maintainer. |
| **7. Account, key, form, or owner dependency** | GitHub account for the issue. Nothing else. |
| **8. License and upstream contribution path** | Uniswap/v4-core has no root LICENSE; `licenses/` holds BUSL_LICENSE and MIT_LICENSE, and `src/` is headed BUSL-1.1. CONTRIBUTING.md present and explicit: issues via the Bug Report / Feature Improvement templates, "For bug reports, you should be able to reproduce the bug through tests or proof of concept implementations"; PRs against main; "For larger, more substantial changes … it is best to open an issue and start a discussion with the maintainers." No CLA (zero matches, 2026-09-04T22:12:36Z). |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | **No** — the mitigation in `test/utils/SettlementTestBase.sol` (etching hookmate's official PoolManager runtime instead of compiling v4-core's source) is load-bearing and cannot be removed without reintroducing the over-size build failure. Nothing in the hook changes. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 5 — The subgraph's `HookSwap` is a different event from the OpenZeppelin `IHookEvents` `HookSwap`

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, Best Uniswap Stack Contribution, verbatim: "extensions or improvements to official Uniswap repositories." Also The Graph, verbatim from the snapshot: "Make the standards leverage clear: show what became easier because a shared schema was used." |
| **2. Exact user or developer problem** | The official v4-subgraph handles an event named `HookSwap` with signature `HookSwap(indexed bytes32,indexed address,int256,int256,uint24)`. OpenZeppelin's `IHookEvents` — the interface the ecosystem points hooks at to standardize emission — declares `HookSwap(bytes32 indexed poolId, address indexed sender, int128 amount0, int128 amount1, uint128 hookLPfeeAmount0, uint128 hookLPfeeAmount1)`. Five parameters against six, `int256/uint24` against `int128/uint128`, two different topic0 values. Expected, if they were the same event: one topic0, one handler, one schema. Actual: a name collision, so a standards-conformant hook is indexed by nothing, and "the official subgraph already indexes the standard hook event" is a false conclusion a builder can reach in one glance. |
| **3. Official product or repository involved** | github.com/Uniswap/v4-subgraph — `subgraph.yaml` (the `AggregatorHook` data source and its `eventHandlers` entry) and `abis/AggregatorHook.json`. Counterpart: github.com/OpenZeppelin/uniswap-hooks, `src/interfaces/IHookEvents.sol`. |
| **4. Reproduction or primary-source evidence** | `gh api repos/Uniswap/v4-subgraph/contents/subgraph.yaml` decoded → data source `AggregatorHook`, address `0x7169a78a59f136876e724b648fbb339a42f46888`, startBlock 6606180, network `tempo`, `event: HookSwap(indexed bytes32,indexed address,int256,int256,uint24)`, `handler: handleHookSwap` (2026-09-04T22:09:20Z). `abis/AggregatorHook.json` decoded → the five-parameter form (2026-09-04T22:09:46Z). `IHookEvents.sol` decoded at lines 17–25 → the six-parameter `int128/uint128` form, same timestamp. Computed with `cast keccak` at 2026-09-04T22:09:46Z — OpenZeppelin form, topic0 hash `0x365f10e9e7ce45d7acfd986c42e0b666f8af282e440e6dafc78c1f2b2f786760`; AggregatorHook form, topic0 hash `0x6150bb53cd76c5702d6074239fc7b6c2a5495d339eb122fdc06252f3efdbbc1b`. |
| **5. Smallest useful artifact** | An issue on Uniswap/v4-subgraph — three sentences plus both topic0 values — asking whether the intent is to index the OpenZeppelin-standard `HookSwap` as well, and proposing a second `eventHandler` entry for the six-parameter form. Optionally the same note as a comment on OpenZeppelin/uniswap-hooks flagging the collision. |
| **6. Red/green test or measurable proof** | A conformance test UNICA can ship. RED: a Foundry test emitting the OpenZeppelin six-parameter `HookSwap` and asserting its topic0 equals the AggregatorHook value fails. GREEN: the same test asserting the OpenZeppelin topic0 passes, plus a second assertion that the two topics differ. Two assertions beside `test/V4SettlementHook.t.sol`. Nothing like it exists in the tree today. |
| **7. Account, key, form, or owner dependency** | GitHub account for the issue. No key, no form. |
| **8. License and upstream contribution path** | Uniswap/v4-subgraph is GPL-3.0 (`gh api`, 2026-09-04T22:08:47Z) — the copyleft is exactly why the contribution here is an issue and a handler suggestion, never vendored code into MIT-licensed UNICA. No CONTRIBUTING.md at root; issues and PRs; no CLA found. OpenZeppelin/uniswap-hooks is MIT. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes. The conformance test is additive and removable in one commit; it does not change the hook. It does depend on the hook emitting `IHookEvents` — the hook already imports that interface at `src/V4SettlementHook.sol:5`, inherits it at `:35`, and emits `HookFee` at `:250`, so only the `HookSwap` emission would be new, and it too is one commit removable. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 6 — `CurrencySettler.sol`'s native-settle comment contradicts `PoolManager.sol`'s own DoS warning

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, Best Uniswap Stack Contribution, verbatim: "extensions or improvements to official Uniswap repositories"; and the qualification requirement "a FEEDBACK.md file, and a completed submission to the Uniswap Developer Feedback Form … that includes the link to your FEEDBACK.md file." |
| **2. Exact user or developer problem** | Two statements about the same operation that cannot both be acted on. `test/utils/CurrencySettler.sol:20` reads "for native currencies or burns, calling sync is not required". `src/PoolManager.sol:348` reads "if settling native, integrators should still call `sync` first to avoid DoS attack vectors". The test helper is the one integrators copy, so the weaker statement propagates. Two PRs proposing the fix have been open for over three months. Expected: one statement. Actual: two, contradicting, and a reader who trusts either writes the wrong negative test. |
| **3. Official product or repository involved** | github.com/Uniswap/v4-core — `test/utils/CurrencySettler.sol:20` and `src/PoolManager.sol:348` on main; PR #1040 "test: sync(address(0)) before native settle in CurrencySettler" (open, merged=false, updated 2026-05-16T19:42:31Z) and PR #1044 "fix: add sync() for native ETH settlement in CurrencySettler" (open, merged=false, updated 2026-05-19T05:40:41Z). |
| **4. Reproduction or primary-source evidence** | Both file lines and both PR states were fetched at 2026-09-04T21:56:56Z via `gh api` in the first research round and were **not** re-fetched in the verification pass — recorded as such. What was verified first-hand is the downstream consequence in UNICA's own suite: `test/I7NativeSettle.t.sol` carries `test_I7_DefenceOn_Quiet_Settles`, `test_I7_DefenceOff_Quiet_StillSettles`, `test_I7_DefenceOff_ForeignSync_Reverts`, `test_I7_DefenceOn_ForeignSync_Survives`, plus `test_I7_NothingHeldBeforeOrAfter`. |
| **5. Smallest useful artifact** | A comment-only PR to `CurrencySettler.sol` replacing the absolute sentence with the conditional one (native settle succeeds unless an earlier leg of the same unlock left a currency synced; sync first regardless, per `PoolManager.sol:348`), plus a linking comment on #1040 and #1044 attaching the four-row test as independent reproduction. Phrased as evidence for their pending choice, never as a competing fix. |
| **6. Red/green test or measurable proof** | Real and already green. `forge test --match-path test/I7NativeSettle.t.sol` runs the matrix: defence-on/quiet settles; defence-off/quiet **still settles** (the row that falsifies "settlement fails without sync"); defence-off/foreign-sync reverts (the row showing when it genuinely does fail); defence-on/foreign-sync survives (the row showing the defence works). Row 3's RED is the failure the comment should be describing and currently is not. Fuzzing runs at 10,000 per `foundry.toml`. |
| **7. Account, key, form, or owner dependency** | GitHub account for the PR and the two comments. No key, no form. |
| **8. License and upstream contribution path** | Uniswap/v4-core: no root LICENSE; `licenses/` holds BUSL_LICENSE and MIT_LICENSE; `src/` is BUSL-1.1 and `test/` is typically MIT — **which governs `test/utils/CurrencySettler.sol` was not determined** and must be established before a code PR (see unknowns). CONTRIBUTING.md present, issue templates required, PRs against main referencing the issue, no CLA. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — nothing to remove; the tests already exist and the executor's native-settlement defence is unchanged. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 7 — `PoolManager.sol`'s exact `pragma solidity 0.8.26;` splits an unpinned downstream build and breaks explorer verification

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, Best Uniswap Stack Contribution, verbatim: "extensions or improvements to official Uniswap repositories"; and the qualification requirement "a FEEDBACK.md file, and a completed submission to the Uniswap Developer Feedback Form … that includes the link to your FEEDBACK.md file." This is the single strongest available FEEDBACK.md entry and is currently missing from it. |
| **2. Exact user or developer problem** | The singleton every v4 hook test imports pins an exact compiler version rather than a range. A downstream Foundry project with no `solc_version` of its own inherits 0.8.26 in whatever compilation unit reaches `PoolManager`, while units that do not reach it resolve higher. Nothing warns the integrator. Expected: one build, one artifact, one compiler, and `forge verify-contract` matching first time. Actual: two artifacts of the same contract at two compiler versions in one `out/` directory, and a verification failure that gives no hint the cause is a transitive exact pragma in a dependency. |
| **3. Official product or repository involved** | github.com/Uniswap/v4-core, `src/PoolManager.sol` line 2: `pragma solidity 0.8.26;` (line 1 is the BUSL-1.1 SPDX header). Identical at the pinned d153b04. |
| **4. Reproduction or primary-source evidence** | `grep -n 'pragma solidity' lib/uniswap-hooks/lib/v4-core/src/PoolManager.sol` → `2:pragma solidity 0.8.26;` (2026-09-04T22:09Z, local pinned tree). First-hand downstream consequence, dated day 1 and committed at the hour: the hook built at 0.8.26 in the test unit and 0.8.30 in the script unit that actually deployed, and the explorer rejected verification until the matching artifact was located. Recorded in `foundry.toml` (the comment block above `solc_version = "0.8.30"`), in `README.md:166` ("One compiler fact worth knowing"), and in `script/verify.sh`, whose `matching_solc()` helper at line 12 still selects the artifact whose runtime matches the chain rather than assuming one. |
| **5. Smallest useful artifact** | No code patch — an issue asking two questions with the reproduction attached: is the exact pragma intentional for the deployed singleton, and can the test-facing surface carry a caret range so downstream test units are not forced onto 0.8.26. Alternatively a one-paragraph README note telling integrators to pin solc explicitly. The in-tree mitigation (pin 0.8.30, etch the official PoolManager bytecode instead of compiling the source) is offered as evidence, not as a demand. |
| **6. Red/green test or measurable proof** | GREEN is `test/utils/SettlementTestBase.sol`, which deploys the **official** PoolManager runtime from hookmate's artifact (`V4PoolManagerDeployer`) and asserts it is exactly the official runtime byte count, so nothing in the tree needs 0.8.26 and one compiler serves tests, scripts and verification; `forge build --sizes` exits 0 and `test/V4SettlementHook.t.sol`, `test/I7NativeSettle.t.sol` and `test/SettlementExecutor.t.sol` are green. RED is the historical day-1 state, evidenced by the committed comment blocks and by the on-chain artifact — the verified 0.8.30 build at `0x23b46783709E4A94C229612bfA55580a6682c040` (explorer: Exact Match, compiler v0.8.30+commit.73712a01, optimizer off, cancun). **Honest caveat:** the split was not re-created in a fresh minimal project this pass. |
| **7. Account, key, form, or owner dependency** | GitHub account for the issue. No key, no form. One owner action inside UNICA: add this entry to `FEEDBACK.md`, which does not yet carry it. |
| **8. License and upstream contribution path** | As rank 6: no root LICENSE, `licenses/` holds BUSL and MIT, `src/` is BUSL-1.1, CONTRIBUTING.md present with required issue templates, no CLA. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | **No** — the mitigation (the `foundry.toml` pin at `solc_version = "0.8.30"` plus the bytecode-etching `test/utils/SettlementTestBase.sol`) is load-bearing and cannot be removed without reintroducing the two-compiler split. Nothing in the hook changes. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 8 — The `concepts/hooks` page documents one of three permission failure modes and never mentions `CurrencyNotSettled`

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, verbatim: "extensions or improvements to official Uniswap repositories, and tooling or solutions built for the broader ecosystem"; and "Make sure your README clearly points to the relevant contracts and lines of code so we can verify your integration." |
| **2. Exact user or developer problem** | The page states the silent-no-op case ("If the address lacks a flag, the PoolManager never calls that hook function, so the logic silently does nothing") and the deployment-time mismatch, but not the two failures a hook author actually hits: a permission bit set with the callback missing reverts, and a delta returned without the corresponding returns-delta bit produces `CurrencyNotSettled`. The page names the four return-delta permissions and never says what happens when one is absent. The silent case is the one least likely to be tested for, because nothing goes red. |
| **3. Official product or repository involved** | github.com/Uniswap/docs, `content/protocols/v4/concepts/hooks.mdx`. |
| **4. Reproduction or primary-source evidence** | `gh api 'repos/Uniswap/docs/git/trees/main?recursive=1'` filtered for that path → present, fetched 2026-09-04T22:13:04Z. The page's content — the single failure mode stated verbatim, the four permissions named, `CurrencyNotSettled` absent — was verified in the first round by fetching the `llms.mdx` mirror at 2026-09-04T21:58:55Z; the verification pass confirmed the file's existence and path but **did not re-read the rendered page** (see unknowns about the mirror). |
| **5. Smallest useful artifact** | One three-row table added to the page: bit set + callback missing → revert; callback present + bit missing → silent no-op; delta returned + returns-delta bit missing → `CurrencyNotSettled`. Purely additive. Source it from `specs/HOOK-SPEC.md` "§5 — The flag trap", whose mismatch table sits at `specs/HOOK-SPEC.md:181-185` and already carries the three rows with their incident citations. |
| **6. Red/green test or measurable proof** | Real, and the silent case is already guarded. `test/V4SettlementHook.t.sol` carries `test_MinedAddress_MatchesDeclaredPermissions`, `test_NoUndeclaredPermissionsCreepIn`, `test_RevertWhen_AddressBitsSayBeforeSwapOnly`, `test_RevertWhen_AddressBitsSayAfterSwapOnly` — the numeric guard whose whole purpose is that the silent no-op cannot happen unnoticed — plus `test_SwapOnAHooklessPoolIsNotObserved`. These pass today and one was written RED first as the day-2 control. The doc rows are the prose form of tests that already exist and are green. |
| **7. Account, key, form, or owner dependency** | GitHub account and fork. Owner opens the PR. |
| **8. License and upstream contribution path** | Uniswap/docs, MIT, fork + PR against `content/`, CONTRIBUTING.md present, no CLA. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 9 — The v4 troubleshooting page pairs error names with hex selectors and gives no cause or fix

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, verbatim: "extensions or improvements to official Uniswap repositories, and tooling or solutions built for the broader ecosystem"; "Make sure your README clearly points to the relevant contracts and lines of code so we can verify your integration." |
| **2. Exact user or developer problem** | The troubleshooting page is a lookup table of error identifiers and selectors with no prose. `CurrencyNotSettled` appears only as `IPoolManager.CurrencyNotSettled.selector` / `0x5212cba1`, and `HookAddressNotValid` only as `Hooks.HookAddressNotValid.selector` / `0xe65af6a0`. Expected: cause and fix beside each error. Actual: identifier and selector only — a developer arriving with a hex selector can name the error and learns nothing about why it fired. |
| **3. Official product or repository involved** | github.com/Uniswap/docs, `content/protocols/v4/guides/troubleshooting.mdx`. |
| **4. Reproduction or primary-source evidence** | `gh api repos/Uniswap/docs/contents/content/protocols/v4/guides/troubleshooting.mdx` decoded and grepped → exactly two hits, both table rows: line 15 and line 30, as quoted above. Fetched in the verification pass at 2026-09-04T22:13:04Z. No prose column exists on either row. |
| **5. Smallest useful artifact** | Additive rows for the hook-relevant errors, starting with the two UNICA has hit and reasoned through: `HookAddressNotValid` (mined low bits do not match declared permissions, most often because the deployer address changed after mining) and `CurrencyNotSettled` (a native path settled without sync while another currency was synced in the same unlock, per `PoolManager.sol:348`). The existing selector table is untouched. |
| **6. Red/green test or measurable proof** | Real for both proposed rows. `HookAddressNotValid`: `test/V4SettlementHook.t.sol` has `test_RevertWhen_AddressBitsSayBeforeSwapOnly` and `test_RevertWhen_AddressBitsSayAfterSwapOnly`, which are exactly the mined-bits-versus-declared-flags revert. `CurrencyNotSettled` / `NonzeroNativeValue`: `test/I7NativeSettle.t.sol` `test_I7_DefenceOff_ForeignSync_Reverts` is the failing case and `test_I7_DefenceOn_ForeignSync_Survives` is the fix. Every prose row proposed is backed by a public test a maintainer can run. |
| **7. Account, key, form, or owner dependency** | GitHub account and fork. |
| **8. License and upstream contribution path** | Uniswap/docs, MIT, fork + PR against `content/`, CONTRIBUTING.md present, no CLA. Its stated preference is favourable here: "a PR with a source for the correct information (block explorer link, protocol repository, API response) is the fastest path to a merge" — all three exist. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 10 — The v4 template's only CI workflow has its `push` and `pull_request` triggers commented out

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, verbatim: "extensions or improvements to official Uniswap repositories." |
| **2. Exact user or developer problem** | The recommended v4 starting point ships one workflow file whose automatic triggers are commented out, leaving only `workflow_dispatch`. A fork looks like it has CI, shows a workflows tab, and never runs a test on a push or a pull request. Expected: CI runs on push and PR, as `name: Test Suite` and `FOUNDRY_PROFILE: ci` imply. Actual: it runs only on manual dispatch, which nobody does — and a file that reads as coverage while providing none is worse than no file, because it stops the fork's author adding one. |
| **3. Official product or repository involved** | github.com/Uniswap/v4-template, `.github/workflows/test.yml` — the repository's only workflow. |
| **4. Reproduction or primary-source evidence** | `gh api repos/Uniswap/v4-template/contents/.github/workflows/test.yml` decoded, first 14 lines, fetched in the verification pass at 2026-09-04T22:13:04Z, returns verbatim: `name: Test Suite` / `on:` / `  workflow_dispatch:` / `  # push:` / `  # pull_request:` / `env:` / `  FOUNDRY_PROFILE: ci` / `jobs:` / `  test:` / `    name: Foundry Project` / `    runs-on: ubuntu-latest`. |
| **5. Smallest useful artifact** | Uncomment the two trigger lines — or, if the disabling is deliberate to save Actions minutes across many forks, add a one-line comment saying so. The PR must be phrased as a question, since no linked issue or commit message explaining the state was fetched. |
| **6. Red/green test or measurable proof** | Real, as a comparison rather than a unit test. `.github/workflows/ci.yml` is the green counter-example: `on: push` and `on: pull_request` both enabled (confirmed in the tree), green on the remote across lanes including a fresh-clone lane that builds from a stranger's checkout, with EIP-170 size checks and a secrets check. The RED is the template's own repository: no automatic workflow run exists on any recent push. The PR should cite the enabled configuration as a working shape, never assert a preference. |
| **7. Account, key, form, or owner dependency** | GitHub account and fork. Owner opens the PR. |
| **8. License and upstream contribution path** | Uniswap/v4-template is MIT (`gh api`, 2026-09-04T22:08:47Z). No CONTRIBUTING.md at root (HTTP 404); contributions by PR or issue; no CLA found. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 11 — `HookMiner`'s only home is `test/shared/`, so "use HookMiner from v4-periphery" has no correct form today

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation, Best Uniswap Stack Contribution, verbatim: "extensions or improvements to official Uniswap repositories." |
| **2. Exact user or developer problem** | `HookMiner` has moved twice (`src/base/hooks` → `src/utils` → `test/shared`) and now lives only under `test/`, which is not conventionally a package's importable public surface. Every doc, template and skill saying "use HookMiner from v4-periphery" is therefore unfixable by a path correction alone: there is no stable public path to point at. The repository also publishes zero tags and zero releases, so downstream guidance cannot pin a version — only a commit SHA. |
| **3. Official product or repository involved** | github.com/Uniswap/v4-periphery — `src/utils/` absent; `test/shared/HookMiner.sol` and `test/shared/HookMinerCreate3.sol` present. |
| **4. Reproduction or primary-source evidence** | `gh api repos/Uniswap/v4-periphery/contents/src/utils` → HTTP 404. The recursive tree filtered for `hookminer` → exactly two paths, both under `test/shared/`. Both 2026-09-04T22:12:49Z. Downstream consequence in-tree: `script/LiveFire.s.sol:19` still resolves the old `src/utils` path only because the pin is 7ebd04b. |
| **5. Smallest useful artifact** | No code patch — an issue asking for a decision: promote `HookMiner` back to a public path, or state in the README that consumers should vendor it or use hookmate. One paragraph citing the two relocations and the zero-tags fact. Fold the same paragraph into the rank-2 PR so the doc fix and the upstream question travel together. |
| **6. Red/green test or measurable proof** | None possible — this is a packaging and placement question, not a behaviour defect. The nearest evidence is the rank-2 pin-boundary reproduction: the same import resolves at 7ebd04b and fails on main. Stated as a negative rather than dressed as a test. |
| **7. Account, key, form, or owner dependency** | GitHub account. Owner opens the issue. |
| **8. License and upstream contribution path** | Uniswap/v4-periphery is MIT (`gh api`, 2026-09-04T22:08:47Z), CONTRIBUTING.md present, issues and PRs against main, no CLA (zero matches for "contributor license agreement"/CLA, checked 2026-09-04T22:12:36Z). |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 12 — The subgraph's only hook-event data source is pinned to one hook on one network, and the generator that could template it does not

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation: "extensions or improvements to official Uniswap repositories." The Graph, Best Use of Composable or Standardized Graph Products, verbatim: "Authoring or extending a Standardized Subgraph, or contributing a reusable composable Substreams module, is in scope." |
| **2. Exact user or developer problem** | Hook-event indexing exists for exactly one hook, at one hardcoded address, on one network. `scripts/generate-subgraph.ts` already carries the `AggregatorHook` data source as a templated block keyed off `networks.json`, but `networks.json` declares an `AggregatorHook` entry only under `tempo`; the twenty-plus other networks, sepolia included, get `PoolManager` and `PositionManager` only. Expected, given the generator: adding a hook to `networks.json` for any network produces a data source for it. Actual: no path by which a new hook on a supported network becomes indexed, and no `HookFee`, `HookModifyLiquidity` or `HookBonus` handler anywhere in the repository. |
| **3. Official product or repository involved** | github.com/Uniswap/v4-subgraph — `subgraph.yaml` (the `AggregatorHook` data source, address `0x7169a78a59f136876e724b648fbb339a42f46888`, startBlock 6606180, network `tempo`), `networks.json`, `scripts/generate-subgraph.ts`. |
| **4. Reproduction or primary-source evidence** | `gh api repos/Uniswap/v4-subgraph/contents/networks.json` decoded and grepped for `aggregator|tempo` → `244: "tempo": {` and `253: "AggregatorHook": {`, and nothing else (2026-09-04T22:10:11Z). `subgraph.yaml` decoded → three data sources, all `network: tempo` (2026-09-04T22:09:20Z). `scripts/generate-subgraph.ts` decoded, lines 95–135 → the `AggregatorHook` block with its single `HookSwap` handler (2026-09-04T22:10:11Z). The sepolia block of `networks.json` carries PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` (startBlock 7258946) and PositionManager `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` (startBlock 7259148), and no hook of any kind. |
| **5. Smallest useful artifact** | An issue — and, if welcomed, a PR — proposing that the `AggregatorHook` block be generalised to an array of hook entries per network in `networks.json`, so any address is one config line, and that handlers be added for the remaining three standard events. Small, additive, and it does not change existing behaviour for `tempo`. |
| **6. Red/green test or measurable proof** | None possible in UNICA's Solidity suite: this is a subgraph manifest change whose test bench is that repository's own `tests/` directory, which UNICA does not run. Stated as a negative rather than implied. The nearest artifact is the standalone schema at rank 13, whose deploy against a Studio endpoint would be the live demonstration. |
| **7. Account, key, form, or owner dependency** | GitHub account for the issue. Deploying the companion subgraph (rank 13) additionally needs a Subgraph Studio account and `graph auth` — owner-only. |
| **8. License and upstream contribution path** | Uniswap/v4-subgraph, GPL-3.0, no CONTRIBUTING.md, issues and PRs, no CLA found. Because UNICA is MIT and this repository is GPL-3.0, code flows outward only: nothing from it may be copied in. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to the hook. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 13 — This pass found no reusable, hook-address-agnostic subgraph schema over `IHookEvents`

| Field | |
|---|---|
| **1. Published prize requirement** | The Graph, Best Use of Composable or Standardized Graph Products, verbatim from the snapshot: "Authoring or extending a Standardized Subgraph, or contributing a reusable composable Substreams module, is in scope." And the bars it must clear, verbatim: "Consume live data from a Graph provider, for example Subgraph Studio for Subgraphs or The Graph Market for Substreams. Mocked, local-only, or static datasets do not qualify"; "Simply querying one Subgraph with no composition or standardization does not qualify"; "Make the standards leverage clear: show what became easier because a shared schema was used." |
| **2. Exact user or developer problem** | `IHookEvents` defines four events a v4 hook "should inherit from… to standardize event emission", yet no published subgraph schema treats them as a standard. The only mapping in the official repository is address-pinned to one hook and handles a differently-typed event of the same name (rank 5); the one community schema found is likewise project-specific; and messari/subgraphs, the standardized-schema reference the track names, has no hook coverage (pushed_at 2025-03-25T19:24:27Z). Expected: an interface described as standardizing emission has at least one schema that consumes it generically. Actual: zero — so a hook author who does the standards-conformant thing gains nothing from having done it. |
| **3. Official product or repository involved** | github.com/OpenZeppelin/uniswap-hooks, `src/interfaces/IHookEvents.sol` (`HookSwap`, `HookFee`, `HookModifyLiquidity`, `HookBonus`) — the interface with no consumer schema. The Graph's own standardized-subgraph surface is the second affected artifact, by absence. |
| **4. Reproduction or primary-source evidence** | `gh api repos/OpenZeppelin/uniswap-hooks/contents/src/interfaces/IHookEvents.sol` → four events, verified verbatim 2026-09-04T22:09:46Z; identical at the pin, `lib/uniswap-hooks/src/interfaces/IHookEvents.sol`, four events at lines 17, 30, 36, 42. Search evidence carried from the first round and **not** re-run: `gh search/code q='HookSwap extension:graphql'` → 1 result; `q='HookSwap filename:subgraph.yaml'` → 2, including the official subgraph itself. The negative — that none is hook-address-agnostic — rests on reading the two manifests, not on the counts. |
| **5. Smallest useful artifact** | A standalone MIT subgraph under `subgraph/`: `schema.graphql` with entities keyed by (hook, poolId) rather than by a hook name, plus mappings over all four `IHookEvents` events, parameterised by hook address and startBlock in a config file so a second hook is one config line. UNICA's settlement receipt composes on top as a derived entity. Written from the interface declaration, never copied from any existing manifest — required by this repository's "Never copy" rule and doubly required because the official subgraph is GPL-3.0. |
| **6. Red/green test or measurable proof** | Both halves runnable: `graph test` (matchstick) unit tests over the mapping handlers — RED before the handler exists (no entity produced from a synthesised `HookSwap` log), GREEN after. On top of that the live bar: the deployed subgraph must return the Sepolia settlement swap (tx hash `0x6d580aef…06bf`) from a Studio endpoint, which cannot be faked with a fixture. Nothing exists in the tree yet — `subgraph/` does not exist as of 2026-09-04T22:00Z. |
| **7. Account, key, form, or owner dependency** | Yes, and blocking: a Subgraph Studio account, a created subgraph, and `graph auth` with a deploy key. No anonymous path exists, and the deploy key must stay out of the repository. |
| **8. License and upstream contribution path** | The artifact is UNICA's own, MIT, in UNICA's public repository — no upstream contribution path is required. If any part is offered upstream, OpenZeppelin/uniswap-hooks is MIT (PR/issue, no CLA found) and graphprotocol/docs is Apache-2.0 with CONTRIBUTING.md (fork + PR, no CLA). |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes. The subgraph lives entirely under `subgraph/` and is removable in one commit; the hook never imports The Graph. It depends on the hook emitting `IHookEvents`, which the hook already imports at `src/V4SettlementHook.sol:5`, inherits at `:35`, and emits `HookFee` from at `:250`. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified as a gap. **Scope caution carried forward:** the leverage demonstration is weaker than first concluded, because the AggregatorHook does not emit the OpenZeppelin event (rank 5), and whether *any* deployed hook emits these events is the most load-bearing open unknown on this plan. |

---


**Status, 2026-09-05.** Implemented at the rung below the published bar, and said so:
`integrations/graph/` carries the manifest (hook address per network, never hard-coded), the ABI
generated from the compiled hook, the schema with one immutable `Settlement` entity, the handler
keyed on schema version one, three matchstick tests around a real local receipt, and
`local-e2e.sh`, which reconstructs one settlement from its log in a local graph-node and shows a
refused payment yields no entity (measured: one entity, `amountOut` 2003660 in real USDC on a
Sepolia fork). The requirement quoted in field 1 says "Mocked, local-only, or static datasets do
not qualify" and asks for live data from a Graph provider: that is a Subgraph Studio deployment
of this subgraph against the day-4 hook address, an owner action with an account, listed in the
owner queue and not taken. **Qualification: pending** until it is, and until "what became easier
because a shared schema was used" is shown with a second hook's receipts answering the same
query. Nothing here claims priority over other schemas (see the title of this item).

## 14 — A hook-generator skill instructs the model to call an MCP tool the plugin neither ships nor names

| Field | |
|---|---|
| **1. Published prize requirement** | Uniswap Foundation: "extensions or improvements to official Uniswap repositories, and tooling or solutions built for the broader ecosystem"; and directly, the qualification requirement "a FEEDBACK.md file, and a completed submission to the Uniswap Developer Feedback Form … that includes the link to your FEEDBACK.md file" — the entry is already written and dated. |
| **2. Exact user or developer problem** | The `uniswap-hooks` plugin's `v4-hook-generator` skill instructs the reader to call an OpenZeppelin Contracts Wizard MCP tool named `generate_hook`, but the plugin's manifest declares no MCP server, its `SKILL.md` frontmatter lists no MCP tool among its allowed tools, and its README Requirements section names only a plugin-capable agent host and familiarity with v4 hooks architecture. Expected: a skill that names its dependency, or degrades to a working template when the dependency is absent. Actual: the reader reaches step 4, finds no such tool, and has no stated fallback. The evidence that this is an oversight rather than house style is inside the same monorepo: the sibling `uniswap-cca` plugin ships a `.mcp.json` and a full `mcp-server/` directory. |
| **3. Official product or repository involved** | github.com/Uniswap/uniswap-ai — `packages/plugins/uniswap-hooks` (`SKILL.md` for `v4-hook-generator`, `plugin.json` v1.6.0, README Requirements), contrasted with `packages/plugins/uniswap-cca/.mcp.json` and its `mcp-server/` directory. |
| **4. Reproduction or primary-source evidence** | First-round evidence fetched 2026-09-04T21:57:02Z and 21:58:10Z: `SKILL.md` frontmatter `allowed-tools: Read, Glob, Grep, WebFetch, Bash`; body line 190 "The OpenZeppelin Contracts Wizard exposes a `generate_hook` MCP tool"; line 271 "call the OpenZeppelin Contracts Wizard MCP tool"; `plugin.json` has a `skills` array and no `mcpServers` key. First-hand, dated corroboration in-tree: the `FEEDBACK.md` entry of 2026-09-04, "the `v4-hook-generator` skill in `uniswap-ai` calls an MCP tool the plugin does not ship" — a search of every tool available in that session for `generate_hook` / wizard returned nothing at 20:03 UTC, with the cost recorded as 4 minutes. |
| **5. Smallest useful artifact** | Two additions, no code: an "MCP Server Setup" subsection in the `uniswap-hooks` plugin README modelled on the sibling plugin's own `.mcp.json`, and a prerequisite note at the top of `SKILL.md` naming the server plus a stated fallback ("if the tool is absent, start from this template"). |
| **6. Red/green test or measurable proof** | None possible: documentation only. Stated as a negative. The nearest evidence is the timed `FEEDBACK.md` entry, which records the exact session, the exact search and the exact time cost, and which a maintainer can act on without a follow-up question. |
| **7. Account, key, form, or owner dependency** | GitHub account and fork; an issue with the same reproduction if an outside PR is not accepted. |
| **8. License and upstream contribution path** | Uniswap/uniswap-ai, MIT, no CONTRIBUTING.md at root, PR or issue, no CLA found. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 15 — The Subgraph MCP introduction page names no endpoint and states no auth requirement

| Field | |
|---|---|
| **1. Published prize requirement** | The Graph, Best AI Tooling or AI Use Case with The Graph (From Scratch), verbatim: "Use The Graph as a load-bearing part of the project: either the AI tooling targets The Graph's products or AI Suite, or the agent/app uses The Graph (Subgraphs, the Subgraph MCP, or Substreams) as its source of blockchain data"; and "Must consume live data via API keys or Graph Market streaming." The sibling Continuity prize is closed to a from-scratch entry. |
| **2. Exact user or developer problem** | The introduction page for the Subgraph MCP server — the page the hackathon track links as its resource — describes what the server does and names several client applications, then gives no endpoint URL and makes no statement about whether an API key or any authentication is required. Expected: an introduction page for a connectable server states the connection string and whether a key is needed. Actual: the reader must guess or leave for a client-specific guide, and cannot tell from the page whether authentication is even required. |
| **3. Official product or repository involved** | thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/, source in github.com/graphprotocol/docs. |
| **4. Reproduction or primary-source evidence** | Web fetch of that URL in the verification pass at 2026-09-04T22:13Z, asking specifically for an endpoint URL and an auth statement: neither is present. The page describes the server as an open-source implementation of the Model Context Protocol, lists capabilities (GraphQL schemas, running queries, discovering subgraphs), links to separate per-client integration guides, and carries a GitHub edit link. Independently corroborated by the first-round fetch at 2026-09-04T22:00:40Z. |
| **5. Smallest useful artifact** | One code block on the introduction page: the MCP client config with the endpoint and any required header, plus one sentence on the auth requirement — sourced from the MCP server implementation's own README, never invented. If the information genuinely lives only on the per-client pages, one line saying so with a link is enough. |
| **6. Red/green test or measurable proof** | None possible: documentation only. Stated as a negative. The honest verification is the fetch above — the absence is the finding, and it is reproducible by anyone loading the URL. |
| **7. Account, key, form, or owner dependency** | GitHub account and fork for the docs PR. Confirming the endpoint and auth values may require a Graph account. |
| **8. License and upstream contribution path** | graphprotocol/docs is Apache-2.0 (`gh api`, 2026-09-04T22:08:47Z) with CONTRIBUTING.md present (confirmed 2026-09-04T22:16:09Z); fork + PR; no CLA found. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 16 — Selfie Check's documentation names no verification endpoint and never defines replay semantics

| Field | |
|---|---|
| **1. Published prize requirement** | World, Selfie Check track: the credential must serve as "a risk, eligibility, fairness, continuity, or abuse-prevention signal" that changes one real product behavior — a badge that changes nothing does not qualify; and "Submission must include a developer AND user feedback document." (Snapshot rows carried from the partner knowledge file; the underlying prize page was **not** re-fetched in the verification pass — see unknowns.) The documentation-gap report *is* the developer half of that required document. |
| **2. Exact user or developer problem** | Developer-side and user-side both. The credentials page documents the client half of Selfie Check (the `selfieCheckLegacy()` preset and its `app_id` / `action` / `rp_context` parameters), then instructs the developer to forward the complete result to a verification endpoint — without naming that endpoint's URL, its request body, or its response fields. The word "nullifier" does not appear on the page at all, so the one property a "one human, one benefit" product depends on — whether a per-action replay identifier exists and what it is scoped to — is undocumented; that is a user-facing gap as much as a developer one, because the users of any product built on it cannot be told what uniqueness guarantee they are getting. The feature is additionally gated behind an email request, so a developer cannot resolve the gap by experiment either. |
| **3. Official product or repository involved** | docs.world.org/world-id/idkit/credentials (the Selfie Check developer page). The related page docs.world.org/world-id/credentials/11 discusses a 90-day re-enrollment window without connecting it to per-action replay. |
| **4. Reproduction or primary-source evidence** | Web fetch of https://docs.world.org/world-id/idkit/credentials in the verification pass at 2026-09-04T22:13Z, asking four specific questions. Present verbatim: "Request access (mailto:developers@toolsforhumanity.com) to enable Selfie Check (Beta) for your app." Present: the `selfieCheckLegacy()` preset. **Absent:** any verification endpoint URL or request/response specification — the page says only to forward "the complete IDKit result to the verification endpoint". **Absent:** the word "nullifier", anywhere on the page. A guessed URL returned 404, which is evidence of nothing except that guessing does not work. |
| **5. Smallest useful artifact** | Two additions to that one page: the verification endpoint URL with a request/response example (the same shape the classic verify flow documents), and one paragraph stating whether Selfie Check returns a per-action nullifier, what it is scoped to (`app_id`? `action`? `rp_context`?), and what the 90-day window means for it. Filed as the developer feedback the track already requires, not as a demand. |
| **6. Red/green test or measurable proof** | None possible: documentation only, and the feature is behind a beta gate this pass could not cross. Stated as a negative. What UNICA can produce once access is granted is a red/green pair on its own side — a benefit-ledger test asserting that a second settlement under the same nullifier is rejected — and that test cannot be written honestly until the nullifier's scope is documented, which is exactly the point of the feedback. |
| **7. Account, key, form, or owner dependency** | Yes, and blocking for anything beyond the feedback document: Selfie Check (Beta) must be enabled per-app by emailing developers@toolsforhumanity.com; a Developer Portal registration is needed for `app_id` / `rp_id` / signing key; sandbox testing requires a private TestFlight or Play build issued by World. None of it is self-serve, and only the owner may request it. |
| **8. License and upstream contribution path** | No public World documentation repository was identified (`gh api repos/worldcoin/world-documentation` → HTTP 404, 2026-09-04T22:16:09Z), so there is no PR path. The contribution path is the feedback document plus direct correspondence to developers@toolsforhumanity.com. Licence of the docs site: not determined. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes, and nothing enters the hook. The benefit flag is app-side and, if ever persisted on-chain, lives in a separate ledger contract that `src/SettlementExecutor.sol` consults — the component the specification calls the router, per the note on names above, and not Uniswap's Universal Router. Proofs, biometric material and nullifiers never cross into hook or PoolManager state. Removable in one commit. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified (the documentation gap itself; the seam it would enable is separately demoted below). |

---

## 17 — Arc's contract-addresses page lists no AMM while App Kit advertises a Swap capability

| Field | |
|---|---|
| **1. Published prize requirement** | Arc/Circle, Launch on Arc Testnet & Push to Mainnet (Start Fresh): "Functional MVP and diagram: Projects must demonstrate a working frontend and backend plus an architecture diagram", video demo, GitHub link, and deployment or deployment-readiness on Arc mainnet by September 30. Recorded with two cautions: Arc's "Best DeFi or Agentic Application" is marked "This prize is only available to Continuity Track participants" and is closed to UNICA, and Arc mainnet is not live (Private and Public Mainnet listed as Upcoming; Public Testnet, chain id 5042002, Live). |
| **2. Exact user or developer problem** | The complete contract list Arc publishes contains stablecoins, CCTP crosschain contracts, FxEscrow, transaction extensions and common Ethereum contracts — and no AMM, no Uniswap contract of any version. Meanwhile App Kit advertises a Swap capability without naming what it routes through. Expected: either an AMM address, or a statement that no AMM is deployed. Actual: silence, beside a product surface advertising Swap — so a builder reasonably infers a v4 PoolManager exists on Arc, and none is listed. |
| **3. Official product or repository involved** | docs.arc.io/arc/references/contract-addresses (docs.arc.network 301-redirects to it; only docs.arc.io resolves). |
| **4. Reproduction or primary-source evidence** | First-round fetch of that page at 2026-09-04T21:59:20Z returned the complete category list: Stablecoins (USDC, EURC, USYC); Crosschain (TokenMessengerV2, MessageTransmitterV2, TokenMinterV2, MessageV2, GatewayWallet, GatewayMinter); Payments and Settlement (FxEscrow); Transaction Extensions (Memo, Multicall3From); Common Ethereum Contracts (CREATE2 Factory, Multicall3, Permit2); Test Addresses. No Uniswap contract at any version. **Not re-fetched** in the verification pass. |
| **5. Smallest useful artifact** | One sentence on the App Kit Swap section naming the venue it routes through on Arc, or stating plainly that no AMM is deployed there yet. |
| **6. Red/green test or measurable proof** | None possible: documentation only. Stated as a negative. The one first-hand check worth adding before filing is `cast code` against a candidate PoolManager address on Arc testnet (chain id 5042002) returning `0x` — a stated negative rather than an absence. |
| **7. Account, key, form, or owner dependency** | A docs feedback or issue submission; no public repository for Arc docs was identified, so the path may be a form. |
| **8. License and upstream contribution path** | No public documentation repository identified for docs.arc.io; contribution path is a docs issue or feedback form, unverified. Licence not determined. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified (page content as fetched in the first round; the re-verification caveat above applies). |

---

## 18 — The official swap-vm-template's only testnet path redeploys the protocol from scratch, which the track's own rule does not obviously permit

| Field | |
|---|---|
| **1. Published prize requirement** | 1inch, Build an Aqua App, verbatim: "Official Aqua/SwapVM contracts must be used (redeployments of a modified SwapVM contract is allowed)"; also "Onchain execution of token transfers should be presented during the final demo (local forks are ok)" and "Proper Git commit history (no single-commit entries on the final day)". The Continuity variant is closed to UNICA. |
| **2. Exact user or developer problem** | The template documents `yarn deploy sepolia` as its Testnet Deployment path and states the script will deploy Aqua protocol, deploy the AquaAMM strategy, resolve WETH and deploy the router. The published requirement's parenthetical covers a *modified SwapVM*, not a from-scratch Aqua. Expected: the sponsor's own template and the sponsor's own qualification rule agree on what a valid testnet demo looks like. Actual: they may not, and a builder cannot tell which reading is intended. |
| **3. Official product or repository involved** | github.com/1inch/swap-vm-template, `README.md`, the "Testnet Deployment" section. |
| **4. Reproduction or primary-source evidence** | First-round `gh api` fetch of the README at 2026-09-04T21:57:18Z, and the verbatim track line from the prize-page snapshot dated 2026-09-04T19:49Z. **Not re-fetched** in the verification pass; the verification pass confirmed only that the repository exists and carries LICENSE, LICENSES and THIRD_PARTY_NOTICES at root (2026-09-04T22:16:09Z). |
| **5. Smallest useful artifact** | An issue on the template asking for one clarifying sentence: either that a self-deployed Sepolia Aqua+SwapVM via the official template satisfies the requirement, or a canonical testnet deployment so builders need not redeploy the protocol to demo on-chain. |
| **6. Red/green test or measurable proof** | None possible: this is a requirements-versus-template ambiguity, not a code defect. It resolves by an answer, not by a test. Stated as a negative. |
| **7. Account, key, form, or owner dependency** | GitHub account for the issue. |
| **8. License and upstream contribution path** | The repository reports `license=NOASSERTION` (`gh api`, 2026-09-04T22:16:09Z) with LICENSE, LICENSES and THIRD_PARTY_NOTICES at root; a copyleft was recorded on the Aqua side. Because the licence is not a standard SPDX identifier, **nothing from this repository may be copied into MIT-licensed UNICA** — the contribution is an issue only. No CONTRIBUTING.md at root; no CLA determined. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA; this is a question filed upstream, not an integration. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified (as an ambiguity; see the re-verification caveat above). |

---

## 19 — Arc's 6-versus-18 decimal USDC warning has no accompanying conversion example

| Field | |
|---|---|
| **1. Published prize requirement** | Arc/Circle, Launch on Arc Testnet & Push to Mainnet (Start Fresh): "Functional MVP and diagram … working frontend and backend plus an architecture diagram", video demo, GitHub link. Low priority — take it only if an Arc contribution is wanted at all. |
| **2. Exact user or developer problem** | The contract-addresses page carries an Info callout stating that the native USDC gas token uses 18 decimals while the USDC ERC-20 interface uses 6, and offers no code showing how to convert safely between them; the page's only code block is a `cast` command for deriving a test private key. Expected: a warning about a decimals mismatch is paired with the safe conversion. Actual: warning only. This is a missing example, not a wrong statement, and it is the weakest confirmed item in this file. |
| **3. Official product or repository involved** | docs.arc.io/arc/references/contract-addresses — the decimals Info callout. |
| **4. Reproduction or primary-source evidence** | First-round fetch at 2026-09-04T21:59:20Z; the callout is present verbatim ("the native USDC gas token uses 18 decimals of precision, while the USDC ERC-20 interface uses 6 decimals") and the only code block on the page is the key-derivation command. **Not re-fetched** in the verification pass. |
| **5. Smallest useful artifact** | One worked conversion helper that reads `decimals()` rather than hardcoding either constant, offered as a doc PR. |
| **6. Red/green test or measurable proof** | None possible today: documentation only, and UNICA has no Arc code. Stated as a negative. If the helper is written, a two-case unit test (6→18 and 18→6, with a round-trip assertion) would be the pair; it does not exist. |
| **7. Account, key, form, or owner dependency** | Docs feedback or issue submission; no public repository identified. |
| **8. License and upstream contribution path** | No public documentation repository identified for docs.arc.io; path is a docs issue or feedback form, unverified. Licence not determined. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to UNICA. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

> **The three items below have no published requirement they satisfy.** Each is stronger evidence than several items above it, and each is ranked here anyway, because the rule is that an item without a published requirement cannot rank above one with it. Their engineering value is the reason to do them; sponsor credit is not.

## 20 — The broadcast record pairs each transaction body with the wrong transaction hash

| Field | |
|---|---|
| **1. Published prize requirement** | None directly — Foundry publishes no ETHOnline track. It serves the Uniswap Foundation requirement only indirectly, as "tooling or solutions built for the broader ecosystem" and as material for the required `FEEDBACK.md`. Stated plainly so it is not counted as sponsor credit. |
| **2. Exact user or developer problem** | In the broadcast artifact, `transactions[i].function` and `transactions[i].transaction` (to, nonce, value) are internally consistent and in script order, but `transactions[i].hash` is rotated by two positions relative to them. The `receipts` array in the same file is correct and self-consistent, so the file contradicts itself. Expected: `transactions[i].hash` is the hash of `transactions[i].transaction`. Actual: it is drawn from a different position — so any downstream reader that trusts it (a verification script, a receipt table, an explorer link in a README) attributes each call to the wrong on-chain transaction. |
| **3. Official product or repository involved** | github.com/foundry-rs/foundry — `forge script`'s broadcast writer. Concrete instance committed in this repository: `broadcast/LiveFire.s.sol/11155111/run-latest.json` (chain 11155111, commit 1b2f592, 5 transactions, 5 receipts, all status 0x1). |
| **4. Reproduction or primary-source evidence** | The one-liner below, run at 2026-09-04T22:11Z, prints: `initialize(...)` → tx hash `0xb535627674e5…baae`, nonce 0x1be, to `0xe03a1074…3543` (PoolManager); `approve(address,uint256)` → tx hash `0x6d580aef…06bf`, nonce 0x1bf, to `0x1c7d4b19…7238` (USDC); `modifyLiquidity(...)` → tx hash `0xe7cc4bbc…f08b`, nonce 0x1c0, to `0x0c478023…1b0a`; `swap(...)` → tx hash `0x7e56b7ca…3213`, nonce 0x1c1, to `0x9b6b46e2…6eee`. The receipts in the same file give the true pairing: tx `0xe7cc4bbc` → to PoolManager, gasUsed 0xcb0e (51,982); tx `0x7e56b7ca` → to USDC; tx `0xb5356276` → to `0x0c47…1b0a`, gasUsed 0x3eef6 (257,782); tx `0x6d580aef` → to `0x9b6b…6eee`, gasUsed 0x28a74 (166,516). So `initialize`'s hash should be `0xe7cc4bbc` and the file says `0xb5356276`. Independently confirmable on-chain with `cast receipt` on the `0xe7cc4bbc…f08b` tx hash, whose `to` is the PoolManager. |
| **5. Smallest useful artifact** | A bug-form issue attaching the committed `run-latest.json` with the four mismatched pairs tabulated against the receipts, the exact forge version, and the ask: emit `hash` from the same record as the body, or drop the field and let readers join through `receipts` by nonce. |
| **6. Red/green test or measurable proof** | Real, as a data assertion rather than a Solidity test. RED (2026-09-04T22:11Z): for every i in 1..4, the receipt whose `transactionHash` equals `transactions[i].hash` has a `to` different from `transactions[i].transaction.to`. GREEN: joining transactions to receipts by ascending nonce against ascending `transactionIndex` produces a pairing in which every `to` matches — and that is the pairing already published in the README proof table, which records the human-visible half ("the mapping above is from the receipts … which is the only mapping that counts"). `docs/proof/verify-day1.sh` already asserts the receipts half and prints its own stated negative — `checks run: 14, passed: 14, failed: 0` — and a two-line addition asserting the transactions↔receipts `to` join would make this a standing regression check. |
| **7. Account, key, form, or owner dependency** | GitHub account to file. Before filing, confirm the behaviour on upstream forge v1.5.1 (this repository's CI pin) — the committed artifact was produced by 1.3.5-foundry-zksync-v0.1.9, and a fork-only bug belongs at the fork. |
| **8. License and upstream contribution path** | foundry-rs/foundry is dual-licensed (LICENSE-APACHE and LICENSE-MIT at root; GitHub reports Apache-2.0). CONTRIBUTING.md present; issues via the bug form; no CLA (zero matches, 2026-09-04T22:12:36Z). Fetched 2026-09-04T22:13:57Z. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to the hook. The optional `verify-day1.sh` assertion is two lines in a proof script, removable in one commit. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

The reproduction command for field 4, run from the repository root:

```sh
python3 -c "import json; r=json.load(open('broadcast/LiveFire.s.sol/11155111/run-latest.json')); [print(i, t['function'], t['hash'], t['transaction']['nonce'], t['transaction']['to']) for i,t in enumerate(r['transactions'])]"
```

---

## 21 — The clear-signing registry has no descriptor for any Uniswap v4 contract

| Field | |
|---|---|
| **1. Published prize requirement** | Ledger's published track requirement does **not** cover this: "Both must be built on the Ledger Agent Stack, and in particular on the Ledger Key Ring CLI (wallet-cli ring)." A registry descriptor is not built on the Key Ring CLI, so this does not satisfy the AI Agents track, and the Continuity Track is closed to a from-scratch entry. Stated plainly: a genuine ecosystem fix with no track it qualifies for. Take it for its engineering value, not for sponsor credit. |
| **2. Exact user or developer problem** | The registry's `uniswap` directory covers V3 Router02, Permit2 and UniswapX EIP-712 payloads and nothing for v4: no PoolManager, no UniversalRouter v4 path, no hook. Expected: the clear-signing registry covers the current AMM. Actual: it stops at v3 and UniswapX, so a user signing a v4 swap or a hook call on a hardware wallet sees raw calldata. |
| **3. Official product or repository involved** | github.com/ethereum/clear-signing-erc7730-registry, `registry/uniswap/` (`calldata-UniswapV3Router02.json`, `common-eip712-uniswap.json`, five UniswapX/permit2 EIP-712 files, `tests/` and `testsv2/`). |
| **4. Reproduction or primary-source evidence** | First-round fetch at 2026-09-04T21:57:18Z: `gh api repos/ethereum/clear-signing-erc7730-registry/contents/registry/uniswap` listed exactly those files; scoped code searches for `PoolManager` and for `UniversalRouter` in that repository returned 0 results each. **Not re-fetched** in the verification pass. |
| **5. Smallest useful artifact** | A registry PR adding a calldata descriptor for the verified Sepolia hook at `0x23b46783709E4A94C229612bfA55580a6682c040`, generated with `erc7730 generate`, linted, with the `testsv2/` file the repository's PR rules require. Carry the unresolved caution explicitly: v4's generic `unlock(bytes)` plus callback shape may not map onto ERC-7730's per-function field model, so a general PoolManager descriptor must not be promised until that is settled. |
| **6. Red/green test or measurable proof** | Real on the registry's own terms: a descriptor without its `testsv2/` file fails lint/CI (RED); the descriptor plus its test passing the registry's CI is GREEN. On UNICA's side the input is already fixed and public: the hook's verified ABI at the Sepolia address above, re-provable with `bash docs/proof/verify-day1.sh` and with a Sourcify contract query for chain 11155111 returning `"match":"match"`. |
| **7. Account, key, form, or owner dependency** | GitHub account and fork; running `erc7730 generate` locally. No hardware device or vendor account needed for the descriptor itself. |
| **8. License and upstream contribution path** | ethereum/clear-signing-erc7730-registry is CC0-1.0 (`gh api`, 2026-09-04T22:08:47Z). No CONTRIBUTING.md at root; contributions by PR with the required `testsv2/` file per the repository's PR rules; no CLA found. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to the hook. The generated JSON would live under `docs/` and the generator script is removable in one commit. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

## 22 — hookmate ships a `remappings.txt` pointing at `node_modules` while its README documents a git-submodule install

| Field | |
|---|---|
| **1. Published prize requirement** | None directly — hookmate is a community package, not an ETHOnline sponsor and not Uniswap-owned. It serves the Uniswap Foundation requirement only as "tooling or solutions built for the broader ecosystem". Stated plainly; the venue benefit is indirect and this must not be counted as sponsor credit. |
| **2. Exact user or developer problem** | hookmate's `remappings.txt` has three lines, all resolving into `node_modules`. Its README's Foundry section tells the reader to add hookmate as a git submodule and then "ensure your remappings.txt includes" those lines, with no instruction to run an npm or pnpm install. Expected: follow the README's Foundry path and `forge build` resolves. Actual: three remappings point into a `node_modules` tree the submodule path never creates. |
| **3. Official product or repository involved** | github.com/akshatmittal/hookmate — `remappings.txt` (`@uniswap/v4-core/=node_modules/@uniswap/v4-core/`, `@uniswap/v4-periphery/=node_modules/@uniswap/v4-periphery/`, `forge-std=node_modules/forge-std/src/`) and `README.md` lines 40–48. UNICA depends on this package at pin ef3e984 for `AddressConstants` and the V4PoolManager artifact. |
| **4. Reproduction or primary-source evidence** | First-round `gh api` fetch of both files at 2026-09-04T21:56:56Z; **not re-fetched** in the verification pass. What was verified first-hand is that UNICA consumes the package and had to write its own remapping to do so: `remappings.txt:10` is `hookmate/=lib/hookmate/src/`, none of the three lines hookmate publishes, and `test/utils/SettlementTestBase.sol` imports `hookmate/constants/AddressConstants.sol` and `hookmate/artifacts/V4PoolManager.sol` through it. |
| **5. Smallest useful artifact** | One README sentence — Foundry consumers must run `pnpm install` at the hookmate root, or should use `hookmate/=lib/hookmate/src/` and let their own project resolve v4-core and v4-periphery — filed as an issue with a clean-checkout reproduction (submodule add, then `forge build`, no npm step). |
| **6. Red/green test or measurable proof** | RED: a fresh Foundry project that adds hookmate as a submodule and copies the three published remapping lines fails to resolve on `forge build`. GREEN: this repository builds and tests clean with the single `hookmate/=lib/hookmate/src/` line — `forge build --sizes` exits 0 (2026-09-04T22:10Z) and `test/utils/SettlementTestBase.sol` resolves both hookmate imports. The RED half needs a scratch project the owner would create; the GREEN half is already committed. |
| **7. Account, key, form, or owner dependency** | GitHub account for the issue. |
| **8. License and upstream contribution path** | No LICENSE file at the repository root; `package.json` declares `"license": "MIT"` (fetched 2026-09-04T22:09:32Z), so GitHub reports no licence while the package claims MIT — worth noting in the issue. No CONTRIBUTING.md; issues and PRs; no CLA found. |
| **9. Removable from UNICA core (yes/no, and what would be removed)** | Yes — no change to the hook. The working remapping is already carried. |
| **10. Confidence: verified, contradicted, undocumented, or speculative** | Verified. |

---

# Seams and demoted items: undocumented or speculative, not qualification

These are integration ideas or measurements without a reproduced defect behind them, or with evidence weaker than their prose. None is built. Each is listed so the gap is visible; none is presented as a fix.

## Demoted — carried, not ranked

These were assessed and are not in the ranked list. Each says why in one line.

- **Two-compiler split as a Foundry defect** — the defect itself was not reproduced in a minimal project this pass (a scratch attempt produced one compilation unit, not two), so it is undocumented rather than verified and must not be filed upstream until a minimal case is isolated; the integrator report stays in `FEEDBACK.md`.
- **Emit the standard `HookSwap` from the settlement path** — a seam, not a fix: nothing upstream is broken by not emitting it, and the hook already imports `IHookEvents` (`src/V4SettlementHook.sol:5`), inherits it (`:35`) and emits `HookFee` (`:250`), so only the `HookSwap` emission and its topic0 conformance test remain, both one commit removable.
- **One human, one discounted settlement (Selfie Check seam)** — a seam whose fix half is ranked at 16; it cannot be built or tested honestly while the verification endpoint and nullifier scope are undocumented and the beta gate is not self-serve.
- **Executor-side price-sanity check on order quotes (Chainlink seam)** — a seam with no defect behind it; the upgrade prize is Continuity-only and closed, and a feed read does not meet the Confidential Workflow track's stated TEE-handler requirement, so it earns no sponsor credit.
- **Wallet-funded payer for the demo surface (Privy seam)** — a seam, not a fix: frontend wiring with no defect corrected, no Solidity test possible, and a blocking owner dependency on a dashboard app id and secret.
- **A wallet control on an operator wallet (Privy B2B seam)** — a seam, not a fix, and weak on venue benefit: it gates UNICA's own admin funds rather than any user swap, and its evidence is a demonstrated console approval, not a test.
- **USDC settlement receipt over the CCTP leg (Arc seam)** — a seam and, honestly framed, a demonstration rather than an integration: it moves already-settled USDC off a Sepolia swap, routes nothing through a v4 pool on Arc, and Arc mainnet is not live.

## Not adopted, with the reason

- **ENSv2 contribution** — *speculative*: no ENSv2 defect was established by any reader, the surface was not independently swept this pass, and the work on the board is an integration design, not a fix; listed so the gap is visible rather than papered over.
- **"No hooks testing guide exists"** — refuted: the first-hook guide carries an explicit Testing section with a `deployCodeTo` harness and Foundry assertions, so the claim would be rejected in one click; a narrower gap survives but is different, larger, and unranked.
- **"No generic HookSwap handler exists"** — refuted as written (a third hook data source with a `handleHookSwap` handler does exist); its true content survives as ranks 5 and 12.
- **Hooklist submission** — closed on a blocking fact: the list's `chains.json` carries 21 mainnets and no testnet, and UNICA is Sepolia-only, so a submission today is rejected on that ground alone; it reopens the moment a mainnet deployment exists.
- **ENSIP-25/26 agent binding** — padding: a text record set once and read by a demo UI, with both ENSIPs still Draft, so nobody keeps anything durable.
- **An Arc readiness document** — padding by its own description: no Circle artifact is touched, and a track asking for a functional MVP with frontend, backend and a diagram will not read "we are ready" as one.
- **A pure mainnet-fork read of Aqua** — padding: it scores nothing against a requirement asking for onchain execution of token transfers in the demo, and the copyleft on the Aqua side rules out the shapes that would count for an MIT repository.
- **An x402-gated receipt service on Hedera** — a pivot, not an extension: it needs a separate microservice, a facilitator and a paying agent, with no Uniswap surface involved at any point.
- **A gateway recipe against an unpublished API** — closed because nothing is inspectable: no public repositories, no published schema, and a beta-access form only the owner may complete.

**Counted:** 38 candidate entries were read from the source research — 30 assessed items and 8 already-dropped candidates. 22 are included in the ranked list above, 7 are demoted with a reason, and 9 are not adopted. The source's own prose said 24 items qualified as fixes; its per-item field says 22, and the weaker figure is the one used here.