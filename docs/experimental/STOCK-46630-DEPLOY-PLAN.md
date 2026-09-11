# Stock settlement on Robinhood testnet 46630 — the eleven-transaction plan

> **2026-09-11 — this plan was broadcast, and the sentence below is superseded.** The owner
> authorized deployment to chain 46630 and ran all four stages from their own terminal, each
> through the wrapper's typed `SEND` and the keystore prompt. All eleven transactions landed, in
> order, from the deployer at nonces 79 to 89, every receipt status 1, with nothing else sent from
> the deployer between them. The owner chose smaller parameters than the rehearsal's: rate 395,
> seed **100** uTUSD, payment **0.001** TSLA. The superseded text is left where it was, so the
> record shows what was believed when.
>
> | Stage  | Nonces | Transactions (tx hash, block)                                                                                      |
> | ------ | ------ | ------------------------------------------------------------------------------------------------------------------ |
> | token  | 79     | tx `0x6e7947b46fec550a0b1c3250095b5efd756bdf0aad9f9a2e2b12c2a227d07375` 117528087                                 |
> | pair   | 80–81  | tx `0xf3088d5294ef726e827faa7017df5d7dab86e715b65df22bde8c87896ad0b40c` 117529452, tx `0x4a9c50423e94d10fe11cbd069ba7a9c06a1eb150c63b23d472390a955ff3f4b5` 117529467 |
> | pool   | 82–86  | init tx `0x56f4c5731774c214847d2c1cb27b6175290f5322476609e6b0955c99632fd565` 117530861 … seed tx `0xe47ab25e23215867e296537af2bcaf3cff35bbb0050dce7b20ff37689c29a123` 117530869 |
> | settle | 87–89  | order tx `0x66c15925dbefe42147b1674747ee328d2a624ad418b3470825c7744928153603` 117535197 … pay tx `0x9cb16eeab49670283b8c2a36241e89e5239df45523660afdc36491a0453ec300` 117535202 |
>
> - **Deployed:** uTUSD `0xfb93352698150e720Bf0A321DEf3aC98D90B9874` (no value), hook
>   `0xAe1975f223824b5851564277656ebAC21667E0c0` (flags `0x20C0`), executor
>   `0x613dadd395E0bB1A7AC4A843Aca408C3af8e16cE`; seed position NFT 4209 owned by the deployer.
> - **Pool id** `0x64553b2a4c30c7a7551f752184ef3442e40817cc17f118db3d95142839057a34`.
> - **The one settlement:** 0.001 faucet TSLA in; **393052** raw uTUSD (0.393052) to the merchant
>   `0x19E56831a10d43CfF5d77f886c799C6b916da7Ae`, against a floor of 383149. The merchant's uTUSD came
>   from the pool, not from a mint: uTUSD supply is the single 100 uTUSD seed mint.
> - **Cost:** 0.00008904036 ETH for all eleven, read from the deployer's balance before and after.
> - **Checked after each stage** by `.rehearsal/live-46630/readback.sh` (8, 12, 14 and 14 rows, all
>   PASS), then by an independent read-only pass: every transaction and receipt re-read by hash, the
>   explorer's list agreeing on all eleven, a second `pay` refused with `OrderNotOpen`, a swap not
>   sent by the executor refused by the hook with `NotSettlementExecutor`.
> - **The records** are `broadcast/StockSettlement46630.s.sol/46630/`, committed in e5a0185 and
>   frozen under the tag `experimental-46630-settled`, whose source rebuilds all three contracts'
>   creation code exactly.
>
> **What this is not.** One order, paid by the deployer, against the deployer's own seed liquidity,
> at a demonstration rate the deployer set: not a market price, and there is no oracle. The faucet
> TSLA is a testnet token, not a share or a security, and uTUSD has no value. The contracts'
> source is **not verified on the explorer**; nothing here claims it. Four more things are true of
> it: the settlement receipt's fee field does not report the fee the swap paid; the seed range sat just below the opening
> price, so the first swap crossed seven ticks of empty range; the executor is permissionless, so
> anyone holding faucet TSLA can buy the remaining uTUSD; and small allowances from the seed step
> remain (100000 raw uTUSD to Permit2, and Permit2 to the PositionManager until 2026-09-12).
>
> These contracts are not upgraded or reused as UNICA v4, which is a separate deployment with
> its own addresses and its own records.

**Nothing in this document has been broadcast.** It describes transactions that have been
rehearsed on a local fork and not sent to the chain. Sending any of them requires the owner's
explicit authorization, a keystore signature, and the typed confirmation described below.

## Current state, stated exactly (as written 2026-09-10, before the broadcast)

