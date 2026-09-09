# HACKATHON.md — what was built when, and by whom

UNICA is an ETHOnline 2026 entry in the Classic (from-scratch) track, built by NFTeria.
This file separates three things a judge needs to tell apart, and states what is not claimed.

**The specification and threat model were written before the event; every line of code was
written during it.**

## 1. Disclosed pre-event material

`specs/HOOK-SPEC.md` and `specs/THREAT-MODEL.md`, both stamped 2026-08-21, published unedited
with their SHA-256 in `specs/README.md`. They are the design; they are not code. The toolchain
configuration (`foundry.toml`, `remappings.txt`, the CI workflow) was drafted as starter-kit
configuration before the window and re-verified file by file against the vendored tree in
the first hours; it contains no project logic. `AI_USAGE.md` lists every pre-existing artifact
by name.

## 2. Upstream open-source code, used as dependencies

Everything under `lib/` arrives as a git submodule under its own licence: `forge-std`,
OpenZeppelin `uniswap-hooks` v1.1.1, `hookmate`, and through them Uniswap `v4-core`
(BUSL-1.1 with its stated change date; not relicensed), `v4-periphery`, `permit2`, `solmate`,
`openzeppelin-contracts`. The dependency set and remapping layout follow the public
`Uniswap/v4-template` (MIT), which was used as a starter kit and not cloned, so this history
contains only this project's commits.

## 3. Project-specific implementation, written during the event

`src/`, `test/`, `script/`, `docs/`, `design/`, and every commit in this repository.
The remote was created empty at 2026-09-04 16:06 UTC; the first commit is later. A judge can
confirm the bright line with:

```sh
git log --reverse --format='%cI %s' | head -3
```

## Prior art, cited and not copied

An earlier settlement-receipt hook by the same author exists on Ethereum Sepolia and is named
in `specs/HOOK-SPEC.md` section 0. It is prior art in the ordinary sense: it informed the
design, and nothing from it, no file, no test, no helper, was brought into this repository.
This one is written from the specification against the pinned interfaces.

## The intended integrator

NFTeria's private `.click` product is the integrator this hook is designed for: a business that
settles customer payments and wants a payer to pay in one asset while the business receives
another, atomically, with a receipt. That relationship is why the hook exists and is stated
here in prose only. The private product never enters this repository: no source,
configuration, credentials, customer data, or private links.

## What is not claimed

- Testnet only. No mainnet deployment of any kind.
- A deployed contract is not a verified one, and a verified one is not a live-fired one.
  The README's proof rows say which rung each address has reached and carry the command
  that re-proves it. Anything not deployed, verified, and live-fired is cut, not claimed.
- No prize, placement, or finalist status at any event is claimed anywhere in this tree.
- AI tooling assisted the build; `AI_USAGE.md` says exactly where. No commit carries an AI
  co-author, because tooling is not authorship.

---

## 5. Sponsor-track submission ledger — 2026-09-08

Recomputed from `make gate` at this commit. **Nothing below is a claim of qualification for any
track.** Each row says what exists, what is missing, and what only the owner can do.

### Uniswap v4 — DEMONSTRATED

| | |
|---|---|
| Artifact | V1 hook + executor **live and verified** on Ethereum Sepolia; V2 hook + executor frozen as `v2.0.0-rc1` |
| Evidence | tag `live-green` = `5e1d8436`, broadcast tree `c15c7cda`, `make proof`; 167 Solidity tests, 44 fork rows, 48 mutations killed |
| Missing | V2 is **not deployed**; EOA merchant signers only |
| Owner gate | a V2 deployment decision |
| Prohibited claim | that V2 is live, audited, or that every merchant wallet can issue a quote |

**Uniswap is UNICA's exclusive DEX integration.** No competing DEX is integrated or recommended.
Direct non-DEX operations — a lending deposit, a debt repayment, a USDC transfer — are performed
directly and are never routed through a pool to manufacture composition.

### Chainlink CRE — PARTIAL, DEPLOYMENT BLOCKED

| | |
|---|---|
| Challenge | Automated Liquidation Protection, `solangegueiros/cf-liquidation-protection-challenge@58b24604` |
| Artifact | a deterministic risk policy and a workflow adapter, both offline: `integrations/chainlink-cre-guardian/` |
| Evidence | 88 policy rows + 9 mutations; 86 adapter rows + 10 mutations; all five published scenarios survive |
| Missing | **no CRE workflow is deployed**; no CLI installed; `join()` not called |
| Blocker | the challenge README and its own `config.staging.json` name **different** lending and token addresses |
| Owner gate | Early Access approval, CLI authentication, a funded TEE wallet, `join()` |
| Prohibited claim | that this is a deployed CRE workflow, TEE-attested, DON-executed, or that liquidation is guaranteed |

