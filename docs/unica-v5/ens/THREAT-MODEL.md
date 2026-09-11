# UNICA v5 / ENS — threat model

Engineering record. Labels: **VERIFIED** (source cited), **PROPOSED**, **DOCUMENTED_NOT_OBSERVED**,
**UNKNOWN**. Authority labels on every mitigation: **ENSV2_ONCHAIN**, **UNICA_ONCHAIN**,
**BACKEND_POLICY**, **GRAPH_EVIDENCE**, **CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION**.

Read-only research. This document proposes mitigations; it does not implement, deploy, sign, or
broadcast any of them. It draws on `docs/unica-v5/ens/ACCESS-CONTROL.md` and `DEPLOYMENT-CONFIG.md`
(this same stream, cited by section rather than re-derived) and does not repeat their evidence in
full.

## 1. Scope and method

Twenty-eight named threats, each covering the interaction between UNICA's settlement contracts and
its use of ENSv2 for merchant identity, staff/terminal/agent delegation, and (planned) receipt and
avatar art. Every mitigation is labelled by which layer actually enforces it — a mitigation that
lives only in prose is not a mitigation, so where none exists yet this document says so rather than
inventing one. Method: this repository's own live and fork evidence first (`ACCESS-CONTROL.md`,
`DEPLOYMENT-CONFIG.md`), then official ENSv2 documentation and source, then UNICA's own existing
specification documents (`docs/v2/SECURITY-ADVISORY-001.md`, `docs/unica-v4/EVENT-SCHEMA.md`,
`docs/unica-v4/SPEC-CONTRACTS.md`, `docs/unica-v4/ENS-ART-LAYER.md`) for the settlement-side
invariants ENS-side risk must never be allowed to weaken.

## 2. The non-negotiable settlement boundary, restated

Binding, restated from this stream's own brief and cross-checked against evidence this repository
already has:

**An ENS record must never redirect a live UNICA settlement.** For an existing market or order the
payout address, token addresses, chain id, hook, executor, amount, minimum output and bound payer are
fixed by the contracts. ENS may aid discovery **before** order creation; the order then binds the
resolved identity immutably. If a merchant later changes an address record: existing orders and
receipts do not change, no market silently redirects, a new order requires a fresh readback, and the
interface separates current resolution from the identity observed at settlement.

**This already holds, measured, not merely asserted**: `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` §8,
**VERIFIED, UNICA_ONCHAIN**: *"The recipient is resolved once, client-side, before the order exists,
and is then stored on chain in `UnicaExecutorV3.Order.recipient`. Settlement reads only that stored
value and never re-resolves a name… The five settled V3 orders on Sepolia keep the recipient they
were created with, whatever `unica.eth` resolves to afterwards."* This is not a design intention; it
is a property of contracts already deployed and orders already settled.

**Also binding, carried in from this repository's existing specification**: payer-bound orders only
(`WrongPayer` — `docs/unica-v4/EVENT-SCHEMA.md` line 265, `docs/unica-v4/SPEC-CONTRACTS.md` §on
`pay()`, **VERIFIED, UNICA_ONCHAIN, DOCUMENTED as SPECIFIED-NOT-BUILT for v4**); Advisory 001
(`docs/v2/SECURITY-ADVISORY-001.md`, **VERIFIED**, this repository's own critical finding, open and
unfixed in `rc1`): an authorization must bind payer, merchant, asset, amount, chain, verifying
contract, order/nonce and expiry, or a submitter can substitute the merchant's half of a deal while
the payer's signature stays byte-identical. **The relevance to ENS**: nothing an ENS record can do —
changing an address, changing a text record, revoking a role — reaches into an already-signed
authorization's binding, because the binding is cryptographic and on the settlement contract's own
terms. ENS-side compromise and Advisory-001-shaped compromise are different attack surfaces that
happen to share a symptom (money going to the wrong place); this document is only about the first.
An indexer never authorizes settlement; an UNKNOWN read fails closed — the same rule this
repository's `docs/v2/SECURITY-ADVISORY-001.md` context already states, extended here to
`GRAPH_EVIDENCE` specifically (§3.15).

## 3. Threat catalogue

### 3.1 Wrong Universal Resolver

