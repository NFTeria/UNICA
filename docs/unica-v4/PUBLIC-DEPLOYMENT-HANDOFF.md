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
