# UNICA — tech stack

> **A merchant's till becomes a portfolio — and the portfolio still spends.**
>
> Exact settlement today. Merchant-controlled treasury automation is being built.

Every row below was verified against this tree on **2026-09-08** with the command in its
Evidence column. Nothing here is written from memory: versions come from `foundry.toml`,
`package.json`, `bun.lock`, submodule SHAs and `--version` output; statuses come from what
actually ran.

The split is strict and it is the whole point of this page:

- **CORE / LIVE** — the presented version, V1. Deployed and source-verified on Ethereum
  Sepolia, with one settlement receipted on chain.
- **IMPLEMENTED / LOCAL OR OWNER-GATED** — real code, real tests, **nothing deployed**.
  A local test is not a deployment and a simulator is not an enclave.

UNICA is built by **NFTeria**. It is independent: not commissioned by, affiliated with,
endorsed by or reviewed by Uniswap or any sponsor. **No part of UNICA has been audited.**

---

## 1 · Short — form-ready

Paste-ready for a submission form's "tech stack" field.

> **Live (Ethereum Sepolia, source-verified):** Solidity 0.8.30 · Foundry · Uniswap v4
> (v4-core, v4-periphery, Universal Router, PoolManager) · OpenZeppelin `uniswap-hooks`
> v1.1.1 · hookmate v0.6.0 · forge-std · Circle USDC (Sepolia) · JavaScript (ESM) on
> Node.js 22 with **zero third-party runtime dependencies** · GitHub Actions.
>
> **Implemented, tested, not deployed:** Chainlink CRE Confidential Workflow
> (`@chainlink/cre-sdk` 1.18.0, TypeScript 5.9.3, bun) — runs in Chainlink's own simulator,
> which the CLI states is **not a real TEE** · ENSv2 Universal Resolver v2, Permissioned
> Resolver and Enhanced Access Control — live read-only Sepolia rows, UNICA owns no ENS
> name · The Graph / GraphQL (graph-cli 0.98.1, graph-ts 0.38.2, matchstick-as 0.6.0,
> AssemblyScript) — **subgraph not deployed** · Arc / Circle USDC (Arc testnet, chain
> 5042002) — treasury flow and page, **nothing broadcast** · Permit2 — **V2 only, and V2 is
> frozen at v2.0.0-rc1 and blocked** · Vyper 0.4.0 + Moccasin 0.4.4 (settlement and merchant
> split model) · plain HTML/CSS checkout surface, no framework and no build step.
>
> **Proof:** `make gate` → 182 Solidity tests, 82 Vyper, 1,543 JavaScript rows across 14
> suites. `make proof` → 14/14 + 31/31 read back from the chain.

**Even shorter, if the field is a one-liner:**

> Solidity 0.8.30 · Foundry · Uniswap v4 hook + executor, live and source-verified on
> Ethereum Sepolia · JavaScript (ESM, no dependencies) on Node.js · plus Chainlink CRE,
> ENSv2, The Graph, Arc and Vyper implemented and tested locally, none of them deployed.

---

## 2 · Long — the README version

### 2.1 CORE / LIVE

Deployed on **Ethereum Sepolia** (chain id `11155111`), source-verified, with one settlement
on chain. Re-derive the whole block with `make proof`.

