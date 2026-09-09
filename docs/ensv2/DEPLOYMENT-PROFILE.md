# ENSv2 on Sepolia — the deployment profile

**What this is.** The interface UNICA will build the merchant identity chain on, established by
reading the deployed contracts rather than by reading the documentation about them. Every claim
below carries a label saying how it was established, and the labels are the substance of the
document: an honest `DOCUMENTED-NOT-OBSERVED` is worth more here than a confident guess, because
everything built later inherits whatever this page gets wrong.

**Read on** chain `11155111` (Ethereum Sepolia) at block **11666085**, `2026-09-09`.
Re-read green at block 11666122 — 50 checks, 0 failed, 0 skipped.

**Machine-readable form:** [`integrations/ensv2/profile.mjs`](../../integrations/ensv2/profile.mjs).
**Checked by:** `node script/ensv2/profile-check.mjs --self-test` (offline, 49 checks including 12
sabotage rows) and `node script/ensv2/profile-live.mjs` (live re-read, 50 checks).

Nothing in this survey signs, broadcasts, or spends. Every observation came from `eth_call`,
`eth_getCode` or `eth_getStorageAt`. The "simulated writes" below are `eth_call` with a `from`
address; they run at the node and are discarded.

---

## The labels

| Label | What it means |
|---|---|
| **OBSERVED · REVERT_NAMED_IT** | The deployed contract refused a simulated call and its own revert data carried this exact resource, role bitmap or account. The strongest evidence obtainable without a wallet, because the contract is quoting itself rather than answering a question we shaped. |
| **OBSERVED · DECODED** | A live `eth_call` returned a value that decoded to this. |
| **OBSERVED · ACCEPTED_IN_SIMULATION** | A simulated write returned without reverting. Only ever reported next to a refusal of the same shape — an accepted setter and a missing function both produce `0x`, so one half of the pair proves nothing. |
| **OBSERVED · PUSH4_IN_RUNTIME** | The selector appears as a `PUSH4` dispatch constant in the downloaded runtime. Proves the function exists. See the warning below about what its absence does *not* prove. |
| **DOCUMENTED-NOT-OBSERVED** | Read from ENS documentation. Never confirmed against this deployment. |

> **A warning about PUSH4 scanning, because it nearly produced a wrong answer here.**
> `EACUnauthorizedAccountRoles` was observed in live revert data from **both** the registry and the
> resolver, and its selector appears as a `PUSH4` constant in **neither** runtime — solc emits a
> revert selector as the top four bytes of a `PUSH32` word instead. A survey that reads "not found
> as PUSH4" as "not implemented" is therefore wrong in the direction that matters. No row in this
> document is marked absent on the strength of a PUSH4 miss.

---

## 1. The deployment

Addresses were taken from <https://docs.ens.domains/learn/deployments> and then every one was read
back from the chain. Code size and runtime code hash below are first-hand.
**OBSERVED · DECODED**, all rows.

