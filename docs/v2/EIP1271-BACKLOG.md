# Backlog — EIP-1271 merchant signers

**Not scheduled. Not filed anywhere public.** This is a local record of a decision and of what the
decision defers, so that whoever picks it up starts from the questions rather than from scratch.

## The ruling

The V2 release candidate supports **EOA merchant signers only**. EIP-1271 is not implemented in this
slice, and no claim is made that every merchant wallet can issue a V2 quote.

## What is true today

- `QuoteSettlementExecutor._validate` verifies the merchant's quote with OpenZeppelin's
  `ECDSA.recover` and compares the recovered address to `quote.merchantSigner`.
- A contract cannot produce a signature that recovers to its own address, so a smart-contract wallet
  or multisig cannot be a merchant signer. `test/fork/V2ForkRefusals.t.sol` deploys a contract that
  returns ERC-1271's magic value to *anything* it is asked and it is still refused.
- The **payer's** side is different, and the difference matters: the payer authorises through
  Permit2, which branches on `claimedSigner.code.length` and does support EIP-1271. A
  contract-wallet payer works today.
- On a real chain an "EOA" can have code. EIP-7702 lets any account delegate, and the fork suite
  records that the well-known test key `0xe05fcC23…0cfF7` holds 23 bytes beginning `0xef0100` on
  Sepolia. A 7702-delegated merchant EOA still signs with its key and still works, because
  `ECDSA.recover` does not look at code; a contract wallet does not.

## What a future slice has to answer

Each of these is a reason the work is a version of its own rather than a patch.

1. **Return magic.** ERC-1271 specifies `0x1626ba7e`, but a wallet may return anything. What is
   accepted, and is a non-magic return distinguishable from a revert?
2. **Revert and malformed return.** A wallet that reverts, returns nothing, returns 31 bytes, or
   returns a bomb. Each must be a refusal and none may be fatal to the caller.
3. **Gas.** An ERC-1271 call is an external call of unbounded cost inside a settlement. What is the
   ceiling, and what happens at it?
4. **Reentrancy.** The signature check becomes a call to merchant-controlled code, executed before
   the PoolManager unlock. The active-context guard already refuses a nested settlement; that has to
   be re-proved with the merchant, not a token, as the reentrant party.
5. **Upgradeable merchant wallets.** A wallet that approves today and would refuse tomorrow. Does a
   quote's validity depend on state that can change after signing, and if so, does the quote's
   deadline bound it tightly enough?
6. **Counterfactual signatures.** ERC-6492 covers wallets not yet deployed. Supported, refused, or
   out of scope?
7. **Chain and domain replay.** The quote's domain already binds chain id and the executor's
   address. A contract wallet may validate across chains; does that reopen anything the domain
   closed?
8. **Revocation.** An EOA cannot un-sign. A contract wallet can, by changing its own validation. Is
   a revoked-but-unexpired quote a state UNICA should be able to observe?

## What must not happen meanwhile

- No public GitHub issue without owner approval.
- No documentation that implies contract-wallet merchants are supported, or coming.
- No quiet widening of `_validate` to try `ECDSA` and then fall back to a call.
