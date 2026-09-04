# docs/proof — the evidence, in the order a judge should read it

Every image here is a capture of a public explorer page for a transaction or contract that
exists on Ethereum Sepolia (chain id 11155111). Nothing is mocked, simulated, or staged. The
script beside them re-proves the same facts from the chain, without trusting this repository:

```sh
bash docs/proof/verify-day1.sh        # 14 checks, pure reads; prints a count, never a colour
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

## What is not here yet

The public surface (day 5) and the demo video (day 7) will add their own numbered images
and rows to this manifest when they exist.
