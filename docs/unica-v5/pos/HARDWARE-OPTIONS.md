# UNICA v5 POS — hardware options

Status: PROPOSED research for a future business capability. UNICA does not manufacture,
resell, provision, or ship point-of-sale hardware today, and this file is not a decision
to start. Ordering hardware, opening a device-management account, or configuring Privy is
out of scope for this document and is not performed here.

Every claim about Apple's supervision, Guided Access, Single App Mode, or Apple Business
Manager is checked against Apple's own developer/support documentation; every claim about
Android dedicated-device mode is checked against Android Enterprise documentation. Where a
source did not load after one retry it is listed as UNREAD in Sources and nothing is
inferred from it.

## Contents

1. Purpose and method
2. The four options compared
3. Option A — bring-your-own iPad, managed web app
4. Option B — installed PWA in Guided Access / kiosk mode
5. Option C — managed tablet supplied by UNICA
6. Option D — dedicated custom POS hardware
7. Card-reader certifications: PCI PTS, PCI DSS, EMV, MPoC
8. Comparison table
9. Recommendation for the beta — PROPOSED
10. Sources
11. Uncertainties

## 1. Purpose and method

This file evaluates ordering, provisioning, and operating point-of-sale hardware as a
**future** UNICA business capability, against four options, compared in §2. It is
research, not a decision: no hardware is ordered here, no device-management account is
opened, and no Privy application is configured. `PRIVY-DEVICE-MODEL.md` in this same
directory covers the staff-identity and wallet-security side; this file covers the physical
device and its management.

Method: Apple's own developer and support documentation (`support.apple.com`,
`developer.apple.com`) was read for Guided Access, device supervision, and Single App Mode /
Autonomous Single App Mode. Android's own developer documentation
(`developer.android.com`) was read for Android Enterprise dedicated-device (lock task) mode.
The PCI Security Standards Council's own overview page (`pcisecuritystandards.org`) was read
for the PCI DSS/PTS/P2PE/SPoC/CPoC/MPoC family; more granular MPoC and EMVCo detail came from
third-party payments-industry summaries rather than the Council's or EMVCo's own primary
documents, and is marked as such. All access dates are 2026-09-11. A URL that did not resolve
is listed UNREAD in §10, and nothing here is inferred from it.

## 2. The four options compared

| Option | What it is |
|---|---|
| A | A merchant's own (bring-your-own) iPad, running UNICA's checkout as an ordinary web app in a general browser |
| B | The same bring-your-own tablet, but UNICA's checkout is installed as a home-screen Progressive Web App and the device is put into Apple's consumer Guided Access mode |
| C | A tablet UNICA itself procures, enrolls in Apple Business Manager / MDM (or the Android Enterprise equivalent), and supervises as a dedicated device |
| D | Purpose-built POS hardware, commissioned or manufactured for UNICA, running UNICA's own software stack |

Full evaluation is in §3–§6; the side-by-side comparison is in §8; the beta recommendation is
in §9.

## 3. Option A — bring-your-own iPad, managed web app

- **Security.** Weakest of the four. The device is unsupervised and unenrolled in any MDM.
  Whatever screen-lock exists is whatever the merchant already set up for personal use.
- **Device management.** None. Patch level, OS version, installed apps, and browser
  extensions are entirely outside UNICA's control or visibility.
- **Updates.** The merchant's own responsibility; UNICA cannot force a browser or OS update.
- **Support burden.** Low direct burden for UNICA (no hardware owned), but high variance — any
  browser or OS quirk on a device UNICA never configured becomes "UNICA's checkout is
  broken."
- **Cost.** PROPOSED, unsourced order-of-magnitude estimate: $0 incremental hardware cost to
  UNICA, since the merchant already owns the device.
- **Compliance implications.** Weakest option: no supervision means no enforced restriction
  set and no audit trail of device configuration.
- **Repair/replacement.** The merchant's own problem and cost.
- **Remote wipe.** Not available — there is no MDM enrollment to issue a wipe command
  through. A consumer "Find My"-style wipe, if enabled, is controlled by the merchant's own
  personal account, not UNICA's.
- **App distribution.** A plain web app: no app-store review, no provisioning profile, and no
  app-level sandboxing beyond whatever the browser itself provides.
- **Card-reader certification relevance.** Unchanged by this option: any physical card reader
  ever attached still needs its own PCI PTS/EMV/MPoC certification independent of how the
  tablet is configured (§7). A browser-based flow that itself touched card data would put
  whoever processes it inside PCI DSS scope.
