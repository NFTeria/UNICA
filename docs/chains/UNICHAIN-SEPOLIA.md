# Unichain Sepolia (chain 1301) — what is verified, what is not, and what a deploy would take

**UNICA is not deployed on this chain, has never been deployed on this chain, and cannot be
deployed on it today without a change to a frozen source file.** Everything below is a read of the
chain or a fork of it. Nothing here was broadcast. Every claim is re-checkable by running
`bash docs/chains/verify-unichain-sepolia.sh`, which re-derives all of it from the chain and prints
`checks run: 28, passed: 28, failed: 0, skipped: 0`.

All reads: **2026-09-09**, RPC `https://sepolia.unichain.org`, at block ≈ 62,075,000.

---

## 1. The headline, in three sentences

Unichain Sepolia's Universal Router **expects the five-field `ExactInputSingleParams` layout** — the
layout this repository already ships — and it delivers a 32-byte order id to the hook intact. That
is the question `docs/feedback/uniswap/robinhood.md` left open for every new chain, and on this
chain the answer is the good one: **the router is not a blocker here.**

The blocker is ours. `src/libraries/UniswapDeployments.sol` resolves chain 11155111 and nothing
else, and the hook's constructor calls it twice, so the hook cannot be constructed on chain 1301 at
all. That file is frozen.

---

## 2. Verified addresses

Each address was transcribed from Uniswap's deployments page and then **read back from the chain**.
The byte count is the part that matters: an address that answers a call while holding a different
build is exactly the failure this repository already met once (`docs/feedback/uniswap/robinhood.md`,
chain 46630), and a bare "has code" check cannot see it.

Read with, for each address:

```sh
cast code <address> --rpc-url https://sepolia.unichain.org | wc -c   # (chars-3)/2 = bytes
```

