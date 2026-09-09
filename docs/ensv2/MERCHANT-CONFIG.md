# UNICA MerchantConfig on ENSv2 — the records, the read path, and what makes ENS load-bearing

> Read `docs/ensv2/DEPLOYMENT-PROFILE.md` first. Everything here is built on the numbers that
> survey read off the chain, and one of its findings decides this design's whole shape.

This document describes three ENSv2 text records, the client that reads them, and the validator
that decides whether UNICA will settle against what it read. It also says, in each section, which
claims came off the chain and which are this repository's own choices.

## The finding this design is shaped by — and the half of it that was wrong

### What this document used to say, corrected in place

> The Phase 1 survey established, from five separate live refusals on a real per-name Permissioned
> Resolver, that **this deployment scopes every resolver write to the NAME-LEVEL resource**
> `keccak256(node ‖ bytes32(0))` — including `setText` and `setAddr(bytes32,uint256,bytes)`, where the
> published documentation leads you to expect a per-key or per-coin-type resource. Nothing observed on
> this deployment has ever named a finer one.
>
> The consequence is not academic. **An agent granted `SET_TEXT` anywhere may rewrite every text record
> on that name.** There is no permission narrow enough to say "this agent may write the treasury key
> and not the pay key". So the mitigation cannot be a permission — it has to be structure.

The block above is left standing because this repository corrects a refuted claim with the
measurement that refuted it rather than deleting it. **The chain refutes its second paragraph.**

### The measurement

Sepolia fork pinned at block 11666085, against the live resolver proxy `0xc00E9189…35eeE` — the same
deployment and the same block the rest of this document is built on.

| what was executed | what the chain did |
|---|---|
| `authorizeTextRoles(dns("raffy.eth"), "unica.treasury.status", agent, true)` from the name owner | ACCEPTED. `EACRolesChanged` named resource `0xbea6aab7…c175`, which is `keccak256(node ‖ keccak256("unica.treasury.status"))` — a **per-key** resource — and granted `SET_TEXT` (`0x10`) there |
| `roles(nameLevelResource, agent)` after that grant | `0` — the name-level resource was never touched |
| `roles(ROOT_RESOURCE, agent)` after that grant | `0` |
| the agent's `setText` on **that** key | ACCEPTED, value read back |
| the agent's `setText` on a **different** key | REFUSED — `EACUnauthorizedAccountRoles` (`0x4b27a133`) |
| the agent's `setAddr` | REFUSED — `EACUnauthorizedAccountRoles` |
| `grantRoles(nameLevelResource, SET_TEXT, agent)` from the same name owner | REFUSED — `EACCannotGrantRoles` (`0xd1a3b355`) |

`authorizeAddrRoles(dns, coinType, …)` is the same story at `keccak256(node ‖ keccak256(uint256
coinType))`, and `authorizeNameRoles(dns, bitmap, …)` is the name-level one.

### What is true now

**Per-key scoping IS available on this deployment**, through `authorizeTextRoles`. The blanket
exposure the old paragraph described is a property of a **name-level** grant, not of `SET_TEXT` as
such: on the same fork, an account holding `SET_TEXT` at `keccak256(node ‖ bytes32(0))` wrote
`unica.pay`, `unica.treasury`, `avatar` and an arbitrary key — four for four. So

- **name-level `SET_TEXT` → every text record on that name.** The old claim, still true, of that shape.
- **per-key `SET_TEXT` → exactly one key.** Refuses every other key and every other record type.

The old claim's mistake was believing this deployment offered only the first shape. It offers both,
and the shape it offers for `grantRoles` — the call the delegation planner was written around — is
**refused**.

### Why the structure survives the correction

Per-key scoping protects a key; it does not protect a name from a delegation someone makes later.
The settlement configuration is worth keeping on a name the agent has no authority over at all, so
the mitigation stays structural.

That is why `pay` and `treasury` are sibling names rather than two keys on one name:

```
<parent>                              an owner input — UNICA owns no ENSv2 name and hard-codes none
  <merchant>.<parent>                 merchant identity, never derived from the agent
    pay.<merchant>.<parent>           canonical PUBLIC settlement config     ← the protected one
    treasury.<merchant>.<parent>      PUBLIC policy metadata only
      agent.treasury.<merchant>.<p>   the delegated agent's public capabilities
```

The agent is delegated on `treasury`, and the settlement configuration lives on a name it has no
authority over at all. The validator's most important check is therefore not "is the agent's bitmap
small" but **"does the agent have ANY authority over the name carrying the recipient"**.

## The three records

One text record per name. `integrations/ensv2/records.mjs`.

