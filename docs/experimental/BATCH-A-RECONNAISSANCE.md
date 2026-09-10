# Batch A — reconnaissance for a hook-enforced stock-token settlement experiment

Read-only. **No chain write was made and none is proposed as done.** Chain reads are pinned to
block `117062317` on chain `46630` and were taken through both the primary RPC and the explorer's
`/api/eth-rpc`, which agreed on every value reported here.

Scope: whether a Uniswap v4 hook-enforced payment, funded with a faucet-issued TSLA test token and
settling into a separate merchant payout test token, is buildable on Robinhood testnet. Batch A
answers what is there. It does not build anything.

---

## 1. Confidentiality and publication boundary

**No file-level publication restriction exists in this repository.** A scoped search of
`integrations/chainlink-cre-guardian/` and `docs/feedback/chainlink.md` for sponsor-only,
do-not-publish, or publication-limit language returned nothing.

What the repository does carry is a **data-level** boundary, stated in the workflow itself: which
fields of a workflow's PUBLIC output may never carry a PRIVATE policy value. `secret-names.yaml`
declares itself safe to commit precisely because it holds names and never values.

| May be committed                                        | Must not be                           |
| ------------------------------------------------------- | ------------------------------------- |
| Approved public interfaces, sanitized schemas           | Any secret VALUE                      |
| Environment-variable NAMES (five exist; all documented) | A private RPC URL                     |
| Deterministic mocks and offline tests                   | Enrollment or account-approval detail |
| Publishable workflow code                               | Anything a file marks private         |
| Public deployment identifiers                           | The contents of `workflow/.env`       |

`integrations/chainlink-cre-guardian/workflow/.env` exists on disk, is untracked, is matched by
`.gitignore:207`, and **was deliberately not opened**. Its contents are unknown to this report.

**Nothing in Batch A requires committing confidential material.** No boundary blocks the work.

---

## 2. The CRE finding, which changes the proposed architecture

**There is no mechanism in this repository by which an on-chain contract could verify a Chainlink
CRE report.** No DON-signature check, no forwarder, no attestation verifier, no on-chain decode of
a CRE output. `integrations/chainlink-cre-guardian/` contains **no Solidity or Vyper file at all**.

The repository's own evidence module names `ONCHAIN_VERIFIED` in a list of modes it is not allowed
to claim, alongside `TEE_ATTESTED`, `DON_EXECUTED` and `CONFIDENTIAL_EXECUTION`.

| Tier                    | What exists                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Deployed                | **Nothing.** `cre whoami` reported _Deploy Access: Not enabled_; account access was awaiting review                          |
| Simulated, real runtime | `workflow/main.ts` + `guardian.ts` ran under `cre workflow simulate`, CLI v1.32.0                                            |
| Offline reference model | `policy.mjs`, `strategy.mjs`, `adapter.mjs`, `evidence.mjs`, `simulate.mjs`, `profiles.mjs` — none ever imported the CRE SDK |

**Consequence for the design.** The proposed sequence includes "an authenticated report or
authorization, if used". _If used_ is the operative clause, and today it cannot be. Any
authorization field list is **design, not a verified mechanism**, and no contract may be written
that trusts a CRE report until a real verification path is established.

The settlement must therefore be **fully enforced on-chain without CRE**, and CRE participates as
policy, simulation, monitoring and receipt verification **around** it. That is what the brief asked
for; this section records that it is not optional but forced.

---

## 3. Chain 46630 at block 117062317

### 3.1 Infrastructure — previously verified in-repo, unchanged

| Contract         | Address                                      | Runtime bytes                 |
| ---------------- | -------------------------------------------- | ----------------------------- |
| PoolManager      | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | 24,009                        |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` | **24,546** (six-field layout) |
| PositionManager  | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | 23,877                        |
| Quoter           | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | 6,118                         |
| StateView        | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | 3,531                         |
| Permit2          | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152                         |

**Permit2 is present with byte-parity across all five chains.** No behavioural check — no
signature transfer, no witness signing — has ever been run against this chain's instance.

### 3.2 The input token is live, not a toy

TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`, 18 decimals: **220,109 holders, 4,638,590
transfers.** Swaps route through the exact Universal Router above, minutes before this read.
PoolManager held **209.060254015121176456 TSLA** and 913.023559858261688575 native ETH.

### 3.3 The pools — and the reason Path 1 fails

Four TSLA pools are initialized with live liquidity. All four carry `hooks = address(0)`.

