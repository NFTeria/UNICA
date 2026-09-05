// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {SettlementTestBase} from "../utils/SettlementTestBase.sol";
import {SettlementExecutor} from "../../src/SettlementExecutor.sol";
import {UniswapDeployments} from "../../src/libraries/UniswapDeployments.sol";

/// @title Attack: a pool nobody sanctioned, minting genuine receipts
/// @notice Uniswap v4 lets anyone initialise a pool with any hook and any currencies. Before the
///         payout-currency check, an attacker could initialise a pool carrying THIS hook against a
///         token they printed, be its only liquidity provider, register an order naming any
///         recipient, and pay it themselves. The hook could not tell that pool from the sanctioned
///         one: it emitted a real `SettlementReceipt`, from the real hook address, naming a
///         recipient who received nothing of value. An indexer reading receipts by topic, as
///         `docs/RECEIPT-SCHEMA.md` prescribes, would have recorded it as a settlement.
///         Found by the day-5 attack review; five independent lenses reported it (threat T2).
contract HostilePoolAttackTest is SettlementTestBase {
    address internal attacker = makeAddr("attacker");
    address internal victim = makeAddr("a merchant who never consented");

    function setUp() public {
        setUpV4();
        deploySettlement();
        vm.deal(attacker, 10 ether);
    }

    /// @notice The attack, refused. The attacker's own token cannot become a settlement currency,
    ///         so the pool that would have minted the forged receipt cannot be initialised at all,
    ///         and no order can name it.
    function test_RevertWhen_AttackerInitialisesAPoolWithTheirOwnToken() public {
        MockERC20 worthless = new MockERC20("Worthless", "WORTH", 6);
        worthless.mint(attacker, 1_000_000e6);
        PoolKey memory hostile = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(worthless)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        // 1. The pool cannot exist: the hook refuses to be initialised on it.
        vm.prank(attacker);
        vm.expectRevert();
        manager.initialize(hostile, SQRT_PRICE_1_1);

        // 2. And the executor refuses an order naming it, so there is no second way in.
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(SettlementExecutor.PayoutCurrencyNotAllowed.selector, address(worthless))
        );
        executor.createOrder(victim, hostile, 1e15, 1, uint64(block.timestamp + 1 hours), _salt());

        // 3. Nothing was receipted, so nothing an indexer reads can name the victim.
        assertEq(hook.receiptCount(), 0, "the hook receipted a settlement in a pool nobody sanctioned");
    }

    /// @notice The same refusal for the other shapes an attacker would reach for: an ERC-20 input
    ///         (the payer's leg must be native), and the sanctioned payout token in `currency0`.
    function test_RevertWhen_ThePoolShapeIsNotTheSettlementShape() public {
        MockERC20 other = new MockERC20("Other", "OTHR", 18);
        address payout = UniswapDeployments.payoutCurrency(block.chainid);

        PoolKey memory erc20In = PoolKey({
            currency0: Currency.wrap(address(uint160(payout) - 1)),
            currency1: Currency.wrap(payout),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        vm.prank(attacker);
        vm.expectRevert();
        manager.initialize(erc20In, SQRT_PRICE_1_1);

        PoolKey memory wrongOut = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(other)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        vm.prank(attacker);
        vm.expectRevert();
        manager.initialize(wrongOut, SQRT_PRICE_1_1);
    }

    /// @notice The control that makes the refusals mean something: the sanctioned shape still
    ///         initialises, seeds, and settles, and the receipt is emitted exactly once.
    function test_TheSanctionedPoolStillSettles() public {
        (PoolKey memory key,) = initNativePoolWithLiquidity(IHooks(address(hook)), 10 ether);
        vm.prank(victim);
        bytes32 id = executor.createOrder(victim, key, 1e15, 1, uint64(block.timestamp + 1 hours), _salt());
        vm.recordLogs();
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        executor.pay{value: 1e15}(id);
        (uint256 receipts,) = receiptsEmitted();
        assertEq(receipts, 1, "the sanctioned pool stopped settling");
        assertEq(hook.receiptCount(), 1);
    }

    /// @notice Anyone may initialise the sanctioned pool shape, with any fee tier: the check is on
    ///         the currencies, not on who calls. This is deliberate and is what keeps the hook
    ///         permissionless; it is recorded here so the boundary is not mistaken for an oversight.
    function test_AnyoneMayInitialiseTheSanctionedShape() public {
        PoolKey memory sanctioned = nativeUsdcKey(IHooks(address(hook)));
        sanctioned.fee = 500;
        sanctioned.tickSpacing = 10;
        vm.prank(attacker);
        manager.initialize(sanctioned, SQRT_PRICE_1_1);
    }
}
