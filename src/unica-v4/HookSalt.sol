// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

/// @title HookSalt, the CREATE2 salt search that hashes the creation code once
/// @notice A hook address must carry exactly the permission bits in its low fourteen bits, so a salt
///         is mined. The naive search rehashes the whole creation code on every iteration — for a
///         forty-kilobyte hook that is thousands of gas per candidate, and an unlucky bytecode
///         change turned two tests into out-of-gas failures. This search hashes `creationCode ‖
///         args` once and iterates only over the 85-byte CREATE2 preimage, so a full sweep of the
///         salt space costs a few million gas rather than a billion.
/// @dev Pure and internal: inlined wherever it is used (tests, the local deployment script, the
///      public deployment script), so every caller mines against the same arithmetic the factory
///      deploys with. Uniswap's reserved top address byte is not avoided here; the factory's own
///      prediction check and BaseHook's constructor validate the address that results.
library HookSalt {
    uint256 internal constant MAX_ITERATIONS = 1_000_000;

    error NoSaltFound(address deployer, uint160 flags);

    function find(address deployer, uint160 flags, bytes memory creationCode, bytes memory args)
        internal
        pure
        returns (address hook, bytes32 salt)
    {
        bytes32 initCodeHash = keccak256(abi.encodePacked(creationCode, args));
        for (uint256 i = 0; i < MAX_ITERATIONS; i++) {
            salt = bytes32(i);
            hook = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
            if (uint160(hook) & Hooks.ALL_HOOK_MASK == flags) return (hook, salt);
        }
        revert NoSaltFound(deployer, flags);
    }
}
