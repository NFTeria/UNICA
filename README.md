# UNICA

**UNICA is an MIT-licensed settlement hook and modular integration layer for Uniswap v4,
designed for applications and sponsor ecosystems to extend.** A payer pays in one currency, a
recipient receives another, atomically, through Uniswap's official Universal Router, into a pool
whose hook admits a swap only on that path and only for a registered order, with a versioned
receipt event. UNICA composes Uniswap v4 hooks and official execution infrastructure into a
verifiable settlement flow with enforceable order invariants and indexable receipts. Built from
scratch during ETHOnline 2026 by NFTeria. UNICA is a project, not affiliated with or endorsed by
Uniswap.

> The specification and threat model were written before the event; every line of code was
> written during it. Both pre-event documents ship unedited in [`specs/`](specs/README.md).

**Status, day 2 (2026-09-04, night):** the settlement runs through Uniswap's official Universal
Router, and the hook admits a swap only when the PoolManager reports that router as the sender
and the router reports the executor as its caller (invariant I1); the hook reads every term of
the order from the executor's storage and enforces it itself (I3, I4, I5), refuses a partial fill
or a short output (I3, and I6 by reverting), and emits the versioned receipt beside OpenZeppelin's
standard `HookFee` (I2); native settlement is proven as four rows against a switchable stand-in
plus a fifth against the official router's own bytecode (I7). A pool carrying this hook is native
ETH against the chain's payout currency or it cannot be initialised, so no pool of an attacker's
devising can mint a receipt (spec C2 and C4), and no settlement may pay a contract on its own path. Fifty-four tests, fuzz at 10,000,
against Uniswap's official PoolManager bytecode and, for the gate and order checks, the deployed
Universal Router runtime. The whole path was then rehearsed end to end on an anvil fork of Sepolia
against the deployed Universal Router: hook and executor at their mined and derived addresses and
bound to each other, pool initialised and seeded, one order paid with a 1.5 USDC minimum, one
receipt, seven transactions at status 1, nothing broadcast (`make rehearse`). An adversarial
review the same night found defects that reproduced; each is fixed with its own test and commit,
and the adjudication is in
[`docs/reviews/`](docs/reviews/2026-09-04-day2-adversarial-review.md). On chain, the day-1
scaffold hook keeps its record; the gated hook is mined fresh and live-fired on day 4. The surface
and the video are the next days' work. Nothing here is claimed past the rung it has reached.

## The problem

A business that settles customer payments in one asset, and a customer who wants to pay in
another, today need two transactions and a window in which someone holds an asset they did
not ask for. Uniswap v4 can put the exchange inside the settlement boundary, but a passive hook
cannot promise where the output lands: `PoolManager.swap()` has no recipient parameter, output
is credited to the router that called it, and the router chooses the recipient after
`afterSwap` has returned (spec section 2). So UNICA is **one thin executor plus a policy hook on
Uniswap's official router**: the executor composes the router's plan from a registered order, so
the output is taken to the order's recipient; the hook admits a swap only when it arrives from
that router with that executor as the router's caller, verifies every term of the order from
storage, and emits the receipt. That is the trace the tests and the fork rehearsal show:
`SettlementExecutor.pay` calls `UniversalRouter.execute`, the router unlocks the PoolManager, and
the hook sees the router as `sender` and the executor through `msgSender()`. Settlement hooks,
caller allowlisting, hook events, Universal Router execution, partial-fill controls and receipts
are each known concepts or prior art; what this repository offers is their tested composition.
Why the official router and not one of our own is answered question by question, with sources,
in [`docs/EXECUTION-PATH.md`](docs/EXECUTION-PATH.md). The receipt's layout is versioned in
[`docs/RECEIPT-SCHEMA.md`](docs/RECEIPT-SCHEMA.md).

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

