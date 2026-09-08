# `integrations/arc-treasury` — an Arc-native USDC treasury flow

A merchant holds USDC on Arc. This module reads that position, decides **one** bounded action from
a closed vocabulary, and renders the transaction that action would hand to a wallet — then stops.

It exists mostly to get one thing right that this repository previously got wrong.

---

## The decimal law, and the claim it replaces

An earlier revision of `docs/ARC-FACTS.md` recorded:

> USDC is 18 decimals natively on Arc, not 6.

That is an **overclaim**, and correcting it is the point of this module.

What is true is a statement about the **native** currency. Arc's gas asset is USDC, and like every
EVM native currency its `eth_getBalance` and `msg.value` are a wei-like 18-decimal fixed-point
quantity. What does **not** follow is that an ERC-20 USDC contract reports 18.

Arc settles the question itself. There **is** a real ERC-20 USDC deployed on Arc testnet, at
`0x3600000000000000000000000000000000000000` — 1798 bytes of code — and asked for its own
`decimals()` it answers **6**.

The two representations then describe the *same pot of money*:

| | account `0x0000…0000` | reads as |
|---|---|---|
| `eth_getBalance` (native, 18dp) | `865034306417121744253729820` | 865,034,306.417121744253729820 USDC |
| `balanceOf` on the ERC-20 (6dp, as read) | `865034306417121` | 865,034,306.417121 USDC |

`native / 10^12 == token`, exactly. One pot, one value, a 27-digit integer in one representation and
a 15-digit integer in the other. Read that token balance at 18 decimals — as the old sentence
invited — and an account holding **865 million USDC** displays as **0.000865034306417121 USDC**.
Wrong by a factor of a trillion, and silently.

A comment saying "careful, these differ" would not have prevented that, because comments do not
fail. So the separation is in the **type system**:

- A native amount and a token amount are different types. Adding, subtracting, comparing or summing
  one against the other **throws** — there is no coercion path.
- A token amount cannot be constructed without a scale, and a scale cannot be constructed from a
  number. `decodeDecimalsReturn` takes the **bytes a contract returned**. To fabricate a scale you
  would have to fabricate a `decimals()` return word, which is exactly the reading.
- The Arc case where there is genuinely nothing to ask — the system emitter at `0xffff…fffe` holds
  zero bytes of code and returns empty — is a **named refusal**, `DECIMALS_EMPTY_RETURN`. Never a
  fallback to 6, never a fallback to 18.
- The one bridge, `toNative`, makes the caller restate both scales and write down *why* the
  conversion is sound. A wrong assumption becomes a visible disagreement instead of a silent rescale.

## What it does

`treasury.mjs` is a pure function. Given a reserve floor, a per-action cap, a cooldown, an approved
counterparty set, an observed ERC-20 balance and an observed native balance, it returns exactly one
action from a closed set:

| action | when |
|---|---|
| `NO_ACTION` | at or above the floor, nothing requested |
| `RELEASE_APPROVED_PAYMENT` | an approved counterparty, inside every cap, reserve intact afterwards |
| `RESTORE_MINIMUM_RESERVE` | under the floor, an approved source can cover exactly the shortfall |
| `HOLD_BELOW_RESERVE` | under the floor with no source, or a source too small — an active decision, not an absence of one |
| `REFUSED` | the inputs do not describe a position it can reason about; carries one of 19 reasons |

The branch that justifies the whole type system is `INSUFFICIENT_NATIVE_FOR_GAS`. On Arc, gas is
paid in the native 18-decimal currency; the merchant's holdings are the ERC-20. A merchant can hold
a million USDC as a token and be unable to send any of it. Code that added the two balances would
see a healthy treasury and build a transaction that cannot be included. Here the addition is
impossible, so the condition has to be checked — and it is.

## What it deliberately does not do

- **No swap, no DEX, no price oracle, no route.** Uniswap is not deployed on Arc, and this project's
  standing ruling is that Uniswap is its exclusive DEX. There is no swap path on Arc and inventing
  one would be a fake integration. Nothing here quotes or prices anything.
- **No UNICA contract is deployed on Arc.** None exists. This module asserts no UNICA address on
  Arc and never has.