| Pair              | fee / spacing | liquidity         | pool id                                                                      |
| ----------------- | ------------- | ----------------- | ---------------------------------------------------------------------------- |
| TSLA / "USDC"(6d) | 3000 / 60     | 100000000000000   | pool id `0x55224af3f9f2a4267816ccf1b1f1621f91b0a82cf0a6f4177eb5908282b4745e` |
| TSLA / native     | 500 / 10      | 400000000000000   | pool id `0xcd5b37560fdaf7cabd475c51d4e5127d7321d6eb45e3d5bacf61f59b91b6a069` |
| TSLA / native     | 3000 / 60     | 9317359905456595  | pool id `0xa80def62bcca3e86333c6060039ce1e430738b701a109a6d3a6d99fbe936eb96` |
| TSLA / native     | 10000 / 200   | 14142135623730950 | pool id `0x197d7e73cb45f6f3974316879f46fc19c80c78f3f1096ecd58effe52cd9b2152` |

Executable quotes from the Quoter:

| Pool                    | Input    | Output                 | Implied rate |
| ----------------------- | -------- | ---------------------- | ------------ |
| TSLA/"USDC"(6d) 3000/60 | 0.1 TSLA | 39531580 (39.531580)   | 395.3        |
| TSLA/"USDC"(6d) 3000/60 | 1.0 TSLA | 335893108 (335.893108) | 335.9        |
| TSLA/native 10000/200   | 1.0 TSLA | 8104677426580296 wei   | —            |

**About 15% slippage between 0.1 and 1.0 TSLA.** Any experimental settlement must be small.

### 3.4 Symbol is not identity on this chain

The token index returns **four** contracts with symbol `USDC` — two of them at 18 decimals, where
Circle's USDC has 6 — **six** with `USDG`, two `WETH`, and an `eTSLA` beside `TSLA`. Only three
payout candidates hold any v4 liquidity:

| Candidate                                               | Decimals | PoolManager balance  | Issuer / mint authority |
| ------------------------------------------------------- | -------- | -------------------- | ----------------------- |
| `0xAc80194dc1aE8eF52df73e7e1864fB3C62290fe0` sym `USDC` | 6        | 2963562828796900600  | **unverified**          |
| `0x7E955252E15c84f5768B83c41a71F9eba181802F` sym `USDG` | 6        | 3568665633           | **unverified**          |
| `0x33e4191705c386532ba27cBF171Db86919200B94` sym `WETH` | 18       | 16202882426905189938 | **unverified**          |

Circle's four testnet USDC addresses hold **zero bytes** on 46630. **None of these is Circle's.**
Under this project's own rule, none may be called USDC in product language, and the first one's
PoolManager balance reads implausibly large for a 6-decimal token — that alone needs explaining
before it is trusted with a merchant payout.

---

## 4. Liquidity path — selected: **Path 2**

**Path 1 is available on liquidity and blocked on architecture.** A hook enforces policy only on a
pool whose `hooks` field is that hook. Every existing TSLA pool is hookless. Enforcement cannot be
attached to them, so they cannot be the settlement venue for a hook-enforced payment.

**Path 2 is selected**: initialize a dedicated hook-enabled pool with verified test tokens and seed
minimal test liquidity. The existing hookless pools then serve a second, better purpose — they are
an **independent executable reference price** for the same pair, which is exactly the input the
deviation check needs. Quoting and settling in the same pool would have given one source pretending
to be two.

Path 2's precondition — that the program permits pool initialization and liquidity seeding — is
**not established** and is a blocker below.

---

## 5. Invariant allocation

Derived from the deployed V3 generation. Every row is a property the experimental generation must
re-establish, not inherit.

