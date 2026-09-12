// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// TEST ONLY. Local tokens here are tAST and uUSD, a local test dollar. They are not, and are never
// labelled as, any real world stablecoin.

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {DirectSettlement} from "../../src/unica-v5/DirectSettlement.sol";
import {IDirectSettlement} from "../../src/unica-v5/IDirectSettlement.sol";
import {UnicaMarketTypes} from "../../src/unica-v4/UnicaMarketTypes.sol";
import {CreditingAsset, ReenteringAsset} from "../unica-v4/fixtures/HostileTokens.sol";

import {LocalEnsV2Fixture} from "../../src/identity/LocalEnsV2Fixture.sol";
import {TerminalAdmission} from "../../src/identity/TerminalAdmission.sol";
import {RegistryDouble} from "../identity/util/RegistryDouble.sol";

/// @title ShortDeliveringAsset, the token that hands over less than it was asked to move
/// @notice The six tokens in `test/unica-v4/fixtures/HostileTokens.sol` all skim inside `transfer`,
///         because the market executor's shortfall hazard bites on the leg that pays the pool. A
///         direct settlement never calls `transfer` at all: it moves the money with one
///         `transferFrom` from the customer straight to the business. The same hazard therefore
///         needs a `transferFrom` shaped token, which is what this is, and it is armed per row so
///         the control and the refusal differ by one switch and nothing else.
contract ShortDeliveringAsset is MockERC20 {
    uint256 public feeBps;

    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function arm(uint256 bps) external {
        feeBps = bps;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        uint256 fee = (amount * feeBps) / 10_000;
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount - fee;
            balanceOf[address(0xdead)] += fee;
        }
        return true;
    }
}

