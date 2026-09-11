// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {StockSettlement46630} from "../../../script/experimental/StockSettlement46630.s.sol";

interface IERC20Transfer {
    function transfer(address, uint256) external returns (bool);
}

/// @title The deploy script, opened up for its own tests
/// @notice Exposes each stage with the deployer passed explicitly — forge refuses a prank and a
///         broadcast at once, so a test cannot drive the script's external entry points as the
///         deployer — and switches on the script's three test seams, each of which injects exactly
///         the failure one of the script's rows exists to catch. With every switch off, this is the
///         script, unchanged.
contract StockSettlement46630Harness is StockSettlement46630 {
    bool public bumpNonceAfterHook;
    bool public moveTslaAfterSeed;
    uint256 public approvalExtra;
    address public constant SINK = address(0x5170CA9E);

    function setBumpNonceAfterHook(bool on) external {
        bumpNonceAfterHook = on;
    }

    function setMoveTslaAfterSeed(bool on) external {
        moveTslaAfterSeed = on;
    }

    function setApprovalExtra(uint256 extra) external {
        approvalExtra = extra;
    }

    // ── the stages, as a given deployer ──────────────────────────────────────────────────────

    function tokenAs(address deployer) external returns (address) {
        return _token(deployer);
    }

    function pairAs(address deployer, address payout) external returns (address, address) {
        return _pair(deployer, payout);
    }

    function poolAs(address deployer, address payout, address hook, uint256 rate, uint256 seedWhole) external {
        _pool(deployer, payout, hook, rate, seedWhole);
    }

    function settleAs(
        address deployer,
        address payout,
        address hook,
        address executor,
        address merchant,
        uint128 amountIn,
        bytes32 salt
    ) external returns (bytes32) {
        return _settle(deployer, Order(payout, hook, executor, merchant, amountIn, salt));
    }

    // ── the arithmetic, for the offline rows ─────────────────────────────────────────────────

    function key(address payout, address hook) external pure returns (PoolKey memory) {
        return _key(payout, hook);
    }

    function sqrtPriceFor(address payout, uint256 rate) external pure returns (uint160) {
        return _sqrtPriceFor(payout, rate);
    }

    function position(address payout, uint160 sqrtPrice, uint256 seedWhole)
        external
        pure
        returns (int24 lower, int24 upper, uint128 liquidity, uint256 seedRaw)
    {
        return _position(payout, sqrtPrice, seedWhole);
    }

    function spotOut(address payout, uint160 sqrtPrice, uint128 amountIn) external pure returns (uint256) {
        return _spotOut(payout, sqrtPrice, amountIn);
    }

    function stopped() external pure returns (string memory) {
        return STOPPED;
    }

    // ── the seams ────────────────────────────────────────────────────────────────────────────

    /// @dev Stands in for a transaction the deployer sends between the hook and the executor.
    function _afterHook(address deployer) internal override {
        if (bumpNonceAfterHook) vm.setNonce(deployer, vm.getNonce(deployer) + 1);
    }

    /// @dev Moves one raw TSLA out of the deployer's wallet after the seed has been placed.
    function _afterSeed(address deployer) internal override {
        if (!moveTslaAfterSeed) return;
        vm.prank(deployer);
        IERC20Transfer(TSLA).transfer(SINK, 1);
    }

    function _approvalAmount(uint128 amountIn) internal view override returns (uint256) {
        return uint256(amountIn) + approvalExtra;
    }
}