| Contract | Address | Runtime bytes | Ethereum Sepolia, same read |
|---|---|---:|---:|
| PoolManager | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` | 24,009 | 24,009 |
| Universal Router | `0xf70536B3bcC1bD1a972dc186A2cf84cC6da6Be5D` | 19,540 | 19,540 |
| PositionManager | `0xf969aee60879c54baaed9f3ed26147db216fd664` | 23,877 | — |
| StateView | `0xc199f1072a74d4e905aba1a84d9a45e2546b6222` | 3,531 | 3,531 |
| Quoter | `0x56dcd40a3f2d466f48e7f48bdbe5cc9b92ae4472` | 5,820 | — |
| PoolSwapTest | `0x9140a78c1a137c7ff1c151ec8231272af78a99a4` | 6,950 | — |
| PoolModifyLiquidityTest | `0x5fa728c0a5cfd51bee4b060773f50554c0c8a7ab` | 6,050 | — |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152 | 9,152 |
| CREATE2 factory | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | 69 | 69 |
| Circle USDC | `0x31d0220469e10c4E71834a79b1f276d740d3768F` | 1,798 | — |

**No address in that table is empty.** If any of them ever is, the runner says so by name rather
than by a blank row.

### 2.1 The cross-check that makes the table self-consistent

Transcription is how a wrong address enters a document, so the table is not trusted on its own. Six
of the contracts were asked who their PoolManager is, and all six answered the same address:

```sh
cast call 0xf70536B3bcC1bD1a972dc186A2cf84cC6da6Be5D 'poolManager()(address)' --rpc-url https://sepolia.unichain.org
cast call 0xc199f1072a74d4e905aba1a84d9a45e2546b6222 'poolManager()(address)' --rpc-url https://sepolia.unichain.org
cast call 0xf969aee60879c54baaed9f3ed26147db216fd664 'poolManager()(address)' --rpc-url https://sepolia.unichain.org
cast call 0x56dcd40a3f2d466f48e7f48bdbe5cc9b92ae4472 'poolManager()(address)' --rpc-url https://sepolia.unichain.org
cast call 0x9140a78c1a137c7ff1c151ec8231272af78a99a4 'manager()(address)'     --rpc-url https://sepolia.unichain.org
cast call 0x5fa728c0a5cfd51bee4b060773f50554c0c8a7ab 'manager()(address)'     --rpc-url https://sepolia.unichain.org
```

All six return `0x00B036B58a818B1BC34d502D3fE730Db729e62AC`, which is also the address `hookmate`'s
`AddressConstants` already carries for chain 1301 — a source that was in this tree before this
investigation and could not have been fitted to it.

Circle's USDC on this chain reports `symbol()` `"USDC"` and `decimals()` `6`.

### 2.2 The CREATE2 factory is the same contract

```sh
cast code 0x4e59b44847b379578588920cA78FbF26c0B4956C --rpc-url https://sepolia.unichain.org | cast keccak
# code hash 0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989 — identical on Ethereum Sepolia
```

Same 69 bytes, same code hash. This is what makes the address arithmetic in section 4 carry across
chains at all.

---

## 3. The router-layout verdict, and the evidence for it

### 3.1 What was at stake

Our pinned v4-periphery (commit `7ebd04b`) encodes `ExactInputSingleParams` with five fields, which
reaches the router as nine words followed by the hook data. A Universal Router built from
v4-periphery at or after commit `03b2d09` expects a sixth static field, `minHopPriceX36`, ahead of
the hook data, and refuses the five-field call with an empty revert whenever hook data is present.
Hook data is how every UNICA settlement carries its order id. Nothing in the router lets an
integrator ask which layout a deployment expects. It has to be measured against the real bytecode.

### 3.2 How it was measured

`script/UnichainSepoliaProbe.s.sol`, run against a fork of each chain, no broadcast:

```sh
forge script script/UnichainSepoliaProbe.s.sol:UnichainSepoliaProbe --sig "selfTest()" --rpc-url https://sepolia.unichain.org
forge script script/UnichainSepoliaProbe.s.sol:UnichainSepoliaProbe --sig "run()"      --rpc-url https://sepolia.unichain.org
forge script script/UnichainSepoliaProbe.s.sol:UnichainSepoliaProbe --sig "run()"      --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

The PoolManager and the Universal Router are the chain's own deployed bytecode. The recording hook,
the second currency and the liquidity router are local — none of them is the subject, and using a
local token removes a faucet from the experiment. The hook records the hook data it was handed, and
**every verdict is read against that recording, never against the absence of a revert**: a swap can
succeed while the router silently delivers empty hook data, and a probe that only asked "did it
revert?" would call that a pass.

### 3.3 The result

| Row | Chain 1301 | Chain 11155111 (control) |
|---|---|---|
| Five-field, 32-byte order id — swap succeeds | PASS | PASS |
| Five-field, 32-byte order id — **hook receives that order id** | **PASS** | **PASS** |
| Five-field, empty hook data — swap succeeds, hook receives nothing | PASS | PASS |
| Six-field, `minHopPriceX36 = 0` — order id does **not** reach the hook | PASS (swap succeeded, 0 bytes delivered) | PASS (swap succeeded, 0 bytes delivered) |
| Six-field, `minHopPriceX36` non-zero — swap refused | PASS | PASS |
| Sabotage: body below the decoder's `0x140` minimum — refused | PASS | PASS |
| Frozen library resolves this chain | **no** | yes |

**Verdict: chain 1301's Universal Router expects the FIVE-field layout.** UNICA's shipped swap
encoding reaches the hook intact. This chain is not the Robinhood case.

### 3.4 The corroborating read: it is one build

The two routers are the same size, and every byte that differs between them falls inside a whole
20-byte run — twenty-two such runs, 440 bytes, and every one of them reads as an address
(`0x4200…0006` against Sepolia's WETH, the two PoolManagers, the two PositionManagers, the V2 and V3
factories). Twenty bytes is an address and nothing else in EVM code is that shape by accident, so
this is the shape of one compiled build carrying different constructor immutables.

