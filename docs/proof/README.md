# docs/proof — the evidence, in the order a judge should read it

> **Historical day-1 observation-only scaffold; not the current gated implementation.** The contract
> in these captures is `UnicaHook` at `0x23b46783709E4A94C229612bfA55580a6682c040`, deployed and
> source-verified on 2026-09-04 under that name with `afterSwap` only. It observed swaps; it gated
> nothing. The current implementation is `V4SettlementHook` in `src/`; its proof is the second
> section below. Nothing in the first is rewritten.

Every image here is a capture of a public explorer page for a transaction or contract that
exists on Ethereum Sepolia (chain id 11155111). Nothing is mocked, simulated, or staged. The
script beside them re-proves the same facts from the chain, without trusting this repository:

```sh
bash docs/proof/verify-day1.sh        # 14 checks, pure reads; prints a count, never a colour
bash docs/proof/verify-live.sh        # 31 checks on the gated hook, its executor, the pool, both records and the settlement
```

## Day 1 — 2026-09-04 — a real swap through the hook on Uniswap's official Sepolia PoolManager

| # | File | What it shows | Re-verify |
|---|---|---|---|
| 01 | `01-swap-status-1.png` | The swap transaction `0x6d580aef…06bf` on Etherscan: Status Success, block 11635908, 0.001 ETH sent from the deployer to the official `PoolSwapTest` router, and the action line "Transfer 2.216294 USDC" back to the deployer | `cast receipt 0x6d580aef7b3d8848fcee555ab8cd7c28fa28c1abeb4d538455be349d0a8a06bf --rpc-url https://ethereum-sepolia-rpc.publicnode.com --json` |
| 02 | `02-swap-logs-pool-swap-event.png` | The same transaction's Logs tab: the PoolManager's `Swap` event with the pool id `0xaffd…fde7`, the router as sender, `amount0 = -1000000000000000`, `amount1 = 2216294`, the post-swap price and tick, liquidity `400000000000`, fee 3000 | same receipt, first log, topic `0x40e9cecb…` |
| 03 | `03-swap-logs-hook-event.png` | Further down the Logs tab: log 109 emitted by the hook itself at `0x23b4…c040`, decoded by the explorer from the verified source as `AfterSwapObserved(sender, poolId, delta)`, topic `0xc752fb7f…`, sender = the router, pool id, and the packed delta; then log 110, the USDC transfer of 2,216,294 units from the PoolManager to the deployer | same receipt, logs 109 and 110; `cast keccak 'AfterSwapObserved(address,bytes32,int256)'` |
| 04 | `04-hook-source-verified.png` | The hook's contract page: Source Code Verified, Exact Match, `UnicaHook`, compiler v0.8.30+commit.73712a01, optimizer off, cancun, creator = the deployer, 20 minutes after the swap | https://sepolia.etherscan.io/address/0x23b46783709E4A94C229612bfA55580a6682c040#code ; Sourcify full match: `curl -s https://sourcify.dev/server/v2/contract/11155111/0x23b46783709E4A94C229612bfA55580a6682c040` |

Captures were taken from a browser window holding only these pages; the browser's own
toolbar was cropped off. The explorer's cookie notice is visible at the foot of some images;
it was not dismissed on purpose, so nothing was accepted on the author's behalf.

## Live — 2026-09-05 — the gated hook settles one order through Uniswap's Universal Router

`V4SettlementHook` at `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` and `SettlementExecutor` at
`0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`. The deploy landed in block 11639895 and lost its
settlement to a deadline; the settlement landed in block 11640026 (`docs/DEPLOYMENT.md` has the
whole account). The rows are the README's; this index adds what a reader should open first.

| # | What | Where | Re-verify |
|---|---|---|---|
| L1 | The settlement transaction: status 1, 281,144 gas, five logs in order: the PoolManager's `Swap` with the Universal Router as sender, the hook's `SettlementReceipt` v1 and `HookFee`, USDC's `Transfer` of 2,003,660 units to the recipient, the executor's `Settled` | https://sepolia.etherscan.io/tx/0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 | `cast receipt 0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83 --rpc-url https://ethereum-sepolia-rpc.publicnode.com --json` |
| L2 | The receipt, decoded: order `0x72b25a9b…b8e9`, pool `0xff4f4e24…56db`, recipient and payer the deployer, executor, currencies native ETH in and USDC out, `amountIn` 1000000000000000, `amountOut` 2003660, `fee` 0, `policyId` 0 | the same transaction, the hook's log | `docs/RECEIPT-SCHEMA.md` gives the layout; `verify-live.sh` decodes it |
| L3 | Both sources verified on Sourcify (`match`), compiler v0.8.30 | https://sourcify.dev/server/v2/contract/11155111/0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0 and the executor's | `make verify` re-submits |
| L4 | The two failed transactions of the first attempt and why | https://sepolia.etherscan.io/tx/0xd4240fbde823a37ca484bbf90272e71fd6456277a7fe173ea4489acfc9cec089 | `cast receipt … --field status` prints 0; the cause is reproduced on a fork in `docs/DEPLOYMENT.md` |

### Captures, 2026-09-05, convenience evidence

Taken with headless Chrome at 1440 px wide with the browser's own real-time timeout; nothing was
clicked or accepted. They are a convenience layer over the authoritative reads above: a screenshot
proves nothing the RPC and the verifier do not already prove, and where a page would not render
headless there is no capture rather than a staged one.

| # | File | What it shows | Captured (UTC) | Authoritative equivalent |
|---|---|---|---|---|
| 05 | `05-hook-source-sourcify.png` | repo.sourcify.dev for the hook: Match, runtime and creation bytecode; `V4SettlementHook`, solc 0.8.30+commit.73712a01, cancun; verified at 2026-09-05 11:23:34; deployer, deployment tx `0xc76bc0a3…a014`, block 11639895; the source tree rendered | 11:58 | `curl -s https://sourcify.dev/server/v2/contract/11155111/0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` |
| 06 | `06-executor-source-sourcify.png` | the same for the executor: Match, `SettlementExecutor`, verified at 11:23:13, deployment tx `0x8c067692…7ebb`, block 11639895 | 11:58 | the same endpoint with the executor's address |
| 07 | `07-settlement-tx-blockscout.png` | eth-sepolia.blockscout.com, the settlement `0x1120af18…cb83`: "Swap 0.0010 ETH for 2 USDC", Status Success, method `pay`, block 11640026, from the deployer to `SettlementExecutor` (verified mark), token transfer PoolManager to the deployer of 2.00366 USDC, value 0.001 ETH, 281,144 gas | 12:02 | `verify-live.sh` rows 18 to 26 |
| 09 | `09-first-attempt-failed-blockscout.png` | the failed first attempt `0xd4240fbd…c089`: "failed to call createOrder on SettlementExecutor", Status Failed, block 11639895, 27,600 gas, no value | 12:02 | `cast receipt … --field status` prints 0; the revert is `DeadlineInPast`, decoded in `docs/DEPLOYMENT.md` |

No 08: the transaction's Logs tab renders only after a client-side fetch that headless Chrome
never completes (a skeleton at 30 s and at 60 s), and Etherscan serves a bot challenge to headless
browsers. The decoded logs are in `verify-live.sh` (receipt, HookFee, the Swap event's sender) and
pinned as the subgraph's fixture in `integrations/graph/tests/settlement.test.ts`.

## What is not here yet

The public surface (day 5) and the demo video (day 7) will add their own numbered images and rows
to this manifest when they exist; the settlement's Logs tab will, if a browser that renders it is
used by hand.
