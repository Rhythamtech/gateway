"""HTTP surface for the LLM tracing API.

Access rules (see docs/tracing.md):

* Tracing starts enabled for new accounts and follows ``users.tracing_enabled``.
* Regular users may access only their own per-API-key analytics and
  per-gateway-model analytics.
* Superusers may access message traces, individual call traces, and all four
  analytics subjects for every user.
"""

import json
from datetime import date
from enum import Enum
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.api_keys.models import APIKey
from backend.auth.models import User, UserRole
from backend.credits.models import CreditUsage
from backend.core.database import SessionLocal, get_db, write_engine
from backend.dependencies import get_current_user, require_superuser
from backend.gateway.model_groups.models import ModelGroup
from backend.traces import service
from backend.traces.dtos import (
    CallTraceItem,
    CallsPage,
    ClearTracesResult,
    DailyUsageEntry,
    GatewayModelRef,
    HourlyCallActivity,
    MessageTraceDetail,
    MessageTraceItem,
    MessagesPage,
    ProviderModelRef,
    UsageAnalytics,
    UsageCost,
    UsageTotals,
)
from backend.traces.models import (
    LLMAPIKeyUsageDaily,
    LLMCallTrace,
    LLMGatewayModelUsageDaily,
    LLMUserUsageDaily,
)

router = APIRouter(prefix="/traces", tags=["LLM Traces"])


class LogRetention(str, Enum):
    day = "24h"
    week = "7d"
    month = "30d"
    never = "never"


class LogRetentionUpdate(BaseModel):
    log_retention: LogRetention


@router.get("/retention")
def get_log_retention(user: User = Depends(get_current_user)):
    with write_engine.connect() as connection:
        value = connection.execute(text("SELECT log_retention FROM gateway_settings WHERE id=1")).scalar_one()
    return {"log_retention": value}


@router.patch("/retention")
def update_log_retention(
    data: LogRetentionUpdate,
    user: User = Depends(get_current_user),
):
    _ensure_superuser(user)
    with SessionLocal.begin() as db:
        db.execute(text("UPDATE gateway_settings SET log_retention=:value WHERE id=1"), {"value": data.log_retention.value})
    return {"log_retention": data.log_retention.value}


# ---------------------------------------------------------------------------
# Parameter helpers
# ---------------------------------------------------------------------------


def _error(status_code: int, code: str, message: str) -> HTTPException:
    """Versioned error carrier; the composition root rebuilds ``{"error": …}``."""

    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _ensure_superuser(user: User) -> None:
    if user.role != UserRole.SUPERUSER:
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "Superuser access required.",
        )


def _ensure_page(page: int, page_size: int) -> tuple[int, int]:
    if page < 1:
        raise _error(status.HTTP_400_BAD_REQUEST, "INVALID_PAGE", "page must be >= 1")
    if not 1 <= page_size <= 100:
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            "INVALID_PAGE_SIZE",
            "page_size must be between 1 and 100",
        )
    return page, page_size


def _ensure_dates(
    from_param: str | None,
    to_param: str | None,
) -> tuple[date | None, date | None]:
    try:
        from_date = date.fromisoformat(from_param) if from_param else None
        to_date = date.fromisoformat(to_param) if to_param else None
    except ValueError:
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            "INVALID_DATE_RANGE",
            "from and to must be ISO dates (YYYY-MM-DD)",
        ) from None

    if from_date and to_date and from_date > to_date:
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            "INVALID_DATE_RANGE",
            "from must not be after to",
        )

    return from_date, to_date


def _ensure_status(status_filter: str | None) -> str | None:
    if status_filter is None:
        return None

    try:
        return service.normalize_status(status_filter)
    except ValueError:
        raise _error(
            status.HTTP_400_BAD_REQUEST,
            "INVALID_STATUS",
            "status must be pending, success, failed or timeout",
        ) from None


# ---------------------------------------------------------------------------
# Response shaping
# ---------------------------------------------------------------------------


