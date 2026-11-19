from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.auth.models import User
from backend.core.config import settings
from backend.core.database import SessionLocal
from backend.core.errors import GatewayError
from backend.credits.calculation import (
    MAX_AMOUNT,
    MICROCREDITS,
    calculate_credit_charge,
    format_credits,
    to_microcredits,
)
from backend.credits.dtos import (
    CreditAddition,
    CreditBalance,
    CreditEntryResponse,
    CreditHistory,
    CreditUsagePage,
    CreditUsageResponse,
    ModelRateResponse,
    ModelRateUpdate,
    UsageResolution,
)
from backend.credits.models import (
    CreditEntry,
    CreditUsage,
    ModelCreditRate,
    ProviderCredits,
    UserCredits,
    utcnow,
)
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.providers.models import Provider
from backend.gateway.routing import RouteCandidate


@dataclass(frozen=True)
class CreditReservation:
    usage_id: str
    output_tokens: int


def get_owner(
    db: Session, owner_type: Literal["user", "provider"], owner_id: str
) -> User | Provider:
    model = User if owner_type == "user" else Provider
    owner = db.get(model, owner_id)
    if owner is None:
        raise HTTPException(404, f"{owner_type.capitalize()} not found")
    return owner


def get_credit_balance(
    db: Session,
    owner_type: Literal["user", "provider"],
    owner_id: str,
    *,
    create: bool = False,
    lock: bool = False,
) -> UserCredits | ProviderCredits | None:
    model = UserCredits if owner_type == "user" else ProviderCredits
    if create:
        # Lock the parent even when the balance row does not yet exist.
        owner_model = User if owner_type == "user" else Provider
        db.query(owner_model).filter(owner_model.id == owner_id).with_for_update().one()
    balance = db.get(model, owner_id, with_for_update=lock or create)
    if balance is None and create:
        key = "user_id" if owner_type == "user" else "provider_id"
        balance = model(**{key: owner_id}, remaining=0, reserved=0)
        db.add(balance)
        db.flush()
    return balance


def balance_response(balance: UserCredits | ProviderCredits | None) -> CreditBalance:
    remaining = balance.remaining if balance else 0
    reserved = balance.reserved if balance else 0
    return CreditBalance(
        remaining_credits=format_credits(remaining),
        reserved_credits=format_credits(reserved),
        available_credits=format_credits(remaining - reserved),
    )


def get_balance(
    db: Session, owner_type: Literal["user", "provider"], owner_id: str
) -> CreditBalance:
    get_owner(db, owner_type, owner_id)
    return balance_response(get_credit_balance(db, owner_type, owner_id))


def entry_response(entry: CreditEntry) -> CreditEntryResponse:
    return CreditEntryResponse(
        id=entry.id,
        credits=format_credits(entry.amount),
        remaining_credits=format_credits(entry.remaining_after),
        usage_id=entry.usage_id,
        actor_id=entry.actor_id,
        reason=entry.reason,
        created_at=entry.created_at,
    )


def grant_credits(
    db: Session,
    owner_type: Literal["user", "provider"],
    owner_id: str,
    amount: int,
    actor_id: str,
    reason: str,
    *,
    idempotency_key: str | None = None,
    coupon_code: str | None = None,
) -> CreditEntry:
    """Grant within the caller's write transaction; caller owns deduplication/audit."""
    if amount <= 0:
        raise ValueError("Credit grant must be positive")
    get_owner(db, owner_type, owner_id)
    balance = get_credit_balance(db, owner_type, owner_id, create=True)
    if balance.remaining + amount > MAX_AMOUNT:
        raise HTTPException(409, "Credit balance exceeds the supported range")
    balance.remaining += amount
    entry = CreditEntry(
        owner_type=owner_type, owner_id=owner_id, amount=amount,
        remaining_after=balance.remaining, idempotency_key=idempotency_key,
        actor_id=actor_id, reason=reason,
    )
    db.add(entry)
    db.flush()
    if owner_type == "user":
        from backend.notifications.service import emit, check_credit_alert
        emit(db, owner_id, f"credit:{entry.id}", "coupon_redeemed" if coupon_code else "credits_added",
             f"{format_credits(amount)} credits added",
             f"Coupon {coupon_code} was redeemed successfully." if coupon_code else
             "Credits were added to your account. View your credit history for details.")
        check_credit_alert(db, owner_id)
    return entry


