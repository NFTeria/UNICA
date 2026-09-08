# pragma version 0.4.3
# Accept-anything payment router.
#   1. pull token_in from payer
#   2. execute swap calldata built off-chain by the Uniswap Trading API
#      (routing V4_HOOKS_INCLUSIVE, recipient = this contract)
#   3. refuse unless USDC received >= Chainlink-priced minimum
#   4. split per merchant policy: bank share -> off-ramp adapter, holds -> vault
# No custody beyond the transaction. Fails closed on stale or deviant prices.

from ethereum.ercs import IERC20

interface IFeed:
    def latestRoundData() -> (uint80, int256, uint256, uint256, uint80): view
    def decimals() -> uint8: view

interface IPolicy:
    def split(merchant_id: uint256, usdc_amount: uint256) -> (uint256, DynArray[uint256, 4]): view
    def policy(merchant_id: uint256) -> (uint256, DynArray[HoldLeg, 4], bytes32, bool): view

interface IOffRamp:
    def deposit(merchant_id: uint256, amount: uint256, payout_ref: bytes32) -> bytes32: nonpayable

interface IVault:
    def credit(merchant_id: uint256, token: address, amount: uint256): nonpayable

struct HoldLeg:
    token: address
    share_bps: uint256

USDC: public(immutable(address))
UNIVERSAL_ROUTER: public(immutable(address))
POLICY: public(immutable(IPolicy))
OFFRAMP: public(immutable(IOffRamp))
VAULT: public(immutable(IVault))

feeds: public(HashMap[address, IFeed])          # token -> USD feed
max_feed_age: public(uint256)
max_slippage_bps: public(uint256)
platform_fee_bps: public(uint256)
platform_treasury: public(address)
owner: public(address)
used_intents: public(HashMap[bytes32, bool])
locked: bool

event Paid:
    merchant_id: indexed(uint256)
    intent_id: indexed(bytes32)
    payer: indexed(address)
    token_in: address
    amount_in: uint256
    usdc_out: uint256
    to_bank: uint256
    platform_fee: uint256


@deploy
def __init__(usdc: address, universal_router: address, policy: address, offramp: address, vault: address, treasury: address):
    USDC = usdc
    UNIVERSAL_ROUTER = universal_router
    POLICY = IPolicy(policy)
    OFFRAMP = IOffRamp(offramp)
    VAULT = IVault(vault)
    self.platform_treasury = treasury
    self.owner = msg.sender
    self.max_feed_age = 3600
    self.max_slippage_bps = 100
    self.platform_fee_bps = 150


@external
def set_feed(token: address, feed: address):
    assert msg.sender == self.owner, "owner"
    self.feeds[token] = IFeed(feed)


@external
def set_limits(max_age: uint256, slippage_bps: uint256, fee_bps: uint256):
    assert msg.sender == self.owner and slippage_bps <= 1000 and fee_bps <= 1000, "args"
    self.max_feed_age = max_age
    self.max_slippage_bps = slippage_bps
    self.platform_fee_bps = fee_bps


@internal
@view
def _usd_value(token: address, amount: uint256) -> uint256:
    # returns 6-decimal USD (USDC units)
    f: IFeed = self.feeds[token]
    assert f.address != empty(address), "no feed"
    round_id: uint80 = 0
    answer: int256 = 0
    started: uint256 = 0
    updated: uint256 = 0
    answered: uint80 = 0
    round_id, answer, started, updated, answered = staticcall f.latestRoundData()
    assert answer > 0, "bad price"
    assert updated <= block.timestamp and block.timestamp - updated <= self.max_feed_age, "stale"
    assert answered >= round_id, "incomplete round"
    fd: uint8 = staticcall f.decimals()
    td: uint8 = staticcall IERC20Metadata(token).decimals()
    return amount * convert(answer, uint256) * 10**6 // 10**convert(fd, uint256) // 10**convert(td, uint256)


interface IERC20Metadata:
    def decimals() -> uint8: view


@external
def pay(merchant_id: uint256, intent_id: bytes32, token_in: address, amount_in: uint256, swap_calldata: Bytes[4096]) -> uint256:
    assert not self.locked, "reentrant"
    self.locked = True
    assert not self.used_intents[intent_id], "intent used"
    self.used_intents[intent_id] = True

    assert extcall IERC20(token_in).transferFrom(msg.sender, self, amount_in, default_return_value=True), "pull"

    before: uint256 = staticcall IERC20(USDC).balanceOf(self)
    usdc_out: uint256 = 0
    if token_in == USDC:
        usdc_out = amount_in
    else:
        min_out: uint256 = self._usd_value(token_in, amount_in)
        min_out = min_out - min_out * self.max_slippage_bps // 10000
        assert extcall IERC20(token_in).approve(UNIVERSAL_ROUTER, amount_in, default_return_value=True), "approve"
        raw_call(UNIVERSAL_ROUTER, swap_calldata)          # API-built V4 route, recipient=self
        assert extcall IERC20(token_in).approve(UNIVERSAL_ROUTER, 0, default_return_value=True), "unapprove"
        after: uint256 = staticcall IERC20(USDC).balanceOf(self)
        usdc_out = after - before
        assert usdc_out >= min_out, "oracle gate"

    fee: uint256 = usdc_out * self.platform_fee_bps // 10000
    net: uint256 = usdc_out - fee
    if fee > 0:
        assert extcall IERC20(USDC).transfer(self.platform_treasury, fee, default_return_value=True), "fee"

    bank: uint256 = 0
    parts: DynArray[uint256, 4] = []
    bank, parts = staticcall POLICY.split(merchant_id, net)
    bank_bps: uint256 = 0
    holds: DynArray[HoldLeg, 4] = []
    payout_ref: bytes32 = empty(bytes32)
    active: bool = False
    bank_bps, holds, payout_ref, active = staticcall POLICY.policy(merchant_id)

    if bank > 0:
        assert extcall IERC20(USDC).approve(OFFRAMP.address, bank, default_return_value=True), "approve bank"
        extcall OFFRAMP.deposit(merchant_id, bank, payout_ref)
    for i: uint256 in range(len(parts), bound=4):
        if parts[i] == 0:
            continue
        # USDC is credited to the vault tagged with the target coin; the vault
        # converts on its own schedule via the same API route. Keeps pay() atomic.
        assert extcall IERC20(USDC).transfer(VAULT.address, parts[i], default_return_value=True), "vault"
        extcall VAULT.credit(merchant_id, holds[i].token, parts[i])

    log Paid(merchant_id=merchant_id, intent_id=intent_id, payer=msg.sender, token_in=token_in, amount_in=amount_in, usdc_out=usdc_out, to_bank=bank, platform_fee=fee)
    self.locked = False
    return usdc_out