**Real, and already demonstrated by this stream's own research, not hypothetical.**
`DEPLOYMENT-CONFIG.md` §4–§5 found **three distinct `UniversalResolverV2` addresses** claimed for one
logical entry point across three sources retrieved the same day: this repository's own live read,
the ENS team's own generated address table, and the ENS team's own README quoting a temporary
repoint to a **fourth, different** address than either. Only the fixed entry point,
`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, matched across every source.

**Mitigation**: hard-code **only** the fixed entry point (already done — `web/ensv2/resolve.mjs`,
`ENSV2.entryPoint`, **VERIFIED, existing code**); never cache or hard-code anything downstream of it;
walk the proxy chain live, reading `implementation()`/the ERC-1967 slot fresh at time of use
(`ACCESS-CONTROL.md` §5, `permissioned.mjs`'s `readAuthorization`). **Authority: ENSV2_ONCHAIN**
(the read itself), **CLIENT_VERIFICATION** (the check that gates trusting it).

**Residual, named in `DEPLOYMENT-CONFIG.md` §12**: this repository's own `verifyProfile` checks
pinned addresses' bytecode; it does not yet assert that the **live proxy chain** still resolves to
the pinned downstream address as one combined, reportable claim. **PROPOSED, not built.**

### 3.2 Wrong deployment

A distinct failure from §3.1: not a stale pointer inside the *real* deployment, but trusting an
entirely different set of contracts (a copycat devnet, an abandoned prior deployment, a
similarly-named but unrelated testnet instance) as if it were the one this repository is pinned to.

**Mitigation, VERIFIED, built**: chain id check, then bytecode/runtime-code-hash check against every
pinned address (`profile.mjs`, `verifyProfile`, fails closed on the first mismatch — "nothing below
means anything"). A wrong deployment sharing the same chain id but different contracts fails this
check immediately, on the first row. **Authority: ENSV2_ONCHAIN, CLIENT_VERIFICATION.**

### 3.3 Confusable names, Unicode and homograph attacks

**Mitigation, VERIFIED, existing code**: `web/ensv2/resolve.mjs`'s `normalizeName` refuses **any**
non-ASCII input outright (`NON_ASCII_NAME`) rather than attempting full ENSIP-15 normalisation,
specifically because an approximated normalisation is how a homograph reaches a payer (the module's
own stated reasoning). This is a deliberate availability/security trade — legitimate
internationalised names cannot be resolved through this path today — not an oversight.

**Residual, genuinely unaddressed**: within the allowed ASCII subset (`[a-z0-9.-]` after
lower-casing), ASCII-only confusables still exist — `rn` vs `m`, `1` vs `l`, `0` vs `O` — and
`normalizeName` does not and cannot defend against them; they are valid, distinct labels that a human
reader may conflate. **Mitigation: PROPOSED, `BACKEND_POLICY`** — a merchant-facing directory or
allow-list UNICA itself curates (which names it will show as "known merchants") is the only layer
that can catch this; ENSv2 itself has no such check, and none is claimed here.

### 3.4 Malicious resolver

A name's owner is free to point their own name at any contract via `setResolver` — nothing in ENSv2
requires a resolver to be a genuine `PermissionedResolverImpl` proxy. A resolver that returns forged
`addr`/`text` values while lying about its own role state to a naive integrator is possible for any
name whose owner chooses one.

**Mitigation, VERIFIED, built**: `readAuthorization` (`permissioned.mjs`) checks the resolver's
ERC-1967 implementation slot and reports `NOT_A_PERMISSIONED_RESOLVER` when it does not point at the
known-good implementation — this is the same check `DEPLOYMENT-CONFIG.md` §3 cites as already
distinguishing `vitalik.eth`'s ENSv1-mirror resolver from a genuine Permissioned Resolver.
**Authority: ENSV2_ONCHAIN, CLIENT_VERIFICATION.**

**What this does not need to defend against**: even a fully malicious resolver cannot redirect an
**existing** order or receipt (§2) — only a **future** resolution, before order creation, which is
exactly the window UNICA's own boundary already treats as advisory, not authoritative.

### 3.5 Resolver replacement

A merchant's own resolver — or a compromised admin key's resolver — can be swapped via `setResolver`
(`ROLE_SET_RESOLVER`, registry-level, `ACCESS-CONTROL.md` §5.1) at any time, by whoever holds that
role.

**Mitigation**: §2's boundary — a swap after order creation cannot touch an existing order.
**Before** order creation, a swap changes what the *next* resolution reads, which is the entire point
of resolution; the mitigation is procedural, not preventive: a fresh readback immediately before
signing, never a cached resolution (`web/ensv2/resolve.mjs`'s whole purpose, and `config.mjs`'s
`resolvedAtBlock`/`validForBlocks` freshness window, **VERIFIED, existing code**). **Authority:
UNICA_ONCHAIN** (the binding), **CLIENT_VERIFICATION** (the freshness check).

### 3.6 Child escaping parent

**VERIFIED, OFFICIAL** (`ACCESS-CONTROL.md` §15, `contracts/README.md` "Creating Emancipated
Names"): a subregistry is, by default, **not** independent of its parent — parent root roles fold
into every child resource. A child can only escape if the **parent** deliberately emancipates it
(creates a subregistry with no root roles for the owner, then locks it in) — both parent-side acts.

**Mitigation, PROPOSED, BACKEND_POLICY**: UNICA's own architecture must never emancipate a staff,
terminal, or agent leaf name — leaving them un-emancipated is what lets the merchant (as parent)
revoke or override them at will, which is exactly the property §3.16 and the "revoking a terminal"
requirement depend on. This is a *default-safe* mechanism as designed; it has not been exercised, live
or forked, specifically for UNICA's own leaf-name hierarchy.

### 3.7 Excessive root grants

**Real and already observed, on a third-party name, not hypothetical.** This repository's own survey
(`profile.mjs`, `UNRESOLVED[0]`) found **two** accounts holding full authority at
`ROOT_RESOURCE` on `raffy.eth`'s own resolver instance and could not identify the second one — a live
example of exactly this threat, unexplained, on the deployment UNICA depends on.

**Two distinct exposures for UNICA specifically**:

1. A merchant's own resolver/registry root ending up held by more than the intended single admin
   (or Safe) — mitigated, `PROPOSED`: read `roleCount(ROOT_RESOURCE)` immediately after
   registration/initialization and confirm it matches the expected holder count exactly, never
   assume it.
2. **The managed-subname architecture concentrates root-level authority over every managed merchant
   subname in UNICA's own single parent-registry key** (`ACCESS-CONTROL.md` §8, the merchant-owner
   row's flagged architectural fork). A single compromise of that one key is an excessive-root-grant
   event against **every** merchant on that path simultaneously — this is the sharpest reason to
   prefer direct merchant registration over managed subnames wherever the cost of a per-merchant
   registration is acceptable, and it is an **open design decision**, not settled by this document.

**Authority: ENSV2_ONCHAIN** (the grant), **BACKEND_POLICY** (the architecture choice that determines
blast radius).

### 3.8 Lost admin

Once the sole admin-role holder's key is lost, `ACCESS-CONTROL.md` §3.4/§9: no third party can
recover it (admin roles are only ever reduced by oneself or moved by transfer); the only path back is
letting the name expire and re-registering, which wipes every role, including the merchant's own
history.

**Mitigation, PROPOSED, OFFCHAIN_OPERATION**: register with a Safe (multi-signature) as the admin
holder rather than a single EOA — consistent with this repository's own existing posture for
UNICA v4's mainnet admin key (`docs/unica-v4/THREAT-MODEL.md`'s Q64/T-KEY-1 pattern, cited for
consistency, not re-derived here). Not built for the ENS side; no Safe has been used for any name
this repository has registered or planned to register.

### 3.9 Unrevokable grant

Two distinct cases, both real:

- **A specific grant is always revocable** as long as *someone* still holds the matching admin bit
  (`ACCESS-CONTROL.md` §11, `_revokeRoles` cannot be resisted by the holder). This is not the risk.
- **If the sole admin-bit holder is the one who is lost or compromised (§3.8), every regular grant
  under that admin becomes unrevokable in practice** — nobody remaining can call `revokeRoles`/
  `authorizeTextRoles(...,false)` either, so a rogue agent or terminal granted before the loss keeps
  its authority indefinitely, with no on-chain path to stop it short of re-registration. This is the
  connection between §3.8 and this entry, and it is the sharpest argument for §3.8's Safe mitigation.
- **A structural gap independent of key loss**: `ACCESS-CONTROL.md` §3.3/§8 (`emergency revoker` row)
  — EAC has no "revoke-only" primitive; `_getSettableRoles` and `_getRevokableRoles` are the
  identical computation in the base contract, so any account empowered to revoke a role can also
  grant it. A least-authority "can only pull the emergency brake" role is **not expressible in
  ENSv2's EAC** and must be built, if at all, at `BACKEND_POLICY` — a Safe module or transaction
  policy that only ever constructs revoke-shaped calldata, never grant-shaped, verified outside the
  chain. **Not built.**

### 3.10 Stale ABI

**Mitigation, VERIFIED, existing code**: every selector in `permissioned.mjs`/`profile.mjs` is
**derived** from its signature string via `selectorFor`, never hand-typed, and the live scripts
recompute selectors and cross-check PUSH4 presence in the **actually deployed** runtime on every run
— a documentation update alone cannot silently desynchronise a selector this repository relies on,
because the check is against bytecode, not against memory of what a doc used to say.

**Residual**: a genuine implementation upgrade (new function, changed selector layout) is caught by
the **bytecode/code-hash** check (§3.11), not by selector-matching — the two checks cover different
failure modes and this repository runs both. **Authority: CLIENT_VERIFICATION.**

### 3.11 Proxy implementation change

This **is** §3.1's finding, restated at the mechanism level rather than the "which address" level:
`DEPLOYMENT-CONFIG.md` §5 quotes the ENS team's own README describing a **named, deliberate,
reversible** repoint of `ManagedUniversalResolverProxy`'s target, undertaken "at the team's request"
mid-hackathon. **This is not a hypothetical attacker action — it is documented, routine operational
practice by the party operating the deployment UNICA is pinned to.**

**Mitigation, VERIFIED, built for the pinned-address case**: `verifyProfile`'s code-hash check.
**PROPOSED, not built, for the live-proxy-chain case**: read `implementation()` fresh on every use
rather than trusting a value read once and cached — `DEPLOYMENT-CONFIG.md` §12's own recommendation.
**Authority: ENSV2_ONCHAIN.**

### 3.12 VerifiableFactory mismatch

**Mitigation, VERIFIED, built into the factory itself** (`ACCESS-CONTROL.md` §12, full source read):
`VerifiableFactory.verifyContract(proxy)` reconstructs the expected CREATE2 address from the proxy's
own stored salt (`getVerifiableProxyData()`) and compares it against the address supplied, reverting
`VerificationFailed` on any mismatch. **PROPOSED**: UNICA's own onboarding/preflight should call this
before treating any resolver-proxy address — merchant-supplied or otherwise — as genuinely
factory-deployed, rather than assuming an address that merely has the right bytecode size is
authentic. **Authority: CLIENT_VERIFICATION** (calling it), **ENSV2_ONCHAIN** (what it checks).

### 3.13 Stale CCIP-Read

**Mitigation, VERIFIED, existing code, the cleanest available**: `web/ensv2/resolve.mjs` explicitly
**refuses to follow** `OffchainLookup` at all — `EXPLAIN.OFFCHAIN_LOOKUP`: "this checkout does not
follow." UNICA does not trust off-chain gateway data for payment-critical resolution, full stop; there
is no staleness question for a path that is never taken. **Authority: BACKEND_POLICY** (the design
decision), **CLIENT_VERIFICATION** (the classification that enforces it).

The gateway dependency being refused is named, **VERIFIED, OFFICIAL** (`doc/AUDIT_README.md`,
Trusted External Contracts): **Unruggable Gateways**, used by ENSv1-mirror/migration paths for
CCIP-Read — irrelevant to UNICA's own resolution precisely because UNICA never calls it.

### 3.14 Compromised gateway

Fully covered by §3.13's refusal for UNICA's **direct** resolution path. **Residual, UNKNOWN**:
whether a name reached via the ENSv1-mirror/migration path (as opposed to one registered fresh on
ENSv2) could have its **records** influenced by a compromised gateway upstream of the point UNICA
reads from, even though UNICA itself never calls the gateway. Not resolved by this document; flagged
in §5.

### 3.15 Indexing lag

**Mitigation, PROPOSED, consistent with this repository's own existing rule**: never let
`GRAPH_EVIDENCE` gate a live order-creation or settlement decision — always re-read live
(`ENSV2_ONCHAIN`/`CLIENT_VERIFICATION`) at the moment of use, exactly as `resolveMerchant` already
does for address resolution. This extends the binding rule already stated in §2 ("an indexer never
authorizes settlement") to ENSv2-role reads specifically: a subgraph showing a terminal as
"currently authorized" is evidence for a dashboard, never the authority a settlement path checks
against. Cross-reference: `docs/unica-v5/graph/` (sibling stream, cited not edited) is where the
specifics of UNICA's own subgraph lag characteristics belong; not duplicated here.

### 3.16 A revoked terminal racing order creation

**Design answer, PROPOSED, consistent with §2's binding rule**: revocation stops **future** order
creation only, by design — it neither can nor should retroactively cancel an order already created.
The race window is bounded by ordinary block-confirmation timing: once a `revokeRoles`/
`authorizeTextRoles(...,false)` transaction is mined, `hasRoles` for that terminal reads `false`
immediately, and any order-creation path that checks it **live** at creation time fails closed from
the next block onward. Only a transaction **already mined** before the revocation lands can succeed —
unavoidable for any on-chain revocation of any kind, not a defect specific to ENSv2.

**What UNICA's own design must get right, PROPOSED, BACKEND_POLICY**: order-creation must check the
terminal's **live** role state at the moment of creation (a fresh `hasRoles` read or an
event-derived, freshly-confirmed status), never a cached credential or a token issued once at shift
start and trusted until it expires on its own schedule — the latter would turn a one-block race into
a race bounded only by the token's own lifetime.

### 3.17 A record redirecting payout discovery

This is §2's boundary by another name. **Already measured, VERIFIED, UNICA_ONCHAIN**:
`UNICA-ETH-ADDR-REPORT.md` §8 — five settled V3 orders on Sepolia kept their original recipient
through subsequent changes to `unica.eth`'s own address record, because settlement reads only the
value stored in `Order.recipient`, never re-resolving the name. **The mechanism, not merely the
policy, prevents this.**

### 3.18 Old orders after revocation

Same family as §3.16/§3.17: revoking any role, at any resource, never touches a prior order — the
order's terms were copied into contract storage at creation and nothing about a subsequent
resolver/role change can reach back into it. **Authority: UNICA_ONCHAIN.**

### 3.19 Merchant Safe compromise

If the merchant's admin-holding wallet is a Safe (§3.8's own recommendation) and it is compromised —
a signer's key stolen, or a malicious module added, sufficient to meet its own threshold — **no
ENSv2 mechanism defends against it**: a fully-compromised admin holder can revoke every delegate,
grant a new one, or transfer the name outright (it holds `CAN_TRANSFER_ADMIN`). This is fundamentally
a key-management problem, **`OFFCHAIN_OPERATION`**, outside ENSv2's scope to solve. This repository
already frames the equivalent risk for UNICA v4's own mainnet admin key
(`docs/unica-v4/THREAT-MODEL.md`, T-KEY-1) — the same operational discipline (threshold, module
review, monitoring) applies here and is not re-derived, only cross-referenced.

### 3.20 Counterfeit identity NFT

**PROPOSED / DOCUMENTED_NOT_OBSERVED — planned, not implemented**
(`docs/unica-v4/ENS-ART-LAYER.md`, "Status: planned, not implemented"): the design already commits to
the correct mitigation — the checkout independently resolves the payout address the same way
settlement does, separately resolves the avatar NFT per ENSIP-12's own ownership cross-check, and
**warns** on any mismatch rather than trusting the image (H11). "The image alone is never treated as
proof of payout identity" is stated as a design law, not left implicit. **Authority:
CLIENT_VERIFICATION** for the cross-check, once built.

### 3.21 Mutable renderer

**PROPOSED / DOCUMENTED_NOT_OBSERVED**, same source: `output = f(normalized_ens_name,
renderer_version)`, never a function of mutable data such as a payout address or on-chain state that
can change after mint (H6, H11) — a renderer change requires a **new** `renderer_version`, never a
mutation of prior token output. This is the correct mitigation for a mutable-renderer attack and is
recorded as a design law already adopted, not proposed fresh by this document.

### 3.22 Receipt-name spoofing

**Directly connects to `ACCESS-CONTROL.md` §8's "receipt/evidence writer" finding**: ENS text records
are mutable, last-write-wins fields — the same property `UNICA-ETH-ADDR-REPORT.md` already states
for the address record ("a mutable field, not an allocation"). **An ENS record cannot be a tamper-evident
receipt log by construction.** The durable, tamper-evident trail is `UNICA_ONCHAIN` settlement
events plus `GRAPH_EVIDENCE` indexing (immutable once mined and indexed); any ENS-hosted "latest
receipt" text record can only ever be an overwritable **pointer**, held by whoever holds
`admin(SET_TEXT)` at that resource. **Mitigation, PROPOSED, BACKEND_POLICY**: any consumer of such a
pointer treats it as informational only and independently verifies against the actual on-chain
settlement event before treating a receipt as authoritative — the same read-only-verification pattern
this repository already built for a different purpose in `tools/unica-verify` (cited by name, not
re-described; out of this stream's scope).

### 3.23 Cross-deployment replay

**Mitigation, VERIFIED, existing code**: `integrations/ensv2/config.mjs`'s `CONFIG_TYPE` binds
`chainId` explicitly inside the signed `MerchantConfig` struct, and `resolvedAtBlock`/
`validForBlocks` bound its freshness window (`isFresh`, `commitResolution` — refuses to build a
commitment from an expired reading). A signature computed for one chain id cannot be replayed against
another; a stale resolution cannot be replayed past its own freshness window.

**Residual, genuinely raised by this document's own findings**: `DEPLOYMENT-CONFIG.md` §4–§5 show
that even **within one chain id**, the underlying contract addresses behind the fixed entry point can
change over time (the ENS team's own repointing). `chainId` alone does not bind a signature to one
specific deployment *instance* if the same chain id is later served by different contracts —
partially mitigated already by `resolvedAtBlock`'s freshness window (a resolution taken before a
repoint naturally expires rather than being replayed indefinitely), but **not** a complete binding to
"the deployment that was live at that block" in the way a contract-address or code-hash commitment
would be. **UNKNOWN** whether this residual matters in practice given the freshness window's short
validity; not resolved further here.

### 3.24 Testnet identity shown as mainnet

Covered fully at the mechanism level in `DEPLOYMENT-CONFIG.md` §3/§13 (ENSv2 has no mainnet
deployment at all; ENS v1 mainnet is real and distinct; the `vitalik.eth` negative control already
runs). **Mitigation, VERIFIED, existing code**: `web/ensv2/resolve.mjs`'s `WRONG_CHAIN` classification
and `EXPLAIN.WRONG_CHAIN` message. **PROPOSED, UI-level**: every surface displaying a resolved ENS
identity must show the chain id/network name beside it, never bare — not yet confirmed as built into
any UI surface by this document (out of scope for this stream to verify against application code).
**Authority: CLIENT_VERIFICATION, OFFCHAIN_OPERATION** (the UI copy decision).

### 3.25 Agent endpoint takeover

The merchant agent's **off-chain service** being compromised (not its ENS key, its running code) is
distinct from a key-theft scenario and is exactly why its ENS-side authority is scoped to a single
leaf name holding nothing the merchant relies on (`ACCESS-CONTROL.md` §8, `DENIAL_MATRIX`,
`FORK_EXECUTED`) — even total compromise of the agent's own runtime can only rewrite that one leaf's
authorized key(s). **Mitigation, PROPOSED, OFFCHAIN_OPERATION**: the merchant's admin key (the one
that can revoke the agent) must not be co-located with the agent's own infrastructure — otherwise an
endpoint compromise also compromises the incident-response path, converting this into §3.9's
unrevokable-grant scenario. Not verified as a built operational separation; recorded as a requirement.

### 3.26 Oversized or malicious text records

**A genuine, currently unaddressed gap.** UNICA's own record-key **vocabulary** is closed
(`roles.mjs`, `RECORD_KEYS`, `delegatableTextKeys()`) — a delegate can only be scoped to write a key
from a known, small set — but nothing in ENSv2 itself, and nothing this repository has built, bounds
the **size** of the string value written to an authorized key. A legitimately-scoped holder (or a
compromised one) could still write an oversized or malformed value to their one authorized key.
**Mitigation, PROPOSED, `BACKEND_POLICY`/`CLIENT_VERIFICATION`**: any UI, indexer, or verifier reading
a text record must bound the length it will accept, parse, or display, and must never trust an
unbounded string pulled from chain. **Not built.**

### 3.27 SVG injection

Relevant only once `docs/unica-v4/ENS-ART-LAYER.md`'s planned on-chain SVG renderer exists — it does
not yet (**"Status: planned, not implemented"**). **A concrete, favourable finding this document can
state now rather than defer**: the renderer's only input is the **normalized name** (H6, H11), and
`web/ensv2/resolve.mjs`'s existing `normalizeName` already restricts a valid name to
`[a-z0-9.-]` after lower-casing (**VERIFIED, direct read of the regex**) — a character set containing
**none** of `< > & " '`, the characters that matter for SVG/XML injection. **Injection via the name
itself is already structurally prevented by the existing resolution module, before any renderer code
is written.** **PROPOSED**: `docs/unica-v4/ENS-ART-LAYER.md` §6's own planned malformed-input test
suite should still add an explicit row asserting this — that the accepted character set contains no
markup-significant character — rather than relying on this document's observation alone once the
renderer exists as code.

