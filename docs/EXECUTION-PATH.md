# EXECUTION PATH — the official Uniswap router, the hook, and the one thin contract between them

Decided 2026-09-04, evening, on the owner's binding architecture:

```
Application or sponsor adapter
        ↓
Official Uniswap execution path (Universal Router)
        ↓
UNICA hook
        ↓
Uniswap v4 PoolManager
        ↓
Atomic settlement receipt
```

**UNICA uses Uniswap's official routing stack where compatible. The settlement executor exists
only to enforce settlement-specific invariants the official router cannot currently express.**

The ten questions were answered from the code before the existing contract was renamed or
changed. Sources: the v4-periphery commit pinned by this tree (`7ebd04b`, 2025-10-23), the
v4-periphery commit the Universal Router pins on `main` (`07336f2`), the `Uniswap/universal-router`
repository on `main`, and the deployed routers on Ethereum Sepolia, all read on 2026-09-04
between 22:14 and 22:18 UTC.

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Does the Universal Router support the custom-hook v4 action sequence? | Yes. Command `V4_SWAP` (0x10) runs v4-periphery's `V4Router` actions: `SWAP_EXACT_IN_SINGLE` (0x06), `SETTLE` (0x0b), `TAKE` (0x0e), and their `_ALL` forms, on any `PoolKey` including one with a hook. If the PoolManager is already unlocked it runs the actions inside the caller's lock. | `universal-router/contracts/base/Dispatcher.sol` lines 297–306; `v4-periphery/src/libraries/Actions.sol`; `v4-periphery/src/V4Router.sol` `_handleAction` |
| 2 | Can it carry the required `hookData`? | Yes. `ExactInputSingleParams` carries `bytes hookData`, passed to `poolManager.swap`. | `v4-periphery/src/interfaces/IV4Router.sol` lines 18–24 |
| 3 | Which address does the hook observe as `sender`? | The Universal Router itself: `V4Router._swap` calls `poolManager.swap` from the router contract. The original caller is exposed by `msgSender()`, the documented `IMsgSender` pattern, live on both Sepolia deployments. | `V4Router.sol` line 156–162; `IMsgSender.sol`; `cast call 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b 'msgSender()(address)'` and the same on `0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468`, both answer |
| 4 | Can it bind payer, recipient, currencies, amount, minimum output, nonce, and deadline? | Partly. Amount, minimum, currencies, and the execute deadline are per-call parameters; Permit2 nonces cover ERC-20 payers. **It cannot bind the take recipient to anything but the caller's own encoding**: `TAKE` reads `recipient` from the action params and `TAKE_ALL` sends to `msgSender()`. It has no notion of an authenticated order. | `V4Router.sol` lines 60–75 (`_take(currency, _mapRecipient(recipient), …)`); `ActionConstants.sol` (`MSG_SENDER = address(1)`) |
| 5 | Can direct PoolManager access bypass the settlement rules? | No, whichever router is admitted: every `swap` on the pool reaches the hook's `beforeSwap`, which refuses any sender but the admitted path, and a direct caller of `PoolManager.swap` is its own `sender`. | `src/V4SettlementHook.sol` `_beforeSwap`; tested by `test_RevertWhen_SwapSenderIsNotTheOfficialRouter` and `test_RevertWhen_OfficialRouterIsDrivenByAStranger` |
| 6 | Do native ETH input and USDC output stay atomic? | Yes: one `execute`, one unlock, swap, settle, take, or the whole call reverts. | `Dispatcher.sol` V4_SWAP → `_executeActions`; `V4Router.sol` |
| 7 | Can partial fills be rejected under I6? | Not by the router: `V4Router` does not compare consumed input to requested input. The hook can: `afterSwap` receives the delta and reverts when `-amount0 != amountIn` of the order. | `V4Router.sol` (no such check); `src/V4SettlementHook.sol` `_afterSwap` (done the same night (see `docs/INVARIANTS.md`)) |
| 8 | Can I7's synchronisation be enforced? | Yes, by the official path itself: `DeltaResolver._settle` calls `poolManager.sync(currency)` before every settle, native included, in both the pinned commit and the router's pinned commit. (v4-core's *test* helper `CurrencySettler` still skips it; that is a separate, verified feedback item.) | `v4-periphery/src/base/DeltaResolver.sol` lines 38–48 at `7ebd04b` and at `07336f2` |
| 9 | Can the receipt be emitted exactly once with the required fields? | Yes, from the hook's `afterSwap`, which runs once per swap; the fields come from the order the hook reads through the order id in `hookData` and from the delta. | `src/V4SettlementHook.sol` (done the same night (see `docs/INVARIANTS.md`)), `docs/INVARIANTS.md` I2 |
| 10 | Do the Permit2 spender and the transaction target remain official Uniswap contracts? | With the Universal Router as the execution path, yes: the payer's Permit2 approval names the Universal Router and the swap transaction targets it. For native ETH there is no Permit2 leg. | `universal-router/contracts/modules/uniswap/v4/V4SwapRouter.sol` (`payOrPermit2Transfer`) |

## The decision

The official router satisfies 1, 2, 3, 5, 6, 8, 10 and half of 4. It cannot satisfy the other
half of 4 (recipient bound to an authenticated order, plus payer, amount, minimum, deadline and
replay as *one* verified thing) nor 7 (partial-fill refusal). Those are exactly the settlement
invariants of `specs/HOOK-SPEC.md` section 3, and they are enforced in two places:

- **`SettlementExecutor`** (the renamed `UnicaSettlementRouter`, narrowed): keeps the order
  registry, takes the payer's ETH, composes the Universal Router plan from the order (swap with
  only the order id as hook data, settle native, **take to the order's recipient**), and calls
  `UniversalRouter.execute`. It never calls the PoolManager. It performs no route discovery and
  is not a router.
- **`V4SettlementHook`**: admits a swap only when `sender` is the Universal Router **and**
  `IMsgSender(sender).msgSender()` is the executor; verifies the order in `beforeSwap` (exists,
  in flight, not expired, params match); verifies the fill and the minimum in `afterSwap`
  (I3, I6) and emits the receipt (I2). The hook is the second contract after the official path
  and the last word before the PoolManager.

What changed from day 2's first design, done the same night: the executor no longer unlocks the
PoolManager or settles; the official router does, and a test proves the executor has no unlock
callback at all. Later the same night, after the adversarial review: the executor is bound to
the hook (it takes the hook as its one constructor argument and refuses any pool the hook does
not guard), the hook derives the executor from that creation code plus its own address, the
executor verifies what the recipient actually received, and the hook refuses a second swap for
an order inside one transaction. What stayed: the order as the only source of who is paid, I5's in-flight
marking before any external call, and the four-row I7 test, now against a stand-in at the
router's address with the sync switchable, plus a fifth row against the real Universal Router
bytecode etched at its Sepolia address with a foreign settle leg before the native one. The
hook's runtime is 10,634 bytes with the order checks, the versioned receipt and the one-swap
guard in it — a recorded size, not a budget; this file sets no size budget. (This line read
10,302 until 2026-09-05. That number entered the tree in `0c3663c` on 2026-09-04, and two `src/`
commits landed after it — `6f99fe9`, refusing a pool that is not the settlement shape, and
`87f9eca`, refusing a settlement that would pay a contract on its own path. This file was edited
again afterwards and the figure was not carried forward. The live hook, a fresh `forge build`,
`docs/DEPLOYMENT.md`, `docs/versions/V1.md`, the README proof row and `docs/proof/verify-live.sh`
all say 10,634, and the chain is the arbiter.) The tests in `docs/INVARIANTS.md` run against hookmate's official PoolManager; the
gate, order-check and executor tests and row 5 of I7 run against the router's deployed bytecode,
while rows 1 to 4 of I7 run against a stand-in at the router's address, because the official
bytecode cannot have its defence switched off.

End to end, on 2026-09-04 night: `make rehearse` forked Sepolia with anvil, impersonated the
deployer, and ran all four stages against the deployed Universal Router at its real address:
the hook at its mined `0x20C0` address, then the executor bound to it at its derived address, the
pool initialised and seeded, one order for 0.001 ETH with a 1.5 USDC minimum paid through
`execute`, the hook's counter 0 to 1, the recipient credited 2.003660 USDC, seven transactions
at status 1, none broadcast; the readback showed `executor.HOOK` and `hook.SETTLEMENT_EXECUTOR`
naming each other. That is the compatibility claim this document makes: tested against the
deployed router on a fork, not yet live-fired. The live-fire is day 4. The fork record is
written under `.rehearsal/`, which is ignored on purpose; the numbers are quoted here and in
`docs/DEPLOYMENT.md` and are reproduced by `make rehearse`.

## The call path, as measured

From `forge test --match-test test_SettlementDeliversToTheRegisteredRecipient -vvvv` on
2026-09-04 night, against the deployed Universal Router runtime and hookmate's official
PoolManager bytecode; the fork rehearsal (`make rehearse`) ran the same path against the real
Sepolia contracts. This table is the trace, not the diagram.

| Question | Answer from the trace |
|---|---|
| Transaction target | `SettlementExecutor.pay(orderId)` with the order's amount as value |
| Universal Router involvement | the executor's one external call: `UniversalRouter.execute(0x10, [plan], deadline)` with the value forwarded |
| PoolManager caller | the Universal Router: `PoolManager.unlock(plan)`, then from `unlockCallback` the router calls `swap`, `sync(native)`, `settle{value}`, and `take` |
| Hook-observed `sender` | the Universal Router, in both `beforeSwap` and `afterSwap` |
| The executor's address, as the hook learns it | `IMsgSender(sender).msgSender()` on the router, compared with the address the hook derived at construction |
| Payer | `msg.sender` of `pay`, written to the order by the executor before the router is called; the hook reads it from the order |
| Recipient | `order.recipient`, encoded by the executor into the router's `TAKE` action; the trace shows `take(USDC, merchant, amount)` |
| Permit2 spender | none: the input is native ETH sent with the call; no Permit2 call appears in the trace |
| `hookData` producer and decoder | produced by `SettlementExecutor._plan` as `abi.encode(orderId)`; decoded by `V4SettlementHook._inFlightOrder`, which refuses any other length |
| Where order context is stored, consumed, cleared | stored in the executor's `_orders` mapping at `createOrder`; consumed by `pay` moving it to `Paying` before the external call and to `Settled` after; never deleted, the record stays readable |
| Liquidity operations | not gated: the hook has no liquidity callbacks, so anyone may add or remove liquidity through any route. The gate is on swaps |

The sentence the README uses follows this table: the hook admits a swap only when the
PoolManager reports the Universal Router as the sender and the router reports the executor as
its caller. It does not say the pool is usable only through the router, because liquidity is
not gated and the hook cannot see what it is not called for.

## Which Universal Router

The hook admits `UniversalRouterV2` at `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b`, the entry
the official deployments page lists as "Universal Router" for Ethereum Sepolia (19,540-byte
runtime, answers `msgSender()` and `poolManager()`, confirmed 2026-09-04). Sepolia carries other
Universal Router deployments, including one for permissioned pools; none is admitted here, and
an earlier draft of this section attributed permissioned-pool support to the wrong one of them,
which the prior-art sweep caught on chain. The router is resolved from the chain id, never a
constructor argument; other chains and routers are added only when verified there.

## What the official router leaves to the executor, in one sentence each

- The take recipient: caller-encoded in `TAKE`, so it must come from the executor's order.
- The payer: `msgSender()` names the executor; the human payer is recorded in the order by the
  executor before it calls the router, and the hook reads it from there.
- The partial fill: not checked by the router; refused by the hook from the delta.
- Replay and deadline as one thing: the router has a per-call deadline and Permit2 nonces, not an
  order that is paid at most once; the executor's in-flight flag and the hook's check provide it.
