# Hook rules

Every hook in `src/` keeps these rules. They are the same rules this project's author applies to new v4 hooks today,
written out here for UNICA's own code. Each names the check that enforces it.

| Rule | Why | How it is checked here |
|---|---|---|
| The permissions-to-address test comes first, and it is trusted only after it has been sabotaged once | A flag/address mismatch fails silently in v4: the callback never fires and nothing reverts | a permissions test per hook (the `MineHook*` and flag tests under `test/`) |
| Declare only what you implement | A declared callback without an implementation reverts every swap | the same tests: declared mask = address mask |
| Returns-delta needs its own bit | Without it, the returned delta is ignored | flag tests |
| One pinned compiler and one pinned forge | Mined CREATE2 salts and verification depend on them | `foundry.toml` `solc_version = "0.8.30"`; CI pins forge v1.5.1. Forge 1.8.3 fails three tests here (two expected executor addresses and one transient-storage study): upgrading forge is a deliberate change, not a side effect |
| Every delta settles | An unsettled delta reverts the whole unlock | invariant and settlement tests (`test/SettlementExecutor.t.sol`, `test/unica-v4/hook/Guards.t.sol`) |
| Every hook has a fuzz test over amounts | Boundaries chosen by hand miss the ones nobody thought of | `testFuzz_*`: v1 settlement, v2 invoice fill, v4 caps and delivery (`test/unica-v4/hook/CapsFuzz.t.sol`), stock settlement, v5 catalog. v3 and the `lab/` studies have none yet |
| Testnets only; nothing signs without the owner | Keys never leave the owner's keystore | `Makefile` refuses non-testnet chain ids; `/tx-handoff` for every on-chain command |
| No AI attribution in any commit or PR | Authorship is the owner's | the `provenance` CI job |
| Third-party licenses travel with the code | Their terms require it | `licenses/` |

## What the fuzzing found in the v4 market hook (and it is correct behaviour)

- An order whose `minOut` is above `uint128(type(int128).max)` is refused with `AmountTooLarge` before the cap check.
- A payment too small to buy one unit of the payout token is refused with `OutputBelowMinimum(orderId, minOut, 0)`
  and moves nothing.
- A test that quotes with a payment and rolls back with `vm.revertToState` and then pays again in the same test sees the
  hook's transient storage from the quote: a test is one transaction. Measure from the payment's own `Settled` event.