- **It cannot sign and it cannot broadcast.** There is no key, no `secp256k1` and no wallet, and no
  code path that calls `eth_sendRawTransaction`. `arc.mjs` enforces a read-only method allow-list; a
  write method is refused before a request is built. `preview.mjs` performs no network I/O at all.
  The suite asserts this against the source, and validates the scanner by feeding it a known-bad
  file first. Be exact about the scope of that assertion: the scanner reads `preview.mjs`,
  `server.mjs` and `treasury.mjs` with comments stripped, so the write-method NAMES do appear as
  strings in `arc.mjs`'s allow-list logic and in `test.mjs`'s own regex. What is absent is a call,
  not the word — and `arc.mjs`'s protection is the allow-list itself, not the scan.
- **Arc is testnet-only.** There is no Arc mainnet, and nothing here claims otherwise.

## Files

| file | what it is |
|---|---|
| `units.mjs` | the two representations, the guard, and the reading-required scale |
| `arc.mjs` | read-only RPC client; chain-id gate, 20 Gwei floor, `address(0)` refusal, submission-outcome vocabulary |
| `treasury.mjs` | the deterministic policy — pure, no clock, no randomness |
| `preview.mjs` | a decision rendered as an unsigned transaction, decoded back out of its own bytes |
| `server.mjs` | read-only JSON over Node's `http`, bound to `127.0.0.1` |
| `app.html` | the page: position, policy, decision, preview |
| `test.mjs` | 177 offline deterministic checks |
| `live-check.mjs` | 20 checks re-derived against real Arc RPC |
| `transcript.json` | recorded chain reads; the offline suite replays them, `live-check` re-derives them |

No dependencies. Node 22 built-ins only. The keccak and ABI word encoders are this repository's own
(`web/ensv2/keccak.mjs`, `integrations/permit2/digest.mjs`) — every selector is derived from its
signature, never pasted.

## Running it

```sh
node integrations/arc-treasury/test.mjs         # offline, deterministic, no network, no key
node integrations/arc-treasury/live-check.mjs   # read-only against real Arc RPC
node integrations/arc-treasury/server.mjs       # http://127.0.0.1:8788
```

`test.mjs` needs no network and will not touch one — its transport throws on any request it has no
recording for, so an offline run cannot impersonate a live one.

`live-check.mjs` fails closed on the wrong chain: a chain id that is not Arc's stops the run and
exits **1**. An unreachable RPC is reported as a counted `SKIP` and is never printed as a pass — but
the process still **exits 0**, because a SKIP is not a failure. A gate row that reads only the exit
status will therefore go green on a machine with no network, having verified nothing, so this runner
belongs on a live target rather than in the offline gate.

Override the endpoint with `ARC_RPC_URL`. Only the endpoint's **origin** is ever printed or embedded
in an artifact — the path, query and userinfo are dropped, because that is where a project key
lives.

Both runners end with a line of the form `checks run: N, passed: P, failed: F` and exit non-zero
when `F > 0`.

## How the guards were validated

A check that has never failed is not a check. Each was fed a known-bad input and had to go red:

Each row below was produced by editing the named line, running `node integrations/arc-treasury/test.mjs`,
and restoring the file byte-for-byte afterwards.

| sabotage | result |
|---|---|
| `sameKind`'s kind check never fires | 8 rows red |
| `decimals()` empty return falls back to 18 | 1 row red |
| gas branch removed (`canPayGas = true`) | 6 rows red |
| the 20 Gwei fee floor never fires | 3 rows red |
| the `address(0)` refusal never fires | 2 rows red |
| `preview.mjs`'s token/scale pairing guard never fires | 1 row red |
| `recordedTransport` invents an answer instead of refusing | 1 row red |
| the read-only method allow-list never fires | 3 rows red |
| the approved-counterparty set never fires | 4 rows red |
| `sub()` clamps at zero instead of refusing | 2 rows red |
| `tokenBalance`'s scale/token pairing guard never fires | 2 rows red |
| `toNative`'s width refusal removed | 1 row red |
| `publicEndpoint` returns the full URL again | 3 rows red |
| an unstated nonce renders as `0` again | 2 rows red |
| the signer scanner, fed a file that really does sign | fires, as required |
| a UNICA deployment address pasted into any file here | the live-check row goes red, exit 1 |

Restored, the suite returns to 177 passed, 0 failed, and `live-check.mjs` to 20 passed, 0 failed.

The last four code rows above are regressions: they were **green under sabotage** in the first
version of this module and are now covered.

## Owner actions

Everything that costs money or signs anything is the owner's. See `OWNER-ACTION.md`.
