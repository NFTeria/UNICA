# `unica.eth` address record — owner-action report

**No write has been made and none may be made without separate explicit approval.** Everything
below was read on **2026-09-10** with `eth_call` against Ethereum Sepolia. Nothing here signs,
sends, or spends.

## 1. Which registry, which network

|                         |                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network                 | **Ethereum Sepolia**, chain id `11155111` (`eth_chainId` confirmed)                                                                                                                     |
| Registry                | **ENSv2 ETHRegistry**, `0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2`                                                                                                                     |
| Name                    | `unica.eth` — a **testnet** name. ENSv2's registries hold zero bytes on Ethereum mainnet, and mainnet `unica.eth` belongs to an unrelated third party this project claims nothing from. |
| `namehash("unica.eth")` | `0xa1666e95e38a3be2115a9a801792914ca6dca4fa6297d21e835f284254337537`                                                                                                                    |
| Canonical token id      | `0xf7e0900741e142fd89a2b5423b44e29cca544ab7ae5b907ee61cdad600000000` — `keccak256("unica")` with the low 32 bits cleared, where ENSv2 keeps a version counter                           |

## 2. Current owner and controller

| Read                                    | Result                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ETHRegistry.ownerOf(<token id above>)` | **`0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73`** — this repository's documented deployer |
| `ETHRegistry.getResolver("unica")`      | `0x3D2d26801632e7b13B2fa75236a634e75684988c` (77 runtime bytes — a proxy)                |
| `ETHRegistry.getExpiry(<token id>)`     | `1979061984` — roughly the year 2032, **not expired** (now: `1789065207`)                |

## 3. Current address record

| Read                                                | Result                                           |
| --------------------------------------------------- | ------------------------------------------------ |
| `resolver.addr(bytes32)` on the namehash            | **`0x0000000000000000000000000000000000000000`** |
| `resolver.addr(bytes32,uint256)` with coinType `60` | **`0x`** (empty)                                 |

**`unica.eth` resolves to nothing.** That is why the checkout refuses it: `web/ensv2/resolve.mjs`
fails closed on an unset record rather than treating the zero address as an answer, because the
zero address passes a truthiness check and would produce an order paying nobody.

## 4. Proposed record

|                |                                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposed value | `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73` — the same address that already owns the name                                                                                                                                                                                         |
| Effect         | `unica.eth` becomes usable as the demo merchant name                                                                                                                                                                                                                               |
| Why this name  | It is the one the project **demonstrably owns**. `nfteria` returns the zero address in the ENSv2 ETHRegistry because it is held in **ENSv1** by an unrelated address until 2047, and ENSv2 refuses a label already held in ENSv1 on the same chain. Two registries, one namespace. |

## 5. Signer, and whether this is an on-chain write

**Yes — this is an on-chain write** and it requires a wallet signature.

|                 |                                                                 |
| --------------- | --------------------------------------------------------------- |
| Required signer | `0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73`, the name's owner  |
| Network         | Ethereum Sepolia (`11155111`)                                   |
| To              | `0x3D2d26801632e7b13B2fa75236a634e75684988c` (the resolver)     |
| Value           | `0`                                                             |
| Cost            | Sepolia gas only. No mainnet, no funds moved, no token approved |

## 6. Exact calldata

Two variants exist on this resolver. **Prefer the first**; it is what `addr(bytes32)` reads back.

**`setAddr(bytes32,address)` — selector `0xd5fa2b00`**

```
0xd5fa2b00
a1666e95e38a3be2115a9a801792914ca6dca4fa6297d21e835f284254337537
000000000000000000000000a121e1ef31bbf0826aa67dc01e7977e80af58d73
```

**`setAddr(bytes32,uint256,bytes)` — selector `0x8b95dd71`, coinType 60**

```
0x8b95dd71
a1666e95e38a3be2115a9a801792914ca6dca4fa6297d21e835f284254337537
000000000000000000000000000000000000000000000000000000000000003c
0000000000000000000000000000000000000000000000000000000000000060
0000000000000000000000000000000000000000000000000000000000000014
a121e1ef31bbf0826aa67dc01e7977e80af58d73000000000000000000000000
```

Simulate before signing — a successful `eth_call` from the owner proves the authorisation before
anything is broadcast:

```sh
# The node argument stays on the signature's own line: script/scan.sh refuses a bare 32-byte value
# whose line carries no label word, and "bytes32" in the signature is that label.
cast call 0x3D2d26801632e7b13B2fa75236a634e75684988c \
  'setAddr(bytes32,address)' 0xa1666e95e38a3be2115a9a801792914ca6dca4fa6297d21e835f284254337537 \
  0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73 \
  --from 0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73 --rpc-url sepolia_testnet
```

## 7. Rollback and replacement

An address record is a **mutable field, not an allocation**. There is nothing to undo and nothing
to reclaim.

| To                      | Do                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Point it elsewhere      | Call `setAddr` again with the new address. The last write wins.                                                                                         |
| Return to today's state | Call `setAddr` with `0x0000000000000000000000000000000000000000`. The name resolves to nothing again and the checkout refuses it again, exactly as now. |

No migration, no redeploy, no new name, and no effect on the registration or its expiry.

## 8. Effect on existing orders — none

**Orders already created are unaffected, and this is a property of the contracts rather than a
promise.** The recipient is resolved once, client-side, _before_ the order exists, and is then
stored on chain in `UnicaExecutorV3.Order.recipient`. Settlement reads only that stored value and
never re-resolves a name.

So changing this record cannot redirect an existing order's funds. It can only affect orders
created _after_ the change. The five settled V3 orders on Sepolia keep the recipient they were
created with, whatever `unica.eth` resolves to afterwards.

## 9. Approval status

**Not approved. Not signed. Not broadcast.** This document is a report. Any ENS write is a separate
decision requiring explicit approval, and the signature is the owner's alone.
