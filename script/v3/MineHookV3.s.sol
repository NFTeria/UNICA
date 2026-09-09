// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {RouterParamsCodec} from "../../src/compat/RouterParamsCodec.sol";
import {UnicaDeploymentsV3} from "../../src/v3/UnicaDeploymentsV3.sol";
import {UnicaHookV3} from "../../src/v3/UnicaHookV3.sol";
import {UnicaExecutorV3} from "../../src/v3/UnicaExecutorV3.sol";

/// @title MineHookV3, the V3 hook address for all five chains, derived three ways before it is shown
///
/// @notice A v4 hook's permissions ARE its address: the PoolManager reads the bottom fourteen bits and
///         calls only the callbacks it finds there. So deploying `UnicaHookV3` anywhere begins by
///         proving which address its creation code lands on through the canonical CREATE2 factory,
///         and that the address carries exactly the declared bits. This script does that, prints the
///         init-code hash beside the salt and the address, resolves every one of the five chains from
///         `UnicaDeploymentsV3`, and reports what is vacant. **It broadcasts nothing.** There is no
///         `vm.startBroadcast` in this file and no private key is read.
///
///         THE ANSWER IS ONE ADDRESS, NOT FIVE, AND THAT IS THE POINT. A CREATE2 address is
///         `keccak(0xff, factory, salt, keccak(initCode))`. No chain id enters that formula, and the
///         factory is the same 69-byte contract with the same code hash on all five chains. The hook
///         takes NO constructor argument — everything it needs it resolves from `block.chainid` at
///         construction — so its creation code is identical for every chain, and one salt puts it at
///         one address everywhere. That is what makes a UNICA generation a single checkable object
///         rather than five loosely related deployments.
///
///         WHAT DOES FORCE A RE-MINE is a change to the creation code, and the hook's creation code
///         embeds `UnicaDeploymentsV3` — every address in it, every router code hash, every layout —
///         and, through `_computeExecutor`, the whole of `UnicaExecutorV3`'s creation code too. Add a
///         chain, correct a code hash after a router upgrade, change one comment that changes the
///         metadata: the init-code hash moves, the salt moves, the address moves. That is why the
///         init-code hash is printed on the same screen as the address. **The hash is the thing to
///         compare across a change; the address is only its shadow.**
///
/// @dev Two ways to run it, both read-only:
///
///        forge script script/v3/MineHookV3.s.sol --sig "run()"
///        forge script script/v3/MineHookV3.s.sol --sig "runLive()"
///
///      `run()` needs no network: it is arithmetic over compiled bytes plus the table. `runLive()`
///      additionally forks each of the five chains through its `foundry.toml` alias and checks the
///      table against the chain — the router's runtime code hash, the PoolManager the router itself
///      names, the payout token's own answers — and whether the mined addresses are still vacant. A
///      chain it cannot reach is a printed SKIP and is never folded into a pass.
contract MineHookV3 is Script {
    /// @dev The deterministic-deployment proxy. Written out here rather than inherited so the address
    ///      a reader is asked to trust is in the file that uses it; `_mineAndAgree` asserts it against
    ///      forge-std's own constant AND against the deployments library's, so all three cannot drift.
    address internal constant DETERMINISTIC_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// @dev The declared permission set: beforeInitialize | beforeSwap | afterSwap.
    uint160 internal constant FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    /// @dev Uniswap reserves the top address byte 0x91 as a routing signal; a mined address that hits
    ///      it is skipped rather than used.
    uint8 internal constant RESERVED_PREFIX = 0x91;
    /// @dev The executor is deployed at salt zero, bound to the hook by constructor argument.
    bytes32 internal constant EXECUTOR_SALT = bytes32(0);
    /// @dev How far a search runs before giving up rather than looping forever. Exceeding it is a
    ///      hard revert, never a shrug: a script that quietly reports "no salt" has told you nothing.
    uint256 internal constant MAX_SALT = 200_000;

    /// @notice Everything the two derivations must agree on before a single line is printed.
    struct Mined {
        bytes32 initCodeHash;
        bytes32 salt;
        address hook;
        address executor;
        bytes32 executorInitCodeHash;
        uint256 saltsTried;
    }

    uint256 internal checksRun;
    uint256 internal checksPassed;
    uint256 internal checksFailed;
    uint256 internal checksSkipped;

    // ---- entry points ----------------------------------------------------------------------------

    /// @notice Mine, cross-derive, and print the generation: one address, five chains, no network.
    function run() external {
        Mined memory m = _mineAndAgree();
        _printMined(m);
        _printChainTable(m, false);
        _summary();
    }

    /// @notice The same, then read each of the five chains and check the table against it.
    function runLive() external {
        Mined memory m = _mineAndAgree();
        _printMined(m);
        _printChainTable(m, true);
        _summary();
    }

    // ---- the derivation, done twice, agreed before anything is printed ----------------------------

    /// @dev Two INDEPENDENT searches over the same rule, then a third independent address function on
    ///      the winner. They must all agree or nothing is printed at all.
    ///
    ///      1. `_mineByHand` implements `keccak(0xff, factory, salt, initCodeHash)` in Solidity, in
    ///         this file, from the CREATE2 rule as written in the yellow paper.
    ///      2. `_mineByCheatcode` runs the same search using `vm.computeCreate2Address`, which is
    ///         Foundry's own implementation in Rust. Different language, different codebase, written
    ///         by different people: a bug would have to exist identically in both to survive.
    ///      3. `HookMiner.computeAddress`, Uniswap's own, checks the winning salt a third time.
    ///
    ///      Agreement is required on the SALT as well as the address, because two searches that
    ///      disagree on the salt but agree on the address would mean the search rule differs even
    ///      though the arithmetic does not — a subtler bug and a worse one.
    function _mineAndAgree() internal view returns (Mined memory m) {
        require(DETERMINISTIC_FACTORY == CREATE2_FACTORY, "the factory address here is not forge-std's");
        require(
            DETERMINISTIC_FACTORY == UnicaDeploymentsV3.CREATE2_FACTORY,
            "the factory address here is not the deployments library's"
        );

        bytes memory creationCode = type(UnicaHookV3).creationCode;
        m.initCodeHash = keccak256(creationCode);

        (address byHand, bytes32 saltByHand, uint256 tried) = _mineByHand(m.initCodeHash);
        (address byCheatcode, bytes32 saltByCheatcode) = _mineByCheatcode(m.initCodeHash);

        require(byHand == byCheatcode, "the two derivations disagree on the hook address");
        require(saltByHand == saltByCheatcode, "the two derivations disagree on the salt");
        require(
            HookMiner.computeAddress(DETERMINISTIC_FACTORY, uint256(saltByHand), creationCode) == byHand,
            "HookMiner disagrees with both derivations"
        );

        // The permission set has to be IN the address, or v4 will never call the hook it was told to.
        // A hook whose bits are wrong does not fail: it is silently not called, which is the failure
        // shape this repository treats as the most dangerous one.
        require(uint160(byHand) & Hooks.ALL_HOOK_MASK == FLAGS, "mined address does not carry the declared flags");
        require(uint8(uint160(byHand) >> 152) != RESERVED_PREFIX, "mined address uses the reserved prefix");

        m.salt = saltByHand;
        m.hook = byHand;
        m.saltsTried = tried;

        // The executor's address, from its creation code plus the hook as its one argument, derived
        // twice as well: by hand here, and by the hook contract itself in `_computeExecutor` — which
        // is checked against this in `test/v3/MineHookV3.t.sol` rather than by deploying here.
        m.executorInitCodeHash = keccak256(abi.encodePacked(type(UnicaExecutorV3).creationCode, abi.encode(byHand)));
        address executorByHand = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), DETERMINISTIC_FACTORY, EXECUTOR_SALT, m.executorInitCodeHash)
                    )
                )
            )
        );
        address executorByCheatcode =
            vm.computeCreate2Address(EXECUTOR_SALT, m.executorInitCodeHash, DETERMINISTIC_FACTORY);
        require(executorByHand == executorByCheatcode, "the two derivations disagree on the executor address");
        m.executor = executorByHand;
    }

    /// @dev The CREATE2 rule, written out: the first salt counting from zero whose address carries
    ///      exactly the declared flags and avoids the reserved prefix. Pure arithmetic — deliberately
    ///      no `code.length` check, so the answer is a property of the bytes and not of any chain's
    ///      state, and so the same command prints the same address whether or not it is connected.
    function _mineByHand(bytes32 initCodeHash) internal pure returns (address hook, bytes32 salt, uint256 tried) {
        for (uint256 i = 0; i < MAX_SALT; i++) {
            address a = address(
                uint160(
                    uint256(keccak256(abi.encodePacked(bytes1(0xff), DETERMINISTIC_FACTORY, bytes32(i), initCodeHash)))
                )
            );
            if (uint160(a) & Hooks.ALL_HOOK_MASK != FLAGS) continue;
            if (uint8(uint160(a) >> 152) == RESERVED_PREFIX) continue;
            return (a, bytes32(i), i + 1);
        }
        revert("no salt found below MAX_SALT");
    }

    /// @dev The same search, with every candidate address computed by Foundry's Rust implementation
    ///      instead of by the loop above. Same rule, independent arithmetic.
    function _mineByCheatcode(bytes32 initCodeHash) internal view returns (address hook, bytes32 salt) {
        for (uint256 i = 0; i < MAX_SALT; i++) {
            address a = vm.computeCreate2Address(bytes32(i), initCodeHash, DETERMINISTIC_FACTORY);
            if (uint160(a) & Hooks.ALL_HOOK_MASK != FLAGS) continue;
            if (uint8(uint160(a) >> 152) == RESERVED_PREFIX) continue;
            return (a, bytes32(i));
        }
        revert("no salt found below MAX_SALT (cheatcode route)");
    }

    // ---- printing --------------------------------------------------------------------------------

    function _printMined(Mined memory m) internal view {
        console.log("# UNICA V3 hook address, derived three ways and agreed before printing");
        console.log("  CREATE2 factory            ", DETERMINISTIC_FACTORY);
        console.log("  hook init-code hash        ");
        console.logBytes32(m.initCodeHash);
        console.log("  hook salt                  ");
        console.logBytes32(m.salt);
        console.log("  salts tried                ", m.saltsTried);
        console.log("  hook address               ", m.hook);
        console.log("  hook address flag bits     ", uint256(uint160(m.hook) & Hooks.ALL_HOOK_MASK));
        console.log("  declared flag bits         ", uint256(FLAGS));
        console.log("  executor init-code hash    ");
        console.logBytes32(m.executorInitCodeHash);
        console.log("  executor salt              ");
        console.logBytes32(EXECUTOR_SALT);
        console.log("  executor address           ", m.executor);
        console.log("");
        console.log("  The creation code carries no constructor argument and no chain id, so this ONE");
        console.log("  address is the hook's address on ALL five chains. Re-mine only when the");
        console.log("  init-code hash above changes.");
        console.log("");
    }

    /// @dev One block per chain, lead chain first. `live` decides whether each row is also read back
    ///      from the chain it describes.
    function _printChainTable(Mined memory m, bool live) internal {
        console.log("# the five chains this generation resolves, lead chain first");
        for (uint256 i = 0; i < UnicaDeploymentsV3.CHAIN_COUNT; i++) {
            uint256 chainId = UnicaDeploymentsV3.chainIdAt(i);
            UnicaDeploymentsV3.Routing memory r = UnicaDeploymentsV3.routing(chainId);

            console.log("");
            console.log("  ---- chain", chainId, i == 0 ? "(LEAD)" : "");
            console.log("    Universal Router      ", r.universalRouter);
            console.log("    router code hash      ");
            console.logBytes32(r.universalRouterCodeHash);
            console.log("    router param layout   ", RouterParamsCodec.name(r.layout));
            console.log("    PoolManager           ", r.poolManager);
            console.log("    Permit2               ", r.permit2);
            if (UnicaDeploymentsV3.hasVerifiedPayoutCurrency(chainId)) {
                console.log("    payout currency       ", UnicaDeploymentsV3.payoutCurrency(chainId));
            } else {
                // Stated, never blanked. An empty field and a missing fact look identical.
                console.log("    payout currency        NOT VERIFIED on this chain - hook and executor");
                console.log("                           both REVERT here until one is read and recorded");
            }
            _check(r.chainId == chainId, "the routing row names the chain it was asked for");
            _check(r.universalRouter != address(0), "router address is not zero");
            _check(r.poolManager != address(0), "pool manager address is not zero");
            _check(r.universalRouterCodeHash != bytes32(0), "router code hash is recorded");
            _check(r.layout != RouterParamsCodec.Layout.Unknown, "router layout is not Unknown");

            if (live) _liveRow(m, chainId, r);
        }
        console.log("");
    }

    /// @dev Read the chain this row describes and check the row against it. Unreachable is a SKIP.
    function _liveRow(Mined memory m, uint256 chainId, UnicaDeploymentsV3.Routing memory r) internal {
        string memory alias_ = _rpcAlias(chainId);
        string memory url;
        try vm.rpcUrl(alias_) returns (string memory u) {
            url = u;
        } catch {
            _skip(string.concat("no rpc alias '", alias_, "' for this chain"));
            return;
        }
        try vm.createSelectFork(url) returns (uint256) {}
        catch {
            _skip(string.concat("alias '", alias_, "' did not answer"));
            return;
        }

        // A wrong CHAIN is misconfiguration, not downtime: fail hard rather than skip.
        require(block.chainid == chainId, "the alias for this chain answered a different chain id");

        console.log("    live: router runtime bytes", r.universalRouter.code.length);
        console.log("    live: hook address code   ", m.hook.code.length);
        console.log("    live: executor code       ", m.executor.code.length);

        _check(r.universalRouter.codehash == r.universalRouterCodeHash, "live router code hash matches the table");
        _check(r.poolManager.code.length > 0, "live PoolManager holds code");
        _check(r.permit2.code.length > 0, "live Permit2 holds code");
        _check(
            UnicaDeploymentsV3.CREATE2_FACTORY.code.length == 69,
            "live CREATE2 factory is the 69-byte deterministic one"
        );
        if (UnicaDeploymentsV3.hasVerifiedPayoutCurrency(chainId)) {
            _check(UnicaDeploymentsV3.payoutCurrency(chainId).code.length > 0, "live payout currency holds code");
        } else {
            _skip("payout currency not verified on this chain, so nothing to read back");
        }
        // Vacancy is reported, never asserted: an occupied address is a fact to act on, not a reason
        // for this script to fail.
        if (m.hook.code.length == 0 && m.executor.code.length == 0) {
            console.log("    live: both mined addresses are VACANT here");
        } else {
            console.log("    live: at least one mined address is OCCUPIED here");
        }
    }

    /// @dev The `foundry.toml` alias for each chain. Script-local on purpose: an alias is a local
    ///      operator convenience and has no business inside `src/`, where it would end up compiled
    ///      into a deployed contract's bytes.
    function _rpcAlias(uint256 chainId) internal pure returns (string memory) {
        if (chainId == 46630) return "robinhood_testnet";
        if (chainId == 11155111) return "sepolia_testnet";
        if (chainId == 1301) return "unichain_testnet";
        if (chainId == 84532) return "base_testnet";
        if (chainId == 421614) return "arbitrum_testnet";
        revert("no rpc alias known for this chain id");
    }

    // ---- the counter every runner in this repository ends with -----------------------------------

    function _check(bool ok, string memory what) internal {
        checksRun++;
        if (ok) {
            checksPassed++;
        } else {
            checksFailed++;
            console.log("    FAIL:", what);
        }
    }

    function _skip(string memory why) internal {
        checksSkipped++;
        console.log("    SKIP:", why);
    }

    /// @dev A skip is printed as a skip and never folded into a pass, and a failure reverts, which is
    ///      how a `forge script` exits non-zero.
    function _summary() internal view {
        console.log("checks run:", checksRun);
        console.log("passed:", checksPassed);
        console.log("failed:", checksFailed);
        console.log("skipped:", checksSkipped);
        require(checksFailed == 0, "MineHookV3: at least one check failed");
    }
}
