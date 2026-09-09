// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {RouterParamsCodec} from "../../src/compat/RouterParamsCodec.sol";
import {RouterProbe} from "../../src/compat/RouterProbe.sol";

/// @notice The six-field layout, declared here because this repository's pinned v4-periphery cannot
///         declare it — the pin predates the field. Nothing imports this; it exists so the codec's
///         output can be decoded by a type that was written independently of the encoder, which is
///         the only way "the bytes are right" means anything.
struct PerHopExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    uint256 minHopPriceX36;
    bytes hookData;
}

/// @title The codec, without a router in the room
/// @notice These rows are about BYTES. They need no fork and no network, they run in the ordinary
///         gate, and they are what makes the fork suites diagnosable: if a fork row goes red, these
///         rows say whether the encoder moved or the router did.
///
///         The two rows that matter most are the misread rows at the bottom. They do not merely omit
///         a defence and watch something fail — they reproduce the PRECONDITION of the bug: a decoder
///         built for one layout, reading the other layout's word 8 as the offset of the dynamic tail.
///         One of them reverts and one of them silently returns empty hook data, and which you get
///         depends only on whether `currency0` is the zero address. That is the whole incompatibility,
///         reproduced in twenty lines with no chain involved.
contract RouterParamsCodecTest is Test {
    using CurrencyLibrary for Currency;

    bytes32 internal constant ORDER_ID = keccak256("UNICA codec row: one order id");
    address internal constant TOKEN = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address internal constant HOOK = 0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0;

    /// @dev A native-input pool, the shape UNICA settles through: `currency0` is the zero address.
    function _nativeInput(uint256 minHopPriceX36) internal pure returns (RouterParamsCodec.SwapExactInSingle memory p) {
        p = RouterParamsCodec.SwapExactInSingle({
            poolKey: PoolKey({
                currency0: CurrencyLibrary.ADDRESS_ZERO,
                currency1: Currency.wrap(TOKEN),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(HOOK)
            }),
            zeroForOne: true,
            amountIn: 1e15,
            amountOutMinimum: 1234,
            minHopPriceX36: minHopPriceX36,
            hookData: abi.encode(ORDER_ID)
        });
    }

    /// @dev The same, with a NON-zero `currency0`: an ERC-20 input pool.
    function _tokenInput() internal pure returns (RouterParamsCodec.SwapExactInSingle memory p) {
        p = _nativeInput(0);
        p.poolKey.currency0 = Currency.wrap(address(uint160(TOKEN) - 1));
    }

    // ---- the legacy layout ---------------------------------------------------------------------

    /// @notice The five-field encoding IS this repository's pinned periphery type, byte for byte, and
    ///         round-trips through it. The pinned type is the authority for that layout, so the row is
    ///         written against it rather than against a hand-counted word list.
    function test_LegacyEncodingIsThePinnedPeripheryStruct() public pure {
        RouterParamsCodec.SwapExactInSingle memory p = _nativeInput(0);
        bytes memory encoded = RouterParamsCodec.encodeLegacy(p);

        assertEq(
            encoded,
            abi.encode(
                IV4Router.ExactInputSingleParams({
                    poolKey: p.poolKey,
                    zeroForOne: p.zeroForOne,
                    amountIn: p.amountIn,
                    amountOutMinimum: p.amountOutMinimum,
                    hookData: p.hookData
                })
            ),
            "the legacy encoding is not the pinned periphery struct"
        );

        IV4Router.ExactInputSingleParams memory back = abi.decode(encoded, (IV4Router.ExactInputSingleParams));
        assertEq(Currency.unwrap(back.poolKey.currency0), Currency.unwrap(p.poolKey.currency0), "currency0");
        assertEq(Currency.unwrap(back.poolKey.currency1), Currency.unwrap(p.poolKey.currency1), "currency1");
        assertEq(back.poolKey.fee, p.poolKey.fee, "fee");
        assertEq(back.poolKey.tickSpacing, p.poolKey.tickSpacing, "tickSpacing");
        assertEq(address(back.poolKey.hooks), address(p.poolKey.hooks), "hooks");
        assertEq(back.zeroForOne, p.zeroForOne, "zeroForOne");
        assertEq(back.amountIn, p.amountIn, "amountIn");
        assertEq(back.amountOutMinimum, p.amountOutMinimum, "amountOutMinimum");
        assertEq(back.hookData, p.hookData, "hookData");
    }

    /// @notice A per-hop floor cannot be encoded into a layout with nowhere to put it, and the codec
    ///         says so instead of dropping it. A settlement that asked for slippage protection and got
    ///         a swap without it would succeed, which is the shape of failure that costs money.
    function test_LegacyEncodeRefusesAPerHopFloor() public {
        RouterParamsCodec.SwapExactInSingle memory p = _nativeInput(1);
        vm.expectRevert(abi.encodeWithSelector(RouterParamsCodec.LegacyLayoutCannotCarryMinHopPrice.selector, 1));
        this.encodeLegacy(p);
    }

    /// @notice There is no default layout. `Unknown` is refused rather than resolved.
    function test_EncodeRefusesTheUnknownLayout() public {
        vm.expectRevert(RouterParamsCodec.UnknownLayout.selector);
        this.encode(RouterParamsCodec.Layout.Unknown, _nativeInput(0));
    }

    // ---- the per-hop layout --------------------------------------------------------------------

    /// @notice The six-field encoding decodes into a six-field struct this file declares itself,
    ///         field for field, including a NON-ZERO `minHopPriceX36` so the field is proven to carry
    ///         a value and not merely to occupy a word.
    function test_PerHopEncodingDecodesIntoTheSixFieldStruct() public pure {
        RouterParamsCodec.SwapExactInSingle memory p = _nativeInput(7 << 36);
        PerHopExactInputSingleParams memory back =
            abi.decode(RouterParamsCodec.encodePerHop(p), (PerHopExactInputSingleParams));

        assertEq(Currency.unwrap(back.poolKey.currency0), Currency.unwrap(p.poolKey.currency0), "currency0");
        assertEq(Currency.unwrap(back.poolKey.currency1), Currency.unwrap(p.poolKey.currency1), "currency1");
        assertEq(back.poolKey.fee, p.poolKey.fee, "fee");
        assertEq(back.poolKey.tickSpacing, p.poolKey.tickSpacing, "tickSpacing");
        assertEq(address(back.poolKey.hooks), address(p.poolKey.hooks), "hooks");
        assertEq(back.zeroForOne, p.zeroForOne, "zeroForOne");
        assertEq(back.amountIn, p.amountIn, "amountIn");
        assertEq(back.amountOutMinimum, p.amountOutMinimum, "amountOutMinimum");
        assertEq(back.minHopPriceX36, p.minHopPriceX36, "minHopPriceX36");
        assertEq(back.hookData, p.hookData, "hookData");
    }

    /// @notice Where each word sits. A field inserted in the wrong place would still round-trip
    ///         through the struct above — both encoder and decoder would be wrong together — so this
    ///         row asserts POSITIONS against the numbers a router's assembly decoder actually loads.
    function test_TheSixthFieldSitsAtWordEightAndMovesTheOffset() public pure {
        RouterParamsCodec.SwapExactInSingle memory p = _nativeInput(7 << 36);
        bytes memory legacy = RouterParamsCodec.encodeLegacy(_nativeInput(0));
        bytes memory perHop = RouterParamsCodec.encodePerHop(p);

        assertEq(perHop.length, legacy.length + 32, "the per-hop layout is not exactly one word longer");
        // Word 0 of both is the outer offset to the struct; the head starts at word 1.
        assertEq(uint256(_word(legacy, 0)), 0x20, "legacy outer offset");
        assertEq(uint256(_word(perHop, 0)), 0x20, "per-hop outer offset");
        // Word 8 of the head: the hook-data offset under the legacy layout, `minHopPriceX36` under the
        // per-hop layout. This one word is the entire incompatibility.
        assertEq(uint256(_word(legacy, 1 + 8)), 0x120, "legacy word 8 is not the hook-data offset");
        assertEq(uint256(_word(perHop, 1 + 8)), p.minHopPriceX36, "per-hop word 8 is not minHopPriceX36");
        // Word 9 of the head: nothing under the legacy layout (the tail has begun), the hook-data
        // offset under the per-hop layout.
        assertEq(uint256(_word(perHop, 1 + 9)), 0x140, "per-hop word 9 is not the hook-data offset");
        assertEq(RouterParamsCodec.MIN_HOP_PRICE_WORD_INDEX, 8, "the documented word index moved");
        assertEq(RouterParamsCodec.LEGACY_HEAD_WORDS + 1, RouterParamsCodec.PER_HOP_HEAD_WORDS, "head sizes");
    }

    // ---- the misread: the bug's precondition, with no router involved ---------------------------

    /// @notice THE SILENT ONE. A five-field decoder reading the six-field encoding takes word 8 —
    ///         `minHopPriceX36`, zero for every single-hop settlement — as the hook-data offset, lands
    ///         on `currency0`, and on a NATIVE-input pool reads that zero address as a length of zero.
    ///         No revert. Empty hook data. The order id is gone and the swap would proceed.
    ///         `test/compat/SepoliaRouterControl.t.sol` row 2 shows the listed Sepolia router doing
    ///         exactly this with real bytecode; this row shows it is the ABI, not that router.
    function test_LegacyDecoderSilentlyDropsHookDataFromThePerHopEncoding() public pure {
        bytes memory perHop = RouterParamsCodec.encodePerHop(_nativeInput(0));
        IV4Router.ExactInputSingleParams memory misread = abi.decode(perHop, (IV4Router.ExactInputSingleParams));

        assertEq(misread.hookData.length, 0, "the hook data survived a misread it cannot survive");
        // And the fields before the tail decoded correctly, which is what makes this dangerous: nothing
        // about the result looks wrong except the part that was thrown away.
        assertEq(misread.amountIn, 1e15, "amountIn");
        assertEq(misread.amountOutMinimum, 1234, "amountOutMinimum");
    }

    /// @notice THE LOUD ONE, and the same misread. With a non-zero `currency0` the length read out of
    ///         that word is astronomical, the decode runs off the end of the data, and it reverts.
    ///         This is why `RouterProbe` names a non-native currency: on the probe's key the mismatch
    ///         is always the loud case, so the detector cannot be fooled by the row above.
    function test_LegacyDecoderRevertsOnThePerHopEncodingWhenCurrency0IsNotZero() public {
        bytes memory perHop = RouterParamsCodec.encodePerHop(_tokenInput());
        vm.expectRevert();
        this.decodeLegacy(perHop);
    }

    /// @notice The mirror misread: a six-field decoder reading the five-field encoding takes word 9 —
    ///         the tail's LENGTH word, 32 for one `bytes32` — as the offset, lands on `currency1`, and
    ///         reverts on the length it finds there. This is the direction
    ///         `docs/feedback/uniswap/robinhood.md` recorded on chain 46630 as an empty revert.
    function test_PerHopDecoderRevertsOnTheLegacyEncoding() public {
        bytes memory legacy = RouterParamsCodec.encodeLegacy(_nativeInput(0));
        vm.expectRevert();
        this.decodePerHop(legacy);
    }

    // ---- the probe's calldata, before any router is asked ---------------------------------------

    /// @notice The two probes differ by exactly the one word, carry the same function selector, and
    ///         both carry NON-EMPTY hook data — which is the condition that makes a layout mismatch
    ///         visible at all.
    function test_ProbeCalldataDiffersByExactlyOneWord() public pure {
        bytes memory legacy = RouterProbe.probeCalldata(RouterParamsCodec.Layout.Legacy);
        bytes memory perHop = RouterProbe.probeCalldata(RouterParamsCodec.Layout.PerHop);

        assertEq(perHop.length, legacy.length + 32, "the two probes differ by more than one word");
        assertEq(bytes4(legacy), bytes4(perHop), "the two probes call different functions");
        assertEq(bytes4(legacy), bytes4(keccak256("execute(bytes,bytes[],uint256)")), "not the router's execute");
    }

    /// @notice The probe refuses an address with no code instead of reading an empty return as a
    ///         verdict. An EOA answers every call successfully with nothing, which is indistinguishable
    ///         from a rejection to anything that does not check first.
    function test_ProbeRefusesATargetWithNoCode() public {
        address eoa = makeAddr("not a router");
        vm.expectRevert(abi.encodeWithSelector(RouterProbe.ProbeTargetHasNoCode.selector, eoa));
        this.probe(eoa, RouterParamsCodec.Layout.Legacy);
    }

    // ---- external wrappers, so `expectRevert` measures the call and not this contract ------------

    function encodeLegacy(RouterParamsCodec.SwapExactInSingle memory p) external pure returns (bytes memory) {
        return RouterParamsCodec.encodeLegacy(p);
    }

    function encode(RouterParamsCodec.Layout layout, RouterParamsCodec.SwapExactInSingle memory p)
        external
        pure
        returns (bytes memory)
    {
        return RouterParamsCodec.encode(layout, p);
    }

    function decodeLegacy(bytes memory data) external pure returns (IV4Router.ExactInputSingleParams memory) {
        return abi.decode(data, (IV4Router.ExactInputSingleParams));
    }

    function decodePerHop(bytes memory data) external pure returns (PerHopExactInputSingleParams memory) {
        return abi.decode(data, (PerHopExactInputSingleParams));
    }

    function probe(address router, RouterParamsCodec.Layout layout)
        external
        returns (RouterProbe.Verdict, bytes memory)
    {
        return RouterProbe.probe(router, layout);
    }

    /// @dev Word `i` of a memory bytes value, counting from zero. The router's decoder reads calldata
    ///      exactly this way, which is why the positional row is written in these terms.
    function _word(bytes memory data, uint256 i) internal pure returns (bytes32 w) {
        require(data.length >= (i + 1) * 32, "codec test: word out of range");
        assembly ("memory-safe") {
            w := mload(add(add(data, 0x20), mul(i, 0x20)))
        }
    }
}
