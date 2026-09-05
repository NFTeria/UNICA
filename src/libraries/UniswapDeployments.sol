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

    /// @notice The one currency a settlement may pay out on this chain: Circle's USDC.
    /// @dev Resolved from the chain id, never configured, so the hook has no owner and no list to
    ///      manage. This is spec C2 and C4 in one line: a pool carrying this hook can only ever be
    ///      native ETH against this token, so nobody can stand up a pool of their own devising,
    ///      settle through it, and mint a receipt naming a recipient who received something
    ///      worthless. Adding a chain here changes the hook's creation code, and so its address.
    function payoutCurrency(uint256 chainId) internal pure returns (address) {
        if (chainId == 11155111) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        revert UnsupportedChainId(chainId);
    }
}
