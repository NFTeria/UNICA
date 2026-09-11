# UNICA v5 — x402 and the Graph evidence boundary

Draft for owner review. Nothing here is committed, deployed, or published; it authorizes no
account, no infrastructure spend, and no subgraph deployment. This document states the boundary
between the x402 payment-negotiation protocol and the UNICA Graph Evidence Toolkit
(`AI-MCP-TOOLS.md`, this directory): which checks an agent must run before treating a 402 as
payable, which of those checks may read an index and which must read the chain directly, and what
happens after settlement.

Track: this is UNICA's **from-scratch** entry (owner ruling, 2026-09-11). Earlier drafts said
"Continuity"; that was wrong and is not repeated here. No sponsor-channel transcript was supplied
for this work; nothing below is attributed to a peer discussion, and every claim is either cited to
a source in §0 or labelled PROPOSED / UNKNOWN. This document builds on `docs/unica-v4/arc/X402.md`
(retrieved 2026-09-11, cited X402.md §n below) rather than re-deriving x402's protocol facts; where
this file adds UNICA v5 evidence-layer design on top of that base, it is marked PROPOSED. **UNICA
v4 contracts do not exist yet** — every event and view function cited here is
**SPECIFIED-NOT-BUILT**, cited to `docs/unica-v4/EVENT-SCHEMA.md` (EV §n) or
`docs/unica-v4/SPEC-CONTRACTS.md` (SC §n).

## 0. Sources and their status

