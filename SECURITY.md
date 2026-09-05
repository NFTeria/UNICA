# SECURITY

UNICA is an MIT-licensed settlement hook and modular integration layer for Uniswap v4, built
during ETHOnline 2026. **It has not been audited. It is deployed on Ethereum Sepolia only, and it
should not hold value it cannot afford to lose.** This file states what is defended, how each
defence is proven, and what is not defended, so a reader can judge the posture rather than take
a claim on trust. It is dated and it is updated in the commit that changes a row.

Last reviewed 2026-09-05, against `main`, after an adversarial attack review whose two
exploitable findings are fixed and whose remaining findings are recorded in `docs/reviews/`.

## Reporting a vulnerability

Open a GitHub issue at <https://github.com/NFTeria/UNICA/issues> for anything already public, or
email `dev@nfteria.click` for anything that is not. There is no bug bounty. Testnet only, so no
funds are at risk; a report is still welcome and will be credited in this file.

## The trust boundary, in one paragraph

Two contracts are ours. `V4SettlementHook` runs inside Uniswap's PoolManager and decides whether
a swap on its pools is a settlement. `SettlementExecutor` holds the orders and composes one call
to Uniswap's official Universal Router. Everything else in the path is Uniswap's deployed code
and is trusted as such, not audited here: the PoolManager, the Universal Router, and Permit2.
The hook and the executor are bound to each other at construction and neither is configurable
afterwards. Neither has an owner, an upgrade path, a pause, or a way to move a balance that is
not part of a settlement in the same transaction.

## What is defended, and how it is proven

Every row names a test that runs in CI on every push. The rungs and the negative controls are in
[`docs/INVARIANTS.md`](docs/INVARIANTS.md); the threat analysis is
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md), written before the event and published unedited
in [`specs/`](specs/README.md).

| # | Property | The defence | Proven by |
|---|---|---|---|
| I1 | Output reaches only the registered recipient | the hook admits a swap only when the PoolManager reports Uniswap's Universal Router as the sender **and** the router reports the executor as its caller; the executor's plan takes the whole output to the order's recipient, and refuses an order naming a pool its hook does not guard or a router sentinel address as recipient | `test_RevertWhen_SwapSenderIsNotTheOfficialRouter`, `test_RevertWhen_OfficialRouterIsDrivenByAStranger`, `test_RevertWhen_OrderNamesAPoolTheHookDoesNotGuard`, `test_RevertWhen_RecipientIsARouterSentinel`, `test_SettlementDeliversToTheRegisteredRecipient`, fuzz 10,000 |
| I2 | One receipt per settlement, naming the order | emitted from inside the settling swap, after the fill checks; it survives only if the executor then confirms the recipient was paid | `test_ReceiptCarriesTheOrderAndTheStandardEvent`, `test/ReceiptSchema.t.sol` (five conformance tests) |
| I3 | The recipient gets at least the order's minimum | the hook checks the pool's credit against the order; the executor checks the recipient's actual balance change after the router returns | `test_RevertWhen_OutputBelowMinimum_NothingMoves`, `test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer` |
| I4 | No settlement past the deadline | checked by the executor and again by the hook from the order it reads itself | `test_RevertWhen_OrderExpired`, `test_RevertWhen_ExpiredOrderReachesTheHook` |
| I5 | One order settles at most once | the order leaves `Open` before any external call; the hook admits a swap only while it is `Paying`, and refuses a second swap for it in the same transaction through transient storage; ids are bound to chain, executor and creator | `test_RevertWhen_OrderPaidTwice`, `test_RevertWhen_OrderIsNotInFlight`, `test_RevertWhen_OrderIsSwappedTwiceInOnePlan`, `test_OrderIdsAreChainBoundCreatorBoundAndKnownInAdvance` |
| I6 | Never strand: a refused settlement moves nothing | revert-only, everywhere; a partial fill is refused rather than settled short | every refusal test asserts the payer's balance, the recipient's balance, the order's state and the receipt count are unchanged |
| I7 | Native settlement integrity | the official router syncs before every settle; the executor never holds a balance and has no `receive` | `test/I7NativeSettle.t.sol`, four rows against a switchable stand-in plus a fifth against the router's deployed bytecode |
| T5 | The permission bits match the declared permissions | the mask is asserted numerically off the real runtime code before any deploy, and v4's own `HookAddressNotValid` is the second control | `test_MinedAddress_MatchesDeclaredPermissions` and four others |
| T11 | No NoOp rug | designed out: no returns-delta permission, ever | `test_NoUndeclaredPermissionsCreepIn` asserts both flags false |
| T2 | No pool of an attacker's devising can carry this hook | `beforeInitialize` refuses any pool that is not native ETH against the chain's payout currency, so a receipt cannot be minted for output nobody sanctioned | `test/attack/HostilePool.t.sol`, four tests including the control that the sanctioned shape still settles from any caller |
| — | No settlement pays a contract on its own path | the router's two `TAKE` sentinels, the router, the executor, the hook and the PoolManager are all refused as recipients where the order is created | `test_RevertWhen_RecipientIsAContractOnThePath` walks all six |

