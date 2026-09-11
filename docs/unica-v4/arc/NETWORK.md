# Arc Network — identity, status, and chain parameters

Read-only research note: no funds moved, no keys touched, no
deployment performed. Every fact below carries a source URL, retrieval date
(2026-09-11), and a doc quote or a live on-chain read via a keyless public
RPC named in Arc's own docs. Unconfirmed facts are marked UNKNOWN.

## 1. Is "Arc" Circle's Arc network?

**CONFIRMED.** "Arc" here refers to Circle's Layer-1 blockchain,
documented at `docs.arc.io` and announced on `circle.com`. There is no other
project of this name in scope.

- Source: https://www.circle.com/blog/introducing-arc-an-open-layer-1-blockchain-purpose-built-for-stablecoin-finance — retrieved 2026-09-11. Quote: "an open Layer-1 blockchain purpose-built for stablecoin finance."
- Source: https://docs.arc.io/arc-chain.md — retrieved 2026-09-11. Quote: "Arc is a purpose-built Layer-1 blockchain for stablecoin-native financial applications, with USDC as gas."
- The canonical developer docs domain is `docs.arc.io` (docs.arc.network redirects here with an HTTP 301, observed directly: `curl -sIL https://docs.arc.network` → `Location: https://docs.arc.io/`, retrieved 2026-09-11).

## 2. Network status TODAY (2026-09-11)

**Testnet is live; mainnet is not yet public.** Arc's own deployment-phase
table, fetched today, shows:

| Phase | Status (per docs.arc.io, retrieved 2026-09-11) |
| :--- | :--- |
| Devnet | Internal — "Circle's development network for protocol iteration. Not publicly accessible." |
| Private Testnet | Complete — "Invitation-only testnet used for early integration testing." |
| **Public Testnet** | **Live** — "Mirrors mainnet behavior without using real assets. Permissionless testnet (chain ID `5042002`) available to all developers." |
| Private Mainnet | Listed "Upcoming" on this reference page |
| Public Mainnet | Listed "Upcoming" on this reference page |

Source: https://docs.arc.io/arc/concepts/deployment-model.md — retrieved 2026-09-11.

**Discrepancy to flag, not silently resolved:** Circle's own pressroom, dated
2026-08-05, describes an already-running **private mainnet** with "more than
100 ecosystem and institutional builders," ahead of a **public mainnet launch
on September 16, 2026** — 5 days after this file's retrieval date:

> "Circle Announces Founding Validator Cohort & Major Integrations for Arc
> Ahead of September 16 Mainnet Launch" — Founding validators named: BlackRock,
> DTCC, Galaxy, Global Payments, ICE, Mastercard, MoneyGram, SBI Group,
> Standard Chartered, Sumitomo Corporation, Visa.
> Source: https://www.circle.com/pressroom/circle-announces-founding-validator-cohort-and-major-integrations-for-arc-ahead-of-september-16-mainnet-launch — retrieved 2026-09-11, publication date 2026-08-05.

The `docs.arc.io` deployment-model page marking Private Mainnet "Upcoming"
lags the pressroom's own "private mainnet already running" claim — both are
Circle-controlled primary sources that disagree with each other. **Net
assessment for UNICA v4 planning: as of 2026-09-11, no Arc mainnet chain ID,
RPC, or contract addresses are published anywhere in the official docs
(§3–§5) — treat Arc as testnet-only for integration work today**, with a
public mainnet date of 2026-09-16 announced but not independently observed.

Testnet public launch date and testnet health, both primary-sourced:

- Public testnet launch: **2025-10-28** ("Arc's public testnet launched on
  October 28, 2025" per secondary aggregation of the Circle testnet-launch
  press release; the release itself, fetched directly, confirms the launch
  event but the fetch tool's summary did not surface an explicit date string
  — treat the exact day as secondary-sourced, month/year corroborated by the
  primary release's own framing).
  Source: https://www.circle.com/pressroom/circle-launches-arc-public-testnet — retrieved 2026-09-11.
- Testnet performance (Q1 2026 monthly review, per docs.arc.io): **100%
  uptime**, **~0.48 s** average block time, **~30.7M** transactions, **916K**
  unique wallets.
  Source: https://docs.arc.io/arc/concepts/deployment-model.md — retrieved 2026-09-11.

## 3. Official chain ID(s)

**Testnet chain ID: `5042002` — CONFIRMED two ways.**

1. Doc source: https://docs.arc.io/arc/references/connect-to-arc.md and
   https://docs.arc.io/arc/references/rpc-endpoints.md — retrieved
   2026-09-11. Quote (network-parameters table): "Chain ID | `5042002`".
2. **Live on-chain read**, 2026-09-11, against the keyless public
   RPC named in the official docs:
   ```
   curl -s -X POST https://rpc.testnet.arc.io -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
   → {"jsonrpc":"2.0","id":1,"result":"0x4cef52"}
   ```
   `0x4cef52` = `5042002` decimal. Matches the docs exactly.

**Mainnet chain ID: UNKNOWN.** Arc's own contract-addresses reference states
plainly: "All addresses on this page are for Arc Testnet. Mainnet addresses
are not yet available." (https://docs.arc.io/arc/references/contract-addresses.md,
retrieved 2026-09-11). The RPC-endpoints reference likewise says "Mainnet
endpoints and parameters are published separately when available." No Arc
mainnet chain ID appears in any `docs.arc.io` page fetched as of 2026-09-11.

A secondary aggregator (non-primary) claimed a mainnet chain ID of `5042`
before 2026-09-11. **Do not treat `5042` as confirmed** — not found on
`docs.arc.io`, `circle.com`, or via on-chain read (no mainnet RPC exists yet).
Recorded only so it is not re-derived later from the same weak source.

## 4. Native gas asset and decimals — the load-bearing fact for UNICA

**Arc's native gas token is USDC itself, not ETH, and USDC exists as two
interfaces over ONE shared balance, at two different decimal counts.** This
is CONFIRMED from the primary EVM-differences reference and is the single
most important fact for any UNICA settlement code that touches Arc:

> "Arc's native token is USDC, not ETH. USDC on Arc has two interfaces that
> share one balance: a native interface (18 decimals) and an ERC-20 interface
> (6 decimals), so no WETH-style wrapper is needed. To display a native value
> as USDC, divide by 10¹². Don't use the 6-decimal value when crediting or
> recording balances; truncation at the 6-decimal boundary records less than
> was transferred. A zero `balanceOf` doesn't mean the native balance is
> zero."
> Source: https://docs.arc.io/arc/references/evm-differences.md — retrieved 2026-09-11.

| Interface | Decimals | Address | Notes |
| :--- | :--- | :--- | :--- |
| Native (gas / `msg.value`) | **18** | n/a (protocol-level balance) | This is what pays gas and what `SELFDESTRUCT`/native `CALL` move. |
| ERC-20 (`IERC20`) | **6** | `0x3600000000000000000000000000000000000000` | Optional view/transfer interface over the same balance. Truncates sub-µUSDC amounts. |

- Confirmed by a second doc page independently: "The 18-decimal precision …
  applies to Arc's native gas accounting. USDC on Arc also provides a
  standard ERC-20 interface with 6 decimals for application-level transfers.
  These are not two separate tokens." — https://docs.arc.io/arc/references/gas-and-fees.md, retrieved 2026-09-11.
- **Live on-chain read**, 2026-09-11 — the ERC-20 address has
  deployed code and is NOT a bare EOA:
  ```
  curl -s -X POST https://rpc.testnet.arc.io -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x3600000000000000000000000000000000000000","latest"],"id":1}'
  → 0x60806040526004361061005a...5c60da1b...8f283970...f851a440...
  ```
  The returned bytecode's selectors (`0x3659cfe6`=`upgradeTo`,
  `0x4f1ef286`=`upgradeToAndCall`, `0x5c60da1b`=`implementation`,
  `0x8f283970`=`changeAdmin`, `0xf851a440`=`admin`) match OpenZeppelin's
  **TransparentUpgradeableProxy** pattern almost verbatim — **direct on-chain
  evidence that Arc-testnet USDC's ERC-20 interface is an upgradeable proxy**,
  relevant to UNICA's upgradeability-verification obligation. The admin slot
  itself was not read (no call beyond `eth_getCode`), so the admin address is
  UNKNOWN as of 2026-09-11.