| key | on | carries |
|---|---|---|
| `unica.pay` | `pay.<merchant>.<parent>` | chain id, settlement executor, merchant recipient, settlement token, a salted configuration commitment, expiry, optional evidence URL + content hash |
| `unica.treasury` | `treasury.<merchant>.<parent>` | workflow version, a salted policy commitment, permitted action schema, public status, expiry, circuit-breaker state |
| `unica.agent` | `agent.treasury.<merchant>.<parent>` | agent address, workflow identity and version, the public record keys it may write, expiry, revocation status |

### The encoding is strict, positional, and unescaped — on purpose

```
unica.pay|1|11155111|0x…executor|0x…recipient|0x…token|0x…commitment|1800086400|-|-
```

A pipe-separated sequence with a fixed field count per schema. A field that would contain the
separator is **refused at encode time rather than escaped**, because escaping is where two strings
start to mean the same thing — and two strings meaning the same thing is exactly what breaks a
commitment. `-` marks a field that is present and deliberately empty, so an absent optional field is
still a position: dropping it would shift every field after it, and a shifted positional record
decodes to a different meaning rather than to an error.

**The decoder re-encodes and demands the bytes back.** A value that decodes but does not round-trip
is `NON_CANONICAL_ENCODING`, not a warning. Today no shipped field type reaches that branch, because
every `parse` is strict enough to refuse a non-canonical spelling with a better, nameable error —
so `records-test.mjs` installs a temporary schema whose parse and format deliberately disagree and
requires the backstop to fire, then removes it. A backstop nobody has ever seen fire is
indistinguishable from one that cannot.

**A refusal carries no partial record.** Every failure returns `{ok:false, status, …}` with no
`record` field at all, so `if (r.record) use(r.record)` cannot turn a malformed blob into a payment
instruction.

### ENS stores nothing secret, and there is an instrument that proves it

No threshold, allocation, reserve value, credential or secret policy input goes into a record — only
a **commitment** to them. `assertNoSecrets(text, secrets)` scans a record for every spelling a value
plausibly takes on the way in: decimal, hex, `0x`-prefixed, 32-byte padded, and the bare keccak of
the value. It is exported rather than kept in the test, because a planner should run it before it
writes.

**A commitment without a salt is not hiding anything.** `keccak256("1000000000")` is a public value
with an extra step; anybody can enumerate every round number a merchant might have picked. So
`commitPrivate` **refuses** to build a commitment without at least 32 bytes of salt, refuses an
all-zero salt, and mixes a domain tag in so a config commitment cannot be replayed as a policy
commitment. The salt never goes into a record.

## The read path

`integrations/ensv2/read-live.mjs`. Every record comes off the real UniversalResolver on Sepolia or
it does not come at all.

**There is no fixture fallback in live mode, and that is a shape rather than a discipline.**
`createLiveReader` takes an endpoint and nothing else. It has no parameter that can carry a
transport, a stub, a cache, a record or a default answer — an unrecognised option is a thrown error
rather than an ignored key. Tests read through `createReaderOverTransport`, a separate factory named
for what it is, and everything it returns is stamped `INJECTED_TRANSPORT`. That stamp is a literal
inside each factory, never read from the options, so an offline reader cannot claim to be a live
one; `assertLiveEvidence` and the preflight's `requireLive` refuse anything that is not `LIVE_RPC`.

The claim is checked structurally as well as behaviourally: `merchant-config-test.mjs` walks the
live module's transitive import closure and requires that no file in it lives under a `fixtures`
directory — and then proves that scanner would notice one if it were there.

**Every call resolves again.** There is no cache. A merchant's records are mutable state, and a
checkout that reuses a resolution from ninety seconds ago is quoting a name that may already point
somewhere else. The reader exposes its request and resolution counts so "no cache" is a measured
row rather than an assertion.

**Zero bytes is not an empty string.** Measured live on 2026-09-09: asking `raffy.eth` for a text key
it does not publish returns a properly ABI-encoded empty string (offset `0x20`, length `0`) — the
resolver answers. Zero bytes back means something else entirely: a selector that reached no dispatch
arm, or an address with no code. Reporting that as "the merchant publishes nothing" would turn "we
could not ask" into a fact about the merchant, so the two are separate observations.

## The preflight

`integrations/ensv2/merchant-config.mjs`. Ordered so no check ever runs on input an earlier check has
not established, and so the first refusal is the most fundamental one.

