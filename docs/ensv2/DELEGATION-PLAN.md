# The ENSv2 delegation plan

How UNICA gives a merchant an ENSv2 identity, gives a delegated agent the narrowest authority
underneath it, and hands the whole thing to a human as transactions they can read before they sign.

Nothing in this repository signs or broadcasts any of it.

- Planner — [`script/ensv2/plan.mjs`](../../script/ensv2/plan.mjs)
- Role planner — [`integrations/ensv2/roles.mjs`](../../integrations/ensv2/roles.mjs)
- Owner preview — [`integrations/ensv2/plan-preview.mjs`](../../integrations/ensv2/plan-preview.mjs)
- Suite — [`integrations/ensv2/plan-test.mjs`](../../integrations/ensv2/plan-test.mjs) · 263 checks
- Sabotage — [`script/ensv2/plan-sabotage.mjs`](../../script/ensv2/plan-sabotage.mjs) · 19 mutations

```sh
node script/ensv2/plan.mjs --demo          # a complete plan with placeholder inputs
node integrations/ensv2/plan-test.mjs      # checks run: 263, passed: 263, failed: 0
node script/ensv2/plan-sabotage.mjs        # breaks every guard and requires the suite to notice
```

Everything here builds on [`DEPLOYMENT-PROFILE.md`](./DEPLOYMENT-PROFILE.md), which pins what a live
Sepolia read returned at block 11666085. No role bit, resource derivation or error selector in the
planner is written from memory; each is looked up in `profile.mjs`, and a role whose profile row is
only *documented* is refused rather than granted.

---

## The parent is an owner input, always

UNICA owns no ENSv2 Sepolia name. Every node, resource and token id below is computed from a parent
the owner chooses and controls, and the planner refuses to build anything without one. Two different
parents produce two entirely disjoint sets of nodes and resources, and the suite asserts exactly
that — it is the check that would go red if a name were ever hard-coded.

```
<owned-parent>                        owner controls ownership, resolver, subregistry
  merchant.<owned-parent>             merchant identity
    pay.merchant.<parent>             canonical PUBLIC settlement config
    treasury.merchant.<parent>        PUBLIC policy metadata only
      agent.treasury.merchant.<p>     the delegated agent's identity and public capabilities
```

`plan.ownerActions` returns the six things the owner must do that no tool here can do for them —
including confirming the parent's token id with `findTokenId(label)` rather than trusting the
planner's derivation, because whether `getResource` and `getTokenId` diverge at a non-zero
`eacVersionId` was left unresolved by the survey.

---

## The finding that shapes the whole design — REFUTED, and left standing

> **This section is wrong, and the fork says so.** It is kept in place with the measurement that
> refuted it, because deleting a claim a reader may have acted on hides that they were misled.
>
> `authorizeTextRoles(dns, key, account, true)`, executed against the deployed bytecode on a Sepolia
> fork pinned at block 11666085, emitted `EACRolesChanged` naming
> `keccak256(abi.encode(node, keccak256(bytes(key))))` — a **per-key** resource — and granted
> `SET_TEXT` there and nowhere else. The delegated account then wrote that key and was refused, with
> `EACUnauthorizedAccountRoles` (`0x4b27a133`), on a different key. `authorizeAddrRoles` behaves the
> same way per coin type. **Per-key scoping exists on this deployment.**
>
> The reason the section reads as it does is a measurement error of a specific and recognisable
> kind: it was drawn from REFUSALS only. A `setText` refusal names the resource the CALLER lacked —
> the name-level one — and says nothing about where an authorization writes. Executing the
> authorization settles it; reading the refusals never could.
>
> What survives is the *blanket* half: a NAME-LEVEL `SET_TEXT` grant does reach every text key on
> that name, confirmed on the same fork against four different keys. The mistake was believing that
> was the only shape available.
>
> Two further things followed, and they are why this section could not simply be patched in place:
> `grantRoles` — the call this plan used to be written around — is **REFUSED** by this deployment
> with `EACCannotGrantRoles` (`0xd1a3b355`), even from the name owner holding every role at
> `ROOT_RESOURCE`; and the call it accepts, `authorizeTextRoles`, appeared nowhere in the planner.
>
> **That rewrite has now landed, and this document is written around the new call.** Every claim in
> the banner above was re-established first-hand before anything was changed — the selector against
> the resolver's runtime dispatch table, the acceptance and the refusals by executing them on a
> pinned fork, each refusal with a passing control beside it. The plan below no longer contains a
> `grantRoles` step, and `screenAgentGrant` now **refuses** to build one, by name
> (`GRANT_ROLES_NOT_THE_DELEGATION_PATH`), so the mistake cannot come back by accident.
>
> Two figures in the original advisory did **not** survive re-measurement and are corrected here
> rather than quietly replaced: the delegation was priced at 45,181 gas and the revocation at
> 53,965. Executed, they are **89,280** and **41,622** — the grant is about twice the estimate
> because it writes two cold words, and the revocation is cheaper because clearing them earns a
> refund. Both were measured by running the calldata this repository's own encoder produces, which
> was first compared byte-for-byte against an independent encoder, and a one-byte corruption of it
> was rejected by the contract so the acceptance means something.
>
> See `docs/ensv2/MERCHANT-CONFIG.md` § "The finding this design is shaped by" for the full table of
> what was executed and what the chain did.

