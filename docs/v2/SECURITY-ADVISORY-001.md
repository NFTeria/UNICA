# Security advisory 001 — the payer's Permit2 witness does not bind the merchant's half of the quote

| | |
|---|---|
| **Severity** | **Critical** |
| **Status** | **OPEN. Reproduced, not fixed.** The defect is in a frozen file; the fix is an rc2 decision and belongs to the owner. |
| **Affects** | `v2.0.0-rc1` — `src/v2/QuoteSettlementExecutor.sol`, lines 339–342 (`paymentWitness`) and 436–439 (`_witnessOf`) |
| **Deployed?** | **No.** V2 has never been deployed or broadcast to any chain. No funds are at risk today. |
| **Found by** | Internal security review, 2026-09-08. Three of five independent review dimensions reached it separately. |
| **Reproduced by** | `test/v2/WitnessBinding.t.sol` — runs in the default gate, on every push |

> **The release candidate `v2.0.0-rc1` must not be deployed.** This is not a hardening
> recommendation. A settlement built with this executor can be redirected in full to a stranger by
> anyone who sees the payer's authorisation, which includes every relayer and every observer of a
> pending `settle` transaction.

## The defect

The payer signs a Permit2 `PermitWitnessTransferFrom` whose witness is UNICA's `Payment` struct:

```solidity
string public constant PAYMENT_TYPE =
    "Payment(bytes32 quoteId,address payer,address tokenIn,uint256 maxIn,address destination,address executor)";
```

Six fields. All six are the payer's own half of the deal: which invoice, who is paying, in what
token, up to how much, into which venue, through which executor.

**The merchant's half is not there.** `recipient`, `merchantSigner`, `tokenOut`, `amountOut` and
`pool` are all outside the witness. Permit2's own digest adds only the token permissions
(`tokenIn`, `maxIn` — already witnessed), the spender, the nonce and the deadline; the spender is
this executor for every caller, so it separates nothing.

So **two quotes that differ only in `merchantSigner` and `recipient` produce a byte-identical payer
signing digest**, and one payer signature is valid for both.

Nothing downstream closes it:

- `merchantSigner` is checked only against a signature over the same quote
  (`ECDSA.recover(digest, merchantSignature) != q.merchantSigner`). It is self-referential. **There
  is no merchant registry or allowlist anywhere in `src/v2/`**, so any EOA may be a `merchantSigner`.
- The hook's `consumed` map is keyed on the **quote** digest. `merchantSigner` and `recipient` are
  inside `hashQuote`, so the forged quote has a different digest and the replay guard does not fire.
- The hook binds the swapper, the pool, the direction, exact-output and the delivered floor. It
  never sees `recipient` or `merchantSigner`.
- `_proveThePayment` measures the balance change of `q.recipient` — which, in the forged quote, is
  the attacker. It confirms the attacker was paid, exactly as designed.

This directly contradicts the contract's own header at lines 29–32:

> WHAT A RELAYER MAY CHOOSE: nothing. Not the Permit2 destination, not the PoolManager, not the
> hook, not the recipient…

The recipient and the entire merchant half are precisely what a relayer may choose.

## The attack, in order

1. A merchant signs quote `Q` — invoice `0x…`, payer `P`, `tokenIn` 10 ETH ceiling, `tokenOut`
   1,000,000,000, recipient `M`.
2. `P` signs the matching Permit2 authorisation, nonce `N`. Both halves now exist off-chain, and
   both halves are held by whoever is going to submit `settle` — by construction.
3. The attacker (the relayer itself, or anyone who sees the pending `settle` calldata in the
   mempool) rebuilds the quote with `merchantSigner` and `recipient` set to their own address, and
   signs it with **their own key**.
4. The attacker calls `settle(forged, attackerSignature, auth)` with `P`'s authorisation
   **completely unchanged**, front-running the honest transaction.
5. Every check in `_validate` passes. The swap runs. `actualIn <= maxIn` holds, `deliveredOut ==
   amountOut` holds, the witness matches, Permit2 accepts `P`'s signature, and `take` sends the
   output to the attacker.
6. A well-formed `QuoteSettled` receipt is emitted, naming the attacker as recipient.
7. The honest transaction then reverts on the spent Permit2 nonce.

The payer is debited in full. The merchant is paid nothing and cannot retry with that
authorisation. This is a theft, not a duplicate payment.

## Measured

`forge test --match-path 'test/v2/WitnessBinding.t.sol'`, against the repository's own fixture and
Uniswap's official PoolManager bytecode:

```
actualIn pulled from payer:  1003010032
deliveredOut:                1000000000
thief tokenOut:              1000000000
honest recipient tokenOut:            0
payer debited:               1003010032
```

Six rows, all green, including three controls:

