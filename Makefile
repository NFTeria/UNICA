# UNICA — every command lives here. Run `make help` first.
#
# Shape: one NETWORK_ARGS switch. With no ARGS, commands target a LOCAL ANVIL FORK of Sepolia on
# port 8545 (start it with `make anvil`), impersonating the deployer: real PoolManager, real USDC,
# zero real transactions. With ARGS="--network sepolia", commands sign with the keystore account
# (`--account`, password prompted, never stored) and broadcast to Ethereum Sepolia; verification
# flags are added only when ETHERSCAN_API_KEY is set. There is no private-key path in this file.
# Every script refuses any chain id that is not a listed testnet, by construction.
#
# Why the local target is a FORK and not a bare anvil: the hook resolves the PoolManager from the
# chain id (one address on every chain), and a bare chain 31337 has no PoolManager to resolve.
-include .env

.PHONY: help all deps doctor build test fuzz snapshot format fmt gate gate-live clean anvil predict simulate go-live go-live-check settle-live settle-check topup-live topup-check tag-green proof \
        rehearse deploy init-pool seed settle topup live readback verify balances _need-deployer _need-signing

# ── configuration ─────────────────────────────────────────────────────────────
SEPOLIA_RPC_URL  ?= https://ethereum-sepolia-rpc.publicnode.com
LOCAL_RPC_URL    ?= http://127.0.0.1:8545
DEPLOYER_ACCOUNT ?=
DEPLOYER         ?=
ETHERSCAN_API_KEY ?=

PIN_TAG    := v1.1.1
PIN_COMMIT := bd5287c4a9f5c22c2393f7587a9b357662916115

# Local fork by default: impersonate the deployer (anvil --auto-impersonate), broadcast to the fork.
NETWORK_ARGS := --rpc-url $(LOCAL_RPC_URL) --unlocked --sender $(DEPLOYER) --broadcast -vvv
# Fork runs share the real chain id, so without this their broadcast files would land in the
# committed broadcast/ record and overwrite the day-1 evidence. Local runs write under .rehearsal/.
RUN_ENV      := FOUNDRY_BROADCAST=.rehearsal/broadcast
ifeq ($(findstring --network sepolia,$(ARGS)),--network sepolia)
  NETWORK_ARGS := --rpc-url $(SEPOLIA_RPC_URL) --account $(DEPLOYER_ACCOUNT) --sender $(DEPLOYER) --broadcast -vvvv
  RUN_ENV      :=
  ifneq ($(strip $(ETHERSCAN_API_KEY)),)
    NETWORK_ARGS += --verify --etherscan-api-key $(ETHERSCAN_API_KEY)
  endif
else ifneq ($(findstring --network,$(ARGS)),)
  # Any other --network is refused, never silently mapped to the local fork (measured 2026-09-04:
  # ARGS="--network mainnet" fell through to the fork target before this branch existed).
  UNSUPPORTED_NETWORK := $(ARGS)
endif

