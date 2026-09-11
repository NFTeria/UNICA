# Nano/micropayments economics — Arc, x402, and UNICA settlement

Scope: this file prices out very small USDC/EURC payments ($0.001, $0.01, $0.10, $1.00) against
three settlement models, using Arc testnet as the measured chain and x402 as the measured
authorization protocol. It does not claim a UNICA-on-Arc deployment exists — none does (see
`docs/ARC-FACTS.md`, a repository note, not a source for this file's facts). Every number below is
either **MEASURED** (a keyless, read-only RPC call made directly for this document, dated
2026-09-11), **OFFICIAL** (a quoted sentence or JSON value from a named primary source, retrieved
2026-09-11), or **ESTIMATE** (a standard EVM gas figure or a derived calculation, labeled as such
inline). Anything not clearing that bar is **UNKNOWN**.

UNICA context binding on this file: UNICA's own fee is fixed at 0 in the beta (project decision,
not an external fact — no citation needed or claimed). A same-asset USDC payment is never forced
through a swap. Uniswap v4 is not deployed on Arc, so any "swap cost" row below is a general Uniswap
v4 figure for a cross-currency leg (e.g. USDC↔EURC), priced independently of Arc, never presented as
something running on Arc today.

## 1. What "nano" and "micro" mean here, precisely

There is no standards-body definition, so this file fixes one for internal consistency:

| Term | Range used in this file | Why the line is there |
|---|---|---|
| **Nanopayment** | below $0.01 | below the point where a single on-chain settlement's own gas cost is reliably smaller than the payment (see §13) |
| **Micropayment** | $0.01 – $1.00 | above the nano floor, but still small enough that a naive "one payment, one transaction" design is questionable |
| **Ordinary payment** | above $1.00 | flat network-fee overhead is a small fraction of the amount under nearly any gas-price regime this file measured |

The four amounts priced in this file — $0.001, $0.01, $0.10, $1.00 — sit at the nano floor, the
nano/micro boundary, mid-micro, and the ordinary floor respectively. That spacing is deliberate in
what follows: it lets one gas measurement answer all four questions, because the network fee for a
given settlement call is **flat in gas terms** — it does not scale with the dollar amount moved. The
entire economic problem this file describes is exactly that mismatch.

Two properties distinguish a real nanopayment system from "a normal payment for a small amount":

1. **The fee floor is not proportional to value.** A $0.30 swap fee on Uniswap and on a $1 trade is
   the same percentage; a $0.002 flat gas cost on a $0.001 payment and a $1.00 payment is not — it
   is 200% in one case and 0.2% in the other. Percentage-based reasoning (LP fee, x402 percentage
   facilitator fees) and flat reasoning (gas, the $0.05 Circle forwarding fee) have to be tracked
   separately, and mixed together they are the whole of §13.
2. **The unit of settlement is usually not the unit of value transfer.** A single on-chain
   transaction is expected to represent many nanopayments (a batch, a channel update, an escrow
   deduction), not one. §9 and §12 below are about exactly this: which layer produces a receipt,
   and whether "payment" and "transaction" are even the same event.

## 2. Arc testnet gas, measured directly (2026-09-11, keyless public RPC)

Every row below is a live `eth_call`/JSON-RPC read against `https://rpc.testnet.arc.io` — the
endpoint `docs.arc.io` names as Arc's public RPC — made independently for this document rather than
carried over from any repository note.

| Read | Result | Decoded |
|---|---|---|
| `eth_chainId` | `0x4cef52` | **5,042,002** — matches Arc's published testnet chain id |
| `eth_blockNumber` | `0x3ac2fb7` | block 61,616,055 |
| `eth_gasPrice` | `0x51f4d5c00` | **22,000,000,000 wei = 22 Gwei** |
| latest block `baseFeePerGas` | `0x4a817c800` | **20,000,000,000 wei = 20 Gwei**, exactly — consistent with `docs.arc.io`'s documented 20 Gwei `maxFeePerGas` floor |
| `eth_maxPriorityFeePerGas` | `0x77359400` | **2,000,000,000 wei = 2 Gwei** |
| latest block `gasLimit` / `gasUsed` | `0x1c9c380` / `0xb0634` | 30,000,000 limit; 722,484 used — the chain is a live, moderately loaded network, not idle |
| USDC ERC-20 at `0x3600…0000`, `decimals()` | `…0006` | **6** decimals, re-verified directly, not assumed |
| same contract, `symbol()` | ABI-encoded string | **"USDC"** |
| same contract, `eth_getCode` length | 1798 bytes | a real deployed contract, not an EOA |

