// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title UniswapDeployments, the official Universal Router per chain
/// @notice Read from the official deployments page and confirmed to hold code and answer
///         `msgSender()` and `poolManager()` on 2026-09-04. Resolved from the chain id so the hook's
///         and the executor's creation code carry no per-chain argument (one address on every chain).
///         A chain is listed only once it is verified there; anything else reverts.
library UniswapDeployments {
    error UnsupportedChainId(uint256 chainId);

    /// @dev `UniversalRouterV2` on Ethereum Sepolia, the entry the deployments page calls "Universal Router".
    function universalRouter(uint256 chainId) internal pure returns (address) {
        if (chainId == 11155111) return 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
        revert UnsupportedChainId(chainId);
    }
}
