# DEPLOYMENT — how the scripts behave, measured

What the `make` targets and scripts actually do, each behaviour with the command that shows it.
Written 2026-09-04 night from measured output; nothing here is a style claim. Testnet only:
mainnet is not a supported network anywhere in this repository.

## Network selection fails closed

One switch, `ARGS`. Three cases, and only three:

| `ARGS` | What runs | Measured |
|---|---|---|
| (none) | the local anvil fork of Sepolia: `--rpc-url http://127.0.0.1:8545 --unlocked --sender $DEPLOYER --broadcast`; impersonation, no signing, no real transaction | `make -n deploy DEPLOYER=<addr>` prints the fork command and the line `LOCAL FORK on …` |
| `--network sepolia` | Ethereum Sepolia with keystore signing: `--rpc-url $SEPOLIA_RPC_URL --account $DEPLOYER_ACCOUNT --sender $DEPLOYER --broadcast` | `make -n deploy ARGS="--network sepolia" DEPLOYER=<addr> DEPLOYER_ACCOUNT=<name>` prints `--account <name>` |
| any other `--network` | refused before any forge command: `unsupported network in ARGS="--network mainnet": only "--network sepolia" is supported (testnet only)`, exit 1 | `make deploy ARGS="--network mainnet" DEPLOYER=<addr>` stops with `make: *** [_need-network] Error 1` after printing that line. Before the fix in commit `fix(make): an unsupported --network fails closed` it fell through to the fork; that is why the branch exists |

Every network target also refuses to run without `DEPLOYER` (a public address), and the Sepolia
path without `DEPLOYER_ACCOUNT` (a keystore name). Values come from `.env` (never committed;
`.env.example` shows the shape) or the command line.

## Keystore signing, no key material

The Sepolia path signs with `forge script --account <name>`: forge opens the keystore under
`~/.foundry/keystores/<name>` and prompts for its password at run time. No private key, mnemonic,
or password appears in the repository, in `.env`, in the Makefile, in any script, or in any
log; the commands above show the only credential-shaped argument, the keystore *name*. The
optional `ETHERSCAN_API_KEY` is read from the environment and appended as
`--verify --etherscan-api-key …` only when set (measured: with it set the two flags appear,
without it they do not), so a run without the key still deploys and verifies on Sourcify later.

## Deterministic deployment

Both contracts deploy through the canonical CREATE2 factory
`0x4e59b44847b379578588920cA78FbF26c0B4956C`, so their addresses depend only on creation code,
constructor arguments, and salt:

- the hook has no constructor argument; its salt is mined at deploy time for the `0xC0`
  permission mask (`beforeSwap | afterSwap`) and asserted against the prediction; `make predict`
  prints the address and salt before any deploy, from the same arithmetic;
- the executor has one constructor argument, the hook's address, and uses salt `0` (the hook's
  `EXECUTOR_SALT`); the hook derives the executor's address in its own constructor from the
  executor's creation code plus `address(this)`, and the deploy stage deploys the hook first,
  then the executor, and asserts both the derivation and `executor.HOOK()`, or reverts.

There is no circular dependency: the executor's creation code embeds an interface, never the
hook's code; the hook's creation code embeds the executor's, and the hook's own address is known
to it at construction. Measured 2026-09-04 night, after the review fixes: the fork rehearsal
deployed the hook at `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` and the executor at
`0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`, both equal to their predictions, and the readback
showed each naming the other. The hook address changes with every edit of the hook or the
executor, which is why nothing is broadcast before the deploy day.

## Staged interactions

Four stages, each its own target, each runnable alone or in sequence, each idempotent where the
chain allows it (the deploy stage skips a contract that already has code; the pool stage skips
an initialised pool):

