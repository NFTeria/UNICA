# UNICA v5 launch runbook — operators only (TESTNET / NO VALUE; mainnet locked)

Business owners start at `docs/BUSINESS-START-HERE.md` (`make business-demo`). This page is for the person
who deploys. The `make v5-<step> NET=<alias>` wrapper (`script/unica-v4/v5.sh`) runs each row below one step at a time. Every command below is dry-run by default; a LIVE stage needs the phrase on the command line and
a forge keystore name in `DEPLOYER_ACCOUNT`; the password is typed by you in your terminal and never appears
here. Nothing on this page reaches a mainnet: the wrapper refuses a mainnet id without the acknowledgement
phrase, a contract admin, a pauser and the oracle requirement on.

```sh
cd ~/Desktop/unica && git checkout unicaV5-anvil && git pull -q && export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"
export DEPLOYER_ACCOUNT=<your forge keystore name>      # cast wallet list
export L=LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS
```

## Status on 2026-09-12 (every row read back from the chain and recorded by the wrapper)

| Network | Alias | Market | Factory | Registry | Hook | Executor | Market id | Source |
|---|---|---|---|---|---|---|---|---|
| Ethereum Sepolia (11155111) | `sepolia_testnet` | ACTIVE (status 4) | `0x49241d0f80728CDd0933a4131529b2e084D96192` | `0x8789366A3dDd465D3bf612c914E29419d0dDAa11` | `0x2570a593e0D24ede29eC926e0c5a88B427b9A0c0` | `0x36DD3d5d2dd0124331Cc3874A7bb07B3A6d48ede` | market id `0x99f138caff24fe5dbe437093bac3bf66b2605e7940887fa648e5409dddaefb93` | etherscan (Sepolia) |
| Base Sepolia (84532) | `base_testnet` | ACTIVE (status 4) | `0x8437BcCd3Cd7c1BfbC4EC47d9766cAaEc12e5aa3` | `0xA0686c76446315182e1ac7cb3Fb844d812670C53` | `0x77D1f8d20e878305b509e44a266C0F69925ca0C0` | `0x89BBdF3075432542CFFd0154D707ACf9ba3a56F9` | market id `0xc620eff48202f9439a04206b2955c6abd26bfb66a5b73f1e0b7d41f4ad03e682` | etherscan (Base Sepolia) |
| Arbitrum Sepolia (421614) | `arbitrum_testnet` | ACTIVE (status 4) | `0xA0C5cc4FC6A6446a6f532942ECb6eeeF91AE8901` | `0x3072ab51ae34f99A8b7368643c6baC7118E8a6f9` | `0x524B0B6AD8B93bC907077A474C28779d620d60c0` | `0x79552Ad852304D04b246a85168D562B8eE244879` | market id `0x347ef2afeff0218f9e4d23f205a3772f063f358e72db69225481753c329acbc7` | etherscan (Arbitrum Sepolia) |
| Unichain Sepolia (1301) | `unichain_testnet` | ACTIVE (status 4) | `0xcD59d70551E438CC0ef859F86C8c12c5e6007728` | `0xC29b35ef2F85DEdE57452090bC7dC85743664296` | `0xA112930b4C2d8fce1192F2Bd60f7Cf9E7Ef0A0c0` | `0xD3730094f1D481F7501E75B3E6FCDa16fF0C9e67` | market id `0x865fe38970e04183c900768131ccb9ad451b042068695aeb8697478fea7c4ff2` | sourcify (Unichain Sepolia) |
| Robinhood Chain testnet (46630) | `robinhood_testnet` | ACTIVE (status 4) | `0xfdD4468715F1d2e4242E8F58205E7699137e0Aa7` | `0x9Cb93Ab47adB2fDac35baD6097a6cCF70A441D92` | `0x30396Bf4C1cEB4a513425d8c0BD6EFB1FABFA0C0` | `0xc84f4a8C4215Ad1162FFcCcC9DA3dA589D7DaF9a` | market id `0x4c968c48e90f58a8994e40590df132568f3a7ee5991fbcf84714fa4c4008639a` | blockscout (Robinhood Chain testnet explorer) |