| Item                                                                  | State                                                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contracts (hook, executor, testnet payout token)                      | implemented; tested locally                                                                                                                                                    |
| Deployment and payment stages (`script/experimental/`)                | implemented                                                                                                                                                                    |
| Fork rehearsal of all eleven transactions                             | successful, repeatedly, on anvil forks of 46630 as the real deployer                                                                                                           |
| Latest rehearsal                                                      | 77 distinct stage rows (145 printed: simulation and broadcast each print) and 9 independent readback rows; all PASS, 0 FAIL. An earlier run printed 139 before rows were added |
| Permit2 allowance path (seeding through the official PositionManager) | exercised on the fork                                                                                                                                                          |
| Faucet TSLA pulled by the executor                                    | exercised on the fork; `InputNotExact` did not fire, so no fee or rebase on that transfer                                                                                      |
| Refusal controls                                                      | exercised: 19 wrapper rows offline, 12 fork rows, 6 offline script rows, 25 of 25 guards sabotaged                                                                             |
| Live broadcast on 46630                                               | **none**                                                                                                                                                                       |
| Live hook, executor, payout token, pool, liquidity                    | **none**                                                                                                                                                                       |
| Confirmed stock settlement on a live chain                            | **none**                                                                                                                                                                       |
| Candidate website wiring to this workflow                             | **none** — `apps/web` has no browser wiring to these contracts                                                                                                                 |

## The eleven transactions

All from the deployer `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73`, in this order, one stage per
command. The predicted addresses hold **only if the deployer's nonce is 79 when stage 1 is signed**
and nothing else is sent from it between stages; the wrapper re-derives them from the live nonce
and prints them before asking for confirmation, so a different nonce shows different addresses
rather than failing silently. Values below are the rehearsal's (rate 395, seed 10,000 uTUSD,
payment 0.1 TSLA); the owner states the real ones.

| #   | Stage  | Nonce | Call                                                                                   | Effect                                                                |
| --- | ------ | ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | token  | 79    | CREATE `TestPayoutToken(minter = deployer)`                                            | uTUSD at `0xfb93352698150e720Bf0A321DEf3aC98D90B9874`, supply 0       |
| 2   | pair   | 80    | CREATE2 through `0x4e59b44847b379578588920cA78FbF26c0B4956C` at a mined salt           | hook at `0xAe1975f223824b5851564277656ebAC21667E0c0`, flags `0x20C0`  |
| 3   | pair   | 81    | CREATE `UnicaStockSettlementExecutor(PoolManager, hook, TSLA, uTUSD)`                  | executor at `0x613dadd395E0bB1A7AC4A843Aca408C3af8e16cE`              |
| 4   | pool   | 82    | `PoolManager.initialize((TSLA, uTUSD, 3000, 60, hook), 1574628586517385344053270)`     | the guarded pool, at 395 uTUSD per TSLA                               |
| 5   | pool   | 83    | `uTUSD.mint(deployer, 10000000000)`                                                    | 10,000 uTUSD to the deployer                                          |
| 6   | pool   | 84    | `uTUSD.approve(Permit2, 10000000000)`                                                  | Permit2 may move exactly the seed                                     |
| 7   | pool   | 85    | `Permit2.approve(uTUSD, PositionManager, 10000000000, now + 1 day)`                    | the PositionManager may pull exactly the seed, for one day            |
| 8   | pool   | 86    | `PositionManager.modifyLiquidities(MINT_POSITION ticks -223500..-216540, SETTLE_PAIR)` | a payout-only position; its NFT goes to the deployer; no TSLA moves   |
| 9   | settle | 87    | `executor.createOrder(merchant, key, 0.1 TSLA, floor, now + 1 day, deployer, salt)`    | one order, bound to the deployer as payer                             |
| 10  | settle | 88    | `TSLA.approve(executor, 100000000000000000)`                                           | exactly the order's input                                             |
| 11  | settle | 89    | `executor.pay(orderId)`                                                                | 0.1 TSLA in; the merchant receives ≥ the floor (rehearsal: 39.305213) |

The pool stage is four transactions instead of five when it resumes a run whose initialise
already landed (see "Partial runs" below).

## What it costs

From forge's own estimates in the rehearsal, at the gas prices the fork reported:

| Stage     | Gas       | Estimate (ETH)       |
| --------- | --------- | -------------------- |
| token     | 1,810,040 | 0.00003620080181004  |
| pair      | 7,790,435 | 0.000136332635871305 |
| pool      | 837,500   | 0.0000112211943375   |
| settle    | 918,569   | 0.000006312574266127 |
| **Total** |           | **≈ 0.000190 ETH**   |

These figures come from an anvil fork, and anvil does not model the L1 data fee an Arbitrum-type
chain like 46630 charges, so they are a floor, not a quote. The wrapper therefore refuses to
broadcast a stage unless the deployer holds **twice** that stage's estimate, and a live dry run
prints the chain's own figure per stage before anything can be confirmed. The whole plan's doubled
rehearsal estimate is ≈ 0.00038 ETH; the deployer held 0.0592 ETH at the rehearsal's fork block.

Tokens: 0.1 of the deployer's 30 faucet TSLA for the one payment. The uTUSD is minted by the
deployer and has no value.

## How a stage is run, and what stops it

`script/experimental/stock-46630.sh` has exactly three modes, and only one can send:

