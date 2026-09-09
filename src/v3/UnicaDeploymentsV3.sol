// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {RouterParamsCodec} from "../compat/RouterParamsCodec.sol";

/// @title UnicaDeploymentsV3, the five chains V3 knows and the one thing V1 could not say
/// @notice V1's `src/libraries/UniswapDeployments.sol` answers for one chain and returns two
///         addresses. This library answers for five and returns five things, because a settlement
///         needs all five and the fifth is the one that bites: **which `ExactInputSingleParams`
///         layout the router on that chain decodes**. Chain 46630 is listed first everywhere in this
///         file, because it is the chain whose answer differs and therefore the chain this generation
///         exists for.
///
///         WHY THE ROUTER'S CODE HASH IS IN THE TABLE, and not just its address. A chain id is a
///         number any RPC endpoint can claim; the runtime code hash is what the router actually IS.
///         The layout is a property of the BUILD, not of the chain — a chain that redeploys its
///         Universal Router from a newer v4-periphery changes layout without changing its chain id or
///         its router address. Recording the hash beside the layout turns "chain 84532 is five-field"
///         from an assumption into a claim that can be checked against the chain in one `extcodehash`,
///         and `UnicaExecutorV3` checks it before every plan it builds.
///
///         WHY THAT MATTERS MORE THAN IT SOUNDS. On a native-input pool — the exact shape UNICA
///         settles through, `currency0 == address(0)` — a five-field router does not REFUSE a
///         six-field call. It misreads `minHopPriceX36 = 0` as the hook data offset, offset zero
///         lands back on `currency0`, and a zero there reads as length zero: the swap succeeds and
///         the hook is handed empty bytes. `src/compat/RouterParamsCodec.sol` documents the mechanism
///         and `test/compat/SepoliaRouterControl.t.sol` measures it. A wrong layout is therefore not
///         reliably loud. It can pay a merchant and drop the order id. Detection must be positive.
///
/// @dev Every value below was read from the chain with `cast` on 2026-09-09 by the session that wrote
///      this file — router runtime and its keccak, the PoolManager the router itself names through
///      `poolManager()`, Permit2's runtime size, and the payout token's `symbol()` and `decimals()`.
///      Nothing here was transcribed from a page without being read back. `test/v3/DeploymentsV3Fork.t.sol`
///      re-reads all of it against each live chain, so a stale row goes red rather than quiet.
///
///      Pure. No storage, no owner, nothing to configure. Adding or changing a chain changes this
///      library's bytes, which changes the creation code of everything that embeds it, which changes
///      the mined hook address — that is not a bug, it is the property that makes a UNICA generation
///      a fixed, checkable thing. See `script/v3/MineHookV3.s.sol`.
library UnicaDeploymentsV3 {
    /// @notice The chain V3 leads with: the one whose Universal Router wants the six-field layout.
    uint256 internal constant LEAD_CHAIN_ID = 46630;
    /// @notice How many chains this generation resolves. `chainIdAt` walks them, lead first.
    uint256 internal constant CHAIN_COUNT = 5;

    /// @notice Permit2, identical at this address on all five chains (9,152 runtime bytes on each,
    ///         read 2026-09-09). Exposed through a chain-taking function anyway, so an unsupported
    ///         chain gets a refusal here too rather than one live-looking address out of five.
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// @notice The canonical CREATE2 factory, byte-identical on all five chains (69 runtime bytes).
    ///         Recorded here because it is what makes one mined salt land on one address everywhere.
    address internal constant CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @notice Everything a settlement needs to know about one chain's routing stack.
    /// @param chainId The chain this row is about, carried in the struct so a caller that passes the
    ///        struct around cannot lose track of which chain it describes.
    /// @param universalRouter Uniswap's official Universal Router on that chain.
    /// @param universalRouterCodeHash `extcodehash` of that router's runtime, read 2026-09-09. The
    ///        binding between the address and the build whose layout is claimed below.
    /// @param poolManager The v4 PoolManager, cross-checked by asking the router itself.
    /// @param permit2 Permit2. Same address everywhere; present so one struct answers everything.
    /// @param layout Which `ExactInputSingleParams` head that router's build decodes. Never `Unknown`
    ///        for a listed chain: a row that cannot say is not a row, it is a gap, and a gap reverts.
    struct Routing {
        uint256 chainId;
        address universalRouter;
        bytes32 universalRouterCodeHash;
        address poolManager;
        address permit2;
        RouterParamsCodec.Layout layout;
    }

    /// @notice This chain is not one of the five. Carries the id, because "unsupported chain" with no
    ///         number in it is the error message that costs an hour.
    error UnsupportedChainId(uint256 chainId);
    /// @notice The chain is supported for routing, but no payout token on it has been verified.
    /// @dev A DISTINCT error from `UnsupportedChainId`, deliberately: these are different facts and
    ///      collapsing them would let a reader think chain 46630 is unknown when what is unknown is
    ///      one token on it. Chain 46630's routing stack was read first-hand; its payout token was
    ///      searched for and not found (see `payoutCurrency`). Naming a plausible address would be a
    ///      guess, and a guessed payout currency is compiled into the hook's address and into every
    ///      receipt it emits, so the guess would be permanent. This refuses instead.
    error PayoutCurrencyNotVerified(uint256 chainId);
    /// @notice `chainIdAt` was asked for a position past the end of the list.
    error ChainIndexOutOfRange(uint256 index);

    // ---- the table -------------------------------------------------------------------------------

    /// @notice The routing stack for one chain. The single table every other function reads.
    /// @dev Robinhood first, then the four that share the older build. One `if` chain rather than a
    ///      storage mapping because this must be `pure`: it is read from a constructor, so it has to
    ///      work before the contract it configures exists.
    function routing(uint256 chainId) internal pure returns (Routing memory) {
        // Robinhood testnet. The lead chain, and the reason V3 exists: a Universal Router built from
        // a v4-periphery at or after commit `03b2d09`, which decodes SIX static fields. 24,546
        // runtime bytes against the other four's 19,540.
        if (chainId == 46630) {
            return Routing({
                chainId: 46630,
                universalRouter: 0x8876789976dEcBfCbBbe364623C63652db8C0904,
                universalRouterCodeHash: 0xfdd90802f39ce5fc8bac4c2f1b3ac7bac530fd17ff46b0630f1bd00f1e14082f,
                poolManager: 0x8366a39CC670B4001A1121B8F6A443A643e40951,
                permit2: PERMIT2,
                layout: RouterParamsCodec.Layout.PerHop
            });
        }
        // Ethereum Sepolia. V1 is deployed here; this row must keep agreeing with
        // `src/libraries/UniswapDeployments.sol`, and `test/v3/DeploymentsV3.t.sol` asserts that it does.
        if (chainId == 11155111) {
            return Routing({
                chainId: 11155111,
                universalRouter: 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b,
                universalRouterCodeHash: 0x14f7c9253a5406bafa90cb512f4a2db2a10513886603e7a9b4a2e72329e944f4,
                poolManager: 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543,
                permit2: PERMIT2,
                layout: RouterParamsCodec.Layout.Legacy
            });
        }
        // Unichain Sepolia. Measured end to end in `docs/chains/UNICHAIN-SEPOLIA.md`: five-field, and
        // a 32-byte order id arrives at the hook intact.
        if (chainId == 1301) {
            return Routing({
                chainId: 1301,
                universalRouter: 0xf70536B3bcC1bD1a972dc186A2cf84cC6da6Be5D,
                universalRouterCodeHash: 0x87c34af74ff2c474c881845e3942b52b0de1f03a04196e1c1504bed3d7859e56,
                poolManager: 0x00B036B58a818B1BC34d502D3fE730Db729e62AC,
                permit2: PERMIT2,
                layout: RouterParamsCodec.Layout.Legacy
            });
        }
        // Base Sepolia.
        if (chainId == 84532) {
            return Routing({
                chainId: 84532,
                universalRouter: 0x492E6456D9528771018DeB9E87ef7750EF184104,
                universalRouterCodeHash: 0x952c879f642706a4d399eb917827b5a2a5519328446dba72aef3579909bf15ef,
                poolManager: 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408,
                permit2: PERMIT2,
                layout: RouterParamsCodec.Layout.Legacy
            });
        }
        // Arbitrum Sepolia.
        if (chainId == 421614) {
            return Routing({
                chainId: 421614,
                universalRouter: 0xeFd1D4bD4cf1e86Da286BB4CB1B8BcED9C10BA47,
                universalRouterCodeHash: 0xd1b72cad4c9dffc62de6226f90ca8d5d9dfa6650149caeddacff8edfc9d83608,
                poolManager: 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317,
                permit2: PERMIT2,
                layout: RouterParamsCodec.Layout.Legacy
            });
        }
        revert UnsupportedChainId(chainId);
    }

    /// @notice The one currency a settlement may pay out on this chain: Circle's USDC.
    /// @dev Each of the four below answered `symbol()` `"USDC"` and `decimals()` `6` when read on
    ///      2026-09-09, and each holds 1,798 runtime bytes — Circle's proxy, the same build on all
    ///      four. That triple is the check: an address that merely "has code" is exactly the failure
    ///      this repository already met once on chain 46630's router.
    ///
    ///      CHAIN 46630 IS ABSENT ON PURPOSE, and this is the honest limit of this generation.
    ///      Searching that chain on 2026-09-09 found no USDC: the four addresses above hold no code
    ///      there, the router does not expose `WETH9()` or `permit2()` to point at one, and the
    ///      endpoint caps `eth_getLogs` at a ten-block range, so neither a `Transfer` sweep nor the
    ///      PoolManager's own `Initialize` log could be read to find one. So the lead chain resolves
    ///      its ROUTING stack — which is the whole subject of the six-field finding — and refuses to
    ///      name a payout token. `UnicaHookV3` and `UnicaExecutorV3` both call this in their
    ///      constructors, so neither can be deployed on 46630 until one address is verified and added
    ///      here. That is the intended behaviour: a settlement is a promise to pay a specific token,
    ///      and an unverified token is not a promise anyone should be able to make by accident.
    function payoutCurrency(uint256 chainId) internal pure returns (address) {
        if (chainId == 11155111) return 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        if (chainId == 1301) return 0x31d0220469e10c4E71834a79b1f276d740d3768F;
        if (chainId == 84532) return 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
        if (chainId == 421614) return 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
        // Supported for routing, but with no payout token verified on it. Two different facts, two
        // different errors: a caller that catches one must not silently absorb the other.
        if (chainId == LEAD_CHAIN_ID) revert PayoutCurrencyNotVerified(chainId);
        revert UnsupportedChainId(chainId);
    }

    // ---- thin readers, all of them going through the one table -----------------------------------

    /// @notice Uniswap's Universal Router on this chain.
    function universalRouter(uint256 chainId) internal pure returns (address) {
        return routing(chainId).universalRouter;
    }

    /// @notice The runtime code hash that router had when this table was written.
    function universalRouterCodeHash(uint256 chainId) internal pure returns (bytes32) {
        return routing(chainId).universalRouterCodeHash;
    }

    /// @notice Uniswap's v4 PoolManager on this chain.
    function poolManager(uint256 chainId) internal pure returns (address) {
        return routing(chainId).poolManager;
    }

    /// @notice Permit2 on this chain. Chain-checked, so an unsupported chain is refused rather than
    ///         handed the one address that happens to be the same everywhere.
    function permit2(uint256 chainId) internal pure returns (address) {
        return routing(chainId).permit2;
    }

    /// @notice Which `ExactInputSingleParams` layout this chain's router decodes.
    /// @dev The enum, never a bool. Two layouts today is not a promise that there will only ever be
    ///      two, and `Layout.Unknown` has to remain expressible so a probe can say "I could not tell"
    ///      in the same type this table answers in.
    function routerLayout(uint256 chainId) internal pure returns (RouterParamsCodec.Layout) {
        return routing(chainId).layout;
    }

    // ---- enumeration, so a script can walk the generation rather than hardcode it -----------------

    /// @notice The chain at `index`, lead chain first.
    function chainIdAt(uint256 index) internal pure returns (uint256) {
        if (index == 0) return LEAD_CHAIN_ID;
        if (index == 1) return 11155111;
        if (index == 2) return 1301;
        if (index == 3) return 84532;
        if (index == 4) return 421614;
        revert ChainIndexOutOfRange(index);
    }

    /// @notice Whether this chain's routing stack is in the table. Does not promise a payout token —
    ///         ask `hasVerifiedPayoutCurrency` for that, because on the lead chain the answers differ.
    function isSupported(uint256 chainId) internal pure returns (bool) {
        return chainId == 46630 || chainId == 11155111 || chainId == 1301 || chainId == 84532 || chainId == 421614;
    }

    /// @notice Whether a payout token on this chain has been verified, so a script can report the gap
    ///         without catching a revert to find it.
    function hasVerifiedPayoutCurrency(uint256 chainId) internal pure returns (bool) {
        return chainId == 11155111 || chainId == 1301 || chainId == 84532 || chainId == 421614;
    }
}
