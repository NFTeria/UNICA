# web — the surface

One page, one action: a payer opens a link, sees what they are about to pay and who receives what,
and settles it in one click. No build step, no framework, no dependencies, no backend: a single
`index.html` that talks to a public RPC and the browser's wallet. It can be hosted anywhere that
serves a static file, which is the point.

## What it does

- Reads the chain back against everything it pins, before any control is enabled, and shows the
  reads in a panel beside the pinned values (next section).
- Reads the order named in `?order=0x…` from `SettlementExecutor.orders`, decoding the struct by
  hand from the returned words (no ABI library).
- Quotes the order's input from the pool's live `sqrtPriceX96` and liquidity, in integers, and
  enables the pay button only while the quote clears the order's stored minimum.
- Before either wallet action it shows exactly: payer (the connected account), recipient, input,
  minimum output, deadline (ISO and relative) and the wallet prompts to expect. Registration is
  one confirmation of `createOrder` with no value; payment is one confirmation of `pay(orderId)`
  carrying 0.001 ETH. It never promises a swap: the hook refuses or the recipient is paid;
  nothing in between.
- One button sends `pay(orderId)` with exactly the order's value, waits for the receipt, finds the
  hook's `SettlementReceipt` in the logs and renders what actually settled.
- Without a link it explains what a payment link is, and offers the merchant's side separately so
  a stranger can register an order to their own address and then try the payer's side. That
  order's minimum is 97% of the live quote, never a constant.
- Before the contracts exist on chain it says so plainly rather than failing.

## What it reads before it enables anything

On load the page performs one readback over the public RPC (`https://ethereum-sepolia-rpc.publicnode.com`)
and renders it as a panel, each live value beside the pinned value it is compared with. Nothing is
enabled until the panel agrees on every pinned row.

| Read | Compared with |
|---|---|
| `eth_chainId` | 11155111 |
| `eth_getCode` at the hook, byte count | 10634 |
| `eth_getCode` at the executor, byte count | 11289 |
| `hook.SETTLEMENT_EXECUTOR()` | the pinned executor |
| `executor.HOOK()` | the pinned hook |
| `StateView.poolManager()` | the pinned PoolManager |
| `StateView.getSlot0(poolId).lpFee` | 3000 |
| `StateView.getSlot0(poolId).sqrtPriceX96` | non-zero (a pool condition, not a pin) |
| `StateView.getLiquidity(poolId)` | greater than zero (a pool condition, not a pin) |

The pinned values, all in `CFG` at the top of the script, from tag `live-green` at commit `5e1d843`:

| Pinned | Value |
|---|---|
| chain | Ethereum Sepolia, 11155111 |
| hook | `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`, 10634 bytes |
| executor | `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`, 11289 bytes |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| StateView | `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C` |
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| pool id | `0xff4f4e2438f61817271cbd8399a925f5f99a1482f88c55419a2b69d0768e56db` (native ETH / USDC, fee 3000, spacing 60, this hook) |
| deployment block | 11639895 |
| canonical receipt | tx `0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83` |

Selectors are hand-encoded and each carries its signature in a comment, computed with
`cast sig`: `SETTLEMENT_EXECUTOR()` `0x8dec7ecc`, `HOOK()` `0xa54eb242`, `poolManager()`
`0xdc4c90d3`, `getSlot0(bytes32)` `0xc815641c`, `getLiquidity(bytes32)` `0xfa6793d5`. The footer
links both verified sources (Sourcify and Blockscout, per address) and the canonical receipt
(Blockscout and Etherscan). The page makes no request other than the RPC and the wallet: no
analytics, no fonts, no libraries.

## The quote

The live pool holds one full-range position, so an exact-input swap of `x` wei at fee `f` pips stays
on one curve. In integers, with the Q96 scaling explicit:

```
xf     = x * (1e6 - f) / 1e6
sqrtP' = ceil( L * sqrtP * 2^96 / (L * 2^96 + xf * sqrtP) )
out    = floor( L * (sqrtP - sqrtP') / 2^96 )
```

Control, before the function was trusted: at `sqrtPriceX96 = 3961408125713216879677197` and
`L = 204325880000`, the state the canonical receipt was paid at, `x = 1e15` gives **2003660**, the
receipt's `amountOut` exactly (difference 0). Re-run it any time with the function lifted from the
page:

```sh
node -e "$(sed -n '/^const Q96 = 1n << 96n;$/,/^}$/p' web/index.html)
console.log(quoteExactIn(10n ** 15n, 3961408125713216879677197n, 204325880000n, 3000n).toString())"
```

## When it disables everything

