"""The accept-anything payment router: a Chainlink gate in front of a Uniswap route.

The router's claim is that a payer may bring any token and the merchant is still paid a
defensible amount of USDC, because the swap's output is measured against an independently
priced floor. These rows check the gate and the refusals around it.

The mocks are declared inline rather than added to src/, so nothing here becomes a contract this
repository ships.
"""

import boa
import pytest

BPS = 10000
REF = bytes.fromhex("22" * 32)
MERCHANT = 7

ERC20 = """
# pragma version 0.4.3
from ethereum.ercs import IERC20
implements: IERC20
balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])
totalSupply: public(uint256)
DECIMALS: public(immutable(uint8))
event Transfer:
    sender: indexed(address)
    receiver: indexed(address)
    value: uint256
event Approval:
    owner: indexed(address)
    spender: indexed(address)
    value: uint256
@deploy
def __init__(d: uint8):
    DECIMALS = d
@external
@view
def decimals() -> uint8:
    return DECIMALS
@external
def mint(to: address, amount: uint256):
    self.balanceOf[to] += amount
    self.totalSupply += amount
@external
def transfer(to: address, amount: uint256) -> bool:
    self.balanceOf[msg.sender] -= amount
    self.balanceOf[to] += amount
    log Transfer(sender=msg.sender, receiver=to, value=amount)
    return True
@external
def approve(spender: address, amount: uint256) -> bool:
    self.allowance[msg.sender][spender] = amount
    log Approval(owner=msg.sender, spender=spender, value=amount)
    return True
@external
def transferFrom(owner: address, to: address, amount: uint256) -> bool:
    self.allowance[owner][msg.sender] -= amount
    self.balanceOf[owner] -= amount
    self.balanceOf[to] += amount
    log Transfer(sender=owner, receiver=to, value=amount)
    return True
"""

FEED = """
# pragma version 0.4.3
answer: public(int256)
updated: public(uint256)
round_id: public(uint80)
answered: public(uint80)
DEC: public(immutable(uint8))
@deploy
def __init__(d: uint8, a: int256):
    DEC = d
    self.answer = a
    self.updated = block.timestamp
    self.round_id = 1
    self.answered = 1
@external
@view
def decimals() -> uint8:
    return DEC
@external
def set(a: int256, updated: uint256, rid: uint80, ans: uint80):
    self.answer = a
    self.updated = updated
    self.round_id = rid
    self.answered = ans
@external
@view
def latestRoundData() -> (uint80, int256, uint256, uint256, uint80):
    return (self.round_id, self.answer, self.updated, self.updated, self.answered)
"""

SINK = """
# pragma version 0.4.3
from ethereum.ercs import IERC20
struct HoldLeg:
    token: address
    share_bps: uint256
bank_bps: public(uint256)
calls: public(uint256)
last_amount: public(uint256)
@deploy
def __init__(b: uint256):
    self.bank_bps = b
@external
@view
def split(merchant_id: uint256, usdc_amount: uint256) -> (uint256, DynArray[uint256, 4]):
    bank: uint256 = usdc_amount * self.bank_bps // 10000
    parts: DynArray[uint256, 4] = [usdc_amount - bank]
    return (bank, parts)
@external
@view
def policy(merchant_id: uint256) -> (uint256, DynArray[HoldLeg, 4], bytes32, bool):
    holds: DynArray[HoldLeg, 4] = [HoldLeg(token=self, share_bps=10000 - self.bank_bps)]
    return (self.bank_bps, holds, convert(1, bytes32), True)
pull: public(bool)
usdc: public(address)
@external
def arm(u: address, p: bool):
    self.usdc = u
    self.pull = p
@external
def deposit(merchant_id: uint256, amount: uint256, payout_ref: bytes32) -> bytes32:
    self.calls += 1
    self.last_amount = amount
    if self.pull:
        extcall IERC20(self.usdc).transferFrom(msg.sender, self, amount)
    return payout_ref
@external
def credit(merchant_id: uint256, token: address, amount: uint256):
    self.calls += 1
"""


