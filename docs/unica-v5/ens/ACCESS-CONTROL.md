# UNICA v5 / ENS — Enhanced Access Control

Engineering record. Retrieval date for every externally-sourced claim is 2026-09-11 unless stated
otherwise. Labels on every material statement: **VERIFIED** (source cited), **PROPOSED** (UNICA
design choice, not yet built), **DOCUMENTED_NOT_OBSERVED** (read from a document, never confirmed
against the deployed bytecode this repository targets), **UNKNOWN**. Authority label on every
described action: **ENSV2_ONCHAIN**, **UNICA_ONCHAIN**, **BACKEND_POLICY**, **GRAPH_EVIDENCE**,
**CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION** — never blended in one claim.

Read-only research. No name is registered, no role is granted, no resolver is deployed, no
transaction is signed or broadcast by this document or anything it describes as already done.

## 1. Scope and sources

This document covers Enhanced Access Control (EAC) as it governs a UNICA merchant's ENSv2 identity:
who may change a name's resolver/subregistry/expiry at the **registry**, who may change a name's
records at its **resolver**, how a merchant delegates narrow authority to staff, terminals and an
autonomous agent, and where that model is provably weaker than it looks.

Primary sources, each retrieved 2026-09-11 unless noted:

- **OFFICIAL, current ENS documentation**: `docs.ens.domains/ensv2/enhanced-access-control`,
  `/ensv2/permissioned-resolver`, `/ensv2/permissioned-registry`, `/ensv2/universal-resolver-v2`,
  `/ensip/10` (Wildcard Resolution, status **Final**).
- **OFFICIAL, the ENSv2 hackathon branch contracts and ABIs** — `github.com/ensdomains/contracts-v2`,
  `main` branch, read at commit reachable 2026-09-11 (no tag was pinned by the fetch; the repository
  has no `LICENSE` file at its root, confirmed by directory listing — matching this repository's
  existing "no ENS implementation source is copied" posture, since there is no licence to copy
  under):
  - `contracts/src/access-control/EnhancedAccessControl.sol` — full source read.
  - `contracts/src/access-control/interfaces/IEnhancedAccessControl.sol` — full source read.
  - `contracts/src/access-control/libraries/EACBaseRolesLib.sol` — full source read.
  - `contracts/src/resolver/PermissionedResolver.sol` — read (function bodies summarised by the
    fetch tool, not transcribed verbatim into this repository).
  - `contracts/README.md` — full source read (Access Control section, Static Deployment
    Permissions table, Deployed Addresses section).
  - `doc/AUDIT_README.md` — full source read (audit scope, key invariants, trust assumptions).
  - `contracts/docs/addresses/sepolia.md` — full source read (generated address table).
  - `contracts/src/registrar/ETHRegistrar.sol`, `AbstractETHRegistrar.sol` — partial (commit-reveal
    mechanism).
- **OFFICIAL, the VerifiableFactory hackathon dependency** — `github.com/ensdomains/verifiable-factory`,
  `src/VerifiableFactory.sol` — full source read.
- **This repository's own evidence**, read first and not contradicted:
  `integrations/ensv2/permissioned.mjs`, `integrations/ensv2/roles.mjs`,
  `integrations/ensv2/profile.mjs`, `integrations/ensv2/README.md`,
  `integrations/ensv2/ENS-OWNER-ACTION.md`, `docs/ensv2/DEPLOYMENT-PROFILE.md`,
  `docs/ensv2/UNICA-ETH-ADDR-REPORT.md`, `web/ensv2/resolve.mjs`.
- **ETHGlobal**, `ethglobal.com/events/ethonline2026/prizes` — ENS's own two tracks, quoted in §1 of
  `DEPLOYMENT-CONFIG.md`; not repeated here except where it bears on access control directly.

No file under `integrations/ensv2/` or `web/ensv2/` was modified to produce this document.

## 2. What already exists in this repository — read first, not contradicted

Per the brief's own "what exists today," carried forward as fixed:

- `integrations/ensv2/permissioned.mjs` and `roles.mjs` are this repository's ENSv2 authorization
  layer: derived selectors, role constants, resource derivation, a delegation planner
  (`planAgentGrant`/`planAgentRevoke`), a grant screen (`screenAgentGrant`,
  `screenPlanForAgentAuthority`) and a `DENIAL_MATRIX` stating what an agent is structurally,
  screen-enforced, or chain-enforced unable to do.
- Pinned from the chain (ENSv2 Sepolia, chain `11155111`, block `11663994`):
  `UpgradableUniversalResolverProxy` at address `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`,
  `PermissionedResolverImpl` at address `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e`, each confirmed
  through the name's own resolver proxy ERC-1967 implementation slot. **ENSV2_ONCHAIN, VERIFIED**
  (this repository, `integrations/ensv2/ENS-OWNER-ACTION.md`, `profile.mjs`).
- `permissioned.mjs` documents `setText(bytes32,string,string)` as a Permissioned Resolver write
  selector and `ROLE.SET_TEXT = 1<<4` among Enhanced Access Control role bitmap constants, roles
  spaced 4 bits apart, checked as PUSH4 dispatch constants in the deployed runtime.
- The provenance limit already recorded here: every live refusal this repository has itself observed
  against the deployed Permissioned Resolver named the **name-level resource**
  `keccak256(node, bytes32(0))`, not a finer per-text-key or per-coin-type resource. This document
  does **not** upgrade that specific claim to "observed against this deployment's live Sepolia state"
  — see §3.3 and §16 for exactly what does and does not change it.
- No live call in this repository has successfully exercised `setText` or
  `grantRoles`/`authorizeTextRoles` **against the live Sepolia chain**. §3.3 and §16 explain a
  distinct, narrower body of evidence — `integrations/ensv2/profile.mjs` and `roles.mjs` — that
  exercised `authorizeTextRoles` and related calls **on a local fork**, not on live Sepolia, and
  is labelled `FORK_EXECUTED` in that file's own vocabulary. A fork execution is not a live broadcast
  and this document keeps that distinction explicit throughout.

## 3. Enhanced Access Control — the mechanism, as verified against the deployed bytecode

### 3.1 ROOT_RESOURCE and the bitmap layout

**VERIFIED** — `EnhancedAccessControl.sol`, current `main`, OFFICIAL:

- `ROOT_RESOURCE = 0`, a `uint256 public constant`. A role granted at `ROOT_RESOURCE` is folded into
  every other resource's permission check (see §3.2) — it is a contract-wide grant, not a resource.
- Storage: `mapping(resource => mapping(account => uint256 roleBitmap)) _roles`, plus
  `mapping(resource => uint256 roleCount) _roleCount`, a **packed nybble counter**: each of the
  (up to) 64 role slots gets 4 bits of count, capping every role at **15 assignees per resource**
  (`ALL_ROLES = 0x1111…1111`, `ADMIN_ROLES` selects only the upper-128-bit half). This exactly
  matches what this repository's own `profile.mjs` derived from `getAssigneeCount`'s two return
  words on live Sepolia (**ENSV2_ONCHAIN, VERIFIED**, cross-confirmed against **OFFICIAL** source).
- Bitmap: 256 bits, low 128 = regular roles, high 128 = their admin counterparts, one nybble each —
  `adminRole(role) = role << 128`. Matches this repository's own `ADMIN_SHIFT = 128n` exactly.

