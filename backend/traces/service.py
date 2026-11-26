"""Transactional recording and querying of LLM usage traces.

Write side (``record_attempt`` / ``start_pending_attempt`` /
``finish_pending_attempt``): a call trace row plus the daily aggregate rows
are written in one transaction, so counts and token totals stay consistent
even under concurrent gateway traffic. Every actual upstream attempt,
including retries and routing decisions, is recorded once; token and latency
totals measure operational workload per attempt.

Read side: daily analytics use indexed aggregate tables. Opt-in hourly
activity groups the matching indexed call rows by their UTC start hour.
"""

import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import case, delete, func, or_, select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.orm import Load, Session

from backend.core.database import SessionLocal
from backend.core.errors import REQUEST_TIMEOUT_MESSAGE, REQUEST_TIMEOUT_SECONDS
from backend.credits.calculation import format_credits
from backend.credits.models import CreditUsage
from backend.gateway.model_groups.models import ModelGroup
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.providers.models import Provider
from backend.traces.models import (
    LLMAPIKeyUsageDaily,
    LLMCallTrace,
    LLMGatewayModelUsageDaily,
    LLMMessageTrace,
    LLMUserModelUsageDaily,
    LLMUserUsageDaily,
)
from backend.traces.redaction import serialize_request_payload

STATUS_PENDING = "pending"
STATUS_SUCCESS = "success"
STATUS_FAILED = "failed"


def clear_completed_traces() -> int:
    """Clear request logs while allowing pending attempts to finalize."""

    pending_attempt = (
        select(LLMCallTrace.id)
        .where(
            LLMCallTrace.message_trace_id == LLMMessageTrace.id,
            LLMCallTrace.status == STATUS_PENDING,
        )
        .exists()
    )
    with SessionLocal.begin() as db:
        result = db.execute(delete(LLMMessageTrace.__table__).where(~pending_attempt))
        return result.rowcount


def purge_expired_logs() -> int:
    """Permanently remove closed request logs older than gateway retention."""
    with SessionLocal.begin() as db:
        policy = db.execute(
            text("SELECT log_retention FROM gateway_settings WHERE id=1")
        ).scalar_one()
        age = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}.get(policy)
        if age is None:
            return 0
        cutoff = datetime.now(timezone.utc) - age
        result = db.execute(text("""
            DELETE FROM llm_message_traces
            WHERE finished_at IS NOT NULL AND finished_at < :cutoff
              AND NOT EXISTS (
                SELECT 1 FROM llm_call_traces
                WHERE llm_call_traces.message_trace_id = llm_message_traces.id
                  AND llm_call_traces.status = 'pending'
              )
        """), {"cutoff": cutoff.isoformat()})
        return result.rowcount or 0
STATUS_TIMEOUT = "timeout"
_STATUSES = (STATUS_PENDING, STATUS_SUCCESS, STATUS_FAILED, STATUS_TIMEOUT)

_INCREMENT_COLUMNS = (
    "call_count",
    "successful_call_count",
    "failed_call_count",
    "input_tokens",
    "output_tokens",
    "cache_tokens",
    "total_latency_ms",
    "latency_sample_count",
)


def utc_date_for(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).date().isoformat()


def as_utc(moment: datetime | None) -> datetime | None:
    """SQLite DateTime round-trips lose tzinfo; compare in UTC consistently."""

    if moment is None:
        return None

    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)

    return moment.astimezone(timezone.utc)


def _sanitize_stored_request(request_json: str | None) -> str | None:
    """Re-sanitize an incoming serialized request payload (defense in depth)."""

    if request_json is None:
        return None

    try:
        decoded = json.loads(request_json)
    except (TypeError, ValueError):
        return request_json

    if isinstance(decoded, (dict, list)):
        return serialize_request_payload(decoded)

    return request_json


def normalize_status(status: str) -> str:
    status = (status or "").strip()
    if status not in _STATUSES:
        raise ValueError(f"Unknown attempt status: {status}")
    return status


