# UNICA v4 — deployment gates

Draft for owner review, not committed, authorising nothing (Q131). Written from `docs/unica-v4/DECISIONS.md` (the
ledger), which binds it; where they disagree the ledger wins and this file is wrong. It must also agree with
`SPEC-CONTRACTS.md` (cited SC §n) and `SPEC-ORACLE-AND-CHAINS.md` (cited SOC §n); it never contradicts either.
Evidence is cited from `docs/unica-v4/evidence/`: `DESIGN-REVIEW.md` (DR, findings A1–A16, B1–B10, C1–C20),
`MAINNET-CAPABILITY-PROBE.md` (MCP) and `CHAINLINK-AVAILABILITY.md` (CA). "UNICA v4" is the UNICA release;
"Uniswap v4" is the AMM. The frozen experimental deployment (tag `experimental-46630-settled`) is **not** UNICA v4 and
is never modified, redeployed or listed in a UNICA v4 manifest.

**Scope.** The 46630 rehearsal, TSLA only: stages A (infrastructure), B (market), C (initialise, seed, activate), D
(one payer-bound settlement), H (verification), I (manifest). Then mainnet: gates, blockers, aborts, Q10 and Q120.

**No mainnet deployment is authorised.** Q132 is unanswered, so nothing is deployed on any mainnet, not even
no-value infrastructure. Q9 is OPEN; Q64, Q70 and Q71 are NOT READY; Q91 is NOT SELECTED.

**Labels that hold throughout.** Faucet stock tokens and uTUSD have no real-world value. 395 is a demonstration rate
the admin sets (Q110), not a price from any source. The rehearsal registry has `requireOracle = false` and its TSLA
market is flagged demonstration-only on-chain; no deployed UNICA v4 contract reads a Chainlink price, so Chainlink is
**planned** (Q125). Every size, gas and address figure from DR was measured on a prototype outside this repository and
is feasibility evidence only; the implementation re-measures, and the wrapper prints its own simulated figures.

## 1. Blockers

Nothing here blocks writing or testing the tools. Each row blocks the stage named.

| Item | State | What it blocks in this file |
| --- | --- | --- |
| Owner go for the UNICA v4 rehearsal | **BLOCKER**: not given; the ledger's "What the missing answers mean" holds nothing deployed, signed or funded until the owner confirms the specification | every LIVE stage (A to D). The earlier authorisation covered the frozen experiment only. Each LIVE stage is handed to the owner, who runs it; only the owner signs. |
| 46630 Uniswap v4 addresses | **BLOCKER**: `null`, source `PENDING` in `config/chains/46630.json` (SOC §12.1, §16 item 1) | the chain helper refuses every stage until a reviewed commit records PoolManager, PositionManager, StateView and Permit2 for 46630 in `docs/unica-v4/evidence/` with their source |
| TSLA beacon fingerprint | **BLOCKER**: the expected implementation address and code hash exist only outside this repository (DR A7) | stage B's asset pre-flight (§5.2) until a read-only probe records them in evidence |
| Implementation | **BLOCKER**: `src/unica-v4/`, `script/unica-v4/`, `test/unica-v4/`, `config/chains/` do not exist yet | every stage; §2 lists the committed tools each stage needs |
| Frozen-gate baseline (TEST-MATRIX B15) | **BLOCKER**: the owner has not accepted the pinned post-tag diff that G1 hashes | G0 step 3 (§2.3), so every LIVE stage; the tag is never moved |
| Fork row V1 (NFLX on the 46630 fork) | **RESOLVED**: `DECISIONS.md` "Specification choices" decouples V1 from the TSLA rehearsal; it backs only the separate claim "configuration-only onboarding proven on a fork" (TEST-MATRIX §12), and is never dropped whenever that claim is made | only that onboarding claim; no TSLA LIVE stage's declared set (G0 step 5 removed) waits on V1. Until V1 runs, the claim reads "proven in local tests (N1, N2)" only |
| Q110 NFLX rate | **BLOCKER**: NOT SELECTED | stages E, F and G (an NFLX market); NFLX stays configuration-only in local and fork tests |
| Q110 merchant control | **BLOCKER**: UNKNOWN / NOT PROVIDED | describing `0x19E56831a10d43CfF5d77f886c799C6b916da7Ae` (source: DECISIONS.md Q110) as owner-controlled |
| Q131 | **BLOCKER**: NO AUTHORIZATION | pushing, tagging for publication, triggering Pages, and submitting source to an explorer in stage H without the owner's separate go |
| Q132 unanswered; Q9 OPEN; Q64, Q70, Q71 NOT READY; Q91 NOT SELECTED; Q95 NOT PROVIDED; Q20 NO CONFIRMED REVIEW; Q108 NOT READY | each a **BLOCKER** | every mainnet step; §10.1 gives each one as a gate, with what it blocks and what would close it |

## 2. The committed tools, the modes, and the gate before every SEND

### 2.1 Tools

Every tool a stage needs is a committed file that depends on no uncommitted state; CI runs the offline ones with no
RPC. The frozen wrapper `script/experimental/stock-46630.sh` is the pattern, never the source: these are written fresh.

| Tool | What it does | Sends |
| --- | --- | --- |
| `script/unica-v4/chain.sh` | the chain helper (SOC §12.2): loads `config/chains/<chainId>.json`; refuses a disabled or unknown chain, an unset RPC variable, a reported chain id that differs, a `null` required address, a `MOCK` adapter; exports `UNICA_CHAIN_ID` and the addresses | nothing |
| `script/unica-v4/deploy.sh` | the wrapper: modes, the G0 gate, the plan block, one SEND per stage, the record scrub. Chain-generic by the ledger's ruling, so not named for 46630 (DR used `unica-v4-46630.sh`). | only in LIVE mode |
| `script/unica-v4/UnicaMarketDeploy.s.sol` | forge entry points `infra`, `mine`, `propose`, `open`, `activate`, `settle`; reads only the `vm.env*` values the helper exported; re-asserts `block.chainid == vm.envUint("UNICA_CHAIN_ID")`. No `verify` entry: a script cannot verify (DR B6). | through forge, LIVE only |
| `script/unica-v4/readback.sh <stage>` | the committed readback of §4 to §7: read-only calls and receipt reads, one numbered row per assertion, printing `N rows, N passed, 0 failed`; writes `deployments/unica-v4/<chainId>/readback-<stage>.json` | nothing |
| `script/unica-v4/verify.sh` | stage H: explicit per-contract verification commands, then read-only explorer queries | source to explorers; no transaction |
| `script/unica-v4/manifest.sh` | stage I: builds `deployments/unica-v4/<chainId>.json` from the committed broadcast records, readback files, explorer query results and read-only calls | nothing |
| `script/unica-v4/deploy.test.sh`, `manifest.test.sh`, `config-only.test.sh` | offline shell suites with planted bad inputs (§2.4, §9.3) | nothing |

