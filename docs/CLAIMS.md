# UNICA — the claim ledger

Every claim this project makes in public, with what backs it and what it does not cover.

**The rule this table exists to enforce: public wording may not outrun a row here.** If a sentence
in a README, a demo script, a sponsor submission or a video does not appear below with evidence, it
does not get said. A claim that is true of the code and false of the deployment is still a false
claim, which is why every row carries both a scope and a network.

Nothing in V2 is deployed to any public chain. **No part of UNICA has been audited.**

## The central claim, and why it is three sentences

> The hook proves that the pool swap is an authorised, exact invoice-discharge swap.
> The executor proves that the merchant was paid exactly.
> Atomic execution makes those two outcomes inseparable.

It is written as three because collapsing it into one produces something false. The hook cannot see
the payment — the merchant is paid by a `take` after the swap frame returns, so a `balanceOf` read
inside `afterSwap` would return the pre-delivery balance and look like a check while proving
nothing. The executor cannot police the pool — anyone may call `PoolManager.swap`. Neither claim
survives being attributed to the other party, and `test/v2/SettlementLayers.t.sol` settles through a
hook that judges nothing precisely so that the executor's half is testable on its own.

## The ledger

| # | Claim | Status | Scope | Evidence | Source commit | Network | Limitation | Public wording |
|---|---|---|---|---|---|---|---|---|
| 1 | A v4 exact-output swap can under-deliver and nothing in the official periphery objects | MEASURED | one pool shape, official PoolManager runtime | `test/v2/ShortFill.t.sol` — 1e18 requested, 2,995,354,955,910 delivered, no revert; `V4Router._swapExactOutputSingle` raises only `V4TooMuchRequested` | `878436e` | local | measured at one liquidity shape; shows the defect exists, not that it occurs everywhere | "Under exact output the periphery checks the input ceiling and never compares delivered output with the request." |
| 2 | The V2 hook refuses a short fill | PROVEN, LOCAL AND FORK | the hook | `test/v2/InvoiceFill.t.sol`; fork row `test_ForkN_AnInvoiceTheLiquidityCannotFill`; mutation M07/F02 | `1faf6b6`, `17df0c2` | local + Sepolia fork | not deployed | "The hook refuses any swap that does not deliver the invoice in full." |
| 3 | A pool carrying the V2 hook cannot be traded through | PROVEN, LOCAL AND FORK | the hook | `test_Admit_AnyoneButTheExecutorIsRefused`; fork rows for a stranger swapping and for fabricated hookData; mutation M01/F01 | `1faf6b6`, `17df0c2` | local + Sepolia fork | true of a pool whose hook is this contract; says nothing about any other pool | "Every swap through a UNICA V2 pool discharges a merchant-signed invoice, or it reverts." |
| 4 | The merchant receives exactly the invoiced amount | PROVEN, LOCAL AND FORK | the executor | `test_Settle_TheMerchantIsPaidExactlyAndNobodyElseHoldsAnything`; fork: 100.000000 USDC delivered; adversarial skim row; mutation M17 | `a8aac34`, `a1893d2` | local + Sepolia fork | enforced by the EXECUTOR, not the hook; an output token that cannot transfer an exact amount is refused rather than supported | "The executor verifies the merchant's balance rose by exactly the invoiced amount, or the transaction does not happen." |
| 5 | The executor never holds the payer's or the merchant's tokens | PROVEN, LOCAL; MEASURED ON FORK | the executor | opening/closing balances asserted in `_proveThePayment`; adversarial donate rows; mutations M28/M29 | `51e8e47` | local + Sepolia fork | the two no-custody mutations are killed by adversarial-token rows that real USDC and WETH cannot reproduce | "The payer's token moves from the payer to the PoolManager and the output from the PoolManager to the merchant. The executor is a conduit, and its closing balances say so." |
| 6 | The payer's Permit2 authorisation binds the invoice | PROVEN, LOCAL AND FORK | Permit2 witness | `test/v2/Permit2Witness.t.sol` (14 rows, offline+onchain digest agreement); fork rows for wrong payer, wrong quote, wrong destination commitment, expired, replayed nonce | `17836cc`, `17df0c2` | local + Sepolia fork | **Permit2 does not enforce the transfer destination.** The executor fixes it in code and the witness records it | "The payer signs a ceiling and an invoice. The destination is written into the executor as a literal, and recorded in what the payer signed." |
| 7 | An invoice settles once | PROVEN, LOCAL AND FORK | hook + executor | consumption rows; fork `test_ForkD_AReplayChangesNothing`; mutations M03/M08/M25 and F03/F12 | `1faf6b6`, `a1893d2` | local + Sepolia fork | consumption is keyed by quote digest and is global across pools | "A settled invoice cannot be settled again, in any pool." |
| 8 | Hook refusals are attributed correctly | PROVEN, LOCAL | the test harness | `test/v2/HookRevertDecoder.t.sol` — 11 rows, 5 sabotages; ERC-7751 unwrapping | `74a691b` | local | test-tree only; unwraps one layer | "Every hook refusal in this suite asserts the reverting contract, the failed callback and the hook's own error." |
| 9 | The merchant's resolved ENS configuration is inside what they signed | PROVEN, LOCAL | merchant config commitment | `test/v2/MerchantConfig.t.sol`; `integrations/ensv2/test.mjs` — 61 rows; three derivations agree | `fcfe151` | local | **resolution is not identity**; the expiry window is enforced off chain only | "The name, the address it resolved to, the payout currency, the chain and the block of the reading are all inside the merchant's signature." |
| 10 | Nothing in a settlement resolves a name | PROVEN, LOCAL | hook + executor | a contract that reverts on every call is etched at the ENSv2 resolver's address and a full settlement runs anyway | `fcfe151` | local | — | "The hook and the executor never call a resolver." |
| 11 | The integrated path runs against real Sepolia dependencies | PROVEN, FORK | the whole product | `test/fork/` — 32 rows at pinned block 11656449; official PoolManager, official Permit2, Circle USDC proxy, canonical WETH9, all at pinned code hashes | `0585cfc`, `a1893d2`, `17df0c2` | Sepolia fork, read-only | **fork-local installation. Nothing was broadcast.** The V2 hook, executor and pool do not exist on Sepolia | "UNICA V2 settles an invoice against Uniswap v4 and Permit2 as deployed on Sepolia, in a pinned read-only fork. Nothing is deployed." |
| 12 | The tests would notice if the code were wrong | PROVEN | hook + executor | `make mutants` 30/30 local, `make fork-mutants` 12/12 fork, each killed by the row that NAMES it | `51e8e47`, `82c7dcb` | local + fork | a fixed list, not a generator; four mutations are fork-uncoverable and the runner prints which | "Thirty mutations locally and twelve on the fork, each killed by the row that names it." |
| 13 | Merchant signers are EOAs | LIMITATION | the executor | `test_ForkN_AContractCannotBeAMerchantSignerThroughAFabricatedSignature` | `17df0c2` | local + fork | contract wallets and multisigs cannot be merchant signers; payers can, through Permit2 | "V2 merchant quotes are signed by EOAs. Smart-contract wallets are not supported as merchant signers; EIP-1271 is future work." |
| 14 | V1 is live and verified | PROVEN, LIVE | V1 | hook `0x11202071…0Ea0C0`, executor `0x044bc8a8…C6210`, settlement tx `0x1120af18…ee0ecb83`, Sourcify `match`, `make proof` 36 of 36; re-proved from the fork | `5e1d843`, `0585cfc` | Ethereum Sepolia | one settlement has run; USDC payout only; native ETH input only | "UNICA V1 is live on Ethereum Sepolia with one verified settlement and a re-runnable proof script." |
| 15 | V2 is deployed | **FALSE** | — | none | — | none | — | **Never say this.** V2 is `IMPLEMENTED — FORK TESTS`. |
| 16 | The Graph indexes V2 | **FALSE** | — | none | — | none | the V1 indexer is implemented and locally tested and not deployed; the V2 namespace is specified only | **Never say this.** |
| 17 | Any part of UNICA is audited | **FALSE** | — | none | — | — | — | **Never say this.** "No part of UNICA has been audited." |
| 18 | UNICA qualifies for any prize | **NOT CLAIMED** | — | — | — | — | — | The artifacts exist; whether they qualify is a judge's call and is never asserted here. |

## Wording that is banned outright

"production-ready", "battle-tested", "audited", "one of a kind", "the first", "sponsor-qualified",
"prize-qualified", "guaranteed", "formally verified", "provably secure", "V2 is live", "multi-chain",
"every v4 chain", "dollar and euro settlement". `script/validate-tools.mjs` enforces a subset of
this list over the tool ledger and fails the build.