def _decode_request_json(request_json: str | None) -> dict[str, Any] | None:
    """Decode a stored, sanitized request payload; tolerate corrupt rows."""

    if not request_json:
        return None

    try:
        decoded = json.loads(request_json)
    except ValueError:
        return None

    return decoded if isinstance(decoded, dict) else None


def _message_item(item: dict[str, Any]) -> MessageTraceItem:
    return MessageTraceItem(
        id=item["id"],
        user_id=item["user_id"],
        message_id=item["message_id"],
        api_key_id=item["api_key_id"],
        request=_decode_request_json(item["request"]),
        status=item["status"],
        call_count=item["call_count"],
        successful_call_count=item["successful_call_count"],
        failed_call_count=item["failed_call_count"],
        input_tokens=item["input_tokens"],
        output_tokens=item["output_tokens"],
        cache_tokens=item["cache_tokens"],
        total_latency_ms=item["total_latency_ms"],
        created_at=item["created_at"],
        finished_at=item["finished_at"],
    )


def _call_item(call: dict[str, Any]) -> CallTraceItem:
    return CallTraceItem(
        id=call["id"],
        message_trace_id=call["message_trace_id"],
        user_id=call["user_id"],
        message_id=call["message_id"],
        api_key_id=call["api_key_id"],
        gateway_model=(
            GatewayModelRef(**call["gateway_model"]) if call["gateway_model"] is not None else None
        ),
        provider_model=(
            ProviderModelRef(**call["provider_model"]) if call["provider_model"] is not None else None
        ),
        request=_decode_request_json(call["request"]),
        input_tokens=call["input_tokens"],
        output_tokens=call["output_tokens"],
        cache_tokens=call["cache_tokens"],
        uncached_input_tokens=call.get("uncached_input_tokens"),
        cache_read_tokens=call.get("cache_read_tokens"),
        cache_write_tokens=call.get("cache_write_tokens"),
        latency_ms=call["latency_ms"],
        status=call["status"],
        error_code=call["error_code"],
        error_details=call.get("error_details"),
        created_at=call["created_at"],
        finished_at=call["finished_at"],
    )


# ---------------------------------------------------------------------------
# Message traces
# ---------------------------------------------------------------------------


