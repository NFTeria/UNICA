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
| live verification scripts | **live** — `make proof`, 36 of 36 |
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
- Evidence: `make proof` prints 36 of 36 against `0x11202071…0Ea0C0` and tx `0x1120af18…ee0ecb83`.
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
- Limitations: the second derivation is in Solidity, not in another language as the payer's digest
  is. An offline derivation is owed. **Not audited.**
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
- Status: IMPLEMENTED — LOCAL TESTS
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
- Networks: a read-only fork of Ethereum Sepolia at block 11656701.
- Status: IMPLEMENTED — FORK TESTS
- Evidence: `make fork` — 39 rows: dependency provenance, a mined CREATE2 hook address, the
  integrated path (merchant paid exactly 100.000000 USDC for 0.041792042795051823 WETH against a
  1 WETH ceiling), 25 refusals each naming its own reason, and four rows against a hostile payout
  token. `make fork-mutants` kills 15 of 15.
- Tests: it is the tests.
- Deployment: none.
- Limitations: excluded from `make gate`, because a gate that depends on a third party's uptime is a
  status page rather than a gate. And a public node PRUNES: the first pin stopped resolving within
  the hour, so the block resolves from an archive endpoint or a warm Foundry RPC cache (about 212 KB
  for this block) and not from the public default indefinitely.
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
- Evidence: `make mutants` — 30 mutations, 30 killed by their own row, control green before and
  after.
- Tests: `script/mutation-suite.sh` is its own control: it fails if the unmutated tree is not green.
- Deployment: none.
- Limitations: recompiles thirty times, so it is not in `make gate`.
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
- Version: 0.1.0
- Location: `web/index.html`, `web/README.md`
- Inputs: a merchant name and an amount.
- Outputs: a resolution, a review step, and a settlement call.
- Trust boundary: the browser, the RPC, and the resolver.
- Security guarantees: none of its own; it shows what it resolved and asks before acting.
- Explicit non-guarantees: it is V1 only and knows nothing about the V2 invoice path.
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
