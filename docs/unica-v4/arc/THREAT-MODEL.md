# Arc workstream — threat model

Security review. Read-only research, local simulation and planning. Nothing in this file deploys,
signs, broadcasts, approves, funds or bridges anything, and nothing here asks anyone to. Every
external fact was retrieved on **2026-09-11** from a primary source, or read from the chain through a
keyless RPC that Arc's own documentation names. Each fact carries an evidence id (`E-nn`) defined
once in §1 and cited by id everywhere else.

**Repository notes are leads, never sources.** `docs/ARC-FACTS.md`, `integrations/arc-treasury/`,
`docs/unica-v4/evidence/`, `docs/unica-v4/DECISIONS.md` and the sibling files in this directory
pointed at where to look. They are cited only for what UNICA has decided or built. Where a sibling
file disagrees with a primary source read today, §6 records the correction.

**Binding context.** UNICA v4 is the UNICA release; Uniswap v4 is the AMM. Payer-bound orders only,
`WrongPayer` preserved. V2 Critical Advisory 001 (`docs/v2/SECURITY-ADVISORY-001.md`) is a mandatory
regression. The UNICA fee is 0 in the beta. No real tokenized equities; no unsupported BTC token. A
same-asset USDC payment is never forced through a swap. No real-value deployment without a Safe, a
pauser, caps, verified contracts, authenticated pricing wherever conversion occurs, adequate
liquidity, simulations and an independent human review. Arc, Circle, Chainlink, x402 and Privy are
additional workstreams; the sponsor order stays 1 Uniswap v4, 2 ENSv2 on Sepolia, 3 The Graph.

**What is being modelled.** No UNICA contract is deployed on any Arc chain id. This file models the
workstream — an Arc-side USDC order paid by the bound payer, an optional x402 collection leg, an
optional EURC or BTC-asset conversion leg, and the CCTP and Gateway paths that move USDC in and out —
not a running system. Compatibility is never described here as a completed integration.

**Status words in the Test column.**

| Word | Meaning |
|---|---|
| RAN | The test exists in this repository, was executed on 2026-09-11, and passed; §5 lists the run. Rows from `test/experimental/StockSettlement.t.sol` (`test_A2`, `test_B5`, `test_B7`, `test_D1`) exercise the experimental executor in `src/experimental/`, not a release contract |
| LAB | Exists and ran, but exercises a laboratory contract in `src/lab/` (`NanoAuthorizationHook.sol`, `LimitProbes.sol`) that is not deployed and that nothing depends on |
| PROPOSED | A named test to write. No file exists yet. It proves nothing until it exists and has been seen to fail on a sabotaged input |
| BLOCKED | Cannot be written until a named external fact exists |

Arc-semantics tests need Arc's EVM. Arc's docs say plain local EVMs "can't reproduce Arc-specific
behavior" (E-41), so every PROPOSED Arc row runs under Arc Foundry's `arc-anvil --network arc` or a
read-only fork of chain id 5042002, never under plain `anvil`.

## 1. Evidence ledger

On-chain reads are on **chain id 5042002** (Arc Testnet) through `https://rpc.testnet.arc.io`
unless a row says otherwise, between blocks 61617782 and 61618424. No wallet balance of any owner
address was read. `docs.arc.io` pages were fetched as their `.md` source; `developers.circle.com`
likewise.

### 1.1 Network, mainnet status, and where Uniswap stands

| Id | Fact | Source | Quote, JSON path, or read result |
|---|---|---|---|
| E-01 | Arc Testnet's chain id is 5042002, and four docs-listed keyless RPCs agree on it and on one block | `https://docs.arc.io/arc/references/connect-to-arc.md`; `eth_chainId` and `eth_getBlockByNumber(61617782)` on `rpc.testnet.arc.io`, `rpc.blockdaemon.testnet.arc.io`, `rpc.drpc.testnet.arc.io`, `rpc.quicknode.testnet.arc.io` | all four: chain id `5042002`; block hash 0x8f4d313b6e28ea2af0fe0f1500154ab17eb53697fb28d05e86493b1840f14301 |
| E-02 | Arc's own docs publish no mainnet addresses or endpoints | `https://docs.arc.io/arc/references/contract-addresses.md`; `.../rpc-endpoints.md` | "Mainnet addresses are not yet available."; "Mainnet endpoints and parameters are published separately when available." |
| E-03 | Arc is in private mainnet; public launch is targeted for 16 Sep 2026 | `https://www.circle.com/pressroom/circle-announces-founding-validator-cohort-and-major-integrations-for-arc-ahead-of-september-16-mainnet-launch` (dated 2026-08-05) | "Arc is currently in private mainnet"; "on track for a public mainnet launch on September 16, 2026" |
| E-04 | The mainnet explorer that Chainlink's directory names is not publicly readable | `explorerUrl` in E-33's network block = `https://explorer.arc.io/address/%s`; HTTP GET of `/` and `/api/v2/stats` | both return 302 to a `circle.cloudflareaccess.com` login; no public mainnet read path existed for this review |
| E-05 | Uniswap's `sdk-core` names chain id 5042 `ARC` and lists a v4 PoolManager for it | `github.com/Uniswap/sdks`, `sdks/sdk-core/src/chains.ts` (last commit `9a527777ec86`, 2026-09-01) and `addresses.ts` (`209da9f4bf93`) | `ChainId.ARC = 5042`; `ARC_ADDRESSES.v4PoolManagerAddress` = `0x8366a39cc670b4001a1121b8f6a443a643e40951`; not read on-chain (E-04) |
| E-06 | Uniswap's v4 deployments page lists no Arc chain | `https://docs.uniswap.org/contracts/v4/deployments` | page headings: 19 mainnet and 6 testnet chains; zero case-insensitive matches for the word "arc" |
| E-07 | The Ethereum and Sepolia v4 PoolManager addresses have no code on Arc Testnet | E-06's page for the addresses; `eth_getCode` on 5042002 | `0x000000000004444c5dc75cB358380D2e3dE08A90` → 0 bytes; `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` → 0 bytes |
| E-08 | A Uniswap repository playbook for "Arc (chainId 5042)" marks its own verification pending | `github.com/Uniswap/UniswapX`, `playbook/chains/arc.md` (last commit `3f5019cf206b`, 2026-06-23) | "Explorer verification + SDK/service wiring (Phases 2–4) pending." |
| E-48 | Circle's own node repository states Arc mainnet's chain id | `github.com/circlefin/arc-node`, `BREAKING_CHANGES.md` (last commit `66ad2d5aa6d9`, 2026-08-28) | "The CL on mainnet (chain id `5042`)"; "Testnet (`5042002`)"; no public RPC exists to confirm it by `eth_chainId` (E-04) |
| E-35 | Finality is BFT and final on commit, under a Proof-of-Authority validator set | `https://docs.arc.io/arc/concepts/deterministic-finality.md`; `.../consensus-layer.md` | "no confirmation windows, no reorganization risk"; commit needs "more than two-thirds of validators" to pre-commit |
| E-36 | Transactions below the fee floor vanish without a receipt | `https://docs.arc.io/arc/references/evm-differences.md`; `.../gas-and-fees.md`; latest-block read | "silently dropped by the mempool"; `baseFeePerGas` 20000000000; `extraData` `0x00000004a817c800` (next base fee, 20 gwei); `eth_gasPrice` 22000000000 |
| E-37 | What one on-chain transfer costs | `eth_estimateGas` from the GatewayWallet contract (E-30) as `from`, value 1 raw unit | USDC ERC-20 `transfer` 49,097 gas; native send 21,000 gas; at the 20 gwei floor: 0.000982 USDC and 0.00042 USDC |
| E-38 | Native value transfers can revert where Ethereum's succeed | `https://docs.arc.io/arc/references/evm-differences.md` | "An included transaction that reverts on a blocklist check still consumes gas."; value to `0x0` reverts; `PREVRANDAO` "Always returns `0`"; timestamps "non-decreasing, not strictly increasing" |
| E-39 | Arc's own pages disagree on whether a blocklist revert leaves a receipt | `https://docs.arc.io/llms.txt` versus E-38 | llms.txt: "blocklist reverts consume gas without a receipt"; E-38 says "included". Receipt presence is therefore UNKNOWN |
| E-40 | Two predeploys relay calls with the original caller as `msg.sender` | `https://docs.arc.io/arc/references/contract-addresses.md` | Memo `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`, Multicall3From `0x522fAf9A91c41c443c66765030741e4AaCe147D0`: "preserves the original `msg.sender` in each subcall" |
| E-41 | Plain local EVMs cannot emulate Arc | `https://docs.arc.io/arc/references/evm-differences.md` | "can't reproduce Arc-specific behavior"; use `arc-anvil --network arc` |
| E-43 | Arc documents an opt-in confidential execution sector | `https://docs.arc.io/arc/concepts/opt-in-privacy.md` | "No execution results, return values, or event logs are exposed"; whether it is live on testnet was not established |

