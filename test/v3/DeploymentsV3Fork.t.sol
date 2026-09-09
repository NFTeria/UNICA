// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IImmutableState} from "@uniswap/v4-periphery/src/interfaces/IImmutableState.sol";
import {RouterParamsCodec} from "../../src/compat/RouterParamsCodec.sol";
import {RouterProbe} from "../../src/compat/RouterProbe.sol";
import {UnicaDeploymentsV3} from "../../src/v3/UnicaDeploymentsV3.sol";

/// @notice The two questions a payout token has to answer for itself.
interface IPayoutToken {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/// @title The V3 table, re-read from the five chains it describes
/// @notice `test/v3/DeploymentsV3.t.sol` proves the table is internally consistent and fails closed.
///         This proves it is TRUE. Every row here forks the chain it is about and reads the real
///         deployed bytecode: the router's runtime code hash against the recorded one, the PoolManager
///         the router itself names against the recorded one, Permit2 and the CREATE2 factory, and the
///         payout token's own `symbol()` and `decimals()`. Nothing is broadcast; a fork is a read-only
///         sandbox and no row claims otherwise.
///
///         THE ROW THAT MATTERS MOST IS THE LAYOUT ONE. `UnicaDeploymentsV3` claims chain 46630's
///         router decodes a six-field head and the other four decode five. That claim is what decides
///         the bytes `UnicaExecutorV3` sends, and on a native-input pool the wrong choice is not
///         reliably loud — it can succeed while the hook data is silently dropped. So the claim is not
///         taken on trust from a comment: `RouterProbe` asks each real router directly, by making one
///         call per layout and classifying the revert, and the answer must be the one the table
///         records. That probe accepts only when exactly ONE layout is accepted, so a router that
///         answered the same way to both would come back `Unknown` and fail the row rather than
///         confirm it.
///
/// @dev A chain that cannot be reached is a SKIP, printed as a skip, never folded into a pass — the
///      same rule `test/compat/` follows, and for the same reason: a gate that goes red on somebody
///      else's downtime is a status page, not a gate. A chain that answers the WRONG chain id is a
///      hard failure, because that is misconfiguration and not weather.
contract DeploymentsV3ForkTest is Test {
    /// @dev The four Circle USDC addresses this repository has verified, on the four chains that have
    ///      one. Held here as well as in the library so that `test_F6` can assert none of them exists
    ///      on the lead chain — which is the EVIDENCE behind `PayoutCurrencyNotVerified`, recorded as
    ///      a check rather than left as a sentence in a comment.
    address internal constant USDC_SEPOLIA = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address internal constant USDC_UNICHAIN = 0x31d0220469e10c4E71834a79b1f276d740d3768F;
    address internal constant USDC_BASE = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address internal constant USDC_ARBITRUM = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    /// @dev Circle's proxy runtime size, identical on all four chains where it was read (2026-09-09).
    ///      A bare "has code" check cannot see a different build at the right address; this can.
    uint256 internal constant PAYOUT_TOKEN_RUNTIME_BYTES = 1798;
    /// @dev The deterministic-deployment proxy's runtime size, identical on all five.
    uint256 internal constant CREATE2_FACTORY_RUNTIME_BYTES = 69;

    // ---- one row per chain, lead chain first ------------------------------------------------------

    function test_F1_Chain46630_TheLeadChain() public {
        if (!_fork(46630, "robinhood_testnet")) return;
        _assertRoutingRowIsTrueOfThisChain(46630);
        _assertLayoutIsWhatTheProbeSays(46630);
    }

    function test_F2_Chain11155111_EthereumSepolia() public {
        if (!_fork(11155111, "sepolia_testnet")) return;
        _assertRoutingRowIsTrueOfThisChain(11155111);
        _assertPayoutTokenIsTrueOfThisChain(11155111);
        _assertLayoutIsWhatTheProbeSays(11155111);
    }

    function test_F3_Chain1301_UnichainSepolia() public {
        if (!_fork(1301, "unichain_testnet")) return;
        _assertRoutingRowIsTrueOfThisChain(1301);
        _assertPayoutTokenIsTrueOfThisChain(1301);
        _assertLayoutIsWhatTheProbeSays(1301);
    }

    function test_F4_Chain84532_BaseSepolia() public {
        if (!_fork(84532, "base_testnet")) return;
        _assertRoutingRowIsTrueOfThisChain(84532);
        _assertPayoutTokenIsTrueOfThisChain(84532);
        _assertLayoutIsWhatTheProbeSays(84532);
    }

    function test_F5_Chain421614_ArbitrumSepolia() public {
        if (!_fork(421614, "arbitrum_testnet")) return;
        _assertRoutingRowIsTrueOfThisChain(421614);
        _assertPayoutTokenIsTrueOfThisChain(421614);
        _assertLayoutIsWhatTheProbeSays(421614);
    }

    /// @notice The evidence behind the lead chain's payout refusal: none of the four verified USDC
    ///         addresses exists on chain 46630.
    /// @dev This does not prove there is NO payout token there — no read can prove that — and the
    ///      library's comment does not claim it does. What it proves is the specific thing the library
    ///      would otherwise have been tempted to assume: that a Circle address from another chain
    ///      carries over. It does not, on any of the four, and that is why the table refuses instead
    ///      of copying one across.
    function test_F6_TheLeadChainHasNoneOfTheFourVerifiedPayoutTokens() public {
        if (!_fork(46630, "robinhood_testnet")) return;
        address[4] memory known = [USDC_SEPOLIA, USDC_UNICHAIN, USDC_BASE, USDC_ARBITRUM];
        for (uint256 i = 0; i < known.length; i++) {
            assertEq(known[i].code.length, 0, "a payout token from another chain exists on the lead chain");
        }
        assertFalse(
            UnicaDeploymentsV3.hasVerifiedPayoutCurrency(46630), "the table claims a payout token this row cannot find"
        );
    }

    // ---- the shared assertions -------------------------------------------------------------------

    /// @dev Everything in the routing row, checked against the chain rather than against itself.
    function _assertRoutingRowIsTrueOfThisChain(uint256 chainId) internal view {
        UnicaDeploymentsV3.Routing memory r = UnicaDeploymentsV3.routing(chainId);

        assertGt(r.universalRouter.code.length, 0, "the recorded router holds no code on this chain");
        assertEq(r.universalRouter.codehash, r.universalRouterCodeHash, "the router is not the recorded build");

        // The router names its own PoolManager. Asking IT rather than trusting the table is what makes
        // this a cross-check and not a second reading of the same transcription.
        address named = address(IImmutableState(r.universalRouter).poolManager());
        assertEq(named, r.poolManager, "the router names a different PoolManager than the table records");
        assertGt(r.poolManager.code.length, 0, "the PoolManager holds no code on this chain");

        assertGt(r.permit2.code.length, 0, "Permit2 holds no code on this chain");
        assertEq(
            UnicaDeploymentsV3.CREATE2_FACTORY.code.length,
            CREATE2_FACTORY_RUNTIME_BYTES,
            "the CREATE2 factory here is not the 69-byte deterministic proxy"
        );
    }

    /// @dev The payout token answers for itself: right size, right symbol, right decimals.
    function _assertPayoutTokenIsTrueOfThisChain(uint256 chainId) internal view {
        address token = UnicaDeploymentsV3.payoutCurrency(chainId);
        assertEq(token.code.length, PAYOUT_TOKEN_RUNTIME_BYTES, "the payout token is not the recorded build");
        assertEq(keccak256(bytes(IPayoutToken(token).symbol())), keccak256("USDC"), "the payout token is not USDC");
        assertEq(IPayoutToken(token).decimals(), 6, "the payout token does not have six decimals");
        // The pool shape the hook enforces needs native (address zero) to sort first. It always does,
        // but a row that assumes it and never says so is a row that hides an assumption.
        assertTrue(uint160(token) > 0, "the payout token sorts before native, so the pool shape is impossible");
    }

    /// @dev The claim that decides what bytes get sent, asked of the real router.
    function _assertLayoutIsWhatTheProbeSays(uint256 chainId) internal {
        UnicaDeploymentsV3.Routing memory r = UnicaDeploymentsV3.routing(chainId);
        RouterParamsCodec.Layout measured = RouterProbe.detect(r.universalRouter);
        assertTrue(
            measured != RouterParamsCodec.Layout.Unknown,
            "the probe could not tell which layout this router wants, so the table cannot be believed here"
        );
        assertEq(uint8(measured), uint8(r.layout), "the table and the real router disagree about the parameter layout");
    }

    // ---- forking ---------------------------------------------------------------------------------

    /// @dev Returns false when the chain could not be reached, having marked the test skipped. A wrong
    ///      chain id is a hard failure: an alias pointing at the wrong network is a configuration bug
    ///      that would otherwise turn every row below it into a claim about a chain nobody asked about.
    function _fork(uint256 chainId, string memory rpcAlias) internal returns (bool) {
        string memory url;
        try vm.rpcUrl(rpcAlias) returns (string memory u) {
            url = u;
        } catch {
            vm.skip(true);
            return false;
        }
        if (bytes(url).length == 0) {
            vm.skip(true);
            return false;
        }
        try vm.createSelectFork(url) returns (uint256) {}
        catch {
            vm.skip(true);
            return false;
        }
        require(block.chainid == chainId, "the alias for this chain answered a different chain id");
        return true;
    }
}