Two facts from this table drive every dollar figure in §4–§13:

- **Arc's native gas asset is USDC itself**, at a 1:1 USD peg by USDC's own design (Circle's
  standing representation of the token, not a per-chain claim). Gas price in Gwei converts to a
  USD gas cost with **no separate price oracle and no ETH/USD step** — a rate other EVM chains all
  need and Arc structurally does not. `cost_USD = gas_units × gas_price_Gwei × 10⁻⁹`.
- **20 Gwei is a documented network floor, not a spot price that can fall further.** The 22 Gwei
  `eth_gasPrice` observed here is the floor plus a 2 Gwei tip; a transaction submitted at exactly
  the floor with no tip is the cheapest inclusion Arc testnet currently allows, and that floor —
  not some lower "if gas were cheap" number — is the honest baseline for every calculation below.

Gas-unit figures for specific EVM operations (transfer, authorization, swap) are **not** read from
Arc directly as of 2026-09-11 — no funded signer was used, and `eth_estimateGas` against the USDC
contract with an unfunded `from` returns a revert (`"ERC20: transfer from the zero address"`) rather
than a usable gas number. Every gas-unit figure in §4 is therefore an **ESTIMATE**, built from
standard, well-documented EVM opcode costs — Arc's EVM baseline is the Osaka fork per `docs.arc.io`,
so the same opcode gas schedule applies as on Ethereum mainnet — multiplied by the MEASURED price
above. That distinction (measured price × estimated gas-units) is kept explicit in every row.

## 3. The fee waterfall — what each line item actually is

Eight cost components apply per payment. Defined once here, applied per-amount in §4:

| Component | Definition | Applies when |
|---|---|---|
| **Network fee** | `gas units × gas price`, paid to Arc validators, in the native USDC gas asset | every on-chain transaction, always |
| **Token transfer cost** | the ERC-20-level cost of moving USDC/EURC balance — usually *part of* the network fee, not separate, unless a bare transfer is followed by a second, separate transfer | folded into network fee for `transferWithAuthorization`; separate for approve-then-transferFrom |
| **Swap cost** | the gas of a Uniswap v4 swap call | only when payer and merchant hold different currencies (§10) — never for same-asset USDC→USDC |
| **LP fee** | the swap-fee percentage a Uniswap v4 pool charges, accruing to liquidity providers | only alongside a swap cost |
| **UNICA fee** | this project's own protocol fee | **0, fixed, project decision** — no calculation needed anywhere below |
| **x402 facilitator fee** | whatever the facilitator running `/verify` and `/settle` charges | protocol-silent (§7); commercial, set by the facilitator, not by x402 itself |
| **Relayer/paymaster fee** | a premium a third party charges for fronting gas or submitting on a payer's behalf | only in Models B/C, or Model A with sponsored gas; no official Arc/x402/Circle rate found — **UNKNOWN**, flagged per-row |
| **Merchant receipt** | amount received minus every fee actually deducted from the merchant's side | the bottom line of §4's tables |

x402's specification does not define a facilitator fee model at all: fetched from
`github.com/coinbase/x402`, `specs/x402-specification-v2.md` (retrieved 2026-09-11), the facilitator
role covers "payment verification and blockchain settlement" with no fee schema — facilitator
pricing is commercial and off-protocol. One observed third-party facilitator implementation (not the
x402-foundation/coinbase spec itself) hardcodes a `FEE_BPS_DEFAULT` of 100 (1%) as an example
configuration value; that is evidence a facilitator *can* charge a percentage fee, not that x402
*requires* one, and it is not Circle's or any official facilitator's published rate.

## 4. Model A — every payment on-chain, priced per amount

Model A means: one payer signature, one broadcast transaction, one on-chain settlement, per
payment — the naive design. Two on-chain call shapes matter for the network-fee row:

