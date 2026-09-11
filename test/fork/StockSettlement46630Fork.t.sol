// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {StockSettlement46630Harness} from "../experimental/util/StockSettlement46630Harness.sol";
import {UnicaStockSettlementExecutor} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol";
import {UnicaStockSettlementErrors as E} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementErrors.sol";

interface IERC20F {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

/// @title The 46630 deploy script against real Robinhood testnet state, on a fork
/// @notice Every stage runs INTO A LOCAL FORK: real PoolManager, PositionManager, Permit2 and the
///         faucet TSLA proxy, as the real deployer, with its real nonce and balances. Nothing here
///         reaches the chain. The contracts these rows deploy exist only in the fork.
///
///         Needs ROBINHOOD_TESTNET_RPC_URL in the environment (forge reads .env). Without it every row
///         SKIPS — visibly, never as a pass. Not in `make gate`: a gate that depends on somebody
///         else's endpoint is a status page. `make fork` runs it.
///
///         Each refusal row names the failure it injects and expects the script's own stop sentence
///         or the contract's own named error — never a bare revert, which would accept any failure.
contract StockSettlement46630ForkTest is Test {
    StockSettlement46630Harness internal h;
    bool internal forked;
    string internal stopped;

    address internal constant DEPLOYER = 0xA121e1eF31BbF0826aa67dc01e7977e80Af58D73;
    address internal constant TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;
    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    uint256 internal constant RATE = 395;
    address internal merchant = makeAddr("merchant");

    function setUp() public {
        string memory url = vm.envOr("ROBINHOOD_TESTNET_RPC_URL", string(""));
        if (bytes(url).length == 0) return;
        vm.createSelectFork(url);
        forked = true;
        h = new StockSettlement46630Harness();
        stopped = h.stopped();
    }

    modifier onFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function _deployAll(uint256 seedWhole) internal returns (address token, address hook, address executor) {
        token = h.tokenAs(DEPLOYER);
        (hook, executor) = h.pairAs(DEPLOYER, token);
        h.poolAs(DEPLOYER, token, hook, RATE, seedWhole);
    }

    /// @dev Opens the PoolManager's WrappedError envelope and returns the hook's own reason.
    function _hookReason(bytes memory err, address hook) internal pure returns (bytes4) {
        require(bytes4(err) == CustomRevert.WrappedError.selector, "not a wrapped hook revert");
        bytes memory body = new bytes(err.length - 4);
        for (uint256 i = 0; i < body.length; i++) {
            body[i] = err[i + 4];
        }
        (address target,, bytes memory inner,) = abi.decode(body, (address, bytes4, bytes, bytes));
        require(target == hook, "the refusal came from somewhere other than the hook");
        return bytes4(inner);
    }

    // ── the control: the whole plan succeeds, in exactly eleven transactions ──────────────────

    function test_F0_control_the_eleven_transactions_settle_a_TSLA_payment() public onFork {
        uint64 n0 = vm.getNonce(DEPLOYER);
        (address token, address hook, address executor) = _deployAll(10_000);
        h.settleAs(DEPLOYER, token, hook, executor, merchant, 0.1e18, bytes32("f0"));
        assertEq(vm.getNonce(DEPLOYER) - n0, 11, "not exactly 11 transactions");
        assertGt(IERC20F(token).balanceOf(merchant), 0, "the merchant received nothing");
        assertEq(hook.code.length > 0 && executor.code.length > 0, true, "missing code");
    }

    // ── refusals, each injecting one failure ──────────────────────────────────────────────────

    function test_F1_the_input_token_offered_as_the_payout_token_is_refused() public onFork {
        vm.expectRevert(bytes(stopped));
        h.pairAs(DEPLOYER, TSLA);
    }

    function test_F1b_an_address_with_no_code_offered_as_the_payout_token_is_refused() public onFork {
        vm.expectRevert(bytes(stopped));
        h.pairAs(DEPLOYER, makeAddr("not-a-token"));
    }

    /// @dev A transaction slipped in between the hook and the executor moves the executor off the
    ///      address the hook was mined against. The hook would then admit a contract that is not
    ///      this executor, and every swap through it would fail. The post-row refuses the stage.
    function test_F2_a_nonce_moved_between_hook_and_executor_is_refused() public onFork {
        address token = h.tokenAs(DEPLOYER);
        h.setBumpNonceAfterHook(true);
        vm.expectRevert(bytes(stopped));
        h.pairAs(DEPLOYER, token);
    }

    function test_F3_a_deployer_without_enough_TSLA_is_refused() public onFork {
        (address token, address hook, address executor) = _deployAll(10_000);
        uint256 all = IERC20F(TSLA).balanceOf(DEPLOYER);
        vm.prank(DEPLOYER);
        IERC20F(TSLA).transfer(makeAddr("elsewhere"), all);
        vm.expectRevert(bytes(stopped));
        h.settleAs(DEPLOYER, token, hook, executor, merchant, 0.1e18, bytes32("f3"));
    }

    /// @dev One whole TSLA at 395 needs a floor of about 383 uTUSD; a 100-uTUSD seed cannot cover it.
    function test_F4_a_pool_without_enough_uTUSD_for_the_floor_is_refused() public onFork {
        (address token, address hook, address executor) = _deployAll(100);
        vm.expectRevert(bytes(stopped));
        h.settleAs(DEPLOYER, token, hook, executor, merchant, 1e18, bytes32("f4"));
    }

    function test_F5_an_approval_that_would_leave_a_standing_allowance_is_refused() public onFork {
        (address token, address hook, address executor) = _deployAll(10_000);
        h.setApprovalExtra(1);
        vm.expectRevert(bytes(stopped));
        h.settleAs(DEPLOYER, token, hook, executor, merchant, 0.1e18, bytes32("f5"));
    }

    /// @dev Beyond the script's own rows, straight at the contracts on real chain state: an order the
    ///      100-uTUSD position cannot absorb stops short, and the hook refuses the partial fill.
    function test_F6_a_short_fill_is_refused_by_the_hook() public onFork {
        (address token, address hook, address executor) = _deployAll(100);
        PoolKey memory key = h.key(token, hook);
        vm.prank(DEPLOYER);
        bytes32 id = UnicaStockSettlementExecutor(executor)
            .createOrder(merchant, key, 1e18, 1, uint64(block.timestamp + 1 hours), DEPLOYER, bytes32("f6"));
        vm.prank(DEPLOYER);
        IERC20F(TSLA).approve(executor, 1e18);
        vm.prank(DEPLOYER);
        try UnicaStockSettlementExecutor(executor).pay(id) {
            fail("a short fill settled");
        } catch (bytes memory err) {
            assertEq(_hookReason(err, hook), E.PartialFill.selector, "refused, but not as a partial fill");
        }
    }

    /// @dev 0.2 TSLA against a 100-uTUSD seed: the floor (97% of spot, about 76.6 uTUSD) fits inside the
    ///      reserve, so every pre-flight row passes — but price impact across the thin position leaves
    ///      the swap near 64 uTUSD, and the hook refuses it below the merchant's minimum.
    function test_F7_a_settlement_below_the_merchant_minimum_is_refused_by_the_hook() public onFork {
        (address token, address hook, address executor) = _deployAll(100);
        try h.settleAs(DEPLOYER, token, hook, executor, merchant, 0.2e18, bytes32("f7")) {
            fail("a settlement below the merchant's minimum went through");
        } catch (bytes memory err) {
            assertEq(_hookReason(err, hook), E.OutputBelowMinimum.selector, "refused, but not by the floor");
        }
    }

    function test_F8_TSLA_leaving_the_deployer_during_the_pool_stage_is_refused() public onFork {
        address token = h.tokenAs(DEPLOYER);
        (address hook,) = h.pairAs(DEPLOYER, token);
        h.setMoveTslaAfterSeed(true);
        vm.expectRevert(bytes(stopped));
        h.poolAs(DEPLOYER, token, hook, RATE, 10_000);
    }

    // ── the pool stage resumes its own partial run, and refuses anyone else's pool ────────────

    /// @dev The real partial-failure case: the initialise landed and the seeding did not. A re-run at
    ///      the same rate must finish in four transactions, not refuse on its own earlier success.
    function test_F9_the_pool_stage_resumes_after_only_the_initialise_landed() public onFork {
        address token = h.tokenAs(DEPLOYER);
        (address hook,) = h.pairAs(DEPLOYER, token);
        vm.prank(DEPLOYER);
        POOL_MANAGER.initialize(h.key(token, hook), h.sqrtPriceFor(token, RATE));
        uint64 n0 = vm.getNonce(DEPLOYER);
        h.poolAs(DEPLOYER, token, hook, RATE, 10_000);
        assertEq(vm.getNonce(DEPLOYER) - n0, 4, "a resumed pool stage sends four transactions");
        assertGt(IERC20F(token).balanceOf(address(POOL_MANAGER)), 0, "the resumed stage placed no seed");
    }

    function test_F10_a_pool_somebody_else_initialised_at_another_rate_is_refused() public onFork {
        address token = h.tokenAs(DEPLOYER);
        (address hook,) = h.pairAs(DEPLOYER, token);
        vm.prank(makeAddr("somebody-else"));
        POOL_MANAGER.initialize(h.key(token, hook), h.sqrtPriceFor(token, RATE + 105));
        vm.expectRevert(bytes(stopped));
        h.poolAs(DEPLOYER, token, hook, RATE, 10_000);
    }
}