# ---------------------------------------------------------------------------
# Write side
# ---------------------------------------------------------------------------


def bump_daily_usage(
    db: Session,
    table: type,
    pk_columns: dict[str, str],
    usage_date: str,
    status: str,
    input_tokens: int | None,
    output_tokens: int | None,
    cache_tokens: int | None,
    latency_ms: int | None,
    *,
    attempt_count: int = 1,
) -> None:
    """Atomically add attempts with the same outcome to one daily aggregate."""

    values = {
        **pk_columns,
        "usage_date": usage_date,
        "call_count": attempt_count,
        "successful_call_count": attempt_count if status == STATUS_SUCCESS else 0,
        "failed_call_count": attempt_count if status in (STATUS_FAILED, STATUS_TIMEOUT) else 0,
        "input_tokens": (input_tokens or 0) * attempt_count,
        "output_tokens": (output_tokens or 0) * attempt_count,
        "cache_tokens": (cache_tokens or 0) * attempt_count,
        "total_latency_ms": (latency_ms or 0) * attempt_count,
        "latency_sample_count": attempt_count if latency_ms is not None else 0,
    }

    insert = postgresql_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = insert(table).values(values)
    excluded = stmt.excluded
    increments = {
        column: getattr(table, column) + getattr(excluded, column)
        for column in _INCREMENT_COLUMNS
    }
    stmt = stmt.on_conflict_do_update(
        index_elements=[*pk_columns, "usage_date"],
        set_=increments,
    )
    db.execute(stmt)


def record_attempt(
    *,
    user_id: str,
    api_key_id: str | None = None,
    message_trace_id: str | None = None,
    request_id: str | None = None,
    message_id: str | None = None,
    request_json: str | None = None,
    gateway_model_id: str | None = None,
    provider_model_id: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cache_tokens: int | None = None,
    uncached_input_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    cache_write_tokens: int | None = None,
    latency_ms: int | None = None,
    status: str = STATUS_FAILED,
    error_code: str | None = None,
    error_details: dict[str, Any] | None = None,
    created_at: datetime | None = None,
    finished_at: datetime | None = None,
) -> str:
    """Persist one upstream attempt and its aggregates atomically.

    ``request_json`` is sanitized here whatever the caller supplied, so
    credentials can never reach trace storage.

    Returns the id of the owning ``llm_message_traces`` row; when a new
    message trace is created, ``request_json`` is stored once on it.
    """

    status = normalize_status(status)
    request_json = _sanitize_stored_request(request_json)

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        started_at = created_at or now
        finished = finished_at or now
        usage_date = utc_date_for(started_at)

        if message_trace_id is None:
            message = LLMMessageTrace(
                id=request_id,
                user_id=user_id,
                message_id=message_id,
                request_json=request_json,
                created_at=started_at,
                finished_at=finished,
            )
            db.add(message)
            db.flush()
            message_trace_id = message.id
        else:
            message = db.get(LLMMessageTrace, message_trace_id)
            if message is None:
                db.rollback()
                raise ValueError(f"Unknown message trace id: {message_trace_id}")

            if message.message_id is None and message_id:
                message.message_id = message_id
            if message.request_json is None and request_json:
                message.request_json = request_json
            existing_finished = as_utc(message.finished_at)
            if existing_finished is None or (finished and as_utc(finished) > existing_finished):
                message.finished_at = finished

        db.add(
            LLMCallTrace(
                message_trace_id=message_trace_id,
                user_id=user_id,
                api_key_id=api_key_id,
                gateway_model_id=gateway_model_id,
                provider_model_id=provider_model_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_tokens=cache_tokens,
                uncached_input_tokens=uncached_input_tokens,
                cache_read_tokens=cache_read_tokens,
                cache_write_tokens=cache_write_tokens,
                latency_ms=latency_ms,
                status=status,
                error_code=error_code,
                error_details=error_details,
                created_at=started_at,
                finished_at=finished,
            )
        )
        db.flush()

        # One row per daily aggregate that applies to this attempt: API key,
        # gateway model, the per-user model slice, and the user's own totals.
        for table, pk_columns in aggregate_targets(
            user_id=user_id,
            api_key_id=api_key_id,
            gateway_model_id=gateway_model_id,
        ):
            bump_daily_usage(
                db,
                table,
                pk_columns,
                usage_date,
                status,
                input_tokens,
                output_tokens,
                cache_tokens,
                latency_ms,
            )

        db.commit()
        return message_trace_id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def aggregate_targets(
    *,
    user_id: str,
    api_key_id: str | None = None,
    gateway_model_id: str | None = None,
) -> list[tuple[type, dict[str, str]]]:
    """Daily aggregate rows that one attempt updates, keyed by subject."""

    targets: list[tuple[type, dict[str, str]]] = []
    if api_key_id:
        targets.append((LLMAPIKeyUsageDaily, {"api_key_id": api_key_id}))
    if gateway_model_id:
        targets.append((LLMGatewayModelUsageDaily, {"gateway_model_id": gateway_model_id}))
        # Per-user model slice so regular users can see model analytics
        # scoped to their own attempts.
        targets.append(
            (
                LLMUserModelUsageDaily,
                {"user_id": user_id, "gateway_model_id": gateway_model_id},
            )
        )
    targets.append((LLMUserUsageDaily, {"user_id": user_id}))
    return targets


