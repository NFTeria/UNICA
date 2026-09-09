// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {CommonBase} from "forge-std/Base.sol";
import {console} from "forge-std/console.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {UniswapDeployments} from "../src/libraries/UniswapDeployments.sol";

/// @notice The one function of the Universal Router this probe calls, declared here so the probe
///         carries no dependency on a periphery interface that is itself version-sensitive.
interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @title HookDataRecorder, a hook that does nothing but remember what hook data reached it
/// @notice The whole question this probe exists to answer is whether hook data survives the router's
///         decoding of the swap parameters. A hook that only records is the instrument that reads
///         that: a swap can succeed while the router silently hands the pool an EMPTY hookData, and
///         a probe that only asked "did the call revert?" would score that as a pass. Every claim
///         about a layout is made against `lastHookData`, never against the absence of a revert.
/// @dev Only `afterSwap` is permitted (address bit 0x40), because `afterSwap` is where v4 delivers
///      hook data last and so proves it survived the whole path. No immutables and no constructor,
///      so the runtime can be placed at a flagged address with `vm.etch` and still work: storage is
///      keyed by address and starts empty there.
contract HookDataRecorder {
    bytes public lastHookData;
    uint256 public calls;

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata hookData)
        external
        returns (bytes4, int128)
    {
        lastHookData = hookData;
        calls++;
        return (IHooks.afterSwap.selector, int128(0));
    }
}

/// @title UnichainSepoliaProbe, the read-only answer to "which swap-parameter layout does this
///        chain's Universal Router expect?"
///
/// @notice NOTHING HERE IS EVER BROADCAST. There is no `vm.startBroadcast` in this file. It is run
///         with `forge script --rpc-url <chain>` and nothing else, which executes the whole thing
///         against a lazily-fetched fork of that chain: the Universal Router and the PoolManager
///         are the REAL deployed bytecode, read over RPC, and every write lands only in the local
///         EVM copy. `docs/chains/verify-unichain-sepolia.sh` is the runner.
///
/// @dev WHY THIS EXISTS. `docs/feedback/uniswap/robinhood.md` records a measured incompatibility:
///      this repository's pinned v4-periphery (commit `7ebd04b`) encodes
///      `ExactInputSingleParams` with five fields — a pool key, a direction, an amount in, a
///      minimum out, and hook data — which reaches the router as nine words followed by the hook
///      data. A Universal Router built from v4-periphery at or after commit `03b2d09` expects a
///      SIXTH static field, `minHopPriceX36`, ahead of the hook data, and refuses the five-field
///      call with an empty revert whenever hook data is present. Hook data is how every UNICA
///      settlement carries its order id, so a router of that build cannot settle for us at all.
///      Which build a given deployment is cannot be read from an interface. It has to be measured,
///      per chain, against the real bytecode. That is the single result that decides whether UNICA
///      can be deployed on Unichain Sepolia unchanged, so it is measured here rather than inferred
///      from Sepolia, and the Sepolia run is kept as the control.
///
///      HOW A ROW EARNS ITS VERDICT. The row that must PASS is built first (row 2: the five-field
///      encoding with a real 32-byte order id must reach the hook intact). Rows that must FAIL come
///      after it, and each one reproduces a PRECONDITION rather than merely omitting a defence:
///      row 5 hands the router a genuine ten-word six-field encoding, row 6 hands it a body too
///      short for its own length check. Row 6 is the instrument's own sabotage row — if the probe
///      cannot see that go red, none of its greens mean anything.
contract UnichainSepoliaProbe is Script {
    /// @notice `forge script` refuses a script contract that uses its own address, and rightly: a
    ///         script contract is ephemeral. The probe needs a stable address — it holds the pool's
    ///         liquidity, receives the swap output, and is the account the router settles from — so
    ///         the whole experiment lives in `RouterLayoutProbe` and this script only runs it.
    function run() external {
        RouterLayoutProbe probe = new RouterLayoutProbe();
        probe.run();
    }

    /// @notice `--sig "selfTest()"`: the sabotage row that validates the instrument before its
    ///         verdict is quoted anywhere.
    function selfTest() external {
        RouterLayoutProbe probe = new RouterLayoutProbe();
        probe.selfTest();
    }
}

