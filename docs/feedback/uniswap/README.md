# Uniswap inventory

Every row's evidence is dated 2026-09-04 and lives in `docs/INTEGRATIONS.md` unless noted.
Nothing here is a claim of qualification for any prize or track.

## (a) Fixed or worked around in our own tree

| Our fix (file:line) | Upstream gap it works around | Draft |
|---|---|---|
| `src/V4SettlementHook.sol:4` (corrected `BaseHook` import) | 7 doc guides plus a plugin template import a `BaseHook` path absent from v4-periphery | `docs/upstream/01-basehook-import-path-docs.md`, `03-uniswap-ai-template-imports.md` |
| `src/V4SettlementHook.sol:14` (`SwapParams` from `PoolOperation.sol`) | The same template imports `SwapParams` from `IPoolManager`, which no longer declares it | `docs/upstream/03-uniswap-ai-template-imports.md` |
| `script/LiveFire.s.sol:20`, periphery pinned at `7ebd04b` | `HookMiner` moved twice; a live doc page still links a 404 | `docs/upstream/02-hookminer-import-path-docs.md` |
| `foundry.toml:12-16` (solc pinned 0.8.30) + `test/utils/SettlementTestBase.sol:18-19,82-91` (etches the official runtime instead of compiling it) | `PoolManager`'s exact `pragma solidity 0.8.26;` splits an unpinned build across two compilers | `docs/upstream/04-two-compiler-split-poolmanager.md` |
| `test/V4SettlementHook.t.sol:61,67` + `test/I7NativeSettle.t.sol:69,99` | The hooks-concept page and the troubleshooting page each describe part of a permission or settlement failure and stop short | `docs/upstream/05-concepts-hooks-failure-modes.md`, `06-troubleshooting-selector-table.md` |
| `.github/workflows/ci.yml:1-5` (push + pull_request enabled) | The v4 template's own CI ships with both triggers commented out | `docs/upstream/07-v4-template-ci-triggers.md` |

## (b) Wanted, no code change needed on their side

| Ask | Where | Evidence |
|---|---|---|
| Correct the import paths named in (a) | `Uniswap/docs` (7 guides), `Uniswap/uniswap-ai` (1 template) | `docs/upstream/01, 02, 03` |
| One paragraph stating the pragma-driven two-compiler split | `Uniswap/v4-core`, `src/PoolManager.sol:2` | `docs/upstream/04` |
| A three-row failure-mode table; cause/fix rows beside two error selectors | `Uniswap/docs`, `concepts/hooks.mdx`, `troubleshooting.mdx` | `docs/upstream/05, 06` |
| Uncomment the CI triggers, or state why not | `Uniswap/v4-template`, `.github/workflows/test.yml` | `docs/upstream/07` |
| A published Universal Router runtime artifact per chain, the way `hookmate` already ships one for `PoolManager` | no single repository named | `FEEDBACK.md`, 2026-09-04 entry |
| One NatSpec sentence: `ExecutionFailed` never fires for a failed `V4_SWAP` command | `Uniswap/universal-router`, `IUniversalRouter` | `FEEDBACK.md`, 2026-09-04 entry |

## (c) Would require a Uniswap code change

| Repository / file | Evidence | Requested change |
|---|---|---|
| `Uniswap/v4-periphery`, `src/interfaces/IV4Router.sol` — `ExactInputSingleParams` gained `minHopPriceX36` at commit `03b2d09` (2026-03-17) | On a fork of an observed chain, a router built after that commit refuses our pinned periphery's (`7ebd04b`) five-field encoding with an empty revert inside `unlockCallback`; the identical encoding passes against the listed Sepolia router on a Sepolia fork (control). The router exposes no selector, version call, or distinct revert that would let an integrator detect the mismatch before broadcasting. Detail: `uniswap/robinhood.md`. | Keep the struct's ABI stable across router builds, or give an integrator a way to detect which layout a deployed router expects before it signs — a version discriminator, or a distinguishing revert reason for the older call. |
| `Uniswap/v4-subgraph`, `subgraph.yaml` + `abis/AggregatorHook.json` (`HookSwap`, 5 params, `int256/uint24`) vs `OpenZeppelin/uniswap-hooks`, `IHookEvents.sol` (`HookSwap`, 6 params, `int128/uint128`) | Different `topic0` hashes, computed with `cast keccak` (`docs/INTEGRATIONS.md` rank 5); a hook emitting the standardized event is indexed by nothing in the official subgraph | Add a second event handler for the six-parameter form, or state plainly the two are unrelated events sharing a name |
| `Uniswap/v4-subgraph`, `networks.json` + `scripts/generate-subgraph.ts` | The `AggregatorHook` data source exists for exactly one network; the generator that could template it does not (`docs/INTEGRATIONS.md` rank 12) | Generalize the hook data source to an array of `{address, startBlock}` entries per network |
