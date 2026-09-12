# Operator runbook

The developer and operator side of UNICA. The business-facing page is
[`BUSINESS-START-HERE.md`](BUSINESS-START-HERE.md) and it is the only page a business owner needs;
everything here assumes a terminal, a keystore and a reason.

Two rules hold over every command below.

**Nothing in this repository signs.** Every public-chain command is either a dry run or asks a
`forge` keystore for a password in your own terminal. No key, mnemonic or endpoint URL is written by
any script here, and none appears in any log these scripts produce.

**A dry run is the default and the live flag is typed, never defaulted.** The public deploy wrapper
broadcasts only when `LIVE_BROADCAST=I_UNDERSTAND_THIS_SENDS_TRANSACTIONS` is on the command line
and `DEPLOYER_ACCOUNT` names a keystore. A mainnet chain id additionally requires
`UNICA_MAINNET_ACK`, re-checked inside the forge script.

## 1. The local chain

| Command | What it does |
|---|---|
| `make anvil-up` | a fresh Anvil on 127.0.0.1:8545, chain id 31337, pinned genesis timestamp, auto-impersonation |
| `make anvil-deploy` | the whole fixture stack, then the business joining from its own wallet, then `deployments/31337.local.json` |
| `make anvil-seed` | initialise the pool at the recorded opening price, add the capped no-value seed, ACTIVATE |
| `make anvil-demo` | the sixteen-step scenario, plus step 0a, the shop's own list: a sale off that list, the same-asset sale and the sale that converts |
| `make anvil-attacks` | the refusal matrix: the fork suite, `eth_call` probes, evidence and display decisions |
| `make anvil-test` | all of the above from an empty chain, then stop the node, and write the run evidence |
| `make anvil-down` | stop the node, keep the manifest and records for inspection |

The five `business-*` commands drive the same chain and are described in
[`unica-v4/ANVIL-DEMO.md`](unica-v4/ANVIL-DEMO.md). `make business-test` is `make anvil-test` with a
plainer preamble.

What a green run means, precisely: the forge fork suite passed with a stated count, every `eth_call`
refusal probe reverted with the exact custom error named in the row, the evidence reader returned
the decision the row expects, and the run evidence file records the command, commit, toolchain,
manifest hash, order id, settlement transaction and the statement that no external network was
contacted. An empty result and a broken reporter look identical, so every stage states its count.

## 2. Reading the local installation

`deployments/31337.local.json` is the one place that says what is installed. It carries the address,
code hash and code size of every contract, the market and its caps, the identity nodes, the policy
fixture, the look-alike, and an `assets` array naming every asset a person can see with its symbol,
decimals and role. Read the symbol from that array rather than from any script: a renamed or
re-deployed token must not be able to leave a stale name on a receipt.

`uUSD` in that array is a local test dollar minted by the fixture. It is not USDC and it is not any
other real dollar token, on any chain, ever.

## 3. The public deploy, one stage at a time

```
bash script/unica-v4/deploy-public.sh <alias> <stage> [config.env]
```

`alias` is a `foundry.toml` rpc alias and never a URL. `stage` is one of
`preflight | A | B | C | activate | readback`. The config defaults to
`config/unica-v4/<chainId>.env`, read only after the chain id has been measured from the chain
itself, so a mislabelled alias cannot pick up another chain's configuration.

The order is the order. `preflight` measures the chain, the frozen code and the vacancy of every
target and sends nothing. `A`, `B` and `C` land the stack. `activate` flips the market. `readback`
asks the chain what is actually there. Run `preflight` and `readback` as often as you like; they
cost nothing and they are the only two commands whose output you should trust without a second
look.

Broadcast records land under `broadcast/DeployPublic.s.sol/<chainId>/` and are committed as
evidence **after** the owner's readback, not before.

## 4. The ENS scripts

| Script | What it is |
|---|---|
| `script/ensv2/profile-check.mjs`, `profile-live.mjs` | the pinned ENSv2 Sepolia configuration, and the same read against the live chain |
| `script/ensv2/plan.mjs`, `freshcuts-plan.mjs` | the complete UNSIGNED plan; every calldata vector is produced by `cast calldata` from the signatures verified against the deployed resolver |
| `script/ensv2/plan-sabotage.mjs` | feeds the plan generator a known-bad input and requires it to go red |
| `script/ensv2/freshcuts-broadcast.sh` | the only ENS script that broadcasts, generated from the plan JSON |

`freshcuts-broadcast.sh records` writes the resolver records. `freshcuts-broadcast.sh lineage`
registers the lineage rows on the identity authority adapter and needs public stage A to have been
sent first, with its address in `UNICA_IDENTITY_AUTHORITY`. Both refuse to run if the chain is not
Sepolia or if `unica.eth` is not owned by the address the plan was generated for. Those two refusals
are the reason the script may be run at all.

Regenerate rather than edit. The broadcast script is generated from
`script/ensv2/freshcuts-sepolia-plan.json`; editing a calldata vector by hand breaks the only link
between what was planned and what was sent.

## 5. Readbacks and proof

`make readback` asks a live deployment what it holds now. `make verify` submits source verification.
`make proof` re-proves every deployment and settlement from the chain. `make gate` is what CI runs:
build, the suite with fuzzing, format check, the secret scan and the copied-source scan.

Validate the instrument before you trust the reading. `make proof-v3-self-test` sabotages the
proof's own comparators and requires each one to go red; a check that has never failed is not a
check. Do the same by hand whenever a green surprises you: break the thing on purpose and confirm
the check screams.

## 6. Known limits, stated rather than hidden

**The same-asset path is admitted through its own gate instance.** The confidential policy receiver
only records terms for a market the registry knows and reports ACTIVE. A direct settler has no
market, so no policy report for a same-asset sale can be delivered and the main gate's policy step
can only refuse one. The local deployment therefore lands a second instance of the same admission
contract with no policy receiver configured and admits the same-asset sale through it. Same identity
fixture, same register authority, same status text, same payout address; the confidential policy
step is the only thing missing. The settler is on the main gate's list already, so the day the
receiver understands a direct sale, the second instance can go.

**The local price feeds, the CRE report, the forwarder and the ENS registry are fixtures.** The feed
adapter, the policy receiver, the admission gate, the market contracts, the direct settler and the
identity token are the real code. The pinned Sepolia ENSv2 configuration is not what runs locally.

**The caps are demonstration values.** Ten dollars per sale, twenty-five per day, a five dollar
seed, on a chain where nothing is worth anything. They exist so the refusal rows have something to
exceed.
