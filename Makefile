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

.PHONY: help all deps doctor build test fuzz snapshot format fmt gate clean anvil predict simulate go-live go-live-check settle-live settle-check topup-live topup-check tag-green proof \
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
gate     : _need-deps
	forge build && forge test && forge fmt --check
	bash script/scan.sh
	bash script/no-copied-source.sh
	@echo "gate: build, test, fmt-check, the secret scan and the copied-source scan all exit 0"

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
