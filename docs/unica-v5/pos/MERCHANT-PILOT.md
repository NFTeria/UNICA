# UNICA v5 — a two-month merchant pilot, written as a barbershop would live it

Research draft for owner review. Not committed as a commitment. Authorizes nothing: no real-value
operation, no merchant onboarding, and no claim that UNICA replaces a shop's point-of-sale,
accounting, tax, refund, card-processing or banking systems.

This document exists because a pilot is the honest unit of evidence. A demo shows a mechanism
works once; a pilot shows whether a business wants it. It is written against what UNICA can
actually do today, and every place the plan outruns the software is marked.

## 0. The shape of the claim

A barbershop uses UNICA as a crypto point-of-sale and a merchant identity. Over two months the
goal is **a controlled pilot with evidence**, not routing a shop's revenue through a demonstration
pool.

## 1. Month 1 — set up and test

### Week 1: merchant onboarding

The owner creates a verified merchant profile (for example `freshcuts.unica.eth`), connects the
shop's payout wallet, chooses which assets customers may pay in and which asset the shop receives,
enrols an iPad as a terminal, gives staff cashier access **without** control of the payout wallet,
and puts a QR code on the counter. The merchant's ENS identity and its deterministic artwork help a
customer confirm they are paying the right shop — as a recognition cue, never as proof. The client
still verifies the name, the resolved address and the market independently.

### Week 2: staff rehearsal, at no value

1. The barber enters a $25 haircut.
2. UNICA creates an order naming that specific customer as payer.
3. The customer reviews shop, amount, token, network and expiry.
4. The customer authorizes.
5. UNICA validates the order and converts the customer's token if conversion is required.
6. The shop receives its configured payout asset.
7. Both sides get a verifiable receipt.

Staff rehearse the failures, because the failures are the product: expired orders, wrong-wallet
attempts, failed transactions, stale-price and paused-market warnings, receipt lookup, revoking a
lost terminal, and telling a testnet payment from a real one.

### Weeks 3–4: a limited pilot

Haircuts, beard trims, product sales, appointment deposits, and tips only if separately and
clearly authorized. Every order carries shop identity, exact price, intended payer, accepted
payment asset, merchant payout asset, expiry, minimum merchant output, and a settlement receipt.
Each evening the owner reconciles UNICA receipts against the till.

## 2. Month 2 — controlled operation

### Weeks 5–6: daily use

```text
Select service → Enter total → Create order
→ Customer scans or connects → Customer approves
→ Payment settles → Receipt appears
```

The barber sees one of: awaiting customer, processing, paid, expired, failed, market paused, wrong
payer, wrong network.

**No screen, role or override marks an unpaid haircut as paid.** "Paid" exists only when the
settlement event is read back from the chain.

### Week 7: merchant operations

Payments by day; amounts received; which assets customers paid in; which assets actually arrived;
failed and expired orders; receipts by cashier and terminal; settlement transaction hashes; the
market and contract versions used; and the difference between till totals and on-chain receipts.
An indexer makes that history searchable; the chain remains the source of truth.

### Week 8: assessment

Did customers want to pay this way? Was checkout too slow? Were the displayed fees and rates
acceptable? Did staff understand the failures? Were receipts easy to reconcile? Was the payout
asset useful? Did any payment need manual support? Expand, pause, or stop?

## 3. One transaction, end to end

A $30 haircut: the barber selects it; the customer connects a wallet; the terminal confirms the
customer is the order's named payer; the customer sees the merchant name, $30, the token spent, the
asset the shop receives, network and fees, and the quote expiry; the customer approves; UNICA
validates and executes through the approved market; the shop receives its payout asset; the receipt
appears for both sides.

## 4. What the demonstration pool changes — measured, not assumed

**The published demonstration pool cannot carry ordinary $20–$50 payments.** Measured 2026-09-11 on
the live page: a quote for 0.001 ETH returns approximately 0.468024 USDC, and the page refuses
below its own 0.5 USDC floor with "the demo pool is too thin for a meaningful settlement." The
owner characterises the seeded depth as roughly five dollars; the number this document asserts is
the measured quote and the refusal, not the seed.

So during a first pilot the shop uses one of:

1. **No-value rehearsal** of the complete experience — available today;
2. **Very small real-value payments** inside the ledger's caps — $10 per transaction, $25 per day,
   $100 total at risk (`DECISIONS.md` Q5–Q7), and only for founder-controlled or specifically
   invited merchants (Q35); or
3. **Direct same-asset settlement with no conversion** — **OPEN, not available.** No such path is
   specified anywhere in `SPEC-CONTRACTS.md` or `SPEC-ORACLE-AND-CHAINS.md`. It would need a design
   and a ruling before a pilot could rely on it.

A shop must not take ordinary customer payments through the demonstration pool and present them as
production-ready. Real commercial operation needs reviewed liquidity, reliable price feeds,
suitable caps, legal and operational review, and a separate launch authorization.

## 5. What the plan outruns, stated plainly

| The pilot assumes | Status today |
|---|---|
| v4 markets, registry, terminals | **SPECIFIED, NOT BUILT.** The v4 contracts do not exist yet |
| A Privy-compatible wallet step | **CONDITIONAL.** No Privy account, app id or secret is provided (Q95–Q100) |
| ENS merchant and terminal identities | **RESEARCH.** Designed in `docs/unica-v5/ens/`, not deployed |
| Revoking a lost terminal | **RESEARCH.** Revocation stops future order creation; it never cancels a valid existing on-chain order |
| Searchable reconciliation | **PARTIAL.** A subgraph indexes V1 and V3 receipts on Sepolia today; the v4 evidence layer is designed in `docs/unica-v5/graph/` |
| Refunds | **NOT SUPPORTED** in v4 (`DECISIONS.md` Rec 41–43). A pilot must say so to customers before taking money |
| Tips | Only as a separately authorized order; never appended to an existing one |

## 6. What the shop would actually have learned after two months

A recognizable portable merchant identity; tablet checkout; customers paying in supported assets;
the merchant receiving its preferred asset; payer-bound orders no other wallet can complete;
verifiable receipts; cashier access without treasury control; revocable terminal identities;
searchable reconciliation; and less dependence on a single conventional provider.

The outcome is a measured pilot with evidence — not a claim that UNICA already replaces the shop's
complete payment, accounting and banking stack.
