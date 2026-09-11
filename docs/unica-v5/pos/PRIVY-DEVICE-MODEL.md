# UNICA v5 POS — Privy and merchant-device security model

Status: PROPOSED design research for UNICA v5. UNICA v4 does not use Privy in production;
Privy is conditional and **NOT PROVIDED** (no UNICA Privy account, app id, or server secret
exists — `docs/unica-v4/DECISIONS.md` Q95–Q98, Q100). Nothing in this file authorizes
configuring a Privy application, and no secret is requested, printed, or recorded here —
Privy settings are described by name only.

This file separates what Privy's own documentation states (labelled VERIFIED, with the
source URL and access date) from what UNICA would need to design on top of it (labelled
PROPOSED) and from what Privy's documentation does not address (labelled UNKNOWN). A
correctly configured Privy application is not assumed to make a shared tablet safe as a
point of sale; that assumption is examined directly in the threat model below.

## Contents

1. Purpose and method
2. The six concepts, six credentials
3. Privy capabilities — VERIFIED from official sources
4. UNICA roles and permission matrix — PROPOSED
5. Shared-device threat model
6. Lost or stolen device procedure — PROPOSED
7. Kiosk-mode and kiosk-adjacent risks
8. Open questions and UNKNOWN items
9. Sources
10. Uncertainties

## 1. Purpose and method

This file's job is to separate what Privy's own documentation states from what UNICA would
need to design on top of it for a point-of-sale (POS) terminal, and to examine directly
whether a correctly configured Privy application, by itself, makes a shared tablet safe to
use as a POS. It does not: no Privy account exists for UNICA, no app id or server secret is
provided (`DECISIONS.md` Q95–Q100), and nothing here is a request to create one.

Method: official Privy documentation at `docs.privy.io` (and, where named, `privy.io`) was
read on 2026-09-11. Where a page loaded directly, that is noted as a direct fetch. Three
guessed URLs returned HTTP 404 on the first attempt; rather than retry them blindly, the
correct current URL for the same topic was located by search and read from there instead —
those facts are marked "via indexed excerpt" to flag that the exact page text was read
through a search index rather than a raw page load, and every one of them still carries the
specific `docs.privy.io` URL that excerpt was attributed to. Nothing is inferred from a URL
that never resolved at all; those are listed UNREAD in Section 9 and nothing in this file
depends on them. Every fact below is labelled **VERIFIED** (Privy's own documentation, with
URL and access date), **PROPOSED** (a UNICA design choice built on top of a VERIFIED fact,
not itself a Privy claim), or **UNKNOWN** (the fetched pages did not say, one way or the
other — never filled from assumption).

## 2. The six concepts, six credentials

Six distinct actions are in play, each with its own credential, its own holder, and its own
blast radius if that credential is misused. Conflating any two of them is how a cashier ends
up with more power than a cashier should have.

| # | Concept | Credential (PROPOSED unless cited) | Holder | Blast radius |
|---|---|---|---|---|
| 1 | Signing into the dashboard | UNICA's own back-office login — not a Privy concept at all | business owner, store manager, read-only accountant (§4) | view (and, for owner/manager, edit) of that account's own settings and history |
| 2 | Operating a terminal | a UNICA staff session on one physical device, scoped to a shift | cashier (and, as fallback, manager/owner) | can ring up orders and see that terminal's own order history while the session is live |
| 3 | Creating an order | the on-chain order-creator allowlist entry for that market (`SPEC-CONTRACTS.md` §4, `NotOrderCreator`; `DECISIONS.md` Rec 111) | whichever UNICA identity is allowlisted for that store | can name a payer and amount for one payer-bound order on an ACTIVE market; cannot settle it |
| 4 | Customer payment authorization | the payer's own signature/approval for the one order that names them as payer (`WrongPayer`, `SPEC-CONTRACTS.md` §9) | the customer, on the customer's own device or wallet — **never** UNICA staff | limited to the single order the customer signed for |
| 5 | Administering settlement contracts | the on-chain ADMIN and PAUSER roles (`registry.admin`, `registry.pauser`, `SPEC-CONTRACTS.md` §3) | for 46630: the deployer EOA (experimental, not v4). For a live market: a Safe as ADMIN, **NOT READY** (Q64); a mainnet PAUSER key, **NOT READY** (Q70) | market lifecycle transitions, oracle-policy and cap tightening — "ADMIN cannot move funds, by construction" (`SPEC-CONTRACTS.md` §3) |
| 6 | Controlling the merchant payout wallet | the address registered as the order's `recipient` / payout address | business owner only (PROPOSED) | receipt of settled funds; changing it is a merchant-configuration action |

Concept 4 is the one Privy's documentation is actually about, and it belongs to the customer,
not to UNICA staff — nothing in this file proposes running a customer's payment authorization
through a POS terminal's own Privy identity. Concepts 1–3 are where a POS terminal's own
staff identity lives, and that is what §3–§6 below are mostly evaluating.

