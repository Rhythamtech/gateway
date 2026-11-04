from decimal import ROUND_CEILING, ROUND_HALF_EVEN, Decimal

MICROCREDITS = 1_000_000
MAX_AMOUNT = 9_000_000_000_000_000_000


def to_microcredits(value: Decimal) -> int:
    scaled = value * MICROCREDITS
    if not value.is_finite() or scaled != scaled.to_integral_value():
        raise ValueError("Credits support at most six decimal places")
    amount = int(scaled)
    if not 0 < amount <= MAX_AMOUNT:
        raise ValueError("Credits must be positive and within the supported range")
    return amount


def format_credits(amount: int) -> str:
    return format(Decimal(amount) / MICROCREDITS, ".6f")


def calculate_credit_charge(tokens: int, rate: int, *, reserve: bool = False) -> int:
    if tokens < 0 or rate <= 0:
        raise ValueError("Tokens must be nonnegative and the rate must be positive")
    rounding = ROUND_CEILING if reserve else ROUND_HALF_EVEN
    amount = int(
        (Decimal(tokens) * MICROCREDITS * MICROCREDITS / rate).to_integral_value(
            rounding=rounding
        )
    )
    if amount > MAX_AMOUNT:
        raise ValueError("Calculated charge exceeds the supported range")
    return amount