| # | Source | Retrieved | Author / org | Kind | Used for | Conflict |
|---|---|---|---|---|---|---|
| S1 | `docs/unica-v4/arc/X402.md` | 2026-09-11 | this repository, from primary x402/Circle/Privy sources | TEAM (built from OFFICIAL sources) | Every x402 protocol fact used below (roles, flow, schemes, payload shapes, error codes, Arc's own support status); not re-derived here | binds this file; where they disagree, X402.md wins |
| S2 | `docs/v2/SECURITY-ADVISORY-001.md` | 2026-09-08 | this repository | TEAM | The binding failure this document generalizes to any x402-fronted UNICA order | — |
| S3 | `docs/unica-v4/EVENT-SCHEMA.md` | 2026-09-11 | this repository | TEAM | Every event field, the emitter-authentication rule (§2), and the "current state is not history" doctrine this file's §6/§7 split rests on | binds this file |
| S4 | `docs/unica-v4/SPEC-CONTRACTS.md` | 2026-09-11 | this repository | TEAM | The order/payer/deadline mechanics (`pay`, `createOrder`, guard table §9.3) that x402 would sit in front of | binds this file |
| S5 | `docs/unica-v4/DECISIONS.md` #111, cited via X402.md §11 | 2026-09-11 | this repository | TEAM | The ruling that public payment links are a separately designed, unbound-payer mode, not a retrofit onto payer-bound orders | — |
| S6 | ETHOnline 2026 prize page | https://ethglobal.com/events/ethonline2026/prizes | 2026-09-11 | ETHGlobal | OFFICIAL | Confirms "x402 payment tooling" is named explicitly as qualifying work for the AI Tooling track this document supports | — |
| S7 | `AI-MCP-TOOLS.md`, this directory | 2026-09-11 | this repository | TEAM | The response envelope, reason-code catalogue, and tool catalogue this document's evidence checks are expressed against, so the two files use one vocabulary | binds this file for envelope shape |

## 1. Scope and non-scope

**In scope.** The evidence-layer design for an agent that meets a UNICA-fronted x402 402 response:
what it must check before paying, what it must check after settling, and which of those checks may
read an index versus must read the chain directly. **Not in scope:** re-deriving x402's own protocol
facts (S1 already did that from primary sources); any UNICA-authored x402 network binding or
extension's actual code (§3 below states what such a binding would need, as design, not
implementation); any claim that x402 runs on Arc today as anything other than Circle's own
Gateway/nanopayments product (X402.md §9's verdict stands, unchanged, here).

## 2. Recap: what x402 does and does not carry (from X402.md)

x402 is a payment-negotiation protocol carried in three HTTP headers (X402.md §3); it moves an
**exact, flat token transfer to a single address** and nothing else (X402.md §11: "every settlement
path the spec defines performs a flat token transfer to a single address"). Its `exact` scheme's
EIP-3009 authorization is six fields — `from, to, value, validAfter, validBefore, nonce` — and its
`permit2` witness adds exactly one more bound field, `{to, validAfter}` (X402.md §5.1). Nothing in
either payload names an order, a quote, a merchant identity beyond the recipient address, or an
output asset/amount. x402 has no calldata-carrying settlement path (X402.md §11), so it cannot itself
invoke `executor.pay(orderId)` (SC §9.1) — it can only land tokens at an address.

## 3. Advisory 001, applied to an x402-fronted UNICA order

Advisory 001 (S2) found that UNICA v2's Permit2 witness bound only six payer-side fields
(`quoteId, payer, tokenIn, maxIn, destination, executor`) and left the merchant's half — recipient,
signer, output asset, output amount — substitutable by whoever submitted `settle()`. X402.md §11
already showed x402's own `exact` authorization is **narrower still**: it has no quote digest at
all, so wiring it directly into a signature-redeemed UNICA settlement "would reproduce the exact
failure mode Advisory 001 already found, one layer higher in the stack."

**UNICA v4 changes the shape of the question, and this file states precisely how (PROPOSED
analysis, not in X402.md, built from SC §9.1 now that it is specified).** UNICA v4's `pay(orderId)`
takes **no signature at all**. It is a plain contract call gated on `msg.sender == order.payer`
(`WrongPayer`, SC §9.1 step 1), and `recipient` is fixed at order-creation time by an allowlisted
creator (SC §4), never chosen by whoever submits the payment. So the *specific* substitution
Advisory 001 found in v2 — a relayer swapping in their own `recipient`/`merchantSigner` under an
unchanged payer signature — **has no foothold in v4's base path**, because v4 has no relayer path at
all: the payer must be the caller. This is a genuine structural improvement over v2's design, worth
stating plainly rather than only restating X402.md's more general warning.

**The vulnerability reappears the moment a gasless/relayed wrapper is placed in front of `pay()`** —
which is exactly what wiring x402 in for an agent with no gas would require, since x402's entire
value proposition is that the payer signs instead of sending a transaction (X402.md §6). The moment
someone other than the payer is the one calling `pay()` (a facilitator, a keeper, a UNICA-run relay),
v4 needs a **new**, UNICA-authored binding to keep `WrongPayer`'s guarantee meaningful under
delegation — and that binding must be the exact `orderId`, not a flat destination address, because
`recipient` is already fixed inside the order the payer is authorizing; the field that is *not* yet
bound in any x402 payload is *which order* the authorized funds pay for.

## 4. The eight bindings, and what breaks if each is unbound

Advisory 001's method — name every field a real payment depends on, and show which side's signature
actually covers each one — applied to a *hypothetical* UNICA-authored x402 wrapper around `pay()`
(none exists; SC has no signature path today). "Bound in v4 today" describes the **unwrapped**
`pay(orderId)` call a payer submits directly; the remaining columns describe what a wrapper would
need to add.

| Binding | Bound in v4's own `pay()` today | Bound in x402 `exact`/EIP-3009 (X402.md §5.1) | Bound in x402 `permit2` witness (X402.md §5.1) | What breaks if a UNICA wrapper omits it |
|---|---|---|---|---|
| **Payer** | Yes — `msg.sender == order.payer`, checked on-chain, no signature needed (SC §9.1, `WrongPayer`) | Yes — `from` is the signer | Yes — the Permit2 signer | A wrapper that lets anyone *submit* a payer's authorization for an order that names a *different* payer bypasses nothing on-chain (`WrongPayer` still fires), but a wrapper that maps the x402 `from` field to `msg.sender` via a forwarder without checking it equals `order.payer` reintroduces exactly the check `pay()` already has — redundant if done right, a hole if the forwarder trusts the wrong field |
| **Merchant / recipient** | Yes — fixed at `createOrder` by an allowlisted creator, never by whoever pays (SC §4; `Settled.recipient == OrderCreated.recipient`, invariant I3b) | Yes, but only as "wherever `to` points" — the payer's signature does bind a destination, just not a *merchant identity* or an *order* | Yes, via `witness.to`, same caveat | Because v4 fixes recipient inside the order (not inside a signature the payer must separately trust), this binding is **already closed** on the UNICA side; the residual risk moves entirely to the next row |
| **Asset** | Yes — `ASSET_TOKEN` is a market immutable; `pay()`'s `transferFrom` pulls exactly that token, `InputNotExact` else revert (SC §9.1 step 3) | Yes — the exact token in `accepts[]` | Yes — the exact token in the Permit2 permission | If a wrapper **decouples** collection (x402 collects asset A) from settlement (a keeper later calls `pay()` on a market whose `ASSET_TOKEN` is A) via a staging address (X402.md §12.2, §12.3's own recommended pattern), asset-binding stops being cryptographic and becomes **application logic**: the keeper's own code must correctly route collected funds to the matching market. A bug there — not a forged signature — is now the risk surface, and it needs its own adversarial testing, not inherited security from x402 or v4 |
| **Amount** | Yes — `order.amountIn` fixed at creation, exact-input enforced (`InputNotExact`), floor enforced twice (`minOut`, then `RecipientShort`/`DeliveryNotExact`, SC §9.1 steps 3, 5) | Yes — `value` | Yes | v4's exact-input guard is a **structural backstop** here that Advisory 001's v2 defect did not have: even a wrapper that mismatches amount cannot silently succeed, because `pay()` itself reverts closed on any input that is not exact. This is a genuine strength to state, not just a risk to flag |
| **Chain** | Yes — `orderId = keccak256(abi.encode(block.chainid, executor, creator, salt))`; `marketId` embeds `block.chainid` too (EV §6.1, SC §3) — cross-chain replay is closed by construction | Named via CAIP-2 network in `PaymentRequirements`, independently of any UNICA field | same | Nothing on-chain checks that the chain x402 collected funds on matches the chain the settling order lives on, because collection and settlement are decoupled legs (same as Asset, above); a wrapper pointing an agent at the wrong chain's collection endpoint is an application bug, not a bypass of v4's own chain-binding, which stays intact for the order itself |
| **Verifying contract / domain** | N/A — `pay()` takes no signature, so there is no EIP-712 domain to bind in the base path | The token contract itself is the "verifying contract" for EIP-3009 | The canonical `x402ExactPermit2Proxy` (X402.md §5.1) | Any future v4 gasless wrapper that *does* introduce a signature must name a specific `verifyingContract` (the executor, or a UNICA-wide forwarder) in its own EIP-712 domain — Advisory 001's own recommended fix for v2 already does exactly this (hash the quote digest inside a domain that "already carries the chain id and the executor address"); a new v4 wrapper should copy that pattern rather than invent one |
| **Order id / nonce** | Yes — `orderId` is unique, used-once (`OrderExists`, SC §9.1); this is the **crux** field | **No** — EIP-3009's six fields have no room for an arbitrary 32-byte order identifier (X402.md §5.1) | **Almost** — the witness has exactly `{to, validAfter}`, no room for a 32-byte orderId either | This is the single most important row. Any UNICA-authored wrapper that authorizes token movement via x402's stock schemes **without separately, cryptographically binding the target `orderId` inside the signed payload** lets whoever submits the settlement choose *which order* the funds pay into — the x402-shaped recurrence of Advisory 001, restated precisely against v4's real fields rather than only in the abstract (X402.md §11's own conclusion, now made concrete) |
| **Expiry** | Yes — `order.deadline` (`DeadlineInPast`, `OrderExpired`, SC §9.1) | Yes — `validAfter`/`validBefore` | Yes | These are **two independent clocks**. A wrapper that checks only x402's window and forgets `order.deadline` can present an x402-fresh payment that `pay()` then reverts (`OrderExpired`) — safe, but it burns the payer's one-time x402 nonce for nothing (X402.md §7's replay-protection rule: a fresh nonce per authorization, consumed once). An evidence check run **before** collecting the x402 payment (§6 below) exists specifically to avoid this waste |

## 5. The agent flow: 402 → evidence → allow/refuse → settle → verify receipt

```
Agent                         UNICA Evidence Toolkit (AI-MCP-TOOLS.md)        Chain / Index         x402 (RS, Fac)
  │  GET /resource                                                                                       │
  │────────────────────────────────────────────────────────────────────────────────────────────────────>│
  │  402 + PAYMENT-REQUIRED {market/order hint, price}                                                   │
  │<────────────────────────────────────────────────────────────────────────────────────────────────────│
  │  unica_verify_market(marketId, hook, executor)  ── MUST be live RPC (§6) ──>│                        │
  │<──────────────────────────────────────────────────────────────────────────│ ALLOW / REFUSE           │
  │  unica_market_status(marketId)                  ── MUST be live RPC (§6) ──>│                        │
  │<──────────────────────────────────────────────────────────────────────────│                          │
  │  unica_order_status(executor, orderId,                                                             │
  │                     intent: "authorize")        ── MUST be live RPC (§6) ──>│                        │
  │<──────────────────────────────────────────────────────────────────────────│                          │
  │  [optional] unica_merchant_history(recipient)   ── MAY read index (§7) ────>│                        │
  │<──────────────────────────────────────────────────────────────────────────│                          │
  │                                                                                                       │
  │  if any REFUSE: stop here. No x402 authorization is signed. No nonce is burned.                       │
  │  if UNKNOWN: stop here, or retry with a different configured RPC/Graph endpoint (§6's own rule).       │
  │  if every check ALLOWs: proceed —                                                                     │
  │                                                                                                       │
  │  GET /resource + PAYMENT-SIGNATURE {x402 authorization, binding the exact orderId per §4's crux row}   │
  │────────────────────────────────────────────────────────────────────────────────────────────────────>│
  │                                            RS -> Fac /verify -> /settle -> Chain (X402.md §3, §12.1)   │
  │  200 OK + PAYMENT-RESPONSE {tx hash, network, payer}                                                  │
  │<────────────────────────────────────────────────────────────────────────────────────────────────────│
  │  unica_verify_receipt(txHash)                    ── MUST be live RPC (§6) ──>│                        │
  │<──────────────────────────────────────────────────────────────────────────│ ALLOW / REFUSE            │
  │                                                                                                       │
  │  only on ALLOW does the agent treat the resource as validly paid for AND the UNICA order as settled.   │
```

This flow is the direct application of the stated requirement — an agent meets a 402, queries
UNICA evidence, verifies market, merchant, asset, version and replay status, then allows or refuses;
after settlement it verifies the receipt before consuming the resource — expressed against the
concrete tool names of `AI-MCP-TOOLS.md` (S7).

## 6. Which checks must hit the chain directly, and why

Every one of these is a **live RPC read**, never an index read, at authorization time — before an
x402 authorization is signed or a facilitator is asked to settle:

- **Market status** (`registry.statusOf`, SC §5) — `tightenOraclePolicy`/`tightenCaps`/`pause` all
  "bind the next payment" from a **live** read (SC §6, §8.2 step 1: "read live, so a tightening binds
  the next swap"). An index lag of even one block could still show ACTIVE after an on-chain pause
  landed. The failure mode is not stolen funds — `pay()` itself would revert `MarketNotActive` — but
  the agent would waste the entire x402 collection leg and burn the payer's one-time authorization
  nonce (X402.md §7) chasing a doomed settlement the evidence layer could have refused for free.
- **Hook/executor/pool authenticity** (the three registry reverse lookups, SC §3, EV §2) — **must**
  be live for the reason `AI-MCP-TOOLS.md` §7.2 already states: EV §2's whole emitter-authentication
  rule exists because "anyone can deploy the same hook source through their own factory and emit a
  `SettlementReceipt` with an official `marketId`." An indexer that filtered only by topic0 and
  `marketId` — rather than re-deriving authenticity from registry storage on every handler call —
  could index a look-alike's fabricated log as genuine; this is precisely EV §13's sabotage row EV8.
  A live reverse lookup reads the registry's own storage, which a fabricated log cannot write to.
- **Oracle condition** (`hook.oracleCondition()`, SC §8.2) — has **no index-based alternative at
  all**: `STALE_ORACLE` and `MARKET_CLOSED` are "computed conditions, never stored and never emitted"
  (EV §2). There is no event to index in the first place.
- **Caps remaining** (`executor.remainingToday()`, SC §9.2) — `payoutUsedOnDay` is executor storage
  that changes on every settlement; an index's staleness window (this repository's own default is 25
  blocks, `integrations/graph-v2/README.md`) could be wrong by a whole day's volume during a burst.
- **Order status / replay** (`executor.orders(orderId)`, SC §9.1) — the pre-payment question "is this
  order still Open" must be live: an indexed `Order` entity is fine for a history display, but the
  authorization decision needs the current status, because a stranger cannot settle a payer-bound
  order (`WrongPayer`) but the *bound payer's own agent* could otherwise attempt to double-collect an
  x402 authorization against an order someone already paid through a different channel. This call
  is made with `intent: "authorize"` (`AI-MCP-TOOLS.md` §7.4), so `ORDER_UNKNOWN`, `ORDER_EXPIRED`,
  `ORDER_NOT_OPEN`, and `ORDER_ALREADY_SETTLED` all force `REFUSE` per §5's severity rule — an
  expired, unknown, or already-settled order never reads `ALLOW` on this leg of the flow.
- **Token implementation** (proxy/beacon slot, EV §8 class U7) — should be live for any market
  moving real value; SC's own threat-model lines (A7, A8) name the beacon owner's power to upgrade or
  pause a stock token at any time, and only a live read answers "right now," never "as of the last
  indexed block."

## 7. Which checks may read the index, and why that is safe

These are **history and reconciliation** questions, not authorization questions — EV §2's own
distinction ("events answer what happened... an indexer never supplies current status") is exactly
the line drawn here:

- **Merchant history** (`unica_merchant_history`, `AI-MCP-TOOLS.md` §7.5) — informs risk context
  ("has this recipient settled before"), never gates the payment by itself; an empty result is
  `EVIDENCE_INSUFFICIENT`, never a refusal, following `integrations/graph-v2`'s own rule that absence
  of an indexed row proves nothing about the underlying fact.
- **Reconciliation summaries** (`unica_reconciliation_summary`) — run *after* settlement, over a
  block range, to confirm the index's own lag and anomaly count; by definition this is retrospective
  and never blocks a payment already evaluated live.
- **Status/policy/caps timelines** (`MarketStatusChanged`, `PolicyChange`, `CapsChange` history, EV
  §10.2) — shown for context ("this market was paused for six hours last month") beside, never
  instead of, the live current-status read above.
- **Identity provenance's historical leg** (`unica_identity_provenance`, `AI-MCP-TOOLS.md` §7.6) — a
  "what was true at block N" question is exactly what an index (or an equivalent historical RPC
  re-derivation) is for; it is not asking "what is true now," so reading history here is correct, not
  a shortcut.

The dividing line is not "index vs. chain" as a general rule — it is **decision-time state that gates
a payment must be live; everything that only ever answers "what already happened" may read an
index**, and a bounded self-hosted indexer or the official Subgraph MCP are both acceptable index
sources for the second category, subject to the same `_meta`-driven freshness check
(`AI-MCP-TOOLS.md` §5, `INDEX_STALE`/`INDEX_HAS_ERRORS`) either way.

## 8. Sequence diagrams

**8.1 — ALLOW path, same-asset payment, no conversion needed** (extends X402.md §12.1 with the
evidence gate inserted before the authorization is ever signed)

```
Client   Client->RS: GET /resource
         RS->Client: 402 + PAYMENT-REQUIRED {exact, eip155:11155111, market/order hint}
         Client->Evidence: verify_market, market_status, order_status  (all live RPC, §6)
         Evidence->Client: ALLOW (no REFUSE reason codes)
         Client->RS: GET /resource + PAYMENT-SIGNATURE {eip3009 auth, binding orderId per §4}
         RS->Fac: /verify -> /settle
         Fac->Chain: token.transferWithAuthorization(...)
         Chain->Fac: tx confirmed
         RS->Client: 200 OK + PAYMENT-RESPONSE {tx hash}
         Client->Evidence: verify_receipt(tx hash)  (live RPC, §6)
         Evidence->Client: ALLOW — resource is now treated as paid for
```

**8.2 — REFUSE path, lookalike hook caught before any authorization is signed**

```
Client   Client->RS: GET /resource
         RS->Client: 402 + PAYMENT-REQUIRED {exact, hook address from an unsolicited or cached link}
         Client->Evidence: verify_market(marketId, candidateHook)
         Evidence->Evidence: registry.marketIdOfHook(candidateHook) != marketId  (SC §3, live RPC)
         Evidence->Client: REFUSE, reason_codes: ["HOOK_LOOKALIKE"]
         Client->Client: stop. No PAYMENT-SIGNATURE is ever produced; no nonce is spent;
                         no x402 round trip occurs at all.
```

**8.3 — UNKNOWN path, evidence layer cannot reach a verdict**

```
Client   Client->RS: GET /resource
         RS->Client: 402 + PAYMENT-REQUIRED {exact, market/order hint}
         Client->Evidence: market_status(marketId)
         Evidence->Evidence: configured RPC times out; a second configured RPC disagrees on chain head
         Evidence->Client: UNKNOWN, reason_codes: ["CHAIN_RPC_DISAGREEMENT"]
         Client->Client: stop, or retry against a different configured RPC (never treat UNKNOWN as ALLOW,
                         AI-MCP-TOOLS.md §10)
```

## 9. Worked example: an agent refuses a lookalike hook before paying

```json
{
  "decision": "REFUSE",
  "reasons_human": [
    "The hook offered in this 402 response is not the official hook for the named market.",
    "No x402 authorization was requested or signed; nothing was collected."
  ],
  "reason_codes": ["HOOK_LOOKALIKE"],
  "chain": { "caip2": "eip155:11155111", "name": "sepolia" },
  "block": { "number": "11701005", "hash": "0x88ab…blockhash", "timestamp": "1799716500" },
  "finality": { "status": "final", "confirmations": 142 },
  "evidence_source": { "class": "rpc-direct", "endpoint_class_only": "public Sepolia JSON-RPC" },
  "query_or_evidence_hash": "0xd41c…evhash",
  "contracts": {
    "registry": "0xREGISTRY_ADDRESS_FROM_MANIFEST",
    "hook": "0xADDRESS_OFFERED_IN_402_RESPONSE",
    "market_id": "0x7a3c…e91f"
  },
  "missing_evidence": [],
  "explorer_links": ["https://sepolia.etherscan.io/address/0xADDRESS_OFFERED_IN_402_RESPONSE"]
}
```

This is the same envelope shape as `AI-MCP-TOOLS.md` §8, reused deliberately: an agent evaluating an
x402 402 response and an agent evaluating an arbitrary hook address ask the identical question
(`unica_verify_market`) and get the identical answer shape, whether or not x402 was ever involved.

## 10. Worked example: an agent verifies a receipt after settling

```json
{
  "decision": "ALLOW",
  "reasons_human": [
    "The settlement transaction holds one SettlementReceipt from the market's own hook and one Settled from its own executor.",
    "amountIn and the delivered amount agree between the receipt and the success event.",
    "The transaction has 140 confirmations, past this deployment's configured finality threshold."
  ],
  "reason_codes": [],
  "chain": { "caip2": "eip155:11155111", "name": "sepolia" },
  "block": { "number": "11701200", "hash": "0x5cd0…blockhash", "timestamp": "1799717100" },
  "finality": { "status": "final", "confirmations": 140 },
  "evidence_source": { "class": "rpc-direct", "endpoint_class_only": "public Sepolia JSON-RPC" },
  "query_or_evidence_hash": "0x7e19…evhash",
  "contracts": {
    "registry": "0xREGISTRY_ADDRESS_FROM_MANIFEST",
    "hook": "0xHOOK_ADDRESS_FROM_MARKET_RECORD",
    "executor": "0xEXECUTOR_ADDRESS_FROM_MARKET_RECORD",
    "market_id": "0x7a3c…e91f"
  },
  "missing_evidence": [],
  "explorer_links": ["https://sepolia.etherscan.io/tx/0xTRANSACTION_HASH_FROM_PAYMENT_RESPONSE"]
}
```

Only on this `ALLOW` does the agent treat the x402 `PAYMENT-RESPONSE` as backed by a real UNICA
settlement: the receipt is verified before the resource is consumed.

## 11. Failure modes specific to the x402 boundary

- **`settlement_pending` is not a protocol error and is not UNICA's to interpret.** The CDP
  Facilitator's own operational state (X402.md §7: "broadcast but didn't confirm within the
  synchronous window... reconcile the returned transaction instead of retrying") is
  facilitator-specific, absent from the core spec's error list, and must map to the evidence
  toolkit's `UNKNOWN` — never `ALLOW` (the resource has not been shown to be paid) and never `REFUSE`
  (the payment may still land). The correct response is to poll `unica_verify_receipt` against the
  returned transaction hash once it is available, not to re-authorize.
- **A wasted nonce is a real cost even though it is not a security failure.** Because x402 nonces are
  single-use (X402.md §7) and UNICA's own `deadline` is a second, independent clock (§4's Expiry
  row), an agent that skips §6's live pre-checks and only discovers `OrderExpired` or
  `MarketNotActive` after x402 has already settled the collection leg has burned a one-time
  authorization for nothing — the fix is running every §6 check **before** requesting a
  `PAYMENT-SIGNATURE`, not after.
