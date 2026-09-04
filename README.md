# UNICA

**UNICA is an MIT-licensed settlement hook and modular integration layer for Uniswap v4,
designed for applications and sponsor ecosystems to extend.** A payer pays in one currency, a
recipient receives another, atomically, through Uniswap's official Universal Router, into a pool
whose hook admits only that path for a registered order, with a receipt event. Built from
scratch during ETHOnline 2026 by NFTeria. UNICA is a project, not affiliated with or endorsed by
Uniswap.

> The specification and threat model were written before the event; every line of code was
> written during it. Both pre-event documents ship unedited in [`specs/`](specs/README.md).

**Status, day 2 (2026-09-04, night):** the settlement runs through Uniswap's official Universal
Router and the hook admits nothing else (invariant I1); the hook reads every term of the order
from the executor's storage and enforces it itself (I3, I4, I5), refuses a partial fill or a
short output (I6), and emits the receipt beside OpenZeppelin's standard `HookFee` (I2); native
settlement is proven as four rows plus the official router's own bytecode (I7). Thirty-four
tests, fuzz at 10,000, against Uniswap's official PoolManager and Universal Router bytecode. The
whole path was then rehearsed end to end on an anvil fork of Sepolia against the deployed
Universal Router: executor and hook deployed at their derived and mined addresses, pool
initialised and seeded, one order paid, one receipt, seven transactions at status 1, nothing
broadcast (`make rehearse`). On chain, the day-1 scaffold hook keeps its record; the gated hook
is mined fresh and live-fired on day 4. The surface and the video are the next days' work. Nothing here is claimed past the rung
it has reached.

## The problem

A business that settles customer payments in one asset, and a customer who wants to pay in
another, today need two transactions and a window in which someone holds an asset they did
not ask for. Uniswap v4 can put the exchange inside the settlement boundary, but a passive hook
cannot promise where the output lands: `PoolManager.swap()` has no recipient parameter, output
is credited to the router that called it, and the router chooses the recipient after
`afterSwap` has returned (spec section 2). So UNICA is **one thin executor plus a policy hook on
Uniswap's official router**: the executor composes the router's plan from a registered order, so
the output is taken to the order's recipient; the hook admits only the official router driven by
that executor, verifies every term of the order from storage, and emits the receipt. The honest
sentence is "a verifiable settlement-invariant executor + policy hook on the official execution
path", not "a hook that enforces the payout address". Why the official router and not one of our
own is answered question by question, with sources, in
[`docs/EXECUTION-PATH.md`](docs/EXECUTION-PATH.md).

## Architecture and the transaction sequence

```
payer ─► SettlementExecutor.pay(orderId)          the order leaves Open before any external call (I5)
            └─ UniversalRouter.execute(V4_SWAP)     Uniswap's official router; msgSender() is the executor
                 └─ PoolManager.unlock ─► the router's V4 actions
                      ├─ swap(key, params, abi.encode(orderId))
                      │     ├─ V4SettlementHook.beforeSwap   sender is the router, caller is the executor,
                      │     │                                 order in flight, unexpired, params and pool
                      │     │                                 are the order's            (I1, I3, I4, I5)
                      │     └─ V4SettlementHook.afterSwap    whole input consumed, output ≥ minimum,
                      │                                       SettlementReceipt + HookFee   (I2, I6)
                      ├─ settle(native)              the router syncs, then settles     (I7)
                      └─ take(USDC, order.recipient, everything)   the line the executor exists for (I1)
```

