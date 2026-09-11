# Arc workstream — test plan

Security review. Read-only research, local simulation and planning. Nothing in this file
deploys, signs, broadcasts, approves, funds or bridges anything, and nothing here asks anyone to.
This is a **test plan**, not new evidence: every Arc-side fact it relies on was already retrieved
on 2026-09-11 and carries an evidence id (`E-nn`) in `docs/unica-v4/arc/THREAT-MODEL.md`, which
this file cites by id rather than re-deriving. Where this file names a repository test file, that
citation is a path into this repository's own working tree, not an external source.

**Binding context**, unchanged from the sibling files: UNICA v4 is the UNICA release; Uniswap v4 is
the AMM. Payer-bound orders only, `WrongPayer` preserved. V2 Critical Advisory 001
(`docs/v2/SECURITY-ADVISORY-001.md`) is a mandatory regression. The UNICA fee is 0 in the beta. No
real tokenized equities; no unsupported BTC token. A same-asset USDC payment is never forced
through a swap. No real-value deployment without a Safe, a pauser, caps, verified contracts,
authenticated pricing wherever conversion occurs, adequate liquidity, simulations and an
independent human review. Compatibility is never described here as a completed integration.

**What this file adds that `THREAT-MODEL.md` does not.** The threat model is organized by threat
(T01–T29) and names one test per row. This file is organized by **test method** — unit, fuzz,
invariant, fork/simulation — because a threat and its test can need different preconditions,
different fixtures and a different place in the gate depending on which method proves it. Every row
below still traces back to a `T`-numbered threat or a `§4` regression; nothing here is a new claim
about Arc.

## 0. Status words

Identical to `THREAT-MODEL.md`'s convention, reused rather than redefined so the two files can be
read side by side without a translation step.

| Word | Meaning |
|---|---|
| RAN | The test exists in this repository, was executed on 2026-09-11, and passed |
| LAB | Exists and ran, but exercises a laboratory contract in `src/lab/` that is not deployed and that nothing depends on |
| PROPOSED | A named test to write. No file exists yet. It proves nothing until it exists and has been seen to fail on a sabotaged input (§11) |
| BLOCKED | Cannot be written until a named external fact exists, or until an owner decision unblocks it |

No test in this repository has yet run on Arc's own EVM (`THREAT-MODEL.md` §5). That is restated
here because it bounds every row below: a PROPOSED or LAB row proves UNICA's logic on a standard
EVM; only a row explicitly marked "on Arc" in §1 proves anything about Arc's own semantics.

## 1. What "on Arc" means for a test, and the three tiers

Arc's own documentation states that a plain local EVM "can't reproduce Arc-specific behavior"
(E-41) and names `arc-anvil --network arc` as the tool that does. That claim is taken at face
value and drives a three-tier structure; a row that does not say which tier it runs on has not
said anything about Arc.

