# The ENSv2 **testnet** parent name — what to register, and why it cannot be bought from here

> **This is a Sepolia testnet namespace and nothing else.** Every name in this document lives on
> Ethereum Sepolia (chain 11155111). None of it is a mainnet `.eth` name, none of it confers or
> implies any right to a mainnet name, and UNICA claims no ownership of, affiliation with, or
> connection to the mainnet name `unica.eth` or its holder. Sepolia labels are throwaway test
> fixtures. Wherever this repository shows one, it is labelled as testnet.

Every address, code size and availability answer below was read from Sepolia on 2026-09-09 with
`cast`. Nothing here is remembered. The one thing this document does **not** do is register the
name: that needs a wallet signature, which is an owner action in this repository.

## The finding that decides the name

**ENSv2 is a different registry from ENSv1, and Sepolia is a different namespace from mainnet.**
Three facts, each measured, and together they rule out the obvious choices:

| Question | Answer | How it was read |
|---|---|---|
| Does mainnet `nfteria.eth` help on Sepolia? | **No.** Separate chain, separate registry. | `ownerOf` on mainnet BaseRegistrar returns `0x19E5…da7Ae`; the Sepolia registrar knows nothing of it |
| Is `nfteria` free on Sepolia? | **No** — held by `0x0635…dFcE8` until 2047-09-08 | `nameExpires(keccak("nfteria"))` = 2451572532 |
| Is `nfteria` free in **ENSv2**? | **No** | `isAvailable("nfteria")` on the ENSv2 registrar → `false` |

That last row is the one worth keeping. ENSv2's registrar refuses a label already held in ENSv1 on
the same chain, so the v1 registration blocks the v2 one. The two registries are separate contracts
but not separate namespaces.

*This is not someone blocking the project.* The registration predates any of this work and the
holder is unconnected to it; Sepolia `.eth` costs test ETH, so long registrations are ordinary there.

## The pinned ENSv2 Sepolia deployment

Chain 11155111. Sizes and constants read first-hand; the addresses come from
`docs.ens.domains/learn/deployments#sepolia-ensv2-beta`, retrieved 2026-09-09, and each was then
confirmed to hold code.

| Contract | Address | Read back |
|---|---|---|
| RootRegistry | `0x8115186E8f2E0B0281e86ab91f0f48Ba90364354` | 14,730 bytes; `getSubregistry("eth")` → the ETHRegistry below |
| ETHRegistry | `0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2` | 14,730 bytes; `ROOT_RESOURCE()` → **0** |
| ETHRegistrar | `0xa88553f454b77203b0d036a05c894d555eaaa2cc` | 7,497 bytes; `MIN_COMMITMENT_AGE()` 60, `MAX_COMMITMENT_AGE()` 86400 |
| BatchRegistrar | `0x8b16d15f3e51074d0e06f3cf4a0053f7cb92a7fb` | 2,211 bytes |
| StandardRentPriceOracle | `0x8914b66260EB8C4fff795650c3AE8Cd335958987` | reached via `rentPriceOracle()` on the registrar |
| PermissionedResolverImpl | `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` | 17,597 bytes |
| ManagedUniversalResolverProxy | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | 2,491 bytes; `implementation()` → `0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1` |

**`ROOT_RESOURCE() == 0`** is read from the deployed ETHRegistry, not assumed. It is the constant the
role planner must refuse to grant an agent authority on.

### Selectors present in the registrar's dispatch table

Recovered from the runtime bytecode and matched by computing candidate signatures, so each is a
confirmed *entry*, not confirmed *behaviour*:

```
85f3e643  register(string,address,address,address,uint256,uint64)
f14fcbc8  commit(bytes32)
16a92535  commitmentAt(bytes32)
965306aa  isAvailable(string)
5569f33d  renew(uint256,uint64)
7b39ba16  rentPriceOracle()
2e4f692a  MIN_COMMITMENT_AGE()      -> 60
8ccb9ea6  MAX_COMMITMENT_AGE()      -> 86400
```