help:
	@echo "UNICA"
	@echo ""
	@echo "  FIRST, on a fresh clone"
	@echo "    make deps             fetch the pinned submodules (the v4 toolchain) and assert the pin"
	@echo "    make doctor           what is present, what is missing, how to get it"
	@echo ""
	@echo "  CHECK (free, no transaction)"
	@echo "    make gate             build, test (fuzz 10,000), fmt-check, the secret scan and the copied-source scan CI runs"
	@echo "    make test / fuzz      the suite, or only the fuzz tests"
	@echo "    make predict          the hook address and salt this creation code lands on, any chain"
	@echo "    make simulate         all four stages against live Sepolia state as the deployer, no broadcast"
	@echo "    make balances         the deployer's ETH and USDC on Sepolia"
	@echo ""
	@echo "  LOCAL (anvil fork of Sepolia on :8545; real contracts, impersonated deployer, no real tx)"
	@echo "    make anvil            start the fork (leave it running in its own terminal)"
	@echo "    make deploy           stage 1: executor at its derived address, hook at its mined salt"
	@echo "    make init-pool        stage 2: the native-ETH / USDC pool at 2,500 USDC per ETH"
	@echo "    make seed             stage 3: full-range liquidity from what the deployer holds"
	@echo "    make settle           stage 4: create an order and pay it through the executor and the official router"
	@echo "    make topup            stage 5: bounded full-range liquidity at the pool's current price (after the pool is live)"
	@echo "    make live             all four stages in one run (deploy/init/seed skip if done; settle always sends)"
	@echo "    make rehearse         the same, on a throwaway fork on :8546, with a readback, in one command"
	@echo ""
	@echo "  GO LIVE (the whole deploy, one command; keystore password prompted)"
	@echo "    make go-live-check    the pre-flight only: chain, frozen code, nonce, vacant targets. Sends nothing"
	@echo "    make go-live          the pre-flight, then deploy + pool + liquidity + one settlement on Sepolia; closes with the tag live-green"
	@echo "    make settle-check     the pre-flight for the settlement stage alone: frozen code, live contracts, seeded pool, unused order id. Sends nothing"
	@echo "    make settle-live      the pre-flight, then the settlement stage alone on Sepolia (the stage the first run lost; go-live refuses once the targets have code)"
	@echo "    make topup-check      the pre-flight for a bounded liquidity top-up of the live pool, with the plan it would follow. Sends nothing"
	@echo "    make topup-live       the pre-flight, then approve + modifyLiquidity on Sepolia, within the bounds in script/LiveFire.s.sol"
	@echo "    make tag-green TAG=<name> MSG=<file>   cut a milestone tag only after CI, proof and the docs that name it are all in"
	@echo "    make proof            re-prove both deployments and the settlement from the chain (verify-day1, verify-live)"
	@echo ""
	@echo "  SEPOLIA, one stage at a time (real transactions; keystore password prompted)"
	@echo "    make deploy ARGS=\"--network sepolia\"      (and init-pool / seed / settle / live the same way)"
	@echo "    make readback         what the chain says now: code, count, price, liquidity, executor"
	@echo "    make verify           source verification of hook and executor (Sourcify; Etherscan when the key is set)"
	@echo ""
	@echo "  Every LOCAL and SEPOLIA target needs DEPLOYER=<public address>; SEPOLIA also DEPLOYER_ACCOUNT=<keystore name>."
	@echo "  Put them in .env (see .env.example) or pass them inline."

all: deps build test

# ── first, on a fresh clone ───────────────────────────────────────────────────
deps:
	git submodule update --init --recursive
	@test "$$(git -C lib/uniswap-hooks rev-parse HEAD)" = "$(PIN_COMMIT)" \
	  || { echo "lib/uniswap-hooks is not at $(PIN_TAG) ($(PIN_COMMIT)); run: git submodule update --init --recursive --checkout"; exit 1; }
	@echo "deps: uniswap-hooks at $(PIN_TAG) = $(PIN_COMMIT); v4-core, v4-periphery, hookmate, forge-std present"

doctor:
	@echo "== toolchain"
	@command -v forge >/dev/null && forge --version | head -1 || echo "MISSING forge: install Foundry from getfoundry.sh (CI uses upstream v1.5.1)"
	@command -v cast  >/dev/null && cast --version | head -1  || echo "MISSING cast (comes with Foundry)"
	@command -v anvil >/dev/null && anvil --version | head -1 || echo "MISSING anvil (comes with Foundry; needed for the local fork)"
	@command -v vyper >/dev/null && echo "vyper $$(vyper --version)" || echo "vyper not found (not needed yet)"
	@echo "== submodules"
	@test -f lib/uniswap-hooks/src/base/BaseHook.sol && echo "lib/uniswap-hooks present" || echo "MISSING lib/: run make deps"
	@test -f lib/hookmate/src/artifacts/V4PoolManager.sol && echo "hookmate present (official PoolManager bytecode for tests)" || echo "MISSING hookmate: run make deps"
	@test "$$(git -C lib/uniswap-hooks rev-parse HEAD 2>/dev/null)" = "$(PIN_COMMIT)" && echo "uniswap-hooks pinned at $(PIN_TAG)" || echo "uniswap-hooks NOT at the pin: run make deps"
	@echo "== the gate, if everything above is present: make gate (expect every test passed, 0 failed; CI asserts the count)"