| Row | What it establishes |
|---|---|
| `test_Control_TheQuoteIdMovesTheWitness` | the witness is not simply constant — the field the existing suite varies does move it |
| `test_Control_EveryWitnessedFieldMovesTheWitness` | `payer`, `maxIn` and `tokenIn` each move it, one at a time |
| `test_TheMerchantHalfIsOutsideThePayerWitness` | the forged quote's **merchant** digest moves and its **payer** witness does not — both halves asserted, because either alone would be misread |
| `test_KNOWN_DEFECT_APayerAuthorisationFundsAnyMerchantsQuote` | the exploit, executed end to end |
| `test_KNOWN_DEFECT_TheHonestSettlementCannotFollow` | the nonce is spent; the merchant stays unpaid |
| `test_Control_AnHonestSettlementStillSucceeds` | the same fixture settles honestly, so the rows above are evidence about the contract and not about the harness |

The two `KNOWN_DEFECT` rows are **characterisation tests**: they assert what the frozen code does
today, not what it should do. That keeps the gate honest and green while the defect is unfixed, and
it guarantees that a fix cannot land without breaking them.

## Why the existing suite missed it

Two rows look like they cover this and do not:

- `test_Refuse_APayerAuthorisationForAnotherQuote` (`test/v2/SettlementRefusals.t.sol:277`) varies
  only `quoteId` — which **is** inside the witness, so the refusal it observes is real but is about
  a different field.
- `test_Gate0_Permit2_AWitnessForAnotherQuoteIsRefused` (`test/v2/Permit2Witness.t.sol`) likewise
  varies only `quoteId`; its helper `_payment(quoteId, amount)` structurally cannot vary
  `recipient`.

The attack keeps `quoteId` identical. `test/v2/SettlementRefusals.t.sol:176` proves every signed
field is inside the **merchant** digest, which is true and is not the question.

There is also a trap worth recording, because the first attempt at the exploit failed on it:
`Quote memory forged = q;` **aliases** `q` rather than copying it, so mutating `forged` mutates the
original and the two digests come out equal. The proof must build a second struct. A reviewer who
stopped at that first red would have concluded the finding was wrong.

## The fix

Put the quote digest — the value `_validate` already computes — inside the witness. `_witnessOf`
already takes `digest` as a parameter and discards it.

```solidity
string public constant PAYMENT_TYPE =
    "Payment(bytes32 quoteId,bytes32 quote,address payer,address tokenIn,uint256 maxIn,address destination,address executor)";
```

with `quote` bound to the EIP-712 quote digest. That binds everything the merchant signed —
recipient, signer, output token and amount, pool, deadline, config hash, policy version — plus the
domain, which already carries the chain id and the executor address. The named fields stay so a
wallet can still render the payment in human terms.

This is not a free edit. It moves the payer's signing digest, so it is an **rc2**, and it belongs
to the owner.

### What moves with it

Twelve files derive or pin the witness:

```
src/v2/QuoteSettlementExecutor.sol      test/v2/util/QuoteSigning.sol
test/v2/Permit2Witness.t.sol            test/v2/Settlement.t.sol
test/v2/InterfaceFreeze.t.sol           integrations/permit2/digest.mjs
integrations/permit2/test.mjs           tools/unica-sign/unica.mjs
tools/unica-sign/test.mjs               tools/unica-sign/vectors.json
docs/v2/RELEASE-CANDIDATE-FREEZE.md     docs/v2/release-candidate.json
```

plus `tools/unica-verify/fixtures/`, the fork fixture, and the frozen blob hashes and executor
creation-code hash in `docs/v2/release-manifest.json`.

### What does NOT move — a correction

The review's first cost estimate said the mined hook address moves with the fix. **It does not.**
The executor is deployed by plain `CREATE`, so its address is `keccak(rlp(deployer, nonce))` and is
independent of its bytecode. The hook's creation code embeds the executor's **address**, not its
code hash. Change the executor's source, and given the same deployer and nonce the hook's creation
code hash — and therefore its mined salt and address — are unchanged.

Size is not a constraint either: the executor's deployed code is 18,369 bytes of the EIP-170 limit,
with 6,207 bytes of headroom. The added field costs a small constant.

## What is not claimed here

- No V2 contract is deployed, so **nothing is exploitable on any chain today**. The severity is
  Critical because of what the code would do if deployed, not because of a live loss.
- V1 is a separate, unrelated codebase and is **not affected**: it has no Permit2 path and no
  merchant-signed quote. Its live deployment is untouched by this advisory.
- The fix above is stated, not implemented or tested. Its correctness is an assertion about a
  design, and it earns nothing until an rc2 exists with a row that inverts the two
  `KNOWN_DEFECT` tests above.
