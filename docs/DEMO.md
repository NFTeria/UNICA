# DEMO — the card, the sequence, and what may be claimed

UNICA is a public settlement infrastructure project for Uniswap v4. Its policy hook and narrow
executor enforce order-bound, full-fill settlement and emit an indexable receipt.

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