### 3.2 `roles()` vs `hasRoles()` — read exactly once, from source

**VERIFIED** — `EnhancedAccessControl.sol`:

```
hasRoles(resource, roleBitmap, account) = _effectiveRoles(resource, account) & roleBitmap == roleBitmap
_effectiveRoles(resource, account)      = roles(ROOT_RESOURCE, account) | roles(resource, account)
```

`roles(resource, account)` returns **only** what is stored at that exact resource; it does **not**
fold in `ROOT_RESOURCE`. This is the precise mechanism behind this repository's own
`AUTHORITY_READ_RULE` (`profile.mjs`), which found `roles(nameResource, owner) = 0` while
`hasRoles(nameResource, SET_ADDR, owner) = true` on a live third-party name. The two now agree for
the same reason, from two different directions: the chain observation, and the source that produces
it. **The authoritative read for "can this account write here" is `hasRoles`, or `roles` at both the
target resource and `ROOT_RESOURCE` — never `roles` at the target resource alone.**

### 3.3 `grantRoles`/`revokeRoles` — the general primitive, and its two overrides

**VERIFIED**, `EnhancedAccessControl.sol` (base contract):

- `grantRoles(resource, roleBitmap, account)` reverts `EACRootResourceNotAllowed()` **only** when
  `resource == ROOT_RESOURCE` — use `grantRootRoles` for that. Otherwise it requires the caller to
  hold, via `_checkCanGrantRoles`, every role in `roleBitmap` among its **settable roles**:
  `_getSettableRoles(resource, account) = EACBaseRolesLib.withAdminRolesApplied(_effectiveRoles(resource, account))`.
  `withAdminRolesApplied` takes only the **admin half** of the caller's effective bitmap and mirrors
  it into both halves — so holding `adminRole(SET_TEXT)` **at `ROOT_RESOURCE`** (which folds into
  `_effectiveRoles` at *every* resource) is, in the base contract, sufficient to grant **both**
  `SET_TEXT` and `adminRole(SET_TEXT)` at any non-root resource, including to a third party.
  `_getRevokableRoles` is the identical computation — **the base contract has no way to express
  "may revoke but never grant."** This is a genuine limitation, not an oversight in this document;
  see §11 and THREAT-MODEL.md §3.9.
- **`PermissionedResolver.sol` disables `grantRoles`/`revokeRoles` outright.** Both are overridden to
  always revert — `EACCannotGrantRoles`/`EACCannotRevokeRoles` — with the source comment "Function is
  disabled. Use `authorize(Name|Text|Addr)Roles()` instead." **VERIFIED**, current `main`,
  `contracts/src/resolver/PermissionedResolver.sol`. This is not an access-control gap the caller
  fell into; it is a deliberate design choice in the resolver's own source, and it fully explains a
  fact this repository already carried without a source for it: `integrations/ensv2/profile.mjs`'s
  `DELEGATION_MECHANISM` recorded `grantRoles(nameResource, SET_TEXT, agent)` **refused** even from
  the name owner holding full root authority on their own resolver instance
  (`EACCannotGrantRoles`, selector `0xd1a3b355` — the **same** selector
  `IEnhancedAccessControl.sol` derives for `EACCannotGrantRoles(uint256,uint256,address)`). That
  observation was `FORK_EXECUTED` (§16); it is now also explained by the resolver's own current
  source, independent of the fork. **`PermissionedRegistry.sol` does not disable `grantRoles`** in
  the same way — see §3.4 for its narrower, different restriction.
- Exact error selectors, **VERIFIED** from `IEnhancedAccessControl.sol` and cross-checked against
  this repository's own live-observed selectors (they match exactly, which is itself a useful
  corroboration that the deployed bytecode implements this exact interface):

  | Error | Selector | Where this repository has actually seen it |
  |---|---|---|
  | `EACUnauthorizedAccountRoles(uint256,uint256,address)` | `0x4b27a133` | live Sepolia refusals (**ENSV2_ONCHAIN**) |
  | `EACCannotGrantRoles(uint256,uint256,address)` | `0xd1a3b355` | live Sepolia (registry) + fork (resolver) |
  | `EACCannotRevokeRoles(uint256,uint256,address)` | `0xa604e318` | not yet observed by this repository, either live or forked |
  | `EACRootResourceNotAllowed()` | `0xc2842458` | not yet observed |
  | `EACMaxAssignees(uint256,uint256)` | `0xf9165348` | not yet observed |
  | `EACMinAssignees(uint256,uint256)` | `0x1f80c19b` | not yet observed |
  | `EACInvalidRoleBitmap(uint256)` | `0x2a7b2d20` | not yet observed |
  | `EACInvalidAccount()` | `0xec3fc592` | not yet observed |

  `EACMaxAssignees`/`EACMinAssignees` close a question this repository previously left open —
  `profile.mjs`'s `UNRESOLVED[1]` asked what error is raised past the 15-assignee cap; the base
  contract raises `EACMaxAssignees(resource, roleBitmap)` on overflow of the packed counter and
  `EACMinAssignees` on underflow (an internal invariant guard on revoke, effectively unreachable
  through the public interface since a revoke can only remove roles someone already holds).
  **VERIFIED** by source; **not yet exercised** by any call in this repository, live or forked.

### 3.4 PermissionedRegistry's narrower restriction — admin roles only at registration

**VERIFIED**, dual-sourced independently, OFFICIAL:

- `contracts/README.md`, "Admin Role Capabilities": *"Admin roles cannot be assigned to someone
  else via the external EAC methods. This means admin roles can only be granted via internal logic
  in derived contracts… Admin roles can, however, be revoked from oneself."*
- `doc/AUDIT_README.md`, "Key Invariants": *"Each token resource has at most one admin (the token
  owner). Admin roles can never be directly granted via external EAC methods — only revoked from
  oneself, or swapped to a new owner through transfer."*

This is a `PermissionedRegistry`-specific restriction layered **on top of** the base
`EnhancedAccessControl` logic in §3.3 — the base contract's `withAdminRolesApplied` computation would
otherwise let an existing admin-role holder grant that same admin role onward (see §3.3). The
registry additionally blocks that path, so the **only** place an admin role for an individual name
can be set is the `roleBitmap` argument of `register(...)` (§7), and thereafter it can only ever be
**reduced** (revoked from the holder) or **moved whole** (name transfer moves every role, admin and
regular, from old owner to new — `EnhancedAccessControl._transferRoles`, **VERIFIED** by source).
This confirms, from the registry's own documentation and audit scope rather than only from this
repository's fork evidence, the `ADMIN_ROLE_RULE` already recorded in `docs/ensv2/DEPLOYMENT-PROFILE.md`
§4. The exact **override mechanism** inside `PermissionedRegistry.sol` (which function overrides
`_getSettableRoles` and how) was **not** independently re-read from that file's source by this
document — the two documentation citations above are independent of each other and of this
repository's fork test, but neither is a byte-for-byte reading of the override. **UNKNOWN** at that
level of detail; the *behaviour* is dual-sourced and not in doubt.

## 4. Resource derivation

**VERIFIED**, OFFICIAL (`docs.ens.domains/ensv2/permissioned-resolver`, and independently confirmed
in `contracts/src/resolver/PermissionedResolver.sol`'s own resource-derivation functions, current
`main`): the resolver's resource formula is **one function of two inputs**,

