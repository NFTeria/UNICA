// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ForkPin} from "./ForkPin.sol";

interface IERC20Meta {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
    function totalSupply() external view returns (uint256);
}

interface IPermit2Domain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

interface IV1Hook {
    function SETTLEMENT_EXECUTOR() external view returns (address);
    function receiptCount() external view returns (uint256);
    function poolManager() external view returns (address);
}

/// @title FORK LAYER A — the dependencies are what this repository says they are
/// @notice Every later fork row rests on these addresses holding this code. Asserting it first
///         means a failure downstream is a failure of UNICA rather than a chain that moved, and it
///         means the pin is checked rather than declared.
contract DependencyProvenanceForkTest is ForkPin {
    function setUp() public {
        _selectPinnedFork();
    }

    function test_ForkA_ThePinIsTheBlockThisSuiteClaims() public {
        assertEq(block.chainid, PINNED_CHAIN_ID, "chain id");
        assertEq(block.number, PINNED_BLOCK, "block number");
        assertEq(block.timestamp, PINNED_TIMESTAMP, "block timestamp");

        // The hash cannot be read from inside its own block, so read it from the next one. This is
        // the check that makes the pin a pin rather than a number in a comment.
        vm.createSelectFork(_forkUrl(), PINNED_BLOCK + 1);
        assertEq(blockhash(PINNED_BLOCK), PINNED_BLOCK_HASH, "the pinned block hash does not match");
    }

    function test_ForkA_EveryDependencyHoldsTheRecordedCode() public view {
        _assertCode("PoolManager", POOL_MANAGER, PM_CODEHASH, POOL_MANAGER_CODE_SIZE);
        _assertCode("Permit2", PERMIT2, PERMIT2_CODEHASH, PERMIT2_CODE_SIZE);
        _assertCode("CREATE2 factory", DETERMINISTIC_DEPLOYER, DEPLOYER_CODEHASH, 69);
        _assertCode("USDC proxy", USDC, USDC_CODEHASH, 1798);
        _assertCode("WETH9", WETH9, WETH9_CODEHASH, 3124);
        _assertCode("V1 hook", V1_HOOK, V1_HOOK_CODEHASH, 10634);
    }

    /// @dev Permit2's domain must be the CANONICAL one for this chain and this address. A local
    ///      harness in this repository once proved signatures valid against a domain no wallet
    ///      would ever compute, because Permit2 caches its separator in an immutable and the
    ///      harness had copied the code somewhere else. On the fork there is nothing to copy.
    function test_ForkA_Permit2DomainIsCanonicalForThisChain() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256("Permit2"),
                block.chainid,
                PERMIT2
            )
        );
        assertEq(IPermit2Domain(PERMIT2).DOMAIN_SEPARATOR(), expected, "Permit2's domain is not canonical here");
    }

    function test_ForkA_TheSelectedCurrenciesBehaveAsRecorded() public view {
        assertEq(IERC20Meta(USDC).decimals(), USDC_DECIMALS, "USDC decimals");
        assertEq(IERC20Meta(USDC).symbol(), "USDC", "USDC symbol");
        assertEq(IERC20Meta(WETH9).decimals(), WETH9_DECIMALS, "WETH decimals");
        assertGt(IERC20Meta(USDC).totalSupply(), 0, "USDC has no supply on this fork");
        assertTrue(USDC < WETH9, "the recorded currency ordering is wrong");
    }

    /// @dev The upgradeability fact, recorded because it is easy to get wrong. USDC's proxy does
    ///      NOT use the EIP-1967 slot; a reader who checks that slot finds zero and could conclude
    ///      the token is immutable. It is not.
    function test_ForkA_USDCIsAProxyAtANonEIP1967Slot() public view {
        bytes32 eip1967 = vm.load(USDC, 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc);
        assertEq(eip1967, bytes32(0), "USDC now uses the EIP-1967 slot; the recorded fact is stale");

        bytes32 zeppelinos = vm.load(USDC, USDC_IMPL_SLOT);
        assertEq(address(uint160(uint256(zeppelinos))), USDC_IMPLEMENTATION, "the USDC implementation moved");
        assertGt(USDC_IMPLEMENTATION.code.length, 20000, "the implementation has no code");
    }

    /// @dev V1's live claims, re-proved from the chain rather than from the README.
    function test_ForkA_V1IsLiveAndBoundAsClaimed() public view {
        assertEq(IV1Hook(V1_HOOK).SETTLEMENT_EXECUTOR(), V1_EXECUTOR, "the live hook names a different executor");
        assertEq(IV1Hook(V1_HOOK).poolManager(), POOL_MANAGER, "the live hook names a different PoolManager");
        assertEq(IV1Hook(V1_HOOK).receiptCount(), 1, "the live receipt count is not 1");
    }

    function _assertCode(string memory what, address at, bytes32 hash, uint256 size) internal view {
        assertGt(at.code.length, 0, string.concat(what, ": no code at the recorded address"));
        assertEq(at.code.length, size, string.concat(what, ": code size does not match the record"));
        assertEq(keccak256(at.code), hash, string.concat(what, ": code hash does not match the record"));
    }
}