The contract layout for the three partners this entry builds on, and which contracts are Vyper,
is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The invariants land one slice at a time,
each with a negative test first; their rungs are in [`docs/INVARIANTS.md`](docs/INVARIANTS.md)
and the threats in [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## Where the code is (file and line, checked against this commit)

| What | Where |
|---|---|
| The hook contract | [`src/V4SettlementHook.sol:35`](src/V4SettlementHook.sol#L35) |
| The official router and the executor the hook trusts, both fixed at construction: the router from the chain id, the executor from its own creation code through the canonical CREATE2 factory; nothing configurable after deploy | [`src/V4SettlementHook.sol:44`](src/V4SettlementHook.sol#L44), [`:46`](src/V4SettlementHook.sol#L46), [`:95`](src/V4SettlementHook.sol#L95), [`src/libraries/UniswapDeployments.sol:13`](src/libraries/UniswapDeployments.sol#L13) |
| Zero-argument constructor resolving the PoolManager and the router from the chain id (one address on every chain, spec section 7d) | [`src/V4SettlementHook.sol:85`](src/V4SettlementHook.sol#L85) |
| Declared permissions, `beforeSwap` and `afterSwap`, no returns-delta flag (mask 0xC0) | [`src/V4SettlementHook.sol:103`](src/V4SettlementHook.sol#L103) |
| **Invariant I1's gate**: the sender is the Universal Router, and the router's `msgSender()` is the executor | [`src/V4SettlementHook.sol:127`](src/V4SettlementHook.sol#L127), [`:133`](src/V4SettlementHook.sol#L133), [`:135`](src/V4SettlementHook.sol#L135) |
| The order, read from the executor's storage and never from hook data: exactly one order id or malformed (spec C1), in flight (I5), unexpired (I4), the swap's direction, amount and pool are the order's (I3) | [`src/V4SettlementHook.sol:174`](src/V4SettlementHook.sol#L174), [`:179`](src/V4SettlementHook.sol#L179), [`:182`](src/V4SettlementHook.sol#L182), [`:138`](src/V4SettlementHook.sol#L138), [`:140`](src/V4SettlementHook.sol#L140), [`:142`](src/V4SettlementHook.sol#L142) |
| **Invariant I6** after the swap: the pool consumed the whole input, the output is at least the order's minimum, or the whole payment reverts | [`src/V4SettlementHook.sol:149`](src/V4SettlementHook.sol#L149), [`:157`](src/V4SettlementHook.sol#L157), [`:160`](src/V4SettlementHook.sol#L160) |
| **Invariant I2**: the receipt with the order id and the authenticated payer, and OpenZeppelin's standard `HookFee` beside it | [`src/V4SettlementHook.sol:166`](src/V4SettlementHook.sol#L166), [`:167`](src/V4SettlementHook.sol#L167), [`:56`](src/V4SettlementHook.sol#L56) |
| The executor, the one thin contract between an application and the official router: its `Order` (the only source of recipient, amount, minimum, deadline), `createOrder`, and `pay` (the payer's single call) | [`src/SettlementExecutor.sol:29`](src/SettlementExecutor.sol#L29), [`:44`](src/SettlementExecutor.sol#L44), [`:96`](src/SettlementExecutor.sol#L96), [`:129`](src/SettlementExecutor.sol#L129) |
| **Invariant I5** at the executor: the order leaves Open before any external call | [`src/SettlementExecutor.sol:139`](src/SettlementExecutor.sol#L139) |
| The plan the executor composes for the official router: swap with only the order id as hook data (spec C1), settle the native input, take the whole output to the order's recipient (I1); then one call to `execute` | [`src/SettlementExecutor.sol:155`](src/SettlementExecutor.sol#L155), [`:169`](src/SettlementExecutor.sol#L169), [`:175`](src/SettlementExecutor.sol#L175), [`:143`](src/SettlementExecutor.sol#L143) |
| T5 guard, asserted numerically before any deploy; the day-1 address shape refused; the derived executor address checked against where the executor lands; the router checked against its deployed runtime | [`test/V4SettlementHook.t.sol:33`](test/V4SettlementHook.t.sol#L33), [`:45`](test/V4SettlementHook.t.sol#L45), [`:61`](test/V4SettlementHook.t.sol#L61), [`:67`](test/V4SettlementHook.t.sol#L67), [`:82`](test/V4SettlementHook.t.sol#L82), [`:101`](test/V4SettlementHook.t.sol#L101) |
| I1 negatives: a swap from the official test router is refused before the hook asks anyone anything; the official router driven by a stranger is refused with the stranger named, and the stranger keeps every wei | [`test/V4SettlementHook.t.sol:109`](test/V4SettlementHook.t.sol#L109), [`:124`](test/V4SettlementHook.t.sol#L124) |
| The hook's own order checks, reached through a harness at the executor's address that drives the official router with plans the real executor never composes | [`test/V4SettlementHook.t.sol:154`](test/V4SettlementHook.t.sol#L154), [`:179`](test/V4SettlementHook.t.sol#L179), [`:200`](test/V4SettlementHook.t.sol#L200), [`:216`](test/V4SettlementHook.t.sol#L216), [`:231`](test/V4SettlementHook.t.sol#L231) |
| Reading permissions off the real runtime code | [`test/V4SettlementHook.t.sol:320`](test/V4SettlementHook.t.sol#L320) |
| I1 positive through the official router, fuzzed at 10,000; I2 with both events decoded field by field; I5, I4, I6 and the partial fill, each asserting nothing moved; the executor's missing door to the PoolManager | [`test/SettlementExecutor.t.sol:40`](test/SettlementExecutor.t.sol#L40), [`:70`](test/SettlementExecutor.t.sol#L70), [`:108`](test/SettlementExecutor.t.sol#L108), [`:126`](test/SettlementExecutor.t.sol#L126), [`:138`](test/SettlementExecutor.t.sol#L138), [`:162`](test/SettlementExecutor.t.sol#L162), [`:192`](test/SettlementExecutor.t.sol#L192), [`:235`](test/SettlementExecutor.t.sol#L235) |
| I7 as five rows: the control, the trap, the defect, the invariant, and the official router's own bytecode with a foreign settle leg before the native one | [`test/I7NativeSettle.t.sol:53`](test/I7NativeSettle.t.sol#L53), [`:61`](test/I7NativeSettle.t.sol#L61), [`:69`](test/I7NativeSettle.t.sol#L69), [`:98`](test/I7NativeSettle.t.sol#L98), [`:109`](test/I7NativeSettle.t.sol#L109) |
| The test base: Uniswap's official PoolManager bytecode etched at the canonical address, its 24,009-byte runtime asserted; the official Universal Router's deployed runtime etched at its Sepolia address, its keccak asserted | [`test/utils/SettlementTestBase.sol:74`](test/utils/SettlementTestBase.sol#L74), [`:42`](test/utils/SettlementTestBase.sol#L42), [`:107`](test/utils/SettlementTestBase.sol#L107), [`test/utils/artifacts/UniversalRouterV2Sepolia.sol:12`](test/utils/artifacts/UniversalRouterV2Sepolia.sol#L12) |
| The two harnesses: the executor with its plan made arbitrary, and a stand-in at the router's address with I7's defence switchable | [`test/utils/ExecutorHarness.sol:13`](test/utils/ExecutorHarness.sol#L13), [`test/utils/RouterHarness.sol:53`](test/utils/RouterHarness.sol#L53), [`:78`](test/utils/RouterHarness.sol#L78) |
| Deterministic salt mining and CREATE2 deploy, the executor at its derived address; pool initialisation, seeding, and the settlement stage (the day-1 scaffold's script, reworked for the gated hook before day 4) | [`script/LiveFire.s.sol:69`](script/LiveFire.s.sol#L69), [`:107`](script/LiveFire.s.sol#L107), [`:116`](script/LiveFire.s.sol#L116), [`:145`](script/LiveFire.s.sol#L145), [`:166`](script/LiveFire.s.sol#L166), [`:217`](script/LiveFire.s.sol#L217) |

## Uniswap dependencies

| Dependency | Pin | Used at |
|---|---|---|
| OpenZeppelin `uniswap-hooks` (`BaseHook`, `IHookEvents`) | v1.1.1, `bd5287c` | `src/V4SettlementHook.sol` |
| `v4-core` (through `uniswap-hooks`) | `d153b04` | `Hooks`, `PoolKey`, `Currency`, `BalanceDelta`, the wrapped-error shape the tests assert |
| `v4-periphery` (through `uniswap-hooks`) | `7ebd04b` | `IV4Router`, `Actions`, `ActionConstants` in the executor's plan; `IMsgSender` in the hook's gate; `HookMiner` in the deploy script |
| `hookmate` | `ef3e984` | `AddressConstants.getPoolManagerAddress(chainid)`; the official PoolManager initcode the tests deploy |
| PoolManager, Ethereum Sepolia | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | the constructor, the scripts, the local test topology |
| Universal Router (`UniversalRouterV2`), Ethereum Sepolia | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` | the only swap sender the hook admits and the executor's one call; its deployed runtime (19,540 bytes) is etched in the tests at this address |
| `PoolSwapTest`, `PoolModifyLiquidityTest`, `StateView`, Sepolia | `0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe`, `0x0C478023803a644c94c4CE1C1e7b9A087e411B0A`, `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C` | the day-1 seed and swap, the seeding stage, and the I1 negative test |
| Permit2, Sepolia | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | not yet; the ERC-20 payer path |

All Sepolia addresses were read from the official v4 deployments page and confirmed to hold code
on 2026-09-04 (`cast code <addr> --rpc-url https://ethereum-sepolia-rpc.publicnode.com`).

## Setup, test, fuzz

```sh
git clone https://github.com/NFTeria/UNICA.git && cd UNICA
make deps        # fetches the pinned submodules (the v4 toolchain) and asserts the pin
make doctor      # says what is present, what is missing, and how to get it
make gate        # forge build && forge test && forge fmt --check; expect 34 tests passed, 0 failed
forge test -vv   # 34 tests; the fuzz tests print their run count (10,000)
make predict     # the hook address and salt this creation code lands on, before any deploy
make help        # every other command: the local fork, the four stages, Sepolia, readback, verify
```

The four stages (deploy the executor and the hook, initialise the pool, seed it, settle an order
through the executor and the official router) each have a `make` target. With no arguments they
run against a local anvil fork of Sepolia started by `make anvil`, impersonating the deployer, so
the real PoolManager, the real Universal Router and the real USDC are exercised without a real
transaction; with `ARGS="--network sepolia"` they sign with a keystore account and broadcast.
`make rehearse` does all four on a throwaway fork in one command with a readback.

Needs Foundry (`forge`, `cast`; `anvil` only for the fork rehearsal) and git. Nothing from
the author's machine is required; CI runs the same commands on a fresh clone of this
repository, without submodules, on every push.

Toolchain on the machine that produced the numbers in this file: forge/cast
`1.3.5-foundry-zksync-v0.1.9`, anvil `1.5.1-stable`. CI pins upstream Foundry v1.5.1.

## Proof: Ethereum Sepolia (chain id 11155111)

The pool is native ETH against Circle's USDC, a v4-only shape: `currency0 = address(0)`, no
wrapping. Every row names the rung it has reached and carries the command that re-proves it.
This is the day-1 scaffold's record, kept unchanged: that contract was named `UnicaHook`, had
`afterSwap` only, and observed rather than gated. The hook in `src/` today is a different
contract, mined fresh and live-fired on day 4, and gets its own rows then.
LIVE means mined on Ethereum Sepolia with status 1, read back from the chain before it was
written here. `RPC=https://ethereum-sepolia-rpc.publicnode.com` in the commands below.

| Item | Value | Rung | Re-verify |
|---|---|---|---|
| Hook | `0x23b46783709E4A94C229612bfA55580a6682c040`, salt `0x93fb`, flags `0x40` (afterSwap only), 6,051 bytes of runtime code | LIVE, [explorer](https://sepolia.etherscan.io/address/0x23b46783709E4A94C229612bfA55580a6682c040) | `cast code 0x23b46783709E4A94C229612bfA55580a6682c040 --rpc-url $RPC \| wc -c` prints 12105; `make predict` reproduces the address and salt |
| Deploy transaction | [`0x0171976a…b8da`](https://sepolia.etherscan.io/tx/0x0171976a8716d2084890d8cfa155924fcf7b315b03263f1015d6794cee34b8da), block 11635908, 1,392,115 gas, through the CREATE2 factory `0x4e59…956C` | LIVE | `cast receipt 0x0171976a8716d2084890d8cfa155924fcf7b315b03263f1015d6794cee34b8da --rpc-url $RPC --field status` prints `1` |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` (Uniswap's official Sepolia deployment) | LIVE | `cast call 0x23b46783709E4A94C229612bfA55580a6682c040 'poolManager()(address)' --rpc-url $RPC` prints it |
| Pool | ETH / USDC, fee 3000, spacing 60, id `0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7`, initialised at 2,500 USDC per ETH ([`sqrtPriceX96`](script/LiveFire.s.sol#L40) `3961408125713216879677197`) | LIVE, tx [`0xe7cc4bbc…f08b`](https://sepolia.etherscan.io/tx/0xe7cc4bbc094938ca3c74857d585f4e53cecc6161ae579e8838e11a32084df08b), 51,982 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' 0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7 --rpc-url $RPC` |
| Liquidity | 0.008 ETH + 19.999999 USDC, full range, liquidity `400000000000` | LIVE, approve [`0x7e56b7ca…3213`](https://sepolia.etherscan.io/tx/0x7e56b7ca63d2ccf0be66f73f2e728bf20de645581a8aba5de7f9e5fc103e3213) then seed [`0xb5356276…baae`](https://sepolia.etherscan.io/tx/0xb535627674e56b751d88335688021aa2cfc2e34dc6d749dc8f4a920da425baae), 257,782 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getLiquidity(bytes32)(uint128)' 0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7 --rpc-url $RPC` prints 400000000000 |
| **The swap through the hook** | 0.001 ETH exact-input to 2.216294 USDC; the receipt carries the PoolManager's `Swap` event and the hook's `AfterSwapObserved(sender, poolId, delta)` with delta `-1000000000000000 / +2216294`; `afterSwapCount` went 0 to 1 | LIVE, tx [`0x6d580aef…06bf`](https://sepolia.etherscan.io/tx/0x6d580aef7b3d8848fcee555ab8cd7c28fa28c1abeb4d538455be349d0a8a06bf), block 11635908, 166,516 gas | `cast receipt 0x6d580aef7b3d8848fcee555ab8cd7c28fa28c1abeb4d538455be349d0a8a06bf --rpc-url $RPC --field status` prints `1`; `cast call 0x23b46783709E4A94C229612bfA55580a6682c040 'afterSwapCount()(uint256)' --rpc-url $RPC` prints `1`; `make readback` prints all of the above |
| Broadcast record | [`broadcast/LiveFire.s.sol/11155111/run-latest.json`](broadcast/LiveFire.s.sol/11155111/run-latest.json): five transactions, five receipts, 1,923,832 gas, identical to the fork rehearsal | committed | `python3 -c "import json;r=json.load(open('broadcast/LiveFire.s.sol/11155111/run-latest.json'));print(len(r['receipts']),sorted(set(x['status'] for x in r['receipts'])))"` prints `5 ['0x1']` |
| Source verification | Etherscan: Source Code Verified, Exact Match, compiler v0.8.30+commit.73712a01, optimizer off, cancun. Sourcify: full match on creation and runtime, verified 2026-09-04T21:18:15Z | VERIFIED, [explorer](https://sepolia.etherscan.io/address/0x23b46783709E4A94C229612bfA55580a6682c040#code) | `curl -s https://sourcify.dev/server/v2/contract/11155111/0x23b46783709E4A94C229612bfA55580a6682c040` prints `"match":"match"`; `make verify` re-submits |
| Proof images and the re-verification script | [`docs/proof/`](docs/proof/README.md): the swap at status 1, its Logs tab with the PoolManager's `Swap` and the hook's `AfterSwapObserved`, the verified source page | committed | `bash docs/proof/verify-day1.sh` prints `checks run: 14, passed: 14, failed: 0` |
| Public surface | not yet (day 5) | pending | |
| Demo video | not yet (day 7) | pending | |

The swap's price impact is large on purpose: the seed is sized to what the deployer held,
and the point of the row is that the callback ran on Uniswap's real PoolManager. The
transaction labels the tool prints beside each hash were shuffled; the mapping above is from
the receipts (target address and function selector), which is the only mapping that counts.

One compiler fact worth knowing: on day 1 this tree pinned no solc, so forge compiled the hook
at 0.8.26 in the test unit (which then needed v4-core's exact-pinned PoolManager) and at 0.8.30
in the script unit, and the script is what deployed. The verified source is the 0.8.30 build,
byte-identical to the chain outside the immutable slots. Since day 2 the tree pins 0.8.30 and
the tests deploy the official PoolManager bytecode from hookmate's artifact instead of compiling
it, so one compiler serves tests, scripts, and verification; `script/verify.sh` still picks the
artifact that matches the chain rather than assuming one.

## Security limitations, stated

- The hook keeps no state between callbacks: `beforeSwap` and `afterSwap` each read the order
  from the executor, so a reentrant swap inside the unlock meets the same gate. The reentrancy
  test the spec asks for (T6) is not written yet.
- The executor is the security boundary on UNICA's side: no owner, no upgrade path, no
  `receive`, no access to the PoolManager. The Universal Router is Uniswap's deployment and is
  trusted as Uniswap's code, not audited here.
- The pool allowlist (spec C2) and the payout-asset allowlist (C4) are not implemented. An
  order's input is native ETH by construction; its output currency is whatever pool key the
  order names.
- No audit. Security posture will be scored against the Uniswap Foundation's self-directed
  framework in `SECURITY.md` on day 5.

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

