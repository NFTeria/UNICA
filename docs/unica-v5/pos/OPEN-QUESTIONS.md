# Open questions for the owner — UNICA v5 POS

Research draft for owner review. Not committed. Authorizes nothing. UNICA v5 scope; it
does not change or delay the UNICA v4 merge review.

Every question below was raised, unresolved, by one of the six sibling documents in
this directory (`POS-FLOWS.md`, `THEMES.md`, `ACCESSIBILITY.md`, `ADAPTIVE-LAYOUT.md`,
`PRIVY-DEVICE-MODEL.md`, `HARDWARE-OPTIONS.md`). None is answered here. Blocking
questions — ones that gate whether a design assumption elsewhere in this directory
holds — are listed first.

Copy the block below, answer inline, and return it.

```text
P1.  Should a future UNICA contract revision bind `recipient` to an on-chain merchant
     record, closing the gap where any allowlisted order creator can name any address
     as recipient with no on-chain check today?
     Options: (a) leave as an application-level convention only [current state]
              (b) add on-chain merchant-registry binding in a future contract revision
     Recommended: (b), for UNICA v5 — not required for the v4 beta.
     Source: POS-FLOWS.md §9 flag 1 (SPEC-CONTRACTS.md §9.1-§9.2 gap).
     Answer:

P2.  Should the UNICA v5 signed-intent security review (starting from Security
     Advisory 001) be scheduled, and if so when — given it gates any future
     unbound-payer / public-payment-link design?
     Options: (a) not started; revisit after UNICA v4 reaches mainnet
              (b) start now, in parallel with other v5 research
     Recommended: (a) — no unbound-payer design should proceed before v4 stabilizes.
     Source: POS-FLOWS.md §8; docs/unica-v4/V5-DEFERRED.md §8.
     Answer:

P3.  Should UNICA ever configure an actual Privy application (account, app id, server
     secret) for v5 development or testing?
     Options: (a) not yet — remain conditional as today
              (b) begin a test-only configuration now
     Recommended: (a).
     Source: PRIVY-DEVICE-MODEL.md §1; docs/unica-v4/DECISIONS.md Q95-Q100.
     Answer:

P4.  Should Privy's server-side wallet-export capability ever be enabled for any UNICA
     account?
     Options: (a) never enable it
              (b) enable it for a specific recovery flow, if one is ever designed
     Recommended: (a) — never. This is the one documented Privy setting that would
     break UNICA's "never handle a seed phrase / never reconstruct a private key" rule.
     Source: PRIVY-DEVICE-MODEL.md §3.2, §3.15.
     Answer:

P5.  Where should the order-creator private key actually live — a merchant backend
     service (as proposed here), or some other custody arrangement — and what
     is the lost/stolen-terminal-or-backend-credential procedure for it?
     Options: (a) merchant backend only, never on countertop hardware [proposed]
              (b) some other custody model
     Recommended: (a).
     Source: POS-FLOWS.md §3, §9 flag 4; PRIVY-DEVICE-MODEL.md §6.
     Answer:

P6.  Which hardware option (A bring-your-own iPad / B PWA + Guided Access / C a
     UNICA-managed supervised tablet / D custom hardware) should the beta actually
     run on, and at what point should UNICA move from A/B to C?
     Options: (a) A or B for the beta; move to C once merchants extend past
                  founder-controlled/invited test merchants [recommended]
              (b) start with C immediately
              (c) other
     Recommended: (a).
     Source: HARDWARE-OPTIONS.md §9.
     Answer:

P7.  Should UNICA pursue option D (custom POS hardware) at all, even as a longer-term
     path?
     Options: (a) no — not without a separate operational, legal, support, and
                  security review first [recommended]
              (b) yes — begin evaluating vendors/designs now
     Recommended: (a).
     Source: HARDWARE-OPTIONS.md §6, §9.
     Answer:

P8.  Are the proposed UNICA roles (business owner, store manager, cashier, read-only
     accountant) and their permission matrix correct, and should they be ratified into
     DECISIONS.md?
     Options: (a) adopt as proposed
              (b) amend the roles or the matrix before adopting
     Recommended: (a), pending owner review of the specific permission boundary that
     the cashier row never crosses (Safe ownership, contract admin, payout-address
     changes, wallet export/recovery).
     Source: PRIVY-DEVICE-MODEL.md §4.
     Answer:

P9.  Should a future merchant-name-resolution service back the customer review screen,
     so it shows a human-readable name instead of a raw address?
     Options: (a) not designed yet — defer as an open v5 product question
              (b) design a name-resolution service now
     Recommended: (a).
     Source: POS-FLOWS.md §12 U4.
     Answer:

P10. Should email or SMS receipt delivery be added to a future UNICA v5, given it
     requires a new data-collection decision beyond v4's "collects nothing itself"
     posture?
     Options: (a) no — keep on-screen display and printed/on-screen QR only
              (b) yes — design a collection flow for it
     Recommended: (a), for now.
     Source: POS-FLOWS.md §9 flag 6, §7 step 12.
     Answer:

P11. What should the exact countertop order-creation deadline window be (the `deadline`
     passed to `createOrder`)?
     Options: 2 minutes / 3 minutes / 5 minutes (the proposed range) / another value
     Recommended: 5 minutes (favors fewer customer-facing expirations over a
     marginally longer stale-quote window).
     Source: POS-FLOWS.md §7 step 6, §9 flag 3.
     Answer:

P12. Is "selecting the requested settlement currency" (POS-FLOWS.md step 5) correctly
     defined as a per-transaction choice of the ACTIVE market (asset -> payout pair),
     or should it instead be a fixed back-office setting?
     Options: (a) per-transaction customer/market choice [as designed here]
              (b) a fixed back-office setting only
     Recommended: (a), as designed.
     Source: POS-FLOWS.md §9 flag 7, §5.
     Answer:

P13. Should address capture (7a) carry an integrity check beyond visual confirmation,
     before the backend spends gas creating an order that only a correctly-captured
     payer can ever pay?
     Options: (a) visual confirmation only [as designed]
              (b) add a secondary check (e.g. a short code or checksum the customer
                  confirms before order creation)
     Recommended: (b) for a production build; (a) is acceptable for the beta's low
     per-transaction cap.
     Source: POS-FLOWS.md §9 flag 2.
     Answer:

P14. What should the actual compact/regular/wide layout breakpoint pixel thresholds
     be, since no verifiable Apple size-class number could be sourced?
     Options: (a) set UNICA-authored thresholds now
              (b) leave the thresholds open until a build exists to test against
     Recommended: (b) — treat ADAPTIVE-LAYOUT.md §4's matrix as a pattern to implement
     against, not a frozen number.
     Source: ADAPTIVE-LAYOUT.md §4, §9.
     Answer:

P15. Should UNICA ever seek PCI PTS, PCI MPoC/SPoC/CPoC, or EMVCo certification for a
     future card-funded on-ramp?
     Options: (a) not applicable now — no card acceptance exists in the current design
              (b) begin evaluating now, ahead of any such feature
     Recommended: (a) — revisit only if a card-funded on-ramp is actually proposed.
     Source: HARDWARE-OPTIONS.md §7, §9.
     Answer:

P16. Once hardware option C is adopted (see P6), which MDM/EMM vendor and which
     tablet hardware should UNICA evaluate? None was evaluated or named in this
     research.
     Options: owner to name candidates when P6 is resolved in favor of option C
     Recommended: defer until P6 is answered.
     Source: HARDWARE-OPTIONS.md §5, §11.
     Answer:
```