```
resource = keccak256(abi.encode(node, part))
  part = bytes32(0)                        — NAME-LEVEL: every record on the name
  part = keccak256(bytes(key))             — one TEXT key (setText) or DATA key (setData) — same rule
  part = keccak256(abi.encode(coinType))   — one ADDR coin type
```

This is the **same formula** `integrations/ensv2/profile.mjs` derived and labelled
`resolverScopedResource`/`textScopeHash`/`addrScopeHash`, and the same one `permissioned.mjs`
derived independently as `nameLevelResource`/`textResource`/`coinTypeResource`. Three independent
derivations — this repository's resolution module, this repository's fork execution, and the current
official documentation — now agree on the formula.

**What is genuinely new here, and must not be overstated.** The official documentation states this
formula as the resolver's design; this repository's own `roles.mjs`/`profile.mjs` additionally
**exercised** it on a local Sepolia **fork** (`DELEGATION_FORK`, chain id `11155111`, fork block
`11666400`, owner impersonated, nothing broadcast) and watched the per-key resource populate exactly
where the formula predicts, with a control proving a second key's resource stayed empty. That is
`FORK_EXECUTED` in `profile.mjs`'s own vocabulary — stronger than reading a document, weaker than a
canonical on-chain observation, because the block is local. **No live call against Ethereum
Sepolia itself has ever named a per-key or per-coin-type resource in this repository's evidence** —
every live refusal this repository has observed named the name-level resource
(`docs/ensv2/DEPLOYMENT-PROFILE.md` §2.2). Both things are true at once and are not in tension: the
formula is now VERIFIED (official documentation, corroborated by current source and by a fork
execution); its exercise **on the live chain this repository is pinned to** remains
`DOCUMENTED_NOT_OBSERVED`. §16 records this precisely as an internal staleness, not a contradiction
this document resolves by picking a side.

**Registry** resource derivation, **VERIFIED** (official `contracts/README.md` and
`docs.ens.domains/ensv2/permissioned-registry`, cross-confirmed live on Sepolia by this repository's
own `profile.mjs`/`DEPLOYMENT-PROFILE.md` §2.1 via three independent refusals plus `getResource()`
plus a fresh `register()` return):

```
resource = (keccak256(bytes(label)) & ~uint256(type(uint32).max)) | eacVersionId
```

Derived from the **label alone** — the parent registry is not an input, because each registry
instance already *is* the parent. The low 32 bits carry a version counter (`eacVersionId`) that the
registry itself bumps; the upper 224 bits are the label hash. **Registry and resolver resources are
different shapes from different inputs and are never interchangeable** — handing one contract's
resource to the other addresses a resource nobody holds anything at, which reads as "no authority"
and is the safe-looking, wrong answer. This repository's own `profile.mjs` states this as the single
finding its survey existed to settle; the official documentation for both contracts independently
confirms it.

## 5. Role bitmap layout

**VERIFIED**, OFFICIAL (`contracts/README.md` §"EAC in Registry Contracts", `RegistryRolesLib.sol`
current `main`, cross-checked against this repository's own live-observed bits):

### 5.1 Registry roles (`PermissionedRegistry` / `ETHRegistry` / `RootRegistry`)

| Role | Bit | Admin bit | Scope | Description (official) |
|---|---|---|---|---|
| `ROLE_REGISTRAR` | 0 | 128 | Root-only | Register and reserve new names |
| `ROLE_REGISTER_RESERVED` | 4 | 132 | Root-only | Promote a reserved name to registered |
| `ROLE_SET_PARENT` | 8 | 136 | Root-only | Set parent registry |
| `ROLE_UNREGISTER` | 12 | 140 | Root or token | Unregister names |
| `ROLE_RENEW` | 16 | 144 | Root or token | Extend name expiry |
| `ROLE_SET_SUBREGISTRY` | 20 | 148 | Root or token | Change child registry |
| `ROLE_SET_RESOLVER` | 24 | 152 | Root or token | Change resolver address |
| `ROLE_CAN_TRANSFER_ADMIN` | — (admin-only, bit 156) | 156 | Root or token | Admin-only; **auto-granted to the name owner at registration; revoking it makes the name soulbound (untransferable)** |
| *(unnamed in the README table)* `ROLE_WAS_RESERVED` | 32 | — | — | Present in `RegistryRolesLib.sol`'s current source; **not** listed in the README's role table. This is exactly the bit this repository's own `profile.mjs`/`DEPLOYMENT-PROFILE.md` found held by `raffy.eth`'s owner and recorded as an **unnamed bit**, absent from the documentation it read on 2026-09-09. The name is now known; whether it is a grantable permission or an internal status flag set only by registry logic (e.g. marking a name that passed through the reserved→registered path) is **UNKNOWN** — it was not independently re-read from `PermissionedRegistry.sol`'s own source. |
| `ROLE_CAN_NAME` | 120 | 248 | Root-only | Name the contract (metadata) |
| `ROLE_UPGRADE` | 124 | 252 | Root-only | UUPS proxy upgrade authority |

`ROLE_SET_URI` (bit 36) appears in the current `RegistryRolesLib.sol` source (confirmed by direct
source read of the library) but is not in the README's prose table above — recorded here rather than
silently dropped.

### 5.2 Resolver roles (`PermissionedResolver`)

| Role | Bit | Admin bit | Scope (official) |
|---|---|---|---|
| `ROLE_SET_ADDR` | 0 | 128 | root, name, or record |
| `ROLE_SET_TEXT` | 4 | 132 | root, name, or record |
| `ROLE_SET_CONTENTHASH` | 8 | 136 | root or name |
| `ROLE_SET_PUBKEY` | 12 | 140 | root or name |
| `ROLE_SET_ABI` | 16 | 144 | root or name |
| `ROLE_SET_INTERFACE` | 20 | 148 | root or name |
| `ROLE_SET_NAME` | 24 | 152 | root or name |
| `ROLE_SET_ALIAS` | 28 | 156 | root only |
| `ROLE_CLEAR` | 32 | 160 | root or name |
| `ROLE_SET_DATA` | 36 | 164 | root, name, or record |
| `ROLE_UPGRADE` | 124 | 252 | root only |

All eleven rows above are **VERIFIED, OFFICIAL** (the fetched `permissioned-resolver` documentation
page). This repository's own live evidence independently confirms five of them by chain refusal
(`SET_ADDR`, `SET_TEXT`, `SET_CONTENTHASH`, `CLEAR` — `DEPLOYMENT-PROFILE.md` §3) and one by fork
execution (`SET_DATA`, via `authorizeDataRoles` — `profile.mjs`, `FORK_EXECUTED`). The remainder
(`SET_PUBKEY`, `SET_ABI`, `SET_INTERFACE`, `SET_NAME`, `SET_ALIAS`, `UPGRADE`) are now
**VERIFIED as documented and present in current source**, upgraded from this repository's earlier
`DOCUMENTED_NOT_OBSERVED` label for the *documentation* claim — they remain **not exercised against
this deployment**, live or forked, and that half of the label is unchanged.

## 6. The delegation mechanism — grantRoles is refused; authorize\* is the path

**VERIFIED**, OFFICIAL (`contracts/src/resolver/PermissionedResolver.sol`, current `main`) and
**FORK_EXECUTED** (this repository, `integrations/ensv2/profile.mjs`, `DELEGATION_MECHANISM`,
`DELEGATION_FORK` — Sepolia fork block `11666400`, owner impersonated, nothing broadcast):

```
authorizeNameRoles(bytes toName, uint256 bitmap, address account, bool granted)
authorizeTextRoles(bytes toName, string key, address account, bool granted)
authorizeDataRoles(bytes toName, string key, address account, bool granted)
authorizeAddrRoles(bytes toName, uint256 coinType, address account, bool granted)
```

Each computes **two** resources internally: the name-level resource (`resource(node, 0)`) for its
own admin check, and the finer resource (`resource(node, partHash(key|coinType))`) that the grant is
actually written at. `authorizeNameRoles` grants at the **name-level** resource itself and is
therefore the wide call — this repository's own `roles.mjs` already refuses to emit it for an agent
grant (`NAME_LEVEL_METHOD_FORBIDDEN`), and that refusal is now additionally justified by the
resolver's own source rather than only by this repository's fork observation that it widens an
agent's authority to every text key on the name.

**A UNICA-specific selector inventory** (`selectorFor` applied to each signature; every selector in
this repository's code is derived, never typed — see `permissioned.mjs`'s own header):

| Call | Selector | Status |
|---|---|---|
| `authorizeTextRoles(bytes,string,address,bool)` | `0xf2d1eb25` | FORK_EXECUTED (this repo) + present in current official source |
| `authorizeAddrRoles(bytes,uint256,address,bool)` | `0x587eefd1` | FORK_EXECUTED (this repo) + present in current official source |
| `authorizeDataRoles(bytes,string,address,bool)` | not independently re-derived in this document | present in current official source (§5.2, `SET_DATA`) |
| `authorizeNameRoles(bytes,uint256,address,bool)` | not independently re-derived in this document | present in current official source; **screen-refused** by this repository for agent grants |

**A name the task's brief asked about, and did not find**: `grantSetterRoles`. No occurrence of this
name was found in the current official documentation, the current `contracts-v2` source, or this
repository's own code. **UNKNOWN / not a current interface** — either an older or hypothetical name
superseded by the `authorize*Roles` family above, or a name specific to a different, unreached part
of the codebase. Not used as a pin anywhere in this document.

**What `authorizeTextRoles` requires of its caller**, `FORK_EXECUTED` (`profile.mjs`,
`DELEGATION_MECHANISM.rows`, eight rows, four of them accepted controls and four refusals with a
passing control beside each): the caller must hold `adminRole(SET_TEXT)` — the **regular** `SET_TEXT`
bit is not enough, checked explicitly on the fork by granting the regular bit alone and watching the
same call refuse. The grant it makes is `SET_TEXT` at the per-key resource **only** — a second key of
the same name, checked on the fork, stayed refused. **This is the single most important finding for
UNICA's delegation model**: it is now corroborated by the official resolver source (§4's resource
formula) in addition to the fork execution that first found it, but it is **still not corroborated by
a live call against the Sepolia chain this repository is pinned to** — see §16.