The standing invariant this document enforces in §4's matrix: **the cashier never
automatically gains** Safe ownership, contract administration, withdrawal authority,
payout-address changes, market unpause/retire authority, or wallet export/recovery control.
Each of those is a different credential above, and none of Privy's own role concepts (its
Dashboard teammate roles, §3.14) substitutes for UNICA enforcing that boundary itself in its
own backend (§3.11).

## 3. Privy capabilities — VERIFIED from official sources

### 3.1 Merchant/staff authentication (login methods)

**VERIFIED.** Privy's client SDKs support login by email, SMS, passkey, a set of social/OAuth
providers (Google, Apple, Twitter/X, Discord, GitHub, LinkedIn, Spotify, Instagram, Telegram,
TikTok, Farcaster), and external wallets. Source: `docs.privy.io/authentication/overview` and
`docs.privy.io/guide/react/configuration/login-methods` (accessed 2026-09-11, via indexed
excerpt).

**VERIFIED.** Privy classifies login methods by trust model: some depend on a third party
remaining available and cooperative (Google, Apple, Twitter, Discord, Telegram, email OTP,
SMS); a passkey is owned outright by the user, with no third party able to revoke or suspend
access. Source: same pages (accessed 2026-09-11).

**VERIFIED.** A passkey cannot create a new Privy account by itself — it must be linked to an
account already created through another login method. Source:
`docs.privy.io/guide/expo/authentication/passkey` (accessed 2026-09-11, via indexed excerpt).

**PROPOSED.** UNICA would use one of these login methods only for concept 2 in §2 ("operating
a terminal") and, separately, for dashboard sign-in (concept 1) — never for concept 4
(customer payment authorization), which is the payer's own wallet action under the v4
contract model, not a Privy login event on UNICA's own app.

**UNKNOWN.** None of the fetched pages describe a built-in "staff roster" primitive distinct
from Privy's own end-user base. UNICA would build the cashier/manager/owner distinction
itself in its own backend (§3.11, §4) — Privy authenticates a person; it does not know
UNICA's roles.

### 3.2 Embedded-wallet ownership and key architecture

**VERIFIED.** "Neither Privy nor your application ever sees the user's keys; secrets are only
ever reconstituted in a secure environment under the user's control so they can sign messages
or transactions," and wallets "leverage secure enclaves and key splitting to ensure secure
key reconstitution." Source: `docs.privy.io/wallets/overview/embedded` (accessed 2026-09-11,
direct fetch).

**VERIFIED, but see the discrepancy noted below.** Privy's own security/threat-model page
states key custody uses "2-of-2 Shamir sharing" so that no single party, including Privy, can
unilaterally reconstruct a key. Source: `docs.privy.io/guide/security/threat-models` (accessed
2026-09-11, direct fetch).

**Unresolved discrepancy.** Other Privy pages (recovery and MFA-adjacent material) describe a
three-share model once a recovery method is configured — a device share, a Privy/TEE share,
and a user-controlled recovery share. This document did not fetch a single page that states
both the default (no-recovery) and recovery-configured share counts side by side, so it does
not assert a reconciliation. Before this is relied on for an actual security design, re-verify
the exact share count and threshold directly against current `docs.privy.io` pages — this is
carried into §10 as an uncertainty, not resolved here.

**VERIFIED.** A user can export their embedded wallet's raw private key client-side via the
`exportWallet` method; "their private key is assembled on a different origin than your app's
origin, meaning neither the app nor Privy can access" it during that export. Source:
`docs.privy.io/wallets/wallets/export` and `docs.privy.io/guide/react/wallets/embedded/export`
(accessed 2026-09-11, via indexed excerpt).

**VERIFIED.** Privy separately documents a server-side export capability: the integrating
application's own backend can export a user's wallet private key (via Hybrid Public Key
Encryption), described as a way to "self-host a recovery site." Source:
`docs.privy.io/controls/authorization-keys/owners/configuration/user/server-export` (accessed
2026-09-11, via indexed excerpt).

**PROPOSED, load-bearing.** UNICA must never enable Privy's server-side wallet-export
capability. Q53 is a standing rule that "UNICA never requests or handles seed phrases"; a
UNICA backend able to reconstruct a user's raw private key is the same class of exposure even
though the secret in question is a raw key rather than a BIP-39 phrase. This document treats
"never handle a seed phrase" and "never be able to reconstruct a user's private key" as one
rule, and server-side export is the one documented Privy setting that would break it.

**UNKNOWN.** Whether Privy's embedded wallet, in its default (non-exported) flow, is ever
derived from or displays a BIP-39 mnemonic anywhere the user or app could see it. The fetched
pages describe a raw-private-key export, not a seed-phrase export, and separately reference an
optional "Hierarchical deterministic (HD) wallets" feature at
`docs.privy.io/guide/react/wallets/embedded/hd-wallets`, not fetched; UNREAD as of 2026-09-11.
Left UNKNOWN rather than assumed either way.

