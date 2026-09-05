# Attack review, 2026-09-05: the adjudication

Five lenses (a malicious payout token, a malicious recipient or order creator, a hostile pool key,
the unlock window and reentrancy, and the accounting) were asked for attacks a **test could
prove**, not theoretical worries, each with the exact test that would go red. Every finding rated
above "defended" was then put to an independent verifier that had to write or read the code and
decide whether it stands. This file records what was done about each class.

Two findings were exploitable. Both are fixed, each with its own test and commit, before any
deployment carried the code.

## Fixed

| # | Severity | Claim | Reproduced | Action | Evidence | Residual risk | Commit |
|---|---|---|---|---|---|---|---|
| A1 | critical | **A pool nobody sanctioned can mint a genuine settlement receipt.** Uniswap v4 lets anyone initialise a pool with any hook and any currencies. An attacker could stand up a pool naming this hook against a token they printed, be its only liquidity, register an order naming any recipient, and pay it themselves for dust. The hook emitted a real `SettlementReceipt` from the real hook address naming a recipient who received something worthless, and an indexer reading receipts by topic (as `docs/RECEIPT-SCHEMA.md` prescribes) would have recorded it as a settlement | yes, and independently by every one of the five lenses (threat T2, which the pre-event threat model had listed as planned) | the payout currency is resolved from the chain id beside the router, and `beforeInitialize` refuses any pool that is not native ETH against it, so the attacker's pool cannot exist; the executor refuses such an order too, so there is no second door. No owner, no list to manage. This is spec C2 and C4 in one line | `test/attack/HostilePool.t.sol`: the attacker's token refused at initialisation and at order creation, the other two hostile shapes refused, and two controls — the sanctioned pool still settles, and anyone may still create the sanctioned shape at any fee tier | the payout currency is now one address per chain: supporting another changes the hook's creation code and its address. That is a limit, recorded in `SECURITY.md`, not a defence gap | `6f99fe9` |
| A2 | high | **An order may name a contract on its own settlement path as recipient.** Output sent to the Universal Router is sweepable by whoever calls it next; output sent to the executor, the hook or the PoolManager is stranded, because none of them can move a token out | yes | all six reserved addresses, including the router's two `TAKE` sentinels, refused where the order is created | `test_RevertWhen_RecipientIsAContractOnThePath` walks every one and asserts no order was counted | none for these six; a recipient contract that cannot receive the token is still the payer's problem to notice, and is refused by `RecipientShort` only if it receives less than the minimum | `87f9eca` |

| A3 | high | **The deploy script funds a pool at a price an attacker chose.** The settlement pool key is deterministic and public, so from the moment the hook has code anyone can initialise it at any price. `init` then found the pool already initialised, said so, and returned; `seed` read the price from `slot0` and placed our liquidity at it. The attacker buys the mispriced side and keeps the difference | yes, on a fork: an attacker initialised the key at 1:1 against our intended 2,500 USDC per ETH, and before the fix `seed` would have funded it | `init` continues past an existing pool only if the price is the one this script chose, and tells the operator to pick another fee tier otherwise; `seed` refuses outright to place liquidity at a price it did not choose. v4 pools cannot be re-initialised, so refusing is the only safe move | the control on a fork: the attacker's 1:1 pool makes `init` refuse with "initialised by someone else at another price", `seed` refuse with "refusing to seed", and the pool's liquidity read back as 0 | an attacker can still deny one fee tier at a time, at their own gas cost; the operator moves to another tier, which the message says | `9f1d2c1` |

## Accepted, with the reason

| # | Claim | Why accepted |
|---|---|---|
| B1 | Anyone may pay another party's order and become the receipt's `payer` | That is what a payment link is. The receipt names who actually paid, which is correct; it does not claim the payer was authorised by the creator. A payer who wants to bind more than the id can read the order first: every term is on chain before the call |
| B2 | `orderCount` is a creator-controlled statistic, not a settlement count | True and already documented in the source. `receiptCount` on the hook is the settlement count |
| B3 | A third party can move the pool's price and make a pending order unpayable | The order refuses rather than settling short, which is invariant I6 working. A pool that has drifted is refilled by liquidity or by the next order at a price the payer accepts; nothing is stranded, and the order stays payable |
| B4 | An LP may remove liquidity and stop settlements | Any venue can be emptied. Nothing is stranded: the payment reverts and the order stays open |
| B5 | The executor's `Settled.amountOut` is a balance delta, not an attributed transfer | Stated in the source and in `docs/RECEIPT-SCHEMA.md`: the hook's receipt is the canonical record and carries the pool's credit; the executor's event is a convenience measured at the recipient |

## Evidence still owed

These were rated "needs-a-defence", meaning the behaviour looks right but nothing proves it. They
are listed rather than quietly dropped, and they are the next tests to write.

- Reentrancy inside the unlock window (threat T6): a payout token that re-enters `pay` or
  `createOrder` during the router's `TAKE`; a settlement driven from inside an attacker's own
  unlock; the transient one-swap mark across two `execute` calls in one transaction.
- Dust and the `clear()` path (threat T9): a one-wei order, a zero-liquidity pool, a third-party
  donation into the settlement pool.
- Delta sign conventions on both legs (threat T4): an exact-output plan for the same order.
- A recipient that reverts or burns gas when it is paid (threat T8).

## Coverage

Five lens agents and their verifiers. The lenses agreed on A1 independently, which is why it was
treated as certain before a line was changed. No finding in this file was accepted on a vote
alone: each was reproduced, or read in the code, before it was acted on.