## 7. The initialization hazard — deployment grants, narrowing, and the privilege window

Two different questions hide under this heading and this repository's brief conflates them. They are
answered separately.

### 7.1 Deploying the whole ENSv2 stack (the ENS team's problem, not UNICA's)

**VERIFIED**, OFFICIAL (`contracts/README.md`, "Static Deployment Permissions"): the ENS team's own
deploy script grants roles in a deliberately **narrowed, multi-row** pattern from the first
transaction, not a single atomic call:

| Contract | Resource | Grantee | Roles (A=admin, R=regular, AR=both) |
|---|---|---|---|
| RootRegistry | Root | Deployer | REGISTRAR (AR), REGISTER_RESERVED (AR), SET_PARENT (AR), RENEW (AR), CAN_NAME (AR) |
| RootRegistry | `.eth` | Deployer | SET_RESOLVER (AR), CAN_TRANSFER_ADMIN (AR) |
| RootRegistry | `.reverse` | Deployer | UNREGISTER, RENEW, SET_SUBREGISTRY, SET_RESOLVER, CAN_TRANSFER_ADMIN (all AR) |
| ETHRegistry | Root | Deployer | REGISTRAR (**A only**), REGISTER_RESERVED (A only), SET_PARENT (AR), RENEW (A only), CAN_NAME (AR) |
| ETHRegistry | Root | `ETHRegistrar` | REGISTRAR (**R only**), RENEW (R only) |
| ETHRegistry | Root | `BatchRegistrar` | REGISTRAR (R only), RENEW (R only) |
| ETHRegistry | Root | migration controllers | REGISTER_RESERVED (R only) |

Deployer holds **admin-only** authority on `ETHRegistry`'s root, never the regular operational bit —
the regular `REGISTRAR`/`RENEW` bits live on `ETHRegistrar`/`BatchRegistrar` instead. That split is
the narrowing this section asked about, and it is real, but it is **not one transaction**: the same
page states that under the phased migration deploy, `ETHRegistrar`'s grant of `REGISTRAR|RENEW` is
**deferred to a separate phase** ("phase 6") rather than made at initial deployment. **There is a
documented, named privilege window** between deploying `ETHRegistry` and completing the phase-6
grant, during which the deployer's admin-only bit is the only path to the registrar role at all. This
is the ENS team's own operational window, not UNICA's, and it is **BACKEND_POLICY on the ENS team's
side, not a risk this document can mitigate** — it is recorded because it is the concrete answer, on
the actual deployment UNICA depends on, to "can deployment plus narrowing be one transaction": **no,
not for the registry stack itself; the ENS team's own tooling accepts a scripted, multi-phase
window instead.**

### 7.2 A single name and a single resolver (UNICA's actual onboarding problem)

This is the question that matters to a merchant. Two calls are in scope, and both **can** be atomic:

- **`ETHRegistrar.register(label, owner, subregistry, resolver, roleBitmap, expiry)`** (exact
  argument order not re-derived from source in this document; the `roleBitmap` argument's semantics
  are `DEPLOYMENT-PROFILE.md`'s own finding, restated at §3.4): the `roleBitmap` passed here is the
  **only** place an admin role for that name can ever be set, and it is set in the **same**
  transaction that creates the name. If the bitmap is right, there is no privilege window at all
  beyond the ordinary window between signing and mining a transaction. If it is wrong — missing an
  admin bit the merchant will need later — there is **no repair**: re-registering means first losing
  the name (§7.3).
- **The per-name resolver's `initialize(address admin, uint256 bitmap, bytes[] setters)`**
  — **VERIFIED**, OFFICIAL (`docs.ens.domains/ensv2/permissioned-resolver`) — sets the resolver's
  initial `ROOT_RESOURCE` grant in one call. **VerifiableFactory.deployProxy** (`VerifiableFactory.sol`,
  `ensdomains/verifiable-factory`, full source read) deploys the proxy with `create2` and calls
  `IUUPSProxy(proxy).initialize(implementation, data)` **in the same external call**, atomically —
  there is **no window in which a freshly deployed, uninitialized resolver proxy sits on-chain for
  anyone else to front-run with their own `initialize` call.** `VERIFIED` by direct source read; this
  answers a real, common UUPS-proxy vulnerability class in the negative for this specific factory.

**PROPOSED (UNICA design):** the onboarding script must compute the **complete final role bitmap**
for both calls before submitting either — never a "grant broad, then narrow" sequence on UNICA's own
side — because §7.2 shows both primitives already support a single atomic grant of the exact desired
state. The residual privilege window is not inside either call; it is **between** them.

### 7.3 The residual window UNICA's own onboarding introduces

A merchant onboarding needs at least: (1) `register()` the name, (2) deploy the resolver via
`VerifiableFactory.deployProxy`, (3) `PermissionedRegistry.setResolver(tokenId, resolverAddress)` to
point the name at it. Steps 2–3 are separate transactions from step 1 and from each other. Between
step 1 and step 3, the name has **no resolver of its own** (it resolves through whatever the parent's
wildcard resolver answers, or not at all), and between step 2 and step 3 a correctly-initialized
resolver exists but is **not yet the name's resolver of record**. **PROPOSED, fail-closed procedure**:
the onboarding script must read back `hasRoles`/`roles` on the freshly initialized resolver and
confirm the exact intended bitmap **before** calling `setResolver` — never chain the three
transactions optimistically and assume success from a lack of revert, per this repository's own
standing on-chain-rehearsal discipline (predict → dry run → send → readback → independently verify).
If step 3 is delayed or never sent, the merchant's name is simply unresolved (or resolves through the
parent) — a safe failure, not a redirect, matching `web/ensv2/resolve.mjs`'s existing `ZERO_ADDRESS`
classification.

## 8. Roles for UNICA's actors

**PROPOSED** throughout this section unless a cell says otherwise — no UNICA-owned name has been
registered, no resolver has been initialized on UNICA's behalf, and no role in this table has
actually been granted. Contract abbreviations: **Reg** = the merchant's registry entry
(`PermissionedRegistry`/`ETHRegistry`); **Res** = the merchant's own per-name `PermissionedResolver`
proxy.

| Actor | Contract | Resource | Role bitmap | Grantor | Grantee | Grant time | Revocation authority | Escape route | Recovery | Event / evidence path |
|---|---|---|---|---|---|---|---|---|---|---|
| **UNICA protocol administrator** | Reg | the registry resource of whatever name UNICA itself owns (e.g. `unica.eth`'s registry entry) | admin(`SET_RESOLVER`), admin(`SET_SUBREGISTRY`), `CAN_TRANSFER_ADMIN` (auto-granted), admin(`RENEW`) | `ETHRegistrar`, inside `register()` | UNICA's own EOA or Safe | at registration (owner-wallet action, **not yet done** — `ENS-OWNER-ACTION.md` step 1) | self only (§3.4 — admin roles are revoked from oneself, never by a third party) | none within this registry; the ENS team's own `ETHRegistry`-root authority sits above every registrant equally (§7.1) and is out of UNICA's control | token transfer to a new key while the old one still works; **no recovery if the only admin key is lost outright**, until the name expires and can be re-registered by anyone (§3.4, §7.3) | `NameRegistered`, `EACRolesChanged` on the registry (**ENSV2_ONCHAIN**); indexed separately if UNICA's own subgraph covers ENSv2 events — cross-reference `docs/unica-v5/graph/` (sibling stream, cited not edited) |
| **Merchant owner** | Reg + Res | the merchant's own name's registry resource; `ROOT_RESOURCE` of the merchant's own resolver instance | full admin set at Reg (as above, scoped to the merchant's name); full admin set at Res (`admin(SET_ADDR)`, `admin(SET_TEXT)`, …) | `ETHRegistrar` (Reg, via `register()`); the resolver's own `initialize()` call (Res) | the merchant's own EOA or Safe | at registration and at resolver deployment — both atomic (§7.2) | self only, both contracts | none above the merchant's own key **for a name the merchant registered directly**. If instead the merchant holds only a **managed subname** under a UNICA-controlled parent (`ENS-OWNER-ACTION.md` step 4), the merchant holds **no registry-level admin at all** — UNICA's own parent-registry admin can redirect that subname's resolver. This is a real architectural fork, flagged again in THREAT-MODEL.md §3.7 and §3.17, and is an **open design decision**, not settled by this document | token transfer (direct-registration model); none (managed-subname model — the merchant is trusting UNICA's own key hygiene) | `EACRolesChanged` on Reg and Res (**ENSV2_ONCHAIN**) |
| **Store manager** | Res | per-key resource(s) for a small, closed set of non-payment configuration text keys | `SET_TEXT` (regular only) | merchant owner, via `authorizeTextRoles`, one call per key | store manager's EOA | any time after the resolver exists | merchant owner only (holds `admin(SET_TEXT)` — §3.3 shows there is no separate "revoke-only" authority) | cannot touch payment-identifying keys (`unica:token`, `unica:executor`, the address record) because those are outside the granted per-key resource entirely — structural, not permission-based (matches this repository's own `RECORD_KEYS` closed vocabulary and `PROTECTED_RESOURCE` screen in `roles.mjs`) | merchant owner re-grants after revocation | `EACRolesChanged` at the per-key resource (**ENSV2_ONCHAIN**, once exercised live — currently `FORK_EXECUTED` only, §16) |
| **Cashier** | Res | per-key resource for one narrow operational-status key (e.g. an "open/closed" or session-nonce style key) | `SET_TEXT` (regular only), one key | merchant owner or store manager acting under a merchant-delegated admin grant (**UNKNOWN** whether a store manager can ever hold `admin(SET_TEXT)` themselves under this design — see §11) | cashier's EOA or device key | per shift, PROPOSED | merchant owner (and store manager only if the design in fact grants them admin authority — unresolved, see above) | cannot transfer the name, cannot change payout identity, cannot touch any key outside the one it was granted (structural, per §6) | re-grant | `EACRolesChanged` (**ENSV2_ONCHAIN** once exercised) |
| **POS terminal** | Res | per-key resource on the terminal's **own leaf name** (e.g. `terminal-N.pos.merchant.<parent>`), never the merchant's own name | `SET_TEXT` (regular only), scoped to that leaf's own status key | merchant owner | the terminal's own key/device | per terminal, PROPOSED | merchant owner | **structurally cannot create peers or replace its own resolver**: it is never granted `ROLE_SET_SUBREGISTRY`/`ROLE_SET_RESOLVER` at the registry, and a resolver role grants no registry authority at all — the two contracts' resources are non-interchangeable (§4). Revoking a terminal stops **future** order creation from it; it does not and cannot cancel a valid on-chain order already created (UNICA's non-negotiable boundary, restated in THREAT-MODEL.md §2) | merchant owner revokes and, if the terminal's leaf name itself is compromised beyond the granted key, abandons that leaf and issues a new one | `EACRolesChanged` at the leaf's per-key resource |
| **Merchant agent** | Res | per-key resource(s) on the agent's own leaf (`agent.treasury.merchant.<parent>` pattern, per this repository's existing `roles.mjs`) | `SET_TEXT` (default) or `SET_ADDR` (opt-in), regular only, one or two keys | merchant owner, via `authorizeTextRoles`/`authorizeAddrRoles` | agent's own key | PROPOSED, mirrors this repository's already-built `planAgentGrant` | merchant owner (`planAgentRevoke` — already built, same call with the flag flipped) | this is the **most evidenced** row in this table: this repository's own `DENIAL_MATRIX` (`roles.mjs`) states, and the fork execution backs, that the agent cannot transfer the name, change owner, set resolver, set subregistry, register siblings, renew/unregister, change the payment recipient/executor/chain id, administer roles, grant roles to itself or anyone, write a key nobody authorised, or obtain root roles — each with its denial mechanism (STRUCTURAL / SCREENED / CHAIN_ENFORCED) named. The one **acknowledged residual**: per-key scoping holds only when the grant was made with `authorizeTextRoles`; `authorizeNameRoles` writes at the name level and, if ever used instead, an agent granted `SET_TEXT` there was observed (on the fork) writing a key nobody authorised — the planner refuses that method by name, which is a property of this repository's code, not of the chain, and a delegation made by a different tool is outside what this repository can deny | merchant owner revokes via `authorizeTextRoles(...,false)` | `EACRolesChanged` at the agent's per-key resource; this repository's own `permissioned-test.mjs`/`profile.mjs` are the current evidence trail (`FORK_EXECUTED`, §16) |
| **Identity renderer** | none | — | **no EAC role at all** | — | — | — | n/a — holds nothing to revoke | reads only: `tokenURI`/`addr`/`text` are public view functions on both contracts, unpermissioned | trivially total: a process with zero roles cannot change a payment endpoint by construction, matching `docs/unica-v4/ENS-ART-LAYER.md`'s H11 ("the art is a function of the normalized name and an explicit renderer version, never of mutable merchant data") | none needed |
| **Receipt / evidence writer** | none at the resolver level for the guarantee that matters | a text key may exist as a **pointer** to the latest evidence (e.g. a hash or URI) | `SET_TEXT` (regular only) on that one pointer key, if built at all | merchant owner | a UNICA backend process or contract | PROPOSED | merchant owner | **ENS text records are mutable, last-write-wins fields — the same as an address record** (`docs/ensv2/UNICA-ETH-ADDR-REPORT.md`: "An address record is a mutable field, not an allocation"). **A resolver role cannot make a receipt log tamper-evident or append-only.** UNICA's actual "cannot rewrite history" guarantee has to come from `UNICA_ONCHAIN` settlement events plus `GRAPH_EVIDENCE` indexing (immutable once mined and indexed), never from an ENS text record. Any ENS-side "evidence writer" role should be understood and documented as a mutable pointer only, not as the evidence itself — this is a genuine limitation, not a solved problem, and is carried into THREAT-MODEL.md §3.22 | pointer can be corrected by the same admin authority that set it, which also means it can be corrected by an attacker who compromises that authority | the durable trail is `UNICA_ONCHAIN` events + `GRAPH_EVIDENCE`, not the ENS record |
| **Emergency revoker** | Res (and Reg, if the emergency also covers registry-level roles) | wherever the role being revoked lives | must hold `adminRole(X)` for every `X` it needs to revoke | merchant owner, at onboarding or ad hoc | a designated emergency key/Safe module | PROPOSED | merchant owner (or itself, over itself) | **there is no "revoke-only" primitive in EAC** (§3.3: `_getSettableRoles` and `_getRevokableRoles` are the identical computation in the base contract). Any account empowered to revoke `SET_TEXT` from a compromised agent necessarily also holds the authority to **grant** `SET_TEXT` to a new party. A true least-authority "can only pull the emergency brake" role is **not directly expressible in ENSv2's EAC** and must be enforced at the `BACKEND_POLICY` layer instead — e.g. a Safe module or transaction-policy layer that only ever constructs revoke-shaped calldata for that key, never grant-shaped calldata, verified by policy outside the chain rather than by the chain itself. **This is an honest limitation of the mechanism, not a design this document can close by choosing better bits** | none beyond "trust the operational policy around this key," which is precisely the residual this row exists to name | `EACRolesChanged` |
| **Read-only accountant** | none | — | **no EAC role** | — | — | — | n/a | `roles`/`hasRoles`/`text`/`addr` are public, unpermissioned view functions on both contracts — no grant is needed to read them | none needed | `CLIENT_VERIFICATION` reads plus `GRAPH_EVIDENCE` for settlement history |

