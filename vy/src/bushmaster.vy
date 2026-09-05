# pragma version 0.4.3
"""
@title bushmaster
@license MIT
@notice The measuring module. Lachesis muta -- the bushmaster -- carries the name of the Fate
        who MEASURES the thread; this is the one module in the model that PRODUCES a number
        from the curve rather than judging a number handed to it. Everything else in vy/ takes
        bushmaster's output and decides whether a settlement may stand.
@dev    A model of the constant-product concentrated-liquidity step a Uniswap v4 pool performs
        inside one tick range, written from the published description of that arithmetic, for
        the direction UNICA actually swaps: currency0 in, currency1 out (zeroForOne), which is
        the sole direction SettlementExecutor ever asks for. This is NOT a deployment target
        and NOT a second implementation of anything. It exists so the settlement arithmetic has
        a second, independent expression that is allowed to DISAGREE with the Solidity.
"""

# Hundredths of a bip. A swap fee of 3000 is 0.30%.
MAX_SWAP_FEE: public(constant(uint256)) = 1_000_000

# Q64.96 fixed point scale.
Q96: public(constant(uint256)) = 79228162514264337593543950336

# The lowest representable sqrt price in v4. A swap that never wants to stop at a tick passes
# MIN_SQRT_PRICE + 1 as its target, which for a full-range position means "no crossing".
MIN_SQRT_PRICE: public(constant(uint256)) = 4295128739

struct SwapStep:
    sqrt_price_next: uint256
    amount_in: uint256
    amount_out: uint256
    fee_amount: uint256


@internal
@pure
def _mul_div(a: uint256, b: uint256, d: uint256) -> uint256:
    """
    @notice floor(a * b / d) computed over the full 512-bit product, so an intermediate that
            does not fit in 256 bits is not an error and not a wrap.
    @dev Written from the published description of the 512-bit division method: recover the high
         word with a mulmod against 2**256 - 1, subtract the true remainder so the 512-bit
         numerator is exactly divisible, strip the factors of two so the divisor is odd, then
         invert the odd divisor modulo 2**256 by Newton iteration and multiply. The result is
         exact whenever it fits in 256 bits, and the assert is the single place it can fail.
    """
    assert d != 0, "mul_div: zero denominator"

    mm: uint256 = uint256_mulmod(a, b, max_value(uint256))
    prod0: uint256 = unsafe_mul(a, b)
    prod1: uint256 = unsafe_sub(unsafe_sub(mm, prod0), convert(mm < prod0, uint256))

    if prod1 == 0:
        return unsafe_div(prod0, d)

    assert d > prod1, "mul_div: quotient overflows 256 bits"

    remainder: uint256 = uint256_mulmod(a, b, d)
    p1: uint256 = unsafe_sub(prod1, convert(remainder > prod0, uint256))
    p0: uint256 = unsafe_sub(prod0, remainder)

    # Largest power of two dividing d.
    twos: uint256 = d & unsafe_sub(0, d)
    odd_d: uint256 = unsafe_div(d, twos)
    p0 = unsafe_div(p0, twos)

    # 2**256 / twos, which is 0 when twos is 1 -- exactly the shift that carries no bits down.
    carry: uint256 = unsafe_add(unsafe_div(unsafe_sub(0, twos), twos), 1)
    p0 = p0 | unsafe_mul(p1, carry)

    # Newton iteration for the inverse of odd_d modulo 2**256: four correct bits, then doubling.
    inv: uint256 = unsafe_mul(3, odd_d) ^ 2
    for _: uint256 in range(6):
        inv = unsafe_mul(inv, unsafe_sub(2, unsafe_mul(odd_d, inv)))

    return unsafe_mul(p0, inv)


@internal
@pure
def _mul_div_up(a: uint256, b: uint256, d: uint256) -> uint256:
    result: uint256 = self._mul_div(a, b, d)
    if uint256_mulmod(a, b, d) > 0:
        result += 1
    return result