_need-deps:
	@test -f lib/uniswap-hooks/src/base/BaseHook.sol || { echo "the submodules are not fetched; run: make deps"; exit 1; }

# ── check ─────────────────────────────────────────────────────────────────────
build    : _need-deps ; forge build
test     : _need-deps ; forge test -vv
fuzz     : _need-deps ; forge test --match-test testFuzz -vv
snapshot : _need-deps ; forge snapshot
format   :; forge fmt
fmt      :; forge fmt
clean    :; forge clean
# A gate row that runs an external tool. The shape matters more than it looks.
#
# The old form was `command -v node >/dev/null 2>&1 && node X || echo "SKIP  ...: node is not
# installed"`. In `sh`, that returns 0 whenever X FAILS — so a broken suite printed "node is not
# installed" and the gate went green. Three suites sat behind that line: the ENS identity chain had
# crashed on a missing fixture key and had NEVER run past a third of its rows; its demo exited 1;
# and the tool ledger was correctly reporting itself stale and being ignored. The message was worse
# than the silence, because it named a cause that was false — node was installed the whole time.
#
# `if/then/else` returns the command's own status. A missing runner is a skip and says so; a
# failing tool fails the gate, which is the only reason to have a gate.
define run_row
if command -v $(1) >/dev/null 2>&1; then $(2); 	else echo "SKIP  $(3): $(1) is not installed (this is a SKIP, not a pass)"; fi
endef

gate     : _need-deps
	@# The fork suites are excluded on purpose. They need a Sepolia endpoint, and a gate that
	@# depends on a third party's uptime is not a gate — it is a status page. `make fork` runs them.
	forge build && forge test --no-match-path 'test/fork/*' && forge fmt --check
	bash script/scan.sh
	bash script/no-copied-source.sh
	bash script/size-budget.sh
	@# The ENS resolution tests are offline and deterministic, so they belong in the gate. If node
	@# is missing they report a SKIP and say it is a skip: an absent runner and a passing suite
	@# must not look the same. `make gate-live` additionally resolves real names on Sepolia.
	@$(call run_row,node,node integrations/ensv2/test.mjs,ENS resolution tests)
	@# The ENS identity chain: a name, to a policy, to a canonical configuration, to a V2 quote.
	@# Offline by construction — the resolver reply and the policy bytes are committed fixtures.
	@$(call run_row,node,node integrations/ensv2/identity-test.mjs,ENS identity chain)
	@# And the end-to-end command itself, run for its exit status. A demo that stopped working
	@# would otherwise be discovered by whoever ran it in front of an audience.
	@$(call run_row,node,node integrations/ensv2/demo.mjs >/dev/null,ENS identity demo)
	@# The offline half of the Permit2 digest gate. Its whole value is being a SECOND derivation:
	@# the vector it pins is recomputed in Solidity and presented to the real Permit2 runtime, so
	@# running only one of the two proves that one side is self-consistent and nothing else.
	@$(call run_row,node,node integrations/permit2/test.mjs,Permit2 digest vectors)
	@# The tool ledger. Its last check is the one that keeps it honest: a commit that changes a
	@# tool's code without updating docs/unica-tools.json fails the build, so a status cannot drift.
	@$(call run_row,node,node script/validate-tools.mjs,tool ledger validation)
	@# The release-candidate interface freeze. It checks its own input first: if the artifacts were
	@# not built from the sources now on disk it refuses to report rather than validating yesterday.
	@$(call run_row,node,node script/verify-freeze.mjs,interface freeze)
	@# The V2 indexer's manifest, ABI and queries. Needs no node_modules: the matchstick suite does,
	@# and lives behind `make graph-v2-test`, but a subgraph that subscribes to the wrong topic
	@# indexes nothing and reports no error, so THAT check belongs in the gate.
	@$(call run_row,node,node integrations/graph-v2/check.mjs,V2 indexer consistency)
	@# The client signing tool. Its vectors are re-derived in test/v2/SigningVectors.t.sol, so
	@# running only one of the two proves that one side is self-consistent and nothing else.
	@$(call run_row,node,node tools/unica-sign/test.mjs,signing tool vectors)
	@# The receipt verifier, offline. Its fixture is a REAL settlement captured off a local fork, so
	@# these rows need no network and no endpoint — which is the point: a verifier whose own suite
	@# could only run against a chain would be untestable exactly when a chain is unavailable.
	@# `make verify-online` adds the RPC rows against a local node.
	@$(call run_row,node,node tools/unica-verify/test.mjs,receipt verifier)
	@# The CRE liquidation-protection policy. Offline and deterministic by construction: no CRE
	@# CLI, no credentials, no RPC. It is the part of that challenge worth most of the score, and
	@# the part that can be tested without any of the parts that cannot.
	@$(call run_row,node,node integrations/chainlink-cre-guardian/test.mjs,CRE guardian policy)
	@# The CRE adapter. Its verdict is the EXIT STATUS, never a grep over its output: a producer
	@# that throws before printing anything has to fail the gate, and one of its own rows proves it.
	@$(call run_row,node,node integrations/chainlink-cre-guardian/adapter-test.mjs,CRE adapter)
	@# The Arc nanopayments integration. Offline by construction: it verifies a vector Circle's own
	@# SDK signed, without importing that SDK and without an endpoint or a key.
	@$(call run_row,node,node integrations/arc-nanopayments/test.mjs,Arc nanopayments)
	@# The Chainlink CRE Confidential Workflow's decision logic. Runs under bun because the
	@# workflow is TypeScript against @chainlink/cre-sdk; the CRE runtime is what carries these
	@# functions into an enclave, not what makes them correct, so they are testable here.
	@$(call run_row,bun,cd integrations/chainlink-cre-guardian/workflow && bun test,CRE confidential workflow)
	@# The Vyper workspace. It ran green for weeks without being gated, which meant nothing
	@# would have said so the day it stopped. Moccasin's in-process EVM needs no network.
	@$(call run_row,mox,(cd vy && mox test -q),vy model and art)
	@echo "gate: build, test, fmt-check, both scans, the ENS and Permit2 vectors, the signing tool,"
	@echo "      the receipt verifier and the tool ledger all exit 0"