def add_credits(
    owner_type: Literal["user", "provider"],
    owner_id: str,
    data: CreditAddition,
    actor_id: str,
) -> CreditEntryResponse:
    amount = to_microcredits(data.credits)
    with SessionLocal.begin() as db:
        owner_model = User if owner_type == "user" else Provider
        owner = db.query(owner_model).filter(owner_model.id == owner_id).with_for_update().first()
        if owner is None:
            raise HTTPException(404, f"{owner_type.capitalize()} not found")
        existing = (
            db.query(CreditEntry)
            .filter_by(
                owner_type=owner_type,
                owner_id=owner_id,
                idempotency_key=data.idempotency_key,
            )
            .first()
        )
        if existing:
            if existing.amount != amount or existing.reason != data.reason:
                raise HTTPException(
                    409,
                    "Idempotency key was already used for a different credit addition",
                )
            return entry_response(existing)
        entry = grant_credits(db, owner_type, owner_id, amount, actor_id, data.reason,
                              idempotency_key=data.idempotency_key)
        if owner_type == "user":
            from backend.users.audit import UserAdminAudit

            db.add(UserAdminAudit(
                actor_id=actor_id,
                user_id=owner_id,
                action="credits_added",
                detail=f"Added {data.credits} credits: {data.reason}",
            ))
        db.flush()
        return entry_response(entry)


