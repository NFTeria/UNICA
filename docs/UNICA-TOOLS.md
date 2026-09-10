# UNICA — what it contains, and what each part can actually be claimed to do

This is the living inventory. It exists because a project that cannot say precisely what it has
built will eventually say something it cannot back up, and the moment that happens it has spent
trust that is hard to buy back.

**Read the Status line before anything else.** Only these values are used, and
`script/validate-tools.mjs` fails the build if any other appears:

| Status | What it means |
|---|---|
| `LIVE AND VERIFIED` | deployed on a public chain, source verified, and a transaction proves it ran |
| `IMPLEMENTED — LOCAL TESTS` | the code exists and named tests exercise it locally; nothing is deployed |
| `IMPLEMENTED — FORK TESTS` | the above, plus tests against forked chain state |
| `PROTOTYPE` | it runs, and it is not the thing that ships |
| `SPECIFIED, NOT IMPLEMENTED` | written down; no code |
| `BLOCKED` | cannot proceed until something outside this repository happens |
| `UNSUPPORTED` | deliberately out of scope |
| `RETIRED` | was real, is not maintained |

The machine-readable twin is [`docs/unica-tools.json`](unica-tools.json). The two must agree on
every id and every status, and `make gate` checks it. **A tool's evidence points at a test, a
script, a transaction or an artifact — never back at this file.** A document that cites itself is
not evidence, it is a rumour with a footnote.

**Last verified commit** is the commit at which someone last re-derived the row's claims. It is
set by hand, so on its own it would be a promise rather than a fact — which is why the validator
adds the rule that makes it binding: any commit that changes a tool's code must change the manifest
in the same commit, or the build fails. A row can therefore be older than its code, but only if
somebody revisited the row when the code moved.

Nothing in V2 is deployed. **No part of UNICA has been audited**, and no part of this document
should be read as saying otherwise.

---

## The product map

One product, three layers. Every line says which of `live` · `fork` · `local` · `specified` ·
`blocked` · `unsupported` it is, because the difference between them is the whole difference between
a claim and a wish.

**The central claim, written as three sentences because collapsing it produces something false:**

> The hook proves that the pool swap is an authorised, exact invoice-discharge swap.
> The executor proves that the merchant was paid exactly.
> Atomic execution makes those two outcomes inseparable.

### UNICA V1

| | |
|---|---|
| native-input settlement | **live** — Ethereum Sepolia |
| USDC payout | **live** |
| canonical V1 receipt | **live** — one on chain |
| live verification scripts | **live** — `make proof`, 14 of 14 plus 31 of 31 |
| Graph indexer | **local** — implemented, matchstick-tested, not deployed |

### UNICA V2

| | |
|---|---|
| merchant-signed invoice | **fork** |
| payer Permit2 witness | **fork** |
| invoice-only v4 hook | **fork** |
| direct payer-to-PoolManager funding | **fork** |
| exact merchant payout, enforced by the executor | **fork** |
| single-use quote | **fork** |
| canonical V2 receipt | **fork** |
| no executor custody | **fork** — measured on closing balances |
| merchant configuration commitment | **local** |
| deployment | **none.** V2 is not live anywhere, and `fork` means a read-only local fork of Sepolia |

### Integrations

| | |
|---|---|
| ENSv2 merchant discovery | **local**, with live read-only rows behind `make gate-live` |
| ENS binding into the signed quote | **local** |
| Graph receipt indexing, V1 | **local** |
| Graph receipt indexing, V2 | **local** — implemented, 13 mapping rows + 17 consistency checks, not deployed |
| wallet / oracle / payment-request adapters | **specified** — see the sponsor backlog |
| Robinhood tokenized assets | **blocked** — compatibility research only |
| chains without a canonical v4 deployment | **unsupported** |

**`fork` is not `live`.** A fork test creates the V2 contracts inside a local copy of Sepolia at a
pinned block. They do not exist on Sepolia; nothing was broadcast. What is real in those rows is
everything they talk to — the official PoolManager, the official Permit2, Circle's USDC proxy and
canonical WETH9, each checked against a recorded code hash.

The claims this product may make in public, with their evidence and their limits, are in
[`docs/CLAIMS.md`](CLAIMS.md). Public wording may not outrun that table.

---

## V1 — the live generation

### V1 Settlement Hook

- Id: `v1-settlement-hook`
- Purpose: refuse any swap through its pool that does not fully settle a registered order.
- Product role: the guarantee V1 makes. It is the reason V1 is a hook and not a script.
- Version: 1.0.0
- Location: `src/V4SettlementHook.sol`
- Inputs: a `PoolKey`, the swap's parameters, and an order id carried in `hookData`.
- Outputs: a callback selector, and the `SettlementReceipt` event on a successful settlement.
- Trust boundary: it trusts the order registry it owns, and nothing that arrives in calldata. The
  payee is resolved from storage written by an authenticated call, never from `hookData`.
- Security guarantees: the recipient of a settlement is the registered merchant; a settlement that
  under-delivers reverts; an order settles once.
- Explicit non-guarantees: it does not price anything, does not custody anything, and does not
  know who the payer is.
- Dependencies: `v4-core`, OpenZeppelin's `uniswap-hooks`.
- Networks: Ethereum Sepolia.
- Status: LIVE AND VERIFIED
- Evidence: `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`; deploy tx
  `0xc76bc0a3…4108a014`; the settlement tx `0x1120af18…ee0ecb83` at block 11640026; Sourcify
  reports `match`. `make readback` reproduces all of it.
- Tests: `test/V4SettlementHook.t.sol`, `test/I7NativeSettle.t.sol`, `test/ReceiptSchema.t.sol`
- Deployment: Ethereum Sepolia, CREATE2 salt `0xd76`, flags `0x20C0`, 10,634 bytes of runtime.
- Limitations: USDC only, and the payout table is compiled into the address, so widening it moves
  the contract. **Not audited.** Exactly one settlement has run through it.
- Sponsor relevance: Uniswap. It is a v4 hook doing something a v4 hook is needed for.
- Last verified commit: `6f99fe98c5ce`

### V1 Settlement Executor

- Id: `v1-settlement-executor`
- Purpose: drive one settlement through Uniswap's Universal Router and hand the output to the hook.
- Product role: the caller the hook admits. Nothing else may settle.
- Version: 1.0.0
- Location: `src/SettlementExecutor.sol`
- Inputs: an order id and the native ETH being paid.
- Outputs: a router call, and the credit the hook then judges.
- Trust boundary: it trusts the hook's registry for the recipient and the minimum.
- Security guarantees: it holds nothing after the call; the recipient's balance is checked against
  what the order requires before it returns.
- Explicit non-guarantees: it does not verify a merchant's identity and does not choose a price.
- Dependencies: `v4-periphery`, Uniswap's Universal Router.
- Networks: Ethereum Sepolia.
- Status: LIVE AND VERIFIED
- Evidence: `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`; deploy tx `0x8c067692…b0c57ebb`;
  `cast call … 'HOOK()(address)'` returns the hook and the hook returns it.
- Tests: `test/SettlementExecutor.t.sol`
- Deployment: Ethereum Sepolia, 11,289 bytes of runtime.
- Limitations: native ETH input only. **Not audited.**
- Sponsor relevance: Uniswap — it is the Universal Router integration.
- Last verified commit: `87f9ecae7038`

### V1 Canonical Receipt

- Id: `v1-canonical-receipt`
- Purpose: make one settlement reconstructible from logs alone.
- Product role: what an indexer, an accountant, or a merchant reads afterwards.
- Version: 1.0.0
- Location: `docs/RECEIPT-SCHEMA.md`, emitted from `src/V4SettlementHook.sol`
- Inputs: none; it is an event.
- Outputs: `SettlementReceipt(orderId, amountIn, amountOut, fee)` beside OpenZeppelin's `HookFee`.
- Trust boundary: the emitting contract is the hook, so the log's own address is the authority.
- Security guarantees: emitted only on a settlement that completed.
- Explicit non-guarantees: it does not name the payer, and it does not carry a quote digest.
- Dependencies: OpenZeppelin's `IHookEvents`.
- Networks: Ethereum Sepolia.
- Status: LIVE AND VERIFIED
- Evidence: tx `0x1120af18…ee0ecb83` carries `amountIn` 1000000000000000, `amountOut` 2003660,
  `fee` 0, and the recipient's USDC grew by exactly 2.003660.
- Tests: `test/ReceiptSchema.t.sol`
- Deployment: emitted by the live hook.
- Limitations: exactly one exists on chain. **Not audited.**
- Sponsor relevance: Uniswap, The Graph.
- Last verified commit: `e6aeea934ffc`

### V1 Live Verification Scripts

- Id: `v1-live-verification`
- Purpose: re-prove every claim the README makes about the live deployment, from the chain.
- Product role: the reason a reader does not have to take this repository's word for anything.
- Version: 1.0.0
- Location: `docs/proof/verify-live.sh`, `docs/proof/verify-day1.sh`, `script/readback.sh`
- Inputs: an RPC URL.
- Outputs: a stated count — "36 checks run, 36 passed, 0 failed" — never a blank pass.
- Trust boundary: it trusts the RPC endpoint it is given, and says so.
- Security guarantees: none; it is a reader.
- Explicit non-guarantees: a network failure and a false claim are different, and the reader must
  look at the count to tell them apart.
