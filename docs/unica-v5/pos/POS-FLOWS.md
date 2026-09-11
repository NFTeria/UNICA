# POS-FLOWS — UNICA v5 point-of-sale interaction and information architecture

Engineering record. Scope: the merchant countertop workflow for a future UNICA v5 point-of-sale
surface — screens, sequencing, the confirmation boundary, and failure paths — built strictly on
what the UNICA v4 contracts specify today. **UNICA v5** is the PROPOSED future dashboard/POS
release named in `docs/unica-v4/DECISIONS.md`'s standing owner ruling. **UNICA v4** is the deployed
contract release specified in `docs/unica-v4/SPEC-CONTRACTS.md`. **"Uniswap v4"** is the AMM UNICA
v4 is built on. Nothing in this file authorizes starting, building, scheduling, or announcing
UNICA v5, and nothing here changes a single line of UNICA v4's contracts.

Statement classes used throughout: **VERIFIED** (the contract specification or an official external
source is cited and was read), **PROPOSED** (a UNICA product-design choice made in this document,
not fixed by any ledger item), **UNKNOWN** (neither confirmed nor safely inferred; never guessed).
Every external claim carries its source URL and "accessed 2026-09-11"; a source that did not load
after one retry is marked **UNREAD** and nothing is inferred from it.

This directory carries sibling documents that own adjacent concerns and are not duplicated here:
`ADAPTIVE-LAYOUT.md` owns viewport/responsive mechanics (breakpoints, safe areas, foldables,
external-display behaviour); `ACCESSIBILITY.md` owns exact touch-target sizes, contrast and
screen-reader semantics; `THEMES.md` owns the visual design-token system; `HARDWARE-OPTIONS.md`
owns terminal hardware selection; `PRIVY-DEVICE-MODEL.md` owns device custody and the shared-device
threat model. This file specifies *what information and controls appear in each state and who
authorizes what* — the interaction and information architecture — and points to those files for
their own detail rather than restating it.

## Contents

1. Purpose and method
2. UNICA v4 facts this design must respect
3. Roles and the confirmation boundary
4. The sequencing correction: capturing the payer before the order exists
5. Screen architecture
6. What must always remain visible
7. The flow, state by state
8. Accepting a customer whose address is not yet known
9. Flags for the owner — not resolved here
10. Cross-references
11. Sources
12. Uncertainties

## 1. Purpose and method

This document designs the countertop workflow a merchant and a customer step through to complete
one UNICA v4 settlement, from merchant sign-in through shift-close reconciliation. It is written
from `docs/unica-v4/SPEC-CONTRACTS.md` (order creation: who may create an order, which fields the
creator chooses, where the payout recipient comes from), `docs/unica-v4/EVENT-SCHEMA.md` (what a
surface may read and when it may call a payment "settled"), `docs/RECEIPT-SCHEMA.md` (the frozen,
unrelated schema v1 receipt, cited only to show it is *not* the UNICA v4 shape), `docs/unica-v4/
V5-DEFERRED.md` (what UNICA v5 may not silently assume), and `docs/v2/SECURITY-ADVISORY-001.md`
(the one closed defect class this design must not reopen). No file outside this document's own
path is edited, and `docs/unica-v4/` is read-only here.

Because the payer is bound into an order at creation and cannot be changed afterward (§2), the
plain numbered order of steps, which puts order creation before wallet connection — "create the order" before "connect the
customer's wallet" — cannot be built as literally numbered. §4 states the correction plainly rather
than hiding it inside the flow.

## 2. UNICA v4 facts this design must respect

All VERIFIED, cited to `docs/unica-v4/SPEC-CONTRACTS.md` (SC), `docs/unica-v4/EVENT-SCHEMA.md`
(EV), `docs/RECEIPT-SCHEMA.md` (RS), `docs/unica-v4/V5-DEFERRED.md` (VD), and
`docs/unica-v4/DECISIONS.md` (Q-numbers) unless marked otherwise.