### 3.28 Privacy leakage from staff and receipt names

**A genuine, currently unaddressed design concern.** ENS records are public, forever, on a public
chain — the same posture this repository's own `CLAUDE.md` already applies to the repository itself
("write as if the whole world is looking") applies doubly here, since ENS records are a **separate**
public ledger from the repository. Naming a staff/terminal/cashier leaf name after a real person
(`john-smith-cashier.merchant.eth`) or storing receipt **contents** (rather than a pointer) in a text
record would permanently publish personal or transactional data. **Mitigation, PROPOSED,
`BACKEND_POLICY`**: staff/terminal/agent leaf names use opaque identifiers (a device id, a rotating
index, a hash) rather than real names; any receipt/evidence pointer stores only a hash or URI
reference, never receipt contents or personal data (converges with §3.22). **Not built; no leaf
naming convention has been fixed by this repository yet.**

## 4. Sources

Every source is retrieved 2026-09-11 unless noted; the full list with retrieval-date and kind
annotations is carried in `ACCESS-CONTROL.md` §1 and `DEPLOYMENT-CONFIG.md` §1 and not duplicated
here in full. Sources specific to this document beyond those two:

- `docs/v2/SECURITY-ADVISORY-001.md` (this repository, dated 2026-09-08) — §2.
- `docs/unica-v4/EVENT-SCHEMA.md`, `docs/unica-v4/SPEC-CONTRACTS.md` (this repository) — §2,
  `WrongPayer`/payer-bound orders, marked `SPECIFIED-NOT-BUILT` for v4 per this stream's own binding
  instruction.
