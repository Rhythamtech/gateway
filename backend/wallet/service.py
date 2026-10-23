"""Transactional wallet, budget and attempt accounting.

Balance-changing operations run in short ``BEGIN IMMEDIATE`` transactions
(engine-level default) and commit before any network call. Each operation
appends an immutable ledger entry and updates the account balance projection
in the same transaction; ledgers are the source of truth.

Attempt lifecycle (one call per upstream attempt, retries included):

* ``reserve_attempt`` — validates an active wallet that can cover the
  estimated maximum charge and a provider budget that can cover the
  token-unit hold, creates the ``pending`` call trace and holds both amounts.
  Committed before dispatch.
* ``settle_attempt`` — normalizes actual usage, charges the wallet with the
  snapshotted multiplier, debits the provider budget in normalized token
  units, releases unused reservation amounts, finalizes the trace and bumps
  daily aggregates, all in one settlement transaction. Idempotency keys are
  derived from the call trace id so retries, duplicate callbacks, timeouts
  and restarts cannot charge twice.
* ``release_attempt`` — pre-dispatch failure (or expiry reconciliation)
  returns the full reservation without billing.
"""

import json
import logging
from typing import Any
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from backend.auth.models import User
from backend.core.config import settings
from backend.core.database import SessionLocal
from backend.core.errors import GatewayError
from backend.gateway.providers.models import Provider
from backend.traces import service as trace_service
from backend.traces.models import LLMCallTrace, LLMMessageTrace
from backend.traces.service import bump_daily_usage
from backend.wallet.models import (
    APIKeyUsageDaily,
    BILLING_DAILY_COLUMNS,
    GatewayModelUsageDaily,
    ProviderBudgetAccount,
    ProviderBudgetLedger,
    ProviderModelRate,
    ProviderModelUsageDaily,
    ProviderUsageDaily,
    RESERVATION_ACTIVE,
    RESERVATION_RELEASED,
    RESERVATION_SETTLED,
    SystemBudgetAccount,
    SystemBudgetLedger,
    SystemUsageDaily,
    UserUsageDaily,
    UserWallet,
    WALLET_ENTRY_TYPES,
    WALLET_STATUS_ACTIVE,
    WALLET_STATUS_DEBT,
    WalletLedgerEntry,
    WalletReservation,
    WALLET_STATUS_BLOCKED,
)

logger = logging.getLogger(__name__)

SYSTEM_ACCOUNT_ID = 1

# ---------------------------------------------------------------------------
# Token normalization and billing arithmetic (pure functions)
# ---------------------------------------------------------------------------
# Arithmetic helpers over provider-reported usage; see the
# ``billable_token_units``/``user_credits_for_units`` contracts below.

MILLION = 1_000_000
# One normalized token unit == one base user credit; the multiplier (ppm)
# scales it. 1x = 1_000_000, 10x = 10_000_000.
BASE_MULTIPLIER_PPM = 1_000_000

USAGE_SOURCE_REPORTED = "reported"
USAGE_SOURCE_ESTIMATED = "estimated"
USAGE_SOURCE_UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class TokenUsage:
    """Normalized token components; any component may be missing (None)."""

    uncached_input: int | None = None
    cache_read: int | None = None
    cache_write: int | None = None
    output: int | None = None


