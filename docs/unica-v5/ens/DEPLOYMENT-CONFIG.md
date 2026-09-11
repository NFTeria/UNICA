# UNICA v5 / ENS — deployment configuration

Engineering record. Retrieval date for every externally-sourced claim is 2026-09-11 unless stated
otherwise. Labels: **VERIFIED** (source cited), **PROPOSED**, **DOCUMENTED_NOT_OBSERVED**,
**UNKNOWN**. Authority labels: **ENSV2_ONCHAIN**, **UNICA_ONCHAIN**, **BACKEND_POLICY**,
**GRAPH_EVIDENCE**, **CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION**.

Read-only research. Nothing below is discovered at runtime by UNICA code — addresses live in a
reviewed configuration file, and this document is the review. No registration, no write, no
deployment, no signature, no broadcast is performed by this document.

## 1. Scope and sources

This document pins the ENSv2 Sepolia deployment UNICA's checkout and identity-resolution code
targets, states exactly which claim came from where, and records why a hard-coded address list is
the wrong shape for most of this table — a finding made while writing it, not assumed going in.

Sources, each retrieved 2026-09-11 unless noted, cross-referenced against `ACCESS-CONTROL.md` §1
(the same source list, not repeated in full):

- This repository's own live chain reads: `integrations/ensv2/profile.mjs` (chain `11155111`, pin
  block `11666085`, re-read green at block `11666122`), `integrations/ensv2/ENS-OWNER-ACTION.md`
  (block `11663994`), `web/ensv2/resolve.mjs` (retrieved 2026-09-05), `docs/ensv2/DEPLOYMENT-PROFILE.md`.
- OFFICIAL, `docs.ens.domains/learn/deployments`.
- OFFICIAL, `github.com/ensdomains/contracts-v2`, `main` branch: `contracts/README.md` ("Deployed
  Addresses" section, including its own operational note about a temporary repoint — quoted
  verbatim in §4), `contracts/docs/addresses/sepolia.md` (auto-generated address table, timestamped
  inside the file itself), `doc/AUDIT_README.md`.
- OFFICIAL, `github.com/ensdomains/verifiable-factory`, `src/VerifiableFactory.sol`.
- ETHGlobal, `ethglobal.com/events/ethonline2026/prizes` — ENS's own prize wording, §2.
- The TRACK determination ("from scratch," not "Continuity") is the owner's, confirmed 2026-09-11,
  and is the subject of a sibling stream's own document (`docs/unica-v5/ens/PRIZE-FIT.md`, cited not
  edited, currently mid-draft in this same directory). This document does not re-litigate it and
  states only what bears on deployment identity: ENS's own prize page names two ENSv2 tracks, one
  "From Scratch" (net-new, $4,500) and one "Continuity" (integration into an existing project, $500)
  — **VERIFIED**, quoted in full in §2.

## 2. ETHGlobal ENS prize wording — as it bears on deployment identity

**VERIFIED**, `ethglobal.com/events/ethonline2026/prizes`, retrieved 2026-09-11:

- **Best Use of ENSv2** — $4,500 total (1st $1,500, 2nd $1,500, 3rd $1,000, Runner-Up $500), **"From
  Scratch"** track: "Project must be built on ENSv2 (Sepolia)," ENSv2 features central not cosmetic,
  a functional demo with no hard-coded values, open source, a video or live demo link.
- **Best Integration of ENSv2 into an Existing Project** — $500, **Continuity** track only: targets
  ENSv2 on Sepolia from an existing project's testnet integration.

Both tracks require the deployment to be **ENSv2 on Sepolia** — there is no "isolated hackathon
deployment" distinct from the public ENSv2 Sepolia deployment for either track; "isolated" in this
document means UNICA verifies its own configuration independently rather than trusting any single
address source, not that UNICA runs a private fork of ENSv2. Full track resolution and prize-fit
analysis is `docs/unica-v5/ens/PRIZE-FIT.md`'s job (sibling stream, cited not edited); this document
only needed to confirm the deployment target, which both tracks name identically.