| refusal | fires when |
|---|---|
| `PARENT_REQUIRED` | no parent supplied — a required owner action, never a default |
| `MERCHANT_LABEL_REQUIRED` · `NAME_REFUSED` | the request cannot be turned into names |
| `NO_RESOLUTION` | ENS resolution is absent from the evidence |
| `NO_AUTHORIZATION_READ` | the Enhanced Access Control read is absent |
| `NOT_LIVE_EVIDENCE` | a live answer was required and this was not one |
| `RPC_FAILURE` | any read failed, **including an incomplete duplicate scan** |
| `WRONG_CHAIN` | the endpoint answered for another chain |
| `OFF_PROFILE_ENTRY_POINT` | resolution went through an unverified entry point, or its runtime changed size |
| `DEPLOYMENT_UNVERIFIED` | a verified deployment was required and nobody re-read one |
| `OFF_PROFILE_REGISTRY` | the parent is under a TLD this repository has not surveyed |
| `NO_RESOLVER` · `RESOLVER_HAS_NO_CODE` · `OFF_PROFILE_RESOLVER_IMPL` | the resolver is missing, empty, or runs unverified code |
| `WILDCARD_UNREGISTERED` | the name resolved, answered, and published nothing — the trap that does not revert |
| `RECORD_MISSING` · `MALFORMED_RECORD` · `SCHEMA_VERSION_UNSUPPORTED` | nothing usable under the pay key |
| `AMBIGUOUS_DUPLICATE_RECORDS` | a settlement configuration appears on a second name |
| `RECORD_CHAIN_MISMATCH` · `ZERO_EXECUTOR` · `ZERO_RECIPIENT` · `UNSUPPORTED_TOKEN` · `EXPIRED` | the published values are not settleable |
| `COMMITMENT_MISMATCH` | the published commitment does not open to the inputs supplied |
| `AGENT_RECORD_REVOKED` | the delegation is published as revoked |
| `AUTHORITY_UNKNOWN` | who may edit could not be read — unknown authority is not acceptable authority |
| `AUTHORITY_READ_DISAGREES` | `roles()` and `hasRoles()` answered differently about one account |
| `AGENT_HOLDS_ROOT_RESOURCE` | contract-wide authority; never a valid UNICA delegation |
| `PROTECTED_FIELD_UNDER_AGENT_CONTROL` | the agent can rewrite the settlement configuration |

Every one of them has a passing control beside it in `merchant-config-test.mjs`: one world that is
ACCEPTED, then exactly one thing broken per row. A refusal with no control could be firing for a
reason nobody has looked at.

### Reading authority honestly

Phase 1 found that `roles(resource, account)` and `hasRoles(resource, bitmap, account)` do not answer
the same question, and **the difference fails unsafe**: on `raffy.eth`'s resolver,
`roles(nameResource, owner)` is `0` while `hasRoles(nameResource, 1<<0, owner)` is `true`, because a
`ROOT_RESOURCE` grant applies everywhere and `roles` does not report it. An integration reading
`roles` alone concludes "this account cannot edit the merchant's records" and is wrong.

So the validator judges a **union**, and asks `hasRoles` as corroboration. If the two disagree, the
union is still missing something and **neither is relied on** — `AUTHORITY_READ_DISAGREES`.

#### It used to read two resources, and that was CRITICAL 2

> "So the validator judges the **union** of `roles(payResource, agent)` and
> `roles(ROOT_RESOURCE, agent)`, and asks one `hasRoles` as corroboration."

Both of those resources are `0` for an agent delegated with `authorizeTextRoles` — measured, above.
The validator reported *no agent authority* about an agent that could write the settlement
configuration. It failed **unsafe**, which is the opposite of this project's rule.

The read now asks **four** resources, because the deployment has four:

| scope | resource | what a role there reaches |
|---|---|---|
| `NAME` | `keccak256(payNode ‖ bytes32(0))` | every record on the pay name |
| `ROOT` | `0` | every record on every name this resolver serves |
| `PAY_TEXT_KEY` | `keccak256(payNode ‖ keccak256("unica.pay"))` | the text key carrying the settlement configuration |
| `PAY_ADDR_COIN` | `keccak256(payNode ‖ keccak256(uint256(60)))` | the addr record `readAddr` asks for |

The implementation's dispatch table carries **no read dedicated to an `authorize*` grant** — the only
role reads it exposes are `roles`, `hasRoles`, `hasRootRoles`, `roleCount`, `hasAssignees` and
`getAssigneeCount`. So the read that sees a per-key delegation is the ordinary `roles(uint256,address)`
asked at the derived resource, and that is what the validator does.

Two more measurements shape how the corroboration is judged, and both were taken rather than assumed:

- `hasRoles(resource, bit, account)` answers about `roles(resource) | roles(ROOT_RESOURCE)`. The
  root-holding account reads `roles(textResource) = 0` and `hasRoles(textResource, SET_TEXT) = true`.
  So the honest comparison is against `scope | root`; comparing against the scope alone would report
  `AUTHORITY_READ_DISAGREES` for every root holder — a true refusal reached by a false reason, and it
  would mask `AGENT_HOLDS_ROOT_RESOURCE`, the precise one.