def get_history(
    db: Session,
    owner_type: Literal["user", "provider"],
    owner_id: str,
    page: int,
    page_size: int,
) -> CreditHistory:
    get_owner(db, owner_type, owner_id)
    query = db.query(CreditEntry).filter_by(owner_type=owner_type, owner_id=owner_id)
    total = query.count()
    entries = (
        query.order_by(CreditEntry.created_at.desc(), CreditEntry.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return CreditHistory(
        items=[entry_response(entry) for entry in entries],
        page=page,
        page_size=page_size,
        total=total,
    )


def latest_model_rate(db: Session, model_id: str) -> ModelCreditRate | None:
    return (
        db.query(ModelCreditRate)
        .filter_by(provider_model_id=model_id)
        .order_by(ModelCreditRate.version.desc())
        .first()
    )


def rate_response(rate: ModelCreditRate) -> ModelRateResponse:
    return ModelRateResponse(
        id=rate.id,
        provider_model_id=rate.provider_model_id,
        version=rate.version,
        tokens_per_credit=format_credits(rate.tokens_per_credit_micros),
        max_request_tokens=rate.max_request_tokens,
        created_at=rate.created_at,
    )


def get_model_rate(db: Session, model_id: str) -> ModelRateResponse:
    if db.get(ProviderModel, model_id) is None:
        raise HTTPException(404, "Provider model not found")
    rate = latest_model_rate(db, model_id)
    if rate is None:
        raise HTTPException(404, "Model credit rate is not configured")
    return rate_response(rate)


def set_model_rate(
    model_id: str, data: ModelRateUpdate, actor_id: str
) -> ModelRateResponse:
    rate_amount = to_microcredits(data.tokens_per_credit)
    try:
        calculate_credit_charge(data.max_request_tokens or 1, rate_amount, reserve=True)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    with SessionLocal.begin() as db:
        if db.get(ProviderModel, model_id, with_for_update=True) is None:
            raise HTTPException(404, "Provider model not found")
        previous = latest_model_rate(db, model_id)
        if previous and (
            previous.tokens_per_credit_micros == rate_amount
            and previous.max_request_tokens == data.max_request_tokens
        ):
            return rate_response(previous)
        rate = ModelCreditRate(
            provider_model_id=model_id,
            version=previous.version + 1 if previous else 1,
            tokens_per_credit_micros=rate_amount,
            max_request_tokens=data.max_request_tokens,
            actor_id=actor_id,
        )
        db.add(rate)
        db.flush()
        return rate_response(rate)


def reserve_request_credits(
    candidate: RouteCandidate,
    user_id: str,
    api_key_id: str,
    request_id: str,
    requested_output_tokens: int | None,
    estimated_input_tokens: int,
) -> CreditReservation:
    with SessionLocal.begin() as db:
        user = db.get(User, user_id)
        provider = db.get(Provider, candidate.provider_id)
        model = (
            db.get(ProviderModel, candidate.provider_model_id)
            if candidate.provider_model_id
            else None
        )
        if user is None or not user.is_active:
            raise GatewayError(
                401, "authentication_error", "User is inactive or missing"
            )
        if (
            provider is None
            or not provider.is_enabled
            or model is None
            or model.provider_id != provider.id
            or not model.is_available
        ):
            raise GatewayError(
                503, "model_unavailable", "Provider model is unavailable"
            )
        rate = latest_model_rate(db, model.id)
        if rate is None:
            raise GatewayError(
                503, "model_rate_missing", "Model credit rate is not configured"
            )
        model_output_room = min(
            1_000_000, (rate.max_request_tokens or 10_000_000) - estimated_input_tokens
        )
        if model_output_room < 1 or (
            requested_output_tokens is not None
            and requested_output_tokens > model_output_room
        ):
            raise GatewayError(
                400,
                "output_limit_exceeded",
                f"The input leaves room for at most {max(0, model_output_room)} output tokens",
            )

        provider_balance = get_credit_balance(db, "provider", provider.id, create=True)
        user_balance = get_credit_balance(db, "user", user.id, create=True)
        provider_available = provider_balance.remaining - provider_balance.reserved
        user_available = user_balance.remaining - user_balance.reserved
        available = min(provider_available, user_available)
        affordable_output = (
            available * rate.tokens_per_credit_micros // MICROCREDITS**2
            - estimated_input_tokens
        )
        output_tokens = requested_output_tokens or min(
            settings.CREDITS_DEFAULT_OUTPUT_TOKENS, model_output_room, affordable_output
        )
        if output_tokens < 1 or output_tokens > affordable_output:
            if provider_available <= user_available:
                raise GatewayError(
                    503,
                    "provider_credits_exhausted",
                    "Provider has insufficient available credits",
                )
            raise GatewayError(
                402,
                "insufficient_credits",
                f"Your balance can cover at most {max(0, affordable_output)} output tokens after input",
            )

        reserved_tokens = estimated_input_tokens + output_tokens
        amount = calculate_credit_charge(
            reserved_tokens, rate.tokens_per_credit_micros, reserve=True
        )
        provider_balance.reserved += amount
        user_balance.reserved += amount
        usage = CreditUsage(
            request_id=request_id,
            user_id=user.id,
            api_key_id=api_key_id,
            provider_id=provider.id,
            provider_model_id=model.id,
            rate_id=rate.id,
            tokens_per_credit_micros=rate.tokens_per_credit_micros,
            max_request_tokens=reserved_tokens,
            reserved=amount,
        )
        db.add(usage)
        db.flush()
        return CreditReservation(usage.id, output_tokens)


def require_usage(db: Session, usage_id: str) -> CreditUsage:
    usage = db.get(CreditUsage, usage_id, with_for_update=True)
    if usage is None:
        raise HTTPException(404, "Credit usage not found")
    return usage


def mark_dispatched(usage_id: str) -> None:
    with SessionLocal.begin() as db:
        usage = require_usage(db, usage_id)
        if usage.status != "reserved":
            raise GatewayError(
                409, "invalid_credit_state", "Request is no longer reserved"
            )
        usage.status = "dispatched"


def mark_for_review(usage_id: str, reason: str) -> None:
    with SessionLocal.begin() as db:
        usage = require_usage(db, usage_id)
        if usage.status in ("reserved", "dispatched"):
            usage.status = "needs_review"
            usage.reason = reason[:1000]


def record_provider_reference(usage_id: str, provider_request_id: str) -> None:
    with SessionLocal.begin() as db:
        usage = require_usage(db, usage_id)
        if usage.status not in ("settled", "released"):
            usage.provider_request_id = provider_request_id[:255]


def record_usage(
    usage_id: str,
    input_tokens: int,
    output_tokens: int,
    provider_request_id: str | None,
) -> None:
    if any(
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > 10_000_000
        for value in (input_tokens, output_tokens)
    ):
        raise ValueError("Invalid provider token usage")
    with SessionLocal.begin() as db:
        usage = require_usage(db, usage_id)
        if usage.status in ("settled", "released", "usage_recorded"):
            return
        usage.input_tokens = input_tokens
        usage.output_tokens = output_tokens
        usage.provider_request_id = (
            provider_request_id[:255] if provider_request_id else None
        )
        if (
            input_tokens + output_tokens > usage.max_request_tokens
        ):
            usage.status = "needs_review"
            usage.reason = "Provider reported usage above the reserved token allowance"
        else:
            usage.status = "usage_recorded"
            usage.reason = None


def extend_reservation(db: Session, usage: CreditUsage) -> None:
    try:
        charge = calculate_credit_charge(
            usage.input_tokens + usage.output_tokens,
            usage.tokens_per_credit_micros,
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    additional = max(0, charge - usage.reserved)
    if not additional:
        return
    balances = [
        get_credit_balance(db, "provider", usage.provider_id, lock=True),
        get_credit_balance(db, "user", usage.user_id, lock=True),
    ]
    if any(balance.remaining - balance.reserved < additional for balance in balances):
        raise HTTPException(
            409,
            "Add credits to both affected balances before settling usage above its reservation",
        )
    for balance in balances:
        balance.reserved += additional
    usage.reserved += additional


def finish_usage(db: Session, usage: CreditUsage, *, release: bool = False) -> None:
    charge = (
        0
        if release
        else calculate_credit_charge(
            usage.input_tokens + usage.output_tokens, usage.tokens_per_credit_micros
        )
    )
    if charge > usage.reserved:
        raise HTTPException(
            409,
            "Usage exceeds the reservation; verify the model limits and reported usage",
        )
    for owner_type, owner_id in (
        ("provider", usage.provider_id),
        ("user", usage.user_id),
    ):
        balance = get_credit_balance(db, owner_type, owner_id, lock=True)
        balance.reserved -= usage.reserved
        balance.remaining -= charge
        db.add(
            CreditEntry(
                owner_type=owner_type,
                owner_id=owner_id,
                amount=-charge,
                remaining_after=balance.remaining,
                usage_id=usage.id,
                actor_id=usage.resolved_by,
                reason=usage.reason
                or ("Unused reservation released" if release else "Model usage"),
            )
        )
    from backend.notifications.service import check_credit_alert
    check_credit_alert(db, usage.user_id)
    usage.charged = charge
    usage.status = "released" if release else "settled"


def settle_request_usage(usage_id: str) -> None:
    with SessionLocal.begin() as db:
        usage = require_usage(db, usage_id)
        if usage.status == "usage_recorded":
            finish_usage(db, usage)


def release_undispatched_request(usage_id: str) -> None:
    with SessionLocal.begin() as db:
        usage = require_usage(db, usage_id)
        if usage.status == "reserved":
            finish_usage(db, usage, release=True)


def usage_response(usage: CreditUsage) -> CreditUsageResponse:
    return CreditUsageResponse(
        id=usage.id,
        request_id=usage.request_id,
        user_id=usage.user_id,
        provider_id=usage.provider_id,
        provider_model_id=usage.provider_model_id,
        api_key_id=usage.api_key_id,
        rate_id=usage.rate_id,
        tokens_per_credit=format_credits(usage.tokens_per_credit_micros),
        max_request_tokens=usage.max_request_tokens,
        reserved_credits=format_credits(usage.reserved),
        charged_credits=format_credits(usage.charged),
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        provider_request_id=usage.provider_request_id,
        status=usage.status,
        reason=usage.reason,
        resolved_by=usage.resolved_by,
        created_at=usage.created_at,
        updated_at=usage.updated_at,
    )


def list_usage(
    db: Session,
    page: int,
    page_size: int,
    status: str | None = None,
    user_id: str | None = None,
) -> CreditUsagePage:
    query = db.query(CreditUsage)
    if status:
        query = query.filter_by(status=status)
    if user_id:
        query = query.filter_by(user_id=user_id)
    total = query.count()
    rows = (
        query.order_by(CreditUsage.created_at.desc(), CreditUsage.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return CreditUsagePage(
        items=[usage_response(row) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
    )


def resolve_usage(
    usage_id: str, data: UsageResolution, actor_id: str
) -> CreditUsageResponse:
    with SessionLocal.begin() as db:
        usage = require_usage(db, usage_id)
        if usage.status in ("settled", "released"):
            expected = "settled" if data.action == "settle" else "released"
            if usage.status != expected or (
                data.action == "settle"
                and (usage.input_tokens, usage.output_tokens)
                != (data.input_tokens, data.output_tokens)
            ):
                raise HTTPException(409, "Usage was already resolved differently")
            return usage_response(usage)
        if usage.status != "needs_review":
            raise HTTPException(409, "Only usage awaiting review can be resolved")
        usage.reason = data.reason
        usage.resolved_by = actor_id
        if data.action == "settle":
            usage.input_tokens = data.input_tokens
            usage.output_tokens = data.output_tokens
            extend_reservation(db, usage)
        finish_usage(db, usage, release=data.action == "release")
        db.flush()
        return usage_response(usage)


def recover_pending_usage(stale_seconds: int) -> None:
    cutoff = utcnow() - timedelta(seconds=stale_seconds)
    with SessionLocal.begin() as db:
        rows = (
            db.query(CreditUsage)
            .filter(
                (CreditUsage.status == "usage_recorded")
                | (
                    CreditUsage.status.in_(("reserved", "dispatched"))
                    & (CreditUsage.updated_at < cutoff)
                ),
            )
            .order_by(CreditUsage.updated_at)
            .with_for_update(skip_locked=True)
            .limit(100)
            .all()
        )
        for usage in rows:
            if usage.status == "usage_recorded":
                finish_usage(db, usage)
            elif usage.updated_at.replace(tzinfo=cutoff.tzinfo) < cutoff:
                usage.status = "needs_review"
                usage.reason = (
                    "Request did not finalize; confirm upstream usage before resolving"
                )