def start_pending_attempt(
    *,
    user_id: str,
    api_key_id: str | None = None,
    request_json: str | None = None,
    message_trace_id: str | None = None,
    request_id: str | None = None,
    gateway_model_id: str | None = None,
    provider_model_id: str | None = None,
    created_at: datetime | None = None,
) -> tuple[str, str]:
    """Insert the message context and a ``pending`` call row pre-dispatch.

    Owns its write transaction so the capture layer never touches a session.
    ``request_json`` is the caller's already-sanitized payload and is only
    populated for users that opted into persistence. A pending call trace row
    is appended for every attempt; retries share one message trace.

    Returns ``(message_trace_id, call_trace_id)``.
    """

    started_at = created_at or datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        if message_trace_id is None:
            message = LLMMessageTrace(
                id=request_id,
                user_id=user_id,
                request_json=request_json,
                created_at=started_at,
            )
            db.add(message)
            db.flush()
            message_trace_id = message.id
        else:
            message = db.get(LLMMessageTrace, message_trace_id)
            if message is None:
                raise ValueError(f"Unknown message trace id: {message_trace_id}")
            if message.request_json is None and request_json:
                message.request_json = request_json

        call = LLMCallTrace(
            message_trace_id=message.id,
            user_id=user_id,
            api_key_id=api_key_id,
            gateway_model_id=gateway_model_id,
            provider_model_id=provider_model_id,
            status=STATUS_PENDING,
            created_at=started_at,
        )
        db.add(call)
        db.flush()

        message_id = message.id
        call_id = call.id
        db.commit()
        return message_id, call_id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def finish_pending_attempt(
    *,
    call_trace_id: str,
    status: str,
    error_code: str | None = None,
    error_details: dict[str, Any] | None = None,
    latency_ms: int | None = None,
    message_id: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cache_tokens: int | None = None,
    uncached_input_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    cache_write_tokens: int | None = None,
    finished_at: datetime | None = None,
) -> None:
    """Finalize one ``pending`` call row after its upstream attempt.

    Context (user, key, models) was fixed when the row was created; only the
    outcome is written here. The attempt outcome and the daily aggregate bump
    are idempotent: the first finalize decides them, and any repeated finalize
    is a no-op so a bug can never double-count usage.

    Raises ``ValueError`` when the call trace id is unknown.
    """

    status = normalize_status(status)
    finished = finished_at or datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        call = db.get(LLMCallTrace, call_trace_id, with_for_update=True)
        if call is None:
            raise ValueError(f"Unknown call trace id: {call_trace_id}")

        if call.status != STATUS_PENDING:
            # Already finalized: the recorded outcome stands.
            db.commit()
            return

        call.status = status
        call.error_code = error_code
        call.error_details = error_details
        call.latency_ms = latency_ms
        call.input_tokens = input_tokens
        call.output_tokens = output_tokens
        call.cache_tokens = cache_tokens
        call.uncached_input_tokens = uncached_input_tokens
        call.cache_read_tokens = cache_read_tokens
        call.cache_write_tokens = cache_write_tokens
        call.finished_at = finished

        message = db.get(LLMMessageTrace, call.message_trace_id, with_for_update=True)
        if message is not None:
            if message.message_id is None and message_id:
                message.message_id = message_id
            existing_finished = as_utc(message.finished_at)
            if existing_finished is None or as_utc(finished) > existing_finished:
                message.finished_at = finished

        # First finalize: fold this attempt into the daily aggregates.
        usage_date = utc_date_for(as_utc(call.created_at))
        for table, pk_columns in aggregate_targets(
            user_id=call.user_id,
            api_key_id=call.api_key_id,
            gateway_model_id=call.gateway_model_id,
        ):
            bump_daily_usage(
                db,
                table,
                pk_columns,
                usage_date,
                status,
                input_tokens,
                output_tokens,
                cache_tokens,
                latency_ms,
            )

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def expire_pending_attempts() -> int:
    """Close up to 100 overdue traces and account for their failed attempts."""

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=REQUEST_TIMEOUT_SECONDS)
    latency_ms = REQUEST_TIMEOUT_SECONDS * 1000
    table_order = (
        LLMAPIKeyUsageDaily, LLMGatewayModelUsageDaily,
        LLMUserModelUsageDaily, LLMUserUsageDaily,
    )
    with SessionLocal.begin() as db:
        calls = db.scalars(
            select(LLMCallTrace)
            .where(LLMCallTrace.status == STATUS_PENDING, LLMCallTrace.created_at <= cutoff)
            .order_by(LLMCallTrace.created_at, LLMCallTrace.id)
            .limit(100)
            .with_for_update(skip_locked=True)
        ).all()
        if not calls:
            return 0

        messages = db.scalars(
            select(LLMMessageTrace)
            .where(LLMMessageTrace.id.in_({call.message_trace_id for call in calls}))
            .order_by(LLMMessageTrace.id)
            .with_for_update()
        ).all()
        for message in messages:
            if message.finished_at is None or as_utc(message.finished_at) < now:
                message.finished_at = now

        counts: dict[tuple[int, tuple[tuple[str, str], ...], str], int] = {}
        for call in calls:
            call.status = STATUS_TIMEOUT
            call.error_code = "request_timeout"
            call.error_details = {"message": REQUEST_TIMEOUT_MESSAGE, "gateway_status": 504}
            call.latency_ms = latency_ms
            call.finished_at = now
            for table, keys in aggregate_targets(
                user_id=call.user_id,
                api_key_id=call.api_key_id,
                gateway_model_id=call.gateway_model_id,
            ):
                key = (table_order.index(table), tuple(keys.items()), utc_date_for(as_utc(call.created_at)))
                counts[key] = counts.get(key, 0) + 1

        # Follow the same table lock order as single-attempt finalization.
        for (table_index, keys, usage_date), count in sorted(counts.items()):
            bump_daily_usage(
                db, table_order[table_index], dict(keys), usage_date, STATUS_TIMEOUT,
                None, None, None, latency_ms, attempt_count=count,
            )
        return len(calls)


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def _aggregate_message_rows(
    db: Session,
    trace_id: str | None = None,
    user_id: str | None = None,
):
    """Aggregate calls per message trace (LEFT JOIN keeps empty messages)."""

    query = db.query(
        LLMMessageTrace.id.label("id"),
        LLMMessageTrace.user_id.label("user_id"),
        LLMMessageTrace.message_id.label("message_id"),
        LLMMessageTrace.request_json.label("request_json"),
        LLMMessageTrace.created_at.label("created_at"),
        LLMMessageTrace.finished_at.label("finished_at"),
        func.min(LLMCallTrace.api_key_id).label("api_key_id"),
        func.count(LLMCallTrace.id).label("call_count"),
        func.coalesce(
            func.sum(case((LLMCallTrace.status == STATUS_SUCCESS, 1), else_=0)), 0
        ).label("successful_call_count"),
        func.coalesce(
            func.sum(case((LLMCallTrace.status == STATUS_FAILED, 1), else_=0)), 0
        ).label("failed_call_count"),
        func.coalesce(
            func.sum(case((LLMCallTrace.status == STATUS_TIMEOUT, 1), else_=0)), 0
        ).label("timeout_call_count"),
        func.sum(LLMCallTrace.input_tokens).label("input_tokens"),
        func.sum(LLMCallTrace.output_tokens).label("output_tokens"),
        func.sum(LLMCallTrace.cache_tokens).label("cache_tokens"),
        func.sum(LLMCallTrace.latency_ms).label("total_latency_ms"),
    ).outerjoin(LLMCallTrace, LLMCallTrace.message_trace_id == LLMMessageTrace.id)

    if trace_id is not None:
        query = query.filter(LLMMessageTrace.id == trace_id)
    if user_id is not None:
        query = query.filter(LLMMessageTrace.user_id == user_id)

    return query.group_by(LLMMessageTrace.id)


