# DEMO — the card, the sequence, and what may be claimed

UNICA is a public settlement infrastructure project for Uniswap v4. Its policy hook and narrow
executor enforce order-bound, full-fill settlement and emit an indexable receipt.

## The 90-second walk — four stops, 2026-09-10

The live page holds several minutes of material and the presentation is ninety seconds, so the page
is built with **only the four stops open** and everything else folded one click away. The anchor rail
under the hero names them in order. Live at <https://nfteria.github.io/UNICA/>.

| Time | Stop | On screen | Said |
|---|---|---|---|
| 0:00–0:15 | Hero | "Pay with UNICA · Pay in ETH. The merchant receives USDC." | UNICA lets a customer pay in ETH while the merchant receives USDC in one Uniswap v4 transaction. It adds limited agent authority, automatic settlement enforcement, and a verifiable receipt. |
| 0:15–0:35 | Three layers | the complete three-layer diagram | The product separates three questions. ENSv2 controls **who may act** — the agent gets one narrow permission while the merchant keeps ownership. The Uniswap v4 hook controls **how the payment must settle**. The Graph records **what happened**, by indexing the receipt. Close on: *identity, automated enforcement, and verifiable proof*. |
| 0:35–1:00 | The hook | the order band and `ETH → before swap → Uniswap v4 → after swap → USDC` | The merchant fixes the recipient, the USDC payout, the required amount and the deadline. The payer supplies only the order id, so they cannot replace those terms. The hook verifies the order before the swap and checks the realised output after it. A full fill pays the merchant and emits a receipt; a short fill reverts everything. The hook is the automation: full settlement or full revert, with no custody, fee, oracle or backend approval. |
| 1:00–1:20 | The receipt | "The receipt is independently queryable", read live from The Graph | This is the latest V3 settlement, read live from The Graph. It settled 0.001 ETH into 2.216294 USDC on Sepolia with zero hook fee. The receipt points back to the exact transaction and log. Show the Etherscan and subgraph buttons. |
| 1:20–1:30 | Close | the verified-live checklist | V3 uses the same deterministic hook address across four verified deployments, including Unichain. Sepolia is where we exercised the complete flow. ENSv2 controls who may act, Uniswap v4 enforces settlement, and The Graph proves it. |

**Do not scroll through, during the main walk:** what this deployment accepts exactly · merchant
mode · the raw ENSv2 permissions · the entity-id construction · the contracts and RPC checks · the
four chains · the earlier V1 proof. All seven are folded on the page and all seven are good answers
to judge questions. Opening one is a deliberate move, not an accident of scrolling.

**Never say "supported token" of the deployed V3.** Native ETH in and the chain's configured USDC
out is what the contracts enforce — `NativeInputOnly()`, `PayoutCurrencyNotAllowed(address)`, and
the hook's own refusal of any other pool shape at `beforeInitialize`. More inputs and more payout
assets exist only as unimplemented specifications. The hero sentence is accurate as written.

**And the three numbers on the payment card are not a contradiction.** Current pool quote, minimum
for a newly created order, and the previous verified settlement are three different things; the card
labels each and says the pool price has moved since the settlement. If asked: the pool is thin on
purpose, and V3's own settlement is part of why the price is where it is.

## The sequence the demo shows

```text
Order created
→ official Uniswap v4 execution infrastructure
→ settlement invariants enforced
→ recipient receives output
→ order consumed exactly once
→ canonical receipt emitted
→ receipt indexed by The Graph
```

> **This table is V1's record, written 2026-09-05.** The arrows and the invariants are unchanged in
> V3 — it is the same sequence — but every address, block and amount below is V1's, and the last row
> is out of date: the subgraph **is** deployed to Subgraph Studio and indexes both generations. V3's
> equivalent numbers are in the walk above and in the README's "V3 has settled" block. Kept as
> written, because the record of what was proven when is the point of having it.

Each arrow is a fact with a proof, on the live chain (Ethereum Sepolia, chain id 11155111):

| Step | Where it is proven |
|---|---|
| Order created | `createOrder` at nonce 457, block 11640026; the order's recipient, amount, minimum and deadline live in the executor's storage and nowhere else (invariant I1) |
| Official Uniswap v4 execution infrastructure | the settlement's `Swap` event on the PoolManager names Uniswap's Universal Router (`0x3A9D…F98b`) as sender; `verify-live.sh` row "the settle transaction's swap was sent by the Universal Router". The hook admits no other swap sender |
| Settlement invariants enforced | the hook's `beforeSwap` and `afterSwap` checks (`docs/INVARIANTS.md`), 54 tests including the refusals, and the live first attempt refused by `DeadlineInPast` |
| Recipient receives output | the recipient's USDC grew by exactly the receipted `amountOut`, 2,003,660 units (`verify-live.sh`) |
| Order consumed exactly once | the order is `Settled` (status 3) and a replay of `pay` reverts (`verify-live.sh`) |
| Canonical receipt emitted | `SettlementReceipt` v1 from the hook in tx `0x1120af18…cb83`, `docs/RECEIPT-SCHEMA.md` |
| Receipt indexed by The Graph | the subgraph in `integrations/graph/`, its tests against the live receipt, and the local end-to-end run. Hosted indexing in Subgraph Studio awaits the owner's deployment; until then the claim is "indexable, and indexed locally" |

## Claims policy

- **Universal Router**: claimed, because the live trace proves it (the `Swap` event's sender). If a
  future trace does not show it, the claim goes.
- **World, ENS, Privy**: not claimed. `docs/INTEGRATIONS.md` describes the seams; none is
  implemented or demonstrated, and the card says so if asked.
- **The Graph**: "indexable receipt, indexed by a local run" until the Studio deployment exists.
- **Never**: "first", "only", "audited", "endorsed by Uniswap", or a successful swap while the pool
  is thin. The live pool is small and one-directional (`docs/DEPLOYMENT.md`, "Protecting the live
  pool"); the demo settles what the pool can pay or is refused, and the refusal is part of the demo.
- The specification and threat model were written before the event; every line of code was
  written during it. Said on camera and in the submission.

## Evidence that is authoritative, and evidence that is convenience

Authoritative: RPC receipts read by hash, bytecode and Sourcify matches, `verify-day1.sh` (14) and
`verify-live.sh` (31). Convenience: explorer captures in `docs/proof/`, labelled as such.