- Dependencies: `cast`.
- Networks: Ethereum Sepolia.
- Status: LIVE AND VERIFIED
- Evidence: `make proof` prints 14 of 14 (day-1) and 31 of 31 (live) against `0x11202071…0Ea0C0` and tx `0x1120af18…ee0ecb83`.
- Tests: `docs/proof/verify-live.sh` is its own test; it fails loudly on a wrong value.
- Deployment: none; it runs locally against the live chain.
- Limitations: needs a public RPC.
- Sponsor relevance: Uniswap.
- Last verified commit: `316df1c6f89c`

### V1 Graph Indexer

- Id: `v1-graph-indexer`
- Purpose: turn V1 receipts into queryable settlement history.
- Product role: the "what happened" surface.
- Version: 0.1.0
- Location: `integrations/graph/subgraph.yaml`, `integrations/graph/schema.graphql`,
  `integrations/graph/src`
- Inputs: the hook's `SettlementReceipt` logs.
- Outputs: `Settlement` entities with a deterministic id.
- Trust boundary: it trusts the chain and the ABI compiled from this repository's own artifact.
- Security guarantees: none; it is an observer.
- Explicit non-guarantees: it indexes V1 only and knows nothing about the V2 invoice path.
- Dependencies: `graph-cli`, `matchstick`.
- Networks: Ethereum Sepolia.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: `bash integrations/graph/local-e2e.sh` reconstructs a settlement end to end;
  `integrations/graph/STUDIO-PREFLIGHT.md` records what a Studio deploy would need.
- Tests: `integrations/graph/tests`
- Deployment: none. Deploying to Subgraph Studio is an owner action and has not been taken.
- Limitations: not deployed; V1 only. **Not audited.**
- Sponsor relevance: The Graph — and qualification is on HOLD until a composition that actually
  meets their published requirement is found. No claim is made that it qualifies.
- Last verified commit: `5e1d8436fc76`

---

## V2 — the invoice generation

Nothing here is deployed. Everything here is implemented and locally tested against the official
PoolManager runtime and the official Permit2 runtime, both constructed at their canonical addresses.

### V2 Invoice-Only Hook

- Id: `v2-invoice-hook`
- Purpose: make a v4 pool one that cannot be traded through — every swap crossing it discharges a
  merchant-signed invoice, or it reverts.
- Product role: the claim V2 rests on, and the reason it is a hook. An executor alone cannot make
  it, because anyone may call `PoolManager.swap`; only the hook sees every swap.
- Version: 0.1.0
- Location: `src/v2/QuoteSettlementHook.sol`
- Inputs: the callback arguments, and one view call to its bound executor asking what invoice is
  live in this transaction.
- Outputs: callback selectors, or a refusal.
- Trust boundary: it trusts its executor for the invoice's TERMS and nothing about whether the pool
  then delivered them — which is the part it can see for itself.
- Security guarantees: only the bound executor may swap; a swap with no live invoice is refused; an
  invoice is discharged once; the pool and the direction must match the invoice; the swap must be
  exact-output; the delivery must meet the invoice's floor. A pool with a native currency or a
  dynamic fee cannot carry this hook at all.
- Explicit non-guarantees: **it enforces a floor, not the exact amount**, and it never witnesses a
  payment. The merchant is paid by a `take` after the swap frame has returned, so a `balanceOf`
  read inside `afterSwap` would return the pre-delivery balance and look like a check while proving
  nothing. Delivery is the executor's obligation.
- Dependencies: `v4-core`, OpenZeppelin's `uniswap-hooks`.
- Networks: none.
- Status: IMPLEMENTED — FORK TESTS
- Evidence: 13 admission rows and 5 fill rows green; `make mutants` deletes each of its ten guards
  in turn and each turns the row that names it red; 8,317 bytes of runtime code.
- Tests: `test/v2/HookAdmission.t.sol`, `test/v2/InvoiceFill.t.sol`
- Deployment: none.
- Limitations: not deployed and **not audited**.
- Sponsor relevance: Uniswap.
- Last verified commit: `1faf6b6bb480`

### V2 Quote Settlement Executor

- Id: `v2-quote-settlement-executor`
- Purpose: turn a merchant-signed invoice and a payer's Permit2 authorisation into an exact payment.
- Product role: the contract that proves the PAYMENT. The hook proves the swap; atomicity binds them.
- Version: 0.1.0
- Location: `src/v2/QuoteSettlementExecutor.sol`, `src/v2/interfaces/IPermit2Transfer.sol`,
  `src/v2/MerchantConfig.sol`
- Inputs: a `Quote`, the merchant's EIP-712 signature, and the payer's Permit2 authorisation.
- Outputs: `actualIn` and `deliveredOut`, and exactly one `QuoteSettled` receipt.
- Trust boundary: it trusts two signatures and the PoolManager. It trusts a relayer with nothing:
  not the Permit2 destination, not the PoolManager, not the hook, not the recipient, not the
  actions. Every one is a constructor immutable or inside a signature.
- Security guarantees: the merchant's balance rises by exactly `amountOut`, measured on their own
  address across the whole settlement; the payer is debited what the swap cost and never more than
  the ceiling they signed; the executor's own balance in both tokens is unchanged, measured; one
  settlement at a time; no receipt without a verified delivery.
- Explicit non-guarantees: it does not vet the pool a merchant names beyond structural checks — the
  payer's protection is the signed ceiling and the measured delivery. It does not accept EIP-1271
  contract signatures. It does not support an output token whose transfer cannot deliver an exact
  amount; such a token is refused, not accommodated.
- Dependencies: `v4-core`, Permit2 (deployed runtime, never compiled here), OpenZeppelin `ECDSA`.
- Networks: none.
- Status: IMPLEMENTED — FORK TESTS
- Evidence: the integrated path is green against the official PoolManager and the official Permit2
  runtime; 24 refusal rows each asserting a whole revert payload; adversarial rows for a token that
  skims on delivery, one that overpays the venue, one that pays the executor, and one that reenters
  during delivery; 30 of 30 local mutations and 12 of 12 fork mutations killed by the row that names
  them; 18,369 bytes of runtime; a fork settlement costs 302,948 gas and paid a merchant exactly
  100.000000 USDC.
- Tests: `test/v2/Settlement.t.sol`, `test/v2/SettlementRefusals.t.sol`,
  `test/v2/SettlementAdversarial.t.sol`, `test/v2/SettlementAdversarialInput.t.sol`,
  `test/v2/SettlementLayers.t.sol`
- Deployment: none.
- Limitations: not deployed and **not audited**; single-hop pools only; **merchant signers are
  EOAs** — `ECDSA.recover` only, so smart-contract wallets and multisigs cannot issue a V2 quote,
  while PAYERS may use contract wallets because Permit2 supports EIP-1271. See
  [`docs/v2/EIP1271-BACKLOG.md`](v2/EIP1271-BACKLOG.md).
- Sponsor relevance: Uniswap.
- Last verified commit: `51e8e471acda`

### V2 Merchant Quote

- Id: `v2-merchant-quote`
- Purpose: state, in one signed object, everything a settlement is allowed to do.
- Product role: the merchant's half of the agreement.
- Version: 1
- Location: `src/v2/interfaces/IQuoteSettlement.sol`
- Inputs: the merchant's signer.
- Outputs: an EIP-712 digest, and a signature over it.
- Trust boundary: every security-relevant field is inside the digest. A field outside it is a field
  a relayer can change on the way in.
- Security guarantees: sixteen fields are enumerated in a test that alters each one and requires the
  digest to move.
- Explicit non-guarantees: the payer is bound rather than open — a bearer quote that also names a
  price is a front-running target, and that is a deliberate narrowing, not an oversight.
- Dependencies: EIP-712.
- Networks: none.
- Status: IMPLEMENTED — FORK TESTS
- Evidence: `test_Refuse_EverySignedFieldIsInsideTheDigest` moves every field;
  `test_Settle_TheQuoteDigestIsDerivedTheSameWayTwice` derives the digest from the type strings a
  second time and requires agreement.
- Tests: `test/v2/Settlement.t.sol`, `test/v2/SettlementRefusals.t.sol`
- Deployment: none.
- Limitations: **not audited.** The offline derivation that was owed here now exists in
  `tools/unica-sign/`, and its digest equals the one a real fork settlement produced.
- Sponsor relevance: Uniswap.
- Last verified commit: `51e8e471acda`

### V2 Permit2 Payment Witness

- Id: `v2-permit2-witness`
- Purpose: derive, offline and independently, the exact digest a payer's wallet must sign.
- Product role: the payer's half of the agreement, and the thing most likely to be silently wrong.
- Version: 0.1.0
- Location: `integrations/permit2/digest.mjs`, `integrations/permit2/test.mjs`
- Inputs: a quote's terms, a nonce, a deadline, a spender.
- Outputs: a domain separator, a witness hash, and a signing digest.
- Trust boundary: none — it is arithmetic. Its value is being written from the specification rather
  than from the Solidity it is compared against.
- Security guarantees: none; it is a derivation.
- Explicit non-guarantees: **Permit2 does not enforce the transfer destination.** That was measured
  here: a transfer to an attacker was accepted and the payer's signature did not object. The
  executor fixes the destination in code and the witness records it.
