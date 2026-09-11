// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UnicaStockSettlementHook} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementHook.sol";
import {UnicaStockSettlementExecutor} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementExecutor.sol";
import {UnicaStockSettlementTypes as T} from "../../src/experimental/robinhood-testnet/UnicaStockSettlementTypes.sol";
import {TestPayoutToken} from "../../src/experimental/robinhood-testnet/TestPayoutToken.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function allowance(address, address) external view returns (uint256);
}

/// @title StockSettlement46630 — the stock-settlement experiment, staged for Robinhood testnet
/// @notice EXPERIMENTAL, TESTNET ONLY, and nothing here runs by itself. Every stage is a separate
///         owner-run command through `script/experimental/stock-46630.sh`, which refuses any chain
///         but 46630, pins the block, simulates, prints the plan, and only signs after an explicit
///         opt-in and a typed confirmation. The agent that wrote this never signs and holds no key.
///
///         THE ELEVEN TRANSACTIONS, and why they are split into four stages:
///
///           1. token   (1 tx)  deploy the testnet payout token. Alone, because Batch A named it the
///                              first write and every later stage needs an asset whose issuer is known.
///           2. pair    (2 tx)  hook by CREATE2 at a mined salt, then executor by CREATE. Together,
///                              because each names the other at construction: the hook is mined
///                              against the executor's address PREDICTED from the deployer's
///                              next-but-one nonce, so nothing else may be sent from that account
///                              between them. The wrapper uses `--slow` so they go one at a time.
///           3. pool    (5 tx)  initialise the hook-guarded pool at the owner's stated rate, mint the
///                              seed, approve Permit2, grant the PositionManager a Permit2 allowance,
///                              and mint a SINGLE-SIDED position that holds only the payout token. The
///                              position is an NFT the deployer owns. Not PoolModifyLiquidityTest,
///                              which the local tests use: there the router owns every position, so
///                              on a public chain anyone could withdraw the seed to themselves.
///           4. settle  (3 tx)  create one order to a separate merchant, approve exactly its input,
///                              and pay it in the faucet TSLA.
///
///         Every stage opens with rows that must all pass before anything is marked for broadcast,
///         and closes with rows that check what the transactions did. forge simulates a whole run
///         before it sends anything, so a failed row anywhere stops the stage with nothing sent.
///
///         WHAT THE RATE IS. The pool is initialised at a price the OWNER states, in whole uTUSD per
///         whole TSLA. uTUSD is a no-value test token, so this rate is a demonstration parameter —
///         not an oracle, not a market, and not a claim about any share's value. The separate
///         hookless reference venue on this chain quoted 0.1 TSLA -> 39.531580 of its own 6-decimal
///         token on 2026-09-10 (docs/experimental/BATCH-A-RECONNAISSANCE.md); a rate near that makes
///         the demo read sensibly, and nothing more.
contract StockSettlement46630 is Script {
    using PoolIdLibrary for PoolKey;

    // ── chain facts, each read first-hand and recorded in docs/chains/ROBINHOOD.md ─────────────
    uint256 internal constant CHAIN_ID = 46630;
    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    IStateView internal constant STATE_VIEW = IStateView(0xF3334192D15450CdD385c8B70e03f9A6bD9E673b);
    IPositionManager internal constant POSITION_MANAGER =
        IPositionManager(payable(0x58daec3116aae6D93017bAAea7749052E8a04fA7));
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;
    uint256 internal constant POOL_MANAGER_RUNTIME_BYTES = 24009;

    // ── this experiment's pool shape ──────────────────────────────────────────────────────────
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint160 internal constant FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    /// @dev The seeded position spans this many ticks on the side a payer's sale moves toward:
    ///      6960 ticks is a price move of about 2x, far beyond any size this demo settles.
    int24 internal constant RANGE_TICKS = 6960;
    /// @dev forge simulates the whole run BEFORE the keystore prompt, so every block.timestamp
    ///      value here ages from the simulation, not from the signature. Measured on this repo's
    ///      own live deploy: an order lost to DeadlineInPast after a five-hour gap. A day absorbs it.
    uint256 internal constant WINDOW = 1 days;
    /// @dev The order's floor, as a fraction of the price the pool itself states: 3% below spot
    ///      covers the 0.3% fee, the empty ticks between spot and the seeded range, and slippage.
    uint256 internal constant MIN_OUT_BPS = 9700;

    string internal constant STOPPED = "a check failed; nothing in this stage is broadcast";

    uint256 internal checksRun;
    uint256 internal checksFailed;

    // ════════════════════════════════════════════════════════════════════════════════════════
    // The stages. Each is a thin entry point: the deployer is whoever forge was told to sign as,
    // and the work is done by an internal function that takes the deployer explicitly — which is
    // what lets a test drive every stage without a prank (forge refuses a prank and a broadcast at
    // once, measured 2026-09-10).
    // ════════════════════════════════════════════════════════════════════════════════════════

    function token() external returns (address) {
        return _token(msg.sender);
    }

    function pair(address payout) external returns (address hookAddr, address executorAddr) {
        return _pair(msg.sender, payout);
    }

    /// @param uTusdPerTsla The rate, in whole uTUSD for one whole TSLA. The owner's to state.
    /// @param seedWhole    Whole uTUSD to mint and place in the position.
    function pool(address payout, address hook, uint256 uTusdPerTsla, uint256 seedWhole) external {
        _pool(msg.sender, payout, hook, uTusdPerTsla, seedWhole);
    }

    function settle(address payout, address hook, address executor, address merchant, uint128 amountIn, bytes32 salt)
        external
        returns (bytes32)
    {
        return _settle(msg.sender, Order(payout, hook, executor, merchant, amountIn, salt));
    }

    /// @notice Read-only proof, run after any stage. Sends nothing.
    function verify(address payout, address hook, address executor) external {
        _row(block.chainid == CHAIN_ID, "the endpoint reports chain 46630");
        _row(payout.code.length > 0, "the payout token has code");
        _row(_word(payout, "decimals()") == 6, "the payout token has six decimals");
        _pairRows(hook, payout);
        _row(_word(executor, "HOOK()") == uint256(uint160(hook)), "the executor names this hook");
        _row(_word(hook, "SETTLEMENT_EXECUTOR()") == uint256(uint160(executor)), "the hook names this executor");
        (uint160 sqrtPrice,,,) = STATE_VIEW.getSlot0(_key(payout, hook).toId());
        console.log("pool initialised      ", sqrtPrice != 0);
        console.log("payout in PoolManager ", IERC20Min(payout).balanceOf(address(POOL_MANAGER)));
        console.log("receipts              ", _word(hook, "receiptCount()"));
        console.log("orders                ", _word(executor, "orderCount()"));
        _gate();
    }

    // ════════════════════════════════════════════════════════════════════════════════════════
    // Stage 1 — the payout token (1 transaction)
    // ════════════════════════════════════════════════════════════════════════════════════════

    function _token(address deployer) internal returns (address) {
        _chainRows(deployer);
        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
        _row(predicted.code.length == 0, "nothing already lives at the predicted token address");
        _gate();
        console.log("PLAN transactions: 1");
        console.log("PLAN tx 1  CREATE TestPayoutToken(minter = deployer), predicted at", predicted);

        vm.startBroadcast(deployer);
        TestPayoutToken t = new TestPayoutToken(deployer);
        vm.stopBroadcast();

        _row(address(t) == predicted, "the token landed at the predicted address");
        _row(t.MINTER() == deployer, "its minter is the deployer, and no one else");
        _row(t.decimals() == 6, "it has six decimals");
        _gate();
        console.log("TOKEN", address(t));
        return address(t);
    }

    // ════════════════════════════════════════════════════════════════════════════════════════
    // Stage 2 — hook and executor, as two consecutive transactions (2 transactions)
    // ════════════════════════════════════════════════════════════════════════════════════════

    function _pair(address deployer, address payout) internal returns (address hookAddr, address executorAddr) {
        _chainRows(deployer);
        _payoutRows(payout, deployer);
        // Gate before mining: a wrong payout address should stop here, not after a salt search
        // (measured: 182M gas of mining spent on a stage that was always going to be refused).
        _gate();

        // Transaction N is the CREATE2 call through the deterministic factory; transaction N+1 is
        // the executor's own CREATE. So the executor's address is the deployer's CREATE address at
        // N+1, and the hook is mined against THAT.
        uint64 n = vm.getNonce(deployer);
        address predictedExecutor = vm.computeCreateAddress(deployer, n + 1);
        bytes32 salt;
        (hookAddr, salt) = HookMiner.find(
            CREATE2_FACTORY,
            FLAGS,
            type(UnicaStockSettlementHook).creationCode,
            abi.encode(POOL_MANAGER, predictedExecutor, TSLA, payout)
        );
        _row(uint160(hookAddr) & Hooks.ALL_HOOK_MASK == FLAGS, "the mined address carries exactly 0x20C0");
        _row(hookAddr.code.length == 0, "nothing already lives at the mined hook address");
        _row(predictedExecutor.code.length == 0, "nothing already lives at the predicted executor address");
        _gate();
        console.log("PLAN transactions: 2, from nonce", n);
        console.log("PLAN tx 1  CREATE2 hook via the deterministic factory, predicted at", hookAddr);
        console.log("PLAN tx 2  CREATE executor at deployer nonce N+1, predicted at", predictedExecutor);

        vm.startBroadcast(deployer);
        UnicaStockSettlementHook h =
            new UnicaStockSettlementHook{salt: salt}(POOL_MANAGER, predictedExecutor, TSLA, payout);
        vm.stopBroadcast();
        _afterHook(deployer);
        vm.startBroadcast(deployer);
        UnicaStockSettlementExecutor x = new UnicaStockSettlementExecutor(POOL_MANAGER, address(h), TSLA, payout);
        vm.stopBroadcast();
        executorAddr = address(x);

        _row(address(h) == hookAddr, "the hook landed at the mined address");
        _row(executorAddr == predictedExecutor, "the executor landed where the hook expects it");
        _row(h.SETTLEMENT_EXECUTOR() == executorAddr, "the hook names this executor");
        _row(x.HOOK() == address(h), "the executor names this hook");
        _row(h.INPUT_CURRENCY() == TSLA && x.INPUT_CURRENCY() == TSLA, "both bind the faucet TSLA as input");
        _row(h.PAYOUT_CURRENCY() == payout && x.PAYOUT_CURRENCY() == payout, "both bind the test token as payout");
        _gate();
        console.log("HOOK", hookAddr);
        console.log("EXECUTOR", executorAddr);
    }

    // ════════════════════════════════════════════════════════════════════════════════════════
    // Stage 3 — the hook-guarded pool, seeded single-sided (5 transactions; 4 when resuming)
    // ════════════════════════════════════════════════════════════════════════════════════════

    /// @dev Everything the pool stage decides before it sends anything, carried as one value. Split
    ///      out for the same reason the executor carries a Snapshot: the legacy code generator runs
    ///      out of stack with these as locals, and switching the whole repository to via-IR to hide
    ///      that would change every other contract's bytecode for the sake of one script.
    struct Seed {
        PoolKey key;
        uint160 sqrtPrice;
        int24 lower;
        int24 upper;
        uint128 liquidity;
        uint256 seedRaw;
        bytes unlockData;
        bool resuming;
    }

    function _pool(address deployer, address payout, address hook, uint256 uTusdPerTsla, uint256 seedWhole) internal {
        _chainRows(deployer);
        _payoutRows(payout, deployer);
        _pairRows(hook, payout);
        _row(uTusdPerTsla >= 1 && uTusdPerTsla <= 100_000, "the stated rate is between 1 and 100,000 uTUSD per TSLA");
        _row(seedWhole >= 100 && seedWhole <= 10_000_000, "the seed is between 100 and 10,000,000 uTUSD");
        // Gate BEFORE the arithmetic: a rate of zero divides by zero on the currency1 path, and the
        // owner should see the row that names the rate, not a bare panic.
        _gate();

        Seed memory s = _plan(payout, hook, uTusdPerTsla, seedWhole, deployer);
        // RESUMABLE. This stage sends five transactions; if the pool was initialised and a later one
        // failed, a re-run must be able to finish the seed rather than refuse on its own earlier
        // success. So an existing pool is accepted at EXACTLY the stated rate — the only price this
        // stage could have set, and a price no trade has moved yet — and refused at any other, which
        // is what a pool initialised by somebody else, or one that has already traded, would show.
        (uint160 existing,,,) = STATE_VIEW.getSlot0(s.key.toId());
        s.resuming = existing != 0;
        _row(
            !s.resuming || existing == s.sqrtPrice,
            "the guarded pool is uninitialised, or initialised at exactly this rate by an earlier run"
        );
        _row(s.liquidity > 0, "the seed buys a non-zero position");
        _gate();
        _printSeedPlan(s, payout, uTusdPerTsla);
        uint256 tslaBefore = IERC20Min(TSLA).balanceOf(deployer);

        vm.startBroadcast(deployer);
        if (!s.resuming) POOL_MANAGER.initialize(s.key, s.sqrtPrice);
        TestPayoutToken(payout).mint(deployer, s.seedRaw);
        IERC20Min(payout).approve(PERMIT2, s.seedRaw);
        IAllowanceTransfer(PERMIT2)
            .approve(payout, address(POSITION_MANAGER), uint160(s.seedRaw), uint48(block.timestamp + WINDOW));
        POSITION_MANAGER.modifyLiquidities(s.unlockData, block.timestamp + WINDOW);
        vm.stopBroadcast();
        _afterSeed(deployer);

        (uint160 nowPrice,,,) = STATE_VIEW.getSlot0(s.key.toId());
        _row(nowPrice == s.sqrtPrice, "the pool is initialised at the stated rate");
        _row(IERC20Min(payout).balanceOf(address(POOL_MANAGER)) > 0, "the PoolManager now holds the seed");
        _row(IERC20Min(TSLA).balanceOf(deployer) == tslaBefore, "the seed took no TSLA: the position is payout-only");
        _gate();
        console.log("POOL_ID");
        console.logBytes32(PoolId.unwrap(s.key.toId()));
    }

    function _printSeedPlan(Seed memory s, address payout, uint256 uTusdPerTsla) internal pure {
        console.log("PLAN transactions:", s.resuming ? uint256(4) : uint256(5), s.resuming ? "(resuming)" : "");
        console.log("PLAN pool   currency0", Currency.unwrap(s.key.currency0));
        console.log("PLAN pool   currency1", Currency.unwrap(s.key.currency1));
        console.log("PLAN pool   fee / tick spacing", uint256(FEE), uint256(uint24(TICK_SPACING)));
        console.log("PLAN pool   rate, whole uTUSD per whole TSLA", uTusdPerTsla);
        console.log("PLAN pool   sqrtPriceX96", uint256(s.sqrtPrice));
        console.log("PLAN range  lower tick", int256(s.lower));
        console.log("PLAN range  upper tick", int256(s.upper));
        console.log("PLAN seed   raw uTUSD minted and approved", s.seedRaw);
        console.log("PLAN seed   liquidity", uint256(s.liquidity));
        if (!s.resuming) console.log("PLAN tx     PoolManager.initialize(key, sqrtPriceX96)");
        console.log("PLAN tx     TestPayoutToken.mint(deployer, seed)", payout);
        console.log("PLAN tx     TestPayoutToken.approve(Permit2, seed)");
        console.log("PLAN tx     Permit2.approve(token, PositionManager, seed, now + 1 day)");
        console.log("PLAN tx     PositionManager.modifyLiquidities(MINT_POSITION, SETTLE_PAIR)");
    }

    /// @dev MINT_POSITION then SETTLE_PAIR. The mint's ceiling on TSLA is ZERO, so a mistake in the
    ///      range arithmetic that would make the position ask for TSLA reverts inside the
    ///      PositionManager instead of spending it. SETTLE_PAIR settles each currency's full debt from
    ///      the deployer through Permit2, and the PositionManager skips a zero debt without a call.
    function _plan(address payout, address hook, uint256 uTusdPerTsla, uint256 seedWhole, address owner)
        internal
        pure
        returns (Seed memory s)
    {
        s.key = _key(payout, hook);
        s.sqrtPrice = _sqrtPriceFor(payout, uTusdPerTsla);
        (s.lower, s.upper, s.liquidity, s.seedRaw) = _position(payout, s.sqrtPrice, seedWhole);
        (uint128 max0, uint128 max1) =
            _tslaIsZero(payout) ? (uint128(0), uint128(s.seedRaw)) : (uint128(s.seedRaw), uint128(0));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(s.key, s.lower, s.upper, uint256(s.liquidity), max0, max1, owner, bytes(""));
        params[1] = abi.encode(s.key.currency0, s.key.currency1);
        s.unlockData = abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR)), params);
    }

    // ════════════════════════════════════════════════════════════════════════════════════════
    // Stage 4 — one settlement: the deployer pays a separate merchant in TSLA (3 transactions)
    // ════════════════════════════════════════════════════════════════════════════════════════

    /// @dev The settle stage's inputs, carried as one value: seven loose parameters plus the
    ///      measurements below exhaust the legacy code generator's stack, as Seed's did.
    struct Order {
        address payout;
        address hook;
        address executor;
        address merchant;
        uint128 amountIn;
        bytes32 salt;
    }

    /// @dev The settle stage's measurements, carried as one value for the same stack reason as Seed.
    struct Payment {
        PoolKey key;
        uint128 minOut;
        uint256 merchantBefore;
        uint256 receiptsBefore;
        uint256 tslaBefore;
    }

    function _settle(address deployer, Order memory o) internal returns (bytes32 orderId) {
        Payment memory p = _settleRows(deployer, o);
        UnicaStockSettlementExecutor x = UnicaStockSettlementExecutor(o.executor);
        console.log("PLAN transactions: 3");
        console.log("PLAN tx 1  executor.createOrder(merchant, key, amountIn, floor, now + 1 day, deployer, salt)");
        console.log("PLAN tx 2  TSLA.approve(executor, amountIn)  -- exactly the order's input");
        console.log("PLAN tx 3  executor.pay(orderId)");
        console.log("PLAN order merchant", o.merchant);
        console.log("PLAN order raw TSLA in", uint256(o.amountIn));
        console.log("PLAN order raw uTUSD floor", uint256(p.minOut));

        vm.startBroadcast(deployer);
        orderId =
            x.createOrder(o.merchant, p.key, o.amountIn, p.minOut, uint64(block.timestamp + WINDOW), deployer, o.salt);
        IERC20Min(TSLA).approve(o.executor, _approvalAmount(o.amountIn));
        x.pay(orderId);
        vm.stopBroadcast();

        _settlePostRows(deployer, o, p, orderId);
    }

    function _settlePostRows(address deployer, Order memory o, Payment memory p, bytes32 orderId) internal {
        uint256 delivered = IERC20Min(o.payout).balanceOf(o.merchant) - p.merchantBefore;
        UnicaStockSettlementExecutor x = UnicaStockSettlementExecutor(o.executor);
        _row(uint8(x.orders(orderId).status) == uint8(T.Status.Settled), "the order is Settled");
        _row(delivered >= p.minOut, "the merchant received at least the floor");
        _row(_word(o.hook, "receiptCount()") == p.receiptsBefore + 1, "exactly one new receipt");
        _row(IERC20Min(TSLA).allowance(deployer, o.executor) == 0, "no standing TSLA allowance remains");
        _row(
            p.tslaBefore - IERC20Min(TSLA).balanceOf(deployer) == o.amountIn,
            "the deployer's TSLA fell by exactly the order's input"
        );
        _gate();
        console.log("ORDER_ID");
        console.logBytes32(orderId);
        console.log("delivered (raw uTUSD)", delivered);
    }

    function _settleRows(address deployer, Order memory o) internal returns (Payment memory p) {
        _chainRows(deployer);
        _payoutRows(o.payout, deployer);
        _pairRows(o.hook, o.payout);
        _row(_word(o.executor, "HOOK()") == uint256(uint160(o.hook)), "the executor is the one this hook names");
        _row(o.merchant != address(0) && o.merchant != deployer, "the merchant is a separate, non-zero address");
        _row(o.amountIn > 0 && o.amountIn <= 1e18, "the payment is between 1 wei and 1 TSLA");
        p.tslaBefore = IERC20Min(TSLA).balanceOf(deployer);
        _row(p.tslaBefore >= o.amountIn, "the deployer holds enough TSLA");

        p.key = _key(o.payout, o.hook);
        (uint160 sqrtPrice,,,) = STATE_VIEW.getSlot0(p.key.toId());
        _row(sqrtPrice != 0, "the guarded pool is initialised");
        uint256 spotOut = sqrtPrice == 0 ? 0 : _spotOut(o.payout, sqrtPrice, o.amountIn);
        p.minOut = uint128((spotOut * MIN_OUT_BPS) / 10_000);
        _row(p.minOut > 0, "the floor is non-zero");
        // Necessary, not sufficient: every uTUSD the PoolManager holds belongs to pools of this token,
        // and this experiment creates one. A reserve below the floor cannot pay it; a reserve above it
        // can still fall short on price impact, which the hook's floor then refuses on chain.
        _row(
            IERC20Min(o.payout).balanceOf(address(POOL_MANAGER)) >= p.minOut,
            "the pool's payout reserve covers the order's floor"
        );
        _gate();
        console.log("spot output (raw uTUSD)", spotOut);
        p.merchantBefore = IERC20Min(o.payout).balanceOf(o.merchant);
        p.receiptsBefore = _word(o.hook, "receiptCount()");
    }

    // ── test seams. No-ops here; a test harness overrides them to inject the failures the rows
    //    exist to catch. Nothing in a real run reaches anything but these empty bodies. ──────────

    /// @dev Between the hook and the executor. A harness bumps the deployer's nonce here to stand in
    ///      for an interloping transaction, so the prediction-mismatch row can be seen to fire.
    function _afterHook(address) internal virtual {}

    /// @dev After the seed. A harness moves the deployer's TSLA here, so the payout-only row fires.
    function _afterSeed(address) internal virtual {}

    /// @dev The TSLA approval for a payment. A harness returns more than the order's input, so the
    ///      no-standing-allowance row fires.
    function _approvalAmount(uint128 amountIn) internal virtual returns (uint256) {
        return amountIn;
    }

    // ── pre-flight rows shared by the stages ──────────────────────────────────────────────────

    function _chainRows(address deployer) internal {
        _row(block.chainid == CHAIN_ID, "the endpoint reports chain 46630, and nothing else is accepted");
        _row(
            address(POOL_MANAGER).code.length == POOL_MANAGER_RUNTIME_BYTES,
            "the PoolManager is the official 24,009-byte build"
        );
        _row(TSLA.code.length > 0, "the faucet TSLA contract has code");
        _row(deployer.balance > 0, "the deployer holds gas");
        console.log("PLAN chain id ", block.chainid);
        console.log("PLAN block    ", block.number);
        console.log("PLAN deployer ", deployer);
        console.log("PLAN nonce    ", uint256(vm.getNonce(deployer)));
        console.log("PLAN wei      ", deployer.balance);
        console.log("PLAN raw TSLA ", TSLA.code.length > 0 ? IERC20Min(TSLA).balanceOf(deployer) : 0);
        console.log("PLAN TSLA     ", TSLA);
    }

    /// @dev Reads go through `_word`, never a typed call. A typed call to the wrong address — the
    ///      input token pasted where the payout token belongs, say — reverts inside the pre-flight
    ///      and the owner sees forge's "Failed to decode return value" instead of the row that names
    ///      the mistake. Measured in this script's own negative control on 2026-09-10.
    function _payoutRows(address payout, address deployer) internal {
        _row(payout.code.length > 0, "the payout token exists");
        _row(payout != TSLA, "the payout token is not the input token");
        _row(_word(payout, "MINTER()") == uint256(uint160(deployer)), "the payout token's minter is this deployer");
        _row(_word(payout, "decimals()") == 6, "the payout token has six decimals");
        console.log("PLAN payout   ", payout);
    }

    function _pairRows(address hook, address payout) internal {
        _row(hook.code.length > 0, "the hook exists");
        _row(uint160(hook) & Hooks.ALL_HOOK_MASK == FLAGS, "the hook address carries exactly 0x20C0");
        _row(_word(hook, "INPUT_CURRENCY()") == uint256(uint160(TSLA)), "the hook binds TSLA as input");
        _row(_word(hook, "PAYOUT_CURRENCY()") == uint256(uint160(payout)), "the hook binds this payout token");
    }

    /// @dev One 32-byte word from a zero-argument view, or type(uint256).max when the call fails or
    ///      returns something else. max is a value none of the rows above ever expects, so a failed
    ///      read can only ever produce a FAIL row, never a false PASS.
    function _word(address target, string memory sig) internal view returns (uint256) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSignature(sig));
        if (!ok || ret.length != 32) return type(uint256).max;
        return abi.decode(ret, (uint256));
    }

    // ── arithmetic ────────────────────────────────────────────────────────────────────────────

    function _tslaIsZero(address payout) internal pure returns (bool) {
        return TSLA < payout;
    }

    function _key(address payout, address hook) internal pure returns (PoolKey memory) {
        (address c0, address c1) = _tslaIsZero(payout) ? (TSLA, payout) : (payout, TSLA);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
    }

    /// @dev A pool prices RAW units (test_A2 in the local suite pins this). One whole TSLA is 1e18
    ///      raw and one whole uTUSD is 1e6 raw, so a rate of P uTUSD per TSLA is P * 1e6 / 1e18 in raw
    ///      token1-per-token0 terms when TSLA is currency0, and its reciprocal when it is currency1.
    function _sqrtPriceFor(address payout, uint256 uTusdPerTsla) internal pure returns (uint160) {
        uint256 ratioX192 = _tslaIsZero(payout)
            ? (uTusdPerTsla << 192) / 1e12  // uTUSD raw per TSLA raw = P / 1e12
            : (uint256(1e12) << 192) / uTusdPerTsla; // TSLA raw per uTUSD raw = 1e12 / P
        uint160 s = uint160(Math.sqrt(ratioX192));
        require(s > TickMath.MIN_SQRT_PRICE && s < TickMath.MAX_SQRT_PRICE, "rate outside the representable range");
        return s;
    }

    /// @dev The position sits entirely on the side a payer's sale moves the price toward, so it holds
    ///      only the payout token: below spot when TSLA is currency0 (selling it lowers the price),
    ///      above spot when TSLA is currency1. Both bounds are aligned to the tick spacing, and the
    ///      bound nearest spot never includes spot, so the mint never asks for TSLA.
    function _position(address payout, uint160 sqrtPrice, uint256 seedWhole)
        internal
        pure
        returns (int24 lower, int24 upper, uint128 liquidity, uint256 seedRaw)
    {
        int24 spot = TickMath.getTickAtSqrtPrice(sqrtPrice);
        int24 floored = spot / TICK_SPACING;
        if (spot < 0 && spot % TICK_SPACING != 0) floored--;
        floored *= TICK_SPACING;
        seedRaw = seedWhole * 1e6;
        // Liquidity is sized from 99.9% of the seed. The PositionManager recomputes the amount owed
        // from the liquidity and rounds UP, and on the currency0 path the two roundings can land one
        // unit above the ceiling it is given — a MaximumAmountExceeded revert over a single raw
        // unit. The 0.1% stays in the deployer's wallet.
        uint256 sized = (seedRaw * 999) / 1000;
        if (_tslaIsZero(payout)) {
            upper = floored;
            lower = upper - RANGE_TICKS;
            liquidity = LiquidityAmounts.getLiquidityForAmount1(
                TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), sized
            );
        } else {
            lower = floored + TICK_SPACING;
            upper = lower + RANGE_TICKS;
            liquidity = LiquidityAmounts.getLiquidityForAmount0(
                TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), sized
            );
        }
        require(lower >= TickMath.MIN_TICK && upper <= TickMath.MAX_TICK, "range outside the tick bounds");
    }

    /// @dev What `amountIn` raw TSLA is worth in raw uTUSD at the pool's own stated price, before fee
    ///      and slippage. Split into two mulDivs so the squared price never overflows.
    function _spotOut(address payout, uint160 sqrtPrice, uint128 amountIn) internal pure returns (uint256) {
        uint256 q96 = 1 << 96;
        if (_tslaIsZero(payout)) {
            return FullMath.mulDiv(FullMath.mulDiv(amountIn, sqrtPrice, q96), sqrtPrice, q96);
        }
        return FullMath.mulDiv(FullMath.mulDiv(amountIn, q96, sqrtPrice), q96, sqrtPrice);
    }

    // ── the row ledger ────────────────────────────────────────────────────────────────────────

    function _row(bool ok, string memory what) internal {
        checksRun++;
        if (!ok) checksFailed++;
        console.log(ok ? "  PASS " : "  FAIL ", what);
    }

    /// @dev Reverting is what stops the broadcast: forge sends nothing from a run that reverts.
    function _gate() internal view {
        console.log("checks run:", checksRun, "failed:", checksFailed);
        require(checksFailed == 0, STOPPED);
    }
}