| Tier | What it is | What it can prove | What it cannot prove | Where it lives |
|---|---|---|---|---|
| **Tier 1 — standard EVM** | `forge test`, Foundry's own EVM (Cancun), no fork | UNICA's own logic: payer binding, replay guards, cap arithmetic, receipt shape, reentrancy ordering — anything that does not depend on an Arc-specific opcode or predeploy rule | Nothing about Arc: not the fee floor, not blocklist-revert-with-gas, not `PREVRANDAO`, not the native/ERC-20 dual view, not CallFrom sender preservation | `make gate`, runs on every push |
| **Tier 2 — `arc-anvil --network arc`** | Arc's own local emulator (E-41), no network call, no key | Arc-specific EVM rules against a minimal stub or against UNICA's real contracts deployed locally to it: the 20 gwei floor and silent drop below it (E-36), a blocklist-touching send still consuming gas (E-38), `PREVRANDAO` always 0, native value shares one balance with the `0x3600…0000` ERC-20 view (E-10) | Real token state (whatever `arc-anvil` seeds is not Circle's live testnet state), and anything that needs a second party (a real CCTP attester, a real Gateway enclave signature) | A new `make arc-anvil` row, offline, no RPC — eligible for the default gate once the tool is confirmed installable in CI, by the same reasoning `script/experimental/stock-46630.test.sh`'s offline anvils are already gated |
| **Tier 3 — Arc Testnet fork** | `forge test --fork-url arc_testnet` against the `${ARC_TESTNET_RPC_URL}` alias already declared in `foundry.toml` (env-var only, never a literal URL, per this repository's own rule) | Everything Tier 2 proves, against Circle's real deployed USDC, EURC and cirBTC proxies, the real GatewayWallet, the real CCTP contracts, and the real chain id 5042002 — the highest-fidelity tier available before a mainnet exists | Nothing about Arc mainnet (chain id 5042): no public RPC exists for it (E-02, E-04) | `test/fork/arc/*`, excluded from `make gate` for the same reason `test/fork/*` already is — a gate that depends on a third party's uptime is a status page, not a gate — and added to a new `make arc-fork` row, run the way `make fork` already runs the Sepolia forks |

No mainnet tier exists and none is proposed. Chain id 5042 has no public RPC (E-02), so no fork,
`arc-anvil`, or unit test can be pointed at it; every row below is testnet-or-below.

## 2. Unit tests — decimals, ordering, and token identity

Threats: T01 (look-alike token), T02 (native-sentinel aliasing), T04 (mixed decimals), T05
(upgradeable token identity drift).

Confirmed on-chain today, cited so every row below states a real scale rather than an assumed one
(THREAT-MODEL.md E-09, E-10, E-11, E-18): native USDC on Arc Testnet is **18 decimals**, USDC's
ERC-20 interface at `0x3600000000000000000000000000000000000000` is **6 decimals**, EURC at
`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` is **6 decimals**, and cirBTC at
`0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` is **8 decimals**. `test_A2_the_pool_prices_raw_units_and_ignores_decimals`
(`test/experimental/StockSettlement.t.sol:58`, RAN) already proves the general shape of this
mistake — a Uniswap pool prices raw base units and has never read `decimals()` — against an 18/6
pair; the rows below extend the same shape to Arc's specific 18/6/6/8 quartet, which no test in
this repository has yet exercised.

| # | Row | Method | Preconditions | Assertion | Control | Status |
|---|---|---|---|---|---|---|
| D1 | `test_Arc_NativeAndErc20UsdcShareOneBalance` | Tier 3 fork | Fork at 5042002; an address funded with native USDC | Sending native USDC then reading the ERC-20 `balanceOf(0x3600…0000)` for the same address reflects the same underlying balance (E-10); crediting from the truncated 6-decimal view under-counts any amount below `1e12` wei of native value | Fund an amount whose low 12 digits are non-zero, assert the naive 6-decimal credit is short by exactly that remainder, then assert the native-unit credit is exact | PROPOSED |
| D2 | `test_Arc_NativeVersusErc20UsdcNeverPairInOnePool` | Tier 1 | A pool-config loader given a currency pair `(address(0) or 0xEeee…EEeE, 0x3600…0000)` | Load refuses with a named error before any pool is touched (E-44: Arc forbids aliasing the sentinel) | Load the same pair with the sentinel replaced by an unrelated ERC-20 and confirm it is accepted, so the refusal is about the pairing and not about the loader rejecting everything | PROPOSED |
| D3 | `test_Arc_DecimalsAreReadNeverAssumed` | Tier 1 | A market-admission stub given USDC (6), EURC (6), cirBTC (8) and native USDC (18) as candidate legs | Each leg's recorded scale equals a live `decimals()` read (or 18 for native) and the two 6-decimal tokens are not treated as interchangeable just because their scale matches | Mutate the stub to a hard-coded `18` for every leg and confirm cirBTC's 8-decimal case is now wrongly scaled, proving the read is load-bearing | PROPOSED |
| D4 | `test_Arc_LookAlikeCirbtcIsRefusedByAddressNotBySymbol` | Tier 3 fork | Fork at 5042002; the three look-alike addresses named in E-20 (`0x3120d73DA9691Ccb0bCea8e00d4C039086A32523`, `0x34792eAbf6bf8F827cB070db4016622e0341f21D`, `0x6dea8E463A6bfEB1acAb02f546E01990Bdf1D237`), each returning `symbol()=="cirBTC"`, `decimals()==8` | Admission refuses all three even though name, symbol and decimals equal Circle's | Admit Circle's own `0xf0C4…2BF` in the same run and confirm it passes, so the refusal is keyed on address and not on some property all four share | PROPOSED |
| D5 | `test_Arc_UpgradeableProxyBothSlotFamiliesRead` | Tier 3 fork | Fork at 5042002; USDC, EURC, cirBTC proxies, each a legacy zOS proxy with EIP-1967 slots reading zero (E-12, E-18) | Admission reads both the zOS slot (`org.zeppelinos.proxy.implementation`) and the EIP-1967 slot for every candidate, and records an implementation from whichever is non-zero, never assuming EIP-1967-only | Run the same admission logic through an EIP-1967-only reader and confirm it reports "not a proxy" for all three, reproducing the exact false negative E-12 already found by hand | PROPOSED |
| D6 | `test_Arc_ImplementationDriftRevokesAdmission` | Tier 3 fork, `vm.store` | A market already admitted USDC with implementation `0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6` pinned (E-12) | `vm.store` the zOS implementation slot to a new address; the next pre-quote re-read refuses with a named error before any transfer | Restore the original implementation slot value and confirm the same market re-admits without a human step, so the refusal is about the drift and not a permanently broken record | PROPOSED (T05's `test/arc/TokenPin.t.sol`) |

## 3. WrongPayer — the mandatory regression (§4.1 of the threat model)

This is not a new test design. It is the existing rule — `WrongPayer` is preserved, restated in
`docs/unica-v4/DECISIONS.md` item 111 — carried into every gate that touches an Arc-side executor,
plus the two Arc-specific variants Arc's own predeploys make possible.

| # | Row | Method | Preconditions | Assertion | Control | Status |
|---|---|---|---|---|---|---|
| W1 | `test_B5_refuses_the_wrong_payer_when_bound` | Tier 1, existing | `test/experimental/StockSettlement.t.sol:172`. An order bound to `payer`; a funded, approved stranger calls `pay(orderId)` | Reverts `WrongPayer(orderId, bound, caller)` with the exact selector and both arguments | The bound payer calling the identical order settles normally in the adjacent row | RAN 2026-09-11 |
| W2 | `test_Refuse_AnAuthorisationSignedByTheWrongPayer` | Tier 1, existing | `test/v2/SettlementRefusals.t.sol:286` | The V2 companion assertion over a signed authorization rather than a direct call | The matching honest-signer row in the same file settles | RAN 2026-09-11 |
| W3 | `test_Arc_BoundPayerViaMulticall3FromSettles` | Tier 2 or 3 | An order bound to `payer`; `payer` calls through Arc's `Multicall3From` predeploy (`0x522fAf9A91c41c443c66765030741e4AaCe147D0`, E-40), which Arc's own docs state relays with the **original caller preserved as `msg.sender`** | The executor's `WrongPayer` comparison sees `payer`, not the relay contract, and the order settles | W4 below, same fixture, different caller | PROPOSED (T12) |
| W4 | `test_Arc_StrangerViaMulticall3FromIsRefused` | Tier 2 or 3 | Same order; a stranger calls through the same `Multicall3From` predeploy | Reverts `WrongPayer(orderId, payer, stranger)` — the relay must not launder the caller's identity into an accepted one | W3, same fixture | PROPOSED (T12) |
| W5 | `test_Arc_Eip7702DelegatedPayerIsStillTheBoundIdentity` | Tier 2 or 3 | An order bound to an EOA that carries an EIP-7702 delegation designator (Arc itself seeds one such account, E-16); the comparison must be an **identity** check, never `tx.origin` and never an EOA/code-size test, both of which break under a delegated account (§4.1) | The delegated account settles its own bound order; a different caller acting through the same delegated account's code is refused | Run the identical fixture with `WrongPayer`'s comparison swapped for a code-size check and confirm it now wrongly refuses the legitimate delegated payer, proving the identity-check requirement is load-bearing and not stylistic | PROPOSED |

**Gate placement.** W1 and W2 already run in `make gate` on every push and must keep doing so for
any Arc-side executor, however its final shape differs from the experimental or V2 generations. W3
and W5 need Arc-specific predeploys (`Multicall3From`, EIP-7702 delegation) that plain Foundry does
not model faithfully, so they are Tier 2/3 rows, not Tier 1.

## 4. Advisory 001 — the mandatory regression (§4.2 of the threat model)

**Status: OPEN, reproduced, not fixed.** `docs/v2/SECURITY-ADVISORY-001.md` is Critical against
`src/v2/QuoteSettlementExecutor.sol` at `v2.0.0-rc1`, never deployed. This section states what an
Arc-side test plan must do about a defect that is not yet fixed, not a claim that it is fixed.

| # | Row | Method | Preconditions | Assertion | Control | Status |
|---|---|---|---|---|---|---|
| A1 | `test_Control_TheQuoteIdMovesTheWitness` | Tier 1, existing | `test/v2/WitnessBinding.t.sol:47` | The payer's signing digest is not a constant — varying `quoteId` moves it | — (this row is itself a control for A3–A4) | RAN 2026-09-11 |
| A2 | `test_Control_EveryWitnessedFieldMovesTheWitness` | Tier 1, existing | `test/v2/WitnessBinding.t.sol:54` | `payer`, `maxIn`, `tokenIn` each independently move the digest | — | RAN 2026-09-11 |
| A3 | `test_TheMerchantHalfIsOutsideThePayerWitness` | Tier 1, existing | `test/v2/WitnessBinding.t.sol:75`. Two quotes differing only in `merchantSigner` and `recipient`, built as two separate structs (never `Quote memory forged = q`, which aliases — the advisory's own recorded trap) | The forged quote's merchant digest moves; its payer witness does not — both halves asserted, because either alone would be misread | A1/A2 establish the digest does move for payer-side fields, so A3's non-movement is meaningful | RAN 2026-09-11 |
| A4 | `test_KNOWN_DEFECT_APayerAuthorisationFundsAnyMerchantsQuote` | Tier 1, existing | `test/v2/WitnessBinding.t.sol:91` | **Characterization test.** The payer's unchanged authorization settles the forged quote in full — this is the exploit, executed end to end, and it is expected to PASS today | `test_Control_AnHonestSettlementStillSucceeds` (same file) proves the fixture is not simply broken | RAN 2026-09-11 — passes because the defect exists |
| A5 | `test_KNOWN_DEFECT_TheHonestSettlementCannotFollow` | Tier 1, existing | `test/v2/WitnessBinding.t.sol:115` | The honest transaction reverts on the spent Permit2 nonce after the forged one lands — the merchant is left unpaid, not merely paid late | — | RAN 2026-09-11 — passes because the defect exists |
| A6 | `test_Control_AnHonestSettlementStillSucceeds` | Tier 1, existing | `test/v2/WitnessBinding.t.sol:136` | The same fixture, no forgery, settles normally | Makes A4/A5 evidence about the contract, not about the harness | RAN 2026-09-11 |
| A7 | `test_Arc_QuoteDigestBindingSurvivesXAndTwoTranslation` | Tier 1/2, new fixture | An x402 `exact` authorization (six flat fields, no quote digest — E-24) is translated into an order-bound UNICA settlement | Building A3's exact "differ only in the merchant's half" fixture against the x402-fronted shape reproduces the same non-movement the V2 witness shows, proving the sharpening `THREAT-MODEL.md` T11 describes rather than merely asserting it | Run the same construction against a design that binds the full quote digest (the rc2 fix, once it exists) and confirm the two forged-quote digests now differ | PROPOSED |
| A8 | Gate row `--match-path 'test/v2/WitnessBinding.t.sol'` | Tier 1, existing | Every push | 6 of 6 pass | The count itself (6, not fewer) is the control — a silently-skipped file would still show 0 failures | RAN 2026-09-11, and required on the default gate for as long as rc1 stands |

**What "fixed" requires, stated so no future row overclaims it.** A6 already exists and passes
honestly. A correct rc2 (Advisory 001's Option A: bind the full EIP-712 quote digest into the
payer's witness) is proven **only** when A4 and A5 are rewritten to expect a revert instead of a
success — inverting a `KNOWN_DEFECT` row is the acceptance test for the fix, not a new row that
merely asserts the fix "works." Until that inversion lands, any Arc-side settlement shape that
reuses this witness pattern inherits the open defect, not a fixed one, regardless of what this
document or any other says about Arc.

## 5. x402 replay and duplicate fulfilment

Threats T08 (permit replay), T09 (x402 replay / cross-domain confusion), T10 (duplicate API
fulfilment), T11 (merchant substitution, shared root cause with Advisory 001). x402's own
replay protection sits entirely in the token (E-23); UNICA adds a second, independent lock at the
order layer, and a third at the resource-server layer for the "served before settled" case
Nanopayments introduces (E-28).

| # | Row | Method | Preconditions | Assertion | Control | Status |
|---|---|---|---|---|---|---|
| X1 | `test_RevertWhen_envelopeNonceIsReplayed` | Tier 1, LAB | `test/lab/NanoAuthorization.t.sol:650` | A previously-settled envelope's nonce cannot fund a second settlement | The same envelope with a fresh nonce settles | RAN 2026-09-11 (LAB) |
| X2 | `test_RevertWhen_theSameEnvelopeIsSettledTwice` | Tier 1, LAB | `test/lab/NanoAuthorization.t.sol:1078` | Settling once, then again with byte-identical calldata, refuses the second call | The first call's own success is the control | RAN 2026-09-11 (LAB) |
| X3 | `test_RevertWhen_aCircleGatewayAuthorizationIsOfferedAsAnEnvelope` | Tier 1, LAB | `test/lab/NanoAuthorization.t.sol:303`. A signature built under Gateway's own `GatewayWalletBatched` domain (E-28) is offered where a UNICA envelope is expected | Refused — a Gateway-domain signature is not a UNICA-domain signature, by EIP-712 domain separation alone | A genuine UNICA-domain envelope over the same fields settles | RAN 2026-09-11 (LAB) |
| X4 | `test_Arc_TransferWithAuthorizationNonceRejectedAtTheToken` | Tier 3 fork | Fork at 5042002; a spent EIP-3009 nonce on USDC or EURC (both confirmed live, E-14) | A second `transferWithAuthorization` reusing that nonce reverts **at the token contract itself**, and `authorizationState(authorizer, nonce)` reads `true` afterward | A fresh nonce over the same authorized fields succeeds | PROPOSED (T08) |
| X5 | `test_Arc_X402Permit2RouteIsDisabledOnArcTestnet` | Tier 3 fork | Fork at 5042002; x402's canonical `x402ExactPermit2Proxy` at `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` (E-22) | `eth_getCode` at that address returns zero bytes; a config loader that offers x402 `permit2` as a route on chain id 5042002 refuses at load, before any authorization is built | The same loader accepts x402 `eip3009` as a route on the identical chain id | PROPOSED (T07) |
| X6 | `test_Arc_DuplicateFulfilmentSameIdSamePayloadIsCached` | Tier 1, resource-server stub | A UNICA resource server with `payment-identifier: required` set; one request served and fulfilled under identifier `id-1` | A second request with identifier `id-1` and byte-identical payload returns the cached response, no second on-chain settlement | — | PROPOSED (T10) |
| X7 | `test_Arc_DuplicateFulfilmentSameIdDifferentPayloadIs409` | Tier 1, resource-server stub | Same fixture as X6 | Identifier `id-1` reused with a different payload hash returns `409 Conflict` per the payment-identifier extension (E-25) rather than silently re-serving or silently re-charging | X6's matching-payload case returns 200, not 409, so the two rows together show the branch is keyed on payload and not merely on identifier presence | PROPOSED (T10) |
| X8 | `test_Arc_KnownNonceUnderANewIdentifierIsRefused` | Tier 1, resource-server stub + Tier 3 token read | A spent authorization nonce (X4's fixture) is offered fresh with a brand-new `payment-identifier` | Refused — the identifier layer cannot resurrect a nonce the token has already spent; the two locks (identifier, nonce) are independent and neither substitutes for the other | A brand-new nonce under a brand-new identifier is accepted | PROPOSED (T10) |
| X9 | `test_Arc_GatewayPendingItemIsNotCountedAsPaid` | Tier 1, resource-server stub | Under Nanopayments the seller serves before on-chain settlement (E-28); a request has been served and its authorization is part of a batch not yet observed on-chain | The order's ledger state is `pending`, not `paid`, until the batch settlement is independently observed on Arc | Once the batch's settlement transaction and its `Transfer` log are observed, the same order transitions to `paid` exactly once | PROPOSED (T21) |
| X10 | `test_RevertWhen_merchantRecipientDoesNotMatchTheConfigHash` | Tier 1, LAB | `test/lab/NanoAuthorization.t.sol:533` | A substituted merchant/recipient pair against an otherwise-valid envelope is refused — this is the LAB-scale echo of Advisory 001 (§4) | The unmodified, matching pair settles | RAN 2026-09-11 (LAB) |

**Cross-domain confusion is the load-bearing case, not ordinary replay.** X3 and X9 matter more
than a same-domain nonce reuse (X1, X2, X4), because Arc introduces two payment domains that share
vocabulary — a UNICA envelope and a Circle Gateway batch both authorize a transfer of the same
tokens — and the failure mode is a signature meant for one domain being accepted by the other, not
a nonce being reused within one domain. Every row above that touches a domain boundary names the
exact domain string it tests against (`GatewayWalletBatched` for X3; the token's own EIP-712 domain
for X4), because a bare "replay" assertion that does not name a domain cannot distinguish the two
failure modes from each other.

## 6. Oracle failure — fail-closed, not a demonstration-rate fallback

Threat T15. The load-bearing fact is absence, not malfunction: **no Chainlink feed exists on Arc
Testnet at all** (E-34 — the directory's "arc" section holds only "Arc Mainnet"). Arc Mainnet
itself lists 30 feeds including EURC/USD and USDC/USD (E-33), each with a 24-hour heartbeat and a
0.5% deviation threshold, but none is readable on-chain because no public mainnet RPC exists (E-04,
E-02). `docs/unica-v4/arc/LIQUIDITY-ORACLES.md`'s earlier draft reported no Arc entry at all on the
Chainlink page; `THREAT-MODEL.md` §6 corrects that — the entry exists, for mainnet, unreadable — and
this file follows the corrected version. A same-asset USDC order has no price, no pool and no
oracle and carries none of these rows (`THREAT-MODEL.md` §3.3 header).

| # | Row | Method | Preconditions | Assertion | Control | Status |
|---|---|---|---|---|---|---|
| O1 | `test_Arc_MarketWithUnsetOracleFailsToInitialize` | Tier 1 | A market-config loader given a non-USDC leg (EURC or a BTC asset) with no oracle adapter address configured | Initialization refuses with a named error before any pool or order can be created — **fail closed**, never a demonstration-rate fallback (`DECISIONS.md` "Oracle", lead, cited in `THREAT-MODEL.md` T15) | The same loader given a same-asset USDC-only market (no conversion leg) initializes with zero oracle rows touched | PROPOSED |
| O2 | `test_Arc_TestnetConversionMarketsStayDisabled` | Tier 1 or 3 | A market config naming EURC or cirBTC as the non-USDC leg on chain id 5042002 | Refused outright, independent of O1's unset-address case — the row is "conversion markets are off on testnet by construction," not merely "an unset address is caught" | O1 (a different, narrower failure mode) does not substitute for this row | PROPOSED |
| O3 | `test_Arc_StaleFeedIsRefusedAtSettlement` | Tier 3 fork, BLOCKED | Requires an Arc mainnet RPC reading one of the E-33 proxies (`EURC / USD` at `0x361b95c10b76Ca3f35C686d423e43A951755Bf23`, or `USDC / USD` at `0x84EA90AC252Dc437031461836DB5164219147905`) | A read whose `updatedAt` is older than the market's configured maximum age is refused at settlement time, not only checked at signing | A fresh read within the maximum age settles | BLOCKED on E-02/E-04 (no public mainnet RPC yet) |
| O4 | `test_Arc_SlippageBandExceedsTheFeedsOwnDeviationThreshold` | Tier 1, arithmetic-only | The E-33 feeds' documented 0.5% deviation threshold and 24-hour heartbeat, taken as given constants (no chain read needed for this row) | A market configuration whose slippage band is **at or below** 0.5% is refused at load — the feed can sit up to 0.5% stale for up to a day by its own contract, so a tighter band cannot be honestly enforced | A market with a band strictly greater than 0.5% is accepted | PROPOSED — this row needs no fork or feed read, only the documented constant, so it is not BLOCKED like O3 |
| O5 | `test_Arc_DexDerivedFeedIsNotTreatedAsIndependent` | Tier 1, config-only | The EURC/USD feed's own `docs.attributeType` is `"dex_state_price"` (E-33) — it is itself derived from DEX state | A pool-price bound against this feed is refused as "independently verified" — the config loader must require a second, non-DEX-derived source before treating the band as a real check, per T14's mitigation | A pool bounded against a feed whose `attributeType` is not DEX-derived is accepted without a second source | PROPOSED |
| O6 | `test_Arc_NoOracleNoPoolNoConversionForSameAssetUsdc` | Tier 1 | A same-asset USDC-to-USDC order (payer and payout both `0x3600…0000`) | The settlement path never calls an oracle adapter and never touches a pool — a direct transfer only, so a same-asset payment is never forced through a swap (binding context, restated as a test rather than only as prose) | The same fixture with payout set to EURC does route through a conversion path (whatever O1/O2 leave enabled), so O6 is shown to be about same-asset specifically | PROPOSED |

**Why O1/O2/O6 are Tier 1 despite being "about Arc."** These three assert what UNICA's own config
loader does with an oracle-shaped input; they need no Arc opcode and no Arc predeploy, only the
E-33/E-34 facts as fixture data. O3 is the one row in this section that genuinely needs Arc mainnet
state and stays BLOCKED until that state is publicly readable — conflating O3's blocked status with
O1/O2/O6's buildable status would understate what can be tested today.

## 7. Fuzz tests — nano-size rounding and dust

Threats T27 (rounding and dust extraction), T28 (tiny-payment DoS). The load-bearing measured fact
(`docs/unica-v4/arc/NANOPAYMENTS.md`, corroborated by `THREAT-MODEL.md` E-37): at Arc's 20 gwei fee
floor, one ERC-20 USDC `transfer` costs 49,097 gas, about **0.000982 USDC** — so a $0.001 on-chain
payment spends roughly 98% of itself on gas, and sub-micro-USDC amounts (below `1e-6` USDC, i.e.
below `1e12` wei of the 18-decimal native value) are invisible to the 6-decimal `balanceOf` view at
all (E-10). This repository's `[fuzz]` profile already runs 10,000 runs per property (`foundry.toml`)
at effectively no cost on this stack, so every row below asks for the full count, not a reduced one.

| # | Row | Method | Preconditions | Assertion | Control | Status |
|---|---|---|---|---|---|---|
| N1 | `test_RevertWhen_DustYieldsNoOutput_NothingMoves` | Tier 1, existing | `test/SettlementExecutor.t.sol` | An input small enough that the pool's raw-unit pricing yields zero output moves nothing — no partial credit, no rounding in anyone's favor | An input one unit larger, yielding output `1`, does move funds | RAN, existing gate row |
| N2 | `testFuzz_Arc_NoRoundTripExtractsMoreThanOneRawUnit` | Tier 1, fuzz, 10,000 runs | Random `amountIn` across the full `uint128` range, for each of the 18/6/6/8-decimal token combinations in §2 | Round-tripping the amount through the scale conversion and back never yields a value more than one raw unit away from the original — codifying `THREAT-MODEL.md` T27's mitigation ("every rounding is fixed in direction and against the claimant") as an executable property instead of prose | A deliberately-broken conversion that rounds toward the claimant is fuzzed against the same property and must fail within the run count, proving the property is not vacuously true | PROPOSED |
| N3 | `testFuzz_Arc_NativeToErc20ViewNeverOverstatesBalance` | Tier 1, fuzz, 10,000 runs | Random native-USDC amounts, including values with non-zero digits below `1e12` wei (the sub-micro-USDC case E-10 names) | The 6-decimal ERC-20 view of the same balance is always `≤` the true native-unit balance divided to 6 decimals — never rounds up | A mutant that rounds the division up is fuzzed against the same property and fails | PROPOSED |
| N4 | `test_Arc_MinimumOnChainSettlementFloor` | Tier 1 | A market configuration with a minimum-settlement-amount policy, and the measured 0.000982 USDC gas cost as a fixture constant | A settlement request below the configured floor is refused before any transfer — this is a gas-economics rule, not a UNICA fee (the UNICA fee stays 0, per binding context) | A request at or above the floor proceeds | PROPOSED (T28) |
| N5 | `testFuzz_Arc_FeeFloorRefusalIsMonotonic` | Tier 1, fuzz, 10,000 runs | Random amounts on both sides of the configured floor from N4 | Every amount strictly below the floor is refused and every amount at or above it is accepted — no gap and no double-accept band from an off-by-one in the boundary comparison | The floor value itself, tested at floor−1, floor, floor+1 as explicit (non-fuzzed) boundary cases inside the same fuzz run | PROPOSED |
| N6 | `test_Arc_SubFeeFloorTransactionSilentlyDrops` | Tier 2, `arc-anvil` | A transaction built with `maxFeePerGas` below Arc's documented 20 gwei floor (E-36: "silently dropped by the mempool") | No receipt is ever produced for it, and the order's ledger state is `UNKNOWN` until independently reconciled from chain state — never marked failed-and-retried, and never marked paid | The identical transaction at or above the floor produces a receipt and settles | PROPOSED (T20) |

**Why dust and the fee floor are one section, not two.** T27 (rounding) and T28 (tiny-payment DoS)
are two different mechanisms that both concentrate at the same input range — amounts near or below
a single raw unit, or near or below the cost of the gas to move them — so a fuzz run over that range
is the natural place to prove both properties together rather than in separate suites that might
drift out of sync on what "small" means.

## 8. Caps — fuzz and boundary tests against a draft, not a deployed contract

**Status of the subject under test.** `docs/unica-v4/SPEC-CONTRACTS.md` §9.2–9.3 is a draft, marked
in its own header "not committed, authorising nothing." No deployed UNICA contract on any chain has
a cap field, an allowlist, or a `payoutUsedOnDay` accounting today (`PRODUCT-FLOWS.md`'s own
finding). Every row in this section is PROPOSED **against that draft**, and stays PROPOSED even
once written, until a real `UnicaMarketExecutor` exists for these tests to run against. The beta
values named in the draft (`DECISIONS.md` items 5–7, quoted in SPEC-CONTRACTS.md §9.2): $10 per
transaction, $25 per day, $100 at risk — 10,000,000 / 25,000,000 / 100,000,000 base units for a
6-decimal stablecoin such as Arc's USDC or EURC.

The draft names four boundary error conditions in its §9.3 guard table (`OrderAboveCap`,
`PaymentAboveCap`, `DailyCapExceeded`, plus the seed cap checked once at `markSeeded`) and states
the rule for each: "each at the boundary: equal passes, one base unit over fails." This plan reads
those four as K1–K4 below; SPEC-CONTRACTS.md does not itself number them this way, so the mapping is
this document's own breakdown of its prose, not a quotation.

| # | Row | Method | Preconditions | Assertion | Control | Status |
|---|---|---|---|---|---|---|
| K1 | `testFuzz_Cap_OrderCreationAtOrBelowPerTxCapSucceeds` | Fuzz, 10,000 runs | Draft executor, `maxPerTxPayout` set to the beta value; random `minOut` at creation | `minOut == maxPerTxPayout` creates the order; `minOut == maxPerTxPayout + 1` reverts `OrderAboveCap` — the boundary itself, not an interior point, is the fuzz target via `bound()` | The unmodified cap check deleted (mutation) must let the `+1` case through, so the row is confirmed to kill that mutant before it is trusted | PROPOSED |
| K2 | `testFuzz_Cap_DeliveryAtOrBelowPerTxCapSucceeds` | Fuzz, 10,000 runs | An order whose `minOut` is at the per-tx cap; the pool's actual delivered amount varies | Delivered `== maxPerTxPayout` settles; delivered `== maxPerTxPayout + 1` reverts `PaymentAboveCap` — checked at settlement, independent of K1's check at creation (the draft's "checked twice") | Same mutation-kill discipline as K1, against the settlement-time check specifically | PROPOSED |
| K3 | `testFuzz_Cap_DailyRollingCapAtTheUtcBoundary` | Fuzz + `vm.warp`, 10,000 runs | Cumulative `payoutUsedOnDay[day]` near `maxPerDayPayout`; `block.timestamp` fuzzed across a UTC day boundary (`day = timestamp / 86400`, per the draft) | A payment that would push the running total one base unit over `maxPerDayPayout` reverts `DailyCapExceeded(day, used, cap)` with the correct `day`; the identical payment one second into the next UTC day succeeds against a fresh, zeroed counter — "a new day starts at zero without a write" | Warp to exactly `86400 * k` and confirm the boundary is UTC midnight, not a rolling 24-hour window from first use | PROPOSED |
| K4 | `test_Cap_SeedCapCheckedOnceAtMarkSeeded` | Tier 1 | A market's seed deposit measured through `StateLibrary`, per the draft's own method ("never from a position") | A seed at or below `maxSeedPayout` marks the market SEEDED; one base unit over refuses `markSeeded` itself, before the market can ever go ACTIVE | The identical seed amount, checked again later after the market is ACTIVE, is **not** re-checked — the draft states the seed cap is checked once, so a test asserting it is re-checked on every payment would itself be wrong | PROPOSED |
| K5 | `test_Cap_TighteningBelowAnOpenOrdersFloorFailsClosed` | Tier 1 | An open order with `minOut` above a new, lower `tightenCaps` value the admin sets mid-flight | The order becomes unpayable — `pay()` reverts against the new cap — and this is treated as fail-closed by design, not as a bug: "tightening below an open order's floor makes it unpayable, which fails closed and traps nothing" (SPEC-CONTRACTS.md §9.2) | The same order, cancellable or expirable through whatever path the draft provides, is not silently stuck forever — confirms "traps nothing" is actually true rather than asserted | PROPOSED |
| K6 | `invariant_Cap_DeliveredNeverExceedsWhatWasMeasuredAtTheRecipient` | Invariant (§9) | Handler performs random sequences of order-creation and settlement against random cap configurations | Across every sequence, the cumulative amount counted toward any cap equals the sum of amounts actually measured at the recipient — never `minOut`, never `amountIn`, matching the draft's "what counts" rule exactly | A handler variant that (wrongly) counts `minOut` instead of measured delivery is run against the same invariant and must be caught | PROPOSED |

**A refusal unwinds the increment.** Every row above that settles must also assert the negative
case does not partially advance the daily counter — the draft states a refusal "unwinds the
increment," and K3 in particular is only a real test of the boundary if a failed attempt at the
boundary is proven not to have consumed any of the day's cap before reverting.

## 9. Invariant tests

**None exist in this repository today.** A repository-wide search for `invariant_` or Foundry's
handler-based invariant harness found zero matches; every property below is a fuzz property proven
per-call in §7–§8, not yet a stateful invariant proven across a random call sequence chosen by
Foundry's own invariant runner. This section proposes the handler-based suite; it does not claim
one exists.

| # | Invariant | Handler actions | What it would have caught | Status |
|---|---|---|---|---|
| I-A | No UNICA call changes the executor's or hook's balance of either token (SPEC-CONTRACTS.md §9.3, "Invariant I1, restated") | Random order creation, payment, and third-party donations to the executor/hook addresses | A settlement path that leaves dust behind instead of forwarding it in full — donations are explicitly excluded (unrecoverable, no sweep, never blocking) so the handler must donate as a distinct action from paying | PROPOSED |
| I-B | `WrongPayer` fires for every non-bound caller, across every calling shape the handler tries (direct call, `Multicall3From`, an EIP-7702-delegated account) | Random caller identities against random bound payers, mixed with the three calling shapes from §3 | A payer-identity check that happens to work for direct calls but is fooled by one relay shape — exactly the class of bug §3's W3–W5 test individually; the invariant is that no handler-discovered sequence ever finds a bypass, not just the three named shapes | PROPOSED |
| I-C | `payoutUsedOnDay[day]` never exceeds `maxPerDayPayout` for any `day`, across any sequence of creations, settlements, cap-tightenings and day rollovers | Random order lifecycles interleaved with `vm.warp` and random `tightenCaps` calls | A day-boundary or tighten-mid-flight sequence that K3/K5's fixed scenarios do not happen to construct | PROPOSED |
| I-D | The sum of every `Settled` event's `amountDelivered`, restricted to one recipient, never exceeds what that recipient's token balance actually gained, cumulative | Random settlements across multiple recipients and multiple markets | A receipt that overstates delivery relative to the real balance delta — the same property `test_A3_no_residual_balance_anywhere_on_the_path` checks per-call, generalized across a whole run | PROPOSED |
| I-E | Once an order reaches `Settled`, no handler action returns it to `Open` or `Paying` | Random calls including direct-storage-adjacent actions available to the handler (re-creation with the same id, repeated `pay`, admin actions) | The exact property `test_E1_a_settled_order_never_returns_to_open` already checks once; the invariant form asks it of every reachable state, not one hand-picked sequence | PROPOSED |

**Why invariants matter here specifically.** Every regression row in §3–§5 is a fixed, hand-built
sequence: one payer, one stranger, one forged quote. Arc's own predeploys (`Multicall3From`,
EIP-7702 delegation) and the caps draft's day-rollover arithmetic are exactly the kind of surface
where a handler-driven random sequence finds an interaction the hand-built rows did not think to
try — which is the entire argument for writing I-A through I-E rather than declaring §3–§8
sufficient because their named rows pass.

## 10. Fork/simulation — the rows that need Arc's own chain state and cannot be Tier 1

Collected here because each needs either Tier 2 (`arc-anvil`) or Tier 3 (the Arc Testnet fork) and
touches infrastructure this document has not yet named: RPC agreement, CCTP, and the Safe.

| # | Row | Tier | Preconditions | Assertion | Control | Status |
|---|---|---|---|---|---|---|
| F1 | `test_Arc_BlocklistedPayerRefusedBeforeAnyTransfer` | 3 fork | Fork at 5042002; Arc's own seeded blocklisted test address `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (E-16), blocked on USDC, **not** blocked on EURC or cirBTC | Using the blocklisted address as payer on a USDC-leg order refuses with a named error before any transfer attempt; the identical address on an EURC-leg order is not refused by this check, because the blocklist is per-token | Repeat with the address as recipient instead of payer, since `THREAT-MODEL.md` T06 requires checking both roles | PROPOSED |
| F2 | `test_Arc_BlocklistRevertReceiptPresenceBothCasesHandled` | 2, `arc-anvil` | A native-value transfer that reverts on a blocklist check (E-38 says it still consumes gas; E-39 disputes whether a receipt exists — Arc's own pages disagree, so this is genuinely UNKNOWN) | The reconciliation logic treats **both** possible outcomes (receipt-with-revert, and no-receipt-at-all) as resolvable to the same `UNKNOWN`-then-reconciled state, rather than assuming one and breaking on the other | Run the same handler against both simulated outcomes explicitly, since `arc-anvil`'s actual behavior on this point was not established as of 2026-09-11 | PROPOSED |
| F3 | `test_Arc_CctpCreditGatedOnDestinationMint` | 3 fork | Fork at 5042002; CCTP `MessageTransmitterV2` at `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`, confirmed 2-of-2 attester threshold (E-31) | A `depositForBurn` with no matching `receiveMessage` on Arc leaves the corresponding UNICA order `pending`, never credited; credit happens only once the mint is observed on Arc, never inferred from the source-chain burn event alone | The same flow with a matching, observed `receiveMessage` credits exactly once | PROPOSED (T24) |
| F4 | `test_Arc_FinalityExecutedThresholdGatesCrossChainCredit` | 3 fork | CCTP's own "Confirmed" (1000) versus "Finalized" (2000) thresholds (E-32) | An inbound message below `finalityThresholdExecuted` 2000 is not credited | The same message at or above 2000 is credited | PROPOSED (T23) |
| F5 | `test_Arc_SafePauseOnlySafeUnpauses` | 3 fork | Fork at 5042002; SafeL2 1.4.1 and its factory, codehash-matched to `safe-deployments`' canonical entries (E-42) | The pauser role can pause; the pauser **cannot** unpause; only a Safe transaction from the registered Safe unpauses (`DECISIONS.md` item 70, lead) | The pauser attempting `unpause()` directly reverts; the Safe's own `unpause()` transaction, correctly signed, succeeds | PROPOSED — mainnet Safe readback stays BLOCKED on the owner (T26); this row is testnet-only |
| F6 | `test_Arc_DualRpcMismatchHalts` | 3, two providers | Two of the four keyless RPC endpoints Arc's own docs name, read at the same block number | Any disagreement in chain id, block hash, or a settlement receipt between the two providers halts the read path rather than silently picking one | Both providers agreeing (today's observed state, E-01) proceeds normally | PROPOSED (T22) |
| F7 | `test_Arc_ReentrancyRowsRerunUnderArcAnvil` | 2, `arc-anvil` | The four existing reentrancy rows (`test_ReentrantPaymentOfTheSameOrderIsRefusedByItsState`, `test_ReentrantPaymentOfAnotherOrderIsRefusedByTheRouterLock_AndStaysPayable`, `test_Adv_TheContextTheReentrantCallSeesIsTheOuterOne`, LAB's `test_B4_03_theWholeReentrancySurface`) | Every assertion these four rows already make on a standard EVM holds unmodified under `arc-anvil`, where a token upgrade could later add a callback (E-12) and Arc's own native-value sends can revert for reasons Ethereum does not have (E-38) | The four rows' existing standard-EVM pass is itself the control — a divergence between the two runs is the finding | PROPOSED (T18) |

## 11. Control discipline — the rule every PROPOSED row above must follow before it counts

A negative test that has never been seen to fail on a sabotaged input is not evidence of anything
(this repository's own convention, stated plainly in `test/lab/NanoAuthorization.t.sol`'s header
and in `SPEC-CONTRACTS.md`'s C4/C5: "each mutant... must be KILLED... with 0 misattributed", "each
negative row reproduces the attack's precondition and pairs with a passing control"). Every row
above marked PROPOSED is required, before it is trusted, to have gone through this sequence at
least once:

1. **Build the fixture** with the guard in place, and confirm the honest case passes.
2. **Mutate exactly one thing** — delete the check, flip a comparison, swap in a wrong constant —
   and confirm the row now fails. A row that has never been red is not known to test anything.
3. **Assert the named failure**, not a bare `expectRevert()`. `StockSettlementGaps.t.sol`'s own
   header records why: where two checks guard one property, deleting one still leaves the other
   catching a bare revert, and the gap goes unnoticed. Every PROPOSED row above that names an error
   (`WrongPayer`, `OrderAboveCap`, `DailyCapExceeded`, and so on) must match that exact error and its
   arguments, not merely "it reverted."
4. **Restore the one thing changed**, and where the row concerns a signed digest, confirm the digest
   is byte-identical to the pre-mutation digest before re-asserting the honest case settles — the
   restore-and-confirm-by-hash step used throughout `NanoAuthorization.t.sol` is what stops a test
   passing because the fixture was broken all along, not because the guard works.
5. **Register the mutant** in this repository's mutation suite once one exists for the Arc-side
   contracts, the way `SPEC-CONTRACTS.md` §9.3 already requires for the draft's own guard table.

A `KNOWN_DEFECT` row (§4, A4–A5) is the deliberate exception: it is written to pass **because** the
defect exists, and its own control (A6) is what proves the fixture is not simply broken. Nothing in
§1–§10 should be read as asking a `KNOWN_DEFECT` row to be inverted before Advisory 001's rc2 lands
— inverting it early would silently hide the very defect this plan exists to keep visible.

## 12. Gate wiring

| Tier | Where it runs | Runs on every push? | New Makefile row needed |
|---|---|---|---|
| 1 (standard EVM) | `make gate` | Yes — this is the default gate `forge test --no-match-path '{test/fork/*,test/compat/*,...}'` already runs | No — new `test/arc/*.t.sol` files land inside the existing gate's include set the same way `test/lab/` and `test/v2/` already do |
| 2 (`arc-anvil`) | Proposed `make arc-anvil` | Not yet — needs the tool confirmed installable in CI first, the same bar `script/experimental/stock-46630.test.sh`'s offline anvils already cleared | Yes |
| 3 (Arc Testnet fork) | Proposed `make arc-fork`, alongside the existing `make fork` | No, by the same reasoning `test/fork/*` is already excluded: a gate that depends on a third party's uptime is a status page, not a gate | Yes |

§3's W1/W2 and §4's A1–A6 (the two mandatory regressions) are the only rows in this entire plan that
must be Tier 1 and must run in `make gate` today — every other row can be written and still wait on
its tier's infrastructure without weakening the two regressions the binding context names as
mandatory.

## 13. Summary

Counted directly from each row's own Status column above — a prose citation that is not itself a
numbered row (`test_A2…` in §2, cited in prose but not one of D1–D6) is excluded here, so this
table's arithmetic is checkable against §2–§10 without cross-referencing prose.

| Category | RAN | LAB | PROPOSED | BLOCKED | Total named |
|---|---|---|---|---|---|
| §2 Decimals/ordering/identity (D1–D6) | 0 | 0 | 6 | 0 | 6 |
| §3 WrongPayer (W1–W5) | 2 | 0 | 3 | 0 | 5 |
| §4 Advisory 001 (A1–A8) | 7 | 0 | 1 | 0 | 8 |
| §5 x402 replay/duplicate fulfilment (X1–X10) | 0 | 4 | 6 | 0 | 10 |
| §6 Oracle failure (O1–O6) | 0 | 0 | 5 | 1 | 6 |
| §7 Nano rounding/dust (N1–N6) | 1 | 0 | 5 | 0 | 6 |
| §8 Caps (K1–K6) | 0 | 0 | 6 | 0 | 6 |
| §9 Invariants (I-A–I-E) | 0 | 0 | 5 | 0 | 5 |
| §10 Fork/simulation (F1–F7) | 0 | 0 | 7 | 0 | 7 |
| **Total** | **10** | **4** | **44** | **1** | **59** |

Read against `THREAT-MODEL.md` §8 (0 tests run on Arc's own EVM as of 2026-09-11): this plan adds no
new RAN rows of its own. The 10 RAN and 4 LAB rows above are existing tests this plan cites and
organizes by method; the 44 PROPOSED and 1 BLOCKED rows are new to this document. The net position
is unchanged from the threat model's own: UNICA's logic is tested and green on a standard EVM;
nothing in this repository has yet run on Arc's own EVM; the two mandatory regressions (WrongPayer,
Advisory 001) are proven today and must stay proven under every future Arc-side shape.

## 14. Still UNKNOWN, and what would resolve it for this plan specifically

| Unknown | Why it stays unknown | What resolves it |
|---|---|---|
| Whether `arc-anvil` is installable inside this repository's CI runner today | Not attempted as of 2026-09-11 — `THREAT-MODEL.md` cites Arc's own claim about it (E-41) but no row here ran it | Install it in a scratch environment and run one Tier-2 row named above; if it fails to install, every Tier-2 row in this plan degrades to BLOCKED until it does |
| Whether the caps draft (`SPEC-CONTRACTS.md` §9.2) will ship with exactly the four boundary conditions this plan's K1–K4 assumes, or a different accounting shape | The draft is explicitly "not committed, authorising nothing"; K1–K4's mapping is this document's own reading of its prose | The owner's decision on the v4 spec, then re-deriving K1–K4 (or replacing them) against whatever accounting the shipped contract actually implements |
| Whether O3's blocked Arc-mainnet oracle read resolves before or after Arc's mainnet chain id (5042) itself becomes publicly readable | Both depend on the same missing fact: a public mainnet RPC (E-02, E-04) | An Arc-published mainnet RPC endpoint, then the same `eth_chainId` and feed reads §1's Tier 3 already describes for testnet |
| Whether F2's blocklist-revert-receipt ambiguity (E-38 versus E-39) resolves toward "receipt exists" or "no receipt," which changes what F2's assertion should actually be | Arc's own two pages disagree and this plan does not adjudicate between two Circle-controlled primary sources | Run F2 once under real `arc-anvil` or against the real testnet and record which behavior is observed, then rewrite F2 as a single-outcome assertion instead of a both-outcomes-handled one |
| Whether any Arc-specific mutation-testing tool exists to automate §11 step 5 (registering mutants), or whether this stays a manually-written mutant per row | Not investigated as of 2026-09-11; the repository's existing mutation discipline (`SPEC-CONTRACTS.md` §9.3) does not name a specific tool | Check whether the tooling already used for the frozen experimental generation extends to `test/arc/*` once those files exist |
| Whether Circle Nanopayments' per-authorization fee (referenced in §7's N4 as "the UNICA fee stays 0, the floor is a gas rule") has any facilitator-side counterpart that would change N4's floor arithmetic | `NANOPAYMENTS.md`'s own unknown, not resolved here | Circle's Nanopayments pricing page, not yet published with a per-authorization number as of 2026-09-11 |

This file makes no claim beyond what is written above: no UNICA contract runs on Arc's EVM today,
every PROPOSED row here is a name and a design, not a result, and the two mandatory regressions
(§3, §4) are the only rows this plan asks to be trusted as already proven.
