# Uniswap Developer Feedback Form — prepared answers

**The form is a human action.** Everything below is drafted so the owner can review and paste. It is
not submitted, and nothing here impersonates the owner or supplies contact details.

Replace `<FINAL_SHA>` with the final pushed commit before submitting, and re-check that each link
resolves at that SHA.

---

**Project name**

> UNICA

**Public repository**

> https://github.com/NFTeria/UNICA

**Final commit**

> `<FINAL_SHA>`

**Developer feedback file**

> https://github.com/NFTeria/UNICA/blob/`<FINAL_SHA>`/FEEDBACK.md

---

**Which Uniswap components did you use?**

> Uniswap v4 core: `PoolManager` (unlock/settle/take accounting, `beforeInitialize`, `beforeSwap`,
> `afterSwap` hook callbacks, exact-output swaps), the hook permission-bit address encoding, and
> `HookMiner` for CREATE2 salt mining. Uniswap's official Universal Router as the sole admitted
> swap sender for V1. Permit2 `permitWitnessTransferFrom` for the payer's authorization in V2.
>
> Tests run against Uniswap's **deployed bytecode** rather than mocks — the official PoolManager
> artifact is etched at its canonical address, and the fork suites use the real deployed contracts
> on Ethereum Sepolia.

**What did you build?**

> A settlement hook that binds a merchant's invoice to the swap that discharges it. A customer pays
> with a supported asset; the merchant receives the exact asset and amount the invoice specified;
> Uniswap performs the conversion; and no UNICA contract takes beneficial custody of either leg —
> asserted on real balance deltas, not claimed in a diagram.
>
> V1 is deployed and source-verified on Ethereum Sepolia with a settlement receipted on chain. V2 is
> written and frozen as `v2.0.0-rc1`, is **not** shipped, and its release is blocked pending
> remediation of an internally identified Critical finding that we found and published ourselves.

**Biggest integration challenge**

> Permit2's `witness` parameter has no documented contract about what it must contain, and a witness
> that binds only the signer's own half of a two-party agreement is a total-loss bug that nothing
> refuses.
>
> Our `Payment` witness covered six fields — all of them the payer's half: which invoice, who pays,
> in what token, up to how much, into which venue, through which executor. It read complete. The
> merchant's half sat outside it, and Permit2's own digest adds nothing that separates them, because
> the spender is the same executor for every caller. So two invoices differing only in
> `merchantSigner` and `recipient` produce a byte-identical payer signing digest, and one payer
> signature funds either. The loss ceiling is the payer's entire signed `maxIn`.
>
> We reproduced it end to end against the official PoolManager and the official Permit2 runtime,
> blocked the release, and published the advisory. The full write-up, with the exact code, the
> measured numbers and the remediation comparison, is in `FEEDBACK.md` under the 2026-09-08 entry.

**Specific feedback for the Uniswap team**

> **One sentence on the signature-transfer page would have prevented it.** The page documents
> `permitWitnessTransferFrom` and both witness parameters and contains no guidance on what a witness
> should contain and no warning about omitting fields. Its "Security Considerations" section covers
> caller-context validation generally and does not reach witness content. We suggest:
>
> > The witness must commit to every term of the agreement, including the terms the other party
> > chose. Permit2 verifies only that the owner signed something; it cannot know which fields of
> > your application's agreement matter. A witness that omits a counterparty's fields lets one
> > signature authorise any agreement that shares the fields you did include.
>
> A worked **two-signer** example would do more. Every published witness example we found has one
> signer, and with one signer this class of bug cannot occur — the trap is invisible until a second
> signer appears, and by then the witness type string is in production and moving it is a breaking
> change for every wallet that has signed one.
>
> **Two smaller items, both reproduced:**
>
> - The template `uniswap-ai`'s own `v4-security-foundations` skill hands out does not compile
>   against current public `v4-periphery` / `v4-core`: a stale `BaseHook` import with no working
>   replacement in that repository, and a `SwapParams` reference to a type `IPoolManager` no longer
>   declares.
> - `v4-hook-generator` in the same plugin calls an MCP tool the plugin does not ship, and runs to
>   its final step before failing there.
>
> **Documentation URL drift:** `docs.uniswap.org/contracts/permit2/reference/signature-transfer`
> 301s to `developers.uniswap.org/contracts/permit2/...`, which 303s again to a
> `docs/protocols/...` path. The first URL is still widely linked.
>
> **Specific praise, since it is the same integration.** v4's unlock/`take` accounting is why this
> product can exist at all. The payer's token goes from the payer straight to the PoolManager and
> the output goes straight to the merchant; the settlement contract never holds either leg, and we
> assert that on real balance deltas. A payments integrator gets non-custodial settlement as a
> property of the venue instead of something they must build, audit and insure. That is a large
> thing to be handed, and it is worth saying next to the complaint.

**May we follow up with you?**

> **Owner decides.** Left blank deliberately — no contact details are committed to a public
> repository.

---

## Before submitting — owner checklist

1. Replace every `<FINAL_SHA>` and confirm each link resolves at that commit.
2. Confirm `FEEDBACK.md` at that SHA contains the 2026-09-08 Permit2 entry.
3. Decide the follow-up permission question and supply contact details **in the form only**.
4. Submit personally. Record the confirmation privately — not in this repository.

## What must not be claimed on the form

V2 is deployed, shipped, safe to release, or audited. Any prize, placement or finalist status at any
event. Endorsement, affiliation or review by Uniswap. Mainnet anything.