**No wrapped-native token exists or should exist on Arc.** The porting guide
is explicit that a `WUSDC`/`WETH`-style wrapper must not be deployed, because
it would fragment the one real balance:
> "Do not deploy a `WUSDC` wrapper contract. Wrapping the native asset on Arc
> fragments liquidity and can create user confusion."
> Source: https://docs.arc.io/arc/tutorials/porting-contracts-to-arc.md — retrieved 2026-09-11.

This reinforces UNICA's own binding rule that "a same-asset USDC payment is
never forced through a swap" — on Arc, native and ERC-20 USDC are literally
the same asset at two decimal precisions, so pairing them in a pool would be,
per the docs, "meaningless."

Two other Circle-issued stablecoins are natively supported on Arc testnet
(plain 6-decimal ERC-20s, not gas-token duals):

| Token | Testnet address | Decimals |
| :--- | :--- | :--- |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 |
| USYC (tokenized money-market fund, Circle Intl Bermuda Ltd.) | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` | 6 |

Source: https://docs.arc.io/arc/references/contract-addresses.md — retrieved 2026-09-11. USYC is gated: "$100,000 USD minimum investment," institutions outside the US only, per the same page.

## 5. Official RPC(s) and explorer(s)

All CONFIRMED from https://docs.arc.io/arc/references/rpc-endpoints.md and
https://docs.arc.io/arc/references/connect-to-arc.md, both retrieved
2026-09-11, and cross-checked live where noted.

**Testnet RPC (HTTP / WebSocket):**

| Provider | HTTP | WebSocket |
| :--- | :--- | :--- |
| Primary (Circle) | `https://rpc.testnet.arc.io` | `wss://rpc.testnet.arc.io` |
| Alchemy | `https://arc-testnet.g.alchemy.com/v2/<key>` | `wss://arc-testnet.g.alchemy.com/v2/<key>` |
| Blockdaemon | `https://rpc.blockdaemon.testnet.arc.io` | `wss://rpc.blockdaemon.testnet.arc.io/websocket` |
| dRPC | `https://rpc.drpc.testnet.arc.io` | `wss://rpc.drpc.testnet.arc.io` |
| QuickNode | `https://rpc.quicknode.testnet.arc.io` | `wss://rpc.quicknode.testnet.arc.io` |

The primary endpoint is keyless and public — it was used directly for
every on-chain read in this file. It speaks standard Ethereum JSON-RPC:
"Arc supports all standard Ethereum JSON-RPC methods" including
`eth_getBalance`, `eth_call`, `eth_sendRawTransaction`, `eth_getTransactionReceipt`,
`eth_gasPrice`, `eth_feeHistory`, `eth_subscribe` (WS only).

**Testnet block explorer:** `https://testnet.arcscan.app` — runs **Blockscout**
(stated explicitly in the deploy tutorial; see §6). Gas tracker sub-page:
`https://testnet.arcscan.app/gas-tracker`.

**Mainnet RPC / explorer: UNKNOWN — not yet published.** Direct quote: "The
values on this page apply to the Arc Testnet. Mainnet endpoints and
parameters are published separately when available." Same non-publication
statement is repeated on the contract-addresses page (§3). No mainnet
`arcscan` subdomain or RPC hostname was found in any official doc fetched.

