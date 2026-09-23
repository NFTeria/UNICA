# pragma version 0.4.3
# Zero-capital liquidation via Uniswap v4 flash accounting.
#   unlock -> take USDC -> repay lender -> receive collateral -> swap
#   collateral->USDC in the same manager -> settle -> keep surplus.
# Fails closed: if the swap can't cover the repay, the whole tx reverts and
# the manager never lost a wei. The manager must hold enough USDC to take.

from ethereum.ercs import IERC20

struct PoolKey:
    currency0: address
    currency1: address
    fee: uint24
    tickSpacing: int24
    hooks: address

struct SwapParams:
    zeroForOne: bool
    amountSpecified: int256
    sqrtPriceLimitX96: uint160

struct Job:
    borrower: address
    repay: uint256
    key: PoolKey
    min_profit: uint256

interface IPoolManager:
    def unlock(data: Bytes[1024]) -> Bytes[32]: nonpayable
    def take(currency: address, to: address, amount: uint256): nonpayable
    def sync(currency: address): nonpayable
    def settle() -> uint256: payable
    def swap(key: PoolKey, params: SwapParams, hookData: Bytes[64]) -> int256: nonpayable

interface ILender:
    def liquidate(borrower: address, repay: uint256) -> uint256: nonpayable   # returns collateral seized
    def collateral_token() -> address: view

PM: public(immutable(IPoolManager))
LENDER: public(immutable(ILender))
USDC: public(immutable(address))
COLLATERAL: public(immutable(address))
owner: public(address)
locked: bool

MIN_SQRT: constant(uint160) = 4295128740
MAX_SQRT: constant(uint160) = 1461446703485210103287273052203988822378723970341

event Liquidated:
    borrower: indexed(address)
    repay: uint256
    collateral: uint256
    usdc_out: uint256
    profit: uint256


@deploy
def __init__(pm: address, lender: address, usdc: address):
    PM = IPoolManager(pm)
    LENDER = ILender(lender)
    USDC = usdc
    COLLATERAL = staticcall ILender(lender).collateral_token()
    self.owner = msg.sender


@external
def liquidate(borrower: address, repay: uint256, key: PoolKey, min_profit: uint256) -> uint256:
    assert not self.locked, "reentrant"
    self.locked = True
    assert (key.currency0 == COLLATERAL and key.currency1 == USDC) or (key.currency0 == USDC and key.currency1 == COLLATERAL), "pool"
    job: Job = Job(borrower=borrower, repay=repay, key=key, min_profit=min_profit)
    out: Bytes[32] = extcall PM.unlock(abi_encode(job))
    self.locked = False
    return abi_decode(out, uint256)


@external
def unlockCallback(data: Bytes[1024]) -> Bytes[32]:
    assert msg.sender == PM.address, "pm"
    job: Job = abi_decode(data, Job)

    # 1. take USDC: manager now shows us a negative USDC delta
    extcall PM.take(USDC, self, job.repay)

    # 2. repay the borrower's debt, receive collateral
    assert extcall IERC20(USDC).approve(LENDER.address, job.repay, default_return_value=True), "approve"
    seized: uint256 = extcall LENDER.liquidate(job.borrower, job.repay)
    assert seized > 0, "nothing seized"

    # 3. swap all collateral -> USDC in the same manager (exact input = negative)
    z4o: bool = job.key.currency0 == COLLATERAL
    limit: uint160 = MAX_SQRT - 1
    if z4o:
        limit = MIN_SQRT + 1
    delta: int256 = extcall PM.swap(
        job.key,
        SwapParams(zeroForOne=z4o, amountSpecified=-convert(seized, int256), sqrtPriceLimitX96=limit),
        b"",
    )
    a0: int256 = delta >> 128
    a1: int256 = delta - (a0 << 128)
    usdc_delta: int256 = a1
    coll_delta: int256 = a0
    if not z4o:
        usdc_delta = a0
        coll_delta = a1
    assert coll_delta < 0 and usdc_delta > 0, "swap dir"
    usdc_out: uint256 = convert(usdc_delta, uint256)

    # 4. settle the collateral we owe
    extcall PM.sync(COLLATERAL)
    assert extcall IERC20(COLLATERAL).transfer(PM.address, seized, default_return_value=True), "pay coll"
    extcall PM.settle()

    # 5. net USDC: +usdc_out from swap, -repay from take. Take the surplus.
    assert usdc_out >= job.repay + job.min_profit, "unprofitable"
    profit: uint256 = usdc_out - job.repay
    extcall PM.take(USDC, self.owner, profit)

    log Liquidated(borrower=job.borrower, repay=job.repay, collateral=seized, usdc_out=usdc_out, profit=profit)
    return abi_encode(profit)