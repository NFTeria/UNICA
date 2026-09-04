# UNICA

**A reusable, MIT-licensed Uniswap v4 settlement hook.** A payer pays in one currency, a
recipient receives another, atomically, through a router-gated v4 path, with a receipt event.
Built from scratch during ETHOnline 2026 by NFTeria.

> The specification and threat model were written before the event; every line of code was
> written during it. Both pre-event documents ship unedited in [`specs/`](specs/README.md).

**Status, day 2 (2026-09-04, evening):** the settlement router exists and the hook admits only it
(invariant I1), native settlement is proven as four rows (I7), and every refusal leaves the payer
whole and the order payable (I6); I3, I4, I5 hold at the router. Twenty-five tests, fuzz at
10,000, against Uniswap's official PoolManager bytecode. On chain, the day-1 scaffold hook keeps
its record; the gated hook is mined fresh and live-fired on day 4. The receipt (I2), the surface,
and the video are the next days' work. Nothing here is claimed past the rung it has reached.

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

The contract layout for the three partners this entry builds on, and which contracts are Vyper, is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The router and the `beforeSwap` gate exist; `afterSwap` still only observes until the receipt
lands on day 3. The invariants land one slice at a time, each with a negative test first; their rungs are in
[`docs/INVARIANTS.md`](docs/INVARIANTS.md) and the threats in
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## Where the code is (file and line, checked against this commit)

