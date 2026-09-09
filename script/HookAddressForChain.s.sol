// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {V4SettlementHook} from "../src/V4SettlementHook.sol";
import {SettlementExecutor} from "../src/SettlementExecutor.sol";
import {DeploySettlement} from "./DeploySettlement.s.sol";

/// @title HookAddressForChain, the mined hook address for a target chain, derived twice
///
/// @notice A v4 hook's permissions are its address. Deploying UNICA anywhere means first proving
///         which address the creation code lands on through the canonical CREATE2 factory, and that
///         the address carries exactly the declared permission bits. This prints that, checks the
///         address is still vacant on whatever chain `--rpc-url` points at, and — the part that
///         makes it evidence rather than an assertion — derives the same address a SECOND time from
///         an independent implementation and refuses to agree with itself unless they match.
///
/// @dev Run it read-only, against any chain:
///        forge script script/HookAddressForChain.s.sol --sig "run()" --rpc-url https://sepolia.unichain.org
///      Nothing is broadcast; there is no `vm.startBroadcast` in this file.
///
///      WHAT IS AND IS NOT CHAIN-DEPENDENT, because the distinction decides how much work a new
///      chain is. A CREATE2 address is `keccak(0xff, factory, salt, keccak(initCode))`. No chain id
///      enters it. So while the factory is the same contract on both chains — and it is, byte for
///      byte, the same 69-byte runtime and the same code hash — the SAME creation code lands on the
///      SAME address everywhere, and the salt does not need re-mining. What forces a re-mine is a
///      change to the creation code, and the hook's creation code embeds
///      `src/libraries/UniswapDeployments.sol`: adding a chain to that file changes the bytes, the
///      init-code hash, the mined salt and the address, all at once. That is why this script prints
///      the init-code hash beside the address. The hash is the thing to compare across a change; the
///      address is only its shadow.
contract HookAddressForChain is Script {
    /// @dev The deterministic-deployment proxy, present with identical code on every chain studied.
    ///      Written out here rather than inherited so the address a reader is asked to trust is in
    ///      the file that uses it; `run()` asserts it against forge-std's own constant, so the two
    ///      cannot drift apart silently.
    address internal constant DETERMINISTIC_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// @dev The declared permission set: beforeInitialize | beforeSwap | afterSwap.
    uint160 internal constant FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    /// @dev Uniswap reserves the top address byte 0x91 as a routing signal; a mined address that hits
    ///      it is skipped rather than used.
    uint8 internal constant RESERVED_PREFIX = 0x91;
    /// @dev The executor is deployed at salt zero, bound to the hook by constructor argument.
    bytes32 internal constant EXECUTOR_SALT = bytes32(0);
    /// @dev How far the search runs before giving up rather than looping forever.
    uint256 internal constant MAX_SALT = 200_000;

    function run() external {
        require(DETERMINISTIC_FACTORY == CREATE2_FACTORY, "the factory address here is not forge-std's");
        bytes memory creationCode = type(V4SettlementHook).creationCode;
        bytes32 initCodeHash = keccak256(creationCode);

        (address hook, bytes32 salt, uint256 tried) = _mine(initCodeHash);
        address executor = _executorFor(hook);

        console.log("# hook address derivation");
        console.log("  chain                 ", block.chainid);
        console.log("  CREATE2 factory       ", CREATE2_FACTORY);
        console.log("  factory runtime bytes ", DETERMINISTIC_FACTORY.code.length);
        console.log("  hook init-code hash   ");
        console.logBytes32(initCodeHash);
        console.log("  salt                  ");
        console.logBytes32(salt);
        console.log("  salts tried           ", tried);
        console.log("  hook address          ", hook);
        console.log("  address flag bits     ", uint256(uint160(hook) & Hooks.ALL_HOOK_MASK));
        console.log("  executor address      ", executor);

        // The permission set has to be IN the address, or v4 will not call the hook it was told to.
        require(uint160(hook) & Hooks.ALL_HOOK_MASK == FLAGS, "mined address does not carry the declared flags");
        require(uint8(uint160(hook) >> 152) != RESERVED_PREFIX, "mined address uses the reserved prefix");

        // The second derivation. `predict()` in LiveFire searches with Uniswap's own `HookMiner`;
        // the loop above is written here from the CREATE2 rule and shares no code with it. Two
        // implementations landing on one address is what makes this reproducible rather than
        // merely repeatable — a bug would have to exist identically in both to survive.
        DeploySettlement independent = new DeploySettlement();
        (address viaHookMiner, bytes32 saltViaHookMiner) = independent.predict();
        require(viaHookMiner == hook, "the two derivations disagree on the address");
        require(saltViaHookMiner == salt, "the two derivations disagree on the salt");
        console.log("  second derivation (HookMiner) agrees on address and salt");

        // A deploy that lands on an occupied address is not a deploy. Report the state as it is;
        // an occupied address is a fact to act on, not a reason to stop the script.
        console.log("  hook address code bytes on this chain    ", hook.code.length);
        console.log("  executor address code bytes on this chain", executor.code.length);
        if (hook.code.length == 0 && executor.code.length == 0) {
            console.log("  both addresses are VACANT on this chain");
        } else {
            console.log("  at least one address is OCCUPIED on this chain");
        }
    }

    /// @dev The CREATE2 rule, written out: the first salt counting from zero whose address carries
    ///      exactly the declared flags and avoids the reserved prefix.
    function _mine(bytes32 initCodeHash) internal pure returns (address hook, bytes32 salt, uint256 tried) {
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

    /// @dev Where the executor lands: its creation code plus the hook address as its one argument.
    function _executorFor(address hook) internal pure returns (address) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(SettlementExecutor).creationCode, abi.encode(hook)));
        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), DETERMINISTIC_FACTORY, EXECUTOR_SALT, initCodeHash)))
            )
        );
    }
}
