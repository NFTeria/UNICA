# Arc — Tokens: USDC, EURC, cirBTC, CCTP

Scope: official USDC and EURC contracts on Arc; the native-gas-vs-ERC-20
relationship; whether an official BTC-denominated asset exists on Arc;
whether "cirBTC" exists there; CCTP version and contracts; official
in/out routes. Retrieval date for every web source below: 2026-09-11.
Chain: **Arc Testnet, chain id 5042002** (Arc mainnet is not yet live at
time of writing; Circle's public messaging targets mainnet later in 2026,
but no mainnet chain id, RPC, or contract address is published anywhere
in Arc's own docs as of this retrieval — treat any mainnet address seen
elsewhere as UNVERIFIED).

Method: every address below was read from **`docs.arc.io`** (Circle's own
Arc documentation, primary source) and then independently confirmed with a
**keyless, docs-named public RPC** (`https://rpc.testnet.arc.io`, listed at
`https://docs.arc.io/arc/references/connect-to-arc.md`) using `eth_getCode`,
`eth_call` (`decimals()`, `symbol()`, `name()`, and FiatToken-style admin
getters), and `eth_getStorageAt` against known proxy-storage slots. No
wallet balance of any owner address was read. All reads are of public
contract state only.

## 1. Network identity (for this file's on-chain reads)

| Property | Value | Source |
|---|---|---|
| Chain | Arc Testnet | `https://docs.arc.io/arc-chain.md` — retrieved 2026-09-11 |
| Chain id | `5042002` | Same page, "Network details" table; confirmed on-chain: `eth_chainId` → `"0x4cef52"` = 5042002 decimal |
| Public RPC (keyless, docs-named) | `https://rpc.testnet.arc.io` | `https://docs.arc.io/arc/references/connect-to-arc.md` |
| Explorer | `https://testnet.arcscan.app` | `https://docs.arc.io/arc/references/contract-addresses.md` |
| Mainnet chain id / RPC / addresses | UNKNOWN — not published | `https://docs.arc.io/arc/references/contract-addresses.md`: "All addresses on this page are for Arc Testnet. Mainnet addresses are not yet available." |

## 2. USDC on Arc

USDC is Arc's **native gas asset**, not a bridged or wrapped token. It is
deployed at protocol genesis in two interfaces over one balance.

| Field | Value | How confirmed |
|---|---|---|
| Native interface | 18 decimals; used for `msg.value`, gas accounting, native `eth_getBalance` | Doc quote below |
| ERC-20 interface address | `0x3600000000000000000000000000000000000000` | Listed at `contract-addresses.md`; `eth_getCode` on-chain returns non-empty bytecode |
| ERC-20 decimals | 6 | On-chain `decimals()` call → `6` |
| ERC-20 `symbol()` / `name()` | `"USDC"` / `"USDC"` | On-chain calls |
| Issuer | Circle (native protocol asset; same FiatToken governance model Circle uses for USDC elsewhere — see proxy findings below) | `https://docs.arc.io/arc/concepts/stablecoin-native-model.md` |
| Native vs bridged | **Native** — deployed at genesis, not bridged/wrapped from another chain. Docs are explicit: "There is no wrapped USDC address on Arc." | `contract-addresses.md` |
| Proxy / upgradeability | **Yes — upgradeable proxy.** The ERC-20-interface address is a classic OpenZeppelin/zOS `AdminUpgradeabilityProxy` (the same pattern Circle uses for its FiatTokenProxy on Ethereum mainnet), not a plain token contract. | On-chain, see below |
| Pause | **Present, currently `false`.** `paused()` view exists and returned `false` at read time. | On-chain `eth_call` |
| Blacklist / denylist | **Present.** `blacklister()`, `isBlacklisted(address)` exist; `isBlacklisted(0x0)` returned `false`. | On-chain `eth_call` |
| Hooks | None documented; this is a standard FiatToken-style ERC-20, not an ERC-777/hook-bearing token. Arc's *native* USDC transfers (the 18-decimal side) additionally emit an EIP-7708 system `Transfer` log — see §4. | `evm-differences.md` |

Proxy verification detail (read directly from chain, not inferred from
bytecode alone):