# The receipt verifier's ONLINE rows, against a local fork node. Separate from the gate for the same
# reason the fork suites are: a gate that needs somebody else's node is a status page. Start the node
# with `make anvil`, then `make verify-fixture` to re-capture the fixture from a fresh settlement.
.PHONY: verify-online verify-fixture vy
# The Vyper workspace on its own, verbosely, for when a row is being worked on.
vy:
	cd vy && mox test -s
.PHONY: verify-online verify-fixture
verify-online:
	UNICA_VERIFY_RPC=$(LOCAL_RPC_URL) node tools/unica-verify/test.mjs

# Re-captures tools/unica-verify/fixtures/fork-settlement.json from a settlement this run performs.
# Local node only, refused otherwise, and nothing it does reaches a public chain.
verify-fixture:
	bash script/v2/fork-settle.sh

# The V2 mutation suite: thirty specific defects, each applied to the real tree and each required
# to turn the row that NAMES it red. Not in `make gate` because it recompiles thirty times; run it
# before pushing a change to the hook or the executor, and read the note column — a mutation killed
# by somebody else's row is a finding, not a pass.
mutants:
	bash script/mutation-suite.sh

# The fork suites: the same V2 code against pinned live Sepolia dependencies, read-only. Nothing
# here broadcasts. Needs a Sepolia endpoint; SEPOLIA_RPC_URL overrides the public default.
fork:
	forge test --match-path 'test/fork/*'

# The V2 indexer's mapping tests. Separate from the gate because matchstick needs node_modules,
# which a fresh clone does not have; the manifest and ABI checks that do not are in the gate.
graph-v2-test:
	cd integrations/graph-v2 && npx graph codegen && npx graph test

# And the highest-value mutations re-run under fork conditions.
fork-mutants:
	bash script/mutation-suite.sh --fork

# The gate plus the rows that need a network: real ENSv2 names resolved on Sepolia. Read-only.
gate-live: gate
	node integrations/ensv2/test.mjs --live