def message_status_from_counts(
    call_count: int, successful: int, failed: int, timeout: int
) -> str:
    if call_count == 0:
        return STATUS_FAILED
    if successful > 0:
        return STATUS_SUCCESS
    # Attempts opened pre-dispatch but not yet finalized remain pending, so
    # the message is still in flight.
    if successful + failed < call_count:
        return STATUS_PENDING
    if timeout > 0:
        return STATUS_TIMEOUT
    return STATUS_FAILED


def message_row_from_aggregate(row: Any) -> dict[str, Any]:
    """Shape a joined aggregate row into the page/item response payload."""

    # Unsuccessful attempts (failed or timed out) roll into failed_call_count,
    # matching the daily-aggregate semantics.
    failed = int(row.failed_call_count or 0) + int(row.timeout_call_count or 0)
    timeout = int(row.timeout_call_count or 0)
    successful = int(row.successful_call_count or 0)
    status = message_status_from_counts(
        int(row.call_count or 0), successful, failed, timeout
    )

    return {
        "id": row.id,
        "user_id": row.user_id,
        "message_id": row.message_id,
        "api_key_id": row.api_key_id,
        "request": row.request_json,
        "status": status,
        "call_count": int(row.call_count or 0),
        "successful_call_count": successful,
        "failed_call_count": failed,
        "input_tokens": row.input_tokens,
        "output_tokens": row.output_tokens,
        "cache_tokens": row.cache_tokens,
        "total_latency_ms": row.total_latency_ms,
        "created_at": row.created_at,
        "finished_at": row.finished_at,
    }