The scenario table below is a **LOCAL SIMULATION** against `fixtures/scenarios.json`, not a judged run:

| Scenario | Survives | Actions | vETH used | vUSD used | Loan continuity |
|---|---|---|---|---|---|
| gradual decline | yes | 2 | 142 / 500 | 0 | 10000 bps |
| sudden crash | yes | 2 | 231 / 500 | 0 | 10000 bps |
| temporary wick | yes | 1 | 106 / 500 | 0 | 10000 bps |
| two-stage decline | yes | 2 | 206 / 500 | 0 | 10000 bps |
| safe volatility | yes | 1 | 89 / 500 | 0 | 10000 bps |

The implementation finding behind it: `calcHF` floors and `checkAllHF` liquidates at `hf <= 100`,
so an untouched starting position is liquidatable at any price at or below **1812.82**, and the
$1800 step of "safe volatility" floors to exactly 100. **Every published scenario therefore requires
at least one intervention.** The current configuration selects collateral deposits in these
fixtures, and the selector stays configurable because the organisers have not said how loan
continuity and capital efficiency trade off.

### Circle — PARTIAL

| | |
|---|---|
| Artifact | `integrations/arc-nanopayments/` — a local verifier for a Gateway authorization, and a mandate binding what that authorization does not |
| Evidence | 141 rows, 5 mutations; a vector signed by Circle's own SDK verifies against an independent implementation |
| Missing | the paid tool and the CLI agent loop are **not built** |
| Prohibited claim | that payments are practically free, that every nanopayment is on-chain, that a marketplace works on Arc testnet, or that any wallet or credential was used |

### ENS — PARTIAL

| | |
|---|---|
| Artifact | a resolver with 13 classified failure shapes, the canonical `MerchantConfig` encoder, and a builder with no argument that can carry an address |
| Evidence | 136 rows; the Solidity and JavaScript schemas agree byte for byte |
| Missing | `merchant_policy.vy` is **not yet wired** to the resolver and builder |
| Prohibited claim | a complete end-to-end ENS policy integration, until that join exists |

### The Graph — PARTIAL, OWNER GATE

| | |
|---|---|
| Artifact | a V2 invoice indexer namespace, `integrations/graph-v2/` |
| Evidence | 13 matchstick tests, 17 manifest and ABI checks in the gate |
| Missing | **not deployed to Subgraph Studio** |
| Owner gate | the Studio deployment |
| Prohibited claim | a hosted or queryable subgraph |

### Demonstrated now · Next build · Owner action · Optional

- **Demonstrated now:** V1 live; V2 frozen and fork-tested; the verifier, signing tool, ENS
  modules, Graph indexer, CRE policy and adapter, and the Circle protocol and mandate modules.
- **Next build:** `flash_liquidator.vy` tests; the ENS-to-policy wiring; the Circle agent loop.
- **Owner action:** the CRE address question to the organisers, Early Access, `join()`, Studio
  deployment, and the V2 deployment decision.
- **Optional, post-hackathon:** EIP-1271 merchant signers, the payout-asset policy, additional
  chains. None is claimed.

## 6. Ledger update — 2026-09-09

Section 5 was recomputed on 2026-09-08 and two of its rows are now out of date. They are superseded
here rather than edited above, so the record shows what was true when.

### ENS — was PARTIAL, now LIVE ON CHAIN

`unica.eth` is registered on **ENSv2 Sepolia** to the deployer, and the delegation plan was signed
and broadcast: **12 transactions, blocks 11670554–11670579, every one `status 1`**. The agent holds
`SET_TEXT` at one per-key resource and nothing at the name, the payment name or ROOT_RESOURCE — all
four read back from the resolver. `node integrations/ensv2/agent.mjs` proves the scope from the
chain in six rows, five of them refusals.

**Sepolia only.** ENSv2's registry contracts hold **zero bytes of code on mainnet**, so this
namespace exists on the testnet and nowhere else. No ownership of, affiliation with, or connection
to any mainnet name is claimed — mainnet `unica.eth` is held by an unrelated third party.

### The Graph — was PARTIAL/OWNER GATE, now INDEXED END TO END

The **V1** subgraph is deployed to Subgraph Studio and synced with `hasIndexingErrors: false`. It
indexes the live V1 hook from the block that hook first held code, and returns one `Settlement`
whose three amounts match the values decoded from the raw log. The query was validated by making it
fail — a filter for an amount that does not exist returns `[]`, so its non-empty answer means
something.

`integrations/graph-v2/` remains **not deployed** and is a different thing: it subscribes to V2's
`QuoteSettled`, and V2 is deployed nowhere.

### What did not change

Uniswap, Chainlink and Circle read exactly as section 5 left them. The Chainlink workflow still runs
only in the simulator and still stamps `CRE_CONFIDENTIAL_SIMULATION` on its own output.
