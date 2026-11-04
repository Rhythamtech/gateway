// Shared credit arithmetic, mirroring `docs/credits.md`: amounts are decimal
// strings with at most six fractional digits and every calculation runs on
// scaled integers (1 credit = 1,000,000 microcredits) — never floating point.

const MICRO = 1_000_000n
const TOKEN_SCALE = 1_000_000_000_000n

export const CREDIT_MAX_CREDITS = 9_000_000_000_000
export const CREDIT_MAX_TOKENS_PER_CREDIT = 1_000_000_000
export const CREDIT_MAX_REQUEST_TOKENS = 10_000_000
export const CREDIT_MAX_FRACTION_DIGITS = 6
export const CREDIT_REASON_MAX_LENGTH = 1000
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128

export type AmountValidation =
  | { valid: true; microcredits: bigint; normalized: string }
  | { valid: false; error: string }

export type TokenCeilingValidation =
  { valid: true; tokens: number } | { valid: false; error: string }

export type SimpleValidation = { valid: true } | { valid: false; error: string }

function amountToMicrocredits(value: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) return null
  const [whole, fraction = ""] = value.split(".")
  const padded = `${fraction}000000`.slice(0, 6)
  return BigInt(whole) * MICRO + BigInt(padded)
}

function normalizeMicrocredits(microcredits: bigint): string {
  const whole = microcredits / MICRO
  const fraction = `${microcredits % MICRO}`.padStart(6, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

function validateAmount(
  raw: string,
  maxMicro: bigint,
  unit: string
): AmountValidation {
  const value = raw.trim()
  const microcredits = amountToMicrocredits(value)
  if (microcredits === null) {
    return {
      valid: false,
      error: `Enter a positive ${unit} amount with at most six decimal places.`,
    }
  }
  if (microcredits === 0n) {
    return {
      valid: false,
      error: `The ${unit} amount must be greater than zero.`,
    }
  }
  if (microcredits > maxMicro) {
    return {
      valid: false,
      error: `The ${unit} amount must be at most ${maxMicro / MICRO}.`,
    }
  }
  return {
    valid: true,
    microcredits,
    normalized: normalizeMicrocredits(microcredits),
  }
}

export function validateCreditAmount(raw: string): AmountValidation {
  return validateAmount(raw, BigInt(CREDIT_MAX_CREDITS) * MICRO, "credit")
}

export function validateTokensPerCredit(raw: string): AmountValidation {
  return validateAmount(
    raw,
    BigInt(CREDIT_MAX_TOKENS_PER_CREDIT) * MICRO,
    "tokens-per-credit"
  )
}

export function validateTokenCeiling(
  raw: string,
  max: number
): TokenCeilingValidation {
  const value = raw.trim()
  if (!/^\d+$/.test(value)) {
    return { valid: false, error: "Enter whole tokens only." }
  }
  const tokens = Number(value)
  const maxLabel = max.toLocaleString("en-US")
  if (!Number.isSafeInteger(tokens) || tokens > max) {
    return { valid: false, error: `Token counts must be at most ${maxLabel}.` }
  }
  if (tokens === 0) {
    return { valid: false, error: "Token counts must be greater than zero." }
  }
  return { valid: true, tokens }
}

export function validateIdempotencyKey(raw: string): SimpleValidation {
  const value = raw.trim()
  if (
    value.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    value.length > IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    return {
      valid: false,
      error: `Idempotency keys must be ${IDEMPOTENCY_KEY_MIN_LENGTH}–${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
    }
  }
  return { valid: true }
}

export function generateIdempotencyKey(): string {
  return "crypto" in globalThis && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `credit-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e12).toString(36)}-${Math.floor(Math.random() * 1e12).toString(36)}`
}

/** Thousand-grouped exact display for a backend decimal string; over-contract inputs render unmodified rather than rounded. */
export function formatCredits(raw: string): string {
  const value = raw.trim()
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value
  const negative = value.startsWith("-")
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ""] = unsigned.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  let rendered = grouped
  if (fraction.length > CREDIT_MAX_FRACTION_DIGITS) {
    rendered = `${grouped}.${fraction}`
  } else {
    const trimmed = fraction.replace(/0+$/, "")
    if (trimmed) rendered = `${grouped}.${trimmed}`
  }
  return negative ? `-${rendered}` : rendered
}

export function isZeroCredits(raw: string): boolean {
  return amountToMicrocredits(raw.trim()) === 0n
}

function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  const twice = remainder * 2n
  if (twice > denominator) return quotient + 1n
  if (twice < denominator) return quotient
  return quotient % 2n === 0n ? quotient : quotient + 1n
}

/** `(input + output) ÷ tokens per credit`, half-even to six decimals — the backend's settlement arithmetic. */
export function calculateChargePreview(
  inputTokens: number,
  outputTokens: number,
  tokensPerCredit: string
): string | null {
  const rate = amountToMicrocredits(tokensPerCredit.trim())
  if (rate === null || rate <= 0n) return null
  if (
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0
  ) {
    return null
  }
  const tokens = BigInt(inputTokens + outputTokens) * TOKEN_SCALE
  return normalizeMicrocredits(roundHalfEven(tokens, rate))
}

/** The whole-allowance admission hold, rounded upward like the backend reservation. */
export function calculateHoldPreview(
  maxRequestTokens: number,
  tokensPerCredit: string
): string | null {
  const rate = amountToMicrocredits(tokensPerCredit.trim())
  if (rate === null || rate <= 0n) return null
  if (!Number.isSafeInteger(maxRequestTokens) || maxRequestTokens < 0)
    return null
  const tokens = BigInt(maxRequestTokens) * TOKEN_SCALE
  return normalizeMicrocredits((tokens + rate - 1n) / rate)
}

const USAGE_STATUS_LABELS: Record<string, string> = {
  reserved: "Reserved",
  dispatched: "Dispatched",
  usage_recorded: "Usage recorded",
  needs_review: "Needs review",
  settled: "Settled",
  released: "Released",
}

export function usageStatusLabel(status: string): string {
  return USAGE_STATUS_LABELS[status] ?? status
}

const UNFINALIZED_STATUSES = [
  "reserved",
  "dispatched",
  "usage_recorded",
  "needs_review",
]

/** Unsettled statuses keep a zero charge as "Not finalized"; terminal zero is a real zero. */
export function chargeDisplayedText(
  status: string,
  chargedCredits: string
): string {
  if (UNFINALIZED_STATUSES.includes(status) && isZeroCredits(chargedCredits)) {
    return "Not finalized"
  }
  return formatCredits(chargedCredits)
}

/** A 404 from a rate read means the model has no rate yet — a setup state, not a lookup failure. */
export function isMissingRateError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 404
  )
}