```sh
cast code 0xf70536B3bcC1bD1a972dc186A2cf84cC6da6Be5D --rpc-url https://sepolia.unichain.org > /tmp/a.hex
cast code 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b --rpc-url https://ethereum-sepolia-rpc.publicnode.com > /tmp/b.hex
python3 docs/chains/immutables-only-diff.py /tmp/a.hex /tmp/b.hex
# size 19540, differing bytes 440, runs 22, runs that are not 20 bytes 0
```

**This is corroboration, not the proof.** It is a statement about runtime shape, not about source.
The proof is the fork run in 3.3, which drove real hook data through the real bytecode. If the two
ever stopped agreeing, the fork run wins and this row is the one to distrust.

### 3.5 A hazard this measurement exposed, in the other direction

On a five-field router — which is to say on **both** chains here — a six-field encoding with
`minHopPriceX36 = 0` does not revert. **The swap succeeds and the hook data silently becomes
empty**, because the five-field decoder reads the zero in word 8 as the hook-data offset and lands
back on the head of the struct, whose first word is the native currency, zero, which it then reads
as a length.

So an integrator who "upgrades" to the newer layout in order to be compatible with newer routers
gets, on these chains, a swap that succeeds while dropping the order id it was carrying. For UNICA
that fails closed — the hook has no order id and refuses, so no receipt is minted and
`SettlementExecutor` reverts with `NoReceipt` — but for an integrator whose hook data is advisory
rather than load-bearing, it fails **silently**, and nothing anywhere reports it. That direction of
the incompatibility is not described in `robinhood.md`, and it is worth saying to Uniswap alongside
the original finding.

---

## 4. The mined addresses

```sh
forge script script/HookAddressForChain.s.sol:HookAddressForChain --sig "run()" --rpc-url https://sepolia.unichain.org
```

| | |
|---|---|
| Hook init-code hash | `0x05fec191b5582cac2b1498355e221db356ee00066d4c306577330e9c8ab114f2` |
| Salt | `0x0000000000000000000000000000000000000000000000000000000000000d76` (3446; 3447 salts tried) |
| Hook address | `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` |
| Address flag bits | `0x20C0` — beforeInitialize, beforeSwap, afterSwap |
| Executor address | `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210` (salt zero, hook as its one argument) |
| Both addresses on chain 1301 | **vacant** (`cast code` returns `0x`) |

**Reproducibility.** The script derives the address twice: once with a loop written from the CREATE2
rule, once through Uniswap's own `HookMiner` by way of `LiveFire.predict()`. It refuses to print a
result unless the two agree on both the address and the salt. A bug would have to exist identically
in both to survive.

**Why the salt did not need re-mining, and when it will.** A CREATE2 address is
`keccak(0xff, factory, salt, keccak(initCode))`. No chain id enters it, and the factory is byte-identical
on both chains, so the same creation code lands on the same address everywhere — which is why this
is the address UNICA is already live at on Ethereum Sepolia. What forces a re-mine is a change to
the **creation code**, and the hook's creation code embeds `src/libraries/UniswapDeployments.sol`.
The moment chain 1301 is added to that file, the init-code hash changes, the salt changes, and the
address changes. **The number to compare across that change is the init-code hash above; the address
is only its shadow.**

---

## 5. The blocker: two source changes, one of them frozen

Neither of these is made in this pass. Both are named so the decision is the owner's.

### 5.1 `src/libraries/UniswapDeployments.sol` — FROZEN

```solidity
function universalRouter(uint256 chainId) internal pure returns (address) {
    if (chainId == 11155111) return 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
    revert UnsupportedChainId(chainId);
}
function payoutCurrency(uint256 chainId) internal pure returns (address) {
    if (chainId == 11155111) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    revert UnsupportedChainId(chainId);
}
```

