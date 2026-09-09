// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SettlementTestBase} from "../utils/SettlementTestBase.sol";
import {NoOpStudy, PassiveDeltaStudy, NoBitTenStudy} from "../../src/lab/NoOpStudy.sol";

/// @title A STUDY of `beforeSwapReturnDelta` — address bit 3, the eleventh permission
/// @notice THIS IS A STUDY, not a tool and not a defence. Every row runs against Uniswap's REAL
///         PoolManager bytecode, etched at its canonical address by `SettlementTestBase`.
///
///         What is measured here, in order:
///           0. which bit this even is, because the permission is the eleventh field of
///              `Hooks.Permissions` but address bit 3, and the two numbers get confused;
///           1. the two controls — a payer swapping through no hook at all, and through a hook that
///              HOLDS the bit and behaves, both receive the payout currency;
///           2. the attack — a hook holding the bit consumes the whole swap, keeps the payer's ETH,
///              and delivers nothing, asserted on the payer's own balances, not on a revert or an
///              event;
///           3. the sabotage control — the same theft attempted from an address WITHOUT the bit
///              reverts, which is what makes row 2 a finding about the bit and not a coincidence;
///           4. UNICA's live hook address, read for that bit, which is clear.
///
///         What is NOT measured here: any on-chain defence a payer could apply, because there is
///         none to measure. `docs/lab/RETURNS-DELTA.md` says so at length and says why.
contract NoOpStudyTest is SettlementTestBase {
    using StateLibrary for IPoolManager;

    /// @dev v4's fourteen permission bits are the low fourteen bits of the hook's address.
    uint160 internal constant PERMISSION_MASK = 0x3FFF;
    /// @dev THE BIT. `Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG` is `1 << 3` in v4-core — address bit 3,
    ///      value 0x8. It is commonly called "bit 10" because it is the eleventh field of
    ///      `Hooks.Permissions` (index 10), and the two numbers are NOT the same bit. Address bit 10
    ///      is `AFTER_ADD_LIQUIDITY_FLAG`. `test_BitTenIsNotTheReturnDeltaBit` measures that, because
    ///      a payer who checks "bit 10" of an address is checking the wrong bit entirely.
    uint160 internal constant RETURN_DELTA_BIT = Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;
    /// @dev What the phrase "bit 10" actually selects out of a hook address.
    uint160 internal constant ADDRESS_BIT_10 = 1 << 10;

    /// @dev `beforeSwap | beforeSwapReturnDelta`. Both study hooks below carry exactly this mask.
    uint160 internal constant STUDY_MASK = Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;
    /// @dev `beforeSwap` alone — the sabotage control's mask. The contract and the test rows below
    ///      keep the colloquial name "bit ten" so a reader searching for the familiar phrase finds
    ///      this study; every assertion message names the real bit.
    uint160 internal constant NO_BIT_TEN_MASK = Hooks.BEFORE_SWAP_FLAG;

    /// @dev Namespaced high bits keep these off precompiles; the low fourteen bits are the subject.
    address internal constant NO_OP_ADDR = address(uint160(STUDY_MASK) ^ (0x4444 << 144));
    address internal constant PASSIVE_ADDR = address(uint160(STUDY_MASK) ^ (0x5555 << 144));
    address internal constant NO_BIT_TEN_ADDR = address(uint160(NO_BIT_TEN_MASK) ^ (0x6666 << 144));

    /// @notice UNICA V1, live on Ethereum Sepolia. Read here for its permission bits only.
    address internal constant UNICA_V1_HOOK = 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0;

    uint256 internal constant AMOUNT_IN = 1e15; // 0.001 ETH, well inside the pool's liquidity
    uint256 internal constant LIQUIDITY_ETH = 10 ether;
    /// @dev What this pool pays for `AMOUNT_IN` when the swap is actually served: 0.000996006981039903
    ///      of the 18-decimal mock payout token — the 0.3% fee plus price impact at this pool's
    ///      liquidity. Measured on this stack, then
    ///      frozen here so "the payer received nothing" is measured against a known non-zero number
    ///      rather than against a hope. The live pool's USDC has six decimals; this is a local mock.
    uint256 internal constant EXPECTED_OUT = 996006981039903;

    NoOpStudy internal noOp;
    PassiveDeltaStudy internal passive;
    NoBitTenStudy internal noBitTen;

    address internal payer = makeAddr("a payer routing through a hook they did not write");

    function setUp() public {
        setUpV4();
        deployCodeTo("NoOpStudy.sol:NoOpStudy", abi.encode(manager), NO_OP_ADDR);
        deployCodeTo("NoOpStudy.sol:PassiveDeltaStudy", abi.encode(manager), PASSIVE_ADDR);
        deployCodeTo("NoOpStudy.sol:NoBitTenStudy", abi.encode(manager), NO_BIT_TEN_ADDR);
        noOp = NoOpStudy(payable(NO_OP_ADDR));
        passive = PassiveDeltaStudy(PASSIVE_ADDR);
        noBitTen = NoBitTenStudy(payable(NO_BIT_TEN_ADDR));
        vm.label(NO_OP_ADDR, "NoOpStudy(return-delta bit set)");
        vm.label(PASSIVE_ADDR, "PassiveDeltaStudy(return-delta bit set)");
        vm.label(NO_BIT_TEN_ADDR, "NoBitTenStudy(return-delta bit clear)");
        vm.deal(payer, 1 ether);
    }

    // --- 0. the addresses are what the rows below claim they are -------------------------------

    /// @notice The two study hooks are indistinguishable by permission bits, and the sabotage
    ///         control differs from them in exactly one bit: bit 10.
    function test_TheTwoStudyHooksCarryIdenticalPermissionBits() public pure {
        uint160 noOpMask = uint160(NO_OP_ADDR) & PERMISSION_MASK;
        uint160 passiveMask = uint160(PASSIVE_ADDR) & PERMISSION_MASK;
        uint160 controlMask = uint160(NO_BIT_TEN_ADDR) & PERMISSION_MASK;

        assertEq(noOpMask, passiveMask, "the two study hooks must be indistinguishable by their bits");
        assertEq(noOpMask, uint160(0x88), "study mask is beforeSwap (0x80) | beforeSwapReturnDelta (0x08)");
        assertTrue(noOpMask & RETURN_DELTA_BIT != 0, "the attacking hook must hold the return-delta bit");
        assertTrue(passiveMask & RETURN_DELTA_BIT != 0, "the well-behaved hook must hold the return-delta bit too");
        assertEq(
            noOpMask ^ controlMask, RETURN_DELTA_BIT, "the sabotage control must differ in the return-delta bit alone"
        );
    }

    /// @notice The correction this study had to make to its own brief. `beforeSwapReturnDelta` is
    ///         the ELEVENTH entry of `Hooks.Permissions` — index 10 — and is routinely called
    ///         "bit 10". In a hook ADDRESS it is bit 3. Address bit 10 is `afterAddLiquidity`, an
    ///         unrelated permission. A reviewer who tests an address for bit 10 learns nothing about
    ///         whether that hook can return a swap delta.
    function test_BitTenIsNotTheReturnDeltaBit() public pure {
        assertEq(RETURN_DELTA_BIT, 1 << 3, "beforeSwapReturnDelta is not address bit 3");
        assertEq(ADDRESS_BIT_10, Hooks.AFTER_ADD_LIQUIDITY_FLAG, "address bit 10 is not afterAddLiquidity");
        assertTrue(RETURN_DELTA_BIT != ADDRESS_BIT_10, "the two bits are the same bit");

        // And the difference is not academic: the attacking hook below holds the return-delta bit
        // and does NOT hold address bit 10. A "bit 10" check would clear it.
        assertTrue(uint160(NO_OP_ADDR) & RETURN_DELTA_BIT != 0, "the attacker does not hold the real bit");
        assertEq(uint160(NO_OP_ADDR) & ADDRESS_BIT_10, 0, "the attacker happens to hold address bit 10");
    }

    // --- 1. the controls, built before the failing row ------------------------------------------

    /// @notice CONTROL. No hook at all: the payer pays ETH and receives the payout currency.
    ///         Without this row, "the payer received nothing" below would prove nothing.
    function test_Control_NoHook_PayerIsPaid() public {
        (PoolKey memory key,) = initNativePoolWithLiquidity(IHooks(address(0)), LIQUIDITY_ETH);

        (uint256 ethSpent, uint256 usdcReceived) = _payerSwaps(key);

        assertEq(ethSpent, AMOUNT_IN, "the payer spent something other than the swap amount");
        assertGt(usdcReceived, 0, "CONTROL BROKEN: a hookless pool paid the payer nothing");
        assertEq(usdcReceived, EXPECTED_OUT, "the hookless pool's payout is not the frozen amount");
    }

    /// @notice CONTROL, and the point of the whole study. This hook's address holds bit 10 — the
    ///         same fourteen bits as the attacker below — and the payer is paid in full. A payer
    ///         reading the address cannot tell these two hooks apart.
    function test_Control_HookHoldingBitTenBehaves_PayerIsPaid() public {
        (PoolKey memory key,) = initNativePoolWithLiquidity(IHooks(address(passive)), LIQUIDITY_ETH);

        (uint256 ethSpent, uint256 usdcReceived) = _payerSwaps(key);

        assertEq(ethSpent, AMOUNT_IN, "the payer spent something other than the swap amount");
        assertGt(usdcReceived, 0, "CONTROL BROKEN: a well-behaved bit-holding hook paid the payer nothing");
        // Exactly what the hookless pool paid, to the wei. The bit changed nothing about the swap;
        // only the hook's decision did.
        assertEq(usdcReceived, EXPECTED_OUT, "a hook holding the bit and behaving paid a different amount");
        assertEq(address(passive).balance, 0, "a hook that took nothing is holding ETH");
    }

    // --- 2. the attack --------------------------------------------------------------------------

    /// @notice THE FINDING. The swap SUCCEEDS. The payer's ETH is gone, the payer's payout-currency
    ///         balance never moved, and the hook is holding the difference. Asserted on the payer's
    ///         actual balances, because a revert or an event would not be proof of loss.
    function test_Attack_PayerPaysInFullAndReceivesNothing() public {
        (PoolKey memory key, PoolId id) = initNativePoolWithLiquidity(IHooks(address(noOp)), LIQUIDITY_ETH);
        (uint160 priceBefore,,,) = manager.getSlot0(id);
        uint128 liquidityBefore = manager.getLiquidity(id);

        (uint256 ethSpent, uint256 usdcReceived) = _payerSwaps(key);

        assertEq(ethSpent, AMOUNT_IN, "the payer paid something other than the full swap amount");
        assertEq(usdcReceived, 0, "the payer received payout currency; the attack did not reproduce");
        assertEq(address(noOp).balance, AMOUNT_IN, "the hook is not holding the payer's input");
        assertEq(noOp.takenTotal(), AMOUNT_IN, "the hook took an amount other than the payer's input");

        // And the pool served nobody: no price move, no liquidity move. The swap that "happened"
        // never touched the curve.
        (uint160 priceAfter,,,) = manager.getSlot0(id);
        assertEq(priceAfter, priceBefore, "the pool price moved, so the pool did serve the swap");
        assertEq(manager.getLiquidity(id), liquidityBefore, "the pool's liquidity moved");
    }

    // --- 3. the sabotage control: the same code, without bit 10 ---------------------------------

    /// @notice SABOTAGE. Identical body, one bit removed from the address. v4-core ignores the
    ///         returned delta, the hook's `take` is never credited back, and the unlock refuses to
    ///         close with an unsettled currency. Bit 10 is the load-bearing part, and this is the
    ///         row that proves the row above is about bit 10 and not about something incidental.
    function test_Sabotage_WithoutBitTen_TheSameTheftReverts() public {
        (PoolKey memory key,) = initNativePoolWithLiquidity(IHooks(address(noBitTen)), LIQUIDITY_ETH);

        uint256 ethBefore = payer.balance;
        vm.prank(payer);
        vm.expectRevert(IPoolManager.CurrencyNotSettled.selector);
        swapRouter.swap{value: AMOUNT_IN}(key, _exactInNative(), _testSettings(), ZERO_BYTES);

        assertEq(payer.balance, ethBefore, "the payer lost ETH in a transaction that reverted");
        assertEq(address(noBitTen).balance, 0, "the hook kept ETH from a reverted transaction");
    }

    // --- 4. UNICA's own address ------------------------------------------------------------------

    /// @notice UNICA V1's live hook does not hold bit 10. Nothing here reaches a network: v4's
    ///         permission bits ARE the low fourteen bits of the address, so this is a fact about
    ///         `0x1120…0C0` itself and it is checkable by anyone holding the address.
    function test_UnicaV1DoesNotHoldBitTen() public pure {
        uint160 unicaMask = uint160(UNICA_V1_HOOK) & PERMISSION_MASK;

        assertEq(unicaMask & RETURN_DELTA_BIT, 0, "UNICA V1 holds beforeSwapReturnDelta");
        assertEq(unicaMask, 0x20C0, "UNICA V1's flags are not beforeInitialize | beforeSwap | afterSwap");
    }

    // --- helpers ---------------------------------------------------------------------------------

    /// @dev One exact-input native swap made BY the payer, returning what the payer actually spent
    ///      and actually received. Balances are read on the payer, never on this test contract.
    function _payerSwaps(PoolKey memory key) internal returns (uint256 ethSpent, uint256 usdcReceived) {
        uint256 ethBefore = payer.balance;
        uint256 usdcBefore = usdc.balanceOf(payer);

        vm.prank(payer);
        swapRouter.swap{value: AMOUNT_IN}(key, _exactInNative(), _testSettings(), ZERO_BYTES);

        ethSpent = ethBefore - payer.balance;
        usdcReceived = usdc.balanceOf(payer) - usdcBefore;
    }

    /// @dev Exact input, currency0 (native ETH) for currency1, the shape every row uses.
    function _exactInNative() internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: true, amountSpecified: -int256(AMOUNT_IN), sqrtPriceLimitX96: MIN_PRICE_LIMIT});
    }

    function _testSettings() internal pure returns (PoolSwapTest.TestSettings memory) {
        return PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
    }
}
