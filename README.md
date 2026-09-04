# UNICA

**A reusable, MIT-licensed Uniswap v4 settlement hook.** A payer pays in one currency, a
recipient receives another, atomically, through a router-gated v4 path, with a receipt event.
Built from scratch during ETHOnline 2026 by NFTeria.

> The specification and threat model were written before the event; every line of code was
> written during it. Both pre-event documents ship unedited in [`specs/`](specs/README.md).

**Status, day 1 (2026-09-04):** the hook frame compiles, its permission-bit guard has been seen
to fail and then pass, a real swap runs through it against v4-core's own PoolManager locally,
and the full deploy-init-seed-swap sequence has been simulated against live Ethereum Sepolia
state as the deployer. The live-fire transactions themselves are the next step and their rows
below say so. Nothing here is claimed past the rung it has reached.

## The problem

A business that settles customer payments in one asset, and a customer who wants to pay in
another, today need two transactions and a window in which someone holds an asset they did
not ask for. Uniswap v4 can put the exchange inside the settlement boundary, but a passive hook
cannot promise where the output lands: `PoolManager.swap()` has no recipient parameter, output
is credited to the router that called it, and the router chooses the recipient after
`afterSwap` has returned (spec section 2). So UNICA is a **router plus a policy hook**: the
router is the only caller the hook admits, it always delivers to the registered recipient, and
the hook verifies the settlement and emits the receipt. The honest sentence is "a verifiable
settlement-invariant router + policy hook", not "a hook that enforces the payout address".

## Architecture and the transaction sequence

```
payer ─► UnicaSettlementRouter (the sole authorised caller; arrives with invariant I1)
            └─ PoolManager.unlock()
                 └─ unlockCallback
                      ├─ PoolManager.swap(key, params, abi.encode(orderId))
                      │     ├─ UnicaHook.beforeSwap   refuse any sender but the router   (I1, I4, I5)
                      │     └─ UnicaHook.afterSwap    verify realised output, emit receipt (I2, I3)
                      └─ PoolManager.take(outputCurrency, order.recipient, amountOut)
```

The contract layout for the three partners this entry builds on, and which contracts are Vyper, is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Today only the `afterSwap` leg exists, with no logic beyond observation. The invariants land one
slice at a time, each with a negative test first; their rungs are in
[`docs/INVARIANTS.md`](docs/INVARIANTS.md) and the threats in
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## Where the code is (file and line, checked against this commit)

