// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RouterParamsCodec} from "../../src/compat/RouterParamsCodec.sol";
import {UniswapDeployments} from "../../src/libraries/UniswapDeployments.sol";
import {UnicaDeploymentsV3} from "../../src/v3/UnicaDeploymentsV3.sol";

/// @notice The library, reachable from outside, so a row can assert on the revert it produces.
/// @dev An internal library function cannot be the target of `vm.expectRevert`; this wrapper is the
///      smallest thing that makes the refusals testable, and it forwards nothing else.
contract DeploymentsV3Caller {
    function routing(uint256 chainId) external pure returns (UnicaDeploymentsV3.Routing memory) {
        return UnicaDeploymentsV3.routing(chainId);
    }

    function payoutCurrency(uint256 chainId) external pure returns (address) {
        return UnicaDeploymentsV3.payoutCurrency(chainId);
    }

    function universalRouter(uint256 chainId) external pure returns (address) {
        return UnicaDeploymentsV3.universalRouter(chainId);
    }

    function poolManager(uint256 chainId) external pure returns (address) {
        return UnicaDeploymentsV3.poolManager(chainId);
    }

    function permit2(uint256 chainId) external pure returns (address) {
        return UnicaDeploymentsV3.permit2(chainId);
    }

    function routerLayout(uint256 chainId) external pure returns (RouterParamsCodec.Layout) {
        return UnicaDeploymentsV3.routerLayout(chainId);
    }

    function chainIdAt(uint256 index) external pure returns (uint256) {
        return UnicaDeploymentsV3.chainIdAt(index);
    }
}

