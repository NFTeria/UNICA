# Screenshot captions and alt text

Six captured. The form asks for at least three — pick from these. Every one is a real screen
photographed as it rendered; none is a mock-up, and none has been retouched.

Captured at commit `8bf4115` on 2026-09-09, at 1440×900 (the Arc console at
1440×1100 because its content is taller), headless Chrome at device scale 1 — so there is no
browser chrome, no bookmarks bar, no tab strip and no personal window in any frame.

---

### 01 · `01-hero-pay-with-unica.png` — **recommended**

**Caption.** A payer sends ETH; the merchant is paid in USDC. One transaction, on Uniswap v4.

**Alt text.** The UNICA checkout page. A payment-link card shows recipient, payer, an input of
0.001 ETH, and a minimum output of 1.306197 USDC against a live quote of 1.346595 USDC read from
Ethereum Sepolia. It states that one order has been registered on Sepolia so far.

**Why it earns a slot.** It is the product in one screen, and the quote is live rather than typed.

---

### 02 · `02-live-sepolia-evidence.png` — **recommended**

**Caption.** Nine values read from Ethereum Sepolia and compared against what the release pinned.
Seven agree, zero disagree.

**Alt text.** A comparison table with Read, Live and Pinned columns: chain id 11155111; 10,634
bytes of code at the hook and 11,289 at the executor; the hook and executor naming each other;
StateView's PoolManager; pool fee 3000; a non-zero sqrtPrice; and pool liquidity 204325880000.
Every row reads "agrees". Below it, verified sources on Sourcify and Blockscout, the canonical
receipt transaction, and the release tag `live-green` at commit `5e1d843`.

**Why it earns a slot.** It is the claim and its proof in the same frame, and a reader can re-run
every row.

---

### 03 · `03-exact-settlement-flow.png`

**Caption.** What the merchant agrees to before anything is signed — and what the hook will refuse.

**Alt text.** The payment-link card in full: recipient, payer, input, minimum output with its
slippage basis, deadline, the single wallet prompt, and the line "the hook refuses or the recipient
is paid; nothing in between".

---

### 04 · `04-arc-treasury-two-decimal-scales.png` — **recommended**

**Caption.** The same USDC balance on Arc, at two different scales, at one block — and the reason
they are never added.

**Alt text.** The Arc treasury console on Arc testnet, chain id 5042002. Two balances side by side:
865034306.417121 read from the ERC-20 contract at 6 decimals, and 865034306.417121744253729820 as
the native gas currency at 18 decimals, each showing where its scale came from. Below: the bounded
policy — reserve floor, per-action cap, cooldown, approved counterparties — a decision of
RELEASE_APPROVED_PAYMENT within all limits, and an unsigned transaction preview.

**Why it earns a slot.** It shows a finding, not a feature: on Arc the same money reports at two
scales, and reading the wrong one is wrong by a factor of 10¹².

---

### 05 · `05-confidential-workflow-simulation.png`

**Caption.** The Chainlink CRE confidential workflow running in Chainlink's own simulator — which
is not a real TEE, and says so.

**Alt text.** Terminal output from `cre workflow simulate`. The simulator reports "Handler
requested TEE Execution" and warns it is not a real TEE. Two user logs show secrets loading and a
decision of RESTORE_MINIMUM_RESERVE. The published result carries a policy commitment, an action
class and a reason category, and an evidence grade of CRE_CONFIDENTIAL_SIMULATION.

**Note for whoever selects.** This is a transcript of a real run, pasted verbatim, with the binary
and config hashes above it. It is deliberately not called live DON execution or TEE attestation.

---

### 06 · `06-sponsor-status-grid.png`

**Caption.** What is live and what is not, per track, in the project's own words.

**Alt text.** A status table: Uniswap v4 settlement LIVE on Sepolia with make proof at 14/14 and
31/31; Chainlink CRE SIMULATED, not a real TEE, deploy access pending; ENSv2 owner-gated, UNICA
owns no ENS name; The Graph owner-gated, no successful live read ever observed; Arc owner-gated,
nothing broadcast; UNICA V2 frozen and blocked by an open Critical found and published by the team.

**Why it earns a slot.** It states the limits before a judge has to find them.

---

## What is deliberately absent from every frame

No wallet address other than public deployment contracts and the zero address used as the demo
merchant. No API key, no `.env` value, no private RPC, no tunnel URL. No terminal user name, host
name or filesystem path. No browser chrome, bookmark or personal tab. No sponsor logo and no
endorsement wording. No fabricated hash and no fabricated balance.

`evidence-page-source.html` is the source of shots 05 and 06 and is committed beside them, so the
rendering can be reproduced rather than taken on trust.
