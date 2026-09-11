# UNICA v5 ENS — point-of-sale terminal identity lifecycle

Status: DRAFT, research and architecture only. Nothing here is committed, deployed, or written to
any name. No registry, resolver, proxy, or NFT is deployed; no name or subname is registered; no
MockUSDC is minted or approved; no key is signed or broadcast; no ENS record is changed.

Labels: **VERIFIED**, **PROPOSED**, **DOCUMENTED_NOT_OBSERVED**, **UNKNOWN**. Authority labels:
**ENSV2_ONCHAIN**, **UNICA_ONCHAIN**, **BACKEND_POLICY**, **GRAPH_EVIDENCE**,
**CLIENT_VERIFICATION**, **OFFCHAIN_OPERATION**.

## 1. Sources

| # | Source | Author/org | Kind | Retrieved | Used for |
|---|---|---|---|---|---|
| S1 | `docs/unica-v5/pos/PRIVY-DEVICE-MODEL.md` (sibling stream — a different directory than this one, `docs/unica-v5/pos/`, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The six-concept/six-credential model, "operating a terminal" as a plain UNICA staff-account concept with no wallet attached, the role/permission matrix, and the lost/stolen-device procedure |
| S2 | `docs/unica-v5/pos/POS-FLOWS.md` (sibling stream, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The fifteen-state merchant/customer workflow, the order-creator vs. payer signature split, and the payer-binding confirmation boundary |
| S3 | `docs/unica-v5/pos/README.md` (sibling stream synthesis, cited, not edited) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | Cross-file conflicts already resolved (the $100 cap distinction) and the file index this document does not duplicate |
| S4 | `integrations/ensv2/roles.mjs` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The only mechanism this repository has actually exercised for scoping `SET_TEXT` to one leaf/one key: `authorizeTextRoles`, its screen (`screenAgentGrant`), its denial matrix, and its revocation path (same call, `granted=false`) |
| S5 | `integrations/ensv2/permissioned.mjs` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | `managedSubname(parent, label)` — the exact function this repository already has for deriving `<label>.<parent>` and its node, reused below rather than re-invented |
| S6 | `docs.ens.domains/ensv2/permissioned-resolver` | ENS | OFFICIAL | 2026-09-11 | Confirms record-level (per-key) access-control granularity exists as a documented feature, corroborating S4's fork measurement |
| S7 | `docs/unica-v5/ens/RECORDS.md` (this stream) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | `com.unica.terminal-status` (§6.9) — the exact record this lifecycle writes and revokes |
| S8 | `docs/unica-v5/ens/PAYMENT-BINDING.md` (this stream) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | §4.1's revocation-timeline row for a terminal revoked before order creation, which this document's §4.7 restates from the terminal's own point of view |
| S9 | `docs/unica-v4/SPEC-CONTRACTS.md` (this repository) | UNICA / repository | TEAM GUIDANCE | 2026-09-11 | The on-chain order-creator allowlist (`registry.setOrderCreator`, §6) — the UNICA_ONCHAIN fact a terminal's operating key may or may not hold, independent of anything ENS records |

## 2. Relationship to the existing POS design

`docs/unica-v5/pos/` already designs the countertop workflow, the theming, the accessibility
floor, the device-capability matrix, and the Privy/no-wallet staff-identity model — none of that is
repeated here. This document adds the one piece that stream deliberately keeps outside its own
scope: **a terminal as an ENS-addressable identity**, i.e. a subname under an operator's or
merchant's parent name, with its own scoped record and its own scoped, revocable on-chain
authority. `PRIVY-DEVICE-MODEL.md` (S1) already states the load-bearing design choice this
document inherits rather than revisits: "operating a terminal" is a plain UNICA staff-account
concept with **no wallet attached**, deliberately separate from any Privy embedded-wallet identity,
"so that none of Privy's key-custody, export, or recovery surface ever needs to apply to a
countertop device." A terminal subname in this document's design is a **discovery and
status-publication surface**, never a signing identity — restated because it is the single most
important boundary in this file, and every step below respects it.

## 3. Terminal identity model

A terminal's ENS identity is a subname of the merchant's (or a managed operator's) parent name,
derived exactly as `integrations/ensv2/permissioned.mjs`'s already-BUILT `managedSubname(parent,
label)` (S5) computes it: `name = <label>.<parent>`, `node = namehash(name)`. The label is the
terminal's own short identifier (a till number, a device slug) — never a customer-facing brand
string, never something a payer is expected to type. Two shapes are both PROPOSED and neither is
selected here (an owner/product decision, carried to §6):

- **A registered subname**, minted through the parent's own subname registry (ENSv2's hierarchical
  registry structure, the exact feature the ETHGlobal ENS track's "Best Use of ENSv2" description
  names: "deploy your own subname registry to tokenize and manage subnames under your own rules" —
  `RECORDS.md` §2 S12). This gives the terminal its own resolver proxy and its own EAC role space,
  independent of the parent's.
- **An unregistered wildcard subname**, resolved through the parent's own resolver (the wildcard
  mechanism already measured live in this repository: "an unregistered subname is answered by the
  same resolver as its parent," `integrations/ensv2/README.md`). This is cheaper (no per-terminal
  registration transaction) but means the terminal's records live at a resource **scoped by node**
  under the parent's own resolver, never at a separate contract — the EAC per-key resource
  derivation (`keccak256(node ‖ ...)`, S4) still isolates it correctly because the resource
  includes the terminal's own node, not just the parent's.

Either shape, the terminal's identity carries exactly one class of authority this design grants at
the ENS layer: **`SET_TEXT` scoped to `com.unica.terminal-status` (RECORDS.md §6.9) at the
terminal's own per-key resource, and nothing else.** It never holds `ROOT_RESOURCE` authority, it
never holds a role on the merchant's own root or payment-carrying names, and it never holds
`SET_ADDR` (a terminal has no payout address of its own to publish). This mirrors
`integrations/ensv2/roles.mjs`'s existing agent design (`AGENT_DEFAULT_ROLES = ["SET_TEXT"]`,
`PROTECTED_RESOURCE` screening) rather than inventing a second permission model — S4's whole
denial-matrix apparatus (`screenAgentGrant`, `DENIAL_MATRIX`) applies to a terminal grant
unchanged, since a terminal is, from EAC's point of view, exactly the same shape of delegate an
agent already is: an address holding `SET_TEXT` at one leaf's one key, nothing more.

**What a terminal's ENS identity is never used for.** It is never the mechanism that lets a
terminal create an order (that is `UnicaMarketExecutor.createOrder`'s own on-chain allowlist, S9,
BACKEND_POLICY-gated as described in `PRIVY-DEVICE-MODEL.md`, S1) and never the mechanism that lets
a terminal sign anything financial (no wallet is attached, S1). Its entire function is publishing
`com.unica.terminal-status` for discovery/display, and, if a future design wants it, holding a
`class = Wallet`... no — a terminal's `class` value, if ENSIP-27 (`RECORDS.md` §5.4) is adopted for
this stream, is PROPOSED as a value **outside** S5's own recommended table (none of `Agent`,
`Wallet`, `Treasury`, etc. describes a POS terminal precisely) — a specialized value such as
`Terminal` would fall under S5's own "other values MAY be used for specialized use cases" allowance,
recorded here as an open question (§6) rather than adopted.

## 4. Lifecycle, step by step, each step's authority label

### 4.1 Naming and subname reservation

| | |
|---|---|
| Authority label | OFFCHAIN_OPERATION (choosing the label), then ENSV2_ONCHAIN (deriving the node is a pure function, S5) |
| What happens | The merchant/operator's backend picks a terminal label (e.g. `till-04`), computes `name = till-04.<parent>` and `node = namehash(name)` via `managedSubname` (S5). No transaction is required for this step alone — `managedSubname` is a pure computation |
| Who acts | The merchant or a managed operator's backend (BACKEND_POLICY), never the terminal device itself, which has no identity yet |
| Failure behaviour | `managedSubname` returns `BAD_PARENT`/`BAD_LABEL` (S5's own `SUBNAME_STATUS`) for a malformed label — refused before anything is registered, never silently coerced |

### 4.2 Provisioning

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN (if a registered subname is chosen) or none (if a wildcard subname is chosen, §3) |
| What happens | Either (a) the operator's subname registry mints the subname, giving it its own resolver proxy, or (b) nothing on-chain happens and the subname simply resolves through the parent's wildcard resolver the moment anyone queries it (`integrations/ensv2/README.md`'s own measured behaviour) |
| Who acts | ENSV2_ONCHAIN: the operator's registrar contract, if (a); nobody, if (b) |
| Failure behaviour | A wildcard subname (b) resolves successfully to the **zero address** until a record is set (`ENS-OWNER-ACTION.md`'s own §4 note, restated) — this is expected and not an error, since a terminal publishes no address record at all in this design (§3) |

### 4.3 Role grant (scoped `SET_TEXT`)

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN |
| What happens | The merchant/operator (holding `adminRole(SET_TEXT)` at the terminal's per-key resource, by virtue of controlling the parent name's `register()`-time admin bits, S4) calls `authorizeTextRoles(dnsName, "com.unica.terminal-status", terminalOperatingKey, granted=true)`. The **effective** triple this writes — resource, bitmap, account — is exactly what S4's `delegationScope`/`buildTextDelegation` already compute for the agent case; this document reuses that same constructor, substituting the terminal's node, the terminal's own operating key (never a customer-facing key), and this one record key |
| Who acts | The merchant/operator signs; the terminal's own "operating key" (an address the backend controls, not a hardware wallet on the device — consistent with S1's no-wallet design) is the grantee |
| Precondition | `screenAgentGrant` (S4) must pass: the resource must equal the terminal's own leaf resource, never `ROOT_RESOURCE` or a protected resource on a name the merchant relies on (`unica.pay`, `unica.treasury`, per S4's `DENIAL_MATRIX`) |
| Failure behaviour | If the merchant's own key lacks `adminRole(SET_TEXT)` at that resource, the deployed contract refuses with `EACCannotGrantRoles`/`EACUnauthorizedAccountRoles` (S4's own observed refusal shapes) — the same refusal vocabulary already measured for the agent case, not a new one for terminals |

### 4.4 Normal operation

| | |
|---|---|
| Authority label | BACKEND_POLICY (staff sign-in, order creation gating) and ENSV2_ONCHAIN (status publication) as two separate facts |
| What happens | The terminal's backend periodically writes `com.unica.terminal-status` values (`active`, `maintenance`) as its operating schedule changes, using the scoped `SET_TEXT` authority from §4.3. Separately, and never derived from this record, staff sign-in and order creation are gated entirely by BACKEND_POLICY (the staff/device role table, S1) and, for order creation specifically, UNICA_ONCHAIN's own creator allowlist (S9) |
| Who acts | The terminal's backend process, using its scoped operating key, for the ENS write; staff members and the backend's own auth system for everything else |
| What this step never does | Publish, read, or depend on any payment-authorizing fact through ENS. A terminal that is fully "operating" per this record has done nothing that on its own lets it move money — restated because it is the property `PAYMENT-BINDING.md` §4.9's cross-cutting rule depends on |

### 4.5 Status update

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN |
| What happens | A new `authorizeTextRoles`-scoped `setText`-equivalent write (via the same delegated `SET_TEXT` authority) updates the value to `maintenance` or back to `active` |
| Who acts | The terminal's own scoped operating key (it was granted `SET_TEXT` at exactly this one key, §4.3 — it needs no further permission to update its own status) |
| Cross-reference | `RECORDS.md` §6.9's own failure-behaviour rule applies: a reader MUST treat an absent or stale value as UNKNOWN, never as `active` by default |

### 4.6 Key/device rotation

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN (revoke old, grant new) plus OFFCHAIN_OPERATION (re-provisioning the physical device or process) |
| What happens | The merchant/operator revokes the old operating key's `SET_TEXT` grant at the terminal's resource (`authorizeTextRoles(..., granted=false)`, S4) and grants the same scope to a new operating key, in two separate transactions — never one call that silently swaps the grantee, so that a partial failure leaves an explicit, checkable state rather than an ambiguous one |
| Who acts | The merchant/operator (holding `adminRole(SET_TEXT)`) |
| Precondition | Per `PRIVY-DEVICE-MODEL.md` §6 (S1)'s own lost/stolen procedure, this ENS-layer rotation happens **after** the backend-layer step that actually stops the old key from being usable for anything BACKEND_POLICY gates — the ENS grant/revoke pair is a slower, less time-critical layer than disabling a staff/device account, and this document does not claim otherwise |
| Failure behaviour | If the old key's grant is revoked but the new grant's transaction fails or is not yet mined, the terminal temporarily has **no** authority to update its own status record — it fails closed (no status write is possible) rather than leaving two keys both authorized |

### 4.7 Revocation

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN (the grant revocation) and BACKEND_POLICY (the actual access cut, which happens first) |
| What happens | Exactly `PAYMENT-BINDING.md` §4.1 (S8), restated from the terminal's own point of view: the backend/device role-table entry is disabled first ("this is what actually revokes access," S1); the `com.unica.terminal-status` record is set to `revoked`; and, if the operator chooses, the operating key's `SET_TEXT` grant is itself revoked via `authorizeTextRoles(..., granted=false)` so the old key can no longer even update the status field it once could |
| Who acts | The merchant/operator (backend disable, then the on-chain revocation) |
| What is never true | A revoked terminal's status record turning `revoked` does **not**, by itself, stop the terminal's operating key from attempting to sign a backend request — that stop happens at the BACKEND_POLICY layer, independent of ENS propagation. §5 below states precisely what a revoked terminal can and cannot still do |

### 4.8 Decommission

| | |
|---|---|
| Authority label | ENSV2_ONCHAIN (final revocation, and de-registration if a registered subname was used) plus OFFCHAIN_OPERATION (physical device disposal/reassignment) |
| What happens | Every grant at the terminal's resource is revoked; if the subname was registered (not wildcard), the operator's own subname registry MAY reclaim or retire the label per its own rules — this document does not specify a UNICA-side registry retirement mechanism, since none is built (SPECIFIED-NOT-BUILT, `docs/unica-v4/SPEC-CONTRACTS.md` for the settlement side; the ENSv2 subname-registry side is entirely the operator's own registrar contract, outside this repository's scope) |
| Who acts | The merchant/operator |
| Historical trace | Per `GRAPH-COMPOSITION.md` §3.4 of this stream, every grant and revocation this terminal ever held is indexable as evidence, permanently — decommissioning a terminal never erases that it once held a given scope for a given window |

## 5. What a revoked terminal can and cannot still do

**Cannot, from the moment the backend-layer disable takes effect (S1's own stated authority):**

- Sign in as active staff, or reach any screen `POS-FLOWS.md` (S2) gates behind an authenticated
  staff sign-in.
- Have its order-creation attempts succeed, if its operating key was also removed from UNICA's
  on-chain order-creator allowlist (S9) — a separate, UNICA_ONCHAIN fact this document does not
  assume happens automatically alongside a backend disable, and calls out explicitly as a step an
  operator must also take if the terminal's key was ever granted that allowlist role.
- Gain any wider ENS authority than it ever had — `screenAgentGrant`'s (S4) protections mean a
  revoked (or even a fully compromised) terminal operating key was never capable of writing
  anything beyond its one scoped text key in the first place, so revocation removes a narrow
  capability, never a broad one that first needs discovering.

**Can still do, honestly, until the corresponding on-chain step also completes:**

- **Publish a stale `com.unica.terminal-status` value.** If only the backend account was disabled
  and the ENS-layer `SET_TEXT` grant was not yet separately revoked (§4.6/§4.7's two-step design),
  the old operating key remains *technically* capable of writing to that one text record until its
  own EAC grant is revoked — this is exactly the residual `PAYMENT-BINDING.md` §4.1 and §5's
  cross-cutting rules name: a record write is not gated by the backend's staff-account table at
  all, only by the on-chain EAC grant. **This is why revocation is specified as two independent
  actions (§4.7), not one:** disabling the backend account stops everything BACKEND_POLICY
  actually gates (sign-in, order creation attempts routed through the backend); it does **not**,
  by itself, stop a still-EAC-authorized key from writing `com.unica.terminal-status` directly
  against the resolver. An operator relying only on the backend disable and never revoking the ENS
  grant leaves that one narrow write path open indefinitely — a residual this document states
  rather than hides, and the reason `com.unica.terminal-status` (RECORDS.md §6.9) is designed to be
  read as a *display convenience only*, never as proof a terminal is actually authorized to do
  anything BACKEND_POLICY or UNICA_ONCHAIN gate.
- **Have its already-created orders paid.** Exactly `PAYMENT-BINDING.md` §4.2–§4.5: an order the
  terminal created before revocation is bound on-chain and unaffected by anything that happens to
  the terminal afterward.

## 6. Unknowns

1. Whether UNICA terminals use registered ENSv2 subnames (their own resolver proxy) or
   wildcard-resolved subnames (§3) — an owner/product decision with real cost implications (a
   registration transaction per terminal vs. none), not made by this document.
2. Whether a specialized `class` value such as `Terminal` (§3, extending ENSIP-27's "other values
   MAY be used for specialized use cases," S6/`RECORDS.md` §5.4) is ever adopted for UNICA POS
   terminal subnames — recorded as a candidate, not adopted.
3. Whether an operator ever automates the two-step revocation this document specifies in §4.7 (a
   single "decommission terminal" backend action that both disables the account and fires the EAC
   revocation transaction) — not designed here; §5's residual is exactly the gap such an automation
   would need to close, and until it exists, revocation is a manual two-step operator
   responsibility.
4. Whether `docs/unica-v5/pos/HARDWARE-OPTIONS.md`'s four hardware tiers (bring-your-own,
   Guided-Access PWA, managed tablet, custom hardware — cited, not edited) each get a distinct
   terminal-identity provisioning flow, or one flow common to all four — not addressed here, since
   this document's ENS-identity layer is deliberately hardware-agnostic (the operating key lives in
   the backend, never on the device, per S1).
5. Whether a terminal's decommission should also clear its `com.unica.terminal-status` record to
   an explicit `retired` value versus leaving the last-written value in place with only the EAC
   grant revoked — both are consistent with §4.8's design; which one is chosen affects what a
   GRAPH_EVIDENCE reader sees as "last known state," and is not decided here.
