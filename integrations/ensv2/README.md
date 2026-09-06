# integrations/ensv2 — tests and evidence for ENSv2 merchant resolution

The module itself is **not here**. It lives at [`web/ensv2/`](../../web/ensv2/), because the
checkout surface publishes `web/` exactly as committed — no install, no build, no transform — so
the page has to be able to import it directly. Keeping one copy under `web/` and testing it from
here beats keeping two copies in step.

| file | what it is |
|---|---|
| `test.mjs` | 36 offline rows plus 7 live ones. `node integrations/ensv2/test.mjs`, add `--live` for Sepolia |
| `live-check.mjs` | read-only evidence capture: one success and every failure shape, with the wire encoding, namehash, resolver and classification printed |

`make gate` runs the offline rows. `make gate-live` adds the ones that resolve real names.

## Why the tests inject the caller

`resolveMerchant` takes an `rpcCall`. That is not indirection for its own sake: a live network
will not produce a malformed return or a truncated address on demand, and those are exactly the
shapes that must be refused. The offline rows synthesise them; the live rows exist because a mock
proves the module handles a shape, never that the shape is real.