| Invariant                                       | Enforced by     | Where                                        | Can that layer observe it?                                      |
| ----------------------------------------------- | --------------- | -------------------------------------------- | --------------------------------------------------------------- |
| Pool shape (input/payout currencies)            | Hook            | `_beforeInitialize`, `NotTheSettlementShape` | Yes — the key is the only thing that exists yet                 |
| Caller is the official router                   | Hook            | `_beforeSwap`, `NotOfficialPath`             | Yes                                                             |
| Router's `msgSender()` is our executor          | Hook            | `_beforeSwap`, `NotSettlementExecutor`       | Yes, **trusting the router's own attribution**                  |
| Order in flight, not replayed this tx           | Hook            | `_beforeSwap`, transient storage             | Yes                                                             |
| Deadline                                        | Hook + executor | `_beforeSwap` and `pay()`                    | Yes                                                             |
| Swap params match the order                     | Hook            | `_beforeSwap`, `ParamsDoNotMatchOrder`       | Yes                                                             |
| Full fill (no partial)                          | Hook            | `_afterSwap`, `PartialFill`                  | **Only here** — the delta does not exist before the swap        |
| Output ≥ minimum, by pool delta                 | Hook            | `_afterSwap`, `OutputBelowMinimum`           | Only here                                                       |
| Recipient's **measured balance** rose ≥ minimum | Executor        | `pay()`, `RecipientShort`                    | **Only here** — an independent measurement, not the pool's word |
| Exactly one receipt was emitted                 | Executor        | `pay()`, `NoReceipt`                         | Only here                                                       |
| Router bytecode unchanged                       | Executor        | `_requireRouterUnchanged`                    | Yes                                                             |
| Recipient fixed, never re-resolved              | Executor        | `createOrder` stores it                      | Yes                                                             |
| Reserved-recipient refusal                      | Executor        | `ReservedRecipient`                          | Yes                                                             |
| Order id uniqueness / replay                    | Executor        | `OrderExists`, status machine                | Yes                                                             |
| Hook permission bits match the address          | **PoolManager** | v4-core                                      | Not ours to enforce                                             |
| Router decodes our action plan as intended      | **Router**      | Universal Router                             | Not ours; layout selected, then trusted                         |

**Two checks are irreplaceable and must both survive**: the hook's delta check (authoritative
inside the swap) and the executor's balance-delta check (authoritative at the recipient). Neither
subsumes the other.

---

## 6. What an ERC-20 input changes

`docs/INPUT-POLICY-SPEC.md` already specifies this and is **not implemented**. Its chosen design is
**executor transient custody**: the payer signs a Permit2 _signature transfer_ naming the executor
as spender for exactly `amountIn`, with a witness binding order id, pool id, recipient, tokenIn,
amountIn, tokenOut, minOut and deadline — so the payer signs exactly what the executor enforces.
Two rejected designs are recorded with reasons: parking tokens on the router (sweepable by the next
caller) and letting the payer call the router directly (breaks the hook's order binding).

Concretely different from the live native path: a Permit2 leg appears; `SETTLE`'s `payerIsUser`
flips; and `zeroForOne` stops being a hard-coded constant. **That spec is scoped to Ethereum
Sepolia and explicitly decides nothing for any other chain, 46630 included.**

---

## 7. Threat model additions specific to this chain

Beyond the standard matrix, this chain forces three that the Sepolia work never faced:

1. **Symbol impersonation.** Four `USDC`, six `USDG`, an `eTSLA`. A payout token must be pinned by
   address with verified provenance; a symbol match must never be sufficient.
2. **Decimal ambiguity.** Same symbol, different decimals, on the same chain. Any amount rendered
   or compared without its token's own `decimals()` is a defect.
3. **The six-field router layout.** Already recorded: a router built after v4-periphery `03b2d09`
   refuses the five-field encoding with an empty revert inside `unlockCallback`, and exposes no
   version discriminator to detect it before broadcasting.

---

## 8. Blockers

1. **No on-chain CRE verification path exists** — so no contract may trust a CRE report. `[BLOCKER]`
2. **CRE Deploy Access not enabled**; account access was awaiting review. No DON deployment or TEE
   attestation may be claimed. `[BLOCKER]`
3. **No verified payout token on 46630.** Every candidate's issuer and mint authority is unknown.
   `payoutCurrency(46630)` reverts, so **V3 cannot be constructed on this chain at all**. `[BLOCKER]`
4. **Path 2's permission is unestablished** — whether pool initialization and liquidity seeding are
   allowed by the program. `[BLOCKER]`
5. **Permit2 on 46630 is byte-verified but never behaviourally tested.** `[BLOCKER for the input leg]`
6. Which of the four `USDC`-symbol contracts the TSLA pool pairs with is not yet confirmed by
   reading the pool key back from an Initialize event.

---

## 9. First write — proposed, NOT performed

No write is requested in Batch A. The first one that will be needed, once blocker 4 is resolved, is
**deploying a clearly-named test payout token** — not the hook, not the pool. It comes first because
every later step needs a payout asset whose issuer and mint authority we can state.

It will be proposed under the approval protocol with purpose, chain, signer, target, decoded
arguments, expected movements, gas ceiling, simulation block and command, expected events, expected
post-state, irreversibility, rollback, explorer URL, and whether anything confidential would become
public. **It is not proposed here.**

---

## 10. Public wording until acceptance criteria pass

> UNICA is building a hook-enforced Robinhood testnet settlement experiment using faucet-issued
> stock-token contracts. The interface may demonstrate deterministic simulations, but live
> end-to-end settlement has not yet been verified.
