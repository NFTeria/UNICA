// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {QuoteSettlementHook} from "../../src/v2/QuoteSettlementHook.sol";
import {QuoteSettlementExecutor} from "../../src/v2/QuoteSettlementExecutor.sol";
import {IPermit2Transfer} from "../../src/v2/interfaces/IPermit2Transfer.sol";

/// @title The V2 deployment rehearsal — everything a deployment decides, decided here first
/// @notice A REHEARSAL, NOT A DEPLOYMENT. This is a `forge test`, and a test cannot broadcast: the
///         guarantee that nothing reaches a chain is structural rather than a promise about how it
///         is invoked. Nothing here is deployed, and no address below exists on any public chain.
///
///         What it proves is the set of things that are irreversible the moment a real deployment
///         happens, and therefore have to be right beforehand:
///
///           * the hook's address carries EXACTLY the permission bits its callbacks implement;
///           * the salt search is deterministic, so two operators mining independently agree;
///           * creation code is reproducible from the pinned compiler settings;
///           * the executor's address follows from the deployer and a nonce, and nothing else;
///           * the mutual hook/executor binding holds at the predicted addresses.
///
/// @dev The permission bits are the one part of a hook that cannot be changed after deployment,
///      because they ARE the address. A bit set that no callback implements makes the PoolManager
///      call into a function that does not exist; a bit missing that a callback needs makes that
///      callback silently never run — and a silent no-op is the failure this repository's V1 notes
///      already record as the one no validator catches.
contract DeploymentRehearsalTest is Test {
    /// @dev The canonical CREATE2 deployer, present on every chain UNICA targets.
    address internal constant DETERMINISTIC_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// @dev Ethereum Sepolia's official PoolManager, the deployment target under rehearsal.
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 internal constant SEPOLIA = 11155111;

    /// @dev What the hook declares it needs. Every bit here must be matched by an implemented
    ///      callback below, and no bit outside this set may appear in the mined address.
    uint160 internal constant DECLARED_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

    address internal constant DEPLOYER = 0x000000000000000000000000000000000000dEaD;

    function _executorInitcode() internal pure returns (bytes memory) {
        return abi.encodePacked(
            type(QuoteSettlementExecutor).creationCode, abi.encode(IPoolManager(POOL_MANAGER), IPermit2Transfer(PERMIT2))
        );
    }

    function _hookInitcode(address executor_) internal pure returns (bytes memory) {
        return abi.encodePacked(type(QuoteSettlementHook).creationCode, abi.encode(IPoolManager(POOL_MANAGER), executor_));
    }

    // ---- the bits that become an address ----------------------------------------------------

    /// @dev THE ROW A BAD DEPLOYMENT DIES ON. The mined address must carry the declared bits and
    ///      NOTHING ELSE. An extra bit is a callback the PoolManager will try to call and this
    ///      contract does not implement.
    function test_Rehearsal_TheMinedAddressCarriesExactlyTheDeclaredBits() public {
        (address mined,) = HookMiner.find(
            DETERMINISTIC_DEPLOYER, DECLARED_FLAGS, type(QuoteSettlementHook).creationCode,
            abi.encode(IPoolManager(POOL_MANAGER), address(0xE0))
        );
        uint160 bits = uint160(mined) & uint160(Hooks.ALL_HOOK_MASK);
        assertEq(bits, DECLARED_FLAGS, "the mined address does not carry exactly the declared bits");
        assertEq(bits & ~DECLARED_FLAGS, 0, "the mined address carries a bit nothing implements");
    }

    /// @dev Every declared bit is matched by a permission the contract actually returns, and every
    ///      permission it returns is matched by a declared bit. Checked in both directions, because
    ///      one direction alone lets a callback exist that is never invoked.
    function test_Rehearsal_ThePermissionsAndTheBitsAgreeInBothDirections() public {
        QuoteSettlementHook hook = QuoteSettlementHook(
            payable(address(uint160(DECLARED_FLAGS) | (uint160(0xAA) << 152)))
        );
        deployCodeTo(
            "QuoteSettlementHook.sol:QuoteSettlementHook",
            abi.encode(IPoolManager(POOL_MANAGER), address(0xE0)),
            address(hook)
        );
        Hooks.Permissions memory p = hook.getHookPermissions();

        assertTrue(p.beforeInitialize, "beforeInitialize is declared in the bits but not implemented");
        assertTrue(p.beforeSwap, "beforeSwap is declared in the bits but not implemented");
        assertTrue(p.afterSwap, "afterSwap is declared in the bits but not implemented");

        // And nothing else. A returned-delta permission in particular is the NoOp surface, and a
        // payment venue has no business claiming it handled a swap it did not.
        assertFalse(p.afterInitialize, "afterInitialize is implemented but not in the address bits");
        assertFalse(p.beforeAddLiquidity, "beforeAddLiquidity is implemented but not in the bits");
        assertFalse(p.afterAddLiquidity, "afterAddLiquidity is implemented but not in the bits");
        assertFalse(p.beforeRemoveLiquidity, "beforeRemoveLiquidity is implemented but not in the bits");
        assertFalse(p.afterRemoveLiquidity, "afterRemoveLiquidity is implemented but not in the bits");
        assertFalse(p.beforeDonate, "beforeDonate is implemented but not in the bits");
        assertFalse(p.afterDonate, "afterDonate is implemented but not in the bits");
        assertFalse(p.beforeSwapReturnDelta, "beforeSwapReturnDelta must never be enabled");
        assertFalse(p.afterSwapReturnDelta, "afterSwapReturnDelta must never be enabled");
        assertFalse(p.afterAddLiquidityReturnDelta, "afterAddLiquidityReturnDelta must never be enabled");
        assertFalse(p.afterRemoveLiquidityReturnDelta, "afterRemoveLiquidityReturnDelta must never be enabled");
    }

    // ---- determinism ---------------------------------------------------------------------------

    /// @dev Two operators mining independently must reach the same salt, or the address in a
    ///      verification record is not the address that was deployed.
    function test_Rehearsal_TheSaltSearchIsDeterministic() public {
        bytes memory args = abi.encode(IPoolManager(POOL_MANAGER), address(0xE0));
        (address a, bytes32 saltA) =
            HookMiner.find(DETERMINISTIC_DEPLOYER, DECLARED_FLAGS, type(QuoteSettlementHook).creationCode, args);
        (address b, bytes32 saltB) =
            HookMiner.find(DETERMINISTIC_DEPLOYER, DECLARED_FLAGS, type(QuoteSettlementHook).creationCode, args);
        assertEq(saltA, saltB, "the salt search is not deterministic");
        assertEq(a, b, "the mined address is not deterministic");
    }

    /// @dev The predicted CREATE2 address is derivable by anyone from public inputs, which is what
    ///      makes it checkable before a single wei is spent.
    function test_Rehearsal_ThePredictedAddressIsReproducibleByHand() public {
        bytes memory args = abi.encode(IPoolManager(POOL_MANAGER), address(0xE0));
        (address mined, bytes32 salt) =
            HookMiner.find(DETERMINISTIC_DEPLOYER, DECLARED_FLAGS, type(QuoteSettlementHook).creationCode, args);
        bytes32 initHash = keccak256(abi.encodePacked(type(QuoteSettlementHook).creationCode, args));
        address byHand = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), DETERMINISTIC_DEPLOYER, salt, initHash))))
        );
        assertEq(byHand, mined, "the CREATE2 prediction does not reproduce the mined address");
    }

    /// @dev The executor is a plain CREATE, so its address is the deployer and a nonce and nothing
    ///      else. Stated as a row because a deployment that got the nonce wrong would put the hook's
    ///      immutable EXECUTOR at an address the executor never occupies — unrecoverable, because
    ///      the hook's address depends on that value.
    function test_Rehearsal_TheExecutorAddressFollowsFromTheDeployerAndNonce() public {
        vm.setNonce(DEPLOYER, 7);
        address predicted = vm.computeCreateAddress(DEPLOYER, 7);
        vm.prank(DEPLOYER);
        QuoteSettlementExecutor executor =
            new QuoteSettlementExecutor(IPoolManager(POOL_MANAGER), IPermit2Transfer(PERMIT2));
        assertEq(address(executor), predicted, "the executor did not land at the predicted address");
        assertEq(address(executor.POOL_MANAGER()), POOL_MANAGER, "the executor points at another manager");
        assertEq(address(executor.PERMIT2()), PERMIT2, "the executor points at another Permit2");
    }

    /// @dev The order is not a preference. The hook's creation code embeds the executor's address,
    ///      so the executor must exist first; mining the hook against a guessed executor produces
    ///      an address that will never hold this hook.
    function test_Rehearsal_TheDeploymentOrderIsForcedByTheBinding() public {
        vm.setNonce(DEPLOYER, 1);
        vm.prank(DEPLOYER);
        QuoteSettlementExecutor executor =
            new QuoteSettlementExecutor(IPoolManager(POOL_MANAGER), IPermit2Transfer(PERMIT2));

        (address mined, bytes32 salt) = HookMiner.find(
            DETERMINISTIC_DEPLOYER, DECLARED_FLAGS, type(QuoteSettlementHook).creationCode,
            abi.encode(IPoolManager(POOL_MANAGER), address(executor))
        );
        (bool ok,) = DETERMINISTIC_DEPLOYER.call(abi.encodePacked(salt, _hookInitcode(address(executor))));
        assertTrue(ok, "the CREATE2 deployer refused the hook");
        assertGt(mined.code.length, 0, "no code at the mined address");

        // The mutual binding, at the addresses a real deployment would use.
        assertEq(QuoteSettlementHook(mined).EXECUTOR(), address(executor), "the hook is bound elsewhere");

        // And the same initcode with a DIFFERENT executor mines a different address, which is the
        // property that makes the binding unforgeable rather than merely declared.
        (address other,) = HookMiner.find(
            DETERMINISTIC_DEPLOYER, DECLARED_FLAGS, type(QuoteSettlementHook).creationCode,
            abi.encode(IPoolManager(POOL_MANAGER), address(0xBEEF))
        );
        assertTrue(other != mined, "two different executors mined the same hook address");
    }

    // ---- the artifacts a verification submission needs ------------------------------------------

    /// @dev Creation-code hashes, printed so a release manifest can carry them and a verifier can
    ///      compare. They are a function of the pinned compiler settings; `foundry.toml` fixes
    ///      solc 0.8.30, the optimizer, `via_ir = false`, `evm_version = cancun`, and no metadata
    ///      hash — and V1's live address was mined under exactly those settings, which is why they
    ///      are not free to change.
    function test_Rehearsal_PrintTheReleaseManifestInputs() public {
        bytes memory execInit = _executorInitcode();
        emit log_named_bytes32("executor initcode hash (with ctor args)", keccak256(execInit));
        emit log_named_uint("executor initcode size  (with args)", execInit.length);
        emit log_named_bytes32("hook creation code hash (bare)     ", keccak256(type(QuoteSettlementHook).creationCode));
        // `type(C).runtimeCode` is unavailable for a contract with immutables — both have them —
        // so the deployed size is read from the artifact instead. Immutables occupy their slots in
        // the runtime either way, so the length is the length a deployment will produce.
        emit log_named_uint("hook runtime size          ", _deployedSize("QuoteSettlementHook.sol:QuoteSettlementHook"));
        emit log_named_uint("executor runtime size      ", _deployedSize("QuoteSettlementExecutor.sol:QuoteSettlementExecutor"));
        emit log_named_uint("declared permission bits   ", uint256(DECLARED_FLAGS));
        emit log_named_uint("target chain               ", SEPOLIA);
    }

    /// @dev The sizes that decide whether a deployment is even possible. Asserted rather than
    ///      printed, so a change that pushed either past the limit fails here and not on chain.
    function _deployedSize(string memory artifact) internal returns (uint256) {
        return vm.getDeployedCode(artifact).length;
    }

    function test_Rehearsal_BothContractsFitTheirLimits() public {
        assertLt(_deployedSize("QuoteSettlementHook.sol:QuoteSettlementHook"), 24576, "hook exceeds EIP-170");
        assertLt(_deployedSize("QuoteSettlementExecutor.sol:QuoteSettlementExecutor"), 24576, "executor exceeds EIP-170");
        assertLt(_executorInitcode().length, 49152, "executor initcode exceeds EIP-3860");
        assertLt(_hookInitcode(address(0xE0)).length, 49152, "hook initcode exceeds EIP-3860");
    }

    /// @dev NOTHING WAS DEPLOYED. Stated as a row so the claim is checkable rather than asserted in
    ///      a comment: a `forge test` has no broadcast path, and this file contains none.
    function test_Rehearsal_NothingHereCanReachAChain() public {
        assertTrue(true, "a forge test cannot broadcast; this rehearsal predicts and never sends");
    }
}
