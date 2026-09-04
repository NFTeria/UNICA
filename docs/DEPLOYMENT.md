# DEPLOYMENT — how the scripts behave, measured

What the `make` targets and scripts actually do, each behaviour with the command that shows it.
Written 2026-09-04 night from measured output; nothing here is a style claim. Testnet only:
mainnet is not a supported network anywhere in this repository.

## Network selection fails closed

One switch, `ARGS`. Three cases, and only three:

| `ARGS` | What runs | Measured |
|---|---|---|
| (none) | the local anvil fork of Sepolia: `--rpc-url http://127.0.0.1:8545 --unlocked --sender $DEPLOYER --broadcast`; impersonation, no signing, no real transaction | `make -n deploy DEPLOYER=<addr>` prints the fork command and the line `LOCAL FORK on …` |
| `--network sepolia` | Ethereum Sepolia with keystore signing: `--rpc-url $SEPOLIA_RPC_URL --account $DEPLOYER_ACCOUNT --sender $DEPLOYER --broadcast` | `make -n deploy ARGS="--network sepolia" DEPLOYER=<addr> DEPLOYER_ACCOUNT=<name>` prints `--account <name>` |
| any other `--network` | refused before any forge command: `unsupported network in ARGS="--network mainnet": only "--network sepolia" is supported (testnet only)`, exit 1 | `make deploy ARGS="--network mainnet" DEPLOYER=<addr>` exits 1 with that line. Before the fix in commit `fix(make): an unsupported --network fails closed` it fell through to the fork; that is why the branch exists |

Every network target also refuses to run without `DEPLOYER` (a public address), and the Sepolia
path without `DEPLOYER_ACCOUNT` (a keystore name). Values come from `.env` (never committed;
`.env.example` shows the shape) or the command line.

## Keystore signing, no key material

The Sepolia path signs with `forge script --account <name>`: forge opens the keystore under
`~/.foundry/keystores/<name>` and prompts for its password at run time. No private key, mnemonic,
or password appears in the repository, in `.env`, in the Makefile, in any script, or in any
log; the commands above show the only credential-shaped argument, the keystore *name*. The
optional `ETHERSCAN_API_KEY` is read from the environment and appended as
`--verify --etherscan-api-key …` only when set (measured: with it set the two flags appear,
without it they do not), so a run without the key still deploys and verifies on Sourcify later.

## Deterministic deployment

Both contracts have zero-argument constructors and deploy through the canonical CREATE2 factory
`0x4e59b44847b379578588920cA78FbF26c0B4956C`, so their addresses depend only on creation code and
salt:

- the executor uses salt `0` (the hook's `EXECUTOR_SALT`); the hook derives the executor's
  address from the executor's creation code in its own constructor and the deploy stage asserts
  the executor landed exactly there, or reverts;
- the hook's salt is mined at deploy time for the `0xC0` permission mask (`beforeSwap | afterSwap`)
  and asserted against the prediction; `make predict` prints the address and salt before any
  deploy, from the same arithmetic.

Measured 2026-09-04 night: `make predict` printed salt `0x9c5` and an address ending in `40C0`;
the fork rehearsal deployed the executor at `0x182ae08BdBF0865Dcc3bd7f980978Ea370d412F3` and the
hook at `0xD5ecb33016ADDA50F902Fcde97fAB8b3F2CD40C0`, both equal to their predictions. The hook
address changes with every edit of the hook or the executor, which is why nothing is broadcast
before the deploy day. There is no circular dependency: the executor's creation code does not
mention the hook; the hook's creation code embeds the executor's.

## Staged interactions

Four stages, each its own target, each runnable alone or in sequence, each idempotent where the
chain allows it (the deploy stage skips a contract that already has code; the pool stage skips
an initialised pool):

| Target | Script entry | Does |
|---|---|---|
| `make deploy` | `DeploySettlement` | executor at its derived address, then the hook at its mined salt; asserts both |
| `make init-pool` | `InitPool` | initialises the ETH/USDC pool with the hook at the configured price |
| `make seed` | `SeedLiquidity` | approves and adds liquidity sized to what the deployer holds above a floor |
| `make settle` | `Settle` | creates an order and pays it through the executor and the official router; asserts the receipt counter moved by one and the executor holds nothing |
| `make live` | `LiveFire` | all four in one run |
| `make rehearse` | `script/rehearse-anvil.sh` | all four on a throwaway anvil fork of Sepolia, impersonating the deployer, then a readback; broadcast artifacts under `.rehearsal/` (ignored), never `broadcast/` |
| `make readback` | `script/readback.sh` | pure reads: executor code and order count, hook code and receipt count, pool id, slot0, liquidity |
| `make verify` | `script/verify.sh` | source verification of both contracts on Sourcify, and on Etherscan when the key is set; picks the artifact whose runtime matches the chain outside the immutables |

Measured 2026-09-04 night on the fork: seven transactions, all status 1, receipt counter 0 to 1,
2.003660 USDC to the recipient for 0.001 ETH.

## Sizes

| Contract | Runtime bytes | EIP-170 headroom |
|---|---|---|
| `V4SettlementHook` | 9,981 | 14,595 |
| `SettlementExecutor` | 9,308 | 15,268 |

Re-verify: `forge inspect src/V4SettlementHook.sol:V4SettlementHook deployedBytecode | wc -c`
(divide by two, minus one for the `0x`). CI asserts the hook stays under 24,576.

## Compiler

`foundry.toml` pins `solc_version = "0.8.30"`, `evm_version = "cancun"`, `via_ir = false`; the
fuzz count is 10,000. The tests deploy Uniswap's official PoolManager bytecode from hookmate's
artifact and the deployed Universal Router runtime from `test/utils/artifacts/`, so one compiler
serves tests, scripts, and verification.
