# Arc — official facts, and what they mean for UNICA

Every row is either **official** (a Circle- or Arc-published page, named) or **observed** (a
read-only RPC call made from this repository). Nothing here is remembered or inferred, and the
distinction is kept because the brief that commissioned it forbids repeating an unverified claim.

Retrieved 2026-09-08. Rows 1 and 2 were corrected twice on 2026-09-08; the row itself says how, because a
fact this repository got wrong twice is worth leaving visible.

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

1. **The same USDC is reported at TWO different scales on this one chain, at the same instant.**
   This is the row that breaks a naive port, and it is measured, not reasoned:

   | Interface | Call | Raw | Scale | USDC |
   |---|---|---|---|---|
   | native gas asset | `eth_getBalance(0x0)` | `865034306417121744253729820` | **18** | 865,034,306.4171218 |
   | ERC-20 contract | `balanceOf(0x0)` on `0x3600…0000` | `865034306417121` | **6** | 865,034,306.417121 |

   Same account, same block. They mirror exactly — `native // 10¹² == erc20_raw` — which is what
   makes the trap so quiet: both readings are *correct*, and neither is convertible to the other
   without knowing which interface produced it.

   Assume 18 for the ERC-20 amount and 865 million USDC reads as **0.000865**. Assume 6 for the
   native amount and it reads as **8.65 × 10²⁰**. Wrong by a factor of 10¹² in either direction,
   with no error raised anywhere.

   **The rule, therefore: an amount's scale is a property of the interface it was read from, never
   of the chain it was read on.** A native amount comes back 18-decimal because that is how every
   EVM carries `eth_getBalance` and `msg.value`. An ERC-20 amount's scale is whatever that
   contract's own `decimals()` returns and must be read from it. `integrations/arc-treasury/units.mjs`
   makes the two representations structurally non-interchangeable, so this cannot be got wrong by
   accident rather than merely being warned against.

   *Provenance of the token address:* `0x3600000000000000000000000000000000000000` comes from
   Circle's own SDK configuration, already recorded at `integrations/arc-nanopayments/protocol.mjs:45`
   in an earlier pass, and was then confirmed on chain here — **1798 bytes of code**,
   `decimals()` → `6`, `symbol()` → `"USDC"`. It has **not** been confirmed against an official
   Circle documentation page in this pass, so treat it as corroborated rather than officially
   sourced.

   *Two earlier versions of this row were wrong and both are worth recording.* The first said
   flatly "USDC is 18 decimals natively on Arc, not 6", which invites exactly the global inference
   that corrupts every ERC-20 amount. The second — written the same day — over-corrected to "on Arc
   there is not even an ERC-20 to ask for a scale", which is false: there is one, and it answers 6.
   The table above is the measurement that settles it.

2. **A system emitter at `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` logs all USDC Transfer
   events.** Observed: that address holds **0 bytes of code**, and `eth_call` of `decimals()`
   against it returns an **empty result**, not a number. It emits; it is not a contract to call,
   and it is not where a scale comes from — the ERC-20 in row 1 is. Any indexer built for Arc must
   subscribe to this emitter rather than to a token contract.
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