- `docs/unica-v4/ENS-ART-LAYER.md` (this repository, dated 2026-09-11) — §3.20, §3.21, §3.27.
- `docs/unica-v4/THREAT-MODEL.md` (this repository) — §3.8, §3.19, cross-referenced for consistency,
  not re-derived.
- `docs/ensv2/UNICA-ETH-ADDR-REPORT.md` (this repository, dated 2026-09-10) — §2, §3.17, §3.18, §3.22.
- `integrations/ensv2/config.mjs` (this repository) — §3.23.

## 5. Unknowns

- Whether a name reached via the ENSv1-mirror/migration path could have its records influenced by a
  compromised upstream gateway even though UNICA's own code never calls one directly (§3.14).
- Whether `chainId` binding plus `resolvedAtBlock`/`validForBlocks` freshness is a **sufficient**
  defence against cross-deployment replay given the address volatility this stream itself found, or
  whether a stronger binding (e.g. a pinned contract-address or code-hash commitment) is warranted
  (§3.23) — not resolved.
- Whether any UI surface in this repository already shows a chain id/network label beside a resolved
  ENS identity, satisfying §3.24's UI-level recommendation — not checked; out of this stream's
  read-only-research scope over ENS-specific files.
- Whether UNICA will ultimately choose direct merchant registration or managed subnames (§3.7, and
  `ACCESS-CONTROL.md` §8's merchant-owner row) — an open architectural decision this document
  describes the consequences of rather than makes.
- Whether a Safe (or any multi-signature holder) has ever been used, or is planned, as the admin
  holder for any ENSv2 name in this repository's evidence — not found in any file this stream read;
  treated as **not yet decided** (§3.8, §3.19).
