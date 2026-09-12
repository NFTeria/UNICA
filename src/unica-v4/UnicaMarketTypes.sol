// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title UnicaMarketTypes, the shared shapes of a UNICA v4 market
/// @notice Written from `docs/unica-v4/SPEC-CONTRACTS.md` §5, §6, §7 and §9. Every contract in
///         `src/unica-v4/` reads these and none redefines them, so a field cannot drift between the
///         registry that stores it, the factory that fills it and the hook that checks it.
///         "UNICA v4" is the UNICA release; "Uniswap v4" is the AMM.
library UnicaMarketTypes {
    /// @notice The lifecycle, stored as `uint8` (SC §5). RETIRED is terminal.
    enum MarketStatus {
        None, // 0
        PROPOSED, // 1
        INITIALIZED, // 2
        SEEDED, // 3
        ACTIVE, // 4
        PAUSED, // 5
        RETIRED // 6

    }

    /// @notice An order's life (SC §9): the frozen numbering, so older decoders still read it.
    enum OrderStatus {
        None,
        Open,
        Paying,
        Settled
    }

    /// @notice The per-market oracle policy (SC §6). Disabled means every field zero and the market
    ///         flagged demonstration-only; enabled means the route is bound into `marketId`.
    struct OraclePolicy {
        address adapter;
        bytes32 feedId;
        uint48 maxAge;
        uint16 maxDeviationBps;
        bool enabled;
    }

    /// @notice Caps in payout-token base units (SC §6, §9.2). Per-tx and per-day only ever tighten;
    ///         the seed cap has no setter at all.
    struct Caps {
        uint128 maxPerTxPayout;
        uint128 maxPerDayPayout;
        uint128 maxSeedPayout;
    }

    /// @notice What the factory is asked to create (SC §7). `rateE18` is whole payout per whole
    ///         asset, scaled by 1e18: a demonstration rate the admin sets, never a market price.
    struct MarketConfig {
        address asset;
        address payout;
        uint256 rateE18;
        uint24 fee;
        int24 tickSpacing;
        OraclePolicy policy;
        Caps caps;
    }

    /// @notice The write-once market record plus its lifecycle fields (SC §6).
    struct Market {
        address asset;
        address payout;
        uint32 version;
        address hook;
        address executor;
        bytes32 poolId;
        uint256 rateE18;
        uint160 initSqrtPriceX96;
        int24 initTick;
        uint24 fee;
        int24 tickSpacing;
        uint8 assetDecimals;
        uint8 payoutDecimals;
        bool assetIsCurrency0;
        bool demonstrationOnly;
        uint64 proposedAt;
        MarketStatus status;
        uint64 updatedAt;
        uint128 seedDepth;
    }

    /// @notice A payer-bound order (SC §9). Written whole once by `createOrder`; only `status`
    ///         changes afterwards. The recipient is frozen here: nothing outside the executor, an
    ///         ENS record included, can redirect an order once it exists.
    struct Order {
        address recipient;
        address creator;
        address payer;
        uint128 amountIn;
        uint128 minOut;
        uint64 deadline;
        OrderStatus status;
    }
}