### 3.3 Passkeys

**VERIFIED.** Passkey is Privy's recommended MFA method, described as "phishing-resistant,
device-bound, and independent of third-party carriers or apps," verified through the device's
own biometric prompt. Source: `docs.privy.io/authentication/user-authentication/mfa/overview`
(accessed 2026-09-11, direct fetch).

**VERIFIED.** As in §3.1, a passkey cannot create a new account and must be linked to an
existing one.

**PROPOSED.** Passkey-based MFA, bound to a specific POS device's own secure element, is the
strongest available factor for anything §2 calls "operating a terminal" or higher, because it
is device-bound and cannot be phished or SIM-swapped the way SMS can.

### 3.4 Multi-factor authentication (MFA)

**VERIFIED.** Three MFA methods are documented: passkey, a TOTP authenticator app, and SMS —
Privy's own documentation flags SMS as "vulnerable to SIM-swapping and interception attacks."
Source: `docs.privy.io/authentication/user-authentication/mfa/overview` (accessed 2026-09-11,
direct fetch).

**VERIFIED.** Once enrolled, MFA gates every action that uses the embedded wallet's private
key — signing messages, sending transactions, exporting the wallet, and recovering it on a new
device — across all of a user's embedded wallets at once. By default MFA applies to every
wallet action; an app can instead configure policy-based MFA to require it only above a
threshold (for example, transfers past a set amount). Source: same MFA page, plus
`docs.privy.io/security/wallet-infrastructure/policy-and-controls` (accessed 2026-09-11,
direct fetch).

**PROPOSED.** UNICA should require passkey or TOTP MFA — never SMS-only, per Privy's own
caution above — for any action mapped to concept 5 or 6 in §2 (settlement administration, the
payout wallet).

### 3.5 Recovery

**VERIFIED.** Two user-managed recovery paths are documented: a password that secures the
wallet's recovery share, which "Privy has no knowledge of ... and cannot decrypt"; and a
cloud-backup path where the recovery-share decryption key is stored in the user's own iCloud
or Google Drive account, which Privy states it "cannot access ... and cannot decrypt." Source:
`docs.privy.io/wallets/advanced-topics/new-devices/cloud-recovery` and
`docs.privy.io/guide/react/wallets/embedded/recovery/passwords` (accessed 2026-09-11, via
indexed excerpt).

**VERIFIED.** On a new device, once the user authenticates, Privy "automatically orchestrates
reconstitution of the key material" for their wallet, optionally gated by the password or
cloud-account step above. Source: `docs.privy.io/guide/react/wallets/embedded/recovery`
(accessed 2026-09-11, via indexed excerpt).

**UNKNOWN.** What happens if a user loses their device and every recovery method at once
(forgotten password, no cloud account signed in, no passkey enrolled). No fetched page states
the outcome for that case. Given the non-custodial design in §3.2, the likely implication is
that the wallet becomes unrecoverable, but this document did not read a page that says so
directly, and does not assert it.

### 3.6 Sessions and token lifetimes

**VERIFIED.** Access tokens are ES256 JWTs, generally valid for one hour, and are silently
refreshed by the client SDK; a refresh token is valid for up to 30 days but usable only once.
Source: `docs.privy.io/authentication/user-authentication/access-tokens` (accessed 2026-09-11,
direct fetch) and `docs.privy.io/authentication/user-authentication/tokens` (accessed
2026-09-11, via indexed excerpt).

**VERIFIED.** The overall session duration — how many days before a user must fully
re-authenticate — is configurable per "app client" under Dashboard > User management >
Authentication > Advanced, and defaults to 30 days. Source:
`docs.privy.io/basics/get-started/dashboard/app-clients` (accessed 2026-09-11, via indexed
excerpt).

**PROPOSED.** A shared POS terminal should run under its own, separately configured app
client with a short session duration (a shift-length window, not 30 days), so a terminal left
signed in does not stay authenticated between shifts. This is a Dashboard "app client"
configuration choice, described here by setting name only, never by a secret.

### 3.7 Device enrollment and multi-device accounts

**VERIFIED.** A user's embedded wallet is not device-bound: once authenticated on a new
device, Privy reconstitutes the wallet there, letting the user "seamlessly use their wallet on
any device where they are authenticated." Source: same recovery excerpt as §3.5 (accessed
2026-09-11).

This is precisely the property a shared-device POS design has to work against: an account is
portable by design, so a terminal being "logged in" is not, by itself, proof that the person
who logged in is a specific authorized human — the login channel (email, social, SMS) may be
reused by anyone who controls that channel, unless a device-bound factor (passkey MFA, §3.3–
§3.4) is also required, which is UNICA's own configuration choice, not something Privy
enforces by default.

