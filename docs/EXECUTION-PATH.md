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
| 5 | Can direct PoolManager access bypass the settlement rules? | No, whichever router is admitted: every `swap` on the pool reaches the hook's `beforeSwap`, which refuses any sender but the admitted path, and a direct caller of `PoolManager.swap` is its own `sender`. | `src/V4SettlementHook.sol` `_beforeSwap`; tested by `test_RevertWhen_SwapSenderIsNotTheRouter` |
| 6 | Do native ETH input and USDC output stay atomic? | Yes: one `execute`, one unlock, swap, settle, take, or the whole call reverts. | `Dispatcher.sol` V4_SWAP → `_executeActions`; `V4Router.sol` |
| 7 | Can partial fills be rejected under I6? | Not by the router: `V4Router` does not compare consumed input to requested input. The hook can: `afterSwap` receives the delta and reverts when `-amount0 != amountIn` of the order. | `V4Router.sol` (no such check); `src/V4SettlementHook.sol` `_afterSwap` (day 3) |
| 8 | Can I7's synchronisation be enforced? | Yes, by the official path itself: `DeltaResolver._settle` calls `poolManager.sync(currency)` before every settle, native included, in both the pinned commit and the router's pinned commit. (v4-core's *test* helper `CurrencySettler` still skips it; that is a separate, verified feedback item.) | `v4-periphery/src/base/DeltaResolver.sol` lines 38–48 at `7ebd04b` and at `07336f2` |
| 9 | Can the receipt be emitted exactly once with the required fields? | Yes, from the hook's `afterSwap`, which runs once per swap; the fields come from the order the hook reads through the order id in `hookData` and from the delta. | `src/V4SettlementHook.sol` (day 3), `docs/INVARIANTS.md` I2 |
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
callback at all. What stayed: the order as the only source of who is paid, I5's in-flight
marking before any external call, and the four-row I7 test, now against a stand-in at the
router's address with the sync switchable, plus a fifth row against the real Universal Router
bytecode etched at its Sepolia address with a foreign settle leg before the native one. The
hook's runtime is 9,981 bytes with the order checks and the versioned receipt in it. Every test named in
`docs/INVARIANTS.md` runs against that bytecode and hookmate's official PoolManager.

End to end, on 2026-09-04 night: `make rehearse` forked Sepolia with anvil, impersonated the
deployer, and ran all four stages against the deployed Universal Router at its real address:
the executor at its derived address, the hook at its mined `0xC0` address, the pool initialised
and seeded, one order for 0.001 ETH paid through `execute`, the hook's counter 0 to 1, the
recipient credited 2.003660 USDC, seven transactions at status 1, none broadcast. That is the
compatibility claim this document makes: tested against the deployed router on a fork, not yet
live-fired. The live-fire is day 4.

## Which Universal Router

Sepolia has two: `UniversalRouterV2` `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` (19,540-byte
runtime, the one the deployments page lists as "Universal Router") and `UniversalRouterV2_1_1`
`0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468` (24,546 bytes, adds permissioned-pool support).
Both answer `msgSender()` and `poolManager()`. The hook admits V2 today, resolved from the chain
id (never a constructor argument); other chains are added when verified there.

## What the official router leaves to the executor, in one sentence each

- The take recipient: caller-encoded in `TAKE`, so it must come from the executor's order.
- The payer: `msgSender()` names the executor; the human payer is recorded in the order by the
  executor before it calls the router, and the hook reads it from there.
- The partial fill: not checked by the router; refused by the hook from the delta.
- Replay and deadline as one thing: the router has a per-call deadline and Permit2 nonces, not an
  order that is paid at most once; the executor's in-flight flag and the hook's check provide it.