- **UNICA hardware-operations responsibility.** None — UNICA never owns or touches this
  device.

## 4. Option B — installed PWA in Guided Access / kiosk mode

- **Security.** Modestly better than A for keeping a customer or bystander inside one app, but
  Guided Access is, per Apple's own documentation, an unsupervised-device, consumer feature
  with no stated guarantee about isolating other apps' data, and it is exited with the same
  device passcode or biometric that unlocks the device generally — not a credential unique to
  one staff member. Source: `support.apple.com/en-us/111795` (accessed 2026-09-11, direct
  fetch); full discussion in `PRIVY-DEVICE-MODEL.md` §7.
- **Device management.** Still none — no MDM. Guided Access is configured by hand, per device,
  by whoever has physical access to it.
- **Updates.** The operator must remember to exit Guided Access to update the OS or the
  installed PWA; nothing enforces this.
- **Support burden.** Moderate: a misconfigured Guided Access passcode (one staff don't know)
  locks staff out of the device entirely.
- **Cost.** Same as A: $0 incremental hardware (PROPOSED, unsourced).
- **Compliance implications.** Still no supervision-backed restriction set or audit trail;
  better than A for narrowing what a customer or bystander can reach, but not for insider
  misuse — the same device passcode that exits Guided Access is not a strong per-staff
  boundary (`PRIVY-DEVICE-MODEL.md` §5, row 1).
- **Repair/replacement.** The merchant's own problem and cost, as in A.
- **Remote wipe.** Not available, same as A.
- **App distribution.** A home-screen PWA install; no app-store review since it isn't a native
  app, but also no MDM-pushed silent install — a staff member adds it to the home screen by
  hand on each device.
- **Card-reader certification relevance.** Same note as A.
- **UNICA hardware-operations responsibility.** Minimal — UNICA authors the PWA, not the
  device's own configuration.

## 5. Option C — managed tablet supplied by UNICA

- **Security.** The strongest tablet-based option. Enrolling via Apple Business Manager's
  Automated Device Enrollment supervises the device automatically; Apple states supervision
  "provides additional control over its configuration and restrictions" beyond an
  unsupervised device. Source:
  `support.apple.com/guide/deployment/about-device-supervision-dep1d89f0bff/web` (accessed
  2026-09-11, direct fetch). Supervision is also the documented **prerequisite** for Apple's
  Single App Mode / Autonomous Single App Mode payload, which restricts the device to one app
  and is exited only by an MDM administrator changing or removing the payload — not by
  whoever knows the device passcode. Source:
  `developer.apple.com/documentation/devicemanagement/autonomoussingleappmode` (accessed
  2026-09-11, direct fetch). The Android equivalent is Android Enterprise's dedicated-device
  ("lock task") mode, which likewise runs the device "locked to an allowlisted set of apps,"
  managed by a device policy controller (DPC) through full enterprise enrollment. Source:
  `developer.android.com/work/dpc/dedicated-devices` (accessed 2026-09-11, direct fetch).
- **Device management.** Full MDM/EMM control: push configuration, restrict Wi-Fi/Bluetooth,
  disable the camera, restrict installable apps to an allowlist, and monitor compliance.
- **Updates.** MDM can pin, delay, or push OS and app updates on a schedule UNICA controls.
  Android's dedicated-device documentation states a DPC can "freeze" the OS version to
  suspend over-the-air updates during a critical period (`developer.android.com/work/dpc/dedicated-devices`,
  accessed 2026-09-11). The equivalent Apple deferral mechanism under supervision/MDM was not
  independently fetched as of 2026-09-11 — **UNKNOWN**, listed in §11 rather than assumed
  parallel to Android's.
- **Support burden.** Moderate, and now UNICA-controlled: UNICA (or its MDM vendor) owns
  break/fix triage for a device fleet it did not have to own under A/B.
- **Cost.** PROPOSED, unsourced order-of-magnitude placeholders, not vendor quotes: a
  commodity supervised tablet is commonly priced in the low hundreds of US dollars per unit,
  plus a per-device MDM/EMM subscription commonly in the low single digits of US dollars per
  device per month across the industry. Both figures must be replaced with a real vendor quote
  before any purchasing decision.
- **Compliance implications.** Supervision plus MDM gives UNICA an audit trail of device
  configuration and compliance state that options A/B do not have — relevant groundwork for a
  future PCI DSS scoping exercise if UNICA ever accepts card data directly on these devices
  (§7).
- **Repair/replacement.** UNICA's own responsibility and cost, as the device owner.
- **Remote wipe.** Available through the MDM/EMM vendor's own console once enrolled, for both
  an Apple ABM/MDM fleet and an Android Enterprise fleet — the capability options A/B lack
  entirely (`PRIVY-DEVICE-MODEL.md` §6 leans on this for a lost/stolen device).
- **App distribution.** MDM-based fleets commonly support silent, volume app distribution
  without an end user's personal store account (Apple's Apps and Books / VPP-style
  distribution; Android's managed Google Play). The precise mechanism UNICA would use is a
  build-time decision, not settled here, and was not independently re-verified against
  Apple's or Google's current developer documentation beyond the general MDM capability
  already cited.
- **Card-reader certification relevance.** Becomes directly relevant the moment UNICA attaches
  or bundles a card reader (§7). The tablet itself is not a certified payment device; whatever
  reader/software combination actually takes a card needs its own PCI PTS and/or PCI
  MPoC/SPoC/CPoC certification, and PCI DSS governs however the resulting cardholder data is
  stored, transmitted, or processed. None of that is decided or built by choosing option C.
- **UNICA hardware-operations responsibility.** Yes, materially: UNICA becomes the fleet owner
  — procurement, enrollment, support, and retirement — for every unit it supplies. This is a
  business commitment beyond writing software, and it is not decided by this document (§9).

## 6. Option D — dedicated custom POS hardware

- **Security.** Potentially the strongest of the four in principle — a single-purpose device
  has no general-purpose browser and no unrelated apps, and could in principle ship with a
  locked bootloader — but this is a claim about what custom hardware could be, not an
  evaluation of any vendor, bill of materials, or firmware UNICA has actually reviewed. No
  such vendor or design was assessed for this document.
- **Device management.** Fully custom: UNICA, or a hardware partner, would own firmware update
  delivery outright — a materially larger engineering and security commitment than adopting
  an existing MDM/EMM under option C.
- **Updates.** Entirely UNICA's or its vendor's responsibility to build a secure update
  channel. Getting this wrong is a larger risk than any of options A–C, not a smaller one.
- **Support burden.** The highest of the four: hardware support (repairs, replacement parts,
  defective-unit returns) on top of firmware support on top of the application itself.
- **Cost.** PROPOSED, unsourced order-of-magnitude placeholders for planning discussion only,
  not quotes: off-the-shelf dedicated payment terminals from established vendors commonly
  retail from roughly one hundred to several hundred US dollars per unit; a fully custom
  design additionally carries non-recurring engineering, certification, and tooling costs that
  can run from the tens of thousands of dollars upward depending on volume.
- **Compliance implications.** If this device ever directly captures a card (contact,
  contactless, or PIN), it needs its own PCI PTS approval for the physical device and EMVCo
  Level 1 (hardware/RF) and Level 2 (per card-scheme "kernel") certification — a formal, paid,
  third-party laboratory process, not a configuration UNICA can self-attest. See §7.
- **Repair/replacement.** UNICA's own responsibility and cost, as manufacturer or distributor.
- **Remote wipe.** Only if UNICA builds it — nothing comes for free the way it does with an
  existing MDM vendor under option C.
- **App distribution.** Fully custom: sideloading or a bespoke update mechanism, with all of
  the code-signing and integrity questions that implies.
- **Card-reader certification relevance.** This is the option most directly implicated by PCI
  PTS/EMV/MPoC (§7), because the hardware itself — not a tablet running someone else's
  certified peripheral — is the thing that would need certifying.
- **UNICA hardware-operations responsibility.** Yes, maximally: manufacturing or commissioning
  manufacture of payment hardware is a distinct business line with its own legal, safety, and
  certification obligations, separate from writing software. This document does **not**
  recommend pursuing it for the initial beta, and it should not be pursued without a separate
  operational, legal, support, and security review.

## 7. Card-reader certifications: PCI PTS, PCI DSS, EMV, MPoC

**VERIFIED**, from the PCI Security Standards Council's own standards overview
(`pcisecuritystandards.org/standards/`, accessed 2026-09-11, direct fetch):

| Standard | What it certifies |
|---|---|
| PCI DSS | Applies broadly to organizations that store, process, or transmit payment card data — governs UNICA's own systems and any card data reaching them, independent of which hardware option is chosen |
| PCI PTS (Point of Interaction) | Certifies the physical payment terminal/device itself, for protecting PINs, account data, and other sensitive data at the point of interaction |
| PCI P2PE | Point-to-point encryption, from capture to decryption, for payment solution providers |
| PCI SPoC | Software-based PIN entry on a commercial off-the-shelf (COTS) device — a PIN typed directly on a phone or tablet rather than a dedicated PIN pad |
| PCI CPoC | Contactless payments on a COTS device |
| PCI MPoC | The newer, unified standard combining SPoC- and CPoC-style capability (both PIN and contactless) in one certified software solution on COTS hardware |

**VERIFIED, third-party summary (not the Council's own page).** PCI MPoC was released by the
PCI Council in November 2022, and a MPoC-compliant solution is assessed against a large set
of individual security requirements (cited as 192) spanning software integrity, attestation
and monitoring, backend security, and vulnerability resilience. Source: payments-industry
summaries at `payfelix.com` and `eazypaytech.com` (accessed 2026-09-11) — these are secondary
sources describing the PCI Council's standard, not the Council's own primary document, and are
flagged as such rather than presented as first-party.

**VERIFIED, third-party summary.** A device that reads EMV cards (contact, contactless, or
both) needs EMVCo Level 1 certification for the reader hardware/RF, and Level 2 certification
for each card-scheme "kernel" (application) it runs; a device that accepts a PIN or otherwise
captures sensitive cardholder data at the point of interaction needs a PCI PTS approval.
Source: a summary at `spilma.com` describing EMVCo/PCI PTS device certification (accessed
2026-09-11) — again a secondary source, not EMVCo's or the Council's own primary document.

**Relevance by option.**

- **Options A and B** change nothing about these requirements. A card reader plugged into or
  paired with a bring-your-own or managed-web-app tablet still needs its own PTS/EMV/MPoC
  certification independent of how the tablet is configured — UNICA does not certify the
  tablet; it, or its reader vendor, certifies the reader/software.
- **Option C's** MDM/supervision groundwork is relevant to PCI DSS's requirements around
  device configuration and access control, but does not by itself satisfy PTS, EMV, or MPoC.
- **Option D** is the option where UNICA, or a manufacturing partner, would need to carry
  these certifications directly, because the device itself is what captures card data.

**Scope note for UNICA today.** Nothing in UNICA's current or planned beta flow, as described
elsewhere in this repository, takes a physical card at all — the fixture and the v4 design
settle a payer's own on-chain signed authorization, not a card swipe or tap (`DECISIONS.md`
Q5–Q7, Q53; `SPEC-CONTRACTS.md`). This section exists to establish whether these certifications
are relevant to the four hardware options in general, not because
UNICA has a current card-acceptance design. If a card-funded on-ramp is added later and read
by one of these devices, this section is the starting checklist, not a completed compliance
review.

## 8. Comparison table

| | A: bring-your-own | B: PWA + Guided Access | C: UNICA-managed tablet | D: custom hardware |
|---|---|---|---|---|
| Security | Weakest — unsupervised, unenrolled | Screen-locked to one app, but exited by the ordinary device passcode | Supervised; Single App Mode / lock task mode exited only by an MDM admin | Potentially strongest in principle; unevaluated in practice |
| Device management | None | None (manual, per device) | Full MDM/EMM | Fully custom, UNICA/vendor-built |
| Updates | Merchant's own responsibility | Merchant's own responsibility | MDM-scheduled, can be deferred | UNICA/vendor must build the channel |
| Support burden | Low direct, high variance | Moderate | Moderate, UNICA-owned | Highest |
| Cost (unsourced, order-of-magnitude) | ~$0 incremental | ~$0 incremental | Low hundreds of USD/unit + a per-device MDM fee | ~$100s/unit off-the-shelf, or tens of thousands+ NRE for custom |
| Compliance groundwork | Weakest | Weak | Audit trail + configuration control | Strongest, if built correctly — and riskiest if not |
| Repair/replacement | Merchant's | Merchant's | UNICA's | UNICA's/vendor's |
| Remote wipe | Not available | Not available | Available via MDM/EMM | Only if UNICA builds it |
| App distribution | Plain web app | Home-screen PWA, manual install | MDM silent push (mechanism TBD) | Fully custom |
| Card-reader certs relevant? | Yes, for any attached reader | Yes, for any attached reader | Yes, for any attached reader | Yes, directly on the device itself |
| UNICA becomes a hardware operator? | No | No | Yes | Yes, maximally |

## 9. Recommendation for the beta — PROPOSED

Given UNICA v4's own beta caps ($10/transaction, $25/day, $100 total at risk, founder-
controlled or specifically invited test merchants only — `DECISIONS.md` Q5–Q7, Q35) and that
Privy remains conditional with no UNICA account, app id, or server secret provisioned
(`DECISIONS.md` Q95–Q100), the lowest-commitment option that still offers a real security
boundary at this scale is **option A or B**, run only on a device the operator already trusts
— not a general bring-your-own-anything policy — accepting the residual risks catalogued in
`PRIVY-DEVICE-MODEL.md` §5 as within the beta's own $100-at-risk ceiling.