- **Collection/settlement decoupling moves a cryptographic guarantee into application logic.** X402.md
  §12.2 and §12.3's own recommended pattern for a foreign asset ("x402 collects; UNICA converts") is
  correct and necessary — x402 has no conversion concept (X402.md §10) — but it means the Asset and
  Chain bindings in §4's table are enforced by whatever UNICA-authored reconciliation code routes
  collected funds to the right market on the right chain, not by any shared signature. That code is a
  new, UNICA-specific attack surface requiring its own adversarial testing; it is not covered by
  either x402's or UNICA v4's own guarantees, and no test for it exists because no such code exists
  yet.
- **This toolkit cannot explain an x402-side refusal.** `unica_explain_payment_refusal`
  (`AI-MCP-TOOLS.md` §7.8) decodes only on-chain UNICA revert data; the thirteen `invalid_*`/
  `unexpected_*` x402 error codes (X402.md §8) happen before any UNICA transaction exists to decode,
  and are not, and will not be, in this toolkit's reason-code catalogue (`AI-MCP-TOOLS.md` §5). An
  agent needs both vocabularies and must not conflate them.
- **No idempotency guarantee exists unless the `payment-identifier` extension is used.** X402.md §7's
  table shows that without it, a retried request re-attempts `/settle` and the token contract's own
  nonce check is the only backstop (`invalid_transaction_state`); this is an x402-side concern
  entirely outside this toolkit's reason codes, but an agent building on both should know
  `unica_order_status`'s `ORDER_ALREADY_SETTLED` code (`AI-MCP-TOOLS.md` §5) is the UNICA-side signal
  that would catch the same retry one layer down, if the x402-level idempotency check is skipped.

