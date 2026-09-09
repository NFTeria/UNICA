# UNICA — the submission packet

Every field below is a copy-paste block. Nothing here is written for effect: each number was
re-derived from the repository at the commit carrying this file, and the two things that are not
yet true are marked `[OWNER]` rather than written as though they were.

Re-derive the numbers before pasting, because a stale count in a submission is the kind of error
that is checked:

```sh
git rev-list --count HEAD
forge test --no-match-path '{test/fork/*,test/compat/*,test/v3/DeploymentsV3Fork.t.sol}' | tail -1
bash script/scan.sh | tail -1
```

At the commit this file lands on: **282 commits · 298 tests passing across 33 suites, 0 failed ·
31 scan checks.**

---

## 1 · Project name

```
UNICA
```

## 2 · Tagline

```
A merchant's till becomes a portfolio — and the portfolio still spends.
```

## 3 · Short description

```
UNICA is a Uniswap v4 hook that turns a merchant's incoming payment into an exact,
order-bound settlement. The payer swaps whatever they hold; the merchant is paid the
exact amount they quoted, in the asset they chose, or the transaction reverts and
nobody moves. The hook enforces it, an indexable receipt proves it, and a live
Sepolia deployment has done it.
```

## 4 · Long description

```
A merchant who accepts crypto today faces a choice nobody should have to make: hold
the asset and take the risk, or convert immediately and pay for the privilege. UNICA
removes the choice. The till and the treasury become one surface.

WHAT IT DOES. A merchant registers a quote — recipient, payout asset, exact amount,
deadline. A payer arrives holding something else entirely and swaps through a Uniswap
v4 pool. UNICA's hook sits on that pool and enforces the merchant's half of the deal:
the recipient resolves from authenticated storage and never from caller-supplied
data, the fill is exact or the swap reverts, and a receipt carrying the order id and
the standardized HookFee event is emitted for anyone to index.

WHAT MAKES IT A HOOK RATHER THAN A ROUTER. Everything above is enforced inside the
pool's own execution, so there is no window between "the swap succeeded" and "the
merchant was paid" for anything to go wrong. The hook holds no custody, takes no fee,
returns no delta, and runs no oracle. Its permission bits are 0x20C0 — beforeInitialize,
beforeSwap, afterSwap — and the two dangerous return-delta bits are provably clear,
computable from the deployed address alone with no RPC call.

WHAT IS ACTUALLY LIVE. One hook and one executor on Ethereum Sepolia, both source-
verified, that have settled a real swap: 0.001 ETH in, 2.216294 USDC out, receipt on
chain. Thirty-one independent chain checks re-read that deployment on demand and
report "31 of 31" rather than a blank panel.

HOW IT WAS BUILT. Every guard in this repository has been broken on purpose and
watched to fail — a check that has never failed is not a check. The gas economics of
the experimental nano-authorization hook say plainly that it is not viable on L1 at
any plausible gas price, and that finding is published rather than buried, because a
project that says only the flattering half of what it measured has spent trust it
cannot buy back.
```

## 5 · How it's made

```
Solidity 0.8.30, Foundry, Uniswap v4 (official PoolManager and Universal Router on
Sepolia), Permit2. The hook address is CREATE2-mined so its low bits encode exactly
the three permissions it uses.

The order registry is the sole quote source. Caller-supplied hookData authenticates
nothing, so it carries one index and every consequential value — payee, amount,
deadline — resolves from storage written by an authenticated call. Native settlement
syncs immediately before settle with control yielded to nothing in between, and
refunds are pull, never push: a push refund hands the recipient a veto over the
payer, and that was measured, not assumed.

Around the hook: an ENSv2 merchant-identity path that fails closed on eleven distinct
resolution failures, a Chainlink confidential workflow running in the CRE simulator,
an Arc USDC treasury that reads a live position and stops in front of the signature,
and a subgraph. A separate hook lab pushes v4 until it breaks — the hookData ceiling
is 929,792 bytes at 35,018,725 gas, proven on both sides.

Two documents predate the build window and ship disclosed and unedited: the hook
specification and the threat model, both in specs/, both prose and not code. Every
line of code in this repository was written inside the window; the first commit is
2026-09-04 20:00:06 UTC and zero commits precede it.
```