## 9. Escape-route analysis

Consolidated from §8's per-row entries plus this repository's own `roles.mjs` `DENIAL_MATRIX`
(`FORK_EXECUTED` and screen-enforced, not yet live-executed):

- **A subordinate role (store manager, cashier, terminal, agent) cannot escalate itself** because
  every path to widen authority — `grantRoles`/`revokeRoles` on the resolver (disabled outright,
  §3.3), `authorizeNameRoles` (screen-refused for agents, §6), obtaining an admin bit after
  registration (disallowed on the registry, §3.4) — is closed by a mechanism independent of any
  single subordinate's specific grant.
- **A subordinate cannot escape *revocation* by replacing its own resolver**, because none of these
  roles is ever granted `ROLE_SET_RESOLVER`/`ROLE_SET_SUBREGISTRY` at the **registry** — those are
  registry-level roles, structurally distinct from anything a resolver role grants (§4). This holds
  as designed; it has not been exercised live or on a fork by this repository, so it is
  **PROPOSED, structurally sound** rather than **VERIFIED, exercised**.
- **The merchant owner cannot be locked out by a subordinate**, for the same reason in reverse: no
  subordinate role in §8 ever reaches an admin bit.
- **The merchant owner *can* lock themselves out** by revoking their own `CAN_TRANSFER_ADMIN` (which
  makes the name soulbound, VERIFIED via official documentation, §5.1) or by losing the only key that
  holds their admin roles, with no recovery path short of expiry and re-registration (§3.4, §8).
- **UNICA's own protocol-administrator authority does not protect a merchant using a direct
  registration** — it sits on a different name entirely and has no resource in common with the
  merchant's name. It **does** matter for a merchant on a **managed subname**, where UNICA's own
  parent-registry admin authority is the thing standing where the merchant's own admin authority
  would otherwise be — an open design question flagged twice already (§8, THREAT-MODEL.md §3.7).

## 10. Whether contracts may hold roles

**VERIFIED** by source, `EnhancedAccessControl.sol`: `_grantRoles` checks only
`if (account == address(0)) revert EACInvalidAccount();` — there is no check distinguishing an EOA
from a contract anywhere in the grant path. **A contract can hold a role exactly as an EOA can.**
This is confirmed independently by `contracts/README.md`'s own Static Deployment Permissions table
(§7.1), where `ETHRegistrar`, `BatchRegistrar` and the migration controllers — all contracts — hold
registry roles directly.

**PROPOSED, a hardening opportunity this repository has not built**: the merchant agent's key (§8)
does not have to be a raw EOA. A scoped smart-contract wallet holding the `SET_TEXT` grant could
enforce additional policy (rate limits, an allow-list of values, a kill switch) in its own logic
before ever calling `setText`, independent of what EAC itself can express. Not built, not scheduled;
recorded here because §8's "emergency revoker" row shows a real gap this could partially address for
the agent case specifically (a contract-held agent key could refuse to act once its own internal
kill switch is flipped, without needing the merchant to touch EAC at all) — though it does **not**
solve the emergency-revoker problem generally, since the underlying EAC revoke/grant symmetry (§3.3)
is unchanged for every other role in §8.

