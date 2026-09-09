// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {RouterParamsCodec} from "./RouterParamsCodec.sol";

/// @notice The one function of Uniswap's Universal Router this probe calls, as the executor declares it.
interface IUniversalRouterExecute {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @title RouterProbe, asking a deployed Universal Router which parameter layout it expects
/// @notice A Universal Router exposes no version, no ABI discriminator, and no distinguishing revert:
///         `poolManager()` and `msgSender()` answer identically on both builds. The only thing that
///         tells the two apart is how they DECODE, so the only honest way to ask is to make one and
///         watch what comes back. This library does that.
///
///         WHAT THE PROBE COSTS. One reverted call per layout, two for a full `detect`. Gas, nothing
///         else.
///
///         WHAT THE PROBE CHANGES. Nothing, and not by promise — by construction, three ways over:
///
///         1. It sends ZERO value. There is no input to lose.
///         2. It names a pool key that CANNOT EXIST on any chain, now or ever: `currency0` equals
///            `currency1`, and `tickSpacing` is zero. `PoolManager.initialize` refuses both
///            (`CurrenciesOutOfOrderOrEqual`, `TickSpacingTooSmall`), so that pool id's `slot0` is
///            permanently zero and `swap` can only answer `PoolNotInitialized`. That refusal IS the
///            measurement: reaching it means the router decoded the parameters and got as far as the
///            pool, which is the whole question being asked.
///         3. Its plan carries the SWAP action alone — no `SETTLE`, no `TAKE`. Even in the impossible
///            world where that pool existed and the swap filled, the unlock would end with an
///            unbalanced delta and the PoolManager would revert on the way out. There is no path
///            through this calldata that moves a token.
///
///         So the probe is side-effect-free on a live chain and needs no fork to be safe. It is a
///         CALL and not a `staticcall`, and that is not an oversight: the Universal Router writes
///         transient storage before it decodes anything, so a static context would refuse every probe
///         with the same empty revert the mismatch produces, and the instrument would answer
///         "rejected" to every question ever put to it.
///
///         WHAT THE PROBE CANNOT TELL YOU. That a router which decodes a layout will also SETTLE a
///         real swap through it. It answers one question — which head the decoder reads — and the
///         verdict is fail-closed everywhere else: two accepts, two rejects, an unexpected revert or
///         a call that does not revert at all all come back as `Unknown` rather than as a guess.
///
/// @dev Two known hazards, both stated rather than papered over. An out-of-gas inside the probe
///      returns empty return data and is therefore indistinguishable from a layout rejection, so give
///      `detect` real gas; a systematic shortage makes BOTH probes look rejected and lands on
///      `Unknown`, which is the safe end of that failure. And a router that wraps its callback's
///      revert data instead of bubbling it would answer `Inconclusive` for every layout — again
///      `Unknown`, never a wrong layout.
library RouterProbe {
    using RouterParamsCodec for RouterParamsCodec.Layout;

    /// @notice What one layout's probe learned.
    /// @dev `Rejected` is the zero value: the answer you get when nothing happened is "no".
    enum Verdict {
        Rejected,
        Accepted,
        Inconclusive
    }

    /// @notice The probe was pointed at an address with no code. There is nothing there to ask.
    error ProbeTargetHasNoCode(address router);
    /// @notice The probe call RETURNED instead of reverting, so one of this library's three
    ///         no-side-effect guarantees is not holding on this chain. Fail loudly: a probe that can
    ///         succeed is a probe that can do something, and the caller must be told, not reassured.
    error ProbeDidNotRevert(address router, RouterParamsCodec.Layout layout);

    /// @dev The Universal Router command that runs v4 actions, as `SettlementExecutor` encodes it.
    uint8 internal constant COMMAND_V4_SWAP = 0x10;

    /// @dev One word of hook data, which is what makes the layout mismatch visible at all: with EMPTY
    ///      hook data both decoders read a zero-length tail and neither refuses. Its content is never
    ///      read by anything, because the pool it names does not exist. It is recognisable in a trace
    ///      on purpose.
    bytes32 internal constant PROBE_HOOK_DATA = keccak256("UNICA RouterProbe: layout question, not a swap");

    /// @dev Both currencies are the same non-zero address, which does two jobs. It makes the pool
    ///      uninitialisable, and it makes the mismatched decode read a LENGTH of 2^160-1 out of the
    ///      wrong word, which runs off the end of calldata and produces the empty revert this probe
    ///      classifies. A zero currency here would make the empty-hook-data case decode cleanly and
    ///      the instrument would answer "accepted" to both layouts.
    address internal constant PROBE_CURRENCY = address(type(uint160).max);

    /// @notice The pool key every probe names: two identical currencies, zero tick spacing, no hook.
    ///         Uninitialisable by two independent rules of `PoolManager.initialize`.
    function probeKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(PROBE_CURRENCY),
            currency1: Currency.wrap(PROBE_CURRENCY),
            fee: 0,
            tickSpacing: 0,
            hooks: IHooks(address(0))
        });
    }

    /// @notice The exact bytes a probe sends, so an operator can `eth_call` one by hand, diff it, or
    ///         read it in a trace without deploying anything.
    function probeCalldata(RouterParamsCodec.Layout layout) internal pure returns (bytes memory) {
        bytes memory actions = abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE));
        bytes[] memory params = new bytes[](1);
        params[0] = RouterParamsCodec.encode(
            layout,
            RouterParamsCodec.SwapExactInSingle({
                poolKey: probeKey(),
                zeroForOne: true,
                // One wei of a token that does not exist, in a pool that cannot exist. Not zero, only
                // because zero would be refused by `SwapAmountCannotBeZero` one line before the
                // `PoolNotInitialized` this probe reads as its answer.
                amountIn: 1,
                amountOutMinimum: 0,
                minHopPriceX36: 0,
                hookData: abi.encode(PROBE_HOOK_DATA)
            })
        );
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        return
            abi.encodeCall(
                IUniversalRouterExecute.execute, (abi.encodePacked(COMMAND_V4_SWAP), inputs, type(uint256).max)
            );
    }

    /// @notice Asks one router whether it decodes one layout, and returns what came back with it.
    /// @return verdict `Accepted` when the router decoded the head and reached the pool,
    ///         `Rejected` when it ran off the end of the calldata (empty revert data, the documented
    ///         mismatch), `Inconclusive` for any other revert — which is a real answer, not a failure:
    ///         it means this instrument does not understand this router and must not be believed.
    /// @return returnData the raw revert data, so a caller can log the thing it decided on.
    function probe(address router, RouterParamsCodec.Layout layout)
        internal
        returns (Verdict verdict, bytes memory returnData)
    {
        if (router.code.length == 0) revert ProbeTargetHasNoCode(router);

        bool ok;
        (ok, returnData) = router.call{value: 0}(probeCalldata(layout));
        if (ok) revert ProbeDidNotRevert(router, layout);

        if (returnData.length == 0) return (Verdict.Rejected, returnData);
        if (returnData.length == 4 && bytes4(returnData) == IPoolManager.PoolNotInitialized.selector) {
            return (Verdict.Accepted, returnData);
        }
        return (Verdict.Inconclusive, returnData);
    }

    /// @notice Asks both layouts and answers only when exactly one of them was accepted.
    /// @dev Both are probed even after the first accepts. That costs one extra reverted call and buys
    ///      the thing a single probe cannot give: proof that the instrument discriminates on THIS
    ///      router rather than answering the same way to everything. A router that accepts both, or
    ///      neither, is `Unknown` — and a caller that treats `Unknown` as "send it anyway" has thrown
    ///      away the only warning it was going to get.
    function detect(address router) internal returns (RouterParamsCodec.Layout) {
        (Verdict legacy,) = probe(router, RouterParamsCodec.Layout.Legacy);
        (Verdict perHop,) = probe(router, RouterParamsCodec.Layout.PerHop);
        if (legacy == Verdict.Accepted && perHop != Verdict.Accepted) return RouterParamsCodec.Layout.Legacy;
        if (perHop == Verdict.Accepted && legacy != Verdict.Accepted) return RouterParamsCodec.Layout.PerHop;
        return RouterParamsCodec.Layout.Unknown;
    }
}