There is **one** resource formula on the resolver, and the scope is decided entirely by its second
input:

```
resource = keccak256(abi.encode(node, scopeHash))

  scopeHash = bytes32(0)                              the NAME level — every record on the name
  scopeHash = keccak256(bytes(key))                   ONE text key      (role SET_TEXT,  1<<4)
  scopeHash = keccak256(abi.encode(uint256(coin)))    ONE addr coin     (role SET_ADDR,  1<<0)
  scopeHash = keccak256(bytes(key))                   ONE data key      (role SET_DATA,  1<<36)
```

Every row was established by executing the matching `authorize*` call on a pinned fork and then
finding the granted bit at the resource the formula predicts. The addr row is spelled out because
the obvious guess for it is **wrong**: the coin type is hashed as an ABI word, not used as one.
Guessing it lands the grant at a resource nobody holds anything at — which reads back as "the agent
has no authority", the safe-looking answer and the wrong one. At coin type 0 the wrong formula also
collides with the name-level resource, which would silently widen the grant to the whole name.

So the separation is now **both** structural and permissional, and the two rings are independent:

- the agent is delegated at the resource of **one key** on a **leaf name that carries nothing anyone
  settles against** — proven by the agent writing its key and being refused on another key of the
  same name, with the other key reading back empty;
- and it holds nothing at all at the resources of `merchant.`, `pay.` or `treasury.`, which is why
  it cannot touch the payment recipient, the executor or the chain id.

**The blanket shape still exists, and the planner is what keeps it away.** `authorizeNameRoles`
takes a bitmap and writes it at the NAME level; an agent given `SET_TEXT` that way was observed
writing a key nobody had authorised. That call is refused by name
(`NAME_LEVEL_METHOD_FORBIDDEN`) before any argument is read. `DENIAL_MATRIX` in `roles.mjs` states
that remaining residual out loud, and the suite fails if it is ever quietly emptied.

---

## The ordered set

Ordinals are assigned once, after every step exists, and every dependency is checked by the preview
rather than trusted. Two modes, both parameterised on the parent:

| mode | subnames | transactions |
|---|---|---|
| `subtree` (default) | not registered — the merchant's resolver answers for the whole subtree by wildcard | 15 |
| `subregistry` | each level registered in its own `PermissionedRegistry`, supplied by the owner | 20 |

1. **`setSubregistry`** on the parent, so labels can exist under it.
2. **`register(merchantLabel, …)`** — ownership, and every admin role the merchant will ever hold.
3. **`setResolver`** — the Permissioned Resolver, in its own reviewable transaction.
4. **subnames** — registered (`subregistry` mode) or, in `subtree` mode, relying on the fact that
   the resolver accepts a write at an **unregistered** subname's node. That is no longer an open
   question: executed on the fork, a `setText` at `pay.merchant.raffy.eth` — a name nobody
   registered — was accepted from the parent's owner and read back, and a delegation at an
   unregistered subname was accepted too. The corollary is a trap worth stating plainly: because
   wildcard resolution answers for unregistered subnames as well, **a successful resolve is not
   evidence that a name is registered**, and nothing in this plan may treat it as such.
5. **the merchant's records** on `pay.` and `treasury.` — protected; the agent gets nothing here.
6. **the agent's metadata** on the leaf, written by the merchant *while the agent still holds nothing*.
7. **`authorizeTextRoles(dnsName, key, agent, true)`** — the delegation. One key, one account, on
   one leaf. Not `grantRoles`: this deployment refuses that call even from the name owner.
8. **verify resolution** — the payer's reading is the one the merchant wrote.
9. **verify the refusal** — three simulated writes from the agent that must revert, and one that must
   be **accepted**. Without that fourth row, the three refusals would prove only that the agent's
   address is broken.
10. **the revocation** — `authorizeTextRoles(dnsName, key, agent, false)`, the same function with
    the flag flipped, built at the same moment as the grant and held until needed. On this
    deployment the undo is the same call, which is a small mercy: there is no second permission to
    have forgotten to arrange.

