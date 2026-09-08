# Arc — official facts, and what they mean for UNICA

Every row is either **official** (a Circle- or Arc-published page, named) or **observed** (a
read-only RPC call made from this repository). Nothing here is remembered or inferred, and the
distinction is kept because the brief that commissioned it forbids repeating an unverified claim.

Retrieved 2026-09-08.

## Network

| Fact | Value | Source |
|---|---|---|
| Status | **Testnet only** | official — `docs.arc.io/llms.txt`: *"Arc is currently available on Testnet only."* |
| Chain ID | **5042002** | official (`connect-to-arc`) **and** observed — `eth_chainId` → `0x4cef52` |
| RPC | `https://rpc.testnet.arc.io` (plus blockdaemon / drpc / quicknode variants) | official |
| Liveness | producing blocks — head `0x3a4dda1` (61,006,753) at retrieval | observed |
| Native gas asset | **USDC**, not ETH | official |
| Finality | sub-second, deterministic | official |
| EVM baseline | Osaka | official |
| Faucet | `faucet.circle.com` | official |
| CCTP domain | **26**, standard transfer supported | official — Circle CCTP supported-chains |
| Mainnet | **does not exist** | official (see Status) |

## The five Arc-specific behaviours that would break a naive port

From `docs.arc.io` — *"EVM differences is the canonical reference"*. These are not trivia; each one
would produce a wrong number or a silent failure in code written for Ethereum.

1. **USDC is 18 decimals natively on Arc, not 6.** UNICA's settlement paths, its fixtures and its
   verifier all assume 6. A port that reuses a 6-decimal assumption is off by a factor of 10¹².
2. **A system emitter at `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` logs all USDC Transfer
   events.** Observed: that address holds **0 bytes of code** — it emits, it is not a contract to
   call. Any indexer built for Arc must subscribe to it rather than to a token contract.
3. **The mempool enforces a 20 Gwei `maxFeePerGas` floor.** Observed: `eth_gasPrice` returned
   `0x4b0ff87d0` = 20.13 Gwei, consistent with the documented floor.
4. **Blocklist reverts consume gas without producing a receipt.** A "no receipt" is not the same as
   "not submitted" on Arc, which is exactly the case a settlement's error handling gets wrong.
5. **Sends to `address(0)` revert rather than succeed.**

## What UNICA may and may not claim

**May not.** That Uniswap is deployed on Arc — no official source in this retrieval says so, and
`App Kit` offering a "Swap" capability is Circle's own routing product, not a Uniswap deployment.
That Arc mainnet exists. That any UNICA contract runs on Arc. That CCTP or Gateway availability
implies a settlement path we have built.

**May, with evidence.** That Arc is a testnet-only, USDC-gas L1 whose CCTP domain is 26 and whose
chain ID is 5042002, both verified. That Circle publishes a documented CCTP path *to* Arc.

## The only coherent integration, and why

UNICA settles through Uniswap v4. Uniswap is not on Arc, and this project's standing ruling is that
Uniswap is its exclusive DEX — so **there is no swap path to build on Arc, and inventing one would
be the fake-swap the brief forbids.**

What *is* coherent is the leg that needs no DEX: a **USDC treasury action**. A merchant holding USDC
on Arc, a deterministic bounded policy decision, and a single permitted transfer — the same typed
action vocabulary the Chainlink confidential workflow already uses, on a chain where USDC is the
native asset and the gas.

That is the shape recorded here. Whether it is built is a separate decision; nothing in this
document claims it exists.

## Status

`ARC_RESEARCH_COMPLETE` — facts verified, no code written, no transaction prepared, nothing claimed.
Eligibility for any Arc track requires a working integration with a testnet transaction, and none
exists.
