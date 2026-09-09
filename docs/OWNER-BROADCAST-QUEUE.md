# The owner broadcast queue

Everything in this repository that a machine could prove has been proved. What is left needs a
human, because it needs a signature or a credential, and neither of those may be automated here.

**Every chain named on this page is a testnet. Testnet ETH has no monetary value and cannot be
sold, and nothing here can reach a mainnet — `script/mainnet-guard.sh` refuses eighteen mainnet
chain ids by number before any prompt appears.** That is a statement about money, not about
effort: each action below still stops at a real prompt, typed by you. Two of the three are a
keystore password (`Enter keystore password:`) and one is a Subgraph Studio deploy key. Nothing on
this page runs unattended, and nothing on this page has been run.

Last re-verified end to end on **2026-09-09** against live chains. Every number below was read from
a chain or printed by a command on that date, not copied from an earlier note.

**Nothing has been deployed.** The two V3 addresses are vacant on all five chains as of block
11,666,524 (Sepolia). `broadcast/` is byte-identical to `HEAD`. A simulation is not a deployment.

---

## Before you start: one thing is in your way

`make gate` currently exits **2**. Exactly one row is red, and it is not V3 and not The Graph:

```
FAIL  no bare 32-byte value without a label on its line
integrations/ensv2/profile.mjs:80:  node: "0x9c8b7ac...",
```

That is an **uncommitted** edit (129 added lines) from the ENSv2 work in flight. The label
`node:` is not in `script/scan.sh`'s allowed vocabulary; `namehash:` is. Whoever owns that file
either relabels the line or widens the vocabulary with a paired control.

Proof it is not the V3 or Graph work: `HEAD` plus only the four V3 files, in a clean worktree,
scans **31 checks run, 31 passed, 0 failed, exit 0**. Everything else in the gate is green —
**298 tests passed, 0 failed, 0 skipped across 33 suites**, and `forge fmt --check` is clean.

The V3 deploy does **not** depend on the gate being green. The commit that lands it does.

---

# 1 · Deploy the V3 pair on four testnets

**Unblocks the most.** Until this runs, UNICA V3 does not exist on any chain — the four
`21 passed / 0 failed` pre-flights are describing something that is not there yet.

**What it does.** Two transactions per chain: `UnicaHookV3` at its mined salt through the canonical
CREATE2 factory, then `UnicaExecutorV3` at salt zero, bound to the hook. Eight transactions total,
four keystore prompts.

**What it costs.** Testnet gas only. Simulated 2026-09-09 at each chain's own head:

| chain | id | gas units | price seen | cost | your balance | floor |
|---|---|---|---|---|---|---|
| Sepolia | 11155111 | 8,126,181 | 2.10 gwei | 0.01706 ETH | 1.5766 ETH | 0.02629 |
| Unichain Sepolia | 1301 | 7,674,885 | 0.000001 gwei | 0.0000077 ETH | **0.01963 ETH** | 0.00851 |
| Base Sepolia | 84532 | 7,675,043 | 0.011 gwei | 0.0000844 ETH | 1.5723 ETH | 0.00859 |
| Arbitrum Sepolia | 421614 | 7,344,457 | 0.509 gwei | 0.00374 ETH | 1.4989 ETH | 0.01282 |

**Unichain is the thin one.** It clears its floor by roughly 2.3×, where the other three clear
theirs by 60–180×. It passes. It is the one to top up first if you deploy again.

### Run this