**UNKNOWN.** Whether Privy's dashboard or client SDK exposes a "your devices" list an end user
(or an app on their behalf) can view and individually revoke, distinct from the full logout in
§3.13. No fetched page confirmed or denied this.

### 3.8 Transaction confirmation UI

**UNKNOWN.** No page fetched as of 2026-09-11 described the actual signing/consent screen's
content or how far an integrating app can customize it. §3.4 implies some confirmation step
exists (MFA gates signing), but its UI is not documented here. Left UNKNOWN rather than
assumed.

### 3.9 Wallet export

Covered in §3.2 above (client-side export isolates the key to a different origin than the
app's; server-side export exists and is the one setting this document says UNICA must never
enable).

### 3.10 Policy controls

**VERIFIED.** Privy's wallet policy engine can restrict transfer amounts, allowlist/denylist
recipient addresses, allowlist/denylist target contracts, and constrain calldata. Application
developers configure the rules, and enforcement happens inside the trusted execution
environment itself, before signing — "wallets can only ever be used to take actions your
application intends to take." Source:
`docs.privy.io/security/wallet-infrastructure/policy-and-controls` (accessed 2026-09-11,
direct fetch).

**PROPOSED.** For any POS-adjacent wallet identity, the natural policy is a per-transaction cap
plus a recipient allowlist limited to UNICA's own executor/settlement contracts. This is
additional to, and does not replace, the on-chain caps UNICA v4's contracts already enforce
($10/tx, $25/day, $100 total — `DECISIONS.md` Q5–Q7).

### 3.11 Server-side authorization and token verification

**VERIFIED.** A backend verifies a user's access token with `PrivyClient.verifyAccessToken`
(or a standard JWT library against Privy's published verification key), receiving `userId`
(the Privy DID), `appId`, `issuer` ('privy.io'), `issuedAt`, `expiration`, and `sessionId`. A
failed or expired verification must be treated as unauthorized. Source:
`docs.privy.io/guide/server/authorization/verification` (accessed 2026-09-11, direct fetch).

**PROPOSED.** UNICA's own backend — not Privy's — is where a verified `userId` is mapped to a
UNICA role (§4). Privy authenticates who the person is; it does not know or enforce UNICA's
cashier/manager/owner distinction.

### 3.12 Allowed domains / origins

**VERIFIED.** An app's allowed origins are configured in the Dashboard under Settings >
Domains: origins require the `https://` scheme, no trailing path, only subdomain wildcards
(`*.domain.com`, never `*.com` or a partial-string wildcard), and a developer-only loopback
origin (with its port) is permitted for development. This list "restricts client-side access
to your Privy app id." Source: `docs.privy.io/guide/react/configuration/allowed-domains`
(accessed 2026-09-11, via indexed excerpt).

**PROPOSED.** UNICA's production POS web app and its staging/preview origins are the only
entries UNICA would add — never a wildcard broader than the exact origins in use, and a
developer-only loopback origin must never be present in a production allowlist.

### 3.13 Remote logout and session revocation

**VERIFIED.** The client SDK's `logout` "ends their authenticated session, removing their
access credentials from the device" — described as a client-side, on-device action across
every platform SDK (React, React Native, Swift, Android, Flutter). Source:
`docs.privy.io/authentication/user-authentication/logout` (accessed 2026-09-11, direct fetch).

**Not confirmed either way.** The fetched logout page did not describe a dashboard or backend
action that force-revokes one specific other session or device. This document could not
confirm such a path from what it read — flagged as UNKNOWN, not as a confirmed absence, and
carried into §8 for re-verification before anyone relies on "remote logout" as a lost-device
control.

**VERIFIED, narrower case.** For delegated/server sessions specifically (the "Delegated
Actions" / session-signer feature), a user-triggered `revokeWallets` call (via
`useHeadlessDelegatedActions`) stops the app from acting on that wallet on the user's behalf
going forward. Source:
`docs.privy.io/wallets/using-wallets/session-signers/remove-session-signers` (accessed
2026-09-11, via indexed excerpt). This covers only delegated/server-signed actions, not an
ordinary logged-in browser session.

**VERIFIED.** Separately, if the SDK detects that an access or refresh token has been
tampered with, it immediately logs the user out and destroys the corresponding session in
Privy's backend — an automatic, not administrator-triggered, revocation. Source:
`docs.privy.io/authentication/user-authentication/access-tokens` (accessed 2026-09-11, via
indexed excerpt).

This is the single most important open question for the lost-device procedure in §6: whichever
staff account was logged into a terminal has up to that app client's configured session
duration (§3.6) before its Privy session lapses on its own, unless UNICA's own backend
independently blocks that user (disabling the underlying UNICA staff account, so the next
access-token verification in §3.11 fails, even while the Privy-issued token itself remains
technically valid until its own one-hour expiry and is simply not renewed).

### 3.14 Audit events / logging

**VERIFIED.** The Dashboard has a "Teammate roles" concept for **UNICA's own personnel
operating the Privy Dashboard itself** — not POS staff: role tiers including Admin and Viewer,
where only Admins invite teammates and assign roles, Viewers get read-only dashboard access,
and removing a teammate "immediately revokes their access to your Privy dashboard and all
associated applications." Source:
`docs.privy.io/basics/get-started/dashboard/teammate-roles` (accessed 2026-09-11, via indexed
excerpt). This is a distinct concept from §2's six credentials — it answers "who at UNICA can
configure the Privy application," not "who can operate a POS terminal."

**UNKNOWN.** Whether the Dashboard exposes a per-end-user audit log (logins, MFA events,
exports, policy denials) that UNICA could review after an incident. No fetched page confirmed
or denied this.

### 3.15 Whether a dedicated POS device can be provisioned without UNICA ever handling a seed phrase

Given §3.1–§3.14: **yes, conditionally.** As long as UNICA (a) never enables Privy's
server-side wallet-export capability (§3.2), (b) never operates a self-hosted recovery site
that reconstructs keys, and (c) keeps the customer's own payment authorization (concept 4,
§2) on the customer's own device or wallet rather than proxying it through the terminal's own
identity, none of Privy's documented default flows requires UNICA's servers or staff to see a
private key or a seed phrase. This conclusion is **PROPOSED reasoning** built by combining the
VERIFIED items above — it is not a single Privy statement saying so in one place, and it
should be re-checked against current Privy documentation before UNICA relies on it
operationally.

