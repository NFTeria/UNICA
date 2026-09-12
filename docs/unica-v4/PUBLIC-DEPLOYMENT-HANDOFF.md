# UNICA v4 — public-chain deployment handoff

The owner deploys; this repository prepares. Nothing here signs, broadcasts, funds or publishes. The
local run (`make anvil-test`, [`ANVIL-DEMO.md`](ANVIL-DEMO.md)) is the acceptance test the same contracts
must pass before any of this is used; the review record is [`SECURITY-REVIEW-V4.md`](SECURITY-REVIEW-V4.md).

## What goes out, and what replaces each local fixture

| Local (Anvil) | Public chain | Where it comes from |
|---|---|---|
| Official PoolManager bytecode, deployed locally | the chain's PoolManager | Uniswap's deployments page, pinned in `config/unica-v4/<chainId>.env` |
| `tAST` / `uUSD` test tokens | the real pair | canonical token addresses, decimals read on chain by the factory |
| `FixtureAggregator` feeds | Chainlink AggregatorV3 feeds (+ the sequencer feed on an L2) | Chainlink's feed directory; the script refuses any `description()` starting with `FIXTURE ` |
| `ChainlinkFeedAdapter` | **the same contract** | — |
| `UnicaMarketFactory`, `Registry`, `Hook`, `Executor` | **the same contracts** | — |
| `LocalKeystoneForwarderFixture` | the chain's Keystone forwarder | Chainlink's forwarder directory; the script refuses a `typeAndVersion()` containing `FIXTURE` |
| `UnicaPolicyReceiver` | **the same contract** | — |
| `LocalEnsV2Fixture` | an `IIdentityAuthority` adapter over the chain's ENSv2 registry and permissioned resolver | **not yet written** — see "Open before terminals go public" |
| `TerminalAdmission` | **the same contract**, pointed at the adapter | — |
| identity token (Vyper) | **the same bytecode**, compiled with Vyper 0.4.3 by the wrapper | — |

## The command surface

```sh
bash script/unica-v4/deploy-public.sh <alias> preflight        # reads everything, prints the plan, changes nothing
bash script/unica-v4/deploy-public.sh <alias> A                # DRY RUN of stage A (simulation at the current head)
LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS DEPLOYER_ACCOUNT=<keystore> \
  bash script/unica-v4/deploy-public.sh <alias> A              # the owner signs; password prompted in the terminal
bash script/unica-v4/deploy-public.sh <alias> readback         # after every live stage, before the next
```

Stages, in order, each refused unless the registry is in the state the previous stage leaves:

| Stage | Sends | Records in `config/unica-v4/<chainId>.env` before the next stage |
|---|---|---|
| `A` | adapter, factory (creates the registry), policy receiver (if a forwarder is configured), admission gate (if an identity authority is configured), identity token | `UNICA_ORACLE_ADAPTER`, `UNICA_FACTORY`, `UNICA_REGISTRY`, `UNICA_POLICY_RECEIVER`, `UNICA_ADMISSION` |
| `B` | `createMarket` at a mined `0x20C0` salt, after the aggregate seed cap is enumerated | `UNICA_MARKET_ID` |
| `C` | `initializeMarket`, the band-width seed on the payout side, `markSeeded` | — |
| `activate` | `setPauser`, `setOrderCreator(admission)`, `activate` — **as the admin**, only after the owner has read back stage C (ruling Q115) | — |

The alias goes to `cast` and `forge`; the URL behind it never appears on a command line. A mainnet alias
additionally needs `UNICA_MAINNET_ACK=I_UNDERSTAND_THIS_IS_MAINNET` typed on the command line, a **contract**
as `UNICA_ADMIN` (a Safe, rulings Q64 and U6), a `UNICA_PAUSER` (Q70) and `UNICA_REQUIRE_ORACLE=true`; the
wrapper checks these and the forge script checks them again.

## Measured on Sepolia, 2026-09-12: the feeds are slower than ruling S4 allows