## What is not defended

Stated plainly, because an unstated gap is the dangerous kind.

- **No audit.** No firm has reviewed this code. The adversarial reviews in
  [`docs/reviews/`](docs/reviews/) are machine-run, and their coverage is stated there, including
  where a vote did not complete.
- **The payout currency is one address per chain.** Spec C2 and C4 are enforced together: a pool
  carrying this hook is native ETH against that currency or it cannot be initialised. That is a
  defence, but it is also a limit: supporting another payout currency or another chain changes the
  hook's creation code, and so its address, and needs a new deployment.
- **No reentrancy test yet (threat T6).** The hook keeps no state between callbacks and the order
  is `Paying` for the duration of the call, so a reentrant payment meets its own state check.
  That is an argument, not a test, and it is listed as such in the threat model.
- **Untested threat rows.** T4 (delta sign conventions on both legs) and T12 (gas exhaustion)
  remain planned. T9 (dust and `clear()`) is defended by construction and untested.
- **The Universal Router is trusted.** UNICA's admission decision depends on
  `IMsgSender.msgSender()` being truthful. It is Uniswap's deployed contract, used as Uniswap's
  own guide prescribes, and it is not audited here.
- **The surface trusts its RPC and wallet.** [`web/`](web/README.md) is a read-and-send page; it
  holds nothing and signs nothing itself, but it shows what a public RPC tells it.
- **Sepolia only.** No mainnet deployment exists and none is planned during the event.

## Design choices that reduce the attack surface

- **No custody, ever.** Value passes through Uniswap's PoolManager and the official router; the
  executor holds a balance only within a single call and has no `receive`, so a stray transfer
  reverts. A test asserts the executor has no unlock callback at all.
- **No admin.** No owner, no roles, no pause, no upgrade, no configurable address. Both contracts
  take their addresses from the chain id or from CREATE2 derivation at construction.
- **No returns-delta permissions**, so the NoOp rug that the ecosystem's guidance calls the most
  dangerous hook capability is structurally impossible here.
- **Caller-supplied data authenticates nothing.** Hook data carries exactly one order id and any
  other length is refused; every term of the settlement is read from the executor's storage.
- **One compiler, pinned.** `solc 0.8.30`, `evm_version = cancun`, dependencies pinned by commit,
  and CI asserts the pin, both runtime sizes, and that the number of tests run equals the number
  the tree declares.

## Verifying this yourself

```sh
make gate                          # build, the full test suite with fuzz at 10,000, formatting
bash docs/proof/verify-day1.sh     # the day-1 scaffold, re-proved from the chain
bash docs/proof/verify-day4.sh     # the gated hook and its executor, re-proved from the chain
make readback                      # what the chain says now, including both bindings
```

Each verifier prints a stated count, `checks run: N, passed: N, failed: 0`, rather than a blank
panel, because an empty result and a broken reporter look identical.