- Dependencies: Permit2's deployed runtime, EIP-712.
- Networks: Ethereum Sepolia (the canonical Permit2 address).
- Status: IMPLEMENTED — FORK TESTS
- Evidence: 20 offline rows; the same vector recomputed in Solidity and required to match; and the
  deployed Permit2 runtime accepting a signature over the OFFLINE digest. Four sabotages — a field
  renamed on either side, a spurious `version` in the domain, and a Permit2 copied by code-etch —
  each turn rows red.
- Tests: `integrations/permit2/test.mjs`, `test/v2/Permit2Witness.t.sol`
- Deployment: none.
- Limitations: measured against an etched runtime rather than a live Sepolia transaction.
- Sponsor relevance: Uniswap.
- Last verified commit: `17836cc42533`

### V2 Quote and Signing Tool

- Id: `unica-sign`
- Purpose: build, hash, display and read back everything a merchant or a payer signs.
- Product role: the client half of the frozen interface. Two signatures make a settlement, and until
  this existed both could only be produced by a test harness.
- Version: 0.1.0
- Location: `tools/unica-sign/`
- Inputs: a quote, an environment (chain, PoolManager, Permit2, nonce, deadline), and a
  caller-supplied signer.
- Outputs: the two digests, the witness, the calldata, and a reviewable summary whose two loudest
  fields are where the money goes and the most it can be.
- Trust boundary: **it holds no keys.** Every signing entry point takes a `sign(digest)` callback,
  so the key stays wherever the caller keeps it. A row asserts the module never reads the
  environment.
- Security guarantees: none of its own. Its value is being a SECOND implementation — written from
  the EIP-712 specification in JavaScript, not from the Solidity it is checked against.
- Explicit non-guarantees: the ABI codec handles only the shapes `settle()` uses and refuses
  anything else rather than guessing. It constructs and verifies; it does not broadcast.
- Dependencies: EIP-712, Permit2's type strings. No package dependencies.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 81 JavaScript rows and 10 Solidity rows over one vector. Its quote digest equals the
  digest a real settlement produced on the pinned fork, and its hand-written ABI encoder produces
  calldata byte-identical to `abi.encodeCall` — 1,060 bytes, same hash. Four sabotages red: a
  renamed field on either side, a swapped pair of encoded words, and a calldata head shifted by one
  word.
- Tests: `tools/unica-sign/test.mjs`, `test/v2/SigningVectors.t.sol`
- Deployment: none. Not published as a package.
- Limitations: as above. **Not audited.**
- Sponsor relevance: Uniswap — this is what a wallet would use to render a UNICA quote.
- Last verified commit: `b9d9116b5890`

### CRE Workflow Adapter

- Id: `cre-guardian-adapter`
- Purpose: turn an observation into exactly one permitted transaction, or into nothing.
- Product role: the bridge between the chain and the frozen policy. It decides nothing itself.
- Version: 0.1.0
- Location: `integrations/chainlink-cre-guardian/{profiles,adapter,evidence}.mjs`
- **PUBLIC DEPLOYMENT IS BLOCKED.** The challenge README and its own `config.staging.json` name
  different lending and token addresses at the pinned commit. A participant running the example
  unchanged protects a position on a deployment the organisers are not scoring, and nothing in the
  example says so. Both address sets are carried as named profiles, selecting one is an argument,
  **there is no default**, and mixing an address across profiles is refused by name.
- Trust boundary: **there is no parameter that could redirect a call.** An intent becomes one of
  two shapes — approve-then-deposit on vETH, or approve-then-repay on vUSD — with every target
  taken from the selected profile. "No arbitrary calldata" is a property of the signature, not a
  promise about how it is called.
- Security guarantees: the frozen policy is the oracle, and the adapter's decision is asserted
  equal to it across 950 compared states. Amounts pass through unchanged. Observations are refused
  when stale, duplicated or reordered. A pending action suppresses a duplicate.
- The approval model, established from the contracts rather than assumed: `deposit` calls
  `vETH.transferFrom`, and `repay` calls `vUSD.burnFrom` which itself spends allowance — so both
  need an allowance to the lending contract, and `burnFrom` is additionally `onlyRole(ADMIN_ROLE)`,
  which is the organisers' setup rather than a participant's. Allowance is observable and can be
  prepared before the scenario starts.
- Cadence, measured: observing every price update survives the sudden crash; observing every
  **second** update loses it, because the first update is already below the line and a tick that
  never happens cannot react. Whether a cron faster than five minutes is permitted by the DON is
  **not** established here.
- Explicit non-guarantees: evidence records carry `LOCAL_SIMULATION` and there is no argument that
  can set anything else — they are **not** TEE attestations and **not** DON execution receipts.
  Nothing is deployed, nothing broadcast, `join()` not called, no CRE CLI installed.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 86 offline rows; ten mutations, all killed.
- Sponsor relevance: Chainlink.
- Last verified commit: `2cad3e3e75ae`

### CRE Liquidation-Protection Policy

- Id: `cre-guardian-policy`
- Purpose: decide, from a lending position and a private policy, whether to do nothing, warn,
  add collateral or repay debt — and to do it in integers the contract would agree with.
- Product role: the offline core of the Chainlink CRE challenge entry, and the reusable risk
  policy behind UNICA Guardian.
- Version: 0.1.0
- Location: `integrations/chainlink-cre-guardian/`
- Upstream: `solangegueiros/cf-liquidation-protection-challenge` at `58b24604`, MIT, inspected
  2026-09-08. Nothing is vendored.
- **The finding that inverts the naive strategy.** An untouched starting position is liquidatable
  at any price at or below **1812.82** — only 9.4% below the start. Every one of the five published
  scenarios crosses that line, **including the one called "safe volatility"**, where the health
  factor floors to exactly 100 at $1800 and the contract liquidates at `hf <= 100`. "Avoid
  unnecessary interventions" therefore loses that scenario if read as "do nothing".
- Trust boundary: it decides and nothing else. It does not observe a chain, sign, send, or run
  inside a TEE. Thresholds arrive as arguments because in deployment they live in CRE secrets; what
  is public here is the decision procedure, and that split is what lets it be tested at all.
- Security guarantees: every number is an integer and every rounding direction is chosen toward
  safety — a deposit rounds **up** because the contract floors when it recomputes, a surviving debt
  rounds **down** for the same reason. Both are checked across 270-odd cases for reaching the target
  *and* for being minimal. Every projected health factor is **recomputed** with the contract's own
  formula after the action is applied, never asserted.
- **Scoring weights are deliberately not compiled in.** How loan continuity and capital efficiency
  trade off is unanswered by the organisers, so both candidate actions are always computed and a
  configurable selector chooses. Guessing the weights and hiding the guess inside the safety engine
  would make it wrong in a way no test could later find.
- Explicit non-guarantees: the simulation assumes one observation per price update and that every
  action lands before the organiser's liquidation sweep — that sweep is an admin call, so survival
  depends on a window whose length nobody has stated. Gas, transaction failure and DON latency are
  not modelled. **No CRE CLI is installed, no workflow is deployed, and `join()` has not been
  called.**
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 88 offline rows; nine mutations, all killed by their own named row. All five published
  scenarios survive every tick with the whole loan kept open, spending 89–231 vETH units of 500 and
  **zero** vUSD.
- Tests: `integrations/chainlink-cre-guardian/test.mjs`
- Sponsor relevance: Chainlink.
- Last verified commit: `63a815a5c818`

### PayAny Router (Vyper)

- Id: `payany-router-vy`
- Purpose: let a payer bring any token and still pay a merchant a defensible amount of USDC.
- Product role: the accept-anything front door. A Chainlink-priced floor in front of a Uniswap
  route, then a split through the merchant's policy.
- Version: 0.1.0
- Location: `vy/src/unica/payany_router.vy`
- **Provenance: PRIOR ART.** Carried in, not authored here. See `docs/PRIOR-ART.md`.
- Security guarantees: the swap's output is MEASURED as a balance delta rather than taken from the
  router's word, and compared against an independently priced floor. The Chainlink read refuses a
  missing feed, a non-positive price, an answer older than `max_feed_age`, a future-dated answer
  and an incomplete round; the freshness boundary is checked from both sides. An intent is consumed
  by id alone, so a replay under another merchant or amount is still a replay. Slippage and
  platform fee are each capped at ten percent, so an owner cannot quietly widen either.
- Explicit non-guarantees, each measured: `pay()` executes **caller-supplied calldata** against the
  Universal Router with a live approval — what bounds the damage is the oracle gate on the measured
  delta, not any validation of that calldata. The bank leg is *approved* to the off-ramp and the
  off-ramp is *trusted to pull it*: an adapter that does not pull leaves the USDC in the router with
  a live allowance while `pay()` still succeeds, so the no-custody claim rests on another
  contract's behaviour. There is no L2 sequencer-uptime check. The gate is applied to the gross
  output while the merchant is paid net of the platform fee.
- Networks: none. **Not deployed anywhere and not audited.** The swap leg is untested: it needs a
  Universal Router, and only the USDC path runs without one.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 14 rows, `cd vy && mox test tests/test_payany_router.py`.
- Sponsor relevance: Uniswap and Chainlink.
- Last verified commit: `86a402ed68bc`

### Merchant Settlement Policy (Vyper)

- Id: `merchant-policy-vy`
- Purpose: decide what proportion of a settlement reaches a bank off-ramp as USDC and what stays
  in the coins a merchant chose.
- Product role: the merchant's own preference, expressed once and applied to every settlement.
- Version: 0.1.0
- Location: `vy/src/unica/merchant_policy.vy`
- **Provenance: PRIOR ART.** Written before this repository's hackathon window and carried in
  rather than authored during it. See `docs/PRIOR-ART.md`.
