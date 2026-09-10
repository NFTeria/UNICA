# web — the surface

One page, one action: a payer opens a link, sees what they are about to pay and who receives what,
and settles it in one click. No build step, no framework, no dependencies, no backend: a single
`index.html` that talks to a public RPC and the browser's wallet. It can be hosted anywhere that
serves a static file, which is the point.

The page is arranged as one spine — **identity → automated enforcement → verifiable proof**. ENSv2
says who may act, the Uniswap v4 hook says how the payment must settle, The Graph says what
happened. The Uniswap hook is the centre of the page because it is the centre of the product: the
merchant states a policy once and the hook executes it inside the swap. Everything a judge does not
need in the first minute — the RPC readback, the address inventory, the permission-bit arithmetic,
the role integers, the entity-id construction — is behind a disclosure rather than in the way.

**The page is pinned to V3.** It targeted V1 until 2026-09-10; V1 is now named in one small section
as prior evidence and is not mixed into the primary proof, because a V3 description carrying V1
addresses is the specific confusion the repointing exists to remove.

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
| `eth_getCode` at the executor, byte count | 12953 |
| `hook.SETTLEMENT_EXECUTOR()` | the pinned executor |
| `executor.HOOK()` | the pinned hook |
| `hook.PAYOUT_CURRENCY()` | the pinned USDC |
| `StateView.poolManager()` | the pinned PoolManager |
| `StateView.getSlot0(poolId).lpFee` | 3000 |
| `hook.receiptCount()` | at least 1 (a pool condition, not a pin) |
| `StateView.getSlot0(poolId).sqrtPriceX96` | non-zero (a pool condition, not a pin) |
| `StateView.getLiquidity(poolId)` | greater than zero (a pool condition, not a pin) |

Eight pinned rows and three pool conditions. `receiptCount()` is a condition rather than a pin
because it only ever grows: pinning it would turn every future settlement into a stale
configuration.

The pinned values, all in `CFG` at the top of the script, from tag `v3-settled-indexed` at commit
`8cdf141`:

| Pinned | Value |
|---|---|
| chain | Ethereum Sepolia, 11155111 |
| V3 hook | `0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0`, 10634 bytes |
| V3 executor | `0x015692C9E43ca19a2504F79368D1156A56680517`, 12953 bytes |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| StateView | `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C` |
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| pool id | `0xf9b873f83814234224be42592795ec812fb948a300188e0c597796171ab9c57a` (native ETH / USDC, fee 3000, spacing 60, V3's hook) |
| deployment block | 11667702 |
| settlement | tx `0x4f4acbd1b1ed07eccbcf0d7c6f6fcb23a397b619dd3a1dd7fcf7ed7456768854`, block 11675187, log 108 |
| earlier V1 receipt | tx `0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83`, block 11640026 — named in the page's one V1 section, not on the payment path |

**V3's executor and hook expose the same selectors as V1's, byte for byte**, which is why repointing
the page was an address change and not an ABI change. Each of the twelve was recomputed with
`cast sig` against `src/v3/` before this file moved, rather than carried over on the assumption that
they matched.

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

Two controls, one per generation, both re-run with the function lifted verbatim out of the current
page. Same `sqrtPriceX96` in each — both pools were opened at the same price — and a different `L`,
because they were seeded with different budgets:

| Pool state | `L` | Function returns | Receipt paid |
|---|---|---|---|
| V3, at the moment it was seeded | `400000000000` | **2216294** | 2216294 |
| V1, at the moment it was seeded | `204325880000` | **2003660** | 2003660 |

Difference 0 in both cases. Re-run either any time:

```sh
node -e "$(sed -n '/^const Q96 = 1n << 96n;$/,/^}$/p' web/index.html)
console.log(quoteExactIn(10n ** 15n, 3961408125713216879677197n, 400000000000n, 3000n).toString())"
```

The V3 row is worth reading twice. The same arithmetic also ran in
`test/v3/LiveFireV3Fork.t.sol` against the deployed contracts and **printed 2216294 before anything
was signed**; the chain then produced 2216294. A quote function that agrees with a live settlement to
the last digit, in advance, is a different kind of evidence from one that agrees afterwards.

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

> **These two tables are the 2026-09-05 record, run against the V1 pins.** They are kept rather
> than rewritten: what they validated was the readback machinery and the gates, and that machinery
> is unchanged by the repointing. The V3 run is the section below them.

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

## Verified against V3 — 2026-09-10

The page was repointed from V1 to V3 and served locally against live Ethereum Sepolia. Read out of
the rendered DOM, not out of the source:

| Panel | What the page showed |
|---|---|
| readback | "8 pinned values checked, 8 agree, 0 disagree; `receiptCount()` 1; pool liquidity 400000000000" — all eleven rows `agrees`, including the two new ones, `hook.PAYOUT_CURRENCY()` and `receiptCount()` |
| permission bits | "flags `0x20C0` = beforeInitialize \| beforeSwap \| afterSwap", computed from the V3 hook's own address with no RPC call |
| the subgraph | the V3 row: 0.001 ETH in, **2.216294** USDC out, fee 0, block 11675187, log index 108 — and "the subgraph indexes 2 settlements across both generations" |
| ENSv2 roles | `16 / 0 / 0 / 0` — SET_TEXT at one key, nothing at the name, nothing at the payment name, nothing at ROOT_RESOURCE |
| the demo card | the live quote, 1.774099 USDC for 0.001 ETH, and "1 order registered so far"; the register control disabled with "No wallet was found in this browser…" |

The V3 row is picked out of the subgraph's answer **by the emitting hook address**, not by position.
The subgraph now indexes two generations, and "the latest settlement" quietly becoming V1's is
exactly the confusion this page was rebuilt to remove — so the panel says which hook emitted the row
it is showing, and says so out loud if no V3 row comes back at all.

## Honest limits

- Ethereum Sepolia only. Test money.
- The addresses in `CFG` are CREATE2 addresses derived from the contracts' creation code, so they
  change whenever the contracts change (`docs/DEPLOYMENT.md`). They are pinned from tag
  `v3-settled-indexed` (commit `8cdf141`); if the chain ever disagrees with them the page says
  "stale configuration" and enables nothing, rather than guessing.
- **The demo pool is thin on purpose and it moves.** It was seeded with 0.008 ETH and 20 USDC, and
  V3's first settlement already pushed the price down measurably. The page reads the quote live and
  refuses to offer a registration under 0.5 USDC, so it degrades into an honest refusal rather than
  into a bad number.
- **Native ETH in, USDC out, and that is the contract rather than the demo.** `createOrder` reverts
  `NativeInputOnly()` on a token input and `PayoutCurrencyNotAllowed(address)` on any payout other
  than the chain's configured one, and the hook refuses a differently-shaped pool at
  `beforeInitialize`. `PAYOUT_CURRENCY` is `immutable`, read once from the chain id at construction.
  Widening either is specified and not implemented — `docs/INPUT-POLICY-SPEC.md` and
  `docs/PAYOUT-POLICY-SPEC.md` both open by saying so.
- **Four chains is availability, not a cross-chain payment.** Each deployment settles on its own
  chain; no bridge and no messaging protocol is integrated.
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
