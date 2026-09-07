# Compatibility report 001 — the V2 receipt does not carry `merchantConfigHash`

**Raised by:** building the V2 Graph indexer namespace against the frozen `v2.0.0-rc1` receipt.
**Status:** open. **No interface was changed.** The freeze holds; this is the report the ruling asks
for instead of an edit.

## The finding

The build order's required field list for `InvoiceSettlement` includes a *policy/configuration hash*.
The frozen receipt carries fifteen fields and `merchantConfigHash` is not among them:

```
quoteId · recipient · payer · schemaVersion · quoteDigest · merchantSigner · hook · poolId
tokenIn · actualIn · maxIn · tokenOut · amountOut · deliveredOut · policyVersion
```

`merchantConfigHash` **is** a field of the `Quote` struct, and it **is** inside `quoteDigest` — the
digest is an EIP-712 hash over the whole quote, so the commitment is covered by the receipt even
though it is not readable from it.

## What that costs, precisely

| Question | Answerable from the receipt alone? |
|---|---|
| Was a settlement recorded for this quote digest? | **Yes** |
| Which merchant configuration did the merchant commit to? | **No** — you need the quote |
| Did the settled quote commit to *this specific* configuration? | **Yes, if you hold the quote**: recompute the digest and compare |
| Show me every settlement for merchant configuration X | **No** — there is nothing to filter on |

So nothing is *unverifiable*; one class of *query* is unavailable. That distinction is the whole
report, and it is why this is a compatibility note rather than a bug.

## What was done instead of editing the freeze

The schema has **no** `policyConfigurationHash` field. Writing `quoteDigest` into a field with that
name would have satisfied the field list and produced a schema that lies — the two are different
values with different meanings, and an auditor reading the second name would draw a false
conclusion. The absence is documented in the schema itself, at the point where a reader would look
for it.

## Options, for a later decision

1. **Accept the gap.** Cost: nothing. The digest covers the commitment; the verifier tool
   (`tools/unica-verify`) resolves it for anyone holding the quote. Loses the
   "settlements by merchant configuration" query, which no current product path asks for.
2. **Add the field in `v2.0.0-rc2`.** Cost: the receipt becomes sixteen fields, so **the event topic
   changes** — every indexer watching the old topic silently sees nothing, which is the failure mode
   the freeze document already warns about. Also: freeze regeneration, executor size (about +100
   bytes on 18,369 of 24,576), an indexer migration, and a mutation re-run. Gains the query.
3. **Emit a second event.** Rejected. "Exactly one receipt per settlement" is a frozen claim with a
   test behind it, and two events would make "one settlement" ambiguous to anything counting logs.

## Recommendation

Option 1 until a product path actually needs the query. The commitment's job is to be *inside what
the merchant signed*, and it is; being *also* readable from a log is a convenience, and buying it
costs a topic change — the one change in the frozen surface that fails silently rather than loudly.