/// @title RouterProbeLens, the probe as something an operator can call
/// @notice Deploy once per chain and `eth_call` it: `detect(router)` answers 1 for the legacy layout,
///         2 for the per-hop layout, 0 for "this instrument could not tell, do not proceed".
/// @dev Not `view`, because the probe is a CALL and Solidity will not allow one in a view function —
///      see the note in `RouterProbe` on why a `staticcall` cannot answer this question. `eth_call`
///      does not care. Sending a real transaction to it is legal and pointless: both inner calls
///      revert and are caught, so it writes nothing and leaves nothing behind but a gas bill.
contract RouterProbeLens {
    /// @notice The layout `router` expects, or `Unknown`.
    function detect(address router) external returns (RouterParamsCodec.Layout) {
        return RouterProbe.detect(router);
    }

    /// @notice One layout's verdict and the raw revert data behind it, for a human reading a trace.
    function probe(address router, RouterParamsCodec.Layout layout)
        external
        returns (RouterProbe.Verdict verdict, bytes memory returnData)
    {
        return RouterProbe.probe(router, layout);
    }

    /// @notice The bytes `probe` would send. Pure, so it costs nothing to look before you ask.
    function probeCalldata(RouterParamsCodec.Layout layout) external pure returns (bytes memory) {
        return RouterProbe.probeCalldata(layout);
    }
}