One caveat carried from §3.2's UNKNOWN: if "operating a terminal" (§2, concept 2) were itself
built as a Privy embedded wallet under a UNICA-controlled account, every one of §3.2–§3.13's
caveats would apply to that terminal identity too, and UNICA would be handling it exactly as
carefully as a merchant's own wallet. The design proposed in §4 avoids this by keeping
"operating a terminal" a plain UNICA staff-account concept with no wallet attached, separate
from any Privy embedded-wallet identity.

## 4. UNICA roles and permission matrix — PROPOSED

Four roles, mapped against the six concepts from §2. Nothing here is built or configured; it
is the design UNICA v5 should implement in its own backend (§3.11), since Privy does not know
UNICA's role names.

| Concept (§2) | Business owner | Store manager | Cashier | Read-only accountant |
|---|---|---|---|---|
| 1. Sign into the dashboard | full access | full access, scoped to their store(s) | no dashboard access — terminal login only (concept 2) | read-only access |
| 2. Operate a terminal | yes, as a fallback | yes, as a fallback | **yes — the cashier's normal, everyday credential** | no |
| 3. Create an order | yes | yes | yes, only on an ACTIVE market, only under the on-chain order-creator allowlist entry assigned to that store (`NotOrderCreator`, `SPEC-CONTRACTS.md` §4) | no |
| 4. Customer payment authorization | n/a | n/a | n/a | n/a |
| 5. Administer settlement contracts (ADMIN / PAUSER) | may hold ADMIN or a Safe signer seat (PROPOSED; mainnet Safe is **NOT READY**, Q64) | no | no | no |
| 6. Control the merchant payout wallet | owner only | no | no | no |

Concept 4 has no staff row because it never belongs to staff at all — see §2 and §3.1.

The standing rule this matrix encodes, restated because it is the one most likely to be
violated by a convenience shortcut: **the cashier never automatically gains** Safe ownership,
contract administration, withdrawal authority, payout-address changes, market unpause/retire
authority, or wallet export/recovery control. Granting any of those to a cashier account,
even temporarily "to cover a shift," collapses concept 2 into concepts 5 and 6 and defeats the
entire separation this document argues for.

## 5. Shared-device threat model

Privy's own security documentation is explicit about what it does and does not cover. Its
threat-model page addresses cross-application (iframe) attacks, unauthorized wallet access
without a valid access token, compromised browsers (mitigated by MFA, token revocation, and
key non-persistence), malicious browser extensions/bookmarklets (partially mitigated by CSP
nonces, with MFA recommended as additional defense), infrastructure compromise, and key
custody itself. It explicitly does **not** discuss phishing of a user's own credentials,
malicious applications that legitimately obtain user consent, **shared or multi-user devices
where another user gains physical access**, supply-chain attacks, or social engineering, and
says so directly: "The below summarizes some key questions but is not exhaustive." Source:
`docs.privy.io/guide/security/threat-models` (accessed 2026-09-11, direct fetch).

**A correctly configured Privy application is therefore not, by itself, evidence that a
shared POS tablet is safe.** Privy's own scope statement names the shared-device case as one
it does not address. The table below is UNICA's own threat model for that gap.

