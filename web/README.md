# web — the surface

One page, one action: a payer opens a link, sees what they are about to pay and who receives what,
and settles it in one click. No build step, no framework, no dependencies, no backend: a single
`index.html` that talks to a public RPC and the browser's wallet. It can be hosted anywhere that
serves a static file, which is the point.

## What it does

- Reads the order named in `?order=0x…` from `SettlementExecutor.orders`, decoding the struct by
  hand from the returned words (no ABI library).
- Shows the recipient, what the payer pays, the minimum the recipient receives, the deadline and
  the status.
- One button sends `pay(orderId)` with exactly the order's value, waits for the receipt, finds the
  hook's `SettlementReceipt` in the logs and renders what actually settled.
- Without a link it explains what a payment link is, and offers the merchant's side separately so
  a stranger can register an order to their own address and then try the payer's side.
- Before the contracts exist on chain it says so plainly rather than failing.

## Proven against a real deployment

2026-09-05, on an anvil fork of Ethereum Sepolia with the contracts deployed by this repository's
own stages and one order registered through `createOrder`, the page was served and loaded in a
browser. All three views were read from the chain, not from fixtures:

| View | What the page showed |
|---|---|
| `?order=<the real id>` | `0.001 ETH`, the recipient, "at least 1.5 USDC", the deadline, status `open`, and the pay button enabled |
| no `?order=` | the payment-link explanation and the live count, "1 order has been registered" |
| `?order=0x…deadbeef` | "No such order: this link names an order the executor does not know" |

The decoders were also exercised directly against a constructed order and returned the recipient,
fee 3000, tick spacing 60, `0.001` ETH and `1.5` USDC. What is not yet proven here is the payment
itself, which needs a browser wallet and a live deployment; the same path is proven in Solidity by
`test/SettlementExecutor.t.sol` and end to end by `integrations/graph/local-e2e.sh`.

## Honest limits

- Ethereum Sepolia only. Test money.
- The addresses in `CFG` are CREATE2 addresses derived from the contracts' creation code, so they
  change whenever the contracts change (`docs/DEPLOYMENT.md`). They are filled in at deploy.
- The page trusts the public RPC it reads and the wallet it asks; it holds nothing and signs
  nothing itself.
- It renders the hook's receipt from the transaction it just sent. It is a view of the chain, not
  a source of truth about it: everything it shows is re-derivable with `make readback` and
  `bash docs/proof/verify-day4.sh`.

## The brand, decided once

Four fields and a rule, recorded so nobody re-litigates them: ink `#14161A`, paper `#FBFBFA`,
accent `#0B6E4F`, radius `4px`, and the rule `cta-only` — the accent appears on the settlement
button and the focus ring and nowhere else. Text on the accent is computed, not chosen: white
reaches 6.25:1 against it and the ink colour only 2.90:1, so white wins. Ink on paper is 17.49:1
and the muted text 6.04:1. Spacing snaps to a 4px grid, body text is 16px, weights are 400, 500
and 700. A dark scheme swaps the same five tokens.

## Running it

Any static server, or open the file. To try it against a local fork rather than Sepolia, edit
`CFG.rpc`, `CFG.executor` and `CFG.hook` in a copy; `integrations/graph/local-e2e.sh` shows how a
fork is stood up.
