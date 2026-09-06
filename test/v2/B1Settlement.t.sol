// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {V4PoolManagerDeployer} from "hookmate/artifacts/V4PoolManager.sol";

/// @notice A stand-in for the payer's authorisation layer. Permit2 pins `pragma solidity 0.8.17`
///         and this tree pins 0.8.30, so Permit2 cannot be compiled here at all; what matters for
///         the accounting question is only that the tokens arrive at the PoolManager from an
///         address that is NEITHER the payer's counterparty nor the lock holder. This contract is
///         that third party. The Permit2 signature semantics are a separate question, measured
///         separately against its deployed runtime.
contract ThirdPartyMover {
    function move(MockERC20 token, address from, address to, uint256 amount) external {
        token.transferFrom(from, to, amount);
    }
}

/// @title GATE 0 — does `settle()` credit a transfer the lock holder did not make?
/// @notice PATH B1 proposes that the V2 executor holds the v4 lock itself and the payer's token
///         goes STRAIGHT from the payer to the PoolManager, never touching the executor. Whether
///         that is possible turns on one fact about v4's accounting, and this measures it:
///         `settle()` credits measured balance GROWTH since `sync()`, so it should not care who
///         performed the transfer.
///
///         If it does care, B1 is dead and the design falls back to transient executor custody.
contract B1SettlementGateTest is Test, IUnlockCallback {
    IPoolManager internal manager;
    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    PoolKey internal key;
    ThirdPartyMover internal mover;

    address internal payer = address(0xBEEF);
    address internal merchant = address(0x3E4CA47);

    uint256 internal creditedToLockHolder;
    uint256 internal lockHolderInputAtCallbackStart;
    uint256 internal lockHolderInputAtCallbackEnd;
    uint256 internal merchantReceived;

    function setUp() public {
        vm.chainId(11155111);
        address canonical = AddressConstants.getPoolManagerAddress(block.chainid);
        bytes memory initcode = abi.encodePacked(V4PoolManagerDeployer.initcode(), abi.encode(address(this)));
        vm.etch(canonical, initcode);
        (bool ok, bytes memory runtime) = canonical.call("");
        require(ok, "official PoolManager init code reverted");
        vm.etch(canonical, runtime);
        manager = IPoolManager(canonical);

        MockERC20 a = new MockERC20("A", "A", 18);
        MockERC20 b = new MockERC20("B", "B", 18);
        (tokenIn, tokenOut) = address(a) < address(b) ? (a, b) : (b, a);
        mover = new ThirdPartyMover();

        key = PoolKey({
            currency0: Currency.wrap(address(tokenIn)),
            currency1: Currency.wrap(address(tokenOut)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        tokenIn.mint(address(this), 1_000_000 ether);
        tokenOut.mint(address(this), 1_000_000 ether);
        manager.unlock(abi.encode(uint8(1), int256(1e21)));

        // The payer holds the input and authorises only the third-party mover — never this
        // contract, which stands in for the executor. That is the property B1 is claiming.
        tokenIn.mint(payer, 1_000 ether);
        vm.prank(payer);
        tokenIn.approve(address(mover), type(uint256).max);
    }

    function test_Gate0_B1_SettleCreditsATransferMadeByAThirdParty() public {
        uint128 invoice = 1e15;
        manager.unlock(abi.encode(uint8(2), uint256(invoice)));

        assertGt(creditedToLockHolder, 0, "settle credited nothing");
        emit log_named_uint("input credited by settle()", creditedToLockHolder);
        emit log_named_uint("merchant received", merchantReceived);
        assertEq(merchantReceived, invoice, "the merchant was paid the exact invoice");
    }

    /// @dev The property B1 exists for: the payer's token never rests with the lock holder. What
    ///      matters is not that the lock holder's balance is zero — it holds its own unrelated
    ///      tokens — but that the settlement moves NONE of them, in either direction. An earlier
    ///      version of this row compared an absolute balance and failed on the contract's own
    ///      holdings, which measured the wrong thing.
    function test_Gate0_B1_TheLockHoldersOwnBalanceIsUntouchedBySettlement() public {
        manager.unlock(abi.encode(uint8(2), uint256(1e15)));
        emit log_named_uint("lock holder input at callback start", lockHolderInputAtCallbackStart);
        emit log_named_uint("lock holder input at callback end  ", lockHolderInputAtCallbackEnd);
        assertEq(
            lockHolderInputAtCallbackEnd,
            lockHolderInputAtCallbackStart,
            "the settlement moved the lock holder's own input tokens"
        );
    }

    function test_Gate0_B1_ThePayerIsDebitedExactlyTheRealisedInput() public {
        uint256 before = tokenIn.balanceOf(payer);
        manager.unlock(abi.encode(uint8(2), uint256(1e15)));
        uint256 spent = before - tokenIn.balanceOf(payer);
        emit log_named_uint("payer debited", spent);
        assertEq(spent, creditedToLockHolder, "the payer paid exactly what settle credited");
        assertGt(spent, 0, "the payer paid nothing at all");
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only the manager");
        uint8 kind = abi.decode(data[:32], (uint8));

        if (kind == 1) {
            (, int256 liq) = abi.decode(data, (uint8, int256));
            (BalanceDelta d,) = manager.modifyLiquidity(
                key, ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: liq, salt: bytes32(0)}), ""
            );
            if (d.amount0() < 0) {
                manager.sync(key.currency0);
                tokenIn.transfer(address(manager), uint256(uint128(-d.amount0())));
                manager.settle();
            }
            if (d.amount1() < 0) {
                manager.sync(key.currency1);
                tokenOut.transfer(address(manager), uint256(uint128(-d.amount1())));
                manager.settle();
            }
            return "";
        }

        (, uint256 invoice) = abi.decode(data, (uint8, uint256));

        // 1. exact-output swap: the invoice is the specified amount, positive.
        BalanceDelta delta = manager.swap(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: int256(invoice), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );
        uint256 owed = uint256(uint128(-delta.amount0()));

        // 2. sync, then the PAYER's token moves straight to the PoolManager, moved by a third
        //    party. This contract — the stand-in executor and the lock holder — never touches it.
        lockHolderInputAtCallbackStart = tokenIn.balanceOf(address(this));
        manager.sync(key.currency0);
        mover.move(tokenIn, payer, address(manager), owed);

        // 3. settle credits measured growth to the lock holder, whoever moved the tokens.
        creditedToLockHolder = manager.settle();

        // 4. take the output straight to the merchant.
        manager.take(key.currency1, merchant, uint256(uint128(delta.amount1())));
        merchantReceived = tokenOut.balanceOf(merchant);
        lockHolderInputAtCallbackEnd = tokenIn.balanceOf(address(this));
        return "";
    }
}