def _request_id_match(request_id: str):
    return or_(LLMMessageTrace.id == request_id, LLMMessageTrace.message_id == request_id)


def list_message_rows(
    db: Session,
    page: int,
    page_size: int,
    user_id: str | None = None,
    request_id: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    count_query = db.query(func.count(LLMMessageTrace.id))
    query = _aggregate_message_rows(db, user_id=user_id)
    if request_id:
        match = _request_id_match(request_id)
        count_query = count_query.filter(match)
        query = query.filter(match)
    if user_id is not None:
        count_query = count_query.filter(LLMMessageTrace.user_id == user_id)
    total = count_query.scalar() or 0
    # Newest requests first. Attempt ordering remains chronological in detail.
    query = (
        query.order_by(LLMMessageTrace.created_at.desc(), LLMMessageTrace.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return [message_row_from_aggregate(row) for row in query.all()], int(total)


def get_message_row(db: Session, trace_id: str) -> dict[str, Any] | None:
    row = _aggregate_message_rows(db, trace_id).first()
    return message_row_from_aggregate(row) if row else None


def list_call_rows_by_message(db: Session, trace_id: str) -> list[dict[str, Any]]:
    """Call records for one message trace, chronological (ascending)."""

    rows = (
        _calls_query(db)
        .filter(LLMCallTrace.message_trace_id == trace_id)
        .order_by(LLMCallTrace.created_at.asc(), LLMCallTrace.id.asc())
        .all()
    )
    return [_call_row_data(row, include_error_details=True) for row in rows]


def _calls_query(db: Session):
    return (
        db.query(LLMCallTrace, LLMMessageTrace, ModelGroup, ProviderModel, Provider)
        .outerjoin(LLMMessageTrace, LLMCallTrace.message_trace_id == LLMMessageTrace.id)
        .outerjoin(ModelGroup, LLMCallTrace.gateway_model_id == ModelGroup.id)
        .outerjoin(ProviderModel, LLMCallTrace.provider_model_id == ProviderModel.id)
        .outerjoin(Provider, ProviderModel.provider_id == Provider.id)
    )


def _call_row_data(row: Any, *, include_error_details: bool = False) -> dict[str, Any]:
    call, message, group, provider_model, provider = row

    return {
        "id": call.id,
        "message_trace_id": call.message_trace_id,
        "user_id": call.user_id,
        "message_id": message.message_id if message is not None else None,
        "api_key_id": call.api_key_id,
        # Every call inherits the sanitized request context stored once on
        # its message trace (never re-serialized or duplicated per call).
        "request": message.request_json if message is not None else None,
        "gateway_model": (
            {"id": group.id, "model_id": group.model_id} if group is not None else None
        ),
        "provider_model": (
            {
                "id": provider_model.id,
                "model_id": provider_model.model_id,
                "provider_id": provider.id,
                "provider_name": provider.name,
                "provider_alias": provider.aliases,
            }
            if provider_model is not None and provider is not None
            else None
        ),
        "input_tokens": call.input_tokens,
        "output_tokens": call.output_tokens,
        "cache_tokens": call.cache_tokens,
        "uncached_input_tokens": call.uncached_input_tokens,
        "cache_read_tokens": call.cache_read_tokens,
        "cache_write_tokens": call.cache_write_tokens,
        "latency_ms": call.latency_ms,
        "status": call.status,
        "error_code": call.error_code,
        "error_details": call.error_details if include_error_details else None,
        "created_at": call.created_at,
        "finished_at": call.finished_at,
    }


def list_calls(
    db: Session,
    page: int,
    page_size: int,
    *,
    user_id: str | None = None,
    message_id: str | None = None,
    request_id: str | None = None,
    api_key_id: str | None = None,
    gateway_model_id: str | None = None,
    provider_model_id: str | None = None,
    status: str | None = None,
    started: datetime | None = None,
    ended: datetime | None = None,
) -> tuple[list[dict[str, Any]], int]:
    query = _calls_query(db).options(Load(LLMCallTrace).defer(LLMCallTrace.error_details))

    if user_id:
        query = query.filter(LLMCallTrace.user_id == user_id)
    if request_id:
        message_ids = select(LLMMessageTrace.id).where(_request_id_match(request_id))
        query = query.filter(or_(LLMCallTrace.message_trace_id.in_(message_ids), LLMCallTrace.id == request_id))
    if message_id:
        message_ids = select(LLMMessageTrace.id).where(LLMMessageTrace.message_id == message_id)
        query = query.filter(LLMCallTrace.message_trace_id.in_(message_ids))
    if api_key_id:
        query = query.filter(LLMCallTrace.api_key_id == api_key_id)
    if gateway_model_id:
        query = query.filter(LLMCallTrace.gateway_model_id == gateway_model_id)
    if provider_model_id:
        query = query.filter(LLMCallTrace.provider_model_id == provider_model_id)
    if status:
        query = query.filter(LLMCallTrace.status == normalize_status(status))
    if started:
        query = query.filter(LLMCallTrace.created_at >= started)
    if ended:
        query = query.filter(LLMCallTrace.created_at < ended)

    total = query.with_entities(func.count(LLMCallTrace.id)).scalar() or 0
    # Newest provider calls first in the top-level list.
    rows = (
        query.order_by(LLMCallTrace.created_at.desc(), LLMCallTrace.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_call_row_data(row) for row in rows], int(total)


def get_call(db: Session, call_id: str) -> dict[str, Any] | None:
    row = _calls_query(db).filter(LLMCallTrace.id == call_id).first()
    return _call_row_data(row, include_error_details=True) if row else None


# ---------------------------------------------------------------------------
# Daily aggregate analytics
# ---------------------------------------------------------------------------


def _filter_date_range(
    rows_query: Any,
    table: type,
    from_date: date | None,
    to_date: date | None,
) -> Any:
    """Constrain a daily-aggregate query to the requested usage-date window."""

    if from_date:
        rows_query = rows_query.filter(table.usage_date >= from_date.isoformat())
    if to_date:
        rows_query = rows_query.filter(table.usage_date <= to_date.isoformat())
    return rows_query


def _totals_row(rows: list[Any]) -> dict[str, Any]:
    def total(attr: str) -> int:
        return sum(int(getattr(row, attr, 0) or 0) for row in rows)

    latency_samples = total("latency_sample_count")
    latency = total("total_latency_ms")

    return {
        "call_count": total("call_count"),
        "successful_call_count": total("successful_call_count"),
        "failed_call_count": total("failed_call_count"),
        "input_tokens": total("input_tokens"),
        "output_tokens": total("output_tokens"),
        "cache_tokens": total("cache_tokens"),
        "total_latency_ms": latency,
        "average_latency_ms": round(latency / latency_samples) if latency_samples > 0 else None,
    }


def _daily_entries(rows: list[Any]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda item: item.usage_date):
        entry = {
            "date": row.usage_date,
            "call_count": int(row.call_count or 0),
            "successful_call_count": int(row.successful_call_count or 0),
            "failed_call_count": int(row.failed_call_count or 0),
            "input_tokens": int(row.input_tokens or 0),
            "output_tokens": int(row.output_tokens or 0),
            "cache_tokens": int(row.cache_tokens or 0),
            "total_latency_ms": int(row.total_latency_ms or 0),
            "average_latency_ms": None,
        }
        if (row.latency_sample_count or 0) > 0:
            entry["average_latency_ms"] = round(
                int(row.total_latency_ms or 0) / int(row.latency_sample_count)
            )
        entries.append(entry)
    return entries


def usage_for_subject(
    db: Session,
    table: type,
    pk_name: str,
    subject_id: str,
    from_date: date | None,
    to_date: date | None,
) -> dict[str, Any]:
    rows_query = db.query(table).filter(getattr(table, pk_name) == subject_id)
    rows_query = _filter_date_range(rows_query, table, from_date, to_date)

    rows = rows_query.order_by(table.usage_date).all()
    return {"totals": _totals_row(rows), "daily": _daily_entries(rows)}


def usage_for_user_gateway_model(
    db: Session,
    user_id: str,
    gateway_model_id: str,
    from_date: date | None,
    to_date: date | None,
) -> dict[str, Any]:
    """Gateway-model analytics scoped to one user's own attempts.

    Regular users may only see model-level usage they generated; superusers
    read the all-user table through ``usage_for_subject`` instead.
    """

    rows_query = db.query(LLMUserModelUsageDaily).filter(
        LLMUserModelUsageDaily.user_id == user_id,
        LLMUserModelUsageDaily.gateway_model_id == gateway_model_id,
    )
    rows_query = _filter_date_range(rows_query, LLMUserModelUsageDaily, from_date, to_date)

    rows = rows_query.order_by(LLMUserModelUsageDaily.usage_date).all()
    return {"totals": _totals_row(rows), "daily": _daily_entries(rows)}


def hourly_call_activity(
    db: Session,
    subject_column,
    subject_id: str,
    from_date: date,
    to_date: date,
) -> list[dict[str, int]]:
    """Count completed attempts in each UTC hour across the selected dates."""
    hour = (func.to_char(func.timezone("UTC", LLMCallTrace.created_at), "HH24")
            if db.get_bind().dialect.name == "postgresql"
            else func.strftime("%H", LLMCallTrace.created_at))
    success = func.sum(case((LLMCallTrace.status == STATUS_SUCCESS, 1), else_=0))
    rows = (
        db.query(hour, success, func.count())
        .filter(
            subject_column == subject_id,
            LLMCallTrace.created_at >= day_start(from_date),
            LLMCallTrace.created_at <= datetime.combine(to_date, time.max, tzinfo=timezone.utc),
            LLMCallTrace.status.in_((STATUS_SUCCESS, STATUS_FAILED, STATUS_TIMEOUT)),
        )
        .group_by(hour)
        .all()
    )
    counts = {int(bucket): (successful, total - successful) for bucket, successful, total in rows}
    return [
        {
            "hour": hour,
            "successful_call_count": counts.get(hour, (0, 0))[0],
            "failed_call_count": counts.get(hour, (0, 0))[1],
        }
        for hour in range(24)
    ]


def day_start(a_date: date) -> datetime:
    return datetime.combine(a_date, time.min, tzinfo=timezone.utc)


def day_end_inclusive(a_date: date) -> datetime:
    """Exclusive upper bound for the requested date (start of the next day)."""
    next_day = a_date + timedelta(days=1)
    return datetime.combine(next_day, time.min, tzinfo=timezone.utc)


def usage_date_bounds(subject_created_at: datetime) -> tuple[date, date]:
    """Default analytics window when from/to are omitted on analytics routes.

    from_date: date the subject (user/API key/model group) was created.
    to_date: today (UTC).
    """
    return (
        date.fromisoformat(utc_date_for(subject_created_at)),
        datetime.now(timezone.utc).date(),
    )


def daily_charged_credits(
    db: Session,
    subject_column,
    subject_id: str,
    from_date: date | None,
    to_date: date | None,
) -> dict[str, Any]:
    """Daily credits a subject was actually charged, from the credit ledger.

    Aggregates settled ``credit_usage.charged`` (microcredits, user side) by
    the UTC date of reservation creation — the same UTC-date basis the daily
    usage tables use. Unsettled and released usage charges zero and is
    therefore absent. Charges exist independently of tracing, so cost days
    need not align with trace analytics days.
    """

    day = (func.to_char(func.timezone("UTC", CreditUsage.created_at), "YYYY-MM-DD")
           if db.get_bind().dialect.name == "postgresql"
           else func.strftime("%Y-%m-%d", CreditUsage.created_at))
    query = db.query(day, func.sum(CreditUsage.charged)).filter(
        subject_column == subject_id,
        CreditUsage.charged > 0,
    )
    if from_date:
        query = query.filter(CreditUsage.created_at >= day_start(from_date))
    if to_date:
        query = query.filter(CreditUsage.created_at < day_end_inclusive(to_date))
    rows = query.group_by(day).order_by(day).all()

    total_micros = sum(int(micros or 0) for _, micros in rows)
    return {
        "totals": {"charged_credits": format_credits(total_micros)},
        "daily": [
            {"date": charged_date, "charged_credits": format_credits(int(micros or 0))}
            for charged_date, micros in rows
        ],
    }