Configuration is data only, with no secret and no RPC URL: `config/chains/46630.json` (SOC §12.1); the market file
`script/unica-v4/markets/46630/tsla-utusd.env`; the infrastructure file `script/unica-v4/markets/46630/infra.env`;
the settlement file `script/unica-v4/settlements/46630-tsla.env`. The wrapper sources only whitelisted keys and
refuses a missing or unknown one. RPCs are variable names: 46630 reads `ROBINHOOD_TESTNET_RPC_URL`, and the helper
refuses when it is unset. The value is never printed, logged or written; the plan prints the variable name only.

### 2.2 Modes

Exactly one mode per run, decided before any network call (the frozen wrapper's pattern, DR C11). `DRY_RUN=1`
simulates at the current block and prints the plan, sending nothing. `REHEARSE=1` runs the stage on a disposable fork
node of the reported chain that the committed wrapper starts and stops itself, refusing any other endpoint or node.
`LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS` is the only mode that sends; it also needs `DEPLOYER_ACCOUNT` (a Foundry keystore name), a terminal, and `SEND` typed
once per stage after the plan block, then forge asks for the keystore password. `PRIVATE_KEY` in the environment and
`--private-key` anywhere are refused. Anything else stops with nothing sent.

The wrapper clears a stray `CHAIN` variable, which Foundry reads as `--chain` (DR C11). It scrubs forge's dry-run
records under `cache/UnicaMarketDeploy.s.sol/` on exit, because forge writes the RPC URL there (DR B8); a live run's
record is kept, because `forge script --resume` needs it.

### 2.3 G0 — the gate every LIVE stage passes first

The wrapper runs these in order and refuses the SEND prompt at the first failure, naming it:
1. **Chain.** `chain.sh` passes for the chain id the RPC reports; the file is `enabled`; for 46630 `network` is
   `testnet` and `requireOracle` is `false`. `requireOracle = false` from any other file is refused (SOC §3).
2. **Tree.** HEAD is the UNICA v4 release tag and the tree is clean; `forge --version` equals the value recorded in
   `infra.env`; the hook creation-code hash computed from the local build equals `HOOK_CREATION_CODE_HASH` (DR B10).
   Any hook or executor change after stage A means new infrastructure (SC §12).
3. **Build gates.** The size gate passes for every UNICA v4 contract (24,576 runtime, 49,152 initcode; SC §12). The
   frozen generation is unchanged in the form `TEST-MATRIX.md` §11.1 fixes; the literal "diff against the tag is
   empty" fails on this branch (post-tag NatSpec commits `eea86d2`, `903a8c9`; TEST-MATRIX B15), and tags never move.
   G1: the tag resolves to `e5a0185`, `git status --porcelain` is empty on the frozen paths, and the SHA-256 of the
   post-tag diff equals the pinned, owner-accepted value (DR C13). G2: each frozen creation code is an exact byte
   prefix of its committed broadcast input, which is what shows the post-tag edits changed no bytecode (DR B7).
4. **Tests.** Unit, fuzz and invariant suites pass; the UNICA v4 mutation table reports every mutant KILLED and 0
   MISATTRIBUTED (DR C4, SC §9.3); the UNICA v4 claims check passes (DR C17).
5. **Fork suite.** Run with `--json`. The wrapper refuses unless the executed row ids equal the declared set
   (TEST-MATRIX §12) and skipped rows are 0, and prints both numbers (DR C2). An unset RPC variable is a refusal, never a skip.
6. **Wrapper suites.** `deploy.test.sh` passes, including its per-stage plan-block rows (§2.4).
7. **Funds and nonce.** The deployer's balance is at least twice the stage's upper gas estimate; the nonce is
   re-read live at every stage and printed, never carried over from an earlier stage.
8. **Order.** The previous stage's readback file exists, names this manifest's factory, and reports 0 failed.

### 2.4 What the wrapper suite must refuse

`deploy.test.sh` runs offline; each row plants one bad input and requires a refusal with nothing sent, beside a passing
control: no mode; two modes; LIVE without a keystore name or a terminal; `PRIVATE_KEY` set; a stray `CHAIN`; an unset
RPC variable; a disabled chain file; a mainnet chain id (`script/mainnet-guard.sh`); a missing or unknown market key; a
`SALT` whose hook lacks the `0x20C0` bits or already has code; an unpinned payout token (DR B1, C9); a balance below
twice the estimate; stage B without readback A; C7 without a passing readback C. Per stage, a row asserts the plan
block holds every §3 label and that its predicted addresses and ids equal what REHEARSE then deploys (DR C11). A
planted fake keyed URL in a dry-run record must be gone after exit (DR B8).

## 3. The plan block printed before every SEND

After G0 and a full simulation the wrapper prints one block with fixed labels, then stops at `type SEND to broadcast,
anything else to stop`; DRY_RUN and REHEARSE print the same block. The labels cover the ten fields the owner named,
plus the context that exposes a wrong configuration:

| Label | Content |
| --- | --- |
| `STAGE` / `MODE` | the stage letter and name; DRY_RUN, REHEARSE or LIVE |
| `CHAIN` | the chain id the RPC reports, the chain file's `name` and `network`, the block number and hash simulated against, the RPC **variable name** |
| `RELEASE` | tag, commit, `forge --version`, `HOOK_CREATION_CODE_HASH` from the local build |
| `DEPLOYER` | address, keystore name, live nonce, balances in ETH, TSLA and uTUSD (raw and human) |
| `CONTRACTS` | each contract the stage creates, and how (CREATE2 through the deterministic deployer, factory CREATE2, nested CREATE) |
| `CONSTRUCTOR ARGS` | per contract: decoded values and the ABI-encoded hex with its byte length |
| `SALTS` | `FACTORY_SALT` (stage A), the market `SALT` (stage B), `ORDER_SALT` (stage D), each with the file it came from |
| `PREDICTED` | factory, registry, hook (with `address & 0x3FFF`), executor, marketId, poolId, orderId; for each, "no code yet", "expected code already present, stage skipped", or a refusal |
| `MARKET` | asset, payout, `rateE18` and its human form, fee, tick spacing, the opening tick and sqrtPriceX96, the opening rate against RATE, the oracle policy (all zero, `enabled = false`), caps, `demonstrationOnly = true` |
| `SEED` / `ORDER` | stage C: range, L, tokenId, the payout-only maxima; stage D: recipient, payer, amountIn, minOut and how it was computed, deadline |
| `TX COUNT` | the transactions this SEND broadcasts, numbered with their predicted nonces, skipped steps named |
| `GAS` | forge's simulated gas per transaction and in total, the L1 data-fee range, the gas limit forge will set, the spend ceiling (twice the upper estimate) and the balance against it; every figure labelled ESTIMATE |
| `READBACK` | the exact `readback.sh <stage>` command and its row count |
| `VERIFICATION` | the stage H command for each contract this stage created, with its constructor-argument length |
| `LABELS` | "Testnet demonstration — no-value tokens"; "demonstration rate set by the admin"; Chainlink "planned" |

The block never prints an RPC URL, a keystore password, or any value read from `.env`. A plan block missing a label
fails its `deploy.test.sh` row, so the prompt cannot appear without it.

## 4. Stage A — infrastructure (1 transaction, 1 SEND)

**Sender.** ADMIN on 46630 is the deployer EOA `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73` (source:
`docs/experimental/STOCK-46630-DEPLOY-PLAN.md`; SC §4). PAUSER stays zero (none) on 46630; ADMIN can pause (SC §15
choice 2). No order creator is added: ADMIN is implicitly one (SC §4).

**A1.** `UnicaMarketFactory` created with CREATE2 through the deterministic deployer named in the chain file
(`create2Deployer`, `0x4e59b44847b379578588920cA78FbF26c0B4956C`, source: `config/chains/46630.json`, MCP and DR B3),
with a committed `FACTORY_SALT`. Its constructor runs `REGISTRY = new UnicaMarketRegistry(admin_, requireOracle_)`,
so the registry lands at `CREATE(factory, 1)` (SC §3, §7).

| Contract | Constructor arguments (SC §6, §7) | Encoded length |
| --- | --- | --- |
| UnicaMarketFactory | `admin_` = deployer; `poolManager_` = the chain file's PoolManager (**`null` today**, §1); `hookCreationCodeHash_` = keccak256 of `type(UnicaMarketHook).creationCode` from the tagged build; `requireOracle_` = `false` | 128 bytes |
| UnicaMarketRegistry | `admin_` = deployer; `requireOracle_` = `false` (created inside A1, not a separate transaction) | 64 bytes |

DR B6 gave 96 and 32 bytes; the specified `requireOracle` argument adds 32 to each.

**Why CREATE2** (DR B3; an owner choice, §11): the factory, registry, marketIds, hook arguments and mined salts stop
depending on the deployer's nonce, so they are printed and committed before stage A, a stray transaction cannot
invalidate a salt, and stage B's salt can be mined first against a factory simulated at its address (DR B3, B9). The
wrapper refuses if the predicted address holds other code, and skips the stage if it holds the expected code. Cost:
the factory becomes an internal creation for the explorer, like the other three, so §8 supplies explicit arguments.

**The size canary.** The factory's creation input is about 37–41 KB (ESTIMATE, SC §12); the largest input proven on
46630 is 16,870 bytes (DR B5; its ~95,000-byte Nitro default is an unverified ESTIMATE). No estimate, simulation or
fork applies a sequencer's size limit (DR B5, C19); a refusal happens at submission, is fail-safe and consumes no nonce.
SC §12's first cuts remove only view code and cannot bring 37 KB near the proven size. Decided in advance: if A1 is
refused for size, nothing else is sent, the refusal is recorded as evidence, and IMPLEMENTATION-PLAN §8 cut 10 applies,
unless a two-code-store fallback (code moved out of the factory's initcode, a binding change, SC §12) was built and
reviewed with its own rows before stage A; none is designed today. Learning the limit earlier is the owner's choice:
an owner-run, no-value 46630 size probe (about 41 KB, inert; STOP-FUND, STOP-SIGN) before CP3, or that fallback
designed now. Stage B's 36–39 KB call (ESTIMATE) is re-tested by its own submission.

**Gas, ESTIMATE.** The prototype factory CREATE used 6,090,352 L2 gas at 29,138 bytes; CREATE2 through the
deterministic deployer added 12,773 (DR B3, B4). Scaled to SC §12's sizes at 200 gas per deposited runtime byte and 16
per calldata byte: about 7.8M–8.8M L2 gas, plus an L1 fee at 8.43–15.41 L1 gas per input byte (the frozen receipts'
range, DR B4), about 0.31M–0.63M. Forge's 1.3× limit excludes the L1 part on Nitro (DR B4). The plan's figure replaces
this.

**Readback A** (`readback.sh A`), every row against the manifest's expected values:

| Row | Assertion |
| --- | --- |
| A-1 | the A1 receipt has status 1; its `to` is the deterministic deployer; block and hash recorded |
| A-2 | the factory's runtime code equals the code the simulation produced for the same salt and arguments |
| A-3 | `factory.REGISTRY()` equals `CREATE(factory, 1)` and the printed prediction; `registry.FACTORY()` is the factory |
| A-4 | `registry.admin()` is the deployer; `pendingAdmin()` and `pauser()` are zero |
| A-5 | `registry.REQUIRE_ORACLE()` is `false`, matching the chain file |
| A-6 | `factory.POOL_MANAGER()` equals the chain file's PoolManager, and code is there |
| A-7 | `factory.HOOK_CREATION_CODE_HASH()` equals the hash of the tagged build |
| A-8 | `registry.marketCount()` is 0, and the deployer's nonce advanced by exactly one |

**Records.** `FOUNDRY_BROADCAST=broadcast/unica-v4/46630/infra` (§9.1). After A, the owner commits
`infra.env` (factory, registry, `FACTORY_SALT`, the A1 hash and block, `forge --version`, `HOOK_CREATION_CODE_HASH`),
the broadcast directory and `readback-A.json`, one idea per commit.

## 5. Stage B — the TSLA market (1 transaction, 1 SEND)

### 5.1 The market file

`script/unica-v4/markets/46630/tsla-utusd.env`, committed, whitelisted keys only. Its header states that faucet stock
tokens and uTUSD have no real-world value and that `RATE` is a demonstration rate set by the admin.

| Key | Value | Source |
| --- | --- | --- |
| `ASSET_TOKEN` | `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` (TSLA, faucet test token, 18 decimals) | `config/chains/46630.json`; CA §7 |
| `PAYOUT_TOKEN`, `EXPECT_PAYOUT_TOKEN` | `0xfb93352698150e720Bf0A321DEf3aC98D90B9874` (uTUSD, no-value test token, 6 decimals) | `config/chains/46630.json`; DR B1 |
| `EXPECT_PAYOUT_MINTER` | the deployer; the C2 mint runs only when `MINTER()` equals it (DR B1) | SC §4 |
| `RATE` | `395000000000000000000` (395 whole uTUSD per whole TSLA × 1e18), a demonstration rate | Q110 |
| `FEE`, `TICK_SPACING` | `3000`, `60` — one of the only three pairs the factory accepts: `(500,10)`, `(3000,60)`, `(10000,200)`; any other pair reverts `FeeTierUnsupported(uint24, int24)` (S1) | SC §7 |
| `SEED` | `100000000` raw (100 uTUSD) | Q110 |
| `CAP_PER_TX`, `CAP_PER_DAY`, `CAP_SEED` | `10000000`, `25000000`, `100000000` raw uTUSD; they exercise the mechanism, and bound nothing of value | Q5–Q7; SC §9.2 |
| `ORACLE_*` | all zero, `enabled = false`; accepted only because the registry's `requireOracle` is `false` | SC §6; SOC §3 |
| `EXPECT_ASSET_IMPLEMENTATION`, `EXPECT_ASSET_IMPL_CODEHASH` | **pending**: recorded in evidence by a read-only probe before stage B (§1) | DR A7 |
| `SALT` | written by `deploy.sh mine`, then committed | §5.3 |

### 5.2 Pre-flight, read-only, before the plan block

- **Asset.** The address equals the committed pin, which is the real defence against look-alike tokens: TSLA and NFLX
  share one beacon, and at least five "NFLX Test Stock" look-alikes exist, so a beacon check proves nothing about
  identity (DR C8). The beacon's `implementation()` and that address's code hash equal the recorded values;
  `paused()` is `false`; `uiMultiplier()` is `1e18`; `decimals()` is 18 (DR A7).
- **Payout.** The address equals `EXPECT_PAYOUT_TOKEN`; `decimals()` is 6; `MINTER()` is read and printed.
- **Market.** `factory.previewMarket(config)` in simulation returns marketId, version 1, the 288-byte hook arguments
  and the record; `liveMarketOf(TSLA, uTUSD)` is zero.
- **The $100 total, S5: a deployment-script and manifest refusal, never an on-chain invariant.** Before this SEND the
  wrapper pages `registry.getMarkets(offset, 100)` to the end, requires the paged total to equal `marketCount()`, and
  requires every `statusOf` and `capsOf` read in the page to succeed; it sums `maxSeedPayout` over every non-RETIRED
  market plus this proposed one and refuses above `100000000` raw of uTUSD. Any RPC error, short page, count
  mismatch, or non-RETIRED market on a different payout token fails closed. The plan block and the manifest (§9.2)
  record the enumerated marketIds, the block read, and the sum.

### 5.3 Salt mining

`DRY_RUN=1 script/unica-v4/deploy.sh mine script/unica-v4/markets/46630/tsla-utusd.env` needs no key and sends nothing.
It hashes the creation code and the hook arguments once, then tries `SALT = bytes32(i)` from 0 upward and accepts the
first CREATE2 address from the factory whose low 14 bits are exactly `0x20C0` and which has no code; it expects about
16,384 tries (2^14) and stops with a refusal at a fixed cap. It writes `SALT` into the market file.
LIVE mode re-derives the address and refuses a missing salt, missing bits or existing code. Publishing a salt early is
safe: `PoolManager.initialize` naming the empty predicted address reverts `InvalidHookResponse` (DR A5; SC §7 row F18).

### 5.4 The transaction

**B1.** `factory.createMarket(MarketConfig c, bytes32 salt, bytes hookCreationCode)` (SC §7), with `c` from §5.1 and
the creation code of the tagged build. It CREATE2-deploys the hook (288-byte arguments), whose constructor creates the
executor at `CREATE(hook, 1)` (224-byte arguments), and registers the market PROPOSED with `demonstrationOnly = true`.

The plan prints the predicted marketId (`keccak256(abi.encode(46630, registry, TSLA, uTUSD, 1, address(0), bytes32(0)))`,
adapter and feedId zero for this demonstration market; S8's on-chain route binding), hook, executor,
poolId and `previewMarket`'s opening values. The prototype opened this shape at tick −216540, 394.691222 uTUSD per
TSLA against RATE 395 (DR §1.2); the plan prints the on-chain preview, never these prototype figures.

**Gas, ESTIMATE.** The prototype createMarket used 6,194,189 L2 gas at 31,076 bytes of calldata (DR B4). With the
larger hook and executor of SC §12 and the registry's extra writes: about 7.3M–8.1M L2 gas, plus an L1 fee of
0.30M–0.60M (36–39 KB × 8.43–15.41). The plan's simulated figure replaces this.

### 5.5 Readback B

| Row | Assertion |
| --- | --- |
| B-1 | the B1 receipt has status 1; `to` is the factory; `from` is the deployer |
| B-2 | `statusOf(id)` is PROPOSED (1); the registry emitted `MarketStatusChanged(id, 0, 1)` and `MarketProposed` with every field equal to the plan (SC §6, row R10) |
| B-3 | `getMarket(id)` equals the plan and `previewMarket`: asset, payout, version 1, rate, opening price and tick, fee, spacing, decimals 18 and 6, ordering, `demonstrationOnly = true` |
| B-4 | `hook & 0x3FFF == 0x20C0`; the hook's runtime code equals the simulation's |
| B-5 | `executor == CREATE(hook, 1)`; `hook.EXECUTOR()` is the executor; `executor.HOOK()` is the hook; `hook.FACTORY()` is the factory |
| B-6 | `marketIdOfHook(hook)`, `marketIdOfExecutor(executor)` and `marketIdOfPool(poolId)` all equal `id` (row R9) |
| B-7 | `oraclePolicyOf(id)` is all zero with `enabled = false`; `capsOf(id)` equals the market file |
| B-8 | `liveMarketOf(TSLA, uTUSD)` is `id`; `latestVersion` is 1; `marketCount()` is 1 |
| B-9 | keccak256 of the creation code inside the B1 calldata equals `HOOK_CREATION_CODE_HASH` |
| B-10 | the pool is not yet initialised: its `slot0` sqrtPriceX96 is zero |

**Records.** `FOUNDRY_BROADCAST=broadcast/unica-v4/46630/tsla-utusd` for stages B, C and D (§9.1).

## 6. Stage C — initialise, seed, then activate (up to 7 transactions, 2 SENDs)

Activation follows readback (Q115; SC §5 row 4), so stage C is two SENDs: C1 to C6, then `readback.sh C`, then C7
alone. The wrapper refuses the C7 prompt unless `readback-C.json` exists for this marketId and reports 0 failed.

### 6.1 The seed

The LP is the deployer, through the chain file's PositionManager (**`null` today**, §1), never a test router, which
would own the position; only the NFT owner can withdraw, not ADMIN (SC §4). The range comes from the factory's shared
library (SC §7): a demonstration market takes `W = ceil(6960 / spacing) × spacing`, the frozen range
(`script/experimental/StockSettlement46630.s.sol:84`), 6960 at spacing 60. TSLA is currency0, so the position is
`[initTick − W, initTick]`, payout only, its upper tick the opening tick: no payer crosses an empty range, the frozen
deployment's defect (SC §1.1). L is sized from 999/1000 of `SEED`, the frozen margin (same file, line 522).

### 6.2 Transactions

| # | Call | Frozen live equivalent, gas used |
| --- | --- | --- |
| C1 | `factory.initializeMarket(id)`: `PoolManager.initialize(poolKeyOf(id), initSqrtPriceX96)`, returned tick checked against `initTick` | 65,035 for a direct initialize; this one adds the factory and the hook's `beforeInitialize` |
| C2 | `uTUSD.mint(deployer, SEED)`, only when `MINTER()` is the deployer and the balance is below `SEED`; otherwise a balance of at least `SEED` is required, refused by name (DR B1) | 73,404 |
| C3 | `uTUSD.approve(Permit2, SEED)` | 51,158 |
| C4 | `Permit2.approve(uTUSD, PositionManager, SEED, now + 1 day)` | 53,744 |
| C5 | `PositionManager.modifyLiquidities`: `MINT_POSITION` over the range with the asset maximum 0 and the payout maximum `SEED`, owner the deployer, then `SETTLE_PAIR`. A range mistake that asks for the asset reverts instead of spending it. | 369,715 |
| C6 | `factory.markSeeded(id, L)`: depth at the opening tick at least L, and the seed's payout-equivalent at most `CAP_SEED` (SC §7) | new; no in-repo measurement |
| C7 | `registry.activate(id)`, second SEND, after readback C | new; no in-repo measurement |

Frozen figures are the receipts in `broadcast/StockSettlement46630.s.sol/46630/pool-latest.json`, committed under the
tag. **Stage ESTIMATE:** about 0.8M–0.9M L2 gas plus a small L1 fee; the plan's simulated figures replace it.

### 6.3 Readback C (before C7), then C-11 (after C7)

| Row | Assertion |
| --- | --- |
| C-1 | every sent receipt has status 1; the deployer's nonce advanced by exactly the number of non-skipped transactions the plan printed (DR C16) |
| C-2 | the PoolManager's `Initialize` log is in the C1 transaction and that transaction's `to` is the factory; the event has no initialiser field, so the transaction is the proof (DR A3) |
| C-3 | the pool's `slot0` sqrtPriceX96 equals the recorded `initSqrtPriceX96` and its tick equals `initTick` (DR §2.2 decision 6) |
| C-4 | `slot0` lpFee is 3000; the protocol fee is read and recorded, 0 expected at this block and changeable by the PoolManager owner at any time (DR A9) |
| C-5 | the seed NFT's owner is the deployer, its ticks are the printed range, and `getPositionLiquidity(tokenId)` equals L (DR A10) |
| C-6 | `seedDepth` is at least L, and `MarketSeeded(id, depth)` was emitted; third-party liquidity can inflate the depth, never reduce it (DR A10) |
| C-7 | the deployer's TSLA balance is unchanged across C1 to C6: no asset was spent |
| C-8 | `statusOf(id)` is SEEDED, with `MarketStatusChanged` 1 → 2 in C1 and 2 → 3 in C6 |
| C-9 | residual allowances are read and printed, never claimed zero: the deployer's uTUSD allowance to Permit2 and Permit2's allowance to the PositionManager until its expiry |
| C-10 | the hook's computed-condition view reports the demonstration-only condition, with zero reference fields (SC §8.2; SOC §6) |
| C-11 | after C7: `statusOf(id)` is ACTIVE, `MarketStatusChanged` 3 → 4 in C7, and `executionTermsOf(id)` returns ACTIVE with the file's caps |

A seed withdrawn after activation is not re-detected; settlement then fails safe until someone pauses (SC §7, DR §2.2
decision 7). The runbook's answer is ADMIN's pause.

## 7. Stage D — one payer-bound settlement (3 transactions, 1 SEND)

### 7.1 The settlement file

`script/unica-v4/settlements/46630-tsla.env`, committed; settlement inputs are not market configuration (DR B9).

| Key | Value | Source |
| --- | --- | --- |
| `MERCHANT` | `0x19E56831a10d43CfF5d77f886c799C6b916da7Ae`, the order's recipient. Whether the owner controls it is UNKNOWN / NOT PROVIDED, so no document calls it owner-controlled. | Q110 |
| `PAYER` | the deployer, the address the order names; only it can pay (`WrongPayer`) | Q111, Q128 |
| `PAY_AMOUNT` | `1000000000000000` raw (0.001 TSLA, exact input) | Q110 |
| `ORDER_SALT` | a fresh bytes32; the wrapper refuses one whose orderId already exists | SC §9.1 |
| `DEADLINE_SECONDS` | `86400`; the contract sets no ceiling (SC §9.1) | this file |
| `SLIPPAGE_BPS` | the allowance below the simulated delivery used for `minOut`; printed | this file |

**`minOut`** is computed at SEND time, never copied from an earlier run: the wrapper simulates `pay` against the live
pool, reads `feeRates()` from the hook in the same simulation (the protocol fee can change at any block, DR A9), and
sets `minOut = floor(simulated delivery × (10⁴ − SLIPPAGE_BPS) / 10⁴)`. It refuses a `minOut` above `CAP_PER_TX`,
which `createOrder` would refuse anyway (`OrderAboveCap`, SC §9.2).

### 7.2 Transactions, all from the deployer

| # | Call | Frozen live equivalent, gas used |
| --- | --- | --- |
| D1 | `executor.createOrder(MERCHANT, PAYER, PAY_AMOUNT, minOut, now + DEADLINE_SECONDS, ORDER_SALT)`; ADMIN is implicitly an order creator; the plan prints `orderId = keccak256(abi.encode(46630, executor, deployer, ORDER_SALT))` | 254,497 |
| D2 | `TSLA.approve(executor, PAY_AMOUNT)`, the exact amount, never an unlimited approval | 68,294 |
| D3 | `executor.pay(orderId)` from `PAYER` | 353,792; UNICA v4 adds the caps accounting and four fee fields |

Frozen figures are the receipts in `broadcast/StockSettlement46630.s.sol/46630/settle-latest.json`. **Stage
ESTIMATE:** about 0.7M–0.8M L2 gas plus a small L1 fee; the plan's simulated figures replace it.

### 7.3 Readback D

| Row | Assertion |
| --- | --- |
| D-1 | three receipts with status 1; the deployer's nonce advanced by three |
| D-2 | `OrderCreated` came from the executor with recipient `MERCHANT`, creator and bound payer the deployer, and the file's amount, `minOut` and deadline; the orderId equals the prediction |
| D-3 | `orders(orderId).status` is Settled (3); `hook.receiptCount()` and `executor.orderCount()` each rose by one |
| D-4 | `Settled` was emitted by `getMarket(id).executor`, the emitter check consumers must apply (SC §3), with currencyIn TSLA, currencyOut uTUSD, amountIn `PAY_AMOUNT` and amountDelivered |
| D-5 | `SettlementReceipt` was emitted by `getMarket(id).hook` in the same transaction: `hookFeePips` 0; `lpFeePips` the pool's lpFee; `protocolFeePips` the direction's half; `swapFeePips` equal to the same transaction's PoolManager `Swap.fee`, never a constant (DR A9, SC §11); `referencePrice`, `referenceDecimals` and `referenceUpdatedAt` zero; `demonstrationOnly` true |
| D-6 | the merchant's uTUSD increase equals amountDelivered and is at least `minOut`; the payer's TSLA decrease is exactly `PAY_AMOUNT`; the payer's allowance to the executor is 0 afterwards |
| D-7 | the executor's and hook's balances of both tokens are unchanged across D3 (SC §9.1 step 5; invariant I1 as restated, SC §9.3) |
| D-8 | `payoutUsedOnDay(block.timestamp / 86400)` equals amountDelivered, within both caps |
| D-9 | refusals, proven in REHEARSE on a fork of the block after D3, nothing sent to the chain: a second `pay` reverts `OrderNotOpen`; a funded, approved stranger paying a fresh order bound to the deployer reverts `WrongPayer`, and the bound payer then settles; a stranger's `createOrder` reverts `NotOrderCreator`; a direct swap on the pool reverts with the hook's `NotSettlementExecutor` as the inner selector. Each names its selector; none is a bare revert (DR C5). |

**Honest wording for this result** (the frozen record's lesson): the deployer created and paid one order through the
market's Uniswap v4 pool; 0.001 of the faucet test token TSLA went in and a no-value test token reached a separate
recipient, at a demonstration rate the admin set, against the deployer's own seed, with the oracle off. It is not a
customer payment and not a priced settlement.

**Stages E, F and G** are reserved for NFLX and are not run: its rate is NOT SELECTED (Q110). NFLX is proven
configuration-only in local tests, and on the 46630 fork by row V1, which reads a `test/unica-v4/` fixture rate
labelled "test fixture — not an approved demonstration rate," never a `script/unica-v4/markets/` value
(`DECISIONS.md` "Specification choices"; IMPLEMENTATION-PLAN §1). `config-only.test.sh` enforces that an
onboarding commit touches only data files under `script/unica-v4/markets/<chainId>/` and `script/unica-v4/settlements/`
(DR B9, C16).

## 8. Stage H — source verification (0 transactions)

Mandatory (rec 103), but not automatic: it publishes source to two outside services, so it runs only on the owner's
separate go (Q131). `script/unica-v4/verify.sh` runs from the release tag with the unchanged `foundry.toml`, for the
four UNICA v4 contracts of this rehearsal; the frozen contracts are not part of it.

| Contract | How it was created | Constructor arguments supplied |
| --- | --- | --- |
| UnicaMarketFactory | CREATE2 through the deterministic deployer (A1) | 128 bytes, copied from the A1 input recorded in the manifest |
| UnicaMarketRegistry | CREATE inside the factory's constructor | 64 bytes: `abi.encode(admin, false)` |
| UnicaMarketHook (TSLA) | factory CREATE2 (B1) | 288 bytes: the hook arguments `previewMarket` returned |
| UnicaMarketExecutor (TSLA) | CREATE inside the hook's constructor | 224 bytes: `abi.encode(poolManager, registry, marketId, asset, payout, fee, tickSpacing)` |

None was created directly by an EOA, so `--guess-constructor-args` cannot work and arguments are explicit (DR B6).
Per contract, in order: `forge verify-contract <address> <path>:<Name> --chain 46630 --compiler-version 0.8.30
--constructor-args <hex> --verifier sourcify`, then the same with `--verifier blockscout --verifier-url` set to the
chain file's `explorer.verifierUrl`. The profile forge submits was measured under forge 1.3.5 (DR B6): standard JSON,
solc 0.8.30, optimizer off, `viaIR` false, cancun, `bytecodeHash` none, `appendCBOR` false. CI pins v1.5.1
(`.github/workflows/ci.yml`); `HOOK_CREATION_CODE_HASH` and the Sourcify match depend on the toolchain, so the owner's
`forge --version` is recorded at CP1 and, before the tag, the owner installs CI's pin or the profile is re-measured
under the owner's version; `infra.env` records which (IMPLEMENTATION-PLAN §2). Without CBOR metadata the
repository's precedent is Sourcify's partial tier, "match", not "exact_match"; the tier is recorded as returned.
Unproven here: that Blockscout accepts such a build and internally created contracts (DR B6). Rehearsing on the
frozen hook first would publish the frozen source, so that is an owner decision, not a step.

**Readback H.** After submitting, the tool queries each explorer read-only (Sourcify at
`https://sourcify.dev/server/v2/contract/46630/<address>`, DR B6; the Blockscout API for the address) and writes
`deployments/unica-v4/46630/verification.json`: per contract and explorer, the query URL, UTC time, HTTP status and
returned status. A submission's own success message is not evidence; only the query is. A failed query (the probe met
HTTP 403 behind a challenge on the Robinhood Blockscout API, MCP) records `not verified (query failed)`. Row H-1 fails
unless all eight entries exist.

## 9. Stage I — broadcast records and the manifest (0 transactions)

### 9.1 Per-market broadcast directories

forge overwrites `<entry point>-latest.json` on the next run of the same entry point, so a directory shared by
markets silently loses the earlier market's records (DR B2, measured). The wrapper sets `FOUNDRY_BROADCAST` per scope,
with forge's own layout beneath: `broadcast/unica-v4/46630/infra/` for stage A, and
`broadcast/unica-v4/46630/tsla-utusd/` for B, C and D (a later market gets its own, named after its file). Every
`run-*.json` is committed with the `*-latest.json` files, since a resumed stage adds run files. The `broadcast/` half
holds no RPC URL; the half that does stays under forge's ignored `cache/` (DR B8), and `manifest.test.sh` fails if
any committed record contains a URL.

### 9.2 The manifest, `deployments/unica-v4/46630.json`

Schema `unica-v4-manifest/1`, written by `script/unica-v4/manifest.sh` from the committed broadcast records, the
readback files, `verification.json` and read-only calls. It reads every run file, keys each transaction by marketId
and contract address, and refuses a market whose transactions are not each found exactly once (DR B2). Values below
are shapes, not data: every address comes from a receipt or a chain read, never typed in.

```json
{
  "schema": "unica-v4-manifest/1", "release": "UNICA v4", "manifestVersion": 1, "chainId": 46630,
  "network": "testnet", "label": "Testnet demonstration — no-value tokens", "chainlink": "planned",
  "source": {"tag": "<tag>", "commit": "<sha>", "forgeVersion": "<string>", "hookCreationCodeHash": "<bytes32>",
             "compiler": {"solc": "0.8.30", "optimizer": false, "viaIR": false, "evmVersion": "cancun",
                          "bytecodeHash": "none", "appendCBOR": false}},
  "dependencies": {"<name>": {"address": "<from config/chains/46630.json>", "source": "<evidence reference>"}},
  "tokens": [{"symbol": "TSLA", "address": "<address>", "decimals": 18, "value": "none: faucet test token"},
             {"symbol": "uTUSD", "address": "<address>", "decimals": 6, "value": "none: no-value test token"}],
  "roles": {"admin": "<deployer>", "adminKind": "deployer-eoa", "pendingAdmin": null, "pauser": null},
  "factory": {"address": "<address>", "salt": "<bytes32>", "tx": "<A1 hash>", "block": "<n>", "args": "<hex>"},
  "registry": {"address": "<address>", "requireOracle": false, "createdIn": "<A1 hash>"},
  "markets": [{"marketId": "<bytes32>", "version": 1, "status": "<stored status>", "demonstrationOnly": true,
    "asset": "<address>", "payout": "<address>", "rateE18": "395000000000000000000",
    "rateLabel": "demonstration rate set by the admin", "fee": 3000, "tickSpacing": 60,
    "initTick": "<int24>", "initSqrtPriceX96": "<uint160>", "hook": "<address>", "executor": "<address>",
    "poolId": "<bytes32>", "salt": "<bytes32>", "hookArgs": "<hex>", "executorArgs": "<hex>",
    "oraclePolicy": {"adapter": null, "feedId": null, "maxAge": 0, "maxDeviationBps": 0, "enabled": false},
    "caps": {"maxPerTxPayout": "10000000", "maxPerDayPayout": "25000000", "maxSeedPayout": "100000000"},
    "seed": {"tokenId": "<uint>", "tickLower": "<int24>", "tickUpper": "<int24>", "liquidity": "<uint128>",
             "seedDepth": "<uint128>"},
    "transactions": [{"step": "<B1 to D3>", "hash": "<hash>", "block": "<n>", "nonce": "<n>", "gasUsed": "<n>"}],
    "settlement": {"orderId": "<bytes32>", "payer": "<address>", "recipient": "<address>", "amountIn": "<uint>",
      "minOut": "<uint>", "amountDelivered": "<uint>", "payTx": "<hash>",
      "receipt": {"hookFeePips": 0, "lpFeePips": "<read>", "protocolFeePips": "<read>", "swapFeePips": "<read>",
                  "referencePrice": "0", "referenceDecimals": 0, "referenceUpdatedAt": 0, "demonstrationOnly": true}},
    "readback": {"A": "<file>", "B": "<file>", "C": "<file>", "D": "<file>"}}],
  "verification": {"<address>": {"sourcify": {"status": "match | exact_match | not verified", "query": "<url>",
    "checkedAt": "<UTC>"}, "blockscout": {"status": "verified | not verified", "query": "<url>", "checkedAt": "<UTC>"}}},
  "earlierDeployment": {"tag": "experimental-46630-settled", "note": "separate earlier generation; not UNICA v4"}
}
```

`verified` appears for a contract only when its `verification.json` entry holds an explorer query that returned a
verified status, with the query URL and time beside it; everything else is `not verified`. The frozen generation is
named only as a separate earlier deployment; its addresses never appear under a UNICA v4 key.

### 9.3 What `manifest.test.sh` must refuse

Offline, each with a planted input and a passing control (DR C12): a failed or missing verification query that
produces anything but `not verified`; a missing required field (chain id, source tag, factory, registry, marketId,
poolId, hook, executor, tokenId, any transaction hash or block); any URL of an RPC endpoint; the frozen hook
`0xAe1975f223824b5851564277656ebAC21667E0c0` or executor `0x613dadd395E0bB1A7AC4A843Aca408C3af8e16cE` (source:
`docs/experimental/STOCK-46630-DEPLOY-PLAN.md`) under a UNICA v4 key; a `MOCK` adapter; `demonstrationOnly: false`
with a disabled policy; a market whose transaction count differs from its readback files; a deleted TSLA run file
(DR B2); a manifest or market file naming a `fee`/`tickSpacing` pair other than `(500,10)`, `(3000,60)` or
`(10000,200)`, or missing either value (S1); a proposed or recorded market whose enumerated seed sum, page count,
or non-RETIRED payout token would violate the S5 $100 total-at-risk check of §5.2. The UNICA v4 claims check also
runs over the manifest (DR C17).

## 10. Mainnet

**No mainnet deployment is authorised.** Q132 is unanswered, so nothing is deployed on any mainnet: no registry, no
factory, no adapter, not even no-value infrastructure. "Mainnet before submission" is a product goal, not permission
to bypass a gate (standing ruling), and a value-moving transaction is never forced to meet the deadline (Q2).
`config/chains/42161.json` stays present and `enabled: false`, and `script/mainnet-guard.sh` keeps refusing every
mainnet chain id until a reviewed change, which waits on Q9 and Q132 (SOC §12.2).

### 10.1 Gates, every one required

| Gate | Evidence that closes it | State today |
| --- | --- | --- |
| M1 Any mainnet infrastructure (Q132) | the owner's answer, with the Safe and the reviewer ready | **unanswered — BLOCKER** |
| M2 Chain (Q9, Q11) | the owner confirms a chain (the probe recommends Arbitrum One, MCP; Robinhood Chain 4663, which the owner prefers but does not require (Q11), fails the probe on Circle USDC, Privy and the sequencer feed: evidence, not a decision; Q9 and Q11 remain the owner's); a reviewed commit enables its file; the mainnet guard is changed in review | **OPEN — BLOCKER** |
| M3 Safe as ADMIN (Q64, Q62–Q63) | chain, address, signers, threshold and hardware-wallet control verified, and a test transaction executed | **NOT READY — BLOCKER** |
| M4 PAUSER (Q70, Q65) | a separate pause-only key assigned; pause rehearsed on a fork; only the Safe unpauses | **NOT READY — BLOCKER** |
| M5 Launch gate (Q71) | readiness under the accepted gates (recs 72–75); the ledger records only that it is not ready and blocks a launch | **NOT READY — BLOCKER** |
| M6 RPC (Q91) | a primary and a fallback provider selected behind `ARBITRUM_MAINNET_RPC_URL` (the one name now ruled across the set, SR1 row 14); the helper refuses while it is unset | **NOT SELECTED — BLOCKER** |
| M7 Accounts and payment (Q95) | owned and paid accounts for RPC, hosting, and any paid Chainlink product | **NOT PROVIDED — BLOCKER** |
| M8 Legal scope (Q20, Q16, Q23) | counsel's review | **NO CONFIRMED REVIEW — BLOCKER**: no legal claim, no equity scope; crypto assets only at launch (recs 15, 21) |
| M9 Merchant terms (Q108) | terms ready | **NOT READY — BLOCKER**: no public merchant beta; invited or founder-controlled merchants only (Q31, Q35) |
| M10 Publication (Q131) | two separate approvals: push, then the Pages rebuild | **NO AUTHORIZATION — BLOCKER** |
| M11 Authenticated oracle (Q30, Q25) | registry `requireOracle = true`; fork rows OF1–OF8 (TEST-MATRIX §9) executed with zero skips and recorded in `docs/unica-v4/evidence/ORACLE-FORK-42161.md`; the Arbitrum feed descriptions recorded (SOC §16 item 2); a feed-cadence evidence file; `maxAge` at most 300 s, the on-chain ceiling for this release (S4) — a longer crypto maxAge needs a ledger amendment and a new release, never a helper exception; the minimum availability `A(maxAge)` and the sequencer grace period set by the owner (SOC §16 items 4–5) | **BLOCKER**: not started; Chainlink **planned** |
| M12 Asset and seed | an asset token recorded in evidence (none is today, SOC §16 item 9); this market's `maxSeedPayout` enforced on-chain at `markSeeded`, from a founder-controlled Safe, sized to the band (SC §7); price impact measured against the band (SOC §16 item 12) | **BLOCKER**: open |
| M13 Caps (Q5–Q7) | per-market, on-chain and read back: $10 per transaction, $25 per day, $100 seed, in the payout token's units. The $100 **cross-market total** is not an on-chain field: it is the S5 deployment-script and manifest refusal (§5.2), which reads back every registered market before each SEND and fails closed on any enumeration error | specified (SC §7, §9.2), not deployed |
| M14 Keys and gas (Q101, Q102) | a fresh EOA funded only for gas; ADMIN moved to the Safe by `transferAdmin` and the Safe's `acceptAdmin` before any market leaves SEEDED (SC §2); the gas budget set after simulating on the chosen chain | **BLOCKER**: blocked by M2, M3 |
| M15 Verification and readback (Q2, rec 103) | every contract's source publicly verified and every stage independently read back, as §4 to §8 | not started |
| M16 Monitoring (Q92, U7) | an event watcher and explorer alerts; an implementation-change monitor that triggers the pauser | not built |
| M17 Testnet first | the 46630 stages A to D, H and I complete, every readback 0 failed | not started (§1) |

Privy (Q96 to Q100) is not a contract gate: it ships only if its credentials are ready by 12 Sep 12:00 UTC, otherwise
it is deferred and no surface shows it working.

### 10.2 The sequence, if every gate closes

The same wrapper, stages and readbacks as §4 to §9 on the enabled mainnet file, except: `requireOracle` is `true`, so
`createMarket` reverts without an enabled policy; stage A adds `transferAdmin(safe)` and the Safe's `acceptAdmin`; the
Safe sets the pauser and order creators and sends `activate` after readback; stage D is the one capped real-value
settlement, sent only if every gate is green at that moment. Safe signers review and sign in the Safe; only the owner signs.

### 10.3 Launch-abort conditions

The ledger accepts recs 72 to 75 (safety gates and launch-abort conditions) by number without recording their text,
so this list is this file's reading of the ledger, for the owner to confirm. Any one stops the mainnet sequence:
nothing further is sent, a live market is paused, and the incident procedure runs (Q69: pause, publish a notice,
preserve evidence, investigate, redeploy if necessary).
1. A gate of §10.1 is not green at the moment of a SEND, or would have to be skipped to meet 12 Sep 16:00 UTC (rec 3,
   Q2).
2. The RPC reports a different chain id, or a required address has no code or an unexpected code hash (SOC §12.2).
3. Any readback row fails, or any contract's verification query does not return verified.
4. The oracle route cannot price the market now: an adapter error, a stale or future timestamp, the sequencer down or
   inside its grace period (SC §8.2, SOC §4.1), or measured availability below the owner's minimum.
5. The simulated settlement falls outside `maxDeviationBps`, or the seed cannot carry one maximum payment inside the
   band (SC §8.3).
6. An implementation behind any pinned proxy or beacon changes, the payout token's included (U7).
7. The Safe cannot execute: a signer or the hardware wallet is unavailable, or the threshold cannot be reached.
8. The simulated gas exceeds the Q102 budget, or the deployer EOA holds more than gas money (Q101).
9. A public claim would outrun its evidence.

### 10.4 Q10 and Q120: a missing gate cancels the mainnet settlement, not the submission

A value-moving launch needs every required capability; a missing one cancels the mainnet settlement, not the
submission (Q10). The submission is then the independently verified testnet result plus the fork oracle evidence,
never represented as mainnet or oracle-live (Q120): the UNICA v4 46630 manifest with each contract's verification
status as queried, its readback files, and the OF1–OF8 evidence file `docs/unica-v4/evidence/ORACLE-FORK-42161.md`
(TEST-MATRIX §9), the single file that unlocks the exact wording "Chainlink integration demonstrated on a fork", used
only after those rows pass with zero skips (Q125), otherwise "planned". Those rows need an owner-provided endpoint that
serves the pinned block (Q91 NOT SELECTED, Q95 NOT PROVIDED). "Capped mainnet beta" is used only if tier 2 passes (rec 81). Mainnet success, when it comes, means
contracts deployed, source verified, independently read back, and one capped real-value settlement (Q2).

## 11. Choices this file makes, and open issues

Compatible with the ledger and the two specifications, but not decided in them; the owner confirms:
1. The factory is created with CREATE2 through the chain file's deterministic deployer (DR B3), not plain CREATE.
2. PAUSER stays zero on 46630; ADMIN (the deployer) pauses there.
3. The wrapper is chain-generic, `script/unica-v4/deploy.sh`, not the design's `unica-v4-46630.sh`.
4. Stage C takes two SENDs so that activation follows a passing readback (Q115).
5. The launch-abort list of §10.3.

Open before stage A: the 46630 Uniswap v4 addresses and the TSLA beacon fingerprint in evidence (§1). The
SC/SOC naming conflicts recorded as SR1 rows 1–14 and 18 are reconciled (`DECISIONS.md` "Specification choices"
S1–S8; `IMPLEMENTATION-PLAN.md` §3): rows C-10 and D-5 bind to `oracleCondition()` (SR1 row 10) and to
`ExecutionBelowOracleBand` / `ExecutionAboveOracleBand` with an inclusive, S4-consistent boundary (SR1 row 9),
never `condition()` or `PriceDeviation`. Only SR1 rows 15 (chain-file `source` prefixes), 16 (receipt
documentation home) and 17 (the determinism pin) remain owner rulings; every gas and size
figure here is re-measured by the implementation before a plan block shows it. Of the findings SC §14 assigns to the
deployment and test documents, this file lands B1–B10, C2, C4, C5, C8, C9, C11–C13, C16, C17 and C19; C1 (a 46630 fork
pin for row V0), C10, C14 and C15 land in `TEST-MATRIX.md`, and C20 in `TEST-MATRIX.md` G8 and `THREAT-MODEL.md` §11.