def _int_or_none(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value >= 0 else None


# ---------------------------------------------------------------------------
# Normalization from provider-shaped usage payloads
# ---------------------------------------------------------------------------


def normalize_openai_usage(usage: dict) -> TokenUsage:
    prompt_details = usage.get("prompt_tokens_details")
    prompt_details = prompt_details if isinstance(prompt_details, dict) else {}
    cached = _int_or_none(prompt_details.get("cached_tokens"))
    prompt = _int_or_none(usage.get("prompt_tokens"))
    completion = _int_or_none(usage.get("completion_tokens"))

    uncached = None
    if prompt is not None:
        uncached = max(0, prompt - (cached or 0))

    return TokenUsage(
        uncached_input=uncached,
        cache_read=cached,
        cache_write=None,  # OpenAI reports no cache writes
        output=completion,
    )


def normalize_anthropic_usage(usage: dict) -> TokenUsage:
    return TokenUsage(
        uncached_input=_int_or_none(usage.get("input_tokens")),
        cache_read=_int_or_none(usage.get("cache_read_input_tokens")),
        cache_write=_int_or_none(usage.get("cache_creation_input_tokens")),
        output=_int_or_none(usage.get("output_tokens")),
    )


def normalize_provider_usage(usage: dict, protocol: str) -> TokenUsage:
    if protocol == "anthropic":
        return normalize_anthropic_usage(usage)
    return normalize_openai_usage(usage)


def sanitize_usage_json(usage: dict, protocol: str) -> str | None:
    """Original provider usage, reduced to known nonnegative token fields."""

    normalized = normalize_provider_usage(usage, protocol)
    sanitized = {
        key: value
        for key, value in {
            "uncached_input_tokens": normalized.uncached_input,
            "cache_read_tokens": normalized.cache_read,
            "cache_write_tokens": normalized.cache_write,
            "output_tokens": normalized.output,
        }.items()
        if value is not None
    }
    return json.dumps(sanitized, separators=(",", ":")) if sanitized else None


def is_fully_reported(usage: TokenUsage) -> bool:
    """True when the provider reported enough tokens to bill from them."""

    return usage.uncached_input is not None and usage.output is not None


def billable_token_units(usage: TokenUsage) -> int | None:
    """uncached_input + cache_read + cache_write + output.

    Missing components are treated as zero once any component is known; a
    completely absent usage yields None (caller decides estimate/unbillable).
    """

    components = (
        usage.uncached_input,
        usage.cache_read,
        usage.cache_write,
        usage.output,
    )
    if all(component is None for component in components):
        return None
    return sum(component or 0 for component in components)


def canonical_input_tokens(usage: TokenUsage) -> int | None:
    """Total input as the sum of the three input components (cache once)."""

    components = (usage.uncached_input, usage.cache_read, usage.cache_write)
    if all(component is None for component in components):
        return None
    return sum(component or 0 for component in components)


def total_cache_tokens(usage: TokenUsage) -> int | None:
    """Total cache traffic (read + write), matching ``cache_tokens``."""

    components = (usage.cache_read, usage.cache_write)
    if all(component is None for component in components):
        return None
    return sum(component or 0 for component in components)


# ---------------------------------------------------------------------------
# Integer billing arithmetic
# ---------------------------------------------------------------------------


def round_div(value: int, scale: int) -> int:
    """Ceiling of ``value / scale`` in integers (heavier side billed)."""

    return -(-value // scale)


def scale_ppm(value: int, ppm: int) -> int:
    """``value * ppm / 1_000_000``, rounded up (ppm may be < or > 1e6)."""

    return round_div(value * ppm, MILLION)


def user_credits_for_units(units: int, multiplier_ppm: int) -> int:
    """ceil(billable_token_units * multiplier_ppm / 1_000_000)."""

    return scale_ppm(units, multiplier_ppm)


def reservation_estimate(
    est_input_tokens: int, output_limit: int, margin_ppm: int
) -> int:
    """Estimated maximum billable token units for a reservation."""

    est_units = est_input_tokens + max(0, output_limit)
    return scale_ppm(est_units, MILLION + margin_ppm)


def provider_cost_nanos(units: TokenUsage, rates: Any) -> int:
    """Upstream cost estimate in nanodollars from normalized usage.

    ``rates`` is the settlement rate snapshot (``service.RateRow``) carrying
    integer prices per component: input/cache_read/cache_write/output in
    nanodollars per million tokens. Each line ceilings independently so no
    token line is under-billed.
    """

    lines = (
        (units.uncached_input, rates.input_price),
        (units.cache_read, rates.cache_read_price),
        (units.cache_write, rates.cache_write_price),
        (units.output, rates.output_price),
    )
    cost = 0
    for tokens, price_per_million in lines:
        if tokens:
            cost += round_div(tokens * price_per_million, MILLION)
    return cost


# ---------------------------------------------------------------------------
# Request-side estimates (approximation, no tokenizer dependency)
# ---------------------------------------------------------------------------

# Rough chars-per-token factor for JSON payloads without a tokenizer.
_CHARS_PER_TOKEN = 4


def approximate_input_tokens(payload: dict) -> int:
    """Very rough request-size estimate: whole sanitized-payload size / 4.

    Deliberately coarse (it may count client metadata); reservations add a
    margin on top and settlement charges actual usage, so accuracy only
    affects the hold, never the final charge.
    """

    try:
        encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        encoded = str(payload)
    return max(1, len(encoded) // _CHARS_PER_TOKEN)


def requested_output_tokens(payload: dict) -> int:
    """Requested output-token limit across shapes, else a safe default.

    OpenAI chat: ``max_tokens`` / ``max_completion_tokens``; Anthropic
    messages and OpenAI-compatible bodies typically carry ``max_tokens``.
    """

    value = payload.get("max_tokens")
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        value = payload.get("max_completion_tokens")
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return settings.BILLING_DEFAULT_OUTPUT_TOKENS
    return value


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class WalletInactiveError(GatewayError):
    def __init__(self, message: str = "Wallet is not active for inference"):
        super().__init__(status.HTTP_402_PAYMENT_REQUIRED, "wallet_inactive", message)


class InsufficientCreditsError(GatewayError):
    def __init__(self, message: str = "Wallet balance cannot cover the estimated charge"):
        super().__init__(
            status.HTTP_402_PAYMENT_REQUIRED, "insufficient_wallet_credits", message
        )


class ProviderBudgetInsufficientError(GatewayError):
    """Raised pre-dispatch; the router skips to the next group member."""

    def __init__(self, provider_id: str):
        super().__init__(
            status.HTTP_409_CONFLICT,
            "insufficient_provider_budget",
            f"Provider budget cannot cover this request: {provider_id}",
        )


class NoAvailableMemberError(GatewayError):
    def __init__(self, message: str = "No available member can serve this request"):
        super().__init__(status.HTTP_429_TOO_MANY_REQUESTS, "no_available_member", message)


@dataclass(frozen=True)
class RateRow:
    """Applicable provider rates at attempt time (nanos per million tokens)."""

    currency_code: str
    input_price: int
    cache_read_price: int
    cache_write_price: int
    output_price: int
    pricing_version: str

    def snapshot_json(self) -> str:
        return json.dumps(
            {
                "currency_code": self.currency_code,
                "input_price_nanos_per_million_tokens": self.input_price,
                "cache_read_price_nanos_per_million_tokens": self.cache_read_price,
                "cache_write_price_nanos_per_million_tokens": self.cache_write_price,
                "output_price_nanos_per_million_tokens": self.output_price,
                "pricing_version": self.pricing_version,
            },
            separators=(",", ":"),
        )


@dataclass(frozen=True)
class AttemptCharge:
    """Handle for one reserved upstream attempt."""

    message_trace_id: str
    call_trace_id: str
    reservation_id: str
    multiplier_ppm: int
    pricing_version: str


@dataclass(frozen=True)
class SettlementOutcome:
    call_trace_id: str
    status: str
    usage_source: str
    billable_token_units: int | None
    user_credits_charged: int
    provider_credits_consumed: int
    debt_after_credits: int


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Account provisioning
# ---------------------------------------------------------------------------


def _get_or_create_wallet(db: Session, user_id: str) -> UserWallet:
    wallet = db.query(UserWallet).filter(UserWallet.user_id == user_id).first()
    if wallet is None:
        wallet = UserWallet(user_id=user_id)
        db.add(wallet)
        db.flush()
    return wallet


def get_or_create_wallet(db: Session | None = None, user_id: str | None = None) -> UserWallet:
    """Public read path; provisions the wallet lazily when absent."""

    owns_session = db is None
    db = db or SessionLocal()
    try:
        wallet = _get_or_create_wallet(db, user_id)
        db.commit()
        db.refresh(wallet)
        return wallet
    except Exception:
        db.rollback()
        raise
    finally:
        if owns_session:
            db.close()


def _get_or_create_system_account(db: Session) -> SystemBudgetAccount:
    account = db.get(SystemBudgetAccount, SYSTEM_ACCOUNT_ID)
    if account is None:
        account = SystemBudgetAccount(id=SYSTEM_ACCOUNT_ID)
        db.add(account)
        db.flush()
    return account


def get_or_create_system_account(db: Session | None = None) -> SystemBudgetAccount:
    owns_session = db is None
    db = db or SessionLocal()
    try:
        account = _get_or_create_system_account(db)
        db.commit()
        db.refresh(account)
        return account
    except Exception:
        db.rollback()
        raise
    finally:
        if owns_session:
            db.close()


def _get_or_create_provider_account(db: Session, provider_id: str) -> ProviderBudgetAccount:
    account = (
        db.query(ProviderBudgetAccount)
        .filter(ProviderBudgetAccount.provider_id == provider_id)
        .first()
    )
    if account is None:
        account = ProviderBudgetAccount(provider_id=provider_id)
        db.add(account)
        db.flush()
    return account


def get_or_create_provider_account(provider_id: str) -> ProviderBudgetAccount:
    """Creates the budget account lazily so inference can reserve against it."""

    db = SessionLocal()
    try:
        if db.query(Provider).filter(Provider.id == provider_id).first() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found"
            )
        account = _get_or_create_provider_account(db, provider_id)
        db.commit()
        db.refresh(account)
        return account
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Wallet funding, reads, transactions
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WalletTopUpResult:
    transaction_id: str
    user_id: str
    amount_credits: int
    available_credits: int
    reserved_credits: int
    actor_user_id: str | None
    created_at: datetime


def top_up_wallet(
    *,
    user_id: str,
    amount_credits: int,
    reason: str,
    idempotency_key: str,
    actor_user_id: str | None,
) -> WalletTopUpResult:
    db = SessionLocal()
    try:
        if db.query(User).filter(User.id == user_id).first() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        wallet = _get_or_create_wallet(db, user_id)
        entry = _apply_wallet_top_up(
            db,
            wallet=wallet,
            amount_credits=amount_credits,
            reason=reason,
            idempotency_key=idempotency_key,
            actor_user_id=actor_user_id,
        )
        db.commit()
        db.refresh(wallet)
        return WalletTopUpResult(
            transaction_id=entry.id,
            user_id=user_id,
            amount_credits=amount_credits,
            available_credits=wallet.available_credits,
            reserved_credits=wallet.reserved_credits,
            actor_user_id=actor_user_id,
            created_at=entry.created_at,
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _apply_wallet_top_up(
    db: Session,
    *,
    wallet: UserWallet,
    amount_credits: int,
    reason: str,
    idempotency_key: str,
    actor_user_id: str | None,
) -> WalletLedgerEntry:
    """Ledger + projection for one wallet top-up within an open transaction.

    Grants first repay outstanding debt; the remainder credits available.
    """

    _ensure_unused_idempotency_key(db, WalletLedgerEntry, idempotency_key)

    remainder = amount_credits
    debt_applied = min(wallet.debt_credits, remainder)
    remainder -= debt_applied

    wallet.available_credits += remainder
    wallet.debt_credits -= debt_applied
    wallet.lifetime_credited_credits += amount_credits
    # A completed top-up re-activates a debt-blocked wallet.
    if wallet.debt_credits == 0 and wallet.status in (WALLET_STATUS_DEBT,):
        wallet.status = WALLET_STATUS_ACTIVE
    wallet.version += 1

    return _append_wallet_ledger(
        db,
        wallet=wallet,
        entry_type="top_up",
        available_delta=remainder,
        reserved_delta=0,
        charged=0,
        debt_delta=-debt_applied,
        reason=reason,
        idempotency_key=idempotency_key,
        actor_user_id=actor_user_id,
        source_call_trace_id=None,
    )


def _append_wallet_ledger(
    db: Session,
    *,
    wallet: UserWallet,
    entry_type: str,
    available_delta: int,
    reserved_delta: int,
    charged: int,
    debt_delta: int,
    reason: str,
    idempotency_key: str,
    actor_user_id: str | None,
    source_call_trace_id: str | None,
) -> WalletLedgerEntry:
    if entry_type not in WALLET_ENTRY_TYPES:
        raise ValueError(f"Unknown wallet ledger entry type: {entry_type}")

    entry = WalletLedgerEntry(
        wallet_id=wallet.id,
        user_id=wallet.user_id,
        entry_type=entry_type,
        available_delta_credits=available_delta,
        reserved_delta_credits=reserved_delta,
        charged_credits=charged,
        debt_delta_credits=debt_delta,
        balance_after_credits=wallet.available_credits,
        reserved_after_credits=wallet.reserved_credits,
        debt_after_credits=wallet.debt_credits,
        source_call_trace_id=source_call_trace_id,
        idempotency_key=idempotency_key,
        reason=reason,
        actor_user_id=actor_user_id,
    )
    db.add(entry)
    db.flush()
    return entry


def _ensure_unused_idempotency_key(db: Session, table: type, key: str) -> None:
    if not key or not (1 <= len(key) <= 128):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="idempotency_key must be 1-128 characters",
        )
    if db.query(table).filter(table.idempotency_key == key).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Duplicate idempotency key"
        )


def list_wallet_transactions(
    user_id: str, *, page: int, page_size: int
) -> tuple[list[WalletLedgerEntry], int]:
    """The user's own ledger rows, newest first (owner-scoped by wallet)."""

    db = SessionLocal()
    try:
        wallet = db.query(UserWallet).filter(UserWallet.user_id == user_id).first()
        if wallet is None:
            return [], 0

        query = (
            db.query(WalletLedgerEntry)
            .filter(WalletLedgerEntry.wallet_id == wallet.id)
            .order_by(WalletLedgerEntry.created_at.desc(), WalletLedgerEntry.id)
        )
        total = query.with_entities(func.count(WalletLedgerEntry.id)).scalar() or 0
        rows = query.offset((page - 1) * page_size).limit(page_size).all()
        return rows, int(total)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# System and provider budgets
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SystemTopUpResult:
    transaction_id: str
    amount_credits: int
    unallocated_credits: int
    allocated_credits: int
    consumed_credits: int
    actor_user_id: str | None
    created_at: datetime


@dataclass(frozen=True)
class ProviderAllocationResult:
    transaction_id: str
    provider_id: str
    amount_credits: int
    provider_available_credits: int
    system_unallocated_credits: int
    actor_user_id: str | None
    created_at: datetime


def top_up_system(
    *,
    amount_credits: int,
    reason: str,
    idempotency_key: str,
    actor_user_id: str | None,
) -> SystemTopUpResult:
    """Funds the unallocated system budget; rejects duplicate keys."""

    db = SessionLocal()
    try:
        account = _get_or_create_system_account(db)
        _ensure_unused_idempotency_key(db, SystemBudgetLedger, idempotency_key)

        account.unallocated_credits += amount_credits
        account.lifetime_funded_credits += amount_credits
        account.version += 1

        entry = SystemBudgetLedger(
            entry_type="fund",
            amount_credits=amount_credits,
            unallocated_delta_credits=amount_credits,
            allocated_delta_credits=0,
            consumed_delta_credits=0,
            idempotency_key=idempotency_key,
            actor_user_id=actor_user_id,
            reason=reason,
        )
        db.add(entry)
        db.flush()

        db.commit()
        return SystemTopUpResult(
            transaction_id=entry.id,
            amount_credits=amount_credits,
            unallocated_credits=account.unallocated_credits,
            allocated_credits=account.allocated_credits,
            consumed_credits=account.consumed_credits,
            actor_user_id=actor_user_id,
            created_at=entry.created_at,
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _transfer_system_to_provider(
    db: Session,
    *,
    provider_id: str,
    account: ProviderBudgetAccount,
    amount_credits: int,
    reason: str,
    idempotency_key: str,
    actor_user_id: str | None,
) -> ProviderBudgetLedger:
    """Atomic system→provider allocation within an open transaction."""

    system = _get_or_create_system_account(db)

    _ensure_unused_idempotency_key(db, SystemBudgetLedger, idempotency_key)
    _ensure_unused_idempotency_key(db, ProviderBudgetLedger, idempotency_key)

    if system.unallocated_credits < amount_credits:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="System unallocated budget is insufficient for this allocation",
        )

    system.unallocated_credits -= amount_credits
    system.allocated_credits += amount_credits
    system.version += 1

    account.available_credits += amount_credits
    account.lifetime_allocated_credits += amount_credits
    account.version += 1

    system_entry = SystemBudgetLedger(
        entry_type="allocate",
        amount_credits=amount_credits,
        unallocated_delta_credits=-amount_credits,
        allocated_delta_credits=amount_credits,
        consumed_delta_credits=0,
        provider_id=provider_id,
        idempotency_key=idempotency_key,
        actor_user_id=actor_user_id,
        reason=reason,
    )
    provider_entry = ProviderBudgetLedger(
        provider_budget_account_id=account.id,
        entry_type="allocate",
        amount_credits=amount_credits,
        available_delta_credits=amount_credits,
        reserved_delta_credits=0,
        consumed_delta_credits=0,
        idempotency_key=idempotency_key,
        actor_user_id=actor_user_id,
        reason=reason,
    )
    db.add_all([system_entry, provider_entry])
    db.flush()
    return provider_entry


def top_up_provider(
    *,
    provider_id: str,
    amount_credits: int,
    reason: str,
    idempotency_key: str,
    actor_user_id: str | None,
) -> ProviderAllocationResult:
    db = SessionLocal()
    try:
        provider = db.query(Provider).filter(Provider.id == provider_id).first()
        if provider is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found"
            )
        account = _get_or_create_provider_account(db, provider_id)
        entry = _transfer_system_to_provider(
            db,
            provider_id=provider_id,
            account=account,
            amount_credits=amount_credits,
            reason=reason,
            idempotency_key=idempotency_key,
            actor_user_id=actor_user_id,
        )
        db.commit()
        return ProviderAllocationResult(
            transaction_id=entry.id,
            provider_id=provider_id,
            amount_credits=amount_credits,
            provider_available_credits=account.available_credits,
            system_unallocated_credits=(
                _get_or_create_system_account(db).unallocated_credits
            ),
            actor_user_id=actor_user_id,
            created_at=entry.created_at,
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def allocate_initial_provider_budget(
    db: Session,
    *,
    provider_id: str,
    amount_credits: int,
    actor_user_id: str | None,
) -> ProviderBudgetAccount:
    """Initial allocation within an existing provider-creation transaction.

    Uses the same checks and ledger entries as the standalone endpoint; the
    calling transaction rolls back entirely when funding is insufficient.
    """

    account = _get_or_create_provider_account(db, provider_id)
    _transfer_system_to_provider(
        db,
        provider_id=provider_id,
        account=account,
        amount_credits=amount_credits,
        reason="Initial budget allocation on provider creation",
        idempotency_key=f"provider_create:{provider_id}",
        actor_user_id=actor_user_id,
    )
    return account


def get_or_create_provider_budget(provider_id: str) -> tuple[ProviderBudgetAccount, str]:
    db = SessionLocal()
    try:
        provider = db.query(Provider).filter(Provider.id == provider_id).first()
        if provider is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Provider not found"
            )
        account = _get_or_create_provider_account(db, provider_id)
        db.commit()
        db.refresh(account)
        return account, provider.name
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Rate snapshots
# ---------------------------------------------------------------------------


