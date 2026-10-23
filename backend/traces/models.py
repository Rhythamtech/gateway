from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid4())


class LLMMessageTrace(Base):
    """One entry per inbound message/request (request context stored once)."""

    __tablename__ = "llm_message_traces"
    __table_args__ = (
        Index("ix_llm_message_traces_user_created", "user_id", "created_at"),
        Index("ix_llm_message_traces_user_message", "user_id", "message_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # Provider/client message identifier (for example "msg_123") when known.
    message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Sanitized request payload stored once and referenced by every call.
    request_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LLMCallTrace(Base):
    """One entry per actual gateway/provider model attempt (retries included)."""

    __tablename__ = "llm_call_traces"
    __table_args__ = (
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0",
            name="ck_llm_call_traces_input_tokens_nonneg",
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name="ck_llm_call_traces_output_tokens_nonneg",
        ),
        CheckConstraint(
            "cache_tokens IS NULL OR cache_tokens >= 0",
            name="ck_llm_call_traces_cache_tokens_nonneg",
        ),
        CheckConstraint(
            "uncached_input_tokens IS NULL OR uncached_input_tokens >= 0",
            name="ck_llm_call_traces_uncached_input_tokens_nonneg",
        ),
        CheckConstraint(
            "cache_read_tokens IS NULL OR cache_read_tokens >= 0",
            name="ck_llm_call_traces_cache_read_tokens_nonneg",
        ),
        CheckConstraint(
            "cache_write_tokens IS NULL OR cache_write_tokens >= 0",
            name="ck_llm_call_traces_cache_write_tokens_nonneg",
        ),
        CheckConstraint(
            "billable_token_units IS NULL OR billable_token_units >= 0",
            name="ck_llm_call_traces_billable_tokens_nonneg",
        ),
        CheckConstraint(
            "user_credits_charged >= 0",
            name="ck_llm_call_traces_user_credits_nonneg",
        ),
        CheckConstraint(
            "provider_budget_credits_consumed >= 0",
            name="ck_llm_call_traces_provider_credits_nonneg",
        ),
        CheckConstraint(
            "provider_cost_nanos >= 0",
            name="ck_llm_call_traces_provider_cost_nonneg",
        ),
        CheckConstraint(
            "latency_ms IS NULL OR latency_ms >= 0",
            name="ck_llm_call_traces_latency_ms_nonneg",
        ),
        CheckConstraint(
            "status IN ('pending','success','failed','timeout')",
            name="ck_llm_call_traces_status",
        ),
        CheckConstraint(
            ("token_usage_source IS NULL "
             "OR token_usage_source IN ('reported','estimated','unavailable')"),
            name="ck_llm_call_traces_token_usage_source",
        ),
        Index("ix_llm_call_traces_user_created", "user_id", "created_at"),
        Index("ix_llm_call_traces_api_key_created", "api_key_id", "created_at"),
        Index("ix_llm_call_traces_gateway_model_created", "gateway_model_id", "created_at"),
        Index("ix_llm_call_traces_provider_model_created", "provider_model_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    message_trace_id: Mapped[str] = mapped_column(
        ForeignKey("llm_message_traces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    api_key_id: Mapped[str | None] = mapped_column(
        ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=True
    )
    gateway_model_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_groups.id", ondelete="CASCADE"), nullable=True
    )
    provider_model_id: Mapped[str | None] = mapped_column(
        ForeignKey("provider_models.id", ondelete="CASCADE"), nullable=True
    )

    # Provider-reported token usage. Legacy columns (input/output/cache) keep
    # their operational analytics meaning: ``input_tokens`` is the canonical
    # total input (uncached + cache read + cache write), ``cache_tokens`` is
    # total cache traffic (read + write).
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Normalized token components. ``input_tokens`` above is defined as the
    # sum of the three input components; cache tokens are never counted twice.
    uncached_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_write_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Normalized billable units: uncached_input + cache_read + cache_write
    # + output. One unit is one base user credit before the multiplier.
    billable_token_units: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Where usage came from: provider-reported, estimated (no provider
    # usage, estimation policy applied) or unavailable (nothing billable).
    token_usage_source: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Accounting charges for this attempt. user_credits_charged uses the
    # group multiplier snapshotted below; provider_budget_credits_consumed
    # is in normalized token units without the multiplier.
    user_credits_charged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    credit_multiplier_ppm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_budget_credits_consumed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Estimated upstream financial cost snapshot (independent of credits).
    provider_cost_nanos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Original sanitized provider usage and applicable rate snapshot for
    # auditing charge calculations later.
    provider_usage_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_rate_snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # pending: reservation created before dispatch, awaiting settlement.
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


def _daily_constraints(table: str) -> tuple:
    return (
        CheckConstraint("call_count >= 0", name=f"ck_{table}_call_count_nonneg"),
        CheckConstraint(
            "successful_call_count >= 0", name=f"ck_{table}_successful_call_count_nonneg"
        ),
        CheckConstraint("failed_call_count >= 0", name=f"ck_{table}_failed_call_count_nonneg"),
        CheckConstraint("input_tokens >= 0", name=f"ck_{table}_input_tokens_nonneg"),
        CheckConstraint("output_tokens >= 0", name=f"ck_{table}_output_tokens_nonneg"),
        CheckConstraint("cache_tokens >= 0", name=f"ck_{table}_cache_tokens_nonneg"),
        CheckConstraint("total_latency_ms >= 0", name=f"ck_{table}_total_latency_nonneg"),
        CheckConstraint(
            "latency_sample_count >= 0", name=f"ck_{table}_latency_sample_count_nonneg"
        ),
        CheckConstraint("length(usage_date) = 10", name=f"ck_{table}_usage_date_format"),
    )


class LLMAPIKeyUsageDaily(Base):
    """Per-API-key daily usage; keyed by (api_key_id, usage_date)."""

    __tablename__ = "llm_api_key_usage_daily"
    __table_args__ = _daily_constraints("llm_api_key_usage_daily")

    api_key_id: Mapped[str] = mapped_column(
        ForeignKey("api_keys.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)

    call_count: Mapped[int]
    successful_call_count: Mapped[int]
    failed_call_count: Mapped[int]
    input_tokens: Mapped[int]
    output_tokens: Mapped[int]
    cache_tokens: Mapped[int]
    total_latency_ms: Mapped[int]
    latency_sample_count: Mapped[int]


class LLMGatewayModelUsageDaily(Base):
    """Per-gateway-model daily usage; keyed by (gateway_model_id, usage_date)."""

    __tablename__ = "llm_gateway_model_usage_daily"
    __table_args__ = _daily_constraints("llm_gateway_model_usage_daily")

    gateway_model_id: Mapped[str] = mapped_column(
        ForeignKey("model_groups.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)

    call_count: Mapped[int]
    successful_call_count: Mapped[int]
    failed_call_count: Mapped[int]
    input_tokens: Mapped[int]
    output_tokens: Mapped[int]
    cache_tokens: Mapped[int]
    total_latency_ms: Mapped[int]
    latency_sample_count: Mapped[int]


class LLMUserUsageDaily(Base):
    """Per-user daily usage; keyed by (user_id, usage_date)."""

    __tablename__ = "llm_user_usage_daily"
    __table_args__ = _daily_constraints("llm_user_usage_daily")

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)

    call_count: Mapped[int]
    successful_call_count: Mapped[int]
    failed_call_count: Mapped[int]
    input_tokens: Mapped[int]
    output_tokens: Mapped[int]
    cache_tokens: Mapped[int]
    total_latency_ms: Mapped[int]
    latency_sample_count: Mapped[int]


class LLMUserModelUsageDaily(Base):
    """Per-user, per-gateway-model daily usage.

    Keyed by (user_id, gateway_model_id, usage_date). Lets regular users
    inspect model-level analytics scoped to their own attempts, while
    superusers read the all-user ``llm_gateway_model_usage_daily`` table.
    """

    __tablename__ = "llm_user_model_usage_daily"
    __table_args__ = _daily_constraints("llm_user_model_usage_daily")

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    gateway_model_id: Mapped[str] = mapped_column(
        ForeignKey("model_groups.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[str] = mapped_column(String(10), primary_key=True)

    call_count: Mapped[int]
    successful_call_count: Mapped[int]
    failed_call_count: Mapped[int]
    input_tokens: Mapped[int]
    output_tokens: Mapped[int]
    cache_tokens: Mapped[int]
    total_latency_ms: Mapped[int]
    latency_sample_count: Mapped[int]