| Call / storage slot | Result |
|---|---|
| `implementation()` view call | `0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6` |
| `admin()` view call | `0x49f78af090F1f98e7184B7f61f1F1a8a8064b40d` |
| storage slot `keccak256("org.zeppelinos.proxy.admin")` (admin slot) | `0x00000000000000000000000049f78af090f1f98e7184b7f61f1f1a8a8064b40d` — matches `admin()` exactly |
| `owner()` | `0xDC29Bab4A7d5425cA44eeF20a5B67E3D897F9a03` |
| `masterMinter()` | `0xa1F45991b7928B14f2047E36958D6Ae7D24bbf41` |
| `pauser()` | `0xbc639a0A060E5831a7c437b491B8d3C1f58F554e` |
| `blacklister()` | `0x9338f53291715F1126291E28BBd3B9989e966572` |

The standard EIP-1967 slots (`0x360894a1...382bbc` implementation,
`0xb5312768...b5d6103` admin — slot label: EIP-1967 impl/admin slots) both
read as zero on this contract: Arc's USDC proxy uses the **older
zOS-style** admin/implementation storage slots, not EIP-1967. Anyone
porting EIP-1967-only tooling (some block explorers, some proxy-detection
libraries) to Arc's USDC address will misreport it as "not a proxy" —
worth flagging for any UNICA tooling that introspects token contracts.

Source for the two-interface model and the 10¹² divide/truncate rule:
`https://docs.arc.io/arc/concepts/stablecoin-native-model.md`, quote:
"The native representation uses 18 decimals... The ERC-20 interface...
uses 6 decimals to match the standard USDC representation on other EVM
networks." Same page, on truncation: "amounts smaller than 1×10⁻⁶ USDC
are not represented in `balanceOf` but are still present in the native
balance."

## 3. EURC on Arc

| Field | Value | How confirmed |
|---|---|---|
| Address | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | `contract-addresses.md`; `eth_getCode` non-empty |
| Decimals | 6 | On-chain `decimals()` → `6` |
| `symbol()` / `name()` | `"EURC"` / `"EURC"` | On-chain calls |
| Issuer | Circle | `https://docs.arc.io/arc/concepts/stablecoin-native-model.md`: "EURC is Circle's euro-denominated stablecoin." |
| Native vs bridged | **Deployed as a standard ERC-20 at genesis** (protocol-level, not native-gas like USDC, and not bridged). Doc quote: "It is deployed as a standard ERC-20 token on Arc with 6 decimals... not bridged or wrapped from other blockchains." | Same page |
| Proxy / upgradeability | **Yes — same zOS admin-proxy pattern as USDC**, but with its **own, separate** implementation and admin — EURC's governance is not shared with USDC's. | On-chain, below |
| Pause | Present, `false` at read time | On-chain `paused()` |
| Blacklist / denylist | Present (`blacklister()` role exists; not individually probed for a specific blacklisted address on EURC) | On-chain `blacklister()` |
| Hooks | None documented; standard FiatToken-style ERC-20 | — |

| Call | Result |
|---|---|
| `implementation()` | `0xECA045ED98a6D70887d2050F3BE1Fb0F0311017c` |
| `admin()` | `0x667B894BcC6899F5dF1EBA73c006b94c661A2d95` |
| `owner()` | `0x7A154EA9156D354504ad9A401380AA548039BE8b` |
| `masterMinter()` | `0x58F07DcEbe1a9cf5751070F9Cb556bEB219B6652` |
| `pauser()` | `0x7A154EA9156D354504ad9A401380AA548039BE8b` (same address as `owner()`) |
| `blacklister()` | `0xD08Bf5eB8663981C6af2fE3469e07b62ed6d469d` |

USDC's and EURC's proxy admin/implementation addresses are **all
different from each other** (no shared admin key observed between the
two tokens from these reads alone) — each stablecoin has its own
independent governance set on testnet.

## 4. Native-gas USDC vs the ERC-20 USDC interface — the relationship

One balance, two views, both live on the same account:

- **Native (18 decimals):** what `eth_getBalance` / `.balance` /
  `msg.value` show. This is what pays gas and moves in a plain value
  transfer.
- **ERC-20 (6 decimals):** what `USDC.balanceOf()` at
  `0x3600000000000000000000000000000000000000` shows. This is what
  `transferFrom`/`approve`/allowance-based DeFi code sees.