predict:
	forge script script/LiveFire.s.sol:LiveFire --sig "predict()" -vv

# A simulation still writes a run record; without this it lands in the committed broadcast/ directory
# over the day-1 evidence and dirties the tree the go-live pre-flight requires clean (measured 2026-09-05).
simulate: _need-deployer
	FOUNDRY_BROADCAST=.rehearsal/simulate forge script script/LiveFire.s.sol:LiveFire --rpc-url $(SEPOLIA_RPC_URL) --sender $(DEPLOYER) -vvv

balances: _need-deployer
	@echo "ETH : $$(cast balance $(DEPLOYER) --rpc-url $(SEPOLIA_RPC_URL) --ether)"
	@echo "USDC: $$(cast call 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 'balanceOf(address)(uint256)' $(DEPLOYER) --rpc-url $(SEPOLIA_RPC_URL)) (6 decimals)"

# ── local fork ────────────────────────────────────────────────────────────────
anvil:
	anvil --fork-url $(SEPOLIA_RPC_URL) --port 8545 --auto-impersonate

# ── go live: the one command the owner runs, and its pre-flight ───────────────────────────────
go-live:
	bash script/go-live.sh

go-live-check:
	DRY_RUN=1 bash script/go-live.sh

settle-live:
	bash script/settle-live.sh

settle-check:
	DRY_RUN=1 bash script/settle-live.sh

topup-live:
	bash script/topup-live.sh

topup-check:
	DRY_RUN=1 bash script/topup-live.sh

# A milestone tag, only when everything it claims is already in history and green (script/tag-green.sh).
tag-green:
	TAG=$(TAG) MSG=$(MSG) bash script/tag-green.sh

proof:
	bash docs/proof/verify-day1.sh
	bash docs/proof/verify-live.sh

rehearse: _need-deployer
	DEPLOYER=$(DEPLOYER) SEPOLIA_RPC_URL=$(SEPOLIA_RPC_URL) bash script/rehearse-anvil.sh

# ── the four stages (local fork by default; ARGS="--network sepolia" for the real thing) ───────
deploy    : _need-network ; $(RUN_ENV) forge script script/DeploySettlement.s.sol:DeploySettlement  $(NETWORK_ARGS)
init-pool : _need-network ; $(RUN_ENV) forge script script/Interactions.s.sol:InitPool     $(NETWORK_ARGS)
seed      : _need-network ; $(RUN_ENV) forge script script/Interactions.s.sol:SeedLiquidity $(NETWORK_ARGS)
settle    : _need-network ; $(RUN_ENV) forge script script/Interactions.s.sol:Settle       $(NETWORK_ARGS)
topup     : _need-network ; $(RUN_ENV) forge script script/Interactions.s.sol:TopUp        $(NETWORK_ARGS)
live      : _need-network ; $(RUN_ENV) forge script script/LiveFire.s.sol:LiveFire         $(NETWORK_ARGS)

readback:
	bash script/readback.sh $(SEPOLIA_RPC_URL)

verify:
	bash script/verify.sh $(SEPOLIA_RPC_URL)

# ── guards ────────────────────────────────────────────────────────────────────
_need-deployer:
	@test -n "$(DEPLOYER)" || { echo "DEPLOYER (public address) is not set"; exit 1; }

_need-network: _need-deployer
ifdef UNSUPPORTED_NETWORK
	@echo "unsupported network in ARGS=\"$(UNSUPPORTED_NETWORK)\": only \"--network sepolia\" is supported (testnet only); with no ARGS the target is the local fork"; exit 1
else ifeq ($(findstring --network sepolia,$(ARGS)),--network sepolia)
	@test -n "$(DEPLOYER_ACCOUNT)" || { echo "DEPLOYER_ACCOUNT (keystore name) is not set"; exit 1; }
	@echo "SEPOLIA: signing with keystore '$(DEPLOYER_ACCOUNT)' as $(DEPLOYER); the password will be prompted; verification $(if $(strip $(ETHERSCAN_API_KEY)),on,off)"
else
	@echo "LOCAL FORK on $(LOCAL_RPC_URL), impersonating $(DEPLOYER); start it with: make anvil"
endif