| Target | Script entry | Does |
|---|---|---|
| `make deploy` | `DeploySettlement` | executor at its derived address, then the hook at its mined salt; asserts both |
| `make init-pool` | `InitPool` | initialises the ETH/USDC pool with the hook at the configured price |
| `make seed` | `SeedLiquidity` | approves and adds liquidity sized to what the deployer holds above a floor |
| `make settle` | `Settle` | creates an order (id from the sender and `ORDER_SALT`, default `1`, computed before the call so the broadcast pays the id the simulation computed; a used salt is refused with a message) for 0.001 ETH with a 1.5 USDC minimum and pays it through the executor and the official router; asserts the receipt counter moved by one, the id matched, and the executor holds nothing |
| `make live` | `LiveFire` | all four in one run |
| `make rehearse` | `script/rehearse-anvil.sh` | all four on a throwaway anvil fork of Sepolia, impersonating the deployer, then a readback; broadcast artifacts under `.rehearsal/` (ignored), never `broadcast/`. Every local-mode target sets `FOUNDRY_BROADCAST=.rehearsal/broadcast` for the same reason: a fork carries the real chain id, and without it a local run would overwrite the committed day-1 record |
| `make readback` | `script/readback.sh` | pure reads: executor code, order count, `executor.HOOK` and `executor.UNIVERSAL_ROUTER`; hook code, receipt count, `hook.SETTLEMENT_EXECUTOR`; pool id, slot0, liquidity. The two bindings must name each other |
| `make verify` | `script/verify.sh` | source verification of both contracts on Sourcify, and on Etherscan when the key is set; picks the artifact whose runtime matches the chain outside the immutables |

Measured 2026-09-04 night on the fork, after the review fixes: seven transactions, all status 1,
receipt counter 0 to 1, 2.003660 USDC to the recipient for 0.001 ETH against a 1.5 USDC minimum.

## Sizes

| Contract | Runtime bytes | EIP-170 headroom |
|---|---|---|
| `V4SettlementHook` | 10,634 | 13,942 |
| `SettlementExecutor` | 11,289 | 13,287 |

Re-verify: `forge inspect src/V4SettlementHook.sol:V4SettlementHook deployedBytecode | wc -c`
(divide by two, minus one for the `0x`). CI asserts both stay under 24,576.

## Compiler

`foundry.toml` pins `solc_version = "0.8.30"`, `evm_version = "cancun"`, `via_ir = false`; the
fuzz count is 10,000. The tests deploy Uniswap's official PoolManager bytecode from hookmate's
artifact and the deployed Universal Router runtime from `test/utils/artifacts/`, so one compiler
serves tests, scripts, and verification.

## The live deploy, 2026-09-05

`make go-live` broadcast seven transactions in block 11639895 from nonce 450. Five landed and two
failed. Read from the chain by hash, in nonce order:

| nonce | to | what | status |
|---|---|---|---|
| 450 | CREATE2 factory | `V4SettlementHook` at `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`, 10,634 bytes | landed |
| 451 | CREATE2 factory | `SettlementExecutor` at `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`, 11,289 bytes | landed |
| 452 | PoolManager | `initialize`, native ETH / USDC, fee 3000, spacing 60, 2,500 USDC per ETH | landed |
| 453 | USDC | `approve` for the liquidity router | landed |
| 454 | liquidity router | `modifyLiquidity`, the seed | landed |
| 455 | executor | `createOrder` | **failed**, `DeadlineInPast` |
| 456 | executor | `pay` | **failed**, no order to pay |

The cause, measured: forge simulates the whole run before it asks for the keystore password, and
the script computed the order's deadline as `block.timestamp + 1 hours` during that simulation, which
put the deadline at 06:31 UTC, one hour after the simulation ran. The prompt was answered later and the block was mined at 10:53 UTC, 15,708 seconds past
the deadline. The simulation had passed; the chain refused. Reproduced on a fork of the chain with
Anvil's next-block timestamp: the old deadline fails under a five-hour gap and passes without one,
the day-long deadline (`ORDER_DEADLINE`, `script/LiveFire.s.sol`) passes under both.

Two more things the run taught. The console labels the toolchain printed beside the transaction
hashes did not match the transactions (a `pay` label beside the hash of the USDC approve); the
receipts, read by hash, are the record. And the first verifier held the pool id as a constant that
named a pool which did not exist, so it reported the seeded pool as uninitialised; it now derives
the id from the live key and was seen to fail, then pass, on a fork.

**Finishing it.** The contracts are live and are never redeployed; `make go-live` now stops at its
own pre-flight because the targets have code, which is correct. The missing stage runs alone:

```sh
make settle-check     # the pre-flight: frozen code, live contracts, seeded pool, unused order id
make settle-live      # the same, then createOrder + pay on Sepolia; answer the keystore prompt within the day
make readback && make proof && make verify && make proof
```

`verify-live.sh` runs 31 checks. Before the settlement, on a fork of the chain as it stood, the
deploy rows passed and the settlement rows failed (its control); after a fork settlement every row
passed except the two Sourcify rows, which pass on Sepolia once `make verify` has run.