Every action is disabled, with a one-sentence reason shown, when any of these holds:

- the readback failed: "The chain could not be read (…), so nothing is enabled.";
- the readback disagrees with a pinned value: "Stale configuration: the chain disagrees with N
  pinned values in this page (marked below), so nothing is enabled until the page is corrected.";
- the pool has no liquidity: "The pool has no liquidity, so no payment could settle.";
- no wallet: "No wallet was found in this browser, so nothing can be signed; the read-only checks
  still ran.";
- the wallet is on another chain: "Your wallet is on chain N, not Ethereum Sepolia (11155111);
  switch it to continue." — with a button that asks the wallet to switch;
- registering, when the quote for 0.001 ETH is under 0.5 USDC: "the demo pool is too thin for a
  meaningful settlement";
- paying, when the quote is below the order's stored minimum: "the pool has moved below this
  order's minimum; the hook would refuse the payment and you would keep your ETH. Register a new
  order." That sentence is the invariant made visible.

The pay flow re-reads the pool right before it enables the button and once more right before it
sends, and the registration flow re-reads before it sends; if the quote moved while the visitor
was reading, the numbers on the page are refreshed and nothing is sent until they click again.

## Where it is deployed

<!-- Recorded by the owner after publishing. Two facts, nothing else: -->
- Deployed URL: _not yet published_
- Deploy commit: _not yet published_

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

Later the same day, against live Sepolia, the readback and its gates were exercised headless
(`Google Chrome --headless=new --dump-dom --virtual-time-budget=20000` on the file), and the gates
were validated by sabotage as well as by the passing case:

| Run | What the DOM showed |
|---|---|
| the file as committed | "7 pinned values checked, 7 agree, 0 disagree; pool liquidity 204325880000"; sqrtPriceX96 3184480767118830941639454; "minimum = 97% of the current quote of 1.346595 USDC"; the register control disabled with "No wallet was found in this browser…" |
| `CFG.hook` set to a wrong address, then restored | "7 pinned values checked, 4 agree, 3 disagree" (hook code 0 bytes, `SETTLEMENT_EXECUTOR()` empty, `executor.HOOK()` not the pin); every control disabled with "Stale configuration: the chain disagrees with 3 pinned values…"; the third dump, after the restore, back to 7 agree |
| a stub wallet on chain 1, then on 11155111 | chain 1: disabled, "Your wallet is on chain 1, not Ethereum Sepolia (11155111)…" and the switch button; 11155111: the register control enabled, payer and recipient showing the account |
| a stub open order with minimum 1.5 USDC, then 1 USDC | 1.5: pay disabled, "the pool has moved below this order's minimum; the hook would refuse the payment and you would keep your ETH. Register a new order."; 1: `Pay 0.001 ETH` enabled |
| the canonical settled order, and an unknown id | "Already settled" with the quote beside the minimum; "No such order" |

## Honest limits

- Ethereum Sepolia only. Test money.
- The addresses in `CFG` are CREATE2 addresses derived from the contracts' creation code, so they
  change whenever the contracts change (`docs/DEPLOYMENT.md`). They are pinned from tag
  `live-green` (commit `5e1d843`); if the chain ever disagrees with them the page says "stale
  configuration" and enables nothing, rather than guessing.
- The quote assumes the pool's single full-range position. If liquidity is ever added inside a
  narrower range the page's number would drift from the pool's; the hook's minimum, not the
  page's quote, is still what protects the recipient.
- The page trusts the public RPC it reads and the wallet it asks; it holds nothing and signs
  nothing itself.
- It renders the hook's receipt from the transaction it just sent. It is a view of the chain, not
  a source of truth about it: everything it shows is re-derivable with `make readback` and
  `bash docs/proof/verify-live.sh`.

## The brand, decided once

Four fields and a rule, recorded so nobody re-litigates them: ink `#14161A`, paper `#FBFBFA`,
accent `#0B6E4F`, radius `4px`, and the rule `cta-only` — the accent appears on the settlement
button and the focus ring and nowhere else. Text on the accent is computed, not chosen: white
reaches 6.25:1 against it and the ink colour only 2.90:1, so white wins. Ink on paper is 17.49:1
and the muted text 6.04:1. Spacing snaps to a 4px grid, body text is 16px, weights are 400, 500
and 700. A dark scheme swaps the same five tokens.

## Running it

Any static server, or open the file. To try it against a local fork rather than Sepolia, edit
`CFG.rpc`, `CFG.executor`, `CFG.hook`, `CFG.poolId` and `CFG.codeBytes` in a copy, since the
readback compares all of them; `integrations/graph/local-e2e.sh` shows how a fork is stood up.
