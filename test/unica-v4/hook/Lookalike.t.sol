// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {HookSalt} from "../../../src/unica-v4/HookSalt.sol";

import {UnicaMarketTypes} from "../../../src/unica-v4/UnicaMarketTypes.sol";
import {UnicaMarketRegistry} from "../../../src/unica-v4/UnicaMarketRegistry.sol";
import {UnicaMarketExecutor} from "../../../src/unica-v4/UnicaMarketExecutor.sol";
import {UnicaMarketHook} from "../../../src/unica-v4/UnicaMarketHook.sol";
import {UnicaV4TestBase} from "../util/UnicaV4TestBase.sol";

/// @title S1 — the look-alike, and the only rule that tells it apart
/// @notice Anyone can deploy this exact hook source through their own factory and registry and emit
///         receipts that look official (SC §3, C6). Nothing prevents it and nothing should: what a
///         consumer relies on is the reverse lookup on the OFFICIAL registry, and this row is the
///         demonstration that the lookup answers zero for the impostor and the real id for the real
///         market.
contract LookalikeTest is UnicaV4TestBase {
    bytes32 internal constant RECEIPT_TOPIC = keccak256(
        "SettlementReceipt(bytes32,address,address,bytes32,address,address,uint128,uint128,uint24,uint24,uint24,uint24,uint256,uint8,uint64,bool)"
    );

    UnicaMarketRegistry internal attackerRegistry;
    Market internal official;
    Market internal lookalike;

    address internal attacker = makeAddr("attacker");
    address internal officialCreator = makeAddr("official creator");

    function setUp() public {
        setUpBase();

        official = deployMarket(defaultSpec());
        registry.setOrderCreator(officialCreator, true);

        // The attacker's whole arrangement: their own registry, their own factory path, the SAME hook
        // creation code out of this tree. `admin` is the attacker; the deployer plays their factory,
        // exactly as this test plays the official one.
        // The attacker runs their own admin and their own factory, which here is this deployer —
        // the same relationship the official side has, standing on nothing the official side granted.
        attackerRegistry = new UnicaMarketRegistry(address(this), false);
        vm.label(address(attackerRegistry), "attacker registry");
        lookalike = deployMarketOn(attackerRegistry, defaultSpec());

        attackerRegistry.setOrderCreator(attacker, true);
    }

    function test_S1_aLookalikeSettlesAndTheOfficialRegistryDisownsIt() public {
        // It really works: the impostor settles a payment and emits a receipt of its own.
        uint128 amountIn = 1e18;
        vm.prank(attacker);
        bytes32 orderId = lookalike.executor
        .createOrder(merchant, payer, amountIn, 1, uint64(block.timestamp + 1 hours), "lookalike");
        fundPayer(lookalike, payer, amountIn);

        vm.recordLogs();
        vm.prank(payer);
        lookalike.executor.pay(orderId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(countLogs(logs, address(lookalike.hook), RECEIPT_TOPIC), 1, "the lookalike did not receipt");
        bytes32 claimedMarketId = _receiptMarketId(logs, address(lookalike.hook));
        assertEq(claimedMarketId, lookalike.marketId, "the receipt did not carry the id its hook was built with");

        // THE RULE. On the official registry, every reverse lookup answers zero for the impostor's
        // hook, executor and pool, and its market id is unknown.
        assertEq(registry.marketIdOfHook(address(lookalike.hook)), bytes32(0), "official registry knows its hook");
        assertEq(
            registry.marketIdOfExecutor(address(lookalike.executor)), bytes32(0), "official registry knows its executor"
        );
        assertEq(registry.marketIdOfPool(lookalike.hook.POOL_ID()), bytes32(0), "official registry knows its pool");
        assertEq(registry.statusOf(claimedMarketId), 0, "official registry knows its market id");

        // The control, on the same three lookups: the real market answers with its own id.
        assertEq(registry.marketIdOfHook(address(official.hook)), official.marketId, "hook lookup");
        assertEq(registry.marketIdOfExecutor(address(official.executor)), official.marketId, "executor lookup");
        assertEq(registry.marketIdOfPool(official.hook.POOL_ID()), official.marketId, "pool lookup");
        assertEq(
            registry.getMarket(official.marketId).hook,
            address(official.hook),
            "the emitter check would reject the real hook"
        );
    }

    /// @dev A hook can be BUILT carrying the official market id — the id is a constructor argument and
    ///      nothing stops an attacker choosing it. What it cannot do is appear in the official
    ///      registry's reverse lookups, which is the whole authentication rule and the reason a
    ///      consumer never keys on `marketId` alone.
    function test_S1b_aHookCarryingTheOfficialIdIsStillDisowned() public {
        MarketSpec memory spec = defaultSpec();
        (address assetAddr, address payoutAddr) = peekTokens(spec.assetIsCurrency0);
        address forged = _deployHookWithId(official.marketId, assetAddr, payoutAddr, spec);

        assertEq(registry.marketIdOfHook(forged), bytes32(0), "a forged id bought a registry entry");
        assertEq(
            registry.getMarket(official.marketId).hook, address(official.hook), "the record still names the real hook"
        );
        assertTrue(forged != address(official.hook), "the forgery landed on the real hook's address");
    }

    /// @notice The other half of C6: the impostor's executor does not inherit the official allowlist.
    function test_S1c_theLookalikeRefusesTheOfficialCreator() public {
        vm.prank(officialCreator);
        vm.expectRevert(abi.encodeWithSelector(UnicaMarketExecutor.NotOrderCreator.selector, officialCreator));
        lookalike.executor.createOrder(merchant, payer, 1e18, 1, uint64(block.timestamp + 1 hours), "cross");

        // Control: the same creator is accepted on the official market.
        vm.prank(officialCreator);
        bytes32 ok = official.executor.createOrder(merchant, payer, 1e18, 1, uint64(block.timestamp + 1 hours), "own");
        assertEq(official.executor.orders(ok).creator, officialCreator, "the official market refused its own creator");
    }

    // ---- helpers ------------------------------------------------------------------------------------

    /// @dev Builds a hook whose `MARKET_ID` is a value it was simply handed. It is a complete,
    ///      working hook at a properly mined address — just not one anybody registered.
    function _deployHookWithId(bytes32 forgedId, address assetAddr, address payoutAddr, MarketSpec memory spec)
        private
        returns (address)
    {
        bytes memory args = abi.encode(
            manager,
            address(attackerRegistry),
            forgedId,
            assetAddr,
            payoutAddr,
            spec.fee,
            spec.tickSpacing,
            spec.assetDecimals,
            spec.payoutDecimals
        );
        (, bytes32 salt) = HookSalt.find(address(this), HOOK_FLAGS, type(UnicaMarketHook).creationCode, args);
        UnicaMarketHook forged = new UnicaMarketHook{salt: salt}(
            manager,
            address(attackerRegistry),
            forgedId,
            assetAddr,
            payoutAddr,
            spec.fee,
            spec.tickSpacing,
            spec.assetDecimals,
            spec.payoutDecimals
        );
        assertEq(forged.MARKET_ID(), forgedId, "the forgery does not carry the official id");
        return address(forged);
    }

    function _receiptMarketId(Vm.Log[] memory logs, address hook) private pure returns (bytes32 marketId) {
        int256 at = indexOfLog(logs, hook, RECEIPT_TOPIC);
        require(at >= 0, "no receipt");
        marketId = abi.decode(logs[uint256(at)].data, (bytes32));
    }
}
