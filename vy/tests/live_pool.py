"""The one settled order, as numbers.

Every value here is read from the repository's own README row for the live pool and the live
settlement, and none of it is copied from another agent's summary. It is restated here so the
model has something outside itself to disagree with.
"""

Q96 = 1 << 96
MIN_SQRT_PRICE = 4295128739

# The pool at the moment of the settlement.
SQRT_PRICE_X96 = 3961408125713216879677197
LIQUIDITY = 204325880000
FEE_PIPS = 3000

# The settlement itself.
AMOUNT_IN = 1000000000000000
OBSERVED_AMOUNT_OUT = 2003660

# Decimals of the two currencies of the live pool.
INPUT_DECIMALS = 18
PAYOUT_DECIMALS = 6

# A target the price cannot reach, which is what a full-range position with the router's own
# price limit amounts to: the step exhausts the input instead of stopping at a tick.
NO_CROSSING_TARGET = MIN_SQRT_PRICE + 1


def mul_div(a: int, b: int, d: int) -> int:
    return (a * b) // d


def mul_div_up(a: int, b: int, d: int) -> int:
    n = a * b
    return n // d + (1 if n % d else 0)


def reference_exact_in(sqrt_current, liquidity, amount_in, fee_pips):
    """Python integers, arbitrary precision, written from the published description of the
    pool's single-range exact-input step. The oracle the Vyper is checked against."""
    less_fee = mul_div(amount_in, 1_000_000 - fee_pips, 1_000_000)
    numerator1 = liquidity << 96
    product = less_fee * sqrt_current
    denominator = numerator1 + product
    sqrt_next = mul_div_up(numerator1, sqrt_current, denominator)
    amount_out = mul_div(liquidity, sqrt_current - sqrt_next, Q96)
    return sqrt_next, less_fee, amount_out