**Faucet:** `https://faucet.circle.com` — CONFIRMED live and Arc-aware.
Fetching the faucet page directly (2026-09-11) surfaced a feature-flag string
in its client bundle including `arcFaucetEnabled` alongside per-chain flags
for many other testnets, confirming Arc Testnet is a faucet-enabled network
Circle-side today. The faucet issues testnet USDC (used for gas) and testnet
EURC (network = "Arc Testnet" in the faucet's own network selector, per
https://docs.arc.io/arc/references/contract-addresses.md's EURC section).
There is and will be no mainnet faucet — faucets are testnet-only by nature;
this is an inference from how every faucet in this class of product works,
not a quoted doc statement, so it is marked as inference rather than a cited
fact.

## 6. Availability and stability

**Arc explicitly warns that testnet is not yet stable**, in tension with the
strong uptime number in its own performance table (§2) — both quoted
verbatim, not silently reconciled in Arc's favor:

> "Arc is currently in its testnet phase. During this period, the network may
> experience instability or unplanned downtime."
> Source: https://docs.arc.io/arc/tutorials/deploy-on-arc.md — retrieved 2026-09-11.

versus the Q1 2026 monthly-review table (§2): 100% uptime, ~30.7M
transactions, 916K unique wallets. **Reconcile as:** a strong historical
track record through Q1 2026, but Circle's own live tutorial-page disclaimer
still tells developers to expect instability as a standing testnet
characteristic — treat Arc Testnet as **not yet SLA-backed for
production-grade reliability** for UNICA planning purposes. No independent
uptime dashboard is cited; the 100% figure is self-reported.

**Live liveness check performed 2026-09-11:**
```
eth_blockNumber → 0x3ac3116  (= 61,616,406 decimal)
eth_gasPrice    → 0x51f4d5c00 (= 22,000,000,000 wei = 22 Gwei)
```
Block height ~61.6M at the documented ~0.48s average block time implies
roughly 342 days of block production — the right order of magnitude for a
testnet launched ≈318 days earlier (2025-10-28), presented as corroboration
only, not a precise reconstruction. The 22 Gwei gas price sits just above
the documented 20 Gwei minimum base-fee floor (§10). The chain was live and
responsive to RPC calls as of 2026-09-11.

**Mainnet availability: UNKNOWN / not applicable yet** — no mainnet endpoint
exists to test as of 2026-09-11 (§2, §5).

## 7. Contract verification process

**CONFIRMED — Blockscout-based, via Foundry's verifier or manual upload.**
Source: https://docs.arc.io/arc/tutorials/deploy-on-arc.md — retrieved
2026-09-11.

> "Arc Testnet Explorer runs Blockscout, so you can publish your contract's
> source code with `arc-forge verify-contract` and Foundry's Blockscout
> verifier. Verified contracts show a Contract tab on the explorer with
> source code, ABI, and a read/write UI."

CLI form (uses Arc's own Foundry fork, "Arc Foundry" — standard `anvil`/
`forge` do not reproduce Arc-specific execution semantics, so Arc publishes
`arc-forge`/`arc-cast`/`arc-anvil` at https://github.com/circlefin/arc-foundry):

```
arc-forge verify-contract <CONTRACT_ADDRESS> src/MyContract.sol:MyContract \
  --chain-id 5042002 --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/
```

Constructor args are ABI-encoded separately (`arc-cast abi-encode`) and
passed via `--constructor-args`. A manual path also exists: "submit source
code manually from the contract verification page
(`https://testnet.arcscan.app/contract-verification`) … if you didn't deploy
with Foundry."

Mainnet verification process: UNKNOWN — no mainnet explorer is published yet
(§5), so no mainnet verifier URL or chain-id argument can be confirmed.

## 8. Testnet faucet / funding

Faucet confirmed and detailed in §5 (`https://faucet.circle.com`, Arc-flagged
client-side, distributes testnet USDC and EURC). Additional funding facts not
covered there:

- USYC is NOT obtained from the faucet directly; it needs an allowlisting
  support ticket first, then a mint via the USYC Teller contract
  (`0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`) once approved —
  "Requests are typically processed in 24–48 hours." Source:
  https://docs.arc.io/arc/references/contract-addresses.md — retrieved 2026-09-11.
- Testnet USDC/EURC is explicitly worthless outside testnet: "Testnet USDC is
  for testing purposes only. It has no real-world value and must not be used
  in production." Source: https://docs.arc.io/arc/tutorials/deploy-on-arc.md
  — retrieved 2026-09-11.
- A well-known, publicly-derivable **blocklisted test address** is seeded on
  testnet for exercising revert paths — `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`,
  derived from the public Foundry/Anvil test mnemonic ("test test test test
  test test test test test test test junk") at index 1; a value transfer to
  or from it reverts at runtime. This is a publicly documented test fixture,
  not a secret, and was not queried for balance here. Source:
  https://docs.arc.io/arc/references/contract-addresses.md — retrieved 2026-09-11.
- Mainnet funding: n/a — mainnet is not live; faucets are inherently a
  testnet-only mechanism (an inference, not a quoted doc line).

## 9. Account abstraction, paymasters, gas sponsorship

**Two distinct layers exist — third-party AA today, native paymaster
"Planned" only.** Both CONFIRMED as separate facts; do not merge them.

**(a) Third-party ERC-4337 account abstraction — LIVE today, via external
providers, not an Arc protocol feature:**

> "Account abstraction (AA) replaces externally owned accounts (EOAs) with
> smart contract wallets that support programmable transaction validation,
> gas sponsorship, and batched operations. Arc supports the ERC-4337
> standard, so you can use any compatible bundler, paymaster, or SDK from the
> providers below."
> Source: https://docs.arc.io/arc/tools/account-abstraction.md — retrieved 2026-09-11.

Listed providers (third-party, except Circle Wallets itself): Alchemy,
Biconomy, Blockradar, **Circle Wallets**, Crossmint, Dynamic, MetaMask
Embedded Wallets, Para, Pimlico, Privy, Thirdweb, Turnkey, Zerodev. Alchemy
documents "Gas sponsorship: Sponsor transactions so users can transact
without holding USDC for gas" as a feature built on top of Arc — available
today only by layering ERC-4337 paymasters on top, not as a native Arc
protocol capability.

**(b) Native, protocol-level paymaster / multi-stablecoin gas sponsorship —
NOT LIVE, roadmap only:**

> "Stablecoin Services … Planned … Powers crosscurrency settlement,
> paymaster-sponsored transactions, and multi-stablecoin gas payments."
> Source: https://docs.arc.io/arc/concepts/system-overview.md and
> https://docs.arc.io/arc/concepts/execution-layer.md (identical wording on
> both) — retrieved 2026-09-11. Both pages carry an explicit info-box: "Arc
> Privacy Sector (APS) and Stablecoin Services are on the roadmap and not yet
> available on Arc."

**Implication for UNICA:** any gas-sponsorship or "pay gas in a different
asset" design on Arc today has to be built on a third-party ERC-4337 stack
(bundler + paymaster from the list above), not on an Arc-native primitive —
the native version is explicitly future work per Circle's own docs.

## 10. EVM version, opcode support, and execution semantics

**EVM baseline: targets Ethereum's Osaka hard fork, plus one Amsterdam
feature shipped early.** CONFIRMED, direct quote:

> "Arc is an EVM-compatible Layer-1 blockchain. Solidity, Foundry, Hardhat,
> Viem, ethers.js, and standard Ethereum wallets work without modification …
> Arc targets the Osaka hard fork as its baseline, including features such as
> EIP-7702 (set-code transactions). Arc also ships select features from
> Ethereum's upcoming Amsterdam hard fork ahead of upstream, notably EIP-7708
> (standard Transfer logs for native value movements)."
> Source: https://docs.arc.io/arc/references/evm-differences.md — retrieved 2026-09-11.

**CREATE2 — explicitly confirmed identical to Ethereum**, including the
newer residual-storage EIP:

> "EIP-7702 set-code transactions, CREATE2 (including EIP-7610
> residual-storage behavior), and EIP-2935 historical block hashes all
> behave as on Ethereum."
> Same source as above.

**PUSH0 (EIP-3855, Shanghai) and transient storage (EIP-1153, Cancun): INFERRED,
not independently CONFIRMED**, from the Osaka-baseline statement above — Osaka
postdates both Shanghai and Cancun in Ethereum's upgrade sequence, and Arc's
EVM-differences page frames itself as an exhaustive diff that does not list
either opcode as differing. Neither term appears anywhere in `docs.arc.io`'s
page index (the llms.txt sitemap was searched on 2026-09-11 for
"PUSH0", "transient", "TSTORE", "TLOAD", "1153", "3855" — no hits). **Do not
cite PUSH0 or EIP-1153 as independently confirmed** — a direct opcode probe
(deploy and call a minimal `TSTORE`/`PUSH0` contract against
`rpc.testnet.arc.io`) would confirm it but was out of scope for this
read-only pass.

**Explicit protocol-level deviations from standard EVM/Osaka semantics**
(all direct quotes, same source, retrieved 2026-09-11):

| Behavior | Ethereum (Osaka) | Arc |
| :--- | :--- | :--- |
| `PREVRANDAO` | Beacon RANDAO mix | **Always returns `0`** — no on-chain randomness; use an oracle/VRF |
| `SELFDESTRUCT` | EIP-6780 | EIP-6780 **plus native-value rules**; emits an EIP-7708 `Transfer` log on success |
| Non-zero-value `CALL` to a self-destructed account | Succeeds | **Reverts** — treated as a forbidden burn ("the largest semantic departure") |
| `parentBeaconBlockRoot` / EIP-4788 | Functional beacon-roots contract | Set to parent execution block hash; beacon-roots contract omitted, reads return empty |
| Blob transactions (EIP-4844, type-3) | Supported | **Not supported** — mempool rejects them; `BLOBHASH`→`0`, `BLOBBASEFEE`→`1` |
| Withdrawals (EIP-4895) | May be present | **Always empty** — `block.withdrawals` always empty |

**Value-transfer rules unique to Arc** (native asset is a regulated
stablecoin, not ETH): value-bearing transfers to `0x0` revert; burning
(self-destruct-to-self, or send-to-already-destructed) reverts; **blocklisted
addresses revert a transfer on either side, still consuming gas**; sending to
a no-code address succeeds and emits a `Transfer` log; sending to a
**precompile address reverts**.

**Fee-market mechanics:** base fee is paid to the block beneficiary, not
burned; next block's base fee is published in the parent header's
`extra_data` (8-byte big-endian); **minimum base fee is 20 Gwei, silently
enforced by the mempool** — sub-floor transactions "produce no error receipt
and never appear in a block"; maximum base fee is 20,000 Gwei; block
timestamps are **non-decreasing, not strictly increasing** (1-second
proposer-clock granularity — "don't assume `block.timestamp` strictly
increases between blocks"). Source: https://docs.arc.io/arc/references/evm-differences.md
and https://docs.arc.io/arc/references/gas-and-fees.md — both retrieved 2026-09-11.

**Execution client:** Reth (Paradigm's Rust Ethereum client), extended with
Arc modules (Fee Manager — live; CallFrom precompile — live; Arc Privacy
Sector and Stablecoin Services — both "Planned … not yet available"). Five
custom precompiles occupy `0x1800...0000`–`...0004`: Native Coin Authority
(mint/burn/transfer), Native Coin Control (blocklist), System Accounting
(fee ring buffer), Call From (msg.sender-preserving delegation), PQ
Signature Verify (`SLH-DSA-SHA2-128s`). Source:
https://docs.arc.io/arc/concepts/execution-layer.md — retrieved 2026-09-11.

## 11. Finality model and reorg assumptions

**CONFIRMED — deterministic BFT finality, no reorg model at all (not "low
reorg risk" — the docs claim reorgs are structurally impossible).**

> "Arc provides deterministic finality: every transaction is either
> unconfirmed or final, with no intermediate state. This guarantee comes from
> the network's consensus layer, which uses a Byzantine Fault Tolerant (BFT)
> consensus protocol — once two-thirds or more of validators sign off on a
> block, that block is irreversible. Every transaction in a committed block
> is immediately and irreversibly settled. There are no confirmation
> windows, no reorganization risk, and no probabilistic uncertainty."
> Source: https://docs.arc.io/arc/concepts/deterministic-finality.md — retrieved 2026-09-11.

Consensus engine: **Malachite** — "a high-performance, open-source
implementation of the Tendermint Byzantine Fault Tolerant (BFT) protocol,"
open source at https://github.com/circlefin/malachite/, running a
**permissioned Proof-of-Authority (PoA)** validator set (not anonymous
staking). Four-step pipeline per block: Propose → Pre-vote → Pre-commit →
Commit, requiring **more than two-thirds** of validators to pre-commit
before a block is finalized; "This two-phase voting process (pre-vote +
pre-commit) guarantees that two conflicting blocks can never both be
finalized, making reorganizations impossible." Source:
https://docs.arc.io/arc/concepts/consensus-layer.md — retrieved 2026-09-11.

Published performance figures (same source, testnet, benchmark conditions —
not independently audited beyond the block-number/gas-price
liveness check in §6):

| Metric | Value | Conditions |
| :--- | :--- | :--- |
| Finality | **< 350 ms** | Benchmark conditions |
| Throughput | 3,000+ TPS | 20 globally distributed validators |
| Peak throughput | 10,000+ TPS | 4 validators |
| Gas throughput ceiling | 30M gas/block, ~60M gas/sec | at 0.5 s block time, per gas-and-fees reference |

**Validator set at launch:** ~20 SOC-2-certified, geographically distributed
institutions, rotating proposer, uptime SLAs — "regulated institutions,
making malicious behavior costly beyond protocol penalties" replaces
anonymous economic slashing as the security model. **Safety:** "With fewer
than one-third faulty validators, consensus guarantees that no conflicting
blocks are finalized." **Liveness:** "The network continues to produce
blocks as long as two-thirds or more of validators are online and honest."
Roadmap: possible PoA→permissioned-PoS transition; multi-proposer support;
a three-round-to-two-round consensus optimization. Source:
https://docs.arc.io/arc/concepts/consensus-layer.md and
https://docs.arc.io/arc/concepts/deployment-model.md — both retrieved 2026-09-11.

**Practical developer consequence, stated directly by the docs:** "You don't
need retry logic, rollback mechanisms, or confirmation-count thresholds. A
confirmed transaction stays confirmed," and downstream/off-chain effects
(webhooks, DB writes) are safe to trigger "as soon as a block is committed."
This is a materially different assumption from the probabilistic-finality
model UNICA already codes against on Ethereum mainnet/Sepolia — any Arc
integration path should NOT reuse a confirmation-count-based finality
threshold; it should treat single-inclusion as final, per Arc's own explicit
design intent.

## 12. Open items / not resolved as of 2026-09-11

- Arc mainnet chain ID, RPC, explorer, contract addresses — **UNKNOWN**,
  unpublished as of 2026-09-11 per the primary docs themselves (§3, §5).
- Whether "private mainnet" is already running (pressroom, 2026-08-05) or
  still "Upcoming" (docs.arc.io deployment-model page, live 2026-09-11) —
  **unresolved discrepancy between two Circle-controlled sources** (§2).
- PUSH0 (EIP-3855) and transient storage (EIP-1153) — **inferred** from the
  Osaka-baseline framing, not confirmed by an on-chain opcode probe (§10).
- USDC ERC-20 proxy's admin address / upgrade authority on testnet —
  **UNKNOWN**; only `eth_getCode` was read (§4), not the admin storage slot,
  since each additional on-chain read was kept to the minimum necessary.
- Exact calendar day of public testnet launch — month/year corroborated
  (2025-10), exact day not independently re-derived from the primary release
  text itself as of 2026-09-11 (§2).