/// @title The V3 deployments table, and every way it is asked to refuse
/// @notice These rows are about the SHAPE of the table and its refusals. Whether the values in it are
///         still true of the chains they name is a different question, asked against the chains
///         themselves in `test/v3/DeploymentsV3Fork.t.sol`. Both are needed: a table can be internally
///         perfect and stale, or accurate and impossible to use safely.
contract DeploymentsV3Test is Test {
    DeploymentsV3Caller internal lib;

    /// @dev A chain id nothing in this repository claims. Used for every "unknown" row so a single
    ///      number is the whole difference between a listed chain and an unlisted one.
    uint256 internal constant UNKNOWN_CHAIN = 999_999_999;

    function setUp() public {
        lib = new DeploymentsV3Caller();
    }

    // ---- the rows that must pass -----------------------------------------------------------------

    /// @notice All five chains resolve, and every field of every row is a real answer.
    function test_D1_AllFiveChainsResolveWithNoZeroFields() public view {
        assertEq(UnicaDeploymentsV3.CHAIN_COUNT, 5, "the generation is not five chains");
        for (uint256 i = 0; i < UnicaDeploymentsV3.CHAIN_COUNT; i++) {
            uint256 chainId = UnicaDeploymentsV3.chainIdAt(i);
            UnicaDeploymentsV3.Routing memory r = UnicaDeploymentsV3.routing(chainId);
            assertEq(r.chainId, chainId, "a row does not name the chain it was asked for");
            assertTrue(r.universalRouter != address(0), "a row has no router");
            assertTrue(r.poolManager != address(0), "a row has no pool manager");
            assertTrue(r.permit2 != address(0), "a row has no permit2");
            assertTrue(r.universalRouterCodeHash != bytes32(0), "a row has no router code hash");
            assertTrue(r.layout != RouterParamsCodec.Layout.Unknown, "a row cannot say which layout");
            assertTrue(UnicaDeploymentsV3.isSupported(chainId), "an enumerated chain is not supported");
        }
    }

    /// @notice Robinhood is the lead chain and it is first in the enumeration, not merely present.
    function test_D2_TheLeadChainIsFirst() public view {
        assertEq(UnicaDeploymentsV3.LEAD_CHAIN_ID, 46630, "the lead chain moved");
        assertEq(UnicaDeploymentsV3.chainIdAt(0), 46630, "the lead chain is not first in the enumeration");
    }

    /// @notice The lead chain wants the six-field head; the other four want the five-field head.
    /// @dev The whole reason this generation exists, stated as a table rather than as prose. It is
    ///      re-measured against the real routers in the fork suite; here it is only asserted to be
    ///      what the library claims, so that a careless edit to the table goes red immediately.
    function test_D3_TheLayoutSplitIsTheOneThatWasMeasured() public view {
        assertEq(
            uint8(UnicaDeploymentsV3.routerLayout(46630)),
            uint8(RouterParamsCodec.Layout.PerHop),
            "the lead chain is no longer six-field"
        );
        uint256[4] memory legacyChains = [uint256(11155111), 1301, 84532, 421614];
        for (uint256 i = 0; i < legacyChains.length; i++) {
            assertEq(
                uint8(UnicaDeploymentsV3.routerLayout(legacyChains[i])),
                uint8(RouterParamsCodec.Layout.Legacy),
                "a five-field chain changed layout in the table"
            );
        }
    }

    /// @notice No two chains share a router or a PoolManager, and no chain's row is another's.
    /// @dev A copy-paste in a table of five near-identical rows is the likeliest error there is, and
    ///      it is invisible to every other row in this file.
    function test_D4_NoTwoChainsShareARouterOrAManagerOrACodeHash() public view {
        for (uint256 i = 0; i < UnicaDeploymentsV3.CHAIN_COUNT; i++) {
            UnicaDeploymentsV3.Routing memory a = UnicaDeploymentsV3.routing(UnicaDeploymentsV3.chainIdAt(i));
            for (uint256 j = i + 1; j < UnicaDeploymentsV3.CHAIN_COUNT; j++) {
                UnicaDeploymentsV3.Routing memory b = UnicaDeploymentsV3.routing(UnicaDeploymentsV3.chainIdAt(j));
                assertTrue(a.universalRouter != b.universalRouter, "two chains share a router address");
                assertTrue(a.poolManager != b.poolManager, "two chains share a pool manager address");
                assertTrue(
                    a.universalRouterCodeHash != b.universalRouterCodeHash, "two chains share a router code hash"
                );
                assertTrue(a.chainId != b.chainId, "the enumeration repeats a chain");
            }
        }
    }

    /// @notice Permit2 is the same address on all five, which is why it can be a constant.
    function test_D5_Permit2IsOneAddressOnAllFive() public view {
        for (uint256 i = 0; i < UnicaDeploymentsV3.CHAIN_COUNT; i++) {
            assertEq(
                UnicaDeploymentsV3.permit2(UnicaDeploymentsV3.chainIdAt(i)),
                UnicaDeploymentsV3.PERMIT2,
                "a chain's Permit2 is not the shared constant"
            );
        }
    }

    /// @notice V3 and the frozen V1 library agree about Ethereum Sepolia.
    /// @dev V1 is DEPLOYED on that chain and its source is frozen. If these two ever disagreed, one of
    ///      them would be describing a chain that does not exist, and the deployed contract cannot be
    ///      the one that is wrong. Reading the frozen library here changes nothing about it.
    function test_D6_V3AgreesWithTheFrozenV1LibraryOnSepolia() public pure {
        assertEq(
            UnicaDeploymentsV3.universalRouter(11155111),
            UniswapDeployments.universalRouter(11155111),
            "V1 and V3 name different routers on the chain V1 is deployed on"
        );
        assertEq(
            UnicaDeploymentsV3.payoutCurrency(11155111),
            UniswapDeployments.payoutCurrency(11155111),
            "V1 and V3 name different payout currencies on the chain V1 is deployed on"
        );
    }

    /// @notice Four chains have a verified payout token; the lead chain does not, and the library says
    ///         so without being made to revert.
    function test_D7_ThePayoutGapIsReportableWithoutCatchingARevert() public pure {
        assertFalse(
            UnicaDeploymentsV3.hasVerifiedPayoutCurrency(46630), "the lead chain claims a verified payout token"
        );
        assertTrue(UnicaDeploymentsV3.isSupported(46630), "the lead chain is not supported for routing");
        uint256[4] memory withPayout = [uint256(11155111), 1301, 84532, 421614];
        for (uint256 i = 0; i < withPayout.length; i++) {
            assertTrue(UnicaDeploymentsV3.hasVerifiedPayoutCurrency(withPayout[i]), "a chain lost its payout token");
            assertTrue(UnicaDeploymentsV3.payoutCurrency(withPayout[i]) != address(0), "a payout token is zero");
        }
    }

    /// @notice No two chains share a payout token address either.
    function test_D8_NoTwoChainsShareAPayoutToken() public pure {
        uint256[4] memory withPayout = [uint256(11155111), 1301, 84532, 421614];
        for (uint256 i = 0; i < withPayout.length; i++) {
            for (uint256 j = i + 1; j < withPayout.length; j++) {
                assertTrue(
                    UnicaDeploymentsV3.payoutCurrency(withPayout[i])
                        != UnicaDeploymentsV3.payoutCurrency(withPayout[j]),
                    "two chains share a payout token address"
                );
            }
        }
    }

    // ---- the rows that must fail, one refusal at a time -------------------------------------------

    /// @notice An unknown chain reverts by name and carries its own id, on every reader.
    /// @dev Every reader, not just one: a table with five doors is only fail-closed if all five are.
    function test_D9_AnUnknownChainIsRefusedByEveryReader() public {
        bytes memory expected = abi.encodeWithSelector(UnicaDeploymentsV3.UnsupportedChainId.selector, UNKNOWN_CHAIN);

        vm.expectRevert(expected);
        lib.routing(UNKNOWN_CHAIN);
        vm.expectRevert(expected);
        lib.universalRouter(UNKNOWN_CHAIN);
        vm.expectRevert(expected);
        lib.poolManager(UNKNOWN_CHAIN);
        vm.expectRevert(expected);
        lib.permit2(UNKNOWN_CHAIN);
        vm.expectRevert(expected);
        lib.routerLayout(UNKNOWN_CHAIN);
        vm.expectRevert(expected);
        lib.payoutCurrency(UNKNOWN_CHAIN);

        assertFalse(UnicaDeploymentsV3.isSupported(UNKNOWN_CHAIN), "an unknown chain reports as supported");
        assertFalse(
            UnicaDeploymentsV3.hasVerifiedPayoutCurrency(UNKNOWN_CHAIN), "an unknown chain claims a payout token"
        );
    }

    /// @notice The lead chain's payout token is refused with its OWN error, not the unknown-chain one.
    /// @dev The distinction is the point. "Chain 46630 is unknown" would be false and would send a
    ///      reader looking for the wrong thing; what is unknown is one token on a chain whose routing
    ///      stack was read first-hand.
    function test_D10_TheLeadChainsPayoutTokenIsADifferentRefusal() public {
        vm.expectRevert(abi.encodeWithSelector(UnicaDeploymentsV3.PayoutCurrencyNotVerified.selector, uint256(46630)));
        lib.payoutCurrency(46630);

        // And the routing half still answers, so the two facts really are separate.
        UnicaDeploymentsV3.Routing memory r = lib.routing(46630);
        assertEq(r.chainId, 46630, "the lead chain lost its routing row along with its payout token");
        assertEq(uint8(r.layout), uint8(RouterParamsCodec.Layout.PerHop), "the lead chain lost its layout");

        assertTrue(
            UnicaDeploymentsV3.PayoutCurrencyNotVerified.selector != UnicaDeploymentsV3.UnsupportedChainId.selector,
            "the two refusals share a selector, so a caller cannot tell them apart"
        );
    }

    /// @notice Walking past the end of the enumeration is refused, with the index.
    function test_D11_TheEnumerationEndsWhereItSaysItDoes() public {
        vm.expectRevert(
            abi.encodeWithSelector(UnicaDeploymentsV3.ChainIndexOutOfRange.selector, UnicaDeploymentsV3.CHAIN_COUNT)
        );
        lib.chainIdAt(UnicaDeploymentsV3.CHAIN_COUNT);
    }

    /// @notice `isSupported` and `routing` cannot disagree — for any chain id at all.
    /// @dev Fuzzed, because the two are written as separate lists and the failure mode is one of them
    ///      being edited without the other. A chain `isSupported` says yes to must resolve; one it
    ///      says no to must revert.
    function testFuzz_D12_IsSupportedAndRoutingNeverDisagree(uint256 chainId) public {
        if (UnicaDeploymentsV3.isSupported(chainId)) {
            assertEq(lib.routing(chainId).chainId, chainId, "isSupported said yes and routing named another chain");
        } else {
            vm.expectRevert(abi.encodeWithSelector(UnicaDeploymentsV3.UnsupportedChainId.selector, chainId));
            lib.routing(chainId);
        }
    }

    /// @notice `hasVerifiedPayoutCurrency` and `payoutCurrency` cannot disagree either.
    function testFuzz_D13_ThePayoutFlagAndThePayoutReaderNeverDisagree(uint256 chainId) public {
        if (UnicaDeploymentsV3.hasVerifiedPayoutCurrency(chainId)) {
            assertTrue(lib.payoutCurrency(chainId) != address(0), "the flag said yes and the reader answered zero");
        } else if (chainId == UnicaDeploymentsV3.LEAD_CHAIN_ID) {
            vm.expectRevert(abi.encodeWithSelector(UnicaDeploymentsV3.PayoutCurrencyNotVerified.selector, chainId));
            lib.payoutCurrency(chainId);
        } else {
            vm.expectRevert(abi.encodeWithSelector(UnicaDeploymentsV3.UnsupportedChainId.selector, chainId));
            lib.payoutCurrency(chainId);
        }
    }
}