The contract layout, and the partner seams built or not, are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The invariants land one slice at a time,
each with a negative test first; their rungs are in [`docs/INVARIANTS.md`](docs/INVARIANTS.md)
and the threats in [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## Where the code is (file and line, checked against this commit)

| What | Where |
|---|---|
| The hook contract | [`src/V4SettlementHook.sol:35`](src/V4SettlementHook.sol#L35) |
| The official router and the executor the hook trusts, both fixed at construction: the router from the chain id, the executor from its creation code plus this hook's address through the canonical CREATE2 factory, so the pair is bound both ways; nothing configurable after deploy | [`src/V4SettlementHook.sol:44`](src/V4SettlementHook.sol#L44), [`:48`](src/V4SettlementHook.sol#L48), [`:117`](src/V4SettlementHook.sol#L117), [`src/libraries/UniswapDeployments.sol:13`](src/libraries/UniswapDeployments.sol#L13), [`src/SettlementExecutor.sol:67`](src/SettlementExecutor.sol#L67) |
| The hook's zero-argument constructor resolving the PoolManager and the router from the chain id (spec section 7d); the executor's one argument, the hook | [`src/V4SettlementHook.sol:104`](src/V4SettlementHook.sol#L104), [`src/SettlementExecutor.sol:121`](src/SettlementExecutor.sol#L121) |
| Declared permissions, `beforeSwap` and `afterSwap`, no returns-delta flag (mask 0xC0) | [`src/V4SettlementHook.sol:126`](src/V4SettlementHook.sol#L126) |
| **Invariant I1's gate**: the sender is the Universal Router, and the router's `msgSender()` is the executor | [`src/V4SettlementHook.sol:167`](src/V4SettlementHook.sol#L167), [`:173`](src/V4SettlementHook.sol#L173), [`:175`](src/V4SettlementHook.sol#L175) |
| **Spec C2 and C4**: a pool carrying this hook is native ETH against the chain's payout currency or it cannot be initialised, so no pool of an attacker's devising can mint a receipt; the executor refuses such an order too, and no settlement may pay a contract on its own path | [`src/V4SettlementHook.sol:153`](src/V4SettlementHook.sol#L153), [`:157`](src/V4SettlementHook.sol#L157), [`src/libraries/UniswapDeployments.sol:24`](src/libraries/UniswapDeployments.sol#L24), [`src/SettlementExecutor.sol:151`](src/SettlementExecutor.sol#L151), [`:147`](src/SettlementExecutor.sol#L147) |
| The day-5 attack review's tests: the hostile pool refused, and every contract on the path refused as a recipient | [`test/attack/HostilePool.t.sol:35`](test/attack/HostilePool.t.sol#L35), [`:64`](test/attack/HostilePool.t.sol#L64), [`:93`](test/attack/HostilePool.t.sol#L93), [`test/SettlementExecutor.t.sol:335`](test/SettlementExecutor.t.sol#L335) |
| The order, read from the executor's storage and never from hook data: exactly one order id or malformed (spec C1), in flight (I5), unexpired (I4), the swap's direction, amount and pool are the order's (I3) | [`src/V4SettlementHook.sol:256`](src/V4SettlementHook.sol#L256), [`:261`](src/V4SettlementHook.sol#L261), [`:264`](src/V4SettlementHook.sol#L264), [`:179`](src/V4SettlementHook.sol#L179), [`:181`](src/V4SettlementHook.sol#L181), [`:183`](src/V4SettlementHook.sol#L183) |
| **Invariant I6** after the swap: the pool consumed the whole input, the output is at least the order's minimum, or the whole payment reverts | [`src/V4SettlementHook.sol:190`](src/V4SettlementHook.sol#L190), [`:198`](src/V4SettlementHook.sol#L198), [`:201`](src/V4SettlementHook.sol#L201) |
| **Invariant I2**: the receipt in schema v1 (order id, pool, recipient, version, payer, executor, currencies, amounts, fee, reserved policy id) and OpenZeppelin's standard `HookFee` beside it; the schema is documented in `docs/RECEIPT-SCHEMA.md` | [`src/V4SettlementHook.sol:232`](src/V4SettlementHook.sol#L232), [`:236`](src/V4SettlementHook.sol#L236), [`:250`](src/V4SettlementHook.sol#L250), [`:65`](src/V4SettlementHook.sol#L65), [`:58`](src/V4SettlementHook.sol#L58) |
| The executor, the one thin contract between an application and the official router: its `Order` (the only source of recipient, amount, minimum, deadline), `createOrder` (ids from creator and salt; only pools the hook guards; never a router sentinel as recipient), and `pay` (the payer's single call; exactly one receipt and the recipient's balance verified afterwards) | [`src/SettlementExecutor.sol:38`](src/SettlementExecutor.sol#L38), [`:53`](src/SettlementExecutor.sol#L53), [`:133`](src/SettlementExecutor.sol#L133), [`:149`](src/SettlementExecutor.sol#L149), [`:147`](src/SettlementExecutor.sol#L147), [`:181`](src/SettlementExecutor.sol#L181), [`:198`](src/SettlementExecutor.sol#L198), [`:205`](src/SettlementExecutor.sol#L205) |
| **Invariant I5** at the executor: the order leaves Open before any external call; at the hook: one swap per order per transaction | [`src/SettlementExecutor.sol:191`](src/SettlementExecutor.sol#L191), [`src/V4SettlementHook.sol:178`](src/V4SettlementHook.sol#L178), [`:223`](src/V4SettlementHook.sol#L223) |
| The plan the executor composes for the official router: swap with only the order id as hook data (spec C1), settle the native input, take the whole output to the order's recipient (I1); then one call to `execute` | [`src/SettlementExecutor.sol:215`](src/SettlementExecutor.sol#L215), [`:229`](src/SettlementExecutor.sol#L229), [`:233`](src/SettlementExecutor.sol#L233), [`:235`](src/SettlementExecutor.sol#L235), [`:196`](src/SettlementExecutor.sol#L196) |
| T5 guard, asserted numerically before any deploy; the day-1 address shape refused; the derived executor address checked against where the executor lands; the router checked against its deployed runtime | [`test/V4SettlementHook.t.sol:33`](test/V4SettlementHook.t.sol#L33), [`:45`](test/V4SettlementHook.t.sol#L45), [`:61`](test/V4SettlementHook.t.sol#L61), [`:67`](test/V4SettlementHook.t.sol#L67), [`:86`](test/V4SettlementHook.t.sol#L86), [`:102`](test/V4SettlementHook.t.sol#L102) |
| I1 negatives: a swap from the official test router is refused before the hook asks anyone anything; the official router driven by a stranger is refused with the stranger named, and the stranger keeps every wei | [`test/V4SettlementHook.t.sol:110`](test/V4SettlementHook.t.sol#L110), [`:125`](test/V4SettlementHook.t.sol#L125) |
| The hook's own order checks, reached through a harness at the executor's address that drives the official router with plans the real executor never composes, including two swaps for one order | [`test/V4SettlementHook.t.sol:155`](test/V4SettlementHook.t.sol#L155), [`:180`](test/V4SettlementHook.t.sol#L180), [`:201`](test/V4SettlementHook.t.sol#L201), [`:233`](test/V4SettlementHook.t.sol#L233), [`:217`](test/V4SettlementHook.t.sol#L217), [`:249`](test/V4SettlementHook.t.sol#L249), [`:270`](test/V4SettlementHook.t.sol#L270) |
| Reading permissions off the real runtime code | [`test/V4SettlementHook.t.sol:400`](test/V4SettlementHook.t.sol#L400) |
| I1 positive through the official router, fuzzed at 10,000; I2 with both events decoded field by field against schema v1; I5, I4, I6 and the partial fill, each asserting nothing moved; the executor's missing door to the PoolManager | [`test/SettlementExecutor.t.sol:42`](test/SettlementExecutor.t.sol#L42), [`:73`](test/SettlementExecutor.t.sol#L73), [`:103`](test/SettlementExecutor.t.sol#L103), [`:130`](test/SettlementExecutor.t.sol#L130), [`:148`](test/SettlementExecutor.t.sol#L148), [`:160`](test/SettlementExecutor.t.sol#L160), [`:184`](test/SettlementExecutor.t.sol#L184), [`:214`](test/SettlementExecutor.t.sol#L214), [`:258`](test/SettlementExecutor.t.sol#L258), [`:335`](test/SettlementExecutor.t.sol#L335), [`:278`](test/SettlementExecutor.t.sol#L278), [`:363`](test/SettlementExecutor.t.sol#L363), [`:348`](test/SettlementExecutor.t.sol#L348) |
| I7 as five rows: the control, the trap, the defect, the invariant, and the official router's own bytecode with a foreign settle leg before the native one | [`test/I7NativeSettle.t.sol:53`](test/I7NativeSettle.t.sol#L53), [`:61`](test/I7NativeSettle.t.sol#L61), [`:69`](test/I7NativeSettle.t.sol#L69), [`:99`](test/I7NativeSettle.t.sol#L99), [`:110`](test/I7NativeSettle.t.sol#L110) |
| The test base: Uniswap's official PoolManager bytecode etched at the canonical address, its 24,009-byte runtime asserted; the official Universal Router's deployed runtime etched at its Sepolia address, its keccak asserted | [`test/utils/SettlementTestBase.sol:78`](test/utils/SettlementTestBase.sol#L78), [`:42`](test/utils/SettlementTestBase.sol#L42), [`:116`](test/utils/SettlementTestBase.sol#L116), [`test/utils/artifacts/UniversalRouterV2Sepolia.sol:12`](test/utils/artifacts/UniversalRouterV2Sepolia.sol#L12) |
| The two harnesses: the executor with its plan made arbitrary, and a stand-in at the router's address with I7's defence switchable | [`test/utils/ExecutorHarness.sol:15`](test/utils/ExecutorHarness.sol#L15), [`test/utils/RouterHarness.sol:53`](test/utils/RouterHarness.sol#L53), [`:78`](test/utils/RouterHarness.sol#L78) |
| Deterministic salt mining and CREATE2 deploy, the executor at its derived address; pool initialisation, seeding, and the settlement stage (the day-1 scaffold's script, reworked for the gated hook before day 4) | [`script/LiveFire.s.sol:73`](script/LiveFire.s.sol#L73), [`:115`](script/LiveFire.s.sol#L115), [`:124`](script/LiveFire.s.sol#L124), [`:153`](script/LiveFire.s.sol#L153), [`:174`](script/LiveFire.s.sol#L174), [`:225`](script/LiveFire.s.sol#L225) |

## Uniswap dependencies

| Dependency | Pin | Used at |
|---|---|---|
| OpenZeppelin `uniswap-hooks` (`BaseHook`, `IHookEvents`) | v1.1.1, `bd5287c` | `src/V4SettlementHook.sol` |
| `v4-core` (through `uniswap-hooks`) | `d153b04` | `Hooks`, `PoolKey`, `Currency`, `BalanceDelta`, the wrapped-error shape the tests assert |
| `v4-periphery` (through `uniswap-hooks`) | `7ebd04b` | `IV4Router`, `Actions`, `ActionConstants` in the executor's plan; `IMsgSender` in the hook's gate; `HookMiner` in the deploy script |
| `hookmate` | `ef3e984` | `AddressConstants.getPoolManagerAddress(chainid)`; the official PoolManager initcode the tests deploy |
| PoolManager, Ethereum Sepolia | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | the constructor, the scripts, the local test topology |
| Universal Router (`UniversalRouterV2`), Ethereum Sepolia | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` | the only swap sender the hook admits and the executor's one call; its deployed runtime (19,540 bytes) is etched in the tests at this address |
| `PoolSwapTest`, `PoolModifyLiquidityTest`, `StateView`, Sepolia | `0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe`, `0x0C478023803a644c94c4CE1C1e7b9A087e411B0A`, `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C` | the day-1 seed and swap, the seeding stage, and the readback (the tests deploy their own copies of the two routers) |
| Permit2, Sepolia | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | not yet; the ERC-20 payer path |

All Sepolia addresses were read from the official v4 deployments page and confirmed to hold code
on 2026-09-04 (`cast code <addr> --rpc-url https://ethereum-sepolia-rpc.publicnode.com`).

## Setup, test, fuzz

```sh
git clone https://github.com/NFTeria/UNICA.git && cd UNICA
make deps        # fetches the pinned submodules (the v4 toolchain) and asserts the pin
make doctor      # says what is present, what is missing, and how to get it
make gate        # forge build && forge test && forge fmt --check; expect every test passed, 0 failed
forge test -vv   # the fuzz tests print their run count (10,000); CI asserts the count against the tree
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

### The gated hook, live: 2026-09-05

`V4SettlementHook` and `SettlementExecutor`, the current implementation, deployed from
`deploy-candidate-4` and settled from `deploy-candidate-5` (the settle stage's deadline changed in
between; nothing under `src/` did). Every row is read from the chain; `bash docs/proof/verify-live.sh`
re-proves all of them without trusting this file. `RPC=https://ethereum-sepolia-rpc.publicnode.com`.

Provenance: the tag `live-green` (commit `5e1d843`) identifies the reviewed live-contract state,
the records and the verifier as they were when the chain was read. This table and the evidence
index landed in the two commits after it (`4a67a5c`, `5417a0f`). The tag is not moved; the
documentation HEAD is whatever this file's commit is.

| Item | Value | Rung | Re-verify |
|---|---|---|---|
| Hook | `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`, salt `0xd76`, flags `0x20C0` (beforeInitialize, beforeSwap, afterSwap), 10,634 bytes of runtime code, zero-argument constructor | LIVE, [explorer](https://sepolia.etherscan.io/address/0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0) | `cast code 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 --rpc-url $RPC \| wc -c` prints 21271; `make predict` reproduces the address and salt |
| Executor | `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`, 11,289 bytes, constructor argument = the hook; the hook derives this address from the executor's creation code and names it, and the executor names the hook | LIVE, [explorer](https://sepolia.etherscan.io/address/0x044bc8a8773EC7b9B8de2467766636dFFCaC6210) | `cast call 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 'SETTLEMENT_EXECUTOR()(address)' --rpc-url $RPC` prints the executor; `cast call 0x044bc8a8773EC7b9B8de2467766636dFFCaC6210 'HOOK()(address)' --rpc-url $RPC` prints the hook |
| Deploy transactions | hook [`0xc76bc0a3…a014`](https://sepolia.etherscan.io/tx/0xc76bc0a3ef3cf659fc3c8eb0e76febd2006801b1e0e3fbca4f51bfea4108a014), 2,603,048 gas; executor [`0x8c067692…7ebb`](https://sepolia.etherscan.io/tx/0x8c06769270297e2794593dfc5084a628e31582492c135419535d3ddcb0c57ebb), 2,510,930 gas; both through the CREATE2 factory `0x4e59…956C`, block 11639895 | LIVE | `cast receipt 0xc76bc0a3ef3cf659fc3c8eb0e76febd2006801b1e0e3fbca4f51bfea4108a014 --rpc-url $RPC --field status` prints `1`, and the same for the executor's |
| Pool | native ETH / USDC, fee 3000, spacing 60, id `0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db` (keccak of the live key), initialised at 2,500 USDC per ETH (`sqrtPriceX96` `3961408125713216879677197`) | LIVE, tx [`0x8b07ff44…5858`](https://sepolia.etherscan.io/tx/0x8b07ff44f85dcb563255f3bdd03aefd052253e53c8b631a676beb3edb5ba5858), 56,966 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' 0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db --rpc-url $RPC` |
| Liquidity | full range, from what the deployer held (about 10 USDC against 0.004 ETH), liquidity `204325880000` | LIVE, approve [`0x5316bc41…1da1`](https://sepolia.etherscan.io/tx/0x5316bc41036e17cf6c2c74e44a6f651aedfdecc2547bb93a952861858f081da1) then seed [`0x7751ed3d…5be4`](https://sepolia.etherscan.io/tx/0x7751ed3d5f38075a7fac3c70c9466335dd2c8a797b0c9d1896ed2e99dd795be4), 259,843 gas | `cast call 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C 'getLiquidity(bytes32)(uint128)' 0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db --rpc-url $RPC` prints 204325880000 |
| The first settlement attempt | createOrder [`0xd4240fbd…c089`](https://sepolia.etherscan.io/tx/0xd4240fbde823a37ca484bbf90272e71fd6456277a7fe173ea4489acfc9cec089) and pay [`0xc78da1e9…4647`](https://sepolia.etherscan.io/tx/0xc78da1e9bcbed8ec6395e4790fcd417ef2242427850af19ad1733be95cd54647) failed in the deploy block: `DeadlineInPast`, a one-hour deadline computed during forge's simulation and aged out at the keystore prompt that follows it. Cause, fork reproduction and fix in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | FAILED, recorded as it happened | `cast receipt 0xd4240fbde823a37ca484bbf90272e71fd6456277a7fe173ea4489acfc9cec089 --rpc-url $RPC --field status` prints `0` |
| **The settlement through the hook** | order `0x72b25a9b…b8e9` for 0.001 ETH with a 1.5 USDC minimum, recipient = the deployer, created by [`0x51b6d094…1cef`](https://sepolia.etherscan.io/tx/0x51b6d094a9c31a99ffefec5e84f52d5c738e99e44b50dcbc64fbda14b9001cef) and paid by [`0x1120af18…cb83`](https://sepolia.etherscan.io/tx/0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83) through Uniswap's Universal Router. The hook's `SettlementReceipt` v1: `amountIn` 1000000000000000, `amountOut` 2003660, `fee` 0, beside OpenZeppelin's `HookFee`; the recipient's USDC grew by exactly 2.003660; `receiptCount` and `orderCount` 0 to 1; the order is Settled and a replay is refused | LIVE, block 11640026, 281,144 gas | `cast receipt 0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 --rpc-url $RPC --field status` prints `1`; `cast call 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 'receiptCount()(uint256)' --rpc-url $RPC` prints `1`; `make readback` prints all of the above |
| Broadcast records | deploy [`run-1788605617356.json`](broadcast/LiveFire.s.sol/11155111/run-1788605617356.json): seven transactions, five receipts (the two failures have none); settlement [`run-1788607248915.json`](broadcast/Interactions.s.sol/11155111/run-1788607248915.json): two transactions, two receipts. The labels the tool printed beside the hashes were shuffled in both; the rows above are from the receipts | committed | `bash docs/proof/verify-live.sh` reads both by hash |
| Source verification | Sourcify: `match` for both contracts, compiler v0.8.30+commit.73712a01, 2026-09-05 | VERIFIED | `curl -s https://sourcify.dev/server/v2/contract/11155111/0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` prints `"match"`, and the same for the executor; `make verify` re-submits |
| Re-verification script | [`docs/proof/verify-live.sh`](docs/proof/verify-live.sh): 31 pure reads, seen to fail on a fork before the settlement and pass after | 31 of 31 | `bash docs/proof/verify-live.sh` prints `checks run: 31, passed: 31, failed: 0` |

### Historical: the day-1 scaffold

> **Historical day-1 observation-only scaffold; not the current gated implementation.** The
> contract in these rows is `UnicaHook`, deployed and source-verified under that name on day 1
> with `afterSwap` only; it observed swaps and gated nothing. Its evidence is not rewritten. The
> current implementation, `V4SettlementHook` in `src/`, has its own rows above.

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
| Broadcast record | [`broadcast/LiveFire.s.sol/11155111/run-1788555540752.json`](broadcast/LiveFire.s.sol/11155111/run-1788555540752.json): five transactions, five receipts, 1,923,832 gas, identical to the fork rehearsal (the timestamped record; `run-latest.json` is rewritten by every later live run) | committed | `python3 -c "import json;r=json.load(open('broadcast/LiveFire.s.sol/11155111/run-1788555540752.json'));print(len(r['receipts']),sorted(set(x['status'] for x in r['receipts'])))"` prints `5 ['0x1']` |
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

## The receipt, indexed (optional; The Graph as one consumer)

The receipt is versioned and documented in [`docs/RECEIPT-SCHEMA.md`](docs/RECEIPT-SCHEMA.md)
and frozen as a conformance suite in [`test/ReceiptSchema.t.sol`](test/ReceiptSchema.t.sol).
[`integrations/graph/`](integrations/graph/) is one consumer of it: a subgraph whose data source
takes the hook address and start block from a per-network file, a handler that keys on schema
version one, three matchstick tests around a real local receipt, and a local end-to-end run.
Nothing in the settlement path depends on it; a hook whose receipts nobody indexes settles the
same. It claims no priority over other schemas; see `docs/INTEGRATIONS.md` for what was found.

One command reconstructs a settlement from its log, locally, with no credentials and nothing
broadcast (needs Docker, Node 22, and the pinned tooling installed by `npm install` in that
directory):

```sh
DEPLOYER=0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73 bash integrations/graph/local-e2e.sh
```

It forks Sepolia, deploys and seeds through the repository's own stages, brings up a pinned
graph-node against the fork, deploys the subgraph for that hook address, pays one order through
the executor and Uniswap's official router, and queries:

```graphql
{ settlements { orderId recipient amountIn amountOut hook executor schemaVersion transactionHash logIndex } }
```

Measured 2026-09-05: one `Settlement` entity, `amountIn` 1000000000000000, `amountOut` 2003660 in
real USDC, `hook` and `executor` equal to the deployment; then the same order paid again reverts
on chain and the count stays at one. What that proves: the receipt an indexer reads is the one
the hook emitted inside the settling swap, and a refused settlement leaves no entity. What it
does not prove: anything against a hosted Graph provider, which is the published bar for the
sponsor's track and an owner action not yet taken.

## Security limitations, stated

- The hook keeps no state between callbacks: `beforeSwap` and `afterSwap` each read the order
  from the executor, so a reentrant swap inside the unlock meets the same gate. The reentrancy
  test the spec asks for (T6) is not written yet.
- The executor is the security boundary on UNICA's side: no owner, no upgrade path, no
  `receive`, no access to the PoolManager, bound to one hook and accepting orders only for
  pools that hook guards. The Universal Router is Uniswap's deployment and is trusted as
  Uniswap's code, not audited here.
- The pool allowlist (spec C2) and the payout-asset allowlist (C4) are not implemented. An
  order's input is native ETH by construction; its output currency is whatever pool key the
  order names. A token that delivers less than the pool credited cannot settle an order short
  (the executor measures the recipient), but the allowlist remains the stronger answer.
- What the receipt proves: the order it names was paid through the official router by the
  executor, the pool consumed the whole input and credited at least the minimum, and the
  recipient's balance grew by at least the minimum in the same transaction, since the executor
  reverts otherwise. What it does not prove: anything about the recipient after that
  transaction, or the price the payer would have got elsewhere.
- No audit. Security posture will be scored against the Uniswap Foundation's self-directed
  framework in `SECURITY.md` on day 5.

## Provenance

Three things a judge needs to tell apart, in [`HACKATHON.md`](HACKATHON.md): the disclosed
pre-event specification and threat model in `specs/`; upstream open-source dependencies under
`lib/` with their own licences (v4-core arrives under BUSL-1.1 and is not relicensed; the
dependency layout follows the public `Uniswap/v4-template`, MIT, used as a starter kit and not
cloned); and the implementation written during the event. AI tooling assisted the build and
[`AI_USAGE.md`](AI_USAGE.md) says exactly where; no commit carries an AI co-author.

An earlier settlement-receipt hook by the same author, `Access0x1SwapReceiptHook` in the public
`Access0x1/Access0x1` repository (`src/uniswap/Access0x1SwapReceiptHook.sol`, live-fired on
Sepolia on 2026-08-17), is cited as prior art in the spec and was not copied: it observed and
receipted without gating, and UNICA inverts each of those choices. The admission mechanic
itself follows Uniswap's own guide "Access msg.sender Inside a Hook" and Uniswap Labs'
`PermissionedHooks`; the closest third-party works, what is and is not new, and the sweep's blind
spots are in [`docs/PRIOR-ART.md`](docs/PRIOR-ART.md). NFTeria's private `.click` product is the integrator this hook is designed for: it settles customer
payments and wants pay-in-X, receive-in-Y, atomically, with a receipt. The private product
never enters this repository.

Feedback for the Uniswap engineers who maintain the tools this is built on is captured the hour
it happens in [`FEEDBACK.md`](FEEDBACK.md).

## Licence

MIT, see [`LICENSE`](LICENSE). Dependencies keep their own.