Ethereum Sepolia also carries the identity stack (authority `0xB3aCbD101b026669A5b61DBbcD13d5CAe1c8f133`, admission
`0x95ee6cCde9B03C8841972DB52b4cBe38e7d99399`, badge `0xaEB244C4FE0f995403eC230683d2DC84D41157CA`) and the live `freshcuts.unica.eth` records and lineage; the Vyper badge is
verified by hand, not by the script. Every market is a labelled demonstration market until the owner validates the per-leg feed
heartbeats (O2); the manifests carry `demonstrationOnly`. Nothing here is a mainnet.

## What every chain runs, in order

| Step | Command (alias = the foundry.toml rpc alias; the URL lives only in your .env) | Sends | Then |
|---|---|---|---|
| preflight | `bash script/unica-v4/deploy-public.sh <alias> preflight` | nothing | prints `TESTNET / NO VALUE`, balance, nonce, dependencies, `preflight: go` |
| A | `env $L bash script/unica-v4/deploy-public.sh <alias> A` | factory+registry (+ authority, gate, badge where ENS exists) | addresses recorded into the config; commit the config |
| readback | `bash script/unica-v4/deploy-public.sh <alias> readback` | nothing | (after B) hook bits, reverse maps, status |
| B | `env $L bash script/unica-v4/deploy-public.sh <alias> B` | `createMarket` at a mined salt | market id, hook, executor recorded |
| C | `env $L bash script/unica-v4/deploy-public.sh <alias> C` | initialise, router, approvals, seed 4.9 test USDC, `markSeeded` | readback: status 3, `slot0Tick == initTick` |
| activate | `env $L bash script/unica-v4/deploy-public.sh <alias> activate` | `setPauser`, allow creator, `activate` | readback: status 4 |
| manifest | `bash script/unica-v4/manifest.sh <alias> config/unica-v4/<chainId>.env` | nothing | `deployments/unica-v4/<chainId>.json` from chain reads; commit it with `broadcast/` |
| verify source | `forge verify-contract --chain <chainId> --watch <address> <Contract> --constructor-args <abi-encoded>` per contract; Blockscout: add `--verifier blockscout --verifier-url <explorer api>`; Etherscan needs `ETHERSCAN_API_KEY` in your shell, never in a file | nothing | verification status recorded into the manifest via `UNICA_VERIFICATION_JSON` |
| web build | `UNICA_MANIFEST=deployments/unica-v4/<chainId>.json node apps/web/build.mjs` | nothing | a build labelled from the manifest; a testnet manifest cannot produce a mainnet label |
| evidence | `node tools/unica-evidence/cli.mjs --order <orderId> --manifest deployments/unica-v4/<chainId>.json --rpc <alias>` | nothing | exit 0 VERIFIED / 1 REFUSED / 2 UNKNOWN |
| pause | `cast send <registry> 'pause(bytes32)' <marketId> --rpc-url <alias> --account $DEPLOYER_ACCOUNT` (pauser) | one tx | `readback` shows PAUSED; `retire` is terminal and needs the admin |

Rollback: contracts are immutable; the recovery is `pause` (pauser) and, if needed, `retire` (admin), then a
new market under a new release tag. Never redeploy over a recorded address: the wrapper refuses to overwrite a
config value that differs from what a stage printed.

## Ethereum Sepolia (11155111) — alias `sepolia_testnet` — READY, staged

