# UNICA contract compatibility with Arc

Read-only research, simulation and planning only. Nothing in this document was broadcast, signed,
deployed, or published. No wallet balance of the owner was read. All facts below are dated
**2026-09-11** unless the fact itself carries an on-chain read timestamp.

## 0. Scope and method

**Question.** Can UNICA's existing v4 settlement contracts (`src/V4SettlementHook.sol`,
`src/SettlementExecutor.sol`, `src/libraries/UniswapDeployments.sol`) and the experimental
ERC-20-input generation (`src/experimental/robinhood-testnet/*.sol`) run on Arc, and what would
have to change.

**Sources used, and how each is graded:**

- **Official docs / explorer** — `docs.arc.io`, `developers.uniswap.org`, `thegraph.com/docs`,
  the `safe-global/safe-deployments` and `Uniswap/UniswapX` GitHub repositories (Uniswap- and
  Safe-owned repos count as primary per the brief).
- **On-chain reads** — direct `eth_call` / `eth_getCode` / `eth_chainId` against
  `https://rpc.testnet.arc.io`, the keyless public RPC named in `docs.arc.io`'s own
  "Connect to Arc" page. Every such read is reported with chain id, address, method and raw
  result below, so any of them can be re-run.
- **Repository notes** (`docs/ARC-FACTS.md`, `integrations/arc-treasury/`,
  `docs/unica-v4/evidence/`, `docs/unica-v4/DECISIONS.md`) — treated as **leads only**, per the
  brief. Every claim taken from one was independently re-verified against an official source or a
  fresh on-chain read before being repeated here; three were corrected in the process (§3, §5).
- Anything not clearable this way is marked **UNKNOWN**.

**Two chain ids exist and are never interchanged in this document:**

| Name | Chain id (decimal) | Chain id (hex) | Status at retrieval |
|---|---|---|---|
| Arc Testnet | `5042002` | `0x4cef52` | Live, public, keyless RPC documented |
| Arc Mainnet | `5042` | `0x13b2` | **Not publicly launched.** See §5.1. |

On-chain read, done for this report: `eth_chainId` against `https://rpc.testnet.arc.io` →
`"0x4cef52"` = `5042002` decimal, confirming `docs.arc.io/arc/references/connect-to-arc`
(retrieved 2026-09-11) and the value already recorded in `docs/ARC-FACTS.md`. `eth_blockNumber`
at the same endpoint returned block `61616798` at retrieval, well above the `61006753` the lead
document recorded on 2026-09-08 — the chain is live and producing blocks, not a stale fixture.

**UNICA context, unchanged by this report.** Uniswap v4 is UNICA's sole DEX. Arc has no live USDC
balance of the owner's read here, no key was requested or printed, and nothing in this document
authorizes a deployment, a transaction, or a publish.

## 1. EVM / Solidity / Foundry compatibility

