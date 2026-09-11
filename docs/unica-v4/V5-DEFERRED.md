# UNICA v5 — deferred scope

Draft for owner review, not committed, authorizing nothing (`DECISIONS.md` Q131). This file exists so
that nothing in `SPEC-CONTRACTS.md` or `SPEC-ORACLE-AND-CHAINS.md` is read as promising a feature v4
does not build. Every item below was considered for UNICA v4 and explicitly pushed out; each entry
gives the ledger or specification line that pushed it, not an opinion about whether it is a good idea.
Where the ledger disagrees with this file, the ledger wins.

"UNICA v4" is the modular tokenized-asset market release specified in `SPEC-CONTRACTS.md`, to be
built under `src/unica-v4/`. "UNICA v5" is the future dashboard release named in `DECISIONS.md`'s
standing owner ruling: *"UNICA v4 is the modular tokenized-asset market release. UNICA v5 is the
dashboard."* UNICA v5 does not start now. The ledger records no start condition for it; this file
proposes, for the owner to confirm, that it begins only after the owner approves the v4 deployment
report. Nothing in this file, or in the v4 specification set, authorizes starting it.

Each section below states: **what** was considered, **why it is not in v4**, and **what has to be true
first**, so a later v5 author does not have to re-derive the reasoning.

## 1. Merchant dashboard

**What.** The full merchant-facing product: registry-driven market discovery, live quotes, fee
disclosure, payment-link creation, and an admin pause control, laid out with the left-nav structure
(Overview, Payments, Payment links, Customers, Balances, Developers, Markets, Team, Settings) the
owner's UX direction describes.

**Why deferred.** `DECISIONS.md`'s standing ruling names the dashboard as UNICA v5 by definition, not
as a v4 stretch goal. `SPEC-CONTRACTS.md` §1.2 lists "UNICA v5, the dashboard" first under "Not in
scope." UNICA v4 ships contracts, their tests, and the read-only prototype fixtures described in
§14 of `SPEC-ORACLE-AND-CHAINS.md` — not a live merchant surface.

**First.** An owner ruling that starts UNICA v5. The ledger records no such condition; this file
proposes the owner's approval of the v4 deployment report, for the owner to confirm.

## 2. Analytics

**What.** Merchant-facing aggregation — volume, settlement counts, fee totals over time — beyond a
single order's receipt.

**Why deferred.** `DECISIONS.md` accepted recommendations 87 to 89: *"no API, database or webhooks in
v4 unless tier 2 ships"* (tier 2 has not shipped; the ledger does not define it further, and this file
does not guess). Recommendation 90 fixes v4's actual read surface: direct RPC for current state and
immediate confirmation, and The Graph for indexed history where the chosen chain is supported,
otherwise a bounded event indexer or a clearly limited beta history view. That surface answers "what
happened to this order"; it is not a persisted, aggregated analytics product, which needs the
database v4 does not have.

**First.** Tier 2 shipping, per Rec 87–89; a decision on which indexed source (The Graph vs. a bounded
event indexer) analytics reads from, per Rec 90.

## 3. Self-serve KYB

**What.** A merchant onboarding flow where a business supplies its own KYB information and is
approved without an operator in the loop.

**Why deferred.** `DECISIONS.md` Q34: *"No KYB provider."* Q108: *"NOT READY (merchant terms), so no
public merchant beta."* Q35 restricts the beta to *"founder-controlled or specifically invited test
merchants only."* Q33's beta business fields (business name, country, website, business email,
verified payout wallet) are collected for the operator to review, not through a self-serve intake —
there is no provider integration to verify them against.

**First.** A selected KYB provider (Q34), merchant terms (Q108), and the owner opening a public
merchant beta — none of which is a v4 contract concern; the order-creator allowlist (`DECISIONS.md`
Rec 111, `SPEC-CONTRACTS.md` §4) stays founder-controlled or invited-only regardless.

## 4. Webhooks, and their admin UI

**What.** Merchant-configurable webhooks (order events pushed to a merchant endpoint) and the
dashboard screen to manage them, under the Developers nav item in the owner's UX direction.

**Why deferred.** `DECISIONS.md` Rec 45: *"no webhooks before mainnet."* Rec 87 to 89 name webhooks
alongside API and database as blocked *"unless tier 2 ships."* `SPEC-CONTRACTS.md` §1.2 lists
"Webhooks, API, database (Q87–89)" under "Not in scope." Recs 105 to 107 (payout-wallet signature,
hashed API keys, HMAC webhooks) record an accepted design *"if those ship"* — the shape is agreed, the
shipping is not authorized, and no v4 contract emits, signs, or delivers a webhook.

