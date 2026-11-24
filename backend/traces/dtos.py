"""Versioned JSON response schemas for the LLM tracing API.

All identifiers are UUIDs, timestamps are UTC ISO 8601 with a trailing "Z"
(`backend/core/datetime_safety.py` enforces the zone), token counts and
latency values are integers >= 0 (nullable where unavailable), and field
names are snake_case.
"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, JsonValue

from backend.core.datetime_safety import UTCDateTime

SubjectType = Literal["api_key", "gateway_model", "user"]
TraceStatus = Literal["pending", "success", "failed", "timeout"]


class MessageTraceItem(BaseModel):
    id: UUID
    user_id: UUID
    message_id: str | None
    api_key_id: UUID | None
    request: dict[str, Any] | None
    status: TraceStatus
    call_count: int
    successful_call_count: int
    failed_call_count: int
    input_tokens: int | None
    output_tokens: int | None
    cache_tokens: int | None
    total_latency_ms: int | None
    created_at: UTCDateTime
    finished_at: UTCDateTime | None


class MessageTraceDetail(MessageTraceItem):
    calls: list["CallTraceItem"]


class ClearTracesResult(BaseModel):
    deleted_count: int


class MessagesPage(BaseModel):
    items: list[MessageTraceItem]
    page: int
    page_size: int
    total: int


class GatewayModelRef(BaseModel):
    id: UUID | None
    model_id: str


class ProviderModelRef(BaseModel):
    id: UUID
    model_id: str
    provider_id: UUID
    provider_name: str
    provider_alias: str


class CallErrorDetails(BaseModel):
    message: str | None = None
    operation: str | None = None
    upstream_model: str | None = None
    gateway_status: int | None = None
    provider_status: int | None = None
    provider_message: str | None = None
    provider_code: str | None = None
    provider_type: str | None = None
    provider_response: JsonValue = None


class CallTraceItem(BaseModel):
    id: UUID
    message_trace_id: UUID
    user_id: UUID
    message_id: str | None
    api_key_id: UUID | None
    gateway_model: GatewayModelRef | None
    provider_model: ProviderModelRef | None
    request: dict[str, Any] | None
    input_tokens: int | None
    output_tokens: int | None
    cache_tokens: int | None
    # Normalized token components (detail granularity for the attempt).
    uncached_input_tokens: int | None
    cache_read_tokens: int | None
    cache_write_tokens: int | None
    latency_ms: int | None
    status: TraceStatus
    error_code: str | None
    error_details: CallErrorDetails | None = None
    created_at: UTCDateTime
    finished_at: UTCDateTime | None


class CallsPage(BaseModel):
    items: list[CallTraceItem]
    page: int
    page_size: int
    total: int


class UsageTotals(BaseModel):
    call_count: int
    successful_call_count: int
    failed_call_count: int
    input_tokens: int
    output_tokens: int
    cache_tokens: int
    total_latency_ms: int
    average_latency_ms: int | None


class DailyUsageEntry(BaseModel):
    date: str
    call_count: int
    successful_call_count: int
    failed_call_count: int
    input_tokens: int
    output_tokens: int
    cache_tokens: int
    total_latency_ms: int
    average_latency_ms: int | None


class HourlyCallActivity(BaseModel):
    hour: int = Field(ge=0, le=23)
    successful_call_count: int
    failed_call_count: int


# Daily credits charged per subject, from actual settled credit usage.
# Decimal credit strings follow the credit-ledger contract (six fractional
# digits); only days with charges appear, and ``cost`` is ``None`` for
# subjects the ledger cannot attribute (per-gateway-model analytics).
class DailyCostEntry(BaseModel):
    date: str
    charged_credits: str


class UsageCostTotals(BaseModel):
    charged_credits: str


class UsageCost(BaseModel):
    totals: UsageCostTotals
    daily: list[DailyCostEntry]


class UsageAnalytics(BaseModel):
    subject_type: SubjectType
    subject_id: UUID
    from_date: str
    to_date: str
    totals: UsageTotals
    daily: list[DailyUsageEntry]
    hourly: list[HourlyCallActivity] | None = None
    cost: UsageCost | None = None