They are **the same underlying balance**, not two separate tokens and not
a wrapper pair. Consequences documented by Circle, each load-bearing for
any contract UNICA deploys on Arc:

- Converting between the two is a division/multiplication by **10¹²**,
  never a swap, transfer, or bridge call.
- The ERC-20 view **truncates** sub-µUSDC (< 0.000001 USDC) amounts: a
  zero `balanceOf()` does not prove a zero native balance.
- A **pool or LTV calculation that reads both `msg.value`/native balance
  and `USDC.balanceOf()` and treats them as two assets is a bug** — Circle's
  own warning: "A liquidity pool that pairs native USDC against the ERC-20
  USDC interface (as if they were two assets) is meaningless on Arc,
  because they are one asset." (`evm-differences.md`)
- **No WETH-style wrapper exists or should be deployed.** `contract-addresses.md`:
  "There is no wrapped USDC address on Arc."
- Every native USDC movement (plain send, contract endowment,
  `SELFDESTRUCT` transfer) additionally emits a standard ERC-20-shaped
  `Transfer` **log** (not a token) from a fixed **system emitter address**
  `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE`, per
  [EIP-7708](https://eips.ethereum.org/EIPS/eip-7708). This log is 18-decimal
  and is separate from the ERC-20 contract's own 6-decimal `Transfer` log;
  an indexer matching by emitter address to avoid double-counting is
  Circle's documented practice, not optional. Source:
  `https://docs.arc.io/llms.txt`, "Instructions for AI Agents" §2, and
  `https://docs.arc.io/arc/references/evm-differences.md` ("Native USDC
  Transfer events (EIP-7708)").
- A **value transfer can revert even with sufficient balance** — to the
  zero address, to/from a blocklisted address, or as a burn — all
  protocol-level rules layered on top of the plain EVM value-transfer
  opcode. Relevant if UNICA's settlement path ever moves native USDC
  directly rather than through the ERC-20 interface. Source:
  `evm-differences.md`, "Value transfer rules".

## 5. Is there an official BTC-denominated asset on Arc? Is "cirBTC" it?

**Short answer: UNKNOWN / NOT CONFIRMED.** No BTC-denominated token of any
kind appears on Arc's official contract-address list, and no verified
cirBTC contract address on Arc has been found from a primary source.

**What cirBTC actually is (confirmed, but not on Arc).** cirBTC ("Circle
Wrapped Bitcoin") is a real, currently-live Circle product:

- Primary source: `https://www.circle.com/cirbtc` — Circle's own product
  page, live with a real-time reserve dashboard (40.03 cirBTC / 42.53 BTC
  reserve at retrieval time).
- Issuer: "Circle International Bermuda Limited, a Class F Digital Asset
  Business licensed and regulated by the Bermuda Monetary Authority."
  Reserves custodied at "Circle National Trust Bank, a federally chartered
  trust bank and qualified custodian." (same page)
- Deployment chains, per Circle's own developer docs
  (`https://developers.circle.com/assets/what-is-cirbtc`, quoted exactly):
  > "cirBTC is available on the following blockchains: **Ethereum**: mainnet
  > and Sepolia testnet. **Arc**: testnet."
- That page gives the Circle Mint API currency code (`CIRBTC`) and a
  mint/redeem quickstart link, but **does not publish a contract address
  for either chain**.
- Circle's Arc-specific reference docs (`docs.arc.io/arc/references/contract-addresses.md`,
  the same page that lists USDC/EURC/USYC/CCTP/Gateway) **does not mention
  cirBTC at all** as of this retrieval. So: Circle's own *product* docs say
  cirBTC is live on Arc testnet; Circle's own *Arc chain* docs do not list
  it as a deployed contract. This is a real gap, not an oversight in this
  research — both pages were fetched directly on 2026-09-11.

**Candidates found on Arc Testnet's public token list — none verified as
Circle's.** Arc's block explorer (`https://testnet.arcscan.app`, the
explorer named in Arc's own docs) exposes a public, permissionless token
list/search API. A search for `cirbtc` returned **multiple, mutually
inconsistent tokens self-labeled "cirBTC"**, confirmed live on-chain
(`decimals()`/`symbol()`/`name()` all read directly, no wallet balance
involved):

| Address | On-chain `name()` | On-chain `symbol()` | Decimals | Explorer "verified source"? | Verdict |
|---|---|---|---|---|---|
| `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | "Circle Wrapped Bitcoin" | `cirBTC` | 8 | yes | **Circle-issued — corrected 2026-09-11 (see §Correction).** Listed as the Arc Testnet address on developers.circle.com/assets/cirbtc-contract-addresses; FiatTokenProxy with verified source |
| `0x514466411580b73dcEB8D28148C721e71Cc7e379` | "Wrapped Bitcoin" | `cirBTC` | 8 | yes | **UNKNOWN issuer** — different name than the row above despite the same symbol; the two cannot both be canonical |
| `0x1d60218b19EFAd8799f214de35bC7Bc2c21828f9` | "Mock Circle BTC" | `CirBTC` | 18 | no | Explicitly self-labeled a **mock** |
| `0x27793Ec6760760670328592ca8BAeA43bb0ad3FB` | "NairaX Demo cirBTC" | `cirBTCX` | 8 | yes | Explicitly self-labeled a **demo** by a third party ("NairaX") |

Anyone can deploy an ERC-20 on a permissionless testnet, name it
`"Circle Wrapped Bitcoin"`, set its symbol to `cirBTC`, and have it
picked up by an explorer's token list — "verified source" on the explorer
only attests the bytecode matches submitted source, never that the
deployer is Circle. None of the four rows above appears anywhere in
Circle's or Arc's own documentation. **This is exactly the ambiguity to
guard against: do not treat any of these as "cirBTC" on Arc.**

**Ruling (superseded 2026-09-11, see §Correction): cirBTC's exact Arc-testnet contract address is UNKNOWN.**
Circle's own docs assert the asset exists on Arc testnet via the Mint API,
but publish no contract address there, and Arc's own contract-address
reference does not list it. No other BTC-denominated asset (cbBTC, WBTC,
tBTC, etc.) appears on Arc's official contract-addresses page either.

**What the owner must provide before UNICA can integrate any BTC asset on
Arc:**

1. The exact cirBTC (or other BTC-asset) **contract address on Arc
   testnet**, obtained from a source the owner controls or trusts
   directly — e.g., by minting testnet cirBTC through Circle's own
   Mint console/API (`https://app-smokebox.circle.com`, named on
   Circle's cirBTC docs page) and reading the address the mint
   transaction actually interacts with, or by opening a ticket with
   Circle Support and asking for the canonical Arc testnet address.
2. Confirmation of which of the four candidate addresses above, if any,
   is impersonating the real asset, so UNICA's docs and any denylist can
   name it explicitly as a known-bad testnet lookalike.
3. If UNICA needs a BTC-denominated leg at all for the beta: written
   confirmation that this is in scope, since the project ruling on file
   is "no unsupported BTC token" — until cirBTC's address is confirmed
   from a primary source, any BTC-denominated flow on Arc stays out of
   scope.

## 6. CCTP on Arc

Arc Testnet runs **CCTP V2** (TokenMessenger/MessageTransmitter/TokenMinter
suffixed `V2`, matching Circle's current cross-chain transfer protocol
generation). Source: `https://docs.arc.io/arc/references/contract-addresses.md`,
section "Crosschain" — "Circle's [Cross-Chain Transfer Protocol]
(https://developers.circle.com/cctp) (CCTP)".

| Contract | Address | Confirmed on-chain |
|---|---|---|
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | non-empty bytecode; **is itself an upgradeable proxy** (same zOS pattern as USDC/EURC); `implementation()` → `0xF07C0ad13178a9ef5c3fFA0Be69e0BECd452Bf6D` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | non-empty bytecode; also a proxy; `implementation()` → `0xA849059BC1F6Fff867eF77bed6fA874f77a62466`; `localDomain()` → `26` |
| TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` | non-empty bytecode confirmed |
| MessageV2 (library/helper) | `0xbaC0179bB358A8936169a63408C8481D582390C4` | non-empty bytecode confirmed |
| Arc's CCTP domain id | `26` | Listed in `contract-addresses.md`; independently confirmed by calling `localDomain()` on MessageTransmitterV2, which returned `26` |

**Gateway** (Circle's chain-abstracted-balance product, separate from
CCTP's message-passing, but built on top of the same domain numbering) is
also deployed on Arc testnet:

| Contract | Address | Confirmed on-chain |
|---|---|---|
| GatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | non-empty bytecode |
| GatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | non-empty bytecode |

Source for both tables:
`https://docs.arc.io/arc/references/contract-addresses.md`, sections
"CCTP" and "Gateway". Same page's intro: "CCTP handles crosschain message
passing and stablecoin transfers, while Gateway provides chain-abstracted
USDC balances for seamless liquidity movement."

## 7. Official routes to move USDC/EURC in and out of Arc

Per Circle's own Arc "App Kit" docs (not independently re-derived
on-chain — these are product/SDK claims, cited as such):

| Route | What it does | Source |
|---|---|---|
| **Bridge** (App Kit, CCTP-backed) | Transfer USDC across chains, including into/out of Arc | `https://docs.arc.io/app-kit/bridge.md` |
| **Unified Balance** | Combines USDC held across multiple chains into one chain-abstracted spendable balance, deposit-and-spend | `https://docs.arc.io/app-kit/unified-balance.md` |
| **Swap** (same-chain) | Token swaps on one chain, not itself a bridge | `https://docs.arc.io/app-kit/swap.md` |
| **Send** | Wallet-to-wallet, same chain | `https://docs.arc.io/app-kit/send.md` |
| Raw CCTP V2 (no App Kit) | Direct `depositForBurn`/`receiveMessage` against the TokenMessengerV2 / MessageTransmitterV2 addresses in §6, using domain `26` for Arc | `https://developers.circle.com/cctp` (general CCTP reference; Arc-specific addresses are the ones in §6) |

App Kit's Bridge and Unified Balance are stated to wrap CCTP under the
hood ("App Kit wraps CCTP and provides Bridge, Swap, Send, and Unified
Balance capabilities" — `https://docs.arc.io/llms.txt`), so the
CCTP V2 contracts in §6 are almost certainly the actual on-chain path for
both the raw and the App-Kit-wrapped route on Arc, though App Kit's SDK
source was not independently traced to confirm the call graph as of this
retrieval (2026-09-11) — flagged as an assumption, not a verified fact.

EURC-specific bridging: Arc's docs describe Bridge/CCTP in USDC terms
throughout; no EURC-specific CCTP or Gateway contract is listed separately
on `contract-addresses.md`. Whether EURC moves cross-chain via the same
CCTP V2 domain-26 contracts or is USDC-only tooling is **UNKNOWN** from
the sources fetched — worth a direct question to Circle/Arc support
before UNICA relies on it for EURC.

## 8. Verified address table (chain id + source, one row per contract)

All rows: **chain id 5042002 (Arc Testnet)**. "Source" = where the address
is officially published; "On-chain" = what was independently confirmed
directly against chain state on 2026-09-11.

| Contract | Address | Source | On-chain confirmation |
|---|---|---|---|
| USDC (ERC-20 interface over native) | `0x3600000000000000000000000000000000000000` | `docs.arc.io/arc/references/contract-addresses.md` | code present; `decimals()`=6, `symbol()`="USDC", proxy `implementation()`=`0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | same | code present; `decimals()`=6, `symbol()`="EURC", proxy `implementation()`=`0xECA045ED98a6D70887d2050F3BE1Fb0F0311017c` |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` | same | code present (different proxy pattern — appears EIP-1967-style, not probed further; out of scope here) |
| USYC Entitlements | `0xCC205224862C7641930c87679E98999d23C26113` | same | not independently read |
| USYC Teller | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` | same | not independently read |
| CCTP TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | same | code present; proxy `implementation()`=`0xF07C0ad13178a9ef5c3fFA0Be69e0BECd452Bf6D` |
| CCTP MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | same | code present; proxy `implementation()`=`0xA849059BC1F6Fff867eF77bed6fA874f77a62466`; `localDomain()`=26 |
| CCTP TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` | same | code present |
| CCTP MessageV2 | `0xbaC0179bB358A8936169a63408C8481D582390C4` | same | code present |
| Gateway GatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | same | code present |
| Gateway GatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | same | code present |
| cirBTC (Arc testnet) | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` (**corrected 2026-09-11**; §5 above said UNKNOWN) | Circle (developers.circle.com/assets/cirbtc-contract-addresses, Arc Testnet row) | The other three self-labeled cirBTC-like tokens in §5 are look-alikes: **never use them**. Arc's own contract-addresses page does not list cirBTC. Testnet tokens have no financial value. |

## 9. Open items for the owner / next verification step

1. **cirBTC's real Arc-testnet address** — get it from Circle Mint
   directly (mint a test unit and read the token the mint call
   interacts with) or from Circle Support; do not trust an explorer
   token-list match on name or symbol alone (§5).
2. **EURC's CCTP/Gateway route** — confirm with Circle/Arc whether EURC
   uses the same domain-26 CCTP V2 contracts as USDC, or has no
   supported cross-chain route yet (§7).
3. **Mainnet timing** — this file covers testnet only; no mainnet chain
   id or addresses exist yet in Arc's own docs as of 2026-09-11. Re-run
   this verification against `docs.arc.io`'s contract-addresses page
   once Arc mainnet is announced, before pointing any UNICA deployment
   at a mainnet USDC/EURC address sourced from anywhere else.
4. **App Kit call graph** — the claim in §7 that Bridge/Unified Balance
   route through the same CCTP V2 contracts listed in §6 is Circle's own
   product description, not independently traced through App Kit's SDK
   source as of this retrieval (2026-09-11).

## Sources (primary, retrieved 2026-09-11)

- `https://docs.arc.io/arc-chain.md` — Arc Network overview, chain id.
- `https://docs.arc.io/arc/references/connect-to-arc.md` — RPC/chain id,
  used as the keyless public RPC for every on-chain read in this file.
- `https://docs.arc.io/arc/references/contract-addresses.md` — USDC,
  EURC, USYC, CCTP, Gateway, StableFX, and common-Ethereum-contract
  addresses; the authoritative list this file cross-checks against.
- `https://docs.arc.io/arc/references/evm-differences.md` — native USDC
  two-interface model, EIP-7708 system emitter, value-transfer rules.
- `https://docs.arc.io/arc/concepts/stablecoin-native-model.md` — USDC
  native-gas design, EURC/USYC native-support statement.
- `https://docs.arc.io/arc/references/gas-and-fees.md` — 18-decimal gas
  accounting confirmation.
- `https://docs.arc.io/llms.txt` — Arc's own agent-facing instructions
  index; system-emitter address, App Kit/CCTP relationship claim.
- `https://www.circle.com/cirbtc` — cirBTC issuer, custody, live reserve
  figures.
- `https://developers.circle.com/assets/what-is-cirbtc` — cirBTC chain
  availability quote ("Arc: testnet"), Mint API currency code.
- `https://testnet.arcscan.app` (public token-search API) — candidate
  cirBTC-labeled tokens on Arc testnet; official Arc block explorer named
  in Arc's own docs.
- On-chain: `https://rpc.testnet.arc.io` (keyless, named at
  `connect-to-arc.md`) — `eth_chainId`, `eth_getCode`, `eth_call`
  (`decimals`, `symbol`, `name`, `totalSupply`, `implementation`, `admin`,
  `owner`, `masterMinter`, `pauser`, `blacklister`, `isBlacklisted`,
  `localDomain`), `eth_getStorageAt` against named proxy slots — for every
  address in §8 marked "On-chain confirmation".

## Correction, 2026-09-11 (appended; the superseded text above is left in place)

The account in §5 above ruled cirBTC's Arc-testnet address UNKNOWN because neither Arc's contract-addresses
page nor Circle's USDC/EURC pages publish it. Circle publishes it on a separate page:
`https://developers.circle.com/assets/cirbtc-contract-addresses`, whose testnet table lists
**Arc Testnet: `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`** and states that testnet tokens have no
financial value. On chain (Arc testnet 5042002, keyless `https://rpc.testnet.arc.io`): the address
has code, `name()` = "Circle Wrapped Bitcoin", `symbol()` = "cirBTC", `decimals()` = 8, and the
explorer shows it as a source-verified `FiatTokenProxy`, the same proxy family as Arc's USDC and
EURC. THREAT-MODEL.md entry E-17 reached the same result independently. The three other
cirBTC-like tokens in the §5 table remain look-alikes and must never be used; asset identity is the
address above, pinned in reviewed chain configuration.
