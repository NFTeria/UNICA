// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {RouterParamsCodec} from "../../src/compat/RouterParamsCodec.sol";
import {RouterProbe} from "../../src/compat/RouterProbe.sol";
import {UniswapDeployments} from "../../src/libraries/UniswapDeployments.sol";
import {UniversalRouterV2Sepolia} from "../utils/artifacts/UniversalRouterV2Sepolia.sol";
import {ForkPin} from "../fork/ForkPin.sol";
import {CompatForkBase} from "./CompatForkBase.sol";

/// @title The control: the layout UNICA ships, through the router UNICA ships against
/// @notice THIS SUITE IS BUILT AND READ FIRST. Every claim the compatibility work makes is of the form
///         "this router refuses what that router accepts", and a refusal on its own proves nothing —
///         a broken instrument refuses everything. So the first row drives the shipped five-field
///         encoding, with non-empty hook data, through the Universal Router this repository's
///         `SettlementExecutor` resolves for Ethereum Sepolia, and requires it to SETTLE: the hook is
///         called twice, the order id arrives in both callbacks, and the merchant is paid.
///
///         The second row is the mirror image on the same chain, and it is what makes the instrument
///         worth anything: the SIX-field encoding, everything else identical, must be REFUSED by this
///         same router with empty revert data. Without it, a detector that always answered "legacy"
///         would pass every row here.
///
/// @dev Read-only fork of Ethereum Sepolia, pinned through `test/fork/ForkPin.sol` so the block, the
///      endpoint and the dependency code hashes are one definition shared with the V2 fork suites.
///      Nothing is broadcast; the pool, the token and the observer exist only inside the fork.
contract SepoliaRouterControlTest is ForkPin, CompatForkBase {
    /// @dev The block is NOT pinned by default, and that is a deliberate, stated trade. These rows
    ///      initialise a POOL THAT DOES NOT EXIST on Sepolia, so every one of them reads storage slots
    ///      no earlier run has warmed — and the public endpoint answers `historical state ... is not
    ///      available` for exactly those reads at the shared pin in `ForkPin`, which is the pruning
    ///      behaviour that file already records three re-pins of. Chasing it with a fourth constant
    ///      would go stale within the hour.
    ///
    ///      What is lost: the block number these rows ran at is not fixed, so a price or a reorg on
    ///      Sepolia could in principle move a result. What is kept, and is the substantive claim: the
    ///      chain id and the RUNTIME CODE HASH of both the router and the PoolManager are asserted in
    ///      row 0, so the rows are pinned to the bytecode they are about, which is the only thing the
    ///      finding is about. An operator with an archive endpoint sets `UNICA_FORK_BLOCK` and gets the
    ///      block pin back for free.
    function setUp() public {
        uint256 pinned = vm.envOr("UNICA_FORK_BLOCK", uint256(0));
        // An endpoint that cannot be reached is a SKIP, not a failure, and the distinction is the
        // whole reason this is written as a try. `make gate` runs every suite outside `test/fork/*`,
        // so if these rows FAILED on an unreachable node the project's gate would become a status
        // page for somebody else's uptime — which the gate's own comment forbids. A skip is visible
        // in forge's output, and `make router-compat` counts it as a skip and exits NON-ZERO, so it
        // can never be read as a pass by the one runner whose job is to say whether this was proven.
        // Everything AFTER the fork succeeds is still a hard failure: a wrong chain is a broken
        // configuration, not a missing one.
        bool forked;
        if (pinned == 0) {
            try vm.createSelectFork(_forkUrl()) returns (uint256) {
                forked = true;
            } catch {}
        } else {
            try vm.createSelectFork(_forkUrl(), pinned) returns (uint256) {
                forked = true;
            } catch {}
        }
        if (!forked) {
            vm.skip(true);
            return;
        }
        require(block.chainid == PINNED_CHAIN_ID, "compat: not a fork of Ethereum Sepolia");
        _bootstrap(UniswapDeployments.universalRouter(PINNED_CHAIN_ID));
    }

    /// @notice Row 0, the instrument's own pin: the router under test is the exact build read from
    ///         Sepolia on 2026-09-04 and vendored as `test/utils/artifacts/UniversalRouterV2Sepolia`.
    ///         A redeploy at that address, or a fork of a different chain, fails here first — which is
    ///         where it should fail, rather than three rows later as a mysterious encoding result.
    function test_Control0_TheRouterIsTheListedSepoliaBuild() public view {
        assertEq(router, UniversalRouterV2Sepolia.ADDRESS, "not the listed Sepolia Universal Router");
        assertEq(router.codehash, UniversalRouterV2Sepolia.RUNTIME_KECCAK, "router runtime is not the recorded build");
        assertEq(address(manager), POOL_MANAGER, "the router names a different PoolManager than the pin records");
        assertEq(address(manager).codehash, PM_CODEHASH, "PoolManager runtime is not the recorded build");
    }

    /// @notice Row 1, THE CONTROL: the five-field encoding with non-empty hook data settles.
    function test_Control1_LegacyLayoutWithHookDataSettles() public {
        Observation memory o = _swap(RouterParamsCodec.Layout.Legacy, abi.encode(ORDER_ID));
        _assertHookDataDelivered(o, ORDER_ID);
    }

    /// @notice Row 2, the mirror, and the row that changed what this work claims. The six-field
    ///         encoding through this five-field router does NOT revert on a native-input pool. It
    ///         SUCCEEDS, pays the merchant, and DELIVERS NOTHING TO THE HOOK: the order id is silently
    ///         dropped.
    ///
    ///         The mechanism, and it is worth following because it explains both directions of this
    ///         incompatibility. The legacy decoder takes head word 8 as the offset of the dynamic
    ///         tail. In the six-field encoding that word is `minHopPriceX36`, which a single-hop
    ///         settlement sets to ZERO. Offset zero points back at the first word of the head, which
    ///         is `currency0` — and `currency0` of a native-input pool is the zero address. So the
    ///         decoder reads a length of zero, decodes empty hook data, and swaps.
    ///
    ///         This was expected to be a refusal, and it was written as one. It failed, and the
    ///         failure was right. `docs/feedback/uniswap/robinhood.md` records the OTHER direction —
    ///         the five-field call refused by a six-field router — as an empty revert, which is loud.
    ///         This direction is the quiet one: on the exact pool shape UNICA settles through, a
    ///         caller that guesses the layout wrong ships a swap that works and loses the only thing
    ///         that made it a settlement.
    ///
    ///         What saves UNICA specifically is not luck in the router: it is that the settlement hook
    ///         requires one `bytes32` of hook data (spec C1) and refuses a swap without it, so this
    ///         silent path terminates in the hook's own refusal rather than in a payment with no
    ///         receipt. An integrator whose hook data is optional gets no such backstop, and the whole
    ///         reason `RouterProbe` names a non-native currency is so that the DETECTOR cannot be
    ///         fooled the same way — row 4 shows it refusing this same layout on that key.
    function test_Control2_PerHopLayoutSilentlyDropsTheHookDataOnANativePool() public {
        Observation memory o = _swap(RouterParamsCodec.Layout.PerHop, abi.encode(ORDER_ID));

        assertEq(o.observer.beforeSwapCalls(), 1, "the swap did not happen, so nothing was dropped silently");
        assertEq(o.observer.beforeHookData().length, 0, "hook data survived, which would make this row wrong");
        assertEq(o.observer.afterHookData().length, 0, "hook data survived in afterSwap");
        assertGt(o.merchantAfter - o.merchantBefore, 0, "the merchant was not paid, so this is not the silent case");
        assertEq(
            o.callerNativeBefore - o.callerNativeAfter, AMOUNT_IN, "the caller paid something other than the input"
        );
    }

    /// @notice Row 3: the detector, run against this real bytecode, answers `Legacy`.
    function test_Control3_DetectorReturnsLegacy() public {
        assertEq(
            uint256(RouterProbe.detect(router)),
            uint256(RouterParamsCodec.Layout.Legacy),
            "the detector did not recognise the listed Sepolia router"
        );
    }

    /// @notice Row 4: each layout's probe on its own, so a wrong `detect` can be read as which half
    ///         of it was wrong, and so the `Accepted` verdict is shown to rest on `PoolNotInitialized`
    ///         rather than on a revert this instrument merely failed to understand.
    function test_Control4_ProbeVerdictsAreAcceptedAndRejected() public {
        (RouterProbe.Verdict legacy, bytes memory legacyData) =
            RouterProbe.probe(router, RouterParamsCodec.Layout.Legacy);
        (RouterProbe.Verdict perHop, bytes memory perHopData) =
            RouterProbe.probe(router, RouterParamsCodec.Layout.PerHop);

        assertEq(uint256(legacy), uint256(RouterProbe.Verdict.Accepted), "legacy probe verdict");
        assertEq(
            legacyData, abi.encodeWithSelector(IPoolManager.PoolNotInitialized.selector), "legacy probe revert data"
        );
        assertEq(uint256(perHop), uint256(RouterProbe.Verdict.Rejected), "per-hop probe verdict");
        assertEq(perHopData.length, 0, "per-hop probe revert data");
    }

    /// @notice Row 5: the probe's pool key is refused by the REAL PoolManager for two independent
    ///         reasons, which is what makes the probe unable to move anything.
    function test_Control5_TheProbeKeyCannotBeInitialised() public {
        _assertProbeKeyCannotBeInitialised();
    }
}
