# ⟠ The Settle-and-Swap Hook — design of record (v2)

**v2 stamped 2026-08-21.** WAR-ROOM ONLY. Status: **PLANNED — does not exist.**
Every sentence about *this* hook reads PLANNED until it compiles.

> **v2 supersedes v1.** Research on 2026-08-21 found that **v1's core invariant was
> impossible as written**. The design is now router-gated, not passive. §2 is the
> reasoning — read it before touching the invariants, so it does not get
> relitigated mid-build.

---

## §0 — Correction the owner needs: a v4 hook ALREADY exists

Several war-room and application documents say otherwise; they are stale.

an earlier settlement hook by the same author — prior art, NOT a dependency of this repo and not linked from it

| Fact | Value | How verified |
|---|---|---|
| Address (Ethereum Sepolia) | `0x4d6cF3e12C331393880df02b53017A478A6ec040` | `cast codesize` → **1327** |
| PoolManager (immutable) | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | `cast call POOL_MANAGER()` — matches Uniswap's official list |
| Flags in address | `addr & 0x3FFF == 0x40` = **AFTER_SWAP** (bit 6) | computed; CREATE2 salt `0x31a`, found in 794 iterations |
| Live fire | pool initialized with the hook; swap emitted `SwapReceipt` | `broadcast/LiveFireSwapReceipt.s.sol/11155111/`, tx `0xdda93b0b…62c22` |
| Caveat — state it | the live-fire pool used **two MockUSDC ERC-20s** we deployed for liquidity | broadcast records |

**Consequences:**
1. The UFSF blocker *"no v4 hook exists"* is **stale** — corrected in
   [`../funding/uniswap/README.md`](../funding/uniswap/README.md). Two real blockers
   remain: entity+KYB, and 6-month DEX exclusivity vs the 1inch rail.
2. The UHI application's *"the hook does not exist yet"* is still defensible — it
   describes the **Settle-and-Swap** capstone, which genuinely does not exist.
   **Never let it be restated as "we have no v4 experience."**
3. ETHOnline is lower-risk than assumed: CREATE2 flag mining, PoolManager
   authentication, and the deploy choreography are **solved problems we authored**.

**Prior-art rule:** the receipt hook is ours, public, and cited as prior art in the
new repo's README. **Cited — never copied** (a copied file turns a Classic-track
repo into a continuity repo and forfeits every partner prize).

---

## §1 — The problem, stated once

Today an Access0x1 payout swap is an **off-settlement second transaction**: settle
the merchant in USDC, then the merchant's wallet signs a separate swap into their
preferred asset. Two transactions, two failure surfaces, and a window where the
merchant holds an asset they did not ask for.

Atomic **pay-in-X / receive-in-Y** requires the swap to sit *inside* the settlement
boundary.

---

## §2 — ⚠️ Why this is a ROUTER + hook, not a passive hook

**A passive `beforeSwap`/`afterSwap` hook cannot enforce where swap output lands.**
This is a hard fact in v4-core, not an ambiguity. Three facts compose:

1. **`PoolManager.swap()` has no recipient parameter.** Output is credited as a
   transient-storage delta to `msg.sender` — the router that called `swap()`.
2. **Tokens move later**, when the router calls `take(currency, to, amount)` and
   picks `to` itself. That happens **after `afterSwap` has already returned** — the
   hook is out of the call stack when the recipient is chosen.