---

## 6 · The three tracks

Ranked by what the repository can actually demonstrate, not by prize size.

### 6a · Uniswap — Best Uniswap Stack Contribution (From Scratch)

```
UNICA is a v4 hook that makes exact-fill merchant settlement enforceable inside the
pool, deployed and source-verified on Sepolia with a real settled swap.

Reach, stated exactly. V1 is live on Ethereum Sepolia and has SETTLED A REAL SWAP
through the hook. V3 is deployed and source-verified on FOUR chains — Ethereum
Sepolia, Unichain Sepolia, Base Sepolia and Arbitrum Sepolia — at one mined CREATE2
address, 0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0 for the hook and
0x015692C9E43ca19a2504F79368D1156A56680517 for the executor, each bound to that
chain's own official v4 PoolManager. V3 HAS SETTLED NOTHING: receiptCount() and
orderCount() are 0 on all four chains. Deployed and bound is the rung it reaches;
exercised is not, and we are not claiming it. The one settled swap is V1's, on one
chain. `bash script/verify-v3.sh` re-reads all of it from the chain — 65 checks, 0
failed — and prints those two zeros as zeros rather than scoring them as a pass.

The contribution back to the stack is four findings, each reproducible:

1. The v4-periphery router's ExactInputSingleParams gained a sixth field
   (minHopPriceX36) at commit 03b2d09. An integrator built against the five-field
   layout gets an empty revert from inside unlockCallback, with nothing naming the
   cause. We reproduced it three independent ways.

2. Worse, on a native-currency pool the five-field router ACCEPTS six-field encoding.
   The extra word is misread as the hookData offset, offset zero lands on currency0,
   and the zero there reads as length zero — so hookData is silently dropped and the
   swap succeeds. A silent wrong answer, not an error.

3. BEFORE_SWAP_RETURNS_DELTA is address bit 3. Bit 10 is AFTER_ADD_LIQUIDITY, an
   unrelated permission. A reviewer checking "bit 10" for return-delta reads the wrong
   flag and can green-light a hook that consumes the payer's swap. Our study asserts
   the theft on balances — payer spends the full input, receives zero, the hook's own
   balance rises by exactly that amount — because a test that only checks for a revert
   passes against a hook that steals.

4. A hook that mines one CREATE2 address for many chains cannot also reach Sourcify's
   exact_match tier, and the trade-off is not documented anywhere we could find. The
   address is a function of the init code, so the init code must be byte-identical
   across chains, which means bytecode_hash="none" and cbor_metadata=false — and with
   no metadata hash in the deployed bytecode Sourcify caps the tier at `match`. All
   eight of our V3 verifications sit at `match` for exactly this reason. Note also that
   forge prints "Status: `match`", which reads like success at full tier and is not;
   the tier is only legible from /server/v2/contract/<chainId>/<address>. A second
   consequence worth documenting: the RUNTIME hash then differs per chain anyway,
   because immutables are written in at construction — ours differs in 300 bytes across
   15 regions in the hook and 276 across 12 in the executor, every one of them a
   chain-specific immutable. "Same address" does not mean "same runtime bytecode", and
   a verifier that assumes it will be wrong on every multi-chain hook.
```

### 6b · Chainlink — Best Confidential Workflow (From Scratch)

```
A confidential workflow that decides one bounded treasury action from a merchant's
position and never reveals the policy that decided it. It runs in Chainlink's own CRE
simulator today.

Evidence is graded rather than asserted: what the simulator proves is labelled
CRE_CONFIDENTIAL_SIMULATION, and TEE_ATTESTED is reserved for what a TEE has actually
attested. The two are never conflated, because a workflow that claims attestation it
does not have is worse than one that claims nothing.
```

### 6c · ENS — Best Use of ENSv2 (From Scratch)