### 1.2 Tokens — identity is the address on chain 5042002, never the ticker

| Id | Fact | Source | Quote, JSON path, or read result |
|---|---|---|---|
| E-09 | USDC's ERC-20 interface on Arc Testnet, from two Circle sources and the chain | `https://docs.arc.io/arc/references/contract-addresses.md`; `https://developers.circle.com/stablecoins/usdc-contract-addresses.md`; reads | both list `0x3600000000000000000000000000000000000000`; `name()` "USDC", `symbol()` "USDC", `decimals()` 6 |
| E-10 | Native USDC is 18 decimals and shares one balance with the ERC-20 view | `https://docs.arc.io/arc/concepts/stablecoin-native-model.md` | "amounts smaller than 1×10⁻⁶ USDC are not represented in `balanceOf`" |
| E-11 | EURC on Arc Testnet, from two Circle sources and the chain | contract-addresses.md; `https://developers.circle.com/stablecoins/eurc-contract-addresses.md`; reads | both list `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`; `symbol()` "EURC", `decimals()` 6 |
| E-12 | USDC and EURC are admin-upgradeable proxies using the legacy zOS slots, not EIP-1967 | `eth_getStorageAt` at `keccak256("org.zeppelinos.proxy.implementation")`, `keccak256("org.zeppelinos.proxy.admin")`, and both EIP-1967 slots | USDC impl `0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6`, admin `0x49f78af090F1f98e7184B7f61f1F1a8a8064b40d`; EURC impl `0xECA045ED98a6D70887d2050F3BE1Fb0F0311017c`, admin `0x667B894BcC6899F5dF1EBA73c006b94c661A2d95`; EIP-1967 slots zero on both; proxy code carries `upgradeTo` selector `0x3659cfe6` |
| E-13 | Pause and blacklist roles are live on both | reads | USDC: `paused()` false, `pauser()` `0xbc639a0A060E5831a7c437b491B8d3C1f58F554e`, `blacklister()` `0x9338f53291715F1126291E28BBd3B9989e966572`; EURC: `paused()` false, `pauser()` `0x7A154EA9156D354504ad9A401380AA548039BE8b`, `blacklister()` `0xD08Bf5eB8663981C6af2fE3469e07b62ed6d469d`; both `version()` "2" |
| E-14 | **EURC implements EIP-3009 on Arc exactly as USDC does** (resolves an earlier unknown, for Arc Testnet) | reads; typehash computed from the EIP-3009 type string | USDC and EURC both return typehash 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267 from `TRANSFER_WITH_AUTHORIZATION_TYPEHASH()`, equal to the computed value; both implementations carry selectors `0xe3ee160e`, `0xcf092995`, `0xef55bec6`, `0x5a049a70`; `authorizationState(0x0, 0x0)` false on both |
| E-15 | Their EIP-712 domains bind chain id 5042002 | `DOMAIN_SEPARATOR()` read versus value computed from (name, version "2", 5042002, token) | USDC domain separator hash 0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0 = computed; EURC domain separator hash 0x649ec6b0634bd74f28684781d2c9ae49dff14ba3d5f9bb5d70c1e1f0e1ebf160 = computed |
| E-16 | Arc seeds a known blocklisted test address, and the blocklist is per token | contract-addresses.md; reads | "A value transfer to or from this address reverts at runtime"; `isBlacklisted(0x70997970C51812dc3A010C7d01b50e0d17dc79C8)`: USDC true, EURC false, cirBTC false; that account's code is a 23-byte EIP-7702 delegation designator `0xef0100…cafe` |
| E-17 | **Circle publishes cirBTC's Arc Testnet contract** (resolves an earlier draft's lead unknown) | `https://developers.circle.com/assets/cirbtc-contract-addresses.md`, linked from `https://faucet.circle.com` | table row "Arc Testnet `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`"; testnet cirBTC tokens "are not backed by real Bitcoin" |
| E-18 | What that contract is, read from the chain | reads; explorer `testnet.arcscan.app/api/v2/addresses/{address}` | `name()` "Circle Wrapped Bitcoin", `symbol()` "cirBTC", `decimals()` 8, `version()` "2", `paused()` false; `owner()` = `pauser()` = `blacklister()` = `0xf2e323A5F154D4FeD1D6be14c75A130fDa540bd5` (also the explorer's creator); `masterMinter()` `0x03d5Df8c0216bCE0Bf6Eb3438B75f66B50E172c6`; zOS impl `0x1D78868e73cAC95BA7036Eb3A0CCb13b88EDEb23`, admin `0xE1A6aEE7d850fa9C065830C964F843c309e1d335`; EIP-3009 typehash as E-14 |
| E-18b | cirBTC's domain binds chain id 5042002 | `DOMAIN_SEPARATOR()` versus computed ("Circle Wrapped Bitcoin", "2", 5042002, token) | domain separator hash 0x5b21e39ccfd3b6622b70bb0d9fcf3d9db5b5199a6c7491708831130adcc95250 = computed |
| E-19 | cirBTC has no published Arc mainnet contract | E-17's page; `https://developers.circle.com/assets/what-is-cirbtc.md` | mainnet table lists only Ethereum `0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E`; availability list says "Arc: testnet" |
| E-20 | Look-alikes outnumber the real token | `https://testnet.arcscan.app/api/v2/search?q=cirBTC` (the explorer Arc's docs name) | 50 unique token hits (pagination did not advance past them); 23 with symbol exactly `cirBTC`; 4 named exactly "Circle Wrapped Bitcoin", all 8 decimals: Circle's (E-17) plus `0x3120d73DA9691Ccb0bCea8e00d4C039086A32523`, `0x34792eAbf6bf8F827cB070db4016622e0341f21D`, `0x6dea8E463A6bfEB1acAb02f546E01990Bdf1D237`, from three creators; `certified` and `is_verified_via_admin_panel` false on all 50, Circle's included |
| E-21 | Canonical Permit2 is present and its domain binds 5042002 | contract-addresses.md; reads | `0x000000000022D473030F116dDEE9F6B43aC78BA3` 9152 bytes; Permit2 domain separator hash 0xe59c8d3fa907f1186bfa334839eb895f53f88b07e4cf5aafaef4af163d83ce93 = computed ("Permit2", 5042002, address) |
| E-44 | Arc forbids aliasing the native-asset sentinel to USDC | stablecoin-native-model.md | "Don't alias the EIP-7528 native-asset sentinel" |
| E-47 | One ERC-20 USDC transfer emits two `Transfer` logs | stablecoin-native-model.md | "a single ERC-20 transfer emits both; match on the emitter address" |

### 1.3 Payment rails, oracles, bridge, and administration

| Id | Fact | Source | Quote, JSON path, or read result |
|---|---|---|---|
| E-22 | **x402's canonical `x402ExactPermit2Proxy` has no code on Arc Testnet** | `github.com/coinbase/x402`, `specs/schemes/exact/scheme_exact_evm.md`; `eth_getCode` | spec: "will be deployed to the same address across all supported EVM chains"; `0x402085c248EeA27D92E8b30b2C58ed07f9E20001` → 0 bytes |
| E-23 | x402 relies on the token to refuse a reused nonce | `specs/x402-specification-v2.md` §10.1 | "EIP-3009 contracts inherently prevent nonce reuse at the smart contract level" |
| E-24 | x402 `exact` binds six flat fields, none naming a quote | `scheme_exact_evm.md`, example JSON path `payload.authorization` | keys `from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`; "the Facilitator cannot modify the amount or destination" |
| E-25 | x402 idempotency is an opt-in extension | `specs/extensions/payment_identifier.md` | "Same `id`, different payload" → "Return 409 Conflict"; the resource server "May use `id`" |
| E-26 | x402 `upto` binds the facilitator and settles once | `specs/schemes/upto/scheme_upto_evm.md` | "binds the authorization to a specific facilitator"; "Each authorization can only be settled once." |
| E-27 | x402 receipts are privacy-minimal by default | `specs/extensions/extension-offer-and-receipt.md` | "intentionally omits transaction references to reduce correlation risk" |
| E-28 | Circle Nanopayments: its own signing domain, EOAs only, serve-before-settle | `https://developers.circle.com/gateway/nanopayments.md`; `.../nanopayments/concepts/x402.md`; `.../nanopayments/concepts/batched-settlement.md` | "require EOA signatures and do not support ERC-1271"; signed "against the `GatewayWalletBatched` domain"; "The seller serves the resource immediately, without waiting for onchain settlement." |
| E-29 | Gateway batches are authorized by an enclave key | batched-settlement.md | "Gateway uses an AWS Nitro Enclave"; the wallet "verifies the TEE's signature before executing any batch" |
| E-30 | GatewayWallet on Arc Testnet | contract-addresses.md; reads of `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `domain()` 26; `paused()` false; `withdrawalDelay()` 1209600 (its unit was not established here); `isTokenSupported(USDC)` true; `isTokenSupported(EURC)` **false**; EIP-1967 impl `0xa33d52b46964495ea6e2bb09ce85faed05776e28` |
| E-31 | CCTP MessageTransmitterV2 on Arc Testnet: two attesters, both required, upgradeable | reads of `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | `localDomain()` 26; `signatureThreshold()` 2; `getNumEnabledAttesters()` 2; `paused()` false; EIP-1967 impl `0xa849059bc1f6fff867ef77bed6fa874f77a62466`, admin `0x6fe5a0d122e8b812a250037b15aa31d8b78679d0` |
| E-32 | CCTP finality levels, burn expiry, and Arc's role | `https://developers.circle.com/cctp/references/technical-guide.md`; `.../cctp/concepts/supported-chains-and-domains.md` | thresholds "Confirmed" 1000, "Finalized" 2000; "An expiration block 24 hours in the future is encoded in the message"; Arc testnet row: fast-transfer source "N/A", domain 26 |
| E-33 | **Chainlink's directory lists an "Arc Mainnet" network with 30 feeds** | `https://docs.chain.link/data-feeds/price-feeds/addresses` → `rddUrl` `https://reference-data-directory.vercel.app/feeds-arc-mainnet.json` | `[name="EURC / USD"]`: `proxyAddress` `0x361b95c10b76Ca3f35C686d423e43A951755Bf23`, `heartbeat` 86400, `threshold` 0.5, `docs.attributeType` "dex_state_price"; `[name="USDC / USD"].proxyAddress` `0x84EA90AC252Dc437031461836DB5164219147905`; `[name="cirBTC Reserves"].proxyAddress` `0xEB0884a871ea1f6483B5FC10fd3D7dC5806411fc`, `docs.productType` "Proof of Reserve"; none read on-chain (E-04) |
| E-34 | Chainlink lists no Arc Testnet feeds | same page | the "arc" section holds one network, "Arc Mainnet"; zero matches for "Arc Testnet" |
| E-45 | Gateway's crosschain fee; same-chain is free | `https://developers.circle.com/gateway/references/fees.md` | "percentage-based fee of **0.005%**"; same-chain withdrawals "do not incur the transfer fee" |
| E-46 | Arc's oracle page names providers, not Arc feed addresses | `https://docs.arc.io/arc/tools/oracles.md` | providers listed: Chainlink, Chronicle, Pyth, RedStone, Stork; no Arc address on the page |
| E-42 | Safe's registry lists Arc Testnet, and the deployed bytecode matches it | `github.com/safe-global/safe-deployments` (commit `7b1fb6d615ab`), `src/assets/v1.4.1/*.json`, `v1.5.0/*.json`; `eth_getCode` + keccak | `networkAddresses["5042002"]` = "canonical" (also present for key "5042"); on-chain codehash equals `deployments.canonical.codeHash` for SafeL2 1.4.1 `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`, SafeProxyFactory 1.4.1 `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, SafeL2 1.5.0 `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e`, SafeProxyFactory 1.5.0 `0x14F2982D601c9458F93bd70B218933A6f8165e7b` |

**Counted:** 49 evidence rows (E-01 to E-48 plus E-18b), every one tied to a primary URL or a chain
read made today. Nothing in this ledger was taken from a sibling file.

## 2. Actors and trust boundaries

| Actor | Trusted for | Never trusted for |
|---|---|---|
| Payer | signing its own authorization over its own funds | naming the merchant, the price, the output, or the destination |
| Merchant | signing its own half of a quote | the payer's identity or funds |
| Relayer, checkout, or any `settle()` submitter | paying gas and ordering a transaction whose content it did not author | choosing any field of the payment — Advisory 001 is the proof of what happens otherwise (§4.2) |
| x402 facilitator, or Circle Gateway acting as one | broadcasting an authorization it cannot alter (E-24) | liveness, honesty of a `success` flag, or anything UNICA's order binds that x402 does not (E-24) |
| RPC provider | reporting state honestly most of the time | being the sole witness for an irreversible decision (E-01) |
| Arc validators (PoA, BFT) | finality once more than two-thirds pre-commit (E-35) | anything application-level; safety assumes fewer than one third are faulty |
| Token issuer (Circle, for USDC, EURC, cirBTC) | the token's supply and roles, which it controls through upgrade, pause and blacklist (E-12, E-13, E-18) | leaving the implementation, the pause state, or any address's blocklist status unchanged |
| CCTP attesters, Gateway enclave | signing burns (2-of-2, E-31) and batches (E-29) | being uncompromisable; both are single points UNICA does not operate |
| UNICA Safe and pauser | administration; the pauser halts, only the Safe unpauses (UNICA decision, `DECISIONS.md` item 70, lead) | bypassing caps or the order binding |

Every threat below is one of these actors reaching past its left-hand column.

## 3. Threat → mitigation → test

### 3.1 Identity: token, chain, decimals, issuer powers

| # | Threat | Arc evidence | Mitigation | Test |
|---|---|---|---|---|
| T01 | **Fake look-alike token.** A market, a checkout, or an agent resolves "cirBTC" (or "USDC") by name, symbol or explorer label and lands on an impostor | 23 tokens use the symbol `cirBTC` and 4 use Circle's exact name and decimals; the explorer marks none of them, Circle's included, as certified (E-20). Only `0xf0C4…2BF` is Circle's (E-17) | Token identity is the pair (chain id, address), pinned per market in a reviewed settings file. `name()`, `symbol()`, `decimals()`, explorer labels and token lists are display data, never lookup keys. Admission also pins the proxy's implementation and admin (E-12, E-18) and refuses if either moves. **No BTC market is enabled on Arc**: the only Circle cirBTC there is a testnet token "not backed by real Bitcoin" (E-17), and no Arc mainnet contract is published (E-19) | PROPOSED `test/arc/TokenAdmission.t.sol` on an Arc fork: the three look-alikes in E-20 are refused although their name, symbol and decimals equal Circle's; Circle's own address is refused while the BTC-market flag is off; control: USDC `0x3600…0000` is admitted |
| T02 | **Native-sentinel aliasing.** A router maps `0xEeee…EEeE` or `address(0)` to `0x3600…0000`, or pairs native USDC against ERC-20 USDC as two assets | Arc says not to alias the sentinel (E-44) and that native and ERC-20 USDC are one balance (E-10) | A market declares its USDC leg as native (`msg.value`, 18 decimals) or ERC-20 (`0x3600…0000`, 6 decimals), never both. A pool or market pairing the two is refused at load. A same-asset USDC payment is a direct transfer and never a swap | PROPOSED unit test over the Arc routing table: sentinel and zero address never resolve to `0x3600…0000`; a native-versus-ERC-20 USDC pair fails to load |
| T03 | **Wrong chain, or premature mainnet.** A signature, read or deployment built for one Arc network is used on another, or UNICA acts on a mainnet whose identity Arc has not published | Arc's docs publish no mainnet RPC or addresses (E-02); Arc is in private mainnet (E-03) and its mainnet explorer is login-gated (E-04). Circle's node repository names mainnet 5042 (E-48), as do Uniswap's SDK (E-05) and Safe's registry keys (E-42), but nothing public can yet read it back. EIP-712 domains bind 5042002 (E-15, E-18b, E-21) | The chain id the RPC reports must equal the settings file, before any other read. **Arc mainnet stays disabled** until Arc's docs publish an RPC and a read from it returns 5042 (E-48). Every UNICA signature is EIP-712 with `chainId` and the verifying contract in its domain, so an Arc Testnet signature cannot settle on any other chain | RAN `integrations/arc-treasury/test.mjs` row "requireArc refuses a non-Arc chain id" (177 of 177 checks passed). LAB `test_RevertWhen_arcChainIdIsNotArcTestnet`, `test_RevertWhen_sepoliaChainIdIsWrong`. PROPOSED: one authorization's digest computed under 5042002 and under 5042 must differ, and the 5042 digest must be refused on a 5042002 fork |
| T04 | **Wrong decimals.** 18-decimal native USDC, 6-decimal ERC-20 USDC or EURC, and 8-decimal cirBTC are mixed, or a credit is recorded from the truncated 6-decimal view | E-09, E-10, E-11, E-18; a zero `balanceOf` does not mean a zero native balance (E-10) | A scale is read from `decimals()` of the exact interface in use, never assumed. Native and ERC-20 amounts are distinct types that refuse to combine. Credits are recorded from the native 18-decimal amount or from the measured balance delta, never from a truncated view | RAN `integrations/arc-treasury/test.mjs` (the type-mix refusals are part of the 177). LAB `test_RevertWhen_tokenDecimalsAssumeADifferentScale`. RAN `test_A2_the_pool_prices_raw_units_and_ignores_decimals` |
| T05 | **Malicious or upgradeable token.** An issuer-side upgrade adds a fee, a hook, a freeze or a new transfer rule after UNICA admitted the token | USDC, EURC and cirBTC on Arc are all admin-upgradeable proxies with live pause and blacklist roles (E-12, E-13, E-18). They use the legacy zOS slots with EIP-1967 empty (E-12, E-18), so a prober that reads only EIP-1967 reports "not a proxy" | Treat every Arc token as upgradeable. Admission records (implementation, admin) from **both** slot families; a pre-quote check re-reads the implementation slot and `paused()` and refuses on any change until a human re-admits. Per-order and per-market caps bound what one upgrade can reach | PROPOSED `test/arc/TokenPin.t.sol` on an Arc fork: both slot families are read; USDC, EURC and cirBTC are classified upgradeable; a `vm.store` of a new implementation makes admission refuse; control: the unchanged token passes |
| T06 | **Issuer freeze and blocklist.** A blacklister freezes the payer, the merchant, or UNICA's executor mid-flow; a native transfer touching a blocklisted address reverts and still charges gas | E-13, E-16, E-38; the blocklist is per token — one address is blocked on USDC and not on EURC or cirBTC (E-16); Arc's pages disagree on whether a receipt exists (E-39) | Before quoting and again before settling, read `isBlacklisted` on the exact token for payer, recipient and executor; checking one token says nothing about another. An order that cannot complete expires to a refund path that needs no admin. A submission with no receipt is UNKNOWN and is reconciled from chain state, never assumed failed and retried | PROPOSED Arc-fork test using the docs' blocklisted address `0x7099…79C8` as payer and then as recipient: settlement refuses before any transfer with a named error; control with an unlisted address settles |

### 3.2 Authorization, replay, and substitution

| # | Threat | Arc evidence | Mitigation | Test |
|---|---|---|---|---|
| T07 | **Allowance theft.** A standing `approve` to a relayer, facilitator or look-alike spender drains more than one payment | USDC, EURC and cirBTC on Arc implement EIP-3009 (E-14, E-18); canonical Permit2 is present (E-21); **the canonical x402 Permit2 proxy is not** (E-22) | Prefer EIP-3009 `transferWithAuthorization` or `receiveWithAuthorization`: single use, exact `to`, exact `value`, bounded window. No unlimited `approve` in any Arc flow. A Permit2 allowance goes only to canonical Permit2, spent through a witness-bound transfer. **x402's Permit2 method is disabled on Arc** while the canonical proxy has no code there: any "x402 proxy" offered at another address is an unverified spender by construction. Gateway deposits are sized to the session, since an exit without Gateway's cooperation waits out `withdrawalDelay` (E-30) | RAN `test_Gate0_Permit2_TheUNUSEDCeilingCannotBeReplayed`. PROPOSED: a grep gate over Arc scripts and contracts that fails on `approve(` with `type(uint256).max`; a config test that refuses x402 `permit2` on 5042002 while `eth_getCode(0x4020…0001)` is empty |
| T08 | **Permit replay** across quotes, orders or chains | Token-level nonces (E-14, E-23); domains bind 5042002 and the verifying contract (E-15, E-21) | Three independent locks: the token's or Permit2's nonce, UNICA's consumed-quote map, and an order status that leaves `Open` before any external call. None substitutes for another | RAN `test_Refuse_ASettledQuoteCannotBeSettledAgain`, `test_Refuse_APayerAuthorisationForAnotherQuote`, `test_Gate0_Permit2_AnExpiredAuthorisationIsRefused`, `test_Admit_AConsumedInvoiceCannotBeDischargedAgain`, `test_B7_refuses_a_replayed_order`, `test_RevertWhen_OrderPaidTwice`. LAB `test_RevertWhen_envelopeNonceIsReplayed`, `test_RevertWhen_theSameEnvelopeIsSettledTwice`. PROPOSED on an Arc fork: a second `transferWithAuthorization` with a spent nonce reverts at the USDC contract itself, and `authorizationState` reads true afterwards |
| T09 | **x402 replay and cross-domain confusion.** A spent x402 authorization is resubmitted, or a Circle Nanopayments authorization is offered where a token-domain authorization is expected, or the reverse | Replay protection sits in the token (E-23) plus `validBefore`; Nanopayments signs against a different domain, `GatewayWalletBatched` (E-28) | Accept each authorization only for the domain it was signed under; a Gateway authorization is never treated as a UNICA order authorization, and a UNICA envelope is never forwarded to Gateway. Reject anything whose `validBefore` is past or whose window exceeds the order's own deadline | LAB `test_RevertWhen_aCircleGatewayAuthorizationIsOfferedAsAnEnvelope`, `test_RevertWhen_envelopeHasExpired`. PROPOSED Arc-fork row for the token-level nonce, as T08 |
| T10 | **Duplicate API fulfilment.** One payment unlocks the resource twice, or a retry pays twice for one request | x402 idempotency is an opt-in extension and a "May" for servers (E-25); with Gateway the seller serves before on-chain settlement (E-28) | A UNICA resource server sets `payment-identifier` to `required: true` and keys fulfilment on (identifier, payload hash), and separately on the authorization nonce, so a new identifier cannot re-spend an old payment. Under Gateway, a served request stays "pending" in the ledger until the batch that includes it is observed on-chain | PROPOSED server tests: same id and payload → cached response; same id, new payload → 409; no id → 400; a known nonce under a new id → refused; a Gateway-pending item is not counted as paid |
| T11 | **Merchant substitution.** Whoever submits rewrites the merchant's half — recipient, signer, output, pool — and spends the payer's unchanged authorization | Advisory 001 (§4.2). x402 `exact` binds six flat fields; `to` is its only merchant field and there is no quote digest (E-24) | Advisory 001's recommended fix A: bind the full EIP-712 quote digest into the payer's witness, delivered as an rc2 (owner decision). On Arc, an x402 leg collects a same-asset USDC payment to a `payTo` that is UNICA's order-bound executor, never a relayer-chosen address; the order commitment is bound on UNICA's side, not assumed from x402 | RAN `test_KNOWN_DEFECT_APayerAuthorisationFundsAnyMerchantsQuote` (characterization of the open defect) and `test_Config_AQuoteSignedAgainstOneResolutionDoesNotSettleAnother`. LAB `test_RevertWhen_merchantRecipientDoesNotMatchTheConfigHash` |
| T12 | **Payer substitution.** Someone other than the bound payer settles, or settles on the payer's behalf, a payer-bound order | Arc adds two ways for `msg.sender` to be the payer without the payer being an EOA calling directly: CallFrom relays (E-40) and EIP-7702 delegated accounts, one of which Arc itself seeds (E-16) | `WrongPayer` (§4.1): the executor compares the caller's identity to the bound payer and reverts with a named error. It must stay an identity check — no `tx.origin`, no "is an EOA" code-size test, both of which break under E-40 and EIP-7702 without adding safety | RAN `test_B5_refuses_the_wrong_payer_when_bound`, `test_Refuse_AnAuthorisationSignedByTheWrongPayer`. PROPOSED under `arc-anvil`: the bound payer settling through Multicall3From succeeds; a stranger doing the same is refused with `WrongPayer` |

### 3.3 Pricing and liquidity — only where a conversion occurs

A same-asset USDC order has no price, no pool and no oracle, and carries none of these rows.

| # | Threat | Arc evidence | Mitigation | Test |
|---|---|---|---|---|
| T13 | **Quote manipulation.** A stale, forged or narrowly-bound quote settles at a price the merchant never offered | The quote is UNICA's own; Arc adds nothing that binds it (E-24) | Merchant-signed EIP-712 quote with deadline, config hash and policy version, bound in full into the payer's witness (Advisory 001 fix, rc2). The quote names its price source and the source's timestamp; a quote older than the market's maximum age is refused at settlement, not only at signing | RAN `test_Refuse_AnExpiredQuote`, `test_Config_AQuoteSignedAgainstOneResolutionDoesNotSettleAnother`. PROPOSED: a quote whose recorded price timestamp is older than the market's maximum age is refused at settlement |
| T14 | **Pool manipulation.** A flash-funded or sandwiching trade moves a thin pool just before UNICA's swap | Uniswap's deployments page lists no Arc chain (E-06) and the Ethereum and Sepolia PoolManager addresses are empty on Arc Testnet (E-07). A PoolManager for chain 5042 appears in Uniswap's SDK (E-05) and a Uniswap playbook marks its verification pending (E-08); no public read path exists (E-04). Chainlink's EURC/USD feed on Arc Mainnet is typed "dex_state_price" (E-33), so it is itself derived from DEX state | No pool is used on Arc until its PoolManager is read on-chain from a public Arc RPC and its depth is measured. A PoolManager that UNICA deploys itself is described as UNICA-deployed, never as Uniswap's. The pool price is bounded against an oracle; where the oracle is also derived from DEX state, the band is not independent and a second, non-DEX source is required or the pair stays off. Exact-output with `maxIn` bounds the payer's loss | LAB `test_RevertWhen_exactOutputCostsMoreThanTheMaximumInput`, `test_RevertWhen_thePoolReturnsLessThanTheBatchAuthorized`, `test_RevertWhen_poolManagerIsWrong`. BLOCKED on a verifiable Arc pool: a fork test that moves the pool beyond the band and expects refusal |
| T15 | **Stale or wrong oracle.** Settlement uses a price older, or further off, than the market tolerates | No Chainlink feed exists on Arc Testnet (E-34). Arc Mainnet feeds are listed with a 24-hour heartbeat and a 0.5% deviation threshold (E-33), unreadable on-chain today (E-04) | Every Arc market with a non-USDC leg is **disabled on testnet by construction** and fails closed, with no demonstration-rate fallback (UNICA decision, `DECISIONS.md` "Oracle", lead). On mainnet, a feed is admitted only after its proxy is read on-chain; each read checks `answer > 0`, `updatedAt` within the market's maximum age, and the feed's own `decimals()`. Because a feed may sit up to 0.5% off for up to 24 hours without updating (E-33), the market's slippage band must exceed 0.5% or the market is refused | PROPOSED market-config test: an Arc market whose oracle address is unset or empty fails to initialize. BLOCKED for mainnet: a fork test reading the E-33 proxies and refusing an `updatedAt` older than the maximum age |
| T16 | **Low liquidity.** A correctly priced but thin pool imposes unbounded percentage slippage | E-05 to E-08: no verified Arc pool exists | Measure depth immediately before quoting; cap each order as a fraction of measured depth; a pool UNICA seeded does not count as market depth, because UNICA chose that number | RAN `test_RevertWhen_DustYieldsNoOutput_NothingMoves`. PROPOSED unit test: expected slippage computed from stated reserves is refused above a configured basis-point bound |
| T17 | **Fee-on-transfer or rebasing token.** The amount that arrives differs from the amount stated | No Arc Circle token charges a fee today, but all three are upgradeable (E-12, E-18), so one could later | Measure every transfer by balance delta at the recipient and revert on any shortfall against the committed floor; never trust a stated amount | RAN `test_D1_a_fee_on_transfer_input_is_refused_by_the_executor`, `test_RevertWhen_RecipientReceivesLessThanTheMinimum_FeeOnTransfer` |

### 3.4 Contract mechanics on Arc's EVM

| # | Threat | Arc evidence | Mitigation | Test |
|---|---|---|---|---|
| T18 | **Reentrant callbacks.** A token, hook or PoolManager callback re-enters settlement mid-flight | Upgradeable tokens could gain callbacks (E-12); CallFrom relays preserve the original sender (E-40) | UNICA's existing pattern carries over unchanged: the order leaves `Open` before any external call (`src/SettlementExecutor.sol`, invariant I5), a transient latch in the experimental executor, and the V2 "settlement already in progress" guard. No native USDC value is pushed to a contract inside settlement, because on Arc such a send can revert for reasons Ethereum does not have (E-38) | RAN `test_ReentrantPaymentOfTheSameOrderIsRefusedByItsState`, `test_ReentrantPaymentOfAnotherOrderIsRefusedByTheRouterLock_AndStaysPayable`, `test_Adv_TheContextTheReentrantCallSeesIsTheOuterOne`. LAB `test_B4_03_theWholeReentrancySurface`. PROPOSED: the same four rows re-run unmodified under `arc-anvil` |
| T19 | **Ethereum assumptions that Arc breaks.** Value to `address(0)` as a burn, `SELFDESTRUCT` beneficiaries, sends to precompiles, `PREVRANDAO` as entropy, strictly increasing timestamps | E-38; `SELFDESTRUCT` moves a contract's USDC because USDC is its native balance (same page) | No value to `address(0)`; no `SELFDESTRUCT` in any Arc contract; no randomness from `PREVRANDAO`; order by block number; deadlines tolerate equal timestamps across consecutive blocks | PROPOSED `arc-anvil` suite: one row per rule on the E-38 page against a minimal settlement stub, each asserting Arc's documented outcome; PROPOSED grep gate failing on `PREVRANDAO`, `block.prevrandao`, `block.difficulty` or `selfdestruct` in Arc sources |
| T20 | **Silent drop and stuck state.** A transaction under the fee floor never appears, and the caller retries with a fresh authorization, so two payments exist for one order | E-36: silent drop under 20 gwei; E-39: receipt presence after a blocklist revert is disputed | `maxFeePerGas` at or above the documented floor; the order state machine holds a submitted-but-unconfirmed payment as UNKNOWN until chain state resolves it; a replacement reuses the same nonce, never a new authorization | PROPOSED: a relayer unit test that submits under the floor, sees no receipt, and must land in UNKNOWN rather than in failed or paid |

### 3.5 Infrastructure: facilitator, RPC, finality, bridge

| # | Threat | Arc evidence | Mitigation | Test |
|---|---|---|---|---|
| T21 | **Compromised or failing facilitator.** An x402 facilitator, or Circle Gateway, withholds a signed authorization, reports `success` it never broadcast, or settles late | A facilitator cannot change amount or destination (E-24) but liveness is not promised. Under Nanopayments the seller serves before settlement (E-28) and a batch is valid if an enclave key signs it (E-29); an exit without Gateway waits `withdrawalDelay` (E-30). `upto` can bind a facilitator in the witness (E-26) | A UNICA order is marked paid only from chain evidence: the settlement transaction's receipt and the `Transfer` log from the expected emitter, de-duplicated per E-47. A facilitator's `success` is a hint, never a state change. Self-facilitation is the default where the merchant accepts the gas; Gateway exposure is capped per session and a Gateway-pending item is unpaid | PROPOSED: a mock facilitator returning `{success: true}` without broadcasting leaves the order unpaid; a second mock that broadcasts a different `to` is refused by the log check |
| T22 | **Compromised or lying RPC.** A provider reports a wrong chain id, balance, receipt or block | Four keyless providers agreed on chain id and one block hash today (E-01); that agreement is a snapshot | Read critical values (chain id, block hash at N, the settlement receipt) from two providers operated by different parties; any disagreement halts. Keyed provider URLs never reach logs or files | RAN `integrations/arc-treasury/test.mjs` rows "an endpoint renders as its origin only" and "requireArc refuses a non-Arc chain id". PROPOSED dual-RPC comparator that refuses on a mismatched block hash |
| T23 | **Reorgs and finality assumptions.** Ethereum-style confirmation counting is carried over, or Arc's finality is trusted beyond what it rests on, or an inbound message from a slower chain is trusted too early | Arc: final on commit, no reorganization risk, BFT under a PoA set (E-35). CCTP separates "Confirmed" 1000 from "Finalized" 2000 (E-32) | On Arc, act after inclusion — no confirmation-count wait. The safety claim rests on fewer than a third of validators being faulty, a governance assumption rather than a cryptographic one, so value caps still apply. Any value arriving from another chain is credited only at `finalityThresholdExecuted` ≥ 2000 | PROPOSED: a CCTP receiver unit test refusing to credit a message whose executed threshold is below 2000; a reconciliation test that halts if two reads of one Arc block disagree |
| T24 | **Bridge or CCTP failure.** A burn with no mint, an expired burn, a front-run of `receiveMessage`, or an attester compromise | Arc Testnet MessageTransmitterV2 requires 2 signatures from 2 enabled attesters and is an upgradeable proxy (E-31); fast burns expire after 24 hours and can be re-attested (E-32); Arc Testnet is not a fast-transfer source (E-32) | Never credit a merchant or complete an order before the mint is observed on Arc. Set `destinationCaller` to UNICA's own receiver so no third party can front-run delivery. Treat burn-without-mint as pending, with a re-attestation runbook. Cap inbound bridged value, since a compromise of both attester keys, or an upgrade of the transmitter, is outside UNICA's control | PROPOSED Arc-fork test: a `depositForBurn` with no matching `receiveMessage` leaves the order pending; completion is gated on the Arc-side mint read, not on the source-chain event |

### 3.6 Keys, administration, and the Safe

| # | Threat | Arc evidence | Mitigation | Test |
|---|---|---|---|---|
| T25 | **Key compromise.** A deployer, admin, pauser, relayer or facilitator key leaks; or an issuer key does | Issuer powers over USDC, EURC and cirBTC sit with Circle-held roles (E-12, E-13, E-18); the testnet cirBTC's owner, pauser and blacklister are one address (E-18) | UNICA decisions carried over (leads): a fresh deployment EOA funded only for gas, administration moved to a Safe at once, a pauser that may pause and never unpause, and an incident procedure of pause, notice, preserve, investigate, redeploy. Research tooling holds no key: the Arc treasury module permits read methods only. Issuer-key compromise is unmitigable by UNICA and is bounded only by caps and by the pre-quote `paused()` and implementation re-read (T05) | RAN `integrations/arc-treasury/test.mjs`: its permitted-method list admits only read RPC methods. PROPOSED pause drill on an Arc fork: pauser pauses, pauser cannot unpause, only the Safe unpauses |
| T26 | **Safe misconfiguration.** Wrong factory or singleton, low threshold, unverified signers, or a Safe that silently cannot do what the flow needs | Canonical SafeL2 and factory bytecode on Arc Testnet match Safe's registry by codehash (E-42). A Safe transaction's `value` moves native USDC at 18 decimals (E-10). Nanopayments refuses ERC-1271, so a Safe cannot be a Nanopayments buyer (E-28) | Deploy only through a registry-listed factory whose codehash was read and matched; threshold of at least 2 over hardware-held keys; a readback of chain id, address, owners and threshold before any value. Signers review `value` as USDC with 18 decimals. Safe-held funds use EIP-3009, Permit2, or direct transfers, never Nanopayments. **Mainnet is BLOCKED** on the owner (`DECISIONS.md` item 64, lead) | BLOCKED on the owner: a Safe readback checked against safe-deployments, then one pause-and-unpause test transaction. The testnet codehash match in E-42 is the first half, done read-only |

### 3.7 Economics and privacy

| # | Threat | Arc evidence | Mitigation | Test |
|---|---|---|---|---|
| T27 | **Rounding and dust extraction.** Repeated rounding in one party's favour accumulates, especially at the 6-decimal truncation of native value | Sub-micro-USDC amounts are invisible to `balanceOf` (E-10) | Record in native 18-decimal units or measured deltas; every rounding is fixed in direction and against the claimant; a settlement that yields zero output moves nothing | RAN `test_RevertWhen_DustYieldsNoOutput_NothingMoves`. PROPOSED fuzz: across random amounts, no round trip extracts more than one raw unit |
| T28 | **Tiny-payment DoS.** Spam of sub-cent on-chain payments or orders burns a merchant's or relayer's gas | At the 20 gwei floor one ERC-20 USDC transfer costs about 0.000982 USDC (E-37): a $0.001 on-chain payment spends roughly 98% of itself on gas | A minimum on-chain settlement amount per market; below it, batching only (Gateway, E-28, or a UNICA batch design); per-request and per-session ceilings; per-payer rate limits at the resource server. The UNICA fee stays 0; the floor is a gas rule, not a fee | LAB `test_RevertWhen_anItemExceedsThePerRequestCeiling`, `test_RevertWhen_theSessionCeilingWouldBeExceeded`. PROPOSED policy test: a single on-chain settlement below the configured floor is refused |
| T29 | **Privacy leakage from per-request payments.** Each on-chain payment links payer to merchant with a timestamp, and request identifiers leak into public data | Every USDC movement emits public `Transfer` logs (E-47); the Memo predeploy emits public events (E-40); x402 receipts omit transaction references by default (E-27); Arc's confidential sector exists but was not assessed (E-43) | Batch where possible; default to the privacy-minimal receipt; never place a request id, email or other off-chain identifier in calldata or a Memo; treat the confidential sector as unassessed until it is evaluated on its own | PROPOSED: a resource-server test asserting the default receipt has no transaction field; a static check that no Arc code path writes request identifiers into calldata or Memo payloads |

## 4. Mandatory regression rows

Both rows bind any Arc-side settlement shape, whatever it turns out to be. They are re-proven
against each new shape, never inherited by assumption.

### 4.1 `WrongPayer`

| | |
|---|---|
| Threat | A caller other than the order's bound payer settles it, whether directly, through a CallFrom relay (E-40), or from an EIP-7702 delegated account (E-16) |
| Standing rule | UNICA decision (`DECISIONS.md` item 111, lead): every order binds an explicitly named payer; only that payer may settle it; `WrongPayer` is preserved |
| Mitigation | An identity comparison of the caller against the bound payer, reverting with the parameterized error `WrongPayer(orderId, bound, caller)` (`src/experimental/robinhood-testnet/UnicaStockSettlementErrors.sol:30`, raised at `UnicaStockSettlementExecutor.sol:153`). A silent no-op or an unnamed revert does not satisfy this row |
| Test — RAN 2026-09-11 | `test/experimental/StockSettlement.t.sol::test_B5_refuses_the_wrong_payer_when_bound` — a funded, approved stranger is refused with the exact selector and arguments. Companion V2 row `test/v2/SettlementRefusals.t.sol::test_Refuse_AnAuthorisationSignedByTheWrongPayer`. Both passed |
| Arc requirement | Before any Arc executor holds more than testnet value: the same row, plus the two PROPOSED `arc-anvil` variants in T12 (the payer through Multicall3From succeeds; a stranger through it is refused) |

### 4.2 Advisory 001 — the payer's witness does not bind the merchant's half

| | |
|---|---|
| Threat | Whoever submits `settle()` rebuilds the quote with their own `merchantSigner` and `recipient`, and a raised `amountOut`, signs it with their own key, and spends the payer's unchanged authorization up to its full `maxIn` |
| Status | **OPEN, reproduced, not fixed**, Critical. Affects `src/v2/QuoteSettlementExecutor.sol` at `v2.0.0-rc1`, which has never been deployed (`docs/v2/SECURITY-ADVISORY-001.md`) |
| Root cause | The payer's Permit2 witness binds six payer-side fields; ten merchant-side fields, the quote digest among them, sit outside it, so two quotes differing only in the merchant's half share one payer digest |
| Why Arc sharpens it | x402's `exact` authorization is narrower still: six flat fields with no quote digest (E-24). Wiring stock x402 straight into a payer-bound order would reproduce this defect one layer up. On Arc the Permit2 route of x402 is additionally unavailable at its canonical proxy (E-22), so the only stock route is EIP-3009, whose `to` is the single merchant-side field it carries |
| Test — RAN 2026-09-11 | `test/v2/WitnessBinding.t.sol`, six rows, all passed: `test_Control_TheQuoteIdMovesTheWitness`, `test_Control_EveryWitnessedFieldMovesTheWitness`, `test_TheMerchantHalfIsOutsideThePayerWitness`, `test_KNOWN_DEFECT_APayerAuthorisationFundsAnyMerchantsQuote`, `test_KNOWN_DEFECT_TheHonestSettlementCannotFollow`, `test_Control_AnHonestSettlementStillSucceeds`. The two `KNOWN_DEFECT` rows are characterization tests: they pass because the defect is still present, and a correct fix must turn them red |
| Fix | Option A, delivered as rc2: hash the full EIP-712 quote digest into the payer's witness. An owner decision; it moves the payer's signing digest |
| Arc requirement | No Arc quote or settlement design binds less than the full order commitment into the payer's signature. Its design review re-runs the "two quotes differing only in the merchant's half" check against its own authorization shape, using the two `KNOWN_DEFECT` rows as the template. If x402 fronts a UNICA order, x402 collects a same-asset USDC payment to UNICA's order-bound executor and UNICA binds the order itself |

## 5. What was executed on 2026-09-11

Every RAN and LAB entry above was run today, locally, offline, with no RPC and no fork. Compiler
output and cache were written outside the repository, and `git status` was identical before and
after the runs.

| Run | Selection | Result |
|---|---|---|
| `forge test --offline --match-path test/v2/WitnessBinding.t.sol` | the six Advisory 001 rows | 6 passed, 0 failed |
| `forge test --offline --match-test <17 names>` | WrongPayer, replay, reentrancy, fee-on-transfer, dust, chain id, decimals, Gateway-domain rows | 17 passed, 0 failed, across 7 suites |
| `forge test --offline --match-test <17 more names>` | expiry, consumed-invoice, config binding, ceilings, pool and token mismatch rows | 17 passed, 0 failed, across 7 suites |
| `node integrations/arc-treasury/test.mjs` | the Arc treasury module's offline suite | 177 checks run, 177 passed, 0 failed |

**Totals: 40 Solidity tests run, 40 passed; 177 JavaScript checks run, 177 passed.**

What these runs do **not** show, stated so the green is not over-read:

- None ran on Arc's EVM. They run on a standard local EVM, which Arc's docs say cannot reproduce
  Arc's behaviour (E-41). They prove UNICA's logic, not Arc compatibility.
- The two `KNOWN_DEFECT` rows pass because the defect exists. Their green is evidence of the bug.
- LAB rows exercise laboratory contracts in `src/lab/`, and the four `StockSettlement.t.sol` rows
  exercise the experimental executor in `src/experimental/`. Neither is a release contract.
- No test in this repository yet exercises an Arc-specific rule: blocklist reverts, CallFrom sender
  preservation, the fee floor, or the zOS proxy slots. Every such row above is PROPOSED.

## 6. Corrections to earlier notes (leads) made by today's primary reads

| Earlier note | What the primary source or chain shows today |
|---|---|
| `TOKENS.md` §5 lists `0xf0C4…2BF` as "UNKNOWN issuer", and an earlier draft of this file kept cirBTC's Arc address as unpublished | Circle's developer docs publish it as cirBTC on Arc Testnet (E-17); the chain shows a FiatToken-style upgradeable proxy with 8 decimals and EIP-3009 (E-18). It stays testnet-only and unbacked, and no Arc mainnet address exists (E-19), so the BTC market stays off |
| `LIQUIDITY-ORACLES.md` says Chainlink's addresses page has no Arc entry | The same page carries an "Arc Mainnet" network whose directory JSON lists 30 feeds, EURC/USD, USDC/USD and cirBTC Proof of Reserve among them (E-33). None is readable on-chain yet (E-04), and there is still no testnet feed (E-34) |
| `X402.md` and an earlier draft of this file treat `0x4020…0001` as the usable Permit2 spender for x402 | It has no code on Arc Testnet (E-22) |
| Earlier draft: EURC's EIP-3009 support reported only by secondary sources | EURC on Arc Testnet exposes the EIP-3009 typehash and selectors, with a domain bound to 5042002 (E-14, E-15) |
| Earlier draft: "reentrancy guards" in `src/SettlementExecutor.sol` | The mechanism there is a state transition before any external call (invariant I5) plus the router lock; the transient latch is in the experimental executor. The tests are real and passed (T18) |
| Earlier draft: a blocklist-touching transaction leaves "no receipt at all" | Arc's pages disagree (E-38 versus E-39); receipt presence is UNKNOWN, and T06 and T20 are written for both cases |
| An earlier draft listed 5042 among spoofed or disputed mainnet ids | Circle's own node repository states mainnet is chain id 5042 (E-48), consistent with Uniswap's SDK (E-05) and Safe's registry (E-42). Arc's docs still publish no mainnet RPC (E-02), so it cannot be read back; T03 keeps mainnet off until it can |

## 7. Still UNKNOWN as of 2026-09-11

| Unknown | Why it stays unknown | What resolves it |
|---|---|---|
| Whether chain 5042 is live and what it holds: the E-05 PoolManager, the E-33 feed proxies, Safe at the E-42 addresses, any cirBTC | No public mainnet RPC (E-02) and a login-gated explorer (E-04) | An Arc-published mainnet RPC, then `eth_chainId`, `eth_getCode` and the feed reads, done read-only |
| Whether "Uniswap v4" can be said of any Arc chain | The deployments page omits Arc (E-06); the SDK lists a 5042 address (E-05) that nobody outside could read today. Until both agree and the chain confirms, no UNICA text says "Uniswap v4 on Arc" | Uniswap's deployments page listing Arc, plus an on-chain read |
| The unit of GatewayWallet's `withdrawalDelay()` = 1209600 (E-30): blocks or seconds | Not stated on the pages read | Circle's Gateway contract documentation or verified source |
| Whether a blocklist revert leaves a receipt (E-38 versus E-39) | Arc's own pages disagree | An `arc-anvil` run against the E-16 address; the design already handles both cases |
| Any Arc Testnet oracle for EURC/USD or a BTC asset | Chainlink lists none (E-34); the other providers on Arc's oracle page (E-46) have not been searched for Arc addresses as of 2026-09-11 | A provider's own address page naming chain 5042002, then an on-chain read |
| Fees on a future UNICA-on-Arc flow beyond UNICA's own 0 | Gateway's crosschain transfer fee is 0.005% and same-chain withdrawals are free (E-45); a per-authorization Nanopayments fee was not found on the pages read; no x402 facilitator was selected | Circle's Nanopayments pricing page, and the facilitator's published terms if one is chosen |
| Whether the Arc confidential sector changes T29 | Documented (E-43), availability and threat surface not assessed | A separate review; until then T29 assumes all Arc activity is public |
| Whether any of the 49 facts above has changed after 2026-09-11 | Testnet contracts are upgradeable (E-12, E-18, E-30, E-31) | Re-run the reads in §1 before relying on them; pin implementation addresses, not names |

## 8. Summary

| Class | Rows |
|---|---|
| Threat rows | 29 (T01–T29), plus the two mandatory regressions in §4 |
| Rows with at least one RAN test | 15: T03, T04, T07, T08, T11, T12, T13, T16, T17, T18, T22, T25, T27, and both §4 regressions |
| Rows covered only by LAB tests | 3: T09, T14, T28 |
| Rows with no executed test at all | 13: T01, T02, T05, T06, T10, T15, T19, T20, T21, T23, T24, T26, T29 — each names a PROPOSED or BLOCKED test |
| Tests that run on Arc's EVM today | 0 (§5) |
| Rows BLOCKED on an external fact or the owner | T14 (a verifiable pool), T15 mainnet half (on-chain feed), T26 mainnet (owner Safe) |

**Net position.** The Arc workstream today is research plus a read-only treasury module. UNICA's
own logic for payer binding, replay, reentrancy, fee-on-transfer and dust is tested and green on a
standard EVM, and Advisory 001 is reproduced and still open. What is new today is the Arc ground
truth under it. cirBTC's real testnet contract is now known and still must not back a market.
EURC's EIP-3009 is confirmed on-chain. x402's canonical Permit2 proxy is absent on Arc Testnet. Every
Circle token on Arc is upgradeable, pausable and freezable per token. Chainlink lists Arc mainnet
feeds nobody can yet read. Mainnet's chain id is stated by Circle's own node repository but cannot be
read back. None of that is a completed integration, and none of it moves UNICA closer to a
real-value Arc deployment without the Safe, caps, verified contracts, authenticated pricing,
liquidity, simulations and independent human review that the binding context requires.