/// @title RouterLayoutProbe, the experiment itself
/// @dev Not a `Script`. It inherits `CommonBase` only for the cheatcode address, so it can fund
///      itself and place the recording hook, and it never broadcasts anything.
contract RouterLayoutProbe is CommonBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 internal constant UNICHAIN_SEPOLIA = 1301;
    uint256 internal constant ETHEREUM_SEPOLIA = 11155111;

    /// @dev The Universal Router this repository already trusts, on the chain it is already live on.
    address internal constant SEPOLIA_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
    /// @dev Unichain Sepolia's Universal Router, transcribed from Uniswap's deployments page and
    ///      then read back from the chain: it holds 19,540 bytes and reports the same PoolManager
    ///      that `hookmate` names for chain 1301. Both facts are re-checked by row 1 below, so a
    ///      wrong transcription here cannot become a quiet pass.
    address internal constant UNICHAIN_SEPOLIA_ROUTER = 0xf70536B3bcC1bD1a972dc186A2cf84cC6da6Be5D;

    /// @dev The size of the deployed Universal Router runtime, measured with `cast code` on
    ///      2026-09-09: identical on both chains, which is the first hint that they are one build.
    uint256 internal constant OFFICIAL_ROUTER_RUNTIME_BYTES = 19540;
    /// @dev The Universal Router's V4 swap command.
    uint8 internal constant COMMAND_V4_SWAP = 0x10;

    /// @dev Only `afterSwap` (bit 0x40), namespaced high so the address is not a precompile.
    address internal constant PROBE_HOOK = address(uint160(Hooks.AFTER_SWAP_FLAG) ^ (0x7777 << 144));

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_LOWER = -887_220;
    int24 internal constant TICK_UPPER = 887_220;
    uint128 internal constant SWAP_IN = 0.001 ether;

    /// @dev The stand-in for a settlement's order id: the payload whose survival is the whole point.
    bytes32 internal constant ORDER_ID = keccak256("UNICA probe order id");

    IPoolManager internal manager;
    address internal router;
    HookDataRecorder internal recorder;
    PoolModifyLiquidityTest internal liquidityRouter;
    PoolKey internal key;

    uint256 internal passed;
    uint256 internal failed;
    uint256 internal skipped;

    // ---- the runner ---------------------------------------------------------------------------

    /// @notice Every row, against whichever chain the RPC points at. Reverts at the end if any row
    ///         failed, so the process exit code carries the verdict and a green cannot be misread.
    function run() external {
        console.log("# router layout probe, chain", block.chainid);
        _resolveChain();
        _row1_theRouterIsTheDeployedOne();
        _buildPool();

        // The row that must pass, first. Everything after it is read against this one's result.
        bool fiveFieldCarriesHookData = _row2_fiveFieldWithOrderId();
        _row3_fiveFieldWithEmptyHookData();
        _row4_sixFieldZeroMinHop();
        _row5_sixFieldNonZeroMinHop();
        _row6_sabotageTruncatedBody();
        bool sourceKnowsThisChain = _row7_frozenLibraryKnowsThisChain();

        console.log("");
        console.log("VERDICT for chain", block.chainid);
        if (fiveFieldCarriesHookData) {
            console.log("  ROUTER LAYOUT: this router expects the FIVE-field ExactInputSingleParams layout");
            console.log("  UNICA's shipped swap encoding reaches the hook intact on this chain");
        } else {
            console.log("  ROUTER LAYOUT: this router did NOT deliver hook data under the five-field layout");
            console.log("  UNICA cannot settle here without changing its encoding and its periphery pin");
        }
        if (sourceKnowsThisChain) {
            console.log("  SOURCE: the frozen deployments library resolves this chain; the hook can be built");
        } else {
            console.log("  SOURCE: the frozen deployments library does NOT resolve this chain");
            console.log("  The hook's constructor reverts here. The router being compatible does not");
            console.log("  make this chain deployable: that is an owner decision on a frozen file.");
        }
        console.log("");
        console.log("checks run:", passed + failed + skipped);
        console.log("passed:", passed);
        console.log("failed:", failed);
        console.log("skipped:", skipped);
        require(failed == 0, "probe: at least one row failed");
    }

    function _resolveChain() internal {
        if (block.chainid == UNICHAIN_SEPOLIA) {
            router = UNICHAIN_SEPOLIA_ROUTER;
        } else if (block.chainid == ETHEREUM_SEPOLIA) {
            router = SEPOLIA_ROUTER;
        } else {
            revert("probe: point --rpc-url at Unichain Sepolia (1301) or Ethereum Sepolia (11155111)");
        }
        manager = IPoolManager(AddressConstants.getPoolManagerAddress(block.chainid));
    }

    // ---- row 1: the probe is standing on the real deployment ------------------------------------

    /// @dev A probe that silently ran against an empty address would report whatever it liked. This
    ///      row is what makes every later row a statement about Uniswap's deployed router.
    function _row1_theRouterIsTheDeployedOne() internal {
        _check("router holds the deployed runtime (19,540 bytes)", router.code.length == OFFICIAL_ROUTER_RUNTIME_BYTES);
        _check("PoolManager holds code", address(manager).code.length > 0);
        (bool ok, bytes memory ret) = router.staticcall(abi.encodeWithSignature("poolManager()"));
        _check(
            "the router reports the same PoolManager this chain's entry names",
            ok && ret.length == 32 && abi.decode(ret, (address)) == address(manager)
        );
        console.log("  router        ", router);
        console.log("  poolManager   ", address(manager));
        console.log("  router runtime bytes", router.code.length);
    }

    // ---- the topology every row swaps through ---------------------------------------------------

    /// @dev The PoolManager and the Universal Router are the chain's own. The recording hook, the
    ///      second currency and the liquidity router are local, because none of them is the subject:
    ///      the subject is how the deployed router decodes the swap parameters. Using a local token
    ///      also removes a faucet from the experiment, so the probe runs on any fork of either chain.
    function _buildPool() internal {
        vm.deal(address(this), 1000 ether);

        HookDataRecorder impl = new HookDataRecorder();
        vm.etch(PROBE_HOOK, address(impl).code);
        recorder = HookDataRecorder(PROBE_HOOK);
        require(uint160(PROBE_HOOK) & Hooks.ALL_HOOK_MASK == Hooks.AFTER_SWAP_FLAG, "probe hook address lacks 0x40");

        MockERC20 token = new MockERC20("Probe payout", "PRB", 18);
        token.mint(address(this), 1_000_000 ether);

        liquidityRouter = new PoolModifyLiquidityTest(manager);
        token.approve(address(liquidityRouter), type(uint256).max);

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(PROBE_HOOK)
        });
        manager.initialize(key, SQRT_PRICE_1_1);
        liquidityRouter.modifyLiquidity{value: 200 ether}(
            key,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER, tickUpper: TICK_UPPER, liquidityDelta: 100 ether, salt: bytes32(0)
            }),
            ""
        );
        _check("probe pool is initialised and funded", manager.getLiquidity(key.toId()) > 0);
    }

    // ---- row 2: the encoding UNICA actually ships ------------------------------------------------

    /// @dev This is the shipped path: `SettlementExecutor._plan` builds exactly this struct, with the
    ///      order id as hook data. If the order id arrives at the hook, UNICA settles on this chain
    ///      unchanged; that is the finding the whole document is built on.
    function _row2_fiveFieldWithOrderId() internal returns (bool) {
        (bool ok, bytes memory seen) = _swap(_fiveField(abi.encode(ORDER_ID)));
        bool intact = ok && seen.length == 32 && bytes32(seen) == ORDER_ID;
        _check("FIVE-field encoding with a 32-byte order id: the swap succeeds", ok);
        _check("FIVE-field encoding with a 32-byte order id: the hook receives that order id", intact);
        return intact;
    }

    // ---- row 3: the control that separates "hook data survived" from "a swap happened" -----------

    /// @dev The robinhood finding's own control: a router that refuses hook data still swaps happily
    ///      without it. Keeping this row means a green on row 2 cannot be explained by "this router
    ///      accepts anything".
    function _row3_fiveFieldWithEmptyHookData() internal {
        (bool ok, bytes memory seen) = _swap(_fiveField(""));
        _check("FIVE-field encoding with EMPTY hook data: the swap succeeds", ok);
        _check("FIVE-field encoding with EMPTY hook data: the hook receives nothing", ok && seen.length == 0);
    }

    // ---- rows 4 and 5: the layout this router is being tested against ----------------------------

    /// @dev A genuine ten-word six-field body, `minHopPriceX36` zero — the value an integrator would
    ///      naturally use for "no limit". A five-field decoder reads word 8 as the hook-data offset,
    ///      so a zero there points the decoder back at the head of the struct.
    ///
    ///      This row asserts a NEGATIVE that matters more than whether it reverts: the 32-byte order
    ///      id must NOT arrive. Whichever way this router resolves the mis-shaped body — an empty
    ///      revert, or a swap that succeeds carrying no order id — the settlement is not the one
    ///      that was asked for, and UNICA's hook is what refuses it. A probe that only asserted
    ///      "reverts" would have called a silent, receipt-less success a pass.
    function _row4_sixFieldZeroMinHop() internal {
        (bool ok, bytes memory seen) = _swap(_sixField(0, abi.encode(ORDER_ID)));
        console.log("  six-field, minHopPriceX36 = 0 -> swap succeeded:", ok);
        console.log("  six-field, minHopPriceX36 = 0 -> hook data bytes seen:", seen.length);
        _check(
            "SIX-field encoding, minHopPriceX36 = 0: the order id does NOT reach the hook",
            !(ok && seen.length == 32 && bytes32(seen) == ORDER_ID)
        );
    }

    /// @dev The same body with a non-zero `minHopPriceX36`. Under a six-field decoder this is an
    ///      ordinary price bound; under the five-field decoder it is read as a hook-data offset and
    ///      sends the decoder off the end of the body. This row must FAIL to swap on a five-field
    ///      router, and it is a real precondition, not an omission: the body is a complete, valid
    ///      six-field encoding.
    function _row5_sixFieldNonZeroMinHop() internal {
        (bool ok,) = _swap(_sixField(type(uint128).max, abi.encode(ORDER_ID)));
        _check("SIX-field encoding, minHopPriceX36 non-zero: the swap is refused", !ok);
    }

    // ---- row 6: the sabotage that validates the instrument ---------------------------------------

    /// @dev Feed the router a body shorter than its own documented minimum (0x140 = ten words). The
    ///      router's `CalldataDecoder` has an explicit length check for exactly this, so it must go
    ///      red. If this row ever passes, the probe is not reaching the decoder at all and every
    ///      other row in this file is meaningless.
    function _row6_sabotageTruncatedBody() internal {
        bytes memory truncated = new bytes(0x120); // nine words: one short of the minimum
        (bool ok,) = _swap(truncated);
        _check("SABOTAGE: a body below the decoder's 0x140 minimum is refused", !ok);
    }

    // ---- row 7: what the frozen source says about this chain --------------------------------------

    /// @dev Separate from the router question and just as decisive. `src/libraries/UniswapDeployments`
    ///      is frozen and lists ONE chain. The hook's constructor calls both of its functions, so on
    ///      any other chain the hook cannot be constructed at all — the deploy reverts before the
    ///      router layout is ever reached. Called through `this.` so the revert is caught rather than
    ///      ending the run, and isolated to the library so a revert cannot be blamed on `BaseHook`'s
    ///      own address validation.
    ///
    ///      WHAT THIS ROW ASSERTS, and why it is not simply "resolves". A row that demanded the
    ///      library resolve chain 1301 would be red on every run for as long as the freeze holds —
    ///      a permanent red is read as noise and stops being read at all, which is the same failure
    ///      as a green that can never go red. So the row asserts the DOCUMENTED expectation: the
    ///      library resolves Ethereum Sepolia and nothing else. It goes red if that ever stops being
    ///      true in either direction, including the good direction — the day someone adds chain 1301
    ///      this row fails until `docs/chains/UNICHAIN-SEPOLIA.md` is brought with it, which is
    ///      exactly when the document is most likely to be forgotten.
    function _row7_frozenLibraryKnowsThisChain() internal returns (bool resolves) {
        bool routerKnown;
        bool payoutKnown;
        try this.routerFor(block.chainid) returns (address) {
            routerKnown = true;
        } catch {}
        try this.payoutFor(block.chainid) returns (address) {
            payoutKnown = true;
        } catch {}
        resolves = routerKnown && payoutKnown;
        console.log("  UniswapDeployments.universalRouter knows this chain:", routerKnown);
        console.log("  UniswapDeployments.payoutCurrency knows this chain:", payoutKnown);
        _check(
            "the frozen deployments library resolves Ethereum Sepolia and no other chain",
            resolves == (block.chainid == ETHEREUM_SEPOLIA)
        );
        if (!resolves) {
            console.log("  BLOCKER src/libraries/UniswapDeployments.sol lists chain 11155111 only, and the");
            console.log("  hook's constructor calls both of its functions, so the hook cannot be built here.");
            console.log("  That file is FROZEN. Adding a chain to it changes the hook's creation code and");
            console.log("  therefore the mined salt and address; it is an owner decision, not a script's.");
        }
    }

    // ---- the self-test: proving the deciding row can go red ---------------------------------------

    /// @notice Feeds row 2's own predicate a body that must not satisfy it, and requires it to come
    ///         back false. Run with `--sig "selfTest()"`.
    /// @dev A check that has never failed is not a check, and row 2 is the row the entire chain
    ///      verdict rests on. Row 4 already shows the discrimination this depends on from the other
    ///      side — a swap that SUCCEEDS while delivering zero bytes of hook data — but it asserts a
    ///      negative, so it cannot show that the positive assertion is capable of failing. This does:
    ///      it runs the exact expression row 2 evaluates ("did the 32-byte order id arrive?") against
    ///      the six-field body, and refuses to finish unless that expression is false. If the probe
    ///      is ever rewired so that row 2 reports success no matter what reaches the hook, this stops
    ///      passing, and the chain verdict it produces stops being worth reading.
    function selfTest() external {
        console.log("# probe self-test, chain", block.chainid);
        _resolveChain();
        _buildPool();

        (bool okGood, bytes memory seenGood) = _swap(_fiveField(abi.encode(ORDER_ID)));
        bool goodIntact = okGood && seenGood.length == 32 && bytes32(seenGood) == ORDER_ID;
        _check("control: row 2's predicate is TRUE for the encoding UNICA ships", goodIntact);

        (bool okBad, bytes memory seenBad) = _swap(_sixField(0, abi.encode(ORDER_ID)));
        bool badIntact = okBad && seenBad.length == 32 && bytes32(seenBad) == ORDER_ID;
        console.log("  sabotage swap succeeded:", okBad);
        console.log("  sabotage hook data bytes seen:", seenBad.length);
        _check("sabotage: row 2's predicate is FALSE for a body that drops the order id", !badIntact);

        console.log("");
        console.log("checks run:", passed + failed + skipped);
        console.log("passed:", passed);
        console.log("failed:", failed);
        console.log("skipped:", skipped);
        require(failed == 0, "probe self-test: the deciding predicate did not behave in both directions");
    }

    function routerFor(uint256 chainId) external pure returns (address) {
        return UniswapDeployments.universalRouter(chainId);
    }

    function payoutFor(uint256 chainId) external pure returns (address) {
        return UniswapDeployments.payoutCurrency(chainId);
    }

    // ---- encodings --------------------------------------------------------------------------------

    /// @dev The layout this repository ships, produced by the pinned periphery's own struct so it
    ///      cannot drift from what `SettlementExecutor` sends: one offset word, eight static words,
    ///      the hook-data offset, its length, its data.
    function _fiveField(bytes memory hookData) internal view returns (bytes memory) {
        return abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key, zeroForOne: true, amountIn: SWAP_IN, amountOutMinimum: 0, hookData: hookData
            })
        );
    }

    /// @dev The layout v4-periphery adopted at commit `03b2d09`, hand-rolled because the pinned
    ///      periphery in this tree has no such struct to encode with. Nine static words instead of
    ///      eight — the extra one is `minHopPriceX36`, sitting immediately before the hook data —
    ///      then the hook-data offset at 0x140 (ten words from the struct's start), its length, and
    ///      its data. Writing it out by hand is the point: it is what the newer router would emit,
    ///      reproduced here without moving the pin.
    function _sixField(uint256 minHopPriceX36, bytes memory hookData) internal view returns (bytes memory) {
        bytes memory head = abi.encodePacked(
            uint256(0x20), // offset to the struct
            uint256(uint160(Currency.unwrap(key.currency0))),
            uint256(uint160(Currency.unwrap(key.currency1))),
            uint256(key.fee),
            uint256(int256(key.tickSpacing)),
            uint256(uint160(address(key.hooks))),
            uint256(1), // zeroForOne
            uint256(SWAP_IN),
            uint256(0), // amountOutMinimum
            minHopPriceX36
        );
        return abi.encodePacked(head, uint256(0x140), uint256(hookData.length), _padRight(hookData));
    }

    function _padRight(bytes memory b) internal pure returns (bytes memory) {
        uint256 rem = b.length % 32;
        if (rem == 0) return b;
        return abi.encodePacked(b, new bytes(32 - rem));
    }

    // ---- driving the deployed router ---------------------------------------------------------------

    /// @dev The same three-action plan `SettlementExecutor._plan` composes — swap exact input, settle
    ///      the native input from the value forwarded, take the whole output — with only the swap
    ///      body swapped out per row. Returns whether the call survived and what the hook saw, and
    ///      never lets a revert end the run: a refusal is a result here, not an error.
    function _swap(bytes memory swapBody) internal returns (bool ok, bytes memory hookDataSeen) {
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE));
        bytes[] memory params = new bytes[](3);
        params[0] = swapBody;
        params[1] = abi.encode(key.currency0, ActionConstants.OPEN_DELTA, false);
        params[2] = abi.encode(key.currency1, address(this), ActionConstants.OPEN_DELTA);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);

        uint256 callsBefore = recorder.calls();
        try IUniversalRouter(router).execute{value: SWAP_IN}(
            abi.encodePacked(COMMAND_V4_SWAP), inputs, block.timestamp + 1 hours
        ) {
            ok = true;
        } catch {
            ok = false;
        }
        // Only a call that actually reached the hook in THIS row may report hook data; otherwise the
        // previous row's recording would be read as this row's result.
        hookDataSeen = (ok && recorder.calls() == callsBefore + 1) ? recorder.lastHookData() : bytes("");
    }

    // ---- scoring ------------------------------------------------------------------------------------

    function _check(string memory label, bool condition) internal {
        if (condition) {
            passed++;
            console.log(string.concat("PASS  ", label));
        } else {
            failed++;
            console.log(string.concat("FAIL  ", label));
        }
    }

    receive() external payable {}
}