## 11. Whether role narrowing is enforceable

Two different claims, kept separate on purpose:

- **Revoking a specific grant is enforceable and reliable.** `_revokeRoles` (§3.3) removes exactly
  the bits requested and cannot be resisted by the account being revoked — this is
  `FORK_EXECUTED`-confirmed (`profile.mjs`, `DELEGATION_MECHANISM` row 5) and matches the base
  contract's own logic (§3.3), which has no path for a non-admin to block a revocation of a role it
  holds.
- **Permanently capping what an admin *could* grant in the future is not enforceable within EAC
  alone.** Revoking `SET_TEXT` from an agent does not touch the merchant owner's own
  `adminRole(SET_TEXT)` — nothing stops the same owner from granting it again immediately, to the
  same or a different account. "Narrowing" in the sense of a one-way ratchet does not exist as a
  primitive; the only one-way ratchet in this system is revoking one's **own** admin role entirely
  (§5.1, `CAN_TRANSFER_ADMIN`, "soulbound"), which removes the owner's own authority along with
  everyone else's ability to be re-granted by them — a much more drastic, all-or-nothing action, not
  a scalpel.

## 12. VerifiableFactory behaviour and its role implications

**VERIFIED** by full source read, `ensdomains/verifiable-factory`, `src/VerifiableFactory.sol`:

- Deployed as a **separate, separately audited repository** (audit commit `c47c0e61ce03b3ab5891a3b743287b54aee9f021`, `doc/AUDIT_README.md`), not part of `contracts-v2` itself — three files, ~150 lines: `VerifiableFactory.sol`, `UUPSProxyLogic.sol` (the shared proxy-mechanics implementation every clone delegates to), `IUUPSProxy.sol`.
- `deployProxy(implementation, salt, data)`: the CREATE2 salt is `keccak256(abi.encode(msg.sender, salt))` — namespaced per caller, so two different callers can reuse the same user-supplied salt without colliding. It deploys the clone with inline assembly `create2(...)`, reverting on a zero address, and then **immediately, in the same external call**, invokes `IUUPSProxy(proxy).initialize(implementation, data)`. **There is no window in which an uninitialized, deployed proxy sits on-chain** — the common "front-run the initializer" UUPS vulnerability class does not apply to this factory's own deploy path, verified from its source rather than assumed.
- `verifyContract(proxy)` recomputes the expected CREATE2 address from the proxy's own stored salt (via `getVerifiableProxyData()`) and compares it against the address supplied — this is the mechanism a preflight check should call to confirm a resolver proxy is genuinely one this factory deployed, rather than trusting an address handed to it (see DEPLOYMENT-CONFIG.md §11).
- **Role implication for UNICA**: because deploy-and-initialize is atomic, the resolver's initial `ROOT_RESOURCE` bitmap (§7.2) can be set to the merchant's exact final desired authority in one transaction, with no intermediate state visible to anyone else on-chain.

## 13. Registration and renewal roles

Covered in §5.1 (`ROLE_REGISTRAR`, `ROLE_RENEW`) and §7.1 (who holds them on the live deployment: `ETHRegistrar` and `BatchRegistrar` hold the regular bits; the deployer holds only the admin bits). **VERIFIED**, OFFICIAL. The commit-reveal mechanism a merchant's own `register()` call goes through — **VERIFIED** by source read, `contracts/src/registrar/ETHRegistrar.sol`:

- `commit(bytes32 commitment)` records a commitment hash; a second `commit` for the same hash before it has aged past `MAX_COMMITMENT_AGE` reverts `UnexpiredCommitmentExists`.
- `register(...)` calls `_consumeCommitment`, which reverts `CommitmentTooNew` if less than `MIN_COMMITMENT_AGE` has elapsed and `CommitmentTooOld` if more than `MAX_COMMITMENT_AGE` has, then **deletes** the commitment so it cannot be replayed.
- `makeCommitment` binds `label, owner, secret, subregistry, resolver, duration, referrer` — the **same set of fields** that must all agree between `commit` and `register`, which is what stops a third party from front-running a visible `commit` with their own `register` for the same label (they lack the secret).
- `MIN_COMMITMENT_AGE`, `MAX_COMMITMENT_AGE` and `MIN_REGISTER_DURATION` are `immutable`, set once at the registrar's own construction — their exact values are **deployment-specific, not fixed in source**. A testnet deploy config found in the same repository (`contracts/deploy/testnet/00_FastETHRegistrar.ts`) sets `minCommitmentAge = 0`, `maxCommitmentAge = 1 day` — **DOCUMENTED (a deploy script default), not confirmed as the value governing the live Sepolia deployment this repository is pinned to.** A preflight should read `ETHRegistrar.MIN_COMMITMENT_AGE()`/`MAX_COMMITMENT_AGE()` directly (both `public immutable`) rather than assume either value. **UNKNOWN**, pending that live read.
- Pricing: `StandardRentPriceOracle`, `Ownable` (not EAC) — its owner can update base rates, discount points, payment-token configuration and halving parameters (`doc/AUDIT_README.md`, "Non-EAC Privileged Roles"). **VERIFIED, OFFICIAL.** This is a centralized, non-EAC trust point on the pricing path that this document records rather than omits, even though it sits outside Enhanced Access Control proper.

## 14. Wildcard behaviour and its interaction with access control

**VERIFIED**, official ENSIP-10 (status **Final**) and cross-confirmed by this repository's own live
Sepolia reads (`DEPLOYMENT-PROFILE.md` §5, `profile.mjs` `WILDCARD`): an unregistered subname
resolves through its nearest registered ancestor's resolver, returning the **zero address without
reverting** rather than failing — "a successful resolve is not evidence that a name is registered."

Access-control interaction, **PROPOSED analysis, not yet exercised**: because a wildcard subname
shares its **parent's** resolver instance until it is separately registered with its own, any account
holding `ROOT_RESOURCE` authority on that **parent's resolver** can answer for every wildcard subname
under it, whether or not those subnames are ever individually registered. This is not a defect in
ENSv2 — it is the entire mechanism that lets an operator hand out `<merchant>.<parent>` without a
per-merchant transaction (`ENS-OWNER-ACTION.md` step 4) — but it means a **managed-subname**
merchant's identity is, until they register and point their own resolver, entirely a function of the
parent operator's resolver-level authority. This is the same architectural fork already flagged in
§8 and repeated in THREAT-MODEL.md §3.7, not a new one.

**A related, unresolved question this document could not settle**: the official resolver
documentation states a resolver supports `setAlias`/`getAlias`, and that "the alias and target must
use the same resolver instance" — implying one deployed resolver instance could, via aliasing, answer
for more than one distinct name, in which case that instance's `ROOT_RESOURCE` authority would extend
across every aliased name, not just the one it was originally deployed for. No alias is configured on
any name this repository has read (matching its existing evidence), and this interaction with EAC
scoping was not exercised, live or forked. **UNKNOWN**, and recorded as such rather than assumed
either way; carried into THREAT-MODEL.md as a residual under resolver replacement / excessive root
grants.

## 15. Parent/child revocation

