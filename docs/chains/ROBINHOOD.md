# Robinhood testnet (chain 46630) — what is actually there

**UNICA is not deployed on this chain, has never been deployed on this chain, and cannot be
deployed on it today without a change to a frozen source file.** Everything below is a read of the
chain, a read of a fork of it, or a read of a primary document that is named. Nothing here was
broadcast, signed, or spent. Every claim is re-checkable by running
`bash docs/chains/verify-robinhood.sh`, which re-derives all of it and prints
`checks run: 35, passed: 35, failed: 0, skipped: 0`.

All chain reads: **2026-09-09**, via the `robinhood_testnet` alias, at block ≈ 116,033,000
(timestamp `2026-09-09T05:18:03Z`).

This document states facts. It contains no plan, no request, and no claim of support. The only
public sentence about this subject remains the one `docs/feedback/uniswap/robinhood.md` already
fixed: **Robinhood testnet is under compatibility investigation.**

---

---

## 0. BINDING CORRECTION — 2026-09-10

**Section 1 below carried a sentence, now marked SUPERSEDED, asserting that the chain held none of
these contracts. It was true as read on 2026-09-09 and is false now.** The original is left in place and dated rather than
rewritten, because a document that quietly edits its own past is not evidence of anything.

A public testnet faucet at `faucet.testnet.chain.robinhood.com` issued five **testnet stock-token
contracts** to a documented address on chain 46630. What follows is only what was read back over
JSON-RPC; nothing here is taken from a UI, a screenshot, or a claim.

**Read on 2026-09-10 via `eth_call` and `eth_getTransactionReceipt` against
`https://rpc.testnet.chain.robinhood.com/rpc`. `eth_chainId` → `46630`.**