Read through the `sepolia_testnet` alias at unix time 1789179975: ETH / USD last updated 855 seconds
earlier, USDC / USD about ten hours earlier. `ChainlinkFeedAdapter` composes the cross price on the older
of the two timestamps, and the registry's on-chain ceiling is `MAX_ORACLE_AGE = 300` seconds (S4). An
oracle-enabled WETH/USDC market on these feeds would refuse almost every settlement with `OracleStale`. That
is the design working as ruled, and it is the first thing a real deployment meets: stablecoin/USD feeds
update on a 24-hour heartbeat on every chain, so any USDC-quoted route is stale under a 300-second cap unless
the stable leg is treated differently. This is the "semantic limit" `SPEC-CONTRACTS.md` §2 records as open
(Q25). Until the owner rules, the Sepolia rehearsal runs as a demonstration market (`UNICA_REQUIRE_ORACLE=false`,
permitted on a testnet, refused on a mainnet by both the wrapper and the script), and its receipts say so.

```text
UNICA v4 — ORACLE AGE RULING (reply inline)
O1 Keep MAX_ORACLE_AGE = 300 s and accept that USDC-quoted markets settle only within 5 minutes of a USDC/USD update — YES / NO
O2 Add a per-leg maxAge to the policy (asset leg ≤ 300 s, stable quote leg ≤ 86,400 s), a spec amendment and a new release — YES / NO
O3 Price the asset directly in the payout unit with ONE feed (e.g. ETH/USDC where it exists) and drop the cross — YES / NO
O4 Run the Sepolia rehearsal as a demonstration market now, oracle market after O1–O3 — YES (default) / NO
```

## Sepolia run sheet — rehearsed on a fork of Sepolia at block 11686007, nothing sent

`bash script/unica-v4/rehearse-sepolia.sh` ran all four stages and the readback as the deployer by
impersonation against real Sepolia state (deployer balance 1.547 ETH, 31.55 test USDC, nonce 492). Measured:

| Stage | Transactions | Gas (estimate) | ETH at the fork's price | Result on the fork |
|---|---|---|---|---|
| A | factory (creates the registry) | 12,046,004 | ≈ 0.025 | factory `0x4924…6192`, registry `0x8789…AA11` at nonce 492 |
| B | `createMarket` at mined salt `0x2137` | 11,483,087 | ≈ 0.022 | hook `0x2570…A0c0` (bits `0x20C0`), executor `0x36DD…8ede`, market `0x99f1…fb93` |
| C | initialise, router, two approvals, seed 4.9 USDC over ticks 198060–205020, `markSeeded` | 3,524,821 | ≈ 0.006 | depth 333,131,895,132, status SEEDED |
| activate | `setPauser`, `activate` | 110,752 | < 0.001 | status ACTIVE; `marketIdOfHook/Executor/Pool` all equal the market id |

Addresses are predictions for nonce 492 and change if the deployer sends anything first; **re-run the
dry run of each stage immediately before sending it**, as the wrapper does by default. Ten transactions
in total. The market is a demonstration market (`requireOracle=false`, see the oracle-age finding above);
its receipts carry `demonstrationOnly = true` and zero reference fields.

Owner's sequence, one command per stage, in a real terminal (the keystore password is prompted):

```sh
bash script/unica-v4/deploy-public.sh sepolia_testnet preflight
LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS DEPLOYER_ACCOUNT=<keystore> bash script/unica-v4/deploy-public.sh sepolia_testnet A
```
Paste back the `STAGE_A` lines; copy `factory` and `registry` into `config/unica-v4/11155111.env` as
`UNICA_FACTORY` / `UNICA_REGISTRY`; run `readback` is not yet possible (no market); continue:
```sh
LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS DEPLOYER_ACCOUNT=<keystore> bash script/unica-v4/deploy-public.sh sepolia_testnet B
```
Paste back `STAGE_B`; copy `marketId` into the config as `UNICA_MARKET_ID`; then:
```sh
LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS DEPLOYER_ACCOUNT=<keystore> bash script/unica-v4/deploy-public.sh sepolia_testnet C
bash script/unica-v4/deploy-public.sh sepolia_testnet readback
```
Compare the readback with the table (status 3, `slot0Tick == initTick`, the three reverse maps), then:
```sh
LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS DEPLOYER_ACCOUNT=<keystore> bash script/unica-v4/deploy-public.sh sepolia_testnet activate
bash script/unica-v4/deploy-public.sh sepolia_testnet readback
```
Safety: every LIVE command is refused if the alias answers another chain id, and each stage re-reads the
registry's status, so a re-run after success is refused rather than repeated. A front-run cannot occupy a
CREATE2 hook address without the factory's own code; the factory and registry addresses depend only on the
deployer's nonce. After `activate`, commit `broadcast/DeployPublic.s.sol/11155111/` and the readback as
evidence, verify the four sources on the explorer (hook arguments 288 bytes, executor 224), and run
`tools/unica-evidence` against the first settlement.