| Technology | Role | Source path | Evidence command | Status | Version | Public URL |
|---|---|---|---|---|---|---|
| **Solidity** | the hook and the executor | `src/V4SettlementHook.sol`, `src/SettlementExecutor.sol`, `src/libraries/UniswapDeployments.sol` | `grep -n _version foundry.toml` | LIVE AND VERIFIED | `solc 0.8.30`, `evm_version = cancun` (EIP-1153 transient storage), `via_ir = false`, `bytecode_hash = none`, `cbor_metadata = false` | [soliditylang.org](https://soliditylang.org) |
| **Foundry** (forge · cast · anvil) | build, test, fuzz, script, deploy, verify. There is no other build system. | `foundry.toml`, `Makefile`, `script/` | `forge --version` · `grep -n 'version: v1' .github/workflows/ci.yml` | LIVE AND VERIFIED | CI pins **v1.5.1** (`foundry-rs/foundry-toolchain@v1`). The machine this page was verified on ran `forge 1.3.5-foundry-zksync-v0.1.9` — see Limitations. | [getfoundry.sh](https://getfoundry.sh) |
| **Uniswap v4 — v4-core** | `PoolManager`, `Hooks`, `PoolKey`, `BalanceDelta`, `BeforeSwapDelta`, the flash-accounting lock | `lib/uniswap-hooks/lib/v4-core` (remapped `@uniswap/v4-core/`) | `git -C lib/uniswap-hooks/lib/v4-core rev-parse HEAD` | LIVE AND VERIFIED — official `PoolManager` `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | `d153b048868a60c2403a3ef5b2301bb247884d46` (`v4.0.0-19-gd153b048`) | [github.com/Uniswap/v4-core](https://github.com/Uniswap/v4-core) |
| **Uniswap v4 — v4-periphery** | `IV4Router`, `Actions`, `ActionConstants`, `IMsgSender` — the Universal Router path the hook admits | `lib/uniswap-hooks/lib/v4-periphery` (remapped `@uniswap/v4-periphery/`) | `git -C lib/uniswap-hooks/lib/v4-periphery rev-parse HEAD` | LIVE AND VERIFIED — official Universal Router `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` | `7ebd04b161745b75ed0c24ba2df3bc7c25f65606` (no tag on this commit) | [github.com/Uniswap/v4-periphery](https://github.com/Uniswap/v4-periphery) |
| **OpenZeppelin `uniswap-hooks`** | `BaseHook` (the hook base class the live contract inherits) and `IHookEvents` (the standard `HookFee` event the receipt emits alongside UNICA's own) | `lib/uniswap-hooks` (remapped `@openzeppelin/uniswap-hooks/`) | `git -C lib/uniswap-hooks describe --tags` — CI asserts the SHA | LIVE AND VERIFIED | **v1.1.1** = `bd5287c4a9f5c22c2393f7587a9b357662916115`, asserted byte-for-byte in `.github/workflows/ci.yml` | [github.com/OpenZeppelin/uniswap-hooks](https://github.com/OpenZeppelin/uniswap-hooks) |
| **hookmate** | `AddressConstants` — chain-id → canonical v4 addresses in the live contracts; and the **official `PoolManager` runtime bytecode** the test base deploys instead of recompiling | `lib/hookmate` (remapped `hookmate/`), used in `src/` and `test/utils/SettlementTestBase.sol` | `git -C lib/hookmate describe --tags` | LIVE AND VERIFIED | **v0.6.0** = `ef3e9845e0b2bc9cd5810644d7d337b00c47bc75` | [github.com/akshatmittal/hookmate](https://github.com/akshatmittal/hookmate) |
| **forge-std** | the test and script standard library | `lib/forge-std` (remapped `forge-std/`) | `git -C lib/forge-std describe --tags` | LIVE AND VERIFIED (build-time) | `452bdecf8772bf113532f67c5cf3accb71895cd0` (`v1.16.2-17-g452bdec`) | [github.com/foundry-rs/forge-std](https://github.com/foundry-rs/forge-std) |
| **Ethereum Sepolia** | the only chain UNICA is deployed to. Every script refuses any chain id that is not a listed testnet, by construction. | `script/Chains.sol`, `src/libraries/UniswapDeployments.sol` | `bash docs/proof/verify-live.sh` | LIVE — hook `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0`, executor `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210`, **one settlement receipted** | chain id `11155111` | [hook on Etherscan](https://sepolia.etherscan.io/address/0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0) · [executor](https://sepolia.etherscan.io/address/0x044bc8a8773EC7b9B8de2467766636dFFCaC6210) · [settlement tx](https://sepolia.etherscan.io/tx/0x1120af1810f249ecf366f0a13a1c8cd3dbe0633487849c1d3bcc0a29ee0ecb83) |
| **Circle USDC (Sepolia testnet)** | the one payout currency V1 may settle into, resolved from the chain id and not configurable | `src/libraries/UniswapDeployments.sol:payoutCurrency` | `cast call 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 'decimals()(uint8)' --rpc-url https://ethereum-sepolia-rpc.publicnode.com` | LIVE — the merchant was paid in it | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, 6 decimals. **Sepolia testnet USDC — a different chain and a different contract from the Arc row below.** | [developers.circle.com/stablecoins/usdc-contract-addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| **JavaScript (ES modules)** | every off-chain tool: the receipt verifier, the client signing tool, the ENS resolution chain, the Arc treasury model, the CRE policy engine, the subgraph checks, the freeze and ledger validators | `tools/`, `integrations/**/*.mjs`, `script/*.mjs`, `web/` | `node --version`; the dependency check is the fenced command in §4 (it uses a shell pipe, so it is not repeated inside this table) | LIVE (gated on every push) — **1,543 rows across 14 suites, 0 failed** | Node.js **v22.12.0** measured today. **Zero third-party runtime dependencies**: the command opposite returns only `node:` builtins. | [nodejs.org](https://nodejs.org) |
| **GitHub Actions** | the gate that runs on every push: one definition shared with `make gate`, plus a fresh-clone lane, a provenance lane and a secret scan | `.github/workflows/ci.yml` | `make gate` | LIVE | `ci.yml` — jobs `gate`, `fresh-clone`, `provenance`; the Solidity count is asserted, not assumed | [github.com/NFTeria/UNICA/actions](https://github.com/NFTeria/UNICA/actions) |

**Not in the live path — checked, not assumed:**

> **Permit2 is NOT used by the presented version.**
> `grep -rn -i permit2 src/SettlementExecutor.sol src/V4SettlementHook.sol src/libraries/` returns
> nothing. Permit2 appears only under `src/v2/`, and V2 is not shipped. It is listed in §2.2.

> **TypeScript is NOT used in the live path.** The live contracts are Solidity and every
> shipped off-chain tool is plain `.mjs`. TypeScript appears only in the Chainlink CRE
> workflow (§2.2); the subgraph mappings are AssemblyScript, compiled by `graph-cli`.

---

### 2.2 IMPLEMENTED / LOCAL OR OWNER-GATED

Real code, named tests, **nothing deployed**. Every status word here is chosen to be
un-upgradeable by a reader in a hurry.

| Technology | Role | Source path | Evidence command | Status | Version | Public URL |
|---|---|---|---|---|---|---|
| **Chainlink CRE** | a real Confidential Workflow: `handlerInTee` reads five private policy values **inside** the handler and publishes a commitment, an action class and a reason category — never a threshold | `integrations/chainlink-cre-guardian/workflow/` (`main.ts`, `guardian.ts`, `workflow.yaml`), policy engine in `integrations/chainlink-cre-guardian/*.mjs` | `cd integrations/chainlink-cre-guardian/workflow && bun test` → **30 pass, 0 fail, 860 expect() calls** · `node integrations/chainlink-cre-guardian/test.mjs` → 88 rows · `node integrations/chainlink-cre-guardian/adapter-test.mjs` → 86 rows | **IMPLEMENTED — SIMULATOR ONLY.** `cre workflow simulate` exits 0 and reports "Handler requested TEE Execution"; secrets load inside the handler; no threshold reaches any published field. Evidence grade `CRE_CONFIDENTIAL_SIMULATION`. **The CLI states its simulator is not a real TEE. Nothing has run in an enclave.** Deploy access requested, pending Chainlink's review. | `@chainlink/cre-sdk` **1.18.0** · `viem` **2.56.3** (bun.lock) · `typescript` **5.9.3** · runtime **bun**, `engines.bun >= 1.2.21` declared and unchecked by the CLI (this machine: bun 1.2.5) | [npmjs.com/package/@chainlink/cre-sdk](https://www.npmjs.com/package/@chainlink/cre-sdk) |
| **ENSv2** | merchant discovery: a payer types a name, the surface resolves it and shows the address **before** payment; plus who may *change* that record — Permissioned Resolver and Enhanced Access Control read live | `integrations/ensv2/`, `web/ensv2/resolve.mjs`, `src/v2/MerchantConfig.sol` | `node integrations/ensv2/permissioned-test.mjs` → **278 rows** · `node integrations/ensv2/test.mjs` → 136 · `node integrations/ensv2/identity-test.mjs` → 95 · live rows: `make gate-live` | **IMPLEMENTED — LIVE READ-ONLY ROWS.** 278 offline + 78 live Sepolia rows; the authorization contrast (same calldata ACCEPTED from the role-holder, REFUSED from a probe) is observed on the deployed resolver. **UNICA owns no ENS name — every live row reads a name somebody else registered.** Nothing is written, ever. | `UpgradableUniversalResolverProxy` `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` on Sepolia; 2,491 bytes read back 2026-09-05 | [docs.ens.domains/ensv2/universal-resolver-v2](https://docs.ens.domains/ensv2/universal-resolver-v2) · [permissioned-resolver](https://docs.ens.domains/ensv2/permissioned-resolver) · [enhanced-access-control](https://docs.ens.domains/ensv2/enhanced-access-control) |
| **The Graph / GraphQL** | two subgraphs: V1 settlement receipts, V2 invoice settlements; plus a live Graph client and a deterministic treasury copilot over the indexed rows | `integrations/graph/` (V1), `integrations/graph-v2/` (V2), `*/schema.graphql`, `*/src/mapping.ts` | `node integrations/graph-v2/check.mjs` → 40 · `node integrations/graph-v2/provider-test.mjs` → 147 · `node integrations/graph-v2/copilot-test.mjs` → 115 · mapping tests: `make graph-v2-test` | **IMPLEMENTED — NOT DEPLOYED. No subgraph has been deployed to Subgraph Studio and no successful live read has ever been observed.** `make graph-v2-live` exits non-zero with `UNICA_SUBGRAPH_URL` unset, so an absent endpoint can never read as a pass. Studio deploy is an owner action. | `@graphprotocol/graph-cli` **0.98.1** · `@graphprotocol/graph-ts` **0.38.2** · `matchstick-as` **0.6.0** · manifest `specVersion 1.0.0`, `apiVersion 0.0.9`, `wasm/assemblyscript` | [thegraph.com/studio](https://thegraph.com/studio/) · [npmjs.com/package/@graphprotocol/graph-cli](https://www.npmjs.com/package/@graphprotocol/graph-cli) |
| **Arc / Circle USDC (Arc testnet)** | a merchant treasury flow on Arc: read the position, decide **one** bounded action from a closed vocabulary, render the transaction a wallet would sign — then stop. Plus a nanopayments vector check. | `integrations/arc-treasury/` (`units.mjs`, `split.mjs`, `treasury.mjs`, `app.html`), `integrations/arc-nanopayments/` | `node integrations/arc-treasury/test.mjs` → 177 · `node integrations/arc-treasury/split-test.mjs` → 26 · `node integrations/arc-nanopayments/test.mjs` → 141 · live read-only: `make gate-live` | **IMPLEMENTED — LOCAL TESTS + READ-ONLY LIVE CHECK. Nothing broadcast. There is no UNICA contract on Arc and no swap path there.** | Arc **testnet only**, chain id **5042002**; native gas asset is USDC at 18 decimals, the ERC-20 USDC at `0x3600000000000000000000000000000000000000` answers `decimals() = 6`. The unit system makes the two structurally non-interchangeable. | [rpc.testnet.arc.io](https://rpc.testnet.arc.io) · [faucet.circle.com](https://faucet.circle.com) · [testnet.arcscan.app](https://testnet.arcscan.app) |
| **Permit2** | in **V2 only**: the payer's witness-bound signature transfer that moves funds from the payer straight to the `PoolManager` | `src/v2/QuoteSettlementExecutor.sol`, `src/v2/interfaces/IPermit2Transfer.sol`, `integrations/permit2/digest.mjs` | `grep -rn -i permit2 src/SettlementExecutor.sol src/V4SettlementHook.sol` → **no match** · `node integrations/permit2/test.mjs` → 20 rows · `forge test --match-path 'test/v2/*'` | **IMPLEMENTED — FORK TESTS. NOT SHIPPED.** V2 is frozen as **v2.0.0-rc1 and BLOCKED** by an open Critical the team found, reproduced and published itself. The presented version does not use Permit2. | submodule `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` (transitive, under v4-periphery). The interface is **re-declared** rather than imported: Permit2's source pins `pragma solidity 0.8.17` and this tree pins 0.8.30. Canonical address `0x000000000022D473030F116dDEE9F6B43aC78BA3`. | [developers.uniswap.org/docs/protocols/permit2/concepts/signature-transfer](https://developers.uniswap.org/docs/protocols/permit2/concepts/signature-transfer) |
| **Vyper + Moccasin** | the settlement and merchant-split model. `merchant_policy.vy` is the truth for the split; the JavaScript an Arc console would show a merchant is checked **against what the Vyper actually computed**, because the place the two can disagree is rounding. | `vy/src/unica/merchant_policy.vy`, `vy/src/unica/payany_router.vy`, `vy/tests/` (two further `.vy` files sit in that directory **untracked** and are not part of the repository) | `cd vy && mox test -q` → **82 passed** · parity: `node integrations/arc-treasury/split-test.mjs` → 26 rows | **IMPLEMENTED — LOCAL TESTS.** Nothing deployed. `vy/moccasin.toml` has **no live network section at all**, so no command there can be pointed at a chain by accident. | `vyper 0.4.0+commit.e9db8d9` · `Moccasin CLI v0.4.4` (in-process EVM, `pyevm`) | [vyperlang.org](https://vyperlang.org) · [pypi.org/project/moccasin](https://pypi.org/project/moccasin/) |
| **HTML / CSS checkout surface** | the one page: type a merchant name, see the resolved address, pay in ETH, the recipient is paid in USDC, read the receipt back from the chain | `web/index.html` (651 lines), `web/ensv2/` | `bash script/check-surface.sh` → **23/23, 0 failed** · `wc -l web/index.html` | **IMPLEMENTED — PUBLISHING IS AN OWNER GATE.** The Pages workflow's deploy job is skipped until the owner enables Pages and sets `PAGES_ENABLED=true`. **Not confirmed published.** | No framework, no build step, no bundler, no backend, no web font. One accent colour; contrast computed rather than chosen. | would be [nfteria.github.io/UNICA](https://nfteria.github.io/UNICA/) once the owner enables it — treat as **unconfirmed** |
| **Python 3** | not a stack technology — a *dependency of the verification tooling*. `mox` runs on it, and `docs/proof/*.sh` parse JSON receipts with it. | `docs/proof/verify-live.sh`, `vy/` | `python3 --version` | REQUIRED TO RE-RUN THE PROOFS | `3.9.7` on this machine | [python.org](https://python.org) |

---

## 3 · What is **not** in this stack

Named explicitly, because an unstated absence and an overlooked dependency look identical.

| Claimed anywhere? | Verdict | How it was checked |
|---|---|---|
| **IPFS** | **NOT wired into any shipped path.** It appears only as `ipfs/kubo:v0.34.1` inside `integrations/graph/local/docker-compose.yml` and `integrations/graph/local-e2e.sh` — a *local* graph-node harness for reconstructing an index offline. No UNICA artifact is pinned to IPFS and nothing UNICA ships reads from it. | `grep -rn -i ipfs --include='*.mjs' --include='*.yml' --include='*.sh' . --exclude-dir=lib --exclude-dir=node_modules --exclude-dir=out --exclude-dir=.claude` |
| **AWS / CloudFront / S3** | **ABSENT from this repository's source.** Every apparent hit is either a vendored lockfile under `lib/` or the English word "withdraws". No bucket, no distribution, no SDK, no credential. | `grep -rn -i aws --include='*.mjs' --include='*.ts' --include='*.sol' --include='*.sh' --include='*.yml' . --exclude-dir=lib --exclude-dir=node_modules --exclude-dir=out --exclude-dir=.claude` then the same with `cloudfront` |
| **Docker** | local-harness only, same file as IPFS above. Not required to build, test, deploy or verify UNICA. | `find . -name 'docker-compose.yml' -not -path './lib/*' -not -path './.claude/*' -not -path './*/node_modules/*'` |
| **Any UNICA mainnet deployment** | **None exists.** Testnet only, by construction: `_need-network` in the `Makefile` refuses any `--network` that is not `sepolia`, and `UniswapDeployments.sol` reverts `UnsupportedChainId` for every chain but `11155111`. | `make deploy ARGS="--network mainnet"` refuses |
| **An audit** | **No part of UNICA has been audited.** | stated in `docs/UNICA-TOOLS.md` and here |

---

## 4 · Re-deriving every number on this page

```sh
# the gate — build, test, format, both scans, and every offline suite
make gate            # 182 Solidity tests, 0 failed (21 suites)
cd vy && mox test -q # 82 passed
                     # 1,543 JavaScript rows across 14 suites, 0 failed

# the chain — read back from Sepolia, not from this repository's claims
make proof           # verify-day1.sh 14/14 · verify-live.sh 31/31

# the toolchain, from real files rather than memory
forge --version
node --version
grep -n _version foundry.toml
git -C lib/uniswap-hooks describe --tags          # v1.1.1
git -C lib/hookmate      describe --tags          # v0.6.0
git -C lib/forge-std     describe --tags
git -C lib/uniswap-hooks/lib/v4-core rev-parse HEAD

# the load-bearing negative: Permit2 is not in the presented version
grep -rn -i permit2 src/SettlementExecutor.sol src/V4SettlementHook.sol src/libraries/

# the other load-bearing negative: UNICA's own JavaScript has no dependencies
grep -rhE "^import .*from ['\"][^.]" --include='*.mjs' \
  tools/ integrations/ script/ web/ --exclude-dir=node_modules | sort -u
```

The machine-readable twin of this page is
[`stack-manifest.json`](./stack-manifest.json). The two must agree.

---

## 5 · Test counts, stated as negatives

An empty result and a broken reporter look identical, so every count below is stated with
its denominator and its failure count.

| Lane | Count | Failed |
|---|---|---|
| Solidity (`forge test --no-match-path 'test/fork/*'`) | **182** tests across 21 suites | **0** |
| Solidity fork suites (`make fork`, excluded from CI on purpose — they need archive state) | 44 declared | run by hand |
| Vyper (`cd vy && mox test -q`) | **82** | **0** |
| JavaScript, 14 gate suites | **1,543** rows | **0** |
| Chainlink CRE workflow (`bun test`) | **30** tests, 860 `expect()` calls | **0** |
| `make proof` — day-1 chain readback | **14/14** | 0 |
| `make proof` — live chain readback | **31/31** | 0 |

The 1,543 is the sum of the fourteen suites, each of which prints its own count:
ENS resolution 136 · ENS identity chain 95 · Permit2 digest vectors 20 · ENSv2 permissioned
resolver 278 · V2 indexer consistency 40 · V2 live Graph provider 147 · V2 treasury copilot
115 · Arc treasury units and policy 177 · Arc split parity with Vyper 26 · Arc nanopayments
141 · signing tool vectors 81 · receipt verifier 113 · CRE guardian policy 88 · CRE adapter 86.

---

## 6 · Limitations of this page

- **The Foundry version differs between CI and this machine.** CI pins `v1.5.1`; the machine
  this page was verified on ran `forge 1.3.5-foundry-zksync-v0.1.9`. The 182/0 Solidity
  result above was produced by the local build. CI's own run is the authority on the pinned
  toolchain.
- **The 78 live ENSv2 rows were not re-run here.** They need a Sepolia endpoint
  (`make gate-live`); only the 278 offline rows were executed for this page.
- **`make proof`'s 14/14 + 31/31 was not re-run here.** Both scripts are pure chain reads
  and need an endpoint. The row counts in each script were confirmed by reading them.
- **The public URL for the checkout surface is unconfirmed.** The deploy job is gated on a
  repository variable this page cannot read.
- **Package registry URLs** (`npmjs.com`, `pypi.org`) are constructed from the package name
  in the lockfile, not read from this tree. Every other URL on this page appears in the
  repository or in a live deployment record.
