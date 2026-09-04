# UNICA — the one place every command lives. Read the help before running anything that signs.
#
# Signing is keystore-only: `--account <name> --sender <address>`. The password is prompted at
# run time and is never stored, passed, or logged. There is no private-key path in this file.
# Every deploy target is a public TESTNET; the scripts refuse any other chain id by construction.
-include .env

.PHONY: help build test fuzz fmt gate clean predict simulate-sepolia anvil-fork rehearse \
        live-sepolia deploy-sepolia init-sepolia seed-sepolia swap-sepolia readback-sepolia \
        verify-sepolia balances

# Keyless public RPC by default; a value in .env wins.
SEPOLIA_RPC_URL ?= https://ethereum-sepolia-rpc.publicnode.com

# The keystore account name and its PUBLIC address. No defaults on purpose: a wrong --sender
# signs with the wrong key, so a broadcast target refuses to run until both are named.
DEPLOYER_ACCOUNT ?=
DEPLOYER ?=

SIGN      := --account $(DEPLOYER_ACCOUNT) --sender $(DEPLOYER)
SEP_ARGS  := --rpc-url $(SEPOLIA_RPC_URL) $(SIGN) --broadcast -vvv
SCRIPT    := script/LiveFire.s.sol:LiveFire

help:
	@echo "UNICA"
	@echo ""
	@echo "  CHECK (free, no transaction)"
	@echo "    make gate              build + test (fuzz at the configured runs) + fmt --check"
	@echo "    make predict           the hook address and salt this creation code lands on, any chain"
	@echo "    make simulate-sepolia  dry-run all four live-fire stages against Sepolia as the deployer, no broadcast"
	@echo "    make balances          the deployer's ETH and USDC on Sepolia"
	@echo ""
	@echo "  REHEARSE (anvil fork of Sepolia: real mechanics, impersonated deployer, zero real transactions)"
	@echo "    make rehearse          fork Sepolia, run all four stages as the deployer, read the results back"
	@echo "    make anvil-fork        just the fork, in the foreground, on port 8546"
	@echo ""
	@echo "  LIVE (real Sepolia transactions; prompts the keystore password)"
	@echo "    make live-sepolia      all four stages in one run. deploy/init/seed skip if already done; swap always sends"
	@echo "    make deploy-sepolia    stage 1 only    make init-sepolia   stage 2 only"
	@echo "    make seed-sepolia      stage 3 only    make swap-sepolia   stage 4 only"
	@echo "    make readback-sepolia  what the chain says now: code, count, price, liquidity"
	@echo "    make verify-sepolia    source verification (Sourcify; Etherscan too if ETHERSCAN_API_KEY is set)"
	@echo ""
	@echo "  Every LIVE target needs DEPLOYER_ACCOUNT=<keystore name> DEPLOYER=<its address>, in .env or inline."

# ── check ─────────────────────────────────────────────────────────────────────
build :; forge build
test  :; forge test -vv
fuzz  :; forge test --match-test testFuzz -vv
fmt   :; forge fmt
clean :; forge clean
gate  :
	forge build && forge test && forge fmt --check
	@echo "gate: build, test, fmt-check all exit 0"

predict:
	forge script $(SCRIPT) --sig "predict()" --rpc-url $(SEPOLIA_RPC_URL) -vv

simulate-sepolia: _need-deployer
	forge script $(SCRIPT) --rpc-url $(SEPOLIA_RPC_URL) --sender $(DEPLOYER) -vvv

balances: _need-deployer
	@echo "ETH : $$(cast balance $(DEPLOYER) --rpc-url $(SEPOLIA_RPC_URL) --ether)"
	@echo "USDC: $$(cast call 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 'balanceOf(address)(uint256)' $(DEPLOYER) --rpc-url $(SEPOLIA_RPC_URL)) (6 decimals)"

# ── rehearse ──────────────────────────────────────────────────────────────────
anvil-fork:
	anvil --fork-url $(SEPOLIA_RPC_URL) --port 8546

rehearse: _need-deployer
	DEPLOYER=$(DEPLOYER) SEPOLIA_RPC_URL=$(SEPOLIA_RPC_URL) bash script/rehearse-anvil.sh

# ── live ──────────────────────────────────────────────────────────────────────
live-sepolia:   _need-signing ; forge script $(SCRIPT) $(SEP_ARGS)
deploy-sepolia: _need-signing ; forge script $(SCRIPT) --sig "deploy()" $(SEP_ARGS)
init-sepolia:   _need-signing ; forge script $(SCRIPT) --sig "init()"   $(SEP_ARGS)
seed-sepolia:   _need-signing ; forge script $(SCRIPT) --sig "seed()"   $(SEP_ARGS)
swap-sepolia:   _need-signing ; forge script $(SCRIPT) --sig "swap()"   $(SEP_ARGS)

readback-sepolia:
	bash script/readback.sh $(SEPOLIA_RPC_URL)

verify-sepolia:
	bash script/verify.sh $(SEPOLIA_RPC_URL)

# ── guards ────────────────────────────────────────────────────────────────────
_need-deployer:
	@test -n "$(DEPLOYER)" || { echo "DEPLOYER (public address) is not set"; exit 1; }

_need-signing: _need-deployer
	@test -n "$(DEPLOYER_ACCOUNT)" || { echo "DEPLOYER_ACCOUNT (keystore name) is not set"; exit 1; }
	@echo "signing with keystore '$(DEPLOYER_ACCOUNT)' as $(DEPLOYER) on $$(echo '$(SEPOLIA_RPC_URL)' | cut -d/ -f3); the password will be prompted"