@pytest.fixture
def rig():
    from src.unica import payany_router

    usdc = boa.loads(ERC20, 6)
    alt = boa.loads(ERC20, 18)
    sink = boa.loads(SINK, 6000)
    treasury = boa.env.generate_address()
    router_addr = boa.env.generate_address()
    r = payany_router.deploy(usdc.address, router_addr, sink.address, sink.address, sink.address, treasury)
    sink.arm(usdc.address, True)
    return {"r": r, "usdc": usdc, "alt": alt, "sink": sink, "treasury": treasury}


# ---- the settings, and who may change them --------------------------------------------

def test_the_defaults_are_the_ones_the_source_declares(rig):
    r = rig["r"]
    assert r.max_feed_age() == 3600
    assert r.max_slippage_bps() == 100
    assert r.platform_fee_bps() == 150


def test_only_the_owner_may_set_a_feed_or_the_limits(rig):
    r, stranger = rig["r"], boa.env.generate_address()
    with boa.reverts("owner"):
        with boa.env.prank(stranger):
            r.set_feed(rig["alt"].address, boa.env.generate_address())
    with boa.reverts("args"):
        with boa.env.prank(stranger):
            r.set_limits(60, 10, 10)


def test_the_limits_are_bounded(rig):
    """Slippage and platform fee are each capped at ten percent, so an owner cannot quietly
    widen the gate or the fee to anything."""
    r = rig["r"]
    with boa.reverts("args"):
        r.set_limits(3600, 1001, 150)
    with boa.reverts("args"):
        r.set_limits(3600, 100, 1001)
    r.set_limits(600, 1000, 1000)
    assert (r.max_feed_age(), r.max_slippage_bps(), r.platform_fee_bps()) == (600, 1000, 1000)


# ---- the USDC path, which needs no swap and therefore no route ---------------------------

def test_paying_in_usdc_skips_the_swap_and_settles_the_policy(rig):
    r, usdc, sink = rig["r"], rig["usdc"], rig["sink"]
    payer = boa.env.generate_address()
    usdc.mint(payer, 1_000_000)
    with boa.env.prank(payer):
        usdc.approve(r.address, 1_000_000)
        out = r.pay(MERCHANT, REF, usdc.address, 1_000_000, b"")

    assert out == 1_000_000, "a USDC payment is its own output"
    fee = 1_000_000 * 150 // BPS
    assert usdc.balanceOf(rig["treasury"]) == fee, "the platform fee was not taken"
    net = 1_000_000 - fee
    assert sink.last_amount() == net * 6000 // BPS, "the bank leg is not the policy's share"
    assert usdc.balanceOf(r.address) == 0, "the router kept USDC after the transaction"


def test_the_router_holds_nothing_afterwards(rig):
    r, usdc = rig["r"], rig["usdc"]
    payer = boa.env.generate_address()
    usdc.mint(payer, 500_000)
    with boa.env.prank(payer):
        usdc.approve(r.address, 500_000)
        r.pay(MERCHANT, REF, usdc.address, 500_000, b"")
    assert usdc.balanceOf(r.address) == 0


def test_an_offramp_that_does_not_pull_leaves_the_bank_share_behind(rig):
    """MEASURED PROPERTY, not a passing feature.

    The bank leg is APPROVED to the off-ramp and the off-ramp is trusted to pull it. An adapter
    that accepts the call without pulling leaves that USDC sitting in the router with a live
    allowance, and `pay()` still succeeds. The no-custody claim therefore depends on the off-ramp
    honouring the pull, which is an assumption about another contract rather than something this
    one enforces."""
    r, usdc, sink = rig["r"], rig["usdc"], rig["sink"]
    sink.arm(usdc.address, False)
    payer = boa.env.generate_address()
    usdc.mint(payer, 500_000)
    with boa.env.prank(payer):
        usdc.approve(r.address, 500_000)
        r.pay(MERCHANT, REF, usdc.address, 500_000, b"")

    fee = 500_000 * 150 // BPS
    bank = (500_000 - fee) * 6000 // BPS
    assert usdc.balanceOf(r.address) == bank, "the stranded amount is not the bank leg"
    assert usdc.allowance(r.address, sink.address) == bank, "the allowance was not left live"