- A per-key resource does **not** inherit a name-level grant in EAC. An account holding `SET_TEXT` at
  the name level reads `roles = 0` and `hasRoles = false` at the per-key resource; the widening
  happens inside the resolver's own setter. That is why all four scopes are read separately rather
  than one being derived from another.

#### It fails closed at every exit

A missing chain view, a missing resolver, a missing pay node, a probe that reverts, an endpoint that
drops the body, a return the decoder refuses — each is a named status the preflight turns into a
refusal. None returns a zero bitmap, because a comfortable zero is exactly how CRITICAL 2 read as
safe. `merchant-config-test.mjs` proves it as a pair: the same delegation, seen (`REFUSED —
PROTECTED_FIELD_UNDER_AGENT_CONTROL`) and then with only that scope's read made to fail (`REFUSED —
AUTHORITY_UNKNOWN`), with a row asserting the two statuses differ so an "everything refuses"
regression cannot pass as fail-closed behaviour.

#### What it does not claim

Four scopes are not all the scopes. A per-key grant on some other text key, or a per-coin grant on
some other coin type, is not read — this deployment offers no way to enumerate the resources an
account holds roles at. Such a grant is authority over a record UNICA does not settle against, so
this is a boundary rather than a gap, and the result carries `exhaustive: false` and a
`notEnumerable` note so no reader mistakes one for the other.

The mask it judges against includes every documented resolver role and each one's admin half, not
only the four the chain has named back. The asymmetry is deliberate: including an unconfirmed bit can
only make this refuse a configuration it might have accepted, and refusing too much is the safe
direction. Nothing here treats an unconfirmed bit as evidence that an agent is harmless.

The address the check is **about** comes from the published agent record, not from the caller. A
caller who could name the address could point the check at an innocent one.

## The binding

An accepted configuration is bound to the exact reading that produced it: the name, its namehash, the
chain, the registry, the resolver and its implementation, the entry point, the three name-level
resources, the recipient, executor, token, commitment and expiry, the block, a digest of each record
**as served**, and the agent address. One word over all of it — `resolutionCommitment`.

Twenty fields, and `merchant-config-test.mjs` walks every one and requires it to move the word. A
field that is in the binding but not in the hash reads as bound and is not, and that walk is what
finds it. The record digests bind the bytes to the name and key they were served under, so a record
lifted onto another merchant's name does not produce the same digest.

## ENS is load-bearing, and that is tested rather than asserted

Three rows in `merchant-config-test.mjs` remove ENS from the evidence and require UNICA to **refuse**:

- resolution removed → `NO_RESOLUTION`
- the Enhanced Access Control read removed → `NO_AUTHORIZATION_READ`
- the record reads removed → `NO_RESOLUTION`

If any of them were accepted, ENS would be decoration and those rows are the thing that would say so.

## Running it

```sh
node integrations/ensv2/records-test.mjs --self-test          # 128 checks, 0 failed
node integrations/ensv2/merchant-config-test.mjs --self-test  # 141 checks, 0 failed
node script/ensv2/merchant-config-live.mjs                    # 17 checks, 0 failed, 0 skipped
```

The two offline suites are hermetic — no network, so they mean something in a gate on a machine with
no endpoint. Both carry `--self-test`, which replaces one function at a time with a version that has
the defect the suite claims to catch and requires the suite to go RED for each.

## What this cannot show

- **No live ACCEPTED configuration.** UNICA owns no ENSv2 Sepolia name, so no merchant on this chain
  publishes a `unica.pay` record. The accept path is exercised offline against a described world, and
  `merchant-config-test.mjs` says it is a fixture in its first paragraph. The live runner carries the
  half a fixture cannot fake: a real entry point, a real resolver, real revert data.
- **The entry point's code HASH is checked live, not offline.** The offline validator checks the entry
  point's address and code size; the fourteen-contract runtime code-hash re-read is opt-in
  (`requireVerifiedDeployment`) because it costs fourteen extra reads, and the live runner always runs
  it. What the validator will not do is let "we did not look" read the same as "we looked and it was
  fine" — that is what `DEPLOYMENT_UNVERIFIED` is for.
- **No finer resolver resource has ever been observed on this deployment.** This whole design rests on
  the name-level scoping. **A per-key resource has now appeared**, and the rewriting that sentence
  anticipated is the four-scope authority read described above.
- **Nothing here writes.** Every chain touch is `eth_call`, `eth_getCode`, `eth_getStorageAt`,
  `eth_chainId` or `eth_blockNumber`. Nothing signs, nothing broadcasts, and the endpoint is only ever
  printed as an origin.
- **The live rows rest on one third-party testnet name**, `raffy.eth`, used purely as something real
  to read. If it changes hands or changes its records, those rows say so rather than passing quietly.
  Nothing in this repository depends on it existing.