**Settled, 2026-09-05 11:20:48 UTC.** `make settle-live` from `deploy-candidate-5`: createOrder at
nonce 457 and pay at nonce 458, both in block 11640026, both status 1. The receipt carries
`amountOut` 2,003,660 and the deployer's USDC grew by exactly that; `receiptCount` and `orderCount`
went 0 to 1; both sources are `match` on Sourcify; `verify-live.sh` prints 31 of 31. Closing tag
`live-green` at commit `5e1d843`: the reviewed live-contract state, the records and the verifier.
The README's proof rows and the evidence index were committed after the tag (`4a67a5c`, `5417a0f`);
the tag was not moved for them. Read the tag for what was reviewed, HEAD for how it is described.

## Protecting the live pool

The hook admits swaps in one direction only: native ETH in, USDC out, through the executor and the
Universal Router. Nothing can move the pool's price back up. Every settlement lowers the USDC per
ETH the next one pays, and the pool's USDC is a reservoir that only new liquidity refills. That is
a property of a settlement pool, not a defect, and it sets what a demo can promise.

Measured on a fork of the live pool, 2026-09-05, settling 0.001 ETH repeatedly with a minimum of
one unit so that every settlement lands and the outputs can be read:

| Pool | Liquidity | Settlements paying at least 1.5 USDC | at least 1.0 | at least 0.5 | Outputs, USDC |
|---|---|---|---|---|---|
| as it stands, price 1,615 USDC/ETH | 204,325,880,000 | 0 | 1 | 4 | 1.347, 0.967, 0.728, 0.568, 0.456 |
| after one 20 USDC top-up at that price | 701,915,084,069 | 1 | 5 | 14 | 1.524, 1.368, 1.234, 1.120, 1.020, 0.933, 0.857, 0.790, 0.730, 0.677, 0.630, 0.587, 0.549, 0.514, 0.482 |

Two consequences. The script's own settle stage, whose order asks for 1.5 USDC, is done: it proved
the path once and a second run would be refused by the hook with `OutputBelowMinimum`, which is
the invariant, not a failure. The public surface must therefore derive each demo order's minimum
from a live quote and disable itself when the quote is too small, rather than promise a fixed
amount; it does (`web/README.md`).

**The bounded top-up, prepared and not broadcast.** Stage 5, `topup()` in `script/LiveFire.s.sol`,
adds full-range liquidity at the pool's current price to the position the seed stage opened.

| Field | Value |
|---|---|
| USDC added | what the deployer holds, capped at 20 USDC, floor 5 USDC (the deployer holds 2.00 USDC now, so the stage refuses until a faucet round lands) |
| ETH leg | computed from the USDC leg at the current price, capped at 0.02 ETH; the router refunds the rest. At 1,615 USDC/ETH and 20 USDC: 0.012379750800313461 ETH |
| Expected liquidity after | printed by `planTopup()` before anything is signed; on the fork 701,915,084,069 for 20 USDC, and the stage refuses if the chain's result differs from the plan |
| Tick range | full range, ticks -887,220 to 887,220 |
| Position | the seed stage's, held by Uniswap's `PoolModifyLiquidityTest` router (salt 0). On that testnet router anyone may withdraw it: testnet money, nothing else |
| Recipient / owner | no recipient; the deployer pays both legs |
| Maximum exposure | 0.02 ETH plus about 0.0004 ETH of gas, and the USDC budget |
| Transactions | two: `approve` of the exact USDC budget, then `modifyLiquidity` |
| Minimum demo settlements after | 14 at 0.5 USDC or more, 5 at 1.0 or more, from the table above |
| Refusals | wrong chain; HEAD not `deploy-candidate-6` or a dirty tree; the contracts not at their sizes or not naming each other; pool uninitialised or unseeded; price above the opening 2,500 or below 1,000 USDC/ETH; deployer below 5 USDC or below the ETH leg plus gas; and, after the broadcast, liquidity not equal to the plan |

Controls seen on the fork: the stage stopped at the USDC floor with the deployer's real balance;
with 20 USDC it added exactly the planned liquidity and left 2.00366 USDC, the settlement's proceeds.

```sh
make topup-check     # the pre-flight and the plan; sends nothing
make topup-live      # after the owner's approval and a faucet round: the two transactions
make readback && make proof   # liquidity must equal the plan's "liquidity after"; the verifier must stay all green
```