| Contract | Address | Bytes | Runtime code hash |
|---|---|---:|---|
| UpgradableUniversalResolverProxy | hash `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | 2491 | `0xf7ead24f8e5e731683ed38f7cd5052db9e3e8150fb2b5bc76c1a1bb450af74c5` |
| *(intermediate proxy — see §1.1)* | hash `0x6d80f2172cfdec5730fe683860c33d26fc42e6f1` | 2612 | `0xba6ae56546e53515a294152a398155a1094ef337abdb76bc541f2d78744b4b12` |
| UniversalResolverV2 | hash `0x4a1817d13e9cf196f471725176355c1234b63c70` | 18495 | `0x7b2c7040adacb3932de62c3a8d05f4e5c9361d6a3fae7dc3bdee815df44a3ca4` |
| RootRegistry | hash `0x8115186e8f2e0b0281e86ab91f0f48ba90364354` | 14730 | `0x99a6ba74173ac220fd9d7a2000a8142cf52d98c7a17ac6abc6d74fa17d8f086c` |
| ETHRegistry | hash `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` | 14730 | `0x99a6ba74173ac220fd9d7a2000a8142cf52d98c7a17ac6abc6d74fa17d8f086c` |
| PermissionedResolverImpl | hash `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` | 17597 | `0x7a5bbb7f5a8e46232a4437e8eea6cc6e935266ade1b8b027e4e04fb9ca8efd47` |
| ETHRegistrar | hash `0xa88553f454b77203b0d036a05c894d555eaaa2cc` | 7497 | `0x7ac653f817e6bef6543d25ce97235b232430b1771ab5bcb27b936798fe38af1f` |
| VerifiableFactory | hash `0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef` | 1411 | `0x810afc44bd6c35ac974ab80a8cf983cc6e514364b7a214b3a25df2d4e1e7ba60` |
| BatchRegistrar | hash `0x8b16d15f3e51074d0e06f3cf4a0053f7cb92a7fb` | 2211 | `0x0385d9b59e035bda9e9668a63700d8137f0890a60d3e708002260c3747f43d5e` |
| ContractNamer | hash `0xa48eb920950d7f4963d1d87f15f195624fbfbd6a` | 855 | `0x0959a24babb02d4d6c6ef27aaec9c34e824a2c55d24b13a8b3dae8401138e1c4` |
| DefaultReverseRegistrarAdapter | hash `0x7a84e241f862d73960d73c26d68c3c8f89f0b18f` | 1982 | `0xba4d3b3cf3e048cce40f1c07cca02e906fbd39a527fdccb28d17f1638d79ac9a` |
| DNSV1MirrorRootBatchRegistrar | hash `0xdc5c31f7ea5e31efc6d5c68dd568f4c4a169804b` | 2211 | `0x3c7d6900fd40d62322b68992240d15a63b48c8493d02751807ea604e45de82fa` |
| ENSV1Resolver | hash `0xae66c62acae72098bdac57d8e8aed53ef000b2ba` | 10818 | `0xb7fd8ad888469eb5b7ddce51e3b13454ac8899b1dac131ad43efb2338d3f4b2f` |
| ENSV2Resolver | hash `0x508cb4e4596429ca98a1bb3112d88d18f92456b5` | 11261 | `0x29549daef95803848cb34da0df69ad0d3697eeab8429fb0c73eebf99147a1905` |

**RootRegistry and ETHRegistry are the same runtime, deployed twice** — identical size and identical
code hash. One `PermissionedRegistry` implementation, two instances, distinguished only by state.
The hierarchy was confirmed from both ends:
`RootRegistry.getSubregistry("eth")` → `0xBDC85dD5…4F0E2` (ETHRegistry), and
`ETHRegistry.getParent()` → `0x8115186E…64354` (RootRegistry). **OBSERVED · DECODED**

### 1.1 The entry point is three hops from the implementation, and each hop has an owner

The documentation lists `UniversalResolverV2` as though it sat behind the fixed entry point. It does
not. Read from the ERC-1967 implementation slot and confirmed by each proxy's own
`implementation()`:

```
0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe   the fixed entry point
        │  implementation() and ERC-1967 slot agree
        ▼
0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1   a SECOND proxy: admin(), upgradeTo(address),
        │                                     renounceAdmin(), implementation()
        ▼