| Mode                                                  | Sends? | Requires                                                                                                 |
| ----------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `DRY_RUN=1`                                           | no     | nothing; simulates against the live chain and prints the plan                                            |
| `REHEARSE=1`                                          | no     | a loopback URL answering as anvil — refused before any call otherwise                                    |
| `LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS` | yes    | a keystore name, a terminal, the plan printed in full, the word `SEND` typed, then the keystore password |

With none set, it refuses. Before any confirmation it prints the chain id, the endpoint's host
(never a keyed path), the deployer, its nonce, its native, TSLA and uTUSD balances, the predicted
addresses, the token addresses, the pool parameters, the transaction count, forge's estimate and
the doubled spend ceiling.

**Where the endpoint is written.** forge splits each run record: a public half under `broadcast/`
and a half holding the endpoint URL under `cache/<script>/<chain>/`. With the keyed primary alias,
that URL carries the key. `cache/` is gitignored, so it never reaches a commit, but the wrapper
removes the dry-run half on every exit so a simulation leaves no key on disk. A live run's half is
kept on purpose: `forge script --resume` needs it to finish a broadcast that stopped part-way.

## Partial runs, and what cannot be undone

**A broadcast transaction cannot be rolled back.** Nothing in this repository, and nothing on the
chain, can reverse one. What follows is what each stage leaves behind if it stops part-way, and
what, if anything, can be done about it.

| Stops after              | Left on chain                                                                                           | Recovery                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tx 1                     | an unused test token                                                                                    | none needed; it holds nothing and cannot be removed                                                                                                                              |
| tx 2, before tx 3        | a hook naming an executor address that has no code, or holds something else if a transaction slipped in | the hook is unusable and stays; re-run `pair` for a new salt and new addresses                                                                                                   |
| tx 4, before tx 8        | an initialised, unseeded pool                                                                           | re-run `pool` at the **same** rate: it finds the pool at exactly its own price and seeds in four transactions (fork row F9)                                                      |
| tx 4, wrong rate         | a pool at the wrong price                                                                               | the price cannot be reset. This script fixes the fee tier and spacing, so a new rate needs a new `pair` (a new hook, so a new key)                                               |
| anyone initialises first | a pool at a price the owner did not state                                                               | `pool` refuses it by name (fork row F10). The key is public once the hook exists, so running `pool` right after `pair` narrows the window; a new `pair` gives a new key          |
| tx 8                     | the seeded position                                                                                     | the only reversible piece: its NFT is the deployer's, and the liquidity (plus any TSLA payers have sold into it) can be withdrawn through the PositionManager. Not scripted here |
| tx 9, before tx 11       | an open order                                                                                           | it expires after a day; nothing is owed                                                                                                                                          |
| tx 11                    | a settled payment                                                                                       | final. The merchant keeps the uTUSD; the TSLA sits in the pool's position                                                                                                        |

Approvals do not linger: the Permit2 allowance is for exactly the seed and expires in a day, and the
TSLA approval is for exactly the order's input and is consumed by the payment (a row checks it is
zero afterwards).

## What still has to be true before any of this is sent

1. **The owner's explicit authorization** for chain writes on 46630, under the approval protocol in
   `BATCH-A-RECONNAISSANCE.md` §9.
2. **Program permission.** Deploying a custom test token, initialising a pool and seeding liquidity
   are still UNRESOLVED with the organizer (`BATCH-B-LOCAL-SETTLEMENT.md` §8).
3. **A merchant address** separate from the deployer. The rehearsal used a placeholder.
4. **The rate, the seed and the payment size.** The rehearsal used 395, 10,000 and 0.1; the rate
   is a demonstration parameter near the hookless reference venue's small-size quote, not an oracle.
5. **Accepting the TSLA contract as it is.** Read first-hand on 2026-09-10: 283 runtime bytes
   containing a `DELEGATECALL`, with the EIP-1967 implementation slot empty — a delegating proxy
   whose implementation and admin are not established. The hook and executor bind it permanently. An upgrade that added a
   fee or a rebase would make every payment revert on `InputNotExact` — safe, and unusable.
6. **The deployer's nonce** when stage 1 is signed. At 79 the addresses above are the ones that
   land; at any other value the wrapper shows the ones that will.

## Evidence

- `make stock-rehearse` — the eleven transactions on a fork, through the owner's own wrapper.
- `bash script/experimental/stock-46630.test.sh` — the wrapper's refusals, offline (in `make gate`).
- `forge test --match-path test/experimental/StockSettlement46630Local.t.sol` — the script's
  arithmetic for both currency orderings, and the wrong-chain refusal (in `make gate`).
- `forge test --match-path test/fork/StockSettlement46630Fork.t.sol` — the refusals against real
  chain state: wrong payout token, a nonce moved between hook and executor, too little TSLA, too
  little uTUSD, a standing allowance, a short fill, a payment below the merchant's minimum, TSLA
  leaving the deployer during seeding, a resumed pool stage, and a pool someone else initialised.
