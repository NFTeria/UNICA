# design/ — the one page, the one action

What a person sees, and the single thing they do. This is the brief the public surface is
built from on its day; it is written now so the hook is built toward a surface, not the
other way round.

## Who is on the page

A payer with a wallet holding ETH on a testnet, who owes a recipient a fixed amount of USDC.
They have never seen this repository. They will not read a README.

## What they see, top to bottom

1. **Who pays, with what.** Their connected address, the chain (must be the supported
   testnet; anything else is a clear blocker, not a silent failure), and "You pay: ETH".
2. **Who receives, what, and the minimum.** The recipient address, "They receive: USDC",
   the quoted amount, and the minimum they will accept. The minimum is the bound; the quote
   is information.
3. **Through what.** The pool and the hook, by address, each linked to the explorer. One
   sentence: "Settlement goes through a Uniswap v4 pool guarded by this hook; the hook
   refuses any path that does not deliver to the recipient."
4. **What authorisation is being asked.** For native ETH: none beyond the transaction. For
   an ERC-20 payer later: the exact spender, the exact amount, the expiry. Never "Approve".
5. **The one action.** A single button: **Settle**. Disabled until every field above is
   valid. Pressing it opens exactly one wallet prompt.
6. **What happened.** Pending (with the hash the moment it exists), then either success or
   failure. Success means the transaction is mined with status 1 and the receipt event was
   decoded from it, never the wallet's "submitted". The decoded receipt is shown as a
   sentence: who paid what, who received what, through which pool and hook, at which block,
   with the explorer link. Failure shows the revert reason in words and leaves the money
   where it was.

## What is deliberately absent

No token picker, no route options, no chart, no history feed on this page, no settings. A
second page shows settlement history once the indexer exists; it is not this page.

## The test of the page

A stranger, given the URL and a funded testnet wallet, completes one settlement and can
say afterwards who paid, who received, and where the proof is. If they cannot, the page
is not done.
