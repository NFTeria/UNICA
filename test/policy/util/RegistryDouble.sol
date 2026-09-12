// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";

/// @notice A settable double standing in for the two `UnicaMarketRegistry` reads
///         `UnicaPolicyReceiver.onReport` makes (`getMarket`, `statusOf`) — nothing else of the real
///         registry is implemented. Test-only; not part of `IUnicaMarketRegistry`'s own contract
///         family and never deployed outside `test/policy/*`.
contract RegistryDouble {
    mapping(bytes32 => UnicaMarketTypes.Market) private _markets;
    mapping(bytes32 => uint8) private _status;

    function setMarket(bytes32 marketId, UnicaMarketTypes.Market memory market) external {
        _markets[marketId] = market;
    }

    function setStatus(bytes32 marketId, uint8 status) external {
        _status[marketId] = status;
    }

    function getMarket(bytes32 marketId) external view returns (UnicaMarketTypes.Market memory) {
        return _markets[marketId];
    }

    function statusOf(bytes32 marketId) external view returns (uint8) {
        return _status[marketId];
    }
}
