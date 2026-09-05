# pragma version 0.4.3
"""
@title egg_eater
@license MIT
@notice Decimals, and where precision goes. Dasypeltis swallows the egg whole, absorbs no more than
        its gut can take, and regurgitates the crushed shell. An 18-decimal input is swallowed
        whole; the 6-decimal payout grid absorbs no more than it can hold; the sub-unit remainder is
        expelled and stays with the pool. This module names that remainder instead of letting it
        disappear into a rounding mode.
@dev    UNICA's live pool is native ETH (18 decimals) against USDC (6 decimals). The pool's
        output amount is floor(liquidity * (sqrt_current - sqrt_next) / Q96); everything the
        floor discards is the shell.
        Design and analysis alone. Nothing here is deployed and nothing here ships.
"""

Q96: public(constant(uint256)) = 79228162514264337593543950336

struct Shed:
    absorbed: uint256
    shell_numerator: uint256
    shell_denominator: uint256


@internal
@pure
def _mul_div(a: uint256, b: uint256, d: uint256) -> uint256:
    # The 18-by-6-decimal quantities this module handles are far inside 256 bits, so the plain
    # product is exact here and a wrap would revert rather than lie. bushmaster.vy carries the
    # 512-bit form for the places that need it.
    return (a * b) // d


@external
@pure
def shed(liquidity: uint256, sqrt_next: uint256, sqrt_current: uint256) -> Shed:
    """
    @notice The output the pool pays, and the fraction of one payout unit it does not.
    @dev `absorbed` is the integer count of payout units credited -- micro-USDC, six decimals.
         `shell_numerator / shell_denominator` is the exact fraction of one further unit that
         the pool's floor threw away. The shell is not lost from the system: it stays inside
         the pool, so it accrues to the liquidity, never to the payer and never to the merchant.
         A settlement is therefore always rounded AGAINST the party being paid, by strictly less
         than one payout unit.
    """
    assert sqrt_current >= sqrt_next, "shed: price did not fall"
    assert liquidity < 2**128, "shed: liquidity is not uint128"
    numerator: uint256 = liquidity * (sqrt_current - sqrt_next)
    return Shed(
        absorbed=numerator // Q96,
        shell_numerator=numerator % Q96,
        shell_denominator=Q96,
    )


@external
@pure
def input_units_per_payout_unit(sqrt_price: uint256) -> uint256:
    """
    @notice How many 18-decimal input units one 6-decimal payout unit is worth at the spot price.
    @dev The quantisation floor of the whole settlement. The spot ratio payout-per-input is
         (sqrt_price / Q96) ** 2, so its reciprocal is Q96**2 / sqrt_price**2, computed as two
         floors, which is the same value as one floor of the whole.
         Any input strictly smaller than this cannot move the payout by even one unit, so on the
         payout side it is indistinguishable from paying nothing. This is the number that says
         how large the 12-decimal gap between the two currencies actually is at THIS price.
    """
    assert sqrt_price > 0, "unit price: zero price"
    return self._mul_div(Q96, Q96, sqrt_price) // sqrt_price


@external
@pure
def rescale(amount: uint256, from_decimals: uint8, to_decimals: uint8) -> uint256:
    """
    @notice Moving a quantity between decimal grids, which the settlement path NEVER does.
    @dev Present so the model can state the negative. Every comparison on the settlement path is
         within one currency: the full-fill gate compares an input amount to an input amount,
         and both minimum gates compare a payout amount to a payout amount. No line of the
         settlement compares an 18-decimal number to a 6-decimal one, so no scale factor is ever
         applied and no scale factor can be wrong. This function exists to be the thing that is
         NOT called, and its own truncation on a downward rescale shows what would be lost if it
         ever were.
    """
    assert from_decimals <= 36 and to_decimals <= 36, "rescale: implausible decimals"
    if from_decimals == to_decimals:
        return amount
    if from_decimals > to_decimals:
        return amount // (10 ** convert(from_decimals - to_decimals, uint256))
    return amount * (10 ** convert(to_decimals - from_decimals, uint256))