| # | Asset | Threat | Control | Residual risk |
|---|---|---|---|---|
| 1 | The logged-in staff session on a terminal | Shoulder surfing of a typed passcode/PIN | Passkey/biometric unlock instead of a typed PIN where supported (§3.3); short session duration (§3.6) | A biometric enrolled for one staff member unlocks the device for anyone else whose biometric is also enrolled on it — per-action UNICA-role checks (§3.11) must not assume "device unlocked" equals "this specific person" |
| 2 | Browser-saved credentials on a shared tablet | Autofill lets a later user resume a previous staff member's session | A dedicated, no-personal-browsing kiosk browser profile (`HARDWARE-OPTIONS.md`); short session duration; sign-out required at shift end (operational policy, PROPOSED) | Staff forgetting to sign out is bounded only by the session-duration ceiling (§3.6), which does not revoke immediately |
| 3 | Order-creation capability while a terminal is unattended | Unauthorized staff, or a customer, creates a bogus order | Order creation is on-chain allowlisted (`NotOrderCreator`); combine with a device auto-lock timeout | A genuinely live, unattended, unlocked session can still create real orders — this is a physical/operational control, not a cryptographic one |
| 4 | The payer's own payment authorization | A cashier intercepts or redirects a customer's signature | UNICA v4's contract design already refuses this: `WrongPayer` binds settlement to the named payer, and Advisory 001 (`docs/v2/SECURITY-ADVISORY-001.md`) is the standing reason public, payer-unbound links are deferred to v5 behind a signed-intent review (`V5-DEFERRED.md` §8). A POS UI must never collect the customer's wallet credential on staff hardware | A carelessly built QR/handoff link is itself a redirection surface — a v5 design problem this document flags but does not solve; it is out of scope here and belongs to the review `V5-DEFERRED.md` §8 requires |
| 5 | Clipboard / screen contents (amount, payout address, order id) | Clipboard leakage to another app, or screen capture by a malicious extension or remote-management tool | Kiosk-mode browser/app with no general extension surface (`HARDWARE-OPTIONS.md` options B–D); never display a private key or recovery phrase (§3.15 says UNICA should not possess one) | A compromised OS-level MDM/RMM agent with screen-capture rights is trusted infrastructure — see `HARDWARE-OPTIONS.md` §7 |
| 6 | A stolen or lost tablet | Physical theft while a staff session is live | §6's procedure below (account disable, remote wipe where available) | The window between theft and staff noticing/reporting, bounded only by session duration (§3.6) unless device-level MDM remote-lock/wipe is also in place |
| 7 | A malicious browser extension on a bring-your-own tablet | Extension reads page content, keystrokes, or clipboard during checkout | None available at the web-app layer alone | Not fully closeable on a general-purpose browser — a reason a kiosk-locked device (`HARDWARE-OPTIONS.md` options B–D) is stronger than option A for anything beyond a low-value pilot |
| 8 | Accidental wallet export | A staff member is walked, by a phishing page or a confused support call, into an export flow | UNICA's own POS UI should never surface an "export wallet" affordance (§3.15 keeps wallets off the terminal entirely); disable export via policy controls (§3.10) for any account used as a POS identity | A merchant's own personal Privy account (concept 6, payout wallet) is outside terminal control by definition — ordinary personal-wallet hygiene, not this document's terminal threat model |
| 9 | Customer information left on screen between transactions | The next customer or a shoulder-surfer reads the prior order/amount | An idle screen returns to a neutral "ready" state between orders (PROPOSED UX rule); auto-lock timeout | None beyond ordinary point-of-sale hygiene common to any card terminal |
| 10 | Session fixation via a crafted deep link opened on the kiosk browser | An attacker-supplied login link authenticates the device into a wrong or attacker-controlled account | Allowed-origins restriction (§3.12) limits which origins can use UNICA's Privy app id at all; kiosk mode (`HARDWARE-OPTIONS.md` options B–D) restricts what URLs can be navigated to in the first place | A general browser (option A) is weakest here — nothing stops navigation to an arbitrary URL |

## 6. Lost or stolen device procedure — PROPOSED

1. **Immediately disable the affected staff account** in UNICA's own backend/role table
   (§3.11). This makes the next access-token verification fail regardless of the Privy
   token's own remaining one-hour validity, because UNICA's own authorization check — not
   Privy's token check alone — is what maps a token to a role.
2. If the device is enrolled under hardware option C or D (`HARDWARE-OPTIONS.md`), trigger
   the MDM/EMM remote lock and remote wipe.
3. If the device is option A or B (bring-your-own, or a PWA in Guided Access, with no MDM),
   there is no remote-wipe path documented for either Guided Access
   (`support.apple.com/en-us/111795`) or a browser PWA. The only available control is step 1
   plus, if the staff login used a password-based method, prompting that person (or the
   owner) to change the underlying credential. This is a materially weaker recovery path and
   is a reason to prefer option C/D beyond a pilot (`HARDWARE-OPTIONS.md` §9).