- Trust boundary: it holds no tokens, moves nothing and pays nobody. It answers one question —
  how does this amount divide — and a caller does the paying.
- Security guarantees: a split is EXACT. Shares must sum to ten thousand basis points or
  registration is refused, and the final hold leg is defined as the remainder so that flooring
  cannot lose a unit: `bank + every leg == the amount` is checked at fourteen amounts including
  zero, one, and 2^64 − 1.
- Identity: the merchant is a NUMBER, and the operator is only a key. An operator address can
  change without the merchant's identity, policy or history changing with it — which is what lets
  a merchant be onboarded without managing an EOA.
- Explicit non-guarantees: the platform address is fixed at construction and cannot be changed or
  renounced; the operator is not checked against zero; there is no way to deactivate a merchant
  once registered.
- Networks: none. **Not deployed anywhere and not audited.**
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 13 rows, `cd vy && mox test tests/test_merchant_policy.py`.
- Tests: `vy/tests/test_merchant_policy.py`
- Last verified commit: `e66e0771e8a5`

### Arc Nanopayments Integration

- Id: `arc-nanopayments`
- Purpose: verify a Circle Gateway nanopayment authorization without asking Circle, and bind the
  things that authorization provably does not cover.
- Product role: the payment layer for a budgeted agent. It decides what an agent is allowed to buy
  and what the answer is allowed to cause.
- Version: 0.1.0
- Location: `integrations/arc-nanopayments/`
- Upstream: `circlefin/arc-nanopayments` at `a29f920e`, Apache-2.0, inspected 2026-09-08, with the
  protocol in `@circle-fin/x402-batching@2.0.4`. **Nothing is vendored and the SDK is never
  imported** — being a second implementation is the point.
- **What a Gateway authorization actually signs**, read off the SDK rather than the documentation:
  domain `GatewayWalletBatched` version 1 with the chain id and the GatewayWallet as verifying
  contract, over `from, to, value, validAfter, validBefore, nonce`. **Six fields.** There is no
  resource, no request digest, no response digest, no session, no cumulative ceiling and not even
  the token address. A nanopayment proves an account agreed to pay an amount to a recipient in a
  window on a chain, and says nothing about what was bought.
- **What the batching gives you, and what it does not.** The SDK contains zero occurrences of
  merkle, root, proof, batch id, inclusion or commitment, and its embedded ABI declares no events.
  `settle` returns `{success, transaction}` where that transaction is the batch's, shared by every
  payment in it. So Circle Gateway batching is **operational accounting, not a per-payment
  commitment** — the authorization is cryptographic, the settlement is an API assertion.
- Trust boundary: `BatchFacilitatorClient.verify` and `.settle` are HTTP calls to Circle's hosted
  API, so a seller using the SDK learns that Circle says a payment is valid and never checks. The
  payload carries both the authorization and the signature, so local verification is available and
  simply unused. This module takes it.
- Security guarantees: eleven classified refusals on the payment, sixteen on the policy, each
  returning no action mandate and no calldata. Budget is **reserved before the spend**, so two
  concurrent requests cannot both see the same remaining balance — the upstream agent adds to a
  running total inside a promise callback and prints its own in-flight count, which is measured
  here as an admitted overspend.
- Explicit non-guarantees: **no Arc transaction has been sent**, no wallet created, no faucet used
  and nothing settled. Every claim about settlement is graded API-reported, and the grading itself
  is asserted so that calling a resource purchase "verified" fails a row.
- Dependencies: EIP-712 and secp256k1, both already in this repository. No new package.
- Networks: none exercised.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 141 offline rows. A vector signed by Circle's own SDK verifies against this
  implementation; five sabotages killed by their own named row.
- Tests: `integrations/arc-nanopayments/test.mjs`
- Deployment: none.
- Limitations: as above. **Not audited.**
- Sponsor relevance: Circle — evaluated as the payment layer for a budgeted UNICA agent. No track
  qualification is claimed.
- Last verified commit: `3582eb5350e3`

### ENS Merchant Identity Chain

- Id: `ens-identity-chain`
- Purpose: take a name a person typed and produce a V2 quote a merchant could sign, checking every
  hand-off rather than assuming it.
- Product role: the join between discovery, merchant policy and settlement. `resolve.mjs` answers
  which address a name points at, `build.mjs` decides whether that answer may become a
  configuration, and this binds both to a numeric merchant identity and a policy.
- Version: 0.1.0
- Location: `integrations/ensv2/{merchant-id,policy,identity,demo}.mjs`
- **The merchant id had to be defined here.** `merchant_policy.vy` takes `merchant_id` as an
  *argument* and derives nothing, so whoever calls `register` picks the number and two callers can
  pick the same one. The derivation binds the normalised name, its namehash, the chain and the
  policy version — and **not the operator**, because an operator is a key and a key is rotated.
  Deriving identity from it would make a key rotation a new merchant.
- Trust boundary: **a failed read is not an empty policy.** A timeout, a wrong address, a revert
  and an unregistered merchant are four different things and three of them must not resemble
  "this merchant takes nothing to the bank". No address can enter through any argument, and a
  caller who passes one is refused by name rather than ignored.
- Field authority, with an equality check wherever two sources could disagree: ENS supplies the
  recipient, the name and the namehash; the deployment supplies the hook, executor, chain and
  payout currency; the payer supplies only the input side; the policy governs routing **after**
  settlement and reaches the quote as evidence, never as a value.
- Security guarantees: 95 rows and ten mutations. The policy decoder is hand-written and checked
  against wire bytes from `cast abi-encode` that decode to values captured from the real Vyper
  contract — three implementations agreeing on one policy. No field was added to the frozen
  `Quote`: the resolution a payer saw is bound through `merchantConfigHash`, which V2 already
  carries inside the merchant's signature.
- Explicit non-guarantees: every stage is a local fixture or a local computation. The policy is
  read from committed bytes, not a deployed registry — `merchant_policy.vy` is deployed nowhere.
  **V2 is not deployed to any public chain**, so no settlement can follow a quote this builds, and
  nothing is signed: the artifact is a digest.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 95 rows, `node integrations/ensv2/identity-test.mjs`; the end-to-end command is
  `node integrations/ensv2/demo.mjs` and runs in the gate for its exit status.
- Sponsor relevance: ENS and Uniswap.
- Last verified commit: `407b1db680fc`

### ENSv2 Configuration Builder

- Id: `ensv2-config-builder`
- Purpose: turn a validated resolution into a merchant configuration, and refuse everything else.
- Product role: the join between discovery and the invoice. `resolve.mjs` answers which address a
  name points at; this decides whether that answer may become something a merchant signs.
- Version: 0.1.0
- Location: `integrations/ensv2/build.mjs`
- Inputs: a resolution object, and a policy carrying the payout currency, the validity window, the
  settlement chain, and the block the caller is building at.
- Outputs: the configuration, its commitment, and diagnostics that are explicitly outside the hash.
- Trust boundary: **there is no argument that can carry an address.** A recipient comes from the
  resolution or not at all, so "resolve, then quietly pay somebody else" is not a mistake a caller
  can make — it is not expressible. A `recipient` passed in the policy is refused by name rather
  than ignored, because a caller who passed one believes it is being used.
- Security guarantees: ten classified refusals, each returning no configuration and no commitment
  and each carrying an explanation. The payout currency is chosen from a compiled per-chain set;
  an unlisted token is refused by name. Staleness is judged against a block the caller supplies,
  so the module needs no clock and no network to be tested.
- The time rule, and why it is safe in one direction only: the schema measures validity in BLOCKS
  and a quote's deadline is a TIMESTAMP. Ethereum slots are twelve seconds and an empty slot
  produces no block, so `validForBlocks` blocks always take **at least** `12 × validForBlocks`
  seconds. Bounding a quote at that lower estimate expires it no later than the configuration
  expires, never after — the error is conservative by construction rather than by luck.
- Explicit non-guarantees: it builds a commitment and nothing else. It does not resolve, sign,
  quote or settle. A caller that lies about the current block gets a stale configuration.
- Dependencies: the ENSv2 resolver module and the canonical `MerchantConfig` encoder, imported
  rather than reimplemented.
- Networks: none. No RPC, no key, no clock.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 136 rows in the ENS suite. Five sabotages killed by their own named row.
- Tests: `integrations/ensv2/test.mjs`
- Deployment: none.
- Limitations: as above. Local tests only, no fork run, **V2 is not deployed**, and not audited.
- Sponsor relevance: ENS and Uniswap.
- Last verified commit: `c2d69a03303c`

### NameMath Art Contracts

- Id: `namemath-art`
- Purpose: turn a seed, and in one case a name, into an exactly invertible planar map whose
  forward and inverse forms are the artwork.
- Product role: none in settlement. This is the art side of the workspace and shares nothing with
  the payment path but the repository.
- Version: 0.1.0
- Location: `vy/src/namemath.vy`, `vy/src/logobackground.vy`
- Inputs: a 32-byte seed (`namemath`), or a UTF-8 label up to 64 bytes (`logobackground`).
- Outputs: a transform program, its exact inverse, computed traits, and a lattice field with a
  palette.
- Trust boundary: pure functions over checked `int256`. Nothing is stored except `namemath`'s seed
  registry, and nothing is transferred.