| What | Where |
|---|---|
| The hook contract | [`src/UnicaHook.sol:22`](src/UnicaHook.sol#L22) |
| Zero-argument constructor resolving the PoolManager from the chain id (one address on every chain, spec section 7d) | [`src/UnicaHook.sol:36`](src/UnicaHook.sol#L36) |
| Declared permissions, `afterSwap` only today | [`src/UnicaHook.sol:39`](src/UnicaHook.sol#L39) (the one `true` at line 48) |
| The `afterSwap` callback, reachable only through `BaseHook.onlyPoolManager` | [`src/UnicaHook.sol:59`](src/UnicaHook.sol#L59) |
| The observable: `afterSwapCount` and `AfterSwapObserved` | [`src/UnicaHook.sol:29`](src/UnicaHook.sol#L29), [`:34`](src/UnicaHook.sol#L34) |
| T5 guard, asserted numerically before any deploy | [`test/UnicaHook.t.sol:41`](test/UnicaHook.t.sol#L41) and [`:58`](test/UnicaHook.t.sol#L58) |
| Reading permissions off the real runtime code | [`test/UnicaHook.t.sol:134`](test/UnicaHook.t.sol#L134) |
| The negative control from v4 itself (`HookAddressNotValid` at a beforeSwap-only address) | [`test/UnicaHook.t.sol:76`](test/UnicaHook.t.sol#L76) |
| A real swap through v4-core's PoolManager reaching the hook | [`test/UnicaHook.t.sol:96`](test/UnicaHook.t.sol#L96), fuzzed at [`:110`](test/UnicaHook.t.sol#L110), hookless control at [`:121`](test/UnicaHook.t.sol#L121) |
| Local PoolManager placed at the canonical Sepolia address so the zero-arg constructor resolves | [`test/UnicaHook.t.sol:48`](test/UnicaHook.t.sol#L48) |
| Deterministic salt mining and CREATE2 deploy | [`script/LiveFire.s.sol:88`](script/LiveFire.s.sol#L88), [`:68`](script/LiveFire.s.sol#L68) |
| Pool initialisation, seeding, and the proof swap | [`script/LiveFire.s.sol:117`](script/LiveFire.s.sol#L117), [`:138`](script/LiveFire.s.sol#L138), [`:181`](script/LiveFire.s.sol#L181) |

## Uniswap dependencies

| Dependency | Pin | Used at |
|---|---|---|
| OpenZeppelin `uniswap-hooks` (`BaseHook`) | v1.1.1, `bd5287c` | `src/UnicaHook.sol` |
| `v4-core` (through `uniswap-hooks`) | `d153b04` | `Hooks`, `PoolKey`, `BalanceDelta`, `StateLibrary`, the local PoolManager under test |
| `v4-periphery` (through `uniswap-hooks`) | `7ebd04b` | `HookMiner.computeAddress` in the deploy script |
| `hookmate` | `ef3e984` | `AddressConstants.getPoolManagerAddress(chainid)` |
| PoolManager, Ethereum Sepolia | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | the constructor, the scripts, the local test topology |
| `PoolSwapTest`, `PoolModifyLiquidityTest`, `StateView`, Sepolia | `0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe`, `0x0C478023803a644c94c4CE1C1e7b9A087e411B0A`, `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C` | the day-1 seed and swap; the router is replaced by UNICA's own with invariant I1 |
| Permit2, Sepolia | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | not yet; the ERC-20 payer path |

All Sepolia addresses were read from the official v4 deployments page and confirmed to hold code
on 2026-09-04 (`cast code <addr> --rpc-url https://ethereum-sepolia-rpc.publicnode.com`).

## Setup, test, fuzz

```sh
git clone https://github.com/NFTeria/UNICA.git && cd UNICA
make deps        # fetches the pinned submodules (the v4 toolchain) and asserts the pin
make doctor      # says what is present, what is missing, and how to get it
make gate        # forge build && forge test && forge fmt --check; expect 7 tests passed, 0 failed
forge test -vv   # the fuzz test prints its run count (10,000)
make predict     # the hook address and salt this creation code lands on, before any deploy
```

Needs Foundry (`forge`, `cast`; `anvil` only for the fork rehearsal) and git. Nothing from
the author's machine is required; CI runs the same commands on a fresh clone of this
repository, without submodules, on every push.

Toolchain on the machine that produced the numbers in this file: forge/cast
`1.3.5-foundry-zksync-v0.1.9`, anvil `1.5.1-stable`. CI pins upstream Foundry v1.5.1.

## Proof: Ethereum Sepolia (chain id 11155111)

The pool is native ETH against Circle's USDC, a v4-only shape: `currency0 = address(0)`, no
wrapping. Each row names the rung it has reached. PREDICTED means computed from the creation
code; SIMULATED means executed against live chain state as the deployer without broadcasting;
LIVE means mined with status 1. A row is never promoted without the command beside it.

| Item | Value | Rung | Re-verify |
|---|---|---|---|
| Hook address | `0x23b46783709E4A94C229612bfA55580a6682c040`, salt `0x93fb`, flags `0x40` | PREDICTED | `make predict` |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | LIVE (Uniswap's) | `cast code 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 --rpc-url https://ethereum-sepolia-rpc.publicnode.com \| wc -c` prints 48021 (24,009 bytes) |
| Pool | ETH / USDC, fee 3000, spacing 60, id `0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7`, initial price 2,500 USDC per ETH (`sqrtPriceX96` [`3961408125713216879677197`](script/LiveFire.s.sol#L40)) | SIMULATED | `make simulate-sepolia DEPLOYER=<address>` |
| Liquidity | 0.008 ETH + 19.999999 USDC, full range, liquidity 400000000000 | SIMULATED | same |
| Swap through the hook | 0.001 ETH exact-input to 2.216294 USDC; `afterSwapCount` 0 to 1 | SIMULATED | same |
| Deploy, init, seed, swap transactions | not yet broadcast | pending | `make live-sepolia` by the key holder, then `make readback-sepolia` |
| Source verification | not yet | pending | `make verify-sepolia` |
| Public surface | not yet (scheduled for day 5) | pending | |
| Demo video | not yet (scheduled for day 7) | pending | |

The swap's price impact is large on purpose: the seed is deliberately small, sized to what the
deployer holds, and the point of the row is that the callback ran on a real PoolManager.

## Security limitations, stated

- Today's hook has no gate: it declares `afterSwap` only and observes. It is a frame.
- Everything inside v4's unlock window is reentrant; the design keys callback state by pool and
  caller and adds its own guard (spec C3). Not implemented yet.
- The router is the security boundary once it exists: its ownership, upgradeability (none,
  by design), and calldata parsing are all in scope of the threat model.
- No audit. Security posture will be scored against the Uniswap Foundation's self-directed
  framework in `SECURITY.md` when the invariants land.

## Provenance

Three things a judge needs to tell apart, in [`HACKATHON.md`](HACKATHON.md): the disclosed
pre-event specification and threat model in `specs/`; upstream open-source dependencies under
`lib/` with their own licences (v4-core arrives under BUSL-1.1 and is not relicensed; the
dependency layout follows the public `Uniswap/v4-template`, MIT, used as a starter kit and not
cloned); and the implementation written during the event. AI tooling assisted the build and
[`AI_USAGE.md`](AI_USAGE.md) says exactly where; no commit carries an AI co-author.

An earlier settlement-receipt hook by the same author is cited as prior art in the spec and was
not copied. NFTeria's private `.click` product is the first integrator: it settles customer
payments and wants pay-in-X, receive-in-Y, atomically, with a receipt. The private product
never enters this repository.

Feedback for the Uniswap engineers who maintain the tools this is built on is captured the hour
it happens in [`FEEDBACK.md`](FEEDBACK.md).

## Licence

MIT, see [`LICENSE`](LICENSE). Dependencies keep their own.