`V4SettlementHook`'s constructor calls both. On chain 1301 both revert, so **the hook cannot be
constructed there** — the deploy fails before the router layout is ever reached. Measured, not
assumed: row 7 of the probe calls each function through an external `try` so the revert is isolated
to the library and cannot be blamed on `BaseHook`'s own address validation.

Adding chain 1301 would mean `0xf70536B3bcC1bD1a972dc186A2cf84cC6da6Be5D` and
`0x31d0220469e10c4E71834a79b1f276d740d3768F`, and — per section 4 — a new init-code hash, a new
salt, a new hook address, a new executor address, and a re-verification of everything downstream of
the hook address, including the existing Ethereum Sepolia deployment's relationship to this build.
The file's own comment already says this: *"Adding a chain here changes the hook's creation code,
and so its address."*

### 5.2 `script/Chains.sol`

`requireTestnet` admits 11155111 only, and `get` has no `Config` for 1301. The init, seed and settle
stages all call one or both, so they revert on chain 1301 before touching the chain. A 1301 entry
would need the USDC, PoolSwapTest, PoolModifyLiquidityTest and StateView addresses from section 2,
plus an explorer URL — **and the explorer URL is the one field in that struct this document has not
verified**, because nothing here reads it.

---

## 6. The deploy sequence, if and when it is unblocked

**Do not run these today.** Every one of them reverts against the current build, at the point named
in section 5. They are written out so the cost and the proof of each stage are known before the
decision, not after.

Gas figures are the **measured** gas of the identical stages on Ethereum Sepolia, read from the live
receipts in `broadcast/`. At chain 1301's observed `cast gas-price` of 1,500,000 wei
(0.0015 gwei) the whole sequence is about **0.0000089 ETH** of execution gas.

> **The L1 data fee is not in these numbers.** Unichain is an OP-stack chain and posts calldata to
> Ethereum; that component is not returned by `cast gas-price` and is normally the larger half of an
> OP-stack testnet cost. Treat the ETH figures below as a floor, not an estimate, and read the real
> total from the first receipt.

| # | Command | Measured gas (Sepolia) | What it proves |
|---|---|---:|---|
| 0 | `bash docs/chains/verify-unichain-sepolia.sh` | 0 | The ground is what this document says. Run it first, every time; it costs nothing. |
| 1 | `forge script script/HookAddressForChain.s.sol:HookAddressForChain --sig "run()" --rpc-url $RPC` | 0 | The hook address for the **build being deployed**, derived twice, and that it is still vacant. After the change in 5.1 this will print a different address than section 4 — that is expected, and it is the number to carry forward. |
| 2 | `forge script script/DeploySettlement.s.sol --sig "deploy()" --rpc-url $RPC --account <keystore> --sender <addr> --broadcast` | 2,603,048 (hook) + 2,510,930 (executor) | The hook lands on the mined address, its address carries `0x20C0`, and the executor lands exactly where the hook derives it — the script asserts all three and reverts otherwise. |
| 3 | `forge script script/Interactions.s.sol:InitPool --rpc-url $RPC --account <keystore> --sender <addr> --broadcast` | 56,966 | The native-ETH/USDC pool exists at the price this script chose, and `beforeInitialize` admitted it. The stage refuses to continue if someone else initialised the pool at another price. |
| 4 | `forge script script/Interactions.s.sol:SeedLiquidity --rpc-url $RPC --account <keystore> --sender <addr> --broadcast` | 55,437 (approve) + 259,843 (seed) | The pool has liquidity at that same price, seeded only if `slot0` still reports it. Needs USDC on chain 1301 from a faucet first; the stage refuses below its floor rather than seeding a pool too thin to read. |
| 5 | `forge script script/Interactions.s.sol:Settle --rpc-url $RPC --account <keystore> --sender <addr> --broadcast` | 281,144 (createOrder) + 195,783 (pay) | **The whole thesis, once.** An order is created, paid through the official Universal Router, and the hook mints exactly one `SettlementReceipt`. This is the stage the section 3 verdict was about. |
| 6 | `bash docs/chains/verify-unichain-sepolia.sh` again, plus a chain-1301 analogue of `docs/proof/verify-live.sh` | 0 | That the settlement is on the chain and not only in a log. **That analogue does not exist yet** — `verify-live.sh` is written against Ethereum Sepolia addresses throughout. |