- Security guarantees: every generated affine step is unimodular, so the inverse is an integer map
  and `F^-1(F(p)) = p` exactly rather than approximately. Checked at 845 grid points across five
  unrelated seeds, and the forward map is separately shown to be injective on the grid — an inverse
  built from the same broken table as its forward map would otherwise agree with it.
- Explicit non-guarantees, each measured rather than asserted:
  - **`namemath.vy` had never compiled.** `convert(block.prevrandao, bytes32)` is a type error in
    every Vyper 0.4.x, so no version of this contract has ever been deployable.
  - **No declared coordinate bound.** Evaluation reverts on overflow, which is the right failure,
    but the usable grid is a property of the seed: 158 on the worst of 24 `namemath` seeds against
    1,727,786,871 for `logobackground`. A renderer cannot pick one grid for every token.
  - **The registry seed is grindable.** `register()` mixes a caller-supplied entropy word with a
    readable `prevrandao`, so a minter can compute the outcome off chain and submit the one they
    want. 256 candidates reachable in a single transaction gave 13 distinct trait classes.
  - **`namemath` binds no name.** Its seed contains no name, no contract, no chain id and no
    algorithm version — so nothing ties a token's art to its identity.
  - **An unreachable guard.** `logobackground.cell()` tests `if m < 0` after summing two squares.
    Under checked arithmetic that branch cannot run; the case it appears to handle reverts.
- Dependencies: none. No imports, no libraries, no oracles.
- Networks: none. The only EVM these run on is Moccasin's in-process one.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 20 rows, `cd vy && mox test -q`.
- Tests: `vy/tests/test_namemath.py`, `vy/tests/test_logobackground.py`
- Deployment: none.
- Limitations: as above. **Not deployed and not audited.** Neither contract touches ENS, Uniswap,
  a pool, a token or a payment.
- Sponsor relevance: none claimed.
- Last verified commit: `aee1048edde0`

### V2 Receipt Verifier

- Id: `unica-verify`
- Purpose: answer one question — does this transaction receipt record a settlement of *this* quote?
- Product role: the other end of `unica-sign`. One tool builds what two parties sign; this one reads
  back what happened and says, field by field, whether it was the same thing.
- Version: 0.1.0
- Location: `tools/unica-verify/`, with its evidence captured by `script/v2/fork-settle.sh`
- Inputs: a quote, the merchant's signature, a transaction receipt (or a hash and an endpoint), what
  the caller expects (chain, executor, hook), and optionally the merchant configuration preimage and
  a set of code-hash pins.
- Outputs: VERIFIED or NOT VERIFIED, every check that ran with its verdict, and `--json` with stable
  fields — `verified`, `mode`, `checks`, `errors`, `warnings`, `receipt`, `quote`,
  `merchantConfiguration`, `dependencies`, `evidence`.
- Trust boundary: **it recomputes rather than reads and agrees.** The receipt carries a
  `quoteDigest`, and reading that back out would verify nothing, because the emitter chose it. So
  the digest is rebuilt from the quote's own fields, the merchant's address is recovered from the
  signature over the rebuilt digest, the PoolId is rebuilt from the complete pool key, and only then
  is any of it compared with the log. Ten sabotages encode the shortcut version of each of those
  checks and require the real one to refuse what the shortcut accepts.
- Security guarantees: none of its own — it signs nothing, sends nothing, and holds no key. Online
  mode reaches a chain through a client that refuses any JSON-RPC method that is not a query, and an
  endpoint is redacted to scheme, host and port everywhere it could appear, errors included.
- How it closes `docs/v2/COMPATIBILITY-001.md`: the frozen receipt carries no `merchantConfigHash`,
  and adding one would change the event topic — the single change in the frozen surface that fails
  silently. It is not needed. The commitment is *inside* the quote digest, so the proof runs the
  other way: rebuild the commitment from the preimage, put it in the quote, rebuild the digest, and
  require that digest to be the one the receipt records. The report's recommendation was option 1,
  accept the gap; this is what made option 1 real.
- Explicit non-guarantees: it never says a payment is final, irreversible or owed. It reports
  confirmations and declares no depth final. Offline mode believes the receipt JSON it is handed.
  EOA merchant signers only. **A settlement's absence proves nothing** about whether an invoice was
  paid by another route.
- Dependencies: EIP-712, secp256k1, and the repository's own `tools/unica-sign` and
  `integrations/ensv2/config.mjs` encoders — imported, never re-implemented, so there is one hashing
  schema rather than two.
- Networks: none of its own. Verified against a local anvil fork of Ethereum Sepolia.
- Status: IMPLEMENTED — FORK TESTS
- Evidence: 113 rows with no endpoint at all, 113 passed, 0 failed. One positive control on a real
  captured receipt, 30 negatives altering exactly one field each, 10 sabotages, and 13 rows driving
  ONLINE mode against a stub node — those are in the gate because what they test is whether the
  verifier asks the chain anything, which does not depend on anyone's uptime. Ten of the thirteen go
  red against the code as it stood before 2026-09-08; the three that do not are the controls.
  A further nine rows run when `UNICA_VERIFY_RPC` names a real endpoint. **They were not run in this
  slice: no endpoint was available.** Online mode emits 57 check rows against a settlement fetched
  by hash, including 5 dependency code hashes and the hook's own record that it consumed this quote.
- Tests: `tools/unica-verify/test.mjs`, `test/fork/CaptureReceipt.t.sol`
- Deployment: none. Not published as a package.
- Limitations: the settlement it verifies exists only inside a local fork, because **V2 is not
  deployed to any public chain**. Not audited.
- Sponsor relevance: Uniswap — a merchant, an auditor or an indexer can check a v4 settlement
  without trusting the party that emitted it. ENS — it is what makes a resolved merchant
  configuration provable after the fact.
- Last verified commit: `c15f6607b066`

### V2 Receipt

- Id: `v2-receipt`
- Purpose: record one settlement completely enough to audit it from logs alone.
- Product role: what an indexer and a merchant read afterwards.
- Version: 1
- Location: `src/v2/interfaces/IQuoteSettlement.sol`, emitted from
  `src/v2/QuoteSettlementExecutor.sol`
- Inputs: none; it is an event.
- Outputs: quote id, quote digest, recipient, payer, merchant signer, hook, pool id, both tokens,
  the ceiling, what the swap actually cost, what was requested, what was delivered, and the policy
  version.
- Trust boundary: the log's own address is the executor, which is why there is no `executor` field —
  a field restating the emitter is a field that can disagree with it.
- Security guarantees: emitted once, after the unlock returned and after the delivery was verified.
- Explicit non-guarantees: `amountOut` is what was asked for and `deliveredOut` is what was
  measured. They are separate fields because an indexer that cannot tell a request from a
  measurement cannot audit anything.
- Dependencies: none.
- Networks: none.
- Status: IMPLEMENTED — FORK TESTS
- Evidence: decoded from the log field by field in the happy-path row, and a separate row proves no
  refusal emits one.
- Tests: `test/v2/Settlement.t.sol`, `test/v2/SettlementRefusals.t.sol`
- Deployment: none.
- Limitations: never emitted on a public chain; no indexer reads it yet.
- Sponsor relevance: The Graph.
- Last verified commit: `51e8e471acda`

### V2 Merchant Configuration Commitment

- Id: `v2-merchant-config-commitment`
- Purpose: put the resolution a payer was shown inside what the merchant signed.
- Product role: the join between ENS discovery and the invoice. Without it, `recipient` in a quote
  is an address a payer was shown and has to trust.
- Version: 1
- Location: `src/v2/MerchantConfig.sol`, `integrations/ensv2/config.mjs`
- Inputs: a normalised name, its namehash, the address it resolved to, the payout currency, the
  chain id, the block the reading was taken at, and how long that reading may be relied on.
- Outputs: one `bytes32`, carried in the quote as `merchantConfigHash`.
- Trust boundary: it records a reading; it does not perform one. Resolution happens off chain,
  before an invoice exists.
- Security guarantees: every component is inside the hash, and the hash is inside the merchant's
  digest — so changing any of them makes the merchant's signature stop fitting. **Nothing in a
  settlement calls the resolver**, and that is proven rather than asserted: a contract that reverts
  on every call is etched at the ENSv2 Universal Resolver's address and a full settlement runs
  anyway.
- Explicit non-guarantees: **resolution is not identity.** A name resolving proves who controls the
  name and nothing about the merchant behind it. The expiry window is enforced off chain only — a
  settlement never sees this struct, only its hash — so what protects a payer on chain is that a
  fresh reading produces a different commitment and therefore a different digest.
- Dependencies: EIP-712, the ENSv2 Universal Resolver.
- Networks: none.
- Status: IMPLEMENTED — FORK TESTS
- Evidence: three derivations of one commitment agree — JavaScript, Solidity, and the executor's own
  `hashMerchantConfig`. Eight component rows on each side, and three sabotages (a field renamed on
  either side, and the name dropped from the hash) each turn rows red.
- Tests: `test/v2/MerchantConfig.t.sol`, `integrations/ensv2/test.mjs`
- Deployment: none.
- Limitations: not deployed. **Not audited.**
- Sponsor relevance: ENS, Uniswap.
- Last verified commit: `48a07e710ef7`

### V2 Fork Qualification Suite