## 3. Isolated deployment identity

| | |
|---|---|
| Network | **Ethereum Sepolia**, chain id **`11155111`** |
| ENSv2 mainnet status | **VERIFIED, OFFICIAL** — `docs.ens.domains/learn/deployments` lists no ENSv2 mainnet contracts; only ENS v1 (production) mainnet contracts appear there. **ENSv2 as a whole has no mainnet deployment anywhere as of this retrieval.** This is the strongest available proof that a Sepolia ENSv2 name cannot be confused with a production ENSv2 identity — there is no production ENSv2 to confuse it with. |
| ENS v1 mainnet status | **Real and in production**, unrelated to anything in this document. `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` already records the concrete collision this creates: the label `nfteria` is held in **ENSv1** by an unrelated third party until 2047, and ENSv2 **refuses to register a label already held in ENSv1 on the same chain** — two registries, one namespace, confirmed by this repository's own live read. `unica.eth` on **mainnet** likewise belongs to an unrelated third party this project claims nothing from (`UNICA-ETH-ADDR-REPORT.md`, VERIFIED). **This document must never describe ENSv2 Sepolia beta behaviour as production ENS mainnet behaviour, and does not.** |
| The negative control already built and working | **VERIFIED, ENSV2_ONCHAIN** — `integrations/ensv2/ENS-OWNER-ACTION.md` step 1: `vitalik.eth` on Sepolia returns `NOT_A_PERMISSIONED_RESOLVER` from this repository's own `permissioned-live.mjs` check, because it is still served by the ENSv1-mirror path rather than a per-name Permissioned Resolver. This is exactly the "prove a known name does **not** resolve through the hackathon resolver" preflight the STREAM brief for this document asked for, and it already exists and already runs — it does not need to be built, only re-run before each use (§11). |

## 4. Pinned addresses

**The one address safe to hard-code long-term.** `UpgradableUniversalResolverProxy`,
`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` — a vanity-mined address, confirmed identical across
every source this document checked: this repository's own live reads (block `11663994`/`11666085`),
`docs.ens.domains/learn/deployments`, and `contracts/docs/addresses/sepolia.md`. **VERIFIED, triple
sourced.** This is the fixed entry point `web/ensv2/resolve.mjs` already hard-codes as `ENSV2.entryPoint`
and the only address this document recommends treating the same way.

**Everything downstream is volatile, and this document found direct proof of it while researching.**
Two address sets for the same logical deployment disagree almost everywhere:

| Contract | This repository's live read (2026-09-09/10, block 11663994–11666122) | Official generated table (`contracts/docs/addresses/sepolia.md`, generated 2026-06-29) |
|---|---|---|
| `UpgradableUniversalResolverProxy` (entry point) | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` — **matches** |
| intermediate proxy | `0x6d80f2172cfdec5730fe683860c33d26fc42e6f1` (named "middle proxy" — unofficial) | `0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1` — **matches**, and is officially named **`ManagedUniversalResolverProxy`** (§16 of ACCESS-CONTROL.md carries this finding) |
| `UniversalResolverV2` (implementation) | `0x4a1817d13e9cf196f471725176355c1234b63c70` | `0x85edf8b6b7d4211e2b07aa687506b746357b92cf` — **differs** |
| `RootRegistry` | `0x8115186e8f2e0b0281e86ab91f0f48ba90364354` | `0x11b5bfbe9078d826b1edbdd1cfc12f5828d9f50c` — **differs** |
| `ETHRegistry` | `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` | `0x67b728a792e789a8978b30cf1b3b641f19354b43` — **differs** |
| `ETHRegistrar` | `0xa88553f454b77203b0d036a05c894d555eaaa2cc` | `0xa4449a0dd2b83007553d9b1d28b583a46a805a30` — **differs** |
| `PermissionedResolverImpl` | `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` | `0x7e4b2d59938930168024201752ee5503df402303` — **differs** |
| `VerifiableFactory` | `0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef` | `0x118bc31a50d559f7015a8da26d54b3b030cdb70f` — **differs** |
| `BatchRegistrar` | `0x8b16d15f3e51074d0e06f3cf4a0053f7cb92a7fb` | `0xfe2aab6df1cbff84534ce65d9e4a755ba02d6795` — **differs** |
| `ContractNamer` | `0xa48eb920950d7f4963d1d87f15f195624fbfbd6a` | `0x68658a771044873906fc9b6e9f278ac5a0501342` — **differs** |
| `DefaultReverseRegistrarAdapter` | `0x7a84e241f862d73960d73c26d68c3c8f89f0b18f` | `0x1f7b9461d17d5cf43553253c6b78d252d9575954` — **differs** |
| `ENSV1Resolver` | `0xae66c62acae72098bdac57d8e8aed53ef000b2ba` | `0x5339161a7896ca9841ecc034a49edca40f7b9491` — **differs** |
| `ENSV2Resolver` | `0x508cb4e4596429ca98a1bb3112d88d18f92456b5` | `0x6f988f299926ce361450db390d66dd604dcd8b21` — **differs** |

**Reading this table correctly matters more than the numbers in it.** Both columns are genuine,
sourced observations of the same public deployment at different times — the official table is
timestamped **2026-06-29**, ten weeks before this repository's own reads. The straightforward
explanation is that the ENS team has **redeployed the stack behind the fixed entry point** at least
once since the table was generated, and the generated documentation page was not regenerated to
match. §4's own operational note (below) proves this kind of repointing happens, in the ENS team's
own words, as routine operational practice, not as a one-off accident. **Neither column should be
copied into a UNICA configuration file as-is.** The one this repository already has —
`integrations/ensv2/profile.mjs`'s `DEPLOYMENT` array — is the **live-read column above**, block-pinned
and re-verifiable by anyone (`node script/ensv2/profile-live.mjs`), and is the correct starting point
for a "reviewed configuration file" (§10) precisely because it states its own pin block rather than
implying permanence.

## 5. The proxy chain — three hops, three admins

**VERIFIED, ENSV2_ONCHAIN**, this repository's own reads, corroborated by official documentation for
the general shape (not the specific addresses, which are the volatile ones in §4):

```
0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe   the fixed entry point (UpgradableUniversalResolverProxy)
        │  implementation() and ERC-1967 slot agree
        ▼
0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1   ManagedUniversalResolverProxy — admin() = 0xffFffFFfFF52D316B7Bd028358089bc8066b8f80
        │  implementation()
        ▼
