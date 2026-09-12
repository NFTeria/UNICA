# UNICA v5 launch runbook — operators only (TESTNET / NO VALUE; mainnet locked)

Business owners start at `docs/BUSINESS-START-HERE.md` (`make business-demo`). This page is for the person
who deploys. Every command below is dry-run by default; a LIVE stage needs the phrase on the command line and
a forge keystore name in `DEPLOYER_ACCOUNT`; the password is typed by you in your terminal and never appears
here. Nothing on this page reaches a mainnet: the wrapper refuses a mainnet id without the acknowledgement
phrase, a contract admin, a pauser and the oracle requirement on.

```sh
cd ~/Desktop/unica && git checkout unicaV5-anvil && git pull -q && export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"
export DEPLOYER_ACCOUNT=<your forge keystore name>      # cast wallet list
export L=LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS
```

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

## Unichain Sepolia (1301) — alias `unichain_testnet` — BLOCKED

PoolManager `0x00B036B58a818B1BC34d502D3fE730Db729e62AC`, WETH `0x4200000000000000000000000000000000000006` and USDC
`0x31d0220469e10c4E71834a79b1f276d740d3768F` are verified live, but: (1) no Chainlink Data Feed was verified on this
chain, and the deployment script requires feed addresses even for a demonstration market; (2) the deployer holds 0.0196
test ETH against ≈0.08 needed. Unblock by funding the deployer and either verifying feeds from Chainlink's directory or
landing the "feeds optional when the oracle is not required" change to `DeployPublic._load`.

## Owner gates that are not deployments

| Gate | Command the owner runs when ready |
|---|---|
| CRE (after `CRE ACCESS GRANTED`) | `cre workflow deploy` from the workflow directory prepared under `integrations/`; success = forwarder tx + `ReportProcessed` + receiver `admissionOf(nonce).exists` + order created |
| The Graph Studio | `graph auth --studio <deploy key typed by you>` then `graph deploy --studio unica-v4` from `integrations/graph/unica-v4/` |
| Public web | `node apps/web/build.mjs` then the Pages publish of `apps/web/out/`; preview first on a branch |
| Coinbase Wallet | manual checklist in `script/anvil/README-browser.md` |