| # | Fact | Source |
|---|---|---|
| F1 | `createOrder(recipient, payer, amountIn, minOut, deadline, salt)` is called by an allowlisted **order creator** (or ADMIN), never by the payer or a router. It checks `recipient` is non-zero and not one of a small reserved-address set, and `payer` is non-zero — nothing more. There is no on-chain merchant record binding `recipient` to whoever is calling. | SC §9.1, §4 |
| F2 | Only the exact address named as `payer` may call `pay(orderId)`; every other caller reverts `WrongPayer`. The payer cannot be changed after creation. | SC §9.1, §9.3 |
| F3 | Creating an order moves no funds. The executor holds no balance at rest; input is pulled only inside `pay`. | SC §5 |
| F4 | An order settles completely or not at all. There are no refunds, subscriptions, or partial payments in UNICA v4. | VD §5, §6; `DECISIONS.md` Rec 41–43 |
| F5 | Public payment links — any flow where the payer is not named at order creation — are UNICA v5 scope, gated behind a signed-intent security review starting from Advisory 001, and do not exist today. | VD §8; Q128 |
| F6 | Lifecycle is PROPOSED → INITIALIZED → SEEDED → ACTIVE → PAUSED → RETIRED. `STALE_ORACLE` and `MARKET_CLOSED` are *computed*, never stored, read live from `oracleCondition()`. Settlement fails closed; there is no demonstration-rate fallback for a live oracle failure. RETIRED is terminal. | SC §5, §8.2 |
| F7 | PAUSER may pause but never unpause. Only the ADMIN (a Safe, once ready) may unpause or retire. | SC §4 |
| F8 | A `SettlementReceipt` is evidence, not success — "the merchant is not yet proven paid." The success signal is the executor's `Settled` event, emitted last. A surface may call a payment "Paid" only after reading back a mined transaction (status 1) holding both the receipt and `Settled` for the expected order id. No screen, role, or override may mark an order paid. | EV §5, §6.2 |
| F9 | There is no UNICA fee in the beta. LP fee, protocol fee, and swap fee are disclosed as rates, separately from the (always-zero) UNICA hook fee. | SC §11; Q55, Q58 |
| F10 | UNICA never requests or handles seed phrases. v4 surfaces collect nothing themselves. No webhooks before mainnet. Privy is conditional: account, app id, and server secret are **NOT PROVIDED**. | Q53, Q94, Q45, Q95–Q98, Q100 |
| F11 | Beta caps: $10 per transaction, $25 per day (enforced on-chain, per market); $100 total at risk across markets (a deployment-script and manifest refusal, not an on-chain invariant). Founder-controlled or invited test merchants only. | Q5–Q7; SC §2, §7; Q35 |
| F12 | The order id has no ceiling on `deadline`, and there is no cancel. "Expired" is computed from the deadline at read time. | SC §9.1 ("cut 9"); EV §6.1 |
| F13 | `docs/RECEIPT-SCHEMA.md`'s `SettlementReceipt` (12 fields, one non-indexed `payer`, `policyId`) is the frozen, unrelated schema used by an earlier generation. It is never edited and is not the UNICA v4 shape. The UNICA v4 receipt is the 16-field event documented in `EVENT-SCHEMA.md` §5. This document designs against the UNICA v4 shape only. | RS; SC §11; EV §5 |
| F14 | The wireframe fixture available today is the frozen 46630 settlement: Robinhood test TSLA (no real value) settled into uTUSD, a 6-decimal test payout token (no real value); the one experimental settlement delivered 0.393052 uTUSD to the merchant. That deployment is experimental and is not UNICA v4. | `docs/experimental/STOCK-46630-FEE-FIELD.md`, as cited by SC §1.1, §11.1 |
| F15 | The merchant "settings" recommendations (business profile, accepted assets, one settlement stablecoin, min/max payment, expiry) map onto what exists on-chain as: the market's write-once payout token, the `recipient` each order names, `maxPerTxPayout`, and the order's own `deadline`. There is no on-chain merchant id or per-merchant asset list. This gap is an open owner scope decision, not something this document resolves. | SC §9.2 |

## 3. Roles and the confirmation boundary

Two different keys sign two different things, and confusing them is the single easiest mistake a
countertop design can make.

**Order creation** is a state-changing, gas-paying transaction signed by an **allowlisted order
creator** — an address the registry's ADMIN has explicitly enabled (`setOrderCreator`), or ADMIN
itself (SC §4, §6). This is never the customer. It commits the order's terms (`recipient`, `payer`,
`amountIn`, `minOut`, `deadline`) to chain, but moves no funds (F3).

**Payment** is a separate transaction — `pay(orderId)`, plus an ERC-20 `approve` if the payer has
not already granted the executor sufficient allowance — signed by the **payer alone** (F2). This is
the only signature that can move the customer's funds, and it is made on the customer's own device.

**PROPOSED — where the order-creator key lives.** This document proposes the order-creator key is
held by a merchant backend service, never by the countertop terminal or its customer-facing display.
The terminal requests order creation over an authenticated channel; the backend is the only thing
that ever holds a private key with order-creator standing, and it hard-codes `recipient` to the
store's configured payout address rather than accepting a caller-supplied one. The reasoning:

- The allowlist is invitation-only during the beta (F11), a deliberately small, managed set of
  keys — placing one on every physical terminal in a store network would multiply that trusted
  surface by the terminal count, for no benefit the contract requires.
- `createOrder` lets its caller choose `recipient` freely, checked only for being non-zero and not
  reserved (F1). Nothing on-chain stops an order creator from naming any other address. Keeping this
  key off countertop hardware, and fixing `recipient` in backend configuration that the countertop
  UI can never edit, is the mitigation this document adopts — see the flag in §9.

This split is exactly the "confirmation boundary" requested: **the only device and the only
signature that authorizes a payment is the payer's own device signing `pay(orderId)` (and, if
needed, the preceding `approve`).** Order creation authorizes an order's *existence and terms*; it
never authorizes a payment.

## 4. The sequencing correction: capturing the payer before the order exists

Because `payer` is bound at creation and cannot change (F2), the customer's wallet address must be
known **before or as part of** step 6 ("creating a payer-bound order"), not after it as the plain
numbered list implies. This document splits "customer wallet connection" into two sub-phases and
places the first one earlier than its number suggests:

- **7a — Address capture (lightweight, no signature).** The customer reveals a receiving address
  only — by a wallet's own "receive" QR code, an NFC tap, or a paired mobile session that returns an
  address and nothing else. No order exists yet; nothing is requested that a stranger's device could
  misuse, because revealing an address authorizes nothing.
- **7b — Session connection (capable of signing).** After the order exists, the customer's wallet
  establishes a connected session (WalletConnect pairing or an in-app browser session) able to sign
  `approve` and `pay`. On many wallets steps 7a and 7b are the same user action — connecting a wallet
  inherently reveals its address — and this design allows that collapse. On a lower-trust or
  QR-only device, 7a can happen without ever establishing 7b (a pure "scan to reveal address" flow),
  which is the honest minimum this document requires before order creation.

**Corrected order:** 4 (amount) → 5 (settlement currency / accepted asset) → 7a (capture payer
address) → 6 (create the order) → 7b (full wallet session, if not already open) → 8 (review and
authorize) → 9 (pending) → …

The numbers in the rest of this document keep their meaning from the original numbered list of steps; §7 states this
correction again at step 6 so a reader following the list in order is not misled.

## 5. Screen architecture

Three physical configurations, one information architecture:

- **Merchant screen.** Operated by staff. Numeric entry, sale composition, and — once an order
  exists — the same state (pending/success/failed) the customer sees, in a staff-oriented layout.
  Never shows an editable `recipient` field (§3, §9).
- **Customer-facing screen (optional second display).** Shows only what the customer needs to
  verify and act on: amount, currency, merchant identity as configured, a way to reveal a wallet
  address (7a) or connect (7b), the review screen (8), and the outcome. This is the Square Register
  dual-screen pattern — a dedicated display beside the main terminal showing only checkout-relevant
  information, so staff keep the operating screen and customers verify independently (Square, "What
  Is a Customer-Facing Display and Why Do You Need One?",
  <https://squareup.com/us/en/the-bottom-line/selling-anywhere/what-is-a-customer-facing-display>,
  accessed 2026-09-11) — an interaction pattern only; no Square branding, copy, or layout is
  reused.
- **Single-display mode.** When there is no second screen, the merchant screen stages through the
  same states, handing control to the customer's own phone for 7a/7b/8 and returning to a shared
  "waiting" view for 9–10, per §7's per-state notes.

**Wide layout (evaluated).** A wide countertop surface (an iPad-class device in
landscape) can present a two-pane layout: **LEFT** — number pad, the cart/invoice line, amount
controls; **RIGHT** — merchant identity, currency/network badges, the live quote ("Payment
details"), customer/payment state, and the receipt once settled. This maps directly onto the
Stripe Dashboard's own left-navigation, content-pane split (Home / Balances / Transactions /
Customers as distinct panes around a working area — docs.stripe.com/dashboard, accessed
2026-09-11) and Uniswap's "you pay / minimum received / advanced details" quote panel pattern
(developers.uniswap.org/docs/get-started/concepts/traders/swaps, accessed 2026-09-11) — interaction
patterns only, never their branding or exact composition. A narrower device stages the same
information as a single column, in the same top-to-bottom order the wide layout reads left-to-right
then top-to-bottom, so a merchant moving between an iPad and a phone never loses context. The exact
breakpoints, safe-area handling, and foldable/dual-screen behaviour behind both layouts are
`ADAPTIVE-LAYOUT.md`'s scope, not restated here; §7's wireframes below show content and grouping,
not pixel geometry.

## 6. What must always remain visible

On every merchant and customer screen, whenever an order exists: **amount, settlement currency,
merchant identity (as configured — never an editable field), network, applicable fees, the final
guaranteed payout, and testnet/mainnet status** (an always-visible "Test mode" badge, never absent,
never mixed with a "Mainnet" state in the same screen). This mirrors the owner's UX direction's
"always-visible Test mode / Mainnet badge" and "pool ids, hooks, ticks and raw units under 'Advanced
details'" rule; every wireframe in §7 keeps raw identifiers (order id, market id, hook, executor,
pool id) behind an explicit "Advanced details" disclosure, never in the primary view.

## 7. The flow, state by state

### 1 — Merchant sign-in

Off-chain. No UNICA v4 contract has any concept of a merchant account (F15). PROPOSED: staff
authenticate to the merchant backend that holds the order-creator key (§3); this sign-in never
touches that key directly, and never requests or displays a seed phrase (F10). Whether this sign-in
eventually uses Privy is conditional and **NOT PROVIDED** today (F10); this design does not assume
it. Device custody and shared-device risk for this step are `PRIVY-DEVICE-MODEL.md`'s scope.

```
+-------------------------------------------+
| UNICA POS                    [ TEST MODE ]|
|                                            |
|   Sign in to continue                     |
|   [ staff credential ]                    |
|   [ Continue ]                            |
+-------------------------------------------+
```

### 2 — Device enrollment