(volatile — §4)                              UniversalResolverV2, the resolution implementation actually reached
```

`0xeEeEEEeE...`'s own `admin()` = `0x69420f05A11f617B4B74fFe2E04B2D300dFA556F`. **Two separate admin
keys can each redirect the whole of ENSv2 resolution**, and neither is UNICA's. This is not a defect
in ENS's design — an upgradeable public-good resolver has to be upgradeable by someone — but a
payment product must state the trust assumption as **three contracts with two independent admins**,
not one immutable address, and this document does so rather than simplifying it away.

**The operational note that proves this is not hypothetical**, quoted verbatim,
**VERIFIED, OFFICIAL** (`contracts/README.md`, "Deployed Addresses" section, retrieved 2026-09-11):

> "Operational note (Sepolia, temporary): the intermediate URP `0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1`
> has been repointed from the current fresh deployment (`deployments/sepolia`) back to the previous
> deployment's `UniversalResolverV2` `0x2f8a180604c42457cb56c7c4f708748ff1f91df1`
> (`deployments/sepolia-official-v1-20260525-r2`), so the public entrypoint
> `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` again resolves v1 names. This is a temporary measure
> at the team's request until the fresh deployment's v1 mirror is wired up; to revert, run
> `phase upgrade-managed-urp --network sepolia --deployment-network sepolia` (the current stack)."

That is a **third**, distinct `UniversalResolverV2` address (`0x2f8a180604c42457cb56c7c4f708748ff1f91df1`),
matching **neither** column in §4's table, named by the ENS team itself as a deliberate, named,
reversible operational state. **This is why §11's preflight is mandatory rather than a nice-to-have,
and why no address below `ManagedUniversalResolverProxy` may ever be treated as a constant.**

## 6. MockUSDC — test-only, no value

| | |
|---|---|
| Address | `0xd3322b29a7bdee707d1684676f149bf41aa3422f` — **DOCUMENTED_NOT_OBSERVED by this repository.** Source: `contracts/docs/addresses/sepolia.md`, OFFICIAL, generated 2026-06-29. No file in `integrations/ensv2/` or `docs/ensv2/` mentions MockUSDC; this repository has never read its bytecode, decimals, or supply live. |
| Status | **Test-only. No real-world value, at every mention, in every surface.** Given §4's confirmed volatility on every other non-entry-point address from the same generation date, this address must be treated as **UNKNOWN-current** until read back live (bytecode + `decimals()` + a `totalSupply()`/`symbol()` sanity check) — never assumed to still be the live MockUSDC merely because it appears in the same generated table. |
| MockDAI | `0xe33a01a41ee4a68616b5278183aa88808326ed8e` — same source, same caveat, same test-only status. Not otherwise used by UNICA's evidence. |

## 7. Explorer and manager

**VERIFIED, OFFICIAL**, `docs.ens.domains/learn/deployments`: "Interact with it via the
[ENS App](https://app.ens.dev) and the [ENS Explorer](https://explorer.ens.dev)." Neither URL was
independently loaded by this document (out of the ~25-fetch budget it was given); both are cited as
the official interaction points and neither is a UNICA-operated surface.

## 8. Current ABIs and selectors

Every selector below is **derived**, not typed, per this repository's own standing rule
(`permissioned.mjs`'s own header: "a wrong selector fails as an EMPTY RETURN rather than as an
error"). Full derivation lives in the cited files; this table is a pointer into them, not a new
computation.

| Signature | Selector | Source |
|---|---|---|
| `resolve(bytes,bytes)` | `0x9061b923` | `web/ensv2/resolve.mjs`, `ENSV2.sel.resolve` |
| `addr(bytes32)` | `0x3b3b57de` | `web/ensv2/resolve.mjs`, `ENSV2.sel.addr` |
| `setAddr(bytes32,address)` | `0xd5fa2b00` | `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §6 |
| `setAddr(bytes32,uint256,bytes)` | `0x8b95dd71` | `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §6 |
| `setText(bytes32,string,string)` | derived in `permissioned.mjs` (`SELECTOR.setText`) | `integrations/ensv2/permissioned.mjs` |
| `authorizeTextRoles(bytes,string,address,bool)` | `0xf2d1eb25` | `integrations/ensv2/profile.mjs`, `FORK_EXECUTED` |
| `authorizeAddrRoles(bytes,uint256,address,bool)` | `0x587eefd1` | `integrations/ensv2/profile.mjs`, `FORK_EXECUTED` |
| `register(string,address,address,address,uint256,uint64)` | `0x85f3e643` | `docs/ensv2/DEPLOYMENT-PROFILE.md` §4, `PUSH4_IN_RUNTIME` |
| `EACUnauthorizedAccountRoles(uint256,uint256,address)` | `0x4b27a133` | `ACCESS-CONTROL.md` §3.3, cross-verified against current official source |
| `EACCannotGrantRoles(uint256,uint256,address)` | `0xd1a3b355` | `ACCESS-CONTROL.md` §3.3 |
| `ResolverNotFound(bytes)` | `0x77209fe8` | `web/ensv2/resolve.mjs`, `docs/ensv2/DEPLOYMENT-PROFILE.md` |

`ACCESS-CONTROL.md` §3.3 and §5 carry the full EAC error-selector and role-bit tables; not
duplicated here beyond the rows above that are specific to a deployment-config decision (which
selector to preflight, §11).

## 9. Initializer signatures

| Contract | Signature | Status |
|---|---|---|
| `PermissionedResolver` | `initialize(address admin, uint256 bitmap, bytes[] setters)` | **VERIFIED, OFFICIAL** — `docs.ens.domains/ensv2/permissioned-resolver` |
| `VerifiableFactory.deployProxy` | `deployProxy(address implementation, uint256 salt, bytes memory data) returns (address proxy)` | **VERIFIED**, full source read, `ensdomains/verifiable-factory/src/VerifiableFactory.sol` — deploys via `create2` and calls `IUUPSProxy(proxy).initialize(implementation, data)` atomically in the same external call (`ACCESS-CONTROL.md` §12) |
| `UserRegistry` (per-user subregistry, if UNICA ever uses one) | not fetched | **UNKNOWN** — `doc/AUDIT_README.md` names `UserRegistry` as UUPS-upgradeable and user-deployed via `VerifiableFactory`, same pattern as the resolver, but its exact initializer signature was not read by this document |
| `ETHRegistrar.register` | `register(string label, address owner, IRegistry subregistry, address resolver, uint256 roleBitmap, uint64 duration, ...)` (exact full argument order/name not independently re-derived from source in this document beyond what §13 of `ACCESS-CONTROL.md` states) | **DOCUMENTED**, `contracts/src/registrar/ETHRegistrar.sol` read for the commit-reveal mechanism (§10 below); full parameter list not transcribed |

## 10. Commit/reveal timing and pricing method

**VERIFIED**, full source read, `contracts/src/registrar/ETHRegistrar.sol`, current `main`:

- `commit(bytes32 commitment)` records a timestamp; `register(...)` calls `_consumeCommitment`,
  which reverts `CommitmentTooNew` before `MIN_COMMITMENT_AGE` has elapsed and `CommitmentTooOld`
  after `MAX_COMMITMENT_AGE`, then deletes the commitment (single-use).
- `makeCommitment` binds `label, owner, secret, subregistry, resolver, duration, referrer` — every
  field that must match between `commit` and the later `register`, which is what stops a third party
  front-running a visible commitment (they lack the `secret`).
- `MIN_COMMITMENT_AGE`, `MAX_COMMITMENT_AGE`, `MIN_REGISTER_DURATION` are `public immutable`, fixed at
  the registrar's own construction. **UNKNOWN, deployment-specific**: this document did not read
  their live values off the pinned `ETHRegistrar` on Sepolia. A **testnet deploy script** in the same
  repository (`contracts/deploy/testnet/00_FastETHRegistrar.ts`) sets `minCommitmentAge = 0`,
  `maxCommitmentAge = 1 day` — **DOCUMENTED (a deploy script default), not confirmed as the value
  governing the specific deployment this repository is pinned to.**
- **Pricing**: `StandardRentPriceOracle`, `Ownable` (not Enhanced Access Control) — its owner can
  update base pricing rates, discount points, payment-token configuration and halving parameters
  (`doc/AUDIT_README.md`, "Non-EAC Privileged Roles"). **VERIFIED, OFFICIAL.** This is a centralized,
  non-EAC trust point on the registration-cost path, distinct from every role discussed in
  `ACCESS-CONTROL.md`, and is recorded here because it belongs to deployment configuration
  (what registering a name will cost, and who can change that) rather than to access control proper.

**PROPOSED, before any UNICA registration**: read `MIN_COMMITMENT_AGE()`, `MAX_COMMITMENT_AGE()`,
`MIN_REGISTER_DURATION()` and `StandardRentPriceOracle`'s current rate live, immediately before
building a `commit`/`register` pair — never from this table, which states only what the mechanism
is, not what it currently costs.

## 11. The reviewed configuration file

**This repository already has one, and it already does most of what this document would otherwise
have to propose from scratch.** `integrations/ensv2/profile.mjs`'s `DEPLOYMENT` array is a committed,
sourced, per-row-labelled address table (`OBSERVED.DECODED`/`REVERT_NAMED_IT`/etc., §1 of this
document's own label scheme applied consistently there already), pinned to an explicit block, with a
`verifyProfile(chain)` function that re-reads every entry's code size and runtime code hash and
reports **rows**, never a single pass/fail boolean — exactly the shape a "reviewed configuration
file, never discovered at runtime" needs to be. `web/ensv2/resolve.mjs`'s `ENSV2` constant is the
equivalent for the fixed entry point and its resolve/error selectors.

**PROPOSED, this document's own recommendation rather than a new file:**

1. Re-run `node script/ensv2/profile-live.mjs` given §4's finding — the generated official table has
   moved since `profile.mjs` was last pinned, which does not by itself mean `profile.mjs` is wrong
   (it is a **later** observation than the official table), but the discovery of §4's volatility is
   reason enough to re-confirm rather than assume the 2026-09-09 pin still holds today.
2. Add `MockUSDC`/`MockDAI` to `profile.mjs`'s `DEPLOYMENT` array with an honest
   `OBSERVED.DOCUMENTED_NOT_OBSERVED` label until they are read back live (§6) — do not add them as
   `DECODED` on the strength of the generated table alone.
3. Record `ManagedUniversalResolverProxy` as the intermediate proxy's official name in `profile.mjs`'s
   own comments (currently described there only by role, "a SECOND proxy," not by its official name)
   — a documentation improvement, not a behavioural change.
4. Add the `EACMaxAssignees`/`EACMinAssignees`/`EACCannotRevokeRoles`/`EACRootResourceNotAllowed`/
   `EACInvalidRoleBitmap`/`EACInvalidAccount` selectors to `permissioned.mjs`'s `ERROR_SIGNATURES`
   table (currently it carries only the two this repository has actually observed on the wire,
   `EACUnauthorizedAccountRoles` and `EACCannotGrantRoles`, plus three unrelated ones) so a future
   revert against any of the six newly-confirmed selectors decodes to a name instead of
   `UNKNOWN_REVERT`.

None of the four items above were carried out by this document — they are read-only research and a
recommendation, not an edit to `integrations/ensv2/` or `web/ensv2/`, which this stream's rules
forbid touching.

## 12. Preflight checks

Per the STREAM brief's own requirement — chain id, bytecode, implementation, ABI selectors, and
resolver behaviour, including a negative control against a name that must **not** resolve through
this deployment — **all five already exist and already run** in this repository, and this document's
job is to say so precisely rather than propose duplicates:

| Check | Where it already lives | Status |
|---|---|---|
| Chain id | `profile.mjs`, `verifyProfile`: "fail closed: nothing below means anything" if `chainId !== CHAIN_ID` | **VERIFIED, built** |
| Bytecode (code size + runtime code hash) | `profile.mjs`, `verifyProfile`, one row per contract in `DEPLOYMENT` | **VERIFIED, built** |
| Implementation (ERC-1967 slot) | `roles.mjs`/`permissioned.mjs`, `readAuthorization`, `ERC1967_IMPLEMENTATION_SLOT` | **VERIFIED, built** |
| ABI selectors | every selector in `permissioned.mjs`/`profile.mjs` is `selectorFor(signature)`, never typed, and the live scripts recompute and compare | **VERIFIED, built** |
| A known production name does **not** resolve through this deployment | `ENS-OWNER-ACTION.md` step 1: `vitalik.eth` on Sepolia returns `NOT_A_PERMISSIONED_RESOLVER` | **VERIFIED, built, and specifically the check the STREAM brief asked for** |

**What is not yet built**: a preflight check against §4's specific finding — that the
`ManagedUniversalResolverProxy`'s downstream implementation can be silently repointed by the ENS
team at will (§5's quoted operational note). `verifyProfile` checks the **pinned** addresses' own
bytecode; it does not currently assert that the **chain the pinned addresses came from IS the chain
those addresses still resolve through today** as a single combined claim — i.e. it would catch a
changed `UniversalResolverV2` bytecode hash at the address `profile.mjs` names, but it would not, on
its own, notice that the **address itself reached via the proxy chain** has changed, because
`DEPLOYMENT`'s entries are addresses, and §4/§5 show the address behind `ManagedUniversalResolverProxy`
is exactly the thing that moves. **PROPOSED**: `verifyProfile` (or a sibling check) should walk the
proxy chain live — read `ManagedUniversalResolverProxy.implementation()` fresh, every run, and
compare it against `profile.mjs`'s pinned `UniversalResolverV2` address **as a named, reportable row**
— rather than only checking that whatever is pinned still has the bytecode it had before. This is a
gap this document found, not one that existed in the brief; it is not built, and no code was changed
to build it.

## 13. Proof the deployment is isolated from production ENS mainnet

Restated plainly, drawing only on what §3 already established:

1. **ENSv2 has no mainnet deployment at all** (VERIFIED, `docs.ens.domains/learn/deployments`) — so
   there is no production ENSv2 identity a Sepolia ENSv2 name could impersonate.
2. **ENS v1 mainnet is real, and this project's names collide with it in exactly the ways already
   measured**: `nfteria` is ENSv1-mainnet-held until 2047; ENSv2 refuses to register it because ENSv1
   already holds it (VERIFIED, `UNICA-ETH-ADDR-REPORT.md`); `unica.eth` on mainnet belongs to an
   unrelated party. **Every UNICA-facing surface must show the chain id (`11155111`) beside any
   resolved name**, and `web/ensv2/resolve.mjs`'s own `EXPLAIN.WRONG_CHAIN` message already exists
   for exactly this reason — VERIFIED, built.
3. **The negative control is already running**: `vitalik.eth` (a real, famous, mainnet-registered
   ENS name) resolves on Sepolia through the **ENSv1-mirror path**, not through a Permissioned
   Resolver, and this repository's own live check reports that distinction by name
   (`NOT_A_PERMISSIONED_RESOLVER`) rather than by a bare boolean. This is the concrete demonstration
   that a well-known mainnet identity does not silently inherit ENSv2 Sepolia's beta behaviour.

## 14. Unknowns

- Whether the address set this repository pinned on 2026-09-09/10 (§4, left column) still matches
  the live chain today — §5's quoted operational note proves this kind of repoint happens; only a
  fresh preflight run (§12) can answer this, and this document did not run one as part of its own
  research (it read documentation and prior chain-read records, not the live chain itself).
- MockUSDC's and MockDAI's live bytecode, decimals, and whether they are still deployed at the
  addresses the generated table names (§6) — never read live by this repository.
- The exact commit-reveal timing constants and current registration price on the specific
  `ETHRegistrar`/`StandardRentPriceOracle` instances this deployment uses (§10) — `immutable`/
  `Ownable`-mutable and deployment-specific; not read live.
- `UserRegistry`'s exact initializer signature (§9) — named as UUPS-upgradeable and
  `VerifiableFactory`-deployed in the audit scope document; its interface was not fetched.
- Whether `verifyProfile`'s bytecode-hash checks would actually catch a live repoint of
  `ManagedUniversalResolverProxy`'s target the way §5's operational note describes, or whether it
  needs the additional live-proxy-chain-walk check proposed in §12 — this document found the gap and
  proposed the check; it did not build or test it.
- Whether the explorer (`explorer.ens.dev`) and manager (`app.ens.dev`) URLs cited in §7 present the
  same address volatility found in §4 when viewed directly — neither was loaded by this document.