**First.** Tier 2 shipping (Rec 87–89); mainnet reached (Rec 45); the HMAC and key-hashing design in
Recs 105–107 implemented and reviewed before any webhook leaves the operator's own systems.

## 5. Refunds

**What.** Reversing a settled order, in whole or in part, back to the payer.

**Why deferred.** `DECISIONS.md` Rec 41 to 43: *"no refunds, subscriptions or partial payments in v4."*
The v4 order model is exact-input and full-fill only (`SPEC-CONTRACTS.md` interface decisions,
§9.1): an order settles completely or not at all, and there is no reversal path once `Settled` fires,
by design (`Settled` is the success signal, per the interface decisions fixed for all v4 authors).

**First.** A refund design that does not reopen a market whose lifecycle is already RETIRED-terminal
(`DECISIONS.md` Corrections #112) — undesigned, and not a v4 concern.

## 6. Subscriptions

**What.** Recurring, payer-authorized settlements without a new order each time.

**Why deferred.** The same `DECISIONS.md` Rec 41 to 43 line covers subscriptions explicitly. Every v4
order is payer-bound, single-use, and checked against replay by `orderId =
keccak256(abi.encode(block.chainid, executor, creator, salt))` and its status (interface decisions
fixed for all authors) — a design for exactly one settlement, not a standing authorization.

**First.** A recurring-authorization design distinct from the single-order replay guard above —
undesigned, and out of v4's order model entirely.

## 7. Plugins

**What.** Drop-in integrations for third-party platforms (storefront plugins, e-commerce extensions).

**Why deferred.** `DECISIONS.md` Rec 36 ranks the integration surfaces UNICA offers, in order: *"hosted
checkout, React component, REST API, contract interface, button, plugins."* Plugins rank last of six.
v4 ships the contract interface (`SPEC-CONTRACTS.md`) and the read-only prototype only; none of the
five surfaces ranked above plugins has shipped as a live product yet, so a plugin — which wraps one of
those surfaces for a third-party platform — has nothing finished to wrap.

**First.** At least the hosted checkout or the REST API shipping as a real surface, per Rec 36's own
ordering.

## 8. Public payment links, and their signed-intent security review

**What.** A checkout link any payer can complete, rather than one bound to a payer named at creation.

**Why deferred.** `DECISIONS.md` Q128: *"v4 uses payer-bound orders only. Public payment links move to
v5, behind a separate signed-intent security review that starts with Advisory 001."* Corrections #111
is explicit that every order names its payer *"unless a separately designed public payment-link mode
exists with its own caps and replay protections"* — that separate design does not exist yet. The
frozen `docs/v2/SECURITY-ADVISORY-001.md` is the named starting point because it already found, in an
earlier release, that a payer witness alone does not bind the merchant half of an order — exactly the
class of gap a public, payer-unbound link reopens.

**First.** The signed-intent security review Q128 names, starting from Advisory 001's finding, with
its own caps and replay protections designed and reviewed before any link ships — never inherited from
v4's payer-bound `WrongPayer` guard, which does not apply once the payer is not named up front.

## 9. Broad chain coverage

**What.** UNICA live on more than one chain at a time, or described as multi-chain.

**Why deferred.** `DECISIONS.md` Rec 12: *"one chain first."* Q9 (which mainnet chain) is still
**OPEN** — Arbitrum One is recommended by `evidence/MAINNET-CAPABILITY-PROBE.md` but not confirmed by
the owner. The contracts are already chain-generic — no chain constants, one settings file per chain
at `config/chains/<chainId>.json`, resolved by the chain id the RPC reports (`SPEC-ORACLE-AND-CHAINS.md`
§12) — but this release enables `46630` only; `config/chains/42161.json` stays present and
`enabled: false` until Q9 closes (`SPEC-CONTRACTS.md` §2). No surface describes UNICA as
"multi-chain" until a second chain has actually settled.

**First.** Q9 closed by the owner; the second chain's config enabled and its own launch gates (Q64,
Q70, Q71, Q91) passed independently — a second chain does not inherit the first chain's readiness.

## What this file does not do

It does not authorize starting UNICA v5. It does not change any UNICA v4 blocker: the OPEN, NOT READY,
NOT SELECTED, NOT PROVIDED, UNKNOWN, and NO AUTHORIZATION items in `DECISIONS.md` still gate v4 itself
and are tracked in `README.md`'s blocker table, not here. A feature above staying out of v4 is a scope
decision; a v4 blocker clearing is a separate, unrelated event.