- Id: `v2-fork-qualification`
- Purpose: run the whole product against the dependencies as they are actually deployed.
- Product role: the step between "the code works" and "the code works with the real thing".
- Version: 0.1.0
- Location: `test/fork/`
- Inputs: a Sepolia endpoint, from `SEPOLIA_RPC_URL` or a public default that needs no key.
- Outputs: 32 rows, and every measured number in the fork section of the claim ledger.
- Trust boundary: the pinned block and the recorded code hashes. Nothing is taken on trust that is
  not asserted first.
- Security guarantees: none of its own; it measures the ones the contracts make.
- Explicit non-guarantees: **FORK-LOCAL.** The V2 hook, executor and pool are created inside the
  fork and do not exist on Sepolia. Nothing is broadcast. One pool shape, one currency pair, one
  block.
- Dependencies: Foundry, `v4-core`, Permit2.
- Networks: a read-only fork of Ethereum Sepolia, default block 11656955, overridable with `UNICA_FORK_BLOCK`.
- Status: IMPLEMENTED — FORK TESTS
- Evidence: `make fork` — 42 rows: dependency provenance, a mined CREATE2 hook address, the
  integrated path (merchant paid exactly 100.000000 USDC for 0.041792042795051823 WETH against a
  1 WETH ceiling), 26 refusals each naming its own reason, four rows against a hostile payout token
  and three against a hostile input token. `make fork-mutants` kills 18 of 18 — every mutation in
  the local table now has a fork twin.
- Tests: it is the tests.
- Deployment: none.
- Limitations: excluded from `make gate`, because a gate that depends on a third party's uptime is a
  status page rather than a gate. And a public node PRUNES — the first pin died within the hour, the
  second within minutes — so the block is overridable with `UNICA_FORK_BLOCK`, and at a non-default
  pin the block-hash and timestamp rows say out loud that they are not asserted. Every dependency
  code hash is asserted either way, and those are unchanged across all three pins.
- Sponsor relevance: Uniswap.
- Last verified commit: `82c7dcb44038`

### Release-Candidate Interface Freeze

- Id: `interface-freeze-verifier`
- Purpose: make the V2 external surface something a change has to be a decision about.
- Product role: what a deployment would be a deployment OF.
- Version: 1.0.0
- Location: `script/verify-freeze.mjs`, `docs/v2/release-candidate.json`,
  `docs/v2/RELEASE-CANDIDATE-FREEZE.md`
- Inputs: the compiled artifacts.
- Outputs: a pass, or the name of the thing that moved.
- Trust boundary: it refuses to report at all if the artifacts were not built from the sources now
  on disk.
- Security guarantees: none; it is a comparison. Its value is that it rejects renames, retypes,
  reorderings and additions, and that it checks its own input first.
- Explicit non-guarantees: it freezes a SURFACE, not behaviour. A function can change what it does
  without changing its selector.
- Dependencies: Node, Foundry.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 17 checks over 71 error selectors, 2 event topics and 30 function selectors. Two
  sabotages red — a renamed error and a flipped permission bit — and one finding: the FIRST rename
  sabotage passed, because the build had failed and the verifier was reading yesterday's artifacts.
  It now recomputes every source hash from Foundry's own metadata before it reports anything.
- Tests: `script/verify-freeze.mjs`, `test/v2/InterfaceFreeze.t.sol`
- Deployment: none.
- Limitations: additions are reported as changes on purpose, which makes it noisy by design.
- Sponsor relevance: none.
- Last verified commit: `82c7dcb44038`

### Contract Size Budget

- Id: `size-budget`
- Purpose: state the size headroom every run, not only when it runs out.
- Product role: the thing that makes an integration's cost visible before it is paid.
- Version: 1.0.0
- Location: `script/size-budget.sh`
- Inputs: `forge build --sizes`.
- Outputs: four numbers and a verdict.
- Trust boundary: none.
- Security guarantees: none.
- Explicit non-guarantees: 90% is a WARNING per the owner's threshold, not a failure. What IS fatal
  is a missing measurement, because a blank report and a clean one look identical.
- Dependencies: Foundry.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: hook 8,317 of 24,576 runtime (33%), executor 18,369 (74%); both initcodes under 40% of
  EIP-3860. Validated by pointing it at a contract that does not exist and watching it fail.
- Tests: `script/size-budget.sh` carries its own controls.
- Deployment: none.
- Limitations: two contracts, named explicitly. A new contract must be added by hand.
- Sponsor relevance: none.
- Last verified commit: `82c7dcb44038`

### Claim Ledger

- Id: `claim-ledger`
- Purpose: hold every public claim to an evidence row, a scope and a network.
- Product role: the thing a README, a demo script and a submission are checked against.
- Version: 1.0.0
- Location: `docs/CLAIMS.md`
- Inputs: the tests, the fork runs, the live proof.
- Outputs: 18 rows, three of which say a thing is FALSE and must never be said.
- Trust boundary: it is prose, and it binds by being read.
- Security guarantees: none.
- Explicit non-guarantees: the automated banned-wording check covers the tool ledger, not every
  document. A claim can be true and still be said in a misleading place.
- Dependencies: none.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: `docs/CLAIMS.md`
- Tests: `script/validate-tools.mjs` enforces a subset of the banned wording.
- Deployment: none.
- Limitations: as above.
- Sponsor relevance: all of them — it is what stops a sponsor submission overstating.
- Last verified commit: `82c7dcb44038`

### V2 Settlement Indexer

- Id: `v2-settlement-indexer`
- Purpose: turn V2 receipts into queryable invoice-settlement history.
- Product role: the "what happened" surface for V2. A payment system that cannot answer "was this
  invoice paid" is not finished.
- Version: 0.1.0
- Location: `integrations/graph-v2/`
- Inputs: `QuoteSettled` logs at the frozen topic `0x1317a113…7b0cbd4`.
- Outputs: `InvoiceSettlement` and `Deployment` entities, and eight product queries.
- Trust boundary: the chain, and an ABI generated from the compiled contract rather than written by
  hand — `check.mjs` fails if the two ever differ.
- Security guarantees: none; it is an observer. What it does guarantee is identity:
  `keccak(network) ++ executor ++ transactionHash ++ logIndex`, every component fixed width, so the
  concatenation is injective and two settlements cannot share an id.
- Explicit non-guarantees: **a returned row proves a matching receipt was INDEXED. An empty result
  proves nothing** — the invoice may be unpaid, unknown, expired, settled on another deployment, or
  not yet indexed. Answering in the negative needs a source of invoices, and a receipt indexer is
  not one. The quote digest is deliberately not the entity id: a digest identifies an invoice, and
  an invoice is not an event.
- Dependencies: `graph-cli`, `matchstick`, `graph-ts`.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 13 matchstick rows against a fixture CAPTURED from the pinned fork by
  `test/fork/CaptureReceipt.t.sol`, plus 17 manifest, ABI and query checks — four of them sabotaged
  and seen red: a manifest subscribing to a different event shape, a renamed schema field, an
  edited V1 manifest, and a hand-edited ABI.
- Tests: `integrations/graph-v2/tests/invoice-settlement.test.ts`, `integrations/graph-v2/check.mjs`
- Deployment: none. No Studio deployment has been made and none is authorised.
- Limitations: the manifest's address is the fork-local executor, because V2 is not deployed
  anywhere. The receipt carries no `merchantConfigHash` — see
  [`docs/v2/COMPATIBILITY-001.md`](v2/COMPATIBILITY-001.md); no interface was changed to work around
  it. A reverted settlement cannot be tested, because reverted logs never reach an indexer.
- Sponsor relevance: The Graph. Qualification remains **HOLD**, and no claim of hosted status is
  made.
- Last verified commit: `22747b818f2f`

---

## Measurement harnesses

### B1 No-Custody Accounting Harness

- Id: `b1-no-custody-harness`
- Purpose: establish that a PoolManager `settle()` credits a transfer the lock holder never made.
- Product role: the measurement the whole B1 funding path was built on.
- Version: 0.1.0
- Location: `test/v2/B1Settlement.t.sol`
- Inputs: none.
- Outputs: measured balances before and after a third-party transfer.
- Trust boundary: the official PoolManager runtime.
- Security guarantees: none; it is a measurement.
- Explicit non-guarantees: it uses a stand-in mover, not Permit2. The Permit2 leg is measured
  separately, and the two are only joined in the integrated settlement test.
- Dependencies: `v4-core`.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: `settle()` credited 1,003,010,030,091,275 from a transfer the lock holder never made,
  and the lock holder's balance was identical before and after.
- Tests: `test/v2/B1Settlement.t.sol`
- Deployment: none.
- Limitations: one liquidity shape, one token pair.
- Sponsor relevance: Uniswap.
- Last verified commit: `bbf9b6ee3251`

### Short-Fill Reproduction Harness

- Id: `short-fill-harness`
- Purpose: reproduce the defect V2's hook exists to refuse.
- Product role: the evidence behind the whole V2 thesis.
- Version: 0.1.0
- Location: `test/v2/ShortFill.t.sol`
- Inputs: none.
- Outputs: requested versus delivered, and whether anything reverted.
- Trust boundary: the official PoolManager runtime.
- Security guarantees: none; it is a measurement.
- Explicit non-guarantees: measured at one liquidity shape. It shows the defect exists, not that it
  occurs under every configuration.
- Dependencies: `v4-core`, `v4-periphery`.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 1e18 requested, 2,995,354,955,910 delivered, no revert. The control row requests a
  fillable amount and is served exactly.