**`register` reverts bare (`0x`) from every caller tried**, including the registrar's own `owner()`
`0x84D3…39D3` and the BatchRegistrar, at 0, 0.01 and 0.05 ETH, with and without a resolver, on a
pinned Sepolia fork. A commit-then-register attempt using the calldata hash as the commitment
preimage also reverted, so that preimage is wrong. The control that makes this trustworthy: sending
value to the non-payable view `MIN_COMMITMENT_AGE()` reverts the same bare way, which proves the
harness reports a real contract-side refusal rather than a decoding mistake on our side.

**Conclusion: the commitment preimage is not derivable from the ABI alone.** Registering by
hand-built calldata would be guessing. The ENS beta app already knows the preimage, so the name is
registered there.

## What to register

`isAvailable` on the ENSv2 registrar, 2026-09-09:

| Label | ENSv2 Sepolia | ENSv1 Sepolia | Mainnet |
|---|---|---|---|
| `unica` | **free** | free | held by an unrelated third party, `0x2c30…7aBb` — **not ours, not claimed** |
| `rensley` | free | free | **owned by `0x19E5…da7Ae`** |
| `access0x1` | free | free | **owned by `0x19E5…da7Ae`** |
| `nfteria` | taken | taken to 2047 | **owned by `0x19E5…da7Ae`** |

**Register `unica` on Sepolia, as a test fixture.** It is the project's own product name, and it is
free in both Sepolia registries.

**And say what it is not.** A Sepolia registration is technically independent of mainnet — different
chain, different registry, no conflict — but *technically independent* is not *unrelated in the way
that matters to a reader*. Mainnet `unica.eth` belongs to a third party who has nothing to do with
this project. So the rule for every document, README row, demo caption, screenshot and spoken line
is: **name the network.** Write `unica.eth` **(Sepolia testnet)**, never bare `unica.eth`. Do not
imply, in prose or by omission, that UNICA owns the mainnet name, is affiliated with its holder, or
has any claim on it. If a sentence would read as a mainnet claim when quoted alone, it is wrong even
if the surrounding paragraph explains it.

`access0x1` is deliberately not chosen. It is disclosed prior art for this event; putting it in the
namespace would tie a from-scratch entry to earlier work for no benefit.

## The namespace this produces

All Sepolia (chain 11155111). No mainnet name appears anywhere in this tree.

```
unica.eth                              (Sepolia testnet)  owner: the merchant wallet
  merchant.unica.eth                   (Sepolia testnet)  merchant identity
    pay.merchant.unica.eth             (Sepolia testnet)  public settlement config
    treasury.merchant.unica.eth        (Sepolia testnet)  public policy metadata
      agent.treasury.merchant.unica.eth  (Sepolia testnet)  the delegated agent
```

If a shorter form is needed in a UI, use `unica.eth` **on Sepolia** — never the bare name.

## The owner action

One name, on Sepolia, paid in test ETH. `0x19E56831a10d43CfF5d77f886c799C6b916da7Ae` holds
0.2086 Sepolia ETH, which covers it; the deployer `0xA121…8D73` holds 1.5766 if you would rather the
name and the contracts share a wallet.

Open the ENSv2 Sepolia beta app from the official ENS documentation, connect the wallet that should
own the test namespace, and **confirm the wallet is on Ethereum Sepolia before anything else**.
Register `unica` only if the app plainly identifies it as a Sepolia ENSv2 registration — if the
screen is ambiguous about the network or the registry, stop rather than sign. Read the target
contract, value, duration and expiry in the wallet before confirming. Grant no roles during
registration; the agent's permissions come later, are resource-scoped, and never touch
`ROOT_RESOURCE`.

Send back four things and nothing else: **owner address · registration transaction hash · the full
resulting Sepolia name · expiry.** Never a private key, seed phrase, session token, keystore or raw
wallet export — none of those are ever needed here, and I will not accept one.

Confirm afterwards, and this must print a non-zero registry before any of the delegation work runs:

```sh
cast call 0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2 'getSubregistry(string)(address)' unica \
  --rpc-url sepolia_testnet
```

## Status

`AWAITING_PARENT_REGISTRATION` — Sepolia testnet only. The deployment is pinned, the label is chosen
and verified free, and the only missing input is a signature this repository does not take on the
owner's behalf. No mainnet name is registered, requested, claimed or implied by any of this.