def load_rate_snapshot(
    db: Session, provider_model_id: str | None, *, now: datetime | None = None
) -> RateRow | None:
    """Latest applicable provider-model rate, or None (cost stays zero)."""

    if not provider_model_id:
        return None

    moment = now or _utcnow()
    rate = (
        db.query(ProviderModelRate)
        .filter(
            ProviderModelRate.provider_model_id == provider_model_id,
            ProviderModelRate.effective_from <= moment,
        )
        .order_by(ProviderModelRate.effective_from.desc())
        .first()
    )
    if rate is None:
        return None

    effective_to = trace_service.as_utc(rate.effective_to)
    if effective_to is not None and effective_to < moment:
        return None

    return RateRow(
        currency_code=rate.currency_code,
        input_price=rate.input_price_nanos_per_million_tokens,
        cache_read_price=rate.cache_read_price_nanos_per_million_tokens,
        cache_write_price=rate.cache_write_price_nanos_per_million_tokens,
        output_price=rate.output_price_nanos_per_million_tokens,
        pricing_version=rate.pricing_version,
    )


# ---------------------------------------------------------------------------
# Per-attempt reservation / settlement
# ---------------------------------------------------------------------------


def reserve_attempt(
    *,
    user_id: str,
    api_key_id: str | None,
    provider_id: str,
    provider_model_id: str | None,
    gateway_model_id: str | None,
    multiplier_ppm: int,
    pricing_version: str,
    estimate_input_tokens: int,
    estimate_output_tokens: int,
    request_json: str | None,
    message_trace_id: str | None = None,
) -> AttemptCharge:
    """Holds user credits and provider budget for one upstream attempt.

    ``gateway_model_id`` (a ModelGroup) supplies the snapshotted multiplier
    and pricing version; requests resolved without a group bill at 1x with
    the configured default pricing version. Committed before dispatch.
    """

    db = SessionLocal()
    try:
        now = _utcnow()

        estimate_units = reservation_estimate(
            estimate_input_tokens,
            estimate_output_tokens,
            settings.BILLING_RESERVATION_MARGIN_PPM,
        )
        estimated_credits = user_credits_for_units(estimate_units, multiplier_ppm)

        wallet = _get_or_create_wallet(db, user_id)
        _reconcile_expired_reservations(db, wallet, now)

        if wallet.status != WALLET_STATUS_ACTIVE:
            raise WalletInactiveError()

        account = (
            db.query(ProviderBudgetAccount)
            .filter(ProviderBudgetAccount.provider_id == provider_id)
            .first()
        )
        # The provider account row must exist before the reservation (the
        # hold debits it). A missing row means zero budget; an absent or
        # since-deleted provider fails the hold with skip semantics so
        # routing can prefer a live member.
        if account is None:
            if db.get(Provider, provider_id) is None or estimate_units > 0:
                raise ProviderBudgetInsufficientError(provider_id)
            account = ProviderBudgetAccount(provider_id=provider_id)
            db.add(account)
            db.flush()
        elif account.available_credits < estimate_units:
            raise ProviderBudgetInsufficientError(provider_id)
        if wallet.available_credits < estimated_credits:
            raise InsufficientCreditsError()

        message, call = trace_service.start_pending_attempt(
            db,
            user_id=user_id,
            api_key_id=api_key_id,
            request_json=request_json,
            message_trace_id=message_trace_id,
            gateway_model_id=gateway_model_id,
            provider_model_id=provider_model_id,
            credit_multiplier_ppm=multiplier_ppm,
            created_at=now,
        )

        reservation = WalletReservation(
            call_trace_id=call.id,
            wallet_id=wallet.id,
            provider_id=provider_id,
            reserved_credits=estimated_credits,
            provider_reserved_credits=estimate_units,
            estimated_input_tokens=estimate_input_tokens,
            estimated_output_tokens=estimate_output_tokens,
            multiplier_snapshot_ppm=multiplier_ppm,
            pricing_version=pricing_version,
            status=RESERVATION_ACTIVE,
        )
        db.add(reservation)

        # User-side hold: available moves into reserved.
        wallet.available_credits -= estimated_credits
        wallet.reserved_credits += estimated_credits
        wallet.version += 1
        _append_wallet_ledger(
            db,
            wallet=wallet,
            entry_type="reserve",
            available_delta=-estimated_credits,
            reserved_delta=estimated_credits,
            charged=0,
            debt_delta=0,
            reason=f"Reserved {estimated_credits} credits for {estimate_units} estimated token units",
            idempotency_key=f"reserve:{call.id}",
            actor_user_id=None,
            source_call_trace_id=call.id,
        )

        # Provider-side hold in normalized token units (no multiplier).
        account.available_credits -= estimate_units
        account.reserved_credits += estimate_units
        account.version += 1
        db.add(
            ProviderBudgetLedger(
                provider_budget_account_id=account.id,
                entry_type="reserve",
                amount_credits=estimate_units,
                available_delta_credits=-estimate_units,
                reserved_delta_credits=estimate_units,
                consumed_delta_credits=0,
                source_call_trace_id=call.id,
                idempotency_key=f"reserve:{call.id}",
                reason=(f"Reserved provider budget for {call.id}"),
            )
        )
        db.flush()

        db.commit()

        return AttemptCharge(
            message_trace_id=message.id,
            call_trace_id=call.id,
            reservation_id=reservation.id,
            multiplier_ppm=multiplier_ppm,
            pricing_version=pricing_version,
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _release(
    db: Session,
    reservation: WalletReservation,
    *,
    status_name: str,
    error_code: str,
    latency_ms: int | None,
) -> None:
    """Returns the full reservation without billing, in the current txn."""

    wallet = db.get(UserWallet, reservation.wallet_id)
    account = (
        db.query(ProviderBudgetAccount)
        .filter(ProviderBudgetAccount.provider_id == reservation.provider_id)
        .first()
    )
    if wallet is None or account is None:
        raise RuntimeError("Unreconcilable reservation without accounts")

    reserved = reservation.reserved_credits
    wallet.available_credits += reserved
    wallet.reserved_credits -= reserved
    wallet.version += 1
    _append_wallet_ledger(
        db,
        wallet=wallet,
        entry_type="release",
        available_delta=reserved,
        reserved_delta=-reserved,
        charged=0,
        debt_delta=0,
        reason=(f"Released reservation {reservation.id} ({reserved} credits)"),
        idempotency_key=f"release:{reservation.call_trace_id}",
        actor_user_id=None,
        source_call_trace_id=reservation.call_trace_id,
    )

    provider_reserved = reservation.provider_reserved_credits
    account.available_credits += provider_reserved
    account.reserved_credits -= provider_reserved
    account.version += 1
    db.add(
        ProviderBudgetLedger(
            provider_budget_account_id=account.id,
            entry_type="release",
            amount_credits=provider_reserved,
            available_delta_credits=provider_reserved,
            reserved_delta_credits=-provider_reserved,
            consumed_delta_credits=0,
            source_call_trace_id=reservation.call_trace_id,
            idempotency_key=f"release:{reservation.call_trace_id}",
            reason=(f"Released provider reservation for {reservation.call_trace_id}"),
        )
    )
    db.flush()

    reservation.status = RESERVATION_RELEASED
    reservation.charged_credits = 0
    reservation.settled_at = _utcnow()

    call = db.get(LLMCallTrace, reservation.call_trace_id)
    if call is not None:
        _finalize_call_trace(
            db,
            call,
            message_id=None,
            status_name=status_name,
            error_code=error_code,
            latency_ms=latency_ms,
            token_usage_source=USAGE_SOURCE_UNAVAILABLE,
            input_tokens=None,
            output_tokens=None,
            cache_tokens=None,
            uncached_input=None,
            cache_read=None,
            cache_write=None,
            billable=None,
            charged=0,
            provider_consumed=0,
            provider_cost=0,
            currency=None,
            provider_usage_json=None,
            rate_snapshot_json=None,
        )
        _bump_attempt_aggregates(
            db,
            call=call,
            status_name=status_name,
            provider_id=reservation.provider_id,
            latency_ms=latency_ms,
            components=None,
            billable=0,
            charged=0,
            provider_consumed=0,
            provider_cost=0,
        )


def release_attempt(
    *,
    call_trace_id: str,
    status_name: str,
    error_code: str,
    latency_ms: int | None,
) -> None:
    """Pre-dispatch failure; releases the reservation with no billing."""

    db = SessionLocal()
    try:
        reservation = (
            db.query(WalletReservation)
            .filter(WalletReservation.call_trace_id == call_trace_id)
            .first()
        )
        if reservation is None or reservation.status != RESERVATION_ACTIVE:
            db.rollback()  # already reconciled; keep this call idempotent
            return
        _release(
            db,
            reservation,
            status_name=status_name,
            error_code=error_code,
            latency_ms=latency_ms,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _reconcile_expired_reservations(db: Session, wallet: UserWallet, now: datetime) -> None:
    """Releases reservations that outlived their window without billing.

    Called opportunistically at reservation time; crashed attempts (server
    never settled them) are returned instead of leaking reserved credits.
    """

    cutoff = now - timedelta(seconds=settings.BILLING_RESERVATION_TTL_SECONDS)
    stale = (
        db.query(WalletReservation)
        .filter(
            WalletReservation.wallet_id == wallet.id,
            WalletReservation.status == RESERVATION_ACTIVE,
            WalletReservation.created_at < cutoff,
        )
        .all()
    )
    for reservation in stale:
        _release(
            db,
            reservation,
            status_name="failed",
            error_code="reservation_expired",
            latency_ms=None,
        )


# ---------------------------------------------------------------------------
# Settlement
# ---------------------------------------------------------------------------


def _decide_usage(
    reservation: WalletReservation,
    token_usage: TokenUsage | None,
    *,
    allow_estimate: bool = True,
) -> tuple[str, int, int | None, int | None, int | None, int | None]:
    """Returns (source, billable, uncached, cache_read, cache_write, output).

    Any provider-reported usage is settled as-is (missing components count
    as zero, never double). With nothing reported, the configured missing
    usage policy applies: bill the reservation estimate, or record the
    attempt as unbillable. Converted stream shapes keep provider usage
    hidden from both the gateway and its records, so they never estimate.
    """

    reported = token_usage is not None and (
        token_usage.uncached_input is not None
        or token_usage.cache_read is not None
        or token_usage.cache_write is not None
        or token_usage.output is not None
    )

    if reported:
        uncached = token_usage.uncached_input or 0
        cache_read = token_usage.cache_read or 0
        cache_write = token_usage.cache_write or 0
        output = token_usage.output or 0
        billable = uncached + cache_read + cache_write + output
        return USAGE_SOURCE_REPORTED, billable, uncached, cache_read, cache_write, output

    if allow_estimate and settings.BILLING_MISSING_USAGE_POLICY == "estimate":
        uncached = reservation.estimated_input_tokens
        output = reservation.estimated_output_tokens
        billable = uncached + output
        return (
            USAGE_SOURCE_ESTIMATED,
            billable,
            uncached,
            0,
            0,
            output,  # cache_write stays 0 for estimates
        )

    return USAGE_SOURCE_UNAVAILABLE, 0, None, None, None, None


def settle_attempt(
    *,
    call_trace_id: str,
    status_name: str,
    error_code: str | None,
    latency_ms: int,
    message_id: str | None = None,
    token_usage: TokenUsage | None = None,
    sanitized_usage_json: str | None = None,
    allow_estimate: bool = True,
) -> SettlementOutcome:
    """Settles one reserved attempt in a single transaction.

    Succeeds only for a still-active reservation, so duplicate settlement
    (worker retries, double callbacks) is harmless.
    """

    if status_name not in (trace_service.STATUS_SUCCESS, trace_service.STATUS_FAILED, trace_service.STATUS_TIMEOUT):
        raise ValueError(f"Status {status_name} cannot settle")

    db = SessionLocal()
    try:
        reservation = (
            db.query(WalletReservation)
            .filter(WalletReservation.call_trace_id == call_trace_id)
            .first()
        )
        if reservation is None or reservation.status != RESERVATION_ACTIVE:
            db.rollback()
            return SettlementOutcome(
                call_trace_id=call_trace_id,
                status=status_name,
                usage_source=USAGE_SOURCE_UNAVAILABLE,
                billable_token_units=None,
                user_credits_charged=0,
                provider_credits_consumed=0,
                debt_after_credits=0,
            )

        call = db.get(LLMCallTrace, call_trace_id)
        if call is None:
            raise RuntimeError(f"Call trace {call_trace_id} is missing")
        wallet = db.get(UserWallet, reservation.wallet_id)
        account = (
            db.query(ProviderBudgetAccount)
            .filter(ProviderBudgetAccount.provider_id == reservation.provider_id)
            .first()
        )
        if wallet is None or account is None:
            raise RuntimeError("Wallet or provider account missing for attempt")

        source, billable, uncached, cache_read, cache_write, output = _decide_usage(
            reservation, token_usage, allow_estimate=allow_estimate
        )

        # -- user charge (snapshot multiplier) and provider consumption ----
        charged = user_credits_for_units(
            billable, reservation.multiplier_snapshot_ppm
        )

        hint = (
            TokenUsage(
                uncached_input=uncached,
                cache_read=cache_read,
                cache_write=cache_write,
                output=output,
            )
            if source != USAGE_SOURCE_UNAVAILABLE
            else TokenUsage()
        )

        rate_row = load_rate_snapshot(db, call.provider_model_id)
        provider_cost = provider_cost_nanos(hint, rate_row) if rate_row else 0
        currency = rate_row.currency_code if rate_row else None

        # -- wallet --------------------------------------------------------
        reserved = reservation.reserved_credits
        debt_delta = max(0, charged - reserved)
        available_delta = reserved - min(charged, reserved)

        wallet.available_credits += available_delta
        wallet.reserved_credits -= reserved
        wallet.debt_credits += debt_delta
        wallet.lifetime_spent_credits += charged
        # Debt never clears by spending; a blocked wallet stays blocked until
        # an explicit top-up re-activates it.
        if wallet.debt_credits > 0:
            wallet.status = WALLET_STATUS_DEBT
        elif wallet.status != WALLET_STATUS_BLOCKED:
            wallet.status = WALLET_STATUS_ACTIVE
        wallet.version += 1
        _append_wallet_ledger(
            db,
            wallet=wallet,
            entry_type="settle",
            available_delta=available_delta,
            reserved_delta=-reserved,
            charged=charged,
            debt_delta=debt_delta,
            reason=(f"Charged {charged} credits for {billable} token units ({source})"),
            idempotency_key=f"settle:{call_trace_id}",
            actor_user_id=None,
            source_call_trace_id=call_trace_id,
        )

        # -- provider budget (normalized token units, no multiplier) -------
        provider_reserved = reservation.provider_reserved_credits
        refund = max(0, provider_reserved - billable)
        account.available_credits += refund
        account.reserved_credits -= provider_reserved
        account.consumed_credits += billable
        account.version += 1
        db.add(
            ProviderBudgetLedger(
                provider_budget_account_id=account.id,
                entry_type="settle",
                amount_credits=billable,
                available_delta_credits=refund,
                reserved_delta_credits=-provider_reserved,
                consumed_delta_credits=billable,
                source_call_trace_id=call_trace_id,
                idempotency_key=f"settle:{call_trace_id}",
                reason=f"Consumed {billable} token units ({source})",
            )
        )
        db.flush()

        # -- system consumed mirror ---------------------------------------
        # Consumption retracts from the circulating system allocation, so
        # ``lifetime_funded == unallocated + allocated + consumed`` holds:
        # the provider's available pool already shrank by ``billable``.
        system = _get_or_create_system_account(db)
        system.allocated_credits -= billable
        system.consumed_credits += billable
        system.version += 1
        db.add(
            SystemBudgetLedger(
                entry_type="consume",
                amount_credits=billable,
                unallocated_delta_credits=0,
                allocated_delta_credits=-billable,
                consumed_delta_credits=billable,
                provider_id=reservation.provider_id,
                idempotency_key=f"consume:{call_trace_id}",
                reason="Provider budget consumption",
            )
        )
        db.flush()

        # -- reservation and trace -----------------------------------------
        reservation.status = RESERVATION_SETTLED
        reservation.charged_credits = charged
        reservation.settled_at = _utcnow()

        _finalize_call_trace(
            db,
            call,
            message_id=message_id,
            status_name=status_name,
            error_code=error_code,
            latency_ms=latency_ms,
            token_usage_source=source,
            input_tokens=(
                canonical_input_tokens(hint) if source != USAGE_SOURCE_UNAVAILABLE else None
            ),
            output_tokens=output if source != USAGE_SOURCE_UNAVAILABLE else None,
            cache_tokens=(
                total_cache_tokens(hint) if source != USAGE_SOURCE_UNAVAILABLE else None
            ),
            uncached_input=uncached,
            cache_read=cache_read,
            cache_write=cache_write,
            billable=billable if billable else None,
            charged=charged,
            provider_consumed=billable,
            provider_cost=provider_cost,
            currency=currency,
            provider_usage_json=sanitized_usage_json,
            rate_snapshot_json=rate_row.snapshot_json() if rate_row else None,
        )

        _bump_attempt_aggregates(
            db,
            call=call,
            status_name=status_name,
            provider_id=reservation.provider_id,
            latency_ms=latency_ms,
            components=hint,
            billable=billable,
            charged=charged,
            provider_consumed=billable,
            provider_cost=provider_cost,
        )

        db.commit()

        return SettlementOutcome(
            call_trace_id=call_trace_id,
            status=status_name,
            usage_source=source,
            billable_token_units=billable,
            user_credits_charged=charged,
            provider_credits_consumed=billable,
            debt_after_credits=wallet.debt_credits,
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _finalize_call_trace(
    db: Session,
    call: LLMCallTrace,
    *,
    message_id: str | None,
    status_name: str,
    error_code: str | None,
    latency_ms: int,
    token_usage_source: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
    cache_tokens: int | None,
    uncached_input: int | None,
    cache_read: int | None,
    cache_write: int | None,
    billable: int | None,
    charged: int,
    provider_consumed: int,
    provider_cost: int,
    currency: str | None,
    provider_usage_json: str | None,
    rate_snapshot_json: str | None,
) -> None:
    finished = _utcnow()

    call.status = trace_service.normalize_status(status_name)
    call.error_code = error_code
    call.latency_ms = latency_ms
    call.finished_at = finished

    call.uncached_input_tokens = uncached_input
    call.cache_read_tokens = cache_read
    call.cache_write_tokens = cache_write
    call.output_tokens = output_tokens
    call.cache_tokens = cache_tokens
    call.input_tokens = input_tokens
    call.billable_token_units = billable
    call.token_usage_source = token_usage_source
    call.user_credits_charged = charged
    call.provider_budget_credits_consumed = provider_consumed
    call.provider_cost_nanos = provider_cost
    call.currency_code = currency
    call.provider_usage_json = provider_usage_json
    call.provider_rate_snapshot_json = rate_snapshot_json

    message = db.get(LLMMessageTrace, call.message_trace_id)
    if message is not None:
        if message.message_id is None and message_id:
            message.message_id = message_id
        message.finished_at = finished


def _bump_attempt_aggregates(
    db: Session,
    *,
    call: LLMCallTrace,
    status_name: str,
    provider_id: str,
    latency_ms: int | None,
    components: TokenUsage | None,
    billable: int,
    charged: int,
    provider_consumed: int,
    provider_cost: int,
) -> None:
    """Bumps operational and billing daily tables for one finalized attempt."""

    usage_date = trace_service.utc_date_for(call.created_at)

    components = components or TokenUsage()

    # Operational (existing) dailies: canonical totals.
    for table, pk_columns in trace_service.aggregate_targets(
        user_id=call.user_id,
        api_key_id=call.api_key_id,
        gateway_model_id=call.gateway_model_id,
    ):
        bump_daily_usage(
            db,
            table,
            pk_columns,
            usage_date,
            status_name,
            call.input_tokens,
            call.output_tokens,
            call.cache_tokens,
            latency_ms,
        )

    # Billing dailies: normalized components and charges.
    targets: list[tuple[type, dict[str, str]]] = [(UserUsageDaily, {"user_id": call.user_id})]
    if call.api_key_id:
        targets.append((APIKeyUsageDaily, {"api_key_id": call.api_key_id}))
    if call.gateway_model_id:
        targets.append((GatewayModelUsageDaily, {"gateway_model_id": call.gateway_model_id}))
    if call.provider_model_id:
        targets.append((ProviderModelUsageDaily, {"provider_model_id": call.provider_model_id}))
    targets.append((ProviderUsageDaily, {"provider_id": provider_id}))
    targets.append((SystemUsageDaily, {}))

    for table, pk_columns in targets:
        values = {
            **pk_columns,
            "usage_date": usage_date,
            "call_count": 1,
            "successful_call_count": 1 if status_name == trace_service.STATUS_SUCCESS else 0,
            "failed_call_count": 1
            if status_name in (trace_service.STATUS_FAILED, trace_service.STATUS_TIMEOUT)
            else 0,
            "uncached_input_tokens": components.uncached_input or 0,
            "cache_read_tokens": components.cache_read or 0,
            "cache_write_tokens": components.cache_write or 0,
            "output_tokens": components.output or 0,
            "billable_token_units": billable or 0,
            "user_credits_charged": charged or 0,
            "provider_budget_credits_consumed": provider_consumed or 0,
            "provider_cost_nanos": provider_cost or 0,
            "total_latency_ms": latency_ms or 0,
        }
        stmt = sqlite_insert(table).values(values)
        increments = {
            column: getattr(table, column) + getattr(stmt.excluded, column)
            for column in BILLING_DAILY_COLUMNS
        }
        stmt = stmt.on_conflict_do_update(
            index_elements=[*pk_columns, "usage_date"],
            set_=increments,
        )
        db.execute(stmt)
