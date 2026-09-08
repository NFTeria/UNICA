# unica-verify — read-only verification of a UNICA V2 settlement receipt

One question, answered honestly: **does this transaction receipt record a settlement of *this*
quote?**

```sh
node tools/unica-verify/cli.mjs --input tools/unica-verify/fixtures/fork-settlement.json
node tools/unica-verify/cli.mjs --input <evidence.json> --json
node tools/unica-verify/cli.mjs --input <evidence.json> --rpc-env SEPOLIA_RPC_URL --check-consumed
```

Exit status is 0 only when every mandatory check passed.

## It recomputes; it does not read and agree

The receipt carries a `quoteDigest`. Reading it back out and reporting it verifies nothing, because
the emitter chose that value — and the emitter is exactly what is in question. So:

- the **quote digest** is rebuilt from the quote's own fields with `tools/unica-sign`,
- the **merchant's address** is recovered from the signature over the *rebuilt* digest,
- the **PoolId** is rebuilt from the complete pool key,
- the **merchant configuration commitment** is rebuilt from its preimage with
  `integrations/ensv2/config.mjs`,

and only then is any of it compared with the log. Ten sabotages in `test.mjs` encode the shortcut
version of each of those and require the real check to refuse what the shortcut accepts.

## What it will not do

It has no key, no signing path and no way to send a transaction. Online mode reaches a chain through
a client that refuses any JSON-RPC method which is not a query — `eth_sendTransaction`,
`eth_sendRawTransaction`, `personal_sign` and every `anvil_*`/`hardhat_*` cheat are rejected before a
request is built, and there are rows proving it. An endpoint is redacted to scheme, host and port
everywhere it could appear, errors included, because an RPC URL routinely carries a key.

## What it does not say

- It is **not** a statement that a payment is final, irreversible, or owed.
- Offline mode believes the receipt JSON it is handed. Only online mode establishes that the
  transaction is in a chain at all. Confirmations are reported and no depth is declared final.
- EOA merchant signers only. ERC-1271 contract signers are outside V2 (see
  `docs/v2/EIP1271-BACKLOG.md`) and are not checked here.
- **A settlement's absence proves nothing** about whether an invoice was paid by another route, at
  another time, or on another chain.
- **V2 is not deployed to any public chain.** The settlement in the fixture exists only inside a
  local fork.

## The evidence

`fixtures/fork-settlement.json` is a real transaction receipt, captured by `script/v2/fork-settle.sh`
off a local anvil fork of Ethereum Sepolia — the official PoolManager, the official Permit2, Circle's
USDC and canonical WETH9, all at their live code, with the V2 contracts deployed into the node. The
fixture is what an RPC client is handed, trimmed of nothing: the settlement is one of four logs, and
finding it among the others is half the job.

Re-capture it with a node running (`make anvil`):

```sh
make verify-fixture     # settles once on the local node and rewrites the fixture
make verify-online      # the suite, including the RPC rows
```

## The suite

```sh
node tools/unica-verify/test.mjs                                    # 100 rows, no network
UNICA_VERIFY_RPC=http://127.0.0.1:8545 node tools/unica-verify/test.mjs   # 109 rows
```

One positive control, 30 negatives altering exactly one field each, and 10 sabotages. It runs in
`make gate`, offline, because a verifier whose own suite could only run against a chain would be
untestable exactly when a chain is unavailable.
