# pragma version 0.4.3
# Per-merchant settlement policy. Bank share goes to the off-ramp adapter as
# USDC; the rest is held in the merchant's chosen coins. Shares sum to 10000.
# Merchant identity is an id, never an EOA the merchant has to manage.

BPS: constant(uint256) = 10000
MAX_HOLD: constant(uint256) = 4

struct HoldLeg:
    token: address       # coin to keep
    share_bps: uint256

struct Policy:
    bank_bps: uint256              # USDC routed to off-ramp
    holds: DynArray[HoldLeg, MAX_HOLD]
    payout_ref: bytes32            # hash of bank instruction held off-chain
    active: bool

policies: HashMap[uint256, Policy]
owner_of: public(HashMap[uint256, address])   # operator key (platform or merchant)
platform: public(address)

event PolicySet:
    merchant_id: indexed(uint256)
    bank_bps: uint256
    payout_ref: bytes32


@deploy
def __init__():
    self.platform = msg.sender


@external
def register(merchant_id: uint256, operator: address, bank_bps: uint256, holds: DynArray[HoldLeg, MAX_HOLD], payout_ref: bytes32):
    assert msg.sender == self.platform, "platform"
    assert self.owner_of[merchant_id] == empty(address), "exists"
    self.owner_of[merchant_id] = operator
    self._set(merchant_id, bank_bps, holds, payout_ref)


@external
def set_policy(merchant_id: uint256, bank_bps: uint256, holds: DynArray[HoldLeg, MAX_HOLD], payout_ref: bytes32):
    assert msg.sender == self.owner_of[merchant_id] or msg.sender == self.platform, "auth"
    self._set(merchant_id, bank_bps, holds, payout_ref)


@internal
def _set(merchant_id: uint256, bank_bps: uint256, holds: DynArray[HoldLeg, MAX_HOLD], payout_ref: bytes32):
    total: uint256 = bank_bps
    for i: uint256 in range(len(holds), bound=MAX_HOLD):
        assert holds[i].token != empty(address), "token"
        total += holds[i].share_bps
    assert total == BPS, "shares"
    if bank_bps > 0:
        assert payout_ref != empty(bytes32), "payout ref"
    self.policies[merchant_id] = Policy(bank_bps=bank_bps, holds=holds, payout_ref=payout_ref, active=True)
    log PolicySet(merchant_id=merchant_id, bank_bps=bank_bps, payout_ref=payout_ref)


@external
@view
def policy(merchant_id: uint256) -> Policy:
    p: Policy = self.policies[merchant_id]
    assert p.active, "inactive"
    return p


@external
@view
def split(merchant_id: uint256, usdc_amount: uint256) -> (uint256, DynArray[uint256, MAX_HOLD]):
    # bank amount first; last hold leg absorbs rounding so parts sum exactly
    p: Policy = self.policies[merchant_id]
    assert p.active, "inactive"
    bank: uint256 = usdc_amount * p.bank_bps // BPS
    parts: DynArray[uint256, MAX_HOLD] = []
    acc: uint256 = bank
    n: uint256 = len(p.holds)
    for i: uint256 in range(n, bound=MAX_HOLD):
        if i + 1 == n:
            parts.append(usdc_amount - acc)
        else:
            x: uint256 = usdc_amount * p.holds[i].share_bps // BPS
            parts.append(x)
            acc += x
    if n == 0:
        bank = usdc_amount
    return (bank, parts)