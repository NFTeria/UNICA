# pragma version 0.4.3
"""
@title rattler
@license MIT
@notice The two minimum-out gates. A rattle is a refusal issued BEFORE contact, and there are
        two of them on the settlement path, at different distances from the money. This module
        holds both and reports WHICH one fired -- which is the whole point, because a token can
        satisfy one and fail the other.
@dev    Gate one is inside the swap: the pool's CREDIT in currency1, measured from the swapper's
        balance delta, against the order's minOut. Gate two is after the router returns: the
        RECIPIENT'S REALISED balance change, against the same minOut. Between them stands the
        token's own transfer, which is free to deliver less than the credit.
        Design and analysis alone. Nothing here is deployed and nothing here ships.
"""

BOTH_PASS: public(constant(uint8)) = 0
POOL_CREDIT_SHORT: public(constant(uint8)) = 1
RECIPIENT_SHORT: public(constant(uint8)) = 2

struct GateVerdict:
    settles: bool
    reason: uint8
    min_out: uint256
    pool_credit: uint256
    realised: uint256
    withheld: uint256


@internal
@pure
def _credit_from_delta(delta_amount1: int256) -> uint256:
    """
    @notice What the in-swap gate measures: the pool's currency1 credit to the swapper.
    @dev A non-positive delta is read as zero rather than as an error, so a swap that credited
         nothing is compared against the minimum like any other and refused there. The source is
         an int128.
    """
    assert delta_amount1 < 2**127, "credit: source is not an int128"
    assert delta_amount1 > -(2**127), "credit: source is not an int128"
    if delta_amount1 <= 0:
        return 0
    return convert(delta_amount1, uint256)


@internal
@pure
def _realised(balance_before: uint256, balance_after: uint256) -> uint256:
    """
    @notice What the post-router gate measures: how much the recipient's balance actually grew.
    @dev A balance that did not grow counts as nothing received. The clamp is what makes this
         subtraction safe: a recipient whose balance FELL during the call (a rebasing token, a
         token that charged the holder) yields zero, not an underflow, and zero fails any
         non-zero minimum.
    """
    if balance_after > balance_before:
        return balance_after - balance_before
    return 0


@external
@pure
def credit_from_delta(delta_amount1: int256) -> uint256:
    return self._credit_from_delta(delta_amount1)


@external
@pure
def realised(balance_before: uint256, balance_after: uint256) -> uint256:
    return self._realised(balance_before, balance_after)


@external
@pure
def verdict(
    min_out: uint256, delta_amount1: int256, balance_before: uint256, balance_after: uint256
) -> GateVerdict:
    """
    @notice Both gates over one settlement, in the order they run.
    @dev `withheld` is the gap the token opened between what the pool credited and what the
         recipient received: zero for a plain ERC-20, positive for a fee-on-transfer token. The
         case the second gate exists for is `pool_credit >= min_out and realised < min_out`,
         which is reachable for any positive `withheld` and is reported as RECIPIENT_SHORT.
    """
    credit: uint256 = self._credit_from_delta(delta_amount1)
    got: uint256 = self._realised(balance_before, balance_after)
    gap: uint256 = 0
    if credit > got:
        gap = credit - got

    if credit < min_out:
        return GateVerdict(
            settles=False,
            reason=POOL_CREDIT_SHORT,
            min_out=min_out,
            pool_credit=credit,
            realised=got,
            withheld=gap,
        )
    if got < min_out:
        return GateVerdict(
            settles=False,
            reason=RECIPIENT_SHORT,
            min_out=min_out,
            pool_credit=credit,
            realised=got,
            withheld=gap,
        )
    return GateVerdict(
        settles=True,
        reason=BOTH_PASS,
        min_out=min_out,
        pool_credit=credit,
        realised=got,
        withheld=gap,
    )


@external
@pure
def fee_on_transfer_delivery(credit: uint256, fee_bps: uint256) -> uint256:
    """
    @notice A fee-on-transfer token's delivery: the credit less a proportional fee, rounded the
            way such tokens round -- down, in the token's favour.
    """
    assert fee_bps <= 10_000, "fee_on_transfer: bps out of range"
    return credit - (credit * fee_bps) // 10_000