**VERIFIED**, OFFICIAL (`contracts/README.md`, "Creating Emancipated Names"): a subregistry is, by
default, **not** independent of its parent — the parent registry's own root-level roles
(`ROLE_SET_SUBREGISTRY`, `ROLE_SET_RESOLVER`, etc.) apply to every child name under it, folded in via
`ROOT_RESOURCE` exactly as §3.2 describes. A child can only become independent ("emancipated") if the
**parent** deliberately (1) creates a subregistry whose owner holds no root roles there and (2) locks
that subregistry into the parent. Both steps are parent-side actions. This means:

- **By default, a parent retains override authority over every child**, which is the property
  UNICA's own protocol-administrator role (§8) and the "revoking a terminal stops future order
  creation" requirement both rely on — the merchant, as parent of its own agent/terminal/staff leaf
  names, can always act on them.
- **A child cannot unilaterally escape parent revocation** unless the parent has already,
  deliberately, emancipated it — matching §9's structural analysis exactly, now with an official
  citation for the general registry mechanism rather than only this repository's own agent-specific
  fork test.
- **Known design decision, VERIFIED (`doc/AUDIT_README.md`)**: circular subregistry references are
  **permitted** by the contracts; cycle detection is deferred to the indexer/off-chain layer, and
  on-chain resolution (`LibRegistry.findCanonicalName`) relies on gas limits as its only bound rather
  than an explicit depth check. This is not an access-control gap in the roles sense, but it is a
  resolution-availability risk worth carrying into THREAT-MODEL.md rather than treating as
  out-of-scope for an "access control" document, since a malicious or misconfigured parent/child pair
  could make a name's resolution revert on out-of-gas rather than fail cleanly.

## 16. Conflicts between sources

Recorded plainly, per this document's own instruction not to paper over a disagreement:

1. **Internal staleness inside this repository, not a contradiction between two facts.**
   `integrations/ensv2/README.md` and `ENS-OWNER-ACTION.md` (both dated 2026-09-08) and
   `docs/ensv2/DEPLOYMENT-PROFILE.md` (dated 2026-09-09) all state that per-key/per-coin resource
   derivation and the `authorizeTextRoles` family are `DOCUMENTED_NOT_OBSERVED` and that
   "no live call in this repository has successfully exercised `setText` or
   `grantRoles`/`authorizeTextRoles`." `integrations/ensv2/profile.mjs` and `roles.mjs` — read as
   part of this document's own research, same repository, same day of retrieval for this document —
   carry a **newer, more granular finding**: `authorizeTextRoles`/`authorizeAddrRoles`/
   `authorizeDataRoles` were **executed on a local Sepolia fork** (`DELEGATION_FORK`, block
   `11666400`) and the per-key/per-coin resource formula was confirmed to hold there, labelled
   `FORK_EXECUTED` — a real, named evidentiary category, explicitly **not** "live" and explicitly
   **not** "documentation," sitting between the two. The top-level markdown docs have not been
   updated to reflect `profile.mjs`'s own newer findings. **This document treats `profile.mjs` and
   `roles.mjs` as the more current internal source** (they are the machine-readable ledger the
   markdown docs describe themselves as summarising) while keeping the original
   `DOCUMENTED_NOT_OBSERVED` label intact for the one thing that is still true of the **live** chain:
   no live Sepolia call, in this repository's evidence, has ever named a per-key or per-coin-type
   resource, or successfully executed `authorizeTextRoles` against the live chain. Both statements
   are carried in this document (§4, §6) rather than one overwriting the other.
2. **A genuine external conflict, in the ENS team's own repository, not manufactured by staleness.**
   `contracts/docs/addresses/sepolia.md` (auto-generated, timestamped `2026-06-29T05:35:12.452Z`)
   lists a **different address** for nearly every ENSv2 Sepolia contract than the ones this
   repository's own live chain reads confirmed on 2026-09-09/10 (`PermissionedResolverImpl`,
   `RootRegistry`, `ETHRegistry`, `ETHRegistrar`, `VerifiableFactory`, `BatchRegistrar`,
   `ContractNamer`, `DefaultReverseRegistrarAdapter`, `ENSV1Resolver`, `ENSV2Resolver`,
   `UniversalResolverV2` all differ). The **one** address that matches exactly across both sources is
   the fixed entry point, `UpgradableUniversalResolverProxy` at `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`
   — and the intermediate proxy this repository calls "the second hop" is, per the same official
   source, named `ManagedUniversalResolverProxy`, filling a gap this repository's own evidence left
   as an inferred, unofficial name. The **same page** states, in its own words: *"the intermediate URP
   `0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1` has been repointed from the current fresh deployment
   … back to the previous deployment's `UniversalResolverV2` `0x2f8a180604c42457cb56c7c4f708748ff1f91df1`
   … so the public entrypoint … again resolves v1 names. This is a temporary measure at the team's
   request…"* — a **third**, distinct `UniversalResolverV2` address, matching neither this
   repository's live read nor the generated addresses table. **Three different addresses for one
   logical role, acknowledged as unstable by the party operating it.** This is not resolved by
   picking one; it is Exhibit A for DEPLOYMENT-CONFIG.md's rule that nothing beyond the fixed entry
   point may ever be hard-coded, and it is carried into THREAT-MODEL.md §3.2 and §3.11 verbatim.

## 17. Unknowns

An honest list, not emptied for appearances:

- Whether `PermissionedRegistry.sol`'s own override that blocks admin-role grants after registration
  (§3.4) is implemented by overriding `_getSettableRoles`, by a separate explicit check, or some
  other mechanism — stated as behaviour by two independent official documents, not independently
  re-read from that file's own source by this document.
- Whether `ROLE_WAS_RESERVED` (registry bit 32, §5.1) is a grantable permission or an internal status
  flag the registry sets itself — present in current source, absent from the README's role table,
  and not resolved by this document.
- Whether a store manager (§8) could ever legitimately hold `admin(SET_TEXT)` under UNICA's own
  design, as opposed to only regular `SET_TEXT` — left open in the table itself.
- Whether resolver aliasing (`setAlias`/`getAlias`) can cause one resolver instance's `ROOT_RESOURCE`
  authority to extend across more than one distinct name in a way that matters to UNICA's per-name
  isolation assumption (§14) — the mechanism exists in the documented interface; no alias is
  configured on any name this repository has read, live or forked.
- The exact `MIN_COMMITMENT_AGE`/`MAX_COMMITMENT_AGE`/`MIN_REGISTER_DURATION` values on the specific
  ETHRegistrar instance this repository's pinned deployment uses — `immutable`, deployment-specific,
  not read live by this document (§13).
- Whether the two addresses this document treats as "the" `UpgradableUniversalResolverProxy` entry
  point across every source examined really do point at behaviourally identical downstream contracts
  at any given moment, given §16's confirmed repointing history — this can only be answered by a
  fresh preflight read immediately before use, never by any address list, including this one.
- Whether admin roles at a resolver's `ROOT_RESOURCE` can ever be assigned to more than one holder in
  practice for a UNICA-controlled name — this repository's own earlier survey found **two** full-authority
  accounts on a third-party name's resolver (`raffy.eth`) and could not identify the second one
  (`profile.mjs`, `UNRESOLVED[0]`); this document did not attempt to re-derive it and repeats it here
  as still open.
- Whether `EACMaxAssignees`/`EACMinAssignees` (§3.3) have ever actually fired on this deployment —
  their existence and selectors are now `VERIFIED` by source; neither has been observed, live or
  forked, by this repository.