```sh
# Two values, once per shell. Neither is a secret.
#   <DEPLOYER_ADDRESS>  the PUBLIC 0x… address that signs, and holds gas on each chain
#   <KEYSTORE_ACCOUNT>  the NAME of your forge keystore account (`cast wallet list` prints names).
#                       The PASSWORD is typed at the prompt — never on a command line, never in .env.
export DEPLOYER=<DEPLOYER_ADDRESS>
export DEPLOYER_ACCOUNT=<KEYSTORE_ACCOUNT>

# ─── Step 1. CHECK. Sends nothing, signs nothing, prompts for nothing. ───────────────────
# Each must end:  checks run: 21   passed: 21   failed: 0   skipped: 0   then "pre-flight: go".
make deploy-v3-check CHAIN=sepolia_testnet   DEPLOYER=$DEPLOYER
make deploy-v3-check CHAIN=unichain_testnet  DEPLOYER=$DEPLOYER
make deploy-v3-check CHAIN=base_testnet      DEPLOYER=$DEPLOYER
make deploy-v3-check CHAIN=arbitrum_testnet  DEPLOYER=$DEPLOYER

# ─── Step 2. DEPLOY. One chain per line. Each prompts "Enter keystore password:". ────────
# Run one line, let it finish, read the two addresses, then run the next.
make deploy-v3 CHAIN=sepolia_testnet   DEPLOYER=$DEPLOYER DEPLOYER_ACCOUNT=$DEPLOYER_ACCOUNT
make deploy-v3 CHAIN=unichain_testnet  DEPLOYER=$DEPLOYER DEPLOYER_ACCOUNT=$DEPLOYER_ACCOUNT
make deploy-v3 CHAIN=base_testnet      DEPLOYER=$DEPLOYER DEPLOYER_ACCOUNT=$DEPLOYER_ACCOUNT
make deploy-v3 CHAIN=arbitrum_testnet  DEPLOYER=$DEPLOYER DEPLOYER_ACCOUNT=$DEPLOYER_ACCOUNT
```

`CHAIN` is a `foundry.toml` **alias**, never a URL — a provider URL carries its API key in the
path and this repository is public. There is deliberately no default: a deploy target that picks
a chain for you is a deploy that reaches the wrong one by omission.

### Check these before you type the password

1. **`pre-flight: go` printed, and the line above it says `failed: 0`.** If any row says FAIL, stop
   for that chain. There is no `--force` and you should not add one.
2. **The chain id line matches the alias you typed.** It reads e.g.
   `chain id            84532  (alias: base_testnet)`. If it does not, the alias is misconfigured.
3. **These two addresses, and no others.** They are the same on all four chains, because the hook's
   creation code carries no constructor argument and no chain id, so one salt lands on one address
   everywhere:
   ```
   hook      0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0   (salt 0x2043, flag bits 0x20C0 = 8384)
   executor  0x015692C9E43ca19a2504F79368D1156A56680517   (salt 0, constructor = the hook)
   ```
   `make predict-v3` prints them offline, along with the hook init-code hash:
   init-code hash `0xc7a1d4c8614c9650dfc6f4b328d12ff8f619ab7a129ac3bbc6fb0efafb62ecd9`.
   **If that hash ever moves, the address moves, and step 1 must be re-run before step 2.**
4. **The estimated cost is in the right order of magnitude for that chain** (table above). A
   Sepolia-sized figure appearing on Unichain means the fork is mis-pinned; abort and re-run.

### Send back afterwards

The two deployed addresses per chain and the four transaction hashes, plus the contents of
`broadcast/DeployV3.s.sol/<chainid>/run-latest.json`. Then a readback: `cast code` at both
addresses on each chain, so the pair is proved from the chain and not from the deploy script's own
claim about itself.

### What stays false until this is done

- "UNICA V3 is deployed" — on any chain.
- Any claim about V3 runtime behaviour on a live chain. Everything proved so far is a constructor
  running inside a simulated fork.
- **There is no post-deploy readback tool for V3.** V1 has `make readback` / `make proof`; the V3
  pair has no equivalent yet. That is a gap to close after the deploy, not before.
- **Source verification is not wired into this path, on purpose.** Four chains do not share one
  verifier, and a `--verify` flag that silently works on some and not others is worse than a
  separate step. The contracts will show as unverified on every explorer until you verify them.

### The fifth chain is refused, and you should watch it happen

```sh
make deploy-v3-check CHAIN=robinhood_testnet DEPLOYER=$DEPLOYER
```

Exits non-zero with **17 checks run, 14 passed, 3 failed, 4 skipped**. Chain 46630 answers and
serves state — its routing stack passes everything, including the router code-hash match — but no
payout currency has been verified on it, so `UnicaDeploymentsV3` will not name one and **both**
constructors revert. Three independent FAIL rows, four honest SKIPs that are printed as SKIPs and
never folded into the passes. This is the guard working, not a chain being broken.

---

# 2 · Deploy the subgraph to Subgraph Studio