4. There is nothing wallet-side to rotate: per §3.15, no private key should ever have been on
   the device. If the terminal held any locally cached order data, treat it as disclosed.
5. Record the incident: device id (an asset tag, never a personal identifier), the time
   window between loss and step 1, which role was disabled, and whether any order was
   created in that window — checkable on-chain via the order-creator allowlist and the
   receipt schema (`docs/RECEIPT-SCHEMA.md`).
6. Re-provision a replacement device from a clean image (option C/D) or a fresh browser
   profile (option A/B) before returning it to service; never restore from a backup of the
   lost device.

## 7. Kiosk-mode and kiosk-adjacent risks

**VERIFIED.** Guided Access is a consumer, unsupervised-device feature (Settings >
Accessibility > Guided Access on an ordinary iPad), exited by a triple-click of the top or
Home button plus the device's passcode, Face ID, or Touch ID. Apple's own stated limitation is
narrow: "Crash Detection and Emergency Services aren't available while using Guided Access."
Apple's page does not claim Guided Access prevents access to other apps' stored data, survives
a restart, or requires device supervision. Source: `support.apple.com/en-us/111795` (accessed
2026-09-11, direct fetch).

Because Guided Access is exited with the device's own passcode or biometric — not a
credential unique to one staff member — it should be treated as a screen-lock convenience for
customers and bystanders, not a security boundary against staff misuse (see threat-model row 1
in §5).

Apple's Single App Mode (and its app-triggered variant, Autonomous Single App Mode) is a
materially stronger boundary: it requires the device to already be supervised, and is exited
only by an MDM administrator changing or removing the payload — not by anyone who knows the
device's own passcode. Sources: `support.apple.com/guide/deployment/about-device-supervision-dep1d89f0bff/web`
and `developer.apple.com/documentation/devicemanagement/autonomoussingleappmode` (both accessed
2026-09-11, direct fetch). Full detail is in `HARDWARE-OPTIONS.md` §5.

Kiosk risk specific to a payment app: locking the screen to one app does not, by itself,
prevent OS-level remote-management compromise, a malicious keyboard/input method, or an
already-installed malicious accessibility service. Those are addressed by device supervision
and a trusted MDM vendor (`HARDWARE-OPTIONS.md` §5), not by kiosk mode alone.

## 8. Open questions and UNKNOWN items

Consolidated from §3–§7, for visibility rather than left buried in prose:

- The exact key-share count and reconstruction threshold (2-of-2 vs. a 3-share model with an
  optional recovery share) is described differently across different Privy pages and is not
  reconciled here (§3.2).
- Whether Privy's optional HD-wallet feature generates or exposes a BIP-39 seed phrase
  anywhere in the flow (§3.2) — its page was not fetched.
- The content and customizability of the transaction confirmation UI (§3.8).
- Whether an end user, or an app on their behalf, can see and individually revoke a list of
  authorized devices, separate from a full logout (§3.7).
- Whether the Dashboard exposes a per-end-user audit log of logins, MFA events, exports, or
  policy denials (§3.14).
- Whether an administrator can force-revoke one specific other session/device remotely for an
  ordinary (non-delegated) browser login — only the delegated/server-session `revokeWallets`
  path was confirmed (§3.13).
- What happens when a user loses every recovery path at once — device, password, and cloud
  account (§3.5).

## 9. Sources