- **EIP-3009 `transferWithAuthorization`/`receiveWithAuthorization`** — the call x402's "exact"
  EVM scheme and Circle Gateway both use (`eips.ethereum.org/EIPS/eip-3009`, and
  `github.com/circlefin/stablecoin-evm`, `contracts/v2/EIP3009.sol`, retrieved 2026-09-11, confirm
  USDC implements both entry points; EURC implements `transferWithAuthorization` natively per
  Circle's own EURC materials). One call moves the balance **and** consumes the payer's signed
  authorization — no separate `approve()` transaction, ever, for any payment. Gas: **ESTIMATE
  80,000–100,000** (a plain ERC-20 transfer is ~50,000–65,000; EIP-3009 adds ECDSA recovery plus a
  cold nonce-bitmap write on top of that base). Midpoint used below: **90,000 gas**.
- **Plain ERC-20 `approve()` + `transferFrom()`** — the older two-transaction pattern. `approve()`
  alone is a well-known **ESTIMATE ~46,000 gas**; a Permit2 one-time approval costs the same
  ~46,000 gas but only once per payer→spender relationship, not once per payment
  (`developers.uniswap.org/docs/protocols/permit2/overview`, retrieved 2026-09-11: the Permit2
  signature step itself "is an off-chain signed message… and therefore incurs no gas").

At Arc's MEASURED 22 Gwei (§2), and at the 20 Gwei floor for comparison:

| Amount | Network fee (90k gas, EIP-3009) | Network fee (60k gas, plain transfer, warm) | As % of payment (22 Gwei) |
|---|---|---|---|
| $0.001 | $0.00198 (22 Gwei) / $0.0018 (20 Gwei) | $0.00132 / $0.0012 | **198%** |
| $0.01 | $0.00198 / $0.0018 | $0.00132 / $0.0012 | **19.8%** |
| $0.10 | $0.00198 / $0.0018 | $0.00132 / $0.0012 | **1.98%** |
| $1.00 | $0.00198 / $0.0018 | $0.00132 / $0.0012 | **0.198%** |

The network fee is **the same absolute number at every payment size** — that flatness is the whole
of §1's point, made concrete. For each amount, holding everything else at the values fixed in §3:

| Line item | $0.001 | $0.01 | $0.10 | $1.00 |
|---|---|---|---|---|
| Network fee (EIP-3009, 22 Gwei) | $0.00198 | $0.00198 | $0.00198 | $0.00198 |
| Token transfer cost | included above | included above | included above | included above |
| Swap cost (same-asset — none) | $0 | $0 | $0 | $0 |
| LP fee (no swap) | $0 | $0 | $0 | $0 |
| UNICA fee | $0 | $0 | $0 | $0 |
| x402 facilitator fee | commercial, UNKNOWN (§3) | UNKNOWN | UNKNOWN | UNKNOWN |
| Relayer/paymaster fee | UNKNOWN, only if used | UNKNOWN | UNKNOWN | UNKNOWN |
| **Merchant receipt (gas only, payer bears gas)** | **$0.001** | **$0.01** | **$0.10** | **$1.00** |
| **Merchant receipt (gas only, merchant bears gas)** | **−$0.00098** | **$0.00802** | **$0.09802** | **$0.99802** |
| **Total value destroyed vs. payment, if merchant bears gas** | **198%** | **19.8%** | **1.98%** | **0.198%** |

Reading the "merchant bears gas" row is the point: at $0.001 the merchant does not merely earn a
thin margin, it **loses money on every single payment processed**, before any facilitator or
relayer fee is even added. This is Circle's own stated motivation for batching, not this document's
invention: "Even on low-cost blockchains, fees for a $0.0001 transfer can represent 1,000% to 5,000%
of the total amount" (`circle.com/blog/circle-nanopayments-launches-on-testnet-as-the-core-primitive-for-agentic-economic-activity`,
retrieved 2026-09-11). Arc's own flat rate is a smaller multiple than that quote's low-end chain, but
the shape of the problem — and the conclusion that Model A alone is wrong for anything near $0.001 —
is identical.

## 5. Model B — signed off-chain authorization, periodic on-chain settlement