@internal
@pure
def _div_up(a: uint256, b: uint256) -> uint256:
    assert b != 0, "div_up: zero denominator"
    q: uint256 = a // b
    if a % b > 0:
        q += 1
    return q


@internal
@pure
def _amount0_delta(sqrt_a: uint256, sqrt_b: uint256, liquidity: uint256, round_up: bool) -> uint256:
    """
    @notice The currency0 amount between two sqrt prices for a given liquidity. This is the
            INPUT side of a zeroForOne swap, and the pool rounds it UP against the swapper.
    """
    lo: uint256 = min(sqrt_a, sqrt_b)
    hi: uint256 = max(sqrt_a, sqrt_b)
    assert lo > 0, "amount0: zero price"
    assert liquidity < 2**128, "amount0: liquidity is not uint128"

    numerator1: uint256 = liquidity << 96
    numerator2: uint256 = hi - lo

    if round_up:
        return self._div_up(self._mul_div_up(numerator1, numerator2, hi), lo)
    return self._mul_div(numerator1, numerator2, hi) // lo


@internal
@pure
def _amount1_delta(sqrt_a: uint256, sqrt_b: uint256, liquidity: uint256, round_up: bool) -> uint256:
    """
    @notice The currency1 amount between two sqrt prices for a given liquidity. This is the
            OUTPUT side of a zeroForOne swap, and the pool rounds it DOWN against the swapper.
            The fraction the rounding drops is the subject of egg_eater.vy.
    """
    lo: uint256 = min(sqrt_a, sqrt_b)
    hi: uint256 = max(sqrt_a, sqrt_b)
    assert liquidity < 2**128, "amount1: liquidity is not uint128"

    if round_up:
        return self._mul_div_up(liquidity, hi - lo, Q96)
    return self._mul_div(liquidity, hi - lo, Q96)