| Fact | Value |
|---|---|
| Transaction hash | `0xc1564a9b19307b6823c55b50adee224b3e16a2f2d1476c869b683ddd63892ec8` |
| Transaction status | `1` |
| Block number | `117005259` |
| Faucet contract (`to`) | `0x8762F93772c663c6a88Ba50900bd5381df2717Be` — answers neither `symbol()` nor `decimals()` |
| Address queried for balances | `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73` (this repository's documented deployer) |

At block `117005259`, `balanceOf(0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73)` returned
`30000000000000000000` — 30 tokens at 18 decimals — for each of the five contracts below.

| Contract address on 46630 | `symbol()` | `decimals()` | balance of the address above |
|---|---|---:|---:|
| `0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e` | `TSLA` | 18 | 30.0 |
| `0x5884ad2f920c162cfbbacc88c9c51aa75ec09e02` | `AMZN` | 18 | 30.0 |
| `0x1fbe1a0e43594b3455993b5de5fd0a7a266298d0` | `PLTR` | 18 | 30.0 |
| `0x3b8262a63d25f0477c4dde23f83cfe22cb768c93` | `NFLX` | 18 | 30.0 |
| `0x71178bac73cbeb415514eb542a8995b82669778d` | `AMD` | 18 | 30.0 |

### 0.1 What this does NOT establish

These are **faucet-issued test tokens on a testnet**. This document does not call them shares,
securities, assets owned by anyone, production instruments, or mainnet stock tokens, and no
official token documentation has been read that would support any of that wording. Section 7.3's
existing rule stands unchanged: *testnet tokens bearing ticker-like symbols are not treated as
equities.*

**Their addresses are not the canonical mainnet addresses.** Re-read on 2026-09-10, on 46630, the
three canonical mainnet addresses section 6(b) lists still hold **zero** runtime bytes:

| Address (per Robinhood's docs, mainnet) | Runtime bytes on 46630, 2026-09-10 |
|---|---:|
| `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` (TSLA) | **0** |
| `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (WETH) | **0** |
| `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (USDG) | **0** |

Those zeros carry a positive control, for the reason section 6(b) already gives: a dead endpoint
would otherwise "prove" all three absent. In the same run the `TSLA`-symbol testnet contract read
back **283** runtime bytes and the PoolManager **24,009**, so the endpoint was answering and a zero
is a real zero.

### 0.2 What has NOT changed

- **No verified USDC payout token has been established on 46630.** All four Circle testnet USDC
  addresses `UnicaDeploymentsV3` names for the other chains read back **0 bytes** here on 2026-09-10.
- **`payoutCurrency(46630)` still reverts** `PayoutCurrencyNotVerified` — `src/v3/UnicaDeploymentsV3.sol`.
- **`UnicaHookV3` and `UnicaExecutorV3` still cannot be constructed on 46630 at all**, because both
  constructors call that function. V3 is not deployable on this chain.
- **Token existence does not prove a settlement path.** Five ERC-20s existing says nothing about
  whether a v4 pool pairing any of them with a settleable counter-asset exists, is initialised, or
  holds liquidity. Section 7.3's steps (2) and (3) are untouched by this correction.
- **UNICA has no Robinhood integration.** The chain has been researched and probed. Nothing has been
  deployed to it, nothing settles on it, and no partnership, sponsorship, or endorsement is claimed
  or implied. The only public sentence on this subject remains the one in section 1.

### 0.3 Reproducing these reads

Read-only. Nothing below signs, sends, or spends.

```sh
R=https://rpc.testnet.chain.robinhood.com/rpc
cast chain-id --rpc-url $R                                              # 46630
cast receipt 0xc1564a9b19307b6823c55b50adee224b3e16a2f2d1476c869b683ddd63892ec8 --rpc-url $R

for a in 0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e \
         0x5884ad2f920c162cfbbacc88c9c51aa75ec09e02 \
         0x1fbe1a0e43594b3455993b5de5fd0a7a266298d0 \
         0x3b8262a63d25f0477c4dde23f83cfe22cb768c93 \
         0x71178bac73cbeb415514eb542a8995b82669778d ; do
  cast call $a 'symbol()(string)'   --rpc-url $R
  cast call $a 'decimals()(uint8)'  --rpc-url $R
  cast call $a 'balanceOf(address)(uint256)' 0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73 --rpc-url $R
done

# the surviving negatives, each with the positive control that makes a zero meaningful
cast code 0x322F0929c4625eD5bAd873c95208D54E1c003b2d --rpc-url $R | wc -c   # canonical mainnet TSLA
cast code 0x8366a39CC670B4001A1121B8F6A443A643e40951 --rpc-url $R | wc -c   # PoolManager: must NOT be empty
```

The explorer at `https://explorer.testnet.chain.robinhood.com` serves these records; see section 0.4.

### 0.4 The explorer, and why it was verified at the API rather than in the page

The HTML routes are a client-rendered application and return **HTTP 200 for anything**, including a
transaction hash that does not exist — real and invented bodies came back the same byte length. The
page therefore cannot distinguish a real record from a fabricated one, and was not used as evidence.

The underlying API can, and was:

```sh
B=https://explorer.testnet.chain.robinhood.com
curl -s -o /dev/null -w '%{http_code}\n' $B/api/v2/transactions/0xc1564a9b19307b6823c55b50adee224b3e16a2f2d1476c869b683ddd63892ec8   # 200
curl -s -o /dev/null -w '%{http_code}\n' $B/api/v2/transactions/0xdeadbeef00000000000000000000000000000000000000000000000000000001   # 404, the control
```

A fabricated hash returns `404 {"message":"Not found"}`; the real one returns the transaction. A
nonsense route returns 404 as well. On that evidence the base URL is recorded in
`packages/protocol/src/chain.ts`; the canonical UI routes are `/tx/<hash>`, `/address/<address>` and
`/block/<number>`.

---

## 1. The headline, in five sentences

Chain 46630 carries a **complete and self-consistent Uniswap v4 deployment**, and it is **not
empty**: 3,621 liquidity positions have been minted through the official PositionManager across
**1,790 distinct pools**, of which **1,474 hold live liquidity right now** — including **616
native-input pools**, the exact shape this hook settles through — and the PoolManager singleton
holds **814.25 native ETH**. Its Universal
Router is a **different, larger build** than the one on Ethereum Sepolia and expects the
**six-field** `ExactInputSingleParams` layout, which is the hazard this repository already recorded
and which is re-proved here against the live bytecode.

**No Robinhood Stock Token exists on this chain.** *(True as read on 2026-09-09; **superseded 2026-09-10** — five faucet-issued testnet stock-token contracts were read back on 46630. See section 0. The rest of this paragraph still holds: those contracts are not at the canonical mainnet addresses, which remain empty here.)* Robinhood's own public asset registry lists 194
stock-token deployments and every single one is on chain **4663** — the mainnet — with zero on
46630; the canonical mainnet TSLA, WETH and USDG addresses all read back as **empty** here. The
equity path on chain 46630 is therefore classified **`NO_VERIFIED_LIQUIDITY_PATH`**.

The blocker for UNICA is ours, not the chain's: `src/libraries/UniswapDeployments.sol` resolves
chain 11155111 and nothing else, and the hook's constructor calls it twice, so the hook cannot be
constructed on chain 46630 at all. That file is frozen.

---

## 2. Verified addresses

Each address was taken from Uniswap's deployments page and then **read back from the chain**. The
byte count is the part that matters: an address that answers a call while holding a different build
is exactly the failure this repository already met once on this chain, and a bare "has code" check
cannot see it. Two of these contracts **are** a different build, which is the subject of section 4.

**Uniswap's page lists this set under "Robinhood Chain", chain id 4663 — a mainnet id, among its
mainnets rather than among its testnets.** The addresses nevertheless read back with code on 46630.
That is recorded as an observation, not resolved: this document does not claim to know whether the
two chains were deployed from one script, and no mainnet call was made in this pass.

| Contract | Address | Runtime bytes | Ethereum Sepolia, same read |
|---|---|---:|---:|
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | 24,009 | 24,009 |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` | **24,546** | 19,540 |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | 23,877 | — |
| PositionDescriptor | `0x9639443158e8c5efa35bd45287bf2effd3d8dc06` | 752 | — |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | **6,118** | 5,820 |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | 3,531 | 3,531 |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152 | 9,152 |
| CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | 69 | 69 |

**No address in that table is empty.** The runner distinguishes an empty address from an unanswered
read by returning `-1` for the latter, so a dead endpoint cannot prove an address vacant — a
property confirmed by sabotage, see section 9.

The Universal Router runtime is pinned by hash, not only by size, because two different builds can
share a length:

```sh
cast code 0x8876789976decbfcbbbe364623c63652db8c0904 --rpc-url robinhood_testnet | cast keccak
# codehash 0xfdd90802f39ce5fc8bac4c2f1b3ac7bac530fd17ff46b0630f1bd00f1e14082f
```

### 2.1 The cross-check that makes the table self-consistent

Transcription is how a wrong address enters a document, so the table is not trusted on its own.
Five of the contracts were asked who their PoolManager is, and all five answered the same address:

```sh
for a in 0x8876789976decbfcbbbe364623c63652db8c0904 \
         0xf3334192d15450cdd385c8b70e03f9a6bd9e673b \
         0x58daec3116aae6d93017baaea7749052e8a04fa7 \
         0x8dc178efb8111bb0973dd9d722ebeff267c98f94 \
         0x9639443158e8c5efa35bd45287bf2effd3d8dc06; do
  cast call $a 'poolManager()(address)' --rpc-url robinhood_testnet
done
```

All five return `0x8366a39CC670B4001A1121B8F6A443A643e40951`. The PoolManager's `owner()` is
`0x9701fb0aDe1E269c8f64Ec0C7b3cfADB31A13A52`, an EOA with nonce 0 on this chain — it is a
designated owner, not the deployer, so it cannot be used to derive the rest of the deployment.

### 2.2 The CREATE2 factory is the same contract

Same 69 bytes, same code hash `0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989`
as on Ethereum Sepolia — the runner re-reads both sides at run time rather than comparing against a
number written here. This is what would make address arithmetic carry across chains at all.

### 2.3 The chain itself

`gasLimit` reads `1125899906842624` (2^50), the signature of an Arbitrum Orbit chain. Block height
was ≈ 116,033,000 on 2026-09-09, which matters for section 5.

---

## 3. What UNICA would land on

| Address | Meaning | On 46630 |
|---|---|---|
| `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` | the hook address this tree's creation code mines to | vacant |
| `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210` | the executor address derived from it | vacant |
| `0xa121e1ef31bbf0826aa67dc01e7977e80af58d73` | the deployer used for the live Sepolia deploy | holds **0.049177057720000000 ETH**, nonce **79** |

The deployer has a balance and a non-zero nonce here, so it has transacted on this chain before.
That is a fact about the account, not a claim about what those 79 transactions were.

---

## 4. The router-layout verdict

### 4.1 What is at stake

Our pinned v4-periphery (commit `7ebd04b`) encodes `ExactInputSingleParams` with five fields, which
reaches the router as nine head words followed by the hook data. A Universal Router built from
v4-periphery at or after commit `03b2d09` expects a sixth static field, `uint256 minHopPriceX36`,
ahead of the hook data — ten head words, hook-data offset `0x140` instead of `0x120`. Hook data is
how every UNICA settlement carries its order id.

**The hazard is not that the wrong layout is refused. It is that on a native-input pool it is
silently accepted.** When `currency0 == address(0)` — the exact pool shape UNICA settles through —
a five-field router handed the six-field encoding reads `minHopPriceX36 = 0` as the hook-data
offset; offset 0 lands back on `currency0`; the zero there reads as a length of zero. The swap
**succeeds** and the hook is handed **empty bytes**. Detection must therefore be positive and can
never be by trial.

### 4.2 The verdict, measured against the live bytecode

`test/compat/UpgradedRouterCompat.t.sol`, six rows, run against a fork of this chain's real router:

```sh
ROBINHOOD_RPC_URL=robinhood_testnet forge test --match-path test/compat/UpgradedRouterCompat.t.sol
# 6 passed; 0 failed; 0 skipped
```

| Row | Result |
|---|---|
| a different router build is present (size 24,546 and hash pinned) | PASS |
| five-field layout with hook data is refused with an **empty** revert | PASS |
| six-field layout settles **and delivers the hook data** | PASS |
| the detector returns **PerHop** (six-field) | PASS |
| five-field layout with **empty** hook data is accepted | PASS |
| the probe's pool key cannot be initialised | PASS |

The fourth row is the verdict: `src/compat/RouterProbe.sol` asks **both** layouts and answers only
when exactly one is accepted, so the instrument is shown to discriminate on this router rather than
to answer the same way to everything. The verdict is read against a recording of the hook data the
hook actually received, never against the absence of a revert.

### 4.3 A silent skip that had to be found first

Left alone on this machine, all six of those rows report **SKIP** while the suite still exits
saying "0 failed". The cause is invisible from the output and is worth writing down: `forge` loads
the project's `.env` before the shell environment is consulted, and this repository's `.env` sets
**`ROBINHOOD_RPC_URL`** — the variable that suite prefers — to an endpoint that answers
`HTTP 401 Must be authenticated!`. The working endpoint lives under a different name,
`ROBINHOOD_TESTNET_RPC_URL`. Both fallbacks then fail too: the suite's second choice is a
`foundry.toml` alias spelled `robinhood`, and this repository spells it `robinhood_testnet`.

So the six rows that decide the whole layout question measured nothing, and nothing in the output
said so louder than the word SKIP. `docs/chains/verify-robinhood.sh` overrides the stale variable
with the endpoint it was actually given, and treats a skip as a skip rather than as a pass.

---

## 5. Does any v4 pool on 46630 hold liquidity?

**Yes. Emphatically, and at scale.**

### 5.1 What could NOT be done, said plainly

**No `Initialize` log scan was performed, and none is possible from either endpoint available
here.** This is stated first because the obvious way to enumerate pools is to scan
`PoolManager`'s `Initialize` events, and that route is closed:

- The keyed endpoint refuses any range wider than **ten blocks**, in its own words:
  `Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range.`
- The keyless public endpoint `https://rpc.testnet.chain.robinhood.com` answers
  `log query timed out` on a full range, and a 1,000-block range did not return within 50 seconds
  on repeated attempts.

The chain is past block **116,000,000**. At ten blocks per request that is 11.6 million requests.
**The log-scan depth achieved is therefore effectively zero blocks, and nothing below rests on
one.** Saying "we scanned back N blocks" would be the more comfortable sentence and it would be
false.

### 5.2 What was done instead

The official `PositionManager` mints one ERC-721 per liquidity position and exposes both the next
id and each position's pool key, so the pool set can be enumerated by **direct state reads with no
logs at all**:

```sh
cast call 0x58daec3116aae6d93017baaea7749052e8a04fa7 'nextTokenId()(uint256)' --rpc-url robinhood_testnet
# 3622

cast call 0x58daec3116aae6d93017baaea7749052e8a04fa7 \
  'getPoolAndPositionInfo(uint256)((address,address,uint24,int24,address),uint256)' 1 \
  --rpc-url robinhood_testnet
# (0x0000000000000000000000000000000000000000, 0x17486A01bb8c3Ac90d94AeD9A16e8fE33b28F300, 3000, 60, 0x0000...0000)
```

**Every token id from 1 to 3,621 was read. All 3,621 answered; none was an unanswered read.**

| Measured over all 3,621 position ids | Count |
|---|---:|
| positions ever minted | 3,621 |
| burned or cleared (pool key reads all-zero) | 380 |
| live positions | 3,241 |
| **distinct pools behind them** | **1,790** |
| distinct token addresses appearing in a pool | 1,826 |
| distinct hook addresses | 542 |

Every one of those 1,790 pools was then read through `StateView` for its current price and
liquidity — **1,790 answered, none unanswered**:

| Pool shape | Pools | **Holding live liquidity now** |
|---|---:|---:|
| all pools found | 1,790 | **1,474** |
| native-input (`currency0 == address(0)`) | 755 | **616** |
| — native **and** hookless | 277 | **227** |
| carrying a hook | 1,150 | **955** |

**All 1,790 are initialised** (`slot0.sqrtPriceX96 != 0`); 1,474 of them also hold non-zero
liquidity at this block. The row that matters for UNICA is the third one: **616 native-input pools
are funded right now**, which is the exact pool shape this hook settles through, and 227 of those
carry no hook of their own.

The deepest funded native-input pools at this block, by `getLiquidity`:

| currency1 | fee | spacing | hook | liquidity |
|---|---:|---:|---|---:|
| `0xD9178562a675d04C2A9A816b039f4653061840Be` | 100 | 200 | `0xeF0c0Fbc…C4cC` | 9.07e25 |
| `0x664b03Eaf15a982d790cc79F3D36337fE0ccc9f7` | 100 | 200 | `0x8FAf3193…04Cc` | 8.92e24 |
| `0x0c1123467D851eD455532A44B04D92A231E8bf12` | 100 | 200 | `0xeF0c0Fbc…C4cC` | 8.83e24 |

This enumeration has one honest limit, and it is a real one: **a pool that was initialised but
never given a position through the official PositionManager would not appear.** A pool created and
funded by a custom router or by a hook holding its own liquidity is invisible to this method. The
number 1,790 is therefore a **floor**, not a total.

### 5.3 The independent corroboration

The v4 singleton holds every pool's reserves, so its own balance is a second, unrelated witness:

```sh
cast balance 0x8366a39cc670b4001a1121b8f6a443a643e40951 --ether --rpc-url robinhood_testnet
# 814.249236785781322917
```

**814.25 native ETH sits in the PoolManager.** Native-input pools on this chain are funded.

### 5.4 The instrument was validated before its readings were believed

Pool liquidity is read through `StateView.getLiquidity(poolId)`, with the pool id derived locally
as `keccak256(abi.encode(poolKey))` rather than transcribed. The derivation was checked against a
position whose own liquidity was already known:

| Reading | Value |
|---|---|
| position #1 `getPositionLiquidity` | `100000000000000000000` |
| its pool, derived id `0xb7dd2038…5cbd`, `StateView.getLiquidity` | `100000000000000000000` |
| that pool's `slot0.sqrtPriceX96` | `792281625142643375935439503360000` (initialised) |

and the same reader, pointed at a pool key that **cannot exist** — two identical currencies and a
zero tick spacing, both refused by `PoolManager.initialize`, the same impossible key
`src/compat/RouterProbe.sol` uses — returns liquidity `0` and price `0`. Both directions are rows
in the runner, and the negative one was sabotaged into failure to prove it discriminates.

---

## 6. What tokens are here

The 1,826 token addresses found in pools were read for `symbol()`, `decimals()` and
`totalSupply()`. The chain's populated pools are dominated by **test tokens and memecoins**, not by
anything an equity desk would recognise. A representative sample, read first-hand:

| Address | `symbol()` | `decimals()` | `name()` |
|---|---|---:|---|
| `0xE7AEfb0d18F5a3597324d92aE470847E32F38FdB` | `USDG` | 6 | Global Dollar |
| `0x80134dF477DeC046b8F4656Ce75e1eBb18718896` | `USDT` | 18 | USDT test |
| `0x44f60cDffB7c626537C09dbFC2807De3B1c8cd55` | `DTA` | 18 | Delta Test A |
| `0x57d69a820cD5a6726F7606582f6dFD2549f451Ae` | `DTB` | 18 | Delta Test B |
| `0x17486A01bb8c3Ac90d94AeD9A16e8fE33b28F300` | `BCASHCAT` | 18 | Buff Cash Cat |
| `0x19D780FfB033AE641C456D8B15d5D39Bb464B5AF` | `tzZEC` | 8 | TEST Wrapped Zcash - NO VALUE |
| `0xc52516FAF2db746880583d120a1959B570AbfD38` | `QAR9` | 18 | QA Receipt Sep 9 |
| `0x25c69EAEa5028a445E3a4ae2d356897124B38352` | `LIST` | 18 | The List |

Two observations that a ticker-shaped symbol would otherwise hide. The token calling itself `USDT`
has **18 decimals**, not the 6 that name implies anywhere else, and it is named "USDT test". And
two *different* addresses both answer `symbol()` with `BCASHCAT` — a symbol on this chain does not
identify a contract. **Nothing here is called a tokenized equity on the strength of its symbol.**

**Testnet USDG is real**: `0xE7AEfb0d18F5a3597324d92aE470847E32F38FdB`, 6 decimals, "Global
Dollar", and it appears in many pools. It is **not** the mainnet USDG address, which has no code
here.

---

## 7. Robinhood Stock Tokens — classified, not assumed

### 7.1 What the primary sources say

Robinhood's own documentation (`docs.robinhood.com/chain/stock-tokens/`, read 2026-09-09) describes
Stock Tokens as standard ERC-20 with **18 decimals**, carrying an **ERC-8056** `uiMultiplier()` for
corporate actions, and states that they "may not be offered, sold, or delivered … to, or for the
account or benefit of, U.S. persons", with further restricted territories including Canada, the
United Kingdom and Switzerland. **The stock-token pages do not mention a testnet at all**, and list
no testnet address.

### 7.2 What the chain says

Three independent reads, each of which alone would be suggestive and which together are conclusive.

**(a) Robinhood's own asset registry — the source its docs page renders its token table from:**

```sh
curl -s https://api.robinhood.com/rhj/assets | grep -oE '"chainId":[0-9]+' | sort | uniq -c
#  194 "chainId":4663
```

**194 stock-token deployments, every one of them on chain 4663. The string `46630` does not occur
anywhere in the payload.** The runner asserts this in *both* directions — that the registry does
list ~194 on 4663, and that it lists none on 46630 — because the absence proves nothing unless the
registry demonstrably had content, and a truncated answer would otherwise satisfy the second row on
its own.

**(b) The canonical mainnet addresses are empty here.** Read on 46630:

| Address (per Robinhood's docs, mainnet) | Bytes on 46630 |
|---|---:|
| `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` (TSLA) | **0** |
| `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (WETH) | **0** |
| `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (USDG) | **0** |

These are rows in the runner, and they are the reason `codelen()` returns `-1` rather than `0` for
an unanswered read: without that distinction a dead endpoint would "prove" all three absent. The
sabotage run in section 9 confirms they go **red**, not green, when the endpoint is dead.

**(c) No token in any pool implements the ERC-8056 marker — and the probe was proved able to say
so.** Every one of the 1,826 token addresses found in a pool was asked for `uiMultiplier()`.

A probe that has never been seen answering YES cannot tell "there are no stock tokens here" apart
from "this call never works", so the control was read first, off a **real** stock token on
Robinhood **mainnet** (chain 4663) — a read, and only a read:

```sh
cast call 0x322F0929c4625eD5bAd873c95208D54E1c003b2d 'uiMultiplier()(uint256)' \
  --rpc-url https://rpc.mainnet.chain.robinhood.com
# 1000000000000000000            (1e18)
cast call 0x322F0929c4625eD5bAd873c95208D54E1c003b2d 'name()(string)' --rpc-url ...
# "Tesla • Robinhood Token"      symbol TSLA, 18 decimals, totalSupply 12267.878
```

**The instrument answers YES on a real stock token and NO on every token on 46630.** Both
directions are rows in the runner, and the mainnet row is what licenses the testnet row: if the
control cannot be reached, both rows print SKIP rather than letting a silent probe pass for
evidence.

### 7.3 The classification

**Equity path on chain 46630: `NO_VERIFIED_LIQUIDITY_PATH`.**

~~There is no stock token on this chain, therefore no stock-token pool, therefore no equity leg
for anything to settle against.~~ **Superseded 2026-09-10 (section 0):** faucet-issued testnet stock-token
contracts now exist on 46630, so step (1) below is satisfied. Steps (2) and (3) are NOT, and the
classification is unchanged — token existence is not a pool, and a pool is not liquidity. What would have to become true instead, in order:

1. ~~A stock token would have to **exist on 46630**~~ — **satisfied 2026-09-10**: five
   faucet-issued testnet stock-token contracts read back on this chain (section 0). This is a
   testnet issuance and is not treated as an equity.
2. A v4 pool pairing it with a settleable counter-asset would have to be **initialised and funded**.
3. The restriction analysis would have to be redone against the **real instrument**, because the
   mainnet instrument is restricted from US persons and from several other jurisdictions, and a
   testnet mock carries none of that meaning.

Until (1) is true, nothing about equities on this chain can be tested at all. **This document does
not present a restricted instrument as available**, and testnet tokens bearing ticker-like symbols
are not treated as equities.

---

## 8. What a first settlement on 46630 would need

Facts, in the order they would have to be resolved. This is a cost account, not a plan.

| # | What is missing | Status today |
|---|---|---|
| 1 | `src/libraries/UniswapDeployments.sol` must resolve chain 46630 | resolves 11155111 only; **the file is frozen** |
| 2 | The executor must encode the **six-field** `ExactInputSingleParams` | `src/compat/RouterParamsCodec.sol` already encodes both layouts; `SettlementExecutor.sol` is frozen and encodes five |
| 3 | A settlement venue: a native-input pool with a settleable counter-asset | **none ready-made** — no hookless native/USDG pool holds liquidity at any of the five standard tiers (`100/1`, `500/10`, `3000/60`, `10000/200`, `0/60`); one would have to be created and funded |
| 4 | Gas for the deployer | `0xa121e1ef…8d73` holds **0.049177 ETH** on this chain |
| 5 | The counter-asset itself | testnet USDG exists (`0xE7AEfb0d…8FdB`, 6 decimals); the deployer's balance of it was not read in this pass |
| 6 | An equity leg | **impossible today** — see section 7 |

Items 1 and 2 are both changes to **frozen** source. Under this repository's rules that is not an
edit to make; it is a new generation that supersedes the frozen one.

---

## 9. How this document is checked, and how the checker was checked

`bash docs/chains/verify-robinhood.sh` re-derives every claim above from the chain and prints
`checks run: 35, passed: 35, failed: 0, skipped: 0`. It signs nothing and sends nothing. Every
`cast` in it is retried on an empty answer via `docs/proof/retry.sh`, because an endpoint that does
not answer prints nothing and an empty answer must never score as a chain that said no.

**A check that has never failed is not a check.** Each row below was broken on purpose and watched
go red, then restored:

| Sabotage | Expected | Observed |
|---|---|---|
| the whole runner pointed at a **dead endpoint** | no false greens | 29 FAIL, 1 SKIP, and only the 3 rows that do not touch this chain still pass |
| router codehash constant corrupted | 1 row red | `the Universal Router runtime is the recorded build` — FAIL, 32 others pass |
| live pool given a fee tier that does not exist | 2 rows red | both `ETH/BCASHCAT` rows FAIL, 31 others pass |
| the impossible pool key replaced by the **real** pool | 2 rows red | both negative-control rows FAIL, 31 others pass |
| "mainnet TSLA absent" aimed at a contract that **does** exist here | 1 row red | FAIL, 32 others pass |
| the deploy-blocker row asked about a chain the frozen file **does** resolve | 1 row red | FAIL, 32 others pass |
| the registry "has content" guard aimed at a chain id that is not there | 1 row red | FAIL, 32 others pass |
| the ERC-8056 negative aimed at a token that **does** answer (mainnet TSLA) | 1 row red | FAIL, 34 others pass |
| the ERC-8056 **positive control** made unreachable | both rows SKIP, neither passes | 2 SKIP, 0 FAIL, 33 pass |

The dead-endpoint run is the one that earned its keep. It caught a **false pass in the runner
itself**: an earlier draft of the native/USDG row counted only "pools found", so five unanswered
reads scored as "no pool exists" and the row printed PASS having read nothing. It now counts
answered tiers separately and prints SKIP when fewer than five answered — *an unread tier is not an
empty tier*.

---

## 10. What this document does not claim

- **No log scan was performed.** Section 5.1 says how far one got: nowhere. The pool census is a
  floor derived from PositionManager state, not a complete enumeration.
- **The only mainnet calls made were reads, and they were controls.** `uiMultiplier()`, `name()`,
  `symbol()`, `decimals()` and `totalSupply()` on the mainnet TSLA token, to prove the ERC-8056
  probe can answer YES. Whether the *router* bytecode here is identical to the build Uniswap lists
  under chain 4663 remains **unchecked** — no router comparison against mainnet was made.
- **The liquidity census is a snapshot, not a runner assertion.** The 1,474/1,790 figures were
  measured once, at one block; liquidity moves. The runner asserts only what is durable: that a
  named pool is live, that an impossible one is not, and that the position count has not gone
  backwards.
- **Nothing here is a deployment, a request, or a claim of compatibility.** UNICA is not deployed on
  this chain and is not being proposed for it. The public sentence remains: *Robinhood testnet is
  under compatibility investigation.*