## Sepolia first

Sepolia has the official PoolManager (`0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`, already pinned for
the v3 generation in `src/v3/UnicaDeploymentsV3.sol`), Chainlink ETH/USD and USDC/USD feeds, the isolated
ENSv2 deployment `unica.eth` is registered on (`integrations/ensv2/profile.mjs`), and a Keystone forwarder
listed in Chainlink's directory. Run the four stages there with the same configuration shape, then run the
evidence layer against the live receipts (`tools/unica-evidence/cli.mjs --rpc <sepolia alias URL via env>`),
before touching a mainnet. No-value: the seed is $5-equivalent test liquidity.

## Open before a mainnet, per the rulings on record

These are the owner's decisions recorded in `docs/unica-v4/DECISIONS.md`; the repository cannot close them.

- **Q132** — no mainnet deployment is authorized in the ledger. A mainnet run is a new owner ruling.
- **Q64 / U6** — the admin must be a Safe. The script refuses an EOA admin on a mainnet id.
- **Q70** — a pauser key must exist. The script refuses a zero pauser on a mainnet id.
- **Q9 / Q91 / Q95** — which chain, which RPC provider, which paid Chainlink access. Arbitrum One was the
  probe's recommendation; the chain file convention is `config/unica-v4/<chainId>.env`.
- **The README's public claim** that UNICA is testnet-only, and `script/mainnet-guard.sh`, which refuses
  mainnet ids for every other script. The wrapper here does not source that guard; the day a mainnet is
  authorized, the README changes in the same commit.

## Open before terminals go public (identity)

`TerminalAdmission` reads seven views through `IIdentityAuthority`. The local fixture implements them
directly; the public deployment needs an adapter over ENSv2's registry and permissioned resolver:
`hasRoles`, `text` and `addr` map one to one onto the measured resolver ABI (`integrations/ensv2/permissioned.mjs`);
`isNamespaceController` maps onto the admin bits the name's controller holds at the name-level resource;
`parentOf` has no on-chain source in ENSv2 and must be proven by lineage registration
(`keccak256(abi.encodePacked(parent, keccak256(label))) == child`, a pure fact anyone may register). That
adapter is the next bounded task, fork-tested against the pinned Sepolia deployment before it is used. Until
then a public market runs **without** the admission gate: the registry's own allowlist names the order
creators, and settlement is unaffected (the gate was never a settlement dependency).

## What the local run has proven that carries over unchanged

Payer binding, replay refusal, exact input, full fill, minimum output twice, atomic delivery, the receipt
paired with `Settled` in one transaction, the `(adapter, feedId)` commitment re-checked on every swap, the
oracle band on both bounds, caps on measured delivery, tighten-only policy and caps, RETIRED terminal, the
look-alike refused on emitter provenance, non-transferable identity badge, forwarder success is not delivery.
The mutation table (`make mutants-unica-v4`) and the guard rows added after the review are the evidence that
the tests would notice if any of those stopped being true.

## After each live stage

Record the broadcast run file under `broadcast/DeployPublic.s.sol/<chainId>/`, the `readback` output, and the
explorer verification per contract (constructor arguments: hook 288 bytes, executor 224) in
`deployments/unica-v4/<chainId>.json`; commit them as evidence. Verification publishes the source, which is
already public in this repository.