### Step 2 is the one that cannot be undone

Phase 1 observed, with its passing control beside its failing row, that `grantRoles` **refuses** an
admin bit after registration — `EACCannotGrantRoles` — because granting an admin role would require
the admin *of* an admin role, and no such bit exists in 256 bits. The `roleBitmap` argument of
`register()` is the only chance, and the only repair is losing the name.

The planner therefore sets only bits this deployment **named back**: `RENEW`, `SET_SUBREGISTRY`,
`SET_RESOLVER`, each with its own admin, plus the already-shifted `CAN_TRANSFER_ADMIN`. The bits it
is permanently *not* setting are printed in `plan.permanentOmissions` rather than buried — including
`UNNAMED_BIT_32`, a bit the chain uses that no documentation names, which is not granted because a
bit whose meaning is unknown is a permission nobody chose.

The step is marked `irreversible: true` with a reason and a mitigation, and the preview refuses to
call any plan signable if an admin bit appears on any step other than a `register()`.

---

## The role planner refuses; it does not merely avoid

`screenAgentGrant` runs on every agent-facing call this repository produces — including inside the
constructors, on their own output — and `screenPlanForAgentAuthority` runs again over the assembled
plan, catching steps these files did not build.

| the agent must be unable to | how it is denied | named refusal |
|---|---|---|
| transfer the name | no role at any registry; the whole upper 128 bits rejected | `REGISTRY_TARGET_FORBIDDEN` |
| change owner | ownership lives in a registry token no agent call touches | `REGISTRY_TARGET_FORBIDDEN` |
| set resolver | `1<<24` is a **registry** role, not in the resolver allowlist | `REGISTRY_TARGET_FORBIDDEN` |
| set subregistry | `1<<20` is a registry role | `REGISTRY_TARGET_FORBIDDEN` |
| register siblings | `ROLE_REGISTRAR` is held at the registry's `ROOT_RESOURCE` | `ROOT_RESOURCE_FORBIDDEN` |
| renew or unregister | registry roles | `REGISTRY_TARGET_FORBIDDEN` |
| change the payment recipient | `pay.`'s resource is protected | `PROTECTED_RESOURCE` |
| change the executor | text record on `pay.` | `PROTECTED_RESOURCE` |
| change the chain id | text record on `pay.` | `PROTECTED_RESOURCE` |
| administer roles | any bit ≥ 128 refused outright | `ADMIN_ROLE_FORBIDDEN` |
| grant roles to itself or anyone | holds no admin role; `EACCannotGrantRoles` observed | `ADMIN_ROLE_FORBIDDEN` |
| write arbitrary text keys on a name the merchant relies on | those resources are protected — **but see the residual above** | `PROTECTED_RESOURCE` |
| obtain root roles | refused by method name, by resource value, and by precondition | `ROOT_RESOURCE_FORBIDDEN` |

Every row is exercised: the suite constructs the exact call that would confer the capability and
requires the named refusal.

Three further properties, each with a sabotage row:

- **The resource is derived, never accepted.** Pass a `resource` in the options and it is ignored;
  the grant is built at `resolverNameResource(namehash(agentLeaf))` and nowhere else.
- **The 15-account cap is read from the contract's own second word.** `getAssigneeCount` returns
  counts *and* maxima, packed one nybble per role in the same positions as the bitmap asked about. A
  reading taken for a different role does not satisfy the grant, and a missing reading is a refusal —
  unchecked is not the same as satisfied.
- **`agent_root_roles == 0` is a hard precondition on the whole plan.** Not a warning. Absent, the
  plan is `PRECONDITION_UNMET`; non-zero, the grant is refused outright. Phase 1 measured why this
  matters: on a live resolver, `roles(nameResource, owner)` read `0` while
  `hasRoles(nameResource, …, owner)` read **true**, because a `ROOT_RESOURCE` grant applies
  everywhere and `roles()` does not report it.

---

## The owner preview

One row per step, with the same seventeen fields on every row — ordinal, dependency, chain, target
and *that contract's provenance*, method, decoded arguments, affected name / namehash / resource,
roles granted or revoked, **whether any admin role is involved**, **whether ROOT_RESOURCE is
involved**, value, gas, expected event, expected post-state, rollback, and evidence label.

The two flags are printed on every row including the rows where they are false, and they are
**recomputed from the calldata's own arguments**, not copied from what the step claims about itself.
A step asserting `involvesAdminRole: false` while carrying an admin bit is overruled, and the suite
proves it.