3. **`afterSwap`'s `sender` is the router**, not the payer and not the payee.
   (Uniswap's own docs: inside a hook, `msg.sender` is always the PoolManager.)

### The design — a router-gate

```
UnicaSettlementRouter (we write it, it is the only authorized caller)
  └─ poolManager.unlock()
       └─ unlockCallback:
            ├─ poolManager.swap(key, params, abi.encode(orderId))
            │    └─ hook.beforeSwap  → revert unless sender == authorizedSettler
            │    └─ hook.afterSwap   → verify realized output vs the registered order; emit
            └─ poolManager.take(outputCurrency, order.merchantPayout, amountOut)
```

**I1 then holds by construction** — we wrote the only contract permitted to route
through the pool, and it always `take`s to the registered payout address. The hook's
job is *gatekeeping and verification*, not redirection.

This is also how the closest prior art works (StabL's `PaymentSettlementHook` gates
on `authorizedSettlers[sender]`), and Uniswap's own hook registry models it as a
first-class property — hook entries carry a `swapAccess` field.

### Honest framing for the submission

> **"A verifiable settlement-invariant router + policy hook."**

**Not** "a hook that enforces the payout address." A judge who knows v4 will catch
that claim immediately, and being the team that states the constraint correctly is
worth more than the stronger-sounding sentence.

### Rejected alternative — hook takes the output itself

With `AFTER_SWAP_RETURNS_DELTA_FLAG` the hook can return a positive `int128` and
`take()` to the merchant itself. Rejected for three reasons:
- **Exact-output is foreclosed.** `afterSwap`'s delta is in the *unspecified*
  currency; for exact-output, unspecified = the **input** token, so the hook cannot
  touch output at all. Merchants want *exactly X of asset Y* — exact-output is the
  natural shape.
- Doing it via `beforeSwapReturnDelta` instead **turns the hook into a custom AMM**,
  inheriting the full conservation/price-bound/rounding test burden.
- It needs flags `0xC4`, not `0xC0` — and a missing returns-delta bit is a **silent
  no-op** (see §5).

---

## §3 — The invariants (the actual specification)

Each is a testable assertion. Each gets a **negative test that must fail before it
passes** — a suite that never went red proves nothing.

| # | Invariant | Enforcement point | Negative test |
|---|---|---|---|
| **I1** | **Recipient guarantee** — output can only reach `order.merchantPayout` | `beforeSwap` reverts unless `sender == authorizedSettler`; the router is the sole caller of `take()` | swap the pool from an unauthorized router → revert |
| **I2** | **Fee transparency** — net + fee + merchantId + orderId emitted in one event | `afterSwap` | event missing a component → test fails |
| **I3** | **Slippage floor** — realized output ≥ `order.minOut` | `afterSwap` compares realized delta to stored order | quote, move the pool, expect revert |
| **I4** | **Deadline** — settlement cannot execute past `order.deadline` | `beforeSwap` | warp past deadline → revert |
| **I5** | **Replay protection** — one `orderId` settles at most once | `beforeSwap` marks consumed **before** external effects | replay the same orderId → revert |
| **I6** | **Never strand** — a rejected swap reverts the *swap*; the payment stays settleable by the existing USDC path | revert-only; the hook never moves funds itself | force each revert above; assert payment state untouched |

**I6 is the money-path law and outranks the other five.** If satisfying any
invariant would leave a merchant unpaid with no fallback, the invariant is wrong.

> ⚠️ **`NonzeroDeltaCount == 0` proves the transaction balanced. It proves nothing
> about I2 being correct or the merchant being paid the right amount.** That gap is
> the Bunni v2 shape (~$8.4M — settlement held the whole time while rounding leaked
> value across 44 withdrawals). I2 and I3 need their own invariant tests, not a
> reliance on v4's settlement check.

---

## §4 — Four security corrections folded in

Forced by the vulnerability research; each closes a documented, exploited class.

### C1. `orderId` in `hookData`; everything else in hook storage
`hookData` is **attacker-controlled and authenticates nothing.** A merchant address,
quote, deadline, or fee split read from it is an attacker's assertion.

```solidity
// hookData carries ONLY an index
uint256 orderId = abi.decode(hookData, (uint256));
Order memory o = orders[orderId];   // written by an authenticated registerOrder()
```
This is what makes I3/I4/I5 real rather than decorative, and it makes replay
protection structural instead of bolted on.

### C2. Allowlist POOLS, not just tokens
Anyone can create a pool carrying our hook with attacker-chosen currencies — then
"pay" a merchant in worthless tokens through our event trail. Gate
`beforeInitialize`, or bind an allowlist at deploy:
```solidity
if (!allowedPools[key.toId()]) revert InvalidPool();
```
*(This is the Doppler C-01 / Semantic Layer SVFHook class.)*

### C3. Guard our own `beforeSwap` → `afterSwap` state
**Everything inside v4's unlock window is fully reentrant.** `swap`, `take`,
`settle`, `mint`, `burn`, `donate` are merely `onlyWhenUnlocked` — there is **no
per-pool and no per-hook reentrancy guard**. A reentrant swap between our two
callbacks can overwrite cached state. Key any temporary callback state by
`(PoolId, caller)`, clear it post-use, and add our own guard. Do **not** rely on
v4's lock.

### C4. Allowlist payout assets to non-fee-on-transfer, non-rebasing tokens
v4's `sync`→transfer→`settle` tolerates FoT at the *settlement* layer, but pool math
and our fee arithmetic run on nominal amounts. **I3 would pass on-chain while the
merchant is silently underpaid.** Allowlist is the right call for a payments product;
measuring realized balance delta is the fallback.

---

## §5 — The flag trap (the bug that silently eats hooks)

v4 encodes permissions **in the hook's address bits**. Three failure modes:

| Mismatch | Result |
|---|---|
| Bit set, callback missing | revert |
| Callback implemented, bit missing | **silent no-op** ← most dangerous |
| Returns-delta bit missing while returning a delta | **PoolManager silently ignores the delta** → `CurrencyNotSettled` |

`isValidHookAddress` will **not** catch a missing returns-delta bit. This is a real
shipped bug (Sorella Angstrom: all swaps reverted; and the Crypto-UPI hook has the
same shape live today).

**Our permissions: `beforeSwap | afterSwap` = `0xC0`.** We do **not** set the
returns-delta bits, because we do not return deltas (§2, rejected alternative).

**Mandatory test:** assert the **mined address bits == the declared
`getHookPermissions()`**, read off the deployed contract. Our existing deploy script
already does exactly this — reuse the *pattern*, write it fresh.

---

## §6 — Scope discipline (what we deliberately do NOT build)

- ❌ No custody. The hook never holds tokens.
- ❌ No fee *taking* in the hook — it emits the split; the router settles.
- ❌ No returned deltas, no custom curve, no dynamic fees, no JIT liquidity.
- ❌ No liquidity callbacks — they revert, like the receipt hook's nine do.
- ❌ No oracle inside the hook. The quote arrives as registered order data.

Scope **is** the deliverable. A narrow hook that provably holds six invariants beats
a broad one that holds none.

---

## §7 — Resolved (v1's open questions are closed)

| Question | Decision |
|---|---|
| Recipient enforcement | **Router-gate** (§2). I1 restated. |
| Target chain | ⚠️ **SUPERSEDED by §7d — the entry is MULTI-CHAIN, not one chain** (owner ruling 2026-08-23). |
| Merchant registry | **Self-contained** in the new repo — keeps it standalone and honestly from-scratch. Access0x1 then registers as merchant #1. |
| Demo pool tokens | ✅ **SETTLED 2026-08-23 — native ETH / Circle USDC. No mocks.** See §7c. |
| Repo identity | **NFTeria** (owner ruling 2026-08-21) — see [`IDENTITY-RULING.md`](IDENTITY-RULING.md). |

## §7c — Demo pool: native ETH / Circle USDC (settled 2026-08-23)

**Pair:** `currency0 = address(0)` (native ETH) · `currency1 = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
(Circle USDC on Sepolia — verified on-chain: `symbol() = "USDC"`, `decimals() = 6`).

This replaces the previous "prefer real, mocks if unavoidable" hedge. Nothing is
unavoidable here — we already hold both assets:

| Asset | Held by `0xA121e1eF…8D73` | Source |
| --- | --- | --- |
| native ETH | **1.598846** | already funded, no faucet |
| Circle USDC | **28.0** | already held; Circle faucet tops up |

### Why this pair, beyond "it is real"

1. **No mocks means no caveat.** The Lisbon hook demoed on two self-deployed `MockUSDC`
   contracts (`0x5827a125…`, `0xc54f83c3…` — see `broadcast/LiveFireSwapReceipt…`), which
   forced an on-camera disclaimer. This removes that sentence entirely.
2. **Native ETH is a v4 capability, not a filler choice.** v3 forced WETH; v4 takes
   `address(0)` as a currency directly. Demoing it *is* Uniswap-track content — it shows
   we built for v4 rather than porting a v3 mental model.
3. **It is the real use case.** Access0x1 settles merchant payments in USDC. A buyer
   paying in ETH and a merchant receiving USDC is the actual product flow, so the demo
   pool is not a contrivance staged for the video.
4. **No wrapping step.** Native ETH skips WETH deposit/approve, so there is less to go
   wrong live and one less contract in the trace a judge reads.

### Seeding plan

Ratio sets the pool's initial price, so pick one that reads sanely on camera
(~2,500 USDC/ETH):

- **Preferred:** top USDC up to **≥100**, then seed **0.04 ETH + 100 USDC**. Leaves deep
  enough liquidity that demo swaps do not move the price absurdly.
- **Fallback (works today, no faucet):** seed **0.008 ETH + 20 USDC**, keeping 8 USDC for
  swap tests. Thin but sufficient for the payment-sized swaps this hook is about.

Either way the ETH side is a rounding error against our 1.598 ETH — USDC depth is the
only variable worth managing.

`[OWNER]` **Optional, ~5 minutes:** top up USDC at **faucet.circle.com** (Sepolia, ~10
USDC/hour) any time before Sep 4. Needs a captcha/login, so it is yours, not mine. Skip
it and the fallback still works.

### Payout-asset check against C4

§4's C4 allowlists payout assets to non-fee-on-transfer, non-rebasing tokens. Circle USDC
is both — plain ERC-20, no transfer tax, no rebase — so it is allowlist-legal as the
merchant payout asset, and native ETH on the input side is neither. No conflict.

---

## §7d — MULTI-CHAIN: one hook address on four v4 testnets (owner ruling 2026-08-23)

**"This time around we don't just focus on one chain."** Verified the same day, from
hookmate's `AddressConstants` (default branch) and then `eth_getCode` against each network:

| chain id | network | v4 PoolManager | codesize |
|---|---|---|---|
| 11155111 | Ethereum Sepolia | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | 24009 |
| 84532 | Base Sepolia | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` | 24009 |
| 421614 | Arbitrum Sepolia | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` | 24009 |
| 1301 | Unichain Sepolia | `0x00B036B58a818B1BC34d502D3fE730Db729e62AC` | 24009 |

**All four are live and byte-identical (24009).** That identity is the whole reason one hook
address on four chains is achievable rather than aspirational.

### The constructor decision this reopens — and how it resolves

§0e of `BOOTSTRAP.md` chose `constructor(IPoolManager pm) BaseHook(pm)` because the zero-arg
`AddressConstants.getPoolManagerAddress(block.chainid)` form is **undeployable in a local test**
(chain 31337 has no entry; `deployCodeTo` fails). That was correct for a single-chain entry and
is **wrong for this one**, because a constructor argument enters the CREATE2 init-code hash — a
per-chain `pm` means a per-chain address, and the cross-chain-identity story dies.

**Resolution: zero-arg constructor, and the local test declares its chain.** Foundry's
`vm.chainId(11155111)` in `setUp()` before deploying makes the address table resolve, so the
same creation code deploys locally and on all four networks. One salt, one address, everywhere.
Confirm it in the day-1 drill — a probe-compile will not catch this, and getting it wrong is
discovered only at the second deploy, when the address differs.

### What multi-chain buys, per sponsor

- **Uniswap** — "the same hook, same address, four chains" is a Stack-Contribution story that a
  single-chain hook cannot tell. It also exercises the portability their own template leaves to
  the builder (see `sponsors/uniswap.md` §feedback: `AddressConstants` is used only in scripts).
- **0G** — a live Uniswap governance RFC proposes v4 on 0G among four chains. A hook that is
  already chain-portable is the one that lands there the day it ships; a hard-coded one is not.
- **The Graph** — one subgraph shape over four networks is a materially stronger indexing entry
  than one network, and standard `HookFee` events (§A4) make the handlers identical across them.
- **Chainlink** — feed addresses differ per chain, which is exactly what the router-layer
  `HelperConfig`-style lookup is for; four chains demonstrates the seam rather than asserting it.

### Scope discipline — the cut line does NOT move

Multi-chain is a **deploy-and-prove** activity, not more contract surface. The MVP invariants
are unchanged. Day 4 deploys and live-fires **Ethereum Sepolia first** — the one chain with our
prior live-fire precedent and Circle USDC — and the other three follow only once that is green
and verified. Measured budget: a minimal hook is 1,106,198 gas to deploy plus ~128k per swap, so
four chains of deploy + pool init + liquidity + swap fits well inside 6M gas total. A chain that
is not deployed AND live-fired AND verified by day 7 is **cut from the submission**, not claimed
as partial.

---

## §7b — ⚠️ This document is itself pre-existing work

Classic bans *"prior project-specific code, designs, or assets"* — and this spec is a
project-specific design written before the window. That is **survivable only by
disclosure**: it ships in `specs/`, it is named in the README and the submission, and it
is said on camera — *"the specification was written before the event; every line of code
was written during it."* Hiding it, re-dating it, or quietly rewriting it mid-event is
what converts a disclosed advantage into misrepresentation, which is the disqualifying
offence. Full reasoning and the pre-Sep-4 legality boundary: [`PREBUILD.md`](PREBUILD.md).

---

## §8 — Toolchain (settled, so day 1 is typing)

- Start from **`Uniswap/v4-template`** (canonical — the `uniswapfoundation/` URL
  redirects here).
- Build on **OpenZeppelin `uniswap-hooks` v1.1.1** — the **stable** line. *Not*
  1.2.x: those are flagged prerelease despite third-party sources saying otherwise.
  Using their `BaseHook` is the strongest "we used the secure pattern" signal.
- Install **v4-periphery** (we have never had it — no `BaseHook`, no `HookMiner`).
  It has **zero git tags**, so `forge install …@vX` fails; pin npm `1.0.3` or a SHA.
- v4-core **1.0.2** ships `src/test/` routers (`PoolSwapTest`,
  `PoolModifyLiquidityTest`) — importable, so no hand-rolled interfaces this time.
- Carry `bytecode_hash = "none"` + `cbor_metadata = false` — they are what make
  mined CREATE2 salts reproducible across machines.

---

# v3 ADDENDA (2026-08-23) — from the Uniswap needs sweep, verified

Each item below is a delta to the section it names, with the evidence URL the claim rests on. They are applied as an addendum rather than by rewriting §1–§8 so the pre-event design stays auditable (disclosure law — PREBUILD §1). Where an addendum contradicts an earlier section, **the addendum wins.** Full reasoning: [`UNISWAP-NEEDS.md`](UNISWAP-NEEDS.md).

## A1 — New section 9 — Qualification deliverables (currently absent entirely)

**Change:** Add a numbered deliverables section that the build plan owns: (1) public OSS repo, MIT-licensed, with an explicit note that v4-core arrives as a dependency under its own BUSL-1.1 terms (Change Date 2027-06-15) and is not relicensed; (2) FEEDBACK.md, evidence-per-claim, one verify command per item, seeded from UF-SKILL-REVIEW.md D1-D4 and timestamped as blockers are hit; (3) the Uniswap Developer Feedback Form submission carrying the FEEDBACK.md link; (4) a README 'Verification map' table (invariant -> contract -> function -> permalinked line range -> test -> re-run command) plus a Uniswap-dependency table. Add the OWNER GATE: the form REQUIRES first name, email and Telegram handle, which collides with the pseudonymous-authorship law and must be decided well before Sep 13 — IDENTITY-RULING.md settles the repo name and does not settle this.

**Why:** These are hard qualification requirements for the only prize in the LOCKED slot, and section 6 currently lists only what we will NOT build. Nothing in the spec lists what we must ship to qualify. The README line-level instruction is an explicit, checkable order from the prize text.

**Evidence:** https://ethglobal.com/events/ethonline2026/prizes

## A2 — New section 10 — Security posture, scored against UF's own framework

**Change:** Add: complete the nine-dimension Self-Directed Security Framework score (Complexity, Custom math, External dependencies, External liquidity exposure, TVL potential, Team maturity, Upgradeability, Autonomous parameter updates, Price impacting behavior), record the tier and any of the seven feature triggers that fire, and ship it as SECURITY.md alongside the 14-row Permission | Enabled | Justification | Risk Level table Uniswap's audit-checklist mandates. State the upgrade policy explicitly: immutable, no upgrade path. Fold in the checklist items our threat model lacks — two-step or timelocked admin transfer, cannot-add-zero-address-to-allowlist, events on every critical admin function, token decimals queried not assumed, transient storage used appropriately, minimum 10,000 fuzz runs, a fork test against live Sepolia PoolManager and real Circle USDC. Add the three uncovered vulnerability classes to T1-T13: #10 Hardcoded Addresses, #11 Missing Event Emissions, #12 Unchecked Return Values.

**Why:** UF published the rubric in January 2026, refuses to certify anyone, and names Transparency as non-negotiable — yet neither HOOK-SPEC nor THREAT-MODEL cites it, and no public worked example of a scored hook exists. Our narrow shape scores at the bottom of the Low band, which is the argument section 6 already makes, now with a number in Uniswap's own vocabulary.

**Evidence:** https://developers.uniswap.org/docs/protocols/v4/security

## A3 — Section 7c + section 3 (invariant table) + section 4 — native ETH settlement

**Change:** Add invariant I7 — 'Native settlement integrity': the router is payable; it calls poolManager.sync(CurrencyLibrary.ADDRESS_ZERO) immediately before settle{value: amount}(); it never yields control between sync and settle; it refunds unused msg.value with call{value:}('') and never transfer(); it can never spend its own ETH balance. Negative tests: (a) omit the sync and assert NonzeroNativeValue; (b) assert router ETH balance is zero before and after every settlement; (c) a refund-to-reverting-recipient test proving the refund leg cannot brick settlement. Add a section-7c paragraph quoting PoolManager's own comment and naming the CurrencySettler contradiction. Add T14 to THREAT-MODEL for the refund revert-DoS surface, and budget an extra half-day in section 8: the template's Deployers.deployCurrencyPair() mints two MockERC20s and offers no native-ETH pair helper, so the currency setup and the Sepolia fork test are hand-written.

**Why:** Section 7c chose native ETH on 2026-08-23 with four good arguments and no mention of the settlement landmine. PoolManager's source says sync first; v4-core's own CurrencySettler skips it for native and its comment contradicts PoolManager; two fix PRs are open and unmerged; OZ's LimitOrderHook has an open native-ETH theft issue of exactly this shape. This is the only finding across five readers that breaks the demo rather than the write-up.

**Evidence:** https://github.com/Uniswap/v4-core/pull/1040

## A4 — Section 3, invariant I2

**Change:** Restate I2 as: emit OpenZeppelin IHookEvents' HookFee (and HookSwap where a delta is genuinely involved) IN ADDITION TO the orderId-bearing settlement receipt carrying net + fee + merchantId + orderId. The I2 test asserts BOTH the standard event and the attribution event fire on every settled swap. Mirror the Trading API's IntegratorFee shape ({bips, recipient}, bips bounded above 0 and at most 500) so the on-chain and API layers are directly comparable. Reframe I2 in the README from an internal test assertion into the ecosystem answer to the unanswered 2026-08-14 question in Uniswap's live protocol-fee thread, and cite that thread by URL.

**Why:** UF publishes a hook event standard and says it strongly encourages emission; OZ ships it as IHookEvents in the library we already use; Uniswap Labs' own PermissionedHooks emits standardized events for indexer compatibility. As written the spec ships a hook that ignores the Foundation's own data standard, and it under-sells its best invariant.

**Evidence:** https://www.uniswapfoundation.org/blog/developer-guide-establishing-hook-data-standards-for-uniswap-v4

## A5 — Section 2 — the router-gate design block

**Change:** Add: UnicaSettlementRouter implements IMsgSender.msgSender(); the hook resolves the original payer through it via try/catch in beforeSwap, exactly as Uniswap's accessing-msg.sender guide prescribes and as Uniswap Labs' PermissionedHooks does with allowedWrappers. I2's receipt then carries the authenticated payer, not the router. Keep the honest constraint statement — state the constraint correctly AND use Uniswap's sanctioned escape hatch.

**Why:** Section 2 proves the hook cannot choose the recipient and then treats the payer as unknowable. v4-periphery ships a one-function interface specifically so hooks can recover the original caller, Uniswap documents the pattern by name, and this is the five-line fix for the self-asserted-attribution caveat our own Lisbon hook already documents. Four of five readers found it independently.

**Evidence:** https://developers.uniswap.org/docs/protocols/v4/guides/hooks/accessing-msg.sender

## A6 — Section 2 — the swapAccess citation and prior-art ordering

**Change:** Re-source the swapAccess sentence to its actual primary source: github.com/Uniswap/hooklist/blob/main/schema.json, where swapAccess is a REQUIRED property with enum ['none','temporal','allowlist','governance','other'] alongside dynamicFee, upgradeable, requiresCustomSwapData and vanillaSwap. Do not say 'the hook registry models it' without the schema URL — it appears on no docs page, which is why two readers could not find it. Separately, replace StabL's PaymentSettlementHook as the LEAD prior-art citation with Uniswap's own Permissioned Pools (blog 2026-07-23; v4-periphery src/hooks/permissionedPools/ merged #476, hardened #585/#586/#587, OpenZeppelin + Cantina audits added #590 on 2026-08-20), keeping StabL as secondary, and state the one-sentence difference: they gate WHO may trade a regulated asset, we gate WHERE swap output is allowed to land.

**Why:** READER DISAGREEMENT, resolved: three readers independently fetched the raw schema and quoted the enum verbatim; two readers searched docs.uniswap.org and uniswapfoundation.org and correctly found nothing. Three raw-schema fetches beat two searches of the wrong surface — the claim is TRUE and must simply carry the right URL. On prior art, citing a third-party hook while missing the first-party audited standard shipped five weeks ago is the worst possible ordering.

**Evidence:** https://raw.githubusercontent.com/Uniswap/hooklist/main/schema.json

## A7 — Section 8 — toolchain (rewrite three bullets)

**Change:** Replace 'Install v4-periphery (we have never had it — no BaseHook, no HookMiner)': v4-periphery main has NO BaseHook (removed in #510, 2026-02-06) and no src/utils/; HookMiner survives only at test/shared/. Keep OpenZeppelin BaseHook — the canonical v4-template imports it directly and the 1.1.x line is the audited one — but state the reason in the README and cite BOTH the v4-periphery README line pointing hook authors at v4-hooks-public AND OZ issue #137 (open, unanswered since 2026-07-08), because a UF judge will know about the migration. Install v4-periphery for what it actually still carries: IMsgSender, the permissionedPools reference, V4Quoter, DeltaResolver, ReentrancyLock, SlippageCheck and the exact-output router tests. Upgrade the 1.2.x rejection argument from the prerelease flag to the stronger fact: audits/ holds PDFs for the 1.0.0 and 1.1.0 lines only — there is NO audit artifact for 1.2.x. Note the template's uniswap-hooks submodule (e59fe72) is identical to the v1.1.0 tag, five commits behind stable v1.1.1 — resolve that deliberately, not on day 1. Pin every Uniswap dependency by SHA (v4-core has exactly one tag, v4-periphery has zero, so forge install @vX fails org-wide) and record the SHAs in the README. Drop the unverified cbor_metadata = false assertion — neither v4-template nor v4-hooks-public sets it; Uniswap's CONTRIBUTING mandates only bytecode_hash = none. Add: v4-template was last pushed 2025-10-28 and ships with CI DISABLED (push and pull_request commented out in test.yml) — enabling it is a three-line day-1 diff; open issue #77 documents stack-too-deep once optimizer=true. Add a repo-craft subsection adopting Uniswap's foundry-template CONTRIBUTING doctrine by reference: an interface per contract carrying all NatSpec with @inheritdoc on implementations, 100% coverage, dedicated invariant tests, gas snapshots via vm.snapshotGasLastCall annotated /// forge-config: default.isolate = true and never fuzzed, underscore-prefixed internals, explicit pragma on deployed contracts. Consider hookmate's AddressConstants (a third-party repo, but a v4-template submodule) instead of hardcoding PoolManager, which is Uniswap's own vulnerability class #10.

**Why:** The toolchain section is the one part of the spec that is factually stale, and every hour it costs lands on day 1. READER DISAGREEMENT on BaseHook, resolved: the codebases reader says switch to v4-hooks-public because periphery's README says so; the ecosystem reader says the canonical template imports OZ. Keeping OZ wins on three counts — the template imports it, the 1.1.x line has published audits, and the override shape is identical anyway — but the contradiction must be named in the README and filed as feedback, because silence on it reads as not having noticed.

**Evidence:** https://github.com/Uniswap/v4-periphery/blob/main/README.md

## A8 — Section 4, C1 — hookData decoding

**Change:** Specify the error names: revert URC-4's `MissingHookData()` when hookData is empty and `MalformedHookData()` when it cannot be decoded; keep bespoke named errors only for semantic failures (unknown order, consumed order, wrong pool). Add specs/URC-CONFORMANCE.md stating per URC whether it binds us: URC-2 does not (we return no delta, and URC-2 says a hook contributing no delta MUST NOT emit HookSwap); URC-3 does not (no custody, no reserves); URC-4 partially does (we take a hookData payload).

**Why:** Uniswap Labs opened the URC standards track on 2026-06-29, eight weeks before the window, and URC-4 already fixes exactly these two error names for any payload-taking hook. Free standards conformance, two negative tests that assert against a public spec instead of an invented one, and almost no other entry will have read the track.

**Evidence:** https://gov.uniswap.org/t/urc-4-active-liquidity-framework-hook-interface/26156

## A9 — Section 5 — permissions and flags

**Change:** Add two subsections beyond the 0xC0 mask. (a) FEE FAMILY: as of the 2026-07-07 V4FeePolicy temp check, a hook contract also carries a protocol-fee family flag; the hook exposes its classification and the README states which family a settlement hook belongs to — the honest answer being none of the three activated families (static-fee, CCA, aggregator), which goes into FEEDBACK.md as a finding rather than a hole. (b) ADDRESS PREFIX: Uniswap mines the most-significant address byte as a routing signal on top of the low-14-bit flags and RESERVES 0x91 as the allowlist-declination byte; our mining must not emit 0x91 by accident, and deliberately mining a chosen prefix with PrefacedHookMiner (MAX_LOOP 160_444, matching V4-API-FACTS) is Uniswap fluency visible in the address itself.

**Why:** Section 5 declares 0xC0 and stops. Two things a hook address/contract now carries were added after HOOK-SPEC v2 was stamped, both from first-party sources, both cheap, and one of them (the fee family) is a live obligation created five weeks ago that a UF reviewer is currently living inside.

**Evidence:** https://gov.uniswap.org/t/temp-check-activate-v4-protocol-fees/26162

## A10 — Section 6 — scope discipline (add positive deliverables) and a new routing-posture subsection

**Change:** Section 6 defines scope only negatively. Add the positive deliverables the research says are the highest signal per hour: SECURITY.md (the UF self-score), TESTING.md (the liftable invariant/negative-test harness), TRUST-ASSUMPTIONS.md, specs/URC-CONFORMANCE.md, a known-good toolchain pin table, and a hooklist-shaped metadata block. Add a ROUTING POSTURE paragraph: this pool is a settlement venue with a single authorised router, not a public liquidity venue; the I1 recipient guarantee is only enforceable because the router set is closed; general routers should skip it cleanly; we self-declare swapAccess=allowlist, requiresCustomSwapData=true, vanillaSwap=false; hooklist's chain enum is mainnet-only so registry listing is a post-mainnet roadmap item, not a claim; QuoteRequest.hooksOptions defaults to V4_HOOKS_INCLUSIVE so a Trading API quote against our pool can succeed and the swap then revert at beforeSwap for a stranger; and add `rebateClaimer()` to the router for UF/Brevis router-rebate eligibility.

**Why:** UF's own framing is that hooked pools get ignored because routers cannot interpret them, and they are funding up to $9M to fix it. Our design is the extreme case of that problem, section 2 justifies the gate on correctness grounds only, and a UF judge will notice. The answer is strong when we raise it. The positive deliverables are all byproducts of work sections 3 and 5 already require.

**Evidence:** https://www.uniswapfoundation.org/blog/hooks-routing-rebate-program-with-brevis

## A11 — Section 1 — the problem statement

**Change:** Narrow the claim before a judge narrows it. Add: the Trading API already ships QuoteRequest.recipient ('The wallet address which will receive the output of the swap'), so pay-in-X / receive-in-Y to a third party is a solved, documented, off-chain feature today; and Uniswap ships a first-party pay-with-any-token skill fulfilling x402/MPP payment challenges by swapping any token — the PAYER half of this problem. What does not exist is an on-chain, atomic, verifiable, replay-protected, deadline-bounded, fee-transparent settlement policy: a guaranteed recipient inside the settlement boundary rather than an off-chain orchestration promise. Add one sentence to the README and the video positioning the hook as the on-chain half of a rail Uniswap has already started.

**Why:** Section 1 opens as though the space is unclaimed. Two readers independently flagged that omitting first-party prior art reads as not having done the reading — the exact impression a Foundation reviewer punishes — while citing it and complementing it reads as ecosystem fluency and costs one paragraph.

**Evidence:** https://raw.githubusercontent.com/Uniswap/uniswap-ai/main/packages/plugins/uniswap-trading/skills/pay-with-any-token/SKILL.md

## A12 — Section 7 — target chain

**Change:** Keep Ethereum Sepolia as the DEMO chain (real Circle USDC at 0x1c7D4B19…C7238, our live-fire precedent, hookmate coverage for 11155111, and the only testnet where the Trading API returned a priced route), and promote Unichain Sepolia (PoolManager 0x00b036b58a818b1bc34d502d3fe730db729e62ac) from 'fallback' to a SECOND first-class deploy target for the same mined bytecode. One extra script run; two chains; one proof table. Record in section 7 the additional Sepolia addresses the spec does not list: PoolSwapTest 0x9b6b46e2c869aa39918db7f52f5557fe577b6eee, StateView 0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c, Quoter 0x61b3f2011a92d183c7dbadbda940a7555ccf9227, Universal Router 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b, PositionManager 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4.

**Why:** READER DISAGREEMENT, resolved: the governance reader calls Ethereum-Sepolia-primary 'backwards' because UF's roadmap phase 3 makes Unichain the hook-native environment and the rebate program starts there; the demo-pool reasoning in section 7c is nonetheless sound and depends on real Circle USDC. Both, not either — portability across v4 deployments is UF's stated phase 4 goal, and it is the cheapest cross-sponsor bridge available given the live RFC putting v4 on 0G.

**Evidence:** https://www.uniswapfoundation.org/blog/a-roadmap-for-programmable-liquidity

## A13 — Section 3, invariant I3 — an unmade decision

**Change:** State the partial-fill decision explicitly: on an exact-output swap that cannot be fully filled, the settlement REVERTS — it never settles short above minOut. Cite v4-periphery #564 'revert on exact-output partial fills in V4Router' (2026-08-03) and #584 'tolerate hook-funded input on exact-output swaps' (2026-08-09) with their test files, both as support for section 2's rejected-alternative argument and as the current-code basis for the decision. Separately, specify the cross-decimal rounding direction for the fee split: our pair is ETH (18) against Circle USDC (6), and nothing currently states which side absorbs the dust.

**Why:** Exact-output partial-fill semantics are being tightened in periphery right now, and citing August-2026 commits proves we read current code rather than 2024 tutorials. For a payments product reverting is the only correct answer and it should be written down. Leaving cross-decimal rounding unspecified directly contradicts the Bunni lesson section 3 already invokes — settlement balanced while rounding leaked value.

**Evidence:** https://github.com/Uniswap/v4-periphery/commits/main

## A14 — Section 4, C3 — callback state

**Change:** Specify transient storage: key the temporary beforeSwap -> afterSwap state in TSTORE/TLOAD (Solidity >=0.8.24, EVM cancun) keyed by (PoolId, caller), rather than ordinary SSTORE plus a clear-it-afterwards discipline. TSTORE auto-clears at transaction end, which makes C3 structural instead of procedural, and it is far cheaper against the <50,000 gas beforeSwap budget T12 adopted from Uniswap's own skill.

**Why:** Uniswap's v4-security-foundations skill says to prefer transient storage for data that does not persist beyond the transaction, and their audit checklist lists 'Transient storage used appropriately' as an item. C3 as written depends on remembering to clear state; the language feature removes the failure mode entirely.

**Evidence:** https://raw.githubusercontent.com/Uniswap/uniswap-ai/main/packages/plugins/uniswap-hooks/skills/v4-security-foundations/SKILL.md

## A15 — New section 11 — Ecosystem contributions (separable, never on the critical path)

**Change:** Add three owner-gated, separable items with explicit cut-without-regret status: (a) file UF-SKILL-REVIEW.md's D1-D4 against Uniswap/uniswap-ai as issues or a PR, each with its verify command; (b) a Uniswap/docs PR adding the three-row flag-mismatch failure table to the hook-deployment guide, which answers open issue #1130 by name; (c) run the hknio/uni-v4-hooks-checker that UF's own security page recommends by name against the deployed address and publish the pass. Record explicitly that CCA is a named prize-eligible surface we are CONSCIOUSLY DECLINING, and that Uniswap/v4-hooks-public has no external submission path so no contribution is planned there.

**Why:** 'Extensions or improvements to official Uniswap repositories' is literally in the prize criteria; uniswap-ai has three open PRs and no open issues so a contribution lands visibly; and issue #1130 has sat unanswered since May asking for what we will have built. Recording the declined lane keeps the war room honest about what was seen and passed over versus never noticed.

**Evidence:** https://developers.uniswap.org/docs/uniswap-ai/contributions

## The non-negotiable three (do these before any other addendum)

- **#1 (1d)** A submission a reviewer can verify in one pass: public OSS repo + FEEDBACK.md + the Developer Feedback Form carrying the FEEDBACK.md link + a README that points at specific contracts AND specific lines.
  - *serve it:* Make it a build deliverable with an owner, not Sep-12 polish. Ship a README 'Verification map' table: each invariant I1-I6 -> contract -> function -> permalinked line range -> the test that proves it -> the one-line command that re-runs that test. A second table maps every Uniswap dependency (PoolManager address, v4-core SHA, BaseHook source, OZ uniswap-hooks pin) to where it is used. FEEDBACK.md written evidence-per-claim with a verify command per item, timestamped as blockers are hit inside the window, answering the form's exact questions with real numbers. UF-SKILL-REVIEW.md D1-D4 are the seed.
- **#2 (0.5d)** A hook that publishes its own security posture scored against UF's nine-dimension Self-Directed Security Framework — because UF explicitly refuses to certify anyone and there is not one public worked example of a hook scored against the rubric.
  - *serve it:* Ship SECURITY.md carrying: the completed nine-dimension score with a one-line justification and evidence link each, the resulting tier, which of the seven feature triggers fire, the tier requirements we do and do not meet (stated honestly — no audit), the 14-row Permission | Enabled | Justification | Risk Level table Uniswap's own audit-checklist mandates, and the upgrade policy (none — immutable). Our shape (0xC0, no deltas, no custody, no oracle, no upgradeability, low TVL) lands at the bottom of the Low band, which is exactly the argument HOOK-SPEC section 6 already makes — now in Uniswap's vocabulary with a number attached.
- **#3 (0.5d)** Native-ETH settlement done correctly — sync() before the native settle, which the canonical helper omits and which two open v4-core PRs are still trying to fix.
  - *serve it:* This is the only finding across five readers that can break the demo rather than merely weaken the write-up, and section 7c chose native ETH two days ago without it. Promote it to invariant I7: the router is payable, calls poolManager.sync(CurrencyLibrary.ADDRESS_ZERO) immediately before settle{value:}(), never yields control between sync and settle, refunds unused msg.value with call{value:}('') and never transfer(), and can never spend its own balance. Negative test that fails without the sync, plus a balance test. Quote the PoolManager comment in-code.

## New feedback asks for FEEDBACK.md (not repeats of the Lisbon file)

- FLAG-MISMATCH SILENT NO-OP IS DOCUMENTED NOWHERE. A permission bit set with the callback missing reverts; a callback implemented with the bit missing is a SILENT no-op; a returns-delta bit missing while returning a delta makes PoolManager ignore the delta and revert CurrencyNotSettled. None of hook-deployment, async-swap, concepts/hooks or troubleshooting says any of this, and isValidHookAddress cannot catch the reverse case. Ask: a three-row failure table on the hook-deployment guide — the page a builder reads at the exact moment they can still get it wrong. (Evidence: developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment; async-swap states the required flag and stops.)
- THE v4 TROUBLESHOOTING PAGE IS A BARE SELECTOR TABLE. Ten IPoolManager errors, four Hooks.sol errors, eleven Pool.sol errors — zero causes, zero reproductions, zero fixes, including for the two a hook author actually hits (HookAddressNotValid 0xe65af6a0, CurrencyNotSettled 0x5212cba1). Ask: one cause + one reproduction line per selector. We will ship tests that deliberately reproduce both and can contribute the text.
- NO OFFICIAL GUIDE TEACHES HOW TO TEST A v4 HOOK. The hooks guide set is exactly seven pages (accessing-msg.sender, async-swap, getting-started, hook-deployment, liquidity-hooks, swap-hooks, your-first-hook) — no testing page, no invariant or fuzzing guide, no security-testing guide anywhere under /docs/protocols/v4/guides/. The flagship tutorial ships two happy-path assertions and no negative test, computes flags manually, and never uses HookMiner. Uniswap's own swap-hooks guide disclaims production readiness. v4-core issue #1019 asks for exactly this and is unanswered since 2026-03-14.
- NO WORKED EXAMPLE OF A HOOK SCORED AGAINST THE UF SECURITY FRAMEWORK. Nine dimensions, three tiers, seven feature triggers and a public worksheet exist, with the explicit statement that UF does not review or certify — so the only way the rubric becomes usable is a public example. Ask: publish one scored reference hook, or link community ones. We will supply ours as the first.
- GATED HOOKS HAVE NO WAY TO SIGNAL 'DO NOT ROUTE ME'. QuoteRequest.hooksOptions defaults to V4_HOOKS_INCLUSIVE, so the official router will quote a permissioned v4 pool and the swap then reverts in beforeSwap for any unauthorised sender. Nothing tells a gated-hook author how to opt out, and hook-routing's only answers are 'run a UniswapX filler' or the allowlisting form. Ask: either a hooksOptions exclusion signal or a documented convention — this touches both the protocol and the Trading API, and it is the strongest feedback shape because it came from building the thing.
- WHERE BaseHook CANONICALLY LIVES IS CONTRADICTORY ACROSS THREE OFFICIAL SURFACES. v4-periphery's README points hook authors at v4-hooks-public; v4-periphery main no longer contains BaseHook at all (removed #510, 2026-02-06) though npm 1.0.3 still ships the old paths; the canonical v4-template imports OpenZeppelin's BaseHook instead; and OZ issue #137 raising the contradiction has been open and unanswered since 2026-07-08. Ask: one sentence of canonical guidance, and reconcile the template with it.
- NO USABLE GIT TAGS ON THE CORE REPOS. v4-periphery has ZERO tags; v4-core has exactly one (v4.0.0, 2025-01-23) which does not match the npm version everyone cites. `forge install …@vX` therefore fails org-wide, npm is the only versioned surface (v4-core 1.0.2 from 2025-05-13, v4-periphery 1.0.3 from 2025-07-29), and v4-periphery is being pushed to daily — an unpinnable moving target during a nine-day window. Ask: tag releases, or state SHA-pinning as the official guidance.
- THE OFFICIAL TEMPLATE SHIPS WITH CI DISABLED AND IS TEN MONTHS STALE. v4-template's .github/workflows/test.yml has `push:` and `pull_request:` commented out, leaving only workflow_dispatch — every repo generated from it silently never runs its tests. Last push 2025-10-28; open issue #76 asks for the dependency refresh (since 2025-07-05), #77 reports stack-too-deep once optimizer=true, #62 asks to replace PoolSwapTest with v4-router. Ask: a three-line CI re-enable and a dependency bump. We will offer the diff.
- v4-CORE'S OWN NATIVE-SETTLE HELPER CONTRADICTS PoolManager'S OWN COMMENT. PoolManager says integrators should call sync first when settling native to avoid DoS vectors; test/utils/CurrencySettler.sol short-circuits native to settle{value:}() without sync and its comment claims sync is not required. PRs #1040 and #1044 fixing it are open and unmerged since May 2026, and origin issue #958 was CLOSED on 2026-07-29 with both PRs still open — upstream state re-verified against the live GitHub API on 2026-08-23; the feedback item and its full paper trail live in [`UNISWAP-NEEDS.md`](UNISWAP-NEEDS.md) §9, which owns this fact. Ask: merge the fix or correct the helper's comment — any hook repo using the canonical helper on a native pair inherits the bug.
- THE CANONICAL TEMPLATE VENDORS A THIRD-PARTY PERSONAL REPO AS A SUBMODULE. Uniswap/v4-template's .gitmodules pulls github.com/akshatmittal/hookmate alongside forge-std and openzeppelin/uniswap-hooks. hookmate is genuinely useful (AddressConstants removes the hardcoded-address pattern Uniswap's own catalog lists as vulnerability #10), which is exactly why the supply-chain position deserves a stated policy. Ask: adopt it into the org, or say why an individual's repo is a load-bearing dependency of the official template.
- NO PROTOCOL-FEE FAMILY DESCRIBES A SETTLEMENT HOOK. The V4FeePolicy temp check makes the fee family a flag stored on the hook contract, with three families activated — static-fee, CCA, aggregator — and everything unclassified falling to a global default. A router-gated settlement hook that takes no LP fee and returns no delta fits none of them. Ask: a documented family (or an explicit 'none' classification) plus guidance on what the global default means for a hook that charges nothing.
- NO CANONICAL MACHINE-READABLE PRE-EXECUTION FEE BREAKDOWN. Asked in Uniswap's own live protocol-fee thread on 2026-08-14 and still unanswered: 'is there a canonical machine-readable way for an interface to determine the effective protocol fee for a specific route before execution?' with a clear split between LP fee, protocol fee, hook fee and routing cost. Ask: pin the shape. Our I2 emits it on-chain post-execution and we can contribute the event schema.
- THE HOOK REGISTRY EXCLUDES EVERY PRE-MAINNET HOOK. hooklist's schema requires {dynamicFee, upgradeable, requiresCustomSwapData, vanillaSwap, swapAccess} and models gated access as a first-class field — genuinely good vocabulary — but the chain enum lists only mainnet names, so a verified testnet deployment cannot be declared at all. Ask: a testnet chain path, or a documented statement that the registry is mainnet-only so builders stop planning around it.
- UNISWAP'S OWN SECURITY SKILL RECOMMENDS BUNNI AS A PRODUCTION EXEMPLAR. The v4-security-foundations skill lists Bunni under 'Production Hook References … Learn from audited, production hooks' with 'Concentrated liquidity guards', and never mentions the ~$8.4M Bunni v2 exploit. In a security skill this is the highest-cost possible omission. Ask: add the exploit and its lesson, or drop the reference.
- FOUR COMPILE-BREAKING OR MISLEADING DEFECTS IN THE OFFICIAL uniswap-hooks SKILL, each with a verify command. D1: every swap-callback example writes `IPoolManager.SwapParams` but in v4-core 1.0.2 SwapParams is a top-level struct in src/types/PoolOperation.sol (~8 code blocks affected). D2: the BaseHook import path in the skill does not exist. D3: the ReentrancyGuard import is an OpenZeppelin v4 path. D4: the Bunni recommendation above. Filed as issues or a PR against Uniswap/uniswap-ai, which has documented external contribution and currently zero open issues.