```
A merchant is named, not addressed. The checkout resolves an ENSv2 name live on
Sepolia, validates the answer, shows the payer the resolved address, and binds exactly
that address into the order — and refuses, by name, on eleven distinct failures.

The finding that shaped it: of the three ways an ENS lookup fails, only one reverts.
An unregistered subname under a wildcard parent SUCCEEDS and returns the zero address,
and so does a registered name with no address record. An integration that catches
reverts and nothing else hands address(0) to createOrder. Every caller here gets a
classified status, never a bare address.

Two resolver families also disagree about which argument decides the answer, and
neither errors on a mismatch — asking for one name while passing another's node
returns the other's address. In a payment product that is the wrong merchant, so
namehash is computed locally and never delegated.

[OWNER] The delegation demo needs one Sepolia testnet name registered. All names in
this project are Sepolia testnet fixtures; UNICA claims no ownership of, affiliation
with, or connection to any mainnet name.
```

---

## 7 · Two tracks we are NOT claiming, and why

Written down so nobody has to discover it in judging.

```
THE GRAPH — not claimed. The subgraph, schema, handlers and six tests exist and pass
locally, but nothing is deployed to Studio, so no successful live read has ever been
observed. The published requirement excludes local-only datasets. Our own live command
exits non-zero rather than pretending otherwise.

ARC — not claimed as a deployment. The treasury reads a live Arc position and emits a
signable preview, and no transaction has been broadcast, so there is no hash to cite.
The finding we would offer regardless: Arc reports the same USDC at two scales at the
same instant — 18 decimals through eth_getBalance, 6 through the ERC-20's decimals() —
and they mirror through 10^12. A builder who reads "USDC is 18 on Arc" corrupts every
ERC-20 amount by a trillion, silently.
```

## 8 · Disclosure — paste verbatim, and say it on camera

```
The hook specification and the threat model were written before the event and ship
unedited, disclosed in specs/, in the README, and here. They are prose, not code. Every
line of code in this repository was written during the event.

Prior public work by the same author in this area is named as prior art and is never
linked, vendored or copied. Two Vyper contracts from that earlier work are deliberately
left untracked: they are not in the repository, not built, and not claimed.
```

## 9 · Links

```
Repository   https://github.com/NFTeria/UNICA

V1 — Ethereum Sepolia, verified, HAS SETTLED A REAL SWAP
Hook         0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0
Executor     0x044bc8a8773EC7b9B8de2467766636dFFCaC6210
PoolManager  0xE03A1074c86CFeDd5C142C4F04F1a1536e203543   (Uniswap's official Sepolia deployment)

V3 — four chains, verified at Sourcify's `match` tier, DEPLOYED AND BOUND, SETTLED NOTHING
Hook         0x5d6AdF56facB123A2e46D36EA7034cb393D6A0c0   (same address on all four)
Executor     0x015692C9E43ca19a2504F79368D1156A56680517   (same address on all four)
  Ethereum Sepolia 11155111   PoolManager 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
  Unichain Sepolia 1301       PoolManager 0x00B036B58a818B1BC34d502D3fE730Db729e62AC
  Base Sepolia     84532      PoolManager 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
  Arbitrum Sepolia 421614     PoolManager 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317
  receiptCount() = 0 and orderCount() = 0 on all four. Nothing has been settled on V3.
```

Anyone can re-run the proof:

```sh
make proof      # V3's 65 four-chain reads, then V1's 14 offline rows and 31 live reads
make gate       # build, 298 tests, format, secret scan, never-copy, size budget,
                # and the V3 proof's 25 endpoint-free rows
```

`make proof` needs four testnet endpoints; `make gate` needs none. That split is deliberate — a
gate that depends on somebody else's node is a status page, not a gate.

## 10 · The owner queue — nothing below can be done for you

| # | Action | Why it is yours |
|---|---|---|
| 1 | Register the Sepolia testnet parent name | signs a transaction |
| 2 | Deploy the subgraph to Studio, or leave The Graph unclaimed | account + publish |
| 3 | Record the demo video with a live human voice | it must be your voice |
| 4 | Re-capture `docs/submission-media/screenshots/02-live-sepolia-evidence.png` | needs a browser; its face still shows the old 182 / 1,543 counts |
| 5 | Paste these blocks into the dashboard and press Submit | the submission is yours |

Send back from step 1 only: owner address · registration transaction hash · the full Sepolia
name · expiry. Never a key, seed phrase, session token or wallet export.

## Status

`SUBMISSION_COPY_READY` — every field drafted from verified numbers, two tracks explicitly not
claimed, four owner actions outstanding. No form has been submitted and no video uploaded.