Target provenance has three answers, not two: `PINNED` (read back from Sepolia and carrying the code
size and hash the survey recorded), `DISCOVERED` (the merchant's own resolver, an owner-deployed
subregistry — real contracts this repository has never surveyed), and `UNKNOWN`, which says to check
it yourself before signing.

Role bitmaps are named against the table belonging to the **target contract**, chosen from the target
address rather than from a label on the step. `1<<24` is `SET_RESOLVER` on a registry and `SET_NAME`
on a resolver; a preview that picks the wrong table prints a fluent, readable, entirely wrong list of
permissions for the one transaction that cannot be undone. Forcing every row onto the resolver table
is one of the sabotage rows.

### Batching

`multicallWithNodeCheck(bytes32,bytes[])` is available with `--batch` and is **off by default**. The
node argument is why it is the right primitive: the batch names the one node every inner call must be
for. Two rules are enforced rather than recommended — every inner call is decoded individually into
its own row, and **no role change may ever ride inside a batch**. Its selector is a PUSH4 dispatch
constant in the deployed resolver runtime, which proves the function exists and nothing about what it
does, so the step carries the weaker evidence label and the unbatched form stays the default.

### Gas is an input, and a missing estimate blocks the signature

Every name in the plan is unregistered today, so an `eth_estimateGas` taken now would fail for
reasons that have nothing to do with the transaction. Estimates are handed in with
`--gas 1=52000,2=190000`; there is deliberately no flag that fills them all in with a plausible
number. Until they are supplied, every transaction row says `NOT_ESTIMATED` and the plan is not
signable.

The prepared revocation is the one exception, and it gets its own word — `NOT_YET_ESTIMABLE` —
because it undoes a grant that does not exist yet. It is checked as hard as any other transaction in
every other respect, and **a plan with no prepared revocation is never signable.**

---

## Nothing secret reaches the chain

The treasury publishes a **commitment**, never a value:

```
keccak256(utf8("UNICA:ensv2-policy:v1|" ‖ chainId ‖ "|" ‖ merchantNode ‖ "|"
               ‖ thresholdWei ‖ "|" ‖ allocationBps ‖ "|" ‖ reserveWei ‖ "|" ‖ salt))
```

`commitPolicy` returns only the digest and the scheme string, and refuses to commit over a missing
field — a commitment over a missing field commits to nothing. The scheme is published beside the
digest so a checker knows how to reproduce it; the values and the salt stay with the merchant and are
shown directly to whoever must verify them.

The suite feeds real threshold, allocation, reserve and salt values into the planner and then scans
the entire serialised plan, its preview, and its rendered text for each of them in both decimal and
hex. A control row proves the scanner can find something that *is* present, and a sabotage row
publishes the raw threshold and requires the suite to go red.

Text record keys come from a closed vocabulary (`RECORD_KEYS`), and the suite asserts every key the
plan writes is in it — the only way to keep "nothing secret is published" checkable is to keep the
set of published things small enough to read.

---

## What was open and is now SETTLED

Three items below were carried as unknowns. A Sepolia fork pinned at block 11666085, against the
live resolver proxy `0xc00E9189…35eeE`, closed them. They are recorded here rather than deleted,
because a reader who once relied on the open version needs to see what replaced it.

### SETTLED — the resolver DOES accept a write at an unregistered subname's name-level resource

> Was: "*Phase 1 confirmed that an unregistered subname still resolves … It did **not** confirm that
> the resolver accepts a write at such a name's resource.*"

`setText` at `pay.merchant.raffy.eth` — a name nobody has registered — sent from `raffy.eth`'s owner
was **ACCEPTED**, and the value read back through `text(bytes32,string)` at the same node. The
name-level resource involved is `keccak256(node ‖ bytes32(0))` = `0x94691a03…54da`, derived from the
namehash of a name with no registration behind it. `subtree` mode's premise holds.

Step 4 keeps its simulation. A property that holds for one parent's resolver is not a property of
every parent's resolver, and the plan is built for a parent the owner supplies, not for `raffy.eth`.

### SETTLED — wildcard resolution returns for unregistered subnames, so a resolve is NOT evidence of registration

> Was: carried alongside the item above as a premise about resolution only.

Three names, one resolver, at the pinned block:

| name | result |
|---|---|
| `raffy.eth` | RESOLVED, `addr 0x51050ec0…Aeeee` |
| `definitely-not-registered-9c4f.raffy.eth` | RESOLVED, `addr 0x0` — no revert |
| `pay.merchant.raffy.eth` | RESOLVED, `addr 0x0` — no revert |

