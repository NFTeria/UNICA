# Owner actions — `integrations/arc-treasury`

Everything in this directory is read-only. Nothing in it can sign, send, fund, or deploy, and no
agent working in this repository may do any of those things. The steps below are the ones only the
owner can take, in the order they unblock each other.

**No credential appears in this file, and none should be pasted into it.** Where a step needs a key,
the key stays in the owner's wallet or in an environment variable the owner sets in their own shell.
Never paste a private key into a command that gets committed, logged, or shared.

**Nothing here is required for the module to be correct.** `test.mjs` (177 checks) and
`live-check.mjs` (20 checks) both pass today with no wallet, no key and no funds. These steps are
what would turn a rendered preview into a real transaction on Arc.

---

## Current status

| | |
|---|---|
| Status | `READY_FOR_ARC_DEPLOYMENT_ACTION` |
| Verified without an owner action | chain id, gas price, both decimal representations, the codeless emitter, the `address(0)` revert, the full policy and preview |
| Not verified, and only an owner can | that a preview this module built is accepted by the Arc mempool and mined |
| Funds held by this repository | none |
| UNICA contracts on Arc | none, and none are proposed |

---

## Step 1 — Get an Arc testnet account funded

**What:** obtain testnet USDC on Arc for an account the owner controls.

**Command:** none — this is a browser step.

> https://faucet.circle.com — select Arc testnet, paste the **public address** of the wallet you
> intend to use.

**Cost:** nothing. It is a testnet faucet.

**What it unblocks:** every step below. Until an account has a balance, the policy has nothing to
observe and every decision is `HOLD_BELOW_RESERVE`.

**Note on which balance you get.** Arc's native currency *is* USDC, so a faucet drip shows up in
both representations at once: `eth_getBalance` reports it at 18 decimals, and the ERC-20 at
`0x3600000000000000000000000000000000000000` reports the same money at 6. That is not two balances.
See the table in `README.md`.

---

## Step 2 — Point the console at your account and read the position

**What:** confirm the module reads your real balance, at the scale it reads from the contract.

**Command:**

```sh
node integrations/arc-treasury/live-check.mjs
```

Be exact about what that first command does: it re-derives the chain-level evidence — chain id, the
decimals reading, the codeless emitter, the gas floor, the `address(0)` revert — against a **fixed**
account, `0x0000…0000`. **It does not look at your account.** Your own position is read by the
console below, and only after you have edited `DEMO_CONFIG.merchant`.

Then, with your own address substituted for the demo one in `DEMO_CONFIG.merchant`
(`integrations/arc-treasury/server.mjs`):

```sh
node integrations/arc-treasury/server.mjs
# open http://127.0.0.1:8788
```

**Cost:** nothing. Every call is a read.

**If you also change `DEMO_CONFIG.rpc`:** only the endpoint's origin is ever printed or served — the
path and query are dropped before rendering, so a keyed endpoint does not end up in `/api/report`,
in a preview artifact, or on the page. Do not defeat that by putting a key in a hostname.

**What it unblocks:** step 3. If the page shows your balance and a decision, the inputs are real.

**What to check before continuing:** the page prints the ERC-20 decimals it read and the block it
read them at. If that number is not 6, do not proceed — something has changed on Arc and the whole
premise of the preview needs re-deriving, not overriding.

---

## Step 3 — Review a preview, field by field

**What:** read the transaction the policy would hand to a wallet, before any wallet sees it.

**Command:**

```sh
node integrations/arc-treasury/server.mjs
# http://127.0.0.1:8788 — the "Transaction preview" and "Decoded from those bytes" sections
```

**Cost:** nothing.

**What to verify, and this is the whole point of the artifact:**

- `to` is the **ERC-20 contract**, not the recipient. An ERC-20 transfer is a call to the token.
- `value` is `0x0`. An ERC-20 transfer moves no native currency. If `value` is ever non-zero on a
  transfer preview, stop.
- The **decoded** recipient matches who you intend to pay. It is decoded from the calldata bytes,
  not copied from the intent, so it would catch an encoder fault.
- The **decoded units** at the **decoded decimals** equal the human amount you expect. `400000000`
  at 6dp is 400 USDC. At 18dp it would be 0.0000000004 USDC — this is the field where a decimal
  error becomes visible.
- `maxFeePerGas` is at or above **20 Gwei**. Below Arc's mempool floor the transaction is not slow;
  it is declined.

**What it unblocks:** step 4. Do not sign anything you have not read in this form.

---

## Step 4 — Sign and broadcast (owner only, from the owner's own wallet)

**What:** turn the reviewed preview into a real Arc transaction.

**This repository cannot do this step and must not be asked to.** There is no signer in the
directory and no code path that broadcasts.

**The nonce is deliberately blank.** The preview renders `nonce: null` and the handoff prints
`(owner to supply)`, because nothing in this repository asked the chain for your account's nonce.
Supply it from your own wallet or tooling. If you ever see a nonce of `0` in a preview you did not
state, treat the artifact as untrustworthy and stop.

**How:** paste the reviewed `to`, `value`, `data`, `gas` and `maxFeePerGas` into your own wallet, or
into a `cast send` you compose yourself in your own shell with your own key. The key never enters
this repository, this file, or any command that is committed.

**Cost:** gas, in Arc's native USDC. At the observed 20.149 Gwei and a 65,000-gas limit the ceiling
is about **0.00131 USDC**. Plus the amount being transferred, which the preview states.

**What it unblocks:** the only claim this integration currently cannot make — that a preview it
built was accepted and mined on Arc.

**Read this before you broadcast.** Arc diverges from Ethereum in a way that matters here: a
blocklist revert **consumes gas and produces no receipt**. On Arc, "I got no receipt" does **not**
mean "it was not submitted". `arc.mjs` names these as separate outcomes
(`BROADCAST_NO_RECEIPT_GAS_CONSUMED` vs `NOT_SUBMITTED`) precisely so this decision is not guessed.
If a send yields no receipt, **do not simply retry** — establish which of the two happened first, or
you may pay twice for one payment.

---

## Step 5 — Record the evidence

**What:** capture what actually happened, so the claim can be checked later.

**Command:**

```sh
node integrations/arc-treasury/live-check.mjs > /tmp/arc-live-check.txt
```

Plus, from the owner's own tooling: the transaction hash, the block, and the receipt status.

**Cost:** nothing.

**What it unblocks:** the honest write-up. Until a hash exists, the correct status line is the one
this module ships with — that no transaction has been broadcast — and no document should say
otherwise.

---

## What no owner action can change

- **Uniswap is not on Arc.** No amount of funding creates a swap path. This module models none and
  none should be added.
- **Arc is testnet-only.** There is no mainnet to promote this to.
- **The ERC-20 reports 6.** If a future Arc deployment reports something else, the module reads it
  and uses what it reads — that is the design. It does not need editing to follow a change; it needs
  editing only if someone wants to override a reading, which is the one thing it is built to refuse.
