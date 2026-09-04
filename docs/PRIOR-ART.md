# PRIOR ART — has this been done before?

A six-angle public sweep run on 2026-09-04 (OpenZeppelin's catalogue, Uniswap Labs' permissioned
work, GitHub code and repository search, hackathon and incubator showcases, the author's own
earlier work, and audit and write-up literature), each claim opened and checked by an
independent refuter before it was kept: 78 artifacts kept, 2 dropped. Read-only; nothing here
was copied. The sweep was a sample, not a census; its blind spots are listed at the end and
they bound every negative statement below.

## The five categories the owner asked for

| Category | Verdict | The works |
|---|---|---|
| Exact match | **none found** among the verified artifacts: no work carries admission pinned to the official Universal Router at a chain-resolved immutable address, the executor required through `msgSender()`, every order term read from the executor's storage, refusal of both a partial fill and a short output in `afterSwap`, and a versioned order-bearing receipt beside the standard `HookFee`, together | a negative bounded by the blind spots below, never a claim of being first |
| Partial match | the same three-part shape, or the same order semantics, or the same caller gate, each without the rest | Uniswap Labs `PermissionedHooks` (caller resolved through `msgSender()`, indexer event from `afterSwap`; owner-mutable allowlist, no order), Crypto-UPI `TreasuryHook` (order terms with deadline, minimum, single-use id; from caller-supplied hook data, no caller gate), StabL `PaymentSettlementHook` (merchant settlement by intent, sender allowlist; no order, no recipient), `LargeCapExecutionHook` (registry, one privileged executor, order id in hook data, fill from the delta; excludes the official router, partial fills intended), `UniswapV4KEMHook` (signed per-swap terms with nonce and expiry), Uniswap Labs `PermissionedV4Router` (router-layer policy that leaves the take recipient caller-encoded) |
| Adjacent work | the mechanisms as documented practice, and the product framing | Uniswap's guide "Access msg.sender Inside a Hook", `IMsgSender` in v4-periphery, OpenZeppelin `IHookEvents.HookFee`, the hook registry's `swapAccess: allowlist` category, MerchantsPay and AnyPay (pay-in-X receive-in-Y), Trail of Bits and Cyfrin guidance on flag mining and recipient checks |
| UNICA's own disclosed prior art | the direct ancestor of the receipt, disclosed in the spec and the README, not copied | `Access0x1SwapReceiptHook`: `afterSwap` only, a self-asserted receipt, no order, no gate; UNICA inverts each of those choices |
| Unsupported claims, never to be said | contradicted by the sources below | "first settlement hook", "first router-gated hook", "first receipt", "nobody emits from afterSwap", "the only", "no one has done this" |

The sentence that survives the sweep: **UNICA composes Uniswap v4 hooks and official execution
infrastructure into a verifiable settlement flow with enforceable order invariants and
indexable receipts.** What is defensibly its own is the tested conjunction and the immutability
of the admitted path; every constituent idea has prior art, most of it Uniswap's.

---

**Prepared 2026-09-04. Read-only research. Every row below carries the URL or repo path of the artifact containing it, with a dated anchor. Items that could not be confirmed are marked UNCONFIRMED and are listed in "What the sweep did not look at".**

---

## The one-paragraph answer

The parts have been done. The whole has not been found.

Every mechanism UNICA relies on has verified public prior art, and most of it is **first-party Uniswap work**. Gating a v4 pool's `beforeSwap` on the caller is a named, *required* field in Uniswap's own hook registry. Reaching past the router with `IMsgSender(sender).msgSender()` is official periphery code that UNICA imports, documented in a Uniswap how-to guide from **March 2025**, and implemented in Uniswap Labs' own audited `PermissionedHooks`. `HookFee` is OpenZeppelin's standard event. An order-bearing receipt emitted from `afterSwap` is your own disclosed prior work from July 2026 — and Uniswap's permissioned hook emits from `afterSwap` too. A per-payment order carrying recipient, minimum, deadline and a single-use nonce, checked in `beforeSwap` and against the realised delta in `afterSwap`, exists in at least three third-party hooks, one of them deployed on Base since May 2025.