/// @title FalseReturningAsset, the token that says no by answering `false`
contract FalseReturningAsset is MockERC20 {
    constructor(string memory n, string memory s, uint8 d) MockERC20(n, s, d) {}

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @title DirectSettlementTest
/// @notice A same asset sale settles with one transfer, from the one customer it is bound to, to
///         the one business address it froze, for exactly the amount it names, once. Every row
///         below is one way that sentence could be false, and every refusal is asserted by its
///         exact error and arguments beside a passing control on the same settler.
contract DirectSettlementTest is Test {
    // Redeclared with the exact signatures the settler emits, so `vm.expectEmit` can match them:
    // Solidity cannot reference another contract's event by qualified name.
    event DirectReceipt(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed payer,
        address asset,
        uint256 amount,
        bytes32 terminalNode,
        uint64 settledAt
    );
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed payer,
        uint128 amount,
        uint64 deadline,
        bytes32 terminalNode
    );
    event OrderCreatorSet(address indexed creator, bool allowed);

    MockERC20 internal uusd; // a local test dollar, 6 decimals
    DirectSettlement internal settler;

    address internal admin = makeAddr("admin");
    address internal register = makeAddr("register"); // the allowlisted order creator
    address internal business = makeAddr("business");
    address internal customer = makeAddr("customer");
    address internal stranger = makeAddr("stranger");

    uint128 internal constant AMOUNT = 25_000_000; // 25.00 uUSD
    uint64 internal DEADLINE;

    function setUp() public {
        DEADLINE = uint64(block.timestamp + 1 days);

        uusd = new MockERC20("Unica test dollar", "uUSD", 6);
        settler = new DirectSettlement(address(uusd), admin);

        vm.prank(admin);
        settler.setOrderCreator(register, true);

        uusd.mint(customer, 1_000_000_000);
        vm.prank(customer);
        uusd.approve(address(settler), type(uint256).max);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    function _create(bytes32 salt) internal returns (bytes32 orderId) {
        vm.prank(register);
        orderId = settler.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, salt);
    }

    /// @dev Derived here from the documented expression rather than read back from the settler, so
    ///      the row proves the derivation and not merely that the contract agrees with itself.
    function _expectedOrderId(address creator, bytes32 salt) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(settler), creator, salt));
    }

    /// @dev Puts a hostile token's code under a fresh settler, funded and approved, so a row can
    ///      run its control and its attack against the same shape as every other row.
    function _settlerFor(address token) internal returns (DirectSettlement s) {
        s = new DirectSettlement(token, admin);
        vm.prank(admin);
        s.setOrderCreator(register, true);
        MockERC20(token).mint(customer, 1_000_000_000);
        vm.prank(customer);
        MockERC20(token).approve(address(s), type(uint256).max);
    }

    // ── 1. control: the happy path, and what the receipt says ───────────────────────────────────

    function test_HappyPath_ReceiptFields() public {
        bytes32 salt = keccak256("register-1/sale-1");
        bytes32 expected = _expectedOrderId(register, salt);

        vm.expectEmit(true, true, true, true, address(settler));
        emit OrderCreated(expected, business, customer, AMOUNT, DEADLINE, salt);
        bytes32 orderId = _create(salt);
        assertEq(orderId, expected, "orderId must match the documented derivation");
        assertEq(settler.orderCount(), 1);

        uint256 customerBefore = uusd.balanceOf(customer);

        vm.expectEmit(true, true, true, true, address(settler));
        emit DirectReceipt(orderId, business, customer, address(uusd), AMOUNT, salt, uint64(block.timestamp));
        vm.prank(customer);
        settler.pay(orderId);

        assertEq(uusd.balanceOf(business), AMOUNT, "the business receives exactly the amount");
        assertEq(uusd.balanceOf(customer), customerBefore - AMOUNT, "the customer pays exactly the amount");
        assertEq(uusd.balanceOf(address(settler)), 0, "the settler never holds the money");

        UnicaMarketTypes.Order memory order = settler.orders(orderId);
        assertEq(order.recipient, business);
        assertEq(order.creator, register);
        assertEq(order.payer, customer);
        assertEq(order.amountIn, AMOUNT);
        assertEq(order.minOut, AMOUNT, "minOut equals amountIn on a same asset sale");
        assertEq(order.deadline, DEADLINE);
        assertEq(uint8(order.status), uint8(UnicaMarketTypes.OrderStatus.Settled));
        assertEq(settler.terminalNodeOf(orderId), salt, "the receipt names the register that raised the sale");
    }

    // ── 2. only the bound customer can pay ──────────────────────────────────────────────────────

    function test_WrongPayer_Refused() public {
        bytes32 orderId = _create(keccak256("sale-2"));

        uusd.mint(stranger, AMOUNT);
        vm.prank(stranger);
        uusd.approve(address(settler), type(uint256).max);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IDirectSettlement.WrongPayer.selector, orderId, customer, stranger));
        settler.pay(orderId);

        assertEq(uusd.balanceOf(business), 0, "nothing is delivered on a refused payment");
        assertEq(uint8(settler.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Open));

        // control: the bound customer pays the very same sale
        vm.prank(customer);
        settler.pay(orderId);
        assertEq(uusd.balanceOf(business), AMOUNT);
    }

    // ── 3. a sale settles once ──────────────────────────────────────────────────────────────────

    function test_Replay_Refused() public {
        bytes32 orderId = _create(keccak256("sale-3"));
        vm.prank(customer);
        settler.pay(orderId);

        vm.prank(customer);
        vm.expectRevert(
            abi.encodeWithSelector(
                IDirectSettlement.OrderNotOpen.selector, orderId, uint8(UnicaMarketTypes.OrderStatus.Settled)
            )
        );
        settler.pay(orderId);

        assertEq(uusd.balanceOf(business), AMOUNT, "the business is paid once, not twice");
    }

    // ── 4. expiry ───────────────────────────────────────────────────────────────────────────────

    function test_Expired_Refused() public {
        bytes32 orderId = _create(keccak256("sale-4"));

        // The deadline itself is still payable; one second past it is not.
        vm.warp(DEADLINE + 1);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(IDirectSettlement.OrderExpired.selector, orderId, DEADLINE));
        settler.pay(orderId);
        assertEq(uusd.balanceOf(business), 0);

        // control: the same sale, at the deadline second, settles
        vm.warp(DEADLINE);
        vm.prank(customer);
        settler.pay(orderId);
        assertEq(uusd.balanceOf(business), AMOUNT);
    }

    // ── 5. an id nobody raised ──────────────────────────────────────────────────────────────────

    function test_UnknownOrder_Refused() public {
        bytes32 ghost = keccak256("no such sale");
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(IDirectSettlement.UnknownOrder.selector, ghost));
        settler.pay(ghost);
    }

    // ── 6. only an allowlisted register raises a sale ───────────────────────────────────────────

    function test_NotOrderCreator_Refused() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IDirectSettlement.NotOrderCreator.selector, stranger));
        settler.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("sale-6"));
        assertEq(settler.orderCount(), 0);

        // control: the allowlisted register raises the identical sale
        _create(keccak256("sale-6"));
        assertEq(settler.orderCount(), 1);
    }

    // ── 7. there is nothing to convert, so the two amounts must agree ───────────────────────────

    function test_MinOutNotEqualAmountIn_Refused() public {
        vm.prank(register);
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.MinOutNotEqualAmountIn.selector, AMOUNT, AMOUNT - 1));
        settler.createOrder(business, customer, AMOUNT, AMOUNT - 1, DEADLINE, keccak256("sale-7a"));

        vm.prank(register);
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.MinOutNotEqualAmountIn.selector, AMOUNT, AMOUNT + 1));
        settler.createOrder(business, customer, AMOUNT, AMOUNT + 1, DEADLINE, keccak256("sale-7b"));

        // control: equal amounts are admitted
        _create(keccak256("sale-7c"));
        assertEq(settler.orderCount(), 1);
    }

    // ── 8. a sale for nothing is not a sale ─────────────────────────────────────────────────────

    function test_ZeroAmount_Refused() public {
        vm.prank(register);
        vm.expectRevert(IDirectSettlement.ZeroAmount.selector);
        settler.createOrder(business, customer, 0, 0, DEADLINE, keccak256("sale-8"));
    }

    // ── 9. a fee on transfer token is refused, and nothing is delivered ─────────────────────────

    function test_FeeOnTransfer_Refused_NothingDelivered() public {
        ShortDeliveringAsset token = new ShortDeliveringAsset("Short", "SHRT", 6);
        DirectSettlement s = _settlerFor(address(token));

        // control, with the skim off: the sale settles and the business is paid in full.
        vm.prank(register);
        bytes32 control = s.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("sale-9-control"));
        vm.prank(customer);
        s.pay(control);
        assertEq(token.balanceOf(business), AMOUNT, "control: the whole amount arrives");

        // the one switch: a 1% fee taken out of the very same transfer.
        token.arm(100);
        vm.prank(register);
        bytes32 orderId = s.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("sale-9"));

        uint256 businessBefore = token.balanceOf(business);
        uint256 customerBefore = token.balanceOf(customer);
        uint256 delivered = AMOUNT - (uint256(AMOUNT) * 100) / 10_000;

        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(IDirectSettlement.DeliveryNotExact.selector, AMOUNT, delivered));
        s.pay(orderId);

        assertEq(token.balanceOf(business), businessBefore, "nothing is delivered");
        assertEq(token.balanceOf(customer), customerBefore, "and nothing is taken");
        assertEq(uint8(s.orders(orderId).status), uint8(UnicaMarketTypes.OrderStatus.Open), "the sale is still open");
    }

    // ── 10. a token that over delivers is refused too ───────────────────────────────────────────

    function test_SurplusDelivery_Refused() public {
        CreditingAsset token = new CreditingAsset("Crediting", "CRD", 6);
        DirectSettlement s = _settlerFor(address(token));
        // `CreditingAsset` credits the address it was told is the executor; here the surplus is
        // aimed at the business, which is the only party a direct settlement ever credits.
        token.setTarget(business, address(0));

        vm.prank(register);
        bytes32 control = s.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("sale-10-control"));
        vm.prank(customer);
        s.pay(control);
        assertEq(token.balanceOf(business), AMOUNT, "control: exactly the amount arrives");

        token.arm(CreditingAsset.When.OnPull, 7);
        vm.prank(register);
        bytes32 orderId = s.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("sale-10"));

        vm.prank(customer);
        vm.expectRevert(
            abi.encodeWithSelector(IDirectSettlement.DeliveryNotExact.selector, AMOUNT, uint256(AMOUNT) + 7)
        );
        s.pay(orderId);
        assertEq(token.balanceOf(business), AMOUNT, "the surplus never lands");
    }

    // ── 11. a token that calls back in is refused by the latch ──────────────────────────────────

    function test_ReentrantToken_Refused() public {
        ReenteringAsset token = new ReenteringAsset("Reentering", "REEN", 6);
        DirectSettlement s = _settlerFor(address(token));

        // A second sale, whose customer is the token itself, funded and approved, so that nothing
        // but the latch can refuse it. A reentry that `WrongPayer` would have caught anyway proves
        // nothing about the latch.
        token.mint(address(token), 1_000_000_000);
        vm.prank(address(token));
        token.approve(address(s), type(uint256).max);
        vm.prank(register);
        bytes32 second =
            s.createOrder(makeAddr("business2"), address(token), AMOUNT, AMOUNT, DEADLINE, keccak256("sale-11-second"));

        vm.prank(register);
        bytes32 first = s.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("sale-11-first"));

        token.arm(address(s), second);
        vm.prank(customer);
        s.pay(first);

        assertFalse(token.reentrantCallSucceeded(), "the reentrant payment must not succeed");
        assertEq(
            token.lastError(),
            abi.encodeWithSelector(DirectSettlement.Reentered.selector),
            "the latch, by name, not some later disagreement"
        );
        assertEq(
            uint8(s.orders(second).status), uint8(UnicaMarketTypes.OrderStatus.Open), "the second sale is untouched"
        );
        assertEq(uint8(s.orders(first).status), uint8(UnicaMarketTypes.OrderStatus.Settled));
        assertEq(token.balanceOf(business), AMOUNT);
    }

    // ── 12. a token that answers `false` is a refusal, not a success ────────────────────────────

    function test_TokenAnsweringFalse_Refused() public {
        FalseReturningAsset token = new FalseReturningAsset("False", "FLS", 6);
        DirectSettlement s = _settlerFor(address(token));

        vm.prank(register);
        bytes32 orderId = s.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("sale-12"));
        vm.prank(customer);
        vm.expectRevert(IDirectSettlement.TransferFailed.selector);
        s.pay(orderId);
        assertEq(token.balanceOf(business), 0);
    }

    // ── 13. the admin's only power, and who does not have it ────────────────────────────────────

    function test_StrangerCannotSetOrderCreator() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.NotAdmin.selector, stranger));
        settler.setOrderCreator(stranger, true);
        assertFalse(settler.isOrderCreator(stranger));

        // even the allowlisted register cannot allowlist itself further
        vm.prank(register);
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.NotAdmin.selector, register));
        settler.setOrderCreator(stranger, true);

        // control: the admin can, and can take it back again
        vm.expectEmit(true, true, true, true, address(settler));
        emit OrderCreatorSet(stranger, true);
        vm.prank(admin);
        settler.setOrderCreator(stranger, true);
        assertTrue(settler.isOrderCreator(stranger));

        vm.prank(admin);
        settler.setOrderCreator(register, false);
        vm.prank(register);
        vm.expectRevert(abi.encodeWithSelector(IDirectSettlement.NotOrderCreator.selector, register));
        settler.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, keccak256("sale-13"));
    }

    // ── 14. the settlement id is stable, and specific to this settler ───────────────────────────

    function test_SettlementId_Stable() public {
        bytes32 expected = keccak256(abi.encode("unica-v5/direct", block.chainid, address(settler), address(uusd)));
        assertEq(settler.SETTLEMENT_ID(), expected, "the id must match the documented derivation");

        bytes32 before = settler.SETTLEMENT_ID();
        bytes32 orderId = _create(keccak256("sale-14"));
        vm.prank(customer);
        settler.pay(orderId);
        vm.warp(block.timestamp + 30 days);
        vm.roll(block.number + 1000);
        assertEq(settler.SETTLEMENT_ID(), before, "settling a sale does not move the id");

        // A second settler on the very same asset is a different settlement id, so evidence from
        // one can never be read as evidence from the other.
        DirectSettlement other = new DirectSettlement(address(uusd), admin);
        assertTrue(other.SETTLEMENT_ID() != settler.SETTLEMENT_ID(), "two settlers, two ids");
        assertEq(settler.MARKET_ID(), settler.SETTLEMENT_ID());
        assertEq(settler.ASSET_TOKEN(), address(uusd));
        assertEq(settler.PAYOUT_TOKEN(), address(uusd));
    }

    // ── 15. the same salt cannot raise two sales ────────────────────────────────────────────────

    function test_SameSaltTwice_Refused() public {
        bytes32 salt = keccak256("sale-15");
        bytes32 orderId = _create(salt);
        vm.prank(register);
        vm.expectRevert(abi.encodeWithSelector(DirectSettlement.OrderExists.selector, orderId));
        settler.createOrder(business, customer, AMOUNT, AMOUNT, DEADLINE, salt);
    }

    // ── 16. end to end: admitted by the register's ENS authority, then paid ─────────────────────

    function test_AdmissionThroughTerminalAdmission_ThenPay() public {
        (
            LocalEnsV2Fixture ens,
            TerminalAdmission admission,
            RegistryDouble registryDouble,
            bytes32 businessNode,
            bytes32 chair1Node,
            address operator,
            address payoutAddr
        ) = _buildIdentityTree();

        // The registry has never heard of a direct settler, so its own admin puts it on the gate's
        // list. Without that, the very same call is refused as an unregistered executor.
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.ExecutorNotRegistered.selector, address(settler)));
        admission.requestOrder(
            businessNode,
            chair1Node,
            keccak256("unica-identity-fixture-v1"),
            address(settler),
            payoutAddr,
            customer,
            AMOUNT,
            AMOUNT,
            DEADLINE,
            keccak256("sale-16")
        );

        vm.mockCall(address(registryDouble), abi.encodeWithSignature("admin()"), abi.encode(admin));
        vm.prank(admin);
        admission.setDirectSettler(address(settler), true);
        assertTrue(admission.isDirectSettler(address(settler)));

        // The gate is the settler's order creator, so nobody else can raise a sale on it.
        vm.prank(admin);
        settler.setOrderCreator(address(admission), true);
        vm.prank(admin);
        settler.setOrderCreator(register, false);

        vm.prank(operator);
        bytes32 orderId = admission.requestOrder(
            businessNode,
            chair1Node,
            keccak256("unica-identity-fixture-v1"),
            address(settler),
            payoutAddr,
            customer,
            AMOUNT,
            AMOUNT,
            DEADLINE,
            keccak256("sale-16")
        );

        UnicaMarketTypes.Order memory order = settler.orders(orderId);
        assertEq(order.recipient, payoutAddr, "the business address is frozen from the ENS addr record");
        assertEq(order.creator, address(admission));

        // Moving the ENS record afterwards cannot move the money.
        address moved = makeAddr("moved payout");
        vm.prank(ens.ownerOf(businessNode));
        ens.setAddr(businessNode, moved);

        vm.prank(customer);
        settler.pay(orderId);
        assertEq(uusd.balanceOf(payoutAddr), AMOUNT, "paid to the address frozen at admission");
        assertEq(uusd.balanceOf(moved), 0, "and not to the address the record now names");
    }

    // ── 17. a revoked register cannot admit a direct sale ───────────────────────────────────────

    function test_RevokedRegister_CannotAdmitDirectSale() public {
        (
            LocalEnsV2Fixture ens,
            TerminalAdmission admission,
            RegistryDouble registryDouble,
            bytes32 businessNode,
            bytes32 chair1Node,
            address operator,
            address payoutAddr
        ) = _buildIdentityTree();
        // The one switch: the business pulls the register's authority and marks it revoked, exactly
        // as a lost register is handled. Everything else is the tree row 16 admits through.
        address owner = ens.ownerOf(businessNode);
        vm.startPrank(owner);
        ens.authorizeTextRoles(chair1Node, "com.unica.terminal-status", operator, false);
        ens.setText(chair1Node, "com.unica.terminal-status", "revoked");
        vm.stopPrank();

        vm.mockCall(address(registryDouble), abi.encodeWithSignature("admin()"), abi.encode(admin));
        vm.prank(admin);
        admission.setDirectSettler(address(settler), true);
        vm.prank(admin);
        settler.setOrderCreator(address(admission), true);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(TerminalAdmission.TerminalNotAuthorized.selector, chair1Node, operator));
        admission.requestOrder(
            businessNode,
            chair1Node,
            keccak256("unica-identity-fixture-v1"),
            address(settler),
            payoutAddr,
            customer,
            AMOUNT,
            AMOUNT,
            DEADLINE,
            keccak256("sale-17")
        );
        assertEq(settler.orderCount(), 0, "no sale was raised");
    }

    /// @dev The barbershop tree, one business with one register. `_buildIdentityTree` returns the
    ///      REVOKED register for row 17 by revoking it there; row 16 gets the live one. Kept as one
    ///      helper because the two rows need the identical tree and differ only in that revocation.
    function _buildIdentityTree()
        internal
        returns (
            LocalEnsV2Fixture ens,
            TerminalAdmission admission,
            RegistryDouble registryDouble,
            bytes32 businessNode,
            bytes32 chair1Node,
            address operator,
            address payoutAddr
        )
    {
        address owner = makeAddr("businessOwner");
        payoutAddr = makeAddr("businessPayout");
        operator = makeAddr("registerOperator");

        ens = new LocalEnsV2Fixture();
        bytes32 ethNode = ens.createRoot("eth");
        bytes32 unicaNode = ens.register(ethNode, "unica", address(this));
        businessNode = ens.register(unicaNode, "freshcuts", owner);

        vm.startPrank(owner);
        ens.setAddr(businessNode, payoutAddr);
        bytes32 registersNode = ens.register(businessNode, "terminals", owner);
        chair1Node = ens.register(registersNode, "chair-1", owner);
        ens.authorizeTextRoles(chair1Node, "com.unica.terminal-status", operator, true);
        ens.setText(chair1Node, "com.unica.terminal-status", "active");
        vm.stopPrank();

        registryDouble = new RegistryDouble();
        admission = new TerminalAdmission(
            address(ens),
            address(registryDouble),
            keccak256("unica-identity-fixture-v1"),
            address(0),
            "com.unica.terminal-status"
        );
    }
}
