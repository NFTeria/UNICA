// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// LOCAL FIXTURE — AN ATTACKER'S FACTORY — DEPLOYS THE REAL HOOK SOURCE FOR THE WRONG PEOPLE
//
// The adversary of SC §3 (C6) and row S1: anyone may compile the same public hook source and deploy
// it through a factory of their own, naming an OFFICIAL marketId in its constructor arguments, and
// its receipts will carry that id. Nothing prevents this and nothing should pretend to. What this
// fixture exists to demonstrate is the defence that does hold — the official registry's three
// reverse lookups return zero for every address here, so a consumer that authenticates a receipt by
// its emitter refuses it.
//
// The registry it hands the hook is a `SpoofRegistry`, not a real one, because a real
// `UnicaMarketRegistry` recomputes `marketId` over its own address and would refuse the official id.
// An attacker who controls the registry controls its code; that is the honest version of the threat.
//
// Tests and the local Anvil demonstration only. Nothing under `src/`, `script/` or `deployments/`
// may reference it.

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {IUnicaMarketHook} from "../../../src/unica-v4/interfaces/IUnicaMarketHook.sol";
import {SpoofRegistry} from "./SpoofRegistry.sol";

contract LookalikeFactory {
    /// @notice The attacker's own registry, created here so it names THIS contract as its factory.
    SpoofRegistry public immutable REGISTRY;
    /// @notice The same pool manager the official markets use: the lookalike pool is a real pool.
    IPoolManager public immutable POOL_MANAGER;
    address public immutable ATTACKER_ADMIN;

    error LookalikeDeployFailed();

    constructor(address attackerAdmin, IPoolManager poolManager) {
        ATTACKER_ADMIN = attackerAdmin;
        POOL_MANAGER = poolManager;
        REGISTRY = new SpoofRegistry(address(this));
    }

    /// @notice Where `deploy` will put a hook, for a salt miner to search against.
    function predict(bytes memory creationCode, bytes memory hookArgs, bytes32 salt) public view returns (address) {
        bytes32 initcodeHash = keccak256(bytes.concat(creationCode, hookArgs));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initcodeHash)))));
    }

    /// @notice CREATE2 of the REAL hook creation code against the attacker's own arguments.
    /// @dev No hash check, no flag check, no registration: an attacker's factory has no reason to
    ///      run any of them, and pretending otherwise would make the row easier than reality.
    function deploy(bytes memory creationCode, bytes memory hookArgs, bytes32 salt)
        external
        returns (address hook, address executor)
    {
        bytes memory initcode = bytes.concat(creationCode, hookArgs);
        assembly ("memory-safe") {
            hook := create2(0, add(initcode, 0x20), mload(initcode), salt)
        }
        if (hook == address(0)) revert LookalikeDeployFailed();
        executor = IUnicaMarketHook(hook).EXECUTOR();
    }

    /// @notice Forwards the attacker's terms to the attacker's registry.
    function spoof(bytes32 marketId, UnicaMarketTypes.Caps memory caps, UnicaMarketTypes.OraclePolicy memory policy)
        external
    {
        REGISTRY.spoof(marketId, caps, policy);
    }

    /// @notice Records the market record the lookalike hook and executor read back, and makes the
    ///         attacker's registry vouch for their addresses.
    function setRecord(bytes32 marketId, UnicaMarketTypes.Market memory record) external {
        REGISTRY.setRecord(marketId, record);
        REGISTRY.vouchFor(marketId);
    }

    /// @notice Initialises the lookalike's pool. It must come from HERE: the hook's
    ///         `beforeInitialize` admits only `sender == FACTORY`, and for this hook that is this
    ///         contract, because the hook read `msg.sender` in its own constructor.
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick) {
        return POOL_MANAGER.initialize(key, sqrtPriceX96);
    }
}