What the sweep did **not** find, across ~35 verified artifacts, is the conjunction of six properties at once — and every prior admission gate found, Uniswap's included, is owner-mutable where UNICA's is fixed at construction.

The README sentence you already have is the correct one and should not be strengthened:

> Settlement hooks, caller allowlisting, hook events, Universal Router execution, partial-fill controls and receipts are each known concepts or prior art; what this repository offers is their tested composition.

---

## Verified prior work

### First-party Uniswap

| Name | Date | URL | Overlaps UNICA | Differs from UNICA |
|---|---|---|---|---|
| **PermissionedHooks.sol** | file migrated into repo **2026-04-14**; trust-model docstring 2026-05-12; `Swap` event restored 2026-06-26 | `github.com/Uniswap/v4-hooks-public/blob/main/src/permissioned-pools/PermissionedHooks.sol` | The closest analogue anywhere. `_beforeSwap` → `_verifyAllowlist(IMsgSender(sender), …)`, caches `sender.msgSender()`, requires the calling router to be in `allowedWrappers`, reverts `Unauthorized`. `_afterSwap` emits a `Swap` event deliberately mirroring `IV4Router.Swap` "so indexers … [use] the same schema". Two-contract shape (hook + router companion). | Gates **who may trade** (issuer allowlist per currency), not where output lands. No order registry, no recipient, no amount/minimum/deadline/replay, no partial-fill or short-output refusal. `_afterSwap` verifies nothing — reads slot0 and emits. Allowlists mutable and issuer-managed. |
| **PermissionedV4Router.sol** | merged PR #476 **2026-05-27**; hardened #585 **2026-08-10**; inherited by `V4SwapRouter` since 2026-05-27, shipped as Universal Router **2.2.0** on 2026-07-18 | `github.com/Uniswap/v4-periphery/blob/main/src/hooks/permissionedPools/PermissionedV4Router.sol` | Official precedent that settlement-style policy needs a router-layer companion. Overrides `_validatePoolKey`, `_take`, `_pay`; `_take` gates on `isAllowed(msgSender(), SWAP_ALLOWED)`. Its own comment: "Permission enforcement for a permissioned pool lives in its hook." | **Does not bind the take recipient.** `_take` runs the caller check then calls `super._take(currency, recipient, amount)` with `recipient` untouched, straight from calldata. This is first-party proof that the recipient gap your executor closes is a *known, deliberately unfilled* gap in the official stack. No order, receipt, deadline, or fill check. Uniswap solved theirs by *extending* the router; UNICA leaves it unmodified. |
| **IMsgSender.sol** | added **2025-04-29** (commit `1ae55a68`, PR #458). One commit since. | `github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IMsgSender.sol` | UNICA imports this exact file. `UniversalRouter` implements it as `return _getLocker()` (`universal-router/contracts/base/Dispatcher.sol` L49-50). | A one-function interface. Gates nothing, binds nothing. UNICA uses it to prove a *contract* is behind the router; Uniswap's permissioned hook uses it to identify a *person*. Note the shared caveat, written into `IPermissionsAdapter`: "Wrappers must honestly report `msgSender()`…" |
| **Docs guide — "Access msg.sender Inside a Hook"** | originally published **2025-03-20** (commit `4bbeeb33`, PR #924); modified 2025-05-15; path renamed 2025-10-21 | `developers.uniswap.org/docs/protocols/v4/guides/hooks/accessing-msg.sender` | The single strongest "not novel" citation for I1. Prescribes: "Maintain a trusted list of swap routers in the hook", `mapping(address swapRouter => bool approved) public verifiedRouters;`, then `try IMsgSender(sender).msgSender()`. Names `github.com/Uniswap/universal-router` as the trusted-router example. | A teaching sketch. Stops at identifying the swapper and logging it. No order, no verification, no `afterSwap`, and it ships an unguarded `addRouter(address)` with `console.log` in the sample. **UNICA should cite this rather than let a judge find it.** |
| **hooklist registry schema (`swapAccess`)** | schema.json created 2026-02-26; `swapAccess` present no later than **2026-03-23** | `github.com/Uniswap/hooklist/blob/main/schema.json` | Uniswap models restricted swap access as a **required, closed-enum** hook property: `none \| temporal \| allowlist \| governance \| other`, alongside `requiresCustomSwapData`. UNICA self-declares `swapAccess=allowlist, requiresCustomSwapData=true` in `specs/HOOK-SPEC.md`. 20 of 746 entries already declare `allowlist`; 3 of those also declare `requiresCustomSwapData: true`. | Metadata, not implementation. The schema has no field for output destination, fill completeness, deadline, minimum, or a receipt — which is both the differentiation argument and a warning that a registry-driven reviewer will file UNICA next to ordinary allowlist hooks unless the settlement claims are stated separately. |
| **Permissioned Pools launch + architecture** | blog **2026-07-23**; architecture page current | `blog.uniswap.org/introducing-permissioned-pools-on-uniswap-v4` | "checks an issuer-managed allowlist on every swap"; "These checks happen at the protocol level, not on the frontend." Architecture page: the allowlist "is enforced twice: by the router … and by the hook on `beforeSwap`, so the restriction cannot be bypassed" — Uniswap's own published precedent for UNICA's hook+router argument. | Asset permissioning for regulated issuers. Per-address two-bit flags (`SWAP_ALLOWED`, `LIQUIDITY_ALLOWED`). No recipient binding, order registry, deadline, minimum, partial-fill refusal, or settlement receipt anywhere in the document. |
| **Permissioned-pools audits** | three PDFs published into the repo **2026-08-20** (PR #590); Cantina-driven fix commits 2026-05-12 | `github.com/Uniswap/v4-periphery/tree/main/audits/permissionedPools` | Two independent audits + a fix review of the first-party gate. Any claim that a gated settlement pool is unaudited territory is wrong. One auditor-driven lesson transfers: commit `359f7cb4` caches `sender.msgSender()` once "so both currency checks see the same subject". | Scope is eligibility gating and adapter wrapping. **UNICA has no audit and must not imply it inherits this assurance.** *(UNICA already satisfies the cached-msgSender lesson: `src/V4SettlementHook.sol` checks `sender != UNIVERSAL_ROUTER` **before** the `msgSender()` staticcall, and calls it exactly once.)* |
| **Uniswap live on Tempo — "pay with any token"** | **2026-03-18** | `blog.uniswap.org/uniswap-is-live-on-tempo` | The shipped first-party product occupying UNICA's problem statement: on a 402 challenge for a token the agent doesn't hold, the skill "swaps into the required token via the Uniswap API and retries the payment". Also "the first live deployment of aggregator hooks". | Solves it **off-chain and sequentially** — exactly the two-transaction window UNICA's README names as the problem. No hook invariant, no order, no atomicity, no receipt. The aggregator hook sources external liquidity; it does not admit or refuse swaps. |

### Third-party hooks — closest by mechanism

| Name | Date | URL | Overlaps UNICA | Differs from UNICA |
|---|---|---|---|---|
| **Crypto-UPI `TreasuryHook`** | committed **2025-09-27** | `github.com/shubu258/Crypto-UPI-/blob/main/contracts/src/TreasuryHook.sol` | **Closest match to UNICA's order semantics.** `hookData` carries `(txnId, user, deadline, minAmountOut, maxAmountIn)`; `_beforeSwap` rejects expired deadline (L135), rejects a reused `txnId` via a `used` mapping (L137), requires the hook to own a ticket NFT and burns it; `_afterSwap` requires `amountOut >= minAmountOut` (L265). Same before/after enforcement split. ETH/USDC currencies. | **No caller or router gate at all** — `_beforeSwap`'s first parameter is unnamed and discarded, so any caller can drive it. Terms come from caller-supplied hookData corroborated by an NFT, not a hook-side registry read (it even re-decodes hookData in `_afterSwap` rather than reading `pendingSwaps`). Output is an ERC-6909 claim pulled later, so settlement is **not atomic to the beneficiary**. No partial-fill check. `pause()` and `setMaxPerTx()` carry no access control. |
| **StabL `PaymentSettlementHook`** | first commit **2026-02-19**; repo 2026-02-01 | `github.com/MBarralDevs/StabL/blob/main/contracts/src/PaymentSettlementHook.sol` | Nearest third-party match by **name and intent**, and the one your own spec cites. L206: `if (!authorizedSettlers[sender]) revert Hook__UnauthorizedSettler(sender);`. Batch id through hookData; `SettlementSwapExecuted` + `SettlementFeeCollected` from `afterSwap`. Same OpenZeppelin `BaseHook`. | Gates the **raw v4 `sender`** only — no `msgSender()`, no official router (its own comment concedes the caller may be "a router acting on its behalf"). Owner-mutable allowlist. No order registry, recipient, minimum, deadline, or replay flag; hookData drives only fee decay. Takes a fee via `afterSwapReturnDelta: true`. ERC-20→ERC-20 (USDC/EURC), Arc, no native leg. |
| **`LargeCapExecutionHook`** | repo **2026-03-14**, hook commit same day | `github.com/Kingg-titan/large-caps-execution-hook/blob/main/src/LargeCapExecutionHook.sol` | Structurally the same three parts: order registry in a separate `IOrderBookVault`, one privileged executor as the only admitted caller (`sender != vault.executor()` → `SliceBlocked(INVALID_CALLER)`), order verified in `_beforeSwap` by an id in a strict 128-byte hookData, realised fill from the delta reported back in `_afterSwap`, order-bearing `SliceExecuted` event. Rejects malformed hookData outright. | Gates on the **executor's own address**, i.e. *excludes* the Universal Router rather than requiring it; never uses `IMsgSender`. No recipient in the order (claimed later via `claimOutput(orderId, amount, recipient)`), so nothing constrains the take destination. Slicing means **partial fills are the point** — the exact inverse of I6. Minimum/deadline live in the vault, not the hook's `afterSwap`. ERC-20 in. |
| **`UniswapV4KEMHook`** (deployed) | **deployed Base 2025-05-14** (block 30216737, deployer `0x47e1E291…`); also Ethereum, Arbitrum; Sourcify exact match | registry entry: `github.com/Uniswap/hooklist/blob/main/hooklist.json`; source via Sourcify chain 8453 | Deployed, mainnet-class prior art for **per-swap term verification**: `beforeSwap` enforces expiry, a `maxAmountIn` ceiling, an unordered nonce, and an ECDSA/1271 signature over a digest that includes the caller and the pool. `beforeSwap` + `afterSwap` + returns-delta. | The rate is a **CAP on output**, skimmed as surplus in `afterSwap` — the opposite direction of a minimum-output floor. Instruction is a signed off-chain quote presented by the caller, not a record already in storage. No recipient binding, no receipt, no whole-input-consumed check. Signer and surplus recipient are owner-mutable. |
| **`V4PermissionedSwaps`** (deployed, BNB) | registry entry added **2026-07-07** (PR #857); on-chain code confirmed live | `github.com/Uniswap/hooklist/blob/main/hooks/bnb/0x38358b924cb329dc428650f91309dfbddf974080.json` | UNICA's I1 reduced to its skeleton, live in production: "restricts swaps to an owner-managed allowlist of approved sender addresses, reverting … with `SenderNotAllowed`". `beforeSwap` only, `vanillaSwap: true`. Selectors confirm `allowedSenders(address)` + `transferOwnership(address)`. | Owner-managed and mutable. Checks `sender` only — no `msgSender()` unwrap. No order, no `afterSwap`, no settlement semantics. A door, not a settlement rail. |
| **`PrediXHookProxyV2`** (deployed, Unichain) | registry entry added **2026-08-18** | `github.com/Uniswap/hooklist/blob/main/hooks/unichain/0x2ea5eac8a4e31f0889e86fc135c5eae8e0b16ae0.json` | The one registered hook whose gate is specifically a **trusted-ROUTER allowlist** — `if (!_trustedRouters[sender]) revert Hook_UntrustedCaller(sender);` — plus per-swap identity commitments in transient storage and a per-trade event stream. | ERC1967 proxy with an admin and 48-hour timelocks; UNICA has no proxy, no admin, no setter. Identity comes from a router-written commit, not `msgSender()`, and is checked against nothing. Events report price and volume, not settlement terms. Its `afterSwap` check is an opt-in price bound from calldata, not an amount floor. |
| **M0 `AllowlistHook`** | repo 2025-03-05; file commits 2025-03-11 → 2025-07-08 | `github.com/m0-platform/uniswap-v4-hooks/blob/main/src/AllowlistHook.sol` | A production stablecoin-issuer hook doing UNICA's I1 mechanic **18 months earlier**: `if (!isSwapRouterTrusted(sender_)) revert SwapRouterNotTrusted(sender_);` then `IBaseActionsRouterLike(sender_).msgSender()` then `isSwapperAllowed(caller_)`. Trusted-router and trusted-position-manager sets. | Address eligibility, not output destination. No recipient, order, receipt, minimum, partial-fill, or native path. `afterSwap: false` — structurally cannot check output. Allowlists mutable under `MANAGER_ROLE`, and the whole gate is behind a toggleable `isSwappersAllowlistEnabled` flag. |
| **Predicate/Paxos `PredicateHook`** (USDL) | repo 2025-02-03; file commits to 2025-05-13 | `github.com/predicatelabs/predicate-paxos/blob/main/src/PredicateHook.sol` | Production compliance gate resolving the initiator through `router.msgSender()` and binding the swap's own parameters into an off-chain attestation checked in `beforeSwap`. | Never checks that `sender` **is** the router — it calls `msgSender()` on a stored, owner-settable router regardless of who called. Authority is an off-chain attestation in hookData, not a stored order. No recipient, minimum, deadline, nonce. `afterSwap: false` — no fill verification, no receipt. |
| **`AsyncSwap`** (deployed, Unichain) | verified on Sourcify **2026-05-07** (so deployed on or before) | registry entry: `github.com/Uniswap/hooklist/blob/main/hooklist.json` | Keeps an **order in storage** with a bound recipient (`order.owner`) and a minimum output, and calls completion "settlement" — plus an order-bearing `AsyncOrderFilled(poolId, orderId, filler, amountIn, amountOutMin)` event. | Replaces the AMM (`beforeSwapReturnDelta`), fill is off-curve and asynchronous — not atomic. Recipient is the maker, not a third-party payee. `swapAccess: "none"` — swap admission is *ungated*, and `_beforeSwap` writes an executor authorization from attacker-supplied hookData. No deadline, full-fill only. |

### The author's own disclosed prior art

| Name | Date | URL | Overlaps UNICA | Differs from UNICA |
|---|---|---|---|---|
| **`Access0x1SwapReceiptHook`** | first commit **2026-07-24T15:50:42Z**; live-fired **2026-08-17**, tx `0xdda93b0b…62c22`; deployed `0x4d6cF3e12C331393880df02b53017A478A6ec040` (Sepolia) | `github.com/Access0x1/Access0x1/blob/main/src/uniswap/Access0x1SwapReceiptHook.sol` | Same author, same product family, same one-sentence idea: a v4 hook that turns a merchant payout swap into an on-chain receipt carrying an order reference. Same CREATE2 flag-mining, same immutable-PoolManager anchor, zero fee, zero delta, same Sepolia path, same `abi.encode(orderRef)`-in-hookData shape. **UNICA's I2 receipt is its direct descendant.** | Deliberately passive and permissionless, and its own NatSpec says so: attribution is "UNVERIFIED AND SELF-ASSERTED"; anyone can emit a receipt naming any merchant; malformed hookData attributes 0/0 rather than reverting, precisely so a bad receipt cannot fail someone's swap. `afterSwap` only (0x40 vs UNICA's 0xC0). No `beforeSwap`, no order registry, no recipient, no minimum, no deadline, no replay flag, no router, no `msgSender()`. **UNICA inverts every one of those choices.** |

*I independently re-derived the deployment on-chain: `codesize` 1327, `POOL_MANAGER()` returns Uniswap's official Sepolia manager, `addr & 0x3FFF == 0x40`, and the live-fire tx's log decodes to merchantId 1 / orderRef `A0X1-LIVEFIRE-1` against two self-deployed MockUSDC ERC-20s — matching `specs/HOOK-SPEC.md` §0 exactly.*

### Standards, guidance and the wider category

| Name | Date | URL | Bearing |
|---|---|---|---|
| **OpenZeppelin `IHookEvents` / `BaseHook`** | repo 2024-09-25; `IHookEvents` first commit **2025-03-28**; UNICA pins v1.1.1 `bd5287c` (2025-11-27) | `github.com/OpenZeppelin/uniswap-hooks` | UNICA's actual dependency. `HookFee(bytes32 poolId, address sender, uint128, uint128)` is the library's standard event — the fee half of I2 is **adopted standard, not invention**. Across all sixteen non-mock source files at master, **not one** hook gates a swap on external-caller identity, binds a payout recipient, registers an order, or emits a settlement receipt. `BaseCustomAccounting` is the only place pairing a caller-supplied minimum with a deadline — and it is the liquidity path, not the swap path, with no recipient field. |
| **Trail of Bits — "Building secure Uniswap v4 hooks"** | **2026-07-30** | `blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/` | Independently states UNICA's design rules: "If you don't check the caller, an attacker can call those callbacks directly"; "bind your hook to canonical pools during deployment or trusted configuration"; and — the gap I6 closes — "settlement only checks that the session's currency deltas resolve; it does not validate the hook's internal accounting." Guidance, no implementation; zero occurrences of router/recipient/receipt/order/deadline. |
| **Cyfrin — "Uniswap v4 Hooks Security Deep Dive"** | **2025-11-14** | `cyfrin.io/blog/uniswap-v4-hooks-security-deep-dive` | Nine months before the window: "Is the correct recipient address specified? It is not necessarily always `msg.sender`." Cites the $12M Cork exploit as a hookData-trust failure — the reason UNICA reads terms from storage. Its native-token section (incl. an H-04 refund-DoS finding) is the same ground as I7. A taxonomy of defects, not a design. |
| **`MockUnapprovedWrapper`** (Uniswap test tree) | added **2026-08-10** (PR #585) | `github.com/Uniswap/v4-periphery/blob/main/test/hooks/permissionedPools/mocks/MockUnapprovedWrapper.sol` | Uniswap writing down test-validity discipline: the mock reports an allow-listed `msgSender` so "a revert is attributable to the wrapper check rather than the permission check. A wrapper without `msgSender()` is rejected earlier, on the hook's staticcall, which proves nothing." **UNICA is already immune by check order** — it compares the router address *before* the staticcall, so a non-router reverts `NotOfficialPath` and the trap is unreachable. |
| **Hackathon lineage** (context, no mechanism overlap) | UniV4HookKyc 2023-11 · UniChain Hook 2024-07 · MerchantsPay 2024-08 · Calary 2025-04 (UF v4 Hook Integrations **Runner Up**) · SubPay AI 2025-08 · AnyPay 2025-11 · UniFoody 2026-02 · xPact 2026-05 | ETHGlobal showcase pages | Establishes that beforeSwap-as-admission-gate and pay-in-X/receive-in-Y merchant framing are both well-trodden since 2023-2024. None registers a storage order verified by the hook; none gates to an official router; none refuses a partial fill. The Uniswap Hook Incubator's curated 2025 retrospective (Atrium, 2025-12-17) lists **no** payment, settlement, invoice, payroll, merchant or receipt hook among the projects it highlights. |

---

## What is NOT new — do not claim any of these

1. **Restricting who may swap.** Uniswap's registry makes `swapAccess` a *required* field with `allowlist` as an enumerated value.
2. **Gating on the calling router specifically.** `PrediXHookProxyV2` (deployed), M0's `AllowlistHook` (2025-03), Uniswap's own `allowedWrappers`.
3. **`IMsgSender(sender).msgSender()` attribution.** Official Uniswap code, 2025-04-29, plus a Uniswap guide from 2025-03-20 that prescribes exactly this pattern.
4. **Emitting an event from `afterSwap` for indexers.** Uniswap's `PermissionedHooks` does it explicitly to mirror `IV4Router.Swap`; StabL and AsyncSwap emit order-referenced events too. **Never say "nobody emits a receipt from afterSwap."**
5. **`HookFee`.** OpenZeppelin's standard, 2025-03-28.
6. **A merchant cross-token settlement hook.** StabL, named in your own pre-event spec, six months earlier.
7. **The pay-in-X/receive-in-Y framing.** MerchantsPay (2024-08); Uniswap themselves shipped a first-party version on Tempo (2026-03-18).
8. **An order with recipient + minimum + deadline + nonce, checked across before/after.** Crypto-UPI, 2025-09-27.
9. **Hook + constrained router as one enforcement unit.** Uniswap's own architecture page: "enforced twice … so the restriction cannot be bypassed."
10. **CREATE2 flag mining with a post-deploy assertion.** Standard practice; also in your own July 2026 deploy script.

---

## What, as far as this sweep found, is UNICA's

**The conjunction.** No verified artifact carries more than about three of these six simultaneously:

1. Admission pinned to Uniswap's **official** Universal Router, address resolved from `block.chainid`;
2. `msgSender()` required to equal **one** executor at a CREATE2-derived address;
3. Every order term read from that executor's **storage** — hookData is a 32-byte index, and a wrong length reverts;
4. **Both** a partial-fill refusal (`consumed != amountIn`) and a short-output refusal in `afterSwap`, against the same registered order;
5. A **versioned** order-bearing receipt emitted beside the standard `HookFee`;
6. Revert-only never-strand, native ETH in / ERC-20 out to the order's recipient.

**Immutability of the admitted path** — the strongest *uncontradicted* single claim. Every prior gate found is owner-mutable: Uniswap's `allowedWrappers`, M0's `MANAGER_ROLE` (plus a toggleable enable flag), StabL's `onlyOwner setAuthorizedSettler`, `V4PermissionedSwaps`' `Ownable`, PrediX's ERC1967 proxy + 48h timelock, KEM's owner-settable signer, Predicate's `Ownable2Step setRouter`. UNICA has no admin and no setter.

**Terms from storage, not from the caller.** Every order-bearing prior work found takes its terms from hookData or an off-chain signature, corroborated at best by an NFT or an attestation.

**A receipt that is an assertion rather than a log.** Your own prior hook states in its source that its attribution is unverified and self-asserted. UNICA's receipt survives only a transaction in which the order was verified from storage and the fill checked. That is a difference in *epistemic status*, not event shape — and should be phrased that way.

**Weaker negative, flagged as such:** "nobody refuses a partial fill against a registered amount" rests on a search that did not read 58 candidate hits. Do not lean on it in public copy.

---

## Three repo-accuracy items the sweep turned up

These are truth-in-what-ships items, not prior art. None affects the code.

1. **`docs/EXECUTION-PATH.md`, "Which Universal Router"** describes Sepolia `0x7DfD4F31…1468` as "(24,546 bytes, adds permissioned-pool support)". Re-derived on chain (2026-09-04, publicnode Sepolia): that router **reverts** on `PERMISSIONS_ADAPTER_FACTORY()`. The permissioned Sepolia router is `0x54C707Df…54b7` (23,705 bytes; the call returns `0xE6B0d969…fA2B`), and Uniswap's deploy guide lists it as the Sepolia Universal Router for permissioned pools. The byte count is right; the attribution is not. **Nothing in the code depends on it** — UNICA admits V2 at `0x3A9D48AB…`, unaffected. Strike or re-point the sentence.

2. **The prior-art disclosure does not name the prior art.** `specs/README.md` and `README.md` both state the specification "names" your earlier settlement hook; `specs/HOOK-SPEC.md` §0 gives its address, codesize, flags, salt (`0x31a`, 794 iterations) and live-fire tx, but not the repository or the contract. A reviewer following that promise finds a fingerprint, not a name. Adding `Access0x1/Access0x1` and `src/uniswap/Access0x1SwapReceiptHook.sol` costs one line and makes the disclosure self-verifying. (The project name "Access0x1" does appear in prose elsewhere in the spec, so the gap is the repo path and contract name only.)

3. **Prior-art ordering.** `specs/HOOK-SPEC.md` already records the decision to demote StabL from lead prior art in favour of Uniswap's own Permissioned Pools. This sweep confirms that is the right call — and adds that the Uniswap **docs guide** (2025-03-20) is a closer and older citation for I1's mechanic than either, and should be named too. Omitting first-party prior art reads, as your own spec puts it, as not having done the reading.

---

## No-copy verification (for the record)

- Every `.sol` file entered the repo between **20:09 and 23:14 UTC on 2026-09-04**, after the window opened.
- The entire history is authored `NFTeria <dev@nfteria.click>`; no AI-attribution trailer anywhere.
- `.gitmodules` pins only `forge-std`, `OpenZeppelin/uniswap-hooks` and `hookmate`. No Access0x1 dependency.
- Structural comparison with the prior hook: different base contract (OZ `BaseHook` vs raw `IHooks`), different pragma (`^0.8.30` vs `0.8.28`), different permission mask (0xC0 vs 0x40), different trust model, different constructor shape (zero-arg chain-id-resolved vs PoolManager argument), different test fixture (official etched PoolManager + Universal Router runtime vs `makeAddr` + prank), different import-formatting convention.
- The repo carries **no TypeScript at all**, so nothing from the earlier off-chain payout-swap rail crossed over.

*Limit: this covers public artifacts, the git history, the submodule set and structural comparison. Two private repositories could not be read.*

---

## What the sweep did not look at

Stated so the coverage can be judged. **These are limits, not clean bills of health.**

- **GitHub code search indexes only default branches of a subset of repos, caps result pages, and rate-limited mid-sweep (HTTP 403).** Every count recorded is a floor. Non-default branches, unindexed repos, private repos and non-GitHub hosting are invisible.
- **ETHGlobal's showcase search matches project TITLES only** — `"uniswap hook"` returned zero results while `"hook"` returned 33. Every relevant project was found by external search. The hackathon enumeration is definitely incomplete.
- **The Uniswap Hook Incubator has no public per-cohort index.** The curated retrospective covers UHI4-UHI6 and names ~21 projects against the programme's reported 241+ hooks shipped — roughly **90% of incubator output is unsurveyed**, and UHI1-UHI3 and UHI7-UHI10 entirely so.
- **Uniswap/hooklist was read at the description level: 746 descriptions, zero contracts.** A registered hook whose description omits the payment vocabulary but whose code matches UNICA would not have surfaced. The registry also records no deployment dates, so precedence over UNICA cannot be established from it. (It regenerates many times a day — cite the commit, never "the registry says".)
- **Directory sites:** `hookrank.io` could not be enumerated (client-rendered, empty shell). `hookatlas.com/hooks` was never fetched. **`uniswaphooks.com` no longer serves a hooks directory — the domain now resolves to an unrelated gambling site; if it is cited anywhere in the repo, that citation is dead.** `v4hooks.dev` is a skill site, not a directory.
- **No sweep of** GitLab, Etherscan/Sourcify verified-source corpora at scale, the Uniswap governance forum, X threads, or non-English sources.
- **Whether any public hook refuses a partial fill** by comparing consumed input against a registered amount — the sharpest remaining negative — was **not falsified**. 58 candidate code-search hits went unread.
- **The three permissioned-pools audit PDFs were never opened.** If they discuss the sender/`msgSender` trust boundary or recipient binding, that bears directly on I1 and is unread.
- **`github.com/dolepee/policypool`** surfaced twice in web search describing a v4 hook doing donate+swap in one unlock with receipts and "seven proof txs", but both the API and a direct fetch return **404**. Unresolved — do not cite.
- **Deployment status is unconfirmed for most third-party candidates.** Only the author's own hook (Sepolia) and `UniswapV4KEMHook` (Base, Sourcify exact match, deploy block 2025-05-14) were confirmed live by me. StabL, Crypto-UPI, UniFoody and LargeCap may never have been deployed.

---

## The line to use

> Router-gated admission, `msgSender()` attribution, standard hook events, order registries with minimums and deadlines, and settlement receipts are each prior art — much of it Uniswap's own, and one piece of it mine, disclosed and cited. UNICA is their composition: an admitted path fixed at construction with no admin, an order read from the executor's storage and never from the caller's bytes, both a partial fill and a short output refused against that order, and a versioned receipt beside the standard `HookFee`. That composition is what the thirty-four tests hold up. Nothing here is claimed past the rung it has reached.