| What | Where |
|---|---|
| The hook contract | [`src/UnicaHook.sol:26`](src/UnicaHook.sol#L26) |
| The only admitted swap sender, derived from the router's creation code through the canonical CREATE2 factory; nothing configurable after deploy | [`src/UnicaHook.sol:36`](src/UnicaHook.sol#L36), [`:59`](src/UnicaHook.sol#L59) |
| Zero-argument constructor resolving the PoolManager from the chain id (one address on every chain, spec section 7d) | [`src/UnicaHook.sol:52`](src/UnicaHook.sol#L52) |
| Declared permissions, `beforeSwap` and `afterSwap`, no returns-delta flag (mask 0xC0) | [`src/UnicaHook.sol:67`](src/UnicaHook.sol#L67) |
| **Invariant I1's gate**: `beforeSwap` refuses every sender but the router | [`src/UnicaHook.sol:88`](src/UnicaHook.sol#L88), the revert at [`:94`](src/UnicaHook.sol#L94) |
| The `afterSwap` observation (`afterSwapCount`), replaced by the receipt on day 3 | [`src/UnicaHook.sol:99`](src/UnicaHook.sol#L99), [`:45`](src/UnicaHook.sol#L45) |
| The router contract and its `Order` (the only source of recipient, amount, minimum, deadline) | [`src/UnicaSettlementRouter.sol:25`](src/UnicaSettlementRouter.sol#L25), [`:31`](src/UnicaSettlementRouter.sol#L31) |
| `createOrder` (writes the order) and `pay` (the payer's single call) | [`src/UnicaSettlementRouter.sol:85`](src/UnicaSettlementRouter.sol#L85), [`:116`](src/UnicaSettlementRouter.sol#L116) |
| **Invariant I5**: the order is consumed before the unlock | [`src/UnicaSettlementRouter.sol:125`](src/UnicaSettlementRouter.sol#L125) |
| The unlock callback: swap with only the order id as hook data (spec C1), refuse a partial fill (A13, I6), refuse output below the minimum (I3), settle, take to the registered recipient (I1) | [`src/UnicaSettlementRouter.sol:135`](src/UnicaSettlementRouter.sol#L135), [`:153`](src/UnicaSettlementRouter.sol#L153), [`:158`](src/UnicaSettlementRouter.sol#L158) |
| **Invariant I7**: `sync` for native immediately before the native `settle` | [`src/UnicaSettlementRouter.sol:169`](src/UnicaSettlementRouter.sol#L169) |
| T5 guard, asserted numerically before any deploy; the day-1 address shape now refused; the derived router address checked against where the router lands | [`test/UnicaHook.t.sol:39`](test/UnicaHook.t.sol#L39), [`:33`](test/UnicaHook.t.sol#L33), [`:49`](test/UnicaHook.t.sol#L49), [`:55`](test/UnicaHook.t.sol#L55), [`:70`](test/UnicaHook.t.sol#L70) |
| I1 negative: a swap from the official test router is refused with the hook's own error, wrapped by the PoolManager | [`test/UnicaHook.t.sol:79`](test/UnicaHook.t.sol#L79) |
| Reading permissions off the real runtime code | [`test/UnicaHook.t.sol:114`](test/UnicaHook.t.sol#L114) |
| I1 positive, fuzzed at 10,000; I5, I4, I3 and the partial fill, each asserting nothing moved | [`test/UnicaSettlementRouter.t.sol:32`](test/UnicaSettlementRouter.t.sol#L32), [`:56`](test/UnicaSettlementRouter.t.sol#L56), [`:71`](test/UnicaSettlementRouter.t.sol#L71), [`:81`](test/UnicaSettlementRouter.t.sol#L81), [`:104`](test/UnicaSettlementRouter.t.sol#L104), [`:120`](test/UnicaSettlementRouter.t.sol#L120) |
| I7 as four rows: the control, the trap, the defect, the invariant | [`test/I7NativeSettle.t.sol:41`](test/I7NativeSettle.t.sol#L41), [`:49`](test/I7NativeSettle.t.sol#L49), [`:57`](test/I7NativeSettle.t.sol#L57), [`:72`](test/I7NativeSettle.t.sol#L72) |
| The test base: Uniswap's official PoolManager bytecode etched at the canonical address, its 24,009-byte runtime asserted | [`test/utils/UnicaTestBase.sol:61`](test/utils/UnicaTestBase.sol#L61), [`:36`](test/utils/UnicaTestBase.sol#L36) |
| Deterministic salt mining and CREATE2 deploy; pool initialisation, seeding, and the proof swap (the day-1 scaffold's script, reworked for the gated hook before day 4) | [`script/LiveFire.s.sol:89`](script/LiveFire.s.sol#L89), [`:69`](script/LiveFire.s.sol#L69), [`:118`](script/LiveFire.s.sol#L118), [`:139`](script/LiveFire.s.sol#L139), [`:182`](script/LiveFire.s.sol#L182) |

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
make gate        # forge build && forge test && forge fmt --check; expect 25 tests passed, 0 failed
forge test -vv   # 25 tests; the fuzz tests print their run count (10,000)
make predict     # the hook address and salt this creation code lands on, before any deploy
```

Needs Foundry (`forge`, `cast`; `anvil` only for the fork rehearsal) and git. Nothing from
the author's machine is required; CI runs the same commands on a fresh clone of this
repository, without submodules, on every push.

Toolchain on the machine that produced the numbers in this file: forge/cast
`1.3.5-foundry-zksync-v0.1.9`, anvil `1.5.1-stable`. CI pins upstream Foundry v1.5.1.

## Proof: Ethereum Sepolia (chain id 11155111)

The pool is native ETH against Circle's USDC, a v4-only shape: `currency0 = address(0)`, no
wrapping. Every row names the rung it has reached and carries the command that re-proves it.
LIVE means mined on Ethereum Sepolia with status 1, read back from the chain before it was
written here. `RPC=https://ethereum-sepolia-rpc.publicnode.com` in the commands below.

| Item | Value | Rung | Re-verify |
|---|---|---|---|
| Hook | `0x23b46783709E4A94C229612bfA55580a6682c040`, salt `0x93fb`, flags `0x40` (afterSwap only), 6,051 bytes of runtime code | LIVE, [explorer](https://sepolia.etherscan.io/address/0x23b46783709E4A94C229612bfA55580a6682c040) | `cast code 0x23b46783709E4A94C229612bfA55580a6682c040 --rpc-url $RPC \| wc -c` prints 12105; `make predict` reproduces the address and salt |
| Deploy transaction | [`0x0171976a…b8da`](https://sepolia.etherscan.io/tx/0x0171976a8716d2084890d8cfa155924fcf7b315b03263f1015d6794cee34b8da), block 11635908, 1,392,115 gas, through the CREATE2 factory `0x4e59…956C` | LIVE | `cast receipt 0x0171976a8716d2084890d8cfa155924fcf7b315b03263f1015d6794cee34b8da --rpc-url $RPC --field status` prints `1` |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` (Uniswap's official Sepolia deployment) | LIVE | `cast call 0x23b46783709E4A94C229612bfA55580a6682c040 'poolManager()(address)' --rpc-url $RPC` prints it |
| Pool | ETH / USDC, fee 3000, spacing 60, id `0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7`, initialised at 2,500 USDC per ETH ([`sqrtPriceX96`](script/LiveFire.s.sol#L40) `3961408125713216879677197`) | LIVE, tx [`0xe7cc4bbc…f08b`](https://sepolia.etherscan.io/tx/0xe7cc4bbc094938ca3c74857d585f4e53cecc6161ae579e8838e11a32084df08b), 51,982 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' 0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7 --rpc-url $RPC` |
| Liquidity | 0.008 ETH + 19.999999 USDC, full range, liquidity `400000000000` | LIVE, approve [`0x7e56b7ca…3213`](https://sepolia.etherscan.io/tx/0x7e56b7ca63d2ccf0be66f73f2e728bf20de645581a8aba5de7f9e5fc103e3213) then seed [`0xb5356276…baae`](https://sepolia.etherscan.io/tx/0xb535627674e56b751d88335688021aa2cfc2e34dc6d749dc8f4a920da425baae), 257,782 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getLiquidity(bytes32)(uint128)' 0xaffd50d25121496e627f2d9574f160fee32829f04a945de1dbfea5af3668fde7 --rpc-url $RPC` prints 400000000000 |
| **The swap through the hook** | 0.001 ETH exact-input to 2.216294 USDC; the receipt carries the PoolManager's `Swap` event and the hook's `AfterSwapObserved(sender, poolId, delta)` with delta `-1000000000000000 / +2216294`; `afterSwapCount` went 0 to 1 | LIVE, tx [`0x6d580aef…06bf`](https://sepolia.etherscan.io/tx/0x6d580aef7b3d8848fcee555ab8cd7c28fa28c1abeb4d538455be349d0a8a06bf), block 11635908, 166,516 gas | `cast receipt 0x6d580aef7b3d8848fcee555ab8cd7c28fa28c1abeb4d538455be349d0a8a06bf --rpc-url $RPC --field status` prints `1`; `cast call 0x23b46783709E4A94C229612bfA55580a6682c040 'afterSwapCount()(uint256)' --rpc-url $RPC` prints `1`; `make readback-sepolia` prints all of the above |
| Broadcast record | [`broadcast/LiveFire.s.sol/11155111/run-latest.json`](broadcast/LiveFire.s.sol/11155111/run-latest.json): five transactions, five receipts, 1,923,832 gas, identical to the fork rehearsal | committed | `python3 -c "import json;r=json.load(open('broadcast/LiveFire.s.sol/11155111/run-latest.json'));print(len(r['receipts']),sorted(set(x['status'] for x in r['receipts'])))"` prints `5 ['0x1']` |
| Source verification | Etherscan: Source Code Verified, Exact Match, compiler v0.8.30+commit.73712a01, optimizer off, cancun. Sourcify: full match on creation and runtime, verified 2026-09-04T21:18:15Z | VERIFIED, [explorer](https://sepolia.etherscan.io/address/0x23b46783709E4A94C229612bfA55580a6682c040#code) | `curl -s https://sourcify.dev/server/v2/contract/11155111/0x23b46783709E4A94C229612bfA55580a6682c040` prints `"match":"match"`; `make verify-sepolia` re-submits |
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

- The hook gates on the router's address only; the order checks the spec places in the hook (I3, I4, I5) are enforced by the router today and reach the hook with the receipt on day 3.
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