0x4A1817d13E9cF196f471725176355C1234b63C70   UniversalResolverV2, the implementation
```

| Proxy | `admin()` |
|---|---|
| `0xeEeEEEeE…eEeE` | `0x69420f05A11f617B4B74fFe2E04B2D300dFA556F` |
| `0x6d80f217…e6f1` | `0xffFffFFfFF52D316B7Bd028358089bc8066b8f80` |

**OBSERVED · DECODED.** This matters to a payment product: name resolution is the step that decides
which address a payer is shown, and it is upgradeable by two separate admins. UNICA cannot prevent
that. It can refuse to describe the trust assumption as one contract when it is three.

### 1.2 Enhanced Access Control

**DOCUMENTED-NOT-OBSERVED as a deployment.** EAC is not deployed at its own address; it is a base
contract inherited by both the registry and the resolver. What *is* observed is that both contracts
implement it: `roles`, `roleCount`, `hasRoles`, `hasRootRoles`, `hasAssignees`, `getAssigneeCount`,
`grantRoles`, `revokeRoles`, `grantRootRoles`, `revokeRootRoles` and `ROOT_RESOURCE()` are all
present as `PUSH4` dispatch constants in both runtimes, and six of them returned decoded values
during this survey.

`ROOT_RESOURCE()` was **asked of both contracts rather than assumed**, and both returned `0`.
**OBSERVED · DECODED**

---

## 2. The resource computation — the registry's and the resolver's are different

This is the question the survey existed to settle, and the answer is that the two contracts scope
permissions to differently-shaped ids derived from different inputs. **They are not
interchangeable.** Handing one to the other addresses a resource nobody holds a role at, and the
read comes back zero — which looks exactly like "this account has no authority", the safe-looking
answer, and the wrong one.

### 2.1 The Permissioned Registry

```
resource = (keccak256(bytes(label)) & ~uint256(type(uint32).max)) | eacVersionId
```

Derived from the **label alone**. The parent is not an input, because each registry instance already
*is* the parent. The low 32 bits carry `eacVersionId`; the upper 224 are the label hash.

**OBSERVED · REVERT_NAMED_IT**, three separate refusals, each `eth_call` from
`0x16425557dd73c259a1d8c0dfa0dd5a73bc940b31` (the deterministic unauthorized probe address derived
in `permissioned.mjs`), against `ETHRegistry`:

| Call | Revert | Resource named | Role bitmap named |
|---|---|---|---|
| `setResolver(tokenId, 0x…dEaD)` | `EACUnauthorizedAccountRoles` `0x4b27a133` | `0xcb0cbc84…37b800000000` | `1<<24` |
| `setSubregistry(tokenId, 0x…dEaD)` | same | same | `1<<20` |
| `renew(tokenId, 1999999999)` | same | same | `1<<16` |

For `label = "raffy"`: `keccak256("raffy")` is
`0xcb0cbc8493baf4a7b1972914ba0be89040e56e4a3c98d60268fe37b8c8e546d9`, and the resource the contract
named is the same word with its **low four bytes replaced by zero** —
hash `0xcb0cbc8493baf4a7b1972914ba0be89040e56e4a3c98d60268fe37b800000000`.

Confirmed two further ways, so it does not rest on the reverts alone:

- `ETHRegistry.getResource(tokenId)` returned exactly that word — the contract stating its own
  answer. **OBSERVED · DECODED**
- `register("unica-phase1-probe-4f7c", …)` returned the new token id
  hash `0x4e88d48a2f5c0a7e298842ddb901156d563b66a75240af30ea7c57f700000000`, while
  `keccak256("unica-phase1-probe-4f7c")` is
  hash `0x4e88d48a2f5c0a7e298842ddb901156d563b66a75240af30ea7c57f7800ed76c`. Same shape, a name that did
  not previously exist. **OBSERVED · ACCEPTED_IN_SIMULATION**

The registry canonicalises its argument: `getResource()` returned the same word whether it was given
the canonical id or the raw label hash, and `ownerOf()` answers only for the canonical id
(`ownerOf(rawLabelhash)` returned the zero address; `ownerOf(canonicalId)` returned
`0x51050ec0…Aeeee`).

**DOCUMENTED-NOT-OBSERVED:** every name reached in this survey has `eacVersionId = 0`, where the
resource and the token id coincide. `getResource(uint256)` and `getTokenId(uint256)` both exist and
both returned the same value here. Whether they diverge after a version bump was not observed.

### 2.2 The Permissioned Resolver

```
resource = keccak256(abi.encode(node, bytes32(0)))     — the NAME-LEVEL resource
```

Derived from the **namehash of the full name**. **OBSERVED · REVERT_NAMED_IT** — five setters, all
from the unauthorized probe address, against `raffy.eth`'s own resolver proxy
`0xc00E9189fe499b5F541932Ee57DA56B85Ac35eeE`:

| Call | Resource named | Role bitmap named |
|---|---|---|
| `setAddr(bytes32,address)` | `0x0bfdc7d1…4885e61` | `1<<0` |
| `setText(bytes32,string,string)` | **same** | `1<<4` |
| `setAddr(bytes32,uint256,bytes)` coinType 60 | **same** | `1<<0` |
| `setContenthash(bytes32,bytes)` | **same** | `1<<8` |
| `clearRecords(bytes32)` | **same** | `1<<32` |

`namehash("raffy.eth")` is
`0x9c8b7ac505c9f0161bbbd04437fce8c630a0886e1ffea00078e298f063a8a5df`; `keccak256(node ‖ bytes32(0))`
is the resource hash `0x0bfdc7d18a681d5f09834ebfaa1611fe18af3c4a6f4f1a276c3a0734c4885e61` — the word every one
of those five refusals named.

**The documentation implies finer resources and this deployment does not use them.** For
`setText` the documented derivation is `keccak256(node ‖ keccak256(bytes(key)))`, which for key
`"url"` is `0x481b09fc…560a0fde`. Nothing named it. For
`setAddr(bytes32,uint256,bytes)` the documented derivation is
`keccak256(node ‖ keccak256(abi.encode(coinType)))`, which for coin type 60 is
`0x06c018d0…7dff6a1d`. Nothing named that either. The three `authorize*` entry points behave the
same way — `authorizeTextRoles`, `authorizeAddrRoles` and `authorizeNameRoles` all refused against
the **name-level** resource.

Per-text-key and per-coin-type resources: **DOCUMENTED-NOT-OBSERVED**. They are recorded in the
profile as unconfirmed and are not used as a pin anywhere.

> **Consequence for the architecture.** UNICA wanted to grant the agent a resolver role scoped to
> one text key on one name. On this deployment that granularity is not available through anything
> observed: the smallest scope a refusal has ever named is the whole name. An agent granted
> `SET_TEXT` on `agent.treasury.merchant.<parent>` may rewrite **every** text record on that name.
> The mitigation is structural, not permission-based — put the agent on its own leaf name that holds
> nothing else worth protecting, which is what the four-level architecture already does.

### 2.3 `roles()` and `hasRoles()` do not answer the same question

The most dangerous read in this interface, and it fails in the unsafe direction. On `raffy.eth`'s
resolver, all three **OBSERVED · DECODED** in the same run:

```
roles(nameResource, owner)            -> 0
roleCount(nameResource)               -> 0
hasRoles(nameResource, 1<<0, owner)   -> true
roles(ROOT_RESOURCE, owner)           -> 0x1111…1111   (all 32 regular + all 32 admin roles)
```

Nobody holds anything **at** the name resource, and the owner may still write every record, because
a grant at `ROOT_RESOURCE` applies to every resource on that contract and `hasRoles` folds it in
while `roles` does not.

An integration that reads `roles(nameResource, account)`, sees zero, and concludes "this account
cannot edit the merchant's records" is wrong. **`hasRoles` — or `roles` at both the name resource
and `ROOT_RESOURCE` — is the only honest read.** The existing
`integrations/ensv2/permissioned.mjs` already reads both and ORs them; this survey confirms that was
necessary rather than cautious.

---

## 3. Role constants and the admin-role bit layout

**Layout.** A `uint256` bitmap. Roles are one **nybble** apart, not one bit, because a parallel
`_roleCount` word stores a 0–15 assignee counter in the same nybble position. Bits 0–127 are regular
roles (32 of them), bits 128–255 their admins. **The admin of a role sits exactly 128 bits above
it.**

The nybble layout is not taken on trust. On `ETHRegistry`, for `raffy`'s name resource:

```
roles(nameResource, owner)  -> 0x1110000000000000000000000000000101100000
roleCount(nameResource)     -> 0x1110000000000000000000000000000101100000
```

The two words are **identical**, which is what a per-nybble counter must produce when every held
role has exactly one holder. Cross-checked on the resolver, where two accounts hold everything:
`roles(ROOT, owner)` is `0x1111…1111` and `roleCount(ROOT)` is `0x2222…2222`. **OBSERVED · DECODED**

### Registry roles

| Role | Bit | How established |
|---|---|---|
| `ROLE_REGISTRAR` | `1<<0` | **OBSERVED · REVERT_NAMED_IT** — an unauthorised `register()` was refused with `EACUnauthorizedAccountRoles(ROOT_RESOURCE, 0x1, caller)`. Corroborated: `roles(ROOT, ETHRegistrar)` = `0x10001`. |
| `ROLE_REGISTER_RESERVED` | `1<<4` | DOCUMENTED-NOT-OBSERVED |
| `ROLE_SET_PARENT` | `1<<8` | DOCUMENTED-NOT-OBSERVED |
| `ROLE_UNREGISTER` | `1<<12` | DOCUMENTED-NOT-OBSERVED |
| `ROLE_RENEW` | `1<<16` | **OBSERVED · REVERT_NAMED_IT** — `renew()` refusal named `0x10000`; the same bit appears in `ETHRegistrar`'s root bitmap. |
| `ROLE_SET_SUBREGISTRY` | `1<<20` | **OBSERVED · REVERT_NAMED_IT** — `setSubregistry()` refusal named `0x100000`. |
| `ROLE_SET_RESOLVER` | `1<<24` | **OBSERVED · REVERT_NAMED_IT** — `setResolver()` refusal named `0x1000000`. |
| `ROLE_CAN_TRANSFER_ADMIN` | `(1<<28)<<128`, i.e. **bit 156** | **OBSERVED · DECODED** — `raffy.eth`'s owner holds bit 156 and does **not** hold bit 28. It is documented pre-shifted and must be written pre-shifted; unshifted it is a different permission. |
| *(unnamed)* | `1<<32` | **OBSERVED · DECODED** — held by `raffy.eth`'s owner at its name resource, and **absent from the documented role table**. Recorded as unnamed rather than guessed at, because a wrong name here becomes a wrong grant later. |
| `ROLE_SET_URI` | `1<<36` | DOCUMENTED-NOT-OBSERVED |
| `ROLE_UPGRADE` | `1<<124` | DOCUMENTED-NOT-OBSERVED |

`raffy.eth`'s owner (`0x51050ec063d393217B436747617aD1C2285Aeeee`) holds, at the name resource:
`1<<20 | 1<<24 | 1<<32 | ADMIN(1<<20) | ADMIN(1<<24) | ADMIN(1<<28)`.

### Resolver roles

| Role | Bit | How established |
|---|---|---|
| `SET_ADDR` | `1<<0` | **OBSERVED · REVERT_NAMED_IT** — named by both `setAddr` overloads |
| `SET_TEXT` | `1<<4` | **OBSERVED · REVERT_NAMED_IT** |
| `SET_CONTENTHASH` | `1<<8` | **OBSERVED · REVERT_NAMED_IT** |
| `SET_PUBKEY` | `1<<12` | DOCUMENTED-NOT-OBSERVED |
| `SET_ABI` | `1<<16` | DOCUMENTED-NOT-OBSERVED |
| `SET_INTERFACE` | `1<<20` | DOCUMENTED-NOT-OBSERVED |
| `SET_NAME` | `1<<24` | DOCUMENTED-NOT-OBSERVED |
| `SET_ALIAS` | `1<<28` | DOCUMENTED-NOT-OBSERVED |
| `CLEAR` | `1<<32` | **OBSERVED · REVERT_NAMED_IT** — `clearRecords()` named `0x100000000` |
| `SET_DATA` | `1<<36` | DOCUMENTED-NOT-OBSERVED |
| `UPGRADE` | `1<<124` | DOCUMENTED-NOT-OBSERVED |

### Errors

Each was seen in live revert data and then re-derived from its signature string. The derivation
reproducing the observed four bytes is what makes the name trustworthy; a name taken from a
signature directory and not re-derived would be a guess wearing a label.

| Signature | Selector | Where seen |
|---|---|---|
| `EACUnauthorizedAccountRoles(uint256,uint256,address)` | `0x4b27a133` | registry setters, `register()` |
| `EACCannotGrantRoles(uint256,uint256,address)` | `0xd1a3b355` | `grantRoles`, `authorize*` |
| `LabelAlreadyRegistered(string)` | `0xdef545a4` | `register()` on a taken label |
| `ResolverNotFound(bytes)` | `0x77209fe8` | resolution with no resolver up the chain |

---

## 4. Must individual-name admin roles be assigned during registration? — **YES**

This was flagged as the highest-risk unknown in the build, and it is settled, with the passing
control recorded beside the failing row in every case.

All rows are `eth_call` against `ETHRegistry` for `raffy`'s name resource, with
`grantee = 0x…dEaD`.

| # | Row | From | Outcome |
|---|---|---|---|
| A | **CONTROL** `grantRoles(nameResource, 1<<24, grantee)` | the name owner | **ACCEPTED**, returned `true` |
| B | **ROW** `grantRoles(nameResource, (1<<24)<<128, grantee)` | the same owner | **REFUSED** `EACCannotGrantRoles(nameResource, bit 152, owner)` |
| C | **CONTROL** `grantRoles(nameResource, 1<<24, grantee)` | the unauthorized probe | **REFUSED** `EACCannotGrantRoles(nameResource, 0x1000000, probe)` |
| D | **ROW** `register(freshLabel, owner, 0, 0, (1<<24)\|((1<<24)<<128), expiry)` | `ETHRegistrar` | **ACCEPTED**, returned the new token id |
| E | **ROW** `register(freshLabel, …, (1<<24)<<128, …)` admin-only bitmap | `ETHRegistrar` | **ACCEPTED** |
| F | **CONTROL** the same `register()` | the unauthorized probe | **REFUSED** `EACUnauthorizedAccountRoles(ROOT_RESOURCE, 0x1, probe)` |
| G | **CONTROL** `register("raffy", …)` | `ETHRegistrar` | **REFUSED** `LabelAlreadyRegistered("raffy")` |

**Row B is decisive, and the reason it is decisive is row A.** The owner *does* hold
`ADMIN(1<<24)` — that is why A is accepted. Holding it lets them grant the matching **regular**
role and nothing more. Granting the admin role itself would require the admin *of* an admin role,
and no such bit exists in a 256-bit map, so the refusal is structural and unfixable after the fact.

> ### The rule, and what it costs to get wrong
>
> **Admin roles on an individual name are settable only in the `roleBitmap` argument of
> `register(string,address,address,address,uint256,uint64)`. After registration, an admin-role
> holder may grant the matching regular role and nothing else.**
>
> If a merchant name is registered without the admin bits, the merchant can never afterwards
> delegate record-edit authority to an agent and never afterwards revoke one — and there is no
> repair, because recovering it means unregistering and losing the name. **The `roleBitmap` passed
> at registration is a one-shot decision and it must be got right the first time.** This is the
> single constraint that the merchant-registration owner action must not be allowed to skip.
>
> `register()` is `0x85f3e643`, **OBSERVED · PUSH4_IN_RUNTIME** and exercised in rows D–G.

---

## 5. Wildcard resolution — supported, and its failure shape does not revert

**OBSERVED · DECODED**, re-confirmed at re-read. Three names through the fixed entry point:

| Name | Result | What it means |
|---|---|---|
| `raffy.eth` | resolver `0xc00E9189…`, addr `0x51050ec0…` | registered, has an address record |
| `definitely-not-registered-9c4f.raffy.eth` | resolver `0xc00E9189…`, addr `0x0`, **no revert** | **unregistered and it still resolved** — the parent's resolver answered |
| `definitely-not-registered-9c4f.eth` | revert `ResolverNotFound(bytes)` `0x77209fe8` | no resolver anywhere up the chain |

Wildcard resolution from a parent works, and the UniversalResolver path **does** return for an
unregistered subname — it returns the **zero address** and does not revert.

> **A successful resolve is not evidence that a name is registered.** Only a non-zero address is
> evidence of anything. This is load-bearing for the architecture, because
> `agent.treasury.merchant.<parent>` will resolve from the moment the parent has a resolver — before
> anybody registers it, before anybody grants the agent anything. Any planner or checkout step that
> reads "it resolved" as "it exists" will hand `address(0)` onward. `web/ensv2/resolve.mjs` already
> classifies this as `ZERO_ADDRESS` rather than returning a bare address, and this survey is why
> that must stay.

---

## 6. The 15-accounts-per-role limit — the contract states its own cap

`getAssigneeCount(uint256 resource, uint256 roleBitmap)` is documented to return one `uint256`. **It
returns two.** An earlier pass in this repository printed the second word and deliberately declined
to interpret it. It is now interpreted: **it is the per-role maximum, packed in the same nybble
positions as the bitmap that was asked about.**

**OBSERVED · DECODED**, three calls, chosen so that both words move with the question:

| Contract | Call | Word 0 (counts) | Word 1 (maxima) |
|---|---|---|---|
| resolver | `getAssigneeCount(ROOT, 1<<0)` | `0x…02` — nybble 0 = 2 | `0x…0f` — nybble 0 = 15 |
| resolver | `getAssigneeCount(ROOT, 1<<4)` | `0x…20` — nybble 1 = 2 | `0x…f0` — nybble 1 = 15 |
| registry | `getAssigneeCount(ROOT, 1<<0 \| 1<<24)` | `0x…01` | `0x…0f00000f` — nybbles 0 **and** 6 = 15 |

Rows 1 and 2 differ only in which role was asked about, and **both** words moved with it. A
right-aligned scalar could not produce that, and neither could a constant. The cap is 15 — the
largest value a 4-bit nybble can hold — and it is reported by the deployed contract, so nothing
downstream needs to hard-code it.

**DOCUMENTED-NOT-OBSERVED: the error raised when the cap is exceeded.** Reaching it requires 15 real
grants, which requires broadcasting, which this work does not do. No candidate error selector
appears as a `PUSH4` constant in either runtime — and per the warning at the top, that absence is
not evidence. The documentation names no error either. See the open questions below.

---

## Interface additions found in the runtime

Present in the deployed runtimes and not currently listed in
`integrations/ensv2/permissioned.mjs`. **OBSERVED · PUSH4_IN_RUNTIME**, none of them exercised.

**Registry:** `getResource(uint256)`, `getTokenId(uint256)`, `getState(uint256)`,
`getStatus(uint256)`, `latestOwnerOf(uint256)`, `findTokenId(string)`, `findOwner(string)`,
`findExpiry(string)`, `getParent()`, `unregister(uint256)`, `setParent(address,string)`,
`setURI(string,address)`, `ROOT_RESOURCE()`. It is also an ERC-1155.

**Resolver:** `multicallWithNodeCheck(bytes32,bytes[])` — likely the right way to write several
records for one name in one transaction, and worth exercising before the planner emits N separate
calls — plus `authorizeDataRoles(bytes,string,address,bool)`, `setData(bytes32,string,bytes)`,
`data(bytes32,string)`, `supportsFeature(bytes4)`, `canUpgradeFrom(address)`,
`initialize(address,uint256,bytes[])`, `ROOT_RESOURCE()`.

A per-name resolver is a **77-byte proxy** (`0xc00E9189…`,
code hash `0x5219fb365f34c13998f30c716ab43bff12db97d46eedfbd9d0b3f8627aefd7c7`) whose ERC-1967 slot points at
`PermissionedResolverImpl`. **OBSERVED · DECODED**

---

## Open questions

Carried in `profile.mjs` as well as here, so anything consuming the profile can see the holes. An
empty list would be the suspicious result.

1. **Which second account holds every role at `ROOT_RESOURCE` on a per-name resolver proxy?**
   `roleCount(ROOT)` on `raffy.eth`'s resolver is `0x2222…22` — **two** assignees on all 64 roles.
   The name owner is one. `roles(ROOT, x)` returned `0` for `VerifiableFactory`, `ETHRegistrar`,
   `ETHRegistry` and `BatchRegistrar`, and the `eth_getLogs` scan for `EACRolesChanged`
   (topic `0x0d35bf721a39b614de00ca5038e1deb0cb0c69a278645e83405a7226cf80ba3c`) returned a truncated
   body from the endpoint. **There is a second full-authority account on a merchant's own resolver
   and this survey did not identify it.** That is a live question for a payment product and it
   should be answered before the merchant-onboarding action ships.

2. **What error is raised when a 16th account is granted the same role on the same resource?**
   The cap of 15 is confirmed; the enforcement path is not. See §6.

3. **Do `getResource(tokenId)` and `getTokenId(tokenId)` diverge once `eacVersionId` is non-zero?**
   Every name reached here has version 0, where they coincide.

4. **Does the resolver ever consult a per-text-key or per-coin-type resource?** Five setters and
   three `authorize*` functions all named the name-level resource. The finer derivations are
   documented and nothing observed has ever named one.

---

## Reproducing this

```sh
node script/ensv2/profile-check.mjs --self-test     # offline: 49 checks, 12 of them sabotage rows
node script/ensv2/profile-live.mjs                  # live re-read: 50 checks against Sepolia
```

The offline runner recomputes every derivation and compares every error selector against the four
bytes actually seen on the wire. Its `--self-test` mutates the profile one field at a time — a
resource off by one byte, a selector swapped for the other refusal's, `ROLE_CAN_TRANSFER_ADMIN`
written unshifted, the accepted control dropped from the admin-role rule, the open-questions list
emptied — and requires the suite to go red for each. It found a real defect on its first run: two
checks were reading the deployment table through the module's own `byName()` helper, which closes
over the pristine array, so they could not have failed. That is fixed and the mutation is caught.

The live runner fails closed on the wrong chain before anything else, prints only the **origin** of
the RPC endpoint (a provider URL carries its key in the path or query and this repository is
public), retries transport failures a bounded number of times, and reports a transport failure that
survives the retries as a **SKIP** — never as a contract failure and never as a pass. It prints the
retry count every run, including zero.

Both instruments were validated by sabotage: a code size moved by one byte and a pinned resource
moved by one byte each turned the relevant runner red, and `integrations/ensv2/profile.mjs` was
restored and confirmed identical by SHA-256
(`2e65f33977c03690bb3d0fb6e3f42e8ff8302b927e0f3b4e6326c6ad24c1ce39`).

## Sources

All ENS documentation is CC0-1.0. No ENS implementation source is copied into this repository;
signatures were read from the documentation, every selector was derived from its signature string,
and every claim was then checked against the deployed runtime.

- <https://docs.ens.domains/learn/deployments> — addresses
- <https://docs.ens.domains/ensv2/permissioned-registry> — registry roles, resource shape, register()
- <https://docs.ens.domains/ensv2/permissioned-resolver> — resolver roles, resource shapes
- <https://docs.ens.domains/ensv2/enhanced-access-control> — bitmap layout, admin shift, ROOT_RESOURCE, the 15 cap
- <https://docs.ens.domains/ensv2/universal-resolver-v2> — resolution entry point

Retrieved 2026-09-09.