Off-chain, PROPOSED. Pairs a physical terminal (and its optional second display) to a merchant
account and a specific store, issuing a device-scoped session credential. The terminal never becomes
an order-creator signer itself (§3). Hardware selection for this step is `HARDWARE-OPTIONS.md`'s
scope.

### 3 — Store and terminal selection

Off-chain, PROPOSED. Staff pick which store profile (its accepted assets, settlement currency, and
fixed payout `recipient`, set once during back-office setup — never editable here) and which
physical register this terminal operates as. This is where the recipient-choice flag of §9 is
mitigated: the payout address is a read-only property of the selected store, not a field on this or
any later screen.

```
+-------------------------------------------+
| Store: Cafe A          Terminal: Register 2|
| Settlement currency: uTUSD (no real value) |
| Payout recipient: fixed by store setup     |
|                            [ Start sale ]  |
+-------------------------------------------+
```

### 4 — Entering an amount

Merchant-facing. The amount entered is denominated directly in the store's settlement currency
(the market's payout token — e.g. uTUSD, no real value) and becomes the order's `minOut` once scaled
to base units (F11's per-transaction cap, 10,000,000 raw units for a 6-decimal payout at the beta's
$10 ceiling, applies here — SC §9.2). PROPOSED: the pad refuses an amount above the store's
configured per-transaction cap before any chain call is attempted, so a refusal is instant rather
than a wasted transaction.

```
+-------------------------------------------+
| Amount due (uTUSD, no real value)          |
|                                             |
|              12.50                         |
|                                             |
|   [7][8][9]   [4][5][6]   [1][2][3]        |
|   [C][0][<-]                               |
|                                             |
|                      [ Charge customer ]   |
+-------------------------------------------+
```

### 5 — Selecting the requested settlement currency

PROPOSED definition adopted by this document (not fixed by any v4 spec text — flagged in §9 for the
owner to confirm or rename): this step chooses which **ACTIVE market** — one (asset, payout) pair —
fulfills the order. In practice the store's settlement currency (payout token) is usually fixed by
its configuration (§3), so this step surfaces only when the store accepts more than one input asset
into that same payout currency (Recs 38–39 permit this): the customer picks which accepted asset
they will pay with, shown on the customer-facing screen if a second display exists, before an order
is created. If the store accepts exactly one asset (the F14 fixture: one TSLA-only market), this
step is a non-interactive confirmation, not a choice.

```
+-------------------------------------------+
|  Pay with:                                 |
|   ( ) Robinhood test TSLA (no real value)  |
|   ( ) [ additional accepted asset, if any ]|
+-------------------------------------------+
```

### 6 — Creating a payer-bound order

**Corrected sequencing (§4): this step happens after 7a, not before it.** The order creator (the
merchant backend, §3) calls `createOrder(recipient, payer, amountIn, minOut, deadline, salt)` on the
chosen market's executor: `recipient` is the store's fixed payout address; `payer` is the address
captured in 7a; `minOut` is the amount from step 4; `amountIn` is computed from a fresh quote on the
chosen market (mirroring Uniswap's own "you pay ~X" pattern, recomputed at send time so the on-chain
oracle/deviation band check in `_checkOracle` is not tested against a stale number, SC §8.2);
`deadline` is a short countertop window. PROPOSED: 2–5 minutes, a product decision this document
does not fix further. No funds move here (F3); the transaction only fails if the market is not
ACTIVE, the caller is not an allowlisted creator, or an argument fails the checks in SC §9.1.

```
+-------------------------------------------+
|  Creating order...                         |
|  Waiting for the order-creation transaction|
|  to be mined. No funds move at this step.  |
+-------------------------------------------+
```

### 7 — Customer wallet connection

Split per §4: **7a** (address capture, precedes step 6) and **7b** (a signing-capable session,
established here if not already open from 7a). The customer-facing screen shows a QR/NFC target
carrying a one-time address-request, never an order — because no order exists until step 6 completes.

```
+-------------------------------------------+
|  Cafe A -- Testnet demonstration           |
|             no real value                  |
|                                             |
|  Amount: 12.50 uTUSD (no real value)       |
|  Pay with: Robinhood test TSLA             |
|            (no real value)                 |
|                                             |
|      [ QR / NFC: reveal your address ]     |
|                                             |
|  No order exists yet. Nothing is charged.  |
+-------------------------------------------+
```

### 8 — Customer review and authorization

**This is the confirmation boundary (§3).** After step 6, the order exists on chain with an id. The
customer's device — independently, over its own connection, never trusting a value the terminal
merely asserts — reads the order back from the executor (`orders(orderId)`, a view function; SC
§13) or decodes the `OrderCreated` event, and renders every field before requesting a signature:

```
+-------------------------------------------+
| Review payment                 [TEST MODE] |
+---------------------------------------------+
| You pay (max):        ~0.00102 test TSLA   |
|                        (no real value)      |
| Merchant receives                          |
|  (guaranteed minimum): 12.50 uTUSD          |
|                        (no real value)      |
| Recipient:             <read from chain,    |
|                         full address shown> |
| Network:               Robinhood Chain      |
|                         Testnet 46630       |
| Fees: LP 0.30% . Protocol 0% . UNICA 0%     |
| Price reference:  Demonstration rate --     |
|                    no oracle (never a       |
|                    market-priced quote)     |
| Expires in:            03:58                |
|                                             |
| This screen read the order above directly  |
| from the chain. Your wallet's own signing   |
| prompt may not show the recipient at all --|
| compare it against what is shown here       |
| before you approve.                        |
|                                             |
|  [ Approve token spend ]  (only if needed) |
|  [ Confirm and pay ]                       |
+-------------------------------------------+
```

**Why this screen, and not the wallet's own prompt, is where a substituted recipient is caught.**
`pay(bytes32 orderId)` takes only an order id as its argument; the recipient the funds ultimately
reach is stored in the order, not passed to the call the customer signs. A wallet that cannot decode
this specific, per-market contract call falls back to showing raw call data — "blind signing" — which
by definition shows no recipient at all; a wallet that *can* clear-sign a call shows "the function
being called, its arguments, and the recipient **contract** address" (the executor), not the
merchant the funds are ultimately routed to (Ledger, "Signing transactions and messages — design
guidelines", <https://developers.ledger.com/docs/device-app/integration/design-guidelines/
transactions>, accessed 2026-09-11). Neither outcome reveals the merchant. This design therefore does
not rely on the wallet's native confirmation screen for this check: the review page above performs
its own chain read before the wallet is asked to sign anything, and the customer is told, in plain
language, that the wallet's own prompt may not be enough. A multisig admin surface (Safe) follows
the same shape one layer up — a transaction is proposed, queued, and reviewed by each signer before
execution (Bitbond, "Gnosis Safe Multisig Guide for Projects",
<https://www.bitbond.com/resources/gnosis-safe-multisig-guide-for-projects>, accessed 2026-09-11) —
cited here only for the propose-then-independently-review shape this screen borrows, never for any
UI composition.

If the payer's device and the terminal disagree on any field — most importantly `recipient` — the
customer's own independent chain read is definitionally correct and the terminal's claim is not:
this is the whole point of reading the order back rather than accepting what the countertop display
says.

`approve` (if the payer's existing allowance to the executor is insufficient) is a standard ERC-20
approval and is shown as its own step, naming the **executor's** address as spender — never the
merchant — which is itself a reason the customer should not expect to see the merchant's identity in
any wallet-native prompt at any point in this flow.

### 9 — Pending settlement

Neither screen may say "Paid" here (F8). Both merchant and customer screens show the same amber
"submitted, not yet mined" state, with a link to the pending transaction.

```
+-------------------------------------------+
|  Waiting for network confirmation...       |
|                       [ TEST MODE ]        |
|  Do not close this screen. Nothing is      |
|  marked Paid until this transaction is     |
|  mined.                                    |
|  [ View transaction ]                      |
+-------------------------------------------+
```

### 10 — Success

Shown only after both the `SettlementReceipt` and `Settled` events are read back from a mined
transaction (status 1) for the expected order id (F8). Merchant and customer screens agree, because
both read the same chain state — neither is the source of truth for the other.

```
+-------------------------------------------+
|  Paid                          [TEST MODE] |
|  12.50 uTUSD (no real value) received      |
|  Confirmed on Robinhood Chain Testnet 46630|
|  [ View receipt ]        [ New sale ]      |
+-------------------------------------------+
```

### 11 — Failed or expired

Every revert in SC §9.3's guard table is translated to plain language; none is ever presented as a
partial charge, because UNICA v4 settles completely or not at all (F4) and a reverted transaction
returns the customer's tokens (gas aside). There is no cancel and no retry of the same order id
(F12) — a new order is created if the customer still wants to pay.

```
+-------------------------------------------+
|  Not settled                   [TEST MODE] |
|  Reason: <plain-language translation, e.g. |
|  "This order expired before it was paid.", |
|  "The allowed price range was exceeded",   |
|  "Your allowance was below the amount">    |
|  Nothing was charged. This order cannot be |
|  reused.                                   |
|  [ View transaction ]    [ New sale ]      |
+-------------------------------------------+
```

Representative causes, from SC §9.3 and §8.2: `OrderExpired` (deadline passed before mining),
`WrongPayer` (a different wallet attempted to pay — should not occur if 7a captured the right
address), `AllowanceTooLow` / `InputNotExact` (approval or a fee-on-transfer token), `PartialFill` /
`OutputBelowMinimum` (the pool could not fill at the quoted terms), `ExecutionBelowOracleBand` /
`ExecutionAboveOracleBand` (an oracle-enabled market only; price moved outside the configured band
between quoting and mining), `DailyCapExceeded` / `PaymentAboveCap` (a market-level cap was hit),
`MarketNotActive` (paused or retired mid-flow).

### 12 — Receipt display and delivery

Read-only, chain-sourced, in the UNICA v4 16-field shape (F13), never the frozen v1 shape. "Payment
details" show amount in, amount delivered, the guaranteed minimum, LP/protocol/UNICA fees as rates,
and the oracle reference or "Demonstration rate — no oracle" (EV §9). Raw identifiers sit behind
"Advanced details" (§6).

```
+-------------------------------------------+
| Receipt                        [TEST MODE] |
+-----------------------------------------------+
| Merchant received:  12.50 uTUSD (no real value)|
| Customer paid:       0.00102 test TSLA         |
|                      (no real value)           |
| Fees: LP 0.30% . Protocol 0% . UNICA 0%        |
| Reference: Demonstration rate -- no oracle     |
| Network:   Robinhood Chain Testnet 46630       |
| [ Open transaction on explorer ]               |
|-- Advanced details ----------------------------|
| order id, market id, hook, executor, pool id   |
|-------------------------------------------------|
| [ Print ]   [ Show QR to customer's wallet ]   |
+-------------------------------------------------+
```

**Delivery, PROPOSED and deliberately narrow.** Because v4 surfaces collect nothing themselves and
there is no webhook/API/database before mainnet (F10), this document proposes only two delivery
paths that require collecting nothing new: on-screen display, and a printed or on-screen QR code
linking to the public transaction (the customer's own wallet already shows the token movement in its
own activity history, independent of anything UNICA prints). Emailed or texted receipts would need a
new data-collection decision (an email or phone number, which nothing in v4's scope collects today)
and are explicitly out of scope for this document — see §9.

### 13 — Refund request (UNSUPPORTED in v4)

```
+-------------------------------------------+
| Refund request                 [TEST MODE] |
| UNSUPPORTED in UNICA v4.                    |
| This order settled completely and cannot be |
| reversed on-chain (V5-DEFERRED.md, S5).     |
| This form records a support note only. It   |
| does not move funds and does not change     |
| this order's on-chain status.               |
| [ File support note ]                       |
+-------------------------------------------+
```

The label is load-bearing: nothing on this screen may imply an order's on-chain state changed. A
"refund" here is a record for a human to act on outside the protocol, never a payment reversal.

### 14 — Shift close and reconciliation

Sourced only from on-chain receipts, per F8: an order counts as settled only when both its receipt
and `Settled` are found for a mined transaction. Where an indexer (The Graph) is unavailable — as it
is for chain 46630 today, per EV §10.1's own "UNKNOWN: not probed" note — the fallback is a bounded
RPC scan, reported with an explicit block range, never presented as complete (EV §10.3).

```
+-------------------------------------------------+
| Shift close -- reconciliation      [TEST MODE]   |
| Source: on-chain receipts only                   |
| Range scanned: block A to block B (bounded; not  |
| a claim of complete history)                     |
| Orders created:            14                    |
| Settled (receipt + Settled pair found): 11       |
| Pending, unexpired:          1                   |
| Expired, unpaid:             2                   |
| Total delivered: 137.40 uTUSD (no real value)    |
| Anomalies: 0 (a Settled with no matching receipt,|
| or the reverse, would be listed here, not hidden)|
+---------------------------------------------------+
```

The "0 anomalies" line is stated, never implied by a blank screen (EV §10.2's own rule, adopted
here): an empty anomaly list and a broken reconciliation script must never look identical.

### 15 — Offline, degraded-RPC, and stale-price states

New sales are **refused, never queued**, whenever the terminal cannot verify current market state:
a queued sale would carry a price quoted before the gap, which the on-chain oracle-deviation check
(oracle-enabled markets) or a simply-outdated invoice (any market) could invalidate by the time it is
sent. Failing closed here matches SC §8.2's own settlement rule.

```
+-------------------------------------------+
| Offline -- cannot start a new sale         |
| No connection to the network. Order terms  |
| cannot be verified. New sales are refused, |
| not queued.                                |
| [ Retry connection ]                       |
+-------------------------------------------+
```

```
+-------------------------------------------+
| This market is paused                      |
| New orders are refused until an operator   |
| unpauses it. Orders already created remain |
| payable until they expire (SC S5).         |
+-------------------------------------------+
```

Distinct amber states, read live and never cached: `STALE_ORACLE` (an enabled oracle's reading is
too old — not reachable on the 46630 fixture today, whose policy is disabled and always reports
`DEMONSTRATION_ONLY`, SC §8.2) and `MARKET_CLOSED` (an equities market outside its trading hours,
Rec 27) both refuse new orders the same way a pause does, and both are shown, not silently treated as
"OK". Whether chain 46630's own RPC configuration offers a fallback endpoint for this terminal to
retry against was not read for this document (§12, uncertainty U1).

## 8. Accepting a customer whose address is not yet known

A walk-up customer who has not revealed an address (no 7a) cannot be given a payer-bound order (F2):
`payer` cannot be zero, and cannot be filled in later. The only way to accept such a customer without
7a is a **public payment link** — one authorization any wallet could complete — which
`docs/unica-v4/V5-DEFERRED.md` §8 names explicitly as UNICA v5 scope, gated behind a signed-intent
security review starting from `docs/v2/SECURITY-ADVISORY-001.md`. **This document does not design
that flow.** What follows tests the shape such a design would have to take against Advisory 001's
finding, to classify rather than resolve it.

Advisory 001 found that an earlier release's payer authorization witnessed only the payer's own half
of a deal — `quoteId`, `payer`, `tokenIn`, `maxIn`, `executor` — while the merchant's half
(`recipient`, `merchantSigner`, `tokenOut`, `amountOut`, `pool`, `deadline`) sat outside the signed
digest and was **substitutable by whoever submitted the transaction**. The fix the advisory
recommends, and both independent reviewers agreed on, is to bind the *complete* signed digest —
every merchant-chosen field — into what the payer signs, not to trust an allowlist of "legitimate"
submitters (a second legitimate merchant broke that mitigation in the advisory's own re-derivation).

Any future UNICA v5 customer-authorization design for an unbound payer must therefore bind, inside
one signed digest, at minimum:

| Field | Why Advisory 001 requires it inside the signature | v4's payer-bound equivalent today |
|---|---|---|
| Recipient (merchant payout address) | Was outside the witness in the vulnerable design; a forged copy with a different recipient produced an identical payer signature | `recipient`, chosen by the order creator at `createOrder` (F1) |
| The authorizing party's identity (equivalent to `merchantSigner`) | Self-referential checks (a signature over the same forgeable quote) do not bind anything; there is no merchant registry to check against | the order creator's on-chain allowlist standing (SC §4) |
| Output token and amount, or a minimum | `amountOut`/`tokenOut` sat outside the payer's witness; an attacker who also supplies the pool can raise the output and draw the payer's full ceiling | `minOut` (SC §9.1) |
| Which market / pool this settles through | Outside the witness in the vulnerable design | the specific executor `createOrder` is called on |
| An expiry | Already a payer-signed field in both designs | `deadline` (SC §9.1) |
| A single-use, digest-bound identifier | The vulnerable design's replay guard keyed on the *quote* digest, which the forgery changed only in the unwitnessed half — quoteId alone did not stop it; the fix is binding the *whole* digest, not just an id | `orderId`, derived from `(chainid, executor, creator, salt)` and consumed once (SC §9.1) |
| A ceiling on what one signature can authorize | The actual loss ceiling in the vulnerable design was the payer's entire signed `maxIn`, not the invoice amount | `amountIn` fixed once at order creation; caps checked again at `pay` (SC §9.2) |

**Who submits** matters for the same reason: the advisory's fix does not depend on trusting whoever
broadcasts the transaction, because every field that decides where funds go is inside the one digest
the payer already signed. Any public-link design that instead relies on an allowlist of trusted
submitters, or on any field living outside the payer's own signature, reopens the exact class of gap
Advisory 001 closed conceptually but that its host release has not yet shipped a fix for. **This
document does not propose, and no screen above implies, an unbound payment link.** Every order in
§7 names its payer before it exists on chain.

## 9. Flags for the owner — not resolved here

1. **`recipient` is a free parameter of `createOrder`, with no on-chain link to any merchant
   record (F1, F15).** §3's mitigation — hold the order-creator key in a backend that hard-codes the
   store's payout address, and never expose an editable recipient field anywhere in this design — is
   an **application-level convention**, not a contract guarantee: nothing on-chain stops a
   differently-configured order creator from naming any address. Flagged for the owner: should a
   future contract revision bind `recipient` to an on-chain merchant record (the SC §9.2 gap against
   Recs 32, 38–40)?
2. **`payer` is also a free parameter of `createOrder` (F1).** A mis-captured address (the wrong QR
   scanned, a stale 7a request reused) produces an order nobody but that address can pay — which
   fails closed rather than redirecting funds — but is still an operational failure mode. Flagged:
   should address capture (7a) carry its own integrity check beyond visual confirmation, before the
   backend spends gas creating an order that cannot be paid?
3. **`deadline` has no on-chain ceiling** (SC §9.1, "cut 9"). This document proposes a short
   countertop window (2–5 minutes) without fixing the exact figure. Flagged as a product decision.
4. **Order-creator key custody** — where it lives, how a terminal reaches it, what happens if a
   terminal or backend credential is lost or stolen — is `PRIVY-DEVICE-MODEL.md`'s scope, not
   designed here. This document only fixes the boundary (§3): the key is never on countertop
   hardware.
5. **The customer's own independent chain read (step 8) is only as trustworthy as the RPC endpoint
   it uses.** A malicious or merchant-controlled RPC endpoint fed to the customer's device could, in
   principle, lie about the same order. The only sound mitigation is the customer's wallet using its
   own configured chain connection, never one the terminal supplies — this document assumes that,
   flags it, and does not solve it further.
6. **Receipt delivery beyond on-screen and printed QR (§7, step 12)** — email or SMS — would require
   a new data-collection decision UNICA v4's "collects nothing itself" posture does not currently
   authorize (F10). Not proposed here.
7. **"Selecting the requested settlement currency" (step 5)** is defined in this document as
   choosing the ACTIVE market (asset → payout pair). This is a definition this document originates,
   not one any ledger item fixes. Flagged for the owner to confirm or rename.

## 10. Cross-references

- Viewport, breakpoint, and foldable/dual-screen mechanics for the layouts in §5: `ADAPTIVE-LAYOUT.md`.
- Exact touch-target sizes, contrast, and screen-reader semantics for every screen in §7:
  `ACCESSIBILITY.md`.
- The visual design-token system (color, elevation, typography) behind every wireframe: `THEMES.md`.
- Terminal and customer-display hardware selection for §5: `HARDWARE-OPTIONS.md`.
- Order-creator and staff-device key custody, shared-device risk, and Privy's actual (conditional)
  capabilities for §1, §2, §3, and flag 4: `PRIVY-DEVICE-MODEL.md`.

## 11. Sources

Internal (read in full before relying on any line above):

- `docs/unica-v4/SPEC-CONTRACTS.md`
- `docs/unica-v4/EVENT-SCHEMA.md`
- `docs/RECEIPT-SCHEMA.md`
- `docs/unica-v4/V5-DEFERRED.md`
- `docs/unica-v4/DECISIONS.md`
- `docs/v2/SECURITY-ADVISORY-001.md`

External, READ, accessed 2026-09-11:

- Stripe, "Web Dashboard" — <https://docs.stripe.com/dashboard> — used for: the left-navigation,
  content-pane information-architecture pattern referenced in §5.
- Uniswap, "Understanding Swaps" — <https://developers.uniswap.org/docs/get-started/concepts/traders/swaps>
  (reached via the site's own documentation redirect) — used for: the minimum-output / price-impact
  quote-transparency pattern referenced in §5 and §8's table.
- Ledger, "Signing transactions and messages — design guidelines" —
  <https://developers.ledger.com/docs/device-app/integration/design-guidelines/transactions> — used
  for: the clear-signing vs. blind-signing distinction underpinning step 8's design.
- Square, "What Is a Customer-Facing Display and Why Do You Need One?" —
  <https://squareup.com/us/en/the-bottom-line/selling-anywhere/what-is-a-customer-facing-display>
  — used for: the dual-screen merchant/customer pattern referenced in §5.
- Bitbond, "Gnosis Safe Multisig Guide for Projects" —
  <https://www.bitbond.com/resources/gnosis-safe-multisig-guide-for-projects> — used for: the
  propose-then-independently-review shape referenced in step 8. This source did not describe Safe's
  exact field-level decoding UI; no claim about specific Safe UI fields is made from it.

External, UNREAD (did not load after one retry; nothing inferred):

- `https://commerce.coinbase.com/` (redirected to `https://coinbase.com/commerce`, which returned
  HTTP 403). No Coinbase Commerce UI detail in this document is sourced externally; the owner's own
  UX-direction ruling (naming Coinbase Commerce's checkout as an interaction-pattern reference,
  `docs/unica-v4/DECISIONS.md` "UX direction") is cited as an internal decision, not verified against
  Coinbase's own current site.
- `https://docs.safe.global/home/what-is-safe` loaded (HTTP 200) but did not contain field-level
  detail about Safe's transaction-review UI; no specific claim is drawn from it beyond what Bitbond's
  guide (above) independently confirmed.

## 12. Uncertainties

- **U1.** Whether chain 46630's configuration provides a fallback RPC endpoint for the offline/
  degraded state in step 15 was not established: `config/chains/46630.json` and
  `SPEC-ORACLE-AND-CHAINS.md` were not read for this document (not part of the source list in §11).
- **U2.** Whether The Graph indexes chain 46630 is itself UNKNOWN per `EVENT-SCHEMA.md` §10.1's own
  "not probed" note; step 14's reconciliation is designed around the bounded-scan fallback for that
  reason, but the fallback's own performance at real order volumes was not measured here.
- **U3.** Whether any wallet will ever publish a clear-signing descriptor for UNICA v4's specific
  `pay(bytes32)` call is UNKNOWN. Step 8 is designed conservatively, assuming no wallet ever does.
- **U4.** Whether a merchant-name-resolution service (so the review screen in step 8 could show a
  human-readable name instead of a raw address) should back this design is an open v5 product
  question. No such service is assumed, designed, or referenced here.
- **U5.** Whether Privy's own transaction-confirmation UI, if Privy is ever actually configured
  (still conditional and NOT PROVIDED per F10), would decode this specific contract call any better
  than a generic wallet is UNKNOWN and is `PRIVY-DEVICE-MODEL.md`'s question, not answered here.
- **U6.** The exact countertop deadline window (flag 3, §9) and the exact enforcement point for a
  client-side per-transaction cap warning (step 4) are product decisions this document proposes a
  direction for but does not fix a final number for.
- **U7.** Real-device ergonomics — touch-target sizes, exact type scale, one-handed reachability on
  the wide layout of §5 — were not verified here; they are `ACCESSIBILITY.md`'s and
  `ADAPTIVE-LAYOUT.md`'s scope and this document's wireframes should not be read as pixel-accurate.
- **U8.** Whether "selecting the requested settlement currency" (step 5, flag 7) should instead be
  interpreted as a merchant-facing back-office setting rather than a per-transaction customer choice
  was not settled with the owner; this document adopted one reading and flagged the alternative.
