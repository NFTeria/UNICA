// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {RouterParamsCodec} from "../../src/compat/RouterParamsCodec.sol";
import {RouterProbe} from "../../src/compat/RouterProbe.sol";
import {UniversalRouterV2Sepolia} from "../utils/artifacts/UniversalRouterV2Sepolia.sol";
import {CompatForkBase} from "./CompatForkBase.sol";
import {ObserverHook} from "./util/ObserverHook.sol";

/// @title The subject: a Universal Router built from a v4-periphery that has `minHopPriceX36`
/// @notice Robinhood testnet is under compatibility investigation. Nothing in this file claims
///         support, deployment, or an official stack on chain 46630, and nothing here is broadcast.
///
///         These rows are the other half of the control in `SepoliaRouterControl.t.sol`, run against
///         the router observed at the address `FEEDBACK.md` records for that chain. The claim they
///         make together is a difference, not an absolute: the SAME instrument, the SAME pool shape,
///         the SAME order id, encoded two ways, against two real routers, and the two chains answer
///         in opposite directions.
///
///         WHERE THE ENDPOINT COMES FROM, because that question decides whether any of this is worth
///         reading. NO endpoint for chain 46630 is recorded in `docs/feedback/uniswap/robinhood.md`,
///         in `FEEDBACK.md`, or in `.env.example`: the 2026-09-05 finding those files carry was made
///         against an endpoint nobody wrote down. So this suite resolves one in a stated order, and
///         nothing in that order was guessed:
///
///         1. `ROBINHOOD_RPC_URL`, because an operator who names an endpoint means it.
///         2. The `robinhood` alias in `foundry.toml`'s `[rpc_endpoints]`. As this was written that
///            alias does NOT resolve — it is written `${ROBINHOOD_RPC_URL:-<url>}` and Foundry has no
///            `:-` default in its interpolation, so it looks up a variable whose whole name includes
///            the URL and reports "environment variable not found". The step is kept because it is
///            the right place for the endpoint to live once the entry is written `${VAR}`, and
///            because its failure costs nothing: it falls through.
///         3. `PUBLIC_46630` below, a keyless public endpoint, VERIFIED before it was written down
///            rather than copied. On 2026-09-09 it answered chain id 46630, and the router address
///            below held 24,546 bytes hashing to `0xfdd908…4082f` — the same size and hash
///            `FEEDBACK.md` recorded on 2026-09-05 through a different endpoint. Those readings were
///            made with `cast` in the session that wrote this file. It carries no key, so recording
///            it commits no secret, which is the same reasoning `ForkPin` applies to its public
///            Sepolia node.
///
///         When the resolved endpoint cannot be reached, these rows SKIP, the runner prints them as
///         skipped and exits non-zero, and no claim is made about this chain by anything that ran.
///
/// @dev The PoolManager is not hardcoded: it is read from the router (`CompatForkBase._bootstrap`),
///      so a wrong endpoint fails as "the router names a PoolManager with no code" rather than as a
///      confusing encoding result.
contract UpgradedRouterCompatTest is CompatForkBase {
    uint256 internal constant CHAIN_ID = 46630;

    /// @dev Recorded in `FEEDBACK.md`, entry of 2026-09-05. This file did not read it from the chain
    ///      itself; the rows below re-read it on whatever fork an operator supplies, which is the
    ///      point of them.
    address internal constant OBSERVED_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;

    /// @notice The endpoint variable this suite prefers, named in the skip line so a reader of CI
    ///         output knows exactly what is missing.
    string internal constant RPC_ENV = "ROBINHOOD_RPC_URL";
    /// @notice The `foundry.toml` alias this suite tries second, so that the endpoint can be named
    ///         ONCE in this repository as soon as that entry is written in a form Foundry resolves.
    string internal constant RPC_ALIAS = "robinhood";
    /// @notice A keyless public endpoint for chain 46630, verified in the header note above. Recorded
    ///         rather than hidden, precisely because it carries no secret.
    string internal constant PUBLIC_46630 = "https://rpc.testnet.chain.robinhood.com";

    /// @dev The router's runtime, size and hash, READ FROM THE CHAIN on 2026-09-09 with
    ///      `cast code ... | cast keccak` at block 116010822. Pinned here for the same reason the
    ///      Sepolia control pins its own: every row below is about THIS bytecode, and a redeploy at
    ///      that address must fail loudly here rather than quietly change what the rows mean.
    uint256 internal constant ROUTER_CODE_SIZE = 24546;
    bytes32 internal constant ROUTER_CODEHASH = 0xfdd90802f39ce5fc8bac4c2f1b3ac7bac530fd17ff46b0630f1bd00f1e14082f;
    /// @dev The PoolManager that router names, read the same way on the same day.
    address internal constant OBSERVED_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    function setUp() public {
        string memory url = _endpoint();
        if (bytes(url).length == 0) {
            // Printed by the runner as a SKIP, and the runner exits non-zero for it. A skipped row is
            // never folded into a pass here or anywhere else in this repository.
            vm.skip(true);
            return;
        }
        // Unreachable is a SKIP, not a failure — see the same note in `SepoliaRouterControl`: `make
        // gate` runs every suite outside `test/fork/*`, and a gate that fails on somebody else's
        // downtime is a status page. `make router-compat` counts the skip and exits non-zero, so
        // nothing reads it as a pass. A wrong CHAIN is still a hard failure: that is misconfiguration.
        try vm.createSelectFork(url) returns (uint256) {}
        catch {
            vm.skip(true);
            return;
        }
        require(block.chainid == CHAIN_ID, "compat: the configured endpoint is not chain 46630");
        _bootstrap(OBSERVED_ROUTER);
    }

    /// @dev The environment variable wins, because an operator who names an endpoint means it. The
    ///      `foundry.toml` alias is the fallback, and its absence is not an error — it is a skip.
    function _endpoint() internal view returns (string memory) {
        string memory fromEnv = vm.envOr(RPC_ENV, string(""));
        if (bytes(fromEnv).length > 0) return fromEnv;
        try vm.rpcUrl(RPC_ALIAS) returns (string memory fromAlias) {
            if (bytes(fromAlias).length > 0) return fromAlias;
        } catch {}
        return PUBLIC_46630;
    }

    /// @notice Row 0: the router here is the exact build this file was written against, and it is a
    ///         DIFFERENT build from the control's.
    /// @dev Both halves matter. The hash pins every row below to one bytecode. The inequality is the
    ///      one that keeps the whole comparison honest: if this address ever holds the Sepolia build,
    ///      the two suites are measuring one router, every difference between them is noise, and this
    ///      row should go red before anything else has a chance to look meaningful.
    function test_Upgraded0_ADifferentRouterBuildIsPresent() public view {
        assertEq(router, OBSERVED_ROUTER, "not the recorded router address");
        assertEq(router.code.length, ROUTER_CODE_SIZE, "router runtime size is not the recorded reading");
        assertEq(router.codehash, ROUTER_CODEHASH, "router runtime is not the recorded build");
        assertTrue(
            router.codehash != UniversalRouterV2Sepolia.RUNTIME_KECCAK,
            "this router is the Sepolia build, so there is nothing here to compare against"
        );
        assertEq(address(manager), OBSERVED_POOL_MANAGER, "the router names a different PoolManager than recorded");
        assertTrue(address(manager).code.length > 0, "the router names a PoolManager with no code");
    }

    /// @notice Row 1: the encoding UNICA ships — five fields, one `bytes32` order id — is REFUSED by
    ///         this router, with empty revert data, before the pool is reached. The hook never runs and
    ///         nothing moves.
    function test_Upgraded1_LegacyLayoutWithHookDataIsRefusedWithAnEmptyRevert() public {
        (, bytes memory returnData) = _refusedSwap(RouterParamsCodec.Layout.Legacy, abi.encode(ORDER_ID));
        assertEq(returnData.length, 0, "the refusal carried revert data, so it is not the layout refusal");
    }

    /// @notice Row 2: the same order id, the same pool, the same plan, encoded with `minHopPriceX36`
    ///         ahead of the hook data, SETTLES — and the hook receives the order id in both callbacks.
    ///         This is the row that turns the documented incompatibility into a solved one.
    function test_Upgraded2_PerHopLayoutSettlesAndDeliversTheHookData() public {
        Observation memory o = _swap(RouterParamsCodec.Layout.PerHop, abi.encode(ORDER_ID));
        _assertHookDataDelivered(o, ORDER_ID);
    }

    /// @notice Row 3: the detector, against this real bytecode, answers `PerHop` — the opposite of
    ///         what it answers against the control, from the same code, with no chain-specific input.
    function test_Upgraded3_DetectorReturnsPerHop() public {
        assertEq(
            uint256(RouterProbe.detect(router)),
            uint256(RouterParamsCodec.Layout.PerHop),
            "the detector did not recognise the upgraded router"
        );
    }

    /// @notice Row 4: the documented curiosity, reproduced. The five-field call this router refuses
    ///         with a `bytes32` of hook data is ACCEPTED when the hook data is empty — because the
    ///         misread offset lands on a zero word and the decoder reads a zero-length tail. It is the
    ///         same mechanism as the control's row 2, in the other direction, and it is why "it works
    ///         with empty hook data" is not evidence that a router is compatible.
    function test_Upgraded4_LegacyLayoutWithEmptyHookDataIsAccepted() public {
        Observation memory o = _swap(RouterParamsCodec.Layout.Legacy, "");
        assertEq(o.observer.beforeSwapCalls(), 1, "the swap did not happen");
        assertEq(o.observer.beforeHookData().length, 0, "hook data appeared from nowhere");
        assertGt(o.merchantAfter - o.merchantBefore, 0, "the merchant was not paid");
    }

    /// @notice Row 5: the probe's pool key cannot be initialised on this chain either, for the same
    ///         two independent reasons. The probe is side-effect-free here, not only on the control.
    function test_Upgraded5_TheProbeKeyCannotBeInitialised() public {
        _assertProbeKeyCannotBeInitialised();
    }
}