Config `config/unica-v4/11155111.env` (every address read live): PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`,
WETH `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`, USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, feeds ETH/USD
`0x694AA1769357215DE4FAC081bf1f309aDC325306` and USDC/USD `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E` (demonstration market until
the per-leg maxAge values are validated), ENSv2 resolver of unica.eth `0x3D2d26801632e7b13B2fa75236a634e75684988c`,
deployment id `0xb21f8341b4168d56bf301fbc8f2923f2210b99ddcfd72e1fdad2113ba862bb90`. Deployer `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73`,
1.547 test ETH, 31.55 test USDC, nonce 492. Fork rehearsal: 14 transactions, ≈0.078 ETH; stage A live dry run agrees.

```sh
bash script/unica-v4/deploy-public.sh sepolia_testnet preflight
env $L bash script/unica-v4/deploy-public.sh sepolia_testnet A          # 4 txs, ≈0.05 ETH max; then paste STAGE_A lines back
env $L bash script/unica-v4/deploy-public.sh sepolia_testnet B          # 1 tx
env $L bash script/unica-v4/deploy-public.sh sepolia_testnet C          # 6 txs
bash script/unica-v4/deploy-public.sh sepolia_testnet readback
env $L bash script/unica-v4/deploy-public.sh sepolia_testnet activate   # 3 txs
bash script/unica-v4/deploy-public.sh sepolia_testnet readback
bash script/unica-v4/manifest.sh sepolia_testnet config/unica-v4/11155111.env
DEPLOYER_ACCOUNT=$DEPLOYER_ACCOUNT bash script/ensv2/freshcuts-broadcast.sh records                          # 4 resolver writes
UNICA_IDENTITY_AUTHORITY=<STAGE_A identityAuthority> DEPLOYER_ACCOUNT=$DEPLOYER_ACCOUNT bash script/ensv2/freshcuts-broadcast.sh lineage   # 6 rows
```

## Base Sepolia (84532) — alias `base_testnet` — READY (market stack only, no ENS)

Config `config/unica-v4/84532.env`: PoolManager `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` (24,009 bytes), WETH
`0x4200000000000000000000000000000000000006`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, feeds ETH/USD
`0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`, USDC/USD `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` (descriptions read live;
demonstration market). Deployer 1.572 test ETH; the 4.9 test USDC for stage C must be present before C. Preflight: go.

```sh
bash script/unica-v4/deploy-public.sh base_testnet preflight
env $L bash script/unica-v4/deploy-public.sh base_testnet A        # 1 tx (factory+registry; no identity on this chain)
env $L bash script/unica-v4/deploy-public.sh base_testnet B
env $L bash script/unica-v4/deploy-public.sh base_testnet C
bash script/unica-v4/deploy-public.sh base_testnet readback
env $L bash script/unica-v4/deploy-public.sh base_testnet activate
bash script/unica-v4/deploy-public.sh base_testnet readback
bash script/unica-v4/manifest.sh base_testnet config/unica-v4/84532.env
```

## Arbitrum Sepolia (421614) — alias `arbitrum_testnet` — READY (market stack only, no ENS)

Config `config/unica-v4/421614.env`: PoolManager `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317`, WETH
`0x980B62Da83eFf3D4576C647993b0c1D7faf17c73`, USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`, feeds ETH/USD
`0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165`, USDC/USD `0x0153002d20B96532C639313c2d54c3dA09109309` (USDC/USD last updated
about a day before config time: exactly the case O2 exists for; demonstration market). Deployer 1.497 test ETH. Preflight: go.

```sh
bash script/unica-v4/deploy-public.sh arbitrum_testnet preflight
env $L bash script/unica-v4/deploy-public.sh arbitrum_testnet A
env $L bash script/unica-v4/deploy-public.sh arbitrum_testnet B
env $L bash script/unica-v4/deploy-public.sh arbitrum_testnet C
bash script/unica-v4/deploy-public.sh arbitrum_testnet readback
env $L bash script/unica-v4/deploy-public.sh arbitrum_testnet activate
bash script/unica-v4/deploy-public.sh arbitrum_testnet readback
bash script/unica-v4/manifest.sh arbitrum_testnet config/unica-v4/421614.env
```

## Unichain Sepolia (1301) — alias `unichain_testnet` — READY as a demonstration market (no oracle, no ENS)