Signing: `--account <keystore>` and `--sender <addr>`, never a raw key on a command line, and never a
key in this repository. `forge` simulates the entire run **before** it prompts for the keystore
password, so any deadline in the plan is measured from the simulation, not the broadcast — this
repository has already lost one settlement to exactly that (`docs/DEPLOYMENT.md`).

---

## 7. What is not verified, and cannot be until a deploy exists

Stated as negatives, because an absence and a broken reporter look identical.

1. **No UNICA contract has ever executed on chain 1301.** Every result in section 3 comes from a
   fork with a locally placed hook. A fork is the real router bytecode and the real PoolManager
   state; it is not the real chain's gas, mempool, sequencer, or L1 data-fee behaviour.
2. **The router's source is not verified by this document.** Section 3.4 compares runtimes, not
   source. Whether Uniswap's published source for the chain-1301 router matches the chain-11155111
   one was not checked here.
3. **The hook address in section 4 is not the address a real deploy would use**, because a real
   deploy requires the change in 5.1, which changes the creation code. The address after that change
   has not been computed, because computing it would mean editing a frozen file.
4. **No liquidity, no faucet, and no funded account exist on chain 1301 for this project.** Whether
   the Circle USDC faucet serves this chain was not tested.
5. **The explorer URL** that `script/Chains.sol`'s `Config` requires was not read or verified.
6. **The L1 data fee is unmeasured**, so the ETH cost in section 6 is a floor and not an estimate.
7. **No claim of Uniswap support, listing, or endorsement on this chain is made or implied.** This
   is an assessment of a public testnet's public contracts.

---

## 8. Re-running all of it

```sh
bash docs/chains/verify-unichain-sepolia.sh
# optionally with your own endpoints:
bash docs/chains/verify-unichain-sepolia.sh <unichain-sepolia-rpc> <ethereum-sepolia-rpc>
```

28 checks. Address byte counts, the six PoolManager cross-checks, USDC's symbol and decimals, both
mined addresses still vacant, the two-router runtime comparison, the probe's own self-test, the
probe on both chains, and the blocker in 5.1 asserted **in the direction that is true today** — so
that row goes red the day chain 1301 is added to the frozen library, which is exactly when this
document needs rewriting and is most likely to be forgotten.

Every `cast` is retried on an empty answer through `docs/proof/retry.sh`, and the fork probe is
retried the same way: measured on 2026-09-09, two consecutive runs of this runner against the
default public endpoint gave 28/28 and then 25/28, with two probe rows red, because a fork read went
unanswered mid-run. The chain had not changed. A read that never arrived prints SKIP and names the
endpoint; it is never folded into a pass and never scored as a chain that said no.

### The guards were validated by sabotage, not by having passed

| Sabotage | Expected | Observed |
|---|---|---|
| Recording hook rewired to always report the order id | probe self-test goes red | red — `failed: 1` |
| Expected router byte count changed to 19,541 | that row goes red | red — `passed: 27, failed: 1` |
| Control endpoint replaced with an unreachable host | SKIP, never FAIL | 3 SKIP, 0 FAIL |
| Runtime comparison fed two different-sized runtimes | exit 1 | exit 1 |
| Runtime comparison fed one runtime twice | exit 1 — identical is not the subject | exit 1 |
| Runtime comparison fed a runtime with one byte flipped outside an immutable | exit 1 | exit 1, naming the 1-byte run |