**Option C** is the right next step the moment UNICA moves past founder-controlled or invited
test merchants (Q35) to a broader merchant population, because it is the first option with a
real remote-wipe and device-supervision story (§5, §8).

**Option D** is explicitly **not recommended** for the initial beta, and should not be pursued
without the separate operational, legal, support, and security review named in §6. This
document is research toward that future review, not the review itself.

None of this authorizes ordering hardware, opening an MDM/EMM account, or configuring a Privy
application; those remain owner decisions outside this document's scope.

## 10. Sources

| URL | Accessed | Status | Used for |
|---|---|---|---|
| `https://support.apple.com/en-us/111795` | 2026-09-11 | READ (direct) | §4 Guided Access description and limitation |
| `https://support.apple.com/guide/deployment/about-device-supervision-dep1d89f0bff/web` | 2026-09-11 | READ (direct) | §5 device supervision, Automated Device Enrollment |
| `https://developer.apple.com/documentation/devicemanagement/autonomoussingleappmode` | 2026-09-11 | READ (direct) | §5 Single App Mode / ASAM prerequisite and exit mechanism |
| `https://developer.android.com/work/dpc/dedicated-devices` | 2026-09-11 | READ (direct) | §5 Android Enterprise dedicated devices, lock task mode, DPC, OTA freeze |
| `https://www.pcisecuritystandards.org/standards/` | 2026-09-11 | READ (direct) | §7 PCI DSS/PTS/P2PE/SPoC/CPoC/MPoC family definitions |
| `payfelix.com` MPoC summary; `eazypaytech.com` MPoC summary | 2026-09-11 | READ (third-party, indexed) | §7 MPoC requirement count and scope — secondary sources, not the Council's own document |
| `spilma.com` EMVCo/PCI PTS summary | 2026-09-11 | READ (third-party, indexed) | §7 EMVCo Level 1/Level 2 certification split — secondary source |
| `docs/unica-v4/DECISIONS.md` | 2026-09-11 | READ (repository) | §9 beta caps and merchant-invite restriction |
| `docs/unica-v4/SPEC-CONTRACTS.md` | 2026-09-11 | READ (repository) | §7 scope note on v4's non-card settlement design |
| Various secondary sites (NinjaOne, ManageEngine, Addigy, LogMeIn, 42gears) surfaced while searching for Apple Business Manager/supervision detail | 2026-09-11 | Consulted only to locate the correct official Apple URLs above; not cited as sources of fact in this document | — |