**Cheapest and second-largest unblock: no gas, no wallet, no keystore.** One credential prompt.

**What it does.** Publishes `integrations/graph/` to Subgraph Studio, which gives you a query URL
for the live V1 hook's settlement receipts.

**What it costs.** Nothing on-chain. A Studio deploy key, pasted at a prompt.

**Why it is ready.** Measured on Sepolia on 2026-09-09:

- `SettlementReceipt` **has fired at the live V1 hook.** topic0
  `0xf9b834e9…ec43563`, recomputed with `cast keccak` from the manifest's exact signature rather
  than copied. In blocks 11,640,021–11,640,030: **1 log**, block 11,640,026, logIndex 107,
  transaction hash `0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83`.
- **The query is not dead.** The identical query with topic0's last nibble flipped `3`→`4` returns
  zero bytes. An empty answer from this query is a real answer.
- **`startBlock` is exactly right.** `cast code` at the hook reads 0 bytes at block 11,639,894 and
  10,634 bytes at 11,639,895. The manifest's `startBlock: 11639895` is the creation block: nothing
  can have been emitted before it, and no sync is wasted.
- **The toolchain is green today.** `npx graph codegen` exit 0, `npx graph build --network sepolia`
  exit 0, `npx graph test` **6 tests passed**, and `git status` on `integrations/graph` is empty
  before and after, so the build did not rewrite the committed manifest.
- **The post-deploy verifier is itself validated.** `verify-hosted.sh --self-test` = **2 checks
  run, 0 failed**: it accepts its control fixture and rejects a sabotaged one (`amountOut` off by
  one).

### Run this

```sh
cd integrations/graph            # from the repository root
npx graph auth                       # paste the Studio deploy key at the prompt
npx graph deploy <SLUG> --network sepolia --network-file networks.json \
  --version-label "v1-$(git rev-parse --short HEAD)"

# then, from the repo root, against the URL Studio prints:
cd -                             # back to the repository root
bash integrations/graph/verify-hosted.sh 'https://api.studio.thegraph.com/query/<NUMBER>/<SLUG>/<VERSION>'
```

### Check these before you confirm

1. **The address in `networks.json` is `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`** — the live V1
   hook — and `startBlock` is `11639895`. Both are in the file already; confirm the deploy output
   echoes them.
2. **You are deploying `integrations/graph/`, not `integrations/graph-v2/`.** See the warning below.
3. The deploy key goes at the `graph auth` prompt only. It never belongs on a command line, in
   `.env`, or in a commit.

### Send back afterwards

The Studio query URL and the version label, plus the full output of `verify-hosted.sh` against it —
that is the first time that script will have run against a live endpoint rather than its own
fixture.

### What stays false until this is done

- "The subgraph is deployed / queryable." No Studio deployment exists. No query URL exists.
  `verify-hosted.sh` has never been run against anything but its own `--self-test`.
- **Any count of settlements.** Only "at least one" is established. The configured Sepolia endpoint
  will not serve a wide `eth_getLogs` range — a single request spanning startBlock to head (26,629
  blocks) was issued on 2026-09-09 and produced **no output at all in 300 seconds**, so it hangs
  rather than erroring. Sweeping the range in 10-block windows would take ~2,650 requests and was
  not done. Do not quote a number of settlements from this work.

### ⛔ Do not deploy `integrations/graph-v2/`

Its manifest targets `0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f` on Sepolia. Read from the chain
on 2026-09-09: **`eth_getCode` = `0x` (0 bytes), nonce 0, balance 0.379 ETH.** The balance is
exactly the signal that reads as "something is deployed here" and is not. Deploying that manifest
would sync to head and index nothing, forever, with no error. The blocker is V2's absence from the
chain, not a missing credential.

---

# 3 · Arc: fund an account, then send one real transfer

**Smallest unblock, and the only one that closes a claim nothing else can.**

**What it does.** Proves that a payment preview this repository builds is accepted by the Arc
testnet mempool. Everything else about Arc is already proved offline and by live reads.

**What it costs.** Arc testnet USDC from Circle's faucet. No mainnet value.

**Why it is ready.** Measured on Arc testnet (chain id 5042002) on 2026-09-09:

- `node integrations/arc-treasury/test.mjs` → **177 checks run, 177 passed, 0 failed**.
- `node integrations/arc-treasury/live-check.mjs` → **20 checks run, 20 passed, 0 failed**, against
  the live chain.
- **Decimals are read, never assumed.** A `TokenScale` can only be minted from a real
  `decimals()` return; "we assumed 18" is unrepresentable rather than merely discouraged.
- **The factor-of-a-trillion error is caught by the type system.** The same account holds
  865034306417121744253729820 wei natively (18dp) and 865034306417121 units as ERC-20 (6dp) —
  exactly 10¹² apart. The two are different types and refuse to be added or compared.
- **There is no signer.** 13 files scanned, zero hits for private keys, mnemonics, keystores, or
  any `eth_send*` method. `ArcClient`'s RPC allow-list contains no send method at all;
  `/api/health` reports `canSign false, canBroadcast false`.

### Run this

```sh
open https://faucet.circle.com          # Arc testnet. Paste the PUBLIC address only.

# the two below, from the repository root:
node integrations/arc-treasury/server.mjs      # then open http://127.0.0.1:8788
                                               # with DEMO_CONFIG.merchant set to your address
node integrations/arc-treasury/live-check.mjs > /tmp/arc-live-check.txt
```

The preview the server builds is a transaction object. **This repository cannot sign or send it.**
Signing and broadcasting it is a step you take in your own wallet, deliberately, outside this tree.

### Check these before you confirm in the wallet

1. **`to` is the ERC-20 contract `0x3600…0000`, not the recipient**, and `value` is `0x0`. A
   transfer of an ERC-20 goes to the token; a `to` equal to the recipient would be a native send.
2. **Decode the calldata yourself.** It is `0xa9059cbb` (`transfer(address,uint256)`) + recipient +
   units. Confirm the recipient is who you meant and the units are at **6 decimals** — `0x17d78400`
   is 400000000 units = 400.000000 USDC, not 400 × 10¹⁸.
3. **`maxFeePerGas` is above Arc's 20 Gwei mempool floor.** 21 Gwei was observed on 2026-09-09.
4. **`REQUIRES_OWNER_SIGNATURE` is `true`** in the report. If it is not, something built a preview
   it thought it could send.

### Send back afterwards

The transaction hash and its receipt status.

### What stays false until this is done

- "An Arc transaction built by this module was accepted by the mempool." No Arc transaction has
  been broadcast or mined.
- The preview has only ever been exercised with `DEMO_CONFIG.merchant = 0x0000…0000`, which happens
  to hold a large Arc balance. It has **not** been exercised against an owner-controlled funded
  account, because none exists yet.
- `integrations/arc-treasury/OWNER-ACTION.md` still quotes **20.149 Gwei / ~0.00131 USDC** for the
  gas ceiling. The current reading is 21 Gwei / ~0.001365 USDC. Both clear the floor, so nothing is
  wrong — but that figure in that file is a stale observation, not a current one.

---

## Housekeeping, before any of this is committed

The V3 work is **uncommitted**, and a second session is editing this same working tree. Stage
exactly these four paths and nothing else:

```
script/v3/DeployV3.s.sol
script/v3/deploy-v3.sh
Makefile
script/mainnet-guard.sh
```

**Do not run `git add -A`.** `vy/src/unica/calculator.vy` and `vy/src/unica/flash_liquidator.vy`
are untracked prior art and must stay untracked; committing either is unrecoverable in a public
repo.

## Two things this page will not do

**There is no private-key path in this repository, and none was added.** `--broadcast` appears
exactly once in the entire V3 path, on `V3_NETWORK_ARGS` in the Makefile, reached only from
`_deploy-v3-broadcast`, which is guarded by `_need-v3-signing` and entered only from
`deploy-v3.sh` after the pre-flight passed — always with `--account $(DEPLOYER_ACCOUNT)`, which
prompts. No RPC URL is ever printed or placed on a command line; only `foundry.toml` aliases are.

**Nothing on this page has been run for you.** Every dry run redirected `FOUNDRY_BROADCAST` to
`.rehearsal/`, so not one byte was written under `broadcast/`, and `git status -- broadcast/` is
empty.