- Tests: `test/v2/ShortFill.t.sol`
- Deployment: none.
- Limitations: as above.
- Sponsor relevance: Uniswap.
- Last verified commit: `878436e80d3d`

### ERC-7751 Hook Error Decoder

- Id: `erc7751-decoder`
- Purpose: read a hook's own refusal out of the ERC-7751 wrapper v4 puts around every one of them.
- Product role: the instrument every V2 refusal row reads its result from.
- Version: 0.1.0
- Location: `test/v2/util/HookRevertDecoder.sol`, `test/v2/util/HookRevertAsserts.sol`
- Inputs: raw revert data.
- Outputs: a kind, the reverting contract, the failed callback, and the hook's own error selector.
- Trust boundary: none; it parses bytes and never calls anything.
- Security guarantees: none; it is a reader. Its value is that it REJECTS four near-misses — the
  right reason under the wrong callback, the right reason from the wrong contract, a damaged
  wrapper, and an unwrapped error.
- Explicit non-guarantees: it unwraps one layer, not a nest of them. It is test-tree only; no
  contract depends on it.
- Dependencies: `v4-core` (for the wrapper's declaration, compared against).
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 11 rows, five of them rejections, each validated by deleting the corresponding
  comparison. Measured: a 292-byte wrapper needs only its first 200 bytes to be identified; 93 cuts
  still identify it and 196 are rejected.
- Tests: `test/v2/HookRevertDecoder.t.sol`
- Deployment: none.
- Limitations: as above.
- Sponsor relevance: Uniswap — this is a friction finding worth reporting upstream.
- Last verified commit: `74a691bd965e`

### Mutation/Sabotage Suite

- Id: `mutation-suite`
- Purpose: prove the tests would notice if the code were wrong.
- Product role: the reason any other row in this document can be believed.
- Version: 0.1.0
- Location: `script/mutation-suite.sh`
- Inputs: none.
- Outputs: one line per mutation — killed, survived, misattributed, or stale.
- Trust boundary: it edits the tree and restores it, and it refuses to report anything if the
  control is not green first.
- Security guarantees: none; it is a check on the checks. A mutation counts as killed only when the
  row that NAMES that guard fails; a mutation that turns some other row red is reported as
  MISATTRIBUTED, which is a finding rather than a pass.
- Explicit non-guarantees: it is a fixed list, not a generator. It proves those thirty defects are
  caught and says nothing about any other.
- Dependencies: Foundry, Python 3.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: `make mutants` — 30 mutations, 30 killed by their own row. `make fork-mutants` — 18
  against pinned live dependencies, 18 killed. Control green before and after each.
- Tests: `script/mutation-suite.sh` is its own control: it fails if the unmutated tree is not green.
- Deployment: none.
- Limitations: a fixed list, not a generator, and it recompiles once per mutation, so it is not in
  `make gate`.
- Sponsor relevance: none.
- Last verified commit: `51e8e471acda`

---

## Guards

### Copied-Source Guard

- Id: `copied-source-guard`
- Purpose: enforce that nothing is copied into this repository from a vendored dependency.
- Product role: a licence guard as much as a credit one — `PoolManager.sol` and seven core
  libraries are BUSL-1.1, this repository is MIT and public, and a push is permanent.
- Version: 0.3.0
- Location: `script/no-copied-source.sh`
- Inputs: the tracked tree and the vendored sources.
- Outputs: a stated count, and every hit with its source file.
- Trust boundary: none.
- Security guarantees: none; it is a scan.
- Explicit non-guarantees: it compares line identity, so a paraphrase or a reflow defeats it. It
  reads untracked files as well as tracked ones — it did not, and on 2026-09-07 a green local gate
  met a red CI on the same commit, because the file it objected to was still untracked when the
  gate ran and `git ls-files` cannot see one. A gate whose verdict depends on whether `git add` has
  happened yet is a coin toss that CI resolves after the push. It exempts wire constants — a whole line that is one string literal opening as `Name(` — because an
  EIP-712 type string has exactly one correct spelling and a signature over any other is rejected
  by the deployed contract. That exemption is a hole a determined paste could use one line at a
  time, and it is recorded here rather than hidden.
- Dependencies: Python 3, git.
- Networks: none.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 157 files — tracked AND untracked — against 1,963 vendored body statements, zero
  reproduced; six controls, including two proving the wire-constant exemption stayed narrow and one
  proving an untracked file is scanned; and `--self-test` plants a real vendored statement and
  watches the scan go red.
- Tests: `script/no-copied-source.sh --self-test`
- Deployment: none; it runs in `make gate` and in CI.
- Limitations: as above.
- Sponsor relevance: none.
- Last verified commit: `fcfe151a83d4`

### Private-Leak Heuristic

- Id: `private-leak-heuristic`
- Purpose: catch private working material about to be committed to a public repository.
- Product role: an OPSEC backstop, not a gate.
- Version: 0.1.0
- Location: `script/no-private-leak.sh`
- Inputs: designated private files and the tracked tree.
- Outputs: matched phrase windows, redacted.
- Trust boundary: it reads private material, which is exactly why it is not in `make gate`.
- Security guarantees: none; it is a heuristic.
- Explicit non-guarantees: it will miss a paraphrase, and it can still cry wolf. It subtracts
  phrases that are already public, because private notes quote the public repository and a raw
  overlap implicated sixteen tracked files that were fine.
- Dependencies: Python 3, git.
- Networks: none.
- Status: PROTOTYPE
- Evidence: `bash script/no-private-leak.sh`
- Tests: the script carries its own controls.
- Deployment: none.
- Limitations: **deliberately not in `make gate`** — a gate must not depend on files that are not
  in the repository, or it cannot run on a clone.
- Sponsor relevance: none.
- Last verified commit: `ea079ec316cc`

---

## Surfaces and models

### ENSv2 Merchant Resolver

- Id: `ensv2-merchant-resolver`
- Purpose: turn a merchant's name into an address, once, before an order exists.
- Product role: how a payer identifies who they are paying without typing an address.
- Version: 0.1.0
- Location: `web/ensv2/resolve.mjs`, `web/ensv2/keccak.mjs`, `integrations/ensv2/test.mjs`,
  `integrations/ensv2/live-check.mjs`
- Inputs: a name.
- Outputs: a classified result — resolved, not found, no resolver, no address, unreachable — never
  a bare address.
- Trust boundary: the ENSv2 Universal Resolver at
  `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` on Sepolia, and the RPC endpoint.
- Security guarantees: it never falls back to a hard-coded address, and it distinguishes "could not
  reach the network" from "this name has no address".
- Explicit non-guarantees: **resolution is not identity.** A name resolving proves who controls the
  name and nothing whatever about the merchant behind it. It does not verify legitimacy, does not
  execute a swap, and does not prove a payment. Two of three failure shapes return success with
  `address(0)` rather than reverting, which is why every one is classified explicitly.
- Dependencies: the ENSv2 Universal Resolver.
- Networks: Ethereum Sepolia (read-only).
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 61 offline rows in `make gate`; 7 live rows in `make gate-live`; the keccak is validated
  against three published FIPS-202 vectors and seven `cast keccak` cross-checks.
- Tests: `integrations/ensv2/test.mjs`
- Deployment: none.
- Limitations: ASCII names only — it refuses non-ASCII rather than approximating ENSIP-15.
- Sponsor relevance: ENS. No claim is made that it qualifies for anything.
- Last verified commit: `0845dec9ea01`

### Web Checkout Surface

- Id: `web-checkout-surface`
- Purpose: let a person pay a merchant by name, seeing the resolved address before they commit.
- Product role: the operable surface. Two of the five published judging criteria are unreachable
  without one.
- Version: 0.7.1
- Location: `web/index.html`, `web/README.md`
- Inputs: a merchant name and an amount.
- Outputs: a resolution, a review step, and a settlement call.
- Trust boundary: the browser, the RPC, and the resolver.
- Security guarantees: none of its own; it shows what it resolved and asks before acting.
- Explicit non-guarantees: it is pinned to **V3 on Ethereum Sepolia** and knows nothing about the V2
  invoice path; it accepts native ETH and pays USDC, because that is what the deployed contracts
  accept; no stranger has yet completed a payment through it.
- Dependencies: the ENSv2 resolver module.
- Networks: Ethereum Sepolia.
- Status: PROTOTYPE
- Evidence: `bash script/check-surface.sh`
- Tests: `integrations/ensv2/test.mjs` covers the resolution it depends on.
- Deployment: none. GitHub Pages is disarmed and publishing is an owner action.
- Limitations: not published; no stranger has completed a payment through it. **Not audited.**
- Sponsor relevance: ENS, Uniswap.
- Last verified commit: `0845dec9ea01`

### Vyper Settlement Math Model

- Id: `vyper-settlement-model`
- Purpose: model the settlement arithmetic in a second language, where a different compiler and a
  different property-testing tool have to agree with it.
- Product role: a cross-check on the maths, not a deployment target.
- Version: 0.1.0
- Location: `vy/src`, `vy/tests`, `vy/moccasin.toml`
- Inputs: amounts and bounds.
- Outputs: the same numbers, or a disagreement worth reading.
- Trust boundary: none.
- Security guarantees: none.
- Explicit non-guarantees: no Vyper contract is part of the product, and none is intended to be.
- Dependencies: Vyper, Titanoboa, Moccasin.
- Networks: none.
- Status: PROTOTYPE
- Evidence: `cd vy && mox test` — 33 tests pass under Titanoboa 0.2.8.
- Tests: `vy/tests`
- Deployment: none.
- Limitations: not in `make gate`, because the gate does not require a Python toolchain.
- Sponsor relevance: none.
- Last verified commit: `28c82b75f36c`
### ENSv2 Permissioned Resolver and Access Control

- Id: `ensv2-permissioned-resolver`
- Purpose: read who is allowed to change a merchant's name, live, and simulate the change before
  anyone signs it.
- Product role: a merchant is not just a name — it is a name whose records only an authorised party
  may edit. This is the half that makes the name mean something.
- Version: 0.1.1
- Location: `integrations/ensv2/permissioned.mjs`, `authz-sim.mjs`, `preview.mjs`,
  `permissioned-test.mjs`, `permissioned-live.mjs`
- Inputs: a name, and an endpoint that must report Sepolia.
- Outputs: the resolver behind the name, its implementation, the role bitmap for an account, and a
  transaction preview — never a bare boolean.
- Trust boundary: the deployed Permissioned Resolver implementation at
  `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` on Sepolia, and the RPC endpoint.
- Security guarantees: it refuses before acting if the endpoint is not Sepolia; a return that will
  not decode is its own observation and is never rounded into "holds no roles"; and the preview
  cannot broadcast, because there is no signer to broadcast with.
- Explicit non-guarantees: the accepted half of the authorisation contrast is an `eth_call`, not a
  mined transaction. **That sentence is now false and is corrected rather than deleted.** It read: `grantRoles` and
  its siblings are confirmed only as dispatch constants, no live call has reached them. Live calls
  have since reached them on a pinned Sepolia fork, and the answer inverted the design:
  `grantRoles` is REFUSED by this deployment with `EACCannotGrantRoles` `0xd1a3b355`, even from an
  owner holding every role at ROOT_RESOURCE, and the call it accepts is
  `authorizeTextRoles(bytes,string,address,bool)` `0xf2d1eb25`, which grants at a per-KEY resource.
- Dependencies: the ENSv2 Merchant Resolver.
- Networks: Ethereum Sepolia (read-only).
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 305 offline rows in `make gate`; 78 live rows in `make gate-live`, including three real
  refusals decoded from the deployed contract.
- Tests: `integrations/ensv2/permissioned-test.mjs`
- Deployment: none. UNICA owns no ENS name.
- Limitations: every live row is read from a name somebody else registered; the per-text-key and
  per-coin-type resource derivations are derived rather than confirmed, because every refusal
  observed named the name-level resource.
- Sponsor relevance: ENS. No claim is made that it qualifies for anything.

### ENSv2 delegation planner and role screen

- Id: `ensv2-delegation-planner`
- Purpose: turn "this merchant wants to delegate one record to an agent" into an ordered, fully
  decoded transaction plan, and refuse the plan outright when it would hand over too much.
- Product role: delegation is the feature and also the risk. A merchant who cannot see exactly what
  they are granting will grant too much; this is the thing that makes the grant readable before it
  is signed.
- Version: 0.2.0
- Location: `script/ensv2/plan.mjs`, `plan-sabotage.mjs`, `integrations/ensv2/roles.mjs`,
  `plan-preview.mjs`, `plan-test.mjs`
- Inputs: a config naming the parent, the merchant owner, the agent and the resolver. Nothing else.
- Outputs: an ordered plan with every argument decoded, the resource each step touches, whether an
  admin role or ROOT_RESOURCE is involved, the expected post-state, and the rollback.
- Trust boundary: the pinned ENSv2 Sepolia deployment, and the owner's own reading of the preview.
- Security guarantees: it refuses to emit a grant at ROOT_RESOURCE rather than merely avoiding one;
  `agent_root_roles == 0` is a hard precondition; admin bits, `authorizeNameRoles`, `grantRoles` and
  registry-targeted calls are each refused by name; and every plan is `signable: false` until real
  gas estimates are supplied, because there is no signer here to sign one.
- Explicit non-guarantees: **subtree mode SERVES names it does not OWN.** The entry point routes the
  subtree to the parent's resolver, and that is what makes the records readable — but the write side
  is not name-scoped: on a per-name resolver the owner holds every role at ROOT_RESOURCE, so
  `hasRoles` returns true for any resource on that contract. If the subnames must be owned rather
  than served, that is subregistry mode, which is kept intact for exactly this reason.
- Dependencies: the ENSv2 Permissioned Resolver.
- Networks: Ethereum Sepolia.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 378 offline checks; 31 sabotage checks over 26 mutations, all behaving as expected with
  every file restored; subtree 17 steps / 13 transactions, subregistry 23 steps / 20 transactions.
- Tests: `integrations/ensv2/plan-test.mjs`, `script/ensv2/plan-sabotage.mjs`
- Deployment: none. UNICA owns no ENS name, and the shipped config for `unica.eth` correctly refuses
  until it does.
- Limitations: no gas is estimated here, so nothing is signable; the policy values stay off chain
  and only their commitment is written.
- Sponsor relevance: ENS. No claim is made that it qualifies for anything.

### Arc USDC Treasury

- Id: `arc-usdc-treasury`
- Purpose: hold, observe and bound a merchant's USDC on a chain where the money and the gas are the
  same asset, and stop in front of the signature.
- Product role: the leg that needs no DEX. A merchant's takings sit somewhere between settlements,
  and this is where the rules about that live.
- Version: 0.1.0
- Location: `integrations/arc-treasury/`
- Inputs: an Arc endpoint, a merchant address, a reserve floor, a per-action cap and a cooldown.
- Outputs: an observed position, one bounded action from a closed vocabulary with the reason it
  fired, and a transaction preview marked `REQUIRES_OWNER_SIGNATURE`.
- Trust boundary: the Arc testnet RPC, and the ERC-20 USDC at
  `0x3600000000000000000000000000000000000000` whose `decimals()` is read rather than assumed.
- Security guarantees: a native 18-decimal gas amount and a 6-decimal ERC-20 amount are separate
  types that refuse to meet; a token amount whose decimals were never read cannot be constructed;
  the module refuses a wrong chain id, an address with no code, and an unreachable endpoint rather
  than falling back to a fixture; and it holds no signer, so it cannot broadcast.
- Explicit non-guarantees: **no transaction has ever been broadcast and no UNICA contract runs on
  Arc.** There is no swap path, because Uniswap is not deployed there and inventing one would be a
  fake. The 20 Gwei floor is an observation of `eth_gasPrice`, not an observed rejection.
- Dependencies: `merchant_policy.vy`, whose `split()` is the on-chain truth this module's
  JavaScript is checked against.
- Networks: Arc testnet, chain id 5042002 (read-only).
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 177 offline rows plus 26 parity rows against 78 vectors captured from the real Vyper
  contract, both in `make gate`; 20 live rows in `make gate-live`.
- Tests: `integrations/arc-treasury/test.mjs`, `integrations/arc-treasury/split-test.mjs`
- Deployment: none.
- Limitations: the preview is verified as far as its bytes and their decode; that a wallet and the
  Arc mempool accept it is an owner action away.
- Sponsor relevance: Circle / Arc. No claim is made that it qualifies for anything.

### Graph Live Provider and Treasury Copilot

- Id: `graph-treasury-copilot`
- Purpose: read a merchant's settlements from a live subgraph and say something useful about them
  that can be re-derived.
- Product role: the merchant's own searchable record, and the reasoning on top of it.
- Version: 0.1.0
- Location: `integrations/graph-v2/provider.mjs`, `copilot.mjs`, `samples.mjs`,
  `provider-test.mjs`, `copilot-test.mjs`, `live-proof.mjs`
- Inputs: `UNICA_SUBGRAPH_URL` and, on the decentralised network, `GRAPH_API_KEY`.
- Outputs: settlement rows, or one of eighteen named refusals — never a partial read, and never a
  fixture wearing a live label.
- Trust boundary: the Subgraph Studio or gateway endpoint, and an independent RPC used only to
  learn the chain head the index is measured against.
- Security guarantees: freshness is judged before a row is read, and against a head the subgraph
  did not supply; a non-numeric staleness threshold is refused rather than defaulted, because a
  comparison against `NaN` is a guard that can never fire; no credential is rendered on any path;
  and the live path cannot reach the offline samples, which is asserted structurally and
  behaviourally.
- Explicit non-guarantees: **no successful live read has ever been observed**, because nothing is
  deployed to read from. The copilot is a deterministic analyst, not a model — that is deliberate,
  since a recommendation nobody can re-derive is a recommendation nobody can audit. Its thresholds
  are policy defaults and were never fitted to a real merchant's history.
- Dependencies: the V2 settlement indexer.
- Networks: Ethereum Sepolia.
- Status: IMPLEMENTED — LOCAL TESTS
- Evidence: 147 provider rows and 115 copilot rows in `make gate`; `make graph-v2-live` exits
  non-zero with no endpoint configured, which is itself asserted by a spawn in the provider suite.
- Tests: `integrations/graph-v2/provider-test.mjs`, `integrations/graph-v2/copilot-test.mjs`
- Deployment: none. A Studio deployment is an owner action, and the executor address the manifest
  names holds zero bytes on Sepolia today — so a deploy made now would index nothing, forever.
- Limitations: the response shapes are written from the GraphQL specification and The Graph's
  documented `_meta`, never captured from a live gateway.
- Sponsor relevance: The Graph. No claim is made that it qualifies for anything.