## 11. Uncertainties

- Apple's own OS-update-deferral mechanism under supervision/MDM was not independently
  fetched — only Android's equivalent "freeze OTA updates" capability was confirmed directly
  (§5). Do not assume Apple's mechanism works identically until it is checked.
- All per-device hardware and MDM/EMM subscription costs in §5–§6 are unsourced
  order-of-magnitude placeholders for planning discussion, explicitly not vendor quotes, and
  must be replaced with real quotes before any purchasing decision.
- PCI MPoC's detailed requirement count and EMVCo's Level 1/Level 2 mechanics were read from
  third-party payments-industry summaries, not the PCI Security Standards Council's or
  EMVCo's own primary documents beyond the one standards-overview page fetched directly. A
  higher-stakes decision — actually pursuing MPoC or EMVCo certification — should re-derive
  these details from the Council's and EMVCo's own primary documents, not from this file.
- Whether UNICA's app-distribution mechanism under option C would use Apple's Apps and
  Books/VPP-style volume distribution or Android's managed Google Play was described only at
  the general "MDM can silently push apps" level from secondary sources, not independently
  verified against Apple's or Google's own current developer documentation as of 2026-09-11.
- No specific MDM/EMM vendor was evaluated, named, or compared. This document describes
  platform-level capabilities (Apple's own frameworks, Android Enterprise), not any
  particular commercial MDM product's implementation of them.
- Guided Access's exact behavior regarding whether other apps' stored data remains reachable
  while it is active was not stated in the fetched Apple support page, and is not asserted
  either way here.
- No vendor, bill of materials, or firmware source was reviewed for option D; every claim
  about what custom hardware "could" achieve is a statement about the option's theoretical
  ceiling, not an evaluation of any real device.