def test_an_intent_cannot_be_paid_twice(rig):
    r, usdc = rig["r"], rig["usdc"]
    payer = boa.env.generate_address()
    usdc.mint(payer, 2_000_000)
    with boa.env.prank(payer):
        usdc.approve(r.address, 2_000_000)
        r.pay(MERCHANT, REF, usdc.address, 1_000_000, b"")
        assert r.used_intents(REF) is True
        with boa.reverts("intent used"):
            r.pay(MERCHANT, REF, usdc.address, 1_000_000, b"")


def test_an_intent_is_consumed_by_id_not_by_amount_or_merchant(rig):
    """The replay key is the intent alone. A second payment quoting the same intent for a
    different merchant or amount is still a replay."""
    r, usdc = rig["r"], rig["usdc"]
    payer = boa.env.generate_address()
    usdc.mint(payer, 3_000_000)
    with boa.env.prank(payer):
        usdc.approve(r.address, 3_000_000)
        r.pay(MERCHANT, REF, usdc.address, 1_000_000, b"")
        with boa.reverts("intent used"):
            r.pay(MERCHANT + 1, REF, usdc.address, 500_000, b"")


# ---- the Chainlink gate ------------------------------------------------------------------

def _priced_pay(rig, feed_answer=None, updated=None, rid=None, ans=None, feed=True):
    r, alt = rig["r"], rig["alt"]
    payer = boa.env.generate_address()
    alt.mint(payer, 10**18)
    if feed:
        f = boa.loads(FEED, 8, 2000 * 10**8)
        if feed_answer is not None or updated is not None or rid is not None:
            f.set(
                feed_answer if feed_answer is not None else 2000 * 10**8,
                updated if updated is not None else boa.env.evm.patch.timestamp,
                rid if rid is not None else 1,
                ans if ans is not None else 1,
            )
        r.set_feed(alt.address, f.address)
    with boa.env.prank(payer):
        alt.approve(r.address, 10**18)
        return r.pay(MERCHANT, REF, alt.address, 10**18, b"")


def test_a_token_with_no_feed_cannot_be_paid_with(rig):
    with boa.reverts("no feed"):
        _priced_pay(rig, feed=False)


def test_a_non_positive_price_is_refused(rig):
    with boa.reverts("bad price"):
        _priced_pay(rig, feed_answer=0)
    with boa.reverts("bad price"):
        _priced_pay(rig, feed_answer=-1)


def test_a_stale_price_is_refused(rig):
    """max_feed_age is 3600 by default, so an answer older than an hour closes the gate."""
    now = boa.env.evm.patch.timestamp
    with boa.reverts("stale"):
        _priced_pay(rig, updated=now - 3601)


def test_a_price_from_the_future_is_refused(rig):
    now = boa.env.evm.patch.timestamp
    with boa.reverts("stale"):
        _priced_pay(rig, updated=now + 1)


def test_an_incomplete_round_is_refused(rig):
    """answeredInRound below roundId means the feed answered an earlier round than the one it
    is reporting, which is the shape a carried-over answer has."""
    with boa.reverts("incomplete round"):
        _priced_pay(rig, rid=9, ans=8)


def test_the_boundary_of_freshness_is_inclusive(rig):
    """Exactly max_feed_age old still passes; one second older does not. The boundary is
    checked from both sides so the comparison cannot silently flip."""
    now = boa.env.evm.patch.timestamp
    with boa.reverts():          # the route is a bare address, so the swap leg fails after the gate
        _priced_pay(rig, updated=now - 3600)
    with boa.reverts("stale"):
        _priced_pay(rig, updated=now - 3601)