PoolManager `0x00B036B58a818B1BC34d502D3fE730Db729e62AC` (24,009 bytes), WETH `0x4200000000000000000000000000000000000006` and USDC
`0x31d0220469e10c4E71834a79b1f276d740d3768F` verified live. No Chainlink Data Feed was verified on this chain, so the configuration
carries no feed and the market is a labelled demonstration market; the deploy script accepts that only while `UNICA_REQUIRE_ORACLE=false`
and refuses a zero feed the moment the oracle is required. Deployer 0.0196 test ETH and 20 test USDC; measured gas price 0.0015 gwei,
stage A dry run 12,045,988 gas ≈ 0.000012 ETH, the whole sequence ≈ 27.2M gas ≈ 0.00004 ETH, so funding is not the blocker it looked
like at Ethereum prices. Preflight: go.

```sh
bash script/unica-v4/deploy-public.sh unichain_testnet preflight
env $L bash script/unica-v4/deploy-public.sh unichain_testnet A        # 1 tx; predicted factory 0xcD59…7728, registry 0xC29b…4296 at nonce 45
env $L bash script/unica-v4/deploy-public.sh unichain_testnet B
env $L bash script/unica-v4/deploy-public.sh unichain_testnet C
bash script/unica-v4/deploy-public.sh unichain_testnet readback
env $L bash script/unica-v4/deploy-public.sh unichain_testnet activate
bash script/unica-v4/deploy-public.sh unichain_testnet readback
bash script/unica-v4/manifest.sh unichain_testnet config/unica-v4/1301.env
```

## Robinhood Chain testnet (46630) — alias `robinhood_testnet` — LIVE as a demonstration market (no oracle, no ENS); verified on the chain's Blockscout explorer

Config `config/unica-v4/46630.env`, every value read live on 2026-09-12: PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` (24,009 bytes),
CREATE2 factory present, asset `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` (a faucet testnet token whose symbol reads TSLA, 18 decimals; not the
instrument, no value), payout `0xfb93352698150e720Bf0A321DEf3aC98D90B9874` (uTUSD, the repository's own 6-decimal test dollar; its only minter is the
deployer, so no faucet is involved; it is not USDC). The demonstration rate 365.225 test dollars per unit is the Chainlink TSLA / USD feed on OP Sepolia
read on chain at 1789233564 (recorded with the feed address in the config); chain 46630 itself has no Chainlink Data Feed, so the market runs oracle-off
and labelled. Deployer 0.059 test ETH at nonce 90, gas price 0.01 gwei measured, the whole sequence ≈ 27M gas ≈ 0.0003 ETH. Sourcify lists chain 46630 as supported but its node could not fetch the bytecode, so `verify` talks to the chain's public
Blockscout explorer directly (no key involved); all four contracts are verified there. The deployer held 0.1 uTUSD at config time; stage C seeds 4.9, so `mint` (one transaction,
100 test dollars to the deployer, refused on any other chain and refused unless the keystore's address is the token's minter) comes first. Preflight: go.

```sh
make v5-preflight NET=robinhood_testnet
make v5-mint NET=robinhood_testnet        # 1 tx: 100 uTUSD to the deployer (minter-only)
make v5-A NET=robinhood_testnet           # 1 tx: factory + registry (no identity on this chain)
make v5-B NET=robinhood_testnet
make v5-C NET=robinhood_testnet
make v5-activate NET=robinhood_testnet
make v5-manifest NET=robinhood_testnet && make v5-verify NET=robinhood_testnet && make v5-evidence NET=robinhood_testnet && make v5-commit NET=robinhood_testnet
```

## Owner gates that are not deployments

| Gate | Command the owner runs when ready |
|---|---|
| CRE (after `CRE ACCESS GRANTED`) | `cre workflow deploy` from the workflow directory prepared under `integrations/`; success = forwarder tx + `ReportProcessed` + receiver `admissionOf(nonce).exists` + order created |
| The Graph Studio | `graph auth --studio <deploy key typed by you>` then `graph deploy --studio unica-v4` from `integrations/graph/unica-v4/` |
| Public web | `node apps/web/build.mjs` then the Pages publish of `apps/web/out/`; preview first on a branch |
| Coinbase Wallet | manual checklist in `script/anvil/README-browser.md` |