**Where this matters, concretely.** Any check that reads "the name resolved, therefore the name
exists" is a defect on this deployment, and it is a defect in the unsafe direction: it reports a
name as registered when nobody owns it, and an owner acting on that answer would be configuring
settlement on a name a stranger can still register. Two consequences are already load-bearing here:

- **`merchant-config.mjs` reads the pay name's `addr` and keeps it as one input to a judgement
  rather than as a result** — its comment calls this "the wildcard trap" by name. That is the
  correct handling and this measurement is its evidence.
- **`plan.mjs` step 4 must not be satisfied by a successful resolve.** Registration is established
  by the registry, or it is not established. A resolve that returns is compatible with both.

A zero address from a wildcard and a zero address from a real name with no record set are the same
bytes. Nothing downstream may distinguish them by resolution alone.

### SETTLED — `EACRolesChanged` has now been observed, and its derived topic is correct

> Was: "*No `EACRolesChanged` event has ever been seen. The topic is derived from its signature
> string; Phase 1's log scan for it did not complete.*"

`authorizeTextRoles(dns("raffy.eth"), "unica.treasury.status", agent, true)` emitted it. Topic 0 was
`0x0d35bf72…ba3c` — byte-for-byte the topic this repository derives from
`EACRolesChanged(uint256,address,uint256,uint256)`, so the derivation was right. Topic 1 carried the
resource, topic 2 the account, and the data the old and new bitmaps (`0` → `0x10`).

The record-writing steps still promise a read-back rather than a log. One observed event on one
resolver is not a guarantee about every setter's emissions, and a read-back is evidence of the state
that matters rather than of the notification about it.

---

## What this does not know

Honest gaps, carried in the code as evidence labels and repeated here:

- ~~**The resolver grant itself has never been exercised.**~~ **SETTLED.** It has now been executed
  against the deployed bytecode on a pinned fork, using the calldata this repository emits:
  `authorizeTextRoles` accepted from the name owner, the granted bit found at the per-key resource,
  the agent's write on that key accepted and its write on another key refused. The precondition
  `merchantMayGrantAtAgentResource` is kept anyway — a fork is not the merchant's own name, and the
  merchant's authority on their own resolver is still theirs to demonstrate.
- ~~**No revocation has been exercised on this deployment.**~~ **SETTLED.** The revocation was
  executed too: accepted, the role word back to zero, and the agent's next write on that key
  refused. Revocation is the half that usually goes untested because nothing breaks when it is
  missing until the day it is needed.
- **What a delegation needs from the SENDER is now known, and it is not obvious.**
  `authorizeTextRoles` requires `adminRole(SET_TEXT)` — `1 << 132`. A holder of the plain
  `SET_TEXT` bit is **refused**, while that same account's own `setText` is accepted, which is the
  control that makes the refusal about the admin bit rather than about the account. This is why the
  `register()` bitmap below is load-bearing rather than merely tidy.
- **A second full-authority account exists on a per-name resolver and was not identified.**
  `roleCount(ROOT_RESOURCE)` on a live resolver proxy returned two assignees on all 64 roles. The
  owner is one of them. This plan does not change that and cannot.
- **The 16th-assignee error is unknown.** The cap of 15 is confirmed; the enforcement path is not,
  because reaching it needs fifteen real grants.

---

## The instruments

`node script/ensv2/plan-sabotage.mjs` breaks nineteen guards one at a time and requires the suite to
notice each. It copies the originals out first, restores in a `finally`, and ends by re-hashing every
file against the hash taken before the first mutation — a restore that is asserted rather than
verified is not a restore.

A mutation whose search string does not match is reported as a **failure of the runner**, not as "not
caught": a find-and-replace that quietly matches nothing leaves a working file behind, and recording
that as a gap in the suite would be exactly backwards.

One mutation is recorded as `expectCaught: false` — deleting the plan builder's second pass over its
own screen. Both constructors already refuse before such a step can exist, so no input the builder
accepts can distinguish the broken version. That is a claim about the code, and the runner checks it:
if the row ever flips to caught, the builder has started emitting a role change it does not screen at
construction.

Four real defects were found this way and are fixed:

1. The assignee cap read the maxima word right-aligned, so a `SET_TEXT` grant (nybble 1) was compared
   against nybble 0's maximum — caught by the *control* that a good grant passes, not by any row
   asserting a bad one fails.
2. The preview named registry bitmaps with the resolver's role table.
3. The plan-level status was being overwritten by the role planner's own status, so a caller
   switching on `PLAN_STATUS` matched nothing.
4. The register-bitmap assertion checked only that *some* admin bit was set;
   `CAN_TRANSFER_ADMIN` alone kept it green while every per-role admin was missing.