@internal
@pure
def _next_sqrt_from_amount0_in(sqrt_p: uint256, liquidity: uint256, amount: uint256) -> uint256:
    """
    @notice The sqrt price after adding `amount` of currency0 to the pool. Rounded UP, which
            moves the price less far down and so pays the swapper LESS -- the pool's direction.
    """
    if amount == 0:
        return sqrt_p
    assert liquidity < 2**128, "next0: liquidity is not uint128"

    numerator1: uint256 = liquidity << 96
    product: uint256 = unsafe_mul(amount, sqrt_p)

    if unsafe_div(product, amount) == sqrt_p:
        denominator: uint256 = unsafe_add(numerator1, product)
        if denominator >= numerator1:
            return self._mul_div_up(numerator1, sqrt_p, denominator)

    # The product or the sum wrapped; fall back to a form that cannot.
    return self._div_up(numerator1, unsafe_add(numerator1 // sqrt_p, amount))


@internal
@pure
def _next_sqrt_from_amount1_out(sqrt_p: uint256, liquidity: uint256, amount: uint256) -> uint256:
    """
    @notice The sqrt price after removing `amount` of currency1 from the pool. Rounded UP so the
            price does not fall further than the withdrawal justifies.
    """
    assert liquidity > 0, "next1: zero liquidity"
    quotient: uint256 = 0
    if amount <= 2**160 - 1:
        quotient = self._div_up(amount << 96, liquidity)
    else:
        quotient = self._mul_div_up(amount, Q96, liquidity)
    assert sqrt_p > quotient, "next1: price underflow"
    return sqrt_p - quotient


@internal
@pure
def _step_exact_in(
    sqrt_current: uint256,
    sqrt_target: uint256,
    liquidity: uint256,
    amount_in_requested: uint256,
    fee_pips: uint256,
) -> SwapStep:
    assert sqrt_current >= sqrt_target, "exact_in: target is not below the price (zeroForOne alone)"
    assert fee_pips < MAX_SWAP_FEE, "exact_in: fee must be under 100%"

    less_fee: uint256 = self._mul_div(amount_in_requested, MAX_SWAP_FEE - fee_pips, MAX_SWAP_FEE)
    to_target: uint256 = self._amount0_delta(sqrt_target, sqrt_current, liquidity, True)

    step: SwapStep = SwapStep(
        sqrt_price_next=0, amount_in=0, amount_out=0, fee_amount=0
    )

    if less_fee >= to_target:
        # The step is capped by the price target: the pool ran out of this range before it ran
        # out of the swapper's input. Less than the whole input is consumed -- a PARTIAL FILL.
        step.amount_in = to_target
        step.sqrt_price_next = sqrt_target
        step.fee_amount = self._mul_div_up(to_target, fee_pips, MAX_SWAP_FEE - fee_pips)
    else:
        # The input is exhausted inside this range: a FULL FILL.
        step.amount_in = less_fee
        step.sqrt_price_next = self._next_sqrt_from_amount0_in(sqrt_current, liquidity, less_fee)
        step.fee_amount = amount_in_requested - less_fee

    step.amount_out = self._amount1_delta(step.sqrt_price_next, sqrt_current, liquidity, False)
    return step


@internal
@pure
def _step_exact_out(
    sqrt_current: uint256,
    sqrt_target: uint256,
    liquidity: uint256,
    amount_out_requested: uint256,
    fee_pips: uint256,
) -> SwapStep:
    assert sqrt_current >= sqrt_target, "exact_out: target is not below the price (zeroForOne alone)"
    assert fee_pips < MAX_SWAP_FEE, "exact_out: fee must be under 100%"

    to_target: uint256 = self._amount1_delta(sqrt_target, sqrt_current, liquidity, False)

    step: SwapStep = SwapStep(
        sqrt_price_next=0, amount_in=0, amount_out=0, fee_amount=0
    )

    if amount_out_requested >= to_target:
        step.amount_out = to_target
        step.sqrt_price_next = sqrt_target
    else:
        step.amount_out = amount_out_requested
        step.sqrt_price_next = self._next_sqrt_from_amount1_out(
            sqrt_current, liquidity, amount_out_requested
        )

    step.amount_in = self._amount0_delta(step.sqrt_price_next, sqrt_current, liquidity, True)
    step.fee_amount = self._mul_div_up(step.amount_in, fee_pips, MAX_SWAP_FEE - fee_pips)
    return step


# --- the measured surface -------------------------------------------------------------------

@external
@pure
def mul_div(a: uint256, b: uint256, d: uint256) -> uint256:
    return self._mul_div(a, b, d)


@external
@pure
def mul_div_up(a: uint256, b: uint256, d: uint256) -> uint256:
    return self._mul_div_up(a, b, d)


@external
@pure
def amount1_out(sqrt_next: uint256, sqrt_current: uint256, liquidity: uint256) -> uint256:
    return self._amount1_delta(sqrt_next, sqrt_current, liquidity, False)


@external
@pure
def next_sqrt_from_amount0_in(sqrt_p: uint256, liquidity: uint256, amount: uint256) -> uint256:
    return self._next_sqrt_from_amount0_in(sqrt_p, liquidity, amount)


@external
@pure
def step_exact_in(
    sqrt_current: uint256,
    sqrt_target: uint256,
    liquidity: uint256,
    amount_in_requested: uint256,
    fee_pips: uint256,
) -> SwapStep:
    return self._step_exact_in(sqrt_current, sqrt_target, liquidity, amount_in_requested, fee_pips)


@external
@pure
def step_exact_out(
    sqrt_current: uint256,
    sqrt_target: uint256,
    liquidity: uint256,
    amount_out_requested: uint256,
    fee_pips: uint256,
) -> SwapStep:
    return self._step_exact_out(sqrt_current, sqrt_target, liquidity, amount_out_requested, fee_pips)
