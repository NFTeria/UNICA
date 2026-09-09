// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {UnicaDeploymentsV3} from "../../src/v3/UnicaDeploymentsV3.sol";
import {UnicaExecutorV3} from "../../src/v3/UnicaExecutorV3.sol";
import {UnicaHookV3} from "../../src/v3/UnicaHookV3.sol";

/// @title The mined address, and the claim that it is one address for five chains
/// @notice `script/v3/MineHookV3.s.sol` prints an address, a salt and an init-code hash and asserts
///         its three derivations agree. A script asserting things about itself is worth something,
///         but not much: these rows check the same arithmetic from outside it, and then check the one
///         thing the script cannot — that the hook, once actually deployed at that address, derives
///         the SAME executor address the script printed beside it.
/// @dev The address is derived here, never pasted. A pasted address stops describing the tree the
///      moment the creation code changes and then quietly keeps passing.
contract MineHookV3Test is Test {
    uint160 internal constant DECLARED_FLAGS =
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    uint8 internal constant RESERVED_PREFIX = 0x91;
    bytes32 internal constant EXECUTOR_SALT = bytes32(0);
    uint256 internal constant MAX_SALT = 200_000;

    /// @notice The mined address carries exactly the declared permission bits and no others.
    /// @dev The bits ARE the permissions. A hook whose address is wrong is not refused by the
    ///      PoolManager — it is simply never called, and every invariant it enforces silently stops
    ///      existing. That is the failure this row is here to prevent.
    function test_M1_TheMinedAddressCarriesExactlyTheDeclaredBits() public pure {
        (address hookAddr,) = _mine();
        assertEq(uint160(hookAddr) & Hooks.ALL_HOOK_MASK, DECLARED_FLAGS, "the mined address is missing a flag bit");
        assertEq(uint256(DECLARED_FLAGS), 0x20C0, "the declared permission set changed");
        assertTrue(
            uint8(uint160(hookAddr) >> 152) != RESERVED_PREFIX, "the mined address uses Uniswap's reserved prefix"
        );
    }

    /// @notice Three independent address functions agree on the mined address.
    /// @dev Hand-rolled Solidity, Foundry's Rust cheatcode, and Uniswap's own `HookMiner`. Agreement
    ///      across three implementations is what makes this reproducible rather than merely repeatable.
    function test_M2_ThreeDerivationsAgree() public pure {
        (address byHand, bytes32 salt) = _mine();
        bytes memory creationCode = type(UnicaHookV3).creationCode;
        bytes32 initCodeHash = keccak256(creationCode);

        assertEq(
            vm.computeCreate2Address(salt, initCodeHash, UnicaDeploymentsV3.CREATE2_FACTORY),
            byHand,
            "Foundry's CREATE2 disagrees with the hand-rolled one"
        );
        assertEq(
            HookMiner.computeAddress(UnicaDeploymentsV3.CREATE2_FACTORY, uint256(salt), creationCode),
            byHand,
            "HookMiner disagrees with the hand-rolled one"
        );
    }

    /// @notice The hook, deployed at that address, derives the executor address the arithmetic says.
    /// @dev The row the script cannot run: `_computeExecutor` lives inside the hook's constructor and
    ///      only a deployed hook can be asked what it produced.
    function test_M3_TheDeployedHookDerivesTheSameExecutorAddress() public {
        vm.chainId(11155111);
        (address hookAddr,) = _mine();
        deployCodeTo("UnicaHookV3.sol:UnicaHookV3", "", hookAddr);
        UnicaHookV3 hook = UnicaHookV3(hookAddr);

        bytes32 executorInitCodeHash =
            keccak256(abi.encodePacked(type(UnicaExecutorV3).creationCode, abi.encode(hookAddr)));
        address expected =
            vm.computeCreate2Address(EXECUTOR_SALT, executorInitCodeHash, UnicaDeploymentsV3.CREATE2_FACTORY);
        assertEq(hook.SETTLEMENT_EXECUTOR(), expected, "the hook derives a different executor than the arithmetic does");
        assertEq(hook.CREATE2_FACTORY(), UnicaDeploymentsV3.CREATE2_FACTORY, "the hook uses a different factory");
        assertEq(hook.EXECUTOR_SALT(), EXECUTOR_SALT, "the hook uses a different executor salt");
    }

    /// @notice ONE address, five chains: the same creation code, deployed under four different chain
    ///         ids, lands at the same place and resolves that chain's own stack.
    /// @dev This is the claim the script prints in bold, so it is the claim that has to be measured.
    ///      The address is fixed by the creation code and the factory, neither of which contains a
    ///      chain id; what changes per chain is only what the CONSTRUCTOR reads at run time. The lead
    ///      chain is absent from this row on purpose and has its own row below.
    function test_M4_OneAddressResolvesFourChainsCorrectly() public {
        (address hookAddr,) = _mine();
        uint256[4] memory chains = [uint256(11155111), 1301, 84532, 421614];
        for (uint256 i = 0; i < chains.length; i++) {
            vm.chainId(chains[i]);
            // A fresh deployment at the same address each time; the previous one is overwritten, which
            // is exactly the point being made — the address does not move.
            deployCodeTo("UnicaHookV3.sol:UnicaHookV3", "", hookAddr);
            UnicaHookV3 hook = UnicaHookV3(hookAddr);
            assertEq(
                hook.UNIVERSAL_ROUTER(),
                UnicaDeploymentsV3.universalRouter(chains[i]),
                "the hook resolved a router that is not this chain's"
            );
            assertEq(
                hook.PAYOUT_CURRENCY(),
                UnicaDeploymentsV3.payoutCurrency(chains[i]),
                "the hook resolved a payout currency that is not this chain's"
            );
        }
    }

    /// @notice SABOTAGE, of a kind: the lead chain cannot carry this hook at all, and it fails for the
    ///         stated reason rather than by landing on a zero address.
    /// @dev The library's refusal is only worth anything if it actually reaches the constructor. This
    ///      row is what turns "the table refuses" into "nothing can be deployed there".
    function test_M5_TheHookCannotBeDeployedOnTheLeadChainYet() public {
        vm.chainId(UnicaDeploymentsV3.LEAD_CHAIN_ID);
        (address hookAddr,) = _mine();
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaDeploymentsV3.PayoutCurrencyNotVerified.selector, UnicaDeploymentsV3.LEAD_CHAIN_ID
            )
        );
        deployCodeTo("UnicaHookV3.sol:UnicaHookV3", "", hookAddr);
    }

    /// @notice And neither can the executor, for the same named reason.
    function test_M6_TheExecutorCannotBeDeployedOnTheLeadChainYet() public {
        vm.chainId(UnicaDeploymentsV3.LEAD_CHAIN_ID);
        (address hookAddr,) = _mine();
        vm.expectRevert(
            abi.encodeWithSelector(
                UnicaDeploymentsV3.PayoutCurrencyNotVerified.selector, UnicaDeploymentsV3.LEAD_CHAIN_ID
            )
        );
        new UnicaExecutorV3(hookAddr);
    }

    /// @notice The executor refuses to exist on a chain whose router has already moved.
    /// @dev SABOTAGE of the deploy-time half of the code-hash binding. Without this row, the check in
    ///      the constructor would be untested and could be deleted without anything going red.
    function test_M7_TheExecutorRefusesToDeployAgainstAMovedRouter() public {
        vm.chainId(11155111);
        (address hookAddr,) = _mine();
        address router = UnicaDeploymentsV3.universalRouter(11155111);
        bytes32 expected = UnicaDeploymentsV3.universalRouterCodeHash(11155111);

        // Nothing at the router's address at all: the ordinary state of a local chain, and exactly
        // what a deploy pointed at the wrong network would see.
        vm.expectRevert(
            abi.encodeWithSelector(UnicaExecutorV3.RouterCodeChanged.selector, router, expected, router.codehash)
        );
        new UnicaExecutorV3(hookAddr);
    }

    /// @dev The CREATE2 rule over the hook's real creation code.
    function _mine() internal pure returns (address hookAddr, bytes32 salt) {
        bytes32 initCodeHash = keccak256(type(UnicaHookV3).creationCode);
        for (uint256 i = 0; i < MAX_SALT; i++) {
            address a = address(
                uint160(
                    uint256(
                        keccak256(
                            abi.encodePacked(bytes1(0xff), UnicaDeploymentsV3.CREATE2_FACTORY, bytes32(i), initCodeHash)
                        )
                    )
                )
            );
            if (uint160(a) & Hooks.ALL_HOOK_MASK != DECLARED_FLAGS) continue;
            if (uint8(uint160(a) >> 152) == RESERVED_PREFIX) continue;
            return (a, bytes32(i));
        }
        revert("no salt found below MAX_SALT");
    }
}