`foundry.toml` (this repo) pins `solc_version = "0.8.30"`, `evm_version = "cancun"`. Arc's own
docs state its "EVM baseline" as **Osaka** — official, `docs.arc.io/llms.txt` (retrieved
2026-09-11): *"Most contracts deploy unchanged."* Osaka is a later Ethereum hard fork than
Cancun in every published fork sequence (Cancun → Prague/Electra → Fusaka/Osaka); hard forks are
cumulative, so every Cancun-era opcode this codebase depends on — `TLOAD`/`TSTORE` (EIP-1153,
used by both hooks' transient re-entry guards) and `MCOPY` (EIP-5656) — is present on Osaka. No
solc release yet ships an `--evm-version osaka` label; targeting `cancun` against a later-fork
chain is the standard, supported way to compile for it, and is what this repo already does for
its live Sepolia deployment. **Verdict: compatible, no version bump required.**

`bytecode_hash = "none"` and `cbor_metadata = false` (`foundry.toml`, this repo) are chain-agnostic
build flags that make a CREATE2 salt reproducible on any chain, Arc included — nothing here is
Arc-specific.

**Contract size.** Osaka's EIP-7907 (raising the 24 KB contract-code ceiling) is a mainnet-Ethereum
proposal; whether Arc's Osaka baseline includes it is **UNKNOWN** — not stated in the fetched
`docs.arc.io/llms.txt` excerpt. `V4SettlementHook` and `SettlementExecutor` are both well under the
legacy 24576-byte EIP-170 limit today (`script/size-budget.sh` gates this in CI already), so the
question is moot unless a future Arc-specific contract grows past that ceiling.

**Gas metering.** `eth_gasPrice` read directly against `https://rpc.testnet.arc.io`
(2026-09-11) → `0x51f4d5c00` = `20000000000` wei = exactly 20 Gwei, matching the mempool floor
`docs.arc.io` documents and the value `docs/ARC-FACTS.md` recorded on 2026-09-08. Because Arc's
native gas asset is USDC rather than ETH (official, `docs.arc.io`: *"Arc uses USDC for gas
fees, not ETH"*), this 20 Gwei figure is denominated in 18-decimal native-USDC wei, not ETH wei —
see §6 for why that distinction is load-bearing and not cosmetic.

## 2. CREATE2 factory and hook-address mining

`V4SettlementHook.CREATE2_FACTORY` is hard-coded to `0x4e59b44847b379578588920cA78FbF26c0B4956C`
(the deterministic-deployment-proxy every `forge create2` / hook-mining script in this repo
targets). **On-chain read, this report, 2026-09-11:** `eth_getCode` against
`0x4e59b44847b379578588920cA78FbF26c0B4956C` on chain `5042002` (`https://rpc.testnet.arc.io`)
returned non-empty runtime code. Its keccak256 —
codehash `0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989` — was computed from the
raw bytes returned and matches, byte for byte, the `DEPLOYER_CODEHASH` constant this repository
already asserts for the *same* factory on Sepolia in `test/fork/ForkPin.sol`. The factory on Arc
testnet is not merely present; it is the identical runtime bytecode this repo's own Sepolia fork
tests already pin.

**Consequence for hook mining.** A CREATE2 address is `keccak256(0xff, factory, salt,
initCodeHash)`. Because the factory address and its behaviour are identical on Arc testnet and on
Sepolia, mining a salt for `V4SettlementHook`'s permission bits (`script/HookAddressForChain.s.sol`,
`script/v3/MineHookV3.s.sol`) needs no chain-specific change to the mining algorithm — only a new
run, because `initCodeHash` already depends on the chain id through the constructor's calls to
`UniswapDeployments` and `AddressConstants` (§3), so a salt mined for Sepolia will not reproduce
the required leading-byte pattern on Arc. **Verdict: mining mechanism compatible; a fresh mining
run against chain `5042002` is required before any deploy.**

Also confirmed present on Arc testnet at their canonical, chain-independent addresses (all
`eth_getCode` reads, this report, 2026-09-11, against `https://rpc.testnet.arc.io`):
Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` (non-empty code) and Permit2 at
`0x000000000022D473030F116dDEE9F6B43aC78BA3` (non-empty code) — the latter also independently
confirmed live and functional by `Uniswap/UniswapX`'s own Arc playbook (§3).

## 3. Uniswap v4 PoolManager on Arc — provenance, stated exactly

This is the load-bearing question and the one with the least clean an answer, so every source is
kept separate rather than blended into one verdict.

**3.1 Arc mainnet does not yet publicly exist.** Circle's own pressroom page (official,
`circle.com/pressroom`, retrieved 2026-09-11): *"on track for a public mainnet launch on
September 16, 2026"* and, in the same release, *"Arc is currently in private mainnet with more
than 100 ecosystem and institutional builders."* `docs.arc.io/arc/references/contract-addresses`
(official, retrieved 2026-09-11) states outright: *"Mainnet addresses are not yet available."*
September 16, 2026 is five days after this report's retrieval date. **UNICA's own gate for a
capped-mainnet plan — "only if Arc mainnet exists" — is therefore not met today.** See §5.1 and
§13.

**3.2 Uniswap's canonical v4 deployments page does not list Arc, on either chain id.** Fetched
directly: `developers.uniswap.org/docs/protocols/v4/deployments` (redirects to
`developers.uniswap.org/llms.mdx/docs/protocols/v4/deployments`; retrieved 2026-09-11) lists 18
mainnet chains (Ethereum, Unichain, Optimism, Base, Arbitrum One, Polygon, Zora, Worldchain,
X Layer, Ink, Soneium, Avalanche, BNB Smart Chain, Celo, Monad, MegaETH, Tempo, **Robinhood
Chain**) plus five testnets. Arc is absent from both lists. This is Uniswap's own canonical,
user-facing source of truth for "where is v4 deployed," and by that source: **none.**

**3.3 A Uniswap-owned engineering repository claims otherwise, for Arc mainnet only, and the
claim could not be reproduced from Uniswap's own SDK source.** `Uniswap/UniswapX`'s repository
carries `playbook/chains/arc.md` (fetched from
`raw.githubusercontent.com/Uniswap/UniswapX/main/playbook/chains/arc.md`, retrieved 2026-09-11).
It states a v4 `PoolManager` at `0x8366a39cc670b4001a1121b8f6a443a643e40951` on chain **5042**
(mainnet, not testnet), "24KB code verified live," sourced to `@uniswap/sdk-core`'s
`ARC_ADDRESSES`, with `PoolManager.owner()` reported as `0x33f26c5d69e2c40956f22c6195b6a499cf4151e8`
(a 171-byte proxy, "likely a Safe") and dated 2026-06-12. **This report attempted to confirm that
address independently and could not:**
  - `raw.githubusercontent.com/Uniswap/sdk-core/main/src/chains.ts` and `.../src/addresses.ts`
    (fetched 2026-09-11) contain **zero** occurrences of the string "arc" — no `ChainId.ARC`, no
    `ARC_ADDRESSES`. The enum in that file tops out at `BLAST = 81457` and is missing chains that
    are unquestionably live elsewhere (Unichain, Monad, World Chain), which suggests the package's
    published build and its `main` branch source have diverged — a real discrepancy, not
    evidence either way about Arc.
  - No official Arc mainnet RPC is documented anywhere this report could find (`docs.arc.io`'s
    contract-addresses page says mainnet addresses "are not yet available," and no keyless
    mainnet endpoint is named in official docs), so this report could not `eth_getCode` the
    claimed address itself. The playbook's own probe used a keyed QuikNode URL, which is
    consistent with there being no public mainnet RPC yet.
  - **Verdict on this address: UNCONFIRMED.** Neither proven nor disproven by this report. It is
    real enough to plan around (a Uniswap-owned repo, dated, with a specific owner address and a
    specific code-size claim) but not real enough to hard-code into a contract or a config file
    before an independent read against an officially-documented endpoint is possible.

**3.4 Arc testnet (5042002) has no Uniswap v4 evidence at all, from any source consulted.**
Nothing in `docs.arc.io`, the Uniswap deployments page, the UniswapX playbook (which is
mainnet-only), or this report's own testnet RPC reads names a `PoolManager` on chain `5042002`.
`docs/ARC-FACTS.md`'s own conclusion — *"no official source ... says [Uniswap is deployed on
Arc]"* — was written before the UniswapX playbook and Circle's Uniswap-liquidity announcement
existed publicly; both are now real, but both describe **mainnet**, and mainnet is not public.
**For the testnet UNICA can actually reach today, the standing rule in `docs/ARC-FACTS.md` still
holds: there is no swap path to build, and none should be invented.**

## 4. Hook permissions

`V4SettlementHook.getHookPermissions()` returns a fixed `Hooks.Permissions` struct
(`beforeInitialize`, `beforeSwap`, `afterSwap` set; everything else false), encoded into the
low-order permission bits of the mined hook address by `Hooks.validateHookPermissions` inside
`PoolManager.initialize`. This validation is address-arithmetic performed by the PoolManager
contract itself — it has no chain-specific behaviour, and Arc's PoolManager (§3, provenance
unconfirmed) would run the same v4-core source as any other chain unless Uniswap forked it for
Arc, which nothing consulted here suggests. **Verdict: no permission-bit compatibility issue
independent of §3** — the open question is not whether Arc's PoolManager would validate this
hook's permission bits correctly, but whether a PoolManager to validate against exists yet at an
address UNICA can target with confidence.

## 5. USDC / EURC decimals and ordering

**5.1 The decimal trap, verified directly rather than repeated from the lead document.**
`docs/ARC-FACTS.md` and `integrations/arc-treasury/README.md` both describe a chain where the
native gas asset (USDC) reads at 18 decimals through `eth_getBalance`/`msg.value`, while an
ERC-20 USDC interface at the same chain reads 6. This report re-derived the ERC-20 half directly:

| Call | Target (chain `5042002`) | Result | Decoded |
|---|---|---|---|
| `eth_getCode` | `0x3600000000000000000000000000000000000000` | non-empty (proxy bytecode) | contract exists |
| `decimals()` | same address | `0x...06` | **6** |
| `symbol()` | same address | ABI-encoded string | **"USDC"** |
| `name()` | same address | ABI-encoded string | **"USDC"** |

All four reads: `https://rpc.testnet.arc.io`, 2026-09-11, this report. This matches
`docs/ARC-FACTS.md`'s figure exactly, now independently confirmed rather than merely repeated. A
second official-docs fetch (`docs.arc.io/arc/references/contract-addresses`, retrieved
2026-09-11) lists the same address for "USDC" under its Testnet section, closing the last gap
the lead document itself flagged ("has not been confirmed against an official Circle
documentation page").

**5.2 The USDC token is an upgradeable proxy, and its slots identify the pattern exactly.** The
bytecode returned by `eth_getCode` for `0x3600...0000` decodes (by its function selectors:
`upgradeToAndCall`, `changeAdmin`, `implementation`, `admin`) as a **zOS/OpenZeppelin-SDK legacy
`AdminUpgradeabilityProxy`**, not an EIP-1967 proxy — confirmed by reading both candidate storage
slots directly: `eth_getStorageAt` at the EIP-1967 implementation slot (topic
`0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bb`) returned all zero, while
the bytecode's own embedded slot constant, keccak256("org.zeppelinos.proxy.implementation") =
slot `0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c`, is what the contract
actually reads and emits against (`UpgradeCall(0x77...)`-style event topic embedded in the same
bytecode). **Consequence:** a reader who checks only the EIP-1967 slot — the modern convention —
would wrongly conclude Arc's USDC is not upgradeable. It is, and by a legacy admin, whose
identity this report did not resolve (out of scope: no owner-address enumeration was requested).
This exact trap — zOS slot, not EIP-1967 — is also what this repo's *own* Sepolia
`ForkPin.sol` already records for Sepolia USDC (`USDC_IMPL_SLOT` there is the same zOS constant),
so the pattern is not new to this codebase, only new to Arc.

**5.3 EURC exists on Arc testnet and is decimal-compatible.** `docs.arc.io`'s contract-addresses
page (official, retrieved 2026-09-11) lists EURC at `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`
on testnet. On-chain read, this report, 2026-09-11: `decimals()` → **6**, `symbol()` →
**"EURC"**. Both USDC and EURC on Arc testnet share the 6-decimal convention UNICA already
assumes for its payout currency (`PAYOUT_CURRENCY` in `V4SettlementHook`; `uTUSD` in the
experimental generation is also 6, `TestPayoutToken.sol` line 32).

**5.4 Currency ordering.** Uniswap v4 orders `currency0`/`currency1` by raw address value.
`0x3600000000000000000000000000000000000000` (USDC) sorts numerically **below**
`0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (EURC) — verified by direct integer comparison of
the two addresses. So on Arc, a USDC/EURC pool would have USDC as `currency0`, the same
convention `V4SettlementHook._beforeInitialize` already hard-codes (`currency0` must be
`address(0)`, `currency1` must be `PAYOUT_CURRENCY`) for its native-ETH-in shape — **but Arc has
no native ETH at all** (§6), so that exact check cannot be reused unchanged; see §6.

## 6. Native currency, fee accounting, and the "settlement shape" check

**6.1 Arc has no native ETH.** Official, `docs.arc.io`: *"Arc uses USDC for gas fees, not
ETH."* `Currency.unwrap(key.currency0) == address(0)` — the sentinel v4-core uses for "native
asset of this chain" — would still compile and still mean *something* on Arc (native USDC, at
18 decimals), but it would no longer mean what `V4SettlementHook._beforeInitialize` currently
enforces: "native ETH in, this chain's payout currency out" (spec C2/C4, the contract's own
NatSpec, `src/V4SettlementHook.sol` lines 80-82). Porting the live hook unchanged to Arc would
silently redefine the settlement shape from "ETH to USDC" to "native 18-decimal USDC to ERC-20
6-decimal USDC" — the exact same pot of money on both sides of the pool, at two different
scales, which is nonsensical as a swap and is precisely the trap `integrations/arc-treasury`'s
`units.mjs` was built to make un-typeable. **This is a required-code-change finding, not a
blocker**: §20 below treats it as a new `NotTheSettlementShape` branch, not a v4-core limitation.

**6.2 Fee accounting.** `V4SettlementHook` takes no protocol or hook fee; `HookFee` is always
emitted with both fee fields zero (`src/V4SettlementHook.sol` line 250, `_receipt`). Nothing
about that emission, or the OpenZeppelin `IHookEvents` interface it satisfies, is chain-specific,
so it carries to Arc unchanged — matching the standing decision "no UNICA fee in the beta"
(`docs/unica-v4/DECISIONS.md` item 55). The only Arc-specific fee-accounting fact is the 20 Gwei
basefee floor from §1: because it is denominated in native-USDC wei rather than ETH wei, any
future gas-cost estimate this codebase computes (there are none in the settlement contracts
today; only `script/`-level tooling would need it) must read it as USDC, not ETH, or it will be
wrong by whatever ETH's USD price is at the time — a distinct trap from the 6-vs-18-decimal one
in §5, worth stating separately because "Arc decimals are tricky for token amounts" does not by
itself warn a reader that gas costs carry the same trap for a different reason.

## 7. Payer binding and `WrongPayer`

The live `SettlementExecutor` (`src/SettlementExecutor.sol`) does not yet carry a `boundPayer`
field — that is a V2/V3-generation concept (`docs/v2/SECURITY-ADVISORY-001.md`,
`docs/unica-v4/DECISIONS.md` item 111: *"Every order binds an explicitly named payer... `WrongPayer`
is preserved"*). The experimental generation already does:
`UnicaStockSettlementExecutor.createOrder`'s `boundPayer` parameter and `pay`'s
`if (o.boundPayer != address(0) && o.boundPayer != msg.sender) revert E.WrongPayer(...)`
(`src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol` lines 99, 152-154) is
exactly the shape V2 Critical Advisory 001 requires as a mandatory regression case. None of this
logic reads `block.chainid`, a native-currency balance, or any Arc-specific state — it is a
`msg.sender` comparison against stored calldata. **Verdict: chain-independent; `WrongPayer`
carries to Arc unchanged, and Advisory 001's regression case must be re-run against whatever
Arc-targeted executor is written, per UNICA's standing rule that the advisory is mandatory
wherever a payer-bound executor exists.**

## 8. Replay

Two independent replay guards exist in this codebase and both are chain-independent by
construction. `V4SettlementHook._swapped`/`_markSwapped` use transient storage (`TLOAD`/`TSTORE`,
confirmed available on Arc's Osaka baseline, §1) keyed by `keccak256(orderId, "V4SettlementHook.swapped")`
— scoped to one transaction, so it protects against two swaps for one order in one call and
nothing more; the order's own status machine (`Open` to `Paying` to `Settled`,
`src/SettlementExecutor.sol` Status enum) is what prevents a *second transaction* from replaying
a settled order, and that machine is ordinary contract storage, not chain-specific. Order ids
are derived as `keccak256(chainid, executor, creator, salt)`
(`src/SettlementExecutor.sol` line 157) — the chain id is already baked into the id, so an order
minted for Sepolia cannot collide with, or be replayed against, one minted for Arc even if the
executor and creator addresses happened to match on both chains. **Verdict: replay protection is
chain-generic and needs no Arc-specific change.**

## 9. Reentrancy

`UnicaStockSettlementExecutor` carries an explicit transient reentrancy latch
(`_locked`/`_lock`/`_unlock`, `LOCK_SLOT`, lines 76, 145-146, 273-291) guarding `pay` against a
payout token that calls back during `PoolManager.take`. The live `SettlementExecutor` relies
instead on invariant I5 (status leaves `Open` before any external call) plus the PoolManager's
own lock — both mechanisms are ordinary EVM state and call-ordering discipline, not RPC- or
opcode-dependent, so both carry to Arc unchanged. The one Arc-specific reentrancy surface worth
naming: **Arc's USDC is itself a proxy** (§5.2), so an admin-triggered implementation swap
*during* a settlement is a theoretical vector this codebase has not modeled anywhere (Sepolia's
USDC is the same proxy family, so this is not new to Arc, only newly confirmed here). No test in
`test/attack/` or `test/fork/` currently exercises "the payout token's admin swaps
implementation mid-transaction"; that is a gap, not a finding specific to this port.

## 10. Nonstandard ERC-20 behaviour

`UnicaStockSettlementExecutor.pay` already measures rather than assumes: it snapshots balances
before `_safeTransferFrom`, requires `received == amountIn` exactly
(`E.InputNotExact`, line 179), and again measures the recipient's actual balance delta after the
PoolManager unlock closes (`_verifyDelivery`, lines 193-207) rather than trusting the pool's
delta alone. This defends against fee-on-transfer and rebasing tokens regardless of chain. Arc's
own USDC and EURC, as read in §5, behave as standard fixed-supply, non-rebasing, non-fee ERC-20s
at the interface level (`balanceOf`/`allowance`/`transfer`/`transferFrom` all answered normally);
nothing observed suggests either token is fee-on-transfer. **The nonstandard-token defense the
code already has is a superset of what Arc's real tokens require — no weakening is needed, and
none should be made for convenience.**

## 11. Caps, merchant allowlist, pause and `RETIRED`

None of these are implemented in the live `V4SettlementHook`/`SettlementExecutor` pair today —
they are v4/v5-generation design targets recorded in `docs/unica-v4/DECISIONS.md` (beta caps:
"$100 total at risk, $10 per transaction, $25 per day," item 5/6/7; merchant allowlist: "invitation
-only merchants during the beta," item 31; states "PROPOSED, INITIALIZED, SEEDED, ACTIVE, PAUSED
and RETIRED... RETIRED is terminal," item 112) and in the experimental generation's own NatSpec,
which explicitly disclaims them (`UnicaStockSettlementHook.sol`: "It never asserts the merchant
was paid," and carries no pause path at all). None of a per-transaction cap, a per-day cap, a
merchant allowlist, or a pause/RETIRED state machine depends on anything Arc-specific — they are
ordinary Solidity state and access control, and every mechanism available on any other EVM chain
this repo targets (a `mapping` allowlist, an `AccessControl`-style pauser role, a monotonic
"cannot leave RETIRED" check) is available on Arc's Osaka baseline. **Verdict: not yet built
anywhere; building them is chain-independent work, and Arc introduces no new obstacle to it.**

## 12. Safe on Arc

`safe-global/safe-deployments` (official Safe repository, fetched 2026-09-11) lists **canonical**
network entries for both Arc chain ids, version 1.4.1, across every singleton this report checked:

| Contract | Canonical address | `5042002` listed | `5042` listed |
|---|---|---|---|
| `Safe` (singleton) | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | yes | yes |
| `SafeL2` | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | yes | yes |
| `SafeProxyFactory` | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | yes | yes |
| `CompatibilityFallbackHandler` | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` | yes | yes |
| `MultiSend` | `0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526` | yes | yes |
| `MultiSendCallOnly` | `0x9641d764fc13c8B624c04430C7356C1C7C8102e2` | yes | yes |

**Independently confirmed on-chain, testnet only** (`eth_getCode`, `https://rpc.testnet.arc.io`,
2026-09-11): the `Safe` singleton and `SafeProxyFactory` addresses above both returned non-empty
runtime bytecode on chain `5042002`. Mainnet (`5042`) could not be independently checked — no
official keyless mainnet RPC exists yet (§3.3) — so its "yes" above reflects only that the
metadata file lists it as canonical, not an on-chain confirmation. This corroborates the
UniswapX playbook's own observation (§3.3) that `PoolManager.owner()` on Arc mainnet resolves to
"a 171-byte proxy, likely a Safe" — a Safe proxy of that byte size is consistent with, though not
proof of, the `SafeProxyFactory` template above. **Verdict: Safe is deployable on Arc testnet
today, confirmed; Safe on Arc mainnet is asserted by Safe's own canonical registry but not
independently on-chain verified by this report.** This matters directly for UNICA's own launch
gates — every mainnet gate in `docs/unica-v4/DECISIONS.md` (items 62-65, 70) requires a Safe the
owner controls before any value-moving deploy, on any chain.

## 13. Explorer verification

`https://testnet.arcscan.app` identifies itself, in its own page title, as *"Arc Testnet
blockchain explorer... | Blockscout"* (fetched 2026-09-11) — a **Blockscout**-family explorer,
not an Etherscan-family one. This is a required-code-change item for tooling, not for the
contracts: `forge verify-contract` needs `--verifier blockscout` and a Blockscout-shaped API URL
for Arc, the same pattern `foundry.toml`'s comment already documents for the Robinhood testnet
alias in this repo ("served through the Blockscout explorer for this chain"). No Etherscan-style
API key applies. Arc mainnet's explorer URL is **UNKNOWN** — the UniswapX playbook notes
`explorer.arc.io` "responds with a redirect" but does not resolve it, and this report did not
chase a redirect target that no official page names outright.

## 14. RPC and indexing

The only RPC endpoint this report treats as a source is the one named in `docs.arc.io`'s own
"Connect to Arc" page: `https://rpc.testnet.arc.io`, keyless, HTTP and WebSocket. It answered
every read in this document without a key. Alchemy, Blockdaemon, dRPC and QuickNode variants are
also listed there but require a provider API key and were not used, consistent with the
keyless-only rule this report operates under. `foundry.toml`'s `[rpc_endpoints]` table
(this repo) already carries an `arc_testnet = "${ARC_TESTNET_RPC_URL}"` alias — unset today, and
the required change is only to populate that environment variable, not to add a new alias.
Liveness: three separate `eth_blockNumber` reads taken on 2026-09-11 (see §0)
increased monotonically, confirming the chain is producing blocks in real time rather than
serving a frozen snapshot.

## 15. The Graph support on Arc

`thegraph.com/docs/en/supported-networks/arc/` (official, fetched 2026-09-11) lists **"Arc
Mainnet"** — chain id `eip155:5042` — as a supported network. The page gives no
testnet-specific listing this report could confirm, and states no "coming soon" caveat, which is
itself notable given mainnet is not yet public (§3.1): The Graph's docs are already prepared for
a chain whose public launch has not happened, the same forward posture Uniswap's own liquidity
announcement and The Graph's docs both take. **This report could not determine, from the fetched
page alone, whether Arc testnet (`5042002`) is indexable today, nor whether support means
Subgraph Studio hosted indexing, Graph Node self-hosting, or both — marked UNKNOWN pending a
direct Subgraph Studio deploy attempt against `5042002`, which this report did not perform (that
is a write action to a third-party service, outside read-only research).** UNICA's existing
subgraph tooling (`docs/unica-v4/evidence/` references a live Graph provider from the P1 workstream)
was not re-pointed at Arc as part of this report.

## 16. Compatibility matrix

| Area | Arc testnet (5042002) | Arc mainnet (5042) | Verdict |
|---|---|---|---|
| Solidity/EVM (cancun target, transient storage) | Compatible (Osaka superset) | same | **PASS** |
| Contract size ceiling | Under 24576B today | same | **PASS** |
| CREATE2 factory | Present, codehash-identical to Sepolia | UNKNOWN (no keyless RPC) | **PASS** (testnet) |
| Hook-address mining | Mechanism reusable, fresh salt needed | same, once PoolManager address is confirmed | **NEEDS RUN** |
| Uniswap v4 PoolManager | **None found, any source** | Claimed by a Uniswap repo, **UNCONFIRMED** independently | **BLOCKED** (testnet), **UNCONFIRMED** (mainnet) |
| Hook permission-bit validation | No issue independent of PoolManager existing | same | **N/A** until PoolManager confirmed |
| USDC decimals/address | 6, confirmed on-chain | not yet published | **PASS** (testnet) |
| EURC decimals/address | 6, confirmed on-chain | not yet published | **PASS** (testnet) |
| Native-asset settlement-shape check | **Needs rewrite** (no ETH) | same | **CODE CHANGE REQUIRED** |
| Fee accounting (`HookFee`=0) | Chain-independent | same | **PASS** |
| Payer binding / `WrongPayer` | Chain-independent (experimental gen. only) | same | **PASS**, not yet in live executor |
| Replay protection | Chain-independent | same | **PASS** |
| Reentrancy guards | Chain-independent; proxy-token vector unmodeled (also true on Sepolia) | same | **PASS**, pre-existing gap |
| Nonstandard-ERC-20 defenses | Superset of what Arc's tokens need | same | **PASS** |
| Caps / merchant allowlist / pause / RETIRED | Not yet built, chain-independent to add | same | **NOT BUILT** |
| Safe | Confirmed on-chain (testnet) | Listed canonical, not independently verified | **PASS** (testnet) |
| Explorer verification | Blockscout, needs `--verifier blockscout` | UNKNOWN URL | **CODE CHANGE REQUIRED** (tooling) |
| RPC | Keyless public endpoint documented and working | No official keyless endpoint yet | **PASS** (testnet) |
| The Graph | UNKNOWN (mainnet-only page found) | Listed as supported | **UNKNOWN** |

## 17. Required code changes

1. **`src/libraries/UniswapDeployments.sol`** — add `5042002` (and, once confirmed, `5042`)
   branches to `universalRouter()` and `payoutCurrency()`. Today both `revert
   UnsupportedChainId(chainId)` for any chain but `11155111`; this is why nothing in this repo
   can even compile a constructor call against Arc yet, independent of whether a PoolManager
   exists there.
2. **`lib/hookmate`'s `AddressConstants.getPoolManagerAddress`** — this repo's pinned copy
   (`lib/hookmate/src/constants/AddressConstants.sol`) has no `5042`/`5042002` branch either, and
   it is a git submodule this repo does not edit directly. Either wait for an upstream hookmate
   release that adds Arc once a PoolManager address is official, or stop routing
   `V4SettlementHook`'s constructor through `AddressConstants` for Arc specifically and resolve
   the address from this repo's own `config/chains/` file instead (§18) — the second option is
   safer, because it does not require trusting an upstream release timeline against a hackathon
   deadline.
3. **A new settlement-shape check for chains with no native asset** (§6.1) — a
   `NotTheSettlementShape` variant, or a chain-keyed "input currency" resolver replacing the
   hard-coded `address(0)` check, so an ERC-20-in, ERC-20-out shape (USDC in, EURC out, or
   USDC in/USDC-metered-out once a real counter-asset exists) is what gets validated on Arc,
   never a same-asset "swap" of native-USDC-for-ERC-20-USDC.
4. **`script/HookAddressForChain.s.sol` / `script/v3/MineHookV3.s.sol`** — extend the chain
   dispatch to `5042002`, and re-run mining once (1) and (2) above are in place, because
   `initCodeHash` changes with every chain-keyed constant the constructor reads.
5. **Explorer verification tooling** (`script/verify.sh`, `script/verify-v3.sh`) — add a
   Blockscout-flavoured branch for Arc, mirroring whatever this repo already does for the
   Robinhood testnet's Blockscout instance rather than inventing a second pattern.
6. **`test/compat/`** — this repo already has a chain-compatibility test folder
   (`CompatForkBase.sol`, `SepoliaRouterControl.t.sol`, `UpgradedRouterCompat.t.sol`); an
   `ArcForkBase.sol` following the same shape as `test/fork/ForkPin.sol` (§18) is the natural
   home for every fact this document asserts, turned into an assertion that fails loudly if Arc
   testnet ever changes underneath it.

## 18. Proposed `config/chains/5042002.json`

No `config/chains/` directory exists in this repository today; `docs/unica-v4/DECISIONS.md`'s
"chain-generic" ruling ("There is one settings file per chain... Scripts refuse any chain
without an enabled settings file") describes the target shape this file follows. Every address
below is either confirmed on-chain by this report or explicitly marked otherwise — **nothing is
invented**.

```json
{
  "name": "Arc Testnet",
  "chainId": 5042002,
  "enabled": false,
  "nativeCurrency": { "symbol": "USDC", "decimals": 18, "note": "gas asset; NOT the payout ERC-20" },
  "rpcUrlEnv": "ARC_TESTNET_RPC_URL",
  "publicRpcFallback": "https://rpc.testnet.arc.io",
  "explorer": { "url": "https://testnet.arcscan.app", "kind": "blockscout" },
  "contracts": {
    "create2Factory": "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    "multicall3": "0xcA11bde05977b3631167028862bE2a173976CA11",
    "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "usdc": "0x3600000000000000000000000000000000000000",
    "eurc": "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    "safeSingleton_1_4_1": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    "safeProxyFactory_1_4_1": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    "uniswapV4PoolManager": null,
    "uniswapUniversalRouter": null
  },
  "tokenDecimals": { "usdc": 6, "eurc": 6 },
  "notes": [
    "uniswapV4PoolManager and uniswapUniversalRouter are null: no source, official or third-party, names either on this chain id. Do not fill them from a guess.",
    "enabled is false until UniswapDeployments.sol and AddressConstants both carry this chain id and a PoolManager address is confirmed."
  ]
}
```

A parallel `config/chains/5042.json` (Arc mainnet) is deliberately **not proposed** — every
field would be either UNKNOWN or sourced only to the unconfirmed UniswapX playbook (§3.3), and a
committed file with real-looking addresses invites exactly the "we deployed against a wrong or
unofficial address" failure this repository's own "chain-generic" ruling exists to prevent. Write
it only after `developers.uniswap.org/docs/protocols/v4/deployments` (or an equivalent official
Uniswap page) lists Arc directly.

## 19. Fork/simulation plan

Follow this repo's own pattern (`test/fork/ForkPin.sol`, §2) rather than inventing a new one:

1. **`test/fork/ArcForkPin.sol`** — `PINNED_CHAIN_ID = 5042002`; pin a specific block via
   `vm.envOr("UNICA_ARC_FORK_BLOCK", <default>)` against `vm.envOr("ARC_TESTNET_RPC_URL",
   "https://rpc.testnet.arc.io")`; assert
   codehash `0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989` of the CREATE2 factory (already re-derived by
   this report, §2) and the `decimals()` of the USDC and EURC addresses in §18's config equal 6,
   the same style of dependency-provenance assertion `test/fork/DependencyProvenance.t.sol`
   already runs for Sepolia.
2. **`test/compat/ArcSettlementShapeCompat.t.sol`** — fork-test that the *rewritten*
   settlement-shape check (§17 item 3) accepts a USDC/EURC pool and rejects everything else,
   mirroring `test/compat/SepoliaRouterControl.t.sol`'s structure.
3. **No PoolManager fork test until §17 item 2 is resolved** — a fork test against a
   PoolManager address this report could not independently confirm (§3.3) would silently
   encode an unverified address as if it were fact. If the owner supplies an address from a
   source better than this report found, pin it with the same codehash-assertion discipline as
   every other dependency in `ForkPin.sol`, not as a bare constant.
4. **Local rehearsal first, exactly as `docs/experimental/STOCK-46630-DEPLOY-PLAN.md` already
   does for Robinhood testnet**: deploy the rewritten hook and executor into an Arc fork with
   `hookmate`'s official PoolManager *bytecode* (the same technique `foundry.toml`'s own comment
   describes using for local tests today) rather than the unconfirmed live address, run one full
   settlement, and only then consider a real testnet transaction.

## 20. Deployment-manifest template

Following the shape `docs/unica-v4/DECISIONS.md` and this repo's existing live-deploy proof rows
already use:

```
chain:              Arc Testnet (5042002)
retrieval date:      <fill at deploy time>
deployer EOA:        <fresh, gas-funded only, never the owner's Safe>
CREATE2 factory:     0x4e59b44847b379578588920cA78FbF26c0B4956C (codehash-verified, §2)
mined salt:          <from step 19.1, chain-specific>
hook address:        <computed, not guessed>
executor address:    <computed from hook + salt, §2 "Consequence for hook mining">
PoolManager:         <UNKNOWN until §17 item 2 resolves — deployment BLOCKED without it>
payout currency:     0x3600000000000000000000000000000000000000 (USDC, 6dp, confirmed §5)
pool pair:           <USDC/EURC or USDC/<other confirmed 6dp token> — never a same-asset pair>
explorer verify:     Blockscout, testnet.arcscan.app (§13)
Safe (admin):        <address> (template Safe 1.4.1, confirmed deployable §12)
pauser role holder:  <address, separate from Safe per DECISIONS item 65>
caps enabled:        <$ per-tx / per-day / total-at-risk, per DECISIONS items 5-7>
merchant allowlist:  <populated before any order can be created, per DECISIONS item 31>
value at risk:       $0 until every launch gate below is signed off
```

## 21. Launch blockers (testnet, no-value)

1. Uniswap v4 has no confirmed PoolManager on Arc testnet, from any source (§3.4) — **hard
   blocker** for any real swap; a fork rehearsal against official bytecode (§19.4) is the only
   coherent next step.
2. `UniswapDeployments.sol` and `hookmate`'s `AddressConstants` both revert on chain `5042002`
   today (§17) — compilation-level blocker, independent of (1).
3. The native-currency settlement-shape check (§6.1) has not been rewritten — deploying the
   *current* hook unchanged onto Arc would define a nonsensical pool shape.
4. No Arc-specific fork test exists yet (§19) to catch (1)-(3) before a real transaction.
5. No merchant allowlist, caps, or pause/RETIRED machinery exists in the live generation (§11) —
   independent of Arc, but binding on any deploy per `docs/unica-v4/DECISIONS.md`.

## 22. No-value testnet plan

With (1)-(5) above understood as blockers rather than unknowns: write `ArcForkPin.sol` and the
compat test (§19), add the two chain branches (§17 items 1, 4), rewrite the shape check (§17
item 3), rehearse a full settlement against official PoolManager *bytecode* inside a fork (never
a guessed live address), and stop there. **No testnet transaction against a real Arc
PoolManager is proposed by this report**, because no source — official or otherwise — currently
lets this repo target one with confidence (§3.4). If a PoolManager becomes confirmed on Arc
testnet after this report, only the fork rehearsal changes from "against bytecode" to "against a
codehash-pinned live address" (§19.3) — nothing else in this plan does.

## 23. Capped-mainnet plan

**Does not apply, and is not written, per the brief's own gate.** Arc mainnet (chain `5042`) has
no official public RPC, no official published contract addresses (`docs.arc.io`: *"Mainnet
addresses are not yet available"*), and a stated public-launch date of 2026-09-16 — five days
after this report's retrieval date (§3.1). UNICA's own mainnet gates (`docs/unica-v4/DECISIONS.md`
items 64, 70, 71: Safe verification, pauser wiring, and legal review all **"NOT READY"**) are
already unmet independent of Arc. Should the owner revisit this after 2026-09-16: the gate to
re-check first is §3.1 itself (has Arc mainnet actually gone public, with an official RPC and
published addresses), then §3.3 (has Uniswap's *canonical* deployments page, not a playbook doc,
listed a PoolManager), then every item in `docs/unica-v4/DECISIONS.md`'s "OPEN" section — in that
order, because a chain existing is a precondition for everything after it, not a substitute for
it.
