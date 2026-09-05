# pragma version 0.4.3
"""
@title constrictor
@license MIT
@notice The full-fill rule. A constrictor takes up every millimetre of slack on each exhale and
        never settles for a partial hold: the rule modelled here is EXACT EQUALITY, not "at
        least". A pool that consumed one wei less than the order asked for has not settled it.
@dev    Models V4SettlementHook._afterSwap's opening gate: `consumed` is read from the swapper's
        balance delta in currency0 and compared to the order's amountIn with `!=`.
        Design and analysis alone. Nothing here is deployed and nothing here ships.
"""

# Why the settlement was refused, in the order the gate actually runs.
OK: public(constant(uint8)) = 0
PARTIAL_FILL: public(constant(uint8)) = 1
OVERFILL: public(constant(uint8)) = 2

struct FillVerdict:
    admitted: bool
    reason: uint8
    requested: uint256
    consumed: uint256
    slack: uint256


@internal
@pure
def _consumed_from_delta(delta_amount0: int256) -> uint256:
    """
    @notice What the hook reads as "the pool consumed this much of the order's input".
    @dev The swapper's currency0 delta of an exact-input zeroForOne swap is NEGATIVE: the pool
         took that much from the swapper. The hook negates it and casts to uint128. The source
         is an int128, so the negation is at most 2**127 and the cast to uint128 cannot
         truncate -- the cast is a narrowing that is safe by the width of what feeds it, not by
         a range check. This model asserts that width so the claim is tested, not assumed. The
         bound is inclusive because the one value that reaches it, the minimum int128, negates
         to exactly 2**127 and still fits a uint128.
    """
    assert delta_amount0 <= 0, "consumed: currency0 delta of an input swap is never positive"
    negated: int256 = -delta_amount0
    assert negated <= 2**127, "consumed: source is not an int128"
    return convert(negated, uint256)


@external
@pure
def consumed_from_delta(delta_amount0: int256) -> uint256:
    return self._consumed_from_delta(delta_amount0)


@external
@pure
def verdict(requested: uint256, delta_amount0: int256) -> FillVerdict:
    """
    @notice The numeric meaning of "the pool consumed exactly the order's amountIn".
    @dev A full fill is consumed == requested and slack == 0. A partial fill is any consumed
         strictly below requested; `slack` is then the number of input units the pool left on
         the table, and it is exactly the quantity a partial-fill settlement would have to
         pretend did not exist. An overfill (consumed above requested) is unreachable for an
         exact-input swap but is represented here so the model refuses it rather than assuming
         it away.
    """
    consumed: uint256 = self._consumed_from_delta(delta_amount0)

    if consumed == requested:
        return FillVerdict(
            admitted=True, reason=OK, requested=requested, consumed=consumed, slack=0
        )
    if consumed < requested:
        return FillVerdict(
            admitted=False,
            reason=PARTIAL_FILL,
            requested=requested,
            consumed=consumed,
            slack=requested - consumed,
        )
    return FillVerdict(
        admitted=False,
        reason=OVERFILL,
        requested=requested,
        consumed=consumed,
        slack=consumed - requested,
    )
