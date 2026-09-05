// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {ObserverHook} from "./ObserverHook.sol";
import {ForkLiquidityHelper} from "./ForkLiquidityHelper.sol";

/// @notice The one function of the router this control calls, as the executor declares it.
interface IControlUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @title SepoliaRouterControl, the positive control for the fork probe's instrument
/// @notice Test-only. Runs the same instrument the Robinhood probe runs (the observer hook, the
///         liquidity helper, and the executor's exact plan) against the LISTED Ethereum Sepolia stack
///         on a fork of the real chain, not against etched bytecode. If this passes and the same swap
///         fails on another chain, the difference is that chain's router, not the instrument. Skipped
///         unless `SEPOLIA_RPC_URL` is set (or `--fork-url` names a Sepolia fork). Nothing is broadcast.
/// @dev The PoolManager and Universal Router addresses are the ones the repository already uses for
///      Sepolia (`UniswapDeployments`, hookmate's `AddressConstants`); they are spelled out here so this
///      file stays independent of the chain tables and of the settlement contracts.
contract SepoliaRouterControlTest is Test {
    using CurrencyLibrary for Currency;

    uint256 internal constant CHAIN_ID = 11155111;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant UNIVERSAL_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint128 internal constant AMOUNT_IN = 1e15;
    uint8 internal constant COMMAND_V4_SWAP = 0x10;
    uint160 internal constant OBSERVER_FLAGS = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    IPoolManager internal manager = IPoolManager(POOL_MANAGER);
    MockERC20 internal token;
    ForkLiquidityHelper internal helper;
    ObserverHook internal observer;
    PoolKey internal key;
    address internal merchant = makeAddr("merchant");

    function setUp() public {
        if (block.chainid != CHAIN_ID) {
            string memory url = vm.envOr("SEPOLIA_RPC_URL", string(""));
            if (bytes(url).length == 0) {
                vm.skip(true);
                return;
            }
            vm.createSelectFork(url);
        }
        assertEq(block.chainid, CHAIN_ID, "not a fork of Ethereum Sepolia");

        token = new MockERC20("Control Token", "CTL", 18);
        helper = new ForkLiquidityHelper(manager);
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(helper), type(uint256).max);
        vm.deal(address(this), 100 ether);

        observer = _deployObserver();
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(observer))
        });
        manager.initialize(key, SQRT_PRICE_1_1);
        helper.modifyLiquidity{value: 1 ether}(
            key, ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: 0})
        );
        vm.label(POOL_MANAGER, "PoolManager(Sepolia)");
        vm.label(UNIVERSAL_ROUTER, "UniversalRouter(Sepolia)");
    }

    /// @notice The executor's exact plan through the listed Sepolia router reaches the observer with the
    ///         router as sender, this contract as the router's caller, the same hookData, one callback
    ///         each, a full fill, and nothing stranded. This is what the Robinhood probe asks of its router.
    function test_Control_UnicaPlanSwapsThroughTheListedSepoliaRouter() public {
        bytes32 hookData = keccak256(abi.encode(block.chainid, address(this), "control order"));
        (bytes memory commands, bytes[] memory inputs) = _unicaPlan(hookData);
        uint256 callerBefore = address(this).balance;
        uint256 callerTokenBefore = token.balanceOf(address(this));
        uint256 routerBefore = UNIVERSAL_ROUTER.balance;

        IControlUniversalRouter(UNIVERSAL_ROUTER).execute{value: AMOUNT_IN}(commands, inputs, block.timestamp + 1 hours);

        assertEq(observer.beforeSwapCalls(), 1, "one beforeSwap");
        assertEq(observer.afterSwapCalls(), 1, "one afterSwap");
        assertEq(observer.beforeSender(), UNIVERSAL_ROUTER, "sender is the router");
        assertEq(observer.beforeRouterCaller(), address(this), "router.msgSender() is this contract");
        assertEq(observer.beforeHookData(), hookData, "hookData");
        assertEq(observer.afterAmount0(), -int128(AMOUNT_IN), "full fill");
        int128 out = observer.afterAmount1();
        assertGt(out, 0, "no output");
        assertEq(token.balanceOf(merchant), uint256(uint128(out)), "recipient received the credit");
        assertEq(UNIVERSAL_ROUTER.balance, routerBefore, "router native balance changed");
        assertEq(token.balanceOf(UNIVERSAL_ROUTER), 0, "router holds the output token");
        // This contract minted the token, so it holds a balance; the output must not have come here.
        assertEq(token.balanceOf(address(this)), callerTokenBefore, "caller received output token");
        assertEq(callerBefore - address(this).balance, AMOUNT_IN, "caller paid something other than the input");
    }

    function _unicaPlan(bytes32 hookData) internal view returns (bytes memory commands, bytes[] memory inputs) {
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key, zeroForOne: true, amountIn: AMOUNT_IN, amountOutMinimum: 1, hookData: abi.encode(hookData)
            })
        );
        params[1] = abi.encode(key.currency0, ActionConstants.OPEN_DELTA, false);
        params[2] = abi.encode(key.currency1, merchant, ActionConstants.OPEN_DELTA);
        inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        commands = abi.encodePacked(COMMAND_V4_SWAP);
    }

    function _deployObserver() internal returns (ObserverHook deployed) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(ObserverHook).creationCode, abi.encode(manager)));
        bytes32 salt;
        address predicted;
        for (uint256 i = 0; i < 200_000; i++) {
            salt = bytes32(i);
            predicted = vm.computeCreate2Address(salt, initCodeHash, address(this));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == OBSERVER_FLAGS) break;
            predicted = address(0);
        }
        require(predicted != address(0), "no salt found for the observer's flags");
        deployed = new ObserverHook{salt: salt}(manager);
        assertEq(address(deployed), predicted, "observer landed elsewhere");
        vm.label(address(deployed), "ObserverHook(mock)");
    }

    receive() external payable {}
}