## 12. Open questions and unknowns

- Whether any UNICA-authored x402 network binding or extension — the one that would bind the exact
  `orderId` per §4's crux row — is worth building at all before UNICA v4 exists to settle against; no
  such binding is specified anywhere in this repository today.
- Whether ETHOnline 2026's "x402 payment tooling" qualifying category (S6) expects a working
  facilitator-compatible implementation or accepts a design document such as this one; not answered
  by the prize page text captured in `AI-MCP-TOOLS.md` §0 (S1 there), and not asked of a Graph team
  member as of this writing.
- Whether Arc will ever be relevant to this boundary at all: X402.md §9's verdict — "Arc is not
  officially supported by the x402 protocol or its reference facilitator as of 2026-09-11" — is
  unchanged by anything found while writing this file, and no new primary source was fetched here
  that would revise it.
- Whether EURC's EIP-3009 support (X402.md §14, reported but not independently confirmed) would
  affect the Asset-binding row of §4 if UNICA ever priced a market in EURC; not investigated further
  here, since X402.md already marks it an open unknown and this file does not re-derive x402 facts.
- No implementation of the flow in §5, the diagrams in §8, or the worked envelopes in §9–§10 exists;
  every value is a design artifact against SPECIFIED-NOT-BUILT UNICA v4 fields.

## 13. Owner decisions required

1. Whether to scope a first x402 integration to the **`AI-MCP-TOOLS.md` §7.3 BUILT analogue**
   (`unica_verify_receipt` against the live V1/V3 subgraph) for a demo that does not depend on UNICA
   v4 shipping, versus waiting for v4's registry to exist before any x402-fronted flow can be shown
   end-to-end.
2. Whether UNICA should build the §3/§4 gasless wrapper at all, given that v4's *unwrapped* `pay()`
   already avoids Advisory 001's specific defect by construction (§3) — a wrapper only becomes
   necessary the moment UNICA wants to support payers who hold no gas, which is a product decision,
   not a security requirement forced by v4's own design.
3. Whether the evidence toolkit's pre-x402 check sequence (§5) should be mandatory inside any
   UNICA-provided x402 client library, or offered as an optional import an integrator can skip —
   skipping it does not create an on-chain vulnerability (§4's per-row analysis shows v4's own guards
   hold either way) but does reintroduce the wasted-nonce and decoupled-reconciliation risks §11
   names.