Each payment is a payer-signed EIP-712/EIP-3009 authorization (six fields: from, to, value,
validAfter, validBefore, nonce — the exact fields x402's EVM scheme and Circle Gateway both sign).
The authorization is **not** broadcast individually. A facilitator collects many of them and submits
one on-chain settlement covering all of them — Circle's own description: Nanopayments "bundles
thousands of transactions into a single onchain settlement," with "delayed settlement" happening
periodically while the merchant gets "instant confirmation" up front
(`circle.com/blog/circle-nanopayments-launches-on-testnet-as-the-core-primitive-for-agentic-economic-activity`,
retrieved 2026-09-11).

Marginal on-chain cost per payment under batching, at the same MEASURED 22 Gwei / 90,000-gas
settlement call, amortized across a batch of N:

| Batch size N | Marginal network fee per payment | $0.001 payment as % of marginal fee |
|---|---|---|
| 1 (= Model A) | $0.00198 | 198% |
| 100 | $0.0000198 | 2.0% |
| 1,000 | $0.00000198 | 0.2% |
| 10,000 | $0.000000198 | 0.02% |

At any batch size Circle's own "thousands" figure implies, the marginal network fee for a $0.001
payment falls to a small fraction of a percent — the arithmetic reason batching, not a smaller
per-call gas trick, is what actually fixes nano-scale economics.

What Model B does **not** eliminate:

- **Facilitator liveness risk.** A valid signed authorization is not settlement. The signature
  fixes amount, recipient, chain and validity window — the facilitator cannot forge a different
  amount or recipient — but it *can* simply never submit the batch. `validBefore` bounds how long
  that risk window can last (§11), but does not compensate the payer if the window lapses
  unsettled.
- **A pending-value window.** Between signing and the batch landing on-chain, real economic value
  exists only as an off-chain promise. This is not custody in the pooled-balance sense of Model C
  (§6) — no funds have moved — but it is real counterparty exposure for whichever side is asked to
  act on the payment before settlement (e.g. a merchant releasing a paid resource on "instant
  confirmation" alone).
- **Settlement gas is still real and still someone's cost.** Batching divides it near to zero per
  payment; it does not make it zero. Someone — Circle, in its own "gas-free for developers" framing
  where "onchain costs [are] covered by Circle at the batch settlement layer" — is paying the
  aggregate network fee for the whole batch. UNICA does not have this cost absorbed by any
  third party; if UNICA operates its own batching facilitator, the aggregate gas bill is UNICA's,
  even though no individual payer sees it.

## 6. Model C — prepaid / escrowed balance with deductions

The payer funds a balance in **one** on-chain deposit transaction (its own network fee, paid once,
amortized across every subsequent deduction). Every $0.001/$0.01/$0.10 charge afterward is a pure
off-chain ledger deduction against that balance — no signature, no authorization object, no
per-payment on-chain event of any kind, until the payer withdraws or the balance is topped up.

Marginal on-chain cost per deduction: **$0**, identically, at every payment size, for as long as the
balance holds funds — better than Model B's near-zero-but-nonzero marginal cost, because there is no
periodic settlement step at all; the deposit transaction already happened.

The cost this model does not avoid is not economic, it is structural: **it makes the operator a
custodian of pooled customer funds.**

- **Custody, named plainly.** Funds are held by a contract or hot wallet the operator controls, not
  by the payer, between deposit and spend. This is qualitatively different from Model A (funds move
  atomically, wallet-to-wallet, every time) and from Model B (no balance is ever pooled — only
  signed promises exist before settlement).
- **Legal consequence, flagged explicitly.** Holding customer prepaid balances at any scale is the
  fact pattern that money-transmitter and e-money licensing regimes are written around in most
  jurisdictions. Whether UNICA's specific beta usage would trigger such a requirement is **UNKNOWN**
  and outside this document's scope — it is a compliance question for the project's own counsel, not
  a technical one this file can settle — but the fact pattern itself (a third party holds
  many users' money before they've individually authorized each specific use of it) is exactly the
  one those regimes target, and it should be treated as a live legal question, not an implementation
  detail, before this model is chosen for real value.
- **Security consequence, flagged explicitly.** A pooled balance held in one contract or wallet is a
  single high-value target. A key compromise or a contract bug drains *all* users' escrowed funds at
  once — the blast radius of one failure in Model C is every depositor's balance, where the blast
  radius of one failure in Model A is whatever was in flight in that one transaction, and in Model B
  is whatever was in the unsettled batch window. This is a structural property of pooling, not a
  quality-of-implementation question; better code reduces the probability of the failure, not its
  blast radius if it occurs.

## 7. A / B / C, compared directly

| Dimension | A — every payment on-chain | B — signed off-chain, periodic settlement | C — prepaid/escrowed balance |
|---|---|---|---|
| **Trust required** | Least: each payment is its own final, atomic settlement — no ongoing counterparty trust once it lands | Payer trusts the facilitator to eventually submit what was signed (cannot forge terms, can withhold liveness) | Payer trusts the custodian to honor every deduction faithfully *and* to safeguard the pooled balance |
| **Custody** | None — non-custodial by construction, funds move payer→merchant directly every time | None in the strict sense — no balance is pooled — but a real pending-value window exists between signature and settlement | **Yes — the defining property.** Pooled customer funds sit with the operator; legal/security flags in §6 |
| **Security model** | Standard per-transaction contract security; a failure affects only that one payment | Depends on facilitator key security and honesty; a compromised facilitator can withhold/reorder, never forge amount/recipient (bound by signature) | A single high-value pooled target; one compromise or bug can affect every depositor's balance at once |
| **UX** | Worst at nano scale — a signature and a fee, every single payment | Best of the verifiable options — payer signs, gets "instant confirmation" (Circle's phrase), settlement latency hidden | Best overall — feels like spending from a balance, zero per-payment friction once funded |
| **Difficulty to build** | Lowest — one code path, reused every time, no state machine beyond the chain's own | Moderate–high — needs a facilitator/relayer, nonce/session tracking, a batching job, a liveness/timeout policy | Moderate — needs a ledger, deposit/withdrawal flows, and (for real value) a reserve proof the payer can verify |

None of the three is categorically "the answer" — §13 ties this to payment size: Model A is right
exactly where its flat fee is a small fraction of the amount moved (roughly $1.00 and up, per this
file's own measurement); Models B and C exist to serve the range below that, where Model A alone is
not viable.

## 8. Batching, channels, permits, vouchers

- **Batching** (Model B's mechanism): many independently-signed authorizations, submitted as one
  on-chain settlement. This is what Circle's Nanopayments product does — "bundles thousands of
  transactions into a single onchain settlement" — and it fits whenever payments go from many payers
  to a merchant (or vice versa) through one shared, trusted-or-verifiable aggregator, rather than
  between one fixed pair of parties.
- **Payment channels** (bilateral; not what this repository's Arc code builds): two named parties
  open a channel with one on-chain transaction, exchange successive signed balance updates entirely
  off-chain, and close with one final on-chain settlement. This shape fits a stream of many payments
  between the *same two parties repeatedly* — one agent metering calls to one specific API — and
  fits poorly when payments fan out to many different, unrelated merchants, which is the shape this
  repository's own nanopayments code is built around (a shared `GatewayWalletBatched` facilitator,
  not a bilateral channel).
- **Permits (EIP-2612) and Permit2**: both remove the separate `approve()` transaction from a
  payer's first interaction with a spender, at an ESTIMATE ~46,000-gas one-time cost — but that
  saving is **per payer→spender relationship, not per payment**, so it does not touch the nano-scale
  problem at all. EIP-3009 (§4) is the mechanism that actually matters here, because it authorizes
  the transfer itself off-chain with **no prior on-chain allowance step ever** — exactly why x402's
  "exact" EVM scheme and Circle Gateway are both built on EIP-3009 rather than on Permit2.
- **Vouchers**: not a term the fetched x402 v2 specification defines as a distinct mechanism. Where
  the word appears in practice it names the same signed-authorization object as Model B, framed for
  accounting/UX purposes as a redeemable claim rather than a bare cryptographic signature — a naming
  convention, not a different primitive.

## 9. USDC vs EURC, per use case

Both are Circle-issued, 6-decimal, EIP-3009-capable stablecoins — MEASURED directly for this
document via `eth_call` `decimals()`/`symbol()` against Base mainnet's official public RPC
(`https://mainnet.base.org`), retrieved 2026-09-11: USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
returns **6**; EURC at `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` returns **6** and `symbol()` →
**"EURC"**. (Chosen as the verification chain because Base has both tokens deployed with public
addresses; Arc testnet's own USDC decimals were independently confirmed at 6 in §2, and no EURC
deployment on Arc testnet was found to check directly as of 2026-09-11 — **UNKNOWN** whether one
exists.)

- **Same-currency payments (USDC-in, USDC-out, or EURC-in, EURC-out)** are ordinary same-asset
  transfers — no swap, no LP fee, no FX exposure, exactly the case §4 prices.
- **Cross-currency payments (USDC-in, EURC-out, or the reverse) are not a "stablecoin swap" in the
  same-asset sense** — USD and EUR are two different real-world currencies with a continuously
  moving exchange rate. A USDC↔EURC conversion is a genuine FX trade with real price risk, not a
  peg-arbitrage trade the way, say, two different USD-stablecoin wrappers might be. It requires an
  actual swap leg — Uniswap v4 or another route — with the full swap cost, LP fee, and slippage
  exposure of §3's swap row, none of which is zero.
- **Circle's own Nanopayments materials name only USDC.** Both fetched Circle blog posts
  (`circle.com/blog/circle-nanopayments-launches-on-testnet…` and
  `…nanopayments-powered-by-circle-gateway-is-now-live-on-mainnet`, retrieved 2026-09-11) describe
  the product exclusively in USDC terms; EURC support for Nanopayments specifically is **UNKNOWN** —
  not stated as supported or unsupported in either source.
- **Practical shape for UNICA**: keep each merchant relationship single-currency, and treat a
  cross-currency payment as a coarser, non-nano flow (quote the FX-adjusted amount, swap once, then
  settle) rather than running a live FX swap on the hot path of a $0.001-sized charge, where the
  swap's own LP fee and price impact would very likely dominate the payment itself — the same
  "never force a swap where none is needed" principle this project already holds for same-asset
  USDC, extended to the case where a swap genuinely cannot be same-asset.

## 10. Decimals, rounding, dust, minimum output

Both tokens use 6 decimals (§9), so the smallest representable unit of either is **10⁻⁶ of the
currency — $0.000001 or €0.000001.** Circle's own Nanopayments copy states support for payments "as
small as $0.000001" (`circle.com/blog/circle-nanopayments-launches-on-testnet…`, retrieved
2026-09-11) — a figure consistent with the token's own decimal floor, not a separately chosen
marketing minimum.

The four amounts priced in this file are all clean integers in base units, with no rounding
ambiguity at these specific values:

| Amount | Base units (×10⁻⁶) |
|---|---|
| $0.001 | 1,000 |
| $0.01 | 10,000 |
| $0.10 | 100,000 |
| $1.00 | 1,000,000 |

Rounding and dust become a real question only when a charge is *computed* from something
continuously variable — a per-token or per-millisecond metering price that does not land on a clean
base-unit boundary and must be truncated to fit the 6-decimal grid. This repository's own agent
mandate code (consistent with the token-decimals fact verified in §9 above — cited here as an
existing engineering discipline, not as an external source) states the
relevant rule plainly: every amount is an integer in base units, because "a price formatted for a
screen and parsed back is how a rounding difference becomes an accepted overspend." The two concrete
policy choices that follow from the decimals fact alone: round **down** on every computed charge
(never let a display or formatting step invent extra spend the payer did not authorize), and
accumulate whatever fractional remainder gets truncated into an explicit running ledger rather than
silently discarding it — otherwise many small rounded-down fragments across a high-volume
relationship simply vanish rather than being collected or refunded.

**Minimum output**, where a swap leg exists (§9's cross-currency case only): Uniswap v4 swaps carry
an explicit minimum-received parameter on every call. At nano scale that minimum itself must still
resolve to a nonzero base-unit amount (≥10⁻⁶ of the destination currency) to mean anything — below
roughly the size of the pool's own LP fee in absolute terms, a minimum-output check cannot
distinguish "this trade is fine" from "this trade lost the whole payment to rounding and fee," which
is one more reason (alongside FX exposure, §9) to keep a swap leg off the nano-payment hot path
entirely.

## 11. Refunds, failed-payment cost, quote expiry, replay/duplicate prevention

- **Failed-payment cost is real and non-refundable in Model A.** A reverted EVM transaction still
  consumes gas up to the point of failure — Arc's own published EVM-differences behavior is even
  sharper than the general EVM case: "Blocklist reverts consume gas without producing a receipt"
  (per `docs.arc.io`, as carried in this repository's independently-re-verified `docs/ARC-FACTS.md`
  observations, and consistent with standard EVM revert-gas semantics generally). For a $0.001
  nominal payment, a failed attempt is pure loss to whoever paid the gas — no value was delivered,
  and the fee is not returned.
- **Refunds are not a protocol primitive.** Nothing in the fetched x402 v2 specification
  (`github.com/coinbase/x402`, retrieved 2026-09-11) defines a refund message type or flow. Once a
  `transferWithAuthorization` settles, reversing it requires a wholly separate payment back to the
  original payer — its own transaction, its own network fee, in Model A — or a merchant-side ledger
  credit in Model B or C. Refund handling is application-layer, built on top of x402, not inside it.
- **Quote expiry is a built-in field, not an afterthought.** x402's `PaymentRequirements` object
  carries `maxTimeoutSeconds`, and each individual authorization separately carries its own
  `validAfter`/`validBefore` window (both per the fetched v2 spec). A price quoted to a payer is only
  honorable inside that window; past `validBefore` the authorization is simply invalid, and the
  facilitator's `/verify` step is expected to reject it — the payer must obtain a fresh signature,
  which costs a round trip but no on-chain fee if nothing was ever broadcast.
- **Replay and duplicate prevention are two-layered, not one.** Every authorization carries a unique
  32-byte nonce (nonce, x402/EIP-3009 authorization field — the value itself is never printed here,
  only referenced), and the token contract's own nonce-bitmap storage enforces uniqueness
  **on-chain, at the contract level** — not merely in a facilitator's own bookkeeping. That means even
  a misbehaving or fully compromised facilitator cannot cause one signed authorization to move funds
  twice: it settles exactly once, on-chain, or never.

## 12. Receipts, and whether each nanopayment needs its own transaction

A receipt exists only for whatever actually lands on-chain. In Model A that is every payment; in
Model B or C it is only the periodic batch-settlement or the deposit/withdrawal transactions — an
individual $0.001 authorization that gets netted into a batch or absorbed as an escrow-ledger
deduction has **no independent on-chain receipt of its own**. What the payer and merchant get
instead is the facilitator's off-chain acknowledgment (x402's `/verify` and `/settle` HTTP
responses), and, per Circle's own description of Nanopayments, "instant confirmation" to the
merchant well before the underlying batch actually settles.

**Does each nanopayment need its own transaction? No — and this is not a stylistic choice, it is the
entire commercial reason Circle's Nanopayments/Gateway product and x402-with-batching exist at all.**
Circle's own materials state the alternative plainly: without batching, "fees for a $0.0001 transfer
can represent 1,000% to 5,000% of the total amount" on even low-cost chains — the same phenomenon §4
measured directly on Arc, at a smaller multiple but the identical shape. The practical consequence
for UNICA is that the choice is not "Model A everywhere," it is choosing *which* of Model B
(facilitator-batched authorizations) or Model C (escrow ledger) covers payments below whatever floor
Model A is economically sound at — computed next, in §13.

## 13. The minimum economically sensible payment, synthesized

Using a "network fee should not exceed 5% of the payment" bar — an arbitrary but legible threshold,
chosen here rather than sourced, since no official document sets one — and the MEASURED Arc gas
price (§2) at the ESTIMATE 90,000-gas EIP-3009 settlement call (§4):

| Amount | Model A network fee (22 Gwei) | Fee as % of payment | Sensible per-payment on Model A alone? |
|---|---|---|---|
| $0.001 | $0.00198 | 198% | **No — loses money before any other fee** |
| $0.01 | $0.00198 | 19.8% | **No — nearly 4× over the 5% bar** |
| $0.10 | $0.00198 | 1.98% | **Yes**, comfortably under the bar |
| $1.00 | $0.00198 | 0.198% | **Yes**, trivially |

Solving for the break-even point at the 5% bar: `$0.00198 / 0.05 ≈ $0.0396`. **The minimum
economically sensible single on-chain payment on Arc testnet, at the gas price and settlement-call
gas figure measured/estimated in this document, is roughly $0.04 (ESTIMATE — sensitive to both the
MEASURED 20–22 Gwei price, which can move, and the 90,000-gas settlement-call figure, which is an
ESTIMATE pending a funded-signer measurement not yet performed as of 2026-09-11).**

That threshold sits **between** the $0.01 and $0.10 amounts priced in this file — meaning,
concretely: $0.001 and $0.01 payments are not economically sensible as individual Model A
transactions on Arc under any funding arrangement (someone always loses more than 20% of the payment
to gas, before any facilitator or relayer fee is added); $0.10 and $1.00 are. This is exactly why
§5's batching math and §6's escrow model exist — not as alternatives of equal standing to Model A at
every size, but specifically to cover the two smallest of the four amounts priced here, where Model A alone
is not viable, while Model A remains the simplest correct choice for the two largest.

## Sources consulted (retrieved 2026-09-11 unless noted)

- `docs.arc.io` (via its `llms.txt` and EVM-differences page) — testnet status, chain id, 20 Gwei
  floor, native-USDC gas, Osaka EVM baseline. Re-verified independently for this document (§2), not
  taken on the strength of the repository's own prior note.
- `https://rpc.testnet.arc.io` — MEASURED, keyless: `eth_chainId`, `eth_blockNumber`, `eth_gasPrice`,
  `eth_maxPriorityFeePerGas`, latest-block fields, and `decimals()`/`symbol()`/`eth_getCode` on the
  USDC contract at `0x3600000000000000000000000000000000000000`.
- `https://mainnet.base.org` — MEASURED, keyless: `decimals()`/`symbol()` on USDC and EURC.
- `github.com/coinbase/x402`, `specs/x402-specification-v2.md` — facilitator role, EIP-3009 scheme,
  nonce/expiry fields, verify/settle flow.
- `eips.ethereum.org/EIPS/eip-3009` and `github.com/circlefin/stablecoin-evm` — EIP-3009 mechanics
  and USDC/EURC's implementation of it.
- `developers.circle.com/gateway/references/fees` — Gateway's 0.005% cross-chain-only transfer fee,
  per-chain burn gas-fee table, $0.05 forwarding fee, `maxFee` formula.
- `circle.com/blog/circle-nanopayments-launches-on-testnet-as-the-core-primitive-for-agentic-economic-activity`
  and `circle.com/blog/nanopayments-powered-by-circle-gateway-is-now-live-on-mainnet` — batching
  description, "$0.000001" minimum, the 1,000%–5,000% fee-ratio quote, chain support lists (Arc:
  testnet only, confirmed absent from the mainnet list).
- `developers.uniswap.org/docs/get-started/concepts/fees` and
  `developers.uniswap.org/docs/protocols/permit2/overview` — v4's 0%–100% fee range in 0.0001%
  increments, ~1/6-of-swap-fee governance-configurable protocol fee, and Permit2's gasless signature
  step.

## Open UNKNOWNs

- The true on-chain gas cost of a `transferWithAuthorization` call against Arc testnet's specific
  USDC deployment, measured with a funded signer rather than estimated from general EVM opcode costs.
- Whether Circle Nanopayments or any equivalent facilitator supports EURC, on Arc or anywhere else.
- Whether an EURC deployment exists on Arc testnet at all.
- The commercial fee an actual production x402 facilitator (Circle's own, or any other) charges
  sellers per settled payment — the spec is silent by design (§3), and no official rate was found.
- Any relayer/paymaster premium rate for Arc specifically — no official source publishes one.
- Whether UNICA's own eventual choice of Model B or C would trigger money-transmitter/e-money
  licensing in any jurisdiction it operates in — a compliance question, not a technical one, and
  explicitly out of this document's scope (§6).
