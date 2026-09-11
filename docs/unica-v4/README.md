# docs/unica-v4/ — index

Draft for owner review, not committed, authorizing nothing (`DECISIONS.md` Q131: publishing this
specification set or anything built from it has **NO AUTHORIZATION**). This file indexes every
document in this directory so a reader — the owner, a judge, a later author — knows what exists here
and in what order to read it, without re-deriving it from file listings. "UNICA v4" is the UNICA
release specified below; "Uniswap v4" is the AMM it builds on.

## Summary

UNICA v4 is the modular tokenized-asset market release: a reusable `UnicaMarketRegistry` and
`UnicaMarketFactory` deploy one hook and one executor per market, each identified by
`marketId = keccak256(abi.encode(block.chainid, address(registry), asset, payout, version, policy.adapter,
policy.feedId))` — adapter and feedId zero for a demonstration market — so a new asset pair is
configuration rather than a new contract, and the market's oracle route is cryptographically bound
into its own identity (`DECISIONS.md` "Specification choices" S8: on-chain route binding, never
readback alone). Orders are payer-bound, allowlist-created, and
settle through a Uniswap v4 pool whose hook enforces a per-market `IUnicaPriceOracle` policy that fails
closed — no oracle, no stale price, no over-deviated price, no settlement. All of this is specified,
not built: no UNICA v4 contract exists or is deployed anywhere. The planned first deployment, not yet
authorized (the ledger's "What the missing answers mean"), is a `46630` (Robinhood Chain testnet)
rehearsal of the TSLA/uTUSD market with the oracle off and the market flagged demonstration-only
on-chain; NFLX is to be proven configuration-only in local and fork tests, and is not to be deployed.
No mainnet deployment is authorized (`DECISIONS.md` Q132), and this directory's own publication is not
authorized (Q131). Faucet stock tokens and uTUSD carry no real-world value; Chainlink is "planned" until
a deployed contract reads an authenticated price, or exactly "Chainlink integration demonstrated on a
fork" once fork rows OF1–OF8 (`TEST-MATRIX.md` §9, the only row-id scheme for oracle fork rows) pass
with zero skips and are recorded in `evidence/ORACLE-FORK-42161.md`, a file that does not exist yet.

**Sponsor order (permanent, `DECISIONS.md` standing ruling).** 1. Uniswap v4 — 2. ENSv2 on Sepolia —
3. The Graph. Chainlink and Privy are additional planned integrations. Replacing any of the permanent
three is a separate decision, never inferred from a completed integration.

## Reading order

1. `DECISIONS.md` — the ledger. Binding over everything else in this directory.
2. `SPEC-CONTRACTS.md` — the contract specification: architecture, roles, lifecycle, the four core
   contracts, receipts, and blockers.
3. `SPEC-ORACLE-AND-CHAINS.md` — the oracle interface, adapters, per-chain configuration, and their
   own blockers.
4. `UPGRADEABILITY-AND-HOOKS-REVIEW.md` — what may and may not change; its §8 is the field-by-field
   configurability boundary the ledger cites.
5. `EVENT-SCHEMA.md` — every event, who emits it, and who consumes it.
6. `TEST-MATRIX.md` — the named rows that prove UNICA v4; none has run yet.
7. `THREAT-MODEL.md` — threats, their defences, and the rows that prove them.
8. `DEPLOYMENT-GATES.md` — the 46630 rehearsal stages and the mainnet gates.
9. `IMPLEMENTATION-PLAN.md` — task order, time, and every stop for the owner.
10. `evidence/` — what the specifications cite instead of asserting.
11. `V5-DEFERRED.md` — what was considered for v4 and pushed out, and why.

## Files in this directory

| File | What it is |
| --- | --- |
| `DECISIONS.md` | The decision ledger. Every owner ruling, accepted recommendation, evidence-settled fact, and OPEN item that the rest of this directory is written from. Where any other file here disagrees with it, the ledger wins. |
| `SPEC-CONTRACTS.md` | The contract specification: scope and non-scope, blockers, architecture and market identity, roles, lifecycle, `UnicaMarketRegistry`, `UnicaMarketFactory`, `UnicaMarketHook`, `UnicaMarketExecutor`, the oracle interface surface, the receipt and fee fields, contract sizing, dashboard read views, and the critique findings it closes. |
| `SPEC-ORACLE-AND-CHAINS.md` | The oracle layer and chain configuration: `IUnicaPriceOracle`, `OraclePolicy` and the tighten-only rule, the hook's `afterSwap` enforcement order and deviation formula, the error catalogue, `ChainlinkFeedAdapter` / `ChainlinkStreamsAdapter` (disabled) / `ChainlinkCREAdapter` (simulation-only) / `MockOracleAdapter` (tests only), `config/chains/<chainId>.json` and the chain helper, Privy's conditional status, the static-prototype boundary, and the tests that prove the layer. |
| `UPGRADEABILITY-AND-HOOKS-REVIEW.md` | The upgradeability and hooks review: the U1–U9 rulings, the hook sandwich per generation, execution order, the receipt and fee taxonomy, oracle placement, external proxy and beacon monitoring, and hook-permission checks, each labelled (for UNICA v4: designed, not implemented). Its §8, the bounded configuration matrix, is the ledger's reference for what "not upgradeable" still lets change. |
| `EVENT-SCHEMA.md` | Every UNICA v4 event (registry, hook, executor), the external events consumers read, which surface consumes which, the indexed-history plan (The Graph where supported, Q90), and the SC/SOC conflicts C-1 to C-5 that block freezing the schema (Q127). |
| `TEST-MATRIX.md` | The named test rows, mutants and gate rows that prove UNICA v4, with their blockers (B1–B15), the fork declared sets, the live-stage rule (declared rows, zero skipped), and the never-drop list. Nothing in it has run. |
| `THREAT-MODEL.md` | Assets, actors, trust boundaries, and each threat with its mitigation and the row that proves it; where each design-review finding lands; residual risks; the SC/SOC conflicts K1–K10. |
| `DEPLOYMENT-GATES.md` | The committed tools, modes and gate before every broadcast; the 46630 rehearsal stages A–D, H and I with plan blocks and readbacks; the manifest; and the mainnet gates M1–M17, aborts, and the Q10/Q120 fallback. |
| `IMPLEMENTATION-PLAN.md` | The task graph, timeline to the deadline, STOP points, commit sequence, liveness rules and cut order for building UNICA v4, with the specification reconciliation (SR1) and the owner ruling sheet G0 needs. |
| `V5-DEFERRED.md` | Everything considered for UNICA v4 and pushed to the future UNICA v5 dashboard release, each with the ledger or specification line that pushed it and what has to be true before it is reconsidered. |
| `README.md` | This file. |

### `evidence/` — what the specifications cite

| File | What it is |
| --- | --- |
| `evidence/CHAINLINK-AVAILABILITY.md` | What Chainlink product actually exists for TSLA/NFLX on Robinhood Chain testnet (`46630`) and mainnet (`4663`): Data Feeds (none on testnet; one TSLA-only feed on mainnet), Data Streams (verifier live, reports paid-only and unconfirmed), CRE (delivery plumbing exists, no price product), and CCIP (router live, proves no feed). Cited in `SPEC-ORACLE-AND-CHAINS.md` as "CA §n". |
| `evidence/MAINNET-CAPABILITY-PROBE.md` | A read-only, keyless-RPC probe of six required capabilities (Uniswap v4, Chainlink ETH/USD and USDC/USD, Circle USDC, Privy, Safe, explorer verification) across five mainnet candidates. Arbitrum One, Base, and Ethereum pass all six; Robinhood Chain `4663` and Unichain `130` each fail one. Recommends Arbitrum One for the still-**OPEN** Q9. Cited as "MCP". |
| `evidence/DESIGN-REVIEW.md` | The design record: three independent design angles (security-first, deadline-first, dashboard/data-first) reconciled into one design, the decision log for every reconciliation choice, and the adversarial critique that follows — findings A1–A16 (Uniswap v4 hook security), B1–B10 (deployment, size, determinism), C1–C20 (test completeness and honesty). `SPEC-CONTRACTS.md` §14 maps each finding to where it lands. Cited as "DR". |

### `arc/` — Circle Arc integration research (read-only, not part of the v4 contract specification)

Read-only research, simulation and planning for a possible future Circle Arc integration. Nothing in
these files was broadcast, signed, deployed, or published, and none of them changes anything in
`SPEC-CONTRACTS.md` or `SPEC-ORACLE-AND-CHAINS.md` — Arc is not a v4 chain, and `config/chains/`
carries no Arc entry.

| File | What it is |
| --- | --- |
| `arc/NETWORK.md` | Arc network identity, status, and chain parameters. |
| `arc/TOKENS.md` | USDC and EURC contracts on Arc, the native-gas-vs-ERC-20 relationship, and CCTP. |
| `arc/LIQUIDITY-ORACLES.md` | Liquidity and pricing for USDC/USDC, EURC/USDC, and a confirmed BTC asset on Arc. |
| `arc/X402.md` | x402 on Arc: official facts and what they would mean for UNICA if integrated. |
| `arc/NANOPAYMENTS.md` | Micropayment economics on Arc testnet against three settlement models. |
| `arc/PRODUCT-FLOWS.md` | Product flows in plain language, and what a dashboard could show. |
| `arc/COMPATIBILITY.md` | UNICA contract compatibility with Arc. |
| `arc/THREAT-MODEL.md` | Threat model for a possible Arc workstream. |
| `arc/DEPLOYMENT-GATES.md` | What must be true before each Arc phase opens; deploys nothing. |
| `arc/TEST-PLAN.md` | The Arc test plan by tier (standard EVM, Arc's own emulator, an Arc testnet fork); its new rows are proposed, not run. |
| `arc/OPEN-QUESTIONS.md` | The Arc workstream's open questions and owner decisions, sorted from the files above. |
| `arc/README.md` | The Arc workstream's merged report over the files above. |

## Current blockers

Every item below is **OPEN**, **NOT READY**, **NOT SELECTED**, **NOT PROVIDED**, **UNKNOWN**, **NO
AUTHORIZATION**, or awaiting an owner ruling, in `DECISIONS.md` or in a document here, and touches
something in this directory. Unless its row says otherwise, none blocks writing, testing, or
fork-rehearsing; each blocks starting, deploying, activating, claiming, or publishing something specific.
This table resolves none of them. It consolidates the ledger's OPEN list with the blocker tables of
every document in this directory, so a reader does not have to cross them all to see the full set.

| Item | State | What it blocks |
| --- | --- | --- |
| Owner go ("What the missing answers mean", item 1: "Fable does not start yet") | Not given | Every task beyond read-only preparation (`IMPLEMENTATION-PLAN.md` G0) and every LIVE stage (`DEPLOYMENT-GATES.md` §1) |
| Implementation | `src/unica-v4/`, `script/unica-v4/`, `test/unica-v4/`, `config/chains/` do not exist | Every stage; every claim that something is built or tested |
| Q9 (chain choice), with Q11 | **OPEN**; the probe recommends Arbitrum One, not confirmed. Q11: Robinhood Chain mainnet `4663` is preferred, not mandatory; it fails the probe (evidence), and weighing that is the owner's | Enabling `config/chains/42161.json`; every mainnet constructor argument (PoolManager, adapter feed routes, sequencer feed) |
| Q16, Q20, Q23 (equity issuer, legal review, data licence) | No issuer; **NO CONFIRMED REVIEW**; no licensed data | Any equity oracle policy on mainnet; any claim about securities; any real tokenized-equity scope |
| Q17 (transfer restrictions) | Unknown until an issuer is selected | Any mainnet public beta of a tokenized asset; any claim that an asset is available to hold or pay with |
| Q18 / Q19 (jurisdictions; US persons) | Not determined; require counsel (Q82) | Any mainnet public beta; any claim about where or to whom UNICA is available |
| Q25 (heartbeat vs. crypto cap) | Ledger "semantic limit"; no remedy ruled | A mainnet crypto market on the Arbitrum ETH/USD route at useful availability, given its 1755 s heartbeat against the 5-minute crypto cap |
| Q64 (Safe as ADMIN) | **NOT READY** | Any mainnet market leaving SEEDED; any mainnet value movement, until the Safe's chain, address, signers, threshold, and hardware-wallet control are verified and a test transaction has executed |
| Q70 (mainnet PAUSER) | **NOT READY** | Assigning a mainnet PAUSER (the rule itself — pause only, ADMIN alone unpauses — is specified, not yet built) |
| Q71 (mainnet launch gate) | **NOT READY** | Any mainnet launch, under the accepted gates |
| Q91 (RPC provider) | **NOT SELECTED** (primary and fallback) | A mainnet `rpcEnv` naming a variable with no chosen provider behind it; any mainnet readback; the Arbitrum and 4663 fork rows, and so the fork wording, which need an owner-provided endpoint serving the pinned block |
| Q95 (Chainlink/Privy/RPC/hosting accounts and payment) | **NOT PROVIDED** | Any paid Chainlink access (so `ChainlinkStreamsAdapter` has no report to verify); Privy; RPC, including the fork rows' endpoint; hosting |
| Q96–Q98 (Privy account, app id, server secret) | **UNKNOWN / NOT PROVIDED** | Privy in any surface (only whether the secret is configured is ever recorded, never the secret itself) |
| Q99 (`nfteria.github.io` production configuration) | **NOT CONFIRMED** | Any production Pages configuration for the site (Q131 blocks publishing it regardless) |
| Q108 (merchant terms) | **NOT READY** | A public merchant beta; the order-creator allowlist stays founder-controlled or invited-only |
| Q110 (NFLX rate) | **NOT SELECTED** | Deploying an NFLX market; NFLX stays configuration-only in local and fork tests |
| Q110 (rehearsal merchant control) | **UNKNOWN / NOT PROVIDED** | Describing the rehearsal merchant `0x19E56831a10d43CfF5d77f886c799C6b916da7Ae` (source: `DECISIONS.md` Q110) as owner-controlled |
| Q119 (final video) | **UNKNOWN / NOT PROVIDED** | The submission's video component |
| Q131 (publication) | **NO AUTHORIZATION** | Pushing this specification set, triggering a Pages rebuild, or publishing anything built from it — two separate future approvals are named: push the reviewed changes, then trigger the rebuild after the generated site is checked. Stage H (source verification) publishes source too: its go and the first approval are requested at CP4 (`IMPLEMENTATION-PLAN.md` §2), and without them stage H does not run |
| Q132 (no-value mainnet infrastructure) | **OPEN, unanswered** | Any mainnet deployment of the registry, factory, or any adapter — including deployments that move no value — while the Safe and the reviewer are not ready |
| Chainlink on `46630` | No Data Feeds for TSLA/NFLX; Streams report verification **UNCONFIRMED**; CRE hosted writes **UNCONFIRMED** and deploy access not enabled | Any oracle-enabled market on `46630`; enabling `ChainlinkStreamsAdapter` or deploying `ChainlinkCREAdapter` there |
| Sequencer-uptime feed on `46630` and `4663` | Absent on both | The sequencer check on either chain; with Q71, `4663` fails the launch requirements today (evidence), while Q9 and Q11 remain the owner's |
| Sequencer grace period | Owner value **OPEN**; 3600 s proposed (`SPEC-ORACLE-AND-CHAINS.md` §16 item 4) | The adapter's grace period; fork row OF7 runs with it labelled proposed |
| Robinhood token feed unit | Raw-balance-to-feed-unit relation unproven | Any route pricing a Robinhood token from its own feed |
| 46630 Uniswap v4 addresses | `null`, source PENDING in `config/chains/46630.json` (`SPEC-ORACLE-AND-CHAINS.md` §12.1, §16 item 1; `TEST-MATRIX.md` B10) | The chain helper refuses every 46630 stage until a reviewed commit records them in evidence with a source |
| TSLA beacon fingerprint | Recorded only outside this repository (DR A7) | Stage B's asset pre-flight (`DEPLOYMENT-GATES.md` §5.2); fork row V14 |
| Fork pins; Arbitrum One feed descriptions; NFLX look-alike addresses | Not recorded (`TEST-MATRIX.md` B11, B12, B13) | Every fork row (none runs against `latest`); OF1–OF8 and so the fork wording; row V3 |
| Frozen-gate baseline (`TEST-MATRIX.md` B15) | The owner has not confirmed the pinned post-tag diff: the literal "diff against the tag is empty" fails on this branch, and the tag is never moved | The frozen-generation gate (TM G1), so checkpoint CP1 and every LIVE stage |
| Fork row V1 (NFLX) | Decoupled from the TSLA rehearsal (`DECISIONS.md` "Specification choices"): V1 backs only the separate claim "configuration-only onboarding proven on a fork" (`TEST-MATRIX.md` §12) and is never dropped whenever that claim is made; its rate is a `test/unica-v4/` fixture labelled "test fixture — not an approved demonstration rate," never a `script/unica-v4/` value | Only the fork-onboarding claim; no 46630 TSLA LIVE stage waits on it. Until V1 runs, the onboarding claim reads "proven in local tests (N1, N2)" only |
| SC/SOC conflicts | RECONCILED for SR1 rows 1–14 and 18 (`DECISIONS.md` "Specification choices" S1–S8; `IMPLEMENTATION-PLAN.md` §3 records each resolution). **OPEN** only for SR1 rows 15 (chain-file `source` prefixes), 16 (receipt documentation home) and 17 (the `HOOK_CREATION_CODE_HASH` determinism pin) | The three open rows block only their own dependents (a new evidence-file prefix; where the receipt schema lives; the frozen-diff key in `foundry.toml`); G0 (owner go), not the reconciled rows, is what still blocks writing any contract |
| Q127 (event schema freeze) | The reconciled SR1 rows above resolve `EVENT-SCHEMA.md`'s C-1 to C-5; the freeze still waits on `EVENT-SCHEMA.md` §12's remaining choices | Live contract data in any surface; surfaces use frozen fixtures only |
| The Graph on `46630` | **UNKNOWN** (`EVENT-SCHEMA.md` §1) | A 46630 subgraph; 46630 history uses a bounded event indexer or a clearly limited beta history view (Q90) |
| Rec 46 and Q90 for UNICA v4 | No task builds an ENS attachment point or the 46630 history path; owner to confirm the deferral or schedule them (`IMPLEMENTATION-PLAN.md` §9 item 14) | Any UNICA v4 claim for sponsor slots 2 and 3 (ENSv2 on Sepolia, The Graph) beyond earlier-generation work labelled "not UNICA v4" |
| Rec 121 ("the three-scope cut line") | Accepted by number; its content is recorded in no document here; owner to state it | Mapping `IMPLEMENTATION-PLAN.md` §8 and `TEST-MATRIX.md` §13 onto the three scopes |
| 46630 transaction-size limit | Proven only to 16,870 bytes; stage A is about 37–41 KB (ESTIMATE); no fallback designed; owner: a no-value size probe or the fallback, or neither | Stage A: a refusal applies the plan's cut 10 (`IMPLEMENTATION-PLAN.md` §8) unless the fallback was built first (`DEPLOYMENT-GATES.md` §4) |
| forge version | The owner's version unrecorded; the verification profile was measured under 1.3.5, CI pins v1.5.1 | The source tag, `HOOK_CREATION_CODE_HASH` and the stage H match (`DEPLOYMENT-GATES.md` §8) |
| Mainnet gates M11, M12 | Not started; open (`DEPLOYMENT-GATES.md` §10.1) | Any mainnet oracle-enabled market; any mainnet asset and seed |
| Owner ruling sheet | About 45 rulings across the set; whether one line may accept every recommended default is the owner's (`IMPLEMENTATION-PLAN.md` §3, §9 item 16) | Reaching G0 |

## What the missing answers mean (the ledger's roll-up, owner, 2026-09-11)

1. Fable does not start yet. 2. No public merchant beta is authorized. 3. No website publication is
authorized. 4. No real-value mainnet settlement is authorized. 5. Privy stays conditional or deferred.
6. NFLX is excluded from the immediate rehearsal. The specification is held for owner confirmation, and
nothing is committed, deployed, signed, funded, pushed or published.

## Ledger items these documents do not govern

Tracked in `DECISIONS.md` only; no document here specifies them, and none is a UNICA v4 contract concern:
rec 53 (Privy-supported recovery; UNICA never requests or handles seed phrases), which binds any Privy
surface `SPEC-ORACLE-AND-CHAINS.md` §13 describes although that section does not restate it; rec 78
(publish the site after the repository and explorer links are ready) and Q126 (the public-site outline
at `nfteria.github.io/UNICA/`), both behind Q131; the standing NFTeria.github.io ruling with Q79, Q129
and Q130 (site content); and Q80 (keep the current LICENSE pending a separate licensing decision).

## What this directory has not done

It has not built or deployed any UNICA v4 contract, on any chain; nothing here has been run as a test.
It has not deployed anything to mainnet (Q132 unanswered). It has not published itself, the prototype,
or the evidence page (Q131: **NO AUTHORIZATION**). It has not committed anything — every file here is a
draft for owner review. `V5-DEFERRED.md` names what UNICA v5 will eventually need to answer; it does
not answer any of the blockers above, which belong to UNICA v4 alone.