| URL | Accessed | Status | Used for |
|---|---|---|---|
| `https://docs.privy.io/wallets/overview/embedded` | 2026-09-11 | READ (direct) | §3.2 key custody, secure enclaves |
| `https://docs.privy.io/authentication/user-authentication/mfa/overview` | 2026-09-11 | READ (direct) | §3.3, §3.4 MFA methods and gated actions |
| `https://docs.privy.io/authentication/user-authentication/access-tokens` | 2026-09-11 | READ (direct) | §3.6 token format/lifetime; §3.13 tamper-triggered revocation |
| `https://docs.privy.io/guide/server/authorization/verification` | 2026-09-11 | READ (direct) | §3.11 server-side token verification |
| `https://docs.privy.io/security/wallet-infrastructure/policy-and-controls` | 2026-09-11 | READ (direct) | §3.4, §3.10 policy engine |
| `https://docs.privy.io/authentication/user-authentication/logout` | 2026-09-11 | READ (direct) | §3.13 client-side logout |
| `https://docs.privy.io/guide/security/threat-models` | 2026-09-11 | READ (direct) | §3.2 (2-of-2 sharing), §5 (explicit scope statement) |
| `https://docs.privy.io/guide/delegated-actions/configuration` | 2026-09-11 | READ (direct, partial) | §3.7 delegated actions overview |
| `https://docs.privy.io/authentication/overview`; `.../guide/react/configuration/login-methods` | 2026-09-11 | READ (indexed excerpt) | §3.1 login methods |
| `https://docs.privy.io/guide/expo/authentication/passkey` | 2026-09-11 | READ (indexed excerpt) | §3.1, §3.3 passkey-linking rule |
| `https://docs.privy.io/wallets/wallets/export`; `.../guide/react/wallets/embedded/export` | 2026-09-11 | READ (indexed excerpt) | §3.2, §3.9 client-side export |
| `https://docs.privy.io/controls/authorization-keys/owners/configuration/user/server-export` | 2026-09-11 | READ (indexed excerpt) | §3.2 server-side export |
| `https://docs.privy.io/wallets/advanced-topics/new-devices/cloud-recovery`; `.../guide/react/wallets/embedded/recovery/passwords`; `.../guide/react/wallets/embedded/recovery` | 2026-09-11 | READ (indexed excerpt) | §3.5, §3.7 recovery and multi-device |
| `https://docs.privy.io/basics/get-started/dashboard/app-clients` | 2026-09-11 | READ (indexed excerpt) | §3.6 session-duration setting |
| `https://docs.privy.io/guide/react/configuration/allowed-domains` | 2026-09-11 | READ (indexed excerpt) | §3.12 allowed origins |
| `https://docs.privy.io/wallets/using-wallets/session-signers/remove-session-signers` | 2026-09-11 | READ (indexed excerpt) | §3.13 delegated-session revocation |
| `https://docs.privy.io/basics/get-started/dashboard/teammate-roles` | 2026-09-11 | READ (indexed excerpt) | §3.14 Dashboard teammate roles |
| `https://support.apple.com/en-us/111795` | 2026-09-11 | READ (direct) | §7 Guided Access |
| `https://support.apple.com/guide/deployment/about-device-supervision-dep1d89f0bff/web` | 2026-09-11 | READ (direct) | §7 device supervision |
| `https://developer.apple.com/documentation/devicemanagement/autonomoussingleappmode` | 2026-09-11 | READ (direct) | §7 Autonomous Single App Mode |
| `https://docs.privy.io/authentication/user-authentication/login-methods/overview` | 2026-09-11 | UNREAD (HTTP 404) | attempted for §3.1, superseded by the overview URL above |
| `https://docs.privy.io/wallets/embedded-wallets/export` | 2026-09-11 | UNREAD (HTTP 404) | attempted for §3.2/§3.9, superseded by the export URLs above |
| `https://docs.privy.io/security/authentication/allowed-domains` | 2026-09-11 | UNREAD (HTTP 404) | attempted for §3.12, superseded by the allowed-domains URL above |
| `https://docs.privy.io/guide/dashboard/users` | 2026-09-11 | READ (direct, inconclusive) | attempted for §3.14 dashboard user-management detail; the page loaded but did not describe the specific capabilities asked about |
| `docs/unica-v4/DECISIONS.md`, `docs/unica-v4/SPEC-CONTRACTS.md`, `docs/unica-v4/V5-DEFERRED.md`, `docs/v2/SECURITY-ADVISORY-001.md`, `docs/RECEIPT-SCHEMA.md` | 2026-09-11 | READ (repository) | §2, §4, §5 v4 facts this design must respect |

## 10. Uncertainties

- Three Privy URLs guessed from documentation conventions returned HTTP 404; the equivalent
  current pages were located and read instead, but the exact wording quoted for those topics
  came from a search-index excerpt rather than a freshly rendered page, and should be
  re-confirmed against a live `docs.privy.io` session before this document is used to
  configure an actual Privy application.
- The key-share model discrepancy in §3.2 (2-of-2 vs. a described 3-share recovery model) is
  unresolved. This is a material fact for any real security design and must be re-verified,
  not assumed either way.
- Whether Privy's HD-wallet feature involves a BIP-39 seed phrase anywhere in its flow is
  unknown (§3.2, §8) — its documentation page was not read as of 2026-09-11.
- The transaction confirmation UI's exact content and customizability is unknown (§3.8).
- Whether Privy supports true administrator-initiated remote revocation of one specific
  ordinary (non-delegated) session is unresolved (§3.13) — only the delegated/server-session
  revocation path was confirmed, which is a narrower capability than "remote logout" is
  commonly taken to mean. Any lost-device procedure that assumes Privy itself can remotely
  kill a rogue browser session should not be built until this is confirmed.
- Whether the Dashboard offers a per-end-user audit log is unknown (§3.14).
- Privy remains conditional for UNICA: no UNICA Privy account, app id, or server secret exists
  (`DECISIONS.md` Q95–Q100). Every PROPOSED item in this document is untested against an
  actual UNICA Privy application and should be validated against one, with test data only,
  before being treated as a finished design.
- Cost, support-vendor, and specific MDM/EMM product choices for any of the roles or devices
  described here are out of scope for this document and are not estimated.