@router.get("/messages", response_model=MessagesPage)
def list_messages(
    page: int = Query(default=1),
    page_size: int = Query(default=20),
    user_id: UUID | None = Query(default=None),
    request_id: str | None = Query(default=None, max_length=255),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    page, page_size = _ensure_page(page, page_size)
    scoped_user_id = user.id if user.role != UserRole.SUPERUSER else (str(user_id) if user_id else None)
    items, total = service.list_message_rows(db, page, page_size, user_id=scoped_user_id, request_id=request_id)

    return MessagesPage(
        items=[_message_item(item) for item in items],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.delete("/messages", response_model=ClearTracesResult)
def clear_traces(_: User = Depends(require_superuser)) -> ClearTracesResult:
    return ClearTracesResult(deleted_count=service.clear_completed_traces())


@router.get("/messages/{trace_id}", response_model=MessageTraceDetail)
def get_message_trace(
    trace_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    message = service.get_message_row(db, str(trace_id))
    if message is None:
        raise _error(
            status.HTTP_404_NOT_FOUND,
            "TRACE_NOT_FOUND",
            "The requested trace was not found.",
        )
    if user.role != UserRole.SUPERUSER and message.get("user_id") != user.id:
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "You do not have access to this trace data.",
        )

    calls = [_call_item(call) for call in service.list_call_rows_by_message(db, str(trace_id))]
    calls.sort(key=lambda call: (call.created_at, str(call.id)))

    return MessageTraceDetail(
        **_message_item(message).model_dump(),
        calls=calls,
    )


# ---------------------------------------------------------------------------
# Call traces
# ---------------------------------------------------------------------------


@router.get("/calls", response_model=CallsPage)
def list_calls(
    page: int = Query(default=1),
    page_size: int = Query(default=20),
    user_id: UUID | None = Query(default=None),
    request_id: str | None = Query(default=None, max_length=255),
    message_id: str | None = Query(default=None),
    api_key_id: UUID | None = Query(default=None),
    gateway_model_id: UUID | None = Query(default=None),
    provider_model_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    from_param: str | None = Query(default=None, alias="from"),
    to_param: str | None = Query(default=None, alias="to"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    page, page_size = _ensure_page(page, page_size)
    status = _ensure_status(status)
    from_date, to_date = _ensure_dates(from_param, to_param)

    scoped_user_id = user.id if user.role != UserRole.SUPERUSER else (str(user_id) if user_id else None)

    items, total = service.list_calls(
        db,
        page,
        page_size,
        user_id=scoped_user_id,
        message_id=message_id,
        request_id=request_id,
        api_key_id=str(api_key_id) if api_key_id else None,
        gateway_model_id=str(gateway_model_id) if gateway_model_id else None,
        provider_model_id=str(provider_model_id) if provider_model_id else None,
        status=status,
        started=service.day_start(from_date) if from_date else None,
        ended=service.day_end_inclusive(to_date) if to_date else None,
    )

    return CallsPage(
        items=[_call_item(item) for item in items],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.get("/calls/{call_id}", response_model=CallTraceItem)
def get_call_trace(
    call_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = service.get_call(db, str(call_id))
    if item is None:
        raise _error(
            status.HTTP_404_NOT_FOUND,
            "TRACE_NOT_FOUND",
            "The requested trace was not found.",
        )
    if user.role != UserRole.SUPERUSER and item.get("user_id") != user.id:
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "You do not have access to this trace data.",
        )
    return _call_item(item)


# ---------------------------------------------------------------------------
# Usage analytics
# ---------------------------------------------------------------------------


def _usage_response(
    subject_type: str,
    subject_id: UUID,
    from_date: date | None,
    to_date: date | None,
    data: dict,
    *,
    default_from: date,
    default_to: date,
    hourly: list[dict[str, int]] | None = None,
    cost: dict | None = None,
) -> UsageAnalytics:
    return UsageAnalytics(
        subject_type=subject_type,
        subject_id=subject_id,
        from_date=(from_date or default_from).isoformat(),
        to_date=(to_date or default_to).isoformat(),
        totals=UsageTotals(**data["totals"]),
        daily=[DailyUsageEntry(**entry) for entry in data["daily"]],
        hourly=[HourlyCallActivity(**entry) for entry in hourly] if hourly is not None else None,
        cost=UsageCost(**cost) if cost is not None else None,
    )


@router.get("/usage/api-keys/{key_id}", response_model=UsageAnalytics)
def api_key_usage(
    key_id: UUID,
    from_param: str | None = Query(default=None, alias="from"),
    to_param: str | None = Query(default=None, alias="to"),
    include_hourly: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    key = db.get(APIKey, str(key_id))
    if key is None:
        raise _error(status.HTTP_404_NOT_FOUND, "TRACE_NOT_FOUND", "The requested API key was not found.")

    if user.role != UserRole.SUPERUSER and key.owner_id != user.id:
        raise _error(
            status.HTTP_403_FORBIDDEN,
            "FORBIDDEN",
            "You do not have access to this trace data.",
        )

    from_date, to_date = _ensure_dates(from_param, to_param)
    data = service.usage_for_subject(
        db, LLMAPIKeyUsageDaily, "api_key_id", key.id, from_date, to_date
    )
    cost = service.daily_charged_credits(db, CreditUsage.api_key_id, key.id, from_date, to_date)
    defaults = service.usage_date_bounds(key.created_at)
    hourly = (
        service.hourly_call_activity(
            db, LLMCallTrace.api_key_id, key.id, from_date or defaults[0], to_date or defaults[1]
        )
        if include_hourly
        else None
    )
    return _usage_response(
        subject_type="api_key",
        subject_id=key_id,
        from_date=from_date,
        to_date=to_date,
        data=data,
        default_from=defaults[0],
        default_to=defaults[1],
        hourly=hourly,
        cost=cost,
    )


@router.get("/usage/gateway-models/{model_id}", response_model=UsageAnalytics)
def gateway_model_usage(
    model_id: UUID,
    from_param: str | None = Query(default=None, alias="from"),
    to_param: str | None = Query(default=None, alias="to"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.get(ModelGroup, str(model_id))
    if group is None:
        raise _error(
            status.HTTP_404_NOT_FOUND,
            "TRACE_NOT_FOUND",
            "The requested gateway model was not found.",
        )

    from_date, to_date = _ensure_dates(from_param, to_param)

    if user.role == UserRole.SUPERUSER:
        # Superusers see totals aggregated across every user.
        data = service.usage_for_subject(
            db, LLMGatewayModelUsageDaily, "gateway_model_id", group.id, from_date, to_date
        )
        defaults = service.usage_date_bounds(group.created_at)
    else:
        # Regular users may only see model-level usage they generated; a
        # model they never called returns zero totals, never other users'
        # data.
        data = service.usage_for_user_gateway_model(db, user.id, group.id, from_date, to_date)
        defaults = service.usage_date_bounds(user.created_at)

    return _usage_response(
        subject_type="gateway_model",
        subject_id=model_id,
        from_date=from_date,
        to_date=to_date,
        data=data,
        default_from=defaults[0],
        default_to=defaults[1],
    )


@router.get("/usage/users/{user_id}", response_model=UsageAnalytics)
def user_usage(
    user_id: UUID,
    from_param: str | None = Query(default=None, alias="from"),
    to_param: str | None = Query(default=None, alias="to"),
    include_hourly: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_superuser(user)

    subject = db.get(User, str(user_id))
    if subject is None:
        raise _error(
            status.HTTP_404_NOT_FOUND,
            "TRACE_NOT_FOUND",
            "The requested trace subject was not found.",
        )

    from_date, to_date = _ensure_dates(from_param, to_param)
    data = service.usage_for_subject(
        db, LLMUserUsageDaily, "user_id", subject.id, from_date, to_date
    )
    cost = service.daily_charged_credits(db, CreditUsage.user_id, subject.id, from_date, to_date)
    defaults = service.usage_date_bounds(subject.created_at)
    hourly = (
        service.hourly_call_activity(
            db, LLMCallTrace.user_id, subject.id, from_date or defaults[0], to_date or defaults[1]
        )
        if include_hourly
        else None
    )
    return _usage_response(
        subject_type="user",
        subject_id=user_id,
        from_date=from_date,
        to_date=to_date,
        data=data,
        default_from=defaults[0],
        default_to=defaults[1],
        hourly=hourly,
        cost=cost,
    )


@router.get("/usage/me", response_model=UsageAnalytics)
def my_usage(
    from_param: str | None = Query(default=None, alias="from"),
    to_param: str | None = Query(default=None, alias="to"),
    include_hourly: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return account-wide usage for the authenticated user only."""
    from_date, to_date = _ensure_dates(from_param, to_param)
    data = service.usage_for_subject(
        db, LLMUserUsageDaily, "user_id", user.id, from_date, to_date
    )
    cost = service.daily_charged_credits(db, CreditUsage.user_id, user.id, from_date, to_date)
    defaults = service.usage_date_bounds(user.created_at)
    hourly = (
        service.hourly_call_activity(
            db, LLMCallTrace.user_id, user.id, from_date or defaults[0], to_date or defaults[1]
        )
        if include_hourly
        else None
    )
    return _usage_response(
        subject_type="user",
        subject_id=UUID(user.id),
        from_date=from_date,
        to_date=to_date,
        data=data,
        default_from=defaults[0],
        default_to=defaults[1],
        hourly=hourly,
        cost=cost,
    )
    defaults = service.usage_date_bounds(subject.created_at)
    hourly = (
        service.hourly_call_activity(
            db, LLMCallTrace.user_id, subject.id, from_date or defaults[0], to_date or defaults[1]
        )
        if include_hourly
        else None
    )
    return _usage_response(
        subject_type="user",
        subject_id=user_id,
        from_date=from_date,
        to_date=to_date,
        data=data,
        default_from=defaults[0],
        default_to=defaults[1],
        hourly=hourly,
    )
